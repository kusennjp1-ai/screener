import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { recoverySource, previousRecoveryRun, checkedArtifact, extractSourceArchive, pilot, repository, recoveryWorkflow } from './restore-statement-source.mjs';
const run = (id = 10, overrides = {}) => ({ id, path: recoveryWorkflow, event: 'push', head_branch: 'main',
  repository: { id: 123, full_name: repository }, head_repository: { id: 123, full_name: repository }, status: 'completed',
  head_sha: 'a'.repeat(40), workflow_id: 234, run_attempt: 1, run_started_at: '2026-10-04T10:00:00Z', ...overrides });
const artifact = (r, overrides = {}) => ({ id: 20, name: `financial-statement-recovery-${r.head_sha}-${r.run_attempt}`,
  digest: `sha256:${'b'.repeat(64)}`, size_in_bytes: 100, expired: false,
  created_at: '2026-10-04T10:30:00Z', workflow_run: { id: r.id, head_sha: r.head_sha,
    repository_id: r.repository.id, head_repository_id: r.head_repository.id, head_branch: r.head_branch }, ...overrides });
const context = (overrides = {}) => ({ id: 11, attempt: 2, sha: 'a'.repeat(40), branch: 'main',
  repository, event: 'push', ...overrides });
const liveRun = (overrides = {}) => run(11, { run_attempt: 2, status: 'in_progress',
  run_started_at: '2026-10-04T11:00:00Z', ...overrides });
function sourceApi({ current = liveRun(), prior = run(11), runs = [current, run(10)], extra = {} } = {}) {
  const calls = [];
  const responses = {
    [`repos/${repository}/actions/runs/11`]: current,
    [`repos/${repository}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`]: { workflow_runs: runs, total_count: runs.length },
    [`repos/${repository}/actions/runs/11/attempts/1`]: prior,
    ...extra,
  };
  const api = endpoint => {
    calls.push(endpoint);
    assert.ok(Object.hasOwn(responses, endpoint), `Unexpected API call: ${endpoint}`);
    return responses[endpoint];
  };
  return { api, calls };
}

test('attempt two restores its own terminal first attempt, never the previous run', () => {
  const { api, calls } = sourceApi();
  const { run: source, initial, current } = recoverySource(context(), api);
  assert.equal(initial, false);
  assert.equal(source.id, 11);
  assert.equal(source.run_attempt, 1);
  assert.equal(current.run_attempt, 2);
  assert.equal(current.status, 'in_progress'); // Its own live attempt is expected.
  const a = artifact(source);
  assert.equal(checkedArtifact([a, artifact(current)], source, initial, current), a);
  assert.equal(calls.some(path => /runs\/10(?:\/|$)/.test(path)), false);
});

test('later continuation uses the immediately previous attempt, without leapfrogging failures', () => {
  const c = liveRun({ run_attempt: 4 });
  const prior = run(11, { run_attempt: 3, conclusion: 'failure' });
  const { api, calls } = sourceApi({ current: c, extra: {
    [`repos/${repository}/actions/runs/11/attempts/3`]: prior,
  } });
  const selected = recoverySource(context({ attempt: 4 }), api);
  assert.equal(selected.run, prior);
  assert.throws(() => checkedArtifact([artifact(run(11)), artifact(run(10))], prior, false, c), /Missing/);
  assert.throws(() => checkedArtifact([], prior, false, c), /Missing/);
  assert.equal(calls.some(path => /attempts\/[12]$/.test(path)), false);
});

test('first attempt keeps the previous run latest terminal attempt as its source', () => {
  const c = liveRun({ run_attempt: 1 });
  const previous = run(10, { run_attempt: 3, head_sha: 'b'.repeat(40) });
  const { api, calls } = sourceApi({ current: c, runs: [c, previous], extra: {
    [`repos/${repository}/actions/runs/10/attempts/3`]: previous,
  } });
  const selected = recoverySource(context({ attempt: 1 }), api);
  assert.equal(selected.run, previous);
  assert.equal(selected.initial, false);
  assert.equal(checkedArtifact([artifact(previous)], previous, false, c).id, 20);
  assert.equal(calls.some(path => /runs\/11\/attempts/.test(path)), false);
});

test('only the first attempt with no preceding recovery may restore the reviewed pilot', () => {
  const c = liveRun({ run_attempt: 1 });
  const reviewed = run(pilot.run_id, { head_sha: pilot.head_sha, conclusion: 'success',
    path: '.github/workflows/mandatory-financial-source-pilot.yml' });
  const { api } = sourceApi({ current: c, runs: [c], extra: {
    [`repos/${repository}/actions/runs/${pilot.run_id}`]: reviewed,
  } });
  assert.equal(recoverySource(context({ attempt: 1 }), api).initial, true);
  const missing = sourceApi({ runs: [liveRun()], prior: undefined });
  // A failed previous-attempt read is fatal; it cannot try the pilot instead.
  assert.throws(() => recoverySource(context(), endpoint => {
    if (endpoint.endsWith('/attempts/1')) throw Error('404 missing attempt');
    return missing.api(endpoint);
  }), /404 missing attempt/);
});

