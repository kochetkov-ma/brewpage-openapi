import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { chmod, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { COMPACT_TOOL_NAMES, LEGACY_TOOL_NAMES } from "../dist/compact/context.js";
import { CLIENT_ID, CredentialStore, type Credential, macKeychain, type Vault } from "../dist/native/credentials.js";
import { nativeLoginScope, nativeOAuth, nativeSession } from "../dist/native/oauth.js";
import { mcpRelay, serveAccountStdio } from "../dist/native/remote.js";

const issuer = "https://account.fixture.invalid";
const resource = "https://publish.fixture.invalid/mcp";
const deployment = { issuer, resource };
const binding = "087f90d4-ba9f-4c6e-b6b0-4780d08e44ca";
const metadata = { issuer, authorization_endpoint: `${issuer}/oauth2/authorize`, token_endpoint: `${issuer}/oauth2/token`,
  revocation_endpoint: `${issuer}/oauth2/revoke`, response_types_supported: ["code"], token_endpoint_auth_methods_supported: ["none"],
  code_challenge_methods_supported: ["S256"], authorization_response_iss_parameter_supported: true };
const fresh = { token_type: "Bearer", access_token: "fixture_access", refresh_token: "fixture_refresh", expires_in: 600, scope: "publications:write" };
const credential: Credential = { version: 1, binding, clientId: CLIENT_ID, ...deployment, scope: fresh.scope, accessToken: fresh.access_token,
  refreshToken: fresh.refresh_token, expiresAt: 1 };

test("macOS Keychain saves and removes only its synthetic fixture item", { skip: process.platform !== "darwin" }, async () => {
  // GIVEN a fresh test item and a synthetic value.
  const vault = macKeychain();
  const key = `fixture-${randomUUID()}`;
  const stored = Buffer.from("synthetic-brewpage-credential").toString("base64url");
  assert.equal(await vault.get(key), undefined, "fixture item is absent");
  // WHEN the helper writes and reads the item through Keychain.
  try {
    await vault.set(key, stored);
    assert.equal(await vault.get(key), stored, "fixture item round-trips through Keychain");
  } finally {
    await vault.remove(key);
  }
  // THEN the fixture item is removed.
  assert.equal(await vault.get(key), undefined, "the fixture leaves no Keychain item");
});

for (const row of [
  { requested: undefined, scope: "publications:write" },
  { requested: ["account:read", "page-data:write", "account:read"], scope: "account:read page-data:write" },
]) test(`explicit CLI OAuth binds loopback consent and grant to ${row.scope}`, async () => {
  // GIVEN a synthetic discovery, public-client exchange, forced refresh and revoke endpoint.
  const requests: Array<Record<string, string>> = [];
  let browser!: URL;
  const json = (value: unknown) => Response.json(value);
  const token = (body: Record<string, string>) => {
    requests.push(body);
    const grant = { ...fresh, scope: row.scope };
    return json(body.grant_type === "refresh_token" ? { ...grant, access_token: "next_access", refresh_token: "next_refresh" } : grant);
  };
  const routes: Record<string, (body: Record<string, string>) => Response> = {
    "https://publish.fixture.invalid/.well-known/oauth-protected-resource/mcp": () => json({ resource, authorization_servers: [issuer] }),
    [`${issuer}/.well-known/oauth-authorization-server`]: () => json(metadata),
    [metadata.token_endpoint]: token,
    [metadata.revocation_endpoint]: (body) => { requests.push(body); return new Response(null, { status: 200 }); },
  };
  const request: typeof fetch = async (input, init) => routes[String(input)](Object.fromEntries(new URLSearchParams(String(init?.body ?? ""))));
  const oauth = nativeOAuth(deployment, request, async (destination) => {
    browser = destination;
    const callback = new URL(destination.searchParams.get("redirect_uri")!);
    const query = { code: "fixture-code", state: destination.searchParams.get("state")!, iss: issuer };
    callback.search = new URLSearchParams({ ...query, state: "another-request" }).toString();
    const wrongState = await fetch(callback);
    callback.search = new URLSearchParams({ ...query, iss: "https://another.fixture.invalid" }).toString();
    const wrongIssuer = await fetch(callback);
    callback.search = new URLSearchParams(query).toString();
    const accepted = await fetch(callback);
    assert.deepEqual([wrongState.status, wrongIssuer.status, accepted.status], [400, 400, 200], "invalid callbacks leave the actual login pending");
  });
  // WHEN an explicit login is followed by a rotating refresh and logout.
  await assert.rejects(() => oauth.login(["unknown:scope"]), /supported BrewPage OAuth permissions/, "unknown scope cannot start OAuth");
  assert.throws(() => nativeLoginScope([]), /supported BrewPage OAuth permissions/, "an empty explicit scope set fails closed");
  const stored = await oauth.login(row.requested);
  const rotated = await oauth.refresh(stored);
  await oauth.revoke(rotated);
  const verifier = requests[0].code_verifier;
  const callback = new URL(browser.searchParams.get("redirect_uri")!);
  // THEN both OAuth grants use the intended public client and exact resource.
  assert.deepEqual({
    browser: [browser.origin + browser.pathname, callback.hostname, callback.pathname, browser.searchParams.get("scope"),
      browser.searchParams.get("code_challenge_method"), browser.searchParams.get("code_challenge")],
    requests, rotation: [rotated.binding, rotated.accessToken, rotated.refreshToken, stored.scope, rotated.scope],
  }, {
    browser: [metadata.authorization_endpoint, "127.0.0.1", "/oauth/callback", row.scope, "S256", createHash("sha256").update(verifier).digest("base64url")],
    requests: [
      { grant_type: "authorization_code", code: "fixture-code", code_verifier: verifier, redirect_uri: callback.href, client_id: CLIENT_ID, resource },
      { grant_type: "refresh_token", refresh_token: fresh.refresh_token, client_id: CLIENT_ID, resource },
      { token: "next_refresh", token_type_hint: "refresh_token", client_id: CLIENT_ID, resource },
    ],
    rotation: [stored.binding, "next_access", "next_refresh", row.scope, row.scope],
  }, "identity and token rotation stay bound to the same resource and grant");
});

const rotateFixture = (stored: Credential) => ({ ...stored, refreshToken: "rotated_refresh", accessToken: "rotated_access", expiresAt: Date.now() + 600_000 });
for (const row of [
  { fault: "exchange", rotate: () => { throw new Error("Synthetic receipt loss."); }, persist: (write: () => void) => write(), revocations: [] },
  { fault: "save", rotate: rotateFixture, persist: () => { throw new Error("Synthetic write fault."); }, revocations: ["rotated_refresh"] },
  { fault: "readback", rotate: rotateFixture, persist: () => undefined, revocations: ["rotated_refresh"] },
]) test(`refresh ${row.fault} failure leaves the grant pending across sessions`, async (t) => {
  // GIVEN an expired selected grant in an isolated state directory and a synthetic vault.
  const dir = await mkdtemp(join(tmpdir(), "brewpage-refresh-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "selection");
  const entries = new Map<string, string>();
  let failing = false;
  const vault: Vault = {
    async get(key) { return entries.get(key); },
    async set(key, encoded) {
      const persist = () => { entries.set(key, encoded); };
      failing ? row.persist(persist) : persist();
    },
    async remove(key) { entries.delete(key); },
  };
  const store = new CredentialStore(deployment, undefined, root, vault);
  await store.lock(() => store.select(credential));
  const restarted = new CredentialStore(deployment, undefined, root, vault);
  const isolated = new CredentialStore(deployment, undefined, join(dir, "unselected"), vault);
  const choice = { source: "vault", binding } as const;
  assert.deepEqual([await restarted.selected(), await isolated.selected()], [choice, undefined],
    "the persisted selection belongs only to its configured state directory");
  const exchanges: string[] = [];
  const revocations: string[] = [];
  const oauth = {
    async refresh(stored: Credential) {
      exchanges.push(stored.refreshToken);
      return row.rotate(stored);
    },
    login: async () => credential,
    async revoke(stored: Credential) { revocations.push(stored.refreshToken); },
  };
  const session = nativeSession(store, choice, oauth);
  const rejectedCheckpoint = t.mock.method(store, "beginRefresh", async () => { throw new Error("Synthetic checkpoint fault."); });
  await assert.rejects(() => session.token(), /Reconnect BrewPage/, "a rejected checkpoint stops before the exchange");
  rejectedCheckpoint.mock.restore();
  assert.deepEqual(exchanges, [], "the issuer received no refresh without the durable checkpoint");
  // WHEN the first exchange might rotate and persistence becomes usable again.
  failing = true;
  await assert.rejects(() => session.token(), /Reconnect BrewPage/, "an exchange without confirmed persistence requires recovery");
  failing = false;
  // THEN neither client attempts to rotate the old refresh or falls back to an unsigned selection.
  await assert.rejects(() => session.token(), /Reconnect BrewPage/, "the original session does not replay the old refresh");
  await assert.rejects(() => nativeSession(restarted, choice, oauth).token(), /Reconnect BrewPage/, "a restart does not replay the old refresh");
  assert.deepEqual({ selected: await restarted.selected(), stored: await restarted.read(choice), exchanges, revocations }, {
    selected: choice, stored: credential, exchanges: [credential.refreshToken], revocations: row.revocations,
  }, "only the original refresh goes to the issuer, with the possibly issued replacement revoked when known");
});

test("protected credential file serializes rotating refresh and rejects wrong deployment or permissions", async (t) => {
  // GIVEN two independent clients selecting the same expired grant.
  const dir = await mkdtemp(join(tmpdir(), "brewpage-oauth-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "grant.json");
  const lockRoot = join(dir, "selection");
  await writeFile(file, JSON.stringify(credential), { mode: 0o600 });
  const stores = [new CredentialStore(deployment, file, lockRoot), new CredentialStore(deployment, file, lockRoot)];
  const choices = await Promise.all(stores.map((store) => store.selected()));
  let attempts = 0;
  const oauth = {
    async refresh(stored: Credential) { attempts++; return { ...stored, accessToken: "rotated_access", refreshToken: "rotated_refresh", expiresAt: Date.now() + 100_000 }; },
    login: async () => credential, revoke: async () => undefined,
  };
  // WHEN both clients fetch a token and the selected authorization is subsequently rejected.
  const sessions = stores.map((store, index) => nativeSession(store, choices[index]!, oauth));
  const tokens = await Promise.all(sessions.map((session) => session.token()));
  await sessions[0].invalidate("rotated_access");
  // THEN only one rotation happened, neither client can renew a rejected selection and an unsafe file is refused.
  assert.deepEqual({ attempts, tokens, choices }, { attempts: 1, tokens: ["rotated_access", "rotated_access"],
    choices: [{ source: "file", binding }, { source: "file", binding }] }, "the OS lock serializes refresh across independent stores");
  await assert.rejects(() => sessions[1].token(), /Reconnect BrewPage/, "a rejected grant stays selected and blocked");
  await assert.rejects(() => new CredentialStore({ ...deployment, issuer: "https://another.fixture.invalid" }, file, lockRoot).selected(),
    /another BrewPage connection/, "a different issuer cannot use the credential");
  const alias = join(dir, "alias.json");
  await symlink(file, alias);
  await assert.rejects(() => new CredentialStore(deployment, alias, lockRoot).selected(), /opened safely/, "symbolic links are refused");
  await chmod(file, 0o640);
  await assert.rejects(() => stores[0].selected(), /owner-only regular 0600/, "group-readable tokens are refused");
});

test("a signed stdio relay keeps cached names, version headers and scope failures at the exact HTTPS endpoint", async () => {
  // GIVEN a connected grant and a synthetic stateless remote server.
  const sent: unknown[] = [];
  const blocked: string[] = [];
  const refusal = (id: number, status: number, text: string, challenge: string) => Response.json({ jsonrpc: "2.0", id,
    result: { isError: true, content: [{ type: "text", text }] } }, { status, headers: { "WWW-Authenticate": challenge } });
  const answers = new Map([
    [8, () => Response.json({ jsonrpc: "2.0", id: 8,
      result: { _meta: { "io.modelcontextprotocol/serverInfo": { name: "brewpage-mcp", version: "3.0.0" } } } })],
    [9, () => refusal(9, 401, "Grant revoked.", 'Bearer error="invalid_token"')],
    [10, () => refusal(10, 403, "Grant lacks permissions.", `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", resource)}", error="insufficient_scope", scope="account:read"`)],
  ]);
  const relay = mcpRelay(resource, { token: async () => "fixture_access", invalidate: async (token) => { blocked.push(token); } }, async (input, init) => {
    const message = JSON.parse(String(init?.body));
    const headers = new Headers(init?.headers);
    sent.push([String(input), init?.redirect, headers.get("Authorization"), headers.get("Mcp-Method"), headers.get("Mcp-Name"), headers.get("MCP-Protocol-Version")]);
    return answers.get(message.id)!();
  });
  // WHEN a modern handshake succeeds and the next cached call receives grant revocation.
  const modern = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };
  await relay({ jsonrpc: "2.0", id: 8, method: "server/discover", params: { _meta: modern } });
  const pending = await relay({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "account", arguments: { action: "status" }, _meta: modern } });
  const result = await relay({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "publish_site", arguments: { entryContent: "<h1>Site</h1>" },
    _meta: modern } });
  // THEN the relay forwards one signed request and marks the grant blocked without retry.
  assert.deepEqual({ sent, blocked, result, pending }, { sent: [
    [resource, "error", "Bearer fixture_access", "server/discover", null, "2026-07-28"],
    [resource, "error", "Bearer fixture_access", "tools/call", "account", "2026-07-28"],
    [resource, "error", "Bearer fixture_access", "tools/call", "publish_site", "2026-07-28"],
  ],
    blocked: ["fixture_access"], result: { jsonrpc: "2.0", id: 9, result: { isError: true, content: [{ type: "text", text: "Grant revoked." }] } },
    pending: { jsonrpc: "2.0", id: 10, result: { isError: true, content: [{ type: "text", text: "Grant lacks permissions." },
      { type: "text", text: "This action is pending. Reconnect BrewPage explicitly, then submit the action again. Run brewpage-mcp login --scope account:read. Repeat --scope for any permissions to keep. Restart your MCP client after consent." }] } } },
  "the selected resource receives all signed calls and their one response");
});

test("signed stdio cancels individual requests before transport and during fetch", { timeout: 5_000 }, async (t) => {
  // GIVEN a signed wire with one pending write, an independent read and a delayed token lookup.
  const input = new PassThrough();
  const output = new PassThrough();
  const pipes = new StdioServerTransport(input, output);
  t.after(() => pipes.close());
  const events = new EventEmitter();
  const token = async () => "fixture_access";
  const waiting = (signal?: AbortSignal) => new Promise<string>((resolve) => {
    signal!.addEventListener("abort", () => { events.emit("lookup-aborted"); resolve("fixture_access"); }, { once: true });
    events.emit("lookup-started");
  });
  const lookups = [token, token, token, waiting];
  const session = { token: (signal?: AbortSignal) => lookups.shift()!(signal), invalidate: async () => undefined };
  const sent: unknown[] = [];
  const replies: unknown[] = [];
  const aborted: unknown[] = [];
  const ready = once(events, "continue-read");
  const respond = (id: number | string, result: object) => Response.json({ jsonrpc: "2.0", id, result });
  const routes = new Map<number | string, (signal: AbortSignal) => Response | Promise<Response>>([
    [0, () => respond(0, { _meta: { "io.modelcontextprotocol/serverInfo": { name: "brewpage-mcp", version: "3.0.0" } } })],
    [1, (signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted.push(1); events.emit("write-aborted"); reject(signal.reason); }, { once: true });
      events.emit("write-started");
    })],
    ["1", async (signal) => {
      events.emit("read-started");
      await ready;
      signal.throwIfAborted();
      return respond("1", { content: [{ type: "text", text: "Independent read completed." }] });
    }],
  ]);
  const request: typeof fetch = async (_input, init) => {
    const { id, method } = JSON.parse(String(init?.body));
    sent.push([id, method]);
    return routes.get(id)!(init!.signal!);
  };
  const send = (message: object) => input.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const call = (id: number | string, name: string) => send({ id, method: "tools/call", params: { name } });
  const cancel = (id: number) => send({ method: "notifications/cancelled", params: { requestId: id } });
  output.on("data", (chunk) => { replies.push(JSON.parse(String(chunk))); });
  await serveAccountStdio(resource, session, undefined, pipes, request);
  const handshake = once(output, "data");
  send({ id: 0, method: "server/discover" });
  await handshake;
  replies.length = 0;
  // WHEN two requests are cancelled while an independent request shares the connection.
  const writeStarted = once(events, "write-started");
  call(1, "publish");
  await writeStarted;
  const readStarted = once(events, "read-started");
  call("1", "get_publication");
  await readStarted;
  const lookupStarted = once(events, "lookup-started");
  call(2, "publish");
  await lookupStarted;
  const cancellations = Promise.all([once(events, "write-aborted"), once(events, "lookup-aborted")]);
  cancel(1);
  cancel(2);
  await cancellations;
  const reply = once(output, "data");
  events.emit("continue-read");
  await reply;
  // THEN cancellation interrupts only the original fetches and the other response arrives.
  assert.deepEqual({ sent, aborted, replies }, {
    sent: [[0, "server/discover"], [1, "tools/call"], ["1", "tools/call"]], aborted: [1],
    replies: [{ jsonrpc: "2.0", id: "1", result: { content: [{ type: "text", text: "Independent read completed." }] } }],
  }, "cancellation neither dispatches a separate HTTP notification nor replays the original write");
});

