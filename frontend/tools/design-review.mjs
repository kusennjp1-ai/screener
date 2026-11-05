// Design Acceptance for the daily brief (the whole static app). Production
// Chromium drives the built site with its published data and records objective,
// blocking checks per screen, functional checks and CPU-4x timing. A missing
// observation is a failure, never a pass. Timing overruns are deferred warnings
// (the owner approved deferring them); they never enter `failures`.
// No subjective score is produced here.
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { COLOR_MODE_STORAGE_KEY } from '../src/contexts/useColorModePreference.js';
import { createDesignAssetObserver } from './design-static-assets.mjs';
import {
  AXE_TAGS, CAPTURES, DESIGN_GROUPS, FONT_SIZES, LEGACY_REDIRECTS, MIN_CANDLES, MOBILE_CHROME_BUDGET, RADII,
  REDUCED_MOTION_SETTLE_MS, REPORT_SCHEMA, TIMING, captureKey, minimumTarget, requiredCaptureKeys, summarizeTiming,
} from './brief-design-contract.mjs';

if (process.argv.length > 2) throw Error('The brief Design harness takes no arguments');
const output = resolve(process.env.DESIGN_REVIEW_OUTPUT || 'test-results/design-review');
const currentRoot = resolve(process.env.CURRENT_BUILD || 'dist');
await mkdir(output, { recursive: true });
// Only this run's evidence may sit next to its report.
for (const name of await readdir(output)) if (name === 'report.json' || name.endsWith('.png')) await rm(resolve(output, name), { force: true });

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const AXE_SOURCE = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const report = {
  schema: REPORT_SCHEMA, commit, measured_at: new Date().toISOString(),
  input_basis: process.env.DESIGN_INPUT_BASIS || 'unbound-local',
  input: { current_build: process.env.CURRENT_BUILD || 'dist', provenance_sha256: null, provenance_schema: null, carry_preview: Boolean(process.env.DESIGN_CARRY_PREVIEW_PROVENANCE), packed: null },
  data: null,
  method: 'Production Chromium serving CURRENT_BUILD at /screener/ from 127.0.0.1; every other request is aborted and recorded. Actual browser clock. Service workers blocked. Objective checks per capture; timing under CDP CPU 4x, median of 3 runs. No subjective scores.',
  contract: { groups: DESIGN_GROUPS.map(group => group.key), captures: CAPTURES.map(({ screen, path, how }) => ({ screen, path, how })), font_sizes: FONT_SIZES, radii: RADII,
    axe_tags: AXE_TAGS, mobile_chrome_budget: MOBILE_CHROME_BUDGET, min_candles: MIN_CANDLES, reduced_motion_settle_ms: REDUCED_MOTION_SETTLE_MS, legacy_redirects: LEGACY_REDIRECTS, timing: TIMING },
  groups: [], screens: [], functional: [], reduced_motion: [], failures: [], timing: [], timing_warnings: [],
};
const save = () => writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
const fail = (detail, ...lists) => {
  report.failures.push(detail);
  for (const list of lists) list?.push(detail);
  try { console.error(`[design-failure ${report.failures.length}] ${detail}`); } catch { /* Logging never changes the gate. */ }
};

// A financial correction changes the financial display. The brief has no verified
// financial-display contract yet, so such a candidate cannot pass this harness.
if (process.env.FINANCIAL_CANDIDATE_DIR) {
  fail('A financial correction candidate is prepared (FINANCIAL_CANDIDATE_DIR), but the brief Design harness has no verified financial-display contract; it fails closed.');
  await save();
  process.exit(1);
}
if (process.env.DESIGN_INPUT_PROVENANCE) {
  try {
    const bytes = await readFile(resolve(process.env.DESIGN_INPUT_PROVENANCE));
    const value = JSON.parse(bytes.toString('utf8'));
    report.input.provenance_sha256 = sha256(bytes);
    report.input.provenance_schema = value.schema ?? (value.decision?.mode ? `release-source:${value.decision.mode}` : 'unknown');
  } catch (error) { fail(`Design input provenance is unreadable: ${error.message}`); }
}

const mime = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain', '.wasm': 'application/wasm' };
async function serve(root) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (!pathname.startsWith('/screener/')) throw Error('Outside the base path');
      let file = resolve(root, pathname.slice('/screener/'.length) || 'index.html');
      if (file !== root && !file.startsWith(root + sep)) throw Error('Invalid path');
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, url: `${origin}/screener/`, close: () => new Promise(done => server.close(done)) };
}

