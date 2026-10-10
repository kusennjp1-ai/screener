// Synthetic protocol/lifecycle tests. No real Actions proof or publication is minted.
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,copyFileSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
 createConditionalDeploymentJobsReader,withConditionalDeploymentJobsReader,
 withInvocationConditionalDeploymentJobs,readScopedDeploymentJobs,noteScopedApiRead,noteScopedInventoryRead,
} from './conditional-deployment-jobs.mjs';
import {withInvocationImmutableGitApi} from './publication-gate.mjs';
import {readConditionalDeploymentJobs,runKey,REQUEST_REPRESENTATION} from './conditional-deployment-jobs-worker.mjs';
import {initializeJobCache,openJobCache,cleanupJobCache,isOwnedJobCacheHandle} from './conditional-deployment-jobs-cache.mjs';

const REPO='kusennjp1-ai/screener',RID=1203919607,TOKEN='synthetic-bridge-only-token';
const scope={repository:REPO,repository_id:RID,run_id:900,run_attempt:1,controller_sha:'b'.repeat(40)};
const clone=v=>JSON.parse(JSON.stringify(v));
function row(id=11,changes={}){return {id,run_attempt:1,head_sha:'a'.repeat(40),head_branch:'main',
 workflow_id:294257497,path:'.github/workflows/static-site.yml',name:'Synthetic static workflow',event:'workflow_dispatch',
 repository:{id:RID,full_name:REPO},head_repository:{id:RID,full_name:REPO},status:'completed',conclusion:'success',
 created_at:'2026-10-09T01:00:00Z',run_started_at:'2026-10-09T01:00:00Z',updated_at:'2026-10-09T01:10:00Z',...changes};}
function job(r,id=101,changes={}){return {id,run_id:r.id,run_attempt:r.run_attempt,head_sha:r.head_sha,head_branch:r.head_branch,
 workflow_name:r.name,name:'Synthetic job',run_url:'https://api.github.com/repos/'+REPO+'/actions/runs/'+r.id,
 url:'https://api.github.com/repos/'+REPO+'/actions/jobs/'+id,
 html_url:'https://github.com/'+REPO+'/actions/runs/'+r.id+'/job/'+id,status:'completed',conclusion:'success',
 created_at:'2026-10-09T01:00:01Z',started_at:'2026-10-09T01:00:02Z',completed_at:'2026-10-09T01:00:05Z',
 steps:[{number:1,name:'Synthetic step',status:'completed',conclusion:'success',started_at:'2026-10-09T01:00:03Z',completed_at:'2026-10-09T01:00:04Z'}],...changes};}
