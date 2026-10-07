import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {
  LIMITS, route, fault, validateRequiredIds, validatePage, validateSnapshot,
  project, collectSnapshot, classifyTransport, readRepositorySnapshot,
} from './retained-price-repository-inventory.mjs';

const REPO='kusennjp1-ai/screener', RID=1203919607;
const STATIC=294257497, RELEASE=364666954, TOKEN='fixture-token-never-log';
const digest=value=>createHash('sha256').update(value).digest('hex');
function row(id,extra={}) {
  const workflow=id%2===0?RELEASE:STATIC;
  return {id,workflow_id:workflow,path:'.github/workflows/'+(workflow===STATIC?'static-site.yml':'research-ui-release.yml'),
    head_branch:'main',repository:{id:RID,full_name:REPO},head_repository:{id:RID,full_name:REPO},
    run_attempt:1,head_sha:'a'.repeat(40),created_at:'2020-01-01T00:00:00Z',
    updated_at:'2026-10-07T22:00:00Z',run_started_at:'2026-10-07T21:59:00Z',
    status:'completed',conclusion:'success',event:'push',...extra};
}
function links(page,total) {
  const last=Math.max(1,Math.ceil(total/50)),out=[];
  if(page<last)out.push('<https://api.github.com/'+route(page+1)+'>; rel="next"');
  if(page>1)out.push('<https://api.github.com/'+route(page-1)+'>; rel="prev"');
  if(last>1)out.push('<https://api.github.com/'+route(last)+'>; rel="last"');
  return out.join(', ');
}
function pageOf(page,total) {
  return {value:{total_count:total,workflow_runs:Array.from(
    {length:Math.min(50,Math.max(0,total-(page-1)*50))},(_,i)=>row((page-1)*50+i+1))},
    link:links(page,total)};
}
const matches=(reason,retryable=false)=>error=>{
  assert.equal(error.inventoryReason,reason);
  assert.equal(error.retryable,retryable);
  return true;
};
async function snapshotFixture(total,change=()=>{},requiredIds=[1,total]) {
  const controller=new AbortController(),calls=[];let active=0,max=0;
  const read=async n=>{
    calls.push(n);active++;max=Math.max(max,active);
    try {await nextTurn();if(controller.signal.aborted)throw fault('sibling-aborted');
      const page=pageOf(n,total);change(page,n);return page;
    } finally {active--;}
  };
  try {return {result:await collectSnapshot({read,signal:controller.signal,abort:e=>controller.abort(e),requiredIds}),calls,max,active};}
  catch(error) {return {error,calls,max,active,aborted:controller.signal.aborted};}
}
function deferred() {
  let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  return {promise,resolve,reject};
}
async function controlledCollection(total=201) {
  const controller=new AbortController(),gates=new Map(),calls=[];let active=0,settled=false;
  const pending=collectSnapshot({signal:controller.signal,abort:e=>controller.abort(e),requiredIds:[1,total],read:async n=>{
    calls.push(n);if(n===1)return pageOf(1,total);
    const gate=deferred();gates.set(n,gate);active++;
    try{return await gate.promise;}finally{active--;}
  }}).then(result=>({result}),error=>({error})).finally(()=>{settled=true;});
  await nextTurn();assert.deepEqual(calls,[1,2,3,4]);
  return {controller,gates,calls,pending,get active(){return active;},get settled(){return settled;}};
}
function responseOf(page,total,options={}) {
  const sample=pageOf(page,total),value=options.value??sample.value;
  const headers=new Headers({'content-type':'application/json',link:options.link??sample.link,...options.headers});
  const raw=options.raw??JSON.stringify(value),bytes=typeof raw==='string'?Buffer.from(raw):raw;
  const body=options.body??(async function*(){yield bytes;})();
  return {status:options.status??200,redirected:options.redirected??false,
    url:options.url??'https://api.github.com/'+route(page),headers,body};
}
function requestedPage(url) {
  const u=new URL(url);assert.equal(u.origin,'https://api.github.com');
  assert.equal(u.pathname,'/repositories/'+RID+'/actions/runs');
  assert.deepEqual([...u.searchParams.keys()],['per_page','page']);
  assert.equal(u.searchParams.get('per_page'),'50');
  return Number(u.searchParams.get('page'));
}
function failed(value,reason,retryable=false) {
  assert.equal(value.schema_version,'retained-price-repository-snapshot-v1');
  assert.equal(value.status,'failed');assert.equal(value.reason,reason);assert.equal(value.retryable,retryable);
  assert.equal(Object.hasOwn(value,'pages'),false);
  assert(Array.isArray(value.evidence));assert(Number.isSafeInteger(value.body_bytes));
  assert.doesNotMatch(JSON.stringify(value),/fixture-token-never-log|fixture-private-payload|fixture-private-diagnostic/);
}
const readSnapshot=(fetcher,options={})=>readRepositorySnapshot({timeoutMs:30000,requiredIds:[1,2],token:TOKEN,fetcher,...options});

