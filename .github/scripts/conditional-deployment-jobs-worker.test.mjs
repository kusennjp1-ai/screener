// All rows, IDs, tokens, names, and bodies below are synthetic transport
// fixtures. They prove no real publication and never relax the parent guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CONDITIONAL_DEPLOYMENT_JOB_LIMITS as LIMITS,
  REQUEST_REPRESENTATION,
  validateScope, runKey, decodePageRecord, validateJobsPages,
  readConditionalDeploymentJobs,
} from './conditional-deployment-jobs-worker.mjs';

const PRIVATE_TEST_TOKEN = 'synthetic-private-test-token';
const REPO = 'kusennjp1-ai/screener';
const REPO_ID = 1203919607;
const scope = {
  repository: REPO, repository_id: REPO_ID,
  run_id: 900, run_attempt: 1, controller_sha: 'b'.repeat(40),
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const route = (id, page = 1) => 'https://api.github.com/repos/' + REPO +
  '/actions/runs/' + id + '/jobs?filter=all&per_page=100' + (page === 1 ? '' : '&page=' + page);
function run(id = 11, changes = {}) {
  return {
    id, run_attempt: 1, head_sha: 'a'.repeat(40), head_branch: 'main',
    workflow_id: 294257497, path: '.github/workflows/static-site.yml',
    name: 'Synthetic static workflow', event: 'workflow_dispatch',
    repository: { id: REPO_ID, full_name: REPO },
    head_repository: { id: REPO_ID, full_name: REPO },
    status: 'completed', conclusion: 'success',
    created_at: '2026-10-09T01:00:00Z', run_started_at: '2026-10-09T01:00:00Z',
    updated_at: '2026-10-09T01:10:00Z', ...changes,
  };
}
function job(candidate, id = 101, changes = {}) {
  return {
    id, run_id: candidate.id, run_attempt: candidate.run_attempt,
    head_sha: candidate.head_sha, head_branch: candidate.head_branch,
    workflow_name: candidate.name, name: 'Synthetic job with no publication authority',
    run_url: 'https://api.github.com/repos/' + REPO + '/actions/runs/' + candidate.id,
    url: 'https://api.github.com/repos/' + REPO + '/actions/jobs/' + id,
    html_url: 'https://github.com/' + REPO + '/actions/runs/' + candidate.id + '/job/' + id,
    status: 'completed', conclusion: 'success',
    created_at: '2026-10-09T01:00:01Z', started_at: '2026-10-09T01:00:02Z',
    completed_at: '2026-10-09T01:00:05Z',
    steps: [{ number: 1, name: 'Synthetic step', status: 'completed', conclusion: 'success',
      started_at: '2026-10-09T01:00:03Z', completed_at: '2026-10-09T01:00:04Z' }],
    ...changes,
  };
}
const config = (runs, cache = [], changes = {}) => ({
  scope: clone(scope), runs, cache, excludedIds: [], timeoutMs: 120_000, ...changes,
});
const defaultVary = 'Accept, Authorization, Cookie, X-GitHub-OTP, Accept-Encoding, X-Requested-With';
function response(url, value, {
  status = 200, etag = 'W/"opaque-original"', vary = defaultVary,
  link = null, remaining = 14000, headers: extraHeaders = {}, redirected = false,
} = {}) {
  const headers = {
    'x-ratelimit-limit': '15000', 'x-ratelimit-remaining': String(remaining),
    'x-ratelimit-used': String(15000 - remaining), 'x-ratelimit-reset': '1791514800',
    'x-ratelimit-resource': 'core', 'x-github-request-id': 'UNIT:1234:ABCD',
    ...(status === 200 ? { 'content-type': 'application/json; charset=utf-8', 'content-encoding': 'gzip' } : {}),
    ...(etag === null ? {} : { etag }), ...(vary === null ? {} : { vary }),
    ...(link === null ? {} : { link }), ...extraHeaders,
  };
  for (const key of Object.keys(headers)) if (headers[key] === null) delete headers[key];
  // Native fetch already decoded gzip; these are the exact exposed JSON bytes.
  const body = status === 304 ? null : typeof value === 'string' ? value : JSON.stringify(value);
  const result = new Response(body, { status, headers });
  Object.defineProperty(result, 'url', { value: url });
  Object.defineProperty(result, 'redirected', { value: redirected });
  return result;
}
function harness(handler) {
  let clock = 0;
  const calls = [], pauses = [];
  return {
    calls, pauses,
    dependencies: {
      token: PRIVATE_TEST_TOKEN, monotonic: () => clock,
      pause: async ms => { pauses.push(ms); clock += ms; },
      fetcher: (url, init) => {
        calls.push({ url, init, clock });
        assert.equal(init.redirect, 'error');
        assert.equal(init.method, 'GET');
        assert.equal(init.headers.authorization, 'Bearer ' + PRIVATE_TEST_TOKEN);
        assert.equal(init.headers.accept, 'application/vnd.github+json');
        assert.equal(init.headers['x-github-api-version'], '2022-11-28');
        assert.equal(init.headers['accept-encoding'], 'gzip');
        assert.equal(init.headers['user-agent'], REQUEST_REPRESENTATION.headers['user-agent']);
        return handler(url, init, calls.length);
      },
    },
    advance(ms) { clock += ms; },
  };
}
function recount(result) {
  const observations = result.observations;
  assert.equal(result.stats.requests, observations.length);
  assert.equal(result.stats.fresh_200, observations.filter(value => value.status === 200).length);
  assert.equal(result.stats.conditional_200, observations.filter(value => value.status === 200 && value.conditional).length);
  assert.equal(result.stats.revalidated_304, observations.filter(value => value.page_revalidated).length);
  assert.equal(result.stats.uncached_200, observations.filter(value => value.status === 200 && value.cacheable === false).length);
  const sum = key => observations.reduce((total, value) => total + value[key], 0);
  assert.equal(result.stats.received_body_bytes, sum('received_body_bytes'));
  assert.equal(result.stats.accepted_body_bytes, sum('representation_body_bytes'));
  assert.equal(result.stats.cancellations_requested, sum('cancellations_requested'));
  assert.equal(result.stats.cancellations_completed, sum('cancellations_completed'));
  assert.equal(result.stats.cleanup_failures, sum('cleanup_failures'));
  assert.equal(result.body_bytes, result.stats.received_body_bytes);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(PRIVATE_TEST_TOKEN));
}
function failed(result, code) {
  assert.equal(result.status, 'failed');
  if (code) assert.equal(result.error_code, code);
  assert.deepEqual(result.jobs, []);
  assert.deepEqual(result.cache, []);
  recount(result);
}
async function cold(candidate = run(), rows = [job(candidate)]) {
  const h = harness(url => response(url, { total_count: rows.length, jobs: rows }));
  const result = await readConditionalDeploymentJobs(config([candidate]), h.dependencies);
  assert.equal(result.status, 'complete'); recount(result);
  return { h, result };
}
function pagination(id, page, last) {
  const parts = [];
  if (page < last) parts.push('<' + route(id, page + 1) + '>; rel="next"');
  if (page > 1) {
    parts.push('<' + route(id) + '&page=1>; rel="first"');
    parts.push('<' + route(id, page - 1) + (page === 2 ? '&page=1' : '') + '>; rel="prev"');
  }
  if (last > 1) parts.push('<' + route(id, last) + '>; rel="last"');
  return parts.join(', ');
}

test('cold authenticated 200 is byte-exact and independently reconstructable', async () => {
  const candidate = run();
  const { h, result } = await cold(candidate);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, route(candidate.id));
  assert.equal(h.calls[0].init.headers['if-none-match'], undefined);
  assert.equal(result.cache.length, 1);
  const page = result.jobs[0].pages[0];
  const bytes = Buffer.from(page.body_base64, 'base64');
  assert.equal(bytes.length, page.body_bytes);
  assert.equal(hash(bytes), page.body_sha256);
  assert.equal(page.run_key, runKey(candidate));
  assert.equal(page.etag, 'W/"opaque-original"');
  assert.deepEqual(page.representation, REQUEST_REPRESENTATION);
  assert.equal(decodePageRecord(candidate, page, scope).value.total_count, 1);
  assert.deepEqual(validateJobsPages(candidate, result.jobs[0].pages, scope),
    { total: 1, jobs: result.jobs[0].jobs });
  assert.equal(result.observations[0].quota.limit, 15000);
});

test('warm 304 accepts only the exact opaque tag, ignoring just syntactic W/', async () => {
  const candidate = run(), prior = await cold(candidate);
  const h = harness((url, init) => {
    assert.equal(init.headers['if-none-match'], 'W/"opaque-original"');
    return response(url, null, { status: 304, etag: '"opaque-original"', vary: null });
  });
  const result = await readConditionalDeploymentJobs(config([candidate], prior.result.cache), h.dependencies);
  assert.equal(result.status, 'complete'); recount(result);
  assert.deepEqual(result.jobs[0].jobs, prior.result.jobs[0].jobs);
  assert.equal(result.jobs[0].pages[0].body_base64, prior.result.jobs[0].pages[0].body_base64);
  assert.equal(result.body_bytes, 0);
  assert.equal(result.stats.revalidated_304, 1);
  assert.equal(result.stats.revalidated_body_bytes, prior.result.cache[0].body_bytes);
  assert.equal(result.cache[0].etag, '"opaque-original"');
});

test('conditional 200 with changed tag/identical bytes is fresh proof, not stale fallback', async () => {
  const candidate = run(), prior = await cold(candidate);
  const originalBytes = Buffer.from(prior.result.cache[0].body_base64, 'base64').toString('utf8');
  const h = harness(url => response(url, originalBytes, { etag: '"opaque-changed"' }));
  const result = await readConditionalDeploymentJobs(config([candidate], prior.result.cache), h.dependencies);
  assert.equal(result.status, 'complete'); recount(result);
  assert.equal(result.stats.conditional_200, 1);
  assert.equal(result.stats.revalidated_304, 0);
  assert.equal(result.cache[0].body_sha256, prior.result.cache[0].body_sha256);
  assert.equal(result.cache[0].etag, '"opaque-changed"');
  assert.equal(result.body_bytes > 0, true);
});

test('missing ETag permits uncached fresh 200 with no savings', async () => {
  const candidate = run();
  const h = harness(url => response(url, { total_count: 1, jobs: [job(candidate)] }, { etag: null }));
  const result = await readConditionalDeploymentJobs(config([candidate]), h.dependencies);
  assert.equal(result.status, 'complete'); recount(result);
  assert.equal(result.cache.length, 0);
  assert.equal(result.jobs[0].pages[0].etag, null);
  assert.equal(result.stats.uncached_200, 1);
  assert.equal(result.stats.revalidated_body_bytes, 0);
});

