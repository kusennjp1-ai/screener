// Fresh, bounded workflow inventories for the finite source driver's live check.
// No admission, immutable object, artifact, job or generic publication read retries.
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const REPOSITORY='kusennjp1-ai/screener',REPOSITORY_ID=1203919607;
const WORKFLOWS=new Map([['research-ui-release.yml',364666954],['static-site.yml',294257497]]);
const ENDPOINTS=new Map([...WORKFLOWS].map(([file,id])=>[
  `repos/${REPOSITORY}/actions/workflows/${file}/runs?branch=main&per_page=100`,{file,id}]));
export const LIVE_INVENTORY_LIMITS=Object.freeze({attempts:2,attemptMs:30000,totalMs:60000,bytes:64*1024**2,runs:1000});
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const facts=raw=>({bytes:Buffer.byteLength(raw),sha256:hash(raw)});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const utc=v=>typeof v==='string'&&v.endsWith('Z')&&Number.isFinite(Date.parse(v));
const fault=(reason,retryable=false)=>Object.assign(Error(`Fresh live workflow inventory rejected: ${reason}`),{inventoryReason:reason,retryable});
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

function observePage(raw,requestedRoute,pageNumber,expectedTotal){
  const evidence={page_number:pageNumber,requested_route:requestedRoute,expected_total:expectedTotal,
    observed_total:null,row_count:null,ids_sha256:null,body_bytes:null,body_sha256:null};
  if(typeof raw!=='string')return {evidence};
  const split=raw.search(/\r?\n\r?\n/);
  if(split<0)return {evidence};
  const body=raw.slice(split).replace(/^\r?\n\r?\n/,'');
  evidence.body_bytes=Buffer.byteLength(body);evidence.body_sha256=hash(body);
  const http=safeHttpFacts(raw);
  if(http?.status!==200||http.ambiguous_headers)return {evidence};
  let page,error;
  try{page=JSON.parse(body);}catch(cause){error=cause;}
  // Diagnostics copy bounded numeric facts and hashes, never arbitrary payload.
  if(object(page)){
    if(Number.isSafeInteger(page.total_count)&&page.total_count>=0)evidence.observed_total=page.total_count;
    if(Array.isArray(page.workflow_runs)){
      evidence.row_count=page.workflow_runs.length;
      if(page.workflow_runs.length<=100)evidence.ids_sha256=hash(JSON.stringify(page.workflow_runs.map(run=>object(run)&&positive(run.id)?run.id:null)));
    }
  }
  return {evidence,page,error};
}

function response(raw,observed){
  const split=raw.search(/\r?\n\r?\n/);
  requireValue(split>=0,'incomplete-http-headers');
  const header=raw.slice(0,split),status=/^HTTP\/\S+\s+(\d{3})(?:\s|$)/.exec(header);
  requireValue(status&&Number(status[1])===200,'http-or-security-denial');
  const links=header.split(/\r?\n/).slice(1).filter(line=>/^link:/i.test(line));
  requireValue(links.length<=1,'ambiguous-pagination-header');
  if(observed.error){
    if(observed.error instanceof SyntaxError&&/Unexpected end of JSON input|Unterminated string in JSON/i.test(observed.error.message))throw fault('json-eof',true);
    throw fault('invalid-json');
  }
  return {page:observed.page,link:links[0]?.replace(/^link:\s*/i,'')??''};
}

