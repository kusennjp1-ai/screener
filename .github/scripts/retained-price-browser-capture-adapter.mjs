// Diagnostic only. Never import this adapter into production application code.
// It observes the response chosen by the existing helper and never fetches,
// retries, decodes, or changes publication/hash validation.
import { createHash } from 'node:crypto';

export const diagnostic_only = true;
const MAX_DEADLINE_MS = 45_000;
const MAX_ENTRIES = 64;
const MAX_EVIDENCE_BYTES = 256 * 1024;
const HEADER_NAMES = ['content-type', 'content-length', 'content-encoding'];

export class DiagnosticCaptureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DiagnosticCaptureError';
  }
}
export class DiagnosticLimitError extends DiagnosticCaptureError {
  constructor(message) {
    super(message);
    this.name = 'DiagnosticLimitError';
  }
}
export class DiagnosticDeadlineError extends DiagnosticCaptureError {
  constructor(message) {
    super(message);
    this.name = 'DiagnosticDeadlineError';
  }
}

function safeError(error) {
  // These fixtures contain public synthetic data. Never emit an Error object,
  // stack, arbitrary properties, response bytes, or arbitrary response headers.
  let name = 'Error';
  let message = 'Unknown error';
  try {
    if (typeof error?.name === 'string') name = error.name;
    message = typeof error?.message === 'string' ? error.message : String(error);
  } catch {
    message = 'Unprintable error';
  }
  return {
    error_name: name.replace(/[^A-Za-z0-9_$.-]/g, '_').slice(0, 128) || 'Error',
    error_string: message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 2048),
  };
}

function boundedString(value, limit, label) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > limit ||
      /[\u0000-\u001f\u007f]/.test(value)) {
    throw new DiagnosticLimitError(label + ' is not bounded safe text');
  }
  return value;
}

function responseFacts(response) {
  // These synchronous cached getters are called identically in both modes.
  // No allHeaders(), headerValue(), finished(), or protocol request is added.
  const rawURL = boundedString(response.url(), 4096, 'Response URL');
  const parsed = new URL(rawURL);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new DiagnosticCaptureError('Response URL must use HTTP or HTTPS');
  }
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  const status = response.status();
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new DiagnosticCaptureError('Response status is not an HTTP status');
  }
  const allHeaders = response.headers();
  if (!allHeaders || typeof allHeaders !== 'object' || Array.isArray(allHeaders)) {
    throw new DiagnosticCaptureError('Response headers are not an object');
  }
  const headers = {};
  for (const name of HEADER_NAMES) {
    if (Object.hasOwn(allHeaders, name)) {
      const value = boundedString(allHeaders[name], 256, 'Response ' + name);
      if (name === 'content-length' && !/^\d{1,20}$/.test(value)) {
        throw new DiagnosticCaptureError('Response content-length is invalid');
      }
      if (name === 'content-encoding' && !/^[A-Za-z0-9, -]{1,128}$/.test(value)) {
        throw new DiagnosticCaptureError('Response content-encoding is invalid');
      }
      headers[name] = value;
    }
  }
  const request = response.request();
  const method = boundedString(request.method(), 16, 'Request method');
  if (!/^[A-Z]+$/.test(method)) {
    throw new DiagnosticCaptureError('Request method is invalid');
  }
  const failure = request.failure();
  if (failure !== null && (!failure || typeof failure !== 'object')) {
    throw new DiagnosticCaptureError('Request failure is not an object or null');
  }
  return {
    url: parsed.href,
    status,
    headers,
    method,
    request_failure: failure === null ? null :
      boundedString(failure.errorText, 2048, 'Request failure'),
  };
}

function positiveBoundedInteger(value, maximum, label) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(label + ' must be an integer from 1 to ' + maximum);
  }
}

