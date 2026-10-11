import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { admissionSchema, source, recovery, failedCapture, repository, repositoryId, requestId, requestSha256, paths,
  captureWorkflow, captureBranch, validateAdmission, contextFromEnvironment, validateCaptureSource,
  codeTreeDigest, verifyCheckout, completeInventory, extractSuccessorSourceArchive,
  verifySourceZipBytes, verifyExtractedSource, verifyRestoredTree, extractedInventory, restoreCaptureSource } from './restore-statement-capture-source.mjs';
import { completeInventory as inheritedInventory, extractSuccessorSourceArchive as inheritedExtractor } from './restore-successor-statement-source.mjs';

const NOW = new Date('2026-10-11T13:05:00.000Z'), currentId = 39000000000, workflowId = failedCapture.workflow_id;
const currentSha = 'b'.repeat(40), currentTree = 'c'.repeat(40), prefix = `repos/${repository}`;
const identity = () => ({ id: repositoryId, full_name: repository });
const hash = value => createHash('sha256').update(value).digest('hex');
const blob = value => createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex');
const admission = (changes = {}) => ({ schema_version: admissionSchema, request_id: requestId, execution_enabled: true,
  repository, repository_id: repositoryId, workflow: captureWorkflow, workflow_id: workflowId, branch: captureBranch, event: 'push',
  expected_run_number: 2, first_attempt_only: true, request_sha256: requestSha256, runtime_lock_sha256: '1'.repeat(64),
  code_tree_sha256: '2'.repeat(64), dispatch_not_before: '2026-10-11T13:00:00.000Z', dispatch_not_after: '2026-10-11T13:30:00.000Z',
  required_valid_through: '2026-10-11T14:00:00.000Z', maximum_job_seconds: 1500, finalization_reserve_seconds: 420,
  maximum_preflight_age_seconds: 30, expected_parent_sha: failedCapture.head_sha, recovery: { ...failedCapture }, ...changes });
const context = (changes = {}) => ({ id: currentId, attempt: 1, run_number: 2, sha: currentSha, branch: captureBranch,
  repository, repository_id: repositoryId, event: 'push', workflow_ref: `${repository}/${captureWorkflow}@refs/heads/${captureBranch}`,
  workflow_sha: currentSha, job_started_at: '2026-10-11T13:01:03.000Z', ...changes });
