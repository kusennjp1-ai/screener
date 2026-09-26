import { expect, it, vi } from 'vitest';
import { financialHistory } from './financialHistory';
import { assess } from './researchEngine';
import { withAuditFixture } from './testAuditFixture';
const now = Date.parse('2026-09-26T08:00:00Z');
const fixture = () => ({symbol:'TEST',as_of_date:'2026-09-25',retrieved_at:'2026-09-26T07:00:00Z',status:'available',basis:'reported_diluted_eps',currency:'USD',
  annual:[2022,2023,2024,2025].map((y,i)=>({end:`${y}-12-31`,eps:2**i})),
  quarterly:[{end:'2025-06-30',eps:1,revenue:100},{end:'2026-06-30',eps:2,revenue:130}]});
it('calculates actual three annual rates and same-quarter YoY',()=>{
  const result=financialHistory(fixture(),'TEST','2026-09-25',now);
  expect(result.annualGrowth).toEqual([100,100,100]);expect(result.epsYoY).toBe(100);expect(result.salesYoY).toBeCloseTo(30);
});
it('distinguishes complete reported history from positive-base growth qualification',()=>{
 vi.useFakeTimers();vi.setSystemTime(now);
 try {
  const data=fixture(); data.annual[0].eps=-1;
  const report=financialHistory(data,'TEST','2026-09-25',now);
  expect(report.annualComplete).toBe(true);expect(report.annualGrowth).toBeNull();
  const row=withAuditFixture({symbol:'TEST',financial_history:data},'2026-09-25');
  expect(assess(row,'ibd').rules.find(r=>r.label.includes('3年')).state).toBe('pass');
  expect(assess(row,'oneil').rules.find(r=>r.label.includes('3年')).state).toBe('unknown');
 } finally {vi.useRealTimers();}
});
it('does not turn missing years, negative bases or stale observations into a pass',()=>{
  for (const change of [d=>d.annual[2].eps=null,d=>d.annual[0].eps=-1,d=>d.annual.splice(1,1),d=>d.annual[0].end='2020-12-31',d=>d.retrieved_at='2026-09-01',d=>d.currency='EUR',d=>d.symbol='OTHER',d=>d.annual[3].end='2026-12-31']) {
    const data=fixture();change(data);expect(financialHistory(data,'TEST','2026-09-25',now).annualGrowth).toBeNull();
  }
});
