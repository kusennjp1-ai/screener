// Publisher-controller data operation. Never replace code in the approved UI.
import {createHash, randomUUID} from 'node:crypto';
import {closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {cohortIdentity, readPerformanceArchive} from '../../frontend/tools/candidate-performance-archive.mjs';
import {HISTORY_RETENTION_SESSIONS} from '../../frontend/src/static/candidatePerformance.js';
import {createStaticTransport} from '../../frontend/src/static/transport/index.mjs';
import {DEFAULT_LIMITS, FORMAT, keysAre, parseCanonical, validateRoot} from '../../frontend/src/static/transport/format.mjs';
import {fetchPinned} from '../../frontend/src/static/transport/codec.mjs';
import bootstrap from './approved-ui-bootstrap.json' with {type: 'json'};

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const selectionIndex = 'candidate-history/index.json';
const performanceIndex = 'candidate-performance-history/index.json';
const methods = ['minervini', 'minervini2', 'oneil', 'ibd'];
const newYorkDay = timestamp => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'}).format(timestamp);

function read(root, path) {
  // Both roots are extracted, authenticated artifacts, not arbitrary URLs.
  for (const part of [root, ...path.split('/').map((_, i, parts) => join(root, ...parts.slice(0, i + 1)))]) {
    if (lstatSync(part).isSymbolicLink()) throw Error('History must not contain links');
  }
  if (!lstatSync(join(root, path)).isFile()) throw Error('History must contain regular files');
  return readFileSync(join(root, path));
}

function selection(root, ref, upperTime) {
  if (!/^candidate-history\/\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.json(?:\.gz)?$/.test(ref.path || '') || !validHash(ref.sha256) || !validDay(ref.as_of)) throw Error('Invalid selection reference');
  const raw = read(root, ref.path);
  if (hash(raw) !== ref.sha256) throw Error('Selection integrity failure');
  const snapshot = JSON.parse(ref.path.endsWith('.gz') ? gunzipSync(raw) : raw);
  const generated = Date.parse(snapshot.generated_at);
  if (snapshot.schema_version !== 1 || snapshot.as_of !== ref.as_of || !Array.isArray(snapshot.records) || !Number.isFinite(generated) || generated > upperTime || snapshot.as_of > newYorkDay(generated)) throw Error('Invalid selection identity or time');
  const symbols = new Set();
  for (const record of snapshot.records) {
    const key = `${record.market}:${record.symbol}`;
    if (typeof record.symbol !== 'string' || !record.symbol || symbols.has(key)) throw Error('Invalid or duplicate selection symbol');
    symbols.add(key);
  }
  return {ref, raw, snapshot: {...snapshot, published_ref: ref}};
}

function selections(root, upperTime) {
  const bytes = read(root, selectionIndex), catalog = JSON.parse(bytes), entries = new Map();
  if (catalog.schema_version !== 1 || !Array.isArray(catalog.snapshots)) throw Error('Invalid selection catalog');
  for (const ref of catalog.snapshots) {
    if (entries.has(ref.as_of)) throw Error('Duplicate selection reference');
    entries.set(ref.as_of, selection(root, ref, upperTime));
  }
  return {bytes, catalog, entries};
}

function eligibleObservation(entry, cohort, observation, notBefore = -Infinity) {
  if (!entry || !isDeepStrictEqual(cohortIdentity(entry.snapshot), cohort)) throw Error('Performance lacks matching published selection lineage');
  const record = entry.snapshot.records.find(record => record.market === 'US' && record.symbol === observation.symbol);
  const observed = Date.parse(observation.observed_at);
  if (record?.liquid !== true || !methods.some(method => record.methods?.[method]?.state === 'pass') || observed < notBefore || observed < Date.parse(entry.snapshot.generated_at) || observation.as_of <= cohort.as_of) throw Error('Performance violates selection eligibility or chronology');
}

async function performance(root, upperTime) {
  // Require the catalog: readPerformanceArchive's absent-index convenience is
  // inappropriate at this authenticated predecessor boundary.
  const bytes = read(root, performanceIndex), catalog = JSON.parse(bytes);
  if (catalog.schema_version !== 1 || !Array.isArray(catalog.cohorts)) throw Error('Invalid performance catalog');
  for (const ref of catalog.cohorts) {
    if (!/^candidate-performance-history\/\d{4}-\d{2}-\d{2}-[a-f0-9]{16}-[a-f0-9]{16}\.json\.gz$/.test(ref.path || '')) throw Error('Invalid performance path');
    read(root, ref.path);
  }
  const archive = await readPerformanceArchive(root, upperTime), entries = new Map();
  for (const ref of catalog.cohorts) {
    const raw = read(root, ref.path), saved = archive.get(ref.cohort_sha256);
    if (!Number.isSafeInteger(ref.observations) || ref.observations !== saved.observations.size || ref.path !== `candidate-performance-history/${ref.as_of}-${ref.cohort_sha256.slice(0, 16)}-${ref.sha256.slice(0, 16)}.json.gz`) throw Error('Performance count or content-address mismatch');
    entries.set(ref.cohort_sha256, {ref, raw, ...saved});
  }
  return {bytes, catalog, entries};
}

export function assertPreservedPerformance(before, after) {
  for (const [id, previous] of before.entries) {
    const current = after.entries.get(id);
    if (!current || !isDeepStrictEqual(current.cohort, previous.cohort)) throw Error('Selected export lost or changed a predecessor cohort');
    for (const [key, observation] of previous.observations) {
      if (!current.observations.has(key)) throw Error('Selected export lost a predecessor observation');
      if (!isDeepStrictEqual(current.observations.get(key), observation)) throw Error('Selected export changed a predecessor observation');
    }
  }
}

export async function prepareHistoryReconciliation({selectedRoot, publishedRoot, selectedAt, publishedAt, now = Date.now()}) {
  const selectedTime = Date.parse(selectedAt), publishedTime = Date.parse(publishedAt);
  if (![selectedTime, publishedTime, now].every(Number.isFinite) || publishedTime > now || selectedTime > now) throw Error('Invalid authenticated history chronology');
  const selectedSelections = selections(selectedRoot, selectedTime), publishedSelections = selections(publishedRoot, publishedTime);
  const selected = await performance(selectedRoot, selectedTime), published = await performance(publishedRoot, publishedTime);
  assertPreservedPerformance(published, selected);
  // A frozen cohort may outlive the rolling catalog. Authenticate its original
  // immutable selection file even when the catalog has legitimately aged out.
  const archivedSelections = new Map();
  for (const entry of published.entries.values()) {
    const ref = {path: entry.cohort.path, sha256: entry.cohort.sha256, as_of: entry.cohort.as_of};
    const indexed = publishedSelections.entries.get(ref.as_of);
    if (indexed && !isDeepStrictEqual(indexed.ref, ref)) throw Error('Published performance conflicts with its selection catalog');
    const original = indexed || selection(publishedRoot, ref, publishedTime);
    for (const observation of entry.observations.values()) eligibleObservation(original, entry.cohort, observation);
    archivedSelections.set(ref.path, original);
  }
  const merged = new Map(publishedSelections.entries);
  const lastPublishedDay = [...merged.keys()].sort().at(-1);
  for (const [day, entry] of selectedSelections.entries) {
    if (merged.has(day)) {
      if (!isDeepStrictEqual(merged.get(day).ref, entry.ref)) throw Error('Selected export changed a published first selection');
    } else {
      if (lastPublishedDay && day <= lastPublishedDay) throw Error('Selected export backfilled an unpublished historical selection');
      merged.set(day, entry);
    }
  }
  let added = 0, preserved = 0;
  for (const [id, current] of selected.entries) {
    const previous = published.entries.get(id);
    for (const [key, observation] of current.observations) {
      if (previous?.observations.has(key)) { preserved++; continue; }
      // Only a selection already present in the verified predecessor may
      // acquire a completed return. A new selected snapshot is retained, but
      // cannot become a historical performance cohort in this publication.
      const entry = publishedSelections.entries.get(current.cohort.as_of);
      if (!entry || !isDeepStrictEqual(cohortIdentity(entry.snapshot), current.cohort)) throw Error('New performance lacks previously published selection lineage');
      eligibleObservation(entry, current.cohort, observation, publishedTime);
      added++;
    }
  }
  const payloads = [...new Map([...archivedSelections.values(), ...merged.values()].map(entry => [entry.ref.path, entry])).values()].map(entry => ({path: entry.ref.path, bytes: entry.raw}));
  // Keep exact selected archive bytes, including original embedded intervals.
  // Every predecessor observation was checked unchanged above.
  payloads.push(...[...new Map([...published.entries.values(), ...selected.entries.values()].map(entry => [entry.ref.path, entry])).values()].map(entry => ({path: entry.ref.path, bytes: entry.raw})));
  const selectionBytes = Buffer.from(JSON.stringify({schema_version: 1, snapshots: [...merged.values()].sort((a, b) => a.ref.as_of.localeCompare(b.ref.as_of)).map(entry => entry.ref)}));
  const catalogs = [{path: selectionIndex, bytes: selectionBytes}, {path: performanceIndex, bytes: selected.bytes}];
  // Detect destination collisions and validate the complete input before any
  // payload, directory or catalog is changed.
  for (const file of payloads) if (existsSync(join(selectedRoot, file.path)) && !read(selectedRoot, file.path).equals(file.bytes)) throw Error('Immutable history path collision');
  return {root: selectedRoot, payloads, catalogs, summary: {schema_version: 'candidate-history-reconciliation-v1',
    predecessor_selection_sha256: hash(publishedSelections.bytes), predecessor_performance_sha256: hash(published.bytes),
    selected_selection_sha256: hash(selectedSelections.bytes), selected_performance_sha256: hash(selected.bytes),
    output_selection_sha256: hash(selectionBytes), output_performance_sha256: hash(selected.bytes),
    published_observations: preserved, admitted_observations: added, cohorts: selected.entries.size, selections: merged.size}};
}

function writablePath(root, relative) {
  const parts = relative.split('/');
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw Error('History write root must be a regular directory');
  let path = root;
  for (const [i, part] of parts.entries()) {
    path = join(path, part);
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw Error('History write path must not contain links or special files');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return path;
}

function atomicWrite(root, relative, bytes, immutable = false) {
  const path = writablePath(root, relative);
  mkdirSync(dirname(path), {recursive: true});
  writablePath(root, relative);
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, 'wx'); writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    if (immutable) {
      // Publish a completed inode without ever replacing an immutable path.
      // A concurrent creator must have exactly the expected regular bytes.
      try { linkSync(temporary, path); }
      catch (error) {
        if (error.code !== 'EEXIST' || !lstatSync(path).isFile() || !readFileSync(path).equals(bytes)) throw error;
      }
    } else renameSync(temporary, path);
    const directory = openSync(dirname(path), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, {force: true}); }
}

