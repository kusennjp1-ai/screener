import { describe, expect, it } from 'vitest';
import { bookAnnualEpsEvidence, bookAnnualPriceExpiry, BOOK_ANNUAL_EPS_VERSION } from './bookAnnualEpsEvidence';
import { bookRuleComparisons } from './bookRuleComparisons';
import { withAuditFixture } from './testAuditFixture';
import { withFinancialProof, FINANCIAL_TEST_NOW as now, FINANCIAL_TEST_DATE as date } from './testFinancialFixture';
import { nativeAnnualFixture } from '../test/fixtures/nativeAnnual';
import { assess, entryPlan, rankCandidates, researchCsv } from './researchEngine';
import { prepareResearchBundle, researchAnnualStates, researchBundleCurrent } from './researchPreprocess';
import { researchListRow, encodeResearchIndex, decodeResearchIndex } from './researchTransport';
import { mergeFinancialDetail } from './financialCurrent';
import { researchPackets, createResearchReceiver } from './researchWorkerPackets';
import { annualEpsCoverage, filterRanked } from './researchPresentation';
import applicability from '../../contracts/financial_instrument_applicability_v1.json';

export const annualFixture = (values = [1,1.2,1.6,2], symbol = 'TEST') => withFinancialProof(withAuditFixture({
  symbol, market:'US', currency:'USD', current_price:100, adv_usd:30000000, rs_rating:90,
  financial_history:{symbol,as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'Synthetic provider',retrieved_at:new Date(now-3600000).toISOString(),annual:values.map((eps,i)=>({end:`${2022+i}-12-31`,eps})),quarterly:[]},
},date),now,date);
const report = row => bookAnnualEpsEvidence(row,{date,now});
const stages = row => {
  const compact=researchListRow(row),decoded=decodeResearchIndex(JSON.parse(JSON.stringify(encodeResearchIndex({rows:[row],as_of_date:date})))).rows[0];
  return [row,compact,decoded,mergeFinancialDetail(decoded,row,{date,asOfDate:date,now})];
};

