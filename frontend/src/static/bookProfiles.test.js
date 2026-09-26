import { expect, it } from 'vitest';
import { assess, entryPlan, entryChecks } from './researchEngine';
import { withAuditFixture } from './testAuditFixture';
it('keeps the two book low-distance thresholds distinct at their boundaries', () => {
  const row = withAuditFixture({ symbol: 'BOOK', current_price: 103, rs_rating: 90 });
  for (const [distance, first, second] of [[24.99,false,false],[25,false,true],[29.99,false,true],[30,true,true]]) {
    row.technical_audit.values.aboveLow = distance;
    expect(assess(row, 'minervini').qualified).toBe(first);
    expect(assess(row, 'minervini2').qualified).toBe(second);
  }
});
it('does not let the second book inherit the five-percent entry zone', () => {
  const row = withAuditFixture({ symbol: 'BOOK', current_price: 103, se_pivot_price: 100 });
  expect(entryPlan(row, null, 'minervini2').state).toBe('買いゾーン内');
  expect(entryChecks(row, 'minervini2')[0].state).toBe('pass');
  row.current_price = 103.01;
  row.technical_audit.values.close = 103.01;
  expect(entryPlan(row, null, 'minervini2').state).toBe('買いゾーン超過');
  expect(entryChecks(row, 'minervini2')[0].state).toBe('fail');
  expect(entryPlan(row, null, 'ibd').state).toBe('買いゾーン内');
});