const checkout = (changes = {}) => ({ sha: currentSha, tree: currentTree, parents: [failedCapture.head_sha],
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
const currentRun = (changes = {}) => ({ id: currentId, run_attempt: 1, run_number: 2, head_sha: currentSha,
  head_branch: captureBranch, path: captureWorkflow, workflow_id: workflowId, event: 'push', repository: identity(),
  head_repository: identity(), status: 'in_progress', conclusion: null, created_at: '2026-10-11T13:01:00Z',
  run_started_at: '2026-10-11T13:01:00Z', updated_at: '2026-10-11T13:01:01Z',
  head_commit: { id: currentSha, tree_id: currentTree }, ...changes });
const sourceJob = (changes = {}) => ({ id: source.job_id, run_id: source.run_id, run_attempt: 1, head_sha: source.head_sha,
  status: 'completed', conclusion: 'success', started_at: '2026-10-10T10:16:26Z', completed_at: '2026-10-10T10:30:50Z', ...changes });
const currentJob = (changes = {}) => ({ id: 120000000000, run_id: currentId, run_attempt: 1, head_sha: currentSha,
  name: 'statement-capture', status: 'in_progress', conclusion: null, started_at: '2026-10-11T13:01:02Z', completed_at: null, ...changes });
const artifact = (changes = {}) => ({ id: source.artifact_id, name: source.artifact_name, digest: `sha256:${source.artifact_sha256}`,
  size_in_bytes: source.artifact_size_in_bytes, expired: false, created_at: '2026-10-10T10:30:30Z', expires_at: '2026-10-24T10:30:30Z',
  workflow_run: { id: source.run_id, head_sha: source.head_sha, head_branch: source.head_branch,
    repository_id: repositoryId, head_repository_id: repositoryId }, ...changes });
const failedSteps = [
  {
    "name": "Set up job",
    "status": "completed",
    "conclusion": "success",
    "number": 1,
    "started_at": "2026-10-11T12:52:14Z",
    "completed_at": "2026-10-11T12:52:16Z"
  },
  {
    "name": "Start the actual bounded job clock",
    "status": "completed",
    "conclusion": "success",
    "number": 2,
    "started_at": "2026-10-11T12:52:16Z",
    "completed_at": "2026-10-11T12:52:16Z"
  },
  {
    "name": "Run actions/checkout@v4",
    "status": "completed",
    "conclusion": "success",
    "number": 3,
    "started_at": "2026-10-11T12:52:16Z",
    "completed_at": "2026-10-11T12:52:18Z"
  },
  {
    "name": "Run actions/setup-node@v4",
    "status": "completed",
    "conclusion": "success",
    "number": 4,
    "started_at": "2026-10-11T12:52:18Z",
    "completed_at": "2026-10-11T12:52:19Z"
  },
  {
    "name": "Run actions/setup-python@v5",
    "status": "completed",
    "conclusion": "success",
    "number": 5,
    "started_at": "2026-10-11T12:52:19Z",
    "completed_at": "2026-10-11T12:52:19Z"
  },
  {
    "name": "Install the reviewed anonymous statement transport",
    "status": "completed",
    "conclusion": "success",
    "number": 6,
    "started_at": "2026-10-11T12:52:19Z",
    "completed_at": "2026-10-11T12:52:27Z"
  },
  {
    "name": "Verify capture boundaries with offline fixtures",
    "status": "completed",
    "conclusion": "success",
    "number": 7,
    "started_at": "2026-10-11T12:52:27Z",
    "completed_at": "2026-10-11T12:52:37Z"
  },
  {
    "name": "Restore the exact authenticated unadmitted predecessor",
    "status": "completed",
    "conclusion": "failure",
    "number": 8,
    "started_at": "2026-10-11T12:52:37Z",
    "completed_at": "2026-10-11T12:52:40Z"
  },
  {
    "name": "Capture the exact separately admitted annual-history batch",
    "status": "completed",
    "conclusion": "skipped",
    "number": 9,
    "started_at": "2026-10-11T12:52:40Z",
    "completed_at": "2026-10-11T12:52:40Z"
  },
  {
    "name": "Retain all original and partial evidence including the empty lock",
    "status": "completed",
    "conclusion": "failure",
    "number": 10,
    "started_at": "2026-10-11T12:52:40Z",
    "completed_at": "2026-10-11T12:52:40Z"
  },
  {
    "name": "Read back the actual uploaded artifact or fail closed",
    "status": "completed",
    "conclusion": "failure",
    "number": 11,
    "started_at": "2026-10-11T12:52:40Z",
    "completed_at": "2026-10-11T12:52:40Z"
  },
  {
    "name": "Retain external inventory preflight and readback proof",
    "status": "completed",
    "conclusion": "failure",
    "number": 12,
    "started_at": "2026-10-11T12:52:40Z",
    "completed_at": "2026-10-11T12:52:40Z"
  },
  {
    "name": "Post Run actions/setup-python@v5",
    "status": "completed",
    "conclusion": "skipped",
    "number": 22,
    "started_at": "2026-10-11T12:52:40Z",
    "completed_at": "2026-10-11T12:52:40Z"
  },
  {
    "name": "Post Run actions/setup-node@v4",
    "status": "completed",
    "conclusion": "skipped",
    "number": 23,
    "started_at": "2026-10-11T12:52:40Z",
    "completed_at": "2026-10-11T12:52:40Z"
  },
  {
    "name": "Post Run actions/checkout@v4",
    "status": "completed",
    "conclusion": "success",
    "number": 24,
    "started_at": "2026-10-11T12:52:40Z",
    "completed_at": "2026-10-11T12:52:41Z"
  },
  {
    "name": "Complete job",
    "status": "completed",
    "conclusion": "success",
    "number": 25,
    "started_at": "2026-10-11T12:52:41Z",
    "completed_at": "2026-10-11T12:52:41Z"
  }
];
const failedRun = (changes = {}) => ({ ...historical(failedCapture), created_at: failedCapture.run_created_at,
  run_started_at: failedCapture.run_started_at, updated_at: failedCapture.run_updated_at,
  head_commit: { id: failedCapture.head_sha, tree_id: failedCapture.tree_sha }, ...changes });
const failedAttempt = (changes = {}) => failedRun({ created_at: failedCapture.attempt_created_at,
  updated_at: failedCapture.attempt_updated_at, ...changes });
const failedJob = (changes = {}) => ({ id: failedCapture.job_id, run_id: failedCapture.run_id, run_attempt: 1,
  head_sha: failedCapture.head_sha, name: 'statement-capture', status: 'completed', conclusion: 'failure',
  started_at: failedCapture.job_started_at, completed_at: failedCapture.job_completed_at, steps: structuredClone(failedSteps), ...changes });
const endpoints = {
  repo: prefix, recoveryWorkflow: `${prefix}/actions/workflows/${recovery.workflow_id}`,
  sourceWorkflow: `${prefix}/actions/workflows/${source.workflow_id}`,
  currentWorkflow: `${prefix}/actions/workflows/financial-statement-capture.yml`,
  current: `${prefix}/actions/runs/${currentId}`, currentAttempt: `${prefix}/actions/runs/${currentId}/attempts/1`,
  currentJobs: `${prefix}/actions/runs/${currentId}/attempts/1/jobs?per_page=100`,
  ref: `${prefix}/git/ref/heads/${captureBranch}`, commit: `${prefix}/git/commits/${currentSha}`,
  failedCommit: `${prefix}/git/commits/${failedCapture.head_sha}`, failed: `${prefix}/actions/runs/${failedCapture.run_id}`,
  failedAttempt: `${prefix}/actions/runs/${failedCapture.run_id}/attempts/1`,
  failedJobs: `${prefix}/actions/runs/${failedCapture.run_id}/attempts/1/jobs?per_page=100`,
  failedArtifacts: `${prefix}/actions/runs/${failedCapture.run_id}/artifacts?per_page=100`,
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
    [endpoints.commit]: { sha: currentSha, tree: { sha: currentTree }, parents: [{ sha: failedCapture.head_sha }] },
    [endpoints.failedCommit]: { sha: failedCapture.head_sha, tree: { sha: failedCapture.tree_sha }, parents: [{ sha: source.head_sha }] },
    [endpoints.failed]: failedRun(), [endpoints.failedAttempt]: failedAttempt(),
    [endpoints.failedJobs]: list('jobs', [failedJob()]), [endpoints.failedArtifacts]: list('artifacts', []),
    [endpoints.sourceCommit]: { sha: source.head_sha, tree: { sha: source.tree_sha } },
    [endpoints.source]: historical(source), [endpoints.sourceAttempt]: historical(source), [endpoints.sourceJob]: sourceJob(),
    [endpoints.recovery]: historical(recovery), [endpoints.recoveryAttempt]: historical(recovery),
    [endpoints.recoveryInventory]: list('workflow_runs', [historical(recovery)]),
    [endpoints.sourceInventory]: list('workflow_runs', [historical(source)]),
    [endpoints.currentInventory]: list('workflow_runs', [failedRun(), currentRun()]), [endpoints.artifacts]: list('artifacts', [artifact()]), ...changes };
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
  assert.equal(result.schema_version, 'financial-statement-capture-run2-source-check-v1');
  assert.equal(result.source_admission, 'authenticated_unadmitted');
  assert.equal(result.publication_authority, 'none');
  assert.equal(result.source.id, source.run_id); assert.equal(result.source_job.id, source.job_id);
  assert.equal(result.current_job.id, currentJob().id); assert.equal(result.checked_at, NOW.toISOString());
  assert.equal(result.request_sha256, requestSha256); assert.equal(result.current_tree, currentTree);
  assert.deepEqual(result.inventory_counts, { recovery: 1, successor: 1, capture: 2, artifacts: 1, current_jobs: 1 });
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
    { expected_run_number: 1 }, { first_attempt_only: false }, { execution_enabled: 'true' }, { workflow_id: 0 },
    { maximum_job_seconds: 1501 }, { finalization_reserve_seconds: 419 }, { maximum_preflight_age_seconds: 31 },
    { request_sha256: 'a'.repeat(64) }, { runtime_lock_sha256: 'bad' }, { code_tree_sha256: null }, { allow_resume: true }]) {
    const f = fixture(); await assert.rejects(check(f, admission(change))); assert.equal(f.calls.length, 0);
  }
  const a = admission(); delete a.request_id; await assert.rejects(check(fixture(), a), /Closed/);
});

