import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';

const date = '2026-09-25';
const rows = ['LEAD', 'NEXT'].map((symbol, index) => withAuditFixture({ symbol, company_name: `${symbol} toolbar fixture`, current_price: 102,
  se_pivot_price: 100, adv_usd: 50000000, rs_rating: 95 - index, eps_rating: 92, composite_rating: 96, ibd_group_rank: 10,
  chart_path: `${symbol}.json`, market_above_50dma: true, market_above_200dma: true }, date));
const bars = Array.from({ length: 320 }, (_, i) => ({
  date: new Date(Date.parse(date) - (319 - i) * 86400000).toISOString().slice(0, 10),
  open: 85 + i * .05, high: 86 + i * .05, low: 84 + i * .05, close: 85.5 + i * .05, volume: 1000000,
}));

test.use({ browserName: 'chromium', hasTouch: true, isMobile: true, viewport: { width: 390, height: 568 } });

async function nativeSwipe(page, session, from, to) {
  // CDP sends trusted touch input through Chromium's gesture handling, including
  // native overflow scrolling and touch-action. DOM-dispatched events cannot.
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
  for (let step = 1; step <= 6; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
      x: from.x + (to.x - from.x) * step / 6, y: from.y + (to.y - from.y) * step / 6, id: 1,
    }] });
    await page.waitForTimeout(24);
  }
  // Pause the finger before lifting to avoid inertial scrolling racing the
  // following direction/range assertions. The gesture remains under 900 ms.
  await page.waitForTimeout(120);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

for (const mode of ['dark', 'light']) test(`short mobile chart exposes hidden controls in ${mode} mode`, async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/static-data/**', async route => {
    const file = new URL(route.request().url()).pathname.split('/').pop();
    const row = rows.find(row => row.chart_path === file);
    const payload = file === 'manifest.json'
      ? { as_of_date: date, generated_at: `${date}T23:00:00Z`, default_market: 'US', supported_markets: ['US'], markets: {
        US: { as_of_date: date, assets: { research: { path: 'research.json' } }, pages: {} },
      } }
      : file === 'research.json' ? { as_of_date: date, rows }
        : row ? { symbol: row.symbol, as_of_date: date, bars, stock_data: row } : {};
    await route.fulfill({ json: payload });
  });
  await page.goto('/');
  if (mode === 'light') await page.getByRole('button', { name: 'ライトモードに切り替え' }).click();
  await page.getByRole('button', { name: /^LEAD の分析を表示/ }).click();
  await page.getByRole('button', { name: '日次チャートを分析', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const toolbar = dialog.getByRole('group', { name: 'チャート操作', exact: true });
  const previous = toolbar.getByRole('button', { name: '前のチャート操作を表示' });
  const next = toolbar.getByRole('button', { name: '次のチャート操作を表示' });
  const viewport = toolbar.locator('.research-chart-controls');
  const plot = dialog.locator('[data-chart-symbol="LEAD"]');
  await expect(plot.locator('canvas').first()).toBeVisible();
  await expect(previous).toHaveAttribute('aria-disabled', 'true');
  await expect(next).toHaveAttribute('aria-disabled', 'false');
  expect((await toolbar.boundingBox()).height).toBeLessThanOrEqual(54);
  for (const arrow of [previous, next]) {
    const box = await arrow.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await toolbar.getByRole('button', { name: '3か月', exact: true }).click();
  const range = dialog.getByTestId('chart-visible-range');
  // The visible-range label is debounced; wait for the selected period rather
  // than capturing the still-visible initial six-month range.
  await expect.poll(async () => {
    const dates = (await range.textContent()).match(/\d{4}-\d{2}-\d{2}/g) || [];
    const days = dates.length === 2 ? (Date.parse(dates[1]) - Date.parse(dates[0])) / 86400000 : 0;
    return days > 50 && days < 80;
  }).toBe(true);
  const selectedRange = await range.textContent();
  const plotHeight = (await plot.boundingBox()).height;
  expect(plotHeight).toBeGreaterThanOrEqual(300);

  // Focusing the last action reproduces the review's hidden earlier controls.
  await toolbar.getByRole('button', { name: /図解/ }).focus();
  await expect(previous).toHaveAttribute('aria-disabled', 'false');
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await expect(next).toBeFocused();
  await page.screenshot({ path: info.outputPath(`toolbar-end-390x568-${mode}.png`) });
  await previous.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(previous).toHaveAttribute('aria-disabled', 'true');
  await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBe(0);
  await page.keyboard.press('Tab');
  await expect(toolbar.getByRole('button', { name: '日足', exact: true })).toBeFocused();
  await expect(range).toHaveText(selectedRange);
  expect((await plot.boundingBox()).height).toBe(plotHeight);
  await page.screenshot({ path: info.outputPath(`toolbar-start-390x568-${mode}.png`) });

  const session = await page.context().newCDPSession(page);
  try {
    // Swipe the padding inside the scrolling row, outside all buttons, so this
    // exercises both native scrolling and the toolbar-wide stock-swipe guard.
    const box = await viewport.boundingBox();
    const left = { x: box.x + 24, y: box.y + box.height - 2 };
    const right = { x: box.x + box.width - 24, y: left.y };
    await nativeSwipe(page, session, right, left);
    await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(40);
    await expect(previous).toHaveAttribute('aria-disabled', 'false');
    await expect(dialog).toHaveAccessibleName('LEAD 1 / 2 銘柄');
    await expect(range).toHaveText(selectedRange);
    await page.screenshot({ path: info.outputPath(`toolbar-touch-390x568-${mode}.png`) });
    const scrolled = await viewport.evaluate(element => element.scrollLeft);
    await nativeSwipe(page, session, left, right);
    await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeLessThan(scrolled - 40);
    await expect(dialog).toHaveAccessibleName('LEAD 1 / 2 銘柄');
    await expect(range).toHaveText(selectedRange);

    const plotSwipe = async direction => {
      const box = await dialog.locator('[data-chart-symbol]').boundingBox();
      const left = { x: box.x + box.width * .25, y: box.y + Math.min(120, box.height * .45) };
      const right = { x: box.x + box.width * .72, y: left.y };
      await nativeSwipe(page, session, direction === 'left' ? right : left, direction === 'left' ? left : right);
    };
    await dialog.getByRole('button', { name: 'チャート操作（拡大・移動）', exact: true }).click();
    await plotSwipe('right');
    await expect(range).not.toHaveText(selectedRange);
    const manualRange = await range.textContent();
    await expect(dialog).toHaveAccessibleName('LEAD 1 / 2 銘柄');
    await next.click();
    await previous.click();
    await expect(range).toHaveText(manualRange);
    expect((await plot.boundingBox()).height).toBe(plotHeight);
    await dialog.getByRole('button', { name: '銘柄スワイプに戻る', exact: true }).click();

    await plotSwipe('left');
    await expect(dialog).toHaveAccessibleName('NEXT 2 / 2 銘柄');
    await expect(dialog.locator('[data-chart-symbol="NEXT"] canvas').first()).toBeVisible();
    await plotSwipe('right');
    await expect(dialog).toHaveAccessibleName('LEAD 1 / 2 銘柄');
    await expect(plot.locator('canvas').first()).toBeVisible();
  } finally {
    await session.detach();
  }
  const axe = await new AxeBuilder({ page }).include('.research-chart-toolbar').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});
