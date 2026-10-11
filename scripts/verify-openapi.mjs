#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire(new URL('../docs/package.json', import.meta.url));
const yaml = require('js-yaml');
const root = resolve(import.meta.dirname, '..');
const specPath = process.argv.includes('--spec')
  ? resolve(process.argv[process.argv.indexOf('--spec') + 1])
  : resolve(root, 'openapi/openapi.json');
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const operationIds = new Set();
let count = 0;

function dereference(ref) {
  assert.ok(ref.startsWith('#/'), `Only local schema references are permitted: ${ref}`);
  return ref.slice(2).split('/').reduce((value, key) => {
    const decoded = key.replaceAll('~1', '/').replaceAll('~0', '~');
    assert.ok(value && Object.hasOwn(value, decoded), `Unresolved reference: ${ref}`);
    return value[decoded];
  }, spec);
}

function walk(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref) dereference(value.$ref);
  for (const child of Object.values(value)) walk(child);
}

assert.match(spec.openapi, /^3\.1\./, 'Public contract must use OpenAPI 3.1');
walk(spec);
const schemas = spec.components.schemas;
for (const name of ['filename', 'showTopBar']) assert.ok(
  schemas.HtmlUploadRequest.properties[name].type.includes('null'),
  `Optional HTML creation ${name} accepts null`);
const hostingMetadata = ['access', 'deliveryMode', 'deliveryModeMatched', 'effectiveDeliveryMode',
  'hostingVersion', 'managementLink', 'modeLocked', 'requestedDeliveryMode', 'routingCohort'];
for (const name of hostingMetadata) {
  assert.ok(!schemas.HtmlUpdateResponse.required.includes(name),
    `OLD HTML updates may omit hosting metadata: ${name}`);
  assert.ok(schemas.HtmlUploadResponse.required.includes(name),
    `NEW HTML creation requires hosting metadata: ${name}`);
}
assert.deepEqual(schemas.HostingUpdateRequest.required, ['deliveryMode', 'expectedVersion'],
  'Hosting changes require delivery mode and optimistic concurrency version');
assert.equal(schemas.HostingUpdateRequest.properties.expectedVersion.type, 'integer',
  'Hosting expectedVersion must be an integer');
assert.equal(schemas.HostingUpdateRequest.properties.expectedVersion.minimum, 1,
  'Hosting expectedVersion starts at one');
assert.deepEqual(schemas.HostingProjection.properties.hostingVersion.type, ['integer', 'null'],
  'Hosting version is nullable for legacy publications');
assert.ok(schemas.HostingProjection.required.includes('hostingVersion'),
  'Serialized hosting version is required even when null');
for (const suffix of ['source', 'settings']) assert.deepEqual(
  spec.paths[`/api/html/{ns}/{id}/${suffix}`].get.security, [{ OwnerToken: [] }],
  `HTML ${suffix} access requires owner authority`);
for (const status of ['302', '304', '429']) assert.equal(
  spec.paths['/preview/{ns}/{id}.png'].get.responses[status].content, undefined,
  `Preview ${status} has no response body`);
assert.deepEqual(spec.paths['/api/json'].post.requestBody.content['application/json'].schema, {},
  'JSON creation admits arbitrary JSON values');
for (const [path, item] of Object.entries(spec.paths)) {
  assert.ok(!/^\/api\/admin(?:\/|$)/.test(path), `Administrative path in public contract: ${path}`);
  assert.ok(!path.includes('*'), `Wildcard route must have a named parameter: ${path}`);
  const names = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  for (const [method, operation] of Object.entries(item)) {
    if (!methods.has(method)) continue;
    assert.ok(operation.operationId, `Missing operationId: ${method} ${path}`);
    assert.ok(!operationIds.has(operation.operationId), `Duplicate operationId: ${operation.operationId}`);
    operationIds.add(operation.operationId);
    const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])]
      .map((parameter) => parameter.$ref ? dereference(parameter.$ref) : parameter);
    const declared = parameters.filter((parameter) => parameter.in === 'path');
    assert.deepEqual(declared.map((parameter) => parameter.name).sort(), [...names].sort(),
      `Path parameter mismatch: ${method} ${path}`);
    for (const parameter of declared) assert.equal(parameter.required, true,
      `Path parameter must be required: ${method} ${path} ${parameter.name}`);
    for (const security of operation.security ?? spec.security ?? []) {
      for (const name of Object.keys(security)) assert.ok(spec.components?.securitySchemes?.[name],
        `Missing security scheme: ${name}`);
    }
    for (const [status, response] of Object.entries(operation.responses)) {
      if (!/^4\d\d$|^5\d\d$/.test(status)) continue;
      for (const media of Object.values(response.content ?? {})) assert.equal(
        media.schema?.$ref, '#/components/schemas/ErrorResponse',
        `Declared error body must use the actual error DTO: ${method} ${path} ${status}`);
    }
    count++;
  }
}
if (!process.argv.includes('--spec')) {
  assert.deepEqual(yaml.load(readFileSync(resolve(root, 'openapi/openapi.yaml'), 'utf8')), spec,
    'Derived YAML must equal the generated JSON contract');
  assert.equal(readFileSync(resolve(root, 'openapi/openapi.yaml'), 'utf8'),
    '# Generated from backend public JSON; do not hand-edit.\n' + yaml.dump(spec, { sortKeys: true, noRefs: true, lineWidth: 120 }),
    'YAML serialization must match the deterministic sync script');
  assert.equal(readFileSync(resolve(root, 'docs/public/openapi.json'), 'utf8'), readFileSync(specPath, 'utf8'),
    'Committed Scalar JSON copy must match byte for byte');
  const provenance = JSON.parse(readFileSync(resolve(root, 'openapi/openapi.provenance.json'), 'utf8'));
  assert.equal(provenance.jsonSha256, createHash('sha256').update(readFileSync(specPath)).digest('hex'),
    'Export provenance must identify the exact generated JSON bytes');
  assert.equal(provenance.backendBuildVersion, spec.info.version, 'Backend build version must match contract version');
  assert.match(provenance.backendCommit, /^[a-f0-9]{40}$/, 'Export must identify the backend source commit');
  assert.match(provenance.backendSourceSha256, /^[a-f0-9]{64}$/, 'Export must identify backend source content');
}
console.log(`Public OpenAPI valid: ${count} operations, ${Object.keys(spec.paths).length} paths; references, IDs, parameters and security verified.`);
