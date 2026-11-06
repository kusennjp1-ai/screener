// The stock screen's position plan on the synthetic publication: on a phone the card stays within
// the round-1 allowance over its step-0 height (by default, waiting with a 参考 heading, and with the cap
// setting the count), its inputs and its structural-stop button are 44px targets, its text reads at 12px
// or more and nothing in it overflows at 320px; 「この位置を使う」 moves the chart's stop tag to this
// stock's structural stop, keeps the keyboard focus and never sets another stock's stop; a stock beyond
// the buy zone gets no plan, and the chart draws no stop for it.
import { test, expect } from '@playwright/test';
import { openBrief, horizontalOverflow, rowBySymbol, SEC_SYMBOL } from './brief-fixture.js';

const phone = (width, height = 844) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
const plan = page => page.getByRole('region', { name: /^建て玉と損切りの計画/ });
const chartReady = page => expect(page.getByTestId('brief-price-chart').locator('svg rect.bc-up, svg rect.bc-down').first()).toBeAttached();
// The plan card at 390×844 before round 1 (step 0, folds closed): 316px on this fixture (ZZNV and ZZSD
// both measured 315.8). Round 1 lets it grow by at most 80px (the stock screen's position-plan allowance).
const STEP0_PLAN_HEIGHT = 316;
const PLAN_ALLOWANCE = 80;
// Round 2: the plan card at 390×844 on db8e297 (the round-2 step 0, CI-faithful): ZZNV 368.8, ZZSD 391.2, ZZHW 391.2 (also
// under DEEP's pivot). Verdict may grow it by at most 40px (plan §3), and keeps rule 9's 12px of headroom under that.
const R2_STEP0_PLAN = { [SEC_SYMBOL]: 368.8, ZZSD: 391.2, ZZHW: 391.2 };
const R2_PLAN_ALLOWANCE = 40;
const HEADROOM = 12;
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
    expect(await planHeight(page), 'plan card height, round 2').toBeLessThanOrEqual(R2_STEP0_PLAN[symbol] + R2_PLAN_ALLOWANCE - HEADROOM);
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
    // The chart prints the stop's price in its axis tag (the line's own label gives the percentage).
    const stopGroup = page.getByTestId('brief-price-chart').locator('[data-tag="stop"]');
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
    await expect(page.getByTestId('brief-price-chart').locator('[data-tag="stop"]')).toContainText(stop);
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

// Round 2 (verdict): the stop against the base (VD5), the market as the plan's 参考 reason (VD3) and the
// exposure tile (VD10). ZZHW waits under a pivot moved up 4.5% above its price, so its 7% stop sits inside the
// last contraction and its structural stop is deeper than 8%; ZZNV with a 3% stop setting is green with its stop inside.
const DEEP = { rows: rows => { const row = rows.find(r => r.symbol === 'ZZHW'); row.se_pivot_price = Math.round(rowBySymbol.ZZHW.current_price * 1.045 * 100) / 100; } };
const TIGHT_STOP = { 'brief-plan': { account: 50000, riskPercent: 1.25, stopPercent: 3, capPercent: 25 } };
const warnings = page => plan(page).locator('.brief-plan-warn li');
const HOLD_MARKET = { rows: rows => { for (const row of rows) row.market_above_50dma = false; } };

