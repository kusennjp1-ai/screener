import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,truncateSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {validateRenewalEvaluationAt,assertCurrentRenewalEvaluation,verifyRenewalEvaluationCurrent} from './financial-source-renewal.mjs';
import {previewEvaluationAt,verifyPreviewRenewalTarget,PREVIEW_SCHEMA} from './financial-candidate-preview.mjs';
import {CERTIFIED_PREVIEW_SCHEMA} from './financial-candidate-preview-v2.mjs';
import {POSTCAPTURE_PREVIEW_SCHEMA} from './financial-candidate-preview-postcapture.mjs';
import {sha256} from './publication-state.mjs';
import {contract} from './financial-correction.mjs';
import {lifecycleFixture} from './fixtures/financial-release-lifecycle.mjs';
import {financialNextExpiry} from '../../frontend/src/static/financialCurrent.js';
import {overlayFinancialCorrection} from '../../frontend/tools/financial-correction-overlay.mjs';
import {checkFinalRenewalPayload} from './financial-source-renewal-publisher.mjs';

const instant='2026-10-06T12:00:00.000Z',now=Date.parse(instant),H='a'.repeat(64),S='b'.repeat(40);
const frontendRoot=fileURLToPath(new URL('../../frontend',import.meta.url));

test('actual preview CLI completes its lazy source-phase import and rejects evidence without a module-evaluation hang',t=>{
  const directory=mkdtempSync(join(tmpdir(),'renewal-preview-cli-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const request={schema_version:PREVIEW_SCHEMA,kind:'unpublished_financial_candidate',source_policy:'successful_capture',candidate_ui:{sha:S,tree:S},
    correction:{schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,previous_publication_identity:`1/1/${H}/${H}`,
      source:{repository:'kusennjp1-ai/screener',workflow:contract.source_workflow,head_sha:S,run_id:12,run_attempt:2,artifact_id:99,
        artifact_name:`financial-statement-recovery-${S}-2`,artifact_sha256:H,archive_manifest_sha256:H,acquisition_base_sha256:H,cohort_sha256:H}}};
  const requestPath=join(directory,'request.json'),evidencePath=join(directory,'evidence.json');
  writeFileSync(requestPath,JSON.stringify(request));writeFileSync(evidencePath,'{}');
  const script=fileURLToPath(new URL('./financial-candidate-preview.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,'prepare','--request',requestPath,'--evidence',evidencePath,'--candidate-root',directory,
    '--predecessor-zip',join(directory,'unused-predecessor.zip'),'--source-zip',join(directory,'unused-source.zip'),'--output',join(directory,'unused-output')],{encoding:'utf8',timeout:10000});
  assert.ifError(result.error);assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/Invalid closed preview evidence/);
  assert.doesNotMatch(result.stderr,/unsettled top-level await|before initialization/);
});

test('renewal target instant is canonical UTC, rejects future time, and adds no elapsed-age policy',t=>{
  t.mock.method(Date,'now',()=>now);
  assert.equal(validateRenewalEvaluationAt(instant),now);
  assert.equal(assertCurrentRenewalEvaluation(instant),now);
  assert.equal(assertCurrentRenewalEvaluation('2000-01-01T00:00:00.000Z'),Date.parse('2000-01-01T00:00:00.000Z'));
  for(const value of [undefined,null,now,'2026-10-06T12:00:00Z','2026-10-06T14:00:00.000+02:00','2026-02-30T00:00:00.000Z','not a clock'])assert.throws(()=>validateRenewalEvaluationAt(value));
  assert.throws(()=>assertCurrentRenewalEvaluation(new Date(now+1).toISOString()),/future/);
});

test('only a certified active same-UI renewal with preserved history can pin preview evaluation',t=>{
  t.mock.timers.enable({apis:['Date'],now});
  const live={uiSha:S,financialRelease:{}},renewalEvaluation={evaluated_at:instant,expected_base_sha256:H};
  for(const schema_version of [CERTIFIED_PREVIEW_SCHEMA,POSTCAPTURE_PREVIEW_SCHEMA]){
    const request={schema_version,candidate_ui:{sha:S}},options={request,live,preservePublishedPriceHistory:true,renewalEvaluation};
    assert.equal(previewEvaluationAt(options),instant);
    for(const change of [v=>v.preservePublishedPriceHistory=false,v=>v.live.financialRelease=null,v=>v.live.uiSha='c'.repeat(40),v=>v.request.schema_version=PREVIEW_SCHEMA,v=>v.renewalEvaluation.extra=true,v=>v.renewalEvaluation.expected_base_sha256='latest',v=>v.renewalEvaluation.evaluated_at=new Date(now+1).toISOString()]){
      const bad=structuredClone(options);change(bad);assert.throws(()=>previewEvaluationAt(bad));
    }
  }
  // Original standalone v1/v2 selects real current time and has no new input.
  for(const schema_version of [PREVIEW_SCHEMA,CERTIFIED_PREVIEW_SCHEMA]){
    assert.equal(previewEvaluationAt({request:{schema_version}}),instant);
    assert.throws(()=>previewEvaluationAt({request:{schema_version,candidate_ui:{sha:S}},renewalEvaluation}));
  }
});

