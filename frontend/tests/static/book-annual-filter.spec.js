import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { withFinancialProof } from '../../src/static/testFinancialFixture.js';
import { nativeAnnualFixture } from '../../src/test/fixtures/nativeAnnual.js';

// All symbols, companies, source observations, receipt markers and prices below
// are synthetic consumer fixtures. They do not certify a financial provider,
// receipt replay, book contents, historical publication, or a complete method.
const DATE = '2026-10-02';
const NOW = '2026-10-03T16:35:00.000Z';
const NOW_MS = Date.parse(NOW);
const OBSERVED_AT = '2026-10-03T15:35:00.000Z';
const VALID_UNTIL = '2026-10-06T04:00:00.000Z'; // Fourth New York midnight after DATE.
const LABEL = '年次EPS：各年増益＋3年CAGR25%以上（書籍付録Aの一部）';
const FILTER_ID = 'oneil-appendix-a-annual-eps';
const WIDTHS = [1440, 390, 320];
const ALL_SYMBOLS = ['EPSDOWN', 'EPSMISSING', 'EPSSTALE', 'EPSPASSA', 'EPSIDENTITY', 'EPSPASSB', 'EPSPARTIAL', 'EPSSECTOR', 'EPSBASEFAIL'];
const TECH_SYMBOLS = ALL_SYMBOLS.filter(symbol => symbol !== 'EPSSECTOR');
const FILTERED_TECH = ['EPSPASSA', 'EPSPASSB', 'EPSBASEFAIL'];
const STRICT_TECH = ['EPSPASSA', 'EPSPASSB'];
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const FONT_STYLESHEETS = new Set([
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap',
  'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap',
]);

function syntheticRow(symbol, values, rs, sector = 'Technology') {
  return withFinancialProof(withAuditFixture({
    symbol, company_name: `Synthetic annual-filter case ${symbol}`, market: 'US',
    currency: 'USD', current_price: 102, se_pivot_price: 100, adv_usd: 50000000,
    rs_rating: rs, gics_sector: sector, chart_path: `${symbol}.json`,
    market_above_50dma: true, market_above_200dma: true,
    financial_history: {
      symbol, as_of_date: DATE, status: 'available', basis: 'reported_diluted_eps',
      currency: 'USD', source: 'Synthetic annual-filter provider', retrieved_at: OBSERVED_AT,
      annual: values.map((eps, index) => ({ end: `${2022 + index}-12-31`, eps })), quarterly: [],
    },
  }, DATE), NOW_MS, DATE);
}

const passA = syntheticRow('EPSPASSA', [1, 1.2, 1.6, 2], 96);
const passB = syntheticRow('EPSPASSB', [1, 2, 4, 8], 94);
const nativeHistory = nativeAnnualFixture('CAD', [1, 2, 4, 8]);
passB.financial_history = {
  ...nativeHistory, symbol: passB.symbol, as_of_date: DATE,
  source: 'Synthetic annual-filter provider', retrieved_at: OBSERVED_AT,
  annual_source: {
    ...nativeHistory.annual_source, symbol: passB.symbol, observed_at: OBSERVED_AT,
    capture_id: 'synthetic-annual-browser-capture',
  },
};
const stale = syntheticRow('EPSSTALE', [1, 2, 4, 8], 97);
stale.financial_history.retrieved_at = new Date(NOW_MS - 73 * 3600000).toISOString();
const identityInvalid = syntheticRow('EPSIDENTITY', [1, 2, 4, 8], 95);
identityInvalid.financial_history.market = 'JP'; // Conflicts with the US row, despite positive numbers.
// Deliberately non-ranked input order: CSV and navigation must preserve the
// method's ranking after AND-filtering, rather than input or alphabetical order.
const ROWS = [
  passB, syntheticRow('EPSSECTOR', [1, 2, 4, 8], 92, 'Financial'),
  syntheticRow('EPSDOWN', [1, 2, 1.5, 3], 99), stale,
  syntheticRow('EPSBASEFAIL', [1, 2, 4, 8], 60), passA,
  syntheticRow('EPSMISSING', [1, null, 2, 3], 98), identityInvalid,
  syntheticRow('EPSPARTIAL', [null, 2, 1, 3], 93),
];
const BARS = Array.from({ length: 320 }, (_, index) => ({
  date: new Date(Date.parse(DATE) - (319 - index) * 86400000).toISOString().slice(0, 10),
  open: 85.75 + index * .05, high: 86.75 + index * .05,
  low: 84.75 + index * .05, close: 86.05 + index * .05, volume: 1000000 + index * 1000,
}));
const MANIFEST = {
  as_of_date: DATE, generated_at: NOW, research_generation: 'synthetic-annual-browser-v1',
  default_market: 'US', supported_markets: ['US'], assets: { research: { path: 'research.json' } },
};

test.use({ serviceWorkers: 'block' });

async function installFixture({ page, context, baseURL }, width, rows = ROWS) {
  // Alternate scenarios may only narrow this file's existing synthetic rows.
  // Research and chart responses share the same bounded subset.
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every(row => ROWS.includes(row))).toBe(true);
  expect(new Set(rows).size).toBe(rows.length);
  const blockedRequests = [], pageErrors = [];
  const origin = new URL(baseURL).origin;
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
  // Fixed wall time keeps ordinary timers/animations running. Research workers
  // receive the page's explicit evaluation time through the production protocol.
  await page.clock.setFixedTime(new Date(NOW));
  // Context routing also catches dedicated-worker data requests. Never contact
  // a financial provider or send a mutation, even if local env config changes.
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    // These exact imports come from index.css and static/theme/foundation.css.
    // Fulfill them locally so the browser uses system fallbacks: no Google Fonts
    // request or font download is sent, and the external-data guard stays strict.
    // This fixture does not certify production web-font rendering or geometry.
    // Axe's cross-origin stylesheet preloader rereads these exact imports by XHR.
    if (request.method() === 'GET' && ['stylesheet', 'xhr'].includes(request.resourceType()) && FONT_STYLESHEETS.has(request.url())) {
      return route.fulfill({ contentType: 'text/css', headers: { 'access-control-allow-origin': origin }, body: '/* Synthetic no-network font fixture. */' });
    }
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
      blockedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (url.pathname === '/publication.json' || url.pathname === '/ibd-reference.json') {
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    }
    if (url.pathname.startsWith('/static-data/')) {
      const path = url.pathname.slice('/static-data/'.length);
      if (path === 'manifest.json') return route.fulfill({ json: MANIFEST });
      if (path === 'research.json') return route.fulfill({ json: { as_of_date: DATE, rows } });
      const row = rows.find(item => item.chart_path === path);
      if (row) return route.fulfill({ json: {
        symbol: row.symbol, as_of_date: DATE, generated_at: NOW, stock_data: row, bars: BARS,
        rs_line: BARS.map((bar, index) => ({ time: bar.date, value: 1 + index * .002 })),
      } });
      blockedRequests.push(`Unmocked static fixture: ${path}`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  return () => {
    expect(blockedRequests, 'All data must come from the synthetic fixture; no remote requests or writes').toEqual([]);
    expect(pageErrors, 'No uncaught browser errors').toEqual([]);
  };
}

const board = page => page.getByRole('region', { name: '対象銘柄', exact: true });
const detail = page => page.getByRole('region', { name: '銘柄詳細', exact: true });
const candidate = (page, symbol) => board(page).getByRole('button', { name: new RegExp(`^${symbol} の分析を表示`) });
const annual = drawer => drawer.getByRole('checkbox', { name: LABEL, exact: true });
const activeNotice = page => page.getByRole('status').filter({ hasText: '追加絞り込み有効：年次EPS' });
const candidateSymbols = page => board(page).locator('.candidate-name-header > strong');

async function openFilters(page, compare = false) {
  await page.getByRole('button', { name: compare ? '手法・絞り込み' : '候補を絞り込む', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '候補を絞り込む', exact: true });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function showCandidates(page, drawer) {
  await drawer.getByRole('button', { name: '候補を確認する →', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(board(page)).toBeFocused();
}

async function returnToList(page, width) {
  if (width < 700) {
    // The visible header control changes views; unlike the drawer CTA, its
    // existing event handler does not promise to move focus to the board.
    await page.getByRole('button', { name: '← 候補一覧', exact: true }).click();
    await expect(page.locator('main.research-workbench')).toHaveAttribute('data-mobile-view', 'list');
    await expect(board(page)).toBeVisible();
  }
}

async function expectNoOverflow(page, scope) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await scope.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
}

async function expectMethodLabelsFit(scope, width, gridBreakpoint = 420) {
  const methods = scope.getByRole('group', { name: '投資手法', exact: true });
  const buttons = methods.getByRole('button');
  await expect(buttons).toHaveText(['ミネルヴィニ', '基本と原則', 'オニール', 'IBD型']);
  await expect(methods).toHaveCSS('display', width <= gridBreakpoint ? 'grid' : 'flex');
  await methods.scrollIntoViewIfNeeded();
  const boxes = await buttons.evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    const range = document.createRange();
    range.selectNodeContents(node);
    return {
      label: node.textContent, left: box.left, top: box.top, right: box.right, bottom: box.bottom,
      height: box.height, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
      content: {
        left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        right: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
        top: box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
        bottom: box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom),
      },
      text: [...range.getClientRects()].map(rect => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height })),
    };
  }));
  for (const [index, box] of boxes.entries()) {
    await expect(buttons.nth(index)).toBeInViewport({ ratio: 1 });
    expect(box.scrollWidth, `${box.label}: no horizontal clipping`).toBeLessThanOrEqual(box.clientWidth);
    expect(box.scrollHeight, `${box.label}: no vertical clipping`).toBeLessThanOrEqual(box.clientHeight);
    if (width <= 420) expect(box.height, `${box.label}: narrow touch target`).toBeGreaterThanOrEqual(44);
    expect(box.text.length, `${box.label}: rendered text range`).toBeGreaterThan(0);
    for (const text of box.text) {
      expect(text.width).toBeGreaterThan(0);
      expect(text.height).toBeGreaterThan(0);
      // Half a CSS pixel allows fractional text metrics, not clipped letters.
      expect(text.left, `${box.label}: full label left edge`).toBeGreaterThanOrEqual(box.content.left - .5);
      expect(text.right, `${box.label}: full label right edge`).toBeLessThanOrEqual(box.content.right + .5);
      expect(text.top, `${box.label}: full label top edge`).toBeGreaterThanOrEqual(box.content.top - .5);
      expect(text.bottom, `${box.label}: full label bottom edge`).toBeLessThanOrEqual(box.content.bottom + .5);
    }
    for (const other of boxes.slice(index + 1)) {
      const overlapX = Math.min(box.right, other.right) - Math.max(box.left, other.left);
      const overlapY = Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top);
      expect(overlapX > .5 && overlapY > .5, `${box.label} and ${other.label}: disjoint buttons`).toBe(false);
    }
  }
  if (width <= gridBreakpoint) {
    expect(Math.abs(boxes[0].top - boxes[1].top)).toBeLessThanOrEqual(.5);
    expect(Math.abs(boxes[2].top - boxes[3].top)).toBeLessThanOrEqual(.5);
    expect(boxes[2].top).toBeGreaterThanOrEqual(boxes[0].bottom - .5);
    expect(Math.abs(boxes[0].left - boxes[2].left)).toBeLessThanOrEqual(.5);
  } else {
    for (const box of boxes) expect(Math.abs(box.top - boxes[0].top)).toBeLessThanOrEqual(.5);
    for (let index = 1; index < boxes.length; index++) expect(boxes[index].left).toBeGreaterThanOrEqual(boxes[index - 1].right - .5);
  }
}

