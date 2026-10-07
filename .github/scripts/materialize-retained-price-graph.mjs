// Offline, disposable-tree preparation only. This never invokes a compiler,
// provider, publication action, financial carry, or approval/admission gate.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import producerRuntime from './fixtures/retained-price-producer-runtime.json' with {type:'json'};
import oct6ProducerRuntime from './fixtures/retained-price-producer-runtime-oct6.json' with {type:'json'};
import oct6Review from './fixtures/retained-price-recovery-oct6-inputs.json' with {type:'json'};
import unindexedOct6History from './fixtures/retained-price-recovery-oct6-unindexed-history.json' with {type:'json'};
import {RECOVERY_SCHEMA,RECOVERY_FINANCIAL_FIELDS,RECOVERY_PRESERVED_FIELDS,recoveryDigest} from './retained-price-recovery.mjs';
import {auditDailyBars} from '../../frontend/src/static/qualificationAudit.js';
import {validateResidualChart} from './complete-retained-price-quarantine.mjs';
import {applyRetainedHomeHistory,validateRetainedHomeHistory} from './retained-home-history.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const encode=value=>Buffer.from(JSON.stringify(value));
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const rowKeys=['rows','initial_rows','preview_rows','results','stocks','members'];
const groupClear=['price','price_change_1d','rs_rating','rs_rating_1m','rs_rating_3m','rs_rating_12m','composite_score','stage','price_sparkline_data','price_trend','rs_sparkline_data','rs_trend'];
const chartKeys=['schema_version','symbol','market','as_of_date','generated_at','period','bars','stock_data','rs_line','blue_dots','eps_line','vcp_boxes','buy_points','signal','risk_plan','retained_price_history'];
const preserved=new Set(RECOVERY_PRESERVED_FIELDS);
const groupBuilderSha256='d8316b2ccb45b703becaa850a674ea58aa459a687b2f57214063a502775afa6a';
const groupBuilderPath=fileURLToPath(new URL('../../backend/app/services/static_site_export_service.py',import.meta.url));
const groupInputFields=['symbol','company_name','ibd_industry_group','market_cap_usd','market_cap'];
function assertPricePreparationMode(){assert(!Object.keys(process.env).some(key=>(key.startsWith('FINANCIAL_GENERATION_CARRY_')||key.startsWith('FINANCIAL_CORRECTION_'))&&process.env[key]!==undefined),'Price graph/home edits are forbidden during the financial-only pass');}
const pointer=value=>String(value).replaceAll('~','~0').replaceAll('/','~1');
const same=(a,b)=>recoveryDigest(a)===recoveryDigest(b);
const project=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,clone(value[k])]));
function generatedAlias(path,directory,symbol){const prefix=`static-data/${directory}/${encodeURIComponent(symbol)}-`;return path.startsWith(prefix)&&/^[a-f0-9]{16}\.json$/.test(path.slice(prefix.length));}
function safeRelative(path){assert(typeof path==='string'&&/^[A-Za-z0-9._%/-]+$/.test(path)&&!path.startsWith('/')&&!/%(?:2f|5c|25|00)/i.test(path)&&path.split('/').every(p=>p&&p!=='.'&&p!=='..'),`Unsafe graph path: ${path}`);return path;}
function absolute(root,path,{missing=false}={}){
  safeRelative(path);let current=root;
  for(const part of path.split('/')){current=join(current,part);if(!existsSync(current)){assert(missing,`Missing graph dependency: ${path}`);continue;}assert(!lstatSync(current).isSymbolicLink(),`Linked graph path: ${path}`);}
  return current;
}
function readRegular(path){assert(!lstatSync(path).isSymbolicLink()&&lstatSync(path).isFile(),`Expected regular file: ${path}`);assert.equal(realpathSync(path),resolve(path),'Linked input path');return readFileSync(path);}
function inputBytes(input){if(Buffer.isBuffer(input)||input instanceof Uint8Array)return Buffer.from(input);if(input&&Object.hasOwn(input,'bytes'))return Buffer.from(input.bytes);assert.equal(typeof input,'string','Expected pinned JSON bytes or file path');return readRegular(resolve(input));}
function fieldsChanged(before,after,path=''){
  if(before===undefined||after===undefined)return [path||'/'];
  if(same(before,after))return [];
  if(!before||!after||typeof before!=='object'||typeof after!=='object'||Array.isArray(before)!==Array.isArray(after))return [path||'/'];
  const keys=new Set([...Object.keys(before),...Object.keys(after)]),out=[];
  for(const key of [...keys].sort())out.push(...fieldsChanged(before[key],after[key],`${path}/${pointer(key)}`));
  return out;
}
function unknownRow(original,patch,snapshotHash,chartPath,target){
  const row=project(original,RECOVERY_PRESERVED_FIELDS);
  Object.assign(row,{as_of_date:target,current_price:null,price_change_1d:null,adv_usd:null,volume:null,
    rs_rating:null,source_rs_rating:null,rs_method:null,rs_as_of_date:null,rs_universe_size:null,
    passes_template:null,se_pivot_price:null,vcp_pivot:null,se_setup_ready:false,vcp_detected:false,vcp_ready_for_breakout:false,chart_path:chartPath,
    setup_recalculation:{status:'unavailable',as_of_date:target,reason:`Retained history ends ${patch.snapshot.actual_observation_date}; ${target} close unverified`},
    retained_price_history:{status:'stale_reference_only',observation_date:patch.snapshot.actual_observation_date,target_as_of_date:target,
      reason:patch.row?.retained_price_history?.reason??'missing_history',snapshot_sha256:snapshotHash,financial_carry_required:true,
      financial_input_sha256:recoveryDigest(project(original,RECOVERY_FINANCIAL_FIELDS))}});
  return row;
}
function rejectAffectedTopSymbols(value,symbols){
  if(!value||typeof value!=='object')return;
  assert(!symbols.has(value.top_symbol),'Affected group leader requires separate aggregate recalculation');
  for(const [key,item]of Object.entries(value))if(key!=='stocks')rejectAffectedTopSymbols(item,symbols);
}
function replaceRows(payload,replacements){
  const result=clone(payload);
  for(const key of rowKeys)if(Array.isArray(result[key]))result[key]=result[key].map(row=>replacements.has(row?.symbol)?clone(replacements.get(row.symbol)):row);
  return result;
}

export function validateRecoveryRestorationMode(source){
  if(source.mode==='normal-candidate')return; // Existing Pages restoration contract is unchanged.
  assert.equal(source.mode,'checked-export','Unsupported restoration input kind');
  const proof=source.checked_export,pin=oct6Review.candidate;
  assert.equal(source.publication,null,'Checked export cannot claim a publication receipt');
  assert(!Object.hasOwn(source.files??{},'publication.json'),'Checked export cannot borrow a publication.json');
  assert.equal(proof?.schema_version,'retained-price-checked-export-input-v1');assert.equal(proof.publication_authority,false);
  assert.equal(proof.repository,'kusennjp1-ai/screener');
  for(const [key,value] of Object.entries({run_id:pin.run_id,run_attempt:pin.run_attempt,head_sha:pin.head_sha,artifact_id:pin.artifact_id,artifact_name:pin.artifact_name}))assert.equal(proof[key],value,`Checked-export origin changed: ${key}`);
  assert.deepEqual(proof.archive,{bytes:pin.bytes,sha256:pin.sha256});assert.equal(source.archive?.bytes,pin.bytes);assert.equal(source.archive.sha256,pin.sha256);
  assert.equal(proof.companion?.artifact_id,pin.companion_artifact_id);assert.equal(proof.companion.bytes,pin.companion_bytes);assert.equal(proof.companion.sha256,pin.companion_sha256);
  assert.equal(proof.companion.source_json_sha256,pin.retained_source_json_sha256);assert.equal(proof.companion.source_json_bytes,376233);
  assert.equal(proof.manifest?.sha256,pin.manifest_sha256);assert.deepEqual(source.files['static-data/manifest.json'],proof.manifest,'Checked-export manifest inventory changed');
  assert(validHash(proof.api_evidence?.sha256)&&Number.isSafeInteger(proof.api_evidence.bytes)&&proof.api_evidence.bytes>0&&proof.api_evidence.bytes<=64*1024*1024,'Unbound checked-export API evidence');
  assert.equal(proof.complete_inventory_required,true);assert.equal(source.restoredFiles,19480);assert.equal(source.restoredBytes,1876607954);
  assert.equal(Object.keys(source.files).length,source.restoredFiles,'Incomplete checked-export restoration inventory');
  assert.equal(Object.values(source.files).reduce((total,file)=>{assert(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&validHash(file.sha256),'Invalid checked-export inventory entry');return total+file.bytes;},0),source.restoredBytes,'Checked-export inventory byte total changed');
}

