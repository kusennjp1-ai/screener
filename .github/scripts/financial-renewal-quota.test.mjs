import test from 'node:test';
import assert from 'node:assert/strict';
import {lstatSync,mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renewalQuotaFloors,renewalQuotaLimits,RenewalQuotaError,parseRenewalQuotaResponse,assessRenewalQuota,checkRenewalQuota,recordRenewalQuotaAudit} from './financial-renewal-quota.mjs';

// Literal local request clocks, independent of the machine clock or a global
// Date replacement. No test calls GitHub or needs a token.
const start=1791288000100,end=1791288000900,date='Tue, 06 Oct 2026 12:00:00 GMT',reset=1791288060;
const core=(remaining=722,limit=1000)=>({limit,remaining,used:limit-remaining,reset});
function response({status=200,headers={},headerCore=core(),bodyCore=headerCore,extra=[],body,separator='\r\n'}={}){
  const fields={Date:date,'X-RateLimit-Resource':'core',...Object.fromEntries(Object.entries(headerCore).map(([key,value])=>[`X-RateLimit-${key}`,String(value)])),...headers};
  return [`HTTP/2.0 ${status} ${status===200?'OK':'Blocked'}`,...Object.entries(fields).filter(([,value])=>value!==null).map(([key,value])=>`${key}: ${value}`),...extra,'',body??JSON.stringify({resources:{core:bodyCore,search:{untrusted:'ignored'}}})].join(separator);
}
const assess=(raw=response(),overrides={})=>assessRenewalQuota({phase:'publish',command:'admit',response:raw,requestStartedAtMs:start,responseReceivedAtMs:end,...overrides});
function held(fn,code){
  let found;assert.throws(fn,error=>{found=error;return error instanceof RenewalQuotaError&&error.code===code;});
  assert.equal(found.snapshot.status,'hold');assert.equal(found.snapshot.reason,code);
  assert.equal(found.message,`Renewal quota preflight held: ${code}`);return found.snapshot;
}
function readTwice(first,second,{phase='publish',command='admit'}={}){
  const reads=[first,second],clocks=[start,end,1791288001100,1791288001900];let calls=0;
  const options={phase,command,testOnlyRun:()=>{const read=reads[calls++];if(read instanceof Error)throw read;return read;},testOnlyNow:()=>clocks.shift()};
  return {options,calls:()=>calls,remainingClocks:()=>clocks.length};
}

