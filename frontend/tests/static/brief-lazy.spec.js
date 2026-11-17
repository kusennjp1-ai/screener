// The stock screen's body is a lazy chunk (stockViewLoader.js): Today, 候補 and ウォッチ do not parse it, and it is fetched
// once the first screen is idle. When it cannot be loaded (offline before the service worker had it, or a deploy replaced
// it) the screen says so with a 44px 再読み込み, never an empty screen; the browser keeps a failed module import for the
// page's life, so the button reloads the page, which then draws the screen. A phone opens a stock once the chunk has
// settled, so the page transition never captures a screen still loading.
import { test, expect } from '@playwright/test';
import { chartSettled, openBrief, VIEWPORTS } from './brief-fixture.js';

// The dev server serves the module itself; a build serves StockView-<hash>.js.
const STOCK_CHUNK = /\/StockView(-[\w-]+)?\.jsx?(\?.*)?$/;
const FAILED_TEXT = '銘柄の画面を読み込めません（通信状態を確認して、再読み込みしてください）';
const LOADING = '銘柄データを読み込み中…';
// Finite animations done, so a box is read where it settles (the chart failure spec's rule, brief-chart.spec.js).
const settled = page => page.waitForFunction(() => document.getAnimations().every(a => a.effect?.getComputedTiming().iterations === Infinity || a.playState !== 'running'));

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`the stock screen when its chunk fails to load (${name})`, () => {
  test.use(device);
  test('says it cannot load the screen, keeps the stock named, offers a 44px reload, and draws after it', async ({ page }) => {
    let blocked = true;
    await page.route(STOCK_CHUNK, route => (blocked ? route.abort() : route.fallback()));
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV');
    const failed = page.locator('#brief-main .brief-stock-failed');
    await expect(failed).toBeVisible();
    await expect(failed.getByRole('alert')).toHaveText(FAILED_TEXT);
    // The phone's bar and the desktop pane's header still name the stock.
    await expect(page.locator(name === 'phone' ? '.brief-bar-title b span' : '.brief-stockhead h2 span').first()).toHaveText('ZZNV');
    await expect(page.getByTestId('brief-conclusion')).toHaveCount(0);
    await expect(page.getByText(LOADING)).toHaveCount(0);
    const retry = failed.getByRole('button', { name: '再読み込み' });
    await settled(page);
    // The CSS min-height is 44px at every width; 0.1px of tolerance for sub-pixel layout, as Design Acceptance reads it.
    expect((await retry.boundingBox()).height + 0.1).toBeGreaterThanOrEqual(44);
    blocked = false;
    await Promise.all([page.waitForEvent('load'), retry.click()]);
    await expect(page.getByTestId('brief-conclusion')).toBeVisible();
    await expect(failed).toHaveCount(0);
    await chartSettled(page);
    await expect(page.getByTestId('brief-price-chart').locator('svg').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('a phone opens a stock with its screen whole', () => {
  test.use(VIEWPORTS.phone);
  // Every DOM change from here on: a stock address showing no conclusion, or the screen's loading line, is an empty frame.
  const watchFrames = page => page.evaluate(() => {
    window.__briefFrames = [];
    new MutationObserver(() => {
      const main = document.getElementById('brief-main');
      if (!main) return;
      if (main.innerText.includes('銘柄データを読み込み中…')) window.__briefFrames.push(`loading line at ${location.hash}`);
      else if (location.hash.startsWith('#/brief/stock/') && !main.querySelector('[data-testid="brief-conclusion"], .brief-stock-failed')) window.__briefFrames.push(`empty stock screen at ${location.hash}`);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const frames = page => page.evaluate(() => window.__briefFrames);
  const firstRow = page => page.getByTestId('brief-candidate').first();

  test('after the idle-time prefetch: the row opens the whole screen at once', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    await expect(firstRow(page)).toBeVisible();
    // The prefetch has landed: the shell's own loader holds the module (the dev server serves the shell's module instance).
    await page.waitForFunction(() => import('/src/static/brief/stockViewLoader.js').then(loader => loader.loadedStockView() !== null), null, { timeout: 20000 });
    await watchFrames(page);
    const symbol = await firstRow(page).getAttribute('data-symbol');
    await firstRow(page).click();
    await expect(page).toHaveURL(new RegExp(`#/brief/stock/${symbol}$`));
    await expect(page.getByTestId('brief-conclusion')).toBeVisible();
    await chartSettled(page);
    expect(await frames(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('before the chunk has landed: the tap waits for it, then opens the whole screen', async ({ page }) => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route(STOCK_CHUNK, async route => { await held; await route.fallback(); });
    const { errors } = await openBrief(page, '#/brief');
    await expect(firstRow(page)).toBeVisible();
    await watchFrames(page);
    const symbol = await firstRow(page).getAttribute('data-symbol');
    await firstRow(page).click();
    // Held: Today stays as it is, and no stock screen appears without its content.
    await page.waitForTimeout(600);
    await expect(page).toHaveURL(/#\/brief$/);
    await expect(firstRow(page)).toBeVisible();
    release();
    await expect(page).toHaveURL(new RegExp(`#/brief/stock/${symbol}$`));
    await expect(page.getByTestId('brief-conclusion')).toBeVisible();
    await chartSettled(page);
    expect(await frames(page)).toEqual([]);
    // One history entry for the one tap: back returns to Today.
    await page.getByRole('button', { name: '戻る' }).click();
    await expect(page).toHaveURL(/#\/brief$/);
    expect(errors).toEqual([]);
  });

  test('when the chunk cannot load: the tap still opens the stock, on its message', async ({ page }) => {
    await page.route(STOCK_CHUNK, route => route.abort());
    const { errors } = await openBrief(page, '#/brief');
    await expect(firstRow(page)).toBeVisible();
    await watchFrames(page);
    const symbol = await firstRow(page).getAttribute('data-symbol');
    await firstRow(page).click();
    await expect(page).toHaveURL(new RegExp(`#/brief/stock/${symbol}$`));
    await expect(page.locator('#brief-main .brief-stock-failed').getByRole('alert')).toHaveText(FAILED_TEXT);
    await expect(page.locator('.brief-bar-title b span').first()).toHaveText(symbol);
    expect(await frames(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