test('multi-page inventories grow/shrink using fresh closed Links and serial start spacing', async () => {
  const candidate = run();
  const rows = Array.from({ length: 102 }, (_unused, index) => job(candidate, 1000 + index));
  const snapshot = (total, url) => {
    const page = url.includes('&page=2') ? 2 : 1;
    return response(url, { total_count: total, jobs: rows.slice((page - 1) * 100, Math.min(page * 100, total)) },
      { etag: '"total-' + total + '-page-' + page + '"', link: pagination(candidate.id, page, Math.ceil(total / 100)) });
  };
  let h = harness(url => snapshot(101, url));
  const initial = await readConditionalDeploymentJobs(config([candidate]), h.dependencies);
  assert.equal(initial.status, 'complete'); recount(initial);
  assert.equal(initial.jobs[0].jobs.length, 101);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].clock - h.calls[0].clock >= 200, true);
  h = harness(url => snapshot(102, url));
  const grown = await readConditionalDeploymentJobs(config([candidate], initial.cache), h.dependencies);
  assert.equal(grown.status, 'complete'); recount(grown);
  assert.equal(grown.jobs[0].jobs.length, 102);
  assert.equal(grown.stats.conditional_200, 2);
  h = harness(url => snapshot(1, url));
  const shrunk = await readConditionalDeploymentJobs(config([candidate], grown.cache), h.dependencies);
  assert.equal(shrunk.status, 'complete'); recount(shrunk);
  assert.equal(shrunk.jobs[0].jobs.length, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(shrunk.cache.length, 1);
  assert.equal(shrunk.stats.cache_evictions, 1);
});

test('every additional cached page is freshly revalidated; omitted 304 Link metadata is merged', async () => {
  const candidate = run();
  const rows = Array.from({ length: 101 }, (_unused, index) => job(candidate, 2000 + index));
  let h = harness(url => {
    const page = url.includes('&page=2') ? 2 : 1;
    return response(url, { total_count: 101, jobs: rows.slice((page - 1) * 100, page * 100) },
      { etag: '"page-' + page + '"', link: pagination(candidate.id, page, 2) });
  });
  const initial = await readConditionalDeploymentJobs(config([candidate]), h.dependencies);
  assert.equal(initial.status, 'complete');
  h = harness((url, init) => response(url, null, { status: 304, etag: init.headers['if-none-match'], vary: null }));
  const result = await readConditionalDeploymentJobs(config([candidate], initial.cache), h.dependencies);
  assert.equal(result.status, 'complete'); recount(result);
  assert.equal(h.calls.length, 2);
  assert.equal(result.stats.revalidated_304, 2);
  assert.equal(result.body_bytes, 0);
  assert.equal(result.jobs[0].jobs.length, 101);
});

test('all old rerun attempts survive a newer failed attempt', async () => {
  const candidate = run(11, { run_attempt: 2, conclusion: 'failure', run_started_at: '2026-10-09T01:05:00Z' });
  const old = job(candidate, 101, { run_attempt: 1 });
  const newer = job(candidate, 102, {
    conclusion: 'failure', created_at: '2026-10-09T01:05:01Z',
    started_at: '2026-10-09T01:05:02Z', completed_at: '2026-10-09T01:05:05Z',
    steps: [{ number: 1, name: 'Synthetic failed step', status: 'completed', conclusion: 'failure',
      started_at: '2026-10-09T01:05:03Z', completed_at: '2026-10-09T01:05:04Z' }],
  });
  const { result } = await cold(candidate, [old, newer]);
  assert.deepEqual(result.jobs[0].jobs.map(value => [value.run_attempt, value.conclusion]),
    [[1, 'success'], [2, 'failure']]);
  assert.equal(result.cache.length, 1);
});

test('rerun fingerprint changes evict old records and force a fresh request', async () => {
  const prior = await cold();
  const candidate = run(11, { run_attempt: 2, updated_at: '2026-10-09T01:11:00Z' });
  assert.notEqual(runKey(candidate), runKey(run()));
  const h = harness((url, init) => {
    assert.equal(init.headers['if-none-match'], undefined);
    return response(url, { total_count: 1, jobs: [job(candidate)] });
  });
  const result = await readConditionalDeploymentJobs(config([candidate], prior.result.cache), h.dependencies);
  assert.equal(result.status, 'complete'); recount(result);
  assert.equal(result.stats.cache_evictions, 1);
});

test('own/critical/active runs are fresh 200 and never cached', async () => {
  for (const kind of ['own', 'critical', 'active']) {
    const candidate = run(kind === 'own' ? scope.run_id : 11, kind === 'active' ? {
      status: 'in_progress', conclusion: null,
    } : {});
    const row = job(candidate, 101, kind === 'active' ? {
      status: 'in_progress', conclusion: null, completed_at: null,
      steps: [{ number: 1, name: 'Synthetic active step', status: 'in_progress', conclusion: null,
        started_at: '2026-10-09T01:00:03Z', completed_at: null }],
    } : {});
    const h = harness((url, init) => {
      assert.equal(init.headers['if-none-match'], undefined);
      return response(url, { total_count: 1, jobs: [row] });
    });
    const result = await readConditionalDeploymentJobs(config([candidate], [], {
      excludedIds: kind === 'critical' ? [candidate.id] : [],
    }), h.dependencies);
    assert.equal(result.status, 'complete'); recount(result);
    assert.equal(result.cache.length, 0);
    assert.equal(result.jobs[0].pages.length, 1);
    assert.equal(result.stats.uncached_200, 1);
  }
});

test('cancelled zero-job inventory and skipped/cancelled null steps remain valid', async () => {
  const cancelled = run(11, { conclusion: 'cancelled' });
  const empty = await cold(cancelled, []);
  assert.deepEqual(validateJobsPages(cancelled, empty.result.jobs[0].pages, scope), { total: 0, jobs: [] });
  for (const conclusion of ['skipped', 'cancelled']) {
    const candidate = run(11, { conclusion });
    const row = job(candidate, 101, { conclusion, steps: null, started_at: null, completed_at: null });
    const { result } = await cold(candidate, [row]);
    assert.equal(result.jobs[0].jobs[0].steps, null);
  }
  const candidate = run(11, { run_attempt: 3, conclusion: 'cancelled' });
  const { result } = await cold(candidate, [job(candidate, 101, { run_attempt: 1 })]);
  assert.equal(result.jobs[0].jobs.length, 1);
});

test('queued active shapes may have no started clock or steps and remain uncached', async () => {
  const candidate = run(11, { status: 'queued', conclusion: null, run_started_at: null });
  const row = job(candidate, 101, {
    status: 'queued', conclusion: null, started_at: null, completed_at: null, steps: null,
  });
  const { result } = await cold(candidate, [row]);
  assert.equal(result.cache.length, 0);
  assert.equal(result.jobs[0].jobs[0].status, 'queued');
  const empty = await cold(candidate, []);
  assert.equal(empty.result.jobs[0].jobs.length, 0);
});

test('invalid caches fail before any request; raw hash/base64/scope/representation/tag bindings are checked', async () => {
  const prior = await cold(), candidate = run();
  const mutations = [
    page => { page.body_sha256 = '0'.repeat(64); },
    page => { page.body_bytes++; },
    page => { page.body_base64 = '%%%%'; },
    page => { page.scope.controller_sha = 'c'.repeat(40); },
    page => { page.representation.headers.accept = 'text/plain'; },
    page => { page.vary = ['unknown']; },
    page => { page.etag = 'opaque-unquoted'; },
    page => { page.privateToken = PRIVATE_TEST_TOKEN; },
  ];
  for (const mutate of mutations) {
    const pages = clone(prior.result.cache); mutate(pages[0]);
    const h = harness(() => { throw new Error('Must never fetch invalid cache'); });
    const result = await readConditionalDeploymentJobs(config([candidate], pages), h.dependencies);
    failed(result);
    assert.equal(h.calls.length, 0);
  }
});

test('304 without cache, missing/changed opaque tag or changed Vary is terminal', async () => {
  const prior = await cold(), candidate = run();
  for (const { cache, etag, vary } of [
    { cache: [], etag: '"opaque-original"', vary: defaultVary },
    { cache: prior.result.cache, etag: null, vary: defaultVary },
    { cache: prior.result.cache, etag: '"OPAQUE-original"', vary: defaultVary },
    { cache: prior.result.cache, etag: 'W/"opaque-distinct"', vary: defaultVary },
    { cache: prior.result.cache, etag: '"opaque-original"', vary: 'Accept' },
  ]) {
    const h = harness(url => response(url, null, { status: 304, etag, vary }));
    const result = await readConditionalDeploymentJobs(config([candidate], cache), h.dependencies);
    failed(result);
    assert.equal(h.calls.length, 1);
    assert.equal(result.stats.revalidated_304, 0);
  }
});

test('malformed 200 ETag and unknown/wildcard Vary reject with no accepted cache or retry', async () => {
  const candidate = run();
  for (const options of [{ etag: 'w/"opaque"' }, { etag: '"one", "two"' },
    { vary: '*' }, { vary: 'Accept-Language' }]) {
    const h = harness(url => response(url, { total_count: 1, jobs: [job(candidate)] }, options));
    const result = await readConditionalDeploymentJobs(config([candidate]), h.dependencies);
    failed(result);
    assert.equal(h.calls.length, 1);
  }
});

test('literal observed duplicate Vary header binds its canonical set and preserves raw/hash evidence', async () => {
  const candidate = run();
  const observed = 'Accept,Authorization,Cookie,X-GitHub-OTP,Accept-Encoding,Accept,X-Requested-With';
  let h = harness(url => response(url, { total_count: 1, jobs: [job(candidate)] }, { vary: observed }));
  const initial = await readConditionalDeploymentJobs(config([candidate]), h.dependencies);
  assert.equal(initial.status, 'complete'); recount(initial);
  assert.equal(initial.observations[0].vary_raw, observed);
  assert.equal(initial.observations[0].vary_sha256, hash(Buffer.from(observed)));
  assert.deepEqual(initial.jobs[0].pages[0].vary,
    ['accept', 'accept-encoding', 'authorization', 'cookie', 'x-github-otp', 'x-requested-with']);
  h = harness(url => response(url, null, {
    status: 304, etag: '"opaque-original"',
    vary: 'accept,AUTHORIZATION,cookie,X-GitHub-OTP,Accept-Encoding,Accept,X-Requested-With',
  }));
  const warm = await readConditionalDeploymentJobs(config([candidate], initial.cache), h.dependencies);
  assert.equal(warm.status, 'complete'); recount(warm);
  assert.equal(warm.stats.revalidated_304, 1);
  assert.deepEqual(warm.jobs[0].pages[0].vary, initial.jobs[0].pages[0].vary);
  for (const vary of [observed + ',Unknown-Dimension', observed + ',*']) {
    const invalid = harness(url => response(url, { total_count: 1, jobs: [job(candidate)] }, { vary }));
    const result = await readConditionalDeploymentJobs(config([candidate]), invalid.dependencies);
    failed(result, 'unbound-vary');
    assert.equal(invalid.calls.length, 1);
  }
});

