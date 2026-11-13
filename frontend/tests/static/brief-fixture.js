// Synthetic, clearly fictional data for the daily-brief browser specs. Every ticker
// starts with "ZZ" and every company name ends with "(synthetic)"; no value here is
// market data. The browser receives it through page.route, never from the network.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { auditDailyBars } from '../../src/static/qualificationAudit.js';
import { FINANCIAL_TEST_DATE, FINANCIAL_TEST_NOW } from '../../src/static/testFinancialFixture.js';
import { SECTOR_ETFS } from '../../src/static/marketLongHistory.js';
import { secPoint, secRecord } from '../../src/test/fixtures/secRecord.js';
import { priceActivity } from '../../src/static/priceActivity.js';

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

/**
 * A variant of base data for one spec: the mutator gets a deep copy of the base and either changes it in
 * place or returns the value to use. The base itself (rows, charts, details, the market trends) never changes.
 */
const variant = (base, mutator) => {
  if (!mutator) return base;
  const copy = structuredClone(base), value = mutator(copy);
  return value === undefined ? copy : value;
};

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
  // The analysis day as every row's audit states it (withAuditFixture: +2.0% on 1.6× the prior 50 sessions), so the
  // chart's readout and the rows read one day: the session before closes 2% under the row's price, and the last one
  // trades 1.6 times their average (rounded up, so it reads 1.60×).
  const [before, last] = out.slice(-2);
  before.close = round(finalPrice / 1.02);
  Object.assign(before, { high: Math.max(before.high, before.open, before.close), low: Math.min(before.low, before.open, before.close) });
  last.volume = Math.ceil(out.slice(-51, -1).reduce((sum, bar) => sum + bar.volume, 0) / 50 * 1.6);
  return out;
}

/** The analysis day's change and volume ratio from published bars, as the exporter's audit computes them (auditDailyBars). */
function barsAudit(list) {
  const last = list.at(-1), before = list.at(-2), average = list.slice(-51, -1).reduce((sum, bar) => sum + bar.volume, 0) / 50;
  return { change: (last.close / before.close - 1) * 100, volumeRatio: average > 0 ? last.volume / average : null };
}

/**
 * A variant served as the exporter would write it: a row's technical_audit and its chart describe the same bars
 * (export-research.mjs computes one from the other, and certifyBars refuses a pair that drifted apart). When a spec
 * changes a chart's last 51 sessions, the row's (and its detail's) day change and volume ratio follow those bars; when
 * it changes only the row's day change or volume ratio, the chart's last two sessions follow the row. Bars whose last
 * close is not the row's price are left as they are (they are not certified anyway). The opt-in oracles (ORACLE_ROWS,
 * ORACLE_CHARTS) take the same path: their base is their own row and chart.
 */
function consistent(served) {
  const tail = list => JSON.stringify((list || []).slice(-52).map(bar => [bar?.date, bar?.close, bar?.volume]));
  const day = row => [row?.technical_audit?.values?.change, row?.technical_audit?.values?.volumeRatio];
  const fix = {};
  for (const row of served.rows) {
    const file = row.chart_path?.split('/').pop(), chart = served.charts[file], base = rowBySymbol[row.symbol] ?? oracleRowBySymbol[row.symbol];
    if (!chart || !base || !Array.isArray(chart.bars) || chart.bars.length < 52 || Math.abs(chart.bars.at(-1).close - row.current_price) > 0.02 || row.technical_audit?.as_of_date !== date) continue;
    if (tail(chart.bars) !== tail((charts[file] ?? ORACLE_CHARTS[file])?.bars)) fix[row.symbol] = { audit: barsAudit(chart.bars) };
    else if (JSON.stringify(day(row)) !== JSON.stringify(day(base))) fix[row.symbol] = { file, bars: day(row) };
  }
  if (!Object.keys(fix).length) return served;
  const out = { rows: served.rows === rows ? structuredClone(rows) : served.rows, charts: served.charts === charts ? structuredClone(charts) : served.charts,
    details: served.details === details ? structuredClone(details) : served.details };
  const setAudit = (row, values) => { row.technical_audit = { ...row.technical_audit, values: { ...row.technical_audit.values, ...values } }; };
  for (const row of [...out.rows, ...Object.values(out.details)]) if (fix[row?.symbol]?.audit) setAudit(row, fix[row.symbol].audit);
  for (const { file, bars: values } of Object.values(fix)) {
    if (!file) continue;
    const list = out.charts[file].bars, [change, ratio] = values, [before, last] = list.slice(-2);
    if (Number.isFinite(change) && change > -100) {
      before.close = round(last.close / (1 + change / 100));
      Object.assign(before, { high: Math.max(before.high, before.open, before.close), low: Math.min(before.low, before.open, before.close) });
    }
    if (Number.isFinite(ratio) && ratio >= 0) last.volume = Math.ceil(list.slice(-51, -1).reduce((sum, bar) => sum + bar.volume, 0) / 50 * ratio);
  }
  return out;
}

