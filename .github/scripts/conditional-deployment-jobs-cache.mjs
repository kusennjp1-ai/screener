import fs from 'node:fs';
import { resolve, join, dirname, basename, isAbsolute } from 'node:path';
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { REQUEST_REPRESENTATION, CONDITIONAL_DEPLOYMENT_JOB_LIMITS, validateScope, runKey, decodePageRecord, validateJobsPages } from './conditional-deployment-jobs-worker.mjs';

// Storage authentication only. Loaded rows/critical IDs are stale transport metadata.
// Every retained page still needs an authenticated server 200/304 revalidation.
// HMAC cannot prevent same-user replay of an entire previously valid state pair.
export const JOB_CACHE_LIMITS = Object.freeze({ fileBytes: 32 * 1024 * 1024, metadataBytes: 16384, jobLifetimeMs: 110 * 60 * 1000 });
const READER = '265ede759b1714c882015c696c6fac66975ae03a';
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
function retainedPayload(value, scope, context) {
  need(exactKeys(value, 'runs,pages,excludedIds,transport_budget') && Array.isArray(value.runs) && Array.isArray(value.pages) &&
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
  need(value.transport_budget === null || context, 'unbound-transport-budget');
  if (value.transport_budget !== null) checkedTransportBudget(value.transport_budget, context);
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
  need(e.format === 'conditional-jobs-cache-v2' && e.generation === m.generation &&
    e.generation >= state.generation, 'stale-cache-generation');
  const payload = retainedPayload(e.payload, scopeOf(state.context), state.context);
  listing(state, ownLease);
  state.generation = e.generation;
  return { ...payload, generation: e.generation };
}
function serializePair(state, payload, generation) {
  const bytes = Buffer.from(canonical(signed({ ...base(state, 'conditional-jobs-cache-v2', generation), payload }, state.key, 'cache')));
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
function checkedBatch(state, input, transportBudget) {
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
  const blank = { runs: [], pages: [], excludedIds: [...input.excludedIds], transport_budget: transportBudget };
  let remainingRuns = counts.size, remainingPages = retained.length;
  let size = Buffer.byteLength(canonical({ ...base(state, 'conditional-jobs-cache-v2', state.generation + 1),
    payload: blank, mac: '0'.repeat(64) })) + pageSizes.reduce((a, b) => a + b, 0) +
    [...runSizes.values()].reduce((a, b) => a + b, 0) + Math.max(0, remainingPages - 1) + Math.max(0, remainingRuns - 1);
  let eviction_count = 0;
  // Retain one fixed metadata allowance so later budget/phase transitions cannot
  // overflow an otherwise full jobs cache. The file ceiling itself is unchanged.
  while (size > JOB_CACHE_LIMITS.fileBytes - JOB_CACHE_LIMITS.metadataBytes && eviction_count < retained.length) {
    const page = retained[eviction_count], id = Number(/\/runs\/([1-9]\d*)\/jobs\?/.exec(page.url)[1]);
    size -= pageSizes[eviction_count] + (remainingPages > 1 ? 1 : 0); remainingPages--;
    counts.set(id, counts.get(id) - 1);
    if (counts.get(id) === 0) { size -= runSizes.get(id) + (remainingRuns > 1 ? 1 : 0); remainingRuns--; }
    eviction_count++;
  }
  need(size <= JOB_CACHE_LIMITS.fileBytes - JOB_CACHE_LIMITS.metadataBytes, 'cache-metadata-cap');
  const payload = { runs: input.runs.filter(run => (counts.get(run.id) ?? 0) > 0).map(clone),
    pages: retained.slice(eviction_count), excludedIds: [...input.excludedIds], transport_budget: transportBudget };
  const pair = serializePair(state, payload, state.generation + 1);
  need(pair.bytes.length === size, 'cache-byte-accounting-mismatch');
  retainedPayload(payload, scope, state.context);
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
      try {
        need(!s.failed, 'failed-cache-handle');
        const { transport_budget, ...rows } = readPair(s, true);
        return rows;
      } catch (error) { s.failed = true; throw error; }
    },
    commitComplete(input) {
      const s = activeState(handle);
      try {
        need(!s.failed, 'failed-cache-handle');
        const current = readPair(s, true);
        const { payload, pair, eviction_count } = checkedBatch(s, input, current.transport_budget);
        writeAtomic(s, 'cache.json', pair.bytes); writeAtomic(s, 'manifest.json', pair.manifest);
        s.generation++;
        readPair(s, true);
        return { generation: s.generation, page_count: payload.pages.length, cache_bytes: pair.bytes.length, eviction_count };
      } catch (error) { s.failed = true; throw error; }
    },
    loadTransportBudget({ allowUninitialized = false } = {}) {
      const s = activeState(handle);
      try {
        need(!s.failed, 'failed-cache-handle');
        need(typeof allowUninitialized === 'boolean', 'invalid-budget-initializer-mode');
        const current = readPair(s, true), value = current.transport_budget;
        need(value !== null || (allowUninitialized && current.generation === 0),
          'missing-initialized-transport-budget');
        return value === null ? null : deepFreeze(checkedTransportBudget(value, s.context));
      } catch (error) { s.failed = true; throw error; }
    },
    commitTransportBudget(value) {
      const s = activeState(handle);
      try {
        need(!s.failed, 'failed-cache-handle');
        const current = readPair(s, true), next = checkedTransportBudget(value, s.context),
          previous = current.transport_budget;
        if (previous === null) {
          need(current.generation === 0 && next.last_completed_phase === -1 && next.pending_phase?.index === 0,
            'transport-budget-initial-phase-required');
        } else {
          need(previous.policy_sha256 === next.policy_sha256 &&
            previous.original_primary_limit === next.original_primary_limit &&
            next.spent_primary >= previous.spent_primary && next.logical_issued >= previous.logical_issued &&
            next.schema_version===previous.schema_version &&
            (previous.schema_version!==BUDGET_SCHEMA_V3 ||
              canonical(next.extra_primary_limits)===canonical(previous.extra_primary_limits) &&
              EXTRA_KEYS.every(key=>next.extra_primary_used[key]>=previous.extra_primary_used[key]) &&
              next.completed_step_model_primary>=previous.completed_step_model_primary &&
              (previous.history_initial_weight===null || next.history_initial_weight===previous.history_initial_weight) &&
              next.history_max_weight>=previous.history_max_weight),
            'transport-budget-binding-or-consumption-rollback');
          if (previous.pending_phase === null) {
            need(next.last_completed_phase === previous.last_completed_phase &&
              next.pending_phase?.index === previous.last_completed_phase + 1,
              'transport-budget-successor-required');
          } else {
            need(next.pending_phase === null && next.last_completed_phase === previous.pending_phase.index,
              'transport-budget-completed-owned-phase-required');
          }
        }
        const { generation, ...payload } = current;
        payload.transport_budget = next;
        const pair = serializePair(s, payload, s.generation + 1);
        writeAtomic(s, 'cache.json', pair.bytes); writeAtomic(s, 'manifest.json', pair.manifest);
        s.generation++; readPair(s, true);
        return { generation: s.generation, budget_bytes: Buffer.byteLength(canonical(next)) };
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
export function initializeJobCache({ context, root, directory: intendedDirectory, token = process.env.GH_TOKEN, now = Date.now }) {
  const bound = checkedContext(context); checkedClock(bound, now);
  const parent = checkedRoot(root), prefix = 'conditional-jobs-' + bound.job_id + '-' + bound.role + '-';
  const directory = intendedDirectory === undefined ? join(parent, prefix + randomBytes(16).toString('hex')) : intendedDirectory;
  need(typeof directory === 'string' && directory === resolve(directory) && dirname(directory) === parent &&
    basename(directory).startsWith(prefix) && /^[a-f0-9]{32}$/.test(basename(directory).slice(prefix.length)), 'unsafe-intended-cache-directory');
  // Exclusive mkdir below never adopts an existing directory or follows a link.
  const salt = randomBytes(32).toString('hex'), name = basename(directory);
  const key = keyFor(token, salt, bound, directory);
  let state;
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
    state = { context: bound, directory, salt, key, identity: checkedDirectory(bound, directory),
      generation: 0, nonce: randomBytes(16).toString('hex'), disposed: false, failed: false, now };
    acquire(state);
    const pair = serializePair(state, { runs: [], pages: [], excludedIds: [], transport_budget: null }, 0);
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

// Pure transport accounting. The caller must supply an authenticated stored
// value and a controller-owned policy; neither is publication authority.
const BUDGET_SCHEMA = 'conditional-job-transport-budget-v2';
const BUDGET_SCHEMA_V3 = 'conditional-job-transport-budget-v3';
const EXTRA_KEYS = ['native_extra','ordinary_extra','terminal_miss'];
const emptyExtras = () => ({native_extra:0,ordinary_extra:0,terminal_miss:0});
const sumExtras = value => EXTRA_KEYS.reduce((sum,key)=>sum+value[key],0);
function checkedExtras(value, code) {
  budgetCheck(exactKeys(value,EXTRA_KEYS.join(',')) && EXTRA_KEYS.every(key=>nonnegative(value[key])) &&
    sumExtras(value)<=128,code); return clone(value);
}
const BUDGET_MAX_WINDOWS = 4;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const budgetCheck = (condition, code) => need(condition, 'transport-budget-' + code);
function checkedBudgetQuota(value) {
  budgetCheck(exactKeys(value, 'limit,used,remaining,reset_epoch,resource') &&
    positive(value.limit) && nonnegative(value.used) && nonnegative(value.remaining) &&
    value.used + value.remaining === value.limit && positive(value.reset_epoch) &&
    value.resource === 'core', 'invalid-route-quota');
  return clone(value);
}
function checkedBudgetPolicy(value, context) {
  const v3=value?.schema_version==='conditional-job-budget-policy-v3';
  budgetCheck(exactKeys(value, 'schema_version,controller_sha,controller_tree,role,original_primary_limit,retained_reserve,phases'+(v3?',extra_primary':'')) &&
    (v3 || value.schema_version === 'conditional-job-budget-policy-v2') &&
    value.controller_sha === context.controller_sha && value.controller_tree === context.controller_tree &&
    value.role === context.role && positive(value.original_primary_limit) &&
    nonnegative(value.retained_reserve) && Array.isArray(value.phases) &&
    value.phases.length > 0 && value.phases.length <= 16, 'invalid-policy');
  if(v3)checkedExtras(value.extra_primary,'invalid-extra-policy');
  const ids = new Set();
  for (const phase of value.phases) {
    budgetCheck(exactKeys(phase, 'id,command,job_step,ordinal,maximum_primary,maximum_starts,future_primary,future_transient_primary,planned_primary,external_future_primary,bootstrap_maximum_primary,bootstrap_maximum_starts'+(v3?',predecessor_model_primary,predecessor_model_step':'')) &&
      typeof phase.id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(phase.id) && !ids.has(phase.id) &&
      typeof phase.command === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(phase.command) &&
      typeof phase.job_step === 'string' && phase.job_step.length > 0 &&
      Buffer.byteLength(phase.job_step) <= 1024 && !/[\u0000-\u001f\u007f]/.test(phase.job_step) &&
      positive(phase.ordinal) && nonnegative(phase.maximum_primary) && positive(phase.maximum_starts) &&
      nonnegative(phase.future_primary) && nonnegative(phase.future_transient_primary) && nonnegative(phase.planned_primary) && nonnegative(phase.external_future_primary) &&
      phase.maximum_primary>=phase.planned_primary && phase.maximum_primary>=phase.bootstrap_maximum_primary &&
      nonnegative(phase.bootstrap_maximum_primary) &&
      nonnegative(phase.bootstrap_maximum_starts) && phase.bootstrap_maximum_primary>=phase.bootstrap_maximum_starts,
      'invalid-policy-phase');
    if(v3)budgetCheck(nonnegative(phase.predecessor_model_primary) && phase.predecessor_model_primary<=16 &&
      (phase.predecessor_model_primary===0 ? phase.predecessor_model_step===null :
        typeof phase.predecessor_model_step==='string' && phase.predecessor_model_step.length>0 &&
        Buffer.byteLength(phase.predecessor_model_step)<=1024 && !/[\u0000-\u001f\u007f]/.test(phase.predecessor_model_step)),
      'invalid-predecessor-model-policy');
    ids.add(phase.id);
  }
  budgetCheck(value.phases.every((p,i)=>p.future_primary>=p.external_future_primary+
    value.phases.slice(i+1).reduce((sum,later)=>sum+later.planned_primary+(v3?later.predecessor_model_primary:0),0)),
    'invalid-remaining-suffix-policy');
  budgetCheck(value.phases.every((p,i)=>p.future_transient_primary>=Math.max(0,
    ...value.phases.slice(i+1).map(later=>later.maximum_primary-later.planned_primary))),
    'invalid-remaining-transient-policy');
  budgetCheck(Buffer.byteLength(canonical(value)) <= 8192, 'policy-cap');
  return deepFreeze(clone(value));
}
function checkedQuotaBoundary(value,context,nowMs,afterMs=0) {
  const route='repos/'+context.repository+'/actions/runs/'+context.run_id;
  budgetCheck(exactKeys(value,'route,status,backoff,request_started_at_epoch_ms,response_received_at_epoch_ms,completed_at_epoch_ms') &&
    [route,route+'/attempts/'+context.run_attempt].includes(value.route) &&
    value.status===200 && value.backoff===false &&
    [value.request_started_at_epoch_ms,value.response_received_at_epoch_ms,value.completed_at_epoch_ms].every(positive) &&
    value.request_started_at_epoch_ms>=Date.parse(context.job_started_at) &&
    value.request_started_at_epoch_ms>=afterMs &&
    value.response_received_at_epoch_ms>=value.request_started_at_epoch_ms &&
    value.completed_at_epoch_ms>=value.response_received_at_epoch_ms &&
    value.completed_at_epoch_ms<=nowMs,'invalid-required-caller-boundary');
  return clone(value);
}
function checkedTransportBudget(value, context) {
  const v3=value?.schema_version===BUDGET_SCHEMA_V3;
  budgetCheck(exactKeys(value, 'schema_version,context_sha256,policy_sha256,original_primary_limit,spent_primary,logical_issued,bootstrap_starts,bootstrap_primary_debit,known_200,completed_gh_json,validated_304,unknown_issued,opaque_primary_debit,unreconciled_opaque_primary,last_completed_phase,last_completed_at_epoch_ms,last_quota_boundary,next_bootstrap,pending_phase,current_window,prior_windows'+(v3?',extra_primary_limits,extra_primary_used,completed_step_model_primary,history_initial_weight,history_max_weight':'')) &&
    (v3 || value.schema_version === BUDGET_SCHEMA) && value.context_sha256 === hash(Buffer.from(canonical(context))) &&
    typeof value.policy_sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.policy_sha256) && positive(value.original_primary_limit) &&
    ['spent_primary','logical_issued','bootstrap_starts','bootstrap_primary_debit','known_200','completed_gh_json','validated_304','unknown_issued','opaque_primary_debit','unreconciled_opaque_primary'].every(k => nonnegative(value[k])) &&
    value.spent_primary <= value.original_primary_limit &&
    value.spent_primary >= value.known_200 + value.completed_gh_json + value.bootstrap_primary_debit + value.unknown_issued + value.opaque_primary_debit + (v3?value.completed_step_model_primary:0) &&
    value.unreconciled_opaque_primary <= value.opaque_primary_debit &&
    value.known_200 + value.completed_gh_json + value.validated_304 + value.unknown_issued + value.bootstrap_starts === value.logical_issued &&
    Number.isSafeInteger(value.last_completed_phase) && value.last_completed_phase >= -1 &&
    (value.last_completed_phase===-1 ? value.last_completed_at_epoch_ms===null : positive(value.last_completed_at_epoch_ms)) &&
    Array.isArray(value.prior_windows) && value.prior_windows.length < BUDGET_MAX_WINDOWS,
    'invalid-state');
  if(v3) {
    const limits=checkedExtras(value.extra_primary_limits,'invalid-extra-limits'), used=checkedExtras(value.extra_primary_used,'invalid-extra-used');
    budgetCheck(nonnegative(value.completed_step_model_primary) &&
      EXTRA_KEYS.every(key=>used[key]<=limits[key]) && sumExtras(used)<=value.spent_primary,'invalid-extra-consumption');
    budgetCheck((value.history_initial_weight===null ? value.history_max_weight===0 :
      nonnegative(value.history_initial_weight) && value.history_initial_weight<=192 &&
      nonnegative(value.history_max_weight) && value.history_max_weight>=value.history_initial_weight && value.history_max_weight<=200),
      'invalid-history-weight');
  }
  const checkWindow = window => budgetCheck(exactKeys(window, 'resource,limit,reset_epoch,minimum_remaining_header,credit') &&
    window.resource === 'core' && positive(window.limit) && positive(window.reset_epoch) &&
    nonnegative(window.minimum_remaining_header) && window.minimum_remaining_header <= window.limit &&
    nonnegative(window.credit) && window.credit <= window.minimum_remaining_header, 'invalid-window');
  checkWindow(value.current_window);
  for (const window of value.prior_windows) checkWindow(window);
  checkedQuotaBoundary(value.last_quota_boundary,context,Date.parse(context.job_started_at)+JOB_CACHE_LIMITS.jobLifetimeMs-1);
  budgetCheck(value.last_completed_at_epoch_ms===null ||
    (value.last_completed_at_epoch_ms>=Date.parse(context.job_started_at) &&
      value.last_completed_at_epoch_ms<Date.parse(context.job_started_at)+JOB_CACHE_LIMITS.jobLifetimeMs &&
      (value.pending_phase!==null || value.last_completed_at_epoch_ms>=value.last_quota_boundary.completed_at_epoch_ms)),
    'invalid-completed-phase-clock');
  const epochs = [...value.prior_windows, value.current_window].map(w => w.reset_epoch);
  budgetCheck(epochs.every((epoch, index) => !index || epoch > epochs[index - 1]), 'invalid-window-order');
  if(value.next_bootstrap!==null) {
    const b=value.next_bootstrap;
    budgetCheck(exactKeys(b,'phase_index,phase_id,command,job_step,ordinal,maximum_primary,maximum_starts'+(v3?',maximum_step_model_primary':'')) &&
      value.pending_phase===null && value.last_completed_phase>=0 && b.phase_index===value.last_completed_phase+1 &&
      typeof b.phase_id==='string' && typeof b.command==='string' && typeof b.job_step==='string' &&
      positive(b.ordinal) && nonnegative(b.maximum_primary) && nonnegative(b.maximum_starts) &&
      b.maximum_primary>=b.maximum_starts &&
      (!v3 || nonnegative(b.maximum_step_model_primary) && b.maximum_step_model_primary<=16) &&
      value.spent_primary+b.maximum_primary+(v3?b.maximum_step_model_primary:0)<=value.original_primary_limit,'invalid-next-bootstrap');
  }
  if (value.pending_phase !== null) {
    budgetCheck(exactKeys(value.pending_phase, 'id,index,command,job_step,ordinal,maximum_primary,maximum_starts,future_primary,future_transient_primary,planned_primary,external_future_primary,bootstrap_maximum_primary,bootstrap_maximum_starts,retained_reserve,started_at_epoch_ms'+(v3?',predecessor_model_primary,predecessor_model_step':'')) &&
      typeof value.pending_phase.id === 'string' && Number.isSafeInteger(value.pending_phase.index) &&
      value.pending_phase.index === value.last_completed_phase + 1 &&
      typeof value.pending_phase.command === 'string' && typeof value.pending_phase.job_step === 'string' &&
      positive(value.pending_phase.ordinal) && nonnegative(value.pending_phase.maximum_primary) &&
      positive(value.pending_phase.maximum_starts) && nonnegative(value.pending_phase.future_primary) &&
      nonnegative(value.pending_phase.future_transient_primary) &&
      nonnegative(value.pending_phase.planned_primary) && nonnegative(value.pending_phase.external_future_primary) &&
      value.pending_phase.maximum_primary>=value.pending_phase.planned_primary &&
      nonnegative(value.pending_phase.bootstrap_maximum_primary) && nonnegative(value.pending_phase.bootstrap_maximum_starts) &&
      value.pending_phase.bootstrap_maximum_primary>=value.pending_phase.bootstrap_maximum_starts &&
      nonnegative(value.pending_phase.retained_reserve) && positive(value.pending_phase.started_at_epoch_ms) &&
      value.pending_phase.started_at_epoch_ms>=Math.max(value.last_completed_at_epoch_ms??0,
        value.last_quota_boundary.completed_at_epoch_ms) &&
      value.pending_phase.started_at_epoch_ms<Date.parse(context.job_started_at)+JOB_CACHE_LIMITS.jobLifetimeMs,
      'invalid-pending-phase');
  }
  if(v3 && value.pending_phase!==null)budgetCheck(nonnegative(value.pending_phase.predecessor_model_primary) &&
    value.pending_phase.predecessor_model_primary<=16 &&
    (value.pending_phase.predecessor_model_primary===0 ? value.pending_phase.predecessor_model_step===null :
      typeof value.pending_phase.predecessor_model_step==='string' && value.pending_phase.predecessor_model_step.length>0),
    'invalid-pending-predecessor-model');
  budgetCheck(Buffer.byteLength(canonical(value)) <= 16384, 'state-cap');
  return clone(value);
}
export function createJobTransportBudget({context,policy,saved=null,initialQuota=null,quotaBoundary=null,verifiedBootstrapPhase=null,bootstrapPrimary=0,bootstrapStarts=0,bootstrapSinceSamplePrimary=bootstrapPrimary,bootstrapPlannedPrimary=bootstrapPrimary,bootstrapExtraPrimary=emptyExtras(),completedStepModelPrimary=0,verifiedPredecessorModel=null,bootstrapMinimumObservation=null,now=Date.now,persist}) {
  const bound = checkedContext(context), plan = checkedBudgetPolicy(policy, bound), digest = hash(Buffer.from(canonical(plan))),
    v3=plan.schema_version==='conditional-job-budget-policy-v3', bootstrapExtras=checkedExtras(bootstrapExtraPrimary,'invalid-bootstrap-extras');
  budgetCheck(nonnegative(completedStepModelPrimary) &&
    (v3 || completedStepModelPrimary===0 && verifiedPredecessorModel===null && sumExtras(bootstrapExtras)===0),
    'invalid-predecessor-model');
  budgetCheck(typeof now === 'function' && typeof persist === 'function' &&
    nonnegative(bootstrapPrimary) && nonnegative(bootstrapStarts) && bootstrapPrimary <= bootstrapStarts * 2 &&
    nonnegative(bootstrapSinceSamplePrimary) && bootstrapSinceSamplePrimary<=bootstrapPrimary &&
    nonnegative(bootstrapPlannedPrimary) &&
    (initialQuota!==null || bootstrapSinceSamplePrimary===bootstrapPrimary),
    'invalid-opener');
  budgetCheck(bootstrapMinimumObservation===null || exactKeys(bootstrapMinimumObservation,'raw_minimum_remaining,available_before_since_sample') &&
    initialQuota!==null && nonnegative(bootstrapMinimumObservation.raw_minimum_remaining) &&
    nonnegative(bootstrapMinimumObservation.available_before_since_sample) &&
    bootstrapMinimumObservation.available_before_since_sample<=bootstrapMinimumObservation.raw_minimum_remaining &&
    bootstrapMinimumObservation.raw_minimum_remaining<=initialQuota.remaining,'invalid-bootstrap-minimum');
  const observedBootstrapRemaining=q=>bootstrapMinimumObservation===null?q.remaining:bootstrapMinimumObservation.raw_minimum_remaining;
  const availableBootstrapRemaining=q=>bootstrapMinimumObservation===null?q.remaining:bootstrapMinimumObservation.available_before_since_sample;
  const clock = () => { const n = now(); budgetCheck(positive(n), 'invalid-clock'); checkedClock(bound, () => n); return n; };
  const expectedIndex=saved===null?0:saved.last_completed_phase+1, expectedPhase=plan.phases[expectedIndex];
  budgetCheck(expectedPhase && (!v3 || completedStepModelPrimary===expectedPhase.predecessor_model_primary),
    'unverified-predecessor-model');
  if(completedStepModelPrimary>0) {
    budgetCheck(saved!==null && initialQuota!==null && exactKeys(verifiedPredecessorModel,'step,status,conclusion,completed_at_epoch_ms') &&
      verifiedPredecessorModel.step===expectedPhase.predecessor_model_step && verifiedPredecessorModel.status==='completed' &&
      verifiedPredecessorModel.conclusion==='success' && positive(verifiedPredecessorModel.completed_at_epoch_ms) &&
      verifiedPredecessorModel.completed_at_epoch_ms>=saved.last_completed_at_epoch_ms &&
      verifiedPredecessorModel.completed_at_epoch_ms<=quotaBoundary?.request_started_at_epoch_ms,'unverified-predecessor-model');
  } else budgetCheck(verifiedPredecessorModel===null,'unexpected-predecessor-model');
  if(v3)budgetCheck(sumExtras(bootstrapExtras)<=bootstrapPrimary && bootstrapPrimary-sumExtras(bootstrapExtras)<=bootstrapPlannedPrimary,
    'unfunded-bootstrap-extra');
  let state;
  if (saved === null) {
    const q = checkedBudgetQuota(initialQuota), n = clock(), boundary=checkedQuotaBoundary(quotaBoundary,bound,n);
    budgetCheck(q.reset_epoch * 1000 > n && plan.original_primary_limit <= q.limit, 'invalid-initial-window');
    const first=plan.phases[0];
    budgetCheck(canonical(verifiedBootstrapPhase)===canonical({id:first.id,command:first.command,job_step:first.job_step,ordinal:first.ordinal}),
      'unverified-bootstrap-predecessor');
    const limit = plan.original_primary_limit;
    budgetCheck(limit-bootstrapPrimary <= Math.max(0,availableBootstrapRemaining(q)-bootstrapSinceSamplePrimary) && limit > bootstrapPrimary && bootstrapPrimary<=first.bootstrap_maximum_primary &&
      bootstrapStarts<=first.bootstrap_maximum_starts && bootstrapPlannedPrimary<=first.bootstrap_maximum_primary &&
      bootstrapPlannedPrimary<=first.planned_primary,'bootstrap-allowance');
    state = {schema_version:v3?BUDGET_SCHEMA_V3:BUDGET_SCHEMA,context_sha256:hash(Buffer.from(canonical(bound))),policy_sha256:digest,
      original_primary_limit:limit,spent_primary:bootstrapPrimary,logical_issued:bootstrapStarts,bootstrap_starts:bootstrapStarts,bootstrap_primary_debit:bootstrapPrimary,
      known_200:0,completed_gh_json:0,validated_304:0,unknown_issued:0,opaque_primary_debit:0,unreconciled_opaque_primary:0,last_completed_phase:-1,last_completed_at_epoch_ms:null,last_quota_boundary:boundary,next_bootstrap:null,pending_phase:null,
      current_window:{resource:q.resource,limit:q.limit,reset_epoch:q.reset_epoch,
        minimum_remaining_header:observedBootstrapRemaining(q),credit:Math.max(0,availableBootstrapRemaining(q)-bootstrapSinceSamplePrimary)},prior_windows:[]};
    if(v3)Object.assign(state,{extra_primary_limits:clone(plan.extra_primary),extra_primary_used:clone(bootstrapExtras),completed_step_model_primary:0,history_initial_weight:null,history_max_weight:0});
  } else {
    state = checkedTransportBudget(saved, bound);
    budgetCheck(state.schema_version===(v3?BUDGET_SCHEMA_V3:BUDGET_SCHEMA) &&
      (!v3 || canonical(state.extra_primary_limits)===canonical(plan.extra_primary)) &&
      state.policy_sha256 === digest && state.original_primary_limit === plan.original_primary_limit &&
      state.pending_phase === null && state.unknown_issued === 0, 'pending-or-foreign-state');
    const index=state.last_completed_phase+1,expected=plan.phases[index],allocation=state.next_bootstrap;
    budgetCheck(expected && allocation && canonical(allocation)===canonical({phase_index:index,phase_id:expected.id,
      command:expected.command,job_step:expected.job_step,ordinal:expected.ordinal,
      maximum_primary:expected.bootstrap_maximum_primary,maximum_starts:expected.bootstrap_maximum_starts,
      ...(v3?{maximum_step_model_primary:expected.predecessor_model_primary}:{})}) &&
      canonical(verifiedBootstrapPhase)===canonical({id:expected.id,command:expected.command,
        job_step:expected.job_step,ordinal:expected.ordinal}),'unverified-bootstrap-predecessor');
    budgetCheck(bootstrapPrimary<=allocation.maximum_primary && bootstrapStarts<=allocation.maximum_starts &&
      state.spent_primary + bootstrapPrimary + completedStepModelPrimary <= state.original_primary_limit &&
      bootstrapPlannedPrimary<=allocation.maximum_primary && bootstrapPlannedPrimary<=expected.planned_primary, 'bootstrap-allowance');
    // The preceding completed phase retains this full allocation on disk until
    // the successful fresh bootstrap is durably promoted by begin(). A failed
    // command cannot advance under the reviewed attempt1/default-gated workflow.
    state.next_bootstrap=null;
    state.spent_primary += bootstrapPrimary+completedStepModelPrimary; state.logical_issued += bootstrapStarts;
    if(v3) {
      state.completed_step_model_primary+=completedStepModelPrimary;
      for(const key of EXTRA_KEYS)state.extra_primary_used[key]+=bootstrapExtras[key];
    }
    state.bootstrap_starts += bootstrapStarts; state.bootstrap_primary_debit += bootstrapPrimary;
    state.current_window.credit = Math.max(0,state.current_window.credit-bootstrapPrimary-completedStepModelPrimary);
  }
  if(v3)budgetCheck(EXTRA_KEYS.every(key=>state.extra_primary_used[key]<=state.extra_primary_limits[key]),'extra-pool-exhausted');
  let phase = null, phaseIssued = bootstrapStarts, phasePrimary = bootstrapPrimary, plannedConsumed = bootstrapPlannedPrimary, phaseExtraPrimary=sumExtras(bootstrapExtras), nextReservation = 1;
  const remainingExtras=()=>v3?sumExtras(state.extra_primary_limits)-sumExtras(state.extra_primary_used):0;
  const outstanding = new Map();
  let failed = false, complete = false;
  const totalOutstanding = () => [...outstanding.values()].reduce((sum,r)=>sum+r.maximum_primary,0);
  const outstandingStarts = () => [...outstanding.values()].reduce((sum,r)=>sum+r.maximum_starts,0);
  const outstandingPlanned = () => [...outstanding.values()].reduce((sum,r)=>sum+r.planned_primary,0);
  const available = () => Math.max(0,Math.min(state.original_primary_limit-state.spent_primary-totalOutstanding()-(state.next_bootstrap?.maximum_primary??0),
    state.current_window.credit-totalOutstanding()));
  const alive = () => { budgetCheck(!failed && !complete, 'terminal-model'); clock(); };
  const terminal = error => { failed=true; throw error; };
  const write = () => { const value=checkedTransportBudget(state,bound); persist(deepFreeze(clone(value))); };
  function observeQuota(qValue,{otherSettledDebt=0,fenced=false}={}) {
    const q=checkedBudgetQuota(qValue), n=clock(), window=state.current_window;
    budgetCheck(nonnegative(otherSettledDebt),'invalid-observation-debt');
    // Preserve known overlapping settled debt. Regional counter variation is
    // covered by the separate uncertainty reserve, never exact reconciliation.
    const candidate=Math.max(0,q.remaining-otherSettledDebt-state.unreconciled_opaque_primary);
    if(q.reset_epoch===window.reset_epoch) {
      budgetCheck(q.resource===window.resource && q.limit===window.limit,'scope-or-limit-disagreement');
      window.minimum_remaining_header=Math.min(window.minimum_remaining_header,q.remaining);
      window.credit=Math.min(window.credit,candidate);
    } else {
      budgetCheck(fenced,'unfenced-reset-transition');
      budgetCheck(q.resource===window.resource && q.limit===window.limit &&
        q.reset_epoch>window.reset_epoch && n>=window.reset_epoch*1000 && q.reset_epoch*1000>n,
        'unproved-reset-transition');
      budgetCheck(state.prior_windows.length+1<BUDGET_MAX_WINDOWS,'window-cap');
      state.prior_windows.push(clone(window));
      state.current_window={resource:q.resource,limit:q.limit,reset_epoch:q.reset_epoch,
        minimum_remaining_header:q.remaining,credit:Math.max(0,Math.min(candidate,
          state.original_primary_limit-state.spent_primary))};
    }
  }
  if(saved!==null && initialQuota!==null) {
    const q=checkedBudgetQuota(initialQuota),n=clock();
    const boundary=checkedQuotaBoundary(quotaBoundary,bound,n,state.last_completed_at_epoch_ms);
    budgetCheck(bootstrapStarts>0 && bootstrapPrimary>0,'unmeasured-bootstrap-boundary');
    const window=state.current_window;
    if(q.reset_epoch===window.reset_epoch) {
      budgetCheck(q.resource===window.resource && q.limit===window.limit,'scope-or-limit-disagreement');
      window.minimum_remaining_header=Math.min(window.minimum_remaining_header,observedBootstrapRemaining(q));
    } else {
      budgetCheck(q.resource===window.resource && q.limit===window.limit &&
        q.reset_epoch>window.reset_epoch && n>=window.reset_epoch*1000 && q.reset_epoch*1000>n,
        'unproved-reset-transition');
      budgetCheck(state.prior_windows.length+1<BUDGET_MAX_WINDOWS,'window-cap');
      state.prior_windows.push(clone(window));
      state.current_window={resource:q.resource,limit:q.limit,reset_epoch:q.reset_epoch,
        minimum_remaining_header:observedBootstrapRemaining(q),credit:0};
    }
    // Only this quiescent, required caller boundary rebases observed bookkeeping.
    // The immutable owned allowance and all its consumed charges stay intact.
    state.current_window.credit=Math.max(0,Math.min(Math.min(state.current_window.minimum_remaining_header,availableBootstrapRemaining(q))-bootstrapSinceSamplePrimary,
      state.original_primary_limit-state.spent_primary));
    state.last_quota_boundary=boundary;
    state.unreconciled_opaque_primary=0;
  } else if(saved!==null) {
    budgetCheck(quotaBoundary===null,'boundary-without-quota');
  }
  return Object.freeze({
    begin(verifiedPhase) {
      try {
        alive(); budgetCheck(phase===null && state.pending_phase===null,'phase-already-owned');
        const index=state.last_completed_phase+1, expected=plan.phases[index];
        budgetCheck(expected && canonical(verifiedPhase)===canonical({id:expected.id,command:expected.command,
          job_step:expected.job_step,ordinal:expected.ordinal}),'unverified-phase');
        budgetCheck(expected.maximum_primary>=phasePrimary && expected.maximum_starts>=phaseIssued && expected.planned_primary>=plannedConsumed &&
          available()>=expected.planned_primary-plannedConsumed+expected.future_primary+remainingExtras()+plan.retained_reserve+
            Math.max(expected.maximum_primary-expected.planned_primary,expected.future_transient_primary),'remaining-path-allowance');
        phase=expected;state.pending_phase={...clone(expected),index,retained_reserve:plan.retained_reserve,started_at_epoch_ms:clock()};
        write();return true;
      } catch(error) { return terminal(error); }
    },
    reserve({maximumPrimary=1,maximumStarts=1,plannedPrimary=1}={}) {
      try {
        alive();budgetCheck(phase!==null && nonnegative(maximumPrimary) && positive(maximumStarts) && maximumPrimary>=maximumStarts &&
          nonnegative(plannedPrimary) && plannedPrimary<=maximumPrimary &&
          plannedPrimary<=phase.planned_primary-plannedConsumed-outstandingPlanned(),'invalid-reservation');
        budgetCheck(phasePrimary+totalOutstanding()+maximumPrimary<=phase.maximum_primary+phaseExtraPrimary &&
          phaseIssued+outstandingStarts()+maximumStarts<=phase.maximum_starts,'phase-bound');
        const currentFuture=phase.planned_primary-plannedConsumed-outstandingPlanned()-plannedPrimary;
        // Keep this phase's largest uplift through verified command completion.
        // Later phases contribute only their single maximum sequential uplift.
        const retainedUplift=Math.max(phase.maximum_primary-phase.planned_primary,
          phase.future_transient_primary,maximumPrimary-plannedPrimary);
        budgetCheck(available()>=maximumPrimary+currentFuture+phase.future_primary+remainingExtras()+plan.retained_reserve+
          Math.max(0,retainedUplift-(maximumPrimary-plannedPrimary)),'remaining-path-allowance');
        const id=nextReservation++;outstanding.set(id,{maximum_primary:maximumPrimary,maximum_starts:maximumStarts,planned_primary:plannedPrimary,spent_at_issue:state.spent_primary,opaque_at_issue:state.opaque_primary_debit});
        return id;
      } catch(error) { return terminal(error); }
    },
    settle(id,{known200=0,completedGhJson=0,validated304=0,opaquePrimary=0,quota=null,sampleOwn200=0,sampleStatus=null,operationComplete=false,extraPrimary=emptyExtras(),serialQuota=false}={}) {
      try {
        alive();const r=outstanding.get(id);
        budgetCheck(r && nonnegative(known200) && nonnegative(completedGhJson) && nonnegative(validated304) && nonnegative(opaquePrimary) &&
          known200+completedGhJson+validated304<=r.maximum_starts && known200+completedGhJson+opaquePrimary<=r.maximum_primary &&
          typeof operationComplete==='boolean' && typeof serialQuota==='boolean' &&
          (!serialQuota || operationComplete && quota!==null) &&
          (known200+completedGhJson+validated304===0 || operationComplete===true) &&
          (known200+completedGhJson+validated304>0 || opaquePrimary===0) &&
          nonnegative(sampleOwn200) && sampleOwn200<=Math.min(1,known200) &&
          (quota===null ? sampleStatus===null && sampleOwn200===0 :
            (sampleStatus===200 && known200>0) || (sampleStatus===304 && validated304>0 && sampleOwn200===0)),
          'invalid-settlement');
        // A validated final304 releases only its proven unused portion.
        // The independently bounded transport reissue charge remains explicit.
        const charged=known200+completedGhJson+opaquePrimary, extras=checkedExtras(extraPrimary,'invalid-extra-settlement');
        budgetCheck(v3 ? sumExtras(extras)<=charged && charged-sumExtras(extras)<=r.planned_primary &&
          EXTRA_KEYS.every(key=>state.extra_primary_used[key]+extras[key]<=state.extra_primary_limits[key]) :
          sumExtras(extras)===0,'extra-pool-exhausted');
        outstanding.delete(id);
        if(v3)for(const key of EXTRA_KEYS)state.extra_primary_used[key]+=extras[key];
        phaseExtraPrimary+=sumExtras(extras);
        state.spent_primary+=charged;state.logical_issued+=known200+completedGhJson+validated304;
        state.known_200+=known200;state.completed_gh_json+=completedGhJson;state.validated_304+=validated304;phasePrimary+=charged;
        state.opaque_primary_debit+=opaquePrimary;state.unreconciled_opaque_primary+=opaquePrimary;
        phaseIssued+=known200+completedGhJson+validated304;
        // Only a completed operation retires its trusted forecast. An unused
        // reservation releases the live hold while retaining that future work.
        if(known200+completedGhJson+validated304>0)plannedConsumed+=r.planned_primary;
        state.current_window.credit=Math.max(0,state.current_window.credit-charged);
        if(quota!==null) observeQuota(quota,{otherSettledDebt:state.spent_primary-r.spent_at_issue-charged-
          (state.opaque_primary_debit-r.opaque_at_issue-opaquePrimary)+(serialQuota?0:known200+completedGhJson-sampleOwn200),fenced:true});
        budgetCheck(state.spent_primary<=state.original_primary_limit,'remaining-path-allowance');
      } catch(error) { return terminal(error); }
    },
    observe(quota,{reservationId=null,otherSettledDebt=0}={}) {
      try {
        alive();const r=reservationId===null?null:outstanding.get(reservationId);
        budgetCheck((reservationId===null || r) && nonnegative(otherSettledDebt),'missing-quota-acquisition-fence');
        observeQuota(quota,{otherSettledDebt:Math.max(otherSettledDebt,r?state.spent_primary-r.spent_at_issue-(state.opaque_primary_debit-r.opaque_at_issue):0),fenced:Boolean(r)});
      } catch(error) { return terminal(error); }
    },
    fail(id=null) {
      alive();failed=true;
      if(id!==null) {
        const r=outstanding.get(id);budgetCheck(r,'missing-failed-reservation');
        state.spent_primary+=r.maximum_primary;
        state.current_window.credit=Math.max(0,state.current_window.credit-r.maximum_primary);
        state.logical_issued+=r.maximum_starts;state.unknown_issued+=r.maximum_starts;
        phaseIssued+=r.maximum_starts;phasePrimary+=r.maximum_primary;outstanding.delete(id);
        budgetCheck(state.spent_primary<=state.original_primary_limit,'remaining-path-allowance');
      }
      // The durable full pending reservation stays in place; no failed or
      // interrupted result may become a completed state or normal cache miss.
      return deepFreeze(clone(state));
    },
    finish() {
      try {
        alive();budgetCheck(phase!==null && outstanding.size===0 && state.unknown_issued===0,'unsettled-phase');
        budgetCheck(phasePrimary<=phase.maximum_primary+phaseExtraPrimary && available()>=phase.future_primary+
          (state.last_completed_phase+2<plan.phases.length?remainingExtras():0)+plan.retained_reserve+phase.future_transient_primary,'remaining-path-allowance');
        state.last_completed_phase=state.pending_phase.index;state.last_completed_at_epoch_ms=clock();state.pending_phase=null;
        const next=plan.phases[state.last_completed_phase+1];
        state.next_bootstrap=next?{phase_index:state.last_completed_phase+1,phase_id:next.id,command:next.command,
          job_step:next.job_step,ordinal:next.ordinal,maximum_primary:next.bootstrap_maximum_primary,
          maximum_starts:next.bootstrap_maximum_starts,...(v3?{maximum_step_model_primary:next.predecessor_model_primary}:{})}:null;
        write();complete=true;
        return deepFreeze(clone(state));
      } catch(error) { return terminal(error); }
    },
    lowerUnclassifiedQuota(quota,{otherSettledDebt}={}) {
      try {
        alive();budgetCheck(exactKeys(quota,'limit,used,remaining,reset_epoch,resource') && quota.resource===null &&
          positive(quota.limit) && nonnegative(quota.used) && nonnegative(quota.remaining) &&
          quota.used+quota.remaining===quota.limit && positive(quota.reset_epoch) && nonnegative(otherSettledDebt),
          'invalid-unclassified-quota');
        const window=state.current_window;
        // Missing-resource evidence can lower only this already confirmed window.
        // It cannot initialize a grant or promote/rebase a reset transition.
        if(quota.limit!==window.limit || quota.reset_epoch!==window.reset_epoch)return false;
        window.minimum_remaining_header=Math.min(window.minimum_remaining_header,quota.remaining);
        window.credit=Math.min(window.credit,Math.max(0,quota.remaining-otherSettledDebt-state.unreconciled_opaque_primary));
        return true;
      } catch(error) { return terminal(error); }
    },
    recordHistoryWeight(weight) {
      try {
        alive();budgetCheck(v3 && phase!==null && outstanding.size===0 && nonnegative(weight) && weight<=200,'invalid-history-weight');
        if(state.history_initial_weight===null) {
          budgetCheck(weight<=192,'initial-history-weight-cap');state.history_initial_weight=weight;
        }
        state.history_max_weight=Math.max(state.history_max_weight,weight);
      } catch(error) { return terminal(error); }
    },
    snapshot() { return deepFreeze(clone(state)); },
  });
}
