// Private per-Node-invocation historical jobs transport. It grants no authority.
import {AsyncLocalStorage} from 'node:async_hooks';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,constants,fstatSync,fsyncSync,lstatSync,openSync,readSync,realpathSync,writeSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {validateScope,runKey,validateJobsPages,decodePageRecord} from './conditional-deployment-jobs-worker.mjs';
import {isOwnedJobCacheHandle,initializeJobCache,openJobCache,cleanupJobCache} from './conditional-deployment-jobs-cache.mjs';
import {REQUEST_REPRESENTATION} from './conditional-deployment-jobs-worker.mjs';
import {createFiniteTransportBudgetController} from './retained-price-finite-transport-controller.mjs';
import {finiteTransportPolicy,finiteTransportPhase} from './retained-price-finite-transport-policy.mjs';
import {readBoundedGitHubPages,readBoundedRequiredCaller} from './bounded-github-api.mjs';

const REPO='kusennjp1-ai/screener',RID=1203919607,contexts=new AsyncLocalStorage(),readerMeasurements=new WeakMap(),readerBindings=new WeakMap(),jobCacheOwners=new WeakMap(),invocationBindings=new WeakMap();
export const CONDITIONAL_HISTORY_SCOPE_LIMITS=Object.freeze({workerMs:120000,workerBytes:64*1024**2,cacheBytes:32*1024**2,diagnosticBytes:64*1024,heapMb:384});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>JSON.stringify(v,(_k,x)=>object(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:a>b?1:0)):x);
const check=(v,reason)=>{if(!v)throw Object.assign(Error('Conditional historical jobs rejected: '+reason),{conditionalReason:reason});};
const workerPath=()=>join(dirname(fileURLToPath(import.meta.url)),'conditional-deployment-jobs-worker.mjs');
const clone=v=>JSON.parse(JSON.stringify(v));
const baseCounts=()=>({gh_invocations:0,gh_successful_direct_reads:0,gh_successful_paginated_invocations:0,gh_returned_pages:0,
  gh_failed_invocations:0,gh_failed_page_count_unknown:0,native_snapshot_attempts:0,native_snapshot_requests_issued:0,
  native_snapshot_http_200:0,native_snapshot_status_unknown:0,native_snapshot_other_status:0,
  conditional_batch_calls:0,conditional_requests_issued:0,conditional_http_200:0,conditional_http_304:0,
  conditional_pages_revalidated:0,conditional_http_other_status:0,conditional_status_unknown:0});
