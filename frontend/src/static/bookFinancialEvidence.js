export const BOOK_QUARTER_MAX_AGE_DAYS = 180;
// sec-financials.py may recover a revenue or net-income Q4 that is only reported
// as a fiscal-year total (annual minus three reported quarters of one concept).
// EPS is never derived; derived points must name their four source filings.
export const DERIVED_Q4 = 'fiscal-year-minus-three-quarters';
const DERIVABLE = new Set(['revenue', 'netIncome']);
const acceptedOrigin = (p, allowDerived) => p.derived === false || (allowDerived && p.derived === DERIVED_Q4 && Array.isArray(p.components) && p.components.length === 4 && p.components.every(c => typeof c === 'string' && c.length > 0));

const finite = n => typeof n === 'number' && Number.isFinite(n);
const stamp = s => {
  const t = typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s) : NaN;
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? t : NaN;
};
const days = (a, b) => (stamp(a) - stamp(b)) / 86400000;
const state = value => value == null ? 'unknown' : value ? 'pass' : 'fail';
function safeSeries(points, date, kind = 'quarter', unit = null, allowDerived = false) {
  if (!Array.isArray(points) || points.some((p, i) => !p || !finite(p.value) || !finite(stamp(p.end)) || !finite(stamp(p.filed)) || p.filed > date || p.end > p.filed || (i && p.end <= points[i - 1].end) || !acceptedOrigin(p, allowDerived))) return [];
  if (points.some((p, i) => {
    if (unit && p.unit && p.unit !== unit) return true;
    if (kind === 'instant') return false;
    const duration = days(p.end, p.start) + 1;
    const [lo, hi] = kind === 'annual' ? [330, 400] : [70, 105];
    return !finite(duration) || duration < lo || duration > hi || (i > 0 && p.start <= points[i - 1].end);
  })) return [];
  return points;
}
/**
 * Year-over-year growth of the point ending `end`, with the reason when it is unknown:
 * not_reported (no value for that quarter), no_base / ambiguous_base (no single
 * quarter 345-385 days earlier), nonpositive_base (a loss or zero base has no
 * growth rate) or period_mismatch (quarter lengths differ by more than a week).
 */
export function yoyDetail(points, end, instant = false) {
  const now = points.find(p => p.end === end);
  if (!now) return { value: null, reason: 'not_reported' };
  const bases = points.filter(p => days(end, p.end) >= 345 && days(end, p.end) <= 385);
  if (!bases.length) return { value: null, reason: 'no_base' };
  if (bases.length !== 1) return { value: null, reason: 'ambiguous_base' };
  if (bases[0].value <= 0) return { value: null, reason: 'nonpositive_base', base: bases[0] };
  // Equal end months do not make a 70-day transition period comparable with a
  // 105-day quarter. Allow a 53-week retailer's one extra week, not extra months.
  if (!instant && Math.abs(days(now.end, now.start) - days(bases[0].end, bases[0].start)) > 7) return { value: null, reason: 'period_mismatch' };
  return { value: (now.value / bases[0].value - 1) * 100, reason: null, base: bases[0] };
}
const yoy = (points, end, instant = false) => yoyDetail(points, end, instant).value;
/**
 * Three-valued "rises three times" over consecutive values (Kleene logic): fail as soon as any known
 * later value is at or below a known earlier one (a missing value in between cannot rescue it), pass
 * only when every value is known and each one is above the one before, otherwise unknown. `pair` names
 * the two indices that settled a fail (the earliest later value, against the nearest earlier one).
 */
