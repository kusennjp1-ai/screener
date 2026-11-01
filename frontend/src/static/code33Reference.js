// Second-layer Code 33 check from the current Yahoo quarterly statements
// (financial_history). It is a labelled reference for current research only:
// it never replaces or populates the dated SEC evidence in bookFinancialEvidence.
// Same rule: the latest four quarters must be consecutive and each of EPS growth,
// sales growth (year over year) and net margin level must rise three times.
const finite = n => typeof n === 'number' && Number.isFinite(n);
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;

function yoy(rows, row, key) {
  const bases = rows.filter(p => days(row.end, p.end) >= 345 && days(row.end, p.end) <= 385);
  if (bases.length !== 1 || !finite(row[key]) || !finite(bases[0][key]) || bases[0][key] <= 0) return null;
  return (row[key] / bases[0][key] - 1) * 100;
}
const rises = values => values.every(finite) ? values.slice(1).every((v, i) => v > values[i]) : null;
const state = value => value == null ? 'unknown' : value ? 'pass' : 'fail';

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
  result.eps = state(rises(result.quarters.map(q => q.epsYoY)));
  result.sales = state(rises(result.quarters.map(q => q.salesYoY)));
  result.margin = state(rises(result.quarters.map(q => q.margin)));
  const trio = [result.eps, result.sales, result.margin];
  result.state = trio.includes('unknown') ? 'unknown' : trio.every(s => s === 'pass') ? 'pass' : 'fail';
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
