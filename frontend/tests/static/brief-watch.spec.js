// Daily brief watch list: Today's watch rows and their folding while the sell checks load, the watch tile
// (only broken setups counted, 0件 only when every check is in, the 12-stock limit and unlisted symbols said), a
// symbol this publication does not list, every watched stock listed whatever the 候補 tab's search, the 375×812
// budgets and row heights with a broken setup, the list's rows across a stock round trip, and the sell card's
// qualifier, on synthetic data.
import { test, expect } from '@playwright/test';
import { openBrief, charts, rows, rowBySymbol, horizontalOverflow } from './brief-fixture.js';

const phone = (width, height = 812) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
// A broken setup's chip: its short form on the rows, its full sentence for assistive tech (Today) and as its title.
const WEAKNESS = '崩れ（独自判定）';
const WEAKNESS_FULL = '買いの前提が崩れた／保有なら売りのサイン（独自判定）';

/**
 * A heavy-volume break of the 50-day line nine sessions ago, the close still under the line: the bars before
 * it are lifted 15%, the session before it closes at its 50-day high, and the break day trades 2.2 times the
 * prior 50-day average. The last close stays the row's price, so the bars stay certified for the analysis date.
 */
function breakBelow50(bars) {
  const n = bars.length, at = n - 9;
  for (let i = 0; i < at; i++) for (const key of ['open', 'high', 'low', 'close']) bars[i][key] *= 1.15;
  const top = Math.max(...bars.slice(at - 50, at - 1).map(bar => bar.close));
  Object.assign(bars[at - 1], { open: top, close: top, high: top * 1.005, low: top * 0.995 });
  bars[at].volume = Math.round(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * 2.2);
}
const broken = (...symbols) => ({ charts: served => { for (const symbol of symbols) breakBelow50(served[`${symbol}.json`].bars); } });

