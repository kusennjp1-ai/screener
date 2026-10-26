// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { exportMarketTrends } from './export-market-trends.mjs';
import { pack } from './static-transport/pack.mjs';
import { verify } from './static-transport/verify.mjs';
import { createStaticTransport } from '../src/static/transport/index.mjs';
import { readMarketTrends } from '../src/static/marketTrendAsset.js';
import { validatedRsRatingHistory } from '../src/static/rsRatingHistory.js';
import { RS_METHOD } from '../src/static/qualificationAudit.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const date = '2026-10-23';

it('preserves dated market sources and canonical RS observations through packing, independent restoration and the production reader', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'market-rs-transport-'));
  try {
    const source = join(directory, 'source'), root = join(source, 'static-data');
    const output = join(directory, 'packed'), restore = join(directory, 'restored');
    const write = async (path, value) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
    };
    const entry = { market: 'US', as_of_date: date, assets: {} };
    await exportMarketTrends({ root, entry, asOfDate: date });
    // A deliberately named synthetic rank fixture exercises transport, not the
    // ranking algorithm (whose independently dated universe tests live elsewhere).
    const history = { schema_version: 'published-universe-rs-history-v1', symbol: 'TRANSPORT_TEST', as_of_date: date,
      method: RS_METHOD, basis: 'current_verified_publication_universe_recalculated', source: 'verified_daily_ohlcv',
      current_universe_size: 101, sessions: ['2026-10-21', '2026-10-22', date], points: [
        { time: '2026-10-21', value: 49.125, universe_size: 100 },
        { time: date, value: 50.875, universe_size: 101 },
      ] };
    const chartBytes = JSON.stringify({ symbol: history.symbol, as_of_date: date, rs_rating_history: history });
    const chartPath = `verified-charts/TRANSPORT_TEST-${sha(chartBytes)}.json`;
    await write(join(root, chartPath), chartBytes);
    // The real release contains both compressed source charts and identity
    // canonical verified charts; the new history must survive both families.
    await write(join(root, 'markets/us/charts/TRANSPORT_TEST.json'), chartBytes);
    entry.assets.charts = { path: 'charts-index.json' };
    await write(join(root, 'charts-index.json'), { symbols: [{ symbol: history.symbol, path: chartPath }] });
    const manifest = JSON.stringify({ markets: { US: entry } });
    await write(join(root, 'manifest.json'), manifest);
    await write(join(source, 'index.html'), '<!doctype html><title>Non-authorizing transport test</title>');
    const bindings = { manifestSha256: sha(manifest), uiInventorySha256: '2'.repeat(64), financialGeneration: null,
      financialLineageSha256: null, sourceCommit: '3'.repeat(40), appCommit: '4'.repeat(40), candidateId: '5'.repeat(64) };
    const packed = await pack({ source, output, bindings });
    const checked = await verify({ packed: output, source, restore, expectedRoot: packed.expectedRoot });
    expect(checked.allOriginalBytesEqual).toBe(true);
    expect(checked.compressedFiles).toBe(1);
    const transport = await createStaticTransport({ baseURL: 'https://fixture.test/screener/', expectedRoot: packed.expectedRoot,
      fetchImpl: async url => {
        try { return new Response(await readFile(join(output, new URL(url).pathname.slice('/screener/'.length)))); }
        catch (error) { if (error.code === 'ENOENT') return new Response(null, { status: 404 }); throw error; }
      } });
    try {
      const fetchedManifest = await transport.readJson('static-data/manifest.json');
      expect(fetchedManifest.markets.US).toEqual(entry);
      const ref = entry.assets.market_trends;
      const rawBytes = await transport.readBytes(`static-data/${ref.source_path}`, { expectedDecodedSha256: ref.source_sha256 });
      expect(sha(rawBytes)).toBe(ref.source_sha256);
      expect(await readFile(join(restore, 'static-data', ref.source_path))).toEqual(Buffer.from(rawBytes));
      const marketBytes = await transport.readBytes(`static-data/${ref.path}`, { expectedDecodedSha256: ref.sha256 });
      const market = readMarketTrends(JSON.parse(new TextDecoder().decode(marketBytes)), entry);
      expect(market.indices.map(index => [index.symbol, index.latest.value])).toEqual([['^GSPC', 5], ['^IXIC', 3]]);
      expect(market.put_call.points).toHaveLength(63);
      const canonical = await transport.readJson(`static-data/${chartPath}`);
      const compressed = await transport.readJson('static-data/markets/us/charts/TRANSPORT_TEST.json');
      expect(canonical).toEqual(compressed);
      expect(validatedRsRatingHistory(canonical.rs_rating_history, history.symbol, date, 50.875)).toEqual(history);
      expect(canonical.rs_rating_history.points.map(point => point.time)).toEqual(['2026-10-21', date]);
      expect(await readFile(join(restore, 'static-data', chartPath), 'utf8')).toBe(chartBytes);
      // Both new market files remain identity assets, so no raw-URL assumption
      // is needed by the application or by a future source-restoration step.
      expect((await transport.lookup(`static-data/${ref.source_path}`)).kind).toBe('identity');
      expect((await transport.lookup(`static-data/${ref.path}`)).kind).toBe('identity');
      await writeFile(join(output, 'static-data', ref.path), Buffer.from('tampered'));
      await expect(transport.readBytes(`static-data/${ref.path}`)).rejects.toThrow();
    } finally { transport.dispose(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30000);
