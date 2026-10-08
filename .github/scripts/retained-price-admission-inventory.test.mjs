import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRetainedPriceAdmissionApi,createRetainedPriceAdmissionInventory,ADMISSION_INVENTORY_LIMITS} from './retained-price-admission-inventory.mjs';
import {admissionSnapshotResult} from './fixtures/retained-price-admission-inventory.mjs';
import {REPOSITORY,REPOSITORY_ID,LIMITS,route} from './retained-price-repository-inventory.mjs';

const head='a'.repeat(40),repo={id:REPOSITORY_ID,full_name:REPOSITORY};
const workflows=[[294252465,'.github/workflows/ci.yml','push'],[294257497,'.github/workflows/static-site.yml','workflow_run'],[364666954,'.github/workflows/research-ui-release.yml','workflow_run']];
const endpoint=(id,event)=>'repos/'+REPOSITORY+'/actions/workflows/'+id+'/runs?branch=main&event='+event+'&head_sha='+head+'&per_page=100';
function row(id,workflow=workflows[1],extra={}){
  return {id,workflow_id:workflow[0],path:workflow[1],event:workflow[2],head_sha:head,head_branch:'main',run_attempt:1,
    status:'completed',conclusion:'success',created_at:'2026-10-08T00:00:00Z',run_started_at:'2026-10-08T00:00:01Z',updated_at:'2026-10-08T00:00:02Z',
    repository:repo,head_repository:repo,...extra};
}
function setup({runs=[row(100,workflows[0]),row(200),row(300,workflows[2])],sequence,runHook,monotonic=()=>0}={}){
  const reads=[],workers=[],reports=[];
  const api=createRetainedPriceAdmissionApi((path,paginate)=>{reads.push({path,paginate});return {fresh:reads.length};},{
    monotonic,report:v=>reports.push(v),
    run:(node,args,options)=>{
      workers.push({node,args,options});if(runHook)return runHook(workers.length);
      const result=sequence?sequence[Math.min(workers.length-1,sequence.length-1)]:admissionSnapshotResult(runs);
      return typeof result==='string'?result:JSON.stringify(result);
    }});
  const scope=()=>createRetainedPriceAdmissionInventory(api,{requiredIds:[100,200],head});
  return {api,scope,reads,workers,reports,runs};
}
test('real repository shape projects exact closed routes once, preserves reruns, and leaves individual reads fresh',()=>{
  const f=setup({runs:[row(100,workflows[0]),row(200),row(201,workflows[1],{run_attempt:2}),row(300,workflows[2]),
    row(500,workflows[0],{head_sha:'b'.repeat(40)}),row(600,workflows[1],{event:'schedule'}),row(700,workflows[2],{head_branch:'other'}),
    row(800,workflows[1],{head_repository:{id:77,full_name:'other/repository'}})]});
  const scoped=f.scope();
  assert.deepEqual(scoped('repos/'+REPOSITORY+'/actions/runs/200'),{fresh:1});
  assert.equal(f.workers.length,0);
  const producer=scoped(endpoint(294257497,'workflow_run'),true);assert.deepEqual(producer[0].workflow_runs.map(r=>[r.id,r.run_attempt]),[[200,1],[201,2]]);
  producer[0].workflow_runs[0].id=999;
  assert.equal(scoped(endpoint(294257497,'workflow_run'),true)[0].workflow_runs[0].id,200);
  assert.deepEqual(scoped(endpoint(294252465,'push'),true)[0].workflow_runs.map(r=>r.id),[100]);
  assert.deepEqual(scoped(endpoint(364666954,'workflow_run'),true)[0].workflow_runs.map(r=>r.id),[300]);
  assert.equal(f.workers.length,1);assert.equal(f.reports.length,1);assert.equal(f.reports[0].status,'complete');
  assert.deepEqual(f.reports[0].required_run_ids,[100,200]);assert.equal(f.reports[0].repository_total_count,8);
  assert.deepEqual(JSON.parse(f.workers[0].options.input),{timeoutMs:30000,requiredIds:[100,200]});
  assert.equal(f.workers[0].options.timeout,30000);assert.equal(f.workers[0].options.maxBuffer,64*1024**2);
  for(const suffix of ['', '/attempts/1', '/attempts/1/jobs?per_page=100'])scoped('repos/'+REPOSITORY+'/actions/runs/200'+suffix,suffix.includes('jobs'));
  assert.equal(f.reads.length,4);assert.equal(f.workers.length,1);
  scoped.dispose();assert.throws(()=>scoped('repos/'+REPOSITORY+'/actions/runs/200'),/disposed/);
  const later=f.scope();later(endpoint(294252465,'push'),true);assert.equal(f.workers.length,2);assert.notEqual(f.reports[0].snapshot_id,f.reports[1].snapshot_id);later.dispose();
});
test('complete multiple pages keep real pagination and safe page evidence',()=>{
  const runs=[row(100,workflows[0]),row(200),...Array.from({length:99},(_v,i)=>row(1000+i))],f=setup({runs}),scope=f.scope();
  const pages=scope(endpoint(294257497,'workflow_run'),true);
  assert.equal(pages.length,1);assert.equal(pages[0].total_count,100);
  const report=f.reports[0];assert.equal(report.repository_pages,3);assert.equal(report.page_evidence.length,3);
  for(const p of report.page_evidence){assert.equal(p.requested_route,route(p.page_number));assert.match(p.body_sha256,/^[a-f0-9]{64}$/);assert.match(p.ids_sha256,/^[a-f0-9]{64}$/);}
  assert.equal(report.repository_inventory_sha256,createHash('sha256').update(JSON.stringify(admissionSnapshotResult(runs).pages)).digest('hex'));scope.dispose();
});
test('missing anchors, duplicates, incomplete pages and whole-snapshot CI identity conflicts reject without fallback',()=>{
  const variants=[
    [runs=>runs.filter(r=>r.id!==200),'required-run-anchor-absent'],
    [runs=>[...runs,{...runs[0]}],'invalid-or-duplicate-run'],
    [runs=>[...runs,row(400,workflows[0],{path:'.github/workflows/other.yml',head_sha:'b'.repeat(40),head_branch:'other'})],'conflicting-workflow-identity'],
    [runs=>[...runs,row(400,workflows[1],{workflow_id:999})],'conflicting-workflow-identity'],
    [runs=>[...runs,row(400,workflows[0],{repository:{id:1,full_name:'other/repository'}})],'foreign-repository-run']
  ];
  for(const [change,reason] of variants){
    const f=setup(),bad=admissionSnapshotResult(change(f.runs));f.api=createRetainedPriceAdmissionApi(()=>assert.fail('No filtered fallback'),{run:()=>JSON.stringify(bad),report:r=>f.reports.push(r)});
    const scope=createRetainedPriceAdmissionInventory(f.api,{requiredIds:[100,200],head});
    try{assert.throws(()=>scope(endpoint(294252465,'push'),true),new RegExp(reason));assert.equal(f.reports.at(-1).retry,false);assert.equal(f.reports.at(-1).reason,reason);}
    finally{scope.dispose();}assert.throws(()=>scope(endpoint(294252465,'push'),true),/disposed/);
  }
  const bad=admissionSnapshotResult([row(100,workflows[0]),row(200)]);bad.pages[0].value.total_count=51;
  const f=setup({sequence:[bad]}),scope=f.scope();assert.throws(()=>scope(endpoint(294252465,'push'),true),/incomplete-inventory/);assert.equal(f.workers.length,1);scope.dispose();
});
test('denial wins over retryable drift and never retries or falls back',()=>{
  for(const facts of [{status:403},{status:200,safe_headers:{'x-ratelimit-remaining':'0'}},{status:200,safe_headers:{retry_after_present:true}}]){
    const failure={schema_version:'retained-price-repository-snapshot-v1',status:'failed',reason:'changing-inventory-total',retryable:true,body_bytes:0,
      evidence:[{page_number:1,requested_route:route(1),body_bytes:0,...facts}]};
    const f=setup({sequence:[failure]}),scope=f.scope();
    assert.throws(()=>scope(endpoint(294252465,'push'),true),/http-or-security-denial/);assert.equal(f.workers.length,1);assert.equal(f.reads.length,0);assert.equal(f.reports[0].retry,false);scope.dispose();
  }
});
test('only bounded explicitly retryable transport failures retry a fully fresh worker',()=>{
  const success=admissionSnapshotResult([row(100,workflows[0]),row(200)]);
  for(const reason of ['transport-timeout','transport-or-json-eof','json-eof','changing-inventory-total']){
    const failed={schema_version:'retained-price-repository-snapshot-v1',status:'failed',reason,retryable:true,evidence:[],body_bytes:0};
    const f=setup({sequence:[failed,success]}),scope=f.scope();scope(endpoint(294252465,'push'),true);
    assert.equal(f.workers.length,2);assert.equal(f.reports[0].retry,true);assert.equal(f.reports[1].fresh_from_page,1);scope.dispose();
    const g=setup({sequence:[{...failed,retryable:false},success]}),blocked=g.scope();assert.throws(()=>blocked(endpoint(294252465,'push'),true),new RegExp(reason));assert.equal(g.workers.length,1);blocked.dispose();
  }
  let time=0;const f=setup({monotonic:()=>time,runHook:()=>{time+=30000;throw Object.assign(Error('timeout'),{code:'ETIMEDOUT'});}}),scope=f.scope();
  assert.throws(()=>scope(endpoint(294252465,'push'),true),/transport-timeout/);assert.equal(f.workers.length,2);assert.equal(f.reports[1].inventory_budget_used_ms,60000);assert.equal(f.reports[1].retry,false);scope.dispose();
  assert.equal(ADMISSION_INVENTORY_LIMITS.attempts,2);assert.equal(ADMISSION_INVENTORY_LIMITS.totalMs,60000);assert.equal(LIMITS.runs,2000);
});
test('closed routes and evidence validation never cache individual metadata or accept malformed worker facts',()=>{
  const f=setup(),scope=f.scope();
  assert.throws(()=>scope(endpoint(294252465,'push'),false),/projection-call/);
  assert.throws(()=>scope(endpoint(294252465,'push')+'&page=2',true),/unknown-admission-inventory-route/);
  assert.throws(()=>scope(endpoint(294252465,'pull_request'),true),/unknown-admission-inventory-route/);
  assert.equal(f.workers.length,0);scope.dispose();
  const result=admissionSnapshotResult([row(100,workflows[0]),row(200)]);result.evidence[0].ids_sha256='f'.repeat(64);
  const g=setup({sequence:[result]}),blocked=g.scope();assert.throws(()=>blocked(endpoint(294252465,'push'),true),/invalid-worker-evidence/);assert.equal(g.reports[0].retry,false);blocked.dispose();
});
test('failure and success diagnostics contain bounded facts without arbitrary stderr or headers',()=>{
  const f=setup({runHook:()=>{throw Object.assign(Error('403 forbidden'),{stderr:'secret diagnostic',stdout:'partial public body',status:1});}}),scope=f.scope();
  assert.throws(()=>scope(endpoint(294252465,'push'),true),/http-or-security-denial/);
  const raw=JSON.stringify(f.reports);assert(!raw.includes('secret diagnostic'));assert(!raw.includes('partial public body'));assert.match(f.reports[0].failed_stderr.sha256,/^[a-f0-9]{64}$/);scope.dispose();
});
