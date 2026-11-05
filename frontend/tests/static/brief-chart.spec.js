// Daily brief stock chart on synthetic data: the period segment and the readout above the chart, the honest
// weekly label, the touch scrub, the legend colours, the 12px floor, the 44px targets and the phone budgets.
import { test, expect } from '@playwright/test';
import { date, horizontalOverflow, openBrief, VIEWPORTS } from './brief-fixture.js';

const DOCK_TOP = 788; // 844 − the 56px dock at 390×844
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
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
// The same charts at about $1,300 (the rows are not scaled, so these bars are not certified: display only).
const scaled = charts => { withRsLine(charts); for (const chart of Object.values(charts)) chart.bars = chart.bars.map(b => ({ ...b, open: b.open * 12, high: b.high * 12, low: b.low * 12, close: b.close * 12 })); };
/** The 390×844 chart budget: the readout in 3 rows or fewer, the card 520px or less, the legend 2 lines or fewer. */
async function withinBudget(page, what) {
  expect(await readoutRows(page), `${what}: readout rows`).toBeLessThanOrEqual(3);
  expect((await page.locator('.brief-chartcard').boundingBox()).height, `${what}: card height`).toBeLessThanOrEqual(520);
  expect((await page.locator('.brief-legend').boundingBox()).height, `${what}: legend height`).toBeLessThanOrEqual(2 * 18 + 2);
  expect(await smallText(page), `${what}: text under 12px`).toEqual([]);
}

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

  // ZZMO carries sell marks, so its legend has the ▼▲ item.
  for (const symbol of ['ZZNV', 'ZZAR', 'ZZMO']) test(`${symbol}: the periods, the readout and the top of the chart are on the first screen, within the card budget on every view`, async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${symbol}`, { mutate: { charts: withRsLine } });
    await chartReady(page);
    await settled(page);
    const periods = await page.getByRole('group', { name: '表示期間' }).boundingBox();
    const readout = await page.locator('.brief-readout').boundingBox();
    const chart = await page.getByTestId('brief-price-chart').boundingBox();
    expect(periods.y + periods.height).toBeLessThanOrEqual(DOCK_TOP);
    expect(readout.y + readout.height).toBeLessThanOrEqual(DOCK_TOP);
    expect(chart.y + 60).toBeLessThanOrEqual(DOCK_TOP);
    await withinBudget(page, `${symbol} 6か月`);
    if (symbol === 'ZZMO') await expect(page.locator('.brief-legend')).toContainText('▼▲売りのサイン');
    for (const button of await page.getByRole('group', { name: '表示期間' }).getByRole('button').all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
    // The current price is tagged on the right axis, outlined in the body text colour.
    const close = (await page.locator('.brief-readout .ro-item').filter({ hasText: /^終/ }).textContent()).slice(1);
    await expect(page.locator('[data-tag="last"] .bc-tagtext')).toHaveText(close);
    if (symbol === 'ZZAR') expect(close).toBe('110.88');
    // The RS caption keeps RS線, RS推計 and IBD RS apart.
    await expect(page.locator('.bc-rscaption')).toHaveText('RS線（株価÷S&P 500）・RS推計やIBD RSとは別');
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

test.describe('1440×900 desktop', () => {
  test.use({ ...VIEWPORTS.desktop, contextOptions: { reducedMotion: 'reduce' } });

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
    const pairs = await page.evaluate(() => [['ma50', '.bc-ma50'], ['ma150', '.bc-ma150'], ['ma200', '.bc-ma200'], ['pivot', '.bc-pivot'], ['stop', '.bc-stop'], ['lows', '.bc-lows']].map(([key, line]) => {
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
