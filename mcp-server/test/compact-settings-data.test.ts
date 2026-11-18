import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer, type ServerOptions } from "../src/tools.js";
import type { ApiAnswer, ToolAnswer } from "../src/compact/context.js";

const origin = "https://brewpage.app";
const id = "DEMO123457";
const address = { namespace: "public", id };
const ownerToken = "test-owner-token";
const target = { kind: "html", ...address, ownerToken };
const owner = ["X-Owner-Token", ownerToken];
const manageKey = `bpm_${"f".repeat(32)}`;
const manageUrl = `${origin}/manage/html/public/${id}#k=${manageKey}`;
const statePath = `/api/public/${id}/state`;

async function call(t: TestContext, name: string, args: Record<string, unknown>, options: ServerOptions): Promise<ToolAnswer> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(options);
  const client = new Client({ name: "compact-settings-data-test", version: "1.0.0" });
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return await client.callTool({ name, arguments: args }) as ToolAnswer;
}

interface RequestCall {
  method: string;
  url: string;
  body?: unknown;
  proof: Array<string | null>;
  ifMatch: string | null;
}

function fixture(...answers: Response[]) {
  const calls: RequestCall[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const request = new Request(url, init);
    const body = request.body ? await request.json() : undefined;
    const { pathname, search } = new URL(request.url);
    const proof = ["X-Owner-Token", "X-Manage-Key"].flatMap((header) => {
      const value = request.headers.get(header);
      return value === null ? [] : [header, value];
    });
    calls.push({ method: request.method, url: pathname + search, body, proof, ifMatch: request.headers.get("If-Match") });
    return answers[calls.length - 1] ?? Response.json({ code: "UNEXPECTED_REQUEST" }, { status: 500 });
  };
  return { calls, fetch };
}

function bridgeAnswer(data: unknown, status = 200): ApiAnswer {
  return { ok: status >= 200 && status < 300, status, data, headers: new Headers() };
}

test("Compact publication settings preserve applied effects and isolate disruptive actions", async (t) => {
  await Promise.all([
    t.test("partial settings batch", async (row) => {
      // GIVEN a visible page and a rejected title change
      const { fetch, calls } = fixture(Response.json({ listed: false }), Response.json({ code: "TITLE_REFUSED" }, { status: 403 }));
      // WHEN the batch reaches the second setting
      const result = await call(row, "publication_settings", { ...target, listed: false, title: "Dinner", extend: true }, { fetch });
      // THEN the receipt names every step and the last write stays unattempted
      assert.deepEqual(calls, [
        { method: "POST", url: `/api/html/public/${id}/visibility`, body: { listed: false }, proof: owner, ifMatch: null },
        { method: "POST", url: `/api/html/public/${id}/title`, body: { title: "Dinner" }, proof: owner, ifMatch: null },
      ], "The existing API should receive only the ordered writes through the first failure");
      assert.deepEqual(result, { isError: true, content: [{ type: "text",
        text: 'Applied: listed: {"listed":false}\nFailed: title · HTTP 403 · TITLE_REFUSED\nSkipped: extend' }] },
      "The receipt should preserve the completed, failed and skipped fields");
    }),
    t.test("invalid proof or action", async (row) => {
      // GIVEN incompatible proof, target and action combinations
      const { fetch, calls } = fixture();
      const invalid = [
        { ...target, action: "rotate_link", listed: false },
        { ...target, manageUrl, title: "Dinner" },
        { manageUrl: manageUrl.replace("brewpage.app", "example.org"), title: "Dinner" },
        { manageUrl, kind: "site", title: "Dinner" },
      ];
      // WHEN any pair is passed to the tool
      const results = await Promise.all(invalid.map((args) => call(row, "publication_settings", args, { fetch })));
      // THEN each returns its own refusal with zero effects
      assert.deepEqual(results.map((result) => result.isError), [true, true, true, true], "Every conflicting argument set should be refused");
      assert.deepEqual(calls, [], "No backend call should follow any local refusal");
    }),
    t.test("atomic state receipt and missing seam", async (row) => {
      // GIVEN the same owner and Page data rule change on configured and unavailable bridges
      const { fetch, calls } = fixture();
      const state = { collections: { votes: { mode: "private" } } };
      const mergedState = { declared: true, config: { collections: { ...state.collections, names: { mode: "private" } } } };
      const operations: unknown[] = [];
      // WHEN Page data settings are changed alone
      const result = await call(row, "publication_settings", { manageUrl, state }, { fetch, bridge: async (operation, args, proof) => {
        operations.push({ operation, args, proof });
        return bridgeAnswer(mergedState);
      } });
      const unavailable = await call(row, "publication_settings", { ...target, state: null }, { fetch });
      // THEN only the atomic operation receives the patch and a missing seam can't make a public replacement
      assert.deepEqual(operations, [{ operation: "merge_page_data", args: { kind: "html", ...address, state },
        proof: { proof: { manageKey } } }], "The Page data merge should receive only the changed rules and single owner proof");
      assert.deepEqual(result.structuredContent, { mergedState }, "The successful structured receipt should retain settings for all effective lists");
      assert.equal(unavailable.isError, true, "The missing atomic seam should refuse the update");
      assert.deepEqual(calls, [], "Atomic updates must never read and replace state through public REST");
    }),
  ]);
});

