import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const PACKAGE_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
const STDIO_ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const HTTP_ENTRY = fileURLToPath(new URL("../dist/http.js", import.meta.url));
const MODERN = "2026-07-28";
const CLIENT_IP = "198.51.100.7";
const LIMITS = { maxFileSizeBytes: 5242880 };
/** Registration order, as tools/list returns it. */
const EXPECTED_TOOL_NAMES = [
  "publish_html", "publish_file", "update_hosting", "delete_resource", "get_page", "get_stats", "publish_site",
  "republish_site", "update_html", "publish_json", "get_json", "update_json", "publish_kv",
  "set_kv", "get_kv", "get_limits", "search_gallery", "set_visibility", "bind_token", "mint_token",
];

type Rpc = { id?: number; result?: Record<string, unknown>; error?: { code: number; message: string } };
/** One JSON-RPC exchange in the transport's own framing. */
type Send = (body: Record<string, unknown>, version?: string) => Promise<Rpc>;

const envelope = (version: string) => ({ _meta: { "io.modelcontextprotocol/protocolVersion": version,
  "io.modelcontextprotocol/clientInfo": { name: "protocol-test", version: "0.0.0" }, "io.modelcontextprotocol/clientCapabilities": {} } });

/** Stub BrewPage API on an ephemeral local port; records every request. */
async function backend(t: TestContext) {
  const requests: Array<{ url: string; headers: IncomingHttpHeaders }> = [];
  const api = createServer((req, res) => {
    requests.push({ url: req.url!, headers: req.headers });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(LIMITS));
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  t.after(() => {
    api.closeAllConnections();
    return new Promise<void>((resolve) => api.close(() => resolve()));
  });
  return { requests, url: `http://127.0.0.1:${(api.address() as { port: number }).port}` };
}

/** Raw newline-delimited JSON-RPC over the stdio entry. */
async function stdio(t: TestContext, apiUrl: string): Promise<Send> {
  const child = spawn(process.execPath, [STDIO_ENTRY], { env: { PATH: process.env.PATH, BREWPAGE_URL: apiUrl }, stdio: ["pipe", "pipe", "ignore"] });
  t.after(() => child.kill());
  const answers = new Map<number, (rpc: Rpc) => void>();
  createInterface({ input: child.stdout! }).on("line", (line) => {
    const rpc = JSON.parse(line) as Rpc;
    answers.get(rpc.id ?? -1)?.(rpc);
  });
  return (body) => new Promise<Rpc>((resolve) => {
    answers.set(body.id as number, resolve);
    child.stdin!.write(`${JSON.stringify(body)}\n`);
  });
}

/** The HTTP entry behind a trusted loopback proxy; resolves with its /mcp URL. */
async function httpEntry(t: TestContext, apiUrl: string): Promise<string> {
  const child = spawn(process.execPath, [HTTP_ENTRY], {
    env: { PATH: process.env.PATH, BREWPAGE_BACKEND_URL: apiUrl, BREWPAGE_TRUSTED_PROXY_CIDRS: "127.0.0.1/32",
      BREWPAGE_MCP_HOST: "127.0.0.1", BREWPAGE_MCP_PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await once(child, "exit");
  });
  const port = await new Promise<number>((resolve) => createInterface({ input: child.stdout! }).on("line", (line) => {
    const entry = JSON.parse(line) as { event?: string; port?: number };
    if (entry.event === "listening") resolve(entry.port!);
  }));
  return `http://127.0.0.1:${port}/mcp`;
}

/** Raw POSTs; a modern exchange also carries the MCP-Protocol-Version and Mcp-Method headers. */
async function http(t: TestContext, apiUrl: string): Promise<Send> {
  const url = await httpEntry(t, apiUrl);
  return async (body, version) => {
    const res = await fetch(url, { method: "POST", body: JSON.stringify(body), headers: {
      "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-Forwarded-For": CLIENT_IP,
      ...(version ? { "MCP-Protocol-Version": version, "Mcp-Method": String(body.method) } : {}) } });
    return await res.json() as Rpc;
  };
}

/** Opens the connection; returns the negotiated revision and the version to stamp on later requests (undefined = 2025 era). */
type Opening = (send: Send) => Promise<{ negotiated: unknown; server: unknown; era?: string }>;

const discover = (version: string): Opening => async (send) => {
  const { result } = await send({ jsonrpc: "2.0", id: 1, method: "server/discover", params: envelope(version) }, version);
  const versions = result?.supportedVersions as string[] | undefined;
  return { negotiated: versions?.find((offered) => offered === version) ?? versions,
    server: (result?._meta as Record<string, unknown> | undefined)?.["io.modelcontextprotocol/serverInfo"], era: version };
};

const initialize = (version: string): Opening => async (send) => {
  const { result } = await send({ jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "protocol-test", version: "0.0.0" } } });
  // Fire-and-forget: the stdio entry never answers a notification, HTTP answers 202.
  void send({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => undefined);
  return { negotiated: result?.protocolVersion, server: result?.serverInfo };
};

const PROTOCOL_MATRIX = [
  { label: `server/discover ${MODERN}`, open: discover(MODERN), negotiated: MODERN },
  { label: "initialize 2025-11-25", open: initialize("2025-11-25"), negotiated: "2025-11-25" },
  { label: "initialize 2025-06-18", open: initialize("2025-06-18"), negotiated: "2025-06-18" },
  { label: "initialize 2025-03-26", open: initialize("2025-03-26"), negotiated: "2025-03-26" },
  { label: `initialize offering ${MODERN}`, open: initialize(MODERN), negotiated: "2025-11-25" },
];

for (const [transport, connect] of [["stdio", stdio], ["HTTP", http]] as const) {
  for (const row of PROTOCOL_MATRIX) {
    test(`${transport} ${row.label} negotiates ${row.negotiated} and lists all 20 tools`, { timeout: 15_000 }, async (t) => {
      // GIVEN the built entry on a stub API.
      const api = await backend(t);
      const send = await connect(t, api.url);
      // WHEN the client opens with this revision and lists tools in the negotiated era.
      const opened = await row.open(send);
      const listed = await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: opened.era ? envelope(opened.era) : {} }, opened.era);
      // THEN the exact revision is negotiated and the tool surface is complete.
      assert.deepEqual({ negotiated: opened.negotiated, server: opened.server, tools: (listed.result?.tools as Array<{ name: string }>).map(({ name }) => name) },
        { negotiated: row.negotiated, server: { name: "brewpage-mcp", version: PACKAGE_VERSION }, tools: EXPECTED_TOOL_NAMES },
        `${transport} ${row.label}: negotiated revision, server identity and tool list`);
    });
  }
}

