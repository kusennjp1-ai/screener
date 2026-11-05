// Daily brief: today → stock → back, Today's focus pool and its near-pivot list, the watchlist (☆, toast
// and undo), the persisted colour mode, and going back and stepping through a list (its place kept, the
// history not grown, no wraparound), at phone and desktop width on synthetic data.
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
    // A phone's ☆ is in the dock beside the list position (the bar has none); the desktop's in the stock header.
    if (phone) await expect(page.locator('.brief-bar').getByRole('button', { name: /^ウォッチ/ })).toHaveCount(0);
    const star = (phone ? page.locator('.brief-dock') : page.locator('.brief-stockhead-actions')).getByRole('button', { name: /^ウォッチ(に追加|から外す)$/ });
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
    if (phone) await expect(page.locator('.brief-dockpos')).toContainText('注目候補');
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

// Going back from a stock on a phone: the browser's own back when the app pushed the stock (the list keeps its
// place, and the history does not grow), a replace into the app after a direct link (never out of the app).
test.describe('back and stepping on a phone', () => {
  test.use(VIEWPORTS.phone);
  const rows = page => page.getByTestId('brief-candidate');
  const between = row => row.evaluate(node => {
    const box = node.getBoundingClientRect(), bar = document.querySelector('.brief-bar').getBoundingClientRect(), dock = document.querySelector('.brief-dock').getBoundingClientRect();
    return box.top >= bar.bottom - 1 && box.bottom <= dock.top + 1;
  });
  const allRows = async page => {
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '候補' }).click();
    await expect(page).toHaveURL(/#\/brief\/list$/);
    await page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^選定すべて/ }).click();
    await expect(rows(page)).toHaveCount(20);
  };

  test('row 15 → 戻る keeps the list where it was, adds no history entry, and the OS back then leaves the list', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    await expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate')).toHaveCount(5);
    await allRows(page);
    const row = rows(page).nth(14), symbol = await row.getAttribute('data-symbol');
    await row.scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollBy(0, 120));
    const scrolled = await page.evaluate(() => scrollY);
    expect(scrolled).toBeGreaterThan(300);
    await row.tap();
    await expect(page).toHaveURL(new RegExp(`#/brief/stock/${symbol}$`));
    await expect(page.locator('.brief-dockpos')).toContainText('15/21');
    await expect(page.locator('.brief-dockpos')).toContainText('選定すべて');
    const length = await page.evaluate(() => history.length);
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page).toHaveURL(/#\/brief\/list$/);
    await expect(rows(page).nth(14)).toHaveAttribute('data-symbol', symbol);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThanOrEqual(scrolled - 2);
    expect(await page.evaluate(() => scrollY)).toBeLessThanOrEqual(scrolled + 2);
    expect(await between(rows(page).nth(14))).toBe(true);
    expect(await page.evaluate(() => history.length)).toBe(length);
    // The list keeps its filter, and the OS back goes on to Today, not to the stock again.
    await expect(page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^選定すべて/ })).toHaveAttribute('aria-pressed', 'true');
    await page.goBack();
    await expect(page).toHaveURL(/#\/brief$/);
    await expect(page.getByRole('heading', { level: 1, name: '10月2日（金）の判断' })).toBeAttached();
    expect(errors).toEqual([]);
  });

  test('after stepping, 戻る brings the row of the stock reached between the bar and the dock', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    await allRows(page);
    const row = rows(page).nth(14);
    await row.scrollIntoViewIfNeeded();
    await row.tap();
    await expect(page.locator('.brief-dockpos')).toContainText('15/21');
    for (let i = 0; i < 4; i++) await page.locator('.brief-dock').getByRole('button', { name: '次の候補' }).click();
    await expect(page.locator('.brief-dockpos')).toContainText('19/21');
    const reached = await page.evaluate(() => location.hash.split('/').pop());
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page).toHaveURL(/#\/brief\/list$/);
    const target = page.locator(`[data-testid="brief-candidate"][data-symbol="${reached}"]`);
    await expect(target).toHaveCount(1);
    await expect.poll(() => between(target)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('a direct link, one step, then 戻る stays in the app', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV');
    await expect(page.locator('.brief-dockpos')).toContainText('1/5');
    await expect(page.locator('.brief-dockpos')).toContainText('注目候補');
    const length = await page.evaluate(() => history.length);
    await page.locator('.brief-dock').getByRole('button', { name: '次の候補' }).click();
    await expect(page).toHaveURL(/#\/brief\/stock\/ZZKS$/);
    await expect(page.locator('.brief-dockpos')).toContainText('2/5');
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(page).toHaveURL(/#\/brief$/);
    await expect(page.getByRole('heading', { level: 1, name: '10月2日（金）の判断' })).toBeAttached();
    await expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate')).toHaveCount(5);
    expect(await page.evaluate(() => history.length)).toBe(length);
    expect(errors).toEqual([]);
  });
});

// No wraparound: at either end the buttons, j/k and a swipe say so (role=status) and stay on the stock.
for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`the ends of a list ${name}`, () => {
  test.use(device);
  const phone = name === 'phone';
  const press = async (page, label) => (phone ? page.locator('.brief-dock') : page.locator('.brief-stockhead')).getByRole('button', { name: label }).click();

  test('the last and the first stock say so instead of wrapping around', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    const focus = page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate');
    await expect(focus).toHaveCount(5);
    await focus.nth(4).click();
    await expect(page).toHaveURL(/#\/brief\/stock\/ZZDM$/);
    if (phone) await expect(page.locator('.brief-dockpos')).toContainText('5/5');
    const status = page.getByRole('status').filter({ hasText: '一巡しました' });
    await press(page, '次の候補');
    await expect(status).toHaveText('一巡しました（注目候補5件）');
    await expect(page).toHaveURL(/#\/brief\/stock\/ZZDM$/);
    await page.keyboard.press('j');
    await expect(page).toHaveURL(/#\/brief\/stock\/ZZDM$/);
    await expect(status).toHaveText('一巡しました（注目候補5件）');
    await page.goto('/#/brief/stock/ZZNV');
    await expect(page).toHaveURL(/#\/brief\/stock\/ZZNV$/);
    await page.keyboard.press('k');
    await expect(page.getByRole('status').filter({ hasText: '先頭です' })).toBeVisible();
    await expect(page).toHaveURL(/#\/brief\/stock\/ZZNV$/);
    expect(errors).toEqual([]);
  });

  if (phone) test('a swipe past the last stock says so too', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZDM');
    await expect(page.locator('.brief-dockpos')).toContainText('5/5');
    // A leftward swipe on the screen (not on the chart) asks for the next stock.
    const main = page.locator('#brief-main');
    const box = await page.getByTestId('brief-conclusion').boundingBox();
    const y = box.y + 20, from = box.x + box.width - 20;
    await main.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: from, clientY: y, isPrimary: true });
    for (let k = 1; k <= 6; k++) await main.dispatchEvent('pointermove', { pointerType: 'touch', clientX: from - k * 30, clientY: y, isPrimary: true });
    await main.dispatchEvent('pointerup', { pointerType: 'touch', clientX: from - 180, clientY: y, isPrimary: true });
    await expect(page.getByRole('status').filter({ hasText: '一巡しました' })).toHaveText('一巡しました（注目候補5件）');
    await expect(page).toHaveURL(/#\/brief\/stock\/ZZDM$/);
    expect(errors).toEqual([]);
  });
});
