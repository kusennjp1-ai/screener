import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { admissionSchema, source, repository, repositoryId, successorBranch, successorWorkflow,
  validateAdmission, validateSuccessorSource, completeInventory, contextFromEnvironment,
  extractSuccessorSourceArchive, verifySourceZipBytes, restoreSuccessorSource } from './restore-successor-statement-source.mjs';

const NOW = new Date('2026-10-10T09:45:00.000Z');
const prefix = `repos/${repository}`;
const currentId = 38020000000, workflowId = 500000000;
const identity = () => ({ id: repositoryId, full_name: repository });
const admission = (overrides = {}) => ({ schema_version: admissionSchema,
  request_id: 'source-37478731832-successor-first-200', execution_enabled: true,
  repository, repository_id: repositoryId, workflow: successorWorkflow, workflow_id: null,
  branch: successorBranch, event: 'push', expected_run_number: 1, first_attempt_only: true,
  dispatch_not_before: '2026-10-10T09:30:00.000Z', dispatch_not_after: '2026-10-10T10:30:00.000Z',
  source: { ...source }, ...overrides });
const context = (overrides = {}) => ({ id: currentId, attempt: 1, run_number: 1, sha: 'a'.repeat(40),
  branch: successorBranch, repository, event: 'push', ...overrides });
const sourceRun = (overrides = {}) => ({ id: source.run_id, run_attempt: 1, run_number: 4,
  head_sha: source.head_sha, head_branch: source.head_branch, path: source.workflow, workflow_id: source.workflow_id,
  event: 'push', repository: identity(), head_repository: identity(), status: 'completed', conclusion: 'failure',
  created_at: '2026-10-06T14:24:45Z', run_started_at: '2026-10-06T14:24:45Z', updated_at: '2026-10-06T14:40:11Z', ...overrides });
const currentRun = (overrides = {}) => ({ id: currentId, run_attempt: 1, run_number: 1,
  head_sha: context().sha, head_branch: successorBranch, path: successorWorkflow, workflow_id: workflowId,
  event: 'push', repository: identity(), head_repository: identity(), status: 'in_progress', conclusion: null,
  created_at: '2026-10-10T09:40:00Z', run_started_at: '2026-10-10T09:40:01Z', updated_at: '2026-10-10T09:40:02Z', ...overrides });
const artifact = (overrides = {}) => ({ id: source.artifact_id, name: source.artifact_name,
  digest: `sha256:${source.artifact_sha256}`, size_in_bytes: source.artifact_size_in_bytes, expired: false,
  created_at: '2026-10-06T14:40:06Z', expires_at: '2026-10-20T14:39:58Z',
  workflow_run: { id: source.run_id, head_sha: source.head_sha, head_branch: source.head_branch,
    repository_id: repositoryId, head_repository_id: repositoryId }, ...overrides });
const list = (key, rows) => ({ total_count: rows.length, [key]: rows });
const paths = {
  repo: prefix,
  sourceWorkflow: `${prefix}/actions/workflows/${source.workflow_id}`,
  currentWorkflow: `${prefix}/actions/workflows/financial-statement-successor.yml`,
  current: `${prefix}/actions/runs/${currentId}`,
  currentAttempt: `${prefix}/actions/runs/${currentId}/attempts/1`,
  source: `${prefix}/actions/runs/${source.run_id}`,
  sourceAttempt: `${prefix}/actions/runs/${source.run_id}/attempts/1`,
  sourceInventory: `${prefix}/actions/workflows/${source.workflow_id}/runs?per_page=100`,
  currentInventory: `${prefix}/actions/workflows/${workflowId}/runs?per_page=100`,
  artifacts: `${prefix}/actions/runs/${source.run_id}/artifacts?per_page=100`,
};
function fixture(overrides = {}) {
  const responses = {
    [paths.repo]: identity(),
    [paths.sourceWorkflow]: { id: source.workflow_id, path: source.workflow, state: 'active' },
    [paths.currentWorkflow]: { id: workflowId, path: successorWorkflow, state: 'active' },
    [paths.current]: currentRun(), [paths.currentAttempt]: currentRun(),
    [paths.source]: sourceRun(), [paths.sourceAttempt]: sourceRun(),
    [paths.sourceInventory]: list('workflow_runs', [sourceRun()]),
    [paths.currentInventory]: list('workflow_runs', [currentRun()]),
    [paths.artifacts]: list('artifacts', [artifact()]), ...overrides,
  };
  const calls = [];
  const api = endpoint => {
    calls.push(endpoint);
    assert.ok(Object.hasOwn(responses, endpoint), `Offline fixture rejects unlisted endpoint ${endpoint}`);
    return structuredClone(responses[endpoint]);
  };
  return { api, responses, calls };
}
const check = (f = fixture(), a = admission(), c = context(), clock = () => NOW) =>
  validateSuccessorSource(a, c, { api: f.api, clock });

