import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {quota,safeHeaders,safeCode,checkCohortLowerBound,historyFacts,assess,hash,cohortFacts,safeWorkflowLinks,safeElapsed} from './release40-logic.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const q=(remaining=5500,limit=6000,reset=2000000000)=>({limit,used:limit-remaining,remaining,reset_epoch:reset,resource:'core'});
const policies={source:{original_primary:4937,retained_reserve:228,extra_primary:{terminal_miss:16}},publisher:{original_primary:3969,retained_reserve:228,extra_primary:{terminal_miss:16}}};
const phase=()=>({cohort:{membership_sha256:'m',identities_sha256:'i'},inventory:{pages:[]},
  history:{admitted:true,observations:[{quota:q()}],terminal_200:0,page_weights_sha256:'w'}});
test('missing or invalid elapsed time stays unknown, never becomes measured zero',()=>{
  for(const value of [undefined,null,NaN,Infinity,-1,'0'])assert.equal(safeElapsed(value),null);
  assert.equal(safeElapsed(0),0);assert.equal(safeElapsed(1.2),2);
});
test('actual quota is required, including core resource and arithmetic',()=>{
  assert.deepEqual(quota(q()),q());
  for(const missing of Object.keys(q())){const v=q();delete v[missing];assert.throws(()=>quota(v));}
  assert.throws(()=>quota({...q(),used:3}));assert.throws(()=>quota({...q(),resource:'search'}));
});
test('only numerical quota headers survive; no auth, cookie, URL or arbitrary text',()=>{
  assert.deepEqual(safeHeaders({'x-ratelimit-limit':'1000',authorization:'secret','set-cookie':'secret',location:'secret',etag:'secret',
    'x-ratelimit-used':'not-a-number',retry_after_present:true}),{'x-ratelimit-limit':1000,retry_after_present:true});
  assert.equal(safeCode(Error('secret')),'diagnostic-failed');
});
test('route probes preserve actual same-repository numeric aliases and reject data-bearing links',()=>{
  const input='<https://api.github.com/repositories/1203919607/actions/workflows/364666954/runs?branch=main&per_page=100&page=2>; rel="next"';
  const result=safeWorkflowLinks(input,'research-ui-release.yml');
  assert.deepEqual(result,[{relation:'next',origin:'https://api.github.com',path:'/repositories/1203919607/actions/workflows/364666954/runs',query:{branch:'main',page:'2',per_page:'100'}}]);
  for(const bad of [input.replace('api.github.com','other.invalid'),input.replace('1203919607','1'),input.replace('364666954','294257497'),
    input.replace('branch=main','access_token=secret'),input.replace('api.github.com','secret@api.github.com'),input.replace('page=2','page=2#secret')]){
    assert.throws(()=>safeWorkflowLinks(bad,'research-ui-release.yml'));
  }
});
test('193-member lower bound rejects rather than truncates; 192 is admissible',()=>{
  const runs=Array.from({length:193},(_,i)=>({id:i+1,status:'completed'}));
  assert.throws(()=>checkCohortLowerBound(runs,999),/192/);assert.equal(runs.length,193);
  checkCohortLowerBound(runs.slice(0,192),999);
  assert.throws(()=>checkCohortLowerBound([{id:1},{id:2},{id:3}],999),/active/);
});
test('actual multi-page weight rejects oversized complete cohort',()=>{
  const rows=[{id:1,status:'completed'}],pages=Array(193).fill({});
  const actual={status:'complete',jobs:[{run_id:1,pages}],observations:pages.map(()=>({run_id:1,run_key:'r',page_validated:true,
    page_revalidated:false,status:200,quota:q(),elapsed_ms:1,etag_received:null}))};
  const result=historyFacts(actual,rows,999);assert.equal(result.weighted_pages,193);assert.equal(result.admitted,false);
  actual.jobs=[];assert.throws(()=>historyFacts(actual,rows,999),/incomplete/);
});
test('membership digest is order-independent but identity changes are detected',()=>{
  const rows=[{id:2,run_attempt:1,status:'a'},{id:1,run_attempt:1,status:'a'}],key=r=>hash(JSON.stringify(r));
  const a=cohortFacts(rows,key),b=cohortFacts(rows.toReversed(),key);assert.deepEqual(a,b);
  rows[0].status='b';assert.notEqual(a.identities_sha256,cohortFacts(rows,key).identities_sha256);
});
test('genuine 1000-token window does not become an assumed 5000 window',()=>{
  const c=phase(),w=phase();c.history.observations[0].quota=q(900,1000);w.history.observations[0].quota=q(850,1000);
  const result=assess(c,w,q(800,1000),policies,1900000000000);
  assert.equal(result.measured_cohort_accepted,true);assert.equal(result.budgetAccepted,false);
  assert.equal(result.roles.source.actual_window_fits_original_allocation,false);assert.equal(result.whole_release_certified,false);
});
test('positive measured fit remains distinct from full release certification',()=>{
  const result=assess(phase(),phase(),q(),policies,1900000000000);
  assert.equal(result.budgetAccepted,true);assert.equal(result.whole_release_certified,false);assert.equal(result.publication_authority,false);
});
test('changed cohort, quota reset, expired window, warm misses, and native low balance fail acceptance',()=>{
  for(const mutate of [w=>w.cohort.membership_sha256='changed',w=>w.cohort.identities_sha256='changed',
    w=>w.history.page_weights_sha256='changed',w=>w.history.observations[0].quota=q(5500,6000,2000000001),
    w=>w.history.terminal_200=17,w=>w.history.admitted=false]){
    const c=phase(),w=phase();mutate(w);assert.equal(assess(c,w,q(),policies,1900000000000).budgetAccepted,false);
  }
  assert.equal(assess(phase(),phase(),q(),policies,2000000000001).budgetAccepted,false);
  const c=phase(),w=phase();c.inventory.pages=[{safe_headers:{'x-ratelimit-limit':6000,'x-ratelimit-reset':2000000000,'x-ratelimit-remaining':500}}];
  assert.equal(assess(c,w,q(),policies,1900000000000).budgetAccepted,false);
});

