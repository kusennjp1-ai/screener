// SCRATCH skeptic-p3: own render of the brief stock screen from the round-3 snapshot (read-only), on own build of 8849bf9
// at 127.0.0.1:4414/s-8849bf9/. Usage: node sweep.mjs <out> <targets.json> <reduce|pulse|waapi> [png:0|1]
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
const [OUT, TF, MODE = 'reduce', PNG = '0'] = process.argv.slice(2);
const SERVE = '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/build/serve';
const BASE = 'http://127.0.0.1:4414/s-8849bf9/';
const DATE = '2026-11-12', NOW = '2026-11-13T11:10:31Z';
const research = readFileSync(`${SERVE}/research.json`);
const manifest = { as_of_date: DATE, generated_at: '2026-11-13T10:20:35Z', research_generation: 'skeptic-p3', default_market: 'US', supported_markets: ['US'], markets: { US: { as_of_date: DATE, assets: { research: { path: 'research.json' } }, pages: {} } } };
const T = JSON.parse(readFileSync(TF, 'utf8'));
const PER = [['3m', '3か月'], ['6m', '6か月'], ['1y', '1年'], ['weekly', /^週足/]].filter(([k]) => !process.env.PER || process.env.PER.split(',').includes(k));
const VP = { 320: { viewport: { width: 320, height: 693 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, 390: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, 1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } };
mkdirSync(OUT, { recursive: true });
const probe = card => { const H = s => Math.round(card.querySelector(s)?.getBoundingClientRect().height ?? -1);
  const chart = card.querySelector('[data-testid="brief-price-chart"]');
  const t = [...chart.querySelectorAll('svg text')];
  const scr = card.closest('.brief-stock') || document;
  return {
    aria: chart.getAttribute('aria-label'), h: Math.round(card.getBoundingClientRect().height), parts: { legend: H('.brief-legend'), readout: H('.brief-readout'), chart: H('[data-testid="brief-price-chart"]'), kids: [...card.children].map(c => [c.className, Math.round(c.getBoundingClientRect().height)]) },
    legs: chart.querySelectorAll('.bc-leg').length, legtext: [...chart.querySelectorAll('.bc-legtext')].map(n => n.textContent),
    forced: t.filter(n => n.getAttribute('data-forced')).map(n => [n.getAttribute('class'), n.textContent]),
    forcedAll: chart.querySelectorAll('[data-forced]').length,
    notice: t.filter(n => /bc-notice/.test(n.getAttribute('class') || '')).map(n => [n.textContent, n.getAttribute('data-forced')]),
    stop: t.filter(n => /損切り/.test(n.textContent)).map(n => n.textContent),
    note: [...chart.querySelectorAll('.bc-note')].map(n => n.textContent.trim()),
    tags: [...chart.querySelectorAll('[data-tag]')].map(g => [g.getAttribute('data-tag'), [...g.querySelectorAll('text')].map(x => x.textContent).join('/')]),
    alltext: t.map(n => n.textContent),
    legendVis: [...card.querySelectorAll('.brief-legend > *')].filter(i => !i.hidden && i.getBoundingClientRect().width > 0).map(i => i.textContent.replace(/\s+/g, ' ').trim()),
    legendHid: [...card.querySelectorAll('.brief-legend > *')].filter(i => i.hidden || i.getBoundingClientRect().width === 0).map(i => i.textContent.replace(/\s+/g, ' ').trim()),
    legendCtl: [...card.querySelectorAll('.brief-legend button, .brief-legend summary, .brief-legend [aria-expanded]')].map(b => b.textContent.trim()),
    readout: card.querySelector('.brief-readout')?.innerText.replace(/\s+/g, ' ').trim() || null,
    vcpEngine: document.querySelector('.brief-vcp-engine')?.textContent || null,
    vcpPivot: [...document.querySelectorAll('#brief-vcp-title ~ dl div')].map(d => d.textContent.replace(/\s+/g, ' ').trim()),
    pulsing: !!chart.querySelector('.bc-pulsing'),
  };
};
const browser = await chromium.launch({ executablePath: '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/cft147/chrome-headless-shell-linux64/chrome-headless-shell' });
const out = [], errors = [];
for (const [w, syms] of Object.entries(T)) {
  const ctx = await browser.newContext({ ...VP[w], locale: 'ja-JP', reducedMotion: MODE === 'reduce' ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${w}: ${e.message}`));
  await page.clock.setFixedTime(new Date(NOW));
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.fallback() : r.abort());
  await page.route('**/static-data/**', r => {
    const p = decodeURIComponent(new URL(r.request().url()).pathname.replace(/^.*\/static-data\//, ''));
    if (p === 'manifest.json') return r.fulfill({ json: manifest });
    if (p === 'research.json') return r.fulfill({ contentType: 'application/json', body: research });
    if (/^charts\/[^/]+\.json$/.test(p) && existsSync(`${SERVE}/${p}`)) return r.fulfill({ contentType: 'application/json', body: readFileSync(`${SERVE}/${p}`) });
    return r.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${BASE}#/brief/stock/${encodeURIComponent(syms[0])}`);
  for (const s of syms) {
    await page.evaluate(x => { location.hash = `#/brief/stock/${encodeURIComponent(x)}`; }, s);
    const card = page.locator('.brief-chartcard').first();
    try { await card.waitFor({ state: 'visible', timeout: 120000 }); } catch { errors.push(`${w} ${s} no card`); continue; }
    for (const [k, label] of PER) {
      try {
        const b = card.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label });
        await b.click();
        await page.waitForFunction(el => el.getAttribute('aria-pressed') === 'true', await b.elementHandle(), { timeout: 20000 });
        const ch = card.getByTestId('brief-price-chart');
        await page.waitForFunction(([el, x]) => (el.getAttribute('aria-label') || '').startsWith(`${x} の`) && el.querySelector('svg rect.bc-up, svg rect.bc-down'), [await ch.elementHandle(), s], { timeout: 60000 });
        if (MODE === 'pulse') await page.waitForFunction(el => !!el.querySelector('.bc-pulsing'), await ch.elementHandle(), { timeout: 15000 });
        if (MODE === 'waapi') await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => null))));
        else { await page.evaluate(() => document.fonts.ready.then(() => 1)); await page.waitForTimeout(MODE === 'pulse' ? 400 : 150); }
        const f = await card.evaluate(probe);
        if (PNG === '1') await card.screenshot({ path: `${OUT}/${s}-${k}-${w}.png`, animations: 'disabled' });
        out.push({ symbol: s, period: k, width: Number(w), mode: MODE, ...f });
      } catch (e) { errors.push(`${w} ${s} ${k}: ${e.message.split('\n')[0]}`); }
    }
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/sweep-${MODE}.json`, JSON.stringify({ errors, renders: out }));
console.log(JSON.stringify({ n: out.length, errors }));
