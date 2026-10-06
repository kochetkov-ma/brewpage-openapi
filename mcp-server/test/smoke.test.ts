import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED_TOOL_NAMES = [
  "publish_html", "publish_file", "delete_resource", "get_page", "get_stats", "publish_site",
  "republish_site", "update_html", "publish_json", "get_json", "update_json", "publish_kv",
  "set_kv", "get_kv", "search_gallery", "update_hosting",
];

const NEW_RESPONSE = {
  id: "aBcDeFgHiJ", namespace: "public", ownerToken: "fixture-owner",
  link: "https://public-z9y8x7w6v5.brewpage.app/", url: "https://brewpage.app/stale-alias",
  managementLink: "https://brewpage.app/manage/html/public/aBcDeFgHiJ", routingCohort: "new-v1",
  deliveryMode: "subdomain", requestedDeliveryMode: "subdomain", effectiveDeliveryMode: "subdomain",
  deliveryModeMatched: true, hostingVersion: 1, modeLocked: false, access: "public",
};

interface RequestSnapshot { method: string; url: string; headers: IncomingHttpHeaders; body: string }

async function fixture(t: TestContext) {
  const requests: RequestSnapshot[] = [];
  let response = { status: 201, body: JSON.stringify(NEW_RESPONSE), headers: {} as Record<string, string> };
  const api = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString() });
    const sourceFile = req.url === "/source-file";
    res.writeHead(sourceFile ? 200 : response.status, { "Content-Type": sourceFile ? "text/plain" : "application/json", ...response.headers });
    res.end(sourceFile ? "fixture file bytes" : response.body);
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  assert.equal(typeof address, "object", "fixture listens on an ephemeral local TCP port");
  assert.notEqual(address, null, "fixture server has a bound address");
  const baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    env: { BREWPAGE_URL: baseUrl }, stderr: "pipe",
  });
  const client = new Client({ name: "contract-smoke-test", version: "0.0.0" });
  t.after(async () => {
    await client.close();
    api.closeAllConnections();
    await new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
  });
  await client.connect(transport);
  return {
    client, requests, baseUrl,
    respond(status: number, data: Record<string, unknown>, headers: Record<string, string> = {}) { response = { status, body: JSON.stringify(data), headers }; },
    respondText(status: number, body: string, headers: Record<string, string>) { response = { status, body, headers }; },
    async call(name: string, args: Record<string, unknown>) {
      return client.callTool({ name, arguments: args }) as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
    },
  };
}

test("MCP exposes exactly 16 tools and optional create-only delivery choice", { timeout: 10_000 }, async (t) => {
  // GIVEN local MCP connected to a synthetic API.
  const f = await fixture(t);
  // WHEN client discovers tools.
  const { tools } = await f.client.listTools();
  // THEN tool set and optional delivery enum match the contract.
  assert.deepEqual(tools.map(({ name }) => name).sort(), [...EXPECTED_TOOL_NAMES].sort(), "registered tool names match the contract");
  for (const name of ["publish_html", "publish_file", "publish_site", "publish_json", "publish_kv"]) {
    const tool = tools.find((item) => item.name === name)!;
    assert.deepEqual((tool.inputSchema.properties!.deliveryMode as { enum: string[] }).enum, ["path", "subdomain"], `${name} advertises both modes`);
    assert.equal(tool.inputSchema.required?.includes("deliveryMode") ?? false, false, `${name} leaves mode optional`);
  }
  assert.equal(f.requests.length, 0, "tool discovery never calls the API");
});

