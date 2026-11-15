#!/usr/bin/env node
// Imports one backend export: public.json and page-data-host.json of the same directory, each with its provenance file.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { contractYaml } from './openapi-yaml.mjs';

const source = process.argv[2];
if (!source || process.argv.length > 3) throw new Error('Usage: node scripts/sync-openapi.mjs <backend export public.json>');
const root = resolve(import.meta.dirname, '..');
const require = createRequire(new URL('../docs/package.json', import.meta.url));
const yaml = require('js-yaml');
const verifier = resolve(root, 'scripts/verify-openapi.mjs');
/** Committed name -> export file and the verify flag that reads it. */
const documents = [
  { name: 'openapi', file: resolve(source), flag: '--spec' },
  { name: 'page-data-host', file: resolve(dirname(resolve(source)), 'page-data-host.json'), flag: '--host-spec' },
];
for (const { file, flag } of documents) {
  if (!existsSync(file)) throw new Error(`Missing backend export: ${file}`);
  if (!existsSync(file.replace(/\.json$/, '.provenance.json'))) throw new Error(`Missing backend export provenance of ${file}`);
  execFileSync(process.execPath, [verifier, flag, file], { stdio: 'inherit' });
}
for (const { name, file } of documents) {
  const json = readFileSync(file, 'utf8');
  writeFileSync(resolve(root, `openapi/${name}.json`), json);
  writeFileSync(resolve(root, `docs/public/${name}.json`), json);
  writeFileSync(resolve(root, `openapi/${name}.yaml`), contractYaml(yaml, json));
  writeFileSync(resolve(root, `openapi/${name}.provenance.json`), readFileSync(file.replace(/\.json$/, '.provenance.json')));
}
execFileSync(process.execPath, [verifier], { stdio: 'inherit' });
