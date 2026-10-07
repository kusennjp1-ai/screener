// Fixed online acquisition/verification around the separately isolated worker.
// Never import the admission module here: its authenticated functions are passed
// explicitly, so producer and independent restore use the same finite adapter.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {appendFileSync,closeSync,createWriteStream,existsSync,fstatSync,lstatSync,mkdirSync,openSync,readFileSync,
  readlinkSync,readSync,readdirSync,realpathSync,statfsSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {priceReadApi,priceExecution,verifyPriceCiProducer,verifyPriceActivation,PRICE_CI} from './retained-price-ci-admission.mjs';
import {extractPriceObservations,priceObservationDigest,assertPriceObservationBounds} from './price-observations.mjs';

const MIB=1024**2,MAX_JSON=64*MIB,RESERVE=8*1024**3,SOURCE_BYTES=1876607954;
const REPLAY_FREE=RESERVE+3*SOURCE_BYTES+256*MIB,DEPENDENCY_BYTES=2*1024**3;
const REPOSITORY='kusennjp1-ai/screener',PREFIX=`repos/${REPOSITORY}`;
const DATA_FILES=new Set(['research-daily.json','portfolio-model.json','qualification-audit.json','ibd-reference.json']);
const SOURCE_AUDIT='static-data/retained-price-source-audit/',REPLAY_AUDIT='static-data/retained-price-source-replay-audit/';
const isData=name=>name.startsWith('static-data/')||DATA_FILES.has(name);
const ORIGINAL_PINS=JSON.parse(readFileSync(new URL('./fixtures/retained-price-recovery-oct6-inputs.json',import.meta.url)));
export const OBSERVATION_RESPONSE_KEYS=[`GET ${PREFIX}`,`GET ${PREFIX}/git/ref/heads/main`];
export const ORIGINAL_RESPONSE_KEYS=[`GET ${PREFIX}/git/trees/2186101e92e1f71771936831cea0a40e410975f7?recursive=1`,
  ...['candidate','prior'].flatMap(role=>{const pin=ORIGINAL_PINS[role];return [`GET ${PREFIX}/actions/runs/${pin.run_id}`,`GET ${PREFIX}/actions/runs/${pin.run_id}/attempts/1`,
    `GET ${PREFIX}/git/commits/${pin.head_sha}`,`GET_PAGES ${PREFIX}/actions/runs/${pin.run_id}/attempts/1/jobs?per_page=100`,`GET_PAGES ${PREFIX}/actions/runs/${pin.run_id}/artifacts?per_page=100`];})];
const SHA=/^[a-f0-9]{64}$/,GIT=/^[a-f0-9]{40}$/;
const positive=v=>Number.isSafeInteger(v)&&v>0;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const canonical=value=>Buffer.from(JSON.stringify(ordered(value)));
const same=(a,b,label)=>assert.deepEqual(ordered(a),ordered(b),label);
const keys=(value,expected,label)=>{assert(value&&typeof value==='object'&&!Array.isArray(value),label);same(Object.keys(value).sort(),[...expected].sort(),label);};
const below=(root,path)=>path!==root&&path.startsWith(root+sep);
const safeRelative=name=>typeof name==='string'&&!name.includes('\\')&&!/[\x00-\x1f\x7f]/.test(name)&&!name.startsWith('/')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');
const utc=value=>{assert(typeof value==='string'&&value.endsWith('Z')&&Number.isFinite(Date.parse(value)),'Invalid UTC job clock');return Date.parse(value);};
const runDefault=(command,args,options={})=>execFileSync(command,args,{encoding:'utf8',maxBuffer:MAX_JSON,timeout:120000,...options});

function options(input){
  assert(input?.authority,'Missing explicit source admission authority');
  const root=resolve(input.root),runnerTemp=resolve(input.runnerTemp??process.env.RUNNER_TEMP??'');
  assert(isAbsolute(input.root)&&input.runnerTemp!==''&&(input.runnerTemp||process.env.RUNNER_TEMP),'Explicit controller and RUNNER_TEMP are required');
  assert(realpathSync(root)===root&&realpathSync(runnerTemp)===runnerTemp&&root!==runnerTemp&&!below(root,runnerTemp),'Controller and scratch roots overlap');
  return {...input,root,runnerTemp,api:input.api??priceReadApi,now:input.now??Date.now,run:input.run??runDefault,
    producerGate:input.producerGate??verifyPriceCiProducer,activationGate:input.activationGate??verifyPriceActivation,
    execution:input.execution??priceExecution(),event:input.event??null};
}

function outputPath(value,o,{existing=false}={}){
  assert(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&below(o.runnerTemp,value)&&!below(o.root,value),'Output must be explicit RUNNER_TEMP path outside controller');
  assert(realpathSync(dirname(value))===dirname(value),'Linked output parent');
  if(existing)assert(lstatSync(value).isDirectory()&&realpathSync(value)===value,'Completed output must be real directory');
  else assert(!existsSync(value),'Output already exists');
  return value;
}

export function hashFile(path,cap=8*1024**3){
  assert(isAbsolute(path)&&realpathSync(path)===path,'Linked/nonabsolute input file');
  const stat=lstatSync(path);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=cap,'Nonregular or oversized input file');
  const fd=openSync(path,'r'),hash=createHash('sha256'),buffer=Buffer.alloc(MIB);let count=0;
  try{for(;;){const n=readSync(fd,buffer,0,buffer.length,null);if(!n)break;count+=n;assert(count<=stat.size,'Input grew while hashing');hash.update(buffer.subarray(0,n));}
    const after=fstatSync(fd),current=lstatSync(path);for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert(stat[key]===after[key]&&stat[key]===current[key],'Input changed while hashing');
  }finally{closeSync(fd);}
  assert(count===stat.size,'Input shrank while hashing');return {bytes:count,sha256:hash.digest('hex')};
}

function read(path,cap=MAX_JSON){const pin=hashFile(path,cap),raw=readFileSync(path);assert(raw.length===pin.bytes&&digest(raw)===pin.sha256,'JSON changed while reading');return {raw,value:JSON.parse(raw),...pin};}
function write(path,value){const raw=Buffer.isBuffer(value)?value:canonical(value);assert(raw.length<=MAX_JSON,'Source JSON exceeds cap');writeFileSync(path,raw,{flag:'wx',mode:0o600});return {path,...hashFile(path,MAX_JSON)};}
function refValue(ref){keys(ref,['path','bytes','sha256'],'Invalid bound file reference');assert(positive(ref.bytes)&&SHA.test(ref.sha256),'Invalid bound file digest');same(hashFile(ref.path,MAX_JSON),{bytes:ref.bytes,sha256:ref.sha256},'Bound file changed');return read(ref.path).value;}

