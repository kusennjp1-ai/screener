import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {branch,requestPath,validateRequest,verifyActivation,authenticateRecovery,checkPriceIdentity,boundedFile,executeWithRecheck,extractCanonical,stageEvent} from './run-statement-targeted-recovery.mjs';
import {repository,recoveryWorkflow} from './restore-statement-source.mjs';
import {run8ReplacementSchema,reviewedAbort7,reviewedAbort6,reviewedAbort} from './verify-statement-pre-provider-abort.mjs';
const h='a'.repeat(64),code='b'.repeat(40),currentSha='c'.repeat(40),now=Date.parse('2026-10-16T09:00:00Z');
const request=()=>({schema_version:'financial-targeted-recovery-execution-v1',operation_id:'targeted-nvda-aaoi-example',created_at:'2026-10-16T08:59:00Z',expires_at:'2026-10-16T10:00:00Z',controller:{parent_sha:code,parent_tree:code},expected_run_number:5,
 source:{run_id:10,run_attempt:1,head_sha:code,artifact_id:20,artifact_sha256:h,archive_manifest_sha256:h,base_sha256:h,cohort_sha256:h},
 price_source:{run_id:30,run_attempt:1,head_sha:code,artifact_id:40,artifact_sha256:h,companion_id:41,companion_sha256:h,manifest_sha256:h,research_sha256:h},
 selection:['NVDA','AAOI'].map(symbol=>({symbol,targets:['eps','sales','annual_history'],receipts:['quarterly_income_stmt','income_stmt'].map(attribute=>({attribute,receipt_sha256:h,attempt_id:'original:0001',attempt_object_sha256:h}))})),
 limits:{max_symbols:2,max_statement_getter_calls:4,max_transport_requests:1000,acquisition_budget_seconds:1080,caller_retries:0},publication_authority:'none',financial_admission:false});
