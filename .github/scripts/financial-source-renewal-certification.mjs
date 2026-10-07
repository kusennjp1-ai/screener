import {previewSchemaForRequest,assertPostcaptureRenewalDelta} from './financial-candidate-preview-postcapture.mjs';
import {isPostcaptureReference,verifyPostcaptureArchive} from './verify-postcapture-correction-source.mjs';
// Artifact-only certification. This producer never acquires provider data,
// grants publication authority, writes a release control, or deploys a site.
import {execFileSync} from 'node:child_process';
import {appendFileSync,cpSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dataInventory,digest,restoreCorrectionSource,verifyCorrectionChecks,verifyCorrectionConsumerChecks} from './financial-correction.mjs';
import {assertFinancialAuditDirectory,FINANCIAL_AUDIT_MAX_FILE_BYTES} from './financial-audit-history.mjs';
import {bootstrap,downloadArtifact,inventoryDigest,isData,livePublication,sha256,uiInventory} from './publication-state.mjs';
import {githubApi,withInvocationImmutableGitApi} from './publication-gate.mjs';
import {completeInventory,extractCandidateTar,financialReleasePolicy,protectedCodeInventory,validateFinancialReleaseReceipt,verifyCandidateTransport,verifyFinancialReleaseAssets} from './financial-release-activation.mjs';
import {prepareRenewalCandidateTransport} from './financial-renewal-candidate-transport.mjs';
import {renewalCiEligibility,renewalCiLocalContext,verifyRenewalCiAdmission} from './financial-renewal-ci-admission.mjs';
import {enforceRenewalQuota} from './financial-renewal-quota.mjs';
import {preparePreview,validatePreviewReceipt,verifyExistingPredecessor,verifyPredecessor} from './financial-candidate-preview.mjs';
import {isPerformanceException,verifyPerformanceUiApproval,verifyExceptionFinancialScope} from './financial-performance-exception.mjs';
import {canonicalPublication,removeCanonical} from './static-transport-publication.mjs';
import {assertRenewalCapacity,assertCurrentRenewalEvaluation,verifyRenewalEvaluationCurrent,assertRetainedFinancialHistory,consumerCodeInventory,financialAuditInventory,parseRenewalRequest,readRenewalControls,renewalPolicy,renewalSchema,validateRenewalCandidate,validateRenewalRegistry,validateSourceRenewalDelta,verifyPreparedRenewal,verifyPublishedRenewal,verifyRenewalPredecessor,verifyRenewalInitialCapturePolicy} from './financial-source-renewal.mjs';

const controllerRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const registryPath='contracts/financial_source_renewal_v1.json';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(value));};
const equal=(left,right,label)=>{if(digest(left)!==digest(right))throw Error(`Renewal certification ${label} mismatch`);};
const git=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const fileHash=path=>execFileSync('sha256sum',[path],{encoding:'utf8'}).split(' ')[0];
const archiveLimit=financialReleasePolicy.maximum_archive_bytes;
const sourceZipLimit=128*1024*1024;
const scratch=()=>join(process.env.RUNNER_TEMP||'/tmp','financial-source-renewal-certification');
const currentProducer=root=>({repository:bootstrap.repository,workflow:renewalPolicy.workflow,head_sha:git(root,['rev-parse','HEAD']),run_id:Number(process.env.GITHUB_RUN_ID),run_attempt:Number(process.env.GITHUB_RUN_ATTEMPT)});

function regular(path,maximum=archiveLimit){
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size<=0||stat.size>maximum)throw Error('Invalid bounded renewal artifact file');
  return stat;
}
function boundArchive(path,sum,maximum=archiveLimit){
  regular(path,maximum);
  if(fileHash(path)!==sum)throw Error('Retained renewal archive digest changed');
}
function committedBytes(root,path){
  regular(join(root,path),renewalPolicy.maximum_control_bytes);
  const bytes=readFileSync(join(root,path)),committed=execFileSync('git',['-C',root,'show',`HEAD:${path}`],{maxBuffer:renewalPolicy.maximum_control_bytes});
  if(!bytes.equals(committed))throw Error('Renewal control differs from committed bytes');
  return bytes;
}
export function assertCertificationSourceTrustPreserved(before,after){
  if(!Array.isArray(before?.reviewed_requests)||!Array.isArray(after?.reviewed_requests))throw Error('Invalid original source certification trust');
  equal({...before,reviewed_requests:[]},{...after,reviewed_requests:[]},'original source certification policy');
  equal(before.reviewed_requests,after.reviewed_requests.slice(0,before.reviewed_requests.length),'retained original source trust records');
}
function requestAtCheckout(root,request,{consumer=true}={}){
  parseRenewalRequest(request);
  if(resolve(root)!==controllerRoot)throw Error('Renewal must execute the checked-out certification controller');
  if(git(root,['status','--porcelain','--untracked-files=no']))throw Error('Renewal certification controller must be committed and clean');
  const bytes=committedBytes(root,renewalPolicy.request_path);
  equal(JSON.parse(bytes),request,'committed request');
  const registryBytes=committedBytes(root,registryPath);validateRenewalRegistry(JSON.parse(registryBytes));
  const head=git(root,['rev-parse','HEAD']);if(!consumer)return {head};
  const captured=protectedCodeInventory(root,request.ui.sha),executing=protectedCodeInventory(root,head);
  if(digest(consumerCodeInventory(captured))!==request.consumer_code_sha256)throw Error('Renewal certification changed the approved consumer or projector');
  const sourceTrustPath='contracts/financial_source_certification_trust_v1.json';
  const priorTrust=JSON.parse(execFileSync('git',['-C',root,'show',`${request.ui.sha}:${sourceTrustPath}`],{maxBuffer:renewalPolicy.maximum_control_bytes}));
  assertCertificationSourceTrustPreserved(priorTrust,JSON.parse(committedBytes(root,sourceTrustPath)));
  return {head,tree:git(root,['rev-parse',`${request.ui.sha}^{tree}`]),captured,executing,registryBytes};
}

