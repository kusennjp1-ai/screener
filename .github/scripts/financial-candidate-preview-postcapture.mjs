// Separate exact-artifact source route. Existing v1/v2 parsers stay strict.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonical,digest,parseCorrectionIntent,verifyCorrectionSource} from './financial-correction.mjs';
import {sha256} from './publication-state.mjs';
import {CERTIFIED_PREVIEW_SCHEMA,parseCertifiedPreviewSelection,parseNativeDestinationSelection,validateNativeDestination} from './financial-candidate-preview-v2.mjs';
import {isPostcaptureReference,parsePostcaptureReference,verifyPostcaptureCorrectionSource} from './verify-postcapture-correction-source.mjs';
import request from '../../contracts/financial_source_postcapture_request_v1.json' with {type:'json'};

export const POSTCAPTURE_PREVIEW_SCHEMA='financial-candidate-preview-postcapture-v1';
export const POSTCAPTURE_SOURCE_GUARD='postcapture_source_artifact_v1';
export const POSTCAPTURE_RENEWAL_REQUEST='financial-renewal-postcapture-request-v1';
const exact=(value,keys,label)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))throw Error(`Invalid closed postcapture ${label}`);};
const equal=(a,b,label)=>{if(canonical(a)!==canonical(b))throw Error(`Postcapture ${label} mismatch`);};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const isCertifiedPreviewSchema=value=>[CERTIFIED_PREVIEW_SCHEMA,POSTCAPTURE_PREVIEW_SCHEMA].includes(value);
export const previewSchemaForRequest=value=>value.schema_version===POSTCAPTURE_RENEWAL_REQUEST?POSTCAPTURE_PREVIEW_SCHEMA:CERTIFIED_PREVIEW_SCHEMA;
export function parsePostcapturePreviewSelection(sourceValidation,destination){
  exact(sourceValidation,['guard','certificate'],'source selection');
  if(sourceValidation.guard!==POSTCAPTURE_SOURCE_GUARD)throw Error('Unlisted postcapture source guard');
  parsePostcaptureReference(sourceValidation.certificate);parseNativeDestinationSelection(destination);
}
export function parseRenewalFinancialRequest(value){
  exact(value,['schema_version','correction','source_validation','destination_projection'],'renewal financial request');
  parseCorrectionIntent(JSON.stringify(value.correction));
  if(value.schema_version===POSTCAPTURE_RENEWAL_REQUEST){
    parsePostcapturePreviewSelection(value.source_validation,value.destination_projection);
    equal(value.correction.source,request.source,'finite original producer source');
  }else if(value.schema_version==='financial-release-request-v1')parseCertifiedPreviewSelection(value.source_validation,value.destination_projection);
  else throw Error('Unknown renewal financial request');
  return value;
}
export function verifyRenewalCorrectionSource(source,certification,api){
  return isPostcaptureReference(certification?.reference)
    ?verifyPostcaptureCorrectionSource(source,certification,api)
    :verifyCorrectionSource(source,api,certification);
}
export function verifyRecordedPostcaptureSource(source,producer,certifier,reference,certificateZipPath){
  exact(producer,['run','jobs','artifacts'],'recorded producer');exact(certifier,['run','jobs','artifacts','commit','tree'],'recorded validator');
  const api=(endpoint,pages=false)=>{
    if(pages)throw Error('Unexpected paginated postcapture preview lookup');
    for(const [ref,recorded]of [[source,producer],[reference,certifier]]){
      const base=`repos/${ref.repository}/actions/runs/${ref.run_id}`;
      if(endpoint===`${base}/attempts/${ref.run_attempt}`)return recorded.run;
      if(endpoint===`${base}/attempts/${ref.run_attempt}/jobs?per_page=100`)return {total_count:recorded.jobs.length,jobs:recorded.jobs};
      if(endpoint===`${base}/artifacts?per_page=100`)return {total_count:recorded.artifacts.length,artifacts:recorded.artifacts};
    }
    if(endpoint===`repos/${reference.repository}/git/commits/${reference.head_sha}`)return certifier.commit;
    if(endpoint===`repos/${reference.repository}/git/trees/${certifier.commit.tree?.sha}?recursive=1`)return certifier.tree;
    throw Error('Postcapture preview attempted an unrecorded remote lookup');
  };
  return verifyPostcaptureCorrectionSource(source,{reference,certificateZipPath},api);
}
export function postcaptureSourceDescriptor(certification,sourceOutcome){
  return {guard:POSTCAPTURE_SOURCE_GUARD,certificate:certification,verification_sha256:digest(certification),source_outcome_sha256:digest(sourceOutcome)};
}
export function verifyPostcapturePreviewCycle(source,files,certification){
  const bytes=readFileSync(join(files,'cycle.json')),cycle=JSON.parse(bytes),summaryBytes=readFileSync(join(files,'batch/summary.json')),summary=JSON.parse(summaryBytes);
  equal(source,request.source,'cycle source');
  const r=certification.receipt;
  if(!isPostcaptureReference(certification.reference)||digest(r)!==certification.reference.receipt_sha256
    ||sha256(bytes)!==request.failure_boundary.cycle_sha256||sha256(summaryBytes)!==request.failure_boundary.batch_summary_sha256
    ||cycle.schema_version!=='financial-recovery-cycle-v1'||cycle.phase!=='completed'||cycle.exit_code!==0||summary.exit_code!==0
    ||cycle.dry_run!==false||cycle.published!==false||cycle.code_revision!==source.head_sha
    ||cycle.archive_manifest_sha256!==source.archive_manifest_sha256||cycle.base_artifact_sha256!==source.acquisition_base_sha256
    ||summary.base_artifact_sha256!==source.acquisition_base_sha256||summary.capture_completion_is_source_availability!==false
    ||r.producer_execution.producer_run_conclusion!=='failure'||r.producer_execution.producer_job_conclusion!=='failure'
    ||r.producer_execution.producer_cycle_exit_code!==0||r.producer_execution.producer_batch_exit_code!==0)throw Error('Postcapture cycle changed original execution outcomes');
  return {sha256:sha256(bytes),phase:cycle.phase,exit_code:cycle.exit_code,archive_manifest_sha256:cycle.archive_manifest_sha256,
    base_artifact_sha256:cycle.base_artifact_sha256,code_revision:cycle.code_revision,provider_state_before:cycle.provider_state_before,
    published:cycle.published,retained_receipts:cycle.retained_receipts,retained_symbols:cycle.retained_symbols};
}
export function validatePostcapturePreviewReceipt(value){
  if(value.schema_version!==POSTCAPTURE_PREVIEW_SCHEMA)throw Error('Postcapture receipt cannot enter an older preview schema');
  const selection=value.source_validation;
  exact(selection,['guard','certificate','verification_sha256','source_outcome_sha256'],'verified source selection');
  if(selection.guard!==POSTCAPTURE_SOURCE_GUARD||selection.verification_sha256!==digest(selection.certificate)
    ||selection.source_outcome_sha256!==digest(value.source_outcome))throw Error('Postcapture descriptor changed');
  const c=selection.certificate,r=c.receipt,outcome=value.source_outcome;
  exact(c,['reference','authority','publication_authority','reviewed_source_request','certifier_job','receipt','bindings'],'verified source');
  parsePostcaptureReference(c.reference);
  exact(c.reviewed_source_request,['tree_sha','request_sha256','request_canonical_sha256','request_git_blob_sha'],'reviewed source request');
  if(c.reviewed_source_request.request_canonical_sha256!==digest(request)||r.validation.request_canonical_sha256!==digest(request))throw Error('Postcapture reviewed request changed');
  if(c.authority!=='postcapture_artifact_validation_only'||c.publication_authority!=='none'||digest(r)!==c.reference.receipt_sha256
    ||r.schema_version!=='financial-source-postcapture-validation-v1'||r.kind!=='captured_source_integrity_validation'||r.result!=='validated_retained_artifact')throw Error('Postcapture descriptor lost exact companion receipt');
  equal(r.source,request.source,'closed companion source');equal(value.source,r.source,'preview source');
  equal(r.authority,{publication:false,qualification:false,provider_work:false,source_admission:false,github_job_success:false},'false companion authorities');
  equal(c.bindings,{acquisition_base_sha256:r.source.acquisition_base_sha256,archive_manifest_sha256:r.source.archive_manifest_sha256,cohort_sha256:r.source.cohort_sha256,
    cycle_sha256:request.failure_boundary.cycle_sha256,batch_summary_sha256:request.failure_boundary.batch_summary_sha256,request_sha256:r.validation.request_sha256},'original byte bindings');
  if(r.validation.code_sha!==c.reference.head_sha||r.validation.tree_sha!==c.reviewed_source_request.tree_sha
    ||r.validation.request_sha256!==c.reviewed_source_request.request_sha256||r.published!==false
    ||r.frozen_v1_certification?.result!=='rejected'||r.frozen_v1_certification?.reason!=='Producer conclusion must retain actual cycle failure')throw Error('Postcapture review or preserved v1 rejection changed');
  exact(c.certifier_job,['id','run_id','run_attempt','name','conclusion'],'validator job');
  if(c.certifier_job.id!==c.reference.job_id||c.certifier_job.run_id!==c.reference.run_id||c.certifier_job.run_attempt!==c.reference.run_attempt
    ||c.certifier_job.name!=='validate-captured-source'||c.certifier_job.conclusion!=='success')throw Error('Postcapture requires its independently successful validator');
  const e=r.producer_execution;
  if(e.producer_run_conclusion!=='failure'||e.producer_job_conclusion!=='failure'||e.producer_cycle_exit_code!==0||e.producer_batch_exit_code!==0
    ||e.producer_job_id!==request.producer_job_id||e.original_final_guard_result!=='failed'||e.original_outcomes_retained!==true
    ||outcome.policy!==POSTCAPTURE_SOURCE_GUARD||outcome.run.conclusion!=='failure'||outcome.job.conclusion!=='failure'||outcome.job.id!==e.producer_job_id
    ||outcome.reported_cycle?.exit_code!==0||outcome.reported_batch?.exit_code!==0||outcome.reported_cycle.sha256!==c.bindings.cycle_sha256
    ||outcome.reported_batch.sha256!==c.bindings.batch_summary_sha256||outcome.reported_cycle.phase!=='completed'||outcome.reported_cycle.published!==false)throw Error('Postcapture preview relabeled original failure');
  equal(r.refresh, {...request.refresh,new_receipt_inventory_path:'fresh-receipts.json'}, 'exact fresh receipt scope');
  if(r.diagnosis.failed_runtime_inode_captured!==false||r.diagnosis.failed_runtime_inventory_complete_attested!==false||r.diagnosis.original_final_guard_pass_attested!==false)throw Error('Postcapture preview fabricated runtime evidence');
  const p=r.projection;
  if(p.schema_version!=='financial-source-certified-projection-v1'||!hash(p.sha256)||p.point_in_time!==false||p.qualification_authority!==false
    ||p.source_publication_date!==null||p.knowledge_basis!=='current_observation_at_source_capture')throw Error('Postcapture cannot grant destination authority');
  validateNativeDestination(value.destination_projection,value.financial.receipt_inventory_sha256,value.financial.projection_sha256);
  return value;
}
export function assertPostcaptureRenewalDelta(delta,certification){
  if(!isPostcaptureReference(certification?.reference))return;
  const r=certification.receipt,ids=delta.new_receipts.map(item=>item.receipt_sha256).sort();
  if(delta.previous.archive_manifest_sha256!==r.original_retention.baseline.manifest_sha256||delta.current.archive_manifest_sha256!==r.source.archive_manifest_sha256
    ||delta.new_receipt_count!==r.refresh.new_receipts||digest(ids)!==r.refresh.new_receipt_ids_sha256)throw Error('Renewal delta differs from exact companion receipt scope');
}
export function assertPostcaptureRequestDelta(delta,financialRequest){
  if(financialRequest.schema_version!==POSTCAPTURE_RENEWAL_REQUEST)return;
  parseRenewalFinancialRequest(financialRequest);
  const ids=delta.new_receipts.map(item=>item.receipt_sha256).sort();
  if(delta.previous.archive_manifest_sha256!==request.baseline.manifest_sha256||delta.current.archive_manifest_sha256!==request.source.archive_manifest_sha256
    ||delta.new_receipt_count!==request.refresh.new_receipts||digest(ids)!==request.refresh.new_receipt_ids_sha256)throw Error('Sealed postcapture delta differs from the exact 400-receipt request');
}
