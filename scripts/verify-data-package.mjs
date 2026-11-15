#!/usr/bin/env node
// Release gate for packages/data: version = tag, lock = manifest, tarball holds every exported dist file.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [dir, tarball, tag] = process.argv.slice(2);
if (!dir) throw new Error('Usage: node scripts/verify-data-package.mjs <package dir> [<tarball> [<tag>]]');
const read = (name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
const fail = (message) => {
  console.error(`::error::${message}`);
  process.exit(1);
};

const manifest = read('package.json');
const lock = read('package-lock.json');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) fail(`version ${manifest.version} is not exact semver`);
if (lock.version !== manifest.version || lock.packages[''].version !== manifest.version) fail('package-lock.json version differs from package.json');
if (tag && tag !== `data-v${manifest.version}`) fail(`tag ${tag} does not match package version data-v${manifest.version}`);

if (tarball) {
  const listed = new Set(execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split('\n').filter(Boolean));
  const wanted = new Set(['package/package.json', 'package/README.md', 'package/LICENSE', 'package/dist/types.js', 'package/dist/types.d.ts']);
  const entries = Object.entries(manifest.exports).filter(([key]) => key !== './package.json');
  if (entries.length !== 6) fail(`expected 6 exported entries, found ${entries.length}`);
  for (const [, target] of entries) {
    for (const file of Object.values(target)) wanted.add(`package/${file.replace(/^\.\//, '')}`);
  }
  const missing = [...wanted].filter((file) => !listed.has(file));
  if (missing.length > 0) fail(`tarball misses: ${missing.join(', ')}`);
  const stray = [...listed].filter((file) => !file.startsWith('package/dist/') && !wanted.has(file));
  if (stray.length > 0) fail(`tarball holds unexpected files: ${stray.join(', ')}`);
}
console.log(`${manifest.name}@${manifest.version} release identity valid`);
