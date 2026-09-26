import { expect, it } from 'vitest';
import { marketLeadership } from './marketLeadership';
import { withAuditFixture } from './testAuditFixture';
it('counts only same-date verified leaders and reports RS evidence coverage', () => {
  const a = withAuditFixture({ symbol: 'A', current_price: 100, rs_rating: 90 });
  a.book_diagnostics = { valid: true, as_of_date: '2026-09-23', rsLine: { sixWeeks: { state: 'up' } } };
  const b = withAuditFixture({ symbol: 'B', current_price: 100, rs_rating: 90 });
  const stale = withAuditFixture({ symbol: 'OLD', current_price: 100, rs_rating: 90 }, '2026-09-22');
  expect(marketLeadership([a, b, stale, { symbol: 'NONE' }], '2026-09-23')).toMatchObject({ universe: 4, verified: 2, templateLeaders: 2, rsAvailable: 1, rsUp: 1, automaticExposure: false, historicalComparison: false });
});