// Every row's Setup Engine base is current for the analysis date (recalculated that day, no failed check named)
// with a pattern confidence of 60: over the base check's floor of 55 and under portfolioPlan's 70, so the plan's
// candidates do not change. A spec builds a missing, stale or weak base with `mutate`.
export const SETUP_CONFIDENCE = 60;
export const rows = NAMES.map(([symbol, company, sector], index) => {
  const r = rng(index + 7), price = round(20 + r() * 380);
  return withAuditFixture({
    symbol, company_name: `${company} (synthetic)`, currency: 'USD', market: 'US', gics_sector: SECTORS[sector],
    market_regime: 'confirmed_uptrend', market_above_50dma: true, market_above_200dma: true,
    ibd_industry_group: `${SECTORS[sector]} group ${1 + (index % 4)}`,
    current_price: price, se_pivot_price: round(price * (1 + (index % 5) * 0.012)),
    se_pattern_confidence: SETUP_CONFIDENCE, setup_recalculation: { status: 'calculated', as_of_date: date },
    adv_usd: Math.round(2.5e7 + r() * 4e8), rs_rating: Math.max(55, Math.round(99 - index * 1.4 - r() * 4)), chart_path: `charts/${symbol}.json`,
    eps_growth_yy: Math.round(15 + r() * 120), sales_growth_yy: Math.round(10 + r() * 80), market_cap: Math.round(1e9 + r() * 2e11),
  }, date);
});
export const rowBySymbol = Object.fromEntries(rows.map(row => [row.symbol, row]));

// One stock has a canonical detail with a same-day SEC record: a June fiscal year whose Q4 EPS
// is only in the 10-K (the common 10-Q filer case), so the EPS tile falls back one quarter. As
// sec-financials.py writes it, a fiscal Q4 never comes from a 10-Q: its revenue and net income are
// the 10-K's fiscal-year values minus three quarters (derived, naming the four source filings).
export const SEC_SYMBOL = 'ZZNV';
const SEC_QUARTERS = [['2024-07-01', '2024-09-30'], ['2024-10-01', '2024-12-31'], ['2025-01-01', '2025-03-31'], ['2025-04-01', '2025-06-30'],
  ['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31'], ['2026-01-01', '2026-03-31'], ['2026-04-01', '2026-06-30']];
const tenK = end => ({ form: '10-K', filed: new Date(Date.parse(end) + 40 * 86400000).toISOString().slice(0, 10), accession: `0000000001-${end.slice(2, 4)}-${end.slice(5, 7)}${end.slice(8)}10` });
const secFinancials = (() => {
  const record = secRecord({ symbol: SEC_SYMBOL, asOfDate: date, retrievedAt: `${date}T21:30:00.000Z`, quarters: SEC_QUARTERS });
  record.quarterly.eps = record.quarterly.eps.filter(point => !point.end.endsWith('06-30'));
  // A June fiscal year files its December quarter on a 10-Q (secPoint assumes a calendar year).
  for (const key of ['eps', 'revenue', 'netIncome']) for (const point of record.quarterly[key]) point.form = '10-Q';
  for (const key of ['revenue', 'netIncome']) for (const point of record.quarterly[key].filter(p => p.end.endsWith('06-30'))) {
    const filing = tenK(point.end);
    const quarters = record.quarterly[key].filter(p => p.end < point.end && p.end > `${Number(point.end.slice(0, 4)) - 1}-06-30`).map(p => p.accession);
    Object.assign(point, filing, { derived: 'fiscal-year-minus-three-quarters', components: [filing.accession, ...quarters] });
  }
  record.annualEps = [secPoint('eps', ['2024-07-01', '2025-06-30'], 4, tenK('2025-06-30')), secPoint('eps', ['2025-07-01', '2026-06-30'], 5.5, tenK('2026-06-30'))];
  return record;
})();
rowBySymbol[SEC_SYMBOL].research_detail_path = `research-details/${SEC_SYMBOL}-detail.json`;
export const details = { [`${SEC_SYMBOL}-detail.json`]: { ...rowBySymbol[SEC_SYMBOL], as_of_date: date, book_financials: secFinancials } };