/**
 * Create a bounded synthetic browser-response diagnostic.
 *
 * The caller must keep the real page default waitForResponse timeout finite
 * and <=45 seconds. Predicate and caller options are forwarded unchanged.
 * baseline starts body() at the helper's first body() call; eager starts it
 * synchronously in the selected waiter's fulfillment handler. Both return
 * exactly the promise returned by that one original body() invocation.
 *
 * Relative event/waiter/body times share diagnostics.clock_origin_ms, the
 * exact Node performance.now() origin. Add that origin to compare absolute
 * performance.now() action/server times without an estimated offset.
 *
 * Always await drain() after the helper settles, including on failure. Keep
 * the helper/action error as well: drain() reports adapter errors, not action
 * errors. dispose() drains and releases adapter-held response/promise refs
 * even when drain rejects. An unresolved browser operation is not cancelled.
 */
export function createDiagnosticCapturePage(realPlaywrightPage, {
  eager = false,
  onEvent,
  deadlineMs = MAX_DEADLINE_MS,
  maxEntries = MAX_ENTRIES,
  maxEvidenceBytes = MAX_EVIDENCE_BYTES,
} = {}) {
  if (!realPlaywrightPage || typeof realPlaywrightPage.waitForResponse !== 'function') {
    throw new TypeError('A real or synthetic Playwright page is required');
  }
  if (typeof eager !== 'boolean') throw new TypeError('eager must be boolean');
  if (onEvent !== undefined && typeof onEvent !== 'function') {
    throw new TypeError('onEvent must be a function');
  }
  positiveBoundedInteger(deadlineMs, MAX_DEADLINE_MS, 'deadlineMs');
  positiveBoundedInteger(maxEntries, MAX_ENTRIES, 'maxEntries');
  positiveBoundedInteger(maxEvidenceBytes, MAX_EVIDENCE_BYTES, 'maxEvidenceBytes');

  const records = [];
  const events = [];
  const states = [];
  const responseStates = new WeakMap();
  const pending = new Set();
  const clockStart = performance.now();
  const now = () => Math.max(0, performance.now() - clockStart);
  let firstFailure;
  let failed = false;
  let disposed = false;
  let evidenceBytes = 0;
  let drainPromise;

  function retainFailure(error) {
    if (!failed) {
      failed = true;
      firstFailure = error;
    }
    return error;
  }

  function checkBudget() {
    const bytes = Buffer.byteLength(JSON.stringify({ records, events }), 'utf8');
    if (bytes > maxEvidenceBytes) {
      throw retainFailure(new DiagnosticLimitError('Diagnostic evidence byte limit exceeded'));
    }
    evidenceBytes = bytes;
  }

  function update(object, patch) {
    const prior = {};
    for (const key of Object.keys(patch)) prior[key] = object[key];
    Object.assign(object, patch);
    try {
      checkBudget();
    } catch (error) {
      Object.assign(object, prior);
      throw error;
    }
  }

  function emit(record, event) {
    if (events.length >= maxEntries) {
      throw retainFailure(new DiagnosticLimitError('Diagnostic event entry limit exceeded'));
    }
    // This is an explicit allowlist, not a spread of response/error objects.
    const facts = Object.freeze({
      id: record.id,
      mode: record.mode,
      event,
      at_ms: now(),
      clock_origin_ms: clockStart,
      waiter_state: record.waiter.state,
      body_state: record.body.state,
      body_calls: record.body_calls,
      body_bytes: record.body.bytes,
      body_sha256: record.body.sha256,
      error_name: record.body.error_name || record.waiter.error_name,
      error_string: record.body.error_string || record.waiter.error_string,
    });
    events.push(facts);
    try {
      checkBudget();
    } catch (error) {
      events.pop();
      throw error;
    }
    if (onEvent) {
      try {
        const result = onEvent(facts);
        if (result && typeof result.then === 'function') observe(result);
      } catch (error) {
        throw retainFailure(error);
      }
    }
  }

  function observe(promise) {
    // The observed promise is never substituted for the helper's promise.
    // This rejection handler records failures and prevents unhandled rejection.
    let completion;
    completion = Promise.resolve(promise).then(
      () => { pending.delete(completion); },
      error => {
        retainFailure(error);
        pending.delete(completion);
      },
    );
    pending.add(completion);
    return completion;
  }

  function rejected(lifecycle, error) {
    // The original error is retained by reference but excluded from JSON/events.
    Object.defineProperty(lifecycle, 'error_ref', {
      value: error, configurable: true, enumerable: false,
    });
    retainFailure(error);
    update(lifecycle, { state: 'rejected', settled_ms: now(), ...safeError(error) });
  }

  function startBody(state) {
    if (state.bodyStarted) return state.bodyPromise;
    if (disposed) throw retainFailure(new DiagnosticCaptureError('Diagnostic adapter is disposed'));
    state.bodyStarted = true;
    const record = state.record;
    update(record.body, { state: 'pending', started_ms: now(), original_calls: 1 });
    let originalPromise;
    try {
      // The sole original body() call. Do not wrap/replace this promise.
      originalPromise = state.originalResponse.body();
    } catch (error) {
      state.bodySyncFailed = true;
      state.bodySyncError = error;
      try {
        rejected(record.body, error);
        emit(record, 'body_rejected');
      } catch (diagnosticError) {
        retainFailure(diagnosticError);
      }
      throw error;
    }
    if (!originalPromise || typeof originalPromise.then !== 'function') {
      throw retainFailure(new DiagnosticCaptureError('Response body() did not return a promise'));
    }
    state.bodyPromise = originalPromise;
    const observation = originalPromise.then(
      bytes => {
        if (!(bytes instanceof Uint8Array)) {
          throw new DiagnosticCaptureError('Response body must be Buffer or Uint8Array');
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        update(record.body, {
          state: 'fulfilled', settled_ms: now(), bytes: bytes.byteLength, sha256,
        });
        emit(record, 'body_fulfilled');
        // Only length/hash survive; bytes are never stored in records/events.
      },
      error => {
        rejected(record.body, error);
        emit(record, 'body_rejected');
      },
    );
    observe(observation);
    // Attach bookkeeping before onEvent can throw.
    emit(record, 'body_started');
    return originalPromise;
  }

  function wrapResponse(state) {
    // Empty target avoids retaining the original response as a Proxy target.
    return new Proxy({}, {
      get(_target, property) {
        if (property === 'body') return function diagnosticBody() {
          if (disposed) throw retainFailure(new DiagnosticCaptureError('Diagnostic adapter is disposed'));
          update(state.record, { body_calls: state.record.body_calls + 1 });
          const bodyState = state.shared || state;
          if (bodyState.bodySyncFailed) throw bodyState.bodySyncError;
          const promise = startBody(bodyState);
          emit(state.record, 'body_requested');
          return promise;
        };
        if (disposed || !state.originalResponse) {
          throw retainFailure(new DiagnosticCaptureError('Diagnostic adapter is disposed'));
        }
        const value = Reflect.get(state.originalResponse, property, state.originalResponse);
        return typeof value === 'function' ? value.bind(state.originalResponse) : value;
      },
    });
  }

  function waitForResponse(...args) {
    if (disposed) throw retainFailure(new DiagnosticCaptureError('Diagnostic adapter is disposed'));
    if (failed) throw firstFailure;
    if (records.length >= maxEntries) {
      throw retainFailure(new DiagnosticLimitError('Diagnostic waiter entry limit exceeded'));
    }
    const record = {
      id: records.length + 1,
      mode: eager ? 'eager' : 'baseline',
      started_ms: now(),
      waiter: { state: 'pending', settled_ms: null, error_name: null, error_string: null },
      response: { url: null, status: null, headers: {}, method: null, request_failure: null },
      body: {
        state: 'unstarted', started_ms: null, settled_ms: null,
        bytes: null, sha256: null, error_name: null, error_string: null, original_calls: 0,
      },
      body_calls: 0,
      disposed: false,
    };
    records.push(record);
    try {
      checkBudget();
    } catch (error) {
      records.pop();
      throw retainFailure(error);
    }
    try {
      emit(record, 'waiter_started');
    } catch (error) {
      throw retainFailure(error);
    }
    const state = {
      record, originalResponse: null, bodyPromise: null,
      bodyStarted: false, bodySyncFailed: false, bodySyncError: undefined, shared: null,
    };
    states.push(state);
    let originalWaiter;
    try {
      // Install the original listener now, before the helper invokes its action.
      // The approved predicate, timeout, and other options remain unchanged.
      originalWaiter = realPlaywrightPage.waitForResponse(...args);
    } catch (error) {
      try {
        rejected(record.waiter, error);
        emit(record, 'waiter_rejected');
      } catch (diagnosticError) {
        retainFailure(diagnosticError);
      }
      throw error;
    }
    const returnedWaiter = Promise.resolve(originalWaiter).then(
      response => {
        update(record.waiter, { state: 'fulfilled', settled_ms: now() });
        if (disposed) {
          throw new DiagnosticCaptureError('Response waiter settled after adapter disposal');
        }
        state.originalResponse = response;
        const existing = responseStates.get(response);
        if (existing) {
          state.shared = existing;
          update(record, { body: existing.record.body });
        } else responseStates.set(response, state);
        // Start eagerly before synchronous metadata getters/event callbacks.
        if (eager) startBody(state.shared || state);
        update(record.response, responseFacts(response));
        emit(record, 'waiter_fulfilled');
        return wrapResponse(state);
      },
      error => {
        try {
          rejected(record.waiter, error);
          emit(record, 'waiter_rejected');
        } catch (diagnosticError) {
          retainFailure(diagnosticError);
        }
        throw error; // Preserve the exact original waiter rejection.
      },
    );
    observe(returnedWaiter);
    return returnedWaiter;
  }

  const page = new Proxy(realPlaywrightPage, {
    get(target, property) {
      if (property === 'waitForResponse') return waitForResponse;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  async function runDrain() {
    const expires = performance.now() + deadlineMs;
    while (pending.size) {
      const remaining = expires - performance.now();
      if (remaining <= 0) {
        throw retainFailure(new DiagnosticDeadlineError('Diagnostic drain deadline exceeded'));
      }
      let timer;
      try {
        await Promise.race([
          Promise.all([...pending]),
          new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new DiagnosticDeadlineError(
              'Diagnostic drain deadline exceeded')), remaining);
          }),
        ]);
      } catch (error) {
        throw retainFailure(error);
      } finally {
        clearTimeout(timer);
      }
      // A resolving waiter may add its body/async event observation while the
      // captured batch drains. Keep waiting until the whole set is settled.
    }
    if (failed) throw firstFailure;
    return records;
  }

  function drain() {
    // Serial/concurrent callers share one finite drain; no retries.
    if (!drainPromise) {
      drainPromise = runDrain();
      // Observe without changing the promise/error supplied to the caller.
      drainPromise.catch(() => {});
    }
    return drainPromise;
  }

  async function dispose() {
    try {
      return await drain();
    } finally {
      disposed = true;
      for (const state of states) {
        state.originalResponse = null;
        state.bodyPromise = null;
        state.record.disposed = true;
      }
    }
  }

  const diagnostic = {
    page, records, events, drain, dispose,
    snapshot() {
      return JSON.parse(JSON.stringify({
        diagnostic_only: true, records, events, diagnostics: diagnostic.diagnostics,
      }));
    },
    originalBodyErrors() {
      const errors = new Map();
      for (const record of records) {
        if (Object.hasOwn(record.body, 'error_ref')) errors.set(record.id, record.body.error_ref);
      }
      return errors;
    },
    get diagnostics() {
      return {
        diagnostic_only: true, clock_origin_ms: clockStart, disposed, pending_count: pending.size,
        evidence_bytes: evidenceBytes, record_count: records.length,
        event_count: events.length, failed,
        ...(failed ? safeError(firstFailure) : { error_name: null, error_string: null }),
        retained_body_promises: states.filter(state => state.bodyPromise !== null).length,
        retained_responses: states.filter(state => state.originalResponse !== null).length,
      };
    },
  };
  Object.defineProperty(diagnostic, 'error_ref', {
    get: () => firstFailure, enumerable: false,
  });
  return diagnostic;
}
