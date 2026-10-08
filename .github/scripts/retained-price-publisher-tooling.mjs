// Exact publisher-only tooling amendment. Inactive unless the existing finite
// request is active and the selected source has been independently restored.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';

const freeze=value=>{for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return Object.freeze(value);};
export const PUBLISHER_TOOLING=freeze({
  "schema_version": "retained-price-publisher-tooling-identity-v1",
  "amendment_id": "oct6-carry-chart-projection-v1",
  "repository": "kusennjp1-ai/screener",
  "role": "publisher_carry_only",
  "source_compiler": "unchanged_approved_ui",
  "browser_assets": "equal_approved_predecessor_only",
  "base": {
    "sha": "1e1943e1d5f78a738a05baa69eb9f2e8508e32ac",
    "tree": "1c0219a170dcbdeb1af539e4cf7a04018251ca02",
    "frontend_tree": "0ba620a84264e1ff026898beed3fbc8ad5894618"
  },
  "amended": {
    "tree": "b042d1ca1aee5fc19ac6a75ed96aea88f69e6723",
    "frontend_tree": "1e0bfd47daf9f9b6f77ceb8f8d68343165ab4f31"
  },
  "files": [
    {
      "path": "frontend/tools/export-research.mjs",
      "mode": "100644",
      "before": {
        "git_blob_sha": "dac7f8784a0bc836ab6977e1e88ca643c49c01ed",
        "bytes": 23200,
        "sha256": "90e9f7316b34f171a726bc9245805e67e8d316b7367e288924ce568583fc3946"
      },
      "after": {
        "git_blob_sha": "1f630be308dd2ce604c26635c3d67243c7e48944",
        "bytes": 23247,
        "sha256": "f9e0ad58f7bbaf911eab2943fcfb18df32f6ee881c3847272f5201e448d9cf40"
      }
    }
  ]
});
export const PUBLISHER_EXPORT_ARTIFACT='.github/scripts/fixtures/publisher-export-research-oct6-carry-v1.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlob=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const equal=(a,b,why)=>assert.deepEqual(ordered(a),ordered(b),why);
const closed=(v,keys,why)=>{assert(v&&typeof v==='object'&&!Array.isArray(v),why);equal(Object.keys(v).sort(),[...keys].sort(),why);};
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const gitHash=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const iso=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT.*Z$/.test(v)&&Number.isFinite(Date.parse(v));
const pin=PUBLISHER_TOOLING.files[0];
const mutableSource=path=>path.startsWith('frontend/public/static-data/')||['research-daily.json','portfolio-model.json','qualification-audit.json','ibd-reference.json','publication.json'].some(name=>path==='frontend/public/'+name);
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024**2,timeout:120000});
function regular(path,cap=1024**2){const stat=lstatSync(path);assert(stat.isFile()&&!stat.isSymbolicLink()&&realpathSync(path)===resolve(path)&&stat.size<=cap,'Unsafe tooling input '+path);return readFileSync(path);}
function filePin(raw){return {git_blob_sha:gitBlob(raw),bytes:raw.length,sha256:sha(raw)};}
export function validatePublisherToolingIdentity(identity){equal(identity,PUBLISHER_TOOLING,'Unreviewed publisher tooling identity');return identity;}
export function validatePublisherToolingFiles(original,actual,{amended=false}={}){
  assert(original[pin.path]?.sha===pin.before.git_blob_sha&&original[pin.path]?.mode===pin.mode,'Wrong original exporter entry');
  const expected=Object.fromEntries(Object.entries(original).filter(([path])=>!mutableSource(path)).map(([path,entry])=>[path,amended&&path===pin.path?{mode:pin.mode,sha:pin.after.git_blob_sha}:entry]));
  const source=Object.fromEntries(Object.entries(actual).filter(([path])=>!mutableSource(path)));
  equal(source,expected,'Unadmitted publisher file/mode/addition/removal delta');return true;
}

