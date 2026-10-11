// Request-bound capture-input authentication only. No provider or publication authority.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { completeInventory, extractSuccessorSourceArchive } from './restore-successor-statement-source.mjs';

export { completeInventory, extractSuccessorSourceArchive };
export const repository = 'kusennjp1-ai/screener';
export const repositoryId = 1203919607;
export const captureWorkflow = '.github/workflows/financial-statement-capture.yml';
export const captureBranch = 'improve/financial-statement-capture';
export const requestId = 'first-cnh-esta-annual-history';
export const requestSha256 = 'c6f32b4ad7c86dddfbab1e47fcf22b340799a656d531bb71168aab27594eb190';
export const admissionSchema = 'financial-statement-capture-admission-v1';
export const source = Object.freeze({
  repository, run_id: 38044324870, run_attempt: 1, run_number: 1, job_id: 114190671543,
  head_branch: 'improve/financial-retention-successor', status: 'completed', conclusion: 'success',
  head_sha: 'a3e16ad6176e89d87714d30200f9d836523d441a',
  tree_sha: 'f883834d9d33c95b7816eecdfa9a2dda5b450645',
  workflow: '.github/workflows/financial-statement-successor.yml', workflow_id: 380431390,
  artifact_id: 11667642359,
  artifact_name: 'financial-statement-successor-a3e16ad6176e89d87714d30200f9d836523d441a-1',
  artifact_sha256: '629c56d70af5684f1956e6a9ad7b1c78bfc0e5adb633cd38b5ad0f4af7bc4777',
  artifact_size_in_bytes: 36165105,
  archive_manifest_sha256: 'c820be1f3b5e35a07468aef53b0def7fcec50611d33740cd10a71ae47bd94890',
  acquisition_base_sha256: '2524eeac36bcb79d3ebe75f7f57d5672e91e1dafcd80a23d180ae39de867b932',
  cohort_sha256: '36a83c34c33b0158f1d246226d8d538797c6c6e6494669c6feacefa82da12580',
});
export const recovery = Object.freeze({ workflow: '.github/workflows/financial-statement-recovery.yml',
  workflow_id: 374552819, run_id: 37478731832, run_attempt: 1, run_number: 4,
  head_sha: '4715b218cc25720d1d3be455930554e1e6282136',
  head_branch: 'improve/mandatory-financial-source-recovery', status: 'completed', conclusion: 'failure' });
export const paths = Object.freeze({ admission: '.github/financial-statement-capture/admission.json',
  request: '.github/financial-statement-capture/request.json', lock: '.github/financial-statement-capture/runtime-lock.json' });
const versions = Object.freeze({ yfinance: '0.2.66', curl_cffi: '0.16.3', pandas: '2.2.0', numpy: '1.26.3', requests: '2.31.0' });
const requiredRuntime = [paths.request, captureWorkflow, '.github/scripts/run-statement-capture.py',
  '.github/scripts/restore-statement-capture-source.mjs', '.github/scripts/verify-statement-capture-artifact.py',
  '.github/scripts/restore-successor-statement-source.mjs', '.github/scripts/restore-statement-source.mjs',
  '.github/scripts/verify-successor-artifact.py', '.github/scripts/statement-capture-transport.py',
  '.github/financial-statement-capture/transport-lock.json'];
