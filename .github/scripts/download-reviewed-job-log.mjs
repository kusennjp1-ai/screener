// File-only transport for three reviewed abort logs. Never render response bytes.
// GitHub documents the initial 302 and one-minute download URL:
// https://docs.github.com/en/rest/actions/workflow-jobs#download-job-logs-for-a-workflow-run
// Its runner reference lists Azure Blob storage for job logs, and the finite
// Actions Artifact Storage list below is documented here (checked 2026-10-17):
// https://docs.github.com/en/actions/reference/runners/github-hosted-runners#communication-requirements-for-github-hosted-runners
// https://docs.github.com/en/copilot/reference/copilot-allowlist-reference#github-actions-artifact-storage
// These are application restrictions, not firewall changes. Unknown hosts fail
// closed; no actual redirect for these jobs has been probed by the offline tests.
import {request as httpsRequest} from 'node:https';
import {spawnSync} from 'node:child_process';
import {constants,closeSync,fstatSync,lstatSync,mkdtempSync,openSync,readSync,realpathSync,rmSync,writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

export const maximumLogBytes=1024**2;
export const operationTimeoutMs=30000;
const repository='kusennjp1-ai/screener';
const reviewedJobs=new Set([117274547210,117279659374,117292325413]);
const storageHosts=new Set(Array.from({length:20},(_,i)=>`productionresultssa${i}.blob.core.windows.net`));
const scriptPath=fileURLToPath(import.meta.url);
// The diagnostic wire format is exactly six bytes: version, stage, cause,
// host category, and big-endian HTTP status (zero means unavailable). Values
// never come from an error message, URL/hostname, header, body, or environment.
const diagnosticBytes=6;
const stages=['unknown','input','environment','file','api-request','api-response','redirect',
  'storage-request','storage-response','storage-headers','body','worker','result','cleanup'];
const causes=['rejected','invalid-input','environment-rejected','routing-or-trust-override','tls-override',
  'unsafe-file','request-error','dns-error','tls-error','http-status','invalid-status','invalid-headers',
  'unapproved-location','invalid-body','write-failed','incomplete-body','timeout','worker-failed',
  'worker-start-failed','invalid-diagnostic','cleanup-failed'];
const hosts=['none','github-api','reviewed-storage','rejected-redirect'];
const recordedFailures=new WeakMap();
const statusValue=status=>Number.isInteger(status)&&status>=100&&status<=599?status:0;
const diagnostic=(stage,cause,host='none',status=0)=>({stage,cause,host,status});
const validDiagnostic=value=>value!==null&&typeof value==='object'
  &&Object.keys(value).sort().join(',')==='cause,host,stage,status'
  &&stages.includes(value.stage)&&causes.includes(value.cause)&&hosts.includes(value.host)
  &&Number.isInteger(value.status)&&(value.status===0||statusValue(value.status)===value.status);
function failure(value){
  const valid=validDiagnostic(value);
  const error=Error('Reviewed job log download failed'+(valid
    ?` (stage=${value.stage}; cause=${value.cause}; host=${value.host}; status=${value.status})`:''));
  if(valid)recordedFailures.set(error,Object.freeze({...value}));
  return error;
}
const failureRecord=(error,fallback)=>recordedFailures.get(error)??fallback;
// Callers may retrieve only diagnostics created and validated by this module.
// Arbitrary error properties/messages cannot impersonate a trusted diagnosis.
export function reviewedJobLogDiagnostic(error){
  const value=recordedFailures.get(error);
  return validDiagnostic(value)?Object.freeze({...value}):null;
}
function networkCause(error){
  // Read only a code, then map it to fixed vocabulary; never stringify it.
  try{
    if(['ENOTFOUND','EAI_AGAIN'].includes(error?.code))return 'dns-error';
    if(['CERT_HAS_EXPIRED','CERT_NOT_YET_VALID','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID',
      'ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED'].includes(error?.code))return 'tls-error';
  }catch{}
  return 'request-error';
}
function writeDiagnostic(fd,value){
  if(!validDiagnostic(value)||checkedFile(fd,diagnosticBytes).size!==0)throw failure();
  const bytes=Buffer.from([1,stages.indexOf(value.stage),causes.indexOf(value.cause),hosts.indexOf(value.host),0,0]);
  bytes.writeUInt16BE(value.status,4);
  if(writeSync(fd,bytes,0,bytes.length,0)!==bytes.length)throw failure();
}
function readDiagnostic(fd){
  if(checkedFile(fd,diagnosticBytes).size!==diagnosticBytes)throw failure();
  const bytes=Buffer.alloc(diagnosticBytes);
  if(readSync(fd,bytes,0,bytes.length,0)!==bytes.length||checkedFile(fd,diagnosticBytes).size!==diagnosticBytes
    ||bytes[0]!==1)throw failure();
  const value={stage:stages[bytes[1]],cause:causes[bytes[2]],host:hosts[bytes[3]],status:bytes.readUInt16BE(4)};
  if(!validDiagnostic(value))throw failure();
  return value;
}

function checkJob(jobId){if(!Number.isSafeInteger(jobId)||!reviewedJobs.has(jobId))throw failure();}
function workflowEnvironment(env){
  // Never silently evade inherited routing/trust controls by dropping them.
  // This narrowly scoped client supports only the normal hosted-runner setup.
  const overrides=['NODE_OPTIONS','NODE_DEBUG','NODE_DEBUG_NATIVE','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR','OPENSSL_CONF',
    'NODE_USE_ENV_PROXY','GLOBAL_AGENT_HTTP_PROXY','GLOBAL_AGENT_HTTPS_PROXY'];
  if(Object.entries(env).some(([key,value])=>value!==undefined&&value!==''
    &&(/^(?:https?|all|no)_proxy$/i.test(key)||overrides.includes(key))))throw failure(diagnostic('environment','routing-or-trust-override'));
  if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw failure(diagnostic('environment','tls-override'));
  // Credentials are opaque: constrain only nonempty length and header-safe
  // visible ASCII, without assumptions about prefixes, separators or claims.
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!==repository
    ||env.GITHUB_SERVER_URL!=='https://github.com'||env.GITHUB_API_URL!=='https://api.github.com'
    ||typeof env.GH_TOKEN!=='string'||env.GH_TOKEN.length===0||env.GH_TOKEN.length>4096
    ||(/[^\x21-\x7e]/).test(env.GH_TOKEN))throw failure(diagnostic('environment','environment-rejected'));
  // Do not inherit debug, preload, proxy, TLS override, or unrelated secret env.
  return Object.fromEntries(['GH_TOKEN','GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_SERVER_URL','GITHUB_API_URL'].map(k=>[k,env[k]]));
}
function checkedFile(fd,maximumBytes=maximumLogBytes){
  if(!Number.isInteger(fd)||fd<3)throw failure();
  const st=fstatSync(fd);
  if(typeof process.getuid!=='function'||st.uid!==process.getuid()||!st.isFile()
    ||st.nlink!==1||(st.mode&0o777)!==0o600||st.size>maximumBytes)throw failure();
  return st;
}
function singleHeader(response,name){
  if(!Array.isArray(response.rawHeaders)||response.rawHeaders.length%2)throw failure();
  const values=[];
  for(let i=0;i<response.rawHeaders.length;i+=2){
    if(typeof response.rawHeaders[i]!=='string')throw failure();
    if(response.rawHeaders[i].toLowerCase()===name)values.push(response.rawHeaders[i+1]);
  }
  if(values.length>1||values.some(value=>typeof value!=='string'))throw failure();
  return values[0];
}
export function checkedStorageLocation(location){
  // Reject whitespace/control characters and URL-parser normalizations rather
  // than accepting disguised authorities, encoded hostnames or empty userinfo.
  if(typeof location!=='string'||location.length>16384||!(/^[\x21-\x7e]+$/).test(location)
    ||location.includes('\\')||location.includes('#'))throw failure();
  const match=/^https:\/\/([^/?#]+)(?:\/|\?|$)/.exec(location);
  if(!match||!storageHosts.has(match[1]))throw failure();
  const url=new URL(location);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash
    ||url.hostname!==match[1])throw failure();
  return url;
}

// Only the synchronous wrapper below is used in production. Dependency
// injection here permits offline HTTP-stream tests with no socket or server.
export async function downloadReviewedJobLog(jobId,fd,{env=process.env,request=httpsRequest,timeoutMs=operationTimeoutMs}={}){
  let timer;
  let current=diagnostic('input','invalid-input');
  const requests=[],responses=[];
  let stopped=false;
  const cancel=()=>{
    stopped=true;
    for(const stream of [...responses,...requests]){try{stream.destroy();}catch{}}
  };
  try{
    checkJob(jobId);
    current=diagnostic('environment','environment-rejected');
    const workflow=workflowEnvironment(env);
    current=diagnostic('file','unsafe-file');
    if(checkedFile(fd).size!==0)throw failure();
    if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>operationTimeoutMs)throw failure(diagnostic('input','invalid-input'));
    const deadline=performance.now()+timeoutMs;
    const active=()=>{if(stopped||performance.now()>=deadline)throw failure({...current,cause:'timeout'});};
    const receive=(url,headers)=>new Promise((accept,reject)=>{
      active();
      const requestContext={...current};
      const req=request(url,{method:'GET',headers,agent:false,rejectUnauthorized:true,maxHeaderSize:16384},response=>{
        responses.push(response);
        // Install immediately, including on discarded redirect/error bodies.
        response.on('error',()=>reject(failure({...requestContext,cause:'request-error'})));
        if(stopped){response.destroy();reject(failure());return;}
        accept(response);
      });
      requests.push(req);
      req.on('error',error=>reject(failure({...requestContext,cause:networkCause(error)})));
      req.end();
    });
    const transfer=async()=>{
      current=diagnostic('api-request','request-error','github-api');
      const api=await receive(new URL(`https://api.github.com/repos/${repository}/actions/jobs/${jobId}/logs`),{
        Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
        'User-Agent':'screener-reviewed-job-log','Accept-Encoding':'identity',Authorization:`Bearer ${workflow.GH_TOKEN}`,
      });
      active();
      current=diagnostic('api-response',statusValue(api.statusCode)?'http-status':'invalid-status','github-api',statusValue(api.statusCode));
      if(api.statusCode!==302)throw failure();
      current=diagnostic('redirect','invalid-headers','github-api',302);
      const location=singleHeader(api,'location');
      current=diagnostic('redirect','unapproved-location','rejected-redirect',302);
      const storage=checkedStorageLocation(location);
      api.destroy(); // Ignore the redirect body; never forward response headers.
      active();
      current=diagnostic('storage-request','request-error','reviewed-storage');
      const log=await receive(storage,{'User-Agent':'screener-reviewed-job-log','Accept-Encoding':'identity'});
      active();
      current=diagnostic('storage-response',statusValue(log.statusCode)?'http-status':'invalid-status','reviewed-storage',statusValue(log.statusCode));
      if(log.statusCode!==200)throw failure(); // No further redirects or retries.
      current=diagnostic('storage-headers','invalid-headers','reviewed-storage',200);
      const encoding=singleHeader(log,'content-encoding');
      const length=singleHeader(log,'content-length');
      const transferEncoding=singleHeader(log,'transfer-encoding');
      if((encoding!==undefined&&encoding!=='identity')
        ||(transferEncoding!==undefined&&transferEncoding!=='chunked')
        ||(length!==undefined&&transferEncoding!==undefined)
        ||(length!==undefined&&(!(/^[1-9][0-9]*$/).test(length)||Number(length)>maximumLogBytes)))throw failure();
      current=diagnostic('body','invalid-body','reviewed-storage',200);
      let count=0;
      for await(const chunk of log){
        active();
        if(!Buffer.isBuffer(chunk)||count+chunk.length>maximumLogBytes)throw failure();
        let offset=0;
        while(offset<chunk.length){
          active();
          current=diagnostic('body','write-failed','reviewed-storage',200);
          const written=writeSync(fd,chunk,offset,chunk.length-offset,count+offset);
          if(written<1)throw failure();
          offset+=written;
        }
        count+=chunk.length;
        current=diagnostic('body','invalid-body','reviewed-storage',200);
      }
      active();
      current=diagnostic('body','incomplete-body','reviewed-storage',200);
      if(log.complete!==true||log.aborted===true||count===0
        ||(length!==undefined&&count!==Number(length))||checkedFile(fd).size!==count)throw failure();
      return count;
    };
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const value={...current,cause:'timeout'};cancel();reject(failure(value));},timeoutMs);});
    return await Promise.race([transfer(),timeout]);
  }catch(error){throw failure(failureRecord(error,current));}
  finally{clearTimeout(timer);cancel();}
}