test('current run is exactly the expected live repository/head/workflow/branch/event/attempt', () => {
  for (const change of [{ id: 12 }, { run_attempt: 3 }, { head_sha: 'b'.repeat(40) },
    { head_branch: 'foreign' }, { event: 'pull_request' }, { path: '.github/workflows/foreign.yml' },
    { repository: { id: 123, full_name: 'foreign/repo' } },
    { head_repository: { id: 123, full_name: 'foreign/repo' } },
    { head_repository: { id: 999, full_name: repository } }, { workflow_id: null }, { status: 'completed' }]) {
    assert.throws(() => recoverySource(context(), sourceApi({ current: liveRun(change) }).api), /Untrusted/);
  }
  for (const change of [{ id: 0 }, { attempt: 0 }, { attempt: 1.5 }, { sha: 'bad' },
    { branch: 'foreign' }, { repository: 'foreign/repo' }, { event: 'workflow_dispatch' }]) {
    assert.throws(() => recoverySource(context(change), () => assert.fail('No API read with invalid context')), /Invalid/);
  }
});

test('previous attempt is exact, terminal and from the same workflow and repository IDs', () => {
  for (const change of [{ id: 10 }, { run_attempt: 2 }, { run_attempt: 3 }, { head_sha: 'b'.repeat(40) },
    { head_branch: 'foreign' }, { event: 'pull_request' }, { path: '.github/workflows/foreign.yml' },
    { repository: { id: 123, full_name: 'foreign/repo' } },
    { head_repository: { id: 123, full_name: 'foreign/repo' } }, { status: 'in_progress' },
    { workflow_id: 999 }, { repository: { id: 999, full_name: repository }, head_repository: { id: 999, full_name: repository } }]) {
    assert.throws(() => recoverySource(context(), sourceApi({ prior: run(11, change) }).api), /Untrusted|identity changed/);
  }
});

test('another live recovery or a superseded current attempt blocks acquisition', () => {
  for (const other of [run(10, { status: 'in_progress' }), run(12, { status: 'in_progress' }),
    run(12, { status: 'in_progress', head_branch: 'improve/mandatory-financial-source-recovery' })]) {
    assert.throws(() => recoverySource(context(), sourceApi({ runs: [liveRun(), other] }).api), /Another recovery execution is live/);
  }
  assert.throws(() => recoverySource(context(), sourceApi({ runs: [liveRun({ run_attempt: 3 })] }).api), /Untrusted/);
  assert.throws(() => recoverySource(context(), sourceApi({ runs: [liveRun(), run(12)] }).api), /do not roll back/);
  assert.equal(recoverySource(context(), sourceApi({ runs: [liveRun(), run(12, { status: 'queued' })] }).api).run.id, 11);
});

test('incomplete run inventory cannot silently fall through to a cold pilot', () => {
  for (const total_count of [undefined, 0, 3, 101]) {
    const { api } = sourceApi({ extra: {
      [`repos/${repository}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`]: {
        workflow_runs: [liveRun(), run(10)], total_count,
      },
    } });
    assert.throws(() => recoverySource(context(), api), /Incomplete or oversized/);
  }
});

test('previous-attempt artifact name, identity, time interval and uniqueness fail closed', () => {
  const r = run(11), c = liveRun(), a = artifact(r);
  for (const change of [{ name: `financial-statement-recovery-${r.head_sha}-2` },
    { name: `financial-statement-recovery-${'b'.repeat(40)}-1` }, { expired: true },
    { workflow_run: { ...a.workflow_run, id: 10 } }, { workflow_run: { ...a.workflow_run, head_sha: 'b'.repeat(40) } },
    { workflow_run: { ...a.workflow_run, repository_id: 999 } }, { workflow_run: { ...a.workflow_run, head_repository_id: 999 } },
    { workflow_run: { ...a.workflow_run, head_branch: 'foreign' } },
    { created_at: null }, { created_at: '2026-10-04T09:59:59Z' }, { created_at: c.run_started_at },
    { created_at: '2026-10-04T12:00:00Z' }]) {
    assert.throws(() => checkedArtifact([{ ...a, ...change }], r, false, c), /Missing|invalid|interval/);
  }
  assert.throws(() => checkedArtifact([a, a], r, false, c), /ambiguous/);
  assert.throws(() => checkedArtifact([a], { ...r, run_started_at: null }, false, c), /interval/);
  assert.throws(() => checkedArtifact([a], r, false, { ...c, run_started_at: null }), /interval/);
});

