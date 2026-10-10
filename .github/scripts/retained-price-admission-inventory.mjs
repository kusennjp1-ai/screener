// One coherent run inventory per admission gate. Individual API reads stay fresh.
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LIMITS,REPOSITORY,REPOSITORY_ID,validateRequiredIds,validateSnapshot,route} from './retained-price-repository-inventory.mjs';

export const ADMISSION_INVENTORY_LIMITS=Object.freeze({attempts:2,attemptMs:30000,totalMs:60000,bytes:LIMITS.bytes,repositoryRuns:LIMITS.runs,projectedRuns:LIMITS.projectedRuns});
const WORKFLOWS=new Map([[294252465,{path:'.github/workflows/ci.yml',event:'push'}],
  [294257497,{path:'.github/workflows/static-site.yml',event:'workflow_run'}],
  [364666954,{path:'.github/workflows/research-ui-release.yml',event:'workflow_run'}]]);
const transports=new WeakMap();
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const facts=raw=>({bytes:Buffer.byteLength(raw),sha256:hash(raw)});
const fault=reason=>Object.assign(Error('Finite price admission inventory rejected: '+reason),{inventoryReason:reason});
const check=(v,reason)=>{if(!v)throw fault(reason);};
const RETRYABLE=new Set(['transport-timeout','transport-or-json-eof','json-eof','changing-inventory-total']);
const REASONS=new Set([...RETRYABLE,'invalid-required-run-anchors','invalid-inventory-schema-or-bound','invalid-page-number',
  'incomplete-inventory','invalid-or-duplicate-run','foreign-repository-run','invalid-head-repository','conflicting-head-repository',
  'invalid-run-identity-or-schema','conflicting-workflow-identity','invalid-pagination-link','pagination-origin-or-route','pagination-query',
  'incomplete-pagination','inconsistent-pagination','unknown-workflow-projection','projected-workflow-bound','required-run-anchor-absent',
  'unclassified-inventory-failure','incomplete-or-aborted-inventory','http-or-security-denial','sibling-aborted','unclassified-transport-failure',
  'invalid-inventory-time-budget','missing-actions-token','invalid-response-body','byte-limit','invalid-json-encoding','invalid-json',
  'invalid-worker-input','response-origin-or-route']);
const workerPath=()=>join(dirname(fileURLToPath(import.meta.url)),'retained-price-repository-inventory.mjs');
const denied=items=>items.some(p=>p.status>=300||p.safe_headers?.['x-ratelimit-remaining']==='0'||p.safe_headers?.retry_after_present===true);


const ACQUISITION_FACT_BYTES=128*1024;
const safeAcquisitionNumber=value=>Number.isFinite(value)&&value>=0?value:null;
const safeAcquisitionReason=value=>typeof value==='string'&&(REASONS.has(value)||[
  'time-budget-exhausted','unclassified-command-failure','invalid-command-output','invalid-worker-result','invalid-worker-evidence',
  'unclassified-worker-failure','diagnostic-byte-limit','attempt-limit','invalid-acquisition-budget-provider','invalid-acquisition-budget-hooks',
  'invalid-acquisition-budget-descriptor','acquisition-budget-before','acquisition-budget-attempt','acquisition-budget-after'
].includes(value))?value:'unclassified-inventory-failure';
function acquisitionErrorReason(error){
  try{return safeAcquisitionReason(error?.inventoryReason);}catch{return 'unclassified-inventory-failure';}
}
function freezeAcquisitionFacts(value){
  check(Buffer.byteLength(JSON.stringify(value))<=ACQUISITION_FACT_BYTES,'acquisition-budget-facts-bound');
  const freeze=item=>{
    if(Array.isArray(item))return Object.freeze(item.map(freeze));
    if(object(item))return Object.freeze(Object.fromEntries(Object.entries(item).map(([key,entry])=>[key,freeze(entry)])));
    return item;
  };
  return freeze(value);
}
function acquisitionHook(callback,args,reason){
  try{
    const value=callback(...args);
    if(value&&typeof value.then==='function'){Promise.resolve(value).catch(()=>{});throw fault(reason);}
    check(value!==false,reason);return value;
  }catch{throw fault(reason);}
}
function acquisitionAttemptFacts({attempt,status,reason,retry,start,ended,elapsed,usedMs,exit,signal,evidence}){
  return freezeAcquisitionFacts({schema_version:'retained-price-admission-acquisition-attempt-v1',attempt,status,
    reason:reason===null?null:safeAcquisitionReason(reason),retry_planned:retry===true,
    started_ms:safeAcquisitionNumber(start),ended_ms:safeAcquisitionNumber(ended),elapsed_ms:safeAcquisitionNumber(elapsed),
    inventory_budget_used_ms:safeAcquisitionNumber(usedMs),command_started:true,native_request_issued:null,wire_request_count:null,
    exit_code:Number.isInteger(exit)?exit:null,signal,
    page_evidence:evidence.map(item=>({...item,quota_resource:item.safe_headers?.['x-ratelimit-resource']??null}))});
}

