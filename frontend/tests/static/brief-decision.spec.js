// Daily brief buy decision: the stock's conclusion, on synthetic data. Green means the trend template, the
// market, the earnings date and the day's event all allow a new buy; anything else is said in a neutral line.
// (The day's event titles, Today's focus tile under the market verdict and the verified day change in the bar
// and the desktop header are brief-rows.spec.js's; here the call's colour for those events is asserted.)
import { test, expect } from '@playwright/test';
import { openBrief, VIEWPORTS, rowBySymbol, SEC_SYMBOL, date } from './brief-fixture.js';

const phoneDevice = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const conclusion = page => page.getByTestId('brief-conclusion');
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
// The analysis date as the event titles name it (never 「本日」: the data may be older than today).
const DAY = `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
/** A variant of one stock's row, and of its research detail when it has one (the stock screen merges the detail in). */
const onRow = (symbol, fn) => ({ rows: rows => { fn(rows.find(r => r.symbol === symbol)); }, details: details => { for (const detail of Object.values(details)) if (detail.symbol === symbol) fn(detail); } });
// A market that holds off new buying: every row's S&P 500 is below its 50-day line (modelMarket: cap 0, a known state).
const HOLD_MARKET = { rows: rows => { for (const row of rows) row.market_above_50dma = false; } };
// The opened focus row closes above its pivot instead of on it (the synthetic day is +2.0% on 1.6× volume).
const crossing = symbol => onRow(symbol, row => { row.se_pivot_price = Math.round(row.current_price * 0.99 * 100) / 100; });
// Earnings three days after the analysis date (two days after the fixture's clock, a day later in New York).
const EARNINGS_SOON = symbol => onRow(symbol, row => { row.entry_evidence = { ...row.entry_evidence, earnings: { date: '2026-10-05' } }; });
// Three unmet trend-template rules: the RS estimate (61), the price under its 50-day line, 30.2% below the 52-week high.
const THREE_UNMET = onRow('ZZZF', row => { Object.assign(row.technical_audit.values, { belowHigh: 30.2, sma50: row.current_price * 1.05 }); });

/** Reached as a trader reaches it: Today's focus row (on a wide screen the stock opens beside the list). */
async function openFocus(page, phone, options) {
  const result = await openBrief(page, '#/brief', options);
  const focus = page.getByRole('region', { name: '注目候補' });
  await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
  const target = phone ? 'ZZNV' : 'ZZKS';
  const row = focus.locator(`[data-symbol="${target}"]`);
  if (phone) await row.tap(); else await row.click();
  await expect(page).toHaveURL(new RegExp(`#/brief/stock/${target}$`));
  return { ...result, target };
}

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`${name} ${device.viewport.width}px`, () => {
  test.use(device);
  const phone = name === 'phone';

  // The colour of the call for the day's event (its title is breakoutEvent's, asserted in brief-rows.spec.js): a
  // close exactly at the pivot, and a close above it from below on the verified +2.0% day with 1.6× volume.
  for (const [label, mutate] of [['closes exactly at its pivot', undefined], ['crosses its pivot on 1.6× volume', crossing(phone ? 'ZZNV' : 'ZZKS')]]) {
    test(`a focus candidate that ${label} is a green call`, async ({ page }) => {
      const { errors } = await openFocus(page, phone, mutate ? { mutate } : undefined);
      await expect(conclusion(page)).toHaveClass(/tone-zone/);
      await expect(conclusion(page).locator('.brief-tilequal', { hasText: '参考' })).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test('a stock below the trend template is no buy candidate: a neutral line names the unmet rule', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZZF');
    await expect(conclusion(page)).toHaveClass(/tone-neutral/);
    await expect(conclusion(page).locator('strong')).toHaveText(`トレンドテンプレート未達（未達：RS ≥ 70（${Math.floor(rowBySymbol.ZZZF.rs_rating)}））— 買いの対象外`);
    await expect(conclusion(page).getByRole('img', { name: /^ピボットからの位置（参考）/ })).toHaveClass(/is-reference/);
    await expect(conclusion(page).locator('.brief-tilequal')).toHaveText(['参考', '参考', '参考']);
    expect(errors).toEqual([]);
  });

  // The Today half of this check (the focus tile and rows) is brief-rows.spec.js's. The stock opens from Today in
  // the same document, as before the split, so the in-app path under a held market stays covered.
  test('under a market that holds off new buying, the stock conclusion says why', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { mutate: HOLD_MARKET });
    await expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate').first()).toBeVisible();
    await page.goto(`/#/brief/stock/${phone ? 'ZZNV' : 'ZZKS'}`);
    await expect(conclusion(page)).toHaveClass(/tone-neutral/);
    await expect(conclusion(page).locator('strong')).toHaveText('地合いが新規の買いを控える状態（独自判定）');
    await expect(conclusion(page).locator('.brief-call-status p')).toHaveText('位置は参考：買いゾーン・ピボット比 ±0.0%。');
    // Never 「控える」 and an order size in the same glance.
    await expect(conclusion(page).locator('.brief-tilequal')).toHaveText(['参考', '参考', '参考']);
    expect(errors).toEqual([]);
  });

  // The phone text floor (desktop keeps its 11px notes, as the other cards do).
  if (phone) test('the conclusion card reads at 12px or more', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await expect(conclusion(page).locator('.brief-kgrid > div')).toHaveCount(3);
    const small = await conclusion(page).evaluate(card => {
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT), out = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const element = node.parentElement;
        if (!node.textContent.trim() || !element.getClientRects().length || element.closest('.sr-only')) continue;
        const size = parseFloat(getComputedStyle(element).fontSize);
        if (size < 12) out.push(`${node.textContent.trim().slice(0, 20)} ${size}px`);
      }
      return out;
    });
    expect(small).toEqual([]);
    expect(errors).toEqual([]);
  });
});

