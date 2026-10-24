#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.BREWPAGE_URL || "https://brewpage.app";
const USER_AGENT = "brewpage-mcp/1.13.0";

const server = new McpServer({
  name: "brewpage-mcp",
  version: "1.13.0",
});

const OWNER_TOKEN_SHAPE = /^[A-Za-z0-9]{32}$/;
const OWNER_TOKEN_ENV = "BREWPAGE_OWNER_TOKEN";

/** Optional default owner token for every call; a malformed value is ignored with one stderr line. */
const ENV_OWNER_TOKEN = ((): string | undefined => {
  const raw = process.env[OWNER_TOKEN_ENV]?.trim();
  if (!raw) return undefined;
  if (OWNER_TOKEN_SHAPE.test(raw)) return raw;
  console.error(`${OWNER_TOKEN_ENV} ignored: expected 32 letters/digits.`);
  return undefined;
})();

const NO_OWNER_TOKEN = `No owner token: pass ownerToken or set ${OWNER_TOKEN_ENV}.`;
const CREATE_OWNER_TOKEN_DESCRIPTION = `Optional. Default: ${OWNER_TOKEN_ENV}, else a new token per create.`;
const OWNER_TOKEN_DESCRIPTION = `Owner token from create. Default: ${OWNER_TOKEN_ENV}.`;
const SECRETS = "Secrets allowed; likely ones are flagged in notices. For a secret: private namespace + password.";
const MANAGE_URL_TEXT = "Returns manageUrl (private): give it to the user privately; never publish it.";
/** Notice codes the agent must relay to the user. */
const WARNING_CODES = new Set(["secret-detected", "manage-link-disabled"]);
/** MCP type name -> REST path segment. */
const TYPE_SEGMENTS: Record<string, string> = { html: "html", site: "sites", file: "files", json: "json", kv: "kv" };

/** Caller argument first, then the configured default; `fromEnv` marks the configured one. */
function ownerTokenFor(argument?: string): { token?: string; fromEnv: boolean } {
  if (argument && argument.length > 0) return { token: argument, fromEnv: false };
  return { token: ENV_OWNER_TOKEN, fromEnv: ENV_OWNER_TOKEN !== undefined };
}

/** Only the last 4 characters: tokens never reach a transcript in full. */
function maskToken(token: string): string {
  return `…${token.slice(-4)}`;
}

function textResult(text: string, isError = false) {
  return isError ? { content: [{ type: "text" as const, text }], isError: true } : { content: [{ type: "text" as const, text }] };
}

/** Owner-tool failure: the server answer verbatim plus a hint for a plain wrong-token 403. */
function ownerFailure(operation: string, status: number, data: unknown, fromEnv: boolean) {
  const lines = [`Failed to ${operation} (${status}): ${JSON.stringify(data)}`];
  const code = (data as { code?: unknown } | null)?.code;
  if (status === 403 && (code === undefined || code === "OWNER_AUTHORIZATION_FAILED")) {
    lines.push(`Wrong owner token for this publication. Use ownerToken from create.${fromEnv ? ` Sent: ${OWNER_TOKEN_ENV}.` : ""}`);
  }
  return textResult(lines.join("\n"), true);
}

/** Every BrewPage call identifies the client; source-file downloads use plain fetch. */
function bpFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", USER_AGENT);
  return fetch(url, { ...init, headers });
}

const PUBLIC_NAMESPACE = "public";

/**
 * Generate a short, unlisted private namespace slug used when the caller omits
 * `namespace`. Sending an explicit non-public ns prevents the backend from
 * applying its `public` default and making the content discovery-eligible.
 * Format: `priv-<6 lowercase-alphanumeric chars>`.
 */
