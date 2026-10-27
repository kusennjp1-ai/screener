import { expect, it } from 'vitest';
import { strongestMarketCandidates } from './marketCandidates';
const item = (symbol,extra={}) => ({row:{symbol,current_price:100,adv_usd:30e6,rs_rating:90,...extra},assessment:{qualified:true,failed:0,unknown:0,passed:8,total:8}});
const rank = rows => strongestMarketCandidates(rows,'2026-10-23',{state:'unknown'},Date.parse('2026-10-27T12:00Z'));
it('excludes unknown selection, bad liquidity and corporate-action candidates even with a high RS',()=>{
 const unknown=item('UNKNOWN');unknown.assessment.unknown=1;
 const excluded=item('EXCLUDED');excluded.assessment.financial_exclusion={};
 const missing=item('MISSING');delete missing.assessment.unknown;
 expect(rank([unknown,excluded,missing,item('CASH',{corporate_action:{cash_acquisition:true}}),item('THIN',{adv_usd:null}),item('ZERO',{rs_rating:0}),item('GOOD')]).map(x=>x.row.symbol)).toEqual(['GOOD']);
});
it('ranks a measured price zone above an overextended higher-RS candidate with otherwise equal evidence',()=>{
 const rows=rank([item('EXT',{rs_rating:99,se_pivot_price:80}),item('NEAR',{rs_rating:90,se_pivot_price:99})]);
 expect(rows[0].row.symbol).toBe('NEAR');
 expect(rows.every(row=>row.readiness.ready===false)).toBe(true);
});
it('breaks a genuinely equal comparison deterministically without mutating the source',()=>{
 const source=[item('BBB'),item('AAA')];
 expect(rank(source).map(x=>x.row.symbol)).toEqual(['AAA','BBB']);
 expect(source.map(x=>x.row.symbol)).toEqual(['BBB','AAA']);
});
