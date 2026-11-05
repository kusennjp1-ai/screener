// Daily brief watch list: Today's watch rows and their folding while the sell checks load, the list's
// rows across a stock round trip, and the sell card's qualifier, on synthetic data.
import { test, expect } from '@playwright/test';
import { openBrief, charts, rowBySymbol } from './brief-fixture.js';

const phone = (width, height = 812) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

test.describe('expanders and tabs by keyboard', () => {
  test.use(phone(390, 844));

  test('Today folds the watch rows beyond the first three, never one with a sell signal', async ({ page }) => {
    const watch = ['ZZNV', 'ZZKS', 'ZZZF', 'ZZOD', 'ZZSD'];
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': watch } });
    const card = page.getByRole('region', { name: 'ウォッチの変化' });
    await expect(card.getByRole('button', { name: /ZZSD/ })).toContainText('売りのサイン');
    await expect(card.locator('.brief-event')).toHaveCount(4);
    const more = card.getByRole('button', { name: 'さらに表示（残り 1件）' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(card.locator('.brief-event')).toHaveCount(5);
    await expect(card.getByRole('button', { name: '表示を減らす' })).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('the list keeps its rows across a stock round trip and renders the stock last open', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list');
    const rows = page.getByTestId('brief-candidate');
    const all = async () => { await page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^選定すべて/ }).click(); await expect(rows).toHaveCount(20); };
    await all();
    await page.getByRole('button', { name: 'さらに表示（残り 1件）' }).click();
    await expect(rows).toHaveCount(21);
    const last = await rows.nth(20).getAttribute('data-symbol');
    await rows.nth(20).click();
    await expect(page.locator('.brief-bar-title')).toContainText(last);
    await page.getByRole('button', { name: '戻る' }).click();
    await expect(rows).toHaveCount(21);
    await expect(page.locator(`[data-testid="brief-candidate"][data-symbol="${last}"]`)).toHaveCount(1);
    // A new filter starts from one page again; stepping past the last row shown, 戻る renders the stock reached.
    await page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^買いゾーン/ }).click();
    await all();
    const twentieth = await rows.nth(19).getAttribute('data-symbol');
    await rows.nth(19).click();
    await expect(page.locator('.brief-bar-title')).toContainText(twentieth);
    await page.locator('.brief-dock').getByRole('button', { name: '次の候補' }).click();
    await expect(page.locator('.brief-bar-title')).toContainText(last);
    await page.getByRole('button', { name: '戻る' }).click();
    await expect(page.locator(`[data-testid="brief-candidate"][data-symbol="${last}"]`)).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('Today folds nothing while the sell checks load, and never a row whose check is unknown', async ({ page }) => {
    const watch = ['ZZNV', 'ZZKS', 'ZZZF', 'ZZOD', 'ZZSD'];
    const { errors } = await openBrief(page, '#/brief/market', { storage: { 'research-watch': watch } });
    // Hold every chart (the sell checks read them) until released; registered last, so it runs first.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const files = new Set(Object.keys(charts));
    await page.route(url => files.has(url.pathname.split('/').pop()), async route => { await gate; await route.fallback(); });
    await page.goto('/#/brief');
    await page.reload();
    const card = page.getByRole('region', { name: 'ウォッチの変化' });
    await expect(card.locator('.brief-event')).toHaveCount(5);
    await expect(card.locator('.brief-morebutton')).toHaveCount(0);
    await expect(card.locator('.brief-sellchip')).toHaveCount(0);
    release();
    // Once every check is in: the first three, plus the row with a signal; the quiet one folds.
    await expect(card.getByRole('button', { name: /ZZSD/ })).toContainText('売りのサイン');
    await expect(card.locator('.brief-event')).toHaveCount(4);
    await expect(card.getByRole('button', { name: 'さらに表示（残り 1件）' })).toBeVisible();
    // A check that cannot be made (its chart fails) is 未確認: that row stays in view like a fired one.
    const failing = rowBySymbol.ZZZF.chart_path.split('/').pop();
    await page.route(url => url.pathname.endsWith(`/${failing}`), route => route.fulfill({ status: 404, json: {} }));
    await page.reload();
    await expect(card.getByRole('button', { name: /ZZZF/ })).toContainText('売りのサイン 未確認', { timeout: 30000 });
    await expect(card.locator('.brief-event')).toHaveCount(5);
    await expect(card.locator('.brief-morebutton')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

// The sell card's qualifier is on the card at every width, next to a fired check, not only in the 注記.
for (const [width, options] of [[375, phone(375)], [1440, { viewport: { width: 1440, height: 900 } }]]) test.describe(`sell card qualifier at ${width}px`, () => {
  test.use(options);
  test('独自判定 and 売買の推奨ではありません are visible on the card beside a fired check', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZSD');
    const sell = page.getByTestId('brief-sell');
    await expect(sell.locator('.is-sell-hit').first()).toBeVisible();
    await expect(sell.getByRole('heading', { level: 2 })).toHaveText('売りのサイン（直近5営業日・独自判定）');
    const qualifier = sell.getByTestId('brief-sell-qualifier');
    await expect(qualifier).toBeVisible();
    await expect(qualifier).toContainText('独自判定');
    await expect(qualifier).toContainText('売買の推奨ではありません。');
    expect(errors).toEqual([]);
  });
});
