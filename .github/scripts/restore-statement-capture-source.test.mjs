import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { admissionSchema, source, recovery, repository, repositoryId, requestId, requestSha256, paths,
  captureWorkflow, captureBranch, validateAdmission, contextFromEnvironment, validateCaptureSource,
  codeTreeDigest, verifyCheckout, completeInventory, extractSuccessorSourceArchive,
  verifySourceZipBytes, verifyExtractedSource, verifyRestoredTree, extractedInventory, restoreCaptureSource } from './restore-statement-capture-source.mjs';
import { completeInventory as inheritedInventory, extractSuccessorSourceArchive as inheritedExtractor } from './restore-successor-statement-source.mjs';

const NOW = new Date('2026-10-11T12:05:00.000Z'), currentId = 39000000000, workflowId = 500000000;
const currentSha = 'b'.repeat(40), currentTree = 'c'.repeat(40), prefix = `repos/${repository}`;
const identity = () => ({ id: repositoryId, full_name: repository });
const hash = value => createHash('sha256').update(value).digest('hex');
const blob = value => createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex');
const admission = (changes = {}) => ({ schema_version: admissionSchema, request_id: requestId, execution_enabled: true,
  repository, repository_id: repositoryId, workflow: captureWorkflow, workflow_id: null, branch: captureBranch, event: 'push',
  expected_run_number: 1, first_attempt_only: true, request_sha256: requestSha256, runtime_lock_sha256: '1'.repeat(64),
  code_tree_sha256: '2'.repeat(64), dispatch_not_before: '2026-10-11T12:00:00.000Z', dispatch_not_after: '2026-10-11T12:30:00.000Z',
  required_valid_through: '2026-10-11T13:00:00.000Z', maximum_job_seconds: 1500, finalization_reserve_seconds: 420,
  maximum_preflight_age_seconds: 30, ...changes });
const context = (changes = {}) => ({ id: currentId, attempt: 1, run_number: 1, sha: currentSha, branch: captureBranch,
  repository, repository_id: repositoryId, event: 'push', workflow_ref: `${repository}/${captureWorkflow}@refs/heads/${captureBranch}`,
  workflow_sha: currentSha, job_started_at: '2026-10-11T12:01:03.000Z', ...changes });
const checkout = (changes = {}) => ({ sha: currentSha, tree: currentTree, parents: [source.head_sha],
  code_tree_sha256: admission().code_tree_sha256, admission_sha256: '3'.repeat(64), request_sha256: requestSha256,
  runtime_lock_sha256: admission().runtime_lock_sha256, ...changes });
const list = (key, values) => ({ total_count: values.length, [key]: values });
const historical = (expected, changes = {}) => ({ id: expected.run_id, run_attempt: expected.run_attempt,
  run_number: expected.run_number, head_sha: expected.head_sha, head_branch: expected.head_branch,
  path: expected.workflow, workflow_id: expected.workflow_id, event: 'push', repository: identity(), head_repository: identity(),
  status: expected.status, conclusion: expected.conclusion,
  created_at: expected === source ? '2026-10-10T10:16:23Z' : '2026-10-06T14:24:45Z',
  run_started_at: expected === source ? '2026-10-10T10:16:23Z' : '2026-10-06T14:24:45Z',
  updated_at: expected === source ? '2026-10-10T10:30:52Z' : '2026-10-06T14:40:11Z',
  ...(expected === source ? { head_commit: { id: source.head_sha, tree_id: source.tree_sha } } : {}), ...changes });
const currentRun = (changes = {}) => ({ id: currentId, run_attempt: 1, run_number: 1, head_sha: currentSha,
  head_branch: captureBranch, path: captureWorkflow, workflow_id: workflowId, event: 'push', repository: identity(),
  head_repository: identity(), status: 'in_progress', conclusion: null, created_at: '2026-10-11T12:01:00Z',
  run_started_at: '2026-10-11T12:01:00Z', updated_at: '2026-10-11T12:01:01Z',
  head_commit: { id: currentSha, tree_id: currentTree }, ...changes });
const sourceJob = (changes = {}) => ({ id: source.job_id, run_id: source.run_id, run_attempt: 1, head_sha: source.head_sha,
  status: 'completed', conclusion: 'success', started_at: '2026-10-10T10:16:26Z', completed_at: '2026-10-10T10:30:50Z', ...changes });
const currentJob = (changes = {}) => ({ id: 120000000000, run_id: currentId, run_attempt: 1, head_sha: currentSha,
  name: 'statement-capture', status: 'in_progress', conclusion: null, started_at: '2026-10-11T12:01:02Z', completed_at: null, ...changes });
const artifact = (changes = {}) => ({ id: source.artifact_id, name: source.artifact_name, digest: `sha256:${source.artifact_sha256}`,
  size_in_bytes: source.artifact_size_in_bytes, expired: false, created_at: '2026-10-10T10:30:30Z', expires_at: '2026-10-24T10:30:30Z',
  workflow_run: { id: source.run_id, head_sha: source.head_sha, head_branch: source.head_branch,
    repository_id: repositoryId, head_repository_id: repositoryId }, ...changes });