test('actual UTC window/horizon rejects stale, future, ambiguous, impossible and overlong admission', async () => {
  for (const change of [{ dispatch_not_after: '2026-10-11T13:04:59Z' }, { dispatch_not_before: '2026-10-11T13:05:01Z' },
    { dispatch_not_before: '2026-10-11T11:00:00Z' }, { dispatch_not_before: '2026-02-30T12:00:00Z' },
    { dispatch_not_before: '2026-10-11T13:00:00+00:00' }, { required_valid_through: '2026-10-11T13:54:59Z' },
    { required_valid_through: '2026-10-15T13:00:00Z' }, { required_valid_through: '2026-10-14T13:00:01Z' }, { dispatch_not_after: null }]) await assert.rejects(check(fixture(), admission(change)));
  await assert.rejects(check(fixture(), admission(), context(), { clock: () => new Date('invalid') }), /clock/);
});

test('run-two context includes actual numeric repository, workflow ref/SHA, job clock and no replay', async () => {
  for (const change of [{ id: source.run_id }, { id: 0 }, { attempt: 2 }, { run_number: 1 }, { sha: 'bad' },
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
  await assert.rejects(check(fixture(), admission({ workflow_id: workflowId + 1 })), /identity|Workflow/);
});

test('current endpoints and inventory reject changed SHA/tree, completed/foreign/replayed/future runs', async () => {
  for (const endpoint of [endpoints.current, endpoints.currentAttempt, endpoints.currentInventory]) {
    for (const change of [{ run_attempt: 2 }, { run_number: 1 }, { head_sha: 'd'.repeat(40) }, { head_branch: 'main' },
      { path: source.workflow }, { workflow_id: 5 }, { status: 'completed', conclusion: 'success' },
      { repository: { ...identity(), id: 1 } }, { head_repository: { ...identity(), id: 1 } },
      { head_commit: { id: currentSha, tree_id: 'd'.repeat(40) } }, { created_at: '2026-10-11T11:59:59Z' },
      { updated_at: '2026-10-11T13:05:01Z' }, { run_started_at: '2026-10-11T13:05:01Z' }]) {
      const row = currentRun(change); await assert.rejects(check(fixture({ [endpoint]: endpoint === endpoints.currentInventory ? list('workflow_runs', [failedRun(), row]) : row })));
    }
  }
});

test('live branch, hosted current tree and sole failed-capture parent must equal the verified checkout', async () => {
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
      { updated_at: '2026-10-11T13:05:01Z' }, { run_started_at: '2026-10-11T13:05:01Z' }]) {
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
    { started_at: '2026-10-11T13:01:04Z' }, { started_at: '2026-10-11T13:00:00Z' }]) {
    await assert.rejects(check(fixture({ [endpoints.currentJobs]: list('jobs', [currentJob(change)]) })));
  }
  for (const first of ['2026-10-11T13:01:01Z', '2026-10-11T13:02:03Z', '2026-10-11T13:06:00Z']) {
    await assert.rejects(check(fixture(), admission(), context({ job_started_at: first })), /job|clock/);
  }
  await assert.rejects(check(fixture(), admission(), context(), { clock: () => new Date('2026-10-11T13:19:02Z') }), /allowance/);
});

