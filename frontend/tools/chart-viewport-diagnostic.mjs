// Separate CI diagnostics, never one of the three acceptance measurements.
// There is no latency threshold; completeness/provenance failures exit nonzero
// and block this experiment in CI without changing the official budget gates.
// Importing the pure helpers does not launch a browser or bypass the CI guard.
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { palettes } from '../src/static/theme/tokens.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const SECTION = '.research-detail .research-chart';
const READY = '.candidate-row, .research-list tbody tr';
const DEFAULT_TIMEOUT = 15000;
const rgb = hex => [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));

// Preserve the source MIME type during immutable replay: static-data also
// contains image/svg+xml price traces, not only JSON payloads.
export function captureStaticAsset(body, headers) {
  const contentType = Object.entries(headers || {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
  return { body, hash: sha256(body), content_type: contentType || null };
}

export function replayStaticAsset(asset) {
  return { status: 200, body: asset.body, headers: asset.content_type ? { 'content-type': asset.content_type } : {} };
}

// Pure geometry shared by browser sampling and tests. Hidden/offscreen/nonfixed
// navigation cannot shorten the visible bitmap; actual fixed overlap must.
export function pricePaneViewportBottom(viewportHeight, pane, nav) {
  const bottom = Math.min(pane.bottom, viewportHeight);
  if (!nav || nav.hidden || nav.position !== 'fixed' || nav.display === 'none' || ['hidden', 'collapse'].includes(nav.visibility) || nav.opacity === 0
    || !(nav.width > 0 && nav.height > 0) || nav.bottom <= 0 || nav.top >= bottom || nav.right <= pane.left || nav.left >= pane.right) return bottom;
  return Math.max(0, Math.min(bottom, nav.top));
}

function readMobileNav() {
  const node = document.querySelector('.leader-mobile-nav');
  if (!node) return null;
  const box = node.getBoundingClientRect(), style = getComputedStyle(node);
  let hidden = false;
  for (let parent = node; parent; parent = parent.parentElement) {
    const parentStyle = getComputedStyle(parent);
    if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || parentStyle.display === 'none' || ['hidden', 'collapse'].includes(parentStyle.visibility) || Number(parentStyle.opacity) === 0) { hidden = true; break; }
  }
  return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height,
    position: style.position, display: style.display, visibility: style.visibility, opacity: Number(style.opacity), hidden };
}

export function assertDiagnosticCI(env = process.env) {
  if (!env.CI || /^(false|0)$/i.test(env.CI)) throw Error('Run this browser diagnostic in GitHub Actions, not on the desktop host.');
}

// Plain numeric snapshot, also used by the browser probe. Keep document and
// viewport coordinates together so scrolling is distinguishable from reflow.
export function sectionLayoutSnapshot(rect, scrollY, documentHeight) {
  const valid = rect && ['top', 'bottom', 'width', 'height'].every(key => Number.isFinite(rect[key]));
  return { scroll_y: Number.isFinite(scrollY) ? scrollY : null, document_height: Number.isFinite(documentHeight) ? documentHeight : null,
    section: valid ? { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height,
      document_top: Number.isFinite(scrollY) ? rect.top + scrollY : null } : null };
}

function readSectionLayout(section) {
  return window.__chartViewportDiagnostic.sectionLayoutSnapshot(document.querySelector(section)?.getBoundingClientRect(), window.scrollY,
    Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0));
}

export function parseVisibleRange(text) {
  const match = /^(\d{4}-\d{2}-\d{2})\s*～\s*(\d{4}-\d{2}-\d{2})$/.exec(text?.trim() || '');
  if (!match || match.slice(1).some(date => !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) || match[1] > match[2]) return null;
  return { from: match[1], to: match[2] };
}

// No DOM/browser dependencies: the same function is serialized into the probe.
// Read every pixel, without resampling (which could invent/blend candle colors).
export function inspectPriceBitmap(bytes, width, height, colors) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || bytes?.length !== width * height * 4) return null;
  let hash = 2166136261, up = 0, down = 0;
  const columns = new Set();
  const [upR, upG, upB] = colors.up, [downR, downG, downB] = colors.down;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    for (let channel = 0; channel < 4; channel++) hash = Math.imul(hash ^ bytes[offset + channel], 16777619) >>> 0;
    if (bytes[offset + 3] !== 255) continue;
    const r = bytes[offset], g = bytes[offset + 1], b = bytes[offset + 2];
    if (r === upR && g === upG && b === upB) { up++; columns.add((offset / 4) % width); }
    if (r === downR && g === downG && b === downB) { down++; columns.add((offset / 4) % width); }
  }
  return { width, height, fingerprint: `${width}x${height}:${hash.toString(16).padStart(8, '0')}`, up_pixels: up, down_pixels: down, candle_columns: columns.size };
}

