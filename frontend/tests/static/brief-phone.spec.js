// Daily brief on phones: Today's first screen, tiles, filters and focus at 320/375/390 px,
// against the desktop layout at 1440 px, on synthetic data.
import { test, expect } from '@playwright/test';
import { openBrief, sessions, VIEWPORTS, horizontalOverflow } from './brief-fixture.js';

const phone = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const PHONES = { 320: phone(320, 640), 390: VIEWPORTS.phone };
const candidates = page => page.getByTestId('brief-candidate');

const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
// What the first-screen goal covers: current-day data at 375x812 and 390x844, in the browser and as the
// installed PWA (viewport-fit=cover: the bar and the dock grow by the notch and home-indicator insets,
// emulated with Chromium's safe-area override), and a one-session lag at 390x844 in the browser. A lag
// on a notched phone adds as-of tags and the 再集計待ち note, which are never hidden to make room, so
// there the first candidate may sit under the dock.
const FOLD = {
  '375px': { device: phone(375, 812) },
  '390px': { device: VIEWPORTS.phone },
  '375px as an installed PWA on an iPhone X': { device: phone(375, 812), insets: { top: 44, bottom: 34 } },
  '390px as an installed PWA on an iPhone 14': { device: VIEWPORTS.phone, insets: { top: 47, bottom: 34 } },
  '390px one session behind': { device: VIEWPORTS.phone, lag: true },
};

