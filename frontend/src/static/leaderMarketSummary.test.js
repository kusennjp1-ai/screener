import { describe, expect, it } from 'vitest';
import { leaderMarketSummary } from './leaderMarketSummary';
import { withAuditFixture } from './testAuditFixture';
import { assessmentSummary, entryPosition } from './researchEngine';
import { entryReadiness } from './entryReadiness';
import { BOOK_MARKET_VERSION } from './bookMarketEvidence';
const date='2026-09-23', now=Date.parse('2026-09-24T00:00:00Z');
const row=(symbol,overrides={})=>withAuditFixture({symbol,market:'US',currency:'USD',as_of_date:date,current_price:100,adv_usd:3e7,rs_rating:90,se_pivot_price:100,gics_sector:'Technology',...overrides},date);
const run=(rows,options={})=>leaderMarketSummary({rows,date,generation:'source-generation',now,...options});
describe('display-only market aggregation',()=>{
  it('uses the existing qualified and position-only rules, not seven daily readiness',()=>{
    const rows=[row('ZONE'),row('WAIT',{se_pivot_price:101}),row('HIGH',{se_pivot_price:94}),row('MISSING',{se_pivot_price:null})];
    const before=structuredClone(rows),summary=run(rows);
    const selected=rows.filter(r=>assessmentSummary(r,'minervini',now).qualified);
    expect(selected).toHaveLength(4);
    expect(summary.totals.selected).toBe(selected.length);
    expect(summary.totals.buyPositions).toBe(selected.filter(r=>entryPosition(r,null,'minervini').state==='買いゾーン内').length);
    expect(summary.totals).toMatchObject({buyPositions:1,positionUnknown:1});
    expect(entryReadiness(rows[0],date,summary.market,now).ready).toBe(false);
    expect(rows).toEqual(before);
  });
  it('retains existing method-specific upper bounds and inclusive pivot',()=>{
    const rows=[row('LOW'),row('UP5',{current_price:105}),row('UP3',{current_price:103})];
    expect(run(rows).totals.buyPositions).toBe(3);
    expect(run(rows,{method:'minervini2'}).totals.buyPositions).toBe(2);
  });
  it('does not admit cash acquisitions or low-range positions',()=>{
    const s=run([row('CASH',{corporate_action:{cash_acquisition:true}}),row('LOW',{price_activity:{lowRange:true}})]);
    expect(s.totals.buyPositions).toBe(0);
  });
  it('computes above-50 percentage among dated observations and exposes missing coverage',()=>{
    const rows=[row('ABOVE'),row('EQUAL'),row('BELOW'),row('UNKNOWN'),row('OLD')];
    rows[1].technical_audit.values.sma50=100;rows[2].technical_audit.values.sma50=110;
    rows[3].technical_audit.values.sma50=null;rows[4].technical_audit.as_of_date='2026-09-22';
    expect(run(rows).totals).toMatchObject({universe:5,verified:3,above50:1,above50Percent:1/3*100,unverified:2,coveragePercent:60});
  });
  it('keeps empty and all-unknown denominators absent, not zero percent',()=>{
    expect(run([]).totals).toMatchObject({universe:0,above50Percent:null,coveragePercent:null});
    const r=row('NONE');r.technical_audit=null;
    expect(run([r]).totals).toMatchObject({universe:1,verified:0,above50Percent:null,selectionUnknown:1,buyPositions:0});
  });
  it('rejects every duplicate copy, mismatched row dates and malformed records',()=>{
    const a=row('DUP');
    const result=run([a,structuredClone(a),row('WRONG',{as_of_date:'2026-09-22'}),null,{},row('OK')]);
    expect(result.excluded).toEqual({duplicateSymbols:1,mismatchedRows:1,invalidRows:2});
    expect(result.totals.universe).toBe(1);expect(result.totals.buyPositions).toBe(1);
  });
  it('uses the existing liquidity population and retains unknown sector',()=>{
    const rows=[row('TECH'),row('F',{gics_sector:'Financial Services'}),row('U',{gics_sector:'unexpected'}),row('SMALL',{adv_usd:1}),row('JP',{market:'JP'})];
    const result=run(rows);
    expect(result.totals.universe).toBe(3);
    expect(result.sectors.find(s=>s.key==='Financial').buyPositions).toBe(1);
    expect(result.sectors.find(s=>s.key==='Unknown').buyPositions).toBe(1);
    for(const key of ['universe','selected','buyPositions','verified','above50','selectionUnknown'])expect(result.sectors.reduce((sum,g)=>sum+g[key],0)).toBe(result.totals[key]);
  });
  it('keeps known financial non-applicability separate from failed or unknown selection',()=>{
    const result=run([row('BITU',{company_name:'ProShares Ultra Bitcoin ETF'})]);
    expect(result.totals).toMatchObject({universe:1,notApplicable:1,selectionUnknown:0,selected:0,buyPositions:0,verified:1});
  });
  it.each([0,-1,Infinity,NaN,'90'])('rejects unusable SMA50 %s from percentage observations',sma50=>{
    const r=row('BAD');r.technical_audit.values.sma50=sma50;
    expect(run([r]).totals).toMatchObject({verified:0,above50:0,above50Percent:null});
  });
  it.each([{date:'2026-02-30'},{generation:null},{now:NaN},{method:'new-rule'},{rows:null}])('withholds unresolved inputs %j',options=>{
    expect(run([row('A')],options)).toMatchObject({available:false,totals:null,sectors:[]});
  });
  it('never converts proxy histories or row distribution counts into requested market evidence',()=>{
    const result=run([row('A',{market_distribution_days:3})],{breadthEvidence:{version:BOOK_MARKET_VERSION,as_of_date:date,series:[{date,setupProxyCount:90,breakoutProxyCount:5}]}});
    expect(result.history).toMatchObject({available:false,points:[]});expect(result.distribution.available).toBe(false);
    expect(result.newHighLow).toBeNull();
  });
  it('discloses the different observed universe and approximate basis of highs/lows',()=>{
    const breadthEvidence={version:BOOK_MARKET_VERSION,as_of_date:date,latest:{date,newHighs:122,newLows:266,coverage:4420,expectedUniverseSize:5966}};
    const result=run([row('A')],{breadthEvidence});
    expect(result.newHighLow).toMatchObject({newHighs:122,newLows:266,coverage:4420,universe:5966,approximate:true});
    expect(result.totals.universe).toBe(1);
    for(const latest of [{...breadthEvidence.latest,date:'2026-09-22'},{...breadthEvidence.latest,newHighs:null},{...breadthEvidence.latest,newLows:9999}])expect(run([row('A')],{breadthEvidence:{...breadthEvidence,latest}}).newHighLow).toBeNull();
  });
});
