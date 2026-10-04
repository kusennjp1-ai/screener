import { expect, it } from 'vitest';
import { orderCandidates } from './candidateOrdering';
import { withAuditFixture } from './testAuditFixture';

const date = '2026-09-29';
const sorts = ['rank', 'distance', 'rs', 'volume', 'state'];
const symbols = items => items.map(item => item.row.symbol);
function candidate(symbol, { distance = 0, rs = 80, volume = 1, ...row } = {}) {
  const audited = withAuditFixture({ symbol, current_price: 100 + distance, se_pivot_price: 100, rs_rating: rs, ...row }, date);
  audited.technical_audit.values.volumeRatio = volume;
  return { row: audited, assessment: { qualified: true, passed: 9, total: 9 } };
}
const ranked = [
  candidate('F', { rs: 85, volume: 4, corporate_action: { cash_acquisition: true } }),
  candidate('D', { current_price: null, rs: null }),
  candidate('A', { distance: 6, rs: 70, volume: 3 }),
  candidate('E', { rs: 90, volume: .5, price_activity: { lowRange: true } }),
  candidate('B', { distance: -2, rs: 95, volume: 2 }),
  candidate('C', { distance: 4, rs: 80, volume: 1 }),
];

it.each([
  ['rank', ['F', 'D', 'A', 'E', 'B', 'C']],
  ['distance', ['E', 'F', 'B', 'C', 'A', 'D']],
  ['rs', ['B', 'E', 'F', 'C', 'A', 'D']],
  ['volume', ['F', 'A', 'B', 'C', 'E', 'D']],
  ['state', ['C', 'B', 'A', 'D', 'E', 'F']],
])('orders the complete cohort by %s using the existing display semantics', (sort, expected) => {
  expect(symbols(orderCandidates(ranked, { sort, date }))).toEqual(expected);
});

it('preserves canonical rank and avoids allocating plans for the default order', () => {
  expect(orderCandidates(ranked)).toBe(ranked);
  expect(orderCandidates(ranked, { sort: 'rank', method: 'minervini2', date })).toBe(ranked);
  expect(ranked.every(item => !Object.hasOwn(item, 'plan'))).toBe(true);
});

it.each(['distance', 'rs', 'volume', 'state'])('breaks equal known %s keys by symbol', sort => {
  const tied = [candidate('Z'), candidate('A'), candidate('M')];
  expect(symbols(orderCandidates(tied, { sort, date }))).toEqual(['A', 'M', 'Z']);
});

it.each(['distance', 'rs', 'volume'])('keeps missing %s values last in their canonical rank order', sort => {
  const missing = [
    candidate('Z', { current_price: null, rs: null, volume: null }),
    candidate('B', { distance: 2, rs: 80, volume: 2 }),
    candidate('Y', { current_price: undefined, rs: undefined, volume: undefined }),
    candidate('A', { distance: 1, rs: 95, volume: 3 }),
  ];
  // Explicit undefined must remain missing rather than take fixture defaults.
  missing[2].row.rs_rating = undefined;
  expect(symbols(orderCandidates(missing, { sort, date }))).toEqual(['A', 'B', 'Z', 'Y']);
});

it('rebuilds the canonical row plan and honors the selected method zone', () => {
  const inputs = [candidate('A', { distance: 4 }), candidate('Z', { distance: 2 })];
  inputs[0].plan = { distance: 0, state: '買いゾーン内' };
  const ordered = orderCandidates(inputs, { sort: 'distance', date });
  expect(symbols(ordered)).toEqual(['Z', 'A']);
  expect(ordered[1].plan.distance).toBeCloseTo(4);
  expect(inputs[0].plan.distance).toBe(0);
  expect(symbols(orderCandidates(inputs, { sort: 'state', method: 'minervini', date }))).toEqual(['A', 'Z']);
  expect(symbols(orderCandidates(inputs, { sort: 'state', method: 'minervini2', date }))).toEqual(['Z', 'A']);
});

it('uses only verified volume for the selected date, ignoring legacy and rejected observations', () => {
  const stale = candidate('STALE', { volume: 10, se_volume_vs_50d: 100 });
  stale.row.technical_audit.as_of_date = '2026-09-28';
  const mismatched = candidate('MISMATCH', { volume: 20 });
  mismatched.row.technical_audit.symbol = 'OTHER';
  const rejected = candidate('REJECTED', { volume: 30 });
  rejected.row.technical_audit.valid = false;
  const inputs = [stale, mismatched, candidate('LOW', { volume: .5, se_volume_vs_50d: 99 }), rejected, candidate('HIGH', { volume: 2, se_volume_vs_50d: 0 })];
  expect(symbols(orderCandidates(inputs, { sort: 'volume', date }))).toEqual(['HIGH', 'LOW', 'STALE', 'MISMATCH', 'REJECTED']);
  expect(symbols(orderCandidates(inputs, { sort: 'volume', date: '2026-09-30' }))).toEqual(symbols(inputs));
  expect(symbols(orderCandidates(inputs, { sort: 'volume' }))).toEqual(symbols(inputs));
});

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

it.each(sorts)('keeps every filtered row and leaves the full input untouched for %s', sort => {
  const filtered = freeze(Array.from({ length: 107 }, (_, index) => candidate(`S${index}`, { distance: index % 9 - 4, rs: index % 99, volume: index % 5 }))
    .filter((_, index) => index % 3 !== 0));
  const before = structuredClone(filtered);
  const ordered = orderCandidates(filtered, { sort, date });
  expect(ordered).toHaveLength(71);
  expect(new Set(symbols(ordered))).toEqual(new Set(symbols(filtered)));
  expect(filtered).toEqual(before);
  for (const item of ordered) expect(item.row).toBe(filtered.find(source => source.row.symbol === item.row.symbol).row);
});