function verifyCertificationCompatibility({predecessorRoot,request,code,api}){
  // Release receipts remain identity files under both transport layers. Their
  // committed request digest authenticates this small preflight independently
  // of the complete retained archive and decoded-data checks that follow.
  assertFinancialAuditDirectory(predecessorRoot);
  const originPath=join(predecessorRoot,request.origin_release.path);
  regular(originPath,FINANCIAL_AUDIT_MAX_FILE_BYTES);
  const initialCapture=verifyRenewalInitialCapturePolicy({request,certificationSha:code.head,originBytes:readFileSync(originPath),api});
  return initialCapture.verifyConsumerCode(code.captured,code.executing);
}

function currentCiAdmission(root,api){
  if(process.env.GITHUB_EVENT_NAME!=='workflow_run')return null;
  const path=process.env.GITHUB_EVENT_PATH;
  if(!path)throw Error('Automatic renewal certification requires its original workflow_run event');
  regular(path,1024*1024);
  const proof=verifyRenewalCiAdmission({root,phase:'certify',event:read(path),api});
  if(proof?.schema_version!=='financial-renewal-ci-admission-proof-v1')throw Error('Automatic renewal certification is not admitted');
  return proof;
}

export function verifyRenewalCertifierController(root,api=githubApi){
  const ci_admission=currentCiAdmission(root,api);
  const head_sha=git(root,['rev-parse','HEAD']),tree=git(root,['rev-parse','HEAD^{tree}']),checks=verifyCorrectionChecks(bootstrap.repository,head_sha,api);
  const first=checks[0],jobs=api(`repos/${bootstrap.repository}/actions/runs/${first.run_id}/attempts/${first.run_attempt}/jobs?per_page=100`,true).flatMap(page=>page.jobs);
  for(const check of checks){
    const matching=jobs.filter(job=>job.name===check.name);
    if(matching.length!==1||matching[0].id!==check.job_id||matching[0].head_sha!==head_sha||matching[0].run_id!==check.run_id||matching[0].run_attempt!==check.run_attempt
      ||matching[0].status!=='completed'||matching[0].conclusion!=='success')throw Error('Renewal certifier CI job does not belong to the exact successful attempt');
  }
  if(ci_admission){
    equal(ci_admission.executing,{head_sha,tree},'admitted controller');
    equal(ci_admission.checks,checks,'admitted exact CI checks');
  }
  return {head_sha,tree,checks,...(ci_admission?{ci_admission}:{})};
}

// Exported for the release restorer. Historical source availability is not
// required: immutable ZIP bytes are authenticated by the active live lineage.
// The offline restore option rejects a missing ZIP even if it disappears after
// the initial digest check. No fallback retrieval can occur during replay.
export function restorePriorRenewalSource({candidate,live}){
  assertRenewalCapacity(candidate);
  const source=live.financialRelease.lineage.source,base=join(candidate,'original-previous-source');
  boundArchive(join(base,'source.zip'),source.artifact_sha256,sourceZipLimit);
  return restoreCorrectionSource(source,base,{artifact:{digest:`sha256:${source.artifact_sha256}`}},{offline:true});
}

export function retainApprovedRenewalUi({predecessor,baseline,corrected,uiFiles,uiDigest}){
  // Examine the complete trees before deleting anything; hidden links, linked
  // directories and data/UI path collisions cannot escape the inventory gate.
  for(const root of [predecessor,baseline,corrected]){assertRenewalCapacity(root);completeInventory(root);}
  equal(uiInventory(predecessor),uiFiles,'approved predecessor UI inventory');
  if(inventoryDigest(uiFiles)!==uiDigest)throw Error('Renewal approved UI digest changed');
  for(const target of [baseline,corrected]){
    const before=dataInventory(target);
    for(const name of readdirSync(target))if(name!=='static-data'&&!isData(name)&&name!=='publication.json')rmSync(join(target,name),{recursive:true,force:true});
    rmSync(join(target,'publication.json'),{force:true});
    for(const path of Object.keys(uiFiles)){mkdirSync(dirname(join(target,path)),{recursive:true});cpSync(join(predecessor,path),join(target,path));}
    equal(uiInventory(target),uiFiles,'retained exact approved UI');
    equal(dataInventory(target),before,'unchanged compiler output');
  }
  return uiDigest;
}

