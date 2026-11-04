// Daily brief: today → stock → back, candidate list filters and search, the watchlist (☆, toast
// and undo) and the persisted colour mode, at phone and desktop width on synthetic data.
import { test, expect } from '@playwright/test';
import { date, openBrief, VIEWPORTS, horizontalOverflow, charts, SEC_SYMBOL } from './brief-fixture.js';

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

  test('fundamentals show the latest SEC quarter with its source and say why a value is missing', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    const card = page.getByTestId('brief-fundamentals');
    await expect(card.getByText('出典：SEC XBRL（10-K 2026-08-09 提出）・2026-06期まで・売上/純利益のQ4は10-K年度値−3四半期で算出')).toBeVisible();
    const epsTile = card.locator('.brief-fact').filter({ hasText: 'EPS 前年比' });
    await expect(epsTile).toContainText('+40%');
    await expect(epsTile).toContainText('2026-03期・最新 2026-06期はQ4のEPSは年次報告のみ');
    // The June quarter's sales are a derived Q4 compared with a derived Q4 a year earlier.
    await expect(card.locator('.brief-fact').filter({ hasText: '売上 前年比' })).toContainText('2026-06期・前期 +60%・前年同期はQ4算出');
    await expect(card.getByText('Q4算出').first()).toBeAttached();
    await expect(card.getByText('Code 33 未確認')).toBeVisible();
    await expect(card).toContainText('EPS の加速は第4四半期の EPS が年次報告（10-K）にしか無いため未確認です');
    await expect(card.getByRole('img', { name: /四半期の前年同期比成長率/ })).toBeVisible();
    // Each grey bar's reason is text (a phone shows no SVG title), and the periods and margins under the
    // bars read at 12px at every width.
    await expect(card.getByRole('list', { name: '値なしの理由' })).toContainText('EPS 前年比：25-06・26-06期はQ4のEPSは年次報告のみ');
    await expect(card).not.toContainText(/カーソル|長押し/);
    const axis = await card.locator('.brief-q-axis > span > *').evaluateAll(nodes => nodes.map(node => [node.textContent, parseFloat(getComputedStyle(node).fontSize), node.scrollWidth > node.clientWidth + 0.5]));
    expect(axis.length).toBeGreaterThanOrEqual(24);
    expect(axis.filter(([, size, cut]) => size < 12 || cut)).toEqual([]);
    // The legend swatches use a radius token (Design Acceptance flags any other corner radius).
    const swatches = await card.locator('.brief-q-legend i').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).borderTopLeftRadius));
    expect(swatches.length).toBeGreaterThanOrEqual(3);
    for (const radius of swatches) expect(['4px', '8px', '12px', '16px']).toContain(radius);
    await expect(card).not.toContainText('未取得');
    expect(await horizontalOverflow(page)).toBe(0);
    // A stock without a published SEC record names that reason in every tile.
    await page.goto('/#/brief/stock/ZZKS');
    const other = page.getByTestId('brief-fundamentals');
    await expect(other.locator('.brief-fact').first()).toContainText('SEC 未配信');
    await expect(other).toContainText('この銘柄の当日分の SEC 四半期データは配信されていません');
    await expect(other).not.toContainText('未取得');
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('while the research detail loads or after it fails, the SEC record is never called 未配信', async ({ page }) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { detailGate: gate });
    const card = page.getByTestId('brief-fundamentals');
    await expect(card.locator('.brief-fact').first()).toContainText('読み込み中…');
    await expect(card).toContainText('Code 33 読み込み中');
    await expect(card).not.toContainText(/SEC 未配信|配信されていません/);
    release();
    await expect(card.getByText(/^出典：SEC XBRL/)).toBeVisible();
    await expect(card).not.toContainText(/読み込み中|未配信/);
    // A detail that answers 503 says it could not be fetched, for good, and never 未配信.
    const failed = await page.context().newPage();
    const second = await openBrief(failed, `#/brief/stock/${SEC_SYMBOL}`, { fail: 'detail' });
    const failedCard = failed.getByTestId('brief-fundamentals');
    await expect(failedCard.locator('.brief-fact').first()).toContainText('取得できません', { timeout: 30000 });
    await expect(failedCard).toContainText('詳細データを取得できません。');
    await expect(failedCard).not.toContainText(/SEC 未配信|配信されていません/);
    expect(errors).toEqual([]);
    expect(second.errors).toEqual([]);
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
