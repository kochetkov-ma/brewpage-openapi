import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const EXPECTED_TOOL_NAMES = [
  "publish_html",
  "publish_file",
  "delete_resource",
  "get_page",
  "get_stats",
  "publish_site",
  "update_html",
  "publish_json",
  "get_json",
  "update_json",
  "publish_kv",
  "set_kv",
  "get_kv",
  "search_gallery",
];

const MCP_PROTOCOL_VERSION = "2024-11-05";
const OVERALL_TIMEOUT_MS = 10_000;

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolListResult {
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
}

function locateServerEntry(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // test/smoke.test.ts lives next to mcp-server/, so dist/index.js is one level up
  return path.resolve(here, "..", "dist", "index.js");
}

class ResponseCollector {
  private buffer = "";
  private readonly pending = new Map<number | string, (msg: JsonRpcResponse) => void>();
  private readonly rejecters = new Map<number | string, (err: Error) => void>();

  feed(chunk: string): void {
    this.buffer += chunk;
    let newlineIdx = this.buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line.length > 0) {
        this.dispatch(line);
      }
      newlineIdx = this.buffer.indexOf("\n");
    }
  }

  private dispatch(line: string): void {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(line) as JsonRpcResponse;
    } catch {
      // not JSON — ignore
      return;
    }
    if (msg.id === undefined || msg.id === null) {
      // notification or malformed — ignore
      return;
    }
    const resolver = this.pending.get(msg.id);
    if (resolver) {
      this.pending.delete(msg.id);
      this.rejecters.delete(msg.id);
      resolver(msg);
    }
  }

  await(id: number | string, timeoutMs: number, label: string): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.rejecters.delete(id);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${label} (id=${id})`));
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      this.rejecters.set(id, (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  failAllPending(err: Error): void {
    for (const reject of this.rejecters.values()) {
      reject(err);
    }
    this.pending.clear();
    this.rejecters.clear();
  }
}

function sendJsonRpc(child: ChildProcessWithoutNullStreams, message: object): void {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

test("MCP server registers exactly the expected 14 tools", async (t) => {
  const serverEntry = locateServerEntry();
  const child = spawn(process.execPath, [serverEntry], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, BREWPAGE_URL: "https://brewpage.app" },
  });

  const collector = new ResponseCollector();
  let stderrBuffer = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => collector.feed(chunk));
  child.stderr.on("data", (chunk: string) => {
    stderrBuffer += chunk;
  });

  const exitPromise = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
  });

  const fatalPromise = new Promise<never>((_, reject) => {
    child.once("error", (err) => {
      collector.failAllPending(err);
      reject(new Error(`Child process spawn error: ${err.message}`));
    });
    child.once("exit", (code, signal) => {
      if (code !== null && code !== 0) {
        const err = new Error(
          `Child process exited prematurely (code=${code}, signal=${signal}). stderr:\n${stderrBuffer}`
        );
        collector.failAllPending(err);
        reject(err);
      }
    });
  });

  const overallTimer = setTimeout(() => {
    const err = new Error(
      `Overall test timeout (${OVERALL_TIMEOUT_MS}ms) exceeded. stderr:\n${stderrBuffer}`
    );
    collector.failAllPending(err);
    if (!child.killed) child.kill("SIGKILL");
  }, OVERALL_TIMEOUT_MS);

  t.after(async () => {
    clearTimeout(overallTimer);
    if (!child.killed) {
      child.kill("SIGTERM");
      await Promise.race([
        exitPromise,
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      if (!child.killed) child.kill("SIGKILL");
    }
  });

  try {
    // Send initialize request
    sendJsonRpc(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "smoke-test", version: "0.0.0" },
      },
    });

    const initResp = (await Promise.race([
      collector.await(1, 6_000, "initialize response"),
      fatalPromise,
    ])) as JsonRpcResponse;

    assert.equal(initResp.error, undefined, `initialize returned error: ${JSON.stringify(initResp.error)}\nstderr: ${stderrBuffer}`);
    assert.ok(initResp.result, "initialize result missing");

    // MCP requires an `initialized` notification after the handshake
    sendJsonRpc(child, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    // Send tools/list
    sendJsonRpc(child, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    const listResp = (await Promise.race([
      collector.await(2, 6_000, "tools/list response"),
      fatalPromise,
    ])) as JsonRpcResponse;

    assert.equal(
      listResp.error,
      undefined,
      `tools/list returned error: ${JSON.stringify(listResp.error)}\nstderr: ${stderrBuffer}`
    );

    const result = listResp.result as ToolListResult | undefined;
    assert.ok(result, `tools/list result missing. stderr: ${stderrBuffer}`);
    assert.ok(Array.isArray(result.tools), `tools/list result.tools is not an array. stderr: ${stderrBuffer}`);

    const names = result.tools.map((t) => t.name).sort();
    const expected = [...EXPECTED_TOOL_NAMES].sort();

    assert.equal(
      result.tools.length,
      EXPECTED_TOOL_NAMES.length,
      `Expected exactly ${EXPECTED_TOOL_NAMES.length} tools but got ${result.tools.length}. Names: ${JSON.stringify(names)}`
    );

    assert.deepEqual(
      names,
      expected,
      `Tool name set mismatch.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(names)}`
    );
  } finally {
    clearTimeout(overallTimer);
  }
});