export function physicalInventory(root,{dependencies=false}={}){
  assert(isAbsolute(root)&&realpathSync(root)===root&&lstatSync(root).isDirectory(),'Invalid inventory root');
  const files={};let total=0,count=0;
  function walk(prefix=''){
    for(const name of readdirSync(join(root,prefix)).sort()){
      const key=prefix?`${prefix}/${name}`:name,path=join(root,key);assert(safeRelative(key),'Unsafe inventory path');
      const stat=lstatSync(path);
      if(stat.isSymbolicLink()){
        assert(dependencies&&below(root,realpathSync(path)),'Linked source or escaping dependency');files[key]={symlink:readlinkSync(path)};count++;
      }else if(stat.isDirectory())walk(key);
      else{assert(stat.isFile(),'Nonregular inventory member');total+=stat.size;assert(total<=(dependencies?DEPENDENCY_BYTES:8*1024**3),'Inventory byte bound exceeded');files[key]=hashFile(path);count++;}
      assert(count<=(dependencies?100000:50000),'Inventory member bound exceeded');
    }
  }
  walk();return files;
}

function eventFor(o){if(o.event)return o.event;assert(process.env.GITHUB_EVENT_PATH,'Missing actual workflow event');return read(process.env.GITHUB_EVENT_PATH,MIB).value;}
function git(o,...args){return String(o.run('git',args,{cwd:o.root,timeout:120000})).trim();}
function controllerFor(o){const value={head:git(o,'rev-parse','HEAD'),tree:git(o,'rev-parse','HEAD^{tree}')};assert(GIT.test(value.head)&&GIT.test(value.tree),'Invalid controller Git identity');return value;}
function jobList(o,id,attempt){const pages=o.api(`${PREFIX}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100`,true);
  assert(Array.isArray(pages)&&pages.length>0&&pages.length<=10,'Incomplete caller job inventory');const all=pages.flatMap(p=>p.jobs??[]),total=pages[0].total_count;
  assert(total===all.length&&all.length<=1000&&pages.every(p=>p.total_count===total)&&new Set(all.map(j=>j.id)).size===all.length,'Truncated caller jobs');return all;}
function callerFor(o,controller,role){
  const execution=o.execution,workflow=role==='producer'?PRICE_CI.producer:PRICE_CI.publisher,name=role==='producer'?'combine-and-build':'publish';
  assert(execution.repository===REPOSITORY&&execution.repository_id===PRICE_CI.repositoryId&&execution.ref==='refs/heads/main'
    &&execution.event_name==='workflow_run'&&execution.sha===controller.head&&execution.workflow_sha===controller.head
    &&execution.workflow_ref===`${REPOSITORY}/${workflow.path}@refs/heads/main`&&positive(execution.run_id)&&execution.run_attempt===1,'Untrusted active caller context');
  const run=o.api(`${PREFIX}/actions/runs/${execution.run_id}/attempts/1`),current=o.api(`${PREFIX}/actions/runs/${execution.run_id}`);
  for(const item of [run,current])assert(item.id===execution.run_id&&item.run_attempt===1&&item.head_sha===controller.head&&item.head_branch==='main'
    &&item.path===workflow.path&&item.workflow_id===workflow.id&&item.event==='workflow_run'&&item.status==='in_progress'&&item.conclusion===null
    &&['repository','head_repository'].every(k=>item[k]?.full_name===REPOSITORY&&item[k].id===PRICE_CI.repositoryId),'Caller is not the genuine active workflow attempt');
  const jobs=jobList(o,run.id,1),found=jobs.filter(j=>j.name===name);assert(found.length===1,'Ambiguous active caller job');const job=found[0];
  assert(positive(job.id)&&job.run_id===run.id&&job.run_attempt===1&&job.head_sha===controller.head&&job.status==='in_progress'&&job.conclusion===null
    &&utc(job.started_at)<=o.now(),'Caller job is not active');
  const commit=o.api(`${PREFIX}/git/commits/${controller.head}`);assert(commit.sha===controller.head&&commit.tree?.sha===controller.tree,'Caller controller tree differs');
  return {run,attempt:1,job,commit,job_started_at:job.started_at};
}
const compact=caller=>({run_id:caller.run.id,run_attempt:caller.attempt,head_sha:caller.run.head_sha,job:{id:caller.job.id,started_at:caller.job.started_at}});
export function immutableOriginals(evidence){
  const expected=[...ORIGINAL_RESPONSE_KEYS,...OBSERVATION_RESPONSE_KEYS];
  keys(evidence.responses,expected,'Unknown or missing original API response');keys(evidence.response_sha256,expected,'Unknown or missing original API response digest');
  assert(Object.values(evidence.response_sha256).every(value=>typeof value==='string'&&SHA.test(value)),'Invalid original API response digest');
  const immutable_responses=Object.fromEntries(ORIGINAL_RESPONSE_KEYS.map(k=>[k,evidence.responses[k]])),
    immutable_response_sha256=Object.fromEntries(ORIGINAL_RESPONSE_KEYS.map(k=>[k,evidence.response_sha256[k]]));
  const repositoryKey=`GET ${PREFIX}`;assert(evidence.responses[repositoryKey]&&typeof evidence.responses[repositoryKey]==='object'&&!Array.isArray(evidence.responses[repositoryKey]),'Invalid repository response');
  const repository={...evidence.responses[repositoryKey]};
  for(const key of ['pushed_at','updated_at','size'])delete repository[key];
  immutable_responses[repositoryKey]=repository;immutable_response_sha256[repositoryKey]=digest(canonical(repository));
  return {...Object.fromEntries(['schema_version','publication_authority','provider_work','reviewed_historical_main','approved_ui','producer_runtime','selected'].map(k=>[k,evidence[k]])),
    immutable_responses,immutable_response_sha256};
}
async function liveFor(o){return o.readLive?o.readLive({repository:REPOSITORY,api:o.api}):(await import('./publication-state.mjs')).livePublication({repository:REPOSITORY,api:o.api});}
async function freshProducer(o){
  const request=o.authority.readRepairRequest(o.root);assert(request?.value.enabled,'Finite source request is disabled');o.authority.validateRepairRequest(request.value);
  const gate=o.producerGate({root:o.root,event:eventFor(o),execution:o.execution,api:o.api,now:o.now()});assert(gate.status==='verified'&&gate.repair===true,'Fresh exact CI producer admission failed');
  const controller=controllerFor(o);same(gate.activation.executing,{sha:controller.head,tree:controller.tree},'CI/controller binding differs');
  const caller=callerFor(o,controller,'producer'),live=await liveFor(o);o.authority.assertRepairPredecessor(live,request.value);
  const originals=o.authority.authenticateOriginals({api:o.api,request:request.value,caller,controller,now:o.now()});
  return {request,gate,controller,caller,live,originals};
}