export const charts = Object.fromEntries(rows.map((row, index) => [row.chart_path.split('/').pop(), {
  symbol: row.symbol, as_of_date: date, bars: bars(index + 101, row.current_price, 0.5 + (index % 4) * 0.4),
  session_calendar: sessionCalendar, stock_data: row, rs_line: [],
}]));

// ── Round-3 oracles (STEP 0; opt-in, frozen with this file) ──────────────────────────────────────────────────────────
// Synthetic stocks with one shape each, served only with `oracles: true` (openBrief, routeBrief). Each is built like a
// default row (withAuditFixture) with its own bars' audit values (auditDailyBars: the close, day change and volume ratio
// consistent() checks, and the averages and 52-week range the trend template reads), so its bars certify. Tickers start with ZZ and collide with no default symbol (nor ZZU000–ZZU099); every
// company name ends in "(synthetic)". docs/round3/step0.md describes each oracle and what it is for.

/**
 * 280 daily bars ending on the analysis day: closes follow the `anchors` ([index, close], linear between them) with a
 * seeded wiggle; highs and lows sit `spread` around the open and close; `volume` is the base volume. `at[i]` overrides
 * any field of bar i (a function gets the bar and the list so far). The high and low always cover the open and close.
 */
function shapedBars(seed, anchors, { wiggle = 0.003, spread = 0.006, volume = 2e6, at = {} } = {}) {
  const r = rng(seed), days = sessions.slice(-280), out = [];
  let k = 0;
  for (let i = 0; i < days.length; i++) {
    while (k < anchors.length - 2 && anchors[k + 1][0] <= i) k++;
    const [i0, c0] = anchors[k], [i1, c1] = anchors[k + 1], t = Math.min(1, Math.max(0, (i - i0) / (i1 - i0)));
    const close = round((c0 + (c1 - c0) * t) * (1 + (r() - 0.5) * 2 * wiggle)), open = round(close * (1 + (r() - 0.5) * wiggle));
    let bar = { date: days[i], open, close, high: round(Math.max(open, close) * (1 + r() * spread)), low: round(Math.min(open, close) * (1 - r() * spread)),
      volume: Math.round(volume * (0.7 + 0.6 * r())) };
    const change = at[i];
    if (change) bar = { ...bar, ...(typeof change === 'function' ? change(bar, out) : change) };
    out.push({ ...bar, high: Math.max(bar.high, bar.open, bar.close), low: Math.min(bar.low, bar.open, bar.close) });
  }
  return out;
}
/** The average volume of the `n` bars before bar i. */
const priorVolume = (list, i, n = 50) => list.slice(i - n, i).reduce((sum, bar) => sum + bar.volume, 0) / n;

/** One oracle: its row (withAuditFixture, with its bars' own audit values), its chart and, with `detail`, its research detail. */
function oracle(symbol, company, sector, list, extra = {}, { rsLine = [], detail = null } = {}) {
  const row = withAuditFixture({
    symbol, company_name: `${company} (synthetic)`, currency: 'USD', market: 'US', gics_sector: SECTORS[sector],
    market_regime: 'confirmed_uptrend', market_above_50dma: true, market_above_200dma: true, ibd_industry_group: `${SECTORS[sector]} group 1`,
    current_price: list.at(-1).close, se_pattern_confidence: SETUP_CONFIDENCE, setup_recalculation: { status: 'calculated', as_of_date: date },
    adv_usd: 6e7, rs_rating: 92, chart_path: `charts/${symbol}.json`, eps_growth_yy: 55, sales_growth_yy: 32, market_cap: 8e9, ...extra,
  }, date);
  // The audit is the bars' own (auditDailyBars, as the exporter publishes it): its close, day change and volume ratio
  // certify the bars (consistent()'s rule) and its averages and 52-week high and low are these bars', not synthetic.
  const audit = auditDailyBars(row, { symbol, as_of_date: date, bars: list, session_calendar: sessionCalendar }, date);
  if (!audit.valid) throw Error(`oracle ${symbol}: ${audit.errors.join(', ')}`);
  row.technical_audit = { ...row.technical_audit, values: { ...row.technical_audit.values, ...audit.values } };
  if (detail) row.research_detail_path = `research-details/${symbol}-detail.json`;
  const chart = { symbol, as_of_date: date, bars: list, session_calendar: sessionCalendar, stock_data: row, rs_line: rsLine };
  return { row, chart, detail: detail ? { ...row, as_of_date: date, ...detail(row) } : null };
}