function response(url,value,status=200,etag='W/"bridge-tag"'){
 const headers={'x-ratelimit-limit':'5000','x-ratelimit-used':'500','x-ratelimit-remaining':'4500',
 'x-ratelimit-reset':'1791516176','x-ratelimit-resource':'core','x-github-request-id':'UNIT:1:2',
 vary:'Accept,Authorization,Cookie,X-GitHub-OTP,Accept-Encoding,Accept,X-Requested-With',etag};
 if(status===200){headers['content-type']='application/json; charset=utf-8';headers['content-encoding']='gzip';}
 const res=new Response(status===304?null:JSON.stringify(value),{status,headers});
 Object.defineProperty(res,'url',{value:url});Object.defineProperty(res,'redirected',{value:false});return res;
}
async function actual(runs,cache=[],excludedIds=[],handler=null){
 let clock=0,calls=0;
 const output=await readConditionalDeploymentJobs({scope:clone(scope),runs,cache,excludedIds,timeoutMs:120000},{
 token:TOKEN,monotonic:()=>clock,pause:async ms=>{clock+=ms;},
 fetcher:(url,init)=>{calls++;const r=runs.find(v=>url.includes('/'+v.id+'/jobs'));
 return handler?handler(url,init,r):response(url,{total_count:1,jobs:[job(r,100+r.id)]});}});
 return {output,calls};
}
function bridge(results,{token=()=>TOKEN,binding=()=>true,excludedIds=[],beforeReturn=()=>{},jobCache=null}={}){
 const configs=[],reports=[];
 const reader=createConditionalDeploymentJobsReader({scope:clone(scope),excludedIds,token,binding,jobCache,report:v=>reports.push(clone(v)),
 run:(command,args,options)=>{
  assert.equal(command,process.execPath);assert.equal(args.length,2);assert.equal(args[0],'--max-old-space-size=384');
  assert.equal(args[1],join(dirname(fileURLToPath(import.meta.url)),'conditional-deployment-jobs-worker.mjs'));
  assert.equal(options.timeout,120000);assert.equal(options.maxBuffer,64*1024**2);
  assert.deepEqual(options.stdio,['pipe','pipe','pipe']);assert.equal(options.encoding,'utf8');assert.equal(options.killSignal,'SIGKILL');
  const config=JSON.parse(options.input);configs.push(config);assert.equal(Object.hasOwn(config,'token'),false);
  const next=results.shift();assert.ok(next,'No hidden worker retry');
  if(next instanceof Error)throw next;beforeReturn();return JSON.stringify(next);
 }});
 return {reader,configs,reports};
}
test('actual worker cold/warm output satisfies the synchronous bridge contract and quota accounting',async()=>{
 const r=row(),cold=await actual([r]);
 const warm=await actual([r],cold.output.cache,[],(url,init)=>{assert.equal(init.headers['if-none-match'],'W/"bridge-tag"');return response(url,null,304,'"bridge-tag"');});
 assert.equal(cold.output.status,'complete');assert.equal(warm.output.status,'complete');
 const b=bridge([cold.output,warm.output]);const first=b.reader.read([r]);first.get(r.id)[0].name='mutated caller copy';
 assert.equal(b.reader.read([r]).get(r.id)[0].name,'Synthetic job');b.reader.dispose();
 assert.equal(b.configs[0].cache.length,0);assert.equal(b.configs[1].cache.length,1);
 const m=b.reports[0];assert.equal(m.counts.conditional_batch_calls,2);assert.equal(m.counts.conditional_requests_issued,2);
 assert.equal(m.counts.conditional_http_200,1);assert.equal(m.counts.conditional_http_304,1);
 assert.equal(m.measurement_incomplete,false);assert.equal(m.publication_authority,false);
 assert.equal(m.historical_batches[0].first_actual_route_quota['x-ratelimit-remaining'],4500);
 assert.equal(m.historical_batches[1].last_actual_route_quota['x-ratelimit-reset'],1791516176);
 assert.equal(m.historical_batches[1].conditional_200_subset,0);
 assert.doesNotMatch(JSON.stringify(m),new RegExp(TOKEN));assert.equal(b.reader.stats().cache_bytes,2);
 assert.throws(()=>b.reader.read([r]),/disposed-history-scope/);
});
test('actual failed worker output on nonzero exit retains its counted403 and never exposes jobs',async()=>{
 const r=row();const failed=await actual([r],[],[],url=>response(url,{message:'denied'},403));
 assert.equal(failed.output.status,'failed');assert.equal(failed.calls,1);assert.equal(failed.output.observations[0].status,403);
 const error=Object.assign(Error('Native command failure'),{status:1,stdout:Buffer.from(JSON.stringify(failed.output))});
 const b=bridge([error]);assert.throws(()=>b.reader.read([r]),/worker-command-failed/);
 assert.equal(b.reader.disposed,true);assert.equal(b.reader.stats().cache_bytes,2);
 const m=b.reports[0];assert.equal(m.counts.conditional_requests_issued,1);assert.equal(m.counts.conditional_http_other_status,1);
 assert.equal(m.measurement_incomplete,false);assert.equal(m.historical_batches[0].status,'failed');
});
test('unavailable or invalid failed stdout reports unknown accounting and disposes',()=>{
 for(const stdout of[undefined,'not-json',JSON.stringify({status:'failed',observations:[]})]){
  const b=bridge([Object.assign(Error('Failure'),{stdout})]);assert.throws(()=>b.reader.read([row()]),/worker-command-failed/);
  assert.equal(b.reports[0].measurement_incomplete,true);assert.equal(b.reports[0].counts.conditional_batch_calls,1);
  assert.equal(b.reports[0].counts.conditional_requests_issued,0);assert.equal(b.reader.disposed,true);
 }
});
test('contradictory successful worker observation cannot bless cached bytes',async()=>{
 const r=row(),base=(await actual([r])).output;
 for(const change of[
  o=>{o.status=403;},o=>{o.body_sha256='0'.repeat(64);},o=>{o.representation_body_bytes++;},
  o=>{o.url+='&page=1';},o=>{o.etag_received='"different"';},o=>{o.run_key='0'.repeat(64);} ]){
  const output=clone(base);change(output.observations[0]);const b=bridge([output]);
  assert.throws(()=>b.reader.read([r]));assert.equal(b.reader.disposed,true);assert.equal(b.reader.stats().cache_bytes,2);
 }
});
test('actual conditional304 must retain exact prior body and permitted opaque validator',async()=>{
 const r=row(),cold=(await actual([r])).output;
 const warm=(await actual([r],cold.cache,[],url=>response(url,null,304,'"bridge-tag"'))).output;
 const invalid=clone(warm);invalid.observations[0].etag_sent='"foreign"';
 const b=bridge([cold,invalid]);b.reader.read([r]);assert.throws(()=>b.reader.read([r]),/invalid-worker-observations/);
 assert.equal(b.reader.disposed,true);
});
test('current caller and internally bound critical source/CI never enter historical cache',async()=>{
 const source=row(12,{head_sha:scope.controller_sha}),ci=row(13,{head_sha:scope.controller_sha,workflow_id:294252465,path:'.github/workflows/ci.yml'});
 const rows=[row(scope.run_id),source,ci,row(14)],excludedIds=[scope.run_id,source.id,ci.id];
 const output=(await actual(rows,[],excludedIds)).output;assert.equal(output.status,'complete');assert.equal(output.cache.length,1);
 const b=bridge([output]);withConditionalDeploymentJobsReader(b.reader,()=>{
  noteScopedApiRead('repos/'+REPO+'/actions/runs/12',false,source);
  noteScopedApiRead('repos/'+REPO+'/actions/runs/13',false,ci);
  assert.equal(readScopedDeploymentJobs(REPO,()=>{},rows).size,4);
 });
 assert.deepEqual(b.configs[0].excludedIds.slice().sort((a,c)=>a-c),excludedIds.slice().sort((a,c)=>a-c));
 assert.equal(b.reader.disposed,true);
});
test('private token change before or during a batch is terminal with no reuse',async()=>{
 const r=row(),output=(await actual([r])).output;let value=TOKEN;
 const before=bridge([output],{token:()=>value});value='another-private-synthetic-value';
 assert.throws(()=>before.reader.read([r]),/private-invocation-binding-changed/);assert.equal(before.configs.length,0);assert.equal(before.reader.disposed,true);
 value=TOKEN;const during=bridge([output],{token:()=>value,beforeReturn:()=>{value='changed';}});
 assert.throws(()=>during.reader.read([r]),/private-invocation-binding-changed/);assert.equal(during.reader.disposed,true);
 assert.doesNotMatch(JSON.stringify(during.reports),/another-private-synthetic-value|changed/);
});
test('owned scopes dispose on synchronous throw and asynchronous rejection preserving error identity',async()=>{
 for(const asyncMode of[false,true]){
  const b=bridge([]),original=Error('original work error');
  if(asyncMode)await assert.rejects(withConditionalDeploymentJobsReader(b.reader,async()=>{throw original;}),e=>e===original);
  else assert.throws(()=>withConditionalDeploymentJobsReader(b.reader,()=>{throw original;}),e=>e===original);
  assert.equal(b.reader.disposed,true);assert.equal(b.reports.length,1);assert.equal(b.reports[0].status,'failed');
 }
});
test('nested asynchronous owned scopes keep independent caches and restore outer context',async()=>{
 const r=row(),a=(await actual([r])).output,b=(await actual([r])).output;
 const outer=bridge([a]),inner=bridge([b]);
 await withConditionalDeploymentJobsReader(outer.reader,async()=>{
  await withConditionalDeploymentJobsReader(inner.reader,async()=>{await Promise.resolve();assert.equal(readScopedDeploymentJobs(REPO,()=>{},[r]).size,1);});
  assert.equal(inner.reader.disposed,true);assert.equal(outer.reader.disposed,false);
  assert.equal(readScopedDeploymentJobs(REPO,()=>{},[r]).size,1);
 });
 assert.equal(outer.reader.disposed,true);assert.equal(readScopedDeploymentJobs(REPO,()=>{},[r]),null);
 assert.equal(outer.configs[0].cache.length,0);assert.equal(inner.configs[0].cache.length,0);
});
test('inventory counter observes each issued/aborted page once and ignores projected reuse',()=>{
 const b=bridge([]),o={schema_version:'synthetic-inventory-v1',call_id:'synthetic-call',attempt:1,status:'complete',
 page_evidence:[{page_number:1,requested_route:'repositories/'+RID+'/actions/runs?per_page=50&page=1',status:200},
 {page_number:2,requested_route:'repositories/'+RID+'/actions/runs?per_page=50&page=2',status:null}]};
 withConditionalDeploymentJobsReader(b.reader,()=>{
  noteScopedInventoryRead(o);noteScopedInventoryRead(o);noteScopedInventoryRead({...o,status:'projected'});
  noteScopedApiRead('repos/'+REPO+'/actions/runs',true,[{},{}]);
  noteScopedApiRead('repos/'+REPO+'/actions/runs/1',false,{},Error('failed'));
 });
 const m=b.reports[0];assert.equal(m.counts.native_snapshot_requests_issued,2);assert.equal(m.counts.native_snapshot_http_200,1);
 assert.equal(m.counts.native_snapshot_status_unknown,1);assert.equal(m.counts.native_snapshot_attempts,1);
 assert.equal(m.counts.gh_returned_pages,2);assert.equal(m.counts.gh_failed_invocations,1);
});
test('measurement counts the exact numeric repository alias without admitting foreign IDs or origins',()=>{
 const b=bridge([]),path='/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100&page=2';
 withConditionalDeploymentJobsReader(b.reader,()=>{
  noteScopedApiRead('repos/'+REPO+path,true,[null]);
  noteScopedApiRead('repositories/'+RID+path,true,[null]);
  noteScopedApiRead('repositories/'+RID+path,true,null,Error('synthetic failed page'));
 });
 const m=b.reports[0];assert.equal(m.measurement_incomplete,false);assert.equal(m.publication_authority,false);
 assert.equal(m.counts.gh_invocations,3);assert.equal(m.counts.gh_successful_paginated_invocations,2);
 assert.equal(m.counts.gh_returned_pages,2);assert.equal(m.counts.gh_failed_invocations,1);
 assert.equal(m.counts.gh_failed_page_count_unknown,1);
 for(const endpoint of[
  'repositories/1203919608'+path,'repositories/01203919607'+path,'repositories/12039196070'+path,
  'repositories/1203919607suffix'+path,'repositories/%31'+String(RID).slice(1)+path,
  'https://api.github.com/repositories/'+RID+path,'http://api.github.com/repositories/'+RID+path,
  'https://api.github.com:443/repositories/'+RID+path,'https://evil.invalid/repositories/'+RID+path,
  '//api.github.com/repositories/'+RID+path,'repos/foreign/screener'+path,
 ]){
  const foreign=bridge([]);withConditionalDeploymentJobsReader(foreign.reader,()=>noteScopedApiRead(endpoint,true,[null]));
  assert.equal(foreign.reports[0].measurement_incomplete,true,endpoint);
  assert.equal(foreign.reports[0].counts.gh_invocations,0,endpoint);
  assert.equal(foreign.reports[0].counts.gh_returned_pages,0,endpoint);
 }
});
function environment(work,{file='research-ui-release.yml',event='workflow_run',enabled=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'conditional-bridge-')),old=process.cwd(),prior={...process.env};
 mkdirSync(join(dir,'.github'));const eventPath=join(dir,'event.json'),requestPath=join(dir,'.github/retained-price-oct6-source.json');
 writeFileSync(eventPath,JSON.stringify({workflow_run:row(777,{head_sha:scope.controller_sha,event:'workflow_run'})}));
 writeFileSync(requestPath,JSON.stringify({schema_version:'retained-price-oct6-source-v1',enabled,activation:{synthetic:true}}));
 Object.assign(process.env,{GITHUB_REPOSITORY:REPO,GITHUB_REPOSITORY_ID:String(RID),GITHUB_REF:'refs/heads/main',
 GITHUB_JOB:'publish',GITHUB_EVENT_NAME:event,GITHUB_SHA:scope.controller_sha,GITHUB_WORKFLOW_SHA:scope.controller_sha,GITHUB_RUN_ID:String(scope.run_id),
 GITHUB_RUN_ATTEMPT:'1',GITHUB_WORKFLOW_REF:REPO+'/.github/workflows/'+file+'@refs/heads/main',GITHUB_EVENT_PATH:eventPath,GH_TOKEN:TOKEN});
 delete process.env.RETAINED_PRICE_CONTROLLER_ROOT;process.chdir(dir);
 try{return work({dir,eventPath,requestPath});}finally{
  process.chdir(old);for(const k of Object.keys(process.env))if(!Object.hasOwn(prior,k))delete process.env[k];Object.assign(process.env,prior);rmSync(dir,{recursive:true,force:true});
 }
}
test('ordinary, Design, producer, disabled and foreign contexts are inert',()=>{
 for(const options of[{file:'ci.yml',event:'push'},{file:'static-site.yml'},{file:'design.yml'},{enabled:false}]){
  environment(()=>{assert.equal(withInvocationConditionalDeploymentJobs(REPO,()=>readScopedDeploymentJobs(REPO,()=>{},[row()])),null);},options);
 }
 assert.equal(withInvocationConditionalDeploymentJobs('foreign/repository',()=>readScopedDeploymentJobs(REPO,()=>{},[])),null);
});
test('post-bind event or request growth rejects before any native network worker can start',()=>{
 for(const which of['eventPath','requestPath']){
  environment(paths=>{
   const previousArgv=process.argv,previousExecArgv=[...process.execArgv];
   process.execArgv.splice(0);
   process.argv=[process.execPath,join(paths.dir,'.github/scripts/retained-price-source-admission.mjs'),
    'prepare-controller','--output',join(paths.dir,'runner/retained-price-controller')];
   try{assert.throws(()=>withInvocationConditionalDeploymentJobs(REPO,()=>{
    writeFileSync(paths[which],'x'.repeat(1024**2+1));return readScopedDeploymentJobs(REPO,()=>{},[row()]);
   }),/bound-file-size-or-kind|bound-file-growth-or-shrink/);}finally{process.argv=previousArgv;process.execArgv.splice(0,Infinity,...previousExecArgv);}
  });
 }
});
test('initial linked and oversized binding files fail before work',()=>{
 for(const kind of['oversized','linked']){
  environment(({dir,eventPath})=>{
   if(kind==='oversized')writeFileSync(eventPath,'x'.repeat(1024**2+1));
   else{const target=join(dir,'actual-event.json');writeFileSync(target,'{}');rmSync(eventPath);symlinkSync(target,eventPath);}
   let reached=false;assert.throws(()=>withInvocationConditionalDeploymentJobs(REPO,()=>{reached=true;}));
   assert.equal(reached,false);
  });
 }
});
test('copied tracked controller resolves its real native worker without approved UI materialization',()=>{
 const dir=mkdtempSync(join(tmpdir(),'copied-conditional-controller-')),source=dirname(fileURLToPath(import.meta.url));
 const scripts=join(dir,'.github/scripts');mkdirSync(scripts,{recursive:true});
 for(const name of['conditional-deployment-jobs.mjs','conditional-deployment-jobs-worker.mjs','conditional-deployment-jobs-cache.mjs','bounded-github-api.mjs','retained-price-finite-transport-controller.mjs','retained-price-finite-transport-policy.mjs'])copyFileSync(join(source,name),join(scripts,name));
 const script="import {createConditionalDeploymentJobsReader} from "+JSON.stringify(pathToFileURL(join(scripts,'conditional-deployment-jobs.mjs')).href)+";\n"+
 "const reports=[];const reader=createConditionalDeploymentJobsReader({scope:"+JSON.stringify(scope)+",token:()=>"+JSON.stringify(TOKEN)+",report:v=>reports.push(v)});"+
 "try{reader.read("+JSON.stringify([row()])+");throw Error('Unexpected worker success');}catch(e){if(e.conditionalReason!=='worker-command-failed')throw e;}"+
 "if(!reader.disposed||reports.length!==1||reports[0].measurement_incomplete||reports[0].counts.conditional_requests_issued!==0)throw Error('Bad copied worker result');console.log('copied-native-worker-resolved-without-network');";
 try{
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,GH_TOKEN:'',GITHUB_TOKEN:''},timeout:5000,maxBuffer:1024**2});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'copied-native-worker-resolved-without-network');
  assert.equal(existsSync(join(dir,'frontend')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('disposal retains the callback-owned cold warm timing byte and quota evidence',async()=>{
 const r=row(),cold=(await actual([r])).output;
 const warm=(await actual([r],cold.cache,[],url=>response(url,null,304,'"bridge-tag"'))).output;
 const outputs=[cold,warm];let retained=null;
 const reader=createConditionalDeploymentJobsReader({scope:clone(scope),token:()=>TOKEN,
  report:value=>{retained=value;},run:()=>JSON.stringify(outputs.shift())});
 reader.read([r]);reader.read([r]);reader.dispose();
 assert.equal(reader.disposed,true);assert.equal(reader.stats().cache_bytes,2);
 assert.ok(retained);assert.equal(retained.historical_batches.length,2);
 assert.equal(retained.historical_batches[0].http_200,1);assert.equal(retained.historical_batches[1].http_304,1);
 for(const batch of retained.historical_batches){
  assert.equal(Number.isSafeInteger(batch.elapsed_ms)&&batch.elapsed_ms>=0,true);
  assert.equal(Number.isSafeInteger(batch.stdout_bytes)&&batch.stdout_bytes>0,true);
  assert.match(batch.stdout_sha256,/^[a-f0-9]{64}$/);
  assert.equal(batch.last_actual_route_quota['x-ratelimit-remaining'],4500);
 }
 reader.dispose();assert.equal(retained.historical_batches.length,2);
 assert.doesNotMatch(JSON.stringify(retained),new RegExp(TOKEN));
});

const CACHE_NOW=Date.parse('2026-10-09T01:30:00Z');
function jobContext(changes={}){
 return {...clone(scope),job_id:99001,job_name:'Synthetic bridge job',job_started_at:'2026-10-09T01:00:00Z',
  role:'diagnostic',controller_tree:'c'.repeat(40),request_sha256:'d'.repeat(64),event_sha256:'e'.repeat(64),
  schema_version:'conditional-deployment-jobs-cache-context-v1',
  reader_version:'265ede759b1714c882015c696c6fac66975ae03a',representation:clone(REQUEST_REPRESENTATION),...changes};
}
function cacheFixture(t,{now=()=>CACHE_NOW}={}){
 const old=process.env.RUNNER_TEMP,root=mkdtempSync(join(tmpdir(),'conditional-bridge-cache-'));
 process.env.RUNNER_TEMP=root;
 t.after(()=>{if(old===undefined)delete process.env.RUNNER_TEMP;else process.env.RUNNER_TEMP=old;rmSync(root,{recursive:true,force:true});});
 const context=jobContext(),handle=initializeJobCache({context,root,token:TOKEN,now});
 return {root,context,handle,directory:handle.directory,now};
}
const reopen=f=>openJobCache({context:f.context,directory:f.directory,token:TOKEN,now:f.now});
const cleanCache=f=>cleanupJobCache({context:f.context,directory:f.directory,token:TOKEN});
function retainedIds(handle){return handle.loadVerified().runs.map(r=>r.id).sort((a,b)=>a-b);}
test('complete combined publisher and Static cohort survives separate owned reader invocations',async t=>{
 const f=cacheFixture(t),rows=[row(11),row(22,{workflow_id:364666954,path:'.github/workflows/research-ui-release.yml'})];
 const cold=(await actual(rows)).output,warm=(await actual(rows,cold.cache,[],url=>response(url,null,304,'"bridge-tag"'))).output;
 const first=bridge([cold],{jobCache:f.handle});first.reader.read(rows);first.reader.dispose();
 assert.equal(isOwnedJobCacheHandle(f.handle),false);assert.equal(existsSync(join(f.directory,'lease.json')),false);
 const handle=reopen(f);assert.deepEqual(retainedIds(handle),[11,22]);
 const second=bridge([warm],{jobCache:handle});assert.equal(second.reader.read(rows).size,2);second.reader.dispose();
 assert.equal(second.configs[0].cache.length,2);assert.equal(second.reports[0].counts.conditional_http_304,2);
 assert.equal(second.reports[0].job_cache_events.find(x=>x.operation==='commit').generation,2);
 const verify=reopen(f);assert.deepEqual(retainedIds(verify),[11,22]);verify.dispose();cleanCache(f);
});
test('newly bound critical identities are removed before config construction and durable commit',async t=>{
 const f=cacheFixture(t),source=row(11,{head_sha:scope.controller_sha}),
  ci=row(33,{head_sha:scope.controller_sha,workflow_id:294252465,path:'.github/workflows/ci.yml'}),
  publisher=row(22,{workflow_id:364666954,path:'.github/workflows/research-ui-release.yml'}),rows=[source,ci,publisher];
 const cold=(await actual(rows)).output;
 const excluded=[scope.run_id,source.id,ci.id];
 const warm=(await actual(rows,cold.cache,excluded,(url,init,r)=>{
  if(excluded.includes(r.id)){assert.equal(init.headers['if-none-match'],undefined);return response(url,{total_count:1,jobs:[job(r,100+r.id)]});}
  assert.ok(init.headers['if-none-match']);return response(url,null,304,'"bridge-tag"');
 })).output;
 const b=bridge([cold,warm],{jobCache:f.handle});
 withConditionalDeploymentJobsReader(b.reader,()=>{
  b.reader.read(rows);noteScopedApiRead('repos/'+REPO+'/actions/runs/11',false,source);
  noteScopedApiRead('repos/'+REPO+'/actions/runs/33',false,ci);b.reader.read(rows);
 });
 assert.equal(b.configs[1].cache.length,1);assert.ok(b.configs[1].cache[0].url.includes('/22/jobs'));
 assert.deepEqual(b.configs[1].excludedIds.slice().sort((a,c)=>a-c),excluded.slice().sort((a,c)=>a-c));
 const verify=reopen(f);assert.deepEqual(retainedIds(verify),[22]);verify.dispose();cleanCache(f);
});
test('fresh missing rerun and active membership prunes old validators before the native worker',async t=>{
 const f=cacheFixture(t),prior=[row(11),row(22),row(33)],cold=(await actual(prior)).output;
 const first=bridge([cold],{jobCache:f.handle});first.reader.read(prior);first.reader.dispose();
 const current=[row(11,{run_attempt:2,updated_at:'2026-10-09T01:20:00Z'}),
  row(22,{status:'in_progress',conclusion:null,updated_at:'2026-10-09T01:20:00Z'})];
 const updated=(await actual(current,[],[],(url,init,r)=>{
  assert.equal(init.headers['if-none-match'],undefined);
  const j=job(r,100+r.id,r.status==='in_progress'?{status:'in_progress',conclusion:null,completed_at:null,steps:[]}:{});
  if(r.status==='in_progress'){assert.equal(j.status,'in_progress');assert.equal(j.conclusion,null);assert.equal(j.completed_at,null);assert.deepEqual(j.steps,[]);}
  return response(url,{total_count:1,jobs:[j]});
 })).output;
 assert.equal(updated.status,'complete');
 const second=bridge([updated],{jobCache:reopen(f)});second.reader.read(current);second.reader.dispose();
 assert.equal(second.configs[0].cache.length,0);
 const verify=reopen(f);assert.deepEqual(retainedIds(verify),[11]);verify.dispose();cleanCache(f);
});
test('unowned foreign-context and wrong-token cache adoption cannot create a usable reader',t=>{
 const unowned={context:jobContext(),assertPrivateToken(){},loadVerified(){return {pages:[]};}};
 assert.throws(()=>createConditionalDeploymentJobsReader({scope,token:()=>TOKEN,jobCache:unowned}),/unowned-or-already-adopted/);
 for(const kind of['context','token']){
  const f=cacheFixture(t);let calls=0;
  assert.throws(()=>createConditionalDeploymentJobsReader({scope:kind==='context'?{...scope,run_id:901}:scope,
   token:()=>kind==='token'?'different-synthetic-token':TOKEN,jobCache:f.handle,run:()=>{calls++;}}),
   /job-cache-scope-mismatch|private-cache-token-mismatch/);
  assert.equal(calls,0);assert.equal(isOwnedJobCacheHandle(f.handle),false);
  assert.throws(()=>reopen(f),/incomplete-or-locked-cache/);cleanCache(f);
 }
});
test('missing initialized files fail before any worker and poison the owned lease',t=>{
 const f=cacheFixture(t);let calls=0;const saved=readFileSync(join(f.directory,'cache.json'));
 const b=createConditionalDeploymentJobsReader({scope,token:()=>TOKEN,jobCache:f.handle,run:()=>{calls++;}});
 rmSync(join(f.directory,'cache.json'));
 assert.throws(()=>b.read([row()]));assert.equal(calls,0);assert.equal(b.disposed,true);
 writeFileSync(join(f.directory,'cache.json'),saved,{mode:0o600});
 assert.throws(()=>f.handle.loadVerified(),/disposed-or-unowned/);assert.throws(()=>reopen(f),/incomplete-or-locked-cache/);cleanCache(f);
});
test('counted HTTP403 after a valid batch leaves no partial commit and a failed job lease',async t=>{
 const f=cacheFixture(t),r=row(),cold=(await actual([r])).output;
 const failed=(await actual([r],cold.cache,[],url=>response(url,{message:'denied'},403))).output;
 const error=Object.assign(Error('actual synthetic nonzero worker failure'),{status:1,stdout:JSON.stringify(failed)});
 const b=bridge([cold,error],{jobCache:f.handle});b.reader.read([r]);assert.throws(()=>b.reader.read([r]),/worker-command-failed/);
 assert.equal(JSON.parse(readFileSync(join(f.directory,'manifest.json'),'utf8')).generation,1);
 assert.equal(JSON.parse(readFileSync(join(f.directory,'lease.json'),'utf8')).status,'failed');
 assert.equal(b.reports[0].counts.conditional_requests_issued,2);assert.equal(b.reports[0].counts.conditional_http_other_status,1);
 assert.equal(b.reports[0].historical_batches[1].status,'failed');assert.throws(()=>reopen(f),/incomplete-or-locked-cache/);cleanCache(f);
});
test('nested invocation helpers and repeated owned wrappers keep one cache lease until outer completion',async t=>{
 const f=cacheFixture(t),r=row(),cold=(await actual([r])).output,
  warm=(await actual([r],cold.cache,[],url=>response(url,null,304,'"bridge-tag"'))).output;
 const b=bridge([cold,warm],{jobCache:f.handle});
 await withConditionalDeploymentJobsReader(b.reader,async()=>{
  assert.throws(()=>reopen(f),/incomplete-or-locked-cache/);
  await withInvocationImmutableGitApi(REPO,()=>withInvocationConditionalDeploymentJobs(REPO,async()=>{
   assert.equal(readScopedDeploymentJobs(REPO,()=>{},[r]).size,1);
   await withInvocationImmutableGitApi(REPO,()=>withConditionalDeploymentJobsReader(b.reader,async()=>{
    await Promise.resolve();assert.equal(readScopedDeploymentJobs(REPO,()=>{},[r]).size,1);
   }));
   assert.equal(b.reader.disposed,false);assert.equal(existsSync(join(f.directory,'lease.json')),true);
  }));
  assert.equal(b.reader.disposed,false);
  assert.throws(()=>withInvocationConditionalDeploymentJobs('foreign/repository',()=>{}),/foreign-or-unowned/);
 });
 assert.equal(b.reader.disposed,true);assert.equal(b.reports.length,1);assert.equal(b.configs[1].cache.length,1);
 assert.equal(existsSync(join(f.directory,'lease.json')),false);cleanCache(f);
});
test('caught nested work rejection still poisons the job and preserves original error identity',async t=>{
 const f=cacheFixture(t),original=Error('synthetic nested source helper failed'),b=bridge([],{jobCache:f.handle});
 await assert.rejects(withConditionalDeploymentJobsReader(b.reader,async()=>{
  await assert.rejects(withInvocationConditionalDeploymentJobs(REPO,async()=>{throw original;}),e=>e===original);
  assert.equal(b.reader.disposed,true);assert.throws(()=>b.reader.read([]),/disposed-history-scope/);
 }),/failed-history-scope/);
 assert.equal(b.reports.length,1);assert.equal(b.reports[0].status,'failed');
 assert.throws(()=>reopen(f),/incomplete-or-locked-cache/);cleanCache(f);
});
test('same handle cannot be adopted by a second reader while its owner is live',t=>{
 const f=cacheFixture(t),first=bridge([],{jobCache:f.handle});
 assert.throws(()=>bridge([],{jobCache:f.handle}),/unowned-or-already-adopted/);
 assert.equal(first.reader.disposed,false);assert.equal(isOwnedJobCacheHandle(f.handle),true);
 first.reader.dispose();cleanCache(f);
});
test('expired owned cache is terminal before the native worker with unchanged110-minute ceiling',t=>{
 let now=CACHE_NOW;const f=cacheFixture(t,{now:()=>now});let calls=0;
 const b=createConditionalDeploymentJobsReader({scope,token:()=>TOKEN,jobCache:f.handle,run:()=>{calls++;}});
 now=Date.parse(f.context.job_started_at)+110*60*1000;
 assert.throws(()=>b.read([row()]),/future-or-expired-cache-job/);
 assert.equal(calls,0);assert.equal(b.disposed,true);assert.equal(isOwnedJobCacheHandle(f.handle),false);cleanCache(f);
});
test('real separate Node processes reopen a job cache and independently reconstruct actual worker304 output',async t=>{
 const f=cacheFixture(t);f.handle.dispose();const rows=[row(11),row(22,{workflow_id:364666954,path:'.github/workflows/research-ui-release.yml'})];
 const cold=(await actual(rows)).output,warm=(await actual(rows,cold.cache,[],url=>response(url,null,304,'"bridge-tag"'))).output;
 const modulePath=join(dirname(fileURLToPath(import.meta.url)),'conditional-deployment-jobs.mjs'),
  cachePath=join(dirname(fileURLToPath(import.meta.url)),'conditional-deployment-jobs-cache.mjs');
 function phase(output){
  const code="import {openJobCache} from "+JSON.stringify('file://'+cachePath)+";import {createConditionalDeploymentJobsReader} from "+JSON.stringify('file://'+modulePath)+";"+
   "const handle=openJobCache({context:JSON.parse(process.env.BRIDGE_TEST_CONTEXT),directory:process.env.BRIDGE_TEST_DIRECTORY,token:process.env.GH_TOKEN,now:()=>"+CACHE_NOW+"});"+
   "let cachePages=null,report=null;const reader=createConditionalDeploymentJobsReader({scope:"+JSON.stringify(scope)+",jobCache:handle,report:v=>{report=v;},run:(_c,_a,o)=>{cachePages=JSON.parse(o.input).cache.length;return process.env.BRIDGE_TEST_WORKER_RESULT;}});"+
   "const jobs=reader.read("+JSON.stringify(rows)+");reader.dispose();if(jobs.size!==2)throw Error('incomplete cross-process jobs');console.log(JSON.stringify({cachePages,counts:report.counts,generation:report.job_cache_events.find(v=>v.operation==='commit').generation}));";
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:10000,maxBuffer:1024**2,
   env:{...process.env,GH_TOKEN:TOKEN,GITHUB_TOKEN:'',BRIDGE_TEST_CONTEXT:JSON.stringify(f.context),BRIDGE_TEST_DIRECTORY:f.directory,BRIDGE_TEST_WORKER_RESULT:JSON.stringify(output)}});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.stdout+result.stderr,new RegExp(TOKEN));return JSON.parse(result.stdout);
 }
 const first=phase(cold),second=phase(warm);
 assert.equal(first.cachePages,0);assert.equal(first.counts.conditional_http_200,2);assert.equal(first.generation,1);
 assert.equal(second.cachePages,2);assert.equal(second.counts.conditional_http_304,2);assert.equal(second.generation,2);cleanCache(f);
});

