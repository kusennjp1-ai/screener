import {financialAuditInventory} from './financial-audit-history.mjs';
export {financialAuditInventory} from './financial-audit-history.mjs';
// A separate, closed authority for an independently acquired source generation.
// This preparation is intentionally disabled for publication. Test dependencies
// are explicit function arguments; neither environment variables nor a candidate
// can supply reviewed controller or source-certifier trust.
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {contract,digest,verifyCorrectionChecks,dataInventory,verifyConsumerCapability} from './financial-correction.mjs';
import {bootstrap,sha256,inventoryDigest,safePath,uiInventory} from './publication-state.mjs';
import {parseRenewalFinancialRequest,assertPostcaptureRenewalDelta,assertPostcaptureRequestDelta} from './financial-candidate-preview-postcapture.mjs';
import {githubApi,sameRepository} from './publication-gate.mjs';
import {priceObservationDigest} from './price-observations.mjs';
import {remoteProtectedCodeInventory,verifyExceptionFinancialScope,verifyPerformanceUiApproval,isPerformanceException} from './financial-performance-exception.mjs';
import policy from '../../contracts/financial_source_renewal_v1.json' with {type:'json'};
import releasePolicy from '../../contracts/financial_release_v1.json' with {type:'json'};
import {validateReviewedConsumerTransitions,verifyReviewedConsumerTransition} from './financial-renewal-consumer-transition.mjs';
import {validateRenewalCiAdmission,validateRenewalCiProof,verifyRenewalCiProof} from './financial-renewal-ci-admission.mjs';
export {reviewedMain135ConsumerTransition} from './financial-renewal-consumer-transition.mjs';

export {policy as renewalPolicy};
export const renewalSchema='financial-source-renewal-candidate-v1';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const identity=v=>typeof v==='string'&&/^[1-9][0-9]*\/[1-9][0-9]*\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(v);
const exact=(v,keys,label)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))throw Error(`Invalid closed renewal ${label}`);};
const equal=(a,b,label)=>{if(digest(a)!==digest(b))throw Error(`Renewal ${label} mismatch`);};
const clock=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('Invalid renewal clock');return Date.parse(v);};
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const assetPattern=/^static-data\/financial-corrections\/(?:source-projection|source-base|carry-projection|release|renewal)-[a-f0-9]{64}\.json$/;