function safeQuota(h){
  const out={};if(!object(h))return out;
  for(const k of['x-ratelimit-limit','x-ratelimit-used','x-ratelimit-remaining','x-ratelimit-reset']){
    const short={'x-ratelimit-limit':'limit','x-ratelimit-used':'used','x-ratelimit-remaining':'remaining','x-ratelimit-reset':'reset_epoch'}[k];
    const v=h[k]??h[short];if((typeof v==='number'||typeof v==='string')&&/^\d{1,15}$/.test(String(v))&&Number.isSafeInteger(Number(v)))out[k]=Number(v);
  }
  return out;
}
function scopeMeasurement(scope,report){
  const counts=baseCounts(),seen=new Set(),history=[],storage=[],id=randomUUID();let disposed=false,incomplete=false;
  const critical=new Set([scope.run_id]);
  function api(endpoint,paginate,result,error){
    if(disposed)return;
    if(typeof endpoint!=='string'||(endpoint!=='repos/'+scope.repository&&!endpoint.startsWith('repos/'+scope.repository+'/'))){incomplete=true;return;}
    counts.gh_invocations++;
    if(error){counts.gh_failed_invocations++;if(paginate)counts.gh_failed_page_count_unknown++;return;}
    if(paginate){
      counts.gh_successful_paginated_invocations++;
      if(Array.isArray(result))counts.gh_returned_pages+=result.length;else incomplete=true;
    }else counts.gh_successful_direct_reads++;
    // More exclusion only; this observation never creates source/CI authority.
    if(object(result)&&positive(result.id)&&result.head_sha===scope.controller_sha&&result.repository?.id===RID
      &&result.repository?.full_name===REPO&&result.head_repository?.id===RID&&result.head_repository?.full_name===REPO
      &&((result.workflow_id===294252465&&result.path==='.github/workflows/ci.yml')
        ||(result.workflow_id===294257497&&result.path==='.github/workflows/static-site.yml')))critical.add(result.id);
  }
  function inventory(o){
    if(disposed||!object(o)||o.status==='projected')return;
    const key=o.schema_version+'|'+o.call_id+'|'+o.attempt;
    if(typeof o.call_id!=='string'||!positive(o.attempt)||!Array.isArray(o.page_evidence)||o.page_evidence.length>40){incomplete=true;return;}
    if(seen.has(key))return;seen.add(key);counts.native_snapshot_attempts++;
    const pages=new Set();
    for(const p of o.page_evidence){
      if(!object(p)||!positive(p.page_number)||p.page_number>40||pages.has(p.page_number)
        ||p.requested_route!=='repositories/'+RID+'/actions/runs?per_page=50&page='+p.page_number){incomplete=true;continue;}
      pages.add(p.page_number);counts.native_snapshot_requests_issued++;
      if(p.status===200)counts.native_snapshot_http_200++;
      else if(p.status===null)counts.native_snapshot_status_unknown++;
      else counts.native_snapshot_other_status++;
    }
  }
  function batch(result,elapsed,stdout){
    counts.conditional_batch_calls++;
    if(!Array.isArray(result?.observations)){incomplete=true;return;}
    counts.conditional_requests_issued+=result.observations.length;
    for(const o of result.observations){
      if(o.status===200)counts.conditional_http_200++;
      else if(o.status===304)counts.conditional_http_304++;
      else if(Number.isInteger(o.status))counts.conditional_http_other_status++;
      else counts.conditional_status_unknown++;
      if(o.page_revalidated===true)counts.conditional_pages_revalidated++;
    }
    const facts={batch:counts.conditional_batch_calls,status:result.status,elapsed_ms:Math.ceil(elapsed),
      requests_issued:result.observations.length,http_200:result.observations.filter(o=>o.status===200).length,
      http_304:result.observations.filter(o=>o.status===304).length,stdout_bytes:Buffer.byteLength(stdout),stdout_sha256:hash(stdout),
      fresh_200_includes_conditional_200:true,conditional_200_subset:Number.isSafeInteger(result.stats?.conditional_200)?result.stats.conditional_200:null,
      first_actual_route_quota:safeQuota(result.observations[0]?.quota),last_actual_route_quota:safeQuota(result.observations.at(-1)?.quota)};
    history.push(facts);
  }
  function unknownBatch(){if(disposed)return;counts.conditional_batch_calls++;incomplete=true;}
  function finish(status){
    if(disposed)return;disposed=true;
    const value={schema_version:'publication-owned-read-measurement-v1',scope_id:id,scope:clone(scope),status,diagnostic_only:true,
      publication_authority:false,counts:clone(counts),historical_batches:clone(history),job_cache_events:clone(storage),
      gh_http_status_and_internal_retry_accounting:'not_observed_by_json_only_cli',
      shared_rate_header_deltas_are_not_owned_request_counts:true,measurement_incomplete:incomplete};
    try{
      const raw=JSON.stringify(value);
      if(Buffer.byteLength(raw)<=CONDITIONAL_HISTORY_SCOPE_LIMITS.diagnosticBytes)report(value);
      else report({schema_version:value.schema_version,scope_id:id,status:'diagnostic-bound',measurement_incomplete:true,publication_authority:false});
    }catch{}
    seen.clear();history.length=0;storage.length=0;critical.clear();
  }
  function cacheEvent(value){if(!disposed){if(storage.length<80)storage.push(clone(value));else incomplete=true;}}
  return {scope,counts,critical,api,inventory,batch,unknownBatch,cacheEvent,finish,get disposed(){return disposed;},get incomplete(){return incomplete;}};
}
function opaque(v){if(typeof v!=='string'||v.length>256)return null;const m=/^(?:W\/)?"([\x21\x23-\x7e]*)"$/.exec(v);return m?m[1]:null;}
function validObservation(o,runs,cache,critical,failed){
  if(!object(o)||o.method!=='GET'||o.authenticated!==true||!positive(o.run_id)||typeof o.conditional!=='boolean')return false;
  const row=runs.find(r=>r.id===o.run_id);if(!row||o.run_key!==runKey(row))return false;
  let url;try{url=new URL(o.url);}catch{return false;}
  if(url.origin!=='https://api.github.com'||url.username||url.password||url.hash
    ||url.pathname!=='/repos/'+REPO+'/actions/runs/'+row.id+'/jobs')return false;
  const params=[...url.searchParams];
  if(params.length<2||params.length>3||new Set(params.map(([k])=>k)).size!==params.length
    ||url.searchParams.get('filter')!=='all'||url.searchParams.get('per_page')!=='100'
    ||params.some(([k])=>!['filter','per_page','page'].includes(k)))return false;
  const n=url.searchParams.get('page');if(n!==null&&(!/^[1-9]\d*$/.test(n)||Number(n)>10))return false;
  if(!Number.isFinite(o.started_ms)||o.started_ms<0||!Number.isFinite(o.elapsed_ms)||o.elapsed_ms<0
    ||!Number.isSafeInteger(o.received_body_bytes)||o.received_body_bytes<0||o.received_body_bytes>8*1024**2
    ||!Number.isSafeInteger(o.representation_body_bytes)||o.representation_body_bytes<0||o.representation_body_bytes>8*1024**2)return false;
  const prior=row.status==='completed'&&!critical.has(row.id)?cache.find(p=>p.url===o.url&&p.run_key===o.run_key):null;
  if(o.conditional!==Boolean(prior)||o.etag_sent!==(prior?.etag??null))return false;
  if(failed)return o.status===null||(Number.isInteger(o.status)&&o.status>=100&&o.status<=599);
  return [200,304].includes(o.status)&&o.page_validated===true
    &&(o.status===304?o.page_revalidated===true&&prior&&o.received_body_bytes===0
      &&opaque(o.etag_received)!==null&&opaque(o.etag_received)===opaque(prior.etag):o.page_revalidated===false);
}
export function createConditionalDeploymentJobsReader({scope,excludedIds=[],run=execFileSync,monotonic=()=>performance.now(),
  token=()=>process.env.GH_TOKEN,report=()=>{},binding=()=>true,jobCache=null,jobCacheProvider=null}){
  validateScope(scope);scope=Object.freeze(clone(scope));check(typeof run==='function'&&typeof monotonic==='function'&&typeof token==='function'&&typeof report==='function'&&typeof binding==='function','invalid-reader-functions');
  check(Array.isArray(excludedIds)&&excludedIds.every(positive)&&new Set(excludedIds).size===excludedIds.length,'invalid-critical-ids');
  let credential=token();check(typeof credential==='string'&&credential.length>0&&credential.length<=8192,'missing-existing-token');
  const measurement=scopeMeasurement(scope,report),critical=measurement.critical,hardCritical=new Set([scope.run_id,...excludedIds]);for(const id of excludedIds)critical.add(id);
  check(jobCacheProvider===null||typeof jobCacheProvider==='function','invalid-job-cache-provider');
  check(jobCache===null||jobCacheProvider===null,'ambiguous-job-cache-provider');
  let cache=[],disposed=false,disposition=null,reader;
  function adoptJobCache(){
    const adoptable=isOwnedJobCacheHandle(jobCache)&&(!jobCacheOwners.has(jobCache)||jobCacheOwners.get(jobCache)===reader);
    try{
      check(adoptable,'unowned-or-already-adopted-job-cache');
      const c=jobCache.context;
      check(canonical({repository:c.repository,repository_id:c.repository_id,run_id:c.run_id,run_attempt:c.run_attempt,controller_sha:c.controller_sha})===canonical(scope),'job-cache-scope-mismatch');
      check(typeof jobCache.assertPrivateToken==='function','missing-private-cache-binding');
      jobCache.assertPrivateToken(credential);if(reader)jobCacheOwners.set(jobCache,reader);
    }catch(error){
      // Never dispose another reader's lease. A newly adopted handle that
      // cannot bind is poisoned, so it cannot become a silent cold restart.
      if(adoptable)try{jobCache.dispose('failed');}catch(cleanupError){
        measurement.cacheEvent({operation:'dispose',status:'failed',reason:typeof cleanupError?.code==='string'?cleanupError.code:'cache-disposal-failed'});
      }
      credential=null;measurement.finish('failed');throw error;
    }
  }
  if(jobCache!==null)adoptJobCache();
  const privateBinding=()=>{
    check(!disposed,'disposed-history-scope');
    check(token()===credential&&binding(),'private-invocation-binding-changed');
    if(jobCache!==null){check(isOwnedJobCacheHandle(jobCache),'failed-or-disposed-job-cache');jobCache.assertPrivateToken(credential);}
  };
  function release(status,original=null){
    if(disposed)return;
    let cleanupError=null;
    const owner=invocationBindings.get(reader);
    try{if(owner?.transport){if(status==='complete')owner.transport.finish();else owner.transport.fail();}}catch(error){cleanupError=error;}
    try{if(jobCache!==null)jobCache.dispose(cleanupError?'failed':status);}catch(error){
      cleanupError=error;measurement.cacheEvent({operation:'dispose',status:'failed',reason:typeof error?.code==='string'?error.code:'cache-disposal-failed'});
    }finally{
      disposed=true;disposition=cleanupError?'failed':status;cache=[];credential=null;jobCacheOwners.delete(jobCache);
      readerBindings.delete(reader);readerMeasurements.delete(reader);invocationBindings.delete(reader);measurement.finish(cleanupError?'failed':status);
    }
    // An existing caller/transport error keeps its identity; cleanup failure is
    // separately retained and the job's authenticated lease stays failed/pending.
    if(cleanupError&&!original)throw cleanupError;
  }
  function storedPages(){
    if(jobCache===null)return cache;
    const stored=jobCache.loadVerified();
    measurement.cacheEvent({operation:'load',generation:stored.generation,page_count:stored.pages.length,
      page_bytes:Buffer.byteLength(JSON.stringify(stored.pages))});
    return stored.pages;
  }
  function commit(runs,pages,effectiveCritical){
    if(jobCache===null)return;
    const result=jobCache.commitComplete({runs:clone(runs),pages:clone(pages),excludedIds:[...effectiveCritical]});
    check(Number.isSafeInteger(result.generation)&&result.generation>=0&&Number.isSafeInteger(result.page_count)&&result.page_count>=0
      &&Number.isSafeInteger(result.cache_bytes)&&result.cache_bytes>0&&result.cache_bytes<=CONDITIONAL_HISTORY_SCOPE_LIMITS.cacheBytes
      &&Number.isSafeInteger(result.eviction_count)&&result.eviction_count>=0,'invalid-job-cache-commit-facts');
    measurement.cacheEvent({operation:'commit',...result});
    cache=clone(jobCache.loadVerified().pages);
    check(Buffer.byteLength(JSON.stringify(cache))<=CONDITIONAL_HISTORY_SCOPE_LIMITS.cacheBytes,'loaded-job-cache-byte-bound');
  }
  const read=runs=>{
    check(!disposed,'disposed-history-scope');
    let effectiveCritical,historyReceipt=null;const owner=invocationBindings.get(reader),transport=owner?.transport;
    try{
      privateBinding();
      if(jobCacheProvider!==null&&jobCache===null){jobCache=jobCacheProvider();adoptJobCache();}
      check(Array.isArray(runs)&&runs.length<=2000&&new Set(runs.map(r=>r?.id)).size===runs.length,'invalid-candidate-list');
      const current=new Map(runs.map(row=>[row.id,{row,key:runKey(row)}]));
      effectiveCritical=new Set(hardCritical);
      for(const id of critical)if(!owner?.registered||!transport||current.get(id)?.row.status!=='completed')effectiveCritical.add(id);
      // Only freshly supplied candidates/critical exclusions can select a
      // validator. Stored run rows never establish current membership.
      cache=clone(storedPages()).filter(page=>{
        const id=Number(/^https:\/\/api\.github\.com\/repos\/kusennjp1-ai\/screener\/actions\/runs\/([1-9]\d*)\/jobs\?/.exec(page?.url??'')?.[1]);
        const value=current.get(id);
        return value&&value.row.status==='completed'&&!effectiveCritical.has(id)&&page.run_key===value.key;
      });
      if(!runs.length){check(!transport,'empty-finite-history-cohort');commit(runs,[],effectiveCritical);return new Map();}
      if(transport){
        if(!transport.snapshot().opened)transport.openHistory(jobCache,{allowUninitialized:owner.phaseMode==='initialize',predecessorModel:owner.predecessorModel??null});
        historyReceipt=transport.beforeHistory();
      }
    }catch(error){release('failed',error);throw error;}
    let raw='',result,counted=false,startedWorker=false,start;
    try{
      const workerTimeout=transport?transport.remainingMs(CONDITIONAL_HISTORY_SCOPE_LIMITS.workerMs):CONDITIONAL_HISTORY_SCOPE_LIMITS.workerMs;
      const config={scope:clone(scope),runs:clone(runs),cache:clone(cache),excludedIds:[...effectiveCritical],timeoutMs:workerTimeout,
        ...(transport?{maximumRequests:200}:{})};
      const input=JSON.stringify(config);check(Buffer.byteLength(input)<=CONDITIONAL_HISTORY_SCOPE_LIMITS.workerBytes,'worker-input-byte-bound');
      start=monotonic();
      try{
        if(transport)transport.enter(historyReceipt);startedWorker=true;raw=run(process.execPath,['--max-old-space-size=384',workerPath()],{encoding:'utf8',stdio:['pipe','pipe','pipe'],input,
          timeout:workerTimeout,killSignal:'SIGKILL',maxBuffer:CONDITIONAL_HISTORY_SCOPE_LIMITS.workerBytes});
      }catch(error){
        const failed=typeof error?.stdout==='string'?error.stdout:Buffer.isBuffer(error?.stdout)?error.stdout.toString('utf8'):null;
        if(failed!==null&&Buffer.byteLength(failed)<=CONDITIONAL_HISTORY_SCOPE_LIMITS.workerBytes){
          try{
            const value=JSON.parse(failed);
            if(object(value)&&value.schema_version==='conditional-deployment-jobs-v1'&&value.status==='failed'
              &&Array.isArray(value.jobs)&&value.jobs.length===0&&Array.isArray(value.cache)&&value.cache.length===0
              &&Array.isArray(value.observations)&&value.observations.every(o=>validObservation(o,runs,cache,effectiveCritical,true))
              &&value.stats?.requests===value.observations.length){
              measurement.batch(value,monotonic()-start,failed);counted=true;
            }
          }catch{}
        }
        check(false,'worker-command-failed');
      }
      check(typeof raw==='string'&&Buffer.byteLength(raw)<=CONDITIONAL_HISTORY_SCOPE_LIMITS.workerBytes,'worker-output-byte-bound');
      try{result=JSON.parse(raw);}catch{check(false,'invalid-worker-json');}
      check(Array.isArray(result?.observations)&&result.observations.every(o=>validObservation(o,runs,cache,effectiveCritical,result?.status==='failed')),'invalid-worker-observations');
      measurement.batch(result,monotonic()-start,raw);counted=true;
      check(object(result)&&result.schema_version==='conditional-deployment-jobs-v1'&&result.status==='complete'
        &&Array.isArray(result.jobs)&&Array.isArray(result.cache)&&Array.isArray(result.observations),'worker-history-read-failed');
      check(monotonic()-start<=CONDITIONAL_HISTORY_SCOPE_LIMITS.workerMs,'history-time-bound');
      check(result.jobs.length===runs.length&&new Set(result.jobs.map(r=>r?.run_id)).size===runs.length,'incomplete-worker-inventories');
      const byId=new Map(runs.map(r=>[r.id,r])),byKey=new Map(runs.map(r=>[runKey(r),r])),output=new Map(),allPages=[];
      for(const entry of result.jobs){
        const row=byId.get(entry?.run_id);check(row&&Array.isArray(entry.pages)&&Array.isArray(entry.jobs),'foreign-worker-inventory');
        const verified=validateJobsPages(row,entry.pages,scope);
        check(canonical(verified.jobs)===canonical(entry.jobs),'worker-job-bytes-disagree');
        output.set(row.id,clone(verified.jobs));allPages.push(...entry.pages);
      }
      const observationCounts={requests:result.observations.length,http200:result.observations.filter(o=>o.status===200).length,
        http304:result.observations.filter(o=>o.status===304).length};
      check(object(result.stats)&&result.stats.requests===observationCounts.requests,'worker-request-count-disagrees');
      check(allPages.length===observationCounts.requests,'worker-page-count-disagrees');
      const known=new Map(allPages.map(p=>[p.url+'|'+p.run_key,p]));
      check(known.size===allPages.length,'duplicate-worker-page-record');
      const observed=new Set();
      for(const o of result.observations){
        const key=o.url+'|'+o.run_key,p=known.get(key);
        check(p&&!observed.has(key)&&o.body_sha256===p.body_sha256&&o.representation_body_bytes===p.body_bytes
          &&o.etag_received===p.etag,'observation-page-binding-mismatch');observed.add(key);
        if(o.status===200)check(o.received_body_bytes===p.body_bytes,'fresh-body-byte-mismatch');
        else{
          const prior=cache.find(v=>v.url===p.url&&v.run_key===p.run_key);
          check(prior&&prior.body_base64===p.body_base64&&prior.body_sha256===p.body_sha256
            &&prior.body_bytes===p.body_bytes,'revalidated-body-binding-mismatch');
        }
      }
      check(new Set(result.cache.map(p=>p?.url+'|'+p?.run_key)).size===result.cache.length,'duplicate-worker-cache-page');
      for(const p of result.cache){
        const row=byKey.get(p?.run_key);
        check(row&&row.status==='completed'&&!effectiveCritical.has(row.id)&&p.etag!==null,'cache-contains-critical-or-foreign-member');
        const original=known.get(p.url+'|'+p.run_key);check(original&&canonical(original)===canonical(p),'cache-not-current-validated-page');
        decodePageRecord(row,p,scope);
      }
      check(Buffer.byteLength(JSON.stringify(result.cache))<=CONDITIONAL_HISTORY_SCOPE_LIMITS.cacheBytes,'cache-byte-bound');
      privateBinding();
      check(monotonic()-start<=CONDITIONAL_HISTORY_SCOPE_LIMITS.workerMs,'history-time-bound');
      if(transport)transport.afterHistory(result,runs,historyReceipt);
      cache=clone(result.cache);commit(runs,allPages,effectiveCritical);
      check(monotonic()-start<=CONDITIONAL_HISTORY_SCOPE_LIMITS.workerMs,'history-time-bound');
      if(transport)transport.remainingMs(1);return output;
    }catch(error){
      if(!counted&&startedWorker)measurement.unknownBatch();
      const original=error?.conditionalReason?error:Object.assign(Error('Conditional historical jobs rejected: worker-or-validation-failure'),{conditionalReason:'worker-or-validation-failure'});
      release('failed',original);throw original;
    }
  };
  reader={read,scope:Object.freeze(clone(scope)),stats:()=>({counts:clone(measurement.counts),cache_bytes:Buffer.byteLength(JSON.stringify(cache)),disposed}),
    dispose:(status='complete')=>{check(['complete','failed'].includes(status),'invalid-history-disposal-status');release(status);},
    get disposed(){return disposed;},get disposition(){return disposition;}};
  readerMeasurements.set(reader,measurement);readerBindings.set(reader,privateBinding);if(jobCache!==null)jobCacheOwners.set(jobCache,reader);return reader;
}
function actualContext(repository){
  const e=process.env,shaValue=e.GITHUB_SHA;
  if(repository!==REPO||e.GITHUB_REPOSITORY!==REPO||e.GITHUB_REPOSITORY_ID!==String(RID)||e.GITHUB_REF!=='refs/heads/main'
    ||!['push','workflow_run'].includes(e.GITHUB_EVENT_NAME)||!sha(shaValue)||e.GITHUB_WORKFLOW_SHA!==shaValue
    ||!positive(Number(e.GITHUB_RUN_ID))||!positive(Number(e.GITHUB_RUN_ATTEMPT))||!e.GH_TOKEN)return null;
  const paths=['ci.yml','static-site.yml','research-ui-release.yml'];
  const file=paths.find(name=>e.GITHUB_WORKFLOW_REF===REPO+'/.github/workflows/'+name+'@refs/heads/main');if(!file)return null;
  return {scope:{repository:REPO,repository_id:RID,run_id:Number(e.GITHUB_RUN_ID),run_attempt:Number(e.GITHUB_RUN_ATTEMPT),controller_sha:shaValue},file};
}
let ambient=null;
function measurementContext(){
  const scoped=contexts.getStore();if(scoped)return readerMeasurements.get(scoped.reader)??null;
  if(ambient)return ambient.measurement;
  const actual=actualContext(REPO);if(!actual)return null;
  const measurement=scopeMeasurement(actual.scope,v=>console.error(JSON.stringify(v)));
  ambient={measurement};process.once('beforeExit',()=>measurement.finish(process.exitCode?'failed':'complete'));return measurement;
}
export function noteScopedApiRead(endpoint,paginate,result,error=null){
  try{measurementContext()?.api(endpoint,paginate,result,error);}catch{}
}
export function noteScopedInventoryRead(observation){
  try{measurementContext()?.inventory(observation);}catch{}
}
function boundedRegularFile(path){
  check(typeof path==='string'&&isAbsolute(path)&&realpathSync(path)===resolve(path),'linked-bound-file');
  const initial=lstatSync(path);check(initial.isFile()&&!initial.isSymbolicLink()&&initial.size>0&&initial.size<=1024**2,'bound-file-size-or-kind');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),buffer=Buffer.alloc(1024**2+1);let length=0;
  try{
    const opened=fstatSync(fd);check(opened.isFile()&&opened.dev===initial.dev&&opened.ino===initial.ino,'bound-file-replaced');
    while(length<buffer.length){const n=readSync(fd,buffer,length,buffer.length-length,null);if(n===0)break;length+=n;}
    check(length<=1024**2&&length===initial.size,'bound-file-growth-or-shrink');
    const after=fstatSync(fd),current=lstatSync(path);
    check(!current.isSymbolicLink()&&current.isFile(),'bound-file-replaced');
    for(const key of['dev','ino','size','mtimeMs','ctimeMs'])check(initial[key]===after[key]&&initial[key]===current[key],'bound-file-changed');
    return Buffer.from(buffer.subarray(0,length));
  }finally{closeSync(fd);}
}