async function checkMethodKeyboard(page, drawer, width) {
  const methods = drawer.getByRole('group', { name: '投資手法', exact: true });
  const buttons = methods.getByRole('button');
  const search = drawer.getByRole('textbox');
  await expect(search).toHaveCount(1);
  await search.focus();
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press('Tab');
    await expect(buttons.nth(index)).toBeFocused();
    await page.keyboard.press(index % 2 ? 'Space' : 'Enter');
    await expect(buttons.nth(index)).toBeFocused();
    await expect(buttons.nth(index)).toHaveAttribute('aria-pressed', 'true');
    await expect(methods.locator('button[aria-pressed="true"]')).toHaveCount(1);
    await expect(annual(drawer)).toBeChecked();
    // Measure every full label with each method's selected/bold state as well.
    await expectMethodLabelsFit(drawer, width);
  }
  await page.keyboard.press('Shift+Tab');
  await expect(buttons.nth(2)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expectMethodLabelsFit(drawer, width);
}

async function scrollPageToTop(page, width) {
  // Scroll over the fixed header, outside canvases that consume wheel gestures.
  await page.mouse.move(width / 2, 20);
  await page.mouse.wheel(0, -10000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

async function captureTopArea(page, info, width, theme) {
  await scrollPageToTop(page, width);
  await expect(page.getByTestId('home-hero')).toBeVisible();
  await expect(activeNotice(page)).toContainText('研究画面のみ · 2銘柄');
  await expectHeroControlsFit(page);
  const height = await activeNotice(page).evaluate(node => Math.ceil(node.getBoundingClientRect().bottom + window.scrollY));
  expect(height).toBeGreaterThan(0);
  const name = `annual-filter-hero-status-${width}-${theme}`;
  await info.attach(name, { body: await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, clip: { x: 0, y: 0, width, height } }), contentType: 'image/png' });
}

async function checkNarrowBoundaries(page, info, theme) {
  const original = page.viewportSize();
  try {
    for (const width of [375, 380, 381]) {
      await page.setViewportSize({ ...original, width });
      await expect(page.locator('.leader-shell')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('main.research-workbench')).toHaveAttribute('data-mobile-view', 'list');
      await expectMethodLabelsFit(board(page), width, 380);
      await expect(candidateSymbols(page)).toHaveText(STRICT_TECH);
      await scrollPageToTop(page, width);
      await expectHeroControlsFit(page);
      await expect(activeNotice(page)).toContainText('研究画面のみ · 2銘柄');
      const height = await board(page).evaluate(node => Math.ceil(node.getBoundingClientRect().bottom + window.scrollY));
      const name = `annual-filter-boundary-${width}-${theme}`;
      await info.attach(name, { body: await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, clip: { x: 0, y: 0, width, height } }), contentType: 'image/png' });
    }
  } finally {
    await page.setViewportSize(original);
  }
  await expectMethodLabelsFit(board(page), original.width, 380);
  await expect(candidateSymbols(page)).toHaveText(STRICT_TECH);
}

const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5;
const rectangle = async locator => locator.evaluate(node => {
  const box = node.getBoundingClientRect();
  return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
});

const visibleTextRectangles = async locator => locator.evaluate(root => {
  const boxes = [], walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.textContent.trim() || text.parentElement.closest('button,a,input,select,textarea')) continue;
    const range = document.createRange();
    range.selectNodeContents(text);
    for (const rect of range.getClientRects()) {
      let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom;
      for (let parent = text.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden') { right = left; break; }
        // Company labels intentionally ellipsize. Compare their painted text,
        // not hidden overflow, with the price and independent touch controls.
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)) {
          left = Math.max(left, bounds.left + parent.clientLeft);
          right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth);
        }
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)) {
          top = Math.max(top, bounds.top + parent.clientTop);
          bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
        }
      }
      if (right > left && bottom > top) boxes.push({ left, right, top, bottom });
    }
  }
  return boxes;
});

async function expectHeroControlsFit(page) {
  const hero = page.getByTestId('home-hero');
  const actions = hero.locator('.hero-actions').getByRole('button');
  await expect(actions).toHaveCount(2);
  await expect(hero.getByRole('heading', { level: 1 })).toBeVisible();
  const heroBox = await rectangle(hero), controls = [];
  for (const action of await actions.all()) {
    await expect(action).toBeInViewport({ ratio: 1 });
    const box = await rectangle(action);
    expect(box.height, 'Hero action touch height').toBeGreaterThanOrEqual(44);
    expect(box.width, 'Hero action touch width').toBeGreaterThanOrEqual(44);
    expect(box.left).toBeGreaterThanOrEqual(heroBox.left - .5);
    expect(box.right).toBeLessThanOrEqual(heroBox.right + .5);
    expect(box.top).toBeGreaterThanOrEqual(heroBox.top - .5);
    expect(box.bottom).toBeLessThanOrEqual(heroBox.bottom + .5);
    controls.push(box);
  }
  expect(overlaps(controls[0], controls[1]), 'Hero actions must not overlap each other').toBe(false);
  // Text ranges measure the visible headline/date, rather than an h1 block
  // whose unused horizontal space can legitimately share the actions' row.
  const textBoxes = await hero.locator('.hero-copy h1, .hero-date').evaluateAll(nodes => nodes.flatMap(node => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].filter(box => box.width && box.height).map(box => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom }));
  }));
  expect(textBoxes.length).toBeGreaterThan(0);
  for (const text of textBoxes) for (const control of controls) expect(overlaps(text, control), 'Hero heading/date text must not overlap actions').toBe(false);
  await expectNoOverflow(page, hero);
}

async function captureDetail(page, info, width, theme) {
  const panel = detail(page), head = panel.locator('.research-symbol-head');
  const heading = panel.getByRole('heading', { name: 'EPSPASSA', exact: true });
  const watch = panel.getByRole('button', { name: 'EPSPASSA ウォッチに保存', exact: true });
  await head.scrollIntoViewIfNeeded();
  await expect(heading).toBeVisible();
  await expect(watch).toBeVisible();
  await expect(panel.locator('.research-chart canvas').first()).toBeVisible();
  await expectNoOverflow(page, panel);
  expect(await head.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(overlaps(await rectangle(heading), await rectangle(watch)), 'Detail symbol and watch action must not overlap').toBe(false);
  const price = head.locator('.research-symbol-price strong');
  await expect(price).toHaveText('$102.00');
  const headBox = await rectangle(head);
  for (const text of [heading, price]) {
    await expect(text).toBeInViewport({ ratio: 1 });
    const raw = await text.evaluate(node => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].map(box => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom }));
    });
    expect(raw.length).toBeGreaterThan(0);
    for (const box of raw) {
      expect(box.left, 'Complete symbol/price must fit the header').toBeGreaterThanOrEqual(headBox.left - .5);
      expect(box.right, 'Complete symbol/price must fit the header').toBeLessThanOrEqual(headBox.right + .5);
      expect(box.top, 'Complete symbol/price must fit the header').toBeGreaterThanOrEqual(headBox.top - .5);
      expect(box.bottom, 'Complete symbol/price must fit the header').toBeLessThanOrEqual(headBox.bottom + .5);
    }
  }
  const identityText = await visibleTextRectangles(head.locator('.symbol-identity'));
  const priceText = await visibleTextRectangles(head.locator('.research-symbol-price'));
  expect(identityText.length).toBeGreaterThan(0);
  expect(priceText.length).toBeGreaterThan(0);
  for (const identity of identityText) for (const price of priceText) expect(overlaps(identity, price), 'Visible identity/title/company and price text must be disjoint').toBe(false);
  const readiness = head.getByRole('button', { name: /^購入条件 \d+\/\d+$/ });
  const controls = [];
  for (const control of [watch, readiness]) {
    await expect(control).toBeInViewport({ ratio: 1 });
    const box = await rectangle(control);
    for (const text of [...identityText, ...priceText]) expect(overlaps(text, box), 'Header text must clear watch/readiness controls').toBe(false);
    controls.push(box);
  }
  expect(overlaps(controls[0], controls[1]), 'Watch and readiness controls must be disjoint').toBe(false);
  const panelBox = await rectangle(panel), chartBox = await rectangle(panel.locator('.research-chart'));
  expect(chartBox.left).toBeGreaterThanOrEqual(panelBox.left - .5);
  expect(chartBox.right).toBeLessThanOrEqual(panelBox.right + .5);
  expect(chartBox.width).toBeGreaterThan(0);
  expect(chartBox.height).toBeGreaterThan(0);
  const tabs = panel.getByRole('tablist', { name: '銘柄の詳細情報', exact: true });
  expect(await tabs.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const evidence = panel.getByRole('region', { name: '年次EPSの追加条件', exact: true });
  await expect(evidence).toHaveAttribute('data-condition-state', 'pass');
  await expect(evidence).toContainText('追加絞り込み有効');
  const name = `annual-filter-detail-${width}-${theme}`;
  await info.attach(`${name}-header`, { body: await page.screenshot({ path: info.outputPath(`${name}-header.png`) }), contentType: 'image/png' });
  await info.attach(name, { body: await panel.screenshot({ path: info.outputPath(`${name}.png`) }), contentType: 'image/png' });
}

