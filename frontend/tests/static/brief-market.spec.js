// Daily brief market tab: today's 「地合い」, the long-run 「市場環境の推移」 with its metric
// switch, and a long history that stops before the analysis date (never shown as today's).
import { test, expect } from '@playwright/test';
import { date, openBrief, VIEWPORTS, horizontalOverflow, sessions } from './brief-fixture.js';

const STALE = sessions.at(-3), STALE_MD = STALE.slice(5).split('-').map(Number).join('/');

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`${name} ${device.viewport.width}px`, () => {
  test.use(device);

  test('today\'s 地合い card leads to the market tab and its metric switch', async ({ page }) => {
    const { errors, external } = await openBrief(page, '#/brief');
    const today = page.getByRole('region', { name: '地合い' });
    await expect(today.getByTestId('brief-regime')).toContainText('上昇トレンド（独自判定）');
    await expect(today.getByRole('img', { name: /^S&P 500 の終値と50日線（.*〜2026-10-02）。有効な分配日 3日$/ })).toBeVisible();
    await expect(today.locator('.brief-fact small')).toHaveText(['分配日（25日）', 'TT達成数', '200日線より上', '52週の新高値・新安値']);
    for (const fact of await today.locator('.brief-fact').all()) await expect(fact).not.toContainText(/未取得|未確認/);
    await expect(today.locator('.brief-asof')).toHaveCount(0);
    await today.getByRole('link', { name: /市場の詳細/ }).click();
    await expect(page).toHaveURL(/#\/brief\/market$/);

    await expect(page.getByRole('heading', { level: 1, name: '市場' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '市場' })).toHaveAttribute('aria-current', 'page');
    const market = page.getByRole('region', { name: '地合い' });
    await expect(market.getByTestId('brief-regime')).toContainText('上昇トレンド（独自判定）');
    await expect(market.getByRole('link', { name: /市場の詳細/ })).toHaveCount(0);
    await expect(market.locator('.brief-fact small')).toContainText(['フォロースルーデー（独自判定）', '分配日（25日）', 'TT達成数', '200日線より上', '50日線より上', 'ブレイクアウト成功率', 'RS90以上のTT達成', '52週の新高値・新安値']);
    const follow = market.locator('.brief-ftd');
    await expect(follow.locator('.brief-ftd-row')).toHaveCount(2);
    await expect(follow.locator('.brief-ftd-row').first()).toContainText(/S&P確認 \d+\/\d+\+1\.6%・反発5日目・FTD後の有効な分配日3/);
    await expect(follow.locator('.brief-ftd-row').last()).toContainText(/NAS反発3日目安値\d+\/\d+・4日目以降/);
    await expect(market.locator('.brief-fact').filter({ hasText: '50日線より上' })).toContainText('50.0%観測100中50銘柄');
    // With a complete publication no market-tab tile is left unknown, and nothing is dated as older.
    for (const fact of await market.locator('.brief-fact').all()) await expect(fact).not.toContainText(/未取得|未確認|未収録|未算出|算出不可|未集計/);
    await expect(market.locator('.brief-fact-asof')).toHaveCount(0);
    await expect(market.getByRole('img', { name: /^ステージ構成 ステージ1 / })).toBeVisible();
    await expect(market.locator('.brief-asof')).toHaveCount(0);

    const history = page.getByRole('region', { name: '市場環境の推移' });
    await expect(history.locator('[data-update-state]')).toHaveAttribute('data-update-state', 'current');
    await expect(history.locator('[data-update-state]')).toHaveText(/10\/02 · 長期履歴反映/);
    const metrics = history.getByRole('group', { name: '長期推移の指標' });
    const chart = history.locator('.market-history-explorer').getByRole('img');
    await expect(metrics.getByRole('button', { name: 'トレンドテンプレート達成数' })).toHaveAttribute('aria-pressed', 'true');
    await expect(chart).toHaveAccessibleName(new RegExp(`^トレンドテンプレート達成数の長期推移。.*から${date}。`));
    for (const [label, readout] of [['ステージ構成', 'ステージ2'], ['移動平均線の上', '200日線上'], ['ブレイクアウトの成功率', '10日間 −7%に届かず']]) {
      await metrics.getByRole('button', { name: label }).click();
      await expect(metrics.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
      await expect(metrics.getByRole('button', { name: 'トレンドテンプレート達成数' })).toHaveAttribute('aria-pressed', 'false');
      await expect(chart).toHaveAccessibleName(new RegExp(`^${label}の長期推移。.*から${date}。`));
      await expect(history.locator('.market-history-explorer .market-trend-readout')).toContainText(readout);
    }
    const before = await chart.getAttribute('aria-labelledby').then(id => page.locator(`[id="${id}"]`).textContent());
    await history.getByRole('group', { name: '先導株と広がりの表示期間' }).getByRole('button', { name: '2年' }).click();
    await expect(chart).not.toHaveAccessibleName(before);
    await expect(history.getByRole('list', { name: /のセクター順位/ }).getByRole('listitem')).toHaveCount(11);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });

  test(`a long history that ends before the analysis date shows its as-of session`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { historyEnd: STALE });
    // The stocks are current; only the market series are older and say so.
    await expect(page.getByRole('heading', { level: 1, name: '10月2日（金）の判断' })).toBeVisible();
    const note = `長期集計は ${STALE} 時点・分配日は ${STALE} 時点（分析基準日 ${date} の再集計待ち）`;
    const today = page.getByRole('region', { name: '地合い' });
    await expect(today.getByRole('note').filter({ hasText: '時点' })).toHaveText(note);
    // The exporter withholds today's distribution count for an index that ends early; the older count keeps its date.
    await expect(today.locator('.brief-fact').filter({ hasText: '分配日（25日）' })).toContainText(`（${STALE_MD}時点）`);
    await expect(today.locator('.brief-fact').filter({ hasText: 'TT達成数' })).toContainText(`（${STALE_MD}時点）`);
    await expect(today.getByRole('img', { name: new RegExp(`^S&P 500 の終値と50日線（.*〜${STALE}）`) })).toBeVisible();

    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '市場' }).click();
    await expect(page).toHaveURL(/#\/brief\/market$/);
    const market = page.getByRole('region', { name: '地合い' });
    await expect(market.getByRole('note').filter({ hasText: '時点' })).toHaveText(note);
    await expect(market.locator('.brief-ftd .brief-ftd-row')).toHaveText([new RegExp(`^S&P確認 .*（${STALE_MD}時点）`), new RegExp(`^NAS反発3日目（${STALE_MD}時点）`)]);
    const history = page.getByRole('region', { name: '市場環境の推移' });
    await expect(history.locator('[data-update-state]')).toHaveAttribute('data-update-state', 'pending');
    await expect(history.locator('[data-update-state]')).toHaveText(/10\/02 履歴更新待ち/);
    await expect(history.locator('.market-history-explorer').getByRole('img')).toHaveAccessibleName(new RegExp(`から${STALE}。`));
    await expect(history.locator('.market-history-explorer .market-trend-readout time')).toHaveText(STALE);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
