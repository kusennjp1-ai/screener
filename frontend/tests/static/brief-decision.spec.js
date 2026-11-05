// Daily brief buy decision: the stock's conclusion, Today's focus tile under the market verdict and the
// verified day change in the bar, on synthetic data. Green means the trend template, the market, the
// earnings date and the day's event all allow a new buy; anything else is said in a neutral line.
import { test, expect } from '@playwright/test';
import { openBrief, VIEWPORTS, horizontalOverflow, rowBySymbol, SEC_SYMBOL } from './brief-fixture.js';

const phoneDevice = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const conclusion = page => page.getByTestId('brief-conclusion');
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
/** A variant of one stock's row, and of its research detail when it has one (the stock screen merges the detail in). */
const onRow = (symbol, fn) => ({ rows: rows => { fn(rows.find(r => r.symbol === symbol)); }, details: details => { for (const detail of Object.values(details)) if (detail.symbol === symbol) fn(detail); } });
// A market that holds off new buying: every row's S&P 500 is below its 50-day line (modelMarket: cap 0, a known state).
const HOLD_MARKET = { rows: rows => { for (const row of rows) row.market_above_50dma = false; } };
// The opened focus row closes above its pivot instead of on it (the synthetic day is +2.0% on 1.6× volume).
const crossing = symbol => ({ rows: rows => { const row = rows.find(r => r.symbol === symbol); row.se_pivot_price = Math.round(row.current_price * 0.99 * 100) / 100; } });

/** Reached as a trader reaches it: Today's focus row (on a wide screen the stock opens beside the list). */
async function openFocus(page, phone, options) {
  const result = await openBrief(page, '#/brief', options);
  const focus = page.getByRole('region', { name: '注目候補' });
  await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
  const target = phone ? 'ZZNV' : 'ZZKS';
  const row = focus.locator(`[data-symbol="${target}"]`);
  if (phone) await row.tap(); else await row.click();
  await expect(page).toHaveURL(new RegExp(`#/brief/stock/${target}$`));
  return { ...result, target };
}

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`${name} ${device.viewport.width}px`, () => {
  test.use(device);
  const phone = name === 'phone';

  test('a focus candidate that closes exactly at its pivot reaches it: ピボット到達, in the buy zone, no breakout claimed', async ({ page }) => {
    const { errors } = await openFocus(page, phone);
    await expect(conclusion(page)).toHaveClass(/tone-zone/);
    await expect(conclusion(page).locator('strong')).toHaveText('ピボット到達');
    await expect(conclusion(page)).not.toContainText('上抜け');
    expect(errors).toEqual([]);
  });

  test('a close above the pivot from below on the verified +2.0% day with 1.6× volume is today\'s breakout', async ({ page }) => {
    const { errors } = await openFocus(page, phone, { mutate: crossing(phone ? 'ZZNV' : 'ZZKS') });
    await expect(conclusion(page)).toHaveClass(/tone-zone/);
    await expect(conclusion(page).locator('strong')).toHaveText('本日ピボットを出来高1.60×で上抜け');
    expect(errors).toEqual([]);
  });

  test('a stock below the trend template is no buy candidate: a neutral line names the unmet rule', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZZF');
    await expect(conclusion(page)).toHaveClass(/tone-neutral/);
    await expect(conclusion(page).locator('strong')).toHaveText(`トレンドテンプレート未達（未達：RS ≥ 70（${Math.floor(rowBySymbol.ZZZF.rs_rating)}））— 買いの対象外`);
    await expect(conclusion(page).getByRole('img', { name: /^ピボットからの位置（参考）/ })).toBeVisible();
    await expect(conclusion(page).locator('.brief-tilequal')).toHaveText(['参考', '参考', '参考']);
    expect(errors).toEqual([]);
  });

  test('under a market that holds off new buying, Today\'s focus tile and rows are neutral and the stock conclusion says why', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { mutate: HOLD_MARKET });
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate').first()).toBeVisible();
    await expect(page.locator('#brief-focus-title')).toHaveText('注目候補（地合い：買いは控える・監視のみ）');
    const tile = page.getByTestId('brief-summary').locator('li').nth(1);
    await expect(tile).toContainText('注目候補');
    await expect(tile).not.toHaveClass(/tone-zone/);
    await expect(focus.locator('.tone-zone')).toHaveCount(0);
    await page.goto(`/#/brief/stock/${phone ? 'ZZNV' : 'ZZKS'}`);
    await expect(conclusion(page)).toHaveClass(/tone-neutral/);
    await expect(conclusion(page).locator('strong')).toHaveText('地合いが新規の買いを控える状態（独自判定）');
    await expect(conclusion(page).locator('.brief-call-status p')).toContainText('位置：ピボット到達');
    expect(errors).toEqual([]);
  });

  // The phone text floor (desktop keeps its 11px notes, as the other cards do).
  if (phone) test('the conclusion card reads at 12px or more', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await expect(conclusion(page).locator('.brief-kgrid > div')).toHaveCount(3);
    const small = await conclusion(page).evaluate(card => {
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT), out = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const element = node.parentElement;
        if (!node.textContent.trim() || !element.getClientRects().length || element.closest('.sr-only')) continue;
        const size = parseFloat(getComputedStyle(element).fontSize);
        if (size < 12) out.push(`${node.textContent.trim().slice(0, 20)} ${size}px`);
      }
      return out;
    });
    expect(small).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// A four-digit price with a two-digit fall (the NFLX/AZO/BKNG class) as well as the fixture's ~$100 one.
