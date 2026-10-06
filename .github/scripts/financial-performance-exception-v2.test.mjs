import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performanceLifecycleFixture} from './fixtures/financial-performance-lifecycle.mjs';
import {validatePackedExceptionPolicy,exceptionPolicyForVersion} from './financial-performance-policy.mjs';
import {parsePerformanceApproval,readPerformanceApproval,readExceptionPin,readExceptionReleaseIntent,selectExceptionVersion,exceptionWorkflowControls} from './financial-performance-exception.mjs';
import {sha256} from './publication-state.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),H='9'.repeat(64),S='9'.repeat(40);
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(value));};

test('audit deployment binding remains finite, v2-only and cannot authorize consumer or projector changes',()=>{
  const v1=exceptionPolicyForVersion(1),v2=exceptionPolicyForVersion(2),approval=readPerformanceApproval(root,{version:2});
  assert.equal(new Set(v2.controller_only_paths).size,v2.controller_only_paths.length);
  assert.equal(v2.controller_only_paths.includes('.github/scripts/financial-audit-transport.mjs'),true);
  assert.equal(v1.controller_only_paths.includes('.github/scripts/financial-audit-transport.mjs'),false);
  for(const path of ['frontend/src/static/staticPublication.js','frontend/src/static/financialCurrent.js',
    'backend/app/scripts/export_native_annual_projection.py','backend/app/services/native_annual_history.py','.github/scripts/unreviewed-audit-helper.mjs',
    'contracts/financial_performance_exception_v1.json']){
    const changed=structuredClone(approval);
    changed.controller_changes[path]={before:null,after:{mode:'100644',sha:S}};
    assert.throws(()=>parsePerformanceApproval(changed),/Unapproved consumer\/projector or controller change/);
  }
});

test('the isolated unbound packed policy grants no authority and preserves legacy controls',async t=>{
  const scratch=mkdtempSync(join(tmpdir(),'disabled-packed-control-'));t.after(()=>rmSync(scratch,{recursive:true,force:true}));
  // Exercise the real modules with a disabled on-disk fixture policy. Binding
  // the one production capture must never remove this fail-closed coverage or
  // introduce a runtime argument/environment override for policy authority.
  for(const directory of ['.github/scripts','contracts'])cpSync(join(root,directory),join(scratch,directory),{recursive:true});
  symlinkSync(join(root,'frontend'),join(scratch,'frontend'));
  for(const name of ['financial-performance-approval.json','financial-performance-candidate.json'])cpSync(join(root,'.github',name),join(scratch,'.github',name));
  const disabled={schema_version:'financial-performance-exception-policy-v2',enabled:false,capture:null};
  write(join(scratch,'contracts/financial_performance_exception_v2.json'),disabled);
  const policy=await import(pathToFileURL(join(scratch,'.github/scripts/financial-performance-policy.mjs')).href);
  const x=await import(pathToFileURL(join(scratch,'.github/scripts/financial-performance-exception.mjs')).href);
  assert.deepEqual(policy.validatePackedExceptionPolicy(disabled),disabled);
  assert.throws(()=>policy.exceptionPolicyForVersion(2),/no reviewed capture/);
  assert.throws(()=>x.parsePerformanceApproval({schema_version:'financial-performance-approval-v2'}),/no reviewed capture/);
  assert.equal(x.selectExceptionVersion(scratch),1);
  assert.equal(x.exceptionWorkflowControls(scratch).pending,false);
  assert.equal(x.readExceptionPin(scratch).schema_version,'financial-performance-candidate-pin-v1');
  write(join(scratch,'.github/financial-performance-approval-v2.json'),{schema_version:'financial-performance-approval-v2'});
  assert.throws(()=>x.selectExceptionVersion(scratch),/no reviewed capture/);
});

