import { test, expect } from '@playwright/test';
import { BOOK_MARKET_VERSION } from '../../src/static/bookMarketEvidence.js';
import { observation, series, payload } from '../../tools/fixtures/market-history.mjs';

// Synthetic route responses only. No market-data providers or live application APIs.
const date = '2026-10-09';
const history = payload(
  series('put_call_ratio', { observations: [observation(.0000001, '2026-10-07'), observation(.72, '2026-10-08'), observation(null)] }),
  series('new_highs', { observations: [observation(0), observation(1)] }),
  series('new_highs', { population: 'second-synthetic-universe', observations: [observation(2)] }),
  series('new_lows'), series('new_lows', { market: 'HK' }),
  series('distribution_sp500', { observations: [observation(3, '2026-10-08')] }),
  // JSON replaces a sparse array hole with null; inherited slots and named
  // array properties are exercised as raw props in the component tests.
  series('distribution_nasdaq', { observations: [null] }),
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
  let missing = false, allMissing = false;
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
      book_market_evidence: { version: BOOK_MARKET_VERSION, as_of_date: date, currentSnapshotComplete: true,
        latest: allMissing ? { ...latest, cohort: { ...latest.cohort, observed: 0, missing: 45, observedBelow50: null, observedLostLeaderStatus: null, meanReturnPct: null } } : latest,
        series: [latest], breakoutEvents: [{ date: '2025-01-02', symbol: 'UNRELATED_SYNTH' }], methods: {}, unknowns: [] } } } : {};
    return route.fulfill({ json: data });
  });
  await page.goto('/#/breadth');
  await expect(page.getByRole('heading', { name: '市場環境', exact: true })).toBeVisible();
  await page.getByText('市場指標の履歴と未取得項目', { exact: true }).click();
  const region = page.getByRole('region', { name: '市場指標の履歴', exact: true });
  await expect(region.getByRole('heading', { level: 3 })).toHaveCount(6);
  await expect(region.getByText(/Nasdaq Composite 売り抜け日：比較可能な履歴は未取得/)).toBeVisible();
  await expect(region.getByText(/選択市場と異なる履歴を除外/)).toBeVisible();
  await expect(region.getByText('市場・母集団・方法・頻度・単位が不明または混在する系列を除外しました。', { exact: true })).toBeVisible();
  await expect(region.getByText('同一対象日の重複が矛盾', { exact: true })).toBeVisible();
  await expect(region.getByRole(width === 375 ? 'list' : 'table', { name: '新高値の履歴', exact: true })).toHaveCount(2);
  await expect(region.getByRole(width === 375 ? 'list' : 'table', { name: '新安値の履歴', exact: true }).getByText('0', { exact: true })).toBeVisible();
  await expect(region.getByRole('region', { name: '市場全体のプットコールレシオ', exact: true })).toContainText('最新対象日 2026-10-09：未確認');
  const quarterly = region.getByRole('region', { name: '機関保有者数', exact: true });
  await expect(quarterly).toContainText('四半期観測（日次ではありません）');
  await expect(quarterly).toContainText('前四半期比 10');
  await expect(quarterly).toContainText('実際の購入者数');
  await expect(quarterly).toContainText('2026-10-10T01:00:00Z');
  await expect(region.getByRole('region', { name: 'ベースカウント', exact: true })).toContainText('手動確認');
  await expect(region.getByRole('region', { name: 'エントリー突破・接近銘柄数', exact: true })).toContainText('最新対象日 2026-10-09：未確認');
  const measurements = [];
  const safeBox = async (locator, stage) => {
    const box = await locator.boundingBox();
    const header = await page.locator('.leader-header').boundingBox();
    const nav = width === 375 ? await page.locator('.leader-mobile-nav').boundingBox() : null;
    expect(box.x, stage).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, stage).toBeLessThanOrEqual(width);
    expect(box.y, stage).toBeGreaterThanOrEqual(header.y + header.height);
    expect(box.y + box.height, stage).toBeLessThanOrEqual(nav?.y ?? page.viewportSize().height);
    measurements.push({ stage, box, header, nav });
  };
  const setTheme = async theme => {
    if (await page.locator('.market-workbench').getAttribute('data-theme') !== theme) {
      await page.getByRole('button', { name: theme === 'light' ? 'ライトモードに切り替え' : 'ダークモードに切り替え' }).click();
    }
    await expect(page.locator('.market-workbench')).toHaveAttribute('data-theme', theme);
  };
  const capture = async (theme, stage) => {
    await expect(page.locator('.market-workbench')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: info.outputPath(`${width}-${theme}-${stage}.png`) });
  };
  for (const theme of ['dark', 'light']) {
    await setTheme(theme);
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(theme, 'before-scroll');
    const smallRatio = region.getByRole(width === 375 ? 'list' : 'table', { name: 'プットコールレシオの履歴', exact: true }).getByText('1E-7', { exact: true });
    await expect(smallRatio).toBeVisible();
    await smallRatio.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await safeBox(smallRatio, `${theme}-small-positive-ratio`);
    await capture(theme, 'history-small-positive-after-scroll');
    const approach = region.getByRole(width === 375 ? 'list' : 'table', { name: 'エントリー接近の履歴', exact: true });
    await approach.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await safeBox(approach, `${theme}-status-reason`);
    // Body overflow alone missed the original clipped inner table. Check every
    // history field and scroll container as well, without horizontal scrolling.
    const geometry = await region.locator('dd, td, th, .MuiTableContainer-root').evaluateAll(elements => elements.map(el => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent, left: r.left, right: r.right, client: el.clientWidth, scroll: el.scrollWidth };
    }));
    for (const box of geometry) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
    }
    measurements.push({ stage: `${theme}-history-fields`, geometry });
    await capture(theme, 'history-status-after-scroll');
    const zero = region.getByRole(width === 375 ? 'list' : 'table', { name: '新安値の履歴', exact: true });
    await zero.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await safeBox(zero, `${theme}-observed-zero`);
    await capture(theme, 'history-zero-after-scroll');
    await page.getByText('市場判断の根拠 — 新高値・先導株・出来高', { exact: true }).click();
    const cohortHeading = page.getByRole('heading', { name: '以前の先導候補を追跡', exact: true });
    await cohortHeading.evaluate(el => el.scrollIntoView({ block: 'start' }));
    const total = page.getByText(/固定した母集団全体/);
    const subset = page.getByText(/観測できた 44銘柄だけの内訳/);
    await expect(total).toContainText('50日線割れ 未確認 ／ 先導条件から外れた銘柄 未確認');
    await expect(subset).toContainText('50日線割れ 0 ／ 先導条件外 0');
    await expect(subset).toContainText('この部分集計の0件');
    await safeBox(total, `${theme}-cohort-total`);
    await safeBox(subset, `${theme}-cohort-observed-denominator`);
    await capture(theme, 'cohort-partial-after-scroll');
    const eventSummary = page.getByText('上放れ代理条件の発生日（直近20件・発生順）', { exact: true });
    await eventSummary.click();
    const warning = page.getByText('発生記録の対象日・銘柄または日別件数が履歴と一致しません。イベント一覧は表示しません。', { exact: true });
    await warning.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await safeBox(warning, `${theme}-event-inconsistency`);
    await expect(page.getByText('UNRELATED_SYNTH', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('table', { name: '上放れ代理条件の発生履歴' })).toHaveCount(0);
    await capture(theme, 'event-warning-after-scroll');
    // Reproduce focus landing near the bottom chrome, then verify native focus
    // and subsequent keyboard navigation (no corrective scroll in the test).
    await eventSummary.evaluate(el => { el.blur(); window.scrollBy(0, el.getBoundingClientRect().top - (innerHeight - 38)); });
    await eventSummary.focus();
    await safeBox(eventSummary, `${theme}-bottom-edge-focus`);
    await page.keyboard.press('Tab');
    await safeBox(page.locator(':focus'), `${theme}-next-keyboard-focus`);
    await capture(theme, 'keyboard-focus');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await safeBox(page.locator('.market-footnote'), `${theme}-document-bottom`);
    await capture(theme, 'footer-after-scroll');
    allMissing = true;
    await page.reload();
    await setTheme(theme);
    await page.getByText('市場判断の根拠 — 新高値・先導株・出来高', { exact: true }).click();
    await cohortHeading.evaluate(el => el.scrollIntoView({ block: 'start' }));
    const unavailable = page.getByText(/観測できた 0銘柄だけの内訳/);
    await expect(unavailable).toContainText('50日線割れ 未確認 ／ 先導条件外 未確認');
    await expect(unavailable).toContainText('対象日の構成銘柄データを取得できていない');
    await expect(page.getByText(/この部分集計の0件は/)).toHaveCount(0);
    await safeBox(unavailable, `${theme}-all-missing`);
    await capture(theme, 'cohort-all-missing-after-scroll');
    allMissing = false;
    await page.reload();
    await page.getByText('市場指標の履歴と未取得項目', { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await info.attach('visible-geometry', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
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