for (const scenario of [
  { name: "publish_html", args: { content: "<h1>Fixture</h1>" }, segment: "html", jsonBody: { content: "<h1>Fixture</h1>" } },
  { name: "publish_json", args: { json: { deliveryMode: "authored value", value: 7 } }, segment: "json", jsonBody: { deliveryMode: "authored value", value: 7 } },
  { name: "publish_kv", args: { key: "fixture", value: "7" }, segment: "kv", jsonBody: { key: "fixture", value: "7" } },
  { name: "publish_site", args: { entryContent: "<h1>Fixture</h1>" }, segment: "sites", jsonBody: undefined },
  { name: "publish_file", args: {}, segment: "files", jsonBody: undefined },
]) {
  test(`${scenario.name} sends delivery header and preserves authoritative root link`, { timeout: 10_000 }, async (t) => {
    // GIVEN NEW subdomain response with a different legacy URL field.
    const f = await fixture(t);
    const args = { ...scenario.args, ...(scenario.name === "publish_file" ? { url: `${f.baseUrl}/source-file` } : {}), namespace: "public", deliveryMode: "subdomain" };
    // WHEN publish runs through stdio and HTTP.
    const result = await f.call(scenario.name, args);
    const request = f.requests.at(-1)!;
    // THEN mode stays in its header and server link retains its root slash.
    assert.equal(result.isError, undefined, "publication succeeds");
    assert.match(request.url, new RegExp(`^/api/${scenario.segment}(?:\\?|$)`), "create uses the configured API origin");
    assert.equal(request.method, "POST", "publish sends POST");
    assert.equal(request.headers["x-delivery-mode"], "subdomain", "explicit choice is a header");
    const actualBody = scenario.jsonBody === undefined ? request.body.includes('name="deliveryMode"') : JSON.parse(request.body);
    assert.deepEqual(actualBody, scenario.jsonBody ?? false, "delivery metadata does not pollute authored JSON or multipart fields");
    assert.match(result.content[0].text, /^URL: https:\/\/public-z9y8x7w6v5\.brewpage\.app\/$/m, "primary link is verbatim");
    assert.match(result.content[0].text, /hostingVersion: 1/, "current version is exposed");
    assert.match(result.content[0].text, /routingCohort: "new-v1"/, "actual cohort is exposed");
  });
}

test("omitted namespace stays generated private and omitted delivery stays absent", { timeout: 10_000 }, async (t) => {
  // GIVEN no visibility or delivery choice.
  const f = await fixture(t);
  f.respond(201, { ...NEW_RESPONSE, namespace: "priv-synthetic", requestedDeliveryMode: null, deliveryModeMatched: null, modeLocked: true, access: "unlisted" });
  // WHEN HTML is published.
  const result = await f.call("publish_html", { content: "<p>Unlisted fixture</p>" });
  // THEN established private default remains independent of hosting.
  const requestUrl = new URL(f.requests[0].url, f.baseUrl);
  assert.match(requestUrl.searchParams.get("ns") ?? "", /^priv-[a-z0-9]{6}$/, "query namespace remains a generated private slug");
  assert.equal(requestUrl.searchParams.get("format"), "html", "default format uses the backend lowercase query value");
  assert.equal(requestUrl.searchParams.has("ttl"), false, "omitted TTL retains the backend default");
  assert.deepEqual(JSON.parse(f.requests[0].body), { content: "<p>Unlisted fixture</p>" }, "JSON contains only the supported content field");
  assert.equal(f.requests[0].headers["x-password"], undefined, "omitted password remains absent");
  assert.equal(f.requests[0].headers["x-delivery-mode"], undefined, "omission invents no requested mode");
  assert.match(result.content[0].text, /Unlisted link/, "private result retains its unlisted notice");
});

