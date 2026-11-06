// Daily brief candidate rows: the list's filters and search, the rows' chips and heights on phones, the
// stock tiles at 200% zoom, the day's event as the conclusion titles it (breakoutEvent), Today's focus tile
// and rows under a market that holds off new buying, and the verified day change in the phone bar and the
// desktop header, on synthetic data. (Where the constant TT 8/8 chip is left out is the screens' choice,
// Today's and the list's: brief-phone.spec.js.)
import { test, expect } from '@playwright/test';
import { openBrief, VIEWPORTS, horizontalOverflow, date } from './brief-fixture.js';

const candidates = page => page.getByTestId('brief-candidate');
const symbolsShown = page => candidates(page).evaluateAll(nodes => nodes.map(node => node.dataset.symbol));
const phoneDevice = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const PHONES = { 320: phoneDevice(320, 640), 390: VIEWPORTS.phone };
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
/**
 * A heavy-volume break of the 50-day line nine sessions ago with the close still under the line (Track E's
 * fixture for a broken setup, as in brief-watch.spec.js): the bars before it are lifted 15%, the session before
 * it closes at its 50-day high and the break day trades 2.2 times the prior 50-day average. The last close
 * stays the row's price, so the bars stay certified and the 50-day sell check fires.
 */
function breakBelow50(bars) {
  const n = bars.length, at = n - 9;
  for (let i = 0; i < at; i++) for (const key of ['open', 'high', 'low', 'close']) bars[i][key] *= 1.15;
  const top = Math.max(...bars.slice(at - 50, at - 1).map(bar => bar.close));
  Object.assign(bars[at - 1], { open: top, close: top, high: top * 1.005, low: top * 0.995 });
  bars[at].volume = Math.round(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * 2.2);
}
/** Tile text (small, b, em) that is cut off: its content is wider than its box. */
const clippedTileText = (page, scope = '.brief-fact, .brief-kgrid, .brief-summary') => page.evaluate(selector => [...document.querySelectorAll(selector)]
  .flatMap(tile => [...tile.querySelectorAll('small, b, em')]).filter(node => node.getClientRects().length && node.scrollWidth > node.clientWidth)
  .map(node => `${node.tagName.toLowerCase()} “${node.textContent}” ${node.scrollWidth}>${node.clientWidth}`), scope);