describe('bounded source excerpt rather than whole-method approval',()=>{
  it('uses one evaluator and does not replace the stricter O’Neil annual rule',()=>{
    const row=annualFixture(),before=structuredClone(row),base=assess(row,'oneil',now),plan=entryPlan(row,null,'minervini');
    const result=report(row);
    expect(result).toMatchObject({comparisonState:'pass',annualIncreaseState:'pass',cagrState:'pass',version:BOOK_ANNUAL_EPS_VERSION,reviewStatus:'manual_required',completeMethodStatus:'not_evaluated'});
    expect(result.cagr).toBeCloseTo(25.99210499);
    expect(base.rules.find(rule=>rule.label.startsWith('A：')).state).toBe('fail');
    expect(bookRuleComparisons(row,{date,now}).cards.find(card=>card.id==='oneil-annual').state).toBe(result.comparisonState);
    expect(assess(row,'oneil',now)).toEqual(base);expect(entryPlan(row,null,'minervini')).toEqual(plan);expect(row).toEqual(before);
  });
  it.each([
    [[1,1.25,1.5625,1.953125],'pass','pass','pass'],
    [[1,1.25,1.5625,1.953125-1e-10],'fail','pass','fail'],
    [[1,2,1.5,2.5],'fail','fail','pass'],
    [[1,1.5,1.5,2],'fail','fail','pass'],
    [[1,1.5,1.2,null],'fail','fail','unknown'],
    [[1,1.5,null,2],'unknown','unknown','unknown'],
    [[0,1,2,3],'unknown','unknown','unknown'],
    [[-1,1,2,3],'unknown','unknown','unknown'],
    [[1,2,3,0],'fail','fail','unknown'],
  ])('retains AND semantics for %j',(eps,comparisonState,annualIncreaseState,cagrState)=>{
    expect(report(annualFixture(eps))).toMatchObject({comparisonState,annualIncreaseState,cagrState});
  });
  it.each(['missing_year','date_gap','duplicate','future','source','identity','scope','market','date','basis'])('never certifies invalid %s',kind=>{
    const row=annualFixture();
    if(kind==='missing_year')row.financial_history.annual.splice(1,1);
    if(kind==='date_gap')row.financial_history.annual[0].end='2020-12-31';
    if(kind==='duplicate')row.financial_history.annual[1].end=row.financial_history.annual[0].end;
    if(kind==='future')row.financial_history.annual[3].end='2026-12-31';
    if(kind==='source')row.financial_history.source='unknown';
    if(kind==='identity')row.financial_history.symbol='OTHER';
    if(kind==='scope')row.financial_identity={observed_scope:{market:'JP'}};
    if(kind==='market')row.market='';
    if(kind==='date')row.as_of_date='2026-10-01';
    if(kind==='basis')row.financial_history.basis='adjusted_eps';
    expect(report(row).comparisonState).toBe('unknown');
  });
  it.each(['audit_symbol','history_market','malformed_scope'])('rejects contradictory containing identity: %s',kind=>{
    const row=annualFixture();if(kind==='audit_symbol')row.technical_audit.symbol='OTHER';if(kind==='history_market')row.financial_history.market='JP';if(kind==='malformed_scope')row.financial_identity={observed_scope:false};
    for(const candidate of stages(row))expect(report(candidate).comparisonState).toBe('unknown');
  });
  it.each(['JP','EU','garbage','US '])('rejects a market outside the admitted US research scope: %s',market=>{
    const row=annualFixture();row.market=market;for(const candidate of stages(row))expect(report(candidate).comparisonState).toBe('unknown');
  });
  it.each(['currency','basis','unit','share_basis','unknown_field'])('keeps unexpected per-cell %s rejected through actual transport',key=>{
    const row=annualFixture();row.financial_history.annual[2][key]=key==='currency'?'EUR':'contradictory';
    for(const candidate of stages(row))expect(report(candidate).comparisonState).toBe('unknown');
  });
  it('retains reject-only metadata even if its value would disappear in JSON',()=>{
    const row=annualFixture();row.financial_history.annual[2].unit=undefined;
    for(const candidate of stages(row))expect(report(candidate).comparisonState).toBe('unknown');
  });
  it.each(['CAD','EUR','GBP'])('admits the existing native %s contract and binds its receipt',currency=>{
    const row=annualFixture();row.financial_history=nativeAnnualFixture(currency,[1,1.2,1.6,2]);
    const clock=Date.parse('2026-10-04T12:00:00Z');
    expect(bookAnnualEpsEvidence(row,{date,now:clock})).toMatchObject({comparisonState:'pass',currency,receiptSha256:'a'.repeat(64)});
    row.financial_history.annual_source.symbol='OTHER';
    expect(bookAnnualEpsEvidence(row,{date,now:clock}).comparisonState).toBe('unknown');
  });
  it('keeps annual rejection independent of a fresh quarterly-only native source',()=>{
    const row=annualFixture();row.financial_history=nativeAnnualFixture();
    row.financial_history.annual_source.observed_at=row.financial_history.retrieved_at=new Date(now-73*3600000).toISOString();
    row.financial_history.quarterly_retrieved_at=new Date(now-1000).toISOString();
    row.financial_history.quarterly=[{end:'2026-06-30',eps:2,revenue:100}];
    for(const candidate of stages(row))expect(report(candidate)).toEqual(report(row));
    expect(report(row).comparisonState).toBe('unknown');
  });
  it('keeps verified funds outside and issuer conflicts unknown',()=>{
    const fund=applicability.records[0];
    const row=annualFixture(undefined,fund.symbol);row.market=fund.market;row.company_name=fund.name;
    expect(report(row).comparisonState).toBe('not_applicable');
    row.company_name='Conflicting issuer';expect(report(row).comparisonState).toBe('unknown');
  });
});