test("account relay blocks cached writes until the remote advertises a compatible major", async () => {
  // GIVEN a signed relay backed by an old server which accepts a discovery request.
  const contacted: string[] = [];
  const session = { token: async () => "fixture_access", invalidate: async () => undefined };
  const relay = mcpRelay(resource, session, async (_input, init) => {
    const { id, method } = JSON.parse(String(init?.body));
    contacted.push(method);
    return Response.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-11-25", capabilities: {},
      serverInfo: { name: "brewpage-mcp", version: "2.1.2" } } });
  }, "legacy");
  // WHEN a cached write arrives before and after the incompatible handshake.
  const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "publish_html", arguments: { content: "<p>Fixture</p>" } } } as const;
  const early = await relay(call);
  const hello = await relay({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {},
    clientInfo: { name: "fixture", version: "1.0.0" } } });
  const later = await relay({ ...call, id: 3 });
  // THEN only the read-only handshake reaches the remote, with no account or guest mutation.
  const error = { code: -32000, message: "Account mode requires a compatible BrewPage MCP 3.x server." };
  assert.deepEqual({ contacted, replies: [early, hello, later] }, { contacted: ["initialize"],
    replies: [1, 2, 3].map((id) => ({ jsonrpc: "2.0", id, error })) },
  "both write attempts stop locally until a compatible authenticated handshake succeeds");
});

