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
  // A series written out that the period checks refused as a whole (named, never repaired).
  result.refusedSeries = ['eps', 'revenue', 'netIncome'].filter(key => Array.isArray(data.quarterly[key]) && data.quarterly[key].length > 0 && !q[key].length);
  // Quarters written with no revenue concept the SEC tags cover (banks and insurers report interest or
  // premium income): out of scope, never a missing quarter.
  const noRevenueConcept = Array.isArray(data.quarterly.revenue) && data.quarterly.revenue.length === 0 && (q.eps.length > 0 || q.netIncome.length > 0);
  result.revenueConcept = !noRevenueConcept;
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
      epsYoYReason: epsGrowth.reason, salesYoYReason: noRevenueConcept ? 'no_concept' : salesGrowth.reason, marginReason: noRevenueConcept ? 'no_concept' : margin.reason,
      // The year-ago EPS behind a loss or zero base, so a swing to a profit is told as a fact, never a rate.
      epsBase: epsGrowth.reason === 'nonpositive_base' ? epsGrowth.base.value : null,
      // A fiscal fourth quarter: the 10-K's fiscal-year end, or a Q4 derived from it.
      fiscalQ4: fiscalYearEnds.has(end) || derived, form: eps?.form ?? revenue?.form ?? income?.form ?? null,
      filed: [eps?.filed, revenue?.filed, income?.filed].filter(Boolean).sort().at(-1), accession: eps?.accession ?? revenue?.accession, inventoryYoY: yoy(q.inventory, end, true), receivablesYoY: yoy(q.receivables, end, true) };
  });
  result.valid = result.rows.length > 0;
  result.stale = !result.rows.length || days(date, result.rows.at(-1).end) > BOOK_QUARTER_MAX_AGE_DAYS;
  // Fiscal fourth quarters the 10-K reports only as a year (an annual EPS period) with no quarterly row at all:
  // `fiscalQ4Missing` inside the rows' span, `fiscalQ4Pending` the newest one after the latest row. Never estimated.
  const firstEnd = result.rows[0]?.end, lastEnd = result.rows.at(-1)?.end;
  const rowEnds = new Set(result.rows.map(row => row.end));
  result.fiscalQ4Missing = firstEnd ? result.annual.map(p => p.end).filter(end => end > firstEnd && end < lastEnd && !rowEnds.has(end)) : [];
  result.fiscalQ4Pending = lastEnd ? result.annual.map(p => p.end).filter(end => end > lastEnd).at(-1) ?? null : null;
  // The newest period any filing covers, a 10-K's year included: 古い applies only when even that is too old.
  result.newestFilingEnd = [lastEnd, result.annual.at(-1)?.end].filter(Boolean).sort().at(-1) ?? null;
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
  // "EPS growth of N% or more in each of the latest `count` quarters", three-valued within one consecutive,
  // current window: fail as soon as a known quarter is below the level (a missing one cannot rescue it),
  // pass only when all of them are known and at or above it, otherwise unknown. `below` names the known
  // quarters under each level.
  result.epsFloor = Object.fromEntries([2, 4].map(count => {
    const selected = result.rows.slice(-count);
    const window = selected.length === count && !result.stale && selected.slice(1).every((p, i) => days(p.end, selected[i].end) >= 70 && days(p.end, selected[i].end) <= 110);
    const level = threshold => {
      const below = window ? selected.filter(p => finite(p.epsYoY) && p.epsYoY + 1e-9 < threshold).map(p => ({ end: p.end, value: p.epsYoY })) : [];
      return { state: !window ? 'unknown' : below.length ? 'fail' : selected.every(p => finite(p.epsYoY)) ? 'pass' : 'unknown', below };
    };
    const [at20, at25] = [level(20), level(25)];
    return [count, { at20: at20.state, at25: at25.state, below20: at20.below, below25: at25.below }];
  }));
  // A record year needs a profit: a smaller loss than every earlier year is never a new high. The years compared
  // are those the newest 10-K presents (one accession, so a stock split restated them alike); only a record whose
  // newest 10-K presents fewer than three years compares every year it holds.
  const newest = result.annual.at(-1);
  const filing = newest ? result.annual.filter(p => p.accession === newest.accession) : [];
  const basis = filing.length >= 3 ? filing : result.annual;
  result.annualBasis = { kind: filing.length >= 3 ? 'filing' : 'record', years: basis.length };
  const annualRecent = basis.length >= 3 && days(date, newest.end) <= 550;
  const latestAnnual = newest?.value;
  result.annualRecord = annualRecent ? latestAnnual <= 0 ? 'fail' : state(latestAnnual > Math.max(...basis.slice(0, -1).map(p => p.value))) : 'unknown';
  result.balanceCoverage = result.rows.filter(p => finite(p.salesYoY) && (finite(p.inventoryYoY) || finite(p.receivablesYoY))).length;
  result.balanceWarnings = result.rows.filter(p => finite(p.salesYoY)).flatMap(p => ['inventoryYoY', 'receivablesYoY'].filter(k => finite(p[k]) && p[k] > p.salesYoY).map(k => ({ end: p.end, metric: k, growth: p[k], salesGrowth: p.salesYoY })));
  result.source = data.source;
  result.limitations = data.limitations || [];
  return result;
}
