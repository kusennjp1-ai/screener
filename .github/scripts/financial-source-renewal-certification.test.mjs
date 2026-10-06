import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,mkdtempSync,openSync,closeSync,ftruncateSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {protectedCodeInventory} from './financial-release-activation.mjs';
import {contract,dataInventory,digest} from './financial-correction.mjs';
import {bootstrap,inventoryDigest,sha256,uiInventory} from './publication-state.mjs';
import {renewalPolicy,consumerCodeInventory} from './financial-source-renewal.mjs';
import {assertCertificationSourceTrustPreserved,renewalCandidateMembers,restorePriorRenewalSource,retainApprovedRenewalUi,verifyRenewalCertifierController,verifyRenewalCertificationBounds,verifySealedRenewalArchive} from './financial-source-renewal-certification.mjs';

const here=dirname(fileURLToPath(import.meta.url)),root=join(here,'../..');
const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,value);};
const fixture=()=>mkdtempSync(join(tmpdir(),'renewal-certification-'));
function bundle(root,html){
  write(join(root,'index.html'),html);write(join(root,'sw.js'),`worker ${html}`);
  write(join(root,'assets/chunk.js'),`chunk ${html}`);write(join(root,'static-data/manifest.json'),'{}');
  write(join(root,'static-data/financial-corrections/source-base-'+'a'.repeat(64)+'.json'),'retained immutable audit');
  write(join(root,'research-daily.json'),'[1,2,3]');
}
test('same-UI producer retains exact predecessor HTML, SW and chunks while preserving all compiled data',()=>{
  const directory=fixture();try{
    const predecessor=join(directory,'predecessor'),baseline=join(directory,'baseline'),corrected=join(directory,'corrected');
    bundle(predecessor,'approved bytes');bundle(baseline,'new build bytes');bundle(corrected,'new build bytes');
    write(join(corrected,'assets/unapproved.js'),'must disappear');write(join(corrected,'publication.json'),'unapproved bootstrap');
    write(join(corrected,'static-data/financial-current.json'),'new financial data');
    const before=dataInventory(corrected),uiFiles=uiInventory(predecessor),uiDigest=inventoryDigest(uiFiles);
    retainApprovedRenewalUi({predecessor,baseline,corrected,uiFiles,uiDigest});
    assert.deepEqual(uiInventory(baseline),uiFiles);assert.deepEqual(uiInventory(corrected),uiFiles);
    assert.deepEqual(dataInventory(corrected),before);assert.equal(existsSync(join(corrected,'assets/unapproved.js')),false);
    assert.equal(existsSync(join(corrected,'publication.json')),false);
    assert.equal(readFileSync(join(corrected,'sw.js'),'utf8'),'worker approved bytes');
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test('same-UI retention rejects changed predecessor bytes and linked candidate files before replacing anything',()=>{
  const directory=fixture();try{
    const predecessor=join(directory,'predecessor'),baseline=join(directory,'baseline'),corrected=join(directory,'corrected');
    bundle(predecessor,'approved');bundle(baseline,'rebuilt');bundle(corrected,'rebuilt');
    const uiFiles=uiInventory(predecessor),options={predecessor,baseline,corrected,uiFiles,uiDigest:inventoryDigest(uiFiles)};
    write(join(predecessor,'index.html'),'changed');assert.throws(()=>retainApprovedRenewalUi(options),/predecessor UI inventory/);
    assert.equal(readFileSync(join(corrected,'index.html'),'utf8'),'rebuilt');
    write(join(predecessor,'index.html'),'approved');symlinkSync(join(predecessor,'index.html'),join(corrected,'hidden-link'));
    assert.throws(()=>retainApprovedRenewalUi(options),/Linked renewal payload/);
    assert.equal(readFileSync(join(corrected,'index.html'),'utf8'),'rebuilt');
  }finally{rmSync(directory,{recursive:true,force:true});}
});

function priorSource(directory,{unsafe=false}={}){
  const sourceDir=join(directory,'source-input'),candidate=join(directory,'candidate');
  write(join(sourceDir,'archive/manifest.json'),'{"original":"manifest"}');write(join(sourceDir,'base.json'),'{"original":"base"}');write(join(sourceDir,'cohort.json'),'{"original":"cohort"}');
  const zip=join(candidate,'original-previous-source/source.zip');mkdirSync(dirname(zip),{recursive:true});
  execFileSync('python3',['-c',`import pathlib,sys,zipfile
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'w') as z:
 for p in sorted(root.rglob('*')):
  if p.is_file():z.write(p,p.relative_to(root).as_posix())
 if sys.argv[3]=='unsafe':z.writestr('../escaped.json','malicious')
`,sourceDir,zip,unsafe?'unsafe':'safe']);
  const source={artifact_sha256:sha256(readFileSync(zip)),archive_manifest_sha256:sha256(readFileSync(join(sourceDir,'archive/manifest.json'))),acquisition_base_sha256:sha256(readFileSync(join(sourceDir,'base.json'))),cohort_sha256:sha256(readFileSync(join(sourceDir,'cohort.json')))};
  return {source,candidate,zip,live:{financialRelease:{lineage:{source}}}};
}
test('prior source replay authenticates the original ZIP and reopens its manifest/base/cohort without network fallback',()=>{
  const directory=fixture();try{
    const f=priorSource(directory),files=restorePriorRenewalSource(f);
    assert.equal(sha256(readFileSync(join(files,'archive/manifest.json'))),f.source.archive_manifest_sha256);
    write(join(files,'base.json'),'mutated extraction');restorePriorRenewalSource(f);
    assert.equal(sha256(readFileSync(join(files,'base.json'))),f.source.acquisition_base_sha256);
    f.source.cohort_sha256='0'.repeat(64);assert.throws(()=>restorePriorRenewalSource(f),/cohort.json digest mismatch/);
    rmSync(f.zip);assert.throws(()=>restorePriorRenewalSource(f),/ENOENT/);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test('prior source rejects digest mismatch, oversized ZIP and archive traversal',()=>{
  for(const kind of ['digest','oversized','unsafe']){
    const directory=fixture();try{
      const f=priorSource(directory,{unsafe:kind==='unsafe'});
      if(kind==='digest')writeFileSync(f.zip,'substituted ZIP');
      if(kind==='oversized'){const fd=openSync(f.zip,'w');ftruncateSync(fd,128*1024*1024+1);closeSync(fd);}
      assert.throws(()=>restorePriorRenewalSource(f),kind==='digest'?/archive digest/:kind==='oversized'?/bounded renewal artifact/:/Unsafe source path/);
      assert.equal(existsSync(join(f.candidate,'original-previous-source/escaped.json')),false);
    }finally{rmSync(directory,{recursive:true,force:true});}
  }
});
test('renewal certification enforces the actual 1,000,000,000-byte Pages bound separately from retained archive capacity',()=>{
  const directory=fixture();try{
    const candidate=join(directory,'candidate');bundle(join(candidate,'corrected'),'approved');
    const report=verifyRenewalCertificationBounds({candidate});assert.equal(report.pages.ok,true);assert.ok(report.pages.tar_bytes>0);
    const fd=openSync(join(candidate,'corrected/too-big.bin'),'w');ftruncateSync(fd,1_000_000_001);closeSync(fd);
    assert.throws(()=>verifyRenewalCertificationBounds({candidate}),/1 GB Pages limit/);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test('read-only certification workflow retains all original proofs and exposes no dispatch trust or publication switch',()=>{
  const workflow=readFileSync(join(root,renewalPolicy.workflow),'utf8');
  assert.match(workflow,/workflow_dispatch:/);assert.doesNotMatch(workflow,/\bschedule:|\bcron:|\binputs:|pages:\s*write|contents:\s*write|actions:\s*write|id-token:\s*write/);
  assert.equal(renewalPolicy.publication_enabled,false);assert.deepEqual(renewalPolicy.reviewed_controllers,[]);
  for(const name of renewalPolicy.steps)assert.equal(workflow.split(`- name: ${name}\n`).length-1,1);
  for(const name of ['predecessor','original-source','original-certification','original-predecessor','original-previous-source','original-previous-certification','source-delta.json','history-inventory.json'])assert.ok(renewalCandidateMembers.includes(name));
  assert.match(workflow,/retention-days: 14/);assert.match(workflow,/compression-level: 0/);
});
test('production certification CLI ignores ambient enable/trust claims and rejects nonexact workflow context',()=>{
  const script=join(here,'financial-source-renewal-certification.mjs'),env={...process.env,GITHUB_EVENT_NAME:'push',GITHUB_REPOSITORY:bootstrap.repository,FINANCIAL_SOURCE_RENEWAL_ENABLED:'true',FINANCIAL_SOURCE_RENEWAL_TRUST:'anything'};
  for(const command of ['prepare','verify-source','verify-surfaces','verify-bounds','seal']){
    const result=spawnSync(process.execPath,[script,command],{cwd:root,env,encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/exact main workflow_dispatch checkout/);
  }
  const flags=spawnSync(process.execPath,[script,'prepare','--trust','anything'],{cwd:root,env,encoding:'utf8'});
  assert.equal(flags.status,1);assert.match(flags.stderr,/Unknown closed renewal certification command/);
});

test('automatic workflow keeps cheap controls ahead of admission, fetch, dependencies and every proof step',()=>{
  const workflow=readFileSync(join(root,renewalPolicy.workflow),'utf8');
  assert.match(workflow,/workflow_run:\n    workflows: \[CI\]\n    types: \[completed\]\n    branches: \[main\]/);
  for(const gate of ["github.event.workflow_run.event == 'push'","github.event.workflow_run.head_branch == 'main'","github.event.workflow_run.conclusion == 'success'",'github.event.workflow_run.head_sha == github.sha','github.event.workflow_run.head_repository.id == github.repository_id','github.run_attempt == 1'])assert.ok(workflow.includes(gate));
  assert.match(workflow,/ref: \$\{\{ github.sha \}\}/);assert.doesNotMatch(workflow,/ref:.*workflow_run/);
  const blocks=workflow.split(/\n      - /),controls=blocks.findIndex(block=>block.includes('id: controls'));
  assert.ok(controls>0);
  const following=blocks.slice(controls+1);assert.ok(following[0].includes('Admit exact successful main CI renewal'));
  for(const block of following)assert.ok(block.includes("if: steps.controls.outputs.certify == 'true'"),block);
  for(const command of ['admit','prepare','verify-source','verify-surfaces','verify-bounds','seal']){
    const block=blocks.find(block=>block.includes(`.mjs ${command}\n`)||block.endsWith(`.mjs ${command}`));
    assert.ok(block?.includes('GH_TOKEN: ${{ github.token }}'),command);
  }
});

function automaticFixture(){
  const directory=fixture(),registryPath='contracts/financial_source_renewal_v1.json',repositoryId=1203919607;
  cpSync(here,join(directory,'.github/scripts'),{recursive:true});cpSync(join(root,'contracts'),join(directory,'contracts'),{recursive:true});
  cpSync(join(root,'.github/workflows'),join(directory,'.github/workflows'),{recursive:true});
  cpSync(join(root,'frontend/src/static/transport'),join(directory,'frontend/src/static/transport'),{recursive:true});
  const git=(...args)=>execFileSync('git',['-C',directory,...args],{encoding:'utf8'}).trim();
  const commit=()=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Committed automatic fixture');return {head_sha:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')};};
  let registry={...JSON.parse(readFileSync(join(directory,registryPath))),ci_admission:null};
  const request=JSON.stringify({parsed_by:'the existing renewal request validator after admission'});
  write(join(directory,renewalPolicy.request_path),request);write(join(directory,registryPath),JSON.stringify(registry));git('init','--quiet');const reviewed=commit();
  registry={...registry,ci_admission:{phase:'certify',reviewed_commit:reviewed.head_sha,reviewed_tree:reviewed.tree,controls:{request:sha256(request)}}};
  write(join(directory,registryPath),JSON.stringify(registry));const executing=commit();
  const first='2026-10-05T12:00:00Z',completed='2026-10-05T12:01:00Z',started='2026-10-05T12:02:00Z';
  const repository={id:repositoryId,full_name:bootstrap.repository,default_branch:'main'};
  const trigger={id:10,workflow_id:101,run_attempt:1,head_sha:executing.head_sha,path:'.github/workflows/ci.yml',event:'push',head_branch:'main',repository,head_repository:repository,status:'completed',conclusion:'success',created_at:first,run_started_at:first,updated_at:completed};
  const caller={...trigger,id:20,workflow_id:102,path:renewalPolicy.workflow,event:'workflow_run',status:'in_progress',conclusion:null,created_at:started,run_started_at:started,updated_at:started};
  const jobs=contract.required_ci_jobs.map((name,index)=>({name,id:500+index,run_id:10,run_attempt:1,head_sha:executing.head_sha,status:'completed',conclusion:'success',started_at:first,completed_at:completed}));
  const ownJobs=[{name:renewalPolicy.job,id:600,run_id:20,run_attempt:1,head_sha:executing.head_sha,status:'in_progress',conclusion:null,started_at:started,completed_at:null,
    steps:[{name:'Admit exact successful main CI renewal',number:4,status:'in_progress',conclusion:null,started_at:started,completed_at:null}]}];
  const event={action:'completed',repository,workflow_run:trigger},eventPath=join(directory,'event.json');write(eventPath,JSON.stringify(event));
  const env={GITHUB_EVENT_NAME:'workflow_run',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:bootstrap.repository,GITHUB_REPOSITORY_ID:String(repositoryId),GITHUB_WORKFLOW_REF:`${bootstrap.repository}/${renewalPolicy.workflow}@refs/heads/main`,GITHUB_WORKFLOW_SHA:executing.head_sha,GITHUB_SHA:executing.head_sha,GITHUB_RUN_ID:'20',GITHUB_RUN_ATTEMPT:'1',GITHUB_EVENT_PATH:eventPath,GH_TOKEN:'fixture-read-only-token'};
  const api=endpoint=>{
    const base=`repos/${bootstrap.repository}`;
    if(endpoint===base)return structuredClone(repository);
    if(endpoint===`${base}/git/ref/heads/main`)return {object:{sha:executing.head_sha}};
    if(endpoint===`${base}/actions/runs/10/attempts/1`||endpoint===`${base}/actions/runs/10`)return structuredClone(trigger);
    if(endpoint===`${base}/actions/runs/20/attempts/1`||endpoint===`${base}/actions/runs/20`)return structuredClone(caller);
    if(endpoint===`${base}/actions/runs/10/attempts/1/jobs?per_page=100`)return [{total_count:jobs.length,jobs:structuredClone(jobs)}];
    if(endpoint===`${base}/actions/runs/20/attempts/1/jobs?per_page=100`)return [{total_count:ownJobs.length,jobs:structuredClone(ownJobs)}];
    if(endpoint===`${base}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${executing.head_sha}&per_page=100`)return [{total_count:1,workflow_runs:[structuredClone(trigger)]}];
    if(endpoint===`${base}/actions/workflows/${renewalPolicy.workflow.split('/').at(-1)}/runs?branch=main&head_sha=${executing.head_sha}&per_page=100`)return [{total_count:1,workflow_runs:[structuredClone(caller)]}];
    let match;
    if((match=/\/git\/commits\/([a-f0-9]{40})$/.exec(endpoint)))return {sha:match[1],tree:{sha:git('rev-parse',`${match[1]}^{tree}`)},parents:git('rev-list','--parents','-n','1',match[1]).split(' ').slice(1).map(sha=>({sha}))};
    if((match=/\/git\/trees\/([a-f0-9]{40})\?recursive=1$/.exec(endpoint)))return {sha:match[1],truncated:false,tree:git('ls-tree','-r',match[1]).split('\n').map(line=>{const fields=/^(\d+) (\w+) ([a-f0-9]+)\t(.+)$/.exec(line);return {mode:fields[1],type:fields[2],sha:fields[3],path:fields[4]};})};
    if((match=/\/contents\/(.+)\?ref=([a-f0-9]{40})$/.exec(endpoint))){const bytes=execFileSync('git',['-C',directory,'show',`${match[2]}:${match[1]}`]);return {type:'file',path:match[1],encoding:'base64',size:bytes.length,sha:createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),content:bytes.toString('base64')};}
    throw Error(`Unexpected automatic fixture endpoint ${endpoint}`);
  };
  return {directory,registryPath,registry,event,eventPath,env,api,executing,caller,trigger,jobs};
}

function withAutomaticEnvironment(env,body){
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
  try{Object.assign(process.env,env);return body();}finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}

test('automatic controller retains exact closed admission proof alongside the unchanged CI checks',()=>{
  const f=automaticFixture();try{
    withAutomaticEnvironment(f.env,()=>{
      const controller=verifyRenewalCertifierController(f.directory,f.api);
      assert.deepEqual(Object.keys(controller).sort(),['head_sha','tree','checks','ci_admission'].sort());
      assert.equal(controller.ci_admission.phase,'certify');assert.equal(controller.ci_admission.caller.run_id,20);
      assert.deepEqual(controller.ci_admission.executing,f.executing);assert.deepEqual(controller.ci_admission.checks,controller.checks);
      const retained=join(f.directory,'certification-controller.json');write(retained,JSON.stringify(controller));
      assert.deepEqual(JSON.parse(readFileSync(retained)),verifyRenewalCertifierController(f.directory,f.api));
      assert.equal(Object.hasOwn(controller.ci_admission,'now'),false);
      f.caller.run_attempt=2;assert.throws(()=>verifyRenewalCertifierController(f.directory,f.api),/exact renewal CI run identity/);
    });
  }finally{rmSync(f.directory,{recursive:true,force:true});}
});

test('true automatic controls CLI disabled and missing-control holds invoke no subprocess, network or provider',()=>{
  const f=automaticFixture();try{
    const hook=join(f.directory,'forbid-work.mjs');write(hook,"import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';for(const name of ['execFileSync','spawnSync','execSync','spawn','exec','execFile'])cp[name]=()=>{throw Error('Forbidden subprocess '+name);};syncBuiltinESMExports();globalThis.fetch=()=>{throw Error('Forbidden network/provider');};");
    const script=join(f.directory,'.github/scripts/financial-source-renewal-certification.mjs'),output=join(f.directory,'outputs.txt');
    const env={...process.env,...f.env,GITHUB_OUTPUT:output,GH_TOKEN:'',GITHUB_EVENT_PATH:join(f.directory,'missing-event.json'),GITHUB_SHA:'untrusted',FINANCIAL_SOURCE_RENEWAL_ENABLED:'true',FINANCIAL_SOURCE_RENEWAL_TRUST:'untrusted'};
    for(const kind of ['disabled','unarmed','missing-controls']){
      rmSync(join(f.directory,renewalPolicy.request_path),{force:true});rmSync(join(f.directory,renewalPolicy.pin_path),{force:true});
      write(join(f.directory,f.registryPath),JSON.stringify({...f.registry,ci_admission:kind==='missing-controls'?f.registry.ci_admission:null}));
      if(kind==='unarmed')write(join(f.directory,renewalPolicy.request_path),'invalid request deliberately not parsed');
      if(kind==='missing-controls')write(join(f.directory,renewalPolicy.pin_path),'invalid pin deliberately not parsed');
      write(output,'');
      const result=spawnSync(process.execPath,['--import',hook,script,'controls'],{cwd:f.directory,env,encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{certify:false,status:kind==='disabled'?'disabled':'hold',publication_authority:'none'});
      assert.equal(readFileSync(output,'utf8'),'certify=false\n');
    }
  }finally{rmSync(f.directory,{recursive:true,force:true});}
});

test('true automatic CLI rejects missing token, fork, stale trigger and mismatched workflow context before any API or replay',()=>{
  const f=automaticFixture();try{
    const hook=join(f.directory,'forbid-external.mjs');write(hook,"import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const original=cp.execFileSync;cp.execFileSync=(file,...args)=>{if(file!=='git')throw Error('Forbidden external subprocess '+file);return original(file,...args);};syncBuiltinESMExports();globalThis.fetch=()=>{throw Error('Forbidden network/provider');};");
    const script=join(f.directory,'.github/scripts/financial-source-renewal-certification.mjs'),baseEnv={...process.env,...f.env};
    for(const command of ['admit','prepare','verify-source','verify-surfaces','verify-bounds','seal']){
      for(const [envChange,eventChange,pattern]of [
        [{GH_TOKEN:''},()=>{},/read-only GitHub token/],
        [{GITHUB_REPOSITORY:'fork/screener'},()=>{},/exact main workflow_run checkout/],
        [{GITHUB_SHA:'e'.repeat(40)},()=>{},/exact main workflow_run checkout/],
        [{GITHUB_WORKFLOW_SHA:'e'.repeat(40)},()=>{},/exact main workflow SHA/],
        [{},value=>value.workflow_run.head_sha='e'.repeat(40),/exact renewal CI run identity/],
        [{},value=>value.workflow_run.head_repository={...value.workflow_run.head_repository,id:1},/exact renewal CI run identity/],
      ]){
        const event=structuredClone(f.event);eventChange(event);write(f.eventPath,JSON.stringify(event));
        const result=spawnSync(process.execPath,['--import',hook,script,command],{cwd:f.directory,env:{...baseEnv,...envChange},encoding:'utf8'});
        assert.equal(result.status,1,`${command}: ${result.stderr}`);assert.match(result.stderr,pattern);assert.doesNotMatch(result.stderr,/Forbidden external|Forbidden network|ENOENT.*prepared/);
      }
    }
    const flags=spawnSync(process.execPath,[script,'admit','--trust','anything'],{cwd:f.directory,env:baseEnv,encoding:'utf8'});
    assert.equal(flags.status,1);assert.match(flags.stderr,/Unknown closed renewal certification command/);
  }finally{rmSync(f.directory,{recursive:true,force:true});}
});

test('source trust may only append reviewed requests while preserving every original request and validator binding',()=>{
  const before={schema_version:'test',files:{'original.py':{git_blob_sha:'old'}},reviewed_requests:[{tree_sha:'original',request:{source:{artifact_id:1}}}]};
  const after=structuredClone(before);after.reviewed_requests.push({tree_sha:'new',request:{source:{artifact_id:2}}});
  assertCertificationSourceTrustPreserved(before,after);
  for(const mutate of [v=>v.reviewed_requests.shift(),v=>v.reviewed_requests.reverse(),v=>v.reviewed_requests[0].request.source.artifact_id++,v=>v.files['original.py'].git_blob_sha='new']){
    const changed=structuredClone(after);mutate(changed);assert.throws(()=>assertCertificationSourceTrustPreserved(before,changed),/source certification policy|original source trust records/);
  }
});

test('sealed archive readback rejects missing, added, replaced and unsafe retained proof files',()=>{
  const directory=fixture();try{
    const candidate=join(directory,'candidate'),archive=join(directory,'candidate.tar');
    for(const member of renewalCandidateMembers)write(join(candidate,member),`exact original ${member}`);
    const pack=members=>execFileSync('tar',['-cf',archive,'-C',candidate,...members]);
    const rejects=pattern=>assert.throws(()=>verifySealedRenewalArchive({candidate,archive}),error=>pattern.test(String(error.stderr)));
    pack(renewalCandidateMembers);assert.equal(verifySealedRenewalArchive({candidate,archive}).files,renewalCandidateMembers.length);
    write(join(candidate,'source-delta.json'),'x'.repeat(readFileSync(join(candidate,'source-delta.json')).length));rejects(/readback mismatch/);
    pack(renewalCandidateMembers.slice(1));rejects(/omitted required/);
    write(join(candidate,'unlisted.json'),'unlisted');pack([...renewalCandidateMembers,'unlisted.json']);rejects(/Unlisted/);
    execFileSync('python3',['-c',"import io,sys,tarfile\nwith tarfile.open(sys.argv[1],'w') as t:\n m=tarfile.TarInfo('../escape');m.size=1;t.addfile(m,io.BytesIO(b'x'))",archive]);
    rejects(/Unsafe sealed/);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('certification controller records the exact successful CI attempt and rejects cross-attempt or cross-commit jobs',()=>{
  const head=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),base=`repos/${bootstrap.repository}`;
  const run={id:123,run_attempt:2,head_sha:head,path:'.github/workflows/ci.yml',event:'push',head_branch:'main',status:'completed',conclusion:'success',repository:{full_name:bootstrap.repository},head_repository:{full_name:bootstrap.repository}};
  const jobs=contract.required_ci_jobs.map((name,index)=>({name,id:500+index,run_id:123,run_attempt:2,head_sha:head,status:'completed',conclusion:'success'}));
  const api=endpoint=>{
    if(endpoint===`${base}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${head}&per_page=100`)return [{workflow_runs:[run]}];
    if(endpoint===`${base}/actions/runs/123/attempts/2`)return run;
    if(endpoint===`${base}/actions/runs/123/attempts/2/jobs?per_page=100`)return [{jobs}];
    throw Error(`Unexpected fixture endpoint ${endpoint}`);
  };
  const recorded=verifyRenewalCertifierController(root,api);assert.equal(recorded.head_sha,head);assert.equal(recorded.checks.length,jobs.length);
  assert.deepEqual(Object.keys(recorded).sort(),['head_sha','tree','checks'].sort());
  for(const [key,bad]of [['run_id',999],['head_sha','a'.repeat(40)],['run_attempt',3],['conclusion','failure']]){
    const original=jobs[0][key];jobs[0][key]=bad;assert.throws(()=>verifyRenewalCertifierController(root,api));jobs[0][key]=original;
  }
  run.conclusion='failure';assert.throws(()=>verifyRenewalCertifierController(root,api),/not successful/);
});

test('controls resolve committed request before fetching a missing captured UI Git object, while prepare remains closed',()=>{
  const directory=fixture();try{
    cpSync(here,join(directory,'.github/scripts'),{recursive:true});cpSync(join(root,'contracts'),join(directory,'contracts'),{recursive:true});
    cpSync(join(root,'frontend/src/static/transport'),join(directory,'frontend/src/static/transport'),{recursive:true});
    const h='a'.repeat(64),s='b'.repeat(40),source=JSON.parse(readFileSync(join(root,'contracts/financial_source_certification_trust_v1.json'))).reviewed_requests[0].request.source;
    const previous=`1/1/${h}/${h}`,ref={schema_version:'financial-release-receipt-v1',path:`static-data/financial-corrections/release-${h}.json`,sha256:h};
    const certificate={schema_version:'financial-source-certificate-reference-v1',repository:bootstrap.repository,workflow:'.github/workflows/financial-source-certification.yml',head_sha:s,run_id:22,run_attempt:1,job_id:41,artifact_id:199,artifact_name:`financial-source-certification-${s}-1`,artifact_sha256:h,certificate_sha256:h};
    const request={schema_version:'financial-source-renewal-request-v1',previous_publication_identity:previous,previous_release:ref,previous_lineage_sha256:h,previous_financial_generation:h,origin_release:ref,
      ui:{sha:s,digest:h,approval_sha256:h},consumer_code_sha256:h,financial_request:{schema_version:'financial-release-request-v1',correction:{schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,previous_publication_identity:previous,source},source_validation:{guard:'certified_source_artifact_v1',certificate},destination_projection:{projector:'native_annual_destination_v1',policy:'financial-correction-native-annual-v1'}},
      target:{evaluated_at:'2026-10-04T13:30:00.000Z',base_sha256:h,manifest_sha256:h,price_observations_sha256:h,known_price_dates_sha256:h,universe_sha256:h},price_input:{artifact_id:10,artifact_sha256:h,manifest_sha256:h,price_observations_sha256:h,known_price_dates_sha256:h},maximum_new_receipts:1};
    write(join(directory,renewalPolicy.request_path),JSON.stringify(request));
    for(const args of [['init','--quiet'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Commit isolated controls fixture']])execFileSync('git',['-C',directory,...args]);
    const head=execFileSync('git',['-C',directory,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),script=join(directory,'.github/scripts/financial-source-renewal-certification.mjs');
    const env={...process.env,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:bootstrap.repository,GITHUB_WORKFLOW_REF:`${bootstrap.repository}/${renewalPolicy.workflow}@refs/heads/main`,GITHUB_SHA:head,GITHUB_RUN_ID:'12',GITHUB_RUN_ATTEMPT:'1'};
    const controls=spawnSync(process.execPath,[script,'controls'],{cwd:directory,env,encoding:'utf8'});
    assert.equal(controls.status,0,controls.stderr);assert.equal(JSON.parse(controls.stdout).ui_sha,s);
    const prepare=spawnSync(process.execPath,[script,'prepare'],{cwd:directory,env,encoding:'utf8'});assert.equal(prepare.status,1);assert.match(prepare.stderr,/not a tree object/);
    write(join(directory,renewalPolicy.request_path),JSON.stringify(request,null,2));
    const dirty=spawnSync(process.execPath,[script,'controls'],{cwd:directory,env,encoding:'utf8'});assert.equal(dirty.status,1);assert.match(dirty.stderr,/committed and clean/);
    // Commit an existing captured consumer so the real verify-surfaces command
    // reaches its first awaited read. Reimporting the executing module there
    // exposed the former top-level-await cycle even before financial replay.
    write(join(directory,'frontend/package-lock.json'),'{}');write(join(directory,'backend/app/scripts/export_native_annual_projection.py'),'# Fixture code identity only\n');
    const commit=()=>{execFileSync('git',['-C',directory,'add','.']);execFileSync('git',['-C',directory,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Advance committed fixture']);return execFileSync('git',['-C',directory,'rev-parse','HEAD'],{encoding:'utf8'}).trim();};
    const captured=commit();request.ui.sha=captured;request.consumer_code_sha256=digest(consumerCodeInventory(protectedCodeInventory(directory,captured)));write(join(directory,renewalPolicy.request_path),JSON.stringify(request));env.GITHUB_SHA=commit();
    const hook=join(directory,'lazy-self-import.mjs');write(hook,`globalThis.fetch=async()=>{await import(${JSON.stringify(script)});throw Error('Reached fully evaluated renewal certifier');};`);
    const surfaces=spawnSync(process.execPath,['--import',hook,script,'verify-surfaces'],{cwd:directory,env,encoding:'utf8'});
    assert.equal(surfaces.status,1,surfaces.stderr);assert.match(surfaces.stderr,/Reached fully evaluated renewal certifier/);assert.doesNotMatch(surfaces.stderr,/unsettled top-level await/);
    write(hook,'globalThis.fetch=()=>new Promise(()=>{});');
    const pending=spawnSync(process.execPath,['--import',hook,script,'verify-surfaces'],{cwd:directory,env,encoding:'utf8'});assert.equal(pending.status,1);assert.match(pending.stderr,/Renewal certification command did not complete/);

  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('surface and seal compatibility preflight authenticates retained origin and rejects changed code before large candidate replay',async()=>{
  const directory=fixture();try{
    cpSync(here,join(directory,'.github/scripts'),{recursive:true});cpSync(join(root,'contracts'),join(directory,'contracts'),{recursive:true});
    cpSync(join(root,'frontend/src/static/transport'),join(directory,'frontend/src/static/transport'),{recursive:true});
    write(join(directory,'frontend/package-lock.json'),'{}');
    const projector='backend/app/scripts/export_native_annual_projection.py',originalProjector='# Original fixture projector\n';
    write(join(directory,projector),originalProjector);
    execFileSync('git',['-C',directory,'init','--quiet']);
    const commit=()=>{execFileSync('git',['-C',directory,'add','.']);execFileSync('git',['-C',directory,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Commit compatibility fixture']);return execFileSync('git',['-C',directory,'rev-parse','HEAD'],{encoding:'utf8'}).trim();};
    const captured=commit(),h='a'.repeat(64),s='b'.repeat(40),previous=`1/1/${h}/${h}`;
    const originBytes=Buffer.from(JSON.stringify({schema_version:'financial-release-receipt-v1',mode:'activation',ui:{approval:null}}));
    const originHash=sha256(originBytes),ref={schema_version:'financial-release-receipt-v1',path:`static-data/financial-corrections/release-${originHash}.json`,sha256:originHash};
    const source=JSON.parse(readFileSync(join(directory,'contracts/financial_source_certification_trust_v1.json'))).reviewed_requests[0].request.source;
    const certificate={schema_version:'financial-source-certificate-reference-v1',repository:bootstrap.repository,workflow:'.github/workflows/financial-source-certification.yml',head_sha:s,run_id:22,run_attempt:1,job_id:41,artifact_id:199,artifact_name:`financial-source-certification-${s}-1`,artifact_sha256:h,certificate_sha256:h};
    const request={schema_version:'financial-source-renewal-request-v1',previous_publication_identity:previous,previous_release:ref,previous_lineage_sha256:h,previous_financial_generation:h,origin_release:ref,
      ui:{sha:captured,digest:h,approval_sha256:h},consumer_code_sha256:digest(consumerCodeInventory(protectedCodeInventory(directory,captured))),
      financial_request:{schema_version:'financial-release-request-v1',correction:{schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,previous_publication_identity:previous,source},source_validation:{guard:'certified_source_artifact_v1',certificate},destination_projection:{projector:'native_annual_destination_v1',policy:'financial-correction-native-annual-v1'}},
      target:{evaluated_at:'2026-10-04T13:30:00.000Z',base_sha256:h,manifest_sha256:h,price_observations_sha256:h,known_price_dates_sha256:h,universe_sha256:h},
      price_input:{artifact_id:10,artifact_sha256:h,manifest_sha256:h,price_observations_sha256:h,known_price_dates_sha256:h},maximum_new_receipts:1};
    write(join(directory,renewalPolicy.request_path),JSON.stringify(request));write(join(directory,projector),'# Unreviewed projector\n');
    let head=commit();
    const candidate=join(directory,'candidate'),originPath=join(candidate,'predecessor',ref.path);
    write(originPath,originBytes);
    const helper=await import(pathToFileURL(join(directory,'.github/scripts/financial-source-renewal-certification.mjs')).href),calls=[];
    const api=endpoint=>{
      calls.push(endpoint);
      const match=new RegExp(`^repos/${bootstrap.repository}/contents/(.+)\\?ref=([a-f0-9]{40})$`).exec(endpoint);
      assert.ok(match,`Preflight unexpectedly reached a later verification phase: ${endpoint}`);
      const bytes=execFileSync('git',['-C',directory,'show',`${match[2]}:${match[1]}`]);
      return {type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')};
    };
    const options=()=>({root:directory,candidate,request,live:{},producer:{head_sha:head},api});
    for(const verify of [helper.verifyRenewalCertificationSurfaces,helper.sealRenewalCertification]){
      await assert.rejects(()=>verify(options()),/changed published consumer policy/);
      assert.ok(calls.length>0);calls.length=0;
      write(originPath,'{}');await assert.rejects(()=>verify(options()),/exact retained anchor/);assert.equal(calls.length,0);
      write(originPath,originBytes);
      // A same-byte link cannot become an authenticated retained origin.
      const duplicate=join(directory,'linked-origin.json');write(duplicate,originBytes);rmSync(originPath);symlinkSync(duplicate,originPath);
      await assert.rejects(()=>verify(options()),/bounded renewal artifact/);assert.equal(calls.length,0);
      rmSync(originPath);write(originPath,originBytes);rmSync(duplicate);
      assert.equal(existsSync(join(candidate,'candidate.json')),false);
      assert.equal(existsSync(join(candidate,'original-previous-source')),false);
    }
    // With compatible code the preflight succeeds, then the real pipeline
    // still demands its preview receipt; no new shortcut grants certification.
    write(join(directory,projector),originalProjector);rmSync(candidate,{recursive:true,force:true});head=commit();write(originPath,originBytes);
    for(const verify of [helper.verifyRenewalCertificationSurfaces,helper.sealRenewalCertification])await assert.rejects(()=>verify(options()),/ENOENT.*preview-receipt\.json/);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
