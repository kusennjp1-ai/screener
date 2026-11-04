// Print how complete the brief's fundamentals and market-environment inputs are
// for this build, using the same rule functions the screens use. Read-only: it
// writes nothing into the published data and never fills a gap.
//   node tools/report-data-coverage.mjs              inputs (SEC file, Yahoo history, market history)
//   node tools/report-data-coverage.mjs --published  what the published details actually carry
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bookFinancialCurrent } from '../src/static/bookFinancialCurrent.js';
import { financialHistory } from '../src/static/financialHistory.js';
import { code33Layered } from '../src/static/code33Reference.js';
import { code33Explain, code33Parts, fundamentalTiles, secStatus } from '../src/static/fundamentalsExplain.js';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { environmentPoint } from '../src/static/marketLongHistory.js';
import { LONG_HISTORY_ENVIRONMENT_KEYS } from '../src/static/marketUpdateState.js';
import { readBookFinancials } from './book-financials-input.mjs';

const read = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

/** Trend-template rows the brief lists: qualified, then one condition short with nothing unknown. */
export function briefRows(audit, date) {
  if (!audit || audit.as_of_date !== date) return [];
  const method = row => row.methods?.minervini || {};
  const rows = audit.results || [];
  return [...rows.filter(row => method(row).qualified), ...rows.filter(row => !method(row).qualified && method(row).failed === 1 && method(row).unknown === 0)].map(row => row.symbol);
}

export function fundamentalsCoverage({ daily, sec, history, audit = null, now = Date.now() }) {
  const date = daily?.as_of_date;
  const symbols = [...new Set([...['minervini', 'minervini2'].flatMap(method => (daily?.candidates?.[method] || []).map(row => row.symbol)), ...briefRows(audit, date)])];
  const out = { as_of_date: date, candidates: symbols.length, sec: { same_day: sec?.as_of_date === date, available: 0, partial: 0, unavailable: 0, missing: 0 },
    history: { same_day: history?.as_of_date === date, available: 0, missing: 0 }, code33: { sec: 0, yahoo: 0, unknown: 0 },
    // Each SEC condition separately: a fiscal-Q4 EPS reported only annually leaves EPS (and so Code 33) unknown.
    sec_conditions: { eps: { pass: 0, fail: 0, unknown: 0 }, sales: { pass: 0, fail: 0, unknown: 0 }, margin: { pass: 0, fail: 0, unknown: 0 }, q4_eps_missing: 0 }, unknown_symbols: [] };
  for (const symbol of symbols) {
    const evidence = sec?.as_of_date === date ? sec.results?.[symbol] : null;
    if (!evidence) out.sec.missing++; else out.sec[evidence.status] = (out.sec[evidence.status] || 0) + 1;
    const raw = history?.as_of_date === date ? history.results?.[symbol] : null;
    if (raw?.status === 'available') out.history.available++; else out.history.missing++;
    const book = evidence ? bookFinancialCurrent(evidence, symbol, date, now, { symbol }) : null;
    const series = raw ? financialHistory(raw, symbol, date, now) : null;
    const report = book?.current ? book.report : null;
    if (report?.valid) {
      const c = out.sec_conditions;
      c.eps[report.epsAcceleration]++; c.sales[report.salesAcceleration]++; c.margin[report.marginImprovement]++;
      if (code33Parts(report)?.q4Eps) c.q4_eps_missing++;
    }
    const layered = code33Layered(report, series, date);
    if (layered.state === 'unknown') { out.code33.unknown++; if (out.unknown_symbols.length < 25) out.unknown_symbols.push(symbol); }
    else out.code33[layered.source === 'yahoo' ? 'yahoo' : 'sec']++;
  }
  return out;
}

const SEC_STATES = ['ok', 'stale', 'not_published', 'no_cik', 'no_companyfacts', 'no_quarterly', 'transient', 'not_applicable', 'invalid'];
const UNKNOWN_KINDS = ['q4_eps', 'few_quarters', 'gap', 'stale', 'no_sec', 'other'];
/**
 * What the brief can actually show for each row it lists, read from the published
 * research index and canonical details (the logical files, before transport packing).
 */
