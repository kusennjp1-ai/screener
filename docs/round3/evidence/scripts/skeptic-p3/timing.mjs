// SCRATCH skeptic-p3: 1440 Today first-load longest task, design-review style (CPU 4x via CDP, longtask observer, read at
// first row visible + 2 frames), own builds of 8bddb88 and 8849bf9, interleaved. Snapshot data via page.route.
// Usage: node timing.mjs <out.json> <runs> [delayChartMs]
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const [OUT, RUNS = '7', DELAY = '0'] = process.argv.slice(2);
const SERVE = '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/build/serve';
const DATE = '2026-11-12';
const research = readFileSync(`${SERVE}/research.json`);
const manifest = { as_of_date: DATE, generated_at: '2026-11-13T10:20:35Z', research_generation: 'skeptic-p3', default_market: 'US', supported_markets: ['US'], markets: { US: { as_of_date: DATE, assets: { research: { path: 'research.json' } }, pages: {} } } };
const TREES = ['8bddb88', '8849bf9'];
const browser = await chromium.launch({ executablePath: '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/cft147/chrome-headless-shell-linux64/chrome-headless-shell' });
const sessions = {};
for (const tree of TREES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ja-JP', serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    window.__lt = []; window.__marks = {};
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}
    const mo = new MutationObserver(() => {
      const now = performance.now();
      if (!window.__marks.row && document.querySelector('[data-testid="brief-candidate"]')) window.__marks.row = now;
      if (!window.__marks.candle && document.querySelector('[data-testid="brief-price-chart"] rect.bc-up, [data-testid="brief-price-chart"] rect.bc-down')) window.__marks.candle = now;
    });
    document.addEventListener('DOMContentLoaded', () => mo.observe(document.documentElement, { childList: true, subtree: true }));
  });
  const page = await ctx.newPage();
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.fallback() : r.abort());
  await page.route('**/static-data/**', async r => {
    const p = decodeURIComponent(new URL(r.request().url()).pathname.replace(/^.*\/static-data\//, ''));
    if (p === 'manifest.json') return r.fulfill({ json: manifest });
    if (p === 'research.json') return r.fulfill({ contentType: 'application/json', body: research });
    if (/^charts\/[^/]+\.json$/.test(p) && existsSync(`${SERVE}/${p}`)) { if (Number(DELAY)) await new Promise(d => setTimeout(d, Number(DELAY))); return r.fulfill({ contentType: 'application/json', body: readFileSync(`${SERVE}/${p}`) }); }
    return r.fulfill({ status: 404, json: {} });
  });
  const base = `http://127.0.0.1:4414/s-${tree}/`;
  await page.goto(`${base}#/brief`);
  await page.locator('[data-testid="brief-candidate"]').first().waitFor({ state: 'visible', timeout: 120000 });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  sessions[tree] = { page, base };
}
const frames = page => page.evaluate(() => new Promise(d => requestAnimationFrame(() => requestAnimationFrame(d))));
const runs = [];
for (let i = 0; i < Number(RUNS); i++) {
  for (const tree of (i % 2 ? [...TREES].reverse() : TREES)) {
    const { page, base } = sessions[tree];
    await page.goto('about:blank');
    const t0 = Date.now();
    await page.goto(`${base}#/brief`);
    await page.locator('[data-testid="brief-candidate"]').first().waitFor({ state: 'visible', timeout: 120000 });
    await frames(page);
    const first = Date.now() - t0;
    const atFirst = await page.evaluate(() => ({ lt: [...window.__lt], now: performance.now(), marks: { ...window.__marks } }));
    await page.waitForFunction(() => document.querySelector('[data-testid="brief-price-chart"] rect.bc-up'), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const later = await page.evaluate(() => ({ lt: [...window.__lt], marks: { ...window.__marks },
      pane: document.querySelector('[data-testid="brief-price-chart"]')?.getAttribute('aria-label')?.split(' ')[0] || null,
      firstRow: document.querySelector('[data-testid="brief-candidate"]')?.getAttribute('data-symbol') }));
    const longest = Math.max(0, ...atFirst.lt.map(x => x[1]));
    const c = later.marks.candle, chartTask = later.lt.find(([s, d]) => c >= s && c <= s + d + 1);
    runs.push({ tree, run: i + 1, first_candidate_ms: first, longest_at_first: Math.round(longest), candle_before_read: c != null && c <= atFirst.now,
      chart_task: chartTask ? Math.round(chartTask[1]) : null, longest_is_chart: chartTask ? Math.round(chartTask[1]) === Math.round(longest) : false,
      tasks_at_first: atFirst.lt.map(([s, d]) => [Math.round(s), Math.round(d)]), all_tasks: later.lt.map(([s, d]) => [Math.round(s), Math.round(d)]), marks: later.marks, pane: later.pane, firstRow: later.firstRow });
    console.log(tree, i + 1, first, Math.round(longest), chartTask ? Math.round(chartTask[1]) : null, later.pane, later.firstRow);
  }
}
await browser.close();
writeFileSync(OUT, JSON.stringify({ delay: Number(DELAY), runs }, null, 1));