test('Retry-After presence on200/304 is terminal before following a page or using cache', async () => {
  const candidate = run(), prior = await cold(candidate);
  const rows = Array.from({ length: 100 }, (_unused, index) => job(candidate, 7000 + index));
  for (const status of [200, 304]) for (const retryAfter of ['15', '0', 'Fri, 09 Oct 2026 03:45:00 GMT']) {
    const h = harness(url => response(url,
      status === 200 ? { total_count: 101, jobs: rows } : null, {
        status, etag: status === 304 ? '"opaque-original"' : 'W/"opaque-original"',
        link: status === 200 ? pagination(candidate.id, 1, 2) : null,
        headers: { 'retry-after': retryAfter },
      }));
    const result = await readConditionalDeploymentJobs(config([candidate],
      status === 304 ? prior.result.cache : []), h.dependencies);
    failed(result, 'retry-after-denial');
    assert.equal(h.calls.length, 1);
    assert.equal(result.observations[0].retry_after_present, true);
    assert.equal(result.observations[0].retry_after_seconds,
      /^\d+$/.test(retryAfter) ? Number(retryAfter) : null);
    assert.equal(result.observations[0].page_validated, false);
    assert.equal(result.stats.revalidated_304, 0);
    assert.equal(result.body_bytes, 0);
  }
});

test('closed Link protocol rejects foreign hosts/runs, filter drift, duplicates and missing next', async () => {
  const candidate = run();
  const rows = Array.from({ length: 100 }, (_unused, index) => job(candidate, 3000 + index));
  for (const link of [
    '<https://evil.invalid/next>; rel="next"',
    '<' + route(12, 2) + '>; rel="next"',
    '<' + route(candidate.id, 2).replace('filter=all', 'filter=latest') + '>; rel="next"',
    '<' + route(candidate.id, 2) + '>; rel="next", <' + route(candidate.id, 2) + '>; rel="next"',
    '',
  ]) {
    const h = harness(url => response(url, { total_count: 101, jobs: rows }, { link }));
    const result = await readConditionalDeploymentJobs(config([candidate]), h.dependencies);
    failed(result);
    assert.equal(h.calls.length, 1);
  }
});

test('partial pages, changing totals, duplicate IDs and terminal running steps reject', async () => {
  const candidate = run();
  const wrongJobs = [
    [],
    [job(candidate), job(candidate)],
    [job(candidate, 101, { run_id: 12 })],
    [job(candidate, 101, { head_sha: 'd'.repeat(40) })],
    [job(candidate, 101, { run_attempt: 2 })],
    [job(candidate, 101, { started_at: '2026-10-09T02:00:00Z' })],
    [job(candidate, 101, { steps: [{ number: 1, name: 'Synthetic running step',
      status: 'in_progress', conclusion: null, started_at: '2026-10-09T01:00:03Z', completed_at: null }] })],
    [job(candidate, 101, { steps: null })],
  ];
  for (const rows of wrongJobs) {
    const h = harness(url => response(url, { total_count: rows.length || 1, jobs: rows }));
    failed(await readConditionalDeploymentJobs(config([candidate]), h.dependencies));
    assert.equal(h.calls.length, 1);
  }
  const rows = Array.from({ length: 101 }, (_unused, index) => job(candidate, 4000 + index));
  for (const mode of ['duplicate', 'drift']) {
    const h = harness((url, _init, count) => response(url,
      count === 1 ? { total_count: 101, jobs: rows.slice(0, 100) } :
        { total_count: mode === 'drift' ? 102 : 101, jobs: mode === 'drift' ? rows.slice(99) : [rows[0]] },
      { link: pagination(candidate.id, count, 2) }));
    failed(await readConditionalDeploymentJobs(config([candidate]), h.dependencies));
    assert.equal(h.calls.length, 2);
  }
});

test('every HTTP/security/transport failure is terminal with no stale fallback', async () => {
  const candidate = run(), prior = await cold(candidate);
  for (const status of [301, 401, 403, 404, 429, 500]) {
    const h = harness(url => response(url, '{}', { status }));
    const result = await readConditionalDeploymentJobs(config([candidate], prior.result.cache), h.dependencies);
    failed(result);
    assert.equal(h.calls.length, 1);
    assert.equal(result.stats.revalidated_304, 0);
  }
  const h = harness(() => { throw new Error('Transport failure containing ' + PRIVATE_TEST_TOKEN); });
  const result = await readConditionalDeploymentJobs(config([candidate], prior.result.cache), h.dependencies);
  failed(result, 'jobs-transport-failure');
  assert.equal(result.observations[0].status, null);
});

test('response route security rejects redirects/foreign destinations and closes body', async () => {
  const candidate = run();
  for (const foreign of [true, false]) {
    const h = harness(url => response(foreign ? 'https://evil.invalid/leak' : url,
      { total_count: 1, jobs: [job(candidate)] }, { redirected: !foreign }));
    const result = await readConditionalDeploymentJobs(config([candidate]), h.dependencies);
    failed(result, 'response-route-security');
    assert.equal(result.stats.cancellations_requested, 1);
    assert.equal(result.stats.cancellations_completed, 1);
  }
});

test('actual route quota governs reserve; no request follows a remaining reserve of100', async () => {
  const first = run(11), second = run(12);
  for (const remaining of [99, 100]) {
    const h = harness(url => response(url, { total_count: 1, jobs: [job(first)] }, { remaining }));
    const result = await readConditionalDeploymentJobs(config([first, second]), h.dependencies);
    failed(result, 'route-quota-reserve');
    assert.equal(h.calls.length, 1);
    assert.equal(result.observations[0].quota?.remaining ?? remaining, remaining);
  }
  const h = harness(url => response(url, { total_count: 1, jobs: [job(first)] },
    { headers: { 'x-ratelimit-remaining': null } }));
  failed(await readConditionalDeploymentJobs(config([first]), h.dependencies), 'missing-or-invalid-route-quota');
});

test('per-page stream cap cancels/release-locks once without reading or retrying more', async () => {
  const candidate = run();
  let reads = 0, cancellations = 0, releases = 0;
  const h = harness(url => {
    const result = response(url, '{}');
    Object.defineProperty(result, 'body', { value: {
      getReader() {
        return {
          read: async () => { reads++; return { done: false, value: new Uint8Array(LIMITS.pageBytes + 1) }; },
          cancel: async () => { cancellations++; },
          releaseLock: () => { releases++; },
        };
      },
    } });
    return result;
  });
  const result = await readConditionalDeploymentJobs(config([candidate]), h.dependencies);
  failed(result, 'jobs-body-byte-cap');
  assert.equal(reads, 1);
  assert.equal(cancellations, 1);
  assert.equal(releases, 1);
  assert.equal(result.stats.cancellations_completed, 1);
});

test('serialized cache eviction is safe; exact whitespace bytes remain reconstructable', async () => {
  const candidates = Array.from({ length: 4 }, (_unused, index) => run(20 + index));
  const h = harness(url => {
    const candidate = candidates.find(value => route(value.id) === url);
    const json = JSON.stringify({ total_count: 1, jobs: [job(candidate, 5000 + candidate.id)] });
    const padded = json + ' '.repeat(6 * 1024 * 1024 - Buffer.byteLength(json));
    return response(url, padded);
  });
  const result = await readConditionalDeploymentJobs(config(candidates), h.dependencies);
  assert.equal(result.status, 'complete'); recount(result);
  assert.equal(result.jobs.length, 4);
  assert.equal(result.cache.length, 3);
  assert.equal(result.stats.cache_evictions, 1);
  assert.equal(Buffer.byteLength(JSON.stringify(result.cache)) <= LIMITS.cacheBytes, true);
  for (let index = 0; index < candidates.length; index++) {
    const page = result.jobs[index].pages[0];
    assert.equal(page.body_bytes, 6 * 1024 * 1024);
    assert.equal(Buffer.from(page.body_base64, 'base64').at(-1), 32);
    assert.deepEqual(validateJobsPages(candidates[index], result.jobs[index].pages, scope).jobs,
      result.jobs[index].jobs);
  }
});

test('aggregate/output/input byte caps are terminal and never return an accepted prefix', async () => {
  for (const { count, bytes, expected } of [
    { count: 9, bytes: LIMITS.pageBytes, expected: 'jobs-body-byte-cap' },
    { count: 5, bytes: 6 * 1024 * 1024, expected: 'worker-output-cap' },
  ]) {
    const candidates = Array.from({ length: count }, (_unused, index) => run(30 + index));
    const h = harness(url => {
      const candidate = candidates.find(value => route(value.id) === url);
      const json = JSON.stringify({ total_count: 1, jobs: [job(candidate, 6000 + candidate.id)] });
      return response(url, json + ' '.repeat(bytes - Buffer.byteLength(json)));
    });
    const result = await readConditionalDeploymentJobs(config(candidates), h.dependencies);
    failed(result, expected);
    assert.equal(h.calls.length, count);
  }
  const h = harness(() => { throw new Error('Oversized input must not fetch'); });
  const candidate = run();
  candidate.syntheticUnusedMetadata = 'x'.repeat(LIMITS.stdioBytes);
  const result = await readConditionalDeploymentJobs(config([candidate]), h.dependencies);
  failed(result, 'worker-input-or-cache-cap');
  assert.equal(h.calls.length, 0);
});

test('native deadline aborts a stuck request once; late rejection cannot leak private text', async () => {
  const candidate = run();
  let rejectNative, signal;
  const native = new Promise((_resolve, reject) => { rejectNative = reject; });
  const h = harness((_url, init) => { signal = init.signal; return native; });
  const result = await readConditionalDeploymentJobs(config([candidate], [], { timeoutMs: 20 }), h.dependencies);
  failed(result);
  assert.equal(['worker-deadline', 'request-deadline'].includes(result.error_code), true);
  assert.equal(h.calls.length, 1);
  assert.equal(signal.aborted, true);
  rejectNative(new Error(PRIVATE_TEST_TOKEN));
  await new Promise(resolve => setImmediate(resolve));
  recount(result);
});