test("explicit anonymous stdio suppresses both selected account credentials and stored owner proof", async (t) => {
  // GIVEN an ordinary local backend, a forced nonexistent credential file and a configured default owner token.
  const requests: unknown[] = [];
  const backend = createServer((req, res) => {
    requests.push([req.url, req.headers.authorization, req.headers["x-owner-token"]]);
    res.writeHead(200, { "Content-Type": "application/json" }).end('{"maxFileSizeBytes":5242880}');
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const client = new Client({ name: "native-anonymous-test", version: "1.0.0" });
  t.after(async () => { await client.close(); backend.closeAllConnections(); await new Promise<void>((resolve) => backend.close(() => resolve())); });
  const base = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
  // WHEN the client starts stdio in explicit anonymous mode and calls a cached tool.
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js", "--anonymous"], stderr: "pipe",
    env: { BREWPAGE_URL: base, BREWPAGE_MCP_CREDENTIAL_FILE: "/nonexistent/brewpage-fixture", BREWPAGE_OWNER_TOKEN: "A".repeat(32) } }));
  const response = await client.callTool({ name: "get_limits", arguments: {} });
  // THEN the built executable negotiates clean stdio and sends no implicit credential.
  assert.deepEqual({ requests, response }, { requests: [["/api/limits", undefined, undefined]],
    response: { content: [{ type: "text", text: 'BrewPage limits (sizes in bytes, TTLs in days):\n\n{"maxFileSizeBytes":5242880}' }] } },
  "explicit anonymous mode does not read or use either stored proof");
});

