// Round 2's cross-track invariants (plan §7 I4(d)), on the merged app and synthetic data: Today shows one wording per
// stock, a failed breakout counts in the watch tile, 「あと0」 appears nowhere, and the stock screen says one earnings
// count. Each surface's copy belongs to its track; this spec compares the surfaces with each other and asserts no
// track's wording as a literal (plan §1 rule 14), only counts and the absence of 「あと0」 and of 「あと」 after a date.
import { test, expect } from '@playwright/test';
import { charts, date, openBrief, rowBySymbol, VIEWPORTS } from './brief-fixture.js';
import { sellChipView } from '../../src/static/brief/briefSell.js';
import { BASE_UNCHECKED_CHIP, BASE_UNCHECKED_NOTE, LIST_FILTERS, rowEvent, TOUCH_HELD_NOTE } from '../../src/static/brief/briefCandidate.js';

const phone = (width, height = 812) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const fit = bar => { bar.high = Math.max(bar.high, bar.open, bar.close); bar.low = Math.min(bar.low, bar.open, bar.close); };
const onRow = (symbol, fn) => ({ rows: rows => { fn(rows.find(r => r.symbol === symbol)); }, details: details => { for (const detail of Object.values(details)) if (detail.symbol === symbol) fn(detail); } });
/** The focus row closes above its pivot instead of on it (the synthetic day is +2.0% on 1.6× volume): a breakout. */
const crossing = symbol => onRow(symbol, row => { row.se_pivot_price = Math.round(row.current_price * 0.99 * 100) / 100; });
/** A pivot 2% above the price, crossed four sessions ago on 2.2× the prior 50-day volume, then closes back under it. */
const failedBreakout = symbol => {
  const pivot = Math.round(rowBySymbol[symbol].current_price * 1.02 * 100) / 100;
  return { ...onRow(symbol, row => { row.se_pivot_price = pivot; }),
    charts: served => {
      const bars = served[`${symbol}.json`].bars, n = bars.length, at = n - 4;
      Object.assign(bars[at - 1], { open: pivot * 0.985, close: pivot * 0.985 }); fit(bars[at - 1]);
      Object.assign(bars[at], { open: pivot * 0.99, close: pivot * 1.01 }); fit(bars[at]);
      for (const i of [at + 1, at + 2]) { Object.assign(bars[i], { open: pivot * 0.99, close: pivot * 0.985 }); fit(bars[i]); }
      bars[at].volume = Math.ceil(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * 2.2);
    } };
};
/** A heavy-volume break of the 50-day line nine sessions ago with the close still under the line. */
const broken = symbol => ({ charts: served => {
  const bars = served[`${symbol}.json`].bars, n = bars.length, at = n - 9;
  for (let i = 0; i < at; i++) for (const key of ['open', 'high', 'low', 'close']) bars[i][key] *= 1.15;
  const top = Math.max(...bars.slice(at - 50, at - 1).map(bar => bar.close));
  Object.assign(bars[at - 1], { open: top, close: top, high: top * 1.005, low: top * 0.995 });
  bars[at].volume = Math.ceil(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * 2.2);
} });
const WATCH = ['ZZNV', 'ZZZF', 'QQQX', 'ZZSD', 'ZZKS'];
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => null))));
const stripGlyph = text => text.replace(/^[^\p{L}\p{N}+−-]+/u, '').trim();

test.describe('Today shows one wording per stock', () => {
  test.use(phone(390, 844));
  for (const [name, mutate] of [['the fixture', undefined], ['a breakout on a watched focus candidate', crossing('ZZNV')]]) test(`${name}: a watched focus candidate reads the same on its focus row, its watch row and the watch tab`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': WATCH }, mutate });
    const focus = page.getByRole('region', { name: '注目候補' }), watch = page.getByRole('region', { name: 'ウォッチの状況' });
    await expect(focus.getByTestId('brief-candidate').first()).toBeVisible();
    await expect(watch.locator('[data-symbol]').first()).toBeVisible();
    const focusChips = Object.fromEntries(await focus.getByTestId('brief-candidate').evaluateAll(nodes => nodes.map(node => [node.dataset.symbol, node.querySelector('.brief-reasons > .brief-chip').textContent])));
    const watchRows = Object.fromEntries(await watch.locator('[data-symbol]').evaluateAll(nodes => nodes.map(node => [node.dataset.symbol, node.textContent])));
    const both = Object.keys(focusChips).filter(symbol => symbol in watchRows);
    expect(both.length, 'a watched stock among the focus rows').toBeGreaterThan(0);
    for (const symbol of both) expect(watchRows[symbol], symbol).toContain(stripGlyph(focusChips[symbol]));
    await page.goto('/#/brief/watch');
    const rows = page.getByRole('region', { name: 'ウォッチ中の銘柄' }).getByTestId('brief-candidate');
    await expect(rows.first()).toBeVisible();
    const tabChips = Object.fromEntries(await rows.evaluateAll(nodes => nodes.map(node => [node.dataset.symbol, node.querySelector('.brief-reasons > .brief-chip').textContent])));
    for (const symbol of both) expect(tabChips[symbol], symbol).toBe(focusChips[symbol]);
    expect(errors).toEqual([]);
  });
});

