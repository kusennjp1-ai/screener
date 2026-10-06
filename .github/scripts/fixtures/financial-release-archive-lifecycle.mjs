import assert from 'node:assert/strict';
import {chmodSync,closeSync,cpSync,existsSync,mkdirSync,openSync,readFileSync,readdirSync,renameSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {bootstrap,dataFiles,inventoryDigest,sha256,uiInventory} from '../publication-state.mjs';
import {extractPriceObservations,priceObservationDigest} from '../price-observations.mjs';
import {contract,dataInventory,digest} from '../financial-correction.mjs';
import {canonicalPublication,removeCanonical,assertTransportDeclaration} from '../static-transport-publication.mjs';
import {financialReleasePolicy as policy,completeInventory,protectedCodeInventory,verifyFinancialReleaseAssets} from '../financial-release-activation.mjs';

const read=path=>JSON.parse(readFileSync(path,'utf8'));
const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof value==='string'?value:JSON.stringify(value));};
const hashFile=path=>execFileSync('sha256sum',[path],{encoding:'utf8'}).split(' ')[0];
const repository=bootstrap.repository,prefix=`repos/${repository}`;
const ownRoot=fileURLToPath(new URL('../../../',import.meta.url));

// gh --paginate --slurp returns an array of pages; an ordinary bounded API read
// returns one inventory object. Keep both production call forms distinct.
export function archiveApiPayload(value,paginate){
  if(paginate||!Array.isArray(value))return value;
  if(value.length!==1||!value[0]||typeof value[0]!=='object')throw Error('Unexpected bounded fixture inventory');
  const page=value[0],keys=['jobs','artifacts','workflow_runs'].filter(key=>Array.isArray(page[key]));
  if(keys.length!==1)throw Error('Ambiguous bounded fixture inventory');
  return {total_count:page[keys[0]].length,...page};
}

export function assertSyntheticPriceAdvance(before,after,targetDate){
  assert.ok(before.length>0&&before.at(-1).date<targetDate);
  assert.equal(after.length,before.length+1,'synthetic feed must append exactly one observation');
  assert.deepEqual(after.slice(0,-1),before,'synthetic feed changed its historical OHLCV prefix');
  assert.deepEqual(after.at(-1),{...before.at(-1),date:targetDate},'synthetic feed changed the final recorded price/volume');
}

// This is a byte-authentication preflight, not Design/exception approval. Use
// the captured controller in the full rehearsal; a separately selected current
// controller is allowed only for an explicitly reported standalone preflight.
export async function verifyArchiveCandidate({candidate,repositoryRoot,restore}) {
  const started=performance.now(),previewBytes=readFileSync(join(candidate,'preview-receipt.json')),preview=JSON.parse(previewBytes);
  const transportPath=join(candidate,'transport.json'),transportHash=existsSync(transportPath)?sha256(readFileSync(transportPath)):null;
  const physical=join(candidate,'corrected'),before=inventoryDigest(completeInventory(physical));
  let packed=null;
  if(transportHash){
    const {verifyCandidateTransport}=await import(pathToFileURL(join(repositoryRoot,'.github/scripts/financial-release-activation.mjs')).href);
    assert.equal(typeof verifyCandidateTransport,'function','packed capture has no controller transport verifier');
    packed=await verifyCandidateTransport(repositoryRoot,candidate,null,{restore});
  }else{
    assertTransportDeclaration(physical,null);
    assert.equal(existsSync(join(physical,'publication.json')),false,'raw diagnostic unexpectedly contains a publication bootstrap');
  }
  if(transportHash&&!packed?.logicalRoot)throw Error('Packed archive requires the captured controller single-pass restore API; recapture the candidate');
  const logical=packed?.logicalRoot??physical;
  try {
    assert.equal(inventoryDigest(dataInventory(logical)),preview.bundles.corrected_data_sha256,'captured logical corrected inventory');
    assert.equal(inventoryDigest(uiInventory(logical)),preview.candidate_ui.digest,'captured logical UI inventory');
    assert.equal(inventoryDigest(uiInventory(physical)),preview.candidate_ui.digest,'captured physical UI inventory');
    assert.equal(inventoryDigest(completeInventory(physical)),before,'candidate physical bytes changed during preflight');
    assert.deepEqual(readFileSync(join(candidate,'preview-receipt.json')),previewBytes,'candidate preview changed during preflight');
    assert.equal(existsSync(transportPath)?sha256(readFileSync(transportPath)):null,transportHash,'candidate transport seal changed during preflight');
    const manifest=read(join(logical,'static-data/manifest.json'));
    const prices=priceObservationDigest(extractPriceObservations({dataRoot:join(logical,'static-data'),manifest}));
    assert.equal(prices,preview.previous_publication.price_observations_sha256,'captured logical price observations');
    return {representation:packed?'packed':'raw',candidate_schema:packed?'financial-release-candidate-v2':'financial-release-candidate-v1',
      ...(packed?{transport_sha256:transportHash,transport_root_sha256:packed.transport.corrected.root.sha256}:{}),
      corrected_inventory_sha256:before,logical_data_inventory_sha256:preview.bundles.corrected_data_sha256,
      ui_inventory_sha256:preview.candidate_ui.digest,price_observations_sha256:prices,captured_sha:preview.candidate_ui.sha,
      financial_evaluated_at:preview.financial.evaluated_at,elapsed_ms:Math.round(performance.now()-started)};
  } finally {removeCanonical(physical,logical);}
}