export function validateRenewalAsset(ref,kind='release'){
  exact(ref,['schema_version','path','sha256'],`${kind} reference`);
  const versions=kind==='release'?['financial-release-receipt-v1','financial-release-receipt-v2']:['financial-source-renewal-transition-v1'];
  if(!versions.includes(ref.schema_version)||!hash(ref.sha256)||ref.path!==`static-data/financial-corrections/${kind}-${ref.sha256}.json`)throw Error('Invalid renewal content-addressed reference');
  return ref;
}
export function validateRenewalChain(value){
  exact(value,['schema_version','origin','transitions'],'chain');validateRenewalAsset(value.origin);
  if(value.schema_version!=='financial-source-renewal-chain-v1'||value.origin.schema_version!=='financial-release-receipt-v1'
    ||!Array.isArray(value.transitions)||!value.transitions.length||value.transitions.length>policy.maximum_transitions)throw Error('Invalid bounded renewal chain');
  const seen=new Set();for(const ref of value.transitions){validateRenewalAsset(ref,'renewal');if(seen.has(ref.sha256))throw Error('Repeated renewal transition');seen.add(ref.sha256);}
  return value;
}
function validateRenewalPriceInput(value){
  exact(value,['artifact_id','artifact_sha256','manifest_sha256','price_observations_sha256','known_price_dates_sha256'],'price input');
  if(!positive(value.artifact_id)||!['artifact_sha256','manifest_sha256','price_observations_sha256','known_price_dates_sha256'].every(k=>hash(value[k])))throw Error('Invalid renewal price input');
}
// This is an evaluation identity for the selected target bytes, not a source
// observation or a replacement wall clock. Historical chain inspection checks
// its exact binding without requiring an old target to be current today.
export function validateRenewalEvaluationAt(value){
  const instant=clock(value);
  if(new Date(instant).toISOString()!==value)throw Error('Renewal target evaluation must be canonical UTC');
  return instant;
}
export function assertCurrentRenewalEvaluation(value){
  const instant=validateRenewalEvaluationAt(value),now=Date.now();
  if(!Number.isSafeInteger(now)||instant>now)throw Error('Renewal target evaluation is in the future');
  return instant;
}
// Use the unchanged consumer's source/proof/history deadlines. No caller may
// supply a clock, expiry, financial TTL, or alternate policy for this check.
export async function verifyRenewalEvaluationCurrent({request,projection,frontendRoot}){
  const evaluated=assertCurrentRenewalEvaluation(request.target.evaluated_at);
  if(projection.financial_evaluated_at!==request.target.evaluated_at)throw Error('Renewal projection evaluation differs from selected target');
  const consumer=await verifyConsumerCapability(frontendRoot);
  consumer.validateCorrectionProjection(projection);
  const {financialNextExpiry}=await import(pathToFileURL(join(frontendRoot,'src/static/financialCurrent.js')).href);
  // Stream rows so a full-cohort native projection is never cloned at once.
  function* rows(){for(const [symbol,item]of Object.entries(projection.symbols))yield consumer.overlayFinancialCorrection({symbol,market:item.market,as_of_date:item.as_of_date},projection);}
  const expiry=financialNextExpiry(rows(),evaluated);
  assertCurrentRenewalEvaluation(request.target.evaluated_at);
  if(expiry!==null&&Date.now()>=expiry)throw Error('Renewal current financial proof or history expired before publication');
}
export function parseRenewalRequest(value){
  exact(value,['schema_version','previous_publication_identity','previous_release','previous_lineage_sha256','previous_financial_generation','origin_release','ui','consumer_code_sha256','financial_request','target','price_input','maximum_new_receipts'],'request');
  validateRenewalAsset(value.previous_release);validateRenewalAsset(value.origin_release);
  exact(value.ui,['sha','digest','approval_sha256'],'UI');
  exact(value.target,['evaluated_at','base_sha256','manifest_sha256','price_observations_sha256','known_price_dates_sha256','universe_sha256'],'target');
  validateRenewalPriceInput(value.price_input);validateRenewalEvaluationAt(value.target.evaluated_at);
  for(const key of ['manifest_sha256','price_observations_sha256','known_price_dates_sha256'])if(value.target[key]!==value.price_input[key])throw Error('Renewal price input differs from live target');
  const request=value.financial_request;exact(request,['schema_version','correction','source_validation','destination_projection'],'financial request');
  parseRenewalFinancialRequest(request);
  // Each explicit route keeps its original or separate closed source parser;
  // neither route can replace the other source or destination authority.
  if(value.schema_version!=='financial-source-renewal-request-v1'||!identity(value.previous_publication_identity)||value.origin_release.schema_version!=='financial-release-receipt-v1'
    ||!['previous_lineage_sha256','previous_financial_generation','consumer_code_sha256'].every(k=>hash(value[k]))
    ||!sha(value.ui.sha)||!hash(value.ui.digest)||!hash(value.ui.approval_sha256)||!Object.entries(value.target).filter(([key])=>key!=='evaluated_at').every(([,value])=>hash(value))
    ||request.correction?.previous_publication_identity!==value.previous_publication_identity
    ||!positive(value.maximum_new_receipts)||value.maximum_new_receipts>policy.maximum_new_receipts)throw Error('Invalid renewal request binding');
  return value;
}
export function parseRenewalPin(value){
  exact(value,['schema_version','repository','workflow','head_sha','run_id','run_attempt','job_id','artifact_id','artifact_name','artifact_sha256','candidate_record_sha256','request_sha256'],'pin');
  if(value.schema_version!=='financial-source-renewal-pin-v1'||value.repository!==bootstrap.repository||value.workflow!==policy.workflow||!sha(value.head_sha)
    ||!['run_id','run_attempt','job_id','artifact_id'].every(k=>positive(value[k]))||value.artifact_name!==`financial-source-renewal-${value.run_id}-${value.run_attempt}`
    ||!['artifact_sha256','candidate_record_sha256','request_sha256'].every(k=>hash(value[k])))throw Error('Invalid renewal candidate pin');
  return value;
}
export function parseRenewalIntent(value){
  exact(value,['schema_version','kind','request_sha256','pin_sha256','previous_publication_identity','not_after'],'intent');
  if(value.schema_version!=='financial-source-renewal-intent-v1'||value.kind!=='same-ui-same-price-financial-source-renewal'
    ||!hash(value.request_sha256)||!hash(value.pin_sha256)||!identity(value.previous_publication_identity))throw Error('Invalid explicit renewal intent');
  clock(value.not_after);return value;
}
export function validateRenewalCandidate(value){
  exact(value,['schema_version','producer','captured_ui','request_sha256','preview_receipt_sha256','corrected_inventory_sha256','protected_code_sha256','transport_sha256',
    'renewal_request_sha256','certification_controller_sha256','registry_sha256','logical_data_inventory_sha256','source_projection_sha256','source_base_sha256','receipt_inventory_sha256','financial_generation','source_delta_sha256','history_inventory_sha256','sealed_at'],'candidate');
  exact(value.producer,['repository','workflow','head_sha','run_id','run_attempt'],'producer');exact(value.captured_ui,['sha','tree','digest'],'captured UI');
  if(value.schema_version!==renewalSchema||value.producer.repository!==bootstrap.repository||value.producer.workflow!==policy.workflow||!sha(value.producer.head_sha)
    ||!positive(value.producer.run_id)||!positive(value.producer.run_attempt)||!sha(value.captured_ui.sha)||!sha(value.captured_ui.tree)||!hash(value.captured_ui.digest)
    ||!Object.keys(value).filter(k=>k.endsWith('_sha256')||k==='financial_generation').every(k=>hash(value[k])))throw Error('Invalid sealed renewal candidate');
  clock(value.sealed_at);return value;
}
function control(root,path,parser){
  const full=join(root,path);let stat;try{stat=lstatSync(full);}catch(error){if(error.code==='ENOENT')return null;throw error;}if(!stat.isFile()||stat.isSymbolicLink()||stat.size>policy.maximum_control_bytes)throw Error('Invalid bounded renewal control file');
  return parser(read(full));
}
export function readRenewalControls(root=process.cwd()){
  return {request:control(root,policy.request_path,parseRenewalRequest),pin:control(root,policy.pin_path,parseRenewalPin),intent:control(root,policy.intent_path,parseRenewalIntent)};
}
export function assertRenewalPublicationDisabled(root=process.cwd(),input){
  const controls=readRenewalControls(root);
  if(input||Object.values(controls).some(Boolean))throw Error('Source renewal publication is disabled: reviewed source/controller authority and publisher integration are not activated');
  return controls;
}
function validateHistoryInventory(files){
  if(!files||Array.isArray(files)||typeof files!=='object'||!Object.keys(files).length||Object.keys(files).length>releasePolicy.maximum_archive_files
    ||Object.entries(files).some(([path,sum])=>!assetPattern.test(path)||!hash(sum)))throw Error('Invalid bounded retained financial history inventory');
}
export function assertRetainedFinancialHistory(before,after){
  validateHistoryInventory(before);
  for(const [path,sum]of Object.entries(before))if(after[path]!==sum)throw Error('Previous financial audit bytes were removed or changed');
}
// Conservative byte identity across the whole consumer/runtime policy surface.
// Exact controller-only source/renewal contracts are independent additions.
// Every excluded contract remains in the complete A/B/C executable inventory;
// changing it after sealing invalidates both final publication rechecks.
export function consumerCodeInventory(files){
  return Object.fromEntries(Object.entries(files).filter(([path])=>(path.startsWith('frontend/')||path.startsWith('backend/app/')||path.startsWith('contracts/'))
    &&!['backend/app/scripts/verify_statement_source_renewal.py','contracts/financial_source_renewal_v1.json','contracts/financial_source_certification_trust_v1.json','contracts/financial_performance_exception_v2.json','contracts/financial_source_postcapture_reference_v1.json','contracts/financial_source_postcapture_trust_v1.json','contracts/financial_source_postcapture_receipt_v1.schema.json','contracts/financial_source_postcapture_request_v1.json'].includes(path)));
}
// These four acceptance-harness files never feed the emitted UI or financial
// compilation. They remain part of every complete A/B/C controller inventory.
// A difference is usable only as the exact before/after pair independently
// approved for the retained original v2 activation, never as a path exemption.
const originalReviewedHarnessPaths=Object.freeze([
  'frontend/src/static/staticPublication.test.js',
  'frontend/tools/production-bootstrap-diagnostic.mjs',
  'frontend/tools/production-bootstrap-diagnostic.test.mjs',
  'frontend/tools/publication-cli.test.mjs',
]);
export function verifyRenewalPredecessor(request,live){
  parseRenewalRequest(request);
  if(!live.financialRelease||!live.receipt||live.identity!==request.previous_publication_identity)throw Error('Renewal predecessor missing or superseded');
  equal(live.receipt.financial_release,request.previous_release,'previous release');
  if(live.financialRelease.lineage_sha256!==request.previous_lineage_sha256||live.financialRelease.financial_generation!==request.previous_financial_generation)throw Error('Renewal prior active generation changed');
  if(live.financialRelease.renewal)equal(live.financialRelease.renewal.origin,request.origin_release,'original release anchor');
  else if(live.financialRelease.mode==='activation')equal(live.receipt.financial_release,request.origin_release,'original release anchor');
  // A v1 carry has no origin field. Its explicitly selected retained activation
  // is verified independently by chain inspection, never relabeled as an origin.
  if(live.uiSha!==request.ui.sha||live.uiDigest!==request.ui.digest||inventoryDigest(live.uiFiles)!==request.ui.digest||digest(live.approval)!==request.ui.approval_sha256)throw Error('Renewal changed published UI or approval');
  if(live.manifestHash!==request.target.manifest_sha256||priceObservationDigest(live.priceObservations)!==request.target.price_observations_sha256
    ||priceObservationDigest(live.knownPriceDates)!==request.target.known_price_dates_sha256||digest(live.verificationUniverse)!==request.target.universe_sha256)throw Error('Renewal changed price, date or universe');
}
export const renewalPolicyPath='contracts/financial_source_renewal_v1.json';
const sourceTrustPath='contracts/financial_source_certification_trust_v1.json';
// Registry additions are reviewed after a candidate/control commit exists. The
// executable inventory cannot hash that later registry into its own Git SHA.
// Every excluded byte is separately bound and checked below, never ignored.
export function renewalControllerCodeInventory(files){
  return Object.fromEntries(Object.entries(files).filter(([path])=>path!==renewalPolicyPath));
}
export function readRenewalRemoteBytes(api,path,revision){
  const value=api(`repos/${bootstrap.repository}/contents/${path}?ref=${revision}`);
  if(value?.type!=='file'||value.encoding!=='base64'||typeof value.content!=='string'||!positive(value.size)||value.size>policy.maximum_control_bytes)throw Error('Missing immutable renewal control');
  const bytes=Buffer.from(value.content,'base64');if(bytes.length!==value.size)throw Error('Truncated immutable renewal control');
  return bytes;
}
function exactControl(api,path,revision,expected){
  const bytes=readRenewalRemoteBytes(api,path,revision);equal(JSON.parse(bytes),expected,'immutable control');return sha256(bytes);
}
export function validateRenewalRegistry(value){
  // Historical manual registries have this exact old key set. Preserve their
  // original bytes for all hashes; only semantic validation treats absence as null.
  exact(value,Object.hasOwn(value||{},'ci_admission')?Object.keys(policy):Object.keys(policy).filter(key=>key!=='ci_admission'),'policy');
  if(typeof value.publication_enabled!=='boolean'||!Array.isArray(value.reviewed_controllers)||value.reviewed_controllers.length>policy.maximum_transitions)throw Error('Invalid bounded renewal registry');
  validateRenewalCiAdmission(value.ci_admission??null);
  validateReviewedConsumerTransitions(value.reviewed_consumer_transitions);
  equal({...value,ci_admission:null,publication_enabled:false,reviewed_controllers:[],reviewed_consumer_transitions:[]},{...policy,ci_admission:null,publication_enabled:false,reviewed_controllers:[],reviewed_consumer_transitions:[]},'fixed registry policy');
  const seen=new Set();for(const review of value.reviewed_controllers){validateReview(review);const key=`${review.controller_sha}/${review.certification_sha}`;if(seen.has(key))throw Error('Duplicate reviewed renewal authority');seen.add(key);}
  return value;
}
export function assertRenewalRegistryAppendOnly(before,after,{publicationAdmission=null}={}){
  validateRenewalRegistry(before);validateRenewalRegistry(after);
  equal(after.reviewed_controllers.slice(0,before.reviewed_controllers.length),before.reviewed_controllers,'append-only prior renewal authority');
  equal(after.reviewed_consumer_transitions.slice(0,before.reviewed_consumer_transitions.length),before.reviewed_consumer_transitions,'append-only prior consumer transition');
  if(digest(before.ci_admission??null)!==digest(after.ci_admission??null)){
    // The only retained A/B/C change is the separately authenticated B→C
    // publish admission. Callers must first independently verify that proof.
    validateRenewalCiProof(publicationAdmission);
    if(before.ci_admission?.phase!=='certify'||after.ci_admission?.phase!=='publish'||publicationAdmission.phase!=='publish')throw Error('Unreviewed renewal CI admission change');
    equal(after.ci_admission,publicationAdmission.admission,'exact verified publication CI admission');
  }
}
function verifySourceTrustAppendOnly(before,after){
  if(!Array.isArray(before.reviewed_requests)||!Array.isArray(after.reviewed_requests))throw Error('Invalid immutable source trust');
  equal({...before,reviewed_requests:[]},{...after,reviewed_requests:[]},'original source trust code');
  equal(after.reviewed_requests.slice(0,before.reviewed_requests.length),before.reviewed_requests,'append-only original source trust');
}
function validateReview(review){
  exact(review,['controller_sha','controller_tree','certification_sha','certification_tree','protected_code_sha256','request_sha256','pin_sha256','intent_sha256','request_raw_sha256','pin_raw_sha256','intent_raw_sha256'],'reviewed authority');
  if(!['controller_sha','controller_tree','certification_sha','certification_tree'].every(k=>sha(review[k]))||!['protected_code_sha256','request_sha256','pin_sha256','intent_sha256','request_raw_sha256','pin_raw_sha256','intent_raw_sha256'].every(k=>hash(review[k])))throw Error('Invalid exact reviewed renewal authority');
}
function verifyHistoricalControllerChecks(checks,head,api){
  if(!Array.isArray(checks)||checks.length!==contract.required_ci_jobs.length)throw Error('Missing exact renewal controller CI');
  const first=checks[0],base=`repos/${bootstrap.repository}/actions/runs/${first.run_id}`;
  if(!positive(first.run_id)||!positive(first.run_attempt))throw Error('Missing exact renewal CI attempt');
  const run=api(`${base}/attempts/${first.run_attempt}`),jobs=api(`${base}/attempts/${first.run_attempt}/jobs?per_page=100`,true).flatMap(page=>page.jobs);
  if(run.id!==first.run_id||run.run_attempt!==first.run_attempt||run.head_sha!==head||run.path!=='.github/workflows/ci.yml'||run.event!=='push'||run.head_branch!=='main'
    ||!sameRepository(run,bootstrap.repository)||run.status!=='completed'||run.conclusion!=='success')throw Error('Historical renewal controller CI failed');
  for(const name of contract.required_ci_jobs){const matches=checks.filter(c=>c.name===name),found=jobs.filter(j=>j.name===name);
    if(matches.length!==1||found.length!==1)throw Error('Missing or duplicate historical renewal CI job');
    const check=matches[0],job=found[0];exact(check,['workflow','run_id','run_attempt','job_id','name','head_sha'],'controller check');
    if(check.workflow!==run.path||check.head_sha!==head||check.run_id!==run.id||check.run_attempt!==run.run_attempt||!positive(check.job_id)||job.id!==check.job_id
      ||job.run_id!==run.id||job.run_attempt!==run.run_attempt||job.head_sha!==head||job.status!=='completed'||job.conclusion!=='success')throw Error('Historical renewal CI job changed');
  }return checks;
}
// The captured UI predates the already-reviewed activation policy commit. This
// metadata is not financial consumer code, but it may differ only by that exact
// immutable original activation authority; A/B/C still hash the complete file.
export function verifyRenewalInitialCapturePolicy({request,certificationSha,originBytes,api=githubApi}){
  const path='contracts/financial_performance_exception_v2.json';
  if(!originBytes||sha256(originBytes)!==request.origin_release.sha256)throw Error('Renewal original activation policy lacks its exact retained anchor');
  const origin=JSON.parse(originBytes);
  if(origin.schema_version!=='financial-release-receipt-v1'||origin.mode!=='activation')throw Error('Renewal policy requires the unchanged original activation');
  let approvedRevision=request.ui.sha,approvedChanges={};
  if(origin.ui.approval?.type==='performance-exception-v2'){
    const verified=verifyPerformanceUiApproval({ui_sha:origin.ui.approved_sha,ui_digest:origin.ui.digest,approval:origin.ui.approval},bootstrap.repository,api);
    verifyExceptionFinancialScope(origin,verified);approvedRevision=origin.ui.approval.controller_sha;
    approvedChanges=verified.approval.controller_changes;
  }
  const expected=readRenewalRemoteBytes(api,path,approvedRevision),actual=readRenewalRemoteBytes(api,path,certificationSha);
  if(!actual.equals(expected))throw Error('Renewal changed the exact original v2 activation policy');
  const registry=validateRenewalRegistry(JSON.parse(readRenewalRemoteBytes(api,renewalPolicyPath,certificationSha)));
  const reviewed=verifyReviewedConsumerTransition({entries:registry.reviewed_consumer_transitions,request,api});
  // The closure captures independently verified immutable approval bytes.
  // No CLI, environment or serialized candidate supplies a replacement map.
  const verified={verifyConsumerCode(captured,current){
    const baseline=consumerCodeInventory(captured),normalized=consumerCodeInventory(current);
    if(digest(baseline)!==request.consumer_code_sha256)throw Error('Renewal captured consumer policy changed');
    for(const path of originalReviewedHarnessPaths){
      const change=approvedChanges[path];if(!change)continue;
      if(!change.before||!change.after||digest(baseline[path]??null)!==digest(change.before)||digest(normalized[path]??null)!==digest(change.after))throw Error('Renewal changed an exact originally reviewed harness pair');
      normalized[path]=change.before;
    }
    for(const [path,change]of Object.entries(reviewed?.changes||{})){
      if(digest(baseline[path]??null)!==digest(change.before)||digest(normalized[path]??null)!==digest(change.after))throw Error('Renewal changed an exact reviewed main135 consumer pair');
      if(change.before===null)delete normalized[path];else normalized[path]=change.before;
    }
    if(digest(normalized)!==request.consumer_code_sha256)throw Error('Renewal controller changed published consumer policy');
    return true;
  }};
  // Also prove the independently retrieved reviewed revision has no additional
  // consumer differences beyond the original harness and finite nine pairs.
  if(reviewed)verified.verifyConsumerCode(reviewed.captured,reviewed.reviewed);
  return verified;
}
export function verifyRenewalAuthority(transition,{api=githubApi,reviewedControllers=policy.reviewed_controllers,now=Date.now(),historical=false,originBytes}={}){
  validateRenewalTransition(transition);const {request,pin,intent,record,publisher}=transition;
  const matches=reviewedControllers.filter(item=>item.controller_sha===transition.controller_sha&&item.certification_sha===pin.head_sha);
  if(matches.length!==1)throw Error('Renewal controller is not independently reviewed');
  const review=matches[0];validateReview(review);
  for(const [key,expected]of [['request',request],['pin',pin],['intent',intent]]){
    if(digest(expected)!==review[`${key}_sha256`])throw Error('Renewal controls are not the exact reviewed authority');
    for(const revision of new Set([transition.controller_sha,publisher.head_sha]))
      if(exactControl(api,policy[`${key}_path`],revision,expected)!==review[`${key}_raw_sha256`])throw Error('Immutable renewal control bytes changed');
  }
  if(exactControl(api,policy.request_path,pin.head_sha,request)!==review.request_raw_sha256)throw Error('Certification request bytes changed');
  const publishedCode=remoteProtectedCodeInventory(request.ui.sha,api);
  if(digest(consumerCodeInventory(publishedCode))!==request.consumer_code_sha256)throw Error('Renewal published consumer policy changed');
  const initialCapture=verifyRenewalInitialCapturePolicy({request,certificationSha:pin.head_sha,originBytes,api});
  const registries=new Map();
  for(const [revision,tree]of [[transition.controller_sha,review.controller_tree],[pin.head_sha,review.certification_tree],[publisher.head_sha,publisher.tree]]){
    const commit=api(`repos/${bootstrap.repository}/git/commits/${revision}`);
    if(commit.sha!==revision||commit.tree?.sha!==tree)throw Error('Reviewed renewal controller tree changed');
    const code=remoteProtectedCodeInventory(revision,api);
    initialCapture.verifyConsumerCode(publishedCode,code);
    if(digest(renewalControllerCodeInventory(code))!==review.protected_code_sha256)throw Error('Renewal protected controller source changed');
    const bytes=readRenewalRemoteBytes(api,renewalPolicyPath,revision),registry=validateRenewalRegistry(JSON.parse(bytes));registries.set(revision,registry);
    if(revision===pin.head_sha&&sha256(bytes)!==record.registry_sha256||revision===publisher.head_sha&&sha256(bytes)!==publisher.registry_sha256)throw Error('Renewal registry bytes changed after seal');
  }
  const publisherRegistry=registries.get(publisher.head_sha);
  if(!publisherRegistry.publication_enabled||publisherRegistry.reviewed_controllers.filter(item=>digest(item)===digest(review)).length!==1)throw Error('Publisher registry lacks the exact reviewed renewal scope');
  if(transition.certification_controller.ci_admission)verifyRenewalCiProof(transition.certification_controller.ci_admission,{api,historical:true,expectedHead:pin.head_sha,expectedTree:transition.certification_controller.tree,expectedChecks:transition.certification_controller.checks,expectedPhase:'certify',expectedCaller:{run_id:record.producer.run_id,run_attempt:record.producer.run_attempt,head_sha:record.producer.head_sha,workflow:record.producer.workflow},now});
  if(publisher.ci_admission)verifyRenewalCiProof(publisher.ci_admission,{api,historical,expectedHead:publisher.head_sha,expectedTree:publisher.tree,expectedChecks:publisher.checks,expectedPhase:'publish',now});
  assertRenewalRegistryAppendOnly(registries.get(pin.head_sha),registries.get(transition.controller_sha));
  assertRenewalRegistryAppendOnly(registries.get(transition.controller_sha),publisherRegistry,{publicationAdmission:publisher.ci_admission??null});
  const publishedTrust=JSON.parse(readRenewalRemoteBytes(api,sourceTrustPath,request.ui.sha));
  const certificateTrust=JSON.parse(readRenewalRemoteBytes(api,sourceTrustPath,pin.head_sha));
  verifySourceTrustAppendOnly(publishedTrust,certificateTrust);
  // The current publisher cannot expand source trust beyond the sealed certifier.
  equal(certificateTrust,JSON.parse(readRenewalRemoteBytes(api,sourceTrustPath,publisher.head_sha)),'sealed source trust');
  const checked=verifyHistoricalControllerChecks(transition.controller_checks,transition.controller_sha,api);
  verifyHistoricalControllerChecks(publisher.checks,publisher.head_sha,api);
  if(transition.certification_controller.tree!==review.certification_tree)throw Error('Renewal sealed certification controller tree changed');
  verifyHistoricalControllerChecks(transition.certification_controller.checks,pin.head_sha,api);
  if(!historical){
    if(api(`repos/${bootstrap.repository}/git/ref/heads/main`).object?.sha!==publisher.head_sha)throw Error('Renewal publisher is not exact current main');
    equal(verifyCorrectionChecks(bootstrap.repository,publisher.head_sha,api),publisher.checks,'current-main publisher CI');
  }
  const base=`repos/${bootstrap.repository}/actions/runs/${pin.run_id}`;
  const run=api(`${base}/attempts/${pin.run_attempt}`),jobs=api(`${base}/attempts/${pin.run_attempt}/jobs?per_page=100`,true).flatMap(page=>page.jobs);
  const found=jobs.filter(job=>job.name===policy.job);
  const producerEvent=transition.certification_controller.ci_admission?'workflow_run':'workflow_dispatch';
  if(run.id!==pin.run_id||run.run_attempt!==pin.run_attempt||run.head_sha!==pin.head_sha||run.path!==policy.workflow||run.event!==producerEvent||run.head_branch!=='main'
    ||!sameRepository(run,bootstrap.repository)||run.status!=='completed'||run.conclusion!=='success'||found.length!==1)throw Error('Renewal certification run is not exact and successful');
  const job=found[0];if(job.id!==pin.job_id||job.run_id!==pin.run_id||job.run_attempt!==pin.run_attempt||job.head_sha!==pin.head_sha||job.status!=='completed'||job.conclusion!=='success'
    ||policy.steps.some(name=>{const steps=job.steps?.filter(step=>step.name===name)||[];return steps.length!==1||steps[0].conclusion!=='success';}))throw Error('Renewal certification job or measuring steps changed');
  if(!(clock(run.run_started_at)<=clock(job.started_at)&&clock(job.started_at)<=clock(record.sealed_at)&&clock(record.sealed_at)<=clock(job.completed_at)&&clock(job.completed_at)<=now))throw Error('Renewal seal outside certification attempt');
  if(!historical){
    if(clock(intent.not_after)<=now)throw Error('Renewal release intent expired');
    assertCurrentRenewalEvaluation(request.target.evaluated_at);
    const refs=api(`${base}/artifacts?per_page=100`,true).flatMap(page=>page.artifacts).filter(item=>item.name===pin.artifact_name);
    if(refs.length!==1)throw Error('Missing or duplicate renewal artifact');const artifact=refs[0];
    if(artifact.id!==pin.artifact_id||artifact.expired!==false||artifact.digest!==`sha256:${pin.artifact_sha256}`||!positive(artifact.size_in_bytes)||artifact.size_in_bytes>releasePolicy.maximum_archive_bytes
      ||artifact.workflow_run?.id!==pin.run_id||artifact.workflow_run?.head_sha!==pin.head_sha||artifact.workflow_run?.head_branch!=='main'
      ||!(clock(record.sealed_at)<=clock(artifact.created_at)&&clock(artifact.created_at)<=clock(job.completed_at))||artifact.expires_at&&clock(artifact.expires_at)<=now)throw Error('Renewal artifact differs from the exact sealed attempt');
  }
  return {review,checks:checked};
}
export function validateSourceRenewalDelta(value){
  exact(value,['schema_version','status','evaluated_at','previous','current','preserved','new_receipt_count','new_receipts','new_receipts_sha256','journal_sha256','renewed_current_receipts','unchanged_current_receipts'],'source delta');
  for(const key of ['previous','current']){exact(value[key],['archive_manifest_sha256','projection_sha256','receipt_inventory_sha256'],`${key} source`);if(!Object.values(value[key]).every(hash))throw Error('Invalid source delta hash');}
  exact(value.preserved,['objects','receipts','attempts'],'preserved source counts');
  if(value.schema_version!=='financial-statement-source-renewal-v1'||value.status!=='verified'||!Object.values(value.preserved).every(v=>Number.isSafeInteger(v)&&v>=0)
    ||!positive(value.new_receipt_count)||value.new_receipt_count>policy.maximum_new_receipts||!Array.isArray(value.new_receipts)||value.new_receipts.length!==value.new_receipt_count
    ||digest(value.new_receipts)!==value.new_receipts_sha256)throw Error('Invalid acquired source delta');
  const evaluated=clock(value.evaluated_at),ids=new Set(),captures=new Set();
  for(const receipt of value.new_receipts){
    exact(receipt,['symbol','attribute','previous_receipt_sha256','receipt_sha256','capture_id','observed_at','attempt_id','attempt_completed_at','attempt_journal_sha256','plan_sha256','getter_completed_at','transport_payload_sha256','transport_evidence_sha256'],'new acquisition');
    if(typeof receipt.symbol!=='string'||!receipt.symbol||!['income_stmt','quarterly_income_stmt'].includes(receipt.attribute)||!(receipt.previous_receipt_sha256===null||hash(receipt.previous_receipt_sha256))
      ||receipt.previous_receipt_sha256===receipt.receipt_sha256||!['receipt_sha256','attempt_journal_sha256','plan_sha256','transport_payload_sha256','transport_evidence_sha256'].every(k=>hash(receipt[k]))
      ||typeof receipt.capture_id!=='string'||!receipt.capture_id||typeof receipt.attempt_id!=='string'||!receipt.attempt_id||ids.has(receipt.receipt_sha256)||captures.has(receipt.capture_id)
      ||!(clock(receipt.observed_at)<=clock(receipt.getter_completed_at)&&clock(receipt.getter_completed_at)<=clock(receipt.attempt_completed_at)&&clock(receipt.attempt_completed_at)<=evaluated))throw Error('Invalid original acquisition clocks or identity');
    ids.add(receipt.receipt_sha256);captures.add(receipt.capture_id);
  }
  for(const key of ['journal_sha256','renewed_current_receipts','unchanged_current_receipts'])if(!Array.isArray(value[key])||value[key].length>(key==='unchanged_current_receipts'?policy.maximum_current_receipts:policy.maximum_new_receipts)||value[key].some(v=>!hash(v))||new Set(value[key]).size!==value[key].length)throw Error('Invalid bounded source delta inventory');
  equal(value.journal_sha256,[...new Set(value.new_receipts.map(r=>r.attempt_journal_sha256))].sort(),'retained acquisition journal inventory');
  if(!value.renewed_current_receipts.length||value.renewed_current_receipts.some(r=>!ids.has(r)||value.unchanged_current_receipts.includes(r))||value.previous.receipt_inventory_sha256===value.current.receipt_inventory_sha256)throw Error('Renewal requires newly acquired current receipts');
  clock(value.evaluated_at);return value;
}
export function validateRenewalTransition(value){
  exact(value,['schema_version','controller_sha','controller_checks','certification_controller','publisher','request','pin','intent','record','record_json','previous_lineage_sha256','next_lineage','next_lineage_sha256','history_inventory','source_delta'],'transition');
  parseRenewalRequest(value.request);parseRenewalPin(value.pin);parseRenewalIntent(value.intent);validateRenewalCandidate(value.record);validateHistoryInventory(value.history_inventory);validateSourceRenewalDelta(value.source_delta);assertPostcaptureRequestDelta(value.source_delta,value.request.financial_request);
  if(Buffer.byteLength(JSON.stringify(value))>policy.maximum_proof_bytes)throw Error('Renewal transition exceeds bounded proof size');
  const {request,pin,intent,record,publisher,certification_controller:certifier}=value;
  exact(certifier,['head_sha','tree','checks',...(Object.hasOwn(certifier,'ci_admission')?['ci_admission']:[])],'certification controller');
  if(Object.hasOwn(certifier,'ci_admission')){
    validateRenewalCiProof(certifier.ci_admission);
    if(certifier.ci_admission.phase!=='certify'||certifier.ci_admission.executing.head_sha!==certifier.head_sha||certifier.ci_admission.executing.tree!==certifier.tree||digest(certifier.ci_admission.checks)!==digest(certifier.checks))throw Error('Renewal certification CI admission binding changed');
  }
  if(certifier.head_sha!==pin.head_sha||!sha(certifier.tree)||digest(certifier)!==record.certification_controller_sha256||!Array.isArray(certifier.checks)||certifier.checks.length!==contract.required_ci_jobs.length)throw Error('Invalid sealed certification-controller CI');
  exact(publisher,['head_sha','tree','checks','registry_sha256',...(Object.hasOwn(publisher,'ci_admission')?['ci_admission']:[])],'publisher');
  if(Object.hasOwn(publisher,'ci_admission')){
    validateRenewalCiProof(publisher.ci_admission);
    if(publisher.ci_admission.phase!=='publish'||publisher.ci_admission.executing.head_sha!==publisher.head_sha||publisher.ci_admission.executing.tree!==publisher.tree||publisher.ci_admission.registry_sha256!==publisher.registry_sha256||digest(publisher.ci_admission.checks)!==digest(publisher.checks))throw Error('Renewal publisher CI admission binding changed');
  }
  if(!sha(publisher.head_sha)||!sha(publisher.tree)||!hash(publisher.registry_sha256)||!Array.isArray(publisher.checks)||publisher.checks.length!==contract.required_ci_jobs.length)throw Error('Invalid exact current-main renewal publisher');
  if(value.schema_version!=='financial-source-renewal-transition-v1'||!sha(value.controller_sha)||typeof value.record_json!=='string'||Buffer.byteLength(value.record_json)>policy.maximum_control_bytes||!Array.isArray(value.controller_checks)||value.controller_checks.length!==contract.required_ci_jobs.length
    ||value.previous_lineage_sha256!==request.previous_lineage_sha256||!hash(value.next_lineage_sha256)||digest(value.next_lineage)!==value.next_lineage_sha256||value.next_lineage_sha256===value.previous_lineage_sha256
    ||pin.request_sha256!==digest(request)||intent.request_sha256!==digest(request)||intent.pin_sha256!==digest(pin)||intent.previous_publication_identity!==request.previous_publication_identity
    ||record.renewal_request_sha256!==digest(request)||record.request_sha256!==digest(request.financial_request)||pin.candidate_record_sha256!==sha256(value.record_json)||digest(JSON.parse(value.record_json))!==digest(record)
    ||record.producer.head_sha!==pin.head_sha||record.producer.run_id!==pin.run_id||record.producer.run_attempt!==pin.run_attempt||record.captured_ui.sha!==request.ui.sha||record.captured_ui.digest!==request.ui.digest
    ||record.source_base_sha256!==request.target.base_sha256||record.source_projection_sha256!==value.next_lineage.source_projection_sha256||record.receipt_inventory_sha256!==value.next_lineage.receipt_inventory_sha256
    ||record.history_inventory_sha256!==inventoryDigest(value.history_inventory)||record.source_delta_sha256!==digest(value.source_delta)
    ||value.source_delta.evaluated_at!==request.target.evaluated_at||record.financial_generation===request.previous_financial_generation||clock(value.source_delta.evaluated_at)>clock(record.sealed_at)||clock(record.sealed_at)>=clock(intent.not_after))throw Error('Renewal transition binding changed');
  equal(value.next_lineage.source,request.financial_request.correction.source,'new source');equal(value.next_lineage.certificate,request.financial_request.source_validation.certificate,'new certificate');
  if(value.history_inventory[request.previous_release.path]!==request.previous_release.sha256||value.history_inventory[request.origin_release.path]!==request.origin_release.sha256)throw Error('Renewal history omits predecessor or origin');
  // The independent archive verifier supplies the proof, never a rewritten
  // generation wrapper. Its report and full projection are sealed together.
  if(!value.source_delta||value.source_delta.schema_version!=='financial-statement-source-renewal-v1'||!positive(value.source_delta.new_receipt_count)
    ||value.source_delta.new_receipt_count>request.maximum_new_receipts)throw Error('Renewal requires a bounded newly acquired receipt delta');
  if(value.source_delta.current?.archive_manifest_sha256!==request.financial_request.correction.source.archive_manifest_sha256
    ||value.source_delta.current?.projection_sha256!==record.source_projection_sha256||value.source_delta.current?.receipt_inventory_sha256!==record.receipt_inventory_sha256
    ||value.source_delta.new_receipt_count!==value.source_delta.new_receipts?.length||!value.source_delta.renewed_current_receipts?.length)throw Error('Renewal delta does not bind the new source projection');
  return value;
}
export function renewalReference(bytes){const sum=sha256(bytes);return {schema_version:'financial-source-renewal-transition-v1',path:`static-data/financial-corrections/renewal-${sum}.json`,sha256:sum};}
function checkedAsset(readAsset,ref){const bytes=readAsset(ref.path);if(sha256(bytes)!==ref.sha256)throw Error('Retained renewal asset changed');return JSON.parse(bytes);}
export function inspectRenewalChain(financial,readAsset,{assetHash=path=>sha256(readAsset(path))}={}){
  validateRenewalChain(financial.renewal);
  const origin=checkedAsset(readAsset,financial.renewal.origin);
  if(origin.schema_version!=='financial-release-receipt-v1'||origin.mode!=='activation'||origin.renewal)throw Error('Renewal origin must be the unchanged initial activation');
  let priorLineage=origin.lineage_sha256;const transitions=[];
  for(const reference of financial.renewal.transitions){
    const transition=validateRenewalTransition(checkedAsset(readAsset,reference));
    equal(transition.request.origin_release,financial.renewal.origin,'chain origin');
    if(transition.previous_lineage_sha256!==priorLineage)throw Error('Renewal chain dropped or replaced its prior lineage');
    const previous=checkedAsset(readAsset,transition.request.previous_release);
    if(transition.source_delta.previous?.archive_manifest_sha256!==previous.lineage.source.archive_manifest_sha256||transition.source_delta.previous?.projection_sha256!==previous.source_projection.sha256||transition.source_delta.previous?.receipt_inventory_sha256!==previous.lineage.receipt_inventory_sha256)throw Error('Renewal delta prior source changed');
    if(previous.lineage_sha256!==priorLineage||previous.financial_generation!==transition.request.previous_financial_generation)throw Error('Renewal chain predecessor generation changed');
    equal(previous.lineage.policy,transition.next_lineage.policy,'unchanged projector policy');
    if(transitions.length){
      equal(previous.renewal,{...financial.renewal,transitions:financial.renewal.transitions.slice(0,transitions.length)},'previous authority chain');
    }else if(previous.renewal)throw Error('Renewal chain origin was reset');
    for(const [path,sum]of Object.entries(transition.history_inventory))if(assetHash(path)!==sum)throw Error('Renewal preserved audit history changed');
    if(transitions.length)assertRetainedFinancialHistory(transitions.at(-1).history_inventory,transition.history_inventory);
    priorLineage=transition.next_lineage_sha256;transitions.push(transition);
  }
  const last=transitions.at(-1);equal(financial.lineage,last.next_lineage,'active renewed lineage');
  if(financial.lineage_sha256!==priorLineage||financial.source_projection.sha256!==last.record.source_projection_sha256||financial.source_base.sha256!==last.record.source_base_sha256)throw Error('Renewed source assets changed');
  if(financial.mode==='renewal'){
    if(financial.ui.approved_sha!==last.request.ui.sha||financial.ui.digest!==last.request.ui.digest||digest(financial.ui.approval)!==last.request.ui.approval_sha256)throw Error('Renewal receipt changed sealed UI');
    equal(financial.price_input,last.request.price_input,'sealed renewal price input');
    if(financial.evaluated_at!==last.source_delta.evaluated_at)throw Error('Renewal receipt evaluation changed after sealing');
    equal(financial.ui,checkedAsset(readAsset,last.request.previous_release).ui,'unchanged renewal UI checks');
  }
  if(financial.mode==='renewal'&&(financial.previous_publication_identity!==last.request.previous_publication_identity||financial.financial_generation!==last.record.financial_generation))throw Error('Renewal receipt was rebound');
  return {origin,transitions};
}
async function verifyRenewalChainAuthority(financial,{readAsset,api=githubApi,verifiedApproval,reviewedControllers=policy.reviewed_controllers,now=Date.now()}={},prepared=null){
  if(!financial.renewal){if(verifiedApproval)verifyExceptionFinancialScope(financial,verifiedApproval);return {origin:financial,transitions:[]};}
  const cache=new Map(),hashes=new Map(),refs=[financial.renewal.origin,...financial.renewal.transitions];
  for(const ref of refs){const bytes=await readAsset(ref.path);if(sha256(bytes)!==ref.sha256)throw Error('Published renewal asset hash changed');cache.set(ref.path,bytes);hashes.set(ref.path,ref.sha256);}
  for(const ref of financial.renewal.transitions){const value=validateRenewalTransition(JSON.parse(cache.get(ref.path)));
    for(const [path,sum]of Object.entries(value.history_inventory))if(!hashes.has(path)){const bytes=await readAsset(path);if(sha256(bytes)!==sum)throw Error('Renewal preserved audit history changed');hashes.set(path,sum);if(/\/release-[a-f0-9]{64}\.json$/.test(path))cache.set(path,bytes);}
  }
  const result=inspectRenewalChain(financial,path=>{if(!cache.has(path))throw Error('Missing retained chain asset');return cache.get(path);},{assetHash:path=>hashes.get(path)});
  const {validateFinancialReleaseReceipt}=await import('./financial-release-activation.mjs');validateFinancialReleaseReceipt(result.origin);
  if(isPerformanceException(result.origin.ui.approval)){
    const originalApproval=verifiedApproval||verifyPerformanceUiApproval({ui_sha:result.origin.ui.approved_sha,ui_digest:result.origin.ui.digest,approval:result.origin.ui.approval},bootstrap.repository,api);
    verifyExceptionFinancialScope(result.origin,originalApproval); // Original check stays unchanged, even after an ordinary new-UI carry.
  }else if(verifiedApproval)throw Error('Exception renewal lost its original exception authority');
  if(isPerformanceException(financial.ui.approval))equal(financial.ui.approval,result.origin.ui.approval,'immutable exception approval');
  if(prepared)equal(result.transitions.at(-1),prepared,'exact currently prepared automatic transition');
  for(const transition of result.transitions)verifyRenewalAuthority(transition,{api,reviewedControllers,historical:!(prepared&&transition===result.transitions.at(-1)),now,originBytes:cache.get(financial.renewal.origin.path)});
  return result;
}
export async function verifyPublishedRenewal(financial,options={}){
  // Live and historical readers can never opt into an unfinished publication.
  return verifyRenewalChainAuthority(financial,options);
}
export async function verifyPreparedAutomaticRenewal(financial,transition,options={}){
  validateRenewalTransition(transition);const proof=transition.publisher.ci_admission;
  if(financial.mode!=='renewal'||!proof||process.env.GITHUB_EVENT_NAME!=='workflow_run'
    ||String(proof.caller.run_id)!==process.env.GITHUB_RUN_ID||String(proof.caller.run_attempt)!==process.env.GITHUB_RUN_ATTEMPT
    ||proof.executing.head_sha!==process.env.GITHUB_SHA||proof.caller.workflow_sha!==process.env.GITHUB_WORKFLOW_SHA)throw Error('Prepared automatic renewal requires its exact active producer');
  return verifyRenewalChainAuthority(financial,options,transition);
}
export async function writeRenewalRelease({dist,live,transition,sourceProjectionBytes,sourceBaseBytes,priceInput}){
  validateRenewalTransition(transition);verifyRenewalPredecessor(transition.request,live);equal(priceInput,transition.request.price_input,'sealed renewal price input');
  if(JSON.parse(sourceProjectionBytes).financial_evaluated_at!==transition.source_delta.evaluated_at)throw Error('Renewal source evaluation changed after sealing');
  if(inventoryDigest(dataInventory(dist))!==transition.record.logical_data_inventory_sha256)throw Error('Renewal logical candidate changed after sealing');
  const current=financialAuditInventory(dist);assertRetainedFinancialHistory(transition.history_inventory,current);
  if(inventoryDigest(transition.history_inventory)!==transition.record.history_inventory_sha256||sha256(sourceProjectionBytes)!==transition.record.source_projection_sha256||sha256(sourceBaseBytes)!==transition.record.source_base_sha256)throw Error('Renewal writer inputs changed after sealing');
  const bytes=JSON.stringify(transition),reference=renewalReference(bytes),path=join(dist,reference.path);
  if(existsSync(path)&&sha256(readFileSync(path))!==reference.sha256)throw Error('Renewal transition audit was replaced');
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);
  const renewal=validateRenewalChain({schema_version:'financial-source-renewal-chain-v1',origin:transition.request.origin_release,transitions:[...(live.financialRelease.renewal?.transitions||[]),reference]});
  const {writeFinancialReleaseReceipt}=await import('./financial-release-activation.mjs');
  const result=writeFinancialReleaseReceipt({dist,mode:'renewal',previousIdentity:live.identity,lineage:{value:transition.next_lineage,id:transition.next_lineage_sha256},
    sourceProjectionBytes,sourceBaseBytes,evaluationBytes:sourceProjectionBytes,generation:transition.record.financial_generation,evaluatedAt:JSON.parse(sourceProjectionBytes).financial_evaluated_at,
    ui:live.financialRelease.ui,priceInput,renewal});
  inspectRenewalChain(result.receipt,path=>readFileSync(join(dist,path)));
  return {...result,added:[reference.path,...result.added]};
}
export function assertRenewalCarryContinuity(previous,next){
  if(previous.renewal){if(!next.renewal)throw Error('Missing carried renewal authority');equal(next.renewal,previous.renewal,'carried renewal authority');}else if(next.renewal)throw Error('Carry cannot invent renewal authority');
}
export function assertRenewalCapacity(root){
  if(!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink())throw Error('Linked renewal payload root');
  let bytes=0,files=0;
  const walk=path=>{for(const item of readdirSync(path,{withFileTypes:true})){const file=join(path,item.name);if(!safePath(item.name))throw Error('Unsafe renewal payload path');
    if(item.isDirectory())walk(file);else if(item.isFile()){const info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw Error('Linked renewal payload');bytes+=info.size;files++;}else throw Error('Linked renewal payload');
    if(bytes>releasePolicy.maximum_archive_bytes||files>releasePolicy.maximum_archive_files)throw Error('Renewal payload exceeds existing archive capacity');
  }};walk(root);return {bytes,files};
}
// Independent offline replay. Required archives are already retained; no missing
// source or predecessor may trigger a download fallback during a recheck.
export async function verifyPreparedRenewal({candidate,request,record,live,root,previousSourceRoot,api=githubApi}){
  const {verifyCandidatePayload,completeInventory,protectedCodeInventory}=await import('./financial-release-activation.mjs');
  parseRenewalFinancialRequest(request.financial_request);validateRenewalCandidate(record);verifyRenewalPredecessor(request,live);assertCurrentRenewalEvaluation(request.target.evaluated_at);assertRenewalCapacity(candidate);
  for(const path of ['original-source/source.zip','original-certification/artifact.zip','original-predecessor/artifact.zip','original-previous-source/source.zip','original-previous-certification/artifact.zip']){const file=join(candidate,path);if(!existsSync(file)||!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink())throw Error('Offline renewal replay requires all retained original archives');}
  if(!existsSync(join(candidate,'predecessor'))||!lstatSync(join(candidate,'predecessor')).isDirectory()||lstatSync(join(candidate,'predecessor')).isSymbolicLink())throw Error('Offline renewal replay requires the complete retained predecessor');
  equal(read(join(candidate,'renewal-request.json')),request,'saved renewal request');
  if(read(join(candidate,'preview-receipt.json')).financial?.evaluated_at!==request.target.evaluated_at||read(join(candidate,'source-delta.json')).evaluated_at!==request.target.evaluated_at)throw Error('Renewal saved evaluation differs from selected target');
  if(record.renewal_request_sha256!==digest(request)||record.source_base_sha256!==request.target.base_sha256||sha256(readFileSync(join(candidate,'target-base.json')))!==request.target.base_sha256)throw Error('Renewal target/request changed');
  if(sha256(readFileSync(join(candidate,'certification-registry.json')))!==record.registry_sha256||digest(read(join(candidate,'certification-controller.json')))!==record.certification_controller_sha256)throw Error('Renewal sealed certification authority changed');
  const {restorePriorRenewalSource}=await import('./financial-source-renewal-certification.mjs');
  const authenticatedPrevious=restorePriorRenewalSource({candidate,live});
  if(sha256(readFileSync(join(candidate,'original-previous-certification/artifact.zip')))!==live.financialRelease.lineage.certificate.artifact_sha256)throw Error('Renewal retained previous certificate ZIP changed');
  if(previousSourceRoot&&resolve(previousSourceRoot)!==resolve(authenticatedPrevious))throw Error('Renewal previous source path is not its authenticated retained archive');
  previousSourceRoot=authenticatedPrevious;
  if(digest(consumerCodeInventory(protectedCodeInventory(root,record.captured_ui.sha)))!==request.consumer_code_sha256)throw Error('Renewal captured consumer policy changed');
  const predecessor=read(join(candidate,'evidence.json')).predecessor_artifact;
  if(predecessor.id!==request.price_input.artifact_id||predecessor.digest!==`sha256:${request.price_input.artifact_sha256}`)throw Error('Renewal predecessor price artifact changed');
  if(inventoryDigest(uiInventory(join(candidate,'corrected')))!==live.uiDigest)throw Error('Renewal candidate changed published UI');
  const payloadState={candidate,request:request.financial_request,record};
  const result=await verifyCandidatePayload(payloadState,live,root,api,{offline:true,renewalSource:true,inspectVerifiedBundles:async ({corrected,predecessor,projection,receipt,projectionPath})=>{
    if(receipt.financial.evaluated_at!==request.target.evaluated_at)throw Error('Renewal preview evaluation differs from selected target');
    await verifyRenewalEvaluationCurrent({request,projection,frontendRoot:join(root,'frontend')});
    // Financial audit JSON can have a separate physical encoding. Consume only
    // the independently decoded and verified logical predecessor/candidate.
    const initialCapture=verifyRenewalInitialCapturePolicy({request,certificationSha:record.producer.head_sha,originBytes:readFileSync(join(predecessor,request.origin_release.path)),api});
    const currentSha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
    initialCapture.verifyConsumerCode(protectedCodeInventory(root,record.captured_ui.sha),protectedCodeInventory(root,currentSha));
    const history=financialAuditInventory(predecessor);
    assertRetainedFinancialHistory(history,financialAuditInventory(corrected));
    equal(read(join(candidate,'history-inventory.json')),history,'saved history inventory');
    if(record.history_inventory_sha256!==inventoryDigest(history))throw Error('Renewal retained history seal changed');
    if(!(clock(projection.financial_evaluated_at)<=clock(record.sealed_at)&&clock(record.sealed_at)<=Date.now()))throw Error('Renewal evaluation or seal is in the future');
    const report=JSON.parse(execFileSync(process.env.FINANCIAL_REPLAY_PYTHON||'python3',[join(root,'backend/app/scripts/verify_statement_source_renewal.py'),
      '--previous-archive',previousSourceRoot,'--archive',join(candidate,'original-source/files'),
      '--previous-projection',join(predecessor,live.financialRelease.source_projection.path),'--projection',projectionPath,
      '--evaluated-at',projection.financial_evaluated_at],{encoding:'utf8',maxBuffer:policy.maximum_proof_bytes,env:{...process.env,PYTHONPATH:join(root,'backend'),LITELLM_LOCAL_MODEL_COST_MAP:'true'}}));
    validateSourceRenewalDelta(report);
    if(report.evaluated_at!==request.target.evaluated_at)throw Error('Renewal source delta evaluation differs from selected target');
    assertPostcaptureRenewalDelta(report,read(join(candidate,'preview-receipt.json')).source_validation.certificate);
    equal(read(join(candidate,'source-delta.json')),report,'saved source delta');
    if(report.previous.archive_manifest_sha256!==live.financialRelease.lineage.source.archive_manifest_sha256||report.previous.projection_sha256!==live.financialRelease.source_projection.sha256||report.previous.receipt_inventory_sha256!==live.financialRelease.lineage.receipt_inventory_sha256)throw Error('Renewal prior source identity changed');
    if(digest(report)!==record.source_delta_sha256||report.new_receipt_count>request.maximum_new_receipts)throw Error('Renewal acquired receipt proof changed');
    return {history,sourceDelta:report};
  }});
  if(record.logical_data_inventory_sha256!==result.receipt.bundles.corrected_data_sha256||record.source_projection_sha256!==result.receipt.financial.projection_sha256||record.receipt_inventory_sha256!==result.projection.receipt_inventory_sha256||record.financial_generation!==result.projection.financial_generation)throw Error('Renewal replayed projection changed');
  assertRenewalCapacity(candidate);
  execFileSync('python3',[fileURLToPath(new URL('./check-pages-payload.py',import.meta.url)),join(candidate,'corrected')],{stdio:'pipe'});
  if(inventoryDigest(completeInventory(join(candidate,'corrected')))!==record.corrected_inventory_sha256)throw Error('Renewal physical inventory changed');
  await verifyRenewalEvaluationCurrent({request,projection:result.projection,frontendRoot:join(root,'frontend')});
  const {additional,...payload}=result;return {...payload,projectionPath:payloadState.projectionPath,...additional};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  // Production entrypoint remains closed even if an environment variable or
  // copied request claims an enabled integration.
  console.error('Source renewal publication is disabled; local proof preparation only.');process.exitCode=1;
}
