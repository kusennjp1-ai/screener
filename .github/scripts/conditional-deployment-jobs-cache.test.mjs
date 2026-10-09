// Synthetic transport fixtures only; these tests prove no publication authority.
// Native Node execution is required. No network, credential file, or artifact transfer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { initializeJobCache as initializeNative, openJobCache as openNative, cleanupJobCache, isOwnedJobCacheHandle, JOB_CACHE_LIMITS } from './conditional-deployment-jobs-cache.mjs';
import { REQUEST_REPRESENTATION, runKey, validateJobsPages, readConditionalDeploymentJobs } from './conditional-deployment-jobs-worker.mjs';

const TEST_NOW = Date.parse('2026-10-09T01:30:00Z');
const initializeJobCache = options => initializeNative({ now: () => TEST_NOW, ...options });
const openJobCache = options => openNative({ now: () => TEST_NOW, ...options });
const TOKEN = 'synthetic-private-cache-test-token';
const REPO = 'kusennjp1-ai/screener', REPO_ID = 1203919607;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const helperURL = new URL('./conditional-deployment-jobs-cache.mjs', import.meta.url).href;
function context(changes = {}) {
  return { repository: REPO, repository_id: REPO_ID, run_id: 900, run_attempt: 1,
    job_id: 99001, job_name: 'Synthetic cache diagnostic', job_started_at: '2026-10-09T01:00:00Z',
    role: 'diagnostic', controller_sha: 'b'.repeat(40), controller_tree: 'c'.repeat(40),
    request_sha256: 'd'.repeat(64), event_sha256: 'e'.repeat(64),
    schema_version: 'conditional-deployment-jobs-cache-context-v1',
    reader_version: 'aec69c0bafd2ab0c2ab33bbf935242be284616df',
    representation: copy(REQUEST_REPRESENTATION), ...changes };
}
function scope(c = context()) {
  return { repository: c.repository, repository_id: c.repository_id, run_id: c.run_id,
    run_attempt: c.run_attempt, controller_sha: c.controller_sha };
}
function run(id = 11, changes = {}) {
  return { id, run_attempt: 1, head_sha: 'a'.repeat(40), head_branch: 'main',
    workflow_id: 294257497, path: '.github/workflows/static-site.yml',
    name: 'Synthetic workflow', event: 'workflow_dispatch',
    repository: { id: REPO_ID, full_name: REPO }, head_repository: { id: REPO_ID, full_name: REPO },
    status: 'completed', conclusion: 'success', created_at: '2026-10-09T01:00:00Z',
    run_started_at: '2026-10-09T01:00:00Z', updated_at: '2026-10-09T01:10:00Z', ...changes };
}
function job(r, id = 101, changes = {}) {
  return { id, run_id: r.id, run_attempt: r.run_attempt, head_sha: r.head_sha, head_branch: r.head_branch,
    workflow_name: r.name, name: 'Synthetic job', run_url: 'https://api.github.com/repos/' + REPO + '/actions/runs/' + r.id,
    url: 'https://api.github.com/repos/' + REPO + '/actions/jobs/' + id,
    status: 'completed', conclusion: 'success', created_at: '2026-10-09T01:00:01Z',
    started_at: '2026-10-09T01:00:02Z', completed_at: '2026-10-09T01:00:05Z',
    steps: [{ number: 1, name: 'Synthetic step', status: 'completed', conclusion: 'success',
      started_at: '2026-10-09T01:00:03Z', completed_at: '2026-10-09T01:00:04Z' }], ...changes };
}
const route = (id, page = 1) => 'https://api.github.com/repos/' + REPO + '/actions/runs/' + id +
  '/jobs?filter=all&per_page=100' + (page === 1 ? '' : '&page=' + page);