for (const scenario of [
  { label: "explicit public", args: { namespace: "public" }, expectedNamespace: "public" },
  { label: "explicit unlisted", args: { namespace: "fixture-private" }, expectedNamespace: "fixture-private" },
  { label: "generated unlisted default", args: {}, expectedNamespace: undefined },
]) {
  test(`publish_file transports ${scenario.label} namespace as ns query without changing multipart file`, { timeout: 10_000 }, async (t) => {
    // GIVEN an HTTP source file and an optional caller namespace.
    const f = await fixture(t);
    // WHEN file publication traverses MCP stdio and HTTP.
    const result = await f.call("publish_file", { url: `${f.baseUrl}/source-file`, filename: "transport-fixture.txt", ...scenario.args });
    // THEN namespace uses FileController's ns query and multipart contains one file.
    assert.equal(f.requests.length, 2, "publication fetches source once and uploads once");
    const request = f.requests[1];
    const requestUrl = new URL(request.url, f.baseUrl);
    const actualNamespace = requestUrl.searchParams.get("ns");
    assert.match(actualNamespace ?? "", scenario.expectedNamespace === undefined ? /^priv-[a-z0-9]{6}$/ : new RegExp(`^${scenario.expectedNamespace}$`), "requested or generated namespace reaches the backend ns parameter");
    assert.deepEqual({ method: request.method, path: requestUrl.pathname, queryKeys: [...requestUrl.searchParams.keys()], deliveryMode: request.headers["x-delivery-mode"] },
      { method: "POST", path: "/api/files", queryKeys: ["ns"], deliveryMode: undefined }, "namespace query adds no other upload capabilities or mode");
    const form = await new Response(request.body, { headers: { "Content-Type": String(request.headers["content-type"]) } }).formData();
    assert.deepEqual([...form.keys()], ["file"], "multipart has only the supported file part");
    const file = form.get("file") as File;
    assert.equal(file.name, "transport-fixture.txt", "caller filename stays in multipart metadata");
    assert.equal(await file.text(), "fixture file bytes", "source file bytes remain exact");
    assert.equal(result.isError, undefined, "corrected file transport succeeds");
  });
}

for (const scenario of [
  { format: "HTML", content: "<h1>Transport fixture</h1>", ttlDays: 1, showTopBar: false },
  { format: "MARKDOWN", content: "# Transport fixture", ttlDays: 30, showTopBar: true },
]) {
  test(`publish_html transports ${scenario.format} format and ${scenario.ttlDays}-day TTL through backend query and headers`, { timeout: 10_000 }, async (t) => {
    // GIVEN all optional HTML fields and a password-protected server result.
    const f = await fixture(t);
    const password = "fixture-transport-password";
    f.respond(201, { ...NEW_RESPONSE, access: "protected" });
    // WHEN HTML publication traverses MCP stdio and HTTP.
    const result = await f.call("publish_html", { ...scenario, namespace: "public", password, filename: "transport-fixture.html", deliveryMode: "subdomain" });
    // THEN query settings, secret header and supported body match HtmlController.
    assert.deepEqual(f.requests.map(({ method, url, headers, body }) => ({
      method, url, headers: { contentType: headers["content-type"], password: headers["x-password"], deliveryMode: headers["x-delivery-mode"] }, body: JSON.parse(body),
    })), [{
      method: "POST", url: `/api/html?ns=public&format=${scenario.format.toLowerCase()}&ttl=${scenario.ttlDays}`,
      headers: { contentType: "application/json", password, deliveryMode: "subdomain" },
      body: { content: scenario.content, filename: "transport-fixture.html", showTopBar: scenario.showTopBar },
    }], "HTML transport matches query day units, headers and DTO body exactly");
    assert.equal(result.isError, undefined, "publication succeeds through the corrected transport");
    assert.equal(result.content[0].text.includes(password), false, "password is not echoed in MCP output");
  });
}

test("public password and path choice remain independent with a clean NEW link", { timeout: 10_000 }, async (t) => {
  // GIVEN protected public Promotion result.
  const f = await fixture(t);
  f.respond(201, { ...NEW_RESPONSE, link: "https://brewpage.app/public/aBcDeFgHiJ", access: "protected", deliveryMode: "path", effectiveDeliveryMode: "path", requestedDeliveryMode: "path" });
  // WHEN JSON is published with password and path choice.
  const result = await f.call("publish_json", { json: "7", namespace: "public", password: "fixture-password", deliveryMode: "path" });
  // THEN password does not override hosting or enter the URL.
  assert.equal(f.requests[0].headers["x-password"], "fixture-password", "password uses its established header");
  assert.equal(f.requests[0].headers["x-delivery-mode"], "path", "password does not force subdomain");
  assert.equal(f.requests[0].body, "7", "scalar JSON bytes are preserved");
  assert.match(result.content[0].text, /^URL: https:\/\/brewpage\.app\/public\/aBcDeFgHiJ$/m, "protected link remains clean");
  assert.equal(result.content[0].text.includes("?p="), false, "NEW link has no password parameter");
});

