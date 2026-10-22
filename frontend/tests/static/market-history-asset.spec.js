import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { institutionalSourceFixture } from '../../tools/fixtures/market-history-source.mjs';
import { observation, payload, series } from '../../tools/fixtures/market-history.mjs';

// Synthetic seed bytes pass through the actual offline CLI, immutable store and
// manifest attachment. Nothing is fetched from SEC/OpenFIGI or published.
const frontend = fileURLToPath(new URL('../../', import.meta.url));
const date = '2026-10-09';
let directory, bundle, manifest, reference, snapshotBytes;
test.beforeAll(() => {
  const fixture = institutionalSourceFixture();
  fixture.seed.securities['000000002'] = { name: 'Synthetic BBB', class: 'COM', observations: [
    { ...fixture.seed.securities['000000001'].observations[0], manager_count: 20 },
    { ...fixture.seed.securities['000000001'].observations[1], manager_count: null },
  ] };
  fixture.mapping['000000002'] = { symbol: 'BBB', source: 'OpenFIGI', retrieved_at: '2026-09-29T01:02:03.654321+00:00' };
  directory = mkdtempSync(join(tmpdir(), 'synthetic-market-history-asset-'));
  bundle = join(directory, 'bundle'); mkdirSync(bundle);
  const seed = join(directory, 'sec13f.json.gz'), mapping = join(directory, 'openfigi.json');
  writeFileSync(seed, gzipSync(JSON.stringify(fixture.seed)));
  writeFileSync(mapping, JSON.stringify(fixture.mapping));
  writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ as_of_date: date, generated_at: '2026-10-10T01:00:00Z', default_market: 'US', supported_markets: ['US'],
    markets: { US: { as_of_date: date, pages: { breadth: { path: 'breadth.json' } }, assets: {} } } }));
  execFileSync(process.execPath, [join(frontend, 'tools/export-market-history.mjs'), '--as-of', date, '--symbols', 'AAA,BBB',
    '--store', bundle, '--seed', seed, '--mapping', mapping, '--manifest', join(bundle, 'manifest.json')], { cwd: frontend, stdio: 'pipe' });
  manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8'));
  reference = manifest.markets.US.assets.market_indicator_history;
  snapshotBytes = readFileSync(join(bundle, reference.path));
  expect(createHash('sha256').update(snapshotBytes).digest('hex')).toBe(reference.sha256);
  expect(JSON.parse(snapshotBytes).provenance.selection.admitted_symbols).toEqual(['AAA', 'BBB']);
});
test.afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

