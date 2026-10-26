import { test, expect } from '@playwright/test';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { withFinancialProof } from '../../src/static/testFinancialFixture.js';
import { nativeAnnualFixture } from '../../src/test/fixtures/nativeAnnual.js';

const date = '2026-10-02', now = Date.parse('2026-10-04T12:00:00Z');
function fixture(symbol, sales = 20) {
  const history = nativeAnnualFixture('CAD', [1, 1.2, 1.5, 2]);
  history.symbol = history.annual_source.symbol = symbol;
  return withFinancialProof(withAuditFixture({ symbol, company_name: 'Synthetic diagnostic fixture', market: 'US',
    current_price: 104, se_pivot_price: 100, adv_usd: 5e7, rs_rating: 95,
    market_above_50dma: true, market_above_200dma: true, sales_growth_yy: sales, financial_history: history }, date), now, date);
}
const rows = [fixture('ANNUAL'), fixture('BOUNDARY', 25), fixture('SALES', 30), fixture('MISSING'), fixture('FUTURE'), fixture('QUARANTINE')];
delete rows[3].financial_history.annual_source;
rows[4].financial_history.annual_source.observed_at = rows[4].financial_history.retrieved_at = '2026-10-05T11:00:00Z';
rows[5].financial_history.status = 'quarantined';

for (const width of [1440, 375]) for (const theme of ['dark', 'light']) test(`synthetic O’Neil source diagnostics at ${width}px ${theme}`, async ({ page }, info) => {
  test.setTimeout(120000);
  const errors = [], external = [], geometry = [];
  await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
  await page.clock.setFixedTime(new Date(now));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.route('**/static-data/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const json = name === 'manifest.json' ? { as_of_date: date, generated_at: '2026-10-04T11:30:00Z', research_generation: 'synthetic-oneil-diagnostics', assets: { research: { path: 'research.json' } } }
      : name === 'research.json' ? { as_of_date: date, rows } : {};
    return route.fulfill({ json });
  });
  const inspect = async (locator, stage) => {
    await locator.evaluate(element => element.scrollIntoView({ block: 'start' }));
    const boxes = await locator.locator('p, dd, h4, h5, li').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, client: element.clientWidth, scroll: element.scrollWidth };
    }));
    for (const box of boxes) { expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width); expect(box.scroll).toBeLessThanOrEqual(box.client + 1); }
    geometry.push({ stage, boxes });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`oneil-${width}-${theme}-${stage}.png`) });
  };
  for (const [index, row] of rows.entries()) {
    await page.goto(`/#/?method=oneil&symbol=${row.symbol}`);
    const detail = page.getByRole('region', { name: '銘柄詳細', exact: true });
    await expect(detail.getByRole('heading', { name: row.symbol, exact: true })).toBeVisible();
    if (index === 0 && theme === 'light') await page.getByRole('button', { name: 'ライトモードに切り替え', exact: true }).click();
    if (width === 375) await detail.getByRole('tab', { name: '判定根拠', exact: true }).click();
    const selection = await detail.getByRole('heading', { name: /^選定 / }).innerText();
    await detail.getByRole('tab', { name: '財務・機関', exact: true }).click();
    const panel = detail.getByRole('region', { name: '財務の判定根拠', exact: true });
    const strictRows = await panel.locator('.financial-evidence-rows').innerText();
    const requiredCount = await panel.locator('header > p').innerText();
    const disclosure = panel.getByText('原典との比較（診断のみ）', { exact: true }).locator('..');
    await disclosure.locator('summary').click();
    await expect(disclosure).toContainText('選定・順位・購入判定には使いません');
    await expect(disclosure).toContainText('PDFの先頭を1');
    const annual = disclosure.getByRole('region', { name: '原典の年次EPS条件', exact: true });
    const sales = disclosure.getByRole('region', { name: '原典の売上条件', exact: true });
    if (index < 3) {
      await expect(annual).toHaveAttribute('data-state', 'pass');
      await expect(annual).toContainText('25.99%');
      await expect(annual).toContainText('2026-10-04T11:00:00.000Z');
      await expect(annual).toContainText('CAD / 提供元の株式単位');
      await expect(annual).toContainText('分析日当時の公表確認ではありません');
      await expect(disclosure.getByRole('region', { name: '年次EPSの原典比較', exact: true }).getByRole('region', { name: '現行アプリ', exact: true })).toHaveAttribute('data-state', 'fail');
    } else {
      await expect(annual).toHaveAttribute('data-state', 'unknown');
      await expect(annual).toContainText('3年CAGR：未確認');
      await expect(annual).not.toContainText('25.99%');
      await expect(annual).not.toContainText('3年CAGR：0.00%');
      await expect(annual).toContainText(index === 4 ? '評価時刻より後' : '確認できません');
    }
    await expect(sales.getByText(/3四半期のYoY加速：/)).toHaveAttribute('data-state', 'unknown');
    await expect(sales).toContainText('直近3四半期の売上YoYを確認できません');
    await expect(sales).toHaveAttribute('data-state', index === 2 ? 'pass' : 'unknown');
    await expect(sales.getByText(/最新YoY：/)).toHaveAttribute('data-state', index === 1 ? 'unknown' : index === 2 ? 'pass' : 'fail');
    if (index === 1) await expect(sales).toContainText('丸め前が25%未満かを区別できない');
    expect(await panel.locator('.financial-evidence-rows').innerText()).toBe(strictRows);
    expect(await panel.locator('header > p').innerText()).toBe(requiredCount);
    if (index === 0) { await inspect(disclosure, 'scope'); await inspect(disclosure.getByRole('region', { name: '年次EPSの原典比較', exact: true }), 'annual'); await inspect(disclosure.getByRole('region', { name: '売上の原典比較', exact: true }), 'sales-unknown'); }
    else if (index === 1 || index === 2) await inspect(disclosure.getByRole('region', { name: '売上の原典比較', exact: true }), row.symbol.toLowerCase());
    else await inspect(disclosure.getByRole('region', { name: '年次EPSの原典比較', exact: true }), row.symbol.toLowerCase());
    await detail.getByRole('tab', { name: '判定根拠', exact: true }).click();
    expect(await detail.getByRole('heading', { name: /^選定 / }).innerText()).toBe(selection);
  }
  expect(errors).toEqual([]);
  expect(external.filter(url => new URL(url).hostname !== 'fonts.googleapis.com')).toEqual([]);
  await expect(page.locator('a[href*="drive.google"]')).toHaveCount(0);
  await info.attach('diagnostic-only-evidence', { body: JSON.stringify({ syntheticOnly: true, fixedClock: new Date(now).toISOString(),
    unchangedSelection: true, unchangedFinancialRules: true, certifiedThreeQuarterSalesContract: false, blockedExternalRequests: external.length, geometry }), contentType: 'application/json' });
});
