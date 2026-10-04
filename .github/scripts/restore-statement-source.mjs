// Restore immutable source evidence only. This module never contacts Yahoo.
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubApi } from './publication-gate.mjs';
import { sha256 } from './publication-state.mjs';

export const repository = 'kusennjp1-ai/screener';
export const recoveryWorkflow = '.github/workflows/financial-statement-recovery.yml';
export const pilot = Object.freeze({ run_id: 37196464126, artifact_id: 11301277348,
  head_sha: 'b08a9ccaf842da6e172744429fc036d888bd020c',
  artifact_name: 'mandatory-financial-source-pilot-b08a9ccaf842da6e172744429fc036d888bd020c-1',
  digest: 'sha256:96673847ade01f667e5efd4645574ed89a7c2a4fe4c67e2c91b1f1f1dcbd463d' });

const positive = value => Number.isSafeInteger(value) && value > 0;
const allowedBranch = branch => ['main', 'improve/mandatory-financial-source-recovery'].includes(branch);

function checkedRecoveryRun(run, expected, current = false) {
  if (run?.id !== expected.id || run.run_attempt !== expected.attempt || run.head_sha !== expected.sha ||
      run.head_branch !== expected.branch || run.path !== recoveryWorkflow || run.event !== 'push' ||
      run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
      !positive(run.workflow_id) || !positive(run.repository?.id) || run.head_repository?.id !== run.repository.id ||
      run.status !== (current ? 'in_progress' : 'completed')) throw Error('Untrusted recovery workflow attempt or nonterminal source');
  return run;
}

// The run endpoint describes the latest attempt, including this live execution.
// Only the attempt endpoint can establish that its predecessor is terminal.
export function recoverySource(context, api = githubApi) {
  const { id, attempt, sha, branch } = context;
  if (!positive(id) || !positive(attempt) || !/^[a-f0-9]{40}$/.test(sha ?? '') || !allowedBranch(branch) ||
      context.repository !== repository || context.event !== 'push') throw Error('Invalid recovery-run context');
  const current = checkedRecoveryRun(api(`repos/${repository}/actions/runs/${id}`), context, true);
  const inventory = api(`repos/${repository}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`);
  if (!Array.isArray(inventory.workflow_runs) || !Number.isSafeInteger(inventory.total_count) ||
      inventory.total_count < 0 || inventory.total_count > 100 || inventory.workflow_runs.length !== inventory.total_count) {
    throw Error('Incomplete or oversized recovery-run inventory; do not restart a cold batch');
  }
  const runs = inventory.workflow_runs;
  for (const other of runs) {
    if (other.id === id) checkedRecoveryRun(other, context, true);
    else if (other.path === recoveryWorkflow && other.repository?.full_name === repository &&
        other.head_repository?.full_name === repository) {
      if (other.status === 'in_progress') throw Error('Another recovery execution is live; do not acquire overlapping source batches');
      if (other.id > id && other.head_branch === branch && other.status === 'completed') {
        throw Error('A newer recovery run already completed; do not roll back its source progress');
      }
    }
  }
  let run, initial = false;
  if (attempt > 1) {
    // Never leapfrog an absent/failed attempt by selecting another run or pilot.
    run = checkedRecoveryRun(api(`repos/${repository}/actions/runs/${id}/attempts/${attempt - 1}`),
      { ...context, attempt: attempt - 1 });
  } else {
    const previous = previousRecoveryRun(runs, id, branch);
    initial = !previous;
    if (previous) {
      if (!positive(previous.id) || !positive(previous.run_attempt) || !/^[a-f0-9]{40}$/.test(previous.head_sha ?? '')) throw Error('Invalid prior recovery identity');
      run = checkedRecoveryRun(api(`repos/${repository}/actions/runs/${previous.id}/attempts/${previous.run_attempt}`),
        { id: previous.id, attempt: previous.run_attempt, sha: previous.head_sha, branch });
    } else {
      run = api(`repos/${repository}/actions/runs/${pilot.run_id}`);
      if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
          run.status !== 'completed' || run.conclusion !== 'success' ||
          run.path !== '.github/workflows/mandatory-financial-source-pilot.yml') throw Error('Untrusted source workflow');
    }
  }
  if (!initial && (run.workflow_id !== current.workflow_id || run.repository.id !== current.repository.id ||
      run.head_repository.id !== current.head_repository.id)) throw Error('Recovery workflow or repository identity changed');
  return { run, initial, current };
}

export function previousRecoveryRun(runs, currentId, branch) {
  if (!Array.isArray(runs) || !Number.isSafeInteger(currentId) || currentId <= 0 ||
      !['main', 'improve/mandatory-financial-source-recovery'].includes(branch)) throw Error('Invalid recovery-run context');
  const matching = runs.filter(run => run.id !== currentId && run.id < currentId &&
    run.path === recoveryWorkflow && run.event === 'push' && run.head_branch === branch &&
    run.repository?.full_name === repository && run.head_repository?.full_name === repository);
  matching.sort((a, b) => b.id - a.id);
  const latest = matching[0];
  if (latest && latest.status !== 'completed') throw Error('Previous recovery execution is not terminal');
  return latest ?? null;
}