// Isolated synthetic finite phases use actual managed API/history hooks, the real
// worker function with a fake fetcher, and authenticated private storage. Responses
// and caller proofs are synthetic; these tests grant no live publication authority.
const OPENER_CHILD_PRELUDE="\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport cp from 'node:child_process';\nimport {syncBuiltinESMExports} from 'node:module';\nimport {join} from 'node:path';\nimport {tmpdir} from 'node:os';\nconst bridgeLocation=__BRIDGE_URL__;\nconst history=await import(bridgeLocation);\nconst {readConditionalDeploymentJobs}=await import(new URL('./conditional-deployment-jobs-worker.mjs',bridgeLocation));\nconst {finiteTransportPolicy}=await import(new URL('./retained-price-finite-transport-policy.mjs',bridgeLocation));\nconst role=process.env.OPENER_TEST_ROLE??'publisher';\nconst repo='kusennjp1-ai/screener',rid=1203919607,head='b'.repeat(40),tree='c'.repeat(40),runId=900,jobId=99001;\nconst token='synthetic-opener-only-token',outer=fs.mkdtempSync(join(tmpdir(),'conditional-opener-')),\n root=join(outer,'controller'),temp=join(outer,'runner'),eventPath=join(outer,'event.json'),envPath=join(temp,'github-env');\nfs.mkdirSync(join(root,'.github/scripts'),{recursive:true});fs.mkdirSync(temp);fs.writeFileSync(envPath,'',{mode:0o600});\nconst workflow=role==='publisher'?'research-ui-release.yml':'static-site.yml',jobName=role==='publisher'?'publish':'combine-and-build';\nconst source={id:777,run_attempt:1,head_sha:head,head_branch:'main',\n workflow_id:role==='publisher'?294257497:294252465,\n path:role==='publisher'?'.github/workflows/static-site.yml':'.github/workflows/ci.yml',\n event:role==='publisher'?'workflow_run':'push',status:'completed',conclusion:'success',\n repository:{id:rid,full_name:repo},head_repository:{id:rid,full_name:repo}};\nfs.writeFileSync(eventPath,JSON.stringify({action:'completed',repository:{id:rid,full_name:repo,default_branch:'main'},workflow_run:source}));\nfs.writeFileSync(join(root,'.github/retained-price-oct6-source.json'),JSON.stringify({schema_version:'retained-price-oct6-source-v1',enabled:true,activation:{synthetic:true}}));\nconst names={attempted:'RETAINED_PRICE_CONDITIONAL_CACHE_ATTEMPTED',initialized:'RETAINED_PRICE_CONDITIONAL_CACHE_INITIALIZED',\n directory:'RETAINED_PRICE_CONDITIONAL_CACHE_DIRECTORY',context:'RETAINED_PRICE_CONDITIONAL_CACHE_CONTEXT'};\nfor(const n of Object.values(names))delete process.env[n];delete process.env.RETAINED_PRICE_CONTROLLER_ROOT;delete process.env.RETAINED_PRICE_PUBLISHER_JOB_START;\nObject.assign(process.env,{GITHUB_REPOSITORY:repo,GITHUB_REPOSITORY_ID:String(rid),GITHUB_REF:'refs/heads/main',\n GITHUB_EVENT_NAME:'workflow_run',GITHUB_SHA:head,GITHUB_WORKFLOW_SHA:head,GITHUB_RUN_ID:String(runId),GITHUB_RUN_ATTEMPT:'1',\n GITHUB_WORKFLOW_REF:repo+'/.github/workflows/'+workflow+'@refs/heads/main',GITHUB_EVENT_PATH:eventPath,GITHUB_JOB:jobName,\n RUNNER_TEMP:temp,GITHUB_ENV:envPath,GH_TOKEN:token,GITHUB_TOKEN:'',RETAINED_PRICE_CONDITIONAL_CACHE_MODE:'initialize'});\nprocess.chdir(root);process.execArgv.splice(0);\nconst started=new Date(Date.now()-3000).toISOString(),clockPath=join(temp,role==='publisher'?'retained-price-publisher-job-start':'retained-price-source-job-start');\nfs.writeFileSync(clockPath,String(Math.floor(Date.parse(started)/1000)),{mode:0o600});\nconst initialTempEntries=fs.readdirSync(temp).sort();\nconst run={...source,id:runId,workflow_id:role==='publisher'?364666954:294257497,\n path:'.github/workflows/'+workflow,event:'workflow_run',status:'in_progress',conclusion:null,run_started_at:started},\n job={id:jobId,name:jobName,run_id:runId,run_attempt:1,head_sha:head,status:'in_progress',conclusion:null,started_at:started,steps:[]};\nconst caller={run,attempt:1,job,job_started_at:started,commit:{sha:head,tree:{sha:tree}}};\nconst binding={repository:repo,controller:{head,tree},caller,role,criticalIds:[777,778]};\nconst noApi=()=>{throw Error('Unexpected authority/network call');};\nconst policy=finiteTransportPolicy(role);let phaseIndex=0,phase=policy.phases[0],advanceBeforeNext=false,active=null;\nfunction selectPhase(index){\n assert.ok(index<policy.phases.length,'Synthetic lifecycle has no further reviewed phase');\n phaseIndex=index;phase=policy.phases[index];\n const stamp=new Date(Date.now()).toISOString();\n job.steps=policy.phases.slice(0,index).map((p,i)=>({number:i+1,name:p.step,status:'completed',conclusion:'success',started_at:started,completed_at:stamp}));\n if(role==='publisher'&&index>=1)job.steps.push({number:50,name:'Prepare immutable controller for finite price publication',status:'completed',conclusion:'success',started_at:started,completed_at:stamp});\n job.steps.push({number:100,name:phase.step,status:'in_progress',conclusion:null,started_at:stamp,completed_at:null});\n let argv;\n if(role==='publisher')argv=phase.id==='browser'?[]:[phase.command];\n else argv=phase.id==='produce'?['produce','--output',join(outer,'output'),'--job-start',clockPath]:\n  phase.id==='verify-produced'?['verify-produced','--output',join(outer,'output')]:\n  ['companion','--output',join(outer,'output'),'--artifact-id','1','--artifact-digest','d'.repeat(64)];\n process.argv.splice(1,Infinity,join(root,phase.script),...argv);\n if(role==='publisher'&&phase.id==='restore')process.env.RETAINED_PRICE_PUBLISHER_JOB_START=clockPath;\n else delete process.env.RETAINED_PRICE_PUBLISHER_JOB_START;\n}\nselectPhase(0);\nconst reset=Math.floor(Date.now()/1000)+3600;\nconst scope={repository:repo,repository_id:rid,run_id:runId,run_attempt:1,controller_sha:head};\nconst historyRun={id:11,run_attempt:1,head_sha:'a'.repeat(40),head_branch:'main',workflow_id:294257497,\n path:'.github/workflows/static-site.yml',name:'Synthetic terminal history',event:'workflow_dispatch',\n repository:{id:rid,full_name:repo},head_repository:{id:rid,full_name:repo},\n status:'completed',conclusion:'success',created_at:'2026-10-09T01:00:00Z',run_started_at:'2026-10-09T01:00:00Z',updated_at:'2026-10-09T01:10:00Z'};\nconst historyJob={id:11001,run_id:11,run_attempt:1,head_sha:historyRun.head_sha,head_branch:'main',workflow_name:historyRun.name,\n name:'Synthetic non-deployment job',run_url:'https://api.github.com/repos/'+repo+'/actions/runs/11',\n url:'https://api.github.com/repos/'+repo+'/actions/jobs/11001',html_url:'https://github.com/'+repo+'/actions/runs/11/job/11001',\n status:'completed',conclusion:'success',created_at:'2026-10-09T01:00:01Z',started_at:'2026-10-09T01:00:02Z',completed_at:'2026-10-09T01:00:05Z',\n steps:[{number:1,name:'Synthetic non-deployment step',status:'completed',conclusion:'success',started_at:'2026-10-09T01:00:03Z',completed_at:'2026-10-09T01:00:04Z'}]};\nlet fakeFetches=0;\nasync function workerResult(cache){\n let clock=0;\n const value=await readConditionalDeploymentJobs({scope,runs:[historyRun],cache,excludedIds:[900,777,778],timeoutMs:120000,maximumRequests:200},{\n  token,monotonic:()=>clock,pause:async ms=>{clock+=ms;},\n  fetcher:async(url,init)=>{\n   fakeFetches++;assert.equal(url,'https://api.github.com/repos/'+repo+'/actions/runs/11/jobs?filter=all&per_page=100');\n   assert.equal(init.headers.authorization,'Bearer '+token);\n   const status=init.headers['if-none-match']?304:200;\n   const response=new Response(status===304?null:JSON.stringify({total_count:1,jobs:[historyJob]}),{status,headers:{\n    'content-type':'application/json','etag':'\"synthetic-history\"','vary':'Accept, Authorization, Accept-Encoding',\n    'x-ratelimit-limit':'5000','x-ratelimit-used':'0','x-ratelimit-remaining':'5000','x-ratelimit-reset':String(reset),'x-ratelimit-resource':'core'}});\n   Object.defineProperty(response,'url',{value:url});return response;\n  }});\n assert.equal(value.status,'complete');assert.equal(value.jobs.length,1);return value;\n}\nconst cold=await workerResult([]),warm=await workerResult(cold.cache);assert.equal(fakeFetches,2);\nlet nativeCommands=0,syntheticCommands=0,workerCommands=0;\nconst nativeExec=cp.execFileSync;\ncp.execFileSync=(command,args,options={})=>{\n syntheticCommands++;\n if(command==='gh'){\n  if(args.includes('--include')){\n   assert.ok(args.includes('https://api.github.com/repos/'+repo+'/actions/runs/'+runId));\n   return Buffer.from('HTTP/1.1 200 OK\\r\\ncontent-type: application/json\\r\\nx-ratelimit-limit: 5000\\r\\nx-ratelimit-used: 0\\r\\nx-ratelimit-remaining: 5000\\r\\nx-ratelimit-reset: '+reset+'\\r\\nx-ratelimit-resource: core\\r\\n\\r\\n'+JSON.stringify(run));\n  }\n  return JSON.stringify({synthetic:true});\n }\n if(command===process.execPath&&args.some(v=>v.endsWith('/conditional-deployment-jobs-worker.mjs'))){\n  workerCommands++;const spec=JSON.parse(options.input);\n  assert.deepEqual(spec.scope,scope);assert.deepEqual(spec.runs,[historyRun]);assert.equal(spec.maximumRequests,200);\n  assert.ok(spec.excludedIds.includes(runId));return JSON.stringify(spec.cache.length?warm:cold);\n }\n nativeCommands++;throw Error('Unexpected native command');\n};\nsyncBuiltinESMExports();\nconst reports=[];console.error=value=>{reports.push(JSON.parse(value));};\nfunction paidApi(own=false){\n const result=history.readScopedTransportApi(own?'repos/'+repo+'/actions/runs/'+runId:'repos/'+repo,false);\n assert.equal(result.handled,true);return result.value;\n}\nfunction readHistory(){\n assert.ok(active,'History fixture requires an active invocation');\n const point=phase.history_positions[active.historyCount];assert.ok(point,'No extra synthetic history round');\n while(active.cursor<point.planned_primary_before){paidApi();active.cursor++;}\n const result=history.readScopedDeploymentJobs(repo,noApi,[historyRun]);\n assert.equal(result.size,1);assert.deepEqual(result.get(historyRun.id),[historyJob]);\n active.cursor=point.planned_primary_before+point.planned_primary;active.historyCount++;return result;\n}\nfunction invoke(work=()=>readHistory(),{complete=true}={}){\n if(advanceBeforeNext){selectPhase(phaseIndex+1);advanceBeforeNext=false;}\n active={cursor:phase.history_positions[0].planned_primary_before,historyCount:0};\n try{\n  const value=history.withInvocationConditionalDeploymentJobs(repo,()=>{\n   assert.equal(history.hasScopedConditionalJobContext(repo),true);assert.equal(history.hasScopedFiniteTransportBudget(repo),true);\n   assert.equal(history.bindScopedConditionalCaller(binding),true);\n   // Synthetic, fully accounted bootstrap through the genuine API hooks.\n   // Fixed high response headers fund the lifecycle fixture; no real quota is claimed.\n   for(let i=0;i<phase.history_positions[0].planned_primary_before;i++)paidApi(i===8);\n   const value=work();\n   if(complete){\n    while(active.historyCount<phase.history_positions.length)readHistory();\n    while(active.cursor<phase.planned_primary){paidApi();active.cursor++;}\n   }\n   return value;\n  });\n  advanceBeforeNext=true;return value;\n }finally{active=null;}\n}\nfunction state(){return Object.fromEntries(Object.entries(names).map(([k,n])=>[k,process.env[n]??null]));}\nfunction initialized(){const value=invoke();assert.equal(value.size,1);const s=state();assert.equal(s.attempted,'v1');assert.equal(s.initialized,'v1');return s;}\nfunction cleanup(){return history.cleanupConditionalInvocationJobCache();}\ntry{\n__CASE_BODY__\nassert.equal(nativeCommands,0);\nassert.equal(reports.reduce((n,v)=>n+v.counts.conditional_requests_issued,0),workerCommands);\nconst evidence=JSON.stringify({ok:true,native_commands:nativeCommands,synthetic_commands:syntheticCommands,worker_commands:workerCommands,scopes:reports.length});\nassert.equal(evidence.includes(token),false);process.stdout.write(evidence);\n}finally{cp.execFileSync=nativeExec;syncBuiltinESMExports();fs.rmSync(outer,{recursive:true,force:true});}\n";

