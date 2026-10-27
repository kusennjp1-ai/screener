// Synthetic byte fixtures; these do not claim an actual baseline UI pass.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { encodeResearchRecordArrays } from '../../src/static/researchRecordArrays.js';
import { summarizeWorkbench } from '../../src/static/workbenchSummary.js';
import { representationGraph, REPRESENTATION_SCHEMA } from '../baseline-representation.mjs';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const bytes = value => Buffer.from(JSON.stringify(value));
export const write = (root, path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
export function wireFixture(form = 'values') {
  const records = [[{ value: -0, absent: null }], [], null];
  const arrays = encodeResearchRecordArrays(form === 'present' ? records.slice(0, 2) : records, value => gzipSync(bytes(value)).length);
  const column = form === 'pool' ? { arrays_pool: arrays, refs: [0, 1, 2] } : form === 'present' ? { arrays_present: arrays, missing: [[2, 3]] } : { arrays_values: arrays };
  return { schema: 'research-table-v2', column_encoding: 'sparse-record-arrays-and-copy-masks-v1', as_of_date: '2026-10-26', financial_evaluated_at: 1793059200000, financial_generation: 'a'.repeat(64), count: 3,
    fields: [['symbol'], ['value'], ['copy'], ['history']], columns: [{ values: ['AAA', 'BBB', 'CCC'] }, { values: [2, 0, 3] },
      { copy: 1, factor: -1, patch: [[2, 4]], absent_bitmap: 'AQ==', null_bitmap: 'Ag==' }, column],
    paths: {}, orders: { minervini: [2, 1, 0] }, negative_zeros: [[0, 3, [0, 'value']]] };
}
export function graphFixture() {
  const source = new Map(), add = (name, data) => { source.set('static-data/' + name, data); return name; };
  const wire = wireFixture(), research = bytes(wire), researchHash = digest(research), researchPath = add(`research-index-${researchHash.slice(0, 16)}.json`, research);
  const snapshot = bytes({ source_research_sha256: researchHash, as_of: wire.as_of_date, records: [{ symbol: 'AAA', methods: { minervini: { state: 'pass', rules: [['pass', 1]] } } }] });
  const snapshotId = digest(snapshot), compressed = gzipSync(snapshot), snapshotPath = add(`candidate-history/${wire.as_of_date}-${snapshotId.slice(0, 16)}.json.gz`, compressed);
  const current = { path: snapshotPath, sha256: digest(compressed), as_of: wire.as_of_date };
  const full = { as_of: wire.as_of_date, source_research_sha256: researchHash, snapshot_id: snapshotId, current_snapshot: current,
    daily_changes_snapshot: current, comparison_basis: { saved_first: { ...current, generated_at: '2026-10-26T22:00:00Z' } },
    changes: { minervini: { counts: { new: 1 }, items: [{ symbol: 'AAA', state: 'new' }] } }, sectors: ['original'] };
  const fullBytes = bytes(full), fullHash = digest(fullBytes), fullPath = add(`workbench-${fullHash.slice(0, 16)}.json`, fullBytes);
  const fullRef = { path: fullPath, sha256: fullHash, snapshot_id: snapshotId, as_of_date: wire.as_of_date }, summary = bytes(summarizeWorkbench(full, fullRef)), summaryHash = digest(summary), summaryPath = add(`workbench-summary-${summaryHash.slice(0, 16)}.json`, summary);
  const manifest = { as_of_date: wire.as_of_date, research_generation: researchHash, financial_generation: wire.financial_generation, assets: { research: { path: researchPath }, workbench: fullRef,
    workbench_summary: { path: summaryPath, sha256: summaryHash, snapshot_id: snapshotId, source_research_sha256: researchHash } } };
  add('manifest.json', bytes(manifest));
  return { source, graph: representationGraph(name => source.get(name)), manifest, full };
}
export function storedFixture(directory, overrides = {}) {
  const f = graphFixture(), table = map => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => [name, { sha256: digest(value), bytes: value.length }]));
  const proof = { schema: REPRESENTATION_SCHEMA, publication_authority: 'none', financial_admission: false, baseline_sha: '1e1943e1d5f78a738a05baa69eb9f2e8508e32ac',
    decoder_sources: { 'frontend/src/static/researchTransport.js': 'c'.repeat(64) }, canonical_data_inventory_sha256: 'd'.repeat(64), current_manifest_sha256: digest(f.source.get('static-data/manifest.json')),
    originals: table(f.graph.originals), files: table(f.graph.files), research: f.graph.research, ...overrides };
  for (const [name, value] of f.graph.originals) write(directory, 'original/' + name, value);
  for (const [name, value] of f.graph.files) write(directory, 'served/' + name, value);
  write(directory, 'proof.json', bytes(proof));
  return { ...f, proof, sha256: digest(bytes(proof)), directory };
}