function pages(r, jobs = [job(r)], { etag = 'W/"synthetic-exact-tag"', padding = 0 } = {}) {
  const last = Math.max(1, Math.ceil(jobs.length / 100)), result = [];
  for (let p = 1; p <= last; p++) {
    const links = [];
    if (p < last) links.push('<' + route(r.id, p + 1) + '>; rel="next"');
    if (last > 1) links.push('<' + route(r.id, last) + '>; rel="last"');
    const bytes = Buffer.from(JSON.stringify({ total_count: jobs.length, jobs: jobs.slice((p - 1) * 100, p * 100) }) + ' '.repeat(padding));
    result.push({ schema_version: 'conditional-deployment-jobs-page-v1', scope: scope(), run_key: runKey(r),
      url: route(r.id, p), etag, body_base64: bytes.toString('base64'), body_bytes: bytes.length,
      body_sha256: hash(bytes), link: links.join(', '), vary: ['accept', 'authorization'], representation: copy(REQUEST_REPRESENTATION) });
  }
  return result;
}
function rootFor(t) {
  const previous = process.env.RUNNER_TEMP, root = fs.mkdtempSync(join(tmpdir(), 'conditional-cache-native-test-'));
  process.env.RUNNER_TEMP = root;
  t.after(() => { if (previous === undefined) delete process.env.RUNNER_TEMP; else process.env.RUNNER_TEMP = previous;
    fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
function initialized(t) {
  const root = rootFor(t), c = context(), handle = initializeJobCache({ context: c, root, token: TOKEN });
  return { root, c, handle, directory: handle.directory };
}
function closed(t) {
  const f = initialized(t); f.handle.dispose(); return f;
}
const empty = () => ({ runs: [], pages: [], excludedIds: [] });
function child(f, source, extraEnv = {}) {
  const script = "import fs from 'node:fs'; import {openJobCache as openNative,initializeJobCache as initializeNative} from " + JSON.stringify(helperURL) +
    "; const now=()=>Date.parse('2026-10-09T01:30:00Z'); const openJobCache=o=>openNative({now,...o}); const initializeJobCache=o=>initializeNative({now,...o}); const context=JSON.parse(process.env.CACHE_TEST_CONTEXT); const directory=process.env.CACHE_TEST_DIRECTORY; " + source;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, GH_TOKEN: TOKEN, RUNNER_TEMP: f.root, CACHE_TEST_CONTEXT: JSON.stringify(f.c),
      CACHE_TEST_DIRECTORY: f.directory, ...extraEnv }, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
}
function successfulChild(result) {
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(TOKEN)); return JSON.parse(result.stdout);
}
function restoreFiles(directory, saved) {
  for (const [name, bytes] of Object.entries(saved)) fs.writeFileSync(join(directory, name), bytes, { mode: 0o600 });
}
function savedFiles(directory) {
  return Object.fromEntries(['cache.json', 'manifest.json'].map(name => [name, fs.readFileSync(join(directory, name))]));
}

test('private brand, cloned frozen context, exact permissions, no persisted credential and memory disposal', t => {
  const f = initialized(t), sentinel = join(f.root, 'unrelated.txt'); fs.writeFileSync(sentinel, 'keep');
  assert.equal(isOwnedJobCacheHandle(f.handle), true);
  assert.equal(isOwnedJobCacheHandle({ ...f.handle }), false);
  assert.equal(Object.isFrozen(f.handle.context), true);
  assert.equal(Object.isFrozen(f.handle.context.representation.headers), true);
  f.c.job_name = 'changed caller object'; assert.equal(f.handle.context.job_name, 'Synthetic cache diagnostic');
  assert.deepEqual(f.handle.loadVerified(), { ...empty(), generation: 0 });
  assert.equal(fs.statSync(f.directory).mode & 0o777, 0o700);
  for (const file of fs.readdirSync(f.directory)) {
    assert.equal(fs.statSync(join(f.directory, file)).mode & 0o777, 0o600);
    const text = fs.readFileSync(join(f.directory, file), 'utf8');
    assert.equal(text.includes(TOKEN), false); assert.equal(text.includes(hash(TOKEN)), false);
  }
  f.handle.dispose();
  assert.equal(isOwnedJobCacheHandle(f.handle), false);
  assert.throws(() => f.handle.loadVerified(), /disposed-or-unowned/);
  assert.throws(() => f.handle.commitComplete(empty()), /disposed-or-unowned/);
  assert.throws(() => f.handle.dispose(), /disposed-or-unowned/);
  assert.equal(fs.existsSync(f.directory), true);
  assert.equal(fs.existsSync(join(f.directory, 'lease.json')), false);
  cleanupJobCache({ context: context(), directory: f.directory, token: TOKEN });
  assert.equal(fs.existsSync(f.directory), false); assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
});

test('real sequential child processes authenticate the same job-local state and commit generations', t => {
  const f = closed(t);
  const source = "const h=openJobCache({context,directory});const before=h.loadVerified().generation;const commit=h.commitComplete({runs:[],pages:[],excludedIds:[]});h.dispose();process.stdout.write(JSON.stringify({before,after:commit.generation}));";
  assert.deepEqual(successfulChild(child(f, source)), { before: 0, after: 1 });
  assert.deepEqual(successfulChild(child(f, source)), { before: 1, after: 2 });
  const h = openJobCache({ context: f.c, directory: f.directory, token: TOKEN });
  assert.equal(h.loadVerified().generation, 2); h.dispose();
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('wrong token/job/run/controller/tree/digest/schema/reader/representation/role cannot open or clean state', t => {
  const f = closed(t), variants = [
    { token: TOKEN + '-wrong' }, { context: context({ job_id: 99002 }) }, { context: context({ job_name: 'wrong' }) },
    { context: context({ run_id: 901 }) }, { context: context({ run_attempt: 2 }) },
    { context: context({ controller_sha: 'f'.repeat(40) }) }, { context: context({ controller_tree: 'f'.repeat(40) }) },
    { context: context({ request_sha256: 'f'.repeat(64) }) }, { context: context({ event_sha256: 'f'.repeat(64) }) },
    { context: context({ schema_version: 'other-schema' }) }, { context: context({ reader_version: 'f'.repeat(40) }) },
    { context: context({ representation: { ...copy(REQUEST_REPRESENTATION), authorization: 'different' } }) },
    { context: context({ role: 'publisher' }) },
  ];
  for (const changes of variants) {
    const options = { context: f.c, directory: f.directory, token: TOKEN, ...changes };
    assert.throws(() => openJobCache(options)); assert.throws(() => cleanupJobCache(options));
    assert.equal(fs.existsSync(join(f.directory, 'lease.json')), false);
  }
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('corrupt MAC, changed body, manifest disagreement and partial JSON are terminal', t => {
  const f = closed(t), saved = savedFiles(f.directory);
  for (const file of ['cache.json', 'manifest.json']) {
    const value = JSON.parse(saved[file]); value.mac = '0'.repeat(64);
    fs.writeFileSync(join(f.directory, file), JSON.stringify(value));
    assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }));
    restoreFiles(f.directory, saved);
  }
  const envelope = JSON.parse(saved['cache.json']); envelope.payload.excludedIds = [321];
  fs.writeFileSync(join(f.directory, 'cache.json'), JSON.stringify(envelope));
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }), /manifest-mismatch/);
  restoreFiles(f.directory, saved);
  fs.writeFileSync(join(f.directory, 'cache.json'), '{');
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }));
  restoreFiles(f.directory, saved);
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('missing initialized state never becomes a cold open; failed initialization anchor can be cleaned', t => {
  const f = initialized(t), cache = fs.readFileSync(join(f.directory, 'cache.json'));
  fs.unlinkSync(join(f.directory, 'cache.json'));
  assert.throws(() => f.handle.loadVerified());
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }));
  fs.writeFileSync(join(f.directory, 'cache.json'), cache, { mode: 0o600 });
  fs.unlinkSync(join(f.directory, 'manifest.json'));
  f.handle.dispose('failed');
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }));
  assert.deepEqual(cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN }), { removed: true });
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }));
});

