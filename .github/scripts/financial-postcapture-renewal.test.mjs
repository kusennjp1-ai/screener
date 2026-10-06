import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCertifiedPreviewSelection} from './financial-candidate-preview-v2.mjs';
import {parsePreviewRequest} from './financial-candidate-preview.mjs';
import {parseFinancialReleaseRequest,sourceLineage,renewalSourceLineage} from './financial-release-activation.mjs';
import {consumerCodeInventory,renewalControllerCodeInventory,renewalPolicy} from './financial-source-renewal.mjs';
import {POSTCAPTURE_PREVIEW_SCHEMA,POSTCAPTURE_SOURCE_GUARD,POSTCAPTURE_RENEWAL_REQUEST,parseRenewalFinancialRequest,assertPostcaptureRequestDelta} from './financial-candidate-preview-postcapture.mjs';
import {verifyPostcaptureCorrectionSource} from './verify-postcapture-correction-source.mjs';
import request from '../../contracts/financial_source_postcapture_request_v1.json' with {type:'json'};
import trust from '../../contracts/financial_source_postcapture_trust_v1.json' with {type:'json'};
const H='a'.repeat(64),S='b'.repeat(40);
const reference={schema_version:'financial-source-postcapture-reference-v1',repository:'kusennjp1-ai/screener',workflow:'.github/workflows/financial-source-postcapture-validation.yml',head_sha:'28e298ee21ea275629a94e7066ac8835b7654182',run_id:37495003542,run_attempt:1,job_id:112377172824,artifact_id:11426862690,artifact_name:'financial-source-postcapture-validation-28e298ee21ea275629a94e7066ac8835b7654182-1',artifact_sha256:'f63ecbe50b61b49666abdfaa6bf2f30605a7ddb31af82d8a2e20da3ca1859d23',receipt_sha256:'f5e925de47bfe9dc5f00f28b179e6d4e124b24d2f793692390e08177e55f57d5'};
const destination={projector:'native_annual_destination_v1',policy:'financial-correction-native-annual-v1'};
const financial=()=>({schema_version:POSTCAPTURE_RENEWAL_REQUEST,correction:{schema_version:'financial-correction-v1',kind:'financial_correction',reason:'statement_source_receipts',previous_publication_identity:`1/1/${H}/${H}`,source:structuredClone(request.source)},source_validation:{guard:POSTCAPTURE_SOURCE_GUARD,certificate:structuredClone(reference)},destination_projection:structuredClone(destination)});
// Use the repository's unchanged intent discriminants rather than a new variant.
const intentContract=JSON.parse(readFileSync(new URL('../../contracts/financial_correction_v1.json',import.meta.url)));
const bounded=()=>{const v=financial();Object.assign(v.correction,{schema_version:intentContract.schema_version,kind:intentContract.kind,reason:intentContract.reason});return v;};

test('actual companion reference enters only its distinct renewal request and preview schema',()=>{
  const value=bounded();assert.equal(parseRenewalFinancialRequest(value),value);
  assert.throws(()=>parseFinancialReleaseRequest(value),/Unknown financial release request/);
  assert.throws(()=>parseFinancialReleaseRequest({...value,schema_version:'financial-release-request-v1'}),/Unlisted preview source guard/);
  assert.throws(()=>parseCertifiedPreviewSelection(value.source_validation,destination),/Unlisted preview source guard/);
  const preview={schema_version:POSTCAPTURE_PREVIEW_SCHEMA,kind:'unpublished_financial_candidate',candidate_ui:{sha:S,tree:S},correction:value.correction,source_validation:value.source_validation,destination_projection:destination};
  assert.equal(parsePreviewRequest(preview),preview);
  assert.throws(()=>parsePreviewRequest({...preview,schema_version:'financial-candidate-preview-v2'}),/Unlisted preview source guard/);
});
test('same reference cannot bypass the original v1 source-lineage constructor',()=>{
  const values={source:request.source,certificate:reference,sourceProjectionSha256:H,receiptInventorySha256:H,projectionPolicy:{id:destination.policy,contract_sha256:H,projector_sha256:H}};
  assert.throws(()=>sourceLineage(values),/certificate reference/);
  const lineage=renewalSourceLineage(values);assert.equal(lineage.value.schema_version,'financial-source-lineage-v2');
  assert.deepEqual(lineage.value.source,request.source);assert.deepEqual(lineage.value.certificate,reference);
  for(const key of ['head_sha','archive_manifest_sha256','cohort_sha256']){
    const changed=structuredClone(values);changed.source[key]=key==='head_sha'?'f'.repeat(40):'f'.repeat(64);
    assert.throws(()=>renewalSourceLineage(changed),/finite original producer source|Invalid pinned financial correction source/);
  }
});
test('production source and renewal registries remain empty and cannot call an API',()=>{
  assert.equal(renewalPolicy.publication_enabled,false);assert.deepEqual(renewalPolicy.reviewed_controllers,[]);assert.deepEqual(trust.reviewed_requests,[]);
  let calls=0;assert.throws(()=>verifyPostcaptureCorrectionSource(request.source,{reference,certificateZipPath:'/missing'},()=>{calls++;throw Error('Unexpected API');}),/not independently admitted/);assert.equal(calls,0);
});
test('companion transition cannot change count, predecessor or fresh receipt identity',()=>{
  const delta={previous:{archive_manifest_sha256:request.baseline.manifest_sha256},current:{archive_manifest_sha256:request.source.archive_manifest_sha256},new_receipt_count:400,new_receipts:Array.from({length:400},(_,i)=>({receipt_sha256:i.toString(16).padStart(64,'0')}))};
  assert.throws(()=>assertPostcaptureRequestDelta(delta,bounded()),/exact 400-receipt/);
  for(const mutation of [v=>v.new_receipt_count=399,v=>v.previous.archive_manifest_sha256=H,v=>v.current.archive_manifest_sha256=H]){const changed=structuredClone(delta);mutation(changed);assert.throws(()=>assertPostcaptureRequestDelta(changed,bounded()),/exact 400-receipt/);}
});
test('only four controller-only contracts leave UI comparison and all remain in controller rechecks',()=>{
  const names=['reference_v1.json','trust_v1.json','receipt_v1.schema.json','request_v1.json'].map(name=>`contracts/financial_source_postcapture_${name}`);
  const files=Object.fromEntries([...names,'contracts/native_annual_history_v1.json','frontend/src/index.js','backend/app/services/native_annual_history.py','contracts/financial_source_postcapture_unreviewed.json'].map(path=>[path,{sha256:H}]));
  const ui=consumerCodeInventory(files),controller=renewalControllerCodeInventory(files);
  for(const path of names){assert.equal(Object.hasOwn(ui,path),false);assert.deepEqual(controller[path],files[path]);}
  for(const path of Object.keys(files).filter(path=>!names.includes(path)))assert.deepEqual(ui[path],files[path]);
});
