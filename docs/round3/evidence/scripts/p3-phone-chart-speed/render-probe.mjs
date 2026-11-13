// SCRATCH (audit3 p3): render the brief's real stock chart card from the round-3 snapshot (read-only input) with the
// production build of main 8849bf9 served on 127.0.0.1:4414 (scripts/serve.mjs), SETTLED (the snapshot's own render waited
// only for WAAPI animations, so its PNGs are mid-intro), and probe what each view draws.
// Usage: node render-probe.mjs <out-dir> <targets.json> [mode]
//   targets.json: { "390": ["SYM", ...], "1440": [...], "320": [...] }, periods: all four unless P3_PERIODS="6m,weekly".
//   mode: 'reduce' (prefers-reduced-motion: the chart draws its final state at once) or 'pulse' (normal motion, wait for the
//   intro's end marker .bc-pulsing after every period switch, as design-review.mjs's settle() does).
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const [OUT, TARGETS_FILE, MODE = 'reduce'] = process.argv.slice(2);
const SERVE = '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/build/serve';
const TREE = process.env.P3_TREE || '8849bf9';
const BASE = `http://127.0.0.1:4414/t-${TREE}/`;
const DATE = '2026-11-12', NOW = '2026-11-13T11:10:31Z';
const research = readFileSync(`${SERVE}/research.json`);
const manifest = { as_of_date: DATE, generated_at: '2026-11-13T10:20:35Z', research_generation: 'audit3-snapshot-rebuild-20261112',
  default_market: 'US', supported_markets: ['US'], markets: { US: { as_of_date: DATE, assets: { research: { path: 'research.json' } }, pages: {} } } };
