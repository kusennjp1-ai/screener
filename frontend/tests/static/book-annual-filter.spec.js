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

async function installFixture({ page, context, baseURL }, width) {
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
      if (path === 'research.json') return route.fulfill({ json: { as_of_date: DATE, rows: ROWS } });
      const row = ROWS.find(item => item.chart_path === path);
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

async function expectMethodLabelsFit(drawer, width) {
  const methods = drawer.getByRole('group', { name: '投資手法', exact: true });
  const buttons = methods.getByRole('button');
  await expect(buttons).toHaveText(['ミネルヴィニ', '基本と原則', 'オニール', 'IBD型']);
  await expect(methods).toHaveCSS('display', width <= 420 ? 'grid' : 'flex');
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
  if (width <= 420) {
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

async function captureTopArea(page, info, width, theme) {
  // Scroll over the fixed header, outside canvases that consume wheel gestures.
  await page.mouse.move(width / 2, 20);
  await page.mouse.wheel(0, -10000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByTestId('home-hero')).toBeVisible();
  await expect(activeNotice(page)).toContainText('研究画面のみ · 2銘柄');
  const height = await activeNotice(page).evaluate(node => Math.ceil(node.getBoundingClientRect().bottom + window.scrollY));
  expect(height).toBeGreaterThan(0);
  const name = `annual-filter-hero-status-${width}-${theme}`;
  await info.attach(name, { body: await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, clip: { x: 0, y: 0, width, height } }), contentType: 'image/png' });
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

  test(`annual EPS excludes selected detail and open charts; remaining chart navigation never escapes the subset at ${width}px`, async ({ page, context, baseURL }) => {
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
    await detail(page).getByRole('button', { name: '日次チャートを分析', exact: true }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toHaveAccessibleName('EPSPASSA 1 / 3 銘柄');
    await expect(modal.locator('canvas').first()).toBeVisible();
    for (const [symbol, position] of [['EPSPASSB', 2], ['EPSBASEFAIL', 3], ['EPSPASSA', 1]]) {
      await modal.getByRole('button', { name: '次の銘柄', exact: true }).click();
      await expect(modal).toHaveAccessibleName(`${symbol} ${position} / 3 銘柄`);
      await expect(modal.locator('canvas').first()).toBeVisible();
    }
    await modal.getByRole('button', { name: '前の銘柄', exact: true }).click();
    await expect(modal).toHaveAccessibleName('EPSBASEFAIL 3 / 3 銘柄');
    await modal.locator('summary').filter({ hasText: '選定条件の詳細' }).click();
    await expect(modal.getByRole('region', { name: '年次EPSの追加条件', exact: true })).toHaveAttribute('data-condition-state', 'pass');
    await expect(modal.getByRole('region', { name: '年次EPSの追加条件', exact: true })).toContainText('追加絞り込み有効');
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(activeNotice(page)).toContainText('研究画面のみ · 3銘柄');
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
