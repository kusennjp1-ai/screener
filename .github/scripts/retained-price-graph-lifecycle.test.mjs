// Bounded synthetic integration. Real compiler/carry/transport functions run;
// no synthetic result or workflow identity is publication/source authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {decodeResearchIndex} from '../../frontend/src/static/researchTransport.js';
import {auditDailyBars} from '../../frontend/src/static/qualificationAudit.js';
import {createFinancialGenerationCarry,verifyCarryCompatibility} from '../../frontend/tools/financial-generation-carry.mjs';
import {verifyCarriedBundle} from './financial-generation-carry-controller.mjs';
import {assessRetainedUniverse} from './retained-universe.mjs';
import {comparePriceObservations,extractPriceObservations,priceObservationDigest} from './price-observations.mjs';
import {planRetainedPriceRecovery,compileRetainedPriceRecovery,recoveryDigest} from './retained-price-recovery.mjs';
import {completeCurrentPriceQuarantine} from './complete-retained-price-quarantine.mjs';
import {materializeRecoveryGraph,syncRecoveryHome} from './materialize-retained-price-graph.mjs';
import {lifecycleFixture} from './fixtures/financial-release-lifecycle.mjs';
import {inventoryDigest,uiInventory} from './publication-state.mjs';
import {packPublication,previewPublication,verifyTransportPublication} from './static-transport-publication.mjs';

const own=fileURLToPath(new URL('../../',import.meta.url)),frontend=join(own,'frontend');
const sha=v=>createHash('sha256').update(v).digest('hex'),clone=v=>JSON.parse(JSON.stringify(v));
const read=p=>JSON.parse(readFileSync(p)),write=(p,v)=>{mkdirSync(dirname(p),{recursive:true});writeFileSync(p,Buffer.isBuffer(v)||typeof v==='string'?v:JSON.stringify(v));};
const oldDate='2026-10-02',target='2026-10-05',now='2026-10-05T22:00:00.000Z';
const symbols=['OWNED',...Array.from({length:40},(_,i)=>`GOOD${i}`),'EQR','STALE','NODATE'];
function bars(date){const days=[];for(let t=Date.parse(date);days.length<260;t-=86400000)if(![0,6].includes(new Date(t).getUTCDay()))days.unshift(new Date(t).toISOString().slice(0,10));return days.map((date,i)=>{const close=80+20*i/259;return {date,open:close,high:close*1.01,low:close*.99,close,volume:3000000};});}
function row(symbol,date){return {symbol,market:'US',currency:'USD',exchange:'XNAS',company_name:symbol==='OWNED'?'Owned Corporation':`${symbol} Corporation`,quoteType:'EQUITY',as_of_date:date,current_price:100,adv_usd:300000000,
  se_setup_ready:true,se_pivot_price:99,vcp_pivot:99,rs_rating:90,setup_recalculation:{status:'calculated',as_of_date:date},
  financial_source_evidence:null,growth_metric_basis:'quarterly_qoq',growth_reporting_cadence:'quarterly',financial_historical:{values:{eps_growth_yy:123},original_clock:'2026-10-04T12:00:00Z'},
  financial_reference:{historical_only:true,old_value:123}};}
