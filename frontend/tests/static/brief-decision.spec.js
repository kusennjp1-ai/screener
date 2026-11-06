// Daily brief buy decision: the stock's conclusion, on synthetic data. Green means the trend template, the
// market, the earnings date and the day's event all allow a new buy; anything else is said in a neutral line.
// (The day's event titles, Today's focus tile under the market verdict and the verified day change in the bar
// and the desktop header are brief-rows.spec.js's; here the call's colour for those events is asserted.)
import { test, expect } from '@playwright/test';
import { openBrief, VIEWPORTS, rowBySymbol, SEC_SYMBOL, date, horizontalOverflow } from './brief-fixture.js';
import { conditionNote } from '../../src/static/missingCondition.js';

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
// The stock 3% above a pivot it crossed 25 sessions ago, still in the buy zone (the day before was above it too).
const STALE = (() => {
  const row = rowBySymbol[SEC_SYMBOL], pivot = Math.round(row.current_price / 1.03 * 100) / 100;
  return both(onRow(SEC_SYMBOL, r => { r.se_pivot_price = pivot; r.technical_audit.values.change = 1; }), onChart(SEC_SYMBOL, bars => {
    const n = bars.length;
    Object.assign(bars[n - 27], { open: pivot * 0.98, close: pivot * 0.98 }); fit(bars[n - 27]);
    for (let i = n - 26; i < n - 1; i++) { if (bars[i].close < pivot * 1.005) Object.assign(bars[i], { open: pivot * 1.006, close: pivot * 1.006 }); fit(bars[i]); }
  }));
})();
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

  test('a heavy down day in the zone prints no buy range and its tiles read 参考', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { mutate: HEAVY_DOWN });
    await expect(conclusion(page)).toHaveAttribute('data-gate', 'heavyDown');
    await expect(conclusion(page)).toHaveClass(/tone-ext/);
    await expect(conclusion(page)).toContainText('新規の買いは見送ります（独自判定）');
    await expect(conclusion(page)).not.toContainText('買いの範囲です');
    await expect(conclusion(page).locator('.brief-tilequal')).toHaveText(['参考', '参考', '参考']);
    await expect(page.getByRole('region', { name: /^建て玉と損切りの計画/ }).getByRole('heading', { level: 2 })).toContainText('参考（下落日の大商い）');
    expect(errors).toEqual([]);
  });

  test('a breakout still in the zone 25 sessions on waits for the next pivot, its tiles 参考', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { mutate: STALE });
    await expect(conclusion(page).locator('strong')).toHaveText('上抜けから25営業日・伸びずに停滞（新規は次のピボット待ち）');
    await expect(conclusion(page)).toHaveClass(/tone-wait/);
    await expect(conclusion(page)).toContainText('停滞の判定は10営業日超（独自判定）');
    await expect(conclusion(page)).not.toContainText('買いの範囲です');
    await expect(conclusion(page).locator('.brief-tilequal')).toHaveText(['参考', '参考', '参考']);
    // A variant: its 3-line title is paid from the stock screen's allowance (step 0: 3056px; verdict +80).
    await settled(page);
    expect(await page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY))).toBeLessThanOrEqual(3056 + 80);
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
    // The sell card names it among the broken setups.
    await expect(page.getByTestId('brief-sell').locator('.is-sell-hit').first()).toBeVisible();
    await expect(page.getByTestId('brief-sell')).toContainText(/で上抜け、\d+\/\d+ にピボットの下へ/);
    expect(errors).toEqual([]);
  });

  test('a Setup Engine base at confidence 31 makes the pivot a reference: neutral, 参考, the confidence named', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { mutate: WEAK_BASE });
    await expect(conclusion(page).locator('strong')).toHaveText('土台を確認できない — ピボットは参考（独自判定）');
    await expect(conclusion(page)).toHaveClass(/tone-neutral/);
    await expect(conclusion(page).locator('.brief-call-status p').first()).toHaveText(/^信頼度 31（基準55）。位置は参考：/);
    await expect(conclusion(page).locator('.brief-tilequal')).toHaveText(['参考', '参考', '参考']);
    await expect(page.getByRole('region', { name: /^建て玉と損切りの計画/ }).getByRole('heading', { level: 2 })).toContainText('参考（土台未確認）');
    expect(errors).toEqual([]);
  });

  test('no figure on the conclusion, the template, the plan or the sell card writes a minus with the ASCII hyphen', async ({ page }) => {
    for (const mutate of [undefined, HEAVY_DOWN, failedBreakout(SEC_SYMBOL)]) {
      const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, mutate ? { mutate } : {});
      await expect(conclusion(page).locator('strong')).toBeVisible();
      for (const card of [conclusion(page), page.locator('[aria-labelledby="brief-tt-title"]'), page.getByRole('region', { name: /^建て玉と損切りの計画/ }), page.getByTestId('brief-sell')]) {
        const text = (await card.innerText()).replace(/\d{4}-\d{2}-\d{2}/g, '');
        expect(text).not.toMatch(/-\d/);
      }
      expect(errors).toEqual([]);
    }
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

test.describe('round 2: ZZNV at 390×844', () => {
  test.use({ ...phoneDevice(390, 844), contextOptions: { reducedMotion: 'reduce' } });
  test('the conclusion grows 24px or less (step 0: 307) and the first screen still shows the call, the periods, the readout and the price panel', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await expect(page.getByTestId('brief-fundamentals').getByText(/^出典：SEC XBRL/)).toBeVisible();
    await page.getByTestId('brief-price-chart').locator('svg rect.bc-up, svg rect.bc-down').first().waitFor({ state: 'attached' });
    await settled(page);
    expect((await callBox(page)).card).toBeLessThanOrEqual(307 + 24);
    // §3's first screen: the call, the period segment, the readout and the top of the price panel above the dock.
    const dock = await page.locator('.brief-dock').boundingBox();
    const call = await conclusion(page).boundingBox(), chart = await page.getByTestId('brief-price-chart').boundingBox();
    const periods = await page.locator('.brief-periods').boundingBox(), readout = await page.locator('.brief-readout').first().boundingBox();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    for (const [name, box] of [['conclusion', call], ['periods', periods], ['readout', readout]]) expect(box.y + box.height, name).toBeLessThan(dock.y);
    expect(chart.y).toBeLessThan(dock.y);
    // The conclusion's chips stay on two lines with 6px of slack.
    const chips = await conclusion(page).locator('.brief-tags').evaluate(root => {
      const box = root.getBoundingClientRect(), rows = new Map();
      for (const chip of root.children) { const b = chip.getBoundingClientRect(); rows.set(Math.round(b.top), Math.max(rows.get(Math.round(b.top)) ?? 0, b.right - box.left)); }
      return { lines: rows.size, slack: Math.min(...[...rows.values()].map(used => box.width - used)) };
    });
    expect(chips.lines).toBeLessThanOrEqual(2);
    expect(chips.slack).toBeGreaterThanOrEqual(6);
    expect(errors).toEqual([]);
  });
});