export function isPaintedSample(sample, expected) {
  if (!sample || sample.error || !sample.visible || !sample.hit_test || sample.symbol !== expected.symbol || sample.as_of_date !== expected.as_of_date) return false;
  const range = parseVisibleRange(sample.range);
  if (!range || range.to > expected.as_of_date || (expected.exact_range && sample.range !== expected.exact_range) || (expected.previous_range && sample.range === expected.previous_range)) return false;
  const bars = expected.bars.filter(bar => bar.date >= range.from && bar.date <= range.to);
  if (!bars.length || range.from < expected.bars[0].date) return false;
  const bitmap = sample.bitmap;
  if (!bitmap?.fingerprint || bitmap.up_pixels + bitmap.down_pixels < 8 || bitmap.candle_columns < 2) return false;
  if (bars.some(bar => bar.close >= bar.open) && !bitmap.up_pixels) return false;
  if (bars.some(bar => bar.close < bar.open) && !bitmap.down_pixels) return false;
  return !expected.previous_fingerprint || bitmap.fingerprint !== expected.previous_fingerprint;
}

export function stablePaintPair(previous, current, expected) {
  return Boolean(isPaintedSample(previous, expected) && isPaintedSample(current, expected)
    && current.frame === previous.frame + 1 && current.at_ms > previous.at_ms
    && current.range === previous.range && current.bitmap.fingerprint === previous.bitmap.fingerprint);
}

