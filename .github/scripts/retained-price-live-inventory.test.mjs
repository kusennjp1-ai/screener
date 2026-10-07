import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRetainedPriceLiveApi,LIVE_INVENTORY_LIMITS} from './retained-price-live-inventory.mjs';
import {createImmutableGitApi} from './immutable-github-api.mjs';
import {latestDeployment} from './publication-state.mjs';

const repo='kusennjp1-ai/screener',prefix=`repos/${repo}`;
const publisher=`${prefix}/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100`;
const producer=`${prefix}/actions/workflows/static-site.yml/runs?branch=main&per_page=100`;
const sha=value=>createHash('sha256').update(value).digest('hex');
function run(id=1,workflow='research-ui-release.yml'){
  return {id,workflow_id:workflow==='research-ui-release.yml'?364666954:294257497,path:'.github/workflows/'+workflow,head_branch:'main',
    repository:{id:1203919607,full_name:repo},head_repository:{id:1203919607,full_name:repo},run_attempt:1,head_sha:'a'.repeat(40),
    updated_at:'2026-10-07T16:00:00Z',run_started_at:'2026-10-07T15:59:00Z',untouched_extra:{literal:true}};
}
const page=(runs,total=runs.length)=>({total_count:total,workflow_runs:runs});
const link=(endpoint,n,rel='next')=>`<https://api.github.com/${endpoint}&page=${n}>; rel="${rel}"`;
const http=(value,links='',ending='\r\n')=>`HTTP/2.0 200 OK${ending}Content-Type: application/json; charset=utf-8${ending}${links?'Link: '+links+ending:''}${ending}${typeof value==='string'?value:JSON.stringify(value)}`;
const commandError=(stderr,stdout='',extra={})=>Object.assign(Error('fixture gh failed'),{status:1,stderr,stdout,...extra});
function fixture(sequence,{clock=()=>0,api=()=>{throw Error('Unexpected delegated API');}}={}){
  const calls=[],events=[];
  const read=createRetainedPriceLiveApi(api,{monotonic:clock,report:e=>events.push(e),run:(command,args,options)=>{
    calls.push({command,args,options});const value=sequence.shift();if(value instanceof Error)throw value;
    return typeof value==='function'?value():value;
  }});
  return {read,calls,events};
}

test('complete inventories preserve every object and accept exact GitHub Link/header syntax',()=>{
  const first=Array.from({length:100},(_,i)=>run(i+1)),last=[run(101)];
  const pages=[page(first,101),page(last,101)];
  const f=fixture([http(pages[0],link(publisher,2)+', '+link(publisher,2,'last')),http(pages[1],link(publisher,1,'prev')+', '+link(publisher,1,'first'),'\n')]);
  assert.deepEqual(f.read(publisher,true),pages);
  assert.deepEqual(f.calls.map(c=>c.args),[['api','--include',publisher],['api','--include',publisher+'&page=2']]);
  for(const c of f.calls){assert.equal(c.command,'gh');assert.equal(c.options.timeout,30000);assert.equal(c.options.killSignal,'SIGKILL');assert.deepEqual(c.options.stdio,['ignore','pipe','pipe']);}
  assert(f.calls[1].options.maxBuffer<f.calls[0].options.maxBuffer);
  assert.equal(f.events[0].inventory_sha256,sha(JSON.stringify(pages)));assert.equal(f.events[0].total_count,101);
});

test('EOF after partial page restarts page1 and returns only freshly fetched pages',()=>{
  const old=page(Array.from({length:100},(_,i)=>run(i+1)),101),fresh=page([run(900)]);
  const f=fixture([http(old,link(publisher,2)),commandError('unexpected end of JSON input','partial-secret-token'),http(fresh)]);
  assert.deepEqual(f.read(publisher,true),[fresh]);
  assert.deepEqual(f.calls.map(c=>c.args[2]),[publisher,publisher+'&page=2',publisher]);
  assert.deepEqual(f.events.map(e=>[e.status,e.attempt]),[['failed',1],['complete',2]]);
  assert.equal(f.events[0].failed_stdout.sha256,sha('partial-secret-token'));assert.equal(f.events[0].exit_code,1);
  assert.equal(f.events[0].failed_stderr.bytes,Buffer.byteLength('unexpected end of JSON input'));
  assert.equal(f.events[0].call_id,f.events[1].call_id);assert(!JSON.stringify(f.events).includes('partial-secret-token'));
});