test('closed measured floors include retained final-boundary demand and cannot be changed',()=>{
  assert.deepEqual(renewalQuotaFloors,{certify:{admit:330,prepare:78,'verify-source':29,'verify-surfaces':72,'verify-bounds':29,seal:93,'seal-final':21},publish:{admit:722,plan:145,restore:88,compose:88,recheck:182,'recheck-final':29}});
  assert.equal(Object.isFrozen(renewalQuotaFloors),true);
  for(const phase of Object.keys(renewalQuotaFloors)){
    assert.equal(Object.isFrozen(renewalQuotaFloors[phase]),true);
    for(const [command,floor] of Object.entries(renewalQuotaFloors[phase])){
      const accepted=assess(response({headerCore:core(floor)}),{phase,command});
      assert.equal(accepted.status,'admitted');assert.equal(accepted.minimum_remaining,floor);assert.equal(accepted.core.remaining,floor);
      held(()=>assess(response({headerCore:core(floor-1)}),{phase,command}),'insufficient-remaining');
    }
  }
  assert.throws(()=>{renewalQuotaFloors.publish.admit=1;},TypeError);
});
test('an insufficient actual token limit is never replaced with an assumed standard limit',()=>{
  const snapshot=held(()=>assess(response({headerCore:core(60,60)})),'insufficient-remaining');
  assert.equal(snapshot.core.limit,60);assert.equal(snapshot.core.remaining,60);
  assert.equal(assess(response({headerCore:core(29,29)}),{command:'recheck-final'}).status,'admitted');
});
test('unknown phase or command holds without running a request or trusting an overridden floor',()=>{
  let calls=0;
  for(const [phase,command] of [['certify','manual'],['publish','seal'],['__proto__','admit'],['publish','constructor'],['publish',{}]]){
    held(()=>checkRenewalQuota({phase,command,minimum_remaining:0,testOnlyRun:()=>calls++}),'unknown-command');
  }
  assert.equal(calls,0);
  held(()=>assess(response({headerCore:core(1)}),{minimum_remaining:0}),'insufficient-remaining');
});
test('parses gh included headers with CRLF or LF while retaining only allowlisted audit data',()=>{
  for(const separator of ['\r\n','\n']){
    const parsed=parseRenewalQuotaResponse(response({separator,extra:['X-Private-Value: do-not-retain'],body:JSON.stringify({secret:'do-not-retain',resources:{core:core()}})}));
    assert.deepEqual(parsed,{http_status:200,http_date:'2026-10-06T12:00:00.000Z',retry_after:null,core:core(),body_core:core(),body_header_disagreement:false});
    assert.equal(JSON.stringify(parsed).includes('do-not-retain'),false);
  }
});
test('authoritative headers admit against a valid lower body allowance and record disagreement',()=>{
  const snapshot=assess(response({headerCore:core(722),bodyCore:{...core(20),reset:1791288000}}));
  assert.equal(snapshot.status,'admitted');assert.equal(snapshot.body_header_disagreement,true);assert.equal(snapshot.body_core.remaining,20);
});
test('a larger overview body allowance never overrides insufficient authoritative headers',()=>{
  const snapshot=held(()=>assess(response({headerCore:core(721),bodyCore:core(999)})),'insufficient-remaining');
  assert.equal(snapshot.body_header_disagreement,true);assert.equal(snapshot.core.remaining,721);
});
test('resource mismatch, missing headers and duplicate critical headers fail closed',()=>{
  held(()=>assess(response({headers:{'X-RateLimit-Resource':'search'}})),'wrong-resource');
  for(const header of ['Date','X-RateLimit-Resource','X-RateLimit-limit','X-RateLimit-remaining','X-RateLimit-used','X-RateLimit-reset']){
    held(()=>assess(response({headers:{[header]:null}})),'missing-critical-header');
    held(()=>assess(response({extra:[`${header.toLowerCase()}: ${header==='Date'?date:'1'}`]})),'duplicate-critical-header');
  }
});
test('malformed and inconsistent header counters fail even with a valid body',()=>{
  for(const changed of [{remaining:'722junk'},{remaining:'7.22e2'},{remaining:'0722'},{remaining:'-1'},{remaining:'NaN'},{remaining:'Infinity'},{limit:0},{used:0},{used:1001},{remaining:1001},{reset:0},{reset:'9007199254740993'},{reset:'1.5'}]){
    held(()=>assess(response({headerCore:{...core(),...changed},bodyCore:core()})),'invalid-header-counters');
  }
});
test('malformed status, header framing, HTTP Date and body fail closed',()=>{
  for(const raw of ['',null,{},'HTTP/2 200 OK\nDate: value',response().replace('HTTP/2.0','FTP/2.0'),response().replace('\r\n','\r')]){
    assert.throws(()=>assess(raw),RenewalQuotaError);
  }
  for(const extra of [['Continuation without colon'],[' Date: folded'],['X-Invalid: value\u0000']])held(()=>assess(response({extra})),'malformed-header');
  for(const value of ['2026-10-06T12:00:00Z','Wed, 06 Oct 2026 12:00:00 GMT','Tue, 99 Oct 2026 12:00:00 GMT','bad'])held(()=>assess(response({headers:{Date:value}})),'malformed-http-date');
  held(()=>assess(response({body:'{"secret":"not-json"'})),'malformed-body');
  for(const body of ['null','{}','{"resources":{}}','{"resources":{"core":null}}'])held(()=>assess(response({body})),'invalid-body-counters');
  for(const changed of [{remaining:'722'},{limit:0},{used:0},{reset:-1}])held(()=>assess(response({bodyCore:{...core(),...changed}})),'invalid-body-counters');
});
test('response output is bounded before parsing',()=>{
  held(()=>assess(Buffer.alloc(renewalQuotaLimits.maximumOutputBytes+1)),'response-too-large');
  const base=response(),exact=base+' '.repeat(renewalQuotaLimits.maximumOutputBytes-Buffer.byteLength(base));
  assert.equal(assess(exact).status,'admitted');
});
test('403 and 429 are held and Retry-After blocks even a 200 with available quota',()=>{
  for(const status of [201,304,401,403,429,500]){
    const snapshot=held(()=>assess(response({status})),'http-status');assert.equal(snapshot.http_status,status);
  }
  for(const value of ['1','0','','bad','Tue, 06 Oct 2026 12:01:00 GMT'])held(()=>assess(response({headers:{'Retry-After':value}})),'retry-after');
  held(()=>assess(response({status:429,headers:{'Retry-After':'60'}})),'retry-after');
  held(()=>assess(response({extra:['Retry-After: 1','retry-after: 1']})),'duplicate-critical-header');
});
test('local clocks reject regression, invalid times and elapsed timeout',()=>{
  held(()=>assess(response(),{responseReceivedAtMs:start-1}),'clock-regression');
  for(const value of [NaN,Infinity,-1,'1791288000100',null,Number.MAX_SAFE_INTEGER]){
    held(()=>assess(response(),{requestStartedAtMs:value}),'invalid-clock');
    held(()=>assess(response(),{responseReceivedAtMs:value}),'invalid-clock');
  }
  held(()=>assess(response(),{responseReceivedAtMs:start+15_001}),'request-timeout');
  assert.equal(assess(response(),{responseReceivedAtMs:start+15_000}).status,'admitted');
});
test('HTTP Date age is measured at response end; exactly 60 seconds is allowed',()=>{
  const raw=response({headers:{Date:'Tue, 06 Oct 2026 11:59:01 GMT'}});
  assert.equal(assess(raw,{requestStartedAtMs:1791288000100,responseReceivedAtMs:1791288001000}).status,'admitted');
  held(()=>assess(raw,{requestStartedAtMs:1791288000100,responseReceivedAtMs:1791288001001}),'stale-http-date');
  held(()=>assess(response({headers:{Date:'Tue, 06 Oct 2026 12:00:01 GMT'}})),'future-http-date');
});
test('the reset boundary never credits a new window; one millisecond remaining is accepted',()=>{
  const raw=response();
  assert.equal(assess(raw,{requestStartedAtMs:1791288059000,responseReceivedAtMs:1791288059999}).status,'admitted');
  held(()=>assess(raw,{requestStartedAtMs:1791288059000,responseReceivedAtMs:1791288060000}),'reset-reached');
  // Advance HTTP Date too, so this tests elapsed-reset rejection without stale Date masking it.
  held(()=>assess(response({headers:{Date:'Tue, 06 Oct 2026 12:01:00 GMT'}}),{requestStartedAtMs:1791288060000,responseReceivedAtMs:1791288060001}),'reset-reached');
  held(()=>assess(response({headerCore:{...core(0),reset:1791288000}})),'reset-reached');
});
test('reader issues one bounded official GET and records that probe independently of its primary-budget exemption',()=>{
  const clocks=[start,end];let calls=0;
  const snapshot=checkRenewalQuota({phase:'publish',command:'admit',testOnlyNow:()=>clocks.shift(),testOnlyRun:(binary,args,options)=>{
    calls++;assert.equal(binary,'gh');assert.deepEqual(args,['api','--hostname','github.com','--method','GET','--include','rate_limit','-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2022-11-28']);
    assert.equal(options.timeout,15_000);assert.equal(options.maxBuffer,64*1024);assert.equal(options.killSignal,'SIGKILL');assert.deepEqual(options.stdio,['ignore','pipe','pipe']);
    assert.equal(options.env.GH_PROMPT_DISABLED,'1');assert.equal(options.env.GH_DEBUG,'');return response();
  }});
  assert.equal(calls,1);assert.equal(clocks.length,0);assert.equal(snapshot.probe_requests,1);assert.equal(snapshot.capacity_reserved,false);
  assert.equal(snapshot.request_started_at_ms,start);assert.equal(snapshot.response_received_at_ms,end);assert.equal(snapshot.elapsed_ms,800);
});
test('each check reads fresh: later insufficient or stale allowance cannot reuse the first success',()=>{
  for(const [second,code] of [[response({headerCore:core(721)}),'insufficient-remaining'],[response({headers:{Date:'Tue, 06 Oct 2026 11:59:00 GMT'}}),'stale-http-date']]){
    const f=readTwice(response(),second);assert.equal(checkRenewalQuota(f.options).status,'admitted');
    held(()=>checkRenewalQuota(f.options),code);assert.equal(f.calls(),2);assert.equal(f.remainingClocks(),0);
  }
});
test('two insufficient fresh checks both hold without sleeping, retrying or inferring reset capacity',()=>{
  const f=readTwice(response({headerCore:core(0)}),response({headerCore:core(0)}));
  for(let i=0;i<2;i++)assert.equal(held(()=>checkRenewalQuota(f.options),'insufficient-remaining').probe_requests,1);
  assert.equal(f.calls(),2);assert.equal(f.remainingClocks(),0);
});
test('uncertain execution failure cannot reuse a success or admit apparently successful stdout',()=>{
  for(const stdout of [undefined,response()]){
    const error=Object.assign(new Error('private-token-in-error'),{stdout,stderr:'private-token-in-stderr'}),f=readTwice(response(),error);
    assert.equal(checkRenewalQuota(f.options).status,'admitted');
    const snapshot=held(()=>checkRenewalQuota(f.options),'request-failed');
    assert.equal(snapshot.probe_requests,1);assert.equal(JSON.stringify(snapshot).includes('private-token'),false);assert.equal(f.calls(),2);
  }
});
test('transport errors remain safe, bounded and unretried',()=>{
  for(const [failure,code] of [
    [{code:'ETIMEDOUT'},'request-timeout'],[{signal:'SIGKILL'},'request-timeout'],[{code:'ENOBUFS'},'response-too-large'],
    [{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'},'response-too-large'],[{stdout:response({status:403})},'http-status'],
    [{stdout:response({status:429,headers:{'Retry-After':'60'}})},'retry-after'],[{stdout:'private-token-in-stdout'},'malformed-response'],
  ]){
    const clocks=[start,end];let calls=0;
    const snapshot=held(()=>checkRenewalQuota({phase:'publish',command:'admit',testOnlyNow:()=>clocks.shift(),testOnlyRun:()=>{calls++;throw Object.assign(new Error('private-token-in-error'),failure,{stderr:'private-token-in-stderr'});}}),code);
    assert.equal(calls,1);assert.equal(snapshot.probe_requests,1);assert.equal(JSON.stringify(snapshot).includes('private-token'),false);
  }
});
test('reader rejects elapsed-clock timeout and regression even if its process reports success',()=>{
  for(const [clocks,code] of [[[start,start-1],'clock-regression'],[[start,start+15_001],'request-timeout']])held(()=>checkRenewalQuota({phase:'publish',command:'admit',testOnlyRun:()=>response(),testOnlyNow:()=>clocks.shift()}),code);
});
test('test dependencies are function arguments and production has no clock, raw-response or floor environment switches',()=>{
  const source=readFileSync(new URL('./financial-renewal-quota.mjs',import.meta.url),'utf8');
  assert.match(source,/testOnlyNow\?\?Date\.now/);assert.match(source,/testOnlyRun\?\?execFileSync/);
  assert.deepEqual([...source.matchAll(/process\.env\.([A-Z_]+)/g)].map(match=>match[1]),['GH_TOKEN','RUNNER_TEMP']);
  assert.doesNotMatch(source,/process\.argv|setTimeout|setInterval|Atomics\.wait/);
  held(()=>checkRenewalQuota({phase:'publish',command:'admit',testOnlyRun:true}),'invalid-test-dependency');
  held(()=>checkRenewalQuota({phase:'publish',command:'admit',testOnlyRun:()=>response(),testOnlyNow:start}),'invalid-test-dependency');
});


test('audit retains exact safe success and hold snapshots outside sealed data and prints only JSON to stderr',()=>{
  const root=mkdtempSync(join(tmpdir(),'renewal-quota-audit-'));
  try{
    const success=assess(),failure=held(()=>assess(response({headerCore:core(1)})),'insufficient-remaining');
    for(const [index,snapshot] of [success,failure].entries()){
      const output=[];const path=recordRenewalQuotaAudit(snapshot,{testOnlyTemp:root,testOnlyPid:index+1,testOnlyWriteStderr:text=>output.push(text)});
      assert.equal(path,join(root,'financial-renewal-quota',`publish-admit-${index+1}.json`));
      assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),snapshot);assert.deepEqual(output,[`${JSON.stringify(snapshot)}\n`]);
      assert.equal(lstatSync(path).isFile(),true);assert.equal(lstatSync(path).mode&0o777,0o600);
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('audit refuses missing/relative roots, non-directory roots and symlink directories',()=>{
  const root=mkdtempSync(join(tmpdir(),'renewal-quota-audit-'));
  try{
    const file=join(root,'file');writeFileSync(file,'existing');const link=join(root,'link');symlinkSync(root,link);
    for(const temp of ['', 'relative',join(root,'missing'),file,link]){
      let messages=0;held(()=>recordRenewalQuotaAudit(assess(),{testOnlyTemp:temp,testOnlyPid:1,testOnlyWriteStderr:()=>messages++}),'audit-unavailable');assert.equal(messages,0);
    }
    symlinkSync(root,join(root,'financial-renewal-quota'));
    held(()=>recordRenewalQuotaAudit(assess(),{testOnlyTemp:root,testOnlyPid:1,testOnlyWriteStderr:()=>assert.fail('No audit was retained')}),'audit-unavailable');
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('audit never overwrites an existing file, symlink, or nonregular target',()=>{
  for(const kind of ['file','symlink','directory']){
    const root=mkdtempSync(join(tmpdir(),'renewal-quota-audit-'));
    try{
      const directory=join(root,'financial-renewal-quota'),path=join(directory,'publish-admit-7.json'),other=join(root,'preserve');
      mkdirSync(directory);writeFileSync(other,'untouched');
      if(kind==='file')writeFileSync(path,'old audit');else if(kind==='symlink')symlinkSync(other,path);else mkdirSync(path);
      held(()=>recordRenewalQuotaAudit(assess(),{testOnlyTemp:root,testOnlyPid:7,testOnlyWriteStderr:()=>assert.fail('No audit was retained')}),'audit-unavailable');
      assert.equal(readFileSync(other,'utf8'),'untouched');if(kind==='file')assert.equal(readFileSync(path,'utf8'),'old audit');
    }finally{rmSync(root,{recursive:true,force:true});}
  }
});


test('403/429 retain valid HTTP Date and core/reset metadata without requiring or retaining an error body',()=>{
  for(const status of [403,429]){
    const raw=response({status,headerCore:core(0),body:'private response that is not quota JSON',extra:['Authorization: private-header']});
    const snapshot=held(()=>assess(raw),'http-status');
    assert.equal(snapshot.http_status,status);assert.equal(snapshot.http_date,'2026-10-06T12:00:00.000Z');
    assert.deepEqual(snapshot.core,core(0));assert.equal(snapshot.core.reset,reset);assert.equal(snapshot.body_core,null);
    assert.equal(snapshot.retry_after,null);assert.equal(snapshot.body_header_disagreement,null);assert.equal(snapshot.probe_requests,1);
    assert.equal(JSON.stringify(snapshot).includes('private'),false);
  }
});
test('held Retry-After metadata retains only bounded seconds, canonical HTTP dates, or invalid classification',()=>{
  for(const [value,expected] of [
    ['0',{kind:'seconds',seconds:0}],['60',{kind:'seconds',seconds:60}],
    ['9007199254740991',{kind:'seconds',seconds:Number.MAX_SAFE_INTEGER}],
    ['Tue, 06 Oct 2026 12:01:00 GMT',{kind:'http-date',http_date:'Tue, 06 Oct 2026 12:01:00 GMT'}],
    ...['','private-value','-1','1.5','1e3','9007199254740992','99999999999999999999999999','Wed, 06 Oct 2026 12:01:00 GMT'].map(value=>[value,{kind:'invalid'}]),
  ]){
    const snapshot=held(()=>assess(response({status:429,headers:{'Retry-After':value},headerCore:core(0),body:'error body'})),'retry-after');
    assert.deepEqual(snapshot.retry_after,expected);assert.equal(snapshot.http_status,429);assert.deepEqual(snapshot.core,core(0));
    assert.equal(snapshot.http_date,'2026-10-06T12:00:00.000Z');assert.equal(snapshot.body_core,null);
    assert.equal(JSON.stringify(snapshot).includes('private-value'),false);
  }
});
test('failed statuses preserve only independently valid partial header metadata and never admit',()=>{
  const onlyDate=held(()=>assess(response({status:403,headers:{'X-RateLimit-limit':null,'X-RateLimit-remaining':null,'X-RateLimit-used':null,'X-RateLimit-reset':null},body:'error'})),'http-status');
  assert.equal(onlyDate.http_date,'2026-10-06T12:00:00.000Z');assert.equal(onlyDate.core,null);
  const onlyCore=held(()=>assess(response({status:429,headers:{Date:null},headerCore:core(0),body:''})),'http-status');
  assert.equal(onlyCore.http_date,null);assert.deepEqual(onlyCore.core,core(0));
  const wrongResource=held(()=>assess(response({status:403,headers:{'X-RateLimit-Resource':'search',Date:'private-date'},body:''})),'http-status');
  assert.equal(wrongResource.core,null);assert.equal(wrongResource.http_date,null);
  const duplicateDate=held(()=>assess(response({status:429,extra:[`date: ${date}`],headerCore:core(0)})),'duplicate-critical-header');
  assert.equal(duplicateDate.http_date,null);assert.deepEqual(duplicateDate.core,core(0));
});