export function checkedArtifact(artifacts, run, initial = false, current = null) {
  if (!Array.isArray(artifacts)) throw Error('Invalid source artifact inventory');
  const name = initial ? pilot.artifact_name : `financial-statement-recovery-${run.head_sha}-${run.run_attempt}`;
  const selected = artifacts.filter(item => item.name === name);
  if (selected.length !== 1) throw Error('Missing or ambiguous prior source artifact; do not restart a cold batch');
  const artifact = selected[0];
  if (artifact.expired || !Number.isSafeInteger(artifact.id) || artifact.id <= 0 ||
      !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0 || artifact.size_in_bytes > 128 * 1024 * 1024 ||
      !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '') || artifact.workflow_run?.id !== run.id ||
      artifact.workflow_run?.head_sha !== run.head_sha) throw Error('Source artifact provenance or size is invalid');
  if (!initial && current) {
    const created = Date.parse(artifact.created_at), started = Date.parse(run.run_started_at);
    const nextStarted = Date.parse(current.run_started_at);
    // Artifact workflow_run has no run_attempt. The exact immutable name and
    // creation interval bind it to the separately validated terminal attempt.
    if (artifact.workflow_run.repository_id !== run.repository.id ||
        artifact.workflow_run.head_repository_id !== run.head_repository.id ||
        artifact.workflow_run.head_branch !== run.head_branch ||
        !Number.isFinite(created) || !Number.isFinite(started) || !Number.isFinite(nextStarted) ||
        created < started || created >= nextStarted) throw Error('Source artifact does not belong to the prior attempt interval');
  }
  if (initial && (run.id !== pilot.run_id || run.head_sha !== pilot.head_sha ||
      artifact.id !== pilot.artifact_id || artifact.digest !== pilot.digest)) throw Error('Pilot source identity differs from reviewed evidence');
  return artifact;
}

export function extractSourceArchive(zip, directory) {
  execFileSync('python3', ['-c', `import pathlib,stat,sys,zipfile
root=pathlib.Path(sys.argv[2]); root.mkdir(parents=True,exist_ok=False)
with zipfile.ZipFile(sys.argv[1]) as z:
 members=z.infolist(); seen=set(); total=0
 assert len(members)<=30000, 'Too many source members'
 for m in members:
  p=pathlib.PurePosixPath(m.filename); mode=m.external_attr>>16
  assert not p.is_absolute() and all(x not in ('','.', '..') for x in m.filename.rstrip('/').split('/')), 'Unsafe source path'
  assert '\\\\' not in m.filename and m.filename not in seen, 'Unsafe or duplicate source path'
  assert not stat.S_ISLNK(mode) and (not stat.S_IFMT(mode) or stat.S_ISREG(mode) or stat.S_ISDIR(mode)), 'Special source member'
  seen.add(m.filename); total+=m.file_size
  assert m.file_size<=32*1024*1024 and total<=512*1024*1024, 'Source archive exceeds bounded size'
 z.extractall(root)
`, zip, directory], { stdio: 'pipe' });
}

async function main() {
  const [output, branch = process.env.GITHUB_REF_NAME] = process.argv.slice(2);
  if (!output) throw Error('Usage: node restore-statement-source.mjs NEW_OUTPUT_DIRECTORY [BRANCH]');
  const root = resolve(output); mkdirSync(root, { recursive: false });
  const { run, initial, current } = recoverySource({ id: Number(process.env.GITHUB_RUN_ID),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT), sha: process.env.GITHUB_SHA, branch,
    repository: process.env.GITHUB_REPOSITORY, event: process.env.GITHUB_EVENT_NAME });
  const list = githubApi(`repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`);
  if (!Number.isSafeInteger(list.total_count) || list.total_count < 0 || list.total_count > 100 ||
      !Array.isArray(list.artifacts) || list.artifacts.length !== list.total_count) throw Error('Incomplete or oversized source artifact inventory');
  const artifact = checkedArtifact(list.artifacts, run, initial, current);
  const zip = resolve(root, 'source.zip'); const descriptor = openSync(zip, 'wx');
  try { execFileSync('gh', ['api', `repos/${repository}/actions/artifacts/${artifact.id}/zip`], { stdio: ['ignore', descriptor, 'pipe'] }); }
  finally { closeSync(descriptor); }
  if (`sha256:${sha256(readFileSync(zip))}` !== artifact.digest) throw Error('Source artifact bytes do not match their immutable digest');
  extractSourceArchive(zip, resolve(root, 'files'));
  const provenance = { schema_version: 'financial-source-restore-v1', kind: initial ? 'reviewed_pilot' : 'recovery_archive',
    repository, run_id: run.id, run_attempt: run.run_attempt, head_sha: run.head_sha,
    artifact_id: artifact.id, artifact_sha256: artifact.digest.slice(7) };
  writeFileSync(resolve(root, 'restored.json'), JSON.stringify(provenance, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(provenance));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
