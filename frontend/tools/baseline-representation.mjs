// Design-only wire compatibility. The canonical comparison trees and both UIs
// remain untouched; the baseline server may return only these verified bytes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, lstatSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { decodeResearchRecordArrays } from '../src/static/researchRecordArrays.js';
import { dataInventoryDigest } from '../../.github/scripts/publication-state.mjs';
export const REPRESENTATION_SCHEMA = 'design-baseline-representation-v1';
const NEW = 'sparse-record-arrays-and-copy-masks-v1', OLD = 'sparse-binary-and-signed-zero-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value));
const safe = name => typeof name === 'string' && /^[A-Za-z0-9._/-]+$/.test(name) && !name.split('/').some(x => !x || x === '.' || x === '..');
const exact = (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'Unexpected representation fields');
function read(root, name) {
  assert(safe(name), 'Unsafe representation path');
  let path = resolve(root); assert(lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink(), 'Linked representation root');
  for (const part of name.split('/')) { path = join(path, part); assert(!lstatSync(path).isSymbolicLink(), 'Linked representation member'); }
  const stat = lstatSync(path); assert(stat.isFile() && stat.nlink === 1 && stat.size <= 64 * 1024 * 1024, 'Invalid representation member');
  return readFileSync(path);
}
function inventory(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(item => {
    const name = prefix + item.name; assert(!item.isSymbolicLink(), 'Linked representation member');
    return item.isDirectory() ? inventory(root, name + '/') : [name];
  }).sort();
}
function write(root, name, bytes) { assert(safe(name)); mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), bytes, { flag: 'wx' }); }

// Expand only the two new forms. Field paths, orders, proof tuples, floating
// point bytes and signed-zero markers retain their original identities.
export function baselineResearchWire(wire) {
  const canonical = decodeResearchIndex(wire);
  if (wire.column_encoding !== NEW) return wire;
  const result = { ...wire, column_encoding: OLD, columns: wire.columns.map(column => {
    for (const field of ['present', 'pool', 'values']) if (Object.hasOwn(column, `arrays_${field}`)) {
      const { [`arrays_${field}`]: encoded, ...rest } = column;
      return { ...rest, [field]: decodeResearchRecordArrays(encoded, wire.count) };
    }
    if (Object.hasOwn(column, 'absent_bitmap') || Object.hasOwn(column, 'null_bitmap')) {
      const { absent_bitmap: absent, null_bitmap: nil, ...rest } = column;
      const patch = [...column.patch];
      for (const [mask, nullValue] of [[absent, false], [nil, true]]) if (mask !== undefined) {
        const bits = Buffer.from(mask, 'base64');
        for (let row = 0; row < wire.count; row++) if (bits[row >> 3] & (1 << (row & 7))) patch.push(nullValue ? [row, null] : [row]);
      }
      return { ...rest, patch: patch.sort((a, b) => a[0] - b[0]) };
    }
    return column;
  }) };
  assert.deepStrictEqual(decodeResearchIndex(JSON.parse(jsonBytes(result))), canonical, 'Baseline representation loses research data');
  return result;
}

