import { openResearchList } from './research-navigation.js';
import { test, expect } from '@playwright/test';
import { cases, rows, date, now } from '../../src/test/fixtures/annualConsistency.js';
import { assess } from '../../src/static/researchEngine.js';
import { encodeResearchIndex } from '../../src/static/researchTransport.js';

const generation = 'synthetic-financial-consistency', generatedAt = new Date(now).toISOString();
const bars = Array.from({ length: 280 }, (_, i) => ({ date: new Date(Date.parse(date) - (279 - i) * 86400000).toISOString().slice(0, 10),
  open: 100, high: 104, low: 98, close: 102, volume: 1e6 }));
const stateText = { pass: '✓ 通過', fail: '× 未達', unknown: '? 未確認' };
async function setup(page, width) {
  const errors = [], external = [], details = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.route('**/static-data/**', route => {
    const file = new URL(route.request().url()).pathname.split('/').pop();
    const row = rows.find(item => item.chart_path === file), detail = rows.find(item => item.research_detail_path === file);
    if (detail) details.push(detail.symbol);
    const data = file === 'manifest.json' ? { as_of_date: date, generated_at: generatedAt, research_generation: generation,
      default_market: 'US', supported_markets: ['US'], markets: { US: { as_of_date: date,
        assets: { research: { path: 'research.json' }, charts: { path: 'index.json' } }, pages: { scan: { path: 'scan.json', list_path: 'scan.json' } } } } }
      : file === 'research.json' ? encodeResearchIndex({ as_of_date: date, rows })
        : file === 'index.json' ? { as_of_date: date, symbols: rows.map(item => ({ symbol: item.symbol, path: item.chart_path })) }
          : file === 'scan.json' ? { as_of_date: date, rows_total: 1, initial_rows: rows.filter(item => item.symbol === 'CADENCE'),
            embedded_chart_paths: true, default_page_size: 50, default_filters: {}, sort: { field: 'rs_rating', order: 'desc' }, filter_options: {} }
            : detail || (row ? { symbol: row.symbol, as_of_date: date, generated_at: generatedAt, bars, stock_data: row, rs_line: [] } : {});
    return route.fulfill({ json: data });
  });
  return { errors, external, details };
}

