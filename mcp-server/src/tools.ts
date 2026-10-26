import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const DEFAULT_BASE_URL = "https://brewpage.app";
export const USER_AGENT = "brewpage-mcp/1.14.1";
export const OWNER_TOKEN_ENV = "BREWPAGE_OWNER_TOKEN";

export interface ServerOptions {
  /** BrewPage origin for API calls; default https://brewpage.app. */
  baseUrl?: string;
  /** Default owner token for every call; stdio passes BREWPAGE_OWNER_TOKEN, remote mode none. */
  ownerToken?: string;
  /** User-Agent on every BrewPage call; default brewpage-mcp/<version>. */
  userAgent?: string;
  /** Extra headers on every BrewPage call; tool headers win on conflict. */
  headers?: Record<string, string>;
  /** Source download for publish_file: file bytes, or a thrown Error whose message is the tool error. */
  fetchSource?: (url: string) => Promise<Blob>;
  /** Origin for links built locally (get_page fallback); default baseUrl. */
  publicOrigin?: string;
  /** Transport for BrewPage API calls; default global fetch. */
  fetch?: typeof fetch;
}

const READ_ONLY: ToolAnnotations = { readOnlyHint: true };
const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true };
const ADDITIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false };

/** Display title (top level and annotation) plus safety hints for clients and directories. */
function toolMeta(title: string, hints: ToolAnnotations) {
  return { title, annotations: { title, ...hints } };
}

const NO_OWNER_TOKEN = `No owner token: pass ownerToken or set ${OWNER_TOKEN_ENV}.`;
const CREATE_OWNER_TOKEN_DESCRIPTION = `Optional. Default: ${OWNER_TOKEN_ENV}, else a new token per create.`;
const OWNER_TOKEN_DESCRIPTION = `Owner token from create. Default: ${OWNER_TOKEN_ENV}.`;
const SECRETS = "Secrets allowed; likely ones are flagged in notices. For a secret: private namespace + password.";
const MANAGE_URL_TEXT = "Returns manageUrl (private): give it to the user privately; never publish it.";
const OLD_READ_ONLY_CODE = "OLD_PUBLICATION_READ_ONLY";
const OLD_READ_ONLY_TEXT = ` Old publications (made before 5 October 2026) are read-only: 409 ${OLD_READ_ONLY_CODE}.`;
/** Notice codes the agent must relay to the user. */
const WARNING_CODES = new Set(["secret-detected", "manage-link-disabled"]);
/** MCP type name -> REST path segment. */
const TYPE_SEGMENTS: Record<string, string> = { html: "html", site: "sites", file: "files", json: "json", kv: "kv" };

/** `/api/<segments>` with each segment encoded; empty, `.` and `..` refused (URL parsing would resolve them away). */
export function apiPath(...segments: string[]): string {
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`Invalid path value ${JSON.stringify(segment)}: empty, "." and ".." are not allowed.`);
    }
  }
  return `/api/${segments.map(encodeURIComponent).join("/")}`;
}

