// SCRATCH (ui-abc yardstick, never committed): Design Acceptance's four timing metrics (frontend/tools/design-review.mjs
// :505-575, budgets in brief-design-contract.mjs TIMING) with its own selectors and method, on production builds, two (or
// more) trees INTERLEAVED (A B A B …, the order rotated every run), at 390 and 1440 dark, CPU 4x via CDP.
//   per width and tree: a context as design-review's openSession (viewport, DSF 2 / mobile+touch at 390, ja-JP, dark, no
//   reduced motion, service workers blocked, the colour mode stored, a 'longtask' PerformanceObserver into
//   window.__briefLongTasks), #/brief loaded once, then Emulation.setCPUThrottlingRate 4. Each run: about:blank → #/brief,
//   first candidate row visible + 2 frames (first_candidate_ms; longest_initial_task_ms = the longest long task so far);
//   click 「候補」 in nav.brief-tabs until #/brief/list with a .brief-stack h1 「候補」 + 2 frames (tab_switch_ms); 「今日」
//   back and settle (design-review's settle); click the first row (the second at 1440) until its hash, its ticker in
//   `.brief-stockhead h2 span:first-child, .brief-bar-title b span`, the conclusion and the candles + 2 frames (stock_open_ms).
// Data: the 11-12 rebuild (SNAP_SERVE's research.json and charts) through page.route, with the page clock pinned at the
// rebuild's evaluation instant (as the harness's timing.spec.mjs does); builds: <trees>/<head7>/frontend/dist-t served by the
// harness's snapshot/scripts/serve.mjs at /t-<head7>/. Each run records the load average before and after; each session the
// in-page calibration loop unthrottled and at 4x. After its run each page is parked on about:blank, so only one tree's
// page is live at any time.
// Env: SNAP_SERVE, SERVE_PORT, T4_TREES (comma list of head7, labels may repeat a head: `01066eb,01066eb`), T4_RUNS (7),
//      T4_WIDTHS (390,1440), T4_OUT (json).
import { test } from '@playwright/test';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
const SNAP = process.env.SNAP_SERVE, PORT = Number(process.env.SERVE_PORT), OUT = process.env.T4_OUT;
const TREES = process.env.T4_TREES.split(','), RUNS = Number(process.env.T4_RUNS || 7), WIDTHS = (process.env.T4_WIDTHS || '390,1440').split(',').map(Number);
const NOW = '2026-11-13T11:10:31Z';
const research = readFileSync(`${SNAP}/research.json`);
const manifest = { as_of_date: '2026-11-12', generated_at: '2026-11-13T10:20:35Z', research_generation: 'audit3-snapshot-rebuild-20261112', default_market: 'US', supported_markets: ['US'], markets: { US: { as_of_date: '2026-11-12', assets: { research: { path: 'research.json' } }, pages: {} } } };
const ROWS = '[data-testid="brief-candidate"]';
const CANDLES = '[data-testid="brief-price-chart"] rect.bc-up, [data-testid="brief-price-chart"] rect.bc-down';
const GROUPS = { 390: { width: 390, height: 844, mobile: true }, 1440: { width: 1440, height: 900, mobile: false } };
const frames = page => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
async function settle(page) { // design-review.mjs:168-175
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming?.().endTime ?? Infinity)), null, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="brief-price-chart"]')].every(chart => !chart.querySelector('svg') || chart.querySelector('.bc-pulsing') || matchMedia('(prefers-reduced-motion: reduce)').matches), null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(300);
}
const calib = page => page.evaluate(() => { const t0 = performance.now(); let x = 0; for (let i = 0; i < 3e6; i++) x += i % 7; return Math.round((performance.now() - t0) * 10) / 10 + (x < 0 ? 1 : 0); });
const median = values => { const s = values.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const load = () => loadavg().map(x => Math.round(x * 100) / 100);

test.use({ locale: 'ja-JP', colorScheme: 'dark', serviceWorkers: 'block' });
test.setTimeout(3 * 60 * 60 * 1000);
test('timing4: design-review metrics, trees interleaved', async ({ browser }) => {
  const result = { trees: TREES, runs: RUNS, widths: {}, started: new Date().toISOString(), load_start: load() };
  for (const width of WIDTHS) {
    const group = GROUPS[width], sessions = [];
    for (const [i, tree] of TREES.entries()) {
      const context = await browser.newContext({ viewport: { width: group.width, height: group.height }, deviceScaleFactor: group.mobile ? 2 : 1, isMobile: group.mobile, hasTouch: group.mobile,
        locale: 'ja-JP', colorScheme: 'dark', reducedMotion: 'no-preference', serviceWorkers: 'block' });
      await context.addInitScript(() => { try { localStorage.setItem('screener:color-mode', 'dark'); } catch { /* opaque */ } });
      await context.addInitScript(() => { window.__briefLongTasks = []; try { new PerformanceObserver(list => { for (const item of list.getEntries()) window.__briefLongTasks.push(item.duration); }).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ } });
      await context.route('**/*', route => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort()));
      await context.route('**/static-data/**', route => {
        const path = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^.*\/static-data\//, ''));
        if (path === 'manifest.json') return route.fulfill({ json: manifest });
        if (path === 'research.json') return route.fulfill({ contentType: 'application/json', body: research });
        if (/^charts\/[^/]+\.json$/.test(path) && existsSync(`${SNAP}/${path}`)) return route.fulfill({ contentType: 'application/json', body: readFileSync(`${SNAP}/${path}`) });
        return route.fulfill({ status: 404, json: {} });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.clock.setFixedTime(new Date(NOW));
      const base = `http://127.0.0.1:${PORT}/t-${tree}/`;
      await page.goto(`${base}#/brief`);
      await page.locator(ROWS).first().waitFor({ state: 'visible', timeout: 60000 });
      const calibFree = await calib(page);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      sessions.push({ label: `${String.fromCharCode(65 + i)}:${tree}`, tree, base, context, page, cdp, errors, runs: [], calib: { unthrottled: calibFree, cpu4x: await calib(page) } });
    }
    for (let r = 0; r < RUNS; r++) for (let k = 0; k < sessions.length; k++) {
      const s = sessions[(k + r) % sessions.length], { page } = s, run = { order: k, load_before: load() };
      await page.goto('about:blank');
      let start = Date.now();
      await page.goto(`${s.base}#/brief`);
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
      run.symbol = symbol; run.load_after = load();
      s.runs.push(run);
      // Park the page: the other tree's run must not share the CPU with this one's live stock screen (S1-P0 review).
      await page.goto('about:blank');
      console.log(`${width} run ${r + 1} ${s.label}: first ${run.first_candidate_ms} long ${Math.round(run.longest_initial_task_ms)} tab ${run.tab_switch_ms} stock ${run.stock_open_ms} (${symbol}) load ${run.load_before[0]}`);
    }
    result.widths[width] = sessions.map(s => ({ label: s.label, tree: s.tree, calib: s.calib, errors: s.errors, runs: s.runs,
      medians: Object.fromEntries(['first_candidate_ms', 'longest_initial_task_ms', 'tab_switch_ms', 'stock_open_ms'].map(k => [k, median(s.runs.map(x => x[k]))])) }));
    for (const s of sessions) await s.context.close();
  }
  result.ended = new Date().toISOString(); result.load_end = load();
  writeFileSync(OUT, JSON.stringify(result, null, 1));
  for (const [width, list] of Object.entries(result.widths)) for (const s of list) console.log(`${width} ${s.label} medians ${JSON.stringify(s.medians)} calib ${JSON.stringify(s.calib)}`);
});
