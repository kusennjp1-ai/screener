// Daily brief on phones: rows, Today's first screen, tiles, filters and focus at 320/375/390 px,
// against the desktop layout at 1440 px, on synthetic data.
import { test, expect } from '@playwright/test';
import { openBrief, VIEWPORTS, horizontalOverflow } from './brief-fixture.js';

const phone = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const PHONES = { 320: phone(320, 640), 390: VIEWPORTS.phone };
const candidates = page => page.getByTestId('brief-candidate');
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

for (const [width, device] of Object.entries(PHONES)) test.describe(`rows at ${width}px`, () => {
  test.use(device);

  test('candidate rows give the chips the width of the hidden mini meter', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list');
    await expect(candidates(page).first()).toBeVisible();
    expect(await page.locator('.brief-minimeter').count()).toBeGreaterThan(0);
    for (const meter of await page.locator('.brief-minimeter').all()) await expect(meter).toBeHidden();
    const rows = await candidates(page).evaluateAll(nodes => nodes.slice(0, 5).map(row => ({
      symbol: row.dataset.symbol, height: row.getBoundingClientRect().height,
      lines: new Set([...row.querySelectorAll('.brief-reasons .brief-chip')].map(chip => chip.offsetTop)).size,
      title: row.querySelector('.brief-row-title span').clientWidth,
    })));
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.lines, row.symbol).toBeLessThanOrEqual(2);
      expect(row.height, row.symbol).toBeLessThanOrEqual(100);
    }
    if (width === '390') expect(median(rows.map(row => row.title))).toBeGreaterThanOrEqual(200);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('watch rows have no empty rank gutter', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/watch', { storage: { 'research-watch': ['ZZNV', 'ZZSD'] } });
    await expect(page.getByRole('region', { name: 'ウォッチ中の銘柄' }).getByTestId('brief-candidate')).toHaveCount(2);
    const gaps = await candidates(page).evaluateAll(nodes => nodes.map(row => {
      const style = getComputedStyle(row), box = row.getBoundingClientRect();
      const contentLeft = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      return row.querySelector('.brief-row-main').getBoundingClientRect().left - contentLeft;
    }));
    for (const gap of gaps) { expect(gap).toBeGreaterThanOrEqual(0); expect(gap).toBeLessThanOrEqual(8); }
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`TT chip ${name}`, () => {
  test.use(device);

  test('Today\'s focus rows omit the constant TT 8/8 chip; the list keeps it', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    for (const row of await focus.getByTestId('brief-candidate').all()) await expect(row).not.toContainText('TT 8/8');
    await expect(focus).toContainText('注目候補はすべてトレンドテンプレート8条件を満たす銘柄');
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '候補' }).click();
    await expect(page).toHaveURL(/#\/brief\/list$/);
    await expect(candidates(page).first()).toContainText('TT 8/8');
    if (name === 'desktop') expect(await page.locator('.brief-left .brief-minimeter').count()).toBeGreaterThan(0);
    if (name === 'desktop') for (const meter of await page.locator('.brief-left .brief-minimeter').all()) await expect(meter).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
const FOLD = { 375: phone(375, 812), 390: VIEWPORTS.phone };

for (const [width, device] of Object.entries(FOLD)) test.describe(`Today's first screen at ${width}px`, () => {
  test.use(device);

  test('shows the market answer and a candidate without scrolling', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    const market = page.getByRole('region', { name: '地合い' });
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    await expect(market.locator('.brief-fact').first()).not.toContainText('読み込み中');
    await settled(page);
    const first = await focus.getByTestId('brief-candidate').first().boundingBox();
    const dock = await page.locator('.brief-dock').boundingBox();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect(first.y + first.height).toBeLessThanOrEqual(dock.y);
    // The verdict repeats the summary tile and the chart is a shape only: both stay on the market tab.
    await expect(market.locator('.brief-verdict')).toBeHidden();
    await expect(market.locator('.brief-index')).toBeHidden();
    await expect(market.locator('.brief-index-legend')).toBeHidden();
    expect(await market.evaluate(node => node.innerText)).toContain('独自判定');
    await expect(market.locator('.brief-fact')).toHaveCount(4);
    for (const fact of await market.locator('.brief-fact').all()) await expect(fact).toBeVisible();
    const summary = page.getByTestId('brief-summary');
    await expect(summary).toContainText('買い可・最大50%');
    expect(await summary.locator('.brief-frag', { hasText: '最大50%' }).evaluate(node => node.getClientRects().length)).toBe(1);
    await expect(page.locator('.brief-bar-title')).toContainText('2026-10-02');
    await expect(page.locator('.brief-bar-title')).toContainText('引け');
    await expect(page.locator('.brief-hero small')).toBeHidden();
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('the market tab on a phone keeps the verdict and the chart', () => {
  test.use(VIEWPORTS.phone);
  test('verdict and S&P chart are visible on #/brief/market', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    const market = page.getByRole('region', { name: '地合い' });
    await expect(market.locator('.brief-verdict')).toBeVisible();
    await expect(market.locator('.brief-index')).toBeVisible();
    await expect(page.locator('.brief-hero small')).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('Today on desktop is unchanged', () => {
  test.use(VIEWPORTS.desktop);
  test('verdict, S&P chart and the hero date stay visible at 1440px', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    const market = page.getByRole('region', { name: '地合い' });
    await expect(market.locator('.brief-verdict')).toBeVisible();
    await expect(market.locator('.brief-index')).toBeVisible();
    await expect(market.locator('.brief-index-legend')).toBeVisible();
    await expect(page.locator('.brief-hero small')).toBeVisible();
    await expect(page.locator('.brief-bar-title')).toContainText('分析基準日 2026-10-02 引け・米国株');
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
