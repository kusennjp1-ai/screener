// Daily brief candidate rows: the list's filters and search, the rows' chips and heights on phones, and
// the stock tiles at 200% zoom, on synthetic data. (Where the constant TT 8/8 chip is left out is the
// screens' choice, Today's and the list's: brief-phone.spec.js.)
import { test, expect } from '@playwright/test';
import { openBrief, VIEWPORTS, horizontalOverflow } from './brief-fixture.js';

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
    await expect(candidates(page).first()).toContainText('買いゾーン');
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
    await expect(reason).toHaveText('あと1条件：RS ≥ 70（61）');
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
