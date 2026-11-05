// Daily brief market tab on phones: the verdict and the chart, the tab's secondary text and its words at
// 320px, on synthetic data.
import { test, expect } from '@playwright/test';
import { openBrief, sessions, VIEWPORTS, horizontalOverflow } from './brief-fixture.js';

const phone = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

test.describe('the market tab on a phone keeps the verdict and the chart', () => {
  test.use(VIEWPORTS.phone);
  test('verdict and S&P chart are visible on #/brief/market', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    const market = page.getByRole('region', { name: '地合い' });
    await expect(market.locator('.brief-verdict')).toBeVisible();
    await expect(market.locator('.brief-index')).toBeVisible();
    await expect(page.locator('.brief-hero small')).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('phone secondary text on the market tab', () => {
  test.use(phone(375, 812));
  const MARKET = '.brief-index-stats small, .brief-index-stats span, .brief-index-source, .brief-env-status, .brief-env-change, .brief-stagelegend, .brief-sector-name small, .brief-sector-move, .brief-fact-asof, .brief-signals > b small, .brief-verdict-date';
  const sizes = (page, selector) => page.locator(selector).evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => [node.className, node.textContent.slice(0, 20), parseFloat(getComputedStyle(node).fontSize)]));
  test('reads at 12px or more, labels in --text-2, and 基準 is a label, not a 16px value', async ({ page }) => {
    // One session behind, so the as-of tags (「（10/1時点）」) are on screen too.
    const { errors } = await openBrief(page, '#/brief/market', { historyEnd: sessions.at(-2) });
    // Every section of the tab, one after the other (a phone shows one at a time).
    await expect(page.getByRole('tab')).toHaveCount(4);
    const market = [];
    for (const tab of await page.getByRole('tab').all()) {
      await tab.click();
      if ((await tab.textContent()) === '推移') await expect(page.locator('.market-history-explorer').getByRole('img')).toBeVisible();
      market.push(...await sizes(page, MARKET));
    }
    await page.getByRole('tab', { name: '指数' }).click();
    expect(market.length).toBeGreaterThan(20);
    expect(market.filter(([, , size]) => size < 12)).toEqual([]);
    const label = await page.locator('.brief-index-stats small').first().evaluate(node => [getComputedStyle(node).color, getComputedStyle(node.closest('.brief-index-block')).getPropertyValue('--text-2')]);
    expect(label[0]).toBe(await page.evaluate(value => { const probe = document.createElement('span'); probe.style.color = value; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }, label[1].trim()));
    await page.locator('.brief-env-toggle').first().click();
    const rule = await page.locator('.brief-env-rule').first().evaluate(node => { const b = node.querySelector('b'); return [getComputedStyle(b).fontSize, getComputedStyle(node).fontSize, getComputedStyle(b).fontFamily === getComputedStyle(node).fontFamily]; });
    expect(rule).toEqual(['12px', '12px', true]);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('market tab words at 320px', () => {
  test.use(phone(320, 640));
  test('the verdict keeps （独自判定） whole, the exposure label breaks before の目安, row notes get the row width', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    const verdict = page.getByTestId('brief-regime');
    await expect(verdict.locator('strong .brief-frag')).toHaveText('（独自判定）');
    expect(await verdict.locator('strong .brief-frag').evaluate(node => node.getClientRects().length)).toBe(1);
    for (const part of await verdict.locator('.brief-exposure small .brief-frag').all()) expect(await part.evaluate(node => node.getClientRects().length)).toBe(1);
    // Below 360px the 1-year line and the 1-month change sit under the note, not beside it.
    const stacked = await page.locator('.brief-env-toggle').evaluateAll(toggles => toggles.filter(t => t.querySelector(':scope > em') && t.querySelector(':scope > .brief-env-change'))
      .map(t => { const note = t.querySelector(':scope > em').getBoundingClientRect(), change = t.querySelector(':scope > .brief-env-change').getBoundingClientRect(); return change.top >= note.bottom - 1; }));
    expect(stacked.length).toBeGreaterThanOrEqual(3);
    expect(stacked.every(Boolean)).toBe(true);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
