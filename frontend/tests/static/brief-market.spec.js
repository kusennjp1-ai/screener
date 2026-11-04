// Daily brief market tab: today's 「地合い」 (Today keeps four tiles; the market tab leads with the
// verdict and the warning summary, then three groups of rows that open to their rule), the long-run
// 「市場環境の推移」 with its metric switch, an older long-history schema, and a long history that stops
// before the analysis date (never shown as today's).
import { test, expect } from '@playwright/test';
import { date, openBrief, VIEWPORTS, horizontalOverflow, sessions } from './brief-fixture.js';

const STALE = sessions.at(-3), STALE_MD = STALE.slice(5).split('-').map(Number).join('/'), DATE_MD = date.slice(5).split('-').map(Number).join('/');
const row = (market, label) => market.locator('.brief-env-row').filter({ has: market.page().locator('small', { hasText: label }) });
/** Below 1024px the market tab shows one section at a time behind its tabs; the desktop shows them all. */
const section = async (page, name) => { const tab = page.getByRole('tablist', { name: '市場タブの表示' }).getByRole('tab', { name: new RegExp(`^${name}`) }); if (await tab.count()) { await tab.click(); await expect(tab).toHaveAttribute('aria-selected', 'true'); } };
// The 地合い card's own as-of stamp (the sector ranks inside its 推移 section carry their own).
const stamp = market => market.locator(':scope > .brief-step .brief-stamp');

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`${name} ${device.viewport.width}px`, () => {
  test.use(device);
  const phone = name === 'phone';

  test('today\'s 地合い card leads to the market tab and its metric switch', async ({ page }) => {
    const { errors, external } = await openBrief(page, '#/brief');
    const today = page.getByRole('region', { name: '地合い' });
    await expect(today.getByTestId('brief-regime')).toContainText('上昇トレンド（独自判定）');
    // The phone's Today keeps the S&P chart for the market tab; its first screen shows the tiles and a candidate.
    if (phone) {
      await expect(today.locator('.brief-index')).toHaveAttribute('aria-label', /^S&P 500 の終値と50日線（.*〜2026-10-02）。有効な分配日 3日$/);
      await expect(today.locator('.brief-index')).toBeHidden();
      await expect(today.getByTestId('brief-regime')).toBeHidden();
    } else await expect(today.getByRole('img', { name: /^S&P 500 の終値と50日線（.*〜2026-10-02）。有効な分配日 3日$/ })).toBeVisible();
    await expect(today.locator('.brief-fact small')).toHaveText(['分配日（25日）', 'TT達成数', '200日線より上', '52週の新高値・新安値']);
    for (const fact of await today.locator('.brief-fact').all()) await expect(fact).not.toContainText(/未取得|未確認/);
    await expect(today.locator('.brief-asof')).toHaveCount(0);
    await today.getByRole('link', { name: /市場の詳細/ }).click();
    await expect(page).toHaveURL(/#\/brief\/market$/);

    await expect(page.getByRole('heading', { level: 1, name: '市場' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '市場' })).toHaveAttribute('aria-current', 'page');
    const market = page.getByRole('region', { name: '地合い' });
    await expect(market.getByTestId('brief-regime')).toContainText('上昇トレンド（独自判定）新規の買いを検討できます。エクスポージャーの目安最大 50%');
    await expect(market.getByTestId('brief-regime')).toContainText(`根拠（${DATE_MD}スキャン時点）：S&P 500（SPY）が50日線・200日線の上`);
    await expect(stamp(market)).toHaveText(`◷ ${DATE_MD} 引け`);
    await expect(market.getByRole('link', { name: /市場の詳細/ })).toHaveCount(0);
    // The phone's Today hides the verdict and the chart; the market tab keeps both visible.
    await expect(market.getByTestId('brief-regime')).toBeVisible();
    await expect(market.getByRole('img', { name: /^S&P 500 の終値と50日線（.*〜2026-10-02）。有効な分配日 3日$/ })).toBeVisible();
    // Verdict first, then the evidence grouped in decision order: index trend, participation, leaders.
    await expect(market.locator('.brief-env-group h3')).toHaveText(['指数のトレンド', '市場の参加度', 'リーダーの健全性']);
    // A phone shows the index section first, the others behind tabs that count their warnings and mark, with a
    // neutral 「?」, a section holding a check that could not be judged (here TT達成数の急減 and リーダーの健全度).
    if (phone) await expect(page.getByRole('tablist', { name: '市場タブの表示' }).getByRole('tab')).toHaveText(['指数', '参加度▲注意1?未確認あり', 'リーダー?未確認あり', '推移']);
    await expect(market.locator('.brief-fact small')).toContainText(['フォロースルーデー（独自判定）', '分配日（25日）', '200日線より上', '50日線より上', '52週の新高値・新安値', 'TT達成数', 'RS90以上のTT達成', 'ブレイクアウト成功率', 'リーダーの健全度', 'ステージ構成']);
    // The fixture has more new lows (3) than new highs (2): one sentence under the verdict, ▲ 注意 on its row and group.
    const signals = market.getByRole('group', { name: '注意サイン（独自判定）' });
    await expect(signals.getByRole('listitem').filter({ hasText: '新安値（3）が新高値（2）を上回る' })).toHaveCount(1);
    await expect(row(market, '52週の新高値・新安値').locator('.brief-env-status')).toHaveText('▲注意');
    await expect(row(market, '50日線より上').locator('.brief-env-status')).toHaveText('');
    await section(page, '参加度');
    await expect(market.getByRole('group', { name: /^市場の参加度/ }).locator('.brief-env-state')).toContainText('注意');
    const follow = market.locator('.brief-ftd');
    await expect(follow.locator('.brief-ftd-row')).toHaveCount(2);
    await expect(follow.locator('.brief-ftd-row').first()).toContainText(/S&P確認 \d+\/\d+\+1\.6%・反発5日目・FTD後の有効な分配日3/);
    await expect(follow.locator('.brief-ftd-row').last()).toContainText(/NAS反発3日目安値\d+\/\d+・4日目以降/);
    // A row shows its value and one-month change; opening it shows the count behind the share and the rule.
    const above50 = row(market, '50日線より上');
    await expect(above50).toContainText('50.0%±0.0pt 1か月比');
    await above50.getByRole('button', { name: /^50日線より上/ }).click();
    await expect(above50.getByRole('button', { name: /^50日線より上/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(above50.locator('.brief-env-detail')).toContainText('観測100中50銘柄');
    await expect(above50.locator('.brief-env-detail')).toContainText('基準終値が50日線より上の銘柄の割合');
    // With a complete publication no market-tab tile is left unknown, and nothing is dated as older.
    for (const fact of await market.locator('.brief-fact').all()) await expect(fact).not.toContainText(/未取得|未確認|未収録|未算出|算出不可|未集計/);
    await expect(market.locator('.brief-fact-asof')).toHaveCount(0);
    await section(page, 'リーダー');
    await expect(market.getByRole('img', { name: /^ステージ構成 ステージ1 / })).toBeVisible();
    await expect(market.locator('.brief-asof')).toHaveCount(0);

    await section(page, '推移');
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
    // A row's link opens its metric in the long-run chart (on a phone, in the 推移 section) and moves focus to the chart's heading.
    await section(page, '参加度');
    await above50.getByRole('button', { name: '市場環境の推移で見る' }).click();
    if (phone) await expect(page.getByRole('tab', { name: '推移' })).toHaveAttribute('aria-selected', 'true');
    await expect(metrics.getByRole('button', { name: '移動平均線の上' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(':focus')).toHaveText('広がりと先導株');
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });

  test('a market series that cannot be fetched is named a delivery failure, without its path, and keeps the layout', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { fail: 'series' });
    const today = page.getByRole('region', { name: '地合い' });
    await expect(today.getByRole('alert')).toHaveText('市場推移データを取得できません（配信ファイルが見つかりません）。数値は表示しません。');
    await expect(today.locator('.brief-fact').filter({ hasText: 'TT達成数' })).toContainText('取得できません配信エラー');
    expect(await horizontalOverflow(page)).toBe(0);
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '市場' }).click();
    const market = page.getByRole('region', { name: '地合い' });
    await expect(market.getByRole('alert')).toHaveText('市場推移データを取得できません（配信ファイルが見つかりません）。数値は表示しません。');
    // Each group says once that it shows nothing, instead of a row of the same failure each.
    await expect(market.locator('.brief-env-group .brief-missing')).toHaveText(Array(3).fill('市場推移データを取得できないため表示しません。'));
    await expect(market.locator('.brief-env-row')).toHaveCount(0);
    await section(page, '推移');
    await expect(page.getByRole('region', { name: '市場環境の推移' }).getByRole('alert')).toHaveText('長期履歴を取得できません（配信ファイルが見つかりません）。');
    await expect(page.locator('main')).not.toContainText(/series-|[a-f0-9]{16}|整合性/);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a manifest that fails leaves publication unknown, never 未配信', async ({ page }) => {
    await openBrief(page, '#/brief/market', { fail: 'manifest' });
    const market = page.getByRole('region', { name: '地合い' });
    await expect(market.getByRole('alert')).toHaveText('市場推移データを取得できません（公開情報を読み込めません）。数値は表示しません。');
    await expect(market.locator('.brief-env-group .brief-missing')).toHaveText(Array(3).fill('市場推移データを取得できないため表示しません。'));
    await expect(market).not.toContainText(/未配信|含まれていません/);
    expect(await horizontalOverflow(page)).toBe(0);
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
    if (phone) await expect(today.locator('.brief-index')).toHaveAttribute('aria-label', new RegExp(`^S&P 500 の終値と50日線（.*〜${STALE}）`));
    else await expect(today.getByRole('img', { name: new RegExp(`^S&P 500 の終値と50日線（.*〜${STALE}）`) })).toBeVisible();

    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '市場' }).click();
    await expect(page).toHaveURL(/#\/brief\/market$/);
    const market = page.getByRole('region', { name: '地合い' });
    // The market tab dates the whole block once and the verdict on its own date.
    await expect(market.getByRole('note').filter({ hasText: '時点' })).toHaveText(`市場データは${STALE_MD}引け時点（分析基準日${DATE_MD}の再集計待ち）。日付が異なる項目には個別に日付を付けています。`);
    await expect(market.getByTestId('brief-regime')).toContainText(`判定 ${DATE_MD}`);
    await expect(stamp(market)).toHaveCount(0);
    await expect(market.getByRole('group', { name: '注意サイン（独自判定）' })).toContainText(`（${STALE_MD}時点・独自判定）`);
    // Each group whose values all describe the older session says so once; its rows carry no date of their own.
    for (const [tab, name] of [['指数', '指数のトレンド'], ['参加度', '市場の参加度'], ['リーダー', 'リーダーの健全性']]) { await section(page, tab); await expect(market.getByRole('group', { name: `${name} ${STALE_MD}時点の値` })).toBeVisible(); }
    await expect(market.locator('.brief-ftd .brief-ftd-row')).toHaveText([/^S&P確認 /, /^NAS反発3日目/]);
    await expect(market.locator('.brief-fact-asof')).toHaveCount(0);
    await section(page, '推移');
    const history = page.getByRole('region', { name: '市場環境の推移' });
    await expect(history.locator('[data-update-state]')).toHaveAttribute('data-update-state', 'pending');
    await expect(history.locator('[data-update-state]')).toHaveText(/10\/02 履歴更新待ち/);
    await expect(history.locator('.market-history-explorer').getByRole('img')).toHaveAccessibleName(new RegExp(`から${STALE}。`));
    await expect(history.locator('.market-history-explorer .market-trend-readout time')).toHaveText(STALE);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('an older long-history schema is named once per group and never read as all clear', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { schema: 'old' });
    const today = page.getByRole('region', { name: '地合い' });
    // Today keeps four tiles, each named by what it shows.
    await expect(today.locator('.brief-fact small')).toHaveText(['分配日（25日）', '先導株数（価格条件）', '50日線より上', '52週の新高値・新安値']);
    await expect(today.locator('.brief-fact').nth(1)).toContainText('TT達成数は旧形式で未収録');
    for (const fact of await today.locator('.brief-fact').all()) await expect(fact).not.toContainText(/未取得|未確認/);
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '市場' }).click();
    const market = page.getByRole('region', { name: '地合い' });
    await expect(market.getByTestId('brief-missing-breadth')).toHaveText(`旧形式の長期集計（${DATE_MD}）には未収録：200日線より上・TT達成数`);
    await expect(market.getByTestId('brief-missing-leaders')).toHaveText(`旧形式の長期集計（${DATE_MD}）には未収録：RS90以上のTT達成（独自RS）・ブレイクアウト成功率・リーダーの健全度・ステージ構成`);
    // A phone's tabs mark the sections that hold 未収録 values or unjudged checks, and the history awaiting its update.
    if (phone) await expect(page.getByRole('tablist', { name: '市場タブの表示' }).getByRole('tab')).toHaveText(['指数', '参加度▲注意1?未確認あり', 'リーダー?未確認あり', '推移?更新待ち']);
    // The desktop says which checks and why on one line; a phone names them on the summary line and folds the reason.
    const unjudged = market.getByRole('group', { name: '注意サイン（独自判定）' });
    if (phone) {
      await expect(unjudged.locator('summary')).toHaveText('判定していない項目 5件：指数と個別株の乖離・TT達成数の急減・ステージ構成・リーダーの健全度・ブレイクアウト成功率');
      await unjudged.locator('summary').click();
      await expect(unjudged.getByText('理由：旧形式の長期集計に未収録')).toBeVisible();
    } else await expect(unjudged).toContainText('判定していない項目 5件：指数と個別株の乖離・TT達成数の急減・ステージ構成・リーダーの健全度・ブレイクアウト成功率（旧形式の長期集計に未収録）');
    await expect(market.locator('.brief-fact small')).toHaveText(['フォロースルーデー（独自判定）', '分配日（25日）', '50日線より上', '52週の新高値・新安値', '先導株数（価格条件）']);
    for (const fact of await market.locator('.brief-fact').all()) await expect(fact).not.toContainText(/未取得|未確認|未算出/);
    await section(page, '推移');
    const metrics = page.getByRole('region', { name: '市場環境の推移' }).getByRole('group', { name: '長期推移の指標' });
    await expect(metrics.getByRole('button', { name: '先導株数（価格条件）' })).toHaveAttribute('aria-pressed', 'true');
    await expect(metrics.getByRole('button', { name: 'トレンドテンプレート達成数' })).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// The index chart's lines once stopped partway across a chart wider than its 600-unit viewBox
// (a pathLength dash measured on screen under a non-scaling stroke). At a tablet width the single
// column makes the chart wide: both lines must end at the chart's right edge once drawn.
test('the index chart draws its lines to the right edge on a wide chart', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await openBrief(page, '#/brief/market');
  const chart = page.getByRole('region', { name: '地合い' }).locator('svg.brief-index');
  await expect(chart).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
  const drawn = await chart.evaluate(svg => {
    const box = svg.getBoundingClientRect();
    return { width: box.width, clip: getComputedStyle(svg).clipPath, lines: [...svg.querySelectorAll('.brief-index-line, .brief-index-ma')].map(path => {
      const end = path.getPointAtLength(path.getTotalLength()), m = path.getScreenCTM();
      return { dash: getComputedStyle(path).strokeDasharray, gap: box.right - (end.x * m.a + m.e) };
    }) };
  });
  expect(drawn.width).toBeGreaterThan(620);
  expect(drawn.clip).toBe('none');
  for (const line of drawn.lines) {
    expect(line.dash).toBe('none');
    expect(line.gap).toBeLessThan(8);
  }
});