function openerChild(body,role='publisher'){
 const path=join(dirname(fileURLToPath(import.meta.url)),'conditional-deployment-jobs.mjs');
 const script=OPENER_CHILD_PRELUDE.replace('__BRIDGE_URL__',JSON.stringify(pathToFileURL(path).href)).replace('__CASE_BODY__',body);
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:30000,maxBuffer:1024**2,
  env:{...process.env,GH_TOKEN:'',GITHUB_TOKEN:'',OPENER_TEST_ROLE:role,OPENER_TEST_BRIDGE_PATH:path}});
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
 assert.doesNotMatch(result.stdout+result.stderr,/synthetic-opener-only-token/);
 const value=JSON.parse(result.stdout);assert.equal(value.ok,true);assert.equal(value.native_commands,0);return value;
}

test("verified finite registration stays allocation-free until the first history read",()=>{for(const role of ["publisher","producer-combine"])openerChild("\nassert.throws(()=>invoke(()=>{\n assert.equal(state().attempted,null);assert.deepEqual(fs.readdirSync(temp).sort(),initialTempEntries);\n return history.withInvocationConditionalDeploymentJobs(repo,()=>{assert.equal(state().attempted,null);return 'registered-only';});\n},{complete:false}),/incomplete-history-sequence/);\nassert.equal(state().attempted,null);assert.equal(cleanup().status,'not-initialized');\n",role);});

