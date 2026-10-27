#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
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

/** Serves 2026-07-28 (server/discover) and 2025-era initialize openings from one factory. */
serveStdio(() => createServer({ baseUrl: process.env.BREWPAGE_URL || DEFAULT_BASE_URL, ownerToken: ENV_OWNER_TOKEN }));