test("anonymous stdio publishes HTML only when its managed selection is configured", async (t) => {
  // GIVEN a backend and a local stdio process with both recovery and narrow selections.
  const requests: unknown[] = [];
  const backend = createServer((req, res) => {
    requests.push([req.method, req.url]);
    res.writeHead(201, { "Content-Type": "application/json" }).end('{"namespace":"public","id":"Example123","link":"https://publication.fixture.invalid/"}');
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const client = new Client({ name: "native-narrow-test", version: "1.0.0" });
  t.after(async () => { await client.close(); backend.closeAllConnections(); await new Promise<void>((resolve) => backend.close(() => resolve())); });
  const base = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js", "--anonymous"], stderr: "pipe",
    env: { BREWPAGE_URL: base, BREWPAGE_MCP_CATALOG: "legacy", BREWPAGE_MCP_TOOL_SELECTION: "publish_html" } }));
  // WHEN the client discovers tools and submits allowed and denied publication types.
  const names = (await client.listTools()).tools.map(({ name }) => name);
  const outcomes = await Promise.all([
    client.callTool({ name: "publish", arguments: { content: "a" } }),
    client.callTool({ name: "publish_site", arguments: { entryContent: "a" } }),
    client.callTool({ name: "publish_html", arguments: { files: [{ path: "index.html", content: "a" }] } }),
    client.callTool({ name: "publish_html", arguments: { kind: "kv", content: "a" } }),
    client.callTool({ name: "publish_html", arguments: { namespace: "public", content: "<p>Allowed</p>" } }),
  ]);
  // THEN only the original HTML operation reaches the backend.
  assert.deepEqual({ names, refused: outcomes.map((reply) => reply.isError === true), requests },
    { names: ["publish_html"], refused: [true, true, true, true, false], requests: [["POST", "/api/html?ns=public"]] },
    "narrow stdio retains the old descriptor and blocks wider dispatch");
});

