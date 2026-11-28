#!/usr/bin/env node
// No flag: both committed documents and their copies. --spec <public.json> / --host-spec <page-data-host.json>: one export file each.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { contractYaml } from './openapi-yaml.mjs';

const require = createRequire(new URL('../docs/package.json', import.meta.url));
const yaml = require('js-yaml');
const root = resolve(import.meta.dirname, '..');
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const HOST_BASE = '/_bp/state/v1';

function flag(name) {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  assert.ok(process.argv[at + 1], `${name} needs a file`);
  return resolve(process.argv[at + 1]);
}

function dereference(spec, ref) {
  assert.ok(ref.startsWith('#/'), `Only local schema references are permitted: ${ref}`);
  return ref.slice(2).split('/').reduce((value, key) => {
    const decoded = key.replaceAll('~1', '/').replaceAll('~0', '~');
    assert.ok(value && Object.hasOwn(value, decoded), `Unresolved reference: ${ref}`);
    return value[decoded];
  }, spec);
}

function walk(spec, value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref) dereference(spec, value.$ref);
  for (const child of Object.values(value)) walk(spec, child);
}

/** `{path, method, ...operation}` of every operation in the document. */
function operations(spec) {
  return Object.entries(spec.paths).flatMap(([path, item]) => Object.entries(item)
    .filter(([method]) => methods.has(method)).map(([method, operation]) => ({ path, method, ...operation })));
}

/** Rules both documents share: 3.1, local references, unique IDs, path parameters, security schemes, error bodies. */
function structure(spec, label) {
  assert.match(spec.openapi, /^3\.1\./, `${label} must use OpenAPI 3.1`);
  walk(spec, spec);
  const tagNames = (spec.tags ?? []).map((tag) => tag.name);
  assert.equal(new Set(tagNames).size, tagNames.length, `${label}: top-level tag names are unique`);
  const operationIds = new Set();
  for (const [path, item] of Object.entries(spec.paths)) {
    assert.ok(!/^\/api\/admin(?:\/|$)/.test(path), `Administrative path in ${label}: ${path}`);
    assert.ok(!path.includes('*'), `Wildcard route must have a named parameter: ${path}`);
    const names = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      assert.ok(operation.operationId, `Missing operationId: ${method} ${path}`);
      assert.ok(!operationIds.has(operation.operationId), `Duplicate operationId: ${operation.operationId}`);
      operationIds.add(operation.operationId);
      const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])]
        .map((parameter) => parameter.$ref ? dereference(spec, parameter.$ref) : parameter);
      const declared = parameters.filter((parameter) => parameter.in === 'path');
      assert.deepEqual(declared.map((parameter) => parameter.name).sort(), [...names].sort(),
        `Path parameter mismatch: ${method} ${path}`);
      for (const parameter of declared) assert.equal(parameter.required, true,
        `Path parameter must be required: ${method} ${path} ${parameter.name}`);
      for (const security of operation.security ?? spec.security ?? []) {
        for (const name of Object.keys(security)) assert.ok(spec.components?.securitySchemes?.[name],
          `Missing security scheme: ${name}`);
      }
      for (const [status, declaredResponse] of Object.entries(operation.responses)) {
        if (!/^4\d\d$|^5\d\d$/.test(status)) continue;
        const response = declaredResponse.$ref ? dereference(spec, declaredResponse.$ref) : declaredResponse;
        for (const media of Object.values(response.content ?? {})) assert.equal(
          media.schema?.$ref, '#/components/schemas/ErrorResponse',
          `Declared error body must use the actual error DTO: ${method} ${path} ${status}`);
      }
    }
  }
  return operationIds.size;
}

function taggedIds(spec, tag) {
  return operations(spec).filter((operation) => operation.tags?.includes(tag)).map((operation) => operation.operationId).sort();
}