for (const width of [1440, 375]) test(`offline market-history CLI through saved asset and selected security at ${width}px`, async ({ page }, info) => {
  test.setTimeout(90000);
  const errors = [], external = [], requests = [];
  let failure = null;
  await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const wrongDateBytes = Buffer.from(JSON.stringify({ ...JSON.parse(snapshotBytes), as_of_date: '2026-10-08' }));
  const wrongDateHash = createHash('sha256').update(wrongDateBytes).digest('hex');
  await page.route('**/static-data/**', route => {
    const name = new URL(route.request().url()).pathname.split('/static-data/')[1];
    requests.push(name);
    if (name === 'manifest.json') {
      if (failure !== 'wrong-date') return route.fulfill({ contentType: 'application/json', body: readFileSync(join(bundle, 'manifest.json')) });
      const changed = structuredClone(manifest);
      changed.markets.US.assets.market_indicator_history = { ...reference, path: `market-history/snapshots/${wrongDateHash}.json`, sha256: wrongDateHash };
      return route.fulfill({ json: changed });
    }
    if (name === 'breadth.json') return route.fulfill({ json: { payload: { current: { date, stocks_up_4pct: 5, stocks_down_4pct: 4 }, chart_data: [],
      market_indicator_history: payload(series('new_highs', { observations: [observation(777)] })) } } });
    if (name === reference.path) return route.fulfill({ contentType: 'application/json', body: failure === 'hash' ? Buffer.concat([snapshotBytes, Buffer.from('\n')]) : readFileSync(join(bundle, reference.path)) });
    if (name === `market-history/snapshots/${wrongDateHash}.json`) return route.fulfill({ contentType: 'application/json', body: wrongDateBytes });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/#/breadth');
  await page.getByText('市場指標の履歴と未取得項目', { exact: true }).click();
  const region = page.getByRole('region', { name: '市場指標の履歴', exact: true });
  const selector = region.getByRole('combobox', { name: '銘柄別履歴の対象銘柄' });
  await expect(selector).toHaveValue('AAA');
  await expect(region.getByText(/SEC 取得日時.*2026-09-28T13:52:04.064624\+00:00/)).toContainText('2026-08-31');
  await expect(region.getByText(/銘柄対応表 OpenFIGI 取得日時/)).toContainText('2026-09-28T14:05:00.123456+00:00');
  await expect(region.getByText(/保存履歴の分析基準日/)).toContainText('取得日ではありません');
  await expect(region.getByText(/各観測の取得日時は/)).toContainText('両者の遅い方');
  const quarterly = region.getByRole('region', { name: '機関保有者数', exact: true });
  await expect(quarterly).toContainText('前四半期比 2');
  await expect(quarterly).toContainText('2026-09-28T14:05:00.123Z');
  await expect(quarterly).toContainText('市場全体・全保有者の完全集計ではありません');
  await expect(quarterly).toContainText('最新の記録も分析基準日より前');
  await expect(region.getByRole(width === 375 ? 'list' : 'table', { name: '13F 報告運用会社数の履歴', exact: true })).toHaveCount(1);
  await expect(region.getByText('777', { exact: true })).toHaveCount(0);
  await expect(region.getByText(/新高値：比較可能な履歴は未取得/)).toBeVisible();
  const measurements = [];
  for (const theme of ['dark', 'light']) {
    const switchName = theme === 'light' ? 'ライトモードに切り替え' : 'ダークモードに切り替え';
    if (await page.getByRole('button', { name: switchName, exact: true }).count()) await page.getByRole('button', { name: switchName, exact: true }).click();
    await selector.selectOption('AAA');
    await selector.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`saved-history-${width}-${theme}-selector.png`) });
    await selector.selectOption('BBB');
    await expect(quarterly).toContainText('最新対象日 2026-06-30：未確認');
    await expect(quarterly).toContainText('前四半期比 未確認');
    await expect(region.getByText(/銘柄対応表 OpenFIGI 取得日時/)).toContainText('2026-09-29T01:02:03.654321+00:00');
    const records = region.getByRole(width === 375 ? 'list' : 'table', { name: '13F 報告運用会社数の履歴', exact: true });
    await expect(records).toContainText('2026-09-29T01:02:03.654Z');
    await expect(records.getByText('20', { exact: true })).toBeVisible();
    await expect(records.getByText('0', { exact: true })).toHaveCount(0);
    await records.scrollIntoViewIfNeeded();
    const geometry = await region.locator('select, dd, td, th').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { text: element.textContent, left: rect.left, right: rect.right, client: element.clientWidth, scroll: element.scrollWidth };
    }));
    for (const box of geometry) { expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width); expect(box.scroll).toBeLessThanOrEqual(box.client + 1); }
    measurements.push({ theme, geometry });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`saved-history-${width}-${theme}-unknown.png`) });
  }
  for (const reason of ['wrong-date', 'hash']) {
    failure = reason;
    await page.reload();
    await page.getByText('市場指標の履歴と未取得項目', { exact: true }).click();
    await expect(page.getByText(/保存履歴の読み込みまたは整合性確認に失敗/)).toBeVisible();
    await expect(region.getByRole('combobox')).toHaveCount(0);
    await expect(region.getByRole('table')).toHaveCount(0);
    await expect(region.getByRole('list')).toHaveCount(0);
    await expect(region.getByText('777', { exact: true })).toHaveCount(0);
    await expect(region.getByText(/比較可能な履歴は未取得です/)).toHaveCount(9);
  }
  failure = null;
  await page.getByRole('button', { name: 'データを再確認 ↻', exact: true }).click();
  await expect(selector).toHaveValue('AAA');
  await expect(quarterly).toContainText('前四半期比 2');
  await expect(region.getByText('777', { exact: true })).toHaveCount(0);
  expect(requests).toContain(reference.path);
  expect(errors).toEqual([]);
  expect(external.filter(url => new URL(url).hostname !== 'fonts.googleapis.com')).toEqual([]);
  await info.attach('synthetic-cli-provenance', { body: JSON.stringify({ source: 'institutionalSourceFixture → actual local CLI → immutable store → manifest → browser',
    syntheticOnly: true, publicationAuthority: 'none', reference, blockedExternalRequests: external.length, unexpectedExternalRequests: 0, measurements }), contentType: 'application/json' });
  await info.attach('saved-synthetic-snapshot', { body: snapshotBytes, contentType: 'application/json' });
});