for (const winner of [
  { cohort: "new-v1", mode: "path", matched: false, label: "requested/effective mismatch", link: "https://brewpage.app/public/aBcDeFgHiJ" },
  { cohort: "old", mode: null, matched: null, label: "OLD nullable mode", link: "https://brewpage.app/public/aBcDeFgHiJ?p=legacy-fixture" },
]) {
  test(`dedup preserves ${winner.label} and actual winner URL`, { timeout: 10_000 }, async (t) => {
    // GIVEN existing winner returned by the server.
    const f = await fixture(t);
    f.respond(200, { ...NEW_RESPONSE, link: winner.link, routingCohort: winner.cohort, deliveryMode: winner.mode, effectiveDeliveryMode: winner.mode, requestedDeliveryMode: "subdomain", deliveryModeMatched: winner.matched });
    // WHEN caller asks for a different create mode.
    const result = await f.call("publish_html", { content: "same fixture", namespace: "public", deliveryMode: "subdomain" });
    // THEN actual winner is reported without implicit mutation.
    assert.equal(f.requests.length, 1, "dedup triggers no hosting update");
    assert.equal(result.content[0].text.split("\n")[2], `URL: ${winner.link}`, "winner URL is untouched");
    assert.equal(result.content[0].text.includes(`deliveryMode: ${JSON.stringify(winner.mode)}`), true, "actual mode including null is retained");
    assert.equal(result.content[0].text.includes(`deliveryModeMatched: ${JSON.stringify(winner.matched)}`), true, "mismatch including null is retained");
  });
}

const DELIVERY_REASON_LINE = /^(?:deliveryModeReason: |Delivery notice: )/;
const PATH_RESPONSE = { ...NEW_RESPONSE, link: "https://brewpage.app/public/aBcDeFgHiJ", deliveryMode: "path", effectiveDeliveryMode: "path", requestedDeliveryMode: null, deliveryModeMatched: null };
const HTML_REASON_TOOLS = [
  { tool: "publish_html", method: "POST", status: 201, args: { content: "<h1>Fixture</h1>", namespace: "public" } },
  { tool: "update_html", method: "PUT", status: 200, args: { namespace: "public", id: "aBcDeFgHiJ", content: "<h1>Fixture</h1>", ownerToken: "fixture-owner" } },
];

for (const scenario of [
  { ...HTML_REASON_TOOLS[0], label: "automatic subdomain", response: { ...NEW_RESPONSE, requestedDeliveryMode: null, deliveryModeMatched: null }, reason: "auto:fixture-a,fixture-b", notice: "Fixture notice: published on its own subdomain." },
  { ...HTML_REASON_TOOLS[0], label: "advisory", response: PATH_RESPONSE, reason: "advisory:fixture-a", notice: "Fixture notice: may not work fully on a BrewPage link." },
  { ...HTML_REASON_TOOLS[1], label: "advisory", response: PATH_RESPONSE, reason: "advisory:fixture-a", notice: "Fixture notice: may not work fully on a BrewPage link." },
]) {
  test(`${scenario.tool} surfaces the ${scenario.label} delivery reason and notice verbatim`, { timeout: 10_000 }, async (t) => {
    // GIVEN server response carrying both optional delivery fields.
    const f = await fixture(t);
    f.respond(scenario.status, { ...scenario.response, deliveryModeReason: scenario.reason, deliveryNotice: scenario.notice });
    // WHEN caller names no delivery mode.
    const result = await f.call(scenario.tool, scenario.args);
    // THEN both fields are printed once, unchanged, and no mode was invented.
    assert.deepEqual({ method: f.requests[0].method, deliveryMode: f.requests[0].headers["x-delivery-mode"], isError: result.isError },
      { method: scenario.method, deliveryMode: undefined, isError: undefined }, "request stays mode-free and succeeds");
    assert.deepEqual(result.content[0].text.split("\n").filter((line) => DELIVERY_REASON_LINE.test(line)),
      [`deliveryModeReason: ${JSON.stringify(scenario.reason)}`, `Delivery notice: ${scenario.notice}`], "server reason and notice are surfaced verbatim");
    assert.equal(result.content[0].text.split("\n")[2], `URL: ${scenario.response.link}`, "server link stays authoritative");
  });
}