test('truncated successful JSON gets one complete fresh read; malformed JSON does not',()=>{
  for(const truncated of ['{"total_count":','{"total_count":1,"workflow_runs":[{"id":"']){
    const f=fixture([http(truncated),http(page([run()]))]);assert.equal(f.read(publisher,true)[0].workflow_runs.length,1);assert.equal(f.calls.length,2);
  }
  const f=fixture([http('{bad-json'),http(page([]))]);assert.throws(()=>f.read(publisher,true),/invalid-json/);assert.equal(f.calls.length,1);
});

test('repeated EOF is terminal after two attempts with sanitized independent evidence',()=>{
  const f=fixture([commandError('unexpected EOF token-secret'),commandError('unexpected EOF token-secret'),http(page([]))]);
  assert.throws(()=>f.read(publisher,true),/transport-or-json-eof/);assert.equal(f.calls.length,2);assert.equal(f.events[1].retry,false);
  assert(!JSON.stringify(f.events).includes('token-secret'));
});

test('auth, HTTP, rate-limit, TLS and security denials win over EOF and never retry',()=>{
  for(const text of ['HTTP 401','HTTP/2.0 403 Forbidden','HTTP 429','API rate limit exceeded','secondary rate limit','Retry-After: 10','authentication required','authorization denied','x509 certificate error','TLS handshake failure','SSL failure','SSO required','security block','HTTP 502']){
    const f=fixture([commandError('unexpected EOF\n'+text),http(page([]))]);
    assert.throws(()=>f.read(publisher,true),/http-or-security-denial/,text);assert.equal(f.calls.length,1,text);
  }
  const f=fixture([`HTTP/2.0 403 Forbidden\r\n\r\n{"message":"unexpected EOF"}`]);assert.throws(()=>f.read(publisher,true),/http-or-security-denial/);assert.equal(f.calls.length,1);
  const status=fixture([commandError('unexpected EOF','HTTP/2.0 403 Forbidden\r\nX-RateLimit-Remaining: 0\r\nX-RateLimit-Limit: 60\r\nX-RateLimit-Reset: 1791399600\r\nRetry-After: 120\r\nX-GitHub-Request-Id: ABCD:1234:FF\r\nAuthorization: token-secret\r\nSet-Cookie: cookie-secret\r\n\r\n{}')]);
  assert.throws(()=>status.read(publisher,true),/http-or-security-denial/);
  assert.deepEqual(status.events[0].http,{status:403,retry_after_present:true,rate_limit_remaining:0,rate_limit_limit:60,rate_limit_reset:1791399600,retry_after_seconds:120,request_id:'ABCD:1234:FF'});
  assert(!JSON.stringify(status.events).includes('token-secret'));assert(!JSON.stringify(status.events).includes('cookie-secret'));
});

test('positive GitHub quota headers permit EOF retry but exhausted quota and Retry-After never do',()=>{
  const partial='HTTP/2.0 200 OK\r\nStrict-Transport-Security: max-age=31536000; includeSubdomains; preload\r\nX-RateLimit-Limit: 5000\r\nX-RateLimit-Remaining: 4980\r\nX-GitHub-Request-Id: ABCD:1234\r\n\r\n{"total_count":';
  for(const first of [commandError('unexpected EOF',partial),partial]){
    const f=fixture([first,http(page([run()]))]);assert.equal(f.read(publisher,true).length,1);assert.equal(f.calls.length,2);
    assert.equal(f.events[0].http.rate_limit_remaining,4980);assert.equal(f.events[0].retry,true);
  }
  for(const denied of [partial.replace('Remaining: 4980','Remaining: 0'),partial.replace('\r\n\r\n','\r\nRetry-After: 60\r\n\r\n'),partial.replace('\r\n\r\n','\r\nRetry-After: Wed, 07 Oct 2026 17:10:00 GMT\r\n\r\n')]){
    for(const first of [commandError('unexpected EOF',denied),denied]){
      const f=fixture([first,http(page([]))]);assert.throws(()=>f.read(publisher,true),/http-or-security-denial/);assert.equal(f.calls.length,1);assert.equal(f.events[0].retry,false);
    }
  }
});