export function summarizePhaseObservations(observation, start, end) {
  if (!observation || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const complete = observation.supported?.longtask && observation.supported?.['layout-shift'] && !observation.truncated;
  const tasks = observation.tasks.filter(item => item.start < end && item.start + item.duration > start);
  const shifts = observation.shifts.filter(item => item.start >= start && item.start <= end);
  return { complete: Boolean(complete), supported: observation.supported, truncated: observation.truncated,
    longtasks: observation.supported?.longtask ? tasks : null,
    longest_longtask_ms: observation.supported?.longtask ? Math.max(0, ...tasks.map(item => item.duration)) : null,
    overlapping_longtask_ms: observation.supported?.longtask ? tasks.reduce((sum, item) => sum + Math.max(0, Math.min(end, item.start + item.duration) - Math.max(start, item.start)), 0) : null,
    layout_shifts: observation.supported?.['layout-shift'] ? shifts : null,
    layout_shift_sum: observation.supported?.['layout-shift'] ? shifts.reduce((sum, item) => sum + item.value, 0) : null,
    layout_shift_without_recent_input: observation.supported?.['layout-shift'] ? shifts.filter(item => !item.had_recent_input).reduce((sum, item) => sum + item.value, 0) : null };
}

export function assertSameSnapshot(baseline, current) {
  const required = ['symbol', 'as_of_date', 'manifest_sha256', 'research_sha256', 'chart_sha256'];
  for (const key of required) {
    if (!baseline?.[key] || !current?.[key]) throw Error(`Missing snapshot evidence: ${key}`);
    if (baseline[key] !== current[key]) throw Error(`Baseline/current snapshots differ: ${key}; comparison is invalid`);
  }
  for (const key of required.filter(key => key.endsWith('_sha256'))) if (!/^[a-f0-9]{64}$/.test(baseline[key])) throw Error(`Invalid snapshot hash: ${key}`);
  return true;
}

function installObserver() {
  const diagnostic = window.__chartViewportDiagnostic;
  diagnostic.observation = { supported: {}, truncated: false, tasks: [], shifts: [] };
  diagnostic.observers = [];
  for (const type of ['longtask', 'layout-shift']) {
    const supported = PerformanceObserver.supportedEntryTypes.includes(type);
    diagnostic.observation.supported[type] = supported;
    if (!supported) continue;
    const accept = entries => {
      const target = type === 'longtask' ? diagnostic.observation.tasks : diagnostic.observation.shifts;
      for (const entry of entries) {
        if (target.length >= 2000) { diagnostic.observation.truncated = true; continue; }
        target.push(type === 'longtask' ? { start: entry.startTime, duration: entry.duration } : { start: entry.startTime, value: entry.value, had_recent_input: entry.hadRecentInput });
      }
    };
    const observer = new PerformanceObserver(list => accept(list.getEntries()));
    observer.observe({ type, buffered: true });
    diagnostic.observers.push({ observer, accept });
  }
  document.addEventListener('scroll', () => {
    if (diagnostic.active && diagnostic.active.trigger === 'scroll' && diagnostic.active.event_ms == null) diagnostic.active.event_ms = performance.now();
  }, { capture: true, passive: true });
  document.addEventListener('click', event => {
    const button = event.target.closest?.('button');
    if (!button || !diagnostic.active || diagnostic.active.trigger !== 'click' || button.textContent.trim() !== diagnostic.active.button_name) return;
    diagnostic.active.event_ms = performance.now();
    diagnostic.active.canvas_present_at_event = Boolean(document.querySelector(`${diagnostic.active.section} [data-chart-symbol] canvas`));
  }, true);
}

// The first row's CENTER cell is price-pane content, excluding price/date axes,
// RS/volume panes, and the transparent crosshair canvas layered above it.
function readPricePane({ section, colors, max_pixels }) {
  const diagnostic = window.__chartViewportDiagnostic, start = performance.now();
  try {
    const node = document.querySelector(`${section} [data-chart-symbol]`);
    const cell = node?.querySelector('.tv-lightweight-charts > table')?.rows[0]?.cells[1];
    const canvas = cell?.querySelector('canvas');
    const range = document.querySelector(`${section} [data-testid="chart-visible-range"]`)?.textContent?.trim() || '';
    const base = { at_ms: start, symbol: node?.dataset.chartSymbol, as_of_date: node?.dataset.chartAsof, range, visible: false, hit_test: false };
    if (!canvas || !canvas.width || !canvas.height) return base;
    const box = canvas.getBoundingClientRect();
    const headerBottom = document.querySelector('.leader-header')?.getBoundingClientRect().bottom || 0;
    let left = Math.max(box.left, 0), right = Math.min(box.right, innerWidth), top = Math.max(box.top, headerBottom), bottom = diagnostic.pricePaneViewportBottom(innerHeight, box, diagnostic.readMobileNav());
    for (let parent = canvas; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || parent.hidden || parent.getAttribute('aria-hidden') === 'true') return base;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
    }
    base.visible = right > left && bottom > top;
    // Only sample the visible portion; an offscreen rendered bitmap cannot pass.
    if (!base.visible) return base;
    base.hit_test = [.25, .5, .75].every(fraction => cell.contains(document.elementFromPoint(left + (right - left) * fraction, top + (bottom - top) / 2)));
    const sx = canvas.width / box.width, sy = canvas.height / box.height;
    const x = Math.max(0, Math.ceil((left - box.left) * sx)), y = Math.max(0, Math.ceil((top - box.top) * sy));
    const width = Math.min(canvas.width - x, Math.floor((right - left) * sx)), height = Math.min(canvas.height - y, Math.floor((bottom - top) * sy));
    if (width <= 0 || height <= 0) return base;
    if (width * height > max_pixels) return { ...base, error: 'Price bitmap exceeds diagnostic pixel bound' };
    const bytes = canvas.getContext('2d').getImageData(x, y, width, height).data;
    return { ...base, bitmap: diagnostic.inspectPriceBitmap(bytes, width, height, colors), sample_ms: performance.now() - start };
  } catch (error) { return { at_ms: start, error: error.message, sample_ms: performance.now() - start }; }
}

function startPaintProbe(options) {
  const diagnostic = window.__chartViewportDiagnostic;
  if (diagnostic.active?.running) throw Error('A chart paint probe is already running');
  const state = diagnostic.active = { ...options, invocation_ms: performance.now(), event_ms: null, running: true, frames: 0, sampling_ms: 0, max_sample_ms: 0, result: null };
  let previous = null;
  const read = () => { const start = performance.now(); const value = diagnostic.readPricePane(options); return { ...value, sample_ms: performance.now() - start }; };
  state.before = read();
  state.layout_before = diagnostic.readSectionLayout(options.section);
  state.node_before = document.querySelector(`${options.section} [data-chart-symbol]`);
  state.done = new Promise(resolve => {
    const finish = (status, sample) => {
      if (!state.running) return;
      state.running = false;
      clearTimeout(timer);
      cancelAnimationFrame(state.raf);
      for (const { observer, accept } of diagnostic.observers) accept(observer.takeRecords());
      const layoutAfter = diagnostic.readSectionLayout(options.section);
      state.result = { status, layout: { before: state.layout_before, after: layoutAfter }, invocation_ms: state.invocation_ms, event_ms: state.event_ms,
        canvas_present_at_event: state.canvas_present_at_event ?? null, before: state.before,
        first_qualifying_frame_ms: status === 'observed' ? previous.at_ms : null,
        confirmed_at_ms: performance.now(), frames: state.frames, before_sampling_ms: state.before.sample_ms || 0, sampling_ms: state.sampling_ms, max_sample_ms: state.max_sample_ms,
        sample, same_node: Boolean(state.node_before && state.node_before === document.querySelector(`${options.section} [data-chart-symbol]`)),
        observation: diagnostic.observation };
      resolve(state.result);
    };
    const tick = () => {
      if (!state.running) return;
      const sample = read(); sample.frame = ++state.frames;
      state.sampling_ms += sample.sample_ms || 0;
      state.max_sample_ms = Math.max(state.max_sample_ms, sample.sample_ms || 0);
      if (sample.error) return finish('unavailable', sample);
      if (state.event_ms != null && diagnostic.stablePaintPair(previous, sample, options.expected)) return finish('observed', sample);
      previous = sample;
      state.raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => finish('timeout', previous), options.timeout_ms);
    state.raf = requestAnimationFrame(tick);
  });
}

