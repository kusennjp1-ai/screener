import { describe, expect, it } from 'vitest';
import { nativeAnnualFixture } from '../test/fixtures/nativeAnnual.js';
import { currentFinancialHistory, mergeFinancialDetail } from './financialCurrent.js';
import { assess, assessmentSummary, entryChecks, rankCandidates, researchCsv, threeStateAnd, RULE_SUMMARY_VERSION } from './researchEngine.js';
import { encodeResearchIndex, decodeResearchIndex, researchListRow } from './researchTransport.js';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from './financialEvidencePresentation.js';
import { withAuditFixture } from './testAuditFixture.js';
import { withFinancialProof } from './testFinancialFixture.js';
import { filterRanked } from './researchPresentation.js';
import { filterStaticScanRows } from './scanClient.js';
import { entryReadiness } from './entryReadiness.js';
import { selectionSnapshot, compareSnapshots } from './candidateHistory.js';

const date = '2026-10-02', now = Date.parse('2026-10-04T12:00:00Z');
function history(kind, values) {
  const data = nativeAnnualFixture(kind === 'legacy' ? 'USD' : kind, values);
  if (kind === 'legacy') for (const key of ['schema_version','annual_currency','quarterly_currency','quarterly_retrieved_at','annual_source']) delete data[key];
  return data;
}
const row = data => withFinancialProof(withAuditFixture({ symbol:'TEST', market:'US', currency:'USD', current_price:100, adv_usd:30000000,
  rs_rating:95, eps_growth_yy:30, sales_growth_yy:30, financial_history:data, market_above_50dma:true, market_above_200dma:true }, date), now, date);
const annualRule = (input, method='oneil', time=now) => assess(input, method, time).rules.find(rule => rule.label.includes('3年'));
const view = input => financialEvidencePresentation({ evidence:buildFinancialEvidencePresentation(input,{method:'oneil',date,generation:'test',now}),
  history:input.financial_history, symbol:input.symbol,date,generation:'test',method:'oneil',now }).rows.find(item=>item.id==='annual_eps_growth_3y');

it.each([
  [[false,null],false], [[null,false],false], [[true,null],null], [[null,true],null], [[true,true],true],
  [[0,true],null], [['false',true],null], [[undefined,false],false], [[null,null],null],
])('strict three-state AND %j is %j', (values, expected) => expect(threeStateAnd(values)).toBe(expected));

describe.each(['legacy','USD','CAD','EUR','GBP','CNY'])('%s annual comparison contract', kind => {
  it.each([
    ['fail plus missing', [8,4,2,null], 'fail', null, ['fail','fail','unknown']],
    ['pass plus missing', [1,2,4,null], 'unknown', null, ['pass','pass','unknown']],
    ['only nonpositive', [-8,-4,-2,-1], 'unknown', true, ['unknown','unknown','unknown']],
    ['nonpositive plus proven failure', [-1,4,2,8], 'fail', true, ['unknown','fail','pass']],
    ['all pass', [1,2,4,8], 'pass', true, ['pass','pass','pass']],
    ['latest zero', [1,2,4,0], 'fail', true, ['pass','pass','fail']],
    ['zero base with a known failure', [1,0,2,4], 'fail', true, ['fail','unknown','pass']],
  ])('%s preserves completeness and source cells', (_label, values, state, complete, states) => {
    const data=history(kind,values), original=structuredClone(data), input=row(data);
    const report=currentFinancialHistory(data,'TEST',date,now,input), rule=annualRule(input);
    expect(rule.state).toBe(state); expect(rule.annualComplete).toBe(complete);
    expect(rule.comparisons.map(pair=>pair.state)).toEqual(states);
    expect(report.annualComplete).toBe(complete);
    expect(report.annualGrowth===null).toBe(states.includes('unknown'));
    expect(annualRule(input,'ibd').state).toBe(complete?'pass':'unknown');
    expect(view(input).state).toBe(state);
    expect(data).toEqual(original);
    if (states.includes('unknown')) expect(rule.value).toBeNull();
  });
  it.each([
    ['wrong issuer', d=>{d.symbol='OTHER';}], ['wrong date', d=>{d.as_of_date='2026-10-01';}],
    ['wrong basis', d=>{d.basis='basic_eps';}], ['missing source', d=>{d.source=null;}],
    ['placeholder source', d=>{d.source='unknown';}], ['malformed source', d=>{d.source={};}],
    ['malformed clock', d=>{d.retrieved_at='2026-10-04';}], ['expired clock', d=>{d.retrieved_at='2026-09-01T00:00:00Z';}],
    ['missing year', d=>{d.annual.splice(1,1);}], ['skipped year', d=>{d.annual[0].end='2020-12-31';}],
    ['future endpoint', d=>{d.annual[3].end='2026-12-31';}], ['invalid endpoint', d=>{d.annual[1].end='2023-02-30';}],
    ['duplicate endpoint', d=>{d.annual[1].end=d.annual[0].end;}],
    ['expired fiscal window', d=>{d.annual.forEach((p,i)=>{p.end=`${2019+i}-12-31`;});}],
    ['wrong currency', d=>{d.currency='XYZ';}], ['conflicting annual currency', d=>{d.annual_currency='JPY';}],
    ['per-point currency', d=>{d.annual[0].currency='JPY';}], ['per-point source', d=>{d.annual[0].source='Other issuer';}],
  ])('never rescues a partial failure from %s', (_label, change) => {
    const data=history(kind,[8,4,2,null]);change(data);
    const input=row(data), rule=annualRule(input);
    expect(rule.state).toBe('unknown');expect(rule.comparisons).toEqual([]);
    expect(view(input).state).toBe('unknown');
  });
  it('rejects stale and future evaluation clocks without using apparent declines', () => {
    const input=row(history(kind,[8,4,2,null]));
    for(const time of [NaN, now+73*3600000, now-24*3600000]) expect(annualRule(input,'oneil',time).state).toBe('unknown');
  });
});

