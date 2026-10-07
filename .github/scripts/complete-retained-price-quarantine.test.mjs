import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {completeCurrentPriceQuarantine} from './complete-retained-price-quarantine.mjs';
import {recoveryDigest} from './retained-price-recovery.mjs';
import {priceObservationDigest} from './price-observations.mjs';
import {auditDailyBars} from '../../frontend/src/static/qualificationAudit.js';
import {researchCsv} from '../../frontend/src/static/researchEngine.js';
import {filterRanked} from '../../frontend/src/static/researchPresentation.js';
import {prepareResidualFromFiles} from './prepare-retained-price-residual.mjs';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const clone=v=>JSON.parse(JSON.stringify(v)),target='2026-10-05',date='2026-09-25',key=s=>JSON.stringify(['US','chart',s]);
function fixture(){
  const row=symbol=>({symbol,market:'US',currency:'USD',exchange:'XNYS',company_name:`Issuer ${symbol}`,as_of_date:target,current_price:11,adv_usd:2e8,
    financial_current:{clock:'literal'},financial_evaluated_at:123,eps_growth_qq:null,se_setup_ready:true,se_pivot_price:12,rs_rating:90,technical_audit:{valid:false,bars:0,values:{}},chart_path:null});
  const stale=row('STALE'),missing={...row('MISSING'),adv_usd:null},chart={symbol:'STALE',market:'US',as_of_date:target,generated_at:'2026-10-06T01:00:00Z',bars:[{date,open:10,high:12,low:9,close:11,volume:2e7}],stock_data:clone(stale)};
  stale.chart_path='charts/STALE.json';stale.technical_audit.bars=1;
  const good=Array.from({length:40},(_,i)=>{const r=row(`GOOD${i}`),bars=[];for(let t=Date.parse(target);bars.length<260;t-=86400000)if(![0,6].includes(new Date(t).getUTCDay()))bars.unshift({date:new Date(t).toISOString().slice(0,10),open:10,high:12,low:9,close:11,volume:2e7});r.technical_audit=auditDailyBars(r,{symbol:r.symbol,as_of_date:target,bars},target);return r;});
  const candidateRows=[...good,stale,missing],observations=Object.fromEntries([...good.map(r=>[key(r.symbol),target]),[key('STALE'),date]]);
  const manifest_json=JSON.stringify({markets:{US:{as_of_date:target}}}),candidateSource={manifest_json,price_observations:observations};
  const plan={target_as_of_date:target,candidate_rows_sha256:recoveryDigest(candidateRows),source_manifest_sha256:createHash('sha256').update(manifest_json).digest('hex'),source_observations_sha256:priceObservationDigest(observations),required_symbols:candidateRows.map(r=>r.symbol).sort()};plan.plan_sha256=recoveryDigest(plan);
  const prepared={schema_version:'retained-price-recovery-v1',publication_authority:false,requires_full_rebuild:true,requires_financial_carry:true,plan_sha256:plan.plan_sha256,target_as_of_date:target,rows:clone(candidateRows),patches:[],row_quarantines:[],coverage:{verified:40,total:42,minimum_target:.9}};
  const candidateChartIndex={symbols:[{symbol:'STALE',path:stale.chart_path}]},candidateCharts={STALE:chart};
  const review={schema_version:'retained-price-residual-review-v1',publication_authority:false,scope:'unpublished_local_preparation_only',base_prepared_sha256:recoveryDigest(prepared),source_observations_sha256:plan.source_observations_sha256,candidate_chart_index_sha256:recoveryDigest(candidateChartIndex),symbols:[stale,missing].map(r=>({symbol:r.symbol,candidate_row_sha256:recoveryDigest(r),observation_date:observations[key(r.symbol)]??null,candidate_chart_sha256:candidateCharts[r.symbol]?recoveryDigest(candidateCharts[r.symbol]):null}))};
  return {prepared,plan,candidateRows,candidateSource,candidateChartIndex,candidateCharts,review};
}
test('complete residual quarantine preserves all members, original bars, finite/null financial slots and real clocks',()=>{
  const input=fixture(),original=clone(input),result=completeCurrentPriceQuarantine(input);assert.deepEqual(input,original);
  assert.equal(result.rows.length,42);assert.equal(result.patches.length,1);assert.equal(result.row_quarantines.length,1);assert.equal(result.coverage.verified,40);
  for(const symbol of ['STALE','MISSING']){const row=result.rows.find(r=>r.symbol===symbol);assert.equal(row.current_price,null);assert.equal(row.adv_usd,null);assert.equal(row.rs_rating,null);assert.equal(row.se_setup_ready,false);assert.equal(row.se_pivot_price,null);assert.deepEqual(row.financial_current,{clock:'literal'});assert.equal(row.financial_evaluated_at,123);assert.equal(row.eps_growth_qq,null);assert(!Object.hasOwn(row,'eps_growth_yy'));assert.equal(row.technical_audit.valid,false);}
  assert.deepEqual(result.patches[0].chart.bars,input.candidateCharts.STALE.bars);assert.equal(result.patches[0].chart.generated_at,input.candidateCharts.STALE.generated_at);
  assert.deepEqual(result.patches[0].snapshot.original_candidate_chart,input.candidateCharts.STALE);assert(!Object.hasOwn(result.patches[0].snapshot,'prior_chart'));
  assert.equal(result.row_quarantines[0].snapshot.original_candidate_chart,null);assert.equal(result.row_quarantines[0].row.chart_path,null);assert.equal(result.residual_current_review.residual_after,0);
});
test('residual review rejects incomplete, altered or duplicate exact symbol scopes and source bindings',()=>{
  for(const mutate of [i=>i.review.symbols.pop(),i=>i.review.symbols.push(clone(i.review.symbols[0])),i=>i.review.base_prepared_sha256='0'.repeat(64),i=>i.review.symbols[0].candidate_row_sha256='0'.repeat(64),i=>i.review.symbols[0].observation_date=target,i=>i.review.symbols[0].candidate_chart_sha256='0'.repeat(64),i=>i.candidateSource.price_observations[key('STALE')]=target]){const i=fixture();mutate(i);assert.throws(()=>completeCurrentPriceQuarantine(i));}
});
test('missing proof cannot admit an indexed chart or invent a price date',()=>{
  for(const mutate of [i=>i.candidateCharts.MISSING=clone(i.candidateCharts.STALE),i=>i.candidateChartIndex.symbols.push({symbol:'MISSING',path:'charts/MISSING.json'}),i=>i.candidateCharts.STALE.bars[0].date=target,i=>i.candidateCharts.STALE.stock_data.symbol='OTHER']){const i=fixture();mutate(i);assert.throws(()=>completeCurrentPriceQuarantine(i));}
});
test('approved CSV and liquidity consumers receive unknown current values for every residual kind',()=>{
  const result=completeCurrentPriceQuarantine(fixture()),rows=result.rows.filter(r=>['STALE','MISSING'].includes(r.symbol));assert.equal(filterRanked(rows.map(row=>({row})),{liquidOnly:true}).length,0);
  for(const method of ['minervini','minervini2','oneil','ibd']){const lines=researchCsv(rows.map(row=>({row})),method,target,Date.parse('2026-10-06T22:00:00Z')).split('\r\n'),header=lines.shift().split(',').map(v=>v.slice(1,-1));for(const line of lines.filter(Boolean)){const values=line.split(',').map(v=>v.slice(1,-1));for(const field of ['daily_price','rs_estimate','pivot'])assert.equal(values[header.indexOf(field)],'');assert.equal(values[header.indexOf('qualified')],'false');}}
});
test('bounded file preparation binds every exact input, cannot overwrite output, and fails before output on changed bytes',t=>{
  const root=mkdtempSync(join(tmpdir(),'residual-prepare-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const i=fixture(),files={prepared:i.prepared,plan:i.plan,candidate_source:i.candidateSource,candidate_research:{rows:i.candidateRows},candidate_chart_index:i.candidateChartIndex,'chart:STALE':i.candidateCharts.STALE};
  const paths={},bindings={};for(const [name,value]of Object.entries(files)){const bytes=Buffer.from(JSON.stringify(value));paths[name]=join(root,name==='chart:STALE'?'STALE.json':name+'.json');writeFileSync(paths[name],bytes);bindings[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
  const reviewPath=join(root,'review.json');writeFileSync(reviewPath,JSON.stringify({...i.review,input_files:bindings}));
  const args={reviewPath,preparedPath:paths.prepared,planPath:paths.plan,candidateSourcePath:paths.candidate_source,candidateResearchPath:paths.candidate_research,candidateChartIndexPath:paths.candidate_chart_index,candidateChartsDirectory:root,output:join(root,'prepared')};
  const receipt=prepareResidualFromFiles(args);assert.equal(receipt.publication_authority,false);assert.equal(receipt.ready_to_publish,false);assert.equal(receipt.full_compiler_passed,false);assert.equal(receipt.residual_before,2);assert.equal(receipt.residual_after,0);assert.equal(receipt.stale_candidate_histories,1);assert.equal(receipt.undated_quarantines,1);
  const preparedBytes=readFileSync(join(args.output,'compiler-inputs.json'));assert.equal(createHash('sha256').update(preparedBytes).digest('hex'),receipt.files['compiler-inputs.json'].sha256);assert.throws(()=>prepareResidualFromFiles(args),/already exists/);
  writeFileSync(paths.candidate_source,JSON.stringify({...i.candidateSource,changed:true}));assert.throws(()=>prepareResidualFromFiles({...args,output:join(root,'reject')}),/exact input differs/);assert(!existsSync(join(root,'reject')));
});

test('original charts may omit the outer market only when embedded stock identity proves US',()=>{
  const input=fixture();delete input.candidateCharts.STALE.market;input.review.symbols[0].candidate_chart_sha256=recoveryDigest(input.candidateCharts.STALE);const result=completeCurrentPriceQuarantine(input);assert.equal(result.patches[0].chart.market,'US');assert(!Object.hasOwn(result.patches[0].snapshot.original_candidate_chart,'market'));
  input.candidateCharts.STALE.market='JP';input.review.symbols[0].candidate_chart_sha256=recoveryDigest(input.candidateCharts.STALE);assert.throws(()=>completeCurrentPriceQuarantine(input),/identity mismatch/);
});