export function writeHistoryPayloads(plan) {
  for (const file of plan.payloads) {
    const path = join(plan.root, file.path);
    if (existsSync(path)) { if (!read(plan.root, file.path).equals(file.bytes)) throw Error('Immutable history path collision'); }
    else atomicWrite(plan.root, file.path, file.bytes, true);
  }
}

export function commitHistoryCatalogs(plan) {
  for (const file of plan.payloads) if (!read(plan.root, file.path).equals(file.bytes)) throw Error('History payload changed before catalog commit');
  // Selection first: it is a union, so even interruption before performance
  // replacement leaves every old performance selection reachable. A stopped
  // payload phase leaves only harmless immutable orphans and old catalogs.
  for (const file of plan.catalogs) atomicWrite(plan.root, file.path, file.bytes);
  return plan.summary;
}

// Equivalent predecessor proof when its Actions ZIP has expired: the already
// authenticated live receipt pins this exact transport root, which pins both
// the inventory and every shard/payload. No unpinned live-history fallback.
export async function restorePackedHistory({expectedRoot, root, fetcher = fetch}) {
  if (existsSync(root)) throw Error('Packed history destination must be new');
  const signal = AbortSignal.timeout(60_000), baseURL = new URL(bootstrap.site_url);
  const transport = await createStaticTransport({baseURL: baseURL.href, expectedRoot, fetchImpl: fetcher, signal});
  try {
    const metadata = validateRoot(parseCanonical(await fetchPinned({baseURL, descriptor: expectedRoot, cap: DEFAULT_LIMITS.rootBytes, fetchImpl: fetcher, signal})), expectedRoot);
    const inventory = parseCanonical(await fetchPinned({baseURL, descriptor: metadata.logicalInventory, cap: DEFAULT_LIMITS.inventoryBytes, fetchImpl: fetcher, signal}));
    if (!keysAre(inventory, ['format', 'files']) || inventory.format !== FORMAT || !inventory.files || Array.isArray(inventory.files)) throw Error('Invalid pinned history inventory');
    const files = new Map();let total = 0;
    const load = async (path, expectedHash) => {
      if (!/^(?:candidate-history\/(?:index\.json|\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.json(?:\.gz)?)|candidate-performance-history\/(?:index\.json|\d{4}-\d{2}-\d{2}-[a-f0-9]{16}-[a-f0-9]{16}\.json\.gz))$/.test(path || '')) throw Error('Unexpected packed history path');
      const pin = inventory.files[`static-data/${path}`];
      if (!keysAre(pin, ['bytes', 'sha256']) || !Number.isSafeInteger(pin.bytes) || pin.bytes < 0 || pin.bytes > DEFAULT_LIMITS.decodedBytes || !validHash(pin.sha256) || (expectedHash !== undefined && pin.sha256 !== expectedHash)) throw Error('Packed history inventory mismatch');
      if (files.has(path)) return files.get(path);
      total += pin.bytes;
      if (files.size >= 10_000 || total > 256 * 1024 * 1024) throw Error('Packed history exceeds bounded recovery size');
      const bytes = Buffer.from(await transport.readBytes(`static-data/${path}`, {expectedDecodedSha256: pin.sha256, expectedDecodedBytes: pin.bytes}));
      files.set(path, bytes);return bytes;
    };
    const selected = JSON.parse(await load(selectionIndex)), completed = JSON.parse(await load(performanceIndex));
    if (selected.schema_version !== 1 || !Array.isArray(selected.snapshots) || completed.schema_version !== 1 || !Array.isArray(completed.cohorts)) throw Error('Invalid packed history catalog');
    for (const ref of selected.snapshots) await load(ref.path, ref.sha256);
    for (const ref of completed.cohorts) {
      const value = JSON.parse(gunzipSync(await load(ref.path, ref.sha256), {maxOutputLength: 64 * 1024 * 1024}));
      await load(value.cohort?.path, value.cohort?.sha256);
    }
    // Nothing is materialized until the complete requested closure verifies.
    mkdirSync(root, {recursive: true});
    for (const [path, bytes] of files) atomicWrite(root, path, bytes, true);
    return {root_sha256: expectedRoot.sha256, generation: expectedRoot.generation, files: files.size, bytes: total};
  } finally { transport.dispose(); }
}

