// Native Node diagnostic tests. No Playwright or independent network request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { diagnostic_only, installBrowserStreamCausalDiagnostic } from './retained-price-browser-stream-causal-diagnostic.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixtureURL = 'https://synthetic.invalid/asset.bin?public-fixture=yes';
const fixtureBytes = Uint8Array.from([0, 1, 2, 3, 128, 255]);

function harness({ nativeStreams = false } = {}) {
  const calls = [];
  const fetched = deferred();
  const readQueue = [];
  const cancelled = Promise.resolve('native cancel result');
  const releaseResult = { nativeRelease: true };
  const abortResult = { nativeAbort: true };
  class Signal extends EventTarget { constructor() { super(); this.aborted = false; } }
  class Controller {
    constructor() { this.signal = new Signal(); }
    abort(...args) {
      calls.push({ name: 'abort', receiver: this, args });
      this.signal.aborted = true;
      this.signal.dispatchEvent(new Event('abort'));
      return abortResult;
    }
  }
  class Reader {
    read(...args) {
      calls.push({ name: 'read', receiver: this, args });
      const item = readQueue.shift();
      if (item?.synchronousError) throw item.synchronousError;
      return item;
    }
    cancel(...args) { calls.push({ name: 'reader.cancel', receiver: this, args }); return cancelled; }
    releaseLock(...args) { calls.push({ name: 'releaseLock', receiver: this, args }); return releaseResult; }
  }
  const reader = new Reader();
  class Stream {
    getReader(...args) { calls.push({ name: 'getReader', receiver: this, args }); return reader; }
    cancel(...args) { calls.push({ name: 'stream.cancel', receiver: this, args }); return cancelled; }
  }
  const stream = nativeStreams ? new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(fixtureBytes));
      controller.close();
    },
  }) : new Stream();
  const response = {
    url: fixtureURL, status: 200, body: stream,
    headers: {
      get(name) {
        calls.push({ name: 'header', args: [name] });
        if (name === 'content-length') return String(fixtureBytes.byteLength);
        if (name === 'content-type') return 'application/octet-stream';
        throw new Error('An unapproved header was read');
      },
    },
  };
  const realm = {
    WeakRef, TextEncoder, URL, performance, crypto: webcrypto, setTimeout, clearTimeout,
    location: { href: 'https://synthetic.invalid/' },
    AbortController: Controller,
    ReadableStream: nativeStreams ? ReadableStream : Stream,
    ReadableStreamDefaultReader: nativeStreams ? ReadableStreamDefaultReader : Reader,
    fetch(...args) {
      calls.push({ name: 'fetch', receiver: this, args });
      return fetched.promise;
    },
  };
  const native = {
    fetch: realm.fetch, abort: Controller.prototype.abort,
    getReader: realm.ReadableStream.prototype.getReader,
    read: realm.ReadableStreamDefaultReader.prototype.read,
    releaseLock: realm.ReadableStreamDefaultReader.prototype.releaseLock,
    streamCancel: realm.ReadableStream.prototype.cancel,
    readerCancel: realm.ReadableStreamDefaultReader.prototype.cancel,
  };
  return { realm, calls, fetched, readQueue, reader, stream, response, native, cancelled, releaseResult, abortResult };
}

async function start(h, options = {}) {
  const api = installBrowserStreamCausalDiagnostic({
    realm: h.realm, targetPaths: ['/asset.bin'],
    maxEntries: 256, maxEvidenceBytes: 64 * 1024, ...options,
  });
  const controller = new h.realm.AbortController();
  const init = { signal: controller.signal, cache: 'no-store' };
  const receiver = { nativeFetchReceiver: true };
  const promise = h.realm.fetch.call(receiver, fixtureURL, init);
  assert.equal(promise, h.fetched.promise);
  h.fetched.resolve(h.response);
  assert.equal(await promise, h.response);
  return { api, controller, init, receiver };
}