export function validateUnindexedOct6HistoryBinding(source,target,file,reference){
  const pin=unindexedOct6History;
  assert(source.mode==='checked-export'&&source.archive.sha256===pin.archive_sha256&&target===pin.target_as_of_date&&file===pin.path,`Unindexed active history payload: ${file}`);
  assert.deepEqual(reference,{bytes:pin.bytes,sha256:pin.sha256},'Unindexed original history bytes changed');
  return `static-data/retained-price-repair-audit/history/unindexed/${pin.sha256}.json.gz`;
}

/** root is the full restoration directory (it contains static-data/). Each
 * supplied digest pins exact bytes, not a re-serialized approximation.
 * All dependency checks finish before staging starts. A write failure can leave
 * a partial DISPOSABLE tree, but never yields a completion receipt. */
export function materializeRecoveryGraph({root,prepared,expectedPreparedSha256,sourceReceiptPath,sourceReceiptSha256,previousSelectionCatalog,previousPerformanceCatalog,aggregateProof}){
  assertPricePreparationMode();
  root=resolve(root);assert(lstatSync(root).isDirectory()&&!lstatSync(root).isSymbolicLink(),'Expected disposable restoration directory');assert.equal(realpathSync(root),root,'Linked restoration root');
  const receiptPath=resolve(sourceReceiptPath),receiptRaw=readRegular(receiptPath);assert(validHash(sourceReceiptSha256)&&sha(receiptRaw)===sourceReceiptSha256,'Restoration receipt SHA256 mismatch');
  assert(receiptPath===join(root,'retained-price-restoration-receipt.json'),'Receipt must belong to the disposable restored tree');
  const source=JSON.parse(receiptRaw);assert.equal(source.schema_version,'retained-price-candidate-restoration-v1');
  for(const key of ['publication_authority','ready_to_publish','fullSiteVerified'])assert.equal(source[key],false,`Unexpected restoration authority: ${key}`);
  validateRecoveryRestorationMode(source);assert(source.files&&typeof source.files==='object','Missing restoration inventory');
  const archive=resolve(source.archive.path);assert(archive!==root&&!archive.startsWith(root+sep),'Original archive must be outside the disposable tree');
  if(typeof prepared==='string')assert(!resolve(prepared).startsWith(root+sep),'Prepared evidence must be outside the disposable tree');
  const preparedRaw=inputBytes(prepared);assert(validHash(expectedPreparedSha256)&&sha(preparedRaw)===expectedPreparedSha256,'Prepared SHA256 mismatch');
  const input=JSON.parse(preparedRaw);assert.equal(input.schema_version,RECOVERY_SCHEMA);assert.equal(input.publication_authority,false);assert.equal(input.requires_full_rebuild,true);assert.equal(input.requires_financial_carry,true);
  assert(validDay(input.target_as_of_date),'Invalid recovery target');const target=input.target_as_of_date;
  assert(Array.isArray(input.patches)&&input.patches.length,'Missing recovery patches');
  const used=new Map(),writes=new Map(),removals=new Set(),mutations=[],deltas=[];
  function read(path){safeRelative(path);const ref=source.files[path];assert(ref&&validHash(ref.sha256)&&Number.isSafeInteger(ref.bytes),`Unbound source dependency: ${path}`);const raw=readRegular(absolute(root,path));assert.equal(raw.length,ref.bytes,`Source size mismatch: ${path}`);assert.equal(sha(raw),ref.sha256,`Source SHA256 mismatch: ${path}`);used.set(path,{bytes:raw.length,sha256:sha(raw)});return raw;}
  const json=path=>JSON.parse(read(path));
  const data=path=>'static-data/'+safeRelative(path);
  function planWrite(path,value,{raw=false,before,reason}={}){
    safeRelative(path);assert(!writes.has(path)&&!removals.has(path),`Conflicting planned mutation: ${path}`);
    const old=source.files[path]?read(path):null;
    if(!old)assert(!existsSync(absolute(root,path,{missing:true})),`Untracked output exists: ${path}`);
    const bytes=raw?Buffer.from(value):encode(value);
    if(old?.equals(bytes))return;
    const fields=raw?['/']:(old?fieldsChanged(before??JSON.parse(old),value):['/']);
    writes.set(path,()=>bytes);mutations.push({path,operation:old?'replace':'create',reason,fields,before_sha256:old?sha(old):null,after_sha256:sha(bytes),bytes:bytes.length});
  }
  function planJsonTransform(path,transform,reason){
    const before=json(path),after=transform(before);if(same(before,after))return;
    const fields=fieldsChanged(before,after),bytes=encode(after),ref=used.get(path);
    assert(!writes.has(path),'Duplicate planned transform');
    // Store a recipe, not all six large scan chunks, until dependency preflight
    // has completed. Each source is read/hash-checked again during staging.
    writes.set(path,()=>encode(transform(JSON.parse(read(path)))));
    mutations.push({path,operation:'replace',reason,fields,before_sha256:ref.sha256,after_sha256:sha(bytes),bytes:bytes.length});
  }
  const manifest=json(data('manifest.json')),market=manifest.markets?.US;
  assert(market&&market.as_of_date===target,'Manifest target mismatch');
  for(const key of ['scan','groups','home'])if(manifest.pages?.[key]?.path)assert.equal(manifest.pages[key].path,market.pages?.[key]?.path,`Unsupported conflicting root/US ${key} alias`);
  if(market.pages?.home?.path){const home=json(data(market.pages.home.path));assert.equal(home.as_of_date,target,'Original home target mismatch');assert(home.scan_summary&&typeof home.scan_summary==='object','Missing original home scan summary');}
  const scanPath=data(market.pages?.scan?.path),scan=json(scanPath);assert.equal(scan.as_of_date,target,'Scan target mismatch');
  assert(Array.isArray(scan.chunks),'Missing full scan chunk references');
  const chunkPaths=scan.chunks.map(ref=>data(ref.path));assert.equal(new Set(chunkPaths).size,chunkPaths.length,'Duplicate full scan chunk path');
  const patches=new Map();for(const patch of input.patches){assert(patch&&typeof patch.symbol==='string'&&patch.symbol&&!patches.has(patch.symbol),'Duplicate/invalid recovery symbol');patches.set(patch.symbol,patch);}
  const residual=new Map();
  if(input.residual_current_review){const review=input.residual_current_review;
    assert.equal(review.schema_version,'retained-price-residual-application-v1');assert.equal(review.publication_authority,false);assert.equal(review.ready_to_publish,false);
    assert(validHash(review.review_sha256)&&validHash(review.source_observations_sha256),'Invalid residual review bindings');
    assert.equal(review.residual_after,0);assert(Array.isArray(review.records)&&review.records.length===review.residual_before,'Residual review count mismatch');
    for(const record of review.records){assert(record&&typeof record.symbol==='string'&&!residual.has(record.symbol),'Duplicate residual review symbol');residual.set(record.symbol,record);}
    assert.equal(review.stale_histories,review.records.filter(record=>record.observation_date!==null).length);assert.equal(review.undated_rows,review.records.filter(record=>record.observation_date===null).length);
  }
  function validateResidual(item){const binding=residual.get(item.symbol),snapshot=item.snapshot;
    assert(binding&&item.history_origin==='candidate_current_quarantine','Unsupported residual expansion');
    assert.equal(snapshot?.schema_version,'retained-price-residual-snapshot-v1');assert.equal(snapshot.publication_authority,false);
    assert.equal(snapshot.review_sha256,input.residual_current_review.review_sha256);assert.equal(snapshot.source_observations_sha256,input.residual_current_review.source_observations_sha256);
    assert.equal(recoveryDigest(snapshot),binding.snapshot_sha256,'Residual snapshot binding mismatch');assert.equal(recoveryDigest(snapshot.candidate_row),binding.candidate_row_sha256,'Residual original row binding mismatch');
    assert.equal(item.candidate_row_sha256,binding.candidate_row_sha256);assert.equal(item.observation_date,binding.observation_date);assert.equal(snapshot.actual_observation_date,binding.observation_date);assert.equal(item.reason,binding.reason);
    assert.equal(snapshot.candidate_row.symbol,item.symbol);assert.equal(snapshot.candidate_row.as_of_date,target);assert.equal(snapshot.candidate_row.technical_audit?.valid,false);
    return binding;
  }
  for(const patch of patches.values())if(patch.history_origin==='candidate_current_quarantine')validateResidual(patch);
  const quarantines=new Map();
  assert(input.row_quarantines==null||Array.isArray(input.row_quarantines),'Invalid row quarantine list');
  for(const item of input.row_quarantines??[]){if(item?.history_origin==='candidate_current_quarantine')validateResidual(item);else assert.equal(item?.symbol,'EQR','Only the separately reviewed EQR row quarantine is supported');assert(item&&typeof item.symbol==='string'&&item.symbol&&!patches.has(item.symbol)&&!quarantines.has(item.symbol),'Duplicate/overlapping row quarantine');quarantines.set(item.symbol,item);}
  const restoredResearch=new Set([...patches].filter(([,p])=>p.row!==null).map(([symbol])=>symbol));
  const affected=new Set([...restoredResearch,...quarantines.keys()]);
  assert.deepEqual([...residual.keys()].sort(),[...patches.values(),...quarantines.values()].filter(item=>item.history_origin==='candidate_current_quarantine').map(item=>item.symbol).sort(),'Residual review and mutations differ');
  const rows=new Map(),rowDigests=new Map(),fullGroupInputs=new Map(),authoritative=new Set();
  function gather(payload,path,primary){
    assert.equal(payload.as_of_date,target,`Full scan date mismatch: ${path}`);
    const authoritativeRows=primary?(payload.rows??payload.initial_rows):null;
    if(primary)assert(Array.isArray(authoritativeRows),`Missing authoritative full rows: ${path}`);
    for(const row of authoritativeRows??[]){assert(row&&typeof row.symbol==='string'&&row.symbol,'Invalid full row identity');const digest=recoveryDigest(row);assert(!rowDigests.has(row.symbol)||rowDigests.get(row.symbol)===digest,`Conflicting authoritative duplicate: ${row.symbol}`);rowDigests.set(row.symbol,digest);fullGroupInputs.set(row.symbol,project(row,groupInputFields));authoritative.add(row.symbol);if(affected.has(row.symbol))rows.set(row.symbol,clone(row));}
  }
  if(!chunkPaths.length)gather(scan,scanPath,true);
  for(const path of chunkPaths)gather(json(path),path,true);
  // The compiler consumes scan.rows (or initial_rows) as authoritative repeats.
  // Preview/list aliases can legitimately be compact, and are replaced below.
  const repeated=scan.rows??scan.initial_rows??[];
  for(const row of repeated){assert(authoritative.has(row.symbol),`Scan alias is outside the full universe: ${row.symbol}`);assert.equal(recoveryDigest(row),rowDigests.get(row.symbol),`Conflicting authoritative duplicate: ${row.symbol}`);}
  assert.equal(rows.size,affected.size,'Affected research row missing from full scan');
  for(const [symbol,patch]of patches)assert.equal(authoritative.has(symbol),patch.row!==null,`Index-only/research membership mismatch: ${symbol}`);
  if(Number.isInteger(scan.rows_total))assert.equal(authoritative.size,scan.rows_total,'Full scan row count mismatch');
  const indexPaths=[...new Set([data(market.assets?.charts?.path),data(manifest.assets?.charts?.path??'markets/us/charts/index.json'),data('markets/us/charts/index.json'),...(scan.charts?.path?[data(scan.charts.path)]:[])])];
  const indices=new Map(),aliases=new Map([...patches].map(([symbol])=>[symbol,new Set()]));
  for(const path of indexPaths){const index=json(path);assert(Array.isArray(index.symbols),'Missing chart index entries');const symbols=new Set(),paths=new Set();
    for(const item of index.symbols){assert(item&&typeof item.symbol==='string'&&!symbols.has(item.symbol),'Duplicate chart index symbol');safeRelative(item.path);assert(!paths.has(item.path),'Duplicate chart index path');symbols.add(item.symbol);paths.add(item.path);if(patches.has(item.symbol))aliases.get(item.symbol).add(data(item.path));}
    assert.equal(index.symbols_total,index.symbols.length,'Chart index count mismatch');indices.set(path,index);
  }
  const activeSymbols=[...indices.values()][0].symbols.map(item=>item.symbol).sort();
  for(const symbol of quarantines.keys())assert(!activeSymbols.includes(symbol),'Row-only quarantine must not have an indexed chart');
  for(const index of indices.values())assert.deepEqual(index.symbols.map(item=>item.symbol).sort(),activeSymbols,'Chart index aliases disagree about membership');
  for(const [symbol,row]of rows)if(patches.has(symbol)&&row.chart_path)aliases.get(symbol).add(data(row.chart_path));
  // Canonical exporter names plus all index/full-row aliases close the chart
  // dependency graph. Scan every conventionally named affected alias, including
  // generated aliases no longer selected by either index.
  for(const path of Object.keys(source.files))for(const symbol of patches.keys()){
    const escaped=encodeURIComponent(symbol);
    if(path===data(`markets/us/charts/${escaped}.json`)||generatedAlias(path,'verified-charts',symbol))aliases.get(symbol).add(path);
  }
  const replacements=new Map(),charts=new Map(),chartPaths=new Map();
  for(const [symbol,patch]of patches){
    assert(patch.snapshot&&patch.chart&&patch.chart.symbol===symbol,'Invalid prepared chart patch');assert.equal(patch.snapshot.publication_authority,false);
    const residualHistory=patch.history_origin==='candidate_current_quarantine';
    const historicalChart=residualHistory?patch.snapshot.original_candidate_chart:patch.snapshot.prior_chart;
    if(residualHistory){validateResidualChart(historicalChart,patch.snapshot.candidate_row,patch.observation_date,target);assert.equal(recoveryDigest(historicalChart),residual.get(symbol).candidate_chart_sha256,'Reviewed residual chart differs');}
    assert.equal(recoveryDigest(historicalChart),patch.historical_chart_sha256,'Historical chart binding mismatch');
    assert.equal(recoveryDigest(patch.chart.bars),patch.bars_sha256,'Prepared bar binding mismatch');assert.deepEqual(patch.chart.bars,historicalChart.bars,'Prepared bars differ from prior actual bytes');
    assert.equal(recoveryDigest(patch.snapshot),patch.chart.retained_price_history.snapshot_sha256,'Prepared snapshot binding mismatch');
    assert.equal(patch.snapshot.actual_observation_date,patch.chart.retained_price_history.observation_date,'Observation identity mismatch');
    assert(validDay(patch.snapshot.actual_observation_date)&&patch.snapshot.actual_observation_date<target,'Retained observation must remain stale');
    assert.equal(patch.chart.retained_price_history.target_as_of_date,target,'Prepared target differs');
    const originalDate=historicalChart.as_of_date;assert([originalDate,target].includes(patch.chart.as_of_date),'Unexpected prepared chart envelope');
    assert.equal(patch.chart.generated_at,historicalChart.generated_at,'Original capture clock changed');
    assert.equal(patch.chart.retained_price_history.original_as_of_date,originalDate,'Original analysis date changed');
    const original=rows.get(symbol);if(original){assert.equal(original.market,'US');assert.equal(original.as_of_date,target);for(const key of ['symbol','market','currency','exchange','company_name'])assert.deepEqual(original[key],patch.row[key],`Full/prepared identity mismatch: ${symbol}.${key}`);}
    const oldAliases={};for(const path of aliases.get(symbol)){const value=json(path);assert.equal(value.symbol,symbol,`Chart alias identity mismatch: ${path}`);assert(Array.isArray(value.bars),'Invalid original chart alias');oldAliases[path]=value;}
    if(residualHistory){assert(original?.chart_path,'Residual original chart path missing');assert.equal(recoveryDigest(json(data(original.chart_path))),recoveryDigest(historicalChart),'Restored residual chart differs from reviewed original');}
    const oldDetails={};
    const detailPaths=new Set(original?.research_detail_path?[data(original.research_detail_path)]:[]);
    for(const path of Object.keys(source.files))if(generatedAlias(path,'research-details',symbol))detailPaths.add(path);
    for(const path of detailPaths){const value=json(path);assert.equal(value.symbol,symbol,`Detail alias identity mismatch: ${path}`);oldDetails[path]=value;}
    const snapshot={schema_version:'retained-price-materialization-snapshot-v1',publication_authority:false,prepared_sha256:expectedPreparedSha256,
      prepared_snapshot:clone(patch.snapshot),rejected_candidate_full_row:original??null,rejected_candidate_chart_aliases:oldAliases,rejected_candidate_detail_aliases:oldDetails};
    const snapshotHash=recoveryDigest(snapshot),snapshotPath=`retained-price-history/${snapshotHash}.json`,chartPath=`retained-price-charts/${snapshotHash}.json`;
    const chart=project(patch.chart,chartKeys);Object.assign(chart,{market:'US',as_of_date:target,bars:clone(historicalChart.bars),
      rs_line:[],blue_dots:[],eps_line:[],vcp_boxes:[],buy_points:[],signal:null,risk_plan:null,
      retained_price_history:{...clone(patch.chart.retained_price_history),original_as_of_date:originalDate,snapshot_path:snapshotPath,snapshot_sha256:snapshotHash}});
    const stock=original??project(historicalChart.stock_data??{symbol,market:'US'},RECOVERY_PRESERVED_FIELDS.filter(k=>!RECOVERY_FINANCIAL_FIELDS.includes(k)));
    const current=unknownRow(stock,patch,snapshotHash,chartPath,target);current.technical_audit=auditDailyBars(current,chart,target);assert.equal(current.technical_audit.valid,false,'Retained old bars cannot certify a current close');chart.stock_data=clone(current);
    if(original){for(const key of RECOVERY_FINANCIAL_FIELDS){assert.equal(Object.hasOwn(current,key),Object.hasOwn(original,key),`Changed financial absence: ${symbol}.${key}`);if(Object.hasOwn(original,key))assert.deepEqual(current[key],original[key],`Changed financial input: ${symbol}.${key}`);}replacements.set(symbol,current);}
    charts.set(symbol,chart);chartPaths.set(symbol,chartPath);
    planWrite(data(snapshotPath),snapshot,{reason:'immutable_rejected_graph_evidence'});planWrite(data(chartPath),chart,{reason:'stable_retained_chart_input'});
    for(const path of aliases.get(symbol))planWrite(path,chart,{reason:'replace_complete_affected_chart_alias'});
    for(const path of detailPaths)planWrite(path,current,{reason:'replace_complete_affected_detail_alias'});
    deltas.push({symbol,prepared_chart_as_of_date:patch.chart.as_of_date,materialized_chart_as_of_date:target,original_as_of_date:originalDate,
      prepared_snapshot_sha256:patch.chart.retained_price_history.snapshot_sha256,snapshot_sha256:snapshotHash,chart_path:chartPath,
      financial_input_sha256:original?current.retained_price_history.financial_input_sha256:null,
      discarded_candidate_fields:original?Object.keys(original).filter(k=>!preserved.has(k)).sort():[]});
  }
  for(const [symbol,item]of quarantines){
    const original=rows.get(symbol);assert(original&&original.chart_path==null,'Row-only quarantine requires a chartless original full row');
    assert.equal(item.reason,'undated_price_without_chart','Unsupported row quarantine reason');assert.equal(item.observation_date,null,'Row quarantine cannot assert a dated observation');
    const residualRow=item.history_origin==='candidate_current_quarantine';
    if(residualRow){const binding=validateResidual(item);assert.equal(binding.observation_date,null);assert.equal(binding.candidate_chart_sha256,null);assert.equal(item.snapshot.original_candidate_chart,null);assert.equal(item.snapshot.candidate_row.technical_audit.bars,0);assert.equal(item.snapshot.candidate_row.chart_path,null);}
    else assert.equal(item.snapshot?.schema_version,'retained-price-row-quarantine-snapshot-v1');assert.equal(item.snapshot?.publication_authority,false);
    assert.equal(recoveryDigest(item.snapshot.candidate_row),item.candidate_row_sha256,'Quarantine candidate binding mismatch');if(!residualRow)assert.equal(recoveryDigest(item.snapshot.prior_row),item.prior_row_sha256,'Quarantine prior binding mismatch');
    assert.equal(original.as_of_date,target);for(const key of ['symbol','market','currency','exchange','company_name'])assert.deepEqual(original[key],item.row?.[key],`Full/quarantine identity mismatch: ${symbol}.${key}`);
    assert.equal(item.row.chart_path,null,'Quarantine must not invent a chart path');
    const oldDetails={},detailPaths=new Set(original.research_detail_path?[data(original.research_detail_path)]:[]);
    for(const path of Object.keys(source.files)){
      assert(!(path===data(`markets/us/charts/${encodeURIComponent(symbol)}.json`)||generatedAlias(path,'verified-charts',symbol)),'Row-only quarantine has an unindexed chart payload requiring separate review');
      if(generatedAlias(path,'research-details',symbol))detailPaths.add(path);
    }
    for(const path of detailPaths){const value=json(path);assert.equal(value.symbol,symbol,'Quarantine detail alias identity mismatch');oldDetails[path]=value;}
    const snapshot={schema_version:'retained-price-materialization-quarantine-snapshot-v1',publication_authority:false,prepared_sha256:expectedPreparedSha256,
      prepared_snapshot:clone(item.snapshot),rejected_candidate_full_row:clone(original),rejected_candidate_detail_aliases:oldDetails};
    const snapshotHash=recoveryDigest(snapshot),snapshotPath=`retained-price-repair-audit/quarantines/${snapshotHash}.json`;
    const current=unknownRow(original,{snapshot:{actual_observation_date:null},row:null},snapshotHash,null,target);delete current.retained_price_history;
    current.setup_recalculation={status:'unavailable',as_of_date:target,reason:item.reason};
    current.price_quarantine={observation_date:null,status:'unverified_observation',target_as_of_date:target,reason:item.reason,financial_carry_required:true,snapshot_path:snapshotPath,snapshot_sha256:snapshotHash,financial_input_sha256:recoveryDigest(project(original,RECOVERY_FINANCIAL_FIELDS))};
    current.technical_audit=auditDailyBars(current,null,target);assert.equal(current.technical_audit.valid,false);
    replacements.set(symbol,current);planWrite(data(snapshotPath),snapshot,{reason:'immutable_rejected_row_only_quarantine_evidence'});
    for(const path of detailPaths)planWrite(path,current,{reason:'replace_complete_quarantined_detail_alias'});
    deltas.push({symbol,kind:'row_only_quarantine',observation_date:null,chart_path:null,snapshot_path:snapshotPath,snapshot_sha256:snapshotHash,financial_input_sha256:current.price_quarantine.financial_input_sha256,discarded_candidate_fields:Object.keys(original).filter(key=>!preserved.has(key)).sort()});
  }
  for(const path of [scanPath,...chunkPaths])planJsonTransform(path,before=>replaceRows(before,replacements),'replace_full_scan_row_aliases');
  const totals=[];
  for(const [path,index]of indices){const updated=clone(index),seen=new Set();updated.symbols=updated.symbols.map(item=>{seen.add(item.symbol);return patches.has(item.symbol)?{symbol:item.symbol,path:chartPaths.get(item.symbol)}:item;});
    for(const [symbol]of patches)if(!seen.has(symbol))updated.symbols.push({symbol,path:chartPaths.get(symbol)});
    updated.symbols_total=updated.symbols.length;
    if(Array.isArray(updated.skipped_symbols))updated.skipped_symbols=updated.skipped_symbols.filter(symbol=>!patches.has(symbol));
    planWrite(path,updated,{before:index,reason:'chart_payload_availability_only'});totals.push(updated.symbols_total);
  }
  assert(totals.every(n=>n===totals[0]),'Repaired chart aliases have inconsistent totals');
  const manifestAfter=clone(manifest);manifestAfter.markets.US.assets.charts.symbols_total=totals[0];manifestAfter.assets??={};manifestAfter.assets.charts??={path:'markets/us/charts/index.json'};manifestAfter.assets.charts.symbols_total=totals[0];
  planWrite(data('manifest.json'),manifestAfter,{before:manifest,reason:'chart_payload_availability_count'});
  // Fold chart totals into the already planned full scan mutation.
  const previousScanWrite=writes.get(scanPath),scanAfter=previousScanWrite?JSON.parse(previousScanWrite()):clone(scan);
  scanAfter.charts??={};scanAfter.charts.symbols_total=totals[0];
  if(previousScanWrite){writes.delete(scanPath);mutations.splice(mutations.findIndex(item=>item.path===scanPath),1);}
  planWrite(scanPath,scanAfter,{before:scan,reason:'full_scan_aliases_and_chart_payload_count'});

  if(!source.files[data('financial-history.json')])planWrite(data('financial-history.json'),{as_of_date:target,results:{}},{reason:'explicit_unavailable_financial_history_before_carry_baseline'});

  // Aggregate preservation is fail-closed. A caller must provide independently
  // checked, source-bound dependency equivalence, not just a claim that RS is
  // null. The exact proof contract is validated below.
  const groupsPath=market.pages?.groups?.path?data(market.pages.groups.path):null;
  let groupProof=null;
  if(groupsPath){
    const groupsRaw=read(groupsPath),groups=JSON.parse(groupsRaw);
    const recalculate=aggregateProof?.schema_version==='retained-price-aggregate-correction-v1',after=repairedGroups(groups,affected,fullGroupInputs,{recalculate});
    const homePath=market.pages?.home?.path?data(market.pages.home.path):null;
    assert(homePath,'Groups proof requires the source home payload');const homeRaw=read(homePath);
    const references=[...new Set([market.assets?.groups_rrg?.path,manifest.assets?.groups_rrg?.path].filter(Boolean))].map(path=>{const raw=read(data(path));return {path:data(path),bytes:raw.length,sha256:sha(raw),observation_scope:'original_dated_database_rank_and_taxonomy_stream_not_recalculated'};});
    assert(aggregateProof,'Aggregate dependency proof required; offline recalculation remains pending');
    assert(['retained-price-aggregate-equivalence-v1','retained-price-aggregate-correction-v1'].includes(aggregateProof.schema_version),'Unsupported aggregate proof');
    assert.equal(aggregateProof.groups_sha256,sha(groupsRaw),'Aggregate proof source hash mismatch');
    assert.equal(aggregateProof.home_sha256,sha(homeRaw),'Aggregate proof home hash mismatch');
    groupProof=aggregateEquivalence({groupsRaw,groupsPath,homeRaw,homePath,affected,fullGroupInputs,rowDigests,references,recalculate,
      producerRuntimeReview:source.archive.sha256==='e52fd2d3c70e695730ad97d3074b4bd0ca5e67418c10aef0ab4dce2671bef46f'?oct6ProducerRuntime:producerRuntime});
    assert.deepEqual(aggregateProof,groupProof,'Aggregate dependency proof differs from the complete source-bound before/after vectors');
    planWrite(`static-data/retained-price-repair-audit/groups/${sha(groupsRaw)}.json`,groupsRaw,{raw:true,reason:'immutable_exact_original_group_alias_evidence'});
    if(recalculate){
      for(const change of groupProof.contributor_changes)assert(residual.has(change.symbol)&&residual.get(change.symbol).observation_date!==null,'Group correction requires an exact reviewed stale candidate history');
      applyGroupRankingAliases(after,groupProof.replacement_rankings);
      const home=JSON.parse(homeRaw),homeAfter={...clone(home),top_groups:clone(groupProof.replacement_rankings.slice(0,10))};
      assert.equal(recoveryDigest(after),groupProof.corrected_groups_sha256);assert.equal(recoveryDigest(homeAfter),groupProof.corrected_home_sha256);
      if(!same(home,homeAfter)){planWrite(`static-data/retained-price-repair-audit/groups/${sha(homeRaw)}-home.json`,homeRaw,{raw:true,reason:'immutable_original_home_group_alias'});planWrite(homePath,homeAfter,{before:home,reason:'recomputed_current_group_rank_aliases'});}
    }
    planWrite(groupsPath,after,{before:groups,reason:recalculate?'recompute_exact_changed_group_dependencies':'clear_and_resort_affected_group_member_current_price_technicals'});
  }
  if(input.home_history){
    const patch=input.home_history,path=data(market.pages.home.path),originalRaw=read(path);
    validateRetainedHomeHistory(patch,{candidateHomeBytes:originalRaw,targetAsOfDate:target});
    assert.equal(patch.candidate_home.path,market.pages.home.path,'Home-history path differs from manifest');
    assert.equal(patch.source_manifest_sha256,sha(read(data('manifest.json'))),'Home-history source manifest differs');
    const pending=writes.get(path),before=JSON.parse(originalRaw),current=pending?JSON.parse(pending()):before;
    const after=applyRetainedHomeHistory(current,patch);
    planWrite(data(patch.snapshot_path),Buffer.from(patch.prior_home.raw_utf8),{raw:true,reason:'immutable_exact_prior_home_history'});
    planWrite(data(patch.rejected_snapshot_path),originalRaw,{raw:true,reason:'immutable_exact_rejected_home_history'});
    if(pending){writes.delete(path);mutations.splice(mutations.findIndex(item=>item.path===path),1);}
    planWrite(path,after,{before,reason:'retain_exact_dated_home_history_and_compose_group_aliases'});
  }
  const history=[];
  for(const [directory,listKey,pinned]of [['candidate-history','snapshots',previousSelectionCatalog],['candidate-performance-history','cohorts',previousPerformanceCatalog]]){
    assert(pinned&&validHash(pinned.sha256),'Pinned prior history catalog is required');const previous=Buffer.from(pinned.bytes);assert.equal(sha(previous),pinned.sha256,'Prior history catalog SHA256 mismatch');
    const previousIndex=JSON.parse(previous),path=data(`${directory}/index.json`),currentBytes=read(path),current=JSON.parse(currentBytes);
    assert.equal(previousIndex.schema_version,1);assert.equal(current.schema_version,1);assert(Array.isArray(previousIndex[listKey])&&Array.isArray(current[listKey]),'Invalid history catalog');
    function refs(index){const result=new Map();for(const ref of index[listKey]){safeRelative(ref.path);assert(ref.path.startsWith(directory+'/')&&ref.path!==directory+'/index.json'&&validHash(ref.sha256)&&!result.has(ref.path),'Invalid/duplicate history reference');result.set(ref.path,ref);}return result;}
    const priorRefs=refs(previousIndex),currentRefs=refs(current);for(const [refPath,ref]of priorRefs){assert(currentRefs.has(refPath),'Prior snapshot missing from restored catalog');assert.deepEqual(currentRefs.get(refPath),ref,'Prior snapshot reference changed');assert.equal(sha(read(data(refPath))),ref.sha256,'Prior raw snapshot SHA256 mismatch');}
    const excluded=[];for(const [refPath,ref]of currentRefs)if(!priorRefs.has(refPath)){const raw=read(data(refPath));assert.equal(sha(raw),ref.sha256,'Rejected snapshot raw SHA256 mismatch');const evidence=`static-data/retained-price-repair-audit/history/snapshots/${sha(raw)}.json.gz`;planWrite(evidence,raw,{raw:true,reason:'immutable_rejected_history_evidence'});removals.add(data(refPath));mutations.push({path:data(refPath),operation:'remove',reason:'remove_unpublished_history_from_active_namespace',fields:['/'],before_sha256:sha(raw),after_sha256:null,bytes:0});excluded.push({path:refPath,bytes:raw.length,sha256:ref.sha256,evidence_path:evidence});}
    // The actual export contains one unindexed prepublication snapshot. Preserve
    // its exact raw bytes only in audit; every other unindexed file still fails.
    for(const file of Object.keys(source.files).filter(p=>p.startsWith(data(directory)+'/')&&p!==path))if(!currentRefs.has(file.slice('static-data/'.length))){
      const raw=read(file),reference={bytes:raw.length,sha256:sha(raw)},evidence=validateUnindexedOct6HistoryBinding(source,target,file,reference);
      planWrite(evidence,raw,{raw:true,reason:'immutable_exact_unindexed_prepublication_history'});removals.add(file);
      mutations.push({path:file,operation:'remove',reason:'quarantine_exact_unindexed_prepublication_history',fields:['/'],before_sha256:reference.sha256,after_sha256:null,bytes:0});
      excluded.push({path:file.slice('static-data/'.length),...reference,evidence_path:evidence,reason:'unindexed_prepublication_history_only'});
    }
    const catalogEvidence=`static-data/retained-price-repair-audit/history/catalogs/${sha(currentBytes)}.json`;
    planWrite(catalogEvidence,currentBytes,{raw:true,reason:'immutable_exact_rejected_history_catalog'});
    planWrite(path,previous,{raw:true,reason:'restore_exact_previous_approved_catalog'});history.push({directory,prior_catalog_sha256:pinned.sha256,retained_references:priorRefs.size,rejected_catalog:{path,bytes:currentBytes.length,sha256:sha(currentBytes),evidence_path:catalogEvidence},excluded});
  }
  const ledger=input.ledger_only_absences??[];for(const key of ledger){const [m,type,symbol]=JSON.parse(key);assert.equal(m,'US');assert.equal(type,'chart');assert(!patches.has(symbol)&&!activeSymbols.includes(symbol),'Ledger-only absence gained chart authority');}
  // No mutation before this line: all graph identities, hashes, duplicates,
  // aggregate proof, and both complete history catalogs have been checked.
  const staging=mkdtempSync(join(dirname(root),'.retained-price-materialize-'));
  try{
    for(const [path,produce]of writes){const bytes=produce(),entry=mutations.find(m=>m.path===path);assert.equal(sha(bytes),entry.after_sha256,'Staged output differs from preflight');const dest=absolute(staging,path,{missing:true});mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,bytes,{flag:'wx'});}
    // Recheck every used original byte immediately before committing staged
    // replacements. This also leaves the pinned restoration receipt unchanged.
    for(const path of used.keys())read(path);
    assert.equal(sha(readRegular(receiptPath)),sourceReceiptSha256,'Restoration receipt changed during materialization');
    for(const path of writes.keys()){const dest=absolute(root,path,{missing:true});mkdirSync(dirname(dest),{recursive:true});renameSync(absolute(staging,path),dest);}
    for(const path of removals)unlinkSync(absolute(root,path));
  }finally{rmSync(staging,{recursive:true,force:true});}
  return {schema_version:'retained-price-graph-materialization-v1',publication_authority:false,ready_to_publish:false,full_compiler_passed:false,
    financial_success_claim:false,quality_success_claim:false,scope:'disposable_unpublished_compiler_inputs_only',target_as_of_date:target,
    source_restoration_receipt_sha256:sourceReceiptSha256,prepared_sha256:expectedPreparedSha256,archive:clone(source.archive),
    affected_research_rows:affected.size,restored_research_rows:restoredResearch.size-[...residual.values()].filter(row=>row.observation_date!==null).length,quarantined_research_rows:quarantines.size,stale_candidate_histories:[...residual.values()].filter(row=>row.observation_date!==null).length,residual_current_rows:residual.size,chart_index_only:patches.size-restoredResearch.size,retained_chart_payloads:patches.size,chart_members_total:totals[0],ledger_only_absences:clone(ledger),
    verified_source_files:Object.fromEntries([...used].sort(([a],[b])=>a.localeCompare(b))),mutations:mutations.sort((a,b)=>a.path.localeCompare(b.path)),
    format_deltas:deltas,aggregate_equivalence:groupProof,history_rebase:history,
    ...(input.home_history?{retained_home_histories:1,retained_home_patch_sha256:input.home_history.patch_sha256}:{}),requires_full_rebuild:true,requires_financial_carry:true,
    pending:['unchanged canonical compiler','syncRecoveryHome before carry baseline','current financial carry and expiry','all unchanged cross-view/publication gates','new artifact provenance']};
}