test("fresh connected stdio sessions honor their catalog and use the same protected grant", { timeout: 15_000 }, async (t) => {
  // GIVEN a TLS fixture and a protected file provisioned for that exact resource.
  const dir = await mkdtemp(join(tmpdir(), "brewpage-relay-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
    "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const trace: unknown[][] = [];
  const oauthTrace: unknown[][] = [];
  const content = [{ type: "text", text: "Account publication fixture outcome." }];
  const state = join(dir, "selection");
  let base!: string;
  let actualResource!: string;
  const documents: Record<string, () => object> = {
    "/.well-known/oauth-protected-resource/mcp": () => ({ resource: actualResource, authorization_servers: [base] }),
    "/.well-known/oauth-authorization-server": () => ({ ...metadata, issuer: base, authorization_endpoint: base + "/oauth2/authorize",
      token_endpoint: base + "/oauth2/token", revocation_endpoint: base + "/oauth2/revoke" }),
    "/oauth2/token": () => ({ ...fresh, access_token: "next_access", refresh_token: "next_refresh" }),
  };
  const handlers: Record<string, unknown> = {
    initialize: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "brewpage-mcp", version: "3.0.0" } },
    "tools/call": { content },
  };
  const endpoint = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, async (req, res) => {
    const input = [];
    for await (const chunk of req) input.push(Buffer.from(chunk));
    const raw = Buffer.concat(input).toString("utf8");
    const oauthReply = (document: () => object) => {
      oauthTrace.push([req.url, req.headers.authorization, Object.fromEntries(new URLSearchParams(raw))]);
      return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(document()));
    };
    const mcpReply = () => {
      const message = JSON.parse(raw);
      const selection = req.headers["brewpage-tool-selection"];
      trace.push([req.url, req.headers.authorization, message.method, message.params?.name, message.params?.arguments?.ownerToken, selection]);
      const names = selection === "legacy" ? LEGACY_TOOL_NAMES : selection === "publish_html" ? ["publish_html"] : COMPACT_TOOL_NAMES;
      const result = message.method === "tools/list" ? { tools: names.map((name) => ({ name, inputSchema: { type: "object" } })) } : handlers[message.method];
      return result ? res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }))
        : res.writeHead(202).end();
    };
    const document = documents[req.url ?? ""];
    return document ? oauthReply(document) : mcpReply();
  });
  endpoint.listen(0, "127.0.0.1");
  await once(endpoint, "listening");
  base = `https://127.0.0.1:${(endpoint.address() as { port: number }).port}`;
  actualResource = base + "/mcp";
  const file = join(dir, "grant.json");
  await writeFile(file, JSON.stringify({ ...credential, resource: actualResource, issuer: base }), { mode: 0o600 });
  t.after(async () => { endpoint.closeAllConnections(); await new Promise<void>((resolve) => endpoint.close(() => resolve())); });
  // WHEN clean processes with the same stored grant request distinct views.
  const cases = [
    { name: "publish", env: {} },
    { name: "update_html", env: { BREWPAGE_MCP_CATALOG: "legacy" } },
    { name: "publish_html", env: { BREWPAGE_MCP_CATALOG: "legacy", BREWPAGE_MCP_TOOL_SELECTION: "publish_html" } },
  ];
  const outcomes = [];
  for (const row of cases) {
    const client = new Client({ name: "native-account-test", version: "1.0.0" }, { versionNegotiation: { mode: "legacy" } });
    t.after(() => client.close());
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], stderr: "pipe",
      env: { BREWPAGE_URL: base, BREWPAGE_MCP_RESOURCE_URL: actualResource, BREWPAGE_MCP_ISSUER: base,
        BREWPAGE_MCP_CREDENTIAL_FILE: file, BREWPAGE_MCP_STATE_DIR: state, BREWPAGE_OWNER_TOKEN: "A".repeat(32),
        NODE_EXTRA_CA_CERTS: certPath, ...row.env } }));
    const names = (await client.listTools()).tools.map(({ name }) => name);
    const call = await client.callTool({ name: row.name, arguments: { content: "<p>Fixture</p>" } });
    const blocked = row.name === "publish_html"
      ? (await client.callTool({ name: "publish_html", arguments: { files: [{ path: "index.html", content: "a" }] } })).isError : undefined;
    outcomes.push({ names, call, blocked });
    await client.close();
  }
  // THEN the original tool calls retain the selected grant and carry no stored owner proof.
  const signedCalls = trace.filter((row) => row[2] === "tools/call");
  const realm = createHash("sha256").update(JSON.stringify([base, actualResource, CLIENT_ID])).digest("hex");
  assert.deepEqual({ outcomes, signedCalls, oauthTrace, state: await readdir(state) }, { outcomes: [
    { names: COMPACT_TOOL_NAMES, call: { content }, blocked: undefined },
    { names: LEGACY_TOOL_NAMES, call: { content }, blocked: undefined },
    { names: ["publish_html"], call: { content }, blocked: true },
  ], signedCalls: [
    ["/mcp", "Bearer next_access", "tools/call", "publish", undefined, undefined],
    ["/mcp", "Bearer next_access", "tools/call", "update_html", undefined, "legacy"],
    ["/mcp", "Bearer next_access", "tools/call", "publish_html", undefined, "publish_html"],
  ], oauthTrace: [
    ["/.well-known/oauth-protected-resource/mcp", undefined, {}],
    ["/.well-known/oauth-authorization-server", undefined, {}],
    ["/oauth2/token", undefined, { grant_type: "refresh_token", refresh_token: fresh.refresh_token, client_id: CLIENT_ID, resource: actualResource }],
  ], state: [`${realm}.lock`] }, "the grant rotates once under the explicitly configured state root and signs all subsequent calls");
});

