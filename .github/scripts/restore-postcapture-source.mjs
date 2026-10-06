// Exact retained-source retrieval only. This never invokes source acquisition.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {githubApi} from './publication-gate.mjs';

export const repository = 'kusennjp1-ai/screener';
export const validationBranch = 'preview/financial-source-postcapture-validation';
export const validationWorkflow = '.github/workflows/financial-source-postcapture-validation.yml';
export const mainCommit = '8a490df5b0a873637781a8e4e5351cece9313f37';
export const mainTree = '00a8eaa6b14b977f31f24ac9f708872c2dbe5ee9';
export const requestSha256 = 'd8f06454c41eda4cd7707cdd69a10236b34b690ccd0370fcdcf396d444758e43';
const repositoryId = 1203919607;
const sourceBranch = 'improve/mandatory-financial-source-recovery';
const sourceWorkflow = '.github/workflows/financial-statement-recovery.yml';
const root = fileURLToPath(new URL('../financial-source-postcapture/', import.meta.url));
const checkoutRoot = fileURLToPath(new URL('../../', import.meta.url));
const positive = x => Number.isSafeInteger(x) && x > 0;
const fail = (condition, reason) => { if (!condition) throw Error(reason); };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sameRepository = run => run?.repository?.full_name === repository && run?.head_repository?.full_name === repository
  && run.repository.id === repositoryId && run.head_repository.id === repositoryId;

export function pinnedRequest() {
  const bytes = readFileSync(resolve(root, 'request.json'));
  fail(sha256(bytes) === requestSha256, 'Unreviewed postcapture request bytes');
  return JSON.parse(bytes);
}

function checkoutIdentity() {
  const git = args => execFileSync('git', args, {cwd:checkoutRoot, encoding:'utf8', maxBuffer:16*1024*1024}).trim();
  return {head:git(['rev-parse','HEAD']), tree:git(['rev-parse','HEAD^{tree}']), clean:git(['status','--porcelain']) === ''};
}

function inventory(value, key, label) {
  fail(Number.isSafeInteger(value?.total_count) && value.total_count >= 0 && value.total_count <= 100
    && Array.isArray(value[key]) && value[key].length === value.total_count, `Incomplete ${label} inventory`);
  return value[key];
}

