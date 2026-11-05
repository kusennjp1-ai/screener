// Daily brief: today → stock → back, Today's focus pool and its near-pivot list, the watchlist (☆, toast
// and undo) and the persisted colour mode, at phone and desktop width on synthetic data.
import { test, expect } from '@playwright/test';
import { date, openBrief, VIEWPORTS, horizontalOverflow, charts } from './brief-fixture.js';

const candidates = page => page.getByTestId('brief-candidate');
const candles = chart => chart.locator('svg rect.bc-up, svg rect.bc-down');

/** The stock screen's large chart: a labelled image whose last candle is the analysis session. */
async function expectStockChart(chart, symbol, count) {
  const bars = charts[`${symbol}.json`].bars;
  await expect(chart).toHaveAttribute('role', 'img');
  await expect(chart).toHaveAttribute('aria-label', new RegExp(`^${symbol} の日足チャート（${bars.at(-count).date}〜${date}）。終値 `));
  await expect(candles(chart)).toHaveCount(count);
}

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`${name} ${device.viewport.width}px`, () => {
  test.use(device);
  const phone = name === 'phone';

  test('today → candidate → stock chart → back', async ({ page }) => {
    const { errors, external } = await openBrief(page, '#/brief');
    await expect(page.getByRole('heading', { level: 1, name: '10月2日（金）の判断' })).toBeVisible();
    const summary = page.getByTestId('brief-summary');
    await expect(summary).toContainText('上昇トレンド');
    // The whole focus pool (5 in the buy zone, 16 near the pivot), not the five rows shown.
    await expect(summary).toContainText('21銘柄');
    await expect(summary).toContainText('ゾーン5・接近16');
    await expect(page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '今日' })).toHaveAttribute('aria-current', 'page');
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    const target = phone ? 'ZZNV' : 'ZZKS';
    const row = focus.locator(`[data-symbol="${target}"]`);
    if (phone) await row.tap(); else await row.click();
    await expect(page).toHaveURL(new RegExp(`#/brief/stock/${target}$`));
    const chart = page.getByTestId('brief-price-chart');
    if (phone) {
      await expect(page.locator('.brief-bar-title')).toContainText(target);
      await expect(page.getByRole('navigation', { name: 'ブリーフの画面' })).toHaveCount(0);
    } else {
      await expect(page.locator('.brief-stockhead h2')).toContainText(target);
      // The list stays beside the stock on a wide screen.
      await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    }
    await expectStockChart(chart, target, 130);
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: '3か月' }).click();
    await expectStockChart(chart, target, 65);
    expect(await horizontalOverflow(page)).toBe(0);
    if (phone) await page.getByRole('button', { name: '戻る', exact: true }).click();
    else await page.goBack();
    await expect(page).toHaveURL(/#\/brief$/);
    await expect(page.getByRole('heading', { level: 1, name: '10月2日（金）の判断' })).toBeVisible();
    if (!phone) {
      // Back on Today, the wide screen keeps the stock just viewed (it is a focus candidate),
      // and 次の候補 moves to the focus candidate after it.
      await expect(page.locator('.brief-stockhead h2')).toContainText(target);
      const order = await focus.getByTestId('brief-candidate').evaluateAll(rows => rows.map(row => row.dataset.symbol));
      const next = order[(order.indexOf(target) + 1) % order.length];
      await page.getByRole('button', { name: '次の候補' }).click();
      await expect(page).toHaveURL(new RegExp(`#/brief/stock/${next}$`));
      await expect(page.locator('.brief-stockhead h2')).toContainText(next);
    }
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });

  test('Today shows the top five of the focus pool and opens the near-pivot list', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    await expect(focus).toContainText('上位5件を表示（注目候補 21銘柄中）');
    const near = focus.getByRole('link', { name: 'ピボット接近 16銘柄' });
    const box = await near.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    if (phone) await near.tap(); else await near.click();
    await expect(page).toHaveURL(/#\/brief\/list$/);
    const filters = page.getByRole('group', { name: '絞り込み' });
    await expect(filters.getByRole('button', { name: /^ピボット接近\s*16$/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('searchbox', { name: '銘柄を検索' })).toHaveValue('');
    await expect(candidates(page)).toHaveCount(16);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('watch with ☆, undo from the toast, and the watch tab', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV');
    const star = (phone ? page.locator('.brief-bar') : page.locator('.brief-stockhead-actions')).getByRole('button', { name: /^ウォッチ(に追加|から外す)$/ });
    await expect(star).toHaveAccessibleName('ウォッチに追加');
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    const toast = page.locator('.brief-toast');

    await star.click();
    await expect(star).toHaveAccessibleName('ウォッチから外す');
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(toast).toHaveText(/ZZNV をウォッチに追加しました/);
    await toast.getByRole('button', { name: '元に戻す' }).click();
    await expect(toast).toHaveCount(0);
    await expect(star).toHaveAccessibleName('ウォッチに追加');
    expect(await page.evaluate(() => localStorage.getItem('research-watch'))).toBe('[]');

    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    if (phone) await expect(page.locator('.brief-actions .is-primary')).toHaveText('ウォッチ中');
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('research-watch')))).toEqual(['ZZNV']);
    // Removing and undoing keeps the stock watched.
    await star.click();
    await expect(toast).toHaveText(/ZZNV をウォッチから外しました/);
    await toast.getByRole('button', { name: '元に戻す' }).click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('research-watch')))).toEqual(['ZZNV']);

    if (phone) await page.getByRole('button', { name: '戻る', exact: true }).click();
    const tabs = page.getByRole('navigation', { name: 'ブリーフの画面' });
    await expect(tabs.getByRole('link', { name: /ウォッチ/ })).toContainText('1');
    await expect(page.getByRole('region', { name: 'ウォッチの状況' }).getByRole('button', { name: /ZZNV/ })).toBeVisible();
    await tabs.getByRole('link', { name: /ウォッチ/ }).click();
    await expect(page).toHaveURL(/#\/brief\/watch$/);
    await expect(page.getByRole('heading', { level: 1, name: 'ウォッチ' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'ウォッチ中の銘柄' }).getByTestId('brief-candidate')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'ウォッチ中の銘柄' }).getByTestId('brief-candidate')).toHaveAttribute('data-symbol', 'ZZNV');

    // The watchlist survives a reload; removing it empties the watch tab.
    await page.reload();
    await page.getByRole('region', { name: 'ウォッチ中の銘柄' }).getByTestId('brief-candidate').click();
    await expect(page).toHaveURL(/#\/brief\/stock\/ZZNV$/);
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await star.click();
    await expect(toast).toHaveText(/ZZNV をウォッチから外しました/);
    // Phone: back to the watch tab. Desktop: the watch list stays beside the stock.
    if (phone) {
      await page.getByRole('button', { name: '戻る', exact: true }).click();
      await expect(page).toHaveURL(/#\/brief\/watch$/);
    }
    await expect(page.getByText('銘柄の画面で ☆ を押すと、ここに並びます。')).toBeVisible();
    await expect(tabs.getByRole('link', { name: /ウォッチ/ })).not.toContainText(/\d/);
    expect(errors).toEqual([]);
  });

  test('colour mode toggle flips the brief theme and persists across reload', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list');
    const brief = page.locator('.brief');
    await expect(brief).toHaveAttribute('data-theme', 'dark');
    const background = () => brief.evaluate(node => getComputedStyle(node).backgroundColor);
    const dark = await background();
    await page.getByRole('button', { name: 'ライトモードに切り替え' }).click();
    await expect(brief).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(background).not.toBe(dark);
    await page.reload();
    await expect(brief).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('button', { name: 'ダークモードに切り替え' })).toBeVisible();
    await page.getByRole('button', { name: 'ダークモードに切り替え' }).click();
    await expect(brief).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(brief).toHaveAttribute('data-theme', 'dark');
    await expect.poll(background).toBe(dark);
    expect(errors).toEqual([]);
  });
});
