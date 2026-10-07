import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,truncateSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {renewalPolicy,renewalSchema,parseRenewalRequest,parseRenewalPin,parseRenewalIntent,validateRenewalCandidate,validateRenewalTransition,validateSourceRenewalDelta,verifyRenewalAuthority,verifyRenewalInitialCapturePolicy,
  verifyRenewalPredecessor,financialAuditInventory,assertRetainedFinancialHistory,consumerCodeInventory,inspectRenewalChain,verifyPublishedRenewal,
  assertRenewalCapacity,writeRenewalRelease,assertRenewalPublicationDisabled,reviewedMain135ConsumerTransition} from './financial-source-renewal.mjs';
import {validateRenewalRegistry,assertRenewalRegistryAppendOnly,verifyPreparedAutomaticRenewal} from './financial-source-renewal.mjs';
import {isFinancialRequestActive} from './select-release-source.mjs';
import {selectRenewalControls} from './financial-source-renewal-publisher.mjs';
import {sourceLineage,writeFinancialReleaseReceipt,verifyFinancialReleaseAssets,assertFinancialLineageContinuity,restorePublishedFinancialSource} from './financial-release-activation.mjs';
import {contract,digest,verifyCorrectionChecks,dataInventory} from './financial-correction.mjs';
import {bootstrap,sha256,inventoryDigest,uiInventory} from './publication-state.mjs';
import {priceObservationDigest} from './price-observations.mjs';
import {performanceLifecycleFixture} from './fixtures/financial-performance-lifecycle.mjs';
import {lifecycleFixture,read} from './fixtures/financial-release-lifecycle.mjs';
import {disabledRenewalRegistry} from './fixtures/financial-renewal-policy.mjs';
import {createFinancialGenerationCarry} from '../../frontend/tools/financial-generation-carry.mjs';

