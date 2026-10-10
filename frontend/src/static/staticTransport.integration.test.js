import { bookAnnualPriceExpiry } from './bookAnnualEpsEvidence';
// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pack } from '../../tools/static-transport/pack.mjs';
import { withFinancialProof, FINANCIAL_TEST_DATE as date, FINANCIAL_TEST_NOW as now } from './testFinancialFixture';

const hash = value => createHash('sha256').update(value).digest('hex');
const chunkPath = 'markets/us/scan/chunks/chunk-0001.json';
const chartPath = 'markets/us/charts/SAFE.json';
const detailPath = 'research-details/SAFE-0123456789abcdef.json';
const row = withFinancialProof({ symbol: 'SAFE', eps_growth_yy: 0, sales_growth_yy: -12.123456789, current_price: 1 / 7, research_detail_path: detailPath, chart_path: chartPath });
const chunk = { as_of_date: date, rows: [row] };
const index = { as_of_date: date, initial_rows: [], chunks: [{ path: chunkPath, sha256: hash(JSON.stringify(chunk)) }] };
const generation = hash(JSON.stringify(index));
const indexPath = `research-index-${generation.slice(0, 16)}.json`;
const manifest = { research_generation: generation, generated_at: new Date(now).toISOString(), as_of_date: date, markets: { US: { as_of_date: date, assets: { research: { path: indexPath } } } } };
const chart = { symbol: 'SAFE', market: 'US', as_of_date: date, stock_data: row, fundamentals: row, bars: [{ date, close: 1 / 7, volume: 0 }], unknown: null };
let directory, output, report, fetcher, corrupt, changedRaw, publicationAPI, dataClient;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'static-reader-integration-'));
  const source = join(directory, 'source'); output = join(directory, 'packed');
  for (const [path, value] of Object.entries({ 'static-data/manifest.json': manifest, 'static-data/markets/us/home.json': { exact: 1 / 7, zero: 0, unknown: null }, [`static-data/${indexPath}`]: index, [`static-data/${chunkPath}`]: chunk, [`static-data/${chartPath}`]: chart, [`static-data/${detailPath}`]: row })) {
    await mkdir(dirname(join(source, path)), { recursive: true }); await writeFile(join(source, path), JSON.stringify(value));
  }
  const bindings = { manifestSha256: hash(JSON.stringify(manifest)), uiInventorySha256: '1'.repeat(64), financialGeneration: null, financialLineageSha256: null, sourceCommit: '2'.repeat(40), appCommit: '3'.repeat(40), candidateId: '4'.repeat(64) };
  report = await pack({ source, output, bindings });
  const transport = { schema_version: 'static-json-transport-publication-v1', root: report.expectedRoot, logical_data_inventory_sha256: hash(JSON.stringify(report.logicalInventory)), physical_inventory_sha256: hash(JSON.stringify(report.physicalInventory)), ui_sha: bindings.appCommit, ui_digest: bindings.uiInventorySha256 };
  await writeFile(join(output, 'publication.json'), JSON.stringify({ schema: 'static-json-transport-preview-v1', publication_authority: 'none', ui_sha: transport.ui_sha, ui_digest: transport.ui_digest, data_manifest_sha256: bindings.manifestSha256, transport }));
});
afterAll(async () => rm(directory, { recursive: true, force: true }));
beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal('location', { href: 'https://example.test/' }); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Worker', undefined); corrupt = false; changedRaw = false;
  fetcher = vi.fn(async url => {
    const path = new URL(url, location.href).pathname.replace(/^\//, '');
    try {
      const bytes = new Uint8Array(await readFile(join(output, path)));
      if (changedRaw && path === 'static-data/markets/us/home.json') return new Response(JSON.stringify({ exact: 99 }));
      if (corrupt && path.endsWith('.bin')) bytes[bytes.length - 10] ^= 1;
      return new Response(bytes);
    } catch (error) { if (error.code === 'ENOENT') return new Response('', { status: 404 }); throw error; }
  });
  vi.stubGlobal('fetch', fetcher);
  publicationAPI = await import('./staticPublication'); dataClient = await import('./dataClient');
});
afterEach(() => vi.unstubAllGlobals());
const pathsRead = () => fetcher.mock.calls.map(([url]) => new URL(url, location.href).pathname);
async function bootstrap() {
  const loaded = await dataClient.fetchStaticJson('manifest.json');
  return publicationAPI.publicationForManifest(loaded);
}
async function workerBundle(publication, evaluationNow = now) {
  const messages = []; vi.stubGlobal('self', { postMessage: message => messages.push(structuredClone(message)) });
  await import('./researchWorker');
  await self.onmessage({ data: { operation: 'research', path: indexPath, sha256: generation, publication, date, evaluation: { now: evaluationNow, generation, evaluationEpoch: 7 } } });
  const { createResearchReceiver } = await import('./researchWorkerPackets');
  const receive = createResearchReceiver(); let result, offset = 0;
  while (!result) {
    const message = messages[offset++];
    if (message.error) throw Error(message.error);
    result = receive(message.packet);
    if (!result) await self.onmessage({ data: { operation: 'next-packet' } });
  }
  return result;
}