test('exported initializer is diagnostic only and self-contained after serialization', async () => {
  assert.equal(diagnostic_only, true);
  const serialized = new Function('return (' + installBrowserStreamCausalDiagnostic.toString() + ')')();
  const h = harness();
  const before = performance.now();
  const api = serialized({ realm: h.realm, targetPaths: ['/asset.bin'] });
  const after = performance.now();
  assert.equal(h.realm.__retainedPriceStreamDiagnostic, api);
  assert.deepEqual(Object.keys(api.snapshot()).sort(), ['clock', 'diagnostic_only', 'diagnostics', 'events', 'readers']);
  assert.equal(api.snapshot().clock.performance_origin_ms, performance.timeOrigin);
  api.markCalibration({
    node_performance_origin_ms: performance.timeOrigin,
    node_before_ms: before, node_after_ms: after,
    browser_performance_origin_ms: performance.timeOrigin, browser_performance_ms: after,
  });
  await api.drain();
  api.restore();
  assert.equal(api.snapshot().diagnostics.restored, true);
});

test('fetch, getReader, read, releaseLock preserve exact receiver, args, promise/result', async () => {
  const h = harness();
  const { api, init, receiver } = await start(h);
  try {
    const fetchCall = h.calls.find(call => call.name === 'fetch');
    assert.equal(fetchCall.receiver, receiver);
    assert.equal(fetchCall.args[0], fixtureURL);
    assert.equal(fetchCall.args[1], init);
    const options = { mode: 'synthetic default reader' };
    const reader = h.stream.getReader(options);
    assert.equal(reader, h.reader);
    const getReaderCall = h.calls.find(call => call.name === 'getReader');
    assert.equal(getReaderCall.receiver, h.stream);
    assert.equal(getReaderCall.args[0], options);
    const nativePromise = Promise.resolve({ done: false, value: new Uint8Array(fixtureBytes) });
    h.readQueue.push(nativePromise, Promise.resolve({ done: true, value: undefined }));
    const readArgument = { syntheticReadArgument: true };
    const returned = reader.read(readArgument);
    assert.equal(returned, nativePromise);
    const nativeResult = await returned;
    const readCall = h.calls.find(call => call.name === 'read');
    assert.equal(readCall.receiver, reader);
    assert.equal(readCall.args[0], readArgument);
    assert.deepEqual(nativeResult.value, fixtureBytes);
    // The observer copied bytes before the helper can mutate its own chunk.
    nativeResult.value.fill(7);
    await reader.read();
    assert.equal(reader.releaseLock('synthetic argument'), h.releaseResult);
    await api.drain();
    const snapshot = api.snapshot();
    assert.equal(snapshot.readers[0].url, 'https://synthetic.invalid/asset.bin');
    assert.equal(snapshot.readers[0].eof, true);
    assert.equal(snapshot.readers[0].hash_failed, false);
    assert.equal(snapshot.readers[0].native_body_bytes, fixtureBytes.byteLength);
    assert.equal(snapshot.readers[0].native_body_sha256, hash(fixtureBytes));
    assert.equal(snapshot.diagnostics.copied_chunk_refs, 0);
    assert.equal(snapshot.diagnostics.copied_chunk_bytes, 0);
    assert.equal(snapshot.diagnostics.failed, false);
    assert.equal(snapshot.diagnostics.dropped_event_count, 0);
    assert.deepEqual(h.calls.filter(call => call.name === 'header').map(call => call.args[0]),
      ['content-length', 'content-type']);
    assert.doesNotMatch(JSON.stringify(snapshot), /public-fixture|syntheticReadArgument/);
  } finally { api.restore(); }
});

test('real native ReadableStream EOF bytes/hash are observed without an extra read', async () => {
  const h = harness({ nativeStreams: true });
  const { api } = await start(h);
  try {
    const reader = h.stream.getReader();
    const first = await reader.read();
    assert.deepEqual(first.value, fixtureBytes);
    assert.equal((await reader.read()).done, true);
    reader.releaseLock();
    await api.drain();
    const target = api.snapshot().readers[0];
    assert.equal(target.read_calls, 2);
    assert.equal(target.eof, true);
    assert.equal(target.native_body_bytes, fixtureBytes.byteLength);
    assert.equal(target.native_body_sha256, hash(fixtureBytes));
    assert.equal(h.calls.filter(call => call.name === 'fetch').length, 1);
  } finally { api.restore(); }
});

