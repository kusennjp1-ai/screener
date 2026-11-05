// The stock screen's position plan on the synthetic publication: on a phone the card stays within
// the round-1 allowance over its step-0 height (by default, waiting with a 参考 heading, and with the cap
// setting the count), its inputs and its structural-stop button are 44px targets, its text reads at 12px
// or more and nothing in it overflows at 320px; 「この位置を使う」 moves the chart's stop tag to this
// stock's structural stop, keeps the keyboard focus and never sets another stock's stop; a stock beyond
// the buy zone gets no plan, and the chart draws no stop for it.
import { test, expect } from '@playwright/test';
import { openBrief, horizontalOverflow, SEC_SYMBOL } from './brief-fixture.js';

const phone = (width, height = 844) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
const plan = page => page.getByRole('region', { name: /^建て玉と損切りの計画/ });
const chartReady = page => expect(page.getByTestId('brief-price-chart').locator('svg rect.bc-up, svg rect.bc-down').first()).toBeAttached();
// The plan card at 390×844 before round 1 (step 0, folds closed): 316px on this fixture (ZZNV and ZZSD
// both measured 315.8). Round 1 lets it grow by at most 80px (the stock screen's position-plan allowance).
const STEP0_PLAN_HEIGHT = 316;
const PLAN_ALLOWANCE = 80;
const planHeight = page => plan(page).evaluate(node => node.getBoundingClientRect().height);
/** Lines a text box takes at its line height. */
const lineCount = locator => locator.evaluate(node => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));
/** Settings under which the 25% cap sets the count (a 4% stop with the default 1.25% risk). */
const CAP_BOUND = { 'brief-plan': { account: 50000, riskPercent: 1.25, stopPercent: 4, capPercent: 25 } };

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

  // ZZNV: in the buy zone; ZZSD: waiting below the pivot with a 参考 heading (the tallest default case).
  for (const symbol of [SEC_SYMBOL, 'ZZSD']) test(`${symbol}: grows at most ${PLAN_ALLOWANCE}px over step 0 at 390px, with the plan's results in view, also once its structural stop is applied`, async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${symbol}`);
    await chartReady(page);
    const button = plan(page).getByRole('button', { name: 'この位置を使う' });
    await expect(button).toBeVisible();
    await settled(page);
    expect(await planHeight(page), 'plan card height').toBeLessThanOrEqual(STEP0_PLAN_HEIGHT + PLAN_ALLOWANCE);
    // Shares, their limit, the cost, the market guide and the R bar's prices stay out of the folds.
    await expect(plan(page).locator('.brief-kgrid > div small')).toHaveText(['株数', '投資額', '地合いの目安']);
    await expect(plan(page).getByTestId('brief-shares')).toBeVisible();
    await expect(plan(page).getByRole('group', { name: 'R倍数の価格' })).toContainText(/−1R \d+\.\d{2}\+2R \d+\.\d{2}\+3R \d+\.\d{2}/);
    await expect(plan(page).getByRole('heading', { level: 2 })).toContainText(/(終値|ピボット) \d+\.\d{2} で買う場合/);
    await expect(plan(page).getByRole('heading', { level: 2 })).not.toContainText('現在値');
    // Applied, the structural stop may let the cap set the count (a longer note under the shares).
    await button.click();
    await expect(plan(page).getByRole('button', { name: '適用済み' })).toBeVisible();
    await settled(page);
    expect(await planHeight(page), 'plan card height, structural stop applied').toBeLessThanOrEqual(STEP0_PLAN_HEIGHT + PLAN_ALLOWANCE);
    expect(errors).toEqual([]);
  });

  test('with the cap setting the count, the card stays in the allowance and the note under the shares takes two lines', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { storage: CAP_BOUND });
    await chartReady(page);
    const note = plan(page).locator('.brief-kgrid > div em').first();
    await expect(note).toHaveText(/^上限25%・実リスク \$[\d,]+$/);
    await settled(page);
    expect(await planHeight(page), 'plan card height, cap-bound').toBeLessThanOrEqual(STEP0_PLAN_HEIGHT + PLAN_ALLOWANCE);
    expect(await lineCount(note), 'lines of 上限25%・実リスク $x').toBeLessThanOrEqual(2);
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

  test('「この位置を使う」 moves this stock\'s stop to its structural stop, on the card and on the chart, and keeps the focus', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await chartReady(page);
    const button = plan(page).getByRole('button', { name: 'この位置を使う' });
    await expect(button).toBeVisible();
    const structural = (await plan(page).locator('.brief-structural b').textContent()).trim();
    const stopGroup = page.getByTestId('brief-price-chart').locator('.bc-stopgroup');
    await expect(stopGroup).not.toContainText(structural);
    // From the keyboard: the button keeps the focus once applied (適用済み is announced in place).
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(stopGroup).toContainText(structural);
    await expect(plan(page).getByRole('group', { name: 'R倍数の価格' })).toContainText(`−1R ${structural}`);
    const applied = plan(page).getByRole('button', { name: '適用済み' });
    await expect(applied).toHaveAttribute('aria-disabled', 'true');
    await expect(applied).toBeFocused();
    await expect(plan(page).locator('summary').first()).toContainText('損切り 構造 ');
    // The choice is kept for this stock, and the next visit opens with it.
    await page.reload();
    await chartReady(page);
    await expect(plan(page).getByRole('group', { name: 'R倍数の価格' })).toContainText(`−1R ${structural}`);
    await expect(plan(page).getByRole('button', { name: '適用済み' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('one stock\'s structural stop never becomes another stock\'s stop', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await chartReady(page);
    await plan(page).getByRole('button', { name: 'この位置を使う' }).click();
    await expect(plan(page).getByRole('button', { name: '適用済み' })).toBeVisible();
    await page.goto('/#/brief/stock/ZZAR');
    await chartReady(page);
    await expect(plan(page).locator('summary').first()).toContainText('損切り 7.0%');
    const entry = Number((await plan(page).getByRole('heading', { level: 2 }).textContent()).match(/(\d+\.\d{2}) で買う場合/)[1]);
    const stop = (entry * 0.93).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    await expect(plan(page).getByRole('group', { name: 'R倍数の価格' })).toContainText(`−1R ${stop}`);
    await expect(page.getByTestId('brief-price-chart').locator('.bc-stopgroup')).toContainText(stop);
    const button = plan(page).getByRole('button', { name: 'この位置を使う' });
    await expect(button).toBeVisible();
    await expect(button).not.toHaveAttribute('aria-disabled', 'true');
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
    // 地合いの目安 breaks between its words, never inside 目安.
    for (const part of await plan(page).locator('.brief-kgrid small .brief-frag').all()) expect(await lineCount(part), await part.textContent()).toBe(1);
    for (const summary of await plan(page).locator('summary').all()) await summary.click();
    expect(await outside(page)).toEqual([]);
    expect(await smallText(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);
    // The three plan fields line up on their bottom edges even where a label wraps.
    const bottoms = await plan(page).locator('.brief-inputs input').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().bottom)));
    expect(new Set(bottoms).size, `field bottoms ${bottoms}`).toBe(1);
    expect(errors).toEqual([]);
  });

  test('with the cap setting the count, nothing leaves the card or is cut off', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { storage: CAP_BOUND });
    await chartReady(page);
    await expect(plan(page).locator('.brief-kgrid > div em').first()).toHaveText(/^上限25%・実リスク/);
    await settled(page);
    expect(await outside(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
