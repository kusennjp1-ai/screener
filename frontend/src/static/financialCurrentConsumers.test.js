import { describe, expect, it } from 'vitest';
import { withFinancialProof, FINANCIAL_TEST_DATE as date, FINANCIAL_TEST_NOW as now } from './testFinancialFixture.js';
import { withAuditFixture } from './testAuditFixture.js';
import { assess, researchCsv, RULE_SUMMARY_VERSION } from './researchEngine.js';
import { prepareResearchBundle, researchBundleCurrent } from './researchPreprocess.js';
import { encodeResearchIndex, decodeResearchIndex } from './researchTransport.js';
import { buildPortfolioPlan } from './portfolioPlan.js';
import { financialHistory } from './financialHistory.js';
import { projectFinancialRow, projectFinancialPayload, mergeFinancialDetail } from './financialCurrent.js';
import { filterStaticScanRows, sortStaticScanRows } from './scanClient.js';
import { createResearchReceiver, researchPackets } from './researchWorkerPackets.js';
import { selectionSnapshot } from './candidateHistory.js';

const annualHistory = () => ({symbol:'TEST',as_of_date:date,status:'available',basis:'reported_diluted_eps',currency:'USD',source:'yfinance',retrieved_at:new Date(now-72*3600000+1000).toISOString(),annual:[1,2,4,8].map((eps,i)=>({eps,end:`${2022+i}-12-31`})),quarterly:[{end:'2025-06-30',eps:1,revenue:100},{end:'2026-06-30',eps:2,revenue:200}]});
const row = () => withFinancialProof(withAuditFixture({symbol:'TEST',market:'US',currency:'USD',current_price:100,rs_rating:95,eps_growth_yy:30,sales_growth_yy:30,eps_rating:99,composite_rating:99,ibd_group_rank:1,financial_history:annualHistory()},date),now,date);

