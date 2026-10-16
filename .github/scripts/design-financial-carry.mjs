// Read-only Design preparation. This contract is deliberately not a publication,
// activation, correction, renewal, or dated ordinary-execution receipt.
import {execFileSync} from 'node:child_process';
import {appendFileSync,cpSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {isDeepStrictEqual} from 'node:util';
import {checkedExport,verifyArchive} from './select-release-source.mjs';
import {githubApi,sameRepository,workflowPath} from './publication-gate.mjs';
import {uniqueArtifact} from './select-published-runs.mjs';
import {bootstrap,dataFiles,dataInventoryDigest,downloadArtifact,inventoryDigest,livePublication,safePath,sha256} from './publication-state.mjs';
import {completeInventory,restorePublishedFinancialSource} from './financial-release-activation.mjs';
import {FINANCIAL_AUDIT_MAX_FILE_BYTES,financialAuditInventory,requiredFinancialAuditFiles,assertFinancialAuditPreserved} from './financial-audit-history.mjs';
import {dataInventory,digest} from './financial-correction.mjs';
import {readCarryTargetBase,verifyCarriedBundle} from './financial-generation-carry-controller.mjs';
import {prepareCarryHistory} from './prepare-carry-history.mjs';
import {prepareHistoryReconciliation,writeHistoryPayloads,commitHistoryCatalogs,restorePackedHistory,verifyReconciledPerformance} from './reconcile-candidate-history.mjs';
import {assertPriceObservationBounds,extractPriceObservations,priceObservationDigest} from './price-observations.mjs';
import {assessRetainedUniverse,isEligibleForPublication} from './retained-universe.mjs';
import {DEFAULT_LIMITS} from '../../frontend/src/static/transport/format.mjs';

export const DESIGN_CARRY_SCHEMA='design-financial-carry-preview-v1';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const exact=(v,keys,label)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))throw Error(`Invalid closed Design carry ${label}`);};
const equal=(a,b,label)=>{if(!isDeepStrictEqual(a,b))throw Error(`Design carry ${label} changed`);};
const json=path=>JSON.parse(regular(path));
function regular(path,cap=FINANCIAL_AUDIT_MAX_FILE_BYTES){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>cap)throw Error('Invalid bounded Design carry evidence file');return readFileSync(path);}
function fileHash(path){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('Linked or special Design carry evidence');return execFileSync('sha256sum',[path],{encoding:'utf8'}).split(' ')[0];}
const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(value));};
const git=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
// Vite also consumes index.html, service workers and other public UI assets.
// Exempt only the explicitly prepared logical data, never other build inputs.
const codePaths=['.github','contracts','frontend','backend','data/ibd_reference',':(exclude)frontend/public/static-data',...dataFiles.map(path=>`:(exclude)frontend/public/${path}`)];
function codeIdentity(root,expected){
  for(const name of ['.env','.env.local','.env.production','.env.production.local'])if(existsSync(join(root,'frontend',name)))throw Error('Design carry rejects unbound local Vite environment files');
  const head=git(root,['rev-parse','HEAD']),tree=git(root,['rev-parse','HEAD^{tree}']);
  if(!sha(expected)||head!==expected)throw Error('Design carry requires its exact current checkout');
  git(root,['diff','--exit-code','HEAD','--',...codePaths]);
  if(git(root,['ls-files','--others','--exclude-standard','--',...codePaths]))throw Error('Untracked Design carry controller or consumer code');
  return {head,tree};
}
export function assertDesignCarryState(state,revision){
  if(state?.decision?.mode!=='design'||state.sourceSha!==revision||state.controllerSha!==revision
    ||['activation','correction','renewal','carry','ordinaryCarryAdmission','ordinaryCarryTooling','publisherTooling','sourceRecovery'].some(k=>Object.hasOwn(state,k))
    ||state.decision.migration||['repair','receiptHash','publication'].some(k=>Object.hasOwn(state.source||{},k))
    ||state.source?.manifest?.financial_generation!=null
    ||!positive(state.source?.artifact?.id)||!/^sha256:[a-f0-9]{64}$/.test(state.source.artifact.digest||'')
    ||!positive(state.source.runId)||!positive(state.source.attempt)||!hash(state.source.manifestHash)
    ||!state.live?.financialRelease||!state.live.receipt?.financial_release
    ||!hash(state.live.financialRelease.financial_generation)||!hash(state.live.financialRelease.lineage_sha256)
    ||!/^[1-9][0-9]*\/[1-9][0-9]*\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(state.live.identity||'')
    ||state.live.financialRelease.financial_generation!==state.live.receipt.financial_generation
    ||state.live.financialRelease.lineage_sha256!==state.live.receipt.financial_lineage_sha256)throw Error('Design carry requires ordinary checked Design input and its active financial predecessor');
  return state;
}
export function validateDesignCarryPreview(record){
  exact(record,['schema','publication_authority','financial_admission','ui_sha','ui_tree','baseline_sha','baseline_tree','source_financial_generation','financial_generation','financial_lineage_sha256','previous_publication_identity','logical_data_inventory_sha256','timestamps','caller','source','live','evidence','assessment'],'record');
  if(record.schema!==DESIGN_CARRY_SCHEMA||record.publication_authority!=='none'||record.financial_admission!==false)throw Error('Design carry preview has no publication or financial admission authority');
  for(const k of ['ui_sha','ui_tree','baseline_sha','baseline_tree'])if(!sha(record[k]))throw Error('Invalid Design carry code identity');
  for(const k of ['source_financial_generation','financial_generation','financial_lineage_sha256','logical_data_inventory_sha256'])if(!hash(record[k]))throw Error('Invalid Design carry generation/inventory identity');
  if(!/^[1-9][0-9]*\/[1-9][0-9]*\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(record.previous_publication_identity))throw Error('Invalid Design carry predecessor identity');
  exact(record.timestamps,['prepared_at','verified_at'],'timestamps');
  const times=Object.values(record.timestamps).map(Date.parse);
  if(times.some(t=>!Number.isSafeInteger(t))||times[0]>times[1]||times[1]>Date.now())throw Error('Design carry clock is invalid or in the future');
  exact(record.caller,['repository','run_id','run_attempt','event','head_sha','checkout_sha','started_at'],'caller');
  if(record.caller.repository!==bootstrap.repository||!positive(record.caller.run_id)||!positive(record.caller.run_attempt)||!['push','pull_request','workflow_dispatch'].includes(record.caller.event)||!sha(record.caller.head_sha)||record.caller.checkout_sha!==record.ui_sha||!Number.isFinite(Date.parse(record.caller.started_at))||Date.parse(record.caller.started_at)>times[0])throw Error('Invalid actual Design caller/clock binding');
  exact(record.source,['artifact_id','run_id','run_attempt','head_sha','artifact_sha256','manifest_sha256'],'source');
  for(const k of ['artifact_id','run_id','run_attempt'])if(!positive(record.source[k]))throw Error('Invalid Design source attempt');
  if(!sha(record.source.head_sha)||!hash(record.source.artifact_sha256)||!hash(record.source.manifest_sha256))throw Error('Invalid Design source hashes');
  exact(record.live,['identity','receipt_sha256','manifest_sha256','financial_generation','root_sha256'],'live');
  if(record.live.identity!==record.previous_publication_identity||Object.entries(record.live).some(([k,v])=>k!=='identity'&&!hash(v)))throw Error('Invalid Design live predecessor binding');
  exact(record.evidence,['files','source_input_sha256','predecessor_history_sha256','baseline_sha256','audit_inventory_sha256'],'evidence');
  for(const k of ['source_input_sha256','predecessor_history_sha256','baseline_sha256','audit_inventory_sha256'])if(!hash(record.evidence[k]))throw Error('Invalid Design evidence inventory');
  const expected=['state.json','attempt.json','source/artifact.zip','source/artifact.tar','companion/artifact.zip','companion/source.json','predecessor.json','history-responses.json','target-base.json','carry-projection.json','history-reconciliation.json','quality.log','retained-universe.json','assessment.json'];
  exact(record.evidence.files,expected,'evidence files');
  for(const [path,value]of Object.entries(record.evidence.files))if(!safePath(path)||!hash(value))throw Error('Invalid Design evidence file binding');
  exact(record.assessment,['compatibility','equality','retained_universe'],'assessment');
  if(!hash(record.assessment.compatibility)||!hash(record.assessment.equality)||!hash(record.assessment.retained_universe))throw Error('Invalid Design assessment binding');
  return record;
}
function sourceIdentity(source){return {artifact_id:source.artifact.id,run_id:source.runId,run_attempt:source.attempt,head_sha:source.artifact.workflow_run.head_sha,artifact_sha256:source.artifact.digest.slice(7),manifest_sha256:source.manifestHash};}
function liveIdentity(live){return {identity:live.identity,receipt_sha256:live.receiptHash,manifest_sha256:live.manifestHash,financial_generation:live.financialRelease.financial_generation,root_sha256:live.receipt.transport?.root.sha256};}
function copyData(source,destination){mkdirSync(destination,{recursive:true});cpSync(join(source,'static-data'),join(destination,'static-data'),{recursive:true,errorOnExist:true,force:false});for(const path of dataFiles)cpSync(join(source,path),join(destination,path),{errorOnExist:true,force:false});}
function extractData(source,archive,root){
  verifyArchive(source,archive);mkdirSync(root,{recursive:true});
  execFileSync('tar',['-xf',archive,'-C',root,'./static-data',...dataFiles.map(p=>'./'+p)],{stdio:'pipe'});
  const observations=extractPriceObservations({dataRoot:join(root,'static-data'),manifest:source.manifest});
  assertPriceObservationBounds(observations,source.artifact.created_at);
  if(priceObservationDigest(observations)!==source.priceObservationsDigest)throw Error('Design source price observations changed');
}
function safeEnvironment(evaluatedAt){
  const env={...process.env,FINANCIAL_EVALUATED_AT:evaluatedAt};
  for(const key of Object.keys(env))if(/^(?:FINANCIAL_CORRECTION_|FINANCIAL_GENERATION_CARRY_)/.test(key)||['GH_TOKEN','GITHUB_TOKEN','NODE_OPTIONS','NODE_PATH'].includes(key))delete env[key];
  return env;
}
function exporter(frontend,root,env,script='export-research.mjs'){
  if(root!==join(dirname(root),'public'))throw Error('Design data execution root must be named public');
  return execFileSync(process.execPath,['--max-old-space-size=4096',join(frontend,'tools',script)],{cwd:dirname(root),env,encoding:'utf8',maxBuffer:8*1024*1024});
}
// The exporter resolves ../data/ibd_reference relative to its execution cwd.
// Replay must receive the same checked reference bytes, never an empty fallback.
export function stageDesignReplayReferences(repoRoot,scratch){
  const source=join(repoRoot,'data/ibd_reference'),target=join(scratch,'data/ibd_reference');
  for(const path of [repoRoot,scratch,join(repoRoot,'data'),source,join(source,'ibd50')]){
    const info=lstatSync(path);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Linked or missing Design reference directory');
  }
  git(repoRoot,['diff','--exit-code','HEAD','--','data/ibd_reference']);
  if(git(repoRoot,['ls-files','--others','--','data/ibd_reference']))throw Error('Untracked Design reference input');
  const expected=completeInventory(source);
  for(const path of Object.keys(expected)){
    const info=lstatSync(join(source,path));if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw Error('Linked or special Design reference file');
  }
  mkdirSync(join(scratch,'data'));
  cpSync(source,target,{recursive:true,errorOnExist:true,force:false});
  equal(completeInventory(source),expected,'original replay references');
  equal(completeInventory(target),expected,'copied replay references');
  return inventoryDigest(expected);
}
async function prepareBaseline({root,frontend,evidence,state,evaluatedAt}){
  const plan=await prepareHistoryReconciliation({selectedRoot:join(root,'static-data'),publishedRoot:join(evidence,'predecessor/static-data'),selectedAt:state.source.artifact.created_at,publishedAt:new Date(state.live.latest.completed).toISOString()});
  writeHistoryPayloads(plan);commitHistoryCatalogs(plan);
  const audits=financialAuditInventory(join(evidence,'financial-source'));
  for(const [path]of Object.entries(audits)){
    const target=join(root,path);mkdirSync(dirname(target),{recursive:true});
    if(existsSync(target)){if(fileHash(target)!==audits[path])throw Error('Conflicting Design audit source');}
    else cpSync(join(evidence,'financial-source',path),target,{errorOnExist:true,force:false});
  }
  exporter(frontend,root,safeEnvironment(evaluatedAt));
  const target=await readCarryTargetBase({root,frontendRoot:frontend});prepareCarryHistory({root,targetInput:target});
  return {target,history:plan.summary};
}
async function coverage(frontend,root,symbols){
  const manifest=json(join(root,'static-data/manifest.json')),path=manifest.markets?.US?.assets?.research?.path;
  if(!safePath(path))throw Error('Invalid Design retained universe reference');
  const {decodeResearchIndex}=await import(pathToFileURL(join(frontend,'src/static/researchTransport.js')).href);
  const index=decodeResearchIndex(json(join(root,'static-data',path))),previous=new Set(symbols),charts=new Map();
  if(index.as_of_date!==manifest.markets.US.as_of_date)throw Error('Design retained universe date mismatch');
  for(const row of index.rows||[])if(previous.has(row.symbol)&&!isEligibleForPublication(row)&&safePath(row.chart_path)){
    try{charts.set(row.symbol,json(join(root,'static-data',row.chart_path)));}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const report=assessRetainedUniverse({previousSymbols:symbols,rows:index.rows,asOfDate:index.as_of_date,charts});
  if(!report.passed)throw Error('Design carry failed the unchanged retained-universe threshold');
  return report;
}
function carryEnv(evidence,carry){return {...safeEnvironment(carry.financial_evaluated_at),FINANCIAL_GENERATION_CARRY_PROJECTION:join(evidence,'carry-projection.json'),FINANCIAL_GENERATION_CARRY_SHA256:fileHash(join(evidence,'carry-projection.json')),FINANCIAL_GENERATION_CARRY_SOURCE_LINEAGE:carry.bindings.source_lineage_sha256,FINANCIAL_GENERATION_CARRY_PREVIOUS_IDENTITY:carry.bindings.previous_publication_identity,FINANCIAL_GENERATION_CARRY_TARGET_BASE_SHA256:carry.bindings.target_base_sha256};}
async function authenticateSource(state,evidence){
  const repo=bootstrap.repository,pages=githubApi(`repos/${repo}/actions/artifacts?per_page=100`,true),artifact=pages.flatMap(p=>p.artifacts).find(a=>a.id===state.source.artifact.id);
  if(!artifact)throw Error('Selected Design source is no longer retained');
  const companion=uniqueArtifact(pages,`static-site-data-manifest-${state.source.runId}-${state.source.attempt}`,state.source.runId),calls={};
  const api=(path,paginated=false)=>{const value=githubApi(path,paginated);calls[`${paginated?'pages:':'one:'}${path}`]=value;return value;};
  const load=()=>{downloadArtifact(companion,join(evidence,'companion'),repo,'source.json',64*1024**2);return json(join(evidence,'companion/source.json'));};
  const checked=checkedExport(artifact,pages,repo,api,load);
  if(!checked||checked.repair)throw Error('Design carry requires a checked ordinary source');
  equal(checked,state.source,'checked source');
  const proof={pages:[{artifacts:[artifact,companion]}],calls};write(join(evidence,'attempt.json'),proof);
  downloadArtifact(checked.artifact,join(evidence,'source'),repo,'artifact.tar');verifyArchive(checked,join(evidence,'source/artifact.tar'));
  return proof;
}
function replaySource(state,evidence){
  const proof=json(join(evidence,'attempt.json'));
  const api=(path,paginated=false)=>{const key=`${paginated?'pages:':'one:'}${path}`;if(!Object.hasOwn(proof.calls,key))throw Error('Unrecorded Design attempt evidence');return proof.calls[key];};
  const companion=uniqueArtifact(proof.pages,`static-site-data-manifest-${state.source.runId}-${state.source.attempt}`,state.source.runId);
  // downloadArtifact verifies retained ZIP bytes before decoding; no download is
  // possible because both required ZIPs were checked above and must exist.
  downloadArtifact(companion,join(evidence,'companion'),bootstrap.repository,'source.json',64*1024**2);
  const artifact=proof.pages.flatMap(p=>p.artifacts).find(a=>a.id===state.source.artifact.id);
  const source=checkedExport(artifact,proof.pages,bootstrap.repository,api,()=>json(join(evidence,'companion/source.json')));
  equal(source,state.source,'replayed checked source');
  downloadArtifact(source.artifact,join(evidence,'source'),bootstrap.repository,'artifact.tar');verifyArchive(source,join(evidence,'source/artifact.tar'));
}
export async function readDesignHistoryResponse(response,budget){
  if(!response.ok||!response.body||!budget||!Number.isSafeInteger(budget.bytes)||budget.bytes<0)throw Error('Invalid Design history response');
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>DEFAULT_LIMITS.encodedBytes))throw Error('Design history response exceeds unchanged encoded cap');
  const chunks=[];let size=0;
  for await(const chunk of response.body){
    size+=chunk.length;budget.bytes+=chunk.length;
    if(size>DEFAULT_LIMITS.encodedBytes||budget.bytes>512*1024*1024)throw Error('Design history response exceeds bounded retention budget');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function captureHistory(live,evidence){
  // Every accepted active predecessor must expose the independently pinned
  // packed history closure. A raw/unsupported predecessor remains blocked.
  if(!live.receipt?.transport?.root)throw Error('Design carry requires authenticated packed predecessor history');
  const files={},budget={bytes:0};
  const fetcher=async(url,options)=>{
    const response=await fetch(url,options);if(!response.ok)throw Error(`Cannot retain Design history: ${response.status}`);
    const bytes=await readDesignHistoryResponse(response,budget),key=new URL(url).pathname,name=sha256(key)+'.bin',path=join(evidence,'history-responses',name);
    if(Object.keys(files).length>=20000)throw Error('Design history response count exceeds bounded retention');
    if(files[key]&&files[key].sha256!==sha256(bytes))throw Error('Design history response changed');
    mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);files[key]={path:`history-responses/${name}`,bytes:bytes.length,sha256:sha256(bytes)};
    return new Response(bytes,{status:200,headers:response.headers});
  };
  await restorePackedHistory({expectedRoot:live.receipt.transport.root,root:join(evidence,'predecessor/static-data'),fetcher});
  write(join(evidence,'predecessor.json'),{identity:live.identity,receipt_sha256:live.receiptHash,root:live.receipt.transport.root});write(join(evidence,'history-responses.json'),files);
}
async function replayHistory(state,evidence,destination){
  const proof=json(join(evidence,'predecessor.json')),files=json(join(evidence,'history-responses.json'));
  equal(proof,{identity:state.live.identity,receipt_sha256:state.live.receiptHash,root:state.live.receipt.transport.root},'history predecessor');
  const fetcher=async url=>{
    const entry=files[new URL(url).pathname];
    if(!entry||!safePath(entry.path)||!/^history-responses\/[a-f0-9]{64}\.bin$/.test(entry.path))throw Error('Missing bound Design history response');
    const bytes=regular(join(evidence,entry.path),256*1024*1024);
    if(bytes.length!==entry.bytes||sha256(bytes)!==entry.sha256)throw Error('Design history response changed');
    return new Response(bytes,{status:200});
  };
  await restorePackedHistory({expectedRoot:proof.root,root:join(destination,'static-data'),fetcher});
  equal(dataInventory(destination),dataInventory(join(evidence,'predecessor')),'replayed predecessor history');
}
function callerContext(repoRoot){
  if((process.execArgv.length&&!(process.execArgv.length===1&&process.execArgv[0]==='--max-old-space-size=4096'))||process.env.NODE_OPTIONS||process.env.NODE_PATH||Object.keys(process.env).some(k=>/^(?:FINANCIAL_CORRECTION_|FINANCIAL_GENERATION_CARRY_)/.test(k)||k==='FINANCIAL_EVALUATED_AT'||k==='FINANCIAL_CANDIDATE_DIR'))throw Error('Design carry accepts no alternate authority, runtime hooks or clock');
  if(process.env.GITHUB_REPOSITORY!==bootstrap.repository||!['push','pull_request','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME))throw Error('Design carry is limited to its Design context');
  const runId=Number(process.env.GITHUB_RUN_ID),attempt=Number(process.env.GITHUB_RUN_ATTEMPT);
  if(!positive(runId)||!positive(attempt))throw Error('Missing actual Design attempt');
  const run=githubApi(`repos/${bootstrap.repository}/actions/runs/${runId}/attempts/${attempt}`);
  if(!sameRepository(run,bootstrap.repository)||run.id!==runId||run.run_attempt!==attempt||run.path!==workflowPath('design-acceptance.yml')||run.event!==process.env.GITHUB_EVENT_NAME||run.status!=='in_progress')throw Error('Caller is not its active Design attempt');
  const code=codeIdentity(repoRoot,process.env.GITHUB_SHA);
  if(run.event==='pull_request'){
    const event=json(process.env.GITHUB_EVENT_PATH),pull=event.pull_request;
    if(!pull||run.head_sha!==pull.head?.sha||process.env.GITHUB_REF!==`refs/pull/${event.number}/merge`
      ||git(repoRoot,['rev-parse','HEAD^1'])!==pull.base?.sha||git(repoRoot,['rev-parse','HEAD^2'])!==pull.head.sha)throw Error('Design run does not bind its exact PR merge checkout');
  }else if(run.head_sha!==code.head)throw Error('Design run head differs from its exact checkout');
  const started=run.run_started_at||run.created_at;
  if(!Number.isFinite(Date.parse(started))||Date.parse(started)>Date.now())throw Error('Invalid actual Design run clock');
  return {code,caller:{repository:bootstrap.repository,run_id:runId,run_attempt:attempt,event:run.event,head_sha:run.head_sha,checkout_sha:code.head,started_at:started}};
}
export async function prepareDesignCarryPreview({provenancePath,baselineRepo,repoRoot=process.cwd()}){
  repoRoot=resolve(repoRoot);provenancePath=resolve(provenancePath);baselineRepo=resolve(baselineRepo);
  const state=json(provenancePath),manifest=json(join(repoRoot,'frontend/public/static-data/manifest.json'));
  if(state.decision?.mode!=='design')throw Error('Not a Design input');
  if(!state.live?.financialRelease||manifest.financial_generation===state.live.financialRelease.financial_generation)return {preview:false};
  const context=callerContext(repoRoot),code=context.code;assertDesignCarryState(state,code.head);
  if(baselineRepo!==join(dirname(provenancePath),'design-baseline'))throw Error('Design requires its exact isolated comparison checkout');
  const baseline=codeIdentity(baselineRepo,git(baselineRepo,['rev-parse','HEAD'])),frontend=join(repoRoot,'frontend'),root=join(frontend,'public');
  const evidence=join(dirname(provenancePath),'design-carry-evidence');
  if(existsSync(evidence))throw Error('Design carry preparation is single-use; retain failed evidence');mkdirSync(evidence);
  write(join(evidence,'state.json'),state);
  const live=await livePublication();equal(live,state.live,'authenticated complete predecessor');
  await authenticateSource(state,evidence);await captureHistory(live,evidence);await restorePublishedFinancialSource(live,join(evidence,'financial-source'));
  const raw=join(evidence,'source-input');extractData(state.source,join(evidence,'source/artifact.tar'),raw);
  // Do not use the materializer's mutable copy as an authentication shortcut.
  equal(completeInventory(join(root,'static-data')),completeInventory(join(raw,'static-data')),'selected source');
  rmSync(join(root,'static-data'),{recursive:true});for(const file of dataFiles)rmSync(join(root,file),{force:true});copyData(raw,root);
  const evaluatedAt=new Date().toISOString(),prepared=await prepareBaseline({root,frontend,evidence,state,evaluatedAt});
  copyData(root,join(evidence,'baseline'));write(join(evidence,'history-reconciliation.json'),prepared.history);
  writeFileSync(join(evidence,'target-base.json'),prepared.target.bytes);
  const previous=state.live.financialRelease,helper=await import(pathToFileURL(join(frontend,'tools/financial-generation-carry.mjs')).href);
  const carry=helper.createFinancialGenerationCarry({sourceProjection:regular(join(evidence,'financial-source',previous.source_projection.path)),sourceProjectionSha256:previous.source_projection.sha256,sourceBase:regular(join(evidence,'financial-source',previous.source_base.path)),sourceBaseSha256:previous.source_base.sha256,sourceLineage:previous.lineage_sha256,previousPublicationIdentity:live.identity,targetBase:prepared.target.bytes,targetBaseSha256:sha256(prepared.target.bytes),evaluatedAt});
  const carryBytes=JSON.stringify(carry);if(Buffer.byteLength(carryBytes)>FINANCIAL_AUDIT_MAX_FILE_BYTES)throw Error('Design carry exceeds the unchanged audit cap');writeFileSync(join(evidence,'carry-projection.json'),carryBytes);
  const env=carryEnv(evidence,carry);await helper.loadFinancialGenerationCarry({env,rows:prepared.target.rows,asOfDate:prepared.target.asOfDate});
  exporter(frontend,root,env);exporter(frontend,root,env,'record-candidate-history.mjs');
  try{writeFileSync(join(evidence,'quality.log'),exporter(frontend,root,env,'check-data-quality.mjs'));}
  catch(error){writeFileSync(join(evidence,'quality.log'),String(error.stdout||'')+'\n'+String(error.stderr||'')+'\n'+error.message);throw error;}
  const retained=await coverage(frontend,root,live.verificationUniverse.required_symbols);write(join(evidence,'retained-universe.json'),retained);
  const assessed=await verifyCarriedBundle({baselineRoot:join(evidence,'baseline'),root,frontendRoot:frontend,carry,evaluatedAt:Date.now()});write(join(evidence,'assessment.json'),assessed);
  await verifyReconciledPerformance({baselineRoot:join(evidence,'baseline/static-data'),finalRoot:join(root,'static-data'),publishedRoot:join(evidence,'predecessor/static-data'),publishedAt:new Date(live.latest.completed).toISOString()});
  equal(financialAuditInventory(root),financialAuditInventory(join(evidence,'financial-source')),'original financial audit inventory');
  // Detect source, predecessor or checkout changes before finalizing. The saved
  // proof is the independently checked bytes, not a caller's success claim.
  const proofBefore=fileHash(join(evidence,'attempt.json'));await authenticateSource(state,evidence);if(fileHash(join(evidence,'attempt.json'))!==proofBefore)throw Error('Design source attempt changed during preparation');
  const finalLive=await livePublication();equal(finalLive,live,'final complete predecessor');equal(callerContext(repoRoot),context,'final Design caller');equal(codeIdentity(repoRoot,code.head),code,'final code');equal(codeIdentity(baselineRepo,baseline.head),baseline,'final baseline');
  const record={schema:DESIGN_CARRY_SCHEMA,publication_authority:'none',financial_admission:false,ui_sha:code.head,ui_tree:code.tree,baseline_sha:baseline.head,baseline_tree:baseline.tree,source_financial_generation:carry.source_financial_generation,financial_generation:carry.financial_generation,financial_lineage_sha256:previous.lineage_sha256,previous_publication_identity:live.identity,logical_data_inventory_sha256:dataInventoryDigest(root),timestamps:{prepared_at:evaluatedAt,verified_at:new Date().toISOString()},caller:context.caller,source:sourceIdentity(state.source),live:liveIdentity(live),evidence:{files:{},source_input_sha256:dataInventoryDigest(raw),predecessor_history_sha256:dataInventoryDigest(join(evidence,'predecessor')),baseline_sha256:dataInventoryDigest(join(evidence,'baseline')),audit_inventory_sha256:inventoryDigest(financialAuditInventory(join(evidence,'financial-source')))},assessment:{compatibility:digest(assessed.compatibility),equality:digest(assessed.equality),retained_universe:digest(retained)}};
  for(const path of ['state.json','attempt.json','source/artifact.zip','source/artifact.tar','companion/artifact.zip','companion/source.json','predecessor.json','history-responses.json','target-base.json','carry-projection.json','history-reconciliation.json','quality.log','retained-universe.json','assessment.json'])record.evidence.files[path]=fileHash(join(evidence,path));
  validateDesignCarryPreview(record);write(provenancePath,record);
  if(process.env.GITHUB_ENV)appendFileSync(process.env.GITHUB_ENV,`DESIGN_CARRY_PREVIEW_PROVENANCE=${provenancePath}\nDESIGN_COMPARISON_BASELINE=${join(baselineRepo,'frontend/dist')}\n`);
  return record;
}
export async function verifyDesignCarryPreview({provenancePath,root,baselineRoot,repoRoot=process.cwd(),frontendRoot=join(repoRoot,'frontend')}){
  provenancePath=resolve(provenancePath);root=resolve(root);repoRoot=resolve(repoRoot);frontendRoot=resolve(frontendRoot);
  if(frontendRoot!==join(repoRoot,'frontend')||lstatSync(frontendRoot).isSymbolicLink())throw Error('Design verifier must execute the exact checked frontend');
  const rawRecord=regular(provenancePath,16*1024*1024),record=validateDesignCarryPreview(JSON.parse(rawRecord)),evidence=join(dirname(provenancePath),'design-carry-evidence');
  equal(codeIdentity(repoRoot,record.ui_sha),{head:record.ui_sha,tree:record.ui_tree},'verifier code');
  for(const [path,hash]of Object.entries(record.evidence.files))if(fileHash(join(evidence,path))!==hash)throw Error(`Design carry evidence changed: ${path}`);
  const state=assertDesignCarryState(json(join(evidence,'state.json')),record.ui_sha);
  if(Date.parse(record.timestamps.prepared_at)<Date.parse(state.source.artifact.created_at))throw Error('Design preparation predates the authenticated source');
  equal(sourceIdentity(state.source),record.source,'source record');equal(liveIdentity(state.live),record.live,'live record');
  const baselineRepo=join(dirname(provenancePath),'design-baseline');
  if(!baselineRoot||resolve(baselineRoot)!==join(baselineRepo,'frontend/dist'))throw Error('Design verifier requires its exact raw comparison build');
  equal(codeIdentity(baselineRepo,record.baseline_sha),{head:record.baseline_sha,tree:record.baseline_tree},'comparison checkout');
  const context=callerContext(repoRoot);equal(context.caller,record.caller,'authenticated Design caller');
  const live=await livePublication();equal(live,state.live,'reauthenticated complete predecessor');
  await authenticateSource(state,evidence);
  for(const [path,hash]of Object.entries(record.evidence.files))if(fileHash(join(evidence,path))!==hash)throw Error(`Reauthenticated Design evidence changed: ${path}`);
  replaySource(state,evidence);
  const scratch=mkdtempSync(join(tmpdir(),'verify-design-carry-'));
  try{
    stageDesignReplayReferences(repoRoot,scratch);
    const replay=join(scratch,'replay/public');extractData(state.source,join(evidence,'source/artifact.tar'),replay);
    if(dataInventoryDigest(replay)!==record.evidence.source_input_sha256)throw Error('Design original input inventory changed');
    await replayHistory(state,evidence,join(scratch,'history'));
    if(dataInventoryDigest(join(evidence,'predecessor'))!==record.evidence.predecessor_history_sha256)throw Error('Design predecessor history changed');
    const audit=financialAuditInventory(join(evidence,'financial-source'));assertFinancialAuditPreserved(requiredFinancialAuditFiles(state.live),audit);
    if(inventoryDigest(audit)!==record.evidence.audit_inventory_sha256)throw Error('Design source audit inventory changed');
    const prepared=await prepareBaseline({root:replay,frontend:frontendRoot,evidence,state,evaluatedAt:record.timestamps.prepared_at});
    equal(prepared.history,json(join(evidence,'history-reconciliation.json')),'history reconciliation');
    if(dataInventoryDigest(replay)!==record.evidence.baseline_sha256||dataInventoryDigest(join(evidence,'baseline'))!==record.evidence.baseline_sha256)throw Error('Design complete nonfinancial baseline changed');
    if(prepared.target.bytes!==regular(join(evidence,'target-base.json')).toString())throw Error('Design carry target input changed');
    const carry=json(join(evidence,'carry-projection.json')),helper=await import(pathToFileURL(join(frontendRoot,'tools/financial-generation-carry.mjs')).href);
    await helper.loadFinancialGenerationCarry({env:carryEnv(evidence,carry),rows:prepared.target.rows,asOfDate:prepared.target.asOfDate});
    if(carry.financial_evaluated_at!==record.timestamps.prepared_at||carry.financial_generation!==record.financial_generation||carry.source_financial_generation!==record.source_financial_generation||carry.bindings.source_lineage_sha256!==record.financial_lineage_sha256||carry.bindings.previous_publication_identity!==record.previous_publication_identity)throw Error('Design carry derivation identity changed');
    const previous=state.live.financialRelease;
    if(carry.source_projection_json!==regular(join(evidence,'financial-source',previous.source_projection.path)).toString()||carry.source_base_json!==regular(join(evidence,'financial-source',previous.source_base.path)).toString())throw Error('Design carry substituted its original source');
    if(dataInventoryDigest(root)!==record.logical_data_inventory_sha256||baselineRoot&&dataInventoryDigest(resolve(baselineRoot))!==record.logical_data_inventory_sha256)throw Error('Design comparison logical data differs');
    equal(financialAuditInventory(root),audit,'retained original audit');
    const assessed=await verifyCarriedBundle({baselineRoot:replay,root,frontendRoot,carry,evaluatedAt:Date.now()});
    // The unchanged verifier checks availability at the actual current clock.
    equal(json(join(evidence,'assessment.json')),{compatibility:assessed.compatibility,equality:assessed.equality},'retained complete assessment');
    write(join(dirname(provenancePath),'design-carry-verifier-reports',`${Date.now()}-${process.pid}.json`),{checked_at:new Date().toISOString(),publication_authority:'none',...assessed});
    if(digest(assessed.compatibility)!==record.assessment.compatibility)throw Error('Design current financial compatibility changed');
    if(digest(assessed.equality)!==record.assessment.equality)throw Error('Design price/nonfinancial equality changed');
    await verifyReconciledPerformance({baselineRoot:join(replay,'static-data'),finalRoot:join(root,'static-data'),publishedRoot:join(evidence,'predecessor/static-data'),publishedAt:new Date(state.live.latest.completed).toISOString()});
    const retained=await coverage(frontendRoot,root,state.live.verificationUniverse.required_symbols);
    if(digest(retained)!==record.assessment.retained_universe)throw Error('Design retained universe changed');
    for(const [path,hash]of Object.entries(record.evidence.files))if(fileHash(join(evidence,path))!==hash)throw Error(`Design carry evidence changed during verification: ${path}`);
    if(sha256(regular(provenancePath,16*1024*1024))!==sha256(rawRecord))throw Error('Design provenance changed during verification');
    equal(codeIdentity(repoRoot,record.ui_sha),{head:record.ui_sha,tree:record.ui_tree},'final verifier code');
    equal(codeIdentity(baselineRepo,record.baseline_sha),{head:record.baseline_sha,tree:record.baseline_tree},'final comparison checkout');
    equal(callerContext(repoRoot).caller,record.caller,'final authenticated Design caller');
    equal(await livePublication(),state.live,'final reauthenticated complete predecessor');
    await authenticateSource(state,evidence);
    for(const [path,hash]of Object.entries(record.evidence.files))if(fileHash(join(evidence,path))!==hash)throw Error(`Final Design source evidence changed: ${path}`);
    return record;
  }finally{rmSync(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [command,provenance,baseline]=process.argv.slice(2);
  if(command==='prepare'&&process.argv.length===5)prepareDesignCarryPreview({provenancePath:provenance,baselineRepo:baseline}).then(r=>console.log(JSON.stringify(r)),e=>{console.error(e.stack||e);process.exitCode=1;});
  else if(command==='verify'&&process.argv.length===5)verifyDesignCarryPreview({provenancePath:provenance,root:join(process.cwd(),'frontend/public'),baselineRoot:baseline}).then(r=>console.log(JSON.stringify({schema:r.schema,verified:true,publication_authority:'none'})),e=>{console.error(e.stack||e);process.exitCode=1;});
  else {console.error('Expected design-financial-carry.mjs prepare PROVENANCE BASELINE_REPOSITORY or verify PROVENANCE RAW_COMPARISON');process.exitCode=1;}
}
