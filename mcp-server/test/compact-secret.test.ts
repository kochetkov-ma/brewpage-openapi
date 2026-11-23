import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createServer, type ServerOptions } from "../src/tools.js";
import { openSecret, SecretOpenError, sealSecretFile, sealSecretText, secretKeyCheck, type OpenedSecret } from "../src/compact/secret.js";
import { checkSecretFile } from "../src/compact/secret-files.js";
import type { ApiAnswer, ToolAnswer } from "../src/compact/context.js";
import { toolAuthority } from "../src/compact/auth.js";

const origin = "https://brewpage.app";
const account = "https://account.brewpage.app";
const secretId = "AbCdEfGhIjKlMnOpQrStU_";
const ref = "Rf3kQ9xLm2";
const manageKey = `bpm_${"a1B2".repeat(8)}`;
const manageUrl = `${origin}/manage/secrets/${ref}#k=${manageKey}`;
const accountLink = `${account}/p/secrets/${ref}`;
// Shared with the app (frontend/test/fixtures/secret-vectors.json), copied by scripts/sync-secret-files.mjs.
const VECTORS = JSON.parse(readFileSync(new URL("./fixtures/secret-vectors.json", import.meta.url), "utf8")) as {
  keyCheckLabel: string; keyChecks: Array<{ key: string; keyCheck: string }>;
  seals: Array<{ label: string; key: string; iv: string; plaintextHex: string; ciphertext: string;
    input: null | { text: string } | { file: { name: string; type: string; bytesHex: string } };
    open: { kind: "text"; text: string } | { kind: "file"; name: string; type: string; bytesHex: string } | { error: string } }>;
};
const raw = (value: string) => Uint8Array.from(Buffer.from(value, "base64url"));
const opened = (secret: OpenedSecret) => secret.kind === "text" ? secret
  : { kind: secret.kind, name: secret.name, type: secret.type, bytesHex: Buffer.from(secret.bytes).toString("hex") };

