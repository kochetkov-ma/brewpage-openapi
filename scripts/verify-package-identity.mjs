#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const manifest = read('mcp-server/package.json');
const lock = read('mcp-server/package-lock.json');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'Package version must be exact semver');
assert.equal(lock.version, manifest.version, 'Lock root version must match package');
assert.equal(lock.packages[''].version, manifest.version, 'Lock package version must match package');
for (const path of ['server.json', 'mcp-server/server.json']) {
  const server = read(path);
  assert.equal(server.version, manifest.version, `${path} server version must match package`);
  for (const entry of server.packages) {
    assert.equal(entry.identifier, manifest.name, `${path} registry name must match package`);
    assert.equal(entry.version, manifest.version, `${path} registry version must match package`);
  }
}
const source = readFileSync(new URL('../mcp-server/src/index.ts', import.meta.url), 'utf8');
assert.equal(source.match(/new McpServer\(\{[\s\S]*?version: "([^"]+)"/)?.[1], manifest.version,
  'MCP handshake source version must match package');
console.log(`MCP release identity valid: ${manifest.name}@${manifest.version}`);