test('first abort call and signal event share IDs/timing; reason and return stay native', async () => {
  const h = harness();
  const { api, controller } = await start(h);
  try {
    const reason = { privateReason: 'must not be recorded' };
    const result = controller.abort(reason, 'extra argument');
    assert.equal(result, h.abortResult);
    const call = h.calls.find(value => value.name === 'abort');
    assert.equal(call.receiver, controller);
    assert.equal(call.args[0], reason);
    assert.equal(call.args[1], 'extra argument');
    await api.drain();
    const events = api.snapshot().events;
    const abort = events.find(value => value.kind === 'controller_abort_call');
    const signal = events.find(value => value.kind === 'signal_abort');
    assert.equal(abort.signal_id, signal.signal_id);
    assert.deepEqual(abort.request_ids, signal.request_ids);
    assert.equal(abort.first_abort.cause, 'controller_abort_call');
    assert.equal(signal.first_abort.cause, 'controller_abort_call');
    assert.equal(abort.epoch_ms <= signal.epoch_ms, true);
    assert.equal(abort.stack_prefix.length <= 1024, true);
    assert.doesNotMatch(JSON.stringify(api.snapshot()), /privateReason|must not be recorded/);
  } finally { api.restore(); }
});

test('cancel calls preserve native promise, arguments and bounded call-site prefix', async () => {
  const h = harness();
  const { api } = await start(h);
  try {
    const reader = h.stream.getReader();
    const reason = { privateCancelReason: true };
    assert.equal(reader.cancel(reason), h.cancelled);
    assert.equal(h.stream.cancel(reason), h.cancelled);
    await api.drain();
    for (const name of ['reader.cancel', 'stream.cancel']) {
      const call = h.calls.find(value => value.name === name);
      assert.equal(call.args[0], reason);
      assert.equal(call.receiver, name === 'reader.cancel' ? reader : h.stream);
    }
    const snapshot = api.snapshot();
    for (const event of snapshot.events.filter(value => value.kind.endsWith('cancel_call'))) {
      assert.equal(event.stack_prefix.length <= 1024, true);
      assert.equal(event.argument_count, 1);
    }
    assert.equal(snapshot.diagnostics.failed, false);
    assert.doesNotMatch(JSON.stringify(snapshot), /privateCancelReason/);
  } finally { api.restore(); }
});

test('native reader rejection keeps exact original error and is not telemetry failure', async () => {
  const h = harness();
  const { api } = await start(h);
  try {
    const reader = h.stream.getReader();
    const native = deferred();
    const originalError = new Error('Synthetic native stream aborted');
    originalError.privateData = 'must not be recorded';
    h.readQueue.push(native.promise);
    const returned = reader.read();
    assert.equal(returned, native.promise);
    const rejected = assert.rejects(returned, error => error === originalError);
    native.reject(originalError);
    await rejected;
    await api.drain();
    const snapshot = api.snapshot();
    assert.equal(snapshot.diagnostics.failed, false);
    assert.equal(snapshot.readers[0].hash_failed, true);
    assert.equal(snapshot.events.some(event => event.kind === 'reader_read_rejected'), true);
    assert.doesNotMatch(JSON.stringify(snapshot), /privateData|must not be recorded|"stack":/);
  } finally { api.restore(); }
});

test('synchronous native read error propagates by identity without replacing it', async () => {
  const h = harness();
  const { api } = await start(h);
  try {
    const originalError = new Error('Synthetic synchronous read error');
    h.readQueue.push({ synchronousError: originalError });
    const reader = h.stream.getReader();
    assert.throws(() => reader.read('original arg'), error => error === originalError);
    await api.drain();
    assert(api.snapshot().events.some(event => event.kind === 'reader_read_error' && event.error_string === originalError.message));
    assert.equal(api.snapshot().diagnostics.failed, false);
  } finally { api.restore(); }
});

