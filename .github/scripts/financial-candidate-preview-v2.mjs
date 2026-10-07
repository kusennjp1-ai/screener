// Explicit review-only source certification and destination policy selection.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCertificateReference } from './verify-certified-correction-source.mjs';
import { canonical, digest, verifyCorrectionSource } from './financial-correction.mjs';
import { sha256 } from './publication-state.mjs';
import nativeContract from '../../contracts/native_annual_history_v1.json' with { type: 'json' };
import trust from '../../contracts/financial_source_certification_trust_v1.json' with { type: 'json' };

export const CERTIFIED_PREVIEW_SCHEMA = 'financial-candidate-preview-v2';
export const CERTIFIED_SOURCE_GUARD = 'certified_source_artifact_v1';
export const NATIVE_PROJECTOR = 'native_annual_destination_v1';
export const NATIVE_PROJECTOR_PATH = 'backend/app/scripts/export_native_annual_projection.py';
const exact = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw Error(`Invalid closed ${label}`);
};
const equal = (left, right, label) => { if (canonical(left) !== canonical(right)) throw Error(`Certified preview ${label} mismatch`); };
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function parseCertifiedPreviewSelection(sourceValidation, destination) {
  exact(sourceValidation, ['guard', 'certificate'], 'preview source selection');
  if (sourceValidation.guard !== CERTIFIED_SOURCE_GUARD) throw Error('Unlisted preview source guard');
  parseCertificateReference(sourceValidation.certificate);
  parseNativeDestinationSelection(destination);
}

export function parseNativeDestinationSelection(destination) {
  exact(destination, ['projector', 'policy'], 'preview destination selection');
  if (destination.projector !== NATIVE_PROJECTOR || destination.policy !== nativeContract.policy_id) throw Error('Unlisted or mismatched preview destination projector');
}

// All API lookups are served from pinned read-only transcripts. An unexpected
// endpoint throws; the guard has no route to gh or a remote fallback here.
export function verifyRecordedCertifiedSource(source, producer, certifier, reference, certificateZipPath) {
  exact(producer, ['run', 'jobs', 'artifacts'], 'recorded producer evidence');
  exact(certifier, ['run', 'jobs', 'artifacts', 'commit', 'tree'], 'recorded certifier evidence');
  const api = (endpoint, pages = false) => {
    if (pages) throw Error('Unexpected paginated certified preview lookup');
    for (const [ref, recorded] of [[source, producer], [reference, certifier]]) {
      const base = `repos/${ref.repository}/actions/runs/${ref.run_id}`;
      if (endpoint === `${base}/attempts/${ref.run_attempt}`) return recorded.run;
      if (endpoint === `${base}/attempts/${ref.run_attempt}/jobs?per_page=100`) return {total_count:recorded.jobs.length,jobs:recorded.jobs};
      if (endpoint === `${base}/artifacts?per_page=100`) return {total_count:recorded.artifacts.length,artifacts:recorded.artifacts};
    }
    if (endpoint === `repos/${reference.repository}/git/commits/${reference.head_sha}`) return certifier.commit;
    if (endpoint === `repos/${reference.repository}/git/trees/${certifier.commit.tree?.sha}?recursive=1`) return certifier.tree;
    throw Error('Certified preview attempted an unrecorded remote lookup');
  };
  return verifyCorrectionSource(source, api, {reference, certificateZipPath});
}

export function certifiedSourceDescriptor(certification, sourceOutcome) {
  return {guard:CERTIFIED_SOURCE_GUARD, certificate:certification, verification_sha256:digest(certification), source_outcome_sha256:digest(sourceOutcome)};
}

