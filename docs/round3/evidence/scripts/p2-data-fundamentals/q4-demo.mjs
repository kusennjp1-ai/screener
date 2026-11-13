// Synthetic 8-quarter SEC records through the brief's own bookFinancialEvidence (8849bf9) and the coverage report's
// epsUnknownCauses: what a fiscal Q4 without a tagged EPS does to Code 33's EPS acceleration.
const SRC = process.argv[2];
const { bookFinancialEvidence, DERIVED_Q4 } = await import(`${SRC}/frontend/src/static/bookFinancialEvidence.js`);
const { epsUnknownCauses } = await import(`${SRC}/frontend/tools/report-data-coverage.mjs`);
const DATE = '2026-11-12';
// Calendar fiscal year; quarters 2023Q1..2026Q3.
const qs = [];
for (let y = 2023; y <= 2026; y++) for (const [s, e] of [['01-01', '03-31'], ['04-01', '06-30'], ['07-01', '09-30'], ['10-01', '12-31']]) {
  const end = `${y}-${e}`; if (end > '2026-09-30') continue; qs.push({ start: `${y}-${s}`, end, q4: e === '12-31', y });
}
const filed = q => { const d = new Date(Date.parse(q.end) + (q.q4 ? 55 : 35) * 864e5); return d.toISOString().slice(0, 10); };
const pt = (q, value, tag, unit, extra = {}) => ({ end: q.end, start: q.start, filed: filed(q), value, tag, unit, accession: `acc-${q.end}`, form: q.q4 ? '10-K' : '10-Q', derived: false, ...extra });
// EPS growth that accelerates every quarter: EPS = base * growth factor over the year-ago quarter.
function record({ q4EpsTagged, epsPath }) {
  const eps = [], revenue = [], netIncome = [];
  qs.forEach((q, i) => {
    const e = epsPath(i);
    if (!q.q4 || q4EpsTagged) eps.push(pt(q, e, 'EarningsPerShareDiluted', 'USD/shares'));
    const rev = 1000 * 1.1 ** i, ni = rev * (0.05 + 0.004 * i);
    revenue.push(q.q4 ? pt(q, rev, 'Revenues', 'USD', { derived: DERIVED_Q4, components: ['fy', 'a', 'b', 'c'], accession: `fy-${q.y}` }) : pt(q, rev, 'Revenues', 'USD'));
    netIncome.push(q.q4 ? pt(q, ni, 'NetIncomeLoss', 'USD', { derived: DERIVED_Q4, components: ['fy', 'a', 'b', 'c'], accession: `fy-${q.y}` }) : pt(q, ni, 'NetIncomeLoss', 'USD'));
  });
  const annualEps = [2023, 2024, 2025].map(y => ({ end: `${y}-12-31`, start: `${y}-01-01`, filed: `${y + 1}-02-24`, value: 2 + y - 2023, tag: 'EarningsPerShareDiluted', unit: 'USD/shares', accession: `fy-${y}`, form: '10-K', derived: false }));
  return { symbol: 'SYN', as_of_date: DATE, status: 'available', quarterly: { eps, revenue, netIncome, inventory: [], receivables: [] }, annualEps, source: 'synthetic', limitations: [] };
}
// Accelerating: year-ago-relative growth rises each quarter (EPS_i = EPS_{i-4} * (1 + g_i), g_i increasing).
const accel = () => { const v = [1, 1, 1, 1]; for (let i = 4; i < 15; i++) v.push(v[i - 4] * (1 + 0.05 * (i - 3))); return i => v[i]; };
// Decelerating in the known quarters: growth of 2026-09 below 2026-03's.
const decel = () => { const g = [0, 0, 0, 0, .1, .2, .3, .4, .5, .6, .7, .8, .9, .95, .5]; const v = [1, 1, 1, 1]; for (let i = 4; i < 15; i++) v.push(v[i - 4] * (1 + g[i])); return i => v[i]; };
const cases = [['A Q4 EPS untagged, every known quarter accelerating', { q4EpsTagged: false, epsPath: accel() }],
  ['B Q4 EPS untagged, known quarters decelerate', { q4EpsTagged: false, epsPath: decel() }],
  ['C Q4 EPS tagged, accelerating', { q4EpsTagged: true, epsPath: accel() }]];
for (const [name, spec] of cases) {
  const r = bookFinancialEvidence(record(spec), 'SYN', DATE);
  const last = r.rows.slice(-4);
  console.log(`${name}\n  last4 ${last.map(x => `${x.end}${x.fiscalQ4 ? '(Q4)' : ''} epsYoY=${x.epsYoY == null ? `null:${x.epsYoYReason}` : x.epsYoY.toFixed(1)} salesYoY=${x.salesYoY?.toFixed(1)}`).join(' | ')}`);
  console.log(`  consecutive=${r.consecutive} epsAcceleration=${r.epsAcceleration} sales=${r.salesAcceleration} margin=${r.marginImprovement} code33=${r.code33} epsFloor4@25=${r.epsFloor[4].at25} epsFloor2@25=${r.epsFloor[2].at25}`);
  console.log(`  epsUnknownCauses=${JSON.stringify(epsUnknownCauses(r))}`);
}
