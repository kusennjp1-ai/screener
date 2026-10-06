// Shared wire contract. No Node imports: used by the app, worker, and verifier.
export const FORMAT = 'screener-static-transport-v1';
export const PREFIX = 'static-data/_transport/';
export const MAX_SITE_BYTES = 1_000_000_000;
export const EXTERNAL_BOOTSTRAPS = Object.freeze(['publication.json']);
export const DEFAULT_LIMITS = Object.freeze({ rootBytes: 64 * 1024, shardBytes: 256 * 1024, inventoryBytes: 32 * 1024 * 1024, encodedBytes: 128 * 1024 * 1024, decodedBytes: 128 * 1024 * 1024, cachedShards: 8, pendingShards: 16 });
export const canonicalBytes = value => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
export const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const validPath = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && value.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..');
export const isPackedData = path => /^static-data\/markets\/us\/charts\/(?!index\.json$)[^/]+\.json$/.test(path) || /^static-data\/research-details\/[^/]+\.json$/.test(path) || /^static-data\/markets\/us\/scan\/chunks\/[^/]+\.json$/.test(path);
export const invariant = (condition, message) => { if (!condition) throw new Error(message); };
export const keysAre = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
export const equalBytes = (a, b) => a.length === b.length && a.every((byte, index) => byte === b[index]);
export async function sha256(bytes) {
  invariant(globalThis.crypto?.subtle, 'Unsupported transport: Web Crypto SHA-256 unavailable');
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)));
}
export function parseCanonical(bytes) {
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  invariant(equalBytes(bytes, canonicalBytes(value)), 'Noncanonical or duplicate-key transport JSON');
  return value;
}
export function limitsFor(overrides = {}) {
  invariant(overrides && typeof overrides === 'object' && !Array.isArray(overrides), 'Invalid transport limits');
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const key of Object.keys(limits)) invariant(Object.hasOwn(DEFAULT_LIMITS, key) && Number.isSafeInteger(limits[key]) && limits[key] > 0 && limits[key] <= DEFAULT_LIMITS[key], `Invalid transport limit: ${key}`);
  return Object.freeze(limits);
}
export function validateBindings(bindings) {
  invariant(keysAre(bindings, ['manifestSha256', 'uiInventorySha256', 'financialGeneration', 'financialLineageSha256', 'sourceCommit', 'appCommit', 'candidateId']), 'Invalid transport binding fields');
  for (const key of ['manifestSha256', 'uiInventorySha256', 'candidateId']) invariant(validHash(bindings[key]), `Invalid transport binding: ${key}`);
  for (const key of ['financialGeneration', 'financialLineageSha256']) invariant(bindings[key] === null || validHash(bindings[key]), `Invalid transport binding: ${key}`);
  invariant((bindings.financialGeneration === null) === (bindings.financialLineageSha256 === null), 'Incomplete financial transport binding');
  for (const key of ['sourceCommit', 'appCommit']) invariant(typeof bindings[key] === 'string' && /^[a-f0-9]{40}$/.test(bindings[key]), `Invalid transport binding: ${key}`);
  return bindings;
}
export function validateDescriptor(value, family, cap, extraKeys = []) {
  invariant(keysAre(value, ['path', 'bytes', 'sha256', ...extraKeys]) && validHash(value.sha256), 'Invalid transport descriptor fields');
  invariant(value.path === `${PREFIX}${family}-${value.sha256}.json`, 'Transport descriptor address mismatch');
  invariant(Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= cap, 'Transport descriptor byte cap exceeded');
  return value;
}
export function validateExpectedRoot(value) {
  validateDescriptor(value, 'root', DEFAULT_LIMITS.rootBytes, ['generation', 'bindings']);
  invariant(validHash(value.generation), 'Invalid transport generation');
  validateBindings(value.bindings);
  return value;
}
export function generationBody(root) {
  return { format: root.format, bindings: root.bindings, logicalInventory: root.logicalInventory, physicalInventory: root.physicalInventory, shards: root.shards };
}
export function validateRoot(root, expectedRoot, limits = DEFAULT_LIMITS) {
  invariant(keysAre(root, ['format', 'generation', 'bindings', 'logicalInventory', 'physicalInventory', 'shards']) && root.format === FORMAT && root.generation === expectedRoot.generation, 'Invalid transport root or generation');
  validateBindings(root.bindings);
  invariant(equalBytes(canonicalBytes(root.bindings), canonicalBytes(expectedRoot.bindings)), 'Transport bindings mismatch');
  validateDescriptor(root.logicalInventory, 'logical', limits.inventoryBytes);
  validateDescriptor(root.physicalInventory, 'physical', limits.inventoryBytes);
  invariant(Array.isArray(root.shards) && root.shards.length === 256, 'Transport must have exactly 256 shards');
  for (const [index, descriptor] of root.shards.entries()) {
    validateDescriptor(descriptor, 'shard', limits.shardBytes, ['id']);
    invariant(descriptor.id === index.toString(16).padStart(2, '0'), 'Unsorted or duplicate transport shard');
  }
  return root;
}
export function validateEntry(entry, limits = DEFAULT_LIMITS) {
  invariant(keysAre(entry, ['path', 'kind', 'assetPath', 'encodedBytes', 'encodedSha256', 'decodedBytes', 'decodedSha256']), 'Invalid transport entry fields');
  invariant(validPath(entry.path) && !entry.path.startsWith(PREFIX) && !EXTERNAL_BOOTSTRAPS.includes(entry.path), 'Invalid logical path');
  invariant(['gzip', 'identity'].includes(entry.kind) && (entry.kind === 'gzip') === isPackedData(entry.path), 'Incorrect transport kind');
  for (const [key, cap] of [['encodedBytes', limits.encodedBytes], ['decodedBytes', limits.decodedBytes]]) invariant(Number.isSafeInteger(entry[key]) && entry[key] >= 0 && entry[key] <= cap, `Asset ${key} cap exceeded`);
  invariant(validHash(entry.encodedSha256) && validHash(entry.decodedSha256), 'Invalid asset hash');
  if (entry.kind === 'gzip') invariant(entry.assetPath === `${PREFIX}gzip/${entry.encodedSha256}.bin` && entry.encodedBytes >= 20, 'Invalid compressed asset address');
  else invariant(entry.assetPath === entry.path && entry.encodedBytes === entry.decodedBytes && entry.encodedSha256 === entry.decodedSha256, 'Invalid identity entry');
  return entry;
}
export async function validateShard(shard, id, limits = DEFAULT_LIMITS, guard = () => {}) {
  invariant(keysAre(shard, ['format', 'id', 'files']) && shard.format === FORMAT && shard.id === id && Array.isArray(shard.files), 'Invalid transport shard');
  const entries = new Map(); let previous = '';
  for (const entry of shard.files) {
    guard(); validateEntry(entry, limits);
    invariant(entry.path > previous, 'Duplicate or unsorted logical path'); previous = entry.path;
    invariant((await sha256(new TextEncoder().encode(entry.path))).slice(0, 2) === id, 'Logical path in wrong shard'); guard();
    entries.set(entry.path, Object.freeze({ ...entry }));
  }
  return entries;
}
