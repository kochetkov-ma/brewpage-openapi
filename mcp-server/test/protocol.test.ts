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
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createServer as createMcpServer } from "../dist/tools.js";

const PACKAGE_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
const STDIO_ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const HTTP_ENTRY = fileURLToPath(new URL("../dist/http.js", import.meta.url));
const MODERN = "2026-07-28";
const CLIENT_IP = "198.51.100.7";
const LIMITS = { maxFileSizeBytes: 5242880 };
/** Registration order, as tools/list returns it. */
const EXPECTED_TOOL_NAMES = [
  "publish_html", "publish_file", "delete_resource", "get_page", "get_stats",
  "update_html", "publish_json", "update_json", "publish_kv",
  "set_kv", "get_limits", "search_gallery", "set_publication", "make_private", "bind_token", "mint_token",
  "set_domain", "list_domains", "check_domain", "remove_domain",
  "get_page_data", "set_page_data", "configure_page_data", "delete_page_data", "get_guide",
];
const COMPACT_TOOL_NAMES = [
  "publish", "list_publications", "read_publication", "update_publication", "publication_settings",
  "delete_publication", "read_page_data", "write_page_data", "delete_page_data", "domains", "account", "notifications", "get_guide",
];
const COMPACT_TOOL_ANNOTATIONS = {
  publish: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  list_publications: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  read_publication: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  update_publication: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  publication_settings: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  delete_publication: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  read_page_data: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  write_page_data: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  delete_page_data: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  domains: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  account: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  notifications: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  get_guide: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

type Rpc = { id?: number; result?: Record<string, unknown>; error?: { code: number; message: string } };
/** One JSON-RPC exchange in the transport's own framing. */
type Send = (body: Record<string, unknown>, version?: string) => Promise<Rpc>;

const envelope = (version: string) => ({ _meta: { "io.modelcontextprotocol/protocolVersion": version,
  "io.modelcontextprotocol/clientInfo": { name: "protocol-test", version: "0.0.0" }, "io.modelcontextprotocol/clientCapabilities": {} } });

/** Stub BrewPage API on an ephemeral local port; records every request. */
async function backend(t: TestContext, answer: (url: string) => unknown = () => LIMITS) {
  const requests: Array<{ url: string; headers: IncomingHttpHeaders }> = [];
  const api = createServer((req, res) => {
    requests.push({ url: req.url!, headers: req.headers });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(answer(req.url!)));
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
async function stdio(t: TestContext, apiUrl: string, catalog = "legacy"): Promise<Send> {
  const child = spawn(process.execPath, [STDIO_ENTRY], { env: { PATH: process.env.PATH, BREWPAGE_URL: apiUrl,
    BREWPAGE_MCP_CATALOG: catalog || undefined }, stdio: ["pipe", "pipe", "ignore"] });
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
async function httpEntry(t: TestContext, apiUrl: string, catalog = "legacy"): Promise<string> {
  const child = spawn(process.execPath, [HTTP_ENTRY], {
    env: { PATH: process.env.PATH, BREWPAGE_BACKEND_URL: apiUrl, BREWPAGE_TRUSTED_PROXY_CIDRS: "127.0.0.1/32",
      BREWPAGE_MCP_HOST: "127.0.0.1", BREWPAGE_MCP_PORT: "0", BREWPAGE_MCP_CATALOG: catalog || undefined },
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
async function http(t: TestContext, apiUrl: string, catalog = "legacy"): Promise<Send> {
  const url = await httpEntry(t, apiUrl, catalog);
  return async (body, version) => {
    const res = await fetch(url, { method: "POST", body: JSON.stringify(body), headers: {
      "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-Forwarded-For": CLIENT_IP,
      ...(version ? { "MCP-Protocol-Version": version, "Mcp-Method": String(body.method) } : {}),
      ...(version && body.method === "tools/call" ? { "Mcp-Name": String((body.params as { name?: string }).name) } : {}) } });
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
  for (const row of PROTOCOL_MATRIX.slice(0, 2)) {
    test(`${transport} ${row.label} lists annotated compact tools and still runs cached calls`, { timeout: 15_000 }, async (t) => {
      // GIVEN the ordinary entry point with no catalog override.
      const api = await backend(t);
      const send = await connect(t, api.url, "");
      // WHEN the client opens, lists tools and directly calls a cached hidden name.
      const opened = await row.open(send);
      const params = opened.era ? envelope(opened.era) : {};
      const listed = await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params }, opened.era);
      const cached = await send({ jsonrpc: "2.0", id: 3, method: "tools/call",
        params: { ...params, name: "get_json", arguments: { namespace: "public", id: "TestPage01" } } }, opened.era);
      // THEN discovery includes explicit hints and the cached call returns the legacy alias note.
      const text = (cached.result?.content as Array<{ text: string }>)[0].text;
      const tools = listed.result?.tools as Array<{
        name: string; annotations: unknown; inputSchema: { properties: Record<string, { description?: string }> };
      }>;
      const entryHint = (name: string) => tools.find((tool) => tool.name === name)?.inputSchema.properties.entry.description ?? "";
      assert.deepEqual({
        names: tools.map(({ name }) => name), newEntryDefault: /default index\.html/i.test(entryHint("publish")),
        annotations: Object.fromEntries(tools.map(({ name, annotations }) => [name, annotations])),
        updateEntryRequired: /required.*entryFile/i.test(entryHint("update_publication")),
        calls: api.requests.map(({ url }) => url), cachedId: cached.id,
        aliasNote: text.split("\n").at(-1),
      }, { names: COMPACT_TOOL_NAMES, annotations: COMPACT_TOOL_ANNOTATIONS,
        newEntryDefault: true, updateEntryRequired: true, calls: ["/api/json/public/TestPage01"], cachedId: 3,
        aliasNote: "Note: get_json is now get_page (with `type: json`); the old name still works." },
      "compact tool order and explicit annotations, site schemas, and cached call compatibility");
    });
  }
}

test("compact guide recipes work with only discovered tool names", { timeout: 15_000 }, async (t) => {
  // GIVEN an advertised-only client and a deterministic template fixture.
  const publication = { namespace: "public", id: "TestPage01", link: "https://fixture.invalid/" };
  const api = await backend(t, (url) => url.startsWith("/api/templates?") ? { items: [{ slug: "guestbook" }] } : publication);
  const send = await stdio(t, api.url, "");
  await initialize("2025-11-25")(send);
  const list = await send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const allowed = new Set((list.result?.tools as Array<{ name: string }>).map(({ name }) => name));
  const call = async (id: number, name: string, args: Record<string, unknown>) => {
    assert.equal(allowed.has(name), true, `${name} must be discoverable in the compact catalog`);
    const rpc = await send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
    assert.equal(rpc.result?.isError, undefined, `${name} must return the workflow result`);
    return (rpc.result?.content as Array<{ text: string }>)[0].text;
  };
  // WHEN it reads the compact topics, looks up a template and publishes the attributed copy.
  const pageData = await call(3, "get_guide", { topic: "page-data" });
  const templates = await call(4, "get_guide", { topic: "templates" });
  const domains = await call(5, "get_guide", { topic: "custom-domain" });
  const lookup = await call(6, "get_guide", { topic: "templates", q: "guestbook" });
  const receipt = await call(7, "publish", { namespace: "public", content: "<h1>Guestbook</h1>", template: "guestbook", format: "html", state: {} });
  // THEN compact workflows prescribe supported calls, keep the Browser SDK and attribute the copy.
  assert.deepEqual({
    hidden: EXPECTED_TOOL_NAMES.filter((name) => !allowed.has(name) && [pageData, templates, domains].some((text) => new RegExp(`\\b${name}\\b`).test(text))),
    pageData: ["read_page_data", "write_page_data", "publication_settings", "delete_page_data", "https://brewpage.app/js/state.js"].map((needle) => pageData.includes(needle)),
    templates: ["`publish`", "`template`", "`update_publication`"].map((needle) => templates.includes(needle)),
    domains: domains.includes("`domains`"), lookup: lookup.includes('"slug":"guestbook"'), receipt: receipt.includes(publication.link),
    requests: api.requests.map(({ url }) => url),
  }, {
    hidden: [], pageData: [true, true, true, true, true], templates: [true, true, true], domains: true, lookup: true, receipt: true,
    requests: ["/api/templates?q=guestbook", "/api/html?ns=public&format=html&template=guestbook&verbatim=true"],
  }, "compact recipes use listed tools and the template-slug write path");
});

test("cancelling one compact source download prevents its upload on the reusable server", { timeout: 10_000 }, async (t) => {
  // GIVEN the real SDK and a source that stays held after receiving its cancellation signal.
  let start!: (signal?: AbortSignal) => void;
  let release!: (body: Blob) => void;
  const opened = new Promise<AbortSignal | undefined>((resolve) => { start = resolve; });
  const held = new Promise<Blob>((resolve) => { release = resolve; });
  const writes: string[] = [];
  const [clientPipe, serverPipe] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({
    compactFetchSource: async (_url, signal) => { start(signal); return held; },
    fetch: async (url) => { writes.push(String(url)); return Response.json({}); },
  });
  const client = new Client({ name: "cancel-fixture", version: "1.0.0" }, { versionNegotiation: { mode: "legacy" } });
  t.after(async () => { release(new Blob(["cleanup"])); await client.close(); await server.close(); });
  await server.connect(serverPipe);
  await client.connect(clientPipe);
  const abort = new AbortController();
  // WHEN the host cancels the held file call and a second call finishes on the same connection.
  const pending = client.callTool({ name: "publish", arguments: { kind: "file", url: "https://fixture.invalid/report.txt" } }, { signal: abort.signal });
  const signal = await opened;
  assert.equal(signal instanceof AbortSignal, true, "the compact source must receive the SDK request signal");
  const cancelled = once(signal!, "abort");
  abort.abort(new Error("Fixture stopped the download."));
  await assert.rejects(pending, /Fixture stopped the download/, "the cancelled request rejects at the client");
  await cancelled;
  const guide = await client.callTool({ name: "get_guide", arguments: { topic: "publishing" } });
  release(new Blob(["synthetic body"]));
  await new Promise<void>((resolve) => setImmediate(resolve));
  // THEN the completed download causes zero upload effects and the surviving request has a result.
  assert.deepEqual({ cancelled: signal!.aborted, unaffected: guide.isError, writes },
    { cancelled: true, unaffected: undefined, writes: [] }, "the cancelled request cannot start a later upload");
});

test("cancelling a compact legacy-shaped deletion stops before the next entry", { timeout: 10_000 }, async (t) => {
  // GIVEN a held first deletion and one reusable compact connection.
  let start!: (signal: AbortSignal | null) => void;
  let release!: (response: Response) => void;
  const opened = new Promise<AbortSignal | null>((resolve) => { start = resolve; });
  const held = new Promise<Response>((resolve) => { release = resolve; });
  const writes: string[] = [];
  const [clientPipe, serverPipe] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ fetch: async (url, init) => {
    writes.push(new URL(String(url)).pathname);
    start(init?.signal ?? null);
    return held;
  } });
  const client = new Client({ name: "delete-cancel-fixture", version: "1.0.0" }, { versionNegotiation: { mode: "legacy" } });
  t.after(async () => { release(Response.json({ deleted: 1 })); await client.close(); await server.close(); });
  await server.connect(serverPipe);
  await client.connect(clientPipe);
  // WHEN the host cancels the no-kind call after its first ID starts and the backend completes that request.
  const abort = new AbortController();
  const pending = client.callTool({ name: "delete_page_data", arguments: {
    namespace: "public", id: "FixLink001", ownerToken: "fixture-proof", collection: "guestbook", docIds: ["first", "second"],
  } }, { signal: abort.signal });
  const signal = await opened;
  assert.equal(signal instanceof AbortSignal, true, "the legacy-shaped dispatch receives the scoped SDK signal");
  const cancelled = once(signal!, "abort");
  abort.abort(new Error("Fixture stopped the delete."));
  await assert.rejects(pending, /Fixture stopped the delete/, "the original host call reports cancellation");
  await cancelled;
  release(Response.json({ deleted: 1 }));
  const guide = await client.callTool({ name: "get_guide", arguments: { topic: "publishing" } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  // THEN the accepted first item and the unrelated call are the only results.
  assert.deepEqual({ writes, guide: guide.isError, cancelled: signal!.aborted }, {
    writes: ["/api/public/FixLink001/state/guestbook/docs/first"], guide: undefined, cancelled: true,
  }, "the cancelled no-kind call never dispatches a later deletion");
});

test("invalid explicit stdio identity options refuse before dispatch; deliberate anonymous and custom REST still start", { timeout: 10_000 }, async () => {
  // GIVEN standalone process inputs, each with deterministic discovery and no backend calls.
  const fixtureOrigin = "https://deployment.fixture.invalid";
  const cases = [
    { args: [], env: { BREWPAGE_MCP_RESOURCE_URL: "https://brewpage.app/mcp/" }, error: /exact same-origin HTTPS/ },
    { args: [], env: { BREWPAGE_MCP_RESOURCE_URL: "" }, error: /exact same-origin HTTPS/ },
    { args: [], env: { BREWPAGE_MCP_STATE_DIR: "relative-fixture-state" }, error: /must be an absolute path/ },
    { args: ["--scope", "publications:write"], env: {}, error: /BrewPage scope/ },
    { args: ["login", "--scope", "fixture:unknown"], env: {}, error: /BrewPage scope/ },
    { args: ["login", "--scope"], env: {}, error: /BrewPage scope/ },
    { args: ["--anonymous"], env: { BREWPAGE_MCP_RESOURCE_URL: "https://brewpage.app/mcp/" }, error: null },
    { args: [], env: { BREWPAGE_URL: fixtureOrigin, BREWPAGE_MCP_RESOURCE_URL: fixtureOrigin + "/mcp" }, error: null },
  ];
  // WHEN each built process receives a discovery request and closes stdin.
  const outcomes = await Promise.all(cases.map(async ({ args, env }) => {
    const child = spawn(process.execPath, [STDIO_ENTRY, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    const out: string[] = [];
    const err: string[] = [];
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => out.push(chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => err.push(chunk));
    child.stdin.on("error", () => undefined);
    const exit = once(child, "close");
    child.stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");
    const [code] = await exit;
    return { code, stdout: out.join(""), stderr: err.join("") };
  }));
  // THEN invalid selections never enter the protocol; the two intentional local modes list exactly 13.
  for (const [index, { error }] of cases.entries()) {
    const result = outcomes[index];
    assert.deepEqual({ code: result.code, error: error?.test(result.stderr) ?? result.stderr,
      tools: result.stdout ? JSON.parse(result.stdout).result.tools.map(({ name }: { name: string }) => name) : [] },
      error ? { code: 1, error: true, tools: [] } : { code: 0, error: "", tools: COMPACT_TOOL_NAMES },
      `stdio startup should apply the explicit configuration for case ${index}`);
  }
});

for (const [transport, connect] of [["stdio", stdio], ["HTTP", http]] as const) {
  for (const row of PROTOCOL_MATRIX) {
    test(`${transport} ${row.label} negotiates ${row.negotiated} and lists all 25 tools`, { timeout: 15_000 }, async (t) => {
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

/** Only the local server names the env default of the owner token. */
const serverInstructions = (envDefault: string) => [
  "BrewPage publishes HTML, Markdown, sites, files, JSON and KV and returns a share link plus an owner token. Give the user the page link and the management link from the result; the management link is private: whoever has it can edit or delete the page and read what visitors saved. " +
    `Keep the owner token: it cannot be recovered, and every later call for that publication takes it as ownerToken${envDefault}.`,
  "Shared arguments. namespace: public = listed in the gallery and sitemap and indexed by Google, Bing and AI search, for anything meant to be found; omitted = private (a generated priv-* namespace, unlisted, opened only by its link); JSON and KV are never listed. " +
    "ttlDays: up to 30 days without an account, up to 90 with a free profile (an ownerToken held in the profile); omitted = the default. password: readers must enter it. " +
    "deliveryMode: path = a brewpage.app link, subdomain = the publication's own subdomain; omitted = chosen by type. Owner tokens and management links never go into published content; other secrets fit a private namespace plus a password.",
  "A page that must save what its visitors enter (form answers, guestbook, votes, scores, game progress) needs Page data, so read get_guide topic page-data BEFORE writing the page, then publish with the state argument. " +
    "get_page_data reads it, set_page_data writes author entries, configure_page_data changes settings, delete_page_data moderates; each takes namespace, id and ownerToken, or the management link as manageUrl. " +
    "For a form, poll, quiz, RSVP, guestbook or game first look for a ready template: get_guide topic templates.",
  "HTML pages and sites show a small BrewPage badge; page code must not hide or alter it. A profile can turn it off on up to 5 pages (set_publication).",
  "A custom domain, only when the user asks for their own domain: set_domain, the user creates the returned DNS records, check_domain once, then list_domains until it is active. Steps and fixes: get_guide topic custom-domain.",
].join("\n");
const INSTRUCTIONS_BY_TRANSPORT = {
  stdio: { text: serverInstructions(" (local server: env BREWPAGE_OWNER_TOKEN is the default)"), firstParagraph: 448 },
  HTTP: { text: serverInstructions(""), firstParagraph: 392 },
};

for (const [transport, connect] of [["stdio", stdio], ["HTTP", http]] as const) {
  const SERVER_INSTRUCTIONS = INSTRUCTIONS_BY_TRANSPORT[transport].text;
  for (const row of [
    { label: `server/discover ${MODERN}`, method: "server/discover", params: envelope(MODERN), version: MODERN },
    { label: "initialize 2025-11-25", method: "initialize", version: undefined,
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "protocol-test", version: "0.0.0" } } },
  ]) {
    test(`${transport} ${row.label} returns the exact server instructions`, { timeout: 15_000 }, async (t) => {
      // GIVEN the built entry on a stub API.
      const api = await backend(t);
      const send = await connect(t, api.url);
      // WHEN the client opens the connection.
      const { result } = await send({ jsonrpc: "2.0", id: 1, method: row.method, params: row.params }, row.version);
      // THEN five instruction paragraphs, first within 512 chars, no API call, no "data:" (directory probes read it as SSE).
      assert.deepEqual({ instructions: result?.instructions, paragraphs: SERVER_INSTRUCTIONS.split("\n").length,
        firstParagraph: SERVER_INSTRUCTIONS.split("\n")[0].length, upstream: api.requests.length,
        sseMarkers: JSON.stringify(result).split("data:").length - 1 },
      { instructions: SERVER_INSTRUCTIONS, paragraphs: 5, firstParagraph: INSTRUCTIONS_BY_TRANSPORT[transport].firstParagraph, upstream: 0,
        sseMarkers: 0 },
      `${transport} ${row.label}: server instructions`);
    });
  }
}

for (const scenario of [
  { transport: "stdio", mode: "auto", negotiated: MODERN, userAgent: `brewpage-mcp/${PACKAGE_VERSION} (stdio)` },
  { transport: "stdio", mode: "legacy", negotiated: "2025-11-25", userAgent: `brewpage-mcp/${PACKAGE_VERSION} (stdio)` },
  { transport: "HTTP", mode: "auto", negotiated: MODERN, userAgent: `brewpage-mcp/${PACKAGE_VERSION} (remote)` },
  { transport: "HTTP", mode: "legacy", negotiated: "2025-11-25", userAgent: `brewpage-mcp/${PACKAGE_VERSION} (remote)` },
] as const) {
  test(`SDK client in ${scenario.mode} mode over ${scenario.transport} negotiates ${scenario.negotiated} and calls a tool`, { timeout: 15_000 }, async (t) => {
    // GIVEN the built entry on a stub API and an SDK v2 client.
    const api = await backend(t);
    const client = new Client({ name: "protocol-test", version: "0.0.0" }, { versionNegotiation: { mode: scenario.mode } });
    t.after(() => client.close());
    const transport = scenario.transport === "stdio"
      ? new StdioClientTransport({ command: process.execPath, args: [STDIO_ENTRY], env: { BREWPAGE_URL: api.url,
        BREWPAGE_MCP_CATALOG: "legacy" }, stderr: "ignore" })
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

for (const row of [
  { era: MODERN, method: "resources/list", status: 404 },
  { era: MODERN, method: "prompts/list", status: 404 },
  { era: "2025-11-25", method: "resources/list", status: 200 },
  { era: "2025-11-25", method: "prompts/list", status: 200 },
] as const) {
  test(`HTTP ${row.era} answers undeclared ${row.method} with -32601 on HTTP ${row.status}`, { timeout: 15_000 }, async (t) => {
    // GIVEN the HTTP entry, which declares only the tools capability.
    const api = await backend(t);
    const url = await httpEntry(t, api.url);
    // WHEN a client of this era calls a method the server never declared.
    const modern = row.era === MODERN;
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      "X-Forwarded-For": CLIENT_IP, "MCP-Protocol-Version": row.era, ...(modern ? { "Mcp-Method": row.method } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: row.method, params: modern ? envelope(MODERN) : {} }) });
    // THEN 2026-07-28 Streamable HTTP mandates 404 + -32601, the stateless 2025 era answers it in-band on 200.
    assert.deepEqual({ status: res.status, body: await res.json(), upstream: api.requests.length },
      { status: row.status, body: { jsonrpc: "2.0", id: 7, error: { code: -32601, message: "Method not found" } }, upstream: 0 },
      `${row.era} ${row.method}: HTTP status and JSON-RPC error`);
  });
}
