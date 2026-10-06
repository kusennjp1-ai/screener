import { createStaticTransport, validateExpectedRoot } from './transport/index.mjs';
import { getStaticDataUrl } from '../config/runtimeMode';
import { consumeBounded } from './transport/codec.mjs';

const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
// The full publication receipt currently includes the UI inventory. Bound the
// streamed bytes independently of optional/incorrect HTTP Content-Length.
export const STATIC_METADATA_LIMITS = Object.freeze({ publication: 4 * 1024 * 1024, manifest: 256 * 1024 });
const contexts = new WeakMap();
const generations = new Map();
const readers = new Map();
const largeReads = { active: false, waiting: [] };
let currentPublication;
let publicationRequest = 0;
let transportDeclared = false;
let latestSnapshot;

const siteBase = () => new URL('../', new URL(getStaticDataUrl(''), location.href)).href;
const logicalGeneration = manifest => manifest.research_generation || manifest.generated_at || null;
const fail = message => { throw Error(`Static publication ${message}`); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).sort().join() === [...keys].sort().join();
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

async function readMetadata(url, cap, optional = false) {
  const response = await fetch(url, { cache: 'no-cache', headers: { Accept: 'application/json' } });
  if (optional && response.status === 404) return null;
  if (!response.ok) fail(`metadata unavailable (${response.status})`);
  const bytes = await consumeBounded(response.body, cap);
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!plain(value)) fail('metadata is not an object');
  return { bytes, value };
}

function validateDescriptor(descriptor, publication, manifestHash, manifest) {
  if (!exact(descriptor, ['schema_version', 'root', 'logical_data_inventory_sha256', 'physical_inventory_sha256', 'ui_sha', 'ui_digest']) || descriptor.schema_version !== 'static-json-transport-publication-v1') fail('transport descriptor is invalid');
  validateExpectedRoot(descriptor.root);
  if (![descriptor.logical_data_inventory_sha256, descriptor.physical_inventory_sha256, descriptor.ui_digest].every(value => HASH.test(value)) || !COMMIT.test(descriptor.ui_sha)) fail('transport identity is invalid');
  const bindings = descriptor.root.bindings;
  if (publication.data_manifest_sha256 !== manifestHash || bindings.manifestSha256 !== manifestHash ||
      publication.ui_sha !== descriptor.ui_sha || publication.ui_digest !== descriptor.ui_digest ||
      bindings.appCommit !== descriptor.ui_sha || bindings.uiInventorySha256 !== descriptor.ui_digest ||
      bindings.financialGeneration !== (manifest.financial_generation ?? null)) fail('transport binding mismatch');
  if (publication.schema === 1 && Object.hasOwn(publication, 'financial_lineage_sha256') && (!HASH.test(publication.financial_lineage_sha256) || publication.financial_lineage_sha256 !== bindings.financialLineageSha256)) fail('financial lineage mismatch');
  if (publication.schema === 1 && publication.data_inventory_sha256 != null && publication.data_inventory_sha256 !== descriptor.logical_data_inventory_sha256) fail('logical inventory mismatch');
}

// Manifest bytes remain untouched on disk. A verified, serializable context is
// kept separately so all children of this snapshot keep the same transport root.
export async function loadStaticManifest() {
  const request = ++publicationRequest;
  const baseURL = siteBase();
  const pending = (async () => {
    const [source, receipt] = await Promise.all([
      readMetadata(new URL('static-data/manifest.json', baseURL), STATIC_METADATA_LIMITS.manifest),
      readMetadata(new URL('publication.json', baseURL), STATIC_METADATA_LIMITS.publication, true),
    ]);
    const manifest = source.value, publication = receipt?.value;
    let expectedRoot = null;
    if (publication && Object.hasOwn(publication, 'transport')) transportDeclared = true;
    else if (transportDeclared) fail('declared transport descriptor is unavailable');
    if (publication) {
      if (publication.schema === 'static-json-transport-preview-v1') {
        if (!exact(publication, ['schema', 'publication_authority', 'ui_sha', 'ui_digest', 'data_manifest_sha256', 'transport']) || publication.publication_authority !== 'none') fail('preview identity is invalid');
      } else if (publication.schema !== 1) fail('schema is unsupported');
      if (Object.hasOwn(publication, 'transport')) {
        validateDescriptor(publication.transport, publication, await digest(source.bytes), manifest);
        expectedRoot = Object.freeze({ ...publication.transport.root, bindings: Object.freeze({ ...publication.transport.root.bindings }) });
      } else if (publication.schema !== 1) fail('transport descriptor is missing');
      else if (!HASH.test(publication.data_manifest_sha256) || publication.data_manifest_sha256 !== await digest(source.bytes)) fail('manifest integrity mismatch');
    }
    const identity = JSON.stringify([baseURL, manifest, expectedRoot]);
    // React Query disables structural sharing so it cannot detach the WeakMap
    // context. Reuse an unchanged verified snapshot here to avoid rehydrating
    // every scan and chart grid on the ordinary one-minute manifest refresh.
    if (latestSnapshot?.identity === identity) return latestSnapshot;
    const cacheIdentity = expectedRoot?.sha256 || identity;
    const context = Object.freeze({ mode: expectedRoot ? 'packed' : 'legacy', baseURL, generation: logicalGeneration(manifest), cacheIdentity, expectedRoot });
    contexts.set(manifest, context);
    if (request === publicationRequest) {
      latestSnapshot = { identity, manifest, context };
      generations.set(context.generation, context);
      while (generations.size > 8) generations.delete(generations.keys().next().value);
    }
    return { manifest, context };
  })();
  currentPublication = pending;
  const { manifest } = await pending;
  return manifest;
}

