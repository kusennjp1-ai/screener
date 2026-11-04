// Synthetic, clearly fictional data for the daily-brief browser specs. Every ticker
// starts with "ZZ" and every company name ends with "(synthetic)"; no value here is
// market data. The browser receives it through page.route, never from the network.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { FINANCIAL_TEST_DATE, FINANCIAL_TEST_NOW } from '../../src/static/testFinancialFixture.js';
import { SECTOR_ETFS } from '../../src/static/marketLongHistory.js';
import { secPoint, secRecord } from '../../src/test/fixtures/secRecord.js';

export const date = FINANCIAL_TEST_DATE;
export const now = FINANCIAL_TEST_NOW;
const sha = text => createHash('sha256').update(text).digest('hex');
const exchange = JSON.parse(readFileSync(new URL('../../src/static/__fixtures__/nyse-sessions-2024-2026.json', import.meta.url), 'utf8'));
const sessionsUntil = day => exchange.sessions.filter(session => session <= day);
export const sessions = sessionsUntil(date);
export const sessionCalendar = { ...exchange, as_of_date: date, range_end: date, sessions };
// Long-history fields an older capture never had (market-long-history-v1 before the environment counts).
const ENVIRONMENT_FIELDS = ['trendTemplateCount', 'trendTemplatePercent', 'rs90TemplateCount', 'above150', 'above150Percent', 'above200', 'above200Percent', 'stage1', 'stage2', 'stage3', 'stage4', 'breakouts', 'breakoutsJudged', 'breakoutsHeld', 'leaderCohort', 'leaderCohortAbove50'];

const SECTORS = ['Technology', 'Healthcare', 'Industrials', 'Consumer Cyclical', 'Financial', 'Energy', 'Communication Services', 'Basic Materials'];
const NAMES = [
  ['ZZNV', 'Novalux Semiconductor', 0], ['ZZAR', 'Arcquant Systems', 0], ['ZZHE', 'Helion Biologics', 1], ['ZZTR', 'Travex Robotics', 2],
  ['ZZMO', 'Mosaic Retail Group', 3], ['ZZKS', 'Kestrel Payments', 4], ['ZZPN', 'Permian North Energy', 5], ['ZZVX', 'Voxa Media', 6],
  ['ZZLI', 'Lithica Materials', 7], ['ZZCN', 'Cloudnest Software', 0], ['ZZOD', 'Orbital Defense', 2], ['ZZGX', 'Genexa Therapeutics', 1],
  ['ZZFW', 'Fluxwave Networks', 0], ['ZZBH', 'Brickline Homes', 3], ['ZZSG', 'Solara Grid', 5], ['ZZNH', 'Nexa Health', 1],
  ['ZZQL', 'Quantum Ledger', 4], ['ZZAS', 'Aerostrata', 2], ['ZZPF', 'Pixel Forge', 6], ['ZZCM', 'Crux Mining', 7],
  ['ZZDM', 'Dynamo Motion', 3], ['ZZSD', 'Synq Data', 0], ['ZZVL', 'Vitalis Labs', 1], ['ZZTS', 'Terawatt Storage', 5],
  ['ZZMC', 'Markit Commerce', 3], ['ZZZF', 'Zeal Fintech', 4], ['ZZOI', 'Optix Imaging', 0], ['ZZRS', 'Rally Sports', 3],
  ['ZZHW', 'Hydra Water', 2], ['ZZNS', 'Nova Satellite', 6],
];

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const round = value => Math.round(value * 100) / 100;

// An advance, then a contracting base of varying tightness, ending exactly at the row's price.
function bars(seed, finalPrice, tightness) {
  const r = rng(seed), days = sessions.slice(-280), n = days.length, out = [];
  const start = finalPrice * (0.45 + r() * 0.2);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    let trend = start + (finalPrice * 1.02 - start) * Math.min(1, t / 0.7);
    if (t > 0.7) { const k = (t - 0.7) / 0.3, amp = finalPrice * (0.12 * (1 - k) + 0.02) * tightness; trend = finalPrice * 0.97 + amp * Math.sin(k * Math.PI * 3); }
    const close = i === n - 1 ? finalPrice : Math.max(1, trend + (r() - 0.5) * finalPrice * 0.02);
    const open = close * (1 + (r() - 0.5) * 0.01);
    out.push({ date: days[i], open: round(open), close: round(close), high: round(Math.max(open, close) * (1 + r() * 0.012)),
      low: round(Math.min(open, close) * (1 - r() * 0.012)), volume: Math.round(2e6 * (0.6 + r()) * (t > 0.85 ? 0.6 : 1)) });
  }
  return out;
}