it('reads all three actual packed cohorts losslessly before current-financial projection, loading only needed shards', async () => {
  const publication = await bootstrap(); expect(pathsRead()).toHaveLength(2);
  const { projectFinancialPayload } = await import('./financialCurrent');
  for (const [path, value] of [[chartPath, chart], [detailPath, row], [chunkPath, chunk]]) {
    expect(await dataClient.fetchStaticJson(path, { publication, now })).toEqual(projectFinancialPayload(value, { now }));
  }
  expect(pathsRead().filter(path => /\/root-/.test(path))).toHaveLength(1);
  expect(pathsRead().filter(path => /\/shard-/.test(path)).length).toBeLessThanOrEqual(3);
  expect(pathsRead().some(path => /\/(logical|physical)-/.test(path))).toBe(false);
  for (const path of [chartPath, detailPath, chunkPath]) expect(pathsRead()).not.toContain(`/static-data/${path}`);
  const decoded = await dataClient.fetchStaticJson(detailPath, { publication, now: now + 6 * 86400000 + 1 });
  expect(decoded.eps_growth_yy).toBeNull(); expect(decoded.sales_growth_yy).toBeNull(); expect(decoded.current_price).toBe(1 / 7);
});

it('prepares identical worker and no-Worker bundles from authenticated scan chunks, preserving deadlines and ACK identity', async () => {
  const publication = await bootstrap();
  const { loadResearchBundle } = await import('./researchWorkerClient');
  const fallback = await loadResearchBundle(indexPath, date, dataClient.fetchStaticJson, undefined, { publication, now, generation, evaluationEpoch: 7 });
  const worker = await workerBundle(publication);
  expect(worker).toEqual(fallback);
  expect(worker.rows[0]).toMatchObject({ symbol: 'SAFE', eps_growth_yy: 0, sales_growth_yy: -12.123456789, current_price: 1 / 7 });
  expect(worker.rankings.minervini[0].row).toBe(worker.rows[0]);
  expect(worker).toMatchObject({ generation, evaluation_epoch: 7, evaluated_at: now, next_expiry_at: Math.min(now + 6 * 86400000 + 1, bookAnnualPriceExpiry(date)) });
});

it('rejects corrupt encoded bytes in page, fallback and worker paths without retrying raw source assets', async () => {
  const publication = await bootstrap(); corrupt = true;
  await expect(dataClient.fetchStaticJson(chartPath, { publication, now })).rejects.toThrow(/SHA-256 mismatch/);
  const { loadResearchBundle } = await import('./researchWorkerClient');
  await expect(loadResearchBundle(indexPath, date, dataClient.fetchStaticJson, undefined, { publication, now, generation })).rejects.toThrow(/SHA-256 mismatch/);
  await expect(workerBundle(publication)).rejects.toThrow(/SHA-256 mismatch/);
  expect(pathsRead()).not.toContain(`/static-data/${chartPath}`); expect(pathsRead()).not.toContain(`/static-data/${chunkPath}`);
});

it('rejects a declared transport member missing from its authenticated shard instead of reading a same-named raw endpoint', async () => {
  const publication = await bootstrap();
  await expect(dataClient.fetchStaticJson('markets/us/charts/MISSING.json', { publication, now })).rejects.toThrow('Missing compressed logical path');
  expect(pathsRead()).not.toContain('/static-data/markets/us/charts/MISSING.json');
});

it('rejects changed raw identity bytes under an old pinned publication instead of mixing a newer CDN alias', async () => {
  const publication = await bootstrap();
  const original = { exact: 1 / 7, zero: 0, unknown: null };
  expect(await dataClient.fetchStaticJson('markets/us/home.json', { publication, now })).toEqual(original);
  expect(pathsRead().filter(path => /\/root-/.test(path))).toHaveLength(1);
  expect(pathsRead().filter(path => /\/shard-/.test(path))).toHaveLength(1);
  expect(pathsRead().some(path => /\/(logical|physical)-/.test(path))).toBe(false);
  changedRaw = true;
  await expect(dataClient.fetchStaticJson('markets/us/home.json', { publication, now })).rejects.toThrow(/(length|SHA-256) mismatch/);
  changedRaw = false;
  expect(await dataClient.fetchStaticJson('markets/us/home.json', { publication, now })).toEqual(original);
});
