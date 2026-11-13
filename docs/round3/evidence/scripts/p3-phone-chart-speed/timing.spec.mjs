// SCRATCH (audit3 p3): 1440 first-load long tasks on the synthetic fixture, design-review.mjs's method (PerformanceObserver
// 'longtask' installed before the app, CDP CPU 4×, about:blank → the hash, first candidate row visible + 2 frames), on the
// production builds of three trees served by scripts/serve.mjs (/t-<sha>/). The fixture is 8849bf9's (identical in all
// three trees). Every long task is kept with its start, plus marks: first candidate row, priceChart chunk responseEnd,
// first candle in the right pane, the intro's end (.bc-pulsing). The pane's symbol and the left column are asserted.
// Env: P3_RUNS (default 7), P3_OUT (json), P3_TARGETS (comma list of '#/brief' or a symbol for '#/brief/stock/<SYM>'),
// P3_TREES (comma list), P3_TRACE (dir: one Chrome trace per tree×target on the sourcemap build /m-<sha>/ instead).
import { test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';
import { routeBrief, now as fixtureNow } from '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p3-phone-chart-speed/trees/8849bf9/frontend/tests/static/brief-fixture.js';
// P3_DATA=snapshot: the round-3 real-data snapshot (read-only) instead of the synthetic fixture, as the snapshot's own render did.
const SNAP = process.env.P3_DATA === 'snapshot' ? '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/build/serve' : null;
const now = SNAP ? '2026-11-13T11:10:31Z' : fixtureNow;
const snapResearch = SNAP ? readFileSync(`${SNAP}/research.json`) : null;
const snapManifest = { as_of_date: '2026-11-12', generated_at: '2026-11-13T10:20:35Z', research_generation: 'audit3-snapshot-rebuild-20261112', default_market: 'US', supported_markets: ['US'], markets: { US: { as_of_date: '2026-11-12', assets: { research: { path: 'research.json' } }, pages: {} } } };
async function routeData(page) {
  if (!SNAP) return routeBrief(page);
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.fallback() : r.abort());
  await page.route('**/static-data/**', r => {
    const path = decodeURIComponent(new URL(r.request().url()).pathname.replace(/^.*\/static-data\//, ''));
    if (path === 'manifest.json') return r.fulfill({ json: snapManifest });
    if (path === 'research.json') return r.fulfill({ contentType: 'application/json', body: snapResearch });
    if (/^charts\/[^/]+\.json$/.test(path) && existsSync(`${SNAP}/${path}`)) return r.fulfill({ contentType: 'application/json', body: readFileSync(`${SNAP}/${path}`) });
    return r.fulfill({ status: 404, json: {} });
  });
}

const TREES = (process.env.P3_TREES || '8bddb88,5645ff0,8849bf9').split(',');
const TARGETS = (process.env.P3_TARGETS || '#/brief').split(',');
const RUNS = Number(process.env.P3_RUNS || 7);
const OUT = process.env.P3_OUT;
const TRACE = process.env.P3_TRACE || null;
const ROWS = '[data-testid="brief-candidate"]';

const init = () => {
  window.__p3 = { tasks: [], marks: {} };
  // A native monotonic clock for the calibration loop (document.timeline does not advance inside a task).
  { const native = performance.now.bind(performance); globalThis.__p3native = native; }
  try { new PerformanceObserver(list => { for (const item of list.getEntries()) window.__p3.tasks.push([Math.round(item.startTime * 10) / 10, Math.round(item.duration * 10) / 10]); }).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
  try { localStorage.setItem('screener:color-mode', 'dark'); } catch { /* opaque */ }
  const watch = () => {
    const m = window.__p3.marks;
    const obs = new MutationObserver(() => {
      // The native performance.now (captured before page.clock fakes it): the long tasks' time base.
      const at = () => Math.round(globalThis.__p3native() * 10) / 10;
      if (m.row === undefined && document.querySelector('[data-testid="brief-candidate"]')) m.row = at();
      if (m.candle === undefined && document.querySelector('.brief-right [data-testid="brief-price-chart"] rect.bc-up, .brief-right [data-testid="brief-price-chart"] rect.bc-down')) m.candle = at();
      if (m.pulse === undefined && document.querySelector('.brief-right .bc-pulsing')) { m.pulse = at(); obs.disconnect(); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  };
  if (document.documentElement) watch(); else document.addEventListener('DOMContentLoaded', watch);
};
const frames = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
const hashOf = target => (target.startsWith('#') ? target : `#/brief/stock/${encodeURIComponent(target)}`);

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, locale: 'ja-JP', colorScheme: 'dark', serviceWorkers: 'block' });
test.setTimeout(60 * 60 * 1000);

test('1440 first-load long tasks', async ({ browser }) => {
  const sessions = {};
  const SHARED = process.env.P3_SHARED === '1';
  for (const tree of TREES) for (const target of (SHARED ? [TARGETS[0]] : TARGETS)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ja-JP', colorScheme: 'dark', serviceWorkers: 'block' });
    await context.addInitScript(init);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.setFixedTime(new Date(now));
    await routeData(page);
    const base = `http://127.0.0.1:4414/${TRACE ? 'm' : 't'}-${tree}/`;
    // Warm-up load (design-review loads #/brief once before throttling).
    await page.goto(`${base}${hashOf(target)}`);
    await page.locator(ROWS).first().waitFor({ state: 'visible', timeout: 60000 });
    const calibrate = () => page.evaluate(() => { const t = Date.now ? 0 : 0; const t0 = globalThis.__p3native ? globalThis.__p3native() : 0; let x = 0; for (let i = 0; i < 3e6; i++) x += i % 7; return Math.round(((globalThis.__p3native ? globalThis.__p3native() : 0) - t0) * 10) / 10 + (x < 0 ? 1 : 0) + t; });
    const calibUnthrottled = await calibrate();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    console.log(`${tree} ${target}: calibration loop ${calibUnthrottled}ms unthrottled, ${await calibrate()}ms after CPU 4x`);
    await page.goto('about:blank');
    sessions[`${tree} ${target}`] = { tree, target, page, cdp, base, errors, runs: [] };
  }
  // With P3_SHARED, every target is measured in its tree's one page (each a fresh about:blank → hash load).
  const order = SHARED ? Object.values(sessions).flatMap(s => TARGETS.map(target => ({ ...s, target, runs: [], key: `${s.tree} ${target}` }))) : Object.values(sessions);
  const runs = TRACE ? 1 : RUNS;
  for (let r = 0; r < runs; r++) {
    // Rotate the order every run so no tree is always measured first.
    const rotated = order.map((_, i) => order[(i + r) % order.length]);
    for (const s of rotated) {
      const { page } = s;
      await page.goto('about:blank');
      if (TRACE) await browser.startTracing(page, { path: `${TRACE}/${s.tree}-${s.target.replace(/[^A-Za-z0-9]/g, '_')}.json`, screenshots: false,
        categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'v8.execute', 'disabled-by-default-v8.cpu_profiler', 'blink.user_timing', 'loading', 'toplevel', 'disabled-by-default-v8.gc', 'v8'] });
      const start = Date.now();
      await page.goto(`${s.base}${hashOf(s.target)}`);
      await page.locator(ROWS).first().waitFor({ state: 'visible', timeout: 60000 });
      await frames(page);
      const firstCandidate = Date.now() - start;
      const atFirst = await page.evaluate(() => ({ longest: Math.max(0, ...window.__p3.tasks.map(t => t[1])), tasks: window.__p3.tasks.slice(), now: globalThis.__p3native(), marks: { ...window.__p3.marks } }));
      // Then let the right pane's chart finish its intro (or 10s), and 500ms more.
      await page.waitForFunction(() => window.__p3.marks.pulse !== undefined, null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
      const settled = await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource');
        const chunk = resources.find(e => /priceChart-[^/]*\.js/.test(e.name));
        const calib = (() => { const t = Date.now ? 0 : 0; const t0 = globalThis.__p3native ? globalThis.__p3native() : 0; let x = 0; for (let i = 0; i < 3e6; i++) x += i % 7; return Math.round(((globalThis.__p3native ? globalThis.__p3native() : 0) - t0) * 10) / 10 + (x < 0 ? 1 : 0) + t; })();
        const right = document.querySelector('.brief-right');
        return {
          calib_ms: calib, resources: resources.length, js: resources.filter(e => /\.js/.test(e.name)).map(e => e.name.split('/').pop() + '@' + Math.round(e.startTime) + '-' + Math.round(e.responseEnd)),
          tasks: window.__p3.tasks.slice(), marks: { ...window.__p3.marks, chunkStart: chunk ? chunk.startTime : null, chunkEnd: chunk ? chunk.responseEnd : null },
          pane: right?.querySelector('.brief-stockhead h2 span:first-child')?.textContent.trim() || null,
          leftToday: !!document.querySelector('.brief-left #brief-focus-title'),
          firstRow: document.querySelector('[data-testid="brief-candidate"]')?.getAttribute('data-symbol') || null,
          period: right?.querySelector('[aria-pressed="true"]')?.textContent.trim() || null,
          nametags: [...(right?.querySelectorAll('[data-tag]') || [])].map(g => g.getAttribute('data-tag')),
          p3c: window.__p3c ? JSON.parse(JSON.stringify(window.__p3c)) : null,
          labels: right?.querySelectorAll('[data-testid="brief-price-chart"] svg text').length ?? null,
          forced: right?.querySelectorAll('[data-testid="brief-price-chart"] [data-forced]').length ?? null,
        };
      });
      if (TRACE) await browser.stopTracing();
      // Leave the page idle (about:blank) so its chart's endless pulse does not load the CPU while other pages are measured.
      await page.goto('about:blank');
      s.runs.push({ run: r + 1, first_candidate_ms: firstCandidate, longest_at_first_candidate_ms: atFirst.longest, at_first_now: Math.round(atFirst.now),
        tasks_at_first: atFirst.tasks.length, longest_settled_ms: Math.max(0, ...settled.tasks.map(t => t[1])), ...settled });
      console.log(`${s.tree} ${s.target} run ${r + 1}: first ${firstCandidate}ms, longest@first ${atFirst.longest}, longest settled ${Math.max(0, ...settled.tasks.map(t => t[1]))}, pane ${settled.pane}, calib ${settled.calib_ms}, js ${settled.js.join(' ')}, tasks ${JSON.stringify(settled.tasks)} marks ${JSON.stringify(Object.fromEntries(Object.entries(settled.marks).map(([k, v]) => [k, v === null || v === undefined ? v : Math.round(v)])))}`);
    }
  }
  for (const s of Object.values(sessions)) await s.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const result = order.map(({ tree, target, runs: list, errors }) => ({ tree, target, errors, runs: list }));
  if (OUT) { mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true }); writeFileSync(OUT, JSON.stringify(result, null, 1)); }
});
