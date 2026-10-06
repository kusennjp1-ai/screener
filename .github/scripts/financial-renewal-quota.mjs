// Operational scheduling evidence only: this never grants renewal/publication
// authority. Floors are measured single-page minimums, not reservations against
// pagination, concurrent consumers, or GitHub's unobservable secondary limits.
// https://docs.github.com/en/rest/rate-limit/rate-limit
// https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
import {execFileSync} from 'node:child_process';
import {closeSync,constants,lstatSync,mkdirSync,openSync,writeFileSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';

export const renewalQuotaFloors=Object.freeze({
  certify:Object.freeze({admit:330,prepare:78,'verify-source':29,'verify-surfaces':72,'verify-bounds':29,seal:93,'seal-final':21}),
  publish:Object.freeze({admit:722,plan:145,restore:88,compose:88,recheck:182,'recheck-final':29}),
});
export const renewalQuotaLimits=Object.freeze({maximumAgeMs:60_000,requestTimeoutMs:15_000,maximumOutputBytes:64*1024});
const critical=new Set(['date','x-ratelimit-resource','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-used','x-ratelimit-reset','retry-after']);
const fields=['limit','remaining','used','reset'];
const validClock=value=>Number.isSafeInteger(value)&&value>=0&&Number.isFinite(new Date(value).getTime());
const safeClock=value=>validClock(value)?value:null;
const emptySnapshot=()=>({schema_version:'financial-renewal-quota-audit-v1',status:'hold',reason:null,
  phase:null,command:null,minimum_remaining:null,probe_requests:0,demand_basis:'measured-single-page-minimum',capacity_reserved:false,
  request_started_at_ms:null,response_received_at_ms:null,elapsed_ms:null,http_status:null,http_date:null,retry_after:null,
  core:null,body_core:null,body_header_disagreement:null});

export class RenewalQuotaError extends Error {
  constructor(code,snapshot={}){
    super(`Renewal quota preflight held: ${code}`);this.name='RenewalQuotaError';this.code=code;
    this.snapshot={...emptySnapshot(),...snapshot,status:'hold',reason:code};
  }
}
const fail=(code,snapshot)=>{throw new RenewalQuotaError(code,snapshot);};
function demand(phase,command,snapshot){
  if(typeof phase!=='string'||typeof command!=='string'||!Object.hasOwn(renewalQuotaFloors,phase)||!Object.hasOwn(renewalQuotaFloors[phase],command))fail('unknown-command',snapshot);
  return renewalQuotaFloors[phase][command];
}
function counters(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!fields.every(key=>Number.isSafeInteger(value[key])&&value[key]>=0))return null;
  const {limit,remaining,used,reset}=value;
  if(limit<=0||remaining>limit||used>limit||remaining+used!==limit||reset<=0||!validClock(reset*1000))return null;
  return {limit,remaining,used,reset};
}
function numericHeader(value){return typeof value==='string'&&/^(?:0|[1-9]\d*)$/.test(value)?Number(value):NaN;}
function httpDate(value){
  if(typeof value!=='string'||!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value))return null;
  const milliseconds=Date.parse(value);
  return validClock(milliseconds)&&new Date(milliseconds).toUTCString()===value?new Date(milliseconds).toISOString():null;
}
function retryAfter(value){
  // Audit only: no waiting or retry scheduling. Limit decimal input length and
  // require an exactly representable nonnegative integer before retaining it.
  if(/^(?:0|[1-9]\d{0,15})$/.test(value)&&Number.isSafeInteger(Number(value)))return {kind:'seconds',seconds:Number(value)};
  if(httpDate(value)!==null)return {kind:'http-date',http_date:value};
  return {kind:'invalid'};
}

function boundedText(raw,snapshot){
  if(!(typeof raw==='string'||Buffer.isBuffer(raw)))fail('malformed-response',snapshot);
  if(Buffer.byteLength(raw)>renewalQuotaLimits.maximumOutputBytes)fail('response-too-large',snapshot);
  const text=Buffer.isBuffer(raw)?raw.toString('utf8'):raw;
  if(!text||text.includes('\uFFFD')||/\r(?!\n)/.test(text))fail('malformed-response',snapshot);
  return text.replaceAll('\r\n','\n');
}

