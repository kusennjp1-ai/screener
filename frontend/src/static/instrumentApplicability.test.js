import { describe, expect, it } from 'vitest';
import registry from '../../contracts/financial_instrument_applicability_v1.json';
import { instrumentApplicability, applicabilityUniverse } from './instrumentApplicability';
import { projectFinancialRow, projectFinancialPayload, mergeFinancialDetail, currentFinancialHistory, FINANCIAL_FIELDS } from './financialCurrent';
import { assess, assessmentSummary, rankCandidates, researchCsv } from './researchEngine';
import { encodeAssessment, decodeAssessment } from './assessmentEncoding';
import { encodeResearchIndex, decodeResearchIndex } from './researchTransport';
import { filterRanked } from './researchPresentation';
import { filterStaticScanRows } from './scanClient';
import { prepareResearchBundle } from './researchPreprocess';
import { researchPackets, createResearchReceiver } from './researchWorkerPackets';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from './financialEvidencePresentation';
import { selectionSnapshot, compareSnapshots } from './candidateHistory';
import { entryReadiness } from './entryReadiness';
import { withAuditFixture } from './testAuditFixture';
import { withSyntheticFinancialProof, financialFixtureDate as date, financialFixtureNow as now } from '../test/fixtures/financialCurrent';

const rows = registry.records.map(record => withSyntheticFinancialProof(withAuditFixture({ symbol: record.symbol, company_name: record.name, market: record.market, current_price: 100, adv_usd: 30000000, rs_rating: 99, eps_growth_quarterly: 99, passes_template: true }, date)));
const history = symbol => ({symbol,as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'fixture',retrieved_at:new Date(now).toISOString(),annual:[1,2,4,8].map((eps,i)=>({eps,end:`${2022+i}-12-31`})),quarterly:[]});

describe('bounded reviewed instrument identity', () => {
  it.each(rows)('classifies exact verified $symbol with the disclosed ticker/name-only limit', row => {
    expect(instrumentApplicability(row)).toMatchObject({status:'not_applicable',identity_binding:'ticker_name_only',reason:'verified_fund_not_corporate_growth',matched_identifiers:[]});
    expect(instrumentApplicability(row).identity_match_limit).toMatch(/identifier|CUSIP/);
    expect(instrumentApplicability({...row,company_name:`  ${row.company_name.toUpperCase()}  `}).status).toBe('not_applicable');
  });
  it.each([
    {market:'JP'}, {company_name:'An unrelated corporation'}, {company_name:undefined}, {cusip:'WRONG'},
    {financial_identity:{observed_name:'A former issuer'}}, {financial_identity:{observed_identifiers:{cusip:'WRONG'}}},
    {financial_history:{company_name:'Old corporation'}}, {institutional_evidence:{cusip:'WRONG'}},
  ])('quarantines known ticker identity conflicts %j', patch => {
    const row={...rows[0],...patch};
    expect(instrumentApplicability(row)).toMatchObject({status:'quarantined',instrument_class:'unknown'});
    expect(assess(row,'minervini',now)).toMatchObject({qualified:false,method_status:'quarantined'});
    expect(projectFinancialRow(row,{now}).eps_growth_yy).toBeNull();
  });
  it('checks actual IDs, while separately recorded registry identifiers never bind receipts', () => {
    expect(instrumentApplicability({...rows[0],cusip:'74349Y704'})).toMatchObject({identity_binding:'ticker_name_and_available_identifiers',matched_identifiers:['cusip']});
    expect(instrumentApplicability({...rows[0],financial_identity:{registry_identifiers:{cusip:'74349Y704'}}}).identity_binding).toBe('ticker_name_only');
    const ethe=rows[2];
    expect(instrumentApplicability({...ethe,cik:1725210,isin:'US3896381072'})).toMatchObject({status:'not_applicable',matched_identifiers:['isin','cik']});
    expect(instrumentApplicability({...ethe,issuer_cik:'123'}).status).toBe('quarantined');
  });
  it('does not classify an ETF name or a public status claim outside the three reviewed tickers', () => {
    for (const symbol of ['OTHER','EGLE','bitu']) expect(instrumentApplicability({...rows[0],symbol,instrument_applicability:{status:'not_applicable'}})).toMatchObject({status:'unverified',instrument_class:'unknown'});
    const ordinary=withAuditFixture({...rows[0],symbol:'COMPANY',company_name:'Ordinary Company'},date);
    expect(assess(ordinary,'minervini',now).qualified).toBe(true);
    expect(assess({...ordinary,company_name:'Unverified ETF'},'minervini',now).qualified).toBe(true);
    expect(instrumentApplicability({...ordinary,quoteType:'ETF',quote_type:'FUND'}).status).toBe('unverified');
  });
});