test('symlink, hardlink, directory, foreign permissions and unsafe root are rejected without outside deletion', t => {
  const f = closed(t), cacheFile = join(f.directory, 'cache.json'), saved = fs.readFileSync(cacheFile);
  const outside = join(f.root, 'outside.json'); fs.writeFileSync(outside, saved, { mode: 0o600 });
  fs.unlinkSync(cacheFile); fs.symlinkSync(outside, cacheFile);
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }));
  assert.throws(() => cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN }));
  assert.equal(fs.readFileSync(outside).equals(saved), true); fs.unlinkSync(cacheFile);
  fs.linkSync(outside, cacheFile);
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }));
  fs.unlinkSync(cacheFile); fs.mkdirSync(cacheFile);
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }));
  fs.rmdirSync(cacheFile); fs.writeFileSync(cacheFile, saved, { mode: 0o600 }); fs.chmodSync(cacheFile, 0o644);
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }));
  fs.chmodSync(cacheFile, 0o600);
  assert.throws(() => initializeJobCache({ context: f.c, root: join(f.root, 'other'), token: TOKEN }), /unsafe-cache-root/);
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN }); assert.equal(fs.existsSync(outside), true);
});

test('bounded descriptor reads reject growth and pathname swap to a symlink', t => {
  const f = closed(t), saved = savedFiles(f.directory);
  const growth = child(f, "const native=fs.readSync;const originalOpen=fs.openSync;let target;fs.openSync=function(path,...args){const fd=Reflect.apply(originalOpen,this,[path,...args]);if(path===directory+'/cache.json')target=fd;return fd;};let once=false;fs.readSync=function(fd,...args){const n=Reflect.apply(native,this,[fd,...args]);if(fd===target&&!once){once=true;fs.appendFileSync(directory+'/cache.json',' ');}return n;};try{openJobCache({context,directory});process.exitCode=1;}catch(error){process.stdout.write(JSON.stringify({rejected:true,code:error.code}));}");
  assert.equal(successfulChild(growth).rejected, true);
  restoreFiles(f.directory, saved);
  const outside = join(f.root, 'outside.json'); fs.writeFileSync(outside, saved['cache.json'], { mode: 0o600 });
  const swapped = child(f, "const native=fs.openSync;let once=false;fs.openSync=function(path,...args){if(path===directory+'/cache.json'&&!once){once=true;fs.unlinkSync(path);fs.symlinkSync(process.env.CACHE_TEST_OUTSIDE,path);}return Reflect.apply(native,this,[path,...args]);};try{openJobCache({context,directory});process.exitCode=1;}catch(error){process.stdout.write(JSON.stringify({rejected:true}));}", { CACHE_TEST_OUTSIDE: outside });
  assert.equal(successfulChild(swapped).rejected, true);
  assert.equal(fs.readFileSync(outside).equals(saved['cache.json']), true);
  fs.unlinkSync(join(f.directory, 'cache.json')); restoreFiles(f.directory, saved);
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('oversized regular outer file is rejected before body allocation', t => {
  const f = closed(t), saved = savedFiles(f.directory);
  fs.truncateSync(join(f.directory, 'cache.json'), JOB_CACHE_LIMITS.fileBytes + 1);
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }), /cache-file-cap/);
  restoreFiles(f.directory, saved);
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('same-process and second-process competing holders cannot steal an invocation lease', t => {
  const f = initialized(t);
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }), /locked-cache/);
  const other = child(f, "try{openJobCache({context,directory});process.exitCode=1;}catch(error){process.stdout.write(JSON.stringify({rejected:true}));}");
  assert.equal(successfulChild(other).rejected, true);
  assert.throws(() => cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN }), /live-cache-holder/);
  assert.equal(f.handle.loadVerified().generation, 0); f.handle.dispose();
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('process crash leaves terminal pending state until exact final cleanup', t => {
  const f = closed(t);
  const crashed = child(f, "const h=openJobCache({context,directory});h.commitComplete({runs:[],pages:[],excludedIds:[]});process.exit(42);");
  assert.equal(crashed.status, 42);
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }), /locked-cache/);
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('interrupted cache-first atomic commit leaves a locked torn pair, never accepted partial proof', t => {
  const f = closed(t);
  const interrupted = child(f, "const h=openJobCache({context,directory});const native=fs.renameSync;fs.renameSync=function(from,to){if(to===directory+'/manifest.json')process.exit(43);return Reflect.apply(native,this,arguments);};h.commitComplete({runs:[],pages:[],excludedIds:[]});");
  assert.equal(interrupted.status, 43);
  assert.equal(fs.existsSync(join(f.directory, 'lease.json')), true);
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }));
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('failed or partial batch leaves prior bytes intact and poisons even complete disposal', t => {
  const f = initialized(t), r = run();
  f.handle.commitComplete({ runs: [r], pages: pages(r), excludedIds: [] });
  const saved = savedFiles(f.directory), next = run(12);
  assert.throws(() => f.handle.commitComplete({ runs: [r, next], pages: pages(r), excludedIds: [] }), /incomplete-jobs-inventory/);
  assert.equal(fs.readFileSync(join(f.directory, 'cache.json')).equals(saved['cache.json']), true);
  assert.equal(isOwnedJobCacheHandle(f.handle), false);
  assert.throws(() => f.handle.loadVerified(), /failed-cache-handle/);
  assert.throws(() => f.handle.dispose('complete'), /failed-cache-handle/);
  assert.equal(JSON.parse(fs.readFileSync(join(f.directory, 'lease.json'))).status, 'failed');
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }), /locked-cache/);
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('explicit failed phase cannot be reopened as a normal empty cache', t => {
  const f = initialized(t); f.handle.dispose('failed');
  assert.equal(isOwnedJobCacheHandle(f.handle), false);
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }), /locked-cache/);
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('complete inventories are validated for active/current/excluded runs but none are stored', t => {
  const f = initialized(t), terminal = run(11), critical = run(12), own = run(900),
    active = run(13, { status: 'in_progress', conclusion: null });
  const activeJob = job(active, 1301, { status: 'in_progress', conclusion: null, completed_at: null,
    steps: [{ number: 1, name: 'Active', status: 'in_progress', conclusion: null,
      started_at: '2026-10-09T01:00:03Z', completed_at: null }] });
  const noTag = run(14), all = [terminal, critical, own, active, noTag];
  const input = { runs: all, pages: [...pages(terminal), ...pages(critical), ...pages(own),
    ...pages(active, [activeJob]), ...pages(noTag, [job(noTag)], { etag: null })], excludedIds: [critical.id] };
  assert.equal(f.handle.commitComplete(input).page_count, 1);
  const loaded = f.handle.loadVerified(); assert.deepEqual(loaded.runs.map(r => r.id), [terminal.id]);
  assert.deepEqual(loaded.pages.map(p => p.url), [route(terminal.id)]);
  assert.deepEqual(loaded.excludedIds, [critical.id]);
  f.handle.dispose(); cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('cancelled zero-job and skipped null-step inventories are valid terminal transport metadata', t => {
  const f = initialized(t), zero = run(11, { conclusion: 'cancelled' }), skipped = run(12, { conclusion: 'skipped' });
  const skippedJob = job(skipped, 1201, { conclusion: 'skipped', started_at: null, completed_at: null, steps: null });
  const report = f.handle.commitComplete({ runs: [zero, skipped], pages: [...pages(zero, []), ...pages(skipped, [skippedJob])], excludedIds: [] });
  assert.equal(report.page_count, 2); assert.equal(f.handle.loadVerified().pages.length, 2);
  f.handle.dispose(); cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('all attempts are retained, but caller must use fresh rows and critical IDs on the next complete commit', t => {
  const f = initialized(t), r = run(11, { run_attempt: 2, conclusion: 'failure' });
  const old = job(r, 101, { run_attempt: 1 }), failed = job(r, 102, { conclusion: 'failure',
    steps: [{ number: 1, name: 'Failed', status: 'completed', conclusion: 'failure',
      started_at: '2026-10-09T01:00:03Z', completed_at: '2026-10-09T01:00:04Z' }] });
  f.handle.commitComplete({ runs: [r], pages: pages(r, [old, failed]), excludedIds: [] });
  const loaded = f.handle.loadVerified(); assert.equal(validateJobsPages(r, loaded.pages, scope()).jobs.length, 2);
  loaded.runs[0].conclusion = 'success'; loaded.excludedIds.push(1000);
  assert.equal(f.handle.loadVerified().runs[0].conclusion, 'failure');
  f.handle.commitComplete({ runs: [r], pages: pages(r, [old, failed]), excludedIds: [r.id] });
  assert.deepEqual(f.handle.loadVerified().pages, []);
  f.handle.dispose(); cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('sparse retained pages are permitted only after a complete validated batch', t => {
  const f = initialized(t), r = run(), jobs = Array.from({ length: 101 }, (_, i) => job(r, 1000 + i));
  const complete = pages(r, jobs); complete[0].etag = null;
  assert.equal(f.handle.commitComplete({ runs: [r], pages: complete, excludedIds: [] }).page_count, 1);
  assert.equal(f.handle.loadVerified().pages[0].url, route(r.id, 2));
  assert.throws(() => f.handle.commitComplete({ runs: [r], pages: [complete[1]], excludedIds: [] }));
  f.handle.dispose('failed'); cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('serialized envelope cap evicts pages safely and reports the exact persisted subset', t => {
  const f = initialized(t), runs = [11, 12, 13, 14].map(id => run(id));
  const all = runs.flatMap(r => pages(r, [job(r)], { padding: 7 * 1024 * 1024 }));
  const result = f.handle.commitComplete({ runs, pages: all, excludedIds: [] });
  assert.equal(result.eviction_count, 1); assert.equal(result.page_count, 3);
  const stat = fs.statSync(join(f.directory, 'cache.json'));
  assert.equal(result.cache_bytes, stat.size); assert.ok(stat.size <= JOB_CACHE_LIMITS.fileBytes);
  const loaded = f.handle.loadVerified(); assert.equal(loaded.pages.length, 3);
  assert.deepEqual(loaded.runs.map(r => r.id), [12, 13, 14]);
  f.handle.dispose(); cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('orphan/duplicate/mismatched pages and empty successful inventories fail without dedup acceptance', t => {
  const f = initialized(t), r = run(), valid = pages(r);
  const bad = [{ runs: [r, r], pages: valid, excludedIds: [] },
    { runs: [r], pages: [valid[0], valid[0]], excludedIds: [] },
    { runs: [], pages: valid, excludedIds: [] },
    { runs: [r], pages: pages(r, []), excludedIds: [] }];
  for (const input of bad) {
    // A failed handle remains poisoned, so create a separate initialized state for each assertion.
    const h = initializeJobCache({ context: f.c, root: f.root, token: TOKEN });
    assert.throws(() => h.commitComplete(input)); h.dispose('failed');
    cleanupJobCache({ context: f.c, directory: h.directory, token: TOKEN });
  }
  f.handle.dispose(); cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('fresh handle accepts an old valid whole-pair replay, then server revalidates every retained page', async t => {
  const f = initialized(t), r = run();
  f.handle.commitComplete({ runs: [r], pages: pages(r), excludedIds: [] });
  const old = savedFiles(f.directory);
  f.handle.commitComplete({ runs: [r], pages: pages(r), excludedIds: [] }); f.handle.dispose();
  restoreFiles(f.directory, old);
  const h = openJobCache({ context: f.c, directory: f.directory, token: TOKEN }), loaded = h.loadVerified();
  assert.equal(loaded.generation, 1);
  let requests = 0;
  const result = await readConditionalDeploymentJobs({ scope: scope(), runs: [r], cache: loaded.pages,
    excludedIds: [], timeoutMs: 120000 }, { token: TOKEN, monotonic: () => 0, pause: async () => {},
    fetcher: async (url, init) => {
      requests++; assert.equal(init.headers['if-none-match'], 'W/"synthetic-exact-tag"');
      const response = new Response(null, { status: 304, headers: { etag: '"synthetic-exact-tag"',
        'x-ratelimit-limit': '15000', 'x-ratelimit-remaining': '14999', 'x-ratelimit-used': '1',
        'x-ratelimit-reset': '1791514800', 'x-ratelimit-resource': 'core' } });
      Object.defineProperty(response, 'url', { value: url }); return response;
    } });
  assert.equal(requests, 1); assert.equal(result.status, 'complete'); assert.equal(result.stats.revalidated_304, 1);
  h.dispose(); cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('trusted live handle rejects lower generations but does not claim cryptographic rollback resistance', t => {
  const f = initialized(t); f.handle.commitComplete(empty()); const old = savedFiles(f.directory);
  f.handle.commitComplete(empty()); restoreFiles(f.directory, old);
  assert.throws(() => f.handle.loadVerified(), /stale-cache-generation/);
  f.handle.dispose('failed'); cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('cleanup refuses unexpected files before deleting anything and retains its anchor across an unlink failure', t => {
  const f = closed(t), unexpected = join(f.directory, 'unrelated.txt');
  fs.writeFileSync(unexpected, 'keep', { mode: 0o600 });
  assert.throws(() => cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN }), /unexpected-cache-cleanup-file/);
  assert.equal(fs.existsSync(join(f.directory, 'manifest.json')), true); assert.equal(fs.existsSync(join(f.directory, 'cache.json')), true);
  fs.unlinkSync(unexpected);
  const interrupted = child(f, "const {cleanupJobCache}=await import(" + JSON.stringify(helperURL) + ");const native=fs.unlinkSync;fs.unlinkSync=function(path){if(path===directory+'/cache.json')throw new Error('synthetic unlink interruption');return Reflect.apply(native,this,arguments);};try{cleanupJobCache({context,directory});process.exitCode=1;}catch(error){process.stdout.write(JSON.stringify({rejected:true}));}");
  assert.equal(successfulChild(interrupted).rejected, true);
  assert.equal(fs.existsSync(join(f.directory, 'manifest.json')), true);
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});


test('owned live handle checks the exact private token without storing a credential fingerprint', t => {
  const f = initialized(t), before = savedFiles(f.directory);
  assert.equal(f.handle.assertPrivateToken(TOKEN), true);
  assert.throws(() => f.handle.assertPrivateToken(TOKEN + '-wrong'), /private-cache-token-mismatch/);
  assert.equal(f.handle.assertPrivateToken(TOKEN), true);
  assert.equal(fs.readFileSync(join(f.directory, 'cache.json')).equals(before['cache.json']), true);
  f.handle.dispose(); assert.throws(() => f.handle.assertPrivateToken(TOKEN), /disposed-or-unowned/);
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('future and 110-minute boundary reject initialize/open/load/commit; cleanup is still exact after expiry', t => {
  const root = rootFor(t), c = context(), start = Date.parse(c.job_started_at), end = start + JOB_CACHE_LIMITS.jobLifetimeMs;
  assert.throws(() => initializeNative({ context: c, root, token: TOKEN, now: () => start - 1 }), /future-or-expired/);
  assert.throws(() => initializeNative({ context: c, root, token: TOKEN, now: () => end }), /future-or-expired/);
  let clock = start;
  const h = initializeNative({ context: c, root, token: TOKEN, now: () => clock });
  assert.equal(h.loadVerified().generation, 0);
  clock = end - 1; assert.equal(h.commitComplete(empty()).generation, 1);
  clock = end; assert.throws(() => h.loadVerified(), /future-or-expired/);
  assert.throws(() => h.commitComplete(empty()), /failed-cache-handle/);
  h.dispose('failed');
  assert.throws(() => openNative({ context: c, directory: h.directory, token: TOKEN, now: () => end }), /future-or-expired/);
  cleanupJobCache({ context: c, directory: h.directory, token: TOKEN });
});

test('exact permissions reject setuid file and setgid directory bits', t => {
  const f = closed(t), file = join(f.directory, 'cache.json');
  fs.chmodSync(file, 0o4600);
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }), /unsafe-cache-file/);
  fs.chmodSync(file, 0o600); fs.chmodSync(f.directory, 0o2700);
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }), /unsafe-cache-directory/);
  fs.chmodSync(f.directory, 0o700); cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('same basename copied under another RUNNER_TEMP cannot authenticate exact path binding', t => {
  const f = closed(t), alternate = fs.mkdtempSync(join(tmpdir(), 'conditional-cache-alternate-'));
  t.after(() => fs.rmSync(alternate, { recursive: true, force: true }));
  const copied = join(alternate, basename(f.directory)); fs.cpSync(f.directory, copied, { recursive: true });
  fs.chmodSync(copied, 0o700);
  process.env.RUNNER_TEMP = alternate;
  assert.throws(() => openJobCache({ context: f.c, directory: copied, token: TOKEN }), /authentication-failed/);
  process.env.RUNNER_TEMP = f.root;
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('initializer failures after owned lease creation are recoverable failed state, including acquire fsync', t => {
  const f = closed(t);
  const renameFailure = child(f, "const original=fs.renameSync;fs.renameSync=function(from,to){if(to.endsWith('/manifest.json'))throw new Error('synthetic initialize interruption');return Reflect.apply(original,this,arguments);};try{initializeJobCache({context,root:process.env.RUNNER_TEMP});process.exitCode=1;}catch(error){const path=fs.readdirSync(process.env.RUNNER_TEMP).find(name=>name.startsWith('conditional-jobs-')&&process.env.RUNNER_TEMP+'/'+name!==directory);const lease=JSON.parse(fs.readFileSync(process.env.RUNNER_TEMP+'/'+path+'/lease.json'));const {cleanupJobCache}=await import(" + JSON.stringify(helperURL) + ");cleanupJobCache({context,directory:process.env.RUNNER_TEMP+'/'+path});process.stdout.write(JSON.stringify({status:lease.status,removed:true}));}");
  assert.deepEqual(successfulChild(renameFailure), { status: 'failed', removed: true });
  const fsyncFailure = child(f, "const native=fs.fsyncSync;let once=false;fs.fsyncSync=function(fd){if(!once&&fs.fstatSync(fd).isDirectory()){once=true;throw new Error('synthetic acquire fsync failure');}return Reflect.apply(native,this,arguments);};try{initializeJobCache({context,root:process.env.RUNNER_TEMP});process.exitCode=1;}catch(error){const path=fs.readdirSync(process.env.RUNNER_TEMP).find(name=>name.startsWith('conditional-jobs-')&&process.env.RUNNER_TEMP+'/'+name!==directory);const lease=JSON.parse(fs.readFileSync(process.env.RUNNER_TEMP+'/'+path+'/lease.json'));const {cleanupJobCache}=await import(" + JSON.stringify(helperURL) + ");cleanupJobCache({context,directory:process.env.RUNNER_TEMP+'/'+path});process.stdout.write(JSON.stringify({status:lease.status,removed:true}));}");
  assert.deepEqual(successfulChild(fsyncFailure), { status: 'failed', removed: true });
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});

test('final rmdir interruption restores the authenticated anchor for a later exact cleanup', t => {
  const f = closed(t);
  const result = child(f, "const {cleanupJobCache}=await import(" + JSON.stringify(helperURL) + ");const native=fs.rmdirSync;let once=false;fs.rmdirSync=function(path){if(path===directory&&!once){once=true;throw new Error('synthetic rmdir failure');}return Reflect.apply(native,this,arguments);};try{cleanupJobCache({context,directory});process.exitCode=1;}catch(error){process.stdout.write(JSON.stringify({anchor:fs.existsSync(directory+'/manifest.json')}));}");
  assert.deepEqual(successfulChild(result), { anchor: true });
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});


test('direct expired complete disposal poisons the lease before discarding its key', t => {
  const root = rootFor(t), c = context(), start = Date.parse(c.job_started_at);
  let clock = start;
  const h = initializeNative({ context: c, root, token: TOKEN, now: () => clock });
  clock = start + JOB_CACHE_LIMITS.jobLifetimeMs;
  assert.throws(() => h.dispose('complete'), /future-or-expired/);
  assert.equal(isOwnedJobCacheHandle(h), false);
  assert.equal(JSON.parse(fs.readFileSync(join(h.directory, 'lease.json'))).status, 'failed');
  cleanupJobCache({ context: c, directory: h.directory, token: TOKEN });
});

test('release directory-fsync failure recreates only its own failed lease without masking the native error', t => {
  const f = closed(t);
  const result = child(f, "const h=openJobCache({context,directory});const native=fs.fsyncSync;const failure=new Error('synthetic release fsync failure');let once=false;fs.fsyncSync=function(fd){if(!once&&fs.fstatSync(fd).isDirectory()&&!fs.existsSync(directory+'/lease.json')){once=true;throw failure;}return Reflect.apply(native,this,arguments);};let exact=false;try{h.dispose();process.exitCode=1;}catch(error){exact=error===failure;}process.stdout.write(JSON.stringify({exact,status:JSON.parse(fs.readFileSync(directory+'/lease.json')).status}));");
  assert.deepEqual(successfulChild(result), { exact: true, status: 'failed' });
  assert.throws(() => openJobCache({ context: f.c, directory: f.directory, token: TOKEN }), /locked-cache/);
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});


test('maximum valid job-name/context binds completely with bounded HKDF info and rejects wrong context/token', t => {
  const root = rootFor(t), c = context({ job_name: 'J'.repeat(1024) });
  const h = initializeJobCache({ context: c, root, token: TOKEN }), directory = h.directory;
  // This valid context/path exceeds Node's HKDF info limit if concatenated raw.
  assert.ok(Buffer.byteLength(JSON.stringify({ context: c, directory })) > 1024);
  assert.equal(h.assertPrivateToken(TOKEN), true);
  assert.throws(() => h.assertPrivateToken(TOKEN + '-wrong'), /private-cache-token-mismatch/);
  assert.equal(h.commitComplete(empty()).generation, 1); h.dispose();
  const wrongContext = context({ job_name: 'J'.repeat(1023) + 'K' });
  assert.throws(() => openJobCache({ context: wrongContext, directory, token: TOKEN }), /authentication-failed/);
  assert.throws(() => openJobCache({ context: c, directory, token: TOKEN + '-wrong' }), /authentication-failed/);
  const opened = openJobCache({ context: c, directory, token: TOKEN });
  assert.equal(opened.loadVerified().generation, 1); opened.dispose();
  cleanupJobCache({ context: c, directory, token: TOKEN });
});