test('strict target gate retains full differing bytes and bounded hash/row/time diagnostics before projection',t=>{
  t.mock.method(Date,'now',()=>now);
  const output=mkdtempSync(join(tmpdir(),'renewal-target-binding-'));t.after(()=>rmSync(output,{recursive:true,force:true}));
  const target=join(output,'target-base.json'),value={market:'US',as_of_date:'2026-10-02',rows:[{symbol:'NVDA',current_price:185,chart_path:'charts/original.json',research_detail_path:'details/original.json'}]};
  const bytes=JSON.stringify(value),renewalEvaluation={evaluated_at:instant,expected_base_sha256:sha256(bytes)};
  writeFileSync(target,bytes);
  const options={target,output,renewalEvaluation,rowCount:1};
  const accepted=verifyPreviewRenewalTarget(options);assert.equal(accepted.matched,true);assert.equal(accepted.target_rows,1);assert.equal(accepted.target_bytes,Buffer.byteLength(bytes));
  value.rows[0].chart_path='charts/different-clock.json';value.rows[0].research_detail_path='details/different-clock.json';
  const changed=JSON.stringify(value);writeFileSync(target,changed);
  assert.throws(()=>verifyPreviewRenewalTarget(options),/expected .* actual .* rows 1, evaluated_at .*full target retained/);
  const report=JSON.parse(readFileSync(join(output,'target-base-binding.json')));
  assert.equal(report.expected_base_sha256,sha256(bytes));assert.equal(report.actual_base_sha256,sha256(changed));assert.equal(report.evaluated_at,instant);
  assert.equal(report.full_target_captured,true);assert.equal(report.full_target_path,'target-base.json');assert.equal(report.matched,false);
  assert.equal(readFileSync(target,'utf8'),changed);
});

test('renewal expiry uses actual time and unchanged consumer deadlines while retaining source clocks',async t=>{
  const f=lifecycleFixture();t.after(()=>f.cleanup());
  const projection=f.original.value,original=JSON.stringify(projection),request={target:{evaluated_at:projection.financial_evaluated_at}};
  const rows=Object.entries(projection.symbols).map(([symbol,item])=>overlayFinancialCorrection({symbol,market:item.market,as_of_date:item.as_of_date},projection));
  const expiry=financialNextExpiry(rows,Date.parse(projection.financial_evaluated_at));assert.ok(Number.isSafeInteger(expiry));
  let checked=Date.parse(projection.financial_evaluated_at)+3*3600000;t.mock.method(Date,'now',()=>checked);
  const options={request,projection,frontendRoot};
  await verifyRenewalEvaluationCurrent(options);
  checked=expiry-1;await verifyRenewalEvaluationCurrent(options);
  checked=expiry;await assert.rejects(()=>verifyRenewalEvaluationCurrent({...options,now:Date.parse(request.target.evaluated_at)}),/expired/);
  // Each invocation samples the wall clock: neither a seal nor a first recheck
  // can provide a saved evaluation clock to a later publication recheck.
  checked=expiry+1;await assert.rejects(()=>verifyRenewalEvaluationCurrent(options),/expired/);
  assert.equal(JSON.stringify(projection),original);
  checked=Date.parse(request.target.evaluated_at);
  await assert.rejects(()=>verifyRenewalEvaluationCurrent({...options,request:{target:{evaluated_at:new Date(checked-1).toISOString()}}}),/differs from selected target/);
  const bad=structuredClone(projection);bad.symbols.OWNED.source_receipts[0].observed_at=new Date(checked+1).toISOString();
  await assert.rejects(()=>verifyRenewalEvaluationCurrent({...options,projection:bad}),/invalid receipt/);
});

test('both final publication checks re-evaluate expiry after the real physical/TAR guard',async t=>{
  const f=lifecycleFixture();t.after(()=>f.cleanup());
  const projection=f.original.value,request={target:{evaluated_at:projection.financial_evaluated_at}},original=JSON.stringify(projection);
  const rows=Object.entries(projection.symbols).map(([symbol,item])=>overlayFinancialCorrection({symbol,market:item.market,as_of_date:item.as_of_date},projection));
  const expiry=financialNextExpiry(rows,Date.parse(projection.financial_evaluated_at));
  const dist=mkdtempSync(join(tmpdir(),'renewal-final-clock-'));t.after(()=>rmSync(dist,{recursive:true,force:true}));writeFileSync(join(dist,'index.html'),'retained UI');
  let checked=expiry-1;t.mock.method(Date,'now',()=>checked);
  const options={request,projection,frontendRoot};
  const result=await checkFinalRenewalPayload(dist,options);assert.equal(result.file_count,1);
  const execute=childProcess.execFileSync;let crossedDuringGuard=false;
  t.mock.method(childProcess,'execFileSync',function(...args){
    const output=Reflect.apply(execute,this,args);
    if(args[1]?.some(value=>String(value).endsWith('/check-pages-payload.py'))){assert.equal(checked,expiry-1);checked=expiry;crossedDuringGuard=true;}
    return output;
  });syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  await assert.rejects(()=>checkFinalRenewalPayload(dist,{...options,now:expiry-1}),/expired/);
  assert.equal(crossedDuringGuard,true,'the real successful physical/TAR guard must finish before the clock crosses');
  // Physical rejection remains mandatory and runs before the last clock check.
  const over=join(dist,'over-limit.bin');writeFileSync(over,'');truncateSync(over,1_000_000_001);
  await assert.rejects(()=>checkFinalRenewalPayload(dist,options),error=>error.status===1&&/1 GB Pages limit/.test(JSON.parse(error.stdout).error));
  assert.equal(JSON.stringify(projection),original);
});
