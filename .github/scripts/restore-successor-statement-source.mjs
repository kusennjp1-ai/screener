// A separate, one-shot successor gate. Never writes GitHub or contacts a provider.
import { execFileSync } from 'node:child_process';
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { githubApi } from './publication-gate.mjs';
import { sha256 } from './publication-state.mjs';
import { extractSourceArchive } from './restore-statement-source.mjs';

export const repository = 'kusennjp1-ai/screener';
export const repositoryId = 1203919607;
export const successorWorkflow = '.github/workflows/financial-statement-successor.yml';
export const successorBranch = 'improve/financial-retention-successor';
export const admissionSchema = 'financial-statement-successor-admission-v1';
export const source = Object.freeze({
  repository, run_id: 37478731832, run_attempt: 1, run_number: 4,
  head_branch: 'improve/mandatory-financial-source-recovery', status: 'completed',
  head_sha: '4715b218cc25720d1d3be455930554e1e6282136',
  workflow: '.github/workflows/financial-statement-recovery.yml', workflow_id: 374552819,
  conclusion: 'failure',
  artifact_id: 11420873789,
  artifact_name: 'financial-statement-recovery-4715b218cc25720d1d3be455930554e1e6282136-1',
  artifact_sha256: '266b2118cefe4a51dcf0981b4e60c35ba76524e1f35cf9633f8c26691f68d2bd',
  artifact_size_in_bytes: 33424519,
});
const positive = value => Number.isSafeInteger(value) && value > 0;
const require = (condition, message) => { if (!condition) throw Error(message); };
const utc = (value, name) => {
  require(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value), `Invalid UTC ${name}`);
  const clock = Date.parse(value);
  require(Number.isFinite(clock) && new Date(clock).toISOString() === value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z'), `Invalid UTC ${name}`);
  return clock;
};
const nowValue = clock => {
  const value = clock();
  require(value instanceof Date && Number.isFinite(value.getTime()), 'Invalid validation clock');
  return value;
};

export function validateAdmission(admission, { now = new Date(), dryRun = false } = {}) {
  require(admission && typeof admission === 'object' && !Array.isArray(admission), 'Missing successor admission');
  require(admission.schema_version === admissionSchema && typeof admission.request_id === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(admission.request_id), 'Invalid successor admission identity');
  require(typeof admission.execution_enabled === 'boolean', 'Invalid execution admission');
  require(dryRun === true || admission.execution_enabled === true, 'Successor execution is disabled pending separate approval');
  require(admission.repository === repository && admission.workflow === successorWorkflow &&
    admission.branch === successorBranch && admission.event === 'push' && admission.expected_run_number === 1 &&
    admission.first_attempt_only === true, 'Successor admission scope changed');
  require(admission.repository_id === repositoryId, 'Admission requires the verified numeric repository identity');
  require(admission.workflow_id == null || positive(admission.workflow_id), 'Invalid successor workflow identity');
  require(admission.source && Object.entries(source).every(([key, value]) => admission.source[key] === value), 'Reviewed source identity changed');
  const before = utc(admission.dispatch_not_before, 'dispatch_not_before');
  const after = utc(admission.dispatch_not_after, 'dispatch_not_after');
  require(now instanceof Date && Number.isFinite(now.getTime()) && before < after &&
    before <= now.getTime() && now.getTime() <= after, 'Successor dispatch is stale or outside the reviewed UTC window');
  return admission;
}

export function contextFromEnvironment(env = process.env) {
  const number = key => /^\d+$/.test(env[key] ?? '') ? Number(env[key]) : NaN;
  return { id: number('GITHUB_RUN_ID'), attempt: number('GITHUB_RUN_ATTEMPT'),
    run_number: number('GITHUB_RUN_NUMBER'), sha: env.GITHUB_SHA, branch: env.GITHUB_REF_NAME,
    repository: env.GITHUB_REPOSITORY, event: env.GITHUB_EVENT_NAME };
}

export function completeInventory(value, key, label) {
  require(value && Number.isSafeInteger(value.total_count) && value.total_count >= 0 && value.total_count <= 100 &&
    Array.isArray(value[key]) && value[key].length === value.total_count, `Incomplete or oversized ${label} inventory`);
  const ids = value[key].map(item => item?.id);
  require(ids.every(positive) && new Set(ids).size === ids.length, `Invalid or duplicate ${label} inventory identity`);
  return value[key];
}