// Check the physical source, not only HEAD. Data outputs are separately bound
// by the existing replay/carry/quality gates. Every other tracked source file,
// mode and untracked source path must remain the exact one-file amendment.
export function verifyPublisherToolingSourceFiles(root,files,{amended=false}={}){
  root=resolve(root);assert(realpathSync(root)===root&&lstatSync(root).isDirectory(),'Linked tooling source root');
  assert.equal(git(root,'rev-parse','--show-toplevel').trim(),root,'Wrong tooling source repository');
  const selected=files.filter(entry=>entry.path===pin.path);
  assert.equal(selected.length,1,'Missing exact original exporter');assert.equal(selected[0].sha,pin.before.git_blob_sha);
  const actualFiles={};
  for(const entry of files){
    if(mutableSource(entry.path))continue;
    const raw=regular(join(root,entry.path),64*1024**2),expected=amended&&entry.path===pin.path?pin.after.git_blob_sha:entry.sha;
    assert.equal(gitBlob(raw),expected,'Unadmitted publisher source change '+entry.path);
    const executable=Boolean(lstatSync(join(root,entry.path)).mode&0o111);
    assert.equal(executable,entry.mode==='100755','Publisher source mode changed '+entry.path);
    actualFiles[entry.path]={mode:executable?'100755':'100644',sha:gitBlob(raw)};
  }
  for(const path of git(root,'ls-files','--others','--exclude-standard','-z').split('\0').filter(Boolean))
    assert(mutableSource(path),'Untracked publisher source '+path);
  const ignoredSource=git(root,'ls-files','--others','--ignored','--exclude-standard','-z','--','frontend/src','frontend/tools','frontend/contracts','frontend/scripts','.github/scripts','contracts',':(glob)frontend/.env*',':(glob).env*').split('\0').filter(Boolean);
  assert.equal(ignoredSource.length,0,'Ignored untracked publisher source/environment inputs');
  validatePublisherToolingFiles(Object.fromEntries(files.map(entry=>[entry.path,{mode:entry.mode,sha:entry.sha}])),actualFiles,{amended});
  equal(filePin(regular(join(root,pin.path))),amended?pin.after:pin.before,'Exporter byte identity changed');
  return true;
}
export function verifyPublisherToolingCheckout(frontend,{amended=false}={}){
  frontend=resolve(frontend);assert(realpathSync(frontend)===frontend&&lstatSync(frontend).isDirectory(),'Linked publisher frontend');
  const root=dirname(frontend);
  assert.equal(git(root,'rev-parse','--show-toplevel').trim(),root,'Wrong selected repository');
  assert.equal(git(root,'rev-parse','HEAD').trim(),PUBLISHER_TOOLING.base.sha,'Wrong selected UI source');
  assert.equal(git(root,'rev-parse','HEAD^{tree}').trim(),PUBLISHER_TOOLING.base.tree,'Wrong selected source tree');
  assert.equal(git(root,'rev-parse','HEAD:frontend').trim(),PUBLISHER_TOOLING.base.frontend_tree,'Wrong selected frontend tree');
  const entries=git(root,'ls-tree','-r','-t','-z','--full-tree','HEAD').split('\0').filter(Boolean).map(line=>{
    const match=/^(040000|100644|100755) (tree|blob) ([a-f0-9]{40})\t(.+)$/.exec(line);
    assert(match&&!/[\\\x00-\x1f\x7f]/.test(match[4])&&match[4].split('/').every(p=>p&&p!=='.'&&p!=='..'),'Unexpected source tree entry');
    return {mode:match[1],type:match[2],sha:match[3],path:match[4]};
  });
  verifyPublisherToolingSourceFiles(root,entries.filter(entry=>entry.type==='blob'),{amended});
  // A temporary index is unnecessary: rebuild the virtual Git source tree from
  // authenticated object entries and the sole admitted replacement.
  const hashes=new Map();
  const treeHash=path=>{
    const direct=entries.filter(entry=>(entry.path.includes('/')?entry.path.slice(0,entry.path.lastIndexOf('/')):'')===path)
      .map(entry=>({...entry,name:entry.path.slice(path?path.length+1:0),sha:entry.type==='tree'?hashes.get(entry.path):amended&&entry.path===pin.path?pin.after.git_blob_sha:entry.sha}))
      .sort((a,b)=>Buffer.compare(Buffer.from(a.name+(a.type==='tree'?'/':'')),Buffer.from(b.name+(b.type==='tree'?'/':''))));
    const body=Buffer.concat(direct.map(entry=>Buffer.concat([Buffer.from((entry.mode==='040000'?'40000':entry.mode)+' '+entry.name+'\0'),Buffer.from(entry.sha,'hex')])));
    return createHash('sha1').update(`tree ${body.length}\0`).update(body).digest('hex');
  };
  for(const entry of entries.filter(e=>e.type==='tree').sort((a,b)=>b.path.split('/').length-a.path.split('/').length))hashes.set(entry.path,treeHash(entry.path));
  assert.equal(hashes.get('frontend'),amended?PUBLISHER_TOOLING.amended.frontend_tree:PUBLISHER_TOOLING.base.frontend_tree,'Virtual frontend tooling tree changed');
  assert.equal(treeHash(''),amended?PUBLISHER_TOOLING.amended.tree:PUBLISHER_TOOLING.base.tree,'Virtual publisher tooling tree changed');
  equal(filePin(regular(join(root,pin.path))),amended?pin.after:pin.before,'Exporter byte identity changed');
  return amended?PUBLISHER_TOOLING.amended:PUBLISHER_TOOLING.base;
}
const BINDING_KEYS=['schema_version','identity','controller','caller','request_sha256','source','predecessor_identity','carry_projection_sha256','carry_evaluated_at','applied_at'];
export function validatePublisherToolingBinding(value){
  closed(value,BINDING_KEYS,'Unknown publisher tooling binding field');
  assert.equal(value.schema_version,'retained-price-publisher-tooling-binding-v1');validatePublisherToolingIdentity(value.identity);
  closed(value.controller,['head','tree'],'Unknown tooling controller');assert(gitHash(value.controller.head)&&gitHash(value.controller.tree),'Invalid tooling controller');
  closed(value.caller,['run_id','run_attempt','head_sha','job'],'Unknown tooling caller');closed(value.caller.job,['id','started_at'],'Unknown tooling caller job');
  assert(positive(value.caller.run_id)&&value.caller.run_attempt===1&&positive(value.caller.job.id)&&value.caller.head_sha===value.controller.head&&iso(value.caller.job.started_at),'Invalid tooling caller');
  closed(value.source,['artifact_id','artifact_sha256','companion_id','companion_sha256','payload_sha256','replay_verification_sha256','restored_data_digest'],'Unknown tooling source');
  assert(positive(value.source.artifact_id)&&positive(value.source.companion_id)&&Object.entries(value.source).filter(([key])=>!key.endsWith('_id')).every(([,v])=>hash(v)),'Invalid tooling source');
  assert(hash(value.request_sha256)&&hash(value.carry_projection_sha256)&&iso(value.carry_evaluated_at)&&iso(value.applied_at)
    &&Date.parse(value.carry_evaluated_at)>=Date.parse(value.caller.job.started_at)&&Date.parse(value.applied_at)>=Date.parse(value.carry_evaluated_at)
    &&typeof value.predecessor_identity==='string'&&/^\d+\/1\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(value.predecessor_identity),'Invalid tooling projection/predecessor/clock');
  return value;
}
export function validatePublisherToolingReceipt(value,publication){
  closed(value,['schema_version','binding','financial_release','financial_generation','financial_lineage_sha256','ui_sha','ui_digest'],'Unknown publisher tooling receipt field');
  assert.equal(value.schema_version,'retained-price-publisher-tooling-receipt-v1');const binding=validatePublisherToolingBinding(value.binding);
  assert(publication.financial_release&&publication.run_id===binding.caller.run_id&&publication.run_attempt===binding.caller.run_attempt
    &&publication.controller_sha===binding.controller.head&&publication.data_source?.artifact_id===binding.source.artifact_id
    &&publication.ui_sha===PUBLISHER_TOOLING.base.sha,'Publisher tooling publication caller/source/UI changed');
  for(const key of ['financial_release','financial_generation','financial_lineage_sha256','ui_sha','ui_digest'])equal(value[key],publication[key],'Publisher tooling receipt '+key+' changed');
  assert(hash(value.ui_digest)&&hash(value.financial_generation)&&hash(value.financial_lineage_sha256),'Invalid tooling final digests');return value;
}
export function publisherToolingReceipt(state,publication){
  assert(state.publisherTooling&&['composed','browsing','browser_verified','rechecked'].includes(state.publisherTooling.phase),'Tooling receipt before composition');
  assert(publication.ui_sha===state.sourceSha&&publication.ui_digest===state.live.uiDigest,'Tooling final UI is not equal to approved predecessor');
  assert(state.financialPrepared?.receipt?.mode==='carry'&&state.financialPrepared.receipt.evaluation_projection.sha256===state.publisherTooling.binding.carry_projection_sha256,'Tooling lost actual carried evaluation receipt');
  equal(publication.financial_release,state.financialPrepared.reference,'Tooling final carry receipt changed');
  const value={schema_version:'retained-price-publisher-tooling-receipt-v1',binding:state.publisherTooling.binding,
    ...Object.fromEntries(['financial_release','financial_generation','financial_lineage_sha256','ui_sha','ui_digest'].map(key=>[key,publication[key]]))};
  return validatePublisherToolingReceipt(value,publication);
}
export function publisherToolingPhase(current,action){
  const phases={'build-before':['applied','building'],'build-after':['building','built'],compose:['built','composed'],'browser-before':['composed','browsing'],'browser-after':['browsing','browser_verified'],recheck:['browser_verified','rechecked']};
  const transition=phases[action];assert(transition&&(current===transition[0]||action==='recheck'&&current==='rechecked'),'Wrong publisher tooling phase '+action);
  return transition[1];
}
export function validatePublisherToolingContext(state,{request,requestSha256,verification,jobStartEpoch,now}){
  assert(state.source?.repair&&state.carry&&state.decision?.mode==='data'&&!state.correction&&!state.activation&&!state.renewal&&!state.decision.migration,'Publisher tooling requires exclusive finite ordinary carry');
  assert(request?.enabled&&hash(requestSha256)&&Number.isFinite(now),'Tooling disabled or invalid actual context');
  equal(request.approved_ui,PUBLISHER_TOOLING.base,'Tooling changed immutable source pins');
  assert(state.sourceSha===PUBLISHER_TOOLING.base.sha&&state.live?.uiSha===PUBLISHER_TOOLING.base.sha&&state.live.identity===request.predecessor.identity,'Tooling UI/predecessor changed');
  equal(verification.controller,{head:state.controllerSha,tree:verification.controller.tree},'Tooling controller changed');
  assert(verification.caller.head_sha===state.controllerSha&&verification.caller.run_attempt===1&&positive(verification.caller.run_id)&&positive(verification.caller.job.id),'Wrong active publisher caller');
  equal(verification.artifact,{id:state.source.artifact.id,sha256:state.source.artifact.digest},'Tooling source artifact changed');
  equal(verification.companion,{id:state.source.companion.id,sha256:state.source.companion.digest},'Tooling source companion changed');
  assert(verification.request_sha256===requestSha256&&verification.predecessor_identity===state.live.identity,'Tooling source request/predecessor changed');
  const start=Math.min(Date.parse(verification.caller.job.started_at),jobStartEpoch*1000);
  assert(Number.isFinite(start)&&request.bounds.lifecycle_minutes===95&&request.bounds.job_minutes===110
    &&now>=start&&now<start+95*60000&&now>=Date.parse(request.activation.not_before)&&now<Date.parse(request.activation.not_after),'Original publisher lifecycle or activation expired');
  assert(iso(verification.actual_checked_at)&&Date.parse(verification.actual_checked_at)>=start&&Date.parse(verification.actual_checked_at)<=now,'Replay validation clock changed');
  return true;
}
async function currentContext(state){
  assert(state.source?.repair&&state.carry&&state.decision?.mode==='data'&&!state.correction&&!state.activation&&!state.renewal&&!state.decision.migration,'Publisher tooling requires exclusive finite ordinary carry');
  assert(state.sourceSha===PUBLISHER_TOOLING.base.sha&&state.live?.uiSha===PUBLISHER_TOOLING.base.sha,'Tooling cannot change source compiler/browser approval');
  const [{readRepairRequest,repairControllerRoot,authorityExports},{verifyRetainedRestoreBinding},{githubApi}]=await Promise.all([
    import('./retained-price-source-admission.mjs'),import('./retained-price-source-driver.mjs'),import('./publication-gate.mjs')]);
  const root=repairControllerRoot(),request=readRepairRequest(root);assert(request?.value.enabled,'Publisher tooling is disabled');
  equal(request.value.approved_ui,PUBLISHER_TOOLING.base,'Tooling source pin differs from unchanged request');
  const proof=await verifyRetainedRestoreBinding({root,source:state.source,record:state.sourceRecovery,live:state.live,authority:authorityExports(),api:githubApi});
  const verification=state.sourceRecovery.verification,planRaw=regular(proof.replayRoot+'-driver-plan.json',64*1024**2),plan=JSON.parse(planRaw);
  const now=Date.now();validatePublisherToolingContext(state,{request:request.value,requestSha256:request.sha256,verification,jobStartEpoch:plan.job_start.epoch,now});
  assert(Number(process.env.GITHUB_RUN_ID)===verification.caller.run_id&&Number(process.env.GITHUB_RUN_ATTEMPT)===verification.caller.run_attempt,'Tooling state belongs to another caller');
  return {root,request,proof,verification,now};
}
function contextBinding(state,context,appliedAt){
  const v=context.verification;return validatePublisherToolingBinding({schema_version:'retained-price-publisher-tooling-binding-v1',identity:PUBLISHER_TOOLING,
    controller:v.controller,caller:v.caller,request_sha256:context.request.sha256,
    source:{artifact_id:state.source.artifact.id,artifact_sha256:state.source.artifact.digest.slice(7),companion_id:state.source.companion.id,companion_sha256:state.source.companion.digest.slice(7),
      payload_sha256:v.payload_sha256,replay_verification_sha256:state.sourceRecovery.verification_file.sha256,restored_data_digest:state.sourceRecovery.restored_data_digest},
    predecessor_identity:state.live.identity,carry_projection_sha256:state.carry.projectionSha256,carry_evaluated_at:state.carry.evaluatedAt,applied_at:appliedAt});
}
// No CLI inputs, injected APIs, clock overrides, alternate artifacts or generic
// tree overrides are accepted here. Every boundary repeats actual authority.
export async function publisherToolingBoundary(state,action){
  if(!state.source?.repair){assert(!state.publisherTooling,'Ordinary route cannot claim finite tooling');return null;}
  assert(process.execArgv.length===0&&!process.env.NODE_PATH&&(!process.env.NODE_OPTIONS||/^--max-old-space-size=\d+$/.test(process.env.NODE_OPTIONS)),'Publisher tooling accepts no runtime loader or clock hooks');
  const context=await currentContext(state),frontend=resolve('release/frontend');
  if(action==='prepare'){assert(!state.publisherTooling,'Tooling was applied before carry preparation');verifyPublisherToolingCheckout(frontend);return null;}
  if(action==='apply'){
    assert(!state.publisherTooling&&state.carry?.priceSourceProof,'Missing authenticated source baseline or tooling already applied');
    assert(hash(state.carry.projectionSha256)&&sha(regular(state.carry.projectionPath,128*1024**2))===state.carry.projectionSha256,'Unbound actual carry projection');
    verifyPublisherToolingCheckout(frontend);
    const artifact=regular(join(context.root,PUBLISHER_EXPORT_ARTIFACT));equal(filePin(artifact),pin.after,'Unreviewed publisher exporter artifact');
    const binding=contextBinding(state,context,new Date(context.now).toISOString());
    writeFileSync(join(dirname(frontend),pin.path),artifact);verifyPublisherToolingCheckout(frontend,{amended:true});
    state.publisherTooling={binding,phase:'applied'};return state.publisherTooling;
  }
  closed(state.publisherTooling,['binding','phase'],'Unknown publisher tooling state');validatePublisherToolingBinding(state.publisherTooling.binding);
  assert(Date.parse(state.publisherTooling.binding.applied_at)<=context.now,'Future tooling application clock');
  equal(state.publisherTooling.binding,contextBinding(state,context,state.publisherTooling.binding.applied_at),'Publisher tooling authority/projection changed');
  assert(sha(regular(state.carry.projectionPath,128*1024**2))===state.publisherTooling.binding.carry_projection_sha256,'Carry changed after tooling application');
  verifyPublisherToolingCheckout(frontend,{amended:true});
  if(action==='recheck'){
    const dist=join(frontend,'dist'),publicationRaw=regular(join(dist,'publication.json'),8*1024**2),publication=JSON.parse(publicationRaw);
    const report=JSON.parse(regular(join(process.env.RUNNER_TEMP,'verified-publication/finite-source-browser/report.json'),8*1024**2));
    assert(report.schema_version==='retained-price-source-browser-v1'&&report.status==='passed'&&Array.isArray(report.cases)&&report.cases.length===5
      &&report.publication_sha256===sha(publicationRaw)&&iso(report.started_at)&&iso(report.finished_at)
      &&Date.parse(report.started_at)>=Date.parse(context.verification.caller.job.started_at)&&Date.parse(report.finished_at)>=Date.parse(report.started_at)
      &&Date.parse(report.finished_at)<=context.now,'Missing actual completed publisher browser proof');
    equal(report.publisher_tooling,publication.publisher_tooling,'Browser proved another publisher tooling receipt');
    equal(publication.publisher_tooling,publisherToolingReceipt(state,publication),'Final publisher tooling proof changed');
  }
  state.publisherTooling.phase=publisherToolingPhase(state.publisherTooling.phase,action);
  return state.publisherTooling;
}
