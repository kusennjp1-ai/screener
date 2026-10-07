import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {planRetainedPriceRecovery,compileRetainedPriceRecovery,recoveryDigest,RECOVERY_FINANCIAL_FIELDS} from './retained-price-recovery.mjs';
import {priceObservationDigest,comparePriceObservations} from './price-observations.mjs';
import {auditValues,rankVerifiedUniverse} from '../../frontend/src/static/qualificationAudit.js';
import {requireChartIdentity} from '../../frontend/src/static/chartPayloadIdentity.js';
import {entryReadiness} from '../../frontend/src/static/entryReadiness.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const key=s=>JSON.stringify(['US','chart',s]);
function fixture() {
  const before='2026-10-02',after='2026-10-05',names=[...Array.from({length:10},(_,i)=>`GOOD${i}`),'LOST'];
  const row=(symbol,date)=>({symbol,market:'US',currency:'USD',exchange:'XNAS',company_name:`Issuer ${symbol}`,as_of_date:date,
    current_price:20,adv_usd:30_000_000,chart_path:`charts/${symbol}.json`,research_detail_path:`details/${symbol}.json`,
    se_pivot_price:19,vcp_pivot:19,se_setup_ready:true,passes_template:true,rs_rating:90,
    technical_audit:{version:'ohlcv-v1',symbol,as_of_date:date,valid:true,errors:[],bars:300,values:{close:20,momentum:1}},
    financial_history:{retrieved_at:'2026-10-04T12:00:00Z',source:'owned original source'},
    method_summary:{qualified:true},brand_new_scanner_decision:'must not leak',setup_engine:{candidate:true},risk_plan:{buy:20}});
  const priorRows=names.map(s=>row(s,before)),candidateRows=names.map(s=>row(s,after));
  Object.assign(candidateRows.at(-1),{current_price:null,technical_audit:{version:'ohlcv-v1',symbol:'LOST',as_of_date:after,valid:false,errors:['missing'],values:{}},chart_path:null});
  const actual=Object.fromEntries(names.map(s=>[key(s),before]));
  const known={...actual,[key('LEDGER_ONLY')]:'2026-09-01'};
  const observed=Object.fromEntries(names.slice(0,-1).map(s=>[key(s),after]));
  const priorPublication={schema:1,price_observations:actual,known_price_dates:known,
    verification_universe:{as_of_date:before,required_symbols:names,minimum_target:.9}};
  const manifest_json=JSON.stringify({markets:{US:{as_of_date:after}}});
  const candidateSource={manifest_json,manifest_sha256:createHash('sha256').update(manifest_json).digest('hex'),
    price_observations:observed,price_observations_sha256:priceObservationDigest(observed)};
  const priorChartIndex={symbols:names.map(s=>({symbol:s,path:`charts/${s}.json`}))};
  const original=priorRows.at(-1);
  const priorCharts={LOST:{schema_version:'chart-v1',symbol:'LOST',market:'US',as_of_date:before,generated_at:'2026-10-04T13:00:00Z',period:'2y',
    bars:[{date:before,open:19,high:21,low:18,close:20,volume:3_000_000}],stock_data:clone(original),
    rs_line:[{time:before,value:1}],signal:{buy:true},brand_new_overlay:'must not leak'}};
  const priorDetails={LOST:clone(original)};
  return {priorPublication,priorRows,candidateRows,candidateSource,priorChartIndex,priorCharts,priorDetails};
}

