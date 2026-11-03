// Daily brief: today → stock → back, candidate list filters and search, the watchlist (☆, toast
// and undo) and the persisted colour mode, at phone and desktop width on synthetic data.
import { test, expect } from '@playwright/test';
import { date, openBrief, VIEWPORTS, horizontalOverflow, charts } from './brief-fixture.js';

const candidates = page => page.getByTestId('brief-candidate');
const symbolsShown = page => candidates(page).evaluateAll(nodes => nodes.map(node => node.dataset.symbol));
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
    await expect(summary).toContainText('5銘柄');
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
    // The verdict: price at the pivot with 1.6× volume (synthetic audit) is a breakout in the buy zone.
    await expect(page.getByTestId('brief-conclusion')).toHaveClass(/tone-zone/);
    await expect(page.getByTestId('brief-conclusion')).toContainText('ピボットを出来高を伴って上抜け');
    await expectStockChart(chart, target, 130);
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: '3か月' }).click();
    await expectStockChart(chart, target, 65);
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: '週足2年' }).click();
    await expect(chart).toHaveAttribute('aria-label', new RegExp(`^${target} の週足チャート（.*〜${date}）`));
    expect(await horizontalOverflow(page)).toBe(0);
    if (phone) await page.getByRole('button', { name: '戻る', exact: true }).click();
    else await page.goBack();
    await expect(page).toHaveURL(/#\/brief$/);
    await expect(page.getByRole('heading', { level: 1, name: '10月2日（金）の判断' })).toBeVisible();
    if (!phone) {
      // With nothing chosen, the wide screen shows the first focus candidate.
      await expect(page.locator('.brief-stockhead h2')).toContainText('ZZNV');
      await page.getByRole('button', { name: '次の候補' }).click();
      await expect(page).toHaveURL(/#\/brief\/stock\/ZZKS$/);
    }
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });

  test('candidate list filters and search', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list');
    await expect(page.getByRole('heading', { level: 1, name: '候補' })).toBeVisible();
    const filters = page.getByRole('group', { name: '絞り込み' });
    const filter = label => filters.getByRole('button', { name: new RegExp(`^${label}\\s*\\d+$`) });
    const count = async label => Number(await filter(label).locator('.numeric').innerText());
    await expect(filter('買いゾーン')).toHaveAttribute('aria-pressed', 'true');
    await expect(candidates(page)).toHaveCount(await count('買いゾーン'));
    await expect(candidates(page).first()).toContainText('買いゾーン内');
    const zone = await symbolsShown(page);
    expect(zone).toContain('ZZNV');

    await filter('あと1条件').click();
    await expect(filter('あと1条件')).toHaveAttribute('aria-pressed', 'true');
    await expect(filter('買いゾーン')).toHaveAttribute('aria-pressed', 'false');
    await expect(candidates(page)).toHaveCount(await count('あと1条件'));
    const oneShort = await symbolsShown(page);
    expect(oneShort.length).toBeGreaterThan(0);
    for (const chip of await page.locator('.brief-rows .brief-row').allInnerTexts()) expect(chip).toContain('あと1条件');
    expect(oneShort.some(symbol => zone.includes(symbol))).toBe(false);

    await filter('ピボット接近').click();
    await expect(candidates(page)).toHaveCount(await count('ピボット接近'));
    // Within 5% below the pivot, waiting for the breakout.
    for (const label of await candidates(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))) {
      const below = Number(label.match(/ピボット待ち −(\d+(?:\.\d+)?)%/)?.[1]);
      expect(below, label).toBeGreaterThan(0);
      expect(below, label).toBeLessThanOrEqual(5);
    }

    await filter('選定すべて').click();
    const all = await count('選定すべて');
    expect(all).toBe(await count('買いゾーン') + await count('ピボット接近'));
    await expect(candidates(page)).toHaveCount(all);

    const search = page.getByRole('searchbox', { name: '銘柄を検索' });
    await search.fill('zzk');
    await expect(candidates(page)).toHaveCount(1);
    await expect(candidates(page)).toHaveAttribute('data-symbol', 'ZZKS');
    await search.fill('orbital');
    await expect(candidates(page)).toHaveCount(1);
    await expect(candidates(page)).toHaveAttribute('data-symbol', 'ZZOD');
    // A one-short stock is not in the qualified filters, even when searched for.
    await search.fill(oneShort[0]);
    await expect(candidates(page)).toHaveCount(0);
    await expect(page.getByText('この条件の選定銘柄はありません。')).toBeVisible();
    await filter('あと1条件').click();
    await expect(candidates(page)).toHaveCount(1);
    await search.fill('');
    await expect(candidates(page)).toHaveCount(oneShort.length);

    await page.getByRole('combobox', { name: '並び順' }).selectOption({ label: 'RS推計' });
    const rs = await candidates(page).evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('aria-label').match(/RS推計 (\d+)/)[1])));
    expect(rs).toEqual([...rs].sort((a, b) => b - a));
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
    await expect(page.getByRole('region', { name: 'ウォッチの変化' }).getByRole('button', { name: /ZZNV/ })).toBeVisible();
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