const endpoints = {
  repo: prefix, recoveryWorkflow: `${prefix}/actions/workflows/${recovery.workflow_id}`,
  sourceWorkflow: `${prefix}/actions/workflows/${source.workflow_id}`,
  currentWorkflow: `${prefix}/actions/workflows/financial-statement-capture.yml`,
  current: `${prefix}/actions/runs/${currentId}`, currentAttempt: `${prefix}/actions/runs/${currentId}/attempts/1`,
  currentJobs: `${prefix}/actions/runs/${currentId}/attempts/1/jobs?per_page=100`,
  ref: `${prefix}/git/ref/heads/${captureBranch}`, commit: `${prefix}/git/commits/${currentSha}`,
  sourceCommit: `${prefix}/git/commits/${source.head_sha}`, source: `${prefix}/actions/runs/${source.run_id}`,
  sourceAttempt: `${prefix}/actions/runs/${source.run_id}/attempts/1`, sourceJob: `${prefix}/actions/jobs/${source.job_id}`,
  recovery: `${prefix}/actions/runs/${recovery.run_id}`, recoveryAttempt: `${prefix}/actions/runs/${recovery.run_id}/attempts/1`,
  recoveryInventory: `${prefix}/actions/workflows/${recovery.workflow_id}/runs?per_page=100`,
  sourceInventory: `${prefix}/actions/workflows/${source.workflow_id}/runs?per_page=100`,
  currentInventory: `${prefix}/actions/workflows/${workflowId}/runs?per_page=100`,
  artifacts: `${prefix}/actions/runs/${source.run_id}/artifacts?per_page=100`,
};
function fixture(changes = {}) {
  const responses = { [endpoints.repo]: identity(),
    [endpoints.recoveryWorkflow]: { id: recovery.workflow_id, path: recovery.workflow, state: 'active' },
    [endpoints.sourceWorkflow]: { id: source.workflow_id, path: source.workflow, state: 'active' },
    [endpoints.currentWorkflow]: { id: workflowId, path: captureWorkflow, state: 'active' },
    [endpoints.current]: currentRun(), [endpoints.currentAttempt]: currentRun(), [endpoints.currentJobs]: list('jobs', [currentJob()]),
    [endpoints.ref]: { ref: `refs/heads/${captureBranch}`, object: { type: 'commit', sha: currentSha } },
    [endpoints.commit]: { sha: currentSha, tree: { sha: currentTree }, parents: [{ sha: source.head_sha }] },
    [endpoints.sourceCommit]: { sha: source.head_sha, tree: { sha: source.tree_sha } },
    [endpoints.source]: historical(source), [endpoints.sourceAttempt]: historical(source), [endpoints.sourceJob]: sourceJob(),
    [endpoints.recovery]: historical(recovery), [endpoints.recoveryAttempt]: historical(recovery),
    [endpoints.recoveryInventory]: list('workflow_runs', [historical(recovery)]),
    [endpoints.sourceInventory]: list('workflow_runs', [historical(source)]),
    [endpoints.currentInventory]: list('workflow_runs', [currentRun()]), [endpoints.artifacts]: list('artifacts', [artifact()]), ...changes };
  const calls = [];
  const api = async endpoint => { calls.push(endpoint); assert.ok(Object.hasOwn(responses, endpoint), `Unlisted offline endpoint: ${endpoint}`);
    return structuredClone(responses[endpoint]); };
  return { responses, calls, api };
}
const check = (f = fixture(), a = admission(), c = context(), options = {}) =>
  validateCaptureSource(a, c, { api: f.api, clock: () => NOW, checkout: checkout(), ...options });

// All metadata is immutable local test data; no test invokes the default gh API.
test('successful input authentication binds all three complete workflows, jobs, Git trees and exact artifact', async () => {
  const f = fixture(), result = await check(f);
  assert.equal(result.schema_version, 'financial-statement-capture-source-check-v1');
  assert.equal(result.source_admission, 'authenticated_unadmitted');
  assert.equal(result.publication_authority, 'none');
  assert.equal(result.source.id, source.run_id); assert.equal(result.source_job.id, source.job_id);
  assert.equal(result.current_job.id, currentJob().id); assert.equal(result.checked_at, NOW.toISOString());
  assert.equal(result.request_sha256, requestSha256); assert.equal(result.current_tree, currentTree);
  assert.deepEqual(result.inventory_counts, { recovery: 1, successor: 1, capture: 1, artifacts: 1, current_jobs: 1 });
  assert.equal(f.calls.length, Object.keys(endpoints).length);
  assert.ok(f.calls.filter(x => x.includes('/runs?')).every(x => /\/workflows\/\d+\/runs\?per_page=100$/.test(x)));
  assert.equal(f.calls.some(x => /event=|branch=|\/zip$/.test(x)), false);
});

