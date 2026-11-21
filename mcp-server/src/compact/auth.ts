import { COMPACT_TOOL_NAMES, isClientAbort, type ApiAnswer, type BridgeInputs, type BridgeOperation, type BridgeOptions, type Scope } from "./context.js";
import { legacyAccountScopes } from "./legacy-account.js";

export const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";
const BRIDGE_PATH = "/internal/mcp/v1";
const SCOPES: readonly Scope[] = [
  "publications:read", "publications:write", "page-data:read", "page-data:write",
  "domains:read", "domains:write", "account:read", "account:write",
];
const KNOWN_SCOPES = new Set<string>(SCOPES);
const OPERATIONS = new Set<string>([...COMPACT_TOOL_NAMES.filter((name) => name !== "get_guide"),
  "publish_file", "update_file", "merge_page_data", "search_gallery", "limits"]);

export type Bridge = <Operation extends BridgeOperation>(operation: Operation, args: BridgeInputs[Operation],
  options?: BridgeOptions<Operation>, signal?: AbortSignal) => Promise<ApiAnswer>;

export interface AuthChallenge {
  status: 401 | 403;
  error: "invalid_token" | "insufficient_scope";
  description: string;
  scopes: readonly Scope[];
}

export const connectionRequired = (scopes: readonly Scope[]): AuthChallenge => ({
  status: 401, error: "invalid_token", description: "Connect your BrewPage account in this client, then resume the request.", scopes,
});

export const invalidToken: AuthChallenge = {
  status: 401, error: "invalid_token", description: "The BrewPage connection is expired or invalid. Reconnect in this client.", scopes: [],
};

export const insufficientScope = (scopes: readonly Scope[]): AuthChallenge => ({
  status: 403, error: "insufficient_scope", description: "The BrewPage connection lacks the required permissions.", scopes,
});

export function challengeHeader(challenge: AuthChallenge, origin: string): string {
  const scope = challenge.scopes.length ? `, scope="${challenge.scopes.join(" ")}"` : "";
  return `Bearer resource_metadata="${new URL(RESOURCE_METADATA_PATH, origin).href}", error="${challenge.error}", error_description="${challenge.description}"${scope}`;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function knownScopes(value: unknown): Scope[] {
  return Array.isArray(value) ? value.filter((scope): scope is Scope => typeof scope === "string" && KNOWN_SCOPES.has(scope)) : [];
}

export function bridgeChallenge(answer: ApiAnswer): AuthChallenge | undefined {
  if (answer.status === 401) return invalidToken;
  const error = object(answer.data);
  if (answer.status === 403 && error.code === "insufficient_scope") return insufficientScope(knownScopes(error.requiredScopes));
}

export { bridgeOutcomeUnknown } from "./context.js";

function checkCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("BrewPage request cancelled.", "AbortError");
}

