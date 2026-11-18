#!/usr/bin/env node

import { isAbsolute } from "node:path";
import type { Transport } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { currentCall, HTML_ONLY_FAILURE, permitsHtmlOnly, type ToolSelection } from "./compat.js";
import { createStdioBridge, stdioResource } from "./compact/auth.js";
import { fetchSourceSafely } from "./http.js";
import { CredentialStore } from "./native/credentials.js";
import { deploymentFor, nativeLoginScope, nativeOAuth, nativeSession } from "./native/oauth.js";
import { serveAccountStdio } from "./native/remote.js";
import { createServer, DEFAULT_BASE_URL, LOCAL, OWNER_TOKEN_ENV } from "./tools.js";

function serveAnonymous(baseUrl: string, anonymous: boolean, selection?: ToolSelection): void {
  const raw = anonymous ? undefined : process.env[OWNER_TOKEN_ENV]?.trim();
  const ownerToken = raw && /^[A-Za-z0-9]{32}$/.test(raw) ? raw : undefined;
  if (raw && !ownerToken) console.error(`${OWNER_TOKEN_ENV} ignored: expected 32 letters/digits.`);
  const catalog = selection === "publish_html" ? "html-only" : selection ?? "compact";
  const pipes = new StdioServerTransport();
  const transport: Transport = { start: () => pipes.start(), send: (message) => pipes.send(message), close: () => pipes.close() };
  pipes.onmessage = (message) => {
    if (selection === "publish_html" && "method" in message && message.method === "tools/call" &&
        !permitsHtmlOnly(message.params?.name, message.params?.arguments)) {
      if ("id" in message) void pipes.send({ jsonrpc: "2.0", id: message.id,
        result: { content: [{ type: "text", text: HTML_ONLY_FAILURE }], isError: true } }).catch(() => undefined);
      return;
    }
    transport.onmessage?.(currentCall(message));
  };
  pipes.onerror = (error) => transport.onerror?.(error);
  pipes.onclose = () => transport.onclose?.();
  serveStdio(() => createServer({
    baseUrl, catalog, profile: LOCAL, ownerToken,
    compactFetchSource: (url, signal) => fetchSourceSafely(url, undefined, signal),
    accountOrigin: process.env.BREWPAGE_ACCOUNT_ORIGIN,
    bridge: createStdioBridge(baseUrl, process.env.BREWPAGE_MCP_RESOURCE_URL),
  }), { transport });
}

function loginOptions(args: string[]): { noBrowser: boolean; scopes?: string[] } {
  const scopes: string[] = [];
  let noBrowser = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--no-browser" && !noBrowser) {
      noBrowser = true;
    } else if (args[index] === "--scope" && args[index + 1]) {
      scopes.push(args[++index]);
    } else {
      throw new Error("Invalid login option.");
    }
  }
  const requested = scopes.length ? scopes : undefined;
  nativeLoginScope(requested);
  return { noBrowser, scopes: requested };
}