// This is a closed reference graph, not a recursive string/hash replacement.
// Saved observations and their catalog remain byte-for-byte original.
export function representationGraph(get) {
  const originals = new Map(), files = new Map();
  const original = name => { const bytes = get(name); originals.set(name, bytes); return bytes; };
  const object = name => JSON.parse(original(name));
  const manifest = object('static-data/manifest.json'), entry = manifest.markets?.US || manifest;
  const oldResearch = entry.assets.research.path, oldBytes = original('static-data/' + oldResearch), oldHash = hash(oldBytes);
  assert(manifest.research_generation === oldHash && oldResearch === `research-index-${oldHash.slice(0, 16)}.json`, 'Research identity differs');
  const wire = JSON.parse(oldBytes), nextBytes = jsonBytes(baselineResearchWire(wire)), nextHash = hash(nextBytes);
  const put = (path, bytes) => { files.set('static-data/' + path, bytes); return path; };
  const nextPath = put(`research-index-${nextHash.slice(0, 16)}.json`, nextBytes);
  entry.assets.research = { ...entry.assets.research, path: nextPath, ...(Object.hasOwn(entry.assets.research, 'sha256') ? { sha256: nextHash } : {}) };
  manifest.research_generation = nextHash;
  const fullRef = entry.assets.workbench, summaryRef = entry.assets.workbench_summary;
  assert(fullRef && summaryRef, 'Complete workbench graph is required');
  const full = object('static-data/' + fullRef.path), summary = object('static-data/' + summaryRef.path);
  assert(hash(originals.get('static-data/' + fullRef.path)) === fullRef.sha256 && hash(originals.get('static-data/' + summaryRef.path)) === summaryRef.sha256, 'Workbench hash differs');
  assert(full.source_research_sha256 === oldHash && summary.source_research_sha256 === oldHash && summaryRef.source_research_sha256 === oldHash, 'Workbench research differs');
  assert(full.snapshot_id === fullRef.snapshot_id && full.snapshot_id === summary.snapshot_id && full.snapshot_id === summaryRef.snapshot_id, 'Workbench snapshot differs');
  const snapshotRef = full.current_snapshot;
  assert(snapshotRef?.path?.endsWith('.json.gz'), 'Missing current snapshot');
  const compressed = original('static-data/' + snapshotRef.path); assert(hash(compressed) === snapshotRef.sha256, 'Current snapshot hash differs');
  const snapshotBytes = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 }), snapshot = JSON.parse(snapshotBytes);
  assert(hash(snapshotBytes) === full.snapshot_id && snapshot.source_research_sha256 === oldHash, 'Current snapshot identity differs');
  snapshot.source_research_sha256 = nextHash;
  const nextSnapshot = jsonBytes(snapshot), snapshotId = hash(nextSnapshot), nextCompressed = gzipSync(nextSnapshot);
  const snapshotPath = put(`candidate-history/${entry.as_of_date}-${snapshotId.slice(0, 16)}.json.gz`, nextCompressed);
  full.source_research_sha256 = nextHash; full.snapshot_id = snapshotId;
  full.current_snapshot = { ...snapshotRef, path: snapshotPath, sha256: hash(nextCompressed) };
  // daily_changes_snapshot / saved_first describe actual saved observations,
  // even when they originally shared bytes with current_snapshot. Keep them.
  const nextFull = jsonBytes(full), fullHash = hash(nextFull), fullPath = put(`workbench-${fullHash.slice(0, 16)}.json`, nextFull);
  entry.assets.workbench = { ...fullRef, path: fullPath, sha256: fullHash, snapshot_id: snapshotId };
  assert.deepStrictEqual(summary.current_snapshot, snapshotRef, 'Summary current snapshot differs');
  summary.current_snapshot = full.current_snapshot;
  summary.source_research_sha256 = nextHash; summary.snapshot_id = snapshotId;
  assert(summary.details.path === fullRef.path && summary.details.sha256 === fullRef.sha256, 'Summary details differ');
  summary.details = { ...summary.details, path: fullPath, sha256: fullHash, snapshot_id: snapshotId };
  const nextSummary = jsonBytes(summary), summaryHash = hash(nextSummary), summaryPath = put(`workbench-summary-${summaryHash.slice(0, 16)}.json`, nextSummary);
  entry.assets.workbench_summary = { ...summaryRef, path: summaryPath, sha256: summaryHash, snapshot_id: snapshotId, source_research_sha256: nextHash };
  files.set('static-data/manifest.json', jsonBytes(manifest));
  return { originals, files, wire, baselineWire: JSON.parse(nextBytes), research: { original_path: oldResearch, path: nextPath, original_sha256: oldHash, sha256: nextHash, raw_bytes: nextBytes.length, gzip_bytes: gzipSync(nextBytes).length } };
}
const table = map => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => [path, { sha256: hash(bytes), bytes: bytes.length }]));
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
function decoderSources(repo, revision) {
  const sources = {}, pending = ['frontend/src/static/researchTransport.js'];
  while (pending.length) {
    const name = pending.pop(); if (sources[name]) continue;
    const bytes = read(repo, name), committed = execFileSync('git', ['-C', repo, 'show', `${revision}:${name}`], { maxBuffer: 32 * 1024 * 1024 });
    // Git worktrees may check out CRLF; source semantics must match exact blob.
    assert(bytes.toString().replace(/\r\n/g, '\n') === committed.toString(), 'Baseline decoder source changed');
    sources[name] = hash(committed);
    for (const match of committed.toString().matchAll(/from ['"](\.[^'"]+)['"]/g)) {
      const dependency = resolve(repo, dirname(name), match[1]); assert(dependency.startsWith(resolve(repo) + sep), 'Decoder import escapes checkout');
      pending.push(dependency.slice(resolve(repo).length + 1).split(sep).join('/'));
    }
  }
  return sources;
}
export async function prepareBaselineRepresentation({ currentRoot, baselineRoot, output, baselineSha }) {
  const repo = resolve(baselineRoot, '../..'), directory = join(output, 'baseline-representation');
  assert(resolve(baselineRoot) === join(repo, 'frontend/dist') && realpathSync(baselineRoot) !== realpathSync(currentRoot), 'Wrong baseline representation root');
  assert(/^[a-f0-9]{40}$/.test(baselineSha) && git(repo, 'rev-parse', 'HEAD') === baselineSha, 'Wrong selected baseline');
  const outputPath = realpathSync(output);
  for (const root of [currentRoot, baselineRoot].map(root => realpathSync(root))) assert(outputPath !== root && !outputPath.startsWith(root + sep), 'Representation output cannot modify either UI tree');
  assert(!existsSync(directory), 'Baseline representation already exists');
  const publication = JSON.parse(read(currentRoot, 'publication.json'));
  const digest = dataInventoryDigest(baselineRoot);
  assert(digest === publication.transport.logical_data_inventory_sha256, 'Canonical comparison data differs');
  assert(hash(read(baselineRoot, 'static-data/manifest.json')) === publication.data_manifest_sha256, 'Canonical comparison manifest differs');
  const sources = decoderSources(repo, baselineSha), graph = representationGraph(name => read(baselineRoot, name));
  const baseline = await import(pathToFileURL(join(repo, 'frontend/src/static/researchTransport.js')));
  assert.deepStrictEqual(baseline.decodeResearchIndex(graph.baselineWire), decodeResearchIndex(graph.wire), 'Selected baseline decoder changes canonical data');
  const proof = { schema: REPRESENTATION_SCHEMA, publication_authority: 'none', financial_admission: false, baseline_sha: baselineSha, decoder_sources: sources,
    canonical_data_inventory_sha256: digest, current_manifest_sha256: publication.data_manifest_sha256, originals: table(graph.originals), files: table(graph.files), research: graph.research };
  for (const [name, bytes] of graph.originals) write(directory, 'original/' + name, bytes);
  for (const [name, bytes] of graph.files) write(directory, 'served/' + name, bytes);
  write(directory, 'proof.json', jsonBytes(proof));
  assert(dataInventoryDigest(baselineRoot) === digest, 'Canonical baseline changed during adapter');
  return verifyBaselineRepresentation({ directory, baselineRoot, currentRoot, baselineSha });
}
export function verifyStoredRepresentation(directory, expectedHash) {
  const bytes = read(directory, 'proof.json'); if (expectedHash) assert(hash(bytes) === expectedHash, 'Representation proof changed');
  const proof = JSON.parse(bytes);
  exact(proof, ['schema', 'publication_authority', 'financial_admission', 'baseline_sha', 'decoder_sources', 'canonical_data_inventory_sha256', 'current_manifest_sha256', 'originals', 'files', 'research']);
  assert(proof.schema === REPRESENTATION_SCHEMA && proof.publication_authority === 'none' && proof.financial_admission === false, 'Invalid representation authority');
  assert(/^[a-f0-9]{40}$/.test(proof.baseline_sha) && /^[a-f0-9]{64}$/.test(proof.canonical_data_inventory_sha256) && /^[a-f0-9]{64}$/.test(proof.current_manifest_sha256), 'Invalid representation identity');
  assert(proof.decoder_sources && Object.keys(proof.decoder_sources).length > 0 && Object.keys(proof.decoder_sources).length <= 64, 'Missing decoder sources');
  for (const [path, digest] of Object.entries(proof.decoder_sources)) assert(safe(path) && (path.startsWith('frontend/src/static/') || path.startsWith('frontend/contracts/')) && /^[a-f0-9]{64}$/.test(digest), 'Invalid decoder source');
  const graph = representationGraph(name => read(directory, 'original/' + name));
  assert(hash(graph.originals.get('static-data/manifest.json')) === proof.current_manifest_sha256, 'Representation canonical manifest differs');
  assert.deepStrictEqual(table(graph.originals), proof.originals); assert.deepStrictEqual(table(graph.files), proof.files); assert.deepStrictEqual(graph.research, proof.research);
  for (const [name, value] of graph.files) assert(read(directory, 'served/' + name).equals(value), 'Changed baseline served bytes');
  const paths = ['proof.json', ...Object.keys(proof.originals).map(name => 'original/' + name), ...Object.keys(proof.files).map(name => 'served/' + name)].sort();
  assert.deepStrictEqual(inventory(directory), paths, 'Unknown baseline override');
  return { proof, sha256: hash(bytes), paths, directory };
}
export function verifyBaselineRepresentation({ directory, baselineRoot, currentRoot, baselineSha }) {
  assert(realpathSync(baselineRoot) !== realpathSync(currentRoot), 'Current cannot be a comparison overlay');
  const verified = verifyStoredRepresentation(directory), { proof } = verified, repo = resolve(baselineRoot, '../..');
  assert(resolve(baselineRoot) === join(repo, 'frontend/dist') && git(repo, 'rev-parse', 'HEAD') === baselineSha && proof.baseline_sha === baselineSha, 'Wrong baseline identity');
  assert.deepStrictEqual(decoderSources(repo, baselineSha), proof.decoder_sources, 'Baseline decoder changed');
  assert(dataInventoryDigest(baselineRoot) === proof.canonical_data_inventory_sha256, 'Canonical baseline inventory changed');
  const publication = JSON.parse(read(currentRoot, 'publication.json'));
  assert(publication.transport.logical_data_inventory_sha256 === proof.canonical_data_inventory_sha256 && publication.data_manifest_sha256 === proof.current_manifest_sha256, 'Current canonical representation changed');
  for (const [name, info] of Object.entries(proof.originals)) assert(hash(read(baselineRoot, name)) === info.sha256, 'Original graph changed');
  return { ...verified, baselineRoot: realpathSync(baselineRoot) };
}
export function representationResponse(verified, root, relative, baselineRoot) {
  assert(verified.baselineRoot && realpathSync(root) === verified.baselineRoot && realpathSync(baselineRoot) === verified.baselineRoot, 'Overlay cannot serve another UI');
  assert(safe(relative), 'Unsafe baseline request');
  if (!Object.hasOwn(verified.proof.files, relative)) return null;
  const bytes = read(verified.directory, 'served/' + relative), identity = verified.proof.files[relative];
  assert(hash(bytes) === identity.sha256 && bytes.length === identity.bytes, 'Baseline response bytes changed');
  return bytes;
}
