// One bounded, unfiltered repository snapshot; no subprocesses or retries here.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPOSITORY='kusennjp1-ai/screener',REPOSITORY_ID=1203919607;
export const WORKFLOWS=new Map([[364666954,'research-ui-release.yml'],[294257497,'static-site.yml']]);
export const LIMITS=Object.freeze({runs:2000,projectedRuns:1000,perPage:50,bytes:64*1024**2,pageBytes:8*1024**2,attemptMs:30000});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const utc=v=>typeof v==='string'&&v.endsWith('Z')&&Number.isFinite(Date.parse(v));
const hash=v=>createHash('sha256').update(v).digest('hex');
const faults=new WeakSet();
export const fault=(reason,retryable=false)=>{
  const error=Object.assign(Error('Fresh live repository inventory rejected: '+reason),{inventoryReason:reason,retryable});
  faults.add(error);return error;
};
const check=(v,reason)=>{if(!v)throw fault(reason);};
export const route=page=>'repositories/'+REPOSITORY_ID+'/actions/runs?per_page=50&page='+page;
export function validateRequiredIds(ids){
  check(Array.isArray(ids)&&ids.length===2&&ids.every(positive)&&new Set(ids).size===2,'invalid-required-run-anchors');
  return [...ids];
}
export function validatePage(value,link,page){
  check(object(value)&&Number.isSafeInteger(value.total_count)&&value.total_count>=0&&value.total_count<=LIMITS.runs
    &&Array.isArray(value.workflow_runs),'invalid-inventory-schema-or-bound');
  check(positive(page)&&page<=Math.ceil(LIMITS.runs/LIMITS.perPage),'invalid-page-number');
  const total=value.total_count,last=Math.max(1,Math.ceil(total/LIMITS.perPage));
  // An independently valid empty page after a shrinking total is drift, never
  // accepted as completeness. The whole snapshot is discarded by the collector.
  check(value.workflow_runs.length===Math.min(LIMITS.perPage,Math.max(0,total-(page-1)*LIMITS.perPage)),'incomplete-inventory');
  const ids=new Set();
  for(const run of value.workflow_runs){
    check(object(run)&&positive(run.id)&&!ids.has(run.id),'invalid-or-duplicate-run');ids.add(run.id);
    check(run.repository?.id===REPOSITORY_ID&&run.repository?.full_name===REPOSITORY,'foreign-repository-run');
    check(object(run.head_repository)&&positive(run.head_repository.id)&&typeof run.head_repository.full_name==='string'
      &&run.head_repository.full_name.length>0&&run.head_repository.full_name.length<=256,'invalid-head-repository');
    check((run.head_repository.id===REPOSITORY_ID)===(run.head_repository.full_name===REPOSITORY),'conflicting-head-repository');
    check(positive(run.workflow_id)&&typeof run.path==='string'&&run.path.length>0&&run.path.length<=512
      &&(run.head_branch===null||typeof run.head_branch==='string'&&run.head_branch.length>0&&run.head_branch.length<=256)
      &&positive(run.run_attempt)&&/^[a-f0-9]{40}$/.test(run.head_sha??'')
      &&utc(run.created_at)&&utc(run.updated_at)&&(run.run_started_at===null||utc(run.run_started_at)),'invalid-run-identity-or-schema');
    for(const[id,file]of WORKFLOWS)check((run.workflow_id===id)===(run.path==='.github/workflows/'+file),'conflicting-workflow-identity');
  }
  check(typeof link==='string'&&link.length<=8192,'invalid-pagination-link');
  const relations=new Map();
  for(const part of link?link.split(','):[]){
    const match=/^\s*<([^>]+)>;\s*rel="(next|prev|first|last)"\s*$/.exec(part);
    check(match&&!relations.has(match[2]),'invalid-pagination-link');
    let url;try{url=new URL(match[1]);}catch{throw fault('invalid-pagination-link');}
    check(url.origin==='https://api.github.com'&&!url.username&&!url.password&&!url.hash
      &&['/repos/'+REPOSITORY+'/actions/runs','/repositories/'+REPOSITORY_ID+'/actions/runs'].includes(url.pathname),'pagination-origin-or-route');
    const query=[...url.searchParams],number=url.searchParams.get('page');
    check(query.length===2&&new Set(query.map(([key])=>key)).size===2&&url.searchParams.get('per_page')==='50'
      &&/^[1-9]\d*$/.test(number??'')&&Number(number)<=last,'pagination-query');
    relations.set(match[2],Number(number));
  }
  check(page<last?relations.get('next')===page+1:!relations.has('next'),'incomplete-pagination');
  for(const[key,number]of [['prev',page-1],['first',1],['last',last]])
    check(!relations.has(key)||relations.get(key)===number,'inconsistent-pagination');
  return total;
}
export function project(runs,id){
  const file=WORKFLOWS.get(id);check(file,'unknown-workflow-projection');
  const result=runs.filter(run=>run.workflow_id===id&&run.path==='.github/workflows/'+file&&run.head_branch==='main'
    &&run.repository.id===REPOSITORY_ID&&run.repository.full_name===REPOSITORY
    &&run.head_repository.id===REPOSITORY_ID&&run.head_repository.full_name===REPOSITORY);
  check(result.length<=LIMITS.projectedRuns,'projected-workflow-bound');return result;
}
function complete(pages,total,requiredIds){
  check(pages.length===Math.max(1,Math.ceil(total/LIMITS.perPage))&&pages.every(Boolean),'incomplete-inventory');
  const runs=pages.flatMap(page=>page.value.workflow_runs),ids=new Set(runs.map(run=>run.id));
  check(runs.length===total&&ids.size===total,'invalid-or-duplicate-run');
  check(validateRequiredIds(requiredIds).every(id=>ids.has(id)),'required-run-anchor-absent');
  for(const id of WORKFLOWS.keys())project(runs,id);
  return {total,pages,runs};
}
export function validateSnapshot(pages,requiredIds){
  check(Array.isArray(pages)&&pages.length>0&&pages.length<=40,'incomplete-inventory');
  let total=null;
  for(let n=0;n<pages.length;n++){
    const page=pages[n];check(object(page),'invalid-inventory-schema-or-bound');
    const observed=validatePage(page.value,page.link,n+1);
    check(total===null||observed===total,'changing-inventory-total');total=observed;
  }
  return complete(pages,total,requiredIds);
}
const precedence=e=>e.inventoryReason==='http-or-security-denial'?3:e.retryable===true?1:e.inventoryReason==='sibling-aborted'?0:2;
export async function collectSnapshot({read,signal,abort,requiredIds}){
  validateRequiredIds(requiredIds);
  const pages=[],seen=new Set(),failures=[];
  const fail=error=>{
    const e=faults.has(error)?error:fault('unclassified-inventory-failure');
    failures.push(e);abort(e);
  };
  const accept=(page,n,total)=>{
    check(object(page),'invalid-inventory-schema-or-bound');
    const observed=validatePage(page.value,page.link,n);
    for(const run of page.value.workflow_runs){check(!seen.has(run.id),'invalid-or-duplicate-run');seen.add(run.id);}
    if(total!==null&&observed!==total)throw fault('changing-inventory-total',true);
    pages[n-1]=page;return observed;
  };
  let total;
  try{total=accept(await read(1),1,null);}catch(e){fail(e);}
  if(!failures.length){
    const count=Math.max(1,Math.ceil(total/LIMITS.perPage));let next=2;
    const worker=async()=>{while(next<=count&&!signal.aborted){const n=next++;try{accept(await read(n),n,total);}catch(e){fail(e);return;}}};
    await Promise.allSettled(Array.from({length:Math.min(3,count-1)},worker));
  }
  if(failures.length)throw failures.sort((a,b)=>precedence(b)-precedence(a))[0];
  check(!signal.aborted,'incomplete-or-aborted-inventory');
  return complete(pages,total,requiredIds);
}
const denial=/HTTP(?:\/\S+)?\s+[45]\d\d\b|\b(?:401|403|429)\b|rate.?limit|retry-after|unauthori[sz]ed|forbidden|denied|bad credentials|authentication|authorization|resource not accessible|security|certificate|\bx509\b|\bTLS\b|\bSSL\b|\bSSO\b|abuse detection/i;
export function classifyTransport(error,{aborted=false,timedOut=false}={}){
  const text=[error?.message,error?.cause?.message,error?.code,error?.cause?.code].filter(Boolean).join('\n');
  if(denial.test(text))return fault('http-or-security-denial');
  if(faults.has(error))return error;
  if(timedOut)return fault('transport-timeout',true);
  if(aborted)return fault('sibling-aborted');
  if(/ECONNRESET|connection reset by peer|unexpected EOF|\bEOF\s*$|UND_ERR_SOCKET/i.test(text))return fault('transport-or-json-eof',true);
  if(/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT/i.test(text))return fault('transport-timeout',true);
  return fault('unclassified-transport-failure');
}
function safeHeaders(headers){
  const result={};
  for(const[key,value]of headers){
    if(/^(?:x-ratelimit-(?:limit|remaining|reset|used)|retry-after|content-length)$/.test(key)&&/^\d{1,15}$/.test(value))result[key]=value;
    if(key==='x-github-request-id'&&/^[a-zA-Z0-9:-]{1,128}$/.test(value))result[key]=value;
  }
  if(headers.has('retry-after'))result.retry_after_present=true;
  return result;
}
export async function readRepositorySnapshot({timeoutMs,requiredIds,fetcher=fetch,token=process.env.GH_TOKEN??process.env.GITHUB_TOKEN}){
  const controller=new AbortController(),evidence=[];let timer,bytes=0,timedOut=false;
  try{
    const anchors=validateRequiredIds(requiredIds);
    check(positive(timeoutMs)&&timeoutMs<=LIMITS.attemptMs,'invalid-inventory-time-budget');
    check(typeof token==='string'&&token.length>0,'missing-actions-token');
    timer=setTimeout(()=>{timedOut=true;controller.abort(fault('transport-timeout',true));},timeoutMs);
    const read=async page=>{
      if(controller.signal.aborted)throw fault(timedOut?'transport-timeout':'sibling-aborted',timedOut);
      const item={page_number:page,requested_route:route(page),status:null,observed_total:null,row_count:null,ids_sha256:null,body_bytes:0,body_sha256:null};
      evidence.push(item);
      try{
        const response=await fetcher('https://api.github.com/'+route(page),{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,
          'User-Agent':'retained-price-live-inventory'},redirect:'error',cache:'no-store',signal:controller.signal});
        item.status=response.status;item.safe_headers=safeHeaders(response.headers);
        check(response.url===''||response.url==='https://api.github.com/'+route(page),'response-origin-or-route');
        check(response.status===200&&!response.redirected&&!response.headers.has('retry-after')&&response.headers.get('x-ratelimit-remaining')!=='0','http-or-security-denial');
        const chunks=[],bodyHash=createHash('sha256');let count=0;
        try{
          check(response.body&&typeof response.body[Symbol.asyncIterator]==='function','invalid-response-body');
          for await(const chunk of response.body){
            check(chunk instanceof Uint8Array,'invalid-response-body');
            count+=chunk.byteLength;bytes+=chunk.byteLength;bodyHash.update(chunk);
            check(count<=LIMITS.pageBytes&&bytes<=LIMITS.bytes,'byte-limit');chunks.push(chunk);
          }
        }finally{item.body_bytes=count;item.body_sha256=bodyHash.digest('hex');}
        let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw fault('invalid-json-encoding');}
        let value;
        try{value=JSON.parse(text);}catch(error){
          if(error instanceof SyntaxError&&/Unexpected end of JSON input|Unterminated string in JSON/i.test(error.message))throw fault('json-eof',true);
          throw fault('invalid-json');
        }
        if(object(value)){
          if(Number.isSafeInteger(value.total_count)&&value.total_count>=0)item.observed_total=value.total_count;
          if(Array.isArray(value.workflow_runs)){item.row_count=value.workflow_runs.length;
            if(value.workflow_runs.length<=LIMITS.perPage)item.ids_sha256=hash(JSON.stringify(value.workflow_runs.map(run=>object(run)&&positive(run.id)?run.id:null)));}
        }
        return {value,link:response.headers.get('link')??''};
      }catch(error){
        const e=classifyTransport(error,{aborted:controller.signal.aborted,timedOut});item.reason=e.inventoryReason;throw e;
      }
    };
    const snapshot=await collectSnapshot({read,signal:controller.signal,abort:error=>controller.abort(error),requiredIds:anchors});
    const result={schema_version:'retained-price-repository-snapshot-v1',status:'complete',pages:snapshot.pages,evidence,body_bytes:bytes};
    check(Buffer.byteLength(JSON.stringify(result))<=LIMITS.bytes,'byte-limit');
    return result;
  }catch(error){
    const failure=classifyTransport(error,{aborted:controller.signal.aborted,timedOut});
    controller.abort(failure);
    return {schema_version:'retained-price-repository-snapshot-v1',status:'failed',reason:failure.inventoryReason,
      retryable:failure.retryable===true,evidence,body_bytes:bytes};
  }finally{clearTimeout(timer);}
}
if(import.meta.url?.startsWith('file:')&&process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let result;
  try{
    const input=readFileSync(0,'utf8');check(Buffer.byteLength(input)<=1024,'invalid-worker-input');
    const config=JSON.parse(input);check(object(config)&&Object.keys(config).sort().join(',')==='requiredIds,timeoutMs','invalid-worker-input');
    result=await readRepositorySnapshot(config);
  }catch{result={schema_version:'retained-price-repository-snapshot-v1',status:'failed',reason:'invalid-worker-input',retryable:false,evidence:[],body_bytes:0};}
  process.stdout.write(JSON.stringify(result));
}
