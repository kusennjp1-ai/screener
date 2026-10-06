import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,chmodSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {contract,digest,validateCorrectionReceipt,dataInventory} from './financial-correction.mjs';
import {sha256,validateReceipt,uiInventory,inventoryDigest} from './publication-state.mjs';
import {parsePreviewRequest,validatePreviewReceipt,previewBuildEnvironment} from './financial-candidate-preview.mjs';
import {CERTIFIED_PREVIEW_SCHEMA,CERTIFIED_SOURCE_GUARD,NATIVE_PROJECTOR,NATIVE_PROJECTOR_PATH,verifyRecordedCertifiedSource,certifiedSourceDescriptor,nativeDestinationDescriptor} from './financial-candidate-preview-v2.mjs';
import {certifiedSourceFixture} from './fixtures/certified-source-preview.mjs';
import trust from '../../contracts/financial_source_certification_trust_v1.json' with {type:'json'};
const H='a'.repeat(64),S='b'.repeat(40),T='c'.repeat(40),source=structuredClone(trust.reviewed_requests[1].request.source),review=trust.reviewed_requests[1];
const reference=()=>({schema_version:'financial-source-certificate-reference-v1',repository:source.repository,workflow:'.github/workflows/financial-source-certification.yml',head_sha:T,run_id:22,run_attempt:1,job_id:41,artifact_id:199,artifact_name:`financial-source-certification-${T}-1`,artifact_sha256:H,certificate_sha256:H});
const request=()=>({schema_version:CERTIFIED_PREVIEW_SCHEMA,kind:'unpublished_financial_candidate',candidate_ui:{sha:S,tree:T},
  correction:{schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,previous_publication_identity:`1/1/${H}/${H}`,source:structuredClone(source)},
  source_validation:{guard:CERTIFIED_SOURCE_GUARD,certificate:reference()},destination_projection:{projector:NATIVE_PROJECTOR,policy:'financial-correction-native-annual-v1'}});
