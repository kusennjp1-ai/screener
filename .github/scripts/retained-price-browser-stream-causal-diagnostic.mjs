// Diagnostic only. Serialize this self-contained function into addInitScript.
// It does not fetch, consume an extra byte, retry, or alter approved codecs.
export const diagnostic_only = true;

export function installBrowserStreamCausalDiagnostic({
  targetPaths,
  maxEvents = 512,
  maxBytes = 256 * 1024,
  maxEntries,
  maxEvidenceBytes,
  maxBodyBytes = 64 * 1024 * 1024,
  flushDeadlineMs = 5000,
  realm = globalThis,
} = {}) {
  // Aliases support the runner's existing bound names without changing caps.
  if (maxEntries !== undefined) maxEvents = maxEntries;
  if (maxEvidenceBytes !== undefined) maxBytes = maxEvidenceBytes;
  const positive = (value, limit, label) => {
    if (!Number.isInteger(value) || value < 1 || value > limit) {
      throw new RangeError(label + ' exceeds its diagnostic bound');
    }
  };
  positive(maxEvents, 4096, 'maxEvents');
  positive(maxBytes, 1024 * 1024, 'maxBytes');
  positive(maxBodyBytes, 64 * 1024 * 1024, 'maxBodyBytes');
  positive(flushDeadlineMs, 45_000, 'flushDeadlineMs');
  if (!Array.isArray(targetPaths) || !targetPaths.length || targetPaths.length > 64) {
    throw new TypeError('Explicit targetPaths are required');
  }
  if (!realm.WeakRef || !realm.crypto?.subtle || !realm.performance) {
    throw new Error('WeakRef, Web Crypto, and performance clocks are required');
  }
  if (realm.__retainedPriceStreamDiagnostic) throw new Error('Stream diagnostic is already installed');

  const encoder = new realm.TextEncoder();
  const clockOrigin = realm.performance.timeOrigin;
  if (!Number.isFinite(clockOrigin)) throw new Error('Finite performance.timeOrigin is required');
  const baseURL = realm.location?.href || 'https://synthetic.invalid/';
  const targets = targetPaths.map(path => {
    if (typeof path !== 'string' || encoder.encode(path).byteLength > 2048) {
      throw new TypeError('Target path is not bounded text');
    }
    const url = new realm.URL(path, baseURL);
    if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('HTTP targets are required');
    return { path: url.pathname, origin: /^https?:\/\//.test(path) ? url.origin : null };
  });
  const events = [];
  const patches = [];
  const pending = new Set();
  const readers = new Set();
  const signals = [];
  let controllerMap = new WeakMap();
  let signalMap = new WeakMap();
  let responseMap = new WeakMap();
  let streamMap = new WeakMap();
  let readerMap = new WeakMap();
  let restored = false;
  let firstDiagnosticError = null;
  let eventBytes = 0;
  let droppedEventCount = 0;
  let retainedChunkBytes = 0;
  let nextRequest = 0, nextResponse = 0, nextStream = 0, nextReader = 0, nextSignal = 0, nextController = 0;
  let pendingAtRestore = 0;

  const safeError = error => {
    let name = 'Error', message = 'Unknown error';
    try {
      name = typeof error?.name === 'string' ? error.name : name;
      message = typeof error?.message === 'string' ? error.message : String(error);
    } catch { message = 'Unprintable error'; }
    return {
      error_name: name.replace(/[^A-Za-z0-9_$.-]/g, '_').slice(0, 128) || 'Error',
      error_string: message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 2048),
    };
  };
  const fail = error => {
    if (!firstDiagnosticError) firstDiagnosticError = error;
    return error;
  };
  const diagnosticError = message => {
    const error = new Error(message);
    error.name = 'StreamDiagnosticError';
    return fail(error);
  };
  const text = (value, limit, label) => {
    if (typeof value !== 'string' || encoder.encode(value).byteLength > limit ||
        /[\u0000-\u001f\u007f]/.test(value)) throw diagnosticError(label + ' is not bounded text');
    return value;
  };
  const stackPrefix = () => {
    // This is our capture-point stack, never an arbitrary error/reason stack.
    const value = new Error('Synthetic diagnostic call site').stack || '';
    return value.split('\n').slice(0, 6).join('\n').slice(0, 1024)
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ');
  };
  const stamp = () => {
    const relative = realm.performance.now();
    return { performance_origin_ms: clockOrigin, performance_ms: relative, epoch_ms: clockOrigin + relative };
  };
  const emit = (kind, fields = {}) => {
    if (restored) return;
    try {
      if (events.length >= maxEvents) {
        droppedEventCount++;
        throw diagnosticError('Event entry limit exceeded');
      }
      const event = Object.freeze({ kind, ...stamp(), ...fields });
      const bytes = encoder.encode(JSON.stringify(event)).byteLength;
      if (eventBytes + bytes > maxBytes) {
        droppedEventCount++;
        throw diagnosticError('Event byte limit exceeded');
      }
      events.push(event);
      eventBytes += bytes;
    } catch (error) { fail(error); }
  };
  const observe = (promise, fulfilled, rejected) => {
    if (pending.size >= maxEvents) throw diagnosticError('Pending observation limit exceeded');
    let completion;
    completion = Promise.resolve(promise).then(
      value => {
        if (!restored) {
          try { fulfilled?.(value); } catch (error) { fail(error); }
        }
        pending.delete(completion);
      },
      error => {
        if (!restored) {
          try { rejected?.(error); } catch (diagnosticFailure) { fail(diagnosticFailure); }
        }
        pending.delete(completion);
      },
    );
    pending.add(completion);
  };
  const rememberNativeError = (kind, error, fields) => {
    emit(kind, { ...fields, ...safeError(error) });
  };
  const instrument = action => {
    // Telemetry failure is visible through flush/snapshot, without substituting
    // a diagnostic error for a native promise/result/error.
    try { action(); } catch (error) { fail(error); }
  };
  const patch = (object, key, wrapper) => {
    if (!object) return;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || typeof descriptor.value !== 'function' ||
        (!descriptor.writable && !descriptor.configurable)) {
      throw diagnosticError('Cannot wrap native ' + key);
    }
    const original = descriptor.value;
    Object.defineProperty(object, key, { ...descriptor, value: wrapper(original) });
    patches.push({ object, key, descriptor });
  };
  const ids = meta => ({
    request_id: meta.request_id, response_id: meta.response_id || null,
    stream_id: meta.stream_id || null, reader_id: meta.reader_id || null,
    signal_id: meta.signal_id || null,
  });
  const safeURL = value => {
    const url = new realm.URL(text(value, 4096, 'URL'), baseURL);
    if (!['http:', 'https:'].includes(url.protocol)) throw diagnosticError('Non-HTTP URL');
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.href;
  };
  const isTarget = value => {
    const url = new realm.URL(value, baseURL);
    return targets.some(target => target.path === url.pathname &&
      (target.origin === null || target.origin === url.origin));
  };
  const nativeRequestURL = realm.Request &&
    Object.getOwnPropertyDescriptor(realm.Request.prototype, 'url')?.get;
  const nativeRequestSignal = realm.Request &&
    Object.getOwnPropertyDescriptor(realm.Request.prototype, 'signal')?.get;
  const requestInput = input => {
    if (typeof input === 'string') return input;
    if (realm.URL && input instanceof realm.URL) return input.href;
    if (nativeRequestURL && input instanceof realm.Request) return nativeRequestURL.call(input);
    return null;
  };
  const requestSignal = (input, init) => {
    if (init && typeof init === 'object') {
      const descriptor = Object.getOwnPropertyDescriptor(init, 'signal');
      if (descriptor) {
        // Do not invoke an options accessor a second time.
        return Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
      }
    }
    return nativeRequestSignal && input instanceof realm.Request ? nativeRequestSignal.call(input) : null;
  };
  const signalForController = realm.AbortController &&
    Object.getOwnPropertyDescriptor(realm.AbortController.prototype, 'signal')?.get;
  const controllerSignal = controller => signalForController ? signalForController.call(controller) :
    Object.getOwnPropertyDescriptor(controller, 'signal')?.value;

  const bindSignal = (signal, requestId) => {
    if (!signal || typeof signal.addEventListener !== 'function') return null;
    let state = signalMap.get(signal);
    if (!state) {
      if (signals.length >= maxEvents) throw diagnosticError('Signal entry limit exceeded');
      state = { signal_id: ++nextSignal, request_ids: [], first_abort: null };
      signalMap.set(signal, state);
      const listener = () => instrument(() => {
        if (!state.first_abort) state.first_abort = { cause: 'signal_abort', ...stamp() };
        emit('signal_abort', {
          signal_id: state.signal_id, request_ids: [...state.request_ids],
          first_abort: state.first_abort,
        });
      });
      signal.addEventListener('abort', listener);
      signals.push({ reference: new realm.WeakRef(signal), listener });
      if (signal.aborted) {
        state.first_abort = { cause: 'already_aborted_at_fetch', ...stamp() };
        emit('signal_already_aborted', { signal_id: state.signal_id });
      }
    }
    if (state.request_ids.length >= 64) throw diagnosticError('Signal request mapping limit exceeded');
    state.request_ids.push(requestId);
    return state;
  };
  const clearChunks = state => {
    retainedChunkBytes -= state.retained_bytes;
    state.retained_bytes = 0;
    state.chunks.length = 0;
  };
  const bodyFailure = (state, error, kind) => {
    state.hash_failed = true;
    clearChunks(state);
    rememberNativeError(kind, error, ids(state));
  };
  const finishBody = state => {
    if (state.eof) return;
    state.eof = true;
    emit('reader_eof', { ...ids(state), native_body_bytes: state.bytes, read_calls: state.read_calls });
    if (state.hash_failed) { clearChunks(state); return; }
    const collected = new Uint8Array(state.bytes);
    let offset = 0;
    for (const chunk of state.chunks) { collected.set(chunk, offset); offset += chunk.byteLength; }
    clearChunks(state);
    const digest = realm.crypto.subtle.digest('SHA-256', collected);
    observe(digest, value => {
      const sha = Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
      state.sha256 = sha;
      emit('reader_body_hash', { ...ids(state), native_body_bytes: state.bytes, native_body_sha256: sha });
    }, error => {
      state.hash_failed = true;
      fail(error);
      rememberNativeError('digest_error', error, ids(state));
    });
  };
  const onRead = (state, result) => {
    if (state.eof) return;
    if (!result || typeof result.done !== 'boolean') throw diagnosticError('Invalid native reader result');
    if (result.done) { finishBody(state); return; }
    const value = result.value;
    if (!(value instanceof Uint8Array)) {
      state.hash_failed = true; clearChunks(state);
      throw diagnosticError('Native body chunk must be Uint8Array');
    }
    state.bytes += value.byteLength;
    if (state.hash_failed) return;
    const chunkRefs = [...readers].reduce((count, reader) => count + reader.chunks.length, 0);
    if (state.bytes > maxBodyBytes || retainedChunkBytes + value.byteLength > maxBodyBytes ||
        chunkRefs >= 65_536) {
      state.hash_failed = true; clearChunks(state);
      throw diagnosticError('Native body copy limit exceeded');
    }
    const copy = new Uint8Array(value);
    state.chunks.push(copy);
    state.retained_bytes += copy.byteLength;
    retainedChunkBytes += copy.byteLength;
    if (state.chunks.length === 1) emit('reader_first_chunk', { ...ids(state), chunk_bytes: copy.byteLength });
  };

  try {
    patch(realm, 'fetch', original => function diagnosticFetch(...args) {
      let result;
      try { result = Reflect.apply(original, this, args); }
      catch (error) {
        instrument(() => rememberNativeError('fetch_sync_error', error, {}));
        throw error;
      }
      instrument(() => {
        const rawURL = requestInput(args[0]);
        if (!rawURL || !isTarget(rawURL)) return;
        const signal = bindSignal(requestSignal(args[0], args[1]), ++nextRequest);
        const meta = { request_id: nextRequest, signal_id: signal?.signal_id || null, url: safeURL(rawURL) };
        emit('fetch_call', { ...ids(meta), url: safeURL(rawURL), signal_aborted: Boolean(signal?.first_abort) });
        observe(result, response => {
          meta.response_id = ++nextResponse;
          responseMap.set(response, meta);
          meta.url = safeURL(response.url || rawURL);
          const body = response.body;
          if (body) {
            meta.stream_id = ++nextStream;
            streamMap.set(body, meta);
          }
          const length = response.headers.get('content-length');
          const type = response.headers.get('content-type');
          emit('fetch_response', {
            ...ids(meta), url: safeURL(response.url || rawURL),
            status: Number.isInteger(response.status) ? response.status : null,
            content_length: length === null ? null : text(length, 32, 'Content-Length'),
            content_type: type === null ? null : text(type, 256, 'Content-Type'),
            response_retained: false,
          });
        }, error => rememberNativeError('fetch_rejected', error, ids(meta)));
      });
      return result;
    });

    patch(realm.AbortController?.prototype, 'abort', original => function diagnosticAbort(...args) {
      let signalState = null;
      instrument(() => {
        signalState = signalMap.get(controllerSignal(this)) || null;
        if (!signalState) return;
        let controllerId = controllerMap.get(this);
        if (!controllerId) { controllerId = ++nextController; controllerMap.set(this, controllerId); }
        if (!signalState.first_abort) signalState.first_abort = { cause: 'controller_abort_call', ...stamp() };
        emit('controller_abort_call', {
          controller_id: controllerId, signal_id: signalState.signal_id,
          request_ids: [...signalState.request_ids], argument_count: args.length,
          stack_prefix: stackPrefix(), first_abort: signalState.first_abort,
        });
      });
      try {
        const result = Reflect.apply(original, this, args);
        if (signalState) emit('controller_abort_return', { signal_id: signalState.signal_id });
        return result;
      } catch (error) {
        if (signalState) instrument(() => rememberNativeError('controller_abort_error', error, { signal_id: signalState.signal_id }));
        throw error;
      }
    });

    patch(realm.ReadableStream?.prototype, 'getReader', original => function diagnosticGetReader(...args) {
      let result;
      try { result = Reflect.apply(original, this, args); }
      catch (error) {
        const meta = streamMap.get(this);
        if (meta) instrument(() => rememberNativeError('reader_acquire_error', error, ids(meta)));
        throw error;
      }
      instrument(() => {
        const meta = streamMap.get(this);
        if (!meta) return;
        if (readers.size >= maxEvents) throw diagnosticError('Reader entry limit exceeded');
        const state = {
          ...meta, reader_id: ++nextReader, bytes: 0, retained_bytes: 0,
          chunks: [], read_calls: 0, eof: false, sha256: null, hash_failed: false,
        };
        readerMap.set(result, state);
        readers.add(state);
        emit('reader_acquired', { ...ids(state), argument_count: args.length });
      });
      return result;
    });

    const patchCancel = (prototype, kind, metadata) => patch(prototype, 'cancel', original =>
      function diagnosticCancel(...args) {
        const meta = metadata.get(this);
        if (meta) emit(kind + '_call', { ...ids(meta), argument_count: args.length, stack_prefix: stackPrefix() });
        try {
          const result = Reflect.apply(original, this, args);
          if (meta) instrument(() => {
            if (meta.chunks) { meta.hash_failed = !meta.eof; clearChunks(meta); }
            observe(result,
              () => emit(kind + '_fulfilled', ids(meta)),
              error => rememberNativeError(kind + '_rejected', error, ids(meta)));
          });
          return result;
        } catch (error) {
          if (meta) instrument(() => rememberNativeError(kind + '_error', error, ids(meta)));
          throw error;
        }
      });
    patchCancel(realm.ReadableStream?.prototype, 'stream_cancel', streamMap);
    for (const prototype of [realm.ReadableStreamDefaultReader?.prototype, realm.ReadableStreamBYOBReader?.prototype]) {
      if (!prototype) continue;
      patchCancel(prototype, 'reader_cancel', readerMap);
      patch(prototype, 'read', original => function diagnosticRead(...args) {
        const state = readerMap.get(this);
        let result;
        try { result = Reflect.apply(original, this, args); }
        catch (error) {
          if (state) instrument(() => bodyFailure(state, error, 'reader_read_error'));
          throw error;
        }
        if (state) instrument(() => {
          state.read_calls++;
          if (state.read_calls === 1) emit('reader_first_read', { ...ids(state), argument_count: args.length });
          observe(result, value => onRead(state, value), error => bodyFailure(state, error, 'reader_read_rejected'));
        });
        return result;
      });
      patch(prototype, 'releaseLock', original => function diagnosticReleaseLock(...args) {
        const state = readerMap.get(this);
        if (state) emit('reader_release_lock_call', { ...ids(state), argument_count: args.length, eof: state.eof });
        try {
          const result = Reflect.apply(original, this, args);
          if (state) instrument(() => {
            if (!state.eof) { state.hash_failed = true; clearChunks(state); }
            emit('reader_release_lock_return', { ...ids(state), eof: state.eof });
          });
          return result;
        } catch (error) {
          if (state) instrument(() => rememberNativeError('reader_release_lock_error', error, ids(state)));
          throw error;
        }
      });
    }
  } catch (error) {
    for (const entry of patches.reverse()) Object.defineProperty(entry.object, entry.key, entry.descriptor);
    throw error;
  }

  const markFields = facts => {
    if (!facts || typeof facts !== 'object' || Array.isArray(facts)) throw diagnosticError('Typed facts are required');
    const allowed = new Set([
      'label', 'phase', 'state', 'request_id', 'response_id', 'reader_id',
      'retained', 'encoded_bytes', 'encoded_sha256', 'decoded_bytes',
      'decoded_sha256', 'encoded_hash_checked', 'decoded_hash_checked',
      'error_name', 'error_string', 'node_performance_origin_ms',
      'node_before_ms', 'node_after_ms', 'browser_performance_ms',
      'browser_performance_origin_ms',
    ]);
    const output = {};
    for (const [key, value] of Object.entries(facts)) {
      if (!allowed.has(key)) throw diagnosticError('Unexpected typed fact ' + key);
      if (value === null || typeof value === 'boolean') output[key] = value;
      else if (typeof value === 'number' && Number.isFinite(value) && value >= 0) output[key] = value;
      else if (typeof value === 'string') output[key] = text(value, key === 'error_string' ? 2048 : 256, key);
      else throw diagnosticError('Invalid typed fact ' + key);
      if (key.endsWith('sha256') && value !== null && !/^[a-f0-9]{64}$/.test(value)) {
        throw diagnosticError('Invalid SHA-256 fact');
      }
    }
    return output;
  };
  const mark = (kind, facts) => {
    instrument(() => emit(kind, markFields(facts)));
    return firstDiagnosticError === null;
  };
  const api = {
    markDisposal(label) {
      instrument(() => mark('disposal', { label: text(label, 128, 'Disposal label') }));
      return firstDiagnosticError === null;
    },
    markUiOutcome(facts) { return mark('ui_terminal', facts); },
    markResponseRetention(facts) { return mark('response_retention', facts); },
    markCalibration(facts) { return mark('clock_calibration', facts); },
    snapshot() {
      return JSON.parse(JSON.stringify({
        diagnostic_only: true, clock: { performance_origin_ms: clockOrigin }, events,
        readers: [...readers].map(state => ({
          ...ids(state), url: state.url, native_body_bytes: state.bytes,
          read_calls: state.read_calls, eof: state.eof,
          native_body_sha256: state.sha256, hash_failed: state.hash_failed,
          copied_chunk_bytes: state.retained_bytes, copied_chunk_refs: state.chunks.length,
        })),
        diagnostics: {
          restored, failed: firstDiagnosticError !== null,
          ...(firstDiagnosticError ? safeError(firstDiagnosticError) :
            { error_name: null, error_string: null }),
          event_count: events.length, event_bytes: eventBytes,
          dropped_event_count: droppedEventCount, pending_count: pending.size,
          pending_at_restore: pendingAtRestore, copied_chunk_bytes: retainedChunkBytes,
          copied_chunk_refs: [...readers].reduce((count, state) => count + state.chunks.length, 0),
          retained_responses: 0,
        },
      }));
    },
    async drain() {
      const deadline = realm.performance.now() + flushDeadlineMs;
      while (pending.size) {
        const remaining = deadline - realm.performance.now();
        if (remaining <= 0) throw diagnosticError('Telemetry drain deadline exceeded');
        let timer;
        try {
          await Promise.race([
            Promise.all([...pending]),
            new Promise((_resolve, reject) => {
              timer = realm.setTimeout(() => reject(diagnosticError('Telemetry flush deadline exceeded')), remaining);
            }),
          ]);
        } finally { realm.clearTimeout(timer); }
      }
      if (firstDiagnosticError) throw firstDiagnosticError;
      return api.snapshot();
    },
    restore() {
      if (restored) return;
      pendingAtRestore = pending.size;
      restored = true;
      for (const state of readers) clearChunks(state);
      for (const entry of signals) {
        const signal = entry.reference.deref();
        if (signal) signal.removeEventListener('abort', entry.listener);
      }
      for (const entry of patches.reverse()) Object.defineProperty(entry.object, entry.key, entry.descriptor);
      patches.length = 0; signals.length = 0;
      controllerMap = new WeakMap(); signalMap = new WeakMap();
      responseMap = new WeakMap(); streamMap = new WeakMap(); readerMap = new WeakMap();
      // Pending native operations are not cancelled or hidden. drain() still
      // observes their settlement/deadline; pending_at_restore exposes them.
    },
  };
  Object.defineProperty(api, 'diagnostic_error_ref', { get: () => firstDiagnosticError, enumerable: false });
  realm.__retainedPriceStreamDiagnostic = api;
  return api;
}