const server = await serve(currentRoot);
const publicationPresent = await stat(resolve(currentRoot, 'publication.json')).then(info => info.isFile(), () => false);
// The app probes publication.json; an unpacked build legitimately answers 404 there.
const optionalProbe = (url, status) => !publicationPresent && status === 404 && new URL(url).pathname === '/screener/publication.json';
const isLocal = url => { try { const parsed = new URL(url); return parsed.origin === server.origin || ['data:', 'blob:', 'about:'].includes(parsed.protocol); } catch { return false; } };

// The published as-of date, read through the same transport the browser uses.
let expectedDate = null, fallbackSymbol = null;
try {
  const observer = await createDesignAssetObserver({ baseURL: server.url });
  const manifest = observer.manifest, entry = manifest.markets?.US || manifest;
  const researchPath = entry.assets?.research?.path || entry.pages?.scan?.path;
  if (!researchPath) throw Error('The manifest names no research asset');
  const research = decodeResearchIndex(await observer.readJson(researchPath));
  observer.dispose();
  const manifestDate = entry.as_of_date || manifest.as_of_date || null, researchDate = research?.as_of_date ?? research?.date ?? null;
  report.input.packed = observer.packed;
  report.data = { as_of_date: manifestDate, research_as_of_date: researchDate, generated_at: manifest.generated_at ?? null,
    research_generation: manifest.research_generation ?? null, research_rows: Array.isArray(research?.rows) ? research.rows.length : null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifestDate || '')) fail(`Published manifest as-of date is missing or invalid: ${manifestDate}`);
  else if (researchDate !== manifestDate) fail(`Published research as-of date ${researchDate} differs from the manifest as-of date ${manifestDate}`);
  else expectedDate = manifestDate;
  fallbackSymbol = research?.rows?.find(row => /^[A-Z0-9.^-]{1,15}$/.test(row?.symbol || ''))?.symbol || null;
} catch (error) {
  fail(`Published data could not be read through its transport: ${error.message}`);
}
await save();

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const ROWS = '[data-testid="brief-candidate"]';
const CANDLES = '[data-testid="brief-price-chart"] rect.bc-up, [data-testid="brief-price-chart"] rect.bc-down';
const LOADING = /読み込み中|読込中|取得中/;

