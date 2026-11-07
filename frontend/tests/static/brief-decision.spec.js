// Daily brief buy decision: the stock's conclusion, on synthetic data. Green means the trend template, the
// market, the earnings date and the day's event all allow a new buy; anything else is said in a neutral line.
// (The day's event titles, Today's focus tile under the market verdict and the verified day change in the bar
// and the desktop header are brief-rows.spec.js's; here the call's colour for those events is asserted.)
import { test, expect } from '@playwright/test';
import { openBrief, VIEWPORTS, rowBySymbol, SEC_SYMBOL, date, now, charts, horizontalOverflow } from './brief-fixture.js';
import { conditionNote } from '../../src/static/missingCondition.js';
import { breakoutEvent, candidateView, earningsCall } from '../../src/static/brief/briefCandidate.js';
import { crossingEvent } from '../../src/static/brief/breakoutHistory.js';

const phoneDevice = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const conclusion = page => page.getByTestId('brief-conclusion');
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
/** A variant of one stock's row, and of its research detail when it has one (the stock screen merges the detail in). */
const onRow = (symbol, fn) => ({ rows: rows => { fn(rows.find(r => r.symbol === symbol)); }, details: details => { for (const detail of Object.values(details)) if (detail.symbol === symbol) fn(detail); } });
// A market that holds off new buying: every row's S&P 500 is below its 50-day line (modelMarket: cap 0, a known state).
const HOLD_MARKET = { rows: rows => { for (const row of rows) row.market_above_50dma = false; } };
// The opened focus row closes above its pivot instead of on it (the synthetic day is +2.0% on 1.6× volume).
const crossing = symbol => onRow(symbol, row => { row.se_pivot_price = Math.round(row.current_price * 0.99 * 100) / 100; });
// Earnings three days after the analysis date (two days after the fixture's clock, a day later in New York).
const EARNINGS_SOON = symbol => onRow(symbol, row => { row.entry_evidence = { ...row.entry_evidence, earnings: { date: '2026-10-05' } }; });
/** The candidate view of SEC_SYMBOL's row under a variant's row mutation: rows' copy is asserted through rows' functions. */
const variantView = mutate => { const list = [structuredClone(rowBySymbol[SEC_SYMBOL])]; mutate?.rows?.(list); return candidateView({ row: list[0] }, date); };
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
    // The RS estimate alone: counted in the title, named with its value and threshold under it (conditionNote, this track's).
    await expect(conclusion(page).locator('strong')).toHaveText('TT 1条件未達 — 買いの対象外');
    const note = conditionNote({ label: 'RS 推計 ≥ 70（公開日足の共通母集団）', value: rowBySymbol.ZZZF.rs_rating, state: 'fail' });
    expect(note).toBe(`未達：RS推計 ${Math.floor(rowBySymbol.ZZZF.rs_rating)}（基準70）`);
    await expect(conclusion(page).locator('.brief-call-status p').first()).toHaveText(new RegExp(`^${note}。位置は参考：`));
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

