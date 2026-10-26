#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, DEFAULT_BASE_URL, OWNER_TOKEN_ENV } from "./tools.js";

const OWNER_TOKEN_SHAPE = /^[A-Za-z0-9]{32}$/;

/** Optional default owner token for every call; a malformed value is ignored with one stderr line. */
const ENV_OWNER_TOKEN = ((): string | undefined => {
  const raw = process.env[OWNER_TOKEN_ENV]?.trim();
  if (!raw) return undefined;
  if (OWNER_TOKEN_SHAPE.test(raw)) return raw;
  console.error(`${OWNER_TOKEN_ENV} ignored: expected 32 letters/digits.`);
  return undefined;
})();

async function main() {
  const server = createServer({ baseUrl: process.env.BREWPAGE_URL || DEFAULT_BASE_URL, ownerToken: ENV_OWNER_TOKEN });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