it('does not treat arithmetic overflow as a comparable growth rate', () => {
  const input=row(history('CAD',[Number.MIN_VALUE,1,2,null]));
  expect(annualRule(input).state).toBe('unknown');
  expect(annualRule(input).comparisons[0]).toMatchObject({growth:null,reason:'invalid_annual_growth',state:'unknown'});
});

it('keeps malformed native receipt and legacy annual_source claims unknown', () => {
  for(const kind of ['legacy','CAD']) {
    const data=history(kind,[8,4,2,null]);
    data.annual_source={...(data.annual_source||{}), receipt_sha256:null};
    expect(annualRule(row(data)).state).toBe('unknown');
  }
});

it('shares partial failures and unresolved years across detail, transport, summaries, CSV, filters and ranking', () => {
  const input=row(history('legacy',[8,4,2,null]));
  const decoded=decodeResearchIndex(encodeResearchIndex({as_of_date:date,rows:[input]})).rows[0];
  const detail=mergeFinancialDetail(decoded,input,{now,asOfDate:date});
  for(const candidate of [input,researchListRow(input),decoded,detail]) {
    const rule=annualRule(candidate), assessment=assess(candidate,'oneil',now), ranked=rankCandidates([candidate],'oneil',{now});
    expect(rule).toEqual(annualRule(input));
    expect(assessmentSummary(candidate,'oneil',now)).toEqual(ranked[0].assessment);
    expect(assessment.failed).toBeGreaterThan(0);expect(assessment.qualified).toBe(false);
    expect(filterRanked(ranked,{qualifiedOnly:true})).toEqual([]);
    expect(filterStaticScanRows([candidate],{epsGrowthYy:{min:25}},{now}).map(value=>value.symbol)).toEqual(['TEST']);
    const csv=researchCsv(ranked,'oneil',date,now);
    expect(csv).toContain('年次EPS履歴：不完全');expect(csv).toContain('2025-12-31: EPS欠損');expect(csv).toContain('−50.00%（未達）');
    expect(view(candidate)).toMatchObject({state:'fail',availability:'incomplete',availabilityReason:'incomplete_annual_history'});
    expect(view(candidate).actual).toContain('EPS欠損');expect(view(candidate).actual).toContain('−50.00%');
  }
  const older=selectionSnapshot([input],{as_of:'2026-10-01',rule_version:'prior-conjunction'},now);
  const current=selectionSnapshot([input],{as_of:date,rule_version:RULE_SUMMARY_VERSION},now);
  expect(compareSnapshots(current,older).oneil.items[0]).toMatchObject({state:'incomparable',changes:[]});
});

it.each([[false,null,'fail'],[null,false,'fail'],[true,null,'unknown'],['false',true,'unknown'],[true,true,'pass']])('combines market booleans %j/%j', (a,b,state)=> {
  const input=row(history('legacy',[1,2,4,8]));input.market_above_50dma=a;input.market_above_200dma=b;
  expect(assess(input,'oneil',now).rules[7].state).toBe(state);
});

it.each([['sma150',null,'sma200',110],['sma150',110,'sma200',null],['sma150',null,'sma200',80]])('evaluates audited moving-average pairs independently: %s', (a,av,b,bv) => {
  const input=row(history('legacy',[1,2,4,8]));Object.assign(input.technical_audit.values,{[a]:av,[b]:bv});
  expect(assess(input,'minervini',now).rules[0].state).toBe(av===110||bv===110?'fail':'unknown');
  expect(assess(input,'minervini',now).rules[3].state).toBe(av===110||bv===110?'fail':'unknown');
  input.technical_audit.symbol='OTHER';
  expect(assess(input,'minervini',now).rules[0].state).toBe('unknown');
});

it('preserves valid volume or up-day failures while another audited subcondition is unknown', () => {
  for(const values of [{change:null,volumeRatio:1},{change:-1,volumeRatio:null},{change:-1,volumeRatio:-5},{change:1,volumeRatio:null}]) {
    const input=row(history('legacy',[1,2,4,8]));Object.assign(input.technical_audit.values,values);
    const state=values.change===1?'unknown':'fail';
    if (values.volumeRatio===-5) expect(assess(input,'oneil',now).rules[4].value).toBeNull();
    expect(assess(input,'oneil',now).rules[4].state).toBe(state);expect(entryChecks(input)[1].state).toBe(state);
    expect(entryReadiness(input,date,null,now).rules.find(rule=>rule.id==='volume').state).toBe(state);
    expect(entryReadiness(input,'2026-10-01',null,now).rules.find(rule=>rule.id==='volume').state).toBe('unknown');
    input.technical_audit.errors=['bad source'];
    expect(assess(input,'oneil',now).rules[4].state).toBe('unknown');
  }
});

it('rejects a stale or forged pass bound to a partial annual failure with a null value', () => {
 const input=row(history('CAD',[8,4,2,null]));
 const evidence=buildFinancialEvidencePresentation(input,{method:'oneil',date,generation:'test',now});
 evidence.metrics.annual_eps_growth_3y.condition.state='pass';
 const annual=financialEvidencePresentation({evidence,history:input.financial_history,symbol:'TEST',date,generation:'test',method:'oneil',now}).rows.find(item=>item.id==='annual_eps_growth_3y');
 expect(annual).toMatchObject({state:'unknown',reason:'value_mismatch',availability:'incomplete'});
});