async function captureModal(page, info, width, theme) {
  const modal = page.getByRole('dialog'), header = modal.getByTestId('expanded-chart-header');
  const footer = modal.getByTestId('expanded-chart-footer'), scroll = modal.getByTestId('expanded-chart-scroll');
  const canvas = modal.locator('canvas').first();
  await expect(canvas).toBeVisible();
  await expectNoOverflow(page, modal);
  expect(await scroll.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const viewport = page.viewportSize(), modalBox = await rectangle(modal);
  expect(modalBox.left).toBeGreaterThanOrEqual(-.5);
  expect(modalBox.top).toBeGreaterThanOrEqual(-.5);
  expect(modalBox.right).toBeLessThanOrEqual(viewport.width + .5);
  expect(modalBox.bottom).toBeLessThanOrEqual(viewport.height + .5);
  const plot = modal.locator('[data-chart-symbol="EPSPASSA"]');
  await expect(plot).toHaveCount(1);
  await expect(plot).toBeVisible();
  // The real ResizeObserver/RAF fitter must contain the entire plot (including
  // RS, volume and date axis) at these 844/900px heights. Short-height scrolling
  // is a separate layout contract; the first price canvas alone is insufficient.
  await expect.poll(() => modal.evaluate(node => {
    const plot = node.querySelector('[data-chart-symbol="EPSPASSA"]').getBoundingClientRect();
    const header = node.querySelector('[data-testid="expanded-chart-header"]').getBoundingClientRect();
    const footer = node.querySelector('[data-testid="expanded-chart-footer"]').getBoundingClientRect();
    const modal = node.getBoundingClientRect();
    return {
      positiveArea: plot.width > 0 && plot.height > 0,
      fitsWidth: plot.left >= modal.left - .5 && plot.right <= modal.right + .5,
      clearsHeader: plot.top >= header.bottom - .5,
      clearsFooter: plot.bottom <= footer.top + .5,
    };
  }), { message: 'The whole fitted plot must stay between the fixed modal header and footer' }).toEqual({ positiveArea: true, fitsWidth: true, clearsHeader: true, clearsFooter: true });
  await expect(plot).toBeInViewport({ ratio: 1 });
  const headerBox = await rectangle(header), footerBox = await rectangle(footer), canvasBox = await rectangle(canvas);
  expect(overlaps(headerBox, footerBox), 'Modal header and navigation footer must be disjoint').toBe(false);
  expect(canvasBox.width).toBeGreaterThan(0);
  expect(canvasBox.height).toBeGreaterThan(0);
  expect(canvasBox.left).toBeGreaterThanOrEqual(modalBox.left - .5);
  expect(canvasBox.right).toBeLessThanOrEqual(modalBox.right + .5);
  expect(canvasBox.top, 'Initial plot must clear the fixed header').toBeGreaterThanOrEqual(headerBox.bottom - .5);
  expect(canvasBox.bottom, 'Initial plot must clear the fixed navigation footer').toBeLessThanOrEqual(footerBox.top + .5);
  for (const [name, container] of [['チャートを閉じる', headerBox], ['前の銘柄', footerBox], ['次の銘柄', footerBox]]) {
    const button = modal.getByRole('button', { name, exact: true });
    await expect(button).toBeInViewport({ ratio: 1 });
    const box = await rectangle(button);
    expect(box.left).toBeGreaterThanOrEqual(container.left - .5);
    expect(box.right).toBeLessThanOrEqual(container.right + .5);
    expect(box.top).toBeGreaterThanOrEqual(container.top - .5);
    expect(box.bottom).toBeLessThanOrEqual(container.bottom + .5);
  }
  expect(overlaps(await rectangle(modal.getByRole('button', { name: '前の銘柄', exact: true })), await rectangle(modal.getByRole('button', { name: '次の銘柄', exact: true }))), 'Modal navigation buttons must not overlap').toBe(false);
  const name = `annual-filter-modal-${width}-${theme}`;
  await info.attach(name, { body: await page.screenshot({ path: info.outputPath(`${name}.png`) }), contentType: 'image/png' });
}

// The exporter quotes every field, including JSON evidence with commas/quotes.
// Parse those fields rather than searching CSV substrings for ticker names.
function parseCsv(text) {
  const records = [], values = [];
  let value = '', quoted = false;
  const csv = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { values.push(value); value = ''; }
    else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && csv[index + 1] === '\n') index++;
      values.push(value); records.push([...values]); values.length = 0; value = '';
    } else value += char;
  }
  expect(quoted, 'CSV quotes must be balanced').toBe(false);
  values.push(value); records.push([...values]);
  const [header, ...rows] = records;
  for (const row of rows) expect(row).toHaveLength(header.length);
  return { header, rows: rows.map(row => Object.fromEntries(header.map((field, index) => [field, row[index]]))) };
}

async function downloadCsv(page, drawer, method) {
  const pending = page.waitForEvent('download');
  await drawer.getByRole('button', { name: '全検索結果をCSV保存 ↓', exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(`research-${method}-${DATE}.csv`);
  expect(await download.failure()).toBeNull();
  return parseCsv(await readFile(await download.path(), 'utf8'));
}

test('zero-qualified hero text and actions remain readable at 381/390/420px in both themes', async ({ page, context, baseURL }, info) => {
  const verify = await installFixture({ page, context, baseURL }, 381, ROWS.filter(row => row.symbol === 'EPSBASEFAIL'));
  await page.goto('/');
  // This existing row passes the annual overlay but fails the base RS rule.
  // Keep it visible to distinguish zero qualified candidates from empty input.
  await expect(candidateSymbols(page)).toHaveText(['EPSBASEFAIL']);
  const drawer = await openFilters(page);
  await expect(drawer.getByTestId('annual-eps-coverage')).toContainText('1銘柄：数値充足 1 · 未充足 0 · 未確認 0');
  await annual(drawer).check();
  await showCandidates(page, drawer);
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: 'ライトモードに切り替え', exact: true }).click();
    await expect(page.locator('.leader-shell')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [381, 390, 420]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.locator('main.research-workbench')).toHaveAttribute('data-mobile-view', 'list');
      await expect(candidateSymbols(page)).toHaveText(['EPSBASEFAIL']);
      await expectMethodLabelsFit(board(page), width, 380);
      await scrollPageToTop(page, width);
      const hero = page.getByTestId('home-hero');
      const heading = hero.getByRole('heading', { name: '選定候補はありません。', level: 1, exact: true });
      await expect(heading).toBeInViewport({ ratio: 1 });
      await expectHeroControlsFit(page);
      const rendered = await heading.evaluate(node => {
        const box = node.getBoundingClientRect(), style = getComputedStyle(node);
        const range = document.createRange();
        range.selectNodeContents(node);
        return {
          left: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight),
          top: box.top + parseFloat(style.paddingTop), bottom: box.bottom - parseFloat(style.paddingBottom),
          unclipped: node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight,
          text: [...range.getClientRects()].filter(rect => rect.width && rect.height).map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })),
        };
      });
      expect(rendered.unclipped, 'The complete zero-qualified heading must not be clipped').toBe(true);
      expect(rendered.text.length).toBeGreaterThan(0);
      for (const text of rendered.text) {
        expect(text.left).toBeGreaterThanOrEqual(rendered.left - .5);
        expect(text.right).toBeLessThanOrEqual(rendered.right + .5);
        expect(text.top).toBeGreaterThanOrEqual(rendered.top - .5);
        expect(text.bottom).toBeLessThanOrEqual(rendered.bottom + .5);
      }
      await expect(activeNotice(page)).toContainText('研究画面のみ · 1銘柄');
      const height = await board(page).evaluate(node => Math.ceil(node.getBoundingClientRect().bottom + window.scrollY));
      const name = `annual-filter-zero-qualified-${width}-${theme}`;
      await info.attach(name, { body: await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, clip: { x: 0, y: 0, width, height } }), contentType: 'image/png' });
    }
  }
  await page.getByRole('button', { name: 'ダークモードに切り替え', exact: true }).click();
  await expect(page.locator('.leader-shell')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  verify();
});

