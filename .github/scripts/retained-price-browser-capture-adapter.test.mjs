// Native Node tests for the diagnostic adapter. No Playwright dependency.
// Fake bytes/responses are public synthetic fixtures, not production evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  diagnostic_only,
  createDiagnosticCapturePage,
  DiagnosticCaptureError,
  DiagnosticLimitError,
  DiagnosticDeadlineError,
} from './retained-price-browser-capture-adapter.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const bytes = Buffer.from('{"synthetic":true,"secret_body_marker":"do-not-record-bytes"}');
const digest = value => createHash('sha256').update(value).digest('hex');
const assetURL = 'https://synthetic.invalid/static-data/retained-price.json.gz';

function fakeResponse(bodyPromise = Promise.resolve(bytes), overrides = {}) {
  const calls = [];
  const response = {
    calls,
    bodyCalls: 0,
    url() { calls.push('url'); return assetURL + '?public-fixture-token=yes#fixture'; },
    status() { calls.push('status'); return 200; },
    ok() { assert.equal(this, response); calls.push('ok'); return true; },
    headers() {
      calls.push('headers');
      return {
        'content-type': 'application/json',
        'content-length': '42',
        'content-encoding': 'gzip',
        'set-cookie': 'must-never-be-recorded',
        'x-private': 'must-never-be-recorded',
      };
    },
    request() {
      calls.push('request');
      return {
        method() { calls.push('method'); return 'GET'; },
        failure() { calls.push('failure'); return null; },
      };
    },
    body() { assert.equal(this, response); response.bodyCalls++; return bodyPromise; },
    ...overrides,
  };
  return response;
}

function fakePage() {
  const page = {
    defaultTimeout: 45_000,
    calls: [],
    waiters: [],
    waitForResponse(predicate, options) {
      assert.equal(this, page);
      page.calls.push('listener');
      const waiter = deferred();
      page.waiters.push({ ...waiter, predicate, options });
      return waiter.promise;
    },
    publish(response) {
      for (const waiter of page.waiters.splice(0)) {
        if (typeof waiter.predicate !== 'function' || waiter.predicate(response)) waiter.resolve(response);
        else page.waiters.push(waiter);
      }
    },
    fail(error) {
      for (const waiter of page.waiters.splice(0)) waiter.reject(error);
    },
    boundMethod() { assert.equal(this, page); return 'bound'; },
  };
  return page;
}

test('adapter is explicitly diagnostic only', () => {
  assert.equal(diagnostic_only, true);
});

test('baseline installs listener before action and preserves predicate/options/binding', async () => {
  const page = fakePage();
  const events = [];
  const originalPromise = Promise.resolve(bytes);
  const original = fakeResponse(originalPromise);
  const adapter = createDiagnosticCapturePage(page, { eager: false, onEvent: event => events.push(event) });
  const predicate = response => response.url().startsWith(assetURL);
  const options = { timeout: 1234 };
  const waiter = adapter.page.waitForResponse(predicate, options);
  const action = () => {
    assert.deepEqual(page.calls, ['listener']);
    assert.equal(page.waiters[0].predicate, predicate);
    assert.equal(page.waiters[0].options, options);
    assert.equal(adapter.page.boundMethod(), 'bound');
    page.publish(original);
  };
  const [response] = await Promise.all([waiter, action()]);
  assert.equal(original.bodyCalls, 0);
  assert.equal(response.ok(), true);
  const returned = response.body();
  assert.equal(returned, originalPromise);
  assert.equal(await returned, bytes);
  await adapter.drain();
  const snapshot = adapter.snapshot();
  assert.equal(snapshot.records[0].body.original_calls, 1);
  assert.equal(snapshot.records[0].body_calls, 1);
  assert.equal(snapshot.records[0].body.bytes, bytes.byteLength);
  assert.equal(snapshot.records[0].body.sha256, digest(bytes));
  assert.equal(snapshot.records[0].response.url, assetURL);
  assert.deepEqual(Object.keys(snapshot.records[0].response.headers).sort(),
    ['content-encoding', 'content-length', 'content-type']);
  assert.equal(snapshot.records[0].response.headers['content-length'], '42');
  for (const event of events) {
    assert.equal(Object.isFrozen(event), true);
    assert.equal(Object.hasOwn(event, 'headers'), false);
    assert.equal(Object.hasOwn(event, 'body'), false);
    assert.equal(Object.hasOwn(event, 'error_ref'), false);
  }
  assert.doesNotMatch(JSON.stringify(snapshot), /must-never|secret_body_marker|public-fixture-token/);
  await adapter.dispose();
});

