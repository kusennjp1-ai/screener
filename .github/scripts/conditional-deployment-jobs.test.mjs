// Synthetic protocol/lifecycle tests. No real Actions proof or publication is minted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,copyFileSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
 createConditionalDeploymentJobsReader,withConditionalDeploymentJobsReader,
 withInvocationConditionalDeploymentJobs,readScopedDeploymentJobs,noteScopedApiRead,noteScopedInventoryRead,
} from './conditional-deployment-jobs.mjs';
import {readConditionalDeploymentJobs,runKey} from './conditional-deployment-jobs-worker.mjs';

const REPO='kusennjp1-ai/screener',RID=1203919607,TOKEN='synthetic-bridge-only-token';
const scope={repository:REPO,repository_id:RID,run_id:900,run_attempt:1,controller_sha:'b'.repeat(40)};
const clone=v=>JSON.parse(JSON.stringify(v));
function row(id=11,changes={}){return {id,run_attempt:1,head_sha:'a'.repeat(40),head_branch:'main',
 workflow_id:294257497,path:'.github/workflows/static-site.yml',name:'Synthetic static workflow',event:'workflow_dispatch',
 repository:{id:RID,full_name:REPO},head_repository:{id:RID,full_name:REPO},status:'completed',conclusion:'success',
 created_at:'2026-10-09T01:00:00Z',run_started_at:'2026-10-09T01:00:00Z',updated_at:'2026-10-09T01:10:00Z',...changes};}
function job(r,id=101){return {id,run_id:r.id,run_attempt:r.run_attempt,head_sha:r.head_sha,head_branch:r.head_branch,
 workflow_name:r.name,name:'Synthetic job',run_url:'https://api.github.com/repos/'+REPO+'/actions/runs/'+r.id,
 url:'https://api.github.com/repos/'+REPO+'/actions/jobs/'+id,
 html_url:'https://github.com/'+REPO+'/actions/runs/'+r.id+'/job/'+id,status:'completed',conclusion:'success',
 created_at:'2026-10-09T01:00:01Z',started_at:'2026-10-09T01:00:02Z',completed_at:'2026-10-09T01:00:05Z',
 steps:[{number:1,name:'Synthetic step',status:'completed',conclusion:'success',started_at:'2026-10-09T01:00:03Z',completed_at:'2026-10-09T01:00:04Z'}]};}
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
function bridge(results,{token=()=>TOKEN,binding=()=>true,excludedIds=[],beforeReturn=()=>{}}={}){
 const configs=[],reports=[];
 const reader=createConditionalDeploymentJobsReader({scope:clone(scope),excludedIds,token,binding,report:v=>reports.push(clone(v)),
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
function environment(work,{file='research-ui-release.yml',event='workflow_run',enabled=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'conditional-bridge-')),old=process.cwd(),prior={...process.env};
 mkdirSync(join(dir,'.github'));const eventPath=join(dir,'event.json'),requestPath=join(dir,'.github/retained-price-oct6-source.json');
 writeFileSync(eventPath,JSON.stringify({workflow_run:row(777,{head_sha:scope.controller_sha,event:'workflow_run'})}));
 writeFileSync(requestPath,JSON.stringify({schema_version:'retained-price-oct6-source-v1',enabled,activation:{synthetic:true}}));
 Object.assign(process.env,{GITHUB_REPOSITORY:REPO,GITHUB_REPOSITORY_ID:String(RID),GITHUB_REF:'refs/heads/main',
 GITHUB_EVENT_NAME:event,GITHUB_SHA:scope.controller_sha,GITHUB_WORKFLOW_SHA:scope.controller_sha,GITHUB_RUN_ID:String(scope.run_id),
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
   assert.throws(()=>withInvocationConditionalDeploymentJobs(REPO,()=>{
    writeFileSync(paths[which],'x'.repeat(1024**2+1));return readScopedDeploymentJobs(REPO,()=>{},[row()]);
   }),/bound-file-size-or-kind|bound-file-growth-or-shrink/);
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
 for(const name of['conditional-deployment-jobs.mjs','conditional-deployment-jobs-worker.mjs'])copyFileSync(join(source,name),join(scripts,name));
 const script="import {createConditionalDeploymentJobsReader} from "+JSON.stringify('file://'+join(scripts,'conditional-deployment-jobs.mjs'))+";\n"+
 "const reports=[];const reader=createConditionalDeploymentJobsReader({scope:"+JSON.stringify(scope)+",token:()=>"+JSON.stringify(TOKEN)+",report:v=>reports.push(v)});"+
 "try{reader.read("+JSON.stringify([row()])+");throw Error('Unexpected worker success');}catch(e){if(e.conditionalReason!=='worker-command-failed')throw e;}"+
 "if(!reader.disposed||reports.length!==1||reports[0].measurement_incomplete||reports[0].counts.conditional_requests_issued!==0)throw Error('Bad copied worker result');console.log('copied-native-worker-resolved-without-network');";
 try{
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,GH_TOKEN:''},timeout:5000,maxBuffer:1024**2});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'copied-native-worker-resolved-without-network');
  assert.equal(existsSync(join(dir,'frontend')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