describe('one guard across corporate financial and technical consumers', () => {
  it.each(rows)('retains $symbol prices and technical evidence but never qualifies a stock method', row => {
    for(const method of ['minervini','minervini2','oneil','ibd']) {
      const result=assess({...row,financial_history:history(row.symbol)},method,now);
      expect(result).toMatchObject({qualified:false,method_status:'not_applicable'});
      if(method.startsWith('minervini')) expect(result).toMatchObject({passed:9,total:9,failed:0,unknown:0});
      else expect(result.rules.filter(rule=>/EPS|売上|Composite/.test(rule.label)).every(rule=>rule.state==='not_applicable')).toBe(true);
      const summary=assessmentSummary(row,method,now);
      expect(decodeAssessment(encodeAssessment(summary))).toEqual(summary);
    }
    const projected=projectFinancialRow({...row,financial_history:history(row.symbol)},{now});
    expect(FINANCIAL_FIELDS.every(field=>projected[field]===null)).toBe(true);
    expect(projected).toMatchObject({current_price:100,eps_growth_quarterly:null,passes_template:null,financial_current:null,financial_history:null});
    expect(projected.technical_audit).toEqual(row.technical_audit);
    expect(projected.financial_historical.values.eps_growth_yy).toBe(30);
    expect(projected.financial_historical.financial_history).toEqual(history(row.symbol));
    expect(projectFinancialRow(JSON.parse(JSON.stringify(projected)),{now}).eps_growth_yy).toBeNull();
    expect(currentFinancialHistory(history(row.symbol),row.symbol,date,now,row).valid).toBe(false);
    expect(entryReadiness(row,date,{cap:1,state:'uptrend'},now).rules[0].state).toBe('not_applicable');
  });
  it('recomputes after identity changes and keeps conflicting archived identity quarantined', () => {
    const projected=projectFinancialRow(rows[0],{now});
    projected.company_name='Other Company';
    expect(projectFinancialRow(projected,{now}).instrument_applicability.status).toBe('quarantined');
    const conflicted=projectFinancialRow({...rows[0],financial_history:{...history('BITU'),company_name:'Former Issuer'}},{now});
    expect(projectFinancialRow(JSON.parse(JSON.stringify(conflicted)),{now}).instrument_applicability.status).toBe('quarantined');
    const transported=decodeResearchIndex(encodeResearchIndex({as_of_date:date,rows:[conflicted]})).rows[0];
    expect(transported).not.toHaveProperty('financial_historical');
    expect(projectFinancialRow(transported,{now}).instrument_applicability.status).toBe('quarantined');
    expect(mergeFinancialDetail(rows[0],{...rows[0],company_name:'Former Issuer',financial_history:history('BITU')},{now,asOfDate:date}).instrument_applicability.status).toBe('quarantined');
  });
  it.each(['financial_source_evidence', 'institutional_evidence'])('revalidates changed %s identity inside the same owned row', key => {
    const identity = { company_name: rows[0].company_name };
    const input = { ...rows[0], [key]: key === 'financial_source_evidence' ? { identity } : identity };
    const projected = projectFinancialRow(input, { now });
    expect(projectFinancialRow(projected, { now })).toBe(projected);
    identity.company_name = 'An unrelated issuer';
    const changed = projectFinancialRow(projected, { now });
    expect(changed).not.toBe(projected);
    expect(changed.instrument_applicability.status).toBe('quarantined');
    expect(changed).toEqual(projectFinancialRow(structuredClone(projected), { now }));
  });
  it('keeps list/chart/payload, filters, counts, snapshots and CSV in agreement', () => {
    const input={...rows[0],quoteType:'ETF',quote_type:'ETF'}, bundle=prepareResearchBundle([{as_of_date:date,rows}],date,{now,generation:'test'});
    expect(bundle.rows).toHaveLength(3);
    expect(bundle.instrument_applicability_universe).toMatchObject({price_liquidity_count:3,financial_applicable_count:0});
    expect(rankCandidates(rows,'minervini',{now,qualifiedOnly:true})).toEqual([]);
    expect(filterRanked(bundle.rankings.minervini,{qualifiedOnly:true})).toEqual([]);
    expect(filterRanked(bundle.rankings.minervini,{nearOnly:true})).toEqual([]);
    expect(filterStaticScanRows(rows,{}, {now})).toHaveLength(3);
    expect(filterStaticScanRows(rows,{epsGrowthYy:{min:25}}, {now})).toEqual([]);
    expect(filterStaticScanRows(rows,{passesTemplate:true}, {now})).toEqual([]);
    const chart=projectFinancialPayload({symbol:'BITU',market:'US',as_of_date:date,stock_data:input},{now});
    expect(chart.stock_data.instrument_applicability.status).toBe('not_applicable');
    expect(chart.stock_data.current_price).toBe(100);
    expect(chart.stock_data).toMatchObject({quoteType:'ETF',quote_type:'ETF'});
    expect(chart.stock_data.instrument_identity.observed_contexts.some(context=>context.quoteType==='ETF' && context.quote_type==='ETF')).toBe(true);
    const wire=decodeResearchIndex(encodeResearchIndex({as_of_date:date,rows:bundle.rows}));
    expect(wire.rows[0].instrument_applicability).toEqual(bundle.rows[0].instrument_applicability);
    const receiver=createResearchReceiver(); let delivered;
    for(const packet of researchPackets(bundle)) delivered=receiver(packet)||delivered;
    expect(delivered.instrument_applicability_universe).toEqual(bundle.instrument_applicability_universe);
    expect(delivered.rankings.minervini[0].assessment.method_status).toBe('not_applicable');
    const csv=researchCsv(bundle.rankings.minervini,'minervini',date,now);
    expect(csv).toContain('"not_applicable"');expect(csv).toContain('verified_fund_not_corporate_growth');
    expect(selectionSnapshot(rows,{as_of:date},now).records[0].methods.minervini.state).toBe('not_applicable');
  });
  it('never renders a current financial pass from fresh fund history', () => {
    const row={...rows[2],financial_history:history('ETHE')};
    const evidence=buildFinancialEvidencePresentation(row,{date,now,method:'oneil',generation:'test'});
    const view=financialEvidencePresentation({evidence,history:row.financial_history,symbol:'ETHE',date,now,method:'oneil',generation:'test'});
    expect(view.rows.every(item=>item.state==='not_applicable')).toBe(true);
    expect(view.applicabilityLabel).toContain('対象外');
    expect(view.historical.length).toBeGreaterThan(0);
  });
  it('treats applicability version changes or fund reclassification as incomparable, never a price-day dropout', () => {
    const current=selectionSnapshot(rows,{as_of:date,rule_version:'same'},now);
    expect(current.instrument_applicability_version).toBe('financial-instrument-applicability-v1');
    const previous=structuredClone(current); previous.as_of='2026-10-01';
    for(const record of previous.records) record.methods.minervini.state='pass';
    const result=compareSnapshots(current,previous);
    expect(result.minervini.counts.dropped).toBe(0);
    expect(result.minervini.items.every(item=>item.state==='incomparable' && item.reason.includes('対象範囲'))).toBe(true);
    previous.instrument_applicability_version='different-version';
    expect(compareSnapshots(current,previous).minervini.items.every(item=>item.state==='incomparable')).toBe(true);
  });
  it('separately versions 1894 liquid prices and 1891 financially applicable rows without rewriting processed history', () => {
    const ordinary=Array.from({length:1891},(_,i)=>({...rows[0],symbol:`C${i}`,company_name:`Company ${i}`}));
    const all=[...ordinary,...rows,...Array.from({length:4007},(_,i)=>({...rows[0],symbol:`LOW${i}`,current_price:1,adv_usd:1000}))];
    const historical={processed:402}, original=JSON.stringify(historical);
    const universe=applicabilityUniverse(all);
    expect(universe).toMatchObject({published_price_rows_count:5901,price_liquidity_count:1894,financial_applicable_count:1891,version:'us-corporate-financial-applicable-v1'});
    expect(universe.verified_fund_exclusions.map(item=>item.symbol)).toEqual(['BITU','SBIT','ETHE']);
    expect(universe.identity_quarantines).toEqual([]);
    expect(JSON.stringify(historical)).toBe(original);
    expect(all).toHaveLength(5901);
  });
});