const controllerRoot=fileURLToPath(new URL('../..',import.meta.url));
function destination() {
  const policy={id:'financial-correction-explicit-ownership-v1',contract_sha256:H,projector_sha256:H};
  const original=Buffer.from(JSON.stringify({policy,bindings:{archive_manifest_sha256:source.archive_manifest_sha256},receipt_inventory_sha256:H}));
  const files=Object.fromEntries([NATIVE_PROJECTOR_PATH,'backend/app/services/native_annual_history.py','contracts/native_annual_history_v1.json'].map(path=>[path,sha256(readFileSync(join(controllerRoot,path)))]));
  const projection={policy:{id:'financial-correction-native-annual-v1',contract_sha256:files['contracts/native_annual_history_v1.json'],projector_sha256:digest({files,legacy_policy:policy})},
    derivation:{schema_version:'native-annual-destination-derivation-v1',source_projection_sha256:sha256(original),source_policy:policy,source_receipt_inventory_sha256:H},
    receipt_inventory_sha256:H,bindings:{archive_manifest_sha256:source.archive_manifest_sha256}};
  return {projection,original,descriptor:nativeDestinationDescriptor(projection,H,controllerRoot,original)};
}
function receipt() {
  const outcome={policy:CERTIFIED_SOURCE_GUARD,run:{id:source.run_id,attempt:8,status:'completed',conclusion:'success'},
    job:{id:31,attempt:8,status:'completed',conclusion:'success',failed_steps:[]},
    reported_batch:{sha256:H,exit_code:0,provider_stop:null,execution_stop:null,counts:{captured_attributes:184,failed_attributes:0}},
    reported_cycle:{sha256:H,phase:'completed',exit_code:0,archive_manifest_sha256:source.archive_manifest_sha256,base_artifact_sha256:source.acquisition_base_sha256,code_revision:source.head_sha,provider_state_before:'available',published:false,retained_receipts:3754,retained_symbols:1887},
    recomputed:{symbols:1894,selected_receipts:3754,field_reason_counts:{missing_evidence:34}}};
  const failures=Array.from({length:34},(_,i)=>({attempt_id:`original-${i}`,attempted_at:'2026-10-04T11:00:00Z',attribute:'income_stmt',category:'ordinary_empty_statement',completed_at:'2026-10-04T11:00:01Z',failure_kind:'empty_getter_result',http_statuses:[200],outcome:'failed',source_object_sha256:H,symbol:`TEST${i}`}));
  const cert={reference:reference(),authority:'source_artifact_validation_only',publication_authority:'none',reviewed_source_request:{tree_sha:review.tree_sha,request_sha256:review.request.canonical_sha256,request_git_blob_sha:review.request.git_blob_sha},
    certifier_job:{id:41,run_id:22,run_attempt:1,name:'certify-source-artifacts',conclusion:'success'},
    source_execution:{attempt_outcome_counts:{failed:34,succeeded:3748},certification_is_complete_availability:false,empty_getter_count:34,failure_inventory_scope:'cumulative_archive',failures,further_provider_work_allowed:false,original_outcomes_retained:true,
      producer_batch:{attempt_outcome_counts:{succeeded:184},attempts_sha256:H,empty_getter_count:0,plan_sha256:H,statement_getter_calls:184,summary_sha256:H,unknown_failure_count:0},producer_exit_code:0,producer_job_conclusion:'success',producer_job_id:31,producer_run_conclusion:'success',provider_failures:[],provider_state:'no_block_observed',unknown_failure_count:0},
    source_timestamp_bounds:{earliest:'2026-10-04T10:00:00Z',latest:'2026-10-04T11:00:00Z'},
    bindings:{acquisition_base_sha256:source.acquisition_base_sha256,archive_manifest_sha256:source.archive_manifest_sha256,cohort_sha256:source.cohort_sha256,cycle_sha256:H,request_sha256:review.request.canonical_sha256,source_api_evidence_sha256:H},
    validation:{code_sha:T,contract_sha256:H,contract_version:'financial-source-certification-v1',policy_sha256:H,projection_policy:'original-receipts-current-availability-v1',reviewed_projector_migrations:[]},
    projection:{attempted_symbols:1894,cohort_count:1894,complete_availability_required:false,counts:{},knowledge_basis:contract.knowledge_basis,path:`projections/${H}.json`,point_in_time:false,qualification_authority:false,receipt_inventory_sha256:H,retained_receipts:3754,retained_symbols:1887,schema_version:'financial-source-certified-projection-v1',sha256:H,source_data_as_of:'2026-10-02',source_publication_date:null,source_timestamp_bounds:{earliest:'2026-10-04T10:00:00Z',latest:'2026-10-04T11:00:00Z'}}};
  return {schema_version:CERTIFIED_PREVIEW_SCHEMA,kind:'unpublished_financial_candidate',publication_authority:'none',verification_basis:'local_bytes_and_recorded_remote_evidence_requires_live_revalidation',candidate_ui:{sha:S,tree:T,digest:H},controller:{sha:S,tree:T},
    previous_publication:{identity:`1/1/${H}/${H}`,ui_sha:S,ui_digest:H,artifact_id:88,artifact_sha256:H,data_inventory_sha256:H,price_observations_sha256:H},source:structuredClone(source),source_outcome:outcome,source_evidence_sha256:H,
    financial:{generation:H,projection_sha256:H,receipt_inventory_sha256:H,evaluated_at:'2026-10-04T13:00:00Z',knowledge_basis:contract.knowledge_basis,point_in_time:false,source_publication_date:null},bundles:{baseline_data_sha256:H,corrected_data_sha256:H},verification_sha256:H,
    source_validation:certifiedSourceDescriptor(cert,outcome),destination_projection:destination().descriptor};
}

test('v2 requires both exact certified source and native destination selections',()=>{
  assert.deepEqual(parsePreviewRequest(request()),request());
  for(const mutate of [v=>v.source_policy='successful_capture',v=>v.source_validation.guard='successful_capture',v=>delete v.source_validation,
    v=>v.destination_projection.projector='arbitrary.py',v=>v.destination_projection.policy='financial-correction-explicit-ownership-v1',v=>v.source_validation.certificate.run_attempt=2]) {
    const value=request();mutate(value);assert.throws(()=>parsePreviewRequest(value));
  }
});