export const rows = NAMES.map(([symbol, company, sector], index) => {
  const r = rng(index + 7), price = round(20 + r() * 380);
  return withAuditFixture({
    symbol, company_name: `${company} (synthetic)`, currency: 'USD', market: 'US', gics_sector: SECTORS[sector],
    market_regime: 'confirmed_uptrend', market_above_50dma: true, market_above_200dma: true,
    ibd_industry_group: `${SECTORS[sector]} group ${1 + (index % 4)}`,
    current_price: price, se_pivot_price: round(price * (1 + (index % 5) * 0.012)),
    adv_usd: Math.round(2.5e7 + r() * 4e8), rs_rating: Math.max(55, Math.round(99 - index * 1.4 - r() * 4)), chart_path: `charts/${symbol}.json`,
    eps_growth_yy: Math.round(15 + r() * 120), sales_growth_yy: Math.round(10 + r() * 80), market_cap: Math.round(1e9 + r() * 2e11),
  }, date);
});
export const rowBySymbol = Object.fromEntries(rows.map(row => [row.symbol, row]));

// One stock has a canonical detail with a same-day SEC record: a June fiscal year whose Q4 EPS
// is only in the 10-K (the common 10-Q filer case), so the EPS tile falls back one quarter.
export const SEC_SYMBOL = 'ZZNV';
const SEC_QUARTERS = [['2024-07-01', '2024-09-30'], ['2024-10-01', '2024-12-31'], ['2025-01-01', '2025-03-31'], ['2025-04-01', '2025-06-30'],
  ['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31'], ['2026-01-01', '2026-03-31'], ['2026-04-01', '2026-06-30']];
const secFinancials = (() => {
  const record = secRecord({ symbol: SEC_SYMBOL, asOfDate: date, retrievedAt: `${date}T21:30:00.000Z`, quarters: SEC_QUARTERS });
  record.quarterly.eps = record.quarterly.eps.filter(point => !point.end.endsWith('06-30'));
  record.annualEps = [secPoint('eps', ['2024-07-01', '2025-06-30'], 4), secPoint('eps', ['2025-07-01', '2026-06-30'], 5.5)];
  return record;
})();
rowBySymbol[SEC_SYMBOL].research_detail_path = `research-details/${SEC_SYMBOL}-detail.json`;
export const details = { [`${SEC_SYMBOL}-detail.json`]: { ...rowBySymbol[SEC_SYMBOL], as_of_date: date, book_financials: secFinancials } };

export const charts = Object.fromEntries(rows.map((row, index) => [row.chart_path.split('/').pop(), {
  symbol: row.symbol, as_of_date: date, bars: bars(index + 101, row.current_price, 0.5 + (index % 4) * 0.4),
  session_calendar: sessionCalendar, stock_data: row, rs_line: [],
}]));

/**
 * A market-trends asset (market-trends-v1 with a market-long-history-v1 body) that passes the
 * app's own validation. With `historyEnd` before the analysis date, the long history and the
 * index series stop at that session while the asset itself still names the analysis date. With
 * `schema: 'old'` the long history is written as before the market-environment fields existed
 * (no trend-template, 150/200-day, stage, breakout or leader-cohort counts), as older captures are.
 */
