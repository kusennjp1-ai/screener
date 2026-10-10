// An isolated read-only measurement path. These records are never release
// candidates, financial-release receipts, or permission to publish.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync,existsSync,lstatSync,mkdirSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {designCarryPreviewTooling,runDesignCarryPreviewExport} from './design-carry-preview-tooling.mjs';
import {FINANCIAL_FIELDS,currentFinancialHistory,projectFinancialRow} from '../../frontend/src/static/financialCurrent.js';
import {overlayFinancialCorrection} from '../../frontend/tools/financial-correction-overlay.mjs';
import {bootstrap,dataFiles,inventoryDigest,livePublication,safePath,sha256,uiInventory} from './publication-state.mjs';
import {githubApi} from './publication-gate.mjs';
import {checkedExport,verifyArchive} from './select-release-source.mjs';
import {uniqueArtifact} from './select-published-runs.mjs';
import {completeInventory,restorePublishedFinancialSource,validateFinancialReleaseReceipt} from './financial-release-activation.mjs';
import {FINANCIAL_AUDIT_MAX_FILE_BYTES,financialAuditInventory,requiredFinancialAuditFiles,assertFinancialAuditPreserved} from './financial-audit-history.mjs';
import {dataInventory,digest} from './financial-correction.mjs';
import {readCarryTargetBase,verifyCarriedBundle} from './financial-generation-carry-controller.mjs';
import {extractPriceObservations,priceObservationDigest} from './price-observations.mjs';
import {canonicalPublication,removeCanonical,packPublication,previewPublication,transportCapable,validateTransportPreview,verifyTransportPublication} from './static-transport-publication.mjs';

export const DESIGN_CARRY_PREVIEW_SCHEMA='design-financial-carry-preview-v1';
export const DESIGN_CARRY_PREVIEW_BASIS='same_prices_carried_financials_preview';
export const DESIGN_CARRY_PREVIEW_MODE='active_lineage_carry_v1';
const preparationSchema='design-financial-carry-preparation-v1';
const verifiedPreparations=new WeakMap();
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const same=(a,b,label)=>{if(!isDeepStrictEqual(a,b))throw Error(`Design carry preview ${label} changed`);};
const git=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const codePaths=['.github','contracts','frontend','data/ibd_reference'];
const mutableOutput=path=>['frontend/dist/','frontend/dist.preview-verification/','frontend/node_modules/','frontend/test-results/','frontend/playwright-report/','frontend/public/static-data/'].some(prefix=>path.startsWith(prefix))||dataFiles.some(file=>path==='frontend/public/'+file);
const readBytes=(path,cap=16*1024*1024)=>{
  const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>cap)throw Error('Invalid bounded preview file');
  return readFileSync(path);
};
const read=path=>JSON.parse(readBytes(path));
const archiveHash=path=>{const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024**3)throw Error('Invalid bounded preview archive');return execFileSync('sha256sum',[path],{encoding:'utf8'}).split(' ')[0];};
const freshWrite=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof value==='string'?value:JSON.stringify(value),{flag:'wx'});};
const directory=path=>{const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Preview requires real directories');};
const sourceBinding=source=>({run_id:source.runId,run_attempt:source.attempt,source_sha:source.artifact.workflow_run.head_sha,artifact_id:source.artifact.id,artifact_sha256:source.artifact.digest.slice(7),manifest_sha256:source.manifestHash,price_observations_sha256:source.priceObservationsDigest});
const liveBinding=live=>({identity:live.identity,receipt_sha256:live.receiptHash,manifest_sha256:live.manifestHash,financial_release_sha256:digest(live.financialRelease),financial_generation:live.financialRelease.financial_generation,lineage_sha256:live.financialRelease.lineage_sha256});
const prices=root=>{const manifest=read(join(root,'static-data/manifest.json'));return priceObservationDigest(extractPriceObservations({dataRoot:join(root,'static-data'),manifest}));};
// Bind observed prices and the complete scan universe, not only observation
// dates. Financial overlays may alter neither OHLCV nor quote/liquidity values.
export function designPriceContentDigest(root){
  const dataRoot=join(root,'static-data'),manifest=read(join(dataRoot,'manifest.json')),markets={};
  const input=path=>{if(!safePath(path))throw Error('Unsafe preview price-content path');return JSON.parse(readBytes(join(dataRoot,path),256*1024**2));};
  for(const [market,entry]of Object.entries(manifest.markets||{}).sort(([a],[b])=>a.localeCompare(b))){
    const scan=entry.pages?.scan?input(entry.pages.scan.path):null,universe=new Map();
    if(scan){
      const payloads=[scan,...(scan.chunks||[]).map(ref=>input(ref.path))];
      for(const payload of payloads)for(const key of ['rows','initial_rows','preview_rows'])for(const row of payload[key]||[]){
        if(typeof row.symbol!=='string'||!row.symbol)throw Error('Invalid preview price-content symbol');
        const value={symbol:row.symbol,market:row.market??market,as_of_date:row.as_of_date??payload.as_of_date??scan.as_of_date,
          ...Object.fromEntries(['current_price','adv_usd','current_volume'].filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]))};
        if(universe.has(row.symbol)){const prior=universe.get(row.symbol);for(const [key,observed]of Object.entries(value))if(Object.hasOwn(prior,key))same(observed,prior[key],'price-content row copies');Object.assign(prior,value);}else universe.set(row.symbol,value);
      }
    }
    const charts=[];
    if(entry.assets?.charts)for(const ref of input(entry.assets.charts.path).symbols||[]){
      const chart=input(ref.path);charts.push({symbol:ref.symbol,bars:chart.bars??null});
    }
    const home=entry.pages?.home?input(entry.pages.home.path):null;
    markets[market]={as_of_date:entry.as_of_date,scan_as_of_date:scan?.as_of_date??null,universe:[...universe.values()].sort((a,b)=>a.symbol.localeCompare(b.symbol)),
      charts:charts.sort((a,b)=>a.symbol.localeCompare(b.symbol)),home:(home?.key_markets||[]).map(item=>({symbol:item.symbol,history:item.history??null})).sort((a,b)=>a.symbol.localeCompare(b.symbol))};
  }
  return digest({as_of_date:manifest.as_of_date,markets});
}
function cleanEnvironment(evaluatedAt){
  const env={...process.env};
  for(const key of Object.keys(env))if(key==='FINANCIAL_EVALUATED_AT'||key.startsWith('FINANCIAL_CORRECTION_')||key.startsWith('FINANCIAL_GENERATION_CARRY_'))delete env[key];
  return {...env,FINANCIAL_EVALUATED_AT:evaluatedAt};
}
function carryEnvironment(record){return {...cleanEnvironment(record.financial.evaluated_at),FINANCIAL_GENERATION_CARRY_PROJECTION:record.paths.projection,
  FINANCIAL_GENERATION_CARRY_SHA256:record.financial.projection_sha256,FINANCIAL_GENERATION_CARRY_SOURCE_LINEAGE:record.financial.source_lineage_sha256,
  FINANCIAL_GENERATION_CARRY_PREVIOUS_IDENTITY:record.predecessor.identity,FINANCIAL_GENERATION_CARRY_TARGET_BASE_SHA256:record.financial.target_base_sha256};}