test('pure bridge revalidation rejects wrong current scope, corrupt body and route chain', async () => {
  const candidate = run(), { result } = await cold(candidate);
  const pages = result.jobs[0].pages;
  assert.throws(() => validateJobsPages(candidate, pages, { ...scope, run_id: 901 }), /page-scope-mismatch/);
  assert.deepEqual(validateJobsPages(candidate, pages, scope), { total: 1, jobs: result.jobs[0].jobs });
  const corrupt = clone(pages);
  corrupt[0].body_sha256 = '0'.repeat(64);
  assert.throws(() => validateJobsPages(candidate, corrupt, scope), /page-body-integrity/);
  const incorrectRoute = clone(pages);
  incorrectRoute[0].url += '&page=1';
  assert.throws(() => validateJobsPages(candidate, incorrectRoute, scope), /nonliteral-first-jobs-route/);
  const stale = clone(pages);
  stale[0].run_key = '0'.repeat(64);
  assert.throws(() => validateJobsPages(candidate, stale, scope), /stale-run-fingerprint/);
});

test('closed config, run/input/cache bounds, and private-token source reject before fetch', async () => {
  const h = harness(() => { throw new Error('Must not fetch invalid input'); });
  const invalid = [
    config([run()], [], { token: PRIVATE_TEST_TOKEN }),
    config([run(), run()]),
    config(Array.from({ length: LIMITS.runs + 1 }, (_unused, index) => run(10000 + index))),
    config([run()], [], { timeoutMs: LIMITS.deadlineMs + 1 }),
    config([run()], [], { excludedIds: [1, 1] }),
    config([run()], [{ body_base64: 'x'.repeat(LIMITS.cacheBytes) }]),
  ];
  for (const value of invalid) failed(await readConditionalDeploymentJobs(value, h.dependencies));
  assert.equal(h.calls.length, 0);
  const result = await readConditionalDeploymentJobs(config([run()]), { ...h.dependencies, token: '' });
  failed(result, 'missing-or-invalid-private-token');
  assert.equal(h.calls.length, 0);
  assert.equal(LIMITS.pageBytes, 8 * 1024 * 1024);
  assert.equal(LIMITS.cacheBytes, 32 * 1024 * 1024);
  assert.equal(LIMITS.stdioBytes, 64 * 1024 * 1024);
});

test('CLI emits one bounded JSON result and accepts no private token through stdin', () => {
  const path = fileURLToPath(new URL('./conditional-deployment-jobs-worker.mjs', import.meta.url));
  for (const input of ['not-json', JSON.stringify(config([run()], [], { token: PRIVATE_TEST_TOKEN }))]) {
    const child = spawnSync(process.execPath, [path], {
      input, encoding: 'utf8', env: { ...process.env, GH_TOKEN: '' },
      timeout: 5000, maxBuffer: 1024 * 1024,
    });
    assert.equal(child.status, 1);
    assert.equal(child.stderr, '');
    const output = JSON.parse(child.stdout);
    failed(output);
    assert.equal(child.stdout.trim().split('\n').length, 1);
    assert.doesNotMatch(child.stdout, new RegExp(PRIVATE_TEST_TOKEN));
  }
});


// Only these public clock/status shapes are reproduced; all row identities
// below remain synthetic fixtures and prove no real publication authority.
function emptySkippedClockFixture(runChanges = {}) {
  const candidate = run(11, {
    created_at: '2026-10-09T02:59:56Z', run_started_at: '2026-10-09T02:59:56Z',
    updated_at: '2026-10-09T07:30:51Z', ...runChanges,
  });
  const executed = (id, name, created, started, completed, step) => job(candidate, id, {
    name, created_at: created, started_at: started, completed_at: completed,
    steps: [{ number: 1, status: 'completed', conclusion: 'success', ...step }],
  });
  const rows = [
    executed(101, 'Synthetic successful deploy', '2026-10-09T03:00:00Z', '2026-10-09T03:00:01Z',
      '2026-10-09T07:30:20Z', { name: 'Deploy to GitHub Pages',
        started_at: '2026-10-09T07:30:10Z', completed_at: '2026-10-09T07:30:15Z' }),
    executed(102, 'Synthetic release metadata', '2026-10-09T07:30:21Z', '2026-10-09T07:30:22Z',
      '2026-10-09T07:30:35Z', { name: 'Record synthetic receipt',
        started_at: '2026-10-09T07:30:24Z', completed_at: '2026-10-09T07:30:30Z' }),
    executed(103, 'Synthetic provenance', '2026-10-09T07:30:36Z', '2026-10-09T07:30:36Z',
      '2026-10-09T07:30:49Z', { name: 'Record synthetic provenance',
        started_at: '2026-10-09T07:30:40Z', completed_at: '2026-10-09T07:30:45Z' }),
    ...[104, 105].map(id => job(candidate, id, {
      name: id === 104 ? 'promote-daily-source' : 'Synthetic second empty skipped job',
      status: 'completed', conclusion: 'skipped', steps: [],
      created_at: '2026-10-09T07:30:51Z', started_at: '2026-10-09T07:30:51Z',
      completed_at: '2026-10-09T07:30:50Z',
    })),
  ];
  return { candidate, rows };
}

test('terminal empty skipped metadata retains complete membership, raw clocks/cache bytes and real deployment selection', async () => {
  const { candidate, rows } = emptySkippedClockFixture(), { result } = await cold(candidate, rows);
  const entry = result.jobs[0], page = entry.pages[0], expectedBytes = Buffer.from(JSON.stringify({ total_count: 5, jobs: rows }));
  assert.equal(entry.jobs.length, 5); assert.deepEqual(entry.jobs, rows);
  assert.equal(result.cache.length, 1); assert.deepEqual(result.cache[0], page);
  assert.equal(Buffer.from(page.body_base64, 'base64').equals(expectedBytes), true);
  assert.equal(page.body_bytes, expectedBytes.length); assert.equal(page.body_sha256, hash(expectedBytes));
  for (const row of entry.jobs.slice(3)) {
    assert.equal(row.created_at, '2026-10-09T07:30:51Z');
    assert.equal(row.started_at, '2026-10-09T07:30:51Z');
    assert.equal(row.completed_at, '2026-10-09T07:30:50Z');
    assert.deepEqual(row.steps, []);
  }
  assert.deepEqual(validateJobsPages(candidate, entry.pages, scope), { total: 5, jobs: rows });
  const warm = harness(url => response(url, null, { status: 304, etag: '"opaque-original"', vary: null }));
  const revalidated = await readConditionalDeploymentJobs(config([candidate], result.cache), warm.dependencies);
  assert.equal(revalidated.status, 'complete'); recount(revalidated);
  assert.deepEqual(revalidated.jobs[0].jobs, rows);
  assert.equal(revalidated.cache[0].body_base64, page.body_base64);
  assert.equal(revalidated.cache[0].body_sha256, page.body_sha256);

  // Exercise the existing consumer with the complete retained rows. Empty
  // skipped metadata contributes no step; the unchanged successful-deploy
  // predicate still selects the successful companion job.
  const { latestDeployment } = await import('./publication-state.mjs');
  const apiCalls = [], api = (endpoint, paginate = false) => {
    apiCalls.push({ endpoint, paginate });
    if (endpoint === 'repos/' + REPO + '/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100') return [{ workflow_runs: [] }];
    if (endpoint === 'repos/' + REPO + '/actions/workflows/static-site.yml/runs?branch=main&per_page=100') return [{ workflow_runs: [candidate] }];
    if (endpoint === 'repos/' + REPO + '/actions/runs/' + candidate.id + '/jobs?filter=all&per_page=100') return [{ jobs: entry.jobs }];
    throw Error('Unexpected synthetic deployment consumer route');
  };
  assert.deepEqual(latestDeployment(REPO, api), {
    runId: candidate.id, attempt: 1, completed: Date.parse('2026-10-09T07:30:15Z'),
    started: Date.parse('2026-10-09T07:30:10Z'), jobStarted: Date.parse('2026-10-09T03:00:01Z'),
    headSha: candidate.head_sha, runAttempt: 1, runStarted: Date.parse(candidate.run_started_at),
  });
  assert.equal(apiCalls.length, 3);
  assert.equal(apiCalls.every(value => value.paginate), true);
});

test('empty skipped metadata exception rejects adjacent execution/shape/lower-bound/UTC/terminal-bound changes', async () => {
  const mutations = [
    ['executed backwards', rows => { rows[0].started_at = '2026-10-09T07:30:19Z'; rows[0].completed_at = '2026-10-09T07:30:18Z'; }],
    ['successful empty backwards', rows => { rows[3].conclusion = 'success'; }],
    // Empty cancelled metadata now shares the closed non-success boundary.
    // Keep explicit nonempty/null/missing counterexamples rather than delete it.
    ['cancelled nonempty backwards', rows => { rows[3].conclusion = 'cancelled'; rows[3].steps = [{ number: 1,
      name: 'Cancelled placeholder', status: 'completed', conclusion: 'cancelled', started_at: null, completed_at: null }]; }],
    ['cancelled null steps backwards', rows => { rows[3].conclusion = 'cancelled'; rows[3].steps = null; }],
    ['cancelled missing steps backwards', rows => { rows[3].conclusion = 'cancelled'; delete rows[3].steps; }],
    ['skipped nonempty backwards', rows => { rows[3].steps = [{ number: 1, name: 'Skipped placeholder', status: 'completed',
      conclusion: 'skipped', started_at: null, completed_at: null }]; }],
    ['skipped null steps backwards', rows => { rows[3].steps = null; }],
    ['skipped missing steps backwards', rows => { delete rows[3].steps; }],
    ['completion before run', rows => { rows[3].completed_at = '2026-10-09T02:59:55Z'; }],
    ['start before creation', rows => { rows[3].started_at = '2026-10-09T07:30:50Z'; }],
    ['malformed completion', rows => { rows[3].completed_at = 'not-a-UTC-clock'; }],
    ['non-UTC completion', rows => { rows[3].completed_at = '2026-10-09T07:30:50'; }],
    ['terminal completion after run', rows => { rows[3].completed_at = '2026-10-09T07:30:52Z'; }],
    ['terminal start after run', rows => { rows[3].started_at = '2026-10-09T07:30:52Z'; }],
    ['terminal creation after run', rows => { rows[3].created_at = rows[3].started_at = '2026-10-09T07:30:52Z'; }],
  ];
  for (const [label, mutate] of mutations) {
    const { candidate, rows } = emptySkippedClockFixture(); mutate(rows);
    const h = harness(url => response(url, { total_count: rows.length, jobs: rows }));
    const result = await readConditionalDeploymentJobs(config([candidate]), h.dependencies);
    failed(result); assert.equal(h.calls.length, 1, label);
    assert.equal(result.jobs.length, 0, label); assert.equal(result.cache.length, 0, label);
  }
});