// The only retained remote fields are validated counters, status, and HTTP Date.
// Neither raw headers/body nor execution errors can enter the audit snapshot.
export function parseRenewalQuotaResponse(raw){
  const snapshot=emptySnapshot(),text=boundedText(raw,snapshot),boundary=text.indexOf('\n\n');
  if(boundary<0)fail('malformed-response',snapshot);
  const lines=text.slice(0,boundary).split('\n');
  const status=/^HTTP\/(?:1\.[01]|2(?:\.0)?|3(?:\.0)?) ([1-5]\d{2})(?: [\x20-\x7e]*)?$/.exec(lines.shift());
  if(!status)fail('malformed-status',snapshot);
  snapshot.http_status=Number(status[1]);
  const headers=new Map(),duplicates=new Set();
  for(const line of lines){
    const match=/^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[\t ]*([^\x00-\x08\x0a-\x1f\x7f]*)$/.exec(line);
    if(!match)fail('malformed-header',snapshot);
    const name=match[1].toLowerCase(),value=match[2].trim();
    if(critical.has(name)&&headers.has(name))duplicates.add(name);
    headers.set(name,value);
  }
  // Preserve only individually validated, unambiguous response metadata even
  // when GitHub refuses the probe. Error bodies are neither needed nor retained.
  if(headers.has('date')&&!duplicates.has('date'))snapshot.http_date=httpDate(headers.get('date'));
  const core=counters(Object.fromEntries(fields.map(key=>[key,numericHeader(headers.get(`x-ratelimit-${key}`))])));
  if(headers.get('x-ratelimit-resource')==='core'&&![...duplicates].some(name=>name.startsWith('x-ratelimit-')))snapshot.core=core;
  if(headers.has('retry-after'))snapshot.retry_after=duplicates.has('retry-after')?{kind:'invalid'}:retryAfter(headers.get('retry-after'));
  if(duplicates.size)fail('duplicate-critical-header',snapshot);
  if(headers.has('retry-after'))fail('retry-after',snapshot);
  if(snapshot.http_status!==200)fail('http-status',snapshot);
  if([...critical].filter(name=>name!=='retry-after').some(name=>!headers.has(name)))fail('missing-critical-header',snapshot);
  if(headers.get('x-ratelimit-resource')!=='core')fail('wrong-resource',snapshot);
  if(snapshot.http_date===null)fail('malformed-http-date',snapshot);
  if(!snapshot.core)fail('invalid-header-counters',snapshot);
  let body;try{body=JSON.parse(text.slice(boundary+2));}catch{fail('malformed-body',snapshot);}
  const bodyCore=counters(body?.resources?.core);
  if(!bodyCore)fail('invalid-body-counters',snapshot);
  snapshot.body_core=bodyCore;
  snapshot.body_header_disagreement=fields.some(key=>core[key]!==bodyCore[key]);
  return {http_status:snapshot.http_status,http_date:snapshot.http_date,retry_after:snapshot.retry_after,core,body_core:bodyCore,body_header_disagreement:snapshot.body_header_disagreement};
}

export function assessRenewalQuota({phase,command,response,requestStartedAtMs,responseReceivedAtMs}={}){
  const snapshot=emptySnapshot();snapshot.probe_requests=1;
  snapshot.minimum_remaining=demand(phase,command,snapshot);snapshot.phase=phase;snapshot.command=command;
  snapshot.request_started_at_ms=safeClock(requestStartedAtMs);snapshot.response_received_at_ms=safeClock(responseReceivedAtMs);
  if(!validClock(requestStartedAtMs)||!validClock(responseReceivedAtMs))fail('invalid-clock',snapshot);
  if(responseReceivedAtMs<requestStartedAtMs)fail('clock-regression',snapshot);
  snapshot.elapsed_ms=responseReceivedAtMs-requestStartedAtMs;
  if(snapshot.elapsed_ms>renewalQuotaLimits.requestTimeoutMs)fail('request-timeout',snapshot);
  try{Object.assign(snapshot,parseRenewalQuotaResponse(response));}
  catch(error){if(error instanceof RenewalQuotaError)fail(error.code,{...snapshot,...Object.fromEntries(['http_status','http_date','retry_after','core','body_core','body_header_disagreement'].map(key=>[key,error.snapshot[key]]))});throw error;}
  const dateMs=Date.parse(snapshot.http_date);
  if(dateMs>responseReceivedAtMs)fail('future-http-date',snapshot);
  if(responseReceivedAtMs-dateMs>renewalQuotaLimits.maximumAgeMs)fail('stale-http-date',snapshot);
  if(snapshot.core.reset*1000<=responseReceivedAtMs)fail('reset-reached',snapshot);
  if(snapshot.core.remaining<snapshot.minimum_remaining)fail('insufficient-remaining',snapshot);
  return {...snapshot,status:'admitted'};
}