describe('one current evaluation across consumers',()=>{
  it('keeps 9 technical rules independent and required financial ratings unknown',()=>{
    const input=row(), result=prepareResearchBundle([{as_of_date:date,rows:[input]}],date,{now,generation:'one',evaluationEpoch:1});
    expect(result.rankings.minervini[0].assessment).toMatchObject({qualified:true,total:9,unknown:0});
    expect(result.rankings.ibd[0].assessment).toMatchObject({qualified:false,unknown:2});
    expect(result.prepared.candidates).toEqual([]);
    expect(buildPortfolioPlan(result.rows,date,100000,now,{...result.prepared,candidates:[input]}).positions).toEqual([]);
    expect(input.eps_rating).toBe(99);
  });
  it('rebuilds annual assessment, ranking, CSV, counts and portfolio at the same history expiry',()=>{
    const input=row(), before=prepareResearchBundle([{as_of_date:date,rows:[input]}],date,{now,generation:'one',evaluationEpoch:2});
    expect(before.next_expiry_at).toBe(now+1001);
    expect(researchBundleCurrent(before,now+1000,'one')).toBe(true);
    expect(researchBundleCurrent(before,now+1001,'one')).toBe(false);
    const after=prepareResearchBundle([{as_of_date:date,rows:before.rows}],date,{now:now+1001,generation:'one',evaluationEpoch:3});
    expect(assess(before.rows[0],'oneil',now).rules[2].state).toBe('pass');
    expect(assess(after.rows[0],'oneil',now+1001).rules[2].state).toBe('unknown');
    expect(after.rankings.ibd[0].assessment.unknown).toBe(before.rankings.ibd[0].assessment.unknown+1);
    expect(researchCsv(after.rankings.oneil,'oneil',date,now+1001)).toContain('直近3年の各年 EPS 成長率');
    expect(after.prepared.candidates).toEqual([]);
    expect(after.rows[0].financial_history).toEqual(input.financial_history);
  });
  it('uses exact source expiry consistently in filter, sort, detail, CSV and assessment',()=>{
    const input=row(), until=now+100;
    input.financial_current.p['1'][5]=until;
    const before=prepareResearchBundle([{as_of_date:date,rows:[input]}],date,{now:until});
    const after=prepareResearchBundle([{as_of_date:date,rows:before.rows}],date,{now:until+1});
    expect(filterStaticScanRows(before.rows,{epsGrowthYy:{min:25}},{now:until})).toHaveLength(1);
    expect(filterStaticScanRows(before.rows,{epsGrowthYy:{min:25}},{now:until+1})).toEqual([]);
    expect(sortStaticScanRows(before.rows,'eps_growth_yy','desc',{now:until+1})[0].eps_growth_yy).toBeNull();
    expect(mergeFinancialDetail(before.rows[0],{...input,as_of_date:date},{asOfDate:date,now:until+1}).eps_growth_yy).toBeNull();
    expect(assess(after.rows[0],'oneil',until+1).rules[0].state).toBe('unknown');
    expect(researchCsv(before.rankings.oneil,'oneil',date,until+1)).toBe(researchCsv(after.rankings.oneil,'oneil',date,until+1));
  });
  it('does not substitute fresh reported quarterly history for a different legacy growth basis',()=>{
    const input={...row(),financial_current:undefined};
    expect(financialHistory(input.financial_history,input.symbol,date,now).epsYoY).toBe(100);
    const result=assess(input,'oneil',now);
    expect(result.rules[0].state).toBe('unknown');
    expect(result.rules[2].state).toBe('pass');
    expect(projectFinancialRow(input,{now}).eps_growth_yy).toBeNull();
  });
  it.each(['missing-source','placeholder-source','missing-timezone','invalid-calendar'])('keeps annual rules unknown for %s',kind=>{
    const input=row();
    if(kind==='missing-source') delete input.financial_history.source;
    if(kind==='placeholder-source') input.financial_history.source='unknown';
    if(kind==='missing-timezone') input.financial_history.retrieved_at=new Date(now).toISOString().replace('Z','');
    if(kind==='invalid-calendar') input.financial_history.retrieved_at='2026-09-31T16:35:00Z';
    expect(assess(input,'oneil',now).rules[2].state).toBe('unknown');
    expect(assess(input,'ibd',now).rules[7].state).toBe('unknown');
  });
  it('binds missing row context from its containing asset and retains it through filtering',()=>{
    const input=withFinancialProof({eps_growth_yy:0});delete input.market;delete input.as_of_date;
    const projected=projectFinancialRow(input,{now,asOfDate:date,market:'US'});
    expect(projected).toMatchObject({as_of_date:date,market:'US',eps_growth_yy:0});
    expect(filterStaticScanRows([projected],{epsGrowthYy:{min:0}},{now})).toHaveLength(1);
    const fundamentals={...input};delete fundamentals.symbol;
    const chart=projectFinancialPayload({symbol:'TEST',as_of_date:date,stock_data:{symbol:'TEST',market:'US'},fundamentals},{now});
    expect(chart.fundamentals).toMatchObject({symbol:'TEST',market:'US',as_of_date:date,eps_growth_yy:0});
    expect(input).not.toHaveProperty('market');expect(fundamentals).not.toHaveProperty('symbol');
  });
  it('projects a missing legacy alias from the proven canonical zero without treating false as zero',()=>{
    const input=withFinancialProof({eps_growth_qq:0,eps_growth_quarterly:null});
    expect(projectFinancialRow(input,{now})).toMatchObject({eps_growth_qq:0,eps_growth_quarterly:0});
    expect(projectFinancialRow({...input,eps_growth_quarterly:false},{now}).eps_growth_qq).toBeNull();
  });
  it('labels a later-acquired fact as current at evaluation and never backdates its availability',()=>{
    const input=row();
    expect(input.financial_current.p['1'][4]).toBeGreaterThan(Date.parse(`${date}T23:59:59Z`));
    expect(assess(input,'oneil',now).rules[0].state).toBe('pass');
    expect(assess(input,'oneil',Date.parse(`${date}T20:00:00Z`)).rules[0].state).toBe('unknown');
    const csv=researchCsv([{row:input}],'oneil',date,now);
    expect(csv).toContain('financial_evaluated_at');expect(csv).toContain(new Date(now).toISOString());
    expect(csv).toContain('current_at_evaluation_not_historical_publication');
    const historical={schema_version:1,as_of:date,records:[{symbol:'TEST',methods:{oneil:{state:'pass'}}}]};
    const original=structuredClone(historical);
    selectionSnapshot([input],{as_of:date,financial_evaluated_at:now,financial_semantics:'current_at_evaluation_not_historical_publication'},now);
    expect(historical).toEqual(original);
  });
  it('ignores stale same-version summary/order claims and carries identity through packets',()=>{
    const input=row();input.method_summary={version:RULE_SUMMARY_VERSION,ibd:[10,0,0,10,0]};
    const bundle=prepareResearchBundle([{as_of_date:date,rows:[input],orders:{ibd:[99]}}],date,{now,generation:'content-one',evaluationEpoch:9});
    expect(bundle.rankings.ibd[0].assessment.qualified).toBe(false);
    const receive=createResearchReceiver();let delivered;
    for(const packet of researchPackets(bundle)) delivered=receive(structuredClone(packet)) || delivered;
    expect(delivered).toMatchObject({generation:'content-one',evaluation_epoch:9,evaluated_at:now,next_expiry_at:bundle.next_expiry_at,assessment_version:RULE_SUMMARY_VERSION});
    expect(delivered.rankings.ibd[0].row).toBe(delivered.rows[0]);
    expect(researchBundleCurrent(delivered,now,'content-two')).toBe(false);
  });
  it('round-trips compact proof columns exactly and rejects damaged tuple encodings',()=>{
    const input=row();const index=encodeResearchIndex({as_of_date:date,rows:[input]},{});
    expect(index.financial_proof_encoding).toBe('tuple-columns-v1');
    const decoded=decodeResearchIndex(JSON.parse(JSON.stringify(index))).rows[0];
    expect(decoded.financial_current).toEqual(input.financial_current);
    expect(assess(decoded,'oneil',now)).toEqual(assess(input,'oneil',now));
    expect(()=>decodeResearchIndex({...index,financial_proof_encoding:'unknown'})).toThrow('Unsupported financial proof encoding');
  });
  it('never upgrades an invalid object-shaped proof when another row enables tuple columns',()=>{
    const valid=withFinancialProof({symbol:'VALID',eps_growth_yy:30});
    const malformed=withFinancialProof({symbol:'BAD',eps_growth_yy:30});
    malformed.financial_current.p['1']=Object.fromEntries(malformed.financial_current.p['1'].map((value,index)=>[String(index),value]));
    const decoded=decodeResearchIndex(encodeResearchIndex({as_of_date:date,rows:[valid,malformed]}));
    expect(projectFinancialRow(decoded.rows[0],{now}).eps_growth_yy).toBe(30);
    expect(projectFinancialRow(decoded.rows[1],{now}).eps_growth_yy).toBeNull();
    expect(malformed.financial_current).not.toHaveProperty('invalid_transport_proof');
  });
});

