// Bounded in-memory jobs transport. This worker grants no publication authority.
// The synchronous parent owns fresh run selection, token/scope lifetime, and
// every deployment guard. Cache bytes never replace authenticated revalidation.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

export const CONDITIONAL_DEPLOYMENT_JOB_LIMITS = Object.freeze({
  runs: 2000, jobsPerRun: 1000, pagesPerRun: 10, perPage: 100,
  pageBytes: 8 * 1024 * 1024, aggregateBytes: 64 * 1024 * 1024,
  stdioBytes: 64 * 1024 * 1024, cacheBytes: 32 * 1024 * 1024,
  deadlineMs: 120_000, requestMs: 10_000, startSpacingMs: 200, quotaReserve: 100,
});
export const REQUEST_REPRESENTATION = Object.freeze({
  headers: Object.freeze({
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'accept-encoding': 'gzip',
    'user-agent': 'screener-conditional-deployment-jobs-v1',
  }),
  absent: Object.freeze(['cookie', 'x-github-otp', 'x-requested-with']),
  authorization: 'private-invocation-scope',
});
const L = CONDITIONAL_DEPLOYMENT_JOB_LIMITS;
const REPOSITORY = 'kusennjp1-ai/screener';
const REPOSITORY_ID = 1203919607;
const SCHEMA = 'conditional-deployment-jobs-v1';
const PAGE_SCHEMA = 'conditional-deployment-jobs-page-v1';
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);
const CONCLUSIONS = new Set(['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'neutral', 'action_required', 'startup_failure', 'stale']);
const VARY_NAMES = new Set([...Object.keys(REQUEST_REPRESENTATION.headers), ...REQUEST_REPRESENTATION.absent, 'authorization']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, function(_key, item) {
  return object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
class JobsFault extends Error {
  constructor(code) { super(code); this.name = 'JobsFault'; this.code = code; }
}
const requireThat = (condition, code) => { if (!condition) throw new JobsFault(code); };
const text = (value, maximum) => typeof value === 'string' && value.length > 0 &&
  Buffer.byteLength(value, 'utf8') <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
const nullableText = (value, maximum) => value === null || text(value, maximum);
function utc(value, nullable = false) {
  if (value === null && nullable) return null;
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value), 'invalid-utc-clock');
  const parsed = Date.parse(value);
  requireThat(Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19), 'invalid-utc-clock');
  return parsed;
}
export function validateScope(scope) {
  requireThat(object(scope) && Object.keys(scope).sort().join(',') ===
    'controller_sha,repository,repository_id,run_attempt,run_id', 'invalid-scope');
  requireThat(scope.repository === REPOSITORY && scope.repository_id === REPOSITORY_ID &&
    positive(scope.run_id) && positive(scope.run_attempt) && SHA.test(scope.controller_sha ?? ''), 'invalid-scope');
  return {
    repository: scope.repository, repository_id: scope.repository_id, run_id: scope.run_id,
    run_attempt: scope.run_attempt, controller_sha: scope.controller_sha,
  };
}
function validateRun(run) {
  requireThat(object(run) && positive(run.id) && positive(run.run_attempt) && SHA.test(run.head_sha ?? ''), 'invalid-run-identity');
  requireThat(run.repository?.id === REPOSITORY_ID && run.repository?.full_name === REPOSITORY, 'foreign-run-repository');
  requireThat(object(run.head_repository) && positive(run.head_repository.id) &&
    text(run.head_repository.full_name, 256) &&
    ((run.head_repository.id === REPOSITORY_ID) === (run.head_repository.full_name === REPOSITORY)), 'conflicting-head-repository');
  requireThat(positive(run.workflow_id) && text(run.path, 512) && text(run.event, 128) &&
    nullableText(run.head_branch, 256) && text(run.name, 1024), 'invalid-run-schema');
  for (const [id, file] of [[294257497, 'static-site.yml'], [364666954, 'research-ui-release.yml']]) {
    requireThat((run.workflow_id === id) === (run.path === '.github/workflows/' + file), 'conflicting-workflow-identity');
  }
  const active = ACTIVE.has(run.status);
  requireThat((active && run.conclusion === null) ||
    (run.status === 'completed' && CONCLUSIONS.has(run.conclusion)), 'invalid-run-status');
  const created = utc(run.created_at), updated = utc(run.updated_at), started = utc(run.run_started_at, true);
  requireThat(created <= updated && (started === null || (created <= started && started <= updated)), 'contradictory-run-chronology');
  return { created, updated, started, active };
}
export function runKey(run) {
  validateRun(run);
  return sha256(canonical({
    repository: { id: run.repository.id, full_name: run.repository.full_name },
    head_repository: { id: run.head_repository.id, full_name: run.head_repository.full_name },
    id: run.id, run_attempt: run.run_attempt, head_sha: run.head_sha, head_branch: run.head_branch,
    workflow_id: run.workflow_id, path: run.path, event: run.event, name: run.name,
    status: run.status, conclusion: run.conclusion,
    created_at: run.created_at, updated_at: run.updated_at, run_started_at: run.run_started_at,
  }));
}
function pageURL(runId, page = 1) {
  return 'https://api.github.com/repos/' + REPOSITORY + '/actions/runs/' + runId +
    '/jobs?filter=all&per_page=100' + (page === 1 ? '' : '&page=' + page);
}
function validateURL(value, runId, expectedPage = null) {
  requireThat(text(value, 2048), 'invalid-jobs-url');
  let url;
  try { url = new URL(value); } catch { throw new JobsFault('invalid-jobs-url'); }
  requireThat(url.protocol === 'https:' && url.hostname === 'api.github.com' && !url.port &&
    !url.username && !url.password && !url.hash && !value.includes('#') &&
    url.pathname === '/repos/' + REPOSITORY + '/actions/runs/' + runId + '/jobs', 'unsafe-jobs-url');
  const entries = [...url.searchParams], keys = entries.map(([key]) => key);
  requireThat(new Set(keys).size === keys.length && (keys.length === 2 || keys.length === 3) &&
    keys.every(key => ['filter', 'per_page', 'page'].includes(key)) &&
    url.searchParams.get('filter') === 'all' && url.searchParams.get('per_page') === '100' &&
    !/%/.test(url.search), 'unsafe-jobs-query');
  const rawPage = url.searchParams.get('page');
  const page = rawPage === null ? 1 : Number(rawPage);
  requireThat((rawPage === null || /^[1-9]\d*$/.test(rawPage)) && positive(page) &&
    page <= L.pagesPerRun && (expectedPage === null || page === expectedPage), 'invalid-jobs-page');
  return page;
}
function links(link, runId) {
  requireThat(typeof link === 'string' && Buffer.byteLength(link, 'utf8') <= 8192, 'invalid-jobs-link');
  const result = new Map();
  for (const part of link ? link.split(',') : []) {
    const match = /^\s*<([^>]+)>;\s*rel="(next|prev|first|last)"\s*$/.exec(part);
    requireThat(match && !result.has(match[2]), 'invalid-jobs-link');
    const page = validateURL(match[1], runId);
    result.set(match[2], { url: match[1], page });
  }
  return result;
}
function opaqueTag(tag, nullable = false) {
  if (tag === null && nullable) return null;
  requireThat(typeof tag === 'string' && Buffer.byteLength(tag, 'utf8') <= 2048 &&
    /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(tag), 'invalid-etag');
  // Do not trim/unescape/case-fold/hash/substitute the RFC opaque tag.
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}
function parseVary(value) {
  if (value === null || value === '') return [];
  requireThat(text(value, 2048), 'invalid-vary');
  const names = value.split(',').map(name => name.trim().toLowerCase());
  requireThat(names.every(name => VARY_NAMES.has(name)), 'unbound-vary');
  return [...new Set(names)].sort();
}
function validateVary(value) {
  requireThat(Array.isArray(value) && value.every(name => VARY_NAMES.has(name)) &&
    canonical(value) === canonical([...new Set(value)].sort()), 'unbound-vary');
  return value;
}
function rawRecord(record) {
  requireThat(object(record) && record.schema_version === PAGE_SCHEMA && Object.keys(record).sort().join(',') ===
    'body_base64,body_bytes,body_sha256,etag,link,representation,run_key,schema_version,scope,url,vary', 'invalid-page-record');
  validateScope(record.scope);
  requireThat(SHA256.test(record.run_key ?? '') && canonical(record.representation) === canonical(REQUEST_REPRESENTATION), 'invalid-representation-binding');
  opaqueTag(record.etag, true);
  validateVary(record.vary);
  requireThat(typeof record.link === 'string' && typeof record.body_base64 === 'string' &&
    record.body_base64.length <= 4 * Math.ceil(L.pageBytes / 3) &&
    /^[A-Za-z0-9+/]*(?:={1,2})?$/.test(record.body_base64) && record.body_base64.length % 4 === 0 &&
    Number.isSafeInteger(record.body_bytes) && record.body_bytes > 0 && record.body_bytes <= L.pageBytes &&
    SHA256.test(record.body_sha256 ?? ''), 'invalid-page-body-record');
  const bytes = Buffer.from(record.body_base64, 'base64');
  requireThat(bytes.toString('base64') === record.body_base64 && bytes.length === record.body_bytes &&
    sha256(bytes) === record.body_sha256, 'page-body-integrity');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new JobsFault('invalid-jobs-json'); }
  requireThat(object(value) && Number.isSafeInteger(value.total_count) && value.total_count >= 0 &&
    value.total_count <= L.jobsPerRun && Array.isArray(value.jobs) && value.jobs.length <= L.perPage, 'invalid-jobs-page-schema');
  return { bytes, value };
}
function validateJob(run, job, runClocks) {
  requireThat(object(job) && positive(job.id) && job.run_id === run.id && positive(job.run_attempt) &&
    job.run_attempt <= run.run_attempt && job.head_sha === run.head_sha && job.head_branch === run.head_branch &&
    text(job.name, 1024) && job.workflow_name === run.name, 'contradictory-job-identity');
  requireThat(job.run_url === 'https://api.github.com/repos/' + REPOSITORY + '/actions/runs/' + run.id &&
    job.url === 'https://api.github.com/repos/' + REPOSITORY + '/actions/jobs/' + job.id, 'contradictory-job-route');
  if (Object.hasOwn(job, 'html_url')) requireThat(job.html_url ===
    'https://github.com/' + REPOSITORY + '/actions/runs/' + run.id + '/job/' + job.id, 'contradictory-job-route');
  const active = ACTIVE.has(job.status);
  requireThat((active && job.conclusion === null) ||
    (job.status === 'completed' && CONCLUSIONS.has(job.conclusion)), 'invalid-job-status');
  requireThat(!active || (runClocks.active && job.run_attempt === run.run_attempt), 'active-job-on-terminal-attempt');
  const nullableTerminal = ['skipped', 'cancelled'].includes(job.conclusion);
  const emptySkippedMetadata = job.status === 'completed' && job.conclusion === 'skipped' &&
    Array.isArray(job.steps) && job.steps.length === 0;
  const created = utc(job.created_at), started = utc(job.started_at, active || nullableTerminal),
    completed = utc(job.completed_at, active || nullableTerminal);
  requireThat(created >= runClocks.created && (started === null || started >= created) &&
    (completed === null || (completed >= runClocks.created && (emptySkippedMetadata || completed >= (started ?? created)))) &&
    (runClocks.active || (created <= runClocks.updated && (started === null || started <= runClocks.updated) &&
      (completed === null || completed <= runClocks.updated))), 'contradictory-job-chronology');
  requireThat(!active || completed === null, 'active-job-completed-clock');
  requireThat(job.status !== 'in_progress' || started !== null, 'running-job-without-start');
  requireThat(Object.hasOwn(job, 'steps') &&
    (Array.isArray(job.steps) || (job.steps === null && (active || nullableTerminal))), 'invalid-job-steps');
  if (job.steps === null) return;
  requireThat(job.steps.length <= 1000, 'job-step-cap');
  let number = 0, previousEnd = null;
  for (const step of job.steps) {
    requireThat(object(step) && positive(step.number) && step.number > number && text(step.name, 1024), 'invalid-or-duplicate-job-step');
    number = step.number;
    const running = ACTIVE.has(step.status), nullable = ['skipped', 'cancelled'].includes(step.conclusion);
    requireThat((running && step.conclusion === null) ||
      (step.status === 'completed' && CONCLUSIONS.has(step.conclusion)), 'invalid-step-status');
    requireThat(!running || active, 'running-step-on-terminal-job');
    const begin = utc(step.started_at, running || nullable), end = utc(step.completed_at, running || nullable);
    requireThat((begin === null || begin >= (started ?? created)) &&
      (end === null || end >= (begin ?? started ?? created)) &&
      (completed === null || end === null || end <= completed) &&
      (previousEnd === null || begin === null || previousEnd <= begin) &&
      (started !== null || (begin === null && end === null)) &&
      (runClocks.active || ((begin === null || begin <= runClocks.updated) && (end === null || end <= runClocks.updated))),
      'contradictory-step-chronology');
    requireThat(!running || end === null, 'active-step-completed-clock');
    requireThat(step.status !== 'in_progress' || begin !== null, 'running-step-without-start');
    if (end !== null) previousEnd = end;
  }
}
export function decodePageRecord(run, record, scope) {
  requireThat(object(record), 'invalid-page-record');
  requireThat(canonical(validateScope(record.scope)) === canonical(validateScope(scope)), 'page-scope-mismatch');
  const clocks = validateRun(run), decoded = rawRecord(record);
  requireThat(record.run_key === runKey(run), 'stale-run-fingerprint');
  const page = validateURL(record.url, run.id);
  if (page === 1) requireThat(record.url === pageURL(run.id), 'nonliteral-first-jobs-route');
  const last = Math.max(1, Math.ceil(decoded.value.total_count / L.perPage));
  requireThat(page <= last, 'unexpected-jobs-page');
  const relations = links(record.link, run.id);
  requireThat(!relations.has('first') || relations.get('first').page === 1, 'contradictory-first-jobs-link');
  requireThat(!relations.has('last') || relations.get('last').page === last, 'contradictory-last-jobs-link');
  requireThat(!relations.has('prev') || (page > 1 && relations.get('prev').page === page - 1), 'contradictory-prev-jobs-link');
  requireThat(page < last ? relations.has('next') && relations.get('next').page === page + 1 :
    !relations.has('next'), 'missing-or-contradictory-next-jobs-link');
  const expectedCount = page < last ? L.perPage : decoded.value.total_count - (page - 1) * L.perPage;
  requireThat(decoded.value.jobs.length === expectedCount, 'partial-jobs-page');
  const pageIds = new Set();
  for (const job of decoded.value.jobs) {
    validateJob(run, job, clocks);
    requireThat(!pageIds.has(job.id), 'duplicate-job-id');
    pageIds.add(job.id);
  }
  return { ...decoded, page, last, next_url: relations.get('next')?.url ?? null };
}
export function validateJobsPages(run, pages, scope) {
  validateRun(run);
  requireThat(Array.isArray(pages) && pages.length >= 1 && pages.length <= L.pagesPerRun, 'incomplete-jobs-inventory');
  let total = null, prior = null;
  const jobs = [], seen = new Set();
  const boundScope = canonical(validateScope(scope));
  for (let index = 0; index < pages.length; index++) {
    const decoded = decodePageRecord(run, pages[index], scope);
    requireThat(decoded.page === index + 1 && (index === 0 || prior === pages[index].url) &&
      canonical(validateScope(pages[index].scope)) === boundScope, 'contradictory-jobs-page-chain');
    requireThat(total === null || total === decoded.value.total_count, 'changing-jobs-total');
    total = decoded.value.total_count;
    for (const job of decoded.value.jobs) {
      requireThat(!seen.has(job.id), 'duplicate-job-id');
      seen.add(job.id); jobs.push(job);
    }
    prior = decoded.next_url;
  }
  requireThat(prior === null && pages.length === Math.max(1, Math.ceil(total / L.perPage)) &&
    jobs.length === total && seen.size === total, 'incomplete-jobs-inventory');
  requireThat(total > 0 || run.conclusion !== 'success', 'empty-successful-jobs-inventory');
  return { total, jobs };
}
function quota(headers) {
  const integer = name => {
    const value = headers.get(name);
    requireThat(typeof value === 'string' && /^\d{1,16}$/.test(value), 'missing-or-invalid-route-quota');
    const number = Number(value);
    requireThat(Number.isSafeInteger(number), 'missing-or-invalid-route-quota');
    return number;
  };
  const result = {
    limit: integer('x-ratelimit-limit'), remaining: integer('x-ratelimit-remaining'),
    used: integer('x-ratelimit-used'), reset_epoch: integer('x-ratelimit-reset'),
    resource: headers.get('x-ratelimit-resource'),
  };
  requireThat(result.limit > 0 && result.remaining <= result.limit &&
    result.used <= result.limit && result.remaining + result.used === result.limit &&
    result.reset_epoch > 0 && result.resource === 'core', 'invalid-route-quota');
  return result;
}
function initialStats() {
  return {
    requests: 0, fresh_200: 0, conditional_200: 0, revalidated_304: 0, uncached_200: 0,
    cache_evictions: 0, received_body_bytes: 0, accepted_body_bytes: 0, revalidated_body_bytes: 0,
    cancellations_requested: 0, cancellations_completed: 0, cleanup_failures: 0,
  };
}
function failed(code, observations = [], stats = initialStats()) {
  return { schema_version: SCHEMA, status: 'failed', error_code: code, jobs: [], cache: [],
    observations, body_bytes: stats.received_body_bytes, stats };
}