for (const [width, { device, insets, lag }] of Object.entries(FOLD)) test.describe(`Today's first screen at ${width}`, () => {
  test.use(device);

  test('shows the market answer and a candidate without scrolling', async ({ page }) => {
    if (insets) await (await page.context().newCDPSession(page)).send('Emulation.setSafeAreaInsetsOverride', { insets: { ...insets, left: 0, right: 0 } });
    const { errors } = await openBrief(page, '#/brief', lag ? { historyEnd: sessions.at(-2) } : {});
    if (insets) expect(await page.locator('.brief-dock').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(56 + insets.bottom);
    if (lag) await expect(page.getByRole('region', { name: '地合い' }).getByRole('note')).toContainText('再集計待ち');
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
    // Today's rows show RS推計: the card says the RS is the app's own, not IBD's.
    await expect(market.locator('.brief-note').last()).toHaveText('地合いの判定・各集計・RSは公開日足からの独自判定・独自集計で、IBDの公式値ではありません。');
    // The dated title stays the page heading for assistive tech; the bar shows the date.
    await expect(page.getByRole('heading', { level: 1, name: '10月2日（金）の判断' })).toBeAttached();
    await expect(market.locator('.brief-fact')).toHaveCount(4);
    for (const fact of await market.locator('.brief-fact').all()) await expect(fact).toBeVisible();
    // Tile text reads at 12px or more, including the names of a pair's sides (S&P / NAS, 高 / 安).
    const tileText = await market.locator('.brief-fact small, .brief-fact em, .brief-pair-name').evaluateAll(nodes => nodes.map(node => [node.textContent, parseFloat(getComputedStyle(node).fontSize)]));
    expect(tileText.filter(([, size]) => size < 12)).toEqual([]);
    expect(tileText.map(([text]) => text)).toEqual(expect.arrayContaining(['S&P', 'NAS', '高', '安']));
    const summary = page.getByTestId('brief-summary');
    await expect(summary).toContainText('検討可・目安≤50%');
    expect(await summary.locator('.brief-frag', { hasText: '目安≤50%' }).evaluate(node => node.getClientRects().length)).toBe(1);
    // The bar says the analysis session with its weekday, never today's date.
    await expect(page.locator('.brief-bar-title')).toContainText('分析基準日 10/2（金）引け・米国株');
    await expect(page.locator('.brief-bar-title time')).toHaveAttribute('datetime', '2026-10-02');
    await expect(page.locator('.brief-hero small')).toBeHidden();
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

test.describe('a failed manifest on Today', () => {
  test.use(VIEWPORTS.phone);
  test('the summary, the focus card and the watch card say the candidates cannot be fetched, never 0', async ({ page }) => {
    await openBrief(page, '#/brief', { fail: 'manifest', storage: { 'research-watch': ['ZZNV'] } });
    const summary = page.getByTestId('brief-summary');
    await expect(summary).toContainText('注目候補取得できません');
    await expect(summary).toContainText('ウォッチの注意取得できません1銘柄を登録');
    await expect(summary).not.toContainText(/0銘柄|ゾーン0|接近0|未登録/);
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus).toContainText('候補データを取得できません。');
    await expect(focus).not.toContainText('選定銘柄はありません');
    await expect(page.getByRole('region', { name: 'ウォッチの状況' })).toContainText('ウォッチ中の1銘柄は、候補データがないため確認できません。');
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '候補' }).click();
    await expect(page.getByRole('region', { name: '選定銘柄の一覧' })).toContainText('候補データを取得できません。');
    for (const count of await page.getByRole('group', { name: '絞り込み' }).locator('.numeric').allTextContents()) expect(count).toBe('—');
    expect(await horizontalOverflow(page)).toBe(0);
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
    await expect(page.locator('.brief-bar-title')).toContainText('分析基準日 10/2（金）引け・米国株');
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
  '#/brief/market': page => expect(page.locator('.market-history-explorer svg').first()).toBeAttached(),
  '#/brief/stock/ZZNV': page => expect(page.getByTestId('brief-price-chart').locator('svg rect.bc-up, svg rect.bc-down')).toHaveCount(130),
};

test.describe('tiles at 320px', () => {
  test.use(phone(320, 640));
  for (const [hash, ready] of Object.entries(READY)) test(`no tile text is cut off on ${hash}`, async ({ page }) => {
    const { errors } = await openBrief(page, hash);
    await ready(page);
    await expect(page.locator('.brief-market .brief-fact b').filter({ hasText: '読み込み中' })).toHaveCount(0);
    expect(await clippedTileText(page)).toEqual([]);
    // The market tab's other sections, each in turn.
    for (const tab of await page.getByRole('tab').all()) { await tab.click(); expect(await clippedTileText(page)).toEqual([]); expect(await horizontalOverflow(page)).toBe(0); }
    if (hash.includes('stock')) await expect(page.locator('.brief-plan .brief-kgrid em').filter({ hasText: '口座の' })).toHaveText('口座の 17.7%');
    expect(await horizontalOverflow(page)).toBe(0);
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
    await expect(page.getByRole('region', { name: 'ウォッチの状況' }).getByRole('button')).toHaveCount(3);
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

// Today's three answers are links (44px or more, at their own height) to where each is explained.
for (const [width, device] of Object.entries({ 320: phone(320, 640), 375: phone(375, 812), 390: VIEWPORTS.phone })) test.describe(`Today's tiles at ${width}px`, () => {
  test.use(device);
  test('each tile is a link of 44px or more, to the market tab, the focus pool and the watch tab', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    const summary = page.getByTestId('brief-summary');
    await expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate')).toHaveCount(5);
    const tiles = summary.getByRole('link');
    await expect(tiles).toHaveCount(3);
    for (const box of await tiles.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect()))) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    // The link fills its tile, and the tile is as tall as before (its text sets it, not the link): 97px at 375
    // with the default storage, as measured before the tiles became links (brief-watch.spec.js pins the tile
    // with a watch list).
    expect(await summary.locator('li').evaluateAll(items => items.every(li => Math.abs(li.getBoundingClientRect().height - li.querySelector('a').getBoundingClientRect().height) <= 4))).toBe(true);
    if (width === '375') for (const height of await summary.locator('li').evaluateAll(items => items.map(li => li.getBoundingClientRect().height))) expect(Math.abs(height - 97)).toBeLessThanOrEqual(2);
    await expect(tiles.nth(0)).toHaveAttribute('href', '#/brief/market');
    await tiles.nth(0).click();
    await expect(page).toHaveURL(/#\/brief\/market$/);
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '今日' }).click();
    // 注目候補: the list of the same pool (zone and near), said as a chip that clears it; no segment is pressed.
    await tiles.nth(1).click();
    await expect(page).toHaveURL(/#\/brief\/list$/);
    const chip = page.getByRole('button', { name: /^注目候補（ゾーン＋接近）\s*21/ });
    await expect(chip).toBeVisible();
    expect((await chip.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(page.getByTestId('brief-candidate')).toHaveCount(20);
    await expect(page.getByRole('button', { name: 'さらに表示（残り 1件）' })).toBeVisible();
    for (const button of await page.getByRole('group', { name: '絞り込み' }).getByRole('button').all()) await expect(button).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(chip).toHaveCount(0);
    await expect(page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^買いゾーン/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '今日' }).click();
    await tiles.nth(2).click();
    await expect(page).toHaveURL(/#\/brief\/watch$/);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`すべての候補 ${name}`, () => {
  test.use(device);
  test('opens every selected stock with no search, not the buy zone alone', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list');
    await page.getByRole('searchbox', { name: '銘柄を検索' }).fill('ZZ');
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '今日' }).click();
    await page.getByRole('region', { name: '注目候補' }).getByRole('link', { name: 'すべての候補' }).click();
    await expect(page).toHaveURL(/#\/brief\/list$/);
    await expect(page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^選定すべて\s*21$/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('searchbox', { name: '銘柄を検索' })).toHaveValue('');
    await expect(page.getByTestId('brief-candidate')).toHaveCount(name === 'phone' ? 20 : 21);
    expect(errors).toEqual([]);
  });
});

// One date on a phone's first screen: the bar's. The 候補, ウォッチ and 市場 headings stay for assistive tech only;
// the tabs, the bar's second line and the watch count read at 12px.
for (const [width, device] of Object.entries({ 320: phone(320, 640), 375: phone(375, 812), 390: VIEWPORTS.phone })) test.describe(`one date and the 12px chrome at ${width}px`, () => {
  test.use(device);
  test('the list, watch and market headings are visually hidden, never removed', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list', { storage: { 'research-watch': ['ZZNV', 'ZZSD'] } });
    for (const [hash, heading] of [['#/brief/list', '候補'], ['#/brief/watch', 'ウォッチ'], ['#/brief/market', '市場']]) {
      await page.goto(`/${hash}`);
      const title = page.getByRole('heading', { level: 1, name: heading });
      await expect(title).toBeAttached();
      // Polled: read at once after the tab switch, the box was larger on some runs of a cold dev server.
      await expect.poll(() => page.locator('.brief-hero').evaluate(node => { const box = node.getBoundingClientRect(); return box.width <= 1 && box.height <= 1; })).toBe(true);
      await expect(page.locator('.brief-bar-title')).toContainText('分析基準日 10/2（金）引け・米国株');
    }
    const sizes = await page.locator('.brief-tabs a, .brief-bar-title > span, .brief-count').evaluateAll(nodes => nodes.map(node => [node.textContent, parseFloat(getComputedStyle(node).fontSize)]));
    expect(sizes.length).toBeGreaterThanOrEqual(6);
    expect(sizes.filter(([, size]) => size < 12)).toEqual([]);
    for (const box of await page.locator('.brief-tabs a').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect()))) expect(box.height).toBeGreaterThanOrEqual(44);
    const chrome = await page.evaluate(() => document.querySelector('.brief-bar').getBoundingClientRect().height + document.querySelector('.brief-dock').getBoundingClientRect().height);
    expect(chrome).toBeLessThanOrEqual(110);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('the stock dock: the list position and the ☆ beside it, 44px targets, the chrome within 110px', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV');
    const dock = page.locator('.brief-dock');
    await expect(dock.locator('.brief-dockpos .numeric')).toHaveText('1/5');
    await expect(dock.locator('.brief-dockpos p')).toContainText('5件中1件目 注目候補');
    for (const box of await dock.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect()))) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    expect(await dock.evaluate(node => node.getBoundingClientRect().height)).toBe(56);
    const chrome = await page.evaluate(() => document.querySelector('.brief-bar').getBoundingClientRect().height + document.querySelector('.brief-dock').getBoundingClientRect().height);
    expect(chrome).toBeLessThanOrEqual(110);
    expect(await dock.locator('.brief-dockpos p').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('a stock outside the stepped list says so in words, and the dock never cuts the list\'s name', async ({ page }) => {
    const clipped = locator => locator.evaluate(node => [node, ...node.querySelectorAll('span:not(.sr-only)')].some(el => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1));
    // ZZSD is not among Today's top focus rows, which a direct link steps through.
    const { errors } = await openBrief(page, '#/brief/stock/ZZSD');
    const position = page.locator('.brief-dock .brief-dockpos p');
    await expect(position).toHaveText('一覧外・注目候補の上位5件');
    await expect(position.locator('[aria-hidden="true"], .sr-only')).toHaveCount(0);
    expect(await clipped(position)).toBe(false);
    // The next stock enters the list at its first row.
    await page.locator('.brief-dock').getByRole('button', { name: '次の候補' }).click();
    await expect(page).toHaveURL(/#\/brief\/stock\/ZZNV$/);
    await expect(position).toContainText('1/5');
    await expect(position).toContainText('注目候補（上位）');
    expect(await clipped(position)).toBe(false);
    for (const node of await position.locator('span:not(.sr-only)').all()) expect(await node.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
    expect(errors).toEqual([]);
  });
});