function repairedGroups(groups,affected,fullGroupInputs,{recalculate=false}={}){
  const details=groups.payload?.group_details;assert(details&&typeof details==='object'&&!Array.isArray(details),'Missing object-shaped group details');
  rejectAffectedTopSymbols(groups,affected);const found=new Set(),result=clone(groups);
  for(const detail of Object.values(result.payload.group_details)){
    assert(Array.isArray(detail.stocks),'Missing group stock aliases');let changed=false;
    detail.stocks=detail.stocks.map(stock=>{if(!affected.has(stock.symbol))return stock;assert(!found.has(stock.symbol),'Duplicate affected group member');found.add(stock.symbol);changed=true;
      assert(recalculate||stock.rs_rating===null,'Affected primary group RS requires recalculation');
      const next=project(stock,RECOVERY_PRESERVED_FIELDS);for(const key of groupClear)if(Object.hasOwn(stock,key))next[key]=null;return next;
    });
    if(changed)detail.stocks.sort((a,b)=>{for(const key of ['rs_rating','composite_score']){const av=a[key]??-Infinity,bv=b[key]??-Infinity;if(av!==bv)return av>bv?-1:1;}return 0;});
  }
  const grouped=[];
  for(const symbol of affected){const source=fullGroupInputs.get(symbol);assert(source,`Missing affected full group input: ${symbol}`);const group=source.ibd_industry_group;
    if(group==null||group==='')assert(!found.has(symbol),'Unclassified full source row unexpectedly appears in a group');
    else{assert(typeof group==='string','Invalid original group identity');grouped.push(symbol);}}
  assert.deepEqual([...found].sort(),grouped.sort(),'Affected group member coverage mismatch');return result;
}