const TARGETS = JSON.parse(readFileSync(TARGETS_FILE, 'utf8'));
const ALL_PERIODS = [['3m', '3か月'], ['6m', '6か月'], ['1y', '1年'], ['weekly', /^週足/]];
const PERIODS = process.env.P3_PERIODS ? ALL_PERIODS.filter(([k]) => process.env.P3_PERIODS.split(',').includes(k)) : ALL_PERIODS;
const VIEWPORTS = {
  320: { viewport: { width: 320, height: 693 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  390: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  1440: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
};
mkdirSync(OUT, { recursive: true });

// In the page: everything the settled chart card draws, with each text's box (relative to the chart), its effective
// colour and opacity, and the contrast against the card's surface.
function probe(card) {
  const chart = card.querySelector('[data-testid="brief-price-chart"]');
  const cr = chart.getBoundingClientRect();
  const parse = c => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  let bgEl = card, bg = null;
  while (bgEl && !bg) { const c = parse(getComputedStyle(bgEl).backgroundColor); if (c && c.a > 0.99) bg = c; bgEl = bgEl.parentElement; }
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const contrast = (fg, alpha) => { const mix = { r: fg.r * alpha + bg.r * (1 - alpha), g: fg.g * alpha + bg.g * (1 - alpha), b: fg.b * alpha + bg.b * (1 - alpha) }; const a = lum(mix), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const effOpacity = node => { let o = 1; for (let n = node; n && n !== chart; n = n.parentElement) { const s = getComputedStyle(n); o *= Number(s.opacity); } return o; };
  const svgs = [...chart.querySelectorAll('svg.bc-layer')];
  const layerOf = node => svgs.indexOf(node.closest('svg.bc-layer'));
  const texts = [...chart.querySelectorAll('svg text')].map(t => {
    const r = t.getBoundingClientRect(), s = getComputedStyle(t), fill = parse(s.fill), op = effOpacity(t) * Number(s.fillOpacity || 1);
    // A tag's text sits on its own opaque fill: its contrast is against that fill.
    const holder = t.closest('[data-tag], .bc-rshigh, .bc-earnflag'), plate = holder ? parse(getComputedStyle(holder.querySelector('rect')).fill) : null;
    const tagContrast = plate && fill && plate.a > 0.99 ? (() => { const keep = bg; bg = plate; const v = contrast(fill, Math.min(1, op * fill.a)); bg = keep; return +v.toFixed(2); })() : null;
    const vis = s.visibility !== 'hidden' && t.getAttribute('visibility') !== 'hidden' && s.display !== 'none' && r.width > 0;
    return { cls: t.getAttribute('class'), text: t.textContent, x0: +(r.left - cr.left).toFixed(1), x1: +(r.right - cr.left).toFixed(1), y0: +(r.top - cr.top).toFixed(1), y1: +(r.bottom - cr.top).toFixed(1),
      fs: s.fontSize, forced: t.getAttribute('data-forced') || null, depth: t.getAttribute('data-depth'), vis, opacity: +op.toFixed(3), fill: s.fill,
      contrast: fill && bg ? +contrast(fill, Math.min(1, op * fill.a)).toFixed(2) : null, tagContrast, plate: plate ? `rgb(${plate.r},${plate.g},${plate.b})` : null, layer: layerOf(t), group: t.parentElement?.getAttribute('class') || null };
  });
  const clip = chart.querySelector('clipPath rect');
  const pw = clip ? Number(clip.getAttribute('width')) : null, plotBottom = clip ? Number(clip.getAttribute('height')) : null;
  const lineY = sel => [...chart.querySelectorAll(sel)].map(l => ({ y: Number(l.getAttribute('y1')), x1: Number(l.getAttribute('x1')), x2: Number(l.getAttribute('x2')), cls: l.getAttribute('class') }));
  const gridlines = lineY('.bc-grid line.bc-gridline').filter(l => l.y < plotBottom);
  const tags = [...chart.querySelectorAll('[data-tag]')].map(g => { const rect = g.querySelector('rect'), leader = g.querySelector('line'); return { key: g.getAttribute('data-tag'), y: Number(leader.getAttribute('y1')), at: Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')) / 2, h: Number(rect.getAttribute('height')), text: [...g.querySelectorAll('text')].map(t => t.textContent).join(' / '), leader: leader.getAttribute('visibility') !== 'hidden' }; });
  const legendItems = [...card.querySelectorAll('.brief-legend > *')].filter(i => !i.hidden && i.getBoundingClientRect().width > 0).map(i => i.textContent.replace(/\s+/g, ' ').trim());
  const legendHidden = [...card.querySelectorAll('.brief-legend > *')].filter(i => i.hidden).map(i => i.textContent.replace(/\s+/g, ' ').trim());
  const legs = [...chart.querySelectorAll('.bc-leg')].map(g => ({ leg: g.getAttribute('data-leg'), depth: g.getAttribute('data-depth') }));
  return {
    aria: chart.getAttribute('aria-label'), W: Math.round(cr.width), H: Math.round(cr.height), pw, plotBottom, card_h: Math.round(card.getBoundingClientRect().height),
    bg: bg ? `rgb(${bg.r},${bg.g},${bg.b})` : null, theme: document.querySelector('.brief[data-theme]')?.getAttribute('data-theme') || null,
    candles: chart.querySelectorAll('svg rect.bc-up, svg rect.bc-down').length, texts, gridlines, tags,
    lines: { high52: lineY('line.bc-high52'), pivot: lineY('line.bc-pivot'), stop: lineY('line.bc-stop'), plan: lineY('line.bc-planline') },
    zone: !!chart.querySelector('.bc-zone'), legs, lows: !!chart.querySelector('.bc-lows'), dry: !!chart.querySelector('.bc-note'), rs: !!chart.querySelector('path.bc-rs'),
    rsHigh: !!chart.querySelector('.bc-rshigh'), rsLead: chart.querySelectorAll('.bc-rslead').length, earn: !!chart.querySelector('.bc-earnflag, .bc-earnings'), breakout: chart.querySelector('.bc-breakout')?.getAttribute('data-tone') || null,
    sells: chart.querySelectorAll('.bc-sell').length, gaps: chart.querySelectorAll('.bc-gap').length,
    legendItems, legendHidden, readout: card.querySelector('.brief-readout')?.innerText.replace(/\s+/g, ' ').trim() || null,
    unverified: !!card.querySelector('.ro-unverified'),
    notes: [...document.querySelectorAll('.brief-note, .bc-notice')].map(n => n.textContent.replace(/\s+/g, ' ').trim()).filter(t => /チャート|週足|収縮|ピボット|損切り|52週|RS線|上抜け|決算|未検証|安値/.test(t)).slice(0, 12),
  };
}

const browser = await chromium.launch({ executablePath: '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/cft147/chrome-headless-shell-linux64/chrome-headless-shell' });
const index = [], errors = [];
for (const [width, symbols] of Object.entries(TARGETS)) {
  if (!symbols?.length) continue;
  const context = await browser.newContext({ ...VIEWPORTS[width], locale: 'ja-JP', reducedMotion: MODE === 'reduce' ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
  if (process.env.P3_THEME) await context.addInitScript(mode => { try { localStorage.setItem('screener:color-mode', mode); } catch { /* opaque */ } }, process.env.P3_THEME);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`${width}: ${e.message}`));
  await page.clock.setFixedTime(new Date(NOW));
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.fallback() : r.abort());
  await page.route('**/static-data/**', r => {
    const path = decodeURIComponent(new URL(r.request().url()).pathname.replace(/^.*\/static-data\//, ''));
    if (path === 'manifest.json') return r.fulfill({ json: manifest });
    if (path === 'research.json') return r.fulfill({ contentType: 'application/json', body: research });
    if (/^charts\/[^/]+\.json$/.test(path) && existsSync(`${SERVE}/${path}`)) return r.fulfill({ contentType: 'application/json', body: readFileSync(`${SERVE}/${path}`) });
    return r.fulfill({ status: 404, json: {} });
  });
  await page.goto(`${BASE}#/brief/stock/${encodeURIComponent(symbols[0])}`);
  for (const symbol of symbols) {
    await page.evaluate(s => { location.hash = `#/brief/stock/${encodeURIComponent(s)}`; }, symbol);
    const card = page.locator('.brief-chartcard').first();
    try { await card.waitFor({ state: 'visible', timeout: 120000 }); } catch { errors.push(`${width} ${symbol}: no chart card`); continue; }
    for (const [key, label] of PERIODS) {
      try {
        const button = card.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label });
        await button.click();
        await page.waitForFunction(b => b.getAttribute('aria-pressed') === 'true', await button.elementHandle(), { timeout: 20000 });
        const chart = card.getByTestId('brief-price-chart');
        await page.waitForFunction(([el, s]) => (el.getAttribute('aria-label') || '').startsWith(`${s} の`) && el.querySelector('svg rect.bc-up, svg rect.bc-down'), [await chart.elementHandle(), symbol], { timeout: 60000 });
        if (MODE === 'pulse') await page.waitForFunction(el => !!el.querySelector('.bc-pulsing'), await chart.elementHandle(), { timeout: 15000 });
        await page.evaluate(() => document.fonts.ready.then(() => true));
        await page.waitForTimeout(MODE === 'pulse' ? 400 : 150);
        const facts = await card.evaluate(probe);
        const file = `${OUT}/${symbol}-${key}-${width}.png`;
        await card.screenshot({ path: file, animations: 'disabled' });
        index.push({ symbol, period: key, width: Number(width), mode: MODE, file, ...facts });
      } catch (e) { errors.push(`${width} ${symbol} ${key}: ${e.message.split('\n')[0]}`); }
    }
  }
  await context.close();
}
await browser.close();
writeFileSync(`${OUT}/probe-${MODE}${process.env.P3_THEME ? '-' + process.env.P3_THEME : ''}.json`, JSON.stringify({ tree: TREE, now: NOW, mode: MODE, errors, renders: index }));
console.log(JSON.stringify({ renders: index.length, errors }, null, 1));
