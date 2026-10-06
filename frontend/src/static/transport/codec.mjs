import { equalBytes, invariant, sha256 } from './format.mjs';

export async function consumeBounded(stream, cap, { signal, guard = () => {} } = {}) {
  invariant(stream?.getReader, 'Missing byte stream');
  guard(); signal?.throwIfAborted();
  const reader = stream.getReader(), chunks = []; let size = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      guard(); signal?.throwIfAborted();
      const { done, value } = await reader.read();
      guard(); signal?.throwIfAborted();
      if (done) break;
      invariant(value instanceof Uint8Array, 'Non-byte stream');
      size += value.byteLength;
      invariant(size <= cap, 'Byte stream exceeds permitted size');
      // Own chunks: a custom fetch stream must not mutate verified bytes later.
      chunks.push(new Uint8Array(value));
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    guard(); signal?.throwIfAborted(); return bytes;
  } catch (error) { void reader.cancel(error).catch(() => {}); throw error; }
  finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
}

export async function fetchPinned({ baseURL, descriptor, cap, fetchImpl, signal, guard = () => {} }) {
  guard(); signal?.throwIfAborted();
  invariant(descriptor.bytes <= cap, 'Transport resource cap exceeded');
  const url = new URL(descriptor.path, baseURL);
  invariant(url.origin === baseURL.origin && url.pathname.startsWith(baseURL.pathname), 'Transport URL escapes root');
  let response;
  try {
    response = await fetchImpl(url.href, { signal, redirect: 'error', cache: descriptor.path.startsWith('static-data/_transport/') ? 'force-cache' : 'no-cache', headers: { Accept: 'application/octet-stream' } });
    guard(); signal?.throwIfAborted();
    invariant(response.ok && !response.redirected, `Transport HTTP failure: ${response.status}`);
    // Hash the Fetch body, i.e. the file representation after HTTP transfer
    // decoding. Normal HTTP gzip/br is harmless only when these pins still match.
    const bytes = await consumeBounded(response.body, descriptor.bytes, { signal, guard });
    invariant(bytes.length === descriptor.bytes, 'Transport encoded length mismatch');
    invariant(await sha256(bytes) === descriptor.sha256, 'Transport encoded SHA-256 mismatch');
    guard(); signal?.throwIfAborted(); return bytes;
  } catch (error) {
    if (response?.body && !response.body.locked) void response.body.cancel(error).catch(() => {});
    throw error;
  }
}

/** Uses the WHATWG one-member gzip contract, also exercised in Node and Chromium.
 * Returned input/output bytes are bounded. Native inflater internal heap is not.
 */
export async function decodeBytes(encoded, entry, { signal, guard = () => {}, decompressionStream = globalThis.DecompressionStream } = {}) {
  guard(); signal?.throwIfAborted();
  let decoded = encoded;
  if (entry.kind === 'gzip') {
    invariant(encoded.length >= 20 && equalBytes(encoded.subarray(0, 9), Uint8Array.of(31, 139, 8, 0, 0, 0, 0, 0, 0)), 'Noncanonical gzip framing');
    const trailer = new DataView(encoded.buffer, encoded.byteOffset + encoded.length - 4, 4);
    invariant(trailer.getUint32(0, true) === entry.decodedBytes, 'Gzip declared output length mismatch');
    invariant(typeof decompressionStream === 'function', 'Unsupported transport: DecompressionStream(gzip) unavailable');
    let inflater;
    try { inflater = new decompressionStream('gzip'); } catch { throw new Error('Unsupported transport: DecompressionStream(gzip) unavailable'); }
    let offset = 0;
    const input = new ReadableStream({ pull(controller) {
      guard(); signal?.throwIfAborted();
      if (offset === encoded.length) { controller.close(); return; }
      const end = Math.min(offset + 1024, encoded.length);
      controller.enqueue(encoded.subarray(offset, end)); offset = end;
    } }, { highWaterMark: 0 });
    // The standard mandates rejecting truncation, trailing junk, additional
    // members, and bad CRC/ISIZE. Never use Node gunzip as a permissive fallback.
    decoded = await consumeBounded(input.pipeThrough(inflater), entry.decodedBytes, { signal, guard });
  }
  invariant(decoded.length === entry.decodedBytes, 'Transport decoded length mismatch');
  invariant(await sha256(decoded) === entry.decodedSha256, 'Transport decoded SHA-256 mismatch');
  guard(); signal?.throwIfAborted(); return decoded;
}