test('one-shot successor verifies both exact attempts, complete numeric inventories and immutable source', () => {
  const f = fixture(), checked = check(f);
  assert.equal(checked.current.run_number, 1);
  assert.equal(checked.source.run_number, 4);
  assert.equal(checked.artifact.id, source.artifact_id);
  assert.equal(checked.checked_at, NOW.toISOString());
  assert.deepEqual(checked.inventory_counts, { source: 1, successor: 1, artifacts: 1 });
  assert.equal(f.calls.length, 10);
  assert.ok(f.calls.filter(x => x.includes('/runs?')).every(x => /\/workflows\/\d+\/runs\?per_page=100$/.test(x)));
  assert.equal(f.calls.some(x => /event=|branch=|\/zip$/.test(x)), false);
});

test('disabled admission cannot make an API read; offline dry-run validates without enabling live work', () => {
  const a = admission({ execution_enabled: false });
  assert.equal(validateAdmission(a, { now: NOW, dryRun: true }), a);
  const f = fixture();
  assert.throws(() => check(f, a), /disabled/);
  assert.equal(f.calls.length, 0);
});

test('the complete fixed source binding and admission scope must match, including numeric repository ID', () => {
  for (const change of [ { schema_version: 'old' }, { request_id: '' }, { execution_enabled: 'true' },
    { repository: 'attacker/screener' }, { repository_id: 2 }, { workflow: source.workflow },
    { workflow_id: -1 }, { branch: 'main' }, { event: 'workflow_dispatch' }, { expected_run_number: 2 },
    { first_attempt_only: false }, { source: {} }, { source: { ...source, run_attempt: 2 } },
    { source: { ...source, artifact_size_in_bytes: 1 } }, { source: { ...source, workflow_id: 2 } }]) {
    const f = fixture(); assert.throws(() => check(f, admission(change))); assert.equal(f.calls.length, 0);
  }
});

test('UTC clock parsing rejects stale, future, ambiguous and impossible dates', () => {
  for (const change of [{ dispatch_not_after: '2026-10-10T09:44:59.000Z' },
    { dispatch_not_before: '2026-10-10T09:45:01.000Z' }, { dispatch_not_before: '2026-10-10T09:30:00+00:00' },
    { dispatch_not_before: '2026-02-30T09:30:00.000Z' }, { dispatch_not_before: '2026-10-10' },
    { dispatch_not_after: null }]) assert.throws(() => check(fixture(), admission(change)), /UTC|stale/);
  assert.throws(() => check(fixture(), admission(), context(), () => new Date('invalid')), /clock/);
});

test('invalid context fails before any API call; no attempt or second-run loopholes', () => {
  for (const change of [{ id: source.run_id }, { id: 0 }, { attempt: 2 }, { attempt: '1' },
    { run_number: 2 }, { sha: 'bad' }, { repository: 'other/repo' }, { branch: 'main' }, { event: 'workflow_dispatch' }]) {
    const f = fixture(); assert.throws(() => check(f, admission(), context(change)), /context|repeated/); assert.equal(f.calls.length, 0);
  }
  assert.deepEqual(contextFromEnvironment({ GITHUB_RUN_ID: '1e5', GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_NUMBER: '2x' }),
    { id: NaN, attempt: 1, run_number: NaN, sha: undefined, branch: undefined, repository: undefined, event: undefined });
});