// A watched focus candidate whose setup broke (a failed breakout, a heavy 50-day break) reads the watch card's 崩れ chip on
// its focus row too, with no green there, as on the watch card and the watch tab (the chip's text is sellChipView's).
test.describe('Today shows a broken watched focus candidate one way', () => {
  test.use(phone(390, 844));
  const brokenChip = key => sellChipView({ strength: [], weakness: [{ key, label: key, state: 'hit', detail: key }] }).text;
  for (const [name, mutate, key] of [['a failed breakout', failedBreakout('ZZNV'), 'failedBreakout'], ['a heavy 50-day break', broken('ZZNV'), 'ma50']]) test(`${name}: the focus row, the watch card and the watch tab carry the same chip, the focus row no green`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': WATCH }, mutate });
    const focus = page.getByRole('region', { name: '注目候補' }), watch = page.getByRole('region', { name: 'ウォッチの状況' });
    const row = focus.locator('[data-testid="brief-candidate"][data-symbol="ZZNV"]');
    await expect(row).toBeVisible();
    await expect(row.locator('.brief-reasons')).toContainText(brokenChip(key));
    expect(await row.locator('.tone-zone').count(), 'no green chip on a broken setup\'s focus row').toBe(0);
    await expect(watch.locator('[data-symbol="ZZNV"]')).toContainText(brokenChip(key));
    await page.goto('/#/brief/watch');
    const tab = page.getByRole('region', { name: 'ウォッチ中の銘柄' }).locator('[data-testid="brief-candidate"][data-symbol="ZZNV"]');
    await expect(tab.locator('.brief-reasons')).toContainText(brokenChip(key));
    expect(await tab.locator('.tone-zone').count()).toBe(0);
    expect(errors).toEqual([]);
  });
});