/**
 * The token dependency is private and is never copied into config/cache/logs.
 * CLI reads only inherited GH_TOKEN. Native fetch transparently decodes gzip:
 * recorded bytes/hash are exact decoded JSON representation bytes, not wire.
 */
export async function readConditionalDeploymentJobs(config, {
  fetcher = globalThis.fetch, token = process.env.GH_TOKEN,
  monotonic = () => performance.now(),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const observations = [], stats = initialStats(), results = [], outputCache = [];
  let timer, globalExpired = false, lastClock = null, lastStart = null, totalAccepted = 0;
  let outputCacheBytes = 2, lastQuota = null;
  const evictedURLs = new Set();
  const evict = url => { if (!evictedURLs.has(url)) { evictedURLs.add(url); stats.cache_evictions++; } };
  const recount = () => {
    stats.requests = observations.length;
    stats.fresh_200 = observations.filter(item => item.status === 200).length;
    stats.conditional_200 = observations.filter(item => item.status === 200 && item.conditional).length;
    stats.revalidated_304 = observations.filter(item => item.page_revalidated).length;
    stats.uncached_200 = observations.filter(item => item.status === 200 && item.cacheable === false).length;
    for (const [name, field] of [['received_body_bytes', 'received_body_bytes'],
      ['accepted_body_bytes', 'representation_body_bytes'], ['cancellations_requested', 'cancellations_requested'],
      ['cancellations_completed', 'cancellations_completed'], ['cleanup_failures', 'cleanup_failures']]) {
      stats[name] = observations.reduce((sum, item) => sum + item[field], 0);
    }
    stats.revalidated_body_bytes = observations.filter(item => item.page_revalidated)
      .reduce((sum, item) => sum + item.representation_body_bytes, 0);
  };
  const now = () => {
    const value = monotonic();
    requireThat(Number.isFinite(value) && value >= 0 && (lastClock === null || value >= lastClock), 'invalid-monotonic-clock');
    lastClock = value; return value;
  };
  let globalDeadline, expired;
  try {
    requireThat(object(config) && Object.keys(config).every(key =>
      ['scope', 'runs', 'cache', 'excludedIds', 'timeoutMs'].includes(key)), 'invalid-worker-config');
    const scope = validateScope(config.scope);
    requireThat(Array.isArray(config.runs) && config.runs.length <= L.runs &&
      Array.isArray(config.cache) && Array.isArray(config.excludedIds) &&
      config.excludedIds.every(positive) && new Set(config.excludedIds).size === config.excludedIds.length, 'invalid-worker-config');
    requireThat(typeof token === 'string' && token.length > 0 && token.length <= 8192 &&
      !/[\u0000-\u0020\u007f]/.test(token) && typeof fetcher === 'function' &&
      typeof monotonic === 'function' && typeof pause === 'function', 'missing-or-invalid-private-token');
    const timeout = config.timeoutMs ?? L.deadlineMs;
    requireThat(positive(timeout) && timeout <= L.deadlineMs, 'invalid-worker-timeout');
    requireThat(Buffer.byteLength(JSON.stringify(config), 'utf8') <= L.stdioBytes &&
      Buffer.byteLength(JSON.stringify(config.cache), 'utf8') <= L.cacheBytes, 'worker-input-or-cache-cap');
    const started = now();
    globalDeadline = started + timeout;
    expired = new Promise((_resolve, reject) => {
      timer = setTimeout(() => { globalExpired = true; reject(new JobsFault('worker-deadline')); }, timeout);
    });
    expired.catch(() => {});
    const checkpoint = () => requireThat(!globalExpired && now() < globalDeadline, 'worker-deadline');
    const runs = new Map();
    for (const run of config.runs) {
      validateRun(run);
      requireThat(!runs.has(run.id), 'duplicate-run-id');
      runs.set(run.id, run);
    }
    const excluded = new Set([...config.excludedIds, scope.run_id]);
    const reusable = run => run.status === 'completed' && !excluded.has(run.id);
    const cache = new Map(), cacheURLs = new Set();
    for (const record of config.cache) {
      checkpoint();
      rawRecord(record);
      requireThat(canonical(record.scope) === canonical(scope) && record.etag !== null, 'invalid-cache-scope-or-validator');
      const match = /^https:\/\/api\.github\.com\/repos\/kusennjp1-ai\/screener\/actions\/runs\/([1-9]\d*)\/jobs\?/.exec(record.url ?? '');
      requireThat(match && positive(Number(match[1])), 'invalid-cache-route');
      const runId = Number(match[1]);
      validateURL(record.url, runId); links(record.link, runId);
      requireThat(!cacheURLs.has(record.url), 'duplicate-cache-page');
      cacheURLs.add(record.url);
      const run = runs.get(runId);
      if (!run || !reusable(run) || record.run_key !== runKey(run)) { evict(record.url); continue; }
      decodePageRecord(run, record, scope);
      cache.set(record.url, record);
    }
    async function read(run, url) {
      checkpoint();
      validateURL(url, run.id);
      if (lastStart !== null) {
        const spacing = L.startSpacingMs - (now() - lastStart);
        if (spacing > 0) {
          requireThat(now() + spacing < globalDeadline, 'worker-deadline');
          await Promise.race([pause(spacing), expired]);
          requireThat(now() - lastStart >= L.startSpacingMs, 'insufficient-request-start-spacing');
        }
      }
      checkpoint();
      requireThat(lastQuota === null || lastQuota.remaining > L.quotaReserve, 'route-quota-reserve');
      const requestStarted = now();
      lastStart = requestStarted;
      const prior = reusable(run) ? cache.get(url) : null;
      const observation = {
        run_id: run.id, run_key: runKey(run), url, method: 'GET', authenticated: true,
        conditional: Boolean(prior), started_ms: requestStarted - started,
        elapsed_ms: null, status: null, etag_sent: prior?.etag ?? null, etag_received: null,
        received_body_bytes: 0, representation_body_bytes: 0, body_sha256: null,
        vary: null, vary_raw: null, vary_sha256: null, quota: null, request_id: null,
        retry_after_present: false, retry_after_seconds: null, content_encoding: null, content_length: null, page_validated: false, page_revalidated: false,
        cacheable: reusable(run) ? null : false,
        cancellations_requested: 0, cancellations_completed: 0, cleanup_failures: 0,
      };
      requireThat(stats.requests < L.runs * L.pagesPerRun, 'request-count-cap');
      const controller = new AbortController();
      let requestTimer, response, handled = false, requestExpired = false;
      const remaining = Math.min(L.requestMs, globalDeadline - now());
      requireThat(remaining > 0 && !globalExpired, 'worker-deadline');
      const requestExpiry = new Promise((_resolve, reject) => {
        requestTimer = setTimeout(() => {
          requestExpired = true; controller.abort(); reject(new JobsFault('request-deadline'));
        }, remaining);
      });
      requestExpiry.catch(() => {});
      const within = promise => Promise.race([promise, requestExpiry, expired]);
      const cancel = async operation => {
        stats.cancellations_requested++; observation.cancellations_requested++;
        try { await within(operation()); stats.cancellations_completed++; observation.cancellations_completed++; }
        catch { stats.cleanup_failures++; observation.cleanup_failures++; }
      };
      try {
        const headers = {
          ...REQUEST_REPRESENTATION.headers,
          authorization: 'Bearer ' + token,
          ...(prior ? { 'if-none-match': prior.etag } : {}),
        };
        observations.push(observation); stats.requests++;
        response = await within(fetcher(url, {
          method: 'GET', headers, redirect: 'error', signal: controller.signal,
        }));
        requireThat(response && response.redirected === false && response.url === url &&
          Number.isInteger(response.status) && response.headers?.get, 'response-route-security');
        observation.status = response.status;
        const retryAfter = response.headers.get('retry-after');
        observation.retry_after_present = retryAfter !== null;
        if (typeof retryAfter === 'string' && /^\d{1,16}$/.test(retryAfter) &&
            Number.isSafeInteger(Number(retryAfter))) observation.retry_after_seconds = Number(retryAfter);
        const requestId = response.headers.get('x-github-request-id');
        if (requestId !== null) {
          requireThat(typeof requestId === 'string' && /^[A-Za-z0-9:-]{1,128}$/.test(requestId), 'invalid-route-request-id');
          observation.request_id = requestId;
        }
        requireThat(response.status === 200 || response.status === 304,
          [401, 403, 429].includes(response.status) ? 'http-or-security-denial' : 'unexpected-jobs-http-status');
        observation.quota = quota(response.headers);
        lastQuota = observation.quota;
        requireThat(lastQuota.remaining >= L.quotaReserve, 'route-quota-reserve');
        requireThat(!observation.retry_after_present, 'retry-after-denial');
        const tag = response.headers.get('etag');
        opaqueTag(tag, response.status === 200);
        observation.etag_received = tag;
        observation.cacheable = reusable(run) && tag !== null;
        const varyHeader = response.headers.get('vary');
        requireThat(varyHeader === null || typeof varyHeader === 'string' &&
          Buffer.byteLength(varyHeader, 'utf8') <= 2048, 'invalid-vary');
        observation.vary_raw = varyHeader;
        observation.vary_sha256 = varyHeader === null ? null : sha256(Buffer.from(varyHeader, 'utf8'));
        const vary = response.status === 304 && varyHeader === null ? prior?.vary : parseVary(varyHeader);
        validateVary(vary);
        observation.vary = vary;
        const contentType = response.headers.get('content-type');
        requireThat((response.status === 304 && contentType === null) ||
          (typeof contentType === 'string' && /^application\/(?:json|vnd\.github\+json)(?:;\s*charset=utf-8)?$/i.test(contentType)), 'unexpected-jobs-content-type');
        const encoding = response.headers.get('content-encoding');
        observation.content_encoding = encoding;
        const contentLength = response.headers.get('content-length');
        requireThat(contentLength === null || /^\d{1,16}$/.test(contentLength) &&
          Number.isSafeInteger(Number(contentLength)), 'invalid-jobs-content-length');
        observation.content_length = contentLength;
        requireThat(encoding === null || encoding === 'gzip' || encoding === 'identity', 'unexpected-jobs-content-encoding');
        handled = true;
        const chunks = [];
        let length = 0, complete = false;
        if (response.body !== null) {
          requireThat(response.body && typeof response.body.getReader === 'function', 'invalid-response-body');
          const reader = response.body.getReader();
          try {
            for (;;) {
              const part = await within(reader.read());
              requireThat(part && typeof part.done === 'boolean', 'invalid-response-body');
              if (part.done) { complete = true; break; }
              requireThat(part.value instanceof Uint8Array, 'invalid-response-body-chunk');
              length += part.value.byteLength;
              stats.received_body_bytes += part.value.byteLength;
              observation.received_body_bytes = length;
              requireThat(length <= L.pageBytes && stats.received_body_bytes <= L.aggregateBytes, 'jobs-body-byte-cap');
              chunks.push(Buffer.from(part.value));
            }
          } finally {
            if (!complete) await cancel(() => reader.cancel());
            try { reader.releaseLock(); } catch { stats.cleanup_failures++; observation.cleanup_failures++; requireThat(!complete, 'response-body-cleanup'); }
          }
        }
        const bytes = Buffer.concat(chunks, length);
        let record;
        if (response.status === 304) {
          requireThat(prior && length === 0 && opaqueTag(tag) === opaqueTag(prior.etag), 'unmatched-jobs-304');
          requireThat(canonical(vary) === canonical(prior.vary), 'changed-304-vary');
          const linkHeader = response.headers.get('link');
          record = {
            ...prior, etag: tag, vary,
            link: linkHeader === null ? prior.link : linkHeader,
          };
          stats.revalidated_304++; stats.revalidated_body_bytes += prior.body_bytes;
        } else {
          requireThat(length > 0, 'empty-jobs-200');
          record = {
            schema_version: PAGE_SCHEMA, scope, run_key: runKey(run), url, etag: tag,
            body_base64: bytes.toString('base64'), body_bytes: bytes.length,
            body_sha256: sha256(bytes), link: response.headers.get('link') ?? '', vary,
            representation: REQUEST_REPRESENTATION,
          };
          stats.fresh_200++;
          if (prior) stats.conditional_200++;
          if (!reusable(run) || tag === null) stats.uncached_200++;
        }
        const decoded = decodePageRecord(run, record, scope);
        requireThat(now() - requestStarted <= L.requestMs && !requestExpired, 'request-deadline');
        checkpoint();
        totalAccepted += record.body_bytes;
        requireThat(totalAccepted <= L.aggregateBytes, 'aggregate-jobs-representation-cap');
        stats.accepted_body_bytes += record.body_bytes;
        observation.representation_body_bytes = record.body_bytes;
        observation.body_sha256 = record.body_sha256;
        observation.page_validated = true;
        observation.page_revalidated = response.status === 304;
        observation.elapsed_ms = now() - requestStarted;
        checkpoint();
        return { record, decoded };
      } catch (error) {
        controller.abort();
        throw error instanceof JobsFault ? error :
          new JobsFault(globalExpired ? 'worker-deadline' : requestExpired ? 'request-deadline' : 'jobs-transport-failure');
      } finally {
        if (response && !handled && response.body && typeof response.body.cancel === 'function') {
          await cancel(() => response.body.cancel());
        }
        clearTimeout(requestTimer);
        observation.elapsed_ms = observation.elapsed_ms ?? Math.max(0, now() - requestStarted);
      }
    }
    for (const run of config.runs) {
      const pages = [];
      let url = pageURL(run.id);
      while (url !== null) {
        requireThat(pages.length < L.pagesPerRun, 'jobs-page-cap');
        const { record, decoded } = await read(run, url);
        pages.push(record); url = decoded.next_url;
      }
      const accepted = validateJobsPages(run, pages, scope);
      results.push({ run_id: run.id, pages, jobs: accepted.jobs });
      if (reusable(run)) for (const record of pages) {
        if (record.etag === null) continue;
        const size = Buffer.byteLength(JSON.stringify(record), 'utf8') + 1;
        outputCache.push(record); outputCacheBytes += size;
        while (outputCacheBytes > L.cacheBytes && outputCache.length) {
          const removed = outputCache.shift();
          outputCacheBytes -= Buffer.byteLength(JSON.stringify(removed), 'utf8') + 1;
          evict(removed.url);
        }
      }
      checkpoint();
    }
    const keptURLs = new Set(outputCache.map(record => record.url));
    for (const url of cache.keys()) if (!keptURLs.has(url)) evict(url);
    recount();
    const result = { schema_version: SCHEMA, status: 'complete', jobs: results,
      cache: outputCache, observations, body_bytes: stats.received_body_bytes, stats };
    requireThat(Buffer.byteLength(JSON.stringify(result), 'utf8') + 1 <= L.stdioBytes, 'worker-output-cap');
    checkpoint();
    return result;
  } catch (error) {
    recount();
    return failed(error instanceof JobsFault ? error.code : 'worker-internal-or-transport-failure', observations, stats);
  } finally { clearTimeout(timer); }
}
async function runCli() {
  let output;
  try {
    requireThat(process.argv.length === 2, 'unexpected-worker-arguments');
    const chunks = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      requireThat(length <= L.stdioBytes, 'worker-input-cap');
      chunks.push(Buffer.from(chunk));
    }
    let config;
    try { config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length))); }
    catch { throw new JobsFault('invalid-worker-json'); }
    output = await readConditionalDeploymentJobs(config);
  } catch (error) {
    output = failed(error instanceof JobsFault ? error.code : 'worker-cli-failure');
  }
  const json = JSON.stringify(output) + '\n';
  requireThat(Buffer.byteLength(json, 'utf8') <= L.stdioBytes, 'worker-output-cap');
  process.stdout.write(json);
  process.exitCode = output.status === 'complete' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(() => {
    process.stdout.write(JSON.stringify(failed('worker-cli-failure')) + '\n');
    process.exitCode = 1;
  });
}
