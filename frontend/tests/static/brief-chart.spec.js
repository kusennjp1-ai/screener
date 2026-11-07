// Daily brief stock chart on synthetic data: the period segment and the readout above the chart, the honest
// weekly label, the touch scrub, the legend colours, the 12px floor, the 44px targets and the phone budgets;
// round 2: no label over another label, a tag or the last price, the final contraction's depth, the date
// ticks, the RS panel, one earnings count, the pivot crossing, ADR and the unverified readout.
import { test, expect } from '@playwright/test';
import { date, horizontalOverflow, openBrief, rowBySymbol, VIEWPORTS } from './brief-fixture.js';
import { chartCrossing, crossingNote } from '../../src/static/brief/chartReadout.js';

const DOCK_TOP = 788; // 844 − the 56px dock at 390×844
// Measure only after the finite animations finish (the last price's pulse repeats for ever).
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => null))));
const chartReady = page => expect(page.getByTestId('brief-price-chart').locator('svg rect.bc-up, svg rect.bc-down').first()).toBeAttached();
/** Rows the readout takes (its items' distinct tops). */
const readoutRows = page => page.locator('.brief-readout').evaluate(node => new Set([...node.querySelectorAll('.ro-item')].map(item => Math.round(item.getBoundingClientRect().top))).size);
/** Every visible text in the chart card below 12px, SVG text scaled to the screen. */
const smallText = page => page.locator('.brief-chartcard').evaluate(card => {
  const small = [];
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!node.textContent.trim() || !element.getClientRects().length || element.closest('.sr-only')) continue;
    const svg = element.closest('svg');
    const scale = svg ? svg.getBoundingClientRect().width / svg.viewBox.baseVal.width : 1;
    const size = parseFloat(getComputedStyle(element).fontSize) * scale;
    if (size < 11.95) small.push(`${node.textContent.trim().slice(0, 20)} ${size.toFixed(1)}`);
  }
  return small;
});
// A rising RS line (price ÷ a flat benchmark) for the rs_line hook.
const withRsLine = charts => { for (const chart of Object.values(charts)) chart.rs_line = chart.bars.map(bar => ({ time: bar.date, value: bar.close / 50 })); };
/**
 * A heavy-volume break of the 50-day line nine sessions ago with the close still under the line (Track E's
 * fixture for a broken setup, as in brief-watch.spec.js): the bars before it are lifted 15%, the session before
 * it closes at its 50-day high and the break day trades 2.2 times the prior 50-day average. The last close
 * stays the row's price, so the bars stay certified and the 50-day sell check fires.
 */
function breakBelow50(bars) {
  const n = bars.length, at = n - 9;
  for (let i = 0; i < at; i++) for (const key of ['open', 'high', 'low', 'close']) bars[i][key] *= 1.15;
  const top = Math.max(...bars.slice(at - 50, at - 1).map(bar => bar.close));
  Object.assign(bars[at - 1], { open: top, close: top, high: top * 1.005, low: top * 0.995 });
  bars[at].volume = Math.round(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * 2.2);
}
// The same charts at about $1,300 (the rows are not scaled, so these bars are not certified: display only).
const scaled = charts => { withRsLine(charts); for (const chart of Object.values(charts)) chart.bars = chart.bars.map(b => ({ ...b, open: b.open * 12, high: b.high * 12, low: b.low * 12, close: b.close * 12 })); };
/** The card's hard cap and the 12px of headroom under it (plan §3, rule 9): the card is 508px or less. */
const CARD_CAP = 520, CARD_LINE = CARD_CAP - 12;
/** Lines of the legend's shown items (their distinct tops). */
const legendLines = page => page.locator('.brief-legend').evaluate(node => new Set([...node.children].filter(item => !item.hidden && item.getClientRects().length).map(item => Math.round(item.getBoundingClientRect().top))).size);
/** Each readout line's horizontal slack: its width less its items and gaps (one row each, so it never wraps). */
const readoutSlack = page => page.locator('.brief-readout').evaluate(node => [...node.querySelectorAll('.ro-line')].map(line => {
  const items = [...line.children].filter(item => item.getClientRects().length), gap = parseFloat(getComputedStyle(line).columnGap) || 0;
  return line.getBoundingClientRect().width - items.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0) - gap * Math.max(0, items.length - 1);
}));
/**
 * Label collisions in the chart: every in-plot label's box (its text's width, 12px around its centre) against
 * every other label, every right-axis tag (price tags, 安値, RS新高値, the earnings flag), the last price's dot and
 * the marks (the crossing's arrow, the sell signs); and the axis column's own boxes (RS新高値 against the
 * earnings flag) against each other.
 */