test("a connected relay does not expose a broader remote catalog when a selector is ignored", async () => {
  // GIVEN a synthetic older remote that returns its compact list despite an explicit selection.
  const selected: (string | null)[] = [];
  const request: typeof fetch = async (_url, init) => {
    selected.push(new Headers(init?.headers).get("BrewPage-Tool-Selection"));
    return Response.json({ jsonrpc: "2.0", id: 1, result: { tools: COMPACT_TOOL_NAMES.map((name) => ({ name, inputSchema: { type: "object" } })) } });
  };
  const session = { token: async () => "fixture_access", invalidate: async () => undefined };
  // WHEN legacy and narrow clients both discover.
  const call = { jsonrpc: "2.0", id: 1, method: "tools/list" } as const;
  const results = await Promise.all(["legacy", "publish_html"].map((mode) => mcpRelay(resource, session, request, mode as "legacy" | "publish_html")(call)));
  // THEN the unexpected lists are refused locally.
  const refusal = { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "The BrewPage server did not return the configured tool catalog." } };
  assert.deepEqual({ selected, results }, { selected: ["legacy", "publish_html"], results: [refusal, refusal] },
    "discovery never silently exposes the server's broader default");
});

test("login --no-browser emits the exact consent URL on stderr and waits for loopback", { skip: process.platform !== "darwin", timeout: 10_000 }, async (t) => {
  // GIVEN a disposable HTTPS issuer and resource, with browser consent cancelled by the fixture.
  const dir = await mkdtemp(join(tmpdir(), "brewpage-manual-login-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes",
    "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  const paths: string[] = [];
  let base!: string;
  const endpoint = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (req, res) => {
    const path = req.url ?? "";
    paths.push(path);
    const documents: Record<string, unknown> = {
      "/.well-known/oauth-protected-resource/mcp": { resource: base + "/mcp", authorization_servers: [base] },
      "/.well-known/oauth-authorization-server": { ...metadata, issuer: base, authorization_endpoint: base + "/oauth2/authorize",
        token_endpoint: base + "/oauth2/token", revocation_endpoint: base + "/oauth2/revoke" },
    };
    res.writeHead(documents[path] ? 200 : 404, { "Content-Type": "application/json" }).end(JSON.stringify(documents[path] ?? {}));
  });
  endpoint.listen(0, "127.0.0.1");
  await once(endpoint, "listening");
  t.after(async () => { endpoint.closeAllConnections(); await new Promise<void>((resolve) => endpoint.close(() => resolve())); });
  base = `https://127.0.0.1:${(endpoint.address() as { port: number }).port}`;
  // WHEN the built entry starts without launching a browser, then receives the cancellation callback.
  const child = spawn(process.execPath, ["dist/index.js", "login", "--no-browser", "--scope", "account:read", "--scope", "publications:read"], { env: {
    BREWPAGE_URL: base, BREWPAGE_MCP_RESOURCE_URL: base + "/mcp", BREWPAGE_MCP_ISSUER: base,
    BREWPAGE_MCP_STATE_DIR: join(dir, "selection"), NODE_EXTRA_CA_CERTS: certPath,
  }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { child.kill(); });
  const done = once(child, "close");
  const stdout: string[] = [];
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => stdout.push(chunk));
  const stderr = createInterface({ input: child.stderr });
  const [line] = await once(stderr, "line") as [string];
  const consent = new URL(line);
  const callback = new URL(consent.searchParams.get("redirect_uri")!);
  callback.search = new URLSearchParams({ error: "access_denied", state: consent.searchParams.get("state")!, iss: base }).toString();
  const accepted = await fetch(callback);
  await accepted.text();
  const [exit] = await done;
  // THEN the terminal destination is scoped to the fixture and no browser, token exchange or MCP framing occurs.
  assert.deepEqual({ stdout, exit, callbackStatus: accepted.status, callbackTarget: [callback.hostname, callback.pathname], paths,
    consent: [consent.origin + consent.pathname, consent.searchParams.get("client_id"), consent.searchParams.get("scope"),
      consent.searchParams.get("resource"), consent.searchParams.get("code_challenge_method")] },
  { stdout: [], exit: 1, callbackStatus: 200, callbackTarget: ["127.0.0.1", "/oauth/callback"],
    paths: ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server"],
    consent: [base + "/oauth2/authorize", CLIENT_ID, "account:read publications:read", base + "/mcp", "S256"] },
  "manual consent stays on the selected deployment and sends credentials only after the existing callback flow");
});
