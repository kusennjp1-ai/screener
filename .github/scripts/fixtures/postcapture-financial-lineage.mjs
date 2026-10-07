// Test-only financial/audit lifecycle using real retained inputs. This does not
// simulate a successful publisher or validate a complete compiled Pages tree.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {digest,contract,dataInventory} from '../financial-correction.mjs';
import {sha256,inventoryDigest} from '../publication-state.mjs';
import {priceObservationDigest} from '../price-observations.mjs';
import {renewalPolicy,renewalSchema,validateRenewalTransition,validateSourceRenewalDelta,financialAuditInventory,inspectRenewalChain,writeRenewalRelease} from '../financial-source-renewal.mjs';
import {renewalSourceLineage,validateFinancialReleaseReceipt,writeFinancialReleaseReceipt,verifyFinancialReleaseAssets,assertFinancialLineageContinuity} from '../financial-release-activation.mjs';
import {POSTCAPTURE_PREVIEW_SCHEMA,POSTCAPTURE_RENEWAL_REQUEST,POSTCAPTURE_SOURCE_GUARD,assertPostcaptureRenewalDelta,validatePostcapturePreviewReceipt} from '../financial-candidate-preview-postcapture.mjs';
import {executeSourcePhase} from '../financial-preview-source-phase.mjs';
import {createFinancialGenerationCarry} from '../../../frontend/tools/financial-generation-carry.mjs';
import {projectFinancialRow} from '../../../frontend/src/static/financialCurrent.js';
import {overlayFinancialCorrection} from '../../../frontend/tools/financial-correction-overlay.mjs';
const read=p=>JSON.parse(readFileSync(p)),H='a'.repeat(64),S='b'.repeat(40),C='c'.repeat(40),T='d'.repeat(40),P='e'.repeat(40);
const write=(p,b)=>{mkdirSync(dirname(p),{recursive:true});writeFileSync(p,b,{flag:'wx'});};
export async function runPostcaptureFinancialLineage(input){
  const out=resolve(input.output);mkdirSync(out,{recursive:false});
  const initialBytes=readFileSync(input.initial_release),initial=validateFinancialReleaseReceipt(JSON.parse(initialBytes));
  const publicationBytes=readFileSync(input.publication),pub=JSON.parse(publicationBytes),manifestBytes=readFileSync(input.manifest),manifest=JSON.parse(manifestBytes);
  const base=readFileSync(input.base),oldProjection=readFileSync(input.initial_projection),newBytes=readFileSync(input.projection),projection=JSON.parse(newBytes);
  const sourceDelta=validateSourceRenewalDelta(read(input.source_delta)),certification=read(input.certification).certification,ref=certification.reference,source=certification.receipt.source;
  assert.equal(sha256(initialBytes),pub.financial_release.sha256);assert.equal(sha256(base),initial.source_base.sha256);assert.equal(sha256(oldProjection),initial.source_projection.sha256);
  assert.equal(sha256(newBytes),sourceDelta.current.projection_sha256);assert.deepEqual(projection.policy,initial.lineage.policy);
  assertPostcaptureRenewalDelta(sourceDelta,certification);
  const identity=`${pub.run_id}/${pub.run_attempt}/${sha256(publicationBytes)}/${sha256(manifestBytes)}`;
  const live={identity,uiSha:pub.ui_sha,uiDigest:pub.ui_digest,uiFiles:pub.ui_files,approval:pub.approval,manifest,manifestHash:sha256(manifestBytes),priceObservations:pub.price_observations,knownPriceDates:pub.known_price_dates,verificationUniverse:pub.verification_universe,financialRelease:initial,receipt:pub};
  const corrected=join(out,'financial-audit-only');mkdirSync(corrected);
  for(const [path,bytes]of [[pub.financial_release.path,initialBytes],[initial.source_base.path,base],[initial.source_projection.path,oldProjection],['static-data/manifest.json',manifestBytes]])write(join(corrected,path),bytes);
  const history=financialAuditInventory(corrected);
  const financialRequest={schema_version:POSTCAPTURE_RENEWAL_REQUEST,correction:{schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,previous_publication_identity:identity,source},source_validation:{guard:POSTCAPTURE_SOURCE_GUARD,certificate:ref},destination_projection:{projector:'native_annual_destination_v1',policy:projection.policy.id}};
  const preview={schema_version:POSTCAPTURE_PREVIEW_SCHEMA,kind:'unpublished_financial_candidate',candidate_ui:{sha:pub.ui_sha,tree:input.captured_tree},correction:financialRequest.correction,source_validation:financialRequest.source_validation,destination_projection:financialRequest.destination_projection};
  const originalProjectionPath=input.original_destination_projection;
  const {result:phase}=await executeSourcePhase({schema_version:'financial-preview-source-phase-v1',kind:'projection_metadata',projection_path:resolve(input.projection),projection_sha256:sha256(newBytes),request:preview,
    source_evidence:read(input.source_api),source_files:resolve(input.source_files),certification,controller_root:resolve(input.controller_root),
    projection_result:{projection_path:resolve(input.projection),projection_sha256:sha256(newBytes),source_projection_path:resolve(originalProjectionPath),source_projection_sha256:sha256(readFileSync(originalProjectionPath))},
    evaluated_at:projection.financial_evaluated_at,previous_financial_generation:initial.financial_generation});
  validatePostcapturePreviewReceipt({schema_version:POSTCAPTURE_PREVIEW_SCHEMA,source,source_outcome:phase.sourceStatus,...phase.selected,financial:phase.financial});
  const lineage=renewalSourceLineage({source,certificate:ref,sourceProjectionSha256:sha256(newBytes),receiptInventorySha256:projection.receipt_inventory_sha256,projectionPolicy:projection.policy});
  const priceInput={artifact_id:11421722413,artifact_sha256:'1ab2594be91d3bbc8716481c730a9afdf22eb4ca554fcd5d02770b92252de4eb',manifest_sha256:live.manifestHash,price_observations_sha256:priceObservationDigest(live.priceObservations),known_price_dates_sha256:priceObservationDigest(live.knownPriceDates)};
  const request={schema_version:'financial-source-renewal-request-v1',previous_publication_identity:identity,previous_release:pub.financial_release,previous_lineage_sha256:initial.lineage_sha256,previous_financial_generation:initial.financial_generation,origin_release:pub.financial_release,
    ui:{sha:pub.ui_sha,digest:pub.ui_digest,approval_sha256:digest(pub.approval)},consumer_code_sha256:H,financial_request:financialRequest,
    target:{evaluated_at:projection.financial_evaluated_at,base_sha256:sha256(base),manifest_sha256:live.manifestHash,price_observations_sha256:priceInput.price_observations_sha256,known_price_dates_sha256:priceInput.known_price_dates_sha256,universe_sha256:digest(live.verificationUniverse)},price_input:priceInput,maximum_new_receipts:400};
  // Deliberately synthetic future authority records exercise structural writers
  // only. They are not submitted to a publisher or represented as GitHub proofs.
  const checks=head=>contract.required_ci_jobs.map((name,i)=>({workflow:'.github/workflows/ci.yml',run_id:9001,run_attempt:1,job_id:9010+i,name,head_sha:head}));
  const sealed=new Date().toISOString(),certifier={head_sha:S,tree:T,checks:checks(S)};
  const record={schema_version:renewalSchema,producer:{repository:source.repository,workflow:renewalPolicy.workflow,head_sha:S,run_id:9020,run_attempt:1},captured_ui:{sha:pub.ui_sha,tree:input.captured_tree,digest:pub.ui_digest},
    request_sha256:digest(financialRequest),preview_receipt_sha256:H,corrected_inventory_sha256:H,protected_code_sha256:H,transport_sha256:H,renewal_request_sha256:digest(request),certification_controller_sha256:digest(certifier),registry_sha256:H,
    logical_data_inventory_sha256:inventoryDigest(dataInventory(corrected)),source_projection_sha256:sha256(newBytes),source_base_sha256:sha256(base),receipt_inventory_sha256:projection.receipt_inventory_sha256,financial_generation:projection.financial_generation,source_delta_sha256:digest(sourceDelta),history_inventory_sha256:inventoryDigest(history),sealed_at:sealed};
  const recordJson=JSON.stringify(record),pin={schema_version:'financial-source-renewal-pin-v1',repository:source.repository,workflow:renewalPolicy.workflow,head_sha:S,run_id:9020,run_attempt:1,job_id:9021,artifact_id:9022,artifact_name:'financial-source-renewal-9020-1',artifact_sha256:H,candidate_record_sha256:sha256(recordJson),request_sha256:digest(request)};
  const intent={schema_version:'financial-source-renewal-intent-v1',kind:'same-ui-same-price-financial-source-renewal',request_sha256:digest(request),pin_sha256:digest(pin),previous_publication_identity:identity,not_after:new Date(Date.now()+30*60*1000).toISOString()};
  const transition=validateRenewalTransition({schema_version:'financial-source-renewal-transition-v1',controller_sha:C,controller_checks:checks(C),certification_controller:certifier,publisher:{head_sha:P,tree:T,checks:checks(P),registry_sha256:H},request,pin,intent,record,record_json:recordJson,previous_lineage_sha256:initial.lineage_sha256,next_lineage:lineage.value,next_lineage_sha256:lineage.id,history_inventory:history,source_delta:sourceDelta});
  const renewed=await writeRenewalRelease({dist:corrected,live,transition,sourceProjectionBytes:newBytes,sourceBaseBytes:base,priceInput});
  assert.deepEqual(renewed.receipt.ui,initial.ui);assert.deepEqual(renewed.receipt.price_input,priceInput);assert.deepEqual(inspectRenewalChain(renewed.receipt,p=>readFileSync(join(corrected,p))).origin,initial);
  verifyFinancialReleaseAssets(corrected,renewed.reference);
  const target=JSON.parse(base);target.as_of_date='2026-10-05';for(const row of target.rows){row.as_of_date=target.as_of_date;if(row.technical_audit?.as_of_date)row.technical_audit.as_of_date=target.as_of_date;if(Number.isFinite(row.current_price))row.current_price*=1.001;}
  const targetBytes=Buffer.from(JSON.stringify(target)),carryIdentity=`9030/1/${renewed.reference.sha256}/${live.manifestHash}`;
  const carry=createFinancialGenerationCarry({sourceProjection:newBytes,sourceProjectionSha256:sha256(newBytes),sourceBase:base,sourceBaseSha256:sha256(base),sourceLineage:lineage.id,previousPublicationIdentity:carryIdentity,targetBase:targetBytes,targetBaseSha256:sha256(targetBytes),evaluatedAt:new Date().toISOString()});
  assert.deepEqual(carry.receipt_inventory,projection.receipt_inventory);
  const sourceOwnership=Object.fromEntries(Object.keys(projection.symbols).map(symbol=>[symbol,carry.ownership[symbol]]));
  const retainedSymbols=Object.keys(sourceOwnership).filter(symbol=>sourceOwnership[symbol]==='retained');
  const downgradedSymbols=Object.fromEntries(Object.entries(sourceOwnership).filter(([,status])=>status!=='retained'));
  for(const symbol of Object.keys(projection.symbols))if(carry.ownership[symbol]==='retained'){
    assert.deepEqual(carry.symbols[symbol].financial_current.p,projection.symbols[symbol].financial_current.p);
    assert.equal(carry.symbols[symbol].financial_current.t,projection.symbols[symbol].financial_current.t);
  }
  const carried=writeFinancialReleaseReceipt({dist:corrected,mode:'carry',previousIdentity:carryIdentity,lineage:{id:lineage.id,value:lineage.value},sourceProjectionBytes:newBytes,sourceBaseBytes:base,evaluationBytes:JSON.stringify(carry),generation:carry.financial_generation,evaluatedAt:carry.financial_evaluated_at,ui:renewed.receipt.ui,priceInput,renewal:renewed.receipt.renewal});
  assertFinancialLineageContinuity({financialRelease:renewed.receipt},carried.receipt);verifyFinancialReleaseAssets(corrected,carried.reference);
  assert.deepEqual(inspectRenewalChain(carried.receipt,p=>readFileSync(join(corrected,p))).origin,initial);
  for(const [path,hash]of Object.entries(history))assert.equal(sha256(readFileSync(join(corrected,path))),hash);
  const row=overlayFinancialCorrection({...target.rows.find(row=>row.symbol==='NVDA'),eps_growth_yy:999999,sales_growth_yy:999999},carry);
  const fresh=projectFinancialRow(row,{asOfDate:target.as_of_date,market:'US',now:Date.now()});
  const expired=projectFinancialRow(row,{asOfDate:target.as_of_date,market:'US',now:Date.parse('2026-10-20T00:00:00Z')});
  assert.equal(fresh.financial_current_state.fields.eps_growth_yy.availability,'current');
  assert.equal(expired.financial_current_state.fields.eps_growth_yy.availability,'unknown');assert.equal(expired.eps_growth_yy,null);
  const report={scope:'real financial projection/source and audit-writer lifecycle only; full publisher/compiled Pages proof not exercised',synthetic_future_controller_authority:true,synthetic_next_price_values:true,
    current_publication_sha256:sha256(publicationBytes),companion:ref,source_symbols:Object.keys(projection.symbols).length,new_receipts:sourceDelta.new_receipt_count,
    original_ui:initial.ui.approved_sha,ui_digest:initial.ui.digest,ui_authority_unchanged:true,all_original_audit_files_retained:true,
    complete_source_receipt_inventory_retained:true,retained_source_symbols:retainedSymbols.length,
    retained_symbol_proofs_and_evaluation_clocks_unchanged:true,conservative_carry_downgrades:downgradedSymbols,
    renewed_release:renewed.reference,carried_release:carried.reference,source_lineage:lineage.id,fresh_eps_availability:'current',expired_eps_availability:'unknown',expired_raw_alias_fallback:false,
    provider_calls:0,publication_authority:false,registry_entries_written:0,maximum_rss_kib:process.resourceUsage().maxRSS};
  write(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==3)throw Error('Usage: fixture INPUT_JSON');
  console.log(JSON.stringify(await runPostcaptureFinancialLineage(read(resolve(process.argv[2])))));
}