for (const width of WIDTHS) {
  test(`annual EPS defaults off; repeated keyboard toggles preserve base filters and accessible layout at ${width}px`, async ({ page, context, baseURL }, info) => {
    const verify = await installFixture({ page, context, baseURL }, width);
    await page.goto('/');
    await expect(candidateSymbols(page)).toHaveText(ALL_SYMBOLS);
    await expect(activeNotice(page)).toHaveCount(0);
    const drawer = await openFilters(page);
    await expect(annual(drawer)).not.toBeChecked();
    await expect(drawer.getByTestId('annual-eps-coverage')).toHaveText('現在の絞り込み対象 9銘柄：数値充足 4 · 未充足 2 · 未確認 3 · 対象外 0。追加条件を適用する前の件数です。');
    await drawer.getByRole('button', { name: '基本と原則', exact: true }).click();
    await drawer.getByRole('combobox', { name: '業種', exact: true }).selectOption('Technology');
    await drawer.getByLabel('全条件通過のみ', { exact: true }).check();
    const coverage = drawer.getByTestId('annual-eps-coverage');
    await expect(coverage).toHaveText('現在の絞り込み対象 7銘柄：数値充足 2 · 未充足 2 · 未確認 3 · 対象外 0。追加条件を適用する前の件数です。');
    await expect(coverage).toHaveAttribute('aria-live', 'polite');
    for (const enabled of [true, false, true, false, true]) {
      await annual(drawer).focus();
      await annual(drawer).press('Space');
      await expect(annual(drawer)).toBeChecked({ checked: enabled });
      await expect(annual(drawer)).toBeFocused();
      await expect(drawer.getByLabel('全条件通過のみ', { exact: true })).toBeChecked();
      await expect(drawer.getByRole('combobox', { name: '業種', exact: true })).toHaveValue('Technology');
      await expect(drawer.getByRole('button', { name: '基本と原則', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(coverage).toContainText('7銘柄：数値充足 2 · 未充足 2 · 未確認 3');
      await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('annualEps')).toBe(enabled ? '1' : null);
    }
    await drawer.getByRole('button', { name: 'ミネルヴィニ', exact: true }).click();
    await expect(annual(drawer)).toBeChecked();
    await expect(drawer.getByLabel('全条件通過のみ', { exact: true })).toBeChecked();
    await drawer.getByRole('button', { name: '基本と原則', exact: true }).click();
    await drawer.getByRole('combobox', { name: '業種', exact: true }).selectOption('Financial');
    await expect(annual(drawer)).toBeChecked();
    await expect(coverage).toContainText('1銘柄：数値充足 1 · 未充足 0 · 未確認 0');
    await drawer.getByRole('combobox', { name: '業種', exact: true }).selectOption('Technology');
    await expect(coverage).toContainText('7銘柄：数値充足 2 · 未充足 2 · 未確認 3');
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') {
        await page.getByRole('button', { name: 'ライトモードに切り替え', exact: true }).click();
        await openFilters(page);
      }
      await expect(page.locator('.leader-shell')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await checkMethodKeyboard(page, drawer, width);
      await expect(annual(drawer)).toBeChecked();
      await expect(drawer.getByLabel('全条件通過のみ', { exact: true })).toBeChecked();
      await expect(drawer.getByRole('combobox', { name: '業種', exact: true })).toHaveValue('Technology');
      await expect(drawer.getByRole('button', { name: '基本と原則', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await annual(drawer).scrollIntoViewIfNeeded();
      await expectNoOverflow(page, drawer);
      expect((await new AxeBuilder({ page }).include('[role="dialog"][aria-labelledby="research-filter-title"]').withTags(WCAG_TAGS).analyze()).violations).toEqual([]);
      await info.attach(`annual-filter-drawer-${width}-${theme}`, { body: await page.screenshot({ path: info.outputPath(`annual-filter-drawer-${width}-${theme}.png`) }), contentType: 'image/png' });
      await showCandidates(page, drawer);
      await expectMethodLabelsFit(board(page), width, 380);
      await expect(candidateSymbols(page)).toHaveText(STRICT_TECH);
      await expect(activeNotice(page)).toContainText('研究画面のみ · 2銘柄');
      await expect(activeNotice(page)).toContainText('基本手法の通過数・順位・購入条件は別判定');
      if (width < 700) {
        await expect(detail(page)).toBeHidden();
        await candidate(page, 'EPSPASSA').click();
        await expect(page.locator('main.research-workbench')).toHaveAttribute('data-mobile-view', 'detail');
        await expect(detail(page)).toBeFocused();
        await expect(board(page)).toBeHidden();
        await expect(detail(page).getByRole('heading', { name: 'EPSPASSA', exact: true })).toBeVisible();
        await returnToList(page, width);
        await expect(candidateSymbols(page)).toHaveText(STRICT_TECH);
      }
      await expectNoOverflow(page, activeNotice(page));
      expect((await new AxeBuilder({ page }).include('#root').withTags(WCAG_TAGS).analyze()).violations).toEqual([]);
      await info.attach(`annual-filter-results-${width}-${theme}`, { body: await page.screenshot({ path: info.outputPath(`annual-filter-results-${width}-${theme}.png`) }), contentType: 'image/png' });
      await captureTopArea(page, info, width, theme);
      if (width === 390) await checkNarrowBoundaries(page, info, theme);
    }
    await page.getByRole('button', { name: 'ダークモードに切り替え', exact: true }).click();
    await expect(page.locator('.leader-shell')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(candidateSymbols(page)).toHaveText(STRICT_TECH);
    verify();
  });

  test(`annual EPS detail distinguishes known failure, missing, stale and identity-invalid evidence at ${width}px`, async ({ page, context, baseURL }) => {
    const verify = await installFixture({ page, context, baseURL }, width);
    await page.goto('/');
    await expect(candidateSymbols(page)).toHaveText(ALL_SYMBOLS);
    const cases = [
      ['EPSDOWN', 'fail', '各年増益：数値比較は未充足 · 3年CAGR：数値比較は充足', '-25.00%（未達）'],
      ['EPSPARTIAL', 'fail', '各年増益：数値比較は未充足 · 3年CAGR：未確認', 'EPSの欠損'],
      ['EPSMISSING', 'unknown', '各年増益：未確認 · 3年CAGR：未確認', 'CAGRに必要な4つの正のEPSが不足'],
      ['EPSSTALE', 'unknown', '各年増益：未確認 · 3年CAGR：未確認', '年次出典または72時間鮮度が未確認'],
      ['EPSIDENTITY', 'unknown', '各年増益：未確認 · 3年CAGR：未確認', '銘柄・市場・基準日の不整合'],
    ];
    for (const [symbol, state, components, reason] of cases) {
      await candidate(page, symbol).click();
      const evidence = detail(page).getByRole('region', { name: '年次EPSの追加条件', exact: true });
      await expect(detail(page).getByRole('heading', { name: symbol, exact: true })).toBeVisible();
      await expect(evidence).toHaveAttribute('data-condition-state', state);
      await expect(evidence).toContainText('参考比較・追加絞り込み無効');
      await expect(evidence).toContainText(components);
      await expect(evidence).toContainText(reason);
      await expectNoOverflow(page, evidence);
      await returnToList(page, width);
    }
    const drawer = await openFilters(page);
    await drawer.getByRole('button', { name: 'オニール', exact: true }).click();
    await annual(drawer).check();
    await showCandidates(page, drawer);
    await candidate(page, 'EPSPASSA').click();
    const evidence = detail(page).getByRole('region', { name: '年次EPSの追加条件', exact: true });
    await expect(evidence).toHaveAttribute('data-condition-state', 'pass');
    await expect(evidence).toContainText('追加絞り込み有効');
    await expect(evidence).toContainText('25.99%');
    await expect(detail(page).locator('.research-rules li').filter({ hasText: 'A：直近3年の各年 EPS 成長率 ≥ 25%（最小値）' })).toContainText('× 未達');
    await returnToList(page, width);
    const reopened = await openFilters(page);
    await expect(annual(reopened)).toBeChecked();
    await reopened.getByLabel('全条件通過のみ', { exact: true }).check();
    await expect(reopened.getByTestId('annual-eps-coverage')).toContainText('0銘柄');
    await expect(reopened.getByRole('button', { name: '全検索結果をCSV保存 ↓', exact: true })).toBeDisabled();
    await showCandidates(page, reopened);
    await expect(candidateSymbols(page)).toHaveCount(0);
    await expect(board(page)).toContainText('該当銘柄がありません');
    await expect(detail(page).getByRole('heading')).toHaveCount(0);
    verify();
  });

  test(`annual EPS CSV contains the filtered ranking and source metadata without changing the default export at ${width}px`, async ({ page, context, baseURL }) => {
    const verify = await installFixture({ page, context, baseURL }, width);
    await page.goto('/');
    await expect(candidateSymbols(page)).toHaveText(ALL_SYMBOLS);
    const drawer = await openFilters(page);
    const baseline = await downloadCsv(page, drawer, 'minervini');
    expect(baseline.rows.map(row => row.symbol)).toEqual(ALL_SYMBOLS);
    expect(baseline.header).not.toContain('active_filter_id');
    await drawer.getByRole('button', { name: '基本と原則', exact: true }).click();
    await drawer.getByRole('combobox', { name: '業種', exact: true }).selectOption('Technology');
    await drawer.getByLabel('全条件通過のみ', { exact: true }).check();
    await annual(drawer).check();
    const filtered = await downloadCsv(page, drawer, 'minervini2');
    expect(filtered.rows.map(row => row.symbol)).toEqual(STRICT_TECH);
    expect(filtered.header).toEqual([...baseline.header,
      'active_filter_id', 'active_filter_version', 'book_source_scope', 'book_annual_state',
      'book_annual_increase_state', 'book_annual_cagr_state', 'book_annual_eps_points',
      'book_annual_currency', 'book_annual_basis', 'book_annual_cagr_percent',
      'book_annual_comparisons', 'book_annual_unknown_reasons', 'book_annual_provider',
      'book_annual_observed_at', 'book_annual_valid_until_exclusive', 'book_annual_evaluated_at',
      'book_annual_receipt_sha256', 'book_annual_raw_payload_sha256', 'book_annual_capture_id',
      'book_annual_review_status', 'book_complete_method_status',
    ]);
    for (const row of filtered.rows) {
      expect(row).toMatchObject({
        as_of_date: DATE, method: 'minervini2', qualified: 'true',
        active_filter_id: FILTER_ID, active_filter_version: 'book-annual-eps-v1',
        book_source_scope: 'appendix_a_table_a1_annual_eps_excerpt',
        book_annual_state: 'pass', book_annual_increase_state: 'pass', book_annual_cagr_state: 'pass',
        book_annual_basis: 'reported_diluted_eps', book_annual_unknown_reasons: '',
        book_annual_provider: 'Synthetic annual-filter provider', book_annual_observed_at: OBSERVED_AT,
        book_annual_valid_until_exclusive: VALID_UNTIL, book_annual_evaluated_at: NOW,
        book_annual_review_status: 'manual_required', book_complete_method_status: 'not_evaluated',
        financial_semantics: 'current_at_evaluation_not_historical_publication',
      });
      const points = JSON.parse(row.book_annual_eps_points), comparisons = JSON.parse(row.book_annual_comparisons);
      expect(points.map(point => point.end)).toEqual(['2022-12-31', '2023-12-31', '2024-12-31', '2025-12-31']);
      expect(comparisons.map(comparison => comparison.state)).toEqual(['pass', 'pass', 'pass']);
      expect(comparisons.map(comparison => comparison.reason)).toEqual([null, null, null]);
    }
    const [usd, cad] = filtered.rows;
    expect(JSON.parse(usd.book_annual_eps_points).map(point => point.eps)).toEqual([1, 1.2, 1.6, 2]);
    expect(Number(usd.book_annual_cagr_percent)).toBeCloseTo(25.99210498948732, 8);
    expect(usd.book_annual_currency).toBe('USD');
    expect(usd.book_annual_receipt_sha256).toBe('');
    expect(usd.book_annual_capture_id).toBe('');
    expect(cad).toMatchObject({
      book_annual_currency: 'CAD', book_annual_cagr_percent: '100',
      book_annual_receipt_sha256: 'a'.repeat(64), book_annual_raw_payload_sha256: 'b'.repeat(64),
      book_annual_capture_id: 'synthetic-annual-browser-capture',
    });
    await showCandidates(page, drawer);
    await expect(candidateSymbols(page)).toHaveText(filtered.rows.map(row => row.symbol));
    const reopened = await openFilters(page);
    await annual(reopened).uncheck();
    const restored = await downloadCsv(page, reopened, 'minervini2');
    expect(restored.header).toEqual(baseline.header);
    expect(restored.rows.map(row => row.symbol)).toEqual(TECH_SYMBOLS.filter(symbol => symbol !== 'EPSBASEFAIL'));
    verify();
  });

  test(`annual EPS URL Back and Forward restore bounded state and filtered comparison cards at ${width}px`, async ({ page, context, baseURL }) => {
    const verify = await installFixture({ page, context, baseURL }, width);
    await page.goto('/');
    await expect(candidateSymbols(page)).toHaveText(ALL_SYMBOLS);
    const drawer = await openFilters(page);
    await drawer.getByRole('button', { name: '基本と原則', exact: true }).click();
    await drawer.getByRole('combobox', { name: '業種', exact: true }).selectOption('Technology');
    await annual(drawer).check();
    await showCandidates(page, drawer);
    await expect(candidateSymbols(page)).toHaveText(FILTERED_TECH);
    const enabledUrl = page.url();
    await page.goBack();
    await expect(candidateSymbols(page)).toHaveText(ALL_SYMBOLS);
    await expect(activeNotice(page)).toHaveCount(0);
    let filters = await openFilters(page);
    await expect(annual(filters)).not.toBeChecked();
    await expect(filters.getByRole('combobox', { name: '業種', exact: true })).toHaveValue('');
    await expect(filters.getByRole('button', { name: 'ミネルヴィニ', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await filters.getByRole('button', { name: '絞り込みを閉じる', exact: true }).click();
    await page.goForward();
    await expect(page).toHaveURL(enabledUrl);
    await expect(candidateSymbols(page)).toHaveText(FILTERED_TECH);
    filters = await openFilters(page);
    await expect(annual(filters)).toBeChecked();
    await expect(filters.getByRole('combobox', { name: '業種', exact: true })).toHaveValue('Technology');
    await expect(filters.getByRole('button', { name: '基本と原則', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await showCandidates(page, filters);
    // A hash navigation exercises the real router, without calling React state
    // setters. Unsupported values must remain off, including on history replay.
    await page.evaluate(() => { location.hash = '/?annualEps=unsupported&method=minervini2&sector=Technology'; });
    await expect(candidateSymbols(page)).toHaveText(TECH_SYMBOLS);
    await expect(activeNotice(page)).toHaveCount(0);
    await page.goBack();
    await expect(candidateSymbols(page)).toHaveText(FILTERED_TECH);
    await page.goForward();
    await expect(candidateSymbols(page)).toHaveText(TECH_SYMBOLS);
    await page.evaluate(() => { location.hash = '/?annualEps=1&method=minervini2&sector=Technology&view=charts'; });
    await expect(page.locator('.research-grid')).toHaveAttribute('data-view', 'charts');
    await expect(page.locator('.comparison-card h3')).toHaveText(FILTERED_TECH);
    await expect(page.getByRole('article', { name: 'EPSDOWN 比較チャート', exact: true })).toHaveCount(0);
    await expect(page.getByRole('article', { name: 'EPSPASSA 比較チャート', exact: true }).locator('canvas').first()).toBeVisible();
    await page.goBack();
    await expect(page.locator('.research-grid')).toHaveAttribute('data-view', 'list');
    await expect(candidateSymbols(page)).toHaveText(TECH_SYMBOLS);
    await page.goForward();
    await expect(page.locator('.comparison-card h3')).toHaveText(FILTERED_TECH);
    await expectNoOverflow(page, page.locator('.candidate-comparison'));
    verify();
  });

  test(`annual EPS excludes selected detail and open charts; remaining chart navigation never escapes the subset at ${width}px`, async ({ page, context, baseURL }, info) => {
    const verify = await installFixture({ page, context, baseURL }, width);
    await page.goto('/');
    await expect(candidateSymbols(page)).toHaveText(ALL_SYMBOLS);
    await candidate(page, 'EPSDOWN').click();
    await expect(detail(page).getByRole('heading', { name: 'EPSDOWN', exact: true })).toBeVisible();
    await returnToList(page, width);
    const filters = await openFilters(page);
    await filters.getByRole('combobox', { name: '業種', exact: true }).selectOption('Technology');
    await annual(filters).check();
    await showCandidates(page, filters);
    await expect(candidateSymbols(page)).toHaveText(FILTERED_TECH);
    await expect(candidate(page, 'EPSPASSA')).toHaveAttribute('aria-current', 'true');
    await expect(detail(page).getByRole('heading', { name: 'EPSDOWN', exact: true })).toHaveCount(0);
    await page.goBack();
    await expect(candidateSymbols(page)).toHaveText(ALL_SYMBOLS);
    await candidate(page, 'EPSDOWN').click();
    await detail(page).getByRole('button', { name: '日次チャートを分析', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /^EPSDOWN\s/ })).toBeVisible();
    await page.evaluate(() => { location.hash = '/?annualEps=1&sector=Technology'; });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(candidateSymbols(page)).toHaveText(FILTERED_TECH);
    await expect(detail(page).getByRole('heading', { name: 'EPSDOWN', exact: true })).toHaveCount(0);
    await candidate(page, 'EPSPASSA').click();
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await page.getByRole('button', { name: 'ライトモードに切り替え', exact: true }).click();
      await expect(page.locator('.leader-shell')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await captureDetail(page, info, width, theme);
      await detail(page).getByRole('button', { name: '日次チャートを分析', exact: true }).click();
      const modal = page.getByRole('dialog');
      await expect(modal).toHaveAccessibleName('EPSPASSA 1 / 3 銘柄');
      await expect(modal.locator('canvas').first()).toBeVisible();
      await captureModal(page, info, width, theme);
      for (const [symbol, position] of [['EPSPASSB', 2], ['EPSBASEFAIL', 3], ['EPSPASSA', 1]]) {
        await modal.getByRole('button', { name: '次の銘柄', exact: true }).click();
        await expect(modal).toHaveAccessibleName(`${symbol} ${position} / 3 銘柄`);
        await expect(modal.locator('canvas').first()).toBeVisible();
      }
      await modal.getByRole('button', { name: '前の銘柄', exact: true }).click();
      await expect(modal).toHaveAccessibleName('EPSBASEFAIL 3 / 3 銘柄');
      await modal.locator('summary').filter({ hasText: '選定条件の詳細' }).click();
      const evidence = modal.getByRole('region', { name: '年次EPSの追加条件', exact: true });
      await expect(evidence).toHaveAttribute('data-condition-state', 'pass');
      await expect(evidence).toContainText('追加絞り込み有効');
      await evidence.scrollIntoViewIfNeeded();
      await expectNoOverflow(page, evidence);
      const name = `annual-filter-modal-evidence-${width}-${theme}`;
      await info.attach(name, { body: await page.screenshot({ path: info.outputPath(`${name}.png`) }), contentType: 'image/png' });
      await page.keyboard.press('Escape');
      await expect(modal).toHaveCount(0);
      await expect(activeNotice(page)).toContainText('研究画面のみ · 3銘柄');
    }
    await page.getByRole('button', { name: 'ダークモードに切り替え', exact: true }).click();
    await expect(page.locator('.leader-shell')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await returnToList(page, width);
    await expect(candidateSymbols(page)).toHaveText(FILTERED_TECH);
    // Direct links to an excluded symbol may legitimately produce no matches;
    // they must not reopen the excluded detail or unfiltered chart universe.
    await page.evaluate(() => { location.hash = '/?annualEps=1&symbol=EPSDOWN'; });
    await expect(candidateSymbols(page)).toHaveCount(0);
    await expect(board(page)).toContainText('該当銘柄がありません');
    await expect(detail(page).getByRole('heading')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('main.research-workbench')).toHaveAttribute('data-mobile-view', 'list');
    verify();
  });
}

// Short-height coverage reuses the exact annual fixture and strict route guard.
// The minimum 300px plot may extend below the inner viewport; lower chart panes
// and evidence stay reachable while the modal header/footer remain fixed.
for (const viewport of [{ width: 390, height: 600 }, { width: 844, height: 390 }]) {
  test(`annual EPS compact smoke preserves controls, focus, history and scroll at ${viewport.width}x${viewport.height}`, async ({ page, context, baseURL }, info) => {
    const verify = await installFixture({ page, context, baseURL }, viewport.width);
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(candidateSymbols(page)).toHaveText(ALL_SYMBOLS);
    const trigger = page.getByRole('button', { name: '候補を絞り込む', exact: true });
    const drawer = await openFilters(page);
    await drawer.getByRole('textbox').focus();
    await page.keyboard.press('Tab');
    await expect(drawer.getByRole('button', { name: 'ミネルヴィニ', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    const method = drawer.getByRole('button', { name: '基本と原則', exact: true });
    await expect(method).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(method).toHaveAttribute('aria-pressed', 'true');
    await annual(drawer).focus();
    await page.keyboard.press('Space');
    await expect(annual(drawer)).toBeChecked();
    await expect(annual(drawer)).toBeFocused();
    await expectNoOverflow(page, drawer);
    const darkDrawerName = `compact-drawer-${viewport.width}x${viewport.height}-dark`;
    await info.attach(darkDrawerName, { body: await page.screenshot({ path: info.outputPath(`${darkDrawerName}.png`) }), contentType: 'image/png' });
    await drawer.getByRole('combobox', { name: '業種', exact: true }).selectOption('Technology');
    const browse = drawer.getByRole('button', { name: '候補を確認する →', exact: true });
    const drawerBox = await rectangle(drawer);
    await page.mouse.move(drawerBox.left + 8, viewport.height / 2);
    await page.mouse.wheel(0, 10000);
    await expect.poll(() => drawer.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await expect(browse).toBeInViewport({ ratio: 1 });
    await browse.focus();
    await page.keyboard.press('Enter');
    await expect(drawer).toHaveCount(0);
    await expect(board(page)).toBeFocused();
    await expect(candidateSymbols(page)).toHaveText(FILTERED_TECH);
    const filteredUrl = page.url();
    await page.goBack();
    await expect(candidateSymbols(page)).toHaveText(ALL_SYMBOLS);
    await expect(activeNotice(page)).toHaveCount(0);
    await page.goForward();
    await expect(page).toHaveURL(filteredUrl);
    await expect(candidateSymbols(page)).toHaveText(FILTERED_TECH);
    const reopened = await openFilters(page);
    await expect(annual(reopened)).toBeChecked();
    await expect(reopened.getByRole('combobox', { name: '業種', exact: true })).toHaveValue('Technology');
    await expect(reopened.getByRole('button', { name: '基本と原則', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(reopened).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Capture the same compact drawer in light mode through its real controls,
    // then return to dark before the existing two-theme chart flow.
    await page.getByRole('button', { name: 'ライトモードに切り替え', exact: true }).click();
    await expect(page.locator('.leader-shell')).toHaveAttribute('data-theme', 'light');
    const lightDrawer = await openFilters(page);
    await expect(annual(lightDrawer)).toBeChecked();
    await expect(lightDrawer.getByRole('button', { name: '基本と原則', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await annual(lightDrawer).focus();
    await expect(annual(lightDrawer)).toBeInViewport({ ratio: 1 });
    await expectNoOverflow(page, lightDrawer);
    const lightDrawerName = `compact-drawer-${viewport.width}x${viewport.height}-light`;
    await info.attach(lightDrawerName, { body: await page.screenshot({ path: info.outputPath(`${lightDrawerName}.png`) }), contentType: 'image/png' });
    const lightDrawerBox = await rectangle(lightDrawer);
    await page.mouse.move(lightDrawerBox.left + 8, viewport.height / 2);
    await page.mouse.wheel(0, 10000);
    await expect.poll(() => lightDrawer.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await expect(lightDrawer.getByRole('button', { name: '候補を確認する →', exact: true })).toBeInViewport({ ratio: 1 });
    await showCandidates(page, lightDrawer);
    await expect(candidateSymbols(page)).toHaveText(FILTERED_TECH);
    await page.getByRole('button', { name: 'ダークモードに切り替え', exact: true }).click();
    await expect(page.locator('.leader-shell')).toHaveAttribute('data-theme', 'dark');

    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await page.getByRole('button', { name: 'ライトモードに切り替え', exact: true }).click();
      await expect(page.locator('.leader-shell')).toHaveAttribute('data-theme', theme);
      await candidate(page, 'EPSPASSA').click();
      await expect(detail(page).getByRole('heading', { name: 'EPSPASSA', exact: true })).toBeVisible();
      if (viewport.width < 700) {
        await expect(detail(page)).toBeFocused();
        await expect(board(page)).toBeHidden();
      }
      const opener = detail(page).getByRole('button', { name: '日次チャートを分析', exact: true });
      await opener.click();
      const modal = page.getByRole('dialog');
      const header = modal.getByTestId('expanded-chart-header');
      const footer = modal.getByTestId('expanded-chart-footer');
      const scroll = modal.getByTestId('expanded-chart-scroll');
      const plot = modal.locator('[data-chart-symbol="EPSPASSA"]');
      const close = modal.getByRole('button', { name: 'チャートを閉じる', exact: true });
      const next = modal.getByRole('button', { name: '次の銘柄', exact: true });
      const previous = modal.getByRole('button', { name: '前の銘柄', exact: true });
      await expect(modal).toHaveAccessibleName('EPSPASSA 1 / 3 銘柄');
      await expect(plot.locator('canvas').first()).toBeVisible();
      await expect(header).toHaveCSS('display', 'grid');
      await expect(modal.locator('.chart-research-meta').getByTestId('mobile-chart-interaction')).toBeVisible();
      await expect(modal.getByTestId('mobile-chart-readiness')).toContainText('購入条件');
      await expectNoOverflow(page, modal);
      await expectNoOverflow(page, scroll);
      const modalBox = await rectangle(modal);
      expect(modalBox.left).toBeGreaterThanOrEqual(-.5);
      expect(modalBox.top).toBeGreaterThanOrEqual(-.5);
      expect(modalBox.right).toBeLessThanOrEqual(viewport.width + .5);
      expect(modalBox.bottom).toBeLessThanOrEqual(viewport.height + .5);
      const headerBox = await rectangle(header), footerBox = await rectangle(footer);
      expect(overlaps(headerBox, footerBox)).toBe(false);
      for (const control of [close, previous, next]) await expect(control).toBeInViewport({ ratio: 1 });
      expect(overlaps(await rectangle(previous), await rectangle(next))).toBe(false);
      await expect.poll(() => plot.evaluate(node => {
        const scroll = node.closest('[data-testid="expanded-chart-scroll"]');
        const offset = node.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
        const fitted = Math.min(420, Math.max(300, Math.floor(scroll.clientHeight - Math.max(0, offset))));
        return node.clientHeight === fitted;
      })).toBe(true);
      const plotHeight = await plot.evaluate(node => node.clientHeight);
      expect(plotHeight).toBeGreaterThanOrEqual(300);
      expect(plotHeight).toBeLessThanOrEqual(420);
      expect(await scroll.evaluate(node => node.scrollHeight > node.clientHeight && node.clientHeight > 0)).toBe(true);

      // Space on a real control toggles pan mode without also changing symbol.
      await modal.getByRole('button', { name: 'チャート操作（拡大・移動）', exact: true }).focus();
      await page.keyboard.press('Space');
      const pan = modal.getByRole('button', { name: '銘柄スワイプに戻る', exact: true });
      await expect(pan).toHaveAttribute('aria-pressed', 'true');
      await expect(pan).toBeFocused();
      await expect(modal).toHaveAccessibleName('EPSPASSA 1 / 3 銘柄');
      await page.keyboard.press('Enter');
      await expect(modal.getByRole('button', { name: 'チャート操作（拡大・移動）', exact: true })).toHaveAttribute('aria-pressed', 'false');

      // Exercise the MUI focus trap in both directions with real navigation.
      await close.focus();
      await page.keyboard.press('Shift+Tab');
      await expect(next).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(modal).toHaveAccessibleName('EPSPASSB 2 / 3 銘柄');
      await page.keyboard.press('Shift+Tab');
      await expect(previous).toBeFocused();
      await page.keyboard.press('Space');
      await expect(modal).toHaveAccessibleName('EPSPASSA 1 / 3 銘柄');
      await page.keyboard.press('Tab');
      await expect(next).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await expect(plot.locator('canvas').first()).toBeVisible();

      // Scroll with the wheel, never by assigning scrollTop or resizing away
      // the short-height boundary. Disabled chart interaction leaves it free.
      const scrollBox = await rectangle(scroll);
      await page.mouse.move(scrollBox.left + scrollBox.width / 2, scrollBox.top + scrollBox.height / 2);
      await page.mouse.wheel(0, -10000);
      await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBe(0);
      const modalTopName = `compact-modal-top-${viewport.width}x${viewport.height}-${theme}`;
      await info.attach(modalTopName, { body: await page.screenshot({ path: info.outputPath(`${modalTopName}.png`) }), contentType: 'image/png' });
      const lowerPlotDelta = await plot.evaluate(node => {
        const viewport = node.closest('[data-testid="expanded-chart-scroll"]');
        return Math.max(1, node.getBoundingClientRect().bottom - viewport.getBoundingClientRect().bottom + 8);
      });
      await page.mouse.wheel(0, lowerPlotDelta);
      await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      await expect.poll(() => plot.evaluate(node => {
        const bounds = node.getBoundingClientRect();
        const clip = node.closest('[data-testid="expanded-chart-scroll"]').getBoundingClientRect();
        return bounds.bottom <= clip.bottom + .5 && bounds.bottom > clip.top;
      })).toBe(true);
      expect(await plot.evaluate(node => node.clientHeight)).toBe(plotHeight);
      const modalLowerName = `compact-modal-lower-plot-${viewport.width}x${viewport.height}-${theme}`;
      await info.attach(modalLowerName, { body: await page.screenshot({ path: info.outputPath(`${modalLowerName}.png`) }), contentType: 'image/png' });
      await page.mouse.wheel(0, 10000);
      const disclosure = modal.locator('summary').filter({ hasText: '選定条件の詳細' });
      await expect(disclosure).toBeInViewport({ ratio: 1 });
      await disclosure.click();
      const evidence = modal.getByRole('region', { name: '年次EPSの追加条件', exact: true });
      await expect(evidence).toHaveAttribute('data-condition-state', 'pass');
      await expect(evidence).toContainText('追加絞り込み有効');
      await expect(evidence).toContainText('25.99%');
      await evidence.getByRole('heading').scrollIntoViewIfNeeded();
      await expect(evidence.getByRole('heading')).toBeInViewport({ ratio: 1 });
      await expectNoOverflow(page, evidence);
      expect(await plot.evaluate(node => node.clientHeight)).toBe(plotHeight);
      expect(await rectangle(header)).toEqual(headerBox);
      expect(await rectangle(footer)).toEqual(footerBox);
      for (const control of [close, previous, next]) await expect(control).toBeInViewport({ ratio: 1 });
      const modalEvidenceName = `compact-modal-evidence-${viewport.width}x${viewport.height}-${theme}`;
      await info.attach(modalEvidenceName, { body: await page.screenshot({ path: info.outputPath(`${modalEvidenceName}.png`) }), contentType: 'image/png' });
      if (theme === 'dark') await page.keyboard.press('Escape');
      else await close.click();
      await expect(modal).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(activeNotice(page)).toContainText('研究画面のみ · 3銘柄');
      await returnToList(page, viewport.width);
      await expect(candidateSymbols(page)).toHaveText(FILTERED_TECH);
    }
    verify();
  });
}

// This dedicated production-font diagnostic opts into bounded public font GETs.
// Every existing test/fixture above remains byte-for-byte unchanged and never
// fetches fonts. This is not Design, financial,
// provider or performance certification, and is not an additional release gate.
import { writeFile as writeFontHealthReport } from 'node:fs/promises';

const FONT_HEALTH_FAMILIES = ['Inter', 'Zen Kaku Gothic New', 'Geist Mono'];
const FONT_HEALTH_FILE = /^\/s\/(?:inter|zenkakugothicnew|geistmono)\/v\d+\/[A-Za-z0-9_-]+\.woff2$/;

function fontHealthRequestKind(request) {
  const url = new URL(request.url());
  if (request.method() !== 'GET' || url.username || url.password || url.hash) return null;
  if (request.resourceType() === 'stylesheet' && FONT_STYLESHEETS.has(request.url())) return 'stylesheet';
  if (request.resourceType() === 'font' && url.origin === 'https://fonts.gstatic.com' && !url.search && FONT_HEALTH_FILE.test(url.pathname)) return 'font';
  return null;
}

async function installFontHealthRoute(context, playwright, page, health) {
  // An isolated empty cookie jar and explicit public headers avoid credentials,
  // cookies, Origin, and private Referer headers on these public GETs. Redirects
  // are not followed, so a permitted URL cannot redirect around the allowlist.
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const inFlight = new Set();
  const deadline = Date.now() + 60_000;
  let bytes = 0;
  await context.route('**/*', async route => {
    const request = route.request(), kind = fontHealthRequestKind(request);
    // The original synthetic-data/provider/mutation guard remains authoritative
    // for every request except these exact stylesheet and family-file GETs.
    if (!kind) return route.fallback();
    const asset = { url: request.url(), kind, method: 'GET', status: 'PENDING' };
    health.assets.push(asset);
    let transport;
    try {
      if (health.assets.length > 256 || Date.now() > deadline || bytes > 25 * 1024 * 1024) throw new Error('Bounded font diagnostic request/time/byte budget exhausted');
      // A new context per asset cannot reuse a Set-Cookie response from another
      // concurrent asset. No browser/request fixture credentials are inherited.
      transport = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } });
      inFlight.add(transport);
      const response = await transport.get(request.url(), {
        headers: { accept: kind === 'stylesheet' ? 'text/css' : 'font/woff2', 'user-agent': userAgent },
        maxRedirects: 0, timeout: 8000, failOnStatusCode: false,
      });
      asset.httpStatus = response.status();
      asset.failureClass = 'transport';
      if (response.status() !== 200 || response.url() !== request.url()) throw new Error(`Font asset HTTP ${response.status()}; redirects are forbidden`);
      const body = await response.body();
      bytes += body.length;
      asset.bytes = body.length;
      asset.contentType = response.headers()['content-type'] || '';
      asset.failureClass = 'validation';
      if (body.length > (kind === 'stylesheet' ? 1024 * 1024 : 2 * 1024 * 1024) || bytes > 25 * 1024 * 1024) throw new Error('Font asset exceeds diagnostic byte budget');
      if (kind === 'stylesheet' && !/^text\/css(?:;|$)/i.test(asset.contentType)) throw new Error('Font stylesheet has unexpected content type');
      if (kind === 'font' && body.subarray(0, 4).toString('ascii') !== 'wOF2') throw new Error('Font response is not a WOFF2 asset');
      // Copy no Set-Cookie, refresh, redirect, or authentication response header.
      await route.fulfill({ status: 200, body, contentType: kind === 'font' ? 'font/woff2' : 'text/css', headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } });
      asset.status = 'RETRIEVED';
      delete asset.failureClass;
      await response.dispose();
    } catch (error) {
      asset.status = asset.failureClass === 'validation' ? 'INVALID' : 'BLOCKED';
      asset.reason = String(error.message || error);
      // Missing external assets are a recorded limitation, not a fake font pass.
      // Geometry and the original guard are still checked before test.skip().
      await route.abort('blockedbyclient');
    } finally {
      await transport?.dispose();
      inFlight.delete(transport);
    }
  });
  return async () => { await Promise.all([...inFlight].map(transport => transport.dispose())); };
}

async function readFontHealthSample(page, cdp, locator, family, name) {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeInViewport({ ratio: 1 });
  const sample = await locator.evaluate(async (node, { family, name }) => {
    node.setAttribute('data-font-health-sample', name);
    const style = getComputedStyle(node), text = node.textContent.trim();
    const serialize = face => ({ family: face.family.replace(/["']/g, ''), status: face.status, weight: face.weight, style: face.style, unicodeRange: face.unicodeRange });
    const load = document.fonts.load(`${style.fontWeight} ${style.fontSize} "${family}"`, text)
      .then(faces => ({ faces: faces.map(serialize) }), error => ({ faces: [], error: String(error) }));
    let timer;
    const loaded = await Promise.race([load, new Promise(resolve => { timer = setTimeout(() => resolve({ faces: [], error: 'FontFace load exceeded 8 seconds' }), 8000); })]);
    clearTimeout(timer);
    const covered = (code, range) => range.split(',').some(part => {
      const match = part.trim().match(/^U\+([\dA-F?]+)(?:-([\dA-F]+))?$/i);
      if (!match) return false;
      const start = parseInt(match[1].replace(/\?/g, '0'), 16);
      const end = parseInt(match[2] || match[1].replace(/\?/g, 'F'), 16);
      return code >= start && code <= end;
    });
    const codepoints = [...new Set([...text].filter(char => !/\s/.test(char)).map(char => char.codePointAt(0)))];
    return {
      name, family, text, computedFamily: style.fontFamily, weight: style.fontWeight, size: style.fontSize,
      ...loaded,
      uncovered: codepoints.filter(code => !loaded.faces.some(face => face.family === family && face.status === 'loaded' && covered(code, face.unicodeRange))).map(code => `U+${code.toString(16).toUpperCase()}`),
    };
  }, { family, name });
  // Wait for paint after successful FontFace loads; ready alone is not evidence.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const { root } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-font-health-sample="${name}"]` });
  expect(nodeId, 'CDP must locate the actual rendered UI node').toBeGreaterThan(0);
  sample.platformFonts = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
  const used = sample.platformFonts.filter(font => font.glyphCount > 0);
  sample.actualCustomFamily = used.length > 0 && used.every(font => font.isCustomFont && font.familyName.replace(/[\s-]/g, '') === family.replace(/[\s-]/g, ''));
  sample.renderedGlyphCount = used.reduce((count, font) => count + font.glyphCount, 0);
  return sample;
}

test('production-font asset and rendered-glyph health diagnostic', { tag: '@font-health' }, async ({ page, context, baseURL, playwright, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'BLOCKED: actual rendered font inspection requires Chromium CDP');
  test.setTimeout(180_000);
  const health = {
    diagnostic: 'production-font-health-v1', scope: 'Synthetic fixture only; no financial-provider, Design, or performance certification',
    fontStatus: 'PENDING', geometry: 'PENDING', assets: [], samples: [], blocked: [], loadIssues: [], decodingErrors: [], renderingFailures: [],
    importedOnlyFamily: { family: 'Inter', note: 'Imported globally, but not the static shell applied family; asset/FontFace health only' },
  };
  page.on('console', message => {
    if (/Failed to decode downloaded font|OTS parsing error/i.test(message.text())) health.decodingErrors.push(message.text());
  });
  const verify = await installFixture({ page, context, baseURL }, 320);
  const closeTransport = await installFontHealthRoute(context, playwright, page, health);
  let cdp, failure;
  try {
    cdp = await context.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    await page.goto('/');
    await expect(candidateSymbols(page)).toHaveText(ALL_SYMBOLS);
    const drawer = await openFilters(page);
    await annual(drawer).check();
    await showCandidates(page, drawer);
    // These are unmodified production UI nodes: kanji/kana method labels and
    // numeric pivot distances. No forced font styling or fake sample replaces UI.
    for (const [index, name] of [[0, 'japanese-kana'], [1, 'japanese-kanji']]) {
      health.samples.push(await readFontHealthSample(page, cdp, board(page).getByRole('group', { name: '投資手法', exact: true }).getByRole('button').nth(index), 'Zen Kaku Gothic New', name));
    }
    const number = await readFontHealthSample(page, cdp, board(page).locator('.candidate-distance').first(), 'Geist Mono', 'numeric-distance');
    expect(number.text, 'Numeric production sample must contain digits').toMatch(/\d/);
    health.samples.push(number);
    health.importedOnlyFamily.result = await page.evaluate(async () => {
      let timer;
      const loaded = document.fonts.load('400 13px "Inter"', '0123456789')
        .then(faces => ({ faces: faces.map(face => ({ family: face.family.replace(/["']/g, ''), status: face.status, unicodeRange: face.unicodeRange })) }), error => ({ faces: [], error: String(error) }));
      const result = await Promise.race([loaded, new Promise(resolve => { timer = setTimeout(() => resolve({ faces: [], error: 'Inter load exceeded 8 seconds' }), 8000); })]);
      clearTimeout(timer);
      const coversDigit = code => result.faces.some(face => face.family === 'Inter' && face.status === 'loaded' && face.unicodeRange.split(',').some(part => {
        const match = part.trim().match(/^U\+([\dA-F?]+)(?:-([\dA-F]+))?$/i);
        return match && code >= parseInt(match[1].replace(/\?/g, '0'), 16) && code <= parseInt(match[2] || match[1].replace(/\?/g, 'F'), 16);
      }));
      result.uncoveredDigits = [...'0123456789'].filter(char => !coversDigit(char.codePointAt(0)));
      return result;
    });
    health.fontFaces = await page.evaluate(() => [...document.fonts].map(face => ({ family: face.family.replace(/["']/g, ''), status: face.status, weight: face.weight, unicodeRange: face.unicodeRange })));
    const unexpectedFamilies = health.fontFaces.filter(face => !FONT_HEALTH_FAMILIES.includes(face.family));
    if (unexpectedFamilies.length) health.renderingFailures.push({ reason: 'Unexpected returned FontFace family', faces: unexpectedFamilies });
    for (const sample of health.samples) {
      if (sample.error || !sample.faces.length || sample.uncovered.length) health.loadIssues.push({ sample: sample.name, family: sample.family, kind: sample.error ? 'load-error' : 'missing-coverage', reason: sample.error || 'No loaded FontFace covers every sample codepoint', uncovered: sample.uncovered });
      else if (!sample.actualCustomFamily || sample.renderedGlyphCount < [...sample.text].filter(char => !/\s/.test(char)).length) health.renderingFailures.push({ sample: sample.name, reason: 'Loaded family did not render all actual UI glyphs', platformFonts: sample.platformFonts });
    }
    const inter = health.importedOnlyFamily.result;
    if (inter.error || !inter.faces.some(face => face.family === 'Inter' && face.status === 'loaded') || inter.uncoveredDigits.length) health.loadIssues.push({ family: 'Inter', kind: inter.error ? 'load-error' : 'missing-coverage', reason: inter.error || 'Imported Inter FontFace did not load or cover all digits', uncoveredDigits: inter.uncoveredDigits });
    // Reuse the existing assertions, unsoftened, on production font metrics.
    // Run even if font transport failed; never skip past detected UI regressions.
    health.geometry = 'RUNNING';
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await page.getByRole('button', { name: 'ライトモードに切り替え', exact: true }).click();
      await expect(page.locator('.leader-shell')).toHaveAttribute('data-theme', theme);
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
        await expectMethodLabelsFit(board(page), width, 380);
        await scrollPageToTop(page, width);
        await expectHeroControlsFit(page);
        const name = `production-font-health-${width}-${theme}`;
        await info.attach(name, { body: await page.screenshot({ path: info.outputPath(`${name}.png`) }), contentType: 'image/png' });
        const controls = await openFilters(page);
        await expectMethodLabelsFit(controls, width);
        await expectNoOverflow(page, controls);
        await info.attach(`${name}-drawer`, { body: await page.screenshot({ path: info.outputPath(`${name}-drawer.png`) }), contentType: 'image/png' });
        await showCandidates(page, controls);
      }
    }
    health.geometry = 'PASS';
  } catch (error) {
    failure = error;
    health.geometry = health.geometry === 'RUNNING' ? 'FAIL' : 'INCOMPLETE';
    health.failure = String(error.stack || error);
    await info.attach('production-font-health-failure', { body: await page.screenshot({ path: info.outputPath('production-font-health-failure.png') }), contentType: 'image/png' }).catch(() => {});
  } finally {
    await cdp?.detach();
    await closeTransport();
    for (const asset of health.assets.filter(asset => asset.status !== 'RETRIEVED')) (asset.status === 'INVALID' ? health.renderingFailures : health.blocked).push({ asset: asset.url, reason: asset.reason || asset.status });
    for (const url of FONT_STYLESHEETS) if (!health.assets.some(asset => asset.url === url)) health.renderingFailures.push({ asset: url, reason: 'Expected production stylesheet import was not requested' });
    // If retrieval succeeded, invalid CSS/FontFaces/coverage are diagnostic
    // failures, not an unavailable-host excuse. Only transport failure is BLOCKED.
    for (const issue of health.loadIssues) {
      const css = [...FONT_STYLESHEETS][issue.family === 'Inter' ? 0 : 1];
      const prefix = `/s/${issue.family === 'Inter' ? 'inter' : issue.family === 'Geist Mono' ? 'geistmono' : 'zenkakugothicnew'}/`;
      const unavailable = health.assets.some(asset => asset.status === 'BLOCKED' && (asset.url === css || (issue.kind === 'load-error' && new URL(asset.url).pathname.startsWith(prefix))));
      (unavailable ? health.blocked : health.renderingFailures).push(issue);
    }
    for (const message of health.decodingErrors) health.renderingFailures.push({ reason: 'Browser rejected downloaded font bytes', message });
    health.fontStatus = health.renderingFailures.length ? 'FAIL' : health.blocked.length ? 'BLOCKED' : 'VERIFIED';
    health.overall = failure || health.renderingFailures.length ? 'FAIL' : health.blocked.length ? 'BLOCKED' : 'VERIFIED';
    try { verify(); health.networkGuard = 'PASS'; } catch (error) { health.networkGuard = 'FAIL'; health.overall = 'FAIL'; failure ||= error; }
    info.annotations.push({ type: 'production-font-health', description: `${health.overall}; geometry ${health.geometry}; external assets ${health.fontStatus}` });
    const reportPath = info.outputPath('production-font-health.json');
    await writeFontHealthReport(reportPath, JSON.stringify(health, null, 2) + '\n');
    await info.attach('production-font-health.json', { path: reportPath, contentType: 'application/json' });
  }
  if (failure) throw failure;
  expect(health.renderingFailures, 'Available custom fonts must actually render the UI glyphs').toEqual([]);
  test.skip(health.fontStatus === 'BLOCKED', 'BLOCKED: actual production fonts could not be fully verified; see production-font-health.json. Geometry and request guard were still checked.');
});
