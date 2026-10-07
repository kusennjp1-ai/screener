import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRetainedPriceLiveApi,LIVE_INVENTORY_LIMITS} from './retained-price-live-inventory.mjs';
import {route} from './retained-price-repository-inventory.mjs';
import {createImmutableGitApi} from './immutable-github-api.mjs';
import {latestDeployment} from './publication-state.mjs';

const repo='kusennjp1-ai/screener',prefix='repos/'+repo;
const publisher=prefix+'/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100';
const producer=prefix+'/actions/workflows/static-site.yml/runs?branch=main&per_page=100';
const sha=value=>createHash('sha256').update(value).digest('hex');
function row(id=1,workflow='research-ui-release.yml',extra={}){
  return {id,workflow_id:workflow==='research-ui-release.yml'?364666954:294257497,path:'.github/workflows/'+workflow,head_branch:'main',
    repository:{id:1203919607,full_name:repo},head_repository:{id:1203919607,full_name:repo},run_attempt:1,head_sha:'a'.repeat(40),
    created_at:'2020-01-01T00:00:00Z',updated_at:'2026-10-07T16:00:00Z',run_started_at:'2026-10-07T15:59:00Z',
    untouched_extra:{literal:true},...extra};
}
const rows=()=>[row(1),row(2,'static-site.yml')];
function envelope(runs=rows()){
  const total=runs.length,count=Math.max(1,Math.ceil(total/50)),pages=[],evidence=[];
  for(let n=1;n<=count;n++){
    const value={total_count:total,workflow_runs:runs.slice((n-1)*50,n*50)},relations=[];
    if(n<count)relations.push('<https://api.github.com/'+route(n+1)+'>; rel="next"');
    if(n>1)relations.push('<https://api.github.com/'+route(n-1)+'>; rel="prev"');
    if(count>1)relations.push('<https://api.github.com/'+route(count)+'>; rel="last"');
    pages.push({value,link:relations.join(', ')});
    const body=JSON.stringify(value);
    evidence.push({page_number:n,requested_route:route(n),status:200,observed_total:total,row_count:value.workflow_runs.length,
      body_bytes:Buffer.byteLength(body),body_sha256:sha(body),ids_sha256:sha(JSON.stringify(value.workflow_runs.map(run=>run.id))),safe_headers:{}});
  }
  return {schema_version:'retained-price-repository-snapshot-v1',status:'complete',pages,evidence,
    body_bytes:evidence.reduce((sum,item)=>sum+item.body_bytes,0)};
}
const failed=(reason,retryable=true,evidence=[])=>({schema_version:'retained-price-repository-snapshot-v1',status:'failed',reason,retryable,evidence,body_bytes:0});
const commandError=(stderr,stdout='',extra={})=>Object.assign(Error('fixture child failed'),{status:1,stderr,stdout,...extra});
function fixture(sequence,{clock=()=>0,api=()=>{throw Error('Unexpected delegated API');},requiredIds=[1,2]}={}){
  const calls=[],events=[];
  const read=createRetainedPriceLiveApi(api,{requiredIds,monotonic:clock,report:event=>events.push(event),run:(command,args,options)=>{
    calls.push({command,args,options});let value=sequence.shift();if(typeof value==='function')value=value();
    if(value instanceof Error)throw value;
    return typeof value==='string'?value:JSON.stringify(value);
  }});
  return {read,calls,events};
}
test('immediate publisher and Static share a coherent snapshot, with honest projection evidence',()=>{
  const f=fixture([envelope()]);
  assert.deepEqual(f.read(publisher,true),[{total_count:1,workflow_runs:[row(1)]}]);
  assert.deepEqual(f.read(producer,true),[{total_count:1,workflow_runs:[row(2,'static-site.yml')]}]);
  assert.equal(f.calls.length,1);const call=f.calls[0];
  assert.equal(call.command,process.execPath);assert.equal(call.args[0],'--max-old-space-size=384');
  assert(call.args[1].endsWith('/retained-price-repository-inventory.mjs'));
  assert.equal(call.options.timeout,30000);assert.equal(call.options.killSignal,'SIGKILL');
  assert.equal(call.options.maxBuffer,64*1024**2);assert.deepEqual(call.options.stdio,['pipe','pipe','pipe']);
  assert.deepEqual(JSON.parse(call.options.input),{timeoutMs:30000,requiredIds:[1,2]});
  assert.equal(f.events[0].repository_total_count,2);assert.equal(f.events[1].status,'projected');
  assert.equal(f.events[1].reused_immediate_snapshot,true);assert.equal(f.events[0].snapshot_id,f.events[1].snapshot_id);
});
test('every new publisher round fetches fresh even without any intervening API call',()=>{
  const f=fixture([envelope(),envelope([...rows(),row(3,'static-site.yml')])]);
  f.read(publisher,true);f.read(producer,true);f.read(publisher,true);
  assert.equal(f.read(producer,true)[0].total_count,2);assert.equal(f.calls.length,2);
  assert.notEqual(f.events[0].snapshot_id,f.events[2].snapshot_id);
});
test('a microtask or async asset interval expires an incomplete pair',async()=>{
  const f=fixture([envelope(),envelope([...rows(),row(3,'static-site.yml')])]);
  f.read(publisher,true);await Promise.resolve();
  assert.equal(f.read(producer,true)[0].total_count,2);assert.equal(f.calls.length,2);
});
test('a generic read, wrong paginate flag, unexpected order or error invalidates pairing',()=>{
  for(const throws of [false,true]){
    const delegated=[],f=fixture([envelope(),envelope()],{api:(...args)=>{delegated.push(args);if(throws)throw Error('generic failed');return 7;}});
    f.read(publisher,true);
    if(throws)assert.throws(()=>f.read(prefix+'/git/ref/heads/main'),/generic failed/);
    else assert.equal(f.read(prefix+'/git/ref/heads/main'),7);
    f.read(producer,true);assert.equal(f.calls.length,2);assert.equal(delegated.length,1);
  }
  const f=fixture([envelope(),envelope(),envelope(),envelope()],{api:()=>7});
  f.read(producer,true);f.read(producer,true);assert.equal(f.calls.length,2);
  f.read(publisher,true);assert.equal(f.read(producer,false),7);f.read(producer,true);assert.equal(f.calls.length,4);
  const g=fixture([envelope(),envelope(),envelope()]);
  g.read(publisher,true);g.read(publisher,true);g.read(producer,true);assert.equal(g.calls.length,2);
});
test('returned caller objects and anchor arrays cannot mutate a pending or later snapshot',()=>{
  const anchors=[1,2],f=fixture([envelope(),envelope()],{requiredIds:anchors});
  anchors[1]=999;
  const first=f.read(publisher,true);first[0].workflow_runs[0].repository.id=99;
  first[0].workflow_runs.push(row(888));first[0].total_count=99;
  const second=f.read(producer,true);assert.equal(second[0].total_count,1);assert.equal(second[0].workflow_runs[0].repository.id,1203919607);
  second[0].workflow_runs[0].untouched_extra.literal=false;
  assert.equal(f.read(publisher,true)[0].workflow_runs[0].untouched_extra.literal,true);
  assert.deepEqual(JSON.parse(f.calls[0].options.input).requiredIds,[1,2]);
});
test('required actual caller and predecessor anchors reject absent, empty and malformed snapshots',()=>{
  for(const anchors of [undefined,[],[1],[1,1],[0,2],[1,'2']])
    assert.throws(()=>createRetainedPriceLiveApi(()=>{}, {requiredIds:anchors}),/invalid-required-run-anchors/);
  for(const runs of [[],[row(1)],[row(2,'static-site.yml')]]){
    const f=fixture([envelope(runs)]);assert.throws(()=>f.read(publisher,true),/required-run-anchor-absent/);assert.equal(f.calls.length,1);
  }
});
test('whole-snapshot drift, transport timeout and EOF get one fresh retry only',()=>{
  for(const reason of ['changing-inventory-total','transport-timeout','transport-or-json-eof','json-eof']){
    const f=fixture([failed(reason),envelope()]);assert.equal(f.read(publisher,true)[0].total_count,1);
    assert.equal(f.calls.length,2);assert.deepEqual(f.events.map(event=>event.attempt),[1,2]);
    assert.equal(f.events[0].call_id,f.events[1].call_id);
    const g=fixture([failed(reason),failed(reason),envelope()]);assert.throws(()=>g.read(publisher,true),new RegExp(reason));
    assert.equal(g.calls.length,2);assert.equal(g.events[1].retry,false);
  }
});
test('malformed semantic and unknown worker failures never inherit a retry request',()=>{
  for(const reason of ['invalid-or-duplicate-run','invalid-json','projected-workflow-bound','http-or-security-denial','required-run-anchor-absent','secret-unknown']){
    const f=fixture([failed(reason,true),envelope()]);
    assert.throws(()=>f.read(publisher,true));assert.equal(f.calls.length,1);assert.equal(f.events[0].retry,false);
    assert(!JSON.stringify(f.events).includes('secret-unknown'));
  }
});
test('denial in any sibling evidence wins a claimed retryable EOF or total drift',()=>{
  for(const item of [
    {status:403,safe_headers:{}},{status:200,safe_headers:{'x-ratelimit-remaining':'0'}},
    {status:200,safe_headers:{retry_after_present:true}}]){
    const f=fixture([failed('changing-inventory-total',true,[{page_number:2,...item}]),envelope()]);
    assert.throws(()=>f.read(publisher,true),/http-or-security-denial/);assert.equal(f.calls.length,1);
  }
});
test('failed child diagnostics cannot echo secrets and HTTP/security denials override EOF',()=>{
  for(const text of ['HTTP 401','HTTP/2.0 403 Forbidden','HTTP 429','API rate limit exceeded','secondary rate limit','Retry-After: 10',
    'authentication required','authorization denied','x509 certificate error','TLS handshake failure','SSL failure','SSO required','security block','HTTP 502']){
    const f=fixture([commandError('unexpected EOF\n'+text),envelope()]);
    assert.throws(()=>f.read(publisher,true),/http-or-security-denial/);assert.equal(f.calls.length,1);
  }
  const f=fixture([commandError('unexpected EOF token-secret','partial-secret-token'),envelope()]);
  f.read(publisher,true);assert.equal(f.calls.length,2);
  assert.equal(f.events[0].failed_stdout.sha256,sha('partial-secret-token'));
  assert(!JSON.stringify(f.events).includes('token-secret'));
});
test('quota denial cannot be hidden by partial success headers or header chains',()=>{
  for(const stdout of [
    'HTTP/2 200 OK\r\nX-RateLimit-Remaining: 0\r\n\r\n{',
    'HTTP/2 200 OK\r\nRetry-After: invalid\r\n\r\n{',
    'HTTP/2 200 OK\r\n\r\nHTTP/2 403 Forbidden\r\n\r\n{}']){
    const f=fixture([commandError('unexpected EOF',stdout),envelope()]);
    assert.throws(()=>f.read(publisher,true),/http-or-security-denial/);assert.equal(f.calls.length,1);
  }
});
test('a truncated child envelope retries; invalid JSON, byte overflow and unknown exit fail closed',()=>{
  const f=fixture(['{"schema_version":',envelope()]);f.read(publisher,true);assert.equal(f.calls.length,2);
  for(const bad of ['{bad',commandError('unknown'),commandError('', '',{code:'ENOBUFS'})]){
    const g=fixture([bad,envelope()]);assert.throws(()=>g.read(publisher,true));assert.equal(g.calls.length,1);
  }
});
test('parent revalidates the complete repository pages and exact Links before projection',()=>{
  for(const mutate of [
    r=>r.pages[0].value.workflow_runs[0].path='.github/workflows/other.yml',
    r=>r.pages[0].value.workflow_runs[0].repository.id=99,
    r=>r.pages[0].value.workflow_runs[0].head_repository.full_name='foreign/repo',
    r=>r.pages[0].value.workflow_runs[1].id=1,
    r=>r.pages[0].value.workflow_runs.pop(),
    r=>r.pages[0].link='<https://api.github.com/'+route(1)+'&branch=main>; rel="last"',
    r=>r.pages[0].link='<https://foreign.example/'+route(1)+'>; rel="last"',
    r=>r.evidence[0].body_bytes++,
    r=>r.evidence=[]]){
    const value=envelope();mutate(value);const f=fixture([value,envelope()]);
    assert.throws(()=>f.read(publisher,true));assert.equal(f.calls.length,1);
  }
});
test('1,324 complete rows preserve old runs, exact projection and foreign PR exclusion',()=>{
  const runs=Array.from({length:1324},(_,i)=>row(i+1,i%3===0?'research-ui-release.yml':'static-site.yml'));
  runs[2].head_branch='feature';runs[3].head_repository={id:999,full_name:'foreign/repo'};
  const f=fixture([envelope(runs)]);
  const pub=f.read(publisher,true),stat=f.read(producer,true);
  assert.equal(pub.flatMap(p=>p.workflow_runs).length,441);assert.equal(stat.flatMap(p=>p.workflow_runs).length,881);
  assert.equal(f.events[0].repository_pages,27);assert.equal(f.calls.length,1);
  assert.equal(pub[0].workflow_runs[0].created_at,'2020-01-01T00:00:00Z');
});
test('a projected workflow over the original 1,000-run bound rejects the whole snapshot',()=>{
  const f=fixture([envelope(Array.from({length:1001},(_,i)=>row(i+1)))]);
  assert.throws(()=>f.read(publisher,true),/projected-workflow-bound/);assert.equal(f.calls.length,1);
});
test('shared inventory budget spans fresh rounds and retries while generic time is excluded',()=>{
  let clock=0;
  const f=fixture([()=>{clock+=20000;return envelope();},()=>{clock+=25000;return failed('json-eof');},()=>{clock+=10000;return envelope();}],
    {clock:()=>clock,api:()=>{clock+=900000;return 7;}});
  f.read(publisher,true);f.read(producer,true);f.read(prefix+'/git/ref/heads/main');
  f.read(publisher,true);f.read(producer,true);
  assert.deepEqual(f.calls.map(call=>call.options.timeout),[30000,30000,15000]);
  assert.equal(f.events.at(-1).inventory_budget_used_ms,55000);
});
test('real synchronous child is SIGKILLed by its remaining shared budget',()=>{
  let clock=0,calls=0;
  const read=createRetainedPriceLiveApi(()=>{}, {requiredIds:[1,2],monotonic:()=>clock,report:()=>{},run:(_command,_args,options)=>{
    calls++;if(calls<=2){clock+=29995;return JSON.stringify(envelope());}
    assert.equal(options.timeout,10);assert.equal(options.killSignal,'SIGKILL');clock+=10;
    return execFileSync(process.execPath,['-e','setInterval(()=>{},1000)'],options);
  }});
  read(publisher,true);read(publisher,true);
  assert.throws(()=>read(publisher,true),/transport-timeout/);assert.equal(calls,3);
});
test('a killed first attempt never yields an accepted partial snapshot and cannot get a third attempt',()=>{
  let clock=0;const f=fixture([
    ()=>{clock+=30000;return commandError('fixture timeout','partial',{code:'ETIMEDOUT',signal:'SIGKILL'});},
    ()=>{clock+=30000;return commandError('fixture timeout','partial',{code:'ETIMEDOUT',signal:'SIGKILL'});},envelope()],{clock:()=>clock});
  assert.throws(()=>f.read(publisher,true),/transport-timeout/);assert.equal(f.calls.length,2);
  assert.equal(f.events.at(-1).inventory_budget_used_ms,60000);assert.equal(f.events.at(-1).retry,false);
});
test('native worker launch honors the closed stdin protocol and fails without an Actions token',()=>{
  let calls=0;
  const read=createRetainedPriceLiveApi(()=>{}, {requiredIds:[1,2],report:()=>{},run:(command,args,options)=>{
    calls++;return execFileSync(command,args,{...options,env:{...process.env,GH_TOKEN:'',GITHUB_TOKEN:''}});
  }});
  assert.throws(()=>read(publisher,true),/missing-actions-token/);assert.equal(calls,1);
});
test('generic API including all-attempt jobs stays fresh and unchanged',()=>{
  const delegated=[],f=fixture([],{api:(...args)=>{delegated.push(args);return {count:delegated.length};}});
  const job=prefix+'/actions/runs/1/jobs?filter=all&per_page=100';
  assert.deepEqual(f.read(job,true),{count:1});assert.deepEqual(f.read(job,true),{count:2});
  for(const [endpoint,paginate]of [[publisher,false],[publisher+'&page=1',true],[publisher.replace('main','other'),true]])f.read(endpoint,paginate);
  assert.equal(f.calls.length,0);assert.equal(delegated.length,5);assert.deepEqual(delegated[0],[job,true]);
});
test('immutable reads may cache independently while both live snapshots remain new',()=>{
  const calls=[],base=createImmutableGitApi((endpoint,paginate)=>{calls.push([endpoint,paginate]);return {sha:'a'.repeat(40),tree:{sha:'b'.repeat(40)},parents:[]};},repo);
  const f=fixture([envelope(),envelope()],{api:base}),endpoint=prefix+'/git/commits/'+'a'.repeat(40);
  f.read(endpoint);f.read(endpoint);assert.equal(calls.length,1);
  f.read(publisher,true);f.read(producer,true);f.read(publisher,true);f.read(producer,true);assert.equal(f.calls.length,2);
});
test('real latestDeployment finds an old successful rerun and a new post-assets winner',async()=>{
  const old=row(1,'research-ui-release.yml',{run_attempt:5}),stat=row(2,'static-site.yml'),newer=row(3,'static-site.yml');
  const calls=[];
  const job=(id,attempt,completed)=>({id,run_attempt:attempt,started_at:'2026-10-07T15:00:00Z',
    steps:[{name:'Deploy to GitHub Pages',conclusion:'success',started_at:'2026-10-07T15:01:00Z',completed_at:completed}]});
  const f=fixture([envelope([old,stat]),envelope([old,stat,newer])],{api:(endpoint,paginate)=>{
    calls.push([endpoint,paginate]);assert(endpoint.endsWith('/jobs?filter=all&per_page=100'));assert.equal(paginate,true);
    return [{jobs:endpoint.includes('/runs/1/')?[job(10,2,'2026-10-07T16:00:00Z')]:
      endpoint.includes('/runs/3/')?[job(30,1,'2026-10-07T17:00:00Z')]:[]}];
  }});
  const initial=latestDeployment(repo,f.read);assert.equal(initial.runId,1);assert.equal(initial.attempt,2);assert.equal(initial.runAttempt,5);
  await Promise.resolve();
  const final=latestDeployment(repo,f.read,initial);assert.equal(final.runId,3);assert.equal(final.attempt,1);
  assert.equal(f.calls.length,2);assert.equal(calls.filter(([endpoint])=>endpoint.includes('/runs/1/')).length,2);
});
test('real latestDeployment still rejects ambiguous success order',()=>{
  const f=fixture([envelope()],{api:()=>[{jobs:[{run_attempt:1,started_at:'2026-10-07T15:00:00Z',
    steps:[{name:'Deploy to GitHub Pages',conclusion:'success',started_at:'2026-10-07T15:01:00Z',completed_at:'2026-10-07T16:00:00Z'}]}]}]});
  assert.throws(()=>latestDeployment(repo,f.read),/ambiguous publication order/);
});
test('only finite liveFor supplies authenticated anchors, and livePublication keeps both rounds',()=>{
  const driver=readFileSync(new URL('./retained-price-source-driver.mjs',import.meta.url),'utf8');
  assert.equal((driver.match(/createRetainedPriceLiveApi\(o.api/g)||[]).length,1);
  assert.match(driver,/async function liveFor\(o,caller,request\)/);
  assert.match(driver,/requiredIds:\[caller.run.id,request.predecessor.run_id\]/);
  assert(!driver.includes('liveFor(o)'));
  const publication=readFileSync(new URL('./publication-state.mjs',import.meta.url),'utf8');
  assert.match(publication,/const latest = latestDeployment\(repository, api, anchor\)/);
  assert.match(publication,/const finalDeployment = latestDeployment\(repository, api, latest\)/);
  for(const name of ['publication-gate.mjs','retained-price-ci-admission.mjs','retained-price-source-admission.mjs','immutable-github-api.mjs'])
    assert(!readFileSync(new URL('./'+name,import.meta.url),'utf8').includes('retained-price-live-inventory'));
  const ci=readFileSync(new URL('../workflows/ci.yml',import.meta.url),'utf8');
  assert(ci.includes('retained-price-live-inventory.test.mjs'));assert(ci.includes('retained-price-repository-inventory.test.mjs'));
});
