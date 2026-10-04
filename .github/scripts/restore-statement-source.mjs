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

export function checkedArtifact(artifacts, run, initial = false) {
  const name = initial ? pilot.artifact_name : `financial-statement-recovery-${run.head_sha}-${run.run_attempt}`;
  const selected = artifacts.filter(item => item.name === name);
  if (selected.length !== 1) throw Error('Missing or ambiguous prior source artifact; do not restart a cold batch');
  const artifact = selected[0];
  if (artifact.expired || !Number.isSafeInteger(artifact.id) || artifact.id <= 0 ||
      !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0 || artifact.size_in_bytes > 128 * 1024 * 1024 ||
      !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '') || artifact.workflow_run?.id !== run.id ||
      artifact.workflow_run?.head_sha !== run.head_sha) throw Error('Source artifact provenance or size is invalid');
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
  const currentId = Number(process.env.GITHUB_RUN_ID);
  if (!output) throw Error('Usage: node restore-statement-source.mjs NEW_OUTPUT_DIRECTORY [BRANCH]');
  const root = resolve(output); mkdirSync(root, { recursive: false });
  const runs = githubApi(`repos/${repository}/actions/runs?branch=${encodeURIComponent(branch)}&event=push&per_page=100`).workflow_runs;
  const previous = previousRecoveryRun(runs, currentId, branch);
  const run = previous ?? githubApi(`repos/${repository}/actions/runs/${pilot.run_id}`);
  if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
      (!previous && (run.conclusion !== 'success' || run.path !== '.github/workflows/mandatory-financial-source-pilot.yml'))) throw Error('Untrusted source workflow');
  const list = githubApi(`repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`);
  if (list.total_count > 100) throw Error('Source artifact inventory exceeds expected bound');
  const artifact = checkedArtifact(list.artifacts, run, !previous);
  const zip = resolve(root, 'source.zip'); const descriptor = openSync(zip, 'wx');
  try { execFileSync('gh', ['api', `repos/${repository}/actions/artifacts/${artifact.id}/zip`], { stdio: ['ignore', descriptor, 'pipe'] }); }
  finally { closeSync(descriptor); }
  if (`sha256:${sha256(readFileSync(zip))}` !== artifact.digest) throw Error('Source artifact bytes do not match their immutable digest');
  extractSourceArchive(zip, resolve(root, 'files'));
  const provenance = { schema_version: 'financial-source-restore-v1', kind: previous ? 'recovery_archive' : 'reviewed_pilot',
    repository, run_id: run.id, run_attempt: run.run_attempt, head_sha: run.head_sha,
    artifact_id: artifact.id, artifact_sha256: artifact.digest.slice(7) };
  writeFileSync(resolve(root, 'restored.json'), JSON.stringify(provenance, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(provenance));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
