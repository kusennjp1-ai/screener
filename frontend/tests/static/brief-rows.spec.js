// Daily brief candidate rows: the list's filters and search, the rows' chips and heights on phones, the
// constant TT 8/8 chip, and the stock tiles at 200% zoom, on synthetic data.
import { test, expect } from '@playwright/test';
import { openBrief, VIEWPORTS, horizontalOverflow } from './brief-fixture.js';

const candidates = page => page.getByTestId('brief-candidate');
const symbolsShown = page => candidates(page).evaluateAll(nodes => nodes.map(node => node.dataset.symbol));
const phoneDevice = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const PHONES = { 320: phoneDevice(320, 640), 390: VIEWPORTS.phone };
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
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
    await expect(candidates(page).first()).toContainText('買いゾーン内');
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
      const below = Number(label.match(/ピボット待ち −(\d+(?:\.\d+)?)%/)?.[1]);
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
      title: row.querySelector('.brief-row-title span').clientWidth,
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

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`TT chip ${name}`, () => {
  test.use(device);

  test('Today\'s focus rows omit the constant TT 8/8 chip; the desktop list keeps it, a phone keeps it where it varies', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    for (const row of await focus.getByTestId('brief-candidate').all()) await expect(row).not.toContainText('TT 8/8');
    // The constant is said once: in place on the desktop, in the screen's 注記 on a phone.
    if (name === 'desktop') {
      await expect(focus.getByText(/^注目候補はすべてトレンドテンプレート8条件を満たす銘柄/)).toBeVisible();
      await expect(page.locator('.brief-screen-notes')).toHaveCount(0);
    } else await expect(page.locator('.brief-screen-notes', { hasText: '注目候補はすべてトレンドテンプレート8条件を満たす銘柄' })).toHaveCount(1);
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '候補' }).click();
    await expect(page).toHaveURL(/#\/brief\/list$/);
    if (name === 'desktop') await expect(candidates(page).first()).toContainText('TT 8/8');
    else {
      // A qualified-only filter's rows are all TT 8/8: the phone says so once in the 注記 and keeps each row's chips on one line.
      for (const row of await candidates(page).all()) await expect(row).not.toContainText('TT 8/8');
      await expect(page.locator('.brief-screen-notes')).toContainText('スマホでは「TT 8/8」の表示を省いています');
      const lines = await candidates(page).evaluateAll(rows => rows.map(row => new Set([...row.querySelectorAll('.brief-reasons .brief-chip')].map(chip => chip.offsetTop)).size));
      expect(lines.every(count => count === 1)).toBe(true);
      // あと1条件 keeps the chip: there it says how many conditions are unmet.
      await page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^あと1条件/ }).click();
      for (const row of await candidates(page).all()) await expect(row).toContainText('あと1条件');
    }
    if (name === 'desktop') expect(await page.locator('.brief-left .brief-minimeter').count()).toBeGreaterThan(0);
    if (name === 'desktop') for (const meter of await page.locator('.brief-left .brief-minimeter').all()) await expect(meter).toBeVisible();
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
    expect(errors).toEqual([]);
  });
});