const conclusion = page => page.getByTestId('brief-conclusion');
// The analysis date as the event titles name it (never 「本日」: the data may be older than today).
const DAY = `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
/** A variant of one stock's row, and of its research detail when it has one (the stock screen merges the detail in). */
const onRow = (symbol, fn) => ({ rows: rows => { fn(rows.find(r => r.symbol === symbol)); }, details: details => { for (const detail of Object.values(details)) if (detail.symbol === symbol) fn(detail); } });
// A market that holds off new buying: every row's S&P 500 is below its 50-day line (modelMarket: cap 0, a known state).
const HOLD_MARKET = { rows: rows => { for (const row of rows) row.market_above_50dma = false; } };
// The opened focus row closes above its pivot instead of on it (the synthetic day is +2.0% on 1.6× volume).
const crossing = symbol => onRow(symbol, row => { row.se_pivot_price = Math.round(row.current_price * 0.99 * 100) / 100; });

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

  test('candidate list filters and search', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list');
    await expect(page.getByRole('heading', { level: 1, name: '候補' })).toBeVisible();
    const filters = page.getByRole('group', { name: '絞り込み' });
    const filter = label => filters.getByRole('button', { name: new RegExp(`^${label}\\s*\\d+$`) });
    const count = async label => Number(await filter(label).locator('.numeric').innerText());
    await expect(filter('買いゾーン')).toHaveAttribute('aria-pressed', 'true');
    await expect(candidates(page)).toHaveCount(await count('買いゾーン'));
    // The first row's chip may say the day's event (ピボット到達, 上抜け); its label keeps the position.
    await expect(candidates(page).first()).toHaveAttribute('aria-label', /買いゾーン/);
    const zone = await symbolsShown(page);
    expect(zone).toContain('ZZNV');

    await filter('あと1条件').click();
    await expect(filter('あと1条件')).toHaveAttribute('aria-pressed', 'true');
    await expect(filter('買いゾーン')).toHaveAttribute('aria-pressed', 'false');
    await expect(candidates(page)).toHaveCount(await count('あと1条件'));
    const oneShort = await symbolsShown(page);
    expect(oneShort.length).toBeGreaterThan(0);
    for (const chip of await page.locator('.brief-rows .brief-row').allInnerTexts()) expect(chip).toContain('あと1条件');
    expect(oneShort.some(symbol => zone.includes(symbol))).toBe(false);

    await filter('ピボット接近').click();
    await expect(candidates(page)).toHaveCount(await count('ピボット接近'));
    // Within 5% below the pivot, waiting for the breakout.
    for (const label of await candidates(page).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))) {
      const below = Number(label.match(/ピボット接近 −(\d+(?:\.\d+)?)%/)?.[1]);
      expect(below, label).toBeGreaterThan(0);
      expect(below, label).toBeLessThanOrEqual(5);
    }

    await filter('選定すべて').click();
    const all = await count('選定すべて');
    expect(all).toBe(await count('買いゾーン') + await count('ピボット接近'));
    // A phone lists 20 rows at a time; the rest open in place.
    if (phone) {
      await expect(candidates(page)).toHaveCount(20);
      await page.getByRole('button', { name: `さらに表示（残り ${all - 20}件）` }).click();
    }
    await expect(candidates(page)).toHaveCount(all);

    const search = page.getByRole('searchbox', { name: '銘柄を検索' });
    await search.fill('zzk');
    await expect(candidates(page)).toHaveCount(1);
    await expect(candidates(page)).toHaveAttribute('data-symbol', 'ZZKS');
    await search.fill('orbital');
    await expect(candidates(page)).toHaveCount(1);
    await expect(candidates(page)).toHaveAttribute('data-symbol', 'ZZOD');
    // A one-short stock is not in the qualified filters, even when searched for.
    await search.fill(oneShort[0]);
    await expect(candidates(page)).toHaveCount(0);
    await expect(page.getByText('この条件の選定銘柄はありません。')).toBeVisible();
    await filter('あと1条件').click();
    await expect(candidates(page)).toHaveCount(1);
    await search.fill('');
    await expect(candidates(page)).toHaveCount(oneShort.length);

    await page.getByRole('combobox', { name: '並び順' }).selectOption({ label: 'RS推計' });
    const rs = await candidates(page).evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('aria-label').match(/RS推計 (\d+)/)[1])));
    expect(rs).toEqual([...rs].sort((a, b) => b - a));
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  // The day's event titles (breakoutEvent's copy); the call's colour for them is brief-decision.spec.js's.
  test('a focus candidate that closes exactly at its pivot reaches it on the analysis date: ピボット到達, in the buy zone, no breakout claimed', async ({ page }) => {
    const { errors } = await openFocus(page, phone);
    await expect(conclusion(page).locator('strong')).toHaveText(`${DAY}にピボット到達`);
    await expect(conclusion(page)).not.toContainText('上抜け');
    expect(errors).toEqual([]);
  });

  test('a close above the pivot from below on the verified +2.0% day with 1.6× volume is a breakout on the analysis date', async ({ page }) => {
    const { errors } = await openFocus(page, phone, { mutate: crossing(phone ? 'ZZNV' : 'ZZKS') });
    await expect(conclusion(page).locator('strong')).toHaveText(`${DAY}に上抜け・出来高1.60×`);
    await expect(conclusion(page)).not.toContainText('本日');
    expect(errors).toEqual([]);
  });

  // The stock half of this check (the conclusion under that market) is brief-decision.spec.js's.
  test('under a market that holds off new buying, Today\'s focus tile and rows are neutral', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { mutate: HOLD_MARKET });
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate').first()).toBeVisible();
    await expect(page.locator('#brief-focus-title')).toHaveText('注目候補（地合い：買いは控える・監視のみ）');
    const tile = page.getByTestId('brief-summary').locator('li').nth(1);
    await expect(tile).toContainText('注目候補');
    await expect(tile).not.toHaveClass(/tone-zone/);
    await expect(focus.locator('.tone-zone')).toHaveCount(0);
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

for (const [width, device] of Object.entries(PHONES)) test.describe(`rows at ${width}px`, () => {
  test.use(device);

  test('candidate rows give the chips the width of the hidden mini meter', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list');
    await expect(candidates(page).first()).toBeVisible();
    expect(await page.locator('.brief-minimeter').count()).toBeGreaterThan(0);
    for (const meter of await page.locator('.brief-minimeter').all()) await expect(meter).toBeHidden();
    const rows = await candidates(page).evaluateAll(nodes => nodes.slice(0, 5).map(row => ({
      symbol: row.dataset.symbol, height: row.getBoundingClientRect().height,
      lines: new Set([...row.querySelectorAll('.brief-reasons .brief-chip')].map(chip => chip.offsetTop)).size,
      title: row.querySelector('.brief-row-name').clientWidth,
    })));
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.lines, row.symbol).toBeLessThanOrEqual(2);
      expect(row.height, row.symbol).toBeLessThanOrEqual(100);
    }
    if (width === '390') expect(median(rows.map(row => row.title))).toBeGreaterThanOrEqual(200);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('watch rows have no empty rank gutter', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/watch', { storage: { 'research-watch': ['ZZNV', 'ZZSD'] } });
    await expect(page.getByRole('region', { name: 'ウォッチ中の銘柄' }).getByTestId('brief-candidate')).toHaveCount(2);
    // The title line and the chips both start at the row's content edge.
    const gaps = await candidates(page).evaluateAll(nodes => nodes.flatMap(row => {
      const style = getComputedStyle(row), box = row.getBoundingClientRect();
      const contentLeft = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      return ['.brief-row-title', '.brief-reasons'].map(part => row.querySelector(part).getBoundingClientRect().left - contentLeft);
    }));
    for (const gap of gaps) { expect(gap).toBeGreaterThanOrEqual(0); expect(gap).toBeLessThanOrEqual(8); }
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// RS estimates as the publisher writes them (midranks, so decimals): every displayed RS is the whole number
// below it, so a chip never grows with the decimals and a row keeps its height.
const DECIMAL_RS = { rows: rows => { rows.forEach((row, i) => { row.rs_rating += [0.01283880171184, 0.5, 0.999][i % 3]; }); rows[0].rs_rating = 97.01283880171184; } };
for (const [width, device] of Object.entries({ ...PHONES, 1440: VIEWPORTS.desktop })) test.describe(`decimal RS at ${width}px`, () => {
  test.use(device);

  test('rows under 選定すべて stay 100px or less with single-line chips, and あと1条件 names the unmet rule', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list', { mutate: DECIMAL_RS });
    const filters = page.getByRole('group', { name: '絞り込み' });
    await filters.getByRole('button', { name: /^選定すべて/ }).click();
    await expect(candidates(page).first()).toBeVisible();
    const rows = await candidates(page).evaluateAll(nodes => nodes.map(row => {
      const chips = [...row.querySelectorAll('.brief-reasons .brief-chip')];
      return { symbol: row.dataset.symbol, height: row.getBoundingClientRect().height, lines: new Set(chips.map(chip => chip.offsetTop)).size,
        wrapped: chips.filter(chip => chip.getClientRects().length > 1 || chip.getBoundingClientRect().height > 2 * parseFloat(getComputedStyle(chip).fontSize)).map(chip => chip.textContent),
        rs: chips.map(chip => chip.textContent).filter(text => text.startsWith('RS推計')), label: row.getAttribute('aria-label') };
    }));
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(row.height, row.symbol).toBeLessThanOrEqual(100);
      expect(row.lines, row.symbol).toBeLessThanOrEqual(2);
      expect(row.wrapped, row.symbol).toEqual([]);
      expect(row.rs, row.symbol).toEqual([expect.stringMatching(/^RS推計 \d+$/)]);
      expect(row.label, row.symbol).toMatch(/RS推計 \d+$/);
    }
    expect(rows.find(row => row.symbol === 'ZZNV').rs).toEqual(['RS推計 97']);

    await filters.getByRole('button', { name: /^あと1条件/ }).click();
    // One neutral chip says the count and the rule, with the RS value when RS is the rule.
    const reason = page.locator('[data-symbol="ZZZF"] .brief-chip', { hasText: 'あと1条件：' });
    await expect(reason).toHaveText('あと1条件：RS推計（61）');
    // Its threshold is in the chip's title (and the row's label), with the full rule.
    await expect(reason).toHaveAttribute('title', '未達：RS推計 ≥ 70（61）');
    await expect(reason).not.toHaveClass(/tone-/);
    // The named rule keeps an あと1条件 row within the same height and two chip lines.
    const oneShort = await candidates(page).evaluateAll(nodes => nodes.map(row => ({ symbol: row.dataset.symbol, height: row.getBoundingClientRect().height,
      lines: new Set([...row.querySelectorAll('.brief-reasons .brief-chip')].map(chip => chip.offsetTop)).size })));
    expect(oneShort.length).toBeGreaterThan(0);
    for (const row of oneShort) { expect(row.height, row.symbol).toBeLessThanOrEqual(100); expect(row.lines, row.symbol).toBeLessThanOrEqual(2); }
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('stock tiles at 200% zoom', () => {
  // A 375px phone at 200% text zoom lays out at 188 CSS px.
  test.use(phoneDevice(188, 600));
  test('kgrid tiles wrap and stay inside their card', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZSD');
    await expect(page.getByTestId('brief-conclusion').locator('.brief-kgrid > div')).toHaveCount(3);
    await expect(page.locator('.brief-plan .brief-kgrid > div')).toHaveCount(3);
    expect(await clippedTileText(page, '.brief-kgrid')).toEqual([]);
    const outside = await page.locator('.brief-kgrid').evaluateAll(grids => grids.flatMap(grid => {
      const card = grid.closest('.brief-card').getBoundingClientRect();
      return [...grid.children].filter(tile => tile.getBoundingClientRect().right > card.right + 0.5).map(tile => tile.textContent);
    }));
    expect(outside).toEqual([]);
    // Nothing in the conclusion card (its title's rule unit, the meter's names) reaches past the card or the
    // page: the meter shows its short names. (The page's own overflow is the chart card's, track A.)
    const conclusion = await page.getByTestId('brief-conclusion').evaluate(card => {
      const edge = Math.min(card.getBoundingClientRect().right, document.documentElement.clientWidth);
      return { wide: [...card.querySelectorAll('*')].filter(node => node.getClientRects().length && node.getBoundingClientRect().right > edge + 0.5).map(node => `${node.className} ${node.textContent.slice(0, 24)}`),
        names: [...card.querySelectorAll('.brief-meter-labels > span')].map(label => label.innerText) };
    });
    expect(conclusion).toEqual({ wide: [], names: ['土台', '接近', '買い', '超過'] });
    expect(errors).toEqual([]);
  });
});

// あと1条件 rows whose unmet rule is not the RS estimate (common in published data): the chip names the rule
// short, last in the row, so the row keeps its two chip lines and its 100px at 320, 390 and 1440.
const ONE_SHORT = {
  '52週高値から30.25%': row => { row.rs_rating = 90; row.technical_audit.values.belowHigh = 30.25; },
  '52週安値から25.3%': row => { row.rs_rating = 90; row.technical_audit.values.aboveLow = 25.3; },
  'SMA200が下向き': row => { row.rs_rating = 90; row.technical_audit.values.sma200_21ago = row.technical_audit.values.sma200 * 1.05; },
};
const rowBoxes = page => candidates(page).evaluateAll(nodes => nodes.map(row => ({ symbol: row.dataset.symbol, height: row.getBoundingClientRect().height,
  lines: new Set([...row.querySelectorAll('.brief-reasons .brief-chip')].map(chip => chip.offsetTop)).size, label: row.getAttribute('aria-label') })));
for (const [width, device] of Object.entries({ ...PHONES, 1440: VIEWPORTS.desktop })) test.describe(`あと1条件 rows at ${width}px`, () => {
  test.use(device);

  for (const [reason, fn] of Object.entries(ONE_SHORT)) test(`a row one rule short (${reason}) stays 100px or less on two chip lines`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list', { mutate: { rows: rows => { fn(rows.find(row => row.symbol === 'ZZZF')); } } });
    await page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^あと1条件/ }).click();
    const target = page.locator('[data-symbol="ZZZF"]');
    await expect(target).toBeVisible();
    const chip = target.locator('.brief-chip', { hasText: 'あと1条件：' });
    // The full rule, with its threshold and value, is the chip's title and in the row's label.
    const full = await chip.getAttribute('title');
    expect(full).toMatch(/^未達：.+/);
    expect(await target.getAttribute('aria-label')).toContain(full);
    for (const row of await rowBoxes(page)) {
      expect(row.height, row.symbol).toBeLessThanOrEqual(100);
      expect(row.lines, row.symbol).toBeLessThanOrEqual(2);
    }
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('the watch list at 320px', () => {
  test.use(PHONES[320]);
  test('rows with a sell check and an あと1条件 chip stay 100px or less on two chip lines', async ({ page }) => {
    // ZZSD's setup is broken (Track E's 50-day check fires), so its row carries the sell chip beside あと1条件.
    const { errors } = await openBrief(page, '#/brief/watch', { storage: { 'research-watch': ['ZZNV', 'ZZZF', 'ZZSD', 'ZZKS'] }, mutate: { charts: served => breakBelow50(served['ZZSD.json'].bars) } });
    await expect(page.getByRole('region', { name: 'ウォッチ中の銘柄' }).getByTestId('brief-candidate')).toHaveCount(4);
    await expect(page.locator('[data-symbol="ZZSD"]')).toContainText('崩れ（独自判定）');
    await expect(page.locator('[data-symbol="ZZSD"]')).toContainText('あと1条件');
    for (const row of await rowBoxes(page)) {
      expect(row.height, row.symbol).toBeLessThanOrEqual(100);
      expect(row.lines, row.symbol).toBeLessThanOrEqual(2);
    }
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// Round 2 (rows): the day's event in the rows' chip and the order within the buy zone, the questionable-base chip,
// the TT chip without 「あと0」, the hidden breakout and EPS filters, 選定すべて's population, the pivot source, and
// the minus sign, on synthetic variants.
// ZZKS crosses its pivot from below on the synthetic day (+2.0%, 1.6×); ZZOD falls 1.0% on 1.6×: a heavy down day.
const DAY_EVENTS = { rows: rows => {
  for (const row of rows) {
    if (row.symbol === 'ZZKS') row.se_pivot_price = Math.round(row.current_price * 0.99 * 100) / 100;
    if (row.symbol === 'ZZOD') row.technical_audit.values.change = -1;
  }
} };
// Questionable bases (独自判定): ZZNV 40% deep, ZZAR two weeks long, ZZHE far above its 50-day line; ZZSD's base is deep
// too (its row also carries the broken setup's chip and あと1条件 on the watch tab).
const BASES = { rows: rows => {
  for (const row of rows) {
    if (row.symbol === 'ZZNV') Object.assign(row, { se_base_depth_pct: 40.2, se_base_length_weeks: 6 });
    if (row.symbol === 'ZZAR') Object.assign(row, { se_base_depth_pct: 12, se_base_length_weeks: 2 });
    if (row.symbol === 'ZZHE') row.technical_audit.values.sma50 = row.current_price / 1.3;
    if (row.symbol === 'ZZSD') Object.assign(row, { se_base_depth_pct: 38, se_base_length_weeks: 4 });
  }
} };
const both = (...variants) => ({ rows: rows => { for (const variant of variants) variant.rows(rows); }, ...(variants.find(v => v.charts) ? { charts: variants.find(v => v.charts).charts } : {}) });
const chipLines = page => candidates(page).evaluateAll(nodes => nodes.map(row => {
  const box = row.querySelector('.brief-reasons').getBoundingClientRect();
  const chips = [...row.querySelectorAll('.brief-reasons .brief-chip')].filter(chip => chip.getClientRects().length);
  return { symbol: row.dataset.symbol, height: row.getBoundingClientRect().height, lines: new Set(chips.map(chip => chip.offsetTop)).size,
    out: chips.filter(chip => chip.getBoundingClientRect().right > box.right + 0.5).map(chip => chip.textContent), chips: chips.map(chip => chip.textContent) };
}));
/** Visible text with an ASCII hyphen directly before a digit (ISO dates and tickers aside): a negative figure must use U+2212. */
const asciiMinus = page => page.evaluate(() => [...document.querySelectorAll('#brief-main *, .brief-bar *')].flatMap(node => {
  const own = [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join('');
  return node.getClientRects().length && /(?:^|[\s(（:：$＄=＝~〜、,])-\$?\d/.test(own) ? [own.trim().slice(0, 40)] : [];
}));

test.describe('the day on the rows (390px)', () => {
  test.use(VIEWPORTS.phone);
  test('a breakout ranks first in the zone and a heavy down day last, each in its short form, on Today and the list', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { mutate: DAY_EVENTS });
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    expect(await focus.getByTestId('brief-candidate').evaluateAll(nodes => nodes.map(node => node.dataset.symbol))).toEqual(['ZZKS', 'ZZNV', 'ZZNH', 'ZZDM', 'ZZOD']);
    await expect(focus.locator('[data-symbol="ZZKS"] .brief-chip').first()).toHaveText(`↗ ${DAY}上抜け 1.60×`);
    await expect(focus.locator('[data-symbol="ZZKS"] .brief-chip').first()).toHaveClass(/tone-zone/);
    await expect(focus.locator('[data-symbol="ZZNV"] .brief-chip').first()).toHaveText(`● ${DAY}ピボット到達`);
    await expect(focus.locator('[data-symbol="ZZOD"] .brief-chip').first()).toHaveText('▲ 下落日の大商い 1.60×');
    await expect(focus.locator('[data-symbol="ZZOD"] .brief-chip', { hasText: '出来高' })).toHaveCount(0);
    await expect(focus.locator('[data-symbol="ZZOD"] .brief-chip').first()).toHaveClass(/tone-ext/);
    // The breakout's chip carries its volume: no second volume chip on its row.
    await expect(focus.locator('[data-symbol="ZZKS"] .brief-chip', { hasText: '出来高' })).toHaveCount(0);
    // The 注目候補 tile says the day's breakouts and opens them, under a 44px chip that clears the filter.
    const link = page.getByTestId('brief-breakout-link');
    await expect(link).toHaveText('うち上抜け1 ›');
    expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await link.click();
    await expect(page).toHaveURL(/#\/brief\/list$/);
    expect(await symbolsShown(page)).toEqual(['ZZKS']);
    const chip = page.getByRole('button', { name: new RegExp(`^${DAY}の上抜け\\s*1`) });
    expect((await chip.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await chip.click();
    await expect(page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^買いゾーン/ })).toHaveAttribute('aria-pressed', 'true');
    expect(await symbolsShown(page)).toEqual(['ZZKS', 'ZZNV', 'ZZNH', 'ZZDM', 'ZZOD']);
    expect(await asciiMinus(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a watched stock with conditions unconfirmed reads TT未確認（N条件）, never あと0', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/watch', { storage: { 'research-watch': ['ZZNV', 'ZZZF'] }, mutate: { rows: rows => { rows.find(row => row.symbol === 'ZZZF').rs_rating = null; } } });
    const row = page.getByRole('region', { name: 'ウォッチ中の銘柄' }).locator('[data-symbol="ZZZF"]');
    await expect(row.locator('.brief-chip', { hasText: 'TT未確認' })).toHaveText('TT未確認（1条件）');
    await expect(page.locator('#brief-main')).not.toContainText('あと0');
    expect(errors).toEqual([]);
  });

  test('the 条件 menu opens the EPS filter, which counts the stocks it cannot tell apart, and the EPS sort puts them last', async ({ page }) => {
    const summary = value => ({ sec_state: 'ok', eps_yoy: value === null ? null : { value, end: '2026-06-30' }, sales_yoy: null, code33: null, as_of_date: date });
    const { errors } = await openBrief(page, '#/brief/list', { mutate: { rows: rows => {
      rows.find(row => row.symbol === 'ZZAR').sec_summary = summary(40);
      rows.find(row => row.symbol === 'ZZHE').sec_summary = summary(10);
      rows.find(row => row.symbol === 'ZZTR').sec_summary = summary(null);
    } } });
    await page.getByRole('combobox', { name: '条件' }).selectOption('eps');
    const chip = page.locator('.brief-filterchip');
    await expect(chip).toContainText('EPS前年比≥25%（直近・SEC）該当1・未確認19');
    expect(await symbolsShown(page)).toEqual(['ZZAR']);
    await chip.click();
    await page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^選定すべて/ }).click();
    await expect(page.locator('.brief-population')).toHaveText('選定すべて：TT 8/8＋株価$10以上・売買代金$2,000万以上');
    await page.getByRole('combobox', { name: '並び順' }).selectOption({ label: 'EPS前年比' });
    expect((await symbolsShown(page)).slice(0, 2)).toEqual(['ZZAR', 'ZZHE']);
    expect(errors).toEqual([]);
  });

  test('the stock names its pivot source: the pattern and its confidence, 未確認 when unknown', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZAR', { mutate: onRow('ZZAR', row => { Object.assign(row, { se_pattern_primary: 'cup_with_handle', se_pattern_confidence: 72.4 }); }) });
    await expect(page.getByText('Setup Engine・カップ・ウィズ・ハンドル（信頼度72）')).toBeVisible();
    await page.goto('/#/brief/stock/ZZKS');
    await expect(page.getByText('Setup Engine（信頼度60）')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

for (const [width, device] of Object.entries({ ...PHONES, 1440: VIEWPORTS.desktop })) test.describe(`round-2 chips at ${width}px`, () => {
  test.use(device);
  for (const [screen, hash] of [['the list (買いゾーン, then 選定すべて)', '#/brief/list'], ['the watch tab with a broken setup', '#/brief/watch'], ['Today', '#/brief']]) test(`rows with the day's events and questionable bases stay 100px or less on two chip lines on ${screen}`, async ({ page }) => {
    const watch = ['ZZNV', 'ZZZF', 'ZZSD', 'ZZKS', 'ZZOD', 'ZZAR'];
    const { errors } = await openBrief(page, hash, { storage: { 'research-watch': watch }, mutate: { ...both(DAY_EVENTS, BASES), charts: served => breakBelow50(served['ZZSD.json'].bars) } });
    await expect(candidates(page).first()).toBeVisible();
    if (hash.endsWith('watch')) await expect(page.locator('[data-symbol="ZZSD"] .brief-chip', { hasText: '崩れ' })).toBeVisible();
    const check = async () => {
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
      const rows = await chipLines(page);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.height, `${row.symbol} ${row.chips.join(' | ')}`).toBeLessThanOrEqual(100);
        expect(row.lines, `${row.symbol} ${row.chips.join(' | ')}`).toBeLessThanOrEqual(2);
        expect(row.out, row.symbol).toEqual([]);
      }
      return rows;
    };
    const rows = await check();
    // The base chip shows where it fits (ZZNV's normal row has the room), and the label says it in every case. On a
    // phone's Today it adds no line to a focus row (the screen's height budget): at 390 the row is one line, so the
    // chip stays in the label; at 320 it fits on the row's second line.
    const todayPhone = hash === '#/brief' && width !== '1440';
    if (!hash.endsWith('watch')) expect(rows.find(row => row.symbol === 'ZZNV').chips.includes('土台6週・−40%')).toBe(!(todayPhone && width === '390'));
    // ZZNV's row keeps the lines of ZZNH's, a zone row with the same chips and a normal base.
    if (todayPhone) expect([rows.find(row => row.symbol === 'ZZNV').lines, rows.find(row => row.symbol === 'ZZNV').height]).toEqual([rows.find(row => row.symbol === 'ZZNH').lines, rows.find(row => row.symbol === 'ZZNH').height]);
    expect(await page.locator('[data-symbol="ZZNV"]').first().getAttribute('aria-label')).toContain('土台6週・−40%（Setup Engineの土台が深さ35%超（独自判定））');
    if (hash.endsWith('list')) { await page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^選定すべて/ }).click(); await check(); }
    expect(await asciiMinus(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