function init(directory,date,history){
  const site=join(directory,'frontend/public'),data=join(site,'static-data'),rows=symbols.map(s=>row(s,date));
  const chartRows=rows.filter(r=>!['EQR','NODATE'].includes(r.symbol));
  write(join(data,'manifest.json'),{as_of_date:date,generated_at:now,default_market:'US',supported_markets:['US'],
    assets:{charts:{path:'markets/us/charts/index.json',symbols_total:chartRows.length}},markets:{US:{market:'US',as_of_date:date,
      pages:{scan:{path:'markets/us/scan/manifest.json'},home:{path:'markets/us/home.json'}},assets:{charts:{path:'markets/us/charts/index.json',symbols_total:chartRows.length}}}}});
  write(join(data,'markets/us/home.json'),{as_of_date:date,generated_at:now,top_groups:[],key_markets:[{symbol:'SPY',observation_date:oldDate}],
    scan_summary:{rows_total:rows.length,default_filtered_rows_total:rows.length,top_results:rows}});
  write(join(data,'markets/us/scan/manifest.json'),{as_of_date:date,rows_total:rows.length,initial_rows:rows,preview_rows:rows,
    chunks:[{path:'markets/us/scan/chunks/chunk-0001.json'}],charts:{path:'markets/us/charts/index.json',symbols_total:chartRows.length},default_filters:{minVolume:100000000}});
  write(join(data,'markets/us/scan/chunks/chunk-0001.json'),{as_of_date:date,rows,preview_rows:rows});
  write(join(data,'markets/us/charts/index.json'),{as_of_date:date,generated_at:now,symbols_total:chartRows.length,skipped_symbols:['EQR','NODATE'],symbols:chartRows.map(r=>({symbol:r.symbol,path:`markets/us/charts/${r.symbol}.json`,rank:1,rs_rating:99,buy:{last_close:999},sell:{stop:888}}))});
  for(const r of chartRows){const chart={symbol:r.symbol,market:'US',as_of_date:date,generated_at:now,bars:bars(r.symbol==='STALE'?'2026-09-25':date),stock_data:r,rs_line:[],fundamentals:{...r},signal:{buy:true},bands:{old:1}};write(join(data,`markets/us/charts/${r.symbol}.json`),chart);}
  if(history)cpSync(history,join(data,'candidate-history'),{recursive:true});else write(join(data,'candidate-history/index.json'),{schema_version:1,snapshots:[]});
  write(join(data,'candidate-performance-history/index.json'),{schema_version:1,cohorts:[]});mkdirSync(join(directory,'data/ibd_reference/ibd50'),{recursive:true});
  return {site,data,cwd:join(directory,'frontend')};
}
function compiler(context,env={}){
  execFileSync(process.execPath,[join(frontend,'tools/export-research.mjs')],{cwd:context.cwd,env:{...process.env,FINANCIAL_EVALUATED_AT:now,...env},stdio:'pipe',timeout:30000});
}
function record(context,env={}){execFileSync(process.execPath,[join(frontend,'tools/record-candidate-history.mjs')],{cwd:context.cwd,env:{...process.env,FINANCIAL_EVALUATED_AT:now,...env},stdio:'pipe',timeout:30000});}
function index(context){const manifest=read(join(context.data,'manifest.json'));return {manifest,index:decodeResearchIndex(read(join(context.data,manifest.markets.US.assets.research.path))),charts:read(join(context.data,manifest.markets.US.assets.charts.path))};}
function files(root,relative=''){const result={};for(const item of readdirSync(join(root,relative),{withFileTypes:true})){const name=relative?`${relative}/${item.name}`:item.name;if(item.isDirectory())Object.assign(result,files(root,name));else {const raw=readFileSync(join(root,name));result[name]={bytes:raw.length,sha256:sha(raw)};}}return result;}

