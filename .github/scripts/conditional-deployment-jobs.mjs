// Private per-Node-invocation historical jobs transport. It grants no authority.
import {AsyncLocalStorage} from 'node:async_hooks';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,openSync,readSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {validateScope,runKey,validateJobsPages,decodePageRecord} from './conditional-deployment-jobs-worker.mjs';

const REPO='kusennjp1-ai/screener',RID=1203919607,contexts=new AsyncLocalStorage(),readerMeasurements=new WeakMap();
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
  const counts=baseCounts(),seen=new Set(),history=[],id=randomUUID();let disposed=false,incomplete=false;
  const critical=new Set([scope.run_id]);
  function api(endpoint,paginate,result,error){
    if(disposed)return;
    if(typeof endpoint!=='string'||!endpoint.startsWith('repos/'+scope.repository+'/')){incomplete=true;return;}
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
      publication_authority:false,counts:clone(counts),historical_batches:clone(history),
      gh_http_status_and_internal_retry_accounting:'not_observed_by_json_only_cli',
      shared_rate_header_deltas_are_not_owned_request_counts:true,measurement_incomplete:incomplete};
    try{
      const raw=JSON.stringify(value);
      if(Buffer.byteLength(raw)<=CONDITIONAL_HISTORY_SCOPE_LIMITS.diagnosticBytes)report(value);
      else report({schema_version:value.schema_version,scope_id:id,status:'diagnostic-bound',measurement_incomplete:true,publication_authority:false});
    }catch{}
    seen.clear();history.length=0;critical.clear();
  }
  return {scope,counts,critical,api,inventory,batch,unknownBatch,finish,get disposed(){return disposed;},get incomplete(){return incomplete;}};
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
  token=()=>process.env.GH_TOKEN,report=()=>{},binding=()=>true}){
  validateScope(scope);scope=Object.freeze(clone(scope));check(typeof run==='function'&&typeof monotonic==='function'&&typeof token==='function'&&typeof report==='function'&&typeof binding==='function','invalid-reader-functions');
  check(Array.isArray(excludedIds)&&excludedIds.every(positive)&&new Set(excludedIds).size===excludedIds.length,'invalid-critical-ids');
  let credential=token();check(typeof credential==='string'&&credential.length>0&&credential.length<=8192,'missing-existing-token');
  const measurement=scopeMeasurement(scope,report),critical=measurement.critical;for(const id of excludedIds)critical.add(id);
  let cache=[],disposed=false;
  const read=runs=>{
    check(!disposed,'disposed-history-scope');
    try{check(token()===credential&&binding(),'private-invocation-binding-changed');
      check(Array.isArray(runs)&&runs.length<=2000&&new Set(runs.map(r=>r?.id)).size===runs.length,'invalid-candidate-list');
    }catch(error){cache=[];disposed=true;credential=null;measurement.finish('failed');throw error;}
    if(!runs.length)return new Map();
    const config={scope:clone(scope),runs:clone(runs),cache:clone(cache),excludedIds:[...critical],timeoutMs:CONDITIONAL_HISTORY_SCOPE_LIMITS.workerMs};
    const input=JSON.stringify(config);check(Buffer.byteLength(input)<=CONDITIONAL_HISTORY_SCOPE_LIMITS.workerBytes,'worker-input-byte-bound');
    const start=monotonic();let raw='',result,counted=false;
    try{
      try{
        raw=run(process.execPath,['--max-old-space-size=384',workerPath()],{encoding:'utf8',stdio:['pipe','pipe','pipe'],input,
          timeout:CONDITIONAL_HISTORY_SCOPE_LIMITS.workerMs,killSignal:'SIGKILL',maxBuffer:CONDITIONAL_HISTORY_SCOPE_LIMITS.workerBytes});
      }catch(error){
        const failed=typeof error?.stdout==='string'?error.stdout:Buffer.isBuffer(error?.stdout)?error.stdout.toString('utf8'):null;
        if(failed!==null&&Buffer.byteLength(failed)<=CONDITIONAL_HISTORY_SCOPE_LIMITS.workerBytes){
          try{
            const value=JSON.parse(failed);
            if(object(value)&&value.schema_version==='conditional-deployment-jobs-v1'&&value.status==='failed'
              &&Array.isArray(value.jobs)&&value.jobs.length===0&&Array.isArray(value.cache)&&value.cache.length===0
              &&Array.isArray(value.observations)&&value.observations.every(o=>validObservation(o,runs,cache,critical,true))
              &&value.stats?.requests===value.observations.length){
              measurement.batch(value,monotonic()-start,failed);counted=true;
            }
          }catch{}
        }
        check(false,'worker-command-failed');
      }
      check(typeof raw==='string'&&Buffer.byteLength(raw)<=CONDITIONAL_HISTORY_SCOPE_LIMITS.workerBytes,'worker-output-byte-bound');
      try{result=JSON.parse(raw);}catch{check(false,'invalid-worker-json');}
      check(Array.isArray(result?.observations)&&result.observations.every(o=>validObservation(o,runs,cache,critical,result?.status==='failed')),'invalid-worker-observations');
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
        check(row&&row.status==='completed'&&!critical.has(row.id)&&p.etag!==null,'cache-contains-critical-or-foreign-member');
        const original=known.get(p.url+'|'+p.run_key);check(original&&canonical(original)===canonical(p),'cache-not-current-validated-page');
        decodePageRecord(row,p,scope);
      }
      check(Buffer.byteLength(JSON.stringify(result.cache))<=CONDITIONAL_HISTORY_SCOPE_LIMITS.cacheBytes,'cache-byte-bound');
      check(token()===credential&&binding(),'private-invocation-binding-changed');
      check(monotonic()-start<=CONDITIONAL_HISTORY_SCOPE_LIMITS.workerMs,'history-time-bound');
      cache=clone(result.cache);return output;
    }catch(error){
      if(!counted)measurement.unknownBatch();
      cache=[];disposed=true;credential=null;measurement.finish('failed');
      throw error?.conditionalReason?error:Object.assign(Error('Conditional historical jobs rejected: worker-or-validation-failure'),{conditionalReason:'worker-or-validation-failure'});
    }
  };
  const reader={read,scope:Object.freeze(clone(scope)),stats:()=>({counts:clone(measurement.counts),cache_bytes:Buffer.byteLength(JSON.stringify(cache)),disposed}),
    dispose:(status='complete')=>{if(disposed)return;disposed=true;cache=[];credential=null;measurement.finish(status);readerMeasurements.delete(reader);},
    get disposed(){return disposed;}};
  readerMeasurements.set(reader,measurement);return reader;
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
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW),buffer=Buffer.alloc(1024**2+1);let length=0;
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
function publisherBinding(repository){
  const actual=actualContext(repository),e=process.env;
  if(!actual||actual.file!=='research-ui-release.yml'||e.GITHUB_EVENT_NAME!=='workflow_run'||actual.scope.run_attempt!==1)return null;
  check(typeof e.GITHUB_EVENT_PATH==='string'&&isAbsolute(e.GITHUB_EVENT_PATH),'missing-actual-event-path');
  const eventPath=e.GITHUB_EVENT_PATH,eventRaw=boundedRegularFile(eventPath);
  const event=JSON.parse(eventRaw),source=event.workflow_run;
  if(source?.path!=='.github/workflows/static-site.yml'||source.event!=='workflow_run'||source.head_sha!==actual.scope.controller_sha
    ||source.head_branch!=='main'||source.status!=='completed'||source.conclusion!=='success'||!positive(source.id)
    ||source.repository?.id!==RID||source.repository?.full_name!==REPO||source.head_repository?.id!==RID||source.head_repository?.full_name!==REPO)return null;
  let root=process.cwd();
  if(e.RETAINED_PRICE_CONTROLLER_ROOT!==undefined){
    check(typeof e.RUNNER_TEMP==='string'&&isAbsolute(e.RUNNER_TEMP)&&e.RETAINED_PRICE_CONTROLLER_ROOT===join(e.RUNNER_TEMP,'retained-price-controller'),'unexpected-controller-root');
    root=e.RETAINED_PRICE_CONTROLLER_ROOT;
  }
  root=resolve(root);check(realpathSync(root)===root&&lstatSync(root).isDirectory(),'linked-controller-root');
  const path=join(root,'.github/retained-price-oct6-source.json'),raw=boundedRegularFile(path),request=JSON.parse(raw);
  if(request?.schema_version!=='retained-price-oct6-source-v1'||request.enabled!==true||!object(request.activation))return null;
  const digest=hash(raw),eventDigest=hash(eventRaw),initialEnv=Object.fromEntries(['GITHUB_EVENT_PATH','GITHUB_SHA','GITHUB_WORKFLOW_SHA','GITHUB_WORKFLOW_REF','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_REF','GITHUB_EVENT_NAME','GITHUB_REPOSITORY','GITHUB_REPOSITORY_ID'].map(k=>[k,e[k]]));
  const binding=()=>Object.entries(initialEnv).every(([k,v])=>process.env[k]===v)&&hash(boundedRegularFile(path))===digest&&hash(boundedRegularFile(eventPath))===eventDigest;
  return {scope:actual.scope,excludedIds:[source.id],binding};
}
export function withInvocationConditionalDeploymentJobs(repository,work){
  check(typeof work==='function','invalid-history-work');
  const bound=publisherBinding(repository);if(!bound)return work();
  const reader=createConditionalDeploymentJobsReader({...bound,report:v=>console.error(JSON.stringify(v))});
  return withConditionalDeploymentJobsReader(reader,work);
}
export function withConditionalDeploymentJobsReader(reader,work){
  check(readerMeasurements.has(reader)&&typeof work==='function','invalid-owned-history-reader');
  return contexts.run({reader},()=>{
    try{
      const result=work();
      if(result&&typeof result.then==='function')return Promise.resolve(result).then(
        value=>{reader.dispose('complete');return value;},error=>{reader.dispose('failed');throw error;});
      reader.dispose('complete');return result;
    }catch(error){reader.dispose('failed');throw error;}
  });
}
export function readScopedDeploymentJobs(repository,api,candidates){
  const context=contexts.getStore();if(!context)return null;
  check(repository===context.reader.scope.repository&&typeof api==='function','foreign-history-scope');
  return context.reader.read(candidates);
}