export const publicationForManifest = manifest => contexts.get(manifest);
export const publicationQueryIdentity = publication => publication?.expectedRoot?.sha256 ?? publication?.cacheIdentity ?? publication?.generation ?? null;

export async function resolveStaticPublication({ publication, generation } = {}) {
  if (publication) {
    if (generation != null && publication.generation !== generation) fail('generation mismatch');
    return publication;
  }
  if (!currentPublication) await loadStaticManifest();
  // Await the newest bootstrap even for a known generation: a failed refresh
  // must not silently reactivate its predecessor's transport configuration.
  const current = (await currentPublication).context;
  if (generation == null || current.generation === generation) return current;
  const pinned = generations.get(generation);
  if (!pinned) fail('requested generation is unavailable');
  return pinned;
}

function transportReader(publication) {
  const key = `${publication.baseURL}:${publication.expectedRoot.sha256}`;
  let reader = readers.get(key);
  if (!reader) {
    reader = { ready: createStaticTransport({ baseURL: publication.baseURL, expectedRoot: publication.expectedRoot }), active: 0, waiting: [] };
    readers.set(key, reader);
    // Dropping a cache reference leaves any in-flight reader pinned and usable.
    while (readers.size > 4) readers.delete(readers.keys().next().value);
    reader.ready.catch(() => { if (readers.get(key) === reader) readers.delete(key); });
  }
  return reader;
}

const LARGE_DECODE_BYTES = 8 * 1024 * 1024;
function admitLargeDecode(signal, load) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const aborted = () => {
      const index = largeReads.waiting.indexOf(start);
      if (index >= 0) largeReads.waiting.splice(index, 1);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    const start = () => {
      signal?.removeEventListener('abort', aborted);
      largeReads.active = true;
      Promise.resolve().then(load).then(resolve, reject).finally(() => {
        largeReads.active = false;
        largeReads.waiting.shift()?.();
      });
    };
    if (!largeReads.active) start();
    else { largeReads.waiting.push(start); signal?.addEventListener('abort', aborted, { once: true }); }
  });
}

function readPacked(publication, path, options) {
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  const reader = transportReader(publication);
  // A large chart grid or Promise.all scan hydration must not exhaust the
  // decoder's bounded pending-shard map. Queued cancellation starts no fetch.
  return new Promise((resolve, reject) => {
    let settled = false, admitted = false, released = false;
    const release = () => {
      if (!admitted || released) return;
      released = true; reader.active--;
      reader.waiting.shift()?.();
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true; signal?.removeEventListener('abort', aborted);
      const index = reader.waiting.indexOf(start);
      if (index >= 0) reader.waiting.splice(index, 1);
      release();
      if (error) reject(error); else resolve(value);
    };
    const abortError = () => signal?.reason || new DOMException('Aborted', 'AbortError');
    const aborted = () => finish(abortError());
    const guard = () => { if (settled || signal?.aborted) throw abortError(); };
    const start = () => {
      if (settled) return;
      admitted = true; reader.active++;
      // This subscriber can leave while the shared root remains pending for
      // other readers. Its eventual root callback must not start an asset read.
      reader.ready.then(async transport => {
        guard();
        const entry = await transport.lookup(path, { signal }); guard();
        const load = () => { guard(); return transport.readJson(path, options); };
        // Authenticate size before admission. Keep only one large decoded byte
        // buffer/JSON parse active per realm, including across publication roots;
        // the consumer still owns retained objects.
        return entry?.decodedBytes > LARGE_DECODE_BYTES ? admitLargeDecode(signal, load) : load();
      }).then(value => finish(null, value), error => finish(error));
    };
    signal?.addEventListener('abort', aborted, { once: true });
    if (reader.active < 8) start();
    else reader.waiting.push(start);
    if (signal?.aborted) aborted();
  });
}

export async function readStaticPayload(relativePath, { publication, sha256, signal } = {}) {
  if (!publication || !['packed', 'legacy'].includes(publication.mode)) fail('context is missing');
  if (typeof relativePath !== 'string' || relativePath.startsWith('/') || relativePath.includes('\\') || /[?#]/.test(relativePath) || relativePath.includes('\0') || relativePath.split('/').some(part => part === '..' || part === '.')) fail('path is invalid');
  const path = `static-data/${relativePath}`;
  if (publication.mode === 'packed') {
    return readPacked(publication, path, { signal, expectedDecodedSha256: sha256 });
  }
  const response = await fetch(new URL(path, publication.baseURL).href, {
    cache: /-[a-f0-9]{16}\.json$/.test(relativePath) ? 'default' : 'no-cache', headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw Error(`Failed to load static data: ${relativePath} (${response.status})`);
  if (sha256) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (await digest(bytes) !== sha256) throw Error('Static asset integrity mismatch');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  return response.json();
}