function publicContract(spec) {
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
  assert.deepEqual(schemas.HostingUpdateRequest.required, ['deliveryMode'],
    'Hosting changes require only delivery mode; expectedVersion is optional and a stale one is reported, not rejected');
  assert.equal(schemas.HostingUpdateRequest.properties.expectedVersion.type, 'integer',
    'Hosting expectedVersion must be an integer');
  assert.equal(schemas.HostingUpdateRequest.properties.expectedVersion.minimum, 1,
    'Hosting expectedVersion starts at one');
  assert.deepEqual(schemas.HostingProjection.properties.hostingVersion.type, ['integer', 'null'],
    'Hosting version is nullable for legacy publications');
  assert.ok(schemas.HostingProjection.required.includes('hostingVersion'),
    'Serialized hosting version is required even when null');
  for (const name of ['deliveryModeReason', 'deliveryNotice']) {
    assert.equal(schemas.HostingProjection.properties[name]?.type, 'string', `Hosting projection exposes optional ${name}`);
    assert.ok(!schemas.HostingProjection.required.includes(name), `Hosting ${name} is omitted when nothing applies`);
  }
  const hostingPatch = spec.paths['/api/{type}/{ns}/{id}/hosting'].patch;
  assert.deepEqual(Object.keys(hostingPatch.responses).sort(), ['200', '400', '403', '404', '429', '503'],
    'Hosting PATCH reports mismatches in 200, never as a version conflict');
  assert.ok(hostingPatch.parameters.find((parameter) => parameter.name === 'type').schema.enum.includes('sites'),
    'Hosting PATCH routes sites to the tolerant mode-locked answer');
  for (const suffix of ['source', 'settings']) assert.deepEqual(
    spec.paths[`/api/html/{ns}/{id}/${suffix}`].get.security, [{ OwnerToken: [] }, { ManageKey: [] }],
    `HTML ${suffix} access requires owner authority: owner token or management key`);
  assert.deepEqual(spec.components.securitySchemes.ManageKey, { type: 'apiKey', description: spec.components.securitySchemes.ManageKey.description,
    name: 'X-Manage-Key', in: 'header' }, 'Management key is a header apiKey scheme');
  for (const [extension, operationId] of [['jpg', 'previewJpeg'], ['png', 'preview']]) {
    const preview = spec.paths[`/preview/{ns}/{id}.${extension}`]?.get;
    assert.ok(preview, `Preview .${extension} image route is published`);
    assert.equal(preview.operationId, operationId, `Preview .${extension} keeps operation ID ${operationId}`);
    assert.deepEqual(preview.tags, ['preview'], `Preview .${extension} uses the shared preview tag`);
    assert.ok(preview.responses['200'].content['image/jpeg'], `Preview .${extension} declares JPEG card bytes`);
    for (const status of ['302', '304', '429']) assert.equal(preview.responses[status].content, undefined,
      `Preview .${extension} ${status} has no response body`);
  }
  const limits = spec.paths['/api/limits']?.get;
  assert.equal(limits?.operationId, 'getLimits', 'Upload limits are published as GET /api/limits');
  assert.equal(limits.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/LimitsResponse',
    'Limits answer with the LimitsResponse DTO');
  assert.deepEqual(Object.keys(schemas.LimitsResponse.properties).sort(), ['customDomains', 'files', 'html', 'json', 'kv',
    'linkNames', 'ownerMaxTtlDays', 'profileMaxTtlDays', 'reach', 'requestMaxBytes', 'sites'],
    'Limits expose the request size, per-type limits, profile TTL cap, optional owner reach and TTL cap, optional custom domains, link names');
  linkNameContract(spec);
  assert.deepEqual(taggedIds(spec, 'Custom Domains'), ['addDomain', 'attachDomain', 'checkDomain', 'checkPublicationDomain', 'detachDomain',
    'getDomain', 'getPublicationDomain', 'listDomains', 'removeDomain', 'removePublicationDomain', 'setPublicationDomain'],
    'Custom Domains publishes its eleven operations');
  assert.deepEqual(schemas.DomainItem.properties.status.enum, ['pending_dns', 'verifying', 'active', 'lost'],
    'A custom domain moves through pending_dns, verifying, active and lost');
  assert.equal(schemas.DomainItem.properties.records.items.$ref, '#/components/schemas/DomainRecord',
    'A custom domain answer lists its DNS records');
  for (const [path, schema] of [['/api/html', 'HtmlUploadResponse'], ['/api/sites', 'SiteUploadResponse']]) {
    assert.equal(spec.paths[path].post.parameters.find((parameter) => parameter.name === 'domain')?.in, 'query',
      `POST ${path} takes the optional domain parameter`);
    assert.ok(!schemas[schema].required.includes('customDomain'), `${schema} omits customDomain when no domain was set`);
  }
  assert.deepEqual(Object.keys(schemas.SiteLimitsResponse.properties).sort(), ['allowedExtensions', 'defaultTtlDays',
    'maxArchiveExpansionBytes', 'maxFileBytes', 'maxFiles', 'maxNameBytes', 'maxPathBytes', 'maxPathChars', 'maxTotalBytes',
    'maxTtlDays', 'skippedFileNames', 'skippedRootFolders'], 'Site limits expose exactly the user-facing fields');
  for (const [path, method] of [['/api/sites', 'post'], ['/api/sites/{ns}/{id}', 'put']]) {
    const statuses = Object.keys(spec.paths[path][method].responses);
    for (const status of ['400', '413', '422']) assert.ok(statuses.includes(status), `Site ${method} declares ${status}`);
    assert.ok(!statuses.includes('415'), `Site ${method} answers 422, not 415, when no servable file is left`);
    assert.equal(spec.paths[path][method].requestBody.content['multipart/form-data'].schema.properties.state?.type, 'string',
      `Site ${method} takes the optional page data settings as the JSON text field state`);
  }
  const pageDataOperations = operations(spec).filter((operation) => operation.tags?.includes('Page data'));
  assert.deepEqual(pageDataOperations.map((operation) => operation.operationId).sort(), ['changePageDataSettings', 'deletePageDataEntry',
    'deletePageDataFile', 'deletePageDataRange', 'downloadPageDataFile', 'listPageDataEntries', 'listPageDataFiles',
    'readPageDataSettings', 'readPageDataTotals', 'writePageDataEntry'],
    'Page data publishes its ten owner operations');
  for (const operation of pageDataOperations) {
    assert.match(operation.path, /^\/api\/\{ns\}\/\{id\}\/state(?:\/|$)/, `${operation.operationId} is an untyped owner route under the publication`);
    assert.deepEqual(operation.security, [{ OwnerToken: [] }, { ManageKey: [] }],
      `${operation.operationId} requires owner authority: owner token or management key`);
  }
  const pageDataTag = spec.tags.find((tag) => tag.name === 'Page data').description;
  assert.ok(pageDataTag.includes(HOST_BASE) && pageDataTag.includes(HOST_DOCUMENT_URL),
    'Page data tag names the visitor host API and the address of its own document');
  assert.deepEqual(Object.keys(spec.paths).filter((path) => /\/_bp\/|^\/api\/hosts\/.*\/state/.test(path)), [],
    'Visitor host API and host state routes stay out of the contract paths');
  const notifications = operations(spec).filter((operation) => operation.tags?.includes('Notifications'));
  assert.deepEqual(notifications.map((operation) => operation.operationId).sort(), NOTIFICATION_OPERATIONS,
    'Notifications publishes its eight profile operations');
  for (const operation of notifications) {
    assert.match(operation.path, /^\/api\/profile\/notifications(?:\/|$)/, `${operation.operationId} is a profile notifications route`);
    assert.deepEqual(operation.security, [{ OwnerToken: [] }], `${operation.operationId} requires the owner token`);
  }
  assert.ok(spec.tags.some((tag) => tag.name === 'Notifications'), 'Notifications is a described top-level tag');
  newsNoticeContract(spec);
  secretsTagsContract(spec);
  commentModeContract(spec);
  assert.deepEqual([taggedIds(spec, 'Templates'), spec.paths['/api/templates']?.get?.security], [['templates'], [{}]],
    'Templates publishes the anonymous template catalogue');
  assert.deepEqual(Object.keys(spec.paths).filter((path) => path.startsWith('/api/stats/')), [],
    'Hidden home totals poll stays out of the contract paths');
  assert.deepEqual(Object.keys(spec.paths).filter((path) => path.includes('account')), [],
    'Account session routes stay out of the contract paths');
  for (const name of ['HtmlUploadRequest', 'HtmlUpdateRequest']) {
    assert.deepEqual(schemas[name].properties.state?.type, ['object', 'null'], `${name} takes the optional page data settings object`);
    assert.ok(!(schemas[name].required ?? []).includes('state'), `${name} never requires state`);
  }
  assert.deepEqual([schemas.StateListResponse.required, schemas.StateDeleteResponse.required, schemas.StateWriteResponse.required],
    [['items', 'next'], ['deleted'], ['createdAt', 'id', 'key', 'updatedAt', 'version']],
    'Page data answers: an entry page with next, a delete count, a write receipt with its version');
  assert.deepEqual([schemas.StateListSettings.properties.write.enum, schemas.StateListSettingsRequest.properties.write.enum,
    schemas.StateSettings.properties.accountOffer?.type, schemas.StateSettingsRequest.properties.accountOffer?.type,
    schemas.StateConfigResponse.properties.pageDataHint?.enum, schemas.PublicationListItemResponse.properties.pageDataHint?.enum],
    [['visitors', 'author', 'accounts'], ['visitors', 'author', 'accounts'], 'boolean', ['boolean', 'null'], ['form', 'local', 'game'],
      ['form', 'local', 'game']],
    'A list may take writes only from signed-in visitors, the sign-in offer can be turned off, and a page without Page data names its hint');
  assert.deepEqual(schemas.StateEntry.required, ['createdAt', 'id', 'key', 'sizeBytes', 'updatedAt', 'value', 'version', 'visitor'],
    'A page data entry carries key, id, visitor, version, size, times and value');
  for (const [suffix, operationId, answer] of [['badge', 'setBadge', 'BadgeResponse'], ['private', 'makePrivate', 'PublicationRotateResponse'],
    ['public', 'makePublic', 'PublicationRotateResponse']]) {
    const action = spec.paths[`/api/{type}/{ns}/{id}/${suffix}`]?.post;
    assert.equal(action?.operationId, operationId, `Owner action /${suffix} is published as ${operationId}`);
    assert.deepEqual(action.security, [{ OwnerToken: [] }, { ManageKey: [] }], `${operationId} requires owner authority: owner token or management key`);
    assert.equal(action.responses['200'].content['application/json'].schema.$ref, `#/components/schemas/${answer}`, `${operationId} answers with ${answer}`);
    assert.ok(action.responses['409'], `${operationId} declares its 409 refusal`);
  }
  assert.equal(spec.paths['/api/{type}/{ns}/{id}/public'].post.summary, 'Make a private publication public: new public link, ' +
    'the private one leads there for 30 days. Give the user the new link and manageUrl', 'makePublic: the private link leads to the public one for 30 days');
  assert.deepEqual(schemas.BadgeResponse.required, ['hidden', 'limit', 'used'], 'A badge answer carries the state and the profile counts');
  assert.equal(schemas.BadgeRequest.properties.hidden.type, 'boolean', 'A badge request takes the optional boolean hidden');
  assert.deepEqual(spec.paths['/api/json'].post.requestBody.content['application/json'].schema, {},
    'JSON creation admits arbitrary JSON values');
}