for (const width of [375, 1440]) for (const item of cases.filter(item => item.symbol !== 'CADENCE')) {
  test(`annual ${item.symbol} list/detail/rules at ${width}px`, async ({ page }, info) => {
    const seen = await setup(page, width), row = rows.find(row => row.symbol === item.symbol);
    const assessment = assess(row, 'oneil', now);
    expect(assessment.rules.find(rule => /3年/.test(rule.label)).state).toBe(item.expected);
    await page.goto('/#/?method=oneil'); await openResearchList(page);
    const candidate = page.getByRole('button', { name: new RegExp(`^${item.symbol} の分析を表示`) });
    await expect(candidate).toHaveAttribute('aria-label', new RegExp(`選定 ${assessment.passed}/${assessment.total}`));
    const candidateBefore = await candidate.getAttribute('aria-label');
    await candidate.click();
    const detail = page.getByRole('region', { name: '銘柄詳細', exact: true });
    await detail.locator('#detail-tab-evidence').click();
    await expect(detail.getByRole('heading', { name: new RegExp(`^選定 ${assessment.passed}/${assessment.total}`) })).toBeVisible();
    const annualRule = detail.locator('.research-rules li').filter({ hasText: 'A：直近3年の各年 EPS 成長率' });
    await expect(annualRule).toContainText(stateText[item.expected]);
    await detail.getByRole('tab', { name: '財務・機関' }).click();
    const annual = detail.locator('#financial-evidence-annual_eps_growth_3y');
    await expect(annual).toHaveAttribute('data-state', item.expected);
    await expect.poll(() => seen.details).toContain(item.symbol);
    if (item.symbol === 'EXACT' || item.symbol === 'NATIVE') await expect(annual).toContainText('25% → 28.57% → 26.67%');
    if (item.symbol === 'BELOW') await expect(annual).toContainText('表示では25%に丸まりますが');
    if (item.annualCurrency || item.cellCurrency) await expect(annual).toContainText('通貨・出典・単位の整合性を確認できません');
    if (['ZERO', 'NEGATIVE'].includes(item.symbol)) await expect(annual).toContainText('ゼロ／赤字基準年');
    await annual.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`${item.symbol}-${width}.png`) });
    await info.attach('expected-and-rendered', { body: JSON.stringify({ input: row, expected: item.expected,
      candidate: candidateBefore, annual: await annual.innerText(), blockedExternalRequests: seen.external }, null, 2), contentType: 'application/json' });
    if (['EXACT', 'CELL'].includes(item.symbol)) {
      if (width === 375) await detail.getByRole('tab', { name: 'チャート', exact: true }).click();
      await detail.getByRole('button', { name: '日次チャートを分析' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('summary').filter({ hasText: '選定条件の詳細' }).click();
      const modalAnnual = dialog.getByRole('list', { name: '選定条件の判定内訳' }).locator('li').filter({ hasText: 'A：直近3年' });
      await expect(modalAnnual).toContainText(stateText[item.expected]);
      await page.keyboard.press('Escape');
    }
    if (width === 375) await page.getByRole('button', { name: '← 候補一覧', exact: true }).click();
    await expect(candidate).toHaveAttribute('aria-label', new RegExp(`選定 ${assessment.passed}/${assessment.total}`));
    expect(seen.errors).toEqual([]);
    expect(seen.external.filter(url => new URL(url).hostname !== 'fonts.googleapis.com')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const width of [375, 1440]) test(`QoQ table/filter labels and separate YoY decisions at ${width}px`, async ({ page }, info) => {
  const seen = await setup(page, width);
  await page.goto('/#/scan');
  await expect(page.getByRole('heading', { name: '詳細スキャン', exact: true })).toBeVisible();
  if (width === 375) await page.getByRole('button', { name: '全項目の表', exact: true }).click();
  for (const [key, label] of [['eps_growth_qq', 'EPS 前四半期比 (%)'], ['sales_growth_qq', '売上 前四半期比 (%)']]) {
    const header = page.locator(`th[data-column="${key}"]`);
    await header.scrollIntoViewIfNeeded(); await expect(header).toContainText(label);
    expect(await header.evaluate(cell => cell.scrollWidth <= cell.clientWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath(`scan-table-${width}.png`) });
  if (width === 375) await page.getByRole('button', { name: /条件・使い方/ }).click();
  else await page.getByRole('button', { name: '絞り込みを開く', exact: true }).click();
  await page.getByRole('button', { name: '財務を開く', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'EPS 前四半期比の下限', exact: true }).fill('25');
  await expect(page.getByText('EPS 前四半期比: ≥25%', { exact: true })).toBeVisible();
  await page.getByRole('spinbutton', { name: '売上 前四半期比の下限', exact: true }).fill('25');
  await expect(page.getByText('売上 前四半期比: ≥25%', { exact: true })).toBeVisible();
  await expect(page.getByText('EPS 前四半期比: ≥25%', { exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'EPS 前四半期比の下限', exact: true })).toHaveValue('25');
  await expect(page.getByRole('button', { name: 'CADENCE のチャートを開く', exact: true })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'EPS 前四半期比の下限', exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: info.outputPath(`scan-filters-${width}.png`) });
  await page.goto('/#/?method=oneil'); await openResearchList(page);
  await page.getByRole('button', { name: /^CADENCE の分析を表示/ }).click();
  const detail = page.getByRole('region', { name: '銘柄詳細', exact: true });
  await detail.getByRole('tab', { name: '財務・機関' }).click();
  for (const [id, value] of [['eps_growth_yy', '−10%'], ['sales_growth_yy', '−5%']]) {
    const metric = detail.locator(`#financial-evidence-${id}`);
    await expect(metric).toHaveAttribute('data-state', 'fail'); await expect(metric).toContainText(value);
    await expect(metric).toContainText('前年同期比');
  }
  await info.attach('blocked-external-requests', { body: JSON.stringify(seen.external), contentType: 'application/json' });
  expect(seen.errors).toEqual([]);
  expect(seen.external.filter(url => new URL(url).hostname !== 'fonts.googleapis.com')).toEqual([]);
});