export function risesDetail(values) {
  for (let j = 1; j < values.length; j++) {
    if (!finite(values[j])) continue;
    for (let i = j - 1; i >= 0; i--) if (finite(values[i]) && values[j] <= values[i]) return { state: 'fail', pair: [i, j] };
  }
  return { state: values.every(finite) ? 'pass' : 'unknown', pair: null };
}
function marginDetail(revenue, income) {
  if (!revenue || !income) return { value: null, reason: 'not_reported' };
  if (!(revenue.value > 0)) return { value: null, reason: 'nonpositive_revenue' };
  if (income.start !== revenue.start) return { value: null, reason: 'start_mismatch' };
  return { value: income.value / revenue.value * 100, reason: null };
}
export function bookFinancialEvidence(data, symbol, date) {
  const result = { valid: false, date, rows: [], annual: [], unknowns: ['調整後EPS・一時利益の除外', '発表前の予想値とサプライズ', '時点付きの予想上方修正', '会社開示による新製品等の材料'], code33: 'unknown' };
  if (!data || data.symbol !== symbol || data.as_of_date !== date || !finite(stamp(date)) || !data.quarterly || !['available', 'partial'].includes(data.status)) return result;
  const q = Object.fromEntries(['eps', 'revenue', 'netIncome', 'inventory', 'receivables'].map(key => [key,
    safeSeries(data.quarterly[key], date, ['inventory', 'receivables'].includes(key) ? 'instant' : 'quarter', key === 'eps' ? 'USD/shares' : 'USD', DERIVABLE.has(key))]));
  result.annual = safeSeries(data.annualEps, date, 'annual', 'USD/shares');
  const fiscalYearEnds = new Set(result.annual.map(p => p.end));
  const ends = [...new Set([...q.eps, ...q.revenue].map(p => p.end))].sort();
  result.rows = ends.slice(-8).map(end => {
    const eps = q.eps.find(p => p.end === end), revenue = q.revenue.find(p => p.end === end), income = q.netIncome.find(p => p.end === end);
    const margin = marginDetail(revenue, income);
    const derived = [revenue, income].some(p => p?.derived === DERIVED_Q4);
    const epsGrowth = yoyDetail(q.eps, end), salesGrowth = yoyDetail(q.revenue, end);
    // Sales growth rests on this quarter's revenue and its year-ago base: either one may be a derived Q4.
    const salesDerived = revenue?.derived === DERIVED_Q4, salesBaseDerived = salesGrowth.base?.derived === DERIVED_Q4;
    return { end, derived, salesDerived, salesBaseDerived, eps: eps?.value ?? null, revenue: revenue?.value ?? null, margin: margin.value, epsYoY: epsGrowth.value, salesYoY: salesGrowth.value,
      epsYoYReason: epsGrowth.reason, salesYoYReason: salesGrowth.reason, marginReason: margin.reason,
      // The year-ago EPS behind a loss or zero base, so a swing to a profit is told as a fact, never a rate.
      epsBase: epsGrowth.reason === 'nonpositive_base' ? epsGrowth.base.value : null,
      // A fiscal fourth quarter: the 10-K's fiscal-year end, or a Q4 derived from it.
      fiscalQ4: fiscalYearEnds.has(end) || derived, form: eps?.form ?? revenue?.form ?? income?.form ?? null,
      filed: [eps?.filed, revenue?.filed, income?.filed].filter(Boolean).sort().at(-1), accession: eps?.accession ?? revenue?.accession, inventoryYoY: yoy(q.inventory, end, true), receivablesYoY: yoy(q.receivables, end, true) };
  });
  result.valid = result.rows.length > 0;
  result.stale = !result.rows.length || days(date, result.rows.at(-1).end) > BOOK_QUARTER_MAX_AGE_DAYS;
  const last = result.rows.slice(-4);
  const consecutive = last.length === 4 && last.slice(1).every((p, i) => days(p.end, last[i].end) >= 70 && days(p.end, last[i].end) <= 110);
  result.consecutive = consecutive;
  const comparable = consecutive && !result.stale;
  // `settled` names the two quarters behind each known failure (their period ends and values).
  result.settled = {};
  const judge = (name, key) => {
    const value = comparable ? risesDetail(last.map(p => p[key])) : { state: 'unknown', pair: null };
    if (value.pair) result.settled[name] = { from: { end: last[value.pair[0]].end, value: last[value.pair[0]][key] }, to: { end: last[value.pair[1]].end, value: last[value.pair[1]][key] } };
    return value.state;
  };
  result.epsAcceleration = judge('epsAcceleration', 'epsYoY');
  result.salesAcceleration = judge('salesAcceleration', 'salesYoY');
  // Original Figure 8.10 shows NET MARGIN LEVELS, not margin YoY growth.
  result.marginImprovement = judge('marginImprovement', 'margin');
  // Three-valued AND: one known failure fails Code 33; a pass needs all three
  // known passes; anything else stays unknown. Missing data never passes.
  const trio = [result.epsAcceleration, result.salesAcceleration, result.marginImprovement];
  result.code33 = trio.includes('fail') ? 'fail' : trio.every(s => s === 'pass') ? 'pass' : 'unknown';
  result.epsFloor = Object.fromEntries([2, 4].map(count => {
    const selected = result.rows.slice(-count);
    const ready = selected.length === count && !result.stale && selected.every(p => finite(p.epsYoY)) && selected.slice(1).every((p, i) => days(p.end, selected[i].end) >= 70 && days(p.end, selected[i].end) <= 110);
    return [count, { at20: state(ready ? selected.every(p => p.epsYoY + 1e-9 >= 20) : null), at25: state(ready ? selected.every(p => p.epsYoY + 1e-9 >= 25) : null) }];
  }));
  const annualRecent = result.annual.length >= 3 && days(date, result.annual.at(-1).end) <= 550;
  result.annualRecord = annualRecent ? state(result.annual.at(-1).value > Math.max(...result.annual.slice(0, -1).map(p => p.value))) : 'unknown';
  result.balanceCoverage = result.rows.filter(p => finite(p.salesYoY) && (finite(p.inventoryYoY) || finite(p.receivablesYoY))).length;
  result.balanceWarnings = result.rows.filter(p => finite(p.salesYoY)).flatMap(p => ['inventoryYoY', 'receivablesYoY'].filter(k => finite(p[k]) && p[k] > p.salesYoY).map(k => ({ end: p.end, metric: k, growth: p[k], salesGrowth: p.salesYoY })));
  result.source = data.source;
  result.limitations = data.limitations || [];
  return result;
}
