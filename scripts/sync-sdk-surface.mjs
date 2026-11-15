#!/usr/bin/env node
// Copies the SDK surface fixture of brewpage-app into packages/data; --check fails on drift without writing.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/data/test/fixtures/sdk-surface.json');
const FIXTURE = 'test/fixtures/sdk-surface.json';
const USAGE = 'Usage: node scripts/sync-sdk-surface.mjs [--check] <fixture file | frontend/src dir | frontend dir | https URL>';

const args = process.argv.slice(2);
const check = args.includes('--check');
const rest = args.filter((arg) => arg !== '--check');
if (rest.length !== 1) throw new Error(USAGE);
const [source] = rest;

/** Bytes of the fixture: https URL (pin a ref in it), file, or the app frontend dir (or its `src`). */
async function read(from) {
  if (/^https:\/\//.test(from)) {
    const response = await fetch(from);
    if (!response.ok) throw new Error(`${from}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  if (/^[a-z]+:\/\//i.test(from)) throw new Error(`${from}: only https URLs are read`);
  const path = resolve(from);
  for (const candidate of [path, resolve(path, FIXTURE), resolve(path, '..', FIXTURE)]) {
    try {
      return readFileSync(candidate);
    } catch (error) {
      if (!['EISDIR', 'ENOENT'].includes(error.code)) throw error;
    }
  }
  throw new Error(`${from}: no ${FIXTURE} found`);
}

const bytes = await read(source);
const surface = JSON.parse(bytes.toString('utf8'));
if (!surface || typeof surface !== 'object' || !surface.objects || !Array.isArray(surface.globals)) {
  throw new Error(`${source}: not an SDK surface file (expected "globals" and "objects")`);
}

let current = null;
try {
  current = readFileSync(TARGET);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const same = current !== null && current.equals(bytes);
if (check) {
  if (!same) {
    console.error(`SDK surface drift: packages/data/${FIXTURE} differs from ${source}; run node scripts/sync-sdk-surface.mjs <source>`);
    process.exit(1);
  }
  console.log('SDK surface in sync');
} else if (same) {
  console.log('SDK surface unchanged');
} else {
  mkdirSync(dirname(TARGET), { recursive: true });
  writeFileSync(TARGET, bytes);
  console.log(`SDK surface updated: packages/data/${FIXTURE}`);
}