test('typed UI/disposal/retention marks avoid parsed-value hashing and arbitrary objects', async () => {
  const h = harness();
  const { api } = await start(h);
  try {
    api.markDisposal('ui-finally');
    api.markResponseRetention({ label: 'reader-lifetime-control', retained: false });
    api.markUiOutcome({ state: 'fulfilled', encoded_hash_checked: true, encoded_sha256: hash(fixtureBytes) });
    const events = api.snapshot().events;
    assert.equal(events.find(event => event.kind === 'disposal').label, 'ui-finally');
    assert.equal(events.find(event => event.kind === 'response_retention').retained, false);
    assert.equal(events.find(event => event.kind === 'ui_terminal').encoded_hash_checked, true);
    assert.equal(events.find(event => event.kind === 'ui_terminal').decoded_sha256, undefined);
    assert.equal(api.markUiOutcome({ parsed_value: { unsafe: true } }), false);
    await assert.rejects(api.drain(), /Unexpected typed fact/);
  } finally { api.restore(); }
});

test('event and byte limits fail visibly while native fetch/reader behavior remains exact', async () => {
  for (const options of [{ maxEntries: 2 }, { maxEvidenceBytes: 1 }]) {
    const h = harness();
    const { api } = await start(h, options);
    try {
      const reader = h.stream.getReader();
      const promise = Promise.resolve({ done: true, value: undefined });
      h.readQueue.push(promise);
      assert.equal(reader.read(), promise);
      await promise;
      assert.equal(reader, h.reader);
      await assert.rejects(api.drain(), /limit exceeded/);
      const snapshot = api.snapshot();
      assert.equal(snapshot.diagnostics.failed, true);
      assert.equal(snapshot.diagnostics.dropped_event_count > 0, true);
      assert.equal(snapshot.events.length <= (options.maxEntries || 256), true);
      assert.equal(snapshot.diagnostics.retained_responses, 0);
    } finally { api.restore(); }
  }
});

test('copy limit releases chunks and marks failed hash while original bytes/EOF remain native', async () => {
  const h = harness();
  const { api } = await start(h, { maxBodyBytes: 2 });
  try {
    const reader = h.stream.getReader();
    const result = { done: false, value: new Uint8Array(fixtureBytes) };
    const promise = Promise.resolve(result);
    h.readQueue.push(promise, Promise.resolve({ done: true, value: undefined }));
    assert.equal(reader.read(), promise);
    assert.equal(await promise, result);
    await reader.read();
    await assert.rejects(api.drain(), /copy limit exceeded/);
    const snapshot = api.snapshot();
    assert.equal(snapshot.readers[0].eof, true);
    assert.equal(snapshot.readers[0].hash_failed, true);
    assert.equal(snapshot.readers[0].native_body_bytes, fixtureBytes.byteLength);
    assert.equal(snapshot.readers[0].native_body_sha256, null);
    assert.equal(snapshot.diagnostics.copied_chunk_refs, 0);
  } finally { api.restore(); }
});

test('restore releases copied references, restores original descriptors, and does not hide pending work', async () => {
  const h = harness();
  const { api, controller } = await start(h);
  const reader = h.stream.getReader();
  h.readQueue.push(Promise.resolve({ done: false, value: new Uint8Array(fixtureBytes) }));
  await reader.read();
  await api.drain();
  assert.equal(api.snapshot().diagnostics.copied_chunk_refs, 1);
  api.markDisposal('explicit-cleanup');
  api.restore();
  await api.drain();
  const snapshot = api.snapshot();
  assert.equal(snapshot.diagnostics.restored, true);
  assert.equal(snapshot.diagnostics.pending_count, 0);
  assert.equal(snapshot.diagnostics.pending_at_restore, 0);
  assert.equal(snapshot.diagnostics.copied_chunk_refs, 0);
  assert.equal(snapshot.diagnostics.retained_responses, 0);
  assert.equal(h.realm.fetch, h.native.fetch);
  assert.equal(h.realm.AbortController.prototype.abort, h.native.abort);
  assert.equal(h.realm.ReadableStream.prototype.getReader, h.native.getReader);
  assert.equal(h.realm.ReadableStreamDefaultReader.prototype.read, h.native.read);
  assert.equal(h.realm.ReadableStreamDefaultReader.prototype.releaseLock, h.native.releaseLock);
  const count = snapshot.events.length;
  controller.abort();
  assert.equal(api.snapshot().events.length, count);
});

