import { describe, expect, it } from 'vitest';
import { bookFinancialEvidence, risesDetail, yoyDetail } from './bookFinancialEvidence';
import { secPoint, secRecord } from '../test/fixtures/secRecord';
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

it('accepts a documented derived Q4 for revenue and net income but never for EPS', async () => {
  const { DERIVED_Q4 } = await import('./bookFinancialEvidence');
  const base = audit(fixture());
  const f = fixture();
  const derive = p => Object.assign(p, { derived: DERIVED_Q4, components: ['fy', 'q1', 'q2', 'q3'] });
  derive(f.quarterly.revenue.at(-1)); derive(f.quarterly.netIncome.at(-1));
  const report = audit(f);
  expect(report.salesAcceleration).toBe(base.salesAcceleration);
  expect(report.code33).toBe(base.code33);
  expect(report.rows.at(-1).derived).toBe(true);
  const missingSources = fixture();
  Object.assign(missingSources.quarterly.revenue.at(-1), { derived: DERIVED_Q4, components: ['fy'] });
  expect(audit(missingSources).salesAcceleration).toBe('unknown');
  const eps = fixture();
  derive(eps.quarterly.eps.at(-1));
  expect(audit(eps).epsAcceleration).toBe('unknown');
});

describe('reasons, fiscal fourth quarters and three-valued Code 33', () => {
  const date = '2026-02-01';
  const report = record => bookFinancialEvidence(record, 'TEST', date);
  // A 10-Q filer: the fiscal-Q4 EPS exists only as the 10-K annual value.
  const tenQFiler = () => {
    const record = secRecord();
    record.quarterly.eps = record.quarterly.eps.filter(p => !p.end.endsWith('12-31'));
    record.annualEps = [secPoint('eps', ['2024-01-01', '2024-12-31'], 4), secPoint('eps', ['2025-01-01', '2025-12-31'], 5.5)];
    return record;
  };

  it('names why each growth rate or margin is unknown', () => {
    const points = [{ end: '2024-12-20', start: '2024-09-21', value: 1 }, { end: '2025-01-05', start: '2024-10-07', value: 1 }];
    expect(yoyDetail(points, '2025-12-31')).toEqual({ value: null, reason: 'not_reported' });
    expect(yoyDetail([...points, { end: '2025-12-31', start: '2025-10-01', value: 2 }], '2025-12-31').reason).toBe('ambiguous_base');
    const filer = report(tenQFiler());
    const q4 = filer.rows.at(-1);
    expect(q4).toMatchObject({ end: '2025-12-31', eps: null, epsYoY: null, epsYoYReason: 'not_reported', fiscalQ4: true, form: '10-K', salesYoYReason: null, marginReason: null });
    expect(filer.rows.slice(0, 4).map(row => row.salesYoYReason)).toEqual(['no_base', 'no_base', 'no_base', 'no_base']);
    expect(filer.rows.at(-2)).toMatchObject({ fiscalQ4: false, form: '10-Q', epsYoYReason: null });
    const loss = secRecord(); loss.quarterly.eps[4].value = 0.2; loss.quarterly.eps[0].value = -0.5;
    expect(report(loss).rows[4]).toMatchObject({ eps: 0.2, epsYoY: null, epsYoYReason: 'nonpositive_base' });
    const short = secRecord(); short.quarterly.eps.at(-1).start = '2025-10-22';
    expect(report(short).rows.at(-1).epsYoYReason).toBe('period_mismatch');
    const margins = secRecord();
    margins.quarterly.netIncome.splice(7, 1); margins.quarterly.revenue[6].value = 0; margins.quarterly.netIncome[5].start = '2025-04-02';
    expect(report(margins).rows.slice(5).map(row => row.marginReason)).toEqual(['start_mismatch', 'nonpositive_revenue', 'not_reported']);
  });

  it('fails Code 33 on any known failure, passes only on three passes and otherwise stays unknown', () => {
    expect(report(secRecord()).code33).toBe('pass');
    const unknownEps = report(tenQFiler());
    expect([unknownEps.epsAcceleration, unknownEps.salesAcceleration, unknownEps.marginImprovement, unknownEps.code33]).toEqual(['unknown', 'pass', 'pass', 'unknown']);
    const falling = tenQFiler();
    [12, 11, 10, 9, 12, 11, 10, 9].forEach((margin, i) => { falling.quarterly.netIncome[i].value = falling.quarterly.revenue[i].value * margin / 100; });
    const failed = report(falling);
    expect([failed.epsAcceleration, failed.marginImprovement, failed.code33]).toEqual(['unknown', 'fail', 'fail']);
  });

  it('gives the same evidence from the published 1100-day window as from the full series', () => {
    const quarters = [], values = { eps: [], revenue: [], netIncome: [] };
    for (let year = 2020; year <= 2025; year++) for (const [s, e] of [['01-01', '03-31'], ['04-01', '06-30'], ['07-01', '09-30'], ['10-01', '12-31']]) {
      const i = quarters.push([`${year}-${s}`, `${year}-${e}`]) - 1;
      values.eps.push(1 + i * 0.05 + (i % 3) * 0.02); values.revenue.push(100 * 1.03 ** i); values.netIncome.push(100 * 1.03 ** i * (0.08 + i * 0.002));
    }
    const full = secRecord({ quarters, ...values });
    full.quarterly.inventory = quarters.map(([, end], i) => secPoint('inventory', [null, end], 50 + i * (i > 18 ? 9 : 1)));
    full.annualEps = [2020, 2021, 2022, 2023, 2024].map(year => secPoint('eps', [`${year}-01-01`, `${year}-12-31`], 4 + year - 2020));
    const trimmed = structuredClone(full);
    const latest = [...full.quarterly.eps, ...full.quarterly.revenue].map(p => p.end).sort().at(-1);
    const cutoff = new Date(Date.parse(latest) - 1100 * 86400000).toISOString().slice(0, 10);
    for (const key of Object.keys(trimmed.quarterly)) trimmed.quarterly[key] = trimmed.quarterly[key].filter(p => p.end >= cutoff);
    expect(trimmed.quarterly.eps.length).toBeLessThan(full.quarterly.eps.length);
    const a = report(full), b = report(trimmed);
    const keys = ['rows', 'code33', 'epsFloor', 'balanceWarnings', 'annualRecord', 'epsAcceleration', 'salesAcceleration', 'marginImprovement'];
    expect(Object.fromEntries(keys.map(key => [key, b[key]]))).toEqual(Object.fromEntries(keys.map(key => [key, a[key]])));
    expect(a.rows).toHaveLength(8);
    expect(a.balanceWarnings.length).toBeGreaterThan(0);
  });
});

