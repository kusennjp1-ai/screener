import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,readFileSync,rmSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {performanceExceptionPolicy as p,exceptionType,parsePerformanceApproval,verifyExceptionCode,parseExceptionPin,parseExceptionUiApproval,verifyOriginalExceptionCapture,verifyExceptionCertificate,verifyPerformanceUiApproval,verifyExceptionFinancialScope,validateExceptionChecks,validatePerformanceReviewContent,verifyPerformanceReview,readExceptionPin,readExceptionReleaseIntent,verifyRetainedDesignArchive} from './financial-performance-exception.mjs';
import {digest,verifyCorrectionConsumerChecks} from './financial-correction.mjs';
import {verifyApproval,sha256} from './publication-state.mjs';
import {publicationDecision} from './publication-gate.mjs';
const H='a'.repeat(64),S='b'.repeat(40),T='c'.repeat(40),repo='kusennjp1-ai/screener';
const clone=structuredClone;
function fixture(){
  const captured={'backend/app/scripts/export_native_annual_projection.py':{mode:'100644',sha:T},'frontend/package-lock.json':{mode:'100644',sha:T},'.github/scripts/publication-state.mjs':{mode:'100644',sha:T}},current={...captured,'.github/scripts/publication-state.mjs':{mode:'100644',sha:S}};
  const request={schema_version:'financial-release-request-v1',correction:{source:{identity:'original-source'},previous_publication_identity:`1/1/${H}/${H}`},source_validation:{certificate:{identity:'original-certificate'}},destination_projection:{identity:'original-projector'}};
  const approval={schema_version:'financial-performance-approval-v1',scope:'one-captured-financial-repair',approved_at:'2026-10-05T22:19:12Z',activation_not_after:'2026-10-07T10:46:54.945Z',captured_ui:p.captured_ui,request_sha256:digest(request),preview_receipt_sha256:H,projection_sha256:H,report_sha256:p.report_sha256,
    review:{path:'docs/design-review/exact-current-review.json',sha256:p.review_sha256},failures:p.failures,budgets:p.budgets,captured_code_sha256:digest(captured),controller_code_sha256:digest(current),controller_changes:{'.github/scripts/publication-state.mjs':{before:captured['.github/scripts/publication-state.mjs'],after:current['.github/scripts/publication-state.mjs']}}};
  const bytes=Buffer.from(JSON.stringify(approval));
  const pin={schema_version:'financial-performance-candidate-pin-v1',repository:repo,workflow:p.workflow,head_sha:S,run_id:88001,run_attempt:1,job_id:89001,artifact_id:87001,artifact_name:'financial-performance-candidate-88001-1',artifact_sha256:H,candidate_record_sha256:H,projection_sha256:H,preview_receipt_sha256:H,approval_sha256:sha256(bytes)};
  const ui={type:exceptionType,sha:p.captured_ui.sha,ui_digest:p.captured_ui.digest,controller_sha:S,approval_sha256:pin.approval_sha256,certificate:pin};
  const apiData={},register=(id,head,path,event,conclusion,jobs)=>{
    const run={id,run_attempt:1,head_sha:head,path,event,head_branch:event==='pull_request'?'improve/financial-repair':'main',status:'completed',conclusion,repository:{full_name:repo},head_repository:{full_name:repo},run_started_at:'2026-10-05T22:00:00Z'};
    const base=`repos/${repo}/actions/runs/${id}`;apiData[`${base}/attempts/1`]=run;apiData[`${base}/attempts/1/jobs?per_page=100`]=[{jobs:jobs.map(j=>({run_id:id,run_attempt:1,head_sha:head,status:'completed',started_at:'2026-10-05T22:01:00Z',completed_at:'2026-10-05T22:02:00Z',...j}))}];return run;
  };
  register(p.ci_run_id,p.capture_head_sha,'.github/workflows/ci.yml','pull_request','success',p.capture_ci_jobs);
  register(p.design_run_id,p.capture_head_sha,'.github/workflows/design-acceptance.yml','pull_request','failure',[{name:'Real-data design and performance budgets',id:p.design_job_id,conclusion:'failure',steps:clone(p.design_steps)}]);
  const cert=register(pin.run_id,S,p.workflow,'workflow_run','success',[{id:pin.job_id,name:p.job,conclusion:'success',steps:p.steps.map(name=>({name,conclusion:'success'}))}]);
  apiData[`repos/${repo}/git/commits/${p.captured_ui.sha}`]={sha:p.captured_ui.sha,tree:{sha:p.captured_ui.tree},parents:[{sha:p.capture_base_sha},{sha:p.capture_head_sha}]};
  const requestBytes=Buffer.from(JSON.stringify(request));apiData[`repos/${repo}/contents/.github/financial-release-request.json?ref=${S}`]={type:'file',encoding:'base64',size:requestBytes.length,content:requestBytes.toString('base64')};
  apiData[`repos/${repo}/contents/${p.approval_path}?ref=${S}`]={type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')};
  apiData[`repos/${repo}/actions/runs/${pin.run_id}/artifacts?per_page=100`]=[{artifacts:[{id:pin.artifact_id,name:pin.artifact_name,digest:`sha256:${H}`,expired:false,expires_at:'2026-10-08T00:00:00Z',size_in_bytes:1,created_at:'2026-10-05T22:01:30Z',workflow_run:{id:pin.run_id,head_sha:S,head_branch:'main'}}]}];
  apiData[`repos/${repo}/git/commits/${S}`]={sha:S,tree:{sha:T}};
  for(const [treeSha,inventory]of [[p.captured_ui.tree,captured],[T,current]])apiData[`repos/${repo}/git/trees/${treeSha}?recursive=1`]={sha:treeSha,truncated:false,tree:Object.entries(inventory).map(([path,entry])=>({path,type:'blob',...entry}))};
  const calls=[],api=endpoint=>{calls.push(endpoint);if(!Object.hasOwn(apiData,endpoint))throw Error(`Unexpected API ${endpoint}`);return clone(apiData[endpoint]);};
  return {approval,request,bytes,pin,ui,captured,current,apiData,api,calls,cert,receipt:{ui_sha:ui.sha,ui_digest:ui.ui_digest,approval:ui,financial_release:{schema_version:'financial-release-receipt-v1'}}};
}
test('approval is one exact immutable capture, not a threshold change',()=>{
  const f=fixture();assert.equal(parsePerformanceApproval(f.approval).captured_ui.sha,p.captured_ui.sha);assert.equal(verifyExceptionCode(f),true);
  for(const change of [v=>v.scope='all-ui',v=>v.future_ui=true,v=>v.captured_ui={...v.captured_ui,sha:S},v=>v.failures=v.failures.slice(1),v=>v.budgets={...v.budgets,p1_ready_ms:5000},v=>v.review.sha256=H,v=>v.activation_not_after='2026-11-01T00:00:00Z']){
    const value=clone(f.approval);change(value);assert.throws(()=>parsePerformanceApproval(value));
  }
});
test('activation deadline expires without erasing historical UI acceptance',()=>{
  const f=fixture(),later=Date.parse('2026-10-08T00:00:00Z');assert.throws(()=>parsePerformanceApproval(f.approval,{activation:true,now:later}),/expired/);assert.doesNotThrow(()=>parsePerformanceApproval(f.approval,{now:later}));
});
test('all protected code stays equal outside the exact enumerated controller patch',()=>{
  const f=fixture();f.current['frontend/package-lock.json']={mode:'100644',sha:S};f.approval.controller_code_sha256=digest(f.current);
  assert.throws(()=>verifyExceptionCode(f),/controller-only/);
  f.approval.controller_changes['frontend/package-lock.json']={before:f.captured['frontend/package-lock.json'],after:f.current['frontend/package-lock.json']};assert.throws(()=>verifyExceptionCode(f),/consumer\/projector/);
});
test('PR head, executed merge capture and current controller are separate evidence',()=>{
  const f=fixture(),result=verifyOriginalExceptionCapture(f.api);assert.equal(result.checks.length,5);assert.equal(result.checks.find(c=>c.name==='Publish Docker Images').conclusion,'skipped');
  assert.ok(result.checks.every(c=>c.head_sha===p.capture_head_sha));assert.notEqual(p.capture_head_sha,p.captured_ui.sha);
  f.apiData[`repos/${repo}/git/commits/${p.captured_ui.sha}`].parents.reverse();assert.throws(()=>verifyOriginalExceptionCapture(f.api),/parents/);
});
for(const [name,mutate]of [
  ['changed capture CI attempt',f=>f.apiData[`repos/${repo}/actions/runs/${p.ci_run_id}/attempts/1`].run_attempt=2],
  ['failed capture CI',f=>f.apiData[`repos/${repo}/actions/runs/${p.ci_run_id}/attempts/1`].conclusion='failure'],
  ['relabeled successful Design',f=>f.apiData[`repos/${repo}/actions/runs/${p.design_run_id}/attempts/1`].conclusion='success'],
  ['fake Docker success',f=>f.apiData[`repos/${repo}/actions/runs/${p.ci_run_id}/attempts/1/jobs?per_page=100`][0].jobs.at(-1).conclusion='success'],
  ['missing quality job',f=>f.apiData[`repos/${repo}/actions/runs/${p.ci_run_id}/attempts/1/jobs?per_page=100`][0].jobs.pop()],
  ['different capture tree',f=>f.apiData[`repos/${repo}/git/commits/${p.captured_ui.sha}`].tree.sha=S],
  ['foreign capture repository',f=>f.apiData[`repos/${repo}/actions/runs/${p.design_run_id}/attempts/1`].head_repository.full_name='foreign/repo'],
])test(`rejects ${name}`,()=>{const f=fixture();mutate(f);assert.throws(()=>verifyOriginalExceptionCapture(f.api));});
test('durable live exception verifies exact approval and success certificate without requiring expired input artifacts',()=>{
  const f=fixture();verifyApproval(f.receipt,repo,f.api);const result=verifyPerformanceUiApproval(f.receipt,repo,f.api);validateExceptionChecks(f.ui,result.checks);
  assert.equal(result.checks.at(-1).conclusion,'success');assert.equal(f.calls.some(c=>c.includes('/artifacts')),false);
  assert.throws(()=>verifyCorrectionConsumerChecks({uiSha:f.ui.sha,approval:f.ui},repo,f.api),/explicit CI and Design/);
  assert.throws(()=>verifyApproval({...f.receipt,ui_digest:H},repo,f.api),/different UI/);
});
for(const [name,mutate]of [
 ['certificate failed',f=>f.apiData[`repos/${repo}/actions/runs/${f.pin.run_id}/attempts/1`].conclusion='failure'],
 ['certificate PR',f=>f.apiData[`repos/${repo}/actions/runs/${f.pin.run_id}/attempts/1`].event='pull_request'],
 ['certificate skipped seal',f=>f.apiData[`repos/${repo}/actions/runs/${f.pin.run_id}/attempts/1/jobs?per_page=100`][0].jobs[0].steps.at(-1).conclusion='skipped'],
 ['approval replaced',f=>f.apiData[`repos/${repo}/contents/${p.approval_path}?ref=${S}`].content=Buffer.from('{}').toString('base64')],
 ['certificate job substitution',f=>f.pin.job_id++],
])test(`live approval rejects ${name}`,()=>{const f=fixture();mutate(f);assert.throws(()=>verifyPerformanceUiApproval(f.receipt,repo,f.api));});
test('initial activation still requires present unexpired exact certificate artifact',()=>{
  const f=fixture();verifyExceptionCertificate(f.pin,f.api,{artifact:true,now:Date.parse('2026-10-05T23:00:00Z')});
  assert.throws(()=>verifyExceptionCertificate(f.pin,f.api,{artifact:true,now:Date.parse('2026-10-09T00:00:00Z')}),/artifact/);
  f.apiData[`repos/${repo}/actions/runs/${f.pin.run_id}/artifacts?per_page=100`][0].artifacts[0].workflow_run.head_sha=T;
  assert.throws(()=>verifyExceptionCertificate(f.pin,f.api,{artifact:true}),/artifact/);
});
function reviewFixture(){
 const screenshots={},screens=Array.from({length:134},(_,i)=>{const screenshot=`screen-${i}.png`;screenshots[screenshot]=H;return {key:`screen/${i}`,screenshot,metrics:{smallTargets:[],fontIssues:[],radiusIssues:[],asciiNegativeValues:[],horizontalOverflow:false},axe:[]};});
 return {screenshots,report:{commit:p.captured_ui.sha,failures:p.failures,screens},review:{observed_commit:p.captured_ui.sha,captured_tree:p.captured_ui.tree,report_json_sha256:p.report_sha256,performance_exception_approved:false,release_approved:false,objective_nonperformance_failure_count:0,objective_failures:p.failures,screens:screens.map(s=>({...s,sha256:H,scores:Object.fromEntries(['design','usability','originality','content'].map(k=>[k,{value:8,reason:'Explicit reviewed rationale'}]))}))}};
}
test('134-screen nonperformance validation preserves all eight failures and historical false flags',()=>{
 const f=reviewFixture();assert.equal(validatePerformanceReviewContent(f).failure_count,8);
 for(const mutate of [v=>v.report.screens.pop(),v=>v.review.screens[1].key=v.review.screens[0].key,v=>v.review.screens[0].scores.design.value=7.9,v=>v.review.release_approved=true,v=>v.report.failures=[],v=>v.screenshots['screen-0.png']='b'.repeat(64),v=>v.report.screens[0].axe.push({}),v=>v.report.screens[0].metrics.horizontalOverflow=true]){const copy=clone(f);mutate(copy);assert.throws(()=>validatePerformanceReviewContent(copy));}
 assert.throws(()=>verifyPerformanceReview({approval:fixture().approval,reportBytes:Buffer.from(JSON.stringify(f.report)),reviewBytes:Buffer.from(JSON.stringify(f.review)),screenshots:f.screenshots}),/bytes changed/);
});
test('pin and UI approval contracts are closed; no ordinary gate accepts the failure',()=>{
 const f=fixture();parseExceptionPin(f.pin);parseExceptionUiApproval(f.ui);
 assert.throws(()=>parseExceptionPin({...f.pin,publish:true}));assert.throws(()=>parseExceptionUiApproval({...f.ui,sha:S}));
 const event={repository:{full_name:repo,default_branch:'main'}};
 const result=publicationDecision({eventName:'workflow_dispatch',event,sha:S,currentSha:S,runs:[{...f.cert,path:'.github/workflows/ci.yml',event:'push'}]});assert.equal(result.mode,'data');assert.equal(result.approval,undefined);
});
test('all new controls are absent by default and disabled CLI performs no network call',()=>{
 const root=mkdtempSync(join(tmpdir(),'performance-exception-disabled-'));
 try{assert.equal(readExceptionPin(root),null);assert.equal(readExceptionReleaseIntent(root),null);
 const path=fileURLToPath(new URL('./financial-performance-exception.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[path,'prepare'],{cwd:root,encoding:'utf8',timeout:10000,env:{PATH:root}});assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
 mkdirSync(join(root,'.github'));writeFileSync(join(root,p.release_intent_path),JSON.stringify({enabled:true}));assert.throws(()=>readExceptionReleaseIntent(root));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('certification is artifact-only and publisher retains trusted existing completion triggers',()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),workflow=readFileSync(join(root,p.workflow),'utf8');
 assert.match(workflow,/workflows: \[CI\]/);assert.match(workflow,/node .* prepare/);assert.match(workflow,/node .* seal/);assert.doesNotMatch(workflow,/pages: write|deploy-pages|workflow_dispatch|continue-on-error/);
 const publication=readFileSync(join(root,'.github/workflows/research-ui-release.yml'),'utf8');assert.match(publication,/workflows: \[CI, Design Acceptance, Static Site\]/);
});

for(const [name,mutate]of [
 ['truncated controller tree',f=>f.apiData[`repos/${repo}/git/trees/${T}?recursive=1`].truncated=true],
 ['changed certifier code',f=>f.apiData[`repos/${repo}/git/trees/${T}?recursive=1`].tree[0].sha=S],
 ['special controller file',f=>f.apiData[`repos/${repo}/git/trees/${T}?recursive=1`].tree[0].mode='120000'],
 ['duplicate controller path',f=>f.apiData[`repos/${repo}/git/trees/${T}?recursive=1`].tree.push(f.apiData[`repos/${repo}/git/trees/${T}?recursive=1`].tree[0])],
 ['changed immutable request',f=>f.apiData[`repos/${repo}/contents/.github/financial-release-request.json?ref=${S}`].content=Buffer.from('{}').toString('base64')],
 ['new unrelated failed Design step',f=>f.apiData[`repos/${repo}/actions/runs/${p.design_run_id}/attempts/1/jobs?per_page=100`][0].jobs[0].steps.push({name:'Unrelated integrity check',conclusion:'failure'})],
 ['relabeled diagnostic as successful candidate',f=>f.apiData[`repos/${repo}/actions/runs/${p.design_run_id}/attempts/1/jobs?per_page=100`][0].jobs[0].steps.find(s=>s.name==='Seal the exact tested financial candidate').conclusion='success'],
])test(`durable exception rejects ${name}`,()=>{const f=fixture();mutate(f);assert.throws(()=>verifyPerformanceUiApproval(f.receipt,repo,f.api));});
test('exception cannot be stripped from its one approved financial projection and source lineage',()=>{
 const f=fixture(),verified=verifyPerformanceUiApproval(f.receipt,repo,f.api),financial={mode:'activation',previous_publication_identity:f.request.correction.previous_publication_identity,ui:{approval:f.ui},source_projection:{sha256:f.approval.projection_sha256},lineage:{source:f.request.correction.source,certificate:f.request.source_validation.certificate}};
 verifyExceptionFinancialScope(financial,verified);verifyExceptionFinancialScope({...financial,mode:'carry',previous_publication_identity:'later verified price publication'},verified);
 for(const mutate of [v=>v.source_projection.sha256='c'.repeat(64),v=>v.lineage.source={identity:'new-source'},v=>v.lineage.certificate={identity:'new-certificate'},v=>v.previous_publication_identity='superseded',v=>v.ui.approval={type:'gates'}]){const copy=clone(financial);mutate(copy);assert.throws(()=>verifyExceptionFinancialScope(copy,verified));}
 const stripped={...f.receipt};delete stripped.financial_release;assert.throws(()=>verifyApproval(stripped,repo,f.api),/requires financial lineage/);
});

test('certifier CLI checks current CI and idempotently skips an existing pin after activation deadline',()=>{
 const root=mkdtempSync(join(tmpdir(),'exception-certifier-cli-')),f=fixture(),bin=join(root,'bin'),output=join(root,'output'),config=join(root,'api.json');
 try{
  mkdirSync(join(root,'.github'));mkdirSync(bin);
  const expired={...f.approval,approved_at:'2026-10-04T00:00:00Z',activation_not_after:'2026-10-04T01:00:00Z'},bytes=Buffer.from(JSON.stringify(expired));
  writeFileSync(join(root,p.approval_path),bytes);writeFileSync(join(root,p.pin_path),JSON.stringify({...f.pin,approval_sha256:sha256(bytes)}));
  execFileSync('git',['init','-q',root]);execFileSync('git',['-C',root,'add','.github']);execFileSync('git',['-C',root,'-c','user.name=Offline fixture','-c','user.email=fixture@example.invalid','commit','-qm','Synthetic control fixture']);
  const revision=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),ci={id:99,run_attempt:1,head_sha:revision,path:'.github/workflows/ci.yml',head_branch:'main',event:'push',status:'completed',conclusion:'success',repository:{full_name:repo},head_repository:{full_name:repo}};
  const api={
   [`repos/${repo}/git/ref/heads/main`]:{object:{sha:revision}},
   [`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${revision}&per_page=100`]:[{workflow_runs:[ci]}],
   [`repos/${repo}/actions/runs/99/attempts/1`]:ci,
   [`repos/${repo}/actions/runs/99/attempts/1/jobs?per_page=100`]:[{jobs:p.capture_ci_jobs.map((j,i)=>({id:900+i,run_attempt:1,name:j.name,status:'completed',conclusion:'success'}))}],
  };
  const event=join(root,'event.json');writeFileSync(event,JSON.stringify({workflow_run:ci}));writeFileSync(config,JSON.stringify(api));
  writeFileSync(join(bin,'gh'),`#!${process.execPath}\nconst fs=require('node:fs'),api=JSON.parse(fs.readFileSync(process.env.CERTIFIER_TEST_API)),endpoint=process.argv.at(-1);if(!Object.hasOwn(api,endpoint))throw Error('Unexpected API '+endpoint);process.stdout.write(JSON.stringify(api[endpoint]));\n`);chmodSync(join(bin,'gh'),0o755);
  const cli=fileURLToPath(new URL('./financial-performance-exception.mjs',import.meta.url));
  const invoke=()=>spawnSync(process.execPath,[cli,'prepare'],{cwd:root,encoding:'utf8',timeout:10000,env:{PATH:`${bin}:${process.env.PATH}`,CERTIFIER_TEST_API:config,GITHUB_SHA:revision,GITHUB_EVENT_PATH:event,GITHUB_EVENT_NAME:'workflow_run',GITHUB_OUTPUT:output}});
  const result=invoke();assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(output,'utf8'),'candidate=false\n');
  api[`repos/${repo}/actions/runs/99/attempts/1/jobs?per_page=100`][0].jobs.at(-1).conclusion='failure';writeFileSync(config,JSON.stringify(api));assert.match(invoke().stderr,/successful CI job/);
  api[`repos/${repo}/git/ref/heads/main`].object.sha=S;writeFileSync(config,JSON.stringify(api));assert.match(invoke().stderr,/no longer current main/);
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('retained original Design archive cannot be replaced by a report-only or empty file',()=>{
 const root=mkdtempSync(join(tmpdir(),'exception-design-archive-'));
 try{const path=join(root,'design.zip');writeFileSync(path,'');assert.throws(()=>verifyRetainedDesignArchive(path),/Design ZIP changed/);writeFileSync(path,JSON.stringify({failures:p.failures}));assert.throws(()=>verifyRetainedDesignArchive(path),/Design ZIP changed/);}finally{rmSync(root,{recursive:true,force:true});}
});