export async function downloadOriginalArchive(role,pin,destination,{spawnProcess=spawn,timeoutMs=240000}={}){
  assert(['candidate','companion','prior'].includes(role)&&positive(pin.artifact_id)&&positive(pin.bytes)&&SHA.test(pin.sha256)&&!existsSync(destination),'Invalid original download binding');
  assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=240000,'Invalid original download timeout');
  const child=spawnProcess('gh',['api',`${PREFIX}/actions/artifacts/${pin.artifact_id}/zip`],{stdio:['ignore','pipe','pipe'],timeout:timeoutMs});
  let bytes=0,stderr=0;child.stderr.on('data',chunk=>{stderr+=chunk.length;if(stderr>MIB)child.kill('SIGKILL');});
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>pin.bytes)child.kill('SIGKILL');});
  const done=new Promise((accept,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>code===0?accept():reject(Error(`Original ${role} download failed (${code??signal})`)));});
  try{await Promise.all([pipeline(child.stdout,createWriteStream(destination,{flags:'wx',mode:0o600})),done]);}
  catch(error){child.kill('SIGKILL');await done.catch(()=>{});throw error;}
  assert(bytes===pin.bytes,'Original download byte count differs');same(hashFile(destination,pin.bytes),{bytes:pin.bytes,sha256:pin.sha256},'Original archive changed');
}

function requireSpace(path,bytes,o){const free=o.freeBytes?o.freeBytes(path):(()=>{const s=statfsSync(path);return s.bavail*s.bsize;})();assert(Number.isSafeInteger(free)&&free>=bytes,`Insufficient bounded source storage: need ${bytes}, have ${free}`);}
export function prepareApprovedDependencies(directory,request,o){
  assert(!existsSync(directory),'Prepared runtime already exists');
  const ui=request.approved_ui,origin=git(o,'remote','get-url','origin');
  assert([`https://github.com/${REPOSITORY}`,`https://github.com/${REPOSITORY}.git`].includes(origin),'Unreviewed source Git remote');
  try{git(o,'cat-file','-e',`${ui.sha}^{tree}`);}catch{git(o,'fetch','--no-tags','--no-write-fetch-head','origin',ui.sha);}
  assert(git(o,'rev-parse',`${ui.sha}^{tree}`)===ui.tree&&git(o,'rev-parse',`${ui.sha}:frontend`)===ui.frontend_tree,'Approved UI Git object/tree changed');
  mkdirSync(directory,{mode:0o700});
  for(const name of ['package.json','package-lock.json']){
    const raw=o.run('git',['show',`${ui.sha}:frontend/${name}`],{cwd:o.root,encoding:null,timeout:30000});assert(Buffer.isBuffer(raw)&&raw.length<=8*MIB,'Invalid approved package bytes');write(join(directory,name),raw);
  }
  const nodeVersion=String(o.run('node',['--version'],{timeout:10000})).trim(),npmVersion=String(o.run('npm',['--version'],{timeout:10000})).trim();
  assert(/^v22\./.test(nodeVersion)&&/^\d+\.\d+\.\d+$/.test(npmVersion),'Production runtime requires CI Node22/npm toolchain');
  const cache=join(directory,'npm-cache');mkdirSync(cache);
  o.run('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:directory,timeout:15*60*1000,stdio:'inherit',
    env:{...process.env,NPM_CONFIG_CACHE:cache,NPM_CONFIG_UPDATE_NOTIFIER:'false'}});
  const modules=join(directory,'node_modules'),receipt={schema_version:'retained-price-source-dependencies-v1',approved_ui:ui,
    package_lock:hashFile(join(directory,'package-lock.json'),8*MIB),node_version:nodeVersion,npm_version:npmVersion,
    command:['npm','ci','--ignore-scripts','--no-audit','--no-fund'],files:physicalInventory(modules,{dependencies:true})};
  return {node_modules:modules,receipt};
}

function jobStartRef(path,o,caller){assert(isAbsolute(path)&&below(o.runnerTemp,path),'Job clock must be under RUNNER_TEMP');const pin=hashFile(path,128),epoch=Number(readFileSync(path,'utf8').trim());
  assert(Number.isFinite(epoch)&&epoch>0&&epoch*1000<=o.now(),'Invalid original first-step clock');const started=Math.min(epoch*1000,utc(caller.job.started_at));
  assert(started+100*60*1000>o.now(),'No job budget remains before upload reserve');return {path,...pin,epoch};}