// Test dependencies are direct function arguments only. There are deliberately
// no CLI/environment overrides for clocks, response bytes, floors, or limits.
// Every invocation performs a new GET, with no cache, retry, wait, or reset credit.
export function checkRenewalQuota({phase,command,testOnlyRun,testOnlyNow}={}){
  const snapshot=emptySnapshot();snapshot.minimum_remaining=demand(phase,command,snapshot);snapshot.phase=phase;snapshot.command=command;
  if(testOnlyRun!==undefined&&typeof testOnlyRun!=='function')fail('invalid-test-dependency',snapshot);
  if(testOnlyNow!==undefined&&typeof testOnlyNow!=='function')fail('invalid-test-dependency',snapshot);
  const run=testOnlyRun??execFileSync,now=testOnlyNow??Date.now;
  if(testOnlyRun===undefined&&!process.env.GH_TOKEN)fail('missing-gh-token',snapshot);
  const requestStartedAtMs=now();snapshot.request_started_at_ms=safeClock(requestStartedAtMs);
  let response,executionFailure;snapshot.probe_requests=1;
  try{
    response=run('gh',['api','--hostname','github.com','--method','GET','--include','rate_limit','-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2022-11-28'],
      {encoding:'utf8',timeout:renewalQuotaLimits.requestTimeoutMs,killSignal:'SIGKILL',maxBuffer:renewalQuotaLimits.maximumOutputBytes,stdio:['ignore','pipe','pipe'],
        env:{...process.env,GH_PROMPT_DISABLED:'1',GH_DEBUG:''}});
  }catch(error){executionFailure=error;response=error?.stdout;}
  const responseReceivedAtMs=now();snapshot.response_received_at_ms=safeClock(responseReceivedAtMs);
  if(validClock(requestStartedAtMs)&&validClock(responseReceivedAtMs)&&responseReceivedAtMs>=requestStartedAtMs)snapshot.elapsed_ms=responseReceivedAtMs-requestStartedAtMs;
  if(!validClock(requestStartedAtMs)||!validClock(responseReceivedAtMs))fail('invalid-clock',snapshot);
  if(responseReceivedAtMs<requestStartedAtMs)fail('clock-regression',snapshot);
  if(snapshot.elapsed_ms>renewalQuotaLimits.requestTimeoutMs||executionFailure?.code==='ETIMEDOUT'||executionFailure?.signal==='SIGTERM'||executionFailure?.signal==='SIGKILL')fail('request-timeout',snapshot);
  if(executionFailure?.code==='ENOBUFS'||executionFailure?.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')fail('response-too-large',snapshot);
  if(executionFailure){
    // Preserve a safe 403/429/Retry-After classification, but an unsuccessful
    // process can never admit work even if it emitted apparently valid bytes.
    if(typeof response==='string'||Buffer.isBuffer(response)){
      try{assessRenewalQuota({phase,command,response,requestStartedAtMs,responseReceivedAtMs});}
      catch(error){if(error instanceof RenewalQuotaError)throw error;}
    }
    fail('request-failed',snapshot);
  }
  return assessRenewalQuota({phase,command,response,requestStartedAtMs,responseReceivedAtMs});
}


// This helper owns operational audit output only. Test hooks do not participate
// in checkRenewalQuota or become CLI/environment controls for its trust inputs.
export function recordRenewalQuotaAudit(snapshot,{testOnlyTemp,testOnlyPid,testOnlyWriteStderr}={}){
  demand(snapshot?.phase,snapshot?.command);
  const temp=testOnlyTemp??process.env.RUNNER_TEMP,pid=testOnlyPid??process.pid,writeStderr=testOnlyWriteStderr??(text=>process.stderr.write(text));
  if(typeof temp!=='string'||!isAbsolute(temp)||!Number.isSafeInteger(pid)||pid<=0||typeof writeStderr!=='function')fail('audit-unavailable',snapshot);
  const directory=join(temp,'financial-renewal-quota'),filename=join(directory,`${snapshot.phase}-${snapshot.command}-${pid}.json`);
  let fd;
  try{
    const rootStat=lstatSync(temp);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail('audit-unavailable',snapshot);
    try{mkdirSync(directory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
    const directoryStat=lstatSync(directory);if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink())fail('audit-unavailable',snapshot);
    // O_EXCL refuses every preexisting target, including ordinary files and
    // symlinks. O_NOFOLLOW adds explicit last-component symlink protection.
    fd=openSync(filename,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    writeFileSync(fd,`${JSON.stringify(snapshot,null,2)}\n`);closeSync(fd);fd=undefined;
  }catch{
    if(fd!==undefined){try{closeSync(fd);}catch{}}
    fail('audit-unavailable',snapshot);
  }
  try{writeStderr(`${JSON.stringify(snapshot)}\n`);}catch{fail('audit-unavailable',snapshot);}
  return filename;
}

export function enforceRenewalQuota(phase,command){
  let snapshot,failure;
  try{snapshot=checkRenewalQuota({phase,command});}
  catch(error){if(!(error instanceof RenewalQuotaError))throw error;snapshot=error.snapshot;failure=error;}
  recordRenewalQuotaAudit(snapshot);
  if(failure)throw failure;
  return snapshot;
}
