// Provider-free generic carry preparation. This proof grants no release authority
// and never widens the strict financial-only baseline comparison.
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {dataFiles,inventoryDigest,safePath,sha256} from './publication-state.mjs';
import {dataInventory,digest} from './financial-correction.mjs';
import {ordinaryCarrySelected} from './ordinary-carry-tooling.mjs';
import {readCarryTargetBase} from './financial-generation-carry-controller.mjs';
import {prepareCarryHistory} from './prepare-carry-history.mjs';

export const ORDINARY_CALENDAR_SCHEMA='ordinary-session-calendar-derivation-v1';
const VERSION='ohlcv-v2-session-calendar',CALENDAR='static-data/trading-calendar.json';
const packages={'pandas-market-calendars':'5.4.0','exchange-calendars':'4.11.2',pandas:'2.2.0',numpy:'1.26.4'};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const same=(a,b,label)=>{if(!isDeepStrictEqual(a,b))throw Error('Ordinary calendar '+label+' changed');};
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const sourceIdentity=state=>({artifact_id:state.source.artifact.id,run_id:state.source.runId,run_attempt:state.source.attempt,artifact_sha256:state.source.artifact.digest.slice(7),manifest_sha256:state.source.manifestHash});
function sourceValid(source){return source&&['artifact_id','run_id','run_attempt'].every(k=>Number.isSafeInteger(source[k])&&source[k]>0)&&['artifact_sha256','manifest_sha256'].every(k=>hash(source[k]))&&Object.keys(source).length===5;}
function selectedRoute(state){
  if(!state?.carry||!state.decision?.publish||!['ui','data'].includes(state.decision.mode)||state.decision.migration
    ||['correction','activation','renewal','limited','designCarryPreview','publisherTooling','sourceRecovery'].some(key=>Object.hasOwn(state,key))
    ||state.source?.repair||ordinaryCarrySelected(state))return null;
  if(state.source.receiptHash&&state.source.publication)return 'published_input';
  return state.offlineCalendarIntent===true?'ui_only':null;
}
export async function ordinaryCalendarEligible(state,frontend){
  const route=selectedRoute(state);if(!route)return null;
  const module=await import(pathToFileURL(join(frontend,'src/static/qualificationAudit.js')).href);
  // A newer controller must never substitute its compiler into a legacy UI.
  if(module.AUDIT_VERSION==='ohlcv-v1')return null;
  if(module.AUDIT_VERSION!==VERSION)throw Error('Unknown selected ordinary audit compiler');
  if(!readFileSync(join(frontend,'tools/export-book-benchmark.py'),'utf8').includes('def export_calendar_only('))throw Error('Session-aware selected UI lacks its calendar-only producer');
  if(!sourceValid(sourceIdentity(state))||!sha(state.sourceSha)||!sha(state.controllerSha))throw Error('Missing ordinary calendar source/compiler identity');
  return route;
}
function inside(root,path){
  if(typeof path!=='string'||!/^[-A-Za-z0-9._%/]+$/.test(path)||path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Unsafe ordinary calendar data path');
  let decoded;try{decoded=decodeURIComponent(path);}catch{throw Error('Unsafe encoded ordinary calendar path');}
  if(decoded.includes('%')||/[\\\u0000-\u001f\u007f]/u.test(decoded)||decoded.split('/').length!==path.split('/').length||decoded.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Unsafe encoded ordinary calendar path');
  let current=root;
  for(const part of path.split('/')){current=join(current,part);if(lstatSync(current).isSymbolicLink())throw Error('Linked ordinary calendar input');}
  if(!lstatSync(current).isFile())throw Error('Non-file ordinary calendar input');
  return read(current);
}
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
// Protect full observed values, not merely the latest dates in the release ledger.
export function ordinaryRawPrices(root){
  const data=join(root,'static-data'),manifest=inside(data,'manifest.json'),result={dates:{as_of_date:manifest.as_of_date},markets:{}};
  for(const [market,entry]of Object.entries(manifest.markets||{})){
    const value={as_of_date:entry.as_of_date,charts:{},scans:{}};
    if(entry.assets?.charts){
      const index=inside(data,entry.assets.charts.path);
      if(!Array.isArray(index.symbols))throw Error('Invalid ordinary calendar chart universe');
      for(const item of index.symbols){
        if(!item?.symbol||Object.hasOwn(value.charts,item.symbol))throw Error('Duplicate ordinary calendar chart identity');
        let chart;try{chart=inside(data,item.path);}catch(error){if(error.code!=='ENOENT')throw error;value.charts[item.symbol]=null;continue;}
        if(chart.symbol!==item.symbol||(chart.market??market)!==market)throw Error('Ordinary calendar chart scope mismatch');
        value.charts[item.symbol]=digest(pick(chart,['symbol','market','as_of_date','bars']));
      }
    }
    const observedRows=new Map();let universe;
    for(const alias of ['path','list_path'])if(entry.pages?.scan?.[alias]){
      const scan=inside(data,entry.pages.scan[alias]),rows=new Map();
      const visit=payload=>{if(payload.as_of_date!==entry.as_of_date)throw Error('Ordinary calendar scan date mismatch');
        for(const row of payload.rows||payload.initial_rows||[]){
          if(!row?.symbol)throw Error('Missing ordinary calendar scan symbol');
          const fields=pick({...row,market:row.market??market,as_of_date:row.as_of_date??entry.as_of_date},['symbol','market','as_of_date','current_price','current_volume','volume','price_change_1d','adv_usd','price_date','price_as_of_date','currency','exchange','exchange_code','mic','price_source','price_timestamp','quote_timestamp']);
          const merge=map=>{const prior=map.get(row.symbol)||{};for(const [key,value]of Object.entries(fields)){if(Object.hasOwn(prior,key))same(prior[key],value,'duplicate scan observation');else prior[key]=value;}map.set(row.symbol,prior);};
          merge(rows);merge(observedRows);
        }};
      visit(scan);for(const ref of scan.chunks||[])visit(inside(data,ref.path));
      const symbols=[...rows.keys()].sort();if(universe)same(universe,symbols,'scan alias universe');else universe=symbols;
    }
    value.scans=Object.fromEntries([...observedRows].sort(([a],[b])=>a.localeCompare(b)).map(([symbol,row])=>[symbol,digest(row)]));
    if(entry.pages?.home)value.home=digest(inside(data,entry.pages.home.path));
    result.markets[market]=value;
  }
  result.retained_series={};
  const paths=[];
  const walk=(directory,prefix)=>{for(const entry of readdirSync(directory,{withFileTypes:true})){const path=prefix+entry.name;
    if(/^static-data\/(?:financial[^/]*|verified-charts|research-details|scan-list|candidate-history|candidate-performance-history)(?:\/|$)/.test(path))continue;
    if(entry.isDirectory())walk(join(directory,entry.name),path+'/');else if(entry.isFile())paths.push(path);else throw Error('Linked ordinary raw-price alias');
  }};walk(data,'static-data/');
  for(const path of paths){
    if(!path.startsWith('static-data/')||!path.endsWith('.json')||/^static-data\/(?:verified-charts|research-details|scan-list|candidate-history|candidate-performance-history)\//.test(path))continue;
    const payload=inside(root,path);
    if(Array.isArray(payload?.bars))result.retained_series[path]=digest(pick(payload,['symbol','market','as_of_date','bars']));
    else if(payload?.series&&typeof payload.series==='object')result.retained_series[path]=digest(pick(payload,['as_of_date','series']));
  }
  if(!Object.keys(result.markets).length)throw Error('Missing ordinary calendar markets');
  return result;
}
function files(root){
  const result={};
  function visit(directory,prefix=''){for(const entry of readdirSync(directory,{withFileTypes:true})){
    const path=prefix+entry.name;if(!safePath(path))throw Error('Unsafe calendar compiler path');
    if(entry.isDirectory())visit(join(directory,entry.name),path+'/');
    else if(entry.isFile())result[path]=sha256(readFileSync(join(directory,entry.name)));
    else throw Error('Linked calendar compiler/reference file');
  }}visit(root);return result;
}
function compiler(frontend,expectedSha){
  const checkout=dirname(frontend),paths=['frontend/src','frontend/tools','frontend/contracts','frontend/package.json','contracts','data/ibd_reference'];
  const git=args=>execFileSync('git',['-C',checkout,...args],{encoding:'utf8'}).trim();
  if(git(['rev-parse','HEAD'])!==expectedSha)throw Error('Ordinary calendar selected checkout differs from approved UI');
  git(['diff','--exit-code','HEAD','--',...paths]);
  if(git(['ls-files','--others','--exclude-standard','--',...paths]))throw Error('Untracked ordinary calendar compiler/reference input');
  const tools=realpathSync(join(frontend,'tools')),src=realpathSync(join(frontend,'src'));
  const references=join(dirname(frontend),'data/ibd_reference'),contracts=resolve(tools,'../../contracts');
  return {audit_version:VERSION,frontend_contracts:inventoryDigest(files(join(frontend,'contracts'))),tools:inventoryDigest(files(tools)),src:inventoryDigest(files(src)),contracts:inventoryDigest(files(contracts)),
    package:sha256(readFileSync(join(frontend,'package.json'))),references:inventoryDigest(files(references))};
}
function environment(time){const env={...process.env,FINANCIAL_EVALUATED_AT:time};for(const key of Object.keys(env))if(key.startsWith('FINANCIAL_CORRECTION_')||key.startsWith('FINANCIAL_GENERATION_CARRY_')||['GH_TOKEN','GITHUB_TOKEN','NODE_OPTIONS','NODE_PATH','PYTHONPATH','PYTHONHOME'].includes(key))delete env[key];return env;}
function runtime(time){
  const python=process.env.SESSION_CALENDAR_PYTHON;if(!python)throw Error('Ordinary calendar requires isolated pinned runtime');
  const value=JSON.parse(execFileSync(python,['-I','-c','import json,sys,importlib.metadata as m; print(json.dumps({"python":sys.version.split()[0],"packages":{k:m.version(k) for k in ["pandas-market-calendars","exchange-calendars","pandas","numpy"]}}))'],{env:environment(time),encoding:'utf8'}));
  same(value.packages,packages,'runtime dependencies');return {...value,node:process.version};
}
function derive(frontend,root,time){
  const before=dataInventory(root);delete before[CALENDAR];
  execFileSync(process.env.SESSION_CALENDAR_PYTHON,['-I',join(frontend,'tools/export-book-benchmark.py'),'--calendar-only','--root',join(root,'static-data'),'--evaluated-at',time],{env:environment(time),stdio:'pipe'});
  const after=dataInventory(root),calendar=after[CALENDAR];delete after[CALENDAR];same(after,before,'generator input inventory');return calendar;
}
function copyData(source,target){mkdirSync(target,{recursive:true});cpSync(join(source,'static-data'),join(target,'static-data'),{recursive:true,errorOnExist:true,force:false});for(const file of dataFiles)if(existsSync(join(source,file)))cpSync(join(source,file),join(target,file),{errorOnExist:true,force:false});}
export async function captureOrdinaryCalendarSource({state,frontend,root}){
  const route=await ordinaryCalendarEligible(state,frontend);if(!route)return null;
  return {route,source:sourceIdentity(state),raw_sha256:digest(ordinaryRawPrices(root)),source_input_inventory_sha256:inventoryDigest(dataInventory(root))};
}
export function sealOrdinaryCalendarSource({state,root}){
  if(state.ordinaryCalendarSource)state.ordinaryCalendarSource.restored_input_sha256=inventoryDigest(dataInventory(root));
}
export async function prepareOrdinaryCalendar({state,frontend,root,evidence,evaluatedAt}){
  const capture=state.ordinaryCalendarSource;if(!capture){if(await ordinaryCalendarEligible(state,frontend))throw Error('Missing authenticated ordinary calendar source capture');return null;}
  same(await ordinaryCalendarEligible(state,frontend),capture.route,'route');same(sourceIdentity(state),capture.source,'source');
  same(inventoryDigest(dataInventory(root)),capture.restored_input_sha256,'authenticated restored input inventory');
  same(digest(ordinaryRawPrices(root)),capture.raw_sha256,'restored raw prices');
  if(existsSync(evidence))throw Error('Ordinary calendar preparation cannot overwrite evidence');
  const identity=compiler(frontend,state.sourceSha),runtimeIdentity=runtime(evaluatedAt);
  copyData(root,join(evidence,'input'));
  const input=inventoryDigest(dataInventory(root));same(inventoryDigest(dataInventory(join(evidence,'input'))),input,'copied replay input');
  const calendar=derive(frontend,root,evaluatedAt);
  same(digest(ordinaryRawPrices(root)),capture.raw_sha256,'derived raw prices');
  return {evidence,proof:{schema_version:ORDINARY_CALENDAR_SCHEMA,route:capture.route,source:capture.source,
    previous_publication_identity:state.live.identity,financial_lineage_sha256:state.live.financialRelease.lineage_sha256,
    ui_sha:state.sourceSha,controller_sha:state.controllerSha,compiler:identity,runtime:runtimeIdentity,evaluated_at:evaluatedAt,
    source_input_inventory_sha256:capture.source_input_inventory_sha256,replay_input_inventory_sha256:input,raw_prices_sha256:capture.raw_sha256,calendar_sha256:calendar}};
}
export function bindOrdinaryCalendarBaseline(record,baseline,target){
  if(!record)return;
  same(digest(ordinaryRawPrices(baseline)),record.proof.raw_prices_sha256,'baseline raw prices');
  record.proof.baseline_inventory_sha256=inventoryDigest(dataInventory(baseline));record.proof.target_base_sha256=sha256(target);
}
export function validateOrdinaryCalendarProof(value,publication){
  const keys=['schema_version','route','source','previous_publication_identity','financial_lineage_sha256','ui_sha','controller_sha','compiler','runtime','evaluated_at','source_input_inventory_sha256','replay_input_inventory_sha256','raw_prices_sha256','calendar_sha256','baseline_inventory_sha256','target_base_sha256'];
  if(!value||Object.keys(value).sort().join('|')!==keys.sort().join('|')||value.schema_version!==ORDINARY_CALENDAR_SCHEMA||!['published_input','ui_only'].includes(value.route)
    ||!sourceValid(value.source)||!sha(value.ui_sha)||!sha(value.controller_sha)||!/^[1-9][0-9]*\/[1-9][0-9]*\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(value.previous_publication_identity||'')
    ||!Number.isFinite(Date.parse(value.evaluated_at))||new Date(value.evaluated_at).toISOString()!==value.evaluated_at||Date.parse(value.evaluated_at)>Date.now()
    ||keys.filter(k=>k.endsWith('_sha256')).some(k=>!hash(value[k])))throw Error('Invalid ordinary calendar derivation proof');
  if(!value.compiler||Object.keys(value.compiler).sort().join('|')!=='audit_version|contracts|frontend_contracts|package|references|src|tools'||value.compiler.audit_version!==VERSION||Object.entries(value.compiler).some(([k,v])=>k!=='audit_version'&&!hash(v))
    ||!value.runtime||Object.keys(value.runtime).sort().join('|')!=='node|packages|python'||!/^3\.\d+\.\d+$/.test(value.runtime.python)||!/^v\d+\.\d+\.\d+$/.test(value.runtime.node)||!isDeepStrictEqual(value.runtime.packages,packages))throw Error('Invalid ordinary calendar compiler/runtime proof');
  if(publication&&(publication.ui_sha!==value.ui_sha||publication.controller_sha!==value.controller_sha||publication.financial_lineage_sha256!==value.financial_lineage_sha256
    ||publication.data_source?.artifact_id!==value.source.artifact_id||publication.data_source?.run_id!==value.source.run_id||publication.data_source?.attempt!==value.source.run_attempt||!publication.financial_release))throw Error('Publication ordinary calendar binding mismatch');
  return value;
}
export async function verifyOrdinaryCalendar({state,frontend,root,restoreSource,restorePreparedInput}){
  const record=state.carry.calendar;if(!record){if(state.ordinaryCalendarSource||await ordinaryCalendarEligible(state,frontend))throw Error('Missing ordinary calendar carry proof');return null;}
  const proof=validateOrdinaryCalendarProof(record.proof);
  same([state.carry.evaluatedAt,state.carry.targetBaseSha256],[proof.evaluated_at,proof.target_base_sha256],'financial carry clock/target');
  same(await ordinaryCalendarEligible(state,frontend),proof.route,'replay route');same(sourceIdentity(state),proof.source,'replay source');
  same([state.sourceSha,state.controllerSha,state.live.identity,state.live.financialRelease.lineage_sha256],[proof.ui_sha,proof.controller_sha,proof.previous_publication_identity,proof.financial_lineage_sha256],'replay authority');
  same(compiler(frontend,state.sourceSha),proof.compiler,'selected compiler/references');same(runtime(proof.evaluated_at),proof.runtime,'replay runtime');
  same(inventoryDigest(dataInventory(join(record.evidence,'input'))),proof.replay_input_inventory_sha256,'original replay input');
  same(inventoryDigest(dataInventory(state.carry.baseline)),proof.baseline_inventory_sha256,'stored baseline');
  same(digest(ordinaryRawPrices(root)),proof.raw_prices_sha256,'final raw prices');
  same(sha256(readFileSync(join(root,CALENDAR))),proof.calendar_sha256,'final calendar');
  const scratch=mkdtempSync(join(tmpdir(),'ordinary-calendar-replay-'));
  try{
    // materialize rehashes the immutable ZIP, re-extracts its sole TAR, verifies
    // manifest/receipt and canonicalizes packed source before this comparison.
    const source=join(scratch,'source');await restoreSource(source);
    same(inventoryDigest(dataInventory(source)),proof.source_input_inventory_sha256,'authenticated original source inventory');
    same(digest(ordinaryRawPrices(source)),proof.raw_prices_sha256,'authenticated source raw prices');
    await restorePreparedInput(source);
    same(inventoryDigest(dataInventory(source)),proof.replay_input_inventory_sha256,'authenticated history/audit replay input');
    const cwd=join(scratch,'frontend'),replay=join(cwd,'public');copyData(source,replay);
    cpSync(join(dirname(frontend),'data/ibd_reference'),join(scratch,'data/ibd_reference'),{recursive:true});
    same(derive(frontend,replay,proof.evaluated_at),proof.calendar_sha256,'independent calendar');
    execFileSync(process.execPath,[join(frontend,'tools/export-research.mjs')],{cwd,env:environment(proof.evaluated_at),stdio:'pipe',maxBuffer:8*1024*1024});
    const target=await readCarryTargetBase({root:replay,frontendRoot:frontend});prepareCarryHistory({root:replay,targetInput:target});
    same(sha256(target.bytes),proof.target_base_sha256,'independent target base');
    same(inventoryDigest(dataInventory(replay)),proof.baseline_inventory_sha256,'independent complete baseline');
    same(digest(ordinaryRawPrices(replay)),proof.raw_prices_sha256,'independent baseline prices');
    same(inventoryDigest(dataInventory(join(record.evidence,'input'))),proof.replay_input_inventory_sha256,'replay input after verification');
    same(compiler(frontend,state.sourceSha),proof.compiler,'compiler after replay');
    return proof;
  }finally{rmSync(scratch,{recursive:true,force:true});}
}