function copyData(source,destination){mkdirSync(destination,{recursive:true});cpSync(join(source,'static-data'),join(destination,'static-data'),{recursive:true,errorOnExist:true,force:false});for(const file of dataFiles)cpSync(join(source,file),join(destination,file),{errorOnExist:true,force:false});}
export function previewCheckout(root,expectedSha){
  if(!sha(expectedSha)||git(root,['rev-parse','HEAD'])!==expectedSha)throw Error('Preview must bind the exact checked-out candidate');
  const changed=git(root,['diff','--name-only','HEAD','--',...codePaths]).split('\n').filter(Boolean);
  if(changed.some(path=>!mutableOutput(path)))throw Error('Preview tracked source code changed');
  const untracked=git(root,['ls-files','--others','--exclude-standard','--',...codePaths]).split('\n').filter(Boolean);
  const ignored=git(root,['ls-files','--others','--ignored','--exclude-standard','--','frontend/src','frontend/tools','frontend/contracts','frontend/scripts','frontend/public','.github','contracts','data/ibd_reference',':(glob)frontend/.env*',':(glob).env*']).split('\n').filter(Boolean);
  if([...untracked,...ignored].some(path=>!mutableOutput(path)))throw Error('Untracked preview source code or environment');
  const entries=git(root,['ls-tree','-r','-z','HEAD','--',...codePaths]).split('\0').filter(Boolean),files={};
  for(const entry of entries){
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);if(!match||!safePath(match[3]))throw Error('Invalid preview source tree entry');
    const [,mode,blob,path]=match;if(mutableOutput(path))continue;
    const full=join(root,path),bytes=readBytes(full,128*1024*1024),actual=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if(actual!==blob||Boolean(lstatSync(full).mode&0o111)!==(mode==='100755'))throw Error('Preview source bytes or mode differ from immutable Git tree');
    files[path]={sha256:sha256(bytes),mode,git_blob_sha:blob};
  }
  return {sha:expectedSha,code_inventory_sha256:inventoryDigest(files)};
}
export function validateDesignCarrySource(state,expectedSha){
  if(state?.decision?.mode!=='design'||state.sourceSha!==expectedSha||state.controllerSha!==expectedSha||state.activation||state.correction||state.carry||state.renewal
    ||state.source?.repair||state.source?.publication||state.source?.receiptHash||!positive(state.source?.artifact?.id)||!positive(state.source?.runId)||!positive(state.source?.attempt)
    ||!/^sha256:[a-f0-9]{64}$/.test(state.source.artifact.digest||'')||!sha(state.source.artifact.workflow_run?.head_sha)||!hash(state.source.manifestHash)||!hash(state.source.priceObservationsDigest))throw Error('Preview requires exact ordinary raw Design source provenance');
  if(state.source.manifest?.financial_generation!=null)throw Error('Preview cannot stamp or replace an existing financial generation');
  const prior=validateFinancialReleaseReceipt(state.live?.financialRelease),receipt=state.live?.receipt;
  if(!receipt||!hash(state.live.receiptHash)||!hash(state.live.manifestHash)||prior.financial_generation!==receipt.financial_generation
    ||prior.lineage_sha256!==receipt.financial_lineage_sha256||!/^\d+\/\d+\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(state.live.identity||''))throw Error('Preview requires a verified active predecessor lineage');
  if(priceObservationDigest(state.source.priceObservations)!==state.source.priceObservationsDigest)throw Error('Source price proof changed');
  return state;
}
export async function revalidateDesignCarrySource(state,{api=githubApi,loadLive=livePublication,loadManifest}={}){
  const repo=bootstrap.repository,live=await loadLive({repository:repo});same(liveBinding(live),liveBinding(state.live),'live predecessor');
  const artifact=api(`repos/${repo}/actions/artifacts/${state.source.artifact.id}`);
  if(artifact.expired!==false)throw Error('Selected source artifact expired');
  const pages=api(`repos/${repo}/actions/runs/${state.source.runId}/artifacts?per_page=100`,true);
  const current=checkedExport(artifact,pages,repo,api,loadManifest);if(!current)throw Error('Selected source attempt is no longer eligible');
  same(sourceBinding(current),sourceBinding(state.source),'selected source');same(current.manifest,state.source.manifest,'selected manifest');
  const companion=uniqueArtifact(pages,`static-site-data-manifest-${state.source.runId}-${state.source.attempt}`,state.source.runId);
  if(!/^sha256:[a-f0-9]{64}$/.test(companion.digest||''))throw Error('Missing exact source manifest companion digest');
  return {artifact_id:companion.id,artifact_sha256:companion.digest.slice(7),name:companion.name,source_sha:companion.workflow_run.head_sha};
}
function verifyArchiveFiles(state,paths){
  if(archiveHash(paths.archive_zip)!==state.source.artifact.digest.slice(7))throw Error('Preview source artifact digest changed');
  verifyArchive(state.source,paths.archive_tar);
  const archiveTarSha256=archiveHash(paths.archive_tar);
  const authenticated=JSON.parse(execFileSync('python3',['-c',`import hashlib,json,sys,tarfile,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 entries=z.infolist()
 assert len(entries)==1 and entries[0].filename=='artifact.tar', 'Unexpected source ZIP members'
 with z.open(entries[0]) as f: original=hashlib.file_digest(f,'sha256').hexdigest()
files={}
with tarfile.open(sys.argv[2]) as t:
 for m in t:
  path=m.name
  while path.startswith('./'):path=path[2:]
  if m.isfile() and path.startswith('static-data/'):
   with t.extractfile(m) as f:files[path]=hashlib.file_digest(f,'sha256').hexdigest()
print(json.dumps({'tar_sha256':original,'static_data':files},sort_keys=True))`,paths.archive_zip,paths.archive_tar],{encoding:'utf8',maxBuffer:32*1024*1024}));
  same(archiveTarSha256,authenticated.tar_sha256,'TAR membership in authenticated artifact ZIP');
  return {archiveTarSha256,staticInventory:authenticated.static_data};
}
const defaults={now:()=>Date.now(),revalidate:revalidateDesignCarrySource,restore:restorePublishedFinancialSource,
  run:(script,frontend,env)=>execFileSync(process.execPath,[join(frontend,'tools',script)],{cwd:frontend,env,stdio:'inherit'})};