// A caller may supply a subprocess implementation without changing snapshot validation.
// The returned API retains no snapshot; every exported admission gate creates its own scope.
export function createRetainedPriceAdmissionApi(api,{run=execFileSync,monotonic=()=>performance.now(),report=value=>console.error(JSON.stringify(value)),budgetProvider}={}){
  check(typeof api==='function'&&typeof run==='function'&&typeof monotonic==='function'&&typeof report==='function'&&(budgetProvider===undefined||typeof budgetProvider==='function'),'invalid-admission-reader');
  const wrapped=(endpoint,paginate=false)=>api(endpoint,paginate);transports.set(wrapped,{run,monotonic,report,budgetProvider});return wrapped;
}
function evidenceFacts(value){
  check(Array.isArray(value)&&value.length<=40,'invalid-worker-evidence');
  return value.map(p=>{
    check(object(p),'invalid-worker-evidence');
    const item={};
    for(const key of ['page_number','status','observed_total','row_count','body_bytes'])item[key]=Number.isSafeInteger(p[key])&&p[key]>=0?p[key]:null;
    if(positive(p.page_number)&&p.page_number<=40&&p.requested_route===route(p.page_number))item.requested_route=p.requested_route;
    for(const key of ['body_sha256','ids_sha256'])item[key]=/^[a-f0-9]{64}$/.test(p[key]??'')?p[key]:null;
    if(REASONS.has(p.reason))item.reason=p.reason;
    item.safe_headers={};
    if(object(p.safe_headers))for(const [key,v] of Object.entries(p.safe_headers)){
      if(/^(?:x-ratelimit-(?:limit|remaining|reset|used)|retry-after|content-length)$/.test(key)&&typeof v==='string'&&/^\d{1,15}$/.test(v))item.safe_headers[key]=v;
      if(key==='x-github-request-id'&&typeof v==='string'&&/^[a-zA-Z0-9:-]{1,128}$/.test(v))item.safe_headers[key]=v;
      if(key==='retry_after_present'&&v===true)item.safe_headers[key]=true;
      if(key==='x-ratelimit-resource'&&v==='core')item.safe_headers[key]=v;
    }
    return item;
  });
}
function commandReason(error){
  const text=[error?.stderr,error?.message,error?.code].filter(Boolean).join('\n');
  if(/HTTP(?:\/\S+)?\s+[45]\d\d\b|\b(?:401|403|429)\b|rate.?limit|retry-after|unauthori[sz]ed|forbidden|denied|bad credentials|authentication|authorization|resource not accessible|security|certificate|\bx509\b|\bTLS\b|\bSSL\b|\bSSO\b|abuse detection/i.test(text))return 'http-or-security-denial';
  if(error?.code==='ENOBUFS')return 'byte-limit';
  if(error?.code==='ETIMEDOUT')return 'transport-timeout';
  if(error?.code==='ECONNRESET'||/unexpected end of JSON input|unexpected EOF|\bEOF\s*$|connection reset by peer|\bECONNRESET\b/i.test(text))return 'transport-or-json-eof';
  return 'unclassified-command-failure';
}
function identity(r){return Object.fromEntries(['id','run_attempt','workflow_id','path','head_sha','head_branch','event','status','conclusion','created_at','run_started_at','updated_at'].map(k=>[k,r[k]]));}
function pagesFor(runs){
  const pages=[];for(let n=0;n<Math.max(1,runs.length);n+=100)pages.push({total_count:runs.length,workflow_runs:runs.slice(n,n+100)});return pages;
}
export function createRetainedPriceAdmissionInventory(api,{requiredIds,head,budgetProvider:directBudgetProvider,run:directRun}={}){
  check(typeof api==='function'&&/^[a-f0-9]{40}$/.test(head??''),'invalid-admission-scope');
  check(directBudgetProvider===undefined||typeof directBudgetProvider==='function','invalid-acquisition-budget-provider');
  check(directRun===undefined||typeof directRun==='function','invalid-admission-reader');
  const anchors=Object.freeze(validateRequiredIds(requiredIds));
  const {run:transportRun,monotonic,report,budgetProvider:transportBudgetProvider}=transports.get(api)??{run:execFileSync,monotonic:()=>performance.now(),report:value=>console.error(JSON.stringify(value))};
  const run=directRun??transportRun,budgetProvider=directBudgetProvider??transportBudgetProvider;
  const endpoints=new Map([...WORKFLOWS].map(([id,w])=>['repos/'+REPOSITORY+'/actions/workflows/'+id+'/runs?branch=main&event='+w.event+'&head_sha='+head+'&per_page=100',id]));
  let disposed=false,snapshot=null,usedMs=0,budgetRejection=null,budgetPoisoned=false;
  const callId=randomUUID();
  function acquireSnapshot(operation=null){
    if(snapshot)return snapshot;
    for(let attempt=1;attempt<=ADMISSION_INVENTORY_LIMITS.attempts;attempt++){
      let entered=false,start=null,attemptObservation=null,attemptRejection=null,attemptThrown=null,attemptFailed=false;
      try{
      const sample=monotonic();start=sample;const remaining=Math.floor(Math.min(ADMISSION_INVENTORY_LIMITS.totalMs-usedMs,ADMISSION_INVENTORY_LIMITS.attemptMs));
      let raw='',failedOut='',failedErr='',evidence=[],exit=null,signal=null,retryable=false;
      try{
        check(remaining>0,'time-budget-exhausted');
        try{entered=true;raw=run(process.execPath,['--max-old-space-size=384',workerPath()],{encoding:'utf8',stdio:['pipe','pipe','pipe'],
          input:JSON.stringify({timeoutMs:remaining,requiredIds:anchors}),maxBuffer:ADMISSION_INVENTORY_LIMITS.bytes,timeout:remaining,killSignal:'SIGKILL'});}
        catch(e){failedOut=e.stdout??'';failedErr=e.stderr??'';exit=Number.isInteger(e.status)?e.status:null;
          signal=['SIGKILL','SIGTERM','SIGINT','SIGHUP'].includes(e.signal)?e.signal:null;
          const reason=commandReason(e);retryable=RETRYABLE.has(reason);throw fault(reason);}
        exit=0;check(typeof raw==='string'&&Buffer.byteLength(raw)<=ADMISSION_INVENTORY_LIMITS.bytes,'invalid-command-output');
        let result;try{result=JSON.parse(raw);}catch(e){
          const reason=e instanceof SyntaxError&&/Unexpected end of JSON input|Unterminated string in JSON/i.test(e.message)?'json-eof':'invalid-json';
          retryable=reason==='json-eof';throw fault(reason);
        }
        check(object(result)&&result.schema_version==='retained-price-repository-snapshot-v1'&&['complete','failed'].includes(result.status)
          &&Number.isSafeInteger(result.body_bytes)&&result.body_bytes>=0,'invalid-worker-result');
        evidence=evidenceFacts(result.evidence);
        check(!denied(evidence),'http-or-security-denial');
        check(result.body_bytes<=ADMISSION_INVENTORY_LIMITS.bytes,'byte-limit');
        if(result.status==='failed'){check(REASONS.has(result.reason),'unclassified-worker-failure');retryable=result.retryable===true&&RETRYABLE.has(result.reason);throw fault(result.reason);}
        check(monotonic()-start<=remaining,'time-budget-exhausted');
        const complete=validateSnapshot(result.pages,anchors);
        check(evidence.length===complete.pages.length&&new Set(evidence.map(p=>p.page_number)).size===evidence.length
          &&evidence.every(p=>p.page_number>=1&&p.page_number<=evidence.length&&p.requested_route===route(p.page_number)
            &&p.status===200&&p.body_bytes>0&&p.body_sha256!==null&&p.ids_sha256!==null
            &&p.observed_total===complete.total&&p.row_count===complete.pages[p.page_number-1].value.workflow_runs.length
            &&p.ids_sha256===hash(JSON.stringify(complete.pages[p.page_number-1].value.workflow_runs.map(r=>r.id))))
          &&evidence.reduce((n,p)=>n+p.body_bytes,0)===result.body_bytes,'invalid-worker-evidence');
        for(const [id,w] of WORKFLOWS)check(complete.runs.every(r=>(r.workflow_id===id)===(r.path===w.path)),'conflicting-workflow-identity');
        const projections=new Map();
        for(const [id,w] of WORKFLOWS){
          const rs=complete.runs.filter(r=>r.workflow_id===id&&r.path===w.path&&r.head_sha===head&&r.head_branch==='main'&&r.event===w.event
            &&r.repository.id===REPOSITORY_ID&&r.repository.full_name===REPOSITORY&&r.head_repository.id===REPOSITORY_ID&&r.head_repository.full_name===REPOSITORY);
          check(rs.length<=ADMISSION_INVENTORY_LIMITS.projectedRuns,'projected-workflow-bound');projections.set(id,JSON.stringify(pagesFor(rs)));
        }
        check(monotonic()-start<=remaining,'time-budget-exhausted');
        const ended=monotonic(),elapsed=Math.max(0,Math.ceil(ended-start));usedMs+=elapsed;
        if(operation)attemptObservation=acquisitionAttemptFacts({attempt,status:'complete',reason:null,retry:false,start,ended,elapsed,usedMs,exit,signal,evidence});
        const observation={schema_version:'retained-price-admission-inventory-read-v1',call_id:callId,snapshot_id:callId+'/'+attempt,status:'complete',
          head_sha:head,required_run_ids:anchors,attempt,fresh_from_page:1,elapsed_ms:elapsed,inventory_budget_used_ms:usedMs,
          repository_pages:complete.pages.length,repository_total_count:complete.total,repository_body_bytes:result.body_bytes,
          repository_inventory_sha256:hash(JSON.stringify(complete.pages)),stdout:facts(raw),page_evidence:evidence,
          projections:[...WORKFLOWS].map(([id,w])=>({workflow_id:id,path:w.path,event:w.event,
            runs:JSON.parse(projections.get(id)).flatMap(p=>p.workflow_runs).map(identity)}))};
        check(Buffer.byteLength(JSON.stringify(observation))<=8*1024**2,'diagnostic-byte-limit');report(observation);
        snapshot=projections;return snapshot;
      }catch(e){
        const reason=denied(evidence)?'http-or-security-denial':e.inventoryReason??'unclassified-inventory-failure';
        const ended=monotonic(),elapsed=Math.max(0,Math.ceil(ended-start));usedMs+=elapsed;
        const retry=retryable&&RETRYABLE.has(reason)&&attempt<ADMISSION_INVENTORY_LIMITS.attempts&&usedMs<ADMISSION_INVENTORY_LIMITS.totalMs;
        if(operation){attemptRejection=fault(reason);attemptObservation=acquisitionAttemptFacts({attempt,status:'failed',reason,retry,start,ended,elapsed,usedMs,exit,signal,evidence});}
        report({schema_version:'retained-price-admission-inventory-read-v1',call_id:callId,status:'failed',head_sha:head,required_run_ids:anchors,
          attempt,reason,fresh_from_page:1,elapsed_ms:elapsed,inventory_budget_used_ms:usedMs,exit_code:exit,signal,
          page_evidence:evidence,stdout:facts(raw),failed_stdout:facts(failedOut),failed_stderr:facts(failedErr),retry});
        if(!retry)throw attemptRejection??fault(reason);
      }
      }catch(error){attemptFailed=true;attemptThrown=error;throw error;}
      finally{
        if(entered&&operation){
          const observation=attemptObservation??acquisitionAttemptFacts({attempt,status:'failed',reason:acquisitionErrorReason(attemptThrown),retry:false,start,ended:null,elapsed:null,usedMs,exit:null,signal:null,evidence:[]});
          try{operation.finishAttempt(observation);}
          catch(cleanup){budgetPoisoned=true;budgetRejection=attemptFailed?attemptThrown:attemptRejection??cleanup;snapshot=null;throw budgetRejection;}
        }
      }
    }
    throw fault('attempt-limit');
  }
  function acquire(){
    if(budgetPoisoned)throw budgetRejection;
    if(snapshot)return snapshot;
    let budget;
    try{
      budget=budgetProvider?.();
      if(budget&&typeof budget.then==='function'){Promise.resolve(budget).catch(()=>{});throw fault('invalid-acquisition-budget-provider');}
    }catch{budgetPoisoned=true;budgetRejection=fault('invalid-acquisition-budget-provider');throw budgetRejection;}
    if(budget===null||budget===undefined)return acquireSnapshot();
    let hooks,descriptor,receipt,stage='invalid-acquisition-budget-hooks';
    try{
      check(object(budget),'invalid-acquisition-budget-hooks');
      hooks={before:budget.beforeAcquisition,attempt:budget.afterAttempt,after:budget.afterAcquisition};
      check(Object.values(hooks).every(value=>typeof value==='function'),'invalid-acquisition-budget-hooks');
      stage='invalid-acquisition-budget-descriptor';
      check(typeof head==='string'&&/^[a-f0-9]{40}$/.test(head),'invalid-acquisition-budget-descriptor');
      descriptor=freezeAcquisitionFacts({head,requiredIds:anchors,maximumStarts:80,maximumPrimary:160,timeoutMs:60000});
      stage='acquisition-budget-before';
      receipt=acquisitionHook(hooks.before,[descriptor],'acquisition-budget-before');
    }catch{budgetPoisoned=true;budgetRejection=fault(stage);throw budgetRejection;}
    const attempts=[];
    const operation={finishAttempt:observation=>{
      attempts.push(observation);
      acquisitionHook(hooks.attempt,[observation,receipt],'acquisition-budget-attempt');
    }};
    let result,rejection,failed=false;
    try{result=acquireSnapshot(operation);}catch(error){failed=true;rejection=error;}
    const final=freezeAcquisitionFacts({schema_version:'retained-price-admission-acquisition-v1',
      status:failed?'failed':'complete',head,requiredIds:anchors,maximumStarts:80,maximumPrimary:160,timeoutMs:60000,
      entered_attempts:attempts.length,attempts,inventory_budget_used_ms:safeAcquisitionNumber(usedMs),
      reason:failed?acquisitionErrorReason(rejection):null,
      native_request_issued:attempts.length?null:false,wire_request_count:null});
    try{acquisitionHook(hooks.after,[final,receipt],'acquisition-budget-after');}
    catch(cleanup){budgetPoisoned=true;budgetRejection=failed?rejection:cleanup;if(!failed){failed=true;rejection=cleanup;}}
    if(failed){snapshot=null;throw rejection;}
    return result;
  }
  const scoped=(endpoint,paginate=false)=>{
    check(!disposed,'disposed-admission-scope');
    const workflow=endpoints.get(endpoint);
    if(workflow!==undefined){check(paginate===true,'invalid-admission-projection-call');return JSON.parse(acquire().get(workflow));}
    check(!endpoint.startsWith('repos/'+REPOSITORY+'/actions/workflows/'),'unknown-admission-inventory-route');
    return api(endpoint,paginate);
  };
  scoped.dispose=()=>{disposed=true;snapshot=null;};
  return scoped;
}
