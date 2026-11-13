// SCRATCH skeptic-p3: instrumented 8849bf9 (a849bf9): MA names section time and renderPriceChart time for the 1440 Today pane, CPU 4x.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const [OUT, RUNS = '5'] = process.argv.slice(2);
const SERVE = '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/build/serve';
const DATE = '2026-11-12';
const research = readFileSync(`${SERVE}/research.json`);
const manifest = { as_of_date: DATE, generated_at: '2026-11-13T10:20:35Z', research_generation: 'skeptic-p3', default_market: 'US', supported_markets: ['US'], markets: { US: { as_of_date: DATE, assets: { research: { path: 'research.json' } }, pages: {} } } };
const browser = await chromium.launch({ executablePath: '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/cft147/chrome-headless-shell-linux64/chrome-headless-shell' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'ja-JP', serviceWorkers: 'block' });
const page = await ctx.newPage();
await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.fallback() : r.abort());
await page.route('**/static-data/**', r => {
  const p = decodeURIComponent(new URL(r.request().url()).pathname.replace(/^.*\/static-data\//, ''));
  if (p === 'manifest.json') return r.fulfill({ json: manifest });
  if (p === 'research.json') return r.fulfill({ contentType: 'application/json', body: research });
  if (/^charts\/[^/]+\.json$/.test(p) && existsSync(`${SERVE}/${p}`)) return r.fulfill({ contentType: 'application/json', body: readFileSync(`${SERVE}/${p}`) });
  return r.fulfill({ status: 404, json: {} });
});
const base = 'http://127.0.0.1:4414/s-a849bf9/';
await page.goto(`${base}#/brief`);
await page.locator('[data-testid="brief-candidate"]').first().waitFor({ state: 'visible', timeout: 120000 });
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const out = [];
for (let i = 0; i < Number(RUNS); i++) {
  await page.goto('about:blank');
  await page.goto(`${base}#/brief`);
  await page.waitForFunction(() => document.querySelector('[data-testid="brief-price-chart"] rect.bc-up'), null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({ nm: globalThis.__nm || [], rt: globalThis.__rt || [], pane: document.querySelector('[data-testid="brief-price-chart"]')?.getAttribute('aria-label')?.split(' ')[0] }));
  out.push(r); console.log(JSON.stringify(r));
}
await browser.close();
writeFileSync(OUT, JSON.stringify(out, null, 1));