test('full-row repair survives both canonical compiles, ordinary financial carry/expiry and packed Pages bounds',{timeout:120000},async()=>{
  const temp=mkdtempSync(join(tmpdir(),'retained-graph-lifecycle-')),source=lifecycleFixture();
  try{
    const prior=init(join(temp,'prior'),oldDate);compiler(prior);record(prior);const old=index(prior);
    const priorSelection=readFileSync(join(prior.data,'candidate-history/index.json')),priorPerformance=readFileSync(join(prior.data,'candidate-performance-history/index.json'));
    const candidate=init(join(temp,'candidate'),target,join(prior.data,'candidate-history'));
    const badPath=join(candidate.data,'markets/us/charts/OWNED.json'),bad=read(badPath);bad.bars=bad.bars.filter(b=>b.date<='2026-07-16');write(badPath,bad);
    compiler(candidate);record(candidate);const original=index(candidate);
    assert(read(join(candidate.data,'candidate-history/index.json')).snapshots.some(r=>r.as_of===target),'fixture contains a rejected target-day observation');
    const oldObs=extractPriceObservations({dataRoot:prior.data,manifest:old.manifest}),newObs=extractPriceObservations({dataRoot:candidate.data,manifest:original.manifest});
    const publication={schema:1,price_observations:oldObs,known_price_dates:oldObs,verification_universe:{as_of_date:oldDate,minimum_target:.9,required_symbols:symbols}};
    const manifestRaw=readFileSync(join(candidate.data,'manifest.json')).toString(),metadata={manifest_json:manifestRaw,manifest_sha256:sha(manifestRaw),price_observations:newObs,price_observations_sha256:priceObservationDigest(newObs)};
    const priorEqr=old.index.rows.find(r=>r.symbol==='EQR'),candidateEqr=original.index.rows.find(r=>r.symbol==='EQR');
    const sourceFields=r=>Object.fromEntries(['as_of_date','current_price','adv_usd','chart_path','technical_audit'].map(k=>[k,r[k]]));
    const quarantine={symbol:'EQR',reason:'undated_price_without_chart',observation_date:null,
      prior_row_sha256:recoveryDigest(priorEqr),candidate_row_sha256:recoveryDigest(candidateEqr),source_rows:{prior:sourceFields(priorEqr),candidate:sourceFields(candidateEqr)}};
    const input={priorPublication:publication,priorRows:old.index.rows,candidateRows:original.index.rows,candidateSource:metadata,priorChartIndex:old.charts,candidateChartIndex:original.charts,rowQuarantines:[quarantine]};
    const plan=planRetainedPriceRecovery(input),oldOwned=old.index.rows.find(r=>r.symbol==='OWNED');
    const basePrepared=compileRetainedPriceRecovery({...input,plan,priorCharts:{OWNED:read(join(prior.data,oldOwned.chart_path))},priorDetails:{OWNED:read(join(prior.data,oldOwned.research_detail_path))}});
    const candidateCharts={STALE:read(join(candidate.data,original.index.rows.find(row=>row.symbol==='STALE').chart_path))};
    const residualReview={schema_version:'retained-price-residual-review-v1',publication_authority:false,scope:'unpublished_local_preparation_only',base_prepared_sha256:recoveryDigest(basePrepared),source_observations_sha256:plan.source_observations_sha256,candidate_chart_index_sha256:recoveryDigest(original.charts),symbols:['STALE','NODATE'].map(symbol=>{const row=original.index.rows.find(r=>r.symbol===symbol);return {symbol,candidate_row_sha256:recoveryDigest(row),observation_date:newObs[JSON.stringify(['US','chart',symbol])]??null,candidate_chart_sha256:candidateCharts[symbol]?recoveryDigest(candidateCharts[symbol]):null};})};
    const prepared=completeCurrentPriceQuarantine({prepared:basePrepared,plan,candidateRows:original.index.rows,candidateSource:metadata,candidateChartIndex:original.charts,candidateCharts,review:residualReview});
    const preparedRaw=JSON.stringify(prepared),sourceReceipt={schema_version:'retained-price-candidate-restoration-v1',mode:'normal-candidate',publication_authority:false,ready_to_publish:false,fullSiteVerified:false,
      archive:{path:join(temp,'synthetic-candidate.zip'),sha256:'a'.repeat(64),bytes:1},files:files(candidate.site)};
    const sourceReceiptPath=join(candidate.site,'retained-price-restoration-receipt.json');write(sourceReceiptPath,sourceReceipt);
    materializeRecoveryGraph({root:candidate.site,prepared:Buffer.from(preparedRaw),expectedPreparedSha256:sha(preparedRaw),sourceReceiptPath,sourceReceiptSha256:sha(readFileSync(sourceReceiptPath)),
      previousSelectionCatalog:{bytes:priorSelection,sha256:sha(priorSelection)},previousPerformanceCatalog:{bytes:priorPerformance,sha256:sha(priorPerformance)}});
    assert.deepEqual(readFileSync(join(candidate.data,'candidate-history/index.json')),priorSelection);
    compiler(candidate);const homeSync=syncRecoveryHome(candidate.site);assert(homeSync.fields.length);
    const homeBeforeCarry=readFileSync(join(candidate.data,'markets/us/home.json'));
    assert.deepEqual(read(join(candidate.data,'markets/us/home.json')).key_markets,[{symbol:'SPY',observation_date:oldDate}]);
    const baseline=join(temp,'baseline');cpSync(candidate.site,baseline,{recursive:true});
    const repaired=index(candidate),current=repaired.index.rows.find(r=>r.symbol==='OWNED');
    assert.equal(current.current_price,null);assert.equal(current.rs_rating,null);assert.equal(current.technical_audit.valid,false);
    assert.equal(comparePriceObservations(extractPriceObservations({dataRoot:candidate.data,manifest:repaired.manifest}),oldObs).regressions.length,0);
    const coverage=assessRetainedUniverse({previousSymbols:symbols,rows:repaired.index.rows,asOfDate:target});assert.equal(coverage.total,44);assert.equal(coverage.verified,40);assert(coverage.passed);
    const targetBase=JSON.stringify({market:'US',as_of_date:target,rows:repaired.index.rows});
    const carry=createFinancialGenerationCarry({sourceProjection:source.original.bytes,sourceProjectionSha256:sha(source.original.bytes),sourceBase:source.original.base,sourceBaseSha256:sha(source.original.base),
      sourceLineage:source.lineage.id,previousPublicationIdentity:source.original.value.bindings.target_publication_identity,targetBase,targetBaseSha256:sha(targetBase),evaluatedAt:now});
    const carryPath=join(temp,'carry.json'),carryRaw=JSON.stringify(carry);write(carryPath,carryRaw);
    const env={FINANCIAL_GENERATION_CARRY_PROJECTION:carryPath,FINANCIAL_GENERATION_CARRY_SHA256:sha(carryRaw),FINANCIAL_GENERATION_CARRY_SOURCE_LINEAGE:source.lineage.id,
      FINANCIAL_GENERATION_CARRY_PREVIOUS_IDENTITY:carry.bindings.previous_publication_identity,FINANCIAL_GENERATION_CARRY_TARGET_BASE_SHA256:sha(targetBase)};
    compiler(candidate,env);record(candidate,env);
    const checked=await verifyCarriedBundle({baselineRoot:baseline,root:candidate.site,frontendRoot:frontend,carry,evaluatedAt:Date.parse(now)});assert(checked.compatibility);
    assert.deepEqual(readFileSync(join(candidate.data,'markets/us/home.json')),homeBeforeCarry,'financial-only pass preserves the synchronized home and literal market clocks');
    const final=index(candidate),owned=final.index.rows.find(r=>r.symbol==='OWNED'),finalChart=read(join(candidate.data,owned.chart_path));
    assert.equal(owned.current_price,null);assert.equal(owned.eps_growth_yy,40);assert.equal(owned.technical_audit.valid,false);
    const eqr=final.index.rows.find(r=>r.symbol==='EQR');assert(eqr);assert.equal(eqr.current_price,null);assert.equal(eqr.adv_usd,null);assert.equal(eqr.rs_rating,null);assert.equal(eqr.chart_path,null);
    assert.equal(eqr.technical_audit.valid,false);assert(!final.charts.symbols.some(r=>r.symbol==='EQR'));
    for(const symbol of ['STALE','NODATE']){const row=final.index.rows.find(r=>r.symbol===symbol);assert.equal(row.current_price,null);assert.equal(row.adv_usd,null);assert.equal(row.rs_rating,null);assert.equal(row.technical_audit.valid,false);if(symbol==='STALE'){const chart=read(join(candidate.data,row.chart_path));assert.deepEqual(chart.bars,candidateCharts.STALE.bars);assert.equal(chart.generated_at,candidateCharts.STALE.generated_at);}else assert.equal(row.chart_path,null);}
    assert.deepEqual(finalChart.bars,read(join(prior.data,oldOwned.chart_path)).bars);
    assert.deepEqual(carry.symbols.OWNED.source_receipts,source.original.value.symbols.OWNED.source_receipts);
    assert.equal(read(join(candidate.data,'candidate-history/index.json')).snapshots.filter(r=>r.as_of===target).length,1);
    await assert.rejects(verifyCarryCompatibility({root:candidate.data,carry,evaluatedAt:Date.parse('2026-10-20T22:00:00Z')}),/expired|invalid|mismatch/);
    write(join(candidate.site,'index.html'),'<!doctype html><title>Non-authoritative offline fixture</title>');
    cpSync(join(frontend,'public/static-transport-capability.json'),join(candidate.site,'static-transport-capability.json'));
    // Restoration diagnostics belong to the rehearsal artifact, not hosted UI.
    for(const path of ['retained-price-restoration-receipt.json','retained-price-materialization-receipt.json'])if(existsSync(join(candidate.site,path)))rmSync(join(candidate.site,path));
    const receipt=previewPublication({uiSha:'b'.repeat(40),uiDigest:inventoryDigest(uiInventory(candidate.site)),manifestSha256:sha(readFileSync(join(candidate.data,'manifest.json')))});
    await packPublication({root:candidate.site,frontendRoot:frontend,publication:receipt,bindings:{sourceCommit:'c'.repeat(40),appCommit:'b'.repeat(40),candidateId:'d'.repeat(64)}});
    assert(await verifyTransportPublication({root:candidate.site,frontendRoot:frontend,publication:read(join(candidate.site,'publication.json'))}));
    execFileSync('python3',[join(own,'.github/scripts/check-pages-payload.py'),candidate.site],{stdio:'pipe',timeout:30000});
  }finally{source.cleanup();rmSync(temp,{recursive:true,force:true});}
});