test('only unchanged legacy pure inventory and safe extraction are reused', () => {
  assert.equal(completeInventory, inheritedInventory); assert.equal(extractSuccessorSourceArchive, inheritedExtractor);
  const text = readFileSync(fileURLToPath(new URL('./restore-statement-capture-source.mjs', import.meta.url)), 'utf8');
  assert.equal(/validateSuccessorSource|verifySuccessfulSuccessorSource|d127a89c/.test(text), false);
  assert.equal(/workflow_dispatch|fetch\(|https:\/\//.test(text), false);
});

test('disabled admission is offline-only, has no clocks, and performs zero API reads', async () => {
  const a = admission({ execution_enabled: false, dispatch_not_before: null, dispatch_not_after: null, required_valid_through: null });
  assert.equal(validateAdmission(a, { dryRun: true, now: NOW }), a);
  const f = fixture(); await assert.rejects(check(f, a), /disabled/); assert.equal(f.calls.length, 0);
  assert.throws(() => validateAdmission({ ...a, dispatch_not_before: admission().dispatch_not_before }, { dryRun: true }), /no selected/);
});

test('admission is closed and exact: no widened bounds, alternate request, replay, unknown field or caller clock authority', async () => {
  for (const change of [{ schema_version: 'old' }, { request_id: 'second-batch' }, { repository_id: 5 },
    { repository: 'other/repo' }, { workflow: source.workflow }, { branch: 'main' }, { event: 'workflow_dispatch' },
    { expected_run_number: 2 }, { first_attempt_only: false }, { execution_enabled: 'true' }, { workflow_id: 0 },
    { maximum_job_seconds: 1501 }, { finalization_reserve_seconds: 419 }, { maximum_preflight_age_seconds: 31 },
    { request_sha256: 'a'.repeat(64) }, { runtime_lock_sha256: 'bad' }, { code_tree_sha256: null }, { allow_resume: true }]) {
    const f = fixture(); await assert.rejects(check(f, admission(change))); assert.equal(f.calls.length, 0);
  }
  const a = admission(); delete a.request_id; await assert.rejects(check(fixture(), a), /Closed/);
});

test('actual UTC window/horizon rejects stale, future, ambiguous, impossible and overlong admission', async () => {
  for (const change of [{ dispatch_not_after: '2026-10-11T12:04:59Z' }, { dispatch_not_before: '2026-10-11T12:05:01Z' },
    { dispatch_not_before: '2026-10-11T11:00:00Z' }, { dispatch_not_before: '2026-02-30T12:00:00Z' },
    { dispatch_not_before: '2026-10-11T12:00:00+00:00' }, { required_valid_through: '2026-10-11T12:54:59Z' },
    { required_valid_through: '2026-10-15T13:00:00Z' }, { required_valid_through: '2026-10-14T12:00:01Z' }, { dispatch_not_after: null }]) await assert.rejects(check(fixture(), admission(change)));
  await assert.rejects(check(fixture(), admission(), context(), { clock: () => new Date('invalid') }), /clock/);
});

test('first-run context includes actual numeric repository, workflow ref/SHA, job clock and no replay', async () => {
  for (const change of [{ id: source.run_id }, { id: 0 }, { attempt: 2 }, { run_number: 2 }, { sha: 'bad' },
    { repository_id: 1 }, { repository: 'other/repo' }, { branch: 'main' }, { event: 'pull_request' },
    { workflow_sha: 'd'.repeat(40) }, { workflow_ref: `${repository}/${source.workflow}@refs/heads/${captureBranch}` },
    { job_started_at: undefined }]) {
    const f = fixture(); await assert.rejects(check(f, admission(), context(change))); assert.equal(f.calls.length, 0);
  }
  const c = contextFromEnvironment({ GITHUB_RUN_ID: '1e5', GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY_ID: '2x' });
  assert.ok(Number.isNaN(c.id)); assert.ok(Number.isNaN(c.repository_id)); assert.equal(c.attempt, 1);
});

test('whole checkout binding must be supplied before any metadata request', async () => {
  for (const change of [undefined, null, {}, checkout({ sha: 'd'.repeat(40) }), checkout({ tree: 'bad' }),
    checkout({ parents: ['d'.repeat(40)] }), checkout({ parents: [source.head_sha, 'd'.repeat(40)] }),
    checkout({ code_tree_sha256: '9'.repeat(64) }), checkout({ runtime_lock_sha256: '9'.repeat(64) }),
    checkout({ request_sha256: '9'.repeat(64) })]) {
    const f = fixture(); await assert.rejects(check(f, admission(), context(), { checkout: change })); assert.equal(f.calls.length, 0);
  }
});

test('repository and exact numeric workflow paths are authenticated', async () => {
  for (const [endpoint, row] of [[endpoints.repo, { ...identity(), id: 1 }],
    [endpoints.recoveryWorkflow, { id: recovery.workflow_id, path: source.workflow, state: 'active' }],
    [endpoints.sourceWorkflow, { id: source.workflow_id + 1, path: source.workflow, state: 'active' }],
    [endpoints.currentWorkflow, { id: workflowId, path: captureWorkflow, state: 'disabled_manually' }],
    [endpoints.currentWorkflow, { id: source.workflow_id, path: captureWorkflow, state: 'active' }]]) {
    await assert.rejects(check(fixture({ [endpoint]: row })));
  }
  await assert.rejects(check(fixture(), admission({ workflow_id: workflowId + 1 })), /Workflow/);
});

test('current endpoints and inventory reject changed SHA/tree, completed/foreign/replayed/future runs', async () => {
  for (const endpoint of [endpoints.current, endpoints.currentAttempt, endpoints.currentInventory]) {
    for (const change of [{ run_attempt: 2 }, { run_number: 2 }, { head_sha: 'd'.repeat(40) }, { head_branch: 'main' },
      { path: source.workflow }, { workflow_id: 5 }, { status: 'completed', conclusion: 'success' },
      { repository: { ...identity(), id: 1 } }, { head_repository: { ...identity(), id: 1 } },
      { head_commit: { id: currentSha, tree_id: 'd'.repeat(40) } }, { created_at: '2026-10-11T11:59:59Z' },
      { updated_at: '2026-10-11T12:05:01Z' }, { run_started_at: '2026-10-11T12:05:01Z' }]) {
      const row = currentRun(change); await assert.rejects(check(fixture({ [endpoint]: endpoint === endpoints.currentInventory ? list('workflow_runs', [row]) : row })));
    }
  }
});

test('live branch, hosted current tree and sole producer parent must equal the verified checkout', async () => {
  for (const row of [{ ref: `refs/heads/${captureBranch}`, object: { type: 'commit', sha: 'd'.repeat(40) } },
    { ref: 'refs/heads/main', object: { type: 'commit', sha: currentSha } }]) await assert.rejects(check(fixture({ [endpoints.ref]: row })), /branch/);
  for (const change of [{ sha: 'd'.repeat(40) }, { tree: { sha: 'd'.repeat(40) } }, { parents: [] },
    { parents: [{ sha: source.head_sha }, { sha: 'd'.repeat(40) }] }]) {
    await assert.rejects(check(fixture({ [endpoints.commit]: { ...fixture().responses[endpoints.commit], ...change } })), /Hosted/);
  }
  await assert.rejects(check(fixture({ [endpoints.sourceCommit]: { sha: source.head_sha, tree: { sha: 'd'.repeat(40) } } })), /source commit/);
});

test('successful source and recovery predecessor are exact unchanged attempt-one identities', async () => {
  for (const [endpoint, expected, isInventory] of [[endpoints.source, source], [endpoints.sourceAttempt, source],
    [endpoints.sourceInventory, source, true], [endpoints.recovery, recovery], [endpoints.recoveryAttempt, recovery],
    [endpoints.recoveryInventory, recovery, true]]) {
    for (const change of [{ id: expected.run_id - 1 }, { run_attempt: 2 }, { run_number: expected.run_number + 1 },
      { head_sha: 'd'.repeat(40) }, { head_branch: 'main' }, { event: 'workflow_dispatch' },
      { status: 'in_progress' }, { conclusion: 'cancelled' }, { repository: { ...identity(), id: 1 } },
      { updated_at: '2026-10-11T12:05:01Z' }, { run_started_at: '2026-10-11T12:05:01Z' }]) {
      const row = historical(expected, change);
      await assert.rejects(check(fixture({ [endpoint]: isInventory ? list('workflow_runs', [row]) : row })));
    }
  }
});

test('successful source job is individually bound and chronologically inside its successful attempt', async () => {
  for (const change of [{ id: 1 }, { run_id: 1 }, { run_attempt: 2 }, { head_sha: 'd'.repeat(40) },
    { status: 'queued' }, { conclusion: 'failure' }, { started_at: '2026-10-10T10:16:22Z' },
    { completed_at: '2026-10-10T10:30:53Z' }, { completed_at: '2026-10-10T10:16:25Z' }]) {
    await assert.rejects(check(fixture({ [endpoints.sourceJob]: sourceJob(change) })));
  }
});

test('current job has exact name/run/attempt/head and authenticated whole-job start, with 420-second reserve', async () => {
  for (const change of [{ name: 'other' }, { id: 0 }, { run_id: 1 }, { run_attempt: 2 }, { head_sha: 'd'.repeat(40) },
    { status: 'completed' }, { conclusion: 'success' }, { completed_at: NOW.toISOString() },
    { started_at: '2026-10-11T12:01:04Z' }, { started_at: '2026-10-11T12:00:00Z' }]) {
    await assert.rejects(check(fixture({ [endpoints.currentJobs]: list('jobs', [currentJob(change)]) })));
  }
  for (const first of ['2026-10-11T12:01:01Z', '2026-10-11T12:02:03Z', '2026-10-11T12:06:00Z']) {
    await assert.rejects(check(fixture(), admission(), context({ job_started_at: first })), /job|clock/);
  }
  await assert.rejects(check(fixture(), admission(), context(), { clock: () => new Date('2026-10-11T12:19:02Z') }), /allowance/);
});

test('recovery inventory rejects every concurrency state, newer work, late old reruns and absent predecessor', async () => {
  const older = historical(recovery, { id: recovery.run_id - 1, run_number: 3 });
  const valid = await check(fixture({ [endpoints.recoveryInventory]: list('workflow_runs', [historical(recovery), older]) }));
  assert.equal(valid.inventory_counts.recovery, 2);
  for (const status of ['in_progress', 'queued', 'waiting', 'pending', 'requested', 'unknown']) {
    await assert.rejects(check(fixture({ [endpoints.recoveryInventory]: list('workflow_runs', [historical(recovery), { ...older, status }]) })), /Concurrent|nonterminal/);
  }
  for (const row of [{ ...older, id: recovery.run_id + 1 }, { ...older, run_number: 4 },
    { ...older, updated_at: '2026-10-10T10:30:51Z' }, { ...older, updated_at: '2026-10-11T12:05:01Z' }]) {
    await assert.rejects(check(fixture({ [endpoints.recoveryInventory]: list('workflow_runs', [historical(recovery), row]) })));
  }
  await assert.rejects(check(fixture({ [endpoints.recoveryInventory]: list('workflow_runs', [older]) })), /absent/);
});

test('successor and capture inventories permit exactly their expected first run and no unknown newer work', async () => {
  for (const [endpoint, row] of [[endpoints.sourceInventory, historical(source)], [endpoints.currentInventory, currentRun()]]) {
    for (const rows of [[], [{ ...row, id: row.id - 1 }], [row, { ...row, id: row.id + 1, status: 'queued' }],
      [row, { ...row, id: row.id - 1, status: 'completed', conclusion: 'failure' }]]) {
      await assert.rejects(check(fixture({ [endpoint]: list('workflow_runs', rows) })), /Prior|missing|newer|concurrent/);
    }
  }
});

test('all inventories are exact unfiltered bounded totals and unique numeric IDs', async () => {
  for (const [endpoint, key, row] of [[endpoints.recoveryInventory, 'workflow_runs', historical(recovery)],
    [endpoints.sourceInventory, 'workflow_runs', historical(source)], [endpoints.currentInventory, 'workflow_runs', currentRun()],
    [endpoints.currentJobs, 'jobs', currentJob()], [endpoints.artifacts, 'artifacts', artifact()]]) {
    for (const total_count of [undefined, -1, 0, 2, 101, '1']) {
      await assert.rejects(check(fixture({ [endpoint]: { total_count, [key]: [row] } })), /Incomplete|oversized/);
    }
    await assert.rejects(check(fixture({ [endpoint]: list(key, [row, row]) })), /duplicate/);
    await assert.rejects(check(fixture({ [endpoint]: list(key, [{ ...row, id: '1' }]) })), /identity/);
  }
});

test('exact artifact cannot be ambiguous, expired, retargeted, resized or outside original source interval', async () => {
  for (const change of [{ id: source.artifact_id + 1 }, { name: 'other' }, { expired: true },
    { digest: `sha256:${'d'.repeat(64)}` }, { size_in_bytes: source.artifact_size_in_bytes - 1 },
    { workflow_run: { ...artifact().workflow_run, id: currentId } },
    { workflow_run: { ...artifact().workflow_run, repository_id: 1 } },
    { created_at: '2026-10-10T10:16:22Z' }, { created_at: '2026-10-10T10:30:53Z' },
    { expires_at: NOW.toISOString() }]) {
    await assert.rejects(check(fixture({ [endpoints.artifacts]: list('artifacts', [artifact(change)]) })));
  }
  for (const rows of [[], [artifact(), artifact({ id: source.artifact_id + 1 })]]) {
    await assert.rejects(check(fixture({ [endpoints.artifacts]: list('artifacts', rows) })), /Missing|ambiguous/);
  }
});

test('metadata older than 30 seconds, backwards time and window expiry during await fail closed', async () => {
  for (const offset of [30001, -1]) {
    let instant = NOW.getTime(); const f = fixture();
    const api = async endpoint => { const value = await f.api(endpoint); instant += offset; return value; };
    await assert.rejects(validateCaptureSource(admission(), context(), { api, checkout: checkout(), clock: () => new Date(instant) }), /stale|backwards/);
  }
  let instant = Date.parse('2026-10-11T12:29:50Z'); const f = fixture();
  const api = async endpoint => { const value = await f.api(endpoint); instant += 11000; return value; };
  await assert.rejects(validateCaptureSource(admission(), context(), { api, checkout: checkout(), clock: () => new Date(instant) }), /window/);
});

test('input/context mutation during an awaited API response is rejected before subsequent reads', async () => {
  for (const field of ['admission', 'context', 'checkout']) {
    const a = admission(), c = context(), k = checkout(), f = fixture();
    const api = async endpoint => { const value = await f.api(endpoint); await Promise.resolve();
      if (field === 'admission') a.execution_enabled = false;
      if (field === 'context') c.attempt = 2;
      if (field === 'checkout') k.tree = 'd'.repeat(40);
      return value; };
    await assert.rejects(validateCaptureSource(a, c, { api, checkout: k, clock: () => NOW }), /changed across/);
    assert.equal(f.calls.length, 1);
  }
});

test('post-await checkout revalidation and its full elapsed time are charged before check-only success', async () => {
  await assert.rejects(check(fixture(), admission(), context(), { revalidate: async () => checkout({ admission_sha256: '9'.repeat(64) }) }), /changed during/);
  let instant = NOW.getTime();
  await assert.rejects(check(fixture(), admission(), context(), { clock: () => new Date(instant), revalidate: async () => {
    instant += 30001; return checkout(); } }), /stale/);
  const a = admission();
  await assert.rejects(check(fixture(), a, context(), { revalidate: async () => { a.runtime_lock_sha256 = '9'.repeat(64); return checkout(); } }), /changed across/);
});

function checkoutFixture() {
  const root = mkdtempSync(join(tmpdir(), 'capture-checkout-'));
  const runtime = [paths.request, captureWorkflow, '.github/scripts/run-statement-capture.py', '.github/scripts/restore-statement-capture-source.mjs',
    '.github/scripts/verify-statement-capture-artifact.py', '.github/scripts/restore-successor-statement-source.mjs', '.github/scripts/restore-statement-source.mjs',
    '.github/scripts/verify-successor-artifact.py', '.github/scripts/statement-capture-transport.py',
    '.github/financial-statement-capture/transport-lock.json'];
  const files = new Map(runtime.map(path => [path, Buffer.from(`fixture ${path}\n`)]));
  files.set(paths.request, readFileSync(fileURLToPath(new URL('../financial-statement-capture/request.json', import.meta.url))));
  const lock = { schema_version: 'financial-statement-capture-runtime-lock-v1', python: '3.11',
    versions: { yfinance: '0.2.66', curl_cffi: '0.16.3', pandas: '2.2.0', numpy: '1.26.3', requests: '2.31.0' },
    files: Object.fromEntries([...files].map(([path, bytes]) => [path, hash(bytes)])) };
  const lockBytes = Buffer.from(JSON.stringify(lock)); files.set(paths.lock, lockBytes);
  const a = admission({ runtime_lock_sha256: hash(lockBytes) }); files.set(paths.admission, Buffer.from(JSON.stringify(a)));
  let records = [...files].map(([path, bytes]) => [path, '100644', blob(bytes)]);
  a.code_tree_sha256 = codeTreeDigest(records); files.set(paths.admission, Buffer.from(JSON.stringify(a)));
  records = [...files].map(([path, bytes]) => [path, '100644', blob(bytes)]);
  for (const [path, bytes] of files) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes, { mode: 0o644 }); }
  const answers = { 'rev-parse --verify HEAD': currentSha, 'rev-parse --verify HEAD^{tree}': currentTree,
    'show --format=%P --no-patch HEAD': source.head_sha,
    'ls-tree -rz --full-tree HEAD': records.map(([path, mode, sha]) => `${mode} blob ${sha}\t${path}\0`).join('') };
  const git = args => { assert.ok(Object.hasOwn(answers, args.join(' '))); return answers[args.join(' ')]; };
  return { root, a, records, files, git, answers, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('code tree identity has canonical ordering, excludes only admission and includes runtime lock', () => {
  const records = [[paths.request, '100644', 'a'.repeat(40)], [paths.admission, '100644', 'b'.repeat(40)], [paths.lock, '100644', 'c'.repeat(40)]];
  assert.equal(codeTreeDigest(records), codeTreeDigest([...records].reverse()));
  assert.equal(codeTreeDigest(records), codeTreeDigest(records.map(x => x[0] === paths.admission ? [x[0], x[1], 'd'.repeat(40)] : x)));
  assert.notEqual(codeTreeDigest(records), codeTreeDigest(records.map(x => x[0] === paths.lock ? [x[0], x[1], 'd'.repeat(40)] : x)));
  for (const row of [['../bad', '100644', 'a'.repeat(40)], ['safe', '120000', 'a'.repeat(40)], ['safe', '100644', 'bad']]) {
    assert.throws(() => codeTreeDigest([...records, row]), /Malformed/);
  }
  assert.throws(() => codeTreeDigest([...records, records[0]]), /duplicate/);
});

test('checkout verifier compares every committed byte/mode and all pinned control digests', () => {
  const f = checkoutFixture();
  try {
    const result = verifyCheckout(f.root, f.a, context(), { git: f.git });
    assert.equal(result.code_tree_sha256, f.a.code_tree_sha256); assert.equal(result.request_sha256, requestSha256);
    const path = join(f.root, '.github/scripts/run-statement-capture.py');
    chmodSync(path, 0o755); assert.throws(() => verifyCheckout(f.root, f.a, context(), { git: f.git }), /mode/);
    chmodSync(path, 0o644); writeFileSync(path, 'changed');
    assert.throws(() => verifyCheckout(f.root, f.a, context(), { git: f.git }), /committed bytes/);
  } finally { f.cleanup(); }
});

test('checkout rejects admission mutation, hidden input symlinks, unreviewed parent and incomplete ls-tree', () => {
  for (const action of ['admission', 'symlink', 'parent', 'listing']) {
    const f = checkoutFixture();
    try {
      if (action === 'admission') writeFileSync(join(f.root, paths.admission), JSON.stringify({ ...f.a, execution_enabled: false }));
      if (action === 'symlink') { const path = join(f.root, '.github/scripts/run-statement-capture.py'); rmSync(path); symlinkSync('/dev/null', path); }
      if (action === 'parent') f.answers['show --format=%P --no-patch HEAD'] = 'd'.repeat(40);
      if (action === 'listing') f.answers['ls-tree -rz --full-tree HEAD'] = f.answers['ls-tree -rz --full-tree HEAD'].slice(0, -1);
      assert.throws(() => verifyCheckout(f.root, f.a, context(), { git: f.git }));
    } finally { f.cleanup(); }
  }
});

test('safe inherited extraction admits only the exact empty hidden archive lock', () => {
  const root = mkdtempSync(join(tmpdir(), 'capture-extract-'));
  try {
    for (const [index, name, value] of [[0, 'archive/.archive.lock', ''], [1, 'archive/.archive.lock', 'bad'],
      [2, '.secret', ''], [3, '../outside', ''], [4, 'archive/.hidden/file', '']]) {
      const zip = join(root, `${index}.zip`), out = join(root, `out-${index}`);
      execFileSync('python3', ['-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:z.writestr(sys.argv[2],sys.argv[3])', zip, name, value]);
      if (index === 0) { extractSuccessorSourceArchive(zip, out); assert.equal(readFileSync(join(out, name)).length, 0); }
      else assert.throws(() => extractSuccessorSourceArchive(zip, out));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('restoration rejects missing check before output/download, and wrong source ZIP before extraction', async () => {
  const root = mkdtempSync(join(tmpdir(), 'capture-restore-')); let downloads = 0;
  try {
    await assert.rejects(restoreCaptureSource({}, join(root, 'none'), { download: () => { downloads++; } }), /Missing/);
    assert.equal(downloads, 0); assert.equal(existsSync(join(root, 'none')), false);
    const verified = await check();
    await assert.rejects(restoreCaptureSource(verified, join(root, 'wrong'), { clock: () => NOW, recheck: async () => verified, download: (id, fd) => {
      downloads++; assert.equal(id, source.artifact_id); writeSync(fd, Buffer.from('wrong zip')); } }), /ZIP bytes/);
    assert.equal(downloads, 1); assert.equal(existsSync(join(root, 'wrong', 'files')), false);
    const zip = join(root, 'same-size.zip'); writeFileSync(zip, Buffer.alloc(source.artifact_size_in_bytes));
    assert.throws(() => verifySourceZipBytes(zip), /exact reviewed/);
    assert.throws(() => verifyExtractedSource(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fixed-path CLI rejects alternate inputs and disabled candidate before any possible gh read', () => {
  const root = mkdtempSync(join(tmpdir(), 'capture-cli-'));
  try {
    const scripts = join(root, '.github/scripts'); mkdirSync(scripts, { recursive: true });
    for (const name of ['restore-statement-capture-source.mjs', 'restore-successor-statement-source.mjs', 'restore-statement-source.mjs',
      'publication-gate.mjs', 'publication-state.mjs', 'approved-ui-bootstrap.json', 'price-observations.mjs']) {
      writeFileSync(join(scripts, name), readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url))));
    }
    mkdirSync(dirname(join(root, paths.admission)), { recursive: true });
    writeFileSync(join(root, paths.admission), JSON.stringify(admission({ execution_enabled: false,
      dispatch_not_before: null, dispatch_not_after: null, required_valid_through: null })));
    const script = join(scripts, 'restore-statement-capture-source.mjs');
    const gh = join(root, 'gh'), marker = join(root, 'called');
    writeFileSync(gh, `#!/bin/sh\necho called > '${marker}'\nexit 99\n`, { mode: 0o755 });
    for (const args of [['--admission', 'elsewhere'], ['--check-only', '--output', 'x'], ['--check-only'], ['--output', join(root, 'out')]]) {
      let failure;
      try { execFileSync(process.execPath, [script, ...args], { env: { ...process.env, PATH: root }, stdio: 'pipe' }); }
      catch (error) { failure = error; }
      assert.ok(failure); assert.match(String(failure.stderr), /Usage:|disabled/); assert.equal(existsSync(marker), false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// These lifecycle fixtures replace only byte preparation/comparison, while the
// separately tested production functions retain their immutable source pins.
// No CLI option or environment variable exposes these injected test functions.
async function restorationFixture() {
  const root = mkdtempSync(join(tmpdir(), 'capture-restore-boundary-')), output = join(root, 'restored');
  const a = admission(), initial = await check();
  let instant = NOW.getTime(), intact = true, expected, rechecks = 0;
  const options = {
    clock: () => new Date(instant),
    download: async (id, fd, budget) => {
      assert.equal(id, source.artifact_id); assert.ok(budget.timeoutMilliseconds > 0 && budget.timeoutMilliseconds <= 120000);
      writeSync(fd, Buffer.from('synthetic archive')); await Promise.resolve();
    },
    assertReady: () => {
      assert.ok(intact, 'Control input changed after download'); validateAdmission(a, { now: new Date(instant) });
      assert.ok(instant - Date.parse(initial.current_job.started_at) < 1080000, 'Whole job allowance consumed');
    },
    prepare: (_zip, files) => {
      mkdirSync(join(files, 'archive'), { recursive: true });
      writeFileSync(join(files, 'base.json'), 'original base');
      writeFileSync(join(files, 'archive', 'receipt.json'), 'original receipt');
      writeFileSync(join(files, 'archive', '.archive.lock'), '');
      expected = extractedInventory(files);
    },
    recheck: async () => { rechecks++; return check(fixture(), a, context(), { clock: () => new Date(instant) }); },
    verify: (zip, files, budget) => {
      assert.ok(budget.timeoutMilliseconds > 0 && budget.timeoutMilliseconds <= 30000);
      assert.deepEqual(extractedInventory(files), expected, 'Extracted bytes changed during fresh metadata');
      return { inventory_sha256: hash(Buffer.from(JSON.stringify(expected))), zip_sha256: hash(readFileSync(zip)) };
    },
  };
  return { root, output, a, initial, options, now: () => instant, advance: delta => { instant += delta; },
    changeControl: () => { intact = false; }, rechecks: () => rechecks,
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('restore refreshes complete metadata after a slow download instead of reusing stale initial proof', async () => {
  const f = await restorationFixture();
  try {
    const original = f.options.download;
    f.options.download = async (...args) => { await original(...args); f.advance(45000); };
    const result = await restoreCaptureSource(f.initial, f.output, f.options);
    assert.equal(result.source_admission, 'authenticated_unadmitted'); assert.equal(f.rechecks(), 1);
    const retained = JSON.parse(readFileSync(join(f.output, 'source-check.json')));
    assert.equal(retained.checked_at, new Date(f.now()).toISOString());
    assert.notEqual(retained.checked_at, f.initial.checked_at);
    assert.ok(existsSync(join(f.output, 'restored.json')));
  } finally { f.cleanup(); }
});

test('download expiry, whole-job exhaustion, backwards clock and changed control inputs leave no success marker', async () => {
  for (const variant of ['window', 'job', 'backwards', 'control']) {
    const f = await restorationFixture();
    try {
      const original = f.options.download;
      f.options.download = async (...args) => { await original(...args);
        if (variant === 'window') f.advance(30 * 60000);
        if (variant === 'job') f.advance(Date.parse('2026-10-11T12:19:02Z') - f.now());
        if (variant === 'backwards') f.advance(-1);
        if (variant === 'control') f.changeControl();
      };
      await assert.rejects(restoreCaptureSource(f.initial, f.output, f.options), /window|allowance|backwards|Control/);
      assert.equal(f.rechecks(), 0); assert.equal(existsSync(join(f.output, 'restored.json')), false);
    } finally { f.cleanup(); }
  }
});

test('postrestore metadata must be fresh, start after extraction and bind exactly the original code and controls', async () => {
  for (const variant of ['stale', 'predates', 'binding', 'job-binding']) {
    const f = await restorationFixture();
    try {
      const originalDownload = f.options.download, originalCheck = f.options.recheck;
      f.options.download = async (...args) => { await originalDownload(...args); f.advance(variant === 'stale' ? 45000 : 1000); };
      f.options.recheck = async () => {
        if (variant === 'stale') return f.initial;
        const fresh = await originalCheck();
        if (variant === 'predates') fresh.metadata_started_at = new Date(f.now() - 1).toISOString();
        if (variant === 'binding') fresh.runtime_lock_sha256 = '9'.repeat(64);
        if (variant === 'job-binding') fresh.current_job.id += 1;
        return fresh;
      };
      await assert.rejects(restoreCaptureSource(f.initial, f.output, f.options), /stale|predates|inputs changed/);
      assert.equal(existsSync(join(f.output, 'restored.json')), false);
    } finally { f.cleanup(); }
  }
});

test('extracted receipt mutation and extra empty directories during fresh metadata cannot yield restore success', async () => {
  for (const variant of ['receipt', 'empty-directory']) {
    const f = await restorationFixture();
    try {
      const original = f.options.recheck;
      f.options.recheck = async () => {
        const proof = await original();
        if (variant === 'receipt') writeFileSync(join(f.output, 'files/archive/receipt.json'), 'mutated receipt');
        else mkdirSync(join(f.output, 'files', 'unowned'));
        return proof;
      };
      await assert.rejects(restoreCaptureSource(f.initial, f.output, f.options), /changed during|empty extracted/);
      assert.equal(existsSync(join(f.output, 'restored.json')), false);
    } finally { f.cleanup(); }
  }
});

test('comparison time is charged and a now-stale final proof produces no success provenance', async () => {
  const f = await restorationFixture();
  try {
    const original = f.options.verify;
    f.options.verify = (...args) => { const result = original(...args); f.advance(30001); return result; };
    await assert.rejects(restoreCaptureSource(f.initial, f.output, f.options), /stale/);
    assert.equal(existsSync(join(f.output, 'restored.json')), false);
  } finally { f.cleanup(); }
});

test('last-boundary receipt or ZIP replacement is revalidated and a written success marker is removed', async () => {
  for (const variant of ['receipt', 'zip']) {
    const f = await restorationFixture();
    try {
      const original = f.options.assertReady;
      f.options.assertReady = () => {
        original();
        if (existsSync(join(f.output, 'restored.json'))) {
          writeFileSync(join(f.output, variant === 'zip' ? 'source.zip' : 'files/archive/receipt.json'), 'changed at final boundary');
        }
      };
      await assert.rejects(restoreCaptureSource(f.initial, f.output, f.options), /output changed/);
      assert.equal(existsSync(join(f.output, 'restored.json')), false);
    } finally { f.cleanup(); }
  }
});

test('extracted inventory rejects linked roots/members and byte comparator timeout cannot be broadened', () => {
  const root = mkdtempSync(join(tmpdir(), 'capture-inventory-'));
  try {
    mkdirSync(join(root, 'files')); writeFileSync(join(root, 'files', 'one'), 'source');
    const first = extractedInventory(join(root, 'files'));
    assert.deepEqual(first.files.one, { bytes: 6, sha256: hash(Buffer.from('source')) });
    symlinkSync(join(root, 'files', 'one'), join(root, 'files', 'linked'));
    assert.throws(() => extractedInventory(join(root, 'files')));
    symlinkSync(join(root, 'files'), join(root, 'alias'));
    assert.throws(() => extractedInventory(join(root, 'alias')), /Unsafe/);
    for (const timeoutMilliseconds of [0, -1, 30001, 1.5, '30']) {
      assert.throws(() => verifyRestoredTree('unused', 'unused', { timeoutMilliseconds }), /timeout/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('both final metadata files are checked after the last callback and changed owned bytes are invalidated', async () => {
  for (const target of ['restored.json', 'source-check.json']) {
    const f = await restorationFixture();
    try {
      const previous = f.options.assertReady;
      f.options.assertReady = () => {
        previous();
        if (existsSync(join(f.output, 'restored.json'))) writeFileSync(join(f.output, target), 'mutated final metadata');
      };
      await assert.rejects(restoreCaptureSource(f.initial, f.output, f.options), /metadata bytes or identity changed/);
      assert.equal(existsSync(join(f.output, 'restored.json')), false);
      assert.equal(existsSync(join(f.output, 'source-check.json')), false);
    } finally { f.cleanup(); }
  }
});

test('metadata inode replacement is rejected even with identical bytes; cleanup invalidates detached owned bytes only', async () => {
  for (const target of ['restored.json', 'source-check.json']) {
    const f = await restorationFixture();
    try {
      const previous = f.options.assertReady, moved = join(f.root, `detached-${target}`);
      let replacement;
      f.options.assertReady = () => {
        previous();
        if (existsSync(join(f.output, 'restored.json'))) {
          const path = join(f.output, target); replacement = readFileSync(path);
          renameSync(path, moved); writeFileSync(path, replacement);
        }
      };
      await assert.rejects(restoreCaptureSource(f.initial, f.output, f.options), /metadata bytes or identity changed/);
      assert.equal(readFileSync(moved).length, 0, 'Owned renamed inode must not retain detached success bytes');
      assert.deepEqual(readFileSync(join(f.output, target)), replacement, 'Unrelated replacement inode must be preserved');
      const other = target === 'restored.json' ? 'source-check.json' : 'restored.json';
      assert.equal(existsSync(join(f.output, other)), false);
    } finally { f.cleanup(); }
  }
});

test('marker hard-link expansion is rejected and all links to owned success bytes are invalidated', async () => {
  const f = await restorationFixture();
  try {
    const previous = f.options.assertReady, link = join(f.root, 'detached-marker-link');
    f.options.assertReady = () => {
      previous();
      if (existsSync(join(f.output, 'restored.json'))) linkSync(join(f.output, 'restored.json'), link);
    };
    await assert.rejects(restoreCaptureSource(f.initial, f.output, f.options), /regular file|identity changed/);
    assert.equal(readFileSync(link).length, 0);
    assert.equal(existsSync(join(f.output, 'restored.json')), false);
  } finally { f.cleanup(); }
});

test('detached output directory is rejected, owned original markers are invalidated and replacement directory is preserved', async () => {
  const f = await restorationFixture();
  try {
    const previous = f.options.assertReady, detached = join(f.root, 'detached-output');
    f.options.assertReady = () => {
      previous();
      if (existsSync(join(f.output, 'restored.json'))) {
        renameSync(f.output, detached); mkdirSync(f.output);
        writeFileSync(join(f.output, 'restored.json'), 'unrelated replacement marker');
        writeFileSync(join(f.output, 'source-check.json'), 'unrelated replacement check');
      }
    };
    await assert.rejects(restoreCaptureSource(f.initial, f.output, f.options), /directory was replaced or detached/);
    assert.equal(existsSync(join(detached, 'restored.json')), false);
    assert.equal(existsSync(join(detached, 'source-check.json')), false);
    assert.equal(readFileSync(join(f.output, 'restored.json'), 'utf8'), 'unrelated replacement marker');
    assert.equal(readFileSync(join(f.output, 'source-check.json'), 'utf8'), 'unrelated replacement check');
  } finally { f.cleanup(); }
});

test('byte-identical replacement of the extracted directory still fails the owned output boundary', async () => {
  const f = await restorationFixture();
  try {
    const previous = f.options.assertReady, moved = join(f.root, 'detached-files');
    f.options.assertReady = () => {
      previous();
      if (existsSync(join(f.output, 'restored.json'))) {
        renameSync(join(f.output, 'files'), moved); cpSync(moved, join(f.output, 'files'), { recursive: true });
      }
    };
    await assert.rejects(restoreCaptureSource(f.initial, f.output, f.options), /directory was replaced or detached/);
    assert.equal(existsSync(join(f.output, 'restored.json')), false);
    assert.equal(existsSync(join(f.output, 'source-check.json')), false);
  } finally { f.cleanup(); }
});