// The round-1 allowance kept as a cap (the conclusion card grows 20px or less over 333px), and round 2's: the
// stock screen within verdict's +80px over step 0 (3056px on this fixture at 375×812), in every state this track adds.
test.describe('the stock screen at 375×812', () => {
  test.use({ ...phoneDevice(375, 812), contextOptions: { reducedMotion: 'reduce' } });
  // The day's event titles are breakoutEvent's and the earnings line earningsCall's (rows'); the market's is this track's.
  for (const [state, mutate, titleOf, oneLine] of [
    ['at its pivot', undefined, () => breakoutEvent(variantView()).title, true],
    ['a breakout on the analysis date', crossing(SEC_SYMBOL), () => breakoutEvent(variantView(crossing(SEC_SYMBOL))).title, true],
    ['under a market that holds off new buying', HOLD_MARKET, () => '地合いが新規の買いを控える状態（独自判定）', false],
    ['with earnings in 3 days', EARNINGS_SOON(SEC_SYMBOL), () => earningsCall(variantView(EARNINGS_SOON(SEC_SYMBOL)), now).line, false],
  ]) test(`stays within track D's allowance ${state}`, async ({ page }) => {
    const title = titleOf();
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, mutate ? { mutate } : {});
    await expect(page.getByTestId('brief-fundamentals').getByText(/^出典：SEC XBRL/)).toBeVisible();
    await expect(conclusion(page).locator('strong')).toHaveText(title);
    await settled(page);
    const box = await callBox(page);
    const screen = await page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY));
    expect(box.card).toBeLessThanOrEqual(333 + 20);
    // A title never leaves one character alone on its last line; the day's event fits one line.
    expect(box.last).toBeGreaterThan(1);
    if (oneLine) expect(box.lines).toBe(1);
    expect(screen).toBeLessThanOrEqual(3056 + 80);
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

// Round 2 (verdict): one buy gate. Each variant below names its call by this track's copy; the day's event
// titles are breakoutEvent's (rows') and are never asserted here (plan rule 14).
const phone375 = { ...phoneDevice(375, 812), contextOptions: { reducedMotion: 'reduce' } };
/** The title's line count and its slack: the line box's width minus the text on its widest line. */
const titleFit = page => conclusion(page).locator('strong').evaluate(strong => {
  const walker = document.createTreeWalker(strong, NodeFilter.SHOW_TEXT), lines = new Map();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) for (let i = 0; i < node.length; i++) {
    const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
    const box = range.getBoundingClientRect();
    if (box.width) { const top = Math.round(box.top), line = lines.get(top) || [Infinity, -Infinity]; lines.set(top, [Math.min(line[0], box.left), Math.max(line[1], box.right)]); }
  }
  const width = strong.getBoundingClientRect().width;
  return { lines: lines.size, slack: Math.min(...[...lines.values()].map(([left, right]) => width - (right - left))) };
});
/** Today's (and the stock's) certified bars, rewritten for a variant: the last close stays the row's price. */
const onChart = (symbol, fn) => ({ charts: served => { fn(served[`${symbol}.json`].bars); } });
const fit = bar => { bar.high = Math.max(bar.high, bar.open, bar.close); bar.low = Math.min(bar.low, bar.open, bar.close); };
const both = (...parts) => parts.reduce((all, part) => {
  for (const [key, fn] of Object.entries(part)) { const prior = all[key]; all[key] = prior ? value => { prior(value); fn(value); } : fn; }
  return all;
}, {});
/**
 * The stock 3% above a pivot it crossed `ago` sessions back, still in the buy zone (the day before was above it too): the
 * close before the crossing under the pivot, every close since at or above it; the crossing bar on `ratio` times the
 * 50 sessions before it (none: the fixture's own volume), and with `peak` one close since at that multiple of the pivot.
 */