// A stock whose conclusion is 参考 for a reason the rows can read (its Setup Engine base under the floor or not current, or
// a market that holds off new buying) has no green chip on any row, while the rows keep their place and the counts.
test.describe('no green row beside a 参考 conclusion the row can read', () => {
  test.use(phone(390, 844));
  const weakBase = { rows: rows => { for (const row of rows) row.se_pattern_confidence = 31; } };
  test('a Setup Engine base under the floor: Today, 候補 and ウォッチ rows have no green, in the same order, and the conclusion is 参考', async ({ page, context }) => {
    const plain = await context.newPage(), quiet = await openBrief(plain, '#/brief', { storage: { 'research-watch': WATCH } });
    const symbolsOf = on => on.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate').evaluateAll(nodes => nodes.map(node => node.dataset.symbol));
    await expect(plain.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate').first()).toBeVisible();
    const order = await symbolsOf(plain), tiles = await plain.getByTestId('brief-summary').textContent();
    expect(await plain.locator('[data-testid="brief-candidate"] .tone-zone').count(), 'the fixture\'s current base keeps its green').toBeGreaterThan(0);
    expect(quiet.errors).toEqual([]);
    await plain.close();
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': WATCH }, mutate: weakBase });
    await expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate').first()).toBeVisible();
    expect(await symbolsOf(page)).toEqual(order);
    // The counts keep their text (membership is unchanged), but with every focus row 参考 the 注目候補 tile is not green.
    expect(await page.getByTestId('brief-summary').textContent()).toBe(tiles);
    await expect(page.getByTestId('brief-summary').locator(':scope > li').nth(1)).not.toHaveClass(/tone-zone/);
    expect(await page.locator('[data-testid="brief-candidate"] .tone-zone, .brief-event-icon.tone-zone').count()).toBe(0);
    // Each grey row says why in its own words (the rows' word, the conclusion's reason in its title), and Today's notes say it too.
    const focusRows = page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate');
    for (const row of await focusRows.all()) await expect(row.locator('.brief-reasons')).toContainText(BASE_UNCHECKED_CHIP);
    expect(await page.locator('.brief-screen-notes li').allTextContents()).toContain(BASE_UNCHECKED_NOTE);
    for (const hash of ['#/brief/list', '#/brief/watch']) {
      await page.goto(`/${hash}`);
      await expect(page.getByTestId('brief-candidate').first()).toBeVisible();
      expect(await page.locator('[data-testid="brief-candidate"] .tone-zone').count(), hash).toBe(0);
    }
    await page.goto(`/#/brief/stock/${order[0]}`);
    const conclusion = page.getByTestId('brief-conclusion');
    await expect(conclusion).toBeVisible();
    await expect(conclusion).not.toHaveClass(/tone-zone/);
    expect(errors).toEqual([]);
  });
});

// The exporter computes a row's audit from the bars it publishes, so the analysis day's volume ratio is one number: the row's
// chip, the conclusion's title and the chart readout read the same ratio (the fixture serves them consistently).
test.describe('the analysis day reads one volume ratio', () => {
  test.use(phone(390, 844));
  test('a breakout on a focus candidate: the row, the conclusion and the readout name the same ratio', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { mutate: crossing('ZZNV') });
    const row = page.getByRole('region', { name: '注目候補' }).locator('[data-testid="brief-candidate"][data-symbol="ZZNV"]');
    await expect(row).toBeVisible();
    const ratio = text => text.match(/(\d+\.\d\d)×/)?.[1] ?? null;
    const rowRatio = ratio(await row.locator('.brief-reasons > .brief-chip').first().textContent());
    expect(rowRatio).not.toBeNull();
    await row.click();
    const conclusion = page.getByTestId('brief-conclusion');
    await expect(conclusion).toBeVisible();
    expect(ratio(await conclusion.locator('strong').first().textContent())).toBe(rowRatio);
    const readout = page.locator('.brief-chartcard .ro-ratio').first();
    await expect(readout).toBeVisible();
    expect(ratio(await readout.textContent())).toBe(rowRatio);
    expect(errors).toEqual([]);
  });
});