/** An RS line as the exporter writes it (close ÷ benchmark per bar), from the RS value `rs(i)` each bar should have. */
const rsLineOf = (list, rs) => list.map((bar, i) => { const benchmark = Math.round(bar.close / rs(i) * 1e4) / 1e4; return { time: bar.date, value: bar.close / benchmark }; });
/** An advance, a base 5% under its high, the last close 2.5% above its prior close: the RS oracles' price. */
const rsPrice = seed => shapedBars(seed, [[0, 34], [150, 61], [200, 72], [228, 64], [258, 70], [279, 68.4]]);

// ZZRL: the RS line at a new high on the analysis day while the price is still under its high (an RS lead mark on the
// last bar), as the published rs_line_high says.
const zzrlBars = rsPrice(301);
const ZZRL = oracle('ZZRL', 'Relay Logic', 0, zzrlBars, { se_pivot_price: round(Math.max(...zzrlBars.slice(-60).map(b => b.high))), se_pattern_primary: 'cup_with_handle',
  rs_line_high: { value: true, leading: true, as_of_date: date } }, { rsLine: rsLineOf(zzrlBars, i => 1 + i * 0.002) });
// ZZRW: an RS line that peaked 80 sessions ago and is now 15% under its high (no new high, no lead).
const zzrwBars = rsPrice(302), rsPeak = 1 + 199 * 0.002;
const ZZRW = oracle('ZZRW', 'Ridgeway Freight', 2, zzrwBars, { se_pivot_price: round(Math.max(...zzrwBars.slice(-60).map(b => b.high))), se_pattern_primary: 'cup_with_handle',
  rs_line_high: { value: false, leading: false, as_of_date: date } }, { rsLine: rsLineOf(zzrwBars, i => (i < 200 ? 1 + i * 0.002 : rsPeak * (1 - 0.15 * (i - 199) / 80))) });

// ZZHB: a held breakout from a weekly pattern. se_pivot_date is the pivot week's Friday label (2026-09-25); the bar whose
// high is the pivot is that week's Tuesday (2026-09-22). The close crossed the pivot on 2026-09-28 (4 sessions before
// the analysis day) on 2.4× the prior 50 sessions, and every close since is at or above the pivot (in the buy zone).
const HB_PIVOT = 48.5;
const zzhbBars = shapedBars(303, [[0, 26], [170, 51.5], [205, 40], [255, 47.4], [262, 47.6], [268, 46.4], [271, 48], [274, 46.9], [275, 49.7], [279, 50]], { at: {
  271: { open: 47.8, close: 48.05, high: HB_PIVOT, low: 47.6 },
  275: (bar, list) => ({ open: 47.3, close: 49.7, high: 49.95, low: 47.2, volume: Math.ceil(priorVolume([...list, bar], 275) * 2.4) }),
  276: { open: 49.6, close: 49.4, high: 49.9, low: 49.1 }, 277: { open: 49.5, close: 49.8, high: 50.1, low: 49.3 },
  278: { open: 49.8, close: 49.75, high: 50.05, low: 49.5 }, 279: { open: 49.8, close: 50, high: 50.2, low: 49.6 } } });
const ZZHB = oracle('ZZHB', 'Harbor Biotics', 1, zzhbBars, { se_pivot_price: HB_PIVOT, se_pivot_date: '2026-09-25', se_pivot_type: 'handle_high', se_pattern_primary: 'cup_with_handle' });