function nextPage(link,endpoint,pageNumber,pageCount){
  const expected=new URL('https://api.github.com/'+endpoint),relations=new Map();
  const workflow=ENDPOINTS.get(endpoint),paths=new Set();
  // GitHub may canonicalize its Link URLs to repository/workflow numeric IDs.
  // Both aliases remain bound to the same fixed repository and workflow.
  for(const repoPath of [`repos/${REPOSITORY}`,`repositories/${REPOSITORY_ID}`]){
    for(const id of [workflow.file,workflow.id])paths.add(`/${repoPath}/actions/workflows/${id}/runs`);
  }
  for(const item of link?link.split(','):[]){
    const match=/^\s*<([^>]+)>;\s*rel="(next|prev|first|last)"\s*$/.exec(item);
    requireValue(match&&!relations.has(match[2]),'invalid-pagination-link');
    let url;try{url=new URL(match[1]);}catch{throw fault('invalid-pagination-link');}
    requireValue(url.origin===expected.origin&&!url.username&&!url.password&&!url.hash&&paths.has(url.pathname),'pagination-origin-or-route');
    const values=[...url.searchParams],number=url.searchParams.get('page');
    requireValue(values.length===3&&new Set(values.map(([key])=>key)).size===3
      &&url.searchParams.get('branch')==='main'&&url.searchParams.get('per_page')==='100'
      &&/^[1-9]\d*$/.test(number??'')&&Number(number)<=pageCount,'pagination-query');
    relations.set(match[2],{url,number:Number(number)});
  }
  const next=relations.get('next');
  requireValue(pageNumber<pageCount?next?.number===pageNumber+1:!next,'incomplete-pagination');
  for(const [rel,expected]of [['first',1],['last',pageCount],['prev',pageNumber-1]]){
    requireValue(!relations.has(rel)||relations.get(rel).number===expected,'inconsistent-pagination');
  }
  return next?next.url.pathname.slice(1)+next.url.search:null;
}

function validatePage(page,workflow,pageNumber,seen){
  requireValue(object(page)&&Number.isSafeInteger(page.total_count)&&page.total_count>=0&&Array.isArray(page.workflow_runs),'invalid-inventory-schema');
  // A branch-filtered GitHub search exposes at most 1,000 results. Never call
  // a capped window complete, split the query, or silently drop older runs.
  requireValue(page.total_count<=LIVE_INVENTORY_LIMITS.runs,'github-search-cap');
  const total=page.total_count;
  requireValue(page.workflow_runs.length===Math.min(100,Math.max(0,total-(pageNumber-1)*100)),'incomplete-inventory');
  for(const run of page.workflow_runs){
    requireValue(object(run)&&positive(run.id)&&!seen.has(run.id),'invalid-or-duplicate-run');
    requireValue(run.workflow_id===workflow.id&&run.path===`.github/workflows/${workflow.file}`&&run.head_branch==='main'
      &&['repository','head_repository'].every(key=>run[key]?.id===REPOSITORY_ID&&run[key]?.full_name===REPOSITORY)
      &&positive(run.run_attempt)&&/^[a-f0-9]{40}$/.test(run.head_sha??'')&&utc(run.updated_at)
      &&(run.run_started_at===null||utc(run.run_started_at)),'invalid-run-identity-or-schema');
    seen.add(run.id);
  }
  return total;
}

