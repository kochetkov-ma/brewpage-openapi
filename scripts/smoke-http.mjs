import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const [version, catalog, mode] = process.argv.slice(2);
const counts = { legacy: 25, compact: 13 };
assert.match(version ?? "", /^\d+\.\d+\.\d+$/, "Expected an exact runtime version");
assert.ok(Object.hasOwn(counts, catalog), "Select the legacy or compact catalog explicitly");
assert.ok(mode === undefined || (mode === "--hosted" && catalog === "compact"), "Hosted qualification requires compact discovery");
const hosted = mode === "--hosted";
const origin = hosted ? "https://brewpage.app" : "http://127.0.0.1:8787";
const issuer = "https://account.brewpage.app";
const endpoint = origin + "/mcp";
const resourceMetadata = origin + "/.well-known/oauth-protected-resource/mcp";
const request = (url, options) => fetch(url, {
  ...options, redirect: "error", signal: AbortSignal.timeout(8_000),
});

if (!hosted) {
  let healthy = false;
  for (let attempt = 0; attempt <= 30 && !healthy; attempt++) {
    healthy = await request(origin + "/healthz").then((res) => res.ok, () => false);
    if (!healthy) await delay(1_000);
  }
  assert.equal(healthy, true, "Local MCP image failed /healthz readiness");
}

const modern = "2026-07-28";
const clientInfo = { name: "release-smoke", version: "1.0.0" };
const capabilities = {};
const envelope = { _meta: {
  "io.modelcontextprotocol/protocolVersion": modern,
  "io.modelcontextprotocol/clientInfo": clientInfo,
  "io.modelcontextprotocol/clientCapabilities": capabilities,
} };
let nextId = 0;
async function rpc(method, params = {}, { current = false, authorization, status = 200 } = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (!hosted) headers["X-Forwarded-For"] = "203.0.113.7";
  if (current) Object.assign(headers, { "MCP-Protocol-Version": modern, "Mcp-Method": method });
  if (authorization) headers.Authorization = authorization;
  const id = ++nextId;
  const response = await request(endpoint, { method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: current ? { ...params, ...envelope } : params }) });
  assert.equal(response.status, status, `${method} HTTP response`);
  const payload = await response.json();
  assert.equal(payload.id, id, `${method} response id`);
  assert.equal(payload.error, undefined, `${method} RPC response error`);
  return { result: payload.result, headers: response.headers };
}
function names(result) {
  assert.equal(result.tools.length, counts[catalog], `${catalog} tool count`);
  const names = result.tools.map(({ name }) => name).sort();
  assert.equal(new Set(names).size, counts[catalog], `${catalog} unique tool names`);
  return names;
}
const identity = { name: "brewpage-mcp", version };
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities, clientInfo });
assert.deepEqual(init.result.serverInfo, identity, "Initialize runtime identity");
const initializedTools = names((await rpc("tools/list")).result);
const discover = await rpc("server/discover", {}, { current: true });
assert.ok(discover.result.supportedVersions.includes(modern), "Modern protocol discovery");
assert.deepEqual(discover.result._meta["io.modelcontextprotocol/serverInfo"], identity, "Discover runtime identity");
assert.deepEqual(names((await rpc("tools/list", {}, { current: true })).result), initializedTools, "Discovery across both protocol eras");

const refusedDiscovery = await rpc("tools/list", {}, { current: true, authorization: "Bearer release smoke invalid", status: 401 });
assert.equal(refusedDiscovery.result.isError, true, "Malformed bearer is rejected before discovery");
assert.ok(refusedDiscovery.headers.get("www-authenticate")?.includes('error="invalid_token"'), "Invalid bearer discovery challenge");

if (!hosted) {
  const noBridge = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities, clientInfo },
    { authorization: "Bearer release-smoke-invalid", status: 503 });
  assert.equal(noBridge.result.isError, true, "A bearer cannot reach initialization without a configured bridge");
}

if (hosted) {
  const params = { name: "get_limits", arguments: {} };
  const cached = await rpc("tools/call", params);
  assert.equal(cached.result.isError ?? false, false, "Cached read-only tool succeeds after compact activation");
  assert.match(cached.result.content[0].text, /^BrewPage limits/, "Cached limits receipt");
  const refused = await rpc("tools/call", params, { authorization: "Bearer release-smoke-invalid", status: 401 });
  assert.equal(refused.result.isError, true, "Invalid bearer refusal");
  assert.ok(refused.headers.get("www-authenticate")?.startsWith(`Bearer resource_metadata="${resourceMetadata}", error="invalid_token"`),
    "Invalid bearer points to the protected-resource metadata");
  const metadata = await request(resourceMetadata);
  assert.equal(metadata.status, 200, "Hosted protected-resource metadata status");
  const resource = await metadata.json();
  assert.deepEqual({ resource: resource.resource, issuers: resource.authorization_servers, methods: resource.bearer_methods_supported },
    { resource: endpoint, issuers: [issuer], methods: ["header"] }, "Hosted protected-resource identity");
  const server = await request(issuer + "/.well-known/oauth-authorization-server");
  assert.equal(server.status, 200, "Hosted authorization-server metadata status");
  const authorization = await server.json();
  assert.deepEqual({
    issuer: authorization.issuer, authorize: authorization.authorization_endpoint, token: authorization.token_endpoint,
    revoke: authorization.revocation_endpoint, pkce: authorization.code_challenge_methods_supported,
  }, { issuer, authorize: issuer + "/oauth2/authorize", token: issuer + "/oauth2/token",
    revoke: issuer + "/oauth2/revoke", pkce: ["S256"] }, "Hosted OAuth endpoints and PKCE");
  const authorize = await request(authorization.authorization_endpoint);
  assert.equal(authorize.status, 400, "Enabled authorization rejects a request with no parameters");
}
console.log(`HTTP smoke passed: version=${version} catalog=${catalog} tools=${counts[catalog]} discover=${modern}`);