test.describe('Today\'s watch card at 390px', () => {
  test.use(phone(390, 844));

  test('Today folds the watch rows beyond the first three, never one with a sell chip, and lists a broken setup first', async ({ page }) => {
    const watch = ['ZZNV', 'ZZKS', 'ZZZF', 'ZZOD', 'ZZSD'];
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': watch }, mutate: broken('ZZSD') });
    const card = page.getByRole('region', { name: 'ウォッチの状況' });
    const first = card.locator('.brief-event').first();
    await expect(first).toHaveAttribute('data-symbol', 'ZZSD');
    // A 50-day hit leads the row: the break day and its volume.
    await expect(first).toContainText(/ZZSD 50日線割れ（\d+\/\d+・出来高2\.2倍）/);
    await expect(first.locator('.brief-sellchip [aria-hidden="true"]')).toHaveText(['▲', WEAKNESS]);
    await expect(first.locator('.brief-sellchip .sr-only')).toHaveText(WEAKNESS_FULL);
    await expect(first.locator('.brief-sellchip')).toHaveAttribute('title', new RegExp(`^${WEAKNESS_FULL}：出来高を伴う50日線割れ`));
    await expect(card.locator('.brief-event')).toHaveCount(3);
    const more = card.getByRole('button', { name: 'さらに表示（残り 2件）' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(card.locator('.brief-event')).toHaveCount(5);
    await expect(card.getByRole('button', { name: '表示を減らす' })).toBeFocused();
    await expect(card.locator('.brief-sellchip')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('Today folds nothing while the sell checks load, and never a row whose check is unknown', async ({ page }) => {
    const watch = ['ZZNV', 'ZZKS', 'ZZZF', 'ZZOD', 'ZZSD'];
    const { errors } = await openBrief(page, '#/brief/market', { storage: { 'research-watch': watch }, mutate: broken('ZZSD') });
    // Hold every chart (the sell checks read them) until released; registered last, so it runs first.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const files = new Set(Object.keys(charts));
    await page.route(url => files.has(url.pathname.split('/').pop()), async route => { await gate; await route.fallback(); });
    await page.goto('/#/brief');
    await page.reload();
    const card = page.getByRole('region', { name: 'ウォッチの状況' });
    const tile = page.getByTestId('brief-summary').locator('li').nth(2);
    await expect(card.locator('.brief-event')).toHaveCount(5);
    await expect(card.locator('.brief-morebutton')).toHaveCount(0);
    await expect(card.locator('.brief-sellchip')).toHaveCount(0);
    // Nothing is counted before the checks are in: never 0件.
    await expect(tile).toContainText('ウォッチの注意確認中5銘柄を確認中・保有未登録');
    release();
    // Once every check is in: the broken setup first, then the first rows; the quiet ones fold.
    await expect(card.locator('.brief-event').first()).toContainText(WEAKNESS);
    await expect(card.locator('.brief-event')).toHaveCount(3);
    await expect(card.getByRole('button', { name: 'さらに表示（残り 2件）' })).toBeVisible();
    await expect(tile).toContainText('ウォッチの注意1件5銘柄を確認・保有未登録');
    // A check that cannot be made (its chart fails) is 未確認: that row stays in view like a fired one, and
    // the tile no longer says every stock was checked.
    const failing = rowBySymbol.ZZZF.chart_path.split('/').pop();
    await page.route(url => url.pathname.endsWith(`/${failing}`), route => route.fulfill({ status: 404, json: {} }));
    await page.reload();
    await expect(card.getByRole('button', { name: /ZZZF/ })).toContainText('売りのサイン 未確認', { timeout: 30000 });
    await expect(card.locator('.brief-event')).toHaveCount(4);
    await expect(card.getByRole('button', { name: 'さらに表示（残り 1件）' })).toBeVisible();
    await expect(tile).toContainText('4/5を確認・未確認1・保有未登録');
    expect(errors).toEqual([]);
  });
});

test.describe('the watch tile', () => {
  test.use(phone(390, 844));

  test('one broken setup: 1件, the tile opens that stock, which steps through the watch list flagged first', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': ['ZZNV', 'ZZSD'] }, mutate: broken('ZZSD') });
    const tile = page.getByTestId('brief-summary').getByRole('link', { name: /ウォッチの注意/ });
    await expect(tile).toContainText('ウォッチの注意1件2銘柄を確認・保有未登録');
    await expect(tile.locator('..')).toHaveClass(/tone-ext/);
    await expect(tile).toHaveAttribute('href', '#/brief/stock/ZZSD');
    await tile.click();
    await expect(page).toHaveURL(/#\/brief\/stock\/ZZSD$/);
    await expect(page.locator('.brief-dockpos .numeric')).toHaveText('1/2');
    await expect(page.locator('.brief-dockpos p')).toContainText('ウォッチ');
    await expect(page.getByTestId('brief-conclusion')).toContainText(/崩れ（独自判定）|買いの前提が崩れた/);
    await expect(page.getByTestId('brief-sell').locator('.is-sell-hit')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('two broken setups: 2件, the tile opens the watch tab with them first; no fired check is 0件', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': ['ZZKS', 'ZZNV', 'ZZSD'] }, mutate: broken('ZZSD', 'ZZNV') });
    const tile = page.getByTestId('brief-summary').getByRole('link', { name: /ウォッチの注意/ });
    await expect(tile).toContainText('ウォッチの注意2件3銘柄を確認・保有未登録');
    await expect(tile).toHaveAttribute('href', '#/brief/watch');
    await tile.click();
    await expect(page).toHaveURL(/#\/brief\/watch$/);
    const list = page.getByRole('region', { name: 'ウォッチ中の銘柄' }).getByTestId('brief-candidate');
    await expect(list).toHaveCount(3);
    await expect.poll(() => list.evaluateAll(nodes => nodes.map(node => node.dataset.symbol))).toEqual(['ZZNV', 'ZZSD', 'ZZKS']);
    for (const row of [list.nth(0), list.nth(1)]) await expect(row).toContainText(WEAKNESS);
    await expect(list.nth(2)).not.toContainText('売りのサイン');
    expect(errors).toEqual([]);
  });

  test('a quiet watch list reads 0件 once every check is in, beyond the 12-stock limit 未確認（上限12銘柄）', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': ['ZZNV', 'ZZKS'] } });
    const tile = page.getByTestId('brief-summary').getByRole('link', { name: /ウォッチの注意/ });
    await expect(tile).toContainText('ウォッチの注意0件2銘柄を確認・保有未登録');
    await page.evaluate(symbols => localStorage.setItem('research-watch', JSON.stringify(symbols)), rows.slice(0, 13).map(row => row.symbol));
    await page.reload();
    await expect(tile).toContainText('ウォッチの注意未確認12/13を確認・上限超1・保有未登録', { timeout: 30000 });
    await page.goto('/#/brief/watch');
    const limited = page.getByRole('region', { name: 'ウォッチ中の銘柄' }).locator('.brief-chip', { hasText: '売りのサイン 未確認（上限12銘柄）' });
    await expect(limited).toHaveCount(1);
    await expect(limited).toBeVisible();
    expect(errors).toEqual([]);
  });
});

// A watched symbol this publication does not list is said, with its reason and a way to remove it, never dropped.
test.describe('a watched symbol the publication does not list', () => {
  test.use(phone(390, 844));
  test('leads the watch tab and Today\'s card with its reason and a 44px 外す, and the tile says it was not checked', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/watch', { storage: { 'research-watch': ['ZZNV', 'QQQX', 'ZZSD'] } });
    const tabs = page.getByRole('navigation', { name: 'ブリーフの画面' });
    const region = page.getByRole('region', { name: 'ウォッチ中の銘柄' });
    await expect(region.getByTestId('brief-candidate')).toHaveCount(2);
    const unlisted = region.locator('.brief-rows > li').first();
    await expect(unlisted).toHaveText('QQQX：この公開（2026-10-02 引け）の分析対象に含まれていません（上場廃止・ティッカー変更・データ欠落など）。売りのサイン・位置は未確認外す（QQQX をウォッチから外す）');
    // The badge counts what the list shows.
    await expect(region.locator('.brief-rows > li')).toHaveCount(3);
    await expect(tabs.getByRole('link', { name: /ウォッチ/ }).locator('.brief-count')).toHaveText('3');
    const remove = unlisted.getByRole('button', { name: /^外す/ });
    expect((await remove.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect((await remove.boundingBox()).width).toBeGreaterThanOrEqual(44);
    await tabs.getByRole('link', { name: '今日' }).click();
    const card = page.getByRole('region', { name: 'ウォッチの状況' });
    await expect(card.locator('.brief-rows > li').first()).toContainText('QQQX：この公開（2026-10-02 引け）の分析対象に含まれていません');
    const tile = page.getByTestId('brief-summary').getByRole('link', { name: /ウォッチの注意/ });
    await expect(tile).toContainText('ウォッチの注意未確認2/3を確認・対象外1・保有未登録');
    await expect(tile).not.toContainText(/0件|未登録（/);
    await card.getByRole('button', { name: /^外す/ }).click();
    await expect(page.locator('.brief-toast')).toHaveText(/QQQX をウォッチから外しました/);
    await expect(card.locator('.brief-unlisted')).toHaveCount(0);
    await expect(tile).toContainText('ウォッチの注意0件2銘柄を確認・保有未登録');
    await expect(tabs.getByRole('link', { name: /ウォッチ/ }).locator('.brief-count')).toHaveText('2');
    expect(errors).toEqual([]);
  });
});

// Every watched stock is listed whatever the 候補 tab's search: the badge, the rows and the dock agree.
test.describe('the watch tab and the 候補 search', () => {
  test.use(phone(390, 844));
  test('a search typed on 候補 never hides a watched stock', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list', { storage: { 'research-watch': ['ZZNV', 'ZZKS', 'QQQX', 'ZZSD'] } });
    await page.getByRole('searchbox', { name: '銘柄を検索' }).fill('ZZNV');
    await expect(page.getByTestId('brief-candidate')).toHaveCount(1);
    const tabs = page.getByRole('navigation', { name: 'ブリーフの画面' });
    await tabs.getByRole('link', { name: /ウォッチ/ }).click();
    const region = page.getByRole('region', { name: 'ウォッチ中の銘柄' });
    await expect(region.getByTestId('brief-candidate')).toHaveCount(3);
    await expect(region.locator('.brief-rows > li')).toHaveCount(4);
    await expect(tabs.getByRole('link', { name: /ウォッチ/ }).locator('.brief-count')).toHaveText('4');
    // The stock screen steps through the same three listed rows.
    await region.getByTestId('brief-candidate').last().click();
    await expect(page.locator('.brief-dockpos .numeric')).toHaveText('3/3');
    await expect(page.locator('.brief-dockpos p')).toContainText('ウォッチ');
    expect(errors).toEqual([]);
  });
});

// The 375×812 budgets (brief-compact.spec.js) with a broken setup in the list, which the base fixture no longer
// has: the watch tab with five symbols (one unlisted), and Today with the compact spec's four (1286 then, E's +40)
// and with five.
test.describe('the 375×812 budgets with a broken setup', () => {
  test.use({ ...phone(375), contextOptions: { reducedMotion: 'reduce' } });
  const contentHeight = page => page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY));
  const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
  const WATCH4 = ['ZZNV', 'ZZZF', 'ZZSD', 'ZZKS'], WATCH5 = ['ZZNV', 'ZZZF', 'QQQX', 'ZZSD', 'ZZKS'];

  for (const [name, mutate] of [['no signal', undefined], ['a broken setup', broken('ZZSD')]]) test(`the watch tab fits 520 with five symbols, one unlisted, and ${name}`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/watch', { storage: { 'research-watch': WATCH5 }, mutate });
    const region = page.getByRole('region', { name: 'ウォッチ中の銘柄' });
    await expect(region.getByTestId('brief-candidate')).toHaveCount(4);
    await expect(page.locator('.brief-unlisted')).toHaveCount(1);
    if (mutate) await expect(region.getByTestId('brief-candidate').first().locator('.brief-chip', { hasText: WEAKNESS })).toBeVisible();
    await settled(page);
    expect(await contentHeight(page)).toBeLessThanOrEqual(520);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  for (const [watch, budget] of [[WATCH4, 1326], [WATCH5, 1400]]) test(`Today with ${watch.length} watched and one broken setup fits ${budget}`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': watch }, mutate: broken('ZZSD') });
    await expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate')).toHaveCount(5);
    await expect(page.getByRole('region', { name: 'ウォッチの状況' }).locator('.brief-sellchip')).toHaveCount(1);
    await settled(page);
    expect(await contentHeight(page)).toBeLessThanOrEqual(budget);
    // The tiles keep their height: 97 with every stock checked, one note line more with an unlisted symbol.
    const tiles = await page.getByTestId('brief-summary').locator('li').evaluateAll(items => items.map(li => Math.round(li.getBoundingClientRect().height)));
    for (const height of tiles) expect(Math.abs(height - (watch.length === 4 ? 97 : 115))).toBeLessThanOrEqual(2);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// A broken setup's row keeps its chips on two lines and its height within 100px (the list rows' rule), and nothing
// overflows. On Today the row keeps one title line and one chip line from 375px up.
for (const [width, options] of [[320, phone(320, 640)], [375, phone(375)], [390, phone(390, 844)], [1440, { viewport: { width: 1440, height: 900 } }]]) test.describe(`a broken setup's rows at ${width}px`, () => {
  test.use(options);
  test('chips on two lines, the row within 100px, no overflow', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/watch', { storage: { 'research-watch': ['ZZNV', 'ZZZF', 'QQQX', 'ZZSD', 'ZZKS'] }, mutate: broken('ZZSD') });
    const row = page.getByRole('region', { name: 'ウォッチ中の銘柄' }).getByTestId('brief-candidate').first();
    await expect(row).toHaveAttribute('data-symbol', 'ZZSD');
    const chip = row.locator('.brief-chip', { hasText: WEAKNESS });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('title', new RegExp(`^${WEAKNESS_FULL}：`));
    expect(await row.evaluate(node => new Set([...node.querySelectorAll('.brief-reasons .brief-chip')].map(c => c.offsetTop)).size)).toBeLessThanOrEqual(2);
    expect(await row.evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(100);
    expect(await horizontalOverflow(page)).toBe(0);
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '今日' }).click();
    const card = page.getByRole('region', { name: 'ウォッチの状況' });
    await expect(card.locator('.brief-unlisted')).toHaveCount(1);
    const event = card.locator('.brief-event[data-symbol="ZZSD"]');
    await expect(event.locator('.brief-sellchip')).toHaveCount(1);
    // One title line, one chip line and the pivot line (64px at 375 and 390, 71 at 1440).
    if (width >= 375) expect(await event.evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(78);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('the list across a stock round trip', () => {
  test.use(phone(390, 844));
  test('the list keeps its rows across a stock round trip and renders the stock last open', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list');
    const listRows = page.getByTestId('brief-candidate');
    const all = async () => { await page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^選定すべて/ }).click(); await expect(listRows).toHaveCount(20); };
    await all();
    await page.getByRole('button', { name: 'さらに表示（残り 1件）' }).click();
    await expect(listRows).toHaveCount(21);
    const last = await listRows.nth(20).getAttribute('data-symbol');
    await listRows.nth(20).click();
    await expect(page.locator('.brief-bar-title')).toContainText(last);
    await page.getByRole('button', { name: '戻る' }).click();
    await expect(listRows).toHaveCount(21);
    await expect(page.locator(`[data-testid="brief-candidate"][data-symbol="${last}"]`)).toHaveCount(1);
    // A new filter starts from one page again; stepping past the last row shown, 戻る renders the stock reached.
    await page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^買いゾーン/ }).click();
    await all();
    const twentieth = await listRows.nth(19).getAttribute('data-symbol');
    await listRows.nth(19).click();
    await expect(page.locator('.brief-bar-title')).toContainText(twentieth);
    await page.locator('.brief-dock').getByRole('button', { name: '次の候補' }).click();
    await expect(page.locator('.brief-bar-title')).toContainText(last);
    await page.getByRole('button', { name: '戻る' }).click();
    await expect(page.locator(`[data-testid="brief-candidate"][data-symbol="${last}"]`)).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});

// The sell card's qualifier is on the card at every width, next to a fired check, not only in the 注記.
for (const [width, options] of [[375, phone(375)], [1440, { viewport: { width: 1440, height: 900 } }]]) test.describe(`sell card qualifier at ${width}px`, () => {
  test.use(options);
  test('独自判定 and 売買の推奨ではありません are visible on the card beside a fired check', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZSD', { mutate: broken('ZZSD') });
    const sell = page.getByTestId('brief-sell');
    await expect(sell.locator('.is-sell-hit').first()).toBeVisible();
    await expect(sell.getByRole('heading', { level: 2 })).toHaveText('売りのサイン（独自判定）');
    await expect(sell).toContainText(/に出来高 2\.2倍で割れ、以降50日線の下（9営業日）/);
    const qualifier = sell.getByTestId('brief-sell-qualifier');
    await expect(qualifier).toBeVisible();
    await expect(qualifier).toContainText('独自判定');
    await expect(qualifier).toContainText('売買の推奨ではありません。');
    expect(errors).toEqual([]);
  });
});
