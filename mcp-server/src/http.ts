#!/usr/bin/env node

import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { BlockList, isIP } from "node:net";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createMcpHandler, isLegacyRequest, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { toWebRequest } from "@modelcontextprotocol/node";
import { currentCall, HTML_ONLY_FAILURE, permitsHtmlOnly, RETIRED_TOOLS, TOOL_SELECTION_HEADER } from "./compat.js";
import { pageDataCommitted } from "./compact/page-data.js";
import { bridgeChallenge, canUseBearerWithoutExplicitProof, challengeHeader, connectionRequired, createBridge,
  insufficientScope, invalidToken, toolAuthority, type AuthChallenge, type Bridge } from "./compact/auth.js";
import { COMPACT_TOOL_NAMES, LEGACY_TOOL_NAMES } from "./compact/context.js";
import { createServer, OWNER_TOKEN_ENV, REMOTE, USER_AGENT, userAgentFor, type FailureReason } from "./tools.js";
import { classifyClient, UsageMetrics, type ClientClass } from "./metrics.js";

const MIB = 1024 * 1024;
/** Fits the largest site (25 MiB backend request: 20 MiB of inline text plus JSON escaping).
 * Two 32 MiB sites + 8x1 MiB + 32 light per round peaked at 373 MiB (heap 192): run with mem_limit 512m. */
const MAX_BODY_BYTES = 32 * MIB;
const LARGE_BODY_BYTES = 1 * MIB;
const SMALL_BODY_BYTES = 64 * 1024;
/** After a 2 s grace a body must average ~250 KiB/s (checked every second), so a trickle cannot pin a slot. */
const BODY_GRACE_MS = 2_000;
const BODY_MIN_BYTES_PER_MS = 256;
/** Light = small body, not tools/call or a LIGHT_TOOLS call; own pool so writes cannot starve handshakes. */
const MAX_LIGHT_IN_FLIGHT = 32;
const MAX_LIGHT_PER_CLIENT = 4;
const MAX_IN_FLIGHT = 8;
const MAX_PER_CLIENT = 2;
/** Heavy = body over 1 MiB or publish_file; one at a time keeps a 32 MiB call inside the container memory. */
const MAX_HEAVY_IN_FLIGHT = 1;
const MAX_HEAVY_PER_CLIENT = 1;
/** A full pool queues a request (before its body is read) for up to 30 s instead of answering 503. */
const QUEUE_WAIT_MS = 30_000;
const MAX_QUEUED = 64;
/** Read-only tools with small answers; content reads (get_page/json/kv, get_page_data) stay in the standard pool. */
const LIGHT_TOOLS = new Set(["get_limits", "get_stats", "search_gallery", "list_domains", "get_guide", "list_publications"]);
const CREATE_TOOLS = new Set(["publish", "publish_html", "publish_json", "publish_kv", "publish_file"]);
const BACKEND_TIMEOUT_MS = 60_000;
/** Published egress lists (backend `openai-chatgpt-connectors` rules): daily refresh, last good set kept on failure. */
const SHARED_LIST_REFRESH_MS = 24 * 60 * 60_000;
const SHARED_LIST_TIMEOUT_MS = 15_000;
const SHARED_LIST_MAX_BYTES = 1 * MIB;
const SHARED_LIST_MIN_RANGES = 100;
const MIN_LISTED_PREFIX_V4 = 16;
const MIN_LISTED_PREFIX_V6 = 32;
const MAX_SOURCE_BYTES = 20 * MIB;
const MAX_REDIRECTS = 3;
const SOURCE_TIMEOUT_MS = 30_000;
const SOURCE_IDLE_MS = 10_000;
const DOWNLOADS_PER_WINDOW = 10;
const DOWNLOAD_WINDOW_MS = 10 * 60_000;
const MAX_TRACKED_CLIENTS = 10_000;
const DIAL_RETRY_MS = 30_000;
const DIAL_RETRY_PAUSE_MS = 500;
const DRAIN_MS = 30_000;
const MAX_LOGGED_METHOD = 64;
const VERSION = USER_AGENT.split("/")[1];
const REMOTE_USER_AGENT = userAgentFor(REMOTE);
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const SERVER_ERROR = -32000;

type LogFields = Record<string, string | number | null>;
/** Per-request usage facts for metrics; `address` is never logged, only hashed into the daily set. */
interface Usage {
  client?: ClientClass;
  address?: string;
  /** Closed class the failure builder reported for this call. */
  reason?: FailureReason;
  /** Name asked by a call to no tool; reaches only the bounded labeler. */
  asked?: unknown;
  /** Declared client software of a connect, lower-cased; reaches only the bounded labeler. */
  software?: unknown;
}

const CLIENT_INFO_META = "io.modelcontextprotocol/clientInfo";