function applyGroupRankingAliases(groups,rankings){
  const aliases={current_rank:'rank',current_avg_rs:'avg_rs_rating',current_median_rs:'median_rs_rating',current_weighted_avg_rs:'weighted_avg_rs_rating',current_rs_std_dev:'rs_std_dev',num_stocks:'num_stocks',pct_rs_above_80:'pct_rs_above_80',top_symbol:'top_symbol',top_symbol_name:'top_symbol_name',top_rs_rating:'top_rs_rating',rank_change_1w:'rank_change_1w',rank_change_1m:'rank_change_1m',rank_change_3m:'rank_change_3m',rank_change_6m:'rank_change_6m'};
  groups.payload.rankings.rankings=clone(rankings);
  for(const ranking of rankings){const detail=groups.payload.group_details[ranking.industry_group];assert(detail,'Missing corrected group detail');for(const [field,key]of Object.entries(aliases))if(Object.hasOwn(detail,field))detail[field]=clone(ranking[key]);}
  groups.payload.movers={...clone(groups.payload.movers),gainers:clone(rankings.filter(row=>(row.rank_change_1w??0)>0).sort((a,b)=>b.rank_change_1w-a.rank_change_1w||a.rank-b.rank).slice(0,10)),losers:clone(rankings.filter(row=>(row.rank_change_1w??0)<0).sort((a,b)=>a.rank_change_1w-b.rank_change_1w||a.rank-b.rank).slice(0,10))};
}

