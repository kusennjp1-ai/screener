// CI-only production-browser acceptance measurements. Never turn a missing
// observation into a pass. Artifacts are written before any gate fails.
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { verifyChartCases, CHART_DESIGN_SYMBOLS } from './chart-design-cases.mjs';
import { recordProfileDiagnostic } from './profile-diagnostic.mjs';
import { retainProfileSources } from './retain-profile-sources.mjs';
import { verifyFinancialCases, financialDesignScreens } from './financial-design-cases.mjs';
import { financialViewportGeometry, checkFinancialViewportGeometry } from './financial-viewport-geometry.mjs';
import { RADAR_HARNESS_VERSION, radarMeasurementFailures } from './radar-benchmark-context.mjs';

if (!process.env.CI) throw Error('Run this browser harness in GitHub Actions, not on the desktop host.');
const output = resolve(process.env.DESIGN_REVIEW_OUTPUT || 'test-results/design-review');
await mkdir(output, { recursive: true });
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const viewportSizes = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const currentRoot = resolve(process.env.CURRENT_BUILD || 'dist');
const baselineRoot = process.env.BASELINE_BUILD && resolve(process.env.BASELINE_BUILD);
const radarRoot = process.env.RADAR_BUILD && resolve(process.env.RADAR_BUILD);
const inputBasis = process.env.DESIGN_INPUT_BASIS || 'same_verified_input';
if (!['same_verified_input', 'same_prices_repaired_financials'].includes(inputBasis)) throw Error('Unknown Design input comparison basis');
const comparisonMethod = inputBasis === 'same_verified_input'
  ? 'same-data baseline/current'
  : 'published-financial baseline versus certified-financial candidate; identical verified prices, different financial inputs; not a UI-only speed comparison';
const report = { commit, measured_at: new Date().toISOString(), source_run: process.env.SOURCE_RUN || null, clock: 'actual browser Date.now; no historical date override', data: null,
  input_basis: inputBasis,
  method: `Production Chromium. CDP CPU 4x, ${comparisonMethod}, HTTP responses cached in memory after warm-up. No human satisfaction inference.`, screens: [], performance: [], failures: [] };