export async function prepareDesignCarryPreview({repoRoot=process.cwd(),provenancePath=join(process.env.RUNNER_TEMP||'/tmp','verified-publication/state.json'),workRoot=join(process.env.RUNNER_TEMP||'/tmp','design-carry-preview'),expectedSha=process.env.GITHUB_SHA,baselineRepoRoot=join(process.env.RUNNER_TEMP||'/tmp','design-baseline'),dependencies={}}={}){
  const ops={...defaults,...dependencies};repoRoot=resolve(repoRoot);workRoot=resolve(workRoot);const frontend=join(repoRoot,'frontend'),root=join(frontend,'public');
  if(existsSync(workRoot))throw Error('Preview preparation destination must be new');
  baselineRepoRoot=resolve(baselineRepoRoot);const baselineInput=previewCheckout(baselineRepoRoot,git(baselineRepoRoot,['rev-parse','HEAD']));
  const candidate=previewCheckout(repoRoot,expectedSha),provenance=readBytes(provenancePath),state=validateDesignCarrySource(JSON.parse(provenance),expectedSha);
  const sourceCompanion=await ops.revalidate(state);same(previewCheckout(repoRoot,expectedSha),candidate,'candidate checkout');
  directory(join(root,'static-data'));if(sha256(readBytes(join(root,'static-data/manifest.json')))!==state.source.manifestHash)throw Error('Selected source manifest changed before preparation');
  const archiveRoot=join(dirname(provenancePath),`artifact-${state.source.artifact.id}`),paths={repo:repoRoot,baseline_repo:baselineRepoRoot,work:workRoot,provenance:resolve(provenancePath),archive_zip:join(archiveRoot,'artifact.zip'),archive_tar:join(archiveRoot,'artifact.tar'),source:join(workRoot,'source'),baseline:join(workRoot,'carry-baseline'),target:join(workRoot,'target-base.json'),projection:join(workRoot,'carry-projection.json'),exporter:join(workRoot,'preview-exporter.mjs')};
  const archive=verifyArchiveFiles(state,paths),rawPrices=prices(root);same(rawPrices,state.source.priceObservationsDigest,'raw price observations');
  const rawInventory=Object.fromEntries(Object.entries(dataInventory(root)).filter(([path])=>path.startsWith('static-data/')));same(rawInventory,archive.staticInventory,'materialized raw source inventory');
  const baselineRaw=Object.fromEntries(Object.entries(dataInventory(join(baselineRepoRoot,'frontend/public'))).filter(([path])=>path.startsWith('static-data/')));same(baselineRaw,archive.staticInventory,'comparison baseline raw source inventory');
  const priceContent=designPriceContentDigest(root);same(designPriceContentDigest(join(baselineRepoRoot,'frontend/public')),priceContent,'comparison baseline raw prices');mkdirSync(workRoot);mkdirSync(paths.source);
  const rollback=join(workRoot,'raw-input');let rollbackReady=false;
  try{cpSync(root,rollback,{recursive:true,errorOnExist:true,force:false});rollbackReady=true;
  await ops.restore(state.live,paths.source);const audited=financialAuditInventory(paths.source);assertFinancialAuditPreserved(requiredFinancialAuditFiles(state.live),audited);
  for(const [path,expected]of Object.entries(audited)){
    const destination=join(root,path);if(existsSync(destination))same(sha256(readBytes(destination,FINANCIAL_AUDIT_MAX_FILE_BYTES)),expected,'existing audit');
    else{mkdirSync(dirname(destination),{recursive:true});cpSync(join(paths.source,path),destination,{errorOnExist:true,force:false});}
  }
  // The actual preparation instant affects destination evaluation only. Original
  // source proof/capture clocks and raw financial receipts are immutable.
  const evaluatedAt=new Date(ops.now()).toISOString(),env=cleanEnvironment(evaluatedAt);
  ops.run('export-research.mjs',frontend,env);copyData(root,paths.baseline); // no first daily snapshot yet
  const target=await readCarryTargetBase({root,frontendRoot:frontend});freshWrite(paths.target,target.bytes);
  const previous=state.live.financialRelease,sourceProjection=readBytes(join(paths.source,previous.source_projection.path),FINANCIAL_AUDIT_MAX_FILE_BYTES),sourceBase=readBytes(join(paths.source,previous.source_base.path),FINANCIAL_AUDIT_MAX_FILE_BYTES);
  const helper=await import(pathToFileURL(join(frontend,'tools/financial-generation-carry.mjs')).href);
  const carry=helper.createFinancialGenerationCarry({sourceProjection,sourceProjectionSha256:previous.source_projection.sha256,sourceBase,sourceBaseSha256:previous.source_base.sha256,
    sourceLineage:previous.lineage_sha256,previousPublicationIdentity:state.live.identity,targetBase:target.bytes,targetBaseSha256:sha256(target.bytes),evaluatedAt});
  const projection=JSON.stringify(carry);if(Buffer.byteLength(projection)>FINANCIAL_AUDIT_MAX_FILE_BYTES)throw Error('Preview carry exceeds unchanged audit file bound');freshWrite(paths.projection,projection);
  if(carry.financial_generation===previous.financial_generation)throw Error('Preview must create a distinct bound destination generation');
  const record={schema:preparationSchema,publication_authority:'none',release_accepted:false,mode:DESIGN_CARRY_PREVIEW_MODE,comparison_basis:DESIGN_CARRY_PREVIEW_BASIS,candidate,baseline_input:baselineInput,paths,
    provenance_sha256:sha256(provenance),source:{...sourceBinding(state.source),companion:sourceCompanion,archive_tar_sha256:archive.archiveTarSha256,raw_inventory_sha256:inventoryDigest(rawInventory),price_content_sha256:priceContent},predecessor:liveBinding(state.live),
    financial:{generation:carry.financial_generation,source_generation:carry.source_financial_generation,source_lineage_sha256:previous.lineage_sha256,source_projection_sha256:previous.source_projection.sha256,source_base_sha256:previous.source_base.sha256,target_base_sha256:sha256(target.bytes),evaluated_at:evaluatedAt,projection_sha256:sha256(projection)},
    source_audit_inventory_sha256:inventoryDigest(audited),baseline_inventory_sha256:inventoryDigest(dataInventory(paths.baseline))};
  const carryEnv=carryEnvironment(record);await helper.loadFinancialGenerationCarry({env:carryEnv,rows:target.rows,asOfDate:target.asOfDate});
  const tooling=designCarryPreviewTooling({repoRoot,candidateSha:expectedSha,provenanceSha256:record.provenance_sha256,predecessorIdentity:record.predecessor.identity,targetBaseSha256:record.financial.target_base_sha256,projectionSha256:record.financial.projection_sha256,generation:record.financial.generation});
  record.tooling=tooling.binding;freshWrite(paths.exporter,tooling.bytes.toString());
  runDesignCarryPreviewExport({frontend,bytes:tooling.bytes,env:carryEnv,run:ops.run});ops.run('record-candidate-history.mjs',frontend,carryEnv);
  same(prices(root),rawPrices,'carried prices');same(designPriceContentDigest(root),priceContent,'carried price content');
  record.assessment=await verifyCarriedBundle({baselineRoot:paths.baseline,root,frontendRoot:frontend,carry,evaluatedAt:ops.now()});
  record.final_manifest_sha256=sha256(readBytes(join(root,'static-data/manifest.json')));record.final_inventory_sha256=inventoryDigest(dataInventory(root));
  same(sha256(readBytes(provenancePath)),record.provenance_sha256,'provenance during preparation');same(previewCheckout(repoRoot,expectedSha),candidate,'checkout during preparation');
  freshWrite(join(workRoot,'preparation.json'),record);rmSync(rollback,{recursive:true});return record;
  }catch(error){if(rollbackReady){rmSync(root,{recursive:true,force:true});renameSync(rollback,root);}rmSync(workRoot,{recursive:true,force:true});throw error;}
}

