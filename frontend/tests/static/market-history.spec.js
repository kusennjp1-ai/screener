import { test, expect } from '@playwright/test';
import { BOOK_MARKET_VERSION } from '../../src/static/bookMarketEvidence.js';
import { observation, series, payload } from '../../tools/fixtures/market-history.mjs';

// Synthetic route responses only. No market-data providers or live application APIs.
const date = '2026-10-09';
const history = payload(
  series('put_call_ratio', { observations: [observation(.72, '2026-10-08'), observation(null)] }),
  series('new_highs', { observations: [observation(0), observation(1)] }),
  series('new_highs', { population: 'second-synthetic-universe', observations: [observation(2)] }),
  series('new_lows'), series('new_lows', { market: 'HK' }),
  series('distribution_sp500', { observations: [observation(3, '2026-10-08')] }),
  series('institutional_holders', { observations: [observation(100, '2026-03-31'), observation(110, '2026-06-30')] }),
  series('base_count', { observations: [observation(2, '2026-09-30')] }),
  series('entry_breakouts'), series('entry_approaches', { observations: [{ ...observation(4), collected_at: null }] }),
);
const current = { date, stocks_up_4pct: 5, stocks_down_4pct: 4, ratio_5day: 1.1, ratio_10day: 1.2 };
const latest = { date, coverage: 100, expectedUniverseSize: 110, coveragePct: 100 / 110 * 100,
  newHighs: 3, newLows: 0, leaderCount: 12, setupProxyCount: 3, breakoutProxyCount: null,
  upVolume: 1000, downVolume: 500, upDollarVolume: 100000, downDollarVolume: 50000,
  cohort: { selectedAt: '2026-09-01', size: 45, observed: 44, missing: 1, below50: 0, lostLeaderStatus: 0,
    observedBelow50: 0, observedLostLeaderStatus: 0, meanReturnPct: 0, indexReturnPct: null } };

for (const width of [1440, 375]) test(`market history missing, zero, quarterly and conflicts at ${width}px`, async ({ page }, info) => {
  const errors = [], external = [];
  let missing = false;
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
  await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.route('**/static-data/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const data = name === 'manifest.json' ? {
      generated_at: '2026-10-10T01:00:00Z', as_of_date: date, default_market: 'US', supported_markets: ['US'],
      markets: { US: { as_of_date: date, pages: { breadth: { path: 'breadth.json' } }, assets: {} } },
    } : name === 'breadth.json' ? { payload: { current, chart_data: [current], market_indicator_history: missing ? undefined : history,
      book_market_evidence: { version: BOOK_MARKET_VERSION, as_of_date: date, currentSnapshotComplete: true, latest,
        series: [latest], breakoutEvents: [], methods: {}, unknowns: [] } } } : {};
    return route.fulfill({ json: data });
  });
  await page.goto('/#/breadth');
  await expect(page.getByRole('heading', { name: '市場環境', exact: true })).toBeVisible();
  await page.getByText('市場指標の履歴と未取得項目', { exact: true }).click();
  const region = page.getByRole('region', { name: '市場指標の履歴', exact: true });
  await expect(region.getByRole('heading', { level: 3 })).toHaveCount(6);
  await expect(region.getByText(/Nasdaq Composite 売り抜け日：比較可能な履歴は未取得/)).toBeVisible();
  await expect(region.getByText(/選択市場と異なる履歴を除外/)).toBeVisible();
  await expect(region.getByText('同一対象日の重複が矛盾', { exact: true })).toBeVisible();
  await expect(region.getByRole('table', { name: '新高値の履歴', exact: true })).toHaveCount(2);
  await expect(region.getByRole('table', { name: '新安値の履歴', exact: true }).getByRole('cell', { name: '0', exact: true })).toBeVisible();
  await expect(region.getByRole('region', { name: '市場全体のプットコールレシオ', exact: true })).toContainText('最新対象日 2026-10-09：未確認');
  const quarterly = region.getByRole('region', { name: '機関保有者数', exact: true });
  await expect(quarterly).toContainText('四半期観測（日次ではありません）');
  await expect(quarterly).toContainText('前四半期比 10');
  await expect(quarterly).toContainText('実際の購入者数');
  await expect(quarterly).toContainText('2026-10-10T01:00:00Z');
  await expect(region.getByRole('region', { name: 'ベースカウント', exact: true })).toContainText('手動確認');
  await expect(region.getByRole('region', { name: 'エントリー突破・接近銘柄数', exact: true })).toContainText('最新対象日 2026-10-09：未確認');
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: 'ライトモードに切り替え' }).click();
    await expect(region).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`market-history-${width}-${theme}.png`), fullPage: true });
  }
  await page.getByText('市場判断の根拠 — 新高値・先導株・出来高', { exact: true }).click();
  await expect(page.getByText(/固定した母集団全体/)).toContainText('50日線割れ 未確認 ／ 先導条件から外れた銘柄 未確認');
  await expect(page.getByText(/観測できた 44銘柄だけの内訳/)).toContainText('50日線割れ 0 ／ 先導条件外 0');
  await page.getByText('上放れ代理条件の発生日（直近20件・発生順）', { exact: true }).click();
  await expect(page.getByText('この期間の発生件数は未確認です。', { exact: true })).toBeVisible();
  await expect(page.getByText(/未確認を0件として扱いません/)).toBeVisible();
  missing = true;
  await page.reload();
  await page.getByText('市場指標の履歴と未取得項目', { exact: true }).click();
  await expect(region.getByText(/比較可能な履歴は未取得です/)).toHaveCount(9);
  expect(errors).toEqual([]);
  // Existing CSS requests Google Fonts. Keep those blocked and render fallback
  // fonts; any other external request is unexpected in this synthetic flow.
  expect(external.filter(url => new URL(url).hostname !== 'fonts.googleapis.com')).toEqual([]);
  await info.attach('network-isolation', { body: JSON.stringify({ blockedFontRequests: external.length, unexpectedExternalRequests: 0 }), contentType: 'application/json' });
});
