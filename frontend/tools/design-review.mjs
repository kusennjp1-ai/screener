// CI-only production-browser acceptance measurements. Never turn a missing
// observation into a pass. Artifacts are written before any gate fails.
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from '../src/static/financialEvidencePresentation.js';
import { assess } from '../src/static/researchEngine.js';
import { PERFORMANCE_SCENARIOS, performanceDomWitness, performanceDomFailures, performanceResult, performanceSummary, performancePublicationUniverse, performanceUniverseFailures, coldNavigationFailures, designReviewProvenance } from './design-performance.mjs';
import { collectResearchFeedPages } from './feed-pagination-review.mjs';
import { RADAR_HARNESS_VERSION, radarMeasurementFailures } from './radar-benchmark-context.mjs';
import { verifyChartCases, CHART_DESIGN_SYMBOLS } from './chart-design-cases.mjs';
import { researchFeedMetrics, checkResearchFeedMetrics, checkFeedDetailConsistency, checkDetailSourceEvidence, checkFeedDecisionEvidence, parseResearchCsv, FEED_REVIEW_VIEWPORTS, FEED_REVIEW_METHODS } from './research-feed-acceptance.mjs';

if (!process.env.CI) throw Error('Run this browser harness in GitHub Actions, not on the desktop host.');
const output = resolve(process.env.DESIGN_REVIEW_OUTPUT || 'test-results/design-review');
await mkdir(output, { recursive: true });
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const viewportSizes = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];
const currentRoot = resolve(process.env.CURRENT_BUILD || 'dist');
const baselineRoot = process.env.BASELINE_BUILD && resolve(process.env.BASELINE_BUILD);
const radarRoot = process.env.RADAR_BUILD && resolve(process.env.RADAR_BUILD);
const report = { commit, measured_at: new Date().toISOString(), ...designReviewProvenance(process.env), clock: 'actual browser Date.now; no historical date override', data: null,
  observation_cost: 'Each initial_dom/switched_dom collection_ms records synchronous DOM reads. Collection, serialization and transport remain included in the measured endpoint; no observation cost is subtracted.',
  method: 'Production Chromium. CDP CPU 4x; identical full-data baseline/current inputs. HTTP responses cached in memory after an untimed data/network preparation load; every measured run reloads its requested route into a fresh document and retains cold application mount. Legacy dense50 is a different product default, not an equal-DOM comparison. Approved current20 is the release criterion; optional current50 stress uses the same limits and the same-run legacy50 reference. No human satisfaction inference.', screens: [], performance: [], performance_stress: [], failures: [] };
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
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(resolve(currentRoot, 'static-data/manifest.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const currentEntry = manifest.markets?.US || manifest;
const currentResearchBytes = await readFile(resolve(currentRoot, 'static-data', currentEntry.assets.research.path));
const publishedResearch = decodeResearchIndex(JSON.parse(currentResearchBytes.toString('utf8')));
report.data = { as_of_date: currentEntry.as_of_date, generated_at: manifest.generated_at, research_generation: manifest.research_generation,
  manifest_sha256: sha256(manifestBytes), research_path: currentEntry.assets.research.path,
  research_sha256: sha256(currentResearchBytes), full_index_row_count: publishedResearch.rows.length };
const performanceUniverses = {};
async function publicationUniverse(root, entry, label, indexBytes) {
  const raw = indexBytes || await readFile(resolve(root, 'static-data', entry.assets.research.path));
  const index = JSON.parse(raw.toString('utf8'));
  const chunks = await Promise.all((index.chunks || []).map(async chunk => JSON.parse(await readFile(resolve(root, 'static-data', chunk.path), 'utf8'))));
  const universe = performancePublicationUniverse([index, ...chunks], entry.as_of_date);
  (report.transport ||= []).push({ label, as_of_date: entry.as_of_date, raw_bytes: raw.length, gzip_bytes: gzipSync(raw).length });
  (report.data.performance_universes ||= {})[label] = { source_row_count: universe.source_symbols.length,
    source_symbols_sha256: sha256(JSON.stringify(universe.source_symbols)), full_candidate_total: universe.symbols.length,
    candidate_symbols_sha256: sha256(JSON.stringify(universe.symbols)), chunk_count: chunks.length,
    method: 'complete index+chunks, canonical merged rows, US/missing market and default liquidity filter; independent of page size' };
  return universe;
}
performanceUniverses.current = await publicationUniverse(currentRoot, currentEntry, 'current', currentResearchBytes);
if (baselineRoot) {
  const previousManifest = JSON.parse(await readFile(resolve(baselineRoot, 'static-data/manifest.json'), 'utf8'));
  const previousEntry = previousManifest.markets?.US || previousManifest;
  performanceUniverses.baseline = await publicationUniverse(baselineRoot, previousEntry, 'baseline');
  check(currentEntry.as_of_date === previousEntry.as_of_date && JSON.stringify(performanceUniverses.current.source_symbols) === JSON.stringify(performanceUniverses.baseline.source_symbols), 'Baseline/current full snapshots have different dates or symbols; performance comparison is invalid');
  report.data.legacy_cohort_comparison = { same_source_symbols: JSON.stringify(performanceUniverses.current.source_symbols) === JSON.stringify(performanceUniverses.baseline.source_symbols),
    same_filtered_cohort: JSON.stringify(performanceUniverses.current.symbols) === JSON.stringify(performanceUniverses.baseline.symbols),
    current_total: performanceUniverses.current.symbols.length, legacy_total: performanceUniverses.baseline.symbols.length,
    note: 'Filtered cohort differences between versions are diagnostic; each version must match its own complete publication, and current50 must match current20.' };
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

async function capture(page, viewport, theme, screen, taskSurface = null) {
  if (await page.locator('.leader-shell').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'light' ? 'ライトモードに切り替え' : 'ダークモードに切り替え', exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  const metrics = await page.evaluate(objectiveMetrics);
  const feedMetrics = taskSurface || ['home', 'near-pass', 'compact', 'detail'].includes(screen) ? await page.evaluate(researchFeedMetrics) : null;
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const screenshot = `${screen}-${viewport.width}x${viewport.height}-${theme}.png`;
  const screenshotBytes = await page.screenshot({ path: resolve(output, screenshot) });
  const key = `${screen}/${viewport.width}/${theme}`;
  const diagnosticChecks = (checks=[]) => checks.map(({id,message,data,relatedNodes})=>({id,message,data,relatedNodes:(relatedNodes||[]).map(node=>({target:node.target}))}));
  report.screens.push({ key, screenshot, screenshot_sha256: sha256(screenshotBytes), viewport, theme,
    provenance: { commit, source_run: report.source_run, input_source_run: report.input_source_run, data: report.data, browser_evaluated_at: await page.evaluate(() => new Date().toISOString()), route: new URL(page.url()).hash || '#/', method: feedMetrics?.method || null, feed_symbol: feedMetrics?.feed.symbol || null, selected_symbol: feedMetrics?.detail.symbol || null },
    metrics, feed: feedMetrics, axe: axe.violations.map(({ id, impact, description, nodes }) => ({ id, impact, description, nodes: nodes.map(node => ({ target: node.target, failureSummary: node.failureSummary, any:diagnosticChecks(node.any), all:diagnosticChecks(node.all), none:diagnosticChecks(node.none) })) })) });
  check(axe.violations.length === 0, `${key}: axe ${axe.violations.length} rule violations`);
  check(metrics.smallTargets.length === 0, `${key}: ${metrics.smallTargets.length} undersized hit targets`);
  check(metrics.fontIssues.length === 0, `${key}: ${metrics.fontIssues.length} font-step violations`);
  check(metrics.radiusIssues.length === 0, `${key}: ${metrics.radiusIssues.length} radius-step violations`);
  check(metrics.asciiNegativeValues.length === 0, `${key}: ${metrics.asciiNegativeValues.length} financial values use ASCII minus`);
  check(!metrics.horizontalOverflow, `${key}: horizontal page overflow`);
  if (viewport.width <= 390) check(metrics.chromeHeight <= 110, `${key}: fixed chrome ${metrics.chromeHeight}px > 110px`);
  if (['home', 'near-pass'].includes(screen) && viewport.width === 1440) {
    check(metrics.hero && metrics.hero.height <= 320, `${key}: hero height ${metrics.hero?.height} > 320px or missing`);
  }
  // Replaces only obsolete table-density/chart-first requirements. The prior
  // observations remain in review history; objective/CPU/payload gates below
  // retain their limits. See docs/research-feed-adoptions.md for the mapping.
  if (feedMetrics) {
    const surface = taskSurface || (screen === 'detail' ? 'detail' : 'feed');
    checkResearchFeedMetrics(feedMetrics, check, key, { surface });
  }
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
    check(await page.getByRole('button', { name: '全体概況を展開', exact: true }).getAttribute('aria-expanded') === 'false' && await page.locator('#research-market-overview').count() === 0, `${key}: overview must start closed`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, viewport, theme, 'home');
    await page.getByRole('button', { name: '候補を絞り込む', exact: true }).click();
    await page.getByLabel('あと1条件', { exact: true }).check();
    await page.getByRole('button', { name: '絞り込みを閉じる', exact: true }).click();
    await capture(page, viewport, theme, 'near-pass');
    await page.getByRole('button', { name: '候補を絞り込む', exact: true }).click();
    await page.getByLabel('あと1条件', { exact: true }).uncheck();
    await page.getByRole('button', { name: '絞り込みを閉じる', exact: true }).click();
    await page.getByRole('button', { name: '全体概況を展開', exact: true }).click();
    await visible(page.locator('#research-market-overview'));
    check(await page.getByRole('button', { name: '全体概況をたたむ', exact: true }).getAttribute('aria-expanded') === 'true', `${key}: overview did not expand`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, viewport, theme, 'overview-expanded');
    await page.getByRole('button', { name: '全体概況をたたむ', exact: true }).click();
    check(await page.locator('#research-market-overview').count() === 0, `${key}: overview did not collapse`);
    await page.evaluate(() => window.scrollTo(0, 0));
    if (viewport.width === 1440) {
      await capture(page, viewport, theme, 'compact');
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
  await context.close();
}
for (const viewport of viewportSizes) for (const theme of ['dark', 'light']) {
  const chartScreens = CHART_DESIGN_SYMBOLS.flatMap(symbol => ['inline', 'inline-annotations', 'expanded', 'expanded-annotations', 'expanded-short'].map(view => `case-${symbol}-${view}`));
  const screens = ['home', 'near-pass', 'overview-expanded', 'detail', 'chart', 'portfolio', 'comparison', 'comparison-near-pass', 'market', 'breadth', 'scan', ...(viewport.width === 1440 ? ['compact'] : []), ...chartScreens];
  for (const screen of screens) {
    const key = `${screen}/${viewport.width}/${theme}`;
    check(report.screens.some(result => result.key === key), `${key}: required capture was not completed`);
  }
}

// Real publication, real clock, all four methods. These extra captures and
// interactions never change the baseline/current timed workloads below.
report.feed_tasks = [];
for (const viewport of FEED_REVIEW_VIEWPORTS) for (const theme of ['dark', 'light']) for (const method of FEED_REVIEW_METHODS) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  const suffix = `${method}-${viewport.height === 844 ? 'narrow' : 'short'}`;
  const key = `${suffix}/${viewport.width}/${theme}`, record = { key, viewport, theme, method, completed: false };
  page.on('pageerror', error => report.failures.push(`${key}: ${error.message}`));
  try {
    await page.goto(`${current.url}#/?method=${method}`);
    await visible(page.locator('.candidate-feed-card'));
    if (theme === 'light') await page.getByRole('button', { name: 'ライトモードに切り替え', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    // No scrollIntoView before this capture or its first-viewport observations.
    await capture(page, viewport, theme, `feed-${suffix}`, 'feed');
    const initial = await page.evaluate(researchFeedMetrics);
    record.feed = initial.feed;
    const evidenceOpener = page.getByRole('button', { name: `${initial.feed.symbol} の財務・日次根拠を見る`, exact: true });
    // The initial capture is already retained. Now reach the actual evidence
    // action and remember the position the user leaves for Back restoration.
    await evidenceOpener.scrollIntoViewIfNeeded();
    const selectionScrollY = await page.evaluate(() => scrollY);
    record.selection_scroll_y = selectionScrollY;
    record.selection_before_click = await evidenceOpener.evaluate(node => {
      const box = node.getBoundingClientRect(), nav = document.querySelector('.leader-mobile-nav')?.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      window.__designEvidenceClick = null;
      // Playwright may scroll again to clear sticky navigation. Capture the
      // user's actual click position before React records its Back destination.
      node.addEventListener('click', event => {
        window.__designEvidenceClick = { scroll_y: window.scrollY, list_scroll_top: document.querySelector('.candidate-scroll')?.scrollTop ?? null,
          evaluated_at: new Date().toISOString(), client_x: event.clientX, client_y: event.clientY };
      }, { capture: true, once: true });
      return { scroll_y: window.scrollY, button: { top: box.top, bottom: box.bottom }, navigation_top: nav?.height ? nav.top : null,
        center_unobscured: Boolean(hit && (node.contains(hit) || hit.contains(node))) };
    });
    await evidenceOpener.click();
    record.selection_click = await page.evaluate(() => window.__designEvidenceClick);
    check(Number.isFinite(record.selection_click?.scroll_y), `${key}: actual evidence click position was not observed`);
    await visible(page.locator('.research-detail .financial-evidence-summary'));
    await capture(page, viewport, theme, `detail-${suffix}`, 'detail');
    const selected = await page.evaluate(researchFeedMetrics);
    record.detail = selected.detail;
    checkFeedDetailConsistency(initial.feed, selected.detail, check, key);
    const publishedRow = publishedResearch.rows.find(row => row.symbol === initial.feed.symbol);
    if (!publishedRow) throw Error('The chosen feed symbol is absent from the published research index');
    const evidenceContext = { symbol: publishedRow.symbol, date: report.data.as_of_date, generation: report.data.research_generation || report.data.generated_at, method, now: selected.evaluatedAt };
    const canonical = financialEvidencePresentation({ ...evidenceContext, history: publishedRow.financial_history, evidence: buildFinancialEvidencePresentation(publishedRow, evidenceContext) });
    checkDetailSourceEvidence(selected.detail, { symbol: publishedRow.symbol, rows: canonical.rows }, check, key);
    checkFeedDecisionEvidence(initial.feed, { method, selection: assess(publishedRow, method, selected.evaluatedAt), annual: canonical.rows.find(row => row.id === 'annual_eps_growth_3y') }, check, key);
    record.source_evidence = { symbol: publishedRow.symbol, evaluated_at: new Date(selected.evaluatedAt).toISOString(), expected: canonical.rows.filter(row => ['eps_growth_yy', 'sales_growth_yy', 'annual_eps_growth_3y'].includes(row.id)) };
    if (viewport.width < 1280) {
      await page.locator('.mobile-header-back:visible, .mobile-back:visible').first().click();
      await visible(page.locator('.candidate-feed-card'));
      // Restoration is scheduled for the next animation frame by the app.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      check(await page.locator('.research-workbench').getAttribute('data-mobile-view') === 'list', `${key}: Back did not restore the feed`);
      const returned = await page.evaluate(researchFeedMetrics);
      checkFeedDetailConsistency(returned.feed, selected.detail, check, `${key}/Back`);
      record.restored_scroll_y = returned.scrollY;
      check(Number.isFinite(record.selection_click?.scroll_y) && Math.abs(returned.scrollY - record.selection_click.scroll_y) <= 1, `${key}: Back did not restore the actual click position (${returned.scrollY}px versus ${record.selection_click?.scroll_y}px)`);
    }
    const chosen = page.locator('.candidate-feed-card').filter({ has: page.locator('.candidate-name strong', { hasText: new RegExp(`^${initial.feed.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
    check(await chosen.getAttribute('data-selected') === 'true', `${key}: Back changed the selected feed symbol`);
    await page.getByRole('button', { name: '候補を絞り込む', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '候補を絞り込む', exact: true });
    await drawer.getByLabel('銘柄・企業名を検索', { exact: true }).fill(initial.feed.symbol);
    const liquidity = drawer.getByLabel('流動性：株価 $10以上・平均売買代金 $2,000万以上', { exact: true });
    await liquidity.uncheck();
    await drawer.getByRole('button', { name: '絞り込みを閉じる', exact: true }).click();
    await visible(page.getByRole('button', { name: `検索：${initial.feed.symbol}の絞り込みを解除`, exact: true }));
    check(await page.getByRole('button', { name: '流動性の絞り込みを解除', exact: true }).count() === 0, `${key}: removed liquidity filter chip is stale`);
    await page.getByRole('button', { name: '候補を絞り込む', exact: true }).click();
    check(await drawer.getByLabel('銘柄・企業名を検索', { exact: true }).inputValue() === initial.feed.symbol && !await liquidity.isChecked(), `${key}: search/filter values changed after closing the drawer`);
    await liquidity.check();
    await drawer.getByRole('button', { name: '絞り込みを閉じる', exact: true }).click();
    await visible(page.getByRole('button', { name: '流動性の絞り込みを解除', exact: true }));
    const traversal = await collectResearchFeedPages(page), filteredSymbols = traversal.symbols;
    record.filtered_pages = traversal.pages;
    check(filteredSymbols.includes(initial.feed.symbol), `${key}: search lost the selected symbol`);
    await page.getByRole('button', { name: '候補を絞り込む', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await drawer.getByRole('button', { name: '全検索結果をCSV保存 ↓', exact: true }).click();
    const download = await downloadPromise, csv = await readFile(await download.path()), csvRows = parseResearchCsv(csv.toString('utf8'));
    check(csvRows.length === traversal.total && new Set(csvRows.map(row => row.symbol)).size === csvRows.length, `${key}: CSV has missing or duplicate search-result symbols`);
    check(JSON.stringify(csvRows.map(row => row.symbol).sort()) === JSON.stringify([...filteredSymbols].sort()), `${key}: CSV symbols differ from active search/filter results`);
    check(csvRows.length > 0 && csvRows.every(row => row.method === method && row.as_of_date === report.data.as_of_date && row.financial_semantics === 'current_at_evaluation_not_historical_publication'), `${key}: CSV method/date/current-evaluation identity differs from the feed`);
    record.csv = { sha256: sha256(csv), filename: download.suggestedFilename(), symbols: csvRows.map(row => row.symbol), evaluated_at: [...new Set(csvRows.map(row => row.financial_evaluated_at))] };
    await drawer.getByRole('button', { name: '絞り込みを閉じる', exact: true }).click();
    await page.getByRole('button', { name: `検索：${initial.feed.symbol}の絞り込みを解除`, exact: true }).click();
    check(await page.getByRole('button', { name: `検索：${initial.feed.symbol}の絞り込みを解除`, exact: true }).count() === 0, `${key}: search chip did not clear`);
    await page.getByRole('button', { name: '候補を絞り込む', exact: true }).click();
    check(await drawer.getByLabel('銘柄・企業名を検索', { exact: true }).inputValue() === '' && await liquidity.isChecked(), `${key}: clearing search also changed another filter`);
    record.completed = true;
  } catch (error) {
    report.failures.push(`${key}: feed task verification interrupted: ${error.message}`);
    await page.screenshot({ path: resolve(output, `interrupted-feed-${suffix}-${viewport.width}-${theme}.png`) }).catch(() => {});
  } finally {
    for (const screen of [`feed-${suffix}`, `detail-${suffix}`]) check(report.screens.some(result => result.key === `${screen}/${viewport.width}/${theme}`), `${key}: required ${screen} capture was not completed`);
    check(record.completed, `${key}: selection/Back/search/filter/CSV task did not complete`);
    report.feed_tasks.push(record);
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    await context.close();
  }
}

for (const scenario of PERFORMANCE_SCENARIOS) {
  const { label } = scenario, server = label === 'baseline' ? baseline : current;
  if (!server) { check(false, `${label}: production build required for same-run performance reference`); continue; }
  const url = `${server.url}${scenario.route}`;
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
    await page.addInitScript({ content: `window.__performanceDomWitness = ${performanceDomWitness.toString()};` });
    const runs = [], observationFailures = [];
    try {
      await page.goto(url); await visible(page.locator(readySelector)); await page.waitForLoadState('networkidle');
      let previousTimeOrigin = await page.evaluate(() => performance.timeOrigin);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      for (let repetition = 0; repetition < 3; repetition++) {
        const start = Date.now();
        // Explicit reload prevents a repeated hash URL from becoming a
        // same-document navigation. All workloads use this identical cold
        // navigation operation and retain the navigation-to-two-rAF endpoint.
        await page.reload(); await visible(page.locator(readySelector));
        const initialWitness = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.__performanceDomWitness())))));
        const candidateMs = Date.now() - start;
        observationFailures.push(...coldNavigationFailures(previousTimeOrigin, initialWitness).map(failure => `run ${repetition + 1}: ${failure}`));
        previousTimeOrigin = initialWitness.time_origin;
        const initialTasks = await page.evaluate(() => ({ longest: Math.max(0, ...window.__reviewTasks.map(item => item.duration)), tasks: window.__reviewTasks }));
        const method = page.getByRole('button', { name: /^オニール/, exact: false });
        const switchStart = Date.now(); await method.click();
        const switchWitness = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.__performanceDomWitness())))));
        const switchMs = Date.now() - switchStart;
        for (const [phase, witness, expectedMethod] of [['initial', initialWitness, 'minervini'], ['switch', switchWitness, 'oneil']]) {
          observationFailures.push(...performanceDomFailures(witness, { ...scenario, method: expectedMethod }).map(failure => `run ${repetition + 1} ${phase}: ${failure}`));
        }
        runs.push({ initial_dom: initialWitness, switched_dom: switchWitness, candidate_ms: candidateMs, method_switch_ms: switchMs, longest_initial_task_ms: initialTasks.longest, initial_tasks: initialTasks.tasks,
          memory: await page.evaluate(() => performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize } : null) });
        console.log(`CPU4 ${label}/${viewport.width} run ${repetition + 1}: ready ${candidateMs}ms, switch ${switchMs}ms, long task ${initialTasks.longest}ms.`);
      }
      if (label !== 'baseline' && runs.some(run => run.candidate_ms > 3500 || run.method_switch_ms > 400 || run.longest_initial_task_ms > 200)) {
        // Diagnostic recording is a separate fourth run and cannot influence
        // any of the three budget measurements above.
        try {
          await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
          await page.reload(); await visible(page.locator(readySelector));
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const initial = await cdp.send('Profiler.stop');
          await writeFile(resolve(output, `diagnostic-initial-${label}-${viewport.width}.cpuprofile`), JSON.stringify(initial.profile));
          // Keep method switching isolated from initial Worker delivery. These
          // diagnostic phases never replace any of the three measured runs.
          await cdp.send('Profiler.start');
          await page.getByRole('button', { name: /^オニール/ }).click();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await page.waitForTimeout(500);
          const { profile } = await cdp.send('Profiler.stop');
          await writeFile(resolve(output, `diagnostic-method-${label}-${viewport.width}.cpuprofile`), JSON.stringify(profile));
          await cdp.send('Profiler.disable');
        } catch (error) { report.failures.push(`Diagnostic profile unavailable: ${error.message}`); }
      }
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    } catch (error) { observationFailures.push(`performance interrupted: ${error.message}`); }
    const universe = performanceUniverses[label === 'baseline' ? 'baseline' : 'current'];
    const currentDefault = report.performance.find(item => item.label === 'current' && item.viewport.width === viewport.width);
    observationFailures.push(...performanceUniverseFailures(runs, universe, label === 'current-50-stress' ? { referenceTotal: currentDefault?.full_candidate_total ?? null } : {}));
    const metrics = performanceResult(scenario, viewport, runs, { cachedResponseCount: cache.size, observationFailures });
    metrics.full_candidate_total = runs[0]?.initial_dom?.total ?? null;
    metrics.expected_full_candidate_total = universe?.symbols.length ?? null;
    metrics.universe_reference = label === 'baseline' ? 'own baseline complete publication' : 'own current complete publication';
    metrics.baseline_reference = label === 'baseline' ? null : { section: 'performance', label: 'baseline', viewport, same_run: true, equal_dom: false };
    report[scenario.section].push(metrics);
    // Baseline completion still gates the validity of the control. Optional50
    // budget misses stay explicit in their own section; they do not override
    // the approved20 release criterion or disappear behind a Q1 allowance.
    for (const failure of metrics.measurement_failures) check(false, `${label}/${viewport.width}: ${failure}`);
    if (scenario.release_criterion) {
      for (const failure of [...metrics.p1_limit_failures, ...metrics.q1_limit_failures]) check(false, `${label}/${viewport.width}: ${failure}`);
      check(metrics.p1_pass, `${label}/${viewport.width}: P1 exact limits not met (3500ms / 400ms / 200ms)`);
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
    for (const [index, run] of runs.entries()) for (const failure of radarMeasurementFailures(run)) check(false, `${viewport.width}: D9 run ${index + 1}: ${failure}`);
    check(runs.every(run => run.point_count === 207), `${viewport.width}: D9 needs exactly 207 actual historical points`);
    check(runs.every(run => run.final_point_count === 207 && run.pixel_alignment?.matches === true), `${viewport.width}: D9 must finish all 207 points at actual CSS size and DPR by the first-frame boundary`);
    check(runs.length === 3 && runs.every(run => run.first_frame_ms <= 50), `${viewport.width}: D9 first paint opportunity ${Math.max(...runs.map(run => run.first_frame_ms)).toFixed(1)}ms > 50ms`);
  } catch (error) { report.failures.push(`${viewport.width}: D9 benchmark interrupted: ${error.message}`); }
  report.radar.push({ viewport, cpu_rate: 4, harness_version: RADAR_HARNESS_VERSION, comparison: 'current-only; historical bare-div v1 results are different harness conditions, not a paired legacy comparison', method: 'actual SetupRadar in production shell/expanded-overview style and width context, 207 canonical real 2026-09-29 observations; cold first React mount retained, all 3 runs; synchronous layout and next animation frame; no warmup or component work before timer; no network/data preparation in render interval', runs });
  await context.close();
}
await browser.close(); await current.close(); if (baseline) await baseline.close(); if (radar) await radar.close();
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
await writeFile(resolve(output, 'summary.md'), `# Design and performance acceptance\n\nCommit: ${commit}\n\nData: ${report.data.as_of_date} / ${report.data.research_generation}\n\n${report.screens.length} screenshots; ${report.failures.length} release/measurement failures.\n\n${report.failures.map(item => `- ${item}`).join('\n')}\n\n## Default release criterion and same-run legacy reference\n\nLegacy cd3a6a2 is the dense50 product default; current20 is the approved research-feed default. These are different DOM workloads with identical full data, not an equal-DOM performance claim. One legacy50 measurement set is reused as context for both current sizes.\n\n${performanceSummary(report.performance)}\n\n## Optional50 cold-load stress (same limits, reported separately)\n\nBudget misses here remain failures of this optional workload; they do not change the approved20 release criterion. Every run loads #/?feedSize=50 directly.\n\n${performanceSummary(report.performance_stress)}\n\n## D9 context\n\n${RADAR_HARNESS_VERSION}: current-only production ancestry/CSS/width. All three runs, including cold first React mount, retain 207 actual points, real CSS/DPR alignment and the 50ms limit. Earlier bare-div measurements remain historical conditions.\n\nSubjective design scores require an explicit review of these screenshots. This script does not invent them.\n`);
console.log(JSON.stringify({ commit, screens: report.screens.length, performance: report.performance.map(({ runs, ...item }) => { void runs; return item; }), performance_stress: report.performance_stress.map(({ runs, ...item }) => { void runs; return item; }), failures: report.failures }, null, 2));
if (report.failures.length) process.exitCode = 1;
