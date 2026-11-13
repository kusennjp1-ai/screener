// Renders of the market tab and Today in the fixture state closest to the live 11-12 publication (SYNTHETIC numbers and
// dates; only the verdict chain is set to the live one): the rows' backend regime 'correction' with SPY under its 50-day
// line and above its 200-day line (feature run 11-12), the published market_context (correction, SPY 6 distribution days,
// exposure_pct 20, no FTD), and the long history's ^GSPC under its 50-day line (as the SPY proxy reads on 11-12).
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { date, openBrief, sessions } from '/home/user/screener/.claude/worktrees/r3-market-audit/frontend/tests/static/brief-fixture.js';
import { indexState } from '/home/user/screener/.claude/worktrees/r3-market-audit/frontend/tools/export-market-trends.mjs';
const DD_METHOD = 'index-down-strictly-over-0.2-higher-volume-age25-high5-v1';
const OUT = '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit-market/inventory/render/shots';
const live = {
  rows: rows => { for (const row of rows) { row.market_above_50dma = false; row.market_above_200dma = true; row.market_regime = 'correction'; row.market_distribution_days = 6; row.market_exposure_pct = 20; row.market_ftd_date = null; row.market_ftd_days_since = null; } },
  manifest: value => { value.markets.US.market_context = { as_of_date: date, regime: 'correction', distribution_days: 6, ftd_date: null, ftd_days_since: null, exposure_pct: 20, guard: null, method: 'backend-market-regime-v1', source: 'scan-rows' }; },
  trends: value => {
    const sp = value.long_history.sp500, n = sp.length; sp.forEach((point, i) => { if (i >= n - 3) point.close = Math.round(point.close * 96) / 100; else if (i >= n - 200 && i < n - 50) point.close = Math.round(point.close * 90) / 100; });
    // What the live exporter writes on each index (brief-market-phone.spec.js withCloses): the method id, the closes and the position.
    for (const [i, item] of value.indices.entries()) {
      item.method = DD_METHOD;
      const days = item.points.map(point => point.date), m = days.length;
      item.closes = days.map((day, k) => ({ date: day, close: i === 0 ? sp.find(point => point.date === day).close : Math.round((16000 + k * 12 - (k > m - 30 ? (k - m + 30) * 45 : 0)) * 100) / 100 }));
      item.state = indexState(item.closes, item.points.at(-1).date);
    }
  },
};
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const desktop = { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };
const texts = {};
const settle = async page => { await page.waitForLoadState('networkidle'); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(600); };

for (const [name, vp] of [['390', phone], ['1440', desktop]]) test.describe(`closest live state at ${name}`, () => {
  test.use({ ...vp, contextOptions: { reducedMotion: 'reduce' } });
  test(`market tab ${name}`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', { mutate: live });
    const market = page.getByRole('region', { name: '地合い' });
    await expect(market.getByTestId('brief-regime')).toContainText('50日線割れ');
    await settle(page);
    // Open the guide's fold on a phone so its basis, cause and disclosure are in the shot and the text.
    if (name === '390') { const fold = page.locator('details.brief-exposure-basis > summary').first(); if (await fold.count()) await fold.click(); await page.waitForTimeout(300); }
    texts[`market-${name}`] = await market.innerText();
    await page.screenshot({ path: `${OUT}/market-closest-${name}.png`, fullPage: true });
    if (name === '390') for (const tab of await page.getByRole('tab').all()) {
      const label = (await tab.innerText()).replace(/\s+/g, '');
      await tab.click(); await page.waitForTimeout(500);
      texts[`market-390-tab-${label}`] = await market.innerText();
      await page.screenshot({ path: `${OUT}/market-closest-390-tab-${label.replace(/[^\p{L}\p{N}]/gu, '')}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  });
  test(`today ${name}`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { mutate: live });
    await expect(page.locator('.brief-tile').first()).toContainText('50日線割れ');
    await settle(page);
    texts[`today-${name}`] = await page.locator('#brief-main').innerText();
    texts[`today-tile-${name}`] = await page.locator('.brief-tile').first().innerText();
    await page.screenshot({ path: `${OUT}/today-closest-${name}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
});
test.describe('one session behind at 390', () => {
  test.use({ ...phone, contextOptions: { reducedMotion: 'reduce' } });
  test('market tab, history one session behind', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', { historyEnd: sessions.at(-2), mutate: live });
    await expect(page.getByRole('region', { name: '地合い' }).getByTestId('brief-regime')).toContainText('50日線割れ');
    await settle(page);
    texts['market-390-behind'] = await page.getByRole('region', { name: '地合い' }).innerText();
    await page.screenshot({ path: `${OUT}/market-closest-390-behind.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
});
test.afterAll(() => writeFileSync(`${OUT}/texts.json`, JSON.stringify(texts, null, 1)));
