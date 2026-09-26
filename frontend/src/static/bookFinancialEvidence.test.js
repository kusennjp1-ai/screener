import { expect, it } from 'vitest';
import { bookFinancialEvidence } from './bookFinancialEvidence';
function fixture() {
  const periods = ['2024-03-31','2024-06-30','2024-09-30','2024-12-31','2025-03-31','2025-06-30','2025-09-30','2025-12-31'];
  const series = values => periods.map((end, i) => ({ end, start: `${end.slice(0, 4)}-${['01','04','07','10'][i % 4]}-01`, filed: new Date(Date.parse(end) + 30 * 86400000).toISOString().slice(0, 10), value: values[i], derived: false }));
  return { symbol: 'TEST', as_of_date: '2026-02-01', status: 'available', quarterly: {
    eps: series([1,1,1,1,1.1,1.2,1.4,1.8]), revenue: series([100,100,100,100,110,130,160,200]), netIncome: series([10,10,10,10,11,14.3,19.2,26])
  }, annualEps: [] };
}
const audit = f => bookFinancialEvidence(f, 'TEST', '2026-02-01');
it('uses four quarters and three increases in margin LEVELS, EPS YoY and sales YoY', () => {
  expect(audit(fixture())).toMatchObject({ valid: true, code33: 'pass', epsAcceleration: 'pass', salesAcceleration: 'pass', marginImprovement: 'pass' });
});
it('does not substitute accelerating margin YoY for a falling margin level', () => {
  const f = fixture();
  [5,4,3,2,6,5.5,5,4.5].forEach((margin, i) => { f.quarterly.netIncome[i].value = f.quarterly.revenue[i].value * margin / 100; });
  expect(audit(f).marginImprovement).toBe('fail');
  expect(audit(f).code33).toBe('fail');
});
it('does not bridge a missing quarter or certify stale statements', () => {
  const f = fixture();
  for (const values of Object.values(f.quarterly)) values.splice(6, 1);
  expect(audit(f).code33).toBe('unknown');
  f.as_of_date = '2026-09-25';
  expect(bookFinancialEvidence(f, 'TEST', '2026-09-25').stale).toBe(true);
});
it('rejects future filings, derived EPS, negative bases and mismatched identities', () => {
  for (const mutate of [f => { f.quarterly.eps.at(-1).filed = '2026-03-01'; }, f => { f.quarterly.eps.at(-1).derived = true; }, f => { f.quarterly.eps[3].value = -1; }]) {
    const f = fixture(); mutate(f); expect(audit(f).code33).toBe('unknown');
  }
  expect(bookFinancialEvidence(fixture(), 'OTHER', '2026-02-01').valid).toBe(false);
  expect(bookFinancialEvidence(fixture(), 'TEST', '2026-99-99').valid).toBe(false);
});
it('does not compare quarters with different duration or missing period starts', () => {
  const f = fixture();
  f.quarterly.eps.at(-1).start = '2025-10-22'; // 71 days versus the prior-year 92 days
  expect(audit(f).rows.at(-1).epsYoY).toBeNull();
  expect(audit(f).code33).toBe('unknown');
  delete f.quarterly.eps.at(-1).start;
  expect(audit(f).rows.at(-1).eps).toBeNull();
});
it('permits one extra retail week but rejects annual/YTD or overlapping facts as quarters', () => {
  const f = fixture();
  f.quarterly.eps.at(-1).start = '2025-10-08'; // exactly seven fewer days
  expect(audit(f).rows.at(-1).epsYoY).toBeCloseTo(80);
  f.quarterly.eps.at(-1).start = '2025-01-01';
  expect(audit(f).epsAcceleration).toBe('unknown');
  f.quarterly.eps.at(-1).start = '2025-09-25'; // valid length but overlaps Q3
  expect(audit(f).epsAcceleration).toBe('unknown');
});
it('rejects inconsistent units and annual records built from quarter-length facts', () => {
  const f = fixture(); f.quarterly.eps.at(-1).unit = 'EUR/shares';
  expect(audit(f).epsAcceleration).toBe('unknown');
  f.annualEps = fixture().quarterly.eps.slice(-3);
  expect(audit(f).annualRecord).toBe('unknown');
});
it('keeps instant balance-sheet facts distinct from duration income facts', () => {
  const f = fixture();
  f.quarterly.inventory = f.quarterly.eps.map((p, i) => ({ ...p, start: null, value: i < 4 ? 100 : 200 }));
  expect(audit(f).balanceCoverage).toBe(4);
  expect(audit(f).balanceWarnings.length).toBeGreaterThan(0);
});
it('does not misclassify an exact EPS20% floor due to binary floating point', () => {
  const f = fixture();
  [2, 3].forEach(i => { f.quarterly.eps[i].value = .125; });
  [6, 7].forEach(i => { f.quarterly.eps[i].value = .15; });
  expect(audit(f).epsFloor[2].at20).toBe('pass');
});