test('repository routes remain unfiltered and pinned to the numeric repository',()=>{
  assert.equal(route(1),'repositories/1203919607/actions/runs?per_page=50&page=1');
  assert.equal(route(27),'repositories/1203919607/actions/runs?per_page=50&page=27');
  assert.deepEqual(LIMITS,{runs:2000,projectedRuns:1000,perPage:50,bytes:64*1024**2,pageBytes:8*1024**2,attemptMs:30000});
});
test('required anchors are exactly two distinct positive safe integers and are copied',()=>{
  const ids=[1,1324],copy=validateRequiredIds(ids);assert.deepEqual(copy,ids);assert.notEqual(copy,ids);
  for(const invalid of[undefined,null,{},[],[1],[1,2,3],[1,1],[0,2],[-1,2],[1.2,2],['1',2],[NaN,2],[Infinity,2],[Number.MAX_SAFE_INTEGER+1,2]]) {
    assert.throws(()=>validateRequiredIds(invalid),matches('invalid-required-run-anchors'));
  }
});
test('complete 1324-run inventory retains old attempts and non-main rows with bounded concurrency',async()=>{
  const f=await snapshotFixture(1324,(p,n)=>{
    if(n===1) {
      p.value.workflow_runs[0]=row(1,{run_attempt:7,event:'schedule',conclusion:'failure'});
      p.value.workflow_runs[1]=row(2,{head_branch:'preview/fixture'});
      p.value.workflow_runs[2]=row(3,{head_repository:{id:900,full_name:'fork/repo'}});
      p.value.workflow_runs[3]=row(4,{head_branch:null});
      p.value.workflow_runs[4]=row(5,{workflow_id:555,path:'dynamic/pages'});
    }
  });
  assert.equal(f.error,undefined);assert.equal(f.result.total,1324);assert.equal(f.result.runs.length,1324);
  assert.equal(f.result.pages.length,27);assert.equal(f.max,3);assert.equal(f.active,0);
  assert.deepEqual([...f.calls].sort((a,b)=>a-b),Array.from({length:27},(_,i)=>i+1));
  assert.equal(f.result.runs[0].created_at,'2020-01-01T00:00:00Z');assert.equal(f.result.runs[0].run_attempt,7);
  const statics=project(f.result.runs,STATIC),releases=project(f.result.runs,RELEASE);
  assert.equal(statics.length,660);assert.equal(releases.length,660);assert(statics.some(r=>r.id===1));assert(releases.some(r=>r.id===1324));
  assert.deepEqual(validateSnapshot(f.result.pages,[1,1324]).runs,f.result.runs);
});
test('single-page empty, short and exact full pages do not fabricate pagination',async()=>{
  for(const total of[0,1,2,50]) {
    const p=pageOf(1,total);assert.equal(validatePage(p.value,p.link,1),total);
    const f=await snapshotFixture(total,()=>{},[1,2]);assert.deepEqual(f.calls,[1]);assert.equal(f.active,0);
    if(total<2)matches('required-run-anchor-absent')(f.error);else assert.equal(f.result.total,total);
  }
});
test('repository maximum and projection maximum are independent bounds',async()=>{
  const f=await snapshotFixture(2000);assert.equal(f.error,undefined);assert.equal(f.result.pages.length,40);
  assert.equal(project(f.result.runs,STATIC).length,1000);assert.equal(project(f.result.runs,RELEASE).length,1000);
  const same=Array.from({length:1001},(_,i)=>row(i+1,{workflow_id:STATIC,path:'.github/workflows/static-site.yml'}));
  assert.equal(project(same.slice(0,1000),STATIC).length,1000);
  assert.throws(()=>project(same,STATIC),matches('projected-workflow-bound'));
  assert.throws(()=>project([],555),matches('unknown-workflow-projection'));
  const p=pageOf(1,2001);assert.throws(()=>validatePage(p.value,p.link,1),matches('invalid-inventory-schema-or-bound'));
});
test('run schema, repository identity and both directions of pinned workflow identity fail closed',()=>{
  for(const mutate of[
    p=>p.value=null,p=>p.value.workflow_runs={},p=>p.value.total_count=-1,p=>p.value.total_count=1.5,
    p=>p.value.workflow_runs.pop(),p=>p.value.workflow_runs.push(row(3)),
    p=>p.value.workflow_runs[0]=null,p=>p.value.workflow_runs[0].id=0,
    p=>p.value.workflow_runs[1].id=1,p=>p.value.workflow_runs[0].repository.id=999,
    p=>p.value.workflow_runs[0].repository.full_name='foreign/repo',
    p=>p.value.workflow_runs[0].head_repository.id=999,p=>p.value.workflow_runs[0].head_repository.full_name='foreign/repo',
    p=>p.value.workflow_runs[0].head_repository=null,p=>p.value.workflow_runs[0].head_repository.full_name='',
    p=>p.value.workflow_runs[0].path='.github/workflows/unknown.yml',p=>p.value.workflow_runs[0].workflow_id=555,
    p=>p.value.workflow_runs[0].workflow_id=RELEASE,p=>p.value.workflow_runs[0].path='.github/workflows/research-ui-release.yml',
    p=>p.value.workflow_runs[0].head_sha='A'.repeat(40),p=>p.value.workflow_runs[0].run_attempt=0,
    p=>p.value.workflow_runs[0].head_branch='',p=>p.value.workflow_runs[0].head_branch='x'.repeat(257),
    p=>p.value.workflow_runs[0].created_at='bad',p=>p.value.workflow_runs[0].updated_at='bad',
    p=>p.value.workflow_runs[0].run_started_at='bad',
  ]) {const p=pageOf(1,2);mutate(p);assert.throws(()=>validatePage(p.value,p.link,1));}
  const p=pageOf(1,2);
  for(const number of[0,-1,1.5,41,NaN])assert.throws(()=>validatePage(p.value,p.link,number),matches('invalid-page-number'));
});
test('Link validation rejects foreign origins, credentials, routes, filters, duplicates and pagination gaps',()=>{
  const p=pageOf(1,151);
  for(const bad of[
    p.link.replaceAll('api.github.com','foreign.example'),
    p.link.replaceAll('https:','http:'),
    p.link.replaceAll('api.github.com','api.github.com:444'),
    p.link.replaceAll('api.github.com','user:pass@api.github.com'),
    p.link.replace('page=2','page=2#fragment'),
    p.link.replace('per_page=50','per_page=100'),
    p.link.replace('page=2','page=3'),
    p.link.replace('page=2','page=02'),
    p.link.replace('page=2','page=2&page=2'),
    p.link.replace('page=2','page=2&branch=main'),
    p.link.replace('page=2','page=2&created=2026'),
    p.link.replace('page=2','page=2&status=completed'),
    p.link.replace('/actions/runs','/actions/workflows/'+STATIC+'/runs'),
    p.link.replace('repositories/'+RID,'repositories/999'),
    p.link+', '+p.link,
    p.link.replace('rel="next"','rel="unknown"'),
    '<not-a-url>; rel="next"','',null,'x'.repeat(8193),
  ])assert.throws(()=>validatePage(p.value,bad,1));
  const alias=p.link.replaceAll('repositories/'+RID,'repos/'+REPO);assert.equal(validatePage(p.value,alias,1),151);
  assert.throws(()=>validatePage(p.value,alias.replaceAll(REPO,'foreign/repo'),1));
  const last=pageOf(4,151);assert.throws(()=>validatePage(last.value,last.link+', <https://api.github.com/'+route(4)+'>; rel="next"',4));
});
test('snapshot validation rejects missing pages, duplicate IDs, inconsistent totals and absent anchors',async()=>{
  const pages=Array.from({length:4},(_,i)=>pageOf(i+1,151));
  assert.throws(()=>validateSnapshot(pages.slice(0,-1),[1,151]),matches('incomplete-inventory'));
  const duplicate=structuredClone(pages);duplicate[3].value.workflow_runs[0]=row(1);
  assert.throws(()=>validateSnapshot(duplicate,[1,151]),matches('invalid-or-duplicate-run'));
  const drift=structuredClone(pages);drift[1]=pageOf(2,152);
  assert.throws(()=>validateSnapshot(drift,[1,151]),matches('changing-inventory-total'));
  assert.throws(()=>validateSnapshot(pages,[1,999]),matches('required-run-anchor-absent'));
  const f=await snapshotFixture(151,(p,n)=>{if(n===4)p.value.workflow_runs[0]=row(1);});
  matches('invalid-or-duplicate-run')(f.error);assert.equal(f.result,undefined);assert.equal(f.active,0);
});
test('independently valid total drift cancels siblings, waits for settlement and never reads a later group',async()=>{
  const f=await controlledCollection();
  f.gates.get(2).resolve(pageOf(2,202));await nextTurn();
  assert.equal(f.controller.signal.aborted,true);assert.equal(f.settled,false);
  f.gates.get(3).reject(fault('sibling-aborted'));f.gates.get(4).reject(fault('sibling-aborted'));
  const result=await f.pending;matches('changing-inventory-total',true)(result.error);
  assert.equal(f.active,0);assert.deepEqual(f.calls,[1,2,3,4]);
});
test('a shrinking but individually valid empty terminal page is retryable drift',async()=>{
  const f=await controlledCollection();
  f.gates.get(4).resolve(pageOf(4,150));await nextTurn();
  f.gates.get(2).reject(fault('sibling-aborted'));f.gates.get(3).reject(fault('sibling-aborted'));
  matches('changing-inventory-total',true)((await f.pending).error);assert.equal(f.active,0);
});
test('semantic invalidity on the drifting page outranks its changed total',async()=>{
  for(const change of[
    p=>p.value.workflow_runs[0].repository.id=999,
    p=>p.value.workflow_runs[0].path='.github/workflows/other.yml',
    p=>p.link=p.link.replace('page=3','page=3&branch=main'),
    p=>p.value.workflow_runs[0]=row(1),
    p=>p.value.workflow_runs.pop(),
  ]) {
    const f=await controlledCollection(),p=pageOf(2,202);change(p);f.gates.get(2).resolve(p);await nextTurn();
    f.gates.get(3).reject(fault('sibling-aborted'));f.gates.get(4).reject(fault('sibling-aborted'));
    const result=await f.pending;assert.equal(result.error.retryable,false);assert.notEqual(result.error.inventoryReason,'changing-inventory-total');
    assert.equal(f.active,0);assert.deepEqual(f.calls,[1,2,3,4]);
  }
});
test('a later hard semantic failure wins an earlier retryable count drift',async()=>{
  const f=await controlledCollection();f.gates.get(2).resolve(pageOf(2,202));await nextTurn();
  const bad=pageOf(3,201);bad.value.workflow_runs[0].repository.id=999;
  f.gates.get(3).resolve(bad);f.gates.get(4).reject(fault('sibling-aborted'));
  matches('foreign-repository-run')((await f.pending).error);assert.equal(f.active,0);
});
test('security denial wins retryable transport, JSON EOF and drift regardless of settle order',async()=>{
  for(const earlier of['transport-or-json-eof','json-eof','changing-inventory-total']) {
    for(const denialFirst of[false,true]) {
      const f=await controlledCollection();
      f.gates.get(denialFirst?3:2).reject(fault(denialFirst?'http-or-security-denial':earlier,!denialFirst));
      await nextTurn();assert.equal(f.settled,false);
      f.gates.get(denialFirst?2:3).reject(fault(denialFirst?earlier:'http-or-security-denial',denialFirst));
      f.gates.get(4).reject(fault('sibling-aborted'));
      matches('http-or-security-denial')((await f.pending).error);assert.equal(f.active,0);assert.deepEqual(f.calls,[1,2,3,4]);
    }
  }
});
test('transport classification considers nested causes and gives security evidence precedence',()=>{
  for(const error of[
    Error('ECONNRESET certificate verification failed'),
    Object.assign(Error('fetch failed'),{cause:Object.assign(Error('TLS handshake failed'),{code:'ECONNRESET'})}),
    Object.assign(Error('unexpected EOF HTTP 403'),{code:'ETIMEDOUT'}),
    Error('401 unauthorised'),Error('retry-after'),Error('SSO required'),
  ])matches('http-or-security-denial')(classifyTransport(error,{aborted:true,timedOut:true}));
  matches('transport-or-json-eof',true)(classifyTransport(Object.assign(Error('fetch failed'),{cause:{code:'UND_ERR_SOCKET'}})));
  matches('transport-timeout',true)(classifyTransport(Object.assign(Error('fetch failed'),{cause:{code:'UND_ERR_HEADERS_TIMEOUT'}})));
  matches('transport-timeout',true)(classifyTransport(Error('aborted'),{timedOut:true,aborted:true}));
  matches('sibling-aborted')(classifyTransport(Error('aborted'),{aborted:true}));
  matches('unclassified-transport-failure')(classifyTransport(Error('fixture-private-diagnostic')));
});
test('native reader uses one fixed host, no redirects, no cache and a shared abort signal',async()=>{
  const calls=[],signals=new Set();let active=0,max=0;
  const value=await readSnapshot(async(url,options)=>{
    const n=requestedPage(url);calls.push(n);signals.add(options.signal);
    assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
    assert.equal(options.headers.Authorization,'Bearer '+TOKEN);assert.equal(options.headers.Accept,'application/vnd.github+json');
    active++;max=Math.max(max,active);try{await nextTurn();return responseOf(n,1324);}finally{active--;}
  },{requiredIds:[1,1324]});
  assert.equal(value.status,'complete');assert.equal(value.pages.length,27);assert.equal(value.evidence.length,27);
  assert.equal(signals.size,1);assert.equal(max,3);assert.equal(active,0);
  assert.deepEqual([...calls].sort((a,b)=>a-b),Array.from({length:27},(_,i)=>i+1));
  assert.equal(validateSnapshot(value.pages,[1,1324]).total,1324);
  assert.equal(value.body_bytes,value.evidence.reduce((sum,p)=>sum+p.body_bytes,0));
  assert(value.evidence.every(p=>p.status===200&&/^[a-f0-9]{64}$/.test(p.body_sha256)&&/^[a-f0-9]{64}$/.test(p.ids_sha256)));
});
test('invalid native reader config is a bounded failure envelope without network reads',async()=>{
  const variants=[
    [{requiredIds:[]},'invalid-required-run-anchors'],
    [{requiredIds:[1,1]},'invalid-required-run-anchors'],
    [{timeoutMs:0},'invalid-inventory-time-budget'],
    [{timeoutMs:30001},'invalid-inventory-time-budget'],
    [{timeoutMs:1.5},'invalid-inventory-time-budget'],
    [{token:''},'missing-actions-token'],
  ];
  for(const [options,reason]of variants) {
    let calls=0;const result=await readSnapshot(async()=>{calls++;throw Error('unexpected read');},options);
    failed(result,reason);assert.equal(calls,0);assert.equal(result.body_bytes,0);
  }
});
test('HTTP, quota and redirect denials never read or expose the body',async()=>{
  for(const options of[
    {status:301},{status:401},{status:403},{status:404},{status:429},{status:500},
    {redirected:true},{headers:{'retry-after':'tomorrow'}},{headers:{'x-ratelimit-remaining':'0'}},
  ]) {
    let consumed=false,calls=0;
    const result=await readSnapshot(async()=>{calls++;return responseOf(1,2,{...options,body:(async function*(){
      consumed=true;yield Buffer.from('fixture-private-payload');
    })()});});
    failed(result,'http-or-security-denial');assert.equal(calls,1);assert.equal(consumed,false);assert.equal(result.body_bytes,0);
  }
});
test('sanitized diagnostics expose only bounded numeric headers and hashes',async()=>{
  const raw='{"fixture-private-payload":';
  const result=await readSnapshot(async()=>responseOf(1,2,{raw,headers:{
    'authorization':'Bearer '+TOKEN,'set-cookie':'fixture-private-payload','x-secret':'fixture-private-payload',
    'x-github-request-id':'SAFE:123','x-ratelimit-remaining':'9','x-ratelimit-reset':'invalid-secret',
  }}));
  failed(result,'json-eof',true);assert.equal(result.evidence.length,1);
  assert.deepEqual(result.evidence[0].safe_headers,{'x-github-request-id':'SAFE:123','x-ratelimit-remaining':'9'});
  assert.equal(result.evidence[0].body_bytes,Buffer.byteLength(raw));assert.equal(result.evidence[0].body_sha256,digest(raw));
});
test('malformed JSON, invalid UTF-8, missing streams and non-byte chunks fail closed',async()=>{
  for(const [options,reason,retryable]of[
    [{raw:'{"total_count":'},'json-eof',true],
    [{raw:'{"text":"unterminated'},'json-eof',true],
    [{raw:'{"bad": tru}'},'invalid-json',false],
    [{raw:Buffer.from([0xff,0xfe])},'invalid-json-encoding',false],
    [{body:{}},'invalid-response-body',false],
    [{body:(async function*(){yield 'not bytes';})()},'invalid-response-body',false],
  ])failed(await readSnapshot(async()=>responseOf(1,2,options)),reason,retryable);
});
test('thrown transport errors are sanitized and forged reason text is not trusted',async()=>{
  for(const error of[
    Error('fixture-private-diagnostic '+TOKEN),
    Object.assign(Error('fixture-private-diagnostic'),{inventoryReason:'fixture-private-payload '+TOKEN,retryable:true}),
    {message:'fixture-private-diagnostic',inventoryReason:{secret:TOKEN},retryable:true},
  ])failed(await readSnapshot(async()=>{throw error;}),'unclassified-transport-failure');
});
test('native reader waits for aborted siblings and preserves a late HTTP denial over EOF',async()=>{
  const calls=[],gates=new Map();let active=0,aborts=0;
  const pending=readSnapshot(async(url,options)=>{
    const n=requestedPage(url);calls.push(n);if(n===1)return responseOf(1,201);
    active++;const gate=deferred();gates.set(n,gate);
    if(n===4)options.signal.addEventListener('abort',()=>{aborts++;gate.reject(Error('cancelled'));},{once:true});
    try{return await gate.promise;}finally{active--;}
  },{requiredIds:[1,201]});
  await nextTurn();assert.deepEqual(calls,[1,2,3,4]);
  gates.get(2).resolve(responseOf(2,201,{raw:'{"total_count":'}));await nextTurn();
  assert.equal(aborts,1);assert.equal(active,1);
  gates.get(3).resolve(responseOf(3,201,{status:403,raw:'fixture-private-payload'}));
  failed(await pending,'http-or-security-denial');assert.equal(active,0);assert.deepEqual(calls,[1,2,3,4]);
});
test('native deadline aborts all fetches in flight and resolves a classified failure', {timeout:5000},async()=>{
  let active=0,aborts=0;const calls=[];
  const result=await readSnapshot(async(url,options)=>{
    const n=requestedPage(url);calls.push(n);if(n===1)return responseOf(1,201);
    active++;
    try {return await new Promise((resolve,reject)=>{
      const aborted=()=>{aborts++;reject(new DOMException('fixture-private-diagnostic','AbortError'));};
      if(options.signal.aborted)aborted();else options.signal.addEventListener('abort',aborted,{once:true});
    });}finally{active--;}
  },{timeoutMs:30,requiredIds:[1,201]});
  failed(result,'transport-timeout',true);assert.deepEqual(calls,[1,2,3,4]);assert.equal(aborts,3);assert.equal(active,0);
});
test('per-page byte cap stops streaming and discards partial output',async()=>{
  let chunks=0,closed=false;
  const result=await readSnapshot(async()=>responseOf(1,2,{body:(async function*(){
    try {chunks++;yield Buffer.alloc(LIMITS.pageBytes);chunks++;yield Buffer.from('x');chunks++;yield Buffer.from('must not read');}
    finally{closed=true;}
  })()}));
  failed(result,'byte-limit');assert.equal(chunks,2);assert.equal(closed,true);
  assert.equal(result.body_bytes,LIMITS.pageBytes+1);assert.equal(result.evidence[0].body_bytes,LIMITS.pageBytes+1);
});
test('aggregate byte cap stops the bounded page group before reading all 2000 runs',async()=>{
  const calls=[];let active=0;
  const padding='x'.repeat(2*1024**2);
  const result=await readSnapshot(async(url)=>{
    const n=requestedPage(url);calls.push(n);active++;
    try {await nextTurn();const p=pageOf(n,2000);p.value.padding=padding;return responseOf(n,2000,{value:p.value});}
    finally{active--;}
  },{requiredIds:[1,2000]});
  failed(result,'byte-limit');assert(result.body_bytes>LIMITS.bytes);assert(calls.length<40);assert.equal(active,0);
});

