import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,symlinkSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ORDINARY_CARRY as P,ORDINARY_ENTRY,HISTORY_PATH,ordinaryCarrySelected,assertOrdinaryClock,validateOrdinaryContext,ordinaryExporterBytes,withOrdinaryExporter,materializeOrdinaryHistory,validateOrdinaryCarryReceipt,assertOrdinaryReceiptBinding,completeOrdinaryComposition,ordinaryAwaitSnapshot,beginOrdinaryComposition} from './ordinary-carry-tooling.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),clone=v=>structuredClone(v),h='a'.repeat(64),g='b'.repeat(40),now=Date.parse('2026-10-10T11:00:00.000Z');
function fixture(){
  const context={controller:{head:g,tree:'c'.repeat(40)},caller:{run_id:101,run_attempt:1,job_id:102,started_at:'2026-10-10T10:00:00.000Z'},event:'workflow_dispatch',ui_only:true,now};
  const state={controllerSha:g,decision:{publish:true,mode:'data'},sourceSha:P.ui_sha,carry:{},source:{runId:P.source.run_id,attempt:1,manifestHash:P.source.manifest_sha256,priceObservationsDigest:P.source.price_observations_sha256,manifest:{markets:{US:{as_of_date:P.source.as_of_date}}},artifact:{id:P.source.artifact_id,size_in_bytes:P.source.artifact_bytes,digest:'sha256:'+P.source.artifact_sha256,name:`static-site-data-${P.source.run_id}-1`,created_at:P.source.created_at,workflow_run:{id:P.source.run_id,head_sha:P.source.head_sha}}},live:{uiSha:P.ui_sha,uiDigest:P.ui_digest,identity:P.predecessor.identity,receiptHash:P.predecessor.receipt_sha256,receipt:{transport:{root:{sha256:P.predecessor.transport_root_sha256}}},financialRelease:{mode:'activation',lineage_sha256:P.predecessor.lineage_sha256,financial_generation:P.predecessor.generation,source_projection:{sha256:P.predecessor.source_projection_sha256},source_base:{sha256:P.predecessor.source_base_sha256}}},historyReconciliation:{admitted_observations:650,source_artifact_digest:'sha256:'+P.source.artifact_sha256}};
  return {state,context};
}
function receiptFixture(){
  const {context}=fixture(),date='2026-10-10T10:10:00.000Z';
  const historyProof={schema_version:'candidate-history-reconciliation-v1',...Object.fromEntries(['predecessor_selection_sha256','predecessor_performance_sha256','selected_selection_sha256','selected_performance_sha256','output_selection_sha256','output_performance_sha256'].map(k=>[k,h])),published_observations:0,admitted_observations:650,cohorts:4,selections:5,source_artifact_digest:'sha256:'+P.source.artifact_sha256,predecessor_digest:P.predecessor.transport_root_sha256};
  const proofDigest=sha(JSON.stringify(Object.fromEntries(Object.entries(historyProof).sort(([a],[b])=>a.localeCompare(b)))));
  const inputs={controller:context.controller,caller:context.caller,source:{artifact_sha256:P.source.artifact_sha256,tar_sha256:h,raw_static_inventory_sha256:h,source_history_present:false,manifest_sha256:P.source.manifest_sha256},predecessor_identity:P.predecessor.identity,history_reconciliation:historyProof,history_reconciliation_sha256:proofDigest,baseline_sha256:h,carry:{projection_sha256:h,target_base_sha256:h,generation:h,evaluated_at:date}};
  const history={schema_version:'ordinary-empty-history-derivation-v1',path:HISTORY_PATH,source_present:false,action:'materialize_empty_derived_container',as_of_date:P.source.as_of_date,baseline_sha256:sha(JSON.stringify({as_of_date:P.source.as_of_date,results:{}}))};
  const publication={controller_sha:g,run_id:101,run_attempt:1,data_source:{artifact_id:P.source.artifact_id,run_id:P.source.run_id,attempt:1},financial_release:{schema_version:'financial-release-receipt-v1',path:`static-data/financial-corrections/release-${h}.json`,sha256:h},financial_generation:h,financial_lineage_sha256:P.predecessor.lineage_sha256,ui_sha:P.ui_sha,ui_digest:P.ui_digest};
  const receipt={schema_version:'ordinary-carry-tooling-receipt-v1',identity:P,inputs,history,prepared_at:date,bound_at:date,build:{started_at:date,finished_at:date,output_sha256:h},composed_at:date,...Object.fromEntries(['financial_release','financial_generation','financial_lineage_sha256','ui_sha','ui_digest'].map(k=>[k,publication[k]]))};publication.ordinary_carry_tooling=receipt;
  const state={ordinaryCarryTooling:{phase:'composed',inputs:clone(inputs),history:clone(history),prepared_at:date,bound_at:date,build:clone(receipt.build),receipt:clone(receipt)}};
  const financial={mode:'carry',evaluation_projection:{sha256:h},evaluated_at:date,financial_generation:h,lineage_sha256:P.predecessor.lineage_sha256,previous_publication_identity:P.predecessor.identity};
  return {receipt,publication,state,financial};
}
test('only exact source or existing binding selects bounded ordinary tooling',()=>{assert.equal(ordinaryCarrySelected(fixture().state),true);assert.equal(ordinaryCarrySelected({source:{artifact:{id:3}}}),false);assert.equal(ordinaryCarrySelected({ordinaryCarryTooling:{}}),true);});
test('exact isolated ordinary context validates',()=>{const f=fixture();assert.equal(validateOrdinaryContext(f.state,f.context),true);});
for(const [name,mutate]of [
 ['finite repair',s=>{s.source.repair={};}],['finite tooling',s=>{s.publisherTooling={};}],['recovery',s=>{s.sourceRecovery={};}],['correction',s=>{s.correction={};}],['activation',s=>{s.activation={};}],['renewal',s=>{s.renewal={};}],['preview',s=>{s.designCarryPreview={};}],['migration',s=>{s.decision.migration=true;}],['new UI',s=>{s.decision.mode='ui';}],['wrong source',s=>{s.source.artifact.id++;}],['changed source bytes',s=>{s.source.artifact.digest='sha256:'+h;}],['changed source time',s=>{s.source.artifact.created_at='2026-10-10T04:23:00Z';}],['changed target',s=>{s.source.manifest.markets.US.as_of_date='2026-10-12';}],['changed predecessor',s=>{s.live.identity+='0';}],['changed receipt',s=>{s.live.receiptHash=h;}],['changed UI bytes',s=>{s.live.uiDigest=h;}],['changed source lineage',s=>{s.live.financialRelease.lineage_sha256=h;}],['lost650',s=>{s.historyReconciliation.admitted_observations=649;}],
])test('context rejects '+name,()=>{const f=fixture();mutate(f.state);assert.throws(()=>validateOrdinaryContext(f.state,f.context));});
for(const [name,mutate]of [['UI-only false',c=>{c.ui_only=false;}],['automatic dispatch',c=>{c.event='workflow_run';}],['rerun',c=>{c.caller.run_attempt=2;}],['future start',c=>{c.caller.started_at='2026-10-10T12:00:00Z';}],['past authorization',c=>{c.now=Date.parse(P.not_before)-1;}],['expired authorization',c=>{c.now=Date.parse(P.not_after)+1;}],['unknown context authority',c=>{c.preview=true;}],['controller mismatch',c=>{c.controller.head='d'.repeat(40);}]])test('context rejects '+name,()=>{const f=fixture();mutate(f.context);assert.throws(()=>validateOrdinaryContext(f.state,f.context));});
test('window includes endpoints and rejects either outside clock',()=>{for(const t of [P.not_before,P.not_after])assert.equal(assertOrdinaryClock(Date.parse(t)),new Date(t).toISOString());for(const n of [NaN,Infinity,Date.parse(P.not_before)-1,Date.parse(P.not_after)+1])assert.throws(()=>assertOrdinaryClock(n));});
test('historical receipt remains readable after authorization expires',()=>{const f=receiptFixture(),old=Date.now;try{Date.now=()=>Date.parse('2026-11-01T00:00:00Z');assert.equal(validateOrdinaryCarryReceipt(f.receipt,f.publication),f.receipt);}finally{Date.now=old;}});
for(const [name,mutate]of [['extra authority',v=>{v.preview=true;}],['wrong identity',v=>{v.identity={...v.identity,role:'publisher'};}],['source history present',v=>{v.inputs.source.source_history_present=true;}],['changed source',v=>{v.inputs.source.artifact_sha256=h;}],['late completion',v=>{v.composed_at='2026-10-10T15:00:00Z';}],['future evaluation',v=>{v.inputs.carry.evaluated_at='2026-10-10T11:00:00Z';}],['changed UI digest',v=>{v.ui_digest=h;}],['invented history value',v=>{v.history.results={OWNED:123};}]])test('receipt rejects '+name,()=>{const f=receiptFixture();mutate(f.receipt);assert.throws(()=>validateOrdinaryCarryReceipt(f.receipt,f.publication));});
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