test('recovery retains a global noncancelling concurrency group and read-only permissions', () => {
  const workflow = readFileSync(new URL('../workflows/financial-statement-recovery.yml', import.meta.url), 'utf8');
  assert.match(workflow, /permissions:\n  contents: read\n  actions: read\n/);
  assert.match(workflow, /concurrency:\n  group: financial-statement-recovery\n  cancel-in-progress: false\n/);
  assert.doesNotMatch(workflow, /(?:contents|actions): write/);
});

test('CLI restores previous-attempt bytes and clocks; missing or corrupt evidence cannot fall back', () => {
  const root = mkdtempSync(join(tmpdir(), 'financial-source-continuation-'));
  try {
    const zip = join(root, 'original.zip'), fixture = join(root, 'fixture.json'), log = join(root, 'calls.jsonl');
    const receipt = '{"receipt_id":"original-capture","observed_at":"2026-10-03T09:15:00Z"}\n';
    execFileSync('python3', ['-c', `import sys,zipfile
with zipfile.ZipFile(sys.argv[1],'w') as z: z.writestr('original-receipt.json',sys.argv[2])
`, zip, receipt]);
    const digest = `sha256:${createHash('sha256').update(readFileSync(zip)).digest('hex')}`;
    // A closed fake gh executable handles every read and fails on unexpected
    // endpoints; neither this CLI test nor its failures can contact GitHub.
    const gh = join(root, 'gh');
    writeFileSync(gh, `#!${process.execPath}
const fs = require('node:fs');
const endpoint = process.argv[3];
fs.appendFileSync(process.env.SOURCE_TEST_LOG, JSON.stringify(endpoint) + '\\n');
const fixture = JSON.parse(fs.readFileSync(process.env.SOURCE_TEST_FIXTURE));
if (process.argv[2] !== 'api' || !Object.hasOwn(fixture, endpoint)) process.exit(90);
const item = fixture[endpoint];
process.stdout.write(item.zip ? fs.readFileSync(item.zip) : JSON.stringify(item));
`);
    chmodSync(gh, 0o755);
    for (const kind of ['valid', 'missing', 'corrupt', 'truncated']) {
      writeFileSync(log, '');
      const r = run(11), c = liveRun(), a = artifact(r, { digest });
      const responses = {
        [`repos/${repository}/actions/runs/11`]: c,
        [`repos/${repository}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`]: { workflow_runs: [c, run(10)], total_count: 2 },
        [`repos/${repository}/actions/runs/11/attempts/1`]: r,
        [`repos/${repository}/actions/runs/11/artifacts?per_page=100`]: {
          total_count: kind === 'missing' ? 0 : kind === 'truncated' ? 2 : 1,
          artifacts: kind === 'missing' ? [] : [{ ...a, digest: kind === 'corrupt' ? `sha256:${'c'.repeat(64)}` : digest }],
        },
        [`repos/${repository}/actions/artifacts/20/zip`]: { zip },
      };
      writeFileSync(fixture, JSON.stringify(responses));
      const output = join(root, kind);
      const invoke = () => execFileSync(process.execPath,
        [fileURLToPath(new URL('./restore-statement-source.mjs', import.meta.url)), output],
        { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, PATH: `${root}:${process.env.PATH}`,
          GITHUB_RUN_ID: '11', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: r.head_sha, GITHUB_REF_NAME: 'main',
          GITHUB_REPOSITORY: repository, GITHUB_EVENT_NAME: 'push', SOURCE_TEST_FIXTURE: fixture, SOURCE_TEST_LOG: log } });
      if (kind === 'valid') {
        invoke();
        assert.equal(readFileSync(join(output, 'files', 'original-receipt.json'), 'utf8'), receipt);
        assert.deepEqual(JSON.parse(readFileSync(join(output, 'restored.json'))), {
          schema_version: 'financial-source-restore-v1', kind: 'recovery_archive', repository,
          run_id: 11, run_attempt: 1, head_sha: r.head_sha, artifact_id: 20, artifact_sha256: digest.slice(7),
        });
      } else {
        assert.throws(invoke, error => error.status !== 0 &&
          new RegExp(kind === 'missing' ? 'Missing or ambiguous' : kind === 'truncated' ? 'Incomplete or oversized' : 'immutable digest').test(error.stderr));
        assert.equal(existsSync(join(output, 'restored.json')), false);
        assert.equal(existsSync(join(output, 'files')), false);
      }
      const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
      assert.equal(calls.some(endpoint => /runs\/10(?:\/|$)/.test(endpoint) || endpoint.includes(String(pilot.run_id))), false);
      assert.equal(calls.length, ['missing', 'truncated'].includes(kind) ? 4 : 5);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

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