export function archiveCandidateRecord({candidate,preview,request,proof}) {
  return {schema_version:proof.candidate_schema,...(proof.representation==='packed'?{transport_sha256:proof.transport_sha256}:{}),
    producer:{repository,workflow:policy.candidate_workflow,head_sha:preview.candidate_ui.sha,run_id:88001,run_attempt:1},
    captured_ui:preview.candidate_ui,request_sha256:digest(request),preview_receipt_sha256:sha256(readFileSync(join(candidate,'preview-receipt.json'))),
    corrected_inventory_sha256:proof.corrected_inventory_sha256,protected_code_sha256:digest(read(join(candidate,'protected-code.json')))};
}

export function assertOriginalFinancialClocks(sourceBytes,carry,targetTime) {
  const original=JSON.parse(sourceBytes);
  assert.equal(carry.source_projection_json,sourceBytes,'carry replaced original source projection bytes');
  assert.equal(carry.financial_evaluated_at,targetTime,'carry evaluation must use the declared fixture clock');
  assert.ok(Date.parse(targetTime)>Date.parse(original.financial_evaluated_at),'carry did not advance its evaluation clock');
  let retained=0;
  for(const [symbol,item]of Object.entries(original.symbols))if(carry.ownership[symbol]==='retained'){
    retained++;
    assert.deepEqual(carry.symbols[symbol].source_receipts,item.source_receipts,`carry refreshed original receipt clocks: ${symbol}`);
    for(const key of ['p','t'])assert.deepEqual(carry.symbols[symbol].financial_current[key],item.financial_current[key],`carry refreshed original proof clocks: ${symbol}`);
  }
  assert.ok(retained>0,'carry did not retain any original financial source symbols');
}