test('the reviewed packed capture preserves failed evidence and needs its own certification',t=>{
  const policy=exceptionPolicyForVersion(2),approval=readPerformanceApproval(root,{version:2});
  assert.equal(policy.captured_ui.sha,'1e1943e1d5f78a738a05baa69eb9f2e8508e32ac');
  assert.deepEqual(approval.captured_ui,policy.captured_ui);
  const bytes=readFileSync(join(root,approval.review.path)),review=JSON.parse(bytes);
  assert.equal(sha256(bytes),policy.review_sha256);
  assert.equal(review.observed_commit,policy.captured_ui.sha);
  assert.equal(review.captured_tree,policy.captured_ui.tree);
  assert.deepEqual(review.screens.map(s=>s.key).sort(),[...policy.screenshot_keys].sort());
  assert.deepEqual(review.objective_failures,policy.failures);
  assert.equal(review.performance_exception_approved,false);
  assert.equal(review.release_approved,false);
  const controls=mkdtempSync(join(tmpdir(),'reviewed-packed-control-'));t.after(()=>rmSync(controls,{recursive:true,force:true}));
  for(const name of ['financial-performance-approval.json','financial-performance-candidate.json','financial-performance-approval-v2.json'])write(join(controls,'.github',name),read(join(root,'.github',name)));
  assert.equal(selectExceptionVersion(controls,{certification:true}),2);
  assert.deepEqual(exceptionWorkflowControls(controls),{pending:true,capture_sha:policy.captured_ui.sha,pinned_capture_shas:exceptionPolicyForVersion(1).captured_ui.sha});
  assert.equal(readExceptionPin(controls,2),null);
  assert.equal(readExceptionReleaseIntent(controls,2),null);
});

