import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const EXPECTED_TOOL_NAMES = [
  "publish_html", "publish_file", "delete_resource", "get_page", "get_stats", "publish_site",
  "republish_site", "update_html", "publish_json", "get_json", "update_json", "publish_kv",
  "set_kv", "get_kv", "search_gallery", "update_hosting", "get_limits", "set_visibility", "bind_token", "mint_token",
];

const PACKAGE_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
const ENV_TOKEN = "EnvOwnerToken0123456789abcdefABC";

const NEW_RESPONSE = {
  id: "aBcDeFgHiJ", namespace: "public", ownerToken: "fixture-owner",
  link: "https://public-z9y8x7w6v5.brewpage.app/", url: "https://brewpage.app/stale-alias",
  managementLink: "https://brewpage.app/manage/html/public/aBcDeFgHiJ", routingCohort: "new-v1",
  deliveryMode: "subdomain", requestedDeliveryMode: "subdomain", effectiveDeliveryMode: "subdomain",
  deliveryModeMatched: true, hostingVersion: 1, modeLocked: false, access: "public",
};

interface RequestSnapshot { method: string; url: string; headers: IncomingHttpHeaders; body: string }

async function fixture(t: TestContext, env: Record<string, string> = {}) {
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
    env: { BREWPAGE_URL: baseUrl, ...env }, stderr: "pipe",
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

test("MCP exposes exactly 20 tools and optional create-only delivery choice", { timeout: 10_000 }, async (t) => {
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

const READ_ONLY = { readOnlyHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true };
const ADDITIVE = { readOnlyHint: false, destructiveHint: false };
const EXPECTED_TOOL_META: Record<string, [string, Record<string, boolean>]> = {
  get_page: ["Read page", READ_ONLY], get_json: ["Read JSON document", READ_ONLY], get_kv: ["Read KV value", READ_ONLY],
  get_stats: ["Get platform statistics", READ_ONLY], get_limits: ["Get upload limits", READ_ONLY],
  search_gallery: ["Search public gallery", READ_ONLY],
  delete_resource: ["Delete publication", DESTRUCTIVE], update_html: ["Update page", DESTRUCTIVE],
  update_json: ["Update JSON document", DESTRUCTIVE], set_kv: ["Set KV value", DESTRUCTIVE],
  republish_site: ["Republish site", DESTRUCTIVE],
  publish_html: ["Publish HTML, Markdown, code or JSON page", ADDITIVE], publish_file: ["Publish file from URL", ADDITIVE],
  publish_site: ["Publish site", ADDITIVE], publish_json: ["Publish JSON document", ADDITIVE],
  publish_kv: ["Publish KV entry", ADDITIVE], set_visibility: ["Set gallery visibility", ADDITIVE],
  update_hosting: ["Change delivery mode", ADDITIVE], bind_token: ["Add token to profile", ADDITIVE],
  mint_token: ["Mint profile token", ADDITIVE],
};

test("every tool carries a title and its exact safety hints", { timeout: 10_000 }, async (t) => {
  // GIVEN local MCP connected to a synthetic API.
  const f = await fixture(t);
  // WHEN client discovers tools.
  const { tools } = await f.client.listTools();
  // THEN each tool has the directory title and hint map.
  const actual = Object.fromEntries(tools.map(({ name, title, annotations }) => [name, { title, annotations }]));
  const expected = Object.fromEntries(Object.entries(EXPECTED_TOOL_META)
    .map(([name, [title, hints]]) => [name, { title, annotations: { title, ...hints } }]));
  assert.deepEqual(actual, expected, "tool titles and annotations match the directory contract");
});

const MODEL_DIRECTIVE = /(^|[.:;]\s+)(always|never (publish|put|share|give)|use|call|pass|give|tell|retain|share|ask|remember|do not|don't)\b|\byou (must|should)\b|[​-‏⁠﻿]/i;

test("tool and input descriptions state facts, not model directives or other tools", { timeout: 10_000 }, async (t) => {
  // GIVEN local MCP connected to a synthetic API.
  const f = await fixture(t);
  // WHEN client discovers tools.
  const { tools } = await f.client.listTools();
  // THEN no description directs the model, names another tool or hides characters.
  const offending = tools.flatMap(({ name, description, inputSchema }) => [
    [name, description ?? ""],
    ...Object.entries(inputSchema.properties ?? {}).map(([prop, schema]) => [`${name}.${prop}`, (schema as { description?: string }).description ?? ""]),
  ].filter(([owner, text]) => MODEL_DIRECTIVE.test(text) ||
    EXPECTED_TOOL_NAMES.some((tool) => tool !== owner.split(".")[0] && text.includes(tool))).map(([owner]) => owner));
  assert.deepEqual(offending, [], "directory policy: descriptions contain only neutral facts");
});

test("PDF/Office 400 hints use the contract 2.8.5 wording", { timeout: 10_000 }, async (t) => {
  // GIVEN local MCP connected to a synthetic API.
  const f = await fixture(t);
  // WHEN client discovers tools.
  const { tools } = await f.client.listTools();
  // THEN only the site tools mention PDF/Office, as unreadable or password-protected.
  const actual = Object.fromEntries(tools.map(({ name, description }) => [name, (description ?? "").match(/PDF\/Office[^;]*/g) ?? []]));
  const expected = Object.fromEntries(EXPECTED_TOOL_NAMES.map((name) =>
    [name, ["publish_site", "republish_site"].includes(name) ? ["PDF/Office file unreadable or password-protected"] : []]));
  assert.deepEqual(actual, expected, "PDF/Office 400 wording matches the contract");
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
  assert.equal(requestUrl.searchParams.has("ttl"), false, "omitted TTL retains the backend default");
  assert.deepEqual(JSON.parse(f.requests[0].body), { content: "<p>Unlisted fixture</p>" }, "JSON contains only the supported content field");
  assert.equal(f.requests[0].headers["x-password"], undefined, "omitted password remains absent");
  assert.equal(f.requests[0].headers["x-delivery-mode"], undefined, "omission invents no requested mode");
  assert.match(result.content[0].text, /Private: not listed\./, "private result retains its private notice");
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
  { label: "omitted", args: {}, query: { ns: "public" } },
  { label: "given", args: { format: "jsx" }, query: { ns: "public", format: "jsx" } },
]) {
  test(`publish_html sends format only when ${scenario.label}`, { timeout: 10_000 }, async (t) => {
    // GIVEN a JSX body with or without a caller format.
    const f = await fixture(t);
    // WHEN publish_html runs.
    const result = await f.call("publish_html", { content: "const App = () => <Box />;", namespace: "public", ...scenario.args });
    // THEN an omitted format leaves detection to the server and a given one passes through.
    assert.deepEqual({ isError: result.isError, query: Object.fromEntries(new URL(f.requests[0].url, f.baseUrl).searchParams) },
      { isError: undefined, query: scenario.query }, "format reaches the server only when the caller sends one");
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

const NOTICES = [
  { code: "ttl-clamped", message: "TTL 90 days is above the 30-day maximum; set to 30 days." },
  { code: "format-adjusted", message: "Format 'md' was published as markdown." },
];

for (const scenario of [
  { tool: "publish_html", args: { content: "# Fixture", namespace: "public", format: "md", ttlDays: 90 }, query: "ns=public&format=md&ttl=90" },
  { tool: "publish_html", args: { content: "<h1>Fixture</h1>", namespace: "public", format: "text/html", ttlDays: "2w" }, query: "ns=public&format=text%2Fhtml&ttl=2w" },
  { tool: "publish_kv", args: { key: "k", value: "v", namespace: "public", ttlDays: 0.5 }, query: "ns=public&ttl=0.5" },
]) {
  test(`${scenario.tool} passes tolerant input ${scenario.query} to the server and surfaces its notices verbatim`, { timeout: 10_000 }, async (t) => {
    // GIVEN a server answer carrying advisory notices next to a malformed one.
    const f = await fixture(t);
    f.respond(201, { ...NEW_RESPONSE, notices: [...NOTICES, { code: 7 }] });
    // WHEN caller sends values outside the old client-side limits.
    const result = await f.call(scenario.tool, scenario.args);
    // THEN the input reaches the server unchanged and each well-formed notice is printed once.
    assert.deepEqual({ isError: result.isError, query: f.requests[0].url.split("?")[1],
      notices: result.content[0].text.split("\n").filter((line) => line.startsWith("Notice ("))
    }, { isError: undefined, query: scenario.query, notices: NOTICES.map((n) => `Notice (${n.code}): ${n.message}`) },
    "tolerant input is forwarded and server notices are surfaced verbatim");
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
  test(`existing publication preserves ${winner.label} and actual URL`, { timeout: 10_000 }, async (t) => {
    // GIVEN existing winner returned by the server.
    const f = await fixture(t);
    f.respond(200, { ...NEW_RESPONSE, link: winner.link, routingCohort: winner.cohort, deliveryMode: winner.mode, effectiveDeliveryMode: winner.mode, requestedDeliveryMode: "subdomain", deliveryModeMatched: winner.matched });
    // WHEN caller asks for a different create mode.
    const result = await f.call("publish_html", { content: "same fixture", namespace: "public", deliveryMode: "subdomain" });
    // THEN actual winner is reported without implicit mutation.
    assert.equal(f.requests.length, 1, "existing publication triggers no hosting update");
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

for (const { type, version } of [
  { type: "html", version: { expectedVersion: 1 } }, { type: "file", version: { expectedVersion: 1 } },
  { type: "json", version: { expectedVersion: 1 } }, { type: "kv", version: { expectedVersion: 1 } }, { type: "html", version: {} },
]) {
  test(`update_hosting maps ${type} to owner-only apex PATCH with ${JSON.stringify(version)}`, { timeout: 10_000 }, async (t) => {
    // GIVEN successful hosting projection.
    const f = await fixture(t);
    f.respond(200, { ...NEW_RESPONSE, hostingVersion: 2 });
    // WHEN owner changes mode with or without a known version.
    const result = await f.call("update_hosting", { type, namespace: "public", id: "aBcDeFgHiJ", ownerToken: "fixture-owner", deliveryMode: "subdomain", ...version });
    // THEN correct API segment, owner header and body are used; an omitted version is not invented.
    assert.deepEqual(f.requests.map(({ method, url, headers, body }) => ({ method, url, owner: headers["x-owner-token"], body: JSON.parse(body) })), [
      { method: "PATCH", url: `/api/${type === "file" ? "files" : type}/public/aBcDeFgHiJ/hosting`, owner: "fixture-owner", body: { deliveryMode: "subdomain", ...version } },
    ], "hosting mutation targets the configured API origin");
    assert.equal(result.isError, undefined, "hosting change succeeds");
    assert.match(result.content[0].text, /hostingVersion: 2/, "next version is returned");
  });
}

for (const error of [
  { status: 403, code: "OWNER_AUTHORIZATION_FAILED" },
  { status: 400, code: "INVALID_HOSTING_VERSION" },
  { status: 503, code: "HOSTING_CREATION_PAUSED" },
]) {
  test(`update_hosting preserves ${error.status} ${error.code} without retry`, { timeout: 10_000 }, async (t) => {
    // GIVEN rejected server hosting mutation.
    const f = await fixture(t);
    f.respond(error.status, { code: error.code });
    // WHEN owner requests a mode change.
    const result = await f.call("update_hosting", { type: "html", namespace: "public", id: "aBcDeFgHiJ", ownerToken: "fixture-owner", deliveryMode: "path", expectedVersion: 1 });
    // THEN status/code remain visible and the call is not retried.
    assert.equal(result.isError, true, "server failure becomes a tool error");
    const hint = error.status === 403 ? "\nWrong owner token for this publication. Use ownerToken from create." : "";
    assert.equal(result.content[0].text, `Failed to update hosting (${error.status}): ${JSON.stringify({ code: error.code })}${hint}`, "status and code are retained exactly");
    assert.equal(f.requests.length, 1, "failed mutation is not retried");
  });
}

for (const scenario of [
  { reason: "policy:version-stale", response: { ...NEW_RESPONSE, hostingVersion: 4 } },
  { reason: "policy:mode-locked", response: { ...NEW_RESPONSE, requestedDeliveryMode: "path", deliveryModeMatched: false, modeLocked: true } },
  { reason: "policy:classic-link", response: { ...NEW_RESPONSE, routingCohort: "old", deliveryMode: null, effectiveDeliveryMode: null, requestedDeliveryMode: "path", deliveryModeMatched: false, hostingVersion: null } },
]) {
  test(`update_hosting reports ${scenario.reason} as a successful result with its notice`, { timeout: 10_000 }, async (t) => {
    // GIVEN tolerant server answer for a stale or inapplicable hosting request.
    const f = await fixture(t);
    f.respond(200, { ...scenario.response, deliveryModeReason: scenario.reason, deliveryNotice: `Fixture notice for ${scenario.reason}.` });
    // WHEN owner requests a mode change with an old version.
    const result = await f.call("update_hosting", { type: "html", namespace: "public", id: "aBcDeFgHiJ", ownerToken: "fixture-owner", deliveryMode: "path", expectedVersion: 1 });
    // THEN the call succeeds once and the server reason and notice reach the caller verbatim.
    assert.deepEqual({ isError: result.isError, requests: f.requests.length, lines: result.content[0].text.split("\n").filter((line) => DELIVERY_REASON_LINE.test(line)) },
      { isError: undefined, requests: 1, lines: [`deliveryModeReason: ${JSON.stringify(scenario.reason)}`, `Delivery notice: Fixture notice for ${scenario.reason}.`] },
      "tolerant answer is a success carrying reason and notice");
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

test("fresh site path request is published on subdomain and reported, without client coercion", { timeout: 10_000 }, async (t) => {
  // GIVEN server forced-mode policy answering with the effective subdomain publication.
  const f = await fixture(t);
  f.respond(201, { ...NEW_RESPONSE, requestedDeliveryMode: "path", deliveryModeMatched: false, deliveryModeReason: "policy:subdomain-required", deliveryNotice: "Fixture notice: published on its own subdomain." });
  // WHEN caller explicitly requests path hosting for a site.
  const result = await f.call("publish_site", { entryContent: "<h1>Fixture</h1>", namespace: "public", deliveryMode: "path" });
  // THEN valid enum reaches backend and the mismatch is reported with the server link.
  assert.equal(f.requests[0].headers["x-delivery-mode"], "path", "client does not silently coerce the explicit mode");
  assert.equal(result.isError, undefined, "forced-mode mismatch is not a tool error");
  assert.deepEqual(result.content[0].text.split("\n").filter((line) => DELIVERY_REASON_LINE.test(line) || line.startsWith("URL: ")),
    [`URL: ${NEW_RESPONSE.link}`, `deliveryModeReason: "policy:subdomain-required"`, "Delivery notice: Fixture notice: published on its own subdomain."],
    "subdomain link, reason and notice are surfaced verbatim");
});

test("existing OLD site winner accepts a valid requested path without local eligibility rejection", { timeout: 10_000 }, async (t) => {
  // GIVEN OLD existing publication where fresh-site eligibility does not apply.
  const f = await fixture(t);
  f.respond(200, { ...NEW_RESPONSE, link: "https://brewpage.app/public/aBcDeFgHiJ/", routingCohort: "old", deliveryMode: null, effectiveDeliveryMode: null, deliveryModeMatched: null, requestedDeliveryMode: "path", hostingVersion: null });
  // WHEN caller requests path hosting while republishing the same site content.
  const result = await f.call("publish_site", { entryContent: "<h1>Fixture</h1>", namespace: "public", deliveryMode: "path" });
  // THEN existing winner succeeds and preserves its legacy root address.
  assert.equal(result.isError, undefined, "OLD winner is not subjected to fresh-site validation");
  assert.match(result.content[0].text, /^URL: https:\/\/brewpage\.app\/public\/aBcDeFgHiJ\/$/m, "OLD winner root link is unchanged");
  assert.match(result.content[0].text, /Hosting: Existing link/, "OLD site is not mislabeled Promotion");
  assert.equal(f.requests.length, 1, "existing publication outcome causes no extra hosting mutation");
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

for (const scenario of [
  { status: 200, body: { requestMaxBytes: 26214400, sites: { maxFiles: 200 } }, isError: undefined,
    text: `BrewPage limits (sizes in bytes, TTLs in days):\n\n${JSON.stringify({ requestMaxBytes: 26214400, sites: { maxFiles: 200 } }, null, 2)}` },
  { status: 429, body: { status: 429 }, isError: true, text: `Failed to fetch limits (429): ${JSON.stringify({ status: 429 })}` },
]) {
  test(`get_limits reads GET /api/limits and relays a ${scenario.status} answer verbatim`, { timeout: 10_000 }, async (t) => {
    // GIVEN synthetic limits endpoint answering with the scenario status.
    const f = await fixture(t);
    f.respond(scenario.status, scenario.body);
    // WHEN the agent asks for the upload limits.
    const result = await f.call("get_limits", {});
    // THEN one unauthenticated GET reaches /api/limits and the body is relayed unchanged.
    assert.deepEqual({ requests: f.requests.map(({ method, url, headers }) => ({ method, url, owner: headers["x-owner-token"] })), isError: result.isError, text: result.content[0].text },
      { requests: [{ method: "GET", url: "/api/limits", owner: undefined }], isError: scenario.isError, text: scenario.text },
      "limits request and relayed text match exactly");
  });
}

for (const scenario of [
  { label: "argument", env: {}, args: { ownerToken: "fixture-owner" }, owner: "fixture-owner" },
  { label: "argument over default", env: { BREWPAGE_OWNER_TOKEN: ENV_TOKEN }, args: { ownerToken: "fixture-owner" }, owner: "fixture-owner" },
  { label: "default", env: { BREWPAGE_OWNER_TOKEN: ENV_TOKEN }, args: {}, owner: ENV_TOKEN },
  { label: "none", env: {}, args: {}, owner: undefined },
]) {
  test(`get_limits owner token: ${scenario.label}`, { timeout: 10_000 }, async (t) => {
    // GIVEN a synthetic limits endpoint and the scenario default.
    const f = await fixture(t, scenario.env);
    // WHEN limits are read.
    const result = await f.call("get_limits", scenario.args);
    // THEN X-Owner-Token follows argument, then default, else is absent.
    assert.deepEqual({ isError: result.isError, owner: f.requests.map(({ headers }) => headers["x-owner-token"]) },
      { isError: undefined, owner: [scenario.owner] }, "limits owner header follows argument, then default");
  });
}

for (const scenario of [
  { tool: "publish_html", args: { content: "<h1>Fixture</h1>" } },
  { tool: "publish_json", args: { json: { value: 7 } } },
  { tool: "publish_kv", args: { key: "k", value: "v" } },
  { tool: "publish_site", args: { entryContent: "<h1>Fixture</h1>" } },
  { tool: "update_json", args: { namespace: "public", id: "aBcDeFgHiJ", json: { value: 7 }, ownerToken: "fixture-owner" } },
  { tool: "republish_site", args: { namespace: "public", id: "aBcDeFgHiJ", entryContent: "<h1>Fixture</h1>", ownerToken: "fixture-owner" } },
  { tool: "get_limits", args: {} },
]) {
  test(`${scenario.tool} identifies the client with the package User-Agent`, { timeout: 10_000 }, async (t) => {
    // GIVEN a synthetic API.
    const f = await fixture(t);
    // WHEN the tool calls BrewPage.
    await f.call(scenario.tool, scenario.args);
    // THEN every API request carries the versioned agent name.
    assert.deepEqual(f.requests.map((request) => request.headers["user-agent"]), [`brewpage-mcp/${PACKAGE_VERSION}`],
      "one API request with the identifying User-Agent");
  });
}

const BUSY = { status: 503, error: "Service Unavailable" };
for (const scenario of [
  { tool: "publish_html", args: () => ({ content: "<h1>Fixture</h1>" }), text: `Failed to publish: ${JSON.stringify(BUSY)} Retry-After: 1.` },
  { tool: "publish_file", args: (base: string) => ({ url: `${base}/source-file` }), text: `Failed to upload file: ${JSON.stringify(BUSY)} Retry-After: 1.` },
  { tool: "publish_site", args: () => ({ entryContent: "<h1>Fixture</h1>" }), text: `Failed to publish site: ${JSON.stringify(BUSY)} Retry-After: 1.` },
  { tool: "republish_site", args: () => ({ namespace: "public", id: "aBcDeFgHiJ", entryContent: "<h1>Fixture</h1>", ownerToken: "fixture-owner" }),
    text: `Failed to republish site (503): ${JSON.stringify(BUSY)} Retry-After: 1.` },
]) {
  test(`${scenario.tool} prints Retry-After on a busy 503`, { timeout: 10_000 }, async (t) => {
    // GIVEN a busy API answering 503 with Retry-After.
    const f = await fixture(t);
    f.respond(503, BUSY, { "Retry-After": "1" });
    // WHEN the publish runs.
    const result = await f.call(scenario.tool, scenario.args(f.baseUrl));
    // THEN the tool error carries the server answer and the wait.
    assert.deepEqual({ isError: result.isError, text: result.content[0].text }, { isError: true, text: scenario.text },
      "busy answer and Retry-After are relayed exactly");
  });
}

for (const scenario of [
  { tool: "publish_site", status: 201, args: { entryContent: "<h1>Fixture</h1>" } },
  { tool: "republish_site", status: 200, args: { namespace: "public", id: "aBcDeFgHiJ", entryContent: "<h1>Fixture</h1>", ownerToken: "fixture-owner" } },
].flatMap((tool) => [
  { ...tool, label: "present", extra: { title: "Fixture Site" }, lines: ["ID: aBcDeFgHiJ", "Title: Fixture Site", "Entry file: index.html"] },
  { ...tool, label: "absent", extra: {}, lines: ["ID: aBcDeFgHiJ", "Entry file: index.html", "Files: 1"] },
])) {
  test(`${scenario.tool} prints the entry page title only when ${scenario.label}`, { timeout: 10_000 }, async (t) => {
    // GIVEN a site response with or without the optional title.
    const f = await fixture(t);
    f.respond(scenario.status, { ...NEW_RESPONSE, entryFile: "index.html", fileCount: 1, ...scenario.extra });
    // WHEN the site tool runs.
    const result = await f.call(scenario.tool, scenario.args);
    // THEN a Title line follows ID only for a present title.
    const lines = result.content[0].text.split("\n");
    assert.deepEqual({ isError: result.isError, lines: lines.slice(lines.indexOf("ID: aBcDeFgHiJ"), lines.indexOf("ID: aBcDeFgHiJ") + 3) },
      { isError: undefined, lines: scenario.lines }, "Title line sits right after ID and is never invented");
  });
}

for (const scenario of [
  { label: "present", extra: { title: "Fixture Page" }, lines: ["ID: aBcDeFgHiJ", "Title: Fixture Page", 'routingCohort: "new-v1"'] },
  { label: "absent", extra: {}, lines: ["ID: aBcDeFgHiJ", 'routingCohort: "new-v1"', 'deliveryMode: "subdomain"'] },
]) {
  test(`publish_html prints the page title only when ${scenario.label}`, { timeout: 10_000 }, async (t) => {
    // GIVEN an html create response with or without the optional title.
    const f = await fixture(t);
    f.respond(201, { ...NEW_RESPONSE, ...scenario.extra });
    // WHEN publish_html runs.
    const result = await f.call("publish_html", { content: "<title>Fixture Page</title>" });
    // THEN a Title line follows ID only for a present title.
    const lines = result.content[0].text.split("\n");
    assert.deepEqual({ isError: result.isError, lines: lines.slice(lines.indexOf("ID: aBcDeFgHiJ"), lines.indexOf("ID: aBcDeFgHiJ") + 3) },
      { isError: undefined, lines: scenario.lines }, "Title line sits right after ID and is never invented");
  });
}

for (const scenario of [
  { tool: "publish_html", args: { content: "<h1>Fixture</h1>" } },
  { tool: "publish_file", args: {} },
  { tool: "publish_site", args: { entryContent: "<h1>Fixture</h1>" } },
  { tool: "publish_json", args: { json: { value: 7 } } },
  { tool: "publish_kv", args: { key: "k", value: "v" } },
]) {
  test(`${scenario.tool} sends BREWPAGE_OWNER_TOKEN by default and never repeats it`, { timeout: 10_000 }, async (t) => {
    // GIVEN a configured default token that the server echoes back.
    const f = await fixture(t, { BREWPAGE_OWNER_TOKEN: ENV_TOKEN });
    f.respond(201, { ...NEW_RESPONSE, ownerToken: ENV_TOKEN });
    const extra = scenario.tool === "publish_file" ? { url: `${f.baseUrl}/source-file` } : {};
    // WHEN the create runs without an ownerToken argument.
    const result = await f.call(scenario.tool, { ...scenario.args, ...extra, namespace: "public" });
    // THEN the default is the create header and the transcript names it instead of printing it.
    assert.deepEqual({ owner: f.requests.at(-1)!.headers["x-owner-token"], leaked: result.content[0].text.includes(ENV_TOKEN),
      banner: result.content[0].text.includes("OWNER TOKEN: BREWPAGE_OWNER_TOKEN (not repeated)") },
      { owner: ENV_TOKEN, leaked: false, banner: true }, "default token is sent and masked in the banner");
  });
}

for (const scenario of [
  { label: "argument wins over the default", env: { BREWPAGE_OWNER_TOKEN: ENV_TOKEN }, args: { ownerToken: "fixture-owner" }, owner: "fixture-owner" },
  { label: "malformed default is ignored", env: { BREWPAGE_OWNER_TOKEN: "short" }, args: {}, owner: undefined },
]) {
  test(`publish_html owner token: ${scenario.label}`, { timeout: 10_000 }, async (t) => {
    // GIVEN a configured default token.
    const f = await fixture(t, scenario.env);
    // WHEN HTML is published.
    await f.call("publish_html", { content: "<h1>Fixture</h1>", ...scenario.args });
    // THEN the expected owner header (or none) reaches the server.
    assert.equal(f.requests[0].headers["x-owner-token"], scenario.owner, "owner header follows argument, then valid default");
  });
}

const SIGN_IN_HINT = "Optional: sign in free (Google or any email) at https://account.brewpage.app to never lose your pages or tokens and to mint tokens that never expire. Not needed to publish.";
for (const scenario of [
  { label: "minted html token", tool: "publish_html", env: {}, args: { content: "x" }, token: "fixture-owner", hint: [SIGN_IN_HINT] },
  { label: "minted site token", tool: "publish_site", env: {}, args: { entryContent: "x" }, token: "fixture-owner", hint: [SIGN_IN_HINT] },
  { label: "BREWPAGE_OWNER_TOKEN", tool: "publish_html", env: { BREWPAGE_OWNER_TOKEN: ENV_TOKEN }, args: { content: "x" }, token: ENV_TOKEN, hint: [] },
  { label: "ownerToken argument", tool: "publish_html", env: {}, args: { content: "x", ownerToken: "fixture-owner" }, token: "fixture-owner", hint: [] },
]) {
  test(`${scenario.tool} sign-in hint for ${scenario.label}`, { timeout: 10_000 }, async (t) => {
    // GIVEN a create answer carrying a new or the caller's own owner token.
    const f = await fixture(t, scenario.env as Record<string, string>);
    f.respond(201, { ...NEW_RESPONSE, ownerToken: scenario.token });
    // WHEN the publication is created.
    const result = await f.call(scenario.tool, { ...scenario.args, namespace: "public" });
    // THEN the optional sign-in hint appears only for a token minted by this call.
    assert.deepEqual(result.content[0].text.split("\n").filter((line) => line.startsWith("Optional: sign in")), scenario.hint,
      "sign-in hint follows token origin");
  });
}

for (const scenario of [
  { tool: "update_html", args: { namespace: "public", id: "aBcDeFgHiJ", content: "x" } },
  { tool: "delete_resource", args: { type: "site", namespace: "public", id: "aBcDeFgHiJ" } },
  { tool: "set_visibility", args: { type: "html", namespace: "public", id: "aBcDeFgHiJ", listed: false } },
  { tool: "bind_token", args: { token: "fixture-bound-token" } },
  { tool: "search_gallery", args: { mine: true } },
]) {
  test(`${scenario.tool} without any owner token fails before HTTP`, { timeout: 10_000 }, async (t) => {
    // GIVEN no argument and no configured default.
    const f = await fixture(t);
    // WHEN the owner tool runs.
    const result = await f.call(scenario.tool, scenario.args);
    // THEN it reports the missing token without calling the API.
    assert.deepEqual({ isError: result.isError, text: result.content[0].text, requests: f.requests.length },
      { isError: true, text: "No owner token: pass ownerToken (local server: or set BREWPAGE_OWNER_TOKEN).", requests: 0 }, "missing token is a local error");
  });
}

for (const scenario of [
  { tool: "delete_resource", args: { type: "site", namespace: "my ns", id: "a/b" }, status: 204, response: {},
    request: { method: "DELETE", url: "/api/sites/my%20ns/a%2Fb", body: "" }, text: "Successfully deleted site resource: my ns/a/b" },
  { tool: "set_visibility", args: { type: "file", namespace: "public", id: "aBcDeFgHiJ", listed: false }, status: 200,
    response: { listed: false, access: "public", link: NEW_RESPONSE.link, notices: [{ code: "visibility-not-listable", message: "Not listable." }] },
    request: { method: "POST", url: "/api/files/public/aBcDeFgHiJ/visibility", body: '{"listed":false}' },
    text: "LISTED: false · link unchanged\nNotice (visibility-not-listable): Not listable." },
  { tool: "bind_token", args: { token: "fixture-bound-token-0123456789ab" }, status: 200, response: { bound: true, id: "x", active: 3, max: 10 },
    request: { method: "POST", url: "/api/owner-token/bind", body: '{"token":"fixture-bound-token-0123456789ab"}' }, text: "BOUND …89ab · 3/10 active" },
  { tool: "mint_token", args: { label: "ci", scope: "admin", expiresIn: "90d" }, status: 201,
    response: { token: "MintedToken0123456789abcdefABCDE", id: "x", scope: "admin", expiresAt: "2027-01-22T00:00:00Z" },
    request: { method: "POST", url: "/api/owner-token/mint", body: '{"label":"ci","scope":"admin","expiresIn":"90d"}' },
    text: "MINTED · admin · expires 2027-01-22T00:00:00Z\n\n===================================\nNEW TOKEN (shown once): MintedToken0123456789abcdefABCDE\n===================================\n\nSave it now; it cannot be shown again. Never publish it." },
]) {
  test(`${scenario.tool} maps to ${scenario.request.method} ${scenario.request.url} and never echoes the admin token`, { timeout: 10_000 }, async (t) => {
    // GIVEN a configured admin/owner default token and a server answer.
    const f = await fixture(t, { BREWPAGE_OWNER_TOKEN: ENV_TOKEN });
    f.respond(scenario.status, scenario.response);
    // WHEN the owner tool runs.
    const result = await f.call(scenario.tool, scenario.args);
    // THEN request, owner header and output are exact.
    assert.deepEqual({ requests: f.requests.map(({ method, url, headers, body }) => ({ method, url, owner: headers["x-owner-token"], body })),
      text: result.content[0].text, isError: result.isError },
    { requests: [{ ...scenario.request, owner: ENV_TOKEN }], text: scenario.text, isError: undefined }, "owner tool contract is exact");
  });
}

test("publish_kv prints the private manage link, the listing hint and warning-class notices", { timeout: 10_000 }, async (t) => {
  // GIVEN a listed result with a manage link, a secret warning and an ordinary notice.
  const f = await fixture(t);
  f.respond(201, { ...NEW_RESPONSE, manageUrl: "https://brewpage.app/manage/kv/public/aBcDeFgHiJ#k=bpm_fixture", listed: true,
    notices: [{ code: "secret-detected", message: "Possible secret (API key/token?). Anyone with the link can read it." },
      { code: "ttl-clamped", message: "TTL clamped." }] });
  // WHEN the KV entry is published.
  const result = await f.call("publish_kv", { key: "k", value: "v", namespace: "public" });
  // THEN the agent sees lines it must relay.
  const lines = result.content[0].text.split("\n");
  assert.deepEqual(lines.filter((line) => /^(WARNING|Notice|MANAGE LINK|Give it|VISIBILITY)/.test(line)), [
    "WARNING (secret-detected): Possible secret (API key/token?). Anyone with the link can read it.",
    "Notice (ttl-clamped): TTL clamped.",
    "MANAGE LINK (private): https://brewpage.app/manage/kv/public/aBcDeFgHiJ#k=bpm_fixture",
    "Give it to the user privately; never publish it.",
    "VISIBILITY: public, listed. Hide: set_visibility listed=false",
  ], "warning, manage link and listing lines are exact");
});

const CREDENTIAL_MESSAGE = "BrewPage token or manage link in this content: hidden from gallery and search, but anyone with the link can use it. " +
  "Remove it and reset that token (Manage: Reset management link; profile: Tokens).";
const CREDENTIAL_ALERT = `SECURITY ALERT (credential-published): ${CREDENTIAL_MESSAGE} ` +
  "Tell the user now: anyone with this link can use that token; they must remove it and reset it.";

for (const scenario of [
  { label: "credential notice -> security alert first, no listed line",
    notices: [{ code: "ttl-clamped", message: "TTL clamped." }, { code: "credential-published", message: CREDENTIAL_MESSAGE }],
    head: [CREDENTIAL_ALERT, "", "Published successfully!"],
    relayed: [CREDENTIAL_ALERT, "Notice (ttl-clamped): TTL clamped."] },
  { label: "no credential notice -> unchanged listed result",
    notices: [{ code: "ttl-clamped", message: "TTL clamped." }],
    head: ["Published successfully!", "", "URL: https://public-z9y8x7w6v5.brewpage.app/"],
    relayed: ["Notice (ttl-clamped): TTL clamped.", "VISIBILITY: public, listed. Hide: set_visibility listed=false"] },
]) {
  test(`publish_html ${scenario.label}`, { timeout: 10_000 }, async (t) => {
    // GIVEN a listed public result with the scenario's notices.
    const f = await fixture(t);
    f.respond(201, { ...NEW_RESPONSE, listed: true, notices: scenario.notices });
    // WHEN the page is published.
    const result = await f.call("publish_html", { content: "<p>Credential fixture</p>", namespace: "public" });
    // THEN the opening lines and the relayed notice/listing lines are exact.
    const lines = result.content[0].text.split("\n");
    assert.deepEqual({ head: lines.slice(0, 3), relayed: lines.filter((line) => /^(WARNING|Notice|VISIBILITY|SECURITY)/.test(line)) },
      { head: scenario.head, relayed: scenario.relayed }, "credential alert placement and listing line are exact");
  });
}

test("owner tool 403 names the configured default token in its hint", { timeout: 10_000 }, async (t) => {
  // GIVEN a wrong configured token.
  const f = await fixture(t, { BREWPAGE_OWNER_TOKEN: ENV_TOKEN });
  f.respond(403, { code: "OWNER_AUTHORIZATION_FAILED" });
  // WHEN an update uses it.
  const result = await f.call("update_html", { namespace: "public", id: "aBcDeFgHiJ", content: "x" });
  // THEN the hint says which token was sent.
  assert.equal(result.content[0].text, 'Failed to update HTML (403): {"code":"OWNER_AUTHORIZATION_FAILED"}\n' +
    "Wrong owner token for this publication. Use ownerToken from create. Sent: BREWPAGE_OWNER_TOKEN.", "403 hint is exact");
});

for (const scenario of [
  { label: "foreign duplicate", extra: { ownerToken: undefined, result: { code: "duplicate", action: "merged", extras: { isOwner: false } } },
    lines: ["No owner token: an existing publication of another owner was returned."] },
  { label: "own duplicate", extra: { result: { code: "duplicate", action: "merged", extras: { isOwner: true } } }, lines: ["OWNER TOKEN: fixture-owner"] },
  { label: "absent token", extra: { ownerToken: undefined }, lines: [] },
]) {
  test(`publish_file owner token banner for ${scenario.label}`, { timeout: 10_000 }, async (t) => {
    // GIVEN an upload answer for an existing or token-less publication.
    const f = await fixture(t);
    f.respond(200, { ...NEW_RESPONSE, ...scenario.extra });
    // WHEN the file is published.
    const result = await f.call("publish_file", { url: `${f.baseUrl}/source-file`, namespace: "public" });
    // THEN the banner appears only for a token the caller owns.
    assert.deepEqual(result.content[0].text.split("\n").filter((line) => /^(OWNER TOKEN|No owner token)/.test(line)), scenario.lines,
      "owner token banner follows result.extras.isOwner and token presence");
  });
}

const oldReadOnlyBody = (segment: string) => ({
  status: 409, error: "Conflict",
  message: `Made before 5 October 2026: read-only. Publish a new copy: POST /api/${segment}; the old link keeps working.`,
  code: "OLD_PUBLICATION_READ_ONLY",
});
const OLD_HTML_BODY = { ...oldReadOnlyBody("html"), republishUrl: "https://brewpage.app/?republish=public/aBcDeFgHiJ",
  createUrl: "https://brewpage.app/api/html?ns=public" };
const VIA_TOOL = "The content can be published anew in the same namespace.";
const viaCreateUrl = (url: string) => `createUrl (${url}) is the create endpoint for publishing the content anew in that namespace.`;

for (const scenario of [
  { tool: "update_html", operation: "update HTML", args: { content: "x" }, body: OLD_HTML_BODY,
    how: viaCreateUrl("https://brewpage.app/api/html?ns=public"), extra: " republishUrl is a browser-only composer link." },
  { tool: "republish_site", operation: "republish site", args: { entryContent: "<h1>x</h1>" },
    body: { ...oldReadOnlyBody("sites"), createUrl: "https://brewpage.app/api/sites?ns=public" },
    how: viaCreateUrl("https://brewpage.app/api/sites?ns=public"), extra: "" },
  { tool: "update_json", operation: "update JSON", args: { json: { a: 1 } }, body: oldReadOnlyBody("json"), how: VIA_TOOL, extra: "" },
  { tool: "set_kv", operation: "set KV", args: { key: "k", value: "v" },
    body: { ...oldReadOnlyBody("kv"), createUrl: "https://brewpage.app/api/kv?ns=public" }, how: viaCreateUrl("https://brewpage.app/api/kv?ns=public"),
    extra: " A new KV store holds only the keys published to it." },
]) {
  test(`${scenario.tool} turns 409 OLD_PUBLICATION_READ_ONLY into a publish-anew hint`, { timeout: 10_000 }, async (t) => {
    // GIVEN a frozen old publication.
    const f = await fixture(t);
    f.respond(409, scenario.body);
    // WHEN its owner updates it.
    const { tools } = await f.client.listTools();
    const result = await f.call(scenario.tool, { namespace: "public", id: "aBcDeFgHiJ", ownerToken: "fixture-owner", ...scenario.args });
    // THEN the tool warns up front and the failure keeps the server body plus the publish-anew hint, without retry.
    assert.deepEqual({
      described: tools.find(({ name }) => name === scenario.tool)!.description!.includes("Old publications (made before 5 October 2026) are read-only: 409 OLD_PUBLICATION_READ_ONLY with createUrl to publish anew."),
      isError: result.isError, text: result.content[0].text, requests: f.requests.length,
    }, {
      described: true, isError: true, requests: 1,
      text: `Failed to ${scenario.operation} (409): ${JSON.stringify(scenario.body)}\n` +
        `Read-only old publication: cannot be updated. ${scenario.how} A new publication gets a new URL ` +
        "and owner token; the old URL keeps its old content until it expires." + scenario.extra,
    }, "frozen update is described, relayed verbatim and hinted once");
  });
}

const goneBody = (segment: string) => ({ status: 404, error: "Not Found", message: `Not found or expired. Publish a new copy with POST /api/${segment}.` });
for (const scenario of [
  { tool: "update_html", operation: "update HTML", args: { content: "x" }, segment: "html", hint: "\nUse the publish_html tool to publish a new copy." },
  { tool: "republish_site", operation: "republish site", args: { entryContent: "<h1>x</h1>" }, segment: "sites", hint: "\nUse the publish_site tool to publish a new copy." },
  { tool: "update_json", operation: "update JSON", args: { json: { a: 1 } }, segment: "json", hint: "\nUse the publish_json tool to publish a new copy." },
  { tool: "set_kv", operation: "set KV", args: { key: "k", value: "v" }, segment: "kv", hint: "\nUse the publish_kv tool to publish a new copy." },
  { tool: "delete_resource", operation: "delete", args: { type: "html" }, segment: "html", hint: "" },
]) {
  test(`${scenario.tool} 404 relays the server answer plus its publish-tool hint`, { timeout: 10_000 }, async (t) => {
    // GIVEN a deleted or expired publication.
    const f = await fixture(t);
    f.respond(404, goneBody(scenario.segment));
    // WHEN its owner writes to it.
    const result = await f.call(scenario.tool, { namespace: "public", id: "aBcDeFgHiJ", ownerToken: "fixture-owner", ...scenario.args });
    // THEN the server body is relayed verbatim, an update (not a delete) names its publish tool, nothing is retried.
    assert.deepEqual({ isError: result.isError, text: result.content[0].text, requests: f.requests.length }, {
      isError: true, requests: 1,
      text: `Failed to ${scenario.operation} (404): ${JSON.stringify(goneBody(scenario.segment))}${scenario.hint}`,
    }, "404 relay and publish-tool hint are exact");
  });
}

const PRIVATE_RESPONSE = { ...NEW_RESPONSE, namespace: "priv-synthetic", access: "unlisted" };
const LISTED_PRIVATE = "Private: not listed. Anyone with the link can open it. Use namespace public to list it in the gallery and sitemap.";
for (const scenario of [
  { tool: "publish_html", args: { content: "x" }, kind: "domain", notice: LISTED_PRIVATE },
  { tool: "publish_file", args: {}, kind: "domain", notice: LISTED_PRIVATE },
  { tool: "publish_site", args: { entryContent: "<h1>x</h1>" }, kind: "site", notice: LISTED_PRIVATE },
  { tool: "publish_json", args: { json: { a: 1 } }, kind: "data", notice: "Private: not listed. Anyone with the link can open it." },
  { tool: "publish_kv", args: { key: "k", value: "v" }, kind: "data", notice: "Private: not listed. Anyone with the link can open it." },
]) {
  test(`${scenario.tool} describes namespace ${scenario.kind} reach and prints the matching private notice`, { timeout: 10_000 }, async (t) => {
    // GIVEN a private create answer.
    const f = await fixture(t);
    f.respond(201, PRIVATE_RESPONSE);
    // WHEN the client reads the namespace input and publishes without a namespace.
    const { tools } = await f.client.listTools();
    const text = (tools.find(({ name }) => name === scenario.tool)!.inputSchema.properties!.namespace as { description: string }).description;
    const result = await f.call(scenario.tool, { ...scenario.args, ...(scenario.tool === "publish_file" ? { url: `${f.baseUrl}/source-file` } : {}) });
    // THEN the description states the type's public reach without hedges and the notice fits the type.
    const kind = text.includes("served right on the brewpage.app domain") ? "domain"
      : text.includes("A site always gets its own subdomain.") ? "site"
      : text.includes("JSON and KV are never listed in the gallery or indexed") ? "data" : "none";
    assert.deepEqual({
      kind, privateDefault: /Omit \(default\): private\./.test(text), hedged: /eligib|may permit|secure|qualif/i.test(text),
      notice: result.content[0].text.split("\n").find((line) => line.startsWith("Private:")),
    }, { kind: scenario.kind, privateDefault: true, hedged: false, notice: scenario.notice }, "namespace guidance matches the type");
  });
}

const TRAVERSAL_ENCODED: Record<string, string> = { "../..": "..%2F..", "%2e%2e": "%252e%252e", "a/b": "a%2Fb", "?x=1": "%3Fx%3D1", "#f": "%23f" };
const DOT_SEGMENTS = ["..", ".", ""];

for (const scenario of [
  { tool: "get_page", method: "GET", args: (v: string) => ({ namespace: v, id: v }), url: (e: string) => `/api/html/${e}/${e}` },
  { tool: "update_html", method: "PUT", args: (v: string) => ({ namespace: v, id: v, content: "x" }), url: (e: string) => `/api/html/${e}/${e}` },
  { tool: "delete_resource", method: "DELETE", args: (v: string) => ({ type: "site", namespace: v, id: v }), url: (e: string) => `/api/sites/${e}/${e}` },
  { tool: "republish_site", method: "PUT", args: (v: string) => ({ namespace: v, id: v, entryContent: "x" }), url: (e: string) => `/api/sites/${e}/${e}` },
  { tool: "get_json", method: "GET", args: (v: string) => ({ namespace: v, id: v }), url: (e: string) => `/api/json/${e}/${e}` },
  { tool: "update_json", method: "PUT", args: (v: string) => ({ namespace: v, id: v, json: {} }), url: (e: string) => `/api/json/${e}/${e}` },
  { tool: "get_kv", method: "GET", args: (v: string) => ({ namespace: v, id: v, key: v }), url: (e: string) => `/api/kv/${e}/${e}/${e}` },
  { tool: "set_kv", method: "PUT", args: (v: string) => ({ namespace: v, id: v, key: v, value: "x" }), url: (e: string) => `/api/kv/${e}/${e}/${e}` },
  { tool: "update_hosting", method: "PATCH", args: (v: string) => ({ type: "file", namespace: v, id: v, deliveryMode: "path" }), url: (e: string) => `/api/files/${e}/${e}/hosting` },
  { tool: "set_visibility", method: "POST", args: (v: string) => ({ type: "kv", namespace: v, id: v, listed: true }), url: (e: string) => `/api/kv/${e}/${e}/visibility` },
]) {
  test(`${scenario.tool} keeps traversal input inside its API path and refuses dot segments before HTTP`, { timeout: 20_000 }, async (t) => {
    // GIVEN a configured owner token and traversal-shaped values in every path field.
    const f = await fixture(t, { BREWPAGE_OWNER_TOKEN: ENV_TOKEN });
    f.respond(200, NEW_RESPONSE);
    // WHEN the tool runs with each encodable value and then with each dot segment.
    for (const value of Object.keys(TRAVERSAL_ENCODED)) await f.call(scenario.tool, scenario.args(value));
    const refused: string[] = [];
    for (const value of DOT_SEGMENTS) refused.push((await f.call(scenario.tool, scenario.args(value))).content[0].text);
    // THEN each value is one encoded segment and dot segments never reach the API.
    assert.deepEqual({ requests: f.requests.map(({ method, url }) => `${method} ${url}`), refused }, {
      requests: Object.values(TRAVERSAL_ENCODED).map((encoded) => `${scenario.method} ${scenario.url(encoded)}`),
      refused: DOT_SEGMENTS.map((value) => `Invalid path value ${JSON.stringify(value)}: empty, "." and ".." are not allowed.`),
    }, "backend URL stays under its API prefix");
  });
}