const collisions = page => page.getByTestId('brief-price-chart').evaluate(chart => {
  const labels = [...chart.querySelectorAll('.bc-levelnote, .bc-malabel, .bc-ttext, .bc-legtext, .bc-zonetext, .bc-notice, .bc-breakouttext, .bc-rscaption')]
    .filter(node => node.getAttribute('visibility') !== 'hidden' && node.textContent.trim())
    .map(node => { const box = node.getBBox(), centre = Number(node.getAttribute('y')) - 4; return { name: node.textContent, x0: box.x, x1: box.x + box.width, y0: centre - 6, y1: centre + 6 }; });
  const solid = [...chart.querySelectorAll('.bc-tag rect, .bc-rshigh rect, .bc-earnflag rect, .bc-lastdot, .bc-breakoutmark, .bc-sell')]
    .map(node => { const box = node.getBBox(); return { name: node.closest('[data-tag]')?.dataset.tag || node.getAttribute('class'), x0: box.x, x1: box.x + box.width, y0: box.y, y1: box.y + box.height }; });
  const hit = (a, b) => a.x0 < b.x1 - 0.5 && a.x1 > b.x0 + 0.5 && a.y0 < b.y1 - 0.5 && a.y1 > b.y0 + 0.5;
  const out = [];
  labels.forEach((a, i) => { for (const b of [...labels.slice(i + 1), ...solid]) if (hit(a, b)) out.push(`${a.name} × ${b.name}`); });
  const column = solid.filter(box => box.name === 'bc-rstag-fill' || box.name === 'bc-earnflag-fill');
  column.forEach((a, i) => { for (const b of column.slice(i + 1)) if (hit(a, b)) out.push(`${a.name} × ${b.name}`); });
  return out;
});
/** Every drawn level line (買値, 2R, 3R, 52週高, the wide chart's structural low) has its name drawn. */
const unnamedLevels = page => page.getByTestId('brief-price-chart').evaluate(chart => ['bc-entry', 'bc-r2', 'bc-r3', 'bc-high52']
  .filter(cls => chart.querySelectorAll(`line.${cls}`).length !== [...chart.querySelectorAll(`.${cls}-text`)].filter(node => node.textContent.trim() && node.getAttribute('visibility') !== 'hidden').length));
/** The 注記 key of each foldable legend item (chartNotes): a folded item's mark is still explained. */
const NOTE_KEYS = { low: '「安値」＝最後の収縮の安値 ', breakout: 'の矢印＝終値がピボットを上抜けた日', heavydown: '■＝下落日の大商い', sell: '▼＝上昇の加速、▲＝崩れ', lows: '点線＝収縮の安値を結んだ線', boxes: '枠＝値幅の収縮', pivot: '緑の破線＝ピボット', stop: '赤の点線＝損切り', ma10: '10＝10日線', ema21: '21＝21日EMA' };
/** Folded legend items whose key the 注記 does not give. */
const unexplainedFolds = page => page.evaluate(keys => {
  const notes = document.querySelector('.brief-screen-notes')?.textContent ?? '';
  return [...document.querySelectorAll('.brief-legend > span[hidden]')].map(item => item.dataset.key).filter(key => !keys[key] || !notes.includes(keys[key]));
}, NOTE_KEYS);
/** The last contraction's depth on the chart (under its box, or combined 「T2 −7%」 above it): null when it is missing, undefined without contractions. */
const finalDepth = page => page.getByTestId('brief-price-chart').evaluate(chart => {
  const last = Math.max(...[...chart.querySelectorAll('.bc-leg')].map(node => Number(node.dataset.leg)));
  if (!Number.isFinite(last)) return undefined;
  const node = chart.querySelector(`.bc-legtext[data-i="${last}"]`) || chart.querySelector(`.bc-tlabel[data-leg="${last}"] .bc-tdepth`);
  return node ? node.textContent : null;
});
/** No ASCII hyphen directly before a digit in the card's visible text, outside ISO dates (rule 11). */
const asciiMinus = page => page.locator('.brief-chartcard').evaluate(card => (card.innerText.replace(/\d{4}-\d{2}-\d{2}/g, '').match(/.{0,8}-\d.{0,4}/g) || []));
/** The 390×844 chart budget: the readout in 3 rows or fewer, the card 508px or less, the legend 2 lines or fewer. */
async function withinBudget(page, what) {
  expect(await readoutRows(page), `${what}: readout rows`).toBeLessThanOrEqual(3);
  expect((await page.locator('.brief-chartcard').boundingBox()).height, `${what}: card height`).toBeLessThanOrEqual(CARD_LINE);
  expect(await legendLines(page), `${what}: legend lines`).toBeLessThanOrEqual(2);
  expect(await smallText(page), `${what}: text under 12px`).toEqual([]);
}
/** A pivot crossing two sessions back on ZZNV (its pivot is its close) with every close since at or above the pivot. */
const crossOnZZNV = charts => {
  const bars = charts['ZZNV.json'].bars, p = bars.at(-1).close;
  Object.assign(bars.at(-3), { open: p * 0.988, close: p * 0.99, high: p * 0.995, low: p * 0.985 });
  Object.assign(bars.at(-2), { open: p * 0.995, close: p * 1.005, high: p * 1.008, low: p * 0.993 });
};
/** The published RS-line high, dated for the analysis date (plan §2.3), on every row. */
const rsHighRows = rows => { for (const row of rows) row.rs_line_high = { value: true, leading: false, as_of_date: date }; };

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`${name} ${device.viewport.width}px`, () => {
  test.use(device);
  const phone = name === 'phone';

  test('the weekly period says how many weeks it draws and shows the weekly chart', async ({ page }) => {
    // Reached from Today's focus row (on a wide screen the stock opens beside the list), after 3か月.
    const { errors } = await openBrief(page, '#/brief');
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    const target = phone ? 'ZZNV' : 'ZZKS';
    const row = focus.locator(`[data-symbol="${target}"]`);
    if (phone) await row.tap(); else await row.click();
    await expect(page).toHaveURL(new RegExp(`#/brief/stock/${target}$`));
    const chart = page.getByTestId('brief-price-chart');
    const periods = page.getByRole('group', { name: '表示期間' });
    await periods.getByRole('button', { name: '3か月' }).click();
    await expect(periods.getByRole('button', { name: '3か月' })).toHaveAttribute('aria-pressed', 'true');
    // The fixture has 280 sessions, under two years of weeks: the label never claims 週足2年.
    const weekly = periods.getByRole('button', { name: /^週足/ });
    await expect(weekly).toHaveText(/^週足（\d+週）$/);
    const weeks = Number((await weekly.textContent()).match(/\d+/)[0]);
    expect(weeks).toBeLessThan(104);
    await weekly.click();
    await expect(chart).toHaveAttribute('aria-label', new RegExp(`^${target} の週足チャート（.*〜${date}）`));
    await expect(chart.locator('.bc-notice').first()).toHaveText(new RegExp(`^週足は直近${weeks}週分（\\d{4}/\\d{2}〜）。$`));
    await expect(page.locator('.brief-legend')).toContainText('10週線');
    expect(errors).toEqual([]);
  });

  test('the next stock keeps the chosen period for the session', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV');
    await chartReady(page);
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: '1年' }).click();
    await page.goto('/#/brief/stock/ZZAR');
    await chartReady(page);
    await expect(page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: '1年' })).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });
});