test('finite drain exposes pending telemetry and its deadline without cancelling native promise', async () => {
  const h = harness();
  const { api } = await start(h, { flushDeadlineMs: 20 });
  const reader = h.stream.getReader();
  const native = deferred();
  h.readQueue.push(native.promise);
  assert.equal(reader.read(), native.promise);
  await assert.rejects(api.drain(), /deadline exceeded/);
  api.restore();
  assert.equal(api.snapshot().diagnostics.pending_at_restore, 1);
  native.resolve({ done: true, value: undefined });
  await native.promise;
  await tick();
  await assert.rejects(api.drain(), /deadline exceeded/);
  assert.equal(api.snapshot().diagnostics.pending_count, 0);
});

test('every event uses exact origin/relative/epoch and calibration retains host bounds', async () => {
  const h = harness();
  const before = performance.now();
  const { api } = await start(h);
  const after = performance.now();
  try {
    api.markCalibration({
      node_performance_origin_ms: performance.timeOrigin,
      node_before_ms: before, node_after_ms: after,
      browser_performance_origin_ms: performance.timeOrigin, browser_performance_ms: after,
    });
    await api.drain();
    const end = performance.now();
    for (const event of api.snapshot().events) {
      assert.equal(event.performance_origin_ms, performance.timeOrigin);
      assert.equal(event.epoch_ms, event.performance_origin_ms + event.performance_ms);
      assert.equal(event.performance_ms >= before && event.performance_ms <= end, true);
    }
    const calibrated = api.snapshot().events.find(event => event.kind === 'clock_calibration');
    assert.equal(calibrated.node_before_ms, before);
    assert.equal(calibrated.node_after_ms, after);
  } finally { api.restore(); }
});

test('untracked fetch is untouched and explicit hard ceilings are enforced', async () => {
  const h = harness();
  const api = installBrowserStreamCausalDiagnostic({ realm: h.realm, targetPaths: ['/asset.bin'] });
  try {
    assert.equal(h.realm.fetch('https://synthetic.invalid/bootstrap.json'), h.fetched.promise);
    h.fetched.resolve(h.response);
    await h.fetched.promise;
    await api.drain();
    assert.equal(api.snapshot().events.length, 0);
    assert.equal(api.snapshot().readers.length, 0);
  } finally { api.restore(); }
  for (const options of [
    { maxEvents: 4097 }, { maxBytes: 1024 * 1024 + 1 },
    { maxBodyBytes: 64 * 1024 * 1024 + 1 }, { flushDeadlineMs: 45_001 },
  ]) {
    assert.throws(() => installBrowserStreamCausalDiagnostic({
      realm: harness().realm, targetPaths: ['/asset.bin'], ...options,
    }), RangeError);
  }
});