function defaultPrivateNamespace(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let slug = "";
  for (let i = 0; i < 6; i++) {
    slug += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `priv-${slug}`;
}

/**
 * Resolve the effective namespace actually sent to the API: the caller's value
 * verbatim when provided (including `public`), otherwise a generated private slug.
 */
function resolveNamespace(namespace?: string): string {
  return namespace && namespace.length > 0 ? namespace : defaultPrivateNamespace();
}

const UNLISTED_NOTICE =
  "Private: not listed. Anyone with the link can open it. Use namespace public for gallery & search.";

const PROTECTED_UNLISTED_NOTICE = "Password: link + password. Not listed.";

const NAMESPACE_DESCRIPTION =
  "Optional. Omit to generate an unlisted namespace: anyone with its unpassworded link can read it, " +
  "but it is excluded from gallery/search. Pass a custom namespace to group unlisted content, " +
  "or pass `public` ONLY when the user explicitly wants gallery/search eligibility. " +
  "Password-protected content stays excluded; unlisted, protected or otherwise ineligible native responses carry noindex; eligible public HTML, sites and files may permit indexing. " +
  "Lowercase only: 1-32 of a-z, 0-9, hyphen.";

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

/** Owner token banner; the configured default is named, never repeated; none for a foreign existing publication. */
function ownerTokenLines(data: Record<string, unknown>, purpose: string): string[] {
  const token = data.ownerToken;
  const extras = (data.result as { extras?: { isOwner?: unknown } } | null | undefined)?.extras;
  if (extras?.isOwner === false) return [``, `No owner token: an existing publication of another owner was returned.`];
  if (typeof token !== "string" || token.length === 0) return [];
  const shown = ENV_OWNER_TOKEN !== undefined && token === ENV_OWNER_TOKEN ? `${OWNER_TOKEN_ENV} (not repeated)` : token;
  return [
    ``,
    `===================================`,
    `OWNER TOKEN: ${shown}`,
    `===================================`,
    ``,
    `IMPORTANT: Save your owner token! You need it to ${purpose}. It cannot be recovered if lost.`,
  ];
}

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

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
  responseType: "json" | "text" = "json"
): Promise<{ ok: boolean; status: number; data: unknown; headers: Headers }> {
  const url = `${BASE_URL}${path}`;
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
  effectiveNamespace?: string
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
  lines.push(...ownerTokenLines(data, "update or delete this resource later"));
  lines.push(...ownerLinkLines(data));
  const ns = ((data.namespace as string | undefined) ?? effectiveNamespace) || "";
  if (ns !== PUBLIC_NAMESPACE) {
    lines.push(``, data.access === "protected" ? PROTECTED_UNLISTED_NOTICE : UNLISTED_NOTICE);
  }
  return lines.join("\n");
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

server.tool(
  "publish_html",
  "Publish HTML or Markdown content to BrewPage (repository default limit 5 MiB). Returns its primary share link and owner token. Supports password protection, custom TTL, optional filename, and an opt-in top toolbar (showTopBar). " +
    "When deliveryMode is omitted for a `public` page, the server may publish it on its own subdomain if the page needs browser features a BrewPage link does not provide; " +
    "the result then includes deliveryModeReason and a delivery notice. Markdown raw HTML is allowlisted: scripts, styles, event handlers, forms and embeds are removed. Always share the returned URL. " +
    MANAGE_URL_TEXT + " " + SECRETS,
  {
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
  async ({ content, format, namespace, password, ttlDays, filename, showTopBar, deliveryMode, ownerToken }) => {
    const effectiveNamespace = resolveNamespace(namespace);
    const qsParams = [`ns=${encodeURIComponent(effectiveNamespace)}`, `format=${encodeURIComponent(format.toLowerCase())}`];
    if (ttlDays !== undefined) qsParams.push(`ttl=${encodeURIComponent(String(ttlDays))}`);
    const body: Record<string, unknown> = { content };
    if (filename) body.filename = filename;
    if (showTopBar !== undefined) body.showTopBar = showTopBar;

    const headers: Record<string, string> = {};
    if (password) headers["X-Password"] = password;
    if (deliveryMode) headers["X-Delivery-Mode"] = deliveryMode;
    const owner = ownerTokenFor(ownerToken).token;
    if (owner) headers["X-Owner-Token"] = owner;
    const { ok, data } = await apiRequest("POST", `/api/html?${qsParams.join("&")}`, body, headers);

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
          text: formatPublishResponse(data as Record<string, unknown>, effectiveNamespace),
        },
      ],
    };
  }
);