function publisherJobStart(o,caller,supplied){
  const path=supplied??process.env.RETAINED_PRICE_PUBLISHER_JOB_START;
  assert(path===join(o.runnerTemp,'retained-price-publisher-job-start'),'Missing fixed publisher first-step clock');
  jobStartRef(path,o,caller);return path;
}
export function validateArithmeticRuntime(o,mode){
  assert(['producer','replay'].includes(mode),'Invalid arithmetic runtime role');
  const directory=join(o.runnerTemp,mode==='producer'?'retained-price-python':'financial-replay-runtime');
  const python=process.env.RETAINED_PRICE_PYTHON;
  assert(python===join(directory,'bin/python3.11')&&realpathSync(directory)===directory,'Missing exact dedicated arithmetic interpreter');
  const source="import json,sys,numpy,pandas; print(json.dumps({'executable':sys.executable,'prefix':sys.prefix,'version':list(sys.version_info[:3]),'numpy':numpy.__version__,'pandas':pandas.__version__}))";
  const actual=JSON.parse(o.run(python,['-c',source],{timeout:30000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
  keys(actual,['executable','prefix','version','numpy','pandas'],'Unexpected arithmetic runtime declaration');
  assert(actual.executable===python&&actual.prefix===directory&&Array.isArray(actual.version)&&actual.version.length===3&&actual.version[0]===3&&actual.version[1]===11
    &&actual.numpy==='1.26.3'&&actual.pandas==='2.2.0','Unreviewed Python/pandas/numpy arithmetic runtime');
  return {schema_version:'retained-price-arithmetic-runtime-v1',mode,...actual};
}
export function isolatedWorkerCommand({root,inputs,output,jobStart,python,parentNamespace,path,uid=process.getuid(),gid=process.getgid()}){
  assert(isAbsolute(python)&&/^net:\[\d+\]$/.test(parentNamespace)&&typeof path==='string'&&!path.includes('\n'),'Invalid isolated worker runtime');
  assert(Number.isSafeInteger(uid)&&uid>=0&&Number.isSafeInteger(gid)&&gid>=0,'Invalid original worker owner');
  return ['sudo',['-n','unshare','--net',`--setuid=${uid}`,`--setgid=${gid}`,'--','env','-i',`PATH=${path}`,'LANG=C.UTF-8','LC_ALL=C.UTF-8','PYTHONDONTWRITEBYTECODE=1',
    python,join(root,'.github/scripts/run-retained-price-source.py'),'--inputs',inputs,'--output',output,'--job-start',jobStart,'--parent-network-namespace',parentNamespace]];
}
function launch(o,inputs,output,jobStart){
  const mode=read(inputs).value.mode,arithmetic=validateArithmeticRuntime(o,mode);same(arithmetic,o.arithmeticRuntimeEvidence,'Prepared arithmetic runtime changed');
  const python=arithmetic.executable;
  const command=isolatedWorkerCommand({root:o.root,inputs,output,jobStart,python,parentNamespace:readlinkSync('/proc/self/ns/net'),path:`${dirname(python)}:${process.env.PATH}`});
  // The unchanged Python supervisor computes its deadline from the real job
  // start and owns the process group, heartbeat, TERM/KILL cleanup and reserve.
  o.run(command[0],command[1],{cwd:o.root,stdio:'inherit',timeout:0});
}
function verifyLocal(o,output,inputs){
  const code="import importlib.util,json,pathlib,sys; s=importlib.util.spec_from_file_location('source_worker',sys.argv[1]); w=importlib.util.module_from_spec(s); s.loader.exec_module(w); print(json.dumps(w.verify_completed_output(pathlib.Path(sys.argv[2]),pathlib.Path(sys.argv[3]))))";
  const raw=o.run('python3.11',['-c',code,join(o.root,'.github/scripts/run-retained-price-source.py'),output,inputs],
    {cwd:o.root,timeout:15*60*1000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  return JSON.parse(raw);
}

async function acquire(o,context,{output,jobStart,mode,authenticated=null}){
  const inputsDirectory=output+'-inputs',dependencyDirectory=output+'-dependencies';
  const clock=jobStartRef(jobStart,o,context.caller),deadline=Math.min(clock.epoch*1000,utc(context.caller.job.started_at))+100*60*1000;
  const remaining=()=>{const value=Math.floor(deadline-o.now()-24000);assert(value>0,'Online setup exhausted the bounded upload/cleanup reserve');return value;};
  const online={...o,run:(command,args,configuration={})=>o.run(command,args,{...configuration,timeout:Math.min(configuration.timeout||120000,remaining())})};
  const arithmetic=(o.arithmeticRuntime??validateArithmeticRuntime)(online,mode);
  outputPath(inputsDirectory,o);outputPath(dependencyDirectory,o);
  requireSpace(dirname(output),REPLAY_FREE+DEPENDENCY_BYTES+128*MIB+Object.values(context.originals.archives).reduce((n,p)=>n+p.bytes,0),o);
  mkdirSync(inputsDirectory,{mode:0o700});
  write(join(inputsDirectory,'acquisition-start-api-evidence.json'),context.originals.evidence);
  const requestRef=write(join(inputsDirectory,'request.json'),context.request.raw);
  for(const role of ['candidate','companion','prior'])await (o.downloadOriginal??downloadOriginalArchive)(role,context.originals.archives[role],join(inputsDirectory,role+'.zip'),{timeoutMs:Math.min(240000,remaining())});
  const prepared=(o.prepareDependencies??prepareApprovedDependencies)(dependencyDirectory,context.request.value,online);
  const after=o.authority.authenticateOriginals({api:o.api,request:context.request.value,caller:context.caller,controller:context.controller,now:o.now()});
  same(immutableOriginals(after.evidence),immutableOriginals(context.originals.evidence),'Original source evidence changed during acquisition');
  const originalRef=write(join(inputsDirectory,'original-api-evidence.json'),after.evidence);
  const invocation={schema_version:'retained-price-source-invocation-v1',mode,request_sha256:context.request.sha256,
    controller:context.controller,caller:compact(context.caller),selected_producer:null};
  let producerDeclaration=null;
  if(mode==='replay'){
    assert(authenticated,'Replay requires freshly authenticated selected producer');
    producerDeclaration=write(join(inputsDirectory,'producer-declaration.json'),authenticated.declaration.raw);
    invocation.selected_producer={run_id:authenticated.producer.id,run_attempt:authenticated.producer.run_attempt,head_sha:authenticated.producer.head_sha,
      job:{id:authenticated.proof.job.id,started_at:authenticated.proof.job.started_at,completed_at:authenticated.proof.job.completed_at},declaration_sha256:authenticated.declaration.sha256};
  }
  const value={schema_version:'retained-price-source-worker-input-v1',mode,request:requestRef,original_api_evidence:originalRef,
    invocation_evidence:write(join(inputsDirectory,'invocation-evidence.json'),invocation),
    ...Object.fromEntries(['candidate','companion','prior'].map(role=>[role+'_zip',join(inputsDirectory,role+'.zip')])),
    approved_ui:context.request.value.approved_ui,dependencies:{node_modules:prepared.node_modules,receipt:write(join(inputsDirectory,'dependencies.json'),prepared.receipt)},
    producer_declaration:producerDeclaration};
  const inputRef=write(join(inputsDirectory,'inputs.json'),value);remaining();
  const plan={schema_version:'retained-price-source-driver-plan-v1',mode,output,inputs:inputRef,request_sha256:context.request.sha256,
    caller:compact(context.caller),controller:context.controller,job_start:clock,arithmetic_runtime:arithmetic,originals_sha256:digest(canonical(immutableOriginals(after.evidence))),
    selected_source:authenticated?{artifact:authenticated.artifact.id,payload_sha256:authenticated.declaration.sha256,physical_sha256:authenticated.physical.sha256}:null};
  write(output+'-driver-plan.json',plan);
  requireSpace(dirname(output),REPLAY_FREE,o);
  (o.launchWorker??launch)({...o,arithmeticRuntimeEvidence:arithmetic},inputRef.path,output,jobStart);
  (o.verifyLocal??verifyLocal)(o,output,inputRef.path);
  return plan;
}

export async function produceRetainedSource(input){
  const o=options(input),output=outputPath(input.output,o),context=await freshProducer(o);
  const plan=await acquire(o,context,{output,jobStart:input.jobStart,mode:'producer'});
  const result=await verifyProducedRetainedSource({...o,output});
  if(process.env.GITHUB_OUTPUT&&!o.suppressWorkflowOutput)appendFileSync(process.env.GITHUB_OUTPUT,`site_dir=${join(output,'runtime/frontend/dist')}\n`);
  return {...result,site_dir:join(output,'runtime/frontend/dist'),plan};
}

export async function verifyProducedRetainedSource(input){
  const o=options(input),output=outputPath(input.output,o,{existing:true}),plan=read(output+'-driver-plan.json').value;
  keys(plan,['schema_version','mode','output','inputs','request_sha256','caller','controller','job_start','arithmetic_runtime','originals_sha256','selected_source'],'Invalid driver plan');
  assert(plan.schema_version==='retained-price-source-driver-plan-v1'&&plan.mode==='producer'&&plan.output===output&&plan.selected_source===null,'Wrong producer driver plan');
  const context=await freshProducer(o);same(plan.caller,compact(context.caller),'Producer caller changed');same(plan.controller,context.controller,'Producer controller changed');
  assert(plan.request_sha256===context.request.sha256&&plan.originals_sha256===digest(canonical(immutableOriginals(context.originals.evidence))),'Producer request/originals changed');
  assert(plan.inputs.path===join(output+'-inputs','inputs.json'),'Producer input plan moved outside its bounded sibling');
  refValue(plan.inputs);keys(plan.job_start,['path','bytes','sha256','epoch'],'Invalid original job clock reference');
  same(jobStartRef(plan.job_start.path,o,context.caller),plan.job_start,'Original job clock changed');
  same((o.arithmeticRuntime??validateArithmeticRuntime)(o,'producer'),plan.arithmetic_runtime,'Producer arithmetic runtime changed');
  const checked=(o.verifyLocal??verifyLocal)(o,output,plan.inputs.path);
  const payload=read(join(output,'payload.json')),physical=read(join(output,'physical-inventory.json'));
  assert(payload.raw.length+physical.raw.length<=MAX_JSON,'Combined producer proof exceeds companion cap');
  same(payload.value.source_api,immutableOriginals(context.originals.evidence),'Current original source proof changed');
  same(payload.value.producer,compact(context.caller),'New source producer identity differs');
  assert(payload.value.request_sha256===context.request.sha256,'New source request differs');
  return {status:'verified',output,context,plan,payload,physical,checked};
}

export function validateUploadedArtifact(artifact,{id,digest:expected,caller,now}){
  assert(positive(id)&&/^sha256:[a-f0-9]{64}$/.test(expected),'Invalid returned upload identity');
  const run=caller.run,job=caller.job;
  assert(artifact?.id===id&&artifact.name===`static-site-data-${run.id}-${caller.attempt}`&&positive(artifact.size_in_bytes)&&artifact.digest===expected&&artifact.expired===false
    &&artifact.workflow_run?.id===run.id&&artifact.workflow_run.head_sha===run.head_sha&&artifact.workflow_run.head_branch==='main'
    &&artifact.workflow_run.repository_id===PRICE_CI.repositoryId&&artifact.workflow_run.head_repository_id===PRICE_CI.repositoryId
    &&utc(artifact.created_at)>=utc(job.started_at)&&utc(artifact.created_at)<=now&&utc(artifact.expires_at)>now,'Uploaded source artifact origin/clock differs');
  const upload=job.steps?.filter(s=>s.name==='Upload verified data export');assert(upload?.length===1&&upload[0].status==='completed'&&upload[0].conclusion==='success','Actual source upload step has not succeeded');
  return {id:artifact.id,name:artifact.name,bytes:artifact.size_in_bytes,sha256:artifact.digest.slice(7)};
}

export async function createRetainedSourceCompanion(input){
  const o=options(input),verified=await verifyProducedRetainedSource(o),{context,payload,physical}=verified;
  const artifact=o.api(`${PREFIX}/actions/artifacts/${input.artifactId}`),bound=validateUploadedArtifact(artifact,{id:input.artifactId,digest:input.artifactDigest,caller:context.caller,now:o.now()});
  const site=join(input.output,'runtime/frontend/dist'),manifest=read(join(site,'static-data/manifest.json'));
  const observations=(o.observePrices??extractPriceObservations)({dataRoot:join(site,'static-data'),manifest:manifest.value});
  assertPriceObservationBounds(observations,artifact.created_at);
  const metadata={price_observations:observations,price_observations_sha256:priceObservationDigest(observations),run_id:context.caller.run.id,
    run_attempt:context.caller.attempt,source_sha:context.controller.head,artifact_name:artifact.name,manifest_json:manifest.raw.toString('utf8'),manifest_sha256:manifest.sha256,
    retained_price_repair:{schema_version:'retained-price-source-declaration-v1',request_sha256:context.request.sha256,producer_controller_tree:context.controller.tree,
      predecessor_identity:context.request.value.predecessor.identity,artifact:bound,payload_json:payload.raw.toString('utf8'),payload_sha256:payload.sha256,
      physical_inventory_json:physical.raw.toString('utf8'),physical_inventory_sha256:physical.sha256}};
  const destination=join(o.runnerTemp,'export-provenance');if(!existsSync(destination))mkdirSync(destination,{mode:0o700});
  assert(realpathSync(destination)===destination,'Linked provenance destination');const ref=write(join(destination,'source.json'),metadata);
  return {status:'companion-created',path:ref.path,bytes:ref.bytes,sha256:ref.sha256,artifact:bound};
}

export function restoredDataDigest(producerFiles,replayFiles){
  const result={};
  for(const [name,pin]of Object.entries(producerFiles)){
    assert(!name.startsWith(REPLAY_AUDIT),'Producer occupies reserved independent replay audit namespace');
    if(isData(name))result[name]=pin.sha256;
  }
  let replayMembers=0;
  for(const [name,pin]of Object.entries(replayFiles))if(name.startsWith(SOURCE_AUDIT)){
    result[REPLAY_AUDIT+name.slice(SOURCE_AUDIT.length)]=pin.sha256;replayMembers++;
  }
  assert(replayMembers>0,'Independent replay lost literal audit evidence');
  return digest(canonical(result));
}

export function compareReplayPhysical(producer,replay){
  same(Object.keys(producer).sort(),Object.keys(replay).sort(),'Independent replay changed complete producer path membership');
  for(const [name,pin]of Object.entries(producer))if(name!=='retained-price-restoration-receipt.json'&&!name.startsWith(SOURCE_AUDIT))
    same(pin,replay[name],`Independent replay changed immutable producer member: ${name}`);
}

const VERIFY_SELECTED_PROJECTION=String.raw`
import importlib.util,json,pathlib,sys
script,selected_name,declaration_name,controller_tree=sys.argv[1:]
spec=importlib.util.spec_from_file_location('reviewed_source_worker',script)
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
root=pathlib.Path(selected_name);audit=root/w.AUDIT;payload=w.read_json(pathlib.Path(declaration_name))
def ref(name):
 p=audit/name;return {'path':str(p),**w.digest_file(p)}
inputs={'mode':'producer','request':ref('request.json'),'original_api_evidence':ref('original-api-evidence.json'),
 'invocation_evidence':ref('invocation-evidence.json'),'dependencies':{'receipt':ref('dependencies.json')},'producer_declaration':None}
parsed={key:w.read_json(pathlib.Path(inputs[key]['path'])) for key in ['request','original_api_evidence','invocation_evidence']}
parsed['dependencies']=w.read_json(audit/'dependencies.json')
inv=w.closed(parsed['invocation_evidence'],{'schema_version','mode','request_sha256','controller','caller','selected_producer'},'Producer invocation')
w.require(inv['schema_version']=='retained-price-source-invocation-v1' and inv['mode']=='producer' and inv['selected_producer'] is None,'Producer invocation gained replay authority')
w.identity(inv['caller']);w.closed(inv['controller'],{'head','tree'},'Producer controller')
w.require(inv['controller']=={'head':payload['producer']['head_sha'],'tree':controller_tree},'Producer audit controller differs')
w.require(w.producer_identity(inputs,inv)==payload['producer'] and inv['request_sha256']==inputs['request']['sha256']==payload['request_sha256'],'Producer audit identity differs')
clock=w.closed(w.read_json(audit/'compiler-evaluation.json'),{'evaluated_at','source','approved_ui','actual_checked_at'},'Producer evaluation')
w.require(clock['source']=='actual_phase_clock' and clock['evaluated_at']==payload['evaluated_at'] and clock['approved_ui']==payload['approved_ui'],'Producer evaluation audit differs')
w.timestamp(clock['actual_checked_at'])
# Read-only path view of the source's literal audit. It changes no bytes and
# uses the exact worker projection, including its closed field/member checks.
class Scope:
 def __init__(self,name):self.name=name
 def __truediv__(self,name):
  w.require(name=='scoped-extraction-manifest.json','Unexpected scoped source view');return audit/('scope-'+self.name+'.json')
class Scopes:
 def __truediv__(self,name):
  w.require(name in w.CONTRACT['scopes'],'Unexpected scope');return Scope(name)
class View:
 def __truediv__(self,name):
  if name=='runtime/frontend/public':return root
  if name=='scopes':return Scopes()
  w.require(name in {'plan.json','prepared.json','graph.json','home-sync.json','validation.json','compiler-evaluation.json'},'Unexpected audit source path')
  return audit/name
receipt,graph,validation,projection,observations=w.project_existing_audit(View(),inputs,parsed,payload['evaluated_at'])
w.require(w.read_json(audit/'observation-bindings.json')==observations,'Producer observation bindings changed')
w.require(payload['graph']==graph and payload['validation']==validation and payload['audit']==projection,'Producer immutable audit projection differs')
w.require(payload['source_api']==w.source_api_projection(parsed['original_api_evidence']) and payload['dependencies']==w.binding(parsed['dependencies']),'Producer original/runtime evidence differs')
w.require(w.semantic_inventory(w.RUNNER.tree_inventory(root),receipt,projection)==payload['build']['files'],'Selected physical bytes differ from immutable source declaration')
print(json.dumps({'verified':True,'payload':w.digest_file(pathlib.Path(declaration_name))}))
`;

export function verifySelectedProjection(o,selectedRoot,declarationPath,controllerTree){
  const raw=o.run('python3.11',['-c',VERIFY_SELECTED_PROJECTION,join(o.root,'.github/scripts/run-retained-price-source.py'),selectedRoot,declarationPath,controllerTree],
    {cwd:o.root,timeout:15*60*1000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  const proof=JSON.parse(raw);assert(proof.verified===true,'Complete selected producer projection failed');return proof;
}

const EXTRACT_PRODUCER_TAR=String.raw`
import hashlib,importlib.util,json,os,pathlib,shutil,sys,tarfile
script,archive_name,inventory_name,output_name=sys.argv[1:]
spec=importlib.util.spec_from_file_location('reviewed_safe_restore',script)
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
R=s.R;archive_path=pathlib.Path(archive_name);output=R.ensure_real_parent(output_name)
expected=R.parse_json(pathlib.Path(inventory_name).read_bytes())
R.require(type(expected) is dict and 0<len(expected)<=50000,'Invalid complete producer inventory')
for name,pin in expected.items():
 R.require(R.valid_path(name) and R.keys_are(pin,['bytes','sha256']) and R.integer(pin['bytes'],R.MAX_MEMBER) and R.valid_hash(pin['sha256']),'Invalid producer member pin')
payload=sum(pin['bytes'] for pin in expected.values())
R.require(payload<=R.MAX_TAR,'Producer payload exceeds unchanged reviewed TAR bound')
R.require(archive_path.is_absolute() and archive_path.resolve(strict=True)==archive_path,'Linked producer TAR')
class RawArchive:
 def open(self,name):
  R.require(name=='artifact.tar','Unexpected original TAR name');return archive_path.open('rb')
parent_fd=os.open(output.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
stage=None;stage_fd=None
try:
 s._parent_stable(output.parent,parent_fd)
 with archive_path.open('rb') as original:
  before=R.snapshot(original)
  R.require(1024<=before[2]<=R.MAX_TAR,'Producer TAR byte bound exceeded')
  measured=s._MeasuredArchive(RawArchive());plan=[]
  def select(name,size):
   R.require(name in expected and expected[name]['bytes']==size,'Unknown or resized producer TAR member')
   plan.append((name,size,measured.reader.position));return False
  _,sizes,structure=R.scan_tar(measured,select,0)
  R.require(sizes=={name:pin['bytes'] for name,pin in expected.items()},'Incomplete producer TAR inventory')
  R.require(measured.reader.position==before[2],'Producer TAR byte count differs')
  tar_sha256=measured.reader.sha256.hexdigest()
  allowed_dirs={'.'}
  for name in expected:
   parts=name.split('/')
   allowed_dirs.update('/'.join(parts[:i]) for i in range(1,len(parts)))
  with tarfile.open(archive_path,mode='r|') as archive:
   for item in archive:
    if item.isdir():R.require(R.tar_path(item.name,True) in allowed_dirs,'Unknown producer TAR directory')
  s._source_stable(original,archive_path,before)
  R.require(s._disk_free_bytes(parent_fd)>=payload+s.DEFAULT_RESERVE_BYTES,'Producer extraction cannot preserve 8 GiB reserve')
  s._parent_stable(output.parent,parent_fd)
  R.require(not output.exists() and not output.is_symlink(),'Producer destination already exists')
  stage=s._new_staging(parent_fd);stage_fd=os.open(stage,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent_fd)
  files=s._copy_files(RawArchive(),plan,stage_fd,before[2],tar_sha256)
  R.require(files==expected,'Copied producer member hashes differ')
  s._source_stable(original,archive_path,before);s._parent_stable(output.parent,parent_fd)
  R.require(s._disk_free_bytes(parent_fd)>=s.DEFAULT_RESERVE_BYTES,'Producer extraction exhausted 8 GiB reserve')
  s._commit(stage,output.name,parent_fd,s._rename_function());stage=None
  print(json.dumps({'schema_version':'retained-price-producer-extraction-v1','archive':{'bytes':before[2],'sha256':tar_sha256},'file_count':len(files),'logical_bytes':payload,'reserve_bytes':s.DEFAULT_RESERVE_BYTES}))
finally:
 if stage_fd is not None:os.close(stage_fd)
 if stage is not None:shutil.rmtree(stage,dir_fd=parent_fd)
 os.close(parent_fd)
`;

export async function extractRetainedProducerArchive(input){
  const o=options(input),destination=outputPath(input.destination,o),archive=resolve(input.archive);
  assert(isAbsolute(input.archive)&&below(o.runnerTemp,archive)&&realpathSync(archive)===archive,'Producer TAR must be a bounded scratch input');
  const authenticated=o.authority.authenticateRepairSource({root:o.root,source:input.source,api:o.api,now:o.now()});
  const files=authenticated.physical.value.dist;assert(files&&typeof files==='object'&&!Array.isArray(files),'Missing producer physical inventory');
  let total=0,count=0;
  for(const [name,pin]of Object.entries(files)){
    assert(safeRelative(name),'Unsafe authenticated producer member');keys(pin,['bytes','sha256'],'Invalid producer member binding');
    assert(Number.isSafeInteger(pin.bytes)&&pin.bytes>=0&&pin.bytes<=128*MIB&&SHA.test(pin.sha256),'Unbounded producer member');total+=pin.bytes;count++;
  }
  assert(count>0&&count<=50000&&total<=2*1024**3,'Producer exceeds unchanged complete TAR limits');
  requireSpace(dirname(destination),total+RESERVE,o);
  const inventoryPath=destination+'-inventory.json';assert(!existsSync(inventoryPath),'Producer inventory path already exists');
  write(inventoryPath,files);
  const raw=o.run('python3',['-c',EXTRACT_PRODUCER_TAR,join(o.root,'.github/scripts/restore-retained-price-candidate.py'),archive,inventoryPath,destination],
    {cwd:o.root,timeout:15*60*1000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  const receipt=JSON.parse(raw);assert(receipt.schema_version==='retained-price-producer-extraction-v1'&&receipt.reserve_bytes===RESERVE&&receipt.file_count===count&&receipt.logical_bytes===total,'Invalid bounded producer extraction result');
  same((o.inventory??physicalInventory)(destination),files,'Extracted complete producer inventory changed');
  same(hashFile(archive,2*1024**3),receipt.archive,'Producer TAR changed during extraction');
  const ref=write(destination+'-extraction.json',{...receipt,source_artifact_id:authenticated.artifact.id,physical_sha256:authenticated.physical.sha256});
  return {selectedRoot:destination,extraction:ref};
}

const RESTORE_VERIFICATION_KEYS=['schema_version','controller','caller','request_sha256','predecessor_identity','artifact','companion',
  'payload_sha256','producer_physical_sha256','replay_physical_sha256','producer_evaluated_at','actual_checked_at',
  'selected_inventory_sha256','replay_plan_sha256','selected_root','replay_root','restored_data_digest'];

export async function verifyRetainedRestoreBinding(input){
  const o=options(input),record=input.record;
  keys(record,['verification','verification_file','restored_data_digest'],'Unknown restore-state fields');
  assert(SHA.test(record.restored_data_digest),'Missing bound restored data digest');
  const verification=refValue(record.verification_file);same(verification,record.verification,'Private restore receipt differs from selected state');
  keys(verification,RESTORE_VERIFICATION_KEYS,'Unknown private restore receipt fields');
  assert(verification.schema_version==='retained-price-source-replay-verification-v1','Unknown private source replay proof');
  const replayRoot=outputPath(verification.replay_root,o,{existing:true});
  assert(record.verification_file.path===join(replayRoot,'replay-verification.json'),'Private verification path differs from its replay root');
  const selectedRoot=outputPath(verification.selected_root,o,{existing:true});
  const authenticated=o.authority.authenticateRepairSource({root:o.root,source:input.source,api:o.api,now:o.now()});
  const controller=controllerFor(o),activation=o.activationGate({root:o.root,api:o.api,now:o.now()});
  assert(activation.status==='active','Finite restore activation expired');same(activation.executing,{sha:controller.head,tree:controller.tree},'Final restore controller changed');
  const caller=callerFor(o,controller,'replay');same(verification.controller,controller,'Private restore controller differs');same(verification.caller,compact(caller),'Private restore belongs to another caller');
  o.authority.assertRepairPredecessor(input.live,authenticated.request.value);o.authority.assertRepairPredecessor(await liveFor(o),authenticated.request.value);
  assert(verification.request_sha256===authenticated.request.sha256&&verification.predecessor_identity===authenticated.request.value.predecessor.identity,'Private restore request/predecessor differs');
  same(verification.artifact,{id:authenticated.artifact.id,sha256:authenticated.artifact.digest},'Private restore artifact changed');
  same(verification.companion,{id:authenticated.companion.id,sha256:authenticated.companion.digest},'Private restore companion changed');
  assert(verification.payload_sha256===authenticated.declaration.sha256&&verification.producer_physical_sha256===authenticated.physical.sha256
    &&verification.producer_evaluated_at===authenticated.declaration.value.evaluated_at,'Private producer proof changed');
  assert(utc(verification.actual_checked_at)>=utc(caller.job.started_at)&&utc(verification.actual_checked_at)<=o.now(),'Private check clock is outside this actual caller job');
  const plan=read(replayRoot+'-driver-plan.json').value;
  assert(digest(canonical(plan))===verification.replay_plan_sha256&&plan.mode==='replay'&&plan.output===replayRoot
    &&plan.inputs?.path===join(replayRoot+'-inputs','inputs.json'),'Private independent replay plan changed');
  same(plan.caller,compact(caller),'Independent replay caller changed');same(plan.controller,controller,'Independent replay controller changed');
  assert(plan.request_sha256===authenticated.request.sha256,'Independent replay request changed');
  same(plan.selected_source,{artifact:authenticated.artifact.id,payload_sha256:authenticated.declaration.sha256,physical_sha256:authenticated.physical.sha256},'Independent replay selected source changed');
  refValue(plan.inputs);same(jobStartRef(publisherJobStart(o,caller,plan.job_start?.path),o,caller),plan.job_start,'Publisher original job clock changed');
  same((o.arithmeticRuntime??validateArithmeticRuntime)(o,'replay'),plan.arithmetic_runtime,'Replay arithmetic runtime changed');
  const originals=o.authority.authenticateOriginals({api:o.api,request:authenticated.request.value,caller,controller,now:o.now()});
  same(immutableOriginals(originals.evidence),authenticated.declaration.value.source_api,'Original source proof changed before publication');
  assert(plan.originals_sha256===digest(canonical(immutableOriginals(originals.evidence))),'Replay original source binding differs');
  // This is readback only. No compiler, Vite, historical clock, or replay launch.
  (o.verifyLocal??verifyLocal)(o,replayRoot,plan.inputs.path);
  const payload=read(join(replayRoot,'payload.json')),physical=read(join(replayRoot,'physical-inventory.json'));
  assert(payload.sha256===authenticated.declaration.sha256&&payload.raw.equals(authenticated.declaration.raw)
    &&physical.sha256===verification.replay_physical_sha256,'Actual independent replay evidence changed');
  const selected=(o.inventory??physicalInventory)(selectedRoot);same(selected,authenticated.physical.value.dist,'Literal selected producer inventory changed');
  assert(digest(canonical(selected))===verification.selected_inventory_sha256,'Private selected inventory binding differs');
  compareReplayPhysical(selected,physical.value.dist);
  (o.verifySelectedProjection??verifySelectedProjection)(o,selectedRoot,join(replayRoot+'-inputs','producer-declaration.json'),controller.tree);
  const expectedRestored=restoredDataDigest(selected,physical.value.public);
  assert(record.restored_data_digest===expectedRestored&&verification.restored_data_digest===expectedRestored,'Restored data baseline differs from independently verified source');
  return {verified:true,verification_file:record.verification_file,restored_data_digest:expectedRestored,
    ordinary_carry_required:true,financial_expiry_uses_actual_current_time:true,replayRoot,sourceRoot:join(replayRoot,'runtime/frontend/public')};
}

export async function replayRetainedSource(input){
  const o=options(input),output=outputPath(input.output,o),authenticated=o.authority.authenticateRepairSource({root:o.root,source:input.source,api:o.api,now:o.now()});
  const request=authenticated.request,controller=controllerFor(o),activation=o.activationGate({root:o.root,api:o.api,now:o.now()});
  assert(activation.status==='active','Replay activation expired');same(activation.executing,{sha:controller.head,tree:controller.tree},'Replay controller changed');
  const caller=callerFor(o,controller,'replay'),live=await liveFor(o);o.authority.assertRepairPredecessor(live,request.value);
  if(input.live)o.authority.assertRepairPredecessor(input.live,request.value);
  const selectedRoot=resolve(input.selectedRoot);assert(isAbsolute(input.selectedRoot)&&realpathSync(selectedRoot)===selectedRoot,'Invalid selected archive root');
  const inventory=(o.inventory??physicalInventory)(selectedRoot);same(inventory,authenticated.physical.value.dist,'Selected archive differs from complete literal producer inventory');
  const originals=o.authority.authenticateOriginals({api:o.api,request:request.value,caller,controller,now:o.now()});
  same(immutableOriginals(originals.evidence),authenticated.declaration.value.source_api,'Original evidence differs from producer source');
  const context={request,controller,caller,live,originals};
  const plan=await acquire(o,context,{output,jobStart:publisherJobStart(o,caller,input.jobStart),mode:'replay',authenticated});
  const payload=read(join(output,'payload.json')),physical=read(join(output,'physical-inventory.json'));
  assert(payload.sha256===authenticated.declaration.sha256&&payload.raw.equals(authenticated.declaration.raw),'Independent replay payload bytes differ');
  same((o.inventory??physicalInventory)(selectedRoot),inventory,'Selected source changed during replay');
  compareReplayPhysical(inventory,physical.value.dist);
  (o.verifySelectedProjection??verifySelectedProjection)(o,selectedRoot,join(output+'-inputs','producer-declaration.json'),controller.tree);
  const reauthenticated=o.authority.authenticateRepairSource({root:o.root,source:input.source,api:o.api,now:o.now()});
  assert(reauthenticated.declaration.sha256===authenticated.declaration.sha256&&reauthenticated.physical.sha256===authenticated.physical.sha256,'Selected producer changed during replay');
  o.authority.assertRepairPredecessor(await liveFor(o),request.value);
  const receipt={schema_version:'retained-price-source-replay-verification-v1',controller,caller:compact(caller),request_sha256:request.sha256,
    predecessor_identity:request.value.predecessor.identity,artifact:{id:authenticated.artifact.id,sha256:authenticated.artifact.digest},
    companion:{id:authenticated.companion.id,sha256:authenticated.companion.digest},payload_sha256:payload.sha256,
    producer_physical_sha256:authenticated.physical.sha256,replay_physical_sha256:physical.sha256,
    producer_evaluated_at:payload.value.evaluated_at,actual_checked_at:new Date(o.now()).toISOString(),
    selected_inventory_sha256:digest(canonical(inventory)),replay_plan_sha256:digest(canonical(plan)),selected_root:selectedRoot,replay_root:output,
    restored_data_digest:restoredDataDigest(inventory,physical.value.public)};
  const ref=write(join(output,'replay-verification.json'),receipt);
  return {offline_recovery_verified:true,verification:receipt,verification_file:ref,sourceRoot:join(output,'runtime/frontend/public'),
    producerRoot:selectedRoot,replayRoot:output};
}

export async function runRetainedSourceCommand(argv,settings){
  const [command,...rest]=argv,allowed=command==='produce'?['--output','--job-start']:command==='verify-produced'?['--output']:command==='companion'?['--output','--artifact-id','--artifact-digest']:null;
  assert(allowed&&rest.length===allowed.length*2,'Unknown finite source command/arguments');const args={};
  for(let i=0;i<rest.length;i+=2){assert(allowed.includes(rest[i])&&!Object.hasOwn(args,rest[i])&&rest[i+1],'Unknown/duplicate finite source option');args[rest[i]]=rest[i+1];}
  assert(allowed.every(k=>Object.hasOwn(args,k)),'Missing finite source option');
  const input={...settings,output:args['--output'],jobStart:args['--job-start'],artifactId:args['--artifact-id']===undefined?undefined:Number(args['--artifact-id']),artifactDigest:args['--artifact-digest']};
  const result=await(command==='produce'?produceRetainedSource(input):command==='verify-produced'?verifyProducedRetainedSource(input):createRetainedSourceCompanion(input));
  console.log(JSON.stringify({status:result.status,site_dir:result.site_dir,path:result.path}));return result;
}
