// Offline final-boundary cases imported by the ordinary caller test suite. The callback body is extracted unchanged from
// production; only remote live-proof/API responses and the observation clock
// are fixtures. Request, Git activation, recovery, price, byte and pipe guards
// are the real production implementations. No provider/downloader is executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const scripts=new URL('./',import.meta.url);
const {branch,requestPath,validateRequest,verifyActivation,authenticateRecovery,checkPriceIdentity,boundedFile,executeWithRecheck,stageEvent}=await import(new URL('run-statement-targeted-recovery.mjs',scripts));
const {chooseExport}=await import(new URL('select-release-source.mjs',scripts));
const {sha256}=await import(new URL('publication-state.mjs',scripts));
const {priceObservationDigest}=await import(new URL('price-observations.mjs',scripts));
const {repository,recoveryWorkflow}=await import(new URL('restore-statement-source.mjs',scripts));
const caller=readFileSync(new URL('run-statement-targeted-recovery.mjs',scripts),'utf8');
const starts=caller.split('authenticate:async()=>{');
assert.equal(starts.length,2,'Exactly one production final authentication callback');
const end=starts[1].indexOf('\n    }});');assert.ok(end>0,'Exact production callback terminator');
const body=starts[1].slice(0,end);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const names=['reportStage','validateRequest','request','verifyActivation','context','authenticateRecovery','api','livePublication','repository','checkPriceIdentity','chooseExport','cachedLoad','sha256','boundedFile','join','inputs','invocation'];
const makeCallback=new AsyncFunction(...names,body);
const H='a'.repeat(64),SHA='b'.repeat(40),INITIAL=Date.parse('2026-10-16T09:00:00Z');
const manifest=day=>({as_of_date:day,supported_markets:['US'],default_market:'US',markets:{US:{as_of_date:day}},research_generation:H});
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'exact-provider-boundary-')),checkout=join(directory,'checkout'),inputs=join(directory,'inputs');
 mkdirSync(checkout);mkdirSync(inputs);
 const git=args=>execFileSync('git',args,{cwd:checkout,env:{...process.env,GIT_NO_LAZY_FETCH:'1',GIT_OPTIONAL_LOCKS:'0'},encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init','-q']);git(['config','user.name','Offline Fixture']);git(['config','user.email','fixture@example.invalid']);
 writeFileSync(join(checkout,'controller.txt'),'reviewed controller');git(['add','.']);git(['commit','-qm','Reviewed controller']);
 const request={schema_version:'financial-targeted-recovery-execution-v1',operation_id:'targeted-nvda-aaoi-boundary-test',created_at:'2026-10-16T08:59:00Z',expires_at:'2026-10-16T10:00:00Z',controller:{parent_sha:git(['rev-parse','HEAD']),parent_tree:git(['rev-parse','HEAD^{tree}'])},expected_run_number:5,
  source:{run_id:10,run_attempt:1,head_sha:SHA,artifact_id:20,artifact_sha256:H,archive_manifest_sha256:H,base_sha256:H,cohort_sha256:H},
  price_source:{run_id:30,run_attempt:1,head_sha:SHA,artifact_id:40,artifact_sha256:H,companion_id:41,companion_sha256:H,manifest_sha256:sha256(JSON.stringify(manifest('2026-10-16'))),research_sha256:H},
  selection:['NVDA','AAOI'].map(symbol=>({symbol,targets:['eps','sales','annual_history'],receipts:['quarterly_income_stmt','income_stmt'].map(attribute=>({attribute,receipt_sha256:H,attempt_id:'original:0001',attempt_object_sha256:H}))})),
  limits:{max_symbols:2,max_statement_getter_calls:4,max_transport_requests:1000,acquisition_budget_seconds:1080,caller_retries:0},publication_authority:'none',financial_admission:false};
 mkdirSync(join(checkout,'.github/targeted-financial-recovery'),{recursive:true});writeFileSync(join(checkout,requestPath),JSON.stringify(request));git(['add','.']);git(['commit','-qm','Request-only activation']);
 const context={id:11,attempt:1,sha:git(['rev-parse','HEAD']),branch,repository,event:'push'};
 const run=(id,change={})=>({id,run_attempt:1,run_number:id===11?5:4,head_sha:id===11?context.sha:SHA,head_branch:branch,path:recoveryWorkflow,event:'push',workflow_id:234,repository:{id:123,full_name:repository},head_repository:{id:123,full_name:repository},status:id===11?'in_progress':'completed',conclusion:id===11?null:'failure',run_started_at:id===11?'2026-10-16T08:59:00Z':'2026-10-06T14:00:00Z',...change});
 const current=run(11),previous=run(10),sourceArtifact={id:20,name:`financial-statement-recovery-${SHA}-1`,size_in_bytes:100,expired:false,digest:`sha256:${H}`,created_at:'2026-10-06T14:30:00Z',workflow_run:{id:10,head_sha:SHA,head_branch:branch,repository_id:123,head_repository_id:123}};
 const prefix=`repos/${repository}`,endpoints={
  [`${prefix}/actions/runs/11`]:current,[`${prefix}/actions/runs/11/attempts/1`]:structuredClone(current),[`${prefix}/actions/runs/10/attempts/1`]:previous,
  [`${prefix}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`]:{total_count:2,workflow_runs:[current,previous]},
  [`${prefix}/actions/runs/10/artifacts?per_page=100`]:{total_count:1,artifacts:[sourceArtifact]},[`${prefix}/git/ref/heads/${branch}`]:{object:{sha:context.sha}}};
 const state={directory,checkout,inputs,git,request,context,endpoints,prefix,clock:INITIAL,order:[],stages:[],live:{manifest:manifest('2026-10-15'),knownPriceDates:{}},metadata:{},pages:[{artifacts:[]}],sourceArtifact};
 state.addPrice=(id=30,artifactId=40,day='2026-10-16',created='2026-10-16T08:00:00Z')=>{
  const artifact={id:artifactId,name:`static-site-data-${id}-1`,expired:false,created_at:created,digest:`sha256:${H}`,workflow_run:{id,head_sha:SHA,head_branch:'main'}},companion={...artifact,id:artifactId+1,name:`static-site-data-manifest-${id}-1`};
  state.pages[0].artifacts.push(artifact,companion);
  endpoints[`${prefix}/actions/runs/${id}/attempts/1`]=run(id,{head_sha:SHA,head_branch:'main',path:'.github/workflows/static-site.yml',event:'schedule',status:'completed'});
  endpoints[`${prefix}/actions/runs/${id}/attempts/1/jobs?per_page=100`]=[{jobs:[{name:'combine-and-build',run_attempt:1,conclusion:'success',started_at:'2026-10-16T07:00:00Z',completed_at:'2026-10-16T08:30:00Z',steps:[{name:'Build static frontend',conclusion:'success'}]}]}];
  const json=JSON.stringify(manifest(day));state.metadata[companion.id]={run_id:id,run_attempt:1,source_sha:SHA,artifact_name:artifact.name,manifest_json:json,manifest_sha256:sha256(json),price_observations:{},price_observations_sha256:priceObservationDigest({})};
  return {artifact,companion};
 };
 Object.assign(state,state.addPrice());
 for(const [name,value]of [['base.json','{"base":"authenticated"}'],['cohort.json','["NVDA","AAOI"]'],['request.json',JSON.stringify(request)]])writeFileSync(join(inputs,name),value);
 state.invocation={schema_version:'offline-boundary-invocation',authenticated_at:'original-preparation',base_sha256:sha256(readFileSync(join(inputs,'base.json'))),cohort_sha256:sha256(readFileSync(join(inputs,'cohort.json'))),request_sha256:sha256(readFileSync(join(inputs,'request.json'))),publication_authority:'none',financial_admission:false};
 state.api=(path,paginate=false)=>{state.order.push(`api:${path}`);if(path===`${prefix}/actions/artifacts?per_page=100`){assert.equal(paginate,true);return structuredClone(state.pages);}assert.ok(Object.hasOwn(endpoints,path),`Unexpected offline API ${path}`);return structuredClone(endpoints[path]);};
 state.cachedLoad=companion=>{assert.ok(Object.hasOwn(state.metadata,companion.id));return structuredClone(state.metadata[companion.id]);};
 state.make=livePublication=>()=>makeCallback(...[
  stage=>{state.stages.push(stageEvent(stage));state.order.push(stage);},r=>validateRequest(r,state.clock),request,(r,c)=>verifyActivation(r,c,checkout),context,authenticateRecovery,state.api,livePublication,repository,checkPriceIdentity,chooseExport,state.cachedLoad,sha256,boundedFile,join,inputs,state.invocation]);
 state.cleanup=()=>rmSync(directory,{recursive:true,force:true});
 return state;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function exercise(mutate,{failure=true,liveError=false}={}){
 const f=fixture(),marker=join(f.directory,'collector-entered.json');let release,entered;
 const waiting=new Promise(resolve=>entered=resolve),barrier=new Promise(resolve=>release=resolve);
 const callback=f.make(async()=>{f.order.push('full-proof-entered');entered();await barrier;f.order.push('full-proof-resolved');if(liveError)throw Error('Full live proof rejected');return structuredClone(f.live);});
 const child=`const fs=require('node:fs');if(process.env.GH_TOKEN||process.env.GITHUB_TOKEN)process.exit(9);fs.writeSync(3,'recheck\\n');let bytes='';process.stdin.on('data',b=>bytes+=b);process.stdin.on('end',()=>{const invocation=JSON.parse(bytes);fs.writeFileSync(process.argv[1],JSON.stringify(invocation));});`;
 const result=executeWithRecheck(process.execPath,['-e',child,marker],{cwd:f.directory,env:{PATH:process.env.PATH},authenticate:callback,timeout:5000}).then(()=>({ok:true}),error=>({ok:false,error}));
 try{
  await Promise.race([waiting,sleep(4000).then(()=>{throw Error('Final live proof was never reached');})]);
  await sleep(20);assert.equal(existsSync(marker),false,'Child cannot cross handoff while full proof is pending');
  assert.equal(f.order.some(x=>x===`api:${f.prefix}/actions/artifacts?per_page=100`),false,'Latest price inventory must not precede full proof');
  if(mutate)mutate(f);release();const outcome=await result;
  assert.equal(outcome.ok,!failure,outcome.error?.stack);
  if(failure){assert.equal(existsSync(marker),false,'Rejected final proof cannot grant child handoff');assert.equal(f.stages.some(x=>x.stage==='provider-handshake-completed'),false);}
  else{const output=JSON.parse(readFileSync(marker));assert.deepEqual({...output,authenticated_at:f.invocation.authenticated_at},f.invocation);assert.notEqual(output.authenticated_at,f.invocation.authenticated_at);assert.equal(f.order.filter(x=>x==='full-proof-entered').length,1);assert.ok(f.order.indexOf('full-proof-resolved')<f.order.indexOf(`api:${f.prefix}/actions/artifacts?per_page=100`));}
 }finally{release();await result;f.cleanup();}
}
test('exact final callback with real validators grants only after full proof and preserves all invocation fields',()=>exercise(null,{failure:false}));
test('exact final callback rejects a failed full proof before child handoff',()=>exercise(null,{liveError:true}));
const mutations=[
 ['newer canonical source appears during full proof',f=>f.addPrice(31,42,'2026-10-16','2026-10-16T08:10:00Z')],
 ['canonical digest changes',f=>f.artifact.digest=`sha256:${'c'.repeat(64)}`],
 ['canonical artifact expires',f=>f.artifact.expired=true],
 ['canonical head changes',f=>f.artifact.workflow_run.head_sha='d'.repeat(40)],
 ['companion digest changes',f=>f.companion.digest=`sha256:${'c'.repeat(64)}`],
 ['companion disappears',f=>f.pages[0].artifacts.pop()],
 ['companion duplicates',f=>f.pages[0].artifacts.push({...f.companion,id:99})],
 ['canonical attempt changes',f=>f.endpoints[`${f.prefix}/actions/runs/30/attempts/1`].run_attempt=2],
 ['canonical build no longer successful',f=>f.endpoints[`${f.prefix}/actions/runs/30/attempts/1/jobs?per_page=100`][0].jobs[0].conclusion='failure'],
 ['live manifest advances beyond source',f=>f.live.manifest=manifest('2026-10-17')],
 ['live manifest becomes malformed',f=>f.live.manifest={as_of_date:'bad'}],
 ['known price date would regress',f=>{f.live.knownPriceDates={'["US","chart","NVDA"]':'2026-10-16'};const m=f.metadata[41];m.price_observations={'["US","chart","NVDA"]':'2026-10-15'};m.price_observations_sha256=priceObservationDigest(m.price_observations);}],
 ['source metadata changes manifest',f=>{const m=f.metadata[41];m.manifest_json=JSON.stringify({...manifest('2026-10-16'),research_generation:'d'.repeat(64)});m.manifest_sha256=sha256(m.manifest_json);}],
 ['request expires during proof',f=>f.clock=Date.parse(f.request.expires_at)],
 ['recovery ref advances during proof',f=>f.endpoints[`${f.prefix}/git/ref/heads/${branch}`].object.sha=SHA],
 ['current attempt finishes during proof',f=>f.endpoints[`${f.prefix}/actions/runs/11/attempts/1`].status='completed'],
 ['recovery predecessor artifact changes',f=>f.sourceArtifact.digest=`sha256:${'c'.repeat(64)}`],
 ['activation checkout becomes dirty',f=>writeFileSync(join(f.checkout,'untracked.txt'),'unexpected')],
 ...['base.json','cohort.json','request.json'].map(name=>[`prepared ${name} changes`,f=>writeFileSync(join(f.inputs,name),'{}')]),
];
for(const [name,mutate]of mutations)test(`exact final callback rejects ${name} without granting child handoff`,()=>exercise(mutate));