/** The conclusion card's height, its title's line count and the characters on the title's last line. */
const callBox = page => conclusion(page).evaluate(card => {
  const strong = card.querySelector('strong'), walker = document.createTreeWalker(strong, NodeFilter.SHOW_TEXT), chars = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) for (let i = 0; i < node.length; i++) {
    const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
    const box = range.getBoundingClientRect();
    if (box.width) chars.push(Math.round(box.top));
  }
  const tops = [...new Set(chars)];
  return { card: card.getBoundingClientRect().height, lines: tops.length, last: chars.filter(top => top === Math.max(...tops)).length };
});

// The §3 allowance: the conclusion card grows 20px or less and the stock screen 40px or less at 375×812
// (before round 1: card 333px, screen 3112px on this fixture), in every state this track adds.
test.describe('the stock screen at 375×812', () => {
  test.use({ ...phoneDevice(375, 812), contextOptions: { reducedMotion: 'reduce' } });
  for (const [state, mutate, title] of [
    ['at its pivot', undefined, 'ピボット到達'],
    ['a breakout on the analysis date', crossing(SEC_SYMBOL), `${DAY}に上抜け・出来高1.60×`],
    ['under a market that holds off new buying', HOLD_MARKET, '地合いが新規の買いを控える状態（独自判定）'],
    ['with earnings in 3 days', EARNINGS_SOON(SEC_SYMBOL), '決算まで2日（10/5）：新規買いは見送り候補（独自判定）'],
  ]) test(`stays within track D's allowance ${state}`, async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, mutate ? { mutate } : {});
    await expect(page.getByTestId('brief-fundamentals').getByText(/^出典：SEC XBRL/)).toBeVisible();
    await expect(conclusion(page).locator('strong')).toHaveText(title);
    await settled(page);
    const box = await callBox(page);
    const screen = await page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY));
    expect(box.card).toBeLessThanOrEqual(333 + 20);
    // A title never leaves one character alone on its last line; the day's event fits one line.
    expect(box.last).toBeGreaterThan(1);
    if (mutate === undefined || title.startsWith(DAY)) expect(box.lines).toBe(1);
    expect(screen).toBeLessThanOrEqual(3112 + 40);
    // The pivot meter's marker sits clear of the ticks under it (the 0% tick is never covered).
    const meter = await conclusion(page).evaluate(card => ({ marker: card.querySelector('.brief-meter-marker').getBoundingClientRect().bottom,
      zero: [...card.querySelectorAll('.brief-meter-ticks span')].find(tick => tick.textContent === '0%').getBoundingClientRect().top }));
    expect(meter.marker).toBeLessThanOrEqual(meter.zero + 0.5);
    expect(errors).toEqual([]);
  });

  test('a stock three rules below the trend template keeps the card within the allowance and names the first rule', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZZF', { mutate: THREE_UNMET });
    await expect(conclusion(page).locator('strong')).toHaveText('TT 3条件未達 — 買いの対象外');
    await expect(conclusion(page).locator('.brief-call-status p')).toHaveText('未達：株価 > SMA50、ほか2件。位置は参考：買いゾーン・ピボット比 ±0.0%。');
    await settled(page);
    const box = await callBox(page);
    expect(box.card).toBeLessThanOrEqual(333 + 20);
    expect(box.last).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });
});
