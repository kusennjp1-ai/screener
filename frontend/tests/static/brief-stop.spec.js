// Daily brief sell card: the stop row 仮の損切りに到達（保有なら） (BEH-1, plan S2-P6), on synthetic data opened by mutators (the
// fixture stays frozen). The row is a holder's fact beside the sell checks: never a sign, never counted.
import { test, expect } from '@playwright/test';
import { chartSettled, openBrief, rowBySymbol, SEC_SYMBOL } from './brief-fixture.js';

const phone = width => ({ viewport: { width, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, contextOptions: { reducedMotion: 'reduce' } });
const desktop = { viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' } };
const cent = value => Math.round(value * 100) / 100;
const fit = bar => { bar.high = Math.max(bar.high, bar.open, bar.close); bar.low = Math.min(bar.low, bar.open, bar.close); };
const average = (bars, at) => bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50;
const onRow = (symbol, fn) => ({ rows: rows => { fn(rows.find(r => r.symbol === symbol)); }, details: details => { for (const detail of Object.values(details)) if (detail.symbol === symbol) fn(detail); } });

/**
 * ZZAR with a pivot 2% over its price, broken out of four sessions before the analysis day (a close 0.5% over the pivot on
 * `ratio` times the prior 50-day volume), a wick to 8% under the pivot on the next session (under the provisional stop's
 * −7.0%), and closes back under the pivot since. The last close stays the row's price, so the bars still certify. On 1.0×
 * the failed-breakout check is clear (light volume): the stop row is the only fact. On 2.2× it is a counted sign as well.
 */
const STOP_SYMBOL = 'ZZAR';
const stopReached = ratio => {
  const pivot = cent(rowBySymbol[STOP_SYMBOL].current_price * 1.02);
  return { ...onRow(STOP_SYMBOL, row => { row.se_pivot_price = pivot; }), charts: served => {
    const bars = served[`${STOP_SYMBOL}.json`].bars, at = bars.length - 5;
    Object.assign(bars[at - 1], { open: pivot * 0.995, close: pivot * 0.995 }); fit(bars[at - 1]);
    Object.assign(bars[at], { open: pivot * 0.998, close: pivot * 1.005 }); fit(bars[at]);
    bars[at].volume = Math.ceil(average(bars, at) * ratio);
    Object.assign(bars[at + 1], { open: pivot * 0.995, close: pivot * 0.99 }); fit(bars[at + 1]);
    bars[at + 1].low = pivot * 0.92;
    Object.assign(bars[at + 2], { open: pivot * 0.985, close: pivot * 0.975 }); fit(bars[at + 2]);
  } };
};
/** ZZKS 6% over a pivot it crossed on the analysis day itself (the session before closes 1% under it): beyond the zone. */
const DAY_SYMBOL = 'ZZKS';
const analysisDayBreakout = () => {
  const pivot = cent(rowBySymbol[DAY_SYMBOL].current_price / 1.06);
  return { ...onRow(DAY_SYMBOL, row => { row.se_pivot_price = pivot; }), charts: served => {
    const bars = served[`${DAY_SYMBOL}.json`].bars, n = bars.length;
    Object.assign(bars[n - 2], { open: pivot * 0.985, close: pivot * 0.99 }); fit(bars[n - 2]);
  } };
};

const CLAUSE = '損切りの行：仮の損切りに到達しています（サインの件数には含めていません）。';
// At default settings the plan's stop prints the same as the row's level (D8): the row says so once, beside the level.
const LEVEL = /^仮の損切り \$\d+\.\d\d（ピボットの −7\.0%・独自設定・計画の損切りと同じ）・\d+\/\d+ の上抜けの後の最安値 \$\d+\.\d\d（\d+\/\d+）$/;
const sell = page => page.getByTestId('brief-sell');
/** Plan S2-P2's 「保有なら」 line under the level tiles (D10): on a 該当 row only, in the row's own words and number. */
const stopNote = page => page.getByTestId('brief-levels-stop');
const noteFor = async page => `保有なら：仮の損切り $${(await page.getByTestId('brief-sell-stop').locator('em').textContent()).match(/^仮の損切り \$(\d+\.\d\d)/)[1]} に到達しています（売りのカード）`;
const row = page => page.getByTestId('brief-sell-stop');
const note = page => sell(page).locator('.brief-note').first();
const folded = locator => locator.evaluate(node => Boolean(node.closest('details')));
/** The stock screen's content height, as brief-decision.spec.js measures it. */
const content = page => page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY));
// Plan S2-P6: a hit state must keep the stock screen under STOCK_CAP and STOCK_LINE (brief-decision.spec.js).
const STOCK_CAP = 3056 + 80 - 12;
/** The 該当 word: bold, one line, in the --neg ink, and no ▲ anywhere in the row. */
const hitWord = page => row(page).locator('.brief-stop-state').evaluate(node => {
  const probe = document.createElement('span'); probe.style.color = 'var(--neg)'; node.parentElement.appendChild(probe);
  const neg = getComputedStyle(probe).color; probe.remove();
  const style = getComputedStyle(node), range = document.createRange(); range.selectNodeContents(node);
  return { text: node.textContent, color: style.color === neg, weight: Number(style.fontWeight), lines: new Set([...range.getClientRects()].map(r => Math.round(r.top))).size };
});
// The plan settings as brief-plan.spec.js seeds them (key 'brief-plan'): stopPercent 5, and ZZSD's structural stop chosen
// (positionSizing.js reads `structuralSymbols`, which 「この位置を使う」 writes).
const PLAN_5 = { 'brief-plan': { account: 50000, riskPercent: 1.25, stopPercent: 5, capPercent: 25 } };
const STRUCT_SYMBOL = 'ZZSD';
const PLAN_STRUCT = { 'brief-plan': { account: 50000, riskPercent: 1.25, stopPercent: 7, capPercent: 25, structuralSymbols: [STRUCT_SYMBOL] } };
const plan = page => page.locator('.brief-plan');
/** The plan card's printed stop: the −1R price of its R bar. */
const planStop = async page => (await plan(page).locator('.brief-rbar .r-risk').textContent()).match(/−1R (\d+\.\d\d)/)[1];
/** The row's type sizes (D19): the line 14px, the measured detail 12px (nothing with a digit under 12px). */
const sizes = page => row(page).evaluate(node => ({ line: getComputedStyle(node.querySelector('li')).fontSize, detail: node.querySelector('em') ? getComputedStyle(node.querySelector('em')).fontSize : null }));