// ZZRD: a ready Setup Engine base (se_setup_ready, confidence 78) with three measurable, shallower contractions
// (about 18%, 8% and 5%) on falling volume, the last one under its prior 50-session average; the close is 2% under the
// pivot (the last contraction's high; no close has reached it since the first contraction), in the early zone. A VCP
// primary publishes no pivot date (vcp_wrapper.py).
const zzrdBars = shapedBars(304, [[0, 30], [195, 60], [213, 49.4], [230, 57], [240, 52.8], [255, 57.6], [262, 54.9], [279, 56.6]],
  { volume: 2e6, at: Object.fromEntries(Array.from({ length: 85 }, (_, j) => 195 + j).map(i => [i, bar => ({ volume: Math.round(bar.volume * (i < 230 ? 1 : i < 255 ? 0.75 : 0.45)) })])) });
const rdPivot = Math.max(...zzrdBars.slice(245, 262).map(b => b.high));
zzrdBars[279] = { ...zzrdBars[279], open: round(rdPivot * 0.975), close: round(rdPivot * 0.98) };
zzrdBars[279] = { ...zzrdBars[279], high: Math.max(zzrdBars[279].high, zzrdBars[279].open, zzrdBars[279].close), low: Math.min(zzrdBars[279].low, zzrdBars[279].open, zzrdBars[279].close) };
const ZZRD = oracle('ZZRD', 'Redline Devices', 0, zzrdBars, { se_pivot_price: rdPivot, se_pattern_primary: 'vcp', se_pattern_confidence: 78, se_setup_ready: true,
  se_volume_vs_50d: 0.62, se_quiet_days_10d: 7, se_base_length_weeks: 12, se_base_depth_pct: 18 });

// ZZPM: a same-day detail whose SEC record is the published invalid_payload signature (PayloadMismatch with
// received_cik null), in the shape tools/sec-financials.py writes it (unavailable() plus invalid_detail()).
const zzpmBars = shapedBars(305, [[0, 42], [150, 76], [200, 88], [228, 79], [258, 86], [279, 84.2]]);
const ZZPM = oracle('ZZPM', 'Pinemark Materials', 7, zzpmBars, { se_pivot_price: round(Math.max(...zzpmBars.slice(-60).map(b => b.high))), se_pattern_primary: 'cup_with_handle' }, {
  detail: row => ({ sec_admission: { state: 'admitted', reason: null }, book_financials: { schema_version: 2, symbol: row.symbol, as_of_date: date, status: 'unavailable',
    reason: 'invalid_payload', error: 'SEC取得不可: PayloadMismatch', retrieved_at: `${date}T21:30:00.000Z`,
    invalid_detail: { class: 'PayloadMismatch', message: 'companyfacts cik does not match the requested cik', requested_cik: 1000001, received_cik: null } } }) });

// ZZQF: a June fiscal year whose September 10-Q is filed (10-01), so the derived June Q4s sit inside the card's
// window, not at its newest edge. Q4 EPS is untagged (10-K only); Q4 revenue and net income are derived as
// sec-financials.py derives them. The known EPS growth rises around the missing June Q4, so EPS acceleration (and Code 33)
// stays unknown because of that Q4 (cause fiscal_q4_untagged); sales and margin rise with the derived Q4s. Only keys the
// 8849bf9 admission accepts.
const QF_QUARTERS = [...SEC_QUARTERS, ['2026-07-01', '2026-09-30']];
const zzqfFinancials = (() => {
  const record = secRecord({ symbol: 'ZZQF', cik: 1000003, asOfDate: date, retrievedAt: `${date}T21:30:00.000Z`, quarters: QF_QUARTERS,
    eps: [1, 1, 1, 1.05, 1.1, 1.3, 1.4, 1.8, 1.9], revenue: [80, 85, 90, 95, 100, 110, 122, 136, 150], netIncome: [8, 9, 10, 11, 12, 14, 16, 19, 23] });
  record.quarterly.eps = record.quarterly.eps.filter(point => !point.end.endsWith('06-30'));
  for (const key of ['eps', 'revenue', 'netIncome']) for (const point of record.quarterly[key]) {
    point.form = '10-Q';
    if (point.end === '2026-09-30') Object.assign(point, { filed: '2026-10-01', accession: '0000000003-26-093000' });
  }
  for (const key of ['revenue', 'netIncome']) for (const point of record.quarterly[key].filter(p => p.end.endsWith('06-30'))) {
    const filing = tenK(point.end);
    const quarters = record.quarterly[key].filter(p => p.end < point.end && p.end > `${Number(point.end.slice(0, 4)) - 1}-06-30`).map(p => p.accession);
    Object.assign(point, filing, { derived: 'fiscal-year-minus-three-quarters', components: [filing.accession, ...quarters] });
  }
  record.annualEps = [secPoint('eps', ['2024-07-01', '2025-06-30'], 4.05, tenK('2025-06-30')), secPoint('eps', ['2025-07-01', '2026-06-30'], 5.6, tenK('2026-06-30'))];
  return record;
})();
const zzqfBars = shapedBars(306, [[0, 31], [150, 57], [200, 67], [228, 60], [258, 66], [279, 64.3]]);
const ZZQF = oracle('ZZQF', 'Quillfield Software', 0, zzqfBars, { se_pivot_price: round(Math.max(...zzqfBars.slice(-60).map(b => b.high))), se_pattern_primary: 'cup_with_handle' }, {
  detail: () => ({ sec_admission: { state: 'admitted', reason: null }, book_financials: zzqfFinancials }) });

