import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isBlockedSource } from "../dist/http.js";

const PACKAGE_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
const HTTP_ENTRY = fileURLToPath(new URL("../dist/http.js", import.meta.url));
const MCP_ACCEPT = "application/json, text/event-stream";
const INITIALIZE = { jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "http-test", version: "0.0.0" } } };
const LIMITS = { maxFileSizeBytes: 5242880 };

interface RequestSnapshot { method: string; url: string; headers: IncomingHttpHeaders }

/** Stub backend plus the built HTTP entry on ephemeral ports; `trusted` sets the proxy CIDRs. */
async function fixture(t: TestContext, trusted = "127.0.0.1/32") {
  const requests: RequestSnapshot[] = [];
  const api = createServer((req, res) => {
    requests.push({ method: req.method!, url: req.url!, headers: req.headers });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(LIMITS));
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const backendUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  const child = spawn(process.execPath, [HTTP_ENTRY], {
    env: { PATH: process.env.PATH, BREWPAGE_BACKEND_URL: backendUrl, BREWPAGE_TRUSTED_PROXY_CIDRS: trusted,
      BREWPAGE_MCP_HOST: "127.0.0.1", BREWPAGE_MCP_PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout! });
  const [first] = (await once(lines, "line")) as [string];
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
    requests, backendUrl, mcpUrl,
    async connect(headers: Record<string, string> = { "X-Forwarded-For": "198.51.100.7, 203.0.113.9" }) {
      const client = new Client({ name: "http-test", version: "0.0.0" });
      t.after(() => client.close());
      await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers } }));
      return client;
    },
    post(headers: Record<string, string>, method = "POST") {
      return fetch(mcpUrl, { method, headers: { Accept: MCP_ACCEPT, "Content-Type": "application/json", ...headers },
        body: method === "POST" ? JSON.stringify(INITIALIZE) : undefined });
    },
  };
}

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

for (const scenario of [
  { label: "untrusted TCP peer", trusted: "10.0.0.0/8", headers: { "X-Forwarded-For": "203.0.113.9" }, method: "POST", status: 403, message: "Forbidden." },
  { label: "any Origin header", trusted: "127.0.0.1/32", headers: { "X-Forwarded-For": "203.0.113.9", Origin: "https://brewpage.app" }, method: "POST", status: 403, message: "Origin not allowed." },
  { label: "GET stream request", trusted: "127.0.0.1/32", headers: { "X-Forwarded-For": "203.0.113.9" }, method: "GET", status: 405, message: "Method not allowed." },
  { label: "DELETE session request", trusted: "127.0.0.1/32", headers: { "X-Forwarded-For": "203.0.113.9" }, method: "DELETE", status: 405, message: "Method not allowed." },
  { label: "missing client address", trusted: "127.0.0.1/32", headers: {}, method: "POST", status: 400, message: "Missing client address." },
]) {
  test(`${scenario.label} is rejected with ${scenario.status}`, { timeout: 15_000 }, async (t) => {
    // GIVEN the HTTP entry with the scenario's proxy trust.
    const f = await fixture(t, scenario.trusted);
    // WHEN a raw request arrives.
    const res = await f.post(scenario.headers, scenario.method);
    // THEN it is refused before MCP handling, without a session id or a backend call.
    assert.deepEqual({ status: res.status, body: await res.json(), session: res.headers.get("mcp-session-id"), backend: f.requests.length },
      { status: scenario.status, body: { jsonrpc: "2.0", error: { code: -32000, message: scenario.message }, id: null },
        session: null, backend: 0 }, `${scenario.label} answers ${scenario.status}`);
  });
}

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
      { result: { content: [{ type: "text", text: "Source URL refused: private or reserved address." }], isError: true }, backend: 0 },
      `${url} is never fetched`);
  });
}

test("source address guard blocks internal ranges and allows public ones", () => {
  // GIVEN v4, v6 and v4-mapped addresses on both sides of the guard.
  const cases: Record<string, boolean> = {
    "79.132.136.83": false, "8.8.8.8": false, "2606:4700:10::6814:179a": false, "::ffff:8.8.8.8": false,
    "127.0.0.1": true, "10.1.2.3": true, "172.18.0.2": true, "192.168.1.1": true, "169.254.169.254": true, "100.64.0.1": true,
    "0.0.0.0": true, "224.0.0.1": true, "255.255.255.255": true, "::": true, "::1": true, "fc00::1": true, "fd12::1": true,
    "fe80::1": true, "fe80::1%eth0": true, "ff02::1": true, "::ffff:127.0.0.1": true, "::ffff:a9fe:a9fe": true, "64:ff9b::a00:1": true,
    "[::1]": true, "not-an-ip": true,
  };
  // WHEN each address is checked.
  const actual = Object.fromEntries(Object.keys(cases).map((address) => [address, isBlockedSource(address)]));
  // THEN only public addresses pass.
  assert.deepEqual(actual, cases, "blocked/allowed table matches");
});

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