const require = (ok, message) => { if (!ok) throw Error(message); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sha1 = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (value, expected, label) => require(object(value) && equal(Object.keys(value).sort(), [...expected].sort()), `Closed ${label} required`);
function utc(value, label) {
  require(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), `Invalid UTC ${label}`);
  const time = Date.parse(value);
  require(Number.isFinite(time) && new Date(time).toISOString() === value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z'), `Invalid UTC ${label}`);
  return time;
}
function nowValue(clock) {
  const value = clock();
  require(value instanceof Date && Number.isFinite(value.getTime()), 'Invalid actual validation clock');
  return new Date(value);
}

export function validateAdmission(value, { now = new Date(), dryRun = false } = {}) {
  const fixed = { schema_version: admissionSchema, request_id: requestId, repository, repository_id: repositoryId,
    workflow: captureWorkflow, branch: captureBranch, event: 'push', expected_run_number: 1, first_attempt_only: true,
    maximum_job_seconds: 1500, finalization_reserve_seconds: 420, maximum_preflight_age_seconds: 30 };
  keys(value, [...Object.keys(fixed), 'execution_enabled', 'workflow_id', 'request_sha256', 'runtime_lock_sha256',
    'code_tree_sha256', 'dispatch_not_before', 'dispatch_not_after', 'required_valid_through'], 'capture admission');
  require(Object.entries(fixed).every(([key, expected]) => value[key] === expected), 'Capture admission identity or scope changed');
  require(typeof value.execution_enabled === 'boolean' && (value.workflow_id === null || positive(value.workflow_id)), 'Invalid capture activation or workflow identity');
  require(value.request_sha256 === requestSha256 && ['runtime_lock_sha256', 'code_tree_sha256'].every(key => digest(value[key])), 'Invalid reviewed capture digest');
  if (!value.execution_enabled) {
    require(dryRun === true, 'Capture execution is disabled pending separate approval');
    require(['dispatch_not_before', 'dispatch_not_after', 'required_valid_through'].every(key => value[key] === null), 'Disabled capture must have no selected execution window');
    return value;
  }
  const before = utc(value.dispatch_not_before, 'dispatch_not_before');
  const after = utc(value.dispatch_not_after, 'dispatch_not_after');
  const horizon = utc(value.required_valid_through, 'required_valid_through');
  require(now instanceof Date && Number.isFinite(now.getTime()) && before < after && after - before <= 3600000 &&
    before <= now.getTime() && now.getTime() <= after, 'Capture execution window is stale, future or unbounded');
  require(horizon >= now.getTime() + 1500000 && horizon >= after + 1500000 && horizon <= before + 72 * 3600000,
    'Capture horizon cannot cover the bounded job or exceeds annual policy');
  return value;
}

export function contextFromEnvironment(env = process.env) {
  const number = name => /^\d+$/.test(env[name] ?? '') ? Number(env[name]) : NaN;
  return { id: number('GITHUB_RUN_ID'), attempt: number('GITHUB_RUN_ATTEMPT'), run_number: number('GITHUB_RUN_NUMBER'),
    sha: env.GITHUB_SHA, branch: env.GITHUB_REF_NAME, repository: env.GITHUB_REPOSITORY, event: env.GITHUB_EVENT_NAME,
    repository_id: number('GITHUB_REPOSITORY_ID'), job_started_at: env.CAPTURE_JOB_STARTED_AT, workflow_ref: env.GITHUB_WORKFLOW_REF, workflow_sha: env.GITHUB_WORKFLOW_SHA };
}
function checkedContext(context) {
  require(object(context) && positive(context.id) && context.id > source.run_id && context.attempt === 1 && context.run_number === 1 &&
    sha1(context.sha) && context.repository === repository && context.repository_id === repositoryId && context.branch === captureBranch &&
    context.event === 'push' && context.workflow_sha === context.sha &&
    context.workflow_ref === `${repository}/${captureWorkflow}@refs/heads/${captureBranch}`, 'Invalid capture context, workflow ref or replayed attempt');
  utc(context.job_started_at, 'first job-step clock');
}
function checkedCheckout(checkout, admission, context) {
  require(object(checkout) && checkout.sha === context.sha && sha1(checkout.tree) &&
    equal(checkout.parents, [source.head_sha]) && checkout.code_tree_sha256 === admission.code_tree_sha256 &&
    checkout.request_sha256 === admission.request_sha256 && checkout.runtime_lock_sha256 === admission.runtime_lock_sha256 &&
    digest(checkout.admission_sha256), 'Checkout, reviewed code tree, runtime lock or direct producer parent changed');
}

function safePath(relative) {
  return typeof relative === 'string' && relative.length > 0 && !relative.startsWith('/') && !relative.includes('\\') &&
    !relative.includes('\0') && relative.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
const fileIdentity = st => [st.dev, st.ino, st.mode, st.nlink, st.size, st.mtimeMs, st.ctimeMs];
const sameInode = (left, right) => left.dev === right.dev && left.ino === right.ino;
function readRegular(root, relative, maximum = 64 * 1024 * 1024) {
  root = resolve(root);
  require(safePath(relative), 'Unsafe capture input path');
  const path = resolve(root, relative);
  for (let parent = dirname(path); parent !== root; parent = dirname(parent)) {
    const st = lstatSync(parent); require(st.isDirectory() && !st.isSymbolicLink(), 'Symlinked capture input parent');
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(descriptor);
    require(st.isFile() && st.nlink === 1 && st.size <= maximum, 'Capture input is not a bounded regular file');
    const bytes = readFileSync(descriptor), after = fstatSync(descriptor);
    require(bytes.length === st.size && after.size === st.size && after.mtimeMs === st.mtimeMs && after.ctimeMs === st.ctimeMs,
      'Capture input changed while being read');
    return { bytes, mode: (st.mode & 0o111) ? '100755' : '100644', identity: fileIdentity(st) };
  } finally { closeSync(descriptor); }
}

// Admission excludes itself from this identity; it still must match its committed
// blob. The lock remains included, avoiding an impossible self-referential SHA.
export function codeTreeDigest(records) {
  require(Array.isArray(records) && records.length > 0, 'Missing committed code tree');
  const seen = new Set();
  for (const item of records) {
    require(Array.isArray(item) && item.length === 3 && safePath(item[0]) && ['100644', '100755'].includes(item[1]) &&
      sha1(item[2]) && !seen.has(item[0]), 'Malformed or duplicate committed blob record');
    seen.add(item[0]);
  }
  require(seen.has(paths.admission) && seen.has(paths.lock) && seen.has(paths.request), 'Missing committed capture inputs');
  const reviewed = records.filter(([path]) => path !== paths.admission).map(item => [...item]);
  reviewed.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return hash(Buffer.from(JSON.stringify(reviewed)));
}

export function verifyCheckout(root, admission, context, { git = args => execFileSync('git', args,
  { cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024 }) } = {}) {
  root = resolve(root);
  require(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink(), 'Invalid checkout root');
  const sha = git(['rev-parse', '--verify', 'HEAD']).trim();
  const tree = git(['rev-parse', '--verify', 'HEAD^{tree}']).trim();
  const parents = git(['show', '--format=%P', '--no-patch', 'HEAD']).trim().split(' ');
  require(sha === context.sha && sha1(tree) && equal(parents, [source.head_sha]), 'Checked-out revision or producer parent changed');
  const listing = git(['ls-tree', '-rz', '--full-tree', 'HEAD']);
  require(listing.endsWith('\0'), 'Incomplete committed tree listing');
  const records = listing.slice(0, -1).split('\0').map(line => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
    require(match !== null, 'Unreviewed symlink, submodule or malformed committed entry');
    return [match[3], match[1], match[2]];
  });
  const codeTree = codeTreeDigest(records), fileHashes = new Map(), contents = new Map();
  for (const [path, mode, blob] of records) {
    const actual = readRegular(root, path);
    const blobHash = createHash('sha1').update(`blob ${actual.bytes.length}\0`).update(actual.bytes).digest('hex');
    require(actual.mode === mode && blobHash === blob, `Working file differs from committed bytes or mode: ${path}`);
    fileHashes.set(path, hash(actual.bytes));
    if (Object.values(paths).includes(path)) contents.set(path, actual.bytes);
  }
  const admissionBytes = contents.get(paths.admission), requestBytes = contents.get(paths.request), lockBytes = contents.get(paths.lock);
  require(equal(JSON.parse(admissionBytes), admission), 'Admission changed before checkout verification');
  require(admissionBytes.length <= 1024 * 1024 && requestBytes.length <= 2 * 1024 * 1024 && lockBytes.length <= 2 * 1024 * 1024,
    'Oversized capture control input');
  require(JSON.parse(requestBytes).request_id === requestId, 'Unexpected compact capture request');
  const lock = JSON.parse(lockBytes);
  keys(lock, ['schema_version', 'python', 'versions', 'files'], 'capture runtime lock');
  require(lock.schema_version === 'financial-statement-capture-runtime-lock-v1' && lock.python === '3.11' &&
    object(lock.versions) && equal(Object.keys(lock.versions).sort(), Object.keys(versions).sort()) &&
    Object.entries(versions).every(([name, version]) => lock.versions[name] === version) && object(lock.files), 'Unreviewed runtime lock or dependencies');
  require(requiredRuntime.every(path => Object.hasOwn(lock.files, path)) && !Object.hasOwn(lock.files, paths.admission) &&
    !Object.hasOwn(lock.files, paths.lock), 'Runtime lock omits capture owners or includes circular mutable inputs');
  for (const [path, expected] of Object.entries(lock.files)) {
    require(safePath(path) && digest(expected) && fileHashes.get(path) === expected, `Runtime source is changed or untracked: ${path}`);
  }
  const result = { sha, tree, parents, code_tree_sha256: codeTree, admission_sha256: hash(admissionBytes),
    request_sha256: hash(requestBytes), runtime_lock_sha256: hash(lockBytes) };
  checkedCheckout(result, admission, context);
  return result;
}

function checkedWorkflow(value, path, id = null) {
  require(object(value) && positive(value.id) && value.path === path && value.state === 'active' && (id === null || value.id === id),
    'Workflow numeric identity, active state or path changed');
  return value.id;
}
function checkedRun(run, workflow, workflowId, now) {
  require(object(run) && run.repository?.full_name === repository && run.head_repository?.full_name === repository &&
    run.repository.id === repositoryId && run.head_repository.id === repositoryId && positive(run.id) && positive(run.run_number) &&
    positive(run.run_attempt) && sha1(run.head_sha) && run.path === workflow && run.workflow_id === workflowId &&
    typeof run.head_branch === 'string' && run.head_branch.length > 0 && typeof run.event === 'string', 'Malformed workflow or repository run identity');
  const created = utc(run.created_at, 'run creation'), started = utc(run.run_started_at, 'run start'), updated = utc(run.updated_at, 'run update');
  require(created <= started && started <= updated && updated <= now.getTime(), 'Future or out-of-order workflow clocks');
  return run;
}
function checkedHistorical(run, expected, now) {
  checkedRun(run, expected.workflow, expected.workflow_id, now);
  require(run.id === expected.run_id && run.run_attempt === expected.run_attempt && run.run_number === expected.run_number &&
    run.head_sha === expected.head_sha && run.head_branch === expected.head_branch && run.event === 'push' &&
    run.status === expected.status && run.conclusion === expected.conclusion, 'Reviewed historical source attempt changed or is nonterminal');
  return run;
}
function checkedCurrent(run, context, admission, workflowId, checkout, now) {
  checkedRun(run, captureWorkflow, workflowId, now);
  require(run.id === context.id && run.run_number === 1 && run.run_attempt === 1 && run.head_sha === context.sha &&
    run.head_branch === captureBranch && run.event === 'push' && run.status === 'in_progress' && run.conclusion === null &&
    run.head_commit?.id === context.sha && run.head_commit?.tree_id === checkout.tree, 'Untrusted capture current run, tree or replayed attempt');
  const created = utc(run.created_at, 'current creation'), started = utc(run.run_started_at, 'current start');
  require(created >= utc(admission.dispatch_not_before, 'dispatch_not_before') &&
    created <= utc(admission.dispatch_not_after, 'dispatch_not_after') && now.getTime() - started < 1500000,
    'Current run exceeds its admitted creation window or whole-job deadline');
  return run;
}
const sameRun = (a, b) => ['id', 'run_attempt', 'run_number', 'head_sha', 'head_branch', 'workflow_id', 'path',
  'event', 'status', 'conclusion', 'created_at', 'run_started_at'].every(key => a[key] === b[key]);
function checkedCurrentJob(jobs, context, current, now) {
  require(jobs.length === 1, 'Missing or unexpected capture job inventory');
  const job = jobs[0];
  require(job.run_id === context.id && job.run_attempt === 1 && job.head_sha === context.sha && job.name === 'statement-capture' &&
    job.status === 'in_progress' && job.conclusion === null && job.completed_at === null, 'Untrusted current capture job');
  const started = utc(job.started_at, 'authenticated capture job start');
  const firstStep = utc(context.job_started_at, 'first job-step clock');
  require(utc(current.run_started_at, 'current run start') <= started && started <= firstStep && firstStep - started <= 60000 &&
    firstStep <= now.getTime() && now.getTime() - started < 1080000, 'Capture job start clock or remaining acquisition allowance invalid');
  return job;
}
function checkedJob(job, run, now) {
  require(object(job) && job.id === source.job_id && job.run_id === run.id && job.run_attempt === 1 &&
    job.head_sha === source.head_sha && job.status === 'completed' && job.conclusion === 'success', 'Source successful job binding changed');
  const started = utc(job.started_at, 'source job start'), completed = utc(job.completed_at, 'source job completion');
  require(utc(run.run_started_at, 'source start') <= started && started <= completed && completed <= utc(run.updated_at, 'source completion') &&
    completed <= now.getTime(), 'Source job is outside the successful source attempt');
}
export function checkedSourceArtifact(artifacts, run, current, now) {
  const candidates = artifacts.filter(item => item.name === source.artifact_name || item.id === source.artifact_id);
  require(candidates.length === 1, 'Missing or ambiguous reviewed source artifact; no fallback is allowed');
  const artifact = candidates[0], binding = artifact.workflow_run;
  require(artifact.id === source.artifact_id && artifact.name === source.artifact_name && artifact.expired === false &&
    artifact.digest === `sha256:${source.artifact_sha256}` && artifact.size_in_bytes === source.artifact_size_in_bytes,
    'Reviewed source artifact identity, digest, size or availability changed');
  require(binding?.id === run.id && binding.head_sha === source.head_sha && binding.head_branch === source.head_branch &&
    binding.repository_id === repositoryId && binding.head_repository_id === repositoryId, 'Source artifact owner or workflow binding changed');
  const created = utc(artifact.created_at, 'artifact creation');
  require(created >= utc(run.run_started_at, 'source start') && created <= utc(run.updated_at, 'source completion') &&
    utc(run.updated_at, 'source completion') < utc(current.created_at, 'current creation') &&
    utc(artifact.expires_at, 'artifact expiry') > now.getTime(), 'Source artifact expired or outside original attempt interval');
  return artifact;
}
const githubRead = endpoint => JSON.parse(execFileSync('gh', ['api', endpoint],
  { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 }));

export async function validateCaptureSource(admission, context, { api = githubRead, clock = () => new Date(), checkout,
  revalidate = () => checkout } = {}) {
  const begun = nowValue(clock); let last = begun;
  validateAdmission(admission, { now: begun }); checkedContext(context); checkedCheckout(checkout, admission, context);
  const inputs = JSON.stringify([admission, context, checkout]);
  function checkpoint() {
    const now = nowValue(clock);
    require(now >= last && now - begun <= admission.maximum_preflight_age_seconds * 1000, 'Source metadata preflight is stale or clock moved backwards');
    require(JSON.stringify([admission, context, checkout]) === inputs, 'Capture inputs changed across metadata await');
    validateAdmission(admission, { now }); checkedContext(context); checkedCheckout(checkout, admission, context);
    last = now; return now;
  }
  async function read(endpoint) {
    checkpoint(); const value = structuredClone(await api(endpoint)); checkpoint(); return value;
  }
  const prefix = `repos/${repository}`;
  const repo = await read(prefix);
  require(repo?.full_name === repository && repo.id === repositoryId, 'Repository numeric identity changed');
  checkedWorkflow(await read(`${prefix}/actions/workflows/${recovery.workflow_id}`), recovery.workflow, recovery.workflow_id);
  checkedWorkflow(await read(`${prefix}/actions/workflows/${source.workflow_id}`), source.workflow, source.workflow_id);
  const workflowId = checkedWorkflow(await read(`${prefix}/actions/workflows/financial-statement-capture.yml`), captureWorkflow, admission.workflow_id);
  require(![recovery.workflow_id, source.workflow_id].includes(workflowId), 'Capture and historical workflow identities collide');
  const current = checkedCurrent(await read(`${prefix}/actions/runs/${context.id}`), context, admission, workflowId, checkout, last);
  const currentAttempt = checkedCurrent(await read(`${prefix}/actions/runs/${context.id}/attempts/1`), context, admission, workflowId, checkout, last);
  require(sameRun(current, currentAttempt), 'Current run differs from its first attempt');
  const currentJobs = completeInventory(await read(`${prefix}/actions/runs/${context.id}/attempts/1/jobs?per_page=100`), 'jobs', 'current job');
  const currentJob = checkedCurrentJob(currentJobs, context, current, last);
  const ref = await read(`${prefix}/git/ref/heads/${captureBranch}`);
  require(ref?.ref === `refs/heads/${captureBranch}` && ref.object?.type === 'commit' && ref.object.sha === context.sha,
    'Capture branch has moved or does not bind the actual current SHA');
  const commit = await read(`${prefix}/git/commits/${context.sha}`);
  require(commit?.sha === context.sha && commit.tree?.sha === checkout.tree &&
    Array.isArray(commit.parents) && equal(commit.parents.map(item => item.sha), [source.head_sha]), 'Hosted current commit, tree or direct producer parent changed');
  const sourceCommit = await read(`${prefix}/git/commits/${source.head_sha}`);
  require(sourceCommit?.sha === source.head_sha && sourceCommit.tree?.sha === source.tree_sha, 'Reviewed source commit or tree changed');
  const run = checkedHistorical(await read(`${prefix}/actions/runs/${source.run_id}`), source, last);
  const attempt = checkedHistorical(await read(`${prefix}/actions/runs/${source.run_id}/attempts/1`), source, last);
  require(sameRun(run, attempt) && run.head_commit?.id === source.head_sha && run.head_commit?.tree_id === source.tree_sha,
    'Source latest attempt or producer tree changed');
  const job = await read(`${prefix}/actions/jobs/${source.job_id}`); checkedJob(job, run, last);
  const predecessor = checkedHistorical(await read(`${prefix}/actions/runs/${recovery.run_id}`), recovery, last);
  const predecessorAttempt = checkedHistorical(await read(`${prefix}/actions/runs/${recovery.run_id}/attempts/1`), recovery, last);
  require(sameRun(predecessor, predecessorAttempt) && utc(predecessor.updated_at, 'recovery completion') < utc(run.created_at, 'source creation'),
    'Recovery predecessor changed or overlaps successful source');
  const recoveryRuns = completeInventory(await read(`${prefix}/actions/workflows/${recovery.workflow_id}/runs?per_page=100`), 'workflow_runs', 'recovery');
  require(recoveryRuns.some(item => item.id === recovery.run_id), 'Exact recovery predecessor absent from complete inventory');
  for (const item of recoveryRuns) {
    checkedRun(item, recovery.workflow, recovery.workflow_id, last);
    require(item.status === 'completed' && typeof item.conclusion === 'string' && item.conclusion.length > 0, 'Concurrent or nonterminal recovery execution');
    require(item.id <= recovery.run_id && item.run_number <= recovery.run_number &&
      utc(item.updated_at, 'recovery inventory update') <= utc(predecessor.updated_at, 'reviewed recovery completion') &&
      (item.id === recovery.run_id || item.run_number < recovery.run_number), 'Newer or replayed recovery source would be leapfrogged');
    if (item.id === recovery.run_id) {
      checkedHistorical(item, recovery, last); require(sameRun(item, predecessor), 'Recovery inventory differs from exact reviewed predecessor');
    }
  }
  const successorRuns = completeInventory(await read(`${prefix}/actions/workflows/${source.workflow_id}/runs?per_page=100`), 'workflow_runs', 'successor');
  require(successorRuns.length === 1 && successorRuns[0].id === source.run_id, 'Prior, missing, newer or concurrent successor source');
  checkedHistorical(successorRuns[0], source, last);
  require(sameRun(run, successorRuns[0]), 'Successor inventory differs from exact successful source');
  const captureRuns = completeInventory(await read(`${prefix}/actions/workflows/${workflowId}/runs?per_page=100`), 'workflow_runs', 'capture');
  require(captureRuns.length === 1 && captureRuns[0].id === current.id, 'Prior, missing, newer or concurrent capture run; no replay');
  checkedCurrent(captureRuns[0], context, admission, workflowId, checkout, last);
  require(sameRun(current, captureRuns[0]), 'Capture inventory differs from first current attempt');
  const artifacts = completeInventory(await read(`${prefix}/actions/runs/${source.run_id}/artifacts?per_page=100`), 'artifacts', 'source artifact');
  const artifact = checkedSourceArtifact(artifacts, run, current, last);
  // Re-read the actual fixed inputs and all committed working bytes after I/O.
  const finalCheckout = await revalidate(); checkpoint();
  require(equal(finalCheckout, checkout), 'Checkout or capture control inputs changed during metadata verification');
  const finished = checkpoint();
  checkedCurrent(current, context, admission, workflowId, checkout, finished);
  checkedSourceArtifact(artifacts, run, current, finished); checkedJob(job, run, finished); checkedCurrentJob(currentJobs, context, current, finished);
  return { schema_version: 'financial-statement-capture-source-check-v1', request_id: requestId,
    checked_at: finished.toISOString(), metadata_started_at: begun.toISOString(), repository, repository_id: repositoryId,
    workflow_id: workflowId, admission_sha256: checkout.admission_sha256, request_sha256: checkout.request_sha256,
    runtime_lock_sha256: checkout.runtime_lock_sha256, code_tree_sha256: checkout.code_tree_sha256,
    current_tree: checkout.tree, current, current_job: currentJob, source: run, source_job: job, artifact,
    inventories: { recovery: recoveryRuns, successor: successorRuns, capture: captureRuns, artifacts, current_jobs: currentJobs },
    inventory_counts: { recovery: recoveryRuns.length, successor: successorRuns.length, capture: captureRuns.length, artifacts: artifacts.length, current_jobs: currentJobs.length },
    source_admission: 'authenticated_unadmitted', publication_authority: 'none' };
}

export function verifySourceZipBytes(zip) {
  const root = dirname(resolve(zip)), entry = readRegular(root, resolve(zip).slice(root.length + 1), source.artifact_size_in_bytes);
  require(entry.bytes.length === source.artifact_size_in_bytes && hash(entry.bytes) === source.artifact_sha256,
    'Source ZIP bytes differ from the exact reviewed successful archive');
}
export function verifyExtractedSource(root) {
  for (const [path, expected] of [['base.json', source.acquisition_base_sha256], ['cohort.json', source.cohort_sha256],
    ['archive/manifest.json', source.archive_manifest_sha256]]) {
    require(hash(readRegular(resolve(root), path).bytes) === expected, `Pinned extracted source changed: ${path}`);
  }
  require(readRegular(resolve(root), 'archive/.archive.lock', 0).bytes.length === 0, 'Exact empty retained archive lock is required');
}
// Byte inventory only: financial evidence is never interpreted or admitted here.
export function extractedInventory(root) {
  root = resolve(root);
  const rootStat = lstatSync(root);
  require(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'Unsafe extracted source root');
  const files = {}, directories = [], pending = ['']; let total = 0, entries = 0, fileCount = 0;
  while (pending.length) {
    const parent = pending.pop();
    for (const name of readdirSync(resolve(root, parent))) {
      const path = parent ? `${parent}/${name}` : name;
      require(safePath(path) && Buffer.byteLength(path) <= 512 && ++entries <= 60000, 'Unsafe or oversized extracted inventory');
      const stat = lstatSync(resolve(root, path));
      if (stat.isDirectory() && !stat.isSymbolicLink()) { directories.push(path); pending.push(path); }
      else {
        const bytes = readRegular(root, path, 32 * 1024 * 1024).bytes;
        total += bytes.length;
        require(++fileCount <= 30000 && total <= 512 * 1024 * 1024, 'Extracted source exceeds byte bounds');
        files[path] = { bytes: bytes.length, sha256: hash(bytes) };
      }
    }
  }
  require(Object.keys(files).length > 0, 'Empty extracted source');
  const implied = new Set();
  for (const name of Object.keys(files)) {
    const parts = name.split('/'); parts.pop();
    while (parts.length) { implied.add(parts.join('/')); parts.pop(); }
  }
  require(equal(directories.sort(), [...implied].sort()), 'Unexpected empty extracted directory');
  const after = lstatSync(root);
  require(after.dev === rootStat.dev && after.ino === rootStat.ino, 'Extracted source root changed');
  return { files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), directories };
}
export function verifyRestoredTree(zip, root, { timeoutMilliseconds = 30000 } = {}) {
  require(Number.isSafeInteger(timeoutMilliseconds) && timeoutMilliseconds > 0 && timeoutMilliseconds <= 30000, 'Invalid bounded source-byte timeout');
  const begun = Date.now();
  verifySourceZipBytes(zip); verifyExtractedSource(root);
  const before = extractedInventory(root);
  const expected = { schema_version: 'financial-successor-retained-inventory-v1', final_retention_verified: false, files: before.files };
  // Import only the unchanged producer's pure archive byte comparator. It does
  // not run its CLI or historical workflow/context validator, and its envelope
  // is deliberately not used as source-admission or financial certification.
  const verifier = fileURLToPath(new URL('./verify-successor-artifact.py', import.meta.url));
  const remaining = Math.floor(timeoutMilliseconds - (Date.now() - begun));
  require(remaining > 0 && remaining <= timeoutMilliseconds, 'Source snapshot exhausted its verification allowance');
  execFileSync('python', ['-I', '-c', `import importlib.util,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('capture_byte_comparator',sys.argv[1])
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
module.verify_archive(Path(sys.argv[2]),json.load(sys.stdin),sys.argv[3])
`, verifier, resolve(zip), source.artifact_sha256], { input: JSON.stringify(expected), timeout: remaining, stdio: ['pipe', 'pipe', 'pipe'] });
  verifySourceZipBytes(zip); verifyExtractedSource(root);
  require(equal(extractedInventory(root), before), 'Extracted source bytes changed during archive comparison');
  return { retained_files: Object.keys(before.files).length, zip_sha256: source.artifact_sha256, inventory_sha256: hash(Buffer.from(JSON.stringify(before))), source_admission: 'authenticated_unadmitted' };
}
function checkedRestoreProof(verified, now) {
  require(verified?.schema_version === 'financial-statement-capture-source-check-v1' && verified.request_id === requestId &&
    verified.artifact?.id === source.artifact_id && verified.artifact?.digest === `sha256:${source.artifact_sha256}` &&
    verified.source?.id === source.run_id && verified.source?.run_attempt === 1 && verified.source?.head_sha === source.head_sha &&
    verified.source_admission === 'authenticated_unadmitted', 'Missing authenticated capture source check');
  require(now.getTime() >= utc(verified.checked_at, 'source check completion') &&
    now.getTime() - utc(verified.metadata_started_at, 'source metadata start') <= 30000,
    'Restored source metadata is stale or future');
  require(now.getTime() >= utc(verified.current_job?.started_at, 'actual capture job start') &&
    now.getTime() - utc(verified.current_job.started_at, 'actual capture job start') < 1080000,
    'Restore consumed the bounded acquisition allowance');
}
function prepareSource(zip, files) {
  verifySourceZipBytes(zip); extractSuccessorSourceArchive(zip, files); verifyExtractedSource(files);
}
export async function restoreCaptureSource(verified, output, { download = (id, descriptor, { timeoutMilliseconds }) => {
  execFileSync('gh', ['api', `repos/${repository}/actions/artifacts/${id}/zip`],
    { stdio: ['ignore', descriptor, 'pipe'], timeout: timeoutMilliseconds });
}, recheck, assertReady = () => {}, clock = () => new Date(), prepare = prepareSource, verify = verifyRestoredTree } = {}) {
  let last = nowValue(clock);
  const time = () => { const now = nowValue(clock); require(now >= last, 'Restore actual clock moved backwards'); last = now; return now; };
  checkedRestoreProof(verified, last);
  require(typeof recheck === 'function', 'A fresh post-download source recheck is required');
  const originalBinding = JSON.stringify([verified.current.id, verified.current.head_sha, verified.current_tree,
    verified.current_job.id, verified.current_job.started_at, verified.admission_sha256, verified.request_sha256, verified.runtime_lock_sha256, verified.code_tree_sha256]);
  assertReady();
  const root = resolve(output); mkdirSync(root, { recursive: false });
  const rootIdentity = lstatSync(root); let filesIdentity;
  function checkDirectories() {
    const named = lstatSync(root);
    require(named.isDirectory() && !named.isSymbolicLink() && sameInode(named, rootIdentity), 'Restore output directory was replaced or detached');
    if (filesIdentity) {
      const files = lstatSync(resolve(root, 'files'));
      require(files.isDirectory() && !files.isSymbolicLink() && sameInode(files, filesIdentity), 'Extracted source directory was replaced or detached');
    }
  }
  const zip = resolve(root, 'source.zip');
  const downloadAllowance = Math.floor(Math.min(120000, 1080000 - (time().getTime() - utc(verified.current_job.started_at, 'actual job start'))));
  require(downloadAllowance > 0, 'No download acquisition allowance remains');
  const descriptor = openSync(zip, 'wx');
  try { await download(source.artifact_id, descriptor, { timeoutMilliseconds: downloadAllowance }); } finally { closeSync(descriptor); }
  time();
  // No prior check is represented as still fresh after a potentially slow download.
  assertReady(); checkDirectories();
  prepare(zip, resolve(root, 'files'));
  filesIdentity = lstatSync(resolve(root, 'files'));
  assertReady(); checkDirectories();
  const restoredAt = time();
  const fresh = await recheck();
  assertReady(); checkedRestoreProof(fresh, time());
  require(utc(fresh.metadata_started_at, 'postrestore metadata start') >= restoredAt.getTime(), 'Postrestore check predates restoration');
  require(JSON.stringify([fresh.current.id, fresh.current.head_sha, fresh.current_tree, fresh.current_job.id, fresh.current_job.started_at, fresh.admission_sha256,
    fresh.request_sha256, fresh.runtime_lock_sha256, fresh.code_tree_sha256]) === originalBinding,
    'Postrestore metadata or reviewed inputs changed');
  const atComparison = time().getTime();
  const remaining = Math.floor(Math.min(30000 - (atComparison - utc(fresh.metadata_started_at, 'fresh metadata start')),
    1080000 - (atComparison - utc(fresh.current_job.started_at, 'actual capture job start'))));
  require(remaining > 0, 'No postrestore byte-verification allowance remains');
  const outputProof = verify(zip, resolve(root, 'files'), { timeoutMilliseconds: remaining });
  const checkOutput = () => {
    checkDirectories();
    require(digest(outputProof?.inventory_sha256) && digest(outputProof?.zip_sha256) &&
    hash(readRegular(root, 'source.zip', source.artifact_size_in_bytes).bytes) === outputProof.zip_sha256 &&
    hash(Buffer.from(JSON.stringify(extractedInventory(resolve(root, 'files'))))) === outputProof.inventory_sha256,
    'Restored output changed after byte verification');
    checkDirectories();
  };
  assertReady(); checkOutput(); checkedRestoreProof(fresh, time());
  const provenance = { schema_version: 'financial-statement-capture-source-restore-v1', kind: 'authenticated_unadmitted_successor',
    ...source, request_id: requestId, source_admission: 'authenticated_unadmitted', publication_authority: 'none' };
  const checkBytes = Buffer.from(JSON.stringify(fresh, null, 2));
  const provenanceBytes = Buffer.from(JSON.stringify(provenance, null, 2));
  // Keep the directory and both owned marker inodes open until all callbacks,
  // byte checks and clock checks finish. On failure truncate those exact inodes,
  // even if renamed; never delete or truncate a replacement at an old pathname.
  const directory = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const markers = [];
  const anchored = name => `/proc/self/fd/${directory}/${name}`;
  function writeMarker(name, bytes) {
    const fd = openSync(anchored(name), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const owned = { name, bytes, fd, inode: fstatSync(fd) }; markers.push(owned);
    writeFileSync(fd, bytes); fsyncSync(fd); owned.identity = fileIdentity(fstatSync(fd));
  }
  function checkMarkers() {
    checkDirectories();
    require(sameInode(fstatSync(directory), rootIdentity), 'Owned restore output directory changed');
    for (const marker of markers) {
      const retained = readRegular(root, marker.name);
      require(equal(fileIdentity(fstatSync(marker.fd)), marker.identity) && equal(retained.identity, marker.identity) &&
        retained.bytes.equals(marker.bytes), `Retained restore metadata bytes or identity changed: ${marker.name}`);
    }
    checkDirectories();
  }
  try {
    require(sameInode(fstatSync(directory), rootIdentity), 'Restore directory changed before metadata creation');
    writeMarker('source-check.json', checkBytes);
    assertReady(); checkOutput(); checkedRestoreProof(fresh, time()); checkMarkers();
    writeMarker('restored.json', provenanceBytes);
    assertReady(); checkOutput(); checkedRestoreProof(fresh, time()); checkMarkers();
  } catch (error) {
    for (const marker of markers) {
      ftruncateSync(marker.fd, 0); fsyncSync(marker.fd);
      try {
        if (sameInode(lstatSync(anchored(marker.name)), marker.inode)) unlinkSync(anchored(marker.name));
      } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') throw cleanupError; }
    }
    throw error;
  } finally {
    for (const marker of markers) closeSync(marker.fd);
    closeSync(directory);
  }
  return provenance;
}

export async function main(argv = process.argv.slice(2)) {
  const checkOnly = argv.length === 1 && argv[0] === '--check-only';
  const output = argv.length === 2 && argv[0] === '--output' && argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
  require(checkOnly || output, 'Usage: node restore-statement-capture-source.mjs (--check-only | --output NEW_DIR)');
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const admissionBytes = readRegular(root, paths.admission, 1024 * 1024).bytes;
  const admission = JSON.parse(admissionBytes); validateAdmission(admission);
  const context = contextFromEnvironment(), checkout = verifyCheckout(root, admission, context);
  function revalidate() {
    validateAdmission(admission);
    require(readRegular(root, paths.admission, 1024 * 1024).bytes.equals(admissionBytes), 'Fixed admission changed across metadata I/O');
    require(equal(contextFromEnvironment(), context), 'Actual workflow context changed');
    const current = verifyCheckout(root, admission, context);
    require(equal(current, checkout), 'Checkout or reviewed inputs changed during restore');
    return current;
  }
  let authenticatedJobStart;
  function assertReady() {
    revalidate();
    if (authenticatedJobStart !== undefined) require(Date.now() - authenticatedJobStart < 1080000 &&
      Date.now() >= authenticatedJobStart, 'Restore consumed the bounded acquisition allowance');
  }
  async function recheck() {
    assertReady();
    const proof = await validateCaptureSource(admission, context, { checkout, revalidate });
    authenticatedJobStart = utc(proof.current_job.started_at, 'authenticated current job start');
    return proof;
  }
  const verified = await recheck();
  const result = checkOnly ? verified : await restoreCaptureSource(verified, output, { recheck, assertReady });
  console.log(JSON.stringify(result)); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
