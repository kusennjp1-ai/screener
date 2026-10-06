import { canonicalBytes, generationBody, invariant, isPackedData, limitsFor, parseCanonical, sha256, validateExpectedRoot, validateRoot, validateShard, validPath } from './format.mjs';
import { decodeBytes, fetchPinned } from './codec.mjs';
export { isPackedData, validateExpectedRoot } from './format.mjs';

/** expectedRoot is supplied by the authenticated publication/app binding, never
 * inferred by discovering transport files. This instance represents one immutable
 * generation; callers replace/dispose it when publication identity changes.
 */
export async function createStaticTransport({ baseURL, expectedRoot, fetchImpl = globalThis.fetch, signal, getCurrentGeneration, limits: overrides, decompressionStream = globalThis.DecompressionStream }) {
  validateExpectedRoot(expectedRoot);
  // Snapshot pins synchronously before any await or caller mutation.
  const pins = JSON.parse(JSON.stringify(expectedRoot));
  Object.freeze(pins.bindings); Object.freeze(pins);
  const limits = limitsFor(overrides), rootURL = new URL(baseURL);
  invariant(['https:', 'http:'].includes(rootURL.protocol) && !rootURL.username && !rootURL.password && !rootURL.search && !rootURL.hash && rootURL.pathname.endsWith('/'), 'Invalid transport baseURL');
  invariant(typeof fetchImpl === 'function', 'Unsupported transport: fetch unavailable');
  invariant(getCurrentGeneration === undefined || typeof getCurrentGeneration === 'function', 'Invalid generation accessor');
  const currentGeneration = getCurrentGeneration || (() => pins.generation);
  const lifetime = new AbortController(), cache = new Map(), pending = new Map(), pathIds = new Map();
  const abortLifetime = () => lifetime.abort(signal.reason);
  signal?.throwIfAborted(); signal?.addEventListener('abort', abortLifetime, { once: true });
  const guard = requestSignal => {
    lifetime.signal.throwIfAborted(); requestSignal?.throwIfAborted();
    invariant(currentGeneration() === pins.generation, 'Stale transport generation');
  };
  const dispose = () => {
    lifetime.abort(new DOMException('Transport disposed', 'AbortError'));
    signal?.removeEventListener('abort', abortLifetime);
    cache.clear(); pathIds.clear();
    for (const task of pending.values()) task.controller.abort(lifetime.signal.reason);
    pending.clear();
  };
  let root;
  try {
    guard();
    const bytes = await fetchPinned({ baseURL: rootURL, descriptor: pins, cap: limits.rootBytes, fetchImpl, signal: lifetime.signal, guard });
    root = validateRoot(parseCanonical(bytes), pins, limits);
    invariant(await sha256(canonicalBytes(generationBody(root))) === pins.generation, 'Transport generation digest mismatch'); guard();
  } catch (error) { dispose(); throw error; }

  // Cancellation belongs to each subscriber. One canceled request does not
  // cancel another request sharing its shard; the last subscriber cancels I/O.
  function subscribe(task, requestSignal) {
    guard(requestSignal); task.users++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, value) => {
        if (done) return; done = true;
        for (const item of [requestSignal, lifetime.signal]) item?.removeEventListener('abort', aborted);
        task.users--;
        if (!task.users && !task.settled) {
          task.controller.abort(new DOMException('No shard subscribers', 'AbortError'));
          if (pending.get(task.id) === task) pending.delete(task.id);
        }
        if (error) reject(error); else resolve(value);
      };
      const aborted = () => finish(requestSignal?.aborted ? requestSignal.reason : lifetime.signal.reason);
      for (const item of [requestSignal, lifetime.signal]) item?.addEventListener('abort', aborted, { once: true });
      task.promise.then(value => { try { guard(requestSignal); finish(null, value); } catch (error) { finish(error); } }, error => finish(error));
      if (requestSignal?.aborted || lifetime.signal.aborted) aborted();
    });
  }
  async function loadShard(id, requestSignal) {
    guard(requestSignal);
    if (cache.has(id)) { const entries = cache.get(id); cache.delete(id); cache.set(id, entries); return entries; }
    let task = pending.get(id);
    if (task?.controller.signal.aborted) { pending.delete(id); task = null; }
    if (!task) {
      invariant(pending.size < limits.pendingShards, 'Too many pending transport shards');
      task = { id, controller: new AbortController(), users: 0, settled: false };
      const item = task;
      const abort = () => item.controller.abort(lifetime.signal.reason);
      lifetime.signal.addEventListener('abort', abort, { once: true });
      item.promise = Promise.resolve().then(async () => {
        const check = () => guard(item.controller.signal);
        const bytes = await fetchPinned({ baseURL: rootURL, descriptor: root.shards[parseInt(id, 16)], cap: limits.shardBytes, fetchImpl, signal: item.controller.signal, guard: check });
        const entries = await validateShard(parseCanonical(bytes), id, limits, check); check();
        cache.set(id, entries);
        while (cache.size > limits.cachedShards) cache.delete(cache.keys().next().value);
        return entries;
      }).finally(() => {
        item.settled = true; lifetime.signal.removeEventListener('abort', abort);
        if (pending.get(id) === item) pending.delete(id);
      });
      // A canceled sole subscriber may leave nobody observing the shared promise.
      void item.promise.catch(() => {}); pending.set(id, item);
    }
    return subscribe(task, requestSignal);
  }
  async function lookup(path, { signal: requestSignal } = {}) {
    guard(requestSignal); invariant(validPath(path), 'Invalid logical transport path');
    // Coalesce the asynchronous digest too: callers for the same path must join
    // the shared shard task before the first caller can cancel its sole lease.
    let pathId = pathIds.get(path);
    if (!pathId) {
      invariant(pathIds.size < limits.pendingShards * 4, 'Too many pending transport path lookups');
      pathId = sha256(new TextEncoder().encode(path)).then(hash => hash.slice(0, 2)).finally(() => { if (pathIds.get(path) === pathId) pathIds.delete(path); });
      pathIds.set(path, pathId);
    }
    const id = await pathId; guard(requestSignal);
    const entries = await loadShard(id, requestSignal); guard(requestSignal);
    const entry = entries.get(path);
    invariant(entry || !isPackedData(path), `Missing compressed logical path: ${path}`);
    return entry;
  }
  async function readBytes(path, { signal: requestSignal, expectedDecodedSha256, expectedDecodedBytes } = {}) {
    guard(requestSignal);
    const entry = await lookup(path, { signal: requestSignal }); guard(requestSignal);
    invariant(entry, `Unknown logical transport path: ${path}`);
    if (expectedDecodedSha256 !== undefined) invariant(entry.decodedSha256 === expectedDecodedSha256, 'Logical source SHA-256 mismatch');
    if (expectedDecodedBytes !== undefined) invariant(entry.decodedBytes === expectedDecodedBytes, 'Logical source length mismatch');
    if (entry.kind === 'gzip') invariant(typeof decompressionStream === 'function', 'Unsupported transport: DecompressionStream(gzip) unavailable');
    const controller = new AbortController();
    const abort = () => controller.abort(requestSignal?.aborted ? requestSignal.reason : lifetime.signal.reason);
    for (const item of [requestSignal, lifetime.signal]) item?.addEventListener('abort', abort, { once: true });
    const check = () => guard(requestSignal);
    try {
      check();
      const encoded = await fetchPinned({ baseURL: rootURL, descriptor: { path: entry.assetPath, bytes: entry.encodedBytes, sha256: entry.encodedSha256 }, cap: limits.encodedBytes, fetchImpl, signal: controller.signal, guard: check });
      return await decodeBytes(encoded, entry, { signal: controller.signal, guard: check, decompressionStream });
    } finally {
      for (const item of [requestSignal, lifetime.signal]) item?.removeEventListener('abort', abort);
    }
  }
  return Object.freeze({ generation: pins.generation, lookup, readBytes,
    readJson: async (path, options) => {
      const bytes = await readBytes(path, options); guard(options?.signal);
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      guard(options?.signal); return value;
    }, dispose });
}
