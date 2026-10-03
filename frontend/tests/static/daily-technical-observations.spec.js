import { test, expect } from '@playwright/test';
import { dailyObservationIndex } from '../../src/static/testDailyObservationFixture.js';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';

const date = dailyObservationIndex.as_of_date;
const rows = dailyObservationIndex.symbols.map(entry => withAuditFixture({
  symbol: entry.symbol, company_name: `Synthetic Research row for ${entry.symbol}`,
  market: 'US', currency: 'USD', current_price: entry.buy.last_close, se_pivot_price: entry.buy.trigger_price,
  chart_path: null, adv_usd: 5e7, rs_rating: entry.rs_rating, eps_rating: 92, composite_rating: 96,
  ibd_group_rank: 10, market_above_50dma: true, market_above_200dma: true,
}, date));

for (const width of [1440, 320]) test(`Daily observations lead to existing Research checks at ${width}px`, async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.clock.install({ time: new Date('2026-10-02T22:00:00Z') });
  await page.route('**/static-data/**', route => {
    const file = new URL(route.request().url()).pathname.split('/').pop();
    const payload = file === 'manifest.json'
      ? { generated_at: `${date}T23:00:00Z`, research_generation: 'daily-observation-fixture', as_of_date: date,
        default_market: 'US', supported_markets: ['US'], markets: { US: { display_name: 'United States', as_of_date: date,
          pages: { home: { path: 'home.json' }, scan: { path: 'scan.json' } },
          assets: { research: { path: 'research.json' }, charts: { path: 'charts-index.json' } } } } }
      : file === 'home.json' ? { market_display_name: 'United States', freshness: { scan_as_of_date: date }, key_markets: [], top_groups: [] }
        : file === 'scan.json' ? { initial_rows: rows, chunks: [], preset_screens: [], default_filters: {} }
          : file === 'charts-index.json' ? dailyObservationIndex
            : file === 'research.json' ? { as_of_date: date, rows } : {};
    return route.fulfill({ json: payload });
  });
  await page.goto('/#/daily');
  const card = page.getByTestId('todays-buys-card');
  await expect(card.getByRole('heading')).toHaveText('テクニカル観測記録');
  await expect(card).toContainText('最新取引日は未確認');
  await expect(card).not.toContainText(/BUY NOW|今日の買い候補|risk |size |2R|3R|43\.59|407\.69|78\.76|85\.32/);
  const cdna = page.getByTestId('todays-buys-row-CDNA'), ter = page.getByTestId('todays-buys-row-TER');
  await expect(cdna).toContainText('記録終値 66.23 · シグナル基準値 65.63');
  await expect(ter).toContainText('モデル停止水準 377.33 · 初期モデル');
  const watch = cdna.getByRole('button', { name: 'CDNAを監視リストに追加' });
  await watch.focus();
  await page.keyboard.press('Enter');
  const watchlist = page.getByTestId('watchlist-card');
  await expect(watchlist).toContainText('実際の保有・買値・注文は未確認');
  await expect(watchlist).not.toContainText(/要売却|保有継続|0\.1R/);
  const disclosure = ter.locator('summary');
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(ter.locator('details')).toHaveAttribute('open', '');
  await expect(ter).toContainText('別の売却モデルの参考値');
  await expect(page).toHaveURL(/#\/daily$/);
  await page.evaluate(() => document.fonts.ready);
  expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`daily-observations-${width}.png`), fullPage: true });

  const link = ter.getByRole('link', { name: 'TERの購入条件をResearchで確認' });
  // Primary row actions retain their target size despite the shell's compact-link defaults.
  for (const action of [link, watch, watchlist.getByRole('link', { name: 'CDNAの購入条件をResearchで確認' }), watchlist.getByRole('button', { name: 'CDNAを監視リストから外す' })]) {
    const bounds = await action.boundingBox();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.width).toBeGreaterThanOrEqual(44);
  }
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/\?symbol=TER$/);
  const detail = page.getByRole('region', { name: '銘柄詳細', exact: true });
  await expect(detail.getByRole('heading', { name: 'TER', exact: true })).toBeVisible();
  await expect(detail).toBeFocused();
  await detail.getByRole('tab', { name: '購入条件', exact: true }).click();
  await expect(detail.getByRole('tabpanel', { name: '購入条件', exact: true })).toContainText('取引カレンダー未取得');
  await page.goBack();
  await expect(card).toBeVisible();
  await page.goForward();
  await expect(detail.getByRole('heading', { name: 'TER', exact: true })).toBeVisible();
  await page.goBack();
  await cdna.getByRole('link', { name: 'CDNAの購入条件をResearchで確認' }).click();
  await expect(detail.getByRole('heading', { name: 'CDNA', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
