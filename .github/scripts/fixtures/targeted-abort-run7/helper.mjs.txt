// File-only transport for two reviewed abort logs. Never render response bytes.
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
const reviewedJobs=new Set([117274547210,117279659374]);
const storageHosts=new Set(Array.from({length:20},(_,i)=>`productionresultssa${i}.blob.core.windows.net`));
const scriptPath=fileURLToPath(import.meta.url);
const failure=()=>Error('Reviewed job log download failed');

function checkJob(jobId){if(!Number.isSafeInteger(jobId)||!reviewedJobs.has(jobId))throw failure();}
function workflowEnvironment(env){
  // Never silently evade inherited routing/trust controls by dropping them.
  // This narrowly scoped client supports only the normal hosted-runner setup.
  const overrides=['NODE_OPTIONS','NODE_DEBUG','NODE_DEBUG_NATIVE','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR','OPENSSL_CONF',
    'NODE_USE_ENV_PROXY','GLOBAL_AGENT_HTTP_PROXY','GLOBAL_AGENT_HTTPS_PROXY'];
  if(Object.entries(env).some(([key,value])=>value!==undefined&&value!==''
    &&(/^(?:https?|all|no)_proxy$/i.test(key)||overrides.includes(key))))throw failure();
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!==repository
    ||env.GITHUB_SERVER_URL!=='https://github.com'||env.GITHUB_API_URL!=='https://api.github.com'
    ||typeof env.GH_TOKEN!=='string'||!(/^[A-Za-z0-9_]+$/).test(env.GH_TOKEN)||env.GH_TOKEN.length>4096
    ||env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw failure();
  // Do not inherit debug, preload, proxy, TLS override, or unrelated secret env.
  return Object.fromEntries(['GH_TOKEN','GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_SERVER_URL','GITHUB_API_URL'].map(k=>[k,env[k]]));
}
function checkedFile(fd){
  if(!Number.isInteger(fd)||fd<3)throw failure();
  const st=fstatSync(fd);
  if(typeof process.getuid!=='function'||st.uid!==process.getuid()||!st.isFile()
    ||st.nlink!==1||(st.mode&0o777)!==0o600||st.size>maximumLogBytes)throw failure();
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
  const requests=[],responses=[];
  let stopped=false;
  const cancel=()=>{
    stopped=true;
    for(const stream of [...responses,...requests]){try{stream.destroy();}catch{}}
  };
  try{
    checkJob(jobId);
    const workflow=workflowEnvironment(env);
    if(checkedFile(fd).size!==0||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>operationTimeoutMs)throw failure();
    const deadline=performance.now()+timeoutMs;
    const active=()=>{if(stopped||performance.now()>=deadline)throw failure();};
    const receive=(url,headers)=>new Promise((accept,reject)=>{
      active();
      const req=request(url,{method:'GET',headers,agent:false,rejectUnauthorized:true,maxHeaderSize:16384},response=>{
        responses.push(response);
        // Install immediately, including on discarded redirect/error bodies.
        response.on('error',()=>reject(failure()));
        if(stopped){response.destroy();reject(failure());return;}
        accept(response);
      });
      requests.push(req);
      req.on('error',()=>reject(failure()));
      req.end();
    });
    const transfer=async()=>{
      const api=await receive(new URL(`https://api.github.com/repos/${repository}/actions/jobs/${jobId}/logs`),{
        Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
        'User-Agent':'screener-reviewed-job-log','Accept-Encoding':'identity',Authorization:`Bearer ${workflow.GH_TOKEN}`,
      });
      active();
      if(api.statusCode!==302)throw failure();
      const storage=checkedStorageLocation(singleHeader(api,'location'));
      api.destroy(); // Ignore the redirect body; never forward response headers.
      active();
      const log=await receive(storage,{'User-Agent':'screener-reviewed-job-log','Accept-Encoding':'identity'});
      active();
      if(log.statusCode!==200)throw failure(); // No further redirects or retries.
      const encoding=singleHeader(log,'content-encoding');
      const length=singleHeader(log,'content-length');
      const transferEncoding=singleHeader(log,'transfer-encoding');
      if((encoding!==undefined&&encoding!=='identity')
        ||(transferEncoding!==undefined&&transferEncoding!=='chunked')
        ||(length!==undefined&&transferEncoding!==undefined)
        ||(length!==undefined&&(!(/^[1-9][0-9]*$/).test(length)||Number(length)>maximumLogBytes)))throw failure();
      let count=0;
      for await(const chunk of log){
        active();
        if(!Buffer.isBuffer(chunk)||count+chunk.length>maximumLogBytes)throw failure();
        let offset=0;
        while(offset<chunk.length){
          active();
          const written=writeSync(fd,chunk,offset,chunk.length-offset,count+offset);
          if(written<1)throw failure();
          offset+=written;
        }
        count+=chunk.length;
      }
      active();
      if(log.complete!==true||log.aborted===true||count===0
        ||(length!==undefined&&count!==Number(length))||checkedFile(fd).size!==count)throw failure();
      return count;
    };
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{cancel();reject(failure());},timeoutMs);});
    return await Promise.race([transfer(),timeout]);
  }catch{throw failure();}
  finally{clearTimeout(timer);cancel();}
}

