import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,symlinkSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ORDINARY_CARRY as P,OCT10_ORDINARY_CARRY as LEGACY,OCT11_ORDINARY_CARRY_V2 as RETIRED,OCT11_ORDINARY_CARRY_V3,ORDINARY_ENTRY,HISTORY_PATH,ordinaryCarrySelected,selectOrdinaryCarryAdmission,assertOrdinaryClock,validateOrdinaryContext,ordinaryExporterBytes,withOrdinaryExporter,materializeOrdinaryHistory,validateOrdinaryCarryReceipt,assertOrdinaryReceiptBinding,completeOrdinaryComposition,ordinaryAwaitSnapshot,beginOrdinaryComposition} from './ordinary-carry-tooling.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),clone=v=>structuredClone(v),h='a'.repeat(64),g='b'.repeat(40),now=Date.parse('2026-10-11T05:00:00.000Z');
function selectionState(identity=P){return {source:{artifact:{id:identity.source.artifact_id}}};}
function fixture(){
  const context={controller:{head:g,tree:'c'.repeat(40)},caller:{run_id:101,run_attempt:1,job_id:102,started_at:'2026-10-11T04:15:00.000Z'},event:'workflow_dispatch',ui_only:true,now};
  const state={ordinaryCarryAdmission:{identity:clone(P),admitted_at:context.caller.started_at},controllerSha:g,decision:{publish:true,mode:'data'},sourceSha:P.ui_sha,carry:{},source:{runId:P.source.run_id,attempt:1,manifestHash:P.source.manifest_sha256,priceObservationsDigest:P.source.price_observations_sha256,manifest:{markets:{US:{as_of_date:P.source.as_of_date}}},artifact:{id:P.source.artifact_id,size_in_bytes:P.source.artifact_bytes,digest:'sha256:'+P.source.artifact_sha256,name:`static-site-data-${P.source.run_id}-1`,created_at:P.source.created_at,workflow_run:{id:P.source.run_id,head_sha:P.source.head_sha}}},live:{uiSha:P.ui_sha,uiDigest:P.ui_digest,identity:P.predecessor.identity,receiptHash:P.predecessor.receipt_sha256,receipt:{transport:{root:{sha256:P.predecessor.transport_root_sha256}}},financialRelease:{mode:'activation',lineage_sha256:P.predecessor.lineage_sha256,financial_generation:P.predecessor.generation,source_projection:{sha256:P.predecessor.source_projection_sha256},source_base:{sha256:P.predecessor.source_base_sha256}}},historyReconciliation:{admitted_observations:650,source_artifact_digest:'sha256:'+P.source.artifact_sha256}};
  return {state,context};
}
function receiptFixture(identity=P){
  const P=identity;
  const {context}=fixture(),date=P===LEGACY?'2026-10-10T10:10:00.000Z':P===RETIRED?'2026-10-11T02:10:00.000Z':'2026-10-11T04:20:00.000Z';
  if(P===LEGACY)context.caller.started_at='2026-10-10T10:00:00.000Z';
  if(P===RETIRED)context.caller.started_at='2026-10-11T02:05:00.000Z';
  const historyProof={schema_version:'candidate-history-reconciliation-v1',...Object.fromEntries(['predecessor_selection_sha256','predecessor_performance_sha256','selected_selection_sha256','selected_performance_sha256','output_selection_sha256','output_performance_sha256'].map(k=>[k,h])),published_observations:0,admitted_observations:650,cohorts:4,selections:5,source_artifact_digest:'sha256:'+P.source.artifact_sha256,predecessor_digest:P.predecessor.transport_root_sha256};
  const proofDigest=sha(JSON.stringify(Object.fromEntries(Object.entries(historyProof).sort(([a],[b])=>a.localeCompare(b)))));
  const inputs={...(P.admit_before?{admitted_at:context.caller.started_at}:{}),controller:context.controller,caller:context.caller,source:{artifact_sha256:P.source.artifact_sha256,tar_sha256:h,raw_static_inventory_sha256:h,source_history_present:false,manifest_sha256:P.source.manifest_sha256},predecessor_identity:P.predecessor.identity,history_reconciliation:historyProof,history_reconciliation_sha256:proofDigest,baseline_sha256:h,carry:{projection_sha256:h,target_base_sha256:h,generation:h,evaluated_at:date}};
  const history={schema_version:'ordinary-empty-history-derivation-v1',path:HISTORY_PATH,source_present:false,action:'materialize_empty_derived_container',as_of_date:P.source.as_of_date,baseline_sha256:sha(JSON.stringify({as_of_date:P.source.as_of_date,results:{}}))};
  const publication={controller_sha:g,run_id:101,run_attempt:1,data_source:{artifact_id:P.source.artifact_id,run_id:P.source.run_id,attempt:1},financial_release:{schema_version:'financial-release-receipt-v1',path:`static-data/financial-corrections/release-${h}.json`,sha256:h},financial_generation:h,financial_lineage_sha256:P.predecessor.lineage_sha256,ui_sha:P.ui_sha,ui_digest:P.ui_digest};
  const receipt={schema_version:P.admit_before?'ordinary-carry-tooling-receipt-v2':'ordinary-carry-tooling-receipt-v1',identity:P,inputs,history,prepared_at:date,bound_at:date,build:{started_at:date,finished_at:date,output_sha256:h},composed_at:date,...Object.fromEntries(['financial_release','financial_generation','financial_lineage_sha256','ui_sha','ui_digest'].map(k=>[k,publication[k]]))};publication.ordinary_carry_tooling=receipt;
  const state={ordinaryCarryTooling:{phase:'composed',inputs:clone(inputs),history:clone(history),prepared_at:date,bound_at:date,build:clone(receipt.build),receipt:clone(receipt)}};
  const financial={mode:'carry',evaluation_projection:{sha256:h},evaluated_at:date,financial_generation:h,lineage_sha256:P.predecessor.lineage_sha256,previous_publication_identity:P.predecessor.identity};
  return {receipt,publication,state,financial};
}
test('only exact source or existing binding selects bounded ordinary tooling',()=>{assert.equal(ordinaryCarrySelected(fixture().state),true);assert.equal(ordinaryCarrySelected({source:{artifact:{id:3}}}),false);assert.equal(ordinaryCarrySelected({ordinaryCarryTooling:{}}),true);});
test('exact isolated ordinary context validates',()=>{const f=fixture();assert.equal(validateOrdinaryContext(f.state,f.context),true);});
for(const [name,mutate]of [
 ['finite repair',s=>{s.source.repair={};}],['finite tooling',s=>{s.publisherTooling={};}],['recovery',s=>{s.sourceRecovery={};}],['correction',s=>{s.correction={};}],['activation',s=>{s.activation={};}],['renewal',s=>{s.renewal={};}],['preview',s=>{s.designCarryPreview={};}],['migration',s=>{s.decision.migration=true;}],['new UI',s=>{s.decision.mode='ui';}],['wrong source',s=>{s.source.artifact.id++;}],['changed source bytes',s=>{s.source.artifact.digest='sha256:'+h;}],['changed source time',s=>{s.source.artifact.created_at='2026-10-10T04:23:00Z';}],['changed target',s=>{s.source.manifest.markets.US.as_of_date='2026-10-12';}],['changed predecessor',s=>{s.live.identity+='0';}],['changed receipt',s=>{s.live.receiptHash=h;}],['changed UI bytes',s=>{s.live.uiDigest=h;}],['changed source lineage',s=>{s.live.financialRelease.lineage_sha256=h;}],['lost650',s=>{s.historyReconciliation.admitted_observations=649;}],
])test('context rejects '+name,()=>{const f=fixture();mutate(f.state);assert.throws(()=>validateOrdinaryContext(f.state,f.context));});
for(const [name,mutate]of [['UI-only false',c=>{c.ui_only=false;}],['automatic dispatch',c=>{c.event='workflow_run';}],['rerun',c=>{c.caller.run_attempt=2;}],['future start',c=>{c.caller.started_at='2026-10-11T06:00:00Z';}],['past authorization',c=>{c.now=Date.parse(P.not_before)-1;}],['expired authorization',c=>{c.now=Date.parse(P.not_after)+1;}],['unknown context authority',c=>{c.preview=true;}],['controller mismatch',c=>{c.controller.head='d'.repeat(40);}]])test('context rejects '+name,()=>{const f=fixture();mutate(f.context);assert.throws(()=>validateOrdinaryContext(f.state,f.context));});
test('window includes endpoints and rejects either outside clock',()=>{for(const t of [P.not_before,P.not_after])assert.equal(assertOrdinaryClock(Date.parse(t)),new Date(t).toISOString());for(const n of [NaN,Infinity,Date.parse(P.not_before)-1,Date.parse(P.not_after)+1])assert.throws(()=>assertOrdinaryClock(n));});
test('historical receipt remains readable after authorization expires',()=>{const f=receiptFixture(),old=Date.now;try{Date.now=()=>Date.parse('2026-11-01T00:00:00Z');assert.equal(validateOrdinaryCarryReceipt(f.receipt,f.publication),f.receipt);}finally{Date.now=old;}});
for(const [name,mutate]of [['extra authority',v=>{v.preview=true;}],['wrong identity',v=>{v.identity={...v.identity,role:'publisher'};}],['source history present',v=>{v.inputs.source.source_history_present=true;}],['changed source',v=>{v.inputs.source.artifact_sha256=h;}],['late completion',v=>{v.composed_at='2026-10-11T10:30:00.001Z';}],['future evaluation',v=>{v.inputs.carry.evaluated_at='2026-10-11T05:00:00Z';}],['changed UI digest',v=>{v.ui_digest=h;}],['invented history value',v=>{v.history.results={OWNED:123};}]])test('receipt rejects '+name,()=>{const f=receiptFixture();mutate(f.receipt);assert.throws(()=>validateOrdinaryCarryReceipt(f.receipt,f.publication));});
test('receipt is fully bound to authenticated state and actual financial release',()=>{const f=receiptFixture();assert.equal(assertOrdinaryReceiptBinding(f.state,f.publication,f.financial),true);});
for(const [name,mutate]of [['controller tree',v=>{v.inputs.controller.tree='d'.repeat(40);}],['job identity',v=>{v.inputs.caller.job_id=999;}],['target',v=>{v.inputs.carry.target_base_sha256='c'.repeat(64);}],['raw inventory',v=>{v.inputs.source.raw_static_inventory_sha256='c'.repeat(64);}],['baseline',v=>{v.inputs.baseline_sha256='c'.repeat(64);}],['build',v=>{v.build.output_sha256='c'.repeat(64);}]])test('forging both stored receipt copies cannot change '+name,()=>{const f=receiptFixture();mutate(f.receipt);f.state.ordinaryCarryTooling.receipt=clone(f.receipt);assert.throws(()=>assertOrdinaryReceiptBinding(f.state,f.publication,f.financial));});
test('receipt actual financial evaluation must match',()=>{const f=receiptFixture();f.financial.evaluation_projection.sha256='d'.repeat(64);assert.throws(()=>assertOrdinaryReceiptBinding(f.state,f.publication,f.financial));});
test('phase and fabricated offer cannot mint premature receipt',async()=>{const f=receiptFixture();f.state.ordinaryCarryTooling.phase='built';assert.throws(()=>assertOrdinaryReceiptBinding(f.state,f.publication,f.financial));await assert.rejects(completeOrdinaryComposition({},f.state,{}, {},f.publication,()=>P.ui_digest),/invocation/);});
// Reuse the existing immutable byte fixture, not any finite route authority.
const amendedFixture=readFileSync(new URL('./fixtures/publisher-export-research-oct6-carry-v1.mjs',import.meta.url),'utf8');
const original=Buffer.from(amendedFixture.replace('    canonicalChart=overlayFinancialChart(await read(paths.get(symbol)),correction,symbol);\n    if (!carry) canonicalChart=projectFinancialPayload(canonicalChart,{now:evaluatedAt,asOfDate:scan.as_of_date,market:row.market});','    canonicalChart=projectFinancialPayload(overlayFinancialChart(await read(paths.get(symbol)),correction,symbol),{now:evaluatedAt,asOfDate:scan.as_of_date,market:row.market});'));
function temporaryFrontend(){const root=mkdtempSync(join(tmpdir(),'ordinary-tooling-test-'));mkdirSync(join(root,'tools'));writeFileSync(join(root,'tools/export-research.mjs'),original);return root;}
test('exact original exporter yields exact reviewed amendment',()=>{assert.equal(sha(ordinaryExporterBytes(original)),P.temporary_exporter_sha256);assert.throws(()=>ordinaryExporterBytes(Buffer.concat([original,Buffer.from('\n')])));});
for(const mode of ['success','throw','await-mutate','await-replace','await-mode'])test('temporary exporter cleanup and identity: '+mode,async()=>{const frontend=temporaryFrontend();try{const call=()=>withOrdinaryExporter(frontend,async path=>{assert.equal(sha(readFileSync(path)),P.temporary_exporter_sha256);await Promise.resolve();if(mode==='throw')throw Error('export failed');if(mode==='await-mutate')writeFileSync(path,'changed');if(mode==='await-replace'){const bytes=readFileSync(path);rmSync(path);writeFileSync(path,bytes);}if(mode==='await-mode')chmodSync(path,0o755);return 'ok';});if(mode==='success')assert.equal(await call(),'ok');else await assert.rejects(call());assert(!existsSync(join(frontend,'tools',ORDINARY_ENTRY)));assert.equal(sha(readFileSync(join(frontend,'tools/export-research.mjs'))),P.original_exporter_sha256);}finally{rmSync(frontend,{recursive:true,force:true});}});
test('preexisting temporary exporter is rejected without overwrite',async()=>{const f=temporaryFrontend(),p=join(f,'tools',ORDINARY_ENTRY);try{writeFileSync(p,'occupied');await assert.rejects(withOrdinaryExporter(f,()=>{}));assert.equal(readFileSync(p,'utf8'),'occupied');}finally{rmSync(f,{recursive:true,force:true});}});
test('empty history derives only exact dated empty bytes and never overwrites',()=>{const root=mkdtempSync(join(tmpdir(),'ordinary-history-'));try{mkdirSync(join(root,'static-data'));const d=materializeOrdinaryHistory(root);assert.equal(d.baseline_sha256,sha(readFileSync(join(root,HISTORY_PATH))));assert.deepEqual(JSON.parse(readFileSync(join(root,HISTORY_PATH))),{as_of_date:P.source.as_of_date,results:{}});assert.throws(()=>materializeOrdinaryHistory(root));}finally{rmSync(root,{recursive:true,force:true});}});
test('empty history refuses linked parent',()=>{const root=mkdtempSync(join(tmpdir(),'ordinary-history-link-'));try{mkdirSync(join(root,'outside'));symlinkSync(join(root,'outside'),join(root,'static-data'));assert.throws(()=>materializeOrdinaryHistory(root));assert(!existsSync(join(root,'outside/financial-history.json')));}finally{rmSync(root,{recursive:true,force:true});}});
test('workflow isolates controller token and never reruns original exporter after ordinary build',()=>{
  const workflow=readFileSync(new URL('../workflows/research-ui-release.yml',import.meta.url),'utf8'),controller=readFileSync(new URL('./select-release-source.mjs',import.meta.url),'utf8');
  assert.match(workflow,/env.ORDINARY_CARRY_TOOLING == 'true'/);assert.match(workflow,/run: node \.github\/scripts\/select-release-source.mjs ordinary-carry-build/);
  assert.match(workflow,/env.ORDINARY_CARRY_TOOLING != 'true'/);assert.match(controller,/run\('tools\/check-data-quality.mjs'\)/);assert.match(workflow,/node tools\/check-data-quality.mjs/);
  const build=workflow.split('      - name: Build with daily selection export')[1].split('      - name:')[0];assert.doesNotMatch(build,/GH_TOKEN|GITHUB_TOKEN/);
  assert.match(controller,/for\(const key of \['GH_TOKEN','GITHUB_TOKEN'\]\)delete buildEnv\[key\]/);
  assert.match(controller,/process.execArgv.length\|\|process.env.NODE_OPTIONS\|\|process.env.NODE_PATH/);assert.match(controller,/ordinaryReceiptBefore!==sha256/);
  assert.match(controller,/assertOrdinaryReceiptBinding\(state,receipt,verifyFinancialReleaseAssets/);
});

for(const name of ['state','projection','caller','clock'])test('awaited verification rejects '+name+' mutation or expiry',async()=>{
  const {state,context}=fixture(),old=Date.now;Date.now=()=>now;
  try{await assert.rejects(ordinaryAwaitSnapshot(state,context,async()=>{await Promise.resolve();
    if(name==='state')state.live.identity+='changed';
    if(name==='projection')state.carry.projectionSha256='c'.repeat(64);
    if(name==='caller')context.caller.job_id++;
    if(name==='clock')Date.now=()=>Date.parse(P.not_after)+1;
    return {wouldHavePassed:true};
  }),name==='clock'?/window/:/mutated/);}finally{Date.now=old;}
});
test('interleaved composition invalidates outstanding admission before any receipt',async()=>{
  const f=fixture();f.state.ordinaryCarryTooling={phase:'built',inputs:{},build:{output_sha256:h}};
  const first=beginOrdinaryComposition(f.state,f.context,{frontend:'/nonexistent'},()=>h);
  const second=beginOrdinaryComposition(f.state,f.context,{frontend:'/nonexistent'},()=>h);
  const result=await Promise.allSettled([first,second]);assert(result.every(x=>x.status==='rejected'));assert.equal(f.state.ordinaryCarryTooling.phase,'failed');
  await assert.rejects(completeOrdinaryComposition({},f.state,f.context,{}, {},()=>P.ui_digest));
});

test('production ordinary CLI rejects runtime hooks before reading any authority or starting child tools',async()=>{
  const {spawnSync}=await import('node:child_process'),{fileURLToPath}=await import('node:url');
  const root=mkdtempSync(join(tmpdir(),'ordinary-cli-hooks-'));
  try{
    mkdirSync(join(root,'verified-publication'));writeFileSync(join(root,'verified-publication/state.json'),JSON.stringify(fixture().state));
    const cli=fileURLToPath(new URL('./select-release-source.mjs',import.meta.url));
    for(const hooks of [{NODE_OPTIONS:'--trace-warnings'},{NODE_PATH:root}]){
      const result=spawnSync(process.execPath,[cli,'ordinary-carry-build'],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:'',NODE_PATH:'',...hooks,RUNNER_TEMP:root}});
      assert.equal(result.status,1);assert.match(result.stderr,/does not accept runtime hooks/);
      assert(!existsSync(join(root,ORDINARY_ENTRY)));
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('ordinary plan selects the unique exact active identity',()=>{assert.deepEqual(selectOrdinaryCarryAdmission(selectionState(),now),{identity:P,admitted_at:new Date(now).toISOString()});assert.equal(selectOrdinaryCarryAdmission({source:{artifact:{id:3}}},now),null);});
for(const time of [NaN,Date.parse(P.not_before)-1,Date.parse(P.not_after)+1])test('recognized ordinary source never falls through outside active window '+time,()=>{const f=fixture();assert.equal(ordinaryCarrySelected(f.state),true);assert.throws(()=>selectOrdinaryCarryAdmission(selectionState(),time),/no unique active execution identity/);});
for(const change of ['missing','mutated'])test('ordinary execution rejects '+change+' plan identity',()=>{const f=fixture();if(change==='missing')delete f.state.ordinaryCarryAdmission;else f.state.ordinaryCarryAdmission.identity.not_after='2027-01-01T00:00:00Z';assert.throws(()=>validateOrdinaryContext(f.state,f.context),/immutable plan|execution admission/);});

for(const [name,change]of [
  ['future admission',f=>{f.state.ordinaryCarryAdmission.admitted_at=new Date(f.context.now+1).toISOString();}],
  ['admission predates caller',f=>{f.state.ordinaryCarryAdmission.admitted_at=new Date(Date.parse(f.context.caller.started_at)-1).toISOString();}],
  ['admission before dated window',f=>{f.state.ordinaryCarryAdmission.admitted_at=new Date(Date.parse(P.not_before)-1).toISOString();}],
  ['extra admission authority',f=>{f.state.ordinaryCarryAdmission.preview=true;}],
])test('execution rejects '+name,()=>{const f=fixture();change(f);assert.throws(()=>validateOrdinaryContext(f.state,f.context));});
test('execution admission is detached from frozen policy identity',()=>{const f=fixture(),admission=selectOrdinaryCarryAdmission(selectionState(),now);admission.identity.role='changed';assert.equal(P.role,'ordinary_data_only');f.state.ordinaryCarryAdmission=admission;assert.throws(()=>validateOrdinaryContext(f.state,f.context),/immutable plan/);});
test('awaited verification cannot change admission identity or clock',async()=>{const old=Date.now;Date.now=()=>now;try{for(const field of ['identity','admitted_at']){const f=fixture();await assert.rejects(ordinaryAwaitSnapshot(f.state,f.context,async()=>{await Promise.resolve();if(field==='identity')f.state.ordinaryCarryAdmission.identity.not_after='2027-01-01T00:00:00Z';else f.state.ordinaryCarryAdmission.admitted_at=new Date(now).toISOString();}),/mutated/);}}finally{Date.now=old;}});

// Historical receipt reads retain the exact immutable Oct10 contract.
test('old v1 receipt is readable but cannot authorize current execution',()=>{const f=receiptFixture(LEGACY);assert.equal(validateOrdinaryCarryReceipt(f.receipt,f.publication),f.receipt);assert.throws(()=>assertOrdinaryReceiptBinding(f.state,f.publication,f.financial),/Non-active historical identity/);assert.throws(()=>selectOrdinaryCarryAdmission({source:{artifact:{id:LEGACY.source.artifact_id}}},now),/no unique active/);});
test('new v2 receipt requires the exact recorded admission',()=>{const f=receiptFixture();assert.equal(f.receipt.schema_version,'ordinary-carry-tooling-receipt-v2');assert.equal(validateOrdinaryCarryReceipt(f.receipt,f.publication),f.receipt);delete f.receipt.inputs.admitted_at;assert.throws(()=>validateOrdinaryCarryReceipt(f.receipt,f.publication),/inputs/);});
for(const key of ['admitted_at','prepared_at'])test('new v2 receipt rejects start after admission cutoff '+key,()=>{const f=receiptFixture(),late='2026-10-11T09:00:00.001Z';f.receipt.inputs.admitted_at=key==='admitted_at'?late:f.receipt.inputs.admitted_at;f.receipt.prepared_at=late;f.receipt.inputs.carry.evaluated_at=late;f.receipt.bound_at=late;f.receipt.build.started_at=late;f.receipt.build.finished_at=late;f.receipt.composed_at=late;assert.throws(()=>validateOrdinaryCarryReceipt(f.receipt,f.publication),/start outside/);});
test('new execution cannot use a caller from the old day',()=>{const f=fixture();f.context.caller.started_at='2026-10-10T23:59:59.999Z';assert.throws(()=>validateOrdinaryContext(f.state,f.context),/caller predates/);});
test('admission closes at09:00 while existing execution remains bounded to10:30',()=>{const f=fixture();assert(selectOrdinaryCarryAdmission(selectionState(),Date.parse(P.admit_before)));assert.throws(()=>selectOrdinaryCarryAdmission(selectionState(),Date.parse(P.admit_before)+1),/no unique active/);f.context.now=Date.parse(P.not_after);assert(validateOrdinaryContext(f.state,f.context));f.context.now++;assert.throws(()=>validateOrdinaryContext(f.state,f.context),/window/);});
for(const field of ['amendment_id','not_after','admit_before'])test('historical receipt identity cannot be upgraded by '+field,()=>{const f=receiptFixture(LEGACY);f.receipt.identity=clone(f.receipt.identity);f.receipt.identity[field]=P[field];assert.throws(()=>validateOrdinaryCarryReceipt(f.receipt,f.publication),/identity/);});

test('new admission cannot precede authenticated artifact creation',()=>{const f=fixture();assert.throws(()=>selectOrdinaryCarryAdmission(selectionState(),Date.parse(P.source.created_at)-1),/no unique active/);f.context.caller.started_at=P.not_before;f.state.ordinaryCarryAdmission.admitted_at=new Date(Date.parse(P.source.created_at)-1).toISOString();assert.throws(()=>validateOrdinaryContext(f.state,f.context),/predates its selected artifact/);});

// Registry source changes never change authority or reinterpret existing plans.
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
test('active v3 and retired v2 match their exact independently reviewed identities',()=>{
  assert.equal(P,OCT11_ORDINARY_CARRY_V3);
  assert.equal(sha(JSON.stringify(ordered(P))),'786954926e4a226faea70b7be9c8139d275582881d7386edc9e8ebc8f0d62f5d');
  assert.equal(sha(JSON.stringify(ordered(RETIRED))),'795df74e23bd59dd888240ab242672c08e41ee600ac71b99370bd4c0e31a3814');
  const authority=({amendment_id,source,...rest})=>rest;
  assert.deepEqual(authority(P),authority(RETIRED));
  assert.equal(P.admit_before,'2026-10-11T09:00:00Z');assert.equal(P.not_after,'2026-10-11T10:30:00Z');
  for(const identity of [LEGACY,RETIRED,P])for(const value of [identity,identity.source,identity.predecessor])assert(Object.isFrozen(value));
});
for(const identity of [LEGACY,RETIRED])test('known '+identity.amendment_id+' source cannot fall through to generic preparation',()=>{
  const state=selectionState(identity),before=clone(state);
  assert.equal(ordinaryCarrySelected(state),true);
  for(const time of [Date.parse(identity.source.created_at),now,Date.parse(P.not_after)+1]){
    assert.throws(()=>ordinaryCarrySelected(state)?selectOrdinaryCarryAdmission(state,time):'generic',/no unique active execution identity/);
    assert.deepEqual(state,before);
  }
});
for(const variant of ['retired source','active source substituted','missing admission with existing tooling','active plan'])test('selection never upgrades or rewrites '+variant,()=>{
  const {state}=fixture();
  if(variant!=='active plan')state.ordinaryCarryAdmission.identity=clone(RETIRED);
  if(variant==='retired source')state.source.artifact.id=RETIRED.source.artifact_id;
  if(variant==='missing admission with existing tooling'){delete state.ordinaryCarryAdmission;state.ordinaryCarryTooling={phase:'prepared'};}
  const before=clone(state);
  assert.throws(()=>selectOrdinaryCarryAdmission(state,now),/cannot replace an existing immutable plan/);
  assert.deepEqual(state,before);
});
test('superseded v2 admission cannot authorize live execution even with the active source',()=>{
  const f=fixture();f.state.ordinaryCarryAdmission.identity=clone(RETIRED);
  assert.throws(()=>validateOrdinaryContext(f.state,f.context),/immutable plan/);
});
for(const [name,mutate]of [
  ['artifact size',s=>{s.source.artifact.size_in_bytes++;}],
  ['run ID',s=>{s.source.runId++;}],
  ['run attempt',s=>{s.source.attempt++;}],
  ['artifact workflow run',s=>{s.source.artifact.workflow_run.id++;}],
  ['head SHA',s=>{s.source.artifact.workflow_run.head_sha=g;}],
  ['manifest hash',s=>{s.source.manifestHash=h;}],
  ['price observations hash',s=>{s.source.priceObservationsDigest=h;}],
  ['artifact name',s=>{s.source.artifact.name+='-other';}],
  ['artifact digest prefix',s=>{s.source.artifact.digest='sha512:'+P.source.artifact_sha256;}],
  ['retired artifact',s=>{s.source.artifact.id=RETIRED.source.artifact_id;}],
])test('exact source binding rejects '+name,()=>{const f=fixture();mutate(f.state);assert.throws(()=>validateOrdinaryContext(f.state,f.context));});
test('v3 source creation and admission cutoff are inclusive and immutable',()=>{
  for(const time of [P.source.created_at,P.admit_before])assert.deepEqual(selectOrdinaryCarryAdmission(selectionState(),Date.parse(time)),{identity:P,admitted_at:new Date(time).toISOString()});
  for(const time of [Date.parse(P.source.created_at)-1,Date.parse(P.admit_before)+1,Date.parse(P.not_after)+1])assert.throws(()=>selectOrdinaryCarryAdmission(selectionState(),time),/no unique active/);
});
test('superseded v2 historical receipt remains readable but cannot execute',()=>{
  const f=receiptFixture(RETIRED),old=Date.now;
  try{Date.now=()=>Date.parse('2026-11-01T00:00:00Z');assert.equal(validateOrdinaryCarryReceipt(f.receipt,f.publication),f.receipt);}finally{Date.now=old;}
  assert.throws(()=>assertOrdinaryReceiptBinding(f.state,f.publication,f.financial),/Non-active historical identity/);
});
for(const field of ['amendment_id','source','admit_before','not_after'])test('retired v2 receipt rejects identity mutation '+field,()=>{
  const f=receiptFixture(RETIRED);f.receipt.identity=clone(RETIRED);
  f.receipt.identity[field]=['amendment_id','source'].includes(field)?clone(P[field]):'2026-10-12T10:30:00Z';
  assert.throws(()=>validateOrdinaryCarryReceipt(f.receipt,f.publication),/identity/);
});
test('retired v2 receipt cannot relabel its entire identity to v3',()=>{
  const f=receiptFixture(RETIRED);f.receipt.identity=clone(P);
  assert.throws(()=>validateOrdinaryCarryReceipt(f.receipt,f.publication),/source proof/);
});
test('retired v2 historical receipt retains its original admission cutoff',()=>{
  const f=receiptFixture(RETIRED),late='2026-10-11T09:00:00.001Z';
  f.receipt.inputs.admitted_at=late;f.receipt.prepared_at=late;f.receipt.inputs.carry.evaluated_at=late;f.receipt.bound_at=late;f.receipt.build.started_at=late;f.receipt.build.finished_at=late;f.receipt.composed_at=late;
  assert.throws(()=>validateOrdinaryCarryReceipt(f.receipt,f.publication),/start outside/);
});