for (const scenario of HTML_REASON_TOOLS.flatMap((tool) => [
  { ...tool, label: "absent", extra: {} },
  { ...tool, label: "null", extra: { deliveryModeReason: null, deliveryNotice: null } },
])) {
  test(`${scenario.tool} prints no delivery reason lines for ${scenario.label} fields`, { timeout: 10_000 }, async (t) => {
    // GIVEN server response without usable delivery reason fields.
    const f = await fixture(t);
    f.respond(scenario.status, { ...PATH_RESPONSE, ...scenario.extra });
    // WHEN the HTML tool runs.
    const result = await f.call(scenario.tool, scenario.args);
    // THEN output invents neither a reason nor a notice.
    assert.equal(result.isError, undefined, "tool call succeeds");
    assert.deepEqual(result.content[0].text.split("\n").filter((line) => DELIVERY_REASON_LINE.test(line)), [], "no delivery reason output is invented");
  });
}

for (const type of ["html", "file", "json", "kv"]) {
  test(`update_hosting maps ${type} to owner-only versioned apex PATCH`, { timeout: 10_000 }, async (t) => {
    // GIVEN successful hosting projection.
    const f = await fixture(t);
    f.respond(200, { ...NEW_RESPONSE, hostingVersion: 2 });
    // WHEN owner changes mode with current version.
    const result = await f.call("update_hosting", { type, namespace: "public", id: "aBcDeFgHiJ", ownerToken: "fixture-owner", deliveryMode: "subdomain", expectedVersion: 1 });
    // THEN correct API segment, owner header and CAS body are used.
    assert.deepEqual(f.requests.map(({ method, url, headers, body }) => ({ method, url, owner: headers["x-owner-token"], body: JSON.parse(body) })), [
      { method: "PATCH", url: `/api/${type === "file" ? "files" : type}/public/aBcDeFgHiJ/hosting`, owner: "fixture-owner", body: { deliveryMode: "subdomain", expectedVersion: 1 } },
    ], "hosting mutation targets the configured API origin");
    assert.equal(result.isError, undefined, "hosting change succeeds");
    assert.match(result.content[0].text, /hostingVersion: 2/, "next version is returned");
  });
}

for (const error of [
  { status: 403, code: "OWNER_AUTHORIZATION_FAILED" },
  { status: 400, code: "HOSTING_MODE_LOCKED" },
  { status: 409, code: "HOSTING_VERSION_CONFLICT" },
]) {
  test(`update_hosting preserves ${error.status} ${error.code} without retry`, { timeout: 10_000 }, async (t) => {
    // GIVEN rejected server hosting mutation.
    const f = await fixture(t);
    f.respond(error.status, { code: error.code });
    // WHEN owner requests a mode change.
    const result = await f.call("update_hosting", { type: "html", namespace: "public", id: "aBcDeFgHiJ", ownerToken: "fixture-owner", deliveryMode: "path", expectedVersion: 1 });
    // THEN status/code remain visible and concurrency is not bypassed.
    assert.equal(result.isError, true, "server failure becomes a tool error");
    assert.equal(result.content[0].text, `Failed to update hosting (${error.status}): ${JSON.stringify({ code: error.code })}`, "status and code are retained exactly");
    assert.equal(f.requests.length, 1, "failed mutation is not retried");
  });
}

