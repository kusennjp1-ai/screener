// Which generated, hash-named export files the static-data manifest still
// references. Every export run writes new workbench, summary, performance,
// market-trend and candidate-history files; only the referenced ones are read.
// A reference whose file is missing or changed is an error, never a guess.
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export const EXPORT_FAMILIES = Object.freeze({
  workbench: /^workbench-[a-f0-9]{16}\.json$/,
  workbench_summary: /^workbench-summary-[a-f0-9]{16}\.json$/,
  candidate_performance: /^candidate-performance-[a-f0-9]{16}\.json$/,
  market_trends: /^market-trends\/(?:series|source|history-source)-[a-f0-9]{64}\.json$/,
  candidate_history: /^candidate-history\/\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.json(?:\.gz)?$/,
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const PERFORMANCE_DIRECTORY = 'candidate-performance-history';
const PERFORMANCE_INDEX = `${PERFORMANCE_DIRECTORY}/index.json`;
const PERFORMANCE_ARCHIVE = /^candidate-performance-history\/\d{4}-\d{2}-\d{2}-[a-f0-9]{16}-[a-f0-9]{16}\.json\.gz$/;
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** The export family of a path relative to static-data, or null. */
export function exportFamilyOf(path) {
  for (const [family, pattern] of Object.entries(EXPORT_FAMILIES)) if (pattern.test(path)) return family;
  return null;
}

async function readRegular(root, path) {
  let info;
  try { info = await lstat(join(root, path)); }
  catch (error) { if (error.code === 'ENOENT') throw Error(`Missing referenced export file: ${path}`); throw error; }
  if (!info.isFile() || info.isSymbolicLink()) throw Error(`Referenced export is not a regular file: ${path}`);
  return readFile(join(root, path));
}

async function pinned(root, path, expected, family) {
  if (typeof path !== 'string' || !EXPORT_FAMILIES[family].test(path)) throw Error(`Unexpected ${family} reference path: ${path}`);
  const bytes = await readRegular(root, path);
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) || sha256(bytes) !== expected) throw Error(`Referenced export changed: ${path}`);
  return bytes;
}