const aboveSince = (ago, { ratio = null, peak = null } = {}) => {
  const row = rowBySymbol[SEC_SYMBOL], pivot = Math.round(row.current_price / 1.03 * 100) / 100;
  return both(onRow(SEC_SYMBOL, r => { r.se_pivot_price = pivot; r.technical_audit.values.change = 1; }), onChart(SEC_SYMBOL, bars => {
    const n = bars.length, at = n - 1 - ago;
    Object.assign(bars[at - 1], { open: pivot * 0.98, close: pivot * 0.98 }); fit(bars[at - 1]);
    for (let i = at; i < n - 1; i++) { if (bars[i].close < pivot * 1.005) Object.assign(bars[i], { open: pivot * 1.006, close: pivot * 1.006 }); fit(bars[i]); }
    if (peak) { Object.assign(bars[at + 3], { open: pivot * peak, close: pivot * peak }); fit(bars[at + 3]); }
    if (ratio) bars[at].volume = Math.ceil(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * ratio);
  }));
};
/** The crossing bar's date as the titles write it (M/D), `ago` sessions before the analysis date. */
const crossDay = ago => { const iso = charts[`${SEC_SYMBOL}.json`].bars.at(-1 - ago).date; return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}`; };
const STALE = aboveSince(25);
// The same, but one close since the crossing ran to +15% (above the zone's +5% top): a pullback, not a stall.
const PULLBACK = aboveSince(25, { peak: 1.15 });
// A heavy down day in the zone: the verified day falls 1.5% on 1.6× volume.
const HEAVY_DOWN = onRow(SEC_SYMBOL, row => { row.technical_audit.values.change = -1.5; });
// A pivot 2% above the price, crossed four sessions ago on 2.2× the prior 50-day volume, then closes back under it.
const failedBreakout = symbol => {
  const row = rowBySymbol[symbol], pivot = Math.round(row.current_price * 1.02 * 100) / 100;
  return both(onRow(symbol, r => { r.se_pivot_price = pivot; }), onChart(symbol, bars => {
    const n = bars.length, at = n - 4;
    Object.assign(bars[at - 1], { open: pivot * 0.985, close: pivot * 0.985 }); fit(bars[at - 1]);
    Object.assign(bars[at], { open: pivot * 0.99, close: pivot * 1.01 }); fit(bars[at]);
    for (const i of [at + 1, at + 2]) { Object.assign(bars[i], { open: pivot * 0.99, close: pivot * 0.985 }); fit(bars[i]); }
    bars[at].volume = Math.ceil(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * 2.2);
  }));
};
const WEAK_BASE = onRow(SEC_SYMBOL, row => { row.se_pattern_confidence = 31; });
const INDUSTRY = onRow(SEC_SYMBOL, row => { row.ibd_group_rank = 12; });
/** The stock screen's content height, as the 375 loop measures it. */
const content = page => page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY));
// Plan §3 at 375×812: the stock screen within verdict's +80 over step 0 (3056 on ZZNV), less rule 9's 12px of headroom,
// and the whole screen's line (its 3400 budget less the same 12px) for the tallest state this track adds.
const STOCK_CAP = 3056 + 80 - 12;
const STOCK_LINE = 3400 - 12;

test.describe('round 2: the one buy gate at 375×812', () => {
  test.use(phone375);

  test('an RS-only template miss is one line at 375 with 6px of slack on ZZHW and ZZZF, and its card shrinks', async ({ page }) => {
    for (const symbol of ['ZZHW', 'ZZZF']) {
      const { errors } = await openBrief(page, `#/brief/stock/${symbol}`);
      await expect(conclusion(page).locator('strong')).toHaveText('TT 1条件未達 — 買いの対象外');
      await settled(page);
      const title = await titleFit(page);
      expect(title.lines, symbol).toBe(1);
      expect(title.slack, `${symbol} title slack`).toBeGreaterThanOrEqual(6);
      // Step 0: the RS-only card was 387.5 (ZZHW) and 366.5 (ZZZF) with a 3-line title; it must shrink.
      expect((await callBox(page)).card, symbol).toBeLessThan(symbol === 'ZZHW' ? 387.5 : 366.5);
      expect(errors).toEqual([]);
    }
  });

  test('a breakout dated two sessions back on 1.6× volume is a green call on one line; on 0.8× it waits', async ({ page, context }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { mutate: aboveSince(2, { ratio: 1.6 }) });
    await expect(conclusion(page).locator('strong')).toHaveText(`${crossDay(2)}に上抜け・2営業日前`);
    await expect(conclusion(page)).toHaveClass(/tone-zone/);
    await expect(conclusion(page)).toHaveAttribute('data-gate', 'after');
    await expect(conclusion(page).locator('.brief-tilequal', { hasText: '参考' })).toHaveCount(0);
    await settled(page);
    const title = await titleFit(page);
    expect(title.lines).toBe(1);
    expect(title.slack).toBeGreaterThanOrEqual(6);
    expect(errors).toEqual([]);
    // The same crossing on 0.8× the volume, in a page of its own (each page routes its own publication).
    const other = await context.newPage(), light = await openBrief(other, `#/brief/stock/${SEC_SYMBOL}`, { mutate: aboveSince(2, { ratio: 0.8 }) });
    await expect(conclusion(other).locator('strong')).toHaveText(`${crossDay(2)}に上抜け・出来高不足`);
    await expect(conclusion(other)).toHaveClass(/tone-wait/);
    await expect(conclusion(other)).toContainText('上抜けの日の出来高0.80×は基準の1.4×に届きません。');
    await expect(conclusion(other)).not.toContainText('買いの範囲です');
    expect(light.errors).toEqual([]);
  });

  test('a heavy down day in the zone prints no buy range and its tiles read 参考', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { mutate: HEAVY_DOWN });
    await expect(conclusion(page)).toHaveAttribute('data-gate', 'heavyDown');
    // The day's tone is breakoutEvent's (rows').
    await expect(conclusion(page)).toHaveClass(new RegExp(`tone-${breakoutEvent(variantView(HEAVY_DOWN)).tone}`));
    await expect(conclusion(page)).toContainText('新規の買いは見送ります（出来高1.40×以上の下落日・独自判定）');
    await expect(conclusion(page)).not.toContainText('買いの範囲です');
    await expect(conclusion(page).locator('.brief-tilequal')).toHaveText(['参考', '参考', '参考']);
    await expect(page.getByRole('region', { name: /^建て玉と損切りの計画/ }).getByRole('heading', { level: 2 })).toContainText('参考（下落日の大商い）');
    expect(errors).toEqual([]);
  });

  for (const [label, mutate, title, line] of [
    ['stalls', STALE, '上抜けから25営業日・停滞（次のピボット待ち）', '10営業日を超えて伸びないため停滞（独自判定）'],
    ['was pulled back to the pivot after a run', PULLBACK, '上抜けから25営業日・押し戻し（次のピボット待ち）', 'ピボット比 +15.0%まで伸びた後に買いゾーンへ戻りました（10営業日超・独自判定）'],
  ]) test(`a breakout still in the zone 25 sessions on that ${label} waits for the next pivot, its tiles 参考`, async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { mutate });
    await expect(conclusion(page).locator('strong')).toHaveText(title);
    await expect(conclusion(page)).toHaveClass(/tone-wait/);
    await expect(conclusion(page)).toContainText(`新規の買いは見送り。${crossDay(25)}に上抜け、`);
    await expect(conclusion(page)).toContainText(line);
    await expect(conclusion(page)).not.toContainText('買いの範囲です');
    await expect(conclusion(page).locator('.brief-tilequal')).toHaveText(['参考', '参考', '参考']);
    await expect(page.getByRole('region', { name: /^建て玉と損切りの計画/ }).getByRole('heading', { level: 2 })).toContainText('参考（停滞）');
    // Two title lines at most at 375, and the stock screen within the allowance with its headroom.
    await settled(page);
    expect((await titleFit(page)).lines).toBeLessThanOrEqual(2);
    expect(await content(page)).toBeLessThanOrEqual(STOCK_CAP);
    expect(errors).toEqual([]);
  });

  test('a failed breakout is a neutral ブレイク失敗 with no wait sentence, and the plan is 参考（崩れ）', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { mutate: failedBreakout(SEC_SYMBOL) });
    await expect(conclusion(page).locator('strong')).toHaveText('ブレイク失敗（独自判定）');
    await expect(conclusion(page)).toHaveClass(/tone-neutral/);
    await expect(conclusion(page).locator('.brief-call-status p').first()).toHaveText(/^\d+\/\d+に出来高2\.\d\d×で上抜け、ピボットの下へ戻りました。位置は参考：/);
    await expect(conclusion(page)).not.toContainText('出来高を伴ってピボットを上抜けるまで待ちます');
    await expect(conclusion(page).locator('.brief-tilequal')).toHaveText(['参考', '参考', '参考']);
    await expect(page.getByRole('region', { name: /^建て玉と損切りの計画/ }).getByRole('heading', { level: 2 })).toContainText('参考（崩れ）');
    // The call already says the setup broke: the sell chip is the short form, its sentence in its title.
    await expect(conclusion(page).locator('.brief-chip', { hasText: '崩れ（独自判定）' })).toHaveAttribute('title', /^買いの前提が崩れた／保有なら売りのサイン（独自判定）：/);
    // The sell card names it among the broken setups.
    const sell = page.getByTestId('brief-sell');
    await expect(sell.locator('li').filter({ has: page.locator('.is-sell-hit') }).filter({ hasText: '出来高を伴う上抜け後のピボット割れ' })).toBeVisible();
    await expect(sell).toContainText(/で上抜け、\d+\/\d+ にピボットの下へ/);
    // The tallest state this track adds stays under the stock screen's line.
    await settled(page);
    expect(await content(page)).toBeLessThanOrEqual(STOCK_LINE);
    expect(errors).toEqual([]);
  });

  test('a Setup Engine base at confidence 31 makes the pivot a reference: neutral, 参考, the confidence named', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { mutate: WEAK_BASE });
    await expect(conclusion(page).locator('strong')).toHaveText('土台を確認できない — ピボットは参考（独自判定）');
    await expect(conclusion(page)).toHaveClass(/tone-neutral/);
    await expect(conclusion(page).locator('.brief-call-status p').first()).toHaveText(/^土台の信頼度 31（基準55）。位置は参考：/);
    await expect(conclusion(page).locator('.brief-tilequal')).toHaveText(['参考', '参考', '参考']);
    await expect(page.getByRole('region', { name: /^建て玉と損切りの計画/ }).getByRole('heading', { level: 2 })).toContainText('参考（土台未確認）');
    expect(errors).toEqual([]);
  });

  // Design Acceptance's signed-number pattern: an ASCII hyphen as a minus sign before a figure. A period such as another
  // track's 「26-03」 (YY-MM) is not a minus, so only this track's figures can trip it.
  test('no figure on the conclusion, the template, the plan or the sell card writes a minus with the ASCII hyphen', async ({ context }) => {
    // Each variant in a page of its own: a page routes one publication, and a hash change does not reload it.
    for (const mutate of [undefined, HEAVY_DOWN, failedBreakout(SEC_SYMBOL), aboveSince(25, { peak: 1.15 })]) {
      const page = await context.newPage();
      const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, mutate ? { mutate } : {});
      await expect(page.getByTestId('brief-sell')).toBeVisible();
      for (const card of [conclusion(page), page.locator('[aria-labelledby="brief-tt-title"]'), page.getByRole('region', { name: /^建て玉と損切りの計画/ }), page.getByTestId('brief-sell')]) {
        const text = (await card.innerText()).replace(/\d{4}-\d{2}-\d{2}/g, '');
        expect(text).not.toMatch(/(?:^|[\s(（:：$＄=＝~〜、,])-\$?\d/m);
      }
      expect(errors).toEqual([]);
      await page.close();
    }
  });
});

