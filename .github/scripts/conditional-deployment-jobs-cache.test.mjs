// Synthetic transport fixtures only; these tests prove no publication authority.
// Native Node execution is required. No network, credential file, or artifact transfer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { initializeJobCache as initializeNative, openJobCache as openNative, cleanupJobCache, isOwnedJobCacheHandle, JOB_CACHE_LIMITS, createJobTransportBudget } from './conditional-deployment-jobs-cache.mjs';
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
    reader_version: '265ede759b1714c882015c696c6fac66975ae03a',
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


test('specified intended directory is exclusive, exact, and preserves context/token/path binding', t => {
  const root = rootFor(t), c = context(), prefix = 'conditional-jobs-' + c.job_id + '-' + c.role + '-';
  const intended = join(root, prefix + 'a'.repeat(32));
  const h = initializeJobCache({ context: c, root, directory: intended, token: TOKEN });
  assert.equal(h.directory, intended); assert.equal(h.loadVerified().generation, 0);
  assert.throws(() => initializeJobCache({ context: c, root, directory: intended, token: TOKEN }), /EEXIST/);
  assert.equal(h.loadVerified().generation, 0); h.dispose();
  const opened = openJobCache({ context: c, directory: intended, token: TOKEN }); opened.dispose();
  const invalid = [join(root, 'wrong-prefix-' + 'a'.repeat(32)), join(root, prefix + 'a'.repeat(31)),
    join(root, prefix + 'A'.repeat(32)), join(root, prefix + 'b'.repeat(32), 'child'),
    join(dirname(root), prefix + 'c'.repeat(32)), intended + '/', null];
  for (const directory of invalid) {
    assert.throws(() => initializeJobCache({ context: c, root, directory, token: TOKEN }), /unsafe-intended-cache-directory/);
  }
  const symlink = join(root, prefix + 'd'.repeat(32)); fs.symlinkSync(intended, symlink);
  assert.throws(() => initializeJobCache({ context: c, root, directory: symlink, token: TOKEN }), /EEXIST/);
  assert.equal(fs.existsSync(join(intended, 'manifest.json')), true);
  fs.unlinkSync(symlink); cleanupJobCache({ context: c, directory: intended, token: TOKEN });
});

test('specified path authenticates exact cleanup after initialization throws without scanning RUNNER_TEMP', t => {
  const f = closed(t), intended = join(f.root, 'conditional-jobs-' + f.c.job_id + '-' + f.c.role + '-' + 'e'.repeat(32));
  const result = child(f, "const target=process.env.CACHE_TEST_INTENDED;const native=fs.renameSync;const original=new Error('synthetic specified initialization failure');fs.renameSync=function(from,to){if(to===target+'/manifest.json')throw original;return Reflect.apply(native,this,arguments);};let exact=false;try{initializeJobCache({context,root:process.env.RUNNER_TEMP,directory:target});process.exitCode=1;}catch(error){exact=error===original;}const lease=JSON.parse(fs.readFileSync(target+'/lease.json'));const {cleanupJobCache}=await import(" + JSON.stringify(helperURL) + ");cleanupJobCache({context,directory:target});process.stdout.write(JSON.stringify({exact,status:lease.status,removed:!fs.existsSync(target)}));",
    { CACHE_TEST_INTENDED: intended });
  assert.deepEqual(successfulChild(result), { exact: true, status: 'failed', removed: true });
  cleanupJobCache({ context: f.c, directory: f.directory, token: TOKEN });
});


// Transport-budget accounting only. These synthetic policies establish no
// release allowance, callback/action bound, source admission or real quota.
function transportPolicy(c=context()) {
  return {schema_version:'conditional-job-budget-policy-v2',controller_sha:c.controller_sha,
    controller_tree:c.controller_tree,role:c.role,original_primary_limit:900,retained_reserve:50,
    phases:[0,1,2,3].map(i=>({id:'phase-'+i,command:'do',job_step:'Phase '+i,ordinal:i+1,
      maximum_primary:20,maximum_starts:20,future_primary:60-i*20,future_transient_primary:0,planned_primary:20,external_future_primary:0,bootstrap_maximum_primary:4,bootstrap_maximum_starts:3}))};
}
const transportQuota=(remaining,reset=Math.floor(TEST_NOW/1000)+600)=>({limit:1000,used:1000-remaining,
  remaining,reset_epoch:reset,resource:'core'});