test('eager captures before action settles; later helper body calls return same promise and bytes', async () => {
  const page = fakePage();
  const originalPromise = Promise.resolve(bytes);
  const original = fakeResponse(originalPromise);
  const action = deferred();
  const adapter = createDiagnosticCapturePage(page, { eager: true });
  const waiter = adapter.page.waitForResponse(response => response.url().startsWith(assetURL));
  page.publish(original);
  const response = await waiter;
  assert.equal(original.bodyCalls, 1);
  assert.equal(adapter.records[0].body_calls, 0);
  await tick();
  assert.equal(adapter.records[0].body.state, 'fulfilled');
  action.resolve();
  await action.promise;
  const one = response.body();
  const two = response.body();
  assert.equal(one, originalPromise);
  assert.equal(two, originalPromise);
  assert.equal(await two, bytes);
  assert.equal(original.bodyCalls, 1);
  await adapter.dispose();
  assert.equal(adapter.snapshot().diagnostics.retained_body_promises, 0);
  assert.equal(adapter.snapshot().diagnostics.retained_responses, 0);
});

test('two waiters for the same response share one original body promise', async () => {
  const page = fakePage();
  const originalPromise = Promise.resolve(bytes);
  const original = fakeResponse(originalPromise);
  const adapter = createDiagnosticCapturePage(page, { eager: true });
  const one = adapter.page.waitForResponse(() => true);
  const two = adapter.page.waitForResponse(() => true);
  page.publish(original);
  const [first, second] = await Promise.all([one, two]);
  assert.equal(first.body(), originalPromise);
  assert.equal(second.body(), originalPromise);
  assert.equal(original.bodyCalls, 1);
  assert.equal(adapter.records[0].body, adapter.records[1].body);
  assert.equal(adapter.snapshot().records[1].body.original_calls, 1);
  await adapter.dispose();
});

for (const eager of [false, true]) {
  test('original body rejection identity survives helper and drain: ' + (eager ? 'eager' : 'baseline'), async () => {
    const page = fakePage();
    const body = deferred();
    const original = fakeResponse(body.promise);
    const error = new Error('Synthetic body rejection');
    error.privateProperty = 'must-never-be-recorded';
    const adapter = createDiagnosticCapturePage(page, { eager });
    const waiter = adapter.page.waitForResponse(() => true);
    page.publish(original);
    const response = await waiter;
    const returned = response.body();
    assert.equal(returned, body.promise);
    const helperFailure = assert.rejects(returned, caught => caught === error);
    body.reject(error);
    await helperFailure;
    await assert.rejects(adapter.drain(), caught => caught === error);
    assert.equal(adapter.records[0].body.error_ref, error);
    assert.equal(adapter.originalBodyErrors().get(1), error);
    assert.equal(Object.keys(adapter.records[0].body).includes('error_ref'), false);
    assert.equal(original.bodyCalls, 1);
    assert.doesNotMatch(JSON.stringify(adapter.snapshot()), /privateProperty|must-never/);
    await assert.rejects(adapter.dispose(), caught => caught === error);
    assert.equal(adapter.snapshot().diagnostics.retained_body_promises, 0);
  });
}

test('action rejection then late waiter/body rejection drains without losing body error', async () => {
  const page = fakePage();
  const body = deferred();
  const original = fakeResponse(body.promise);
  const actionError = new Error('Synthetic action rejection');
  const bodyError = new Error('Synthetic late body rejection');
  const adapter = createDiagnosticCapturePage(page, { eager: true, deadlineMs: 1000 });
  const helper = Promise.all([
    adapter.page.waitForResponse(() => true),
    Promise.reject(actionError),
  ]);
  await assert.rejects(helper, caught => caught === actionError);
  const draining = adapter.drain();
  const drainedFailure = assert.rejects(draining, caught => caught === bodyError);
  page.publish(original);
  await tick();
  assert.equal(original.bodyCalls, 1);
  body.reject(bodyError);
  await drainedFailure;
  assert.equal(adapter.records[0].waiter.state, 'fulfilled');
  assert.equal(adapter.records[0].body.state, 'rejected');
  assert.equal(adapter.originalBodyErrors().get(1), bodyError);
  await assert.rejects(adapter.dispose(), caught => caught === bodyError);
});