// Required input keys: directory (new scratch directory), diagnostic_zip,
// diagnostic_sha256, source_zip, source_sha256, certificate_zip,
// certificate_sha256, predecessor_zip, predecessor_sha256, predecessor_root.
// Files stay external; no credentials, Library references or private paths are
// stored in this repository. Every supplied archive is checked before use.
export async function runArchiveLifecycle(inputPath,{preflightOnly=false}={}){
  const input=read(inputPath),directory=resolve(input.directory);
  assert.equal(existsSync(directory),false,'archive lifecycle scratch must be new');
  for(const key of ['diagnostic','source','certificate','predecessor'])assert.equal(hashFile(input[`${key}_zip`]),input[`${key}_sha256`],`${key} archive digest`);
  mkdirSync(directory,{recursive:true});
  const began=performance.now();let previousPhase=began;
  const report={schema_version:'offline-financial-activation-lifecycle-v2',authority:'none',outcome:'incomplete',gate_evidence:'synthetic GitHub transport; real immutable source and compiler bytes',phases:[]};
  const checkpoint=(phase,extra={})=>{const now=performance.now();report.phases.push({phase,elapsed_ms:Math.round(now-began),phase_ms:Math.round(now-previousPhase),...extra});previousPhase=now;write(join(directory,'report.json'),report);console.log(`Archive lifecycle: ${phase}`);};
  const run=(command,args,options={})=>{const result=spawnSync(command,args,{encoding:'utf8',timeout:15*60*1000,maxBuffer:8*1024*1024,...options});
    if(result.status!==0||result.error){write(join(directory,'last-failure.json'),{command,args,status:result.status,error:result.error?.message,stdout:result.stdout,stderr:result.stderr});}
    assert.ifError(result.error);assert.equal(result.status,0,`${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);return result.stdout;};
  const stage=join(directory,'candidate-stage');mkdirSync(stage);
  // Stream the ZIP's single diagnostic tarball. Reject unsafe/special members;
  // retain only the exact review-only tree, without another large TAR copy.
  run('python3',['-c',`import pathlib,shutil,sys,tarfile,zipfile
root=pathlib.Path(sys.argv[2]);seen=set()
with zipfile.ZipFile(sys.argv[1]) as z:
 names=[n for n in z.namelist() if n.endswith('.tar.gz')];assert len(names)==1
 with z.open(names[0]) as src,tarfile.open(fileobj=src,mode='r|gz') as t:
  for m in t:
   n=m.name.removeprefix('./')
   assert not n.startswith('/') and '\\\\' not in n and all(p not in ('','..','.') for p in n.rstrip('/').split('/')) and n not in seen
   assert m.isfile() or m.isdir();seen.add(n)
   if not n.startswith('review-only/'):continue
   path=root/n[len('review-only/'):]
   if m.isdir():path.mkdir(parents=True,exist_ok=True)
   else:
    path.parent.mkdir(parents=True,exist_ok=True)
    with t.extractfile(m) as source,path.open('wb') as target:shutil.copyfileobj(source,target)
`,input.diagnostic_zip,stage]);
  const preview=read(join(stage,'preview-receipt.json')),evidence=read(join(stage,'evidence.json')),request=read(join(stage,'release-request.json'));
  assert.equal(input.source_sha256,request.correction.source.artifact_sha256);
  assert.equal(input.certificate_sha256,request.source_validation.certificate.artifact_sha256);
  assert.equal(`sha256:${input.predecessor_sha256}`,evidence.predecessor_artifact.digest);

  const checkout=join(directory,'controller');
  run('git',['clone','--shared','--no-checkout',ownRoot,checkout]);
  run('git',['-C',checkout,'checkout','--detach',preview.candidate_ui.sha]);
  assert.equal(run('git',['-C',checkout,'rev-parse','HEAD^{tree}']).trim(),preview.candidate_ui.tree);
  assert.deepEqual(protectedCodeInventory(checkout,preview.candidate_ui.sha),read(join(stage,'protected-code.json')));
  const inputProof=await verifyArchiveCandidate({candidate:stage,repositoryRoot:checkout,restore:join(directory,'input-logical')});
  const {elapsed_ms:verificationElapsed,...inputFields}=inputProof;
  checkpoint('authenticated retained candidate input',{...inputFields,verification_elapsed_ms:verificationElapsed});
  if(preflightOnly){report.outcome='preflight-only';checkpoint('stopped before lifecycle execution');return {directory,report};}
  const bin=join(directory,'bin'),configPath=join(directory,'transport.json'),preload=join(directory,'transport.mjs');mkdirSync(bin);
  const config={api:{},zips:{},liveRoot:resolve(input.predecessor_root)},api=config.api;
  write(join(bin,'gh'),`#!${process.execPath}\nconst fs=require('node:fs'),args=process.argv.slice(2),config=JSON.parse(fs.readFileSync(process.env.RELEASE_ARCHIVE_TRANSPORT));
if(args[0]!=='api'||args.slice(1,-1).some(arg=>!['--paginate','--slurp'].includes(arg)))throw Error('Unexpected offline command');
const endpoint=args.at(-1);fs.appendFileSync(process.env.RELEASE_ARCHIVE_TRACE,JSON.stringify({api:endpoint})+'\\n');
if(Object.hasOwn(config.zips,endpoint)){const fd=fs.openSync(config.zips[endpoint],'r'),buffer=Buffer.alloc(1024*1024);let count;
while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0){let offset=0;while(offset<count)offset+=fs.writeSync(1,buffer,offset,count-offset);}fs.closeSync(fd);}
else if(Object.hasOwn(config.api,endpoint))process.stdout.write(JSON.stringify(archiveApiPayload(config.api[endpoint],args.includes('--paginate'))));else throw Error('Unexpected offline API '+endpoint);
${archiveApiPayload.toString()}`);chmodSync(join(bin,'gh'),0o755);
  write(preload,`import {readFileSync,appendFileSync} from 'node:fs';import {join} from 'node:path';
const config=JSON.parse(readFileSync(process.env.RELEASE_ARCHIVE_TRANSPORT)),base=new URL(${JSON.stringify(bootstrap.site_url)}),RealDate=Date;
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[process.env.RELEASE_ARCHIVE_NOW]));}static now(){return RealDate.parse(process.env.RELEASE_ARCHIVE_NOW);}};
globalThis.fetch=async(input,options)=>{const url=new URL(input),path=url.pathname.slice(base.pathname.length);
if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||path.includes('..')||options.redirect!=='error')throw Error('Unexpected offline Pages read');
appendFileSync(process.env.RELEASE_ARCHIVE_TRACE,JSON.stringify({pages:path})+'\\n');const bytes=readFileSync(join(config.liveRoot,path));return {ok:true,status:200,arrayBuffer:async()=>bytes};};`);
  const env={PATH:`${bin}:${process.env.PATH}`,RUNNER_TEMP:join(directory,'runner'),RELEASE_ARCHIVE_TRANSPORT:configPath,RELEASE_ARCHIVE_TRACE:join(directory,'trace.jsonl'),
    RELEASE_ARCHIVE_NOW:preview.financial.evaluated_at,NODE_OPTIONS:`--import=${preload}`,LITELLM_LOCAL_MODEL_COST_MAP:'true',
    GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_EVENT_PATH:join(directory,'event.json'),GITHUB_REPOSITORY:repository,GITHUB_RUN_ID:'88003',GITHUB_RUN_ATTEMPT:'1'};
  write(join(directory,'event.json'),{inputs:{}});const save=()=>write(configPath,config);save();
  // Recreate the exact current baseline with the captured production exporter.
  // The old baseline archive is intentionally never used.
  const frontend=join(checkout,'frontend'),publicRoot=join(frontend,'public');
  rmSync(join(publicRoot,'static-data'),{recursive:true,force:true});mkdirSync(publicRoot,{recursive:true});
  cpSync(join(input.predecessor_root,'static-data'),join(publicRoot,'static-data'),{recursive:true});
  for(const path of dataFiles)cpSync(join(input.predecessor_root,path),join(publicRoot,path));
  run(process.execPath,['tools/export-research.mjs'],{cwd:frontend,env:{...env,FINANCIAL_EVALUATED_AT:preview.financial.evaluated_at}});
  const baseline=join(stage,'baseline');mkdirSync(baseline);renameSync(join(publicRoot,'static-data'),join(baseline,'static-data'));
  for(const path of dataFiles)renameSync(join(publicRoot,path),join(baseline,path));
  assert.equal(inventoryDigest(dataInventory(baseline)),preview.bundles.baseline_data_sha256,'exact current baseline compiler replay');
  checkpoint('replayed exact current baseline',{data_sha256:preview.bundles.baseline_data_sha256});
  for(const [name,path]of [['original-source/source.zip',input.source_zip],['original-certification/artifact.zip',input.certificate_zip],['original-predecessor/artifact.zip',input.predecessor_zip]]){
    mkdirSync(dirname(join(stage,name)),{recursive:true});cpSync(path,join(stage,name));
  }
  const capturedRecord=archiveCandidateRecord({candidate:stage,preview,request,proof:inputProof});
  const seal=id=>{run(process.execPath,[join(checkout,'.github/scripts/financial-release-activation.mjs'),'design-seal'],{cwd:checkout,
    env:{...env,FINANCIAL_CANDIDATE_DIR:stage,GITHUB_SHA:run('git',['-C',checkout,'rev-parse','HEAD']).trim(),GITHUB_RUN_ID:String(id)}});
    const tar=join(directory,'candidate.tar'),size=statSync(tar).size;
    assert.ok(size>0&&size<=policy.maximum_archive_bytes,'production candidate TAR exceeds the member-size bound');
    checkpoint('sealed synthetic candidate with production CLI',{run_id:id,candidate_schema:capturedRecord.schema_version,representation:inputProof.representation,production_tar_bytes:size,production_tar_sha256:hashFile(tar)});};
  seal(88001);assert.deepEqual(read(join(stage,'candidate.json')),capturedRecord);
  // Production sealing emits an uncompressed TAR. The fixture then gzip-wraps
  // those exact TAR bytes for transport. Report its original size/hash so this
  // resource optimization cannot be mistaken for production packing behavior.
  function pack(name,root=stage,member='candidate.tar'){const tar=join(directory,`${name}.tar.gz`),zip=join(directory,`${name}.zip`);
    if(root===stage){const raw=join(directory,'candidate.tar'),fd=openSync(tar,'wx');try{run('gzip',['-c',raw],{stdio:['ignore',fd,'pipe']});}finally{closeSync(fd);}rmSync(raw);}
    else run('tar',['-czf',tar,'-C',root,'.']);
    run('python3',['-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:z.write(sys.argv[2],sys.argv[3])',zip,tar,member]);rmSync(tar);return zip;}
  const originalZip=pack('captured-candidate'),pin={schema_version:'financial-activation-candidate-v1',repository,workflow:policy.candidate_workflow,head_sha:preview.candidate_ui.sha,
    run_id:88001,run_attempt:1,job_id:89001,artifact_id:87001,artifact_name:'financial-release-candidate-88001-1',artifact_sha256:hashFile(originalZip),candidate_record_sha256:sha256(readFileSync(join(stage,'candidate.json'))),
    projection_sha256:preview.financial.projection_sha256,preview_receipt_sha256:capturedRecord.preview_receipt_sha256};
  write(join(checkout,policy.request_path),request);write(join(checkout,policy.activation_candidate_path),pin);
  run('git',['-C',checkout,'add',policy.request_path,policy.activation_candidate_path]);
  run('git',['-C',checkout,'-c','user.name=Offline test','-c','user.email=offline@example.invalid','commit','-m','Synthetic local activation control fixture']);
  const mainSha=run('git',['-C',checkout,'rev-parse','HEAD']).trim();env.RELEASE_SHA=mainSha;
  assert.deepEqual(protectedCodeInventory(checkout,mainSha),protectedCodeInventory(checkout,preview.candidate_ui.sha));
  write(join(stage,'captured-candidate.json'),capturedRecord);write(join(stage,'activation-candidate.json'),pin);
  seal(88002);
  assert.deepEqual(read(join(stage,'candidate.json')),{...capturedRecord,producer:{...capturedRecord.producer,head_sha:mainSha,run_id:88002}});
  const currentZip=pack('current-candidate');rmSync(stage,{recursive:true});
  checkpoint('packaged immutable synthetic gate artifacts',{captured_zip_sha256:pin.artifact_sha256,current_zip_sha256:hashFile(currentZip)});

  const runEvidence=(id,path,sha,extra={})=>({id,run_attempt:1,head_sha:sha,path,head_branch:'main',event:'push',status:'completed',conclusion:'success',run_started_at:preview.financial.evaluated_at,repository:{full_name:repository},head_repository:{full_name:repository},...extra});
  function register(ref,value){const base=`${prefix}/actions/runs/${ref.run_id}`;
    api[`${base}/attempts/${ref.run_attempt}`]=value.run;api[`${base}/attempts/${ref.run_attempt}/jobs?per_page=100`]=[{jobs:value.jobs}];api[`${base}/artifacts?per_page=100`]=[{artifacts:value.artifacts}];}
  register(request.correction.source,evidence.source);register(request.source_validation.certificate,evidence.certifier);
  api[`${prefix}/git/commits/${request.source_validation.certificate.head_sha}`]=evidence.certifier.commit;
  api[`${prefix}/git/trees/${evidence.certifier.commit.tree.sha}?recursive=1`]=evidence.certifier.tree;
  config.zips[`${prefix}/actions/artifacts/${request.correction.source.artifact_id}/zip`]=resolve(input.source_zip);
  config.zips[`${prefix}/actions/artifacts/${request.source_validation.certificate.artifact_id}/zip`]=resolve(input.certificate_zip);
  config.zips[`${prefix}/actions/artifacts/${evidence.predecessor_artifact.id}/zip`]=resolve(input.predecessor_zip);
  const artifacts=[evidence.predecessor_artifact];
  for(const [id,jobId,artifactId,producerSha,zip]of [[88001,89001,87001,preview.candidate_ui.sha,originalZip],[88002,89002,87002,mainSha,currentZip]]){
    const artifact={id:artifactId,name:`financial-release-candidate-${id}-1`,expired:false,digest:`sha256:${hashFile(zip)}`,size_in_bytes:statSync(zip).size,
      created_at:preview.financial.evaluated_at,expires_at:'2099-01-01T00:00:00Z',workflow_run:{id,head_sha:producerSha,head_branch:'main'}};
    register({run_id:id,run_attempt:1},{run:runEvidence(id,policy.candidate_workflow,producerSha),jobs:[{id:jobId,run_id:id,run_attempt:1,head_sha:producerSha,name:policy.candidate_job,status:'completed',conclusion:'success',
      started_at:preview.financial.evaluated_at,completed_at:preview.financial.evaluated_at,steps:policy.candidate_steps.map(name=>({name,conclusion:'success'}))}],artifacts:[artifact]});
    artifacts.push(artifact);config.zips[`${prefix}/actions/artifacts/${artifactId}/zip`]=zip;
  }
  const ci=runEvidence(88000,'.github/workflows/ci.yml',mainSha);
  register({run_id:88000,run_attempt:1},{run:ci,jobs:contract.required_ci_jobs.map((name,index)=>({id:89100+index,run_attempt:1,name,status:'completed',conclusion:'success'})),artifacts:[]});
  api[prefix]={full_name:repository,default_branch:'main'};api[`${prefix}/git/ref/heads/main`]={object:{sha:mainSha}};
  for(const [file,id]of [['ci.yml',88000],['design-acceptance.yml',88002]])api[`${prefix}/actions/workflows/${file}/runs?branch=main&event=push&head_sha=${mainSha}&per_page=100`]=[{workflow_runs:[api[`${prefix}/actions/runs/${id}/attempts/1`]]}];
  for(const file of ['research-ui-release.yml','static-site.yml'])api[`${prefix}/actions/workflows/${file}/runs?branch=main&per_page=100`]=[{workflow_runs:[]}];
  api[`${prefix}/actions/artifacts?per_page=100`]=[{artifacts}];
  function deployment(id,sha,started,completed,jobStarted){register({run_id:id,run_attempt:1},{run:runEvidence(id,'.github/workflows/research-ui-release.yml',sha,{event:'workflow_dispatch'}),
    jobs:[{run_attempt:1,started_at:new Date(jobStarted).toISOString(),steps:[{name:'Deploy to GitHub Pages',conclusion:'success',started_at:new Date(started).toISOString(),completed_at:new Date(completed).toISOString()}]}],artifacts:[]});}
  const live=evidence.live;deployment(live.latest.runId,live.latest.headSha,live.latest.started,live.latest.completed,live.latest.jobStarted);
  save();
  const controller=join(checkout,'.github/scripts/select-release-source.mjs');
  const command=name=>{save();const output=run(process.execPath,[controller,name],{cwd:checkout,env});write(join(directory,`${name}-${report.phases.length}.log`),output);checkpoint(name);};
  command('plan');
  const state=read(join(env.RUNNER_TEMP,'verified-publication/state.json'));assert.equal(state.decision.mode,'activation');assert.equal(state.live.identity,live.identity);
  // The workflow checks out the approved UI into release. Only the code used
  // by compose/rechecks is needed; restore supplies every public/dist byte.
  const release=join(checkout,'release');mkdirSync(release);run('git',['-C',checkout,'archive','--format=tar','-o',join(directory,'release-source.tar'),mainSha,'frontend','contracts','data/ibd_reference']);
  run('tar',['-xf',join(directory,'release-source.tar'),'-C',release]);rmSync(join(directory,'release-source.tar'));
  command('restore');rmSync(join(release,'frontend/public'),{recursive:true});
  command('compose');command('recheck');command('recheck');
  const dist=join(release,'frontend/dist'),publication=read(join(dist,'publication.json'));
  const activatedLogical=await canonicalPublication({root:dist,frontendRoot:frontend,publication,restore:join(directory,'activation-logical')});
  const financial=verifyFinancialReleaseAssets(activatedLogical,publication.financial_release,publication);
  assert.equal(Boolean(publication.transport),inputProof.representation==='packed','activation changed captured transport representation');
  checkpoint('verified logical activation publication',{representation:inputProof.representation});
  assert.equal(financial.mode,'activation');assert.equal(financial.previous_publication_identity,live.identity);
  assert.equal(financial.source_projection.sha256,preview.financial.projection_sha256);
  assert.equal(financial.ui.captured_sha,preview.candidate_ui.sha);assert.equal(financial.ui.approved_sha,mainSha);
  config.liveRoot=dist;const deployedAt=Date.parse(preview.financial.evaluated_at)+60000;deployment(88003,mainSha,deployedAt,deployedAt+1000,deployedAt-1000);save();
  const liveModule=pathToFileURL(join(checkout,'.github/scripts/publication-state.mjs')).href;
  const deployed=JSON.parse(run(process.execPath,['--input-type=module','-e',`import {livePublication} from ${JSON.stringify(liveModule)};console.log(JSON.stringify(await livePublication()));`],{cwd:checkout,env}));
  assert.equal(deployed.receipt.run_id,88003);assert.deepEqual(deployed.financialRelease,financial);
  checkpoint('read simulated deployed activation',{publication_identity:deployed.identity,financial_generation:deployed.receipt.financial_generation,lineage_sha256:deployed.receipt.financial_lineage_sha256});
  const targetBase=read(join(state.activation.candidate,'target-base.json'));
  // The first activation is established. Release only this fixture's generated
  // candidate copies before the next-price carry, keeping every original input.
  rmSync(join(env.RUNNER_TEMP,'verified-publication/activation'),{recursive:true});
  rmSync(originalZip);rmSync(currentZip);
  const deployedRoot=join(directory,'simulated-activation');renameSync(dist,deployedRoot);config.liveRoot=deployedRoot;
  const activatedSource=activatedLogical===dist?deployedRoot:activatedLogical;
  const previousHistory=readFileSync(join(activatedSource,'static-data/candidate-history/index.json'));
  const originalProjectionBytes=readFileSync(join(activatedSource,financial.source_projection.path),'utf8');
  assert.equal(JSON.parse(originalProjectionBytes).financial_evaluated_at,preview.financial.evaluated_at,'activation refreshed the captured evaluation clock');
  const releaseFrontend=join(release,'frontend'),freshPublic=join(releaseFrontend,'public');
  if(activatedSource===deployedRoot)cpSync(activatedSource,freshPublic,{recursive:true});
  else renameSync(activatedSource,freshPublic);
  rmSync(join(freshPublic,'publication.json'));
  assert.equal(existsSync(join(freshPublic,'static-data/_transport')),false,'synthetic price feed must edit authenticated logical bytes');
  const targetDate='2026-10-05',targetTime=new Date(Date.parse(preview.financial.evaluated_at)+24*3600000).toISOString();
  assert.ok(targetDate>deployed.manifest.markets.US.as_of_date);
  env.RELEASE_ARCHIVE_NOW=targetTime;env.GITHUB_RUN_ID='88004';
  // The advancing price feed is explicitly synthetic: append one observation
  // at each existing chart's unchanged last price. All prior bars, source
  // receipts, source clocks, financial lineage and historical snapshots remain.
  const root=join(freshPublic,'static-data'),manifest=read(join(root,'manifest.json')),entry=manifest.markets.US;
  const scan=read(join(root,entry.pages.scan.path));
  const shiftRows=value=>{value.as_of_date=targetDate;for(const key of ['rows','initial_rows','preview_rows','results','stocks','members']){
    if(Array.isArray(value[key]))for(const row of value[key]){row.as_of_date=targetDate;}}
    return value;};
  write(join(root,entry.pages.scan.path),shiftRows(scan));
  for(const item of scan.chunks||[])write(join(root,item.path),shiftRows(read(join(root,item.path))));
  const immutable=new Set(['candidate-history','candidate-performance-history','financial-corrections','financial-lineage']);
  const readTargetSymbols=Object.fromEntries(targetBase.rows.map(row=>[row.symbol,true]));
  assert.equal(Object.keys(readTargetSymbols).length,targetBase.rows.length,'target has duplicate symbols');
  const catalog=read(join(root,entry.assets.charts.path)),expectedCanonical=new Set(),withoutHistory=new Set();
  assert.ok(Array.isArray(catalog.symbols));
  // The canonical catalog independently defines coverage; a successful90%
  // production floor is not proof that this fixture advanced every source chart.
  for(const item of catalog.symbols){
    if(!Object.hasOwn(readTargetSymbols,item.symbol))continue;
    if(typeof item.path!=='string'){withoutHistory.add(item.symbol);continue;}
    const chart=read(join(root,item.path));
    if(!Array.isArray(chart.bars)||!chart.bars.length){withoutHistory.add(item.symbol);continue;}
    assert.equal(chart.symbol??chart.stock_data?.symbol,item.symbol);
    expectedCanonical.add(item.path);
  }
  let appended=0;const advancedPaths=new Set(),advancedSymbols=new Set();
  function updateCharts(folder){for(const item of readdirSync(folder,{withFileTypes:true})){
    const path=join(folder,item.name);
    if(item.isDirectory()){if(!immutable.has(item.name))updateCharts(path);continue;}
    assert.ok(item.isFile(),'fixture data must contain only regular files');if(!item.name.endsWith('.json'))continue;
    const value=read(path),symbol=Array.isArray(value?.bars)?value.symbol??value.stock_data?.symbol:null;
    if(!symbol||!Object.hasOwn(readTargetSymbols,symbol)||(value.market&&value.market!=='US'))continue;
    const originalBars=value.bars;
    if(originalBars.length){const last=originalBars.at(-1);assert.ok(last.date<targetDate);value.bars=[...originalBars,{...last,date:targetDate}];appended++;}
    value.as_of_date=targetDate;
    for(const key of ['stock_data','fundamentals'])if(value[key]&&typeof value[key]==='object')value[key].as_of_date=targetDate;
    write(path,value);
    if(originalBars.length){
      assertSyntheticPriceAdvance(originalBars,read(path).bars,targetDate);
      advancedPaths.add(path.slice(root.length+1));advancedSymbols.add(symbol);
    }
  }}
  updateCharts(root);assert.ok(appended>0);
  assert.ok(expectedCanonical.size>0);
  for(const path of expectedCanonical)assert.ok(advancedPaths.has(path),`canonical chart was not advanced: ${path}`);
  checkpoint('verified synthetic next-price coverage',{target_rows:targetBase.rows.length,canonical_chart_paths:expectedCanonical.size,
    verified_canonical_paths:[...expectedCanonical].filter(path=>advancedPaths.has(path)).length,advanced_alias_paths:advancedPaths.size,
    advanced_symbols:advancedSymbols.size,catalog_symbols_without_history:withoutHistory.size,all_updated_ohlcv_prefixes_preserved:true});
  manifest.as_of_date=targetDate;manifest.generated_at=targetTime;entry.as_of_date=targetDate;
  write(join(root,'manifest.json'),manifest);
  run(process.execPath,['tools/export-research.mjs'],{cwd:releaseFrontend,env:{...env,FINANCIAL_EVALUATED_AT:targetTime}});
  assert.deepEqual(readFileSync(join(root,'candidate-history/index.json')),previousHistory,'ordinary preparation preserves prior first observations');
  const freshManifest=readFileSync(join(root,'manifest.json')),observations=extractPriceObservations({dataRoot:root,manifest:JSON.parse(freshManifest)});
  const exportZip=pack('advancing-price-export',freshPublic,'artifact.tar'),sourcePath=join(directory,'advancing-source.json');
  write(sourcePath,{run_id:88005,run_attempt:1,source_sha:mainSha,artifact_name:'static-site-data-88005-1',manifest_json:freshManifest.toString(),manifest_sha256:sha256(freshManifest),
    price_observations:observations,price_observations_sha256:priceObservationDigest(observations)});
  const metadataZip=join(directory,'advancing-source.zip');run('python3',['-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:z.write(sys.argv[2],"source.json")',metadataZip,sourcePath]);
  const freshArtifacts=[[87005,'static-site-data-88005-1',exportZip],[87006,'static-site-data-manifest-88005-1',metadataZip]].map(([id,name,zip])=>{
    config.zips[`${prefix}/actions/artifacts/${id}/zip`]=zip;return {id,name,expired:false,digest:`sha256:${hashFile(zip)}`,size_in_bytes:statSync(zip).size,
      created_at:targetTime,expires_at:'2099-01-01T00:00:00Z',workflow_run:{id:88005,head_sha:mainSha,head_branch:'main'}};});
  register({run_id:88005,run_attempt:1},{run:runEvidence(88005,'.github/workflows/static-site.yml',mainSha,{event:'schedule'}),jobs:[{name:'combine-and-build',run_attempt:1,conclusion:'success',started_at:targetTime,completed_at:targetTime,steps:[{name:'Build static frontend',conclusion:'success'}]}],artifacts:freshArtifacts});
  api[`${prefix}/actions/artifacts?per_page=100`]=[{artifacts:freshArtifacts}];
  rmSync(freshPublic,{recursive:true});
  env.GITHUB_ENV=join(directory,'carry.env');
  command('plan');assert.ok(read(join(env.RUNNER_TEMP,'verified-publication/state.json')).carry);
  command('restore');command('prepare-carry');
  const carryState=read(join(env.RUNNER_TEMP,'verified-publication/state.json'));
  assertOriginalFinancialClocks(originalProjectionBytes,read(carryState.carry.projectionPath),targetTime);
  checkpoint('verified original receipt and proof clocks',{synthetic_evaluation_time:targetTime,source_evaluation_time:preview.financial.evaluated_at});
  const carryEnv=Object.fromEntries(readFileSync(env.GITHUB_ENV,'utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
  for(const script of ['export-research.mjs','record-candidate-history.mjs'])run(process.execPath,[`tools/${script}`],{cwd:releaseFrontend,env:{...env,...carryEnv}});
  renameSync(freshPublic,dist);
  // This is the same approved UI SHA. Supply its exact verified build bytes;
  // the integration exercises data publication without rebuilding the UI.
  for(const path of Object.keys(uiInventory(deployedRoot))){mkdirSync(dirname(join(dist,path)),{recursive:true});cpSync(join(deployedRoot,path),join(dist,path));}
  command('compose');command('recheck');command('recheck');
  const carriedPublication=read(join(dist,'publication.json'));
  const carriedLogical=await canonicalPublication({root:dist,frontendRoot:frontend,publication:carriedPublication,restore:join(directory,'carry-logical')});
  const carried=verifyFinancialReleaseAssets(carriedLogical,carriedPublication.financial_release,carriedPublication);
  assert.equal(Boolean(carriedPublication.transport),Boolean(publication.transport),'carry changed approved transport representation');
  assert.equal(carried.mode,'carry');assert.equal(carried.previous_publication_identity,deployed.identity);
  assert.equal(carriedPublication.ui_digest,deployed.uiDigest);
  for(const key of ['lineage','source_projection','source_base'])assert.deepEqual(carried[key],financial[key]);
  assert.equal(carriedPublication.price_observations['["US","chart","NVDA"]'],targetDate);
  const {decodeResearchIndex}=await import(pathToFileURL(join(releaseFrontend,'src/static/researchTransport.js')).href);
  const carriedManifest=read(join(carriedLogical,'static-data/manifest.json'));
  const carriedRows=decodeResearchIndex(read(join(carriedLogical,'static-data',carriedManifest.markets.US.assets.research.path))).rows;
  const identities=rows=>rows.map(row=>JSON.stringify([row.market||'US',row.symbol])).sort();
  assert.deepEqual(identities(carriedRows),identities(targetBase.rows),'advancing carry changed the full target symbol universe');
  for(const symbol of advancedSymbols)assert.equal(carriedPublication.price_observations[JSON.stringify(['US','chart',symbol])],targetDate,`missing advanced chart observation: ${symbol}`);
  const history=read(join(carriedLogical,'static-data/candidate-history/index.json')),priorHistory=JSON.parse(previousHistory);
  assert.deepEqual(history.snapshots.slice(0,priorHistory.snapshots.length),priorHistory.snapshots);
  config.liveRoot=dist;deployment(88004,mainSha,Date.parse(targetTime)+60000,Date.parse(targetTime)+61000,Date.parse(targetTime));save();
  const carriedLive=JSON.parse(run(process.execPath,['--input-type=module','-e',`import {livePublication} from ${JSON.stringify(liveModule)};console.log(JSON.stringify(await livePublication()));`],{cwd:checkout,env}));
  assert.deepEqual(carriedLive.financialRelease,carried);
  removeCanonical(dist,carriedLogical);report.outcome='activation-and-synthetic-next-price-carry-passed';
  checkpoint('read simulated deployed next-price carry',{publication_identity:carriedLive.identity,financial_generation:carriedLive.receipt.financial_generation,lineage_sha256:carriedLive.receipt.financial_lineage_sha256,synthetic_chart_alias_observations:appended});
  return {directory,report,deployed,carried:carriedLive};
}