async function main(): Promise<void> {
  const baseUrl = process.env.BREWPAGE_URL || DEFAULT_BASE_URL;
  const args = process.argv.slice(2);
  const command = args[0];
  let login: ReturnType<typeof loginOptions> | undefined;
  try {
    if (command === "login") login = loginOptions(args.slice(1));
    else if (args.some((arg) => /^--(?:no-browser|scope)(?:=|$)/.test(arg))) throw new Error("Login option outside login.");
  } catch {
    console.error("Use brewpage-mcp login [--no-browser] [--scope <BrewPage scope>] with one flag per requested scope.");
    process.exitCode = 1;
    return;
  }
  const catalog = process.env.BREWPAGE_MCP_CATALOG ?? "compact";
  const tool = process.env.BREWPAGE_MCP_TOOL_SELECTION;
  if ((catalog !== "compact" && catalog !== "legacy") || (tool !== undefined && tool !== "publish_html")) {
    console.error("Choose BREWPAGE_MCP_CATALOG=compact|legacy or BREWPAGE_MCP_TOOL_SELECTION=publish_html.");
    process.exitCode = 1;
    return;
  }
  const selection = tool ?? (catalog === "legacy" ? catalog : undefined);
  if (args.includes("--anonymous")) {
    if (command === "login" || command === "logout") {
      console.error("Choose the account command or --anonymous.");
      process.exitCode = 1;
      return;
    }
    return serveAnonymous(baseUrl, true, selection);
  }
  const file = process.env.BREWPAGE_MCP_CREDENTIAL_FILE;
  const stateDir = process.env.BREWPAGE_MCP_STATE_DIR;
  const issuer = process.env.BREWPAGE_MCP_ISSUER;
  const resource = process.env.BREWPAGE_MCP_RESOURCE_URL;
  if (resource !== undefined && !stdioResource(baseUrl, resource)) {
    console.error("BREWPAGE_MCP_RESOURCE_URL must be the exact same-origin HTTPS /mcp endpoint.");
    process.exitCode = 1;
    return;
  }
  if (stateDir !== undefined && !isAbsolute(stateDir)) {
    console.error("BREWPAGE_MCP_STATE_DIR must be an absolute path.");
    process.exitCode = 1;
    return;
  }
  const deployment = deploymentFor(baseUrl, resource, issuer);
  if (!deployment) {
    if (command === "login" || command === "logout" || file !== undefined || issuer !== undefined) {
      console.error("Account mode needs matching HTTPS BREWPAGE_URL, BREWPAGE_MCP_RESOURCE_URL and BREWPAGE_MCP_ISSUER.");
      process.exitCode = 1;
      return;
    }
    return serveAnonymous(baseUrl, false, selection);
  }
  const store = new CredentialStore(deployment, file, stateDir);
  const oauth = nativeOAuth(deployment, fetch, login?.noBrowser ? async (destination) => {
    process.stderr.write(`${destination.href}\n`);
  } : undefined);
  if (login) {
    if (file !== undefined || process.platform !== "darwin") {
      console.error("Browser login needs macOS Keychain. POSIX headless clients can select an owner-only OAuth credential file.");
      process.exitCode = 1;
      return;
    }
    const credential = await oauth.login(login.scopes);
    let previousRevoked = true;
    try {
      await store.lock(async () => {
        const previous = await store.selected().catch(() => undefined);
        const prior = previous ? await store.read(previous).catch(() => undefined) : undefined;
        await store.select(credential);
        if (previous) {
          previousRevoked = prior ? await oauth.revoke(prior).then(() => true, () => false) : false;
          await store.discard(previous);
        }
      });
    } catch (error) {
      await oauth.revoke(credential).catch(() => undefined);
      throw error;
    }
    process.stdout.write("BrewPage account connected. Restart the MCP client to use this grant.\n");
    if (!previousRevoked) process.stdout.write("BrewPage could not confirm revocation of the earlier connection. You can revoke it in your account.\n");
    return;
  }
  if (command === "logout") {
    await store.lock(async () => {
      let lost = false;
      const selection = await store.selected().catch(async () => {
        if (file) throw new Error("The selected headless credential file could not be opened.");
        lost = true;
        await store.clear();
        return undefined;
      });
      if (!selection) {
        process.stdout.write(lost ? "BrewPage selection cleared locally. Server revocation could not be confirmed.\n" : "No BrewPage grant selected.\n");
        return;
      }
      const current = await store.read(selection).catch(() => undefined);
      if (current && selection.source === "file") await store.save(selection, { ...current, blocked: true });
      const revoked = current ? await oauth.revoke(current).then(() => true, () => false) : false;
      await store.discard(selection);
      await store.clear();
      if (selection.source === "file") {
        process.stdout.write(revoked
          ? "BrewPage grant revoked. Clear the credential file setting before starting an anonymous connection.\n"
          : "BrewPage could not confirm revocation. Remove the credential file setting or reconnect explicitly.\n");
        process.exitCode = revoked ? 0 : 1;
        return;
      }
      process.stdout.write(revoked ? "BrewPage connection revoked and signed out.\n"
        : "BrewPage signed out locally. Server revocation could not be confirmed.\n");
    });
    return;
  }
  const grant = await store.selected();
  if (!grant) return serveAnonymous(baseUrl, false, selection);
  await serveAccountStdio(deployment.resource, nativeSession(store, grant, oauth), selection);
}

void main().catch(() => {
  console.error("The selected BrewPage connection could not be used. Reconnect, use logout, or start with --anonymous.");
  process.exitCode = 1;
});
