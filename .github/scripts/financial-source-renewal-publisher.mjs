// Serial publication integration. All authority comes from immutable committed
// controls, exact successful attempts and bounded controller-owned registries.
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,lstatSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bootstrap,downloadArtifact,inventoryDigest,sha256,uiInventory} from './publication-state.mjs';
import {githubApi} from './publication-gate.mjs';
import {contract,dataInventory,digest,verifyCorrectionChecks} from './financial-correction.mjs';
import {financialReleasePolicy,extractCandidateTar,protectedCodeInventory,completeInventory,renewalSourceLineage,verifyCandidateTransport} from './financial-release-activation.mjs';
import {removeCanonical} from './static-transport-publication.mjs';
import {verifyRenewalCandidateTransportAssets} from './financial-renewal-candidate-transport.mjs';
import {renewalPolicy,renewalPolicyPath,readRenewalControls,parseRenewalIntent,validateRenewalCandidate,validateRenewalTransition,validateRenewalRegistry,
  renewalControllerCodeInventory,assertCurrentRenewalEvaluation,verifyRenewalEvaluationCurrent,verifyRenewalPredecessor,verifyRenewalAuthority,verifyPreparedRenewal,financialAuditInventory,assertRetainedFinancialHistory,writeRenewalRelease} from './financial-source-renewal.mjs';

const read=p=>{const info=lstatSync(p);if(!info.isFile()||info.isSymbolicLink()||info.size>renewalPolicy.maximum_proof_bytes)throw Error('Invalid bounded renewal proof file');return JSON.parse(readFileSync(p,'utf8'));};
const fileHash=path=>execFileSync('sha256sum',[path],{encoding:'utf8'}).split(' ')[0];
const equal=(a,b,label)=>{if(digest(a)!==digest(b))throw Error(`Renewal ${label} changed`);};
const git=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const scratch=()=>join(process.env.RUNNER_TEMP||'/tmp','verified-publication/renewal');