test("first finite phase initializes exact public state and later nested/resumed phases reuse its lease",()=>{for(const role of ["publisher","producer-combine"])openerChild("\ninvoke(()=>{\n const result=readHistory();assert.equal(result.size,1);\n const s=state();assert.equal(s.attempted,'v1');assert.equal(s.initialized,'v1');\n assert.equal(fs.existsSync(join(s.directory,'lease.json')),true);\n history.withInvocationConditionalDeploymentJobs(repo,()=>{assert.equal(readHistory().size,1);});\n assert.equal(fs.existsSync(join(s.directory,'lease.json')),true);\n});\nconst s=state(),env=fs.readFileSync(envPath,'utf8'),generation=JSON.parse(fs.readFileSync(join(s.directory,'manifest.json'))).generation;\nassert.equal(env.includes(token),false);\nassert.equal(env.includes(names.directory+'='+s.directory+'\\n'),true);assert.equal(env.includes(names.initialized+'=v1\\n'),true);\nassert.equal(fs.existsSync(join(s.directory,'lease.json')),false);\nprocess.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE='';\nassert.equal(invoke().size,1);assert.equal(phase.ordinal,2);assert.equal(state().context,s.context);\nassert.ok(JSON.parse(fs.readFileSync(join(s.directory,'manifest.json'))).generation>generation);\nassert.equal(cleanup().status,'initialized-state-removed');assert.equal(fs.existsSync(s.directory),false);\n",role);});