test.describe('390×844 phone', () => {
  test.use({ ...VIEWPORTS.phone, contextOptions: { reducedMotion: 'reduce' } });

  // ZZMO carries a sell mark (a heavy-volume 50-day break, the one Track E's checks fire on), so its legend has the ▼▲ item.
  for (const symbol of ['ZZNV', 'ZZAR', 'ZZMO']) test(`${symbol}: the periods, the readout and the top of the chart are on the first screen, within the card budget on every view`, async ({ page }) => {
    const charts = served => { withRsLine(served); if (symbol === 'ZZMO') breakBelow50(served['ZZMO.json'].bars); };
    const { errors } = await openBrief(page, `#/brief/stock/${symbol}`, { mutate: { charts, rows: rsHighRows } });
    await chartReady(page);
    await settled(page);
    const periods = await page.getByRole('group', { name: '表示期間' }).boundingBox();
    const readout = await page.locator('.brief-readout').boundingBox();
    const chart = await page.getByTestId('brief-price-chart').boundingBox();
    expect(periods.y + periods.height).toBeLessThanOrEqual(DOCK_TOP);
    expect(readout.y + readout.height).toBeLessThanOrEqual(DOCK_TOP);
    expect(chart.y + 60).toBeLessThanOrEqual(DOCK_TOP);
    await withinBudget(page, `${symbol} 6か月`);
    // The sell marks' key stays on the legend (a folded key would still be explained in the 注記).
    if (symbol === 'ZZMO') await expect(page.locator('.brief-legend [data-key="sell"]')).toBeVisible();
    if (symbol === 'ZZMO') await expect(page.locator('.brief-legend [data-key="sell"]')).toHaveText('▼▲売りのサイン');
    for (const button of await page.getByRole('group', { name: '表示期間' }).getByRole('button').all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
    // The current price is tagged on the right axis, outlined in the body text colour.
    const close = (await page.locator('.brief-readout .ro-item').filter({ hasText: /^終/ }).textContent()).slice(1);
    await expect(page.locator('[data-tag="last"] .bc-tagtext')).toHaveText(close);
    if (symbol === 'ZZAR') expect(close).toBe('110.88');
    // The RS panel's caption is 「RS線」; the legend, always visible, keeps RS線, RS推計 and IBD RS apart.
    await expect(page.locator('.bc-rscaption')).toHaveText('RS線');
    await expect(page.locator('.brief-legend [data-key="rs"]')).toHaveText('株価÷S&P 500・RS推計やIBD RSとは別');
    await expect(page.locator('.brief-legend [data-key="rs"]')).toBeVisible();
    // The weekly view and a selected bar stay within the same budget; 最新足 is a 44px target in the plot.
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: /^週足/ }).click();
    await chartReady(page);
    await withinBudget(page, `${symbol} 週足`);
    await expect(page.locator('.brief-readout .ro-date')).toHaveText(/^\d\d\/\d\d週$/);
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: '6か月' }).click();
    await chartReady(page);
    const box = await page.getByTestId('brief-price-chart').boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.55, box.y + 60);
    await expect(page.getByRole('button', { name: '最新足' })).toBeVisible();
    await withinBudget(page, `${symbol} tapped`);
    const latest = await page.getByRole('button', { name: '最新足' }).boundingBox();
    expect(latest.height).toBeGreaterThanOrEqual(44);
    expect(latest.x).toBeGreaterThanOrEqual(box.x);
    expect(latest.x + latest.width).toBeLessThanOrEqual(box.x + box.width);
    expect(latest.y).toBeGreaterThanOrEqual(box.y);
    expect(errors).toEqual([]);
  });

  // Every period on each stock: no label over another label, a tag or the last price; the last contraction's
  // depth; 3 date labels or more; the RS caption clear of the 新高値 tag; the readout's lines with 6px to spare.
  for (const symbol of ['ZZNV', 'ZZAR', 'ZZMO']) test(`${symbol}: every period draws its labels without a collision, with the final depth and 3 dates or more`, async ({ page }) => {
    const charts = served => { withRsLine(served); if (symbol === 'ZZMO') breakBelow50(served['ZZMO.json'].bars); };
    const { errors } = await openBrief(page, `#/brief/stock/${symbol}`, { mutate: { charts, rows: rsHighRows } });
    await chartReady(page);
    for (const label of ['3か月', '6か月', '1年', /^週足/]) {
      await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label }).click();
      await chartReady(page);
      await settled(page);
      const what = `${symbol} ${label}`;
      expect(await collisions(page), `${what}: collisions`).toEqual([]);
      const depth = await finalDepth(page);
      if (symbol !== 'ZZMO') expect(depth, `${what}: contractions drawn`).not.toBeUndefined();
      if (depth !== undefined) expect(depth, `${what}: final depth`).toMatch(/−\d+%$/);
      expect(await page.locator('.bc-date').count(), `${what}: date labels`).toBeGreaterThanOrEqual(3);
      // The new high is a tag in the axis column, clear of the caption.
      const tag = await page.locator('.bc-rshigh rect').boundingBox(), caption = await page.locator('.bc-rscaption').boundingBox(), plot = await page.getByTestId('brief-price-chart').boundingBox();
      await expect(page.locator('.bc-rshigh .bc-rstext')).toHaveText('RS新高値');
      expect(tag.x, `${what}: RS新高値 in the axis column`).toBeGreaterThan(plot.x + plot.width - 70);
      expect(tag.x > caption.x + caption.width || tag.y > caption.y + caption.height || tag.y + tag.height < caption.y, `${what}: caption and tag apart`).toBe(true);
      // The structural low is a 「安値」 tag on a phone, its price in the legend.
      if (await page.locator('[data-tag="low"]').count()) await expect(page.locator('.brief-legend [data-key="low"]')).toHaveText(/^最後の収縮の安値 [\d,]+\.\d{2}$/);
      await expect(page.locator('.bc-structural-text')).toHaveCount(0);
      const high = page.locator('.bc-high52-text');
      if (await high.count()) await expect(high).toHaveText(/^52週高 [\d,.]+$/);
      // A level line is never drawn unnamed, and a folded legend item's mark is keyed in the 注記.
      expect(await unnamedLevels(page), `${what}: unnamed level lines`).toEqual([]);
      expect(await unexplainedFolds(page), `${what}: folded legend items without a 注記 key`).toEqual([]);
      await withinBudget(page, what);
      for (const slack of await readoutSlack(page)) expect(slack, `${what}: readout slack`).toBeGreaterThanOrEqual(6);
      expect(await asciiMinus(page), `${what}: U+2212`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });

  test('ZZNV at about $1,300 keeps every label apart and the readout in 3 rows with 6px to spare', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { charts: scaled } });
    await chartReady(page);
    for (const label of ['3か月', '6か月', '1年', /^週足/]) {
      await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label }).click();
      await chartReady(page);
      await settled(page);
      expect(await collisions(page), String(label)).toEqual([]);
      for (const slack of await readoutSlack(page)) expect(slack, `${label}: readout slack`).toBeGreaterThanOrEqual(6);
    }
    expect(errors).toEqual([]);
  });

  test('the 10-day and 21-day lines on 3か月 only, without their values in the readout, the card still within budget', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { charts: withRsLine } });
    await chartReady(page);
    const chart = page.getByTestId('brief-price-chart');
    await expect(chart.locator('.bc-ma10, .bc-ema21')).toHaveCount(0);
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: '3か月' }).click();
    await expect(chart.locator('.bc-ma10, .bc-ema21')).toHaveCount(2);
    await settled(page);
    expect(await page.locator('.bc-ma10').evaluate(node => getComputedStyle(node).strokeWidth)).toBe('1px');
    await expect(page.locator('.brief-readout')).not.toContainText(/10日|21日/);
    await withinBudget(page, 'ZZNV 3か月');
    for (const label of ['1年', /^週足/]) {
      await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label }).click();
      await chartReady(page);
      await expect(chart.locator('.bc-ma10, .bc-ema21')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  test('a pivot crossing on certified bars is marked under its bar and named in the legend; none on unverified bars', async ({ page }) => {
    let bars = null;
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { charts: served => { withRsLine(served); crossOnZZNV(served); bars = served['ZZNV.json'].bars; } } });
    await chartReady(page);
    const chart = page.getByTestId('brief-price-chart');
    await expect(chart.locator('.bc-breakout')).toHaveCount(1);
    // The crossing as the chart's own helper reads it from the served bars (its volume ratio comes from the crossing
    // helper, so the 注記 is asserted through crossingNote, never as a literal of another track's ratio).
    const crossing = chartCrossing(bars, rowBySymbol.ZZNV.se_pivot_price);
    expect(crossing?.tone).toBe('neutral');
    const day = await chart.locator('.bc-breakout').getAttribute('data-date');
    expect(day < date).toBe(true);
    await expect(chart).toHaveAttribute('aria-label', new RegExp(`ピボットを上抜けた日 ${day}`));
    // The crossing day traded under 1.4× (or its ratio is unknown), so it is unconfirmed: a grey hollow arrow, never the filled ▲
    // of the 崩れ sell sign, keyed (visibly) in the legend by the same grey glyph and explained in the 注記.
    const item = page.locator('.brief-legend [data-key="breakout"]');
    await expect(item).toBeVisible();
    await expect(item).toHaveText('上抜け');
    await expect(chart.locator('.bc-breakout')).toHaveAttribute('data-tone', 'neutral');
    await expect(item.locator('svg.lg-breakoutglyph')).not.toHaveClass(/is-zone/);
    const mark = await chart.locator('.bc-breakoutmark').evaluate(node => ({ d: node.getAttribute('d'), fill: getComputedStyle(node).fill, stroke: getComputedStyle(node).stroke, surface: getComputedStyle(node.closest('.brief-chartcard')).getPropertyValue('--surface').trim() }));
    expect(mark.d).not.toMatch(/h10l-5,-8z$/);
    expect(mark.stroke).not.toBe(mark.fill);
    const glyph = await item.locator('svg path').evaluate(node => getComputedStyle(node).stroke);
    expect(glyph).toBe(mark.stroke);
    await expect(page.locator('.brief-screen-notes')).toContainText(crossingNote(crossing));
    expect(await collisions(page)).toEqual([]);
    // The weekly chart marks the crossing's week.
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: /^週足/ }).click();
    await chartReady(page);
    await expect(chart.locator('.bc-breakout')).toHaveCount(1);
    expect(await collisions(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('bars not certified for the analysis date: the readout says 未検証の足 and qualifies the change and the ratio; no crossing mark', async ({ page }) => {
    // ZZZF's scan price no longer matches its last close, so its bars are not certified.
    const rows = served => { const row = served.find(r => r.symbol === 'ZZZF'); row.current_price = Math.round(row.current_price * 1.01 * 100) / 100; };
    const { errors } = await openBrief(page, '#/brief/stock/ZZZF', { mutate: { rows, charts: withRsLine } });
    await chartReady(page);
    await settled(page);
    const readout = page.locator('.brief-readout');
    await expect(readout.locator('.ro-unverified')).toHaveText(/^未検証の足/);
    // The chip's title is the chart's sentence with the certification's reason (not this spec's copy) in brackets.
    await expect(readout.locator('.ro-unverified')).toHaveAttribute('title', /^分析基準日の日足として検証できていません（.+）$/);
    await expect(readout.locator('.ro-change')).toHaveText(/^[+−±]\d+\.\d%（未検証）$/);
    await expect(readout).toContainText(/\d\.\d{2}×（未検証）/);
    await expect(readout.locator('.ro-adr')).toHaveText(/^ADR —/);
    await expect(readout).not.toContainText('対ピボット');
    await expect(page.getByTestId('brief-price-chart').locator('.bc-breakout')).toHaveCount(0);
    await withinBudget(page, 'ZZZF unverified');
    for (const slack of await readoutSlack(page)) expect(slack, 'ZZZF readout slack').toBeGreaterThanOrEqual(6);
    expect(errors).toEqual([]);
  });

  test('a stock at about $1,300 keeps the readout in 3 rows, with whole-number prices as on the tags', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { charts: scaled } });
    await chartReady(page);
    await settled(page);
    await withinBudget(page, 'ZZNV ×12');
    await expect(page.locator('.brief-readout .ro-item').filter({ hasText: /^終/ })).toHaveText(/^終\d,\d{3}$/);
    expect(errors).toEqual([]);
  });

  test('a touch on the chart moves the readout to that bar, keeps it after release and 最新足 brings it back', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV');
    await chartReady(page);
    await settled(page);
    const readout = page.locator('.brief-readout');
    await expect(readout).toHaveAttribute('aria-label', '最新の足の値');
    await expect(readout).toContainText('10/02');
    await expect(page.getByRole('button', { name: '最新足' })).toHaveCount(0);
    const box = await page.getByTestId('brief-price-chart').boundingBox();
    await page.touchscreen.tap(box.x + 30, box.y + 100);
    await expect(readout).toHaveAttribute('aria-label', /^選んだ足（\d\d\/\d\d）の値$/);
    const chosen = await readout.getAttribute('aria-label');
    await expect(readout).not.toContainText('10/02');
    // Released: the value stays.
    await page.waitForTimeout(400);
    await expect(readout).toHaveAttribute('aria-label', chosen);
    const latest = page.getByRole('button', { name: '最新足' });
    expect((await latest.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await latest.click();
    await expect(readout).toHaveAttribute('aria-label', '最新の足の値');
    await expect(readout).toContainText('10/02');
    expect(errors).toEqual([]);
  });
});