const transportPhase=i=>({id:'phase-'+i,command:'do',job_step:'Phase '+i,ordinal:i+1});
function transportFixture(options={}) {
  let clock=TEST_NOW;const writes=[],c=context(),policy=transportPolicy(c);
  const boundary={route:'repos/'+c.repository+'/actions/runs/'+c.run_id,status:200,backoff:false,
    request_started_at_epoch_ms:clock,response_received_at_epoch_ms:clock,completed_at_epoch_ms:clock};
  const index=options.saved?options.saved.last_completed_phase+1:0;
  const model=createJobTransportBudget({context:c,policy,initialQuota:options.saved?null:transportQuota(900),
    quotaBoundary:options.saved?null:boundary,verifiedBootstrapPhase:transportPhase(index),
    now:()=>clock,persist:v=>writes.push(v),...options});
  return {model,writes,c,policy,setClock:n=>{clock=n;}};
}
test('budget reservations preserve the existing exact jobs-only return contract',t=>{
  const f=initialized(t);
  assert.equal(f.handle.loadTransportBudget({allowUninitialized:true}),null);
  const model=createJobTransportBudget({context:f.c,policy:transportPolicy(f.c),
    initialQuota:transportQuota(900),quotaBoundary:{route:'repos/'+f.c.repository+'/actions/runs/'+f.c.run_id,status:200,backoff:false,
      request_started_at_epoch_ms:TEST_NOW,response_received_at_epoch_ms:TEST_NOW,completed_at_epoch_ms:TEST_NOW},
    verifiedBootstrapPhase:transportPhase(0),now:()=>TEST_NOW,persist:v=>f.handle.commitTransportBudget(v)});
  model.begin(transportPhase(0));const before=JSON.stringify(f.handle.loadTransportBudget());
  f.handle.commitComplete(empty());assert.equal(JSON.stringify(f.handle.loadTransportBudget()),before);
  assert.deepEqual(Object.keys(f.handle.loadVerified()).sort(),['excludedIds','generation','pages','runs']);
  model.finish();f.handle.dispose();
});

test('authenticated cache storage carries completed allowance across an actual Node process',t=>{
  const f=initialized(t),model=createJobTransportBudget({context:f.c,policy:transportPolicy(f.c),
    initialQuota:transportQuota(900),quotaBoundary:{route:'repos/'+f.c.repository+'/actions/runs/'+f.c.run_id,status:200,backoff:false,
      request_started_at_epoch_ms:TEST_NOW,response_received_at_epoch_ms:TEST_NOW,completed_at_epoch_ms:TEST_NOW},
    verifiedBootstrapPhase:transportPhase(0),now:()=>TEST_NOW,persist:v=>f.handle.commitTransportBudget(v)});
  model.begin(transportPhase(0));const id=model.reserve();
  model.settle(id,{operationComplete:true,known200:1,sampleStatus:200,quota:transportQuota(800)});model.finish();f.handle.dispose();
  const source="const {createJobTransportBudget}=await import("+JSON.stringify(helperURL)+");"+
    "const h=openJobCache({context,directory});const saved=h.loadTransportBudget();"+
    "const policy="+JSON.stringify(transportPolicy(f.c))+";"+
    "const model=createJobTransportBudget({context,policy,saved,verifiedBootstrapPhase:{id:\"phase-1\",command:\"do\",job_step:\"Phase 1\",ordinal:2},now,persist:v=>h.commitTransportBudget(v)});"+
    "model.begin("+JSON.stringify(transportPhase(1))+");model.observe("+JSON.stringify(transportQuota(899))+");"+
    "const result=model.finish();h.dispose();process.stdout.write(JSON.stringify(result));";
  const result=child(f,source);successfulChild(result);const saved=JSON.parse(result.stdout);
  assert.equal(saved.last_completed_phase,1);assert.equal(saved.spent_primary,1);
  assert.equal(saved.current_window.credit,799);
});

test('later missing transport state is terminal even if ordinary cache rows remain valid',t=>{
  const f=initialized(t);f.handle.commitComplete(empty());
  assert.throws(()=>f.handle.loadTransportBudget({allowUninitialized:true}),/missing-initialized-transport-budget/);
  assert.equal(isOwnedJobCacheHandle(f.handle),false);f.handle.dispose('failed');
});