// ZZNR: an NR7/inside-day pivot (se_pivot_date the day before the analysis day, its high the pivot) that a close crossed
// on 2.1× volume 7 sessions earlier (2026-09-23), before the pivot formed; the last close is under the pivot (MGRC's shape).
const NR_PIVOT = 62.4;
const zznrBars = shapedBars(307, [[0, 33], [165, 64.8], [200, 55], [240, 60.6], [271, 61.4]], { at: {
  272: (bar, list) => ({ open: 61.5, close: 63.15, high: 63.4, low: 61.3, volume: Math.ceil(priorVolume([...list, bar], 272) * 2.1) }),
  273: { open: 63.1, close: 63.65, high: 63.9, low: 62.9 }, 274: { open: 63.6, close: 63.3, high: 63.8, low: 62.95 },
  275: { open: 63, close: 62.1, high: 63.1, low: 61.9 }, 276: { open: 62.1, close: 61.8, high: 62.3, low: 61.5 },
  277: { open: 61.7, close: 61.45, high: 62.6, low: 61.05 }, 278: { open: 61.6, close: 61.8, high: NR_PIVOT, low: 61.4 },
  279: { open: 61.75, close: 61.5, high: 61.95, low: 61.3 } } });
const ZZNR = oracle('ZZNR', 'Northridge Robotics', 2, zznrBars, { se_pivot_price: NR_PIVOT, se_pivot_date: '2026-10-01', se_pivot_type: 'nr7_inside_day_trigger_high',
  se_pattern_primary: 'nr7_inside_day' });

// ZZPG: three contracting legs, then a +44% one-day gap (2026-08-27) on 50× the prior 50 sessions, then 25 sessions
// closing within 36.31–36.49 (ADR20 about 0.15%); the cup-with-handle pivot 36.45 is the high of 2026-09-23 (its week is
// labelled 2026-09-25) and the last crossing (2026-09-30, light volume) follows it (PCRX's shape). price_activity is
// computed as the exporter computes it (priceActivity).
const PG_PIVOT = 36.45, PG_BAND = [36.38, 36.42, 36.47, 36.33, 36.4, 36.31, 36.44, 36.36, 36.49, 36.35, 36.41, 36.32, 36.43, 36.39, 36.46, 36.37,
  36.42, 36.34, 36.38, 36.4, 36.36, 36.43, 36.47, 36.48, 36.46];
const PG_HIGHS = { 257: 36.58, 270: 36.42, 271: 36.44, 272: PG_PIVOT, 273: 36.43, 274: 36.4 };
const zzpgBars = shapedBars(308, [[0, 12], [155, 27], [175, 21.7], [195, 26.3], [205, 23.5], [222, 25.9], [240, 25.8], [252, 24.75], [253, 25.2]], {
  volume: 1e6, at: {
    252: { open: 24.9, close: 24.8, high: 25.0, low: 24.56 }, 253: { open: 24.85, close: 25.2, high: 25.3, low: 24.8 },
    254: (bar, list) => ({ open: 35.1, close: 36.39, high: 36.6, low: 34.9, volume: Math.ceil(priorVolume([...list, bar], 254) * 50) }),
    ...Object.fromEntries(PG_BAND.map((close, j) => [255 + j, { open: round(close - 0.01), close, high: PG_HIGHS[255 + j] ?? round(Math.min(close + 0.03, j > 14 && j < 20 ? 36.44 : 36.52)),
      low: round(close - 0.025), volume: Math.round(2.6e6 * (1 - j * 0.03)) }])),
  } });