const context=()=>({id:11,attempt:1,sha:currentSha,branch,repository,event:'push'});
const run=(id,change={})=>({id,run_attempt:1,run_number:id===11?5:4,head_sha:id===11?currentSha:code,head_branch:branch,path:recoveryWorkflow,event:'push',workflow_id:234,repository:{id:123,full_name:repository},head_repository:{id:123,full_name:repository},status:id===11?'in_progress':'completed',conclusion:id===11?null:'failure',run_started_at:id===11?'2026-10-16T08:59:00Z':'2026-10-06T14:00:00Z',...change});
function apiFixture(){
 const current=run(11),previous=run(10),artifact={id:20,name:`financial-statement-recovery-${code}-1`,size_in_bytes:100,expired:false,digest:`sha256:${h}`,created_at:'2026-10-06T14:30:00Z',workflow_run:{id:10,head_sha:code,head_branch:branch,repository_id:123,head_repository_id:123}};
 const endpoints={
 [`repos/${repository}/actions/runs/11`]:current,[`repos/${repository}/actions/runs/11/attempts/1`]:structuredClone(current),
 [`repos/${repository}/actions/runs/10/attempts/1`]:previous,
 [`repos/${repository}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`]:{total_count:2,workflow_runs:[current,previous]},
 [`repos/${repository}/actions/runs/10/artifacts?per_page=100`]:{total_count:1,artifacts:[artifact]},
 [`repos/${repository}/git/ref/heads/${branch}`]:{object:{sha:currentSha}}};
 return {endpoints,api:path=>{assert.ok(Object.hasOwn(endpoints,path),`Unexpected API: ${path}`);return endpoints[path];}};
}
test('new request is closed, finite, two symbols, four getters, zero retries and no financial authority',()=>{
 assert.equal(validateRequest(request(),now).limits.max_statement_getter_calls,4);
 const mutations=[r=>r.financial_admission=true,r=>r.publication_authority='publish',r=>r.provider_execution=true,r=>r.operation_id='old-intent',r=>r.expires_at='2026-10-17T10:00:00Z',r=>r.created_at='2026-10-16T09:01:00Z',r=>r.expires_at='2026-10-16T09:00:00Z',r=>r.limits.max_symbols=200,r=>r.limits.max_statement_getter_calls=400,r=>r.limits.acquisition_budget_seconds=1081,r=>r.limits.max_transport_requests=1001,r=>r.limits.caller_retries=1,r=>r.selection[0].symbol='FUTU',r=>r.selection.reverse(),r=>r.selection[0].targets=['eps'],r=>r.selection[0].receipts[0].receipt_sha256='bad',r=>r.price_source.research_sha256='bad',r=>r.controller.parent_tree='bad',r=>r.expected_run_number=0];
 for(const mutate of mutations){const r=request();mutate(r);assert.throws(()=>validateRequest(r,now));}
});
test('authenticates exact failed predecessor without converting it to successful source',()=>{
 const f=apiFixture(),result=authenticateRecovery(request(),context(),f.api);assert.equal(result.run.conclusion,'failure');assert.equal(result.artifact.id,20);
});
test('rejects reruns, skipped predecessor, stale ref, duplicate activation, changed attempt and incomplete inventories',()=>{
 const inventory=`repos/${repository}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`;
 const mutations=[e=>e[`repos/${repository}/actions/runs/11`].run_number=6,
 e=>e[`repos/${repository}/actions/runs/11/attempts/1`].status='completed',
 e=>e[`repos/${repository}/actions/runs/11/attempts/1`].run_number=6,
 e=>e[`repos/${repository}/actions/runs/11/attempts/1`].repository.full_name='foreign/repo',
 e=>e[`repos/${repository}/actions/runs/11/attempts/1`].head_sha=code,
 e=>e[`repos/${repository}/actions/runs/11/attempts/1`].repository.id=999,
 e=>e[`repos/${repository}/git/ref/heads/${branch}`].object.sha=code,
 e=>{e[inventory].workflow_runs.push(run(9,{head_sha:currentSha}));e[inventory].total_count=3;},
 e=>e[inventory].total_count=3,
 e=>{e[inventory].workflow_runs[1]=run(10,{status:'in_progress'});},
 e=>e[`repos/${repository}/actions/runs/10/artifacts?per_page=100`].artifacts[0].digest=`sha256:${'b'.repeat(64)}`,
 e=>e[`repos/${repository}/actions/runs/10/artifacts?per_page=100`].total_count=2];
 for(const mutate of mutations){const f=apiFixture();mutate(f.endpoints);assert.throws(()=>authenticateRecovery(request(),context(),f.api));}
 assert.throws(()=>authenticateRecovery(request(),{...context(),attempt:2},apiFixture().api));
});
test('exact ordinary canonical price source binds both artifact and companion hashes and cannot be preview',()=>{
 const r=request(),artifact={id:40,name:'static-site-data-30-1',expired:false,created_at:'2026-10-16T08:00:00Z',digest:`sha256:${h}`,workflow_run:{id:30,head_sha:code,head_branch:'main'}},companion={...artifact,id:41,name:'static-site-data-manifest-30-1'};
 const source={runId:30,attempt:1,artifact,manifestHash:h,manifest:{research_generation:h}};assert.equal(checkPriceIdentity(r,source,[{artifacts:[artifact,companion]}]).id,41);
 for(const mutate of [s=>s.repair=true,s=>s.manifest.transport={},s=>s.manifest.design_carry_preview={},s=>s.manifestHash='b'.repeat(64),s=>s.artifact.id=99]){const s=structuredClone(source);mutate(s);assert.throws(()=>checkPriceIdentity(r,s,[{artifacts:[artifact,companion]}]));}
 assert.throws(()=>checkPriceIdentity(r,source,[{artifacts:[artifact]}]));
});
test('activation must be a clean request-only child of exact reviewed controller, including untracked files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'targeted-activation-'));const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{git(['init','-q']);git(['config','user.name','Offline Fixture']);git(['config','user.email','fixture@example.invalid']);writeFileSync(join(dir,'controller.txt'),'reviewed');git(['add','.']);git(['commit','-qm','Reviewed disabled controller']);
 const r=request();r.controller={parent_sha:git(['rev-parse','HEAD']),parent_tree:git(['rev-parse','HEAD^{tree}'])};mkdirSync(join(dir,'.github/targeted-financial-recovery'),{recursive:true});writeFileSync(join(dir,requestPath),JSON.stringify(r));git(['add','.']);git(['commit','-qm','Request-only activation']);const c={...context(),sha:git(['rev-parse','HEAD'])};assert.ok(verifyActivation(r,c,dir));
 for(const change of [{attempt:2},{event:'workflow_dispatch'},{branch:'main'},{sha:code}])assert.throws(()=>verifyActivation(r,{...c,...change},dir));
 writeFileSync(join(dir,'untracked.txt'),'x');assert.throws(()=>verifyActivation(r,c,dir),/clean/);rmSync(join(dir,'untracked.txt'));
 writeFileSync(join(dir,'controller.txt'),'changed');git(['add','.']);git(['commit','-qm','Unreviewed change']);assert.throws(()=>verifyActivation(r,{...c,sha:git(['rev-parse','HEAD'])},dir),/child/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('bounded inputs reject symlinks, hardlinks and over-limit bytes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'targeted-read-'));try{const p=join(dir,'file');writeFileSync(p,'abc');assert.equal(boundedFile(p,3).toString(),'abc');assert.throws(()=>boundedFile(p,2));symlinkSync(p,join(dir,'link'));assert.throws(()=>boundedFile(join(dir,'link'),3));linkSync(p,join(dir,'hardlink'));assert.throws(()=>boundedFile(p,3));}finally{rmSync(dir,{recursive:true,force:true});}
});
test('controller remains disabled, serial, finite, read-only and artifact-only with current pinned dependencies',()=>{
 const text=readFileSync(new URL('../workflows/financial-statement-recovery.yml',import.meta.url),'utf8');
 assert.match(text,/paths: \[\.github\/targeted-financial-recovery\/request.json\]/);// Absence of the activation request is checked when packaging the disabled controller,
 // not here: this same test suite must also pass on the authorized activation child.
 assert.match(text,/group: financial-statement-recovery\n  cancel-in-progress: false/);assert.match(text,/contents: read\n  actions: read/);assert.match(text,/timeout-minutes: 25/);assert.match(text,/fetch-depth: 2/);
 assert.match(text,/yfinance==0\.2\.66 pandas==2\.2\.0 numpy==1\.26\.3/);assert.match(text,/curl_cffi==0\.16\.3 requests==2\.31\.0 pytest==8\.3\.5/);
 assert.doesNotMatch(text,/workflow_dispatch|schedule:|contents: write|actions: write|dispatch-review.json|bounded-statement-refresh-plan.py/);
 assert.match(text,/if: always\(\)/);assert.match(text,/retention-days: 14/);
 const script=readFileSync(new URL('./run-statement-targeted-recovery.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(script,/--retry-decisions|--source-rechecks|--provider-resume|--refresh-through/);
});

test('one-shot readiness pipe reauthenticates after preparation without credentials in provider child',async()=>{
 let calls=0;
 await executeWithRecheck(process.execPath,['-e',`const fs=require('node:fs');if(process.env.GH_TOKEN||process.env.GITHUB_TOKEN)process.exit(9);fs.writeSync(3,'recheck\\n');let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const r=JSON.parse(s);process.exit(r.authenticated_at==='current'&&r.request_sha256==='bound'?0:8);});`],
  {cwd:process.cwd(),env:{PATH:process.env.PATH},authenticate:async()=>{calls++;return {authenticated_at:'current',request_sha256:'bound'};},timeout:3000});
 assert.equal(calls,1);
});
test('missing, malformed, repeated or denied readiness stops before collection',async()=>{
 for(const source of ["process.exit(0)","require('node:fs').writeSync(3,'other\\n');setTimeout(()=>{},1000)","const fs=require('node:fs');fs.writeSync(3,'recheck\\n');setTimeout(()=>fs.writeSync(3,'recheck\\n'),10);setTimeout(()=>{},1000)"]){
  let calls=0;await assert.rejects(executeWithRecheck(process.execPath,['-e',source],{cwd:process.cwd(),env:{PATH:process.env.PATH},authenticate:async()=>{calls++;await new Promise(r=>setTimeout(r,100));return {};},timeout:2000}));assert.ok(calls<=1);
 }
 await assert.rejects(executeWithRecheck(process.execPath,['-e',"require('node:fs').writeSync(3,'recheck\\n');process.stdin.resume()"],{cwd:process.cwd(),env:{PATH:process.env.PATH},authenticate:async()=>{throw Error('Remote predecessor changed');},timeout:2000}),/Remote predecessor changed/);
 await assert.rejects(executeWithRecheck(process.execPath,['-e','setTimeout(()=>{},1000)'],{cwd:process.cwd(),env:{PATH:process.env.PATH},authenticate:async()=>assert.fail('No readiness'),timeout:30}),/timed out/);
});


test('v4 retains the same finite artifact-only request and two-symbol acquisition boundaries',()=>{
 const old=JSON.parse(readFileSync(new URL('./fixtures/targeted-abort-run7/request.json',import.meta.url)));
 const r={...old,schema_version:run8ReplacementSchema,operation_id:'targeted-nvda-aaoi-new-run8',
  expected_run_number:8,created_at:'2026-10-17T03:10:00Z',expires_at:'2026-10-17T04:10:00Z',
  abort_continuity:{run7:{...reviewedAbort7},run6:{...reviewedAbort6},run5:{...reviewedAbort}}};
 const now=Date.parse('2026-10-17T03:20:00Z');
 assert.equal(validateRequest(r,now).limits.max_statement_getter_calls,4);
 const mutations=[r=>r.financial_admission=true,r=>r.publication_authority='publish',r=>r.provider_execution=true,
  r=>r.created_at='2026-10-17T03:21:00Z',r=>r.expires_at='2026-10-17T03:20:00Z',r=>r.expires_at='2026-10-17T05:10:01Z',
  r=>r.limits.max_symbols=3,r=>r.limits.max_statement_getter_calls=5,r=>r.limits.max_transport_requests=1001,
  r=>r.limits.acquisition_budget_seconds=1081,r=>r.limits.caller_retries=1,r=>r.selection[0].symbol='FUTU',
  r=>r.selection.reverse(),r=>r.selection[0].targets=['eps'],r=>r.price_source.research_sha256='bad'];
 for(const mutate of mutations){const value=structuredClone(r);mutate(value);assert.throws(()=>validateRequest(value,now));}
});

// Sparse test TARs exercise real size limits without allocating large JS buffers
// or writing gigabytes. The production extractor must still stream file bytes.
function canonicalArchive(directory,members){
 const archive=join(directory,'fixture.tar'),spec=join(directory,'members.json');writeFileSync(spec,JSON.stringify(members));
 execFileSync('python3',['-c',`import json,sys,tarfile
with open(sys.argv[1]) as f:members=json.load(f)
with open(sys.argv[2],'wb') as f:
 for spec in members:
  body=spec.get('body','').encode();m=tarfile.TarInfo(spec['name']);m.size=spec.get('size',len(body));m.type=spec.get('type','0').encode();m.linkname=spec.get('linkname','')
  f.write(m.tobuf(format=tarfile.PAX_FORMAT));f.write(body);f.seek(m.size-len(body)+(-m.size%512),1)
 f.write(bytes(10240))
`,spec,archive],{stdio:'pipe',timeout:30000});return archive;
}
const scanChunk='./static-data/markets/us/scan/chunks/chunk-0001.json';
test('canonical extraction streams exact US scan chunks through 128 MiB, keeps ordinary 32 MiB, and never parses them',()=>{
 const dir=mkdtempSync(join(tmpdir(),'canonical-copy-'));try{
  const archive=canonicalArchive(dir,[{name:'.',type:'5'},{name:'./static-data/manifest.json',body:'{}'},
   {name:scanChunk,size:128*1024**2},{name:'./static-data/ordinary.json',size:32*1024**2},{name:'./outside.json',body:'ignored'}]);
  const output=join(dir,'output');extractCanonical(archive,output);
  assert.equal(lstatSync(join(output,scanChunk)).size,128*1024**2);
  assert.equal(lstatSync(join(output,'static-data/ordinary.json')).size,32*1024**2);
  assert.equal(readFileSync(join(output,'static-data/manifest.json'),'utf8'),'{}');assert.equal(existsSync(join(output,'outside.json')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('canonical member ceilings reject oversize chunks, other markets, lookalike paths, and all ordinary members before writes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'canonical-size-'));try{
  const invalid=[{name:scanChunk,size:128*1024**2+1},
   ...['./static-data/ordinary.json','./outside.json','./static-data/markets/hk/scan/chunks/chunk-0001.json',
    './static-data/markets/us/scan/chunks/chunk-00001.json','./static-data/markets/us/scan/chunks/chunk-0001xjson',
    './static-data/markets/us/scan/chunks/chunk-0001.json/extra'].map(name=>({name,size:32*1024**2+1}))];
  for(const [i,member]of invalid.entries()){
   const archive=canonicalArchive(dir,[{name:'./static-data/manifest.json',body:'{}'},member]),output=join(dir,`output-${i}`);
   assert.throws(()=>extractCanonical(archive,output),/Oversized canonical member/);assert.equal(existsSync(output),false);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('canonical extraction retains finite total and member-count caps, including ignored files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'canonical-total-'));try{
  for(const [i,members]of [Array.from({length:17},(_,i)=>({name:`./static-data/markets/us/scan/chunks/chunk-${String(i).padStart(4,'0')}.json`,size:128*1024**2})),
   Array.from({length:30001},(_,i)=>({name:`./ignored-${i}`}))].entries()){
   const archive=canonicalArchive(dir,members),output=join(dir,`output-${i}`);
   assert.throws(()=>extractCanonical(archive,output),/Unbounded canonical archive/);assert.equal(existsSync(output),false);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('canonical extraction rejects traversal, aliases, duplicates, links, special files, and bounded-path violations before writes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'canonical-path-'));try{
  const invalid=[{name:'../escape'},{name:'/absolute'},{name:'./static-data/../escape'},{name:'./static-data//alias'},
   {name:'./static-data/back\\slash'},{name:scanChunk,type:'2',linkname:'/tmp/escape'},
   {name:scanChunk,type:'1',linkname:'./static-data/manifest.json'},{name:'./ignored-fifo',type:'6'},
   {name:'./ignored-device',type:'3'},{name:'./static-data/'+('a/'.repeat(32))+'file'},
   {name:'./static-data/'+('a'.repeat(256))},{name:'./'.repeat(520)+'static-data/file'},
   {name:'././static-data/manifest.json'},{name:'./static-data/manifest.json/'},{name:'.',type:'2',linkname:'/tmp'}];
  for(const [i,member]of invalid.entries()){
   const archive=canonicalArchive(dir,[{name:'./static-data/manifest.json',body:'{}'},member]),output=join(dir,`output-${i}`);
   assert.throws(()=>extractCanonical(archive,output),/Unsafe or duplicate|Links or special|Unbounded canonical path/);assert.equal(existsSync(output),false);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('canonical extraction enforces its 256 MiB address-space cap on hostile TAR extended headers',()=>{
 const dir=mkdtempSync(join(tmpdir(),'canonical-memory-'));try{
  const archive=canonicalArchive(dir,[{name:'./huge-pax-header',type:'x',size:300*1024**2}]),output=join(dir,'output');
  assert.throws(()=>extractCanonical(archive,output),/MemoryError|Cannot allocate memory/);assert.equal(existsSync(output),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('canonical extraction refuses existing destinations and symlinked destination ancestors',()=>{
 const dir=mkdtempSync(join(tmpdir(),'canonical-destination-'));try{
  const archive=canonicalArchive(dir,[{name:'./static-data/manifest.json',body:'{}'}]),output=join(dir,'output');mkdirSync(output);
  assert.throws(()=>extractCanonical(archive,output),/FileExistsError/);symlinkSync(output,join(dir,'linked'));
  assert.throws(()=>extractCanonical(archive,join(dir,'linked/nested')),/Linked canonical destination/);assert.equal(existsSync(join(output,'nested')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('only the provider-incapable middle full replay is removed; first and final proofs remain in order',()=>{
 const script=readFileSync(new URL('./run-statement-targeted-recovery.mjs',import.meta.url),'utf8');
 const body=script.slice(script.indexOf('export async function run('));
 assert.equal((body.match(/await livePublication\(/g)||[]).length,2);
 assert.doesNotMatch(body,/finalLive|finalPages/);
 const first=body.indexOf('const live=await livePublication('),prepare=body.indexOf("reportStage('local-preparation-started')"),
  handoff=body.indexOf("reportStage('provider-handshake-started')"),last=body.indexOf('readyLive=await livePublication('),
  finalInventory=body.indexOf('const readyPages=api('),finalPrice=body.indexOf('checkPriceIdentity(request,chooseExport(readyLive,'),readiness=body.indexOf("reportStage('provider-handshake-completed')");
 assert.ok(first>=0&&first<prepare&&prepare<handoff&&handoff<last&&last<finalInventory&&finalInventory<finalPrice&&finalPrice<readiness);
 assert.match(body.slice(0,prepare),/validateRequest\(request\);verifyActivation\(request,context\);recovery=authenticateRecovery\(request,context,api\)/);
 const final=body.slice(handoff,readiness);
 assert.equal((final.match(/authenticateRecovery\(request,context,api\)/g)||[]).length,2);
 for(const path of ['base.json','cohort.json','request.json'])assert.ok(final.includes(`join(inputs,'${path}')`));
 assert.match(final,/Prepared authenticated input changed/);
 const cycle=readFileSync(new URL('./run-statement-targeted-cycle.py',import.meta.url),'utf8');
 assert.ok(cycle.indexOf('provider_invocation = authenticator()')<cycle.indexOf('result, code = collector('));
 assert.ok(cycle.indexOf('allowance = helpers.bounded_acquisition_budget(job_started_at, now=ready_at)')<cycle.indexOf('result, code = collector('));
 assert.match(cycle,/acquisition_budget_seconds=allowance, max_statement_getter_calls=4/);
 assert.match(readFileSync(new URL('./run-statement-recovery-cycle.py',import.meta.url),'utf8'),/min\(1080, 1500 - elapsed - 420\)/);
});

test('stage observations are closed diagnostics, with no data, URL, credential or authority fields',()=>{
 const at='2026-10-17T07:50:00.000Z';
 for(const stage of ['request-proof-started','request-proof-completed','initial-live-proof-started','initial-live-proof-completed',
  'canonical-preparation-started','canonical-preparation-completed','local-preparation-started','provider-handshake-started',
  'final-live-proof-started','final-live-proof-completed','provider-handshake-completed','collection-completed'])
  assert.deepEqual(stageEvent(stage,at),{schema_version:'financial-targeted-stage-v1',stage,observed_at:at});
 for(const stage of ['token=secret','https://example.invalid','',null,{},'provider-request'])assert.throws(()=>stageEvent(stage,at),/Invalid bounded stage/);
 for(const clock of ['secret',null,'2026-02-30T07:50:00.000Z','2026-10-17T07:50:00Z'])assert.throws(()=>stageEvent('final-live-proof-started',clock),/Invalid bounded stage/);
});

test('a delayed full final proof cannot release the waiting child early',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'targeted-final-proof-'));let entered,release;
 const pending=new Promise(r=>entered=r),proof=new Promise(r=>release=r),marker=join(dir,'collector-marker');
 const child=`const fs=require('node:fs');fs.writeSync(3,'recheck\\n');let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const v=JSON.parse(s);if(v.current!==true)process.exit(2);fs.writeFileSync(${JSON.stringify(marker)},'crossed');});`;
 try{
  const running=executeWithRecheck(process.execPath,['-e',child],{cwd:dir,env:{PATH:process.env.PATH},timeout:3000,
   authenticate:async()=>{entered();await proof;return {current:true};}});
  await pending;assert.equal(existsSync(marker),false);release();await running;assert.equal(readFileSync(marker,'utf8'),'crossed');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('failed final proof, changed current state or budget exhaustion leaves zero child collector crossings',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'targeted-final-stop-')),marker=join(dir,'collector-marker');
 const child=`const fs=require('node:fs');fs.writeSync(3,'recheck\\n');let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{if(s)fs.writeFileSync(${JSON.stringify(marker)},'crossed');});`;
 try{
  for(const reason of ['Live publication changed while reading it','A new deployment completed while reading Pages',
   'Current canonical price source differs from request','Recovery branch advanced during activation',
   'Prepared authenticated input changed','Bounded refresh setup exhausted the acquisition allowance']){
   await assert.rejects(executeWithRecheck(process.execPath,['-e',child],{cwd:dir,env:{PATH:process.env.PATH},timeout:3000,
    authenticate:async()=>{throw Error(reason);}}),error=>error.message===reason);
   assert.equal(existsSync(marker),false);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});

// Exercise the exact final callback and real validators through a real child pipe.
import './final-provider-boundary.cases.mjs';