// A close at the pivot's cents the day before is a touch only when the closes before it were under the pivot, and the rows
// have no bars to tell it from a pullback onto the pivot after an earlier breakout. So the row is never green or dated there
// (rowEvent's own short form), Today's 「うち上抜け」 leaves it out and the 上抜け filter counts it as 未確認, while the conclusion
// and the chart read the bars: the analysis day's breakout after a touch from below, the earlier breakout after a pullback
// (dated on the same bar, in the same tone), and never 「上回っていない」 after a close above the pivot.
test.describe('a close at the pivot\'s cents the day before', () => {
  test.use(phone(375));
  const md = iso => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}`, cent = value => Math.round(value * 100) / 100;
  const price = rowBySymbol.ZZNV.current_price, under = cent(price / 1.02);
  const shortForm = kind => rowEvent({ asOf: date, event: { kind } });
  // ZZNV: the pivot at the close before the analysis day (the fixture's day is +2.0% on 1.6×), the close before that under it.
  const touched = {
    ...onRow('ZZNV', row => { row.se_pivot_price = under; }),
    charts: served => { const bars = served['ZZNV.json'].bars, n = bars.length; Object.assign(bars[n - 3], { open: cent(bars[n - 2].close * 0.98), close: cent(bars[n - 2].close * 0.98) }); fit(bars[n - 3]); },
  };
  // A breakout `ago` sessions back on 2.0× the prior 50-day volume, closes above the pivot since, then the close before the
  // analysis day back on the pivot's cent: with `pivot` under the price the analysis day closes above it again, with the
  // price as the pivot (the fixture's own) it closes on the cent a second time.
  const pulledBack = (ago, pivot) => ({
    ...onRow('ZZNV', row => { row.se_pivot_price = pivot; }),
    charts: served => {
      const bars = served['ZZNV.json'].bars, n = bars.length, at = n - 1 - ago;
      Object.assign(bars[at - 1], { open: cent(pivot * 0.98), close: cent(pivot * 0.98) }); fit(bars[at - 1]);
      for (let i = at; i <= n - 3; i++) { Object.assign(bars[i], { open: cent(pivot * 1.015), close: cent(pivot * 1.02) }); fit(bars[i]); }
      Object.assign(bars[n - 2], { close: pivot }); fit(bars[n - 2]);
      bars[at].volume = Math.ceil(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * 2);
    },
  });
  /** Today's ZZNV focus row, the 上抜け link and filter, then the stock: its conclusion and the chart's breakout mark. */
  async function surfaces(page, mutate) {
    const { errors } = await openBrief(page, '#/brief', { mutate });
    const row = page.getByRole('region', { name: '注目候補' }).locator('[data-testid="brief-candidate"][data-symbol="ZZNV"]');
    await expect(row).toBeVisible();
    const chip = row.locator('.brief-reasons > .brief-chip').first();
    const out = { errors, chip: stripGlyph(await chip.textContent()), chipClass: await chip.getAttribute('class'), link: await page.getByTestId('brief-breakout-link').count() };
    await page.goto('/#/brief/list');
    await page.getByRole('combobox', { name: '条件で絞り込む' }).selectOption('breakout');
    out.filter = await page.locator('.brief-filterchip').textContent();
    out.listed = await page.locator('[data-testid="brief-candidate"][data-symbol="ZZNV"]').count();
    out.listNote = await page.locator('.brief-card .brief-note').first().textContent();
    await page.goto('/#/brief/stock/ZZNV');
    const conclusion = page.getByTestId('brief-conclusion');
    await expect(conclusion).toBeVisible();
    await expect(page.getByTestId('brief-price-chart').locator('svg rect.bc-up').first()).toBeAttached();
    // Every case here has one breakout mark (the chart's own reading of the same bars).
    await expect(page.getByTestId('brief-price-chart').locator('.bc-breakout')).toHaveCount(1);
    Object.assign(out, { conclusionClass: await conclusion.getAttribute('class'), title: await conclusion.locator('strong').first().textContent(), text: await conclusion.textContent(),
      marks: await page.getByTestId('brief-price-chart').locator('.bc-breakout').evaluateAll(els => els.map(el => ({ date: el.dataset.date, tone: el.dataset.tone }))) });
    return out;
  }
  /** The row: rowEvent's short form, never green; Today's 上抜け link absent; the 上抜け filter counts it as 未確認 and leaves it out. */
  const rowUndated = (seen, kind) => {
    expect(seen.chip).toBe(shortForm(kind).text);
    expect(seen.chipClass).not.toMatch(/tone-zone/);
    expect(seen.link, 'no 「うち上抜け」 for it').toBe(0);
    expect(seen.listed).toBe(0);
    if (kind === 'undated') {
      expect(seen.filter).toMatch(/未確認[1-9]/);
      expect(seen.listNote).toContain(LIST_FILTERS.breakout.why);
    }
  };

  test('after a touch from below, the conclusion and the chart date the analysis day\'s breakout; the row says 未確認', async ({ page }) => {
    const seen = await surfaces(page, touched);
    rowUndated(seen, 'undated');
    expect(seen.conclusionClass).toMatch(/tone-zone/);
    expect(seen.title.startsWith(`${md(date)}に上抜け`)).toBe(true);
    expect(seen.marks).toEqual([{ date, tone: 'zone' }]);
    expect(seen.errors).toEqual([]);
  });

  for (const [ago, tone] of [[5, 'zone'], [12, 'neutral']]) test(`after a pullback onto the cent ${ago} sessions after a breakout, the conclusion dates the breakout the chart marks`, async ({ page }) => {
    const seen = await surfaces(page, pulledBack(ago, under));
    rowUndated(seen, 'undated');
    expect(seen.marks).toHaveLength(1);
    expect(seen.marks[0].tone).toBe(tone);
    expect(seen.marks[0].date < date).toBe(true);
    // Green only for the dated breakout on its volume within the stale window, as the arrow; never the analysis day's breakout.
    expect(seen.conclusionClass.includes('tone-zone')).toBe(tone === 'zone');
    expect(seen.title).not.toContain(md(date));
    if (tone === 'zone') expect(seen.title.startsWith(`${md(seen.marks[0].date)}に上抜け`)).toBe(true);
    else expect(seen.title).toMatch(new RegExp(`^上抜けから${ago}営業日`));
    expect(seen.errors).toEqual([]);
  });

  test('two closes on the cent after a breakout: the conclusion dates that breakout, never that no close went above the pivot', async ({ page }) => {
    const seen = await surfaces(page, pulledBack(4, price));
    rowUndated(seen, 'touchHeld');
    expect(seen.marks).toEqual([{ date: seen.marks[0].date, tone: 'zone' }]);
    expect(seen.conclusionClass).toMatch(/tone-zone/);
    expect(seen.title.startsWith(`${md(seen.marks[0].date)}に上抜け`)).toBe(true);
    expect(seen.text).not.toContain(TOUCH_HELD_NOTE);
    expect(seen.errors).toEqual([]);
  });
});

// A watched focus row whose sell checks are still loading holds its green (no chip, no layout change), so a broken setup never
// reads as a buy first and flips to 崩れ when its check lands.
test.describe('a watched focus row waits for its sell checks before any green', () => {
  test.use(phone(390, 844));
  test('a broken watched focus candidate has no green while its chart loads, then its 崩れ chip, at the same height', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', { storage: { 'research-watch': WATCH }, mutate: broken('ZZNV') });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const files = new Set(Object.keys(charts));
    await page.route(url => files.has(url.pathname.split('/').pop()), async route => { await gate; await route.fallback(); });
    await page.goto('/#/brief');
    await page.reload();
    const row = page.getByRole('region', { name: '注目候補' }).locator('[data-testid="brief-candidate"][data-symbol="ZZNV"]');
    await expect(row).toBeVisible();
    await settled(page);
    expect(await row.locator('.tone-zone').count(), 'no green while the check loads').toBe(0);
    const before = (await row.boundingBox()).height;
    release();
    const brokenChip = sellChipView({ strength: [], weakness: [{ key: 'ma50', label: 'ma50', state: 'hit', detail: 'ma50' }] }).text;
    await expect(row.locator('.brief-reasons')).toContainText(brokenChip);
    expect(await row.locator('.tone-zone').count()).toBe(0);
    expect(Math.abs((await row.boundingBox()).height - before)).toBeLessThan(0.5);
    // An unwatched focus row, never checked, is not held.
    expect(await page.getByRole('region', { name: '注目候補' }).locator('[data-testid="brief-candidate"]:not([data-symbol="ZZNV"]):not([data-symbol="ZZKS"]) .tone-zone').count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});

test.describe('a failed breakout counts in the watch tile', () => {
  test.use(phone(375));
  test('the same watch list reads one more broken setup with a failed breakout than without it', async ({ page, context }) => {
    const watch = { 'research-watch': ['ZZAR'] };
    const tile = on => on.getByTestId('brief-summary').getByRole('link', { name: /ウォッチの注意/ }).locator('b');
    const count = async on => Number((await tile(on).textContent()).match(/(\d+)件/)?.[1]);
    const plain = await context.newPage(), quiet = await openBrief(plain, '#/brief', { storage: watch });
    await expect(tile(plain)).toHaveText(/\d+件/);
    const before = await count(plain);
    expect(quiet.errors).toEqual([]);
    await plain.close();
    const { errors } = await openBrief(page, '#/brief', { storage: watch, mutate: failedBreakout('ZZAR') });
    await expect(tile(page)).toHaveText(/\d+件/);
    expect(await count(page)).toBe(before + 1);
    expect(errors).toEqual([]);
  });
});

// Every screen, with unknown conditions (ZZZF), a broken setup and a failed breakout among the watched stocks.
const NO_ZERO = { charts: served => { broken('ZZSD').charts(served); failedBreakout('ZZAR').charts(served); }, ...onRow('ZZAR', row => { row.se_pivot_price = Math.round(rowBySymbol.ZZAR.current_price * 1.02 * 100) / 100; }) };
// 「あと0」 that claims nothing is left (あと0条件, あと0%, あと0.0%); a real gap of a tenth or more (あと0.1%) is a value.
const zeroLeft = page => page.evaluate(() => {
  const found = [], zero = /あと0(?!\.\d*[1-9])/;
  if (zero.test(document.body.textContent)) found.push(`text: ${document.body.textContent.match(/.{0,20}あと0(?!\.\d*[1-9]).{0,10}/)[0]}`);
  for (const node of document.querySelectorAll('[aria-label], [title]')) for (const attr of ['aria-label', 'title']) if (zero.test(node.getAttribute(attr) || '')) found.push(`${attr}: ${node.getAttribute(attr).slice(0, 40)}`);
  return found;
});
for (const [name, device] of [['phone', phone(375)], ['desktop', VIEWPORTS.desktop]]) test.describe(`「あと0」 appears nowhere on the ${name}`, () => {
  test.use(device);
  const open = (page, hash) => openBrief(page, hash, { storage: { 'research-watch': [...WATCH, 'ZZAR'] }, mutate: NO_ZERO });
  test('Today and the watch tab', async ({ page }) => {
    const { errors } = await open(page, '#/brief');
    await expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate').first()).toBeVisible();
    expect(await zeroLeft(page), 'Today').toEqual([]);
    await page.goto('/#/brief/watch');
    await expect(page.getByRole('region', { name: 'ウォッチ中の銘柄' }).getByTestId('brief-candidate').first()).toBeVisible();
    expect(await zeroLeft(page), 'watch').toEqual([]);
    expect(errors).toEqual([]);
  });
  test('every list filter', async ({ page }) => {
    const { errors } = await open(page, '#/brief/list');
    const filters = page.getByRole('group', { name: '絞り込み' });
    await expect(page.getByTestId('brief-candidate').first()).toBeVisible();
    for (const button of await filters.getByRole('button').all()) {
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(await zeroLeft(page), `list ${await button.textContent()}`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
  test('every market tab', async ({ page }) => {
    const { errors } = await open(page, '#/brief/market');
    await expect(page.locator('.market-history-explorer svg').first()).toBeAttached();
    expect(await zeroLeft(page), 'market').toEqual([]);
    const tabs = page.getByRole('tablist', { name: '市場タブの表示' }).getByRole('tab');
    for (const tab of name === 'phone' ? await tabs.all() : []) {
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      expect(await zeroLeft(page), `market ${await tab.textContent()}`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
  for (const symbol of ['ZZNV', 'ZZZF', 'ZZAR', 'ZZSD', 'ZZHW']) test(`the stock ${symbol}`, async ({ page }) => {
    const { errors } = await open(page, `#/brief/stock/${symbol}`);
    await expect(page.getByTestId('brief-price-chart').locator('svg rect.bc-up').first()).toBeAttached();
    expect(await zeroLeft(page), symbol).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// ZZNV reports on 10/6. Before the date every surface of the stock screen that counts the days says one number; on and
// after the date none counts days (none says 「あと」 before a number of days).
const withEarnings = rows => { rows.find(row => row.symbol === 'ZZNV').entry_evidence = { earnings: { date: '2026-10-06' } }; };
const CLOCKS = [['3 days before', '2026-10-03T16:35:00Z', 3], ['the day before', '2026-10-05T16:00:00Z', 1], ['on the day', '2026-10-06T16:00:00Z', null], ['after', '2026-10-07T16:00:00Z', null]];
const earningsCounts = page => page.evaluate(() => {
  const texts = [document.querySelector('#brief-main')?.textContent || ''];
  for (const node of document.querySelectorAll('#brief-main [aria-label], #brief-main [title], #brief-main [data-full]')) for (const attr of ['aria-label', 'title', 'data-full']) texts.push(node.getAttribute(attr) || '');
  const counts = [];
  for (const text of texts) for (const match of text.matchAll(/決算[^。、\n]{0,14}?(?:あと|まで)\s*(\d+)日(?!以内|以上|未満|前)/g)) counts.push(Number(match[1]));
  return { counts, after: texts.some(text => /決算[^。、\n]{0,14}?あと\s*\d+日(?!以内|以上|未満|前)/.test(text)) };
});
for (const [name, device] of [['phone', phone(390, 844)], ['desktop', VIEWPORTS.desktop]]) test.describe(`one earnings count on the stock screen (${name})`, () => {
  test.use({ ...device, contextOptions: { reducedMotion: 'reduce' } });
  for (const [when, clock, days] of CLOCKS) test(`${when} the report`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { rows: withEarnings } });
    await page.clock.setFixedTime(new Date(clock));
    await page.reload();
    await expect(page.getByTestId('brief-price-chart').locator('svg rect.bc-up').first()).toBeAttached();
    await settled(page);
    const { counts, after } = await earningsCounts(page);
    if (days === null) {
      expect(after, 'no day count on or after the date').toBe(false);
    } else {
      expect(counts.length, 'the screen counts the days').toBeGreaterThan(0);
      expect([...new Set(counts)], 'one number').toEqual([days]);
    }
    expect(errors).toEqual([]);
  });
});