const BIG_PRICE = onRow('ZZNV', row => { row.current_price = 1234.56; Object.assign(row.technical_audit.values, { close: 1234.56, change: -12.34 }); });
for (const width of [320, 390]) test.describe(`the bar at ${width}px`, () => {
  test.use(phoneDevice(width, 844));

  for (const [label, mutate, price, change, tone] of [['a three-digit price', undefined, /^\$\d{3}\.\d{2}$/, '前日比 +2.0%', /is-up/], ['a four-digit price and a two-digit fall', BIG_PRICE, /^\$1,235$/, '前日比 −12.3%', /is-down/]]) {
    test(`carries ${label} and the verified day change, whole, and stays 48px or less`, async ({ page }) => {
      const { errors } = await openBrief(page, '#/brief/stock/ZZNV', mutate ? { mutate } : {});
      await expect(conclusion(page)).toBeVisible();
      const quote = page.locator('.brief-bar .brief-bar-change');
      await expect(quote).toHaveText(change);
      await expect(quote).toHaveClass(tone);
      expect((await page.locator('.brief-bar .brief-bar-price').innerText()).trim()).toMatch(price);
      expect((await page.locator('.brief-bar').boundingBox()).height).toBeLessThanOrEqual(48);
      // The ticker, the price and the change are all on screen: nothing overflows the title, and the change
      // lies wholly inside it (only the price could give way, with an ellipsis).
      const fit = await page.locator('.brief-bar-title b').evaluate(b => {
        const box = b.getBoundingClientRect(), change = b.querySelector('.brief-bar-change').getBoundingClientRect(), price = b.querySelector('.brief-bar-price');
        return { cut: b.scrollWidth > b.clientWidth + 0.5, inside: change.left >= box.left - 0.5 && change.right <= box.right + 0.5, price: price.scrollWidth > price.clientWidth + 0.5 };
      });
      expect(fit).toEqual({ cut: false, inside: true, price: false });
      expect(await horizontalOverflow(page)).toBe(0);
      expect(errors).toEqual([]);
    });
  }

  test('says 前日比 未確認 without the verified audit of the analysis day, never 0%', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { rows: rows => { delete rows.find(r => r.symbol === 'ZZNV').technical_audit.values.change; } } });
    await expect(conclusion(page)).toBeVisible();
    await expect(page.locator('.brief-bar .brief-bar-change')).toHaveText('—前日比 未確認');
    await expect(page.locator('.brief-bar')).not.toContainText('0.0%');
    // Nothing is said about a breakout either: the conclusion is the plain position.
    await expect(conclusion(page).locator('strong')).toHaveText('買いゾーン内');
    expect(errors).toEqual([]);
  });
});

test.describe('the desktop header', () => {
  test.use(VIEWPORTS.desktop);
  test('shows the same verified day change as the rows', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZKS');
    await expect(page.locator('.brief-stockhead h2 .brief-daychg')).toHaveText('前日比 +2.0%');
    await expect(page.getByRole('region', { name: '注目候補' }).locator('[data-symbol="ZZKS"] .brief-daychg')).toHaveText('前日比 +2.0%');
    expect(errors).toEqual([]);
  });
});

// The §3 allowance: the conclusion card grows 20px or less and the stock screen 40px or less at 375×812
// (before round 1: card 333px, screen 3112px on this fixture).
test.describe('the stock screen at 375×812', () => {
  test.use({ ...phoneDevice(375, 812), contextOptions: { reducedMotion: 'reduce' } });
  test('stays within track D\'s allowance', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await expect(page.getByTestId('brief-fundamentals').getByText(/^出典：SEC XBRL/)).toBeVisible();
    await settled(page);
    const { card, screen } = await page.evaluate(() => ({ card: document.querySelector('[data-testid="brief-conclusion"]').getBoundingClientRect().height,
      screen: Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY) }));
    expect(card).toBeLessThanOrEqual(333 + 20);
    expect(screen).toBeLessThanOrEqual(3112 + 40);
    expect(errors).toEqual([]);
  });
});