test('returned response URLs cannot switch origin, repository, endpoint or query',async()=>{
  for(const url of[
    'https://foreign.example/'+route(1),
    'http://api.github.com/'+route(1),
    'https://api.github.com/repositories/999/actions/runs?per_page=50&page=1',
    'https://api.github.com/repositories/'+RID+'/actions/workflows/'+STATIC+'/runs?per_page=50&page=1',
    'https://api.github.com/'+route(1)+'&branch=main',
  ])failed(await readSnapshot(async()=>responseOf(1,2,{url})),'response-origin-or-route');
  assert.equal((await readSnapshot(async()=>responseOf(1,2,{url:''}))).status,'complete');
});
test('serialized output is independently capped even when every body and aggregate body bytes fit', {timeout:30000},async()=>{
  const target=LIMITS.pageBytes-64,total=400;
  const result=await readSnapshot(async url=>{
    const n=requestedPage(url),p=pageOf(n,total);
    p.value.padding='';
    p.value.padding='x'.repeat(target-Buffer.byteLength(JSON.stringify(p.value)));
    assert.equal(Buffer.byteLength(JSON.stringify(p.value)),target);
    return responseOf(n,total,{value:p.value});
  },{requiredIds:[1,total]});
  failed(result,'byte-limit');assert.equal(result.evidence.length,8);
  assert.equal(result.body_bytes,target*8);assert(result.body_bytes<=LIMITS.bytes);
});