// A touch at the pivot's cents never followed by a close above it (ZZNV's pivot is its price: three closes on it after one
// under it): the conclusion dates the touch in tone wait, as crossingEvent words it on these bars, on one title line at 320
// and 375, and the chart draws no breakout arrow (a touch is not a breakout).
const heldBars = bars => {
  const n = bars.length, pivot = rowBySymbol[SEC_SYMBOL].se_pivot_price;
  Object.assign(bars[n - 4], { close: Math.round(pivot * 0.98 * 100) / 100 }); fit(bars[n - 4]);
  for (const i of [n - 3, n - 2, n - 1]) { Object.assign(bars[i], { close: pivot }); fit(bars[i]); }
  return bars;
};
const HELD_TOUCH = onChart(SEC_SYMBOL, heldBars);
for (const width of [320, 375]) test.describe(`round 2: a touch never followed by a close above, at ${width}px`, () => {
  test.use({ ...phoneDevice(width, width === 320 ? 640 : 812), contextOptions: { reducedMotion: 'reduce' } });
  test('waits, dated from the touch, on one line, and the chart draws no arrow', async ({ page }) => {
    const pivot = rowBySymbol[SEC_SYMBOL].se_pivot_price, bars = heldBars(structuredClone(charts[`${SEC_SYMBOL}.json`].bars));
    const event = crossingEvent({ state: 'zone', asOf: date, pivot, upper: pivot * 1.05, close: pivot, prevClose: pivot, change: 0, volumeRatio: 1 }, bars);
    expect(event.kind).toBe('afterTouch');
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { mutate: HELD_TOUCH });
    await expect(conclusion(page).locator('strong')).toHaveText(event.title);
    await expect(conclusion(page)).toHaveClass(/tone-wait/);
    await expect(conclusion(page)).toContainText(event.note);
    await expect(page.getByTestId('brief-price-chart').locator('svg rect.bc-up').first()).toBeAttached();
    await expect(page.getByTestId('brief-price-chart').locator('.bc-breakout')).toHaveCount(0);
    await settled(page);
    const title = await titleFit(page);
    expect(title.lines).toBe(1);
    expect(title.slack).toBeGreaterThanOrEqual(6);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('round 2: the RS-only title at 320px', () => {
  test.use({ ...phoneDevice(320, 640), contextOptions: { reducedMotion: 'reduce' } });
  test('takes two lines at 320 (four at step 0), and nothing overflows', async ({ page }) => {
    for (const symbol of ['ZZHW', 'ZZZF']) {
      const { errors } = await openBrief(page, `#/brief/stock/${symbol}`);
      await expect(conclusion(page).locator('strong')).toHaveText('TT 1条件未達 — 買いの対象外');
      await settled(page);
      expect((await titleFit(page)).lines, symbol).toBe(2);
      expect(await horizontalOverflow(page)).toBe(0);
      expect(errors).toEqual([]);
    }
  });
});

/** The conclusion's chip lines and the slack after the last chip on each (the line box's width less what it uses). */
const chipLines = page => conclusion(page).locator('.brief-tags').evaluate(root => {
  const box = root.getBoundingClientRect(), rows = new Map();
  for (const chip of root.children) { const b = chip.getBoundingClientRect(); rows.set(Math.round(b.top), Math.max(rows.get(Math.round(b.top)) ?? 0, b.right - box.left)); }
  return { lines: rows.size, slack: Math.min(...[...rows.values()].map(used => box.width - used)) };
});

test.describe('round 2: ZZNV at 390×844', () => {
  test.use({ ...phoneDevice(390, 844), contextOptions: { reducedMotion: 'reduce' } });
  test('the conclusion grows 24px or less (step 0: 307, with 12px of headroom) and the first screen still shows the call, the periods, the readout and the price panel', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await expect(page.getByTestId('brief-fundamentals').getByText(/^出典：SEC XBRL/)).toBeVisible();
    await page.getByTestId('brief-price-chart').locator('svg rect.bc-up, svg rect.bc-down').first().waitFor({ state: 'attached' });
    await settled(page);
    expect((await callBox(page)).card).toBeLessThanOrEqual(307 + 24 - 12);
    // §3's first screen: the call, the period segment, the readout and the top of the price panel above the dock.
    const dock = await page.locator('.brief-dock').boundingBox();
    const call = await conclusion(page).boundingBox(), chart = await page.getByTestId('brief-price-chart').boundingBox();
    const periods = await page.locator('.brief-periods').boundingBox(), readout = await page.locator('.brief-readout').first().boundingBox();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    for (const [name, box] of [['conclusion', call], ['periods', periods], ['readout', readout]]) expect(box.y + box.height, name).toBeLessThan(dock.y);
    expect(chart.y).toBeLessThan(dock.y);
    // The conclusion's chips stay on two lines with 6px of slack (the stage chip's 日足から算出 is in its title below 768px).
    const chips = await chipLines(page);
    expect(chips.lines).toBeLessThanOrEqual(2);
    expect(chips.slack).toBeGreaterThanOrEqual(6);
    await expect(conclusion(page).locator('.brief-chip').first()).toHaveAttribute('title', /日足から算出/);
    expect(errors).toEqual([]);
  });

  test('with an industry rank the chips keep the three lines they took at step 0, each with 6px of slack', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { mutate: INDUSTRY });
    await expect(conclusion(page).locator('.brief-chip', { hasText: '業種 12位（推計・基準日未確認）' })).toBeVisible();
    await settled(page);
    const chips = await chipLines(page);
    expect(chips.lines).toBeLessThanOrEqual(3);
    expect(chips.slack).toBeGreaterThanOrEqual(6);
    expect(errors).toEqual([]);
  });
});