async function installProbe(page) {
  const functions = { pricePaneViewportBottom, readMobileNav, sectionLayoutSnapshot, readSectionLayout, inspectPriceBitmap, parseVisibleRange, isPaintedSample, stablePaintPair, readPricePane, startPaintProbe, installObserver };
  // Function bodies are our own checked-in source, not fetched page content.
  const content = `${Object.values(functions).map(fn => fn.toString()).join('\n')}\nwindow.__chartViewportDiagnostic = { ${Object.keys(functions).join(', ')} }; installObserver();`;
  await page.addInitScript({ content });
}

async function snapshot(request, serverUrl, symbol, supplied) {
  const assets = new Map();
  const get = async path => {
    const response = await request.get(new URL(`static-data/${path}`, serverUrl).href, { timeout: DEFAULT_TIMEOUT });
    if (!response.ok()) throw Error(`${path}: HTTP ${response.status()}`);
    const bytes = await response.body(); assets.set(path, captureStaticAsset(bytes, response.headers()));
    return JSON.parse(bytes.toString('utf8'));
  };
  const manifest = await get('manifest.json'), entry = manifest.markets?.US || manifest;
  if (!entry.assets?.research?.path) throw Error('Published research path is missing');
  const research = await get(entry.assets.research.path), row = decodeResearchIndex(research).rows.find(row => row.symbol === symbol);
  if (!row?.chart_path) throw Error(`Published chart is missing for ${symbol}`);
  const payload = await get(row.chart_path);
  if (payload.symbol !== symbol || payload.as_of_date !== entry.as_of_date || !payload.bars?.length || payload.bars.at(-1).date !== entry.as_of_date || payload.bars.some((bar, i) => ![bar.open, bar.close, bar.high, bar.low].every(Number.isFinite) || (i && bar.date <= payload.bars[i - 1].date))) throw Error('Selected chart payload identity or bars are invalid');
  const evidence = { symbol, as_of_date: entry.as_of_date, manifest_sha256: assets.get('manifest.json').hash,
    research_path: entry.assets.research.path, research_sha256: assets.get(entry.assets.research.path).hash,
    chart_path: row.chart_path, chart_sha256: assets.get(row.chart_path).hash, supplied: supplied || null };
  for (const key of ['symbol', 'as_of_date', 'manifest_sha256', 'research_sha256', 'chart_sha256']) if (supplied?.[key] && supplied[key] !== evidence[key]) throw Error(`Supplied provenance differs from fetched snapshot: ${key}`);
  return { evidence, assets, bars: payload.bars.map(({ date, open, close }) => ({ date, open, close })) };
}

function validateBounds({ timeoutMs, viewport }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw Error('Diagnostic timeout must be 100–60000 ms');
  if (!Number.isInteger(viewport?.width) || !Number.isInteger(viewport?.height) || viewport.width < 200 || viewport.height < 200 || viewport.width > 2560 || viewport.height > 1600) throw Error('Diagnostic viewport must fit the bounded 200–2560 by 200–1600 range');
}

async function capturePhase({ page, capture, output, context, phase, result }) {
  const name = `${context.label}-${context.viewport.width}-${context.action}-${phase}`;
  if (capture) return capture({ page, output, name, phase, result, ...context });
  const filename = `${name}.png`, bytes = await page.screenshot({ path: resolve(output, filename), timeout: DEFAULT_TIMEOUT });
  return { filename, sha256: sha256(bytes), captured_after_measurement: true };
}