test('actual causal runner installer, inline UI and calibration obey the frozen helper contract', async () => {
  const source = readFileSync(new URL('./retained-price-browser-capture-diagnostic.mjs', import.meta.url), 'utf8');
  const installation = source.match(/addInitScript\(installBrowserStreamCausalDiagnostic,(\{[^\n]+\})\);/);
  assert(installation, 'Actual runner installer call missing');
  const options = Function('server', 'site', 'index', 'BROWSER_LIMITS', 'return (' + installation[1] + ');')(
    { origin: 'https://synthetic.invalid' }, { entries: [{ assetPath: 'asset.bin' }] }, 0, { fileBytes: 64 * 1024 * 1024 });
  assert.deepEqual(options.targetPaths, ['https://synthetic.invalid/screener/asset.bin']);
  assert.equal(options.maxEntries, 256);
  assert.equal(options.maxEvidenceBytes, 64 * 1024);
  const h = harness();
  const api = installBrowserStreamCausalDiagnostic({ ...options, realm: h.realm });
  const window = { __retainedPriceStreamDiagnostic: api };
  const nodes = new Map([['h2', {}], ['#load', {}]]);
  const document = { querySelector: selector => nodes.get(selector) };
  const htmlStart = source.indexOf('const html='), htmlEnd = source.indexOf('async function fixture()');
  assert(htmlStart >= 0 && htmlEnd > htmlStart, 'Actual inline fixture missing');
  const html = Function('EXPECTED_BLOCKED_FONT_STYLESHEETS',
    source.slice(htmlStart, htmlEnd) + '\nreturn html;')([]);
  const prefix = '<script type="module">', start = html.indexOf(prefix), end = html.indexOf('</script>', start);
  assert(start >= 0 && end > start, 'Actual inline module missing');
  const inline = html.slice(start + prefix.length, end).replace(/^import .*?;/, '');
  const originalFailure = new Error('Original UI rejection');
  let failUi = false, disposed = 0;
  const transport = Object.freeze({
    readJson: async () => { if (failUi) throw originalFailure; return { symbol: 'FUTU', payload: 'abc', zero: -0, absent: null }; },
    dispose: () => { disposed++; },
  });
  Function('window', 'document', 'createStaticTransport', 'location', inline)(window, document, async () => transport, { href: 'https://synthetic.invalid/screener/' });
  const configuration = { symbol: 'FUTU', logical: 'research-details/FUTU-small.json', lifetime: 'immediate',
    expectedRoot: {}, encodedBytes: 105420, encodedSha256: 'a'.repeat(64), decodedBytes: 139892, decodedSha256: 'b'.repeat(64) };
  try {
    window.configure(configuration);
    nodes.get('#load').onclick();
    await window.causalUiPromise;
    assert.equal(window.fixture.zero_is_negative, true);
    assert.equal(window.fixture.absent_is_null, true);
    assert.equal(disposed, 1);
    failUi = true;
    window.configure({ ...configuration, lifetime: 'retained' });
    nodes.get('#load').onclick();
    await assert.rejects(window.causalUiPromise, error => error === originalFailure);
    await tick();
    assert.equal(window.fixture.state, 'failed');
    assert.equal(window.causalTransport, transport);
    api.markDisposal('post-observation-cleanup');
    window.causalTransport.dispose(); window.causalTransport = null;
    const calibration = source.match(/await page\.evaluate\((value=>window\.__retainedPriceStreamDiagnostic\.markCalibration\([\s\S]*?\)),result\.clock_alignment\);/);
    assert(calibration, 'Actual calibration callback missing');
    const calibrate = Function('window', 'return (' + calibration[1] + ');')(window);
    calibrate({ node_origin_ms: performance.timeOrigin, node_before_ms: 1, node_after_ms: 3,
      relative_ms: 2, origin_ms: performance.timeOrigin, browser_to_node_epoch_offset_bounds_ms: [-1, 1], note: 'not passed as a typed fact' });
    await api.drain();
    const snapshot = api.snapshot();
    assert.equal(snapshot.diagnostics.failed, false);
    assert(snapshot.events.some(event => event.kind === 'ui_terminal' && event.state === 'passed' &&
      event.encoded_hash_checked === true && event.decoded_hash_checked === true));
    assert(snapshot.events.some(event => event.kind === 'ui_terminal' && event.state === 'failed' &&
      event.error_string === originalFailure.message));
    assert(snapshot.events.some(event => event.kind === 'clock_calibration' && event.node_before_ms === 1));
  } finally { api.restore(); }
  assert.equal(api.snapshot().diagnostics.pending_count, 0);
  assert.equal(api.snapshot().diagnostics.restored, true);
});
