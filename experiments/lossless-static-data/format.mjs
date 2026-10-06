// Experimental transport only. Nothing in the application imports this module.
export const FORMAT = 'screener-lossless-static-v1';
export const MANIFEST_PATH = '_lossless/manifest.json';
export const RECEIPT_PATH = '_lossless/receipt.json';
export const MAX_SITE_BYTES = 1_000_000_000;
export const DEFAULT_LIMITS = Object.freeze({ manifestBytes: 32 * 1024 * 1024, encodedBytes: 128 * 1024 * 1024, decodedBytes: 128 * 1024 * 1024 });
export const ROOT_DATA = Object.freeze(['ibd-reference.json', 'portfolio-model.json', 'qualification-audit.json', 'research-daily.json']);
export const isData = path => path.startsWith('static-data/') && path.endsWith('.json') || ROOT_DATA.includes(path);
// Intentionally narrow scope: bootstrap/proof/audit files stay raw.
export const isPackedData = path => /^static-data\/markets\/us\/charts\/(?!index\.json$)[^/]+\.json$/.test(path) || /^static-data\/research-details\/[^/]+\.json$/.test(path) || /^static-data\/markets\/us\/scan\/chunks\/[^/]+\.json$/.test(path);
export const canonicalBytes = value => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
export const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
export const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const validPath = path => typeof path === 'string' && path.length > 0 && path.length <= 1024 && path.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..');
export function invariant(condition, message) { if (!condition) throw new Error(message); }
const keysAre = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export function validateManifest(manifest) {
  invariant(keysAre(manifest, ['format', 'generation', 'files']), 'Invalid manifest fields');
  invariant(manifest.format === FORMAT && validHash(manifest.generation) && Array.isArray(manifest.files), 'Invalid manifest header');
  const logical = new Set(), physical = new Map();
  let previous = '';
  for (const entry of manifest.files) {
    invariant(keysAre(entry, ['path', 'kind', 'assetPath', 'encodedBytes', 'encodedSha256', 'decodedBytes', 'decodedSha256']), 'Invalid manifest entry fields');
    invariant(validPath(entry.path) && !entry.path.startsWith('_lossless/'), 'Invalid logical path');
    invariant(!logical.has(entry.path) && entry.path > previous, 'Duplicate, conflicting, or unsorted logical path');
    logical.add(entry.path); previous = entry.path;
    invariant(['gzip', 'identity'].includes(entry.kind) && (entry.kind === 'gzip') === isPackedData(entry.path), 'Incorrect transport kind');
    for (const key of ['encodedBytes', 'decodedBytes']) invariant(Number.isSafeInteger(entry[key]) && entry[key] >= 0, `Invalid ${key}`);
    invariant(validHash(entry.encodedSha256) && validHash(entry.decodedSha256), 'Invalid byte hash');
    invariant(validPath(entry.assetPath), 'Invalid asset path');
    if (entry.kind === 'gzip') invariant(entry.assetPath === `_lossless/gzip/${entry.encodedSha256}.json.gz`, 'Asset address does not match hash');
    else invariant(entry.assetPath === entry.path && entry.encodedBytes === entry.decodedBytes && entry.encodedSha256 === entry.decodedSha256, 'Invalid identity entry');
    const signature = JSON.stringify([entry.encodedBytes, entry.encodedSha256, entry.decodedBytes, entry.decodedSha256, entry.kind]);
    invariant(!physical.has(entry.assetPath) || physical.get(entry.assetPath) === signature, 'Conflicting physical asset');
    physical.set(entry.assetPath, signature);
  }
  return new Map(manifest.files.map(entry => [entry.path, Object.freeze({ ...entry })]));
}
export const generationBytes = files => canonicalBytes({ format: FORMAT, files });
