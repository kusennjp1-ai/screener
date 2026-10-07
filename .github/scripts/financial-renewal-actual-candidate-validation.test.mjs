import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readdirSync,rmSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIXED,STEPS,ARCHIVE_LIMIT,FILE_LIMIT,RESERVE,validateBinding,verifySourceMetadata,storageBudget,lockedPythonEnvironment,preflightLockedPython,preflightPythonSourceImports} from './financial-renewal-actual-candidate-validation.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const stamp=minute=>`2026-10-07T01:${String(minute).padStart(2,'0')}:00Z`;
function fixture(){
  const binding={...FIXED,workflow_id:123,job_id:456,job_completed_at:stamp(12),artifact_id:789,size_in_bytes:1024,sha256:'a'.repeat(64),artifact_created_at:stamp(11)};
  const run={id:binding.run_id,run_attempt:1,head_sha:binding.head_sha,head_branch:'main',event:'workflow_run',path:binding.workflow,name:binding.workflow_name,workflow_id:123,status:'completed',conclusion:'success',created_at:stamp(0),run_started_at:stamp(1),updated_at:stamp(13),repository:{full_name:binding.repository,id:binding.repository_id},head_repository:{full_name:binding.repository,id:binding.repository_id}};
  const job={id:456,run_id:binding.run_id,run_attempt:1,head_sha:binding.head_sha,name:binding.job_name,status:'completed',conclusion:'success',started_at:stamp(2),completed_at:stamp(12),steps:STEPS.map((name,i)=>({number:i+9,name,status:'completed',conclusion:'success',started_at:stamp(i+3),completed_at:stamp(i===5?11:i+4)}))};
  const artifact={id:789,name:binding.artifact_name,size_in_bytes:1024,digest:`sha256:${binding.sha256}`,expired:false,created_at:stamp(11),expires_at:'2026-10-21T01:11:00Z',workflow_run:{id:binding.run_id,head_sha:binding.head_sha,head_branch:'main',repository_id:binding.repository_id,head_repository_id:binding.repository_id}};
  return {binding,evidence:{run,latest:structuredClone(run),jobs:[job],artifacts:[artifact],workflow:{id:123,path:binding.workflow,name:binding.workflow_name}},now:Date.parse(stamp(15))};
}
const unbound=()=>({...FIXED,workflow_id:null,job_id:null,job_completed_at:null,artifact_id:null,size_in_bytes:null,sha256:null,artifact_created_at:null});
test('null terminal source binding remains rejected',()=>{assert.throws(()=>validateBinding(unbound()),/Unbound/);});
test('reviewed literal source binding is internally valid',()=>{validateBinding(JSON.parse(readFileSync(join(here,'financial-renewal-actual-candidate-binding.json'))));});
test('CLI rejects null binding before touching supplied checkout or output paths',()=>{
  const d=mkdtempSync(join(tmpdir(),'renewal-unbound-'));try{const wrapper=join(d,'financial-renewal-actual-candidate-validation.mjs');copyFileSync(join(here,'financial-renewal-actual-candidate-validation.mjs'),wrapper);writeFileSync(join(d,'financial-renewal-actual-candidate-binding.json'),JSON.stringify(unbound()));const before=readdirSync(d);const out=spawnSync(process.execPath,[wrapper,'retrieval',join(d,'missing-root'),join(d,'candidate'),join(d,'reports')],{encoding:'utf8',env:{PATH:'/definitely-no-commands'}});assert.equal(out.status,1);assert.match(out.stderr,/Unbound workflow_id/);assert.deepEqual(readdirSync(d),before);}finally{rmSync(d,{recursive:true});}
});
test('an unresolved asynchronous validator cannot report a zero exit',()=>{
  const module=new URL('./financial-renewal-actual-candidate-validation.mjs',import.meta.url).href;
  const out=spawnSync(process.execPath,['--input-type=module','-e',`import {runToCompletion} from ${JSON.stringify(module)};runToCompletion(()=>new Promise(()=>{}));`],{encoding:'utf8'});
  assert.equal(out.status,1);assert.match(out.stderr,/did not complete/);assert.equal(out.stdout,'');
});
test('source binding cannot substitute a different A, run, repository or control',()=>{
  const f=fixture();for(const [key,value]of [['head_sha','b'.repeat(40)],['run_id',1],['repository','evil/fork'],['request_raw_sha256','f'.repeat(64)],['registry_raw_sha256','f'.repeat(64)]])assert.throws(()=>validateBinding({...f.binding,[key]:value}));
  assert.throws(()=>validateBinding({...f.binding,unexpected:true}));assert.throws(()=>validateBinding({...f.binding,size_in_bytes:ARCHIVE_LIMIT+1}));
});
test('exact completed attempt, ordered source steps and artifact window pass',()=>{const f=fixture();assert.equal(verifySourceMetadata(f.binding,f.evidence,f.now).artifact.id,789);});
for(const [name,mutate]of [
  ['failed original run',e=>e.run.conclusion='failure'],['latest attempt superseded',e=>e.latest.run_attempt=2],
  ['foreign head repository',e=>e.run.head_repository.id=1],['changed source head',e=>e.run.head_sha='b'.repeat(40)],
  ['missing job',e=>e.jobs=[]],['duplicate job',e=>e.jobs.push(structuredClone(e.jobs[0]))],
  ['missing upload',e=>e.jobs[0].steps.pop()],['duplicate seal step',e=>e.jobs[0].steps.push(structuredClone(e.jobs[0].steps[4]))],
  ['failed measuring step',e=>e.jobs[0].steps[2].conclusion='failure'],['changed step numbering',e=>e.jobs[0].steps[2].number=99],
  ['out-of-order step clocks',e=>e.jobs[0].steps[2].started_at=stamp(1)],['artifact before upload',e=>e.jobs[0].steps[5].started_at=stamp(12)],
  ['duplicate artifact name',e=>e.artifacts.push({...e.artifacts[0],id:790})],['replaced artifact',e=>e.artifacts[0].digest=`sha256:${'c'.repeat(64)}`],
  ['expired artifact flag',e=>e.artifacts[0].expired=true],['elapsed retention',e=>e.artifacts[0].expires_at=stamp(14)],
  ['future source completion',e=>e.run.updated_at=stamp(16)],['wrong artifact repository',e=>e.artifacts[0].workflow_run.repository_id=1],
])test(`reject ${name}`,()=>{const f=fixture();mutate(f.evidence);assert.throws(()=>verifySourceMetadata(f.binding,f.evidence,f.now));});
test('measured extraction and two full canonical restores determine space admission',()=>{
  const m={zipBytes:1000,tarBytes:2000,extractedBytes:1500,candidateRestoreBytes:3000,predecessorRestoreBytes:4000,sourceBytes:500,fileCount:20,availableBytes:0};
  const required=1500+6000+8000+1000+20*4096+RESERVE;
  assert.equal(storageBudget({...m,availableBytes:required}).additionalBytes,required);
  assert.throws(()=>storageBudget({...m,availableBytes:required-1}),/Insufficient measured space/);
  assert.throws(()=>storageBudget({...m,availableBytes:Number.MAX_SAFE_INTEGER,candidateRestoreBytes:Number.MAX_SAFE_INTEGER}));
  assert.throws(()=>storageBudget({...m,availableBytes:Number.MAX_SAFE_INTEGER,fileCount:FILE_LIMIT+1}));
  assert.throws(()=>storageBudget({...m,availableBytes:Number.MAX_SAFE_INTEGER,extractedBytes:ARCHIVE_LIMIT+1}));
});