async function measureAction({ page, trigger, buttonName, perform, expected, context, phase, output, capture, timeoutMs }) {
  await page.evaluate(options => window.__chartViewportDiagnostic.startPaintProbe(options), {
    section: SECTION, colors: { up: rgb(palettes[context.theme].up), down: rgb(palettes[context.theme].down) },
    max_pixels: 1000000, timeout_ms: timeoutMs, trigger, button_name: buttonName, expected,
  });
  let actionError = null;
  try { await perform(); } catch (error) { actionError = error.message; }
  const result = await page.evaluate(async () => {
    const diagnostic = window.__chartViewportDiagnostic;
    const result = await diagnostic.active.done;
    // The final rAF's own longtask is only observable once its task ends.
    // Drain in a later task without moving the original latency endpoint.
    await new Promise(resolve => setTimeout(resolve, 0));
    for (const { observer, accept } of diagnostic.observers) accept(observer.takeRecords());
    return { ...result, observation: structuredClone(diagnostic.observation) };
  });
  result.action_error = actionError;
  result.elapsed_from_invocation_ms = result.confirmed_at_ms - result.invocation_ms;
  result.event_to_confirmed_ms = result.event_ms == null ? null : result.confirmed_at_ms - result.event_ms;
  result.metrics = summarizePhaseObservations(result.observation, result.event_ms, result.confirmed_at_ms);
  delete result.observation;
  if (actionError) result.status = 'unavailable';
  try {
    result.screenshot = await capturePhase({ page, capture, output, context, phase, result });
    if (!result.screenshot) throw Error('Capture returned no screenshot artifact metadata');
  } catch (error) { result.screenshot_error = error.message; }

  return result;
}

/** Called AFTER official measurement loops. Caller owns browser and servers.
 * capture is optional ({ page, output, name, phase, result, label, viewport,
 * action, theme, ...captureContext }) => artifact metadata. It runs AFTER timing.
 */