// The token exists only in the worker's minimal environment. The raw body goes
// to inherited regular fd3, never stdin/stdout/stderr, argv or an error object.
// The caller retains its existing exact SHA256 acceptance check on this Buffer.
export function readReviewedJobLog(jobId,{env=process.env,spawn=spawnSync,tempRoot=tmpdir()}={}){
  const deadline=performance.now()+operationTimeoutMs;
  let directory,fd,result,failed=false;
  try{
    checkJob(jobId);
    const childEnv=workflowEnvironment(env);
    if(typeof tempRoot!=='string'||tempRoot!==resolve(tempRoot)||realpathSync(tempRoot)!==tempRoot
      ||!lstatSync(tempRoot).isDirectory())throw failure();
    directory=mkdtempSync(join(tempRoot,'reviewed-job-log-'));
    const dirStat=lstatSync(directory);
    if(typeof process.getuid!=='function'||dirStat.uid!==process.getuid()||!dirStat.isDirectory()
      ||(dirStat.mode&0o777)!==0o700||!constants.O_NOFOLLOW)throw failure();
    fd=openSync(join(directory,'body'),constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_RDWR,0o600);
    checkedFile(fd);
    const remaining=Math.floor(deadline-performance.now());
    if(remaining<1)throw failure();
    const child=spawn(process.execPath,[scriptPath,'--file-worker',String(jobId),String(remaining)],{
      env:childEnv,stdio:['ignore','ignore','ignore',fd],timeout:remaining,killSignal:'SIGKILL',maxBuffer:1024,
    });
    if(child.error||child.status!==0||child.signal||performance.now()>=deadline)throw failure();
    const st=checkedFile(fd);
    if(st.size===0)throw failure();
    result=Buffer.alloc(st.size);
    let offset=0;
    while(offset<result.length){
      if(performance.now()>=deadline)throw failure();
      const count=readSync(fd,result,offset,result.length-offset,offset);
      if(count<1)throw failure();
      offset+=count;
    }
    if(checkedFile(fd).size!==result.length)throw failure();
  }catch{failed=true;}
  finally{
    if(fd!==undefined){try{closeSync(fd);}catch{failed=true;}}
    if(directory!==undefined){try{rmSync(directory,{recursive:true,force:true});}catch{failed=true;}}
  }
  if(failed)throw failure();
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===scriptPath){
  try{
    if(process.argv.length!==5||process.argv[2]!=='--file-worker')throw failure();
    await downloadReviewedJobLog(Number(process.argv[3]),3,{timeoutMs:Number(process.argv[4])});
  }catch{process.exitCode=1;} // Deliberately silent, even on malformed input.
}