function assertClockBoundary(preparation,now){
  const context=verifiedPreparations.get(preparation);if(!context)throw Error('Missing verified carry boundary context');
  const {carry,rows}=context,built=Date.parse(carry.financial_evaluated_at);
  if(!Number.isSafeInteger(now)||now<built)throw Error('Invalid preview boundary clock');
  for(const row of rows){
    const item=carry.symbols[row.symbol];if(!item)throw Error('Missing carried boundary identity');
    const applied=overlayFinancialCorrection(row,carry),before=projectFinancialRow(applied,{now:built}),after=projectFinancialRow(applied,{now});
    for(const field of FINANCIAL_FIELDS)if(before.financial_current_state.fields[field].source_validated&&!after.financial_current_state.fields[field].source_validated)throw Error(`Preview current proof expired at boundary ${row.symbol}/${field}`);
    const previous=currentFinancialHistory(item.financial_history,row.symbol,item.as_of_date,built),current=currentFinancialHistory(item.financial_history,row.symbol,item.as_of_date,now);
    if(previous.annual.length>current.annual.length||previous.quarterly.length>current.quarterly.length||previous.annualComplete&&!current.annualComplete||previous.epsYoY!==null&&current.epsYoY===null||previous.salesYoY!==null&&current.salesYoY===null)throw Error(`Preview current history expired at boundary ${row.symbol}`);
  }
}