test('unchanged production selector, reader, worker, and disk cache survive real separate cold/warm Node processes without network',async t=>{
  const root=process.env.RELEASE40_CANDIDATE_ROOT;if(!root){t.skip('Set RELEASE40_CANDIDATE_ROOT for production-module integration');return;}
  const temp=mkdtempSync(join(tmpdir(),'release40-offline-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const before=process.env.RUNNER_TEMP;process.env.RUNNER_TEMP=temp;t.after(()=>{if(before===undefined)delete process.env.RUNNER_TEMP;else process.env.RUNNER_TEMP=before;});
  const cache=await import(pathToFileURL(join(root,'.github/scripts/conditional-deployment-jobs-cache.mjs')));
  const worker=await import(pathToFileURL(join(root,'.github/scripts/conditional-deployment-jobs-worker.mjs')));
  const context={schema_version:'conditional-deployment-jobs-cache-context-v1',repository:'kusennjp1-ai/screener',repository_id:1203919607,
    run_id:999,run_attempt:1,job_id:998,job_name:'Offline synthetic test',job_started_at:new Date(Date.now()-1000).toISOString(),
    role:'diagnostic',controller_sha:'b'.repeat(40),controller_tree:'c'.repeat(40),request_sha256:'d'.repeat(64),event_sha256:'e'.repeat(64),
    reader_version:'265ede759b1714c882015c696c6fac66975ae03a',representation:worker.REQUEST_REPRESENTATION};
  const token='synthetic-no-network-test-token',handle=cache.initializeJobCache({context,root:temp,token}),directory=handle.directory;
  handle.dispose('complete');
  const preload=join(temp,'offline-preload.mjs');
  writeFileSync(preload,`
    const REPO='kusennjp1-ai/screener',RID=1203919607;
    const rows=[11,12].map(id=>({id,run_attempt:1,head_sha:'a'.repeat(40),head_branch:'main',workflow_id:id===11?294257497:364666954,
      path:'.github/workflows/'+(id===11?'static-site.yml':'research-ui-release.yml'),name:'Synthetic workflow',event:'push',
      repository:{id:RID,full_name:REPO},head_repository:{id:RID,full_name:REPO},status:'completed',conclusion:'success',
      created_at:'2026-10-09T01:00:00Z',run_started_at:'2026-10-09T01:00:00Z',updated_at:'2026-10-09T01:10:00Z'}));
    globalThis.fetch=async(url,init)=>{
      const headers={'x-ratelimit-limit':'6000','x-ratelimit-remaining':'5500','x-ratelimit-used':'500',
        'x-ratelimit-reset':'2000000000','x-ratelimit-resource':'core','content-type':'application/json',etag:'"original"'};
      let value,status=200;
      if(url==='https://api.github.com/repositories/'+RID+'/actions/runs?per_page=50&page=1')value={total_count:2,workflow_runs:rows};
      else{
        const row=rows.find(r=>url==='https://api.github.com/repos/'+REPO+'/actions/runs/'+r.id+'/jobs?filter=all&per_page=100');
        if(!row)throw Error('NETWORK FORBIDDEN: unexpected route');
        if(init.headers['if-none-match'])status=304;
        const id=row.id*10,done=row.id===11?'04':'05';
        value={total_count:1,jobs:[{id,run_id:row.id,run_attempt:1,head_sha:row.head_sha,head_branch:'main',workflow_name:row.name,name:'Synthetic job',
          run_url:'https://api.github.com/repos/'+REPO+'/actions/runs/'+row.id,url:'https://api.github.com/repos/'+REPO+'/actions/jobs/'+id,
          status:'completed',conclusion:'success',created_at:'2026-10-09T01:00:01Z',started_at:'2026-10-09T01:00:02Z',completed_at:'2026-10-09T01:00:06Z',
          steps:[{number:1,name:'Deploy to GitHub Pages',status:'completed',conclusion:'success',started_at:'2026-10-09T01:00:03Z',completed_at:'2026-10-09T01:00:'+done+'Z'}]}]};
      }
      const response=new Response(status===304?null:JSON.stringify(value),{status,headers});Object.defineProperty(response,'url',{value:url});return response;
    };
  `);
  const results=[];
  for(const phase of ['cold','warm']){
    const output=join(temp,phase+'.json');
    const printed=execFileSync(process.execPath,[join(here,'release40-phase.mjs')],{encoding:'utf8',
      input:JSON.stringify({candidateRoot:resolve(root),context,directory,anchors:[11,12],phase,output}),
      env:{...process.env,GH_TOKEN:token,RUNNER_TEMP:temp,NODE_OPTIONS:'--import='+preload},timeout:10000});
    assert.equal(printed.includes(token),false);results.push(JSON.parse(readFileSync(output)));
    assert.equal(readFileSync(output,'utf8').includes(token),false);
  }
  assert.equal(results[0].history.http_200,2);assert.equal(results[1].history.http_304,2);
  assert.equal(results[0].cohort.identities_sha256,results[1].cohort.identities_sha256);
  assert.equal(results[1].cache_before.pages,2);assert.equal(results[1].latest_observed_deployment.run_id,12);
  assert.equal(assess(results[0],results[1],q(),policies).budgetAccepted,true);
  const missingResource=structuredClone(results[0]);delete missingResource.inventory.pages[0].quota.resource;
  assert.equal(assess(missingResource,results[1],q(),policies).budgetAccepted,false);
  assert.deepEqual(cache.cleanupJobCache({context,directory,token}),{removed:true});
});
