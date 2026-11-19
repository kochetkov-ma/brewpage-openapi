import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(new URL('../docs/package.json', import.meta.url));
const yaml = require('js-yaml');
const workflow = yaml.load(readFileSync(new URL('../.github/workflows/docs.yml', import.meta.url), 'utf8'));
const release = yaml.load(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
const { qualification, build, deploy } = workflow.jobs;
const required = ['qualification', 'release', 'registry', 'advertise'];
const qualifiedRevision = '${{ needs.qualification.outputs.revision }}';
const qualifiedTag = '${{ needs.qualification.outputs.tag }}';
const publishers = ['Publish to npm', 'Publish to MCP registry', 'Create GitHub Release'];
const tagCheckName = 'Revalidate the remote artifact tag';

assert.equal(release.jobs.qualification.if, "github.event_name == 'workflow_dispatch'", 'Only manual publication can select an artifact');
assert.equal(release.jobs.qualification.outputs.revision, '${{ steps.receipt.outputs.revision }}', 'Artifact SHA is emitted only by receipt validation');
assert.equal(release['run-name'], "\${{ github.event_name == 'workflow_dispatch' && format('Publish {0} at {1}', inputs.release_tag || github.ref_name, fromJSON(inputs.hosted_receipt || '{}').revision) || format('Build {0}', github.ref_name) }}", 'Pages title binds the requested tag to the validated receipt revision');
assert.deepEqual(
  required.slice(1).map((name) => {
    const { ref, 'persist-credentials': persist } = release.jobs[name].steps[0].with;
    return [ref, persist];
  }),
  Array.from({ length: 3 }, () => [qualifiedRevision, false]), 'Publishing checkouts use the artifact and retain no Git credentials',
);
assert.deepEqual(release.jobs.registry.needs, ['qualification', 'release'], 'Registry depends on the qualified revision and npm publication');
const advertiseInputs = release.jobs.advertise.steps.at(-1).with;
assert.deepEqual([release.jobs.release.steps.find(({ id }) => id === 'check').env.ARTIFACT_REVISION,
  release.jobs.registry.steps.find(({ name }) => name === 'Wait for npm to serve the exact revision').env.ARTIFACT_REVISION,
  advertiseInputs.tag_name, advertiseInputs.target_commitish], [qualifiedRevision, qualifiedRevision, qualifiedTag, qualifiedRevision], 'Registry and GitHub Release use the artifact tag and revision');
const remoteTagGate = release.jobs.release.steps.find(({ name }) => name === tagCheckName);
assert.deepEqual(remoteTagGate.env, { RELEASE_TAG: qualifiedTag, ARTIFACT_REVISION: qualifiedRevision }, 'Remote verification binds the qualified tag and revision');
assert.deepEqual(required.slice(1).map((job, i) => {
  const steps = release.jobs[job].steps;
  return steps[steps.findIndex(({ name }) => name === publishers[i]) - 1];
}), [remoteTagGate, remoteTagGate, remoteTagGate], 'Every publisher immediately follows exact remote tag validation');

// GIVEN each Docs event; WHEN selected; THEN only a fully qualified release can upload and deploy.
assert.deepEqual(workflow.on.workflow_run, { workflows: [release.name], types: ['completed'] }, 'Release workflow identity');
assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push', 'workflow_dispatch', 'workflow_run'], 'Validation events');
const predicate = qualification.if.trim().split(/\s*&&\s*/);
const terms = [
  "github.event_name == 'workflow_run'",
  "github.event.workflow_run.event == 'workflow_dispatch'",
  "github.event.workflow_run.conclusion == 'success'",
  'github.event.workflow_run.head_repository.full_name == github.repository',
];
assert.deepEqual(predicate, terms, 'Authenticated successful manual release is the only qualifying event');
for (const [event, trigger, conclusion, sameRepo, expected] of [
  ['push', '', '', false, false], ['pull_request', '', '', false, false], ['workflow_dispatch', '', '', false, false],
  ['workflow_run', 'push', 'success', true, false], ['workflow_run', 'workflow_dispatch', 'failure', true, false],
  ['workflow_run', 'workflow_dispatch', 'success', false, false], ['workflow_run', 'workflow_dispatch', 'success', true, true],
]) {
  const values = [event === 'workflow_run', trigger === 'workflow_dispatch', conclusion === 'success', sameRepo];
  assert.equal(predicate.every((term) => values[terms.indexOf(term)]), expected, `Pages event ${event}/${trigger}/${conclusion}/${sameRepo}`);
}
assert.equal(build.needs, 'qualification', 'Build depends on qualification decision');
assert.equal(build.if, "!cancelled() && (github.event_name != 'workflow_run' || needs.qualification.result == 'success')", 'Ordinary events build, refused release events cannot');
assert.deepEqual(build.steps[0].with, { ref: '${{ needs.qualification.outputs.revision || github.sha }}', 'persist-credentials': false }, 'Release build uses exact qualifying revision');
assert.deepEqual(build.steps.filter(({ uses }) => uses?.startsWith('actions/upload-pages-artifact@')).map((step) => step.if),
  ["github.event_name == 'workflow_run' && needs.qualification.result == 'success'"], 'Pages upload condition');
assert.deepEqual(deploy.needs, ['qualification', 'build'], 'Pages requires a qualifying release and build');
assert.equal(deploy.if, "github.event_name == 'workflow_run' && needs.qualification.result == 'success' && needs.build.result == 'success'", 'No Pages deployment from ordinary build');
assert.deepEqual({ workflow: workflow.permissions, qualify: qualification.permissions, deploy: deploy.permissions },
  { workflow: { contents: 'read' }, qualify: { actions: 'read', contents: 'read' }, deploy: { contents: 'read', pages: 'write', 'id-token': 'write' } }, 'Only deploy has Pages write and OpenID');
assert.deepEqual(deploy.concurrency, { group: 'pages', queue: 'max' }, 'One Pages deploy at a time without replacing earlier queue entries');
assert.equal(deploy.steps[0].env.RELEASE_TAG, '${{ needs.qualification.outputs.tag }}', 'Ordering check uses the qualified tag under the Pages lock');

// GIVEN an Actions API publisher attempt; WHEN the actual qualification shell runs; THEN only its exact success set emits a SHA.
const repository = 'kochetkov-ma/brewpage-openapi';
const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const tagObjectSha = 'c'.repeat(40);
const controlSha = 'd'.repeat(40);
const defaultSha = 'e'.repeat(40);
const version = JSON.parse(readFileSync(new URL('../mcp-server/package.json', import.meta.url), 'utf8')).version;
const tag = `v${version}`;
const tagRef = { ref: `refs/tags/${tag}`, object: { type: 'commit', sha } };
const source = { id: 123, path: '.github/workflows/release.yml' };
const runId = 456;
const attempt = 3;
const jobs = required.map((name) => ({ name, run_id: runId, run_attempt: attempt, head_sha: sha, conclusion: 'success' }));
const mainJobs = jobs.map((job) => ({ ...job, head_sha: controlSha }));
const mainRun = { REF_NAME: 'main', CONTROL_REVISION: controlSha, RUN_TITLE: `Publish ${tag} at ${sha}`, DEFAULT_REF: 'refs/heads/main', DEFAULT_REVISION: defaultSha };
const controlCompare = { status: 'ahead', base_commit: { sha: controlSha }, merge_base_commit: { sha: controlSha } };
const mutateJob = (name, attrs) => jobs.map((job) => job.name === name ? { ...job, ...attrs } : job);
const script = qualification.steps.find((step) => step.id === 'release').run;
const work = mkdtempSync(join(tmpdir(), 'brewpage-pages-release-'));
const gate = join(work, 'gate.sh');
const output = join(work, 'output');
const summary = join(work, 'summary');
const trace = join(work, 'trace');
const run = (shell, env) => {
  writeFileSync(gate, shell);
  for (const file of [output, summary, trace]) writeFileSync(file, '');
  return spawnSync('/bin/bash', [gate], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 5_000, env: {
    PATH: `${work}:${process.env.PATH}`, GITHUB_REPOSITORY: repository, GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary, GITHUB_SHA: sha, RUNNER_TEMP: work, FIXTURE_TRACE: trace, ...env,
  } });
};
try {
  writeFileSync(join(work, 'gh'), `#!/bin/sh
case "$*" in
  "api repos/${repository}/actions/workflows/release.yml") printf '%s\\n' "$FIXTURE_WORKFLOW";;
  "api repos/${repository}/compare/$CONTROL_REVISION...$DEFAULT_REVISION?per_page=1") printf '%s\\n' "$FIXTURE_COMPARE";;
  "api repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100") printf '%s\\n' "$FIXTURE_JOBS";;
  "api repos/${repository}/git/ref/tags/${tag}")
    test "$FIXTURE_TAG" != missing || exit 44
    printf '%s\\n' "$FIXTURE_TAG";;
  "api repos/${repository}/git/tags/${tagObjectSha}") printf '%s\\n' "$FIXTURE_TAG_OBJECT";;
  "api --paginate repos/${repository}/releases?per_page=100") printf '%s\\n' "$FIXTURE_RELEASES";;
  *) exit 98;;
esac
`, { mode: 0o700 });
  for (const [name, fixtureJobs, env, expected] of [
    ['qualified lightweight tag', jobs, {}, 0],
    ['qualified annotated tag', jobs, {
      FIXTURE_TAG: JSON.stringify({ ...tagRef, object: { type: 'tag', sha: tagObjectSha } }),
      FIXTURE_TAG_OBJECT: JSON.stringify({ sha: tagObjectSha, object: { type: 'commit', sha } }),
    }, 0],
    ['qualified main control', mainJobs, mainRun, 0],
    ['main control is the default branch event commit', mainJobs, { ...mainRun, DEFAULT_REVISION: controlSha,
      FIXTURE_COMPARE: JSON.stringify({ ...controlCompare, status: 'identical' }) }, 0],
    ['main control diverges from trusted default history', mainJobs, { ...mainRun,
      FIXTURE_COMPARE: JSON.stringify({ ...controlCompare, status: 'diverged', merge_base_commit: { sha } }) }, 1],
    ['main comparison returns a different base commit', mainJobs, { ...mainRun,
      FIXTURE_COMPARE: JSON.stringify({ ...controlCompare, base_commit: { sha } }) }, 1],
    ['main control has an invalid default event ref', mainJobs, { ...mainRun, DEFAULT_REF: 'refs/tags/main' }, 1],
    ['main control with malformed title', mainJobs, { ...mainRun, RUN_TITLE: `Publish ${tag}` }, 1],
    ['main control with duplicated title', mainJobs, { ...mainRun, RUN_TITLE: `${mainRun.RUN_TITLE} ${mainRun.RUN_TITLE}` }, 1],
    ['main control with missing title', mainJobs, { ...mainRun, RUN_TITLE: '' }, 1],
    ['main control names missing artifact tag', mainJobs, { ...mainRun, RUN_TITLE: `Publish v99.0.0 at ${sha}` }, 98],
    ['main control names wrong artifact revision', mainJobs, { ...mainRun, RUN_TITLE: `Publish ${tag} at ${otherSha}` }, 1],
    ['qualified artifact tag moved', mainJobs, { ...mainRun, FIXTURE_TAG: JSON.stringify({ ...tagRef, object: { type: 'commit', sha: otherSha } }) }, 1],
    ['main run checked against another control SHA', mainJobs, { ...mainRun, CONTROL_REVISION: otherSha }, 1],
    ['main job checked against artifact instead of control SHA', [...mainJobs.slice(0, -1), jobs.at(-1)], mainRun, 1],
    ['version-shaped branch with no tag', jobs, { FIXTURE_TAG: 'missing' }, 44],
    ['version-shaped branch at another tag commit', jobs, { FIXTURE_TAG: JSON.stringify({ ...tagRef, object: { type: 'commit', sha: otherSha } }) }, 1],
    ['wrong ref namespace', jobs, { FIXTURE_TAG: JSON.stringify({ ...tagRef, ref: `refs/heads/${tag}` }) }, 4],
    ['image-only', [{ ...jobs[0], name: 'image' }], {}, 1],
    ['no qualifier', jobs.slice(1), {}, 1],
    ['skipped qualifier', mutateJob('qualification', { conclusion: 'skipped' }), {}, 1],
    ['failed npm', mutateJob('release', { conclusion: 'failure' }), {}, 1],
    ['failed registry', mutateJob('registry', { conclusion: 'failure' }), {}, 1],
    ['skipped advertisement', mutateJob('advertise', { conclusion: 'skipped' }), {}, 1],
    ['wrong workflow ID', jobs, { WORKFLOW_ID: '124' }, 1],
    ['wrong workflow file', jobs, { FIXTURE_WORKFLOW: JSON.stringify({ ...source, path: '.github/workflows/packages.yml' }) }, 1],
    ['wrong repository', jobs, { GITHUB_REPOSITORY: 'unrelated/fork' }, 98],
    ['wrong job SHA', mutateJob('release', { head_sha: 'b'.repeat(40) }), {}, 1],
    ['invalid SHA', jobs, { CONTROL_REVISION: 'main' }, 1],
    ['wrong attempt', mutateJob('qualification', { run_attempt: 2 }), {}, 1],
    ['wrong run', mutateJob('advertise', { run_id: 455 }), {}, 1],
    ['duplicate job', [...jobs, jobs[0]], {}, 1],
    ['unreviewed branch', jobs, { REF_NAME: 'feature', RUN_TITLE: mainRun.RUN_TITLE }, 1],
  ]) {
    const result = run(script, {
      RUN_ID: String(runId), RUN_ATTEMPT: String(attempt), WORKFLOW_ID: String(source.id), REF_NAME: tag, CONTROL_REVISION: sha, RUN_TITLE: 'Release',
      FIXTURE_WORKFLOW: JSON.stringify(source), FIXTURE_JOBS: JSON.stringify({ total_count: fixtureJobs.length, jobs: fixtureJobs }),
      FIXTURE_TAG: JSON.stringify(tagRef), FIXTURE_COMPARE: JSON.stringify(controlCompare), ...env,
    });
    assert.equal(result.status, expected, `${name} qualification exit: ${result.stderr}`);
    assert.equal(readFileSync(output, 'utf8'), expected === 0 ? `revision=${sha}\ntag=${tag}\n` : '', `${name} verified checkout SHA and tag`);
  }

  // GIVEN the live remote ref; WHEN a publisher revalidates it; THEN only the qualified commit is accepted.
  writeFileSync(join(work, 'git'), `#!/bin/sh
test "$*" = 'ls-remote --exit-code origin refs/tags/${tag} refs/tags/${tag}^{}' || exit 98
printf '%s' "$FIXTURE_REMOTE_TAGS"
exit "$FIXTURE_REMOTE_RC"
`, { mode: 0o700 });
  const direct = (revision) => `${revision}\trefs/tags/${tag}\n`;
  const peeled = (revision) => `${revision}\trefs/tags/${tag}^{}\n`;
  for (const [name, lines, remoteCode, expected] of [
    ['matching lightweight tag', direct(sha), '0', 0],
    ['matching annotated tag', direct(tagObjectSha) + peeled(sha), '0', 0],
    ['moved lightweight tag', direct(otherSha), '0', 1],
    ['moved annotated tag', direct(tagObjectSha) + peeled(otherSha), '0', 1],
    ['deleted remote tag', '', '2', 2],
    ['ambiguous remote response', direct(tagObjectSha) + peeled(sha) + peeled(otherSha), '0', 1],
  ]) {
    const result = run(remoteTagGate.run, { RELEASE_TAG: tag, ARTIFACT_REVISION: sha, FIXTURE_REMOTE_TAGS: lines, FIXTURE_REMOTE_RC: remoteCode });
    assert.equal(result.status, expected, `${name} remote tag validation: ${result.stderr}`);
  }

  // GIVEN overlapping releases; WHEN the Pages lock is acquired; THEN only the highest published stable MCP release deploys.
  const published = (tagName, options = {}) => ({ tag_name: tagName, draft: false, prerelease: false, published_at: '2026-11-18T00:00:00Z', ...options });
  for (const [name, candidate, pages, expected] of [
    ['newest qualified', 'v3.10.0', [[published('v3.9.0'), published('data-v4.0.0')], [published('v3.10.0')]], 0],
    ['delayed older artifact', 'v3.9.0', [[published('v3.9.0')], [published('v3.10.0')]], 1],
    ['unpublished candidate', 'v3.10.0', [[published('v3.9.0')]], 1],
    ['drafts and prereleases do not block', 'v3.10.0', [[published('v3.10.0'), published('v4.0.0', { draft: true }), published('v5.0.0', { prerelease: true })]], 0],
  ]) {
    const result = run(deploy.steps[0].run, { RELEASE_TAG: candidate, FIXTURE_RELEASES: pages.map((page) => JSON.stringify(page)).join('\n') });
    assert.equal(result.status, expected, `${name} Pages deploy decision: ${result.stderr}`);
  }

  // GIVEN official registry responses; WHEN publishing or retrying; THEN the exact active descriptor must be served.
  const descriptor = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8'));
  const registryUrl = `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(descriptor.name)}/versions/${version}`;
  const { homepage, categories, keywords, ...registryDescriptor } = descriptor;
  const officialMeta = 'io.modelcontextprotocol.registry/official';
  const registered = { server: registryDescriptor, _meta: { [officialMeta]: { status: 'active' } } };
  writeFileSync(join(work, 'mcp-publisher'), `#!/bin/sh
case "$*" in
  'login github-oidc') exit 0;;
  'publish server.json') printf '%s\\n' "$FIXTURE_PUBLISH_BODY"; exit "$FIXTURE_PUBLISH_RC";;
  *) exit 98;;
esac
`, { mode: 0o700 });
  writeFileSync(join(work, 'curl'), `#!/bin/sh
test "$*" = "--fail --silent --show-error --retry 3 --retry-all-errors --max-time 15 --output $RUNNER_TEMP/registry-release.json ${registryUrl}" || exit 98
printf '%s\\n' readback >> "$FIXTURE_TRACE"
test "$FIXTURE_REGISTRY" != unavailable || exit 22
printf '%s\\n' "$FIXTURE_REGISTRY" > "$RUNNER_TEMP/registry-release.json"
`, { mode: 0o700 });
  const registrySteps = release.jobs.registry.steps.slice(-2).map((step) => step.run).join('\n');
  for (const [name, response, publishBody, publishCode, expected, expectedTrace] of [
    ['new descriptor', registered, 'Published', '0', 0, 'readback\n'],
    ['matching duplicate', registered, 'cannot publish duplicate version', '1', 0, 'readback\n'],
    ['conflicting duplicate', { ...registered, server: { ...registryDescriptor, remotes: [{ type: 'streamable-http', url: 'https://example.org/mcp' }] } }, 'cannot publish duplicate version', '1', 1, 'readback\n'],
    ['registry unavailable', 'unavailable', 'cannot publish duplicate version', '1', 22, 'readback\n'],
    ['unrelated publish error', registered, 'registry unavailable', '1', 1, ''],
  ]) {
    const result = run(registrySteps, {
      FIXTURE_REGISTRY: response === 'unavailable' ? response : JSON.stringify(response),
      FIXTURE_PUBLISH_BODY: publishBody, FIXTURE_PUBLISH_RC: publishCode,
    });
    assert.equal(result.status, expected, `${name} registry exit: ${result.stderr}`);
    assert.equal(readFileSync(trace, 'utf8'), expectedTrace, `${name} exact registry readback`);
  }

  // GIVEN local and registry image identities; WHEN the release emits a receipt; THEN those exact bytes passed both catalogs.
  const image = 'ghcr.io/kochetkov-ma/brewpage-mcp';
  const tagImage = `${image}:${version}`;
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const imageId = `sha256:${'b'.repeat(64)}`;
  const differentId = `sha256:${'c'.repeat(64)}`;
  const manifest = JSON.stringify({ schemaVersion: 2, config: { digest: imageId }, layers: [] });
  const digest = `sha256:${sha256(manifest)}`;
  const pin = `${tagImage}@${digest}`;
  const index = JSON.stringify({ schemaVersion: 2, manifests: [{ digest, platform: { os: 'linux', architecture: 'amd64' } }] });
  const indexDigest = `sha256:${sha256(index)}`;
  const indexPin = `${tagImage}@${indexDigest}`;
  writeFileSync(join(work, 'docker'), `#!/bin/sh
case "$*" in
  'login ghcr.io --username fixture --password-stdin') cat >/dev/null;;
  'logout ghcr.io') exit 0;;
  'manifest inspect ${tagImage}')
    test "$FIXTURE_EXISTS" = yes || { echo 'manifest unknown' >&2; exit 1; };;
  'push ${tagImage}') printf '%s\\n' pushed >> "$FIXTURE_TRACE";;
  'buildx imagetools inspect ${tagImage} --format {{.Manifest.Digest}}') printf '%s\\n' "$FIXTURE_TAG_DIGEST";;
  "buildx imagetools inspect --raw ${image}@$FIXTURE_TAG_DIGEST") printf '%s' "$FIXTURE_MANIFEST";;
  'inspect --format {{index .RepoDigests 0}} ${tagImage}') printf '%s\\n' '${image}@${digest}';;
  'pull ${pin}'|'pull --platform linux/amd64 ${pin}') printf '%s\\n' pulled >> "$FIXTURE_TRACE";;
  'image inspect --format {{.Os}}/{{.Architecture}} ${pin}') printf '%s\\n' "$FIXTURE_PLATFORM";;
  'image inspect --format {{index .Config.Labels "org.opencontainers.image.revision"}} ${pin}') printf '%s\\n' "$FIXTURE_OCI_REVISION";;
  'image inspect --format {{index .Config.Labels "org.opencontainers.image.version"}} ${pin}') printf '%s\\n' "$FIXTURE_OCI_VERSION";;
  'image inspect --format {{.Id}} ${tagImage}') printf '%s\\n' '${imageId}';;
  'image inspect --format {{.Id}} ${pin}') printf '%s\\n' "$FIXTURE_IMAGE_ID";;
  *) echo 'Unexpected Docker invocation' >&2; exit 98;;
esac
`, { mode: 0o700 });
  writeFileSync(join(work, 'bash'), `#!/bin/sh
test "$#" = 4 && test "$1" = scripts/smoke-image.sh && test "$2" = '${pin}' && test "$3" = '${version}' || exit 98
printf 'smoked %s\\n' "$4" >> "$FIXTURE_TRACE"
test "$4" != "$FIXTURE_FAIL_CATALOG"
`, { mode: 0o700 });
  const recordImage = release.jobs.image.steps.find((step) => step.name === 'Push image to GHCR').run;
  const imageEnv = { IMAGE: image, VERSION: version, GITHUB_ACTOR: 'fixture', GHCR_TOKEN: 'fixture-token',
    FIXTURE_OCI_REVISION: sha, FIXTURE_OCI_VERSION: version, FIXTURE_IMAGE_ID: imageId,
    FIXTURE_TAG_DIGEST: digest, FIXTURE_MANIFEST: manifest, FIXTURE_PLATFORM: 'linux/amd64' };
  for (const [name, env, expected, expectedTrace] of [
    ['fresh image smoke identity', { FIXTURE_EXISTS: 'no' }, 0, 'pushed\npulled\n'],
    ['fresh pull differs from tested image', { FIXTURE_EXISTS: 'no', FIXTURE_IMAGE_ID: differentId }, 1, 'pushed\npulled\n'],
    ['existing digest retested', { FIXTURE_EXISTS: 'yes', FIXTURE_IMAGE_ID: differentId }, 0, 'pulled\nsmoked legacy\nsmoked compact\n'],
    ['existing digest fails compact smoke', { FIXTURE_EXISTS: 'yes', FIXTURE_FAIL_CATALOG: 'compact' }, 1, 'pulled\nsmoked legacy\nsmoked compact\n'],
    ['existing digest has wrong OCI version', { FIXTURE_EXISTS: 'yes', FIXTURE_OCI_VERSION: '1.0.0' }, 1, 'pulled\n'],
  ]) {
    const result = run(recordImage, { ...imageEnv, ...env });
    assert.equal(result.status, expected, `${name} image gate: ${result.stderr}`);
    assert.equal(readFileSync(trace, 'utf8'), expectedTrace, `${name} image push, pull and smoke sequence`);
    assert.equal(readFileSync(summary, 'utf8').includes(`- Pin: \`${pin}\``), expected === 0, `${name} successful image receipt`);
  }

  // GIVEN a fresh reviewed hosted observation; WHEN the publisher qualifies it; THEN the observed tuple must match the immutable candidate.
  writeFileSync(join(work, 'git'), `#!/bin/sh
case "$*" in
  "rev-parse --verify refs/tags/$FIXTURE_SELECTED_TAG^{commit}")
    test "$FIXTURE_TAG_REVISION" != missing || exit 44
    printf '%s\\n' "$FIXTURE_TAG_REVISION";;
  "merge-base --is-ancestor $FIXTURE_TAG_REVISION $GITHUB_SHA") test "$FIXTURE_REACHABLE" = yes;;
  "switch --detach $FIXTURE_TAG_REVISION") exit 0;;
  'rev-parse HEAD') printf '%s\\n' "$FIXTURE_CHECKOUT_REVISION";;
  *) exit 98;;
esac
`, { mode: 0o700 });
  const isoSeconds = (epoch) => new Date(epoch).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const receipt = { version, revision: sha, endpoint: 'https://brewpage.app/mcp', catalog: 'compact', image: pin,
    appVersion: '2.58.1', evidenceSha256: 'e'.repeat(64),
    qualification: { anonymousCreateAndUpdate: 'pass', cachedLegacyCalls: 'pass', nativeOAuthConsentAndReturn: 'pass',
      signedOwnerReadback: 'pass', invalidBearerNoWrite: 'pass', compatibleRecovery: 'pass' },
    runtime: { appBuildVersion: '2.58.1', appImage: `ghcr.io/kochetkov-ma/brewpage-app-backend@${digest}`, appVersion: '2.58.1',
      bearerForwarding: true, catalog: 'compact', deployRunAttempt: 1, deployRunId: 42, grantIssuance: true, mcpImage: pin,
      mcpImageId: imageId, mcpRevision: sha, observedAt: isoSeconds(Date.now()) },
  };
  const qualifyHosted = release.jobs.qualification.steps.find((step) => step.id === 'receipt').run;
  const mainDispatch = { GITHUB_REF: 'refs/heads/main', GITHUB_SHA: controlSha, SELECTED_TAG: tag };
  const indexEnv = { FIXTURE_TAG_DIGEST: indexDigest, FIXTURE_MANIFEST: index };
  for (const [name, changes, env, expected, expectedTrace] of [
    ['tag dispatch with classic config identity', {}, {}, 0, 'pulled\n'],
    ['main dispatch with containerd manifest identity', { runtime: { mcpImageId: digest } }, mainDispatch, 0, 'pulled\n'],
    ['main dispatch with classic config identity', {}, mainDispatch, 0, 'pulled\n'],
    ['OCI index refused even when it points to the same Linux amd64 image', { image: indexPin, runtime: { mcpImage: indexPin, mcpImageId: digest } },
      { ...mainDispatch, ...indexEnv }, 1, ''],
    ['manifest bytes differ from the immutable digest', {}, { FIXTURE_MANIFEST: '{}' }, 1, ''],
    ['main requires an explicit tag', {}, { ...mainDispatch, SELECTED_TAG: '' }, 1, ''],
    ['main refuses a ref-shaped selection', {}, { ...mainDispatch, SELECTED_TAG: 'refs/tags/v3.0.0' }, 1, ''],
    ['feature workflow refused', {}, { ...mainDispatch, GITHUB_REF: 'refs/heads/feat/release' }, 1, ''],
    ['tag dispatch cannot select another tag', {}, { SELECTED_TAG: 'v99.0.0' }, 1, ''],
    ['tag dispatch commit differs from selected tag', {}, { GITHUB_SHA: controlSha }, 1, ''],
    ['main selected tag does not exist', {}, { ...mainDispatch, FIXTURE_TAG_REVISION: 'missing' }, 1, ''],
    ['main selected tag outside control history', {}, { ...mainDispatch, FIXTURE_REACHABLE: 'no' }, 1, ''],
    ['selected revision differs from checkout', {}, { ...mainDispatch, FIXTURE_CHECKOUT_REVISION: otherSha }, 1, ''],
    ['selected tag does not match package version', {}, { ...mainDispatch, SELECTED_TAG: 'v99.0.0', FIXTURE_SELECTED_TAG: 'v99.0.0' }, 1, ''],
    ['receipt revision differs from artifact', { revision: controlSha }, mainDispatch, 1, ''],
    ['immutable OCI revision differs from artifact', {}, { ...mainDispatch, FIXTURE_OCI_REVISION: controlSha }, 1, 'pulled\n'],
    ['immutable OCI version differs from artifact', {}, { ...mainDispatch, FIXTURE_OCI_VERSION: '99.0.0' }, 1, 'pulled\n'],
    ['single image reports the wrong platform', {}, { ...mainDispatch, FIXTURE_PLATFORM: 'linux/arm64' }, 1, 'pulled\n'],
    ['stale observation', { runtime: { observedAt: isoSeconds(Date.now() - 31 * 60_000) } }, {}, 1, ''],
    ['different app version', { runtime: { appVersion: '2.58.2' } }, {}, 1, ''],
    ['different runtime MCP digest under the same version', { runtime: { mcpImage: `${tagImage}@${differentId}` } }, {}, 1, ''],
    ['different tag digest in a self-consistent receipt', { image: `${tagImage}@${differentId}`, runtime: { mcpImage: `${tagImage}@${differentId}` } }, {}, 1, ''],
    ['different MCP image ID under the reviewed pin', { runtime: { mcpImageId: differentId } }, {}, 1, ''],
    ['receipt bytes differ from checksum', {}, { HOSTED_RECEIPT_SHA256: 'f'.repeat(64) }, 1, ''],
    ['forwarding disabled', { runtime: { bearerForwarding: false } }, {}, 1, ''],
    ['issuance disabled', { runtime: { grantIssuance: false } }, {}, 1, ''],
  ]) {
    const json = JSON.stringify({ ...receipt, ...changes, runtime: { ...receipt.runtime, ...changes.runtime } });
    const result = run(qualifyHosted, {
      ...imageEnv, GITHUB_REF: `refs/tags/${tag}`, SELECTED_TAG: '', FIXTURE_SELECTED_TAG: tag,
      FIXTURE_TAG_REVISION: sha, FIXTURE_CHECKOUT_REVISION: sha, FIXTURE_REACHABLE: 'yes',
      HOSTED_RECEIPT: json, HOSTED_RECEIPT_SHA256: sha256(json), ...env,
    });
    assert.equal(result.status, expected, `${name} hosted gate: ${result.stderr}`);
    assert.equal(readFileSync(trace, 'utf8'), expectedTrace, `${name} immutable runtime readback`);
    assert.equal(readFileSync(output, 'utf8'), expected === 0 ? `tag=${tag}\nrevision=${sha}\nversion=${version}\n` : '', `${name} publication qualification`);
  }
} finally {
  rmSync(work, { force: true, recursive: true });
}
console.log('Pages release qualification passed: 7 event, 33 Actions API and 4 deployment ordering cases');
console.log('MCP release gates passed: 6 remote ref, 5 registry, 5 image and 26 hosted receipt cases');