test('known metadata binds fixed source workflow and resolves successor numeric workflow safely', () => {
  for (const [path, value] of [[paths.repo, { ...identity(), id: 2 }],
    [paths.repo, { ...identity(), full_name: 'attacker/repo' }],
    [paths.sourceWorkflow, { id: 2, path: source.workflow, state: 'active' }],
    [paths.currentWorkflow, { id: workflowId, path: source.workflow, state: 'active' }],
    [paths.currentWorkflow, { id: workflowId, path: successorWorkflow, state: 'disabled_manually' }],
    [paths.currentWorkflow, { id: source.workflow_id, path: successorWorkflow, state: 'active' }]]) {
    assert.throws(() => check(fixture({ [path]: value })), /identity|path|collide/);
  }
  assert.throws(() => check(fixture(), admission({ workflow_id: workflowId + 1 })), /identity/);
  assert.equal(check(fixture(), admission({ workflow_id: workflowId })).workflow_id, workflowId);
});

test('each current run representation must be exact, fresh, live and from the same repository', () => {
  const changes = [{ id: currentId + 1 }, { run_attempt: 2 }, { run_number: 2 }, { head_sha: 'b'.repeat(40) },
    { head_branch: 'main' }, { event: 'pull_request' }, { path: source.workflow }, { workflow_id: 2 },
    { repository: { ...identity(), id: 2 } }, { head_repository: { ...identity(), full_name: 'attacker/repo' } },
    { status: 'completed' }, { conclusion: 'success' }, { created_at: '2026-10-10T09:29:59Z' },
    { run_started_at: '2026-10-10T09:45:01Z' }, { updated_at: '2026-10-10T09:45:01Z' }];
  for (const path of [paths.current, paths.currentAttempt, paths.currentInventory]) {
    for (const change of changes) assert.throws(() => check(fixture({ [path]: path === paths.currentInventory ?
      list('workflow_runs', [currentRun(change)]) : currentRun(change) })));
  }
});

test('source cannot be changed, rerun, successful, nonterminal, foreign or a different reviewed head', () => {
  for (const path of [paths.source, paths.sourceAttempt, paths.sourceInventory]) {
    for (const change of [{ id: source.run_id - 1 }, { run_attempt: 2 }, { run_number: 5 }, { head_sha: 'b'.repeat(40) },
      { head_branch: 'main' }, { event: 'workflow_dispatch' }, { path: successorWorkflow }, { workflow_id: 2 },
      { repository: { ...identity(), id: 2 } }, { head_repository: { ...identity(), id: 2 } },
      { status: 'queued' }, { status: 'in_progress' }, { conclusion: 'success' }, { run_started_at: null }]) {
      assert.throws(() => check(fixture({ [path]: path === paths.sourceInventory ?
        list('workflow_runs', [sourceRun(change)]) : sourceRun(change) })));
    }
  }
});

test('full source inventory rejects concurrent states, newer source and a late rerun of an older source', () => {
  for (const status of ['in_progress', 'queued', 'waiting', 'pending', 'requested', 'unknown']) {
    assert.throws(() => check(fixture({ [paths.sourceInventory]: list('workflow_runs', [sourceRun(),
      sourceRun({ id: source.run_id - 1, run_number: 3, status })]) })), /nonterminal|concurrent/);
  }
  for (const other of [sourceRun({ id: source.run_id + 1, run_number: 5 }),
    sourceRun({ id: source.run_id - 1, run_number: 3, updated_at: '2026-10-10T09:39:00Z' }),
    sourceRun({ id: source.run_id - 1, run_number: 4 })]) {
    assert.throws(() => check(fixture({ [paths.sourceInventory]: list('workflow_runs', [sourceRun(), other]) })), /leapfrogged/);
  }
  const validOlder = sourceRun({ id: source.run_id - 1, run_number: 3, head_sha: 'c'.repeat(40) });
  assert.equal(check(fixture({ [paths.sourceInventory]: list('workflow_runs', [sourceRun(), validOlder]) })).inventory_counts.source, 2);
});