export async function runChartViewportDiagnostics({ browser, baselineUrl, currentUrl, output, symbol = 'ADI', viewport = { width: 1440, height: 900 }, theme = 'dark', timeoutMs = DEFAULT_TIMEOUT, provenance = {}, capture, captureContext = {} }) {
  assertDiagnosticCI(); validateBounds({ timeoutMs, viewport });
  if (!browser || !baselineUrl || !currentUrl || !output || !palettes[theme]) throw Error('Browser, baseline/current server URLs, output, and a valid theme are required');
  await mkdir(output, { recursive: true });
  const report = { kind: 'chart-viewport-diagnostic', acceptance_gate: false, cpu_rate: 4, viewport, theme, symbol,
    clock: 'Actual browser performance.now/Date.now; no historical override', measured_at: new Date().toISOString(),
    method: 'Separate fresh contexts. Scroll is the shared action. Request path is separate. Readable candle raster + populated range + two consecutive rAF observations; conservative endpoint, not compositor presentation time.',
    limitations: ['Full visible price-pane readback/hash changes rendering cost; sampling overhead is reported and remains in latency/longtasks.', 'Visible-range text has an existing 100 ms debounce; this is included.', 'Screenshot is captured after timing and requires visual review. Exact colors/fingerprint are evidence, not pixel-perfect candle validation.', 'Missing trigger, unsupported observer, timeout, changed data, or truncated observations never imply success. No existing threshold is changed.'],
    data: {}, runs: [], errors: [], comparison_valid: false };
  const snapshots = {}, observed = { baseline: new Map(), current: new Map() };
  const urls = { baseline: baselineUrl, current: currentUrl };
  const preflight = await browser.newContext({ serviceWorkers: 'block' });
  try {
    for (const label of ['baseline', 'current']) {
      snapshots[label] = await snapshot(preflight.request, urls[label], symbol, provenance[label]);
      report.data[label] = snapshots[label].evidence;
    }
    assertSameSnapshot(report.data.baseline, report.data.current);
    for (const label of ['baseline', 'current']) for (const action of ['scroll', 'request']) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block' });
      const run = { label, action, phases: {}, errors: [], complete: false };
      report.runs.push(run);
      const caseTimer = setTimeout(() => { run.errors.push('Diagnostic case exceeded 60 seconds'); context.close().catch(() => {}); }, 60000);
      try {
        const dataPrefix = new URL('static-data/', urls[label]).href;
        const locked = new Map(snapshots[label].assets);
        await context.route(`${dataPrefix}**`, async route => {
          const path = route.request().url().slice(dataPrefix.length);
          try {
            if (!locked.has(path)) {
              const response = await route.fetch({ timeout: timeoutMs }), body = await response.body();
              if (!response.ok()) throw Error(`HTTP ${response.status()}`);
              locked.set(path, captureStaticAsset(body, response.headers()));
            }
            const asset = locked.get(path);
            const previous = observed[label].get(path);
            if (previous && previous !== asset.hash) throw Error('Data changed between diagnostic contexts');
            observed[label].set(path, asset.hash);
            await route.fulfill(replayStaticAsset(asset));
          } catch (error) { run.errors.push(`${path}: ${error.message}`); await route.abort().catch(() => {}); }
        });
        const page = await context.newPage();
        page.setDefaultTimeout(timeoutMs); page.setDefaultNavigationTimeout(timeoutMs);
        await installProbe(page);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await page.goto(`${urls[label]}#/?symbol=${encodeURIComponent(symbol)}`);
        await page.locator(SECTION).waitFor({ state: 'visible' });
        if ((await page.locator('.symbol-title h2').textContent())?.trim() !== symbol) throw Error('Selected detail symbol does not match the snapshot');
        if (await page.locator('.leader-shell').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: theme === 'light' ? 'ライトモードに切り替え' : 'ダークモードに切り替え', exact: true }).click();
        const expected = { symbol, as_of_date: snapshots[label].evidence.as_of_date, bars: snapshots[label].bars };
        const captureInfo = { ...captureContext, label, viewport, action, theme, symbol };
        const section = page.locator(SECTION), request = section.getByRole('button', { name: '日次チャートを表示', exact: true });
        if (action === 'request') await page.waitForFunction(section => {
          const root = document.querySelector(section);
          return Boolean(root?.querySelector('[data-chart-symbol] canvas') || [...(root?.querySelectorAll('button') || [])].some(button => button.textContent.trim() === '日次チャートを表示'));
        }, SECTION, { timeout: timeoutMs });
        if (action === 'request' && !await request.count()) {
          run.status = 'not_applicable';
          run.unsupported = 'No display button at the measurement boundary: the chart is eager or already mounted. No display-request latency was measured.';
          continue;
        }
        const common = { page, expected, context: captureInfo, output, capture, timeoutMs };
        run.phases.initial = await measureAction({ ...common, phase: 'initial', trigger: action === 'scroll' ? 'scroll' : 'click', buttonName: '日次チャートを表示', perform: () => action === 'scroll' ? section.scrollIntoViewIfNeeded() : request.click() });
        if (action === 'request' && run.phases.initial.event_ms == null && await section.locator('[data-chart-symbol] canvas').count()) {
          run.phases.initial.status = 'auto_activated_before_request';
          run.unsupported = 'Normal click approached the viewport and mounted the chart before a display-button click was observed; no request latency was measured.';
        }
        if (run.phases.initial.status !== 'observed') continue;
        const initial = run.phases.initial.sample;
        run.phases.first_range = await measureAction({ ...common, phase: 'first-range', trigger: 'click', buttonName: '1か月', expected: { ...expected, previous_range: initial.range, previous_fingerprint: initial.bitmap.fingerprint }, perform: () => section.getByRole('button', { name: '1か月', exact: true }).click() });
        if (run.phases.first_range.status !== 'observed') continue;
        const selectedRange = run.phases.first_range.sample.range;
        await page.locator('.symbol-title').scrollIntoViewIfNeeded();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        run.range_while_away = await section.getByTestId('chart-visible-range').textContent();
        run.phases.warm_return = await measureAction({ ...common, phase: 'warm-return', trigger: 'scroll', expected: { ...expected, exact_range: selectedRange }, perform: () => section.scrollIntoViewIfNeeded() });
        run.range_retained = run.range_while_away?.trim() === selectedRange && run.phases.warm_return.sample?.range === selectedRange && run.phases.warm_return.same_node;
        run.complete = !run.errors.length && run.range_retained && Object.values(run.phases).every(phase => phase.status === 'observed' && phase.metrics?.complete && Boolean(phase.screenshot) && !phase.screenshot_error);
      } catch (error) { run.errors.push(error.message); }
      finally { clearTimeout(caseTimer); await context.close(); }
    }
    // Verify the union of ALL data paths consumed in either run against BOTH
    // servers. A matching symbol/date alone does not establish same data.
    report.consumed_data = [];
    for (const path of new Set([...observed.baseline.keys(), ...observed.current.keys()])) {
      const hashes = {};
      for (const label of ['baseline', 'current']) {
        const response = await preflight.request.get(new URL(`static-data/${path}`, urls[label]).href, { timeout: timeoutMs });
        if (!response.ok()) throw Error(`${label} missing consumed data ${path}`);
        hashes[label] = sha256(await response.body());
        if (observed[label].has(path) && observed[label].get(path) !== hashes[label]) throw Error(`${label} data changed during diagnostic: ${path}`);
      }
      report.consumed_data.push({ path, ...hashes });
      if (hashes.baseline !== hashes.current) throw Error(`Baseline/current consumed data differ: ${path}`);
    }
    report.comparison_valid = report.consumed_data.length > 0 && ['baseline', 'current'].every(label => report.runs.find(run => run.label === label && run.action === 'scroll')?.complete);
    report.scroll_comparison = report.comparison_valid ? Object.fromEntries(['baseline', 'current'].map(label => [label, report.runs.find(run => run.label === label && run.action === 'scroll').phases.initial.event_to_confirmed_ms])) : null;
    report.request_comparison = null; // Eager charts have no display-request action.
  } catch (error) { report.errors.push(error.message); }
  finally {
    await preflight.close();
    await writeFile(resolve(output, `chart-viewport-${viewport.width}-${theme}.json`), JSON.stringify(report, null, 2));
  }
  return report;
}