const PUBLIC_CACHE={
 attempted:'RETAINED_PRICE_CONDITIONAL_CACHE_ATTEMPTED',initialized:'RETAINED_PRICE_CONDITIONAL_CACHE_INITIALIZED',
 directory:'RETAINED_PRICE_CONDITIONAL_CACHE_DIRECTORY',context:'RETAINED_PRICE_CONDITIONAL_CACHE_CONTEXT'};
function finiteInvocationBinding(repository){
  const actual=actualContext(repository),e=process.env;
  if(!actual||actual.scope.run_attempt!==1||e.GITHUB_EVENT_NAME!=='workflow_run')return null;
  const role=actual.file==='research-ui-release.yml'&&e.GITHUB_JOB==='publish'?'publisher':
    actual.file==='static-site.yml'&&e.GITHUB_JOB==='combine-and-build'?'producer-combine':null;
  if(!role)return null;
  check(typeof e.GITHUB_EVENT_PATH==='string'&&isAbsolute(e.GITHUB_EVENT_PATH),'missing-actual-event-path');
  const eventPath=e.GITHUB_EVENT_PATH,eventRaw=boundedRegularFile(eventPath),event=JSON.parse(eventRaw),source=event.workflow_run;
  const expected=role==='publisher'?{path:'.github/workflows/static-site.yml',id:294257497,event:'workflow_run'}:
    {path:'.github/workflows/ci.yml',id:294252465,event:'push'};
  if(source?.path!==expected.path||source.workflow_id!==expected.id||source.event!==expected.event
    ||source.head_sha!==actual.scope.controller_sha||source.head_branch!=='main'||source.status!=='completed'||source.conclusion!=='success'
    ||!positive(source.id)||source.repository?.id!==RID||source.repository?.full_name!==REPO
    ||source.head_repository?.id!==RID||source.head_repository?.full_name!==REPO)return null;
  const entryRoot=resolve(process.cwd());check(realpathSync(entryRoot)===entryRoot&&lstatSync(entryRoot).isDirectory(),'linked-entry-root');
  let root=entryRoot;
  if(e.RETAINED_PRICE_CONTROLLER_ROOT!==undefined){
    check(typeof e.RUNNER_TEMP==='string'&&isAbsolute(e.RUNNER_TEMP)&&e.RETAINED_PRICE_CONTROLLER_ROOT===join(e.RUNNER_TEMP,'retained-price-controller'),'unexpected-controller-root');
    root=e.RETAINED_PRICE_CONTROLLER_ROOT;
  }
  root=resolve(root);check(realpathSync(root)===root&&lstatSync(root).isDirectory(),'linked-controller-root');
  const path=join(root,'.github/retained-price-oct6-source.json'),raw=boundedRegularFile(path),request=JSON.parse(raw);
  if(request?.schema_version!=='retained-price-oct6-source-v1'||request.enabled!==true||!object(request.activation))return null;
  const digest=hash(raw),eventDigest=hash(eventRaw),
    initialEnv=Object.fromEntries(['GITHUB_EVENT_PATH','GITHUB_SHA','GITHUB_WORKFLOW_SHA','GITHUB_WORKFLOW_REF','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_REF','GITHUB_EVENT_NAME','GITHUB_REPOSITORY','GITHUB_REPOSITORY_ID','GITHUB_JOB','GITHUB_WORKSPACE','RUNNER_TEMP','RETAINED_PRICE_CONTROLLER_ROOT','RETAINED_PRICE_PUBLISHER_JOB_START'].map(k=>[k,e[k]]));
  const binding=()=>resolve(process.cwd())===entryRoot&&Object.entries(initialEnv).every(([k,v])=>process.env[k]===v)
    &&hash(boundedRegularFile(path))===digest&&hash(boundedRegularFile(eventPath))===eventDigest;
  return {scope:actual.scope,role,root,entryRoot,inferredSourceId:source.id,binding,request_sha256:digest,event_sha256:eventDigest};
}
function publicCacheState(){
  return Object.fromEntries(Object.entries(PUBLIC_CACHE).map(([k,name])=>[k,process.env[name]??null]));
}
function writeRunnerEnvironment(values){
  const root=process.env.RUNNER_TEMP,path=process.env.GITHUB_ENV;
  check(typeof root==='string'&&isAbsolute(root)&&realpathSync(root)===resolve(root)&&typeof path==='string'
    &&isAbsolute(path)&&resolve(path)===path&&path.startsWith(resolve(root)+'/')&&realpathSync(path)===path,'unsafe-runner-environment-path');
  const raw=Buffer.from(Object.entries(values).map(([name,value])=>{
    check(Object.values(PUBLIC_CACHE).includes(name)&&typeof value==='string'&&value.length>0&&value.length<=16384
      &&!/[\r\n\u0000]/.test(value),'unsafe-public-cache-environment');
    return name+'='+value+'\n';
  }).join(''));
  check(raw.length<=32768,'public-cache-environment-cap');
  const initial=lstatSync(path);check(initial.isFile()&&!initial.isSymbolicLink()&&initial.nlink===1&&initial.uid===process.getuid()
    &&initial.size+raw.length<=1024**2,'unsafe-runner-environment-file');
  const fd=openSync(path,constants.O_WRONLY|constants.O_APPEND|constants.O_NOFOLLOW|constants.O_NONBLOCK);let length=0;
  try{
    const opened=fstatSync(fd);check(opened.isFile()&&opened.dev===initial.dev&&opened.ino===initial.ino&&opened.size===initial.size,'runner-environment-file-replaced');
    while(length<raw.length){const n=writeSync(fd,raw,length,raw.length-length);check(n>0,'runner-environment-write-incomplete');length+=n;}
    fsyncSync(fd);
    const after=fstatSync(fd),current=lstatSync(path);
    check(after.size===initial.size+raw.length&&current.isFile()&&!current.isSymbolicLink()&&current.nlink===1
      &&current.dev===initial.dev&&current.ino===initial.ino&&current.size===after.size,'runner-environment-file-changed');
  }finally{closeSync(fd);}
  Object.assign(process.env,values);
}
function decodePublicContext(encoded){
  check(typeof encoded==='string'&&encoded.length<=16384&&/^[A-Za-z0-9+/]+={0,2}$/.test(encoded),'invalid-public-cache-context');
  const bytes=Buffer.from(encoded,'base64');check(bytes.toString('base64')===encoded,'invalid-public-cache-context');
  let value;try{value=JSON.parse(bytes.toString('utf8'));}catch{check(false,'invalid-public-cache-context');}
  check(canonical(value)===bytes.toString('utf8'),'noncanonical-public-cache-context');return value;
}
export function hasScopedConditionalJobContext(repository){
  const context=contexts.getStore();return Boolean(context&&repository===context.reader.scope.repository&&invocationBindings.has(context.reader));
}
export function bindScopedConditionalCaller({repository=REPO,controller,caller,role,criticalIds=[]}){
  const context=contexts.getStore(),owner=context&&invocationBindings.get(context.reader);if(!owner)return false;
  check(repository===REPO&&role===owner.bound.role&&owner.bound.binding(),'foreign-verified-conditional-caller');
  check(object(controller)&&controller.head===owner.bound.scope.controller_sha&&sha(controller.tree)
    &&caller?.attempt===1&&caller.run?.id===owner.bound.scope.run_id&&caller.run.run_attempt===1
    &&caller.run.head_sha===controller.head&&caller.run.head_branch==='main'&&caller.run.event==='workflow_run'
    &&caller.run.status==='in_progress'&&caller.run.conclusion===null
    &&caller.run.repository?.id===RID&&caller.run.repository?.full_name===REPO
    &&caller.run.head_repository?.id===RID&&caller.run.head_repository?.full_name===REPO
    &&caller.commit?.sha===controller.head&&caller.commit.tree?.sha===controller.tree,'verified-conditional-caller-disagrees');
  const workflow=role==='producer-combine'?{id:294257497,path:'.github/workflows/static-site.yml',name:'combine-and-build'}:
    {id:364666954,path:'.github/workflows/research-ui-release.yml',name:'publish'},job=caller.job;
  check(caller.run.workflow_id===workflow.id&&caller.run.path===workflow.path&&positive(job?.id)
    &&job.name===workflow.name&&job.run_id===caller.run.id&&job.run_attempt===1&&job.head_sha===controller.head
    &&job.status==='in_progress'&&job.conclusion===null&&typeof job.started_at==='string'
    &&/^\d{4}-\d\d-\d\dT.*Z$/.test(job.started_at)&&Number.isFinite(Date.parse(job.started_at))
    &&caller.job_started_at===job.started_at,'verified-conditional-job-disagrees');
  check(Array.isArray(criticalIds)&&criticalIds.every(positive)&&new Set(criticalIds).size===criticalIds.length,'invalid-verified-critical-ids');
  const cacheContext={...clone(owner.bound.scope),job_id:job.id,job_name:job.name,job_started_at:job.started_at,role,
    controller_tree:controller.tree,request_sha256:owner.bound.request_sha256,event_sha256:owner.bound.event_sha256,
    schema_version:'conditional-deployment-jobs-cache-context-v1',reader_version:'265ede759b1714c882015c696c6fac66975ae03a',
    representation:clone(REQUEST_REPRESENTATION)};
  if(owner.registered)check(canonical(owner.registered.context)===canonical(cacheContext),'conditional-caller-changed-within-invocation');
  else owner.registered={context:clone(cacheContext),job:clone(job)};
  const measurement=readerMeasurements.get(context.reader);for(const id of criticalIds)measurement.critical.add(id);
  if(owner.transport)finiteRegisteredTransport(owner,job);
  return true;
}
function verifiedInvocationCache(owner){
  check(owner.bound.binding()&&owner.registered,'unbound-conditional-history-caller');
  const context=owner.registered.context,state=publicCacheState();
  if(owner.expectedPublic)check(canonical(state)===canonical(owner.expectedPublic),'public-cache-environment-changed');
  const mode=process.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE??'';
  if(mode==='initialize'){
    check(Object.values(state).every(v=>v===null),'conditional-cache-already-initialized');
    const source=owner.bound.role==='producer-combine',command=source?'produce':'plan',
      entry=source?'retained-price-source-admission.mjs':'select-release-source.mjs',
      stepName=source?'Build static frontend':'Verify live provenance, UI gates and non-regressing data';
    check(process.execArgv.length===0&&process.argv[2]===command
      &&resolve(process.argv[1]??'')===join(owner.bound.root,'.github/scripts',entry),'unreviewed-cache-initialize-command');
    const steps=owner.registered.job.steps?.filter(step=>step.name===stepName);
    check(steps?.length===1&&steps[0].status==='in_progress'&&steps[0].conclusion===null,'unreviewed-cache-initialize-step');
    const encoded=Buffer.from(canonical(context)).toString('base64'),
      directory=join(process.env.RUNNER_TEMP,'conditional-jobs-'+context.job_id+'-'+context.role+'-'+randomUUID().replaceAll('-',''));
    // Publish the exact intended directory before creating any cache state.
    // An attempted marker is never permission for a failed phase to reinitialize.
    writeRunnerEnvironment({[PUBLIC_CACHE.context]:encoded,[PUBLIC_CACHE.directory]:directory,[PUBLIC_CACHE.attempted]:'v1'});
    let handle=null;
    try{
      handle=initializeJobCache({context,root:process.env.RUNNER_TEMP,directory,token:process.env.GH_TOKEN});
      check(handle.directory===directory,'initializer-directory-disagrees');
      writeRunnerEnvironment({[PUBLIC_CACHE.initialized]:'v1'});
      owner.expectedPublic=publicCacheState();return handle;
    }catch(error){
      if(handle&&isOwnedJobCacheHandle(handle))try{handle.dispose('failed');}catch(cleanupError){
        readerMeasurements.get(owner.reader)?.cacheEvent({operation:'failed-initialization-dispose',status:'failed',reason:typeof cleanupError?.code==='string'?cleanupError.code:'cache-disposal-failed'});
      }
      throw error;
    }
  }
  check(mode===''||mode==='resume','invalid-cache-phase-mode');
  check(state.attempted==='v1'&&state.initialized==='v1'&&typeof state.directory==='string'&&typeof state.context==='string','missing-initialized-conditional-cache');
  const stored=decodePublicContext(state.context);check(canonical(stored)===canonical(context),'public-cache-context-disagrees-with-fresh-caller');
  owner.expectedPublic=state;
  return openJobCache({context,directory:state.directory,token:process.env.GH_TOKEN});
}
export function withInvocationConditionalDeploymentJobs(repository,work){
  check(typeof work==='function','invalid-history-work');
  const nested=contexts.getStore();
  if(nested){check(repository===nested.reader.scope.repository&&readerBindings.has(nested.reader),'foreign-or-unowned-nested-history-scope');return withConditionalDeploymentJobsReader(nested.reader,work);}
  const bound=finiteInvocationBinding(repository);
  if(!bound){check(Object.values(publicCacheState()).every(v=>v===null)&&(process.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE??'')!=='initialize','initialized-conditional-context-no-longer-applicable');return work();}
  const owner={bound,registered:null,expectedPublic:null,phaseMode:process.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE??'',transport:null,
    transportCandidates:finiteInvocationCandidates(bound)};
  const binding=()=>bound.binding()&&(process.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE??'')===owner.phaseMode
    &&(!owner.expectedPublic||canonical(publicCacheState())===canonical(owner.expectedPublic))
    &&(!owner.transportClock||hash(boundedRegularFile(owner.transportClock.path))===owner.transportClock.sha256);
  const reader=createConditionalDeploymentJobsReader({...bound,binding,jobCacheProvider:()=>verifiedInvocationCache(owner),report:v=>console.error(JSON.stringify(v))});
  owner.reader=reader;readerMeasurements.get(reader).critical.add(bound.inferredSourceId);
  if(owner.transportCandidates.length)owner.transport=createFiniteTransportBudgetController({scope:bound.scope,role:bound.role,
    candidates:owner.transportCandidates,assertBinding:()=>readerBindings.get(reader)()});
  else check(bound.role==='publisher'&&process.argv[2]==='prepare-controller'&&process.argv.length===5&&process.argv[3]==='--output'
    &&resolve(process.argv[1]??'')===join(bound.entryRoot,'.github/scripts/retained-price-source-admission.mjs'),'unreviewed-finite-command');
  invocationBindings.set(reader,owner);return withConditionalDeploymentJobsReader(reader,work);
}
export function cleanupConditionalInvocationJobCache(){
  const state=publicCacheState();
  if(Object.values(state).every(v=>v===null))return {status:'not-initialized',storage_only:true};
  const bound=finiteInvocationBinding(REPO);check(bound,'unbound-conditional-cache-cleanup');
  check(state.attempted==='v1'&&[null,'v1'].includes(state.initialized)&&typeof state.directory==='string'&&typeof state.context==='string','incomplete-attempted-conditional-cache');
  const context=decodePublicContext(state.context),expectedJob=bound.role==='publisher'?'publish':'combine-and-build';
  check(canonical({repository:context.repository,repository_id:context.repository_id,run_id:context.run_id,run_attempt:context.run_attempt,controller_sha:context.controller_sha})===canonical(bound.scope)
    &&context.role===bound.role&&context.job_name===expectedJob&&context.request_sha256===bound.request_sha256
    &&context.event_sha256===bound.event_sha256,'foreign-conditional-cache-cleanup');
  const root=process.env.RUNNER_TEMP,prefix='conditional-jobs-'+context.job_id+'-'+context.role+'-';
  check(typeof root==='string'&&isAbsolute(root)&&root===resolve(root)&&realpathSync(root)===root
    &&dirname(state.directory)===root&&state.directory===resolve(state.directory)
    &&state.directory.slice(root.length+1).startsWith(prefix)
    &&/^[a-f0-9]{32}$/.test(state.directory.slice(root.length+1+prefix.length)),'unsafe-conditional-cleanup-directory');
  let exists=true;try{lstatSync(state.directory);}catch(error){if(error?.code==='ENOENT')exists=false;else throw error;}
  if(!exists){
    check(state.initialized===null,'initialized-conditional-cache-disappeared');
    return {status:'attempted-directory-absent',initialized:false,directory_exists:false,storage_only:true};
  }
  const result=cleanupJobCache({context,directory:state.directory,token:process.env.GH_TOKEN});
  for(const name of Object.values(PUBLIC_CACHE))delete process.env[name];
  return {...result,status:state.initialized==='v1'?'initialized-state-removed':'failed-initialization-state-removed',storage_only:true};
}
export function withConditionalDeploymentJobsReader(reader,work){
  check(readerMeasurements.has(reader)&&typeof work==='function','invalid-owned-history-reader');
  const failed=error=>{try{reader.dispose('failed');}catch{}throw error;};
  try{readerBindings.get(reader)();}catch(error){return failed(error);}
  const nested=contexts.getStore()?.reader===reader;
  return contexts.run({reader},()=>{
    try{
      const result=work();
      if(result&&typeof result.then==='function')return Promise.resolve(result).then(
        value=>{check(reader.disposition!=='failed','failed-history-scope');if(!nested)reader.dispose('complete');return value;},failed);
      check(reader.disposition!=='failed','failed-history-scope');if(!nested)reader.dispose('complete');return result;
    }catch(error){return failed(error);}
  });
}
export function readScopedDeploymentJobs(repository,api,candidates){
  const context=contexts.getStore();if(!context)return null;
  check(repository===context.reader.scope.repository&&typeof api==='function','foreign-history-scope');
  return context.reader.read(candidates);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  check(process.execArgv.length===0&&process.argv.length===3&&process.argv[2]==='cleanup','unknown-conditional-cache-command');
  console.log(JSON.stringify(cleanupConditionalInvocationJobCache()));
}