export function nativeDestinationDescriptor(projection, projectionSha, controllerRoot, originalProjectionBytes) {
  if(!originalProjectionBytes || sha256(originalProjectionBytes)!==projection.derivation?.source_projection_sha256)throw Error('Native preview original destination projection digest mismatch');
  const original=JSON.parse(originalProjectionBytes);
  equal(original.policy,projection.derivation.source_policy,'original destination policy');
  equal(original.bindings,projection.bindings,'original destination bindings');
  if(original.receipt_inventory_sha256!==projection.receipt_inventory_sha256)throw Error('Native preview changed its original receipt inventory');
  const descriptor = {projector:NATIVE_PROJECTOR, policy:projection.policy, derivation:projection.derivation, projection_sha256:projectionSha};
  descriptor.verification_sha256=digest(descriptor);
  validateNativeDestination(descriptor, projection.receipt_inventory_sha256, projectionSha);
  const paths = [NATIVE_PROJECTOR_PATH, 'backend/app/services/native_annual_history.py', 'contracts/native_annual_history_v1.json'];
  const files = Object.fromEntries(paths.map(path => [path, sha256(readFileSync(join(controllerRoot,path)))]));
  if (projection.policy.contract_sha256 !== files['contracts/native_annual_history_v1.json']
    || projection.policy.projector_sha256 !== digest({files,legacy_policy:projection.derivation.source_policy})) throw Error('Native preview policy does not bind the executing projector');
  return descriptor;
}

export function validateNativeDestination(value, receiptsSha, projectionSha) {
  exact(value,['projector','policy','derivation','projection_sha256','verification_sha256'],'preview destination receipt');
  const {verification_sha256,...body}=value;
  if(verification_sha256!==digest(body))throw Error('Native preview receipt changed its verified derivation');
  exact(value.policy,['id','contract_sha256','projector_sha256'],'preview destination policy');
  exact(value.derivation,['schema_version','source_projection_sha256','source_policy','source_receipt_inventory_sha256'],'preview native derivation');
  exact(value.derivation.source_policy,['id','contract_sha256','projector_sha256'],'preview original destination policy');
  if(value.projector!==NATIVE_PROJECTOR || value.policy.id!==nativeContract.policy_id
    || value.derivation.schema_version!=='native-annual-destination-derivation-v1' || value.derivation.source_policy.id!==nativeContract.source_policy_id
    || ![value.policy.contract_sha256,value.policy.projector_sha256,value.derivation.source_projection_sha256,value.derivation.source_policy.contract_sha256,value.derivation.source_policy.projector_sha256].every(hash)
    || value.derivation.source_receipt_inventory_sha256!==receiptsSha || value.projection_sha256!==projectionSha) throw Error('Invalid native preview derivation binding');
}