function projectionPath(candidate,checksum){
  const matches=Object.entries(completeInventory(join(candidate,'projection'))).filter(([,sum])=>sum===checksum);
  if(matches.length!==1)throw Error('Missing or ambiguous sealed native projection');
  return join(candidate,'projection',matches[0][0]);
}

async function verifyOriginalAuthority({candidate,request,live,root,api}){
  verifyRenewalPredecessor(request,live);
  const artifact=read(join(candidate,'evidence.json')).predecessor_artifact,predecessor=join(candidate,'predecessor');
  if(artifact.id!==request.price_input.artifact_id||artifact.digest!==`sha256:${request.price_input.artifact_sha256}`)throw Error('Renewal predecessor artifact selection changed');
  verifyExistingPredecessor(join(candidate,'original-predecessor/artifact.zip'),predecessor,artifact);
  const checked=await verifyPredecessor(predecessor,live,artifact,live.identity,join(root,'frontend'));
  try{
    equal(verifyFinancialReleaseAssets(checked.logicalRoot,request.previous_release,live.receipt),live.financialRelease,'retained live financial release');
    const bytes=readFileSync(join(checked.logicalRoot,request.origin_release.path));
    if(sha256(bytes)!==request.origin_release.sha256)throw Error('Retained original activation bytes changed');
    const origin=validateFinancialReleaseReceipt(JSON.parse(bytes));
    if(origin.schema_version!=='financial-release-receipt-v1'||origin.mode!=='activation'||origin.renewal)throw Error('Renewal requires the retained original activation');
    if(!live.financialRelease.renewal&&origin.lineage_sha256!==live.financialRelease.lineage_sha256)throw Error('Renewal origin changed its source lineage');
    if(isPerformanceException(origin.ui.approval)){
      const approval=verifyPerformanceUiApproval({ui_sha:origin.ui.approved_sha,ui_digest:origin.ui.digest,approval:origin.ui.approval},bootstrap.repository,api);
      verifyExceptionFinancialScope(origin,approval);
    }
    if(!isPerformanceException(live.approval))verifyCorrectionConsumerChecks(live,bootstrap.repository,api);
    await verifyPublishedRenewal(live.financialRelease,{readAsset:path=>readFileSync(join(checked.logicalRoot,path)),api});
    return financialAuditInventory(checked.logicalRoot);
  }finally{removeCanonical(predecessor,checked.logicalRoot);}
}

function verifyPreviousCertificate({candidate,live,python}){
  const reference=live.financialRelease.lineage.certificate,path=join(candidate,'original-previous-certification/artifact.zip');
  boundArchive(path,reference.artifact_sha256,sourceZipLimit);
  if(isPostcaptureReference(reference)){
    const report=verifyPostcaptureArchive(path,reference.receipt_sha256);
    equal(report.receipt.source,live.financialRelease.lineage.source,'retained prior companion source');
    if(report.receipt.validation.code_sha!==reference.head_sha)throw Error('Retained prior companion controller changed');
    return report;
  }
  const report=JSON.parse(execFileSync(python,[join(controllerRoot,'.github/scripts/verify-certified-correction-archive.py'),path,reference.certificate_sha256],{encoding:'utf8',maxBuffer:renewalPolicy.maximum_proof_bytes}));
  equal(report.certificate.source,live.financialRelease.lineage.source,'retained prior certificate source');
  if(report.certificate.validation.code_sha!==reference.head_sha)throw Error('Retained prior certificate controller changed');
  return report;
}