async function verifyPreparation(preparationPath,root,ops){
  const bytes=readBytes(preparationPath),p=JSON.parse(bytes);
  if(p.schema!==preparationSchema||p.publication_authority!=='none'||p.release_accepted!==false||p.mode!==DESIGN_CARRY_PREVIEW_MODE||p.comparison_basis!==DESIGN_CARRY_PREVIEW_BASIS)throw Error('Invalid non-authoritative preview preparation');
  if(resolve(preparationPath)!==join(p.paths.work,'preparation.json')||p.paths.baseline!==join(p.paths.work,'carry-baseline')||p.paths.source!==join(p.paths.work,'source')||p.paths.target!==join(p.paths.work,'target-base.json')||p.paths.projection!==join(p.paths.work,'carry-projection.json')||p.paths.exporter!==join(p.paths.work,'preview-exporter.mjs'))throw Error('Preview preparation path binding changed');
  same(previewCheckout(p.paths.repo,p.candidate.sha),p.candidate,'checkout');
  const tooling=designCarryPreviewTooling({repoRoot:p.paths.repo,candidateSha:p.candidate.sha,provenanceSha256:p.provenance_sha256,predecessorIdentity:p.predecessor.identity,targetBaseSha256:p.financial.target_base_sha256,projectionSha256:p.financial.projection_sha256,generation:p.financial.generation});same(tooling.binding,p.tooling,'preview tooling contract');same(readBytes(p.paths.exporter).toString(),tooling.bytes.toString(),'preview tooling bytes');
  const provenance=readBytes(p.paths.provenance);same(sha256(provenance),p.provenance_sha256,'provenance');
  const state=validateDesignCarrySource(JSON.parse(provenance),p.candidate.sha);same(sourceBinding(state.source),Object.fromEntries(Object.keys(sourceBinding(state.source)).map(key=>[key,p.source[key]])),'source binding');same(liveBinding(state.live),p.predecessor,'predecessor binding');
  same(await ops.revalidate(state),p.source.companion,'source manifest companion');const archive=verifyArchiveFiles(state,p.paths);same(archive.archiveTarSha256,p.source.archive_tar_sha256,'archive TAR');same(inventoryDigest(archive.staticInventory),p.source.raw_inventory_sha256,'authenticated raw source inventory');
  const audit=financialAuditInventory(p.paths.source);assertFinancialAuditPreserved(requiredFinancialAuditFiles(state.live),audit);same(inventoryDigest(audit),p.source_audit_inventory_sha256,'source audit');
  const previous=state.live.financialRelease,sourceProjection=readBytes(join(p.paths.source,previous.source_projection.path),FINANCIAL_AUDIT_MAX_FILE_BYTES),sourceBase=readBytes(join(p.paths.source,previous.source_base.path),FINANCIAL_AUDIT_MAX_FILE_BYTES);
  same(sha256(sourceProjection),p.financial.source_projection_sha256,'original projection');same(sha256(sourceBase),p.financial.source_base_sha256,'original base');same(previous.lineage_sha256,p.financial.source_lineage_sha256,'original lineage');
  const target=await readCarryTargetBase({root:p.paths.baseline,frontendRoot:join(p.paths.repo,'frontend')});same(target.bytes,readBytes(p.paths.target,256*1024**2).toString(),'target bytes');same(sha256(target.bytes),p.financial.target_base_sha256,'target hash');
  same(inventoryDigest(dataInventory(p.paths.baseline)),p.baseline_inventory_sha256,'carry baseline');
  const helper=await import(pathToFileURL(join(p.paths.repo,'frontend/tools/financial-generation-carry.mjs')).href),projection=readBytes(p.paths.projection,FINANCIAL_AUDIT_MAX_FILE_BYTES);same(sha256(projection),p.financial.projection_sha256,'carry projection');
  const carry=await helper.loadFinancialGenerationCarry({env:carryEnvironment(p),rows:target.rows,asOfDate:target.asOfDate});
  same(carry.source_projection_json,sourceProjection.toString(),'embedded original projection');same(carry.source_base_json,sourceBase.toString(),'embedded original base');same(carry.financial_generation,p.financial.generation,'destination generation');same(carry.source_financial_generation,p.financial.source_generation,'source generation');
  same(inventoryDigest(dataInventory(root)),p.final_inventory_sha256,'final logical data');same(sha256(readBytes(join(root,'static-data/manifest.json'))),p.final_manifest_sha256,'final manifest');
  if(read(join(root,'static-data/manifest.json')).financial_generation!==p.financial.generation)throw Error('Preview manifest lacks the real carried destination');
  same(prices(root),p.source.price_observations_sha256,'final prices');same(designPriceContentDigest(root),p.source.price_content_sha256,'final price content');
  const assessed=await verifyCarriedBundle({baselineRoot:p.paths.baseline,root,frontendRoot:join(p.paths.repo,'frontend'),carry,evaluatedAt:ops.now()});same(assessed,p.assessment,'carry assessment');
  same(sha256(readBytes(preparationPath)),sha256(bytes),'preparation during verification');same(previewCheckout(p.paths.repo,p.candidate.sha),p.candidate,'checkout during verification');
  verifiedPreparations.set(p,{carry,rows:target.rows});assertClockBoundary(p,ops.now());
  return p;
}