test("same-mode hosting result keeps server version unchanged", { timeout: 10_000 }, async (t) => {
  // GIVEN no-op response with current version.
  const f = await fixture(t);
  f.respond(200, { ...NEW_RESPONSE });
  // WHEN owner selects already-effective mode.
  const result = await f.call("update_hosting", { type: "html", namespace: "public", id: "aBcDeFgHiJ", ownerToken: "fixture-owner", deliveryMode: "subdomain", expectedVersion: 1 });
  // THEN MCP increments no version and rewrites no address.
  assert.match(result.content[0].text, /hostingVersion: 1/, "no-op version remains unchanged");
  assert.match(result.content[0].text, /^URL: https:\/\/public-z9y8x7w6v5\.brewpage\.app\/$/m, "no-op link remains verbatim");
});

test("fresh site path rejection comes from the server without client coercion", { timeout: 10_000 }, async (t) => {
  // GIVEN server forced-mode policy for fresh sites.
  const f = await fixture(t);
  f.respond(400, { code: "HOSTING_MODE_LOCKED" });
  // WHEN caller explicitly requests path hosting for a site.
  const result = await f.call("publish_site", { entryContent: "<h1>Fixture</h1>", namespace: "public", deliveryMode: "path" });
  // THEN valid enum reaches backend and its policy rejection is retained.
  assert.equal(f.requests[0].headers["x-delivery-mode"], "path", "client does not silently coerce the explicit mode");
  assert.equal(result.isError, true, "fresh forced-mode rejection remains a tool error");
  assert.match(result.content[0].text, /HOSTING_MODE_LOCKED/, "backend policy code is retained");
});

test("existing OLD site winner accepts a valid requested path without local eligibility rejection", { timeout: 10_000 }, async (t) => {
  // GIVEN OLD dedup winner where fresh-site eligibility does not apply.
  const f = await fixture(t);
  f.respond(200, { ...NEW_RESPONSE, link: "https://brewpage.app/public/aBcDeFgHiJ/", routingCohort: "old", deliveryMode: null, effectiveDeliveryMode: null, deliveryModeMatched: null, requestedDeliveryMode: "path", hostingVersion: null });
  // WHEN caller requests path hosting while republishing the same site content.
  const result = await f.call("publish_site", { entryContent: "<h1>Fixture</h1>", namespace: "public", deliveryMode: "path" });
  // THEN existing winner succeeds and preserves its legacy root address.
  assert.equal(result.isError, undefined, "OLD winner is not subjected to fresh-site validation");
  assert.match(result.content[0].text, /^URL: https:\/\/brewpage\.app\/public\/aBcDeFgHiJ\/$/m, "OLD winner root link is unchanged");
  assert.match(result.content[0].text, /Hosting: Existing link/, "OLD site is not mislabeled Promotion");
  assert.equal(f.requests.length, 1, "dedup outcome causes no extra hosting mutation");
});

test("invalid enum and fractional hosting version fail before HTTP", { timeout: 10_000 }, async (t) => {
  // GIVEN invalid input independent of backend response.
  const f = await fixture(t);
  // WHEN schemas receive invalid choices.
  const badMode = await f.call("publish_html", { content: "fixture", deliveryMode: "invalid" });
  const badVersion = await f.call("update_hosting", { type: "html", namespace: "public", id: "aBcDeFgHiJ", ownerToken: "fixture-owner", deliveryMode: "path", expectedVersion: 1.5 });
  // THEN both fail without contacting an API.
  assert.equal(badMode.isError, true, "invalid enum produces a tool error");
  assert.equal(badVersion.isError, true, "fractional version produces a tool error");
  assert.equal(f.requests.length, 0, "invalid input never reaches HTTP");
});