test('waiter rejection retains exact original error and starts no body request', async () => {
  const page = fakePage();
  const adapter = createDiagnosticCapturePage(page, { eager: true });
  const error = new Error('Synthetic waiter rejection');
  const waiter = adapter.page.waitForResponse(() => true, { timeout: 100 });
  const waiterFailure = assert.rejects(waiter, caught => caught === error);
  page.fail(error);
  await waiterFailure;
  await assert.rejects(adapter.drain(), caught => caught === error);
  assert.equal(adapter.records[0].waiter.error_ref, error);
  assert.equal(adapter.records[0].body.original_calls, 0);
  assert.equal(adapter.records[0].body.state, 'unstarted');
  await assert.rejects(adapter.dispose(), caught => caught === error);
});

test('dispose awaits delayed body resolution and keeps only safe facts afterward', async () => {
  const page = fakePage();
  const body = deferred();
  const original = fakeResponse(body.promise);
  const adapter = createDiagnosticCapturePage(page, { eager: true, deadlineMs: 1000 });
  const waiter = adapter.page.waitForResponse(() => true);
  page.publish(original);
  const response = await waiter;
  const disposal = adapter.dispose();
  assert.equal(adapter.snapshot().diagnostics.disposed, false);
  assert.equal(adapter.snapshot().diagnostics.pending_count > 0, true);
  body.resolve(new Uint8Array(bytes));
  await disposal;
  const snapshot = adapter.snapshot();
  assert.equal(snapshot.diagnostics.pending_count, 0);
  assert.equal(snapshot.diagnostics.retained_body_promises, 0);
  assert.equal(snapshot.diagnostics.retained_responses, 0);
  assert.equal(snapshot.records[0].body.sha256, digest(bytes));
  assert.equal(snapshot.records[0].disposed, true);
  assert.throws(() => response.body(), DiagnosticCaptureError);
  assert.doesNotMatch(JSON.stringify(adapter.snapshot()), /secret_body_marker/);
});

test('drain has a finite deadline and late waiter resolution does not retain response', async () => {
  const page = fakePage();
  const original = fakeResponse();
  const adapter = createDiagnosticCapturePage(page, { eager: true, deadlineMs: 20 });
  const waiter = adapter.page.waitForResponse(() => true);
  const waiterFailure = assert.rejects(waiter, DiagnosticCaptureError);
  await assert.rejects(adapter.drain(), DiagnosticDeadlineError);
  await assert.rejects(adapter.dispose(), DiagnosticDeadlineError);
  page.publish(original);
  await waiterFailure;
  await tick();
  assert.equal(original.bodyCalls, 0);
  assert.equal(adapter.snapshot().diagnostics.disposed, true);
  assert.equal(adapter.snapshot().diagnostics.retained_responses, 0);
});

test('baseline and eager use identical metadata getters and never add asynchronous getters', async () => {
  const reports = [];
  for (const eager of [false, true]) {
    const page = fakePage();
    const original = fakeResponse();
    original.allHeaders = () => { throw new Error('Forbidden protocol getter'); };
    original.finished = () => { throw new Error('Forbidden protocol getter'); };
    const adapter = createDiagnosticCapturePage(page, { eager });
    const waiter = adapter.page.waitForResponse(() => true);
    page.publish(original);
    const response = await waiter;
    await response.body();
    await adapter.dispose();
    reports.push(original.calls);
  }
  assert.deepEqual(reports[0], reports[1]);
  assert.deepEqual(reports[0], ['url', 'status', 'headers', 'request', 'method', 'failure']);
});

test('event entry limit is a retained hard failure, with no silent eviction', async () => {
  const page = fakePage();
  const seen = [];
  const adapter = createDiagnosticCapturePage(page, { eager: true, maxEntries: 1, onEvent: event => seen.push(event) });
  const original = fakeResponse();
  const waiter = adapter.page.waitForResponse(() => true);
  page.publish(original);
  await assert.rejects(waiter, DiagnosticLimitError);
  await assert.rejects(adapter.drain(), DiagnosticLimitError);
  assert.equal(adapter.events.length, 1);
  assert.equal(seen.length, 1);
  assert.equal(adapter.events[0].event, 'waiter_started');
  assert.equal(adapter.snapshot().diagnostics.failed, true);
  assert.equal(original.bodyCalls, 1);
  await assert.rejects(adapter.dispose(), DiagnosticLimitError);
});

test('waiter entry limit stops a new listener rather than dropping a record', async () => {
  const page = fakePage();
  const adapter = createDiagnosticCapturePage(page, { maxEntries: 1 });
  const waiter = adapter.page.waitForResponse(() => true);
  const error = new Error('Synthetic cleanup');
  const failedWaiter = assert.rejects(waiter, caught => caught === error);
  assert.throws(() => adapter.page.waitForResponse(() => true), DiagnosticLimitError);
  assert.equal(page.calls.length, 1);
  page.fail(error);
  await failedWaiter;
  await assert.rejects(adapter.dispose(), DiagnosticLimitError);
});

