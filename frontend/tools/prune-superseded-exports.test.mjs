// @vitest-environment node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { calendarAt } from '../src/static/testMarketCalendarFixture.js';
import { withAuditFixture } from '../src/static/testAuditFixture.js';
import { withFinancialProof, FINANCIAL_TEST_DATE as date, FINANCIAL_TEST_NOW as now } from '../src/static/testFinancialFixture.js';
import { planPrune, pruneSupersededExports } from './prune-superseded-exports.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tool = name => fileURLToPath(new URL(name, import.meta.url));
let root;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = null; });

async function put(base, path, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  await mkdir(dirname(join(base, path)), { recursive: true });
  await writeFile(join(base, path), bytes);
  return { bytes, sha256: sha(bytes) };
}

async function files(base, directory = '') {
  const out = [];
  for (const entry of await readdir(join(base, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await files(base, path)); else out.push(path);
  }
  return out.sort();
}

const AGED_SNAPSHOT = 'candidate-history/2026-04-01-4444444444444444.json.gz';

// One static-data root with a current and a superseded copy of every family.
async function staticData(base, { performance = true } = {}) {
  const s = (path, value) => put(base, path, value);
  const historyBytes = Buffer.from('{"history":1}'), historySha = sha(historyBytes);
  await s(`market-trends/history-source-${historySha}.json`, historyBytes);
  await s(`market-trends/history-source-${sha('old history')}.json`, 'old history');
  await s('market-history-source.json', historyBytes);
  const sourceBytes = Buffer.from('{"source":1}'), sourceSha = sha(sourceBytes);
  await s(`market-trends/source-${sourceSha}.json`, sourceBytes);
  await s(`market-trends/source-${sha('old source')}.json`, 'old source');
  await s('market-trend-source.json', sourceBytes);
  const seriesBytes = Buffer.from(JSON.stringify({ long_history: { source_sha256: historySha } })), seriesSha = sha(seriesBytes);
  await s(`market-trends/series-${seriesSha}.json`, seriesBytes);
  await s(`market-trends/series-${sha('old series')}.json`, 'old series');
  const catalog = await s('candidate-history/2026-10-01-0123456789abcdef.json.gz', gzipSync('{"as_of":"2026-10-01"}'));
  const current = await s('candidate-history/2026-10-02-1111111111111111.json.gz', gzipSync('{"as_of":"2026-10-02","n":1}'));
  await s('candidate-history/2026-10-02-2222222222222222.json.gz', gzipSync('{"as_of":"2026-10-02","n":2}'));
  await s('candidate-history/2026-09-30-3333333333333333.json.gz', gzipSync('{"as_of":"2026-09-30"}'));
  await s('candidate-history/index.json', { schema_version: 1, snapshots: [{ path: 'candidate-history/2026-10-01-0123456789abcdef.json.gz', sha256: catalog.sha256, as_of: '2026-10-01' }] });
  const workbench = await s('workbench-aaaaaaaaaaaaaaaa.json', { snapshot_id: 'x',
    current_snapshot: { path: 'candidate-history/2026-10-02-1111111111111111.json.gz', sha256: current.sha256, as_of: '2026-10-02' },
    // Named by a referenced document, though not in the catalog: kept.
    previous_ref: { path: 'candidate-history/2026-09-30-3333333333333333.json.gz' } });
  await s('workbench-bbbbbbbbbbbbbbbb.json', { snapshot_id: 'old' });
  const summary = await s('workbench-summary-cccccccccccccccc.json', { summary: 1 });
  await s('workbench-summary-dddddddddddddddd.json', { summary: 0 });
  const cp = await s('candidate-performance-eeeeeeeeeeeeeeee.json', { performance: 1 });
  await s('candidate-performance-ffffffffffffffff.json', { performance: 0 });
  // Unrelated hash-named files stay: other cleanups own them.
  await s('research-index-0000000000000000.json', {});
  // A completed performance cohort whose selection left the 126-session
  // catalog: only the cohort archive still names its snapshot (lineage).
  const aged = await s(AGED_SNAPSHOT, gzipSync('{"as_of":"2026-04-01"}'));
  const archive = gzipSync(JSON.stringify({ schema_version: 1, calculator_version: 'published-close-returns-v1',
    cohort: { as_of: '2026-04-01', path: AGED_SNAPSHOT, sha256: aged.sha256 }, observations: [{ symbol: 'AAA', horizon: 60 }] }));
  const archivePath = `candidate-performance-history/2026-04-01-${aged.sha256.slice(0, 16)}-${sha(archive).slice(0, 16)}.json.gz`;
  await s(archivePath, archive);
  await s('candidate-performance-history/index.json', { schema_version: 1, cohorts: [{ as_of: '2026-04-01', cohort_sha256: aged.sha256, path: archivePath, sha256: sha(archive), observations: 1 }] });
  await s('scan-list/chunk-0000000000000000.json', {});
  const assets = {
    workbench: { path: 'workbench-aaaaaaaaaaaaaaaa.json', sha256: workbench.sha256 },
    workbench_summary: { path: 'workbench-summary-cccccccccccccccc.json', sha256: summary.sha256 },
    market_trends: { path: `market-trends/series-${seriesSha}.json`, sha256: seriesSha, source_path: `market-trends/source-${sourceSha}.json`, source_sha256: sourceSha },
  };
  if (performance) assets.candidate_performance = { path: 'candidate-performance-eeeeeeeeeeeeeeee.json', sha256: cp.sha256 };
  await s('manifest.json', { markets: { US: { as_of_date: '2026-10-02', assets } } });
  return { historySha, sourceSha, seriesSha, archivePath };
}

const SUPERSEDED = [
  'candidate-history/2026-10-02-2222222222222222.json.gz',
  'candidate-performance-ffffffffffffffff.json',
  `market-trends/history-source-${sha('old history')}.json`,
  `market-trends/series-${sha('old series')}.json`,
  `market-trends/source-${sha('old source')}.json`,
  'workbench-bbbbbbbbbbbbbbbb.json',
  'workbench-summary-dddddddddddddddd.json',
];

describe('prune superseded exports', () => {
  it('removes only unreferenced files of the five export families', async () => {
    root = await mkdtemp(join(tmpdir(), 'prune-'));
    const data = join(root, 'static-data');
    await staticData(data);
    const before = await files(data);
    const [plan] = await pruneSupersededExports([data]);
    expect(plan.remove.map(item => item.path)).toEqual(SUPERSEDED);
    expect(plan.unchanged).toEqual([]);
    const after = await files(data);
    expect(after).toEqual(before.filter(path => !SUPERSEDED.includes(path)));
    for (const kept of ['market-history-source.json', 'market-trend-source.json', 'candidate-history/index.json', AGED_SNAPSHOT,
      'candidate-history/2026-09-30-3333333333333333.json.gz', 'candidate-history/2026-10-01-0123456789abcdef.json.gz',
      'candidate-history/2026-10-02-1111111111111111.json.gz', 'research-index-0000000000000000.json', 'scan-list/chunk-0000000000000000.json']) {
      expect(after).toContain(kept);
    }
    // A second run finds nothing more to remove.
    expect((await pruneSupersededExports([data]))[0].remove).toEqual([]);
  });

  it('keeps a snapshot that only a completed performance cohort names, and never reports it superseded', async () => {
    root = await mkdtemp(join(tmpdir(), 'prune-'));
    const data = join(root, 'static-data');
    await staticData(data);
    const plan = await planPrune(data);
    expect(plan.lineage).toEqual([AGED_SNAPSHOT]);
    expect(plan.keep.find(item => item.path === AGED_SNAPSHOT)).toMatchObject({ family: 'candidate_history', status: 'lineage' });
    expect(plan.remove.map(item => item.path)).not.toContain(AGED_SNAPSHOT);
    await pruneSupersededExports([data]);
    expect(await files(data)).toContain(AGED_SNAPSHOT);
  });

  it('accepts an aged-out cohort snapshot that the tree never restored', async () => {
    // Static Site restores only the catalog's snapshots, so an aged-out
    // cohort's selection is absent there; the release brings it from live.
    root = await mkdtemp(join(tmpdir(), 'prune-'));
    const data = join(root, 'static-data');
    await staticData(data);
    await rm(join(data, AGED_SNAPSHOT));
    const [plan] = await pruneSupersededExports([data]);
    expect(plan.lineage).toEqual([]);
    expect(plan.remove.map(item => item.path)).toEqual(SUPERSEDED);
  });

  it('leaves a family alone when the manifest references none of its files', async () => {
    root = await mkdtemp(join(tmpdir(), 'prune-'));
    const data = join(root, 'static-data');
    await staticData(data, { performance: false });
    const [plan] = await pruneSupersededExports([data]);
    expect(plan.unchanged).toEqual(['candidate_performance']);
    expect(await files(data)).toEqual(expect.arrayContaining(['candidate-performance-eeeeeeeeeeeeeeee.json', 'candidate-performance-ffffffffffffffff.json']));
  });

  it('removes nothing in a dry run', async () => {
    root = await mkdtemp(join(tmpdir(), 'prune-'));
    const data = join(root, 'static-data');
    await staticData(data);
    const before = await files(data);
    const [plan] = await pruneSupersededExports([data], { dryRun: true });
    expect(plan.remove).toHaveLength(SUPERSEDED.length);
    expect(await files(data)).toEqual(before);
  });

  it.each([
    ['the referenced summary is missing', data => rm(join(data, 'workbench-summary-cccccccccccccccc.json')), /Missing referenced export file: workbench-summary-cccccccccccccccc\.json/],
    ['the referenced workbench changed', data => writeFile(join(data, 'workbench-aaaaaaaaaaaaaaaa.json'), '{}'), /Referenced export changed: workbench-aaaaaaaaaaaaaaaa\.json/],
    ['the referenced long-history source is missing', async (data, refs) => rm(join(data, `market-trends/history-source-${refs.historySha}.json`)), /Missing referenced export file: market-trends\/history-source-/],
    ['the referenced trend source is missing', async (data, refs) => rm(join(data, `market-trends/source-${refs.sourceSha}.json`)), /Missing referenced export file: market-trends\/source-/],
    ['a catalog snapshot is missing', data => rm(join(data, 'candidate-history/2026-10-01-0123456789abcdef.json.gz')), /Missing referenced export file: candidate-history\/2026-10-01/],
    ['the current snapshot is missing', data => rm(join(data, 'candidate-history/2026-10-02-1111111111111111.json.gz')), /Missing referenced export file: candidate-history\/2026-10-02-1111/],
    ['the catalog is missing', data => rm(join(data, 'candidate-history/index.json')), /Missing candidate history catalog/],
    ['the manifest is missing', data => rm(join(data, 'manifest.json')), /Missing static-data manifest/],
    ['a performance archive is missing', async (data, refs) => rm(join(data, refs.archivePath)), /Missing referenced export file: candidate-performance-history\//],
    ['a performance archive changed', async (data, refs) => writeFile(join(data, refs.archivePath), gzipSync('{}')), /Referenced export changed: candidate-performance-history\//],
    ['a cohort lineage snapshot changed', data => writeFile(join(data, AGED_SNAPSHOT), gzipSync('{"as_of":"2026-04-01","n":9}')), /Referenced export changed: candidate-history\/2026-04-01/],
    ['performance archives lost their catalog', data => rm(join(data, 'candidate-performance-history/index.json')), /Performance archives exist without candidate-performance-history\/index\.json/],
  ])('fails closed before removing anything in any root when %s', async (_name, breakIt, message) => {
    root = await mkdtemp(join(tmpdir(), 'prune-'));
    const good = join(root, 'public/static-data'), bad = join(root, 'dist/static-data');
    await staticData(good);
    const refs = await staticData(bad);
    await breakIt(bad, refs);
    const before = [await files(good), await files(bad)];
    await expect(pruneSupersededExports([good, bad])).rejects.toThrow(message);
    expect([await files(good), await files(bad)]).toEqual(before);
  });

  it('rejects the same root twice and an export path that is not a regular file', async () => {
    root = await mkdtemp(join(tmpdir(), 'prune-'));
    const data = join(root, 'static-data');
    await staticData(data);
    await expect(pruneSupersededExports([data, `${data}/`])).rejects.toThrow(/Duplicate static-data root/);
    await mkdir(join(data, 'workbench-9999999999999999.json'));
    await expect(planPrune(data)).rejects.toThrow(/not a regular file: workbench-9999999999999999\.json/);
  });

  it('keeps the quality gate green after a real repeated export, on both public and dist', async () => {
    root = await mkdtemp(join(tmpdir(), 'prune-export-'));
    const frontend = join(root, 'frontend'), data = join(frontend, 'public/static-data'), dist = join(frontend, 'dist/static-data');
    await mkdir(data, { recursive: true }); await mkdir(join(root, 'data/ibd_reference/ibd50'), { recursive: true });
    const write = (name, value) => writeFile(join(data, name), JSON.stringify(value));
    const days = calendarAt(date).sessions.slice(-280);
    await write('trading-calendar.json', calendarAt(date));
    const bars = days.map((day, index) => { const close = 50 + index * .25; return { date: day, open: close, close, low: close - 1, high: close + 1, volume: 1e6 }; });
    const row = withFinancialProof(withAuditFixture({ symbol: 'TEST', market: 'US', currency: 'USD', current_price: bars.at(-1).close, adv_usd: 30e6, rs_rating: 90,
      eps_growth_yy: 30, sales_growth_yy: 30, se_pivot_price: null, vcp_pivot: null, se_setup_ready: false }, date), now, date);
    await write('manifest.json', { generated_at: '2026-10-02T20:00:00Z', markets: { US: { market: 'US', as_of_date: date, pages: { scan: { path: 'scan.json' } }, assets: { charts: { path: 'charts-index.json' } } } } });
    await write('scan.json', { as_of_date: date, initial_rows: [row], chunks: [{ path: 'chunk.json' }] });
    await write('chunk.json', { as_of_date: date, rows: [row] });
    await write('charts-index.json', { symbols: [{ symbol: row.symbol, path: 'chart.json' }] });
    await write('chart.json', { symbol: row.symbol, as_of_date: date, bars });
    await write('book-benchmark.json', { symbol: 'SPY', as_of_date: date, bars });
    await write('sector-prices.json', { as_of_date: date, series: {} });
    const run = (script, at = now, args = []) => execFileSync(process.execPath, [tool(script), ...args], { cwd: frontend,
      env: { ...process.env, FINANCIAL_EVALUATED_AT: new Date(at).toISOString() }, encoding: 'utf8', stdio: 'pipe' });
    // Static Site exports more than once per session. Each export replaces the
    // workbench, summary and performance files its input referenced
    // (superseded-export.mjs), but every run still leaves its candidate snapshot.
    run('./export-research.mjs', now - 2000); run('./record-candidate-history.mjs', now - 2000);
    run('./export-research.mjs', now - 1000);
    run('./export-research.mjs'); run('./record-candidate-history.mjs');
    const top = async () => (await files(data)).filter(path => /^(?:workbench|workbench-summary|candidate-performance)-[a-f0-9]{16}\.json$|^candidate-history\/.*\.gz$/.test(path));
    const before = await top();
    for (const name of ['workbench-', 'workbench-summary-', 'candidate-performance-']) {
      expect(before.filter(path => path.startsWith(name) && !path.slice(name.length).includes('-'))).toHaveLength(1);
    }
    expect(before.filter(path => path.startsWith('candidate-history/'))).toHaveLength(3);
    await cp(data, dist, { recursive: true });
    const output = run('./prune-superseded-exports.mjs', now, ['public/static-data', 'dist/static-data']);
    expect(output).toMatch(/Pruned 1 superseded export files .* from .*public\/static-data: candidate_history 1\n/);
    expect(output).toMatch(/Pruned 1 superseded export files .* from .*dist\/static-data: candidate_history 1\n/);
    const manifest = JSON.parse(await readFile(join(data, 'manifest.json'), 'utf8')), assets = manifest.markets.US.assets;
    const catalog = JSON.parse(await readFile(join(data, 'candidate-history/index.json'), 'utf8'));
    const workbench = JSON.parse(await readFile(join(data, assets.workbench.path), 'utf8'));
    expect(await top()).toEqual([...new Set([catalog.snapshots[0].path, workbench.current_snapshot.path, assets.workbench.path, assets.workbench_summary.path, assets.candidate_performance.path])].sort());
    expect(await files(dist)).toEqual(await files(data));
    const quality = run('./check-data-quality.mjs');
    expect(quality).toContain('Quality gate passed: 1/1 verified');
    expect(quality).toContain('Workbench gate passed: 1 saved observations');
  }, 120000);
});