/** A browser context with the group's device, theme, network fence and error capture. */
async function openSession(group, { reducedMotion = 'no-preference', label = group.key, extraInit } = {}) {
  const context = await browser.newContext({
    viewport: { width: group.width, height: group.height }, deviceScaleFactor: group.mobile ? 2 : 1, isMobile: group.mobile, hasTouch: group.mobile,
    locale: 'ja-JP', colorScheme: group.theme, reducedMotion, serviceWorkers: 'block',
  });
  await context.addInitScript(([key, mode]) => { try { localStorage.setItem(key, mode); } catch { /* opaque origins */ } }, [COLOR_MODE_STORAGE_KEY, group.theme]);
  if (extraInit) await context.addInitScript(extraInit);
  const session = { context, step: 'start', pending: [], blocked: new Set() };
  const record = detail => fail(`${label} [${session.step}]: ${detail}`, session.pending);
  const blockedRequest = url => { if (!session.blocked.has(url)) { session.blocked.add(url); record(`non-local request aborted: ${url}`); } };
  await context.route('**/*', route => {
    const url = route.request().url();
    if (isLocal(url)) return route.continue();
    blockedRequest(url);
    return route.abort('blockedbyclient');
  });
  context.on('request', request => { if (!isLocal(request.url())) blockedRequest(request.url()); });
  context.on('response', response => {
    if (response.status() >= 400 && isLocal(response.url()) && !optionalProbe(response.url(), response.status())) record(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
  });
  const page = await context.newPage();
  page.on('pageerror', error => record(`page error: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const where = message.location()?.url || '';
    // Failed loads are already recorded from the response or the network fence.
    if (/^Failed to load resource/.test(message.text()) && where && (!isLocal(where) || optionalProbe(where, 404) || /status of [45]\d\d/.test(message.text()))) return;
    record(`console error: ${message.text().slice(0, 300)}`);
  });
  session.page = page;
  return session;
}

const go = (page, hash) => page.goto(`${server.url}${hash}`);
const frames = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const hashIs = (page, hash, timeout = 15000) => page.waitForFunction(target => location.hash === target, hash, { timeout });

/** Wait until the brief root exists and no loading text remains; a stuck screen is a failure. */
async function briefReady(page, onFail) {
  await page.locator('.brief[data-theme]').waitFor({ state: 'attached', timeout: 60000 });
  try {
    await page.waitForFunction(source => !new RegExp(source).test(document.querySelector('.brief')?.innerText || ''), LOADING.source, { timeout: 60000 });
  } catch {
    const text = await page.evaluate(source => (document.querySelector('.brief')?.innerText.match(new RegExp(`.{0,30}(${source}).{0,10}`)) || [''])[0], LOADING.source);
    onFail(`still loading after 60s: “${text.trim()}”`);
  }
}

/** Let fonts load and finite animations (CSS, WAAPI and the chart intro) finish before measuring. */
async function settle(page) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming?.().endTime ?? Infinity)), null, { timeout: 8000 }).catch(() => {});
  // The chart's scripted intro marks its end with .bc-pulsing; reduced motion never starts it.
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="brief-price-chart"]')].every(chart => !chart.querySelector('svg') || chart.querySelector('.bc-pulsing') || matchMedia('(prefers-reduced-motion: reduce)').matches), null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(300);
}

// Runs in the page. Hit boxes are effective boxes; inline links inside sentences
// use WCAG's inline exception. Text checks read visible text nodes only.
function briefMetrics({ minTarget, fontSizes, radii }) {
  const root = document.querySelector('.brief');
  if (!root) return { missingRoot: true };
  const path = element => {
    const parts = [];
    for (let node = element; node && node !== document.body && parts.length < 4; node = node.parentElement) {
      const className = typeof node.className === 'string' ? node.className : node.className?.baseVal || '';
      parts.unshift(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${className.trim() ? `.${className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`);
      if (node.id) break;
    }
    return parts.join(' > ');
  };
  const label = element => (element.getAttribute('aria-label') || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const shown = element => {
    const box = element.getBoundingClientRect();
    return box.width > 1 && box.height > 1 && box.right > 0 && box.bottom + scrollY > 0
      && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const elements = [root, ...root.querySelectorAll('*')].filter(shown);
  const interactive = [...root.querySelectorAll('button, a[href], [role="button"], summary, select, textarea, input:not([type="hidden"])')]
    .filter(element => !element.disabled && element.type !== 'range' && !element.closest('[aria-hidden="true"]') && !(element.matches('a') && element.closest('p')));
  const smallTargets = interactive.flatMap(element => {
    const target = element.matches('input[type=checkbox], input[type=radio]') ? element.labels?.[0] || element.closest('label') || element : element;
    if (!shown(target)) return [];
    const box = target.getBoundingClientRect();
    return box.width + 0.1 < minTarget || box.height + 0.1 < minTarget ? [{ selector: path(element), text: label(element), width: Math.round(box.width * 10) / 10, height: Math.round(box.height * 10) / 10 }] : [];
  });
  const ownText = (element, glue) => [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(glue);
  const texted = elements.filter(element => ownText(element, '').trim());
  const fontIssues = texted.flatMap(element => {
    const size = Number.parseFloat(getComputedStyle(element).fontSize);
    return fontSizes.some(value => Math.abs(value - size) < 0.1) ? [] : [{ selector: path(element), text: ownText(element, '').trim().slice(0, 40), size }];
  });
  // A standalone signed number written with the ASCII hyphen (dates and tickers never match).
  const asciiMinus = texted.flatMap(element => /(?:^|[\s(（:：$＄=＝~〜、,])-\$?\d/.test(ownText(element, '')) ? [{ selector: path(element), text: ownText(element, '').trim().slice(0, 60) }] : []);
  const forbidden = /\bNaN\b|\bundefined\b|\bnull\b|(?:^|[^A-Za-z])[-−+$]?Infinity(?=\s*(?:$|[^A-Za-z\s]))/;
  const invalidValues = texted.flatMap(element => forbidden.test(ownText(element, ' ')) ? [{ selector: path(element), text: ownText(element, ' ').trim().slice(0, 60) }] : []);
  const radiusIssues = elements.flatMap(element => {
    const style = getComputedStyle(element), box = element.getBoundingClientRect(), half = Math.min(box.width, box.height) / 2;
    const corners = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius];
    const allowed = corner => {
      const value = Number.parseFloat(corner);
      if (!value) return true;
      if (corner.includes('%')) return value >= 50;
      return radii.some(step => Math.abs(step - value) < 0.1) || value >= half - 0.5;
    };
    return corners.every(allowed) ? [] : [{ selector: path(element), corners: corners.join(' '), width: Math.round(box.width), height: Math.round(box.height) }];
  });
  const height = selector => { const element = [...document.querySelectorAll(selector)].find(shown); return element ? element.getBoundingClientRect().height : 0; };
  const fixedDock = [...document.querySelectorAll('.brief-dock')].find(element => shown(element) && getComputedStyle(element).position === 'fixed');
  const bar = height('.brief-bar'), dock = fixedDock ? fixedDock.getBoundingClientRect().height : 0;
  const barText = document.querySelector('.brief-bar')?.innerText || '';
  return {
    theme: root.dataset.theme, documentTheme: document.documentElement.dataset.theme || null,
    smallTargets, fontIssues, radiusIssues, asciiMinus, invalidValues,
    horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth,
    scrollWidth: document.documentElement.scrollWidth, viewport: { width: innerWidth, height: innerHeight }, pageHeight: document.documentElement.scrollHeight,
    chrome: { bar: Math.round(bar * 10) / 10, dock: Math.round(dock * 10) / 10, total: Math.round((bar + dock) * 10) / 10 },
    analysisDate: barText.match(/分析基準日\s*(\S+)/)?.[1] || null,
    rows: root.querySelectorAll('[data-testid="brief-candidate"]').length,
    candles: root.querySelectorAll('[data-testid="brief-price-chart"] rect.bc-up, [data-testid="brief-price-chart"] rect.bc-down').length,
  };
}

async function runAxe(page) {
  if (!await page.evaluate(() => typeof window.axe?.run === 'function')) await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async tags => {
    const result = await window.axe.run(document.querySelector('.brief'), { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return result.violations.map(violation => ({ id: violation.id, impact: violation.impact, help: violation.help, count: violation.nodes.length,
      nodes: violation.nodes.slice(0, 8).map(node => ({ target: node.target, summary: node.failureSummary })) }));
  }, AXE_TAGS);
}

/** Capture one screen: settle, measure, axe, screenshot; every objective finding blocks. */
async function capture(session, group, screen, path, { requireDate = true } = {}) {
  const { page } = session;
  const key = captureKey(screen, group), screenshot = `${screen}-${group.width}-${group.theme}.png`;
  const entry = { key, path, viewport: { width: group.width, height: group.height, mobile: group.mobile }, theme: group.theme, screenshot, failures: [], metrics: null };
  report.screens.push(entry);
  const flag = detail => fail(`${key}: ${detail}`, entry.failures);
  for (const detail of session.pending.splice(0)) entry.failures.push(detail);
  await briefReady(page, flag);
  await settle(page);
  const metrics = await page.evaluate(briefMetrics, { minTarget: minimumTarget(group.width), fontSizes: FONT_SIZES, radii: RADII });
  if (metrics.missingRoot) { flag('the .brief root is missing'); await page.screenshot({ path: resolve(output, screenshot) }); await save(); return entry; }
  const axe = await runAxe(page);
  await page.screenshot({ path: resolve(output, screenshot) });
  entry.sha256 = sha256(await readFile(resolve(output, screenshot)));
  entry.metrics = { ...metrics, axe };
  if (metrics.theme !== group.theme || metrics.documentTheme !== group.theme) flag(`.brief[data-theme] is ${metrics.theme} (document ${metrics.documentTheme}), expected ${group.theme}`);
  if (axe.length) flag(`axe ${axe.length} rule violations: ${axe.map(item => `${item.id}×${item.count} ${item.nodes[0]?.target?.join(' ') || ''}`).join('; ')}`);
  const sample = (items, describe) => items.slice(0, 6).map(describe).join('; ');
  if (metrics.smallTargets.length) flag(`${metrics.smallTargets.length} hit targets below ${minimumTarget(group.width)}px: ${sample(metrics.smallTargets, item => `${item.selector} “${item.text}” ${item.width}×${item.height}`)}`);
  if (metrics.fontIssues.length) flag(`${metrics.fontIssues.length} font sizes outside [${FONT_SIZES.join(',')}]: ${sample(metrics.fontIssues, item => `${item.selector} ${item.size}px “${item.text}”`)}`);
  if (metrics.radiusIssues.length) flag(`${metrics.radiusIssues.length} corner radii outside [${RADII.join(',')}] or pill: ${sample(metrics.radiusIssues, item => `${item.selector} ${item.corners} (${item.width}×${item.height})`)}`);
  if (metrics.asciiMinus.length) flag(`${metrics.asciiMinus.length} values use the ASCII hyphen as a minus: ${sample(metrics.asciiMinus, item => `${item.selector} “${item.text}”`)}`);
  if (metrics.invalidValues.length) flag(`${metrics.invalidValues.length} visible NaN/undefined/null/Infinity: ${sample(metrics.invalidValues, item => `${item.selector} “${item.text}”`)}`);
  if (metrics.horizontalOverflow) flag(`horizontal page overflow (scrollWidth ${metrics.scrollWidth}px > ${metrics.viewport.width}px)`);
  if (group.width < 768 && metrics.chrome.total > MOBILE_CHROME_BUDGET) flag(`fixed chrome ${metrics.chrome.total}px (bar ${metrics.chrome.bar} + dock ${metrics.chrome.dock}) > ${MOBILE_CHROME_BUDGET}px`);
  if (requireDate) {
    if (!expectedDate) flag('the published as-of date is unknown, so 分析基準日 cannot be verified');
    else if (metrics.analysisDate !== expectedDate) flag(`bar shows 分析基準日 ${metrics.analysisDate ?? '(missing)'}, published as-of date is ${expectedDate}`);
  }
  console.log(`Captured ${key}; ${entry.failures.length} findings.`);
  await save();
  return entry;
}

const functional = (group, check, passed, detail = '') => {
  report.functional.push({ group: group.key, check, passed, detail });
  if (!passed) fail(`${group.key}: functional ${check}: ${detail}`);
};

/** Find a screen with candidate rows: today first, then each list filter. */
async function findCandidates(page) {
  await go(page, '#/brief');
  await briefReady(page, () => {});
  if (await page.locator(ROWS).count()) return { origin: '#/brief', filter: null };
  await go(page, '#/brief/list');
  await briefReady(page, () => {});
  for (const filter of ['買いゾーン', 'ピボット接近', '選定すべて', 'あと1条件']) {
    await page.locator('.brief-seg button', { hasText: filter }).click();
    if (await page.locator(ROWS).count()) return { origin: '#/brief/list', filter };
  }
  return null;
}
async function returnTo(page, found) {
  await go(page, found.origin);
  await briefReady(page, () => {});
  if (found.filter) await page.locator('.brief-seg button', { hasText: found.filter }).click();
  await page.locator(ROWS).first().waitFor({ state: 'visible', timeout: 30000 });
}
const candleCount = page => page.locator(CANDLES).count();
async function waitForCandles(page, minimum, timeout = 30000) {
  await page.waitForFunction(([selector, count]) => document.querySelectorAll(selector).length >= count, [CANDLES, minimum], { timeout }).catch(() => {});
  return candleCount(page);
}
/** Click a row and wait for its stock screen; returns the symbol and the candles drawn. */
async function openRow(page, row) {
  const symbol = await row.getAttribute('data-symbol');
  await row.click();
  await hashIs(page, `#/brief/stock/${encodeURIComponent(symbol)}`);
  await page.locator('[data-testid="brief-conclusion"]').first().waitFor({ state: 'visible', timeout: 30000 });
  return { symbol, candles: await waitForCandles(page, MIN_CANDLES) };
}

async function interrupted(session, group, step, error) {
  fail(`${group.key} [${step}]: interrupted: ${error.message.split('\n')[0]}`);
  await session.page.screenshot({ path: resolve(output, `interrupted-${group.width}-${group.theme}-${step}.png`) }).catch(() => {});
}
async function step(session, group, name, action) {
  session.step = name;
  try { await action(); } catch (error) { await interrupted(session, group, name, error); }
}

const found = {};
try {
  for (const group of DESIGN_GROUPS) {
    const groupEntry = { key: group.key, width: group.width, height: group.height, theme: group.theme, mobile: group.mobile, completed: false, symbol: null, origin: null };
    report.groups.push(groupEntry);
    const session = await openSession(group);
    const { page } = session;
    await step(session, group, 'today', async () => {
      await go(page, '#/brief');
      await capture(session, group, 'today', '#/brief');
    });
    await step(session, group, 'list', async () => {
      await go(page, '#/brief/list');
      await capture(session, group, 'list', '#/brief/list');
    });
    await step(session, group, 'list-near', async () => {
      const near = page.locator('.brief-seg button', { hasText: 'あと1条件' });
      await near.click();
      functional(group, 'list-near-filter-pressed', await near.getAttribute('aria-pressed') === 'true', 'the 「あと1条件」 filter is not pressed after clicking it');
      await capture(session, group, 'list-near', '#/brief/list');
    });
    await step(session, group, 'market', async () => {
      await go(page, '#/brief/market');
      await briefReady(page, detail => fail(`${group.key} [market]: ${detail}`));
      const verdict = page.getByRole('region', { name: '地合い', exact: true });
      const history = page.getByRole('region', { name: '市場環境の推移', exact: true });
      functional(group, 'market-regime-region', await verdict.isVisible(), 'the 「地合い」 region is not visible on #/brief/market');
      // Below 1024px the market screen opens on its first section tab and keeps the long history
      // behind the 推移 tab: capture the screen as it opens, then open 推移 to check the history.
      const historyTab = page.getByRole('tablist', { name: '市場タブの表示' }).locator('#brief-tab-history');
      const tabbed = await historyTab.isVisible();
      if (tabbed) {
        await capture(session, group, 'market', '#/brief/market');
        await historyTab.click();
        functional(group, 'market-history-tab-selected', await historyTab.getAttribute('aria-selected') === 'true', 'the 推移 tab is not selected after clicking it on #/brief/market');
        await history.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      }
      functional(group, 'market-history-section', await history.isVisible(), `the 「市場環境の推移」 section is not visible on #/brief/market${tabbed ? ' after opening its 推移 tab' : ''}`);
      const alert = history.locator('[role="alert"]');
      const alerts = await alert.count(), alertText = alerts ? await alert.first().innerText() : '';
      functional(group, 'market-history-loaded', !alerts, `the 「市場環境の推移」 section shows an error: ${alertText}`);
      if (!tabbed) await capture(session, group, 'market', '#/brief/market');
    });
    await step(session, group, 'stock', async () => {
      const candidates = await findCandidates(page);
      if (!candidates) {
        fail(`${group.key}: the published data has no candidate rows on #/brief or in any #/brief/list filter; stock, stock-weekly and watch cannot be captured`);
        return;
      }
      groupEntry.origin = candidates.origin + (candidates.filter ? ` (${candidates.filter})` : '');
      found[group.width] ||= candidates;
      const { symbol, candles } = await openRow(page, page.locator(ROWS).first());
      groupEntry.symbol = symbol;
      functional(group, 'row-opens-stock', candles >= MIN_CANDLES, `#/brief/stock/${symbol} draws ${candles} candles, needs at least ${MIN_CANDLES}`);
      await capture(session, group, 'stock', `#/brief/stock/${symbol}`, { requireDate: !group.mobile });
      session.step = 'stock-weekly';
      // The weekly range names its real length (「週足（58週）」), so it is found by the leading 週足.
      const weekly = page.locator('.brief-periods button', { hasText: /^週足/ });
      if (!await weekly.count()) fail(`${group.key}: the chart has no 週足 range control; stock-weekly cannot be captured`);
      else {
        await weekly.first().click();
        functional(group, 'weekly-range-pressed', await weekly.first().getAttribute('aria-pressed') === 'true', 'the 週足 range is not pressed after clicking it');
        await page.locator('.brief-legend', { hasText: '10週線' }).first().waitFor({ state: 'attached', timeout: 15000 });
        const weeklyCandles = await waitForCandles(page, 1);
        functional(group, 'weekly-chart-drawn', weeklyCandles > 0, `the weekly chart draws ${weeklyCandles} candles`);
        await capture(session, group, 'stock-weekly', `#/brief/stock/${symbol}`, { requireDate: !group.mobile });
      }
      session.step = 'watch';
      await page.getByRole('button', { name: 'ウォッチに追加', exact: true }).first().click();
      const added = page.getByRole('button', { name: 'ウォッチから外す', exact: true }).first();
      await added.waitFor({ state: 'visible', timeout: 10000 });
      functional(group, 'watch-star-pressed', await added.getAttribute('aria-pressed') === 'true', `☆ for ${symbol} is not pressed after adding`);
      const toast = page.locator('.brief-toast');
      await toast.waitFor({ state: 'visible', timeout: 5000 });
      // Measure the toast at rest, not while its entrance scales it.
      await toast.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => null))));
      functional(group, 'watch-toast', (await toast.innerText()).includes(`${symbol} をウォッチに追加しました`), `the toast reads “${await toast.innerText()}”`);
      const undo = await toast.getByRole('button', { name: '元に戻す' }).boundingBox();
      functional(group, 'watch-toast-undo-target', Boolean(undo) && Math.min(undo.width, undo.height) + 0.1 >= minimumTarget(group.width), `元に戻す is ${undo ? `${Math.round(undo.width)}×${Math.round(undo.height)}` : 'missing'}`);
      await go(page, '#/brief/watch');
      await page.locator(`${ROWS}[data-symbol="${symbol}"]`).waitFor({ state: 'visible', timeout: 15000 });
      await toast.waitFor({ state: 'hidden', timeout: 10000 });
      await capture(session, group, 'watch', '#/brief/watch');
    });
    await step(session, group, 'back', async () => {
      const candidates = found[group.width];
      if (!candidates) { fail(`${group.key}: back cannot be checked without a candidate row`); return; }
      await returnTo(page, candidates);
      const { symbol } = await openRow(page, page.locator(ROWS).first());
      if (group.mobile) await page.getByRole('button', { name: '戻る', exact: true }).click();
      else await page.goBack();
      await hashIs(page, candidates.origin).catch(() => {});
      const back = await page.evaluate(() => location.hash);
      const rows = await page.locator(ROWS).first().isVisible().catch(() => false);
      functional(group, 'back-returns', back === candidates.origin && rows, `after opening ${symbol}, back led to ${back} with rows ${rows ? 'visible' : 'missing'}; expected ${candidates.origin}`);
    });
    await step(session, group, 'theme-toggle', async () => {
      const other = group.theme === 'dark' ? 'light' : 'dark';
      const name = theme => (theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え');
      await page.getByRole('button', { name: name(group.theme), exact: true }).click();
      const flipped = await page.waitForFunction(theme => document.querySelector('.brief')?.dataset.theme === theme && document.documentElement.dataset.theme === theme, other, { timeout: 5000 }).then(() => true, () => false);
      functional(group, 'theme-toggle-flips', flipped, `data-theme did not change to ${other}`);
      await page.getByRole('button', { name: name(other), exact: true }).click();
      const restored = await page.waitForFunction(theme => document.querySelector('.brief')?.dataset.theme === theme, group.theme, { timeout: 5000 }).then(() => true, () => false);
      functional(group, 'theme-toggle-restores', restored, `data-theme did not return to ${group.theme}`);
    });
    await step(session, group, 'legacy-redirects', async () => {
      const symbol = groupEntry.symbol || fallbackSymbol;
      for (const [legacy, target] of LEGACY_REDIRECTS) {
        if (legacy.includes('X') && !symbol) { functional(group, `redirect ${legacy}`, false, 'no published symbol to test the symbol redirect'); continue; }
        const from = legacy.replace('X', symbol), to = target.replace('X', encodeURIComponent(symbol));
        await page.goto('about:blank');
        await page.goto(`${server.url}${from}`);
        const landed = await hashIs(page, to).then(() => true, () => false);
        functional(group, `redirect ${legacy}`, landed, `${from} landed on ${await page.evaluate(() => location.hash)}, expected ${to}`);
      }
    });
    session.step = 'end';
    await session.context.close();
    groupEntry.completed = true;
    await save();
  }

  // Reduced motion: once per width, nothing may still run shortly after opening a stock.
  for (const width of TIMING.widths) {
    const group = DESIGN_GROUPS.find(item => item.width === width && item.theme === 'dark');
    const session = await openSession(group, { reducedMotion: 'reduce', label: `${width}/reduced-motion` });
    const entry = { width, settle_ms: REDUCED_MOTION_SETTLE_MS, symbol: null, running: null };
    report.reduced_motion.push(entry);
    try {
      const candidates = found[width];
      if (!candidates) fail(`${width}/reduced-motion: no candidate row to open, so reduced motion cannot be verified`);
      else {
        await returnTo(session.page, candidates);
        const { symbol } = await openRow(session.page, session.page.locator(ROWS).first());
        entry.symbol = symbol;
        await session.page.waitForTimeout(REDUCED_MOTION_SETTLE_MS);
        entry.running = await session.page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').map(animation => {
          const target = animation.effect?.target;
          return `${animation.animationName || animation.transitionProperty || animation.id || 'animation'} on ${target?.tagName?.toLowerCase() || 'pseudo'}${typeof target?.className === 'string' && target.className ? `.${target.className.split(' ')[0]}` : ''}`;
        }));
        if (entry.running.length) fail(`${width}/reduced-motion: ${entry.running.length} animations still running ${REDUCED_MOTION_SETTLE_MS}ms after opening ${symbol}: ${entry.running.slice(0, 6).join('; ')}`);
      }
    } catch (error) { fail(`${width}/reduced-motion: interrupted: ${error.message.split('\n')[0]}`); }
    await session.context.close();
    await save();
  }

  // CPU 4x timing. Overruns are deferred warnings; a run that cannot be measured is a warning too.
  for (const width of TIMING.widths) {
    const group = DESIGN_GROUPS.find(item => item.width === width && item.theme === 'dark');
    const session = await openSession(group, { label: `${width}/timing`, extraInit: () => {
      window.__briefLongTasks = [];
      try { new PerformanceObserver(list => { for (const item of list.getEntries()) window.__briefLongTasks.push(item.duration); }).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
    } });
    const { page } = session, runs = [], notes = [];
    try {
      if (found[width]?.origin !== '#/brief') notes.push('no candidate rows on #/brief in this data; the first-candidate and stock-open timings cannot be measured');
      else {
        await go(page, '#/brief');
        await page.locator(ROWS).first().waitFor({ state: 'visible', timeout: 60000 });
        const cdp = await session.context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: TIMING.cpu_rate });
        for (let index = 0; index < TIMING.runs; index++) {
          session.step = `run ${index + 1}`;
          const run = {};
          await page.goto('about:blank');
          let start = Date.now();
          await go(page, '#/brief');
          await page.locator(ROWS).first().waitFor({ state: 'visible', timeout: 60000 });
          await frames(page);
          run.first_candidate_ms = Date.now() - start;
          run.longest_initial_task_ms = await page.evaluate(() => Math.max(0, ...(window.__briefLongTasks || [])));
          start = Date.now();
          await page.locator('nav.brief-tabs a', { hasText: '候補' }).click();
          await page.waitForFunction(() => location.hash === '#/brief/list' && [...document.querySelectorAll('.brief-stack h1')].some(heading => heading.textContent.trim() === '候補'), null, { timeout: 30000 });
          await frames(page);
          run.tab_switch_ms = Date.now() - start;
          await page.locator('nav.brief-tabs a', { hasText: '今日' }).click();
          await page.locator(ROWS).first().waitFor({ state: 'visible', timeout: 30000 });
          await settle(page);
          const rows = page.locator(ROWS), row = !group.mobile && await rows.count() > 1 ? rows.nth(1) : rows.first();
          const symbol = await row.getAttribute('data-symbol');
          start = Date.now();
          await row.click();
          await page.waitForFunction(([ticker, selector]) => location.hash === `#/brief/stock/${encodeURIComponent(ticker)}`
            && [...document.querySelectorAll('.brief-stockhead h2 span:first-child, .brief-bar-title b span')].some(element => element.textContent.trim() === ticker)
            && document.querySelector('[data-testid="brief-conclusion"]') && document.querySelectorAll(selector).length > 0, [symbol, CANDLES], { timeout: 30000 });
          await frames(page);
          run.stock_open_ms = Date.now() - start;
          run.symbol = symbol;
          runs.push(run);
          console.log(`CPU${TIMING.cpu_rate} ${width} run ${index + 1}: first candidate ${run.first_candidate_ms}ms, tab ${run.tab_switch_ms}ms, stock ${run.stock_open_ms}ms (${symbol}), long task ${Math.round(run.longest_initial_task_ms)}ms.`);
        }
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      }
    } catch (error) { notes.push(`timing interrupted: ${error.message.split('\n')[0]}`); }
    const { medians, warnings } = summarizeTiming(width, runs);
    report.timing.push({ width, theme: group.theme, cpu_rate: TIMING.cpu_rate, budgets_ms: TIMING.budgets_ms, runs, medians, notes });
    report.timing_warnings.push(...notes.map(note => `${width}: ${note}`), ...warnings);
    await session.context.close();
    await save();
  }
} finally {
  await browser.close().catch(() => {});
  await server.close();
}

// Completeness: every group finished and every required capture exists with a non-empty PNG.
for (const key of requiredCaptureKeys()) {
  const screens = report.screens.filter(screen => screen.key === key);
  if (screens.length !== 1) { fail(`${key}: ${screens.length ? 'captured more than once' : 'required capture was not completed'}`); continue; }
  const size = await stat(resolve(output, screens[0].screenshot)).then(info => info.size, () => 0);
  if (!size) fail(`${key}: screenshot ${screens[0].screenshot} is missing or empty`);
}
for (const group of DESIGN_GROUPS) if (!report.groups.find(item => item.key === group.key)?.completed) fail(`${group.key}: group did not complete`);
await save();
for (const warning of report.timing_warnings) console.log(`::warning title=Deferred measured timing::${warning}`);
console.log(JSON.stringify({ schema: REPORT_SCHEMA, commit, screens: report.screens.length, functional: `${report.functional.filter(item => item.passed).length}/${report.functional.length}`,
  failures: report.failures.length, timing: report.timing.map(({ width, medians }) => ({ width, ...medians })), timing_warnings: report.timing_warnings.length }, null, 2));
if (report.failures.length) process.exitCode = 1;