test('oversized metadata and total evidence bytes fail rather than truncate or evict', async () => {
  {
    const page = fakePage();
    const adapter = createDiagnosticCapturePage(page, { eager: false });
    const waiter = adapter.page.waitForResponse(() => true);
    page.publish(fakeResponse(undefined, { url: () => 'https://synthetic.invalid/' + 'x'.repeat(5000) }));
    await assert.rejects(waiter, DiagnosticLimitError);
    await assert.rejects(adapter.dispose(), DiagnosticLimitError);
    assert.equal(adapter.snapshot().records[0].response.url, null);
  }
  {
    const page = fakePage();
    const adapter = createDiagnosticCapturePage(page, { maxEvidenceBytes: 1 });
    assert.throws(() => adapter.page.waitForResponse(() => true), DiagnosticLimitError);
    assert.equal(page.calls.length, 0);
    assert.equal(adapter.events.length, 0);
    assert.equal(adapter.records.length, 0);
    await assert.rejects(adapter.dispose(), DiagnosticLimitError);
  }
});

test('onEvent rejection/throw is retained and drain cannot turn it into success', async () => {
  const error = new Error('Synthetic event sink rejection');
  const page = fakePage();
  const adapter = createDiagnosticCapturePage(page, {
    onEvent: () => Promise.reject(error),
  });
  const waiter = adapter.page.waitForResponse(() => true);
  page.publish(fakeResponse());
  const response = await waiter;
  await response.body();
  await assert.rejects(adapter.dispose(), caught => caught === error);
  const second = createDiagnosticCapturePage(fakePage(), { onEvent: () => { throw error; } });
  assert.throws(() => second.page.waitForResponse(() => true), caught => caught === error);
  await assert.rejects(second.dispose(), caught => caught === error);
});

test('non-byte body is a diagnostic failure and original helper promise stays exact', async () => {
  const page = fakePage();
  const promise = Promise.resolve('not a byte buffer');
  const adapter = createDiagnosticCapturePage(page, { eager: true });
  const waiter = adapter.page.waitForResponse(() => true);
  page.publish(fakeResponse(promise));
  const response = await waiter;
  assert.equal(response.body(), promise);
  assert.equal(await promise, 'not a byte buffer');
  await assert.rejects(adapter.dispose(), DiagnosticCaptureError);
  assert.equal(adapter.snapshot().diagnostics.failed, true);
});

test('error strings are capped and error objects never enter snapshots', async () => {
  const page = fakePage();
  const adapter = createDiagnosticCapturePage(page);
  const error = new Error('x'.repeat(6000));
  const waiter = adapter.page.waitForResponse(() => true);
  const failure = assert.rejects(waiter, caught => caught === error);
  page.fail(error);
  await failure;
  await assert.rejects(adapter.dispose(), caught => caught === error);
  const snapshot = adapter.snapshot();
  assert.equal(snapshot.records[0].waiter.error_string.length, 2048);
  assert.equal(snapshot.diagnostics.error_string.length, 2048);
  assert.equal(JSON.stringify(snapshot).includes('"stack"'), false);
});

test('configured bounds cannot exceed diagnostic hard ceilings', () => {
  const page = fakePage();
  for (const options of [
    { deadlineMs: 45_001 }, { deadlineMs: 0 },
    { maxEntries: 65 }, { maxEvidenceBytes: 256 * 1024 + 1 },
  ]) {
    assert.throws(() => createDiagnosticCapturePage(page, options), RangeError);
  }
});

test('baseline action failure never initiates an unrequested body capture', async () => {
  const page = fakePage();
  const original = fakeResponse();
  const adapter = createDiagnosticCapturePage(page, { eager: false });
  const actionError = new Error('Synthetic baseline action rejection');
  const helper = Promise.all([
    adapter.page.waitForResponse(() => true), Promise.reject(actionError),
  ]);
  await assert.rejects(helper, caught => caught === actionError);
  const draining = adapter.drain();
  page.publish(original);
  await draining;
  assert.equal(original.bodyCalls, 0);
  assert.equal(adapter.snapshot().records[0].body.state, 'unstarted');
  await adapter.dispose();
});