export function verifyPostcaptureSource(context, api = githubApi, checkout = checkoutIdentity, now = Date.now) {
  const request = pinnedRequest(), source = request.source;
  fail(context.repository === repository && context.branch === validationBranch && context.event === 'push'
    && positive(context.id) && context.attempt === 1 && /^[a-f0-9]{40}$/.test(context.sha ?? ''), 'Invalid validation caller context');
  const local = checkout();
  fail(local.clean === true && local.head === context.sha && /^[a-f0-9]{40}$/.test(local.tree ?? ''), 'Unclean or different validation checkout');
  const current = api(`repos/${repository}/actions/runs/${context.id}`);
  fail(current.id === context.id && current.run_attempt === 1 && current.head_sha === context.sha
    && current.head_branch === validationBranch && current.path === validationWorkflow && current.event === 'push'
    && current.status === 'in_progress' && current.conclusion === null && positive(current.workflow_id)
    && current.head_commit?.id === context.sha && current.head_commit.tree_id === local.tree
    && sameRepository(current), 'Validation caller identity changed');
  fail(api(`repos/${repository}/git/ref/heads/${validationBranch}`).object?.sha === context.sha, 'Validation branch moved');
  fail(api(`repos/${repository}/git/ref/heads/main`).object?.sha === mainCommit, 'Reviewed main changed');
  fail(api(`repos/${repository}/git/ref/heads/${sourceBranch}`).object?.sha === source.head_sha, 'Producer branch moved');
  const commit = api(`repos/${repository}/git/commits/${context.sha}`);
  fail(commit.sha === context.sha && commit.tree?.sha === local.tree && commit.parents?.length === 1
    && commit.parents[0].sha === mainCommit, 'Validator commit/tree/base mismatch');
  const tree = api(`repos/${repository}/git/trees/${commit.tree.sha}?recursive=1`);
  fail(tree.sha === local.tree && tree.truncated === false && Array.isArray(tree.tree)
    && tree.tree.length > 0 && tree.tree.length <= 30000, 'Incomplete validator code tree');
  const currentJobs = inventory(api(`repos/${repository}/actions/runs/${context.id}/attempts/1/jobs?per_page=100`), 'jobs', 'validator job');
  const matchingJobs = currentJobs.filter(job => job.name === 'validate-captured-source');
  fail(matchingJobs.length === 1, 'Missing or ambiguous validator job');
  const validatorJob = matchingJobs[0];
  fail(positive(validatorJob.id) && validatorJob.run_id === current.id && validatorJob.run_attempt === 1
    && validatorJob.head_sha === current.head_sha && validatorJob.status === 'in_progress' && validatorJob.conclusion === null,
  'Validator job identity changed');

  const recoveries = inventory(api(`repos/${repository}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`), 'workflow_runs', 'recovery');
  for (const run of recoveries) if (sameRepository(run) && run.path === sourceWorkflow) {
    fail(run.status === 'completed', 'A recovery execution is nonterminal');
  }
  const latest = recoveries.filter(run => sameRepository(run) && run.path === sourceWorkflow
    && run.head_branch === sourceBranch && run.event === 'push').sort((a,b) => b.id-a.id)[0];
  fail(latest?.id === source.run_id && latest.run_attempt === 1 && latest.head_sha === source.head_sha,
    'Pinned source is no longer the latest recovery attempt');
  const run = api(`repos/${repository}/actions/runs/${source.run_id}/attempts/1`);
  fail(run.id === source.run_id && run.run_attempt === 1 && run.run_number === 4 && run.head_sha === source.head_sha
    && run.head_branch === sourceBranch && run.path === sourceWorkflow && run.event === 'push'
    && run.status === 'completed' && run.conclusion === 'failure' && sameRepository(run)
    && positive(run.workflow_id) && run.workflow_id === latest.workflow_id
    && run.head_commit?.tree_id === request.producer_tree_sha, 'Exact failed producer identity changed');
  const producerCommit = api(`repos/${repository}/git/commits/${source.head_sha}`);
  fail(producerCommit.sha === source.head_sha && producerCommit.tree?.sha === request.producer_tree_sha, 'Producer tree changed');
  const jobs = inventory(api(`repos/${repository}/actions/runs/${source.run_id}/attempts/1/jobs?per_page=100`), 'jobs', 'source job');
  const matching = jobs.filter(job => job.name === 'statement-recovery');
  fail(matching.length === 1, 'Missing or ambiguous source job');
  const job = matching[0];
  fail(job.id === request.producer_job_id && job.run_id === run.id && job.run_attempt === 1 && job.head_sha === run.head_sha
    && job.status === 'completed' && job.conclusion === 'failure', 'Failed producer job changed');
  const failed = job.steps?.filter(step => step.conclusion === 'failure');
  fail(failed?.length === 1 && failed[0].number === request.failure_boundary.failed_step_number
    && failed[0].name === request.failure_boundary.failed_step_name
    && job.steps.every(step => step.status === 'completed' && ['success','failure','skipped'].includes(step.conclusion)),
  'Producer failed at a different boundary');
  const artifacts = inventory(api(`repos/${repository}/actions/runs/${source.run_id}/artifacts?per_page=100`), 'artifacts', 'source artifact');
  const selected = artifacts.filter(item => item.name === source.artifact_name);
  fail(selected.length === 1, 'Missing or ambiguous exact source artifact');
  const artifact = selected[0];
  fail(artifact.id === source.artifact_id && artifact.expired === false && artifact.size_in_bytes === request.artifact_size_bytes
    && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 128*1024*1024
    && artifact.digest === `sha256:${source.artifact_sha256}` && artifact.workflow_run?.id === run.id
    && artifact.workflow_run.head_sha === run.head_sha && artifact.workflow_run.repository_id === repositoryId
    && artifact.workflow_run.head_repository_id === repositoryId && artifact.workflow_run.head_branch === sourceBranch,
  'Exact source artifact identity changed');
  const times = [run.run_started_at,job.started_at,artifact.created_at,job.completed_at,current.run_started_at,validatorJob.started_at].map(Date.parse);
  const clock = now();
  fail(Number.isFinite(clock) && times.every(Number.isFinite) && times.every((value,i) => i === 0 || times[i-1] <= value)
    && times[3] < times[4] && times.at(-1) <= clock && Date.parse(artifact.expires_at) > clock, 'Source/validator clocks or expiry changed');
  return {run,jobs,artifacts,validator:{run:current,job:validatorJob,commit,tree}};
}