describe('clock, transport and worker parity',()=>{
  it.each([
    ['2026-10-02','2026-10-06T04:00:00Z'],
    ['2026-03-05','2026-03-09T04:00:00Z'],
    ['2026-10-29','2026-11-02T05:00:00Z'],
    ['2026-12-24','2026-12-28T05:00:00Z'],
  ])('expires %s at age-four New York midnight %s',(day,expiry)=>expect(bookAnnualPriceExpiry(day)).toBe(Date.parse(expiry)));
  it('uses the inclusive 72-hour boundary then withdraws every pass',()=>{
    const row=annualFixture(),end=Date.parse('2026-10-05T20:00:00Z');row.financial_history.retrieved_at=new Date(end-72*3600000).toISOString();
    for(const candidate of stages(row)) {
      expect(bookAnnualEpsEvidence(candidate,{date,now:end}).comparisonState).toBe('pass');
      expect(bookAnnualEpsEvidence(candidate,{date,now:end+1}).comparisonState).toBe('unknown');
    }
    const bundle=prepareResearchBundle([{rows:[row],as_of_date:date}],date,{now:end});
    expect(bundle.next_expiry_at).toBe(end+1);expect(researchAnnualStates(bundle,end).get(bundle.rows[0])).toBe('pass');
    expect(researchAnnualStates(bundle,end+1)).toBeNull();
    expect(researchCsv(bundle.rankings.minervini,'minervini',date,end,{annualEpsOnly:true}).split('\r\n')).toHaveLength(2);
    expect(researchCsv(bundle.rankings.minervini,'minervini',date,end+1,{annualEpsOnly:true}).split('\r\n')).toHaveLength(1);
  });
  it('expires on price age even with a fresh annual capture and after DST',()=>{
    const row=annualFixture(),end=bookAnnualPriceExpiry(date);row.financial_history.retrieved_at=new Date(end-3600000).toISOString();
    const bundle=prepareResearchBundle([{rows:[row],as_of_date:date}],date,{now:end-1});
    expect(bundle.next_expiry_at).toBe(end);expect(researchBundleCurrent(bundle,end)).toBe(false);
    expect(bookAnnualEpsEvidence(row,{date,now:end-1}).comparisonState).toBe('pass');
    expect(bookAnnualEpsEvidence(row,{date,now:end}).comparisonState).toBe('unknown');
    expect(researchCsv(bundle.rankings.minervini,'minervini',date,end,{annualEpsOnly:true}).split('\r\n')).toHaveLength(1);
  });
  it('delivers a bounded, row-bound condition index and refuses obsolete ownership or generation',()=>{
    const rows=Array.from({length:451},(_,i)=>annualFixture(undefined,`S${i}`));
    const bundle=prepareResearchBundle([{rows,as_of_date:date}],date,{now,generation:'g1',evaluationEpoch:3});
    const receive=createResearchReceiver();let delivered;
    for(const packet of researchPackets(bundle)){expect(packet.states?.length||packet.items?.length||packet.rows?.length||0).toBeLessThanOrEqual(150);if(packet.kind==='complete')expect(packet).not.toHaveProperty('states');delivered=receive(structuredClone(packet));}
    expect(delivered.annual_eps.rows).toBe(delivered.rows);expect(researchAnnualStates(delivered,now).size).toBe(451);
    expect(researchAnnualStates({...delivered,rows:[...delivered.rows]},now)).toBeNull();
    expect(researchAnnualStates({...delivered,annual_eps:{...delivered.annual_eps,version:'obsolete'}},now)).toBeNull();
    expect(researchBundleCurrent(delivered,now,'g2')).toBe(false);
    expect(researchAnnualStates(delivered,now-1)).toBeNull();
  });
  it('AND-filters the already-filtered universe without changing base order, score or qualification',()=>{
    const rows=[annualFixture(),annualFixture([1,2,1.5,3],'DOWN'),annualFixture([1,null,2,3],'MISSING')];
    const bundle=prepareResearchBundle([{rows,as_of_date:date}],date,{now});
    const ranked=bundle.rankings.minervini,states=researchAnnualStates(bundle,now);
    expect(annualEpsCoverage(ranked,states)).toEqual({total:3,pass:1,fail:1,unknown:1,not_applicable:0});
    expect(filterRanked(ranked)).toEqual(ranked);
    expect(filterRanked(ranked,{annualEpsOnly:true,annualEpsStates:states}).map(item=>item.row.symbol)).toEqual(['TEST']);
    expect(annualEpsCoverage(filterRanked(ranked,{search:'DOWN'}),states)).toMatchObject({total:1,fail:1,pass:0});
    const oneil=filterRanked(bundle.rankings.oneil,{qualifiedOnly:true,annualEpsOnly:true,annualEpsStates:states});expect(oneil).toEqual([]);
    const base=rankCandidates(rows,'minervini',{now});expect(ranked.map(item=>[item.row.symbol,item.assessment.passed])).toEqual(base.map(item=>[item.row.symbol,item.assessment.passed]));
    expect(researchCsv(ranked,'minervini',date,now)).not.toContain('active_filter_id');
    const csv=researchCsv(ranked,'minervini',date,now,{annualEpsOnly:true});
    expect(csv.split('\r\n')).toHaveLength(2);expect(csv).toContain('manual_required');expect(csv).toContain('not_evaluated');expect(csv).toContain('current_at_evaluation_not_historical_publication');
  });
});