// One earnings count on the stock screen: the chart reads the screen's earnings call, counted from today's New
// York date. ZZNV reports on 10/6; the page clock moves from 10/3 (あと3日) to the day (当日) and past it (経過).
const EARNINGS_DAY = '2026-10-06';
const withEarnings = rows => { rows.find(row => row.symbol === 'ZZNV').entry_evidence = { earnings: { date: EARNINGS_DAY } }; };
const CLOCKS = [['before', '2026-10-03T16:35:00Z', '決算 10/6 あと3日', true], ['on the day', '2026-10-06T16:00:00Z', '決算 10/6 当日', true], ['after', '2026-10-07T16:00:00Z', '決算 10/6 経過', false]];
for (const [name, device] of [['phone', VIEWPORTS.phone], ['desktop', VIEWPORTS.desktop]]) test.describe(`earnings marker on the ${name}`, () => {
  test.use({ ...device, contextOptions: { reducedMotion: 'reduce' } });
  for (const [when, clock, full, warn] of CLOCKS) test(`${when} the report: ${full}`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { rows: withEarnings, charts: withRsLine } });
    await page.clock.setFixedTime(new Date(clock));
    await page.reload();
    await chartReady(page);
    const chart = page.getByTestId('brief-price-chart');
    await expect(chart).toHaveAttribute('aria-label', new RegExp(`${full}。$`));
    if (when === 'after') await expect(chart).not.toHaveAttribute('aria-label', /あと/);
    if (name === 'phone') {
      // A compact flag in the RS panel's axis column, the full text in its title; the date axis keeps its ticks.
      await expect(chart.locator('.bc-earnflag')).toHaveAttribute('data-full', full);
      await expect(chart.locator('.bc-earnflag .bc-earnings')).toHaveText('E 10/6');
      await expect(chart.locator('.bc-earnflag.bc-earnings-soon')).toHaveCount(warn ? 1 : 0);
      // A passed report's flag is dimmed with a dashed border, never like a coming date; its 注記 key says 経過.
      await expect(chart.locator('.bc-earnflag.is-past')).toHaveCount(when === 'after' ? 1 : 0);
      const dash = await chart.locator('.bc-earnflag-fill').evaluate(node => getComputedStyle(node).strokeDasharray);
      expect(dash === 'none' || dash === '').toBe(when !== 'after');
      await expect(page.locator('.brief-screen-notes')).toContainText(`E 10/6＝${full}`);
      for (const label of ['3か月', '6か月', /^週足/]) {
        await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label }).click();
        await chartReady(page);
        expect(await page.locator('.bc-date').count(), String(label)).toBeGreaterThanOrEqual(3);
        expect(await collisions(page), String(label)).toEqual([]);
      }
    } else {
      await expect(chart.locator('.bc-earnings')).toHaveText(full);
      await expect(chart.locator('.bc-earnings-soon')).toHaveCount(warn ? 1 : 0);
    }
    expect(await chart.textContent()).not.toMatch(when === 'after' ? /あと/ : /経過/);
    expect(errors).toEqual([]);
  });
});