function finiteInvocationCandidates(bound){
  check(process.execArgv.length===0,'unreviewed-finite-node-options');
  const script=resolve(process.argv[1]??''),argv=process.argv.slice(2),policy=finiteTransportPolicy(bound.role);
  check(policy,'missing-finite-transport-policy');
  return policy.phases.filter(p=>script===join(bound.entryRoot,p.script)&&
    finiteTransportPhase({role:bound.role,job:policy.job,step:p.step,script:p.script,
      command:p.command,ordinal:p.ordinal,cli_argv:argv})===p);
}
function finiteRegisteredTransport(owner,job){
  const phases=owner.transportCandidates,found=phases.filter(p=>{
    const matches=job.steps?.filter(step=>step.name===p.step);
    return matches?.length===1&&matches[0].status==='in_progress'&&matches[0].conclusion===null;
  });
  check(found.length===1,'unreviewed-finite-cli-step');const phase=found[0],step=job.steps.find(s=>s.name===phase.step);
  check(typeof step.started_at==='string'&&Number.isFinite(Date.parse(step.started_at)),'missing-finite-step-clock');
  let deadline;
  if(phase.id==='browser')deadline=Date.parse(step.started_at)+480000;
  else{
    const path=join(process.env.RUNNER_TEMP,owner.bound.role==='producer-combine'?'retained-price-source-job-start':'retained-price-publisher-job-start');
    if(owner.bound.role==='publisher'&&phase.id==='restore')check(process.env.RETAINED_PRICE_PUBLISHER_JOB_START===path,'missing-original-publisher-clock');
    if(phase.id==='produce'){
      const argv=process.argv.slice(2),index=argv.indexOf('--job-start');check(index>0&&argv[index+1]===path,'changed-original-source-clock');
    }
    const raw=boundedRegularFile(path);check(raw.length<=128,'original-job-clock-cap');
    const pin={path,sha256:hash(raw)};
    if(owner.transportClock)check(canonical(owner.transportClock)===canonical(pin),'changed-original-job-clock');else owner.transportClock=pin;
    const epoch=Number(raw.toString('utf8').trim());
    check(Number.isFinite(epoch)&&epoch>0&&epoch*1000<=Date.now(),'invalid-original-job-clock');
    deadline=Math.min(epoch*1000,Date.parse(job.started_at))+100*60000-24000;
  }
  deadline=Math.min(deadline,Date.parse(job.started_at)+110*60000);
  check(Number.isSafeInteger(deadline)&&deadline>Date.now(),'finite-phase-deadline');
  owner.transport.register({verifiedContext:owner.registered.context,verifiedPhase:phase,verifiedJob:job,deadlineEpochMs:deadline});
  if(phase.predecessor_model_primary){
    const previous=job.steps.filter(s=>s.name===phase.predecessor_model_step);
    check(previous.length===1&&previous[0].status==='completed'&&previous[0].conclusion==='success'
      &&Number.isFinite(Date.parse(previous[0].completed_at)),'missing-completed-prepare-step');
    owner.predecessorModel={step:phase.predecessor_model_step,status:'completed',conclusion:'success',
      completed_at_epoch_ms:Date.parse(previous[0].completed_at)};
  }
}
function scopedTransportOwner(){
  const context=contexts.getStore(),owner=context&&invocationBindings.get(context.reader);
  return owner?.transport?owner:null;
}
export function hasScopedFiniteTransportBudget(repository){
  const owner=scopedTransportOwner();return Boolean(owner&&repository===owner.bound.scope.repository);
}
export function scopedNativeInventoryBudgetProvider(kind='admission'){
  const owner=scopedTransportOwner();return owner?owner.transport.nativeBudget(kind):null;
}
export function runScopedNativeInventory(command,args,options={}){
  const owner=scopedTransportOwner();if(!owner)return execFileSync(command,args,options);
  const receipt=owner.transport.currentNativeReceipt(),timeout=owner.transport.remainingMs(options.timeout??30000);
  owner.transport.enter(receipt);
  return execFileSync(command,args,{...options,timeout});
}
export function readScopedTransportApi(endpoint,paginate=false){
  const owner=scopedTransportOwner();
  if(!owner){
    if(!paginate)return {handled:false,value:null};
    const measurement=measurementContext();
    const value=readBoundedGitHubPages(endpoint,{
      command:(args,options)=>execFileSync('gh',args,{stdio:['ignore','pipe','pipe'],timeout:options.timeoutMs,maxBuffer:options.maxBuffer}),
      budget:{beforeRequest:()=>null,afterRequest:facts=>{
        if(facts.command_started)measurement?.api(facts.endpoint.replace('https://api.github.com/',''),true,
          facts.page_validated?[null]:null,facts.error_code?Error(facts.error_code):null);
      }},
    });
    return {handled:true,value};
  }
  check(typeof endpoint==='string'&&(endpoint==='repos/'+REPO||endpoint.startsWith('repos/'+REPO+'/'))
    &&!/[\s#]/.test(endpoint),'foreign-finite-api-route');
  const transport=owner.transport,measurement=readerMeasurements.get(owner.reader);
  let receipt=null;
  const command=(args,options)=>{
    check(receipt,'missing-finite-gh-receipt');
    const timeout=transport.remainingMs(options.timeoutMs);
    transport.enter(receipt);
    return execFileSync('gh',args,{stdio:['ignore','pipe','pipe'],timeout,maxBuffer:options.maxBuffer});
  };
  const hooks={
    beforeRequest:facts=>{receipt=transport.beforeGh(facts);return receipt;},
    afterRequest:(facts,ownedReceipt)=>{
      let rejected=null;try{transport.afterGh(facts,ownedReceipt);}catch(error){rejected=error;}
      if(ownedReceipt.nativeEntered&&paginate)measurement.api(facts.endpoint.replace('https://api.github.com/',''),true,
        facts.page_validated?[null]:null,rejected??(facts.error_code?Error(facts.error_code):null));
      if(rejected)throw rejected;
    },
  };
  try{
    let value;
    const prefix='repos/'+REPO+'/actions/runs/'+owner.bound.scope.run_id;
    if(!paginate&&[prefix,prefix+'/attempts/'+owner.bound.scope.run_attempt].includes(endpoint)){
      value=readBoundedRequiredCaller(endpoint,{scope:owner.bound.scope,command,budget:hooks,timeoutMs:transport.remainingMs(120000)});
      measurement.api(endpoint,false,value,null);
    }else if(paginate){
      const maximumPages=/\/actions\/workflows\/(294252465|294257497|364666954)\/runs\?/.test(endpoint)?10:100;
      value=readBoundedGitHubPages(endpoint,{command,budget:hooks,timeoutMs:transport.remainingMs(120000),maximumPages});
    }else{
      receipt=transport.beforeGh({endpoint},{legacy:true});
      try{
        const timeout=transport.remainingMs(30000);transport.enter(receipt);
        value=JSON.parse(execFileSync('gh',['api','https://api.github.com/'+endpoint,'--hostname','github.com','--method','GET'],
          {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout,maxBuffer:64*1024**2}));
        transport.afterGh({completed_gh_json:true,error_code:null,command_failed:false,endpoint},receipt);
        measurement.api(endpoint,false,value,null);
      }catch(error){
        if(receipt.nativeEntered)measurement.api(endpoint,false,null,error);
        transport.fail();throw error;
      }
    }
    return {handled:true,value};
  }catch(error){transport.fail();throw error;}
}
