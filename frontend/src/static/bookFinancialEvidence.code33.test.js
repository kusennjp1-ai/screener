import { expect, it } from 'vitest';
import { bookFinancialEvidence } from './bookFinancialEvidence';

const AS_OF = '2026-02-01';
const PERIODS = ['2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31', '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31'];

// Exercise the real evaluator, not an extracted or mocked aggregation helper.
// Missing prior-year EPS/revenue leaves all four current quarters available;
// current revenue can still establish margin levels when sales YoY is unknown.
function fixture(epsState = 'pass', salesState = 'pass', marginState = 'pass') {
  const series = (values, unit) => PERIODS.map((end, i) => ({
    end,
    start: `${end.slice(0, 4)}-${['01', '04', '07', '10'][i % 4]}-01`,
    filed: new Date(Date.parse(end) + 30 * 86400000).toISOString().slice(0, 10),
    value: values[i],
    unit,
    derived: false,
  }));
  const eps = series([1, 1, 1, 1, ...(epsState === 'fail' ? [1.8, 1.4, 1.2, 1.1] : [1.1, 1.2, 1.4, 1.8])], 'USD/shares');
  const revenue = series([100, 100, 100, 100, ...(salesState === 'fail' ? [200, 160, 130, 110] : [110, 130, 160, 200])], 'USD');
  const margins = [10, 10, 10, 10, ...(marginState === 'fail' ? [13, 12, 11, 10] : [10, 11, 12, 13])];
  const netIncome = series(revenue.map((p, i) => p.value * margins[i] / 100), 'USD');
  if (epsState === 'unknown') eps.shift();
  if (salesState === 'unknown') revenue.shift();
  if (marginState === 'unknown') netIncome.pop();
  return { symbol: 'TEST', as_of_date: AS_OF, status: 'available', quarterly: { eps, revenue, netIncome }, annualEps: [] };
}

const audit = f => bookFinancialEvidence(f, 'TEST', f.as_of_date);

// Full three-state AND truth table. Expected outcomes are literal, so the test
// does not duplicate the implementation's conditional expression.
it.each([
  ['pass', 'pass', 'pass', 'pass'],
  ['pass', 'pass', 'fail', 'fail'],
  ['pass', 'pass', 'unknown', 'unknown'],
  ['pass', 'fail', 'pass', 'fail'],
  ['pass', 'fail', 'fail', 'fail'],
  ['pass', 'fail', 'unknown', 'fail'],
  ['pass', 'unknown', 'pass', 'unknown'],
  ['pass', 'unknown', 'fail', 'fail'],
  ['pass', 'unknown', 'unknown', 'unknown'],
  ['fail', 'pass', 'pass', 'fail'],
  ['fail', 'pass', 'fail', 'fail'],
  ['fail', 'pass', 'unknown', 'fail'],
  ['fail', 'fail', 'pass', 'fail'],
  ['fail', 'fail', 'fail', 'fail'],
  ['fail', 'fail', 'unknown', 'fail'],
  ['fail', 'unknown', 'pass', 'fail'],
  ['fail', 'unknown', 'fail', 'fail'],
  ['fail', 'unknown', 'unknown', 'fail'],
  ['unknown', 'pass', 'pass', 'unknown'],
  ['unknown', 'pass', 'fail', 'fail'],
  ['unknown', 'pass', 'unknown', 'unknown'],
  ['unknown', 'fail', 'pass', 'fail'],
  ['unknown', 'fail', 'fail', 'fail'],
  ['unknown', 'fail', 'unknown', 'fail'],
  ['unknown', 'unknown', 'pass', 'unknown'],
  ['unknown', 'unknown', 'fail', 'fail'],
  ['unknown', 'unknown', 'unknown', 'unknown'],
])('aggregates actual EPS=%s, sales=%s, margin=%s as %s without replacing component states', (eps, sales, margin, overall) => {
  const f = fixture(eps, sales, margin);
  const original = structuredClone(f);
  expect(audit(f)).toMatchObject({
    valid: true,
    stale: false,
    epsAcceleration: eps,
    salesAcceleration: sales,
    marginImprovement: margin,
    code33: overall,
  });
  expect(f).toEqual(original);
});