export function verifyDownloadedBytes(zip, log) {
  const request = pinnedRequest();
  fail(zip.length === request.artifact_size_bytes && sha256(zip) === request.source.artifact_sha256, 'Source ZIP bytes changed');
  verifyDownloadedLog(log);
}

export function verifyDownloadedLog(log) {
  const request = pinnedRequest();
  fail(log.length === 47470 && sha256(log) === request.failure_boundary.job_log_sha256, 'Exact producer log bytes changed');
}

export function verifyRetrievalStable(before,after) {
  fail(JSON.stringify(before.run) === JSON.stringify(after.run) && JSON.stringify(before.jobs) === JSON.stringify(after.jobs)
    && JSON.stringify(before.artifacts) === JSON.stringify(after.artifacts)
    && before.validator.commit.sha === after.validator.commit.sha && before.validator.tree.sha === after.validator.tree.sha
    && before.validator.job.id === after.validator.job.id, 'Source changed during retrieval');
}

export function downloadPinnedBytes(endpoint, bytes, execute = execFileSync) {
  const request = pinnedRequest();
  const permitted = new Map([
    [`repos/${repository}/actions/artifacts/${request.source.artifact_id}/zip`, request.artifact_size_bytes],
    [`repos/${repository}/actions/jobs/${request.producer_job_id}/logs`, 47470],
  ]);
  fail(permitted.has(endpoint) && positive(bytes) && permitted.get(endpoint) === bytes, 'Unreviewed download endpoint or byte count');
  // These bytes go only to a bounded binary pipe, never to a terminal. GitHub job
  // logs include ANSI sequences; preserve their exact pinned digest without
  // globally changing CLI output safety or normalizing the evidence.
  const content = execute('gh', ['api', endpoint, '--allow-escape-sequences'], {
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: bytes + 1,
  });
  fail(Buffer.isBuffer(content) && content.length === bytes, 'Downloaded source byte length changed');
  return content;
}

async function main() {
  const [directory,...extra] = process.argv.slice(2);
  fail(directory && extra.length === 0, 'Usage: restore-postcapture-source.mjs NEW_DIRECTORY');
  const context = {repository:process.env.GITHUB_REPOSITORY,branch:process.env.GITHUB_REF_NAME,event:process.env.GITHUB_EVENT_NAME,
    id:Number(process.env.GITHUB_RUN_ID),attempt:Number(process.env.GITHUB_RUN_ATTEMPT),sha:process.env.GITHUB_SHA};
  const before = verifyPostcaptureSource(context);
  const output = resolve(directory); mkdirSync(output,{recursive:false});
  const download = (endpoint, name, bytes) => {
    const content = downloadPinnedBytes(endpoint, bytes);
    const path = resolve(output,name); writeFileSync(path,content,{flag:'wx'}); return content;
  };
  const request = pinnedRequest();
  const zip = download(`repos/${repository}/actions/artifacts/${request.source.artifact_id}/zip`,'source.zip',request.artifact_size_bytes);
  const log = download(`repos/${repository}/actions/jobs/${request.producer_job_id}/logs`,'job.log',47470);
  verifyDownloadedBytes(zip,log);
  const after = verifyPostcaptureSource(context);
  verifyRetrievalStable(before,after);
  writeFileSync(resolve(output,'api-evidence.json'),JSON.stringify(after,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({scope:'postcapture_validation_inputs_only',run_id:request.source.run_id,artifact_id:request.source.artifact_id,
    source_sha256:request.source.artifact_sha256,producer_conclusion:'failure',publication_authority:false}));
}
if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