test.describe('1440×900 desktop', () => {
  test.use({ ...VIEWPORTS.desktop, contextOptions: { reducedMotion: 'reduce' } });

  test('the readout reads the 50-day distance and ADR (独自計算) on the latest certified bar', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { charts: withRsLine } });
    await chartReady(page);
    const readout = page.locator('.brief-readout');
    await expect(readout.locator('.ro-ma50')).toHaveText(/^50日 [\d,]+\.\d{2}（[+−±]\d+\.\d%）$/);
    await expect(readout.locator('.ro-adr')).toHaveText(/^ADR \d+\.\d%$/);
    expect(await readoutRows(page)).toBeLessThanOrEqual(2);
    await expect(page.locator('.brief-chart-notes')).toContainText('ADR（直近20日の高値÷安値−1の平均）・50日線からの乖離は独自計算です。');
    await expect(page.locator('.brief-legend [data-key="rs"]')).toHaveText('RS線＝株価÷S&P 500・RS推計やIBD RSとは別');
    // A past bar is not judged: no distance and no ADR.
    const box = await page.getByTestId('brief-price-chart').boundingBox();
    await page.mouse.click(box.x + 40, box.y + 120);
    await expect(readout).toHaveAttribute('aria-label', /^選んだ足/);
    await expect(readout.locator('.ro-dist, .ro-adr')).toHaveCount(0);
    expect(await asciiMinus(page)).toEqual([]);
    expect(await collisions(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the zone\'s name takes a candle-free spot along its top on 6か月, and every level line is named', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { charts: withRsLine } });
    await chartReady(page);
    await settled(page);
    const over = await page.getByTestId('brief-price-chart').evaluate(chart => {
      const label = chart.querySelector('.bc-zonetext');
      if (!label) return 'no zone label';
      const box = label.getBBox(), yc = Number(label.getAttribute('y')) - 4;
      const candles = [...chart.querySelectorAll('line.bc-up, line.bc-down, rect.bc-up, rect.bc-down')].map(node => node.getBBox());
      return candles.filter(c => c.x < box.x + box.width && c.x + Math.max(c.width, 1) > box.x && c.y < yc + 7 && c.y + c.height > yc - 7).length;
    });
    expect(over).toBe(0);
    expect(await unnamedLevels(page)).toEqual([]);
    expect(await collisions(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the readout sits beside the periods, so the chart and its volume panel start on the first screen', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV');
    await chartReady(page);
    const periods = await page.getByRole('group', { name: '表示期間' }).boundingBox();
    expect(periods.y + periods.height).toBeLessThanOrEqual(900);
    for (const button of await page.getByRole('group', { name: '表示期間' }).getByRole('button').all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(24);
    // One line under the periods would push the chart about 28px down; beside them the readout takes two
    // rows of 16px within the 32px buttons and costs no height. The volume panel's caption is on screen.
    for (const label of ['3か月', '6か月', '1年', /^週足/]) {
      await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label }).click();
      await chartReady(page);
      expect(await readoutRows(page), String(label)).toBeLessThanOrEqual(2);
      const readout = await page.locator('.brief-readout').boundingBox();
      expect(readout.y).toBeGreaterThanOrEqual(periods.y - 1);
      expect(readout.y + readout.height).toBeLessThanOrEqual(periods.y + periods.height + 1);
    }
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: '6か月' }).click();
    await chartReady(page);
    const caption = await page.locator('.bc-volcaption').boundingBox();
    expect(caption.y + caption.height).toBeLessThanOrEqual(900);
    // The pane scrolls on its own; a fade at its bottom says more follows.
    await expect(page.locator('.brief-right')).toHaveAttribute('data-more', '');
    expect(await smallText(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

for (const theme of ['light', 'dark']) test.describe(`the 10-day and 21-day swatches at 1440 in ${theme}`, () => {
  test.use({ ...VIEWPORTS.desktop, contextOptions: { reducedMotion: 'reduce' } });
  test('are the colours of their lines', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { storage: { 'screener:color-mode': theme } });
    await expect(page.locator('.brief')).toHaveAttribute('data-theme', theme);
    await chartReady(page);
    const pairs = await page.evaluate(() => [['ma10', '.bc-ma10'], ['ema21', '.bc-ema21']].map(([key, line]) => {
      const swatch = document.querySelector(`.brief-legend i.lg-${key}`), stroke = document.querySelector(`[data-testid="brief-price-chart"] ${line}`);
      return { key, swatch: swatch && getComputedStyle(swatch).borderTopColor, stroke: stroke && getComputedStyle(stroke).stroke };
    }));
    for (const pair of pairs) {
      expect(pair.swatch, pair.key).toBeTruthy();
      expect(pair.swatch, pair.key).toBe(pair.stroke);
    }
    expect(errors).toEqual([]);
  });
});