export function marketTrends({ historyEnd = date, schema = 'current' } = {}) {
  const days = sessionsUntil(historyEnd), n = days.length;
  const stamp = `${historyEnd}T21:00:00.000Z`, provenanceStamp = `${historyEnd}T20:30:00.000Z`;
  const symbols = Array.from({ length: 100 }, (_, i) => `ZZU${String(i).padStart(3, '0')}`);
  let level = 3600;
  const sp500 = days.map((day, i) => { level *= 1 + 0.0005 + Math.sin(i / 37) * 0.002 + (i > n - 160 && i < n - 110 ? -0.003 : 0) + (i >= n - 110 ? 0.0012 : 0); return { date: day, close: round(level) }; });
  const breadth = days.map((day, i) => {
    const coverage = 100;
    const tt = Math.max(2, Math.round(24 + 14 * Math.sin(i / 90) + 4 * Math.sin(i / 17) + (i > n - 40 ? -6 : 0)));
    const a200 = Math.min(95, Math.max(5, Math.round(55 + 18 * Math.sin(i / 120) - (i > n - 60 ? 12 : 0)))), a150 = Math.min(98, a200 + 4);
    const s2 = Math.max(5, Math.round(36 + 14 * Math.sin(i / 110))), s4 = Math.max(4, Math.round(22 - 9 * Math.sin(i / 110))), s3 = Math.round(20 + 4 * Math.cos(i / 60));
    const judged = i < 30 ? null : 8 + Math.round(4 + 3 * Math.sin(i / 23)), held = judged === null ? null : Math.round(judged * (0.55 + 0.2 * Math.sin(i / 80)));
    const cohort = i < 20 ? null : Math.max(2, tt + 2);
    return { date: day, coverage, eligibleUniverse: 100, universe: 100, coveragePercent: 100, above50: 50, above50Percent: 50, newHighs: 2, newLows: 3, leaderCount: 4,
      stocks_up_4pct: 6, stocks_down_4pct: 3, ratio_10day: i < 9 ? null : 2,
      trendTemplateCount: tt, trendTemplatePercent: 100 * tt / coverage, rs90TemplateCount: Math.round(tt * 0.3),
      above150: a150, above150Percent: 100 * a150 / coverage, above200: a200, above200Percent: 100 * a200 / coverage,
      stage1: coverage - s2 - s3 - s4, stage2: s2, stage3: s3, stage4: s4, breakouts: Math.round(1 + Math.max(0, Math.sin(i / 11)) * 3),
      breakoutsJudged: judged, breakoutsHeld: held, leaderCohort: cohort,
      leaderCohortAbove50: cohort === null ? null : Math.round(cohort * (0.7 + 0.2 * Math.sin(i / 50) - (i > n - 30 ? 0.35 : 0))) };
  });
  if (schema === 'old') for (const row of breadth) for (const key of ENVIRONMENT_FIELDS) delete row[key];
  const ranks = SECTOR_ETFS.map((symbol, i) => ({ symbol, rank: i + 1, relativeIndex: 120 - i }));
  const history = {
    schema_version: 'market-long-history-v1', market: 'US', as_of_date: historyEnd, retrieved_at: stamp,
    universe: { basis: 'current-published-universe-retrospective', historical_membership_verified: false, historical_fundamentals_verified: false, symbols, sha256: sha(JSON.stringify(symbols)) },
    calendar: { provider: 'pandas_market_calendars:NYSE', sessions: days }, breadth, sp500,
    provenance: [...symbols, '^GSPC', 'SPY', ...SECTOR_ETFS].map(symbol => ({ symbol, url: `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, sha256: sha(`synthetic ${symbol}`), retrieved_at: provenanceStamp })),
    sectorRotation: { lookback_sessions: 126, frames: days.slice(-252).map(day => ({ date: day, ranks })) },
  };
  const recent = days.slice(-280), ago = k => recent[recent.length - 1 - k], historical = historyEnd < date;
  // The exporter's shape (tools/export-market-trends.mjs): an index series that ends before the
  // analysis date keeps its points and lastObserved but withholds `latest` and says why.
  const FTD_METHOD = 'rally-attempt-gain1.2-day4-15-decline6-v1';
  const follow = {
    '^GSPC': { available: true, method: FTD_METHOD, asOf: historyEnd, state: 'confirmed', peak: { date: ago(60), close: 5400 }, low: { date: ago(40), low: 4980 }, declinePct: 7.6,
      attempt: null, ftd: { date: ago(35), attemptDay: 5, gainPct: 1.62, volumeRatio: 1.18, sessionsSince: 35, distributionSince: 3 }, failedDate: null, events: [] },
    '^IXIC': { available: true, method: FTD_METHOD, asOf: historyEnd, state: 'rally_attempt', peak: { date: ago(30), close: 17800 }, low: { date: ago(3), low: 16420 }, declinePct: 7.4,
      attempt: { startDate: ago(2), day: 3 }, ftd: null, failedDate: null, events: [] },
  };
  const index = (symbol, active) => {
    const events = active.map(k => ({ date: ago(k), close: 5000, changePct: -0.6, volumeRatio: 1.1, state: 'active', removedDate: null, removal: null, ageSessions: k }));
    const points = recent.map((day, i) => ({ date: day, value: i < 25 ? null : active.filter(k => recent.length - 1 - k <= i).length, distribution: events.some(e => e.date === day), reason: null }));
    return { symbol, available: !historical, points, events, latest: historical ? null : points.at(-1), lastObserved: { date: points.at(-1).date, value: points.at(-1).value },
      ...(historical ? { historical: true, reason: `${date}は未取得。${historyEnd}までの過去記録を表示しています。` } : {}), followThrough: follow[symbol] };
  };
  // The exchange schedule says which session has closed by `now` (the analysis date), independent of the data.
  const schedule = exchange.sessions.filter(session => session > sessions.at(-6) && session <= exchange.sessions[exchange.sessions.indexOf(date) + 3]);
  const value = { schema_version: 'market-trends-v1', market: 'US', as_of_date: date, indices: [index('^GSPC', [3, 11, 19]), index('^IXIC', [2, 7, 13, 21])],
    breadth: { points: [] }, put_call: { points: [] }, long_history: history,
    refresh_schedule: { provider: 'pandas_market_calendars:NYSE', valid_until: `${schedule.at(-1)}T23:00:00Z`, sessions: schedule.map(session => ({ date: session, close_at: `${session}T20:00:00Z` })) } };
  const text = JSON.stringify(value), digest = sha(text);
  return { text, file: `series-${digest}.json`, ref: { schema_version: 'market-trends-v1', market: 'US', as_of_date: date, sha256: digest, path: `market-trends/series-${digest}.json` } };
}

/** Serve the synthetic publication for every static-data request; abort everything that is not 127.0.0.1. */
/**
 * `fail` names one file to answer with an HTTP error: 'series' (404 for the market series), 'manifest'
 * (503) or 'detail' (503 for every research detail). `detailGate` is a promise every research detail
 * waits for before it answers (a detail that is still loading).
 */
export async function routeBrief(page, { historyEnd = date, schema, fail, detailGate } = {}) {
  const trends = marketTrends({ historyEnd, schema });
  const external = [];
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') return route.fallback();
    external.push(route.request().url());
    return route.abort();
  });
  await page.route('**/static-data/**', async route => {
    const file = new URL(route.request().url()).pathname.split('/').pop();
    if (file === 'manifest.json' && fail === 'manifest') return route.fulfill({ status: 503, json: {} });
    if (file === trends.file && fail === 'series') return route.fulfill({ status: 404, json: {} });
    if (file === 'manifest.json') return route.fulfill({ json: { as_of_date: date, generated_at: new Date(now).toISOString(), research_generation: 'brief-browser-fixture',
      default_market: 'US', supported_markets: ['US'], markets: { US: { as_of_date: date, assets: { research: { path: 'research.json' }, market_trends: trends.ref }, pages: {} } } } });
    if (file === 'research.json') return route.fulfill({ json: { as_of_date: date, rows } });
    if (file === trends.file) return route.fulfill({ contentType: 'application/json', body: trends.text });
    if (details[file] && fail === 'detail') return route.fulfill({ status: 503, json: {} });
    if (details[file]) { if (detailGate) await detailGate; return route.fulfill({ json: details[file] }); }
    if (charts[file]) return route.fulfill({ json: charts[file] });
    return route.fulfill({ status: 404, json: {} });
  });
  return { external, trends };
}

/**
 * A fresh page on the synthetic publication at the fixed analysis clock, collecting page errors.
 * `storage` seeds localStorage once per tab (a later change and reload keep the user's choice),
 * e.g. { 'research-watch': ['ZZNV'] } or { 'screener:color-mode': 'light' }.
 */
export async function openBrief(page, hash = '#/brief', { historyEnd, schema, storage, fail, detailGate } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  if (storage) await page.addInitScript(entries => {
    try {
      if (sessionStorage.getItem('brief-spec-seeded')) return;
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      sessionStorage.setItem('brief-spec-seeded', '1');
    } catch { /* storage blocked: the app must still render */ }
  }, storage);
  const network = await routeBrief(page, { historyEnd, schema, fail, detailGate });
  await page.goto(`/${hash}`);
  return { errors, external: network.external };
}

/** Wide and phone viewports the specs run at; the phone uses touch and the mobile layout. */
export const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
};

export const horizontalOverflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** axe-core from node_modules, injected into the page; returns violations for the WCAG 2.x A/AA rules. */
export async function axeViolations(page) {
  await page.addScriptTag({ path: new URL('../../node_modules/axe-core/axe.min.js', import.meta.url).pathname });
  return page.evaluate(async () => {
    const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
    return result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 5).map(node => ({ target: node.target.join(' '), summary: node.failureSummary })) }));
  });
}