test('stored allowance binding or consumed-charge rollback poisons the owned cache handle',t=>{
  const f=initialized(t),model=createJobTransportBudget({context:f.c,policy:transportPolicy(f.c),
    initialQuota:transportQuota(900),quotaBoundary:{route:'repos/'+f.c.repository+'/actions/runs/'+f.c.run_id,status:200,backoff:false,
      request_started_at_epoch_ms:TEST_NOW,response_received_at_epoch_ms:TEST_NOW,completed_at_epoch_ms:TEST_NOW},
    verifiedBootstrapPhase:transportPhase(0),now:()=>TEST_NOW,persist:v=>f.handle.commitTransportBudget(v)});
  model.begin(transportPhase(0));const id=model.reserve();model.settle(id,{operationComplete:true,known200:1,sampleStatus:200,quota:transportQuota(899)});
  const saved=model.finish(),forged=copy(saved);forged.spent_primary=0;
  forged.pending_phase={...transportPolicy(f.c).phases[1],index:1,retained_reserve:50,started_at_epoch_ms:TEST_NOW};
  assert.throws(()=>f.handle.commitTransportBudget(forged),/binding-or-consumption-rollback|invalid-state/);
  assert.equal(isOwnedJobCacheHandle(f.handle),false);f.handle.dispose('failed');
});

test('interrupted storage phase cannot be reopened as completed or cleaned while its owner is alive',t=>{
  const f=initialized(t),model=createJobTransportBudget({context:f.c,policy:transportPolicy(f.c),
    initialQuota:transportQuota(900),quotaBoundary:{route:'repos/'+f.c.repository+'/actions/runs/'+f.c.run_id,status:200,backoff:false,
      request_started_at_epoch_ms:TEST_NOW,response_received_at_epoch_ms:TEST_NOW,completed_at_epoch_ms:TEST_NOW},
    verifiedBootstrapPhase:transportPhase(0),now:()=>TEST_NOW,persist:v=>f.handle.commitTransportBudget(v)});
  model.begin(transportPhase(0));model.fail();f.handle.dispose('failed');
  assert.throws(()=>openJobCache({context:f.c,directory:f.directory,token:TOKEN}),/incomplete-or-locked-cache/);
  const result=cleanupJobCache({context:f.c,directory:f.directory,token:TOKEN});
  assert.equal(result.removed,true);
});

test('delayed quota cannot admit a remaining path above actual same-window or reset headroom',()=>{
  for(const reset of [false,true]) {
    let now=TEST_NOW;const c=context(),policy={...transportPolicy(c),original_primary_limit:20,retained_reserve:0,
      phases:[{...transportPolicy(c).phases[0],maximum_primary:2,maximum_starts:2,future_primary:9,planned_primary:2,external_future_primary:9,bootstrap_maximum_primary:0,bootstrap_maximum_starts:0}]};
    const q=(remaining,epoch=Math.floor(TEST_NOW/1000)+600)=>({limit:20,used:20-remaining,remaining,reset_epoch:epoch,resource:'core'});
    const model=createJobTransportBudget({context:c,policy,initialQuota:q(20),quotaBoundary:{route:'repos/'+c.repository+'/actions/runs/'+c.run_id,status:200,backoff:false,
      request_started_at_epoch_ms:now,response_received_at_epoch_ms:now,completed_at_epoch_ms:now},verifiedBootstrapPhase:transportPhase(0),now:()=>now,persist:()=>{}});
    model.observe(q(12));model.begin(transportPhase(0));const a=model.reserve(),b=model.reserve();
    // External depletion2 precedes B's server charge/sample9. A then charges1
    // and settles without a header before B's delayed sample is reconciled.
    if(reset)now+=601000;
    model.settle(a,{operationComplete:true,known200:1});model.settle(b,{operationComplete:true,known200:1,sampleOwn200:1,sampleStatus:200,quota:q(9,reset?Math.floor(TEST_NOW/1000)+4200:undefined)});
    assert.equal(model.snapshot().spent_primary,2);assert.equal(model.snapshot().current_window.credit,8);
    assert.throws(()=>model.finish(),/remaining-path-allowance/);
  }
});

