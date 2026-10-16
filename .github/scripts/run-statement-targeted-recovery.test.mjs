import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {linkSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {branch,requestPath,validateRequest,verifyActivation,authenticateRecovery,checkPriceIdentity,boundedFile,executeWithRecheck} from './run-statement-targeted-recovery.mjs';
import {repository,recoveryWorkflow} from './restore-statement-source.mjs';
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