async function exists(root, path) {
  try { await lstat(join(root, path)); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// A completed performance cohort freezes the candidate snapshot it was
// measured from (cohort.path/sha256). The release's history reconciliation
// re-reads that exact snapshot from the live tree after its session has left
// the 126-session catalog (reconcile-candidate-history.mjs selection() and
// restorePackedHistory), so such a snapshot is lineage, never superseded.
// Every archive the performance catalog names must be present and intact, and
// a lineage snapshot that is present must match the cohort's hash. A lineage
// snapshot that is absent is not required here: Static Site restores only the
// catalog's snapshots, so an aged-out cohort's selection is legitimately not in
// that tree (the release brings it from the live tree), and the prune never
// removes a file that is not there.
async function performanceLineage(root) {
  let names;
  try { names = await readdir(join(root, PERFORMANCE_DIRECTORY)); }
  catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  if (!names.includes('index.json')) {
    if (names.some(name => PERFORMANCE_ARCHIVE.test(`${PERFORMANCE_DIRECTORY}/${name}`))) throw Error(`Performance archives exist without ${PERFORMANCE_INDEX}`);
    return new Map();
  }
  const catalog = JSON.parse(await readRegular(root, PERFORMANCE_INDEX));
  if (catalog?.schema_version !== 1 || !Array.isArray(catalog.cohorts)) throw Error('Invalid candidate performance catalog');
  const lineage = new Map();
  for (const ref of catalog.cohorts) {
    if (!PERFORMANCE_ARCHIVE.test(ref?.path || '') || !validHash(ref.sha256) || !validHash(ref.cohort_sha256)) throw Error(`Unexpected performance archive reference: ${ref?.path}`);
    const bytes = await readRegular(root, ref.path);
    if (sha256(bytes) !== ref.sha256) throw Error(`Referenced export changed: ${ref.path}`);
    const cohort = JSON.parse(gunzipSync(bytes)).cohort;
    if (!EXPORT_FAMILIES.candidate_history.test(cohort?.path || '') || !validHash(cohort.sha256) || cohort.sha256 !== ref.cohort_sha256) throw Error(`Invalid cohort selection in ${ref.path}`);
    if (lineage.has(cohort.path) && lineage.get(cohort.path) !== cohort.sha256) throw Error(`Conflicting cohort selection hashes: ${cohort.path}`);
    lineage.set(cohort.path, cohort.sha256);
  }
  return lineage;
}

// Collect every string that names a file of an export family, anywhere in a
// referenced document. Such a file is kept even when no manifest field names it.
function mentions(value, found) {
  if (typeof value === 'string') {
    const path = value.startsWith('static-data/') ? value.slice('static-data/'.length) : value;
    if (exportFamilyOf(path)) found.add(path);
  } else if (Array.isArray(value)) for (const item of value) mentions(item, found);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) mentions(item, found);
  return found;
}

/**
 * Resolve the referenced files of each export family under one static-data root.
 * A family the manifest does not reference at all is reported as `null`: its
 * files are left alone, because nothing proves which of them is current.
 */
export async function referencedExports(root) {
  let manifestBytes;
  try { manifestBytes = await readRegular(root, 'manifest.json'); }
  catch (error) { throw Error(`Missing static-data manifest under ${root}: ${error.message}`); }
  const manifest = JSON.parse(manifestBytes);
  const entry = manifest.markets?.US || manifest;
  const assets = entry.assets || {};
  const families = Object.fromEntries(Object.keys(EXPORT_FAMILIES).map(key => [key, null]));
  const documents = [manifest];
  let workbench = null, currentSnapshot = null, catalogSnapshots = null;
  for (const key of ['workbench', 'workbench_summary', 'candidate_performance']) {
    const ref = assets[key];
    if (ref === undefined || ref === null) continue;
    const value = JSON.parse(await pinned(root, ref.path, ref.sha256, key));
    families[key] = new Set([ref.path]);
    documents.push(value);
    if (key === 'workbench') workbench = value;
  }
  const trends = assets.market_trends;
  if (trends !== undefined && trends !== null) {
    if (trends.path !== `market-trends/series-${trends.sha256}.json`) throw Error(`Unexpected market_trends reference path: ${trends.path}`);
    const series = JSON.parse(await pinned(root, trends.path, trends.sha256, 'market_trends'));
    const keep = new Set([trends.path]);
    if (trends.source_path !== null && trends.source_path !== undefined) {
      if (trends.source_path !== `market-trends/source-${trends.source_sha256}.json`) throw Error(`Unexpected market trend source path: ${trends.source_path}`);
      await pinned(root, trends.source_path, trends.source_sha256, 'market_trends');
      keep.add(trends.source_path);
    }
    const history = series.long_history?.source_sha256;
    if (history !== undefined && history !== null) {
      const path = `market-trends/history-source-${history}.json`;
      await pinned(root, path, history, 'market_trends');
      keep.add(path);
    }
    families.market_trends = keep;
    documents.push(series);
  }
  // The current snapshot is named only inside the workbench, and every earlier
  // session only in the catalog. Without the workbench, nothing is current.
  if (workbench) {
    const current = workbench.current_snapshot;
    if (!current || typeof current !== 'object') throw Error('Referenced workbench lacks its current candidate snapshot');
    await pinned(root, current.path, current.sha256, 'candidate_history');
    let catalogBytes;
    try { catalogBytes = await readRegular(root, 'candidate-history/index.json'); }
    catch (error) { throw Error(`Missing candidate history catalog: ${error.message}`); }
    const catalog = JSON.parse(catalogBytes);
    if (!catalog || !Array.isArray(catalog.snapshots)) throw Error('Invalid candidate history catalog');
    catalogSnapshots = new Set();
    for (const ref of catalog.snapshots) {
      await pinned(root, ref?.path, ref?.sha256, 'candidate_history');
      catalogSnapshots.add(ref.path);
    }
    currentSnapshot = current.path;
    families.candidate_history = new Set([...catalogSnapshots, currentSnapshot]);
    documents.push(catalog);
  }
  const lineageSnapshots = new Set();
  for (const [path, expected] of await performanceLineage(root)) {
    if (!await exists(root, path)) continue;
    await pinned(root, path, expected, 'candidate_history');
    lineageSnapshots.add(path);
  }
  const mentioned = new Set();
  for (const value of documents) mentions(value, mentioned);
  return { manifest, entry, families, mentioned, currentSnapshot, catalogSnapshots, lineageSnapshots };
}

/**
 * referenced | lineage | mentioned | superseded for a file of an export family
 * ('lineage': a candidate snapshot only a completed performance cohort still
 * names); 'no-reference' when the manifest names no file of that family at
 * all; null for any other path.
 */
export function exportStatus(references, path) {
  const family = exportFamilyOf(path);
  if (!family) return null;
  const keep = references.families[family];
  if (keep === null) return 'no-reference';
  if (keep.has(path)) return 'referenced';
  if (references.lineageSnapshots?.has(path)) return 'lineage';
  if (references.mentioned.has(path)) return 'mentioned';
  return 'superseded';
}