test('selected304 cannot claim another child200 as its own included primary charge',()=>{
  const {model}=transportFixture();model.begin(transportPhase(0));
  const id=model.reserve({maximumPrimary:4,maximumStarts:2});
  assert.throws(()=>model.settle(id,{operationComplete:true,known200:1,validated304:1,sampleOwn200:1,sampleStatus:304,quota:transportQuota(899)}),
    /invalid-settlement/);
  assert.throws(()=>model.reserve(),/terminal-model/);
});

test('opaque-only unresolved issuance cannot settle into a clean completed phase',()=>{
  const {model}=transportFixture();model.begin(transportPhase(0));const id=model.reserve({maximumPrimary:2});
  assert.throws(()=>model.settle(id,{operationComplete:true,opaquePrimary:1}),/invalid-settlement/);
  assert.throws(()=>model.finish(),/terminal-model/);
});

test('cold completion retains the next warm batch uplift before another ordinary read',()=>{
  const c=context(),p=transportPolicy(c);p.original_primary_limit=809;p.retained_reserve=0;
  p.phases=[
    {...p.phases[0],maximum_primary:806,maximum_starts:403,planned_primary:406,future_primary:3,
      future_transient_primary:397,bootstrap_maximum_primary:0,bootstrap_maximum_starts:0},
    {...p.phases[1],maximum_primary:400,maximum_starts:200,planned_primary:3,future_primary:0,
      future_transient_primary:0,bootstrap_maximum_primary:0,bootstrap_maximum_starts:0}
  ];
  const f=transportFixture({policy:p,initialQuota:transportQuota(809)});f.model.begin(transportPhase(0));
  const cold=f.model.reserve({maximumPrimary:400,maximumStarts:200,plannedPrimary:184});
  f.model.settle(cold,{operationComplete:true,known200:184});
  f.model.observe(transportQuota(600));
  assert.throws(()=>f.model.reserve({maximumPrimary:1,maximumStarts:1,plannedPrimary:1}),
    /remaining-path-allowance/);
});

test('last history retains native acquisition risk until the whole phase completes',()=>{
  const c=context(),p=transportPolicy(c);p.original_primary_limit=433;p.retained_reserve=0;
  p.phases=[{...p.phases[0],maximum_primary:433,maximum_starts:280,planned_primary:36,
    future_primary:0,future_transient_primary:0,bootstrap_maximum_primary:0,bootstrap_maximum_starts:0}];
  const f=transportFixture({policy:p,initialQuota:transportQuota(433)});f.model.begin(transportPhase(0));
  const history=f.model.reserve({maximumPrimary:400,maximumStarts:200,plannedPrimary:3});
  f.model.settle(history,{operationComplete:true,known200:3});
  f.model.observe(transportQuota(159));
  assert.throws(()=>f.model.reserve({maximumPrimary:160,maximumStarts:80,plannedPrimary:33}),
    /remaining-path-allowance/);
});

test('phase finish retains a future warm uplift without summing sequential holds',()=>{
  const c=context(),p=transportPolicy(c);p.original_primary_limit=401;p.retained_reserve=0;
  p.phases=[
    {...p.phases[0],maximum_primary:1,maximum_starts:1,planned_primary:1,future_primary:3,
      future_transient_primary:397,bootstrap_maximum_primary:0,bootstrap_maximum_starts:0},
    {...p.phases[1],maximum_primary:400,maximum_starts:200,planned_primary:3,future_primary:0,
      future_transient_primary:0,bootstrap_maximum_primary:0,bootstrap_maximum_starts:0}
  ];
  const f=transportFixture({policy:p,initialQuota:transportQuota(401)});f.model.begin(transportPhase(0));
  const id=f.model.reserve();f.model.settle(id,{operationComplete:true,completedGhJson:1});
  f.model.observe(transportQuota(399));
  assert.throws(()=>f.model.finish(),/remaining-path-allowance/);
});

test('a policy cannot omit the transient uplift of a later native operation',()=>{
  const c=context(),p=transportPolicy(c);
  p.phases[1]={...p.phases[1],maximum_primary:160,planned_primary:20};
  assert.throws(()=>transportFixture({policy:p}),/invalid-remaining-transient-policy/);
});


