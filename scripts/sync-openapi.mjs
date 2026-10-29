#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { contractYaml } from './openapi-yaml.mjs';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/sync-openapi.mjs <backend-generated-public.json>');
const root = resolve(import.meta.dirname, '..');
const require = createRequire(new URL('../docs/package.json', import.meta.url));
const yaml = require('js-yaml');
const json = readFileSync(resolve(source), 'utf8');
execFileSync(process.execPath, [resolve(root, 'scripts/verify-openapi.mjs'), '--spec', resolve(source)], { stdio: 'inherit' });
const provenance = resolve(source).replace(/\.json$/, '.provenance.json');
if (!existsSync(provenance)) throw new Error(`Missing backend export provenance: ${provenance}`);
writeFileSync(resolve(root, 'openapi/openapi.json'), json);
writeFileSync(resolve(root, 'docs/public/openapi.json'), json);
writeFileSync(resolve(root, 'openapi/openapi.yaml'), contractYaml(yaml, json));
writeFileSync(resolve(root, 'openapi/openapi.provenance.json'), readFileSync(provenance));
execFileSync(process.execPath, [resolve(root, 'scripts/verify-openapi.mjs')], { stdio: 'inherit' });