test("Compact domains do one requested operation and return the observed DNS state", async (t) => {
  const hostname = "schedule.example.org";
  const pending = { hostname, status: "pending_dns", serving: false, records: [{ type: "TXT", value: "bp-verify=fixture" }],
    nextStep: "Set the TXT record, then check once.", nextCheckAt: "2026-11-19T09:00:00Z" };
  const rows = [
    { action: "attach", args: { ...target, hostname }, method: "PUT", url: `/api/publications/html/public/${id}/domain`,
      body: { hostname }, response: Response.json(pending, { status: 201 }), result: JSON.stringify(pending) },
    { action: "check", args: { hostname, ownerToken }, method: "POST", url: `/api/domains/${hostname}/check`,
      body: undefined, response: Response.json(pending), result: JSON.stringify(pending) },
    { action: "detach", args: { hostname, ownerToken }, method: "DELETE", url: `/api/domains/${hostname}/attachment`,
      body: undefined, response: new Response(null, { status: 204 }), result: `Detached ${hostname}; it remains registered in the profile.` },
  ];
  await Promise.all(rows.map((row) => t.test(row.action, async (subtest) => {
    // GIVEN BrewPage's pending or detached result
    const { fetch, calls } = fixture(row.response);
    // WHEN the compact tool runs one domain action
    const result = await call(subtest, "domains", { action: row.action, ...row.args }, { fetch });
    // THEN the effect and receipt match the selected API operation
    assert.deepEqual(calls, [{ method: row.method, url: row.url, body: row.body, proof: owner, ifMatch: null }],
      "The request should target exactly the selected domain operation");
    assert.deepEqual(result, { content: [{ type: "text", text: row.result }] }, "The receipt should preserve the actual DNS result");
  })));
});

