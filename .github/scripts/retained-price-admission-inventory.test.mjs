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


// Synthetic budget lifecycle only; these hooks grant no caller authority.
function acquisitionBudgetFixture({provider,sequence,runHook,reportHook,monotonic=()=>0,
  runs=[row(100,workflows[0]),row(200),row(300,workflows[2])]}={}){
  const workers=[],reads=[],reports=[];
  const options={monotonic,report:value=>{reports.push(value);if(reportHook)reportHook(value);},
    run:(node,args,config)=>{
      workers.push({node,args,options:config});
      if(runHook)return runHook(workers.length);
      const result=sequence?sequence[Math.min(workers.length-1,sequence.length-1)]:admissionSnapshotResult(runs);
      return typeof result==='string'?result:JSON.stringify(result);
    }};
  if(provider!==undefined)options.budgetProvider=provider;
  const api=createRetainedPriceAdmissionApi((path,paginate)=>{reads.push({path,paginate});return {fresh:reads.length};},options);
  const scope=createRetainedPriceAdmissionInventory(api,{requiredIds:[100,200],head});
  return {api,scope,workers,reads,reports};
}
function acquisitionBudgetHooks(){
  const receipt={toJSON(){throw Error('Private receipt must never serialize');}};
  receipt.self=receipt;
  const descriptors=[],attempts=[],finals=[];
  const hooks={
    beforeAcquisition:value=>{descriptors.push(value);return receipt;},
    afterAttempt:(value,sameReceipt)=>{assert.equal(sameReceipt,receipt);attempts.push(value);},
    afterAcquisition:(value,sameReceipt)=>{assert.equal(sameReceipt,receipt);finals.push(value);},
  };
  return {hooks,receipt,descriptors,attempts,finals};
}
function failedAcquisition(reason,evidence=[]){
  return {schema_version:'retained-price-repository-snapshot-v1',status:'failed',reason,retryable:true,evidence,body_bytes:0};
}
test('native budget provider is lazy, privately paired once, and leaves original API projections intact',()=>{
  const b=acquisitionBudgetHooks();let providers=0;
  const hidden='synthetic-private-run-extra';
  const f=acquisitionBudgetFixture({provider:()=>{providers++;return b.hooks;},
    runs:[row(100,workflows[0],{extra:hidden}),row(200),row(300,workflows[2])]});
  assert.equal(providers,0);assert.equal(f.workers.length,0);
  assert.deepEqual(f.scope('repos/'+REPOSITORY+'/actions/runs/200'),{fresh:1});assert.equal(providers,0);
  const result=f.scope(endpoint(294252465,'push'),true);
  assert.equal(result[0].workflow_runs[0].extra,hidden);
  assert.equal(providers,1);assert.equal(f.workers.length,1);assert.equal(b.descriptors.length,1);
  assert.deepEqual(b.descriptors[0],{head,requiredIds:[100,200],maximumStarts:80,maximumPrimary:160,timeoutMs:60000});
  assert.equal(Object.isFrozen(b.descriptors[0]),true);assert.equal(Object.isFrozen(b.descriptors[0].requiredIds),true);
  assert.equal(Object.isFrozen(b.receipt),false);assert.equal(b.receipt.self,b.receipt);
  assert.equal(b.attempts.length,1);assert.equal(b.finals.length,1);assert.equal(b.finals[0].status,'complete');
  assert.equal(b.finals[0].entered_attempts,1);assert.deepEqual(b.finals[0].attempts,b.attempts);
  assert.equal(b.attempts[0].command_started,true);assert.equal(b.attempts[0].native_request_issued,null);
  assert.equal(b.attempts[0].wire_request_count,null);assert.equal(b.attempts[0].page_evidence[0].quota_resource,null);
  assert.equal(Object.isFrozen(b.finals[0].attempts),true);
  assert.doesNotMatch(JSON.stringify(b.attempts)+JSON.stringify(b.finals),new RegExp(hidden+'|workflow_runs|projections|failed_stdout|failed_stderr|toJSON|receipt'));
  result[0].workflow_runs[0].id=999;
  assert.equal(f.scope(endpoint(294252465,'push'),true)[0].workflow_runs[0].id,100);
  f.scope(endpoint(294257497,'workflow_run'),true);assert.equal(providers,1);assert.equal(f.workers.length,1);
  assert.deepEqual(JSON.parse(f.workers[0].options.input),{timeoutMs:30000,requiredIds:[100,200]});
  assert.equal(f.workers[0].options.timeout,30000);assert.equal(f.workers[0].options.maxBuffer,64*1024**2);
  f.scope.dispose();assert.throws(()=>f.scope(endpoint(294252465,'push'),true),/disposed/);
});
test('inactive native providers preserve the original fresh two-attempt operation without budget fallback',()=>{
  for(const inactive of [null,undefined]){
    let providers=0;
    const f=acquisitionBudgetFixture({provider:()=>{providers++;return inactive;},
      sequence:[failedAcquisition('json-eof'),admissionSnapshotResult([row(100,workflows[0]),row(200)])]});
    assert.deepEqual(f.scope(endpoint(294252465,'push'),true)[0].workflow_runs.map(r=>r.id),[100]);
    assert.equal(providers,1);assert.equal(f.workers.length,2);assert.equal(f.reports[0].retry,true);
    f.scope.dispose();
  }
});
test('all native attempt evidence survives a bounded retry under one acquisition receipt',()=>{
  const b=acquisitionBudgetHooks();
  const evidence=[{page_number:1,requested_route:route(1),status:200,body_bytes:0},
    {page_number:2,requested_route:route(2),status:null,body_bytes:0,reason:'sibling-aborted'}];
  const f=acquisitionBudgetFixture({provider:()=>b.hooks,
    sequence:[failedAcquisition('json-eof',evidence),admissionSnapshotResult([row(100,workflows[0]),row(200)])]});
  f.scope(endpoint(294252465,'push'),true);
  assert.equal(f.workers.length,2);assert.equal(b.descriptors.length,1);assert.equal(b.attempts.length,2);assert.equal(b.finals.length,1);
  assert.equal(b.attempts[0].status,'failed');assert.equal(b.attempts[0].reason,'json-eof');assert.equal(b.attempts[0].retry_planned,true);
  assert.deepEqual(b.attempts[0].page_evidence.map(p=>p.status),[200,null]);
  assert.equal(b.attempts[1].status,'complete');assert.equal(b.attempts[1].retry_planned,false);
  assert.equal(b.finals[0].status,'complete');assert.equal(b.finals[0].entered_attempts,2);
  assert.deepEqual(b.finals[0].attempts,b.attempts);assert.equal(b.finals[0].maximumStarts,80);assert.equal(b.finals[0].maximumPrimary,160);
  f.scope.dispose();
});
test('native command failures stay unknown and private while both entered attempts settle',()=>{
  const b=acquisitionBudgetHooks(),hidden='synthetic private worker stdout and stderr';
  let clock=0;
  const f=acquisitionBudgetFixture({provider:()=>b.hooks,monotonic:()=>clock,
    runHook:()=>{clock+=30000;throw Object.assign(Error(hidden),{code:'ETIMEDOUT',status:1,stdout:hidden,stderr:hidden});}});
  assert.throws(()=>f.scope(endpoint(294252465,'push'),true),/transport-timeout/);
  assert.equal(f.workers.length,2);assert.equal(b.attempts.length,2);assert.equal(b.finals.length,1);
  assert.equal(b.attempts[0].retry_planned,true);assert.equal(b.attempts[1].retry_planned,false);
  for(const item of b.attempts){assert.equal(item.command_started,true);assert.equal(item.native_request_issued,null);assert.deepEqual(item.page_evidence,[]);}
  assert.equal(b.finals[0].status,'failed');assert.equal(b.finals[0].reason,'transport-timeout');
  assert.equal(b.finals[0].inventory_budget_used_ms,60000);
  assert.doesNotMatch(JSON.stringify(b.attempts)+JSON.stringify(b.finals),new RegExp(hidden+'|failed_stderr|failed_stdout'));
  f.scope.dispose();
});
test('native denial and original errors win over cleanup failures and prevent a further attempt',()=>{
  const b=acquisitionBudgetHooks();
  b.hooks.afterAttempt=(value,receipt)=>{assert.equal(receipt,b.receipt);b.attempts.push(value);throw Error('private attempt cleanup');};
  b.hooks.afterAcquisition=(value,receipt)=>{assert.equal(receipt,b.receipt);b.finals.push(value);throw Error('private acquisition cleanup');};
  const f=acquisitionBudgetFixture({provider:()=>b.hooks,sequence:[failedAcquisition('json-eof',[
    {page_number:1,requested_route:route(1),status:403,body_bytes:0}])]});
  assert.throws(()=>f.scope(endpoint(294252465,'push'),true),/http-or-security-denial/);
  assert.equal(f.workers.length,1);assert.equal(b.attempts.length,1);assert.equal(b.finals.length,1);
  assert.equal(b.attempts[0].page_evidence[0].status,403);assert.equal(b.finals[0].reason,'http-or-security-denial');
  f.scope.dispose();
  const c=acquisitionBudgetHooks(),original=Error('synthetic original report failure');
  c.hooks.afterAttempt=()=>{throw Error('private cleanup must not replace original');};
  c.hooks.afterAcquisition=(value,receipt)=>{assert.equal(receipt,c.receipt);c.finals.push(value);throw Error('private final cleanup');};
  const g=acquisitionBudgetFixture({provider:()=>c.hooks,reportHook:()=>{throw original;}});
  let caught;try{g.scope(endpoint(294252465,'push'),true);}catch(error){caught=error;}
  assert.equal(caught,original);assert.equal(g.workers.length,1);assert.equal(c.finals.length,1);
  assert.equal(c.finals[0].status,'failed');assert.equal(c.finals[0].reason,'unclassified-inventory-failure');
  assert.doesNotMatch(JSON.stringify(c.finals),/synthetic original report failure|private cleanup/);g.scope.dispose();
});
test('failed native budget hooks clear an assigned snapshot and poison later provider-null projections',()=>{
  for(const target of ['attempt','after','retry-attempt']){
    const b=acquisitionBudgetHooks();let providers=0;
    if(target!=='after')b.hooks.afterAttempt=(value,receipt)=>{assert.equal(receipt,b.receipt);b.attempts.push(value);return false;};
    else b.hooks.afterAcquisition=(value,receipt)=>{assert.equal(receipt,b.receipt);b.finals.push(value);return false;};
    const f=acquisitionBudgetFixture({provider:()=>{providers++;return providers===1?b.hooks:null;},
      sequence:target==='retry-attempt'?[failedAcquisition('json-eof'),admissionSnapshotResult([row(100,workflows[0]),row(200)])]:undefined});
    let caught;try{f.scope(endpoint(294252465,'push'),true);}catch(error){caught=error;}
    assert.equal(caught.inventoryReason,target==='retry-attempt'?'json-eof':target==='attempt'?'acquisition-budget-attempt':'acquisition-budget-after');
    assert.equal(f.workers.length,1);assert.equal(b.finals.length,1);
    let later;try{f.scope(endpoint(294257497,'workflow_run'),true);}catch(error){later=error;}
    assert.equal(later,caught);assert.equal(providers,1);assert.equal(f.workers.length,1);f.scope.dispose();
  }
});
test('invalid or asynchronous active native providers and before hooks fail closed before entry',async()=>{
  for(const mode of ['provider-throw','provider-async','provider-getter','missing-hook','hook-getter','before-false','before-throw','before-async']){
    const b=acquisitionBudgetHooks();let providers=0;
    if(mode==='missing-hook')b.hooks.afterAttempt=undefined;
    if(mode==='hook-getter')Object.defineProperty(b.hooks,'afterAttempt',{get(){throw null;}});
    if(mode==='before-false')b.hooks.beforeAcquisition=()=>false;
    if(mode==='before-throw')b.hooks.beforeAcquisition=()=>{throw Error('private before error');};
    if(mode==='before-async')b.hooks.beforeAcquisition=()=>Promise.reject(Error('private before async error'));
    const f=acquisitionBudgetFixture({provider:()=>{
      providers++;
      if(providers>1)return null;
      if(mode==='provider-throw')throw Error('private provider error');
      if(mode==='provider-async')return Promise.reject(Error('private provider async error'));
      if(mode==='provider-getter')return Object.defineProperty({},'then',{get(){throw Error('private provider getter');}});
      return b.hooks;
    }});
    let caught;try{f.scope(endpoint(294252465,'push'),true);}catch(error){caught=error;}
    assert.match(caught.inventoryReason,/^(?:invalid-acquisition-budget-provider|invalid-acquisition-budget-hooks|acquisition-budget-before)$/);
    assert.doesNotMatch(caught.message,/private /);assert.equal(f.workers.length,0);assert.equal(b.attempts.length,0);assert.equal(b.finals.length,0);
    let later;try{f.scope(endpoint(294252465,'push'),true);}catch(error){later=error;}
    assert.equal(later,caught);assert.equal(providers,1);f.scope.dispose();
    await new Promise(resolve=>setImmediate(resolve));
  }
  for(const budgetProvider of [null,0,'provider']){
    assert.throws(()=>createRetainedPriceAdmissionApi(()=>null,{budgetProvider}),/invalid-admission-reader/);
  }
});
test('a successful native before receipt settles once on pre-command failure with truthful no-entry facts',()=>{
  const b=acquisitionBudgetHooks(),original=Error('synthetic private clock failure');let clockFails=false;
  b.hooks.beforeAcquisition=value=>{b.descriptors.push(value);clockFails=true;return b.receipt;};
  b.hooks.afterAcquisition=(value,receipt)=>{assert.equal(receipt,b.receipt);b.finals.push(value);throw Error('private cleanup failure');};
  const f=acquisitionBudgetFixture({provider:()=>b.hooks,monotonic:()=>{if(clockFails)throw original;return 0;}});
  let caught;try{f.scope(endpoint(294252465,'push'),true);}catch(error){caught=error;}
  assert.equal(caught,original);assert.equal(f.workers.length,0);assert.equal(b.attempts.length,0);assert.equal(b.finals.length,1);
  assert.equal(b.finals[0].entered_attempts,0);assert.equal(b.finals[0].native_request_issued,false);
  assert.equal(b.finals[0].wire_request_count,null);assert.equal(b.finals[0].status,'failed');
  assert.equal(b.finals[0].reason,'unclassified-inventory-failure');
  assert.doesNotMatch(JSON.stringify(b.finals),/synthetic private clock failure|private cleanup failure/);f.scope.dispose();
});
test('native evidence keeps only literal core resource and bounded complete forty-page observations',()=>{
  for(const resource of [undefined,'core','graphql']){
    const b=acquisitionBudgetHooks(),result=admissionSnapshotResult([row(100,workflows[0]),row(200)]);
    if(resource!==undefined)result.evidence[0].safe_headers['x-ratelimit-resource']=resource;
    const f=acquisitionBudgetFixture({provider:()=>b.hooks,sequence:[result]});f.scope(endpoint(294252465,'push'),true);
    assert.equal(b.attempts[0].page_evidence[0].quota_resource,resource==='core'?'core':null);
    assert.equal(b.attempts[0].page_evidence[0].safe_headers['x-ratelimit-resource'],resource==='core'?'core':undefined);
    assert.doesNotMatch(JSON.stringify(b.attempts),/graphql/);f.scope.dispose();
  }
  const runs=[row(100,workflows[0]),row(200),...Array.from({length:1998},(_unused,index)=>row(1000+index,workflows[index%3]))];
  const b=acquisitionBudgetHooks(),f=acquisitionBudgetFixture({provider:()=>b.hooks,runs});
  f.scope(endpoint(294252465,'push'),true);
  assert.equal(f.workers.length,1);assert.equal(b.attempts[0].page_evidence.length,40);
  assert.equal(b.attempts[0].page_evidence.every(item=>item.status===200&&item.quota_resource===null),true);
  assert.equal(Buffer.byteLength(JSON.stringify(b.attempts[0]))<128*1024,true);
  assert.equal(Buffer.byteLength(JSON.stringify(b.finals[0]))<128*1024,true);
  assert.equal(b.finals[0].entered_attempts,1);f.scope.dispose();
});

