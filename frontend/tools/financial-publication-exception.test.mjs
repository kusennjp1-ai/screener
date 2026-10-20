// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FINANCIAL_DESIGN_CASES, financialDesignScreens, financialCaseSource,
  publicationFinancialCaseSource, verifyFinancialDetailClock } from './financial-design-cases.mjs';
import { withFinancialProof } from '../src/static/testFinancialFixture.js';
const now=Date.parse('2026-10-04T15:00:00Z'),date='2026-10-02';
const row=symbol=>withFinancialProof({symbol,market:'US',as_of_date:date,technical_audit:{as_of_date:date},eps_growth_yy:30,sales_growth_yy:30},now,date);
describe('ordinary Design financial availability exception',()=>{
  it('records the original fresh category as unavailable while preserving all 28 purpose captures',()=>{
    for(const item of FINANCIAL_DESIGN_CASES){
      const value=row(item.symbol),source=publicationFinancialCaseSource(value,item,date,now);
      expect(source.original_category.status).toBe('unavailable');
      expect(source.publication_exception).toMatchObject({symbol:item.symbol,status:'excluded_unknown',qualified:false,satisfies_fresh_category:false});
      expect(source.annual).toEqual([]);
      expect(()=>financialCaseSource(value,item,date,now)).toThrow('unavailable or expired');
    }
    expect(financialDesignScreens({width:1440},'dark').length+financialDesignScreens({width:390},'light').length).toBe(28);
  });
  it('does not excuse a supplied value mismatch or contradictory empty currency metadata',()=>{
    const item=FINANCIAL_DESIGN_CASES[0];
    for(const change of [value=>{value.eps_growth_yy=99;},value=>{value.financial_history={symbol:'NVDA',as_of_date:date,status:'available',basis:'reported_diluted_eps',source:'Synthetic',retrieved_at:new Date(now).toISOString(),currency:'HKD',annual:[],quarterly:[]};},value=>{value.financial_history={symbol:'NVDA',as_of_date:date,status:'available',basis:'reported_diluted_eps',source:'Synthetic',retrieved_at:'2026-10-03T24:00:00Z',currency:'USD',annual:[1,2,4,8].map((eps,index)=>({end:`${2022+index}-12-31`,eps})),quarterly:[]};}]){
      const value=row('NVDA');change(value);expect(()=>publicationFinancialCaseSource(value,item,date,now)).toThrow();
    }
  });
  it('permits matching absent proofs, rejects one-sided absence, malformed envelopes and differing clocks',()=>{
    expect(()=>verifyFinancialDetailClock({symbol:'NVDA'},{symbol:'NVDA'})).not.toThrow();
    for(const [a,b] of [[{},{}],[{t:now},null],[null,{t:now}],[{t:now},{t:now+1}]])
      expect(()=>verifyFinancialDetailClock({symbol:'NVDA',financial_current:a},{symbol:'NVDA',financial_current:b})).toThrow();
    expect(()=>verifyFinancialDetailClock({symbol:'OTHER'},{symbol:'OTHER'})).toThrow();
  });
  it('does not force a missing cell or extend the exception when new AVT values invalidate an old category',()=>{
    const value=row('AVT');
    value.financial_history={symbol:'AVT',as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',
      source:'Synthetic latest-facts fixture',retrieved_at:new Date(now-3600000).toISOString(),quarterly:[],
      annual:[8.26,5.43,2.75,4.01].map((eps,index)=>({end:`${2022+index}-12-31`,eps}))};
    const original=structuredClone(value);
    expect(()=>publicationFinancialCaseSource(value,FINANCIAL_DESIGN_CASES.find(item=>item.symbol==='AVT'),date,now)).toThrow('no longer proves');
    expect(value).toEqual(original);
  });
});