for (const scenario of [
  { transport: "stdio", mode: "auto", negotiated: MODERN, userAgent: `brewpage-mcp/${PACKAGE_VERSION}` },
  { transport: "stdio", mode: "legacy", negotiated: "2025-11-25", userAgent: `brewpage-mcp/${PACKAGE_VERSION}` },
  { transport: "HTTP", mode: "auto", negotiated: MODERN, userAgent: `brewpage-mcp/${PACKAGE_VERSION} (remote)` },
  { transport: "HTTP", mode: "legacy", negotiated: "2025-11-25", userAgent: `brewpage-mcp/${PACKAGE_VERSION} (remote)` },
] as const) {
  test(`SDK client in ${scenario.mode} mode over ${scenario.transport} negotiates ${scenario.negotiated} and calls a tool`, { timeout: 15_000 }, async (t) => {
    // GIVEN the built entry on a stub API and an SDK v2 client.
    const api = await backend(t);
    const client = new Client({ name: "protocol-test", version: "0.0.0" }, { versionNegotiation: { mode: scenario.mode } });
    t.after(() => client.close());
    const transport = scenario.transport === "stdio"
      ? new StdioClientTransport({ command: process.execPath, args: [STDIO_ENTRY], env: { BREWPAGE_URL: api.url }, stderr: "ignore" })
      : new StreamableHTTPClientTransport(new URL(await httpEntry(t, api.url)), { requestInit: { headers: { "X-Forwarded-For": CLIENT_IP } } });
    // WHEN it connects, lists tools and calls get_limits.
    await client.connect(transport);
    const { tools } = await client.listTools();
    const result = await client.callTool({ name: "get_limits", arguments: {} }) as { isError?: boolean };
    // THEN the revision, tool surface, tool result and upstream identity are exact.
    assert.deepEqual({ negotiated: client.getNegotiatedProtocolVersion(), tools: tools.map(({ name }) => name), isError: result.isError ?? false,
      upstream: api.requests.map(({ url, headers }) => ({ url, userAgent: headers["user-agent"] })) },
    { negotiated: scenario.negotiated, tools: EXPECTED_TOOL_NAMES, isError: false, upstream: [{ url: "/api/limits", userAgent: scenario.userAgent }] },
    `${scenario.transport} ${scenario.mode}: negotiated revision, tools, call result and upstream request`);
  });
}

test(`HTTP refuses a ${MODERN} subscriptions/listen stream in-band without calling the API`, { timeout: 15_000 }, async (t) => {
  // GIVEN the HTTP entry on a stub API.
  const api = await backend(t);
  const send = await http(t, api.url);
  // WHEN a modern client asks for a server-push stream.
  const answer = await send({ jsonrpc: "2.0", id: 3, method: "subscriptions/listen",
    params: { ...envelope(MODERN), notifications: { toolsListChanged: true } } }, MODERN);
  // THEN the stateless endpoint answers method-not-found for that request id.
  assert.deepEqual({ answer, upstream: api.requests.length }, { answer: { jsonrpc: "2.0", id: 3,
    error: { code: -32601, message: "subscriptions/listen is not supported by this stateless endpoint." } }, upstream: 0 },
  "listen is refused in-band; nothing reaches the API");
});
