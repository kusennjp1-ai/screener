import test from 'node:test';
import assert from 'node:assert/strict';
import {createGithubReadApi, transientGithubReadError, githubReadRetryPolicy} from './publication-gate.mjs';
const endpoint = 'repos/owner/repo/actions/runs/123/jobs?filter=all&per_page=100';
const failure = (stderr, extra = {}) => Object.assign(new Error('gh failed'), {stderr, ...extra});
function fixture(sequence, durations = []) {
  let time = 0;
  const calls = [], sleeps = [];
  const api = createGithubReadApi({now: () => time, sleep: ms => {sleeps.push(ms); time += ms;}, execute: (...args) => {
    const index = calls.length; calls.push(args); time += durations[index] || 0;
    const result = sequence[index]; if (result instanceof Error) throw result; return result;
  }});
  return {api, calls, sleeps};
}
test('transient paginated read retries identical GET and discards partial stdout', () => {
  const f = fixture([failure('gh: Server Error (HTTP 502)', {stdout: '[{"partial":true}'}), failure('gh: HTTP 503'), '[{"jobs":[]}]']);
  assert.deepEqual(f.api(endpoint, true), [{jobs:[]}]);
  assert.deepEqual(f.sleeps, [1000,2000]); assert.equal(f.calls.length, 3);
  for (const [command,args,options] of f.calls) {
    assert.equal(command, 'gh'); assert.deepEqual(args,['api','--paginate','--slurp',endpoint]);
    assert.equal(options.maxBuffer,64*1024*1024); assert.equal(options.killSignal,'SIGKILL'); assert.ok(options.timeout <= 60000);
  }
});
for (const status of [401,403,404,408,409,429,501,505]) test(`HTTP ${status} never retries`, () => {
  const error=failure(`gh: HTTP ${status}`), f=fixture([error]);
  assert.throws(()=>f.api(endpoint), value=>value===error);assert.equal(f.calls.length,1);assert.deepEqual(f.sleeps,[]);
});
for (const error of [failure('HTTP 502; HTTP 403'),failure('HTTP 502; rate limit'),failure('HTTP 502; permission denied'),
  failure('HTTP 502',{message:'HTTP 401'}),failure('certificate signed by unknown authority'),failure('arbitrary timeout'),
  failure('HTTP 502',{code:'ENOBUFS'}),failure('',{code:'ENOENT'}),failure('HTTP 502',{signal:'SIGKILL'})]) {
  test(`nontransient failure stays closed: ${error.stderr} ${error.code || error.signal || error.message}`,()=>{
    const f=fixture([error]);assert.throws(()=>f.api(endpoint),value=>value===error);assert.equal(f.calls.length,1);
  });
}
for (const error of [failure('HTTP 500'),failure('HTTP 504'),failure('connection reset by peer'),failure('TLS handshake timeout'),
  failure('',{code:'ECONNRESET'}),failure('',{code:'ETIMEDOUT'}),failure('',{code:'EAI_AGAIN'})]) {
  test(`known transient retries: ${error.stderr} ${error.code || ''}`,()=>{
    assert.equal(transientGithubReadError(error),true);const f=fixture([error,'{"ok":true}']);assert.deepEqual(f.api(endpoint),{ok:true});assert.equal(f.calls.length,2);
  });
}
test('attempt exhaustion throws original final error, never partial data',()=>{
  const errors=[1,2,3].map(n=>failure('HTTP 502',{stdout:JSON.stringify({n})})), f=fixture(errors);
  assert.throws(()=>f.api(endpoint,true),value=>value===errors[2]);assert.equal(f.calls.length,3);
});
test('total budget bounds attempt timeout and disallows an extra delay or read',()=>{
  const errors=[failure('HTTP 502'),failure('HTTP 502')], f=fixture(errors,[60000,59000]);
  assert.throws(()=>f.api(endpoint),value=>value===errors[1]);assert.equal(f.calls.length,2);assert.deepEqual(f.sleeps,[1000]);
  assert.equal(f.calls[1][2].timeout,59000);assert.equal(githubReadRetryPolicy.totalMs,120000);
});
test('malformed successful JSON is not retried',()=>{
  const f=fixture(['{broken']);assert.throws(()=>f.api(endpoint),SyntaxError);assert.equal(f.calls.length,1);assert.deepEqual(f.sleeps,[]);
});
test('successful reads remain uncached and observe later values',()=>{
  const f=fixture(['{"value":1}','{"value":2}']);assert.deepEqual(f.api(endpoint),{value:1});assert.deepEqual(f.api(endpoint),{value:2});assert.equal(f.calls.length,2);
});
test('a sleep that exhausts the budget cannot start another subprocess',()=>{
  let time=0,calls=0;const error=failure('HTTP 502');
  const api=createGithubReadApi({now:()=>time,sleep:()=>{time=120000;},execute:()=>{calls++;throw error;}});
  assert.throws(()=>api(endpoint),value=>value===error);assert.equal(calls,1);
});
test('latest deployment cannot fall back to its anchor after historical jobs retry exhaustion',async()=>{
  const {latestDeployment}=await import('./publication-state.mjs');
  const error=failure('HTTP 502');let calls=0;
  const retry=createGithubReadApi({now:()=>0,sleep:()=>{},execute:()=>{calls++;throw error;}});
  const repository='owner/repo';const run={id:123,head_branch:'main',path:'.github/workflows/research-ui-release.yml',updated_at:'2026-10-16T12:00:00Z',repository:{full_name:repository},head_repository:{full_name:repository}};
  const api=(path,paginate)=>path.includes('/jobs?')?retry(path,paginate):[{workflow_runs:path.includes('research-ui-release.yml')?[run]:[]}];
  assert.throws(()=>latestDeployment(repository,api,{completed:1,runId:1,attempt:1}),value=>value===error);assert.equal(calls,3);
});

test('scheduler delay before the next attempt cannot exceed the total read budget',()=>{
  const times=[0,0,0,0,120000];let calls=0;const error=failure('HTTP 502');
  const api=createGithubReadApi({now:()=>times.shift(),sleep:()=>{},execute:()=>{calls++;throw error;}});
  assert.throws(()=>api(endpoint),value=>value===error);assert.equal(calls,1);
});