test('multiple or malformed HTTP header blocks cannot hide a final denial behind HTTP200',()=>{
  for(const final of ['HTTP/2.0 403 Forbidden','HTTP/2.0 429 Too Many Requests','HTTP/2.0 200 OK','HTTP/2.0 malformed']){
    const raw=`HTTP/2.0 200 OK\r\nX-RateLimit-Remaining: 4980\r\n\r\n${final}\r\n\r\n{"total_count":`;
    for(const first of [raw,commandError('unexpected EOF',raw)]){
      const f=fixture([first,http(page([]))]);assert.throws(()=>f.read(publisher,true),/ambiguous-http-headers|http-or-security-denial/);assert.equal(f.calls.length,1);assert.equal(f.events[0].http.ambiguous_headers,true);
      if(/403|429/.test(final))assert.equal(f.events[0].http.status,Number(final.split(' ')[1]));
    }
  }
  const f=fixture([http(page([{...run(),display_title:'HTTP/2.0 403 Forbidden'}]))]);assert.equal(f.read(publisher,true).length,1);
});

test('an innocent security-related run title in partial HTTP200 stdout is not an authorization denial',()=>{
  const body='HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"workflow_runs":[{"display_title":"security fix for TLS issue403",';
  const f=fixture([commandError('unexpected EOF',body),http(page([run()]))]);assert.equal(f.read(publisher,true).length,1);assert.equal(f.calls.length,2);
  for(const code of [403,429]){
    const denied=fixture([commandError('unexpected EOF',`HTTP/2.0 ${code} Forbidden\r\nRetry-After: 10\r\n\r\n{"message":`)]);
    assert.throws(()=>denied.read(publisher,true),/http-or-security-denial/);assert.equal(denied.calls.length,1);
    const partialHeader=fixture([commandError('unexpected EOF',`HTTP/2.0 ${code}`)]);
    assert.throws(()=>partialHeader.read(publisher,true),/http-or-security-denial/);assert.equal(partialHeader.calls.length,1);
  }
});

test('valid JSON incomplete, inconsistent, duplicate or invalid identity inventories stop without retry',()=>{
  const hundred=Array.from({length:100},(_,i)=>run(i+1));
  const cases=[
    [http(page([],1))],[http({workflow_runs:[]})],[http({total_count:'0',workflow_runs:[]})],
    [http(page([run(1),run(1)]))],[http(page([run(1)],1001))],
    [http(page(hundred,101),link(publisher,2)),http(page([run(101)],102))],
    [http(page(hundred,101),link(publisher,2)),http(page([run(1)],101))],
    [http(page(hundred,101))],
  ];
  for(const change of [{id:0},{head_sha:'broken'},{updated_at:null},{run_attempt:0},{head_branch:'elsewhere'},{workflow_id:1},{path:'.github/workflows/other.yml'},{repository:{id:1,full_name:repo}},{head_repository:{id:1203919607,full_name:'foreign/repo'}}])cases.push([http(page([{...run(),...change}]))]);
  for(const sequence of cases){const count=sequence.length,f=fixture(sequence);assert.throws(()=>f.read(publisher,true),/rejected/);assert.equal(f.calls.length,count);assert.equal(f.events.at(-1).retry,false);}
});

test('GitHub search cap is never silently accepted as a partial list',()=>{
  const sequence=Array.from({length:10},(_,i)=>http(page(Array.from({length:100},(_,j)=>run(i*100+j+1)),1000),i<9?link(publisher,i+2):''));
  const f=fixture(sequence);assert.equal(f.read(publisher,true).flatMap(p=>p.workflow_runs).length,1000);assert.equal(f.calls.length,10);
  const capped=fixture([http(page(Array.from({length:100},(_,j)=>run(j+1)),1001),link(publisher,2))]);
  assert.throws(()=>capped.read(publisher,true),/github-search-cap/);assert.equal(capped.calls.length,1);
});

test('foreign, malformed, duplicate, looping, query-changing and superfluous Link pages are terminal',()=>{
  const hundred=page(Array.from({length:100},(_,i)=>run(i+1)),101);
  for(const bad of [link(publisher,2).replace('api.github.com','evil.example'),link(publisher,2).replace('https:','http:'),link(publisher,2).replace('/runs?','/other?'),link(publisher,1),link(publisher,3),link(publisher,2)+', '+link(publisher,2),link(publisher,2).replace('branch=main','branch=other'),link(publisher,2).replace('&page=2','&page=2&token=secret'),link(publisher,2).replace('api.github.com','user:secret@api.github.com'),'not a link']){
    const f=fixture([http(hundred,bad)]);assert.throws(()=>f.read(publisher,true),/pagination/);assert.equal(f.calls.length,1);
  }
  const extra=fixture([http(page([]),link(publisher,1))]);assert.throws(()=>extra.read(publisher,true),/incomplete-pagination/);
});