for (const [width, options] of [[375, phone(375)], [1440, desktop]]) test.describe(`the stop row at ${width}px`, () => {
  test.use(options);
  const wide = width >= 1024;

  test('stop reached with no other sign: 該当, the status says so in place of 「いま出ているサインはありません」, the counts stay 0', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${STOP_SYMBOL}`, { mutate: stopReached(1.0) });
    await chartSettled(page);
    await expect(row(page)).toHaveAttribute('data-state', 'hit');
    await expect(row(page)).toContainText('仮の損切りに到達（保有なら） 該当');
    await expect(row(page).locator('em')).toHaveText(LEVEL);
    expect(await folded(row(page))).toBe(false);
    expect(await hitWord(page)).toEqual({ text: '該当', color: true, weight: 700, lines: 1 });
    await expect(row(page)).not.toContainText('▲');
    expect(await sizes(page)).toEqual({ line: '14px', detail: '12px' });
    // No counted sign: the light breakout is clear, and the sentence is the stop clause alone.
    await expect(note(page)).toContainText(` ${CLAUSE}`);
    await expect(note(page)).not.toContainText('いま出ているサインはありません');
    await expect(note(page)).not.toContainText('件のサインが出ています');
    await expect(sell(page).locator('li').filter({ hasText: '出来高を伴う上抜け後のピボット割れ' })).toContainText('基準 1.40×未満');
    await expect(sell(page).locator('.is-sell-hit')).toHaveCount(0);
    // Not a sign anywhere else: no sell chip in the call, no ▲ 崩れ.
    await expect(page.getByTestId('brief-conclusion')).not.toContainText('崩れ（独自判定）');
    // Said beside the share count, under the tiles and outside every fold; the 銘柄 line gains no short form for it (D5 is for signs).
    await expect(stopNote(page)).toHaveText(await noteFor(page));
    expect(await stopNote(page).evaluate(node => Boolean(node.closest('[data-testid="brief-levels"]')) && !node.closest('details'))).toBe(true);
    await expect(page.getByTestId('brief-conclusion').locator('.brief-call-label')).toHaveText('銘柄');
    if (!wide) {
      const height = await content(page);
      console.log(JSON.stringify({ state: 'stop-alone', width, content: height, sell: await sell(page).evaluate(node => node.getBoundingClientRect().height) }));
      expect(height).toBeLessThanOrEqual(STOCK_CAP);
    }
    expect(errors).toEqual([]);
  });

  test('stop reached with a counted sign: 「n件のサインが出ています。」 stays and the stop clause follows it', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${STOP_SYMBOL}`, { mutate: stopReached(2.2) });
    await chartSettled(page);
    await expect(row(page)).toHaveAttribute('data-state', 'hit');
    await expect(note(page)).toContainText(new RegExp(` (\\d+)件のサインが出ています。${CLAUSE}`));
    // The counted sign is the failed breakout; the stop row is not one of them.
    await expect(sell(page).locator('li').filter({ has: page.locator('.is-sell-hit') }).filter({ hasText: '出来高を伴う上抜け後のピボット割れ' })).toHaveCount(1);
    const counted = Number((await note(page).textContent()).match(/ (\d+)件のサインが出ています/)[1]);
    expect(counted).toBe(await sell(page).locator('.is-sell-hit').count());
    expect(await folded(row(page))).toBe(false);
    await expect(stopNote(page)).toHaveText(await noteFor(page));
    if (!wide) {
      const height = await content(page);
      console.log(JSON.stringify({ state: 'stop-sign', width, content: height, sell: await sell(page).evaluate(node => node.getBoundingClientRect().height) }));
      expect(height).toBeLessThanOrEqual(STOCK_CAP);
    }
    expect(errors).toEqual([]);
  });

  test('a breakout on the analysis day: 判定なし with its reason, quiet (in the fold on a phone, in place when wide)', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${DAY_SYMBOL}`, { mutate: analysisDayBreakout() });
    await chartSettled(page);
    await expect(row(page)).toHaveAttribute('data-state', 'na');
    await expect(row(page)).toContainText('仮の損切りに到達（保有なら） 判定なし（上抜けは分析日・その後の日足はまだありません）');
    expect(await folded(row(page))).toBe(!wide);
    await expect(note(page)).not.toContainText('損切りの行');
    await expect(stopNote(page)).toHaveCount(0);
    if (!wide) await expect(sell(page).locator('summary')).toContainText(/／損切り判定なし$/);
    expect(errors).toEqual([]);
  });

  // D8: with another stop setting the row keeps its level and prints the plan's own stop beside it, each under its own name;
  // the plan's number is the plan card's printed stop.
  test('stopPercent 5 stored: 仮の損切り and 計画の損切り, two names and two numbers, the second the plan card\'s stop', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${STOP_SYMBOL}`, { mutate: stopReached(1.0), storage: PLAN_5 });
    await chartSettled(page);
    await expect(row(page)).toHaveAttribute('data-state', 'hit');
    const detail = await row(page).locator('em').textContent();
    const [, level, own] = detail.match(/^仮の損切り \$(\d+\.\d\d)（ピボットの −7\.0%・独自設定）／計画の損切り \$(\d+\.\d\d)（設定 −5\.0%）・\d+\/\d+ の上抜けの後の最安値 \$\d+\.\d\d（\d+\/\d+）・判定は仮の損切りで行います$/);
    expect(own).not.toBe(level);
    expect(await planStop(page)).toBe(own);
    await expect(plan(page)).toContainText('損切り幅 5.0%');
    expect(errors).toEqual([]);
  });

  // D8 through positionPlan's own structural path: ZZSD's structural stop applied as 「この位置を使う」 stores it.
  test('the structural stop applied: 「計画の損切り $109.12（構造 −5.3%）」 beside the row\'s level, the plan card\'s strings', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${STRUCT_SYMBOL}`, { storage: PLAN_STRUCT });
    await chartSettled(page);
    await expect(row(page)).toHaveAttribute('data-state', 'clear');
    const detail = await row(page).locator('em').textContent();
    const [, level, own, percent] = detail.match(/^仮の損切り \$(\d+\.\d\d)（ピボットの −7\.0%・独自設定）／計画の損切り \$(\d+\.\d\d)（構造 −(\d+\.\d)%）・/);
    expect([own, percent]).toEqual(['109.12', '5.3']);
    // The word judges the 仮の損切り, and the row says so after the measured low.
    expect(detail).toMatch(/・判定は仮の損切りで行います$/);
    expect(own).not.toBe(level);
    expect(await planStop(page)).toBe(own);
    await expect(plan(page)).toContainText(`損切り幅 ${percent}%（構造上の目安`);
    expect(errors).toEqual([]);
  });

  // A buy-zone stock whose breakout was days before the analysis day (ZZHB, the weekly-pattern oracle: 「9/28に上抜け・4営業日前」):
  // bars follow the breakout, so the reason is the app's rule for buy-zone stocks, never that no later bar exists.
  test('a buy-zone stock broken out days before reads 判定なし with the buy-zone rule as its reason', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZHB', { oracles: true });
    await chartSettled(page);
    await expect(page.getByTestId('brief-conclusion')).toContainText(/\d+\/\d+に上抜け・\d+営業日前/);
    await expect(row(page)).toHaveAttribute('data-state', 'na');
    await expect(row(page)).toContainText(/仮の損切りに到達（保有なら） 判定なし（買いゾーンの銘柄は判定しません・計画の買値は \d+\/\d+ 終値）$/);
    await expect(row(page)).not.toContainText('その後の日足はまだありません');
    expect(await folded(row(page))).toBe(!wide);
    await expect(stopNote(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a buy-zone stock reads 判定なし: the plan buys at the analysis day\'s close', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await chartSettled(page);
    await expect(row(page)).toHaveAttribute('data-state', 'na');
    await expect(row(page)).toContainText(/仮の損切りに到達（保有なら） 判定なし（計画の買値は \d+\/\d+ 終値・その後の日足はまだありません）/);
    expect(await folded(row(page))).toBe(!wide);
    await expect(stopNote(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('the sell card with the stop row\'s summary segment at 375px', () => {
  test.use(phone(375));
  // The state brief-sell.spec.js pins (≤ 232.5): the fold's summary gains 「／損切り判定なし」 on one line.
  test('keeps the closed card within its allowance, the summary on one line', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    const summary = sell(page).locator('summary');
    await expect(summary).toContainText(/^サインなし \d+件・判定なし \d+件／損切り判定なし$/);
    // The summary text's line boxes: its character rects grouped by top (a new line starts a font size or more lower).
    const lines = await summary.locator('.brief-expander-summary').evaluate(node => {
      const size = parseFloat(getComputedStyle(node).fontSize), tops = [], walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) for (let i = 0; i < t.length; i++) {
        const range = document.createRange(); range.setStart(t, i); range.setEnd(t, i + 1);
        const rect = range.getBoundingClientRect(); if (rect.width > 0) tops.push(rect.top);
      }
      return tops.reduce((lines, top) => (lines.some(line => Math.abs(line - top) < size) ? lines : [...lines, top]), []).length;
    });
    const height = await sell(page).evaluate(node => node.getBoundingClientRect().height);
    console.log(JSON.stringify({ state: 'pinned-quiet', sell: height, summaryLines: lines }));
    expect(lines).toBe(1);
    expect(height).toBeLessThanOrEqual(228.5 + 16 - 12);
    expect(errors).toEqual([]);
  });
});

// D17 in both themes (set through storage 'screener:color-mode', as brief-call.spec.js does), on a 50% day and on the 0% day
// (every row under the 50-day line in a correction, brief-call.spec.js's below50Rows): the row's label, detail and glyph in a
// text ink, only 該当 in --neg, no ▲, and each at least 4.5:1 against the card.
const compose = (...parts) => Object.fromEntries([...new Set(parts.flatMap(Object.keys))].map(key => [key, value => { for (const part of parts) part[key]?.(value); }]));
const below50Rows = { rows: rows => { for (const r of rows) { r.market_above_50dma = false; r.market_regime = 'correction'; } } };
const DAYS = { '50%': { mutate: stopReached(1.0), line: '目安 最大50%' }, '0%': { mutate: compose(stopReached(1.0), below50Rows), line: '目安 0%' } };
const luminance = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const theme of ['light', 'dark']) for (const [width, options] of [[375, phone(375)], [1440, desktop]]) test.describe(`the stop row's inks in the ${theme} theme at ${width}px`, () => {
  test.use(options);
  for (const [day, { mutate, line }] of Object.entries(DAYS)) test(`stop reached on a ${day} day`, async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${STOP_SYMBOL}`, { mutate, storage: { 'screener:color-mode': theme } });
    await chartSettled(page);
    await expect(page.locator('.brief')).toHaveAttribute('data-theme', theme);
    await expect(page.getByTestId('brief-call-market')).toContainText(line);
    await expect(row(page)).toHaveAttribute('data-state', 'hit');
    await expect(row(page)).not.toContainText('▲');
    // The line under the tiles: a text ink (never --neg), 12px, at least 4.5:1 against the page.
    const noteInk = await stopNote(page).evaluate(node => {
      const probe = document.createElement('span'); node.appendChild(probe);
      const ink = name => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
      const inks = ['--text', '--text-2', '--text-3'].map(ink), neg = ink('--neg'); probe.remove();
      let ground = node; while (ground && /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(ground).backgroundColor)) ground = ground.parentElement;
      const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      return { inks, neg, color: getComputedStyle(node).color, rgb: rgb(getComputedStyle(node).color), ground: rgb(getComputedStyle(ground).backgroundColor), size: getComputedStyle(node).fontSize };
    });
    expect(noteInk.inks).toContain(noteInk.color);
    expect(noteInk.color).not.toBe(noteInk.neg);
    expect(noteInk.size).toBe('12px');
    expect(contrast(noteInk.rgb, noteInk.ground)).toBeGreaterThanOrEqual(4.5);
    const read = await row(page).evaluate(node => {
      const probe = document.createElement('span'); node.appendChild(probe);
      const ink = name => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
      const inks = ['--text', '--text-2', '--text-3'].map(ink), neg = ink('--neg');
      probe.remove();
      let ground = node;
      while (ground && /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(ground).backgroundColor)) ground = ground.parentElement;
      const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const of = el => ({ color: getComputedStyle(el).color, rgb: rgb(getComputedStyle(el).color), weight: Number(getComputedStyle(el).fontWeight) });
      const li = node.querySelector('li');
      return { inks, neg, ground: rgb(getComputedStyle(ground).backgroundColor), label: of(li.querySelector(':scope > span:not(.brief-check)')), detail: of(li.querySelector('em')),
        glyph: of(li.querySelector('.brief-check')), word: { ...of(li.querySelector('.brief-stop-state')), text: li.querySelector('.brief-stop-state').textContent } };
    });
    for (const part of ['label', 'detail', 'glyph']) {
      expect(read.inks, `${part} ${read[part].color}`).toContain(read[part].color);
      expect(read[part].color, part).not.toBe(read.neg);
      expect(contrast(read[part].rgb, read.ground), part).toBeGreaterThanOrEqual(4.5);
    }
    expect(read.word).toMatchObject({ text: '該当', color: read.neg, weight: 700 });
    expect(contrast(read.word.rgb, read.ground), 'word').toBeGreaterThanOrEqual(4.5);
    expect(errors).toEqual([]);
  });
});