test('direct transport initialization cannot adopt a jobs-only committed generation',t=>{
  const f=initialized(t);f.handle.commitComplete(empty());
  const model=createJobTransportBudget({context:f.c,policy:transportPolicy(f.c),
    initialQuota:transportQuota(900),quotaBoundary:{route:'repos/'+f.c.repository+'/actions/runs/'+f.c.run_id,status:200,backoff:false,
      request_started_at_epoch_ms:TEST_NOW,response_received_at_epoch_ms:TEST_NOW,completed_at_epoch_ms:TEST_NOW},
    verifiedBootstrapPhase:transportPhase(0),now:()=>TEST_NOW,persist:v=>f.handle.commitTransportBudget(v)});
  assert.throws(()=>model.begin(transportPhase(0)),/transport-budget-initial-phase-required/);
  assert.equal(isOwnedJobCacheHandle(f.handle),false);
  assert.throws(()=>model.reserve(),/terminal-model/);
  f.handle.dispose('failed');
});


// V3 accounting integration only: real authenticated storage/process transitions
// and linked strict policy. These fixtures grant no publication authority.
import { finiteTransportBudgetPolicy } from './retained-price-finite-transport-policy.mjs';
function pooledPolicy(c=context(),changes={}) {
  const p=transportPolicy(c);
  return {...p,schema_version:'conditional-job-budget-policy-v3',
    extra_primary:{native_extra:12,ordinary_extra:16,terminal_miss:16},
    phases:p.phases.map(phase=>({...phase,predecessor_model_primary:0,predecessor_model_step:null})),...changes};
}
function pooledFixture(options={}) {
  const c=options.context??context(),policy=options.policy??pooledPolicy(c);
  return transportFixture({context:c,policy,...options});
}
test('v3 paid pools retain classified costs when baseline savings offset the aggregate',()=>{
  const p=pooledPolicy();p.original_primary_limit=500;p.retained_reserve=0;
  p.phases=[{...p.phases[0],planned_primary:60,maximum_primary:457,maximum_starts:500,
    future_primary:0,future_transient_primary:0,bootstrap_maximum_primary:60,bootstrap_maximum_starts:60}];
  const f=pooledFixture({policy:p,initialQuota:transportQuota(700),bootstrapPrimary:54,bootstrapStarts:54,
    bootstrapPlannedPrimary:54,bootstrapExtraPrimary:{native_extra:0,ordinary_extra:1,terminal_miss:0}});
  f.model.begin(transportPhase(0));
  const s=f.model.snapshot();assert.equal(s.spent_primary,54);assert.equal(s.extra_primary_used.ordinary_extra,1);
  // Forecast54, baseline53 and extra1 is not a zero-extra event.
  assert.equal(s.original_primary_limit,500);
});
test('warm terminal misses spend their fixed pool despite absent active baseline pages',()=>{
  const p=pooledPolicy();p.original_primary_limit=402;p.retained_reserve=0;p.extra_primary={native_extra:0,ordinary_extra:0,terminal_miss:2};
  p.phases=[{...p.phases[0],planned_primary:3,maximum_primary:400,maximum_starts:200,
    future_primary:0,future_transient_primary:0,bootstrap_maximum_primary:0,bootstrap_maximum_starts:0}];
  const f=pooledFixture({policy:p,initialQuota:transportQuota(900)});f.model.begin(transportPhase(0));
  const r=f.model.reserve({maximumPrimary:400,maximumStarts:200,plannedPrimary:3});
  f.model.settle(r,{known200:3,operationComplete:true,extraPrimary:{native_extra:0,ordinary_extra:0,terminal_miss:2}});
  f.model.recordHistoryWeight(192);const s=f.model.finish();
  assert.equal(s.spent_primary,3);assert.equal(s.extra_primary_used.terminal_miss,2);
  assert.equal(s.history_initial_weight,192);
});
test('v3 unclassified excess and paid pool exhaustion are terminal before acceptance',()=>{
  for(const extra of [0,3]) {
    const p=pooledPolicy();p.extra_primary={native_extra:0,ordinary_extra:0,terminal_miss:2};
    const f=pooledFixture({policy:p});f.model.begin(transportPhase(0));
    const r=f.model.reserve({maximumPrimary:4,maximumStarts:4,plannedPrimary:1});
    assert.throws(()=>f.model.settle(r,{known200:3,operationComplete:true,
      extraPrimary:{native_extra:0,ordinary_extra:0,terminal_miss:extra}}),/extra-pool-exhausted/);
    assert.throws(()=>f.model.finish(),/terminal-model/);
  }
});
test('durable pool use and initial weighted inventory survive jobs commits and a real process reopen',t=>{
  const f=initialized(t),p=pooledPolicy(f.c);
  const model=createJobTransportBudget({context:f.c,policy:p,initialQuota:transportQuota(900),
    quotaBoundary:{route:'repos/'+f.c.repository+'/actions/runs/'+f.c.run_id,status:200,backoff:false,
      request_started_at_epoch_ms:TEST_NOW,response_received_at_epoch_ms:TEST_NOW,completed_at_epoch_ms:TEST_NOW},
    verifiedBootstrapPhase:transportPhase(0),now:()=>TEST_NOW,persist:v=>f.handle.commitTransportBudget(v)});
  model.begin(transportPhase(0));const id=model.reserve({maximumPrimary:2,maximumStarts:2,plannedPrimary:1});
  model.settle(id,{known200:2,operationComplete:true,extraPrimary:{native_extra:0,ordinary_extra:0,terminal_miss:1}});
  model.recordHistoryWeight(185);const saved=model.finish(),before=JSON.stringify(saved);
  f.handle.commitComplete(empty());assert.equal(JSON.stringify(f.handle.loadTransportBudget()),before);f.handle.dispose();
  const source="const {createJobTransportBudget}=await import("+JSON.stringify(helperURL)+");"+
    "const h=openJobCache({context,directory});const saved=h.loadTransportBudget();"+
    "const model=createJobTransportBudget({context,policy:"+JSON.stringify(p)+",saved,verifiedBootstrapPhase:"+
    JSON.stringify(transportPhase(1))+",now,persist:v=>h.commitTransportBudget(v)});"+
    "model.begin("+JSON.stringify(transportPhase(1))+");model.recordHistoryWeight(190);"+
    "const id=model.reserve({maximumPrimary:2,maximumStarts:2,plannedPrimary:1});"+
    "model.settle(id,{known200:2,operationComplete:true,extraPrimary:{native_extra:0,ordinary_extra:0,terminal_miss:1}});"+
    "const result=model.finish();h.dispose();process.stdout.write(JSON.stringify(result));";
  const out=successfulChild(child(f,source));assert.equal(out.original_primary_limit,900);assert.equal(out.spent_primary,4);
  assert.equal(out.extra_primary_used.terminal_miss,2);assert.equal(out.history_initial_weight,185);assert.equal(out.history_max_weight,190);
  cleanupJobCache({context:f.c,directory:f.directory,token:TOKEN});
});
test('v3 storage rejects a pool replenishment or changed initial cohort even with valid owned access',t=>{
  for(const mutate of [s=>{s.extra_primary_used.terminal_miss=0;},s=>{s.history_initial_weight=184;}]) {
    const f=initialized(t),p=pooledPolicy(f.c),model=createJobTransportBudget({context:f.c,policy:p,
      initialQuota:transportQuota(900),quotaBoundary:{route:'repos/'+f.c.repository+'/actions/runs/'+f.c.run_id,status:200,backoff:false,
        request_started_at_epoch_ms:TEST_NOW,response_received_at_epoch_ms:TEST_NOW,completed_at_epoch_ms:TEST_NOW},
      verifiedBootstrapPhase:transportPhase(0),now:()=>TEST_NOW,persist:v=>f.handle.commitTransportBudget(v)});
    model.begin(transportPhase(0));const r=model.reserve({maximumPrimary:2,maximumStarts:2,plannedPrimary:1});
    model.settle(r,{known200:2,operationComplete:true,extraPrimary:{native_extra:0,ordinary_extra:0,terminal_miss:1}});
    model.recordHistoryWeight(185);const forged=copy(model.finish());mutate(forged);
    forged.next_bootstrap=null;forged.pending_phase={...p.phases[1],index:1,retained_reserve:p.retained_reserve,started_at_epoch_ms:TEST_NOW};
    assert.throws(()=>f.handle.commitTransportBudget(forged),/binding-or-consumption-rollback/);
    assert.equal(isOwnedJobCacheHandle(f.handle),false);f.handle.dispose('failed');
    cleanupJobCache({context:f.c,directory:f.directory,token:TOKEN});
  }
});
test('prepare-controller charges one completed-step model and never becomes new post-header debt',()=>{
  const p=pooledPolicy();p.phases=p.phases.slice(0,2);p.phases[0].future_primary=36;p.phases[1].future_primary=0;
  p.phases[1].predecessor_model_primary=16;p.phases[1].predecessor_model_step='Prepare immutable controller for finite price publication';
  const f=pooledFixture({policy:p});f.model.begin(transportPhase(0));const saved=f.model.finish();
  const t=TEST_NOW+3,boundary={route:'repos/'+f.c.repository+'/actions/runs/'+f.c.run_id,status:200,backoff:false,
    request_started_at_epoch_ms:t,response_received_at_epoch_ms:t,completed_at_epoch_ms:t};
  const proof={step:p.phases[1].predecessor_model_step,status:'completed',conclusion:'success',completed_at_epoch_ms:TEST_NOW+1};
  const options={context:f.c,policy:p,saved,initialQuota:transportQuota(310),quotaBoundary:boundary,
    verifiedBootstrapPhase:transportPhase(1),bootstrapPrimary:1,bootstrapStarts:1,bootstrapPlannedPrimary:1,
    bootstrapSinceSamplePrimary:0,completedStepModelPrimary:16,verifiedPredecessorModel:proof,now:()=>t,persist:()=>{}};
  const model=createJobTransportBudget(options);model.begin(transportPhase(1));const s=model.snapshot();
  assert.equal(s.spent_primary,17);assert.equal(s.bootstrap_primary_debit,1);assert.equal(s.completed_step_model_primary,16);
  assert.equal(s.logical_issued,1);assert.equal(s.known_200,0);assert.equal(s.unknown_issued,0);assert.equal(s.current_window.credit,310);
  for(const changed of [{...proof,status:'in_progress'},{...proof,conclusion:'skipped'},
    {...proof,step:'Foreign prepare step'},{...proof,completed_at_epoch_ms:t+1}]) {
    assert.throws(()=>createJobTransportBudget({...options,verifiedPredecessorModel:changed}),/unverified-predecessor-model/);
  }
});
test('fresh total weighted capacity records192 initially and rejects201 without partial growth credit',()=>{
  const f=pooledFixture();f.model.begin(transportPhase(0));f.model.recordHistoryWeight(192);f.model.recordHistoryWeight(200);f.model.recordHistoryWeight(180);
  assert.equal(f.model.snapshot().history_initial_weight,192);assert.equal(f.model.snapshot().history_max_weight,200);
  assert.throws(()=>f.model.recordHistoryWeight(201),/invalid-history-weight/);
  const g=pooledFixture();g.model.begin(transportPhase(0));assert.throws(()=>g.model.recordHistoryWeight(193),/initial-history-weight-cap/);
});
test('missing-resource native headers only lower the confirmed window with all sibling debt',()=>{
  const p=pooledPolicy();p.original_primary_limit=30;p.retained_reserve=0;p.extra_primary={native_extra:0,ordinary_extra:0,terminal_miss:0};
  p.phases=[{...p.phases[0],maximum_primary:6,maximum_starts:3,planned_primary:3,
    future_primary:10,external_future_primary:10,future_transient_primary:0,bootstrap_maximum_primary:0,bootstrap_maximum_starts:0}];
  const f=pooledFixture({policy:p,initialQuota:transportQuota(30)});f.model.begin(transportPhase(0));
  const r=f.model.reserve({maximumPrimary:6,maximumStarts:3,plannedPrimary:3});
  f.model.settle(r,{known200:3,operationComplete:true});
  const q={...transportQuota(27),resource:null};
  assert.equal(f.model.lowerUnclassifiedQuota(q,{otherSettledDebt:2}),true);
  assert.equal(f.model.snapshot().current_window.credit,25);
  assert.equal(f.model.lowerUnclassifiedQuota({...q,reset_epoch:q.reset_epoch+3600},{otherSettledDebt:0}),false);
  assert.equal(f.model.snapshot().current_window.credit,25);
  assert.equal(f.model.lowerUnclassifiedQuota({...transportQuota(29),resource:null},{otherSettledDebt:0}),true);
  assert.equal(f.model.snapshot().current_window.credit,25);
  assert.throws(()=>f.model.lowerUnclassifiedQuota(q),/invalid-unclassified-quota/);
});
test('linked W192 source suffix rejects4920 and accepts the exact4928 header boundary',()=>{
  const c=context({role:'producer-combine',job_name:'combine-and-build'}),p=finiteTransportBudgetPolicy(c);
  const open=remaining=>createJobTransportBudget({context:c,policy:p,
    initialQuota:{limit:5000,used:5000-remaining,remaining,reset_epoch:Math.floor(TEST_NOW/1000)+600,resource:'core'},
    quotaBoundary:{route:'repos/'+c.repository+'/actions/runs/'+c.run_id,status:200,backoff:false,
      request_started_at_epoch_ms:TEST_NOW,response_received_at_epoch_ms:TEST_NOW,completed_at_epoch_ms:TEST_NOW},
    verifiedBootstrapPhase:{id:'produce',command:'produce',job_step:'Build static frontend',ordinal:1},
    bootstrapPrimary:54,bootstrapStarts:54,bootstrapSinceSamplePrimary:45,bootstrapPlannedPrimary:54,now:()=>TEST_NOW,persist:()=>{}});
  assert.throws(()=>open(4920),/bootstrap-allowance/);
  const model=open(4928);model.begin({id:'produce',command:'produce',job_step:'Build static frontend',ordinal:1});
  assert.equal(model.snapshot().original_primary_limit,4937);assert.equal(model.snapshot().spent_primary,54);
  assert.equal(model.snapshot().current_window.credit,4883);
});


