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
const gemini = read('gemini-extension.json');
assert.equal(gemini.version, manifest.version, 'gemini-extension.json version must match package');
assert.deepEqual(gemini.mcpServers.brewpage.args, ['-y', `${manifest.name}@${manifest.version}`],
  'gemini-extension.json must pin the package version');
const source = readFileSync(new URL('../mcp-server/src/tools.ts', import.meta.url), 'utf8');
assert.match(source, /const VERSION = \(JSON\.parse\(readFileSync\(new URL\("\.\.\/package\.json", import\.meta\.url\), "utf8"\)\) as \{ version: string \}\)\.version;/,
  'MCP source must read its version from the package manifest');
assert.match(source, /new McpServer\(\{\s*name: "brewpage-mcp",\s*version: VERSION,\s*\}/,
  'MCP handshake must use the package-derived version');
assert.match(source, /export const USER_AGENT = `brewpage-mcp\/\$\{VERSION\}`;/,
  'MCP User-Agent must use the package-derived version');
console.log(`MCP release identity valid: ${manifest.name}@${manifest.version}`);