export async function publishedCoverage({ root = 'public', now = Date.now(), limit = 25 } = {}) {
  const dataRoot = resolve(root, 'static-data');
  const inside = path => { const full = resolve(dataRoot, path); if (!full.startsWith(dataRoot + '/')) throw Error('Invalid published path'); return full; };
  const manifest = await read(resolve(dataRoot, 'manifest.json'));
  if (!manifest) return null;
  const entry = manifest.markets?.US || manifest;
  const index = decodeResearchIndex(await read(inside(entry.assets.research.path)));
  const date = index.as_of_date, audit = await read(resolve(root, 'qualification-audit.json'));
  const rows = new Map(index.rows.map(row => [row.symbol, row]));
  const listed = briefRows(audit, date);
  const out = { as_of_date: date, listed: listed.length, sec_record: 0, tiles: { eps: 0, sales: 0, margin: 0 },
    sec_state: Object.fromEntries(SEC_STATES.map(state => [state, 0])), code33: { pass: 0, fail: 0, unknown: 0 },
    code33_unknown_reason: Object.fromEntries(UNKNOWN_KINDS.map(kind => [kind, 0])), listed_without_sec: [] };
  for (const symbol of listed) {
    const summary = rows.get(symbol);
    const detail = summary?.research_detail_path ? await read(inside(summary.research_detail_path)) : null;
    const row = detail && detail.symbol === symbol && detail.as_of_date === date ? detail : { ...summary, book_financials: null };
    const book = row.book_financials ? bookFinancialCurrent(row.book_financials, symbol, date, now, row) : null;
    const report = book?.current ? book.report : null;
    const history = row.financial_history ? financialHistory(row.financial_history, symbol, date, now) : null;
    const sec = secStatus(row, book), code33 = code33Layered(report, history, date), explain = code33Explain(report, sec, code33);
    if (row.book_financials) out.sec_record++;
    else if (out.listed_without_sec.length < limit) out.listed_without_sec.push(symbol);
    out.sec_state[sec.state]++;
    if (report) fundamentalTiles(report).forEach((tile, i) => { if (tile.value !== null) out.tiles[['eps', 'sales', 'margin'][i]]++; });
    out.code33[code33.state]++;
    if (code33.state === 'unknown') out.code33_unknown_reason[explain.kind] = (out.code33_unknown_reason[explain.kind] || 0) + 1;
  }
  return out;
}

export function environmentCoverage(history, sessions = 20) {
  const rows = (history?.breadth || []).slice(-sessions);
  const fields = ['trendTemplateCount', 'rs90TemplateCount', 'above200Percent', 'stage2', 'newHighs', 'breakoutsJudged', 'leaderCohort'];
  return { as_of_date: history?.as_of_date || null, last: rows.at(-1)?.date || null,
    present: Object.fromEntries(fields.map(field => [field, rows.filter(row => row[field] !== null && row[field] !== undefined).length + '/' + rows.length])) };
}

const FINAL_FIELDS = ['breakoutsJudged', 'breakoutsHeld', 'leaderCohort', 'leaderCohortAbove50', 'trendTemplateCount', 'rs90TemplateCount', 'above50Percent', 'above200Percent'];
/**
 * The final long-history row as the brief reads it (diagnostic only). An absent key is
 * reported as 'absent' (older-schema capture), a null as null; the derived rates use
 * the screens' own thresholds, so a small sample stays null rather than becoming a rate.
 */
export function finalEnvironmentRow(history) {
  const row = history?.breadth?.at(-1);
  if (!row || typeof row !== 'object') return { date: null, values: null, missing_environment_keys: null, derived: null };
  const point = environmentPoint(row);
  return { date: row.date ?? null, values: Object.fromEntries(FINAL_FIELDS.map(field => [field, Object.hasOwn(row, field) ? row[field] : 'absent'])),
    missing_environment_keys: LONG_HISTORY_ENVIRONMENT_KEYS.filter(key => !Object.hasOwn(row, key)),
    derived: { breakoutHoldPercent: point.breakoutHoldPercent, leaderHealthPercent: point.leaderHealthPercent } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--published')) {
    const report = await publishedCoverage();
    if (!report) throw Error('No published static-data bundle');
    console.log('Published coverage (fundamentals): ' + JSON.stringify(report));
  } else {
    const [daily, sec, history, market, audit] = await Promise.all([read('public/research-daily.json'), readBookFinancials('public/static-data'),
      read('public/static-data/financial-history.json'), read('public/static-data/market-history-source.json'), read('public/qualification-audit.json')]);
    console.log('Data coverage (fundamentals): ' + JSON.stringify(fundamentalsCoverage({ daily, sec, history, audit })));
    console.log('Data coverage (market environment, last 20 sessions): ' + JSON.stringify(environmentCoverage(market)));
    // Diagnostic only: a malformed row must not turn this report into a build failure.
    try { console.log('Data coverage (market environment, final session): ' + JSON.stringify(finalEnvironmentRow(market))); }
    catch (error) { console.log('Data coverage (market environment, final session) unavailable: ' + String(error?.message || error).slice(0, 200)); }
  }
}
