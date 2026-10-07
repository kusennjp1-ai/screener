// Finite diagnostic replay. No GitHub, provider, source selector, or publisher calls.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {decodeResearchIndex} from '../../frontend/src/static/researchTransport.js';
import {planRetainedPriceRecovery,compileRetainedPriceRecovery,recoveryDigest,RECOVERY_FINANCIAL_FIELDS} from './retained-price-recovery.mjs';
import {prepareRetainedHomeHistory} from './retained-home-history.mjs';
import {completeCurrentPriceQuarantine} from './complete-retained-price-quarantine.mjs';
import {materializeRecoveryGraph,proveRecoveryAggregateCorrectionFromRowBindings,syncRecoveryHome} from './materialize-retained-price-graph.mjs';
import {extractPriceObservations,comparePriceObservations,priceObservationDigest} from './price-observations.mjs';
import {assessRetainedUniverse} from './retained-universe.mjs';

const own=fileURLToPath(new URL('./',import.meta.url));
const fixture=join(own,'fixtures/oct6-retained-price-rehearsal');
export const contract=JSON.parse(readFileSync(join(fixture,'contract.json')));
const review=JSON.parse(readFileSync(join(own,'fixtures/retained-price-recovery-oct6-inputs.json')));
const residual=JSON.parse(readFileSync(join(own,'fixtures/retained-price-residual-oct6-review.json')));
const runtime=JSON.parse(readFileSync(join(own,'fixtures/retained-price-producer-runtime-oct6.json')));
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=path=>JSON.parse(readFileSync(path));
const write=(path,value)=>writeFileSync(path,JSON.stringify(value),{flag:'wx'});
const normalized=value=>JSON.parse(JSON.stringify(value));
const project=(row,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
const groupFields=['symbol','company_name','ibd_industry_group','market_cap_usd','market_cap'];
const stockKey=symbol=>JSON.stringify(['US','chart',symbol]);
const affectedSymbols=prepared=>new Set([...prepared.patches.filter(p=>p.row).map(p=>p.symbol),...prepared.row_quarantines.map(p=>p.symbol)]);
export function binding(bytes){return {bytes:bytes.length,sha256:sha(bytes)};}
export function bound(bytes,pin,label){assert.deepEqual(binding(bytes),pin,`${label}: exact bytes changed`);return bytes;}

export function verifyScopedReplay(actual,reviewed){
  // Only the local archive location may differ. Keep both original receipts;
  // never rewrite a new extraction receipt to look like the old extraction.
  const comparable=value=>{const result=structuredClone(value);delete result.archive.path;return result;};
  assert.deepEqual(comparable(actual),comparable(reviewed),'Independent scoped extraction differs from reviewed receipt');
  assert.equal(actual.fullSiteVerified,false);
  return true;
}

export function prepareExact(scopes,sourceBytes){
  const paths=Object.fromEntries(Object.entries(contract.scopes).map(([name,pin])=>{
    const oldRaw=readFileSync(join(fixture,name+'.json'));assert.equal(sha(oldRaw),pin.receipt_sha256);
    const old=JSON.parse(oldRaw),fresh=json(join(scopes,name,'scoped-extraction-manifest.json'));
    verifyScopedReplay(fresh,old);
    for(const [path,ref] of Object.entries(fresh.files))bound(readFileSync(join(scopes,name,path)),{bytes:ref.decodedBytes,sha256:ref.decodedSha256},path);
    return [name,join(scopes,name)];
  }));
  const read=(name,path)=>json(join(paths[name],path));
  bound(sourceBytes,residual.input_files.candidate_source,'source.json');
  const candidateSource=JSON.parse(sourceBytes),priorPublication=read('prior-metadata','publication.json');
  assert.equal(candidateSource.manifest_json,readFileSync(join(paths['candidate-metadata'],'static-data/manifest.json'),'utf8'));
  const input={priorPublication,priorRows:decodeResearchIndex(read('prior-metadata',review.prior.research_path)).rows,
    candidateRows:decodeResearchIndex(read('candidate-metadata',review.candidate.research_path)).rows,candidateSource,
    priorChartIndex:read('prior-metadata',review.prior.chart_index_path),candidateChartIndex:read('candidate-metadata',review.candidate.chart_index_path),rowQuarantines:review.quarantine_adjustments};
  input.homeHistory=prepareRetainedHomeHistory({priorPublication,candidateSource,
    priorHomeBytes:readFileSync(join(paths['prior-home'],'static-data/markets/us/home.json')),priorHomeSha256:review.home_history.prior_sha256,
    candidateHomeBytes:readFileSync(join(paths['candidate-metadata'],'static-data/markets/us/home.json')),candidateHomeSha256:review.home_history.candidate_sha256});
  const plan=planRetainedPriceRecovery(input),priorCharts={},priorDetails={};
  for(const p of plan.retained){priorCharts[p.symbol]=read('prior-histories','static-data/'+p.prior_chart_path);if(p.prior_detail_path)priorDetails[p.symbol]=read('prior-histories','static-data/'+p.prior_detail_path);}
  const prepared=compileRetainedPriceRecovery({...input,plan,priorCharts,priorDetails});
  bound(Buffer.from(JSON.stringify(plan)),residual.input_files.plan,'base plan');
  bound(Buffer.from(JSON.stringify(prepared)),residual.input_files.prepared,'base preparation');
  const candidateCharts={};
  for(const p of residual.symbols.filter(p=>p.observation_date!==null)){
    const index=input.candidateChartIndex.symbols.find(c=>c.symbol===p.symbol);assert(index);
    const bytes=bound(readFileSync(join(paths['candidate-histories'],'static-data/'+index.path)),residual.input_files['chart:'+p.symbol],p.symbol);
    candidateCharts[p.symbol]=JSON.parse(bytes);
  }
  const result=completeCurrentPriceQuarantine({...input,prepared,plan,candidateCharts,review:residual});
  bound(Buffer.from(JSON.stringify(result)),contract.prepared,'complete Oct6 preparation');
  return {plan,prepared:result};
}

export function inventory(root){
  root=resolve(root);assert.equal(realpathSync(root),root,'Linked inventory root');const result={};
  function visit(relative=''){
    for(const name of readdirSync(join(root,relative)).sort()){
      const path=relative?relative+'/'+name:name,full=join(root,path),stat=lstatSync(full);
      assert(!stat.isSymbolicLink(),'Linked checkpoint file');
      if(stat.isDirectory())visit(path);else {assert(stat.isFile(),'Nonregular checkpoint file');result[path]=binding(readFileSync(full));}
    }
  }
  visit();return result;
}
export function verifyMutationInventory(original,after,receipt){
  const mutations=new Map(receipt.mutations.map(m=>[m.path,m]));assert.equal(mutations.size,receipt.mutations.length);
  for(const path of new Set([...Object.keys(original),...Object.keys(after)])){
    if(path==='retained-price-restoration-receipt.json')continue;
    const mutation=mutations.get(path);
    if(!mutation)assert.deepEqual(after[path],original[path],`Unreviewed graph mutation: ${path}`);
    else {
      assert.equal(original[path]?.sha256??null,mutation.before_sha256,`Original mutation differs: ${path}`);
      assert.equal(after[path]?.sha256??null,mutation.after_sha256,`Materialized mutation differs: ${path}`);
      assert.equal(after[path]?.bytes??0,mutation.bytes);mutations.delete(path);
    }
  }
  assert.equal(mutations.size,0,'Missing mutation path');return true;
}

export function rowBindings(root){
  const data=join(root,'static-data'),manifest=json(join(data,'manifest.json')),scan=json(join(data,manifest.markets.US.pages.scan.path));
  const rows=[],chunks={};
  for(const chunk of scan.chunks){const path='static-data/'+chunk.path,bytes=readFileSync(join(root,path));chunks[path]=binding(bytes);
    for(const row of JSON.parse(bytes).rows)rows.push({symbol:row.symbol,fields:project(row,groupFields),sha256:recoveryDigest(row),financial_sha256:recoveryDigest(project(row,RECOVERY_FINANCIAL_FIELDS))});}
  assert.equal(rows.length,contract.expected.rows);assert.equal(new Set(rows.map(r=>r.symbol)).size,rows.length);
  return {rows,chunks};
}
export function verifyFullRowMutation(before,after,affected){
  assert.equal(before.length,after.length);const originals=new Map(before.map(r=>[r.symbol,r]));assert.equal(originals.size,before.length);
  let changed=0;
  for(const row of after){const old=originals.get(row.symbol);assert(old,'New/duplicate full source row');originals.delete(row.symbol);
    assert.equal(row.financial_sha256,old.financial_sha256,`Financial presence/value/clock changed: ${row.symbol}`);
    if(affected.has(row.symbol)){assert.notEqual(row.sha256,old.sha256,`Missing row transformation: ${row.symbol}`);changed++;}
    else assert.equal(row.sha256,old.sha256,`Unaffected full row changed: ${row.symbol}`);
  }
  assert.equal(originals.size,0);assert.equal(changed,affected.size);return {rows:after.length,changed,unchanged:after.length-changed,financial_projections:'equal'};
}
export function verifyUnknownRow(row,target,{compact=false}={}){
  assert.equal(row.as_of_date,target);
  for(const key of ['current_price','price_change_1d','adv_usd','volume','rs_rating','se_pivot_price','vcp_pivot']){
    if(compact&&key==='volume'&&!Object.hasOwn(row,key))continue; // Approved compact index omits this field.
    assert.equal(row[key],null,`${row.symbol}: current ${key} is not unknown`);
  }
  for(const key of ['se_setup_ready','vcp_ready_for_breakout'])assert.notEqual(row[key],true,`${row.symbol}: action remains ready`);
  assert.notEqual(row.technical_audit?.valid,true,`${row.symbol}: stale price remains verified`);
}
export function verifyCurrentRows(rows,observations,affected,target,{compact=false}={}){
  assert.equal(new Set(rows.map(r=>r.symbol)).size,rows.length,'Duplicate current row');
  const seen=new Set();
  for(const row of rows){if(typeof row.current_price==='number'&&Number.isFinite(row.current_price))assert.equal(observations[stockKey(row.symbol)],target,`${row.symbol}: unsupported current price`);
    if(affected.has(row.symbol)){verifyUnknownRow(row,target,{compact});seen.add(row.symbol);}}
  assert.deepEqual([...seen].sort(),[...affected].sort(),'Affected row disappeared');return true;
}

export function materializeExact(root,scopes,prepared){
  const original=json(join(root,'retained-price-restoration-receipt.json'));
  assert.equal(original.restoredFiles,contract.source_files);assert.equal(original.restoredBytes,contract.source_payload_bytes);
  const data=join(root,'static-data'),manifest=json(join(data,'manifest.json')),source=json(join(scopes,'source.json'));
  assert.deepEqual(extractPriceObservations({dataRoot:data,manifest}),source.price_observations,'Full source observation map differs from companion');
  const full=rowBindings(root),expected=json(join(fixture,'full-row-source-receipt.json'));
  assert.deepEqual(full.chunks,expected.source_files,'Original six full chunks differ');
  const affected=affectedSymbols(prepared),rrg=readFileSync(join(data,'markets/us/groups_rrg.json'));
  const aggregate=proveRecoveryAggregateCorrectionFromRowBindings({groupsBytes:readFileSync(join(data,'markets/us/groups.json')),groupsPath:'static-data/markets/us/groups.json',homeBytes:readFileSync(join(data,'markets/us/home.json')),homePath:'static-data/markets/us/home.json',
    fullRowBindings:full.rows.map(({symbol,fields,sha256})=>({symbol,fields,sha256})),affectedSymbols:[...affected],
    references:[{path:'static-data/markets/us/groups_rrg.json',bytes:rrg.length,sha256:sha(rrg),observation_scope:'original_dated_database_rank_and_taxonomy_stream_not_recalculated'}],producerRuntimeReview:runtime});
  bound(Buffer.from(JSON.stringify(aggregate)),contract.aggregate_proof,'complete 195-group proof');
  const catalog=directory=>{const bytes=readFileSync(join(scopes,'prior-catalogs/static-data',directory,'index.json'));return {bytes,sha256:sha(bytes)};};
  const receiptPath=join(root,'retained-price-restoration-receipt.json');
  const receipt=materializeRecoveryGraph({root,prepared:Buffer.from(JSON.stringify(prepared)),expectedPreparedSha256:contract.prepared.sha256,sourceReceiptPath:receiptPath,sourceReceiptSha256:sha(readFileSync(receiptPath)),
    previousSelectionCatalog:catalog('candidate-history'),previousPerformanceCatalog:catalog('candidate-performance-history'),aggregateProof:aggregate});
  for(const [key,value] of Object.entries({affected_research_rows:101,restored_research_rows:49,stale_candidate_histories:6,quarantined_research_rows:46,retained_chart_payloads:65,chart_index_only:10,chart_members_total:8740}))assert.equal(receipt[key],value,`Exact materialized scope changed: ${key}`);
  const after=inventory(root);verifyMutationInventory(original.files,after,receipt);
  const rows=verifyFullRowMutation(full.rows,rowBindings(root).rows,affected);
  assert.equal(rows.changed,contract.expected.affected);assert.equal(rows.unchanged,contract.expected.unchanged);
  return {receipt,rows,materialized_inventory:after,source_row_bindings:full.rows};
}

export async function verifyCompiled(root,scopes,prepared,graph,approvedFrontend){
  const data=join(root,'static-data'),manifest=json(join(data,'manifest.json')),market=manifest.markets.US,target=prepared.target_as_of_date;
  const wire=json(join(data,market.assets.research.path)),index=decodeResearchIndex(wire),rows=index.rows;
  assert.equal(rows.length,contract.expected.rows);
  assert.deepEqual(rows.map(row=>row.symbol).sort(),graph.source_row_bindings.map(row=>row.symbol).sort(),'Compiler changed full research membership');
  const affected=affectedSymbols(prepared),observations=extractPriceObservations({dataRoot:data,manifest});
  verifyCurrentRows(rows,observations,affected,target,{compact:true});
  const old=json(join(scopes,'prior-metadata/publication.json')),comparison=comparePriceObservations(observations,old.known_price_dates);
  assert.deepEqual(comparison.regressions,[]);assert(comparison.advances);
  assert.deepEqual(comparison.missing.map(key=>JSON.parse(key)[2]).sort(),['DHY','FSEA','GBTG']);
  const coverage=assessRetainedUniverse({previousSymbols:old.verification_universe.required_symbols,rows,asOfDate:target});
  assert(coverage.passed);assert.equal(coverage.verified,contract.expected.verified);assert.equal(coverage.total,contract.expected.required);
  assert.equal(recoveryDigest(coverage.requiredSymbols),contract.expected.required_symbols_sha256);
  const {assess,entryPlan,researchCsv}=await import(pathToFileURL(join(approvedFrontend,'src/static/researchEngine.js')));
  const methods=['minervini','minervini2','oneil','ibd'],clock=Date.now(),csvCounts=Object.fromEntries(methods.map(m=>[m,0]));
  const scalar=['current_price','adv_usd','rs_rating','se_pivot_price','vcp_pivot','se_setup_ready'];
  for(const row of rows){
    const detail=json(join(data,row.research_detail_path));assert.equal(detail.symbol,row.symbol);
    for(const key of scalar)assert.deepEqual(detail[key],row[key],`Detail alias mismatch: ${row.symbol}/${key}`);
    for(const method of methods){assert.equal(researchCsv([{row}],method,target,clock),researchCsv([{row:detail}],method,target,clock),`Full-universe CSV mismatch: ${row.symbol}/${method}`);csvCounts[method]++;}
    if(affected.has(row.symbol)){verifyUnknownRow(detail,target);for(const method of methods){assert.equal(assess(detail,method,clock).qualified,false);assert.equal(entryPlan(detail,null,method).pivot,null);}}
  }
  const scan=json(join(data,market.pages.scan.path)),chartPaths=new Set([market.assets.charts.path,manifest.assets.charts.path,'markets/us/charts/index.json',scan.charts.path]);
  const fullRows=[];
  for(const chunk of scan.chunks)fullRows.push(...json(join(data,chunk.path)).rows.map(row=>project(row,['symbol','as_of_date','current_price','price_change_1d','adv_usd','volume','rs_rating','se_pivot_price','vcp_pivot','se_setup_ready','vcp_ready_for_breakout','technical_audit'])));
  assert.equal(fullRows.length,contract.expected.rows);verifyCurrentRows(fullRows,observations,affected,target);
  let expectedMembers=null;const checkedChartPaths=new Set(),patches=new Map(prepared.patches.map(p=>[p.symbol,p]));
  for(const path of chartPaths){const charts=json(join(data,path)),members=charts.symbols.map(c=>c.symbol).sort();assert.equal(members.length,contract.expected.chart_members);assert.equal(new Set(members).size,members.length);
    if(expectedMembers)assert.deepEqual(members,expectedMembers);else expectedMembers=members;
    for(const item of charts.symbols){if(checkedChartPaths.has(item.path))continue;checkedChartPaths.add(item.path);const chart=json(join(data,item.path));assert.equal(chart.symbol,item.symbol);const patch=patches.get(item.symbol);if(patch)verifyRetainedChart(chart,patch,target);}
  }
  const originalCharts=json(join(scopes,'candidate-metadata',review.candidate.chart_index_path));
  assert.deepEqual(expectedMembers,[...new Set([...originalCharts.symbols.map(item=>item.symbol),...patches.keys()])].sort(),'Compiler dropped or invented chart membership');
  const currentRows=new Map(rows.map(row=>[row.symbol,row]));
  for(const row of prepared.row_quarantines){assert.equal(currentRows.get(row.symbol).chart_path,null,'Undated row gained a chart');assert(!expectedMembers.includes(row.symbol));assert(!Object.hasOwn(observations,stockKey(row.symbol)));}
  for(const symbol of ['DHY','FSEA','GBTG'])assert(!expectedMembers.includes(symbol),'Ledger-only unknown gained a chart');
  for(const [directory,key] of [['candidate-history','snapshots'],['candidate-performance-history','cohorts']]){
    const prior=json(join(scopes,'prior-catalogs/static-data',directory,'index.json')),current=json(join(data,directory,'index.json'));
    assert.equal(current.schema_version,1);assert(Array.isArray(current[key]));
    const references=new Map(current[key].map(ref=>[ref.path,ref]));assert.equal(references.size,current[key].length,'Duplicate historical catalog reference');
    for(const ref of prior[key]){assert.deepEqual(references.get(ref.path),ref,'Original historical catalog binding changed');assert.equal(sha(readFileSync(join(data,ref.path))),ref.sha256,'Original historical payload changed');}
    for(const ref of current[key])assert.equal(sha(readFileSync(join(data,ref.path))),ref.sha256,'Generated history payload differs from catalog');
  }
  const after=inventory(root),immutable=path=>path.startsWith('static-data/retained-price-history/')||path.startsWith('static-data/retained-price-repair-audit/')||path==='static-data/markets/us/groups.json'||path==='static-data/markets/us/groups_rrg.json';
  assert.equal(after['retained-price-restoration-receipt.json'].sha256,graph.receipt.source_restoration_receipt_sha256,'Original restoration receipt changed');
  for(const [path,pin] of Object.entries(graph.materialized_inventory))if(immutable(path))assert.deepEqual(after[path],pin,`Compiler changed graph audit/group evidence: ${path}`);
  for(const patch of prepared.patches){
    const prefix=encodeURIComponent(patch.symbol)+'-';
    for(const path of Object.keys(after)){
      if(path===`static-data/markets/us/charts/${encodeURIComponent(patch.symbol)}.json`||path.startsWith('static-data/verified-charts/'+prefix))verifyRetainedChart(json(join(root,path)),patch,target);
      if(affected.has(patch.symbol)&&path.startsWith('static-data/research-details/'+prefix))verifyUnknownRow(json(join(root,path)),target);
    }
  }
  const home=json(join(data,market.pages.home.path)),priorHome=json(join(scopes,'prior-home/static-data/markets/us/home.json')),sourceHome=json(join(scopes,'candidate-metadata/static-data/markets/us/home.json'));
  assert.equal(home.generated_at,sourceHome.generated_at);const dxy=home.key_markets.find(r=>r.symbol==='TVC:DXY');
  assert.deepEqual(dxy.history,priorHome.key_markets.find(r=>r.symbol==='TVC:DXY').history);assert.equal(dxy.history.length,30);assert.equal(dxy.latest_date,'2026-10-02');assert.equal(dxy.latest_close,null);assert.equal(dxy.change_1d,null);
  assert.deepEqual(home.key_markets.filter(r=>r.symbol!=='TVC:DXY'),sourceHome.key_markets.filter(r=>r.symbol!=='TVC:DXY'));
  assert.deepEqual(home.scan_summary.top_results,scan.preview_rows);
  for(const row of [...(scan.initial_rows??[]),...(scan.preview_rows??[]),...(home.scan_summary.top_results??[])])if(affected.has(row.symbol))assert.equal(row.current_price,null);
  return {schema_version:'oct6-retained-price-precarry-validation-v1',publication_authority:false,ready_to_publish:false,financial_carry_verified:false,full_browser_verified:false,
    rows:rows.length,affected:affected.size,full_row_materialization:graph.rows,csv_rows:csvCounts,chart_members:expectedMembers.length,restored_prior_histories:59,stale_candidate_histories:6,undated_rows:46,groups:195,coverage:{verified:coverage.verified,total:coverage.total,required_symbols_sha256:recoveryDigest(coverage.requiredSymbols)},
    observations_sha256:priceObservationDigest(observations),ledger_only_absences:comparison.missing,checked_at:new Date(clock).toISOString(),pending:['actual renewed public predecessor binding','ordinary financial carry and current expiry','approved UI real-data browser proof','final transport and Pages bounds']};
}
export function retainedPatchSource(patch,target){
  const snapshot=patch.snapshot;assert.equal(snapshot?.publication_authority,false,`${patch.symbol}: retained snapshot authority changed`);
  let original,observed;
  if(!Object.hasOwn(patch,'history_origin')){
    assert.equal(snapshot.schema_version,'retained-price-snapshot-v1',`${patch.symbol}: prior-history snapshot kind changed`);
    assert(!Object.hasOwn(patch,'observation_date')&&!Object.hasOwn(snapshot,'original_candidate_chart'),`${patch.symbol}: prior-history patch shape changed`);
    original=snapshot.prior_chart;observed=snapshot.actual_observation_date;
  }else{
    assert.equal(patch.history_origin,'candidate_current_quarantine',`${patch.symbol}: unsupported retained patch family`);
    assert.equal(snapshot.schema_version,'retained-price-residual-snapshot-v1',`${patch.symbol}: candidate snapshot kind changed`);
    assert(!Object.hasOwn(snapshot,'prior_chart'),`${patch.symbol}: candidate patch shape changed`);
    original=snapshot.original_candidate_chart;observed=patch.observation_date;
    assert.equal(observed,snapshot.actual_observation_date,`${patch.symbol}: conflicting candidate observation dates`);
  }
  assert(typeof observed==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(observed)&&Number.isFinite(Date.parse(observed))
    &&new Date(observed).toISOString().slice(0,10)===observed&&observed<target,`${patch.symbol}: missing or invalid retained observation date`);
  assert(original&&typeof original==='object'&&!Array.isArray(original),`${patch.symbol}: missing original retained chart`);
  return {original,observed};
}
export function verifyRetainedChart(chart,patch,target){
  const {original,observed}=retainedPatchSource(patch,target);
  assert.deepEqual(normalized(chart.bars),normalized(original.bars),`${patch.symbol}: retained bars changed`);
  assert.equal(chart.generated_at,original.generated_at,`${patch.symbol}: original chart clock changed`);
  assert.equal(chart.retained_price_history.observation_date,observed,`${patch.symbol}: retained observation date changed`);assert.equal(chart.retained_price_history.original_as_of_date,original.as_of_date);
  verifyUnknownRow(chart.stock_data,target);
}

// This adapter deliberately refuses execution until a separate exact binding
// is implemented and reviewed. Synthetics and #99 never satisfy the boundary.
export function requireRenewedFinancialBinding(){throw Error('Ordinary carry is unbound: independently bind the actual renewed public predecessor after A/B/C; stage-one evidence cannot authorize it');}

async function main(){
  const [phase,output,...rest]=process.argv.slice(2);assert(output&&!rest.length,'Expected PHASE OUTPUT');const root=resolve(output),scopes=join(root,'scopes'),site=join(root,'runtime/frontend/public');
  assert(['prepare','materialize','sync-home','verify'].includes(phase),'Unknown finite rehearsal phase');
  if(phase==='prepare'){const p=prepareExact(scopes,readFileSync(join(scopes,'source.json')));write(join(root,'plan.json'),p.plan);write(join(root,'prepared.json'),p.prepared);}
  if(phase==='materialize')write(join(root,'graph.json'),materializeExact(site,scopes,json(join(root,'prepared.json'))));
  if(phase==='sync-home')write(join(root,'home-sync.json'),syncRecoveryHome(site));
  if(phase==='verify')write(join(root,'validation.json'),await verifyCompiled(site,scopes,json(join(root,'prepared.json')),json(join(root,'graph.json')),join(root,'runtime/frontend')));
  console.log(JSON.stringify({phase,status:'passed',publication_authority:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
