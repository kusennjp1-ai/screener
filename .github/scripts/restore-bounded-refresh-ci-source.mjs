// Read one historical artifact for an isolated test. Grants no recovery authority.
import {execFileSync} from 'node:child_process';
import {closeSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {githubApi} from './publication-gate.mjs';
import {sha256} from './publication-state.mjs';
import {checkedArtifact, extractSourceArchive, repository, recoveryWorkflow} from './restore-statement-source.mjs';

export const validationBranch = 'preview/bounded-statement-refresh-ci';
export const validationWorkflow = '.github/workflows/bounded-statement-refresh-validation.yml';
const reviewRoot = fileURLToPath(new URL('../bounded-refresh-first-200/', import.meta.url));
const reviewHash = '9ab65a7afb2033297b0f286a64de7ad1650fdb64ac9bd77f2def672ac4ed05a0';
const admissionHash = '2459f355409fdbb03a9b9bb936eb2b4b56081dd4e37d9d7d3f7026900857bd5e';
const repositoryId = 1203919607, originalZipBytes = 27524165;
const positive = value => Number.isSafeInteger(value) && value > 0;
const fail = (condition, reason) => { if (!condition) throw Error(reason); };

export function pinnedReview() {
  const bytes = readFileSync(resolve(reviewRoot, 'dispatch-review.json'));
  const admissionBytes = readFileSync(resolve(reviewRoot, 'dispatch-admission.json'));
  fail(sha256(bytes) === reviewHash && sha256(admissionBytes) === admissionHash, 'CI review/admission bytes changed');
  const review = JSON.parse(bytes), admission = JSON.parse(admissionBytes);
  fail(review.dispatch_approved === false && admission.execution_enabled === false && admission.expected_run_number === null,
    'CI must retain disabled source admission');
  return review;
}

const sameRepository = run => run?.repository?.full_name === repository && run?.head_repository?.full_name === repository
  && run.repository.id === repositoryId && run.head_repository.id === repositoryId;

export function verifyCiSource(context, api = githubApi) {
  const review = pinnedReview(), source = review.input_source;
  fail(context.repository === repository && context.branch === validationBranch && context.event === 'push'
    && positive(context.id) && positive(context.attempt) && /^[a-f0-9]{40}$/.test(context.sha ?? ''), 'Invalid isolated validation context');
  const current = api(`repos/${repository}/actions/runs/${context.id}`);
  fail(current.id === context.id && current.run_attempt === context.attempt && current.head_sha === context.sha
    && current.head_branch === validationBranch && current.path === validationWorkflow && current.event === 'push'
    && current.status === 'in_progress' && positive(current.workflow_id) && sameRepository(current), 'CI caller identity changed');
  const main = api(`repos/${repository}/git/ref/heads/main`);
  fail(main.object?.sha === review.main_must_remain, 'Frozen publication main changed');
  const inventory = api(`repos/${repository}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`);
  fail(Number.isSafeInteger(inventory.total_count) && inventory.total_count >= 0 && inventory.total_count <= 100
    && Array.isArray(inventory.workflow_runs) && inventory.workflow_runs.length === inventory.total_count,
  'Incomplete recovery inventory');
  const latest = inventory.workflow_runs.filter(run => run.path === recoveryWorkflow && run.head_branch === review.source_branch
    && run.event === 'push' && sameRepository(run)).sort((a,b) => b.id-a.id)[0];
  fail(latest?.id === source.run_id && latest.run_attempt === source.run_attempt && latest.head_sha === source.head_sha
    && latest.status === 'completed', 'Pinned source is no longer the terminal recovery predecessor');
  for (const run of inventory.workflow_runs) if (run.path === recoveryWorkflow && sameRepository(run)) {
    fail(run.status === 'completed', 'A recovery execution is nonterminal');
  }
  const run = api(`repos/${repository}/actions/runs/${source.run_id}/attempts/${source.run_attempt}`);
  fail(run.id === source.run_id && run.run_attempt === source.run_attempt && run.head_sha === source.head_sha
    && run.head_branch === review.source_branch && run.path === recoveryWorkflow && run.event === 'push'
    && run.status === 'completed' && run.conclusion === 'success' && positive(run.workflow_id)
    && run.workflow_id === latest.workflow_id && sameRepository(run), 'Original producer attempt changed');
  const jobs = api(`repos/${repository}/actions/runs/${source.run_id}/attempts/${source.run_attempt}/jobs?per_page=100`);
  fail(Number.isSafeInteger(jobs.total_count) && jobs.total_count >= 0 && jobs.total_count <= 100
    && Array.isArray(jobs.jobs) && jobs.jobs.length === jobs.total_count, 'Incomplete source job inventory');
  const matching = jobs.jobs.filter(job => job.name === 'statement-recovery');
  fail(matching.length === 1, 'Missing or ambiguous original producer job');
  const job = matching[0];
  fail(positive(job.id) && job.run_id === run.id && job.run_attempt === run.run_attempt && job.head_sha === run.head_sha
    && job.status === 'completed' && job.conclusion === run.conclusion, 'Original producer job changed');
  const list = api(`repos/${repository}/actions/runs/${source.run_id}/artifacts?per_page=100`);
  fail(Number.isSafeInteger(list.total_count) && list.total_count >= 0 && list.total_count <= 100
    && Array.isArray(list.artifacts) && list.artifacts.length === list.total_count, 'Incomplete source artifact inventory');
  // Unmodified production artifact/attempt-interval and extraction checks.
  const artifact = checkedArtifact(list.artifacts, run, false, current);
  fail(artifact.id === source.artifact_id && artifact.name === source.artifact_name && artifact.expired === false
    && artifact.digest === `sha256:${source.artifact_sha256}` && artifact.size_in_bytes === originalZipBytes,
  'Exact original artifact identity changed');
  const times = [run.run_started_at, job.started_at, artifact.created_at, job.completed_at, current.run_started_at].map(Date.parse);
  fail(times.every(Number.isFinite) && times.every((value, i) => i === 0 || times[i-1] <= value)
    && times[3] < times[4], 'Original source/validation execution clocks changed');
  return {schema_version:'bounded-refresh-ci-source-read-v1', authority:'test_evidence_only', publication_authority:'none',
    source, current, frozen_main:main.object.sha, run, jobs:jobs.jobs, artifacts:list.artifacts, artifact};
}

async function main() {
  const [directory, reports, ...extra] = process.argv.slice(2);
  fail(directory && reports && extra.length === 0, 'Usage: restore-bounded-refresh-ci-source.mjs NEW_RESTORE_DIRECTORY REPORT_DIRECTORY');
  const evidence = verifyCiSource({repository:process.env.GITHUB_REPOSITORY, branch:process.env.GITHUB_REF_NAME,
    event:process.env.GITHUB_EVENT_NAME, id:Number(process.env.GITHUB_RUN_ID), attempt:Number(process.env.GITHUB_RUN_ATTEMPT), sha:process.env.GITHUB_SHA});
  const root = resolve(directory), reportRoot = resolve(reports);
  mkdirSync(root, {recursive:false}); mkdirSync(reportRoot, {recursive:true});
  writeFileSync(resolve(reportRoot, 'source-api-evidence.json'), JSON.stringify(evidence,null,2), {flag:'wx'});
  const zip = resolve(root,'source.zip'), descriptor = openSync(zip,'wx');
  try { execFileSync('gh',['api',`repos/${repository}/actions/artifacts/${evidence.source.artifact_id}/zip`], {stdio:['ignore',descriptor,'pipe']}); }
  finally { closeSync(descriptor); }
  fail(statSync(zip).size === originalZipBytes && sha256(readFileSync(zip)) === evidence.source.artifact_sha256, 'Original artifact download bytes changed');
  extractSourceArchive(zip,resolve(root,'files'));
  const source = evidence.source;
  const provenance = {schema_version:'financial-source-restore-v1',kind:'recovery_archive',repository,
    run_id:source.run_id,run_attempt:source.run_attempt,head_sha:source.head_sha,artifact_id:source.artifact_id,artifact_sha256:source.artifact_sha256};
  writeFileSync(resolve(root,'restored.json'),JSON.stringify(provenance,null,2),{flag:'wx'});
  console.log(JSON.stringify({authority:'test_evidence_only',...provenance}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