const testPins={yfinance:'0.2.66',curl_cffi:'0.16.3',pandas:'2.2.0',numpy:'1.26.3',requests:'2.31.0',jsonschema:'4.23.0'};
function pythonFixture(){
  const directory=mkdtempSync(join(tmpdir(),'renewal-python-env-')),runtime=join(directory,'venv'),root=join(directory,'source'),decoy=join(directory,'system-bin');
  execFileSync('python3',['-m','venv','--without-pip',runtime]);
  const site=execFileSync(join(runtime,'bin/python'),['-c','import sysconfig; print(sysconfig.get_path("purelib"))'],{encoding:'utf8'}).trim();
  // Tiny test modules stand in for package imports only. No production source,
  // financial implementation or provider behavior is supplied by this fixture.
  for(const [name,version]of Object.entries(testPins)){
    writeFileSync(join(site,`${name}.py`),`fixture_marker = ${JSON.stringify(name)}\n`);
    const dist=join(site,`${name}-${version}.dist-info`);mkdirSync(dist);writeFileSync(join(dist,'METADATA'),`Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n`);
  }
  mkdirSync(join(root,'.github/scripts'),{recursive:true});writeFileSync(join(root,'.github/scripts/financial-release-projection-requirements.txt'),Object.entries(testPins).map(([name,version])=>`${name}==${version}\n`).join(''));
  mkdirSync(decoy);for(const name of ['python','python3'])writeFileSync(join(decoy,name),'#!/bin/sh\necho WRONG_SYSTEM_PYTHON >&2\nexit 61\n',{mode:0o755});
  return {directory,runtime,root,site,environment:{...process.env,PATH:decoy+':'+process.env.PATH,FINANCIAL_REPLAY_PYTHON:join(runtime,'bin/python')}};
}
test('explicit replay Python alone leaves nested bare-python calls broken; PATH activation fixes all launches',()=>{
  const f=pythonFixture();try{
    const prior=spawnSync('python3',['-c','import jsonschema,pandas,numpy'],{env:f.environment,encoding:'utf8'});assert.equal(prior.status,61);assert.match(prior.stderr,/WRONG_SYSTEM_PYTHON/);
    const verified=preflightLockedPython(f.root,f.runtime,f.environment);assert.equal(verified.report.launches.length,3);
    for(const launch of verified.report.launches){assert.equal(launch.prefix,f.runtime);assert.equal(dirname(launch.executable),join(f.runtime,'bin'));assert.deepEqual(launch.versions,testPins);}
    const nested=execFileSync(process.execPath,['--input-type=module','-e','import {execFileSync} from "node:child_process";process.stdout.write(execFileSync("python3",["-c","import jsonschema,pandas,numpy,sys;print(sys.prefix)"],{encoding:"utf8"}));'],{env:verified.environment,encoding:'utf8'});
    assert.equal(nested.trim(),f.runtime);
  }finally{rmSync(f.directory,{recursive:true});}
});
test('locked Python preflight refuses missing dependency and mismatched pinned version',()=>{
  const f=pythonFixture();try{
    writeFileSync(join(f.site,'jsonschema-4.23.0.dist-info/METADATA'),'Metadata-Version: 2.1\nName: jsonschema\nVersion: 0.0.0\n');
    assert.throws(()=>preflightLockedPython(f.root,f.runtime,f.environment),/Locked dependency version mismatch/);
    writeFileSync(join(f.site,'jsonschema-4.23.0.dist-info/METADATA'),'Metadata-Version: 2.1\nName: jsonschema\nVersion: 4.23.0\n');
    rmSync(join(f.site,'numpy.py'));assert.throws(()=>preflightLockedPython(f.root,f.runtime,f.environment),/No module named 'numpy'/);
  }finally{rmSync(f.directory,{recursive:true});}
});
test('configured explicit interpreter cannot diverge from the locked PATH interpreter',()=>{
  assert.throws(()=>lockedPythonEnvironment('/absolute/venv',{PATH:'/usr/bin',FINANCIAL_REPLAY_PYTHON:'/usr/bin/python3'}),/differs from locked venv/);
  const env=lockedPythonEnvironment('/absolute/venv',{PATH:'/usr/bin'});assert.equal(env.PATH,'/absolute/venv/bin:/usr/bin');assert.equal(env.FINANCIAL_REPLAY_PYTHON,'/absolute/venv/bin/python');
});
test('source import preflight detects a missing lazy adapter dependency before replay',()=>{
  const f=pythonFixture();try{
    for(const name of ['services','scripts'])mkdirSync(join(f.root,'backend/app',name),{recursive:true});
    for(const name of ['export_native_annual_projection','verify_statement_source_renewal'])writeFileSync(join(f.root,'backend/app/scripts',`${name}.py`),'fixture_module = True\n');
    const batch=join(f.root,'backend/app/services/financial_statement_batch.py');writeFileSync(batch,'def runtime():\n import definitely_missing_runtime_dependency\n');
    for(const name of ['verify-postcapture-correction-archive.py','verify-certified-correction-archive.py','check-pages-payload.py'])writeFileSync(join(f.root,'.github/scripts',name),'fixture_helper = True\n');
    const environment=lockedPythonEnvironment(f.runtime,f.environment);
    assert.throws(()=>preflightPythonSourceImports(f.root,environment),/definitely_missing_runtime_dependency/);
    writeFileSync(batch,'def runtime():\n return tuple(range(7))\n');
    const passed=preflightPythonSourceImports(f.root,environment);assert.equal(passed.prefix,f.runtime);assert.equal(passed.imported_modules.length,2);assert.equal(passed.imported_helpers.length,3);assert.equal(passed.lazy_runtime_handles,7);
  }finally{rmSync(f.directory,{recursive:true});}
});