const slot=(row,key)=>Object.hasOwn(row,key)?{present:true,value:row[key]}:{present:false};
function aggregateEquivalence({groupsRaw,groupsPath,homeRaw,homePath,affected,fullGroupInputs,rowDigests,references,recalculate=false,producerRuntimeReview=producerRuntime}){
  assert([producerRuntime,oct6ProducerRuntime].some(review=>same(review,producerRuntimeReview)),'Unreviewed producer runtime');
  assert.equal(sha(readRegular(groupBuilderPath)),groupBuilderSha256,'Audited group builder implementation changed');
  const groups=JSON.parse(groupsRaw),after=repairedGroups(groups,affected,fullGroupInputs,{recalculate}),home=JSON.parse(homeRaw);
  const rankings=groups.payload?.rankings?.rankings;assert(Array.isArray(rankings),'Missing original source rankings');
  assert.deepEqual(home.top_groups,rankings.slice(0,10),'Home top groups differ from source ranking scope');rejectAffectedTopSymbols(home.top_groups,affected);
  const movers=groups.payload?.movers;assert(movers&&Array.isArray(movers.gainers)&&Array.isArray(movers.losers),'Missing source group movers');
  const gainers=rankings.filter(row=>(row.rank_change_1w??0)>0).sort((a,b)=>b.rank_change_1w-a.rank_change_1w||a.rank-b.rank).slice(0,10);
  const losers=rankings.filter(row=>(row.rank_change_1w??0)<0).sort((a,b)=>a.rank_change_1w-b.rank_change_1w||a.rank-b.rank).slice(0,10);
  assert.deepEqual(movers.gainers,gainers,'Original group gainers dependency mismatch');assert.deepEqual(movers.losers,losers,'Original group losers dependency mismatch');
  const aliases={current_rank:'rank',current_avg_rs:'avg_rs_rating',current_median_rs:'median_rs_rating',current_weighted_avg_rs:'weighted_avg_rs_rating',current_rs_std_dev:'rs_std_dev',num_stocks:'num_stocks',pct_rs_above_80:'pct_rs_above_80',top_symbol:'top_symbol',top_symbol_name:'top_symbol_name',top_rs_rating:'top_rs_rating',rank_change_1w:'rank_change_1w',rank_change_1m:'rank_change_1m',rank_change_3m:'rank_change_3m',rank_change_6m:'rank_change_6m'};
  const rankMap=new Map(rankings.map(row=>[row.industry_group,row]));assert.equal(rankMap.size,rankings.length,'Duplicate source group ranking');
  for(const [group,detail]of Object.entries(groups.payload.group_details)){const ranking=rankMap.get(group);assert(ranking,'Group detail has no source ranking');for(const [field,rankField]of Object.entries(aliases))if(Object.hasOwn(detail,field))assert.deepEqual(detail[field],ranking[rankField],`Group aggregate alias mismatch: ${group}.${field}`);}
  function vector(payload){const membership=[],contributors=[],counts=[],nonAffected=[],nonmembers=[];
    for(const symbol of [...affected].sort()){const source=fullGroupInputs.get(symbol);if(source.ibd_industry_group==null||source.ibd_industry_group==='')nonmembers.push([symbol,slot(source,'ibd_industry_group'),rowDigests.get(symbol)]);}
    for(const [group,detail]of Object.entries(payload.payload.group_details).sort(([a],[b])=>a.localeCompare(b))){const seen=new Set(),eligible=[];
      for(const stock of detail.stocks){assert(stock&&typeof stock.symbol==='string'&&!seen.has(stock.symbol),'Duplicate/invalid group member');seen.add(stock.symbol);assert(Object.hasOwn(stock,'rs_rating'),'Missing primary source RS');
        const source=fullGroupInputs.get(stock.symbol);assert(source,`Group member missing original full source row: ${stock.symbol}`);assert.equal(source.ibd_industry_group,group,`Changed group membership: ${stock.symbol}`);
        membership.push([group,stock.symbol,stock.rs_rating!==null]);
        if(!affected.has(stock.symbol))nonAffected.push([group,stock.symbol,recoveryDigest(stock),rowDigests.get(stock.symbol)]);
        if(stock.rs_rating===null)continue;
        assert(typeof stock.rs_rating==='number'&&Number.isFinite(stock.rs_rating),'Invalid primary source RS');
        eligible.push({symbol:stock.symbol,company_name:slot(stock,'company_name'),rs_rating:slot(stock,'rs_rating'),composite_score:slot(stock,'composite_score'),market_cap_usd:slot(source,'market_cap_usd'),market_cap:slot(source,'market_cap')});
      }
      contributors.push([group,eligible]);counts.push([group,eligible.length,eligible.filter(row=>row.rs_rating.value>=80).length]);
    }
    membership.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));nonAffected.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
    return {membership,eligible_contributors_in_source_order:contributors,counts,unaffected_group_and_full_row_bindings:nonAffected,affected_unclassified_nonmembers:nonmembers};
  }
  const before=vector(groups),next=vector(after);let correction=null;
  if(recalculate){
    assert.deepEqual(before.unaffected_group_and_full_row_bindings,next.unaffected_group_and_full_row_bindings,'Unaffected group dependencies changed');
    assert.deepEqual(before.affected_unclassified_nonmembers,next.affected_unclassified_nonmembers,'Unclassified full-row bindings changed');
    assert.deepEqual(before.membership.map(([g,s])=>[g,s]),next.membership.map(([g,s])=>[g,s]),'Group membership changed');
    const changes=[];for(const [group,members]of before.eligible_contributors_in_source_order){const expected=members.filter(row=>!affected.has(row.symbol)),actual=next.eligible_contributors_in_source_order.find(([name])=>name===group)?.[1];assert.deepEqual(actual,expected,'Unexpected contributor change');for(const row of members.filter(row=>affected.has(row.symbol)))changes.push({group,symbol:row.symbol,original_contributor:row,full_row_sha256:rowDigests.get(row.symbol)});}
    assert(changes.length,'No contributor correction requires recalculation');
    const sourceOrder=[...rowDigests.keys()],sourceOrdinal=new Map(sourceOrder.map((symbol,index)=>[symbol,index]));
    const flatten=vector=>vector.eligible_contributors_in_source_order.flatMap(([group,members])=>members.map(row=>({symbol:row.symbol,ibd_industry_group:group,...Object.fromEntries(Object.entries(row).filter(([key,value])=>key!=='symbol'&&value.present).map(([key,value])=>[key,value.value]))}))).sort((a,b)=>sourceOrdinal.get(a.symbol)-sourceOrdinal.get(b.symbol));
    const calculated=JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./recalculate-retained-price-groups.py',import.meta.url))],{input:JSON.stringify({date:rankings[0].date,before_rows:flatten(before),after_rows:flatten(next)}),maxBuffer:8*1024*1024,timeout:30000}));
    const dates=new Set(rankings.map(row=>row.date));assert.equal(dates.size,1,'Mixed current ranking dates');
    assert.equal(calculated.before.length,rankings.length);assert.equal(calculated.after.length,rankings.length,'Correction removed a whole group');
    const periods=['1w','1m','3m','6m'],baseFields=Object.keys(calculated.before[0]).filter(key=>!key.startsWith('rank_change_'));
    for(const row of calculated.before){const original=rankMap.get(row.industry_group);assert(original,'Calculated unexpected original group');for(const field of baseFields)assert.deepEqual(original[field],row[field],`Original producer arithmetic mismatch: ${row.industry_group}.${field}`);}
    const replacement=calculated.after.map(row=>{const original=rankMap.get(row.industry_group),value=clone(original);for(const field of baseFields)value[field]=clone(row[field]);for(const period of periods){const key=`rank_change_${period}`;if(Object.hasOwn(original,key)){assert(original[key]===null||Number.isInteger(original[key]),'Invalid original rank delta');value[key]=original[key]===null?null:original[key]+original.rank-row.rank;}}return value;});
    applyGroupRankingAliases(after,replacement);const correctedHome={...clone(home),top_groups:clone(replacement.slice(0,10))};
    correction={source_row_order_sha256:recoveryDigest(sourceOrder),producer_row_order:'original_full_scan_manifest_chunk_order',arithmetic_adapter:{path:'.github/scripts/recalculate-retained-price-groups.py',sha256:sha(readRegular(fileURLToPath(new URL('./recalculate-retained-price-groups.py',import.meta.url)))),producer_function:'_compute_group_rankings_from_serialized_rows',producer_runtime:clone(producerRuntimeReview),original_arithmetic_reproduced:true},contributor_changes:changes,replacement_rankings:replacement,changed_rankings:replacement.filter(row=>!same(row,rankMap.get(row.industry_group))).map(row=>({group:row.industry_group,before:rankMap.get(row.industry_group),after:row})),corrected_groups_sha256:recoveryDigest(after),corrected_home_sha256:recoveryDigest(correctedHome),historical_rank_delta_rule:'original_delta + original_current_rank - corrected_current_rank; unknown stays unknown; no reference date invented'};
  }else assert.deepEqual(before,next,'Group aggregate contributor dependencies changed');
  const dependencies=Object.keys(before).map(name=>({name,before:before[name],after:next[name]}));
  const independentScopes={history:recoveryDigest(Object.entries(groups.payload.group_details).map(([group,detail])=>[group,detail.history??null])),rankings:recoveryDigest(rankings),movers:recoveryDigest(movers),home_top_groups:recoveryDigest(home.top_groups),references};
  return {schema_version:recalculate?'retained-price-aggregate-correction-v1':'retained-price-aggregate-equivalence-v1',publication_authority:false,...(correction??{}),groups_path:groupsPath,groups_sha256:sha(groupsRaw),home_path:homePath,home_sha256:sha(homeRaw),affected_symbols:[...affected].sort(),
    builder_reference:{path:'backend/app/services/static_site_export_service.py',sha256:groupBuilderSha256,scope:'audited_approved_reference_implementation_not_original_producer_verification',functions:['_compute_group_rankings_from_serialized_rows','_build_group_details','_build_group_movers','_build_home_payload']},
    eligibility:'nonempty_group_and_primary_source_rs_is_not_null',
    aggregate_non_inputs:['price','price_returns','volume','stage','liquidity','financial_fields'],
    dependencies,before_sha256:recoveryDigest(before),after_sha256:recoveryDigest(next),
    full_rows_sha256:recoveryDigest([...rowDigests].sort(([a],[b])=>a.localeCompare(b))),
    independent_dated_observations:{...independentScopes,scope:'original_database_run_rank_history_and_taxonomy_sources_preserved_not_recomputed_from_repaired_charts'},
    stock_order:'stable_descending_primary_source_rs_then_composite_null_as_negative_infinity'};
}

