import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { previousRecoveryRun, checkedArtifact, extractSourceArchive, pilot, repository, recoveryWorkflow } from './restore-statement-source.mjs';
const run = (id = 10, overrides = {}) => ({ id, path: recoveryWorkflow, event: 'push', head_branch: 'main',
  repository: { full_name: repository }, head_repository: { full_name: repository }, status: 'completed',
  head_sha: 'a'.repeat(40), run_attempt: 1, ...overrides });
const artifact = (r, overrides = {}) => ({ id: 20, name: `financial-statement-recovery-${r.head_sha}-1`,
  digest: `sha256:${'b'.repeat(64)}`, size_in_bytes: 100, expired: false,
  workflow_run: { id: r.id, head_sha: r.head_sha }, ...overrides });

test('restore only exact previous same-repository branch/workflow executions', () => {
  const selected = previousRecoveryRun([run(11), run(9), run(10), run(8, { head_branch: 'foreign' }),
    run(7, { head_repository: { full_name: 'attacker/fork' } }), run(6, { event: 'pull_request' })], 11, 'main');
  assert.equal(selected.id, 10);
  assert.equal(previousRecoveryRun([], 1, 'main'), null);
  assert.throws(() => previousRecoveryRun([run(10, { status: 'in_progress' })], 11, 'main'), /not terminal/);
});

test('failed execution may contain valid partial evidence; missing evidence never silently falls back', () => {
  const r = run(10, { conclusion: 'failure' });
  assert.equal(checkedArtifact([artifact(r)], r).id, 20);
  assert.throws(() => checkedArtifact([], r), /Missing/);
  assert.throws(() => checkedArtifact([artifact(r), artifact(r)], r), /ambiguous/);
});

test('reviewed pilot bytes, workflow identity and artifact identity are pinned', () => {
  const r = run(pilot.run_id, { head_sha: pilot.head_sha });
  const a = artifact(r, { id: pilot.artifact_id, name: pilot.artifact_name, digest: pilot.digest });
  assert.equal(checkedArtifact([a], r, true), a);
  assert.throws(() => checkedArtifact([{ ...a, digest: `sha256:${'c'.repeat(64)}` }], r, true), /differs/);
});

test('expired, wrong-head and oversized source archives are rejected', () => {
  const r = run();
  for (const change of [{ expired: true }, { size_in_bytes: 129 * 1024 * 1024 }, { digest: null },
    { workflow_run: { id: 10, head_sha: 'c'.repeat(40) } }]) {
    assert.throws(() => checkedArtifact([artifact(r, change)], r), /invalid/);
  }
});

test('archive extraction accepts ordinary source JSON and rejects traversal, links and duplicate paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'financial-source-zip-'));
  try {
    for (const kind of ['valid', 'traversal', 'symlink', 'duplicate']) {
      const zip = join(root, `${kind}.zip`);
      execFileSync('python3', ['-c', `import zipfile,sys,stat,warnings
warnings.simplefilter('ignore')
with zipfile.ZipFile(sys.argv[1],'w') as z:
 k=sys.argv[2]
 if k=='symlink':
  i=zipfile.ZipInfo('link');i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,'elsewhere')
 else:
  n='../outside.json' if k=='traversal' else 'acquisitions/AMD.json';z.writestr(n,'{}')
  if k=='duplicate':z.writestr(n,'{}')
`, zip, kind]);
      if (kind === 'valid') extractSourceArchive(zip, join(root, kind));
      else assert.throws(() => extractSourceArchive(zip, join(root, kind)));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