const ZZPG = oracle('ZZPG', 'Pellgate Pharma', 1, zzpgBars, { se_pivot_price: PG_PIVOT, se_pivot_date: '2026-09-25', se_pivot_type: 'handle_high',
  se_pattern_primary: 'cup_with_handle', price_activity: priceActivity(zzpgBars) });

const ORACLES = [ZZRL, ZZRW, ZZHB, ZZRD, ZZPM, ZZQF, ZZNR, ZZPG];
/** The oracles' research rows (served after the default rows with `oracles: true`). */
export const ORACLE_ROWS = ORACLES.map(o => o.row);
/** The oracles' chart payloads by file name. */
export const ORACLE_CHARTS = Object.fromEntries(ORACLES.map(o => [o.row.chart_path.split('/').pop(), o.chart]));
/** The oracles' research details by file name (ZZPM and ZZQF). */
export const ORACLE_DETAILS = Object.fromEntries(ORACLES.filter(o => o.detail).map(o => [o.row.research_detail_path.split('/').pop(), o.detail]));
/** Each oracle's symbol by its name in the plan; ZZNV (a default row) is the fiscal_q4_untagged oracle. */
export const ORACLE = Object.freeze({ rsHigh: 'ZZRL', rsLagging: 'ZZRW', heldBreakout: 'ZZHB', ready: 'ZZRD', payloadMismatch: 'ZZPM',
  fiscalQ4Window: 'ZZQF', pivotAfterCrossing: 'ZZNR', postGapPin: 'ZZPG', fiscalQ4Untagged: SEC_SYMBOL });
const oracleRowBySymbol = Object.fromEntries(ORACLE_ROWS.map(row => [row.symbol, row]));

/**
 * A market-trends asset (market-trends-v1 with a market-long-history-v1 body) that passes the
 * app's own validation. With `historyEnd` before the analysis date, the long history and the
 * index series stop at that session while the asset itself still names the analysis date. With
 * `schema: 'old'` the long history is written as before the market-environment fields existed
 * (no trend-template, 150/200-day, stage, breakout or leader-cohort counts), as older captures are.
 * `mutate` changes a copy of the asset's value before it is hashed (see variant), so the variant still
 * passes the app's integrity check.
 */
export function marketTrends({ historyEnd = date, schema = 'current', mutate } = {}) {
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
  const base = { schema_version: 'market-trends-v1', market: 'US', as_of_date: date, indices: [index('^GSPC', [3, 11, 19]), index('^IXIC', [2, 7, 13, 21])],
    breadth: { points: [] }, put_call: { points: [] }, long_history: history,
    refresh_schedule: { provider: 'pandas_market_calendars:NYSE', valid_until: `${schedule.at(-1)}T23:00:00Z`, sessions: schedule.map(session => ({ date: session, close_at: `${session}T20:00:00Z` })) } };
  const value = variant(base, mutate), text = JSON.stringify(value), digest = sha(text);
  return { text, file: `series-${digest}.json`, ref: { schema_version: 'market-trends-v1', market: 'US', as_of_date: date, sha256: digest, path: `market-trends/series-${digest}.json` } };
}

/** Serve the synthetic publication for every static-data request; abort everything that is not 127.0.0.1. */
/**
 * `fail` names one file to answer with an HTTP error: 'series' (404 for the market series), 'manifest'
 * (503) or 'detail' (503 for every research detail). `detailGate` is a promise every research detail
 * waits for before it answers (a detail that is still loading). `mutate` holds optional mutators (see
 * variant) for this page only: `rows` (the research rows), `charts` (the chart payloads by file name),
 * `details` (the research details by file name), `trends` (the market-trends value) and `manifest`.
 */