export async function packDesignCarryPreview({preparationPath=join(process.env.RUNNER_TEMP||'/tmp','design-carry-preview/preparation.json'),currentRoot=resolve('frontend/dist'),baselineRoot=join(process.env.RUNNER_TEMP||'/tmp','design-baseline/frontend/dist'),dependencies={}}={}){
  const ops={...defaults,...dependencies};currentRoot=resolve(currentRoot);baselineRoot=resolve(baselineRoot);directory(currentRoot);directory(baselineRoot);
  const p=await verifyPreparation(preparationPath,currentRoot,ops);if(currentRoot!==join(p.paths.repo,'frontend/dist'))throw Error('Only the current preview build can be packed');
  if(!transportCapable(currentRoot)||existsSync(join(currentRoot,'publication.json')))throw Error('Preview needs a fresh transport-capable candidate');
  const baselineRepo=resolve(baselineRoot,'../..');same(baselineRepo,p.paths.baseline_repo,'comparison baseline repository');const baseline=previewCheckout(baselineRepo,p.baseline_input.sha);same(baseline,p.baseline_input,'comparison baseline source');
  same(prices(baselineRoot),p.source.price_observations_sha256,'comparison baseline prices');same(designPriceContentDigest(baselineRoot),p.source.price_content_sha256,'comparison baseline price content');
  const ui=uiInventory(currentRoot),baselineUi=uiInventory(baselineRoot),baselineData=dataInventory(baselineRoot);
  const publication=previewPublication({uiSha:p.candidate.sha,uiDigest:inventoryDigest(ui),manifestSha256:p.final_manifest_sha256});
  const receiptPath=join(p.paths.work,'preview-receipt.json'),pendingPath=join(p.paths.work,'preview-receipt.pending.json'),logical=join(p.paths.work,'candidate-logical');
  if(existsSync(receiptPath)||existsSync(pendingPath))throw Error('Preview receipt must be new');
  try{
  await packPublication({preserveLogical:logical,root:currentRoot,frontendRoot:join(p.paths.repo,'frontend'),publication,bindings:{sourceCommit:p.candidate.sha,appCommit:p.candidate.sha,candidateId:sha256(readBytes(preparationPath)),financialGeneration:p.financial.generation,financialLineageSha256:p.financial.source_lineage_sha256}});
  validateTransportPreview(publication);
  const receipt={schema:DESIGN_CARRY_PREVIEW_SCHEMA,publication_authority:'none',release_accepted:false,mode:DESIGN_CARRY_PREVIEW_MODE,comparison_basis:DESIGN_CARRY_PREVIEW_BASIS,
    candidate:{...p.candidate,ui_inventory_sha256:inventoryDigest(ui)},baseline:{...baseline,ui_inventory_sha256:inventoryDigest(baselineUi),data_inventory_sha256:inventoryDigest(baselineData)},
    provenance_sha256:p.provenance_sha256,source:p.source,predecessor:p.predecessor,financial:p.financial,assessment:p.assessment,tooling:p.tooling,
    before_logical_inventory_sha256:p.baseline_inventory_sha256,after_logical_inventory_sha256:p.final_inventory_sha256,final_manifest_sha256:p.final_manifest_sha256,
    packed_physical_inventory_sha256:inventoryDigest(completeInventory(currentRoot)),publication_sha256:sha256(readBytes(join(currentRoot,'publication.json'))),
    transport:publication.transport,paths:{preparation:resolve(preparationPath),current:currentRoot,baseline:baselineRoot,baseline_repo:baselineRepo},preparation_sha256:sha256(readBytes(preparationPath))};
  freshWrite(pendingPath,receipt);
  await verifyDesignCarryPreview({receiptPath:pendingPath,currentRoot,baselineRoot,dependencies});renameSync(pendingPath,receiptPath);rmSync(logical,{recursive:true});return receipt;
  }catch(error){rmSync(pendingPath,{force:true});if(existsSync(logical)){rmSync(currentRoot,{recursive:true,force:true});renameSync(logical,currentRoot);}throw error;}
}