test('canonical numeric GitHub pagination aliases are bound to exact repository and workflow IDs',()=>{
  const first=page(Array.from({length:100},(_,i)=>run(i+1)),101),last=page([run(101)],101);
  for(const repoPath of [`repos/${repo}`,'repositories/1203919607'])for(const workflow of ['research-ui-release.yml','364666954']){
    const alias=`${repoPath}/actions/workflows/${workflow}/runs?branch=main&per_page=100`,f=fixture([http(first,link(alias,2)),http(last)]);
    assert.equal(f.read(publisher,true).length,2);assert.equal(f.calls[1].args[2],alias+'&page=2');
  }
  for(const alias of ['repositories/999/actions/workflows/364666954/runs?branch=main&per_page=100',`${prefix}/actions/workflows/294257497/runs?branch=main&per_page=100`]){
    const f=fixture([http(first,link(alias,2))]);assert.throws(()=>f.read(publisher,true),/pagination-origin-or-route/);assert.equal(f.calls.length,1);
  }
});

test('all other endpoints and nonpagination reads are delegated unchanged without retries',()=>{
  const observed=[],error=Error('unexpected EOF'),f=fixture([],{api:(...args)=>{observed.push(args);throw error;}});
  for(const args of [[publisher,false],[producer+'&page=2',true],[publisher.replace('main','other'),true],[`${prefix}/actions/runs/1/jobs?filter=all&per_page=100`,true],[`${prefix}/git/ref/heads/main`,false]]){
    assert.throws(()=>f.read(...args),e=>e===error);
  }
  assert.equal(observed.length,5);assert.equal(f.calls.length,0);assert.equal(f.events.length,0);
});

test('timeout after a partial page cannot reuse it, and shares 60s across both inventories',()=>{
  let clock=0;
  const f=fixture([http(page(Array.from({length:100},(_,i)=>run(i+1)),101),link(publisher,2)),()=>{clock=30000;throw commandError('timeout','partial',{code:'ETIMEDOUT',status:null,signal:'SIGKILL'});},()=>{clock=50000;return http(page([run(900)]));},()=>{clock=60000;throw commandError('timeout','',{code:'ETIMEDOUT',status:null,signal:'SIGKILL'});} ],{clock:()=>clock});
  assert.equal(f.read(publisher,true)[0].workflow_runs[0].id,900);
  assert.throws(()=>f.read(producer,true),/transport-timeout/);assert.equal(f.calls.at(-1).options.timeout,10000);assert.equal(f.calls.length,4);
  assert.equal(f.events.at(-1).retry,false);assert.equal(f.events.at(-1).signal,'SIGKILL');
});

test('real synchronous child termination uses the remaining attempt budget and SIGKILL',()=>{
  let tick=0,calls=0;
  const read=createRetainedPriceLiveApi(()=>{}, {monotonic:()=>[0,29990,60000][Math.min(tick++,2)],report:()=>{},run:(_command,_args,options)=>{
    calls++;assert.equal(options.timeout,10);return execFileSync(process.execPath,['-e','setInterval(()=>{},1000)'],options);
  }});
  assert.throws(()=>read(publisher,true),/transport-timeout/);assert.equal(calls,1);
});

test('unrelated approval time does not spend inventory budget or erase the used allowance',()=>{
  let clock=0;
  const f=fixture([()=>{clock+=20000;return http(page([run(1)]));},()=>{clock+=20000;return http(page([run(2)]));},()=>{clock+=20000;return http(page([]));}],{
    clock:()=>clock,api:()=>{clock+=107000;return {approved:true};}});
  assert.equal(f.read(publisher,true)[0].workflow_runs[0].id,1);f.read(`${prefix}/actions/runs/1/attempts/1`);
  assert.equal(f.read(publisher,true)[0].workflow_runs[0].id,2);assert.equal(f.calls[1].options.timeout,30000);
  f.read(producer,true);assert.equal(f.calls[2].options.timeout,20000);
  assert.throws(()=>f.read(publisher,true),/time-budget-exhausted/);assert.equal(f.calls.length,3);
  assert.deepEqual(f.events.filter(e=>e.status==='complete').map(e=>e.inventory_budget_used_ms),[20000,40000,60000]);
});

