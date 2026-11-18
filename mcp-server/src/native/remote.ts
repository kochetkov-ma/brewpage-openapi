import { isJSONRPCNotification, isJSONRPCRequest, parseJSONRPCMessage, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { HTML_ONLY_FAILURE, permitsHtmlOnly, TOOL_SELECTION_HEADER, type ToolSelection } from "../compat.js";
import { LEGACY_TOOL_NAMES } from "../compact/context.js";
import { NativeReconnectRequired, nativeLoginScope, type nativeSession } from "./oauth.js";

const MODERN = "2026-07-28";
const VERSIONS = new Set(["2025-11-25", "2025-06-18", "2025-03-26", MODERN]);
const MAX_REPLY_BYTES = 32 * 1024 * 1024;
const COMPATIBLE_SERVER = /^3\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const ACCOUNT_VERSION_FAILURE = "Account mode requires a compatible BrewPage MCP 3.x server.";

type Session = Pick<ReturnType<typeof nativeSession>, "token" | "invalidate">;

function compatibleServer(value: unknown): boolean {
  return typeof value === "object" && value !== null && "name" in value && value.name === "brewpage-mcp" &&
    "version" in value && typeof value.version === "string" && COMPATIBLE_SERVER.test(value.version);
}

async function body(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    length += part.value.length;
    if (length > MAX_REPLY_BYTES) {
      await reader.cancel();
      throw new Error("The BrewPage MCP response exceeded the stdio relay limit.");
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function answerMessage(value: string, isEventStream: boolean): JSONRPCMessage {
  if (isEventStream) {
    const messages = value.split(/\r?\n\r?\n/)
      .map((event) => event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n"))
      .filter((event) => event.length);
    if (messages.length !== 1) throw new Error("Expected one stateless BrewPage RPC response.");
    value = messages[0];
  }
  return parseJSONRPCMessage(JSON.parse(value));
}

function scopeRecovery(challenge: string): string {
  const pending = "This action is pending. Reconnect BrewPage explicitly, then submit the action again.";
  const required = /(?:^Bearer\s+|,\s*)scope="([^"]+)"/.exec(challenge)?.[1];
  if (!required) return pending;
  try {
    const flags = nativeLoginScope(required.split(" ")).split(" ").map((scope) => `--scope ${scope}`).join(" ");
    return `${pending} Run brewpage-mcp login ${flags}. Repeat --scope for any permissions to keep. Restart your MCP client after consent.`;
  } catch {
    return pending;
  }
}

export function mcpRelay(resource: string, session: Session, request: typeof fetch = fetch, selection?: ToolSelection) {
  const url = new URL(resource);
  if (url.protocol !== "https:" || url.href !== `${url.origin}/mcp`) throw new Error("Account mode requires the configured HTTPS MCP resource.");
  let negotiated: string | undefined;
  let compatible = false;
  return async (message: JSONRPCMessage, signal?: AbortSignal): Promise<JSONRPCMessage | undefined> => {
    signal?.throwIfAborted();
    const method = "method" in message ? message.method : undefined;
    const handshake = method === "initialize" || method === "server/discover";
    if (handshake) compatible = false;
    if (method === "tools/call" && "method" in message) {
      if (!compatible) {
        return "id" in message ? { jsonrpc: "2.0", id: message.id, error: { code: -32000, message: ACCOUNT_VERSION_FAILURE } } : undefined;
      }
      if (selection === "publish_html" && !permitsHtmlOnly(message.params?.name, message.params?.arguments)) {
        return "id" in message ? { jsonrpc: "2.0", id: message.id,
          result: { content: [{ type: "text", text: HTML_ONLY_FAILURE }], isError: true } } : undefined;
      }
    }
    const token = await session.token(signal);
    signal?.throwIfAborted();
    const headers = new Headers({ "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` });
    if (selection) headers.set(TOOL_SELECTION_HEADER, selection);
    if ("method" in message) {
      const params = message.params as Record<string, unknown> | undefined;
      const meta = params?._meta as Record<string, unknown> | undefined;
      const proposed = meta?.["io.modelcontextprotocol/protocolVersion"];
      const protocol = proposed === MODERN ? MODERN : negotiated;
      if (protocol && message.method !== "initialize") headers.set("MCP-Protocol-Version", protocol);
      if (protocol === MODERN) {
        headers.set("Mcp-Method", message.method);
        if (message.method === "tools/call" && typeof params?.name === "string") headers.set("Mcp-Name", params.name);
      }
    }
    const timeout = AbortSignal.timeout(120_000);
    const response = await request(url, { method: "POST", headers, body: JSON.stringify(message), redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    const challenge = response.headers.get("WWW-Authenticate") ?? "";
    if (response.status === 401 && /error="invalid_token"/.test(challenge)) await session.invalidate(token);
    if (!("id" in message)) {
      await response.body?.cancel();
      return undefined;
    }
    const text = await body(response);
    signal?.throwIfAborted();
    const incoming = answerMessage(text, response.headers.get("Content-Type")?.startsWith("text/event-stream") ?? false);
    if (!("id" in incoming) || incoming.id !== message.id) throw new Error("The BrewPage MCP response did not match its request.");
    if (method === "tools/call" && response.status === 403 && /error="insufficient_scope"/.test(challenge) &&
      "result" in incoming && incoming.result.isError === true && Array.isArray(incoming.result.content)) {
      return { ...incoming, result: { ...incoming.result,
        content: [...incoming.result.content, { type: "text", text: scopeRecovery(challenge) }] } };
    }
    if (selection && "method" in message && message.method === "tools/list" && "result" in incoming && !incoming.result.isError) {
      const expected = selection === "legacy" ? LEGACY_TOOL_NAMES : ["publish_html"];
      const tools = incoming.result.tools;
      if (!Array.isArray(tools) || incoming.result.nextCursor || tools.length !== expected.length ||
          tools.some((tool, index) => tool?.name !== expected[index])) {
        return { jsonrpc: "2.0", id: incoming.id, error: { code: -32000, message: "The BrewPage server did not return the configured tool catalog." } };
      }
    }
    if (handshake && "result" in incoming) {
      const { _meta, serverInfo, protocolVersion } = incoming.result;
      compatible = compatibleServer(method === "initialize" ? serverInfo : _meta?.["io.modelcontextprotocol/serverInfo"]);
      if (!compatible) return { jsonrpc: "2.0", id: incoming.id, error: { code: -32000, message: ACCOUNT_VERSION_FAILURE } };
      if (typeof protocolVersion === "string" && VERSIONS.has(protocolVersion)) negotiated = protocolVersion;
    }
    return incoming;
  };
}

export async function serveAccountStdio(resource: string, session: Session, selection?: ToolSelection,
  pipes = new StdioServerTransport(), request = fetch): Promise<void> {
  const closing = new AbortController();
  const pending = new Map<string | number, AbortController>();
  const relay = mcpRelay(resource, session, request, selection);
  pipes.onclose = () => closing.abort();
  pipes.onmessage = (message) => {
    if (isJSONRPCNotification(message) && message.method === "notifications/cancelled") {
      const id = message.params?.requestId;
      if (typeof id === "string" || typeof id === "number") pending.get(id)?.abort();
      return;
    }
    const id = isJSONRPCRequest(message) ? message.id : undefined;
    let signal = closing.signal;
    if (id !== undefined) {
      if (pending.has(id)) return;
      const requestAbort = new AbortController();
      pending.set(id, requestAbort);
      signal = AbortSignal.any([signal, requestAbort.signal]);
    }
    void relay(message, signal).then((reply) => reply !== undefined && !signal.aborted ? pipes.send(reply) : undefined).catch((error: unknown) => {
      if (id === undefined || signal.aborted) return;
      const message = error instanceof NativeReconnectRequired ? error.message
        : "The selected BrewPage account request did not complete. Verify the outcome of any submitted write before retrying.";
      return pipes.send({ jsonrpc: "2.0", id, error: { code: -32000, message } }).catch(() => undefined);
    }).finally(() => {
      if (id !== undefined) pending.delete(id);
    });
  };
  await pipes.start();
}