/** Link names: create parameter, owner route with its coded refusals, optional answer fields; the availability check stays hidden. */
function linkNameContract(spec) {
  const schemas = spec.components.schemas;
  const nullableName = ['string', 'null'];
  assert.deepEqual([dereference(spec, schemas.LimitsResponse.properties.linkNames.$ref).properties, schemas.LimitsResponse.required.includes('linkNames')],
    [{ enabled: { type: 'boolean' } }, true], 'Limits always carry linkNames {enabled}');
  for (const path of ['/api/html', '/api/sites', '/api/files']) {
    const parameter = spec.paths[path].post.parameters.find((candidate) => candidate.name === 'linkName');
    assert.deepEqual([parameter?.in, parameter?.required ?? false, parameter?.schema], ['query', false, { type: 'string' }],
      `POST ${path} takes the optional linkName query parameter`);
    assert.match(parameter.description, /^Optional\. Readable name for the public link .*link-name-needs-account.*POST \/api\/\{type\}\/public\/\{id\}\/link-name\.$/,
      `POST ${path} linkName names the profile requirement, the create notices and the owner route`);
  }
  const route = spec.paths['/api/{type}/{ns}/{id}/link-name']?.post;
  assert.equal(route?.operationId, 'setLinkName', 'Link names are set, changed and removed by setLinkName');
  assert.deepEqual(route.security, [{ OwnerToken: [] }, { ManageKey: [] }], 'setLinkName requires owner authority: owner token or management key');
  assert.deepEqual(route.parameters.find((parameter) => parameter.name === 'type').schema.enum, ['html', 'files', 'sites'],
    'Only pages, sites and files take a link name');
  assert.deepEqual(Object.keys(route.responses).sort(), ['200', '400', '403', '404', '409', '429', '503'], 'setLinkName declares its answers');
  for (const [status, codes] of [['400', ['LINK_NAME_INVALID']], ['403', ['LINK_NAME_NEEDS_ACCOUNT']], ['404', ['FEATURE_DISABLED']],
    ['409', ['LINK_NAME_UNAVAILABLE', 'LINK_NAME_PUBLIC_ONLY', 'LINK_NAME_LIMIT']], ['429', ['LINK_NAME_LIMITED', 'LINK_NAME_PAUSED', 'Retry-After']]]) {
    for (const code of codes) assert.ok(route.responses[status].description.includes(code), `setLinkName ${status} names ${code}`);
  }
  assert.deepEqual([route.requestBody.content['application/json'].schema.$ref, schemas.LinkNameRequest.properties.linkName.type],
    ['#/components/schemas/LinkNameRequest', nullableName], 'setLinkName takes {"linkName": string|null}; null or empty removes the name');
  assert.equal(route.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/LinkNameResponse', 'setLinkName answers with LinkNameResponse');
  const answer = schemas.LinkNameResponse.properties;
  assert.deepEqual([answer.link?.type, answer.linkName?.type, answer.previousLinkName?.type, answer.notices?.items?.$ref],
    ['string', nullableName, nullableName, '#/components/schemas/PublishNotice'], 'A link-name answer carries the hosting fields, linkName, previousLinkName and notices');
  for (const name of ['HostingProjection', 'HostingReadResponse', 'HtmlUploadResponse', 'SiteUploadResponse', 'FileUploadResponse',
    'PublicationRotateResponse', 'PublicationListItemResponse']) {
    assert.deepEqual(schemas[name].properties.linkName?.type, nullableName, `${name} carries the optional linkName, string or null`);
    assert.ok(!(schemas[name].required ?? []).includes('linkName'), `${name} omits linkName while link names are off`);
  }
  assert.deepEqual([schemas.HostingReadResponse.properties.linkNamesLeft?.type, (schemas.HostingReadResponse.required ?? []).includes('linkNamesLeft')],
    ['integer', false], 'The owner hosting read carries the optional linkNamesLeft');
  assert.deepEqual(Object.keys(spec.paths).filter((path) => /link-names|bug-report/.test(path)), [],
    'The availability check and bug-report routes stay out of the contract paths');
}

/** News notices: type news with an optional body object, an action link with its button label; sign-in routes stay on the account host. */
function newsNoticeContract(spec) {
  const schemas = spec.components.schemas;
  const item = schemas.NotificationItem;
  assert.deepEqual(item.properties.type.enum, ['page_expiring', 'page_removed', 'page_taken_down', 'page_restored', 'page_link_changed',
    'page_deleted', 'page_extended', 'entries_new', 'comments_new', 'quota_close', 'quota_reached', 'published', 'updated', 'domain_problem',
    'domain_paused', 'domain_setup', 'domain_active', 'domain_lost', 'domain_released', 'secret_opened', 'secret_expired', 'secret_deleted', 'news'],
  'A notification type is one of the thirteen page types, six custom-domain types, three secret types or news');
  assert.deepEqual(item.properties.group.enum, ['pages', 'entries', 'comments'],
    'A notice group is pages, entries or comments; activity, news and domain notices have none');
  assert.deepEqual([item.properties.news?.oneOf, item.required.includes('news')], [[{ $ref: '#/components/schemas/NotificationNews' }], false],
    'A notification carries the optional news body, absent for other types');
  const news = schemas.NotificationNews;
  assert.deepEqual([Object.fromEntries(Object.entries(news.properties).map(([name, value]) => [name, value.type])), news.required],
    [{ html: 'string', text: 'string', title: 'string' }, ['text', 'title']], 'A news body has title and plain text; its safe HTML is optional');
  const link = schemas.NotificationLink;
  assert.deepEqual([link.properties.rel.enum, link.properties.label?.type, link.required],
    [['page', 'data', 'manage', 'settings', 'domain', 'terms', 'action'], 'string', ['rel', 'url']], 'Only a news action link adds its optional button label');
  assert.deepEqual(Object.keys(spec.paths).filter((path) => /telegram|\/auth\//.test(path)), [],
    'Sign-in and Telegram link routes stay out of the contract paths');
}

/** One-time secrets: owned create, status/reveal with the optional owner arm, owner routes by ref; owner tags: list filter, item field, set/get routes. */
function secretsTagsContract(spec) {
  const schemas = spec.components.schemas;
  const owner = [{ OwnerToken: [] }, { ManageKey: [] }];
  const optional = [{}, { OwnerToken: [] }];
  const routes = [['post', '/api/secrets'], ['get', '/api/secrets'], ['get', '/api/secrets/{id}'], ['post', '/api/secrets/{id}/reveal'],
    ['get', '/api/secrets/owner/{ref}'], ['patch', '/api/secrets/owner/{ref}'], ['post', '/api/secrets/owner/{ref}/burn'], ['delete', '/api/secrets/owner/{ref}']];
  assert.deepEqual([taggedIds(spec, 'One-time secrets'), routes.map(([method, path]) => [spec.paths[path]?.[method]?.operationId, spec.paths[path]?.[method]?.security])],
    [['burnSecret', 'createSecret', 'deleteSecret', 'getSecret', 'getSecretStatus', 'listSecrets', 'revealSecret', 'updateSecret'],
      [['createSecret', optional], ['listSecrets', [{ OwnerToken: [] }]], ['getSecretStatus', optional], ['revealSecret', optional],
        ['getSecret', owner], ['updateSecret', owner], ['burnSecret', owner], ['deleteSecret', owner]]],
    'One-time secrets publishes create/status/reveal with an optional owner token and five owner operations by ref');
  const create = schemas.SecretCreateRequest;
  assert.deepEqual([create.required, create.properties.iv.pattern, create.properties.ttl.enum, create.properties.maxViews.minimum,
    create.properties.maxViews.maximum, create.properties.ciphertext.maxLength, create.properties.kind.enum, create.properties.keyCheck.pattern,
    create.properties.title.maxLength],
    [['ciphertext', 'iv', 'title'], '^[A-Za-z0-9_-]{16}$', ['1h', '1d', '7d', '30d'], 1, 10, 54000, ['text', 'file'], '^[A-Za-z0-9_-]{22}$', 200],
    'A secret is base64url ciphertext and a 12-byte iv with a title, kind text or file, a 22-char key check, ttl 1h-30d, 1-10 views');
  assert.deepEqual(schemas.SecretCreateResponse.required, ['expiresAt', 'id', 'kind', 'manageUrl', 'maxViews', 'ownerToken', 'ref', 'title'],
    'A created secret answers id, ref, owner token and manage link; never a key');
  for (const status of ['/api/secrets/{id}', '/api/secrets/{id}/reveal']) {
    const operation = Object.values(spec.paths[status])[0];
    assert.ok(operation.responses['410'].description.includes('SECRET_GONE'), `${operation.operationId}: every ended secret answers 410 SECRET_GONE`);
  }
  assert.deepEqual([schemas.SecretStatusResponse.properties.state.enum, schemas.SecretItem.properties.state.enum,
    Object.keys(schemas.SecretItem.properties).filter((name) => ['id', 'ciphertext', 'iv', 'keyCheck', 'ownerToken'].includes(name)),
    schemas.SecretCountsResponse.required, schemas.PublicationListResponse.properties.secretCounts?.oneOf],
    [['active'], ['waiting', 'opened', 'spent', 'expired', 'deleted', 'removed'], [], ['active', 'spent'], [{ $ref: '#/components/schemas/SecretCountsResponse' }]],
    'Status reads only live secrets; the owner item has six states and never the link id, content or key check; the owner list carries secretCounts');
  const list = spec.paths['/api/publications'].get.parameters.find((parameter) => parameter.name === 'tag');
  assert.deepEqual([list?.in, list?.schema], ['query', { type: 'string' }], 'Owner listing takes the exact tag filter');
  assert.equal(schemas.PublicationListItemResponse.properties.tags?.type, 'array', 'Owner list items carry their tags');
  const tagsPath = '/api/publications/{type}/{ns}/{id}/tags';
  assert.deepEqual([spec.paths[tagsPath]?.get?.operationId, spec.paths[tagsPath]?.post?.operationId, spec.paths['/api/publications/tags']?.get?.operationId,
    spec.paths[tagsPath].post.security], ['getTags', 'setTags', 'listTags', [{ OwnerToken: [] }, { ManageKey: [] }]],
  'Tags are read and replaced with owner authority, and listed for autocomplete');
  const tags = schemas.TagsRequest.properties.tags;
  assert.deepEqual([tags.maxItems, tags.items.minLength, tags.items.maxLength], [10, 1, 32], 'A tag set is up to 10 tags of 1-32 characters');
}

/** Comment mode: read with owner token or management key, set with an owner token only (account credentials, R21); notes stay out. */
function commentModeContract(spec) {
  const schemas = spec.components.schemas;
  const route = spec.paths['/api/publications/{type}/{ns}/{id}/discussion'];
  assert.deepEqual([route?.get?.operationId, route?.get?.security, route?.put?.operationId, route?.put?.security,
    schemas.CommentModeRequest?.properties?.comments?.enum, schemas.CommentModeResponse?.properties?.comments?.enum,
    schemas.CommentModeResponse?.properties?.locked?.type],
    ['getCommentMode', [{ OwnerToken: [] }, { ManageKey: [] }], 'setCommentMode', [{ OwnerToken: [] }],
      ['off', 'signed_in', 'everyone'], ['off', 'signed_in', 'everyone'], 'boolean'],
    'Comment mode is read by either owner proof, set by an owner token, off, signed_in or everyone, with locked');
  assert.deepEqual(Object.keys(spec.paths).filter((path) => /\/notes|\/comments/.test(path)), [],
    'Owner notes and reader comment routes stay out of the contract paths');
}

/** The host document: only visitor routes of one page, cookie security, the state header on all but the file read. */
function hostContract(spec) {
  assert.equal(spec.info.title, 'BrewPage Page data host API', 'Host document keeps its title');
  assert.deepEqual(spec.servers.map((server) => server.url), ['https://{host}'], "Host document is served on the page's own address");
  assert.deepEqual(operations(spec).map(({ method, path }) => `${method.toUpperCase()} ${path}`).sort(), HOST_ROUTES,
    'Host document publishes its sixteen operations on eleven paths');
  const schemes = spec.components.securitySchemes;
  assert.deepEqual([schemes.VisitorCookie.type, schemes.VisitorCookie.in, schemes.VisitorCookie.name], ['apiKey', 'cookie', '__Host-bp-v'],
    'Visitors are known by the host-only visitor cookie');
  for (const operation of operations(spec)) {
    const headers = (operation.parameters ?? []).map((parameter) => parameter.$ref ? dereference(spec, parameter.$ref) : parameter)
      .filter((parameter) => parameter.in === 'header' && parameter.name === 'X-BP-State');
    assert.equal(headers.length, operation.operationId === 'readFile' ? 0 : 1,
      `${operation.operationId}: X-BP-State on every operation except the file read`);
  }
  assert.ok(spec.components.schemas.ErrorResponse.properties.code.enum.every((code) => /^STATE_[A-Z_]+$/.test(code)),
    'Host errors carry a STATE_* code');
  const ping = spec.components.schemas.Ping?.properties ?? {};
  assert.deepEqual([spec.components.schemas.ErrorResponse.properties.code.enum.includes('STATE_ACCOUNT_REQUIRED'), ping.identity?.enum,
    ping.accountOffer?.enum, spec.paths[`${HOST_BASE}/_account/claim`]?.post?.parameters?.find((p) => p.name === 'keep')?.schema?.enum],
    [true, ['anonymous', 'account'], [false], ['browser', 'account']],
    'Signed-in page data: STATE_ACCOUNT_REQUIRED, ping identity and offer, claim keeps the browser or the account side');
}

const HOST_DOCUMENT_URL = 'https://kochetkov-ma.github.io/brewpage-openapi/page-data-host.json';
const NOTIFICATION_OPERATIONS = ['countUnreadNotifications', 'deleteNotification', 'getNotificationPageSwitch', 'getNotificationSettings',
  'listNotifications', 'markNotificationsRead', 'setNotificationPageSwitch', 'updateNotificationSettings'];
const HOST_ROUTES = [
  `DELETE ${HOST_BASE}/_account`, `DELETE ${HOST_BASE}/{col}/_files/{id}`, `DELETE ${HOST_BASE}/{col}/_id/{id}`, `DELETE ${HOST_BASE}/{col}/{key}`,
  `GET ${HOST_BASE}`, `GET ${HOST_BASE}/{col}`, `GET ${HOST_BASE}/{col}/_files/{id}`, `GET ${HOST_BASE}/{col}/_stats`,
  `GET ${HOST_BASE}/{col}/{key}`, `POST ${HOST_BASE}`, `POST ${HOST_BASE}/_account`, `POST ${HOST_BASE}/_account/claim`,
  `POST ${HOST_BASE}/_account/start`, `POST ${HOST_BASE}/_session`, `POST ${HOST_BASE}/{col}/_files`,
  `PUT ${HOST_BASE}/{col}/{key}`,
];
/** Committed document name -> its label and own rules. */
const DOCUMENTS = {
  openapi: { label: 'Public OpenAPI', rules: publicContract },
  'page-data-host': { label: 'Page data host OpenAPI', rules: hostContract },
};

function verify(name, path) {
  const { label, rules } = DOCUMENTS[name];
  const text = readFileSync(path, 'utf8');
  const spec = JSON.parse(text);
  const count = structure(spec, label);
  rules(spec);
  return { label, text, spec, count };
}

/** Committed copies: derived YAML, the docs site copy and the export provenance all describe the same JSON bytes. */
function committed(name) {
  const path = resolve(root, `openapi/${name}.json`);
  const { label, text, spec, count } = verify(name, path);
  const derived = readFileSync(resolve(root, `openapi/${name}.yaml`), 'utf8');
  assert.deepEqual(yaml.load(derived), spec, `${label}: derived YAML must equal the generated JSON`);
  assert.equal(derived, contractYaml(yaml, text), `${label}: YAML serialization must match the deterministic sync script`);
  assert.equal(readFileSync(resolve(root, `docs/public/${name}.json`), 'utf8'), text,
    `${label}: committed docs site JSON copy must match byte for byte`);
  const provenance = JSON.parse(readFileSync(resolve(root, `openapi/${name}.provenance.json`), 'utf8'));
  assert.equal(provenance.jsonSha256, createHash('sha256').update(readFileSync(path)).digest('hex'),
    `${label}: export provenance must identify the exact generated JSON bytes`);
  assert.equal(provenance.backendBuildVersion, spec.info.version, `${label}: backend build version must match the document version`);
  assert.match(provenance.backendCommit, /^[a-f0-9]{40}$/, `${label}: export must identify the backend source commit`);
  assert.match(provenance.backendSourceSha256, /^[a-f0-9]{64}$/, `${label}: export must identify backend source content`);
  return { label, spec, count, provenance };
}

function report({ label, spec, count }) {
  console.log(`${label} valid: ${count} operations, ${Object.keys(spec.paths).length} paths; references, IDs, parameters and security verified.`);
}

const publicSpec = flag('--spec');
const hostSpec = flag('--host-spec');
if (publicSpec) report(verify('openapi', publicSpec));
if (hostSpec) report(verify('page-data-host', hostSpec));
if (!publicSpec && !hostSpec) {
  const [main, host] = Object.keys(DOCUMENTS).map(committed);
  for (const key of ['backendBuildVersion', 'backendCommit', 'backendSourceSha256']) assert.equal(host.provenance[key], main.provenance[key],
    `Both documents come from one export: ${key}`);
  report(main);
  report(host);
}