test("later applicable phase cannot silently initialize missing state",()=>{openerChild("\nprocess.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE='resume';\nassert.throws(()=>invoke(),/missing-initialized-conditional-cache/);\nassert.deepEqual(state(),{attempted:null,initialized:null,directory:null,context:null});\nassert.deepEqual(fs.readdirSync(temp).sort(),initialTempEntries);\n");});

test("missing initialized variable or file fails before worker and never reinitializes",()=>{openerChild("\nconst s=initialized();process.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE='';\ndelete process.env[names.initialized];assert.throws(()=>invoke(),/missing-initialized-conditional-cache/);\nprocess.env[names.initialized]='v1';fs.unlinkSync(join(s.directory,'cache.json'));\nassert.throws(()=>invoke(),/incomplete-or-locked-cache/);\nassert.equal(fs.existsSync(join(s.directory,'lease.json')),false);\nprocess.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE='initialize';\nassert.throws(()=>invoke(),/conditional-cache-already-initialized/);\nassert.equal(cleanup().status,'initialized-state-removed');\n");});

test("missing initialized directory remains a terminal cleanup and later-phase failure",()=>{openerChild("\nconst s=initialized();fs.rmSync(s.directory,{recursive:true});process.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE='';\nassert.throws(()=>invoke(),/ENOENT/);assert.throws(()=>cleanup(),/initialized-conditional-cache-disappeared/);\nprocess.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE='initialize';assert.throws(()=>invoke(),/conditional-cache-already-initialized/);\nassert.equal(state().initialized,'v1');\n");});