/** Pure local proof builder. Caller supplies original full source rows, never
 * compact research rows. Materialization recomputes every vector from its own
 * hash-bound full tree and requires an exact match to this reviewable proof. */
export function proveRecoveryAggregateEquivalence({groupsBytes,groupsPath,homeBytes,homePath,fullRows,affectedSymbols,references=[]}){
  assert(Array.isArray(fullRows)&&Array.isArray(affectedSymbols),'Original full rows and explicit affected symbols required');
  return proveRecoveryAggregateEquivalenceFromRowBindings({groupsBytes,groupsPath,homeBytes,homePath,
    fullRowBindings:fullRows.map(row=>({symbol:row.symbol,fields:project(row,groupInputFields),sha256:recoveryDigest(row)})),affectedSymbols,references});
}

/** Bounded streaming-audit entrypoint only. The caller computes each full-row
 * digest before discarding that row. These caller bindings grant no authority:
 * materialization recomputes the same proof from all restored source chunks. */
export function proveRecoveryAggregateEquivalenceFromRowBindings({groupsBytes,groupsPath,homeBytes,homePath,fullRowBindings,affectedSymbols,references=[],recalculate=false,producerRuntimeReview=producerRuntime}){
  assert(Array.isArray(fullRowBindings)&&Array.isArray(affectedSymbols),'Full row bindings and affected symbols required');
  const fullGroupInputs=new Map(),rowDigests=new Map();for(const item of fullRowBindings){assert(item&&typeof item.symbol==='string'&&item.fields?.symbol===item.symbol&&validHash(item.sha256),'Invalid streamed full-row binding');assert.deepEqual(Object.keys(item.fields).sort(),Object.keys(project(item.fields,groupInputFields)).sort(),'Unexpected streamed group input fields');assert(!rowDigests.has(item.symbol)||rowDigests.get(item.symbol)===item.sha256,'Conflicting proof full rows');if(fullGroupInputs.has(item.symbol))assert.deepEqual(fullGroupInputs.get(item.symbol),item.fields,'Conflicting streamed group fields');fullGroupInputs.set(item.symbol,clone(item.fields));rowDigests.set(item.symbol,item.sha256);}
  return aggregateEquivalence({groupsRaw:Buffer.from(groupsBytes),groupsPath,homeRaw:Buffer.from(homeBytes),homePath,affected:new Set(affectedSymbols),fullGroupInputs,rowDigests,references,recalculate,producerRuntimeReview});
}

