import fs from 'node:fs';
import { resolve, join, dirname, basename, isAbsolute } from 'node:path';
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { REQUEST_REPRESENTATION, CONDITIONAL_DEPLOYMENT_JOB_LIMITS, validateScope, runKey, decodePageRecord, validateJobsPages } from './conditional-deployment-jobs-worker.mjs';

// Storage authentication only. Loaded rows/critical IDs are stale transport metadata.
// Every retained page still needs an authenticated server 200/304 revalidation.
// HMAC cannot prevent same-user replay of an entire previously valid state pair.
export const JOB_CACHE_LIMITS = Object.freeze({ fileBytes: 32 * 1024 * 1024, metadataBytes: 16384, jobLifetimeMs: 110 * 60 * 1000 });
const READER = 'aec69c0bafd2ab0c2ab33bbf935242be284616df';
const SCHEMA = 'conditional-deployment-jobs-cache-context-v1';
const DOMAIN = 'screener/job-local-conditional-jobs-cache/v1';
const OWNED = new WeakMap();
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const positive = v => Number.isSafeInteger(v) && v > 0;
const canonical = value => JSON.stringify(value, (_key, item) => object(item) ?
  Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const clone = value => JSON.parse(canonical(value));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exactKeys = (value, keys) => object(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',');
class CacheFault extends Error {
  constructor(code) { super(code); this.name = 'JobCacheFault'; this.code = code; }
}
const need = (ok, code) => { if (!ok) throw new CacheFault(code); };
function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) deepFreeze(item); Object.freeze(value); }
  return value;
}
function checkedContext(value) {
  need(exactKeys(value, 'repository,repository_id,run_id,run_attempt,job_id,job_name,job_started_at,role,controller_sha,controller_tree,request_sha256,event_sha256,schema_version,reader_version,representation'), 'invalid-context');
  const context = clone(value);
  validateScope(scopeOf(context));
  need(positive(context.job_id) && typeof context.job_name === 'string' &&
    Buffer.byteLength(context.job_name) <= 1024 && context.job_name.length > 0 &&
    !/[\u0000-\u001f\u007f]/.test(context.job_name), 'invalid-job-binding');
  need(typeof context.job_started_at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(context.job_started_at) &&
    Number.isFinite(Date.parse(context.job_started_at)), 'invalid-job-clock');
  need(['producer-combine', 'publisher', 'diagnostic'].includes(context.role) &&
    context.schema_version === SCHEMA && context.reader_version === READER &&
    /^[a-f0-9]{40}$/.test(context.controller_tree) &&
    /^[a-f0-9]{64}$/.test(context.request_sha256) && /^[a-f0-9]{64}$/.test(context.event_sha256) &&
    canonical(context.representation) === canonical(REQUEST_REPRESENTATION), 'invalid-context-binding');
  need(Buffer.byteLength(canonical(context)) <= JOB_CACHE_LIMITS.metadataBytes / 2, 'context-cap');
  return deepFreeze(context);
}
function checkedClock(context, now) {
  need(typeof now === 'function', 'invalid-cache-clock');
  const clock = now(), start = Date.parse(context.job_started_at);
  need(Number.isFinite(clock) && clock >= start && clock < start + JOB_CACHE_LIMITS.jobLifetimeMs, 'future-or-expired-cache-job');
}
function poisonOwnLease(state) {
  if (!state) return;
  try {
    let lease;
    try { lease = leaseValue(state); }
    catch (error) {
      if (error.code !== 'ENOENT' || !state.releasing) throw error;
      // The verified owning disposer removed its lease before directory fsync failed.
      // Exclusive creation cannot replace a competing holder's newly acquired lease.
      checkedDirectory(state.context, state.directory, state.identity);
      writeExclusive(join(state.directory, 'lease.json'), Buffer.from(canonical(signed(leaseBody(state, 'failed'), state.key, 'lease'))));
      syncDirectory(state); return;
    }
    if (lease.pid === process.pid && lease.nonce === state.nonce && lease.status === 'pending') {
      writeAtomic(state, 'lease.json', Buffer.from(canonical(signed(leaseBody(state, 'failed'), state.key, 'lease'))));
    }
  } catch { /* Keep the original failure and pending lease; never unlock or accept it. */ }
}
function scopeOf(c) {
  return { repository: c.repository, repository_id: c.repository_id, run_id: c.run_id,
    run_attempt: c.run_attempt, controller_sha: c.controller_sha };
}
function checkedRoot(root) {
  need(typeof root === 'string' && isAbsolute(root) && root === resolve(root) &&
    typeof process.env.RUNNER_TEMP === 'string' && root === resolve(process.env.RUNNER_TEMP), 'unsafe-cache-root');
  const stat = fs.lstatSync(root);
  need(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(root) === root, 'unsafe-cache-root');
  return root;
}
function checkedDirectory(context, directory, expected = null) {
  need(typeof directory === 'string' && directory === resolve(directory), 'unsafe-cache-directory');
  const root = checkedRoot(dirname(directory)), name = basename(directory);
  const prefix = 'conditional-jobs-' + context.job_id + '-' + context.role + '-';
  need(name.startsWith(prefix) && /^[a-f0-9]{32}$/.test(name.slice(prefix.length)), 'unsafe-cache-directory');
  const stat = fs.lstatSync(directory, { bigint: true });
  need(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o7777n) === 0o700n &&
    stat.uid === BigInt(process.getuid()) && fs.realpathSync(directory) === directory, 'unsafe-cache-directory');
  if (expected) need(stat.dev === expected.dev && stat.ino === expected.ino, 'cache-directory-replaced');
  return { root, name, dev: stat.dev, ino: stat.ino };
}
function fileStat(stat) {
  need(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n &&
    stat.uid === BigInt(process.getuid()) && (stat.mode & 0o7777n) === 0o600n, 'unsafe-cache-file');
}
function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs &&
    a.mode === b.mode && a.nlink === b.nlink && a.uid === b.uid;
}
function boundedRead(file, cap) {
  const before = fs.lstatSync(file, { bigint: true }); fileStat(before);
  need(before.size > 0n && before.size <= BigInt(cap), 'cache-file-cap');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd, { bigint: true }); fileStat(opened);
    need(sameFile(before, opened), 'cache-file-changed');
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      need(read > 0, 'cache-file-truncated'); offset += read;
    }
    const extra = Buffer.alloc(1);
    need(fs.readSync(fd, extra, 0, 1, bytes.length) === 0, 'cache-file-growth');
    const after = fs.fstatSync(fd, { bigint: true }), pathAfter = fs.lstatSync(file, { bigint: true });
    fileStat(after); fileStat(pathAfter);
    need(sameFile(opened, after) && sameFile(after, pathAfter), 'cache-file-changed');
    return bytes;
  } finally { fs.closeSync(fd); }
}
function parsed(bytes) {
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new CacheFault('invalid-cache-json'); }
  need(Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes), 'invalid-cache-utf8');
  return value;
}
function keyFor(token, salt, context, directory) {
  need(typeof token === 'string' && token.length > 0 && token.length <= 8192 && !/[\s\u0000]/.test(token), 'missing-private-token');
  need(/^[a-f0-9]{64}$/.test(salt), 'invalid-cache-salt');
  const input = Buffer.from(token, 'utf8'), saltBytes = Buffer.from(salt, 'hex');
  const binding = Buffer.from(DOMAIN + '/public-binding/v2\n' + canonical({ context, directory }), 'utf8');
  let digest, info;
  try {
    // Node limits HKDF info to 1024 bytes. Hash the entire public binding under
    // its own domain; no context/path fields are omitted or truncated.
    digest = createHash('sha256').update(binding).digest();
    info = Buffer.concat([Buffer.from(DOMAIN + '/hkdf-info/v2\0'), digest]);
    return Buffer.from(hkdfSync('sha256', input, saltBytes, info, 32));
  } finally {
    input.fill(0); saltBytes.fill(0); binding.fill(0);
    if (digest) digest.fill(0); if (info) info.fill(0);
  }
}
function signed(value, key, kind) {
  return { ...value, mac: createHmac('sha256', key).update(DOMAIN + '/' + kind + '\n').update(canonical(value)).digest('hex') };
}
function authenticated(value, key, kind) {
  need(object(value) && /^[a-f0-9]{64}$/.test(value.mac ?? ''), 'invalid-cache-mac');
  const { mac, ...body } = value, expected = signed(body, key, kind).mac;
  need(timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex')), 'cache-authentication-failed');
  return body;
}
function binding(value, state) {
  need(canonical(value.context) === canonical(state.context) && value.salt === state.salt &&
    value.directory_name === state.identity.name, 'cache-context-mismatch');
}
function base(state, format, generation) {
  return { format, context: state.context, salt: state.salt, directory_name: state.identity.name, generation };
}
function leaseBody(state, status = 'pending') {
  return { ...base(state, 'conditional-jobs-lease-v1', state.generation), pid: process.pid,
    nonce: state.nonce, status };
}
function writeExclusive(file, bytes) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) { const n = fs.writeSync(fd, bytes, offset, bytes.length - offset); need(n > 0, 'cache-write-incomplete'); offset += n; }
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}
function syncDirectory(state) {
  checkedDirectory(state.context, state.directory, state.identity);
  const fd = fs.openSync(state.directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeAtomic(state, target, bytes) {
  const temporary = join(state.directory, target.replace('.json', '') + '.' + randomBytes(16).toString('hex') + '.tmp');
  writeExclusive(temporary, bytes);
  checkedDirectory(state.context, state.directory, state.identity);
  fs.renameSync(temporary, join(state.directory, target));
  syncDirectory(state);
}
function leaseValue(state) {
  const value = parsed(boundedRead(join(state.directory, 'lease.json'), JOB_CACHE_LIMITS.metadataBytes));
  need(exactKeys(value, 'format,context,salt,directory_name,generation,pid,nonce,status,mac'), 'invalid-cache-lease');
  const body = authenticated(value, state.key, 'lease'); binding(body, state);
  need(body.format === 'conditional-jobs-lease-v1' && Number.isSafeInteger(body.generation) && body.generation >= 0 &&
    positive(body.pid) && /^[a-f0-9]{32}$/.test(body.nonce) && ['pending', 'failed'].includes(body.status), 'invalid-cache-lease');
  return body;
}
function listing(state, ownLease = false) {
  checkedDirectory(state.context, state.directory, state.identity);
  const files = fs.readdirSync(state.directory).sort();
  need(canonical(files) === canonical(ownLease ? ['cache.json', 'lease.json', 'manifest.json'] :
    ['cache.json', 'manifest.json']), 'incomplete-or-locked-cache');
  if (ownLease) {
    const lease = leaseValue(state);
    need(lease.pid === process.pid && lease.nonce === state.nonce && lease.status === 'pending', 'cache-lease-not-owned');
  }
}
function retainedPayload(value, scope) {
  need(exactKeys(value, 'runs,pages,excludedIds') && Array.isArray(value.runs) && Array.isArray(value.pages) &&
    Array.isArray(value.excludedIds) && value.runs.length <= CONDITIONAL_DEPLOYMENT_JOB_LIMITS.runs &&
    value.pages.length <= CONDITIONAL_DEPLOYMENT_JOB_LIMITS.runs * CONDITIONAL_DEPLOYMENT_JOB_LIMITS.pagesPerRun &&
    value.excludedIds.every(positive) && new Set(value.excludedIds).size === value.excludedIds.length, 'invalid-cache-payload');
  const runs = new Map(), excluded = new Set([scope.run_id, ...value.excludedIds]);
  for (const run of value.runs) { runKey(run); need(!runs.has(run.id) && run.status === 'completed' && !excluded.has(run.id), 'uncacheable-stored-run'); runs.set(run.id, run); }
  const seen = new Set(), used = new Set();
  let totalBytes = 0;
  for (const page of value.pages) {
    const id = Number(/^https:\/\/api\.github\.com\/repos\/kusennjp1-ai\/screener\/actions\/runs\/([1-9]\d*)\/jobs\?/.exec(page?.url ?? '')?.[1]);
    const run = runs.get(id); need(run && page.etag !== null && !seen.has(page.url), 'uncacheable-stored-page');
    const decoded = decodePageRecord(run, page, scope);
    need(decoded.value.jobs.every(job => job.status === 'completed' &&
      (job.steps === null || job.steps.every(step => step.status === 'completed'))), 'active-stored-job');
    totalBytes += page.body_bytes; need(totalBytes <= CONDITIONAL_DEPLOYMENT_JOB_LIMITS.aggregateBytes, 'cache-body-cap');
    seen.add(page.url); used.add(id);
  }
  need(used.size === runs.size, 'unused-stored-run');
  return clone(value);
}
function readPair(state, ownLease = false) {
  checkedClock(state.context, state.now);
  listing(state, ownLease);
  const manifest = parsed(boundedRead(join(state.directory, 'manifest.json'), JOB_CACHE_LIMITS.metadataBytes));
  need(exactKeys(manifest, 'format,context,salt,directory_name,generation,cache_sha256,mac'), 'invalid-cache-manifest');
  const m = authenticated(manifest, state.key, 'manifest'); binding(m, state);
  need(m.format === 'conditional-jobs-manifest-v1' && Number.isSafeInteger(m.generation) && m.generation >= 0 &&
    /^[a-f0-9]{64}$/.test(m.cache_sha256), 'invalid-cache-manifest');
  const bytes = boundedRead(join(state.directory, 'cache.json'), JOB_CACHE_LIMITS.fileBytes);
  need(hash(bytes) === m.cache_sha256, 'cache-manifest-mismatch');
  const envelope = parsed(bytes);
  need(exactKeys(envelope, 'format,context,salt,directory_name,generation,payload,mac'), 'invalid-cache-envelope');
  const e = authenticated(envelope, state.key, 'cache'); binding(e, state);
  need(e.format === 'conditional-jobs-cache-v1' && e.generation === m.generation &&
    e.generation >= state.generation, 'stale-cache-generation');
  const payload = retainedPayload(e.payload, scopeOf(state.context));
  listing(state, ownLease);
  state.generation = e.generation;
  return { ...payload, generation: e.generation };
}
function serializePair(state, payload, generation) {
  const bytes = Buffer.from(canonical(signed({ ...base(state, 'conditional-jobs-cache-v1', generation), payload }, state.key, 'cache')));
  const manifest = Buffer.from(canonical(signed({ ...base(state, 'conditional-jobs-manifest-v1', generation),
    cache_sha256: hash(bytes) }, state.key, 'manifest')));
  need(bytes.length <= JOB_CACHE_LIMITS.fileBytes && manifest.length <= JOB_CACHE_LIMITS.metadataBytes, 'cache-storage-cap');
  return { bytes, manifest };
}
function acquire(state) {
  writeExclusive(join(state.directory, 'lease.json'), Buffer.from(canonical(signed(leaseBody(state), state.key, 'lease'))));
  syncDirectory(state);
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
function checkedBatch(state, input) {
  need(exactKeys(input, 'runs,pages,excludedIds') && Array.isArray(input.runs) && Array.isArray(input.pages) &&
    Array.isArray(input.excludedIds) && input.runs.length <= CONDITIONAL_DEPLOYMENT_JOB_LIMITS.runs &&
    input.pages.length <= CONDITIONAL_DEPLOYMENT_JOB_LIMITS.runs * CONDITIONAL_DEPLOYMENT_JOB_LIMITS.pagesPerRun &&
    input.excludedIds.every(positive) && new Set(input.excludedIds).size === input.excludedIds.length, 'invalid-complete-batch');
  need(Buffer.byteLength(canonical(input)) <= CONDITIONAL_DEPLOYMENT_JOB_LIMITS.stdioBytes, 'batch-input-cap');
  const runs = new Map(), byRun = new Map(), seen = new Set(), scope = scopeOf(state.context);
  for (const run of input.runs) { runKey(run); need(!runs.has(run.id), 'duplicate-batch-run'); runs.set(run.id, run); byRun.set(run.id, []); }
  let bodyBytes = 0;
  for (const page of input.pages) {
    const id = Number(/^https:\/\/api\.github\.com\/repos\/kusennjp1-ai\/screener\/actions\/runs\/([1-9]\d*)\/jobs\?/.exec(page?.url ?? '')?.[1]);
    need(runs.has(id) && !seen.has(page.url), 'foreign-or-duplicate-batch-page');
    byRun.get(id).push(page); seen.add(page.url); bodyBytes += page.body_bytes;
    need(Number.isSafeInteger(bodyBytes) && bodyBytes <= CONDITIONAL_DEPLOYMENT_JOB_LIMITS.aggregateBytes, 'batch-body-cap');
  }
  const excluded = new Set([scope.run_id, ...input.excludedIds]), retained = [];
  for (const run of input.runs) {
    const pages = byRun.get(run.id), inventory = validateJobsPages(run, pages, scope);
    if (run.status === 'completed' && !excluded.has(run.id) &&
      inventory.jobs.every(job => job.status === 'completed' && (job.steps === null || job.steps.every(step => step.status === 'completed')))) {
      for (const page of pages) if (page.etag !== null) retained.push(clone(page));
    }
  }
  need(state.generation < Number.MAX_SAFE_INTEGER, 'cache-generation-cap');
  const counts = new Map(), pageSizes = [], runSizes = new Map();
  for (const page of retained) {
    const id = Number(/\/runs\/([1-9]\d*)\/jobs\?/.exec(page.url)[1]);
    counts.set(id, (counts.get(id) ?? 0) + 1); pageSizes.push(Buffer.byteLength(canonical(page)));
  }
  for (const run of input.runs) if (counts.has(run.id)) runSizes.set(run.id, Buffer.byteLength(canonical(run)));
  const blank = { runs: [], pages: [], excludedIds: [...input.excludedIds] };
  let remainingRuns = counts.size, remainingPages = retained.length;
  let size = Buffer.byteLength(canonical({ ...base(state, 'conditional-jobs-cache-v1', state.generation + 1),
    payload: blank, mac: '0'.repeat(64) })) + pageSizes.reduce((a, b) => a + b, 0) +
    [...runSizes.values()].reduce((a, b) => a + b, 0) + Math.max(0, remainingPages - 1) + Math.max(0, remainingRuns - 1);
  let eviction_count = 0;
  while (size > JOB_CACHE_LIMITS.fileBytes && eviction_count < retained.length) {
    const page = retained[eviction_count], id = Number(/\/runs\/([1-9]\d*)\/jobs\?/.exec(page.url)[1]);
    size -= pageSizes[eviction_count] + (remainingPages > 1 ? 1 : 0); remainingPages--;
    counts.set(id, counts.get(id) - 1);
    if (counts.get(id) === 0) { size -= runSizes.get(id) + (remainingRuns > 1 ? 1 : 0); remainingRuns--; }
    eviction_count++;
  }
  need(size <= JOB_CACHE_LIMITS.fileBytes, 'cache-metadata-cap');
  const payload = { runs: input.runs.filter(run => (counts.get(run.id) ?? 0) > 0).map(clone),
    pages: retained.slice(eviction_count), excludedIds: [...input.excludedIds] };
  const pair = serializePair(state, payload, state.generation + 1);
  need(pair.bytes.length === size, 'cache-byte-accounting-mismatch');
  retainedPayload(payload, scope);
  return { payload, pair, eviction_count };
}
function activeState(handle) {
  const state = OWNED.get(handle); need(state && state.key && !state.disposed, 'disposed-or-unowned-cache-handle'); return state;
}
function makeHandle(state) {
  const handle = Object.freeze({
    directory: state.directory, context: state.context,
    assertPrivateToken(token) {
      const s = activeState(handle); need(!s.failed, 'failed-cache-handle');
      checkedClock(s.context, s.now);
      const derived = keyFor(token, s.salt, s.context, s.directory);
      try { need(timingSafeEqual(derived, s.key), 'private-cache-token-mismatch'); return true; }
      finally { derived.fill(0); }
    },
    loadVerified() {
      const s = activeState(handle);
      try { need(!s.failed, 'failed-cache-handle'); return readPair(s, true); } catch (error) { s.failed = true; throw error; }
    },
    commitComplete(input) {
      const s = activeState(handle);
      try {
        need(!s.failed, 'failed-cache-handle'); readPair(s, true);
        const { payload, pair, eviction_count } = checkedBatch(s, input);
        writeAtomic(s, 'cache.json', pair.bytes); writeAtomic(s, 'manifest.json', pair.manifest);
        s.generation++;
        readPair(s, true);
        return { generation: s.generation, page_count: payload.pages.length, cache_bytes: pair.bytes.length, eviction_count };
      } catch (error) { s.failed = true; throw error; }
    },
    dispose(status = 'complete') {
      const s = activeState(handle);
      need(status === 'complete' || status === 'failed', 'invalid-disposal-status');
      try {
        checkedDirectory(s.context, s.directory, s.identity);
        if (status === 'failed' || s.failed) {
          const lease = leaseValue(s);
          need(lease.pid === process.pid && lease.nonce === s.nonce, 'cache-lease-not-owned');
          writeAtomic(s, 'lease.json', Buffer.from(canonical(signed(leaseBody(s, 'failed'), s.key, 'lease'))));
          if (status === 'complete') throw new CacheFault('failed-cache-handle');
        } else {
          readPair(s, true);
          s.releasing = true;
          fs.unlinkSync(join(s.directory, 'lease.json')); syncDirectory(s);
        }
      } catch (error) { s.failed = true; poisonOwnLease(s); throw error; }
      finally { s.key.fill(0); s.key = null; s.disposed = true; }
    },
  });
  OWNED.set(handle, state); return handle;
}
export function isOwnedJobCacheHandle(handle) { const state = OWNED.get(handle); return Boolean(state && state.key && !state.disposed && !state.failed); }
export function initializeJobCache({ context, root, token = process.env.GH_TOKEN, now = Date.now }) {
  const bound = checkedContext(context); checkedClock(bound, now);
  const parent = checkedRoot(root), name =
    'conditional-jobs-' + bound.job_id + '-' + bound.role + '-' + randomBytes(16).toString('hex');
  const directory = join(parent, name), salt = randomBytes(32).toString('hex');
  const key = keyFor(token, salt, bound, directory);
  let state;
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
    state = { context: bound, directory, salt, key, identity: checkedDirectory(bound, directory),
      generation: 0, nonce: randomBytes(16).toString('hex'), disposed: false, failed: false, now };
    acquire(state);
    const pair = serializePair(state, { runs: [], pages: [], excludedIds: [] }, 0);
    writeAtomic(state, 'cache.json', pair.bytes); writeAtomic(state, 'manifest.json', pair.manifest);
    readPair(state, true);
    return makeHandle(state);
  } catch (error) { poisonOwnLease(state); key.fill(0); throw error; }
}
export function openJobCache({ context, directory, token = process.env.GH_TOKEN, now = Date.now }) {
  const bound = checkedContext(context); checkedClock(bound, now);
  const identity = checkedDirectory(bound, directory);
  const manifest = parsed(boundedRead(join(directory, 'manifest.json'), JOB_CACHE_LIMITS.metadataBytes));
  need(exactKeys(manifest, 'format,context,salt,directory_name,generation,cache_sha256,mac'), 'invalid-cache-manifest');
  const key = keyFor(token, manifest.salt, bound, directory);
  const state = { context: bound, directory, salt: manifest.salt, key, identity,
    generation: 0, nonce: randomBytes(16).toString('hex'), disposed: false, failed: false, now };
  try { readPair(state); acquire(state); readPair(state, true); return makeHandle(state); }
  catch (error) { poisonOwnLease(state); key.fill(0); throw error; }
}
export function cleanupJobCache({ context, directory, token = process.env.GH_TOKEN }) {
  const bound = checkedContext(context), identity = checkedDirectory(bound, directory);
  const initialFiles = fs.readdirSync(directory);
  const anchor = initialFiles.includes('manifest.json') ? 'manifest.json' : 'lease.json';
  const anchorBytes = boundedRead(join(directory, anchor), JOB_CACHE_LIMITS.metadataBytes);
  const record = parsed(anchorBytes);
  const key = keyFor(token, record.salt, bound, directory);
  const state = { context: bound, directory, salt: record.salt, key, identity, generation: 0 };
  try {
    if (anchor === 'manifest.json') {
      need(exactKeys(record, 'format,context,salt,directory_name,generation,cache_sha256,mac'), 'invalid-cache-manifest');
      const body = authenticated(record, key, 'manifest'); binding(body, state);
      need(body.format === 'conditional-jobs-manifest-v1' && Number.isSafeInteger(body.generation) && body.generation >= 0 &&
        /^[a-f0-9]{64}$/.test(body.cache_sha256), 'invalid-cache-manifest');
    } else { leaseValue(state); }
    const files = fs.readdirSync(directory).sort();
    need(files.includes(anchor) && files.every(file => ['manifest.json', 'cache.json', 'lease.json'].includes(file) ||
      /^(?:cache|manifest|lease)\.[a-f0-9]{32}\.tmp$/.test(file)), 'unexpected-cache-cleanup-file');
    if (files.includes('lease.json')) {
      const lease = leaseValue(state);
      need(lease.status === 'failed' || !alive(lease.pid), 'live-cache-holder');
    }
    for (const file of files) {
      const stat = fs.lstatSync(join(directory, file), { bigint: true }); fileStat(stat);
      need(stat.size <= BigInt(file === 'cache.json' || file.startsWith('cache.') ? JOB_CACHE_LIMITS.fileBytes : JOB_CACHE_LIMITS.metadataBytes), 'cache-cleanup-cap');
    }
    need(canonical(fs.readdirSync(directory).sort()) === canonical(files), 'cache-cleanup-changed');
    const order = files.filter(file => file !== anchor).concat(anchor);
    for (const file of order) { checkedDirectory(bound, directory, identity); fs.unlinkSync(join(directory, file)); }
    checkedDirectory(bound, directory, identity);
    try { fs.rmdirSync(directory); }
    catch (error) {
      // A failed final removal retains a verified recovery anchor when the same directory survives.
      try { checkedDirectory(bound, directory, identity); writeExclusive(join(directory, anchor), anchorBytes); syncDirectory(state); }
      catch { /* Preserve the original cleanup error; never delete an unrelated replacement. */ }
      throw error;
    }
    return { removed: true };
  } finally { key.fill(0); }
}