test('aggregate bytes and unclassified command failures are terminal',()=>{
  const f=fixture([commandError('buffer failure','',{code:'ENOBUFS'}),http(page([]))]);assert.throws(()=>f.read(publisher,true),/byte-limit/);assert.equal(f.calls.length,1);
  const unknown=fixture([commandError('unknown backend problem'),http(page([]))]);assert.throws(()=>unknown.read(publisher,true),/unclassified-command-failure/);assert.equal(unknown.calls.length,1);
  assert.equal(LIVE_INVENTORY_LIMITS.bytes,64*1024**2);assert.equal(LIVE_INVENTORY_LIMITS.attempts,2);
});

test('immutable cache remains usable while every workflow inventory is read fresh',()=>{
  const commit='b'.repeat(40),endpoint=`${prefix}/git/commits/${commit}`;let immutableReads=0;
  const base=createImmutableGitApi(()=>{immutableReads++;return {sha:commit,tree:{sha:'c'.repeat(40)},parents:[]};},repo);
  const f=fixture([http(page([run(1)])),http(page([run(2)]))],{api:base});
  assert.equal(f.read(endpoint).sha,commit);assert.equal(f.read(endpoint).sha,commit);assert.equal(immutableReads,1);
  assert.equal(f.read(publisher,true)[0].workflow_runs[0].id,1);assert.equal(f.read(publisher,true)[0].workflow_runs[0].id,2);
  assert.equal(f.calls.length,2);assert.notEqual(f.events[0].call_id,f.events[1].call_id);
});

test('latestDeployment sees a changed fresh winner and still rejects ambiguous deployments',()=>{
  const stamp='2026-10-07T16:00:00Z',jobs=id=>[{jobs:[{run_attempt:1,started_at:'2026-10-07T15:59:00Z',steps:[{name:'Deploy to GitHub Pages',conclusion:'success',started_at:'2026-10-07T15:59:30Z',completed_at:stamp}]}]}];
  const sequence=[http(page([run(1)])),http(page([])),http(page([run(2)])),http(page([])),http(page([run(2),run(3)])),http(page([]))];
  const f=fixture(sequence,{api:(endpoint,paginate)=>{assert.equal(paginate,true);assert.match(endpoint,/\/actions\/runs\/[123]\/jobs\?filter=all&per_page=100$/);return jobs();}});
  assert.equal(latestDeployment(repo,f.read).runId,1);assert.equal(latestDeployment(repo,f.read).runId,2);
  assert.throws(()=>latestDeployment(repo,f.read),/ambiguous publication order/);assert.equal(f.calls.length,6);
});