test('retains original historical graph atomically and keeps new-current row unknown',()=>{
  const input=fixture(),unchanged=clone(input),plan=planRetainedPriceRecovery(input),result=compileRetainedPriceRecovery({...input,plan});
  assert.deepEqual(input,unchanged,'compiler must not edit input evidence');
  assert.equal(plan.retained.length,1);assert.deepEqual(plan.ledger_only_absences,[key('LEDGER_ONLY')]);
  assert.equal(result.publication_authority,false);assert.equal(result.requires_full_rebuild,true);assert.equal(result.requires_financial_carry,true);
  const patch=result.patches[0],row=result.rows.at(-1);
  assert.deepEqual(patch.snapshot.prior_row,input.priorRows.at(-1));assert.deepEqual(patch.snapshot.prior_chart,input.priorCharts.LOST);
  assert.deepEqual(patch.snapshot.prior_detail,input.priorDetails.LOST);
  assert.deepEqual(patch.chart.bars,input.priorCharts.LOST.bars);assert.equal(patch.bars_sha256,recoveryDigest(input.priorCharts.LOST.bars));
  assert.equal(patch.chart.as_of_date,'2026-10-05');assert.equal(patch.chart.generated_at,'2026-10-04T13:00:00Z');
  assert.equal(patch.chart.retained_price_history.original_as_of_date,'2026-10-02');
  assert.equal(patch.snapshot.prior_chart.as_of_date,'2026-10-02');
  assert.equal(row.as_of_date,'2026-10-05');assert.equal(row.current_price,null);assert.equal(row.adv_usd,null);
  assert.equal(row.rs_rating,null);assert.equal(row.se_pivot_price,null);assert.equal(row.se_setup_ready,false);assert.equal(row.technical_audit.valid,false);
  for(const field of ['method_summary','brand_new_scanner_decision','setup_engine','risk_plan'])assert(!Object.hasOwn(row,field));
  assert(!Object.hasOwn(patch.chart,'brand_new_overlay'));assert.equal(patch.chart.signal,null);
  assert.deepEqual(patch.chart.stock_data,row);assert.deepEqual(patch.detail,row);
  assert.deepEqual(row.financial_history,input.candidateRows.at(-1).financial_history);
  assert(!Object.hasOwn(row,'financial_current'),'absent financial proof stays absent');
  assert.equal(row.financial_history.retrieved_at,'2026-10-04T12:00:00Z');
  assert.deepEqual(result.rows.slice(0,-1),input.candidateRows.slice(0,-1));
  assert.deepEqual(result.coverage,{total:11,verified:10,minimum_target:.9});
});

test('approved chart/readiness/RS consumers never treat restored old history as current',()=>{
  const input=fixture(),plan=planRetainedPriceRecovery(input),result=compileRetainedPriceRecovery({...input,plan}),patch=result.patches[0];
  assert.throws(()=>requireChartIdentity(patch.chart,'LOST','2026-10-05'),/final session mismatch/);
  assert.deepEqual(auditValues(patch.row),{});
  assert.equal(rankVerifiedUniverse(result.rows).at(-1).rs_rating,null);
  const ready=entryReadiness(patch.row,'2026-10-05',{state:'known',cap:1},Date.parse('2026-10-06T22:00:00Z'));
  assert.equal(ready.ready,false);assert.equal(ready.rules.find(x=>x.id==='price').state,'unknown');
  assert.notEqual(ready.rules.find(x=>x.id==='date').state,'pass');
});

test('repairs a regression using actual prior date without erasing ledger-only unknown',()=>{
  const input=fixture();input.candidateSource.price_observations[key('LOST')]='2026-07-16';
  input.candidateSource.price_observations_sha256=priceObservationDigest(input.candidateSource.price_observations);
  const plan=planRetainedPriceRecovery(input);
  assert.equal(plan.retained[0].reason,'regressed_history');assert.equal(plan.retained[0].rejected_date,'2026-07-16');
  assert.equal(plan.projected_observations[key('LOST')],'2026-10-02');
  const result=comparePriceObservations(plan.projected_observations,input.priorPublication.known_price_dates);
  assert(result.advances);assert.deepEqual(result.regressions,[]);assert.deepEqual(result.missing,[key('LEDGER_ONLY')]);
});

test('no prior actual bytes means a known regression cannot be repaired from its ledger',()=>{
  const input=fixture();delete input.priorPublication.price_observations[key('LOST')];
  input.candidateSource.price_observations[key('LOST')]='2026-07-16';input.candidateSource.price_observations_sha256=priceObservationDigest(input.candidateSource.price_observations);
  assert.throws(()=>planRetainedPriceRecovery(input),/No recoverable|cannot repair/);
});