test("original finite work error poisons the phase and authenticated cleanup removes only its directory",()=>{openerChild("\nconst original=Error('synthetic finite action failed');let directory;\nassert.throws(()=>invoke(()=>{readHistory();directory=state().directory;throw original;}),e=>e===original);\nassert.equal(JSON.parse(fs.readFileSync(join(directory,'lease.json'))).status,'failed');\nprocess.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE='';assert.throws(()=>invoke(),/incomplete-or-locked-cache/);\nconst sibling=join(temp,'unrelated');fs.mkdirSync(sibling);fs.writeFileSync(join(sibling,'keep'),'public synthetic sentinel');\nassert.equal(cleanup().status,'initialized-state-removed');assert.equal(fs.existsSync(directory),false);\nassert.equal(fs.existsSync(join(sibling,'keep')),true);\n");});

test("initializer rejects unreviewed command step and exec arguments before storage allocation",()=>{openerChild("\nconst validArgv=[...process.argv],validExec=[...process.execArgv],savedSteps=JSON.parse(JSON.stringify(job.steps));\nconst expected={command:/unreviewed-finite-cli-step/,entry:/unreviewed-finite-command/,exec:/unreviewed-finite-node-options/,step:/unreviewed-finite-cli-step/};\nfor(const kind of['command','entry','exec','step']){\n process.argv.splice(0,Infinity,...validArgv);process.execArgv.splice(0,Infinity,...validExec);job.steps=JSON.parse(JSON.stringify(savedSteps));\n if(kind==='command')process.argv[2]='restore';if(kind==='entry')process.argv[1]=join(root,'.github/scripts/other.mjs');\n if(kind==='exec')process.execArgv.push('--input-type=module');if(kind==='step')job.steps[0].status='completed';\n assert.throws(()=>invoke(),expected[kind]);assert.equal(state().attempted,null);\n assert.deepEqual(fs.readdirSync(temp).sort(),initialTempEntries);\n}\nprocess.argv.splice(0,Infinity,...validArgv);process.execArgv.splice(0,Infinity,...validExec);job.steps=savedSteps;\n");});

test("fresh caller mutation and public-state mutation cannot reuse an old cache context",()=>{openerChild("\nconst s=initialized();process.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE='';\nbinding.controller.tree='d'.repeat(40);caller.commit.tree.sha=binding.controller.tree;\nassert.throws(()=>invoke(),/public-cache-context-disagrees-with-fresh-caller/);\nbinding.controller.tree=tree;caller.commit.tree.sha=tree;\nassert.throws(()=>invoke(()=>{readHistory();process.env[names.context]='forged';return readHistory();}),/private-invocation-binding-changed/);\nprocess.env[names.context]=s.context;\nassert.equal(JSON.parse(fs.readFileSync(join(s.directory,'lease.json'))).status,'failed');\nassert.equal(cleanup().status,'initialized-state-removed');\n");});

test("private token changes reject reuse without persisting a credential",()=>{openerChild("\nconst s=initialized();process.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE='';\nassert.throws(()=>invoke(()=>{readHistory();process.env.GH_TOKEN=token+'-different';return readHistory();}),/private-invocation-binding-changed/);\nfor(const file of['cache.json','manifest.json','lease.json'])assert.equal(fs.readFileSync(join(s.directory,file),'utf8').includes(token),false);\nassert.throws(()=>cleanup(),/authentication-failed/);process.env.GH_TOKEN=token;\nassert.equal(cleanup().status,'initialized-state-removed');\n");});