/** Path plus URLSearchParams query; undefined values skipped, no `?` when empty. */
export function withQuery(path: string, params: Array<[string, string | number | undefined]>): string {
  const query = new URLSearchParams();
  for (const [name, value] of params) if (value !== undefined) query.append(name, String(value));
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Only the last 4 characters: tokens never reach a transcript in full. */
function maskToken(token: string): string {
  return `…${token.slice(-4)}`;
}

function textResult(text: string, isError = false) {
  return isError ? { content: [{ type: "text" as const, text }], isError: true } : { content: [{ type: "text" as const, text }] };
}

/** Owner-tool failure: the server answer verbatim plus a hint for a plain wrong-token 403 or a frozen old publication. */
function ownerFailure(operation: string, status: number, data: unknown, fromEnv: boolean) {
  const lines = [`Failed to ${operation} (${status}): ${JSON.stringify(data)}`];
  const code = (data as { code?: unknown } | null)?.code;
  if (status === 403 && (code === undefined || code === "OWNER_AUTHORIZATION_FAILED")) {
    lines.push(`Wrong owner token for this publication. Use ownerToken from create.${fromEnv ? ` Sent: ${OWNER_TOKEN_ENV}.` : ""}`);
  }
  if (status === 409 && code === OLD_READ_ONLY_CODE) {
    const republishUrl = (data as { republishUrl?: unknown }).republishUrl;
    lines.push("Read-only old publication: cannot be updated. Publish the content anew with the matching " +
      "publish tool in the same namespace; give the user the NEW URL and owner token. The old URL keeps its old content " +
      "until it expires." + (typeof republishUrl === "string" ? " Ignore republishUrl (browser-only)." : "") +
      (operation === "set KV" ? " For KV, read all keys with get_kv and publish them together with publish_kv." : ""));
  }
  return textResult(lines.join("\n"), true);
}

const PUBLIC_NAMESPACE = "public";

/** Private namespace slug `priv-<6 lowercase-alphanumeric chars>` sent when the caller omits `namespace`. */
function defaultPrivateNamespace(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let slug = "";
  for (let i = 0; i < 6; i++) {
    slug += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `priv-${slug}`;
}

/** Namespace sent to the API: the caller's value verbatim (including `public`), else a generated private slug. */
function resolveNamespace(namespace?: string): string {
  return namespace && namespace.length > 0 ? namespace : defaultPrivateNamespace();
}

const UNLISTED_NOTICE = "Private: not listed. Anyone with the link can open it.";
const LISTABLE_HINT = " Use namespace public to list it in the gallery and sitemap.";

const PROTECTED_UNLISTED_NOTICE = "Password: link + password. Not listed.";

const PUBLIC_NAMESPACE_LEAD =
  "namespace=public: listed in the public gallery and the sitemap, so Google, Bing and AI search can find and index it " +
  "and people can discover it. Use it for anything meant to be found or shared: docs, guides, demos, portfolios, reports, landing pages. ";
const PUBLIC_NAMESPACE_TAIL =
  " Anyone can find and read a public page: never put secrets, tokens or personal data there. " +
  "Omit (default): private. Unlisted and not indexed; anyone who has the link can still open it. ";
const NAMESPACE_FORMAT = "Lowercase only: 1-32 of a-z, 0-9, hyphen.";
/** `namespace` for publish_html and publish_file. */
const NAMESPACE_DESCRIPTION = PUBLIC_NAMESPACE_LEAD +
  "Public pages are served right on the brewpage.app domain, which gives them the strongest reach in search; " +
  "a page whose code needs its own origin (cookies, storage) gets its own subdomain automatically." +
  PUBLIC_NAMESPACE_TAIL + NAMESPACE_FORMAT;
const SITE_NAMESPACE_DESCRIPTION = PUBLIC_NAMESPACE_LEAD + "A site always gets its own subdomain." +
  PUBLIC_NAMESPACE_TAIL + NAMESPACE_FORMAT;
/** `namespace` for publish_json and publish_kv: data is never listed. */
const DATA_NAMESPACE_DESCRIPTION =
  "Omit (default): private. namespace=public: the shared public namespace. JSON and KV are never listed in the gallery " +
  "or indexed, in any namespace; anyone who has the link can open it. " + NAMESPACE_FORMAT;

const TTL_SCHEMA = z.union([z.number().positive(), z.string().min(1).max(32)]).optional().describe(
  "Requested TTL: days as a number, or a string such as '2w', '36h' or '1 month' (default 15 days). " +
  "The server rounds to whole days and clamps to the allowed range (1-30 by default; owner caps differ), reporting each adjustment in notices; use returned expiresAt."
);

const DELIVERY_MODE_SCHEMA = z.enum(["path", "subdomain"]).optional().describe(
  "Optional delivery choice for a fresh publication, independent of password/namespace. " +
  "Fresh sites and HTML-format pages outside public (including the default unlisted namespace) always use subdomain; an explicit path there still publishes, on subdomain, with a delivery notice. " +
  "Everything else in any namespace (Markdown, code/text, files, JSON, KV, public HTML) defaults to path (Promotion); public HTML may automatically choose subdomain for browser features. " +
  "When creation returns an existing publication, it keeps its actual mode and URL."
);

/** Site upload rules shared by publish_site and republish_site; current values come from get_limits. */
const SITE_LIMITS_TEXT =
  "Limits (call get_limits for current values): a request is at most 25 MB; a site at most 200 files, 5 MB per file and 20 MB in total; " +
  "each path at most 380 characters. System files (.DS_Store, __MACOSX/ and similar) are skipped and never count; files with an unsupported extension " +
  "or a too-long path are skipped and listed in notices. Entry: `entry`, else root index.html, else the shallowest HTML file. " +
  "Errors: 400 = a site limit exceeded (the message names it and what to do), invalid path or no HTML file; 413 = request over 25 MB, " +
  "too many files and form fields, or a file name/path too long; 422 = no servable file left.";

function hostingResponseLines(data: Record<string, unknown>): string[] {
  const fields = ["routingCohort", "deliveryMode", "requestedDeliveryMode", "effectiveDeliveryMode",
    "deliveryModeMatched", "modeLocked", "hostingVersion", "access", "managementLink"];
  const lines = fields.filter((field) => field in data).map((field) => `${field}: ${JSON.stringify(data[field])}`);
  if (data.routingCohort === "old") lines.push("Hosting: Existing link");
  if (data.deliveryModeMatched === false) lines.push("Requested hosting differs from the effective mode; use the returned URL.");
  lines.push(...deliveryReasonLines(data));
  lines.push(...noticeLines(data));
  return lines;
}

/** Server `notices` ({code, message}) on publish/update responses: each tolerated-input adjustment, verbatim. */
function noticeLines(data: Record<string, unknown>): string[] {
  if (!Array.isArray(data.notices)) return [];
  return data.notices
    .filter((n): n is { code: string; message: string } =>
      typeof n === "object" && n !== null && typeof n.code === "string" && typeof n.message === "string")
    .map((n) => `${WARNING_CODES.has(n.code) ? "WARNING" : "Notice"} (${n.code}): ${n.message}`);
}

const SIGN_IN_HINT = "Optional: sign in free (Google or any email) at https://account.brewpage.app to never lose your pages or tokens and to mint tokens that never expire. Not needed to publish.";

/** Private management link (present only when minted) and the public listing state. */
function ownerLinkLines(data: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (typeof data.manageUrl === "string" && data.manageUrl.length > 0) {
    lines.push(``, `MANAGE LINK (private): ${data.manageUrl}`, `Give it to the user privately; never publish it.`);
  }
  if (data.listed === true) lines.push(``, `VISIBILITY: public, listed. Hide: set_visibility listed=false`);
  return lines;
}

/** Optional delivery fields on HTML and hosting responses: why the mode was chosen, flagged or not applied. */
function deliveryReasonLines(data: Record<string, unknown>): string[] {
  const { deliveryModeReason: reason, deliveryNotice: notice } = data;
  const lines: string[] = [];
  if (typeof reason === "string" && reason.length > 0) lines.push(`deliveryModeReason: ${JSON.stringify(reason)}`);
  if (typeof notice === "string" && notice.length > 0) lines.push(`Delivery notice: ${notice}`);
  return lines;
}

function formatUpdateResponse(data: Record<string, unknown>): string {
  const lines = [
    `Updated successfully!`,
    ``,
    `URL: ${data.link || data.url || "N/A"}`,
  ];
  if (data.shortUrl) lines.push(`Short URL: ${data.shortUrl}`);
  lines.push(
    `Namespace: ${data.namespace || "N/A"}`,
    `ID: ${data.id || "N/A"}`
  );
  if (data.expiresAt) lines.push(`Expires: ${data.expiresAt}`);
  if (data.updatedAt) lines.push(`Updated: ${data.updatedAt}`);
  lines.push(...hostingResponseLines(data));
  return lines.join("\n");
}

/** Stdio source download: plain fetch; a non-2xx answer becomes the tool error. */
async function plainFetchSource(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch file from URL: ${res.status} ${res.statusText}`);
  return res.blob();
}

/** Fresh server with all tools; stdio builds one, stateless HTTP one per request. */
export function createServer(options: ServerOptions = {}): McpServer {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const userAgent = options.userAgent ?? USER_AGENT;
  const defaultOwnerToken = options.ownerToken;
  const fetchSource = options.fetchSource ?? plainFetchSource;
  const publicOrigin = options.publicOrigin ?? baseUrl;
  const apiFetch = options.fetch ?? fetch;
  const server = new McpServer({
    name: "brewpage-mcp",
    version: "1.14.1",
  });

  /** Caller argument first, then the configured default; `fromEnv` marks the configured one. */
  function ownerTokenFor(argument?: string): { token?: string; fromEnv: boolean } {
    if (argument && argument.length > 0) return { token: argument, fromEnv: false };
    return { token: defaultOwnerToken, fromEnv: defaultOwnerToken !== undefined };
  }

  /** Every BrewPage call identifies the client; source-file downloads go through fetchSource. */
  function bpFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers);
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    headers.set("User-Agent", userAgent);
    return apiFetch(url, { ...init, headers });
  }

  /** Owner token banner; the configured default is named, never repeated; none for a foreign existing publication.
   * Sign-in hint only for a token minted by this call (not `sent`, not the configured default). */
  function ownerTokenLines(data: Record<string, unknown>, purpose: string, sent?: string): string[] {
    const token = data.ownerToken;
    const extras = (data.result as { extras?: { isOwner?: unknown } } | null | undefined)?.extras;
    if (extras?.isOwner === false) return [``, `No owner token: an existing publication of another owner was returned.`];
    if (typeof token !== "string" || token.length === 0) return [];
    const shown = defaultOwnerToken !== undefined && token === defaultOwnerToken ? `${OWNER_TOKEN_ENV} (not repeated)` : token;
    return [
      ``,
      `===================================`,
      `OWNER TOKEN: ${shown}`,
      `===================================`,
      ``,
      `IMPORTANT: Save your owner token! You need it to ${purpose}. It cannot be recovered if lost.`,
      ...(token !== sent && token !== defaultOwnerToken ? [SIGN_IN_HINT] : []),
    ];
  }

  async function apiRequest(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
    responseType: "json" | "text" = "json"
  ): Promise<{ ok: boolean; status: number; data: unknown; headers: Headers }> {
    const url = `${baseUrl}${path}`;
    const res = await bpFetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = responseType === "text" ? await res.text() : await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data, headers: res.headers };
  }

  function formatPublishResponse(
    data: Record<string, unknown>,
    effectiveNamespace?: string,
    sentOwnerToken?: string,
    listable = true
  ): string {
    const lines = [
      `Published successfully!`,
      ``,
      `URL: ${data.link || data.url || "N/A"}`,
    ];
    if (data.shortUrl) lines.push(`Short URL: ${data.shortUrl}`);
    lines.push(
      `Namespace: ${data.namespace || "N/A"}`,
      `ID: ${data.id || "N/A"}`
    );
    if (data.expiresAt) lines.push(`Expires: ${data.expiresAt}`);
    lines.push(...hostingResponseLines(data));
    lines.push(...ownerTokenLines(data, "update or delete this resource later", sentOwnerToken));
    lines.push(...ownerLinkLines(data));
    const ns = ((data.namespace as string | undefined) ?? effectiveNamespace) || "";
    if (ns !== PUBLIC_NAMESPACE) {
      lines.push(``, data.access === "protected" ? PROTECTED_UNLISTED_NOTICE : UNLISTED_NOTICE + (listable ? LISTABLE_HINT : ""));
    }
    return lines.join("\n");
  }

  server.registerTool(
    "publish_html",
    {
      ...toolMeta("Publish HTML or Markdown page", ADDITIVE),
      description: "Publish HTML or Markdown content to BrewPage (repository default limit 5 MiB). Returns its primary share link and owner token. Supports password protection, custom TTL, optional filename, and an opt-in top toolbar (showTopBar). " +
        "When deliveryMode is omitted for a `public` page, the server may publish it on its own subdomain if the page needs browser features a BrewPage link does not provide; " +
        "the result then includes deliveryModeReason and a delivery notice. Markdown raw HTML is allowlisted: scripts, styles, event handlers, forms and embeds are removed. Always share the returned URL. " +
        MANAGE_URL_TEXT + " " + SECRETS,
      inputSchema: {
        content: z.string().describe("HTML or Markdown content to publish"),
        deliveryMode: DELIVERY_MODE_SCHEMA,
        format: z
          .string()
          .min(1)
          .default("HTML")
          .describe("Content format, default HTML. HTML or MARKDOWN; the server also maps aliases (md, text/markdown, file extensions, code languages) and detects unknown values from content, reporting the change in notices."),
        namespace: z
          .string()
          .optional()
          .describe(NAMESPACE_DESCRIPTION),
        password: z
          .string()
          .optional()
          .describe("Optional password to protect the page"),
        ttlDays: TTL_SCHEMA,
        filename: z
          .string()
          .max(200)
          .optional()
          .describe("Optional original filename (≤200 chars). Used as title fallback when no <title>/<h1>; immutable on update."),
        showTopBar: z
          .boolean()
          .optional()
          .describe("Add a thin top toolbar (filename + Download button + theme toggle) on the served page. Default: hidden."),
        ownerToken: z.string().optional().describe(CREATE_OWNER_TOKEN_DESCRIPTION),
      },
    },
    async ({ content, format, namespace, password, ttlDays, filename, showTopBar, deliveryMode, ownerToken }) => {
      const effectiveNamespace = resolveNamespace(namespace);
      const path = withQuery(apiPath("html"), [["ns", effectiveNamespace], ["format", format.toLowerCase()], ["ttl", ttlDays]]);
      const body: Record<string, unknown> = { content };
      if (filename) body.filename = filename;
      if (showTopBar !== undefined) body.showTopBar = showTopBar;

      const headers: Record<string, string> = {};
      if (password) headers["X-Password"] = password;
      if (deliveryMode) headers["X-Delivery-Mode"] = deliveryMode;
      const owner = ownerTokenFor(ownerToken).token;
      if (owner) headers["X-Owner-Token"] = owner;
      const { ok, data } = await apiRequest("POST", path, body, headers);

      if (!ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to publish: ${JSON.stringify(data)}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formatPublishResponse(data as Record<string, unknown>, effectiveNamespace, owner),
          },
        ],
      };
    }
  );

  server.registerTool(
    "publish_file",
    {
      ...toolMeta("Publish file from URL", ADDITIVE),
      description: "Upload a file to BrewPage via URL. Repository defaults: 5 MiB for files/audio, 20 MiB for video. Returns its primary share link and owner token. Does not expose password or TTL inputs. " +
        MANAGE_URL_TEXT + " " + SECRETS,
      inputSchema: {
        url: z.string().url().describe("URL of the file to upload"),
        deliveryMode: DELIVERY_MODE_SCHEMA,
        namespace: z
          .string()
          .optional()
          .describe(NAMESPACE_DESCRIPTION),
        filename: z.string().optional().describe("Custom filename (optional)"),
        ownerToken: z.string().optional().describe(CREATE_OWNER_TOKEN_DESCRIPTION),
      },
    },
    async ({ url: fileUrl, namespace, filename, deliveryMode, ownerToken }) => {
      const effectiveNamespace = resolveNamespace(namespace);
      const blob = await fetchSource(fileUrl);
      const formData = new FormData();
      formData.append(
        "file",
        blob,
        filename || fileUrl.split("/").pop() || "file"
      );
      const headers: Record<string, string> = {};
      if (deliveryMode) headers["X-Delivery-Mode"] = deliveryMode;
      const owner = ownerTokenFor(ownerToken).token;
      if (owner) headers["X-Owner-Token"] = owner;
      const res = await bpFetch(`${baseUrl}${withQuery(apiPath("files"), [["ns", effectiveNamespace]])}`, {
        method: "POST",
        headers,
        body: formData,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to upload file: ${JSON.stringify(data)}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formatPublishResponse(data as Record<string, unknown>, effectiveNamespace, owner),
          },
        ],
      };
    }
  );

  server.registerTool(
    "update_hosting",
    {
      ...toolMeta("Change delivery mode", ADDITIVE),
      description: "Change delivery mode for a NEW publication (not a site, not a non-public HTML-format page). Requires owner token; pass the current hostingVersion when known. Mismatches are reported, not rejected: a stale version still applies, and OLD links or forced subdomain modes stay unchanged; the result then carries a delivery notice. Content updates never change hosting.",
      inputSchema: {
        type: z.enum(["html", "file", "json", "kv"]).describe("Resource type; sites always stay on their own subdomain"),
        namespace: z.string().describe("Resource namespace; non-public HTML-format pages stay on subdomain"),
        id: z.string().describe("Resource ID"),
        ownerToken: z.string().optional().describe(OWNER_TOKEN_DESCRIPTION),
        deliveryMode: z.enum(["path", "subdomain"]).describe("path = Promotion; subdomain = Dedicated subdomain"),
        expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional().describe("Optional current hostingVersion from the server; a stale value still applies and the result says so"),
      },
    },
    async ({ type, namespace, id, ownerToken, deliveryMode, expectedVersion }) => {
      const auth = ownerTokenFor(ownerToken);
      if (!auth.token) return textResult(NO_OWNER_TOKEN, true);
      const path = apiPath(TYPE_SEGMENTS[type], namespace, id, "hosting");
      const { ok, status, data } = await apiRequest("PATCH", path, { deliveryMode, expectedVersion },
        { "X-Owner-Token": auth.token });
      if (!ok) return ownerFailure("update hosting", status, data, auth.fromEnv);
      return {
        content: [{ type: "text" as const, text: formatUpdateResponse(data as Record<string, unknown>) }],
      };
    }
  );

  server.registerTool(
    "delete_resource",
    {
      ...toolMeta("Delete publication", DESTRUCTIVE),
      description: "Delete a BrewPage resource (HTML page, site, KV store, JSON document, or file) using the owner token.",
      inputSchema: {
        type: z
          .enum(["html", "site", "kv", "json", "file"])
          .describe("Resource type to delete"),
        namespace: z.string().describe("Resource namespace"),
        id: z.string().describe("Resource ID"),
        ownerToken: z.string().optional().describe(OWNER_TOKEN_DESCRIPTION),
      },
    },
    async ({ type, namespace, id, ownerToken }) => {
      const auth = ownerTokenFor(ownerToken);
      if (!auth.token) return textResult(NO_OWNER_TOKEN, true);
      const path = apiPath(TYPE_SEGMENTS[type], namespace, id);
      const { ok, status, data } = await apiRequest("DELETE", path, undefined, { "X-Owner-Token": auth.token });
      if (!ok) return ownerFailure("delete", status, data, auth.fromEnv);

      return {
        content: [
          {
            type: "text" as const,
            text: `Successfully deleted ${type} resource: ${namespace}/${id}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_page",
    {
      ...toolMeta("Read page", READ_ONLY),
      description: "Fetch stored rendered HTML or format-specific code/text by namespace and ID. This reads API content, not the owner-only original-source endpoint or browser viewer. Protected reads use the password header.",
      inputSchema: {
        namespace: z.string().describe("Page namespace"),
        id: z.string().describe("Page ID"),
        password: z
          .string()
          .optional()
          .describe("Password if the page is protected"),
      },
    },
    async ({ namespace, id, password }) => {
      const headers: Record<string, string> = {};
      if (password) headers["X-Password"] = password;

      const { ok, status, data, headers: responseHeaders } = await apiRequest(
        "GET",
        apiPath("html", namespace, id),
        undefined,
        headers,
        "text"
      );

      if (!ok) {
        let errorData: unknown = data;
        try { errorData = JSON.parse(data as string); } catch {}
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch page (${status}): ${JSON.stringify(errorData)}`,
            },
          ],
          isError: true,
        };
      }

      const routingCohort = responseHeaders.get("X-Routing-Cohort");
      const deliveryMode = responseHeaders.get("X-Delivery-Mode");
      const hosting = { ...(routingCohort !== null ? { routingCohort } : {}), ...(deliveryMode !== null ? { deliveryMode } : {}) };
      const hasNewMarkers = (routingCohort !== null && routingCohort !== "old") || deliveryMode !== null;
      const lines = [
        `Page: ${namespace}/${id}`,
        `URL: ${responseHeaders.get("X-Canonical-Link") ?? (hasNewMarkers ? "N/A" : `${publicOrigin}/${namespace}/${id}`)}`,
        `Content-Type: ${responseHeaders.get("Content-Type") || "N/A"}`,
        ...hostingResponseLines(hosting),
        ``,
        `--- Content ---`,
        data as string,
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  server.registerTool(
    "get_stats",
    {
      ...toolMeta("Get platform statistics", READ_ONLY),
      description: "Get BrewPage platform-wide usage statistics including page count, file count, and storage usage. Counts use disjoint split: alive_public + alive_private + deleted == total. Optional `tz` shifts the 'today' boundary to the given IANA zone (default UTC).",
      inputSchema: {
        tz: z
          .string()
          .optional()
          .describe(
            "Optional IANA timezone id for the 'today' boundary, e.g. 'Europe/Lisbon'. Defaults to UTC. Invalid value falls back to UTC silently."
          ),
      },
    },
    async ({ tz }) => {
      const path = withQuery(apiPath("stats"), [["tz", tz || undefined]]);
      const { ok, data } = await apiRequest("GET", path);

      if (!ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch stats: ${JSON.stringify(data)}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `BrewPage Platform Statistics:\n\n${JSON.stringify(data, null, 2)}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "publish_site",
    {
      ...toolMeta("Publish site", ADDITIVE),
      description: "Publish an HTML site to BrewPage. Single-page: pass `entryContent`. Multi-page: pass `files` (array of `{path, content}`). Optional `entry` overrides default `index.html`. Use its returned primary link and retain the owner token. " + SITE_LIMITS_TEXT +
        " " + MANAGE_URL_TEXT + " " + SECRETS,
      inputSchema: {
        deliveryMode: DELIVERY_MODE_SCHEMA,
        entryContent: z
          .string()
          .optional()
          .describe("HTML content for a single-page site (entry file). Mutually exclusive with `files`."),
        files: z
          .array(z.object({ path: z.string(), content: z.string() }))
          .optional()
          .describe("Multi-file site: array of `{path, content}`. Mutually exclusive with `entryContent`."),
        entry: z
          .string()
          .optional()
          .describe("Entry file path, default index.html"),
        namespace: z
          .string()
          .optional()
          .describe(SITE_NAMESPACE_DESCRIPTION),
        password: z
          .string()
          .optional()
          .describe("Optional password to protect the site"),
        ttlDays: TTL_SCHEMA,
        ownerToken: z.string().optional().describe(CREATE_OWNER_TOKEN_DESCRIPTION),
      },
    },
    async ({ entryContent, files, entry, namespace, password, ttlDays, ownerToken, deliveryMode }) => {
      const hasEntry = typeof entryContent === "string";
      const hasFiles = Array.isArray(files) && files.length > 0;
      if (hasEntry === hasFiles) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Provide exactly one of `entryContent` (single-page) or `files` (multi-page).",
            },
          ],
          isError: true,
        };
      }

      const formData = new FormData();
      if (hasFiles) {
        for (const f of files!) {
          formData.append("files", new Blob([f.content], { type: "text/html" }), f.path);
          formData.append("paths", f.path);
        }
      } else {
        const entryBlob = new Blob([entryContent!], { type: "text/html" });
        const entryName = entry || "index.html";
        formData.append("files", entryBlob, entryName);
        formData.append("paths", entryName);
      }
      const headers: Record<string, string> = {};
      if (password) headers["X-Password"] = password;
      const owner = ownerTokenFor(ownerToken).token;
      if (owner) headers["X-Owner-Token"] = owner;
      if (deliveryMode) headers["X-Delivery-Mode"] = deliveryMode;

      const effectiveNamespace = resolveNamespace(namespace);
      const url = baseUrl + withQuery(apiPath("sites"),
        [["entry", entry || undefined], ["ns", effectiveNamespace], ["ttl", ttlDays || undefined]]);
      const res = await bpFetch(url, { method: "POST", headers, body: formData });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to publish site: ${JSON.stringify(data)}`,
            },
          ],
          isError: true,
        };
      }

      const site = data as Record<string, unknown>;
      const lines = [
        `Site published successfully!`,
        ``,
        `URL: ${site.link || "N/A"}`,
        `Namespace: ${site.namespace || "N/A"}`,
        `ID: ${site.id || "N/A"}`,
        `Entry file: ${site.entryFile || "index.html"}`,
        `Files: ${site.fileCount || 1}`,
      ];
      if (site.totalSizeBytes !== undefined) lines.push(`Size: ${site.totalSizeBytes} bytes`);
      if (site.ownerLink) lines.push(`Owner link: ${site.ownerLink}`);
      if (Array.isArray(site.tags) && site.tags.length) lines.push(`Tags: ${(site.tags as string[]).join(", ")}`);
      if (site.expiresAt) lines.push(`Expires: ${site.expiresAt}`);
      lines.push(...hostingResponseLines(site));
      lines.push(...ownerTokenLines(site, "view info or delete this site", owner));
      lines.push(...ownerLinkLines(site));
      const ns = ((site.namespace as string | undefined) || effectiveNamespace) || "";
      if (ns !== PUBLIC_NAMESPACE) {
        lines.push(``, site.access === "protected" ? PROTECTED_UNLISTED_NOTICE : UNLISTED_NOTICE + LISTABLE_HINT);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  server.registerTool(
    "republish_site",
    {
      ...toolMeta("Republish site", DESTRUCTIVE),
      description: "Republish (full-replace) an existing multi-file BrewPage site in place at the SAME URL/ID. Requires owner token. The uploaded bundle becomes the complete new file set — files absent from it are removed, new files added, matching files overwritten. Single-page: pass `entryContent`. Multi-page: pass `files` (array of `{path, content}`). Optional `entry` overrides the default `index.html`. Republishing preserves existing expiry." + OLD_READ_ONLY_TEXT + " " + SITE_LIMITS_TEXT,
      inputSchema: {
        namespace: z.string().describe("Site namespace"),
        id: z.string().describe("Site ID"),
        ownerToken: z.string().optional().describe(OWNER_TOKEN_DESCRIPTION),
        entryContent: z
          .string()
          .optional()
          .describe("HTML content for a single-page site (entry file). Mutually exclusive with `files`."),
        files: z
          .array(z.object({ path: z.string(), content: z.string() }))
          .optional()
          .describe("Multi-file site: array of `{path, content}`. Mutually exclusive with `entryContent`."),
        entry: z
          .string()
          .optional()
          .describe("Entry file path, default index.html"),
        ttlDays: TTL_SCHEMA.describe("Ignored: republishing keeps the existing expiry; a supplied value comes back as a ttl-ignored notice."),
        tags: z
          .array(z.string())
          .optional()
          .describe("Optional tags (replaces the site's existing tags)"),
      },
    },
    async ({ namespace, id, ownerToken, entryContent, files, entry, ttlDays, tags }) => {
      const hasEntry = typeof entryContent === "string";
      const hasFiles = Array.isArray(files) && files.length > 0;
      if (hasEntry === hasFiles) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Provide exactly one of `entryContent` (single-page) or `files` (multi-page).",
            },
          ],
          isError: true,
        };
      }

      const formData = new FormData();
      if (hasFiles) {
        for (const f of files!) {
          formData.append("files", new Blob([f.content], { type: "text/html" }), f.path);
          formData.append("paths", f.path);
        }
      } else {
        const entryBlob = new Blob([entryContent!], { type: "text/html" });
        const entryName = entry || "index.html";
        formData.append("files", entryBlob, entryName);
        formData.append("paths", entryName);
      }

      const auth = ownerTokenFor(ownerToken);
      if (!auth.token) return textResult(NO_OWNER_TOKEN, true);
      const headers: Record<string, string> = { "X-Owner-Token": auth.token };

      const url = baseUrl + withQuery(apiPath("sites", namespace, id), [["entry", entry || undefined],
        ["ttl", ttlDays || undefined], ["tags", tags && tags.length ? tags.join(",") : undefined]]);
      const res = await bpFetch(url, { method: "PUT", headers, body: formData });
      const data = await res.json().catch(() => null);

      if (!res.ok) return ownerFailure("republish site", res.status, data, auth.fromEnv);

      const site = data as Record<string, unknown>;
      const lines = [
        `Site republished successfully (full replace)!`,
        ``,
        `URL: ${site.link || "N/A"}`,
        `Namespace: ${site.namespace || namespace}`,
        `ID: ${site.id || id}`,
        `Entry file: ${site.entryFile || "index.html"}`,
        `Files: ${site.fileCount || 1}`,
      ];
      if (site.totalSizeBytes !== undefined) lines.push(`Size: ${site.totalSizeBytes} bytes`);
      if (site.ownerLink) lines.push(`Owner link: ${site.ownerLink}`);
      if (Array.isArray(site.tags) && site.tags.length) lines.push(`Tags: ${(site.tags as string[]).join(", ")}`);
      if (site.expiresAt) lines.push(`Expires: ${site.expiresAt}`);
      if (site.result) lines.push(`Result: ${site.result}`);
      lines.push(...hostingResponseLines(site));
      if (site.visibilityNotice) lines.push(``, String(site.visibilityNotice));

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  server.registerTool(
    "update_html",
    {
      ...toolMeta("Update page", DESTRUCTIVE),
      description: "Update an existing BrewPage HTML/Markdown page. Requires owner token. Returns the updated page metadata. " +
        "The link and delivery mode never change on update; an advisory deliveryModeReason and delivery notice are included when the new content uses browser features that may not work fully on a BrewPage link." + OLD_READ_ONLY_TEXT,
      inputSchema: {
        namespace: z.string().describe("Page namespace"),
        id: z.string().describe("Page ID"),
        content: z.string().describe("New HTML or Markdown content"),
        ownerToken: z.string().optional().describe(OWNER_TOKEN_DESCRIPTION),
        format: z
          .string()
          .optional()
          .describe(
            "Content format. Accepts (case-insensitive on html/markdown): 'html', 'markdown'/'md', or a code language — yaml, json, xml, csv, tsv, log, toml, ini, sql, sh, bat, env, javascript, typescript, tsx, jsx, css, properties, docker, txt. Omit to preserve the stored format."
          ),
      },
    },
    async ({ namespace, id, content, ownerToken, format }) => {
      const body: Record<string, unknown> = { content };
      if (format) body.format = format;

      const auth = ownerTokenFor(ownerToken);
      if (!auth.token) return textResult(NO_OWNER_TOKEN, true);
      const path = apiPath("html", namespace, id);
      const { ok, status, data } = await apiRequest("PUT", path, body, {
        "X-Owner-Token": auth.token,
      });

      if (!ok) return ownerFailure("update HTML", status, data, auth.fromEnv);

      return {
        content: [
          {
            type: "text" as const,
            text: formatUpdateResponse(data as Record<string, unknown>),
          },
        ],
      };
    }
  );

  server.registerTool(
    "publish_json",
    {
      ...toolMeta("Publish JSON document", ADDITIVE),
      description: "Publish a JSON document to BrewPage (repository default limit 1 MiB). Accepts a JSON object, array, or a JSON-encoded string containing any valid JSON, including scalars/null. Returns its primary share link and owner token. " +
        MANAGE_URL_TEXT + " " + SECRETS,
      inputSchema: {
        deliveryMode: DELIVERY_MODE_SCHEMA,
        json: z
          .union([z.string(), z.record(z.unknown()), z.array(z.unknown())])
          .describe("JSON document to publish (object, array, or JSON-encoded string)"),
        namespace: z
          .string()
          .optional()
          .describe(DATA_NAMESPACE_DESCRIPTION),
        password: z
          .string()
          .optional()
          .describe("Optional password to protect the document"),
        ttlDays: TTL_SCHEMA,
        tags: z
          .array(z.string())
          .optional()
          .describe("Optional tags for the document"),
        ownerToken: z.string().optional().describe(CREATE_OWNER_TOKEN_DESCRIPTION),
      },
    },
    async ({ json, namespace, password, ttlDays, tags, ownerToken, deliveryMode }) => {
      const jsonString = typeof json === "string" ? json : JSON.stringify(json);

      const effectiveNamespace = resolveNamespace(namespace);
      const path = withQuery(apiPath("json"),
        [["ns", effectiveNamespace], ["ttl", ttlDays], ...(tags ?? []).map((t): [string, string] => ["tags", t])]);

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (password) headers["X-Password"] = password;
      const owner = ownerTokenFor(ownerToken).token;
      if (owner) headers["X-Owner-Token"] = owner;
      if (deliveryMode) headers["X-Delivery-Mode"] = deliveryMode;

      const res = await bpFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: jsonString,
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to publish JSON (${res.status}): ${JSON.stringify(data)}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formatPublishResponse(data as Record<string, unknown>, effectiveNamespace, owner, false),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_json",
    {
      ...toolMeta("Read JSON document", READ_ONLY),
      description: "Fetch a published BrewPage JSON document by namespace and ID.",
      inputSchema: {
        namespace: z.string().describe("Document namespace"),
        id: z.string().describe("Document ID"),
        password: z
          .string()
          .optional()
          .describe("Password if the document is protected"),
      },
    },
    async ({ namespace, id, password }) => {
      const headers: Record<string, string> = {};
      if (password) headers["X-Password"] = password;

      const path = apiPath("json", namespace, id);
      const { ok, status, data } = await apiRequest(
        "GET",
        path,
        undefined,
        headers
      );

      if (!ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch JSON (${status}): ${JSON.stringify(data)}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "update_json",
    {
      ...toolMeta("Update JSON document", DESTRUCTIVE),
      description: "Update an existing BrewPage JSON document. Requires owner token. Accepts a JSON object, array, or a JSON-encoded string." + OLD_READ_ONLY_TEXT,
      inputSchema: {
        namespace: z.string().describe("Document namespace"),
        id: z.string().describe("Document ID"),
        json: z
          .union([z.string(), z.record(z.unknown()), z.array(z.unknown())])
          .describe("New JSON document (object, array, or JSON-encoded string)"),
        ownerToken: z.string().optional().describe(OWNER_TOKEN_DESCRIPTION),
      },
    },
    async ({ namespace, id, json, ownerToken }) => {
      const jsonString = typeof json === "string" ? json : JSON.stringify(json);
      const auth = ownerTokenFor(ownerToken);
      if (!auth.token) return textResult(NO_OWNER_TOKEN, true);

      const url = baseUrl + apiPath("json", namespace, id);
      const res = await bpFetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Owner-Token": auth.token,
        },
        body: jsonString,
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) return ownerFailure("update JSON", res.status, data, auth.fromEnv);

      return {
        content: [
          {
            type: "text" as const,
            text: formatUpdateResponse(data as Record<string, unknown>),
          },
        ],
      };
    }
  );

  server.registerTool(
    "publish_kv",
    {
      ...toolMeta("Publish KV entry", ADDITIVE),
      description: "Publish a key/value entry to BrewPage. Creates a KV store; the entry is addressed by (namespace, id, key). Repository defaults: 1 MiB per value, 1,000 keys per store; the key name `hosting` is reserved. Returns its primary share link and owner token. " +
        MANAGE_URL_TEXT + " " + SECRETS,
      inputSchema: {
        deliveryMode: DELIVERY_MODE_SCHEMA,
        key: z.string().describe("KV key (first part of the (namespace, id, key) addressing tuple)"),
        value: z.string().describe("KV value"),
        namespace: z
          .string()
          .optional()
          .describe(DATA_NAMESPACE_DESCRIPTION),
        password: z
          .string()
          .optional()
          .describe("Optional password to protect the KV store"),
        ttlDays: TTL_SCHEMA,
        tags: z
          .array(z.string())
          .optional()
          .describe("Optional tags for the KV entry"),
        ownerToken: z.string().optional().describe(CREATE_OWNER_TOKEN_DESCRIPTION),
      },
    },
    async ({ key, value, namespace, password, ttlDays, tags, ownerToken, deliveryMode }) => {
      const body: Record<string, unknown> = { key, value };

      const effectiveNamespace = resolveNamespace(namespace);
      const path = withQuery(apiPath("kv"),
        [["ns", effectiveNamespace], ["ttl", ttlDays], ...(tags ?? []).map((t): [string, string] => ["tags", t])]);

      const headers: Record<string, string> = {};
      if (password) headers["X-Password"] = password;
      const owner = ownerTokenFor(ownerToken).token;
      if (owner) headers["X-Owner-Token"] = owner;
      if (deliveryMode) headers["X-Delivery-Mode"] = deliveryMode;

      const { ok, status, data } = await apiRequest(
        "POST",
        path,
        body,
        headers
      );

      if (!ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to publish KV (${status}): ${JSON.stringify(data)}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formatPublishResponse(data as Record<string, unknown>, effectiveNamespace, owner, false),
          },
        ],
      };
    }
  );

  server.registerTool(
    "set_kv",
    {
      ...toolMeta("Set KV value", DESTRUCTIVE),
      description: "Set or update a key in an existing BrewPage KV store. Requires owner token. The key name `hosting` is reserved." + OLD_READ_ONLY_TEXT,
      inputSchema: {
        namespace: z.string().describe("KV store namespace"),
        id: z.string().describe("KV store ID"),
        key: z.string().describe("Key to set"),
        value: z.string().describe("Value to assign to the key"),
        ownerToken: z.string().optional().describe(OWNER_TOKEN_DESCRIPTION),
      },
    },
    async ({ namespace, id, key, value, ownerToken }) => {
      const body: Record<string, unknown> = { value };
      const auth = ownerTokenFor(ownerToken);
      if (!auth.token) return textResult(NO_OWNER_TOKEN, true);

      const path = apiPath("kv", namespace, id, key);
      const { ok, status, data } = await apiRequest("PUT", path, body, {
        "X-Owner-Token": auth.token,
      });

      if (!ok) return ownerFailure("set KV", status, data, auth.fromEnv);

      return {
        content: [
          {
            type: "text" as const,
            text: formatUpdateResponse(data as Record<string, unknown>),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_kv",
    {
      ...toolMeta("Read KV value", READ_ONLY),
      description: "Fetch a value from a BrewPage KV store by namespace, ID, and key.",
      inputSchema: {
        namespace: z.string().describe("KV store namespace"),
        id: z.string().describe("KV store ID"),
        key: z.string().describe("Key to fetch"),
        password: z
          .string()
          .optional()
          .describe("Password if the KV store is protected"),
      },
    },
    async ({ namespace, id, key, password }) => {
      const headers: Record<string, string> = {};
      if (password) headers["X-Password"] = password;

      const path = apiPath("kv", namespace, id, key);
      const { ok, status, data } = await apiRequest(
        "GET",
        path,
        undefined,
        headers
      );

      if (!ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch KV (${status}): ${JSON.stringify(data)}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_limits",
    {
      ...toolMeta("Get upload limits", READ_ONLY),
      description: "Get the current BrewPage upload limits (GET /api/limits): request size, site file count, per-file and total size, " +
        "ZIP expansion, path and name lengths, TTL default/maximum, allowed file extensions and skipped system files. Sizes are bytes. " +
        `With ${OWNER_TOKEN_ENV} set: also reach (token|profile) and ownerMaxTtlDays. Call it before publishing a large or multi-file site.`,
      inputSchema: {},
    },
    async () => {
      const headers: Record<string, string> = defaultOwnerToken ? { "X-Owner-Token": defaultOwnerToken } : {};
      const { ok, status, data } = await apiRequest("GET", "/api/limits", undefined, headers);

      if (!ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch limits (${status}): ${JSON.stringify(data)}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `BrewPage upload limits (bytes):\n\n${JSON.stringify(data, null, 2)}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "search_gallery",
    {
      ...toolMeta("Search public gallery", READ_ONLY),
      description: "Search the BrewPage public gallery. Optional filters: text query, pagination, sort, and 'mine' (owner-scoped, requires owner token).",
      inputSchema: {
        q: z.string().optional().describe("Free-text search query"),
        page: z
          .number()
          .int()
          .min(1)
          .default(1)
          .describe("Page number (1-based; default 1)"),
        size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Page size (1-100; backend caps at 100)"),
        sort: z
          .enum(["date", "views"])
          .optional()
          .describe("Sort order: 'date' or 'views'"),
        mine: z
          .boolean()
          .optional()
          .describe("If true, restricts results to entries owned by the supplied owner token"),
        ownerToken: z
          .string()
          .optional()
          .describe(`Owner token; only sent as X-Owner-Token when 'mine' is true. Default: ${OWNER_TOKEN_ENV}.`),
      },
    },
    async ({ q, page, size, sort, mine, ownerToken }) => {
      const auth = ownerTokenFor(ownerToken);
      if (mine === true && !auth.token) return textResult(NO_OWNER_TOKEN, true);
      const path = withQuery(apiPath("gallery"), [["q", q], ["page", page], ["size", size],
        ["sort", sort || undefined], ["mine", mine === true ? "true" : undefined]]);

      const headers: Record<string, string> = {};
      if (mine === true && auth.token) headers["X-Owner-Token"] = auth.token;

      const { ok, status, data } = await apiRequest(
        "GET",
        path,
        undefined,
        headers
      );

      if (!ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to search gallery (${status}): ${JSON.stringify(data)}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "set_visibility",
    {
      ...toolMeta("Set gallery visibility", ADDITIVE),
      description: "Hide or show a public publication in the gallery and sitemap. Link unchanged.",
      inputSchema: {
        type: z.enum(["html", "site", "file", "json", "kv"]).describe("Publication type; only public html, site and file can be listed"),
        namespace: z.string().describe("Publication namespace"),
        id: z.string().describe("Publication ID"),
        listed: z.boolean().describe("false = hide, true = show"),
        ownerToken: z.string().optional().describe(OWNER_TOKEN_DESCRIPTION),
      },
    },
    async ({ type, namespace, id, listed, ownerToken }) => {
      const auth = ownerTokenFor(ownerToken);
      if (!auth.token) return textResult(NO_OWNER_TOKEN, true);
      const path = apiPath(TYPE_SEGMENTS[type], namespace, id, "visibility");
      const { ok, status, data } = await apiRequest("POST", path, { listed }, { "X-Owner-Token": auth.token });
      if (!ok) return ownerFailure("set visibility", status, data, auth.fromEnv);
      const result = data as Record<string, unknown>;
      return textResult([`LISTED: ${result.listed} · link unchanged`, ...noticeLines(result)].join("\n"));
    }
  );

  server.registerTool(
    "bind_token",
    {
      ...toolMeta("Add token to profile", ADDITIVE),
      description: "Add an owner token to your BrewPage profile (as publish). Needs an admin token of that profile.",
      inputSchema: {
        token: z.string().describe("Owner token to add"),
        ownerToken: z.string().optional().describe(`Admin token of the profile. Default: ${OWNER_TOKEN_ENV}.`),
      },
    },
    async ({ token, ownerToken }) => {
      const auth = ownerTokenFor(ownerToken);
      if (!auth.token) return textResult(NO_OWNER_TOKEN, true);
      const { ok, status, data } = await apiRequest("POST", "/api/owner-token/bind", { token }, { "X-Owner-Token": auth.token });
      if (!ok) return textResult(`Failed to bind token (${status}): ${JSON.stringify(data)}`, true);
      const result = data as Record<string, unknown>;
      return textResult(`BOUND ${maskToken(token)} · ${result.active}/${result.max} active`);
    }
  );

  server.registerTool(
    "mint_token",
    {
      ...toolMeta("Mint profile token", ADDITIVE),
      description: "Mint a new profile token with an admin token; the new token is shown once. Scope publish (default) or admin; expiry 30d, 90d, 1y or never.",
      inputSchema: {
        label: z.string().optional().describe("Optional label shown in the profile"),
        scope: z.enum(["publish", "admin"]).optional().describe("publish (default) or admin (can manage tokens)"),
        expiresIn: z.enum(["30d", "90d", "1y", "never"]).optional().describe("Default: admin 90d, publish never"),
        ownerToken: z.string().optional().describe(`Admin token of the profile. Default: ${OWNER_TOKEN_ENV}.`),
      },
    },
    async ({ label, scope, expiresIn, ownerToken }) => {
      const auth = ownerTokenFor(ownerToken);
      if (!auth.token) return textResult(NO_OWNER_TOKEN, true);
      const { ok, status, data } = await apiRequest("POST", "/api/owner-token/mint", { label, scope, expiresIn },
        { "X-Owner-Token": auth.token });
      if (!ok) return textResult(`Failed to mint token (${status}): ${JSON.stringify(data)}`, true);
      const result = data as Record<string, unknown>;
      return textResult([
        `MINTED · ${result.scope} · expires ${result.expiresAt ?? "never"}`,
        ``,
        `===================================`,
        `NEW TOKEN (shown once): ${result.token}`,
        `===================================`,
        ``,
        `Save it now; it cannot be shown again. Never publish it.`,
      ].join("\n"));
    }
  );

  return server;
}
