import assert from "node:assert/strict";
import { test } from "node:test";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createServer, type ServerOptions } from "../src/tools.js";
import { createBridge } from "../src/compact/auth.js";
import type { ToolAnswer } from "../src/compact/context.js";

const origin = "https://brewpage.app";
const id = "DEMO123456";
const link = `${origin}/public/${id}`;
const owner = "fixture-owner-token";
const manageKey = `bpm_${"f".repeat(32)}`;
const manageUrl = `${origin}/manage/html/public/${id}#k=${manageKey}`;
const siteManageUrl = `${origin}/manage/sites/public/${id}#k=${manageKey}`;
const receipt = { namespace: "public", id, link, ownerToken: owner, manageUrl };
const htmlSource = "<!doctype html>\n<html><body>\n  <p>One &amp; two.</p>\n</body></html>\n";

async function call(name: string, args: Record<string, unknown>, options: ServerOptions): Promise<ToolAnswer> {
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  const server = createServer(options);
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(new Request(`${origin}/mcp`, { method: "POST", headers: {
      "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    assert.equal(response.status, 200, "The compact tool call should have an MCP result");
    const envelope = await response.json() as { result?: ToolAnswer; error?: unknown };
    assert.equal(envelope.error, undefined, "The tool should be callable through JSON-RPC");
    return envelope.result!;
  } finally {
    await server.close();
  }
}

test("Compact publication writes keep their REST shapes and actual private receipts", async (t) => {
  const builds = [
    { name: "html template plus Page data", tool: "publish", args: { content: "<h1>Hello</h1>", format: "html", template: "welcome", state: {}, namespace: "public" },
      path: "/api/html?ns=public&format=html&template=welcome&verbatim=true", method: "POST", body: { content: "<h1>Hello</h1>", state: {} }, proof: [null, null] },
    { name: "preserve supplied HTML on publish", tool: "publish", args: { content: htmlSource, namespace: "public" },
      path: "/api/html?ns=public&verbatim=true", method: "POST", body: { content: htmlSource }, proof: [null, null] },
    { name: "allow paste repair explicitly", tool: "publish", args: { content: htmlSource, namespace: "public", verbatim: false },
      path: "/api/html?ns=public", method: "POST", body: { content: htmlSource }, proof: [null, null] },
    { name: "JSON null", tool: "publish", args: { kind: "json", json: null, namespace: "public" },
      path: "/api/json?ns=public", method: "POST", body: null, proof: [null, null] },
    { name: "JSON string", tool: "publish", args: { kind: "json", json: "false", namespace: "public", ownerToken: owner },
      path: "/api/json?ns=public", method: "POST", body: "false", proof: [owner, null] },
    { name: "KV first key", tool: "publish", args: { kind: "kv", key: "a", value: "b", namespace: "public" },
      path: "/api/kv?ns=public", method: "POST", body: { key: "a", value: "b" }, proof: [null, null] },
    { name: "KV key deletion", tool: "delete_publication", args: { kind: "kv", key: "draft", namespace: "public", id, ownerToken: owner },
      path: `/api/kv/public/${id}/draft`, method: "DELETE", body: undefined, proof: [owner, null] },
  ];
  for (const row of builds) await t.test(row.name, async () => {
    // GIVEN a publication and its configured backend
    const calls: unknown[] = [];
    const response = row.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json(receipt, { status: 201 });
    const fetch: typeof globalThis.fetch = async (url, init) => {
      const request = new Request(url, init);
      calls.push({ href: request.url, method: request.method, body: parseBody(init?.body),
        proof: [request.headers.get("X-Owner-Token"), request.headers.get("X-Manage-Key")] });
      return response;
    };

    // WHEN the compact tool executes
    const result = await call(row.tool, row.args, { fetch });

    // THEN there is one precise write with the selected credential
    assert.deepEqual(calls, [{ href: `${origin}${row.path}`, method: row.method, body: row.body, proof: row.proof }], "The existing REST operation should receive the exact payload and proof");
    assert.equal(result.isError, undefined, "The accepted write should succeed");
    const expectedOwner = row.method === "DELETE" ? /Deleted kv public\/DEMO123456 key "draft"/ :
      row.proof[0] ? /Existing owner token reused/ : new RegExp(`OWNER TOKEN \\(private\\): ${owner}`);
    assert.match(result.content[0].text, expectedOwner, "The receipt should explain the confirmed result and private token handoff");
    assert.equal(result.content[0].text.includes(owner), row.method !== "DELETE" && row.proof[0] === null, "Only the newly issued token should be printed");
  });

  await t.test("site replacement via management link", async () => {
    // GIVEN a two-file replacement and a scoped site management link
    const files = [{ path: "docs/home.html", content: "<h1>Update</h1>" }, { path: "index.html", content: "<h1>Old default</h1>" }, { path: "assets/site.css", content: "h1{color:black}" }];
    const calls: unknown[] = [];
    const acceptReplacement = async (request: Request) => {
      const form = await request.formData();
      const contents = await Promise.all((form.getAll("files") as File[]).map((file) => file.text()));
      calls.push({ href: request.url, method: request.method, paths: form.getAll("paths"), contents, state: form.get("state"),
        proof: [request.headers.get("X-Owner-Token"), request.headers.get("X-Manage-Key")] });
      return Response.json({ namespace: "public", id, link });
    };
    const readLimits = (request: Request) => {
      calls.push({ href: request.url, method: request.method, ownerProof: [request.headers.get("X-Owner-Token"), request.headers.get("X-Manage-Key")] });
      return Response.json({ sites: { allowedExtensions: ["html", "css"] } });
    };
    const fetch: typeof globalThis.fetch = async (url, init) => {
      const request = new Request(url, init);
      return request.method === "GET" ? readLimits(request) : acceptReplacement(request);
    };

    // WHEN the caller tries absent and non-HTML entries, then supplies the retained entry
    const missing = await call("update_publication", { manageUrl: siteManageUrl, files }, { fetch, ownerToken: owner });
    const refused = await Promise.all(["missing.html", "assets/site.css", "__MACOSX/skipped.html", "_bp/state/skipped.html"].map((entry) =>
      call("update_publication", { manageUrl: siteManageUrl, entry, files: [...files,
        { path: "__MACOSX/skipped.html", content: "<p>Auxiliary</p>" }, { path: "_bp/state/skipped.html", content: "<p>Reserved</p>" }] }, { fetch })));
    const result = await call("update_publication", { manageUrl: siteManageUrl, files, entry: "./docs\\home.html", tags: [], state: null }, { fetch, ownerToken: owner });

    // THEN the whole bundle and only the link's proof reach the target
    assert.equal(missing.isError, true, "Omitting the replacement entry must refuse before writing");
    assert.match(missing.content[0].text, /existing entryFile from the site's manifest/, "The refusal should identify the source of the current entry");
    assert.deepEqual(refused.map((answer) => answer.isError), [true, true, true, true], "Absent, non-HTML and discarded entries must refuse before writing");
    assert.deepEqual(calls, [{ href: `${origin}/api/limits`, method: "GET", ownerProof: [null, null] },
      { href: `${origin}/api/sites/public/${id}?tags=&entry=docs%2Fhome.html`, method: "PUT", paths: ["docs/home.html", "index.html", "assets/site.css"],
      contents: ["<h1>Update</h1>", "<h1>Old default</h1>", "h1{color:black}"], state: "null", proof: [null, manageKey] }], "Only the explicit replacement reaches the site's PUT route");
    assert.match(result.content[0].text, /did not confirm the requested Page data change/, "A missing marker must leave the clearing request unconfirmed");
    assert.equal(result.content[0].text.includes(manageKey), false, "A supplied management key should not be repeated");
  });

  await t.test("file replacement returning a page", async () => {
    // GIVEN a safe source download and a backend conversion response
    const fileUrl = "https://files.example.org/notes.md?download=1";
    const seen: unknown[] = [];
    const fetch: typeof globalThis.fetch = async (url, init) => {
      const request = new Request(url, init);
      const file = (await request.formData()).get("file") as File;
      seen.push([request.method, request.url, file.name, await file.text()]);
      return Response.json({ namespace: "public", id, link, ownerLink: `${origin}/api/html/public/${id}`,
        notices: [{ code: "markdown-file-as-page", message: "Uploaded as a page." }] });
    };
    const compactFetchSource = async (url: string) => {
      seen.push(url);
      return new Blob(["# Notes"], { type: "text/markdown" });
    };

    // WHEN the file is replaced from the selected source
    const result = await call("update_publication", { ownerToken: owner, kind: "file", namespace: "public", id, url: fileUrl }, { fetch, compactFetchSource });

    // THEN the URL is fetched once and the replacement receipt declares the actual kind
    assert.deepEqual(seen, [fileUrl, ["PUT", `${origin}/api/files/public/${id}`, "notes.md", "# Notes"]], "A file replacement must send one multipart PUT after the isolated source fetch");
    assert.match(result.content[0].text, /Updated: html public\/DEMO123456[\s\S]+markdown-file-as-page/, "The result should report the conversion and backend notice");
  });
});

test("Only compact creation treats an empty namespace like the private default", async () => {
  // GIVEN the exact requested HTML and a receipt that reflects the namespace sent on the wire.
  const content = "<h1>Meetup notes</h1>";
  const effects: unknown[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const target = new URL(String(url));
    const namespace = target.searchParams.get("ns") ?? "";
    const visibility = /^priv-[a-z0-9]{6}$/.test(namespace) ? "private" : namespace;
    effects.push({ method: init?.method, route: target.pathname, visibility, body: parseBody(init?.body), verbatim: target.searchParams.get("verbatim") });
    return Response.json({ namespace, id, kind: "html", link: `${origin}/${namespace}/${id}`, listed: namespace === "public" }, { status: 201 });
  };
  const cases = [
    { tool: "publish", args: { content }, namespace: /^priv-[a-z0-9]{6}$/ },
    { tool: "publish", args: { content, namespace: "" }, namespace: /^priv-[a-z0-9]{6}$/ },
    { tool: "publish", args: { content, namespace: "public" }, namespace: /^public$/ },
    { tool: "publish", args: { content, namespace: " " }, namespace: undefined },
    { tool: "publish", args: { content, namespace: "public/path" }, namespace: undefined },
    { tool: "update_publication", args: { kind: "html", content, namespace: "", id, ownerToken: owner }, namespace: undefined },
  ];
  // WHEN each spelling reaches the registered SDK tool.
  for (const row of cases) {
    const answer = await call(row.tool, row.args, { fetch });
    assert.equal(answer.isError, row.namespace ? undefined : true, `${row.tool} namespace ${JSON.stringify(row.args.namespace)} must select the expected outcome`);
    assert.match(String(answer.structuredContent?.namespace), row.namespace ?? /^undefined$/, "only a valid create confirms a namespace");
  }
  // THEN the rejected forms cause zero effects and the accepted forms keep the requested material.
  const write = { method: "POST", route: "/api/html", body: { content }, verbatim: "true" };
  assert.deepEqual(effects, [{ ...write, visibility: "private" }, { ...write, visibility: "private" }, { ...write, visibility: "public" }],
    "only explicit public intent selects the public namespace");
});

test("Empty signed creates leave namespace resolution to the same owning account for every kind", async () => {
  // GIVEN one signed authority and all supported artifact types.
  const effects: unknown[] = [];
  const accountNamespace = "priv-account";
  const options: ServerOptions = {
    authority: "account",
    fetch: async () => { throw new Error("Unexpected anonymous dispatch."); },
    compactFetchSource: async () => new Blob(["Fixture"]),
    async bridge(operation, args) {
      const payload = JSON.parse(JSON.stringify(args));
      effects.push([operation, payload.kind, Object.hasOwn(payload, "namespace"), payload.namespace]);
      return { ok: true, status: 201, headers: new Headers(), data: {
        kind: payload.kind, namespace: accountNamespace, id, link: `${origin}/${accountNamespace}/${id}`,
      } };
    },
  };
  const artifacts = [
    { kind: "html", content: "<h1>Meetup notes</h1>" },
    { kind: "site", files: [{ path: "index.html", content: "<h1>Site</h1>" }] },
    { kind: "file", url: "https://source.example.invalid/fixture.txt" },
    { kind: "json", json: { note: "Fixture" } },
    { kind: "kv", key: "note", value: "Fixture" },
  ];
  // WHEN empty namespaces reach signed creates and plain HTML also uses omission and explicit public.
  for (const artifact of artifacts) {
    const answer = await call("publish", { ...artifact, namespace: "", requireAccount: true }, options);
    assert.equal(answer.structuredContent?.namespace, accountNamespace, `${artifact.kind} uses the account's resolved namespace`);
  }
  await call("publish", { ...artifacts[0], requireAccount: true }, options);
  await call("publish", { ...artifacts[0], namespace: "public", requireAccount: true }, options);
  // THEN blank and omitted use identical private bridge options and explicit public survives.
  assert.deepEqual(effects, [
    ["publish", "html", false, undefined], ["publish", "site", false, undefined], ["publish_file", "file", false, undefined],
    ["publish", "json", false, undefined], ["publish", "kv", false, undefined],
    ["publish", "html", false, undefined], ["publish", "html", true, "public"],
  ], "every create stays on the signed bridge with the intended namespace handling");
});

test("Supplied HTML defaults to verbatim for compact writes while cached writes keep paste repair", async () => {
  // GIVEN one HTML source and the same target on typed account and public REST transports.
  const requests: unknown[] = [];
  const target = { kind: "html", namespace: "public", id };
  const options: ServerOptions = {
    authority: "account",
    async bridge(operation, args) {
      requests.push([operation, JSON.parse(JSON.stringify(args))]);
      return { ok: true, status: 200, headers: new Headers(), data: { ...target, link } };
    },
    fetch: async () => { throw new Error("Unexpected anonymous fallback."); },
  };
  const publicFetch: typeof globalThis.fetch = async (url, init) => {
    requests.push([url, init?.method, parseBody(init?.body)]);
    return Response.json({ ...target, link });
  };
  const create = { content: htmlSource, namespace: target.namespace };
  const update = { ...create, id };
  // WHEN compact create/update, cached create/update and one explicit opt-out run.
  await call("publish", create, options);
  await call("update_publication", { ...update, kind: "html" }, options);
  await call("publish_html", create, options);
  await call("update_html", update, options);
  await call("update_publication", { ...update, kind: "html", verbatim: false }, options);
  await call("update_publication", { ...update, kind: "html", ownerToken: owner }, { fetch: publicFetch });
  // THEN only compact defaults carry the flag and every route receives the exact source.
  assert.deepEqual(requests, [
    ["publish", { ...create, kind: "html", verbatim: true }],
    ["update_publication", { ...update, kind: "html", verbatim: true }],
    ["publish", { ...create, kind: "html" }],
    ["update_publication", { ...update, kind: "html" }],
    ["update_publication", { ...update, kind: "html" }],
    [`${origin}/api/html/public/${id}?verbatim=true`, "PUT", { content: htmlSource }],
  ], "Every write should keep the exact source and original target with the correct flag");
});

test("Signed site replacement resolves a retained entry while cached calls preserve fallback", async () => {
  // GIVEN a backend returning a site stub without applying the requested Page data.
  const requests: unknown[] = [];
  const options: ServerOptions = {
    authority: "account",
    async bridge(operation, args) {
      requests.push([operation, JSON.parse(JSON.stringify(args))]);
      return { ok: true, status: 200, headers: new Headers(), data: operation === "limits" ? { sites: { allowedExtensions: ["html"] } }
        : { kind: "site", namespace: "public", id, link, stateApplied: false } };
    },
  };
  const files = [{ path: "./docs/index.html", content: "<h1>Site</h1>" }];
  const target = { kind: "site", namespace: "public", id };
  // WHEN the signed owner publishes and replaces using both compact and cached calls.
  const created = await call("publish", { kind: "site", files, namespace: "public", state: {} }, options);
  const missing = await call("update_publication", { ...target, files, entry: "missing.html" }, options);
  const retained = await call("update_publication", { ...target, files, entry: "docs//index.html" }, options);
  const excluded = await call("update_publication", { ...target, files: [...files, { path: "docs/old.htm", content: "<p>Old</p>" }], entry: "docs/old.htm" }, options);
  const omitted = await call("update_html", { files, namespace: "public", id }, options);
  const fallback = await call("update_html", { files, namespace: "public", id, entry: "missing.html" }, options);
  // THEN only compact validates the selected member and the create receipt reports the known result.
  assert.deepEqual({ requests, stateApplied: created.structuredContent?.stateApplied,
    pageDataEnabled: created.structuredContent?.pageDataEnabled, errors: [missing.isError, retained.isError, excluded.isError, omitted.isError, fallback.isError] }, {
    requests: [
      ["publish", { kind: "site", files, namespace: "public", state: {} }],
      ["limits", {}],
      ["update_publication", { ...target, files, entry: "docs/index.html" }],
      ["limits", {}],
      ["update_publication", { ...target, files }],
      ["update_publication", { ...target, files, entry: "missing.html" }],
    ],
    stateApplied: false, pageDataEnabled: undefined, errors: [true, undefined, true, undefined, undefined],
  }, "The compact replacement should require the retained entry and cached dispatch should keep its input");
  assert.match(created.content[0].text, /did not apply the requested Page data change/, "The user should see the unapplied change");
  assert.doesNotMatch(created.content[0].text, /Page data: on/, "The receipt should not claim Page data is on");
  assert.match(excluded.content[0].text, /does not accept the named entry's extension/, "The configured custom extension policy must prevent fallback");
});

test("An unavailable site policy stops a compact replacement before its write", async () => {
  // GIVEN a valid bundle and a deployment that cannot confirm its current intake policy.
  const requests: string[] = [];
  const fetch: typeof globalThis.fetch = async (url) => {
    requests.push(String(url));
    return Response.json({ sites: {} });
  };
  // WHEN the selected owner submits the replacement.
  const result = await call("update_publication", { manageUrl: siteManageUrl, entry: "index.html", files: [{ path: "index.html", content: "<p>Original</p>" }] }, { fetch });
  // THEN only the existing REST limits read is attempted.
  assert.deepEqual({ error: result.isError, requests }, { error: true, requests: [`${origin}/api/limits`] },
    "the previously published bundle is left in place when policy is missing");
  assert.match(result.content[0].text, /did not confirm the site's upload extensions/, "the refusal identifies the missing deployment facts");
});

test("Publication receipts preserve actual identity and distinguish Page data application from availability", async (t) => {
  const accountOrigin = "https://account.example.org:8443";
  const stub = { kind: "site", namespace: "private", id, entryFile: "index.html", link: `${origin}/private/${id}` };
  const page = { kind: "html", namespace: "public", id, link };
  const management = `${accountOrigin}/p/html/public/${id}`;
  const rows = [
    { name: "unsigned successful stub", authority: "unsigned", data: stub, pageDataEnabled: undefined,
      accountManagementUrl: undefined, outcome: /did not confirm the requested Page data change/ },
    { name: "unsigned settled declaration notice", authority: "unsigned", data: { ...page,
      notices: [{ code: "state-no-sdk", message: "Page data is on, but the page does not load the saving script." }] },
      pageDataEnabled: true, accountManagementUrl: undefined, outcome: /Page data: on\./ },
    { name: "signed applied and available", authority: "account", data: { ...page, stateApplied: true, manageUrl: management },
      pageDataEnabled: true, accountManagementUrl: management, outcome: /Page data: on\./ },
    { name: "signed applied with availability blocker", authority: "account",
      data: { ...page, stateApplied: true, manageUrl: management, notices: [{ code: "state-needs-subdomain", message: "The page needs its own address." }] },
      pageDataEnabled: undefined, accountManagementUrl: management, outcome: /Page data is unavailable for this publication/ },
    { name: "signed link for another target", authority: "account", data: { ...page, stateApplied: true, manageUrl: `${accountOrigin}/p/sites/public/${id}` },
      pageDataEnabled: true, accountManagementUrl: undefined, outcome: /Page data: on\./ },
    { name: "signed link with transferable proof", authority: "account", data: { ...page, stateApplied: true, manageUrl: `${management}#k=${manageKey}` },
      pageDataEnabled: true, accountManagementUrl: undefined, outcome: /Page data: on\./ },
    { name: "signed reader-only duplicate", authority: "account", data: { ...page, isOwner: false, manageUrl: management },
      pageDataEnabled: undefined, accountManagementUrl: undefined, outcome: /does not manage this publication/ },
  ] as const;
  await Promise.all(rows.map((row) => t.test(row.name, async () => {
    // GIVEN a publication receipt with its actual storage identity and Page data evidence.
    const seen: string[] = [];
    const options: ServerOptions = { authority: row.authority, accountOrigin,
      fetch: async (_url, init) => { seen.push(init!.method!); return Response.json(row.data); },
      bridge: async (operation) => { seen.push(operation); return { ok: true, status: 200, data: row.data, headers: new Headers() }; } };
    const material = row.data.kind === "site" ? { kind: "site", files: [{ path: "report.htm", content: htmlSource }] } : { content: htmlSource };
    // WHEN the caller publishes the supplied material with Page data.
    const result = await call("publish", { ...material, state: {}, namespace: "public" }, options);
    // THEN the real publication and only verified effects appear in the receipt.
    const { kind, namespace, id, link } = row.data;
    const { kind: storedKind, namespace: storedNamespace, id: storedId, link: storedLink, pageDataEnabled, accountManagementUrl } = result.structuredContent!;
    assert.deepEqual({ seen, storedKind, storedNamespace, storedId, storedLink, pageDataEnabled, accountManagementUrl, error: result.isError },
      { seen: [row.authority === "account" ? "publish" : "POST"], storedKind: kind, storedNamespace: namespace,
        storedId: id, storedLink: link, pageDataEnabled: row.pageDataEnabled, accountManagementUrl: row.accountManagementUrl, error: undefined },
      "The receipt should preserve the existing write identity and confirmed effects without further requests");
    assert.match(result.content[0].text, row.outcome, "The receipt should describe the confirmed or pending effect");
    assert.deepEqual({ stateOn: result.content[0].text.includes("Page data: on."),
      management: result.content[0].text.includes("Account management (sign in as owner):"), rawProof: result.content[0].text.includes(manageKey) },
    { stateOn: row.pageDataEnabled === true, management: row.accountManagementUrl === management, rawProof: false },
    "The owner receipt should reflect verified availability and show only a validated account handoff");
  })));
});

test("Signed publication writes distinguish lost receipts from known refusals", async (t) => {
  const rows = [
    { name: "write timeout", respond: () => { throw new DOMException("Fixture timed out", "TimeoutError"); }, sent: 1, expected: /WRITE_OUTCOME_UNKNOWN.*owner listing before retrying/ },
    { name: "gateway timeout", respond: () => new Response(null, { status: 504 }), sent: 1, expected: /WRITE_OUTCOME_UNKNOWN.*owner listing before retrying/ },
    { name: "malformed JSON", respond: () => new Response("{", { headers: { "Content-Type": "application/json" } }), sent: 1, expected: /WRITE_OUTCOME_UNKNOWN.*owner listing before retrying/ },
    { name: "missing receipt fields", respond: () => Response.json({ kind: "site" }), sent: 1, expected: /WRITE_OUTCOME_UNKNOWN.*owner listing before retrying/ },
    { name: "unavailable before dispatch", respond: () => Response.json(receipt), sent: 0, expected: /503.*bridge_unavailable/ },
    { name: "known refusal", respond: () => Response.json({ code: "EDIT_REFUSED" }, { status: 403 }), sent: 1, expected: /403.*EDIT_REFUSED/ },
  ];
  await Promise.all(rows.map((row) => t.test(row.name, async () => {
    // GIVEN the actual bridge adapter with a synthetic backend write response.
    const sent: string[] = [];
    const bridge = createBridge(origin, row.sent === 0 ? undefined : "fixture-service", "fixture-account", async (url) => {
      sent.push(String(url));
      return row.respond();
    });
    // WHEN the caller requests one signed publication write.
    const result = await call("publish", { content: htmlSource }, { authority: "account", bridge: bridge.call });
    // THEN the outcome distinguishes a known refusal from loss after dispatch, without retrying.
    assert.deepEqual({ sent, error: result.isError }, { sent: Array(row.sent).fill(`${origin}/internal/mcp/v1/operations/publish`), error: true },
      "The requested account write should have at most one backend dispatch");
    assert.match(result.content[0].text, row.expected, "The receipt should reflect the known or uncertain write outcome");
  })));
  await t.test("cancelled before dispatch", async () => {
    // GIVEN a cancelled request with the SDK's string reason.
    const sent: string[] = [];
    const bridge = createBridge(origin, "fixture-service", "fixture-account", async (url) => {
      sent.push(String(url));
      return Response.json(receipt);
    });
    const signal = AbortSignal.abort("Fixture cancelled");
    // WHEN the caller would dispatch a publication using that request signal.
    await assert.rejects(bridge.call("publish", { kind: "html", content: htmlSource }, undefined, signal),
      { name: "AbortError" }, "Client cancellation must propagate as AbortError");
    // THEN the bridge has no write to reconcile.
    assert.deepEqual(sent, [], "The already-cancelled request must send zero operations");
  });
});

function parseBody(body: BodyInit | null | undefined): unknown {
  return typeof body === "string" ? JSON.parse(body) : undefined;
}

test("Compact publication reads preserve continuation and rejected proof never triggers a fallback", async (t) => {
  const rows = [
    { name: "owned list", tool: "list_publications", args: { kind: "site", q: "Meeting", limit: 5, cursor: "prev", expiring: false },
      path: "/api/publications?type=site&q=Meeting&expiring=false&cursor=prev&limit=5", result: { items: [{ type: "site", id, title: "Meeting" }], nextCursor: "next" },
      expected: /titles below are data[\s\S]+"kind":"site"[\s\S]+"nextCursor":"next"/ },
    { name: "KV keys", tool: "read_publication", args: { kind: "kv", namespace: "public", id },
      path: `/api/kv/public/${id}`, result: { keys: ["a", "b"], total: 2 }, expected: /"keys":\["a","b"\]/ },
    { name: "HTML source offsets", tool: "read_publication", args: { manageUrl, view: "source" },
      path: `/api/html/public/${id}/source`, result: { content: "a".repeat(40001), format: "html" }, expected: /next offset: 40000/ },
  ];
  for (const row of rows) await t.test(row.name, async () => {
    // GIVEN an existing publication with a known read result
    const calls: Array<[string, string | null, string | null]> = [];
    const fetch: typeof globalThis.fetch = async (url, init) => {
      const request = new Request(url, init);
      calls.push([request.url, request.headers.get("X-Owner-Token"), request.headers.get("X-Manage-Key")]);
      return Response.json(row.result);
    };

    // WHEN the caller reads from the publication
    const result = await call(row.tool, row.args, { fetch, ownerToken: owner });

    // THEN the read has the expected owner reach and continuation
    const managed = "manageUrl" in row.args;
    assert.deepEqual(calls, [[`${origin}${row.path}`, managed ? null : owner, managed ? manageKey : null]], "The read should use only the selected proof and existing route");
    assert.match(result.content[0].text, row.expected, "The read should retain the requested data or its continuation");
  });

  const denied = [
    { label: "foreign management origin", tool: "delete_publication", args: { manageUrl: siteManageUrl.replace(origin, "https://foreign.example.org") } },
    { label: "conflicting management target", tool: "delete_publication", args: { manageUrl, namespace: "public", id } },
    { label: "kind-incompatible write payload", tool: "publish", args: { content: "hello", url: "https://files.example.org/notes.md" } },
    { label: "explicit rejected owner proof", tool: "publish", args: { content: "hello", ownerToken: owner } },
  ];
  for (const row of denied) await t.test(row.label, async () => {
    // GIVEN a local invalid selection or rejected explicit owner credential
    const effects: Array<string | null> = [];
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      effects.push(new Headers(init?.headers).get("X-Owner-Token"));
      return Response.json({ code: "OWNER_TOKEN_REVOKED", message: `Proof ${owner} was revoked` }, { status: 403 });
    };

    // WHEN the selection is submitted through the compact tool
    const result = await call(row.tool, row.args, { fetch });

    // THEN the outcome is a refusal without falling back or leaking proof
    assert.deepEqual(effects, row.label === "explicit rejected owner proof" ? [owner] : [], "Only the explicit proof may be tried and only once");
    assert.equal(result.isError, true, "Invalid or denied proof should produce an error result");
    assert.doesNotMatch(result.content[0].text, new RegExp(`${owner}|${manageKey}`), "Errors should never disclose supplied proof");
  });
});