export function validateCertifiedPreviewReceipt(value) {
  const selection=value.source_validation;
  exact(selection,['guard','certificate','verification_sha256','source_outcome_sha256'],'preview certified source receipt');
  if(selection.guard!==CERTIFIED_SOURCE_GUARD || selection.verification_sha256!==digest(selection.certificate) || selection.source_outcome_sha256!==digest(value.source_outcome)) throw Error('Certified preview receipt changed its verified source record');
  const c=selection.certificate, source=value.source, outcome=value.source_outcome;
  exact(c,['reference','authority','publication_authority','reviewed_source_request','certifier_job','source_execution','source_timestamp_bounds','bindings','validation','projection'],'verified preview certificate');
  parseCertificateReference(c.reference);
  if(c.authority!=='source_artifact_validation_only' || c.publication_authority!=='none' || outcome.policy!==CERTIFIED_SOURCE_GUARD) throw Error('Certificate cannot grant preview publication or destination policy authority');
  exact(c.reviewed_source_request,['tree_sha','request_sha256','request_git_blob_sha'],'preview reviewed source request');
  const review=trust.reviewed_requests.find(item=>item.tree_sha===c.reviewed_source_request.tree_sha);
  if(!review)throw Error('Unreviewed preview certificate request');
  equal(review.request.source,source,'source identity');
  equal(c.reviewed_source_request,{tree_sha:review.tree_sha,request_sha256:review.request.canonical_sha256,request_git_blob_sha:review.request.git_blob_sha},'reviewed request');
  exact(c.bindings,['acquisition_base_sha256','archive_manifest_sha256','cohort_sha256','cycle_sha256','request_sha256','source_api_evidence_sha256'],'certificate bindings');
  for(const key of ['acquisition_base_sha256','archive_manifest_sha256','cohort_sha256']) if(c.bindings[key]!==source[key])throw Error('Preview certificate/source binding mismatch');
  if(!Object.values(c.bindings).every(hash) || c.bindings.request_sha256!==review.request.canonical_sha256)throw Error('Invalid preview certificate binding');
  exact(c.certifier_job,['id','run_id','run_attempt','name','conclusion'],'preview certifier job');
  if(c.certifier_job.id!==c.reference.job_id || c.certifier_job.run_id!==c.reference.run_id || c.certifier_job.run_attempt!==c.reference.run_attempt
    || c.certifier_job.name!=='certify-source-artifacts' || c.certifier_job.conclusion!=='success' || c.validation.code_sha!==c.reference.head_sha
    || c.validation.projection_policy!=='original-receipts-current-availability-v1' || c.validation.contract_version!=='financial-source-certification-v1')throw Error('Invalid preview certification policy/attempt');
  exact(c.validation,['code_sha','contract_sha256','contract_version','policy_sha256','projection_policy','reviewed_projector_migrations'],'preview certificate validation');
  exact(c.projection,['attempted_symbols','cohort_count','complete_availability_required','counts','knowledge_basis','path','point_in_time','qualification_authority','receipt_inventory_sha256','retained_receipts','retained_symbols','schema_version','sha256','source_data_as_of','source_publication_date','source_timestamp_bounds'],'preview certified projection');
  exact(c.source_timestamp_bounds,['earliest','latest'],'preview original source clocks');
  const execution=c.source_execution;
  exact(execution.producer_batch,['attempt_outcome_counts','attempts_sha256','empty_getter_count','plan_sha256','statement_getter_calls','summary_sha256','unknown_failure_count'],'preview original producer batch');
  for(const failure of execution.failures||[])exact(failure,['attempt_id','attempted_at','attribute','category','completed_at','failure_kind','http_statuses','outcome','source_object_sha256','symbol'],'preview retained original failure');
  exact(execution,['attempt_outcome_counts','certification_is_complete_availability','empty_getter_count','failure_inventory_scope','failures','further_provider_work_allowed','original_outcomes_retained','producer_batch','producer_exit_code','producer_job_conclusion','producer_job_id','producer_run_conclusion','provider_failures','provider_state','unknown_failure_count'],'preview source execution');
  if(!['success','failure'].includes(execution.producer_run_conclusion) || execution.producer_run_conclusion!==execution.producer_job_conclusion
    || execution.producer_job_id!==outcome.job.id || execution.producer_run_conclusion!==outcome.run.conclusion || execution.producer_job_conclusion!==outcome.job.conclusion
    || execution.producer_exit_code!==(outcome.run.conclusion==='success'?0:3) || execution.original_outcomes_retained!==true
    || execution.certification_is_complete_availability!==false || execution.further_provider_work_allowed!==false || execution.failure_inventory_scope!=='cumulative_archive'
    || !Array.isArray(execution.failures) || !Array.isArray(execution.provider_failures)
    || execution.failures.length!==(execution.attempt_outcome_counts.failed||0)
    || execution.empty_getter_count!==execution.failures.filter(item=>item.failure_kind==='empty_getter_result').length
    || !Number.isSafeInteger(execution.unknown_failure_count) || execution.unknown_failure_count<0)throw Error('Preview source execution cannot lose original outcomes');
  if(!outcome.reported_batch || outcome.reported_batch.sha256!==execution.producer_batch.summary_sha256 || outcome.reported_batch.exit_code!==execution.producer_exit_code
    || !outcome.reported_cycle || outcome.reported_cycle.sha256!==c.bindings.cycle_sha256 || outcome.reported_cycle.exit_code!==execution.producer_exit_code
    || outcome.reported_cycle.phase!=='completed' || outcome.reported_cycle.published!==false || outcome.reported_cycle.code_revision!==source.head_sha
    || outcome.reported_cycle.archive_manifest_sha256!==source.archive_manifest_sha256 || outcome.reported_cycle.base_artifact_sha256!==source.acquisition_base_sha256)throw Error('Preview source outcome differs from certified original bytes');
  if(c.projection.schema_version!=='financial-source-certified-projection-v1' || !hash(c.projection.sha256) || !hash(c.projection.receipt_inventory_sha256)
    || c.projection.point_in_time!==false || c.projection.source_publication_date!==null || c.projection.qualification_authority!==false || c.projection.complete_availability_required!==false
    || c.projection.knowledge_basis!=='current_observation_at_source_capture')throw Error('Source certificate cannot certify a destination projection');
  equal(c.source_timestamp_bounds,c.projection.source_timestamp_bounds,'source timestamps');
  validateNativeDestination(value.destination_projection,value.financial.receipt_inventory_sha256,value.financial.projection_sha256);
  return value;
}
