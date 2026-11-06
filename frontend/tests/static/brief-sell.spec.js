// Daily brief sell side on the stock screen: the sell card's qualifier beside a fired check, on synthetic data.
// (The watch rows and the watch tile that count a broken setup are brief-watch.spec.js's.)
import { test, expect } from '@playwright/test';
import { openBrief, rowBySymbol, SEC_SYMBOL } from './brief-fixture.js';

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

// Round 2 (verdict): the 50-day alternative of the strength checks (VD6), the card's status line, and the
// failed breakout counted as a broken setup on a watched stock (VD2).
const fit = bar => { bar.high = Math.max(bar.high, bar.open, bar.close); bar.low = Math.min(bar.low, bar.open, bar.close); };
/**
 * ZZKS far extended with no pivot (its pivot 32% under the price is dropped, as a real row's is): every bar before
 * the last 20 at 60% of its price, then a 20-session run to the price, so the close is far above its 50-day line.
 */
const EXTENDED = {
  rows: rows => { const row = rows.find(r => r.symbol === 'ZZKS'); row.se_pivot_price = Math.round(row.current_price / 1.32 * 100) / 100; },
  charts: served => {
    const bars = served['ZZKS.json'].bars, n = bars.length;
    bars.forEach((bar, i) => { const f = i < n - 20 ? 0.6 : 0.6 + 0.4 * (i - (n - 21)) / 20; if (i < n - 1) for (const key of ['open', 'high', 'low', 'close']) bar[key] = Math.round(bar[key] * f * 100) / 100; fit(bar); });
  },
};
/** A pivot 2% above the price, crossed four sessions ago on 2.2× the prior 50-day volume, then closes back under it. */
const failedBreakout = symbol => ({
  rows: rows => { const row = rows.find(r => r.symbol === symbol); row.se_pivot_price = Math.round(rowBySymbol[symbol].current_price * 1.02 * 100) / 100; },
  details: details => { for (const detail of Object.values(details)) if (detail.symbol === symbol) detail.se_pivot_price = Math.round(rowBySymbol[symbol].current_price * 1.02 * 100) / 100; },
  charts: served => {
    const bars = served[`${symbol}.json`].bars, n = bars.length, at = n - 4, pivot = Math.round(rowBySymbol[symbol].current_price * 1.02 * 100) / 100;
    Object.assign(bars[at - 1], { open: pivot * 0.985, close: pivot * 0.985 }); fit(bars[at - 1]);
    Object.assign(bars[at], { open: pivot * 0.99, close: pivot * 1.01 }); fit(bars[at]);
    for (const i of [at + 1, at + 2]) { Object.assign(bars[i], { open: pivot * 0.99, close: pivot * 0.985 }); fit(bars[i]); }
    bars[at].volume = Math.ceil(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * 2.2);
  },
});

for (const [width, options] of [[375, phone(375)], [1440, { viewport: { width: 1440, height: 900 } }]]) test.describe(`round 2: the sell card at ${width}px`, () => {
  test.use(options);

  test('judges the strength checks of a stock far above its 50-day line without a pivot, from where it rose above the line', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZKS', { mutate: EXTENDED });
    const sell = page.getByTestId('brief-sell');
    await expect(sell.locator('.brief-note').first()).toContainText(/上昇の加速は、50日線の上に出た \d+\/\d+ 以降（\d+営業日）で判定（50日線から \+\d+\.\d%・判定は \+25%以上、独自判定）。/);
    if (width >= 1024) await expect(sell).toContainText('50日線の上に出て以降で最大の1日の上昇（直近5営業日）');
    // Informational: never a broken setup; the conclusion's chip calls them a holder's signals.
    await expect(sell).not.toContainText('ピボット比が未確認のため判定しません');
    expect(errors).toEqual([]);
  });

  test('says 判定していない項目 n件 while a check is not judged, never 「いま出ているサインはありません」, and names the bar a check is under', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    const sell = page.getByTestId('brief-sell');
    const note = sell.locator('.brief-note').first();
    await expect(note).toContainText(/判定していない項目 \d+件。$/);
    await expect(sell).not.toContainText('いま出ているサインはありません');
    // The real reason, in short, with the bar it is under (ZZNV sits at its pivot in the buy zone).
    await expect(note).toContainText('上昇の加速は判定せず（ピボット比 ±0.0%・+20%未満）。');
    expect(errors).toEqual([]);
  });
});

test.describe('round 2: the sell card\'s height at 375px', () => {
  test.use({ ...phone(375), contextOptions: { reducedMotion: 'reduce' } });
  // §3: the sell card grows 16px or less at 375 (step 0: 228.5 on ZZNV), with rule 9's 12px of headroom.
  test('stays within its allowance with the bar named in its reason', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    const sell = page.getByTestId('brief-sell');
    await expect(sell.locator('.brief-note').first()).toContainText('・+20%未満）。');
    expect(await sell.evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(228.5 + 16 - 12);
    expect(errors).toEqual([]);
  });
});

test.describe('round 2: a failed breakout on a watched stock', () => {
  test.use(phone(375));
  // The cross-surface invariant: the watch tile counts it (only the count is asserted: the tile is rows').
  test('makes the watch tile read 1件 (0件 without it) and the sell card show it as the fired check', async ({ page, context }) => {
    const watch = { 'research-watch': ['ZZAR'] };
    const tile = on => on.getByTestId('brief-summary').getByRole('link', { name: /ウォッチの注意/ }).locator('b');
    // The same watch list on the plain fixture, in a page of its own (each page routes its own publication).
    const plain = await context.newPage(), quiet = await openBrief(plain, '#/brief', { storage: watch });
    await expect(tile(plain)).toHaveText('0件');
    expect(quiet.errors).toEqual([]);
    await plain.close();
    const { errors } = await openBrief(page, '#/brief', { storage: watch, mutate: failedBreakout('ZZAR') });
    await expect(tile(page)).toHaveText('1件');
    await page.goto('/#/brief/stock/ZZAR');
    const sell = page.getByTestId('brief-sell');
    // The fired row itself is the failed breakout's (its label is this track's copy).
    await expect(sell.locator('li').filter({ has: page.locator('.is-sell-hit') }).filter({ hasText: '出来高を伴う上抜け後のピボット割れ（1.40×以上・10営業日以内・ブレイク失敗）' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