test('synthetic active rerun reads every old empty-skipped attempt fresh and uncached without deployment proof', async () => {
  // No actual active-parent evidence is claimed. These are complete synthetic
  // old-attempt rows supplied by a fresh filter=all response for active attempt2.
  const prior = emptySkippedClockFixture(), oldRows = prior.rows.slice(3);
  const retained = await cold(prior.candidate, oldRows);
  const { candidate } = emptySkippedClockFixture({
    run_attempt: 2, status: 'in_progress', conclusion: null,
    run_started_at: '2026-10-09T07:31:00Z', updated_at: '2026-10-09T07:32:00Z',
  });
  const h = harness((url, init) => {
    assert.equal(init.headers['if-none-match'], undefined);
    return response(url, { total_count: oldRows.length, jobs: oldRows });
  });
  const result = await readConditionalDeploymentJobs(config([candidate], retained.result.cache), h.dependencies);
  assert.equal(result.status, 'complete'); recount(result); assert.equal(h.calls.length, 1);
  assert.equal(result.observations[0].conditional, false);
  assert.equal(result.observations[0].status, 200);
  assert.deepEqual(result.jobs[0].jobs, oldRows); assert.deepEqual(result.cache, []);
  assert.equal(result.jobs[0].jobs.every(row => row.run_attempt === 1 && row.steps.length === 0), true);
  assert.deepEqual(validateJobsPages(candidate, result.jobs[0].pages, scope), { total: 2, jobs: oldRows });
  for (const row of result.jobs[0].jobs) {
    assert.equal(row.created_at, '2026-10-09T07:30:51Z');
    assert.equal(row.started_at, '2026-10-09T07:30:51Z');
    assert.equal(row.completed_at, '2026-10-09T07:30:50Z');
  }
  const { latestDeployment } = await import('./publication-state.mjs');
  const api = endpoint => {
    if (endpoint === 'repos/' + REPO + '/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100') return [{ workflow_runs: [] }];
    if (endpoint === 'repos/' + REPO + '/actions/workflows/static-site.yml/runs?branch=main&per_page=100') return [{ workflow_runs: [candidate] }];
    if (endpoint === 'repos/' + REPO + '/actions/runs/' + candidate.id + '/jobs?filter=all&per_page=100') return [{ jobs: result.jobs[0].jobs }];
    throw Error('Unexpected synthetic active deployment route');
  };
  assert.throws(() => latestDeployment(REPO, api), /No authoritative successful Pages deployment/);
});


test('fractional remaining spacing survives an early wake before issuing the next distinct request', async () => {
  const candidates = [run(11), run(12)];
  let h;
  h = harness((url, _init, count) => {
    if (count === 1) h.advance(0.75);
    const candidate = candidates.find(value => route(value.id) === url);
    assert.ok(candidate);
    return response(url, { total_count: 1, jobs: [job(candidate, candidate.id * 100)] });
  });
  h.dependencies.pause = async ms => {
    h.pauses.push(ms); assert.equal(Number.isInteger(ms), true);
    assert.equal(h.calls.length, 1);
    h.advance(h.pauses.length === 1 ? ms - 1 : ms);
  };
  const result = await readConditionalDeploymentJobs(config(candidates), h.dependencies);
  assert.equal(result.status, 'complete'); recount(result);
  assert.deepEqual(h.pauses, [200, 1]);
  assert.deepEqual(h.calls.map(value => value.url), candidates.map(value => route(value.id)));
  assert.equal(result.observations[1].started_ms - result.observations[0].started_ms >= LIMITS.startSpacingMs, true);
  assert.equal(result.jobs.length, 2);
});

test('default native Node monotonic clock and timer preserve the exact request-start spacing', async () => {
  const candidates = [run(11), run(12)], calls = [];
  // Both default timing dependencies are intentionally omitted. Only the
  // authenticated response bodies are synthetic; no network request occurs.
  const result = await readConditionalDeploymentJobs(config(candidates), {
    token: PRIVATE_TEST_TOKEN,
    fetcher: async url => {
      calls.push(url);
      const candidate = candidates.find(value => route(value.id) === url);
      assert.ok(candidate);
      return response(url, { total_count: 1, jobs: [job(candidate, candidate.id * 100)] });
    },
  });
  assert.equal(result.status, 'complete'); recount(result);
  assert.deepEqual(calls, candidates.map(value => route(value.id)));
  assert.equal(result.observations[1].started_ms - result.observations[0].started_ms >= LIMITS.startSpacingMs, true);
  assert.equal(result.jobs.length, 2);
});

test('spacing recheck remains bounded by the original deadline and never issues a request after exhaustion', async () => {
  const candidates = [run(11), run(12)];
  let h;
  h = harness((url, _init, count) => {
    assert.equal(count, 1); h.advance(0.75);
    return response(url, { total_count: 1, jobs: [job(candidates[0], 1100)] });
  });
  h.dependencies.pause = async ms => {
    h.pauses.push(ms); assert.equal(Number.isInteger(ms), true);
    h.advance(h.pauses.length === 1 ? ms - 1 : 2);
  };
  const result = await readConditionalDeploymentJobs(config(candidates, [], { timeoutMs: 201 }), h.dependencies);
  failed(result, 'worker-deadline');
  assert.deepEqual(h.pauses, [200, 1]); assert.equal(h.calls.length, 1);
  assert.equal(result.stats.requests, 1); assert.deepEqual(result.jobs, []); assert.deepEqual(result.cache, []);
});

test('immediate pause with no monotonic progress fails once instead of starving deadline timers', async () => {
  const candidates = [run(11), run(12)];
  let h;
  h = harness((url, _init, count) => {
    assert.equal(count, 1); h.advance(0.75);
    return response(url, { total_count: 1, jobs: [job(candidates[0], 1100)] });
  });
  h.dependencies.pause = async ms => { h.pauses.push(ms); };
  const result = await readConditionalDeploymentJobs(config(candidates), h.dependencies);
  failed(result, 'insufficient-request-start-spacing');
  assert.deepEqual(h.pauses, [200]); assert.equal(h.calls.length, 1);
  assert.equal(result.stats.requests, 1); assert.deepEqual(result.jobs, []); assert.deepEqual(result.cache, []);
});


// The inverted skipped/cancelled shapes above/below reproduce supplied public
// clock metadata. All six other non-success literals are synthetic structural
// compatibility coverage, including the existing legacy startup_failure value.
// Explicit empty steps do not establish physical nonexecution or authority.
const MATRIX_CONCLUSIONS = ['success', 'failure', 'cancelled', 'skipped', 'timed_out',
  'neutral', 'action_required', 'startup_failure', 'stale'];
const MATRIX_ACTIVE = ['queued', 'in_progress', 'waiting', 'pending', 'requested'];
const MATRIX_PARENTS = ['completed', ...MATRIX_ACTIVE];
const MATRIX_SHAPES = ['empty', 'null', 'nonempty', 'missing'];
const placeholderStep = () => ({ number: 1, name: 'Synthetic represented placeholder',
  status: 'completed', conclusion: 'skipped', started_at: null, completed_at: null });
function matrixRun(parent, changes = {}) {
  return run(11, { run_attempt: 2, status: parent, conclusion: parent === 'completed' ? 'success' : null,
    // Old-attempt jobs intentionally predate this latest attempt's start.
    run_started_at: '2026-10-09T01:09:00Z', ...changes });
}
function matrixShape(row, shape) {
  if (shape === 'empty') row.steps = [];
  else if (shape === 'null') row.steps = null;
  else if (shape === 'nonempty') row.steps = [placeholderStep()];
  else delete row.steps;
}
function matrixPages(candidate, rows) {
  const total = rows.length, last = Math.max(1, Math.ceil(total / LIMITS.perPage));
  return Array.from({ length: last }, (_unused, index) => {
    const bytes = Buffer.from(JSON.stringify({ total_count: total,
      jobs: rows.slice(index * LIMITS.perPage, (index + 1) * LIMITS.perPage) }));
    return {
      schema_version: 'conditional-deployment-jobs-page-v1', scope: clone(scope), run_key: runKey(candidate),
      url: route(candidate.id, index + 1), etag: 'W/"opaque-matrix"',
      body_base64: bytes.toString('base64'), body_bytes: bytes.length, body_sha256: hash(bytes),
      link: pagination(candidate.id, index + 1, last),
      vary: ['accept', 'accept-encoding', 'authorization', 'cookie', 'x-github-otp', 'x-requested-with'],
      representation: clone(REQUEST_REPRESENTATION),
    };
  });
}
function matrixCheck(candidate, rows, expected, label) {
  const pages = matrixPages(candidate, rows);
  if (expected) {
    assert.deepEqual(validateJobsPages(candidate, pages, scope), { total: rows.length, jobs: rows }, label);
    for (const page of pages) {
      const bytes = Buffer.from(page.body_base64, 'base64');
      assert.equal(page.body_bytes, bytes.length, label); assert.equal(page.body_sha256, hash(bytes), label);
    }
  } else assert.throws(() => validateJobsPages(candidate, pages, scope), undefined, label);
}
const terminalClockVectors = [
  ['normal', 'any', {}],
  ['equal', 'any', { completed_at: '2026-10-09T01:00:02Z' }],
  ['completion-before-start', 'metadata', { started_at: '2026-10-09T01:00:04Z', completed_at: '2026-10-09T01:00:03Z' }],
  ['completion-before-creation', 'metadata', { completed_at: '2026-10-09T01:00:00Z' }],
  ['start-null', 'nullable', { started_at: null }],
  ['completion-null', 'nullable', { completed_at: null }],
  ['both-null', 'nullable', { started_at: null, completed_at: null }],
  ['completion-before-run', 'never', { completed_at: '2026-10-09T00:59:59Z' }],
  ['start-before-creation', 'never', { started_at: '2026-10-09T01:00:00Z' }],
  ['creation-before-run', 'never', { created_at: '2026-10-09T00:59:59Z' }],
  ['creation-after-update', 'parent-active', { created_at: '2026-10-09T01:10:01Z',
    started_at: '2026-10-09T01:10:02Z', completed_at: '2026-10-09T01:10:05Z' }],
  ['start-after-update', 'parent-active', { started_at: '2026-10-09T01:10:01Z', completed_at: '2026-10-09T01:10:02Z' }],
  ['completion-after-update', 'parent-active', { completed_at: '2026-10-09T01:10:01Z' }],
  ['malformed-completion', 'never', { completed_at: 'invalid-clock' }],
  ['non-UTC-completion', 'never', { completed_at: '2026-10-09T01:00:05' }],
  ['impossible-completion', 'never', { completed_at: '2026-02-30T01:00:05Z' }],
  ['missing-created', 'never', { created_at: undefined }],
  ['missing-start', 'never', { started_at: undefined }],
  ['missing-completed', 'never', { completed_at: undefined }],
];