export async function verifyRenewalCertificationSources({root=controllerRoot,candidate,request=read(join(candidate,'renewal-request.json')),live=read(join(candidate,'evidence.json')).live,python=process.env.FINANCIAL_REPLAY_PYTHON||'python3'}){
  parseRenewalRequest(request);verifyRenewalPredecessor(request,live);assertCurrentRenewalEvaluation(request.target.evaluated_at);
  equal(read(join(candidate,'renewal-request.json')),request,'saved renewal request');
  const receipt=validatePreviewReceipt(read(join(candidate,'preview-receipt.json')));
  if(receipt.financial.evaluated_at!==request.target.evaluated_at)throw Error('Renewal preview evaluation differs from selected target');
  verifyPreviousCertificate({candidate,live,python});
  const previousSourceRoot=restorePriorRenewalSource({candidate,live}),path=projectionPath(candidate,receipt.financial.projection_sha256);
  const source=request.financial_request.correction.source;
  boundArchive(join(candidate,'original-source/source.zip'),source.artifact_sha256,sourceZipLimit);
  boundArchive(join(candidate,'original-certification/artifact.zip'),request.financial_request.source_validation.certificate.artifact_sha256,sourceZipLimit);
  // Every new extraction is checked against its retained ZIP, even if a caller
  // has changed a previously extracted tree since the preview completed.
  const sourceRoot=restoreCorrectionSource(source,join(candidate,'original-source'),{artifact:{digest:`sha256:${source.artifact_sha256}`}},{offline:true});
  const physical=join(candidate,'predecessor'),restore=join(candidate,'renewal-source-predecessor-logical');rmSync(restore,{recursive:true,force:true});
  const predecessor=await canonicalPublication({root:physical,frontendRoot:join(root,'frontend'),publication:live.receipt,restore});
  try{
  const sourceDelta=validateSourceRenewalDelta(JSON.parse(execFileSync(python,[join(root,'backend/app/scripts/verify_statement_source_renewal.py'),
    '--previous-archive',previousSourceRoot,'--archive',sourceRoot,
    '--previous-projection',join(predecessor,live.financialRelease.source_projection.path),'--projection',path,
    '--evaluated-at',receipt.financial.evaluated_at],{encoding:'utf8',maxBuffer:renewalPolicy.maximum_proof_bytes,env:{...process.env,PYTHONPATH:join(root,'backend'),LITELLM_LOCAL_MODEL_COST_MAP:'true'}})));
  if(sourceDelta.new_receipt_count>request.maximum_new_receipts||sourceDelta.previous.archive_manifest_sha256!==live.financialRelease.lineage.source.archive_manifest_sha256
    ||sourceDelta.previous.projection_sha256!==live.financialRelease.source_projection.sha256||sourceDelta.previous.receipt_inventory_sha256!==live.financialRelease.lineage.receipt_inventory_sha256
    ||sourceDelta.current.archive_manifest_sha256!==source.archive_manifest_sha256||sourceDelta.current.projection_sha256!==receipt.financial.projection_sha256
    ||sourceDelta.current.receipt_inventory_sha256!==receipt.financial.receipt_inventory_sha256)throw Error('Renewal source delta changed its authenticated source/projection bindings');
  assertPostcaptureRenewalDelta(sourceDelta,receipt.source_validation.certificate);
  const saved=join(candidate,'source-delta.json');if(existsSync(saved))equal(read(saved),sourceDelta,'saved source delta');
  return {sourceDelta,previousSourceRoot,projectionPath:path};
  }finally{removeCanonical(physical,predecessor);}
}

export function verifyRenewalCertificationBounds({candidate,python='python3'}){
  const capacity=assertRenewalCapacity(candidate);
  let pages;
  try{pages=JSON.parse(execFileSync(python,[join(controllerRoot,'.github/scripts/check-pages-payload.py'),join(candidate,'corrected')],{encoding:'utf8',maxBuffer:1024*1024}));}
  catch(error){let report;try{report=JSON.parse(error.stdout);}catch{}if(report?.ok===false&&typeof report.error==='string')throw Error(`Renewal physical Pages bound rejected: ${report.error}`);throw error;}
  if(pages.ok!==true||pages.site_limit_bytes!==1_000_000_000||pages.tar_limit_bytes!==1_000_000_000)throw Error('Renewal physical Pages bounds were not verified');
  return {capacity,pages};
}

