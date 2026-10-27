// @vitest-environment node
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { dataInventoryDigest } from '../../.github/scripts/publication-state.mjs';
import { fileURLToPath } from 'node:url';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { summarizeWorkbench } from '../src/static/workbenchSummary.js';
import { baselineResearchWire, representationGraph, verifyStoredRepresentation, verifyBaselineRepresentation, representationResponse, prepareBaselineRepresentation } from './baseline-representation.mjs';
import { verifyRepresentationReport } from './screening-priority-acceptance.mjs';
import { wireFixture, graphFixture, storedFixture, bytes, digest, write } from './fixtures/design-baseline-representation.mjs';
const scratch = t => { const root = mkdtempSync(join(tmpdir(), 'baseline-representation-')); t.onTestFinished(() => rmSync(root, { recursive: true, force: true })); return root; };
for (const form of ['values', 'present', 'pool']) test(`legacy expansion preserves ${form}, null/absent, signed zero and factor after JSON`, () => {
  const input = wireFixture(form), before = bytes(input), result = baselineResearchWire(input), decoded = decodeResearchIndex(JSON.parse(bytes(result)));
  assert.equal(result.column_encoding, 'sparse-binary-and-signed-zero-v1'); assert.deepStrictEqual(decoded, decodeResearchIndex(input)); assert(bytes(input).equals(before));
  assert(Object.is(decoded.rows[0].history[0].value, -0)); assert(!Object.hasOwn(decoded.rows[0], 'copy')); assert.equal(decoded.rows[1].copy, null); assert.equal(decoded.rows[2].copy, 4);
});
test('malformed mixed encoding, overlapping masks and invalid signed-zero reject before downgrade', () => {
  for (const mutate of [wire => wire.columns[3].values = [], wire => wire.columns[2].null_bitmap = 'AQ==', wire => wire.negative_zeros.push([0, 2, []])]) {
    const wire = wireFixture(); mutate(wire); assert.throws(() => baselineResearchWire(wire));
  }
});
test('closed graph preserves decisions, saved observations, all other metadata and source bytes', () => {
  const { source, graph, full } = graphFixture(), before = [...source].map(([name, value]) => [name, Buffer.from(value)]);
  const manifest = JSON.parse(graph.files.get('static-data/manifest.json')), nextFull = JSON.parse(graph.files.get('static-data/' + manifest.assets.workbench.path)), summary = JSON.parse(graph.files.get('static-data/' + manifest.assets.workbench_summary.path));
  assert.deepStrictEqual(summary, summarizeWorkbench(nextFull, manifest.assets.workbench));
  assert.deepStrictEqual(nextFull.daily_changes_snapshot, full.daily_changes_snapshot); assert.deepStrictEqual(nextFull.comparison_basis, full.comparison_basis);
  for (const key of Object.keys(full).filter(key => !['source_research_sha256', 'snapshot_id', 'current_snapshot'].includes(key))) assert.deepStrictEqual(nextFull[key], full[key]);
  assert.deepStrictEqual([...source], before); assert.equal(graph.files.size, 5);
});
test('graph refuses corrupt source identity instead of repairing it', () => {
  const f = graphFixture(), manifest = { ...f.manifest, research_generation: 'e'.repeat(64) }; f.source.set('static-data/manifest.json', bytes(manifest));
  assert.throws(() => representationGraph(name => f.source.get(name)), /identity/);
});
test('stored proof verifies exact graph and actual HTTP bytes; no unknown override', t => {
  const root = scratch(t), f = storedFixture(root), verified = verifyStoredRepresentation(root, f.sha256), baseline = join(root, 'baseline'), other = join(root, 'other'); mkdirSync(baseline); mkdirSync(other); verified.baselineRoot = realpathSync(baseline);
  const path = 'static-data/' + f.graph.research.path;
  assert(representationResponse(verified, baseline, path, baseline).equals(f.graph.files.get(path))); assert.equal(representationResponse(verified, baseline, 'index.html', baseline), null);
  assert.throws(() => representationResponse(verified, other, path, baseline), /another UI/);
  assert.throws(() => representationResponse(verified, other, path, other), /another UI/);
  assert.throws(() => representationResponse(verified, baseline, '../index.html', baseline), /Unsafe/);
  write(root, 'served/static-data/unapproved.json', '{}'); assert.throws(() => verifyStoredRepresentation(root), /Unknown/);
});
for (const mutation of ['served', 'original', 'proof', 'missing', 'linked']) test('rejects '+mutation+' representation tampering', t => {
  const root = scratch(t), f = storedFixture(root), name = 'served/static-data/' + f.graph.research.path;
  if (mutation === 'served') write(root, name, '{}');
  if (mutation === 'original') write(root, 'original/static-data/manifest.json', '{}');
  if (mutation === 'proof') write(root, 'proof.json', bytes({ ...f.proof, decoder_sources: { 'outside.js': 'c'.repeat(64) } }));
  if (mutation === 'missing') rmSync(join(root, name));
  if (mutation === 'linked') { rmSync(join(root, name)); symlinkSync(join(root, 'original/static-data/manifest.json'), join(root, name)); }
  assert.throws(() => verifyStoredRepresentation(root, f.sha256));
});
test('current root and parent symlink alias cannot receive a baseline overlay', async t => {
  const root = scratch(t), current = join(root, 'baseline/frontend/dist'); mkdirSync(current, { recursive: true });
  await assert.rejects(prepareBaselineRepresentation({ currentRoot: current, baselineRoot: current, output: root, baselineSha: 'a'.repeat(40) }), /Wrong/);
  const alias = join(root, 'alias'); symlinkSync(join(root, 'baseline'), alias, 'junction');
  await assert.rejects(prepareBaselineRepresentation({ currentRoot: join(alias, 'frontend/dist'), baselineRoot: current, output: root, baselineSha: 'a'.repeat(40) }), /Wrong/);
});
test('report binds served raw/gzip and each actual HTTP response to captured bytes', t => {
  const output = scratch(t), directory = join(output, 'baseline-representation'), f = storedFixture(directory), served = Object.fromEntries(Object.entries(f.proof.files).map(([name, identity]) => [name, { ...identity, responses: 1 }]));
  const report = { baseline_representation: { proof_sha256: f.sha256, baseline_sha: f.proof.baseline_sha, canonical_data_inventory_sha256: f.proof.canonical_data_inventory_sha256, research: f.proof.research, served, received: structuredClone(served) }, transport: [{ label: 'baseline', raw_bytes: f.proof.research.raw_bytes, gzip_bytes: f.proof.research.gzip_bytes }] };
  verifyRepresentationReport(output, report, f.sha256); report.transport[0].gzip_bytes--;
  assert.throws(() => verifyRepresentationReport(output, report, f.sha256), /served bytes/); report.transport[0].gzip_bytes++;
  report.baseline_representation.served['static-data/manifest.json'].sha256 = digest('changed');
  assert.throws(() => verifyRepresentationReport(output, report, f.sha256), /response/);
  assert(readFileSync(join(directory, 'proof.json')).equals(bytes(f.proof)));
});