export async function verifyReconciledPerformance({baselineRoot, finalRoot, publishedRoot, publishedAt, now = Date.now()}) {
  const baseline = await performance(baselineRoot, now), final = await performance(finalRoot, now);
  assertPreservedPerformance(baseline, final);
  // Enrichment may freeze more observations after the selected artifact was
  // created. Those additions still need the same original publication lineage;
  // a selected-only snapshot cannot gain authority by passing through a build.
  const checked = await prepareHistoryReconciliation({selectedRoot: finalRoot, publishedRoot, publishedAt, selectedAt: new Date(now).toISOString(), now});
  for (const file of checked.payloads) if (!read(finalRoot, file.path).equals(file.bytes)) throw Error('Final build lost immutable history bytes');
  const before = selections(baselineRoot, now), after = selections(finalRoot, now);
  const all = new Map(before.entries), last = [...all.keys()].sort().at(-1);
  for (const [day, entry] of after.entries) {
    if (all.has(day)) {
      if (!isDeepStrictEqual(all.get(day).ref, entry.ref)) throw Error('Final build changed an admitted first selection');
    } else {
      if (last && day <= last) throw Error('Final build backfilled a historical selection');
      all.set(day, entry);
    }
  }
  for (const day of [...all.keys()].sort().slice(-HISTORY_RETENTION_SESSIONS)) {
    if (!after.entries.has(day)) throw Error('Final build lost an admitted selection');
  }
  for (const entry of before.entries.values()) if (!read(finalRoot, entry.ref.path).equals(entry.raw)) throw Error('Final build lost or changed immutable selection bytes');
  for (const entry of baseline.entries.values()) if (!read(finalRoot, entry.ref.path).equals(entry.raw)) throw Error('Final build lost or changed immutable performance bytes');
}