// All options are paths or exact captured identities. No injectable verifier,
// trust registry, projection implementation, CLI flag or environment switch is
// accepted. Tests run this same module in their own committed fixture checkout.
export async function prepareRenewalCertification({root=controllerRoot,request,live,output,predecessorArtifact,predecessorZip,predecessorRoot,sourceZip,certificateZip,previousSourceZip,previousCertificateZip,evidence,python=process.env.FINANCIAL_REPLAY_PYTHON||'python3',api=githubApi}){
  request=request||readRenewalControls(root).request;
  const code=requestAtCheckout(root,request);verifyRenewalPredecessor(request,live);assertCurrentRenewalEvaluation(request.target.evaluated_at);
  const certifyingController=verifyRenewalCertifierController(root,api);
  if(existsSync(output))throw Error('Renewal certification output must be a new directory');
  output=resolve(output);
  equal(evidence.live,live,'recorded predecessor');equal(evidence.predecessor_artifact,predecessorArtifact,'recorded predecessor artifact');
  if(predecessorArtifact.id!==request.price_input.artifact_id||predecessorArtifact.digest!==`sha256:${request.price_input.artifact_sha256}`)throw Error('Renewal requires the exact current Pages price artifact');
  for(const [path,sum,bound]of [[predecessorZip,request.price_input.artifact_sha256,archiveLimit],[sourceZip,request.financial_request.correction.source.artifact_sha256,sourceZipLimit],
    [certificateZip,request.financial_request.source_validation.certificate.artifact_sha256,sourceZipLimit],[previousSourceZip,live.financialRelease.lineage.source.artifact_sha256,sourceZipLimit],
    [previousCertificateZip,live.financialRelease.lineage.certificate.artifact_sha256,sourceZipLimit]])boundArchive(path,sum,bound);
  const inputs=`${output}.inputs`;if(existsSync(inputs))throw Error('Renewal preparation scratch directory already exists');mkdirSync(inputs,{recursive:true});
  try{
    if(!predecessorRoot){
      const archive=join(inputs,'predecessor');mkdirSync(archive);cpSync(predecessorZip,join(archive,'artifact.zip'));
      // ZIP is already present and authenticated: this invocation is offline.
      downloadArtifact(predecessorArtifact,archive,bootstrap.repository,'artifact.tar',archiveLimit);
      predecessorRoot=join(inputs,'predecessor-files');extractCandidateTar(join(archive,'artifact.tar'),predecessorRoot);
      rmSync(join(archive,'artifact.tar'));
    }
    assertRenewalCapacity(predecessorRoot);verifyExistingPredecessor(predecessorZip,predecessorRoot,predecessorArtifact);
    verifyCertificationCompatibility({predecessorRoot,request,code,api});
    const preview={schema_version:previewSchemaForRequest(request.financial_request),kind:'unpublished_financial_candidate',candidate_ui:{sha:request.ui.sha,tree:code.tree},
      correction:request.financial_request.correction,source_validation:request.financial_request.source_validation,destination_projection:request.financial_request.destination_projection};
    write(join(inputs,'request.json'),preview);write(join(inputs,'evidence.json'),evidence);
    await preparePreview({requestPath:join(inputs,'request.json'),evidencePath:join(inputs,'evidence.json'),candidateRoot:root,predecessorZip,predecessorRoot,sourceZip,certificateZip,output,python,preservePublishedPriceHistory:true,renewalEvaluation:{evaluated_at:request.target.evaluated_at,expected_base_sha256:request.target.base_sha256}});
    cpSync(predecessorRoot,join(output,'predecessor'),{recursive:true});
    for(const [path,destination]of [[previousSourceZip,'original-previous-source/source.zip'],[previousCertificateZip,'original-previous-certification/artifact.zip']]){
      mkdirSync(dirname(join(output,destination)),{recursive:true});cpSync(path,join(output,destination));
    }
    write(join(output,'renewal-request.json'),request);write(join(output,'release-request.json'),request.financial_request);write(join(output,'protected-code.json'),code.captured);
    writeFileSync(join(output,'certification-registry.json'),code.registryBytes);write(join(output,'certification-controller.json'),certifyingController);
    const history=await verifyOriginalAuthority({candidate:output,request,live,root,api});
    assertRetainedFinancialHistory(history,financialAuditInventory(join(output,'corrected')));
    write(join(output,'history-inventory.json'),history);
    // Data is compiled by the approved consumer, but emitted HTML, SW, JS and
    // assets come exclusively from the immutable published predecessor.
    retainApprovedRenewalUi({predecessor:join(output,'predecessor'),baseline:join(output,'baseline'),corrected:join(output,'corrected'),uiFiles:live.uiFiles,uiDigest:request.ui.digest});
    const receipt=validatePreviewReceipt(read(join(output,'preview-receipt.json')));
    receipt.candidate_ui.digest=request.ui.digest;validatePreviewReceipt(receipt);write(join(output,'preview-receipt.json'),receipt);
    const sources=await verifyRenewalCertificationSources({root,candidate:output,request,live,python});write(join(output,'source-delta.json'),sources.sourceDelta);
    await prepareRenewalCandidateTransport(root,output);
    for(const path of ['candidate-source','candidate-source.tar','corrected-logical'])rmSync(join(output,path),{recursive:true,force:true});
    verifyRenewalCertificationBounds({candidate:output,python});
    return {candidate:output,request,receipt,history,certificationController:certifyingController,...sources};
  }finally{rmSync(inputs,{recursive:true,force:true});}
}

function certificationRecord({root,candidate,request,producer,api}){
  const code=requestAtCheckout(root,request);
  // Reject incompatible controllers before hashing large candidate trees or
  // replaying sources, projections and canonical publication data at seal time.
  verifyCertificationCompatibility({predecessorRoot:join(candidate,'predecessor'),request,code,api});
  const receiptBytes=readFileSync(join(candidate,'preview-receipt.json')),receipt=validatePreviewReceipt(JSON.parse(receiptBytes));
  if(producer.head_sha!==code.head||receipt.controller.sha!==code.head||receipt.controller.tree!==git(root,['rev-parse','HEAD^{tree}']))throw Error('Renewal seal controller differs from prepared source');
  equal(read(join(candidate,'protected-code.json')),code.captured,'captured protected source');
  if(!readFileSync(join(candidate,'certification-registry.json')).equals(code.registryBytes))throw Error('Renewal captured registry differs from the committed certifier registry');
  if(receipt.financial.evaluated_at!==request.target.evaluated_at)throw Error('Renewal preview evaluation differs from selected target');
  assertCurrentRenewalEvaluation(request.target.evaluated_at);
  const now=Date.now();
  return validateRenewalCandidate({schema_version:renewalSchema,producer,captured_ui:receipt.candidate_ui,
    request_sha256:digest(request.financial_request),preview_receipt_sha256:sha256(receiptBytes),corrected_inventory_sha256:inventoryDigest(completeInventory(join(candidate,'corrected'))),
    protected_code_sha256:digest(code.captured),transport_sha256:sha256(readFileSync(join(candidate,'transport.json'))),registry_sha256:sha256(code.registryBytes),
    certification_controller_sha256:digest(read(join(candidate,'certification-controller.json'))),
    renewal_request_sha256:digest(request),logical_data_inventory_sha256:receipt.bundles.corrected_data_sha256,source_projection_sha256:receipt.financial.projection_sha256,
    source_base_sha256:sha256(readFileSync(join(candidate,'target-base.json'))),receipt_inventory_sha256:receipt.financial.receipt_inventory_sha256,financial_generation:receipt.financial.generation,
    source_delta_sha256:digest(read(join(candidate,'source-delta.json'))),history_inventory_sha256:inventoryDigest(read(join(candidate,'history-inventory.json'))),sealed_at:new Date(now).toISOString()});
}