test('direct native inventory options are lazy and pair one private receipt without wrapping the original API',()=>{
  const b=acquisitionBudgetHooks(),delegated=[],workers=[];let providers=0;
  const api=(path,paginate)=>{delegated.push({path,paginate});return {literal:delegated.length};};
  const originalApi=api;
  const scope=createRetainedPriceAdmissionInventory(api,{requiredIds:[100,200],head,
    budgetProvider:()=>{providers++;return b.hooks;},
    run:(node,args,options)=>{
      assert.equal(b.descriptors.length,1);workers.push({node,args,options});
      return JSON.stringify(admissionSnapshotResult([row(100,workflows[0]),row(200),row(300,workflows[2])]));
    }});
  assert.equal(providers,0);assert.equal(workers.length,0);assert.equal(api,originalApi);
  assert.deepEqual(scope('repos/'+REPOSITORY+'/actions/runs/200'),{literal:1});
  assert.equal(providers,0);assert.equal(workers.length,0);
  assert.deepEqual(scope(endpoint(294252465,'push'),true)[0].workflow_runs.map(item=>item.id),[100]);
  assert.equal(providers,1);assert.equal(workers.length,1);assert.equal(b.attempts.length,1);assert.equal(b.finals.length,1);
  assert.deepEqual(b.descriptors[0],{head,requiredIds:[100,200],maximumStarts:80,maximumPrimary:160,timeoutMs:60000});
  assert.equal(b.finals[0].status,'complete');
  assert.deepEqual(JSON.parse(workers[0].options.input),{timeoutMs:30000,requiredIds:[100,200]});
  assert.equal(workers[0].options.timeout,30000);assert.equal(workers[0].options.maxBuffer,64*1024**2);
  assert.equal(workers[0].node,process.execPath);
  assert.deepEqual(workers[0].args.slice(0,1),['--max-old-space-size=384']);
  assert.equal(workers[0].args[1].endsWith('retained-price-repository-inventory.mjs'),true);
  scope(endpoint(294257497,'workflow_run'),true);assert.equal(providers,1);assert.equal(workers.length,1);
  scope.dispose();assert.equal(api,originalApi);assert.deepEqual(api('literal-after-disposal',false),{literal:2});
  assert.deepEqual(delegated.at(-1),{path:'literal-after-disposal',paginate:false});assert.equal(providers,1);

  const stopped=acquisitionBudgetHooks();let wrapperEntries=0,nativeInvocationEntered=false;
  const blocked=createRetainedPriceAdmissionInventory(api,{requiredIds:[100,200],head,budgetProvider:()=>stopped.hooks,
    run:()=>{wrapperEntries++;assert.equal(stopped.descriptors.length,1);throw Error('synthetic outer phase deadline before stock exec');}});
  assert.throws(()=>blocked(endpoint(294252465,'push'),true),/unclassified-command-failure/);
  assert.equal(wrapperEntries,1);assert.equal(nativeInvocationEntered,false);
  assert.equal(stopped.attempts.length,1);assert.equal(stopped.finals.length,1);
  assert.equal(stopped.attempts[0].command_started,true);assert.equal(stopped.attempts[0].native_request_issued,null);
  assert.equal(stopped.finals[0].entered_attempts,1);assert.equal(stopped.finals[0].wire_request_count,null);
  blocked.dispose();

  const poisoned=acquisitionBudgetHooks();let choices=0,entered=0;
  poisoned.hooks.afterAcquisition=(value,receipt)=>{assert.equal(receipt,poisoned.receipt);poisoned.finals.push(value);return false;};
  const failed=createRetainedPriceAdmissionInventory(api,{requiredIds:[100,200],head,
    budgetProvider:()=>{choices++;return choices===1?poisoned.hooks:null;},
    run:()=>{entered++;return JSON.stringify(admissionSnapshotResult([row(100,workflows[0]),row(200)]));}});
  let rejection;try{failed(endpoint(294252465,'push'),true);}catch(error){rejection=error;}
  assert.equal(rejection.inventoryReason,'acquisition-budget-after');
  let later;try{failed(endpoint(294257497,'workflow_run'),true);}catch(error){later=error;}
  assert.equal(later,rejection);assert.equal(choices,1);assert.equal(entered,1);failed.dispose();
});
test('direct inventory transport options take precedence without mutating inherited metadata and reject invalid choices',()=>{
  for(const mode of ['both','provider','run','absent','undefined']){
    const inherited=acquisitionBudgetHooks(),direct=acquisitionBudgetHooks();
    let inheritedProviders=0,directProviders=0,inheritedRuns=0,directRuns=0;
    const result=JSON.stringify(admissionSnapshotResult([row(100,workflows[0]),row(200)]));
    const api=createRetainedPriceAdmissionApi(()=>({ordinary:true}),{
      budgetProvider:()=>{inheritedProviders++;return inherited.hooks;},
      run:()=>{inheritedRuns++;return result;},report:()=>{}});
    const options={requiredIds:[100,200],head};
    if(mode==='both'||mode==='provider')options.budgetProvider=()=>{directProviders++;return direct.hooks;};
    if(mode==='both'||mode==='run')options.run=()=>{directRuns++;return result;};
    if(mode==='undefined'){options.budgetProvider=undefined;options.run=undefined;}
    const scope=createRetainedPriceAdmissionInventory(api,options);
    scope(endpoint(294252465,'push'),true);
    assert.equal(directProviders,mode==='both'||mode==='provider'?1:0);
    assert.equal(inheritedProviders,mode==='both'||mode==='provider'?0:1);
    assert.equal(directRuns,mode==='both'||mode==='run'?1:0);
    assert.equal(inheritedRuns,mode==='both'||mode==='run'?0:1);
    assert.equal((mode==='both'||mode==='provider'?direct:inherited).finals.length,1);scope.dispose();
    if(mode==='both'){
      const ordinaryInherited=createRetainedPriceAdmissionInventory(api,{requiredIds:[100,200],head});
      ordinaryInherited(endpoint(294252465,'push'),true);
      assert.equal(inheritedProviders,1);assert.equal(inheritedRuns,1);
      assert.equal(directProviders,1);assert.equal(directRuns,1);ordinaryInherited.dispose();
    }
  }
  let issued=0,providers=0;
  const api=createRetainedPriceAdmissionApi(()=>null,{run:()=>{issued++;throw Error('Invalid options must not issue');},
    budgetProvider:()=>{providers++;return acquisitionBudgetHooks().hooks;},report:()=>{}});
  for(const key of ['run','budgetProvider'])for(const value of [null,false,0,'function',{},[]]){
    assert.throws(()=>createRetainedPriceAdmissionInventory(api,{requiredIds:[100,200],head,[key]:value}),
      key==='run'?/invalid-admission-reader/:/invalid-acquisition-budget-provider/);
    assert.equal(issued,0);assert.equal(providers,0);
  }
});