export function createBridge(origin: string, serviceSecret: string | undefined, bearer: string | undefined, fetchBackend: typeof fetch) {
  const unavailable = (): ApiAnswer => ({ ok: false, status: 503, headers: new Headers(),
    data: { code: "bridge_unavailable", message: "BrewPage account operations are temporarily unavailable." } });
  const receiptLost = (path: string): ApiAnswer => path === "/session" ? unavailable() : ({ ok: false, status: 502, headers: new Headers(),
    data: { code: "bridge_outcome_unknown", message: "BrewPage did not return a usable response." } });

  async function post(path: string, body?: BodyInit, proof?: Record<string, string>, signal?: AbortSignal): Promise<ApiAnswer> {
    checkCancellation(signal);
    const route = BRIDGE_PATH + path;
    if (!serviceSecret || !URL.canParse(route, origin)) return unavailable();
    const url = new URL(route, origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return unavailable();
    const headers = new Headers(proof);
    headers.set("X-BP-MCP-Service", serviceSecret);
    if (bearer && !proof) headers.set("Authorization", `Bearer ${bearer}`);
    if (typeof body === "string") headers.set("Content-Type", "application/json");
    let response: Response | undefined;
    try {
      response = await fetchBackend(url, { method: "POST", headers, body, redirect: "error", signal });
      checkCancellation(signal);
      if (response.status === 502 || response.status === 504) {
        await response.body?.cancel();
        return receiptLost(path);
      }
      const type = response.headers.get("Content-Type");
      const data = type?.includes("json") ? await response.json() : await response.text();
      checkCancellation(signal);
      return { ok: response.ok, status: response.status, data, headers: response.headers };
    } catch (error) {
      checkCancellation(signal);
      if (isClientAbort(error)) throw error;
      if (response && response.status >= 400 && response.status < 500) {
        return { ok: false, status: response.status, data: null, headers: response.headers };
      }
      return receiptLost(path);
    }
  }

  const call: Bridge = async (operation, args, options, signal) => {
    checkCancellation(signal);
    if (!OPERATIONS.has(operation) || Object.hasOwn(args, "ownerToken") || Object.hasOwn(args, "manageUrl") || Object.hasOwn(args, "requireAccount")) {
      return { ok: false, status: 400, data: { code: "invalid_bridge_arguments" }, headers: new Headers() };
    }
    if (options && "file" in options) {
      if (!bearer) return { ok: false, status: 401, data: { code: "missing_account_proof" }, headers: new Headers() };
      const form = new FormData();
      form.set("args", new Blob([JSON.stringify(args)], { type: "application/json" }));
      form.set("file", options.file, "upload");
      return post(`/operations/${operation}`, form, undefined, signal);
    }
    const owner = options && "proof" in options ? options.proof : undefined;
    const proof = owner ? "ownerToken" in owner ? { "X-Owner-Token": owner.ownerToken } : { "X-Manage-Key": owner.manageKey } : undefined;
    if (!bearer && !proof) return { ok: false, status: 401, data: { code: "missing_account_proof" }, headers: new Headers() };
    return post(`/operations/${operation}`, JSON.stringify(args), proof as Record<string, string> | undefined, signal);
  };

  return {
    call,
    session: async () => {
      const answer = await post("/session");
      const reported = object(answer.data).scopes;
      const scopes = knownScopes(reported);
      if (answer.ok && (!Array.isArray(reported) || reported.length !== scopes.length)) return { ...unavailable(), scopes: [] };
      return { ...answer, scopes };
    },
  };
}

export function stdioResource(baseUrl: string, configuredResource?: string): URL | undefined {
  try {
    const base = new URL(baseUrl);
    const location = configuredResource !== undefined ? new URL(configuredResource)
      : base.origin === "https://brewpage.app" ? new URL("/mcp", base) : undefined;
    if (location?.protocol === "https:" && location.href === `${base.origin}/mcp`) return location;
  } catch {
    return undefined;
  }
}

export function createStdioBridge(baseUrl: string, configuredResource?: string, request: typeof fetch = fetch): Bridge {
  const resource = stdioResource(baseUrl, configuredResource);
  const reply = (status: number, data: unknown): ApiAnswer => ({ ok: status === 200, status, data, headers: new Headers() });
  const uncertain = () => reply(502, { code: "merge_outcome_unknown", message: "Read the current Page data settings before retrying this change." });
  return async (operation, args, options, signal) => {
    checkCancellation(signal);
    const proof = options && "proof" in options ? options.proof : undefined;
    if (operation !== "merge_page_data" || !proof || !resource || !("kind" in args) || args.kind === undefined) {
      return reply(503, { code: "merge_unavailable", message: "Open the trusted BrewPage HTTP connection to change Page data settings." });
    }
    const target = args as BridgeInputs["merge_page_data"];
    const segment = target.kind === "site" ? "sites" : "html";
    const managePath = `/manage/${segment}/${encodeURIComponent(target.namespace)}/${encodeURIComponent(target.id)}`;
    const owner = "ownerToken" in proof ? { ownerToken: proof.ownerToken } : { manageUrl: `${resource.origin}${managePath}#k=${proof.manageKey}` };
    try {
      const timeout = AbortSignal.timeout(60_000);
      const response = await request(resource, {
        method: "POST", redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "publication_settings", arguments: { ...target, ...owner } } }),
      });
      const payload = object(await response.json());
      checkCancellation(signal);
      const result = object(payload.result);
      if (response.ok && payload.id === 1 && result.isError !== true) {
        const state = object(result.structuredContent).mergedState;
        return state && typeof state === "object" && !Array.isArray(state) ? reply(200, state) : uncertain();
      }
      if (response.ok && payload.id === 1 && result.isError === true) {
        return reply(409, { code: "merge_refused", message: "BrewPage rejected the Page data change. Read its current settings." });
      }
      return uncertain();
    } catch (error) {
      checkCancellation(signal);
      if (isClientAbort(error)) throw error;
      return uncertain();
    }
  };
}