test('retains chart-index-only instruments without inventing research rows',()=>{
  const input=fixture();input.priorPublication.price_observations[key('EXTRA')]='2026-10-02';input.priorPublication.known_price_dates[key('EXTRA')]='2026-10-02';
  input.priorChartIndex.symbols.push({symbol:'EXTRA',path:'charts/EXTRA.json'});
  input.priorCharts.EXTRA={...clone(input.priorCharts.LOST),symbol:'EXTRA',stock_data:{symbol:'EXTRA',market:'US'}};
  const plan=planRetainedPriceRecovery(input),result=compileRetainedPriceRecovery({...input,plan});
  assert.equal(result.patches.length,2);assert.equal(result.rows.length,11);assert.equal(result.patches.find(x=>x.symbol==='EXTRA').row,null);
  assert.equal(result.patches.find(x=>x.symbol==='EXTRA').snapshot.prior_row,null);
});

test('rejects missing rows, changed identity, weakened floor, conflicting paths and stale target',()=>{
  for(const mutate of [
    i=>i.candidateRows.pop(),i=>{i.candidateRows.at(-1).exchange='XNYS';},
    i=>{i.priorPublication.verification_universe.minimum_target=.8;},
    i=>{i.priorChartIndex.symbols.at(-1).path='../evil';},
    i=>{i.priorChartIndex.symbols.push(clone(i.priorChartIndex.symbols[0]));},
    i=>{i.candidateRows.at(-1).as_of_date='2026-10-02';},
    i=>{i.candidateSource.manifest_sha256='a'.repeat(64);},
    i=>{i.candidateSource.price_observations[key('GOOD0')]='2026-10-06';i.candidateSource.price_observations_sha256=priceObservationDigest(i.candidateSource.price_observations);},
  ]){const input=fixture();mutate(input);assert.throws(()=>planRetainedPriceRecovery(input));}
});

test('rejects changed plan, actual chart date, reordered bars and cross-view prior scalars',()=>{
  for(const mutate of [
    (i,p)=>{p.required_symbols.pop();},(i)=>{i.priorRows.at(-1).current_price=21;},
    (i)=>{i.priorCharts.LOST.bars[0].date='2026-10-01';},
    (i)=>{i.priorCharts.LOST.bars.push(clone(i.priorCharts.LOST.bars[0]));},
    (i)=>{i.priorCharts.LOST.stock_data.rs_rating=99;},
    (i)=>{i.priorDetails.LOST.current_price=1;},
    (i)=>{i.priorCharts.LOST.symbol='OTHER';},
    (i)=>{i.priorCharts.LOST.market='JP';},
    (i)=>{i.priorCharts.LOST.stock_data.symbol='OTHER';},
    (i)=>{i.priorCharts.LOST.stock_data.market='JP';},
    (i)=>{i.priorCharts.LOST.stock_data.as_of_date='2026-10-05';},
    (i)=>{i.priorDetails.LOST.market='JP';},
    (i)=>{i.priorCharts.LOST.as_of_date='2026-10-05';},
  ]){const input=fixture(),plan=planRetainedPriceRecovery(input);mutate(input,plan);assert.throws(()=>compileRetainedPriceRecovery({...input,plan}));}
});

test('original candidate must pass the existing ratio on the retained denominator',()=>{
  const input=fixture();input.candidateRows[0].technical_audit.valid=false;
  assert.throws(()=>planRetainedPriceRecovery(input),/unchanged retained-universe gate/);
});