for (const theme of ['light', 'dark']) test.describe(`legend in ${theme}`, () => {
  test.use({ ...VIEWPORTS.phone, contextOptions: { reducedMotion: 'reduce' } });
  test('each legend swatch is the colour of its line', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { storage: { 'screener:color-mode': theme } });
    await expect(page.locator('.brief')).toHaveAttribute('data-theme', theme);
    await chartReady(page);
    // Only the items the legend shows (a folded one is keyed in the 注記, not by its swatch).
    const pairs = await page.evaluate(() => [['ma50', '.bc-ma50'], ['ma150', '.bc-ma150'], ['ma200', '.bc-ma200'], ['pivot', '.bc-pivot'], ['stop', '.bc-stop'], ['lows', '.bc-lows'], ['structural', '.bc-structural']].map(([key, line]) => {
      const swatch = document.querySelector(`.brief-legend i.lg-${key}`), stroke = document.querySelector(`[data-testid="brief-price-chart"] ${line}`);
      return { key, shown: Boolean(swatch && !swatch.closest('[hidden]') && swatch.getClientRects().length), swatch: swatch && getComputedStyle(swatch).borderTopColor, stroke: stroke && getComputedStyle(stroke).stroke };
    }));
    expect(pairs.filter(pair => pair.shown).map(pair => pair.key)).toEqual(expect.arrayContaining(['ma50', 'ma150', 'ma200']));
    for (const pair of pairs.filter(p => p.shown)) {
      expect(pair.stroke, pair.key).toBeTruthy();
      expect(pair.swatch, pair.key).toBe(pair.stroke);
    }
    expect(errors).toEqual([]);
  });
});