test('preview baseline ignores ambient carry/correction modes and preserves only its explicit selection',()=>{
  const inherited={PATH:'/existing/bin',FINANCIAL_EVALUATED_AT:'old',FINANCIAL_CORRECTION_PROJECTION:'/unselected.json',FINANCIAL_CORRECTION_SHA256:H,
    FINANCIAL_GENERATION_CARRY_PROJECTION:'/old-carry.json',FINANCIAL_GENERATION_CARRY_SOURCE_LINEAGE:H};
  const original=structuredClone(inherited),time='2026-10-04T13:00:00Z';
  const baseline=previewBuildEnvironment(time,{},inherited);
  assert.equal(baseline.PATH,inherited.PATH);assert.equal(baseline.FINANCIAL_EVALUATED_AT,time);
  assert.equal(Object.keys(baseline).some(key=>key.startsWith('FINANCIAL_CORRECTION_')||key.startsWith('FINANCIAL_GENERATION_CARRY_')),false);
  const selected={FINANCIAL_CORRECTION_PROJECTION:'/selected-native.json',FINANCIAL_CORRECTION_SHA256:'d'.repeat(64)};
  const corrected=previewBuildEnvironment(time,selected,inherited);
  for(const [key,value] of Object.entries(selected))assert.equal(corrected[key],value);
  assert.equal(Object.keys(corrected).some(key=>key.startsWith('FINANCIAL_GENERATION_CARRY_')),false);
  assert.deepEqual(inherited,original);
});

test('offline adapter verifies certificates with no gh route and rejects wrong source/certificate',()=>{
  const f=certifiedSourceFixture(1),bin=mkdtempSync(join(tmpdir(),'preview-no-gh-')),oldPath=process.env.PATH;
  try {
    const marker=join(bin,'called');writeFileSync(join(bin,'gh'),`#!/bin/sh\ntouch '${marker}'\nexit 77\n`);chmodSync(join(bin,'gh'),0o755);process.env.PATH=bin+':'+oldPath;
    const evidence={...f.certifier,commit:f.commit,tree:f.tree};
    const verify=(src=f.source,ref=f.reference,recorded=evidence)=>verifyRecordedCertifiedSource(src,f.producer,recorded,ref,f.zip);
    assert.equal(verify().certification.publication_authority,'none');
    assert.throws(()=>verify(trust.reviewed_requests[0].request.source));
    assert.throws(()=>verify(f.source,{...f.reference,certificate_sha256:'d'.repeat(64)}));
    assert.throws(()=>verify(f.source,f.reference,{...evidence,run:{...evidence.run,head_sha:S}}));
    assert.throws(()=>verify(f.source,f.reference,{...evidence,tree:{...evidence.tree,truncated:true}}));
    assert.throws(()=>readFileSync(marker),{code:'ENOENT'});
  } finally {process.env.PATH=oldPath;f.cleanup();rmSync(bin,{recursive:true,force:true});}
});

test('native destination binds original projection bytes, policy, inventory and executing code',()=>{
  const f=destination();assert.equal(f.descriptor.policy.id,'financial-correction-native-annual-v1');
  for(const mutate of [v=>v.policy.id='financial-correction-explicit-ownership-v1',v=>v.policy.projector_sha256=H,v=>v.derivation.source_policy.id='unknown',v=>v.derivation.source_receipt_inventory_sha256='b'.repeat(64)]) {
    const next=structuredClone(f.projection);mutate(next);assert.throws(()=>nativeDestinationDescriptor(next,H,controllerRoot,f.original));
  }
  assert.throws(()=>nativeDestinationDescriptor(f.projection,H,controllerRoot,Buffer.from('{}')));
});

