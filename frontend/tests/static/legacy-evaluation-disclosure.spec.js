import { test, expect } from '@playwright/test';
// Daily rows are synthetic; the retired archive must never be requested or rendered.
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
  test(`Daily page omits retired performance results at ${width}px`, async ({ page }, testInfo) => {
    const errors = [];
    const archiveRequests = [];
    page.on('request', request => {
      if (request.url().includes('strategy-scorecard.json')) archiveRequests.push(request.url());
    });
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
    await page.goto('/#/daily');
    const card = page.getByTestId('strategy-scorecard');
    const warning = page.getByTestId('legacy-evaluation-warning');
    await expect(card).toHaveCount(0);
    await expect(warning).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/15\.2|CAGR|6年|旧バックテスト記録/);
    const candidates = page.getByTestId('backtest-aligned-section');
    await expect(candidates).toContainText('テクニカル参考候補 トップ20');
    await expect(candidates).toContainText('RS順に最大20銘柄');
    await expect(candidates).not.toContainText(/15\.2|CAGR|6年|同じ選び方|バックテスト準拠/);
    await page.evaluate(() => document.fonts.ready);
    expect(await candidates.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    // Persist files inside test-results as well as reporter attachments: CI
    // uploads that directory even when its reporter does not save body blobs.
    for (const [name, locator] of [['technical-reference', candidates]]) {
      const file = `daily-${name}-${width}.png`, path = testInfo.outputPath(file);
      await locator.screenshot({ path });
      await testInfo.attach(file, { path, contentType: 'image/png' });
    }

    // Neither market may restore the retired card on repeated navigation.
    await page.getByRole('combobox', { name: '市場切替' }).selectOption('HK');
    await expect(page).toHaveURL(/market=HK/);
    await expect(card).toHaveCount(0);
    await expect(candidates).toContainText('テクニカル参考候補 トップ20');
    await expect(candidates).not.toContainText(/15\.2|CAGR|同じ選び方|バックテスト準拠/);
    await page.getByRole('combobox', { name: '市場切替' }).selectOption('US');
    await expect(warning).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/15\.2|CAGR|6年|旧バックテスト記録/);
    expect(archiveRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}