const check = (condition, detail) => { if (!condition) report.failures.push(detail); };
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
async function serve(root) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const relative = pathname.replace(/^\/screener\//, '').replace(/^\/+/, '') || 'index.html';
      let file = resolve(root, relative);
      if (file !== root && !file.startsWith(root + sep)) throw Error('Invalid path');
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/screener/`, close: () => new Promise(resolve => server.close(resolve)) };
}
const current = await serve(currentRoot);
const baseline = baselineRoot && await serve(baselineRoot);
const radar = radarRoot && await serve(radarRoot);
const browser = await chromium.launch();
const manifest = JSON.parse(await readFile(resolve(currentRoot, 'static-data/manifest.json'), 'utf8'));
report.data = { as_of_date: (manifest.markets?.US || manifest).as_of_date, generated_at: manifest.generated_at, research_generation: manifest.research_generation };
if (baselineRoot) {
  const previousManifest = JSON.parse(await readFile(resolve(baselineRoot, 'static-data/manifest.json'), 'utf8'));
  const currentEntry = manifest.markets?.US || manifest, previousEntry = previousManifest.markets?.US || previousManifest;
  const ids = async (root, entry, label) => {
    const raw = await readFile(resolve(root, 'static-data', entry.assets.research.path));
    (report.transport ||= []).push({ label, as_of_date: entry.as_of_date, raw_bytes: raw.length, gzip_bytes: gzipSync(raw).length });
    return decodeResearchIndex(JSON.parse(raw.toString('utf8'))).rows.map(row => row.symbol).sort().join(',');
  };
  check(currentEntry.as_of_date === previousEntry.as_of_date && await ids(currentRoot, currentEntry, 'current') === await ids(baselineRoot, previousEntry, 'baseline'), 'Baseline/current snapshots have different dates or symbols; performance comparison is invalid');
}
const readySelector = '.candidate-row, .research-list tbody tr';
const visible = locator => locator.first().waitFor({ state: 'visible', timeout: 60000 });

// Measurements describe effective hit boxes (including associated labels),
// not a tiny decorative checkbox inside a correctly sized clickable label.
function objectiveMetrics() {
  const allowedFonts = [11, 12, 13, 14, 16, 20, 26, 34, 42];
  const describe = element => ({ tag: element.tagName.toLowerCase(), text: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 100), class: typeof element.className === 'string' ? element.className.slice(0, 100) : '' });
  const shown = element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0' && !element.closest('[hidden],[aria-hidden="true"]');
  };
  const chartInternal = element => element.closest('.tv-lightweight-charts, [data-chart-internal], canvas');
  const elements = [...document.querySelectorAll('body *')].filter(shown);
  const smallTargets = [...document.querySelectorAll('button,a,[role="button"],summary,select,input')].filter(element => shown(element) && !element.closest('p') && !element.disabled).flatMap(element => {
    // Checkbox/radio labels enlarge their target. A floating text-field label
    // is only a caption: measure the editable field itself, not that caption.
    const target = element.matches('input[type=checkbox],input[type=radio]') ? element.labels?.[0] || element.closest('label') || element : element;
    const box = target.getBoundingClientRect(), minimum = innerWidth < 768 ? 44 : 24;
    return box.width + .1 < minimum || box.height + .1 < minimum ? [{ ...describe(element), width: box.width, height: box.height }] : [];
  });
  const fontIssues = elements.filter(element => !chartInternal(element) && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())).flatMap(element => {
    const size = Number.parseFloat(getComputedStyle(element).fontSize);
    return !allowedFonts.some(value => Math.abs(value - size) < .1) ? [{ ...describe(element), size }] : [];
  });
  const asciiNegativeValues = elements.flatMap(element => {
    const ownText = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(' ');
    // Standalone signed numeric values only. Dates, URLs, ticker symbols and
    // ordinary hyphenated text have no qualifying numeric-token boundary.
    return /(?:^|[\s(（:：$])-(?:\$)?\d/.test(ownText) ? [{ ...describe(element), value: ownText.trim().slice(0, 140) }] : [];
  });
  const radiusIssues = elements.filter(element => !chartInternal(element)).flatMap(element => {
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    const corners = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius];
    const values = corners.map(Number.parseFloat);
    const pill = corners.every(value => value.includes('%') && Number.parseFloat(value) >= 50) || values.every(value => value >= Math.min(box.width, box.height) / 2 - .1);
    return !pill && values.some(value => ![0, 4, 8, 12, 16].some(allowed => Math.abs(value - allowed) < .1)) ? [{ ...describe(element), corners }] : [];
  });
  const rect = selector => { const element = document.querySelector(selector); if (!element || !shown(element)) return null; const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, height: box.height, width: box.width }; };
  const header = rect('.leader-header') || rect('header.MuiAppBar-root'), nav = rect('.leader-mobile-nav');
  const contentTop = header?.bottom || 0, contentBottom = nav?.top ?? innerHeight;
  const completelyVisible = element => {
    const box = element.getBoundingClientRect();
    if (box.top < contentTop - .1 || box.bottom > contentBottom + .1) return false;
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (/(auto|scroll|hidden)/.test(getComputedStyle(parent).overflowY)) {
        const clip = parent.getBoundingClientRect();
        if (box.top < clip.top - .1 || box.bottom > clip.bottom + .1) return false;
      }
    }
    return true;
  };
  const visibleFraction = element => {
    const box = element.getBoundingClientRect();
    let top = Math.max(box.top, contentTop), bottom = Math.min(box.bottom, contentBottom);
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (/(auto|scroll|hidden)/.test(getComputedStyle(parent).overflowY)) {
        const clip = parent.getBoundingClientRect(); top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom);
      }
    }
    return box.height ? Math.max(0, bottom - top) / box.height : 0;
  };
  const animations = document.getAnimations().filter(animation => animation.playState === 'running' && (!animation.effect?.getTiming().iterations || animation.effect.getTiming().iterations === Infinity || animation.effect.getTiming().duration > 1));
  const heroActionTargets = [...document.querySelectorAll('.hero-actions button')].map(element => {
    const box=element.getBoundingClientRect(), style=getComputedStyle(element);
    return {...describe(element), rect:{top:box.top,bottom:box.bottom,left:box.left,right:box.right,width:box.width,height:box.height},
      minHeight:style.minHeight,margin:style.margin,lineHeight:style.lineHeight,display:style.display,position:style.position};
  });
  return { smallTargets, fontIssues, radiusIssues, asciiNegativeValues, heroActionTargets, scrollY, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    pageHeight: document.documentElement.scrollHeight, viewport: { width: innerWidth, height: innerHeight },
    headerHeight: header?.height || 0, bottomNavHeight: nav?.height || 0, chromeHeight: (header?.height || 0) + (nav?.height || 0),
    hero: rect('[data-testid="home-hero"], .research-hero'), firstRow: rect('.candidate-row'), chart: rect('.research-detail .research-chart canvas') || rect('.research-detail .research-chart [data-chart-plot]'), chartCard: rect('.research-detail .research-chart'), detail: rect('.research-detail'),
    visibleCandidates: [...document.querySelectorAll('.candidate-row')].filter(shown).filter(completelyVisible).length,
    firstScanCard: rect('[data-testid="mobile-scan-row"]'),
    visibleScanCards: [...document.querySelectorAll('[data-testid="mobile-scan-row"]')].filter(shown).filter(completelyVisible).length,
    visibleCompareCards: [...document.querySelectorAll('.comparison-grid article, .comparison-card')].filter(shown).filter(completelyVisible).length,
    visibleCompareCardFraction: [...document.querySelectorAll('.comparison-grid article, .comparison-card')].filter(shown).reduce((sum, card) => sum + visibleFraction(card), 0),
    comparisonGrid: rect('.comparison-grid'),
    runningAnimations: animations.length };
}

async function capture(page, viewport, theme, screen, { target, scope = 'viewport', viewportTargets } = {}) {
  if (await page.locator('.leader-shell').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'light' ? 'ライトモードに切り替え' : 'ダークモードに切り替え', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const metrics = await page.evaluate(objectiveMetrics);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const screenshot = `${screen}-${viewport.width}x${viewport.height}-${theme}.png`;
  const key = `${screen}/${viewport.width}/${theme}`;
  const geometry = viewportTargets ? await page.evaluate(financialViewportGeometry, viewportTargets) : null;
  if (geometry) checkFinancialViewportGeometry(geometry, check, key, viewport);
  if (target) await page.locator(target).screenshot({ path: resolve(output, screenshot) });
  else await page.screenshot({ path: resolve(output, screenshot) });
  const diagnosticChecks = (checks=[]) => checks.map(({id,message,data,relatedNodes})=>({id,message,data,relatedNodes:(relatedNodes||[]).map(node=>({target:node.target}))}));
  report.screens.push({ key, screenshot, ...(target || viewportTargets ? { screenshot_scope: scope, screenshot_target: target || null, metrics_scope: 'original-viewport', ...(geometry ? { viewport_geometry: geometry } : {}) } : {}), metrics, axe: axe.violations.map(({ id, impact, description, nodes }) => ({ id, impact, description, nodes: nodes.map(node => ({ target: node.target, failureSummary: node.failureSummary, any:diagnosticChecks(node.any), all:diagnosticChecks(node.all), none:diagnosticChecks(node.none) })) })) });
  check(axe.violations.length === 0, `${key}: axe ${axe.violations.length} rule violations`);
  check(metrics.smallTargets.length === 0, `${key}: ${metrics.smallTargets.length} undersized hit targets`);
  check(metrics.fontIssues.length === 0, `${key}: ${metrics.fontIssues.length} font-step violations`);
  check(metrics.radiusIssues.length === 0, `${key}: ${metrics.radiusIssues.length} radius-step violations`);
  check(metrics.asciiNegativeValues.length === 0, `${key}: ${metrics.asciiNegativeValues.length} financial values use ASCII minus`);
  check(!metrics.horizontalOverflow, `${key}: horizontal page overflow`);
  if (viewport.width === 390) check(metrics.chromeHeight <= 110, `${key}: fixed chrome ${metrics.chromeHeight}px > 110px`);
  if (['home', 'near-pass'].includes(screen) && viewport.width === 1440) {
    check(metrics.hero && metrics.hero.height <= 320, `${key}: hero height ${metrics.hero?.height} > 320px or missing`);
    check(metrics.chart && metrics.chart.top <= 540, `${key}: chart top ${metrics.chart?.top} > 540px or missing`);
  }
  if (screen === 'compact') {
    check(metrics.firstRow && metrics.firstRow.top <= 260, `${key}: first row top ${metrics.firstRow?.top} > 260px or missing`);
    check(metrics.chart && metrics.chart.top <= 420, `${key}: chart top ${metrics.chart?.top} > 420px or missing`);
    check(metrics.visibleCandidates >= 12, `${key}: ${metrics.visibleCandidates} visible rows < 12`);
  }
  if (['home', 'near-pass'].includes(screen) && viewport.width === 390) check(metrics.visibleCandidates >= 3, `${key}: ${metrics.visibleCandidates} visible rows < 3`);
  if (screen === 'detail' && viewport.width === 390) check(metrics.chartCard && metrics.detail && metrics.chartCard.top - metrics.detail.top <= 160, `${key}: detail-to-chart ${metrics.chartCard && metrics.detail ? metrics.chartCard.top - metrics.detail.top : 'missing'}px > 160px`);
  if (['comparison', 'comparison-near-pass'].includes(screen) && viewport.width === 1440) {
    check(metrics.pageHeight <= 900, `${key}: page height ${metrics.pageHeight}px > 900px`);
    check(metrics.visibleCompareCards >= 6, `${key}: ${metrics.visibleCompareCards} visible comparison cards < 6`);
    check(metrics.comparisonGrid?.height <= 700, `${key}: comparison grid height ${metrics.comparisonGrid?.height}px > 700px or missing`);
  }
  if (['comparison', 'comparison-near-pass'].includes(screen) && viewport.width === 390) check(metrics.visibleCompareCardFraction >= 1.5, `${key}: ${metrics.visibleCompareCardFraction.toFixed(3)} visible cards < 1.5`);
  if (screen === 'market') check(metrics.pageHeight <= (viewport.width === 390 ? 1600 : 1000), `${key}: market page height ${metrics.pageHeight}px exceeds budget`);
  if (screen === 'scan') {
    if (viewport.width === 390) check(metrics.pageHeight <= 3000, `${key}: scan page height ${metrics.pageHeight}px > 3000px`);
    // Body cells do not duplicate header data-column attributes. Resolve their
    // actual column indices; RS uses bars whereas price uses an area path.
    const sparklineColumns = await page.locator('th[data-column="rs_trend"], th[data-column="price_change_1d"]').evaluateAll(headers => headers.map(header => ({
      id: header.dataset.column,
      geometry: [...header.closest('table').querySelectorAll('tbody tr')].flatMap(row => [...(row.cells[header.cellIndex]?.querySelectorAll('svg path,svg rect,svg polyline') || [])]).filter(node => {
        const box = node.getBBox(); return box.width > 0 && box.height > 0;
      }).length,
    })));
    for (const column of sparklineColumns) check(column.geometry > 0, `${key}: displayed ${column.id} sparkline column has no geometry`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(50);
  check((await page.evaluate(objectiveMetrics)).runningAnimations === 0, `${key}: animations remain with reduced motion`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  console.log(`Captured ${key}; ${report.failures.length} objective failures recorded so far.`);
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
}

for (const viewport of viewportSizes) for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  const key = `${viewport.width}/${theme}`;
  page.on('pageerror', error => report.failures.push(`${key}: ${error.message}`));
  try {
    await page.goto(current.url);
    await visible(page.locator(readySelector));
    if (theme === 'light') await page.getByRole('button', { name: 'ライトモードに切り替え', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, viewport, theme, 'home');
    await page.getByRole('button', { name: '候補を絞り込む', exact: true }).click();
    await page.getByLabel('あと1条件', { exact: true }).check();
    await page.getByRole('button', { name: '絞り込みを閉じる', exact: true }).click();
    await capture(page, viewport, theme, 'near-pass');
    await page.getByRole('button', { name: '候補を絞り込む', exact: true }).click();
    await page.getByLabel('あと1条件', { exact: true }).uncheck();
    await page.getByRole('button', { name: '絞り込みを閉じる', exact: true }).click();
    if (viewport.width === 1440) {
      await page.getByRole('button', { name: '概況をたたむ', exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await capture(page, viewport, theme, 'compact');
      await page.getByRole('button', { name: '概況を展開', exact: true }).click();
    }
    await page.locator('.candidate-row').first().click();
    await capture(page, viewport, theme, 'detail');
    const expand = page.getByRole('button', { name: '日次チャートを分析', exact: true });
    check(await expand.isVisible(), `${key}: chart expansion control is missing`);
    if (await expand.isVisible()) {
      await expand.click(); await visible(page.getByRole('dialog'));
      await capture(page, viewport, theme, 'chart');
      await page.keyboard.press('Escape');
    }
    if (viewport.width === 390) {
      await page.locator('.mobile-header-back:visible, .mobile-back:visible').first().click();
      await visible(page.locator(readySelector));
      check(await page.locator('.research-workbench').getAttribute('data-mobile-view') === 'list', `${key}: back control did not restore candidate list`);
    }
  } catch (error) {
    report.failures.push(`${key}: home/detail verification interrupted: ${error.message}`);
    await page.screenshot({ path: resolve(output, `interrupted-home-${viewport.width}-${theme}.png`) }).catch(() => {});
  }
  // Each remaining route is independently loadable. A broken return control
  // above remains a failure, but cannot hide problems on unrelated screens.
  try {
    await page.goto(current.url); await page.reload(); await visible(page.locator(readySelector));
    if (await page.locator('.leader-shell').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'light' ? 'ライトモードに切り替え' : 'ダークモードに切り替え', exact: true }).click();
    const planButton = page.getByRole('button', { name: /条件付きの配分|配分の試算/ }).first();
    await planButton.click(); await visible(page.getByRole('dialog'));
    await capture(page, viewport, theme, 'portfolio');
    await page.keyboard.press('Escape');
  } catch (error) {
    report.failures.push(`${key}: portfolio verification interrupted: ${error.message}`);
  }
  for (const [screen, route, selector] of [['comparison', '#/compare', '.comparison-grid'], ['market', '#/breadth?tab=sectors', '.sector-strength'], ['breadth', '#/breadth', '.market-trend, [data-testid="breadth-unavailable"]'], ['scan', '#/scan', 'h1']]) {
    try {
      await page.goto(`${current.url}${route}`); await visible(page.locator(selector));
      if (screen === 'comparison') await visible(page.locator('.comparison-grid canvas, .comparison-grid svg'));
      if (screen === 'scan') await visible(page.locator('[data-testid="mobile-scan-row"], tbody tr'));
      await capture(page, viewport, theme, screen);
      if (screen === 'comparison') {
        await page.getByRole('button', { name: '手法・絞り込み', exact: true }).click();
        await page.getByLabel('あと1条件', { exact: true }).check();
        await page.getByRole('button', { name: '絞り込みを閉じる', exact: true }).click();
        await capture(page, viewport, theme, 'comparison-near-pass');
      }
    } catch (error) {
      report.failures.push(`${key}: ${screen} verification interrupted: ${error.message}`);
      await page.screenshot({ path: resolve(output, `interrupted-${screen}-${viewport.width}-${theme}.png`) }).catch(() => {});
    }
  }
  await verifyChartCases({ page, viewport, theme, capture, check, report, currentUrl: current.url });
  await verifyFinancialCases({ page, viewport, theme, capture, check, report, currentUrl: current.url });
  await context.close();
}
for (const viewport of viewportSizes) for (const theme of ['dark', 'light']) {
  const chartScreens = CHART_DESIGN_SYMBOLS.flatMap(symbol => ['inline', 'inline-annotations', 'expanded', 'expanded-annotations'].map(view => `case-${symbol}-${view}`));
  const screens = ['home', 'near-pass', 'detail', 'chart', 'portfolio', 'comparison', 'comparison-near-pass', 'market', 'breadth', 'scan', ...(viewport.width === 1440 ? ['compact'] : []), ...chartScreens, ...financialDesignScreens(viewport, theme)];
  for (const screen of screens) {
    const key = `${screen}/${viewport.width}/${theme}`;
    check(report.screens.some(result => result.key === key), `${key}: required capture was not completed`);
  }
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const [label, server] of [['baseline', baseline], ['current', current]]) {
  if (!server) continue;
  for (const viewport of viewportSizes) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const cache = new Map();
    await context.route('**/*', async route => {
      const key = route.request().url();
      try {
        if (!cache.has(key)) { const response = await route.fetch(); cache.set(key, { status: response.status(), headers: response.headers(), body: await response.body() }); }
        await route.fulfill(cache.get(key));
      } catch { await route.abort().catch(() => {}); }
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__reviewTasks = [];
      new PerformanceObserver(list => window.__reviewTasks.push(...list.getEntries().map(item => ({ start: item.startTime, duration: item.duration })))).observe({ type: 'longtask', buffered: true });
    });
    const runs = [];
    try {
      await page.goto(server.url); await visible(page.locator(readySelector)); await page.waitForLoadState('networkidle');
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      for (let repetition = 0; repetition < 3; repetition++) {
        const start = Date.now();
        await page.goto(server.url); await visible(page.locator(readySelector));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const candidateMs = Date.now() - start;
        const initialTasks = await page.evaluate(() => ({ longest: Math.max(0, ...window.__reviewTasks.map(item => item.duration)), tasks: window.__reviewTasks }));
        const method = page.getByRole('button', { name: /^オニール/, exact: false });
        const switchStart = Date.now(); await method.click();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const switchMs = Date.now() - switchStart;
        runs.push({ candidate_ms: candidateMs, method_switch_ms: switchMs, longest_initial_task_ms: initialTasks.longest, initial_tasks: initialTasks.tasks,
          memory: await page.evaluate(() => performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize } : null) });
        console.log(`CPU4 ${label}/${viewport.width} run ${repetition + 1}: ready ${candidateMs}ms, switch ${switchMs}ms, long task ${initialTasks.longest}ms.`);
      }
      if (label === 'current' && runs.some(run => run.candidate_ms > 3500 || run.method_switch_ms > 400 || run.longest_initial_task_ms > 200)) {
        // Diagnostic recording is a separate fourth run and cannot influence
        // any of the three budget measurements above.
        try {
          report.profile_diagnostics_attempted = true;
          report.profile_diagnostics ||= [];
          report.profile_diagnostics.push(await recordProfileDiagnostic({ cdp, page, output, name:`diagnostic-initial-${viewport.width}`, action:async () => {
            await page.goto(server.url); await visible(page.locator(readySelector));
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          } }));
          // Keep method switching isolated from initial Worker delivery. These
          // diagnostic phases never replace any of the three measured runs.
          report.profile_diagnostics.push(await recordProfileDiagnostic({ cdp, page, output, name:`diagnostic-method-${viewport.width}`, settleMs:500, action:async () => {
            await page.getByRole('button', { name: /^オニール/ }).click();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          } }));
        } catch (error) { report.failures.push(`Diagnostic profile unavailable: ${error.message}`); }
      }
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    } catch (error) { report.failures.push(`${label}/${viewport.width}: performance interrupted: ${error.message}`); }
    const metrics = { label, viewport, runs, candidate_median_ms: runs.length === 3 ? median(runs.map(run => run.candidate_ms)) : null,
      maximum_switch_ms: runs.length ? Math.max(...runs.map(run => run.method_switch_ms)) : null,
      longest_initial_task_ms: runs.length ? Math.max(...runs.map(run => run.longest_initial_task_ms)) : null, cached_response_count: cache.size };
    report.performance.push(metrics);
    if (label === 'current') {
      check(runs.length === 3, `${viewport.width}: performance requires all 3 runs`);
      check(metrics.candidate_median_ms !== null && metrics.candidate_median_ms <= 4200, `${viewport.width}: Q1 candidate median ${metrics.candidate_median_ms}ms > 4200ms`);
      check(metrics.maximum_switch_ms !== null && metrics.maximum_switch_ms <= 480, `${viewport.width}: Q1 method switch ${metrics.maximum_switch_ms}ms > 480ms`);
      // Report P1 exact acceptance separately; Q1's 20% CI allowance never
      // converts a miss of P1's original limits into a P1 pass.
      metrics.p1_pass = runs.length === 3 && metrics.candidate_median_ms <= 3500 && metrics.maximum_switch_ms <= 400 && metrics.longest_initial_task_ms <= 200;
      check(metrics.p1_pass, `${viewport.width}: P1 exact limits not met (3500ms / 400ms / 200ms)`);
    }
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    await context.close();
  }
}
report.radar = [];
if (!radar) check(false, 'D9: the isolated production radar benchmark build is required');
if (radar) for (const viewport of viewportSizes) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage(), runs = [];
  try {
    await page.goto(radar.url); await page.waitForFunction(() => typeof window.measureRadar === 'function');
    const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    for (let index = 0; index < 3; index++) runs.push(await page.evaluate(() => window.measureRadar()));
    check(runs.every(run => run.point_count === 207), `${viewport.width}: D9 needs exactly 207 actual historical points`);
    check(runs.every(run => run.final_point_count === 207 && run.pixel_alignment?.matches === true), `${viewport.width}: D9 must finish all 207 points at actual CSS size and DPR by the first-frame boundary`);
    check(runs.length === 3 && runs.every(run => run.first_frame_ms <= 50), `${viewport.width}: D9 first paint opportunity ${Math.max(...runs.map(run => run.first_frame_ms)).toFixed(1)}ms > 50ms`);
    for (const [index, run] of runs.entries()) for (const failure of radarMeasurementFailures(run)) check(false, `${viewport.width}: D9 run ${index + 1}: ${failure}`);
  } catch (error) { report.failures.push(`${viewport.width}: D9 benchmark interrupted: ${error.message}`); }
  report.radar.push({ viewport, cpu_rate: 4, harness_version: RADAR_HARNESS_VERSION, method: 'actual SetupRadar in production CSS ancestry and original fixed component slot; 207 canonical real 2026-09-29 observations; cold initial mount, synchronous layout and next animation frame with same-task pixel/CSS/transform visibility evidence; no prerender or glyph warmup; not comparable to former bare-div harness', runs });
  await context.close();
}
await browser.close(); await current.close(); if (baseline) await baseline.close(); if (radar) await radar.close();
if (report.profile_diagnostics_attempted) {
  try {
    report.profile_sources = await retainProfileSources({ root:currentRoot, output,
      quoteUrl:process.env.FINANCIAL_CANDIDATE_DIR ? process.env.DESIGN_RESEARCH_QUOTE_URL || '' : undefined });
  } catch (error) { report.failures.push(`Diagnostic source maps unavailable: ${error.message}`); }
}
if (radar && report.failures.some(failure => failure.includes('D9'))) {
  // The existing focused harness records a separate cold CPU/timeline trace.
  // It runs after all acceptance measurements and cannot turn their failures
  // into passes or move work out of the timed render boundary.
  try {
    execFileSync(process.execPath, ['tools/radar-diagnostic.mjs'], {
      env: {...process.env,RADAR_DIAGNOSTIC_OUTPUT:resolve(output,'radar-diagnostic')}, stdio:'inherit',
    });
  } catch (error) {
    console.log(`Focused radar diagnostic exited ${error.status ?? 'with an error'}; retain its artifacts alongside the original acceptance failure.`);
  }
}
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
await writeFile(resolve(output, 'summary.md'), `# Design and performance acceptance\n\nCommit: ${commit}\n\nData: ${report.data.as_of_date} / ${report.data.research_generation}\n\n${report.screens.length} screenshots; ${report.failures.length} failures.\n\n${report.failures.map(item => `- ${item}`).join('\n')}\n\n## Performance\n\n${report.performance.map(item => `- ${item.label}, ${item.viewport.width}px: candidate median ${item.candidate_median_ms}ms, switch maximum ${item.maximum_switch_ms}ms, longest task ${item.longest_initial_task_ms}ms`).join('\n')}\n\nSubjective design scores require an explicit review of these screenshots. This script does not invent them.\n`);
console.log(JSON.stringify({ commit, screens: report.screens.length, performance: report.performance.map(({ runs, ...item }) => { void runs; return item; }), failures: report.failures }, null, 2));
if (report.failures.length) process.exitCode = 1;