function intervalUnion(intervals) {
  let total = 0, end = -Infinity;
  for (const [start, nextEnd] of intervals.sort((a, b) => a[0] - b[0])) { total += Math.max(0, nextEnd - Math.max(start, end)); end = Math.max(end, nextEnd); }
  return total;
}

export function summarizeTimeline(events, { truncated = false } = {}) {
  const groups = { Layout: ['Layout'], UpdateLayoutTree: ['UpdateLayoutTree'], Paint: ['Paint'], JavaScript: ['FunctionCall', 'EvaluateScript', 'RunMicrotasks', 'V8.Execute', 'v8.run'] };
  const threads = new Map(), names = new Map();
  for (const event of events) {
    if (event.ph === 'M' && event.name === 'thread_name') names.set(`${event.pid}:${event.tid}`, event.args?.name);
    if (event.ph !== 'X' || !Number.isFinite(event.ts) || !Number.isFinite(event.dur) || event.dur < 0) continue;
    if (!Object.values(groups).some(members => members.includes(event.name))) continue;
    const thread = `${event.pid}:${event.tid}`;
    if (!threads.has(thread)) threads.set(thread, {});
    for (const [group, members] of Object.entries(groups)) if (members.includes(event.name)) (threads.get(thread)[group] ||= []).push([event.ts, event.ts + event.dur]);
  }
  return { complete: !truncated && threads.size > 0, truncated, unit: 'ms', method: 'Union of complete X-event intervals per category/thread; categories can overlap and must not be summed. No total-CPU attribution.',
    threads: [...threads].map(([thread, categories]) => ({ thread, name: names.get(thread) || null, categories: Object.fromEntries(Object.keys(groups).map(group => [group, categories[group] ? { events: categories[group].length, union_ms: intervalUnion(categories[group]) / 1000 } : null])) })) };
}

/** Optional, separately invoked tracing pass; never call inside budget loops. */
export async function captureResearchTimeline({ browser, serverUrl, output, viewport = { width: 1440, height: 900 }, timeoutMs = DEFAULT_TIMEOUT, label = 'current', captureContext = {} }) {
  assertDiagnosticCI(); validateBounds({ timeoutMs, viewport });
  if (!browser || !serverUrl || !output || !/^[a-z0-9_-]+$/i.test(label)) throw Error('Browser, server URL, output and safe label are required');
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage(), cdp = await context.newCDPSession(page), events = [];
  page.setDefaultTimeout(timeoutMs); page.setDefaultNavigationTimeout(timeoutMs);
  let truncated = false, started = false, traceComplete = false;
  const report = { ...captureContext, label, viewport, cpu_rate: 4, acceptance_gate: false, errors: [] };
  const caseTimer = setTimeout(() => { report.errors.push('Timeline case exceeded 60 seconds'); context.close().catch(() => {}); }, 60000);
  cdp.on('Tracing.dataCollected', ({ value }) => { const remaining = 100000 - events.length; events.push(...value.slice(0, Math.max(0, remaining))); if (value.length > remaining) truncated = true; });
  try {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8.execute,blink.user_timing', transferMode: 'ReportEvents' }); started = true;
    await page.goto(serverUrl);
    await page.locator(READY).first().waitFor({ state: 'visible' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { performance.mark('chart-diagnostic-initial-end'); resolve(); }))));
    await page.evaluate(() => performance.mark('chart-diagnostic-method-start'));
    await page.getByRole('button', { name: /^オニール/ }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { performance.mark('chart-diagnostic-method-end'); resolve(); }))));
  } catch (error) { report.errors.push(error.message); }
  finally {
    if (started) {
      let timer;
      try {
        const done = new Promise((resolve, reject) => { cdp.once('Tracing.tracingComplete', resolve); timer = setTimeout(() => reject(Error('Trace completion timed out')), 10000); });
        await cdp.send('Tracing.end'); await done; traceComplete = true;
      } catch (error) { report.errors.push(error.message); }
      finally { clearTimeout(timer); }
    }
    report.summary = summarizeTimeline(events, { truncated: truncated || !traceComplete });
    report.trace = `${label}-${viewport.width}.timeline.json`;
    await writeFile(resolve(output, report.trace), JSON.stringify({ traceEvents: events }));
    await writeFile(resolve(output, `${label}-${viewport.width}.timeline-summary.json`), JSON.stringify(report, null, 2));
    clearTimeout(caseTimer);
    await context.close();
  }
  return report;
}