test('closed terminal metadata matrix preserves every conclusion/shape/attempt/parent clock boundary', () => {
  let accepted = 0, rejected = 0;
  const core = { cells: 0, metadata: 0, strict: 0, rejected: 0 };
  for (const conclusion of MATRIX_CONCLUSIONS) for (const parent of MATRIX_PARENTS)
    for (const attempt of [1, 2]) for (const shape of MATRIX_SHAPES)
      for (const [clock, rule, changes] of terminalClockVectors) {
        const candidate = matrixRun(parent), row = job(candidate, 101, { conclusion, run_attempt: attempt, ...changes });
        matrixShape(row, shape);
        // This closed expected table is intentionally separate from the
        // production predicate. Nullability belongs only to these two values.
        const nullable = conclusion === 'skipped' || conclusion === 'cancelled';
        const validShape = shape !== 'missing' && (shape !== 'null' || nullable);
        const expected = validShape && (rule === 'any' ||
          (rule === 'metadata' && shape === 'empty' && conclusion !== 'success') ||
          (rule === 'nullable' && nullable) || (rule === 'parent-active' && parent !== 'completed'));
        matrixCheck(candidate, [row], expected, [conclusion, parent, attempt, shape, clock].join('/'));
        if (expected) accepted++; else rejected++;
        if (clock === 'normal' && ['completed', 'in_progress'].includes(parent) && shape !== 'missing') {
          core.cells++;
          if (!expected) core.rejected++;
          else if (shape === 'empty' && conclusion !== 'success') core.metadata++;
          else core.strict++;
        }
      }
  assert.deepEqual({ cells: accepted + rejected, accepted, rejected }, { cells: 8208, accepted: 1488, rejected: 6720 });
  assert.deepEqual(core, { cells: 108, metadata: 32, strict: 48, rejected: 28 });
});

const activeClockVectors = [
  ['normal', 'any', {}],
  ['start-null', 'nullable-start', { started_at: null }],
  ['completion-present', 'never', { completed_at: '2026-10-09T01:00:05Z' }],
  ['completion-inverted', 'never', { completed_at: '2026-10-09T01:00:01Z' }],
  ['start-before-creation', 'never', { started_at: '2026-10-09T01:00:00Z' }],
  ['creation-before-run', 'never', { created_at: '2026-10-09T00:59:59Z' }],
  ['creation-after-update', 'any', { created_at: '2026-10-09T01:10:01Z', started_at: '2026-10-09T01:10:02Z' }],
  ['start-after-update', 'any', { started_at: '2026-10-09T01:10:01Z' }],
  ['malformed-start', 'never', { started_at: 'invalid-clock' }],
  ['non-UTC-start', 'never', { started_at: '2026-10-09T01:00:02' }],
  ['missing-start', 'never', { started_at: undefined }],
  ['missing-completed', 'never', { completed_at: undefined }],
  ['missing-created', 'never', { created_at: undefined }],
  ['null-created', 'never', { created_at: null }],
  ['malformed-completed', 'never', { completed_at: 'invalid-clock' }],
];

test('all five active job states preserve current-active-attempt and exact null/shape clock rules', () => {
  let accepted = 0, rejected = 0;
  const core = { cells: 0, accepted: 0, rejected: 0 };
  for (const status of MATRIX_ACTIVE) for (const parent of MATRIX_PARENTS)
    for (const attempt of [1, 2]) for (const shape of MATRIX_SHAPES)
      for (const [clock, rule, changes] of activeClockVectors) {
        const candidate = matrixRun(parent), row = job(candidate, 101, {
          status, conclusion: null, run_attempt: attempt, completed_at: null, ...changes,
        });
        matrixShape(row, shape);
        const expected = parent !== 'completed' && attempt === 2 && shape !== 'missing' &&
          (rule === 'any' || (rule === 'nullable-start' && status !== 'in_progress'));
        matrixCheck(candidate, [row], expected, [status, parent, attempt, shape, clock].join('/'));
        if (expected) accepted++; else rejected++;
        if (clock === 'normal' && ['completed', 'in_progress'].includes(parent) && shape !== 'missing') {
          core.cells++; if (expected) core.accepted++; else core.rejected++;
        }
      }
  assert.deepEqual({ cells: accepted + rejected, accepted, rejected }, { cells: 3600, accepted: 285, rejected: 3315 });
  assert.deepEqual(core, { cells: 60, accepted: 15, rejected: 45 });
});


test('represented execution steps remain strict under every terminal conclusion and parent/attempt', () => {
  let executionCells = 0, negativeCells = 0;
  for (const conclusion of MATRIX_CONCLUSIONS) for (const parent of MATRIX_PARENTS) for (const attempt of [1, 2])
    for (const stepConclusion of ['success', 'failure', 'skipped', 'cancelled']) for (const inverted of [false, true]) {
      const candidate = matrixRun(parent), row = job(candidate, 101, { conclusion, run_attempt: attempt,
        completed_at: inverted ? '2026-10-09T01:00:01Z' : '2026-10-09T01:00:05Z',
        steps: [{ number: 1, name: 'Synthetic represented execution', status: 'completed', conclusion: stepConclusion,
          started_at: '2026-10-09T01:00:03Z', completed_at: '2026-10-09T01:00:04Z' }],
      });
      matrixCheck(candidate, [row], !inverted, [conclusion, parent, attempt, stepConclusion, inverted].join('/'));
      executionCells++;
    }
  const violations = [
    ['reversed-step', row => { row.steps[0].completed_at = '2026-10-09T01:00:02Z'; }],
    ['step-before-job', row => { row.steps[0].started_at = '2026-10-09T01:00:01Z'; }],
    ['step-after-job', row => { row.steps[0].completed_at = '2026-10-09T01:00:06Z'; }],
    ['malformed-step', row => { row.steps[0].started_at = 'invalid-clock'; }],
    ['non-UTC-step', row => { row.steps[0].completed_at = '2026-10-09T01:00:04'; }],
    ['null-successful-step', row => { row.steps[0].started_at = null; }],
    ['missing-step-clock', row => { delete row.steps[0].completed_at; }],
    ['duplicate-step-number', row => { row.steps.push(clone(row.steps[0])); }],
    ['overlapping-steps', row => { row.steps.push({ ...clone(row.steps[0]), number: 2 }); }],
    ['invalid-step-number', row => { row.steps[0].number = 0; }],
    ['missing-step-number', row => { delete row.steps[0].number; }],
    ['foreign-active-step', row => { row.steps[0].status = 'in_progress'; row.steps[0].conclusion = null; row.steps[0].completed_at = null; }],
  ];
  for (const conclusion of MATRIX_CONCLUSIONS) for (const parent of MATRIX_PARENTS) for (const attempt of [1, 2])
    for (const [label, mutate] of violations) {
      const candidate = matrixRun(parent), row = job(candidate, 101, { conclusion, run_attempt: attempt });
      mutate(row); matrixCheck(candidate, [row], false, [conclusion, parent, attempt, label].join('/')); negativeCells++;
    }
  // A nullable job start never permits a represented successful execution step.
  for (const conclusion of ['skipped', 'cancelled']) for (const parent of MATRIX_PARENTS) for (const attempt of [1, 2]) {
    const candidate = matrixRun(parent), row = job(candidate, 101, { conclusion, run_attempt: attempt, started_at: null });
    matrixCheck(candidate, [row], false, [conclusion, parent, attempt, 'null-job-start-successful-step'].join('/')); negativeCells++;
  }
  // Active steps preserve their own start/end constraints under active jobs.
  let activeStepCells = 0;
  for (const status of MATRIX_ACTIVE) for (const stepStatus of MATRIX_ACTIVE) {
    const candidate = matrixRun('in_progress'), row = job(candidate, 101, { status, conclusion: null, completed_at: null,
      steps: [{ number: 1, name: 'Synthetic active represented step', status: stepStatus, conclusion: null,
        started_at: '2026-10-09T01:00:03Z', completed_at: null }],
    });
    matrixCheck(candidate, [row], true, status + '/' + stepStatus); activeStepCells++;
    const completed = clone(row); completed.steps[0].completed_at = '2026-10-09T01:00:04Z';
    matrixCheck(candidate, [completed], false, status + '/' + stepStatus + '/completed'); activeStepCells++;
    const noStart = clone(row); noStart.steps[0].started_at = null;
    matrixCheck(candidate, [noStart], stepStatus !== 'in_progress', status + '/' + stepStatus + '/null-start'); activeStepCells++;
  }
  assert.deepEqual({ executionCells, negativeCells, activeStepCells },
    { executionCells: 864, negativeCells: 1320, activeStepCells: 75 });
});

function cancelledEmptyClockFixture() {
  const candidate = run(11, { conclusion: 'cancelled',
    created_at: '2026-10-06T23:43:27Z', run_started_at: '2026-10-06T23:43:27Z',
    updated_at: '2026-10-07T00:18:03Z',
  });
  const rows = [
    job(candidate, 101, { name: 'Synthetic successful combine',
      created_at: '2026-10-06T23:43:30Z', started_at: '2026-10-06T23:43:31Z', completed_at: '2026-10-07T00:17:50Z',
      steps: [{ number: 1, name: 'Combine synthetic metadata', status: 'completed', conclusion: 'success',
        started_at: '2026-10-06T23:43:32Z', completed_at: '2026-10-07T00:17:49Z' }] }),
    job(candidate, 102, { name: 'Synthetic cancelled market', conclusion: 'cancelled',
      created_at: '2026-10-06T23:44:00Z', started_at: '2026-10-06T23:44:01Z', completed_at: '2026-10-07T00:18:01Z',
      steps: Array.from({ length: 28 }, (_unused, index) => ({
        number: index + 1, name: 'Synthetic represented market step ' + (index + 1), status: 'completed',
        conclusion: index === 27 ? 'cancelled' : 'success',
        started_at: new Date(Date.parse('2026-10-06T23:44:02Z') + index * 2000).toISOString(),
        completed_at: new Date(Date.parse('2026-10-06T23:44:03Z') + index * 2000).toISOString(),
      })) }),
    job(candidate, 103, { name: 'Synthetic successful deployment companion',
      created_at: '2026-10-07T00:17:50Z', started_at: '2026-10-07T00:17:51Z', completed_at: '2026-10-07T00:18:00Z',
      steps: [{ number: 1, name: 'Deploy to GitHub Pages', status: 'completed', conclusion: 'success',
        started_at: '2026-10-07T00:17:52Z', completed_at: '2026-10-07T00:17:59Z' }] }),
    job(candidate, 104, { name: 'Synthetic skipped companion', conclusion: 'skipped', steps: [],
      created_at: '2026-10-07T00:18:03Z', started_at: '2026-10-07T00:18:03Z', completed_at: '2026-10-07T00:18:02Z' }),
    job(candidate, 105, { name: 'promote-daily-source', conclusion: 'cancelled', steps: [],
      created_at: '2026-10-07T00:18:03Z', started_at: '2026-10-07T00:18:03Z', completed_at: '2026-10-07T00:18:02Z' }),
  ];
  return { candidate, rows };
}
function matrixDeploymentApi(candidate, rows) {
  const calls = [], api = (endpoint, paginate = false) => {
    calls.push({ endpoint, paginate });
    if (endpoint === 'repos/' + REPO + '/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100')
      return [{ workflow_runs: [] }];
    if (endpoint === 'repos/' + REPO + '/actions/workflows/static-site.yml/runs?branch=main&per_page=100')
      return [{ workflow_runs: [candidate] }];
    if (endpoint === 'repos/' + REPO + '/actions/runs/' + candidate.id + '/jobs?filter=all&per_page=100')
      return [{ jobs: rows }];
    throw Error('Unexpected synthetic matrix deployment route');
  };
  return { calls, api };
}

