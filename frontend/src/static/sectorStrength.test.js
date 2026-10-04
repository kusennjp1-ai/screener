import {expect,it} from 'vitest';
import {relativeIndex,sectorStrength} from './sectorStrength';
import {filterRanked} from './researchPresentation';
import {withAuditFixture} from './testAuditFixture';
import {withFinancialProof, FINANCIAL_TEST_NOW as now, FINANCIAL_TEST_DATE as date} from './testFinancialFixture';
const bars=[{date:'2026-09-25',close:100},{date:'2026-09-28',close:110},{date:'2026-09-29',close:120}];
it('uses relative price, not stock price return',()=>{
  expect(relativeIndex(bars,bars.map(b=>({...b,close:b.close===120?110:100})),'2026-09-29',2,true).value).toBeCloseTo(109.090909);
});
it('excludes future dates',()=>expect(relativeIndex([...bars,{date:'2026-09-30',close:900}],bars,'2026-09-29',2,true).value).toBe(100));
it.each([false,null])('requires matched adjustment policy %s',valid=>expect(relativeIndex(bars,bars,'2026-09-29',2,valid).value).toBeNull());
it('requires every trading date and matching final date',()=>{
  expect(relativeIndex([bars[0],bars[2]],bars,'2026-09-29',2,true).value).toBeNull();
  expect(relativeIndex(bars,bars,'2026-09-30',2,true).value).toBeNull();
});
it('keeps unknowns in breadth denominator and unknown classifications separate',()=>{
  const row={symbol:'TEST',current_price:100,adv_usd:3e7,gics_sector:'Technology'};
  const result=sectorStrength([row,{...row,symbol:'UNKNOWN',gics_sector:null},{...row,symbol:'ILLIQ',adv_usd:1}],null,'2026-09-29');
  expect(result.groups.find(g=>g.key==='Technology').rates.minervini).toEqual({pass:0,total:1,unknown:1,percent:0});
  expect(result.groups.find(g=>g.key==='Unknown').rates.minervini.total).toBe(1);
});
it('normalizes actual provider financial classifications in both aggregation and navigation',()=>{
  const rows=['Financial','Financial Services',null].map((gics_sector,i)=>({symbol:`F${i}`,gics_sector,current_price:100,adv_usd:3e7}));
  const groups=sectorStrength(rows,null,'2026-09-29').groups;
  expect(groups.find(g=>g.key==='Financial').rates.minervini.total).toBe(2);
  expect(filterRanked(rows.map(row=>({row,assessment:{}})),{sector:'Financial'})).toHaveLength(2);
  expect(filterRanked(rows.map(row=>({row,assessment:{}})),{sector:'Unknown'})).toHaveLength(1);
});
it('reproduces published sector qualification at its declared epoch after source history expires',()=>{
  const row=withFinancialProof(withAuditFixture({symbol:'TEST',market:'US',currency:'USD',current_price:100,adv_usd:3e7,gics_sector:'Technology',rs_rating:90,
    market_above_50dma:true,market_above_200dma:true,
    financial_history:{symbol:'TEST',as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'Synthetic publisher fixture',retrieved_at:new Date(now).toISOString(),annual:[
      {end:'2022-12-31',eps:1},{end:'2023-12-31',eps:1.25},{end:'2024-12-31',eps:1.5625},{end:'2025-12-31',eps:1.953125}]},
    institutional_evidence:{symbol:'TEST',status:'available',unit:'13f_reporting_manager_cik',publication_cutoff:date,observations:[
      {period:'2026-03-31',manager_count:100,filing_date_first:'2026-05-01',filing_date_last:'2026-05-15'},
      {period:'2026-06-30',manager_count:110,filing_date_first:'2026-08-01',filing_date_last:'2026-08-15'}]},
  },date),now,date);
  const at=time=>sectorStrength([row],null,date,time).groups.find(group=>group.key==='Technology').rates.oneil;
  expect(at(now)).toEqual({pass:1,total:1,unknown:0,percent:100});
  expect(at(now+72*3600000+1)).toEqual({pass:0,total:1,unknown:1,percent:0});
  expect(at(now)).toEqual({pass:1,total:1,unknown:0,percent:100});
});