test('packed exception binding, controls and archive boundaries remain exact',{timeout:120000},async t=>{
  const f=await performanceLifecycleFixture({packedTransport:true,exceptionVersion:2});t.after(()=>f.cleanup());
  const x=f.exception,p=f.policy,api=endpoint=>structuredClone(f.config.api[endpoint]);
  const receipt={ui_sha:f.ui.sha,ui_digest:f.ui.ui_digest,approval:f.ui};
  const record={schema_version:'financial-performance-candidate-v2',producer:{repository:f.pin.repository,workflow:p.workflow,head_sha:f.pin.head_sha,run_id:f.pin.run_id,run_attempt:f.pin.run_attempt},
    captured_ui:p.captured_ui,request_sha256:f.approval.request_sha256,preview_receipt_sha256:f.approval.preview_receipt_sha256,corrected_inventory_sha256:H,
    protected_code_sha256:f.approval.captured_code_sha256,approval_sha256:f.pin.approval_sha256,controller_code_sha256:f.approval.controller_code_sha256,transport_sha256:p.transport_sha256};
  await t.test('policy allows only a complete new capture and unchanged performance budgets',()=>{
    const value=read(join(f.codeRoot,'contracts/financial_performance_exception_v2.json'));
    validatePackedExceptionPolicy(value);
    for(const mutate of [v=>v.capture=null,v=>v.enabled=false,v=>v.capture.future_ui=true,v=>v.capture.transport_sha256='unknown',
      v=>v.capture.failures.push('1440: chart date axis is hidden'),v=>v.capture.failures.push('390: performance requires all 3 runs'),
      v=>v.capture.budgets.p1_ready_ms=5000,v=>v.capture.design_steps[3].conclusion='success',v=>v.capture.capture_ci_jobs.at(-1).conclusion='success',
      v=>v.capture.screenshot_keys.push(v.capture.screenshot_keys[0]),v=>v.capture.design_artifact.name='latest']){
      const copy=structuredClone(value);mutate(copy);assert.throws(()=>validatePackedExceptionPolicy(copy));
    }
    assert.equal(p.controller_only_paths.includes('contracts/financial_performance_exception_v1.json'),false);
  });
  await t.test('v2 cannot reuse a raw candidate or different transport, UI or approval type',()=>{
    assert.deepEqual(f.activation.validateCandidateRecord(record),record);
    for(const mutate of [v=>delete v.transport_sha256,v=>v.transport_sha256=H,v=>v.captured_ui.sha=S,v=>v.captured_ui.digest=H,
      v=>v.schema_version='financial-performance-candidate-v1',v=>v.producer.workflow='.github/workflows/design-acceptance.yml',v=>v.accepted=true]){
      const copy=structuredClone(record);mutate(copy);assert.throws(()=>f.activation.validateCandidateRecord(copy));
    }
    for(const mutate of [v=>v.transport_sha256=H,v=>v.captured_ui.sha=S,v=>v.schema_version='financial-performance-approval-v1',v=>v.activation_not_after='2099-01-01T00:00:00Z']){
      const copy=structuredClone(f.approval);mutate(copy);assert.throws(()=>x.parsePerformanceApproval(copy));
    }
    assert.throws(()=>x.parseExceptionUiApproval({...f.ui,certificate:{...f.pin,schema_version:'financial-performance-candidate-pin-v1'}}));
    assert.throws(()=>x.parseExceptionUiApproval({...f.ui,type:'performance-exception-v1'}));
  });
  await t.test('new immutable original capture rejects wrong attempts, trees and relabeled Design',()=>{
    const prefix=`repos/${f.pin.repository}`,run=`${prefix}/actions/runs/${p.design_run_id}/attempts/${p.capture_attempt}`;
    assert.ok(x.verifyPerformanceUiApproval(receipt,f.pin.repository,api));
    for(const [endpoint,mutate]of [[run,v=>v.run_attempt++],[run,v=>v.id++],[run,v=>v.head_sha=S],[run,v=>v.conclusion='success'],
      [`${prefix}/git/commits/${p.captured_ui.sha}`,v=>v.tree.sha=S],[`${run}/jobs?per_page=100`,v=>v[0].jobs[0].steps.push({name:'Financial geometry failed',conclusion:'failure'})]]){
      assert.throws(()=>x.verifyPerformanceUiApproval(receipt,f.pin.repository,path=>{const value=api(path);if(path===endpoint)mutate(value);return value;}));
    }
  });
  await t.test('source, predecessor, source certificate and code remain bound after version dispatch',()=>{
    const verified=x.verifyPerformanceUiApproval(receipt,f.pin.repository,api),financial=f.readDeployed().financialRelease;
    x.verifyExceptionFinancialScope(financial,verified);
    for(const mutate of [v=>v.previous_publication_identity=`2/1/${H}/${H}`,v=>v.source_projection.sha256=H,
      v=>v.lineage.source.artifact_sha256=H,v=>v.lineage.certificate.artifact_sha256=H]){
      const copy=structuredClone(financial);mutate(copy);assert.throws(()=>x.verifyExceptionFinancialScope(copy,verified));
    }
    const current=structuredClone(f.current);current['frontend/package-lock.json'].sha=S;
    assert.throws(()=>x.verifyExceptionCode({approval:f.approval,captured:f.captured,current}));
    assert.throws(()=>x.parsePerformanceApproval(f.approval,{activation:true,now:Date.parse('2026-10-08T00:00:00Z')}),/expired/);
    assert.doesNotThrow(()=>x.parsePerformanceApproval(f.approval,{now:Date.parse('2026-10-08T00:00:00Z')}));
  });
  await t.test('the new screenshot coverage is exact and no nonperformance finding is waived',()=>{
    const screenshots={},screens=p.screenshot_keys.map((key,i)=>{const screenshot=`screen-${i}.png`;screenshots[screenshot]=H;return {key,screenshot,metrics:{smallTargets:[],fontIssues:[],radiusIssues:[],asciiNegativeValues:[],horizontalOverflow:false},axe:[]};});
    const value={screenshots,report:{commit:p.captured_ui.sha,failures:p.failures,screens},review:{observed_commit:p.captured_ui.sha,captured_tree:p.captured_ui.tree,report_json_sha256:p.report_sha256,
      performance_exception_approved:false,release_approved:false,objective_nonperformance_failure_count:0,objective_failures:p.failures,
      screens:screens.map(s=>({...s,sha256:H,scores:Object.fromEntries(['design','usability','originality','content'].map(k=>[k,{value:8,reason:'Explicit synthetic test rationale'}]))}))}};
    x.validatePerformanceReviewContent(value,p);
    for(const mutate of [v=>v.report.screens[0].key='different-capture',v=>v.report.screens.pop(),v=>v.report.screens[0].metrics.horizontalOverflow=true,
      v=>v.report.screens[0].axe.push({}),v=>v.review.objective_nonperformance_failure_count=1,v=>v.review.release_approved=true,v=>v.review.screens[0].scores.design.value=7.9]){
      const copy=structuredClone(value);mutate(copy);assert.throws(()=>x.validatePerformanceReviewContent(copy,p));
    }
  });
  await t.test('retained v1 pin cannot suppress v2 certification and two intents fail without affecting historical readers',()=>{
    const controls=join(f.root,'controls');
    for(const name of ['financial-performance-approval.json','financial-performance-candidate.json'])write(join(controls,'.github',name),read(join(root,'.github',name)));
    write(join(controls,p.approval_path),f.approval);
    assert.equal(x.selectExceptionVersion(controls,{certification:true}),2);
    assert.deepEqual(x.exceptionWorkflowControls(controls),{pending:true,capture_sha:p.captured_ui.sha,pinned_capture_shas:read(join(root,'contracts/financial_performance_exception_v1.json')).captured_ui.sha});
    write(join(controls,p.pin_path),f.pin);assert.equal(x.exceptionWorkflowControls(controls).pending,false);
    const intent={schema_version:'financial-performance-release-intent-v2',approval_sha256:f.pin.approval_sha256,candidate_record_sha256:f.pin.candidate_record_sha256,previous_publication_identity:f.request.correction.previous_publication_identity};
    write(join(controls,p.release_intent_path),intent);assert.equal(x.selectExceptionVersion(controls),2);
    write(join(controls,'.github/financial-performance-release.json'),{...intent,schema_version:'financial-performance-release-intent-v1'});
    assert.throws(()=>x.selectExceptionVersion(controls),/Multiple .* release intents/);
    assert.throws(()=>x.exceptionWorkflowControls(controls),/Multiple .* release intents/);
    assert.ok(x.verifyPerformanceUiApproval(receipt,f.pin.repository,api),'historical readers never consult current activation controls');
    rmSync(join(controls,'.github/financial-performance-release.json'));
    write(join(controls,p.pin_path),read(join(root,'.github/financial-performance-candidate.json')));
    assert.throws(()=>x.selectExceptionVersion(controls),/wrong versioned control path/);
  });
  await t.test('the exception archive contains the exact mandatory transport seal and rejects changed or missing seals',async()=>{
    const candidate=join(f.root,'archive-candidate'),archive=join(f.root,'packed-candidate.tar');mkdirSync(candidate);
    const directories=['projection','corrected','baseline','original-source','original-certification','original-predecessor','design-evidence'];
    const files=['candidate.json','release-request.json','protected-code.json','preview-receipt.json','verification.json','request.json','evidence.json','target-base.json','performance-approval.json','controller-code.json','diagnostic-metadata.json','review.json','nonperformance-verification.json'];
    for(const name of directories){mkdirSync(join(candidate,name));write(join(candidate,name,'fixture.json'),{});}
    for(const name of files)write(join(candidate,name),name==='candidate.json'?record:{});
    writeFileSync(join(candidate,'transport.json'),'synthetic packed preview transport');
    assert.equal(sha256(readFileSync(join(candidate,'transport.json'))),record.transport_sha256);
    await x.archiveExceptionCandidate(candidate,archive,record);
    const restored=join(f.root,'restored-candidate');f.activation.extractCandidateTar(archive,restored);
    assert.deepEqual(readFileSync(join(restored,'transport.json')),readFileSync(join(candidate,'transport.json')));
    writeFileSync(join(candidate,'transport.json'),'changed');
    await assert.rejects(()=>x.archiveExceptionCandidate(candidate,join(f.root,'bad.tar'),record),/archive transport changed/);
    assert.equal(existsSync(join(f.root,'bad.tar')),false);
    rmSync(join(candidate,'transport.json'));
    await assert.rejects(()=>x.archiveExceptionCandidate(candidate,join(f.root,'missing.tar'),record),/ENOENT/);
  });
});
