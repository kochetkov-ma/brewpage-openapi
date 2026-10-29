import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, createServer as createTcpServer, type Socket } from "node:net";
import { EventEmitter, once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { fetchSourceSafely, isBlockedSource } from "../dist/http.js";

const PACKAGE_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
const HTTP_ENTRY = fileURLToPath(new URL("../dist/http.js", import.meta.url));
const MCP_ACCEPT = "application/json, text/event-stream";
const INITIALIZE = { jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "http-test", version: "0.0.0" } } };
const LIMITS = { maxFileSizeBytes: 5242880 };
const SOURCE_REFUSED = "Source URL refused: private or reserved address.";
const MIB = 1024 * 1024;

interface RequestSnapshot { method: string; url: string; headers: IncomingHttpHeaders }

/** Raw MCP POST from client `ip` with a declared length. */
const rawPost = (ip: string, body: string) => `POST /mcp HTTP/1.1\r\nHost: x\r\nX-Forwarded-For: ${ip}\r\nContent-Type: application/json\r\n` +
  `Accept: ${MCP_ACCEPT}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
const toolCall = (name: string, args: Record<string, unknown>) => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
const TOOLS_LIST = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
const PUBLISH = toolCall("publish_html", { content: "<p>x</p>" });

/** Stub backend plus the built HTTP entry on ephemeral ports; `trusted` sets the proxy CIDRs.
 * Backend counts open calls; `hold` = answers wait for `backend.release()`; `shared`/`list` = shared-egress CIDRs and list body. */
async function fixture(t: TestContext, trusted = "127.0.0.1/32", { hold = false, shared = "", list = "", gzip = false, redirect = false } = {}) {
  const requests: RequestSnapshot[] = [];
  const pending: Array<() => void> = [];
  let holding = hold;
  const backend = {
    open: 0, maxOpen: 0, events: new EventEmitter(),
    release() {
      holding = false;
      pending.splice(0).forEach((answer) => answer());
    },
  };
  const api = createServer((req, res) => {
    requests.push({ method: req.method!, url: req.url!, headers: req.headers });
    backend.maxOpen = Math.max(backend.maxOpen, ++backend.open);
    res.once("close", () => {
      backend.open--;
      backend.events.emit("change");
    });
    backend.events.emit("change");
    const answer = () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(LIMITS));
    };
    req.resume().once("end", () => holding ? pending.push(answer) : answer());
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const backendUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  const listUrl = list ? await listServer(t, list, { gzip, redirect }) : undefined;
  const child = spawn(process.execPath, [HTTP_ENTRY], {
    env: { PATH: process.env.PATH, BREWPAGE_BACKEND_URL: backendUrl, BREWPAGE_TRUSTED_PROXY_CIDRS: trusted,
      BREWPAGE_MCP_HOST: "127.0.0.1", BREWPAGE_MCP_PORT: "0", BREWPAGE_SHARED_EGRESS_CIDRS: shared,
      BREWPAGE_SHARED_EGRESS_LIST_URLS: listUrl?.url ?? "", NODE_EXTRA_CA_CERTS: listUrl?.ca ?? "" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout! });
  const logs: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  lines.on("line", (line) => {
    const entry = JSON.parse(line) as Record<string, unknown>;
    (entry.event === undefined ? logs : events).push(entry);
    backend.events.emit("change");
  });
  /** Resolves once `ready()` holds; re-checked on every backend or log event. */
  const until = (ready: () => boolean) => new Promise<void>((resolve) => {
    const check = () => {
      if (!ready()) return;
      backend.events.off("change", check);
      resolve();
    };
    backend.events.on("change", check);
    check();
  });
  await until(() => events.some(({ event }) => event === "listening"));
  const first = JSON.stringify(events.find(({ event }) => event === "listening"));
  const listening = JSON.parse(first) as { event: string; port: number; version: string };
  assert.deepEqual({ event: listening.event, version: listening.version }, { event: "listening", version: PACKAGE_VERSION },
    "HTTP entry announces its port and version once");
  const mcpUrl = `http://127.0.0.1:${listening.port}/mcp`;
  t.after(async () => {
    child.kill("SIGTERM");
    await once(child, "exit");
    api.closeAllConnections();
    await new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
  });
  return {
    requests, backendUrl, mcpUrl, logs, events, port: listening.port, child, backend, until,
    async connect(headers: Record<string, string> = { "X-Forwarded-For": "198.51.100.7, 203.0.113.9" }) {
      const client = new Client({ name: "http-test", version: "0.0.0" });
      t.after(() => client.close());
      await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers } }));
      return client;
    },
    post(headers: Record<string, string>, method = "POST", body: string = JSON.stringify(INITIALIZE)) {
      return fetch(mcpUrl, { method, headers: { Accept: MCP_ACCEPT, "Content-Type": "application/json", ...headers },
        body: method === "POST" ? body : undefined });
    },
    /** Raw request on its own socket; resolves with the status line once the server answers. */
    raw(request: string): { socket: Socket; status: Promise<string> } {
      const socket = connect(listening.port, "127.0.0.1", () => socket.write(request));
      t.after(() => socket.destroy());
      const status = new Promise<string>((resolve) => socket.once("data", (data: Buffer) => resolve(data.toString().split("\r\n")[0])));
      return { socket, status };
    },
  };
}