export async function routeBrief(page, { historyEnd = date, schema, fail, detailGate, mutate = {}, oracles = false } = {}) {
  const trends = marketTrends({ historyEnd, schema, mutate: mutate.trends });
  // With `oracles`, the synthetic oracles (ORACLE_ROWS, ORACLE_CHARTS, ORACLE_DETAILS) join a private copy of the base,
  // and each mutator receives the combined set. Without it the served data is exactly the default fixture's.
  const withOracles = (base, extra) => (oracles ? structuredClone(Array.isArray(base) ? [...base, ...extra] : { ...base, ...extra }) : base);
  const served = consistent({ rows: variant(withOracles(rows, ORACLE_ROWS), mutate.rows), charts: variant(withOracles(charts, ORACLE_CHARTS), mutate.charts),
    details: variant(withOracles(details, ORACLE_DETAILS), mutate.details) });
  const manifest = variant({ as_of_date: date, generated_at: new Date(now).toISOString(), research_generation: 'brief-browser-fixture',
    default_market: 'US', supported_markets: ['US'], markets: { US: { as_of_date: date, assets: { research: { path: 'research.json' }, market_trends: trends.ref }, pages: {} } } }, mutate.manifest);
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
    if (file === 'manifest.json') return route.fulfill({ json: manifest });
    if (file === 'research.json') return route.fulfill({ json: { as_of_date: date, rows: served.rows } });
    if (file === trends.file) return route.fulfill({ contentType: 'application/json', body: trends.text });
    if (served.details[file] && fail === 'detail') return route.fulfill({ status: 503, json: {} });
    if (served.details[file]) { if (detailGate) await detailGate; return route.fulfill({ json: served.details[file] }); }
    if (served.charts[file]) return route.fulfill({ json: served.charts[file] });
    return route.fulfill({ status: 404, json: {} });
  });
  return { external, trends };
}

/**
 * A fresh page on the synthetic publication at the fixed analysis clock, collecting page errors.
 * `storage` seeds localStorage once per tab (a later change and reload keep the user's choice),
 * e.g. { 'research-watch': ['ZZNV'] } or { 'screener:color-mode': 'light' }. `mutate` serves a variant
 * of the data to this page (routeBrief), e.g. { rows: rows => { rows[0].rs_rating = 97.01; } }. `oracles: true` also
 * serves the round-3 oracles (ORACLE_ROWS); without it nothing changes.
 */
export async function openBrief(page, hash = '#/brief', { historyEnd, schema, storage, fail, detailGate, mutate, oracles = false } = {}) {
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
  const network = await routeBrief(page, { historyEnd, schema, fail, detailGate, mutate, oracles });
  await page.goto(`/${hash}`);
  return { errors, external: network.external };
}

/**
 * Waits until every price chart on the page has finished drawing (round 3, STEP 0 helper H3; plan rule 20): fonts are
 * loaded; each chart's drawing has ended its intro (.bc-pulsing on the drawing) or never animates (reduced motion and a
 * redraw hide the pulse ring instead), or the chart says it has too few bars; then every finite animation has finished.
 * After a period click pass `{ redraw: true }`: it then waits for a drawing it has not settled before, so the previous
 * period's .bc-pulsing never ends the wait. Call it once a chart is on screen (it waits for a chart still loading).
 */
export async function chartSettled(page, { redraw = false, timeout = 20000 } = {}) {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForFunction(fresh => {
    const seen = (window.__briefChartSettled ||= new WeakSet());
    const charts = [...document.querySelectorAll('[data-testid="brief-price-chart"]')];
    const done = charts.every(chart => {
      if (chart.querySelector('.brief-chart-empty')) return true;
      const pulse = chart.querySelector('.bc-pulse'), drawing = pulse?.ownerSVGElement;
      if (!drawing || (fresh && seen.has(drawing))) return false;
      return drawing.classList.contains('bc-pulsing') || pulse.style.opacity === '0';
    });
    if (done) for (const chart of charts) { const drawing = chart.querySelector('.bc-pulse')?.ownerSVGElement; if (drawing) seen.add(drawing); }
    return done;
  }, redraw, { timeout });
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => null))));
  // The intro's last label tweens run on animation frames (not in getAnimations), a few hundred ms past .bc-pulsing at most.
  await page.waitForTimeout(300);
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
