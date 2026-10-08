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

// A caller may supply a subprocess implementation without changing snapshot validation.
// The returned API retains no snapshot; every exported admission gate creates its own scope.
export function createRetainedPriceAdmissionApi(api,{run=execFileSync,monotonic=()=>performance.now(),report=value=>console.error(JSON.stringify(value))}={}){
  check(typeof api==='function'&&typeof run==='function'&&typeof monotonic==='function'&&typeof report==='function','invalid-admission-reader');
  const wrapped=(endpoint,paginate=false)=>api(endpoint,paginate);transports.set(wrapped,{run,monotonic,report});return wrapped;
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
export function createRetainedPriceAdmissionInventory(api,{requiredIds,head}={}){
  check(typeof api==='function'&&/^[a-f0-9]{40}$/.test(head??''),'invalid-admission-scope');
  const anchors=Object.freeze(validateRequiredIds(requiredIds));
  const {run,monotonic,report}=transports.get(api)??{run:execFileSync,monotonic:()=>performance.now(),report:value=>console.error(JSON.stringify(value))};
  const endpoints=new Map([...WORKFLOWS].map(([id,w])=>['repos/'+REPOSITORY+'/actions/workflows/'+id+'/runs?branch=main&event='+w.event+'&head_sha='+head+'&per_page=100',id]));
  let disposed=false,snapshot=null,usedMs=0;
  const callId=randomUUID();
  function acquire(){
    if(snapshot)return snapshot;
    for(let attempt=1;attempt<=ADMISSION_INVENTORY_LIMITS.attempts;attempt++){
      const start=monotonic(),remaining=Math.floor(Math.min(ADMISSION_INVENTORY_LIMITS.totalMs-usedMs,ADMISSION_INVENTORY_LIMITS.attemptMs));
      let raw='',failedOut='',failedErr='',evidence=[],exit=null,signal=null,retryable=false;
      try{
        check(remaining>0,'time-budget-exhausted');
        try{raw=run(process.execPath,['--max-old-space-size=384',workerPath()],{encoding:'utf8',stdio:['pipe','pipe','pipe'],
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
        const elapsed=Math.max(0,Math.ceil(monotonic()-start));usedMs+=elapsed;
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
        const elapsed=Math.max(0,Math.ceil(monotonic()-start));usedMs+=elapsed;
        const retry=retryable&&RETRYABLE.has(reason)&&attempt<ADMISSION_INVENTORY_LIMITS.attempts&&usedMs<ADMISSION_INVENTORY_LIMITS.totalMs;
        report({schema_version:'retained-price-admission-inventory-read-v1',call_id:callId,status:'failed',head_sha:head,required_run_ids:anchors,
          attempt,reason,fresh_from_page:1,elapsed_ms:elapsed,inventory_budget_used_ms:usedMs,exit_code:exit,signal,
          page_evidence:evidence,stdout:facts(raw),failed_stdout:facts(failedOut),failed_stderr:facts(failedErr),retry});
        if(!retry)throw fault(reason);
      }
    }
    throw fault('attempt-limit');
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