export async function verifyRenewalCertificationSurfaces({root=controllerRoot,candidate,request=read(join(candidate,'renewal-request.json')),live,producer=currentProducer(root),api=githubApi,python=process.env.FINANCIAL_REPLAY_PYTHON||'python3'}){
  live=live||read(join(candidate,'evidence.json')).live;
  const record=certificationRecord({root,candidate,request,producer,api});
  const certifyingController=verifyRenewalCertifierController(root,api);equal(read(join(candidate,'certification-controller.json')),certifyingController,'saved exact certifier CI');
  const sources=await verifyRenewalCertificationSources({root,candidate,request,live,python});
  const history=await verifyOriginalAuthority({candidate,request,live,root,api});equal(history,read(join(candidate,'history-inventory.json')),'saved retained audit history');
  await verifyCandidateTransport(root,candidate,record);
  const replay=await verifyPreparedRenewal({candidate,request,record,live,root,previousSourceRoot:sources.previousSourceRoot,api});
  return {record,...replay,...sources,history,certificationController:certifyingController};
}

export const renewalCandidateMembers=Object.freeze(['candidate.json','renewal-request.json','source-delta.json','history-inventory.json','release-request.json','protected-code.json',
  'preview-receipt.json','verification.json','request.json','evidence.json','target-base.json','projection','corrected','baseline','predecessor','original-source','original-certification',
  'original-predecessor','original-previous-source','original-previous-certification','transport.json','certification-registry.json','certification-controller.json']);