function checkedRepository(run, repositoryId) {
  require(run?.repository?.full_name === repository && run?.head_repository?.full_name === repository &&
    run.repository.id === repositoryId && run.head_repository.id === repositoryId, 'Workflow repository identity changed');
}

function checkedWorkflow(value, path, expectedId = null) {
  require(value && positive(value.id) && value.path === path && value.state === 'active' &&
    (expectedId === null || value.id === expectedId), 'Workflow numeric identity or path changed');
  return value.id;
}

function checkedRun(run, workflow, workflowId, repositoryId, now) {
  checkedRepository(run, repositoryId);
  require(positive(run.id) && positive(run.run_number) && positive(run.run_attempt) &&
    /^[a-f0-9]{40}$/.test(run.head_sha ?? '') && run.path === workflow && run.workflow_id === workflowId &&
    typeof run.head_branch === 'string' && run.head_branch.length > 0 && typeof run.event === 'string', 'Malformed workflow run identity');
  const created = utc(run.created_at, 'run creation');
  const started = utc(run.run_started_at, 'run start');
  const updated = utc(run.updated_at, 'run update');
  require(now instanceof Date && Number.isFinite(now.getTime()) &&
    created <= started && started <= updated && updated <= now.getTime(),
  'Future or out-of-order workflow clocks');
  return run;
}

function checkedCurrent(run, context, admission, workflowId, now) {
  checkedRun(run, successorWorkflow, workflowId, admission.repository_id, now);
  require(run.id === context.id && run.run_attempt === 1 && run.run_number === 1 && run.head_sha === context.sha &&
    run.head_branch === successorBranch && run.event === 'push' && run.status === 'in_progress' && run.conclusion === null,
  'Untrusted successor current run or repeated attempt/run number');
  const created = utc(run.created_at, 'current creation'), started = utc(run.run_started_at, 'current start');
  const updated = utc(run.updated_at, 'current update');
  require(created >= utc(admission.dispatch_not_before, 'dispatch_not_before') && created <= started &&
    started <= updated && updated <= now.getTime() && now.getTime() - started <= 1500 * 1000,
  'Stale, future or out-of-order current workflow clocks');
  return run;
}

function checkedSource(run, admission, now) {
  checkedRun(run, source.workflow, source.workflow_id, admission.repository_id, now);
  require(run.id === source.run_id && run.run_attempt === source.run_attempt && run.head_sha === source.head_sha &&
    run.run_number === source.run_number && run.head_branch === source.head_branch && run.event === 'push' &&
    run.status === source.status && run.conclusion === source.conclusion, 'Reviewed source attempt is changed or nonterminal');
  require(utc(run.created_at, 'source creation') <= utc(run.run_started_at, 'source start') &&
    utc(run.run_started_at, 'source start') <= utc(run.updated_at, 'source completion'), 'Invalid source chronology');
  return run;
}

const sameRun = (left, right) => ['id', 'run_attempt', 'run_number', 'head_sha', 'head_branch', 'workflow_id', 'path',
  'event', 'status', 'conclusion', 'created_at', 'run_started_at'].every(key => left[key] === right[key]);

export function checkedSourceArtifact(artifacts, run, current, now) {
  const selected = artifacts.filter(item => item.name === source.artifact_name || item.id === source.artifact_id);
  require(selected.length === 1, 'Missing or ambiguous reviewed source artifact; no fallback is allowed');
  const artifact = selected[0];
  require(artifact.id === source.artifact_id && artifact.name === source.artifact_name && artifact.expired === false &&
    artifact.digest === `sha256:${source.artifact_sha256}` && artifact.size_in_bytes === source.artifact_size_in_bytes,
  'Reviewed source artifact identity, digest, size or availability changed');
  const binding = artifact.workflow_run;
  require(binding?.id === run.id && binding.head_sha === run.head_sha && binding.head_branch === run.head_branch &&
    binding.repository_id === run.repository.id && binding.head_repository_id === run.head_repository.id,
  'Source artifact workflow or repository binding changed');
  const created = utc(artifact.created_at, 'artifact creation');
  require(created >= utc(run.run_started_at, 'source start') && created <= utc(run.updated_at, 'source completion') &&
    utc(run.updated_at, 'source completion') < utc(current.created_at, 'current creation') &&
    utc(artifact.expires_at, 'artifact expiry') > now.getTime(), 'Source artifact is expired or outside its original attempt interval');
  return artifact;
}