// The card's 520px cap is tightest at 320 (the readout takes 6 rows there): every view keeps the 12px headroom under it.
test.describe('the chart card at 320×640', () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, contextOptions: { reducedMotion: 'reduce' } });
  for (const [symbol, broken] of [['ZZNV', false], ['ZZSD', true]]) test(`${symbol}${broken ? ' (broken)' : ''} stays within 508px (12px under the 520 cap) on every period`, async ({ page }) => {
    const charts = served => { withRsLine(served); if (broken) breakBelow50(served[`${symbol}.json`].bars); };
    const { errors } = await openBrief(page, `#/brief/stock/${symbol}`, { mutate: { charts } });
    await chartReady(page);
    for (const label of ['3か月', '6か月', '1年', /^週足/]) {
      await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label }).click();
      await chartReady(page);
      await settled(page);
      expect((await page.locator('.brief-chartcard').boundingBox()).height, `${symbol} ${label}: card height`).toBeLessThanOrEqual(CARD_LINE);
      expect(await legendLines(page), `${symbol} ${label}: legend lines`).toBeLessThanOrEqual(2);
    }
    expect(errors).toEqual([]);
  });
});

for (const width of [320, 375, 414]) test.describe(`no overflow at ${width}px`, () => {
  test.use({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  test('every period of the chart stays within the width', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { charts: withRsLine } });
    await chartReady(page);
    for (const button of await page.getByRole('group', { name: '表示期間' }).getByRole('button').all()) {
      await button.click();
      await chartReady(page);
      expect(await horizontalOverflow(page), await button.textContent()).toBe(0);
      expect(await page.locator('.brief-chartcard').evaluate(card => card.scrollWidth - card.clientWidth)).toBeLessThanOrEqual(0);
      // No label runs past its own button either (the week count wraps on the narrowest phones).
      const spill = await page.getByRole('group', { name: '表示期間' }).evaluate(group => [...group.querySelectorAll('button')].filter(b => b.scrollWidth > b.clientWidth).map(b => b.textContent));
      expect(spill, await button.textContent()).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});

// The renderer is a lazy chunk (priceChartLoader.js): when it cannot be loaded (offline before the service worker had it,
// or a deploy replaced it), the chart's box says so with a 再読み込み button, never an empty frame. The browser keeps a
// failed module import for the page's life, so the button reloads the page, which then draws the chart.
test.describe('the chart when its renderer chunk fails to load', () => {
  // Finite animations (the cards' entrance) done, so a box is read where it settles, never mid-rise. Read by play state:
  // with no chart drawn, some entrances' `finished` promises never settle in this browser although they have finished.
  const settled = page => page.waitForFunction(() => document.getAnimations().every(a => a.effect?.getComputedTiming().iterations === Infinity || a.playState !== 'running'));
  test.use(VIEWPORTS.phone);
  test('says it cannot load the chart, keeps the box, offers a 44px reload, and draws after it', async ({ page }) => {
    let blocked = true;
    await page.route(/\/priceChart(-[\w-]+)?\.js(\?.*)?$/, route => (blocked ? route.abort() : route.fallback()));
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV');
    const card = page.locator('.brief-chartcard');
    const failed = card.locator('.brief-chart-failed');
    await expect(failed).toBeVisible();
    // The message is in a live region that was there before it (announced when it arrives); the box shows it with the button.
    await expect(card.getByRole('status')).toHaveText(/チャートを読み込めません/);
    await expect(failed).toContainText('チャートを読み込めません');
    const box = await card.getByTestId('brief-price-chart').boundingBox();
    expect(box.height).toBeGreaterThan(200);
    // Nothing describes marks that are not drawn: no legend, no chart notes in the 注記, and the period switch waits.
    await expect(card.locator('.brief-legend')).toBeHidden();
    for (const button of await card.getByRole('group', { name: '表示期間' }).getByRole('button').all()) await expect(button).toBeDisabled();
    await expect(page.locator('.brief-screen-notes li', { hasText: 'チャートの印' })).toHaveCount(0);
    const retry = failed.getByRole('button');
    await settled(page);
    // The CSS min-height is 44px; 0.1px of tolerance for sub-pixel layout, as Design Acceptance reads it.
    expect((await retry.boundingBox()).height + 0.1).toBeGreaterThanOrEqual(44);
    blocked = false;
    await Promise.all([page.waitForEvent('load'), retry.click()]);
    await expect(card.getByTestId('brief-price-chart')).toBeVisible();
    await expect(failed).toHaveCount(0);
    await expect(card.getByTestId('brief-price-chart').locator('svg').first()).toBeVisible();
    await expect(card.locator('.brief-legend')).toBeVisible();
    await expect(card.getByRole('group', { name: '表示期間' }).getByRole('button').first()).toBeEnabled();
    await expect(page.locator('.brief-screen-notes li', { hasText: 'チャートの印' })).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});