export function verifySealedRenewalArchive({candidate,archive,python='python3'}){
  regular(archive,archiveLimit);assertRenewalCapacity(candidate);
  return JSON.parse(execFileSync(python,['-c',`import hashlib,json,pathlib,sys,tarfile
root=pathlib.Path(sys.argv[1]);members=json.loads(sys.argv[3]);expected=set();seen=set();files=set();total=0
def digest(stream):
 h=hashlib.sha256()
 for data in iter(lambda:stream.read(1024*1024),b''):h.update(data)
 return h.hexdigest()
for name in members:
 p=root/name
 assert p.exists() and not p.is_symlink(),'Missing original sealed renewal member'
 if p.is_file():expected.add(name)
 else:
  assert p.is_dir(),'Special original renewal member'
  for child in p.rglob('*'):
   assert not child.is_symlink(),'Linked original renewal member'
   if child.is_file():expected.add(child.relative_to(root).as_posix())
with tarfile.open(sys.argv[2],mode='r|') as archive:
 for item in archive:
  name=item.name.rstrip('/')
  assert name and not name.startswith('/') and '\\\\' not in name and all(p not in ('','.','..') for p in name.split('/')),'Unsafe sealed renewal member'
  assert name.split('/')[0] in members and name not in seen,'Unlisted or duplicate sealed renewal member'
  assert item.isfile() or item.isdir(),'Linked or special sealed renewal member'
  seen.add(name);total+=item.size
  assert len(seen)<=int(sys.argv[4]) and total<=int(sys.argv[5]),'Sealed renewal archive exceeds bounds'
  p=root/name
  if item.isdir():assert p.is_dir(),'Missing original sealed renewal directory'
  else:
   assert name in expected and p.is_file() and p.stat().st_size==item.size,'Unexpected sealed renewal file'
   with p.open('rb') as original:assert digest(archive.extractfile(item))==digest(original),'Sealed renewal file readback mismatch: '+name
   files.add(name)
assert files==expected,'Sealed renewal archive omitted required original files'
print(json.dumps({'files':len(files),'bytes':total,'status':'verified'}))
`,candidate,archive,JSON.stringify(renewalCandidateMembers),String(financialReleasePolicy.maximum_archive_files),String(archiveLimit)],{encoding:'utf8',maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']}));
}

export async function sealRenewalCertification({root=controllerRoot,candidate,request=read(join(candidate,'renewal-request.json')),live,producer=currentProducer(root),api=githubApi,python=process.env.FINANCIAL_REPLAY_PYTHON||'python3'}){
  if(existsSync(join(candidate,'candidate.json')))throw Error('A sealed renewal candidate cannot be resealed');
  const result=await verifyRenewalCertificationSurfaces({root,candidate,request,live,producer,api,python});
  verifyRenewalCertificationBounds({candidate,python});
  const before=completeInventory(candidate);
  await verifyRenewalEvaluationCurrent({request,projection:result.projection,frontendRoot:join(root,'frontend')});
  // Sample the real seal instant after verification; no caller-supplied clock.
  result.record=validateRenewalCandidate({...result.record,sealed_at:new Date().toISOString()});
  write(join(candidate,'candidate.json'),result.record);
  const archive=join(dirname(candidate),'candidate.tar');if(existsSync(archive))throw Error('Renewal archive destination already exists');
  // Enumerate the closed, retained proof tree and reject links before tar. The
  // archive limit includes TAR overhead, independently of the physical Pages cap.
  assertRenewalCapacity(candidate);
  for(const member of renewalCandidateMembers){const path=join(candidate,member),stat=lstatSync(path);if(stat.isDirectory()&&!stat.isSymbolicLink())completeInventory(path);else regular(path);}
  execFileSync('tar',['-cf',archive,'-C',candidate,...renewalCandidateMembers],{stdio:'pipe'});regular(archive,archiveLimit);
  const archiveReadback=verifySealedRenewalArchive({candidate,archive,python});
  const after=completeInventory(candidate);delete after['candidate.json'];equal(before,after,'inputs during sealing');
  if(inventoryDigest(completeInventory(join(candidate,'corrected')))!==result.record.corrected_inventory_sha256)throw Error('Renewal physical candidate changed during archiving');
  if(process.env.GITHUB_EVENT_NAME==='workflow_run'){
    enforceRenewalQuota('certify','seal-final');
    equal(read(join(candidate,'certification-controller.json')),verifyRenewalCertifierController(root,api),'current admitted certifier after sealing');
  }
  await verifyRenewalEvaluationCurrent({request,projection:result.projection,frontendRoot:join(root,'frontend')});
  return {...result,candidate,archive,archiveReadback};
}

function attemptEvidence(reference,api,certifier=false){
  const base=`repos/${reference.repository}/actions/runs/${reference.run_id}`;
  const value={run:api(`${base}/attempts/${reference.run_attempt}`),jobs:api(`${base}/attempts/${reference.run_attempt}/jobs?per_page=100`,true).flatMap(page=>page.jobs),artifacts:api(`${base}/artifacts?per_page=100`,true).flatMap(page=>page.artifacts)};
  if(certifier){value.commit=api(`repos/${reference.repository}/git/commits/${reference.head_sha}`);value.tree=api(`repos/${reference.repository}/git/trees/${value.commit.tree.sha}?recursive=1`);}
  return value;
}

// Read-only GitHub artifact retrieval has a streaming size limit. It never
// invokes a collection workflow, provider getter, or a mutable artifact alias.
function downloadPinnedArchive(reference,path,maximum=sourceZipLimit){
  if(!/^[1-9][0-9]*$/.test(String(reference.artifact_id))||reference.repository!==bootstrap.repository||!/^[a-f0-9]{64}$/.test(reference.artifact_sha256))throw Error('Invalid exact renewal archive reference');
  mkdirSync(dirname(path),{recursive:true});
  if(!existsSync(path))execFileSync('python3',['-c',`import pathlib,subprocess,sys
p=pathlib.Path(sys.argv[1]);limit=int(sys.argv[2]);total=0
child=subprocess.Popen(['gh','api',sys.argv[3]],stdout=subprocess.PIPE)
try:
 with p.open('xb') as output:
  while True:
   data=child.stdout.read(1024*1024)
   if not data:break
   total+=len(data)
   if total>limit:raise ValueError('Renewal ZIP exceeds bounded artifact size')
   output.write(data)
 if child.wait()!=0:raise ValueError('Renewal immutable artifact retrieval failed')
except BaseException:
 child.kill();child.wait();p.unlink(missing_ok=True);raise
finally:child.stdout.close()
`,path,String(maximum),`repos/${reference.repository}/actions/artifacts/${reference.artifact_id}/zip`],{stdio:'pipe'});
  boundArchive(path,reference.artifact_sha256,maximum);return path;
}

export async function prepareCurrentRenewalCertification({root=controllerRoot,api=githubApi}={}){
  const request=readRenewalControls(root).request;requestAtCheckout(root,request);
  const live=await livePublication({api});verifyRenewalPredecessor(request,live);
  const artifacts=api(`repos/${bootstrap.repository}/actions/runs/${live.receipt.run_id}/artifacts?per_page=100`,true).flatMap(page=>page.artifacts);
  const selected=artifacts.filter(item=>item.id===request.price_input.artifact_id||item.name===live.receipt.artifact_name);
  if(selected.length!==1||selected[0].id!==request.price_input.artifact_id||selected[0].digest!==`sha256:${request.price_input.artifact_sha256}`||selected[0].expired!==false)throw Error('Current published renewal predecessor artifact is missing or ambiguous');
  const predecessorArtifact=selected[0],base=scratch(),inputs=join(base,'inputs'),output=join(base,'prepared');
  const source=request.financial_request.correction.source,certificate=request.financial_request.source_validation.certificate;
  const evidence={live,predecessor_artifact:predecessorArtifact,source:attemptEvidence(source,api),certifier:attemptEvidence(certificate,api,true)};
  const result=await prepareRenewalCertification({root,request,live,output,predecessorArtifact,evidence,api,
    predecessorZip:downloadPinnedArchive({repository:bootstrap.repository,artifact_id:predecessorArtifact.id,artifact_sha256:request.price_input.artifact_sha256},join(inputs,'predecessor.zip'),archiveLimit),
    sourceZip:downloadPinnedArchive(source,join(inputs,'source.zip')),certificateZip:downloadPinnedArchive(certificate,join(inputs,'certificate.zip')),
    previousSourceZip:downloadPinnedArchive(live.financialRelease.lineage.source,join(inputs,'previous-source.zip')),
    previousCertificateZip:downloadPinnedArchive(live.financialRelease.lineage.certificate,join(inputs,'previous-certificate.zip'))});
  rmSync(inputs,{recursive:true,force:true});
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`candidate=true\npath=${output}\n`);
  return result;
}

function workflowContext(root){
  const automatic=process.env.GITHUB_EVENT_NAME==='workflow_run';
  if(!['workflow_dispatch','workflow_run'].includes(process.env.GITHUB_EVENT_NAME)||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!==bootstrap.repository
    ||process.env.GITHUB_WORKFLOW_REF!==`${bootstrap.repository}/${renewalPolicy.workflow}@refs/heads/main`||process.env.GITHUB_SHA!==git(root,['rev-parse','HEAD']))throw Error(`Renewal certification requires its exact main ${automatic?'workflow_run':'workflow_dispatch'} checkout`);
  if(automatic&&process.env.GITHUB_WORKFLOW_SHA!==process.env.GITHUB_SHA)throw Error('Automatic renewal certification requires its exact main workflow SHA');
  const producer=currentProducer(root);
  if(!Number.isSafeInteger(producer.run_id)||producer.run_id<=0||!Number.isSafeInteger(producer.run_attempt)||producer.run_attempt<=0)throw Error('Renewal certification requires its exact positive workflow run and attempt');
  return producer;
}
async function runCertificationCommand(){
    const [command,...extra]=process.argv.slice(2);if(extra.length||!['controls','admit','prepare','verify-source','verify-surfaces','verify-bounds','seal'].includes(command))throw Error('Unknown closed renewal certification command');
    const automatic=process.env.GITHUB_EVENT_NAME==='workflow_run';
    // Disabled or incomplete automatic policy is a cheap no-op: do not parse the
    // request, invoke Git/API/provider tools, or install the replay runtime.
    if(automatic&&command==='controls'){
      const eligibility=renewalCiEligibility({root:controllerRoot,phase:'certify'});
      if(eligibility.status!=='eligible'){
        if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'certify=false\n');
        console.log(JSON.stringify({certify:false,status:eligibility.status,publication_authority:'none'}));return;
      }
    }
    const producer=workflowContext(controllerRoot),candidate=join(scratch(),'prepared');
    if(command==='admit'&&!automatic)throw Error('Renewal CI admission requires workflow_run');
    if(automatic&&command!=='controls'){
      if(!process.env.GH_TOKEN)throw Error('Automatic renewal certification requires a read-only GitHub token');
      if(renewalCiLocalContext({root:controllerRoot,phase:'certify'}).eligible.status==='eligible')enforceRenewalQuota('certify',command);
      const controller=verifyRenewalCertifierController(controllerRoot);
      if(command!=='admit'&&command!=='prepare')equal(read(join(candidate,'certification-controller.json')),controller,'saved admitted certifier at command entry');
      if(command==='admit'){console.log(JSON.stringify({certify:true,ci_admission_sha256:digest(controller.ci_admission),publication_authority:'none'}));return;}
    }
    const request=readRenewalControls(controllerRoot).request;
    requestAtCheckout(controllerRoot,request,{consumer:command!=='controls'});
    let result;
    if(command==='controls'){
      if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`certify=true\nui_sha=${request.ui.sha}\n`);
      result={request_sha256:digest(request),ui_sha:request.ui.sha,publication_authority:'none'};
    }else if(command==='prepare'){const prepared=await prepareCurrentRenewalCertification();result={candidate:prepared.candidate,publication_authority:'none'};}
    else if(command==='verify-source'){const verified=await verifyRenewalCertificationSources({candidate,request});result={source_delta_sha256:digest(verified.sourceDelta)};}
    else if(command==='verify-bounds')result=verifyRenewalCertificationBounds({candidate});
    else{
      const live=await livePublication(),options={candidate,request,live,producer};
      const verified=command==='seal'?await sealRenewalCertification(options):await verifyRenewalCertificationSurfaces(options);
      result={candidate,record_sha256:digest(verified.record),...(verified.archive?{archive:verified.archive}:{}),publication_authority:'none'};
    }
    console.log(JSON.stringify(result));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  // Finish module evaluation before proof replay lazily imports this producer.
  // An unsettled command must never look like a successful certification.
  let completed=false;
  process.once('beforeExit',()=>{if(!completed){console.error('Renewal certification command did not complete');process.exitCode=1;}});
  const execution=process.env.GITHUB_EVENT_NAME==='workflow_run'
    ?withInvocationImmutableGitApi(bootstrap.repository,runCertificationCommand):runCertificationCommand();
  execution.then(()=>{completed=true;},error=>{completed=true;console.error(error.stack||error);process.exitCode=1;});
}