describe('three-valued "rises" (Kleene)', () => {
  it('fails on a known fall even beside a gap, passes only when every step is known and rising', () => {
    expect(risesDetail([30, 20, null, 50])).toEqual({ state: 'fail', pair: [0, 1] });
    expect(risesDetail([10, null, 30, 40])).toEqual({ state: 'unknown', pair: null });
    expect(risesDetail([10, 20, 30, 40])).toEqual({ state: 'pass', pair: null });
    expect(risesDetail([null, null, null, null])).toEqual({ state: 'unknown', pair: null });
    // A fall across a gap still settles it: 40 then (unknown) then 35.
    expect(risesDetail([10, 40, null, 35])).toEqual({ state: 'fail', pair: [1, 3] });
    // Equal is not a rise.
    expect(risesDetail([10, 20, 20, 30])).toEqual({ state: 'fail', pair: [1, 2] });
  });

  it('turns a known fall next to a missing quarter into 未達 and names the two quarters, never a new pass', () => {
    const date = '2026-02-01', report = record => bookFinancialEvidence(record, 'TEST', date);
    // EPS growth: +10, +20, (the newest EPS is missing), and sales growth falls from +60% to +30% with the margin missing in between.
    const record = secRecord({ revenue: [100, 100, 100, 100, 110, 130, 160, 130], netIncome: [10, 10, 10, 10, 11, 14.3, null, 26] });
    record.quarterly.eps.pop();
    const value = report(record);
    expect(value.rows.map(row => row.salesYoY?.toFixed(0))).toEqual([undefined, undefined, undefined, undefined, '10', '30', '60', '30']);
    expect(value).toMatchObject({ epsAcceleration: 'unknown', salesAcceleration: 'fail', code33: 'fail' });
    expect(value.settled.salesAcceleration).toEqual({ from: { end: '2025-09-30', value: expect.closeTo(60, 6) }, to: { end: '2025-12-31', value: expect.closeTo(30, 6) } });
    expect(value.settled).not.toHaveProperty('epsAcceleration');
    // The same quarters with nothing falling stay unknown (the gap is never bridged into a pass).
    const open = secRecord({ netIncome: [10, 10, 10, 10, 11, 14.3, null, 26] });
    expect(report(open)).toMatchObject({ marginImprovement: 'unknown', code33: 'unknown', settled: {} });
    // The default fixture keeps its pass; no fixture gains one.
    expect(report(secRecord())).toMatchObject({ code33: 'pass', settled: {} });
  });
});