test('selected workflow baseline ref reaches measurement, final binding and package steps', () => {
  const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/design-acceptance.yml', import.meta.url)), 'utf8');
  assert.match(workflow, /timeout-minutes: 120\s+env:\s+BASELINE_REF: \$\{\{ inputs\.baseline_ref \|\| '1e1943e1d5f78a738a05baa69eb9f2e8508e32ac' \}\}/);
});

test('live adapter binds selected decoder and canonical carry tree without changing either tree', async t => {
  const root = scratch(t), baselineRepo = join(root, 'baseline'), baselineRoot = join(baselineRepo, 'frontend/dist'), currentRoot = join(root, 'current'), output = join(root, 'output');
  mkdirSync(baselineRoot, { recursive: true }); mkdirSync(currentRoot); mkdirSync(output);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Synthetic fixture', '-c', 'user.email=synthetic@example.invalid', '-c', 'commit.gpgsign=false', '-C', baselineRepo, ...args], { encoding: 'utf8' }).trim();
  const sourceRoot = fileURLToPath(new URL('..', import.meta.url)), seen = new Set();
  function copyModule(name) {
    if (seen.has(name)) return; seen.add(name);
    const content = readFileSync(join(sourceRoot, name), 'utf8'); write(baselineRepo, 'frontend/' + name, content);
    for (const match of content.matchAll(/from ['"](\.[^'"]+)['"]/g)) copyModule(relative(sourceRoot, resolve(sourceRoot, dirname(name), match[1])).split(sep).join('/'));
  }
  copyModule('src/static/researchTransport.js'); write(baselineRepo, 'frontend/package.json', '{"type":"module"}');
  git('init'); git('add', 'frontend'); git('commit', '-m', 'Synthetic selected decoder'); const baselineSha = git('rev-parse', 'HEAD');
  const f = graphFixture(); for (const [name, content] of f.source) write(baselineRoot, name, content);
  write(baselineRoot, 'static-data/candidate-history/index.json', '{"immutable":true}');
  const digestBefore = dataInventoryDigest(baselineRoot), publication = { data_manifest_sha256: digest(f.source.get('static-data/manifest.json')), transport: { logical_data_inventory_sha256: digestBefore } };
  write(currentRoot, 'publication.json', bytes(publication));
  const options = { currentRoot, baselineRoot, output, baselineSha };
  await assert.rejects(prepareBaselineRepresentation({ ...options, output: currentRoot }), /cannot modify/);
  await assert.rejects(prepareBaselineRepresentation({ ...options, output: baselineRoot }), /cannot modify/);
  const prepared = await prepareBaselineRepresentation(options);
  assert.equal(dataInventoryDigest(baselineRoot), digestBefore); assert.equal(prepared.proof.canonical_data_inventory_sha256, digestBefore);
  verifyBaselineRepresentation({ ...options, directory: prepared.directory });
  assert.throws(() => verifyBaselineRepresentation({ ...options, baselineSha: 'f'.repeat(40), directory: prepared.directory }), /identity/);
  write(baselineRoot, 'static-data/candidate-history/index.json', '{"immutable":false}');
  assert.throws(() => verifyBaselineRepresentation({ ...options, directory: prepared.directory }), /inventory/);
  await assert.rejects(prepareBaselineRepresentation(options), /already exists/);
});
