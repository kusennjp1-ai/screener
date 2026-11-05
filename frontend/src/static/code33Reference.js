// Second-layer Code 33 check from the current Yahoo quarterly statements
// (financial_history). It is a labelled reference for current research only:
// it never replaces or populates the dated SEC evidence in bookFinancialEvidence.
// Same rule: the latest four quarters must be consecutive and each of EPS growth,
// sales growth (year over year) and net margin level must rise three times.
import { risesDetail } from './bookFinancialEvidence.js';

const finite = n => typeof n === 'number' && Number.isFinite(n);
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;

function yoy(rows, row, key) {
  const bases = rows.filter(p => days(row.end, p.end) >= 345 && days(row.end, p.end) <= 385);
  if (bases.length !== 1 || !finite(row[key]) || !finite(bases[0][key]) || bases[0][key] <= 0) return null;
  return (row[key] / bases[0][key] - 1) * 100;
}

/** history: the validated result of financialHistory(); returns unknown unless the data supports a judgement. */
export function code33Reference(history, date, maxAgeDays = 190) {
  const rows = Array.isArray(history?.quarterly) ? history.quarterly : [];
  const result = { source: 'yahoo', state: 'unknown', eps: 'unknown', sales: 'unknown', margin: 'unknown', quarters: [] };
  if (!history?.valid || rows.length < 5) return result;
  const last = rows.slice(-4);
  const consecutive = last.slice(1).every((p, i) => days(p.end, last[i].end) >= 70 && days(p.end, last[i].end) <= 110);
  if (!consecutive || !(days(date, last.at(-1).end) <= maxAgeDays)) return result;
  result.quarters = last.map(row => ({ end: row.end, epsYoY: yoy(rows, row, 'eps'), salesYoY: yoy(rows, row, 'revenue'),
    margin: finite(row.revenue) && row.revenue > 0 && finite(row.netIncome) ? row.netIncome / row.revenue * 100 : null }));
  // The same three-valued rule as the SEC evidence: a known fall fails even beside a missing quarter.
  result.eps = risesDetail(result.quarters.map(q => q.epsYoY)).state;
  result.sales = risesDetail(result.quarters.map(q => q.salesYoY)).state;
  result.margin = risesDetail(result.quarters.map(q => q.margin)).state;
  // Three-valued AND, as for the SEC evidence: any known failure fails, a pass
  // needs three known passes, anything else stays unknown.
  const trio = [result.eps, result.sales, result.margin];
  result.state = trio.includes('fail') ? 'fail' : trio.every(s => s === 'pass') ? 'pass' : 'unknown';
  return result;
}

/** The Code 33 shown to the user: SEC evidence first, then the Yahoo reference, else unknown. */
export function code33Layered(bookReport, history, date) {
  const sec = bookReport?.valid ? bookReport.code33 : 'unknown';
  if (sec !== 'unknown') return { state: sec, source: 'sec', label: 'SEC提出書類' };
  const reference = code33Reference(history, date);
  if (reference.state !== 'unknown') return { state: reference.state, source: 'yahoo', label: '参考：Yahoo四半期値', reference };
  return { state: 'unknown', source: null, label: null };
}