test('bootstrap raw minima preserve pre-anchor debt and apply post-anchor debt once',()=>{
  const p=pooledPolicy();p.original_primary_limit=1500;p.retained_reserve=0;
  p.extra_primary={native_extra:0,ordinary_extra:0,terminal_miss:0};
  p.phases=[0,1].map(i=>({...p.phases[0],id:'phase-'+i,job_step:'Phase '+i,ordinal:i+1,
    planned_primary:32,maximum_primary:32,maximum_starts:32,future_primary:i===0?32:0,future_transient_primary:0,
    bootstrap_maximum_primary:32,bootstrap_maximum_starts:32}));
  const q=remaining=>({limit:2000,used:2000-remaining,remaining,reset_epoch:Math.floor(TEST_NOW/1000)+600,resource:'core'});
  const f=pooledFixture({policy:p,initialQuota:q(1700),bootstrapPrimary:32,bootstrapStarts:32,
    bootstrapPlannedPrimary:32,bootstrapSinceSamplePrimary:2,
    bootstrapMinimumObservation:{raw_minimum_remaining:1500,available_before_since_sample:1470}});
  assert.equal(f.model.snapshot().current_window.minimum_remaining_header,1500);
  assert.equal(f.model.snapshot().current_window.credit,1468);
  const tooLarge={...p,original_primary_limit:1501};
  assert.throws(()=>pooledFixture({policy:tooLarge,initialQuota:q(1700),bootstrapPrimary:32,bootstrapStarts:32,
    bootstrapPlannedPrimary:32,bootstrapSinceSamplePrimary:2,
    bootstrapMinimumObservation:{raw_minimum_remaining:1500,available_before_since_sample:1470}}),/bootstrap-allowance/);
  f.model.begin(transportPhase(0));f.model.finish();
  const saved=f.model.snapshot(),c=f.c,now=TEST_NOW+1;
  const reopen=(observation)=>createJobTransportBudget({context:c,policy:p,saved,initialQuota:q(1700),
    quotaBoundary:{route:'repos/'+c.repository+'/actions/runs/'+c.run_id,status:200,backoff:false,
      request_started_at_epoch_ms:now,response_received_at_epoch_ms:now,completed_at_epoch_ms:now},
    verifiedBootstrapPhase:transportPhase(1),bootstrapPrimary:2,bootstrapStarts:2,
    bootstrapPlannedPrimary:2,bootstrapSinceSamplePrimary:2,bootstrapMinimumObservation:observation,
    now:()=>now,persist:()=>{}});
  assert.equal(reopen({raw_minimum_remaining:1600,available_before_since_sample:1600}).snapshot().current_window.credit,1466);
  const lower=reopen({raw_minimum_remaining:1400,available_before_since_sample:1370}).snapshot();
  assert.equal(lower.current_window.minimum_remaining_header,1400);assert.equal(lower.current_window.credit,1368);
  assert.throws(()=>reopen({raw_minimum_remaining:1500,available_before_since_sample:1501}),/invalid-bootstrap-minimum/);
});
