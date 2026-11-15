#!/usr/bin/env node

import type { Transport } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { currentCall } from "./compat.js";
import { createServer, DEFAULT_BASE_URL, LOCAL, OWNER_TOKEN_ENV } from "./tools.js";

const OWNER_TOKEN_SHAPE = /^[A-Za-z0-9]{32}$/;

/** Optional default owner token for every call; a malformed value is ignored with one stderr line. */
const ENV_OWNER_TOKEN = ((): string | undefined => {
  const raw = process.env[OWNER_TOKEN_ENV]?.trim();
  if (!raw) return undefined;
  if (OWNER_TOKEN_SHAPE.test(raw)) return raw;
  console.error(`${OWNER_TOKEN_ENV} ignored: expected 32 letters/digits.`);
  return undefined;
})();

/** Stdio pipes whose inbound old-name calls reach the server as calls of the current tool. */
const pipes = new StdioServerTransport();
const transport: Transport = { start: () => pipes.start(), send: (message) => pipes.send(message), close: () => pipes.close() };
pipes.onmessage = (message) => transport.onmessage?.(currentCall(message));
pipes.onerror = (error) => transport.onerror?.(error);
pipes.onclose = () => transport.onclose?.();

/** Serves 2026-07-28 (server/discover) and 2025-era initialize openings from one factory. */
serveStdio(() => createServer({ baseUrl: process.env.BREWPAGE_URL || DEFAULT_BASE_URL, profile: LOCAL, ownerToken: ENV_OWNER_TOKEN }), { transport });