it('round-trips mixed old/new proof versions without upgrading v1 or loss improvement', () => {
  const fresh=withFinancialProof({symbol:'FRESH',eps_growth_yy:50});
  const loss=withFinancialProof({symbol:'LOSS',eps_growth_yy:50});
  loss.financial_current.r=loss.financial_current.r.slice(0,1)+'f'+loss.financial_current.r.slice(2);
  loss.financial_current.p[1][6]='l';
  const old=withFinancialProof({symbol:'OLD',eps_growth_yy:50});
  old.financial_current.v=1;old.financial_current.p[1]=old.financial_current.p[1].slice(0,6);
  const rows=[fresh,loss,old];
  const decoded=decodeResearchIndex(JSON.parse(JSON.stringify(encodeResearchIndex({as_of_date:date,rows})))).rows;
  decoded.forEach((value,index)=>expect(value.financial_current).toEqual(rows[index].financial_current));
  expect(decoded.map(row=>projectFinancialRow(row,{now}).eps_growth_yy)).toEqual([50,null,null]);
  expect(assess(decoded[1],'oneil',now).rules[0].state).toBe('unknown');
  expect(filterStaticScanRows(decoded,{epsGrowthYy:{min:25}},{now}).map(row=>row.symbol)).toEqual(['FRESH']);
});

it('keeps a fresh loss comparison as sourced reference through projected export, wire decode and detail merge', () => {
  const raw=withFinancialProof({eps_growth_yy:50});
  raw.financial_current.r=raw.financial_current.r.slice(0,1)+'f'+raw.financial_current.r.slice(2);
  raw.financial_current.p[1][6]='l';
  const projected=projectFinancialRow(raw,{now});
  expect(projected.eps_growth_yy).toBeNull();
  const wire=JSON.stringify(encodeResearchIndex({as_of_date:date,rows:[projected]}));
  const decoded=decodeResearchIndex(JSON.parse(wire)).rows[0];
  expect(decoded.eps_growth_yy).toBeNull();
  expect(decoded).not.toHaveProperty('financial_current_state');
  expect(decoded).not.toHaveProperty('financial_historical');
  const current=projectFinancialRow(decoded,{now:now+1});
  const merged=mergeFinancialDetail(current,JSON.parse(JSON.stringify(projected)),{now:now+1,asOfDate:date});
  for (const row of [projected,current,merged]) {
    expect(row.financial_current_state.fields.eps_growth_yy).toMatchObject({value:null,availability:'unknown',reference_value:50,reference_availability:'current',comparison:'loss_narrowing',source_validated:true,ordinary_growth_eligible:false});
    expect(assess(row,'oneil',now+1).rules[0].state).toBe('unknown');
    expect(filterStaticScanRows([row],{epsGrowthYy:{min:25}},{now:now+1})).toEqual([]);
  }
});
