// Bounded read-only metadata target. This does not reproduce the lost A12 body.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createRetainedPriceLiveApi,LIVE_INVENTORY_LIMITS} from './retained-price-live-inventory.mjs';
import {createRetainedPriceAdmissionApi,createRetainedPriceAdmissionInventory,ADMISSION_INVENTORY_LIMITS} from './retained-price-admission-inventory.mjs';
import {LIMITS,REPOSITORY,REPOSITORY_ID,validateSnapshot,project} from './retained-price-repository-inventory.mjs';

const BASE='a6b2091370bba87f7964a498230f7a1dad9ba827',PRODUCTION_TREE='e22ddee3121979d0ef805601cd9f7265f79fc643';
const FAILED=37858469362,FAILED_HEAD='6ddd47cf8644e804c16206b466d49c4bc084016d',BRANCH='finite-inventory-drift-check-a12';
const SCRIPT='.github/scripts/retained-price-inventory-drift-target.mjs',WORKFLOW='.github/workflows/retained-price-inventory-drift-target.yml';
const BINDINGS=[
  ['.github/scripts/retained-price-repository-inventory.mjs','41e3f4712a635a3e68f3e8bf78ac4f62ac92ccd9'],
  ['.github/scripts/retained-price-repository-inventory.test.mjs','883bb8b0859c8af568389584929184e12d8baa8f'],
  ['.github/scripts/retained-price-live-inventory.test.mjs','3fd42174130ab094ccfbeda6fa9ce937055061d6'],
];
const UNCHANGED=[
  ['.github/scripts/retained-price-live-inventory.mjs','15e0b31fcc64c9e94e3207821d7b444ab5e9c975'],
  ['.github/scripts/retained-price-admission-inventory.mjs','c0c7a0c1f9681f73c49fba43b297430964725e0c'],
  ['.github/scripts/retained-price-source-browser.mjs','385ca311d0b0d26d76f0bab2826a5114bf15a368'],
  ['.github/retained-price-oct6-source.json','3b2bc955ce66ba5a97e7dd9b3a5587c605b4350a'],
  ['frontend/package.json','81dab927e85fea4031e3bca6e9751b6007b613f8'],
  ['frontend/package-lock.json','3533b0f6ff61b73235da8765bccbdc754add0294'],
];
const check=(v,reason)=>{if(!v)throw Error(reason);};
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const blob=raw=>createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:1024**2,timeout:10000,killSignal:'SIGKILL'}).trim();
const prefix='repos/'+REPOSITORY;
const publisher=prefix+'/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100';
const producer=prefix+'/actions/workflows/static-site.yml/runs?branch=main&per_page=100';
const sameRepo=r=>r?.repository?.id===REPOSITORY_ID&&r.repository.full_name===REPOSITORY&&r.head_repository?.id===REPOSITORY_ID&&r.head_repository.full_name===REPOSITORY;
const identity=r=>Object.fromEntries(['id','run_attempt','workflow_id','path','head_sha','head_branch','event','status','conclusion','run_started_at'].map(k=>[k,r[k]]));
const clocks=r=>({created_at:r.created_at,run_started_at:r.run_started_at,updated_at:r.updated_at});
const utc=v=>typeof v==='string'&&v.endsWith('Z')&&Number.isFinite(Date.parse(v));
const report={schema_version:'retained-price-inventory-drift-target-v1',diagnostic_only:true,publication_authority:false,
  observation_kind:'present_time_retrieval_not_original_failure_response',original_duplicate_ids_available:false,
  original_failed_run_id:FAILED,original_head_sha:FAILED_HEAD,worker_attempts:[],live_observations:[],admission_projection_replay:[]};