test('every older source inventory item has ordered nonfuture clocks, even when not selected', () => {
  const older = sourceRun({ id: source.run_id - 1, run_number: 3 });
  const future = new Date(NOW.getTime() + 1).toISOString();
  for (const change of [
    { created_at: '2026-10-06T14:24:46Z' },
    { run_started_at: '2026-10-06T14:40:12Z' },
    { updated_at: '2026-10-06T14:24:44Z' },
    { created_at: future }, { run_started_at: future }, { updated_at: future },
    { created_at: future, run_started_at: future, updated_at: future },
  ]) {
    assert.throws(() => check(fixture({ [paths.sourceInventory]: list('workflow_runs',
      [sourceRun(), { ...older, ...change }]) })), /Future or out-of-order workflow clocks/);
  }
  const boundary = { ...older, created_at: older.updated_at, run_started_at: older.updated_at };
  assert.equal(check(fixture({ [paths.sourceInventory]: list('workflow_runs',
    [sourceRun(), boundary]) })).inventory_counts.source, 2);
});

test('source and successor endpoint/inventory clocks share the actual injected clock validation', () => {
  const future = new Date(NOW.getTime() + 1).toISOString();
  for (const [path, make] of [[paths.source, sourceRun], [paths.sourceAttempt, sourceRun],
    [paths.sourceInventory, sourceRun], [paths.current, currentRun],
    [paths.currentAttempt, currentRun], [paths.currentInventory, currentRun]]) {
    const valid = make();
    for (const change of [
      { created_at: new Date(Date.parse(valid.run_started_at) + 1).toISOString() },
      { run_started_at: new Date(Date.parse(valid.updated_at) + 1).toISOString() },
      { updated_at: future },
      { created_at: future, run_started_at: future, updated_at: future },
    ]) {
      const changed = make(change);
      const response = path.endsWith('?per_page=100') ? list('workflow_runs', [changed]) : changed;
      assert.throws(() => check(fixture({ [path]: response })), /Future or out-of-order workflow clocks/);
    }
  }
});

test('any prior, concurrent, newer or missing successor fails; never skip a failed previous run', () => {
  for (const rows of [[], [currentRun({ id: currentId - 1, status: 'completed', conclusion: 'failure' })],
    [currentRun(), currentRun({ id: currentId - 1, status: 'completed', conclusion: 'failure' })],
    [currentRun(), currentRun({ id: currentId + 1, status: 'queued' })]]) {
    assert.throws(() => check(fixture({ [paths.currentInventory]: list('workflow_runs', rows) })), /leapfrog|repeat/);
  }
});

test('all inventories require exact total_count, bounded length and unique numeric identities', () => {
  for (const [path, key, value] of [[paths.sourceInventory, 'workflow_runs', sourceRun()],
    [paths.currentInventory, 'workflow_runs', currentRun()], [paths.artifacts, 'artifacts', artifact()]]) {
    for (const total_count of [undefined, null, -1, 0, 2, 101, '1']) {
      assert.throws(() => check(fixture({ [path]: { total_count, [key]: [value] } })), /Incomplete|oversized/);
    }
    assert.throws(() => check(fixture({ [path]: list(key, [value, value]) })), /duplicate/);
  }
  assert.equal(completeInventory({ total_count: 100, artifacts: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) }, 'artifacts', 'fixture').length, 100);
});

test('missing, duplicate or corrupt source artifact metadata cannot select another artifact', () => {
  for (const rows of [[], [artifact({ id: 2, name: 'unrelated' })],
    [artifact(), artifact({ id: 2 })], [artifact(), artifact({ name: 'other', id: source.artifact_id })]]) {
    assert.throws(() => check(fixture({ [paths.artifacts]: list('artifacts', rows) })), /Missing|ambiguous|duplicate/);
  }
  for (const change of [{ id: 2 }, { name: 'other' }, { expired: true }, { digest: `sha256:${'b'.repeat(64)}` },
    { size_in_bytes: source.artifact_size_in_bytes + 1 }, { created_at: '2026-10-06T14:24:44Z' },
    { created_at: '2026-10-06T14:40:12Z' }, { expires_at: NOW.toISOString() }, { expires_at: null },
    ...['id', 'head_sha', 'head_branch', 'repository_id', 'head_repository_id'].map(k => ({ workflow_run: { ...artifact().workflow_run, [k]: 'wrong' } }))]) {
    assert.throws(() => check(fixture({ [paths.artifacts]: list('artifacts', [artifact(change)]) })));
  }
});

