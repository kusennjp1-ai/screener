import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';

const date = '2026-09-29';
const rows = ['EDGE', 'LONGTICKER12', 'WAIT'].map((symbol, index) => withAuditFixture({
  symbol, company_name: 'Synthetic company with a deliberately long display name',
  market: 'US', currency: 'USD', current_price: index === 2 ? 99 : 104,
  se_pivot_price: 100, adv_usd: 5e7, rs_rating: 95, composite_rating: 95, eps_rating: 90, ibd_group_rank: 10,
  market_regime: 'confirmed_uptrend', market_above_50dma: true, market_above_200dma: true,
}, date));

for (const width of [1440, 1024, 320]) test(`readiness guidance, disclosures and source warning at ${width}px`, async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/static-data/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const payload = name === 'manifest.json'
      ? { generated_at: `${date}T23:00:00Z`, research_generation: 'guidance-fixture', as_of_date: date,
        default_market: 'US', supported_markets: ['US'], markets: { US: { as_of_date: date, assets: { research: { path: 'research.json' } } } } }
      : name === 'research.json' ? { as_of_date: date, rows } : {};
    return route.fulfill({ json: payload });
  });
  await page.goto('/');
  const candidate = page.getByRole('button', { name: /^EDGE の分析を表示/ });
  await expect(candidate).toBeVisible();
  await expect(candidate).toHaveAccessibleName(/日次確認 [0-9]+\/7。.*最新の取引日：未確認/);
  const glossary = page.locator('.candidate-glossary');
  await glossary.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(glossary).toHaveAttribute('open', '');
  await expect(glossary.getByText('選定条件と日次確認', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`guidance-${width}-expanded.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await glossary.locator('summary').press('Enter');
  await expect(glossary).not.toHaveAttribute('open', '');
  await candidate.click();
  await expect(page.locator('.research-symbol-head .entry-source-badge')).toBeInViewport({ ratio: 1 });
  const entry = page.getByRole('region', { name: 'エントリー条件', exact: true });
  await expect(entry.getByText('△ 書籍の追随目安外', { exact: true })).toBeVisible();
  await entry.locator('summary').filter({ hasText: 'アプリ設定と書籍の確認範囲' }).press('Enter');
  await expect(entry).toContainText('5%はこの資料で裏付けられた書籍指定ではありません');
  await entry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`source-warning-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('#root').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  if (width > 700) {
    await page.goto('/#/?symbol=EDGE');
    const detail=page.getByRole('region',{name:'銘柄詳細',exact:true});
    await expect(detail).toBeFocused();
    const gap=await detail.evaluate(node=>node.getBoundingClientRect().top-document.querySelector('.leader-header').getBoundingClientRect().bottom);
    expect(gap).toBeGreaterThanOrEqual(16);
    await expect(detail.locator('.entry-source-badge')).toBeInViewport({ratio:1});
    // The prior hero link can lie at the viewport boundary after this focus
    // jump. It must retain a full target and never collide with sticky nav.
    expect((await new AxeBuilder({ page }).include('#root').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  }
  expect(errors).toEqual([]);
});
