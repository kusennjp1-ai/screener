// Synchronous caller adapter: only an immediate publisher -> Static pair shares
// one complete snapshot. No snapshot survives a yield, unrelated API call or error.
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {LIMITS,REPOSITORY,WORKFLOWS,validateRequiredIds,validateSnapshot,project,route} from './retained-price-repository-inventory.mjs';

const ENDPOINTS=new Map([...WORKFLOWS].map(([id,file])=>[
  'repos/'+REPOSITORY+'/actions/workflows/'+file+'/runs?branch=main&per_page=100',{file,id}]));
const PUBLISHER=364666954,STATIC=294257497;
export const LIVE_INVENTORY_LIMITS=Object.freeze({attempts:2,attemptMs:30000,totalMs:60000,bytes:LIMITS.bytes,runs:1000,repositoryRuns:2000});
const workerPath=()=>join(dirname(fileURLToPath(import.meta.url)),'retained-price-repository-inventory.mjs');
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const facts=raw=>({bytes:Buffer.byteLength(raw),sha256:hash(raw)});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fault=(reason,retryable=false)=>Object.assign(Error('Fresh live workflow inventory rejected: '+reason),{inventoryReason:reason,retryable});
const requireValue=(value,reason)=>{if(!value)throw fault(reason);};
function safeHttpFacts(raw){
  let rest=String(raw??''),lines=[],ambiguous=false;const statuses=[];
  // gh --include should return one response. Recognize only contiguous header
  // blocks at the start; HTTP-looking text inside JSON is ordinary run data.
  for(let block=0;block<4;block++){
    const split=rest.search(/\r?\n\r?\n/),header=split<0?rest:rest.slice(0,split);
    const match=/^HTTP\/\S+\s+(\d{3})(?:\s|$)/.exec(header);
    if(!match){if(!statuses.length)return null;ambiguous=true;break;}
    lines=header.split(/\r?\n/);statuses.push(Number(match[1]));
    if(split<0)break;
    rest=rest.slice(split).replace(/^\r?\n\r?\n/,'');
    if(!/^\s*HTTP\//.test(rest))break;
    ambiguous=true;rest=rest.trimStart();
  }
  const result={status:statuses.at(-1)};
  if(ambiguous){result.ambiguous_headers=true;result.status_chain=statuses;}
  if(lines.slice(1).some(line=>/^retry-after:/i.test(line)))result.retry_after_present=true;
  for(const [name,key]of [['x-ratelimit-remaining','rate_limit_remaining'],['x-ratelimit-limit','rate_limit_limit'],['x-ratelimit-reset','rate_limit_reset'],['retry-after','retry_after_seconds'],['x-github-request-id','request_id']]){
    const values=lines.slice(1).filter(line=>line.toLowerCase().startsWith(name+':')).map(line=>line.slice(name.length+1).trim());
    if(values.length!==1)continue;
    if(key==='request_id'){if(/^[a-zA-Z0-9:-]{1,128}$/.test(values[0]))result[key]=values[0];}
    else if(/^\d{1,15}$/.test(values[0])&&Number.isSafeInteger(Number(values[0])))result[key]=Number(values[0]);
  }
  return result;
}

function commandFailure(error){
  const http=safeHttpFacts(error.stdout);
  // A partial 200 body may contain arbitrary commit titles ("security fix").
  // Only HTTP headers and command diagnostics can identify a denial.
  const text=[error.stderr,error.message].filter(Boolean).join('\n');
  // Denial wins even when the same output also contains an EOF/transport string.
  if(http?.status>=400||http?.rate_limit_remaining===0||http?.retry_after_present
    ||/HTTP(?:\/\S+)?\s+[45]\d\d\b|\b(?:401|403|429)\b|rate.?limit|retry-after|unauthori[sz]ed|forbidden|denied|bad credentials|authentication|authorization|resource not accessible|security|certificate|\bx509\b|\bTLS\b|\bSSL\b|\bSSO\b|abuse detection/i.test(text))return fault('http-or-security-denial');
  if(http?.ambiguous_headers)return fault('ambiguous-http-headers');
  if(error.code==='ENOBUFS')return fault('byte-limit');
  if(error.code==='ETIMEDOUT')return fault('transport-timeout',true);
  if(error.code==='ECONNRESET'||/unexpected end of JSON input|unexpected EOF|\bEOF\s*$|connection reset by peer|\bECONNRESET\b/i.test(text))return fault('transport-or-json-eof',true);
  return fault('unclassified-command-failure');
}


const RETRYABLE=new Set(['transport-timeout','transport-or-json-eof','json-eof','changing-inventory-total']);
const REASONS=new Set([...RETRYABLE,'invalid-required-run-anchors','invalid-inventory-schema-or-bound','invalid-page-number',
  'incomplete-inventory','invalid-or-duplicate-run','foreign-repository-run','invalid-head-repository','conflicting-head-repository',
  'invalid-run-identity-or-schema','conflicting-workflow-identity','invalid-pagination-link','pagination-origin-or-route','pagination-query',
  'incomplete-pagination','inconsistent-pagination','unknown-workflow-projection','projected-workflow-bound','required-run-anchor-absent',
  'unclassified-inventory-failure','incomplete-or-aborted-inventory','http-or-security-denial','sibling-aborted','unclassified-transport-failure',
  'invalid-inventory-time-budget','missing-actions-token','invalid-response-body','byte-limit','invalid-json-encoding','invalid-json','invalid-worker-input','response-origin-or-route']);
function pageFacts(value){
  if(!Array.isArray(value)||value.length>40)throw fault('invalid-worker-evidence');
  return value.map(item=>{
    requireValue(object(item),'invalid-worker-evidence');
    const safe={};
    if(Number.isSafeInteger(item.page_number)&&item.page_number>=1&&item.page_number<=40
      &&item.requested_route===route(item.page_number))safe.requested_route=item.requested_route;
    for(const key of ['page_number','status','observed_total','row_count','body_bytes'])
      if(Number.isSafeInteger(item[key])&&item[key]>=0)safe[key]=item[key];else safe[key]=null;
    for(const key of ['body_sha256','ids_sha256'])safe[key]=/^[a-f0-9]{64}$/.test(item[key]??'')?item[key]:null;
    if(REASONS.has(item.reason))safe.reason=item.reason;
    safe.safe_headers={};
    if(object(item.safe_headers)){
      for(const[key,value]of Object.entries(item.safe_headers)){
        if(/^(?:x-ratelimit-(?:limit|remaining|reset|used)|retry-after|content-length)$/.test(key)&&typeof value==='string'&&/^\d{1,15}$/.test(value))safe.safe_headers[key]=value;
        if(key==='x-github-request-id'&&typeof value==='string'&&/^[a-zA-Z0-9:-]{1,128}$/.test(value))safe.safe_headers[key]=value;
        if(key==='retry_after_present'&&value===true)safe.safe_headers[key]=true;
      }
    }
    return safe;
  });
}
const denied=items=>items.some(item=>item.status>=300||item.safe_headers?.['x-ratelimit-remaining']==='0'||item.safe_headers?.retry_after_present);
function pagesFor(runs){
  const pages=[];
  for(let start=0;start<Math.max(1,runs.length);start+=100)pages.push({total_count:runs.length,workflow_runs:runs.slice(start,start+100)});
  return pages;
}
export function createRetainedPriceLiveApi(api,{requiredIds,run=execFileSync,monotonic=()=>performance.now(),report=value=>console.error(JSON.stringify(value))}={}){
  const anchors=Object.freeze(validateRequiredIds(requiredIds));
  // Each liveFor creates this allowance once; unrelated API/asset time is not
  // charged, and the second post-assets round must perform a fresh snapshot.
  let usedMs=0,pending=null;
  return (endpoint,paginate=false)=>{
    const prior=pending;pending=null;
    const workflow=paginate===true?ENDPOINTS.get(endpoint):null;
    if(!workflow)return api(endpoint,paginate);
    if(workflow.id===STATIC&&prior){
      const result=JSON.parse(prior.serialized);
      report({schema_version:'retained-price-live-inventory-read-v2',status:'projected',endpoint,
        snapshot_id:prior.snapshotId,reused_immediate_snapshot:true,total_count:result[0].total_count,
        inventory_budget_used_ms:usedMs,inventory_sha256:hash(prior.serialized)});
      return result;
    }
    const callId=randomUUID();
    for(let attempt=1;attempt<=LIVE_INVENTORY_LIMITS.attempts;attempt++){
      const start=monotonic(),remaining=Math.floor(Math.min(LIVE_INVENTORY_LIMITS.totalMs-usedMs,LIVE_INVENTORY_LIMITS.attemptMs));
      let raw='',failedStdout='',failedStderr='',evidence=[],exit=null,signal=null;
      try{
        requireValue(remaining>0,'time-budget-exhausted');
        try{
          raw=run(process.execPath,['--max-old-space-size=384',workerPath()],{encoding:'utf8',stdio:['pipe','pipe','pipe'],
            input:JSON.stringify({timeoutMs:remaining,requiredIds:anchors}),maxBuffer:LIVE_INVENTORY_LIMITS.bytes,
            timeout:remaining,killSignal:'SIGKILL'});
        }catch(error){
          failedStdout=error.stdout??'';failedStderr=error.stderr??'';
          exit=Number.isInteger(error.status)?error.status:null;
          signal=['SIGKILL','SIGTERM','SIGINT','SIGHUP'].includes(error.signal)?error.signal:null;
          throw commandFailure(error);
        }
        exit=0;requireValue(typeof raw==='string','invalid-command-output');
        requireValue(Buffer.byteLength(raw)<=LIVE_INVENTORY_LIMITS.bytes,'byte-limit');
        let result;
        try{result=JSON.parse(raw);}catch(error){
          if(error instanceof SyntaxError&&/Unexpected end of JSON input|Unterminated string in JSON/i.test(error.message))throw fault('json-eof',true);
          throw fault('invalid-json');
        }
        requireValue(object(result)&&result.schema_version==='retained-price-repository-snapshot-v1'
          &&['complete','failed'].includes(result.status)&&Number.isSafeInteger(result.body_bytes)&&result.body_bytes>=0,'invalid-worker-result');
        evidence=pageFacts(result.evidence);
        // A denial observed by any sibling takes precedence over EOF/count drift.
        if(denied(evidence))throw fault('http-or-security-denial');
        requireValue(result.body_bytes<=LIMITS.bytes,'byte-limit');
        if(result.status==='failed'){
          requireValue(REASONS.has(result.reason),'unclassified-worker-failure');
          throw fault(result.reason,result.retryable===true&&RETRYABLE.has(result.reason));
        }
        requireValue(monotonic()-start<=remaining,'time-budget-exhausted');
        const snapshot=validateSnapshot(result.pages,anchors);
        requireValue(evidence.length===snapshot.pages.length&&new Set(evidence.map(item=>item.page_number)).size===evidence.length
          &&evidence.every(item=>item.page_number>=1&&item.page_number<=evidence.length&&item.status===200
            &&item.body_sha256!==null&&item.body_bytes>0)
          &&evidence.reduce((sum,item)=>sum+item.body_bytes,0)===result.body_bytes,'invalid-worker-evidence');
        const projected=new Map([...WORKFLOWS.keys()].map(id=>[id,JSON.stringify(pagesFor(project(snapshot.runs,id)))]));
        requireValue(monotonic()-start<=remaining,'time-budget-exhausted');
        const elapsed=Math.max(0,Math.ceil(monotonic()-start));usedMs+=elapsed;
        const snapshotId=callId+'/'+attempt,serialized=projected.get(workflow.id);
        report({schema_version:'retained-price-live-inventory-read-v2',call_id:callId,snapshot_id:snapshotId,endpoint,attempt,status:'complete',
          reused_immediate_snapshot:false,fresh_from_page:1,elapsed_ms:elapsed,inventory_budget_used_ms:usedMs,
          repository_pages:snapshot.pages.length,repository_total_count:snapshot.total,repository_body_bytes:result.body_bytes,
          repository_inventory_sha256:hash(JSON.stringify(snapshot.pages)),stdout:facts(raw),page_evidence:evidence,
          total_count:JSON.parse(serialized)[0].total_count,inventory_sha256:hash(serialized)});
        if(workflow.id===PUBLISHER){
          const slot={snapshotId,serialized:projected.get(STATIC)};pending=slot;
          queueMicrotask(()=>{if(pending===slot)pending=null;});
        }
        return JSON.parse(serialized);
      }catch(error){
        pending=null;
        let failure=error.inventoryReason?error:fault('unclassified-inventory-failure');
        if(denied(evidence))failure=fault('http-or-security-denial');
        const elapsed=Math.max(0,Math.ceil(monotonic()-start));usedMs+=elapsed;
        const retry=failure.retryable===true&&attempt<LIVE_INVENTORY_LIMITS.attempts&&usedMs<LIVE_INVENTORY_LIMITS.totalMs;
        report({schema_version:'retained-price-live-inventory-read-v2',call_id:callId,endpoint,attempt,status:'failed',reason:failure.inventoryReason,
          fresh_from_page:1,elapsed_ms:elapsed,inventory_budget_used_ms:usedMs,exit_code:exit,signal,page_evidence:evidence,
          stdout:facts(raw),failed_stdout:facts(failedStdout),failed_stderr:facts(failedStderr),retry});
        if(!retry)throw fault(failure.inventoryReason);
      }
    }
    throw fault('attempt-limit');
  };
}