export function validateBuildSource(proof, revision, label) {
  if (!/^[a-f0-9]{40}$/.test(revision || '') || proof?.revision !== revision || !/^[a-f0-9]{40}$/.test(proof?.tree || '') || proof?.label !== label) throw Error(`${label} build-source-provenance.json must identify the expected full revision, tree and label`);
  return proof;
}

async function buildEvidence(root, revision, label) {
  const proof = validateBuildSource(JSON.parse(await readFile(resolve(root, 'build-source-provenance.json'), 'utf8')), revision, label);
  const assets = [];
  async function walk(path = '') {
    for (const entry of await readdir(resolve(root, path), { withFileTypes: true })) {
      const relative = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile() && /\.(js|css)$/.test(relative)) {
        const bytes = await readFile(resolve(root, relative));
        assets.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await walk(); assets.sort((a, b) => a.path.localeCompare(b.path));
  if (!assets.length) throw Error(`${label} build has no emitted JS/CSS`);
  return { ...proof, assets, asset_list_sha256: sha256(JSON.stringify(assets)) };
}

async function serveDiagnosticBuild(root) {
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const path = pathname.replace(/^\/screener\//, '').replace(/^\/+/, '') || 'index.html';
      let file = resolve(root, path);
      if (file !== root && !file.startsWith(root + sep)) throw Error('Invalid path');
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }); response.end(await readFile(file));
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}/screener/`, close: () => new Promise(resolve => server.close(resolve)) };
}

export async function runDiagnosticCLI(env = process.env) {
  assertDiagnosticCI(env);
  if (!env.CURRENT_BUILD || !env.CHART_EAGER_BUILD || !env.CURRENT_REVISION || !env.CHART_EAGER_REVISION || !env.CHART_DIAGNOSTIC_OUTPUT) throw Error('CURRENT_BUILD, CHART_EAGER_BUILD, CURRENT_REVISION, CHART_EAGER_REVISION and CHART_DIAGNOSTIC_OUTPUT are required');
  const output = resolve(env.CHART_DIAGNOSTIC_OUTPUT);
  await mkdir(output, { recursive: true });
  const report = { acceptance_gate: false, source_run: env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null, errors: [], viewports: [] };
  let browser, eager, current;
  try {
    const currentRoot = resolve(env.CURRENT_BUILD), eagerRoot = resolve(env.CHART_EAGER_BUILD);
    const provenance = { baseline: await buildEvidence(eagerRoot, env.CHART_EAGER_REVISION, 'eager'), current: await buildEvidence(currentRoot, env.CURRENT_REVISION, 'current') };
    report.builds = provenance;
    eager = await serveDiagnosticBuild(eagerRoot); current = await serveDiagnosticBuild(currentRoot);
    // Dynamic import and browser launch happen only behind the CI entry guard.
    const { chromium } = await import('@playwright/test'); browser = await chromium.launch();
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const result = await runChartViewportDiagnostics({ browser, baselineUrl: eager.url, currentUrl: current.url, output, viewport, provenance, captureContext: { source_run: report.source_run } });
      report.viewports.push({ viewport, comparison_valid: result.comparison_valid, errors: result.errors });
    }
    report.timeline = await captureResearchTimeline({ browser, serverUrl: current.url, output, captureContext: { source_revision: env.CURRENT_REVISION, source_run: report.source_run } });
  } catch (error) { report.errors.push(error.message); }
  finally {
    await browser?.close(); await eager?.close(); await current?.close();
    await writeFile(resolve(output, 'diagnostic-summary.json'), JSON.stringify(report, null, 2));
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // No CI=1 override or local-browser escape hatch is supplied here.
  const report = await runDiagnosticCLI();
  console.log(JSON.stringify({ errors: report.errors, viewports: report.viewports, timeline_errors: report.timeline?.errors }, null, 2));
  if (report.errors.length || report.viewports.length !== 2 || report.viewports.some(item => !item.comparison_valid) || !report.timeline?.summary.complete || report.timeline.errors.length) process.exitCode = 1;
}