test('public-shaped cancelled empty metadata retains all five jobs and literal cold/warm bytes without changing deployment selection', async () => {
  // Only parent/focus job clock/status/empty-step shapes reproduce supplied
  // endpoint evidence. Companion IDs, execution steps and deploy are synthetic.
  const { candidate, rows } = cancelledEmptyClockFixture(), { result } = await cold(candidate, rows);
  const entry = result.jobs[0], page = entry.pages[0], bytes = Buffer.from(JSON.stringify({ total_count: 5, jobs: rows }));
  assert.deepEqual(entry.jobs, rows); assert.deepEqual(result.cache, [page]);
  assert.equal(page.body_base64, bytes.toString('base64'));
  assert.equal(page.body_bytes, bytes.length); assert.equal(page.body_sha256, hash(bytes));
  assert.equal(entry.jobs[1].steps.length, 28); assert.equal(entry.jobs[1].conclusion, 'cancelled');
  assert.equal(entry.jobs[4].created_at, '2026-10-07T00:18:03Z');
  assert.equal(entry.jobs[4].started_at, '2026-10-07T00:18:03Z');
  assert.equal(entry.jobs[4].completed_at, '2026-10-07T00:18:02Z');
  assert.deepEqual(entry.jobs[4].steps, []);
  const h = harness(url => response(url, null, { status: 304, etag: '"opaque-original"', vary: null }));
  const warm = await readConditionalDeploymentJobs(config([candidate], result.cache), h.dependencies);
  assert.equal(warm.status, 'complete'); recount(warm);
  assert.deepEqual(warm.jobs[0].jobs, rows);
  assert.equal(warm.jobs[0].pages[0].body_base64, page.body_base64);
  assert.equal(warm.jobs[0].pages[0].body_sha256, page.body_sha256);
  assert.equal(warm.stats.revalidated_304, 1); assert.equal(warm.body_bytes, 0);
  const { latestDeployment } = await import('./publication-state.mjs');
  const { calls, api } = matrixDeploymentApi(candidate, warm.jobs[0].jobs);
  assert.deepEqual(latestDeployment(REPO, api), {
    runId: candidate.id, attempt: 1, completed: Date.parse('2026-10-07T00:17:59Z'),
    started: Date.parse('2026-10-07T00:17:52Z'), jobStarted: Date.parse('2026-10-07T00:17:51Z'),
    headSha: candidate.head_sha, runAttempt: 1, runStarted: Date.parse(candidate.run_started_at),
  });
  assert.equal(calls.length, 3); assert.equal(calls.every(value => value.paginate), true);
});


test('empty terminal rows contribute no deployment while failed/cancelled jobs retain successful named steps from older attempts', async () => {
  const { latestDeployment } = await import('./publication-state.mjs');
  let emptyOnlyCells = 0, companionCells = 0, activeFreshCells = 0, terminalWarmCells = 0;
  for (const conclusion of MATRIX_CONCLUSIONS) for (const parent of MATRIX_PARENTS) for (const attempt of [1, 2]) {
    const candidate = matrixRun(parent), empty = job(candidate, 101, { conclusion, run_attempt: attempt, steps: [],
      created_at: '2026-10-09T01:09:59Z', started_at: '2026-10-09T01:09:59Z',
      completed_at: conclusion === 'success' ? '2026-10-09T01:09:59Z' : '2026-10-09T01:09:58Z',
    });
    matrixCheck(candidate, [empty], true, [conclusion, parent, attempt, 'no-deploy'].join('/'));
    const only = matrixDeploymentApi(candidate, [empty]);
    assert.throws(() => latestDeployment(REPO, only.api), /No authoritative successful Pages deployment/);
    assert.equal(only.calls.length, 3); emptyOnlyCells++;
    for (const overall of ['failure', 'cancelled']) {
      // Successful named steps remain selectable even if a later step made the
      // complete job fail/cancel. The newer empty row has no deployment step.
      const olderDeploy = job(candidate, 102, { run_attempt: 1, conclusion: overall,
        steps: [
          { number: 1, name: overall === 'failure' ? 'Deploy to GitHub Pages' : 'Run actions/deploy-pages@v4',
            status: 'completed', conclusion: 'success', started_at: '2026-10-09T01:00:03Z', completed_at: '2026-10-09T01:00:04Z' },
          { number: 2, name: 'Synthetic later terminal outcome', status: 'completed', conclusion: overall,
            started_at: '2026-10-09T01:00:04Z', completed_at: '2026-10-09T01:00:05Z' },
        ],
      });
      const newerFailure = job(candidate, 103, { run_attempt: 2, conclusion: 'failure',
        created_at: '2026-10-09T01:09:00Z', started_at: '2026-10-09T01:09:01Z', completed_at: '2026-10-09T01:09:10Z',
        steps: [{ number: 1, name: 'Synthetic failed non-deployment step', status: 'completed', conclusion: 'failure',
          started_at: '2026-10-09T01:09:02Z', completed_at: '2026-10-09T01:09:09Z' }],
      });
      const rows = [empty, newerFailure, olderDeploy];
      matrixCheck(candidate, rows, true, [conclusion, parent, attempt, overall].join('/'));
      const { calls, api } = matrixDeploymentApi(candidate, rows);
      assert.deepEqual(latestDeployment(REPO, api), {
        runId: candidate.id, attempt: 1, completed: Date.parse('2026-10-09T01:00:04Z'),
        started: Date.parse('2026-10-09T01:00:03Z'), jobStarted: Date.parse('2026-10-09T01:00:02Z'),
        headSha: candidate.head_sha, runAttempt: 2, runStarted: Date.parse('2026-10-09T01:09:00Z'),
      });
      assert.equal(calls.length, 3); assert.equal(calls.every(value => value.paginate), true); companionCells++;
    }
  }
  for (const conclusion of MATRIX_CONCLUSIONS.filter(value => value !== 'success')) {
    const candidate = matrixRun('completed'), row = job(candidate, 101, { conclusion, steps: [],
      completed_at: '2026-10-09T01:00:01Z',
    });
    const { result } = await cold(candidate, [row]);
    const h = harness(url => response(url, null, { status: 304, etag: '"opaque-original"', vary: null }));
    const warm = await readConditionalDeploymentJobs(config([candidate], result.cache), h.dependencies);
    assert.equal(warm.status, 'complete'); recount(warm); assert.equal(warm.stats.revalidated_304, 1);
    assert.deepEqual(warm.jobs[0].jobs, [row]);
    assert.equal(warm.jobs[0].pages[0].body_base64, result.jobs[0].pages[0].body_base64);
    assert.equal(warm.jobs[0].pages[0].body_sha256, result.jobs[0].pages[0].body_sha256); terminalWarmCells++;
    for (const parent of MATRIX_ACTIVE) {
      const active = matrixRun(parent), old = clone(row); old.run_attempt = 1;
      const fresh = harness((url, init) => {
        assert.equal(init.headers['if-none-match'], undefined);
        return response(url, { total_count: 1, jobs: [old] });
      });
      const retained = await readConditionalDeploymentJobs(config([active], warm.cache), fresh.dependencies);
      assert.equal(retained.status, 'complete'); recount(retained);
      assert.equal(fresh.calls.length, 1); assert.equal(retained.observations[0].status, 200);
      assert.equal(retained.observations[0].conditional, false); assert.deepEqual(retained.cache, []);
      assert.deepEqual(retained.jobs[0].jobs, [old]);
      const { api } = matrixDeploymentApi(active, retained.jobs[0].jobs);
      assert.throws(() => latestDeployment(REPO, api), /No authoritative successful Pages deployment/); activeFreshCells++;
    }
  }
  assert.deepEqual({ emptyOnlyCells, companionCells, activeFreshCells, terminalWarmCells },
    { emptyOnlyCells: 108, companionCells: 216, activeFreshCells: 40, terminalWarmCells: 8 });
});