test('clock is rechecked at the end and checks older than one minute cannot be reused', () => {
  for (const end of [new Date(NOW.getTime() - 1), new Date(NOW.getTime() + 60001), new Date('2026-10-10T10:30:01Z')]) {
    let count = 0;
    assert.throws(() => check(fixture(), admission(), context(), () => count++ === 0 ? NOW : end), /stale/);
  }
  let count = 0;
  assert.throws(() => check(fixture(), admission({ dispatch_not_after: '2026-10-10T09:45:00.000Z' }), context(),
    () => count++ === 0 ? NOW : new Date(NOW.getTime() + 1)), /outside/);
});

function zipFixture(path, kind) {
  execFileSync('python3', ['-c', `import stat,sys,zipfile,warnings
warnings.simplefilter('ignore')
with zipfile.ZipFile(sys.argv[1],'w') as z:
 k=sys.argv[2]
 info=zipfile.ZipInfo('receipts/original.json',date_time=(2026,10,6,14,30,0)); info.external_attr=(stat.S_IFREG|0o644)<<16
 z.writestr(info,'{"observed_at":"2026-10-06T14:30:00Z","receipt":"immutable"}\\n')
 if k=='traversal': z.writestr('../escape','bad')
 elif k=='duplicate': z.writestr(info,'different')
 elif k=='hidden': z.writestr('archive/.unreviewed','')
 elif k=='nested-hidden': z.writestr('archive/.archive.lock/child','')
 elif k in ('lock','nonempty-lock','link-lock','directory-lock'):
  i=zipfile.ZipInfo('archive/.archive.lock'); i.external_attr=((stat.S_IFLNK if k=='link-lock' else stat.S_IFDIR if k=='directory-lock' else stat.S_IFREG)|0o644)<<16
  z.writestr(i,'x' if k=='nonempty-lock' else '')
`, path, kind]);
}