export function createRetainedPriceLiveApi(api,{run=execFileSync,monotonic=()=>performance.now(),report=value=>console.error(JSON.stringify(value))}={}){
  // livePublication checks its inventory again after unrelated approval reads.
  // Share the cumulative inventory-read allowance, excluding those other reads.
  let usedMs=0;
  return (endpoint,paginate=false)=>{
    const workflow=paginate===true?ENDPOINTS.get(endpoint):null;
    if(!workflow)return api(endpoint,paginate);
    const callId=randomUUID();
    for(let attempt=1;attempt<=LIVE_INVENTORY_LIMITS.attempts;attempt++){
      const start=monotonic(),attemptDeadline=start+Math.min(LIVE_INVENTORY_LIMITS.totalMs-usedMs,LIVE_INVENTORY_LIMITS.attemptMs);
      const pages=[],pageEvidence=[],seen=new Set(),stdoutHash=createHash('sha256');
      let current=endpoint,total=null,stdoutBytes=0,pageNumber=0,failedStdout='',failedStderr='',exit=null,signal=null,http=null;
      try{
        while(current){
          const remaining=Math.floor(attemptDeadline-monotonic());
          requireValue(remaining>0,'time-budget-exhausted');
          requireValue(stdoutBytes<LIVE_INVENTORY_LIMITS.bytes,'byte-limit');
          let raw;
          try{raw=run('gh',['api','--include',current],{encoding:'utf8',stdio:['ignore','pipe','pipe'],
            maxBuffer:LIVE_INVENTORY_LIMITS.bytes-stdoutBytes,timeout:remaining,killSignal:'SIGKILL'});}
          catch(error){
            failedStdout=error.stdout??'';failedStderr=error.stderr??'';
            pageEvidence.push(observePage(failedStdout,current,pageNumber+1,total).evidence);
            http=safeHttpFacts(failedStdout);
            exit=Number.isInteger(error.status)?error.status:null;
            signal=['SIGKILL','SIGTERM','SIGINT','SIGHUP'].includes(error.signal)?error.signal:null;
            throw commandFailure(error);
          }
          const observed=observePage(raw,current,pageNumber+1,total);pageEvidence.push(observed.evidence);
          requireValue(typeof raw==='string','invalid-command-output');
          exit=0;http=safeHttpFacts(raw);
          stdoutBytes+=Buffer.byteLength(raw);stdoutHash.update(raw);
          requireValue(stdoutBytes<=LIVE_INVENTORY_LIMITS.bytes,'byte-limit');
          requireValue(monotonic()<=attemptDeadline,'time-budget-exhausted');
          requireValue(!http?.ambiguous_headers,'ambiguous-http-headers');
          const parsed=response(raw,observed);pageNumber++;
          const declaredTotal=validatePage(parsed.page,workflow,pageNumber,seen);
          const next=nextPage(parsed.link,endpoint,pageNumber,Math.max(1,Math.ceil(declaredTotal/100)));
          // Only isolated count drift is retryable after every page fact passes.
          // Discard this entire enumeration; a retry starts from page one.
          if(total!==null&&declaredTotal!==total)throw fault('changing-inventory-total',true);
          total=declaredTotal;current=next;pages.push(parsed.page);
        }
        requireValue(seen.size===total,'incomplete-inventory');
        requireValue(monotonic()<=attemptDeadline,'time-budget-exhausted');
        const elapsed=Math.max(0,Math.ceil(monotonic()-start));usedMs+=elapsed;
        report({schema_version:'retained-price-live-inventory-read-v1',call_id:callId,endpoint,attempt,status:'complete',fresh_from_page:1,
          elapsed_ms:elapsed,inventory_budget_used_ms:usedMs,pages:pages.length,total_count:total,http,page_evidence:pageEvidence,
          stdout:{bytes:stdoutBytes,sha256:stdoutHash.digest('hex')},inventory_sha256:hash(JSON.stringify(pages))});
        return pages;
      }catch(error){
        let failure=error.inventoryReason?error:fault('unclassified-inventory-failure');
        if(failure.retryable&&(http?.status>=400||http?.rate_limit_remaining===0||http?.retry_after_present))failure=fault('http-or-security-denial');
        const elapsed=Math.max(0,Math.ceil(monotonic()-start));usedMs+=elapsed;
        const retry=failure.retryable===true&&attempt<LIVE_INVENTORY_LIMITS.attempts&&usedMs<LIVE_INVENTORY_LIMITS.totalMs;
        report({schema_version:'retained-price-live-inventory-read-v1',call_id:callId,endpoint,attempt,status:'failed',reason:failure.inventoryReason,
          fresh_from_page:1,elapsed_ms:elapsed,inventory_budget_used_ms:usedMs,pages_received:pageNumber,exit_code:exit,signal,http,page_evidence:pageEvidence,
          completed_stdout:{bytes:stdoutBytes,sha256:stdoutHash.digest('hex')},failed_stdout:facts(failedStdout),failed_stderr:facts(failedStderr),retry});
        if(!retry)throw fault(failure.inventoryReason);
      }
    }
    throw fault('attempt-limit');
  };
}