export function validateSuccessorSource(admission, context, { api = githubApi, clock = () => new Date() } = {}) {
  const begun = nowValue(clock);
  validateAdmission(admission, { now: begun });
  require(context && positive(context.id) && context.id > source.run_id && context.attempt === 1 && context.run_number === 1 &&
    /^[a-f0-9]{40}$/.test(context.sha ?? '') && context.repository === repository && context.branch === successorBranch &&
    context.event === 'push', 'Invalid successor execution context or repeated attempt/run number');
  const prefix = `repos/${repository}`;
  const repo = api(prefix);
  require(repo?.full_name === repository && repo.id === admission.repository_id, 'Repository numeric identity changed');
  checkedWorkflow(api(`${prefix}/actions/workflows/${source.workflow_id}`), source.workflow, source.workflow_id);
  // A new workflow obtains its ID on first creation. Resolve the fixed path once,
  // bind it to the authenticated run, then use only the numeric inventory route.
  const workflowId = checkedWorkflow(api(`${prefix}/actions/workflows/financial-statement-successor.yml`),
    successorWorkflow, admission.workflow_id ?? null);
  require(workflowId !== source.workflow_id, 'Source and successor workflow identities collide');
  const current = checkedCurrent(api(`${prefix}/actions/runs/${context.id}`), context, admission, workflowId, begun);
  const currentAttempt = checkedCurrent(api(`${prefix}/actions/runs/${context.id}/attempts/1`), context, admission, workflowId, begun);
  require(sameRun(current, currentAttempt), 'Current attempt endpoint differs from current run');
  const run = checkedSource(api(`${prefix}/actions/runs/${source.run_id}`), admission, begun);
  const attempt = checkedSource(api(`${prefix}/actions/runs/${source.run_id}/attempts/1`), admission, begun);
  require(sameRun(run, attempt), 'Source latest attempt differs from its reviewed attempt');
  // No event/branch filter may hide a concurrent run or an intervening source.
  const originalRuns = completeInventory(api(`${prefix}/actions/workflows/${source.workflow_id}/runs?per_page=100`), 'workflow_runs', 'source workflow');
  require(originalRuns.some(item => item.id === source.run_id), 'Reviewed source is absent from the complete workflow inventory');
  for (const item of originalRuns) {
    checkedRun(item, source.workflow, source.workflow_id, admission.repository_id, begun);
    require(item.status === 'completed', 'Another recovery execution is nonterminal or concurrent');
    require(item.id <= source.run_id && item.run_number <= run.run_number &&
      utc(item.updated_at, 'source inventory update') <= utc(run.updated_at, 'source completion') &&
      (item.id === source.run_id || item.run_number < run.run_number), 'Unknown newer source would be leapfrogged');
    if (item.id === source.run_id) {
      checkedSource(item, admission, begun);
      require(sameRun(run, item), 'Source inventory differs from the reviewed attempt');
    }
  }
  const successorRuns = completeInventory(api(`${prefix}/actions/workflows/${workflowId}/runs?per_page=100`), 'workflow_runs', 'successor workflow');
  require(successorRuns.length === 1 && successorRuns[0].id === current.id,
    'Prior, concurrent, missing or newer successor run; refusing to leapfrog or repeat');
  checkedCurrent(successorRuns[0], context, admission, workflowId, begun);
  require(sameRun(current, successorRuns[0]), 'Successor inventory differs from current attempt');
  const artifacts = completeInventory(api(`${prefix}/actions/runs/${source.run_id}/artifacts?per_page=100`), 'artifacts', 'source artifact');
  const artifact = checkedSourceArtifact(artifacts, run, current, begun);
  const finished = nowValue(clock);
  require(finished.getTime() >= begun.getTime() && finished.getTime() - begun.getTime() <= 60_000, 'Source admission verification is stale');
  validateAdmission(admission, { now: finished });
  checkedCurrent(current, context, admission, workflowId, finished);
  checkedSourceArtifact(artifacts, run, current, finished);
  return { schema_version: 'financial-successor-source-check-v1', request_id: admission.request_id,
    checked_at: finished.toISOString(), repository, repository_id: repo.id, workflow_id: workflowId,
    current, source: run, artifact, inventory_counts: { source: originalRuns.length, successor: successorRuns.length, artifacts: artifacts.length } };
}