interface ToolAuthority {
  accountOnly: boolean;
  explicitProof: boolean;
  scopes: readonly Scope[];
}

export function toolAuthority(name: string | undefined, args: Record<string, unknown>): ToolAuthority {
  const explicitProof = Object.hasOwn(args, "ownerToken") || Object.hasOwn(args, "manageUrl");
  const accountOnly = (name === "publish" || (name === "account" && (args.action === undefined || args.action === "status")))
    && args.requireAccount === true;
  const selected = (scopes: readonly Scope[]) => ({ accountOnly, explicitProof, scopes });
  switch (name) {
    case "publish":
    case "update_publication":
      return selected(["publications:write", ...(Object.hasOwn(args, "state") ? ["page-data:write" as const] : []),
        ...(Object.hasOwn(args, "domain") ? ["domains:write" as const] : [])]);
    case "list_publications":
      return selected(args.scope === "gallery" ? [] : ["publications:read"]);
    case "read_publication":
      return selected(args.view === "source" || args.view === "settings" || args.view === "stats"
        || (typeof args.namespace === "string" && args.namespace !== "public")
        || (args.kind === "site" && args.path === undefined) ? ["publications:read"] : []);
    case "publication_settings": {
      const changes = Object.keys(args).some((key) => SETTINGS_FIELDS.has(key));
      return selected([...(changes ? ["publications:write" as const] : []), ...(Object.hasOwn(args, "state") ? ["page-data:write" as const] : [])]);
    }
    case "delete_publication":
      return selected(["publications:write"]);
    case "read_page_data":
      return selected(["page-data:read"]);
    case "write_page_data":
    case "delete_page_data":
      return selected(["page-data:write"]);
    case "domains":
      return selected(args.action === undefined || ["list", "get", "check"].includes(String(args.action)) ? ["domains:read"] : ["domains:write"]);
    case "account":
      return selected([args.action === undefined || args.action === "status" || args.action === "tokens" ? "account:read" : "account:write"]);
    case "notifications":
      return selected(["mark_read", "set_settings", "set_page_switch"].includes(String(args.action)) ? ["account:write"] : ["account:read"]);
    default:
      return selected(legacyAccountScopes(name, args));
  }
}

const SETTINGS_FIELDS = new Set(["action", "listed", "badgeHidden", "title", "password", "extend", "deliveryMode", "expectedVersion", "linkName"]);
const COMPACT = new Set<string>(COMPACT_TOOL_NAMES);
const PUBLIC_LEGACY = new Set(["get_page", "get_stats", "get_limits", "get_guide"]);

export function canUseBearerWithoutExplicitProof(name: string | undefined, args: Record<string, unknown>): boolean {
  return name === undefined || COMPACT.has(name) || PUBLIC_LEGACY.has(name) || (name === "search_gallery" && args.mine !== true);
}
