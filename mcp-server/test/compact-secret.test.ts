import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createServer, type ServerOptions } from "../src/tools.js";
import { sealSecret } from "../src/compact/secret.js";
import type { ToolAnswer } from "../src/compact/context.js";

const origin = "https://brewpage.app";
const secretId = "AbCdEfGhIjKlMnOpQrStU_";
// Fixed vectors of the app's frontend/test/oneTimeSecret.test.mjs.
const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
const IV = Uint8Array.from({ length: 12 }, (_, i) => 0xa0 + i);
const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

// Port of the reveal page's decrypt (secret-crypto.js): key shape, iv size, AES-GCM tag 128, fatal UTF-8.
async function browserDecrypt(ciphertext: string, iv: string, key: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error("bad key");
  const unb64u = (text: string) => {
    if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new Error("not base64url");
    return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4)), (c) => c.charCodeAt(0));
  };
  const nonce = unb64u(iv);
  if (nonce.length !== 12) throw new Error("bad iv");
  const k = await webcrypto.subtle.importKey("raw", unb64u(key), { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, k, unb64u(ciphertext));
  return new TextDecoder("utf-8", { fatal: true }).decode(plain);
}

async function browserEncrypt(text: string): Promise<string> {
  const k = await webcrypto.subtle.importKey("raw", KEY, { name: "AES-GCM" }, false, ["encrypt"]);
  return b64u(new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: IV, tagLength: 128 }, k, new TextEncoder().encode(text))));
}

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

test("GIVEN the app's fixed key, iv and texts WHEN the MCP seals them THEN bytes equal browser WebCrypto and the reveal page opens them", async () => {
  const rows: Array<[string, string, number]> = [["ascii password", "hunter2-Pa$$w0rd", 43],
    ["unicode, newlines", "Пароль: ключ 🔑\nline two\r\n\ttab", 78], ["10,000 three-byte chars", "€".repeat(10000), 40022]];
  const got = [];
  for (const [label, text] of rows) {
    const sealed = sealSecret(text, { key: KEY, iv: IV });
    got.push([label, { ...sealed, size: sealed.ciphertext.length, back: await browserDecrypt(sealed.ciphertext, sealed.iv, sealed.key) }]);
  }
  const expected = [];
  for (const [label, text, size] of rows) expected.push([label, { ciphertext: await browserEncrypt(text), iv: b64u(IV), key: b64u(KEY), size, back: text }]);
  assert.deepEqual(got, expected, "ciphertext+tag equals WebCrypto AES-GCM output, key 43 / iv 16 chars, exact sizes, the page's decrypt returns the text");
});

test("GIVEN kind=secret WHEN publish runs unsigned or on an account THEN only ciphertext reaches POST /api/secrets and the link carries the key", async (t) => {
  const text = "db password: s3cr3t!";
  for (const authority of ["unsigned", "account"] as const) await t.test(authority, async () => {
    const calls: Array<{ href: string; method: string; body: Record<string, unknown>; proof: Array<string | null> }> = [];
    const bridged: string[] = [];
    const fetch: typeof globalThis.fetch = async (url, init) => {
      const request = new Request(url, init);
      calls.push({ href: request.url, method: request.method, body: await request.json(),
        proof: [request.headers.get("X-Owner-Token"), request.headers.get("X-Manage-Key")] });
      return Response.json({ id: secretId, expiresAt: "2026-11-23T10:00:00Z", maxViews: 2 }, { status: 201 });
    };
    const result = await call("publish", { kind: "secret", text, ttl: "1d", maxViews: 2 }, { fetch, authority, ownerToken: "env-owner-token",
      bridge: async (operation) => { bridged.push(operation); return { ok: false, status: 500, data: null, headers: new Headers() }; } });
    const sent = calls[0].body;
    const link = String(result.structuredContent?.link);
    const key = link.split("#")[1];
    assert.deepEqual({
      calls: calls.map(({ href, method, body, proof }) => ({ href, method, fields: Object.keys(body), ttl: body.ttl, maxViews: body.maxViews, proof })),
      bridged, isError: result.isError, link: link.replace(key, "<key>"), opened: await browserDecrypt(String(sent.ciphertext), String(sent.iv), key),
      plainSent: JSON.stringify(calls).includes(text), plainEchoed: result.content[0].text.includes(text), keySent: JSON.stringify(calls).includes(key),
      structured: { ...result.structuredContent, link: "<link>" },
    }, {
      calls: [{ href: `${origin}/api/secrets`, method: "POST", fields: ["ciphertext", "iv", "ttl", "maxViews"], ttl: "1d", maxViews: 2, proof: [null, null] }],
      bridged: [], isError: undefined, link: `${origin}/secret/${secretId}#<key>`, opened: text,
      plainSent: false, plainEchoed: false, keySent: false,
      structured: { kind: "secret", id: secretId, link: "<link>", expiresAt: "2026-11-23T10:00:00Z", maxViews: 2 },
    }, "one anonymous create with ciphertext only, the key only in the link fragment, the reveal page opens it, no plain text anywhere");
    assert.match(result.content[0].text, /^One-time secret created\.\nSECRET LINK \(give it only to the intended recipient\): \S+\nIt can be opened 2 times, then it stops working; unopened, it expires at 2026-11-23T10:00:00Z\.\nThe key is only in the link's #fragment: .+This MCP server and you saw the plain text/,
      "The receipt names the link, the view budget and who saw the text");
  });
});

test("GIVEN a secret mixed with publication fields or a refused create WHEN publish runs THEN it refuses with no or one request", async (t) => {
  const unused = () => Response.json({ code: "UNEXPECTED_REQUEST" }, { status: 500 });
  const rows = [
    { name: "namespace", args: { kind: "secret", text: "x1", namespace: "public" }, answer: unused, calls: 0, text: /`namespace` is unavailable for kind=secret/ },
    { name: "owner token", args: { kind: "secret", text: "x1", ownerToken: "fixture" }, answer: unused, calls: 0, text: /`ownerToken` is unavailable for kind=secret/ },
    { name: "html content", args: { kind: "secret", text: "x1", content: "<p>x</p>" }, answer: unused, calls: 0, text: /`content` is unavailable for kind=secret/ },
    { name: "blank text", args: { kind: "secret", text: "  " }, answer: unused, calls: 0, text: /`text` is required for kind=secret/ },
    { name: "text on html", args: { content: "<p>x</p>", text: "x1" }, answer: unused, calls: 0, text: /`text` is only for kind=secret/ },
    { name: "switched off", args: { kind: "secret", text: "x1" }, calls: 1, text: /^Failed to create secret: HTTP 503 · SECRETS_UNAVAILABLE · Off\.$/,
      answer: () => Response.json({ code: "SECRETS_UNAVAILABLE", message: "Off." }, { status: 503 }) },
    { name: "id of another shape", args: { kind: "secret", text: "x1" }, calls: 1, text: /invalid secret receipt\. No link was given out/,
      answer: () => Response.json({ id: "short", expiresAt: "2026-11-23T10:00:00Z", maxViews: 1 }, { status: 201 }) },
  ];
  for (const row of rows) await t.test(row.name, async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => { calls++; return row.answer(); };
    const result = await call("publish", row.args, { fetch });
    assert.deepEqual({ isError: result.isError, calls, link: result.structuredContent?.link }, { isError: true, calls: row.calls, link: undefined },
      "A refused or failed secret is an error with the expected requests and no link");
    assert.match(result.content[0].text, row.text, "The refusal names the field or the server code");
  });
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