it.each(rows)('keeps $symbol price identity immutable while transporting conflicting financial observations', row => {
  const original={observed_contexts:[{symbol:row.symbol,market:'US',company_name:row.company_name}]};
  for(const identity of [null,{},original]) {
    const input={...row,instrument_identity:structuredClone(identity),financial_historical:{values:{}},
      financial_identity:{observed_scope:{symbol:row.symbol,market:'US',as_of_date:date}},
      financial_history:{symbol:row.symbol,company_name:'A conflicting issuer'}};
    const projected=projectFinancialRow(input,{now});
    expect(projected.instrument_identity).toEqual(identity);
    expect(projected.instrument_applicability.status).toBe('quarantined');
    const transported=decodeResearchIndex(encodeResearchIndex({as_of_date:date,rows:[projected]})).rows[0];
    expect(transported.instrument_identity).toEqual(identity);
    expect(transported.financial_identity.observed_contexts.some(value=>value.company_name==='A conflicting issuer')).toBe(true);
    expect(instrumentApplicability(transported).status).toBe('quarantined');
    expect(projectFinancialRow(JSON.parse(JSON.stringify(transported)),{now}).instrument_applicability.status).toBe('quarantined');
    expect(assess(projected,'minervini',now).method_status).toBe(assess(transported,'minervini',now).method_status);
    expect(researchCsv(rankCandidates([transported],'minervini',{now,qualifiedOnly:false}),'minervini',date,now)).toContain('"quarantined"');
  }
  const fresh={...row,financial_identity:{observed_scope:{symbol:row.symbol,market:'US',as_of_date:date}}};
  expect(projectFinancialRow(fresh,{now})).not.toHaveProperty('instrument_identity');
  const baseline=projectFinancialRow(row,{now});
  expect(baseline.instrument_identity).toEqual(original);
  expect(projectFinancialRow(JSON.parse(JSON.stringify(baseline)),{now}).instrument_identity).toEqual(original);
});
