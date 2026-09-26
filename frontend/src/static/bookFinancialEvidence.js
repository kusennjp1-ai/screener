const finite = n => typeof n === 'number' && Number.isFinite(n);
const stamp = s => {
  const t = typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s) : NaN;
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? t : NaN;
};
const days = (a, b) => (stamp(a) - stamp(b)) / 86400000;
const state = value => value == null ? 'unknown' : value ? 'pass' : 'fail';
function safeSeries(points, date, kind = 'quarter', unit = null) {
  if (!Array.isArray(points) || points.some((p, i) => !p || !finite(p.value) || !finite(stamp(p.end)) || !finite(stamp(p.filed)) || p.filed > date || p.end > p.filed || (i && p.end <= points[i - 1].end) || p.derived !== false)) return [];
  if (points.some((p, i) => {
    if (unit && p.unit && p.unit !== unit) return true;
    if (kind === 'instant') return false;
    const duration = days(p.end, p.start) + 1;
    const [lo, hi] = kind === 'annual' ? [330, 400] : [70, 105];
    return !finite(duration) || duration < lo || duration > hi || (i > 0 && p.start <= points[i - 1].end);
  })) return [];
  return points;
}
function yoy(points, end, instant = false) {
  const now = points.find(p => p.end === end);
  const bases = points.filter(p => days(end, p.end) >= 345 && days(end, p.end) <= 385);
  if (!now || bases.length !== 1 || bases[0].value <= 0) return null;
  // Equal end months do not make a 70-day transition period comparable with a
  // 105-day quarter. Allow a 53-week retailer's one extra week, not extra months.
  if (!instant && Math.abs(days(now.end, now.start) - days(bases[0].end, bases[0].start)) > 7) return null;
  return (now.value / bases[0].value - 1) * 100;
}
function rises(values) { return values.every(finite) ? values.slice(1).every((v, i) => v > values[i]) : null; }
export function bookFinancialEvidence(data, symbol, date) {
  const result = { valid: false, date, rows: [], annual: [], unknowns: ['調整後EPS・一時利益の除外', '発表前の予想値とサプライズ', '時点付きの予想上方修正', '会社開示による新製品等の材料'], code33: 'unknown' };
  if (!data || data.symbol !== symbol || data.as_of_date !== date || !finite(stamp(date)) || !data.quarterly || !['available', 'partial'].includes(data.status)) return result;
  const q = Object.fromEntries(['eps', 'revenue', 'netIncome', 'inventory', 'receivables'].map(key => [key,
    safeSeries(data.quarterly[key], date, ['inventory', 'receivables'].includes(key) ? 'instant' : 'quarter', key === 'eps' ? 'USD/shares' : 'USD')]));
  const ends = [...new Set([...q.eps, ...q.revenue].map(p => p.end))].sort();
  result.rows = ends.slice(-8).map(end => {
    const eps = q.eps.find(p => p.end === end), revenue = q.revenue.find(p => p.end === end), income = q.netIncome.find(p => p.end === end);
    const margin = revenue?.value > 0 && income && income.start === revenue.start ? income.value / revenue.value * 100 : null;
    return { end, eps: eps?.value ?? null, revenue: revenue?.value ?? null, margin, epsYoY: yoy(q.eps, end), salesYoY: yoy(q.revenue, end), filed: [eps?.filed, revenue?.filed, income?.filed].filter(Boolean).sort().at(-1), accession: eps?.accession ?? revenue?.accession, inventoryYoY: yoy(q.inventory, end, true), receivablesYoY: yoy(q.receivables, end, true) };
  });
  result.valid = result.rows.length > 0;
  result.stale = !result.rows.length || days(date, result.rows.at(-1).end) > 180;
  const last = result.rows.slice(-4);
  const consecutive = last.length === 4 && last.slice(1).every((p, i) => days(p.end, last[i].end) >= 70 && days(p.end, last[i].end) <= 110);
  const comparable = consecutive && !result.stale;
  result.epsAcceleration = state(comparable ? rises(last.map(p => p.epsYoY)) : null);
  result.salesAcceleration = state(comparable ? rises(last.map(p => p.salesYoY)) : null);
  // Original Figure 8.10 shows NET MARGIN LEVELS, not margin YoY growth.
  result.marginImprovement = state(comparable ? rises(last.map(p => p.margin)) : null);
  const trio = [result.epsAcceleration, result.salesAcceleration, result.marginImprovement];
  result.code33 = trio.includes('unknown') ? 'unknown' : trio.every(s => s === 'pass') ? 'pass' : 'fail';
  result.epsFloor = Object.fromEntries([2, 4].map(count => {
    const selected = result.rows.slice(-count);
    const ready = selected.length === count && !result.stale && selected.every(p => finite(p.epsYoY)) && selected.slice(1).every((p, i) => days(p.end, selected[i].end) >= 70 && days(p.end, selected[i].end) <= 110);
    return [count, { at20: state(ready ? selected.every(p => p.epsYoY + 1e-9 >= 20) : null), at25: state(ready ? selected.every(p => p.epsYoY + 1e-9 >= 25) : null) }];
  }));
  result.annual = safeSeries(data.annualEps, date, 'annual', 'USD/shares');
  const annualRecent = result.annual.length >= 3 && days(date, result.annual.at(-1).end) <= 550;
  result.annualRecord = annualRecent ? state(result.annual.at(-1).value > Math.max(...result.annual.slice(0, -1).map(p => p.value))) : 'unknown';
  result.balanceCoverage = result.rows.filter(p => finite(p.salesYoY) && (finite(p.inventoryYoY) || finite(p.receivablesYoY))).length;
  result.balanceWarnings = result.rows.filter(p => finite(p.salesYoY)).flatMap(p => ['inventoryYoY', 'receivablesYoY'].filter(k => finite(p[k]) && p[k] > p.salesYoY).map(k => ({ end: p.end, metric: k, growth: p[k], salesGrowth: p.salesYoY })));
  result.source = data.source;
  result.limitations = data.limitations || [];
  return result;
}