export async function verifyDesignCarryPreview({receiptPath,currentRoot,baselineRoot,dependencies={}}){
  const ops={...defaults,...dependencies},bytes=readBytes(receiptPath),r=JSON.parse(bytes);
  if(r.schema!==DESIGN_CARRY_PREVIEW_SCHEMA||r.publication_authority!=='none'||r.release_accepted!==false||r.mode!==DESIGN_CARRY_PREVIEW_MODE||r.comparison_basis!==DESIGN_CARRY_PREVIEW_BASIS)throw Error('Preview record cannot grant release authority');
  currentRoot=resolve(currentRoot);baselineRoot=resolve(baselineRoot);directory(currentRoot);directory(baselineRoot);same(currentRoot,r.paths.current,'measured candidate path');same(baselineRoot,r.paths.baseline,'measured baseline path');
  same(sha256(readBytes(r.paths.preparation)),r.preparation_sha256,'preparation hash');
  same(inventoryDigest(completeInventory(currentRoot)),r.packed_physical_inventory_sha256,'packed physical inventory');same(sha256(readBytes(join(currentRoot,'publication.json'))),r.publication_sha256,'preview publication');
  const publication=validateTransportPreview(read(join(currentRoot,'publication.json')));same(publication.transport,r.transport,'transport descriptor');
  same(inventoryDigest(uiInventory(currentRoot)),r.candidate.ui_inventory_sha256,'candidate UI');same(inventoryDigest(uiInventory(baselineRoot)),r.baseline.ui_inventory_sha256,'baseline UI');same(inventoryDigest(dataInventory(baselineRoot)),r.baseline.data_inventory_sha256,'baseline data');
  same(previewCheckout(r.paths.baseline_repo,r.baseline.sha),{sha:r.baseline.sha,code_inventory_sha256:r.baseline.code_inventory_sha256},'baseline checkout');
  await verifyTransportPublication({root:currentRoot,frontendRoot:resolve(currentRoot,'..'),publication});
  const restored=`${currentRoot}.preview-verification`;if(existsSync(restored))throw Error('Preview verification restore path must be new');
  const canonical=await canonicalPublication({root:currentRoot,frontendRoot:resolve(currentRoot,'..'),publication,restore:restored});
  let prepared;
  try{
    const p=await verifyPreparation(r.paths.preparation,canonical,ops);prepared=p;
    for(const key of ['provenance_sha256','source','predecessor','financial','assessment','tooling','final_manifest_sha256'])same(r[key],p[key],`receipt ${key}`);
    same(r.before_logical_inventory_sha256,p.baseline_inventory_sha256,'receipt baseline inventory');same(r.after_logical_inventory_sha256,p.final_inventory_sha256,'receipt final inventory');
    same(r.candidate,{...p.candidate,ui_inventory_sha256:publication.ui_digest},'receipt candidate');same(publication.transport.root.bindings.candidateId,r.preparation_sha256,'transport preparation');
    same(publication.transport.root.bindings.financialGeneration,p.financial.generation,'transport financial generation');same(publication.transport.root.bindings.financialLineageSha256,p.financial.source_lineage_sha256,'transport financial lineage');
    same(prices(baselineRoot),p.source.price_observations_sha256,'baseline price observations');same(designPriceContentDigest(baselineRoot),p.source.price_content_sha256,'baseline price content');same({sha:r.baseline.sha,code_inventory_sha256:r.baseline.code_inventory_sha256},p.baseline_input,'receipt baseline source');
  }finally{removeCanonical(currentRoot,canonical);}
  same(inventoryDigest(completeInventory(currentRoot)),r.packed_physical_inventory_sha256,'packed physical inventory during verification');same(inventoryDigest(uiInventory(baselineRoot)),r.baseline.ui_inventory_sha256,'baseline UI during verification');same(inventoryDigest(dataInventory(baselineRoot)),r.baseline.data_inventory_sha256,'baseline data during verification');
  same(previewCheckout(r.paths.baseline_repo,r.baseline.sha),{sha:r.baseline.sha,code_inventory_sha256:r.baseline.code_inventory_sha256},'baseline checkout during verification');
  same(sha256(readBytes(r.paths.preparation)),r.preparation_sha256,'preparation during final verification');same(sha256(readBytes(receiptPath)),sha256(bytes),'receipt during verification');assertClockBoundary(prepared,ops.now());return r;
}