function quarantineFixture(){
  const input=fixture();
  for(let n=10;n<20;n++){
    const symbol=`GOOD${n}`;
    for(const rows of [input.priorRows,input.candidateRows]){
      const row=clone(rows[0]);Object.assign(row,{symbol,company_name:`Issuer ${symbol}`,chart_path:`charts/${symbol}.json`,research_detail_path:`details/${symbol}.json`});row.technical_audit.symbol=symbol;rows.push(row);
    }
    input.priorPublication.verification_universe.required_symbols.push(symbol);
    input.priorPublication.price_observations[key(symbol)]='2026-10-02';input.priorPublication.known_price_dates[key(symbol)]='2026-10-02';
    input.candidateSource.price_observations[key(symbol)]='2026-10-05';input.priorChartIndex.symbols.push({symbol,path:`charts/${symbol}.json`});
  }
  const eqr=date=>({symbol:'EQR',market:'US',currency:'USD',exchange:'XNYS',company_name:'Equity Residential Properties Trust',as_of_date:date,
    current_price:63.65999984741211,adv_usd:196594975,chart_path:null,research_detail_path:'details/EQR.json',
    price:63.66,close:63.66,price_as_of_date:date,ibd_group_rank:144,rs_rating:90,source_rs_rating:90,rs_method:'old',rs_as_of_date:date,
    passes_template:true,se_setup_ready:true,se_pivot_price:65,vcp_detected:true,risk_plan:{buy:65},entry_evidence:{shape:{candidate:true}},
    method_summary:{qualified:true},financial_history:{retrieved_at:'2026-10-04T13:07:17.075Z',annual:[{end:'2025-12-31',eps:2.94}]},
    eps_growth_qq:25,eps_growth_quarterly:25,financial_source_publication_date:null,financial_evaluated_at:1791261049000,
    technical_audit:{version:'ohlcv-v1',symbol:'EQR',as_of_date:date,valid:false,bars:0,errors:['no chart'],values:{}}});
  const old=eqr('2026-10-02'),current=eqr('2026-10-05');
  input.priorRows.push(old);input.candidateRows.push(current);input.priorPublication.verification_universe.required_symbols.push('EQR');
  input.candidateChartIndex=clone(input.priorChartIndex);input.candidateSource.price_observations_sha256=priceObservationDigest(input.candidateSource.price_observations);
  input.rowQuarantines=[{symbol:'EQR',reason:'undated_price_without_chart',observation_date:null,prior_row_sha256:recoveryDigest(old),candidate_row_sha256:recoveryDigest(current),
    source_rows:Object.fromEntries([['prior',old],['candidate',current]].map(([name,row])=>[name,Object.fromEntries(['as_of_date','current_price','adv_usd','chart_path','technical_audit'].map(field=>[field,clone(row[field])]))]))}];
  return input;
}

test('EQR row-only quarantine preserves source evidence and financial clocks without fabricating a history or date',()=>{
  const input=quarantineFixture(),unchanged=clone(input),plan=planRetainedPriceRecovery(input),result=compileRetainedPriceRecovery({...input,plan});
  assert.deepEqual(input,unchanged);assert.equal(result.patches.length,1);assert.equal(result.row_quarantines.length,1);
  assert.equal(result.rows.length,22);assert.deepEqual(result.coverage,{total:22,verified:20,minimum_target:.9});
  assert(plan.required_symbols.includes('EQR'));assert(!Object.hasOwn(plan.projected_observations,key('EQR')));
  const patch=result.row_quarantines[0],row=patch.row,source=input.candidateRows.at(-1);
  assert.deepEqual(patch.snapshot.prior_row,input.priorRows.at(-1));assert.deepEqual(patch.snapshot.candidate_row,source);
  assert.equal(patch.snapshot.publication_authority,false);assert.equal(patch.snapshot.schema_version,'retained-price-row-quarantine-snapshot-v1');
  assert.equal(patch.observation_date,null);assert.equal(row.chart_path,null);assert.equal(row.as_of_date,'2026-10-05');
  assert.equal(row.current_price,null);assert.equal(row.adv_usd,null);assert.equal(row.rs_rating,null);assert.equal(row.source_rs_rating,null);
  assert.equal(row.rs_as_of_date,null);assert.equal(row.se_pivot_price,null);assert.equal(row.se_setup_ready,false);assert.equal(row.vcp_detected,false);
  assert.equal(row.technical_audit.valid,false);assert.equal(row.technical_audit.bars,0);assert.deepEqual(auditValues(row),{});
  assert.equal(row.price_quarantine.observation_date,null);assert.equal(row.price_quarantine.status,'unverified_observation');
  assert.equal(row.price_quarantine.snapshot_sha256,recoveryDigest(patch.snapshot));assert.match(row.setup_recalculation.reason,/No dated price observation/);
  for(const field of ['price','close','price_as_of_date','ibd_group_rank','risk_plan','entry_evidence','method_summary','retained_price_history'])assert(!Object.hasOwn(row,field),field);
  for(const field of RECOVERY_FINANCIAL_FIELDS){assert.equal(Object.hasOwn(row,field),Object.hasOwn(source,field),field);if(Object.hasOwn(source,field))assert.deepEqual(row[field],source[field],field);}
  assert.equal(rankVerifiedUniverse(result.rows).find(r=>r.symbol==='EQR').rs_rating,null);
  const ready=entryReadiness(row,'2026-10-05',{state:'known',cap:1},Date.parse('2026-10-06T22:00:00Z'));
  assert.equal(ready.ready,false);assert.equal(ready.rules.find(rule=>rule.id==='price').state,'unknown');
  assert.notEqual(ready.rules.find(rule=>rule.id==='date').state,'pass');
});