export function proveRecoveryAggregateCorrectionFromRowBindings(input){return proveRecoveryAggregateEquivalenceFromRowBindings({...input,recalculate:true});}

/** Run only after the ordinary price compiler and BEFORE preparing financial
 * carry's baseline. It synchronizes exactly the scan-derived home summary;
 * it does not modify market series, group aggregates, financial fields or time. */
export function syncRecoveryHome(root){
  assertPricePreparationMode();
  root=resolve(root);assert.equal(realpathSync(root),root,'Linked sync root');
  const read=path=>JSON.parse(readRegular(absolute(root,'static-data/'+safeRelative(path))));
  const manifest=read('manifest.json'),market=manifest.markets?.US;assert(market?.pages?.home?.path&&market.pages.scan?.path,'Missing home/scan references');
  const scan=read(market.pages.scan.path),home=read(market.pages.home.path);assert.equal(scan.as_of_date,market.as_of_date,'Compiled scan date mismatch');assert.equal(home.as_of_date,scan.as_of_date,'Home/scan date mismatch');
  assert(Array.isArray(scan.preview_rows),'Final compiled scan preview required');assert(Number.isInteger(scan.rows_total)&&Number.isInteger(scan.default_filtered_rows_total),'Final compiled scan counts required');
  assert(scan.preview_rows.every(row=>row&&typeof row.symbol==='string'),'Invalid final scan preview');assert(home.scan_summary&&typeof home.scan_summary==='object','Missing home scan summary');
  const result=clone(home);Object.assign(result.scan_summary,{rows_total:scan.rows_total,default_filtered_rows_total:scan.default_filtered_rows_total,top_results:clone(scan.preview_rows)});
  const path='static-data/'+market.pages.home.path,before=readRegular(absolute(root,path)),bytes=encode(result),fields=fieldsChanged(home,result);
  if(fields.length){const temp=join(dirname(absolute(root,path)),`.retained-price-home-${process.pid}.tmp`);assert(!existsSync(temp),'Home staging file already exists');try{writeFileSync(temp,bytes,{flag:'wx'});renameSync(temp,absolute(root,path));}finally{if(existsSync(temp))unlinkSync(temp);}}
  return {schema_version:'retained-price-home-sync-v1',publication_authority:false,ready_to_publish:false,path,fields,
    before_sha256:sha(before),after_sha256:fields.length?sha(bytes):sha(before),scan_path:'static-data/'+market.pages.scan.path,
    scan_sha256:sha(readRegular(absolute(root,'static-data/'+market.pages.scan.path))),rows_total:scan.rows_total,default_filtered_rows_total:scan.default_filtered_rows_total,top_results:scan.preview_rows.map(row=>row.symbol)};
}