test("Compact Page data keeps versions and partial moderation while protecting downloads", async (t) => {
  await Promise.all([
    t.test("author conditional batch writes", async (row) => {
      // GIVEN an author's existing row and a stale second row
      const { fetch, calls } = fixture(Response.json({ key: "open", version: 2 }), Response.json({ code: "STATE_CONFLICT" }, { status: 409 }));
      // WHEN the caller writes JSON false and null with version guards
      const result = await call(row, "write_page_data", { ...target, collection: "agenda", docs: [
        { key: "open", value: false, version: 1 }, { key: "close", value: null, version: 4 }, { key: "later", value: 0 },
      ] }, { fetch });
      // THEN the original bodies and If-Match values reach the author route
      assert.deepEqual(calls, [
        { method: "PUT", url: `${statePath}/agenda/open`, body: false, proof: owner, ifMatch: "1" },
        { method: "PUT", url: `${statePath}/agenda/close`, body: null, proof: owner, ifMatch: "4" },
      ], "Every attempted write should carry the exact JSON value and version precondition");
      assert.deepEqual(result, { isError: true, content: [{ type: "text",
        text: 'Saved: [{"key":"open","version":2}]\nFailed: close · HTTP 409 · STATE_CONFLICT\nSkipped: ["later"]' }] },
      "The failure receipt should retain the saved version and identify each pending entry");
    }),
    t.test("signed mutation reconciliation", async (row) => {
      // GIVEN a lost write receipt, an unusable deletion receipt and a known partial write.
      const page = { ...address, kind: "html", collection: "agenda" };
      const write = { ...page, docs: [{ key: "opening", value: "09:30", version: 3 }, { key: "closing", value: "18:00" }] };
      const remove = { ...page, fileIds: ["FILE000001"] };
      const rows = [
        { name: "write_page_data", args: write, answer: bridgeAnswer({ code: "bridge_outcome_unknown" }, 502),
          expected: `WRITE_OUTCOME_UNKNOWN: Read the supplied entries and their versions in list agenda on html public/${id} before retrying the write.` },
        { name: "delete_page_data", args: remove, answer: bridgeAnswer({}),
          expected: `WRITE_OUTCOME_UNKNOWN: Check the selected files in list agenda on html public/${id} before retrying the delete.` },
        { name: "write_page_data", args: write, answer: bridgeAnswer({ saved: [{ key: "opening", version: 4 }],
          failed: { code: "STATE_CONFLICT", key: "closing" }, skipped: [] }, 409),
          expected: 'HTTP 409\nsaved: [{"key":"opening","version":4}]\nfailed: {"code":"STATE_CONFLICT","key":"closing"}\nskipped: []' },
      ];
      // WHEN the owner runs each mutation using the typed account bridge.
      const outcomes = await Promise.all(rows.map(async ({ name, args, answer }) => {
        const { fetch, calls } = fixture();
        const operations: unknown[] = [];
        const result = await call(row, name, args, { fetch, authority: "account", bridge: async (operation, input) => {
          operations.push([operation, JSON.parse(JSON.stringify(input))]);
          return answer;
        } });
        return { calls, operations, result };
      }));
      // THEN one scoped mutation runs and its receipt directs accurate readback or preserves partial progress.
      assert.deepEqual(outcomes, rows.map(({ name, args, expected }) => ({ calls: [], operations: [[name, args]],
        result: { isError: true, content: [{ type: "text", text: expected }] } })),
      "Ambiguous effects should identify the exact list with no replay, and a known partial result should remain intact");
    }),
    t.test("unsigned bulk-delete reconciliation", async (row) => {
      // GIVEN a known list whose bulk delete loses the result in transit.
      const requests: unknown[] = [];
      const fetch: typeof globalThis.fetch = async (url, init) => {
        const request = new Request(url, init);
        requests.push([request.method, new URL(request.url).pathname, request.headers.get("X-Owner-Token")]);
        throw new DOMException("Fixture timed out", "TimeoutError");
      };
      // WHEN the owner requests deletion of all entries and files in the list.
      const result = await call(row, "delete_page_data", { ...target, collection: "agenda", all: true }, { fetch });
      // THEN the tool requests current-list verification after just one REST write.
      assert.deepEqual({ requests, result }, { requests: [["DELETE", `${statePath}/agenda`, ownerToken]], result: {
        isError: true, content: [{ type: "text",
          text: `WRITE_OUTCOME_UNKNOWN: Check the affected entries and files in list agenda on html public/${id} before retrying the delete.` }],
      } }, "The bulk delete must not be replayed after a lost receipt");
    }),
    t.test("signed read and export handoff", async (row) => {
      // GIVEN a signed owner and one entry with a continuation cursor
      const { fetch, calls } = fixture();
      const operations: unknown[] = [];
      const accountOrigin = "https://account.example.org:8443";
      const accountLink = `${accountOrigin}/p/sites/public/${id}`;
      const options: ServerOptions = { fetch, authority: "account", accountOrigin, bridge: async (operation, args) => {
        operations.push({ operation, args });
        if (operation === "read_page_data" && "format" in args && args.format === "csv") {
          return bridgeAnswer({ managementLink: accountLink, collection: "agenda", action: "csv" });
        }
        return bridgeAnswer({ items: [{ key: "opening", value: "09:30", version: 7 }], next: "next-page" });
      } };
      // WHEN the owner lists entries and requests a CSV
      const page = await call(row, "read_page_data", { ...address, collection: "agenda", limit: 5 }, options);
      const csv = await call(row, "read_page_data", { ...address, kind: "site", collection: "agenda", format: "csv" }, options);
      // THEN rows retain the version and private downloads go through the owning account's Data tab
      assert.match(page.content[0].text, /next: next-page[\s\S]*"version":7,"value":"09:30"/, "The entry version and cursor should be preserved");
      assert.deepEqual(csv, { content: [{ type: "text",
        text: `Open ${accountLink} while signed in as the owner. In the Data tab, select agenda, then select Download CSV.` }] },
      "The signed export should give an authorized browser handoff without a credential in the result");
      assert.deepEqual(operations, [
        { operation: "read_page_data", args: { kind: undefined, ...address, collection: "agenda", limit: 5 } },
        { operation: "read_page_data", args: { kind: "site", ...address, collection: "agenda", format: "csv" } },
      ], "Both read paths should verify the account's authorization through the private seam");
      assert.deepEqual(calls, [], "No signed read should fall back to a token or anonymous API");
    }),
    t.test("refused account download links", async (row) => {
      // GIVEN a download response with a different origin, target or proof-bearing suffix.
      const { fetch, calls } = fixture();
      const accountOrigin = "https://account.example.org:8443";
      const links = [`https://account.example.org/p/sites/public/${id}`, `${accountOrigin}/p/html/public/${id}`,
        `${accountOrigin}/p/sites/public/DEMO123458`, `${accountOrigin}/p/sites/public/${id}?format=csv`];
      // WHEN the requester asks for the exact site export.
      const outcomes = await Promise.all(links.map((managementLink) => call(row, "read_page_data",
        { ...address, kind: "site", collection: "agenda", format: "csv" },
        { fetch, authority: "account", accountOrigin, bridge: async () => bridgeAnswer({ managementLink }) })));
      // THEN the account handoff contains only the fallback guidance and makes no public request.
      const fallback = { isError: true, content: [{ type: "text",
        text: "No usable download link was returned. Open the publication in the owning account and use its Data tab." }] };
      assert.deepEqual({ outcomes, calls }, { outcomes: Array(links.length).fill(fallback), calls: [] },
        "Only the configured origin and exact publication route may appear in a download handoff");
    }),
    t.test("management-key file download", async (row) => {
      // GIVEN the private link that authorizes the existing page
      const { fetch, calls } = fixture(Response.json({ declared: true }));
      // WHEN the owner requests one file
      const result = await call(row, "read_page_data", { manageUrl, collection: "agenda", fileId: "FILE000001" }, { fetch });
      // THEN the destination is protected and the secret is only sent as an owner proof header
      assert.deepEqual(calls, [{ method: "GET", url: statePath, body: undefined, proof: ["X-Manage-Key", manageKey], ifMatch: null }],
        "The authorization check should send only the extracted management key to the fixed owner route");
      assert.deepEqual(result, { content: [{ type: "text",
        text: `Private download: GET ${origin}${statePath}/agenda/_files/FILE000001 with the X-Manage-Key header. Use your existing owner proof in the header, or open the Data tab of the private management link and download there.` }] },
      "The export should keep the key and attachment bytes outside the tool result");
    }),
    t.test("moderation collision preserves old receipt", async (row) => {
      // GIVEN one already-absent entry and one deletion in both calls
      const responses = () => [Response.json({ code: "STATE_NOT_FOUND" }, { status: 404 }), Response.json({ deleted: 1 })];
      const old = fixture(...responses());
      const compact = fixture(...responses());
      const moderation = { ...address, ownerToken, collection: "agenda", docIds: ["absent", "existing"] };
      // WHEN a cached caller and a compact caller delete the same selection in separate fixtures
      const legacyResult = await call(row, "delete_page_data", moderation, old);
      const compactResult = await call(row, "delete_page_data", { kind: "html", ...moderation }, compact);
      // THEN both reach the same owner operations while the legacy content remains exact
      assert.deepEqual(old.calls, compact.calls, "Both versions should reach the same two owner delete operations");
      assert.deepEqual(legacyResult, { content: [{ type: "text", text: "Deleted 1 entry from agenda. Already gone: 1." }] },
        "A cached caller should keep the original result");
      assert.deepEqual(compactResult, { content: [{ type: "text", text: '{"deleted":1,"alreadyAbsent":1}' }] },
        "A compact caller should receive the deleted and already-absent totals");
    }),
  ]);
});
