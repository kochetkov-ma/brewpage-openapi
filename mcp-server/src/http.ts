#!/usr/bin/env node

import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { BlockList, isIP } from "node:net";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { createServer, OWNER_TOKEN_ENV, USER_AGENT } from "./tools.js";

const MIB = 1024 * 1024;
/** A 31 MiB tools/call peaked at 375 MiB RSS, 7.9 MiB at 164 MiB; 8 MiB keeps a 320 MiB container safe. */
const MAX_BODY_BYTES = 8 * MIB;
const LARGE_BODY_BYTES = 1 * MIB;
const BODY_TIMEOUT_MS = 10_000;
const MAX_IN_FLIGHT = 8;
const MAX_PER_CLIENT = 2;
/** Heavy = body over 1 MiB or publish_file; each peaks ~100 MiB RSS, two reached 313 MiB, too close to 320 MiB. */
const MAX_HEAVY_IN_FLIGHT = 1;
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
const REMOTE_USER_AGENT = `${USER_AGENT} (remote)`;
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const SERVER_ERROR = -32000;

type LogFields = Record<string, string | number | null>;

/** One JSON line per event on stdout; callers never pass arguments, tokens or IPs. */
function log(fields: LogFields): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...fields })}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), event: "startup_failed", message })}\n`);
  process.exit(1);
}

/** Comma list of CIDRs or bare IPs; empty entries skipped, any invalid entry is fatal. */
function parseCidrs(raw: string | undefined): BlockList {
  const list = new BlockList();
  const entries = (raw ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (entries.length === 0) fail("BREWPAGE_TRUSTED_PROXY_CIDRS is required: comma list of proxy CIDRs.");
  for (const entry of entries) {
    const [address, prefixText] = entry.split("/");
    const family = isIP(address);
    const prefix = prefixText === undefined ? (family === 6 ? 128 : 32) : Number(prefixText);
    const maxPrefix = family === 6 ? 128 : 32;
    if (family === 0 || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
      fail(`BREWPAGE_TRUSTED_PROXY_CIDRS: invalid entry ${JSON.stringify(entry)}.`);
    }
    list.addSubnet(address, prefix, family === 6 ? "ipv6" : "ipv4");
  }
  return list;
}

function loadConfig() {
  if (process.env[OWNER_TOKEN_ENV] !== undefined) fail(`${OWNER_TOKEN_ENV} must not be set in HTTP mode.`);
  const backendUrl = (process.env.BREWPAGE_BACKEND_URL || "http://brewpage-backend-mcp:8080").replace(/\/+$/, "");
  const publicOrigin = new URL(process.env.BREWPAGE_PUBLIC_ORIGIN || "https://brewpage.app");
  const port = Number(process.env.BREWPAGE_MCP_PORT || "8787");
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail("BREWPAGE_MCP_PORT must be a TCP port.");
  return {
    backendUrl,
    publicOrigin: publicOrigin.origin,
    forwardedProto: publicOrigin.protocol.replace(/:$/, ""),
    forwardedHost: publicOrigin.host,
    trustedProxies: parseCidrs(process.env.BREWPAGE_TRUSTED_PROXY_CIDRS),
    host: process.env.BREWPAGE_MCP_HOST || "0.0.0.0",
    port,
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

/** SSRF-safe publish_file download: every hop re-checked, at most 3 redirects, one Blob copy. */
export async function fetchSourceSafely(url: string, isBlocked: (address: string) => boolean = isBlockedSource): Promise<Blob> {
  const signal = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
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
      if (!isDialFailure(error) || Date.now() >= deadline) throw error;
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

/** Reads at most `limit` bytes within `timeoutMs`; never rejects. */
function readBody(req: IncomingMessage, limit: number, timeoutMs: number): Promise<Buffer | "too_large" | "timeout" | "aborted"> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (value: Buffer | "too_large" | "timeout" | "aborted") => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) return finish("too_large");
      if (!done) chunks.push(chunk);
    });
    req.on("end", () => finish(Buffer.concat(chunks)));
    req.on("error", () => finish("aborted"));
    req.on("close", () => finish("aborted"));
  });
}

/** Tool names from an in-memory handshake; logs name only these. */
async function registeredToolNames(): Promise<Set<string>> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer({ baseUrl: "http://127.0.0.1:9" });
  const client = new Client({ name: "startup", version: VERSION });
  await server.connect(serverSide);
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  return new Set(tools.map(({ name }) => name));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const toolNames = await registeredToolNames();
  const perClient = new Map<string, number>();
  let inFlight = 0;
  let heavyInFlight = 0;
  let draining = false;

  async function handleMcp(req: IncomingMessage, res: ServerResponse, entry: LogFields): Promise<void> {
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
    if (declared > MAX_BODY_BYTES) return rpcError(res, 413, SERVER_ERROR, "Request body over 8 MiB.");
    const busy = () => rpcError(res, 503, SERVER_ERROR, "Busy, retry shortly.", { "Retry-After": "1" });
    let heavy = !(Number.isFinite(declared) && declared <= LARGE_BODY_BYTES);
    if (inFlight >= MAX_IN_FLIGHT || (perClient.get(client) ?? 0) >= MAX_PER_CLIENT || (heavy && heavyInFlight >= MAX_HEAVY_IN_FLIGHT)) {
      return busy();
    }
    inFlight++;
    perClient.set(client, (perClient.get(client) ?? 0) + 1);
    if (heavy) heavyInFlight++;
    res.once("close", () => {
      inFlight--;
      const left = (perClient.get(client) ?? 1) - 1;
      if (left > 0) perClient.set(client, left);
      else perClient.delete(client);
      if (heavy) heavyInFlight--;
    });

    const body = await readBody(req, MAX_BODY_BYTES, BODY_TIMEOUT_MS);
    if (!(body instanceof Buffer)) {
      if (body === "aborted") return;
      res.once("finish", () => req.socket.destroy());
      return body === "timeout"
        ? rpcError(res, 408, SERVER_ERROR, "Request body too slow.", { Connection: "close" })
        : rpcError(res, 413, SERVER_ERROR, "Request body over 8 MiB.", { Connection: "close" });
    }
    let message: unknown;
    try {
      message = JSON.parse(body.toString("utf8"));
    } catch {
      return rpcError(res, 400, PARSE_ERROR, "Parse error.");
    }
    if (Array.isArray(message)) return rpcError(res, 400, INVALID_REQUEST, "Batch requests are not supported.");
    if (message === null || typeof message !== "object") return rpcError(res, 400, INVALID_REQUEST, "Invalid Request.");
    const rpc = message as { method?: unknown; params?: { name?: unknown } | null };
    const toolName = rpc.method === "tools/call" ? rpc.params?.name : undefined;
    entry.method = typeof rpc.method === "string" ? rpc.method.slice(0, MAX_LOGGED_METHOD) : null;
    entry.tool = rpc.method === "tools/call" ? (typeof toolName === "string" && toolNames.has(toolName) ? toolName : "unknown") : null;
    if (toolName === "publish_file" && !heavy) {
      if (heavyInFlight >= MAX_HEAVY_IN_FLIGHT) return busy();
      heavy = true;
      heavyInFlight++;
    }

    const server = createServer({
      baseUrl: config.backendUrl,
      publicOrigin: config.publicOrigin,
      userAgent: REMOTE_USER_AGENT,
      headers: { "X-Forwarded-For": client, "X-Forwarded-Proto": config.forwardedProto, "X-Forwarded-Host": config.forwardedHost },
      fetchSource: (url) => takeDownload(client)
        ? fetchSourceSafely(url)
        : Promise.reject(new Error("Download limit reached for this address; try again in a few minutes.")),
      fetch: backendFetch,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const send = transport.send.bind(transport);
    transport.send = (outgoing: JSONRPCMessage, options) => {
      if ("error" in outgoing) entry.outcome = "rpc_error";
      else if ("result" in outgoing && (outgoing.result as { isError?: unknown }).isError === true) entry.outcome = "tool_error";
      return send(outgoing, options);
    };
    res.once("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, message);
  }

  function handle(req: IncomingMessage, res: ServerResponse, entry: LogFields): void {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/healthz") {
      res.writeHead(draining ? 503 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: draining ? "draining" : "ok", version: VERSION }));
      return;
    }
    if (path !== "/mcp") return rpcError(res, 404, SERVER_ERROR, "Not found.");
    handleMcp(req, res, entry).catch((error: unknown) => {
      entry.outcome = "exception";
      log({ event: "request_failed", message: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) rpcError(res, 500, SERVER_ERROR, "Internal error.");
      else res.end();
    });
  }

  const httpServer = createHttpServer((req, res) => {
    const started = performance.now();
    const entry: LogFields = { http: req.method ?? "", method: null, tool: null, status: 0, outcome: null, ms: 0 };
    const logged = !(req.url ?? "").startsWith("/healthz");
    res.once("close", () => {
      if (!logged) return;
      entry.status = res.statusCode;
      entry.outcome ??= res.statusCode < 400 ? "ok" : `http_${res.statusCode}`;
      entry.ms = Math.round(performance.now() - started);
      log(entry);
    });
    try {
      handle(req, res, entry);
    } catch (error) {
      entry.outcome = "exception";
      log({ event: "request_failed", message: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) rpcError(res, 500, SERVER_ERROR, "Internal error.");
    }
  });
  httpServer.requestTimeout = 120_000;

  const shutdown = () => {
    if (draining) return;
    draining = true;
    log({ event: "draining", inFlight });
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