server.tool(
  "publish_file",
  "Upload a file to BrewPage via URL. Repository defaults: 5 MiB for files/audio, 20 MiB for video. Returns its primary share link and owner token. Does not expose password or TTL inputs. " +
    MANAGE_URL_TEXT + " " + SECRETS,
  {
    url: z.string().url().describe("URL of the file to upload"),
    deliveryMode: DELIVERY_MODE_SCHEMA,
    namespace: z
      .string()
      .optional()
      .describe(NAMESPACE_DESCRIPTION),
    filename: z.string().optional().describe("Custom filename (optional)"),
    ownerToken: z.string().optional().describe(CREATE_OWNER_TOKEN_DESCRIPTION),
  },
  async ({ url: fileUrl, namespace, filename, deliveryMode, ownerToken }) => {
    const effectiveNamespace = resolveNamespace(namespace);
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to fetch file from URL: ${fileRes.status} ${fileRes.statusText}`,
          },
        ],
        isError: true,
      };
    }

    const blob = await fileRes.blob();
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
    const res = await bpFetch(`${BASE_URL}/api/files?ns=${encodeURIComponent(effectiveNamespace)}`, {
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
          text: formatPublishResponse(data as Record<string, unknown>, effectiveNamespace),
        },
      ],
    };
  }
);

server.tool(
  "update_hosting",
  "Change delivery mode for a NEW publication (not a site, not a non-public HTML-format page). Requires owner token; pass the current hostingVersion when known. Mismatches are reported, not rejected: a stale version still applies, and OLD links or forced subdomain modes stay unchanged; the result then carries a delivery notice. Content updates never change hosting.",
  {
    type: z.enum(["html", "file", "json", "kv"]).describe("Resource type; sites always stay on their own subdomain"),
    namespace: z.string().describe("Resource namespace; non-public HTML-format pages stay on subdomain"),
    id: z.string().describe("Resource ID"),
    ownerToken: z.string().optional().describe(OWNER_TOKEN_DESCRIPTION),
    deliveryMode: z.enum(["path", "subdomain"]).describe("path = Promotion; subdomain = Dedicated subdomain"),
    expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional().describe("Optional current hostingVersion from the server; a stale value still applies and the result says so"),
  },
  async ({ type, namespace, id, ownerToken, deliveryMode, expectedVersion }) => {
    const auth = ownerTokenFor(ownerToken);
    if (!auth.token) return textResult(NO_OWNER_TOKEN, true);
    const path = `/api/${TYPE_SEGMENTS[type]}/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/hosting`;
    const { ok, status, data } = await apiRequest("PATCH", path, { deliveryMode, expectedVersion },
      { "X-Owner-Token": auth.token });
    if (!ok) return ownerFailure("update hosting", status, data, auth.fromEnv);
    return {
      content: [{ type: "text" as const, text: formatUpdateResponse(data as Record<string, unknown>) }],
    };
  }
);

server.tool(
  "delete_resource",
  "Delete a BrewPage resource (HTML page, site, KV store, JSON document, or file) using the owner token.",
  {
    type: z
      .enum(["html", "site", "kv", "json", "file"])
      .describe("Resource type to delete"),
    namespace: z.string().describe("Resource namespace"),
    id: z.string().describe("Resource ID"),
    ownerToken: z.string().optional().describe(OWNER_TOKEN_DESCRIPTION),
  },
  async ({ type, namespace, id, ownerToken }) => {
    const auth = ownerTokenFor(ownerToken);
    if (!auth.token) return textResult(NO_OWNER_TOKEN, true);
    const path = `/api/${TYPE_SEGMENTS[type]}/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`;
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

server.tool(
  "get_page",
  "Fetch stored rendered HTML or format-specific code/text by namespace and ID. This reads API content, not the owner-only original-source endpoint or browser viewer. Protected reads use the password header.",
  {
    namespace: z.string().describe("Page namespace"),
    id: z.string().describe("Page ID"),
    password: z
      .string()
      .optional()
      .describe("Password if the page is protected"),
  },
  async ({ namespace, id, password }) => {
    const headers: Record<string, string> = {};
    if (password) headers["X-Password"] = password;

    const { ok, status, data, headers: responseHeaders } = await apiRequest(
      "GET",
      `/api/html/${namespace}/${id}`,
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
      `URL: ${responseHeaders.get("X-Canonical-Link") ?? (hasNewMarkers ? "N/A" : `${BASE_URL}/${namespace}/${id}`)}`,
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

server.tool(
  "get_stats",
  "Get BrewPage platform-wide usage statistics including page count, file count, and storage usage. Counts use disjoint split: alive_public + alive_private + deleted == total. Optional `tz` shifts the 'today' boundary to the given IANA zone (default UTC).",
  {
    tz: z
      .string()
      .optional()
      .describe(
        "Optional IANA timezone id for the 'today' boundary, e.g. 'Europe/Lisbon'. Defaults to UTC. Invalid value falls back to UTC silently."
      ),
  },
  async ({ tz }) => {
    const path = tz ? `/api/stats?tz=${encodeURIComponent(tz)}` : "/api/stats";
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

server.tool(
  "publish_site",
  "Publish an HTML site to BrewPage. Single-page: pass `entryContent`. Multi-page: pass `files` (array of `{path, content}`). Optional `entry` overrides default `index.html`. Use its returned primary link and retain the owner token. " + SITE_LIMITS_TEXT +
    " " + MANAGE_URL_TEXT + " " + SECRETS,
  {
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
      .describe(NAMESPACE_DESCRIPTION),
    password: z
      .string()
      .optional()
      .describe("Optional password to protect the site"),
    ttlDays: TTL_SCHEMA,
    ownerToken: z.string().optional().describe(CREATE_OWNER_TOKEN_DESCRIPTION),
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
    const qsParams: string[] = [];
    if (entry) qsParams.push(`entry=${encodeURIComponent(entry)}`);
    qsParams.push(`ns=${encodeURIComponent(effectiveNamespace)}`);
    if (ttlDays) qsParams.push(`ttl=${encodeURIComponent(String(ttlDays))}`);
    const qs = qsParams.length ? `?${qsParams.join("&")}` : "";
    const url = `${BASE_URL}/api/sites${qs}`;
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
    lines.push(...ownerTokenLines(site, "view info or delete this site"));
    lines.push(...ownerLinkLines(site));
    const ns = ((site.namespace as string | undefined) || effectiveNamespace) || "";
    if (ns !== PUBLIC_NAMESPACE) {
      lines.push(``, site.access === "protected" ? PROTECTED_UNLISTED_NOTICE : UNLISTED_NOTICE);
    }

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  }
);

server.tool(
  "republish_site",
  "Republish (full-replace) an existing multi-file BrewPage site in place at the SAME URL/ID. Requires owner token. The uploaded bundle becomes the complete new file set — files absent from it are removed, new files added, matching files overwritten. Single-page: pass `entryContent`. Multi-page: pass `files` (array of `{path, content}`). Optional `entry` overrides the default `index.html`. Republishing preserves existing expiry. " + SITE_LIMITS_TEXT,
  {
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

    const qsParams: string[] = [];
    if (entry) qsParams.push(`entry=${encodeURIComponent(entry)}`);
    if (ttlDays) qsParams.push(`ttl=${encodeURIComponent(String(ttlDays))}`);
    if (tags && tags.length) qsParams.push(`tags=${encodeURIComponent(tags.join(","))}`);
    const qs = qsParams.length ? `?${qsParams.join("&")}` : "";

    const url = `${BASE_URL}/api/sites/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}${qs}`;
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

server.tool(
  "update_html",
  "Update an existing BrewPage HTML/Markdown page. Requires owner token. Returns the updated page metadata. " +
    "The link and delivery mode never change on update; an advisory deliveryModeReason and delivery notice are included when the new content uses browser features that may not work fully on a BrewPage link.",
  {
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
  async ({ namespace, id, content, ownerToken, format }) => {
    const body: Record<string, unknown> = { content };
    if (format) body.format = format;

    const auth = ownerTokenFor(ownerToken);
    if (!auth.token) return textResult(NO_OWNER_TOKEN, true);
    const path = `/api/html/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`;
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

server.tool(
  "publish_json",
  "Publish a JSON document to BrewPage (repository default limit 1 MiB). Accepts a JSON object, array, or a JSON-encoded string containing any valid JSON, including scalars/null. Returns its primary share link and owner token. " +
    MANAGE_URL_TEXT + " " + SECRETS,
  {
    deliveryMode: DELIVERY_MODE_SCHEMA,
    json: z
      .union([z.string(), z.record(z.unknown()), z.array(z.unknown())])
      .describe("JSON document to publish (object, array, or JSON-encoded string)"),
    namespace: z
      .string()
      .optional()
      .describe(NAMESPACE_DESCRIPTION),
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
  async ({ json, namespace, password, ttlDays, tags, ownerToken, deliveryMode }) => {
    const jsonString = typeof json === "string" ? json : JSON.stringify(json);

    const effectiveNamespace = resolveNamespace(namespace);
    const qsParams: string[] = [];
    qsParams.push(`ns=${encodeURIComponent(effectiveNamespace)}`);
    if (ttlDays !== undefined) qsParams.push(`ttl=${encodeURIComponent(String(ttlDays))}`);
    if (tags && tags.length) {
      for (const t of tags) qsParams.push(`tags=${encodeURIComponent(t)}`);
    }
    const qs = qsParams.length ? `?${qsParams.join("&")}` : "";

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (password) headers["X-Password"] = password;
    const owner = ownerTokenFor(ownerToken).token;
    if (owner) headers["X-Owner-Token"] = owner;
    if (deliveryMode) headers["X-Delivery-Mode"] = deliveryMode;

    const res = await bpFetch(`${BASE_URL}/api/json${qs}`, {
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
          text: formatPublishResponse(data as Record<string, unknown>, effectiveNamespace),
        },
      ],
    };
  }
);

server.tool(
  "get_json",
  "Fetch a published BrewPage JSON document by namespace and ID.",
  {
    namespace: z.string().describe("Document namespace"),
    id: z.string().describe("Document ID"),
    password: z
      .string()
      .optional()
      .describe("Password if the document is protected"),
  },
  async ({ namespace, id, password }) => {
    const headers: Record<string, string> = {};
    if (password) headers["X-Password"] = password;

    const path = `/api/json/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`;
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

server.tool(
  "update_json",
  "Update an existing BrewPage JSON document. Requires owner token. Accepts a JSON object, array, or a JSON-encoded string.",
  {
    namespace: z.string().describe("Document namespace"),
    id: z.string().describe("Document ID"),
    json: z
      .union([z.string(), z.record(z.unknown()), z.array(z.unknown())])
      .describe("New JSON document (object, array, or JSON-encoded string)"),
    ownerToken: z.string().optional().describe(OWNER_TOKEN_DESCRIPTION),
  },
  async ({ namespace, id, json, ownerToken }) => {
    const jsonString = typeof json === "string" ? json : JSON.stringify(json);
    const auth = ownerTokenFor(ownerToken);
    if (!auth.token) return textResult(NO_OWNER_TOKEN, true);

    const url = `${BASE_URL}/api/json/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`;
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

server.tool(
  "publish_kv",
  "Publish a key/value entry to BrewPage. Creates a KV store; the entry is addressed by (namespace, id, key). Repository defaults: 1 MiB per value, 1,000 keys per store; the key name `hosting` is reserved. Returns its primary share link and owner token. " +
    MANAGE_URL_TEXT + " " + SECRETS,
  {
    deliveryMode: DELIVERY_MODE_SCHEMA,
    key: z.string().describe("KV key (first part of the (namespace, id, key) addressing tuple)"),
    value: z.string().describe("KV value"),
    namespace: z
      .string()
      .optional()
      .describe(NAMESPACE_DESCRIPTION),
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
  async ({ key, value, namespace, password, ttlDays, tags, ownerToken, deliveryMode }) => {
    const body: Record<string, unknown> = { key, value };

    const effectiveNamespace = resolveNamespace(namespace);
    const qsParams: string[] = [];
    qsParams.push(`ns=${encodeURIComponent(effectiveNamespace)}`);
    if (ttlDays !== undefined) qsParams.push(`ttl=${encodeURIComponent(String(ttlDays))}`);
    if (tags && tags.length) {
      for (const t of tags) qsParams.push(`tags=${encodeURIComponent(t)}`);
    }
    const qs = qsParams.length ? `?${qsParams.join("&")}` : "";

    const headers: Record<string, string> = {};
    if (password) headers["X-Password"] = password;
    const owner = ownerTokenFor(ownerToken).token;
    if (owner) headers["X-Owner-Token"] = owner;
    if (deliveryMode) headers["X-Delivery-Mode"] = deliveryMode;

    const { ok, status, data } = await apiRequest(
      "POST",
      `/api/kv${qs}`,
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
          text: formatPublishResponse(data as Record<string, unknown>, effectiveNamespace),
        },
      ],
    };
  }
);

server.tool(
  "set_kv",
  "Set or update a key in an existing BrewPage KV store. Requires owner token. The key name `hosting` is reserved.",
  {
    namespace: z.string().describe("KV store namespace"),
    id: z.string().describe("KV store ID"),
    key: z.string().describe("Key to set"),
    value: z.string().describe("Value to assign to the key"),
    ownerToken: z.string().optional().describe(OWNER_TOKEN_DESCRIPTION),
  },
  async ({ namespace, id, key, value, ownerToken }) => {
    const body: Record<string, unknown> = { value };
    const auth = ownerTokenFor(ownerToken);
    if (!auth.token) return textResult(NO_OWNER_TOKEN, true);

    const path = `/api/kv/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/${encodeURIComponent(key)}`;
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

server.tool(
  "get_kv",
  "Fetch a value from a BrewPage KV store by namespace, ID, and key.",
  {
    namespace: z.string().describe("KV store namespace"),
    id: z.string().describe("KV store ID"),
    key: z.string().describe("Key to fetch"),
    password: z
      .string()
      .optional()
      .describe("Password if the KV store is protected"),
  },
  async ({ namespace, id, key, password }) => {
    const headers: Record<string, string> = {};
    if (password) headers["X-Password"] = password;

    const path = `/api/kv/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/${encodeURIComponent(key)}`;
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

server.tool(
  "get_limits",
  "Get the current BrewPage upload limits (GET /api/limits): request size, site file count, per-file and total size, " +
    "ZIP expansion, path and name lengths, TTL default/maximum, allowed file extensions and skipped system files. Sizes are bytes. " +
    `With ${OWNER_TOKEN_ENV} set: also reach (token|profile) and ownerMaxTtlDays. Call it before publishing a large or multi-file site.`,
  {},
  async () => {
    const headers: Record<string, string> = ENV_OWNER_TOKEN ? { "X-Owner-Token": ENV_OWNER_TOKEN } : {};
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

server.tool(
  "search_gallery",
  "Search the BrewPage public gallery. Optional filters: text query, pagination, sort, and 'mine' (owner-scoped, requires owner token).",
  {
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
  async ({ q, page, size, sort, mine, ownerToken }) => {
    const auth = ownerTokenFor(ownerToken);
    if (mine === true && !auth.token) return textResult(NO_OWNER_TOKEN, true);
    const qsParams: string[] = [];
    if (q !== undefined) qsParams.push(`q=${encodeURIComponent(q)}`);
    if (page !== undefined) qsParams.push(`page=${encodeURIComponent(String(page))}`);
    if (size !== undefined) qsParams.push(`size=${encodeURIComponent(String(size))}`);
    if (sort) qsParams.push(`sort=${encodeURIComponent(sort)}`);
    if (mine === true) qsParams.push("mine=true");
    const qs = qsParams.length ? `?${qsParams.join("&")}` : "";

    const headers: Record<string, string> = {};
    if (mine === true && auth.token) headers["X-Owner-Token"] = auth.token;

    const { ok, status, data } = await apiRequest(
      "GET",
      `/api/gallery${qs}`,
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

server.tool(
  "set_visibility",
  "Hide or show a public publication in gallery & search. Link unchanged.",
  {
    type: z.enum(["html", "site", "file", "json", "kv"]).describe("Publication type; only public html, site and file can be listed"),
    namespace: z.string().describe("Publication namespace"),
    id: z.string().describe("Publication ID"),
    listed: z.boolean().describe("false = hide, true = show"),
    ownerToken: z.string().optional().describe(OWNER_TOKEN_DESCRIPTION),
  },
  async ({ type, namespace, id, listed, ownerToken }) => {
    const auth = ownerTokenFor(ownerToken);
    if (!auth.token) return textResult(NO_OWNER_TOKEN, true);
    const path = `/api/${TYPE_SEGMENTS[type]}/${encodeURIComponent(namespace)}/${encodeURIComponent(id)}/visibility`;
    const { ok, status, data } = await apiRequest("POST", path, { listed }, { "X-Owner-Token": auth.token });
    if (!ok) return ownerFailure("set visibility", status, data, auth.fromEnv);
    const result = data as Record<string, unknown>;
    return textResult([`LISTED: ${result.listed} · link unchanged`, ...noticeLines(result)].join("\n"));
  }
);

server.tool(
  "bind_token",
  "Add an owner token to your BrewPage profile (as publish). Needs an admin token of that profile.",
  {
    token: z.string().describe("Owner token to add"),
    ownerToken: z.string().optional().describe(`Admin token of the profile. Default: ${OWNER_TOKEN_ENV}.`),
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

server.tool(
  "mint_token",
  "Mint a new profile token with an admin token; the new token is shown once. Scope publish (default) or admin; expiry 30d, 90d, 1y or never.",
  {
    label: z.string().optional().describe("Optional label shown in the profile"),
    scope: z.enum(["publish", "admin"]).optional().describe("publish (default) or admin (can manage tokens)"),
    expiresIn: z.enum(["30d", "90d", "1y", "never"]).optional().describe("Default: admin 90d, publish never"),
    ownerToken: z.string().optional().describe(`Admin token of the profile. Default: ${OWNER_TOKEN_ENV}.`),
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