test('only the finite driver liveFor seam and focused CI list opt into recovery',()=>{
  const driver=readFileSync(new URL('./retained-price-source-driver.mjs',import.meta.url),'utf8');
  assert.equal((driver.match(/createRetainedPriceLiveApi\(o.api\)/g)||[]).length,1);
  assert.match(driver,/async function liveFor\(o\)\{\s*const api=createRetainedPriceLiveApi\(o.api\)/);
  for(const name of ['publication-gate.mjs','retained-price-ci-admission.mjs','retained-price-source-admission.mjs','immutable-github-api.mjs'])assert(!readFileSync(new URL('./'+name,import.meta.url),'utf8').includes('retained-price-live-inventory'));
  assert(readFileSync(new URL('../workflows/ci.yml',import.meta.url),'utf8').includes('retained-price-live-inventory.test.mjs'));
});


test('isolated total growth discards the whole attempt and records both totals',()=>{
  const first=page(Array.from({length:100},(_,i)=>run(i+1)),101);
  const changed=page([run(101),run(102)],102),fresh=page([run(900)]);
  const f=fixture([http(first,link(publisher,2)),http(changed),http(fresh)]);
  assert.deepEqual(f.read(publisher,true),[fresh]);
  assert.deepEqual(f.calls.map(c=>c.args[2]),[publisher,publisher+'&page=2',publisher]);
  assert.deepEqual(f.events.map(e=>[e.status,e.attempt,e.retry]),[['failed',1,true],['complete',2,undefined]]);
  const e=f.events[0].page_evidence[1];
  assert.equal(e.page_number,2);assert.equal(e.requested_route,publisher+'&page=2');
  assert.equal(e.expected_total,101);assert.equal(e.observed_total,102);assert.equal(e.row_count,2);
  assert.equal(e.ids_sha256,sha(JSON.stringify([101,102])));
  assert.equal(e.body_bytes,Buffer.byteLength(JSON.stringify(changed)));
  assert.equal(e.body_sha256,sha(JSON.stringify(changed)));
  assert.equal(f.events[1].page_evidence[0].expected_total,null);
  assert.equal(f.events[1].call_id,f.events[0].call_id);
});

test('isolated total shrink including an empty former final page restarts page1',()=>{
  for(const [initial,total,rows]of [[102,101,[run(101)]],[101,100,[]]]){
    const first=page(Array.from({length:100},(_,i)=>run(i+1)),initial),fresh=page([run(700)]);
    const f=fixture([http(first,link(publisher,2)),http(page(rows,total),link(publisher,1,'prev')),http(fresh)]);
    assert.deepEqual(f.read(publisher,true),[fresh]);assert.equal(f.calls.length,3);
    assert.equal(f.events[0].reason,'changing-inventory-total');assert.equal(f.events[0].retry,true);
    assert.equal(f.events[0].page_evidence[1].observed_total,total);
  }
});

test('a restarted multi-page inventory must be complete and may reuse discarded IDs',()=>{
  const first=page(Array.from({length:100},(_,i)=>run(i+1)),101);
  const changed=page([run(101),run(102)],102),last=page([run(101)],101);
  const f=fixture([http(first,link(publisher,2)),http(changed),http(first,link(publisher,2)),http(last)]);
  assert.deepEqual(f.read(publisher,true),[first,last]);assert.equal(f.calls.length,4);
  assert.equal(f.events[1].total_count,101);assert.equal(f.events[1].pages,2);
  assert.equal(f.events[1].inventory_sha256,sha(JSON.stringify([first,last])));
});

test('repeated valid total drift exhausts exactly two whole attempts',()=>{
  const first=page(Array.from({length:100},(_,i)=>run(i+1)),101),changed=page([run(101),run(102)],102);
  const f=fixture([http(first,link(publisher,2)),http(changed),http(first,link(publisher,2)),http(changed),http(page([]))]);
  assert.throws(()=>f.read(publisher,true),/changing-inventory-total/);
  assert.equal(f.calls.length,4);assert.deepEqual(f.events.map(e=>e.retry),[true,false]);
  assert.deepEqual(f.calls.map(c=>c.args[2]),[publisher,publisher+'&page=2',publisher,publisher+'&page=2']);
});

test('invalid rows identities duplicates or Links accompanying drift remain terminal',()=>{
  const first=page(Array.from({length:100},(_,i)=>run(i+1)),101);
  const changes=[
    http(page([run(101)],102)),
    http(page([{...run(101),head_branch:'foreign'},run(102)],102)),
    http(page([{...run(101),workflow_id:294257497},run(102)],102)),
    http(page([{...run(101),repository:{id:1,full_name:repo}},run(102)],102)),
    http(page([run(1),run(102)],102)),
    http(page([run(101),run(101)],102)),
    http(page([run(101),run(102)],102),link(publisher,3)),
    http(page([run(101),run(102)],102),link(publisher,1,'prev').replace('api.github.com','foreign.example')),
    http({total_count:'102',workflow_runs:[run(101),run(102)]}),
    http(page([run(101),run(102)],1001)),
  ];
  for(const changed of changes){
    const f=fixture([http(first,link(publisher,2)),changed,http(page([]))]);
    assert.throws(()=>f.read(publisher,true),/rejected/);assert.equal(f.calls.length,2);
    assert.equal(f.events[0].retry,false);assert.notEqual(f.events[0].reason,'changing-inventory-total');
    assert.equal(f.events[0].page_evidence.length,2);
  }
});

test('authorization quota and Retry-After signals accompanying drift never retry',()=>{
  const first=page(Array.from({length:100},(_,i)=>run(i+1)),101),changed=http(page([run(101),run(102)],102));
  for(const denied of [changed.replace('200 OK','403 Forbidden'),changed.replace('200 OK','429 Too Many Requests'),
    changed.replace('\r\n\r\n','\r\nX-RateLimit-Remaining: 0\r\n\r\n'),
    changed.replace('\r\n\r\n','\r\nRetry-After: 3\r\n\r\n')]){
    const f=fixture([http(first,link(publisher,2)),denied,http(page([]))]);
    assert.throws(()=>f.read(publisher,true),/http-or-security-denial/);assert.equal(f.calls.length,2);assert.equal(f.events[0].retry,false);
  }
});

test('an incomplete fresh retry cannot return partial pages or trigger a third attempt',()=>{
  const first=page(Array.from({length:100},(_,i)=>run(i+1)),101),changed=page([run(101),run(102)],102);
  for(const badFresh of [http(page([run(800)],2)),http(first)]){
    const f=fixture([http(first,link(publisher,2)),http(changed),badFresh,http(page([]))]);
    assert.throws(()=>f.read(publisher,true),/incomplete-inventory|incomplete-pagination/);
    assert.equal(f.calls.length,3);assert.deepEqual(f.events.map(e=>e.retry),[true,false]);
  }
});

test('page diagnostics bound ID work and do not echo malformed payload strings',()=>{
  const huge=page(Array.from({length:101},(_,i)=>({...run(i+1),display_title:'PRIVATE_PAYLOAD_MARKER'})),101);
  const f=fixture([http(huge)]);
  assert.throws(()=>f.read(publisher,true),/incomplete-inventory/);
  const e=f.events[0].page_evidence[0];
  assert.equal(e.row_count,101);assert.equal(e.ids_sha256,null);assert.equal(e.body_sha256,sha(JSON.stringify(huge)));
  assert(!JSON.stringify(f.events).includes('PRIVATE_PAYLOAD_MARKER'));
  const invalid={total_count:'PRIVATE_TOTAL_MARKER',workflow_runs:[{id:'PRIVATE_ID_MARKER'}]};
  const g=fixture([http(invalid)]);assert.throws(()=>g.read(publisher,true),/invalid-inventory-schema/);
  assert.equal(g.events[0].page_evidence[0].observed_total,null);
  assert.equal(g.events[0].page_evidence[0].ids_sha256,sha('[null]'));
  assert(!JSON.stringify(g.events).includes('PRIVATE_'));
});

test('drift recovery preserves complete old-run deployment coverage without filtering',()=>{
  const first=page(Array.from({length:100},(_,i)=>run(i+1)),101),changed=page([run(101),run(102)],102);
  const freshFirst=page(Array.from({length:100},(_,i)=>run(401+i)),101);
  const oldRerun={...run(501),created_at:'2020-01-01T00:00:00Z'},freshLast=page([oldRerun],101),queried=[];
  const f=fixture([http(first,link(publisher,2)),http(changed),http(freshFirst,link(publisher,2)),http(freshLast),http(page([]))],{
    api:(endpoint,paginate)=>{
      assert.equal(paginate,true);const match=/\/actions\/runs\/(\d+)\/jobs\?filter=all&per_page=100$/.exec(endpoint);assert(match);
      const id=Number(match[1]);queried.push(id);
      return [{jobs:id===501?[{run_attempt:1,started_at:'2026-10-07T15:59:00Z',steps:[{name:'Deploy to GitHub Pages',conclusion:'success',started_at:'2026-10-07T15:59:30Z',completed_at:'2026-10-07T16:00:00Z'}]}]:[]}];
    }});
  assert.equal(latestDeployment(repo,f.read).runId,501);
  assert.equal(queried.length,101);assert(queried.every(id=>id>=401&&id<=501));
  assert.equal(f.calls.length,5);assert.equal(f.calls.at(-1).args[2],producer);
});

test('count-drift retries spend the original shared monotonic budget',()=>{
  let clock=0;
  const first=page(Array.from({length:100},(_,i)=>run(i+1)),101),changed=page([run(101),run(102)],102);
  const f=fixture([
    ()=>{clock+=20000;return http(first,link(publisher,2));},
    ()=>{clock+=8000;return http(changed);},
    ()=>{clock+=20000;return http(first,link(publisher,2));},
    ()=>{clock+=5000;return http(page([run(101)],101));},
    ()=>{clock+=7000;return http(page([]));},
  ],{clock:()=>clock});
  assert.equal(f.read(publisher,true).length,2);assert.equal(f.read(producer,true).length,1);
  assert.deepEqual(f.calls.map(c=>c.options.timeout),[30000,10000,30000,10000,7000]);
  assert.throws(()=>f.read(publisher,true),/time-budget-exhausted/);assert.equal(f.calls.length,5);
  assert.equal(f.events[0].inventory_budget_used_ms,28000);
  assert.equal(f.events[1].inventory_budget_used_ms,53000);assert.equal(f.events[2].inventory_budget_used_ms,60000);
});
