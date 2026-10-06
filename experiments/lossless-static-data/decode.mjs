// Browser/worker ESM: no Node imports, dependencies, automatic app integration, or raw fallback.
import { DEFAULT_LIMITS, canonicalBytes, generationBytes, hex, invariant, validHash, validateManifest } from './format.mjs';

const digest = async bytes => {
  invariant(globalThis.crypto?.subtle, 'Unsupported decoder: Web Crypto SHA-256 unavailable');
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)));
};
function limitsFor(overrides = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const key of Object.keys(limits)) invariant(Object.hasOwn(DEFAULT_LIMITS, key) && Number.isSafeInteger(limits[key]) && limits[key] > 0 && limits[key] <= DEFAULT_LIMITS[key], `Invalid decoder limit: ${key}`);
  return limits;
}
function equalBytes(a, b) { return a.length === b.length && a.every((byte, index) => byte === b[index]); }
async function consumeBounded(stream, cap, { signal, guard }) {
  invariant(stream?.getReader, 'Missing byte stream');
  guard();
  const reader = stream.getReader(), chunks = []; let size = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      guard();
      const { done, value } = await reader.read();
      guard();
      if (done) break;
      invariant(value instanceof Uint8Array, 'Non-byte stream');
      size += value.byteLength;
      invariant(size <= cap, 'Byte stream exceeds permitted size');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    guard(); return bytes;
  } catch (error) { void reader.cancel(error).catch(() => {}); throw error; }
  finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
}

/** Pins must come from an authenticated caller/bootstrap, not merely the same fetched receipt. */
export async function openTransport({ manifestBytes, expectedManifestSha256, expectedManifestBytes, expectedGeneration, rootUrl, fetchImpl = globalThis.fetch, decompressionStream = globalThis.DecompressionStream, getCurrentGeneration = () => expectedGeneration, signal, limits: overrides }) {
  const limits = limitsFor(overrides);
  const guard = requestSignal => {
    signal?.throwIfAborted(); requestSignal?.throwIfAborted();
    invariant(getCurrentGeneration() === expectedGeneration, 'Stale transport generation');
  };
  guard();
  invariant(validHash(expectedManifestSha256) && validHash(expectedGeneration), 'Missing trusted manifest pins');
  invariant(manifestBytes instanceof Uint8Array && Number.isSafeInteger(expectedManifestBytes) && expectedManifestBytes > 0 && manifestBytes.length === expectedManifestBytes && manifestBytes.length <= limits.manifestBytes, 'Manifest byte length mismatch or cap exceeded');
  // Own the bytes: callers cannot mutate them during asynchronous integrity checks.
  manifestBytes = new Uint8Array(manifestBytes);
  invariant(await digest(manifestBytes) === expectedManifestSha256, 'Manifest SHA-256 mismatch'); guard();
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  invariant(equalBytes(canonicalBytes(manifest), manifestBytes), 'Noncanonical or duplicate-key manifest');
  const entries = validateManifest(manifest);
  invariant(manifest.generation === expectedGeneration && await digest(generationBytes(manifest.files)) === expectedGeneration, 'Manifest generation mismatch'); guard();
  const root = new URL(rootUrl);
  invariant(['http:', 'https:'].includes(root.protocol) && !root.username && !root.password && !root.search && !root.hash && root.pathname.endsWith('/'), 'Invalid transport root URL');
  invariant(typeof fetchImpl === 'function', 'Unsupported decoder: fetch unavailable');
  const readBytes = async (path, { signal: requestSignal, expectedDecodedSha256, expectedDecodedBytes } = {}) => {
    const check = () => guard(requestSignal); check();
    const entry = entries.get(path);
    invariant(entry, `Unknown logical path: ${path}`);
    invariant(entry.encodedBytes <= limits.encodedBytes && entry.decodedBytes <= limits.decodedBytes, 'Asset exceeds decoder cap');
    if (expectedDecodedSha256 !== undefined) invariant(entry.decodedSha256 === expectedDecodedSha256, 'Logical source SHA-256 mismatch');
    if (expectedDecodedBytes !== undefined) invariant(entry.decodedBytes === expectedDecodedBytes, 'Logical source length mismatch');
    if (entry.kind === 'gzip') invariant(typeof decompressionStream === 'function', 'Unsupported decoder: DecompressionStream(gzip) unavailable');
    const url = new URL(entry.assetPath, root);
    invariant(url.origin === root.origin && url.pathname.startsWith(root.pathname), 'Asset URL escapes transport root');
    const abortController = new AbortController();
    const abortRequest = () => abortController.abort(requestSignal?.aborted ? requestSignal.reason : signal?.reason);
    for (const item of [signal, requestSignal]) item?.addEventListener('abort', abortRequest, { once: true });
    const combined = signal && requestSignal ? abortController.signal : signal || requestSignal;
    let response;
    try {
    response = await fetchImpl(url.href, { signal: combined, redirect: 'error', cache: entry.kind === 'gzip' ? 'force-cache' : 'no-cache', headers: { Accept: 'application/octet-stream' } });
    check();
    invariant(response.ok, `Asset HTTP failure: ${response.status}`);
    invariant(!response.headers?.get('Content-Encoding') || response.headers.get('Content-Encoding') === 'identity', 'HTTP content encoding would alter pinned bytes');
    const encoded = await consumeBounded(response.body, entry.encodedBytes, { signal: combined, guard: check });
    invariant(encoded.length === entry.encodedBytes, 'Encoded length mismatch');
    invariant(await digest(encoded) === entry.encodedSha256, 'Encoded SHA-256 mismatch'); check();
    let decoded = encoded;
    if (entry.kind === 'gzip') {
      let inflater;
      try { inflater = new decompressionStream('gzip'); } catch { throw new Error('Unsupported decoder: DecompressionStream(gzip) unavailable'); }
      // Native inflaters can expand an entire input chunk before yielding output.
      // Feed at most 1 KiB per pull with source high-water mark zero. Native
      // queues can still read ahead; their total heap use is not controlled here.
      let offset = 0;
      const input = new ReadableStream({ pull(controller) {
        check();
        if (offset === encoded.length) { controller.close(); return; }
        const end = Math.min(offset + 1024, encoded.length);
        controller.enqueue(encoded.subarray(offset, end)); offset = end;
      } }, { highWaterMark: 0 });
      decoded = await consumeBounded(input.pipeThrough(inflater), Math.min(entry.decodedBytes, limits.decodedBytes), { signal: combined, guard: check });
    }
    invariant(decoded.length === entry.decodedBytes, 'Decoded length mismatch');
    invariant(await digest(decoded) === entry.decodedSha256, 'Decoded SHA-256 mismatch'); check();
    return decoded;
    } catch (error) {
      if (response?.body && !response.body.locked) void response.body.cancel(error).catch(() => {});
      throw error;
    } finally {
      for (const item of [signal, requestSignal]) item?.removeEventListener('abort', abortRequest);
    }
  };
  return Object.freeze({ generation: expectedGeneration, lookup: path => entries.get(path), readBytes,
    readJson: async (path, options) => {
      const bytes = await readBytes(path, options);
      guard(options?.signal);
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      guard(options?.signal); return value;
    } });
}
