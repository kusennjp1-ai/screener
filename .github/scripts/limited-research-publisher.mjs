// Explicit manual frozen-data UI publication. Never used by the default gate.
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {LIMITED_APPROVAL_PATH,parseLimitedReleaseControl,verifyLimitedControlEvidence,verifyLimitedRuns,immutableFile,frozenFinancial,parseLimitedPreviewUiApproval,isLimitedPreviewApproval} from './limited-research-approval.mjs';
import {remoteProtectedCodeInventory} from './financial-performance-exception.mjs';
import {githubApi} from './publication-gate.mjs';
import {bootstrap,livePublication,downloadArtifact,inventoryDigest,uiInventory,sha256,validateReceipt,dataFiles,safePath} from './publication-state.mjs';
import {dataInventory,digest} from './financial-correction.mjs';
import {readPendingCorrection} from './pending-financial-correction.mjs';
import {readRenewalControls} from './financial-source-renewal.mjs';
import {readRepairRequest} from './retained-price-source-admission.mjs';
import {readFinancialReleaseRequest,extractCandidateTar,writeFinancialReleaseReceipt,verifyFinancialReleaseAssets,assertFinancialLineageContinuity} from './financial-release-activation.mjs';
import {financialAuditInventory,requiredFinancialAuditFiles,assertFinancialAuditPreserved,parsePublicationReceipt} from './financial-audit-history.mjs';
import {canonicalPublication,removeCanonical,packPublication} from './static-transport-publication.mjs';
const equal=(a,b,label)=>{if(digest(a)!==digest(b))throw Error(`Limited ${label} changed`);};
const read=p=>readFileSync(p);
const root=()=>process.cwd();
const folder=()=>join(process.env.RUNNER_TEMP||'/tmp','verified-publication/limited');
export function assertLimitedHolds(live,directory=root()){
  if(readPendingCorrection(directory)?.active)throw Error('Existing financial correction hold blocks limited UI');
  const renewal=readRenewalControls(directory);
  if(renewal.request?.previous_publication_identity===live.identity)throw Error('Pending source renewal blocks limited UI');
  if(readRepairRequest(directory)?.value.enabled)throw Error('Enabled price source admission blocks limited UI');
  const request=readFinancialReleaseRequest(directory);
  if(request){const releases=[live.financialRelease,live.financialOrigin].filter(Boolean);if(!releases.some(f=>digest(f.lineage.source)===digest(request.correction.source)&&digest(f.lineage.certificate)===digest(request.source_validation.certificate)))throw Error('Pending financial source admission blocks limited UI');}
}
export function assertLimitedPublisherInvocation(mainSha,api=githubApi,env=process.env){
  const id=Number(env.GITHUB_RUN_ID),attempt=Number(env.GITHUB_RUN_ATTEMPT),workflow='.github/workflows/research-ui-release.yml';
  if(env.GITHUB_REPOSITORY!==bootstrap.repository||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_WORKFLOW_SHA!==mainSha||env.GITHUB_SHA!==mainSha||env.GITHUB_WORKFLOW_REF!==`${bootstrap.repository}/${workflow}@refs/heads/main`||![id,attempt].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('Limited publisher requires exact executed main workflow');
  for(const path of [`repos/${bootstrap.repository}/actions/runs/${id}/attempts/${attempt}`,`repos/${bootstrap.repository}/actions/runs/${id}`]){
    const run=api(path);
    if(run.id!==id||run.run_attempt!==attempt||run.repository?.full_name!==bootstrap.repository||run.head_repository?.full_name!==bootstrap.repository||run.head_sha!==mainSha||run.head_branch!=='main'||run.event!=='workflow_dispatch'||run.path!==workflow||run.status!=='in_progress'||run.conclusion!==null)throw Error('Limited publisher attempt identity changed');
  }
}
function currentMain(mainSha,api=githubApi){
  assertLimitedPublisherInvocation(mainSha,api);
  if(api(`repos/${bootstrap.repository}/git/ref/heads/main`).object?.sha!==mainSha||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==mainSha||execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim())throw Error('Limited publisher requires clean exact current main');
}
function validateContext(control,live,mainSha,api){
  assertLimitedHolds(live);
  if(isLimitedPreviewApproval(live.approval))throw Error('Limited preview cannot renew itself');
  equal(control.approval.predecessor,{identity:live.identity,receipt_sha256:live.receiptHash},'predecessor');
  equal(control.financial,frozenFinancial(live),'frozen financial authority');
  if(control.approval.data.manifest_sha256!==live.manifestHash||control.approval.data.logical_inventory_sha256!==live.receipt.data_inventory_sha256||control.approval.data.financial_lineage_sha256!==live.financialRelease.lineage_sha256)throw Error('Limited admitted data binding differs');
  equal(remoteProtectedCodeInventory(control.approval.ui.sha,api),remoteProtectedCodeInventory(mainSha,api),'captured UI/controller protected code');
  equal(remoteProtectedCodeInventory(control.approval.controller_sha,api),remoteProtectedCodeInventory(mainSha,api),'reviewed controller protected code');
}
export async function planLimited({event,mainSha,api=githubApi,fetcher=fetch}){
  if(process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||event.ref!=='refs/heads/main'||event.inputs?.limited_research_preview!==LIMITED_APPROVAL_PATH||event.inputs?.financial_correction||event.inputs?.financial_source_renewal||[true,'true'].includes(event.inputs?.ui_only))throw Error('Limited preview requires its exclusive exact manual scope');
  currentMain(mainSha,api);
  const path=join(root(),LIMITED_APPROVAL_PATH),stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>262144)throw Error('Invalid local limited approval');
  const bytes=read(path),control=parseLimitedReleaseControl(bytes,{activation:true});
  if(!bytes.equals(immutableFile(api,bootstrap.repository,LIMITED_APPROVAL_PATH,mainSha)))throw Error('Local limited control differs from committed authority');
  verifyLimitedControlEvidence(control,control.assessment);
  const live=await livePublication({api,fetcher});validateContext(control,live,mainSha,api);
  const evidence=verifyLimitedRuns(control,bootstrap.repository,api,{artifact:true});
  const approval=parseLimitedPreviewUiApproval({type:'limited-research-preview-v1',sha:control.approval.ui.sha,ui_digest:control.approval.ui.inventory_sha256,controller_sha:mainSha,approval_sha256:sha256(bytes),approval_path:LIMITED_APPROVAL_PATH,financial:control.financial,checks:evidence.checks});
  return {live,decision:{publish:true,mode:'limited',approval},sourceSha:approval.sha,controllerSha:mainSha,limited:{control,controlHash:sha256(bytes),artifact:evidence.artifact},source:{artifact:evidence.artifact}};
}
export function completeFiles(directory){
  const files={};const walk=(dir,prefix='')=>{for(const ent of readdirSync(dir,{withFileTypes:true})){const path=prefix+ent.name;if(!safePath(path))throw Error('Unsafe limited bundle path');if(ent.isDirectory())walk(join(dir,ent.name),path+'/');else if(ent.isFile())files[path]=sha256(read(join(dir,ent.name)));else throw Error('Limited bundle contains special file');}};
  const s=lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Invalid limited directory');walk(directory);return files;
}
function frozenInventory(directory){return parsePublicationReceipt(read(join(directory,'evidence/frozen-inventory.json')));}
export async function verifyLimitedCapture(state,directory){
  const {control}=state.limited,bytes=read(join(directory,'capture.json'));
  if(sha256(bytes)!==control.capture.capture_sha256)throw Error('Limited capture identity changed');
  const c=parsePublicationReceipt(bytes),files=completeFiles(directory);delete files['capture.json'];
  equal(c.files,files,'complete capture inventory');
  if(c.schema_version!=='limited-research-capture-v1'||c.scope_id!=='limited-research-preview-v1'||c.publication_authority!=='none'||c.ui_sha!==state.sourceSha||c.controller_sha!==state.sourceSha)throw Error('Invalid limited capture scope');
  equal(c.assessment_run,control.approval.evidence.assessment_run,'capture attempt');equal(c.predecessor,control.approval.predecessor,'capture predecessor');equal(c.data,control.approval.data,'captured frozen data');equal(c.ui,control.approval.ui,'captured UI');
  if(!read(join(directory,'evidence/assessment.json')).equals(Buffer.from(control.assessment)))throw Error('Captured assessment changed');
  equal(c.evidence,{report_sha256:sha256(read(join(directory,'evidence/report.json'))),assessment_sha256:control.approval.evidence.assessment_sha256,screenshots_sha256:control.approval.evidence.screenshots_sha256,notice_sha256:control.approval.evidence.notice_sha256},'capture evidence');
  if(sha256(read(join(directory,'evidence/predecessor-publication.json')))!==state.live.receiptHash)throw Error('Capture predecessor receipt changed');
  equal(JSON.parse(read(join(directory,'evidence/screenshots.json'))),JSON.parse(control.screenshots),'capture screenshot inventory');
  if(!read(join(directory,'evidence/notice.txt')).equals(Buffer.from(control.notice)))throw Error('Captured notice changed');
  if(inventoryDigest(uiInventory(join(directory,'dist')))!==control.approval.ui.inventory_sha256||inventoryDigest(frozenInventory(directory))!==control.approval.data.logical_inventory_sha256)throw Error('Captured UI/data inventory changed');
  // Compare original logical bytes through the captured transport verifier.
  const captured=join(directory,'dist'),publication=JSON.parse(read(join(captured,'publication.json')));
  const logical=await canonicalPublication({root:captured,frontendRoot:resolve('release/frontend'),publication,restore:join(folder(),'capture-logical')});
  try{equal(dataInventory(logical),frozenInventory(directory),'captured browser data');}finally{removeCanonical(captured,logical);}
  return c;
}
export async function restoreLimited(state){
  const directory=folder(),capture=join(directory,'capture');mkdirSync(directory,{recursive:true});
  downloadArtifact(state.limited.artifact,directory,bootstrap.repository,'bundle.tar',2147483648);
  rmSync(capture,{recursive:true,force:true});extractCandidateTar(join(directory,'bundle.tar'),capture);await verifyLimitedCapture(state,capture);
  const dist=resolve('release/frontend/dist');rmSync(dist,{recursive:true,force:true});mkdirSync(dist,{recursive:true});const captured=join(capture,'dist');const logical=await canonicalPublication({root:captured,frontendRoot:resolve('release/frontend'),publication:JSON.parse(read(join(captured,'publication.json'))),restore:join(directory,'restore-logical')});try{cpSync(logical,dist,{recursive:true});rmSync(join(dist,'publication.json'),{force:true});}finally{removeCanonical(captured,logical);}
  // Existing quality workers read public/static-data; expose the same immutable
  // logical snapshot there without running an exporter. Publication uses dist.
  const publicRoot=resolve('release/frontend/public');mkdirSync(publicRoot,{recursive:true});rmSync(join(publicRoot,'static-data'),{recursive:true,force:true});cpSync(join(dist,'static-data'),join(publicRoot,'static-data'),{recursive:true});for(const file of dataFiles)cpSync(join(dist,file),join(publicRoot,file));
  if(inventoryDigest(dataInventory(publicRoot))!==state.limited.control.approval.data.logical_inventory_sha256)throw Error('Quality-check frozen input changed');
  state.limited.captureRoot=capture;return state;
}
export async function composeLimited(state){
  const dist=resolve('release/frontend/dist'),{control}=state.limited;await verifyLimitedCapture(state,state.limited.captureRoot);
  equal(dataInventory(dist),frozenInventory(state.limited.captureRoot),'restored frozen data');
  if(inventoryDigest(uiInventory(dist))!==control.approval.ui.inventory_sha256)throw Error('Restored captured UI changed');
  const {verifyCoverage}=await import('./select-release-source.mjs');
  const coverage=await verifyCoverage(resolve('release/frontend'),join(dist,'static-data'),state.live.verificationUniverse.required_symbols);
  if(coverage.verified<state.live.verificationUniverse.verified||coverage.total!==state.live.verificationUniverse.total||coverage.as_of_date!==state.live.verificationUniverse.as_of_date)throw Error('Limited retained-universe coverage regressed');
  equal(coverage.requiredSymbols,state.live.verificationUniverse.required_symbols,'retained universe');
  const previous=state.live.financialRelease,runId=Number(process.env.GITHUB_RUN_ID),attempt=Number(process.env.GITHUB_RUN_ATTEMPT);
  const publication={schema:1,run_id:runId,run_attempt:attempt,artifact_name:`github-pages-${runId}-${attempt}`,controller_sha:state.controllerSha,ui_sha:state.sourceSha,ui_files:uiInventory(dist),ui_digest:control.approval.ui.inventory_sha256,approval:state.decision.approval,price_observations:state.live.receipt.price_observations,known_price_dates:state.live.receipt.known_price_dates,verification_universe:state.live.receipt.verification_universe,data_manifest_sha256:state.live.manifestHash,data_source:state.live.receipt.data_source};
  const result=writeFinancialReleaseReceipt({dist,mode:'carry',previousIdentity:state.live.identity,lineage:{id:previous.lineage_sha256,value:previous.lineage},sourceProjectionBytes:read(join(dist,previous.source_projection.path)),sourceBaseBytes:read(join(dist,previous.source_base.path)),evaluationBytes:read(join(dist,previous.evaluation_projection.path)),generation:previous.financial_generation,evaluatedAt:previous.evaluated_at,ui:{approved_sha:state.sourceSha,captured_sha:state.sourceSha,digest:publication.ui_digest,approval:publication.approval,checks:publication.approval.checks},priceInput:previous.price_input,renewal:previous.renewal||null});
  publication.financial_release=result.reference;publication.financial_generation=previous.financial_generation;publication.financial_lineage_sha256=previous.lineage_sha256;publication.data_inventory_sha256=inventoryDigest(dataInventory(dist));publication.financial_audit_files=financialAuditInventory(dist);
  assertFinancialAuditPreserved(requiredFinancialAuditFiles(state.live),publication.financial_audit_files);assertFinancialLineageContinuity(state.live,result.receipt);
  state.limited.added=result.added.filter(path=>!Object.hasOwn(frozenInventory(state.limited.captureRoot),path));
  equal(dataInventory(dist,state.limited.added),frozenInventory(state.limited.captureRoot),'frozen composed data');
  await packPublication({root:dist,frontendRoot:resolve('release/frontend'),publication,compressFinancialAudit:true,bindings:{sourceCommit:state.controllerSha,appCommit:state.sourceSha,candidateId:control.capture.capture_sha256}});
  validateReceipt(publication);writeFileSync(join(dist,'publication.json'),JSON.stringify(publication));state.limited.publicationHash=sha256(read(join(dist,'publication.json')));return state;
}
export async function recheckLimited(state,{api=githubApi,fetcher=fetch}={}){
  currentMain(state.controllerSha,api);
  const raw=read(join(root(),LIMITED_APPROVAL_PATH));if(sha256(raw)!==state.limited.controlHash)throw Error('Limited approval changed before deployment');const control=parseLimitedReleaseControl(raw,{activation:true});
  equal(control,state.limited.control,'final committed control');
  verifyLimitedControlEvidence(control,control.assessment);const evidence=verifyLimitedRuns(control,bootstrap.repository,api,{artifact:true});equal(evidence.artifact,state.limited.artifact,'artifact metadata');equal(evidence.checks,state.decision.approval.checks,'final consumer checks');
  equal(state.decision.approval,parseLimitedPreviewUiApproval({type:'limited-research-preview-v1',sha:control.approval.ui.sha,ui_digest:control.approval.ui.inventory_sha256,controller_sha:state.controllerSha,approval_sha256:sha256(raw),approval_path:LIMITED_APPROVAL_PATH,financial:control.financial,checks:evidence.checks}),'final authority');
  const live=await livePublication({api,fetcher});validateContext(control,live,state.controllerSha,api);await verifyLimitedCapture(state,state.limited.captureRoot);
  const dist=resolve('release/frontend/dist'),bytes=read(join(dist,'publication.json'));if(sha256(bytes)!==state.limited.publicationHash)throw Error('Limited composed receipt changed');const publication=validateReceipt(parsePublicationReceipt(bytes));
  const logical=await canonicalPublication({root:dist,frontendRoot:resolve('release/frontend'),publication,restore:join(folder(),'recheck-logical')});
  try{const financial=verifyFinancialReleaseAssets(logical,publication.financial_release,publication);
  const before=frozenInventory(state.limited.captureRoot);const additions=[financial.source_projection.path,financial.source_base.path,financial.evaluation_projection.path,publication.financial_release.path].filter(p=>!Object.hasOwn(before,p));equal([...new Set(additions)].sort(),[...state.limited.added].sort(),'only frozen financial audit additions');
  equal(dataInventory(logical,state.limited.added),frozenInventory(state.limited.captureRoot),'final frozen data');if(inventoryDigest(uiInventory(logical))!==control.approval.ui.inventory_sha256)throw Error('Final captured UI changed');const finance=verifyFinancialReleaseAssets(logical,publication.financial_release,publication);assertFinancialLineageContinuity(live,finance);equal(publication.approval,state.decision.approval,'final approval');equal(publication.price_observations,live.receipt.price_observations,'final price observations');equal(publication.known_price_dates,live.receipt.known_price_dates,'final retained price ledger');equal(publication.verification_universe,live.receipt.verification_universe,'final full verification universe');}finally{removeCanonical(dist,logical);}
  execFileSync('python3',['.github/scripts/check-pages-payload.py',dist],{stdio:'inherit'});
}
