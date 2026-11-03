// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { AUDIT_PREFIX, breakdown, fieldBreakdown, formatPacked, groupOf, isPackedDist, packedBreakdown, tarArchiveBytes, tarEntryBytes } from './site-size-breakdown.mjs';
import { pack } from './static-transport/pack.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tool = fileURLToPath(new URL('./site-size-breakdown.mjs', import.meta.url));
let root;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = null; });

async function put(base, path, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  await mkdir(dirname(join(base, path)), { recursive: true });
  await writeFile(join(base, path), bytes);
  return { bytes, sha256: sha(bytes) };
}

async function tree(base, directory = '') {
  const out = {};
  for (const entry of await readdir(join(base, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, await tree(base, path));
    else { const info = await lstat(join(base, path)); out[path] = `${info.size}:${info.mtimeMs}:${sha(await readFile(join(base, path)))}`; }
  }
  return out;
}

const bindings = manifestBytes => ({ manifestSha256: sha(manifestBytes), uiInventorySha256: 'a'.repeat(64), financialGeneration: null,
  financialLineageSha256: null, sourceCommit: 'b'.repeat(40), appCommit: 'c'.repeat(40), candidateId: 'd'.repeat(64) });

// A small final Pages tree built with the real codec: an outer transport plus
// the nested financial audit transport, with current and superseded exports.
async function packedFixture() {
  root = await mkdtemp(join(tmpdir(), 'site-packed-'));
  const logical = join(root, 'logical'), dist = join(root, 'dist'), scratch = join(root, 'audit-source');
  const data = path => `static-data/${path}`;
  const s = (path, value) => put(logical, data(path), value);
  const historyBytes = Buffer.from(JSON.stringify({ observations: Array.from({ length: 50 }, (_, i) => ({ i })) }));
  const historySha = sha(historyBytes);
  await s(`market-trends/history-source-${historySha}.json`, historyBytes);
  await s('market-history-source.json', historyBytes);
  await s(`market-trends/history-source-${sha('old history')}.json`, 'old history');
  const sourceBytes = Buffer.from('{"source":1}'), sourceSha = sha(sourceBytes);
  await s(`market-trends/source-${sourceSha}.json`, sourceBytes);
  const seriesBytes = Buffer.from(JSON.stringify({ schema_version: 'market-trends-v1', long_history: { source_sha256: historySha } })), seriesSha = sha(seriesBytes);
  await s(`market-trends/series-${seriesSha}.json`, seriesBytes);
  await s(`market-trends/series-${sha('old series')}.json`, 'old series');
  const catalogSnapshot = await s('candidate-history/2026-10-30-0123456789abcdef.json.gz', gzipSync('{"as_of":"2026-10-30"}'));
  const currentSnapshot = await s('candidate-history/2026-11-02-1111111111111111.json.gz', gzipSync('{"as_of":"2026-11-02","n":1}'));
  await s('candidate-history/2026-11-02-2222222222222222.json.gz', gzipSync('{"as_of":"2026-11-02","n":2}'));
  await s('candidate-history/index.json', { schema_version: 1, snapshots: [{ path: 'candidate-history/2026-10-30-0123456789abcdef.json.gz', sha256: catalogSnapshot.sha256, as_of: '2026-10-30' }] });
  // A completed cohort whose selection aged out of the catalog keeps its snapshot.
  const aged = await s('candidate-history/2026-04-01-3333333333333333.json.gz', gzipSync('{"as_of":"2026-04-01"}'));
  const archive = gzipSync(JSON.stringify({ schema_version: 1, cohort: { as_of: '2026-04-01', path: 'candidate-history/2026-04-01-3333333333333333.json.gz', sha256: aged.sha256 }, observations: [{}] }));
  const archivePath = `candidate-performance-history/2026-04-01-${aged.sha256.slice(0, 16)}-${sha(archive).slice(0, 16)}.json.gz`;
  await s(archivePath, archive);
  await s('candidate-performance-history/index.json', { schema_version: 1, cohorts: [{ as_of: '2026-04-01', cohort_sha256: aged.sha256, path: archivePath, sha256: sha(archive), observations: 1 }] });
  const workbench = await s('workbench-aaaaaaaaaaaaaaaa.json', { snapshot_id: 'x', current_snapshot: { path: 'candidate-history/2026-11-02-1111111111111111.json.gz', sha256: currentSnapshot.sha256, as_of: '2026-11-02' } });
  await s('workbench-bbbbbbbbbbbbbbbb.json', { snapshot_id: 'old' });
  const summary = await s('workbench-summary-cccccccccccccccc.json', { summary: 1 });
  await s('workbench-summary-dddddddddddddddd.json', { summary: 0 });
  const performance = await s('candidate-performance-eeeeeeeeeeeeeeee.json', { performance: 1 });
  await s('candidate-performance-ffffffffffffffff.json', { performance: 0 });
  await s('charts-index-0000000000000000.json', { symbols: [{ symbol: 'AAA', path: 'verified-charts/AAA-0123456789abcdef.json' }, { symbol: 'BBB', path: 'markets/us/charts/BBB.json' }] });
  const chart = symbol => ({ symbol, bars: Array.from({ length: 300 }, (_, i) => [i, i + 1, i + 2]) });
  for (const symbol of ['AAA', 'BBB', 'CCC']) await s(`markets/us/charts/${symbol}.json`, chart(symbol));
  await s('markets/us/charts/index.json', { symbols: [] });
  await s('markets/us/home.json', { top_groups: [] });
  await s('markets/us/scan/chunks/chunk-0001.json', { as_of_date: '2026-11-02', rows: [{ symbol: 'AAA', big: randomBytes(1000).toString('hex'), n: 1 }, { symbol: 'BBB', n: 2 }] });
  await s('verified-charts/AAA-0123456789abcdef.json', { symbol: 'AAA', bars: [[1, 2]], rs_line: [1] });
  await s(`verified-charts/${'L'.repeat(90)}-0123456789abcdef.json`, { symbol: 'LONG' });
  await s('research-details/AAA-0123456789abcdef.json', { symbol: 'AAA', detail: 'y'.repeat(500) });
  const manifest = await s('manifest.json', { markets: { US: { as_of_date: '2026-11-02', assets: {
    charts: { path: 'charts-index-0000000000000000.json' },
    workbench: { path: 'workbench-aaaaaaaaaaaaaaaa.json', sha256: workbench.sha256 },
    workbench_summary: { path: 'workbench-summary-cccccccccccccccc.json', sha256: summary.sha256 },
    candidate_performance: { path: 'candidate-performance-eeeeeeeeeeeeeeee.json', sha256: performance.sha256 },
    market_trends: { path: `market-trends/series-${seriesSha}.json`, sha256: seriesSha, source_path: `market-trends/source-${sourceSha}.json`, source_sha256: sourceSha },
  } } } });
  await put(logical, 'index.html', '<!doctype html>');
  await put(logical, 'assets/app.js', 'console.log(1)');
  await put(logical, 'qualification-audit.json', { results: [] });
  // Nested audit codec: compressed members under their internal names.
  const audit = {};
  for (const [kind, body] of [['source-projection', 'source'], ['source-base', 'base'], ['carry-projection', 'carry one'], ['carry-projection', 'carry two']]) {
    const bytes = Buffer.from(JSON.stringify({ kind, body, padding: body.repeat(200) })), hash = sha(bytes);
    await put(scratch, `static-data/research-details/${kind}-${hash}.json`, bytes);
    audit[kind === 'carry-projection' ? body : kind] = `static-data/financial-corrections/${kind}-${hash}.json`;
  }
  await put(scratch, 'static-data/manifest.json', manifest.bytes);
  const nested = await pack({ source: scratch, output: join(logical, AUDIT_PREFIX), bindings: bindings(manifest.bytes) });
  const receipts = {};
  for (const [name, mode, projection, at] of [['activation', 'activation', audit['source-projection'], '2026-10-06T00:00:00Z'], ['old', 'carry', audit['carry one'], '2026-10-23T00:00:00Z'], ['active', 'carry', audit['carry two'], '2026-11-03T00:00:00Z']]) {
    const bytes = Buffer.from(JSON.stringify({ mode, evaluated_at: at, financial_generation: sha(name), evaluation_projection: { path: projection } })), hash = sha(bytes);
    receipts[name] = `static-data/financial-corrections/release-${hash}.json`;
    await put(logical, receipts[name], bytes);
  }
  const outer = await pack({ source: logical, output: dist, bindings: bindings(manifest.bytes) });
  const files = Object.fromEntries([...Object.values(audit), ...Object.values(receipts)].map(path => [path, path.slice(-69, -5)]));
  await put(dist, 'publication.json', { transport: { root: outer.expectedRoot }, financial_audit_transport: { root: nested.expectedRoot },
    financial_audit_files: files, financial_release: { path: receipts.active, sha256: receipts.active.slice(-69, -5) } });
  return { dist, historySha, seriesSha, audit, receipts };
}

describe('site size breakdown', () => {
  it('groups static data three levels deep and other files two levels deep', () => {
    expect(groupOf('static-data/markets/us/charts/AAPL.json')).toBe('static-data/markets/us/');
    expect(groupOf('static-data/verified-charts/AAPL-1.json')).toBe('static-data/verified-charts/');
    expect(groupOf('assets/index.js')).toBe('assets/');
    expect(groupOf('qualification-audit.json')).toBe('qualification-audit.json');
  });

  it('counts packed charts as gzip and every other file at its raw size', async () => {
    root = await mkdtemp(join(tmpdir(), 'site-size-'));
    await mkdir(join(root, 'static-data/markets/us/charts'), { recursive: true });
    await mkdir(join(root, 'static-data/verified-charts'), { recursive: true });
    const repetitive = JSON.stringify({ bars: Array.from({ length: 2000 }, () => [1, 2, 3, 4, 5]) });
    await writeFile(join(root, 'static-data/markets/us/charts/AAA.json'), repetitive);
    await writeFile(join(root, 'static-data/verified-charts/AAA-1.json'), repetitive);
    const result = await breakdown(root);
    const packed = result.groups.find(group => group.group === 'static-data/markets/us/');
    const raw = result.groups.find(group => group.group === 'static-data/verified-charts/');
    expect(packed.packed).toBe(true);
    expect(packed.encoding).toBe('gzip');
    expect(packed.bytes).toBeLessThan(repetitive.length / 10);
    expect(raw.packed).toBe(false);
    expect(raw.encoding).toBe('raw');
    expect(raw.bytes).toBe(repetitive.length);
    expect(result.files).toBe(2);
    expect(result.groups[0]).toBe(raw);
  });

  it('labels a group by all of its files, not by the first one', async () => {
    root = await mkdtemp(join(tmpdir(), 'site-mixed-'));
    await put(root, 'static-data/markets/us/charts/AAA.json', { bars: [1] });
    await put(root, 'static-data/markets/us/home.json', { top_groups: [1] });
    const result = await breakdown(root);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ group: 'static-data/markets/us/', files: 2, packedFiles: 1, encoding: 'mixed', packed: false });
  });

  it('sums raw bytes per top-level field and skips files that are not JSON objects', async () => {
    root = await mkdtemp(join(tmpdir(), 'site-fields-'));
    await writeFile(join(root, 'A-1.json'), JSON.stringify({ bars: [1, 2, 3], symbol: 'A' }));
    await writeFile(join(root, 'B-1.json'), JSON.stringify({ bars: [4, 5, 6, 7], symbol: 'B' }));
    await writeFile(join(root, 'list.json'), '[1,2]');
    await writeFile(join(root, 'broken.json'), '{');
    const result = await fieldBreakdown(root);
    expect(result.files).toBe(2);
    expect(result.fields.map(field => field.key)).toEqual(['bars', 'symbol']);
    expect(result.fields[0].bytes).toBe('[1,2,3]'.length + '[4,5,6,7]'.length + 2 * ('bars'.length + 4));
  });

  it('models GNU tar headers, padding and LongLink names over 100 bytes', () => {
    expect(tarEntryBytes('./a', 0)).toBe(512);
    expect(tarEntryBytes('./a', 1)).toBe(1024);
    expect(tarEntryBytes('./a', 512)).toBe(1024);
    expect(tarEntryBytes(`./${'n'.repeat(98)}`, 10)).toBe(1024);
    expect(tarEntryBytes(`./${'n'.repeat(99)}`, 10)).toBe(2048);
    expect(tarArchiveBytes(512)).toBe(10240);
    expect(tarArchiveBytes(9216)).toBe(10240);
    expect(tarArchiveBytes(9217)).toBe(20480);
  });

  it('breaks a packed final tree down by logical family through both transport layers, without writing to it', async () => {
    const { dist, historySha, audit, receipts } = await packedFixture();
    const before = await tree(dist);
    expect(await isPackedDist(dist)).toBe(true);
    const result = await packedBreakdown(dist);
    expect(await tree(dist)).toEqual(before);
    expect(result.warnings).toEqual([]);
    const sizes = Object.values(before).map(value => Number(value.split(':')[0]));
    expect(result.files).toBe(sizes.length);
    expect(result.fileBytes).toBe(sizes.reduce((a, b) => a + b, 0));
    expect(result.fileHeadroom).toBe(1_000_000_000 - result.fileBytes);
    const family = name => result.families.find(row => row.family === name);
    const files = name => family(name)?.files;
    expect(files('static-data/workbench-*.json (referenced)')).toBe(1);
    expect(files('static-data/workbench-*.json (superseded)')).toBe(1);
    expect(files('static-data/workbench-summary-*.json (superseded)')).toBe(1);
    expect(files('static-data/candidate-performance-*.json (superseded)')).toBe(1);
    expect(files('static-data/market-trends/series-*.json (referenced)')).toBe(1);
    expect(files('static-data/market-trends/series-*.json (superseded)')).toBe(1);
    expect(files('static-data/market-trends/source-*.json (referenced)')).toBe(1);
    expect(files('static-data/market-trends/history-source-*.json (referenced)')).toBe(1);
    expect(files('static-data/market-trends/history-source-*.json (superseded)')).toBe(1);
    expect(files('static-data/candidate-history/ snapshots (in catalog)')).toBe(1);
    expect(files('static-data/candidate-history/ snapshots (current, not in catalog)')).toBe(1);
    expect(files('static-data/candidate-history/ snapshots (superseded)')).toBe(1);
    expect(files('static-data/candidate-history/ snapshots (performance lineage, not in catalog)')).toBe(1);
    expect(files('static-data/candidate-performance-history/')).toBe(2);
    expect(family('static-data/markets/us/charts/ (still indexed)')).toMatchObject({ files: 1, encoding: 'gzip' });
    expect(family('static-data/markets/us/charts/ (superseded by verified-charts)')).toMatchObject({ files: 1, encoding: 'gzip' });
    expect(files('static-data/markets/us/charts/ (not indexed)')).toBe(1);
    expect(family('static-data/markets/us/charts/ (still indexed)').decodedBytes).toBeGreaterThan(family('static-data/markets/us/charts/ (still indexed)').bytes);
    expect(family('static-data/markets/us/scan/chunks/')).toMatchObject({ files: 1, encoding: 'gzip' });
    expect(family('static-data/research-details/')).toMatchObject({ files: 1, encoding: 'gzip' });
    expect(family('static-data/markets/us/home.json')).toMatchObject({ files: 1, encoding: 'raw' });
    expect(family('static-data/financial-corrections/carry-projection (active)')).toMatchObject({ files: 1, encoding: 'gzip' });
    expect(family('static-data/financial-corrections/carry-projection (earlier generations)')).toMatchObject({ files: 1, encoding: 'gzip' });
    expect(family('static-data/financial-corrections/source-projection')).toMatchObject({ files: 1, encoding: 'gzip' });
    expect(family('static-data/financial-corrections/source-base')).toMatchObject({ files: 1, encoding: 'gzip' });
    expect(family('static-data/financial-corrections/release')).toMatchObject({ files: 3, encoding: 'raw' });
    expect(files('static-data/_transport/ shards (outer codec)')).toBe(256);
    expect(files(`${AUDIT_PREFIX}static-data/_transport/ shards (audit codec)`)).toBe(256);
    expect(files('static-data/_transport/ root (outer codec)')).toBe(1);
    expect(files(`${AUDIT_PREFIX} manifest copy (audit codec)`)).toBe(1);
    expect(files('publication.json')).toBe(1);
    expect(files('static-data/candidate-history/index.json')).toBe(1);
    expect(result.families.some(row => row.family.includes('not in either transport'))).toBe(false);
    expect(result.families.reduce((sum, row) => sum + row.files, 0)).toBe(result.files);
    expect(result.families.reduce((sum, row) => sum + row.bytes, 0)).toBe(result.fileBytes);
    expect(result.families.reduce((sum, row) => sum + row.tarBytes, 0)).toBe(result.tarBytes);
    expect(result.superseded.map(row => row.path).sort()).toEqual([
      'static-data/candidate-history/2026-11-02-2222222222222222.json.gz',
      'static-data/candidate-performance-ffffffffffffffff.json',
      `static-data/market-trends/history-source-${sha('old history')}.json`,
      `static-data/market-trends/series-${sha('old series')}.json`,
      'static-data/workbench-bbbbbbbbbbbbbbbb.json',
      'static-data/workbench-summary-dddddddddddddddd.json',
    ]);
    const duplicate = result.duplicates.find(group => group.paths.includes('static-data/market-history-source.json'));
    expect(duplicate.paths).toEqual(['static-data/market-history-source.json', `static-data/market-trends/history-source-${historySha}.json`]);
    expect(result.duplicates.some(group => group.paths.includes(`${AUDIT_PREFIX}static-data/manifest.json`) && group.paths.includes('static-data/manifest.json'))).toBe(true);
    expect(result.audit.map(row => [row.receipt, row.mode, row.active])).toEqual([[receipts.activation, 'activation', false], [receipts.old, 'carry', false], [receipts.active, 'carry', true]]);
    expect(result.audit[2].projectionBytes).toBe(family('static-data/financial-corrections/carry-projection (active)').bytes);
    expect(result.audit[2].projection).toBe(audit['carry two']);
    expect(result.scanChunks).toMatchObject({ chunks: 1, rows: 2 });
    expect(result.scanChunks.fields[0]).toMatchObject({ key: 'big', rows: 1, bytes: 2000 + 2 + 'big'.length + 4 });
    expect(result.scanChunks.fields.find(field => field.key === 'symbol').rows).toBe(2);
    expect(result.topFiles.length).toBeLessThanOrEqual(40);
    expect(result.topFiles.map(row => row.bytes)).toEqual([...result.topFiles.map(row => row.bytes)].sort((a, b) => b - a));
    const bin = result.topFiles.find(row => row.logical.includes('static-data/markets/us/scan/chunks/chunk-0001.json'));
    expect(bin.path).toMatch(/^static-data\/_transport\/gzip\/[a-f0-9]{64}\.bin$/);
    const lines = formatPacked(result, 60);
    expect(lines[0]).toMatch(/^Final Pages payload \(packed transport/);
    expect(lines.some(line => line.includes(`TAR bytes  ${result.tarBytes.toLocaleString('en-US')} of 1,000,000,000`))).toBe(true);
  });

  it('models the exact archive GNU tar writes for the same tree', async () => {
    const { dist } = await packedFixture();
    let version = '';
    try { version = execFileSync('tar', ['--version'], { encoding: 'utf8' }); } catch { /* no tar */ }
    if (!version.startsWith('tar (GNU tar)')) return;
    const archive = execFileSync('tar', ['--directory', dist, '--create', '--file=-', '--exclude=.git', '--exclude=.github', '--exclude=.[^/]*', '.'], { maxBuffer: 256 * 1024 * 1024 });
    const result = await packedBreakdown(dist);
    expect(result.tarBytes).toBe(archive.length);
  });

  it('fails closed when transport metadata named by the publication is missing', async () => {
    const { dist } = await packedFixture();
    const publication = JSON.parse(await readFile(join(dist, 'publication.json'), 'utf8'));
    await rm(join(dist, publication.transport.root.path));
    await expect(packedBreakdown(dist)).rejects.toThrow(/Missing referenced transport file/);
  });

  it('prints the packed report from the command line', async () => {
    const { dist } = await packedFixture();
    const output = execFileSync(process.execPath, [tool, dist, '60'], { encoding: 'utf8' });
    expect(output).toMatch(/^Final Pages payload \(packed transport/);
    expect(output).toMatch(/Superseded export files/);
    expect(output).toMatch(/Exact sha256 duplicates/);
    expect(output).toMatch(/Financial audit generations \(3 release receipts/);
    expect(output).toMatch(/Raw bytes per field in static-data\/verified-charts/);
  });

  it('prints a partial report with warnings and still exits 0, so the release does not call it unavailable', async () => {
    const { dist } = await packedFixture();
    await rm(join(dist, 'static-data/workbench-summary-cccccccccccccccc.json'));
    // execFileSync throws on any non-zero exit status.
    const output = execFileSync(process.execPath, [tool, dist, '60'], { encoding: 'utf8' });
    expect(output).toMatch(/^Final Pages payload \(packed transport/);
    expect(output).toMatch(/::warning::Export families left unclassified: Missing referenced export file: workbench-summary-cccccccccccccccc\.json/);
    expect(output).toMatch(/::warning::Transport names a file absent from the tree: static-data\/workbench-summary-cccccccccccccccc\.json/);
  });

  it('exits non-zero only when the breakdown itself fails', async () => {
    const { dist } = await packedFixture();
    await rm(join(dist, 'publication.json'));
    expect(() => execFileSync(process.execPath, [tool, dist, '60'], { encoding: 'utf8', stdio: 'pipe' })).toThrow(/publication\.json transport descriptor/);
  });
});