test('v2 receipt retains cumulative failures and remains invalid for both release validators',()=>{
  const value=receipt();assert.equal(validatePreviewReceipt(value),value);
  assert.equal(value.source_validation.certificate.source_execution.failures.length,34);
  assert.throws(()=>validateReceipt(value));assert.throws(()=>validateCorrectionReceipt(value));
  for(const mutate of [v=>v.publication_authority='approved',v=>v.source.run_attempt=3,v=>v.source_outcome.policy='successful_capture',v=>v.source_outcome.run.conclusion='failure',
    v=>v.source_validation.certificate.reference.artifact_sha256='d'.repeat(64),v=>v.source_validation.certificate.source_execution.failures.pop(),v=>v.source_validation.certificate.validation.projection_policy='financial-correction-native-annual-v1',
    v=>v.destination_projection.derivation.source_projection_sha256='e'.repeat(64),v=>v.destination_projection.projector='arbitrary',v=>v.financial.receipt_inventory_sha256='f'.repeat(64),v=>v.source_outcome.reported_cycle.published=true]) {
    const changed=structuredClone(value);mutate(changed);assert.throws(()=>validatePreviewReceipt(changed));
  }
});


test('new packed financial candidate seals an explicit no-authority preview with its own exact source and UI binding',async t=>{
  const {prepareCandidateTransport,verifyCandidateTransport,completeInventory}=await import('./financial-release-activation.mjs');
  const root=mkdtempSync(join(tmpdir(),'packed-financial-candidate-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const corrected=join(root,'corrected'),write=(path,bytes)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);};
  for(const [path,bytes]of [['index.html','captured decoder UI'],['sw.js','captured worker'],['static-data/manifest.json','{"as_of_date":"2026-10-02"}'],['static-data/markets/us/charts/OWNED.json',' {"bars":[{"date":"2026-10-02","close":17}],"optional":null}\n'],['static-transport-capability.json',readFileSync(join(controllerRoot,'frontend/public/static-transport-capability.json'))]])write(join(corrected,path),bytes);
  const preview=receipt();preview.candidate_ui.digest=inventoryDigest(uiInventory(corrected));preview.bundles.corrected_data_sha256=inventoryDigest(dataInventory(corrected));
  validatePreviewReceipt(preview);write(join(root,'preview-receipt.json'),JSON.stringify(preview));
  const originalPreview=readFileSync(join(root,'preview-receipt.json')),prepared=await prepareCandidateTransport(controllerRoot,root);
  assert.deepEqual(readFileSync(join(root,'preview-receipt.json')),originalPreview,'packing cannot refresh any proof/evaluation clock');
  assert.equal(prepared.corrected.root.bindings.financialGeneration,preview.financial.generation);
  assert.equal(prepared.corrected.root.bindings.candidateId,sha256(originalPreview));
  const verified=await verifyCandidateTransport(controllerRoot,root,{schema_version:'financial-release-candidate-v2',transport_sha256:sha256(readFileSync(join(root,'transport.json')))});
  assert.equal(verified.publication.publication_authority,'none');assert.throws(()=>validateReceipt(verified.publication));
  await assert.rejects(()=>verifyCandidateTransport(controllerRoot,root,{schema_version:'financial-release-candidate-v1'}),/own v2 capture/);
  await assert.rejects(()=>prepareCandidateTransport(controllerRoot,root),/exactly once/);
  const cli=spawnSync(process.execPath,[join(controllerRoot,'.github/scripts/financial-release-activation.mjs'),'verify-candidate-transport',root],{cwd:controllerRoot,encoding:'utf8',timeout:15000});
  assert.equal(cli.status,0,cli.stderr);const report=JSON.parse(cli.stdout);
  assert.deepEqual(Object.keys(report).sort(),['schema','logical_data_inventory_sha256','ui_inventory_sha256','physical_inventory_sha256','preview_publication_sha256'].sort());
  assert.equal(report.physical_inventory_sha256,inventoryDigest(completeInventory(corrected)));
  assert.equal(report.logical_data_inventory_sha256,preview.bundles.corrected_data_sha256);
  write(join(root,'transport.json'),JSON.stringify({...prepared,bootstrap_sha256:H}));
  await assert.rejects(()=>verifyCandidateTransport(controllerRoot,root),/capture binding changed/);
});
