#!/usr/bin/env node

import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { BlockList, isIP } from "node:net";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { createServer, OWNER_TOKEN_ENV, USER_AGENT } from "./tools.js";

const MIB = 1024 * 1024;
const MAX_BODY_BYTES = 32 * MIB;
const LARGE_BODY_BYTES = 1 * MIB;
const MAX_IN_FLIGHT = 8;
const MAX_LARGE_IN_FLIGHT = 2;
const MAX_SOURCE_BYTES = 20 * MIB;
const MAX_REDIRECTS = 3;
const SOURCE_TIMEOUT_MS = 30_000;
const SOURCE_IDLE_MS = 10_000;
const DIAL_RETRY_MS = 30_000;
const DIAL_RETRY_PAUSE_MS = 500;
const DRAIN_MS = 30_000;
const REMOTE_USER_AGENT = `${USER_AGENT} (remote)`;

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

/** Never-fetch ranges: private, loopback, link-local, CGNAT, ULA, multicast, reserved, NAT64/6to4/Teredo.
 * BlockList matches v4-mapped IPv6 against the v4 rules, so ::ffff:0:0/96 must not be listed (it would block all IPv4). */
const BLOCKED_SOURCES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED_SOURCES.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) BLOCKED_SOURCES.addSubnet(network, prefix, "ipv6");

export function isBlockedSource(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0];
  const family = isIP(bare);
  if (family === 0) return true;
  return BLOCKED_SOURCES.check(bare, family === 6 ? "ipv6" : "ipv4");
}

const SOURCE_REFUSED = "Source URL refused: private or reserved address.";

function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    if (addresses.length === 0 || addresses.some(({ address }) => isBlockedSource(address))) {
      return callback(new Error(SOURCE_REFUSED), "");
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

type Hop = { response: Response } | { location: string };

/** One HTTP(S) hop: literal and resolved addresses are checked, the body is capped. */
function sourceHop(url: URL, signal: AbortSignal): Promise<Hop> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return Promise.reject(new Error("Source URL refused: only http and https."));
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) !== 0 && isBlockedSource(url.hostname)) return Promise.reject(new Error(SOURCE_REFUSED));
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<Hop>((resolve, reject) => {
    const req = send(url, { method: "GET", agent: false, lookup: guardedLookup, signal, headers: { "User-Agent": REMOTE_USER_AGENT } }, (res) => {
      const status = res.statusCode ?? 502;
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        res.resume();
        return resolve({ location });
      }
      const tooLarge = () => { res.destroy(); reject(new Error("Source file over 20 MiB.")); };
      if (Number(res.headers["content-length"] ?? 0) > MAX_SOURCE_BYTES) return tooLarge();
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_SOURCE_BYTES) return tooLarge();
        chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => {
        const headers: Record<string, string> = {};
        if (res.headers["content-type"]) headers["Content-Type"] = res.headers["content-type"];
        const body = [101, 204, 205, 304].includes(status) ? null : Buffer.concat(chunks);
        resolve({ response: new Response(body, { status, statusText: res.statusMessage ?? "", headers }) });
      });
    });
    req.setTimeout(SOURCE_IDLE_MS, () => req.destroy(new Error("Source download timed out.")));
    req.on("error", reject);
    req.end();
  });
}

/** SSRF-safe publish_file download: every hop re-checked, at most 3 redirects. */
async function fetchSourceSafely(url: string): Promise<Response> {
  const signal = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
  let current = new URL(url);
  for (let hop = 0; ; hop++) {
    const answer = await sourceHop(current, signal);
    if ("response" in answer) return answer.response;
    if (hop >= MAX_REDIRECTS) throw new Error("Source URL refused: more than 3 redirects.");
    current = new URL(answer.location, current);
  }
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

function rpcError(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  const code = message === "Parse error." ? -32700 : message.startsWith("Batch") ? -32600 : -32000;
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

/** Reads at most `limit` bytes; undefined when the body is larger. */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return undefined;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function main(): void {
  const config = loadConfig();
  let inFlight = 0;
  let largeInFlight = 0;
  let draining = false;

  async function handleMcp(req: IncomingMessage, res: ServerResponse, entry: LogFields): Promise<void> {
    if (req.headers.origin !== undefined) return rpcError(res, 403, "Origin not allowed.");
    const peer = peerAddress(req);
    if (isIP(peer) === 0 || !config.trustedProxies.check(peer, isIP(peer) === 6 ? "ipv6" : "ipv4")) {
      return rpcError(res, 403, "Forbidden.");
    }
    if (req.method !== "POST") return rpcError(res, 405, "Method not allowed.", { Allow: "POST" });
    const client = clientAddress(req);
    if (client === undefined) return rpcError(res, 400, "Missing client address.");
    if (draining) return rpcError(res, 503, "Shutting down.", { "Retry-After": "5" });
    const declared = Number(req.headers["content-length"]);
    if (declared > MAX_BODY_BYTES) return rpcError(res, 413, "Request body over 32 MiB.");
    const large = !(Number.isFinite(declared) && declared <= LARGE_BODY_BYTES);
    if (inFlight >= MAX_IN_FLIGHT || (large && largeInFlight >= MAX_LARGE_IN_FLIGHT)) {
      return rpcError(res, 503, "Busy, retry shortly.", { "Retry-After": "1" });
    }
    inFlight++;
    if (large) largeInFlight++;
    res.once("close", () => {
      inFlight--;
      if (large) largeInFlight--;
    });

    const body = await readBody(req, MAX_BODY_BYTES);
    if (body === undefined) return rpcError(res, 413, "Request body over 32 MiB.", { Connection: "close" });
    let message: unknown;
    try {
      message = JSON.parse(body.toString("utf8"));
    } catch {
      return rpcError(res, 400, "Parse error.");
    }
    if (Array.isArray(message)) return rpcError(res, 400, "Batch requests are not supported.");
    const rpc = message as { method?: unknown; params?: { name?: unknown } };
    entry.method = typeof rpc.method === "string" ? rpc.method : null;
    entry.tool = rpc.method === "tools/call" && typeof rpc.params?.name === "string" ? rpc.params.name : null;

    const server = createServer({
      baseUrl: config.backendUrl,
      publicOrigin: config.publicOrigin,
      userAgent: REMOTE_USER_AGENT,
      headers: { "X-Forwarded-For": client, "X-Forwarded-Proto": config.forwardedProto, "X-Forwarded-Host": config.forwardedHost },
      fetchSource: fetchSourceSafely,
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

  const httpServer = createHttpServer((req, res) => {
    const started = performance.now();
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/healthz") {
      res.writeHead(draining ? 503 : 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: draining ? "draining" : "ok", version: USER_AGENT.split("/")[1] }));
      return;
    }
    const entry: LogFields = { http: req.method ?? "", method: null, tool: null, status: 0, outcome: null, ms: 0 };
    res.once("close", () => {
      entry.status = res.statusCode;
      entry.outcome ??= res.statusCode < 400 ? "ok" : `http_${res.statusCode}`;
      entry.ms = Math.round(performance.now() - started);
      log(entry);
    });
    if (path !== "/mcp") return rpcError(res, 404, "Not found.");
    handleMcp(req, res, entry).catch((error: unknown) => {
      entry.outcome = "exception";
      log({ event: "request_failed", message: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) rpcError(res, 500, "Internal error.");
      else res.end();
    });
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
    log({ event: "listening", port: typeof address === "object" && address !== null ? address.port : config.port, version: USER_AGENT.split("/")[1] });
  });
}

/** Runs only as the entry script; tests import the address guard. */
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
