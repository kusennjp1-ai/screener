// Daily brief on phones: rows, Today's first screen, tiles, filters and focus at 320/375/390 px,
// against the desktop layout at 1440 px, on synthetic data.
import { test, expect } from '@playwright/test';
import { openBrief, VIEWPORTS, horizontalOverflow } from './brief-fixture.js';

const phone = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const PHONES = { 320: phone(320, 640), 390: VIEWPORTS.phone };
const candidates = page => page.getByTestId('brief-candidate');
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

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
    const gaps = await candidates(page).evaluateAll(nodes => nodes.map(row => {
      const style = getComputedStyle(row), box = row.getBoundingClientRect();
      const contentLeft = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      return row.querySelector('.brief-row-main').getBoundingClientRect().left - contentLeft;
    }));
    for (const gap of gaps) { expect(gap).toBeGreaterThanOrEqual(0); expect(gap).toBeLessThanOrEqual(8); }
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`TT chip ${name}`, () => {
  test.use(device);

  test('Today\'s focus rows omit the constant TT 8/8 chip; the list keeps it', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    for (const row of await focus.getByTestId('brief-candidate').all()) await expect(row).not.toContainText('TT 8/8');
    await expect(focus).toContainText('注目候補はすべてトレンドテンプレート8条件を満たす銘柄');
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '候補' }).click();
    await expect(page).toHaveURL(/#\/brief\/list$/);
    await expect(candidates(page).first()).toContainText('TT 8/8');
    if (name === 'desktop') expect(await page.locator('.brief-left .brief-minimeter').count()).toBeGreaterThan(0);
    if (name === 'desktop') for (const meter of await page.locator('.brief-left .brief-minimeter').all()) await expect(meter).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
const FOLD = { 375: phone(375, 812), 390: VIEWPORTS.phone };

for (const [width, device] of Object.entries(FOLD)) test.describe(`Today's first screen at ${width}px`, () => {
  test.use(device);

  test('shows the market answer and a candidate without scrolling', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    const market = page.getByRole('region', { name: '地合い' });
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    await expect(market.locator('.brief-fact').first()).not.toContainText('読み込み中');
    await settled(page);
    const first = await focus.getByTestId('brief-candidate').first().boundingBox();
    const dock = await page.locator('.brief-dock').boundingBox();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect(first.y + first.height).toBeLessThanOrEqual(dock.y);
    // The verdict repeats the summary tile and the chart is a shape only: both stay on the market tab.
    await expect(market.locator('.brief-verdict')).toBeHidden();
    await expect(market.locator('.brief-index')).toBeHidden();
    await expect(market.locator('.brief-index-legend')).toBeHidden();
    expect(await market.evaluate(node => node.innerText)).toContain('独自判定');
    await expect(market.locator('.brief-fact')).toHaveCount(4);
    for (const fact of await market.locator('.brief-fact').all()) await expect(fact).toBeVisible();
    // Tile text reads at 12px or more, including the names of a pair's sides (S&P / NAS, 高 / 安).
    const tileText = await market.locator('.brief-fact small, .brief-fact em, .brief-pair-name').evaluateAll(nodes => nodes.map(node => [node.textContent, parseFloat(getComputedStyle(node).fontSize)]));
    expect(tileText.filter(([, size]) => size < 12)).toEqual([]);
    expect(tileText.map(([text]) => text)).toEqual(expect.arrayContaining(['S&P', 'NAS', '高', '安']));
    const summary = page.getByTestId('brief-summary');
    await expect(summary).toContainText('買い可・最大50%');
    expect(await summary.locator('.brief-frag', { hasText: '最大50%' }).evaluate(node => node.getClientRects().length)).toBe(1);
    await expect(page.locator('.brief-bar-title')).toContainText('2026-10-02');
    await expect(page.locator('.brief-bar-title')).toContainText('引け');
    await expect(page.locator('.brief-hero small')).toBeHidden();
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('a date that cannot be read on a phone', () => {
  test.use(VIEWPORTS.phone);
  test('the bar says 未確認 once loading has ended, never 取得中 for good', async ({ page }) => {
    await openBrief(page, '#/brief', { fail: 'manifest' });
    // The hero date (日付未確認) is hidden on the phone's Today; the bar carries the state.
    await expect(page.locator('.brief-hero small')).toBeHidden();
    await expect(page.locator('.brief-bar-title')).toContainText('分析基準日 未確認');
    await expect(page.locator('.brief-bar-title')).not.toContainText('取得中');
    expect(await horizontalOverflow(page)).toBe(0);
  });
});

test.describe('the market tab on a phone keeps the verdict and the chart', () => {
  test.use(VIEWPORTS.phone);
  test('verdict and S&P chart are visible on #/brief/market', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    const market = page.getByRole('region', { name: '地合い' });
    await expect(market.locator('.brief-verdict')).toBeVisible();
    await expect(market.locator('.brief-index')).toBeVisible();
    await expect(page.locator('.brief-hero small')).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('Today on desktop is unchanged', () => {
  test.use(VIEWPORTS.desktop);
  test('verdict, S&P chart and the hero date stay visible at 1440px', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    const market = page.getByRole('region', { name: '地合い' });
    await expect(market.locator('.brief-verdict')).toBeVisible();
    await expect(market.locator('.brief-index')).toBeVisible();
    await expect(market.locator('.brief-index-legend')).toBeVisible();
    await expect(page.locator('.brief-hero small')).toBeVisible();
    await expect(page.locator('.brief-bar-title')).toContainText('分析基準日 2026-10-02 引け・米国株');
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

/** Tile text (small, b, em) that is cut off: its content is wider than its box. */
const clippedTileText = (page, scope = '.brief-fact, .brief-kgrid, .brief-summary') => page.evaluate(selector => [...document.querySelectorAll(selector)]
  .flatMap(tile => [...tile.querySelectorAll('small, b, em')]).filter(node => node.getClientRects().length && node.scrollWidth > node.clientWidth)
  .map(node => `${node.tagName.toLowerCase()} “${node.textContent}” ${node.scrollWidth}>${node.clientWidth}`), scope);
const READY = {
  '#/brief': page => expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate')).toHaveCount(5),
  '#/brief/market': page => expect(page.locator('.market-history-explorer').getByRole('img')).toBeVisible(),
  '#/brief/stock/ZZNV': page => expect(page.getByTestId('brief-price-chart').locator('svg rect.bc-up, svg rect.bc-down')).toHaveCount(130),
};

test.describe('tiles at 320px', () => {
  test.use(phone(320, 640));
  for (const [hash, ready] of Object.entries(READY)) test(`no tile text is cut off on ${hash}`, async ({ page }) => {
    const { errors } = await openBrief(page, hash);
    await ready(page);
    await expect(page.locator('.brief-market .brief-fact b').filter({ hasText: '読み込み中' })).toHaveCount(0);
    expect(await clippedTileText(page)).toEqual([]);
    if (hash.includes('stock')) await expect(page.locator('.brief-plan .brief-kgrid em').filter({ hasText: '口座の' })).toHaveText('口座の 17.7%');
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('stock tiles at 200% zoom', () => {
  // A 375px phone at 200% text zoom lays out at 188 CSS px.
  test.use(phone(188, 600));
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

for (const [width, device] of Object.entries(PHONES)) test.describe(`list filters at ${width}px`, () => {
  test.use(device);
  test('all four filters are on screen, none scrolled away', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list');
    const seg = page.getByRole('group', { name: '絞り込み' });
    await expect(seg.getByRole('button')).toHaveCount(4);
    const boxes = await seg.getByRole('button').evaluateAll(buttons => buttons.map(button => { const box = button.getBoundingClientRect(); return { left: box.left, right: box.right, height: box.height }; }));
    const innerWidth = await page.evaluate(() => innerWidth);
    for (const box of boxes) { expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(innerWidth); expect(box.height).toBeGreaterThanOrEqual(44); }
    expect(await seg.evaluate(node => node.scrollWidth - node.clientWidth)).toBe(0);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('keyboard focus on a phone', () => {
  test.use(VIEWPORTS.phone);
  test('every focused control in main is clear of the top bar and the dock', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': ['ZZNV', 'ZZSD', 'ZZKS'] } });
    await expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate')).toHaveCount(5);
    await expect(page.getByRole('region', { name: 'ウォッチの変化' }).getByRole('button')).toHaveCount(3);
    await settled(page);
    const seen = [];
    for (let press = 0; press < 80; press++) {
      await page.keyboard.press('Tab');
      const step = await page.evaluate(() => {
        const active = document.activeElement, main = document.getElementById('brief-main');
        if (!active || active.matches('.brief-skip')) return { skip: true };
        if (!main.contains(active)) return { outside: true };
        const box = active.getBoundingClientRect(), bar = document.querySelector('.brief-bar').getBoundingClientRect(), dock = document.querySelector('.brief-dock').getBoundingClientRect();
        return { label: (active.getAttribute('aria-label') || active.textContent).trim().slice(0, 40), top: box.top, bottom: box.bottom, barBottom: bar.bottom, dockTop: dock.top };
      });
      if (step.skip) continue;
      if (step.outside) { if (seen.length) break; continue; }
      seen.push(step);
    }
    expect(seen.length).toBeGreaterThanOrEqual(10);
    for (const step of seen) {
      expect(step.top, step.label).toBeGreaterThanOrEqual(step.barBottom);
      expect(step.bottom, step.label).toBeLessThanOrEqual(step.dockTop);
    }
    expect(errors).toEqual([]);
  });
});

/** Colours as the page paints them (any CSS colour syntax, including color-mix), and WCAG contrast. */
const fieldColours = (page, selector) => page.evaluate(target => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const rgb = colour => { context.clearRect(0, 0, 1, 1); context.fillStyle = '#000'; context.fillStyle = colour; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
  const luminance = ([r, g, b]) => [r, g, b].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const ground = node => { for (let at = node; at; at = at.parentElement) { const value = getComputedStyle(at).backgroundColor; if (rgb(value)[3] === 255) return rgb(value); } return [255, 255, 255, 255]; };
  return [...document.querySelectorAll(target)].map(field => {
    const style = getComputedStyle(field), edge = rgb(style.borderTopColor);
    return { field: field.tagName.toLowerCase(), own: contrast(edge, ground(field)), behind: contrast(edge, ground(field.parentElement)),
      placeholder: field.matches('input[placeholder]') ? rgb(getComputedStyle(field, '::placeholder').color).join() : null,
      text3: rgb(getComputedStyle(field).getPropertyValue('--text-3').trim()).join() };
  });
}, selector);

for (const theme of ['dark', 'light']) test.describe(`form fields in ${theme}`, () => {
  test.use(VIEWPORTS.phone);
  test('placeholders use --text-3 and field edges reach 3:1', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list', { storage: { 'screener:color-mode': theme } });
    await expect(page.locator('.brief')).toHaveAttribute('data-theme', theme);
    await expect(candidates(page).first()).toBeVisible();
    const list = await fieldColours(page, '.brief-search input, .brief-sort select');
    expect(list.map(item => item.field)).toEqual(['input', 'select']);
    expect(list[0].placeholder).toBe(list[0].text3);
    await page.goto('/#/brief/stock/ZZNV');
    await expect(page.locator('.brief-inputs input')).toHaveCount(3);
    const plan = await fieldColours(page, '.brief-inputs input');
    for (const item of [...list, ...plan]) {
      expect(item.own, JSON.stringify(item)).toBeGreaterThanOrEqual(3);
      expect(item.behind, JSON.stringify(item)).toBeGreaterThanOrEqual(3);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('cold load', () => {
  test.use(VIEWPORTS.phone);
  // No script of the app runs: what is painted comes from index.html alone (its inline boot script still runs).
  const withoutScripts = page => page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    return request.resourceType() === 'script' || /\.jsx?$/.test(url.pathname) ? route.abort() : route.fallback();
  });

  test('a static shell on the dark ground is painted before any script', async ({ page }) => {
    await withoutScripts(page);
    await page.goto('/#/brief');
    await expect(page.locator('#root')).toContainText('米国株スクリーナー');
    await expect(page.locator('#root')).toContainText('読み込み中…');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#10121D');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(16, 18, 29)');
  });

  test('a stored light choice switches the boot ground', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('screener:color-mode', 'light'); } catch { /* blocked */ } });
    await withoutScripts(page);
    await page.goto('/#/brief');
    await expect(page.locator('#root')).toContainText('読み込み中…');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(243, 244, 248)');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(243, 244, 248)');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#F3F4F8');
  });

  // A production build links the app stylesheet in <head>, so it can arrive before the scripts run;
  // the dev server injects CSS from JS, so the specs add it themselves. index.css has a bare body rule.
  for (const theme of ['dark', 'light']) test(`the boot ground holds once the app stylesheet arrives before the scripts (${theme})`, async ({ page }) => {
    await page.addInitScript(mode => { try { localStorage.setItem('screener:color-mode', mode); } catch { /* blocked */ } }, theme);
    await withoutScripts(page);
    await page.goto('/#/brief');
    await expect(page.locator('#root')).toContainText('読み込み中…');
    for (const path of ['src/index.css', 'src/static/theme/foundation.css', 'src/static/brief/brief.css']) await page.addStyleTag({ path });
    const ground = theme === 'light' ? 'rgb(243, 244, 248)' : 'rgb(16, 18, 29)';
    const painted = await page.evaluate(() => ({ html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.querySelector('.boot-shell')).color }));
    expect(painted).toEqual({ html: ground, body: ground, text: theme === 'light' ? 'rgb(34, 34, 56)' : 'rgb(240, 242, 250)' });
  });

  test('rows that arrive with the data appear at once; a tab switch still plays their entrance', async ({ page }) => {
    // Record each candidate row's entrance at the moment it is inserted.
    await page.addInitScript(() => {
      window.__rows = [];
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          for (const row of node.matches('[data-testid="brief-candidate"]') ? [node] : node.querySelectorAll('[data-testid="brief-candidate"]')) {
            const li = row.closest('li');
            window.__rows.push({ symbol: row.dataset.symbol, className: li.className, animations: li.getAnimations().map(animation => animation.animationName) });
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    const { errors } = await openBrief(page, '#/brief');
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    const cold = await page.evaluate(() => window.__rows.splice(0));
    expect(cold.length).toBeGreaterThanOrEqual(5);
    for (const row of cold) { expect(row.className, row.symbol).not.toContain('in'); expect(row.animations, row.symbol).toEqual([]); }
    // Opening the list and coming back with the data loaded plays the entrance as before.
    const tabs = page.getByRole('navigation', { name: 'ブリーフの画面' });
    await tabs.getByRole('link', { name: '候補' }).click();
    await expect(page).toHaveURL(/#\/brief\/list$/);
    await expect(candidates(page).first()).toBeVisible();
    await page.evaluate(() => window.__rows.splice(0));
    await tabs.getByRole('link', { name: '今日' }).click();
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    const back = await page.evaluate(() => window.__rows.splice(0));
    expect(back.length).toBeGreaterThanOrEqual(5);
    for (const row of back) { expect(row.className, row.symbol).toBe('in'); expect(row.animations, row.symbol).toContain('brief-rise'); }
    expect(errors).toEqual([]);
  });

  test('after a cold list load, a filter change with the data loaded plays the entrance', async ({ page }) => {
    await page.addInitScript(() => {
      window.__rows = [];
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          for (const row of node.matches('[data-testid="brief-candidate"]') ? [node] : node.querySelectorAll('[data-testid="brief-candidate"]')) {
            const li = row.closest('li');
            window.__rows.push({ symbol: row.dataset.symbol, className: li.className, animations: li.getAnimations().map(animation => animation.animationName) });
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    const { errors } = await openBrief(page, '#/brief/list');
    await expect(candidates(page)).toHaveCount(5);
    const cold = await page.evaluate(() => window.__rows.splice(0));
    expect(cold.length).toBeGreaterThanOrEqual(5);
    for (const row of cold) { expect(row.className, row.symbol).not.toContain('in'); expect(row.animations, row.symbol).toEqual([]); }
    await page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^ピボット接近/ }).click();
    await expect(candidates(page)).toHaveCount(16);
    const changed = await page.evaluate(() => window.__rows.splice(0));
    expect(changed.length).toBe(16);
    for (const row of changed) { expect(row.className, row.symbol).toBe('in'); expect(row.animations, row.symbol).toContain('brief-rise'); }
    expect(errors).toEqual([]);
  });
});

test.describe('desktop rows keep still when a stock opens beside them', () => {
  test.use(VIEWPORTS.desktop);
  test('opening a stock does not replay the entrance of the rows already shown', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    await focus.getByTestId('brief-candidate').nth(2).click();
    await expect(page).toHaveURL(/#\/brief\/stock\/ZZ[A-Z]+$/);
    await expect(page.getByTestId('brief-conclusion')).toBeVisible();
    const replayed = await focus.locator('li').evaluateAll(items => items.filter(li => li.className.includes('in') || li.getAnimations().some(animation => animation.animationName === 'brief-rise')).length);
    expect(replayed).toBe(0);
    expect(errors).toEqual([]);
  });
});