async function call(name: string, args: Record<string, unknown>, options: ServerOptions): Promise<ToolAnswer> {
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  const server = createServer(options);
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(new Request(`${origin}/mcp`, { method: "POST", headers: {
      "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const envelope = await response.json() as { result?: ToolAnswer; error?: unknown };
    assert.equal(envelope.error, undefined, "The tool should be callable through JSON-RPC");
    return envelope.result!;
  } finally {
    await server.close();
  }
}

test("GIVEN the app's shared secret vectors WHEN the MCP seals, opens and checks keys THEN every byte and verdict matches", () => {
  const got = {
    keyChecks: VECTORS.keyChecks.map(({ key }) => secretKeyCheck(raw(key))),
    seals: VECTORS.seals.map((row) => {
      const fixed = { key: raw(row.key), iv: raw(row.iv) };
      const sealed = row.input === null ? null : "text" in row.input ? sealSecretText(row.input.text, fixed)
        : sealSecretFile(row.input.file.name, row.input.file.type, Buffer.from(row.input.file.bytesHex, "hex"), fixed);
      let open: unknown;
      try { open = opened(openSecret(row.ciphertext, row.iv, row.key)); } catch (error) { open = { error: (error as SecretOpenError).reason }; }
      return [row.label, sealed && { ciphertext: sealed.ciphertext, keyCheck: sealed.keyCheck }, open];
    }),
  };
  assert.deepEqual(got, {
    keyChecks: VECTORS.keyChecks.map(({ keyCheck }) => keyCheck),
    seals: VECTORS.seals.map((row) => [row.label, row.input && { ciphertext: row.ciphertext, keyCheck: secretKeyCheck(raw(row.key)) }, row.open]),
  }, "Key checks, raw-text and envelope seals equal the app's bytes; the reader opens text and files and refuses newer or malformed plaintexts");
});

test("GIVEN .env-shaped names WHEN the file gate checks text THEN only .env and .env. plus one listed part pass", () => {
  const bytes = Buffer.from("API_KEY=x1y2z3\n");
  const names = [".env.bat", ".env.html", ".env.local.bat", ".env.local", ".env.Production", ".env"];
  assert.deepEqual(names.map((name) => [name, checkSecretFile(name, bytes, true)?.code ?? null]), [
    [".env.bat", "SECRET_FILE_TYPE"], [".env.html", "SECRET_FILE_TYPE"], [".env.local.bat", "SECRET_FILE_TYPE"],
    [".env.local", null], [".env.Production", null], [".env", null],
  ], "A .env. name takes exactly one listed part; executables and markup after the prefix are refused at step 4");
});

test("GIVEN kind=secret WHEN publish runs unsigned or on an account THEN only ciphertext and its key check leave, the link opens it", async (t) => {
  const text = "-----BEGIN KEY-----\nZXhhbXBsZQ==\n-----END KEY-----\n";
  const rows = [
    { name: "unsigned text, env token", authority: "unsigned" as const, args: { kind: "secret", title: "DB password", text, ttl: "1d", maxViews: 2, note: "for Ana" },
      kind: "text", proof: "env-owner-token", issued: "env-owner-token", open: { kind: "text", text } },
    { name: "unsigned file, new token", authority: "unsigned" as const, args: { kind: "secret", title: "Deploy key", text, filename: "id_ed25519", tags: ["ops"] },
      kind: "file", proof: null, issued: "fresh-owner-token", open: { kind: "file", name: "id_ed25519", type: "", bytesHex: Buffer.from(text).toString("hex") } },
    { name: "account file", authority: "account" as const, args: { kind: "secret", title: "Deploy key", text, filename: "prod.env" },
      kind: "file", proof: null, issued: undefined, open: { kind: "file", name: "prod.env", type: "", bytesHex: Buffer.from(text).toString("hex") } },
  ];
  for (const row of rows) await t.test(row.name, async () => {
    const sent: Array<{ via: string; url?: string; body: Record<string, unknown>; proof?: string | null }> = [];
    const fetch: typeof globalThis.fetch = async (url, init) => {
      const request = new Request(url, init);
      const body = await request.json() as Record<string, unknown>;
      sent.push({ via: "api", url: request.url, body, proof: request.headers.get("X-Owner-Token") });
      return Response.json({ id: secretId, ref, kind: body.kind, title: body.title, expiresAt: "2026-11-23T10:00:00Z", maxViews: body.maxViews ?? 1,
        ownerToken: row.issued, manageUrl }, { status: 201 });
    };
    const bridge: ServerOptions["bridge"] = async (operation, args) => {
      const body = JSON.parse(JSON.stringify(args)) as Record<string, unknown>;
      sent.push({ via: `bridge ${operation}`, body });
      return { ok: true, status: 200, headers: new Headers(), data: { kind: "secret", secretKind: body.secretKind, id: secretId, ref, title: body.title,
        address: `${origin}/secret/${secretId}`, manageUrl: `${account}/p/secrets/${ref}`, expiresAt: "2026-11-23T10:00:00Z", maxViews: 1, notices: [] } };
    };
    const result = await call("publish", row.args, { fetch, bridge, authority: row.authority, ownerToken: row.proof ?? undefined });
    const structured = result.structuredContent ?? {};
    const key = String(structured.key);
    const body = sent[0].body;
    assert.deepEqual({
      sent: sent.map(({ via, url, body, proof }) => ({ via, url, proof, fields: Object.keys(body).sort(), kind: body.kind, secretKind: body.secretKind })),
      keyCheck: body.keyCheck === secretKeyCheck(raw(key)), opened: opened(openSecret(String(body.ciphertext), String(body.iv), key)),
      leaked: [text, key].filter((value) => JSON.stringify(sent).includes(value)).length,
      link: structured.link, private: [structured.ownerToken, structured.manageUrl, structured.accountManagementUrl], isError: result.isError,
    }, {
      sent: [row.authority === "account"
        ? { via: "bridge publish", url: undefined, proof: undefined, fields: ["ciphertext", "iv", "keyCheck", "kind", "secretKind", "title"], kind: "secret", secretKind: row.kind }
        : { via: "api", url: `${origin}/api/secrets`, proof: row.proof, kind: row.kind, secretKind: undefined,
          fields: ["ciphertext", "iv", "keyCheck", "kind", "title", ...("note" in row.args ? ["maxViews", "note", "ttl"] : ["tags"])].sort() }],
      keyCheck: true, opened: row.open, leaked: 0, link: `${origin}/secret/${secretId}#${key}`,
      private: row.authority === "account" ? [undefined, undefined, `${account}/p/secrets/${ref}`] : [row.proof ? undefined : row.issued, manageUrl, undefined],
      isError: undefined,
    }, "One create with ciphertext, iv and key check only; the key stays in the link; owner proof and private links per authority");
    assert.match(result.content[0].text, row.authority === "account" ? /Manage in the account .*\/p\/secrets\/Rf3kQ9xLm2/
      : row.proof ? /Existing owner token reused\.\nMANAGE LINK \(private; / : /OWNER TOKEN \(private\): fresh-owner-token\nMANAGE LINK \(private; /,
      "The receipt names where the owner manages the secret");
  });
});

test("GIVEN a secret with a bad field or a refused create WHEN publish runs THEN it refuses with no or one request", async (t) => {
  const unused = () => Response.json({ code: "UNEXPECTED_REQUEST" }, { status: 500 });
  const ok = (body: Record<string, unknown>) => () => Response.json({ id: secretId, ref, kind: "text", title: "T", expiresAt: "2026-11-23T10:00:00Z",
    maxViews: 1, ownerToken: "t", manageUrl, ...body }, { status: 201 });
  const secret = { kind: "secret", title: "Wi-Fi", text: "x1y2z3" };
  const rows = [
    { name: "no title", args: { kind: "secret", text: "x1" }, answer: unused, calls: 0, text: /`title` is required for kind=secret/ },
    { name: "title holds the secret", args: { ...secret, title: "Wi-Fi x1y2z3" }, answer: unused, calls: 0, text: /The title contains the secret/ },
    { name: "url", args: { ...secret, url: "https://example.org/key.pem" }, answer: unused, calls: 0, text: /`url` is unavailable for kind=secret: a secret that can be fetched/ },
    { name: "namespace", args: { ...secret, namespace: "public" }, answer: unused, calls: 0, text: /`namespace` is unavailable for kind=secret/ },
    { name: "blank text", args: { ...secret, text: "  " }, answer: unused, calls: 0, text: /`text` is required for kind=secret/ },
    { name: "script name", args: { ...secret, filename: "run.sh" }, answer: unused, calls: 0, text: /can't be sent as a secret\. Send a key, .*\(SECRET_FILE_TYPE\)/ },
    { name: "executable after .env.", args: { ...secret, filename: ".env.bat" }, answer: unused, calls: 0, text: /can't be sent as a secret\. .*\(SECRET_FILE_TYPE\)/ },
    { name: "binary type as text", args: { ...secret, filename: "vault.p12" }, answer: unused, calls: 0, text: /doesn't look like a \.p12 file\. \(SECRET_FILE_MISMATCH\)/ },
    { name: "shebang text", args: { ...secret, text: "#!/bin/sh\nrm -rf /", filename: "notes.txt" }, answer: unused, calls: 0, text: /\(SECRET_FILE_TYPE\)/ },
    { name: "note on html", args: { content: "<p>x</p>", note: "n" }, answer: unused, calls: 0, text: /`note` is only for kind=secret/ },
    { name: "switched off", args: secret, calls: 1, text: /^Failed to create secret: HTTP 503 · SECRETS_UNAVAILABLE · Off\.$/,
      answer: () => Response.json({ code: "SECRETS_UNAVAILABLE", message: "Off." }, { status: 503 }) },
    { name: "ref of another shape", args: secret, calls: 1, text: /invalid secret receipt\. No link was given out/, answer: ok({ ref: "short" }) },
    { name: "foreign manage link", args: secret, calls: 1, text: /invalid secret receipt/, answer: ok({ manageUrl: `https://evil.example/manage/secrets/${ref}#k=${manageKey}` }) },
  ];
  for (const row of rows) await t.test(row.name, async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => { calls++; return row.answer(); };
    const result = await call("publish", row.args, { fetch });
    assert.deepEqual({ isError: result.isError, calls, link: result.structuredContent?.link }, { isError: true, calls: row.calls, link: undefined },
      "A refused or failed secret is an error with the expected requests and no link");
    assert.match(result.content[0].text, row.text, "The refusal names the field, the gate code or the server code");
  });
});

test("GIVEN a secret target WHEN the owner tools run unsigned or on an account THEN each reaches its owner route or bridge arm by ref", async (t) => {
  const item = { ref, title: "Wi-Fi", tags: [], kind: "text", state: "waiting", maxViews: 1, viewsLeft: 1, opens: [],
    createdAt: "2026-11-22T10:00:00Z", expiresAt: "2026-11-29T10:00:00Z", manageLink: `${origin}/manage/secrets/${ref}` };
  const target = { kind: "secret", id: ref };
  const owner = { "X-Owner-Token": "tok-1" };
  const rows: Array<{ name: string; tool: string; args: Record<string, unknown>; authority: "unsigned" | "account"; status?: number; body?: unknown;
    want: unknown; text: RegExp }> = [
    { name: "read by ref", tool: "read_publication", args: { ...target, ownerToken: "tok-1" }, authority: "unsigned", body: item,
      want: ["GET", "/api/secrets/owner/Rf3kQ9xLm2", owner, null], text: /never include the content, the key or the secret link\.\n\{"kind":"secret","secretKind":"text","ref":"Rf3kQ9xLm2"/ },
    { name: "read by manage link", tool: "read_publication", args: { manageUrl }, authority: "unsigned", body: item,
      want: ["GET", "/api/secrets/owner/Rf3kQ9xLm2", { "X-Manage-Key": manageKey }, null], text: /"state":"waiting"/ },
    { name: "settings", tool: "publication_settings", args: { ...target, ownerToken: "tok-1", note: "", tags: ["home"] }, authority: "unsigned", body: item,
      want: ["PATCH", "/api/secrets/owner/Rf3kQ9xLm2", owner, { note: "", tags: ["home"] }], text: /"ref":"Rf3kQ9xLm2"/ },
    { name: "delete", tool: "delete_publication", args: { manageUrl }, authority: "unsigned", status: 204,
      want: ["DELETE", "/api/secrets/owner/Rf3kQ9xLm2", { "X-Manage-Key": manageKey }, null], text: /^Deleted secret Rf3kQ9xLm2: its link no longer opens/ },
    { name: "list group", tool: "list_publications", args: { kind: "secret", ended: true, limit: 5, ownerToken: "tok-1" }, authority: "unsigned",
      body: { items: [item], total: 1 }, want: ["GET", "/api/secrets?ended=true&limit=5", owner, null], text: /"secrets":\{"items":\[\{"ref":"Rf3kQ9xLm2"/ },
    { name: "account read", tool: "read_publication", args: target, authority: "account", body: item, want: ["read_publication", target], text: /"ref":"Rf3kQ9xLm2"/ },
    { name: "account settings", tool: "publication_settings", args: { ...target, title: "Home Wi-Fi" }, authority: "account", body: item,
      want: ["publication_settings", { ...target, title: "Home Wi-Fi" }], text: /"ref":"Rf3kQ9xLm2"/ },
    { name: "account delete", tool: "delete_publication", args: target, authority: "account", status: 204, want: ["delete_publication", target], text: /^Deleted secret/ },
    { name: "account read by account link", tool: "read_publication", args: { manageUrl: accountLink }, authority: "account", body: item,
      want: ["read_publication", target], text: /"ref":"Rf3kQ9xLm2"/ },
    { name: "account settings by account link", tool: "publication_settings", args: { manageUrl: accountLink, note: "n" }, authority: "account", body: item,
      want: ["publication_settings", { ...target, note: "n" }], text: /"ref":"Rf3kQ9xLm2"/ },
    { name: "account delete by account link", tool: "delete_publication", args: { manageUrl: accountLink }, authority: "account", status: 204,
      want: ["delete_publication", target], text: /^Deleted secret Rf3kQ9xLm2/ },
    { name: "account delete by html account link", tool: "delete_publication", args: { manageUrl: `${account}/p/html/priv-ab12cd/DEMO123456` },
      authority: "account", status: 204, want: ["delete_publication", { kind: "html", namespace: "priv-ab12cd", id: "DEMO123456" }], text: /^Deleted html priv-ab12cd\/DEMO123456/ },
    { name: "account settings view by site account link", tool: "read_publication", args: { manageUrl: `${account}/p/sites/public/DEMO123456`, view: "settings" },
      authority: "account", body: { listed: true }, want: ["read_publication", { kind: "site", namespace: "public", id: "DEMO123456", view: "settings" }], text: /"listed":true/ },
    { name: "account list", tool: "list_publications", args: { kind: "secret", ended: false }, authority: "account",
      body: { items: [], total: 0, secretCounts: { active: 1, spent: 0 }, secrets: { items: [item], total: 1 } },
      want: ["list_publications", { scope: "mine", kind: "secret", ended: false }], text: /"secretCounts":\{"active":1,"spent":0\},"secrets"/ },
  ];
  for (const row of rows) await t.test(row.name, async () => {
    const seen: unknown[] = [];
    const status = row.status ?? 200;
    const fetch: typeof globalThis.fetch = async (url, init) => {
      const request = new Request(url, init);
      const proof = Object.fromEntries(["X-Owner-Token", "X-Manage-Key"].flatMap((name) => request.headers.has(name) ? [[name, request.headers.get(name)]] : []));
      seen.push([request.method, request.url.slice(origin.length), proof, request.body ? await request.json() : null]);
      return status === 204 ? new Response(null, { status }) : Response.json(row.body, { status });
    };
    const bridge: ServerOptions["bridge"] = async (operation, args): Promise<ApiAnswer> => {
      seen.push([operation, JSON.parse(JSON.stringify(args))]);
      return { ok: true, status, headers: new Headers(), data: status === 204 ? null : row.body };
    };
    const result = await call(row.tool, row.args, { fetch, bridge, authority: row.authority });
    assert.deepEqual({ seen, isError: result.isError }, { seen: [row.want], isError: undefined }, "One owner request by ref with one proof");
    assert.match(result.content[0].text, row.text, "The answer carries the owner item or the outcome");
  });
});

test("GIVEN a secret target with a field it lacks WHEN an owner tool runs THEN it refuses before any request", async (t) => {
  const target = { kind: "secret", id: ref, ownerToken: "tok-1" };
  const rows = [
    { tool: "read_publication", args: { ...target, view: "stats" }, text: /`view` is unavailable for a secret/ },
    { tool: "read_publication", args: { ...target, namespace: "public" }, text: /A secret has no namespace/ },
    { tool: "publication_settings", args: { ...target, listed: false }, text: /`listed` is unavailable for a secret/ },
    { tool: "publication_settings", args: { ...target, title: " " }, text: /title can't be cleared/ },
    { tool: "publication_settings", args: { kind: "html", namespace: "public", id: "DEMO123456", ownerToken: "tok-1", note: "n" }, text: /`note` is only for a secret/ },
    { tool: "update_publication", args: { ...target, content: "<p>x</p>" }, text: /A secret's content can't be replaced/ },
    { tool: "list_publications", args: { kind: "secret", status: "private", ownerToken: "tok-1" }, text: /`ended` is for secrets and `status` for publications/ },
    { tool: "delete_publication", args: { manageUrl, ownerToken: "tok-1" }, text: /manage link was mixed with another target or owner token/ },
    { tool: "delete_publication", args: { manageUrl: accountLink }, text: /account management link: it carries no key[^\n]*\nNext: connect BrewPage in this client/ },
    { tool: "read_publication", args: { manageUrl: `${account}/p/html/priv-ab12cd/DEMO123456` }, text: /works only while this client is signed in/ },
    { tool: "delete_publication", args: { manageUrl: accountLink, ownerToken: "tok-1" }, text: /account link was mixed with another target or owner token/ },
    { tool: "read_page_data", args: { manageUrl: `${account}/p/kv/priv-ab12cd/DEMO123456` }, text: /account link is for another kind of publication/ },
    { tool: "account", args: { action: "claim", manageUrl: accountLink }, text: /does not take an account management link/ },
  ];
  for (const row of rows) await t.test(`${row.tool} ${Object.keys(row.args).join(",")}`, async () => {
    let calls = 0;
    const result = await call(row.tool, row.args, { fetch: async () => { calls++; return Response.json({}, { status: 500 }); } });
    assert.deepEqual({ isError: result.isError, calls }, { isError: true, calls: 0 }, "Refused before HTTP");
    assert.match(result.content[0].text, row.text, "The refusal names the unavailable field");
  });
});

test("GIVEN secret calls on the HTTP connection WHEN scopes are selected THEN each needs the account scope of its owner route", () => {
  const rows: Array<[string, Record<string, unknown>]> = [["publish", { kind: "secret", title: "T", text: "x" }], ["read_publication", { kind: "secret", id: ref }],
    ["publication_settings", { kind: "secret", id: ref, note: "" }], ["delete_publication", { kind: "secret", id: ref }], ["list_publications", { kind: "secret" }]];
  assert.deepEqual(rows.map(([name, args]) => toolAuthority(name, args).scopes),
    [["publications:write"], ["publications:read"], ["publications:write"], ["publications:write"], ["publications:read"]],
    "Secret create, settings and delete write; read and list read; none falls back to an anonymous call");
});

test("GIVEN a manageUrl WHEN the HTTP connection selects the proof THEN an account link uses the account and a keyed link stays an explicit proof", () => {
  const html = `${account}/p/html/public/DEMO123456`;
  const rows: Array<[string, string, Record<string, unknown>]> = [
    ["secret account link read", "read_publication", { manageUrl: accountLink }],
    ["secret account link delete", "delete_publication", { manageUrl: accountLink }],
    ["public html account link read", "read_publication", { manageUrl: html }],
    ["html account link settings", "publication_settings", { manageUrl: html, listed: false }],
    ["html account link page data", "read_page_data", { manageUrl: html }],
    ["keyed secret manage link", "delete_publication", { manageUrl }],
    ["account link on another account origin", "delete_publication", { manageUrl: accountLink.replace("account.", "other.") }],
  ];
  assert.deepEqual(rows.map(([label, name, args]) => [label, toolAuthority(name, args)]), [
    ["secret account link read", { accountOnly: false, explicitProof: false, scopes: ["publications:read"] }],
    ["secret account link delete", { accountOnly: false, explicitProof: false, scopes: ["publications:write"] }],
    ["public html account link read", { accountOnly: false, explicitProof: false, scopes: ["publications:read"] }],
    ["html account link settings", { accountOnly: false, explicitProof: false, scopes: ["publications:write"] }],
    ["html account link page data", { accountOnly: false, explicitProof: false, scopes: ["page-data:read"] }],
    ["keyed secret manage link", { accountOnly: false, explicitProof: true, scopes: ["publications:write"] }],
    ["account link on another account origin", { accountOnly: false, explicitProof: true, scopes: ["publications:write"] }],
  ], "Only an exact account link of this origin is signed; its scopes match the same call by kind and id");
});

test("GIVEN an account and a tag WHEN list_publications runs THEN the bridge gets the tag and the gallery refuses it", async () => {
  const operations: unknown[] = [];
  const bridge: ServerOptions["bridge"] = async (operation, args) => {
    operations.push({ operation, args: JSON.parse(JSON.stringify(args)) });
    return { ok: true, status: 200, headers: new Headers(), data: { items: [{ type: "html", id: "DEMO123456", tags: ["work"] }] } };
  };
  const mine = await call("list_publications", { tag: "work", limit: 5 }, { authority: "account", bridge });
  const gallery = await call("list_publications", { scope: "gallery", tag: "work" }, { authority: "account", bridge });
  assert.deepEqual({ operations, mineTags: (mine.structuredContent?.items as Array<{ tags: string[] }>)[0].tags, gallery: gallery.isError },
    { operations: [{ operation: "list_publications", args: { scope: "mine", tag: "work", limit: 5 } }], mineTags: ["work"], gallery: true },
    "The account listing forwards the exact tag and returns item tags; the public gallery has no tags");
});

test("GIVEN an unsigned owner with secrets WHEN list_publications runs without kind THEN the first page adds the active secrets group", async () => {
  const seen: string[] = [];
  const fetch: typeof globalThis.fetch = async (url) => {
    const path = String(url).slice(origin.length);
    seen.push(path);
    return Response.json(path.startsWith("/api/secrets") ? { items: [{ ref }], total: 1 } : { items: [], secretCounts: { active: 1, spent: 2 } });
  };
  const result = await call("list_publications", { q: "wifi", ownerToken: "tok-1" }, { fetch });
  assert.deepEqual({ seen, secrets: result.structuredContent?.secrets, counts: result.structuredContent?.secretCounts },
    { seen: ["/api/publications?q=wifi", "/api/secrets?q=wifi"], secrets: { items: [{ ref }], total: 1 }, counts: { active: 1, spent: 2 } },
    "Publications first, then the first active secrets page with the same filters, as the account bridge answers");
});