test('metadata exception preserves complete multipage membership and all identity/pagination failure guards', async () => {
  const candidate = matrixRun('completed');
  const rows = Array.from({ length: 103 }, (_unused, index) => job(candidate, 9000 + index, {
    run_attempt: index % 2 + 1, conclusion: MATRIX_CONCLUSIONS[index % MATRIX_CONCLUSIONS.length],
    steps: [], completed_at: index % MATRIX_CONCLUSIONS.length === 0 ? '2026-10-09T01:00:05Z' : '2026-10-09T01:00:01Z',
  }));
  const expected = matrixPages(candidate, rows);
  assert.deepEqual(validateJobsPages(candidate, expected, scope), { total: 103, jobs: rows });
  const fresh = harness(url => {
    const page = url === route(candidate.id) ? 1 : 2;
    return response(url, Buffer.from(expected[page - 1].body_base64, 'base64').toString('utf8'),
      { link: expected[page - 1].link });
  });
  const result = await readConditionalDeploymentJobs(config([candidate]), fresh.dependencies);
  assert.equal(result.status, 'complete'); recount(result); assert.equal(fresh.calls.length, 2);
  assert.deepEqual(result.jobs[0].jobs, rows); assert.equal(result.jobs[0].pages.length, 2); assert.equal(result.cache.length, 2);
  for (let index = 0; index < expected.length; index++) {
    assert.equal(result.jobs[0].pages[index].body_base64, expected[index].body_base64);
    assert.equal(result.jobs[0].pages[index].body_sha256, expected[index].body_sha256);
  }
  const warm = harness(url => response(url, null, { status: 304, etag: '"opaque-original"', vary: null }));
  const revalidated = await readConditionalDeploymentJobs(config([candidate], result.cache), warm.dependencies);
  assert.equal(revalidated.status, 'complete'); recount(revalidated);
  assert.equal(warm.calls.length, 2); assert.equal(revalidated.stats.revalidated_304, 2);
  assert.deepEqual(revalidated.jobs[0].jobs, rows);
  for (let index = 0; index < expected.length; index++)
    assert.equal(revalidated.jobs[0].pages[index].body_base64, expected[index].body_base64);

  const mutations = [
    ['duplicate-across-pages', changed => { changed[100] = clone(changed[0]); }],
    ['foreign-run', changed => { changed[100].run_id = 12; }],
    ['foreign-head', changed => { changed[100].head_sha = 'd'.repeat(40); }],
    ['foreign-workflow', changed => { changed[100].workflow_name = 'Foreign workflow'; }],
    ['future-attempt', changed => { changed[100].run_attempt = 3; }],
    ['zero-attempt', changed => { changed[100].run_attempt = 0; }],
    ['malformed-attempt', changed => { changed[100].run_attempt = '1'; }],
    ['unknown-conclusion', changed => { changed[100].conclusion = 'unknown'; }],
    ['null-terminal-conclusion', changed => { changed[100].conclusion = null; }],
    ['unknown-status', changed => { changed[100].status = 'unknown'; }],
    ['missing-steps', changed => { delete changed[100].steps; }],
  ];
  for (const [label, mutate] of mutations) {
    const changed = clone(rows); mutate(changed);
    const pages = matrixPages(candidate, changed);
    assert.throws(() => validateJobsPages(candidate, pages, scope), undefined, label);
    const h = harness(url => {
      const page = url === route(candidate.id) ? 1 : 2;
      return response(url, Buffer.from(pages[page - 1].body_base64, 'base64').toString('utf8'), { link: pages[page - 1].link });
    });
    failed(await readConditionalDeploymentJobs(config([candidate]), h.dependencies));
    assert.equal(h.calls.length, 2, label);
  }
  assert.throws(() => validateJobsPages(candidate, [expected[0]], scope), /incomplete-jobs-inventory/);
  assert.throws(() => validateJobsPages(candidate, [expected[1], expected[0]], scope), /contradictory-jobs-page-chain/);
  const altered = clone(expected);
  const second = JSON.parse(Buffer.from(altered[1].body_base64, 'base64').toString('utf8')); second.total_count = 104;
  const bytes = Buffer.from(JSON.stringify(second));
  altered[1].body_base64 = bytes.toString('base64'); altered[1].body_bytes = bytes.length; altered[1].body_sha256 = hash(bytes);
  assert.throws(() => validateJobsPages(candidate, altered, scope), /partial-jobs-page/);
});


test('optional request ceiling succeeds at the exact issued-request boundary', async () => {
  const candidates = [run(11), run(12)];
  const h = harness(url => {
    const candidate = candidates.find(value => url === route(value.id));
    assert.ok(candidate);
    return response(url, { total_count: 1, jobs: [job(candidate, 4000 + candidate.id)] });
  });
  const result = await readConditionalDeploymentJobs(config(candidates, [], { maximumRequests: 2 }), h.dependencies);
  assert.equal(result.status, 'complete'); recount(result);
  assert.equal(h.calls.length, 2); assert.equal(result.stats.requests, 2);
  assert.deepEqual(result.jobs.map(value => value.run_id), [11, 12]);
  assert.equal(result.cache.length, 2);
  assert.equal(h.calls[1].clock - h.calls[0].clock, LIMITS.startSpacingMs);
});

test('optional request ceiling rejects one-over before fetch with no accepted prefix', async () => {
  const candidates = [run(11), run(12), run(13)];
  const h = harness(url => {
    const candidate = candidates.find(value => url === route(value.id));
    assert.ok(candidate);
    return response(url, { total_count: 1, jobs: [job(candidate, 4000 + candidate.id)] });
  });
  const result = await readConditionalDeploymentJobs(config(candidates, [], { maximumRequests: 2 }), h.dependencies);
  failed(result, 'request-count-cap');
  assert.equal(h.calls.length, 2); assert.equal(result.stats.requests, 2);
  assert.deepEqual(h.calls.map(value => value.url), [route(11), route(12)]);
  assert.deepEqual(result.observations.map(value => [value.run_id, value.status, value.page_validated]),
    [[11, 200, true], [12, 200, true]]);
  assert.equal(result.stats.received_body_bytes > 0, true);
  assert.equal(result.observations.every(value => value.cleanup_failures === 0), true);
});

test('request ceiling counts every multipage, 304, active, critical and own fetch equally', async () => {
  const terminal = run(11), active = run(12, { status: 'in_progress', conclusion: null });
  const critical = run(13), own = run(scope.run_id), candidates = [terminal, active, critical, own];
  const rows = Array.from({ length: 101 }, (_unused, index) => job(terminal, 5000 + index));
  const options = { maximumRequests: 5, excludedIds: [critical.id] };
  const handler = (warm = false) => (url, init) => {
    if (url === route(terminal.id) || url === route(terminal.id, 2)) {
      const page = url === route(terminal.id) ? 1 : 2;
      if (warm) {
        assert.equal(init.headers['if-none-match'], '"ceiling-page-' + page + '"');
        return response(url, null, { status: 304, etag: '"ceiling-page-' + page + '"', vary: null });
      }
      assert.equal(init.headers['if-none-match'], undefined);
      return response(url, { total_count: rows.length, jobs: rows.slice((page - 1) * 100, page * 100) },
        { etag: '"ceiling-page-' + page + '"', link: pagination(terminal.id, page, 2) });
    }
    const candidate = candidates.find(value => url === route(value.id));
    assert.ok(candidate); assert.notEqual(candidate.id, terminal.id);
    assert.equal(init.headers['if-none-match'], undefined);
    return response(url, { total_count: 1, jobs: [job(candidate, 6000 + candidate.id)] });
  };
  const coldHarness = harness(handler());
  const initial = await readConditionalDeploymentJobs(config(candidates, [], options), coldHarness.dependencies);
  assert.equal(initial.status, 'complete'); recount(initial);
  assert.equal(coldHarness.calls.length, 5); assert.equal(initial.cache.length, 2);
  assert.equal(initial.stats.fresh_200, 5); assert.equal(initial.stats.uncached_200, 3);
  assert.deepEqual(initial.jobs.map(value => [value.run_id, value.jobs.length]),
    [[terminal.id, 101], [active.id, 1], [critical.id, 1], [own.id, 1]]);
  const warmHarness = harness(handler(true));
  const complete = await readConditionalDeploymentJobs(config(candidates, initial.cache, options), warmHarness.dependencies);
  assert.equal(complete.status, 'complete'); recount(complete);
  assert.equal(warmHarness.calls.length, 5); assert.equal(complete.stats.requests, 5);
  assert.equal(complete.stats.revalidated_304, 2); assert.equal(complete.stats.fresh_200, 3);
  assert.equal(complete.stats.uncached_200, 3);
  assert.deepEqual(complete.jobs, initial.jobs); assert.deepEqual(complete.cache, initial.cache);
  assert.deepEqual(complete.observations.map(value => [value.run_id, value.status, value.conditional]),
    [[terminal.id, 304, true], [terminal.id, 304, true], [active.id, 200, false],
      [critical.id, 200, false], [own.id, 200, false]]);
  const limitedHarness = harness(handler(true));
  const limited = await readConditionalDeploymentJobs(config(candidates, initial.cache,
    { ...options, maximumRequests: 4 }), limitedHarness.dependencies);
  failed(limited, 'request-count-cap');
  assert.equal(limitedHarness.calls.length, 4); assert.equal(limited.stats.requests, 4);
  assert.equal(limited.stats.revalidated_304, 2); assert.equal(limited.stats.fresh_200, 2);
  assert.deepEqual(limited.observations.map(value => value.run_id), [terminal.id, terminal.id, active.id, critical.id]);
  assert.equal(limitedHarness.calls.some(value => value.url === route(own.id)), false);
});

test('optional request ceiling requires a present positive safe integer no greater than600', async () => {
  for (const maximumRequests of [0, -1, 1.5, NaN, Infinity, 601, Number.MAX_SAFE_INTEGER + 1,
    '2', true, null, undefined, {}, [], 1n]) {
    const h = harness(() => { throw Error('Invalid request ceiling must fail before fetch'); });
    failed(await readConditionalDeploymentJobs(config([run()], [], { maximumRequests }), h.dependencies),
      'invalid-worker-maximum-requests');
    assert.equal(h.calls.length, 0);
  }
  for (const maximumRequests of [1, 600]) {
    const h = harness(() => { throw Error('An empty batch has no fetch'); });
    const result = await readConditionalDeploymentJobs(config([], [], { maximumRequests }), h.dependencies);
    assert.equal(result.status, 'complete'); recount(result); assert.equal(h.calls.length, 0);
  }
});

test('absent request ceiling retains the original result, spacing and default behavior', async () => {
  const candidates = [run(11), run(12)];
  const handler = url => {
    const candidate = candidates.find(value => url === route(value.id));
    assert.ok(candidate);
    return response(url, { total_count: 1, jobs: [job(candidate, 4000 + candidate.id)] });
  };
  const originalHarness = harness(handler), explicitHarness = harness(handler);
  const original = await readConditionalDeploymentJobs(config(candidates), originalHarness.dependencies);
  const explicit = await readConditionalDeploymentJobs(config(candidates, [], { maximumRequests: 600 }), explicitHarness.dependencies);
  assert.equal(original.status, 'complete'); recount(original); recount(explicit);
  assert.deepEqual(original, explicit);
  assert.deepEqual(originalHarness.calls.map(value => [value.url, value.clock]),
    explicitHarness.calls.map(value => [value.url, value.clock]));
  assert.deepEqual(originalHarness.pauses, explicitHarness.pauses);
  const inherited = config(candidates);
  Object.setPrototypeOf(inherited, { maximumRequests: 0 });
  const inheritedHarness = harness(handler);
  const unchanged = await readConditionalDeploymentJobs(inherited, inheritedHarness.dependencies);
  assert.deepEqual(unchanged, original); recount(unchanged);
});
