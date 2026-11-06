// Daily brief sell side on the stock screen: the sell card's qualifier beside a fired check, on synthetic data.
// (The watch rows and the watch tile that count a broken setup are brief-watch.spec.js's.)
import { test, expect } from '@playwright/test';
import { openBrief } from './brief-fixture.js';

const phone = (width, height = 812) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

/**
 * A heavy-volume break of the 50-day line nine sessions ago, the close still under the line: the bars before
 * it are lifted 15%, the session before it closes at its 50-day high, and the break day trades 2.2 times the
 * prior 50-day average (2.20×). The last close stays the row's price, so the bars stay certified for the analysis date.
 */
function breakBelow50(bars) {
  const n = bars.length, at = n - 9;
  for (let i = 0; i < at; i++) for (const key of ['open', 'high', 'low', 'close']) bars[i][key] *= 1.15;
  const top = Math.max(...bars.slice(at - 50, at - 1).map(bar => bar.close));
  Object.assign(bars[at - 1], { open: top, close: top, high: top * 1.005, low: top * 0.995 });
  // Rounded up, so the ratio is at least 2.2 and reads 2.20× (every ratio on screen is floored to 2 decimals).
  bars[at].volume = Math.ceil(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * 2.2);
}
const broken = (...symbols) => ({ charts: served => { for (const symbol of symbols) breakBelow50(served[`${symbol}.json`].bars); } });

// The sell card's qualifier is on the card at every width, next to a fired check, not only in the 注記.
for (const [width, options] of [[375, phone(375)], [1440, { viewport: { width: 1440, height: 900 } }]]) test.describe(`sell card qualifier at ${width}px`, () => {
  test.use(options);
  test('独自判定 and 売買の推奨ではありません are visible on the card beside a fired check', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZSD', { mutate: broken('ZZSD') });
    const sell = page.getByTestId('brief-sell');
    await expect(sell.locator('.is-sell-hit').first()).toBeVisible();
    await expect(sell.getByRole('heading', { level: 2 })).toHaveText('売りのサイン（独自判定）');
    await expect(sell).toContainText(/に出来高 2\.20×で割れ、以降50日線の下（9営業日）/);
    const qualifier = sell.getByTestId('brief-sell-qualifier');
    await expect(qualifier).toBeVisible();
    await expect(qualifier).toContainText('独自判定');
    await expect(qualifier).toContainText('売買の推奨ではありません。');
    expect(errors).toEqual([]);
  });
});
