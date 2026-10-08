// Separately admitted ordinary publisher data tooling. This has no finite
// request/replay authority and never changes the source compiler or browser UI.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {PUBLISHER_TOOLING,PUBLISHER_EXPORT_ARTIFACT,verifyPublisherToolingCheckout} from './retained-price-publisher-tooling.mjs';

const freeze=value=>{for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);};
export const ORDINARY_PUBLISHER_TOOLING=freeze({
  schema_version:'ordinary-publisher-tooling-identity-v1',
  amendment_id:'ordinary-carry-chart-projection-v1',
  repository:'kusennjp1-ai/screener',role:'ordinary_publisher_carry_only',
  source_compiler:'unchanged_authenticated_ordinary_source_workflow',browser_assets:'equal_approved_predecessor_only',
  base:PUBLISHER_TOOLING.base,amended:PUBLISHER_TOOLING.amended,files:PUBLISHER_TOOLING.files,
  workflow:{path:'.github/workflows/research-ui-release.yml',git_blob_sha:'0dc266577534275913b4daa23c229feb634c7511'}
});
const pin=ORDINARY_PUBLISHER_TOOLING.files[0],repo=ORDINARY_PUBLISHER_TOOLING.repository,prefix='repos/'+repo;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const blob=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const equal=(a,b,why)=>assert.deepEqual(ordered(a),ordered(b),why);
const closed=(v,keys,why)=>{assert(v&&typeof v==='object'&&!Array.isArray(v),why);equal(Object.keys(v).sort(),[...keys].sort(),why);};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const gitHash=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const iso=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT.*Z$/.test(v)&&Number.isFinite(Date.parse(v));
const identity=v=>typeof v==='string'&&/^\d+\/\d+\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(v);
const regular=(path,cap=64*1024**2)=>{const stat=lstatSync(path);assert(stat.isFile()&&!stat.isSymbolicLink()&&realpathSync(path)===resolve(path)&&stat.size<=cap,'Unsafe ordinary tooling input '+path);return readFileSync(path);};
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024**2,timeout:120000});
const sameRepo=run=>['repository','head_repository'].every(key=>run?.[key]?.full_name===repo&&run[key].id===1203919607);
const runShape=run=>({id:run.id,run_attempt:run.run_attempt,head_sha:run.head_sha,head_branch:run.head_branch,path:run.path,workflow_id:run.workflow_id,event:run.event,status:run.status,conclusion:run.conclusion,run_started_at:run.run_started_at});
function pages(api,endpoint,key){
  const values=api(endpoint,true);assert(Array.isArray(values)&&values.length>0&&values.length<=100,'Incomplete ordinary source inventory');
  const total=values[0].total_count;assert(Number.isSafeInteger(total)&&total>=0&&values.every(v=>v.total_count===total&&Array.isArray(v[key])),'Invalid ordinary inventory count');
  const all=values.flatMap(v=>v[key]);assert(all.length===total&&all.every(v=>positive(v.id))&&new Set(all.map(v=>v.id)).size===all.length,'Missing or duplicate ordinary inventory');return all;
}
function archiveIdentity(artifact){
  assert(positive(artifact?.id)&&positive(artifact.size_in_bytes)&&typeof artifact.name==='string'&&/^sha256:[a-f0-9]{64}$/.test(artifact.digest||'')
    &&iso(artifact.created_at)&&iso(artifact.expires_at),'Invalid ordinary artifact identity');
  return {id:artifact.id,name:artifact.name,bytes:artifact.size_in_bytes,sha256:artifact.digest.slice(7),created_at:artifact.created_at,expires_at:artifact.expires_at};
}
export function ordinaryPublisherToolingEligible(state){
  return Boolean(state?.source&&!state.source.repair&&!state.source.receiptHash&&!state.source.publication&&state.source.companion
    &&state.carry&&state.decision?.mode==='data'&&!state.correction&&!state.activation&&!state.renewal&&!state.decision.migration
    &&state.sourceSha===ORDINARY_PUBLISHER_TOOLING.base.sha&&state.live?.uiSha===ORDINARY_PUBLISHER_TOOLING.base.sha);
}
export function validateOrdinaryPublisherToolingIdentity(value){equal(value,ORDINARY_PUBLISHER_TOOLING,'Unreviewed ordinary publisher tooling identity');return value;}
export function validateOrdinaryPublisherToolingContext(state,context){
  assert(ordinaryPublisherToolingEligible(state)&&!state.publisherTooling,'Ordinary tooling requires exclusive original-UI ordinary data carry');
  const {execution,caller,callerCurrent,callerJob,controller,sourceRun,sourceCurrent,sourceJob,source,live,decision,now}=context;
  assert(Number.isFinite(now)&&decision?.publish&&controller.head===state.controllerSha&&gitHash(controller.head)&&gitHash(controller.tree),'Ordinary controller/publication gate changed');
  assert(execution.repository===repo&&execution.repository_id===1203919607&&execution.ref==='refs/heads/main'
    &&['workflow_run','workflow_dispatch'].includes(execution.event_name)&&positive(execution.run_id)&&positive(execution.run_attempt)
    &&execution.release_sha===controller.head&&execution.workflow_ref===repo+'/'+ORDINARY_PUBLISHER_TOOLING.workflow.path+'@refs/heads/main'
    &&gitHash(execution.workflow_sha)&&context.executingWorkflowBlob===ORDINARY_PUBLISHER_TOOLING.workflow.git_blob_sha,'Unadmitted executing ordinary workflow');
  equal(runShape(callerCurrent),runShape(caller),'Ordinary caller is no longer its current attempt');
  assert(caller.id===execution.run_id&&caller.run_attempt===execution.run_attempt&&caller.head_sha===execution.sha
    &&caller.path===ORDINARY_PUBLISHER_TOOLING.workflow.path&&caller.workflow_id===364666954&&caller.head_branch==='main'
    &&caller.event===execution.event_name&&caller.status==='in_progress'&&caller.conclusion===null&&sameRepo(caller)&&sameRepo(callerCurrent)
    &&iso(caller.run_started_at)&&Date.parse(caller.run_started_at)<=now,'Wrong active ordinary caller');
  assert(callerJob.name==='publish'&&callerJob.id>0&&callerJob.run_id===caller.id&&callerJob.run_attempt===caller.run_attempt
    &&callerJob.head_sha===caller.head_sha&&callerJob.status==='in_progress'&&callerJob.conclusion===null&&iso(callerJob.started_at)
    &&Date.parse(callerJob.started_at)>=Date.parse(caller.run_started_at)&&Date.parse(callerJob.started_at)<=now
    &&now<Date.parse(callerJob.started_at)+360*60000,'Ordinary publisher job or existing 360-minute budget changed');
  equal(runShape(sourceCurrent),runShape(sourceRun),'Ordinary source attempt was superseded');
  assert(sourceRun.id===state.source.runId&&sourceRun.run_attempt===state.source.attempt&&sourceRun.head_branch==='main'
    &&sourceRun.path==='.github/workflows/static-site.yml'&&sourceRun.workflow_id===294257497
    &&['schedule','workflow_dispatch'].includes(sourceRun.event)&&sourceRun.status==='completed'&&sameRepo(sourceRun)&&sameRepo(sourceCurrent)
    &&iso(sourceRun.run_started_at),'Wrong genuine ordinary source');
  assert(sourceJob.name==='combine-and-build'&&positive(sourceJob.id)&&sourceJob.run_id===sourceRun.id&&sourceJob.run_attempt===sourceRun.run_attempt
    &&sourceJob.head_sha===sourceRun.head_sha&&sourceJob.status==='completed'&&sourceJob.conclusion==='success'
    &&iso(sourceJob.started_at)&&iso(sourceJob.completed_at)&&Date.parse(sourceJob.started_at)>=Date.parse(sourceRun.run_started_at)
    &&Date.parse(sourceJob.completed_at)>=Date.parse(sourceJob.started_at)&&Date.parse(sourceJob.completed_at)<=now,'Ordinary producer job changed');
  for(const name of ['Build static frontend','Upload verified data export','Preserve dated export provenance for release selection']){
    const steps=sourceJob.steps?.filter(s=>s.name===name);assert(steps?.length===1&&steps[0].status==='completed'&&steps[0].conclusion==='success'
      &&iso(steps[0].started_at)&&iso(steps[0].completed_at)&&Date.parse(steps[0].started_at)>=Date.parse(sourceJob.started_at)
      &&Date.parse(steps[0].completed_at)>=Date.parse(steps[0].started_at)&&Date.parse(steps[0].completed_at)<=Date.parse(sourceJob.completed_at),'Ordinary producer step changed '+name);
  }
  assert(source.artifact.name==='static-site-data-'+sourceRun.id+'-'+sourceRun.run_attempt&&source.companion.name==='static-site-data-manifest-'+sourceRun.id+'-'+sourceRun.run_attempt,'Ordinary source archive name changed');
  for(const artifact of [source.artifact,source.companion]){
    archiveIdentity(artifact);assert(artifact.expired===false&&Date.parse(artifact.expires_at)>now&&artifact.workflow_run?.id===sourceRun.id
      &&artifact.workflow_run.head_sha===sourceRun.head_sha&&artifact.workflow_run.head_branch==='main'
      &&artifact.workflow_run.repository_id===1203919607&&artifact.workflow_run.head_repository_id===1203919607
      &&Date.parse(artifact.created_at)>=Date.parse(sourceJob.started_at)&&Date.parse(artifact.created_at)<=Date.parse(sourceJob.completed_at),'Ordinary source artifact origin/expiry changed');
  }
  equal(source,state.source,'Ordinary checked source or companion changed');
  assert(context.sourceAdvance===true,'Missing genuine ordinary source advance');
  assert(live.identity===state.live.identity&&live.uiSha===state.live.uiSha&&live.uiDigest===state.live.uiDigest
    &&hash(live.financialRelease?.lineage_sha256)&&hash(live.financialRelease.financial_generation),'Ordinary live predecessor/financial source changed');
  equal(live.approval,state.live.approval,'Ordinary historical UI approval changed');equal(live.financialRelease,state.live.financialRelease,'Ordinary predecessor financial receipt changed');
  assert(hash(context.metadataSha256)&&gitHash(context.sourceTree),'Unbound ordinary source metadata/tree');return context;
}
// The selected checkout is independently fingerprinted with the existing exact
// one-file validator. Here bind the controller imports/index and permit only the
// independently verified nested selected checkout as an untracked caller input.
export function verifyOrdinaryControllerCheckout(root,head,tree){
  root=resolve(root);assert(realpathSync(root)===root&&lstatSync(root).isDirectory(),'Linked ordinary controller');
  assert.equal(git(root,'rev-parse','--show-toplevel').trim(),root);assert.equal(git(root,'rev-parse','HEAD').trim(),head);
  assert.equal(git(root,'rev-parse','HEAD^{tree}').trim(),tree);git(root,'diff','--quiet','HEAD','--');
  const expectedIndex=Object.create(null),actualIndex=Object.create(null);
  for(const line of git(root,'ls-tree','-r','-z','--full-tree','HEAD').split('\0').filter(Boolean)){
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);assert(match&&!Object.hasOwn(expectedIndex,match[3]),'Invalid ordinary controller HEAD inventory');
    expectedIndex[match[3]]={mode:match[1],sha:match[2]};
  }
  for(const line of git(root,'ls-files','--stage','-z').split('\0').filter(Boolean)){
    const match=/^(100644|100755) ([a-f0-9]{40}) ([0-3])\t(.+)$/.exec(line);
    assert(match&&match[3]==='0'&&!Object.hasOwn(actualIndex,match[4]),'Unmerged or invalid ordinary controller index');
    actualIndex[match[4]]={mode:match[1],sha:match[2]};
  }
  equal(actualIndex,expectedIndex,'Ordinary controller index differs from original HEAD');
  for(const path of git(root,'ls-files','--others','--exclude-standard','-z').split('\0').filter(Boolean))
    assert(path==='release/','Untracked ordinary caller input '+path);
  const ignored=git(root,'ls-files','--others','--ignored','--exclude-standard','-z','--','.github/scripts','contracts',':(glob).env*',':(glob)frontend/.env*').split('\0').filter(Boolean);
  assert(ignored.every(path=>/^\.github\/scripts\/__pycache__\/[^/]+\.pyc$/.test(path)),'Ignored ordinary caller source/environment input');
  for(const line of git(root,'ls-tree','-r','-z','--full-tree','HEAD','--','.github/scripts','contracts','.github/workflows').split('\0').filter(Boolean)){
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);assert(match,'Nonregular ordinary controller source');
    const raw=regular(join(root,match[3]));assert.equal(blob(raw),match[2],'Modified ordinary controller source '+match[3]);
    assert.equal(Boolean(lstatSync(join(root,match[3])).mode&0o111),match[1]==='100755','Modified ordinary controller mode');
  }
  assert.equal(blob(regular(join(root,ORDINARY_PUBLISHER_TOOLING.workflow.path))),ORDINARY_PUBLISHER_TOOLING.workflow.git_blob_sha,'Unreviewed ordinary workflow');return true;
}
function authority(state,context){
  return {controller:context.controller,caller:{run_id:context.caller.id,run_attempt:context.caller.run_attempt,head_sha:context.caller.head_sha,
    workflow_sha:context.execution.workflow_sha,workflow_git_blob_sha:context.executingWorkflowBlob,job:{id:context.callerJob.id,started_at:context.callerJob.started_at}},
    source:{run_id:state.source.runId,run_attempt:state.source.attempt,head_sha:context.sourceRun.head_sha,tree:context.sourceTree,event:context.sourceRun.event,
      job:{id:context.sourceJob.id,started_at:context.sourceJob.started_at,completed_at:context.sourceJob.completed_at},
      artifact:archiveIdentity(state.source.artifact),companion:archiveIdentity(state.source.companion),metadata_sha256:context.metadataSha256,
      manifest_sha256:state.source.manifestHash,price_observations_sha256:state.source.priceObservationsDigest},
    predecessor:{identity:state.live.identity,ui_sha:state.live.uiSha,ui_digest:state.live.uiDigest,approval_sha256:sha(JSON.stringify(ordered(state.live.approval))),
      financial_release_sha256:state.live.receipt.financial_release.sha256,lineage_sha256:state.live.financialRelease.lineage_sha256,
      financial_generation:state.live.financialRelease.financial_generation}};
}
export function validateOrdinaryPreparation(value,callerJob,uiOnly,now){
  closed(value,['input_data_digest','prepared_at','enrichment_step'],'Unknown ordinary input preparation');
  const step=value.enrichment_step;closed(step,['name','number','started_at','completed_at'],'Unknown ordinary enrichment step');
  const expected=uiOnly?'Prepare workbench using verified published evidence':'Prepare independently verifiable book evidence';
  const completed=callerJob.steps?.filter(s=>s.name===expected);
  assert(completed?.length===1&&completed[0].status==='completed'&&completed[0].conclusion==='success'&&positive(completed[0].number),'Missing successful unchanged ordinary enrichment');
  equal(step,Object.fromEntries(['name','number','started_at','completed_at'].map(k=>[k,completed[0][k]])),'Ordinary enrichment step changed');
  assert(hash(value.input_data_digest)&&iso(value.prepared_at)&&iso(step.started_at)&&iso(step.completed_at)
    &&Date.parse(step.started_at)>=Date.parse(callerJob.started_at)&&Date.parse(step.completed_at)>=Date.parse(step.started_at)
    &&Date.parse(value.prepared_at)>=Date.parse(step.completed_at)&&Date.parse(value.prepared_at)<=now,'Ordinary prepared-input clock changed');
  return value;
}
export function ordinaryPublisherToolingPhase(current,action){
  const phases={prepare:['restored','preparing'],apply:['preparing','applied'],'build-before':['applied','building'],'build-after':['building','built'],compose:['built','composed'],recheck:['composed','rechecked']};
  const pair=phases[action];assert(pair&&(current===pair[0]||action==='recheck'&&current==='rechecked'),'Wrong ordinary publisher tooling phase '+action);return pair[1];
}
export function validateOrdinaryPublisherToolingBinding(value){
  closed(value,['schema_version','identity','authority','restoration','preparation','carry','applied_at'],'Unknown ordinary tooling binding');
  assert.equal(value.schema_version,'ordinary-publisher-tooling-binding-v1');validateOrdinaryPublisherToolingIdentity(value.identity);
  const a=value.authority;closed(a,['controller','caller','source','predecessor'],'Unknown ordinary authority');
  closed(a.controller,['head','tree'],'Unknown ordinary controller');assert(gitHash(a.controller.head)&&gitHash(a.controller.tree));
  closed(a.caller,['run_id','run_attempt','head_sha','workflow_sha','workflow_git_blob_sha','job'],'Unknown ordinary caller');
  closed(a.caller.job,['id','started_at'],'Unknown ordinary caller job');
  assert(positive(a.caller.run_id)&&positive(a.caller.run_attempt)&&positive(a.caller.job.id)&&gitHash(a.caller.head_sha)&&gitHash(a.caller.workflow_sha)
    &&a.caller.workflow_git_blob_sha===ORDINARY_PUBLISHER_TOOLING.workflow.git_blob_sha&&iso(a.caller.job.started_at),'Invalid ordinary caller identity');
  closed(a.source,['run_id','run_attempt','head_sha','tree','event','job','artifact','companion','metadata_sha256','manifest_sha256','price_observations_sha256'],'Unknown ordinary source');
  closed(a.source.job,['id','started_at','completed_at'],'Unknown ordinary producer job');
  assert(positive(a.source.run_id)&&positive(a.source.run_attempt)&&gitHash(a.source.head_sha)&&gitHash(a.source.tree)&&['schedule','workflow_dispatch'].includes(a.source.event)
    &&positive(a.source.job.id)&&iso(a.source.job.started_at)&&iso(a.source.job.completed_at)&&Date.parse(a.source.job.started_at)<=Date.parse(a.source.job.completed_at)
    &&['metadata_sha256','manifest_sha256','price_observations_sha256'].every(k=>hash(a.source[k])),'Invalid ordinary source identity');
  for(const [key,name]of [['artifact','static-site-data-'],['companion','static-site-data-manifest-']]){
    const v=a.source[key];closed(v,['id','name','bytes','sha256','created_at','expires_at'],'Unknown ordinary source artifact');
    assert(positive(v.id)&&positive(v.bytes)&&hash(v.sha256)&&v.name===name+a.source.run_id+'-'+a.source.run_attempt&&iso(v.created_at)&&iso(v.expires_at)
      &&Date.parse(v.created_at)>=Date.parse(a.source.job.started_at)&&Date.parse(v.created_at)<=Date.parse(a.source.job.completed_at)
      &&Date.parse(v.expires_at)>Date.parse(value.applied_at),'Invalid ordinary archive binding');
  }
  closed(a.predecessor,['identity','ui_sha','ui_digest','approval_sha256','financial_release_sha256','lineage_sha256','financial_generation'],'Unknown ordinary predecessor');
  assert(identity(a.predecessor.identity)&&a.predecessor.ui_sha===ORDINARY_PUBLISHER_TOOLING.base.sha
    &&['ui_digest','approval_sha256','financial_release_sha256','lineage_sha256','financial_generation'].every(k=>hash(a.predecessor[k])),'Invalid ordinary predecessor binding');
  closed(value.restoration,['data_digest','recorded_at'],'Unknown ordinary restoration');
  closed(value.preparation,['input_data_digest','prepared_at','enrichment_step'],'Unknown ordinary prepared input');
  closed(value.preparation.enrichment_step,['name','number','started_at','completed_at'],'Unknown ordinary enrichment');
  const prepared=value.preparation,step=prepared.enrichment_step;
  assert(hash(prepared.input_data_digest)&&iso(prepared.prepared_at)&&['Prepare workbench using verified published evidence','Prepare independently verifiable book evidence'].includes(step.name)
    &&positive(step.number)&&iso(step.started_at)&&iso(step.completed_at)&&Date.parse(step.started_at)>=Date.parse(a.caller.job.started_at)
    &&Date.parse(step.completed_at)>=Date.parse(step.started_at)&&Date.parse(prepared.prepared_at)>=Date.parse(step.completed_at)
    &&Date.parse(prepared.prepared_at)>=Date.parse(value.restoration.recorded_at),'Invalid ordinary prepared input binding');
  closed(value.carry,['projection_sha256','target_base_sha256','baseline_data_digest','evaluated_at'],'Unknown ordinary carry');
  assert(hash(value.restoration.data_digest)&&iso(value.restoration.recorded_at)&&hash(value.carry.projection_sha256)&&hash(value.carry.target_base_sha256)
    &&hash(value.carry.baseline_data_digest)&&iso(value.carry.evaluated_at)&&iso(value.applied_at)&&Date.parse(value.restoration.recorded_at)>=Date.parse(a.caller.job.started_at)
    &&Date.parse(value.restoration.recorded_at)>=Date.parse(a.source.job.completed_at)
    &&Date.parse(value.carry.evaluated_at)>=Date.parse(value.preparation.prepared_at)&&Date.parse(value.applied_at)>=Date.parse(value.carry.evaluated_at)
    &&Date.parse(value.applied_at)<Date.parse(a.caller.job.started_at)+360*60000,'Invalid ordinary tooling clocks/carry');
  return value;
}
export function validateOrdinaryPublisherToolingReceipt(value,publication){
  assert(!publication.publisher_tooling,'Finite and ordinary tooling receipts are exclusive');
  closed(value,['schema_version','binding','financial_release','financial_generation','financial_lineage_sha256','ui_sha','ui_digest'],'Unknown ordinary tooling receipt');
  assert.equal(value.schema_version,'ordinary-publisher-tooling-receipt-v1');const b=validateOrdinaryPublisherToolingBinding(value.binding),a=b.authority;
  assert(publication.run_id===a.caller.run_id&&publication.run_attempt===a.caller.run_attempt&&publication.controller_sha===a.controller.head
    &&publication.data_source?.artifact_id===a.source.artifact.id&&publication.data_source.run_id===a.source.run_id&&publication.data_source.attempt===a.source.run_attempt
    &&publication.ui_sha===a.predecessor.ui_sha&&publication.ui_digest===a.predecessor.ui_digest
    &&sha(JSON.stringify(ordered(publication.approval)))===a.predecessor.approval_sha256,'Ordinary publication caller/source/approved UI changed');
  for(const key of ['financial_release','financial_generation','financial_lineage_sha256','ui_sha','ui_digest'])equal(value[key],publication[key],'Ordinary tooling final '+key+' changed');
  closed(value.financial_release,['schema_version','path','sha256'],'Unknown ordinary final financial release');
  assert(['financial-release-receipt-v1','financial-release-receipt-v2'].includes(value.financial_release.schema_version)&&hash(value.financial_release.sha256)
    &&value.financial_release.path==='static-data/financial-corrections/release-'+value.financial_release.sha256+'.json'&&hash(value.financial_generation),'Invalid ordinary final financial digests');
  assert(publication.financial_lineage_sha256===a.predecessor.lineage_sha256,'Ordinary tooling changed financial source lineage');return value;
}
export function ordinaryPublisherToolingReceipt(state,publication){
  const tool=state.ordinaryPublisherTooling;assert(tool&&['composed','rechecked'].includes(tool.phase),'Ordinary tooling receipt before composition');
  const b=validateOrdinaryPublisherToolingBinding(tool.binding);
  assert(state.financialPrepared?.receipt?.mode==='carry'&&state.financialPrepared.receipt.evaluation_projection.sha256===b.carry.projection_sha256
    &&state.financialPrepared.receipt.previous_publication_identity===b.authority.predecessor.identity,'Ordinary tooling lost actual financial carry receipt');
  equal(publication.financial_release,state.financialPrepared.reference,'Ordinary tooling final carried receipt changed');
  assert(state.financialPrepared.receipt.financial_generation===publication.financial_generation&&state.financialPrepared.receipt.lineage_sha256===publication.financial_lineage_sha256,'Ordinary tooling final carried generation/lineage changed');
  return validateOrdinaryPublisherToolingReceipt({schema_version:'ordinary-publisher-tooling-receipt-v1',binding:b,
    ...Object.fromEntries(['financial_release','financial_generation','financial_lineage_sha256','ui_sha','ui_digest'].map(k=>[k,publication[k]]))},publication);
}
async function currentContext(state){
  assert(process.execArgv.length===0&&!process.env.NODE_PATH&&(!process.env.NODE_OPTIONS||/^--max-old-space-size=\d+$/.test(process.env.NODE_OPTIONS)),'Ordinary tooling accepts no runtime hooks');
  assert(!process.env.RETAINED_PRICE_CONTROLLER_ROOT,'Ordinary tooling cannot borrow finite controller authority');
  const root=resolve(process.cwd());assert(typeof process.env.GITHUB_WORKSPACE==='string'&&root===resolve(process.env.GITHUB_WORKSPACE),'Ordinary tooling is outside the actual caller workspace');
  const execution={repository:process.env.GITHUB_REPOSITORY,repository_id:Number(process.env.GITHUB_REPOSITORY_ID),ref:process.env.GITHUB_REF,
    event_name:process.env.GITHUB_EVENT_NAME,run_id:Number(process.env.GITHUB_RUN_ID),run_attempt:Number(process.env.GITHUB_RUN_ATTEMPT),sha:process.env.GITHUB_SHA,
    release_sha:process.env.RELEASE_SHA,workflow_sha:process.env.GITHUB_WORKFLOW_SHA,workflow_ref:process.env.GITHUB_WORKFLOW_REF};
  const controller={head:git(root,'rev-parse','HEAD').trim(),tree:git(root,'rev-parse','HEAD^{tree}').trim()};verifyOrdinaryControllerCheckout(root,controller.head,controller.tree);
  const [{githubApi,checkPublication},{livePublication,compareData,sha256},{checkedExport,loadExportManifest},{comparePriceObservations},{applyPendingCorrectionHold,readPendingCorrection}]=await Promise.all([
    import('./publication-gate.mjs'),import('./publication-state.mjs'),import('./select-release-source.mjs'),import('./price-observations.mjs'),import('./pending-financial-correction.mjs')]);
  const api=githubApi,repository=api(prefix);assert(repository.id===1203919607&&repository.full_name===repo&&repository.default_branch==='main','Ordinary repository changed');
  assert(api(prefix+'/git/ref/heads/main').object.sha===controller.head,'Ordinary controller is no longer main');
  const commit=api(prefix+'/git/commits/'+controller.head);assert(commit.sha===controller.head&&commit.tree.sha===controller.tree,'Ordinary controller tree changed');
  const workflowCommit=api(prefix+'/git/commits/'+execution.workflow_sha);assert(workflowCommit.sha===execution.workflow_sha&&gitHash(workflowCommit.tree?.sha),'Invalid executing ordinary workflow source');
  const executing=api(prefix+'/git/trees/'+workflowCommit.tree.sha+'?recursive=1');assert(executing.sha===workflowCommit.tree.sha&&executing.truncated===false&&Array.isArray(executing.tree),'Incomplete executing ordinary workflow tree');
  const matches=executing.tree.filter(v=>v.path===ORDINARY_PUBLISHER_TOOLING.workflow.path&&v.type==='blob'&&v.mode==='100644');assert(matches.length===1,'Missing executing ordinary workflow');
  const caller=api(prefix+'/actions/runs/'+execution.run_id+'/attempts/'+execution.run_attempt),callerCurrent=api(prefix+'/actions/runs/'+execution.run_id);
  const jobs=pages(api,prefix+'/actions/runs/'+execution.run_id+'/attempts/'+execution.run_attempt+'/jobs?per_page=100','jobs'),active=jobs.filter(j=>j.name==='publish'&&j.status==='in_progress');
  assert(active.length===1,'Ambiguous active ordinary publisher');
  const sourceRun=api(prefix+'/actions/runs/'+state.source.runId+'/attempts/'+state.source.attempt),sourceCurrent=api(prefix+'/actions/runs/'+state.source.runId);
  const sourceJobs=pages(api,prefix+'/actions/runs/'+state.source.runId+'/attempts/'+state.source.attempt+'/jobs?per_page=100','jobs'),producers=sourceJobs.filter(j=>j.name==='combine-and-build'&&j.conclusion==='success');
  assert(producers.length===1,'Ambiguous ordinary source producer');
  const artifacts=api(prefix+'/actions/runs/'+state.source.runId+'/artifacts?per_page=100',true);
  const all=pages((endpoint,paginate)=>artifacts,prefix+'/actions/runs/'+state.source.runId+'/artifacts?per_page=100','artifacts');
  const source=all.filter(a=>a.id===state.source.artifact.id),companion=all.filter(a=>a.id===state.source.companion.id);
  assert(source.length===1&&companion.length===1,'Missing current ordinary source archives');
  equal(source[0],state.source.artifact,'Ordinary selected artifact changed');equal(companion[0],state.source.companion,'Ordinary selected companion changed');
  const temp=resolve(process.env.RUNNER_TEMP,'verified-publication');
  for(const artifact of [source[0],companion[0]]){
    const path=join(temp,'artifact-'+artifact.id,'artifact.zip');
    const observed=execFileSync('sha256sum',[path],{encoding:'utf8',timeout:120000}).split(' ')[0];assert.equal('sha256:'+observed,artifact.digest,'Ordinary local source ZIP changed');
    assert.equal(lstatSync(path).size,artifact.size_in_bytes,'Ordinary local source ZIP size changed');assert(!lstatSync(path).isSymbolicLink()&&realpathSync(path)===resolve(path),'Linked ordinary source ZIP');
  }
  // Both exact ZIPs already exist and are verified above. Reuse the existing
  // companion extractor so a caller cannot substitute unhashed local metadata.
  const metadata=loadExportManifest(companion[0],repo),metaRaw=regular(join(temp,'artifact-'+companion[0].id,'source.json'));
  equal(JSON.parse(metaRaw),metadata,'Ordinary companion changed during extraction/read');
  const checked=checkedExport(source[0],artifacts,repo,api,()=>metadata);assert(checked&&!checked.repair,'Not an ordinary checked source');
  const sourceCommit=api(prefix+'/git/commits/'+sourceRun.head_sha);assert(sourceCommit.sha===sourceRun.head_sha&&gitHash(sourceCommit.tree.sha),'Ordinary source Git identity changed');
  const live=await livePublication({repository:repo}),prices=comparePriceObservations(checked.priceObservations,live.knownPriceDates),chronology=compareData(checked.manifest,live.manifest);
  const event=JSON.parse(regular(process.env.GITHUB_EVENT_PATH,16*1024**2)),decision=applyPendingCorrectionHold(checkPublication(event,state.controllerSha,repo),readPendingCorrection());
  const now=Date.now(),context={root,execution,controller,caller,callerCurrent,callerJob:active[0],executingWorkflowBlob:matches[0].sha,
    sourceRun,sourceCurrent,sourceJob:producers[0],source:checked,sourceTree:sourceCommit.tree.sha,metadataSha256:sha256(metaRaw),live,decision,now,
    uiOnly:event.inputs?.ui_only===true||event.inputs?.ui_only==='true',sourceAdvance:!['regression','unknown'].includes(chronology)&&!prices.regressions.length&&(chronology==='advance'||prices.advances)};
  return validateOrdinaryPublisherToolingContext(state,context);
}
function binding(state,context,appliedAt){
  return validateOrdinaryPublisherToolingBinding({schema_version:'ordinary-publisher-tooling-binding-v1',identity:ORDINARY_PUBLISHER_TOOLING,
    authority:authority(state,context),restoration:state.ordinaryPublisherTooling.restoration,preparation:state.ordinaryPublisherTooling.preparation,
    carry:{projection_sha256:state.carry.projectionSha256,target_base_sha256:state.carry.targetBaseSha256,baseline_data_digest:state.ordinaryPublisherTooling.baselineDataDigest,evaluated_at:state.carry.evaluatedAt},applied_at:appliedAt});
}
// Production has no injected APIs, clocks, alternate artifacts or caller options.
// Pure exported validators never seed authority for this fresh boundary.
export async function ordinaryPublisherToolingBoundary(state,action){
  if(!ordinaryPublisherToolingEligible(state)){assert(!state.ordinaryPublisherTooling,'Ineligible route cannot claim ordinary tooling');return null;}
  const context=await currentContext(state),frontend=resolve('release/frontend'),a=authority(state,context),now=new Date(context.now).toISOString();
  if(action==='restore'){
    assert(!state.ordinaryPublisherTooling,'Ordinary tooling restored twice');verifyPublisherToolingCheckout(frontend);
    const {dataInventoryDigest}=await import('./publication-state.mjs');
    state.ordinaryPublisherTooling={phase:'restored',authority:a,restoration:{data_digest:dataInventoryDigest(join(frontend,'public')),recorded_at:now}};return state.ordinaryPublisherTooling;
  }
  const tool=state.ordinaryPublisherTooling;assert(tool,'Ordinary tooling requires its authenticated actual restore');
  equal(tool.authority,a,'Ordinary source/controller/caller/predecessor changed since restore');
  closed(tool.restoration,['data_digest','recorded_at'],'Unknown ordinary restoration');
  assert(hash(tool.restoration.data_digest)&&iso(tool.restoration.recorded_at)&&Date.parse(tool.restoration.recorded_at)>=Date.parse(a.caller.job.started_at)
    &&Date.parse(tool.restoration.recorded_at)<=context.now,'Ordinary restoration clock changed');
  if(action==='prepare'){
    closed(tool,['phase','authority','restoration'],'Unexpected ordinary tooling before carry');verifyPublisherToolingCheckout(frontend);
    const expected=context.uiOnly?'Prepare workbench using verified published evidence':'Prepare independently verifiable book evidence';
    const steps=context.callerJob.steps?.filter(s=>s.name===expected);assert(steps?.length===1,'Missing actual ordinary enrichment step');
    const {dataInventoryDigest}=await import('./publication-state.mjs');
    tool.preparation=validateOrdinaryPreparation({input_data_digest:dataInventoryDigest(join(frontend,'public')),prepared_at:now,
      enrichment_step:Object.fromEntries(['name','number','started_at','completed_at'].map(k=>[k,steps[0][k]]))},context.callerJob,context.uiOnly,context.now);
    // Provider/evidence enrichment is the unchanged ordinary workflow's explicit
    // intervening mutation. This records its actual output, never labels it as
    // equal to the restored source, and preserves the original baseline export.
    tool.phase=ordinaryPublisherToolingPhase(tool.phase,action);return tool;
  }
  validateOrdinaryPreparation(tool.preparation,context.callerJob,context.uiOnly,context.now);
  const {dataInventoryDigest}=await import('./publication-state.mjs');
  const baselineDigest=dataInventoryDigest(state.carry.baseline);
  const projection=regular(state.carry.projectionPath,128*1024**2);assert.equal(sha(projection),state.carry.projectionSha256,'Ordinary carry projection changed');
  const carry=JSON.parse(projection),previous=state.live.financialRelease;
  assert(carry.bindings.previous_publication_identity===state.live.identity&&carry.bindings.source_lineage_sha256===previous.lineage_sha256
    &&carry.bindings.source_projection_sha256===previous.source_projection.sha256&&carry.bindings.source_base_sha256===previous.source_base.sha256
    &&carry.bindings.target_base_sha256===state.carry.targetBaseSha256&&carry.financial_evaluated_at===state.carry.evaluatedAt,'Ordinary actual carry/source binding changed');
  if(action==='apply'){
    closed(tool,['phase','authority','restoration','preparation'],'Unexpected ordinary tooling application');verifyPublisherToolingCheckout(frontend);
    assert.equal(dataInventoryDigest(join(frontend,'public')),baselineDigest,'Ordinary baseline differs from the actual first exporter output');tool.baselineDataDigest=baselineDigest;
    const artifact=regular(join(context.root,PUBLISHER_EXPORT_ARTIFACT),1024**2);
    assert(artifact.length===pin.after.bytes&&blob(artifact)===pin.after.git_blob_sha&&sha(artifact)===pin.after.sha256,'Unreviewed ordinary exporter artifact');
    const next=ordinaryPublisherToolingPhase(tool.phase,action),bound=binding(state,context,now);
    writeFileSync(join(dirname(frontend),pin.path),artifact);verifyPublisherToolingCheckout(frontend,{amended:true});tool.binding=bound;tool.phase=next;return tool;
  }
  closed(tool,['phase','authority','restoration','preparation','baselineDataDigest','binding'],'Unknown ordinary tooling state');
  assert.equal(baselineDigest,tool.baselineDataDigest,'Ordinary carried baseline changed');
  if(action==='build-before')assert.equal(dataInventoryDigest(join(frontend,'public')),baselineDigest,'Ordinary pre-build target changed after baseline export');validateOrdinaryPublisherToolingBinding(tool.binding);
  assert(Date.parse(tool.binding.applied_at)<=context.now,'Future ordinary tooling clock');
  equal(tool.binding,binding(state,context,tool.binding.applied_at),'Ordinary tooling binding changed');verifyPublisherToolingCheckout(frontend,{amended:true});
  if(action==='recheck'){
    const {parsePublicationReceipt}=await import('./financial-audit-history.mjs'),publication=parsePublicationReceipt(regular(join(frontend,'dist/publication.json'),4*1024**2));
    equal(publication.ordinary_publisher_tooling,ordinaryPublisherToolingReceipt(state,publication),'Final ordinary tooling receipt changed');
  }
  tool.phase=ordinaryPublisherToolingPhase(tool.phase,action);return tool;
}
