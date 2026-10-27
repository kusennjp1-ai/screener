import { expect, it } from 'vitest';
import { institutionalRanking } from './institutionalRanking';
const evidence = (symbol,previous,current,cutoff='2026-08-31') => ({row:{symbol,institutional_evidence:{symbol,status:'available',unit:'13f_reporting_manager_cik',publication_cutoff:cutoff,observations:[
 {period:'2026-03-31',manager_count:previous,filing_date_first:'2026-04-10',filing_date_last:'2026-05-15'},
 {period:'2026-06-30',manager_count:current,filing_date_first:'2026-07-10',filing_date_last:'2026-08-15'},
]}}});
it('ranks changes and preserves ties in quarter-end manager-count ranks',()=>{
 const result=institutionalRanking([evidence('A',100,110),evidence('B',200,110),evidence('C',50,150)],'2026-10-23');
 expect(result.groups[0].map(x=>[x.symbol,x.delta,x.previousRank,x.currentRank])).toEqual([['C',100,3,1],['A',10,2,2],['B',-90,1,2]]);
 expect(result.unavailable).toBe(0);
});
it('does not merge public cutoffs, turn missing holdings into zero, or include future/stale reports',()=>{
 const rows=[evidence('A',100,110),evidence('B',20,30,'2026-09-30'),evidence('ZERO',0,30),{row:{symbol:'MISSING'}},evidence('FUTURE',10,40,'2026-11-01')];
 expect(institutionalRanking(rows,'2026-10-23')).toMatchObject({groups:expect.any(Array),unavailable:3,total:5});
 expect(institutionalRanking(rows,'2026-10-23').groups).toHaveLength(2);
 expect(institutionalRanking(rows,'2027-02-01').groups).toHaveLength(0);
});
it('rejects wrong stock identity, malformed periods and post-cutoff amendments',()=>{
 const bad=evidence('BAD',100,110);bad.row.institutional_evidence.observations[1].filing_date_last='2026-09-01';
 const wrong=evidence('WRONG',100,110);wrong.row.institutional_evidence.symbol='OTHER';
 expect(institutionalRanking([bad,wrong],'2026-10-23')).toMatchObject({groups:[],unavailable:2});
});
it('does not promote an amendment-only late first-quarter count into a huge accumulation rank',()=>{
 const late=evidence('LATE',5,2033);late.row.institutional_evidence.observations[0].filing_date_first='2026-07-27';late.row.institutional_evidence.observations[0].filing_date_last='2026-08-26';
 expect(institutionalRanking([late,evidence('OBSERVED',100,110)],'2026-10-23')).toMatchObject({continuityUnconfirmed:1,unavailable:0,groups:[[{symbol:'OBSERVED'}]]});
});
it('excludes a documented identifier transition only for a pair spanning its effective date',()=>{
 const ccl=evidence('CCL',29,988);
 const crossing=institutionalRanking([ccl],'2026-10-23');
 expect(crossing).toMatchObject({groups:[],continuityUnconfirmed:1});
 expect(crossing.continuityExcluded[0].source).toContain('sec.gov/Archives/');
 ccl.row.institutional_evidence.publication_cutoff='2026-11-20';
 ccl.row.institutional_evidence.observations=[
  {period:'2026-06-30',manager_count:988,filing_date_first:'2026-07-10',filing_date_last:'2026-08-15'},
  {period:'2026-09-30',manager_count:1000,filing_date_first:'2026-10-10',filing_date_last:'2026-11-15'},
 ];
 expect(institutionalRanking([ccl],'2026-11-25').groups[0][0]).toMatchObject({symbol:'CCL',delta:12});
});