test("initializer failure retains exact attempted directory and original error for authenticated cleanup",()=>{openerChild("\nconst native=fs.renameSync,original=Error('synthetic initializer manifest failure');fs.renameSync=function(from,to){\n if(to.endsWith('/manifest.json'))throw original;return Reflect.apply(native,this,arguments);};\nassert.throws(()=>invoke(),e=>e===original);fs.renameSync=native;\nconst s=state();assert.equal(s.attempted,'v1');assert.equal(s.initialized,null);assert.equal(typeof s.directory,'string');\nassert.equal(JSON.parse(fs.readFileSync(join(s.directory,'lease.json'))).status,'failed');\nassert.equal(fs.readFileSync(envPath,'utf8').includes(names.directory+'='+s.directory+'\\n'),true);\nconst sibling=join(temp,'keep');fs.writeFileSync(sibling,'unchanged');\nassert.equal(cleanup().status,'failed-initialization-state-removed');assert.equal(fs.existsSync(s.directory),false);\nassert.equal(fs.readFileSync(sibling,'utf8'),'unchanged');\n");});

test("failed initialized-marker publication preserves the original error and recoverable owned state",()=>{openerChild("\nconst native=fs.writeSync,original=Error('synthetic initialized environment failure');\nfs.writeSync=function(fd,bytes,...args){if(Buffer.isBuffer(bytes)&&bytes.includes(Buffer.from(names.initialized+'=v1\\n')))throw original;\n return Reflect.apply(native,this,[fd,bytes,...args]);};syncBuiltinESMExports();\nassert.throws(()=>invoke(),e=>e===original);fs.writeSync=native;syncBuiltinESMExports();\nconst s=state();assert.equal(s.attempted,'v1');assert.equal(s.initialized,null);\nassert.equal(JSON.parse(fs.readFileSync(join(s.directory,'lease.json'))).status,'failed');\nassert.equal(cleanup().status,'failed-initialization-state-removed');assert.equal(fs.existsSync(s.directory),false);\n");});

test("failed first environment fsync leaves a truthful never-created recovery path for later runner steps",()=>{openerChild("\nconst native=fs.fsyncSync,original=Error('synthetic attempted environment fsync failure');let failed=false;\nfs.fsyncSync=function(fd){if(!failed&&fs.fstatSync(fd).isFile()){failed=true;throw original;}return Reflect.apply(native,this,arguments);};syncBuiltinESMExports();\nassert.throws(()=>invoke(),e=>e===original);fs.fsyncSync=native;syncBuiltinESMExports();\nassert.equal(state().attempted,null);\nfor(const line of fs.readFileSync(envPath,'utf8').trim().split('\\n')){const index=line.indexOf('=');process.env[line.slice(0,index)]=line.slice(index+1);}\nconst s=state();assert.equal(s.attempted,'v1');assert.equal(s.initialized,null);assert.equal(fs.existsSync(s.directory),false);\nassert.equal(cleanup().status,'attempted-directory-absent');assert.equal(state().attempted,'v1');\nprocess.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE='initialize';assert.throws(()=>invoke(),/conditional-cache-already-initialized/);\n");});

test("exclusive initializer collision cannot adopt or clean a foreign directory",()=>{openerChild("\nconst native=fs.mkdirSync;let collided=false;\nfs.mkdirSync=function(path,options){if(typeof path==='string'&&path.includes('/conditional-jobs-')&&!collided){\n collided=true;Reflect.apply(native,this,[path,{mode:0o700}]);fs.writeFileSync(join(path,'foreign'),'keep',{mode:0o600});}\n return Reflect.apply(native,this,arguments);};\nassert.throws(()=>invoke(),/EEXIST/);fs.mkdirSync=native;\nconst s=state();assert.equal(s.attempted,'v1');assert.equal(s.initialized,null);\nassert.throws(()=>cleanup());assert.equal(fs.readFileSync(join(s.directory,'foreign'),'utf8'),'keep');\nprocess.env.RETAINED_PRICE_CONDITIONAL_CACHE_MODE='initialize';assert.throws(()=>invoke(),/conditional-cache-already-initialized/);\n");});

test("actual closed cleanup CLI removes initialized state and rejects unknown arguments",()=>{openerChild("\nconst s=initialized(),bridgePath=process.env.OPENER_TEST_BRIDGE_PATH;\nconst bad=cp.spawnSync(process.execPath,[bridgePath,'unknown'],{encoding:'utf8',timeout:10000,maxBuffer:1024**2,env:{...process.env}});\nassert.notEqual(bad.status,0);assert.equal(fs.existsSync(s.directory),true);\nconst result=cp.spawnSync(process.execPath,[bridgePath,'cleanup'],{encoding:'utf8',timeout:10000,maxBuffer:1024**2,env:{...process.env}});\nassert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);\nassert.equal(JSON.parse(result.stdout).status,'initialized-state-removed');assert.equal(fs.existsSync(s.directory),false);\nassert.equal((result.stdout+result.stderr).includes(token),false);\n");});

test("empty finite cohort fails before the worker and never accepts a phase",()=>{openerChild("\nassert.throws(()=>invoke(()=>history.readScopedDeploymentJobs(repo,noApi,[])),/empty-finite-history-cohort/);\nassert.equal(workerCommands,0);const s=state();assert.equal(s.attempted,'v1');\nassert.equal(JSON.parse(fs.readFileSync(join(s.directory,'lease.json'))).status,'failed');\nassert.equal(cleanup().status,'initialized-state-removed');\n");});

test('finite pager numeric repository Links preserve raw requests and complete owned measurement',()=>{
 const body=`
const previousExec=cp.execFileSync,requests=[];
cp.execFileSync=(command,args,options={})=>{
 if(command==='gh'&&args[1].includes('/actions/workflows/')){
  syntheticCommands++;requests.push(args[1]);
  assert.deepEqual(args.slice(2),['--hostname','github.com','--include','--method','GET']);
  const url=new URL(args[1]),second=url.searchParams.get('page')==='2',file=url.pathname.split('/').at(-2);
  assert.ok(['research-ui-release.yml','static-site.yml'].includes(file));
  assert.equal(url.pathname,(second?'/repositories/'+rid:'/repos/'+repo)+'/actions/workflows/'+file+'/runs');
  const next='https://api.github.com/repositories/'+rid+'/actions/workflows/'+file+'/runs?branch=main&page=2&per_page=100';
  const value={total_count:101,workflow_runs:Array.from({length:second?1:100},(_,i)=>({id:second?101:i+1}))};
  return Buffer.from('HTTP/1.1 200 OK\\r\\ncontent-type: application/json\\r\\nx-ratelimit-limit: 5000\\r\\nx-ratelimit-used: 0\\r\\nx-ratelimit-remaining: 5000\\r\\nx-ratelimit-reset: '+reset+'\\r\\nx-ratelimit-resource: core\\r\\n'+
   (second?'':'link: <'+next+'>; rel="next", <'+next+'>; rel="last"\\r\\n')+'\\r\\n'+JSON.stringify(value));
 }
 return previousExec(command,args,options);
};syncBuiltinESMExports();
invoke(()=>{
 readHistory();
 for(const file of ['research-ui-release.yml','static-site.yml']){
  const result=history.readScopedTransportApi('repos/'+repo+'/actions/workflows/'+file+'/runs?branch=main&per_page=100',true);
  assert.equal(result.handled,true);assert.equal(result.value.length,2);
  assert.deepEqual(result.value.map(p=>p.workflow_runs.length),[100,1]);active.cursor++;
 }
});
assert.equal(requests.length,4);assert.equal(reports.length,1);
assert.equal(reports[0].measurement_incomplete,false);
assert.equal(reports[0].counts.gh_returned_pages,4);
assert.equal(reports[0].counts.gh_successful_paginated_invocations,4);
assert.equal(reports[0].counts.gh_invocations,syntheticCommands-workerCommands);
assert.equal(reports[0].status,'complete');assert.equal(reports[0].publication_authority,false);
const saved=JSON.parse(fs.readFileSync(join(state().directory,'cache.json'),'utf8')).payload.transport_budget;
assert.equal(saved.extra_primary_used.ordinary_extra,2);
assert.equal(saved.last_completed_phase,0);assert.equal(saved.pending_phase,null);
assert.equal(cleanup().status,'initialized-state-removed');
`;
 for(const role of ['publisher','producer-combine'])openerChild(body,role);
});
