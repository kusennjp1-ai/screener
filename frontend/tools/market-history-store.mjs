// Local immutable history storage. No providers, publication receipts or financial rules.
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { MARKET_HISTORY_VERSION, marketIndicatorHistory, validHistoryDate } from '../src/static/marketIndicatorHistory.js';

export const MARKET_HISTORY_SNAPSHOT_VERSION = 'market-indicator-snapshot-v1';
export const MARKET_HISTORY_CATALOG_VERSION = 'market-indicator-catalog-v1';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(`Market history store: ${message}`); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function jsonBytes(value) {
  const encode = (item, depth = 0) => {
    if (depth > 64) fail('JSON nesting is too deep');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (Array.isArray(item)) {
      const parts = [];
      for (let index = 0; index < item.length; index++) {
        if (!Object.hasOwn(item, index)) fail('sparse JSON array');
        parts.push(encode(item[index], depth + 1));
      }
      return `[${parts.join(',')}]`;
    }
    if (record(item) && [Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode(item[key], depth + 1)}`).join(',')}}`;
    }
    fail('unsupported JSON value');
  };
  return Buffer.from(`${encode(value)}\n`);
}

function noSymlinks(path) {
  const absolute = resolve(path), root = parse(absolute).root;
  let cursor = root, final = null;
  for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    try {
      final = lstatSync(cursor);
      if (final.isSymbolicLink()) fail(`symlink is not allowed: ${cursor}`);
      if (cursor !== absolute && !final.isDirectory()) fail(`parent is not a directory: ${cursor}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      final = null;
    }
  }
  return final;
}

function readOptional(path) {
  const stat = noSymlinks(path);
  if (!stat) return null;
  if (!stat.isFile()) fail(`expected a regular file: ${path}`);
  return readFileSync(path);
}

function parseJson(bytes, name) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail(`invalid JSON in ${name}`); }
}

export function validateMarketHistorySnapshot(snapshot, { now = Date.now() } = {}) {
  if (!record(snapshot) || snapshot.schema_version !== MARKET_HISTORY_SNAPSHOT_VERSION || snapshot.market !== 'US' ||
      !Number.isFinite(now) || !validHistoryDate(snapshot.as_of_date) || snapshot.as_of_date > new Date(now).toISOString().slice(0, 10) ||
      !record(snapshot.history) || snapshot.history.version !== MARKET_HISTORY_VERSION || !Array.isArray(snapshot.history.series) || !record(snapshot.provenance)) {
    fail('invalid snapshot identity, date, history or provenance');
  }
  // Validate the accepted display contract without replacing raw observations
  // with normalized values or merging series from different snapshots.
  const checked = marketIndicatorHistory(snapshot.history, { market: 'US', asOfDate: snapshot.as_of_date, now });
  if (checked.issues.length) fail(`invalid snapshot observations: ${checked.issues.join(' ')}`);
  for (const series of snapshot.history.series) {
    for (const observation of series.observations) {
      const value = observation.value;
      if (value !== null && !(typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
          (series.metric === 'put_call_ratio' || Number.isSafeInteger(value)))) fail('invalid raw observation value');
      const timestamp = observation.collected_at;
      if (timestamp !== null && !(typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp) &&
          Number.isFinite(Date.parse(timestamp)) && Date.parse(timestamp) <= now && timestamp.slice(0, 10) >= observation.date &&
          new Date(timestamp).toISOString() === timestamp.replace(/Z$/, timestamp.includes('.') ? 'Z' : '.000Z'))) fail('invalid observation retrieval timestamp');
      if (value !== null && checked.series.find(item => item.key === JSON.stringify(['metric', 'market', 'population', 'method', 'source', 'unit', 'frequency', 'scope', 'instrument', 'approximate'].map(key => series[key])))?.points.find(point => point.date === observation.date)?.value !== value) {
        fail('known observation lacks valid retrieval evidence or conflicts');
      }
    }
  }
  jsonBytes(snapshot);
  return snapshot;
}

function validateReference(reference) {
  if (!record(reference) || reference.schema_version !== MARKET_HISTORY_SNAPSHOT_VERSION || reference.market !== 'US' ||
      !validHistoryDate(reference.as_of_date) || !/^[a-f0-9]{64}$/.test(reference.sha256 || '') ||
      reference.path !== `market-history/snapshots/${reference.sha256}.json`) fail('invalid snapshot reference or path');
}

function loadState(root, manifestPath, snapshot, now) {
  const rootStat = noSymlinks(root);
  if (rootStat && !rootStat.isDirectory()) fail('store is not a directory');
  noSymlinks(join(root, 'market-history', 'snapshots'));
  const catalogPath = join(root, 'market-history', 'catalog.json');
  const catalogBytes = readOptional(catalogPath);
  const catalog = catalogBytes ? parseJson(catalogBytes, catalogPath) : { schema_version: MARKET_HISTORY_CATALOG_VERSION, market: 'US', snapshots: [] };
  if (!record(catalog) || catalog.schema_version !== MARKET_HISTORY_CATALOG_VERSION || catalog.market !== 'US' || !Array.isArray(catalog.snapshots)) fail('invalid catalog');
  const seen = new Set();
  for (const reference of catalog.snapshots) {
    validateReference(reference);
    if (seen.has(reference.sha256)) fail('duplicate catalog reference');
    seen.add(reference.sha256);
    const bytes = readOptional(join(root, reference.path));
    if (!bytes || hash(bytes) !== reference.sha256) fail('existing snapshot hash mismatch');
    const existing = validateMarketHistorySnapshot(parseJson(bytes, reference.path), { now });
    if (existing.as_of_date !== reference.as_of_date || existing.market !== reference.market) fail('catalog snapshot identity mismatch');
  }
  let manifest = null, manifestBytes = null;
  if (manifestPath) {
    if (resolve(manifestPath) !== join(root, 'manifest.json')) fail('manifest must be store/manifest.json');
    manifestBytes = readOptional(manifestPath);
    if (!manifestBytes) fail('an existing manifest is required');
    manifest = parseJson(manifestBytes, manifestPath);
    if (!record(manifest) || (manifest.markets !== undefined && !record(manifest.markets))) fail('invalid manifest');
    const entry = manifest.markets === undefined ? manifest : manifest.markets.US;
    // publication.json contains the real receipt binding. Serialized own markers
    // at either level are ambiguous input, not a verified runtime publication context.
    if ([manifest, entry].some(value => record(value) && ['publication', 'publication_receipt', 'publication_authority', 'data_manifest_sha256', 'transport'].some(key => Object.hasOwn(value, key))) ||
        noSymlinks(join(root, '_transport')) || readOptional(join(root, 'publication.json')) || readOptional(join(dirname(root), 'publication.json'))) {
      fail('publication-bound manifests cannot be attached by this local exporter');
    }
    if (!record(entry) || entry.as_of_date !== snapshot.as_of_date || (entry.market !== undefined && entry.market !== 'US') ||
        (manifest.markets === undefined && manifest.default_market !== undefined && manifest.default_market !== 'US') ||
        (entry.assets !== undefined && !record(entry.assets))) fail('manifest market/date/assets mismatch');
    const previous = entry.assets?.market_indicator_history;
    if (previous !== undefined) {
      validateReference(previous);
      if (previous.as_of_date !== entry.as_of_date || !catalog.snapshots.some(item => jsonBytes(item).equals(jsonBytes(previous)))) fail('manifest history reference is not in the verified catalog');
    }
  }
  return { catalogPath, catalog, catalogBytes, manifest, manifestBytes };
}

function atomicWrite(path, bytes, { immutable = false } = {}) {
  noSymlinks(path);
  const existing = readOptional(path);
  if (existing?.equals(bytes)) return;
  if (immutable && existing) fail('immutable snapshot already exists with different bytes');
  const temporary = join(dirname(path), `.market-history-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    noSymlinks(path);
    if (immutable && existsSync(path)) fail('immutable snapshot appeared during write');
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function persistMarketHistorySnapshot({ store, snapshot, manifestPath = null, now = Date.now() }) {
  if (typeof store !== 'string' || !store.trim()) fail('store is required');
  const root = resolve(store);
  validateMarketHistorySnapshot(snapshot, { now });
  const bytes = jsonBytes(snapshot), sha256 = hash(bytes);
  const reference = { path: `market-history/snapshots/${sha256}.json`, sha256,
    schema_version: MARKET_HISTORY_SNAPSHOT_VERSION, as_of_date: snapshot.as_of_date, market: 'US' };
  const snapshotPath = join(root, reference.path);
  // Complete input/existing-state validation before creating directories or locks.
  loadState(root, manifestPath, snapshot, now);
  const existing = readOptional(snapshotPath);
  if (existing && !existing.equals(bytes)) fail('existing snapshot hash mismatch');
  const lockPath = join(root, '.market-history.lock');
  noSymlinks(lockPath);
  mkdirSync(root, { recursive: true });
  let lock;
  try {
    try { lock = openSync(lockPath, 'wx', 0o600); } catch (error) {
      if (error.code === 'EEXIST') fail('store is locked; concurrent or stale lock requires explicit review');
      throw error;
    }
    // Another writer may have completed between preflight and lock acquisition.
    const state = loadState(root, manifestPath, snapshot, now);
    const added = !state.catalog.snapshots.some(item => item.sha256 === sha256);
    if (added) state.catalog.snapshots.push(reference);
    if (state.manifest) {
      const entry = state.manifest.markets === undefined ? state.manifest : state.manifest.markets.US;
      entry.assets = { ...entry.assets, market_indicator_history: reference };
    }
    const catalogBytes = added || !state.catalogBytes ? jsonBytes(state.catalog) : state.catalogBytes;
    const manifestBytes = state.manifest ? jsonBytes(state.manifest) : null;
    noSymlinks(dirname(snapshotPath));
    mkdirSync(dirname(snapshotPath), { recursive: true });
    atomicWrite(snapshotPath, bytes, { immutable: true });
    atomicWrite(state.catalogPath, catalogBytes);
    if (manifestBytes) atomicWrite(resolve(manifestPath), manifestBytes);
    return { reference, snapshotPath, catalogPath: state.catalogPath, manifestPath: manifestPath ? resolve(manifestPath) : null, added };
  } finally {
    if (lock !== undefined) { closeSync(lock); unlinkSync(lockPath); }
  }
}