test('row quarantine binds exact original dates, prices, audits, identities and absent observation ledgers',()=>{
  for(const mutate of [
    i=>{i.rowQuarantines[0].candidate_row_sha256='a'.repeat(64);},
    i=>{i.rowQuarantines[0].prior_row_sha256='a'.repeat(64);},
    i=>{i.rowQuarantines[0].source_rows.prior.as_of_date='2026-10-01';},
    i=>{i.rowQuarantines[0].source_rows.candidate.current_price=1;},
    i=>{i.rowQuarantines[0].source_rows.candidate.technical_audit.bars=1;},
    i=>{i.rowQuarantines[0].observation_date='2026-10-02';},
    i=>{i.rowQuarantines[0].symbol='VMRK';},
    i=>{i.rowQuarantines.push(clone(i.rowQuarantines[0]));},
    i=>{i.candidateRows.at(-1).company_name='Different issuer';},
    i=>{i.candidateChartIndex.symbols.push({symbol:'EQR',path:'charts/EQR.json'});},
    i=>{i.priorChartIndex.symbols.push({symbol:'EQR',path:'charts/EQR.json'});},
    i=>{i.priorPublication.known_price_dates[key('EQR')]='2026-10-02';},
  ]){const input=quarantineFixture();mutate(input);assert.throws(()=>planRetainedPriceRecovery(input));}
});

test('clearing an undated newly eligible row preserves the full reviewed required union',()=>{
  const input=quarantineFixture();input.priorPublication.verification_universe.required_symbols=input.priorPublication.verification_universe.required_symbols.filter(s=>s!=='EQR');
  const plan=planRetainedPriceRecovery(input),result=compileRetainedPriceRecovery({...input,plan});
  assert(!plan.previous_required_symbols.includes('EQR'));assert(plan.required_symbols.includes('EQR'));
  assert.deepEqual(result.coverage,{total:22,verified:20,minimum_target:.9});
});

test('unrequested row quarantines default to an empty list',()=>{
  const input=fixture(),plan=planRetainedPriceRecovery(input),result=compileRetainedPriceRecovery({...input,plan});
  assert.deepEqual(plan.row_quarantines,[]);assert.deepEqual(result.row_quarantines,[]);
});

