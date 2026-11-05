// The stock screen's position plan on the synthetic publication: on a phone the card stays within
// the round-1 allowance over its step-0 height, its inputs and its structural-stop button are 44px
// targets, its text reads at 12px or more and nothing in it overflows at 320px; 「この位置を使う」
// moves the chart's stop tag to the structural stop; a stock beyond the buy zone gets no plan, and
// the chart draws no stop for it.
import { test, expect } from '@playwright/test';
import { openBrief, horizontalOverflow, SEC_SYMBOL } from './brief-fixture.js';

const phone = (width, height = 844) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
const plan = page => page.getByRole('region', { name: /^建て玉と損切りの計画/ });
const chartReady = page => expect(page.getByTestId('brief-price-chart').locator('svg rect.bc-up, svg rect.bc-down').first()).toBeAttached();
// The plan card at 390×844 before round 1 (step 0, folds closed): 316px on this fixture. Round 1 lets
// it grow by at most 80px (the stock screen's position-plan allowance).
const STEP0_PLAN_HEIGHT = 316;
const PLAN_ALLOWANCE = 80;

/** Visible text in the card under 12px, as "text size" (assistive-only text skipped). */
const smallText = page => page.locator('.brief-plan').evaluate(card => {
  const out = [], walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!node.textContent.trim() || element.closest('.sr-only') || !element.getClientRects().length) continue;
    const size = parseFloat(getComputedStyle(element).fontSize);
    if (size < 12) out.push(`${node.textContent.trim().slice(0, 30)} ${size}`);
  }
  return out;
});
/** Controls in the card shorter than 44px. */
const shortTargets = page => page.locator('.brief-plan').locator('summary, input, button').evaluateAll(nodes => nodes
  .filter(node => node.getClientRects().length).filter(node => node.getBoundingClientRect().height < 44)
  .map(node => `${node.tagName.toLowerCase()} ${(node.getAttribute('aria-label') || node.textContent || node.type).trim().slice(0, 30)} ${node.getBoundingClientRect().height}`));
/** Parts of the card that leave it, or tile text cut off inside its tile. */
const outside = page => page.locator('.brief-plan').evaluate(card => {
  const box = card.getBoundingClientRect(), out = [];
  for (const element of card.querySelectorAll('*')) {
    if (!element.getClientRects().length || element.closest('.sr-only')) continue;
    const rect = element.getBoundingClientRect();
    if (rect.left < box.left - 0.5 || rect.right > box.right + 0.5) out.push(`outside ${element.tagName.toLowerCase()} “${element.textContent.slice(0, 30)}”`);
  }
  for (const node of card.querySelectorAll('.brief-kgrid small, .brief-kgrid b, .brief-kgrid em, .brief-rbar i')) if (node.scrollWidth > node.clientWidth) out.push(`clipped “${node.textContent}” ${node.scrollWidth}>${node.clientWidth}`);
  return out;
});

test.describe('the plan card on a phone', () => {
  test.use({ ...phone(390), contextOptions: { reducedMotion: 'reduce' } });

  test(`grows at most ${PLAN_ALLOWANCE}px over step 0 at 390px, with the plan's results in view`, async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await chartReady(page);
    await expect(plan(page).getByRole('button', { name: 'この位置を使う' })).toBeVisible();
    await settled(page);
    const height = await plan(page).evaluate(node => node.getBoundingClientRect().height);
    expect(height, 'plan card height').toBeLessThanOrEqual(STEP0_PLAN_HEIGHT + PLAN_ALLOWANCE);
    // Shares, their limit, the cost, the market guide and the R bar's prices stay out of the folds.
    await expect(plan(page).locator('.brief-kgrid > div small')).toHaveText(['株数', '投資額', '地合いの目安']);
    await expect(plan(page).getByTestId('brief-shares')).toBeVisible();
    await expect(plan(page).getByRole('group', { name: 'R倍数の価格' })).toContainText(/−1R \d+\.\d{2}\+2R \d+\.\d{2}\+3R \d+\.\d{2}/);
    await expect(plan(page).getByRole('heading', { level: 2 })).toContainText('で買う場合');
    expect(errors).toEqual([]);
  });

  test('inputs, the slider, the folds and the structural button are 44px targets; text is 12px or more', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await chartReady(page);
    await expect(plan(page).getByRole('button', { name: 'この位置を使う' })).toBeVisible();
    expect(await shortTargets(page)).toEqual([]);
    expect(await smallText(page)).toEqual([]);
    for (const summary of await plan(page).locator('summary').all()) await summary.click();
    for (const name of ['口座資金（$）', '1回のリスク（%）', '損切り幅（%）', '1銘柄の上限（%）']) await expect(plan(page).getByRole('spinbutton', { name })).toBeVisible();
    await expect(plan(page).getByRole('slider', { name: '損切り幅（%）' })).toHaveAttribute('min', '1');
    await expect(plan(page).getByText('信用取引は試算しません。', { exact: false })).toBeVisible();
    // The cap's field looks like the other plan fields (their edge contrast is checked in brief-phone).
    const field = name => plan(page).getByRole('spinbutton', { name }).evaluate(node => { const style = getComputedStyle(node); return [style.borderTopColor, style.backgroundColor, style.color, style.fontSize, style.borderRadius].join(' '); });
    expect(await field('1銘柄の上限（%）')).toBe(await field('口座資金（$）'));
    expect(await shortTargets(page)).toEqual([]);
    expect(await smallText(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('「この位置を使う」 moves the stop to the structural stop, on the card and on the chart', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await chartReady(page);
    const button = plan(page).getByRole('button', { name: 'この位置を使う' });
    await expect(button).toBeVisible();
    const structural = (await plan(page).locator('.brief-structural b').textContent()).trim();
    const stopGroup = page.getByTestId('brief-price-chart').locator('.bc-stopgroup');
    await expect(stopGroup).not.toContainText(structural);
    await button.click();
    await expect(stopGroup).toContainText(structural);
    await expect(plan(page).getByRole('group', { name: 'R倍数の価格' })).toContainText(`−1R ${structural}`);
    await expect(plan(page).getByRole('button', { name: '適用済み' })).toBeDisabled();
    // The chosen stop is kept for this viewer, and the next visit opens with it.
    await page.reload();
    await chartReady(page);
    await expect(plan(page).getByRole('group', { name: 'R倍数の価格' })).toContainText(`−1R ${structural}`);
    expect(errors).toEqual([]);
  });

  test('a stock beyond the buy zone gets the reason, no plan, and no stop on the chart', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZKS', {
      mutate: { rows: rows => { const row = rows.find(item => item.symbol === 'ZZKS'); row.se_pivot_price = Math.round(row.current_price / 1.15 * 100) / 100; } },
    });
    await chartReady(page);
    await expect(plan(page).getByTestId('brief-plan-blocked')).toHaveText('買いゾーン超過：新規の試算はしません（次の土台を待つ）');
    await expect(plan(page).getByTestId('brief-shares')).toHaveCount(0);
    await expect(page.getByTestId('brief-price-chart').locator('.bc-stopgroup')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('the plan card at 320px', () => {
  test.use({ ...phone(320, 760), contextOptions: { reducedMotion: 'reduce' } });
  test('nothing in it leaves the card or is cut off, folds open or closed', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await chartReady(page);
    await expect(plan(page).getByRole('button', { name: 'この位置を使う' })).toBeVisible();
    await settled(page);
    expect(await outside(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);
    for (const summary of await plan(page).locator('summary').all()) await summary.click();
    expect(await outside(page)).toEqual([]);
    expect(await smallText(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