test('synchronous original body throw is exact, retained, and never retried', async () => {
  const page = fakePage();
  const error = new Error('Synthetic synchronous body throw');
  let calls = 0;
  const original = fakeResponse(undefined, { body() { calls++; throw error; } });
  const adapter = createDiagnosticCapturePage(page, { eager: false });
  const waiter = adapter.page.waitForResponse(() => true);
  page.publish(original);
  const response = await waiter;
  assert.throws(() => response.body(), caught => caught === error);
  assert.throws(() => response.body(), caught => caught === error);
  assert.equal(calls, 1);
  assert.equal(adapter.originalBodyErrors().get(1), error);
  await assert.rejects(adapter.dispose(), caught => caught === error);
});

test('action fails before any matching response; close first settles the waiter during cleanup', { timeout: 2500 }, async () => {
  const page = fakePage();
  const adapter = createDiagnosticCapturePage(page, { eager: true, deadlineMs: 1000 });
  const actionError = new Error('Synthetic action failed before response');
  const contextClosedError = new Error('Synthetic owning context closed');
  let closeCalls = 0;
  page.close = async function close() {
    assert.equal(this, page);
    closeCalls++;
    page.fail(contextClosedError);
  };
  const helper = Promise.all([
    adapter.page.waitForResponse(response => response.url().startsWith(assetURL)),
    Promise.reject(actionError),
  ]);
  let originalHelperError;
  try {
    await helper;
    assert.fail('The synthetic helper must reject');
  } catch (error) {
    originalHelperError = error;
  }
  assert.equal(originalHelperError, actionError);
  assert.equal(adapter.records[0].waiter.state, 'pending');
  assert.equal(adapter.records[0].body.original_calls, 0);
  assert.equal(adapter.records[0].response.url, null);
  // Mirror the existing failure path: close the owning context/page FIRST,
  // without publishing any matching response or waiting for a browser timeout.
  await page.close();
  await assert.rejects(adapter.drain(), caught => caught === contextClosedError);
  await assert.rejects(adapter.dispose(), caught => caught === contextClosedError);
  assert.equal(closeCalls, 1);
  assert.equal(originalHelperError, actionError);
  assert.equal(adapter.records[0].waiter.error_ref, contextClosedError);
  assert.equal(adapter.records[0].waiter.state, 'rejected');
  assert.equal(adapter.records[0].body.state, 'unstarted');
  assert.equal(adapter.records[0].body.original_calls, 0);
  assert.equal(adapter.records[0].body_calls, 0);
  assert.equal(adapter.originalBodyErrors().size, 0);
  const snapshot = adapter.snapshot();
  assert.equal(snapshot.diagnostics.pending_count, 0);
  assert.equal(snapshot.diagnostics.retained_body_promises, 0);
  assert.equal(snapshot.diagnostics.retained_responses, 0);
  assert.equal(snapshot.records[0].response.url, null);
  assert.equal(snapshot.records[0].disposed, true);
});

test('exact monotonic origin maps relative lifecycle/event times to Node absolute time', async () => {
  const page = fakePage();
  const delivered = [];
  const before = performance.now();
  const adapter = createDiagnosticCapturePage(page, {
    eager: true, onEvent: event => delivered.push(event),
  });
  const after = performance.now();
  const origin = adapter.snapshot().diagnostics.clock_origin_ms;
  assert.equal(Number.isFinite(origin), true);
  assert.equal(origin >= before && origin <= after, true);
  const waiter = adapter.page.waitForResponse(() => true);
  page.publish(fakeResponse());
  const response = await waiter;
  await response.body();
  await adapter.drain();
  const snapshot = adapter.snapshot();
  const end = performance.now();
  assert.equal(snapshot.diagnostics.clock_origin_ms, origin);
  assert.equal(adapter.diagnostics.clock_origin_ms, origin);
  for (const record of snapshot.records) {
    for (const relative of [
      record.started_ms, record.waiter.settled_ms,
      record.body.started_ms, record.body.settled_ms,
    ]) {
      assert.equal(Number.isFinite(relative), true);
      assert.equal(relative >= 0, true);
      const absolute = origin + relative;
      assert.equal(absolute >= before && absolute <= end, true);
    }
  }
  for (const event of [...snapshot.events, ...delivered]) {
    assert.equal(event.clock_origin_ms, origin);
    assert.equal(Number.isFinite(event.at_ms), true);
    const absolute = event.clock_origin_ms + event.at_ms;
    assert.equal(absolute >= before && absolute <= end, true);
  }
  await adapter.dispose();
  assert.equal(adapter.snapshot().diagnostics.clock_origin_ms, origin);
});