function local(){
  check(process.env.GITHUB_EVENT_NAME==='push'&&process.env.GITHUB_REPOSITORY===REPOSITORY&&Number(process.env.GITHUB_REPOSITORY_ID)===REPOSITORY_ID
    &&process.env.GITHUB_REF==='refs/heads/'+BRANCH&&process.env.GITHUB_RUN_ATTEMPT==='1'
    &&process.env.GITHUB_WORKFLOW_SHA===process.env.GITHUB_SHA&&process.env.GITHUB_WORKFLOW_REF===REPOSITORY+'/'+WORKFLOW+'@refs/heads/'+BRANCH,'wrong target execution context');
  check(git('rev-parse','HEAD')===process.env.GITHUB_SHA&&git('show','-s','--format=%P','HEAD')===BASE,'wrong sole retired parent');
  check(git('diff','--name-only',BASE,'HEAD').split('\n').sort().join('|')===[...BINDINGS.map(x=>x[0]),SCRIPT,WORKFLOW].sort().join('|'),'unexpected target file changes');
  for(const [path,pin]of [...BINDINGS,...UNCHANGED])check(blob(readFileSync(path))===pin,'wrong target binding '+path);
  const request=JSON.parse(readFileSync('.github/retained-price-oct6-source.json'));
  check(request.enabled===false&&request.activation===null,'finite request not disabled');
  assert.deepEqual(LIMITS,{runs:2000,projectedRuns:1000,perPage:50,bytes:64*1024**2,pageBytes:8*1024**2,attemptMs:30000});
  assert.deepEqual(LIVE_INVENTORY_LIMITS,{attempts:2,attemptMs:30000,totalMs:60000,bytes:64*1024**2,runs:1000,repositoryRuns:2000});
  assert.deepEqual(ADMISSION_INVENTORY_LIMITS,{attempts:2,attemptMs:30000,totalMs:60000,bytes:64*1024**2,repositoryRuns:2000,projectedRuns:1000});
  const index=join(process.env.RUNNER_TEMP,'retained-price-inventory-drift-production.index'),env={...process.env,GIT_INDEX_FILE:index};
  try{
    execFileSync('git',['read-tree','HEAD'],{env,stdio:['ignore','pipe','pipe'],timeout:10000});
    execFileSync('git',['update-index','--force-remove','--',SCRIPT,WORKFLOW],{env,stdio:['ignore','pipe','pipe'],timeout:10000});
    check(execFileSync('git',['write-tree'],{env,encoding:'utf8',maxBuffer:1024**2,timeout:10000}).trim()===PRODUCTION_TREE,'wrong reviewed production tree');
  }finally{try{unlinkSync(index);}catch(e){if(e.code!=='ENOENT')throw e;}}
  report.reviewed_production_tree=PRODUCTION_TREE;report.probe_head_sha=process.env.GITHUB_SHA;
}
async function direct(id,attempt=false){
  check(Number.isSafeInteger(id)&&id>0,'invalid direct run ID');
  const endpoint=prefix+'/actions/runs/'+id+(attempt?'/attempts/1':'');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);let bytes=0;
  try{
    const response=await fetch('https://api.github.com/'+endpoint,{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+process.env.GH_TOKEN,
      'User-Agent':'retained-price-inventory-drift-target'},redirect:'error',cache:'no-store',signal:controller.signal});
    check(response.url==='https://api.github.com/'+endpoint&&!response.redirected,'direct origin or redirect rejected');
    check(response.status===200&&!response.headers.has('retry-after')&&response.headers.get('x-ratelimit-remaining')!=='0','direct HTTP/security denial '+response.status);
    const chunks=[];
    for await(const chunk of response.body){check(chunk instanceof Uint8Array,'invalid direct response bytes');bytes+=chunk.byteLength;
      check(bytes<=1024**2,'direct response byte bound');chunks.push(chunk);}
    const raw=Buffer.concat(chunks),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    report.direct_bytes??=[];report.direct_bytes.push({requested_route:endpoint,status:response.status,bytes,sha256:sha(raw)});
    return value;
  }finally{clearTimeout(timer);}
}
function exact(current,attempt,{id,workflow,path,head,branch,event,active=false}){
  for(const r of[current,attempt]){
    check(r.id===id&&r.run_attempt===1&&r.workflow_id===workflow&&r.path===path&&r.head_sha===head&&r.head_branch===branch&&r.event===event&&sameRepo(r),'direct run identity mismatch');
    check([r.created_at,r.run_started_at,r.updated_at].every(utc),'direct run clock schema');
    check(Date.parse(r.created_at)<=Date.parse(r.updated_at)&&Date.parse(r.run_started_at)<=Date.parse(r.updated_at)&&Date.parse(r.updated_at)<=Date.now(),'direct resource chronology');
  }
  assert.deepEqual(identity(current),identity(attempt));
  check(Date.parse(current.created_at)<=Date.parse(current.run_started_at)&&Date.parse(current.created_at)<=Date.parse(attempt.created_at),'original run/attempt created clock ordering');
  check(active?current.status==='in_progress'&&current.conclusion===null:current.status==='completed'&&current.conclusion==='failure','direct run terminal/active status');
  return {identity:identity(current),current_clocks:clocks(current),attempt_clocks:clocks(attempt)};
}
async function main(){
  local();check(typeof process.env.GH_TOKEN==='string'&&process.env.GH_TOKEN.length>0,'missing read-only Actions token');
  const own=Number(process.env.GITHUB_RUN_ID);check(Number.isSafeInteger(own)&&own>0&&own!==FAILED,'invalid immediate caller');
  report.started_at=new Date().toISOString();report.probe_run_id=own;report.required_run_ids=[FAILED,own];
  const failedCurrent=await direct(FAILED),failedAttempt=await direct(FAILED,true),ownCurrent=await direct(own),ownAttempt=await direct(own,true);
  report.direct={
    failed:exact(failedCurrent,failedAttempt,{id:FAILED,workflow:364666954,path:'.github/workflows/research-ui-release.yml',head:FAILED_HEAD,branch:'main',event:'workflow_run'}),
    caller:exact(ownCurrent,ownAttempt,{id:own,workflow:ownCurrent.workflow_id,path:WORKFLOW,head:process.env.GITHUB_SHA,branch:BRANCH,event:'push',active:true}),
  };
  let captured=null,workerReads=0;
  const live=createRetainedPriceLiveApi(()=>{throw Error('Unexpected live individual fallback');},{requiredIds:[FAILED,own],run:(node,args,options)=>{
    check(node===process.execPath&&args.length===2&&args[0]==='--max-old-space-size=384'&&args[1]===join(process.cwd(),'.github/scripts/retained-price-repository-inventory.mjs'),'wrong native worker command');
    check(options.timeout>0&&options.timeout<=30000&&options.maxBuffer===64*1024**2&&options.killSignal==='SIGKILL','wrong native worker bound');
    assert.deepEqual(JSON.parse(options.input),{timeoutMs:options.timeout,requiredIds:[FAILED,own]});
    workerReads++;check(workerReads<=2,'native worker attempt cap');
    const raw=execFileSync(node,args,options),value=JSON.parse(raw);
    report.worker_attempts.push({attempt:workerReads,status:value.status,reason:value.reason??null,retryable:value.retryable===true,bytes:Buffer.byteLength(raw),sha256:sha(raw)});
    captured=value.status==='complete'?value:null;return raw;
  },report:v=>report.live_observations.push(v)});
  const pub=live(publisher,true).flatMap(p=>p.workflow_runs),src=live(producer,true).flatMap(p=>p.workflow_runs);
  check(captured?.status==='complete','no complete real snapshot');
  const complete=validateSnapshot(captured.pages,[FAILED,own]);
  assert.deepEqual(pub,project(complete.runs,364666954));assert.deepEqual(src,project(complete.runs,294257497));
  check(pub.some(r=>r.id===FAILED&&r.run_attempt===1),'failed publisher missing from real projection');
  for(const [id,record]of[[FAILED,failedCurrent],[own,ownCurrent]]){
    const r=complete.runs.find(r=>r.id===id);check(r&&sameRepo(r),'required real snapshot member absent');assert.deepEqual(identity(r),identity(record));
  }
  check(report.live_observations.filter(v=>v.status==='complete').length===1&&report.live_observations.at(-1).status==='projected'
    &&report.live_observations.at(-1).reused_immediate_snapshot===true,'wrong immediate coherent live projection');
  check(report.live_observations.every(v=>v.inventory_budget_used_ms<=60000),'live shared time budget widened');
  report.complete_inventory={total:complete.total,pages:complete.pages.length,body_bytes:captured.body_bytes,pages_sha256:sha(JSON.stringify(complete.pages)),
    unique_ids:complete.runs.length,run_ids:complete.runs.map(r=>r.id),publisher_run_ids:pub.map(r=>r.id),source_run_ids:src.map(r=>r.id)};
  // Diagnostic projection replay of exactly this completed real envelope.
  // This is not a second acquisition or an admission-authority claim.
  let replayReads=0;
  const base=createRetainedPriceAdmissionApi(()=>{throw Error('Unexpected admission individual fallback');},{run:()=>{replayReads++;return JSON.stringify(captured);},
    report:v=>report.admission_projection_replay.push(v)});
  const scope=createRetainedPriceAdmissionInventory(base,{requiredIds:[FAILED,own],head:FAILED_HEAD});
  try{
    for(const t of[{id:294252465,path:'.github/workflows/ci.yml',event:'push'},{id:294257497,path:'.github/workflows/static-site.yml',event:'workflow_run'},
      {id:364666954,path:'.github/workflows/research-ui-release.yml',event:'workflow_run'}]){
      const endpoint=prefix+'/actions/workflows/'+t.id+'/runs?branch=main&event='+t.event+'&head_sha='+FAILED_HEAD+'&per_page=100';
      const actual=scope(endpoint,true).flatMap(p=>p.workflow_runs),expected=complete.runs.filter(r=>r.workflow_id===t.id&&r.path===t.path&&r.head_sha===FAILED_HEAD&&r.head_branch==='main'&&r.event===t.event&&sameRepo(r));
      assert.deepEqual(actual,expected);
    }
    check(replayReads===1,'admission diagnostic replay lost gate coherence');
  }finally{scope.dispose();}
  assert.throws(()=>scope(prefix+'/actions/runs/'+FAILED),/disposed-admission-scope/);
  const failedAfter=await direct(FAILED),ownAfter=await direct(own);
  assert.deepEqual(identity(failedAfter),identity(failedCurrent));assert.deepEqual(identity(ownAfter),identity(ownCurrent));
  check(sameRepo(failedAfter)&&sameRepo(ownAfter),'post-observation repository changed');
  report.worker_reads=workerReads;report.admission_replay_worker_reads=replayReads;
  report.original_failure_reproduced=false;report.status='passed';report.finished_at=new Date().toISOString();
}
function emit(){
  let raw=JSON.stringify(report);if(Buffer.byteLength(raw)>4*1024**2){process.exitCode=1;raw=JSON.stringify({status:'failed',reason:'diagnostic-output-bound',publication_authority:false});}
  console.log('INVENTORY_DRIFT_TARGET_REPORT '+raw);
}
try{
  if(process.argv.length===3&&process.argv[2]==='--verify-only'){check(!process.env.GH_TOKEN&&!process.env.GITHUB_TOKEN,'token unexpectedly exposed to code-only preflight');local();console.log('INVENTORY_DRIFT_PREFLIGHT_PASS '+PRODUCTION_TREE);}
  else{check(process.argv.length===2,'unexpected diagnostic arguments');await main();emit();}
}catch(error){report.status='failed';report.reason=error.inventoryReason??'target-validation-failed';report.error=error.message;emit();process.exitCode=1;}