export async function recordDesignCarryPreviewReport({receiptPath,currentRoot,baselineRoot,reportPath,dependencies={}}){
  const receipt=await verifyDesignCarryPreview({receiptPath,currentRoot,baselineRoot,dependencies}),reportBytes=readBytes(reportPath,32*1024*1024),report=JSON.parse(reportBytes);
  if(report.comparison_basis!==DESIGN_CARRY_PREVIEW_BASIS&&report.input_basis!==DESIGN_CARRY_PREVIEW_BASIS)throw Error('Screenshot report lacks the explicit carry comparison basis');
  if(report.commit!==receipt.candidate.sha||report.financial_carry_preview?.receipt_sha256!==sha256(readBytes(receiptPath))||!isDeepStrictEqual(report.financial_carry_preview?.financial,receipt.financial)||report.release_accepted!==false||report.publication_authority!=='none'||report.ui_only_same_data!==false)throw Error('Screenshot report candidate/receipt binding mismatch');
  const result={schema:'design-financial-carry-preview-report-v1',publication_authority:'none',release_accepted:false,preview_receipt_sha256:sha256(readBytes(receiptPath)),report_sha256:sha256(reportBytes),report_files_sha256:inventoryDigest(completeInventory(dirname(reportPath))),candidate_sha:receipt.candidate.sha};
  freshWrite(join(dirname(receiptPath),'report-binding.json'),result);return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==3||process.execArgv.length)throw Error('Preview accepts only a named stage, no clocks or projection inputs');
  if(Object.keys(process.env).some(key=>key==='FINANCIAL_EVALUATED_AT'||key.startsWith('FINANCIAL_CORRECTION_')||key.startsWith('FINANCIAL_GENERATION_CARRY_')))throw Error('Preview does not accept caller-supplied financial clocks or overlays');
  const command=process.argv[2],work=join(process.env.RUNNER_TEMP||'/tmp','design-carry-preview'),options={receiptPath:join(work,'preview-receipt.json'),currentRoot:resolve('frontend/dist'),baselineRoot:join(process.env.RUNNER_TEMP||'/tmp','design-baseline/frontend/dist')};
  const run=command==='prepare'?()=>prepareDesignCarryPreview():command==='pack'?()=>packDesignCarryPreview():command==='verify'?()=>verifyDesignCarryPreview(options):command==='record-report'?()=>recordDesignCarryPreviewReport({...options,reportPath:resolve('frontend/test-results/design-review/report.json')}):null;
  if(!run)throw Error('Expected prepare, pack, verify or record-report');
  run().then(result=>console.log(JSON.stringify({schema:result.schema,publication_authority:'none',release_accepted:false})),error=>{console.error(error.stack||error);process.exitCode=1;});
}
