// Dependency-free storage and CLI regression: node --test tools/market-history-store.node.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { MARKET_HISTORY_CATALOG_VERSION, persistMarketHistorySnapshot } from './market-history-store.mjs';

const now = Date.parse('2026-10-13T12:00:00Z');
const fixture = (changes = {}) => ({ schema_version: 'market-indicator-snapshot-v1', market: 'US', as_of_date: '2026-10-09',
  history: { version: 'market-indicator-history-v1', series: [{ metric: 'institutional_holders', market: 'US',
    population: 'synthetic-only-managers-v1', method: 'synthetic-only-method-v1', source: 'synthetic-only-source',
    unit: 'reporting_managers', frequency: 'quarterly', scope: 'security', instrument: 'SYNTH', approximate: true,
    observations: [{ date: '2026-03-31', value: 100, collected_at: '2026-10-10T01:00:00.000Z' },
      { date: '2026-06-30', value: null, collected_at: '2026-10-10T01:00:00.000Z' }] }] },
  provenance: { source: 'synthetic-only', no_publication: true }, ...changes });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const temporary = t => { const dir = mkdtempSync(join(tmpdir(), 'market-history-store-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
const save = (store, snapshot = fixture(), extra = {}) => persistMarketHistorySnapshot({ store, snapshot, now, ...extra });
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const tree = root => {
  const result = {};
  const visit = (dir, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(join(dir, entry.name), `${name}/`);
      else if (entry.isFile()) result[name] = digest(readFileSync(join(dir, entry.name)));
      else result[name] = 'not-a-regular-file';
    }
  };
  visit(root);
  return result;
};

test('saves and re-reads an immutable hashed snapshot, preserving unknown rather than zero', t => {
  const store = temporary(t), output = save(store);
  const bytes = readFileSync(output.snapshotPath), snapshot = read(output.snapshotPath), catalog = read(output.catalogPath);
  assert.equal(digest(bytes), output.reference.sha256);
  assert.equal(snapshot.history.series[0].observations[1].value, null);
  assert.deepEqual(snapshot, fixture());
  assert.deepEqual(catalog, { schema_version: MARKET_HISTORY_CATALOG_VERSION, market: 'US', snapshots: [output.reference] });
});

test('retains two generations without merging different methods, sources or cutoffs', t => {
  const store = temporary(t), first = save(store);
  const next = fixture({ as_of_date: '2026-10-12' });
  Object.assign(next.history.series[0], { population: 'other-reported-population', source: 'other-source', method: 'other-method' });
  next.history.series[0].observations[1].value = 120;
  const second = save(store, next), catalog = read(second.catalogPath);
  assert.notEqual(first.reference.sha256, second.reference.sha256);
  assert.deepEqual(catalog.snapshots, [first.reference, second.reference]);
  assert.deepEqual(read(first.snapshotPath), fixture());
  assert.deepEqual(read(second.snapshotPath), next);
});

test('same snapshot is byte-idempotent and does not rewrite existing snapshot/catalog bytes', t => {
  const store = temporary(t), first = save(store);
  writeFileSync(first.catalogPath, JSON.stringify(read(first.catalogPath), null, 4));
  const before = tree(store), modified = statSync(first.snapshotPath).mtimeMs;
  assert.equal(save(store).added, false);
  assert.deepEqual(tree(store), before);
  assert.equal(statSync(first.snapshotPath).mtimeMs, modified);
});

test('manifest attachment changes only the selected asset and supports explicit legacy manifests', t => {
  const parent = temporary(t);
  for (const legacy of [false, true]) {
    const store = join(parent, String(legacy)); mkdirSync(store);
    const entry = { market: 'US', as_of_date: '2026-10-09', assets: { workbench: { path: 'existing-workbench.json' } }, financial_generation: 'keep-financial-identity' };
    const original = legacy ? entry : { as_of_date: '2026-10-12', markets: { US: entry, HK: { as_of_date: '2026-10-12', assets: { scan: { path: 'hk.json' } } } }, unrelated: { preserve: true } };
    const manifestPath = join(store, 'manifest.json'); writeFileSync(manifestPath, JSON.stringify(original));
    const output = save(store, fixture(), { manifestPath });
    const expected = structuredClone(original), selected = legacy ? expected : expected.markets.US;
    selected.assets.market_indicator_history = output.reference;
    assert.deepEqual(read(manifestPath), expected);
    const before = tree(store); save(store, fixture(), { manifestPath }); assert.deepEqual(tree(store), before);
  }
});

test('invalid manifest date or path fails before writing snapshots or catalog', t => {
  const store = temporary(t), manifestPath = join(store, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({ as_of_date: '2026-10-08', assets: {} }));
  const before = tree(store);
  assert.throws(() => save(store, fixture(), { manifestPath }), /manifest market\/date\/assets mismatch/);
  assert.deepEqual(tree(store), before);
  assert.throws(() => save(store, fixture(), { manifestPath: join(store, '..', 'elsewhere.json') }), /manifest must be/);
  assert.deepEqual(tree(store), before);
});

test('broken existing snapshot hash fails closed without appending a generation', t => {
  const store = temporary(t), first = save(store);
  writeFileSync(first.snapshotPath, '{}');
  const before = tree(store);
  assert.throws(() => save(store, fixture({ as_of_date: '2026-10-12' })), /snapshot hash mismatch/);
  assert.deepEqual(tree(store), before);
});

test('invalid catalogs and references are rejected before mutation', t => {
  const parent = temporary(t);
  const mutations = [catalog => { catalog.market = 'HK'; }, catalog => { catalog.snapshots[0].path = '../outside.json'; },
    catalog => { catalog.snapshots[0].as_of_date = '2026-10-08'; }, catalog => { catalog.snapshots.push(catalog.snapshots[0]); }];
  for (const [index, mutate] of mutations.entries()) {
    const store = join(parent, String(index)), output = save(store), catalog = read(output.catalogPath);
    mutate(catalog); writeFileSync(output.catalogPath, JSON.stringify(catalog));
    const before = tree(store); assert.throws(() => save(store)); assert.deepEqual(tree(store), before);
  }
});

test('a manifest may not select an unverified or altered existing reference', t => {
  const store = temporary(t), first = save(store), manifestPath = join(store, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({ as_of_date: '2026-10-09', assets: { market_indicator_history: { ...first.reference, sha256: 'a'.repeat(64) } } }));
  const before = tree(store);
  assert.throws(() => save(store, fixture(), { manifestPath }), /reference|path/);
  assert.deepEqual(tree(store), before);
});

test('symlink store roots and history files are refused', t => {
  const parent = temporary(t), real = join(parent, 'real'), alias = join(parent, 'alias');
  mkdirSync(real); symlinkSync(real, alias, 'dir');
  assert.throws(() => save(alias), /symlink/);
  assert.deepEqual(tree(real), {});
  const first = save(real), outside = join(parent, 'outside.json');
  writeFileSync(outside, readFileSync(first.snapshotPath)); rmSync(first.snapshotPath); symlinkSync(outside, first.snapshotPath);
  const before = tree(real); assert.throws(() => save(real), /symlink/); assert.deepEqual(tree(real), before);
});

test('an existing writer lock is not removed automatically', t => {
  const store = temporary(t), lock = join(store, '.market-history.lock');
  writeFileSync(lock, 'review this lock explicitly');
  const before = tree(store);
  assert.throws(() => save(store), /locked.*explicit review/);
  assert.deepEqual(tree(store), before);
});

test('publication receipts or transport bindings block manifest attachment', t => {
  const parent = temporary(t);
  for (const [index, setup] of [
    (store, manifest) => { manifest.publication = {}; },
    store => writeFileSync(join(store, 'publication.json'), '{}'),
    store => mkdirSync(join(store, '_transport')),
  ].entries()) {
    const store = join(parent, String(index)); mkdirSync(store);
    const manifest = { as_of_date: '2026-10-09' }; setup(store, manifest);
    const manifestPath = join(store, 'manifest.json'); writeFileSync(manifestPath, JSON.stringify(manifest));
    const before = tree(store); assert.throws(() => save(store, fixture(), { manifestPath }), /publication-bound/); assert.deepEqual(tree(store), before);
  }
});

for (const location of ['legacy root', 'multi-market root', 'selected US entry']) {
  for (const [marker, value] of [
    ['publication', { mode: 'packed', expectedRoot: { sha256: 'b'.repeat(64) } }],
    ['publication_receipt', { data_manifest_sha256: 'c'.repeat(64) }],
    ['publication_authority', 'none'],
    ['data_manifest_sha256', 'd'.repeat(64)],
    ['transport', { schema_version: 'static-json-transport-publication-v1' }],
    ['publication', null],
    ['transport', false],
  ]) test(`${location} ${marker}=${JSON.stringify(value)} refuses attachment without changing existing data`, t => {
    const store = temporary(t);
    save(store, fixture({ as_of_date: '2026-10-08' }));
    const entry = { market: 'US', as_of_date: '2026-10-09', assets: {}, financial_generation: 'preserve-financial-metadata' };
    const manifest = location === 'legacy root' ? entry : {
      markets: { US: entry, HK: { as_of_date: '2026-10-12', assets: { unchanged: { path: 'hk.json' } } } },
      default_market: 'US', supported_markets: ['US', 'HK'],
    };
    (location === 'selected US entry' ? entry : manifest)[marker] = value;
    const manifestPath = join(store, 'manifest.json'); writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const before = tree(store), manifestBytes = readFileSync(manifestPath);
    assert.throws(() => save(store, fixture(), { manifestPath }), /publication-bound/);
    assert.deepEqual(tree(store), before);
    assert.deepEqual(readFileSync(manifestPath), manifestBytes);
  });
}

test('invalid dates, foreign markets and fabricated raw values are rejected', t => {
  const store = temporary(t);
  for (const mutate of [s => { s.as_of_date = '2026-02-30'; }, s => { s.market = 'HK'; }, s => { s.as_of_date = '2027-01-01'; },
    s => { s.history.series[0].observations[1].value = ''; }, s => { s.history.series[0].observations[0].collected_at = null; },
    s => { s.history.series[0].observations[1].collected_at = '2026-11-01T01:00:00Z'; }]) {
    const snapshot = fixture(); mutate(snapshot); assert.throws(() => save(store, snapshot)); assert.deepEqual(tree(store), {});
  }
});

test('concurrent processes preserve every successful append or refuse a locked writer', async t => {
  const store = temporary(t), script = `import { persistMarketHistorySnapshot } from ${JSON.stringify(new URL('./market-history-store.mjs', import.meta.url).href)}; import {readFileSync} from 'node:fs'; try {const out=persistMarketHistorySnapshot({store:process.argv[1],snapshot:JSON.parse(readFileSync(process.argv[2])),now:${now}}); console.log(JSON.stringify(out.reference));} catch(e) {console.error(e.message);process.exitCode=1;}`;
  const run = source => new Promise(resolve => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, store, source]);
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  const sources = [join(store, 'input-a.json'), join(store, 'input-b.json')];
  sources.forEach((source, index) => writeFileSync(source, JSON.stringify(fixture({ as_of_date: index ? '2026-10-12' : '2026-10-09' }))));
  const results = await Promise.all(sources.map(run));
  const successful = results.filter(result => result.code === 0).map(result => JSON.parse(result.stdout));
  assert.ok(successful.length >= 1);
  for (const result of results.filter(result => result.code !== 0)) assert.match(result.stderr, /locked/);
  const catalog = read(join(store, 'market-history', 'catalog.json'));
  assert.equal(catalog.snapshots.length, successful.length);
  for (const reference of successful) assert.ok(catalog.snapshots.some(item => item.sha256 === reference.sha256));
});

test('CLI builds from explicit synthetic gzip/mapping bytes and preserves input hashes', t => {
  const store = temporary(t), seedPath = join(store, 'seed.json.gz'), mappingPath = join(store, 'mapping.json');
  const seed = { publication_cutoff: '2026-08-31', periods: ['2026-03-31', '2026-06-30'], retrieved_at: '2026-09-01T00:00:00Z',
    archives: [{ file: 'synthetic.zip', sha256: 'a'.repeat(64) }], reports_selected: 100, incomplete_manager_periods: 0,
    securities: { SYNTH0001: { name: 'Synthetic only', class: 'COM', observations: [
      { period: '2026-03-31', manager_count: 100, filing_date_first: '2026-04-10', filing_date_last: '2026-05-15' },
      { period: '2026-06-30', manager_count: 0, filing_date_first: '2026-07-10', filing_date_last: '2026-08-15' },
    ] } } };
  const mapping = { SYNTH0001: { symbol: 'SYNTH', source: 'OpenFIGI', retrieved_at: '2026-09-02T00:00:00Z' } };
  writeFileSync(seedPath, gzipSync(JSON.stringify(seed))); writeFileSync(mappingPath, JSON.stringify(mapping));
  const args = [fileURLToPath(new URL('./export-market-history.mjs', import.meta.url)), '--as-of', '2026-10-09', '--symbols', 'SYNTH', '--store', store, '--seed', seedPath, '--mapping', mappingPath];
  const run = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout), snapshot = read(output.snapshotPath);
  assert.deepEqual(snapshot.provenance.input_files, { seed_sha256: digest(readFileSync(seedPath)), mapping_sha256: digest(readFileSync(mappingPath)) });
  assert.equal(snapshot.history.series[0].observations[1].value, null);
  const before = tree(store), repeat = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(repeat.status, 0, repeat.stderr); assert.deepEqual(tree(store), before);
});

test('CLI refuses dotted symbol aliases before reading sources and never rewrites them', t => {
  const store = temporary(t);
  const args = [fileURLToPath(new URL('./export-market-history.mjs', import.meta.url)), '--as-of', '2026-10-09', '--symbols', 'BRK.B',
    '--store', store, '--seed', join(store, 'absent-seed.json.gz'), '--mapping', join(store, 'absent-mapping.json')];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Symbols must be distinct explicit US symbol names/);
  assert.doesNotMatch(result.stderr, /ENOENT/);
  assert.deepEqual(tree(store), {});
});