export function verifySourceZipBytes(zip) {
  const stat = lstatSync(zip);
  require(stat.isFile() && !stat.isSymbolicLink() && stat.size === source.artifact_size_in_bytes,
    'Source ZIP byte size differs from the immutable reviewed archive');
  require(sha256(readFileSync(zip)) === source.artifact_sha256, 'Source ZIP bytes do not match the immutable reviewed digest');
}

export function extractSuccessorSourceArchive(zip, directory) {
  // Retain the historical bounded extractor, adding a strict allowlist for the
  // only hidden member included by the new uploader. It owns zero source bytes.
  execFileSync('python3', ['-c', `import stat,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 for m in z.infolist():
  parts=m.filename.rstrip('/').split('/')
  if any(p.startswith('.') for p in parts):
   mode=m.external_attr>>16
   assert m.filename=='archive/.archive.lock' and m.file_size==0 and not m.is_dir() and (not stat.S_IFMT(mode) or stat.S_ISREG(mode)), 'Unapproved hidden source member or invalid archive lock'
`, zip], { stdio: 'pipe' });
  extractSourceArchive(zip, directory);
}

export function restoreSuccessorSource(verified, output, { download = (id, descriptor) => {
  execFileSync('gh', ['api', `repos/${repository}/actions/artifacts/${id}/zip`], { stdio: ['ignore', descriptor, 'pipe'] });
} } = {}) {
  // A caller cannot supply an alternative artifact through this restoration API.
  require(verified?.schema_version === 'financial-successor-source-check-v1' && verified.artifact?.id === source.artifact_id &&
    verified.artifact?.digest === `sha256:${source.artifact_sha256}`, 'Missing verified source check');
  const root = resolve(output); mkdirSync(root, { recursive: false });
  const zip = resolve(root, 'source.zip'), descriptor = openSync(zip, 'wx');
  try { download(source.artifact_id, descriptor); } finally { closeSync(descriptor); }
  verifySourceZipBytes(zip);
  extractSuccessorSourceArchive(zip, resolve(root, 'files'));
  const provenance = { schema_version: 'financial-source-restore-v1', kind: 'recovery_archive',
    repository, run_id: source.run_id, run_attempt: source.run_attempt, head_sha: source.head_sha,
    artifact_id: source.artifact_id, artifact_sha256: source.artifact_sha256 };
  writeFileSync(resolve(root, 'restored.json'), JSON.stringify(provenance, null, 2), { flag: 'wx' });
  writeFileSync(resolve(root, 'source-check.json'), JSON.stringify(verified, null, 2), { flag: 'wx' });
  return provenance;
}

export function main(argv = process.argv.slice(2)) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    require(['--admission', '--output', '--check-only'].includes(key) && !Object.hasOwn(values, key), 'Unknown or duplicate successor CLI option');
    if (key === '--check-only') values[key] = true;
    else {
      require(typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('--'), `Missing value for ${key}`);
      values[key] = argv[++i];
    }
  }
  const checkOnly = values['--check-only'] === true;
  require(values['--admission'] && (checkOnly ? !values['--output'] : values['--output']),
    'Usage: node restore-successor-statement-source.mjs --admission PATH (--check-only | --output DIR)');
  const admissionPath = resolve(values['--admission']);
  const stat = lstatSync(admissionPath);
  require(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024, 'Invalid successor admission file');
  const content = readFileSync(admissionPath);
  const admission = JSON.parse(content);
  // No flag or environment variable can turn the disabled private candidate on.
  validateAdmission(admission);
  const context = contextFromEnvironment();
  const checkout = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8', timeout: 10000 }).trim();
  require(/^[a-f0-9]{40}$/.test(checkout) && checkout === context.sha, 'Checked-out revision differs from the current workflow head');
  const verified = validateSuccessorSource(admission, context);
  verified.admission_sha256 = sha256(content);
  const result = checkOnly ? verified : restoreSuccessorSource(verified, values['--output']);
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