/** HTTPS list server with a throwaway self-signed cert for 127.0.0.1 (trusted via NODE_EXTRA_CA_CERTS). */
async function listServer(t: TestContext, body: string, { gzip = false, redirect = false }) {
  const dir = mkdtempSync(join(tmpdir(), "bp-mcp-tls-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "1",
    "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"],
  { stdio: "ignore" });
  const server = createHttpsServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, (req, res) => {
    if (req.url === "/moved") return res.writeHead(302, { Location: "/egress.json" }).end();
    if (!gzip) return res.end(body);
    res.writeHead(200, { "Content-Encoding": "gzip" }).end(gzipSync(body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const base = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url: `${base}${redirect ? "/moved" : "/egress.json"}`, ca: join(dir, "cert.pem") };
}

/** Raw TCP source answering `responses[path]` verbatim, so status lines can be hostile. */
async function rawSource(t: TestContext, responses: Record<string, string | Buffer>) {
  const server = createTcpServer((socket) => socket.on("error", () => undefined).once("data", (data: Buffer) => {
    const path = data.toString().split(" ")[1];
    socket.end(responses[path] ?? "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

const redirect = (location: string) => `HTTP/1.1 302 Found\r\nLocation: ${location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`;
const ok = (body: string, head = "HTTP/1.1 200 OK") => `${head}\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`;
const allowLoopback = (address: string) => address !== "127.0.0.1" && isBlockedSource(address);

test("HTTP initialize reports the package version and lists 20 annotated tools", { timeout: 15_000 }, async (t) => {
  // GIVEN the HTTP entry behind a trusted local proxy.
  const f = await fixture(t);
  // WHEN a Streamable HTTP client connects and lists tools.
  const client = await f.connect();
  const { tools } = await client.listTools();
  // THEN identity, tool count and annotations match the directory contract.
  assert.deepEqual(client.getServerVersion(), { name: "brewpage-mcp", version: PACKAGE_VERSION }, "serverInfo carries the package version");
  assert.equal(tools.length, 20, "all 20 tools are exposed over HTTP");
  assert.deepEqual(tools.filter((tool) => typeof tool.annotations?.readOnlyHint !== "boolean" || typeof tool.title !== "string")
    .map(({ name }) => name), [], "every tool has a title and readOnlyHint");
  assert.equal(f.requests.length, 0, "discovery never calls the backend");
});

test("trusted proxy peer forwards only the last client IP plus public proto and host", { timeout: 15_000 }, async (t) => {
  // GIVEN a client IP chain from the trusted proxy.
  const f = await fixture(t);
  const client = await f.connect();
  // WHEN a tool calls the backend.
  const result = await client.callTool({ name: "get_limits", arguments: {} }) as { isError?: boolean };
  // THEN the backend sees one IP literal, public origin markers and the remote User-Agent.
  const { headers } = f.requests[0];
  assert.deepEqual({ isError: result.isError, url: f.requests[0].url, xff: headers["x-forwarded-for"], proto: headers["x-forwarded-proto"],
    host: headers["x-forwarded-host"], ua: headers["user-agent"], token: headers["x-owner-token"] },
  { isError: undefined, url: "/api/limits", xff: "203.0.113.9", proto: "https", host: "brewpage.app",
    ua: `brewpage-mcp/${PACKAGE_VERSION} (remote)`, token: undefined }, "backend request carries exactly the forwarded identity");
});

test("remote get_limits sends the ownerToken argument as X-Owner-Token", { timeout: 15_000 }, async (t) => {
  // GIVEN a remote client with an owner token from create.
  const f = await fixture(t);
  const client = await f.connect();
  // WHEN it reads limits with that token.
  const result = await client.callTool({ name: "get_limits", arguments: { ownerToken: "fixture-owner" } }) as { isError?: boolean };
  // THEN the backend receives exactly that token.
  assert.deepEqual({ isError: result.isError, url: f.requests[0].url, token: f.requests[0].headers["x-owner-token"] },
    { isError: undefined, url: "/api/limits", token: "fixture-owner" }, "remote limits call carries the argument token");
});

const XFF = { "X-Forwarded-For": "203.0.113.9" };
for (const scenario of [
  { label: "untrusted TCP peer", trusted: "10.0.0.0/8", headers: XFF, method: "POST", body: undefined, status: 403, code: -32000, message: "Forbidden." },
  { label: "any Origin header", trusted: "127.0.0.1/32", headers: { ...XFF, Origin: "https://brewpage.app" }, method: "POST", body: undefined, status: 403, code: -32000, message: "Origin not allowed." },
  { label: "GET stream request", trusted: "127.0.0.1/32", headers: XFF, method: "GET", body: undefined, status: 405, code: -32000, message: "Method not allowed." },
  { label: "DELETE session request", trusted: "127.0.0.1/32", headers: XFF, method: "DELETE", body: undefined, status: 405, code: -32000, message: "Method not allowed." },
  { label: "missing client address", trusted: "127.0.0.1/32", headers: {}, method: "POST", body: undefined, status: 400, code: -32000, message: "Missing client address." },
  { label: "null body", trusted: "127.0.0.1/32", headers: XFF, method: "POST", body: "null", status: 400, code: -32600, message: "Invalid Request." },
  { label: "number body", trusted: "127.0.0.1/32", headers: XFF, method: "POST", body: "7", status: 400, code: -32600, message: "Invalid Request." },
  { label: "string body", trusted: "127.0.0.1/32", headers: XFF, method: "POST", body: "\"initialize\"", status: 400, code: -32600, message: "Invalid Request." },
  { label: "batch body", trusted: "127.0.0.1/32", headers: XFF, method: "POST", body: "[]", status: 400, code: -32600, message: "Batch requests are not supported." },
  { label: "malformed JSON", trusted: "127.0.0.1/32", headers: XFF, method: "POST", body: "{", status: 400, code: -32700, message: "Parse error." },
]) {
  test(`${scenario.label} is rejected with ${scenario.status}`, { timeout: 15_000 }, async (t) => {
    // GIVEN the HTTP entry with the scenario's proxy trust.
    const f = await fixture(t, scenario.trusted);
    // WHEN a raw request arrives.
    const res = await f.post(scenario.headers, scenario.method, scenario.body);
    // THEN it is refused before MCP handling, without a session id or a backend call.
    assert.deepEqual({ status: res.status, body: await res.json(), session: res.headers.get("mcp-session-id"), backend: f.requests.length },
      { status: scenario.status, body: { jsonrpc: "2.0", error: { code: scenario.code, message: scenario.message }, id: null },
        session: null, backend: 0 }, `${scenario.label} answers ${scenario.status}`);
  });
}

for (const path of ["//[", "/%", "/mcp/../[?x=%"]) {
  test(`malformed path ${path} answers 404 and the process keeps serving`, { timeout: 15_000 }, async (t) => {
    // GIVEN the HTTP entry.
    const f = await fixture(t);
    // WHEN a request line carries an unparsable path.
    const status = await f.raw(`POST ${path} HTTP/1.1\r\nHost: x\r\nX-Forwarded-For: 203.0.113.9\r\nContent-Length: 0\r\n\r\n`).status;
    const next = await f.post(XFF);
    // THEN only that request fails.
    assert.deepEqual({ status, next: next.status, exit: f.child.exitCode }, { status: "HTTP/1.1 404 Not Found", next: 200, exit: null },
      `${path} cannot stop the server`);
  });
}

test("one client trickling small bodies holds at most 4 slots; another client is still served", { timeout: 15_000 }, async (t) => {
  // GIVEN client A opening 8 requests whose bodies never finish.
  const f = await fixture(t);
  const stalled = Array.from({ length: 8 }, () => f.raw("POST /mcp HTTP/1.1\r\nHost: x\r\nX-Forwarded-For: 198.51.100.1\r\n" +
    "Content-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: 100\r\n\r\n{"));
  await f.until(() => f.logs.filter(({ outcome }) => outcome === "http_503").length === 4);
  // WHEN client B initializes meanwhile.
  const other = await f.post({ "X-Forwarded-For": "198.51.100.2" });
  stalled.forEach(({ socket }) => socket.destroy());
  // THEN 4 of A's requests get 503 (whichever arrived last) and B gets 200.
  assert.deepEqual({ refused: f.logs.filter(({ outcome }) => outcome === "http_503").length, other: other.status }, { refused: 4, other: 200 },
    "per-client cap keeps global slots free");
});

test("a body slower than the rate floor gets 408 after the grace period", { timeout: 15_000 }, async (t) => {
  // GIVEN the HTTP entry.
  const f = await fixture(t);
  // WHEN a client declares 100 bytes and sends one.
  const stalled = f.raw(rawPost("203.0.113.1", "{".padEnd(100)).slice(0, -99));
  // THEN the once-a-second check cuts it at the first tick past 2 s and logs the timeout.
  const status = await stalled.status;
  await f.until(() => f.logs.length === 1);
  assert.deepEqual({ status, outcome: f.logs[0].outcome }, { status: "HTTP/1.1 408 Request Timeout", outcome: "http_408" },
    "a trickle cannot pin a slot");
});

test("a tools/call log line names only registered tools and caps the method", { timeout: 15_000 }, async (t) => {
  // GIVEN the HTTP entry.
  const f = await fixture(t);
  // WHEN an unknown tool and an oversized method arrive.
  await f.post(XFF, "POST", JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "x".repeat(4096), arguments: {} } }));
  await f.post(XFF, "POST", JSON.stringify({ jsonrpc: "2.0", id: 3, method: "m".repeat(4096) }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  // THEN neither value reaches the log verbatim.
  assert.deepEqual(f.logs.map(({ method, tool }) => ({ method, tool })), [{ method: "tools/call", tool: "unknown" }, { method: "m".repeat(64), tool: null }],
    "log lines carry bounded method and known tool names only");
});

for (const target of ["http://127.0.0.1:{port}/source-file", "http://169.254.169.254/latest/meta-data/", "http://[::1]:{port}/source-file",
  "http://localhost:{port}/source-file", "http://[::ffff:127.0.0.1]:{port}/source-file", "http://10.0.0.1/file"]) {
  test(`publish_file refuses the internal source ${target}`, { timeout: 15_000 }, async (t) => {
    // GIVEN the HTTP entry and a source URL aimed at an internal address.
    const f = await fixture(t);
    const client = await f.connect();
    const url = target.replace("{port}", new URL(f.backendUrl).port);
    // WHEN publish_file runs.
    const result = await client.callTool({ name: "publish_file", arguments: { url, namespace: "public" } });
    // THEN the download is refused and nothing reaches the backend or the source.
    assert.deepEqual({ result, backend: f.requests.length },
      { result: { content: [{ type: "text", text: SOURCE_REFUSED }], isError: true }, backend: 0 }, `${url} is never fetched`);
  });
}

for (const scenario of [
  { label: "standard publish_html", content: "<p>x</p>", cap: 2 },
  { label: "heavy publish_html", content: "x".repeat(1.5 * MIB), cap: 1 },
]) {
  test(`${scenario.label}: slots stay held until the handler settles; disconnect aborts the backend call`, { timeout: 15_000 }, async (t) => {
    // GIVEN a backend that never answers and one client filling its ${scenario.cap} slot(s).
    const f = await fixture(t, "127.0.0.1/32", { hold: true });
    const call = () => f.raw(rawPost("198.51.100.1", toolCall("publish_html", { content: scenario.content })));
    const held = Array.from({ length: scenario.cap }, call);
    await f.until(() => f.backend.open === scenario.cap);
    // WHEN one more call arrives, then the client disconnects every held call and calls again.
    const extra = await call().status;
    held.forEach(({ socket }) => socket.destroy());
    await f.until(() => f.backend.open === 0 && f.logs.length === scenario.cap + 1);
    const again = call();
    await f.until(() => f.backend.open === 1);
    again.socket.destroy();
    await f.until(() => f.backend.open === 0 && f.logs.length === scenario.cap + 2);
    // THEN the extra call is refused while handlers run, every disconnect aborts its backend call and frees the slot.
    assert.deepEqual({ extra, maxOpen: f.backend.maxOpen, outcomes: f.logs.map(({ outcome }) => outcome) },
      { extra: "HTTP/1.1 503 Service Unavailable", maxOpen: scenario.cap,
        outcomes: ["http_503", ...Array(scenario.cap + 1).fill("client_closed")] }, "slots follow handlers, not sockets");
  });
}

test("a burst of 20 calls from one shared-egress address all succeed: queued, never refused", { timeout: 15_000 }, async (t) => {
  // GIVEN a backend holding answers and a platform egress range exempt from per-client caps.
  const f = await fixture(t, "127.0.0.1/32", { hold: true, shared: "198.51.100.0/24" });
  const calls = [
    ...Array(6).fill(TOOLS_LIST), ...Array(10).fill(PUBLISH), ...Array(4).fill(toolCall("publish_html", { content: "x".repeat(1.5 * MIB) })),
  ];
  // WHEN all 20 arrive at once from one address and the backend answers once both pools are full.
  const answers = Promise.all(calls.map(async (call) => {
    const res = await f.post({ "X-Forwarded-For": "198.51.100.50" }, "POST", call);
    const json = await res.json() as { result?: { isError?: boolean } };
    return `${res.status} ${json.result?.isError === true ? "tool_error" : "ok"}`;
  }));
  await f.until(() => f.backend.open === 9);
  f.backend.release();
  // THEN every call succeeds; the backend never sees more than the 8 standard plus 1 heavy slots.
  assert.deepEqual({ answers: await answers, backendCalls: f.requests.length, maxOpen: f.backend.maxOpen },
    { answers: Array(20).fill("200 ok"), backendCalls: 14, maxOpen: 9 }, "pools queue a shared address instead of refusing it");
});

test("a write burst never holds light slots: another client's tools/list answers at once", { timeout: 15_000 }, async (t) => {
  // GIVEN 40 small writes from one shared address: 8 in the standard pool, 32 queued for it.
  const f = await fixture(t, "127.0.0.1/32", { hold: true, shared: "198.51.100.0/24" });
  const burst = Array.from({ length: 40 }, () => f.raw(rawPost("198.51.100.50", PUBLISH)));
  await f.until(() => f.backend.open === 8);
  // WHEN another client lists tools.
  const res = await f.post({ "X-Forwarded-For": "203.0.113.5" }, "POST", TOOLS_LIST);
  const tools = ((await res.json()) as { result: { tools: unknown[] } }).result.tools.length;
  burst.forEach(({ socket }) => socket.destroy());
  // THEN it is served from the light pool while the writes wait.
  assert.deepEqual({ status: res.status, tools, backendOpen: f.backend.open }, { status: 200, tools: 20, backendOpen: 8 },
    "queued writes released their light slots");
});

test("a client that leaves while queued for a slot never reaches the backend", { timeout: 15_000 }, async (t) => {
  // GIVEN the standard pool full with 8 held writes from 4 addresses.
  const f = await fixture(t, "127.0.0.1/32", { hold: true });
  const held = ["203.0.113.1", "203.0.113.2", "203.0.113.3", "203.0.113.4"].flatMap((ip) => [f.raw(rawPost(ip, PUBLISH)), f.raw(rawPost(ip, PUBLISH))]);
  await f.until(() => f.backend.open === 8);
  // WHEN a fifth client's write queues (a later light call proves it was parsed), the client leaves, then a slot frees.
  const queued = f.raw(rawPost("203.0.113.9", PUBLISH));
  await once(queued.socket, "connect");
  const barrier = await f.post({ "X-Forwarded-For": "203.0.113.10" }, "POST", TOOLS_LIST);
  queued.socket.destroy();
  held[0].socket.destroy();
  await f.until(() => f.backend.open === 7 && f.logs.length === 3);
  held.forEach(({ socket }) => socket.destroy());
  // THEN the queued call is dropped when it gets the slot: no ninth backend call.
  assert.deepEqual({ barrier: barrier.status, backendCalls: f.requests.length, outcomes: f.logs.map(({ outcome }) => outcome).sort() },
    { barrier: 200, backendCalls: 8, outcomes: ["client_closed", "client_closed", "ok"] }, "abort is armed before the queue");
});

for (const scenario of [
  { label: "a valid list", prefixes: 100, pad: 0, gzip: false, redirect: false, outcome: "backend", event: { event: "shared_egress_list", ranges: 100 } },
  { label: "a truncated list", prefixes: 99, pad: 0, gzip: false, redirect: false, outcome: "HTTP/1.1 503 Service Unavailable",
    event: { event: "shared_egress_list_failed", message: "99 valid, 0 invalid prefixes" } },
  { label: "a gzip bomb", prefixes: 100, pad: 2 * MIB, gzip: true, redirect: false, outcome: "HTTP/1.1 503 Service Unavailable",
    event: { event: "shared_egress_list_failed", message: "list over 1 MiB" } },
  { label: "a redirect", prefixes: 100, pad: 0, gzip: false, redirect: true, outcome: "HTTP/1.1 503 Service Unavailable",
    event: { event: "shared_egress_list_failed", message: "fetch failed" } },
]) {
  test(`published egress list: ${scenario.label}`, { timeout: 15_000 }, async (t) => {
    // GIVEN a published list naming the caller's /24 among ${scenario.prefixes} prefixes.
    const prefixes = [{ ipv4Prefix: "198.51.100.0/24" }, ...Array.from({ length: scenario.prefixes - 1 }, (_, i) => ({ ipv4Prefix: `10.${i}.0.0/16` }))];
    const list = JSON.stringify({ creationTime: "2026-10-20", pad: "x".repeat(scenario.pad), prefixes });
    const f = await fixture(t, "127.0.0.1/32", { hold: true, list, gzip: scenario.gzip, redirect: scenario.redirect });
    await f.until(() => f.events.length === 2);
    // WHEN that address sends a third concurrent write.
    const held = [f.raw(rawPost("198.51.100.50", PUBLISH)), f.raw(rawPost("198.51.100.50", PUBLISH))];
    await f.until(() => f.backend.open === 2);
    const third = f.raw(rawPost("198.51.100.50", PUBLISH));
    const outcome = await Promise.race([third.status, f.until(() => f.backend.open === 3).then(() => "backend")]);
    [...held, third].forEach(({ socket }) => socket.destroy());
    // THEN a loaded list lifts the per-client cap; a rejected one keeps it and logs why.
    const { ts: _ts, url: _url, ...event } = f.events.find(({ event: name }) => name !== "listening")!;
    assert.deepEqual({ outcome, event }, { outcome: scenario.outcome, event: scenario.event }, `${scenario.label} sets the exemption`);
  });
}

test("publish_file download budget is 10 per client address", { timeout: 15_000 }, async (t) => {
  // GIVEN one client address.
  const f = await fixture(t);
  const client = await f.connect();
  // WHEN it asks for 11 downloads.
  const texts: string[] = [];
  for (let i = 0; i < 11; i++) {
    const result = await client.callTool({ name: "publish_file", arguments: { url: "http://10.0.0.1/file" } }) as { content: Array<{ text: string }> };
    texts.push(result.content[0].text);
  }
  // THEN the 11th is refused before any fetch.
  assert.deepEqual(texts, [...Array(10).fill(SOURCE_REFUSED), "Download limit reached for this address; try again in a few minutes."],
    "budget stops the 11th download");
});

for (const scenario of [
  { label: "hostile status code", path: "/x", response: ok("ok", "HTTP/1.1 099 X"), expected: "Failed to fetch file from URL: 99" },
  { label: "control chars in reason", path: "/x", response: ok("ok", "HTTP/1.1 200 bad\x01reason"), expected: "ok" },
  { label: "404 answer", path: "/missing", response: undefined, expected: "Failed to fetch file from URL: 404" },
  { label: "redirect to metadata IP", path: "/x", response: redirect("http://169.254.169.254/latest/"), expected: SOURCE_REFUSED },
  { label: "redirect to private IP", path: "/x", response: redirect("http://10.0.0.1/"), expected: SOURCE_REFUSED },
  { label: "redirect to localhost name", path: "/x", response: redirect("http://localhost/"), expected: SOURCE_REFUSED },
  { label: "redirect to file scheme", path: "/x", response: redirect("file:///etc/passwd"), expected: "Source URL refused: only http and https." },
  { label: "three redirects", path: "/r3", response: undefined, expected: "ok" },
  { label: "four redirects", path: "/r4", response: undefined, expected: "Source URL refused: more than 3 redirects." },
  { label: "declared size over cap", path: "/x", response: `HTTP/1.1 200 OK\r\nContent-Length: ${21 * MIB}\r\n\r\n`, expected: "Source file over 20 MiB." },
  { label: "streamed size over cap", path: "/x", response: Buffer.concat([Buffer.from("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n"), Buffer.alloc(21 * MIB, 65)]),
    expected: "Source file over 20 MiB." },
]) {
  test(`source fetch: ${scenario.label}`, { timeout: 15_000 }, async (t) => {
    // GIVEN a raw loopback source (loopback allowed for this test only).
    const base = await rawSource(t, {
      "/x": scenario.response ?? "", "/r1": redirect("/ok"), "/r2": redirect("/r1"), "/r3": redirect("/r2"), "/r4": redirect("/r3"), "/ok": ok("ok"),
    });
    // WHEN the guarded fetcher downloads it.
    const outcome = await fetchSourceSafely(`${base}${scenario.path}`, allowLoopback).then((blob) => blob.text(), (error: Error) => error.message);
    // THEN the bytes or the exact refusal come back as a value, never a crash.
    assert.equal(outcome, scenario.expected, `${scenario.label} settles as ${scenario.expected}`);
  });
}

test("source fetch stops when the caller aborts", { timeout: 15_000 }, async (t) => {
  // GIVEN a loopback source that reads the request and never answers.
  const sockets: Socket[] = [];
  const server = createTcpServer((socket) => sockets.push(socket.on("error", () => undefined).resume()));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => {
    sockets.forEach((socket) => socket.destroy());
    server.close(() => resolve());
  }));
  const controller = new AbortController();
  const connected = once(server, "connection") as Promise<[Socket]>;
  const outcome = fetchSourceSafely(`http://127.0.0.1:${(server.address() as { port: number }).port}/x`, allowLoopback, controller.signal)
    .then(() => "fetched", (error: Error) => error.name);
  const [socket] = await connected;
  const closed = once(socket, "close").then(() => true);
  // WHEN the caller aborts.
  controller.abort();
  // THEN the download rejects with an abort and the source connection is closed.
  assert.deepEqual({ outcome: await outcome, closed: await closed }, { outcome: "AbortError", closed: true }, "abort reaches the source socket");
});

test("source fetch refuses a non-http protocol up front", async () => {
  // GIVEN an ftp URL.
  // WHEN the guarded fetcher is called.
  const outcome = await fetchSourceSafely("ftp://example.com/file").then(() => "fetched", (error: Error) => error.message);
  // THEN it is refused without any connection.
  assert.equal(outcome, "Source URL refused: only http and https.", "only http and https are fetched");
});

test("source address guard blocks internal ranges and allows public ones", () => {
  // GIVEN v4, v6 and v4-mapped addresses on both sides of the guard.
  const cases: Record<string, boolean> = {
    "79.132.136.83": false, "8.8.8.8": false, "2606:4700:10::6814:179a": false, "::ffff:8.8.8.8": false,
    "127.0.0.1": true, "10.1.2.3": true, "172.18.0.2": true, "192.168.1.1": true, "169.254.169.254": true, "100.64.0.1": true,
    "0.0.0.0": true, "224.0.0.1": true, "255.255.255.255": true, "::": true, "::1": true, "fc00::1": true, "fd12::1": true,
    "fe80::1": true, "fe80::1%eth0": true, "ff02::1": true, "::ffff:127.0.0.1": true, "::ffff:a9fe:a9fe": true, "64:ff9b::a00:1": true,
    "::ffff:0:7f00:1": true, "[::1]": true, "not-an-ip": true,
  };
  // WHEN each address is checked.
  const actual = Object.fromEntries(Object.keys(cases).map((address) => [address, isBlockedSource(address)]));
  // THEN only public addresses pass.
  assert.deepEqual(actual, cases, "blocked/allowed table matches");
});

for (const [name, value] of [
  ["BREWPAGE_SHARED_EGRESS_CIDRS", "34.162.0.0/"], ["BREWPAGE_SHARED_EGRESS_CIDRS", "1.2.3.4/24/9"], ["BREWPAGE_SHARED_EGRESS_CIDRS", "/0x10"],
  ["BREWPAGE_SHARED_EGRESS_CIDRS", "10.0.0.0/33"], ["BREWPAGE_SHARED_EGRESS_CIDRS", "::1/129"], ["BREWPAGE_SHARED_EGRESS_CIDRS", "10.0.0.0/+8"],
  ["BREWPAGE_TRUSTED_PROXY_CIDRS", "127.0.0.1/"], ["BREWPAGE_SHARED_EGRESS_LIST_URLS", "http://127.0.0.1/list.json"],
]) {
  test(`HTTP mode refuses to start with ${name}=${value}`, { timeout: 15_000 }, async () => {
    // GIVEN a malformed CIDR entry.
    const env = { PATH: process.env.PATH, BREWPAGE_TRUSTED_PROXY_CIDRS: "127.0.0.1/32", [name]: value };
    const child = spawn(process.execPath, [HTTP_ENTRY], { env, stdio: ["ignore", "pipe", "pipe"] });
    const stderr: Buffer[] = [];
    child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk));
    // WHEN the process exits.
    const [code] = (await once(child, "exit")) as [number];
    // THEN startup fails and names the entry.
    assert.deepEqual({ code, message: (JSON.parse(Buffer.concat(stderr).toString()) as { message: string }).message },
      { code: 1, message: `${name}: invalid entry ${JSON.stringify(value)}.` }, `${value} is never read as a range`);
  });
}

test("HTTP mode refuses to start with BREWPAGE_OWNER_TOKEN set", { timeout: 15_000 }, async () => {
  // GIVEN an owner token in the environment.
  const child = spawn(process.execPath, [HTTP_ENTRY], {
    env: { PATH: process.env.PATH, BREWPAGE_OWNER_TOKEN: "EnvOwnerToken0123456789abcdefABC", BREWPAGE_TRUSTED_PROXY_CIDRS: "127.0.0.1/32" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr: Buffer[] = [];
  child.stderr!.on("data", (chunk: Buffer) => stderr.push(chunk));
  // WHEN the process exits.
  const [code] = (await once(child, "exit")) as [number];
  // THEN it fails fast and names only the variable.
  assert.deepEqual({ code, message: (JSON.parse(Buffer.concat(stderr).toString()) as { message: string }).message },
    { code: 1, message: "BREWPAGE_OWNER_TOKEN must not be set in HTTP mode." }, "startup is refused without echoing the token");
});