test('recovery inventory rejects every concurrency state, newer work, late old reruns and absent predecessor', async () => {
  const older = historical(recovery, { id: recovery.run_id - 1, run_number: 3 });
  const valid = await check(fixture({ [endpoints.recoveryInventory]: list('workflow_runs', [historical(recovery), older]) }));
  assert.equal(valid.inventory_counts.recovery, 2);
  for (const status of ['in_progress', 'queued', 'waiting', 'pending', 'requested', 'unknown']) {
    await assert.rejects(check(fixture({ [endpoints.recoveryInventory]: list('workflow_runs', [historical(recovery), { ...older, status }]) })), /Concurrent|nonterminal/);
  }
  for (const row of [{ ...older, id: recovery.run_id + 1 }, { ...older, run_number: 4 },
    { ...older, updated_at: '2026-10-10T10:30:51Z' }, { ...older, updated_at: '2026-10-11T13:05:01Z' }]) {
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
  let instant = Date.parse('2026-10-11T13:29:50Z'); const f = fixture();
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
    'show --format=%P --no-patch HEAD': failedCapture.head_sha,
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
        if (variant === 'job') f.advance(Date.parse('2026-10-11T13:19:02Z') - f.now());
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

// The 2026-10-11 terminal API observations are not the lost in-progress payload.
// These tests project only their observed clock relationship into local fixtures.
test('current attempt accepts observed record creation one second after canonical run start', async () => {
  const canonical = currentRun({ created_at: '2026-10-11T13:52:10Z', run_started_at: '2026-10-11T13:52:10Z', updated_at: '2026-10-11T13:52:43Z' });
  const attempt = { ...canonical, created_at: '2026-10-11T13:52:11Z', updated_at: '2026-10-11T13:52:44Z' };
  const f = fixture({ [endpoints.current]: canonical, [endpoints.currentAttempt]: attempt,
    [endpoints.currentInventory]: list('workflow_runs', [failedRun(), canonical]),
    [endpoints.currentJobs]: list('jobs', [currentJob({ started_at: '2026-10-11T13:52:13Z' })]) });
  const a = admission({ dispatch_not_before: '2026-10-11T13:50:00Z', dispatch_not_after: '2026-10-11T14:00:00Z', required_valid_through: '2026-10-11T14:30:00Z' });
  const proof = await check(f, a, context({ job_started_at: '2026-10-11T13:52:16Z' }), { clock: () => new Date('2026-10-11T13:53:58.210Z') });
  assert.equal(proof.current.created_at, canonical.created_at);
  assert.equal(proof.current.run_started_at, canonical.run_started_at);
  assert.equal(proof.current_attempt.created_at, attempt.created_at);
  assert.deepEqual(proof.current_attempt, attempt);
  assert.equal(f.responses[endpoints.currentAttempt].created_at, attempt.created_at);
  assert.equal(proof.current_job.started_at, '2026-10-11T13:52:13Z');
  assert.equal(proof.inventory_counts.capture, 2);
  assert.equal(f.calls.length, Object.keys(endpoints).length);
});

test('current attempt creation is a record clock rather than a one-second tolerance or reset', async () => {
  for (const created of ['2026-10-11T13:01:00Z', '2026-10-11T13:01:01Z', '2026-10-11T13:02:00Z']) {
    const row = currentRun({ created_at: created, updated_at: '2026-10-11T13:02:01Z' });
    const proof = await check(fixture({ [endpoints.currentAttempt]: row }));
    assert.equal(proof.current.created_at, currentRun().created_at);
    assert.equal(proof.current.run_started_at, currentRun().run_started_at);
  }
});

test('current attempt timestamps independently reject future clocks and invalid update ordering', async () => {
  for (const change of [
    { created_at: '2026-10-11T13:05:00.001Z', updated_at: '2026-10-11T13:05:00.001Z' },
    { run_started_at: '2026-10-11T13:05:00.001Z', updated_at: '2026-10-11T13:05:00.001Z' },
    { updated_at: '2026-10-11T13:05:00.001Z' },
    { created_at: '2026-10-11T13:01:02Z', updated_at: '2026-10-11T13:01:01Z' },
    { updated_at: '2026-10-11T13:00:59Z' },
    { created_at: '2026-10-11T13:00:59Z' },
  ]) {
    const f = fixture({ [endpoints.currentAttempt]: currentRun(change) });
    await assert.rejects(check(f), /Future or out-of-order workflow clocks/);
    assert.equal(f.calls.at(-1), endpoints.currentAttempt);
  }
});

test('current attempt still binds exact start identity state attempt head and tree', async () => {
  for (const change of [{ run_started_at: '2026-10-11T13:01:01Z' }, { id: currentId + 1 },
    { run_attempt: 2 }, { run_number: 1 }, { status: 'completed', conclusion: 'failure' },
    { head_sha: 'd'.repeat(40) }, { workflow_id: workflowId + 1 }, { head_branch: 'other' },
    { event: 'workflow_dispatch' }, { head_commit: { id: currentSha, tree_id: 'd'.repeat(40) } }]) {
    const row = currentRun({ created_at: '2026-10-11T13:01:02Z', updated_at: '2026-10-11T13:01:03Z', ...change });
    await assert.rejects(check(fixture({ [endpoints.currentAttempt]: row })));
  }
});

test('attempt semantics do not relax canonical ordering inventory creation or historical attempt checks', async () => {
  for (const endpoint of [endpoints.current, endpoints.currentInventory]) {
    const row = currentRun({ created_at: '2026-10-11T13:01:01Z' });
    await assert.rejects(check(fixture({ [endpoint]: endpoint === endpoints.currentInventory ? list('workflow_runs', [failedRun(), row]) : row })), /workflow clocks/);
  }
  await assert.rejects(check(fixture({ [endpoints.currentInventory]: list('workflow_runs', [failedRun(), currentRun({ created_at: '2026-10-11T13:00:59Z' })]) })), /inventory differs/);
  for (const [endpoint, expected] of [[endpoints.sourceAttempt, source], [endpoints.recoveryAttempt, recovery]]) {
    const row = historical(expected), start = Date.parse(row.run_started_at);
    await assert.rejects(check(fixture({ [endpoint]: { ...row, created_at: new Date(start + 1000).toISOString() } })), /workflow clocks/);
    await assert.rejects(check(fixture({ [endpoint]: { ...row, created_at: new Date(start - 1000).toISOString() } })), /changed|overlaps/);
  }
});

test('attempt record creation cannot rescue canonical dispatch or whole-job clock violations', async () => {
  for (const change of [{ created_at: '2026-10-11T11:59:59Z' },
    { created_at: '2026-10-11T11:59:59Z', run_started_at: '2026-10-11T11:59:59Z' }]) {
    const row = currentRun(change), attempt = { ...row, created_at: '2026-10-11T13:01:00Z' };
    await assert.rejects(check(fixture({ [endpoints.current]: row, [endpoints.currentAttempt]: attempt })), /window|deadline/);
  }
  const row = currentRun({ created_at: '2026-10-11T13:00:00Z', run_started_at: '2026-10-11T13:00:00Z', updated_at: '2026-10-11T13:25:00Z' });
  await assert.rejects(check(fixture({ [endpoints.current]: row,
    [endpoints.currentAttempt]: { ...row, created_at: '2026-10-11T13:24:59Z' } }), admission(), context(),
    { clock: () => new Date('2026-10-11T13:25:00Z') }), /deadline/);
});

test('attempt clock validation uses the completed read checkpoint and keeps await mutation guards', async () => {
  let instant = NOW.getTime(); const f = fixture();
  const api = async endpoint => {
    const value = await f.api(endpoint);
    if (endpoint === endpoints.currentAttempt) {
      await Promise.resolve(); instant += 1000;
      value.created_at = '2026-10-11T13:01:01Z'; value.updated_at = new Date(instant).toISOString();
    }
    return value;
  };
  const proof = await check(f, admission(), context(), { api, clock: () => new Date(instant) });
  assert.equal(proof.checked_at, '2026-10-11T13:05:01.000Z');
  for (const field of ['admission', 'context', 'checkout']) {
    const a = admission(), c = context(), k = checkout(), fixtureData = fixture();
    const mutate = async endpoint => { const value = await fixtureData.api(endpoint); await Promise.resolve();
      if (endpoint === endpoints.currentAttempt) {
        if (field === 'admission') a.execution_enabled = false;
        if (field === 'context') c.attempt = 2;
        if (field === 'checkout') k.tree = 'd'.repeat(40);
      }
      return value;
    };
    await assert.rejects(check(fixtureData, a, c, { api: mutate, checkout: k }), /changed across/);
    assert.equal(fixtureData.calls.at(-1), endpoints.currentAttempt);
  }
});

test('clock failure diagnostics are bounded validated metadata with exact violated relations', async () => {
  const row = currentRun({ created_at: '2026-10-11T13:01:02Z', unexpected_secret: 'NEVER_LOG_THIS_VALUE' });
  let error;
  try { await check(fixture({ [endpoints.currentAttempt]: row })); } catch (caught) { error = caught; }
  assert.ok(error instanceof Error);
  const detail = JSON.parse(error.message.split('workflow clocks: ')[1]);
  assert.deepEqual(Object.keys(detail).sort(), ['resource', 'run_id', 'run_attempt', 'created_at', 'run_started_at', 'updated_at', 'observed_at', 'canonical_created_at', 'failed'].sort());
  assert.equal(detail.resource, 'current_attempt_1'); assert.equal(detail.run_id, currentId);
  assert.deepEqual(detail.failed, ['created_not_after_update']);
  assert.equal(detail.observed_at, NOW.toISOString());
  assert.equal(detail.canonical_created_at, currentRun().created_at);
  assert.equal(error.message.includes('NEVER_LOG_THIS_VALUE'), false);
  assert.ok(Buffer.byteLength(error.message) < 1024);
});

test('run-two admission pins the complete closed failed capture binding and same workflow before any read', async () => {
  assert.ok(Object.isFrozen(failedCapture));
  assert.equal(failedCapture.workflow_id, 381262768);
  assert.equal(failedCapture.run_id, 38140913503);
  assert.equal(failedCapture.head_sha, '34a3a4fa9d975a45df899032bde05c673d921da9');
  assert.equal(failedCapture.parent_sha, source.head_sha);
  for (const [key, value] of Object.entries(failedCapture)) {
    for (const replacement of [null, typeof value === 'number' ? String(value) : `${value}-changed`]) {
      const f = fixture(); await assert.rejects(check(f, admission({ recovery: { ...failedCapture, [key]: replacement } })), /recovery binding/);
      assert.equal(f.calls.length, 0);
    }
    const binding = { ...failedCapture }; delete binding[key];
    const f = fixture(); await assert.rejects(check(f, admission({ recovery: binding })), /Closed/); assert.equal(f.calls.length, 0);
  }
  for (const change of [{ workflow_id: null }, { workflow_id: 500000000 }, { expected_run_number: 3 },
    { expected_parent_sha: source.head_sha }, { expected_parent_sha: null }, { recovery: { ...failedCapture, allow_retry: true } }]) {
    const f = fixture(); await assert.rejects(check(f, admission(change))); assert.equal(f.calls.length, 0);
  }
});

test('failed capture proof contains only bounded whitelisted identities, original clocks and exact steps', async () => {
  const f = fixture();
  for (const endpoint of [endpoints.failed, endpoints.failedAttempt]) {
    Object.assign(f.responses[endpoint], { actor: { login: 'NEVER_RETAIN_ACTOR' }, raw_headers: 'NEVER_RETAIN_HEADERS', other_payload: 'X'.repeat(100000) });
    Object.assign(f.responses[endpoint].head_commit, { message: 'NEVER_RETAIN_MESSAGE' });
  }
  Object.assign(f.responses[endpoints.failedJobs].jobs[0], { labels: ['NEVER_RETAIN_LABELS'], runner_name: 'NEVER_RETAIN_RUNNER' });
  const proof = await check(f), failed = proof.failed_capture;
  assert.equal(proof.schema_version, 'financial-statement-capture-run2-source-check-v1');
  assert.deepEqual(proof.recovery, failedCapture); assert.equal(proof.expected_parent_sha, failedCapture.head_sha);
  assert.deepEqual(Object.keys(failed).sort(), ['schema_version', 'binding', 'run', 'attempt', 'commit', 'job', 'artifact_inventory'].sort());
  assert.equal(failed.schema_version, 'financial-statement-capture-recovery-proof-v1'); assert.deepEqual(failed.binding, failedCapture);
  const fields = ['id', 'run_number', 'run_attempt', 'repository', 'head_repository', 'workflow_id', 'path', 'event', 'head_branch',
    'head_sha', 'head_commit', 'status', 'conclusion', 'created_at', 'run_started_at', 'updated_at'];
  for (const run of [failed.run, failed.attempt]) {
    assert.deepEqual(Object.keys(run).sort(), fields.sort());
    assert.deepEqual(Object.keys(run.repository).sort(), ['full_name', 'id']);
    assert.deepEqual(Object.keys(run.head_repository).sort(), ['full_name', 'id']);
    assert.deepEqual(Object.keys(run.head_commit).sort(), ['id', 'tree_id']);
  }
  assert.equal(failed.run.created_at, failedCapture.run_created_at);
  assert.equal(failed.attempt.created_at, failedCapture.attempt_created_at);
  assert.equal(failed.attempt.updated_at, failedCapture.attempt_updated_at);
  assert.deepEqual(failed.commit, { sha: failedCapture.head_sha, tree_sha: failedCapture.tree_sha, parents: [source.head_sha] });
  assert.deepEqual(failed.artifact_inventory, { total_count: 0, artifacts: [] });
  assert.deepEqual(failed.job.steps, failedSteps);
  for (const step of failed.job.steps) assert.deepEqual(Object.keys(step).sort(), ['number', 'name', 'status', 'conclusion', 'started_at', 'completed_at'].sort());
  assert.equal(JSON.stringify(failed).includes('NEVER_RETAIN'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(failed), 'utf8') <= 65536);
  assert.equal(proof.current_attempt.created_at, currentRun().created_at);
});

test('pinned failed canonical run, attempt and inventory bind exact identities states trees and clocks', async () => {
  for (const endpoint of [endpoints.failed, endpoints.failedAttempt, endpoints.currentInventory]) {
    const base = endpoint === endpoints.failedAttempt ? failedAttempt() : failedRun();
    for (const change of [{ id: failedCapture.run_id - 1 }, { run_number: 2 }, { run_attempt: 2 },
      { workflow_id: 500000000 }, { path: source.workflow }, { event: 'workflow_dispatch' }, { head_branch: 'main' },
      { head_sha: source.head_sha }, { head_commit: { id: failedCapture.head_sha, tree_id: source.tree_sha } },
      { head_commit: { id: source.head_sha, tree_id: failedCapture.tree_sha } },
      { repository: { ...identity(), id: 1 } }, { head_repository: { ...identity(), full_name: 'foreign/repo' } },
      { status: 'in_progress', conclusion: null }, { status: 'completed', conclusion: 'success' }, { conclusion: 'cancelled' },
      { created_at: '2026-10-11T12:52:09Z' }, { run_started_at: '2026-10-11T12:52:12Z' },
      { updated_at: '2026-10-11T12:52:45Z' }]) {
      const row = { ...base, ...change }, f = fixture({ [endpoint]: endpoint === endpoints.currentInventory ? list('workflow_runs', [row, currentRun()]) : row });
      await assert.rejects(check(f)); assert.equal(f.calls.at(-1), endpoint);
    }
  }
});

test('failed attempt separate creation never relaxes canonical chronology or fresh observation clocks', async () => {
  for (const [endpoint, row] of [[endpoints.failed, failedRun({ created_at: '2026-10-11T12:52:11Z' })],
    [endpoints.failedAttempt, failedAttempt({ created_at: '2026-10-11T12:52:09Z' })],
    [endpoints.failedAttempt, failedAttempt({ created_at: '2026-10-11T12:52:45Z' })],
    [endpoints.failedAttempt, failedAttempt({ updated_at: '2026-10-11T12:52:09Z' })],
    [endpoints.failedAttempt, failedAttempt({ created_at: '2026-10-11T13:05:00.001Z', updated_at: '2026-10-11T13:05:00.001Z' })],
    [endpoints.failed, failedRun({ run_started_at: '2026-10-11T13:05:00.001Z', updated_at: '2026-10-11T13:05:00.001Z' })],
    [endpoints.failedAttempt, failedAttempt({ updated_at: '2026-02-30T12:52:44Z' })]]) {
    const f = fixture({ [endpoint]: row }); await assert.rejects(check(f), /workflow clocks|Invalid UTC/); assert.equal(f.calls.at(-1), endpoint);
  }
  const proof = await check();
  assert.equal(proof.failed_capture.attempt.created_at, '2026-10-11T12:52:11Z');
  assert.equal(proof.failed_capture.attempt.run_started_at, '2026-10-11T12:52:10Z');
});

test('failed commit independently authenticates exact tree and sole original source parent', async () => {
  for (const change of [{ sha: source.head_sha }, { tree: { sha: source.tree_sha } }, { parents: [] },
    { parents: [{ sha: failedCapture.head_sha }] }, { parents: [{ sha: source.head_sha }, { sha: currentSha }] },
    { parents: [{ sha: source.head_sha }, { sha: source.head_sha }] }]) {
    const f = fixture(); Object.assign(f.responses[endpoints.failedCommit], change);
    await assert.rejects(check(f), /failed capture commit/); assert.equal(f.calls.at(-1), endpoints.failedCommit);
  }
  await assert.rejects(check(fixture(), admission(), context(), { checkout: checkout({ parents: [source.head_sha] }) }), /parent/);
  const f = fixture(); f.responses[endpoints.commit].parents = [{ sha: source.head_sha }];
  await assert.rejects(check(f), /Hosted/); assert.equal(f.calls.at(-1), endpoints.commit);
});

test('failed jobs inventory must be complete and contain exactly the one pinned terminal job', async () => {
  for (const rows of [[], [failedJob(), failedJob({ id: failedCapture.job_id + 1 })], [failedJob(), failedJob()]]) {
    await assert.rejects(check(fixture({ [endpoints.failedJobs]: list('jobs', rows) })));
  }
  for (const total_count of [undefined, '1', 0, 2, 101]) {
    await assert.rejects(check(fixture({ [endpoints.failedJobs]: { total_count, jobs: [failedJob()] } })), /Incomplete|oversized/);
  }
  for (const change of [{ id: 1 }, { run_id: 1 }, { run_attempt: 2 }, { head_sha: source.head_sha }, { name: 'other' },
    { status: 'in_progress' }, { conclusion: 'success' }, { started_at: '2026-10-11T12:52:14Z' },
    { completed_at: '2026-10-11T12:52:44Z' }]) {
    const f = fixture({ [endpoints.failedJobs]: list('jobs', [failedJob(change)]) });
    await assert.rejects(check(f), /failed capture job/); assert.equal(f.calls.at(-1), endpoints.failedJobs);
  }
});

test('nonnull skipped capture timestamps are preserved and the entire ordered six-field step fingerprint is mandatory', async () => {
  const proof = await check(), steps = proof.failed_capture.job.steps;
  const capture = steps.find(step => step.number === 9), restore = steps.find(step => step.number === 8);
  assert.equal(capture.status, 'completed'); assert.equal(capture.conclusion, 'skipped');
  assert.equal(capture.started_at, '2026-10-11T12:52:40Z'); assert.equal(capture.completed_at, capture.started_at);
  assert.equal(restore.conclusion, 'failure');
  assert.equal(hash(JSON.stringify(steps.map(({ number, name, status, conclusion, started_at, completed_at }) =>
    [number, name, status, conclusion, started_at, completed_at]))), failedCapture.job_steps_sha256);
  const variants = [steps.slice(1), [...steps, { ...steps.at(-1), number: 26 }], [...steps.slice(0, -1), steps[0]], [...steps].reverse()];
  for (const [index, field, replacement] of [[0, 'name', 'Changed setup'], [0, 'started_at', '2026-10-11T12:52:13Z'],
    [0, 'completed_at', '2026-10-11T12:52:15Z'], [0, 'number', 0], [0, 'conclusion', 'failure'],
    [7, 'conclusion', 'success'], [8, 'conclusion', 'success'], [8, 'conclusion', 'failure'], [8, 'conclusion', null],
    [8, 'status', 'in_progress'], [8, 'started_at', null], [8, 'completed_at', null],
    [8, 'started_at', '2026-10-11T12:52:39Z'], [8, 'completed_at', '2026-10-11T12:52:41Z'],
    [15, 'completed_at', '2026-10-11T13:05:01Z'], [15, 'completed_at', '2026-02-30T12:52:41Z']]) {
    const changed = structuredClone(steps); changed[index][field] = replacement; variants.push(changed);
  }
  const extraField = structuredClone(steps); extraField[0].actor = 'unreviewed'; variants.push(extraField);
  const missingField = structuredClone(steps); delete missingField[0].name; variants.push(missingField);
  for (const changed of variants) {
    const f = fixture({ [endpoints.failedJobs]: list('jobs', [failedJob({ steps: changed })]) });
    await assert.rejects(check(f)); assert.equal(f.calls.at(-1), endpoints.failedJobs);
  }
});

test('failed capture artifact inventory must be completely empty without missing totals or partial listings', async () => {
  for (const inventory of [list('artifacts', [artifact()]), { artifacts: [] }, { total_count: 1, artifacts: [] },
    { total_count: 101, artifacts: [] }, { total_count: '0', artifacts: [] }, { total_count: -1, artifacts: [] }]) {
    const f = fixture({ [endpoints.failedArtifacts]: inventory }); await assert.rejects(check(f));
    assert.equal(f.calls.at(-1), endpoints.failedArtifacts);
  }
});

test('complete capture inventory permits only pinned failed run one and current run two in either order', async () => {
  const proof = await check(fixture({ [endpoints.currentInventory]: list('workflow_runs', [currentRun(), failedRun()]) }));
  assert.equal(proof.inventory_counts.capture, 2);
  for (const rows of [[], [failedRun()], [currentRun()], [failedRun(), currentRun(), currentRun({ id: currentId + 1, run_number: 3 })],
    [failedRun(), currentRun(), currentRun({ id: currentId - 1, status: 'queued' })],
    [failedRun(), currentRun(), historical(source)], [failedRun(), failedRun()],
    [failedRun({ run_attempt: 2 }), currentRun()], [failedRun(), currentRun({ run_number: 3 })]]) {
    const f = fixture({ [endpoints.currentInventory]: list('workflow_runs', rows) }); await assert.rejects(check(f));
    assert.equal(f.calls.at(-1), endpoints.currentInventory);
  }
});

test('every source validation refreshes all failed capture reads and rejects drift on first-provider refresh', async () => {
  const failedEndpoints = [endpoints.failedCommit, endpoints.failed, endpoints.failedAttempt, endpoints.failedJobs, endpoints.failedArtifacts];
  const f = fixture(); await check(f); await check(f);
  for (const endpoint of failedEndpoints) assert.equal(f.calls.filter(value => value === endpoint).length, 2);
  for (const [endpoint, mutate] of [
    [endpoints.failedCommit, value => { value.parents = []; }], [endpoints.failed, value => { value.run_attempt = 2; }],
    [endpoints.failedAttempt, value => { value.created_at = failedCapture.run_created_at; }],
    [endpoints.failedJobs, value => { value.jobs[0].steps[8].conclusion = 'success'; }],
    [endpoints.failedArtifacts, value => { value.total_count = 1; value.artifacts.push(artifact()); }],
    [endpoints.sourceCommit, value => { value.tree.sha = currentTree; }],
    [endpoints.currentInventory, value => { value.workflow_runs.push(currentRun({ id: currentId + 1 })); value.total_count++; }],
  ]) {
    const changed = fixture(); await check(changed); mutate(changed.responses[endpoint]);
    await assert.rejects(check(changed)); assert.equal(changed.calls.at(-1), endpoint);
  }
});

test('every failed metadata await rejects nested admission mutation and charges stale backwards and expired clocks', async () => {
  for (const endpoint of [endpoints.failedCommit, endpoints.failed, endpoints.failedAttempt, endpoints.failedJobs, endpoints.failedArtifacts]) {
    const f = fixture(), a = admission();
    const api = async path => { const value = await f.api(path); if (path === endpoint) { await Promise.resolve(); a.recovery.capture_step_number = 10; } return value; };
    await assert.rejects(check(f, a, context(), { api }), /changed across/); assert.equal(f.calls.at(-1), endpoint);
    for (const offset of [30001, -1, 26 * 60000]) {
      const data = fixture(); let instant = NOW.getTime();
      const slow = async path => { const value = await data.api(path); if (path === endpoint) { await Promise.resolve(); instant += offset; } return value; };
      await assert.rejects(check(data, admission(), context(), { api: slow, clock: () => new Date(instant) }), /stale|backwards|window/);
      assert.equal(data.calls.at(-1), endpoint);
    }
  }
});

test('restore rejects old proof schemas, changed recovery proof or wrong parent before any output or download', async () => {
  const root = mkdtempSync(join(tmpdir(), 'capture-run2-proof-')); let downloads = 0;
  try {
    const original = await check();
    const mutations = [value => { value.schema_version = 'financial-statement-capture-source-check-v1'; },
      value => { delete value.failed_capture; }, value => { value.expected_parent_sha = source.head_sha; },
      value => { value.recovery.run_id++; }, value => { value.failed_capture.binding.capture_step_number++; },
      value => { value.failed_capture.run.actor = 'not permitted'; }, value => { value.failed_capture.attempt.head_commit.message = 'not permitted'; },
      value => { value.failed_capture.commit.parents = []; }, value => { value.failed_capture.job.steps[8].conclusion = 'success'; },
      value => { value.failed_capture.artifact_inventory.artifacts.push(artifact()); },
      value => { value.failed_capture.job.steps[0].name = 'X'.repeat(65537); }];
    for (const [index, mutate] of mutations.entries()) {
      const verified = structuredClone(original); mutate(verified); const out = join(root, String(index));
      await assert.rejects(restoreCaptureSource(verified, out, { clock: () => NOW, download: () => { downloads++; } }));
      assert.equal(existsSync(out), false);
    }
    assert.equal(downloads, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('successful restore provenance binds run-two schema and exact reviewed failed parent recovery', async () => {
  const f = await restorationFixture();
  try {
    const result = await restoreCaptureSource(f.initial, f.output, f.options);
    assert.equal(result.schema_version, 'financial-statement-capture-run2-source-restore-v1');
    assert.deepEqual(result.recovery, failedCapture); assert.equal(result.expected_parent_sha, failedCapture.head_sha);
    assert.deepEqual(JSON.parse(readFileSync(join(f.output, 'restored.json'))), result);
    assert.deepEqual(JSON.parse(readFileSync(join(f.output, 'source-check.json'))).failed_capture, f.initial.failed_capture);
  } finally { f.cleanup(); }
});