function missingDxyFixture(){
  const input=fixture(),homeKey=JSON.stringify(['US','home','TVC:DXY']);
  input.priorPublication.price_observations[homeKey]='2026-10-02';input.priorPublication.known_price_dates[homeKey]='2026-10-02';
  const manifest=JSON.parse(input.candidateSource.manifest_json);
  manifest.markets.US.pages={home:{path:'markets/us/home.json'}};manifest.pages={home:{path:'markets/us/home.json'}};
  input.candidateSource.manifest_json=JSON.stringify(manifest);
  input.candidateSource.manifest_sha256=createHash('sha256').update(input.candidateSource.manifest_json).digest('hex');
  const item={symbol:'TVC:DXY',currency:'USD',display_name:'US Dollar Index',latest_date:'2026-10-02',latest_close:101.93,change_1d:-.17,
    history:[{date:'2026-10-01',close:102.1},{date:'2026-10-02',close:101.93}]};
  const prior={schema_version:'static-site-v2',market:'US',as_of_date:'2026-10-02',generated_at:'2026-10-04T04:20:51Z',key_markets:[item],top_groups:[],scan_summary:{}};
  const candidate={...clone(prior),as_of_date:'2026-10-05',generated_at:'2026-10-06T04:00:00Z',key_markets:[{...clone(item),latest_date:null,latest_close:null,change_1d:null,history:[]}]};
  const priorHomeBytes=Buffer.from(JSON.stringify(prior,null,2)+'\n'),candidateHomeBytes=Buffer.from(JSON.stringify(candidate)+'\n');
  return {input,homeKey,homeInput:{priorPublication:input.priorPublication,candidateSource:input.candidateSource,priorHomeBytes,candidateHomeBytes,
    priorHomeSha256:createHash('sha256').update(priorHomeBytes).digest('hex'),candidateHomeSha256:createHash('sha256').update(candidateHomeBytes).digest('hex')}};
}

test('an unreviewed home loss still fails the recovery planner',()=>{
  const {input}=missingDxyFixture();
  assert.throws(()=>planRetainedPriceRecovery(input),/home-series change requires separate review/);
});

test('reviewed DXY history passes planner and compiler without changing inputs or current display state',async()=>{
  const {prepareRetainedHomeHistory}=await import('./retained-home-history.mjs');
  const {input,homeKey,homeInput}=missingDxyFixture();input.homeHistory=prepareRetainedHomeHistory(homeInput);
  const untouched=clone(input),plan=planRetainedPriceRecovery(input),result=compileRetainedPriceRecovery({...input,plan});
  assert.deepEqual(input,untouched);assert.equal(plan.projected_observations[homeKey],'2026-10-02');
  assert(plan.original_missing.includes(homeKey));assert(!plan.ledger_only_absences.includes(homeKey));
  assert.deepEqual(result.home_history,input.homeHistory);assert.notEqual(result.home_history,input.homeHistory);
  assert.equal(result.home_history.item.latest_date,'2026-10-02');assert.equal(result.home_history.item.latest_close,null);assert.equal(result.home_history.item.change_1d,null);
  assert.deepEqual(result.home_history.item.history,JSON.parse(homeInput.priorHomeBytes).key_markets[0].history);
  assert(Buffer.from(result.home_history.prior_home.raw_utf8).equals(homeInput.priorHomeBytes));
  assert.equal(result.home_history.item.retained_price_history.original_generated_at,'2026-10-04T04:20:51Z');
  assert.equal(result.home_history.target_as_of_date,'2026-10-05');assert.equal(result.patches.length,1);
  assert.deepEqual(result.coverage,{total:11,verified:10,minimum_target:.9});
});

test('home review cannot be replayed with mismatched planner source or predecessor bindings',async()=>{
  const {prepareRetainedHomeHistory}=await import('./retained-home-history.mjs');
  for(const mutation of [
    i=>{i.priorPublication.run_id=999;},
    i=>{const manifest=JSON.parse(i.candidateSource.manifest_json);manifest.warnings=['changed'];i.candidateSource.manifest_json=JSON.stringify(manifest);i.candidateSource.manifest_sha256=createHash('sha256').update(i.candidateSource.manifest_json).digest('hex');},
    i=>{i.candidateSource.price_observations[key('GOOD0')]='2026-10-02';i.candidateSource.price_observations_sha256=priceObservationDigest(i.candidateSource.price_observations);},
  ]){
    const {input,homeInput}=missingDxyFixture();input.homeHistory=prepareRetainedHomeHistory(homeInput);mutation(input);
    assert.throws(()=>planRetainedPriceRecovery(input),/Home predecessor differs|Home source manifest differs|Home observations differ/);
  }
});