export function selectRenewalControls({root=process.cwd(),input,eventName=process.env.GITHUB_EVENT_NAME,design=false,correction=false,uiOnly=false}={}){
  if(!input)return null; // Ordinary carry uses retained immutable authority, even after current controls are removed.
  const controls=readRenewalControls(root),present=Object.values(controls).filter(Boolean).length;
  if(present&&present!==3)throw Error('Renewal requires its complete committed request, pin and explicit intent');
  if(design||correction||uiOnly===true||uiOnly==='true'||eventName!=='workflow_dispatch')throw Error('Renewal requires its exclusive typed manual mode');
  const intent=parseRenewalIntent(typeof input==='string'?JSON.parse(input):input);
  if(present!==3)throw Error('Renewal requires its complete committed request, pin and explicit intent');
  equal(intent,controls.intent,'explicit dispatch intent');
  const registry=validateRenewalRegistry(read(join(root,renewalPolicyPath)));
  if(!registry.publication_enabled||!registry.reviewed_controllers.length)throw Error('Source renewal publication is disabled: no exact reviewed controller authority');
  return controls;
}
function currentPublisher(root,mainSha,api){
  if(git(root,['rev-parse','HEAD'])!==mainSha||git(root,['status','--porcelain','--untracked-files=no']))throw Error('Renewal publisher requires clean exact current-main checkout');
  if(api(`repos/${bootstrap.repository}/git/ref/heads/main`).object?.sha!==mainSha)throw Error('Renewal publisher is not exact current main');
  const tree=git(root,['rev-parse','HEAD^{tree}']),commit=api(`repos/${bootstrap.repository}/git/commits/${mainSha}`);
  if(commit.sha!==mainSha||commit.tree?.sha!==tree)throw Error('Renewal publisher checkout tree changed');
  return {head_sha:mainSha,tree,checks:verifyCorrectionChecks(bootstrap.repository,mainSha,api),registry_sha256:sha256(readFileSync(join(root,renewalPolicyPath)))};
}
function artifactFor(pin,api){
  const refs=api(`repos/${bootstrap.repository}/actions/runs/${pin.run_id}/artifacts?per_page=100`,true).flatMap(page=>page.artifacts).filter(a=>a.name===pin.artifact_name);
  if(refs.length!==1||refs[0].id!==pin.artifact_id||refs[0].digest!==`sha256:${pin.artifact_sha256}`||refs[0].expired!==false||!Number.isSafeInteger(refs[0].size_in_bytes)||refs[0].size_in_bytes<=0||refs[0].size_in_bytes>financialReleasePolicy.maximum_archive_bytes)throw Error('Renewal candidate artifact differs from its exact pin');
  return refs[0];
}
export async function selectRenewalCandidate({root=process.cwd(),live,controls,mainSha,source,api=githubApi,directory=scratch()}){
  const {request,pin,intent}=controls;verifyRenewalPredecessor(request,live);assertCurrentRenewalEvaluation(request.target.evaluated_at);
  if(source.artifact.id!==request.price_input.artifact_id||source.artifact.digest!==`sha256:${request.price_input.artifact_sha256}`||source.receiptHash!==live.receiptHash)throw Error('Renewal must select the exact current published price artifact');
  const registry=validateRenewalRegistry(read(join(root,renewalPolicyPath)));
  if(!registry.publication_enabled)throw Error('Source renewal publication is disabled');
  const matches=registry.reviewed_controllers.filter(item=>item.certification_sha===pin.head_sha&&item.request_sha256===digest(request)&&item.pin_sha256===digest(pin)&&item.intent_sha256===digest(intent));
  if(matches.length!==1)throw Error('Renewal controls have no single exact reviewed controller');
  const review=matches[0],publisher=currentPublisher(root,mainSha,api);
  if(digest(renewalControllerCodeInventory(protectedCodeInventory(root,mainSha)))!==review.protected_code_sha256)throw Error('Renewal current-main executable inventory changed');
  for(const key of ['request','pin','intent'])if(sha256(readFileSync(join(root,renewalPolicy[`${key}_path`])))!==review[`${key}_raw_sha256`])throw Error('Renewal local control bytes differ from reviewed controls');
  const input=join(directory,'input'),candidate=join(directory,'candidate');
  mkdirSync(directory,{recursive:true});
  const artifact=artifactFor(pin,api);downloadArtifact(artifact,input,bootstrap.repository,'candidate.tar',financialReleasePolicy.maximum_archive_bytes);
  rmSync(candidate,{recursive:true,force:true});extractCandidateTar(join(input,'candidate.tar'),candidate);
  const recordPath=join(candidate,'candidate.json');if(lstatSync(recordPath).size>renewalPolicy.maximum_control_bytes)throw Error('Renewal candidate record exceeds control bound');
  const record=validateRenewalCandidate(read(recordPath)),recordJson=readFileSync(recordPath,'utf8');
  if(sha256(recordJson)!==pin.candidate_record_sha256)throw Error('Renewal candidate record hash changed');
  equal(read(join(candidate,'renewal-request.json')),request,'candidate request');
  const preview=read(join(candidate,'preview-receipt.json'));
  const lineage=renewalSourceLineage({source:request.financial_request.correction.source,certificate:request.financial_request.source_validation.certificate,
    sourceProjectionSha256:record.source_projection_sha256,receiptInventorySha256:record.receipt_inventory_sha256,projectionPolicy:preview.destination_projection.policy});
  const transition=validateRenewalTransition({schema_version:'financial-source-renewal-transition-v1',controller_sha:review.controller_sha,
    controller_checks:verifyCorrectionChecks(bootstrap.repository,review.controller_sha,api),certification_controller:read(join(candidate,'certification-controller.json')),publisher,request,pin,intent,record,record_json:recordJson,
    previous_lineage_sha256:request.previous_lineage_sha256,next_lineage:lineage.value,next_lineage_sha256:lineage.id,
    history_inventory:read(join(candidate,'history-inventory.json')),source_delta:read(join(candidate,'source-delta.json'))});
  const state={candidate,directory,request,pin,intent,record,transition,mainSha,artifact};
  await verifyRenewalSelection(state,live,root,api);
  return state;
}
export async function verifyRenewalSelection(state,live,root=process.cwd(),api=githubApi){
  const {candidate,transition,record}=state;equal(readRenewalControls(root),{request:state.request,pin:state.pin,intent:state.intent},'current release controls');
  equal(currentPublisher(root,state.mainSha,api),transition.publisher,'current-main publisher authority');
  const registry=validateRenewalRegistry(read(join(root,renewalPolicyPath)));
  verifyRenewalAuthority(transition,{api,reviewedControllers:registry.reviewed_controllers,originBytes:readFileSync(join(candidate,'predecessor',state.request.origin_release.path))});
  for(const key of ['request','pin','intent']){
    const review=registry.reviewed_controllers.find(item=>item.controller_sha===transition.controller_sha&&item.certification_sha===state.pin.head_sha);
    if(sha256(readFileSync(join(root,renewalPolicy[`${key}_path`])))!==review[`${key}_raw_sha256`])throw Error('Renewal local control bytes changed after selection');
  }
  if(sha256(readFileSync(join(candidate,'candidate.json')))!==state.pin.candidate_record_sha256||readFileSync(join(candidate,'candidate.json'),'utf8')!==transition.record_json)throw Error('Renewal sealed record changed');
  if(fileHash(join(state.directory,'input/artifact.zip'))!==state.pin.artifact_sha256)throw Error('Renewal retained candidate ZIP changed');
  equal(artifactFor(state.pin,api),state.artifact,'selected candidate artifact');
  const result=await verifyPreparedRenewal({candidate,request:state.request,record,live,root,api});
  equal(result.sourceDelta,transition.source_delta,'source delta');equal(result.history,transition.history_inventory,'audit history');
  if(result.projection.policy&&digest(result.projection.policy)!==digest(transition.next_lineage.policy))throw Error('Renewal financial policy changed');
  state.projectionPath=result.projectionPath;
  return result;
}
export async function restoreRenewalCandidate(state,live,root=process.cwd(),api=githubApi){
  await verifyRenewalSelection(state,live,root,api);
  const physical=join(state.candidate,'corrected'),restore=join(state.directory,'restore-logical');rmSync(restore,{recursive:true,force:true});
  const {logicalRoot:logical}=await verifyCandidateTransport(root,state.candidate,state.record,{restore});
  try{for(const name of ['public','dist']){const target=resolve('release/frontend',name);rmSync(target,{recursive:true,force:true});mkdirSync(target,{recursive:true});cpSync(logical,target,{recursive:true});rmSync(join(target,'publication.json'),{force:true});}}
  finally{removeCanonical(physical,logical);}
}
export async function prepareRenewalReceipt(state,live,dist,priceInput,root=process.cwd(),api=githubApi){
  await verifyRenewalSelection(state,live,root,api);
  return writeRenewalRelease({dist,live,transition:state.transition,sourceProjectionBytes:readFileSync(state.projectionPath),sourceBaseBytes:readFileSync(join(state.candidate,'target-base.json')),priceInput});
}
export async function verifyPreparedRenewalRelease(state,live,dist,publication,prepared,root=process.cwd(),api=githubApi){
  const verified=await verifyRenewalSelection(state,live,root,api);
  equal(publication.financial_release,prepared.reference,'final financial release reference');
  const receipt=read(join(dist,publication.financial_release.path));
  if(publication.controller_sha!==state.transition.publisher.head_sha||receipt.mode!=='renewal'||receipt.financial_generation!==state.record.financial_generation||receipt.lineage_sha256!==state.transition.next_lineage_sha256||publication.financial_generation!==state.record.financial_generation||publication.financial_lineage_sha256!==state.transition.next_lineage_sha256)throw Error('Renewal final publication lost its sealed source generation');
  if(receipt.renewal.transitions.at(-1).sha256!==sha256(JSON.stringify(state.transition)))throw Error('Renewal final publication changed its exact transition');
  const physical=join(state.candidate,'corrected'),restore=join(state.directory,'final-recheck-logical');rmSync(restore,{recursive:true,force:true});
  const {logicalRoot:logical}=await verifyCandidateTransport(root,state.candidate,state.record,{restore});
  try{
    const original=dataInventory(logical),actual=dataInventory(dist,prepared.added.filter(path=>!Object.hasOwn(original,path)));
    if(inventoryDigest(original)!==inventoryDigest(actual)||inventoryDigest(uiInventory(dist))!==state.request.ui.digest)throw Error('Renewal final candidate data or UI changed');
    assertRetainedFinancialHistory(state.transition.history_inventory,financialAuditInventory(dist));
  }finally{removeCanonical(physical,logical);}
  await verifyRenewalCandidateTransportAssets({root,candidate:state.candidate,record:state.record,dist:resolve('release/frontend/dist'),publication,allowedAdditions:prepared.added});
  await verifyRenewalEvaluationCurrent({request:state.request,projection:verified.projection,frontendRoot:join(root,'frontend')});
  // This verified object stays in the current call stack. It is never written
  // to resumable state or accepted from a serialized clock/expiry override.
  return verified.projection;
}
export async function checkFinalRenewalPayload(dist,{request,projection,frontendRoot}){
  const payload=JSON.parse(execFileSync('python3',[fileURLToPath(new URL('./check-pages-payload.py',import.meta.url)),dist],{encoding:'utf8',maxBuffer:2*1024*1024}));
  await verifyRenewalEvaluationCurrent({request,projection,frontendRoot});
  return payload;
}