it.each([
  { name: 'future filing', mutate: f => { f.quarterly.eps.at(-1).filed = '2026-03-01'; } },
  { name: 'derived EPS', mutate: f => { f.quarterly.eps.at(-1).derived = true; } },
  { name: 'negative comparison base', mutate: f => { f.quarterly.eps[3].value = -1; } },
  { name: 'zero comparison base', mutate: f => { f.quarterly.eps[3].value = 0; } },
  { name: 'missing period start', mutate: f => { delete f.quarterly.eps.at(-1).start; } },
  { name: 'noncomparable duration', mutate: f => { f.quarterly.eps.at(-1).start = '2025-10-22'; } },
  { name: 'annual or YTD duration', mutate: f => { f.quarterly.eps.at(-1).start = '2025-01-01'; } },
  { name: 'overlapping period', mutate: f => { f.quarterly.eps.at(-1).start = '2025-09-25'; } },
  { name: 'non-USD EPS', mutate: f => { f.quarterly.eps.at(-1).unit = 'EUR/shares'; } },
])('retains the $name EPS guard with and without an independent known failure', ({ mutate }) => {
  for (const [margin, overall] of [['pass', 'unknown'], ['fail', 'fail']]) {
    const f = fixture('pass', 'pass', margin);
    mutate(f);
    expect(audit(f)).toMatchObject({
      epsAcceleration: 'unknown', salesAcceleration: 'pass', marginImprovement: margin, code33: overall,
      epsFloor: { 2: { at20: 'unknown', at25: 'unknown' }, 4: { at20: 'unknown', at25: 'unknown' } },
    });
  }
});

it('keeps sales and margins unknown for a revenue currency mismatch', () => {
  for (const [eps, overall] of [['pass', 'unknown'], ['fail', 'fail']]) {
    const f = fixture(eps);
    f.quarterly.revenue.at(-1).unit = 'EUR';
    expect(audit(f)).toMatchObject({ epsAcceleration: eps, salesAcceleration: 'unknown', marginImprovement: 'unknown', code33: overall });
  }
});

it.each([
  { name: 'net income currency mismatch', mutate: f => { f.quarterly.netIncome.at(-1).unit = 'EUR'; } },
  { name: 'net income/revenue period mismatch', mutate: f => { f.quarterly.netIncome.at(-1).start = '2025-10-02'; } },
])('retains unknown margin for $name with and without a known EPS failure', ({ mutate }) => {
  for (const [eps, overall] of [['pass', 'unknown'], ['fail', 'fail']]) {
    const f = fixture(eps);
    mutate(f);
    expect(audit(f)).toMatchObject({ epsAcceleration: eps, salesAcceleration: 'pass', marginImprovement: 'unknown', code33: overall });
  }
});

it.each([
  ['2026-06-29', false, 'fail'], // Exactly 180 days after 2025-12-31.
  ['2026-06-30', true, 'unknown'],
])('retains the 180-day comparability boundary at %s', (date, stale, overall) => {
  const f = fixture('fail', 'pass', 'unknown');
  f.as_of_date = date;
  expect(audit(f)).toMatchObject({
    stale,
    epsAcceleration: stale ? 'unknown' : 'fail',
    salesAcceleration: stale ? 'unknown' : 'pass',
    marginImprovement: 'unknown',
    code33: overall,
  });
});

it('does not turn an apparent failure across a missing current quarter into a known failure', () => {
  const f = fixture('fail', 'fail', 'fail');
  for (const values of Object.values(f.quarterly)) values.splice(6, 1);
  expect(audit(f)).toMatchObject({
    stale: false, epsAcceleration: 'unknown', salesAcceleration: 'unknown', marginImprovement: 'unknown', code33: 'unknown',
  });
});

it('preserves strict improvement and the existing EPS floors independently', () => {
  const f = fixture();
  [4, 5, 6, 7].forEach(i => { f.quarterly.eps[i].value = 1.2; });
  expect(audit(f)).toMatchObject({
    epsAcceleration: 'fail', salesAcceleration: 'pass', marginImprovement: 'pass', code33: 'fail',
    epsFloor: { 2: { at20: 'pass', at25: 'fail' }, 4: { at20: 'pass', at25: 'fail' } },
  });
});

it('does not apply Code 33 failure precedence to the separate EPS floor readiness rule', () => {
  const f = fixture('pass', 'fail', 'pass');
  f.quarterly.eps.splice(3, 1); // Last YoY is unknown; the first of four is known below 20%.
  expect(audit(f)).toMatchObject({
    epsAcceleration: 'unknown', salesAcceleration: 'fail', marginImprovement: 'pass', code33: 'fail',
    epsFloor: { 2: { at20: 'unknown', at25: 'unknown' }, 4: { at20: 'unknown', at25: 'unknown' } },
  });
});

it.each([
  { name: 'symbol mismatch', mutate: f => { f.symbol = 'OTHER'; } },
  { name: 'invalid as-of date', mutate: f => { f.as_of_date = '2026-99-99'; } },
  { name: 'unavailable status', mutate: f => { f.status = 'unavailable'; } },
])('does not classify an invalid input as a known failure: $name', ({ mutate }) => {
  const f = fixture('fail', 'fail', 'fail');
  mutate(f);
  expect(audit(f)).toMatchObject({ valid: false, code33: 'unknown', rows: [] });
});

it('keeps a mismatched requested snapshot unknown even when its stored trends fail', () => {
  expect(bookFinancialEvidence(fixture('fail', 'fail', 'fail'), 'TEST', '2026-02-02')).toMatchObject({
    valid: false, code33: 'unknown', rows: [],
  });
});