/** Declared client software name of a connect (2025 `clientInfo`, 2026 `_meta`), cut and lower-cased; else undefined. */
function declaredSoftware(params: unknown): string | undefined {
  const { clientInfo, _meta } = (params ?? {}) as { clientInfo?: { name?: unknown } | null; _meta?: Record<string, { name?: unknown } | null> | null };
  const name = clientInfo?.name ?? _meta?.[CLIENT_INFO_META]?.name;
  return typeof name === "string" ? name.slice(0, MAX_LOGGED_METHOD).toLowerCase() : undefined;
}

/** Closed reason of a failed tools/call: the builder's report, else `input` for a failure the SDK raised, `other` for a crash. */
function failureReasonOf(reported: FailureReason | undefined, outcome: unknown): FailureReason | undefined {
  if (reported !== undefined) return reported;
  return outcome === "tool_error" || outcome === "rpc_error" ? "input" : outcome === "exception" ? "other" : undefined;
}

/** One JSON line per event on stdout; callers never pass arguments, tokens or IPs. */
function log(fields: LogFields): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...fields })}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), event: "startup_failed", message })}\n`);
  process.exit(1);
}

interface Cidr { address: string; prefix: number; family: "ipv4" | "ipv6" }

/** An IP or IP/prefix: one slash, 1-3 decimal digits, prefix within the family's range; else undefined. */
function parseCidr(entry: string): Cidr | undefined {
  const parts = entry.split("/");
  const version = isIP(parts[0]);
  const max = version === 6 ? 128 : 32;
  const prefix = parts.length === 1 ? max : parts.length === 2 && /^\d{1,3}$/.test(parts[1]) ? Number(parts[1]) : -1;
  if (version === 0 || prefix < 0 || prefix > max) return undefined;
  return { address: parts[0], prefix, family: version === 6 ? "ipv6" : "ipv4" };
}

function blockList(cidrs: Cidr[]): BlockList {
  const list = new BlockList();
  for (const { address, prefix, family } of cidrs) list.addSubnet(address, prefix, family);
  return list;
}

/** Comma list of CIDRs or bare IPs from env `name`; empty entries skipped, any invalid entry is fatal. */
function parseCidrs(name: string, required: boolean): Cidr[] {
  const entries = (process.env[name] ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (entries.length === 0 && required) fail(`${name} is required: comma list of proxy CIDRs.`);
  return entries.map((entry) => parseCidr(entry) ?? fail(`${name}: invalid entry ${JSON.stringify(entry)}.`));
}

/** `{prefixes: [{ipv4Prefix | ipv6Prefix}]}`; drops unparsable and over-wide prefixes, rejects a truncated or reshaped file. */
export function parseEgressList(text: string): Cidr[] {
  const prefixes = (JSON.parse(text) as { prefixes?: unknown } | null)?.prefixes;
  if (!Array.isArray(prefixes)) throw new Error("no prefixes array");
  const valid = prefixes
    .map((entry: { ipv4Prefix?: unknown; ipv6Prefix?: unknown } | null) => entry?.ipv4Prefix ?? entry?.ipv6Prefix)
    .map((cidr) => typeof cidr === "string" ? parseCidr(cidr) : undefined)
    .filter((cidr): cidr is Cidr => cidr !== undefined && cidr.prefix >= (cidr.family === "ipv6" ? MIN_LISTED_PREFIX_V6 : MIN_LISTED_PREFIX_V4));
  const invalid = prefixes.length - valid.length;
  if (valid.length < SHARED_LIST_MIN_RANGES || invalid * 10 > prefixes.length) throw new Error(`${valid.length} valid, ${invalid} invalid prefixes`);
  return valid;
}

/** Comma list of https URLs from env `name`; any other entry is fatal. */
function parseListUrls(name: string): string[] {
  const entries = (process.env[name] ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  for (const entry of entries) {
    if (!URL.canParse(entry) || new URL(entry).protocol !== "https:") fail(`${name}: invalid entry ${JSON.stringify(entry)}.`);
  }
  return entries;
}

/** Body bytes after decompression, cancelled past `limit`: a gzip bomb never grows past it. */
async function readCapped(res: Response, limit: number): Promise<string> {
  if (Number(res.headers.get("content-length") ?? 0) > limit) throw new Error("list over 1 MiB");
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    size += next.value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error("list over 1 MiB");
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function loadConfig() {
  if (process.env[OWNER_TOKEN_ENV] !== undefined) fail(`${OWNER_TOKEN_ENV} must not be set in HTTP mode.`);
  const backendUrl = (process.env.BREWPAGE_BACKEND_URL || "http://brewpage-backend-mcp:8080").replace(/\/+$/, "");
  const publicOrigin = new URL(process.env.BREWPAGE_PUBLIC_ORIGIN || "https://brewpage.app");
  const port = Number(process.env.BREWPAGE_MCP_PORT || "8787");
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail("BREWPAGE_MCP_PORT must be a TCP port.");
  const catalog = process.env.BREWPAGE_MCP_CATALOG ?? "compact";
  if (catalog !== "compact" && catalog !== "legacy") fail("BREWPAGE_MCP_CATALOG must be compact or legacy.");
  return {
    backendUrl,
    publicOrigin: publicOrigin.origin,
    accountOrigin: process.env.BREWPAGE_ACCOUNT_ORIGIN,
    forwardedProto: publicOrigin.protocol.replace(/:$/, ""),
    forwardedHost: publicOrigin.host,
    trustedProxies: blockList(parseCidrs("BREWPAGE_TRUSTED_PROXY_CIDRS", true)),
    /** Platform egress (one IP, many users): global pools only, no per-client caps or download budget. */
    sharedEgress: parseCidrs("BREWPAGE_SHARED_EGRESS_CIDRS", false),
    sharedEgressLists: parseListUrls("BREWPAGE_SHARED_EGRESS_LIST_URLS"),
    /** Peers allowed to read GET /metrics (the Prometheus network); empty = /metrics answers 404. */
    metricsPeers: parseCidrs("BREWPAGE_METRICS_CIDRS", false),
    host: process.env.BREWPAGE_MCP_HOST || "0.0.0.0",
    port,
    catalog: catalog as "compact" | "legacy",
    bridgeSecret: process.env.BREWPAGE_MCP_BRIDGE_SERVICE_SECRET,
  };
}

/** Never-fetch ranges: private, loopback, link-local, CGNAT, ULA, multicast, reserved, SIIT/NAT64/6to4/Teredo.
 * BlockList matches v4-mapped IPv6 against the v4 rules, so ::ffff:0:0/96 must not be listed (it would block all IPv4). */
const BLOCKED_SOURCES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED_SOURCES.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 96], ["::ffff:0:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) BLOCKED_SOURCES.addSubnet(network, prefix, "ipv6");

export function isBlockedSource(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0];
  const family = isIP(bare);
  if (family === 0) return true;
  return BLOCKED_SOURCES.check(bare, family === 6 ? "ipv6" : "ipv4");
}

const SOURCE_REFUSED = "Source URL refused: private or reserved address.";
const BODY_TOO_LARGE = "Request body over 32 MiB.";
const SOURCE_TOO_LARGE = "Source file over 20 MiB.";

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup that fails when any resolved address is blocked; runs on every connection. */
function guardedLookup(isBlocked: (address: string) => boolean) {
  return (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, "");
      if (addresses.length === 0 || addresses.some(({ address }) => isBlocked(address))) return callback(new Error(SOURCE_REFUSED), "");
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

type Hop = { blob: Blob } | { location: string };

/** One HTTP(S) hop: literal and resolved addresses checked, non-2xx rejected, body capped; never throws outside the promise. */
function sourceHop(url: URL, signal: AbortSignal, isBlocked: (address: string) => boolean): Promise<Hop> {
  return new Promise<Hop>((resolve, reject) => {
    if (url.protocol !== "http:" && url.protocol !== "https:") return reject(new Error("Source URL refused: only http and https."));
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) !== 0 && isBlocked(host)) return reject(new Error(SOURCE_REFUSED));
    let settled = false;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
    };
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(url, { method: "GET", agent: false, lookup: guardedLookup(isBlocked), signal, headers: { "User-Agent": REMOTE_USER_AGENT } }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        res.resume();
        return settle(() => resolve({ location }));
      }
      if (status < 200 || status > 299) {
        res.destroy();
        return settle(() => reject(new Error(`Failed to fetch file from URL: ${status}`)));
      }
      const tooLarge = () => {
        res.destroy();
        settle(() => reject(new Error(SOURCE_TOO_LARGE)));
      };
      if (Number(res.headers["content-length"] ?? 0) > MAX_SOURCE_BYTES) return tooLarge();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer<ArrayBuffer>) => {
        size += chunk.length;
        if (size > MAX_SOURCE_BYTES) return tooLarge();
        if (!settled) chunks.push(chunk);
      });
      res.on("error", (error) => settle(() => reject(error)));
      res.on("end", () => {
        const contentType = res.headers["content-type"] ?? "";
        const type = /^[\x20-\x7e]{1,200}$/.test(contentType) ? contentType : "";
        settle(() => resolve({ blob: new Blob(chunks, { type }) }));
      });
    });
    req.setTimeout(SOURCE_IDLE_MS, () => req.destroy(new Error("Source download timed out.")));
    req.on("error", (error) => settle(() => reject(error)));
    req.end();
  });
}

/** SSRF-safe publish_file download: every hop re-checked, at most 3 redirects, one Blob copy; `abort` cancels it. */
export async function fetchSourceSafely(url: string, isBlocked: (address: string) => boolean = isBlockedSource,
  abort?: AbortSignal): Promise<Blob> {
  const timeout = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
  const signal = abort ? AbortSignal.any([timeout, abort]) : timeout;
  let current = new URL(url);
  for (let hop = 0; ; hop++) {
    const answer = await sourceHop(current, signal, isBlocked);
    if ("blob" in answer) return answer.blob;
    if (hop >= MAX_REDIRECTS) throw new Error("Source URL refused: more than 3 redirects.");
    current = new URL(answer.location, current);
  }
}

/** Fixed-window download budget per client IP; map size bounded by pruning, then clearing. */
const downloadWindows = new Map<string, { start: number; count: number }>();

function takeDownload(client: string, now = Date.now()): boolean {
  let window = downloadWindows.get(client);
  if (window === undefined || now - window.start >= DOWNLOAD_WINDOW_MS) {
    if (window === undefined && downloadWindows.size >= MAX_TRACKED_CLIENTS) {
      for (const [key, value] of downloadWindows) if (now - value.start >= DOWNLOAD_WINDOW_MS) downloadWindows.delete(key);
      if (downloadWindows.size >= MAX_TRACKED_CLIENTS) downloadWindows.clear();
    }
    window = { start: now, count: 0 };
    downloadWindows.set(client, window);
  }
  if (window.count >= DOWNLOADS_PER_WINDOW) return false;
  window.count++;
  return true;
}

const DIAL_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

function isDialFailure(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string; errors?: Array<{ code?: string }> } } | null)?.cause;
  return DIAL_CODES.has(cause?.code ?? "") || (cause?.errors ?? []).some(({ code }) => DIAL_CODES.has(code ?? ""));
}

/** Backend calls retry only connect failures (request never sent) for 30 s, e.g. during a backend restart. */
const backendFetch: typeof fetch = async (input, init) => {
  const deadline = Date.now() + DIAL_RETRY_MS;
  for (;;) {
    try {
      return await fetch(input, init);
    } catch (error) {
      if (!isDialFailure(error) || Date.now() >= deadline || init?.signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, DIAL_RETRY_PAUSE_MS));
    }
  }
};

function peerAddress(req: IncomingMessage): string {
  const raw = req.socket.remoteAddress ?? "";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw);
  return mapped ? mapped[1] : raw;
}

/** Last XFF entry (the proxy replaces the header); only an IP literal is accepted. */
function clientAddress(req: IncomingMessage): string | undefined {
  const last = (req.headers["x-forwarded-for"] ?? "").toString().split(",").at(-1)?.trim() ?? "";
  return isIP(last) !== 0 ? last : undefined;
}

function rpcError(res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

type BodyFailure = "too_large" | "timeout" | "aborted" | "busy";

/** Reads at most `limit` bytes above the minimum rate; `onLarge` (false = busy) runs once past LARGE_BODY_BYTES; never rejects. */
function readBody(req: IncomingMessage, limit: number, onLarge: () => boolean): Promise<Buffer | BodyFailure> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (value: Buffer | BodyFailure) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      resolve(value);
    };
    const started = Date.now();
    const timer = setInterval(() => {
      if (size < (Date.now() - started - BODY_GRACE_MS) * BODY_MIN_BYTES_PER_MS) finish("timeout");
    }, 1_000);
    req.on("data", (chunk: Buffer) => {
      const before = size;
      size += chunk.length;
      if (size > limit) return finish("too_large");
      if (before <= LARGE_BODY_BYTES && size > LARGE_BODY_BYTES && !onLarge()) return finish("busy");
      if (!done) chunks.push(chunk);
    });
    req.on("end", () => finish(Buffer.concat(chunks)));
    req.on("error", () => finish("aborted"));
    req.on("close", () => finish("aborted"));
    // A client that left while the request was queued closed before these listeners existed.
    if (req.socket.destroyed) finish("aborted");
  });
}

function rpcArguments(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function rpcCallRefusal(res: ServerResponse, id: unknown, status: number, text: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: typeof id === "string" || typeof id === "number" ? id : null,
    result: { content: [{ type: "text", text }], isError: true,
      ...(headers["WWW-Authenticate"] ? { _meta: { "mcp/www_authenticate": [headers["WWW-Authenticate"]] } } : {}) } }));
}

/** Tool-level outcome of one JSON-RPC answer; undefined = success. */
function rpcOutcome(outgoing: unknown): string | undefined {
  if (outgoing === null || typeof outgoing !== "object") return undefined;
  if ("error" in outgoing) return "rpc_error";
  const result = (outgoing as { result?: { isError?: unknown } | null }).result;
  return result?.isError === true ? "tool_error" : undefined;
}

/** Slot pool: global limit with a FIFO wait queue, plus a per-client cap (client undefined = shared egress, no cap). */
class Pool {
  active = 0;
  private readonly clients = new Map<string, number>();
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly limit: number, private readonly perClient: number) {}

  /** A free slot now, or false; never queues. */
  tryTake(client: string | undefined): boolean {
    if (!this.reserve(client)) return false;
    if (this.active < this.limit) {
      this.active++;
      return true;
    }
    this.release(client);
    return false;
  }

  /** True once a slot is held; false at once over the per-client cap or a full queue, or after QUEUE_WAIT_MS. */
  async take(client: string | undefined): Promise<boolean> {
    if (!this.reserve(client)) return false;
    if (this.active < this.limit) {
      this.active++;
      return true;
    }
    const granted = this.waiters.length < MAX_QUEUED && await new Promise<boolean>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(wake), 1);
        resolve(false);
      }, QUEUE_WAIT_MS);
      this.waiters.push(wake);
    });
    if (!granted) this.release(client);
    return granted;
  }

  /** Frees a slot; a queued request inherits it directly. */
  give(client: string | undefined): void {
    this.release(client);
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }

  private reserve(client: string | undefined): boolean {
    if (client === undefined) return true;
    const held = this.clients.get(client) ?? 0;
    if (held >= this.perClient) return false;
    this.clients.set(client, held + 1);
    return true;
  }

  private release(client: string | undefined): void {
    if (client === undefined) return;
    const left = (this.clients.get(client) ?? 1) - 1;
    if (left > 0) this.clients.set(client, left);
    else this.clients.delete(client);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const toolNames = new Set<string>([...LEGACY_TOOL_NAMES, ...COMPACT_TOOL_NAMES]);
  const light = new Pool(MAX_LIGHT_IN_FLIGHT, MAX_LIGHT_PER_CLIENT);
  const standard = new Pool(MAX_IN_FLIGHT, MAX_PER_CLIENT);
  const heavy = new Pool(MAX_HEAVY_IN_FLIGHT, MAX_HEAVY_PER_CLIENT);
  let draining = false;
  const listed = new Map<string, Cidr[]>();
  const staticEgress = blockList(config.sharedEgress);
  let listedEgress = blockList([]);
  const metricsPeers = config.metricsPeers.length > 0 ? blockList(config.metricsPeers) : undefined;
  const metrics = new UsageMetrics([...toolNames, ...RETIRED_TOOLS.keys()]);

  /** Never throws: a failed fetch or parse keeps the last good set and logs a warning. */
  async function loadEgressList(url: string): Promise<void> {
    try {
      const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(SHARED_LIST_TIMEOUT_MS),
        headers: { "User-Agent": REMOTE_USER_AGENT } });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`HTTP ${res.status}`);
      }
      const ranges = parseEgressList(await readCapped(res, SHARED_LIST_MAX_BYTES));
      listed.set(url, ranges);
      listedEgress = blockList([...listed.values()].flat());
      log({ event: "shared_egress_list", url, ranges: ranges.length });
    } catch (error) {
      log({ event: "shared_egress_list_failed", url, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const refreshEgressLists = () => config.sharedEgressLists.forEach((url) => void loadEgressList(url));
  refreshEgressLists();
  setInterval(refreshEgressLists, SHARED_LIST_REFRESH_MS).unref();

  async function handleMcp(req: IncomingMessage, res: ServerResponse, entry: LogFields, usage: Usage): Promise<void> {
    if (req.headers.origin !== undefined) return rpcError(res, 403, SERVER_ERROR, "Origin not allowed.");
    const peer = peerAddress(req);
    if (isIP(peer) === 0 || !config.trustedProxies.check(peer, isIP(peer) === 6 ? "ipv6" : "ipv4")) {
      return rpcError(res, 403, SERVER_ERROR, "Forbidden.");
    }
    if (req.method !== "POST") return rpcError(res, 405, SERVER_ERROR, "Method not allowed.", { Allow: "POST" });
    const client = clientAddress(req);
    if (client === undefined) return rpcError(res, 400, SERVER_ERROR, "Missing client address.");
    if (draining) return rpcError(res, 503, SERVER_ERROR, "Shutting down.", { "Retry-After": "5" });
    const declared = Number(req.headers["content-length"]);
    if (declared > MAX_BODY_BYTES) return rpcError(res, 413, SERVER_ERROR, BODY_TOO_LARGE);
    // Discards any unread body so the 503 is delivered and the connection stays usable.
    const busy = () => {
      req.resume();
      rpcError(res, 503, SERVER_ERROR, "Busy, retry shortly.", { "Retry-After": "1" });
    };
    const known = Number.isFinite(declared);
    const family = isIP(client) === 6 ? "ipv6" : "ipv4";
    const egress = staticEgress.check(client, family) ? "static" : listedEgress.check(client, family) ? "listed" : undefined;
    const shared = egress !== undefined;
    const capKey = shared ? undefined : client;
    // Registered first: a client that leaves at any point, even while queued, aborts the call.
    const abort = new AbortController();
    res.once("close", () => abort.abort());
    // One slot per request, released only after the handler settles, never on socket close.
    let slot: Pool | undefined;
    const acquire = async (pool: Pool) => {
      // A light slot is freed before waiting, so queued writes never hold handshake capacity.
      if (slot === light) {
        light.give(capKey);
        slot = undefined;
      }
      if (!(await pool.take(capKey))) return false;
      slot?.give(capKey);
      slot = pool;
      return true;
    };
    try {
      const first = !known ? standard : declared <= SMALL_BODY_BYTES ? light : declared <= LARGE_BODY_BYTES ? standard : heavy;
      if (!(await acquire(first))) return busy();
      if (abort.signal.aborted) return;

      // Unknown length that grows past 1 MiB must find a free heavy slot at once.
      const body = await readBody(req, MAX_BODY_BYTES, () => {
        if (slot === heavy) return true;
        if (!heavy.tryTake(capKey)) return false;
        slot?.give(capKey);
        slot = heavy;
        return true;
      });
      if (!(body instanceof Buffer)) {
        if (body === "aborted") return;
        if (body === "busy") return busy();
        res.once("finish", () => req.socket.destroy());
        return body === "timeout"
          ? rpcError(res, 408, SERVER_ERROR, "Request body too slow.", { Connection: "close" })
          : rpcError(res, 413, SERVER_ERROR, BODY_TOO_LARGE, { Connection: "close" });
      }
      let message: unknown;
      try {
        message = JSON.parse(body.toString("utf8"));
      } catch {
        return rpcError(res, 400, PARSE_ERROR, "Parse error.");
      }
      if (Array.isArray(message)) return rpcError(res, 400, INVALID_REQUEST, "Batch requests are not supported.");
      if (message === null || typeof message !== "object") return rpcError(res, 400, INVALID_REQUEST, "Invalid Request.");
      // An old tool name runs as its current tool from here on: pool and SDK see the current name, log line and metrics the old one.
      const askedName = (message as { params?: { name?: unknown } | null }).params?.name;
      message = currentCall(message);
      const rpc = message as { id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } | null };
      const toolName = rpc.method === "tools/call" ? rpc.params?.name : undefined;
      const toolArgs = rpcArguments(rpc.params?.arguments);
      // 2026-07-28 mirrors the tool name in a header the SDK checks against the body: it follows the rewrite.
      if (typeof toolName === "string" && toolName !== askedName && req.headers["mcp-name"] === askedName) req.headers["mcp-name"] = toolName;
      entry.method = typeof rpc.method === "string" ? rpc.method.slice(0, MAX_LOGGED_METHOD) : null;
      const counted = typeof askedName === "string" && RETIRED_TOOLS.has(askedName) ? askedName
        : typeof toolName === "string" && toolNames.has(toolName) ? toolName : "unknown";
      entry.tool = rpc.method === "tools/call" ? counted : null;
      if (entry.tool === "unknown") usage.asked = toolName;
      if (rpc.method === "initialize" || rpc.method === "server/discover") usage.software = declaredSoftware(rpc.params);
      usage.client = classifyClient(egress, (req.headers["user-agent"] ?? "").slice(0, MAX_LOGGED_METHOD));
      usage.address = client;
      const isLight = rpc.method !== "tools/call" || (typeof toolName === "string" && LIGHT_TOOLS.has(toolName));
      const file = toolName === "publish_file" || ((toolName === "publish" || toolName === "update_publication") && toolArgs.kind === "file");
      if (file && slot !== heavy && !(await acquire(heavy))) return busy();
      if (slot === light && !isLight && !(await acquire(standard))) return busy();
      if (abort.signal.aborted) return;
      const forwarded = { "X-Forwarded-For": client, "X-Forwarded-Proto": config.forwardedProto, "X-Forwarded-Host": config.forwardedHost };
      const callBackend: typeof fetch = (input, init) =>
        backendFetch(input, { ...init, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(BACKEND_TIMEOUT_MS), ...(init?.signal ? [init.signal] : [])]) });
      const callBridge: typeof fetch = (input, init) => {
        const headers = new Headers(init?.headers);
        for (const [name, value] of Object.entries(forwarded)) headers.set(name, value);
        headers.set("User-Agent", REMOTE_USER_AGENT);
        return callBackend(input, { ...init, headers });
      };
      const refuseCall = (status: number, text: string, challenge?: AuthChallenge) => {
        entry.outcome = "tool_error";
        usage.reason = "api_auth";
        rpcCallRefusal(res, rpc.id, status, text, challenge ? { "WWW-Authenticate": challengeHeader(challenge, config.publicOrigin) } : {});
      };
      const authorization = req.headersDistinct.authorization;
      const bearer = authorization?.length === 1 ? /^Bearer ([A-Za-z0-9._~+/\-]+={0,2})$/i.exec(authorization[0])?.[1] : undefined;
      const bridge = createBridge(config.backendUrl, config.bridgeSecret, bearer, callBridge);
      const selected = toolAuthority(typeof toolName === "string" ? toolName : undefined, toolArgs, config.accountOrigin);
      const challenge = (error: AuthChallenge) => refuseCall(error.status, error.description, error);
      if (authorization && !bearer) return challenge(invalidToken);
      let account = false;
      if (bearer) {
        const session = await bridge.session();
        if (!session.ok) {
          const denied = bridgeChallenge(session);
          return denied ? challenge(denied) : refuseCall(503, "BrewPage account verification is temporarily unavailable.");
        }
        const personalizedGuide = toolName === "get_guide" && toolArgs.topic === "limits";
        account = (!selected.explicitProof || toolName === "account") && (selected.scopes.length > 0 || personalizedGuide);
        if (account && selected.scopes.some((scope) => !session.scopes.includes(scope))) return challenge(insufficientScope(selected.scopes));
        if (!selected.explicitProof && !account && !canUseBearerWithoutExplicitProof(typeof toolName === "string" ? toolName : undefined, toolArgs)) {
          return refuseCall(200, "Use the compact BrewPage operation for this account action, or provide the existing owner proof.");
        }
      }
      if (selected.accountOnly && selected.explicitProof) return refuseCall(200, "Choose the BrewPage account or the explicit owner proof for this action.");
      if (selected.accountOnly && !account) return challenge(connectionRequired(selected.scopes));
      if (bearer && typeof toolName === "string" && CREATE_TOOLS.has(toolName) && Object.hasOwn(toolArgs, "manageUrl")) {
        return refuseCall(200, "A management link cannot authorize a new publication.");
      }
      if (bearer && selected.explicitProof && ["ownerToken", "manageUrl"].some((key) => Object.hasOwn(toolArgs, key)
        && (typeof toolArgs[key] !== "string" || toolArgs[key].trim() === ""))) {
        return refuseCall(200, "Provide a nonempty owner token or management link.");
      }
      const selections = req.headersDistinct[TOOL_SELECTION_HEADER.toLowerCase()];
      const selection = selections?.[0];
      if (selections && (selections.length !== 1 || (selection !== "publish_html" && selection !== "legacy"))) {
        return rpcError(res, 400, INVALID_REQUEST, "Unsupported BrewPage tool selection.");
      }
      if (selection === "publish_html" && rpc.method === "tools/call" && !permitsHtmlOnly(askedName, toolArgs)) {
        return refuseCall(200, HTML_ONLY_FAILURE);
      }
      // Stateless: no server-push streams; a refused auto-open never fails a connect.
      if (rpc.method === "subscriptions/listen") {
        const id = rpc.id;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: typeof id === "string" || typeof id === "number" ? id : null,
          error: { code: METHOD_NOT_FOUND, message: "subscriptions/listen is not supported by this stateless endpoint." } }));
        entry.outcome = "rpc_error";
        return;
      }
      let signedFailure: AuthChallenge | undefined;
      const bridgeCall: Bridge = async (operation, args, bridgeOptions, signal) => {
        const answer = await bridge.call(operation, args, bridgeOptions, signal);
        const progress = operation === "publication_settings" ? (answer.data as { applied?: unknown } | null)?.applied : undefined;
        const committed = (Array.isArray(progress) && progress.length > 0)
          || (operation === "write_page_data" && pageDataCommitted("saved", answer.data))
          || (operation === "delete_page_data" && pageDataCommitted("deleted", answer.data));
        if (account && !committed) signedFailure ??= bridgeChallenge(answer);
        return answer;
      };
      const download = (url: string, signal?: AbortSignal) => shared || takeDownload(client)
        ? fetchSourceSafely(url, isBlockedSource, signal ? AbortSignal.any([signal, abort.signal]) : abort.signal)
        : Promise.reject(new Error("Download limit reached for this address; try again in a few minutes."));
      const server = createServer({
        baseUrl: config.backendUrl,
        publicOrigin: config.publicOrigin,
        accountOrigin: config.accountOrigin,
        profile: REMOTE,
        catalog: selection === "publish_html" ? "html-only" : selection === "legacy" ? "legacy" : config.catalog,
        authority: account ? "account" : "unsigned",
        bridge: bridgeCall,
        onFailure: (reason) => {
          usage.reason ??= reason;
        },
        headers: forwarded,
        fetchSource: download,
        compactFetchSource: download,
        fetch: callBackend,
      });
      const request = await toWebRequest(req, message, { signal: abort.signal });
      const modern = (await isLegacyRequest(request, message)) ? undefined : createMcpHandler(() => server, { legacy: "reject" });
      const legacy = modern ? undefined : new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      try {
        if (legacy) await server.connect(legacy);
        const response = await (modern
          ? modern.fetch(request, { parsedBody: message })
          : legacy!.handleRequest(request, { parsedBody: message }));
        const text = await response.text();
        if (signedFailure) return challenge(signedFailure);
        if (response.headers.get("content-type")?.startsWith("application/json")) {
          try {
            entry.outcome = rpcOutcome(JSON.parse(text)) ?? null;
          } catch {
            entry.outcome = null;
          }
        }
        const headers = Object.fromEntries(response.headers.entries());
        if (legacy && response.status === 202 && !headers["content-type"]) headers["content-type"] = "text/plain; charset=UTF-8";
        res.writeHead(response.status, headers);
        res.end(text);
      } finally {
        await modern?.close();
        await legacy?.close();
        await server.close();
      }
    } finally {
      slot?.give(capKey);
    }
  }

  function handle(req: IncomingMessage, res: ServerResponse, entry: LogFields, usage: Usage): Promise<void> {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/healthz") {
      res.writeHead(draining ? 503 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: draining ? "draining" : "ok", version: VERSION }));
      return Promise.resolve();
    }
    const peer = peerAddress(req);
    if (path === "/metrics" && req.method === "GET" && isIP(peer) !== 0 && metricsPeers?.check(peer, isIP(peer) === 6 ? "ipv6" : "ipv4")) {
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(metrics.render());
      return Promise.resolve();
    }
    if (path !== "/mcp") {
      rpcError(res, 404, SERVER_ERROR, "Not found.");
      return Promise.resolve();
    }
    return handleMcp(req, res, entry, usage).catch((error: unknown) => {
      entry.outcome = "exception";
      log({ event: "request_failed", message: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) rpcError(res, 500, SERVER_ERROR, "Internal error.");
      else res.end();
    });
  }

  const httpServer = createHttpServer((req, res) => {
    const started = performance.now();
    const entry: LogFields = { http: req.method ?? "", method: null, tool: null, status: 0, outcome: null, ms: 0 };
    const usage: Usage = {};
    const logged = !(req.url ?? "").startsWith("/healthz") && !(req.url ?? "").startsWith("/metrics");
    const closedEarly = new Promise<boolean>((resolve) => res.once("close", () => resolve(!res.writableFinished)));
    let done: Promise<void>;
    try {
      done = handle(req, res, entry, usage);
    } catch (error) {
      entry.outcome = "exception";
      log({ event: "request_failed", message: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) rpcError(res, 500, SERVER_ERROR, "Internal error.");
      done = Promise.resolve();
    }
    // One line once the socket closed and the handler settled (slots released); ms covers both.
    void Promise.all([closedEarly, done]).then(([early]) => {
      if (!logged) return;
      entry.status = res.statusCode;
      if (early) entry.outcome = "client_closed";
      else entry.outcome ??= res.statusCode < 400 ? "ok" : `http_${res.statusCode}`;
      entry.ms = Math.round(performance.now() - started);
      const reason = typeof entry.tool === "string" ? failureReasonOf(usage.reason, entry.outcome) : undefined;
      if (reason !== undefined) entry.reason = reason;
      log(entry);
      if (usage.client === undefined || typeof entry.method !== "string") return;
      metrics.request(entry.method, usage.client);
      metrics.connect(entry.method, usage.software);
      if (typeof entry.tool !== "string") return;
      metrics.toolCall(entry.tool, usage.client, String(entry.outcome), usage.address!);
      if (entry.tool === "unknown") metrics.unknownTool(usage.asked);
      if (reason !== undefined) metrics.failure(entry.tool, reason);
    });
  });
  // Whole request incl. queue wait: 30 s queue + 2 s grace + 32 MiB at the body floor (~131 s) + margin.
  httpServer.requestTimeout = QUEUE_WAIT_MS + BODY_GRACE_MS + MAX_BODY_BYTES / BODY_MIN_BYTES_PER_MS + 5_000;

  const shutdown = () => {
    if (draining) return;
    draining = true;
    log({ event: "draining", inFlight: light.active + standard.active + heavy.active });
    httpServer.close(() => process.exit(0));
    httpServer.closeIdleConnections();
    setTimeout(() => {
      httpServer.closeAllConnections();
      process.exit(0);
    }, DRAIN_MS).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  httpServer.listen(config.port, config.host, () => {
    const address = httpServer.address();
    log({ event: "listening", port: typeof address === "object" && address !== null ? address.port : config.port, version: VERSION });
  });
}

/** Runs only as the entry script; tests import the address guard and the source fetcher. */
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
}