test.describe('round 2: the plan card on a phone', () => {
  test.use({ ...phone(390), contextOptions: { reducedMotion: 'reduce' } });

  /** Lines an element's visible text takes (assistive-only text skipped), and the slack after its widest line. */
  const fitOf = locator => locator.evaluate(node => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), lines = new Map();
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (text.parentElement.closest('.sr-only')) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const rect of range.getClientRects()) if (rect.width > 1) { const top = Math.round(rect.top), line = lines.get(top) || [Infinity, -Infinity]; lines.set(top, [Math.min(line[0], rect.left), Math.max(line[1], rect.right)]); }
    }
    const width = node.getBoundingClientRect().width;
    return { lines: lines.size, slack: Math.min(...[...lines.values()].map(([left, right]) => width - (right - left))) };
  });

  test('warns in one ext line when the stop sits inside the last contraction, and on the structural stop\'s line when it is deeper than 8%', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZHW', { mutate: DEEP });
    await chartReady(page);
    await expect(warnings(page)).toHaveCount(1);
    await expect(warnings(page)).toHaveText(/^損切りが収縮の中（安値 \d+\.\d{2} より上・独自判定）。通常の値動きで刈られやすい位置です$/);
    const deep = plan(page).locator('.brief-structural[data-deep="true"]');
    await expect(deep.locator('small')).toHaveText(/^−[89]\.\d%：8%超で見送り候補（独自設定）（ピボットでの買いはリスクが大きい）$/);
    await expect(deep).toHaveClass(/tone-ext/);
    await settled(page);
    // Each one line at 390 with 6px of slack: the warning on the card's width, the depth beside the 44px button.
    for (const [name, node] of [['inside', warnings(page)], ['deep', deep.locator('small')]]) {
      const fit = await fitOf(node);
      expect(fit.lines, name).toBe(1);
      expect(fit.slack, `${name} slack`).toBeGreaterThanOrEqual(6);
    }
    // The ext tone at the 12px floor; the stop is never moved by itself.
    const style = await plan(page).locator('.brief-plan-warn').evaluate(node => { const s = getComputedStyle(node), probe = document.createElement('span'); probe.style.color = 'var(--ext)'; node.append(probe); const ext = getComputedStyle(probe).color; probe.remove(); return [parseFloat(s.fontSize), s.color === ext]; });
    expect(style).toEqual([12, true]);
    await expect(plan(page).locator('summary').first()).toContainText('損切り 7.0%');
    expect(await smallText(page)).toEqual([]);
    expect(await shortTargets(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  // §3's +40 for the plan card, with rule 9's 12px of headroom, in the states that warn: ZZHW's own 7% stop inside its
  // last contraction (one warning) and DEEP (the warning and the deep structural stop).
  for (const [name, mutate] of [['ZZHW', undefined], ['ZZHW under DEEP', DEEP]]) test(`${name}: the plan card grows at most ${R2_PLAN_ALLOWANCE - HEADROOM}px over step 0 at 390px with its warnings`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZHW', mutate ? { mutate } : {});
    await chartReady(page);
    await expect(warnings(page)).toHaveCount(1);
    await settled(page);
    expect(await planHeight(page)).toBeLessThanOrEqual(R2_STEP0_PLAN.ZZHW + R2_PLAN_ALLOWANCE - HEADROOM);
    expect(errors).toEqual([]);
  });

  test('the conclusion\'s stop tile says 収縮の中 with no added height while the call stays green', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { storage: TIGHT_STOP });
    await chartReady(page);
    const call = page.getByTestId('brief-conclusion');
    await expect(call).toHaveClass(/tone-zone/);
    await expect(warnings(page)).toHaveCount(1);
    const tiles = call.locator('.brief-kgrid > div');
    await expect(tiles.nth(1).locator('.brief-tilequal')).toHaveText('収縮の中');
    await expect(tiles.nth(1).locator('.brief-tilequal')).toHaveClass(/tone-ext/);
    const heights = await tiles.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    expect(new Set(heights).size).toBe(1);
    expect(errors).toEqual([]);
  });

  test('a market that holds off new buying makes the plan 参考（地合い） and its guide 試算のみ', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { mutate: HOLD_MARKET });
    await chartReady(page);
    await expect(plan(page).getByRole('heading', { level: 2 })).toContainText('・参考（地合い）');
    await expect(plan(page).locator('.brief-kgrid > div').nth(2)).toContainText('試算のみ');
    expect(errors).toEqual([]);
  });

  test('the exposure tile keeps its height: the share in short, the count in the terms', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await chartReady(page);
    const tile = plan(page).locator('.brief-kgrid > div').nth(2);
    await expect(tile.locator('em .brief-frag')).toHaveText([/^目安の\d+%$/]);
    const heights = await plan(page).locator('.brief-kgrid > div').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    expect(new Set(heights).size).toBe(1);
    await plan(page).locator('summary').first().click();
    await expect(plan(page).getByTestId('brief-plan-exposure')).toHaveText(/^この1銘柄で目安の\d+%・同じ大きさなら目安内に\d+銘柄（保有分は未登録のため含まず）。$/);
    expect(errors).toEqual([]);
  });
});

test.describe('round 2: the plan card at 320px', () => {
  test.use({ ...phone(320, 760), contextOptions: { reducedMotion: 'reduce' } });
  test('with both stop warnings, nothing leaves the card or is cut off, and text stays 12px or more', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZHW', { mutate: DEEP });
    await chartReady(page);
    await expect(warnings(page)).toHaveCount(1);
    await expect(plan(page).locator('.brief-structural[data-deep="true"]')).toBeVisible();
    await settled(page);
    expect(await outside(page)).toEqual([]);
    expect(await smallText(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