// The token exists only in the worker's minimal environment. The raw body goes
// to inherited regular fd3, never stdin/stdout/stderr, argv or an error object.
// A separate exclusive private fd4 carries only the bounded diagnostic record.
// The caller retains its existing exact SHA256 acceptance check on this Buffer.
export function readReviewedJobLog(jobId,{env=process.env,spawn=spawnSync,tempRoot=tmpdir()}={}){
  const deadline=performance.now()+operationTimeoutMs;
  let directory,fd,diagnosticFd,result,problem;
  let current=diagnostic('input','invalid-input');
  try{
    checkJob(jobId);
    current=diagnostic('environment','environment-rejected');
    const childEnv=workflowEnvironment(env);
    current=diagnostic('file','unsafe-file');
    if(typeof tempRoot!=='string'||tempRoot!==resolve(tempRoot)||realpathSync(tempRoot)!==tempRoot
      ||!lstatSync(tempRoot).isDirectory())throw failure();
    directory=mkdtempSync(join(tempRoot,'reviewed-job-log-'));
    const dirStat=lstatSync(directory);
    if(typeof process.getuid!=='function'||dirStat.uid!==process.getuid()||!dirStat.isDirectory()
      ||(dirStat.mode&0o777)!==0o700||!constants.O_NOFOLLOW)throw failure();
    fd=openSync(join(directory,'body'),constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_RDWR,0o600);
    checkedFile(fd);
    diagnosticFd=openSync(join(directory,'diagnostic'),constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_RDWR,0o600);
    checkedFile(diagnosticFd,diagnosticBytes);
    const remaining=Math.floor(deadline-performance.now());
    if(remaining<1)throw failure(diagnostic('worker','timeout'));
    current=diagnostic('worker','worker-start-failed');
    const child=spawn(process.execPath,[scriptPath,'--file-worker',String(jobId),String(remaining)],{
      env:childEnv,stdio:['ignore','ignore','ignore',fd,diagnosticFd],timeout:remaining,killSignal:'SIGKILL',maxBuffer:1024,
    });
    if(child.error||child.status!==0||child.signal||performance.now()>=deadline){
      current=diagnostic('worker',performance.now()>=deadline?'timeout':child.error?'worker-start-failed':'worker-failed');
      // Only the deliberate worker-failure exit can supply a diagnostic. Never
      // read output properties or stringify a spawn error/signal/status.
      if(!child.error&&child.status===1&&!child.signal){
        try{current=readDiagnostic(diagnosticFd);}catch{current=diagnostic('worker','invalid-diagnostic');}
      }
      throw failure(current);
    }
    current=diagnostic('worker','invalid-diagnostic');
    if(checkedFile(diagnosticFd,diagnosticBytes).size!==0)throw failure();
    current=diagnostic('result','unsafe-file');
    const st=checkedFile(fd);
    if(st.size===0)throw failure();
    result=Buffer.alloc(st.size);
    let offset=0;
    while(offset<result.length){
      if(performance.now()>=deadline)throw failure(diagnostic('result','timeout'));
      const count=readSync(fd,result,offset,result.length-offset,offset);
      if(count<1)throw failure();
      offset+=count;
    }
    if(checkedFile(fd).size!==result.length)throw failure();
  }catch(error){problem=failureRecord(error,current);}
  finally{
    // Preserve the first failure if cleanup also fails.
    for(const handle of [fd,diagnosticFd])if(handle!==undefined){try{closeSync(handle);}catch{problem??=diagnostic('cleanup','cleanup-failed');}}
    if(directory!==undefined){try{rmSync(directory,{recursive:true,force:true});}catch{problem??=diagnostic('cleanup','cleanup-failed');}}
  }
  if(problem)throw failure(problem);
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===scriptPath){
  try{
    if(process.argv.length!==5||process.argv[2]!=='--file-worker')throw failure(diagnostic('input','invalid-input'));
    // Fail before any request if the private diagnostic descriptor is missing,
    // nonempty, unsafe, or aliases the body descriptor.
    const output=checkedFile(3),report=checkedFile(4,diagnosticBytes);
    if(report.size!==0||(output.dev===report.dev&&output.ino===report.ino))throw failure(diagnostic('file','unsafe-file'));
    await downloadReviewedJobLog(Number(process.argv[3]),3,{timeoutMs:Number(process.argv[4])});
  }catch(error){
    try{writeDiagnostic(4,failureRecord(error,diagnostic('file','unsafe-file')));}catch{}
    process.exitCode=1;
  } // Deliberately silent, even on malformed input or diagnostic failure.
}