test('bounded extractor preserves original payload clocks and permits only a regular zero-byte exact archive lock', () => {
  const root = mkdtempSync(join(tmpdir(), 'successor-extract-'));
  try {
    for (const kind of ['valid', 'lock', 'nonempty-lock', 'link-lock', 'directory-lock', 'hidden', 'nested-hidden', 'traversal', 'duplicate']) {
      const zip = join(root, `${kind}.zip`), output = join(root, kind); zipFixture(zip, kind);
      if (['valid', 'lock'].includes(kind)) {
        extractSuccessorSourceArchive(zip, output);
        assert.equal(readFileSync(join(output, 'receipts/original.json'), 'utf8'), '{"observed_at":"2026-10-06T14:30:00Z","receipt":"immutable"}\n');
        if (kind === 'lock') assert.equal(readFileSync(join(output, 'archive/.archive.lock')).length, 0);
      } else assert.throws(() => extractSuccessorSourceArchive(zip, output));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('immutable ZIP digest and size are checked before any extraction or provenance is written', () => {
  const root = mkdtempSync(join(tmpdir(), 'successor-corrupt-'));
  try {
    const zip = join(root, 'corrupt.zip');
    writeFileSync(zip, Buffer.alloc(source.artifact_size_in_bytes));
    assert.throws(() => verifySourceZipBytes(zip), /digest/);
    writeFileSync(zip, 'truncated');
    assert.throws(() => verifySourceZipBytes(zip), /size/);
    const output = join(root, 'restored');
    assert.throws(() => restoreSuccessorSource(check(), output, { download: (id, fd) => {
      assert.equal(id, source.artifact_id); writeSync(fd, 'invalid');
    } }), /size/);
    assert.equal(existsSync(join(output, 'files')), false);
    assert.equal(existsSync(join(output, 'restored.json')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('check-only CLI returns fresh checked metadata and admission byte hash using closed fake gh only', () => {
  const root = mkdtempSync(join(tmpdir(), 'successor-cli-'));
  try {
    const time = new Date(), stamp = offset => new Date(time.getTime() + offset).toISOString();
    const a = admission({ dispatch_not_before: stamp(-600000), dispatch_not_after: stamp(600000) });
    const current = currentRun({ created_at: stamp(-60000), run_started_at: stamp(-50000), updated_at: stamp(-40000) });
    const f = fixture({ [paths.current]: current, [paths.currentAttempt]: current,
      [paths.currentInventory]: list('workflow_runs', [current]) });
    const filename = join(root, 'admission.json'), fixturePath = join(root, 'fixture.json'), log = join(root, 'api.log');
    writeFileSync(filename, JSON.stringify(a)); writeFileSync(fixturePath, JSON.stringify(f.responses));
    const gh = join(root, 'gh');
    writeFileSync(gh, `#!${process.execPath}\nconst fs=require('node:fs');const endpoint=process.argv[3];\nconst f=JSON.parse(fs.readFileSync(process.env.SUCCESSOR_FIXTURE));\nfs.appendFileSync(process.env.SUCCESSOR_LOG,endpoint+'\\n');\nif(process.argv[2]!=='api'||!Object.hasOwn(f,endpoint))process.exit(90);\nprocess.stdout.write(JSON.stringify(f[endpoint]));\n`);
    chmodSync(gh, 0o755);
    const git = join(root, 'git');
    writeFileSync(git, `#!${process.execPath}\nif(process.argv.slice(2).join(' ')!=='rev-parse --verify HEAD')process.exit(90);\nprocess.stdout.write(process.env.SUCCESSOR_CHECKOUT+'\\n');\n`);
    chmodSync(git, 0o755);
    const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, SUCCESSOR_FIXTURE: fixturePath, SUCCESSOR_LOG: log, SUCCESSOR_CHECKOUT: current.head_sha,
      GITHUB_RUN_ID: String(currentId), GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_NUMBER: '1', GITHUB_SHA: current.head_sha,
      GITHUB_REF_NAME: successorBranch, GITHUB_REPOSITORY: repository, GITHUB_EVENT_NAME: 'push' };
    const cli = fileURLToPath(new URL('./restore-successor-statement-source.mjs', import.meta.url));
    const invoke = extra => execFileSync(process.execPath, [cli, '--admission', filename, '--check-only', ...extra], { env, encoding: 'utf8', stdio: 'pipe' });
    const checked = JSON.parse(invoke([]));
    assert.equal(checked.current.id, currentId);
    assert.equal(checked.admission_sha256, createHash('sha256').update(readFileSync(filename)).digest('hex'));
    assert.ok(Date.parse(checked.checked_at) >= time.getTime());
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 10);
    writeFileSync(log, '');
    env.SUCCESSOR_CHECKOUT = 'b'.repeat(40);
    assert.throws(() => invoke([]), e => /Checked-out revision/.test(e.stderr));
    assert.equal(readFileSync(log, 'utf8'), '');
    env.SUCCESSOR_CHECKOUT = current.head_sha;
    writeFileSync(filename, JSON.stringify({ ...a, execution_enabled: false }));
    assert.throws(() => invoke([]), e => /disabled/.test(e.stderr));
    assert.equal(readFileSync(log, 'utf8'), '');
    for (const flag of ['--dry-run', '--enable', '--force', '--allow-disabled']) assert.throws(() => invoke([flag]), e => /Unknown/.test(e.stderr));
    for (const key of ['SUCCESSOR_EXECUTION_ENABLED', 'EXECUTION_ENABLED', 'ALLOW_DISABLED']) env[key] = 'true';
    assert.throws(() => invoke([]), e => /disabled/.test(e.stderr));
    assert.equal(readFileSync(log, 'utf8'), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
