import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Only the daily market data below is synthetic. The scorecard request is left
// untouched and must serve the real, committed public archive byte-for-byte.
const archiveText = readFileSync(new URL('../../public/strategy-scorecard.json', import.meta.url), 'utf8');
const archive = JSON.parse(archiveText);
const date = '2026-09-29';
const entry = market => ({
  display_name: market === 'US' ? 'United States' : 'Hong Kong', as_of_date: date,
  pages: { home: { path: `${market}-home.json` }, scan: { path: `${market}-scan.json` } },
  assets: { charts: { path: `${market}-charts.json` } },
});
const rows = [{
  symbol: 'FIXTURE', company_name: 'Synthetic daily fixture', current_price: 100,
  passes_template: true, rs_rating: 95, volume: 150_000_000,
  market_cap: 2_000_000_000, currency: 'USD', composite_score: 90,
  code33: true, week_52_high_distance: -5, ibd_group_rank: 20,
}];

for (const width of [1440, 390]) {
  test(`Daily legacy archive stays distinct from technical candidates at ${width}px`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.route('**/static-data/**', route => {
      const file = new URL(route.request().url()).pathname.split('/').pop();
      const market = file.startsWith('HK-') ? 'HK' : 'US';
      const payload = file === 'manifest.json'
        ? { generated_at: `${date}T23:00:00Z`, as_of_date: date, default_market: 'US', supported_markets: ['US', 'HK'], markets: { US: entry('US'), HK: entry('HK') } }
        : file.endsWith('-home.json')
          ? { market_display_name: `${entry(market).display_name} · Synthetic daily fixture`, freshness: { scan_as_of_date: date }, key_markets: [], top_groups: [] }
          : file.endsWith('-scan.json')
            ? { initial_rows: rows, chunks: [], preset_screens: [], default_filters: { minVolume: 100_000_000 } }
            : { symbols: [] };
      return route.fulfill({ json: payload });
    });
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/strategy-scorecard.json'));
    await page.goto('/#/daily');
    expect(await (await responsePromise).text()).toBe(archiveText);
    const card = page.getByTestId('strategy-scorecard');
    const warning = page.getByTestId('legacy-evaluation-warning');
    await expect(card).toContainText('旧バックテスト記録');
    await expect(card).toContainText('現行手法は未再検証');
    await expect(card).toContainText(`${archive.window.start} 〜 ${archive.window.end}（約5年）`);
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('寄付きの判断・数量計算で当日終値を参照する先読み');
    await expect(warning).toContainText('旧集計への影響は未算定');
    await expect(warning).toContainText('上場廃止銘柄は復元していません');
    await expect(page.getByTestId('legacy-window-correction')).toContainText('run 30064735759');
    await expect(card).toContainText('run 30135665125');
    await expect(card).not.toContainText(/6年|ほぼ互角|不当に低く/);
    const candidates = page.getByTestId('backtest-aligned-section');
    await expect(candidates).toContainText('テクニカル参考候補 トップ20');
    await expect(candidates).toContainText('RS順に最大20銘柄');
    await expect(candidates).not.toContainText(/15\.2|CAGR|6年|同じ選び方|バックテスト準拠/);
    await page.evaluate(() => document.fonts.ready);
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await testInfo.attach(`daily-legacy-archive-${width}.png`, { body: await card.screenshot(), contentType: 'image/png' });
    await testInfo.attach(`daily-technical-reference-${width}.png`, { body: await candidates.screenshot(), contentType: 'image/png' });

    // Cached US performance must not leak into another market after navigation.
    await page.getByRole('combobox', { name: '市場切替' }).selectOption('HK');
    await expect(page).toHaveURL(/market=HK/);
    await expect(card).toHaveCount(0);
    await expect(candidates).toContainText('テクニカル参考候補 トップ20');
    await expect(candidates).not.toContainText(/15\.2|CAGR|同じ選び方|バックテスト準拠/);
    await page.getByRole('combobox', { name: '市場切替' }).selectOption('US');
    await expect(warning).toBeVisible();
    expect(errors).toEqual([]);
  });
}
