import { openResearchList } from './research-navigation.js';
import { test, expect } from '@playwright/test';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';

// Local synthetic responses only; no holdings provider or financial capture.
const date = '2026-10-09';
const fixture = managerCount => withAuditFixture({
  symbol: 'SYNTH', company_name: 'Synthetic holder-history fixture', market: 'US',
  current_price: 104, se_pivot_price: 100, adv_usd: 5e7, rs_rating: 95,
  chart_path: 'SYNTH.json',
  institutional_evidence: {
    symbol: 'SYNTH', status: 'available', unit: '13f_reporting_manager_cik',
    publication_cutoff: '2026-08-31', retrieved_at: '2026-10-10T01:00:00Z',
    scope: 'Synthetic reporting managers only',
    observations: [
      { period: '2026-03-31', manager_count: 100, filing_date_first: '2026-04-10', filing_date_last: '2026-05-15' },
      { period: '2026-06-30', manager_count: managerCount, filing_date_first: '2026-07-10', filing_date_last: '2026-08-15' },
    ],
  },
}, date);

for (const width of [1440, 375]) test(`institutional holder missing counts and real unchanged delta at ${width}px`, async ({ page }, info) => {
  const errors = [], external = [];
  let count = null;
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
  await page.route('**/static-data/**', route => {
    const file = new URL(route.request().url()).pathname.split('/').pop();
    const row = fixture(count);
    const json = file === 'manifest.json'
      ? { as_of_date: date, generated_at: '2026-10-10T01:00:00Z', research_generation: 'synthetic-institutional-history', assets: { research: { path: 'research.json' } } }
      : file === 'research.json' ? { as_of_date: date, rows: [row] }
        : { symbol: row.symbol, as_of_date: date, bars: [], rs_line: [], stock_data: row };
    return route.fulfill({ json });
  });
  const open = async () => {
    await page.goto('/'); await openResearchList(page);
    await expect(page.locator('.candidate-row').first()).toBeVisible();
    if (width === 375) await page.getByRole('button', { name: /^SYNTH の分析を表示/ }).click();
    const detail = page.getByRole('region', { name: '銘柄詳細', exact: true });
    await detail.getByRole('tab', { name: '財務・機関', exact: true }).click();
    const region=detail.getByRole('region', { name: '機関投資家の保有履歴', exact: true });
    await expect(region.locator('details')).not.toHaveAttribute('open');
    await region.locator('summary').click();
    return region;
  };
  for (const value of [null, '', '0', 0, 100]) {
    count = value;
    await page.goto('about:blank');
    const region = await open();
    const cells = region.locator('tbody tr').last().locator('td');
    await expect(cells.nth(1)).toHaveText(value === 100 ? '100社' : '未確認');
    await expect(region).toContainText(value === 100 ? '前期比 0社' : '前期比 未確認');
    await expect(region).toContainText('四半期');
    await expect(region).toContainText('購入者数');
    if (value === null || value === 100) for (const theme of ['dark', 'light']) {
      const switchName = theme === 'light' ? 'ライトモードに切り替え' : 'ダークモードに切り替え';
      if (await page.getByRole('button', { name: switchName, exact: true }).count()) await page.getByRole('button', { name: switchName, exact: true }).click();
      await region.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`holders-${width}-${theme}-${value === null ? 'missing' : 'unchanged'}.png`) });
    }
  }
  expect(errors).toEqual([]);
  expect(external.filter(url => new URL(url).hostname !== 'fonts.googleapis.com')).toEqual([]);
  await info.attach('network-isolation', { body: JSON.stringify({ blockedFontRequests: external.length, unexpectedExternalRequests: 0 }), contentType: 'application/json' });
});

for (const width of [1440, 375]) test(`malformed 13F observations reach detail as unknown at ${width}px`, async ({ page }, info) => {
  test.setTimeout(90000);
  const errors = [], external = [];
  const valid = fixture(110).institutional_evidence.observations;
  let observations;
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
  await page.route('**/static-data/**', route => {
    const file = new URL(route.request().url()).pathname.split('/').pop();
    const row = fixture(110);
    row.institutional_evidence.observations = observations;
    row.institutional_sponsors_increasing = true; // An untrusted cached pass must not rescue the evidence.
    const json = file === 'manifest.json'
      ? { as_of_date: date, generated_at: '2026-10-10T01:00:00Z', research_generation: 'synthetic-broken-holders', assets: { research: { path: 'research.json' } } }
      : file === 'research.json' ? { as_of_date: date, rows: [row] }
        : { symbol: row.symbol, as_of_date: date, bars: [], rs_line: [], stock_data: row };
    return route.fulfill({ json });
  });
  const cases = [
    ['null-first', [null, valid[1]]], ['null-last', [valid[0], null]],
    ['nonobject', [42, valid[1]]], ['array-object', [[], valid[1]]], ['container-object', {}],
    ['duplicate', [valid[0], { ...valid[0] }]], ['reverse', [valid[1], valid[0]]],
    ['non-quarter-end', [{ ...valid[0], period: '2026-03-30' }, { ...valid[1], period: '2026-06-29' }]],
  ];
  for (const [name, input] of cases) {
    observations = input;
    await page.goto('about:blank');
    await page.goto('/'); await openResearchList(page);
    await expect(page.locator('.candidate-row').first()).toBeVisible();
    if (width === 375) await page.getByRole('button', { name: /^SYNTH の分析を表示/ }).click();
    const detail = page.getByRole('region', { name: '銘柄詳細', exact: true });
    await detail.getByRole('tab', { name: '財務・機関', exact: true }).click();
    const region = detail.getByRole('region', { name: '機関投資家の保有履歴', exact: true });
    await region.locator('summary').click();
    await expect(region).toContainText('比較可能な保有機関数の履歴が未取得');
    await expect(region).toContainText('前期比 未確認');
    if (name === 'null-first') {
      await expect(region.locator('tbody tr').first().locator('td').nth(1)).toHaveText('未確認');
    }
    if (name === 'non-quarter-end') {
      const rows = region.locator('tbody tr');
      await expect(rows.first().locator('td').nth(0)).toHaveText('2026-03-30');
      await expect(rows.first().locator('td').nth(1)).toHaveText('100社');
      await expect(rows.last().locator('td').nth(0)).toHaveText('2026-06-29');
      await expect(rows.last().locator('td').nth(1)).toHaveText('110社');
      await expect(region).not.toContainText('前期比 +10社');
    }
    if (name === 'null-first' || name === 'non-quarter-end') {
      for (const theme of ['dark', 'light']) {
        const switchName = theme === 'light' ? 'ライトモードに切り替え' : 'ダークモードに切り替え';
        if (await page.getByRole('button', { name: switchName, exact: true }).count()) await page.getByRole('button', { name: switchName, exact: true }).click();
        await region.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const stage = name === 'non-quarter-end' ? '-non-quarter-end' : '';
        await page.screenshot({ path: info.outputPath(`malformed-holders-${width}-${theme}${stage}.png`) });
      }
    }
  }
  expect(errors).toEqual([]);
  expect(external.filter(url => new URL(url).hostname !== 'fonts.googleapis.com')).toEqual([]);
  await info.attach('synthetic-input-provenance', { body: JSON.stringify({ source: 'inline synthetic fixture', retainedFinancialData: false, blockedExternalRequests: external.length, unexpectedExternalRequests: 0 }), contentType: 'application/json' });
});
