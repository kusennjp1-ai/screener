// Print how complete the brief's fundamentals and market-environment inputs are
// for this build, using the same rule functions the screens use. Read-only: it
// writes nothing into the published data and never fills a gap.
import { readFile } from 'node:fs/promises';
import { bookFinancialCurrent } from '../src/static/bookFinancialCurrent.js';
import { financialHistory } from '../src/static/financialHistory.js';
import { code33Layered } from '../src/static/code33Reference.js';

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
      if (report.epsAcceleration === 'unknown' && report.rows.slice(-4).some(row => row.derived && !Number.isFinite(row.epsYoY))) c.q4_eps_missing++;
    }
    const layered = code33Layered(report, series, date);
    if (layered.state === 'unknown') { out.code33.unknown++; if (out.unknown_symbols.length < 25) out.unknown_symbols.push(symbol); }
    else out.code33[layered.source === 'yahoo' ? 'yahoo' : 'sec']++;
  }
  return out;
}

export function environmentCoverage(history, sessions = 20) {
  const rows = (history?.breadth || []).slice(-sessions);
  const fields = ['trendTemplateCount', 'rs90TemplateCount', 'above200Percent', 'stage2', 'newHighs', 'breakoutsJudged', 'leaderCohort'];
  return { as_of_date: history?.as_of_date || null, last: rows.at(-1)?.date || null,
    present: Object.fromEntries(fields.map(field => [field, rows.filter(row => row[field] !== null && row[field] !== undefined).length + '/' + rows.length])) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [daily, sec, history, market, audit] = await Promise.all([read('public/research-daily.json'), read('public/static-data/book-financials.json'),
    read('public/static-data/financial-history.json'), read('public/static-data/market-history-source.json'), read('public/qualification-audit.json')]);
  console.log('Data coverage (fundamentals): ' + JSON.stringify(fundamentalsCoverage({ daily, sec, history, audit })));
  console.log('Data coverage (market environment, last 20 sessions): ' + JSON.stringify(environmentCoverage(market)));
}