const repo=bootstrap.repository,prefix=`repos/${repo}`,H='a'.repeat(64),S='b'.repeat(40),C='c'.repeat(40),T='d'.repeat(40),CT='e'.repeat(40),P='f'.repeat(40),PT='1'.repeat(40);
const now=Date.parse('2026-10-06T12:00:00Z'),sealed='2026-10-04T13:30:00.000Z';
const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof value==='string'?value:JSON.stringify(value));};
const temp=()=>mkdtempSync(join(tmpdir(),'source-renewal-test-'));
const mutation=(value,fn)=>{const copy=structuredClone(value);fn(copy);return copy;};
function liveFrom(root,receipt,reference,index=30){
  const manifest=read(join(root,'static-data/manifest.json')),files=uiInventory(root),prices={'["US","chart","OWNED"]':'2026-10-02'};
  return {identity:`${index}/1/${reference.sha256}/${sha256(JSON.stringify(manifest))}`,uiSha:receipt.ui.approved_sha,uiDigest:inventoryDigest(files),uiFiles:files,approval:receipt.ui.approval,
    manifest,manifestHash:sha256(readFileSync(join(root,'static-data/manifest.json'))),priceObservations:prices,knownPriceDates:prices,
    verificationUniverse:{as_of_date:'2026-10-02',required_symbols:['OWNED'],minimum_target:0.9,total:1,verified:1},financialRelease:receipt,
    receipt:{financial_release:reference,financial_lineage_sha256:receipt.lineage_sha256,...(receipt.mode!=='activation'?{financial_audit_files:financialAuditInventory(root)}:{})}};
}
function authority(transition,consumerTransition=null,{legacyRegistry=false}={}){
  const api={},code={'frontend/package-lock.json':{mode:'100644',sha:H.slice(0,40)},'backend/app/scripts/export_native_annual_projection.py':{mode:'100644',sha:S}};
  const captured=structuredClone(code);
  if(consumerTransition)for(const [path,pair]of Object.entries(consumerTransition.changes)){
    if(pair.before)captured[path]=pair.before;code[path]=pair.after;
  }
  transition.request.consumer_code_sha256=digest(consumerCodeInventory(captured));
  const priorRegistry={...disabledRenewalRegistry(),reviewed_consumer_transitions:consumerTransition?[consumerTransition]:[]};
  if(legacyRegistry)delete priorRegistry.ci_admission;
  transition.record.registry_sha256=sha256(JSON.stringify(priorRegistry));
  const sourceChecks=contract.required_ci_jobs.map((name,index)=>({workflow:'.github/workflows/ci.yml',run_id:92,run_attempt:2,job_id:920+index,name,head_sha:S}));
  transition.certification_controller={head_sha:S,tree:T,checks:sourceChecks};transition.record.certification_controller_sha256=digest(transition.certification_controller);
  reseal(transition);
  const review={controller_sha:C,controller_tree:CT,certification_sha:S,certification_tree:T,protected_code_sha256:digest(code),
    request_sha256:digest(transition.request),pin_sha256:digest(transition.pin),intent_sha256:digest(transition.intent),request_raw_sha256:sha256(JSON.stringify(transition.request)),pin_raw_sha256:sha256(JSON.stringify(transition.pin)),intent_raw_sha256:sha256(JSON.stringify(transition.intent))};
  for(const [revision,tree]of [[C,CT],[S,T],[P,PT]]){
    api[`${prefix}/git/commits/${revision}`]={sha:revision,tree:{sha:tree}};
    api[`${prefix}/git/trees/${tree}?recursive=1`]={sha:tree,truncated:false,tree:Object.entries(code).map(([path,value])=>({path,type:'blob',...value}))};
  }
  if(consumerTransition){
    // Explicit synthetic API metadata for the real reviewed identity; this
    // does not relabel a local commit or claim a real GitHub CI execution.
    for(const [revision,tree,files]of [[consumerTransition.captured_ui_sha,'2'.repeat(40),captured],[consumerTransition.reviewed_sha,consumerTransition.reviewed_tree,code]]){
      api[`${prefix}/git/commits/${revision}`]={sha:revision,tree:{sha:tree}};
      api[`${prefix}/git/trees/${tree}?recursive=1`]={sha:tree,truncated:false,tree:Object.entries(files).map(([path,value])=>({path,type:'blob',...value}))};
    }
  }
  for(const [key,expected]of [['request',transition.request],['pin',transition.pin],['intent',transition.intent]]){
    const bytes=Buffer.from(JSON.stringify(expected)),content={type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')};
    api[`${prefix}/contents/${renewalPolicy[`${key}_path`]}?ref=${C}`]=content;
    api[`${prefix}/contents/${renewalPolicy[`${key}_path`]}?ref=${P}`]=content;
    if(key==='request')api[`${prefix}/contents/${renewalPolicy.request_path}?ref=${S}`]=content;
  }
  const content=value=>{const bytes=Buffer.from(JSON.stringify(value));return {type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')};};
  const publisherRegistry={...priorRegistry,publication_enabled:true,reviewed_controllers:[review]};
  for(const revision of [C,S,P]){api[`${prefix}/contents/contracts/financial_source_renewal_v1.json?ref=${revision}`]=content(revision===P?publisherRegistry:priorRegistry);api[`${prefix}/contents/contracts/financial_source_certification_trust_v1.json?ref=${revision}`]=content({files:{},reviewed_requests:[]});api[`${prefix}/contents/contracts/financial_performance_exception_v2.json?ref=${revision}`]=content({schema_version:'financial-performance-exception-policy-v2',enabled:false,capture:null});}
  if(consumerTransition)for(const path of ['contracts/financial_source_certification_trust_v1.json','contracts/financial_performance_exception_v2.json'])api[`${prefix}/contents/${path}?ref=${consumerTransition.captured_ui_sha}`]=api[`${prefix}/contents/${path}?ref=${S}`];
  const base={head_branch:'main',status:'completed',conclusion:'success',repository:{full_name:repo},head_repository:{full_name:repo}};
  const ci={...base,id:90,run_attempt:2,head_sha:C,event:'push',path:'.github/workflows/ci.yml'};
  const jobs=contract.required_ci_jobs.map((name,index)=>({id:900+index,run_id:90,run_attempt:2,head_sha:C,status:'completed',conclusion:'success',name}));
  api[`${prefix}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${C}&per_page=100`]=[{workflow_runs:[ci]}];
  api[`${prefix}/actions/runs/90/attempts/2`]=ci;api[`${prefix}/actions/runs/90/attempts/2/jobs?per_page=100`]=[{jobs}];
  transition.controller_checks=verifyCorrectionChecks(repo,C,path=>api[path]);
  const certifierRun={...ci,id:92,head_sha:S};
  api[`${prefix}/actions/runs/92/attempts/2`]=certifierRun;api[`${prefix}/actions/runs/92/attempts/2/jobs?per_page=100`]=[{jobs:jobs.map(job=>({...job,id:job.id+20,run_id:92,head_sha:S}))}];
  const publisherRun={...ci,id:91,head_sha:P},publisherJobs=jobs.map(job=>({...job,id:job.id+10,run_id:91,head_sha:P}));
  api[`${prefix}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${P}&per_page=100`]=[{workflow_runs:[publisherRun]}];
  api[`${prefix}/actions/runs/91/attempts/2`]=publisherRun;api[`${prefix}/actions/runs/91/attempts/2/jobs?per_page=100`]=[{jobs:publisherJobs}];
  api[`${prefix}/git/ref/heads/main`]={object:{sha:P}};
  transition.publisher={head_sha:P,tree:PT,registry_sha256:sha256(JSON.stringify(publisherRegistry)),checks:verifyCorrectionChecks(repo,P,path=>api[path])};
  const {pin}=transition;
  const run={...base,id:pin.run_id,run_attempt:pin.run_attempt,head_sha:S,event:'workflow_dispatch',path:renewalPolicy.workflow,run_started_at:'2026-10-04T13:00:00Z'};
  const job={id:pin.job_id,name:renewalPolicy.job,run_id:pin.run_id,run_attempt:pin.run_attempt,head_sha:S,status:'completed',conclusion:'success',started_at:'2026-10-04T13:01:00Z',completed_at:'2026-10-04T13:40:00Z',steps:renewalPolicy.steps.map(name=>({name,conclusion:'success'}))};
  api[`${prefix}/actions/runs/${pin.run_id}/attempts/${pin.run_attempt}`]=run;
  api[`${prefix}/actions/runs/${pin.run_id}/attempts/${pin.run_attempt}/jobs?per_page=100`]=[{jobs:[job]}];
  const artifact={id:pin.artifact_id,name:pin.artifact_name,digest:`sha256:${pin.artifact_sha256}`,size_in_bytes:1000,expired:false,created_at:'2026-10-04T13:35:00Z',expires_at:'2026-10-10T00:00:00Z',workflow_run:{id:pin.run_id,head_sha:S,head_branch:'main'}};
  api[`${prefix}/actions/runs/${pin.run_id}/artifacts?per_page=100`]=[{artifacts:[artifact]}];
  return {api,review,run,job,artifact,jobs,read:path=>{assert.ok(Object.hasOwn(api,path),`Unexpected API ${path}`);return api[path];}};
}
function reseal(t){
  t.record.renewal_request_sha256=digest(t.request);t.record.request_sha256=digest(t.request.financial_request);t.record.source_delta_sha256=digest(t.source_delta);
  t.record_json=JSON.stringify(t.record);t.pin.candidate_record_sha256=sha256(t.record_json);t.pin.request_sha256=digest(t.request);
  t.intent.request_sha256=digest(t.request);t.intent.pin_sha256=digest(t.pin);
}
function transitionFor(root,live,bytes,baseBytes,index=1){
  const previous=live.financialRelease,projection=JSON.parse(bytes),source={...previous.lineage.source,run_attempt:previous.lineage.source.run_attempt+index,artifact_id:previous.lineage.source.artifact_id+index,artifact_sha256:sha256(`source${index}`),archive_manifest_sha256:sha256(`archive${index}`)};
  source.artifact_name=`financial-statement-recovery-${source.head_sha}-${source.run_attempt}`;
  const lineage=sourceLineage({source,certificate:previous.lineage.certificate,sourceProjectionSha256:sha256(bytes),receiptInventorySha256:projection.receipt_inventory_sha256,projectionPolicy:projection.policy});
  const request={schema_version:'financial-source-renewal-request-v1',previous_publication_identity:live.identity,previous_release:live.receipt.financial_release,previous_lineage_sha256:previous.lineage_sha256,
    previous_financial_generation:previous.financial_generation,origin_release:previous.renewal?.origin||live.receipt.financial_release,
    ui:{sha:live.uiSha,digest:live.uiDigest,approval_sha256:digest(live.approval)},consumer_code_sha256:H,
    financial_request:{schema_version:'financial-release-request-v1',correction:{schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,previous_publication_identity:live.identity,source},
      source_validation:{guard:'certified_source_artifact_v1',certificate:previous.lineage.certificate},destination_projection:{projector:'native_annual_destination_v1',policy:'financial-correction-native-annual-v1'}},
    target:{evaluated_at:sealed,base_sha256:sha256(baseBytes),manifest_sha256:live.manifestHash,price_observations_sha256:priceObservationDigest(live.priceObservations),known_price_dates_sha256:priceObservationDigest(live.knownPriceDates),universe_sha256:digest(live.verificationUniverse)},price_input:{...previous.price_input,manifest_sha256:live.manifestHash,price_observations_sha256:priceObservationDigest(live.priceObservations),known_price_dates_sha256:priceObservationDigest(live.knownPriceDates)},maximum_new_receipts:400};
  const sourceDelta={schema_version:'financial-statement-source-renewal-v1',status:'verified',evaluated_at:sealed,
    previous:{archive_manifest_sha256:previous.lineage.source.archive_manifest_sha256,projection_sha256:previous.source_projection.sha256,receipt_inventory_sha256:previous.lineage.receipt_inventory_sha256},
    current:{archive_manifest_sha256:source.archive_manifest_sha256,projection_sha256:sha256(bytes),receipt_inventory_sha256:projection.receipt_inventory_sha256},
    preserved:{objects:1,receipts:1,attempts:1},new_receipt_count:1,new_receipts:[{symbol:'OWNED',attribute:'quarterly_income_stmt',previous_receipt_sha256:'0'.repeat(64),receipt_sha256:H,capture_id:'synthetic-acquisition',observed_at:'2026-10-04T13:00:00Z',attempt_id:'synthetic:0001',attempt_completed_at:'2026-10-04T13:01:00Z',attempt_journal_sha256:H,plan_sha256:H,getter_completed_at:'2026-10-04T13:00:30Z',transport_payload_sha256:H,transport_evidence_sha256:H}],new_receipts_sha256:H,journal_sha256:[H],renewed_current_receipts:[H],unchanged_current_receipts:[]};
  sourceDelta.new_receipts_sha256=digest(sourceDelta.new_receipts);
  const history=financialAuditInventory(root),record={schema_version:renewalSchema,registry_sha256:H,certification_controller_sha256:H,producer:{repository:repo,workflow:renewalPolicy.workflow,head_sha:S,run_id:100+index,run_attempt:2},captured_ui:{sha:live.uiSha,tree:T,digest:live.uiDigest},
    request_sha256:H,preview_receipt_sha256:H,corrected_inventory_sha256:H,protected_code_sha256:H,transport_sha256:H,renewal_request_sha256:H,logical_data_inventory_sha256:inventoryDigest(dataInventory(root)),
    source_projection_sha256:sha256(bytes),source_base_sha256:sha256(baseBytes),receipt_inventory_sha256:projection.receipt_inventory_sha256,financial_generation:projection.financial_generation,source_delta_sha256:H,history_inventory_sha256:inventoryDigest(history),sealed_at:sealed};
  const pin={schema_version:'financial-source-renewal-pin-v1',repository:repo,workflow:renewalPolicy.workflow,head_sha:S,run_id:record.producer.run_id,run_attempt:2,job_id:1000+index,artifact_id:2000+index,artifact_name:`financial-source-renewal-${record.producer.run_id}-2`,artifact_sha256:H,candidate_record_sha256:H,request_sha256:H};
  const intent={schema_version:'financial-source-renewal-intent-v1',kind:'same-ui-same-price-financial-source-renewal',request_sha256:H,pin_sha256:H,previous_publication_identity:live.identity,not_after:'2026-10-07T10:00:00Z'};
  const transition={schema_version:'financial-source-renewal-transition-v1',controller_sha:C,controller_checks:contract.required_ci_jobs.map(name=>({name})),request,pin,intent,record,record_json:'',previous_lineage_sha256:previous.lineage_sha256,next_lineage:lineage.value,next_lineage_sha256:lineage.id,history_inventory:history,source_delta:sourceDelta};
  reseal(transition);return transition;
}
function fixture(){
  const f=lifecycleFixture();f.seed();const root=f.liveRoot,publication=read(join(root,'publication.json')),prior=read(join(root,publication.financial_release.path));
  const live=liveFrom(root,prior,publication.financial_release);
  const next=structuredClone(f.original.value);next.financial_generation=sha256('renewed projection');next.financial_evaluated_at=sealed;
  const receipt=next.receipt_inventory[0];receipt.capture_id='synthetic-renewed-quarterly';receipt.receipt_sha256=sha256('synthetic-new-journal-receipt');receipt.observed_at='2026-10-04T13:00:00Z';
  next.symbols.OWNED.financial_current.t=Date.parse(sealed);
  for(const tuple of Object.values(next.symbols.OWNED.financial_current.p))if(tuple[1]!=='3'){tuple[4]=Date.parse(receipt.observed_at);tuple[5]=tuple[4]+7*86400000;}
  next.symbols.OWNED.financial_history.quarterly_retrieved_at=receipt.observed_at;
  next.symbols.OWNED.source_receipts[0]={...receipt};delete next.symbols.OWNED.source_receipts[0].symbol;
  next.receipt_inventory_sha256=digest(next.receipt_inventory);next.derivation.source_receipt_inventory_sha256=next.receipt_inventory_sha256;
  const bytes=JSON.stringify(next),base=f.original.base,transition=transitionFor(root,live,bytes,base),evidence=authority(transition);evidence.originBytes=readFileSync(join(root,transition.request.origin_release.path));
  return {...f,root,live,next,bytes,base,transition,evidence,cleanup:f.cleanup};
}

test('legacy manual registries retain their literal bytes and original later-attempt authority',()=>{
  const f=fixture();try{
    const old={...renewalPolicy};delete old.ci_admission;const bytes=JSON.stringify(old);
    assert.equal(validateRenewalRegistry(old),old);assert.equal(JSON.stringify(old),bytes);
    assert.throws(()=>validateRenewalRegistry({...old,unexpected:null}),/closed/);
    const evidence=authority(f.transition,null,{legacyRegistry:true});
    const options={api:evidence.read,reviewedControllers:[evidence.review],originBytes:f.evidence.originBytes,now};
    verifyRenewalAuthority(f.transition,options);assert.equal(evidence.run.event,'workflow_dispatch');assert.equal(evidence.run.run_attempt,2);
    for(const revision of [C,S,P])assert.equal(Object.hasOwn(JSON.parse(Buffer.from(evidence.api[`${prefix}/contents/contracts/financial_source_renewal_v1.json?ref=${revision}`].content,'base64')),'ci_admission'),false);
    evidence.run.event='workflow_run';assert.throws(()=>verifyRenewalAuthority(f.transition,options),/certification run/);
  }finally{f.cleanup();}
});
test('CI admission metadata changes cannot use the manual append-only path',()=>{
  const before={...renewalPolicy,ci_admission:null},certify={...before,ci_admission:{phase:'certify',reviewed_commit:S,reviewed_tree:T,controls:{request:H}}};
  validateRenewalRegistry(certify);assert.throws(()=>assertRenewalRegistryAppendOnly(before,certify),/proof|admission/);
  const publish={...certify,ci_admission:{phase:'publish',reviewed_commit:C,reviewed_tree:CT,controls:{request:H,pin:H,intent:H}}};
  assert.throws(()=>assertRenewalRegistryAppendOnly(certify,publish),/proof|admission/);
  assertRenewalRegistryAppendOnly(before,{...before,publication_enabled:true});
});
test('prepared automatic authority cannot be requested for an old manual transition',async()=>{
  const f=fixture();try{await assert.rejects(()=>verifyPreparedAutomaticRenewal({mode:'renewal'},f.transition),/exact active producer/);}finally{f.cleanup();}
});

test('production renewal registry stays closed and legacy activation entrypoints reject ambient enable claims',()=>{
  assert.equal(validateRenewalRegistry(renewalPolicy),renewalPolicy);
  const root=temp();try{
    assert.deepEqual(assertRenewalPublicationDisabled(root),{request:null,pin:null,intent:null});
    assert.throws(()=>assertRenewalPublicationDisabled(root,'anything'),/disabled/);
    const script=fileURLToPath(new URL('./financial-source-renewal.mjs',import.meta.url));
    const result=spawnSync(process.execPath,[script,'activate'],{cwd:root,encoding:'utf8',env:{...process.env,FINANCIAL_SOURCE_RENEWAL_ENABLED:'true'}});
    assert.equal(result.status,1);assert.match(result.stderr,/disabled/);
    write(join(root,'event.json'),{inputs:{financial_source_renewal:'{}'}});
    const release=fileURLToPath(new URL('./select-release-source.mjs',import.meta.url));
    const plan=spawnSync(process.execPath,[release,'plan'],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_EVENT_PATH:join(root,'event.json'),RUNNER_TEMP:root}});
    assert.equal(plan.status,1);assert.match(plan.stderr,/disabled|exclusive typed manual mode/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('sealed renewal verifies exact reviewed tree, request, explicit intent, CI and certification attempt',()=>{
  const f=fixture();try{
    const t=f.transition;for(const [parse,value]of [[parseRenewalRequest,t.request],[parseRenewalPin,t.pin],[parseRenewalIntent,t.intent],[validateRenewalCandidate,t.record],[validateRenewalTransition,t]]){
      parse(value);assert.throws(()=>parse({...value,unexpected:true}),/closed/);
    }
    assert.throws(()=>verifyRenewalAuthority(t,{api:f.evidence.read,now}),/not independently reviewed/);
    const options={api:f.evidence.read,reviewedControllers:[f.evidence.review],now,originBytes:f.evidence.originBytes};verifyRenewalAuthority(t,options);
    for(const mutate of [v=>v.record.captured_ui.digest='9'.repeat(64),v=>v.pin.run_attempt++,v=>v.pin.head_sha=C,v=>v.intent.pin_sha256=H,v=>v.request.financial_request.correction.source.artifact_id++,v=>v.record.sealed_at='2026-10-04T12:00:00Z']){
      assert.throws(()=>verifyRenewalAuthority(mutation(t,mutate),options));
    }
    for(const [obj,key,bad]of [[f.evidence.run,'run_attempt',3],[f.evidence.run,'conclusion','failure'],[f.evidence.job,'head_sha',C],[f.evidence.artifact,'id',-1],[f.evidence.jobs[0],'conclusion','failure'],[f.evidence.jobs[0],'run_id',91],[f.evidence.jobs[0],'head_sha',S]]){
      const saved=obj[key];obj[key]=bad;assert.throws(()=>verifyRenewalAuthority(t,options));obj[key]=saved;
    }
    f.evidence.job.steps.push({name:renewalPolicy.steps[0],conclusion:'failure'});assert.throws(()=>verifyRenewalAuthority(t,options),/steps/);f.evidence.job.steps.pop();
    f.evidence.job.steps.pop();assert.throws(()=>verifyRenewalAuthority(t,options),/steps/);
    const partial=structuredClone(t.source_delta);partial.unchanged_current_receipts=Array.from({length:5000},(_,i)=>sha256(`unchanged-${i}`));partial.preserved.receipts=5000;validateSourceRenewalDelta(partial);
  }finally{f.cleanup();}
});
test('expiry at release recheck rejects the sealed candidate while historical authority survives artifact expiry',()=>{
  const f=fixture();try{
    const options={api:f.evidence.read,reviewedControllers:[f.evidence.review],originBytes:f.evidence.originBytes,now:Date.parse('2026-10-08T00:00:00Z')};
    assert.throws(()=>verifyRenewalAuthority(f.transition,options),/intent expired/);
    f.evidence.artifact.expired=true;verifyRenewalAuthority(f.transition,{...options,historical:true});
    const endpoint=`${prefix}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${C}&per_page=100`;
    f.evidence.api[endpoint]=[{workflow_runs:[]}];verifyRenewalAuthority(f.transition,{...options,historical:true});
  }finally{f.cleanup();}
});
test('closed renewal request binds the same canonical evaluation through its source delta and historical transition',()=>{
  const f=fixture();try{
    for(const mutate of [v=>delete v.target.evaluated_at,v=>v.target.evaluated_at='2026-10-04T13:30:00Z',v=>v.target.extra=true]){
      assert.throws(()=>parseRenewalRequest(mutation(f.transition.request,mutate)));
    }
    const changed=mutation(f.transition,t=>{t.request.target.evaluated_at='2026-10-04T13:29:59.999Z';reseal(t);});
    assert.throws(()=>validateRenewalTransition(changed),/binding changed/);
    const futureObservation=mutation(f.transition.source_delta,v=>{v.new_receipts[0].observed_at='2026-10-04T13:30:00.001Z';v.new_receipts_sha256=digest(v.new_receipts);});
    assert.throws(()=>validateSourceRenewalDelta(futureObservation),/acquisition clocks/);
    const options={api:f.evidence.read,reviewedControllers:[f.evidence.review],originBytes:f.evidence.originBytes,historical:true,now:Date.parse('2030-01-01T00:00:00Z')};
    verifyRenewalAuthority(f.transition,options);
  }finally{f.cleanup();}
});
test('predecessor race, changed dates/prices/universe, UI and prior lineage all reject renewal',()=>{
  const f=fixture();try{
    verifyRenewalPredecessor(f.transition.request,f.live);
    for(const mutate of [v=>v.identity=`31/1/${H}/${H}`,v=>v.uiSha=C,v=>v.uiFiles['index.html']=H,v=>v.manifestHash=H,v=>v.priceObservations['["US","chart","OWNED"]']='2026-10-05',v=>v.knownPriceDates['["US","chart","OWNED"]']='2026-10-05',v=>v.verificationUniverse.total=2,v=>v.financialRelease.lineage_sha256=H,v=>v.financialRelease.financial_generation=H]){
      assert.throws(()=>verifyRenewalPredecessor(f.transition.request,mutation(f.live,mutate)));
    }
    for(const mutate of [v=>v.source_delta.new_receipt_count=0,v=>v.source_delta.renewed_current_receipts=[],v=>v.source_delta.current.receipt_inventory_sha256=H,v=>v.record.financial_generation=v.request.previous_financial_generation]){
      const changed=mutation(f.transition,mutate);reseal(changed);assert.throws(()=>validateRenewalTransition(changed));
    }
  }finally{f.cleanup();}
});
test('audit bytes append, preserve original authority through next-price carry, and accept a second chained renewal',async()=>{
  const f=fixture();try{
    const originalHistory=financialAuditInventory(f.root),first=await writeRenewalRelease({dist:f.root,live:f.live,transition:f.transition,sourceProjectionBytes:f.bytes,sourceBaseBytes:f.base,priceInput:f.transition.request.price_input});
    assert.equal(first.receipt.schema_version,'financial-release-receipt-v2');assert.equal(first.receipt.mode,'renewal');
    assertRetainedFinancialHistory(originalHistory,financialAuditInventory(f.root));
    verifyFinancialReleaseAssets(f.root,first.reference);
    for(const mutate of [v=>v.price_input.manifest_sha256=H,v=>v.price_input.price_observations_sha256=H,v=>v.price_input.artifact_id++,v=>v.evaluated_at='2099-01-01T00:00:00Z',v=>v.ui.digest=H,v=>v.ui.approval.sha=C])assert.throws(()=>inspectRenewalChain(mutation(first.receipt,mutate),path=>readFileSync(join(f.root,path))));
    const readAsset=path=>readFileSync(join(f.root,path));
    assert.equal(inspectRenewalChain(first.receipt,readAsset).origin.lineage_sha256,f.live.financialRelease.lineage_sha256);
    await verifyPublishedRenewal(first.receipt,{readAsset,api:f.evidence.read,reviewedControllers:[f.evidence.review],now});
    await assert.rejects(()=>verifyPublishedRenewal(first.receipt,{readAsset,api:f.evidence.read}),/not independently reviewed/);
    const publicationPath=join(f.root,'publication.json'),savedPublication=readFileSync(publicationPath),publication=JSON.parse(savedPublication);
    Object.assign(publication,{financial_audit_files:financialAuditInventory(f.root),financial_release:first.reference,financial_generation:first.receipt.financial_generation,financial_lineage_sha256:first.receipt.lineage_sha256,data_inventory_sha256:inventoryDigest(dataInventory(f.root))});write(publicationPath,publication);
    const stateModule=fileURLToPath(new URL('./publication-state.mjs',import.meta.url));
    const blocked=f.invoke('--input-type=module',['-e',`import {livePublication} from ${JSON.stringify(stateModule)}; await livePublication();`],f.root,{FINANCIAL_SOURCE_RENEWAL_ENABLED:'true'});
    assert.equal(blocked.status,1);assert.match(blocked.stderr,/not independently reviewed/);writeFileSync(publicationPath,savedPublication);
    const live=liveFrom(f.root,first.receipt,first.reference,40);
    const target=JSON.parse(f.base);target.as_of_date='2026-10-05';for(const row of target.rows){row.as_of_date=target.as_of_date;row.current_price=120;}
    const targetBytes=JSON.stringify(target),carry=createFinancialGenerationCarry({sourceProjection:f.bytes,sourceProjectionSha256:sha256(f.bytes),sourceBase:f.base,sourceBaseSha256:sha256(f.base),sourceLineage:first.receipt.lineage_sha256,previousPublicationIdentity:live.identity,targetBase:targetBytes,targetBaseSha256:sha256(targetBytes),evaluatedAt:'2026-10-06T12:00:00Z'});
    assert.equal(carry.bindings.source_lineage_sha256,first.receipt.lineage_sha256);
    const carried=writeFinancialReleaseReceipt({dist:f.root,mode:'carry',previousIdentity:live.identity,lineage:{id:first.receipt.lineage_sha256,value:first.receipt.lineage},sourceProjectionBytes:f.bytes,sourceBaseBytes:f.base,evaluationBytes:JSON.stringify(carry),generation:carry.financial_generation,evaluatedAt:carry.financial_evaluated_at,ui:first.receipt.ui,priceInput:first.receipt.price_input,renewal:first.receipt.renewal});
    assertFinancialLineageContinuity({financialRelease:first.receipt},carried.receipt);verifyFinancialReleaseAssets(f.root,carried.reference);
    assert.throws(()=>assertFinancialLineageContinuity({financialRelease:first.receipt},mutation(carried.receipt,v=>delete v.renewal)),/carried renewal/);
    const carriedLive=liveFrom(f.root,carried.receipt,carried.reference,50),next={...f.next,financial_generation:sha256('second renewed generation'),financial_evaluated_at:sealed};
    next.receipt_inventory=mutation(f.next.receipt_inventory,v=>v[1].capture_id='synthetic-second-acquisition');next.receipt_inventory_sha256=digest(next.receipt_inventory);next.derivation.source_receipt_inventory_sha256=next.receipt_inventory_sha256;
    const nextBytes=JSON.stringify(next),secondTransition=transitionFor(f.root,carriedLive,nextBytes,targetBytes,2);authority(secondTransition);
    const second=await writeRenewalRelease({dist:f.root,live:carriedLive,transition:secondTransition,sourceProjectionBytes:nextBytes,sourceBaseBytes:targetBytes,priceInput:secondTransition.request.price_input});
    const inspected=inspectRenewalChain(second.receipt,readAsset);assert.equal(inspected.transitions.length,2);assert.deepEqual(inspected.origin,f.live.financialRelease);
    assert.equal(second.receipt.renewal.origin.sha256,f.live.receipt.financial_release.sha256);verifyFinancialReleaseAssets(f.root,second.reference);
    const saved=readFileSync(join(f.root,f.live.financialRelease.source_projection.path));writeFileSync(join(f.root,f.live.financialRelease.source_projection.path),'mutated');
    assert.throws(()=>inspectRenewalChain(second.receipt,readAsset),/history changed/);writeFileSync(join(f.root,f.live.financialRelease.source_projection.path),saved);
    const restored=temp();try{await restorePublishedFinancialSource(liveFrom(f.root,second.receipt,second.reference,60),restored,async url=>({ok:true,arrayBuffer:async()=>readAsset(new URL(url).pathname.split('/screener/')[1])}));assert.equal(inspectRenewalChain(second.receipt,path=>readFileSync(join(restored,path))).transitions.length,2);}finally{rmSync(restored,{recursive:true,force:true});}
  }finally{f.cleanup();}
});
test('first renewal after a v1 carry keeps the explicitly retained original activation anchor',async()=>{
  const f=fixture();try{
    const projection=createFinancialGenerationCarry({sourceProjection:f.original.bytes,sourceProjectionSha256:sha256(f.original.bytes),sourceBase:f.base,sourceBaseSha256:sha256(f.base),sourceLineage:f.live.financialRelease.lineage_sha256,previousPublicationIdentity:f.live.identity,targetBase:f.base,targetBaseSha256:sha256(f.base),evaluatedAt:'2026-10-04T12:10:00Z'});
    const carried=writeFinancialReleaseReceipt({dist:f.root,mode:'carry',previousIdentity:f.live.identity,lineage:{id:f.live.financialRelease.lineage_sha256,value:f.live.financialRelease.lineage},sourceProjectionBytes:f.original.bytes,sourceBaseBytes:f.base,evaluationBytes:JSON.stringify(projection),generation:projection.financial_generation,evaluatedAt:projection.financial_evaluated_at,ui:f.live.financialRelease.ui,priceInput:f.live.financialRelease.price_input});
    const live=liveFrom(f.root,carried.receipt,carried.reference,35),transition=transitionFor(f.root,live,f.bytes,f.base);
    transition.request.origin_release=f.live.receipt.financial_release;authority(transition);
    verifyRenewalPredecessor(transition.request,live);
    const renewed=await writeRenewalRelease({dist:f.root,live,transition,sourceProjectionBytes:f.bytes,sourceBaseBytes:f.base,priceInput:transition.request.price_input});
    assert.deepEqual(inspectRenewalChain(renewed.receipt,path=>readFileSync(join(f.root,path))).origin,f.live.financialRelease);
    assert.equal(renewed.receipt.renewal.origin.sha256,f.live.receipt.financial_release.sha256);
    assert.notEqual(renewed.receipt.renewal.origin.sha256,carried.reference.sha256);
  }finally{f.cleanup();}
});
test('archive capacity, symlink, missing intent and mutated history fail closed',()=>{
  const root=temp();try{
    writeFileSync(join(root,'large'),'');truncateSync(join(root,'large'),8589934593);assert.throws(()=>assertRenewalCapacity(root),/capacity/);rmSync(join(root,'large'));
    symlinkSync('/etc/passwd',join(root,'linked'));assert.throws(()=>assertRenewalCapacity(root),/Linked/);
    const path=`static-data/financial-corrections/source-base-${H}.json`;assert.throws(()=>assertRetainedFinancialHistory({[path]:H},{}),/removed/);
    assert.throws(()=>parseRenewalIntent(null),/closed/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

// Synthetic API dependencies are direct test arguments. No public input can
// replace the production registry or establish controller trust.
test('staged registry prevents self-reference and binds current main, scope and append-only authority',()=>{
  const f=fixture();try{
    const {transition:t,evidence:e}=f,options={api:e.read,reviewedControllers:[e.review],now,originBytes:e.originBytes};
    verifyRenewalAuthority(t,options);
    const registryEndpoint=`${prefix}/contents/contracts/financial_source_renewal_v1.json?ref=${P}`;
    const original=e.api[registryEndpoint];
    const content=value=>{const bytes=Buffer.from(JSON.stringify(value));return {type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')};};
    const registry=JSON.parse(Buffer.from(original.content,'base64'));
    for(const modify of [value=>value.reviewed_controllers[0].controller_sha=S,value=>value.reviewed_controllers[0].request_sha256=H,value=>value.maximum_new_receipts++,value=>value.publication_enabled=false]){
      const changed=structuredClone(registry);modify(changed);e.api[registryEndpoint]=content(changed);
      assert.throws(()=>verifyRenewalAuthority(t,options),/registry|policy/);e.api[registryEndpoint]=original;
    }
    const main=e.api[`${prefix}/git/ref/heads/main`];e.api[`${prefix}/git/ref/heads/main`]={object:{sha:C}};
    assert.throws(()=>verifyRenewalAuthority(t,options),/exact current main/);e.api[`${prefix}/git/ref/heads/main`]=main;
    const jobs=e.api[`${prefix}/actions/runs/91/attempts/2/jobs?per_page=100`][0].jobs;
    jobs[0].conclusion='failure';assert.throws(()=>verifyRenewalAuthority(t,options),/CI job changed/);jobs[0].conclusion='success';
    const trustEndpoint=`${prefix}/contents/contracts/financial_source_certification_trust_v1.json?ref=${P}`,trust=e.api[trustEndpoint];
    e.api[trustEndpoint]=content({files:{changed:true},reviewed_requests:[]});assert.throws(()=>verifyRenewalAuthority(t,options),/sealed source trust/);e.api[trustEndpoint]=trust;
    delete e.api[`${prefix}/git/ref/heads/main`];delete e.api[`${prefix}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${P}&per_page=100`];
    delete e.api[`${prefix}/actions/runs/${t.pin.run_id}/artifacts?per_page=100`];
    verifyRenewalAuthority(t,{...options,historical:true,now:Date.parse('2026-12-01T00:00:00Z')});
  }finally{f.cleanup();}
});

test('ordinary carry remains independent of removed current intent; renewal dispatch still needs every control',()=>{
  const f=fixture(),root=temp();try{
    write(join(root,renewalPolicy.request_path),f.transition.request);write(join(root,renewalPolicy.pin_path),f.transition.pin);
    assert.equal(selectRenewalControls({root}),null);
    assert.throws(()=>selectRenewalControls({root,input:JSON.stringify(f.transition.intent),eventName:'workflow_dispatch'}),/complete committed request, pin and explicit intent/);
    write(join(root,renewalPolicy.intent_path),f.transition.intent);
    for(const registry of [disabledRenewalRegistry(),{...disabledRenewalRegistry(),publication_enabled:true}]){
      write(join(root,'contracts/financial_source_renewal_v1.json'),registry);
      assert.throws(()=>selectRenewalControls({root,input:JSON.stringify(f.transition.intent),eventName:'workflow_dispatch'}),/disabled: no exact reviewed controller authority/);
    }
    for(const key of ['request','pin','intent'])rmSync(join(root,renewalPolicy[`${key}_path`]));
    assert.equal(selectRenewalControls({root}),null);
  }finally{f.cleanup();rmSync(root,{recursive:true,force:true});}
});

test('populated finite consumer transition stays hash-bound through a historical carry after current controls disappear',async()=>{
  const f=fixture(),controls=temp();try{
    const entry=reviewedMain135ConsumerTransition(),origin=structuredClone(f.live.financialRelease);
    // Synthetic activation seed with this catalog's captured UI identity. The
    // real-origin performance-v2 approval is covered by the actual Pages test.
    origin.ui.approved_sha=entry.captured_ui_sha;origin.ui.captured_sha=entry.captured_ui_sha;
    origin.ui.approval.sha=entry.captured_ui_sha;for(const check of origin.ui.checks)check.head_sha=entry.captured_ui_sha;
    origin.candidate.head_sha=entry.captured_ui_sha;
    const originBytes=Buffer.from(JSON.stringify(origin)),sum=sha256(originBytes),reference={schema_version:origin.schema_version,path:`static-data/financial-corrections/release-${sum}.json`,sha256:sum};
    write(join(f.root,reference.path),originBytes.toString());
    const live=liveFrom(f.root,origin,reference),transition=transitionFor(f.root,live,f.bytes,f.base),evidence=authority(transition,entry);
    const options={api:evidence.read,reviewedControllers:[evidence.review],now,originBytes};
    verifyRenewalAuthority(transition,options);
    const renewed=await writeRenewalRelease({dist:f.root,live,transition,sourceProjectionBytes:f.bytes,sourceBaseBytes:f.base,priceInput:transition.request.price_input});
    const renewedLive=liveFrom(f.root,renewed.receipt,renewed.reference,31);
    const carried=createFinancialGenerationCarry({sourceProjection:f.bytes,sourceProjectionSha256:sha256(f.bytes),sourceBase:f.base,sourceBaseSha256:sha256(f.base),sourceLineage:renewed.receipt.lineage_sha256,
      previousPublicationIdentity:renewedLive.identity,targetBase:f.base,targetBaseSha256:sha256(f.base),evaluatedAt:'2026-10-04T14:00:00Z'});
    const carry=writeFinancialReleaseReceipt({dist:f.root,mode:'carry',previousIdentity:renewedLive.identity,lineage:{id:renewed.receipt.lineage_sha256,value:renewed.receipt.lineage},
      sourceProjectionBytes:f.bytes,sourceBaseBytes:f.base,evaluationBytes:JSON.stringify(carried),generation:carried.financial_generation,evaluatedAt:carried.financial_evaluated_at,
      ui:renewed.receipt.ui,priceInput:renewed.receipt.price_input,renewal:renewed.receipt.renewal});
    for(const key of ['request','pin','intent'])write(join(controls,renewalPolicy[`${key}_path`]),transition[key]);
    for(const key of ['request','pin','intent'])rmSync(join(controls,renewalPolicy[`${key}_path`]));
    assert.equal(selectRenewalControls({root:controls}),null);
    delete evidence.api[`${prefix}/git/ref/heads/main`];delete evidence.api[`${prefix}/actions/runs/${transition.pin.run_id}/artifacts?per_page=100`];
    await verifyPublishedRenewal(carry.receipt,{readAsset:path=>readFileSync(join(f.root,path)),api:evidence.read,reviewedControllers:[evidence.review],now:Date.parse('2030-01-01T00:00:00Z')});
    const endpoint=`${prefix}/contents/contracts/financial_source_renewal_v1.json?ref=${S}`,saved=evidence.api[endpoint],changed=JSON.parse(Buffer.from(saved.content,'base64'));
    changed.reviewed_consumer_transitions=[];const bytes=Buffer.from(JSON.stringify(changed));evidence.api[endpoint]={type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')};
    await assert.rejects(()=>verifyPublishedRenewal(carry.receipt,{readAsset:path=>readFileSync(join(f.root,path)),api:evidence.read,reviewedControllers:[evidence.review],now}),/consumer policy|registry bytes/);
  }finally{f.cleanup();rmSync(controls,{recursive:true,force:true});}
});

test('retained initial request stays satisfied after renewal so next price carry cannot re-activate the origin',()=>{
  const source={artifact_sha256:H},certificate={artifact_sha256:H},request={correction:{source},source_validation:{certificate}};
  const origin={mode:'activation',lineage:{source,certificate}},active={mode:'renewal',lineage:{source:{artifact_sha256:'9'.repeat(64)},certificate},renewal:{origin:{}}};
  assert.equal(isFinancialRequestActive(request,{financialRelease:active,financialOrigin:origin}),true);
  assert.equal(isFinancialRequestActive({...request,correction:{source:{artifact_sha256:'8'.repeat(64)}}},{financialRelease:active,financialOrigin:origin}),false);
  assert.equal(isFinancialRequestActive(request,{financialRelease:{...active,renewal:null},financialOrigin:origin}),false);
});

test('renewal origin remains verifiable after two fresh-directory ordinary audit carries',async()=>{
  const f=fixture(),scratch=temp();try{
    let previous=f.live,previousRoot=f.root;
    for(let index=1;index<=2;index++){
      const root=join(scratch,`carry-${index}`);cpSync(f.root,root,{recursive:true});rmSync(join(root,'static-data/financial-corrections'),{recursive:true});
      await restorePublishedFinancialSource(previous,root,async url=>({ok:true,arrayBuffer:async()=>readFileSync(join(previousRoot,new URL(url).pathname.split('/screener/')[1]))}));
      const carry=createFinancialGenerationCarry({sourceProjection:f.original.bytes,sourceProjectionSha256:sha256(f.original.bytes),sourceBase:f.base,sourceBaseSha256:sha256(f.base),
        sourceLineage:previous.financialRelease.lineage_sha256,previousPublicationIdentity:previous.identity,targetBase:f.base,targetBaseSha256:sha256(f.base),evaluatedAt:`2026-10-04T12:${index}0:00Z`});
      const written=writeFinancialReleaseReceipt({dist:root,mode:'carry',previousIdentity:previous.identity,lineage:{id:previous.financialRelease.lineage_sha256,value:previous.financialRelease.lineage},
        sourceProjectionBytes:f.original.bytes,sourceBaseBytes:f.base,evaluationBytes:JSON.stringify(carry),generation:carry.financial_generation,evaluatedAt:carry.financial_evaluated_at,ui:previous.financialRelease.ui,priceInput:previous.financialRelease.price_input});
      previous=liveFrom(root,written.receipt,written.reference,31+index);previous.receipt.financial_audit_files=financialAuditInventory(root);previousRoot=root;
      assert.equal(sha256(readFileSync(join(root,f.live.receipt.financial_release.path))),f.live.receipt.financial_release.sha256);
    }
    const transition=transitionFor(previousRoot,previous,f.bytes,f.base);transition.request.origin_release=f.live.receipt.financial_release;authority(transition);
    const renewed=await writeRenewalRelease({dist:previousRoot,live:previous,transition,sourceProjectionBytes:f.bytes,sourceBaseBytes:f.base,priceInput:transition.request.price_input});
    assert.deepEqual(inspectRenewalChain(renewed.receipt,path=>readFileSync(join(previousRoot,path))).origin,f.live.financialRelease);
    assertRetainedFinancialHistory(previous.receipt.financial_audit_files,financialAuditInventory(previousRoot));
  }finally{f.cleanup();rmSync(scratch,{recursive:true,force:true});}
});

test('consumer policy metadata exclusion cannot change the original ordinary activation policy',()=>{
  const f=fixture();try{
    const path='contracts/financial_performance_exception_v2.json',bytes=Buffer.from(JSON.stringify({schema_version:'financial-performance-exception-policy-v2',enabled:false,capture:null}));
    const content=value=>({type:'file',encoding:'base64',size:value.length,content:value.toString('base64')});
    const api={[`${prefix}/contents/${path}?ref=${S}`]:content(bytes),[`${prefix}/contents/${path}?ref=${C}`]:content(bytes),
      [`${prefix}/contents/contracts/financial_source_renewal_v1.json?ref=${C}`]:content(Buffer.from(JSON.stringify(disabledRenewalRegistry())))};
    const options={request:f.transition.request,certificationSha:C,originBytes:readFileSync(join(f.root,f.transition.request.origin_release.path)),publishedCode:{[path]:{mode:'100644',sha:S}},api:endpoint=>api[endpoint]};
    verifyRenewalInitialCapturePolicy(options);
    const code={'frontend/tools/production-bootstrap-diagnostic.mjs':{mode:'100644',sha:S}};
    const ordinary=verifyRenewalInitialCapturePolicy({...options,request:{...options.request,consumer_code_sha256:digest(consumerCodeInventory(code))}});
    assert.equal(ordinary.verifyConsumerCode(code,code),true);
    assert.throws(()=>ordinary.verifyConsumerCode(code,mutation(code,v=>v['frontend/tools/production-bootstrap-diagnostic.mjs'].sha=C)),/published consumer/);
    api[`${prefix}/contents/${path}?ref=${C}`]=content(Buffer.from(JSON.stringify({enabled:true,capture:'changed'})));
    assert.throws(()=>verifyRenewalInitialCapturePolicy(options),/exact original v2 activation policy/);
    assert.throws(()=>verifyRenewalInitialCapturePolicy({...options,originBytes:Buffer.from('{}')}),/exact retained anchor/);
  }finally{f.cleanup();}
});

test('v2 policy metadata is accepted only from its independently reverified original activation controller',async()=>{
  const f=await performanceLifecycleFixture({packedTransport:true,exceptionVersion:2});try{
    const publication=read(join(f.liveRoot,'publication.json')),originBytes=readFileSync(join(f.liveRoot,publication.financial_release.path));
    const policyPath='contracts/financial_performance_exception_v2.json',policyBytes=readFileSync(join(f.codeRoot,policyPath)),certifier='2'.repeat(40);
    const api=f.config.api;api[`${prefix}/contents/${policyPath}?ref=${f.ui.controller_sha}`]=f.content(policyBytes);api[`${prefix}/contents/${policyPath}?ref=${certifier}`]=f.content(policyBytes);
    api[`${prefix}/contents/contracts/financial_source_renewal_v1.json?ref=${certifier}`]=f.content(Buffer.from(JSON.stringify(disabledRenewalRegistry())));
    const helper=await import(pathToFileURL(join(f.codeRoot,'.github/scripts/financial-source-renewal.mjs')).href);
    const options={request:{ui:{sha:f.ui.sha},origin_release:publication.financial_release},certificationSha:certifier,originBytes,publishedCode:f.captured,api:endpoint=>{assert.ok(Object.hasOwn(api,endpoint),endpoint);return api[endpoint];}};
    helper.verifyRenewalInitialCapturePolicy(options);
    api[`${prefix}/contents/${policyPath}?ref=${certifier}`]=f.content(Buffer.from(JSON.stringify({...read(join(f.codeRoot,policyPath)),enabled:false,capture:null})));
    assert.throws(()=>helper.verifyRenewalInitialCapturePolicy(options),/exact original v2 activation policy/);
    api[`${prefix}/contents/${policyPath}?ref=${certifier}`]=f.content(policyBytes);
    const originalRequest=api[f.requestEndpoint];api[f.requestEndpoint]=f.content(Buffer.from('{}'));
    assert.throws(()=>helper.verifyRenewalInitialCapturePolicy(options));api[f.requestEndpoint]=originalRequest;
  }finally{f.cleanup();}
});

test('renewal reuses only exact originally reviewed v2 harness pairs without excluding any consumer path',async()=>{
  const f=await performanceLifecycleFixture({packedTransport:true,exceptionVersion:2,approvedHarnessChanges:true});try{
    const publication=read(join(f.liveRoot,'publication.json')),originBytes=readFileSync(join(f.liveRoot,publication.financial_release.path));
    const policyPath='contracts/financial_performance_exception_v2.json',policyBytes=readFileSync(join(f.codeRoot,policyPath)),certifier='2'.repeat(40),api=f.config.api;
    api[`${prefix}/contents/${policyPath}?ref=${f.ui.controller_sha}`]=f.content(policyBytes);api[`${prefix}/contents/${policyPath}?ref=${certifier}`]=f.content(policyBytes);
    api[`${prefix}/contents/contracts/financial_source_renewal_v1.json?ref=${certifier}`]=f.content(Buffer.from(JSON.stringify(disabledRenewalRegistry())));
    const helper=await import(pathToFileURL(join(f.codeRoot,'.github/scripts/financial-source-renewal.mjs')).href);
    const request={ui:{sha:f.ui.sha},origin_release:publication.financial_release,consumer_code_sha256:digest(consumerCodeInventory(f.captured))};
    const options={request,certificationSha:certifier,originBytes,api:endpoint=>{assert.ok(Object.hasOwn(api,endpoint),endpoint);return api[endpoint];}};
    const verified=helper.verifyRenewalInitialCapturePolicy(options);
    assert.notEqual(digest(consumerCodeInventory(f.current)),request.consumer_code_sha256,'the strict original inventory still detects all four differences');
    assert.equal(verified.verifyConsumerCode(f.captured,f.current),true);
    const paths=Object.keys(f.approval.controller_changes).filter(path=>path.startsWith('frontend/'));assert.equal(paths.length,4);
    for(const path of paths){
      assert.throws(()=>verified.verifyConsumerCode(f.captured,mutation(f.current,v=>v[path].sha='9'.repeat(40))),/originally reviewed harness pair/);
      assert.throws(()=>verified.verifyConsumerCode(f.captured,mutation(f.current,v=>delete v[path])),/originally reviewed harness pair/);
      assert.throws(()=>verified.verifyConsumerCode(f.captured,mutation(f.current,v=>v[path]=f.captured[path])),/originally reviewed harness pair/,'even reverting to the before hash is not the reviewed after pair');
      assert.throws(()=>verified.verifyConsumerCode(mutation(f.captured,v=>v[path].sha='8'.repeat(40)),f.current),/captured consumer/);
    }
    for(const path of ['frontend/src/static/transport/index.mjs','backend/app/scripts/export_native_annual_projection.py'])assert.throws(()=>verified.verifyConsumerCode(f.captured,mutation(f.current,v=>v[path].sha='9'.repeat(40))),/published consumer/);
    assert.throws(()=>verified.verifyConsumerCode(f.captured,{...f.current,'frontend/tools/new.test.mjs':{mode:'100644',sha:'9'.repeat(40)}}),/published consumer/);
    const missing=structuredClone(f.approval);delete missing.controller_changes[paths[0]];api[f.approvalEndpoint]=f.content(Buffer.from(JSON.stringify(missing)));
    assert.throws(()=>helper.verifyRenewalInitialCapturePolicy(options),/approval changed/);
    api[f.approvalEndpoint]=f.content(Buffer.from(JSON.stringify(f.approval)));
    assert.throws(()=>helper.verifyRenewalInitialCapturePolicy({...options,originBytes:Buffer.from('{}')}),/exact retained anchor/);
  }finally{f.cleanup();}
});