test("get_page returns actual HTML and canonical NEW response headers on its legacy API route", { timeout: 10_000 }, async (t) => {
  // GIVEN HTML bytes and metadata carried only in response headers.
  const f = await fixture(t);
  const html = "<!doctype html>\n<h1>Fixture</h1>\n<script>window.fixture = 1;</script>\n";
  f.respondText(200, html, {
    "Content-Type": "text/html; charset=UTF-8",
    "X-Routing-Cohort": "new-v1", "X-Delivery-Mode": "subdomain", "X-Canonical-Link": NEW_RESPONSE.link,
  });
  // WHEN existing page read tool runs.
  const result = await f.call("get_page", { namespace: "public", id: "aBcDeFgHiJ" });
  // THEN actual server address replaces URL reconstruction while API routing stays unchanged.
  assert.equal(f.requests[0].url, "/api/html/public/aBcDeFgHiJ", "legacy read endpoint remains unchanged");
  assert.match(result.content[0].text, /^URL: https:\/\/public-z9y8x7w6v5\.brewpage\.app\/$/m, "canonical root link comes directly from response header");
  assert.match(result.content[0].text, /routingCohort: "new-v1"/, "header cohort is reported");
  assert.match(result.content[0].text, /deliveryMode: "subdomain"/, "header mode is reported");
  assert.equal(result.content[0].text.split("--- Content ---\n")[1], html, "actual HTML bytes including final newline are returned");
});

test("get_page treats authored JSON metadata names as content and trusts only response headers", { timeout: 10_000 }, async (t) => {
  // GIVEN authored JSON attempts to impersonate platform metadata.
  const f = await fixture(t);
  const authoredJson = '{"link":"https://example.com/fake/","url":"https://example.com/other/","id":"fake","content":"fake source","routingCohort":"old","deliveryMode":"path","format":"fake","createdAt":"fake"}';
  f.respondText(200, authoredJson, { "Content-Type": "application/json", "X-Routing-Cohort": "new-v1", "X-Delivery-Mode": "subdomain", "X-Canonical-Link": NEW_RESPONSE.link });
  // WHEN get_page fetches the authored JSON code body.
  const result = await f.call("get_page", { namespace: "public", id: "aBcDeFgHiJ" });
  // THEN authored keys remain bytes below the content boundary.
  assert.equal(result.content[0].text, [
    "Page: public/aBcDeFgHiJ", `URL: ${NEW_RESPONSE.link}`, "Content-Type: application/json",
    'routingCohort: "new-v1"', 'deliveryMode: "subdomain"', "", "--- Content ---", authoredJson,
  ].join("\n"), "trusted metadata and exact authored JSON remain separate");
});

test("get_page uses OLD fallback only when NEW markers are absent", { timeout: 10_000 }, async (t) => {
  // GIVEN OLD content without hosting headers.
  const f = await fixture(t);
  f.respondText(200, "old fixture", { "Content-Type": "text/plain" });
  // WHEN get_page reads OLD and then a NEW response missing its canonical link.
  const oldResult = await f.call("get_page", { namespace: "public", id: "aBcDeFgHiJ" });
  f.respondText(200, "new fixture", { "Content-Type": "text/plain", "X-Routing-Cohort": "new-v1", "X-Delivery-Mode": "subdomain" });
  const newResult = await f.call("get_page", { namespace: "public", id: "aBcDeFgHiJ" });
  // THEN only OLD may use the existing apex-path fallback.
  assert.equal(oldResult.content[0].text.split("\n")[1], `URL: ${f.baseUrl}/public/aBcDeFgHiJ`, "OLD fallback is retained");
  assert.equal(newResult.content[0].text.split("\n")[1], "URL: N/A", "missing NEW canonical link never invents an address");
  assert.equal(newResult.content[0].text.split("--- Content ---\n")[1], "new fixture", "missing metadata does not lose actual content");
});

test("get_page keeps JSON HTTP errors and password headers without returning content as success", { timeout: 10_000 }, async (t) => {
  // GIVEN protected API failure.
  const f = await fixture(t);
  f.respond(403, { code: "PASSWORD_REQUIRED", message: "Password required" });
  // WHEN get_page attempts password-authenticated reading.
  const result = await f.call("get_page", { namespace: "public", id: "aBcDeFgHiJ", password: "fixture-password" });
  // THEN structured error semantics and request credential transport remain unchanged.
  assert.deepEqual(result, { content: [{ type: "text", text: 'Failed to fetch page (403): {"code":"PASSWORD_REQUIRED","message":"Password required"}' }], isError: true }, "HTTP failure remains an exact MCP tool error");
  assert.equal(f.requests[0].headers["x-password"], "fixture-password", "password stays in its existing request header");
});
