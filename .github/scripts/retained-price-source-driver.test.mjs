import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {execFileSync} from 'node:child_process';
import {PassThrough} from 'node:stream';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {produceRetainedSource,verifyProducedRetainedSource,createRetainedSourceCompanion,replayRetainedSource,
  runRetainedSourceCommand,isolatedWorkerCommand,validateUploadedArtifact,hashFile,physicalInventory,downloadOriginalArchive,
  verifyRetainedRestoreBinding,extractRetainedProducerArchive,restoredDataDigest,compareReplayPhysical} from './retained-price-source-driver.mjs';
import {validateArithmeticRuntime} from './retained-price-source-driver.mjs';
import {verifySelectedProjection} from './retained-price-source-driver.mjs';
import {immutableOriginals,ORIGINAL_RESPONSE_KEYS,OBSERVATION_RESPONSE_KEYS} from './retained-price-source-driver.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const sort=value=>Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])])):value;
const bytes=value=>Buffer.from(JSON.stringify(sort(value)));
const G='a'.repeat(40),T='b'.repeat(40),H='c'.repeat(64),repo='kusennjp1-ai/screener',repoId=1203919607;
const now=Date.parse('2026-10-07T10:00:00Z'),started='2026-10-07T09:55:00Z';
const immutable=immutableOriginals;

function fixture(t){
  const base=mkdtempSync(join(tmpdir(),'retained-driver-'));t.after(()=>rmSync(base,{recursive:true,force:true}));
  const root=join(base,'controller'),runnerTemp=join(base,'runtime');mkdirSync(root);mkdirSync(runnerTemp);
  const output=join(runnerTemp,'source'),jobStart=join(runnerTemp,'job-start');writeFileSync(jobStart,String(now/1000-300));
  const request={enabled:true,approved_ui:{sha:G,tree:T,frontend_tree:G},predecessor:{identity:'prior/99',run_id:99}};
  const raw=bytes(request),requestRecord={raw,value:request,sha256:sha(raw)};
  const execution={repository:repo,repository_id:repoId,event_name:'workflow_run',ref:'refs/heads/main',sha:G,workflow_sha:G,
    workflow_ref:`${repo}/.github/workflows/static-site.yml@refs/heads/main`,run_id:123,run_attempt:1};
  const run={id:123,run_attempt:1,head_sha:G,head_branch:'main',path:'.github/workflows/static-site.yml',workflow_id:294257497,event:'workflow_run',status:'in_progress',conclusion:null,
    repository:{id:repoId,full_name:repo},head_repository:{id:repoId,full_name:repo}};
  const job={id:456,run_id:123,run_attempt:1,head_sha:G,name:'combine-and-build',status:'in_progress',conclusion:null,started_at:started,
    steps:[{name:'Upload verified data export',status:'completed',conclusion:'success'}]};
  const evidence={schema_version:'oct6-retained-price-rehearsal-api-v1',publication_authority:false,provider_work:false,
    reviewed_historical_main:{sha:G,tree:T},approved_ui:request.approved_ui,producer_runtime:{python:'3.11'},
    selected:{candidate:{id:419,created_at:'2026-10-06T20:00:00Z'},companion:{id:420},prior:{id:99}},
    observed_at:'2026-10-07T10:00:00Z',caller:{},current_main_observation:{},responses:{},response_sha256:{}};
  for(const key of [...ORIGINAL_RESPONSE_KEYS,...OBSERVATION_RESPONSE_KEYS]){
    evidence.responses[key]={source:key};evidence.response_sha256[key]=sha(bytes(evidence.responses[key]));
  }
  const archiveBytes=Buffer.from('bounded fixture archive');
  const archives=Object.fromEntries(['candidate','companion','prior'].map((role,i)=>[role,{artifact_id:10+i,artifact_name:role,bytes:archiveBytes.length,sha256:sha(archiveBytes),artifact:{id:10+i}}]));
  const calls=[];
  const authority={readRepairRequest:()=>requestRecord,validateRepairRequest:()=>request,
    assertRepairPredecessor:live=>{calls.push('live-checked');assert.equal(live.identity,'prior/99');},
    authenticateOriginals:()=>{calls.push('originals-authenticated');return {evidence:structuredClone(evidence),archives};}};
  const artifact={id:789,name:'static-site-data-123-1',size_in_bytes:100,digest:'sha256:'+H,expired:false,created_at:'2026-10-07T09:59:00Z',expires_at:'2026-10-14T10:00:00Z',
    workflow_run:{id:123,head_sha:G,head_branch:'main',repository_id:repoId,head_repository_id:repoId}};
  const o={root,runnerTemp,output,jobStart,authority,execution,event:{action:'completed'},now:()=>now,suppressWorkflowOutput:true,
    arithmeticRuntime:(_options,mode)=>({schema_version:'retained-price-arithmetic-runtime-v1',mode,version:[3,11,14],numpy:'1.26.3',pandas:'2.2.0'}),
    readLive:async()=>({identity:'prior/99'}),freeBytes:()=>64*1024**3,
    producerGate:()=>{calls.push('ci-authenticated');return {status:'verified',repair:true,activation:{executing:{sha:G,tree:T}}};},
    activationGate:()=>({status:'active',executing:{sha:G,tree:T}}),
    api:endpoint=>{calls.push('api:'+endpoint);if(endpoint.endsWith('/git/commits/'+G))return {sha:G,tree:{sha:T}};
      if(endpoint.includes('/jobs?'))return [{total_count:1,jobs:[structuredClone(job)]}];
      if(endpoint.endsWith('/actions/artifacts/789'))return structuredClone(artifact);
      if(endpoint.includes('/actions/runs/123'))return structuredClone(run);
      throw Error('Unexpected fixture API '+endpoint);},
    run:(command,args)=>{calls.push([command,...args]);assert.equal(command,'git');if(args.join(' ')==='rev-parse HEAD')return G;
      if(args.join(' ')==='rev-parse HEAD^{tree}')return T;throw Error('Unexpected fixture command');},
    downloadOriginal:async(role,pin,path,limits)=>{calls.push('download:'+role);assert(limits.timeoutMs>0&&limits.timeoutMs<=240000);writeFileSync(path,archiveBytes,{flag:'wx'});},
    prepareDependencies:directory=>{calls.push('dependencies');mkdirSync(directory);const modules=join(directory,'node_modules');mkdirSync(modules);return {node_modules:modules,receipt:{schema_version:'fixture-dependencies'}};},
    launchWorker:(_options,inputPath,destination)=>{
      calls.push('worker');const input=JSON.parse(readFileSync(inputPath)),inv=JSON.parse(readFileSync(input.invocation_evidence.path));
      assert(!Object.hasOwn(input,'evaluated_at'));assert.equal(input.mode==='producer',input.producer_declaration===null);
      mkdirSync(destination);const site=join(destination,'runtime/frontend/dist');mkdirSync(join(site,'static-data'),{recursive:true});
      writeFileSync(join(site,'static-data/manifest.json'),'{"as_of_date":"2026-10-06"}');
      const publicRoot=join(destination,'runtime/frontend/public'),audit='static-data/retained-price-source-audit/literal.json';
      mkdirSync(join(publicRoot,'static-data/retained-price-source-audit'),{recursive:true});writeFileSync(join(publicRoot,audit),input.mode);
      mkdirSync(join(site,'static-data/retained-price-source-audit'));writeFileSync(join(site,audit),input.mode);
      const payload=input.mode==='producer'?{schema_version:'retained-price-source-payload-v1',source_api:immutable(evidence),producer:inv.caller,
        request_sha256:requestRecord.sha256,evaluated_at:'2026-10-07T09:57:00Z',approved_ui:request.approved_ui}:JSON.parse(readFileSync(input.producer_declaration.path));
      writeFileSync(join(destination,'payload.json'),bytes(payload));
      writeFileSync(join(destination,'physical-inventory.json'),bytes({schema_version:'retained-price-source-physical-inventory-v1',dist:physicalInventory(site),public:physicalInventory(publicRoot)}));
    },
    verifyLocal:(_options,destination,inputPath)=>{calls.push('readback');assert(existsSync(inputPath));
      const physical=JSON.parse(readFileSync(join(destination,'physical-inventory.json')));assert.deepEqual(physicalInventory(join(destination,'runtime/frontend/dist')),physical.dist);return {verified:true};},
    verifySelectedProjection:()=>{calls.push('selected-projection-readback');return {verified:true};},
    observePrices:()=>({'["US","chart","LPSN"]':'2026-10-06'})};
  return {o,calls,request,requestRecord,evidence,archives,run,job,artifact,base};
}

test('producer authenticates before setup, samples no caller clock, and repeats original/live checks',async t=>{
  const f=fixture(t),result=await produceRetainedSource(f.o);
  assert.equal(result.status,'verified');assert.equal(result.site_dir,join(f.o.output,'runtime/frontend/dist'));
  assert(f.calls.indexOf('ci-authenticated')<f.calls.indexOf('download:candidate'));
  assert(f.calls.indexOf('originals-authenticated')<f.calls.indexOf('worker'));
  assert(f.calls.filter(v=>v==='live-checked').length>=2);assert(f.calls.filter(v=>v==='originals-authenticated').length>=3);
  assert(f.calls.filter(v=>v==='readback').length>=2);
});

test('inactive request prevents all runtime work',async t=>{
  const f=fixture(t);f.request.enabled=false;
  await assert.rejects(produceRetainedSource(f.o),/disabled/);assert.equal(f.calls.length,0);assert(!existsSync(f.o.output+'-inputs'));
});

test('storage guard rejects before copying originals or installing packages',async t=>{
  const f=fixture(t);f.o.freeBytes=()=>12*1024**3;
  await assert.rejects(produceRetainedSource(f.o),/storage/);assert(!f.calls.some(v=>typeof v==='string'&&v.startsWith('download:')));
});

test('expired real job clock rejects before source downloads',async t=>{
  const f=fixture(t);writeFileSync(f.o.jobStart,String(now/1000-101*60));
  await assert.rejects(produceRetainedSource(f.o),/budget/);assert(!f.calls.includes('download:candidate'));
});

test('output inside controller or outside RUNNER_TEMP rejects',async t=>{
  const f=fixture(t);await assert.rejects(produceRetainedSource({...f.o,output:join(f.o.root,'output')}),/RUNNER_TEMP/);
  await assert.rejects(produceRetainedSource({...f.o,output:join(f.base,'outside')}),/RUNNER_TEMP/);
});

test('changed original source evidence during acquisition stops before replay',async t=>{
  const f=fixture(t);let n=0;f.o.authority.authenticateOriginals=()=>{const evidence=structuredClone(f.evidence);if(n++)evidence.selected.candidate.created_at='changed';return {evidence,archives:f.archives};};
  await assert.rejects(produceRetainedSource(f.o),/changed during acquisition/);assert(!f.calls.includes('worker'));
});

test('isolated launch passes only fixed scrubbed environment and bounded worker inputs',()=>{
  const [command,args]=isolatedWorkerCommand({root:'/controller',inputs:'/tmp/input/inputs.json',output:'/tmp/result',jobStart:'/tmp/job',python:'/opt/python3.11',parentNamespace:'net:[123]',path:'/opt/bin:/usr/bin',uid:1001,gid:1001});
  assert.equal(command,'sudo');assert.deepEqual(args.slice(0,8),['-n','unshare','--net','--setuid=1001','--setgid=1001','--','env','-i']);
  assert(args.includes('PYTHONDONTWRITEBYTECODE=1'));assert(!args.some(v=>/GH_TOKEN|GITHUB_TOKEN|FINANCIAL_|VITE_|NODE_OPTIONS/.test(v)));
  assert(!args.includes('--evaluated-at'));assert(args.includes('--parent-network-namespace'));
});

test('verify-produced detects mutated physical source and original job clock',async t=>{
  const f=fixture(t);await produceRetainedSource(f.o);
  const file=join(f.o.output,'runtime/frontend/dist/static-data/manifest.json'),before=readFileSync(file);writeFileSync(file,'changed');
  await assert.rejects(verifyProducedRetainedSource(f.o));writeFileSync(file,before);
  writeFileSync(f.o.jobStart,String(now/1000-200));await assert.rejects(verifyProducedRetainedSource(f.o),/clock changed/);
});

test('companion binds the actual returned artifact and exact literal worker proofs',async t=>{
  const f=fixture(t);await produceRetainedSource(f.o);
  const result=await createRetainedSourceCompanion({...f.o,artifactId:789,artifactDigest:'sha256:'+H});
  const metadata=JSON.parse(readFileSync(result.path));assert.equal(metadata.run_id,123);assert.equal(metadata.artifact_name,'static-site-data-123-1');
  const repair=metadata.retained_price_repair;assert.equal(repair.schema_version,'retained-price-source-declaration-v1');
  assert.equal(repair.payload_json,readFileSync(join(f.o.output,'payload.json'),'utf8'));assert.equal(repair.physical_inventory_json,readFileSync(join(f.o.output,'physical-inventory.json'),'utf8'));
  assert.deepEqual(repair.artifact,{id:789,name:'static-site-data-123-1',bytes:100,sha256:H});
  assert.equal(sha(repair.payload_json),repair.payload_sha256);
});

test('companion rejects upload identity, job clock or missing real upload step',t=>{
  const f=fixture(t),context={id:789,digest:'sha256:'+H,caller:{run:f.run,attempt:1,job:f.job},now};
  assert.equal(validateUploadedArtifact(f.artifact,context).id,789);
  for(const changed of [{...f.artifact,id:99},{...f.artifact,created_at:'2026-10-07T09:00:00Z'},{...f.artifact,expired:true},{...f.artifact,digest:'sha256:'+'e'.repeat(64)}]){
    assert.throws(()=>validateUploadedArtifact(changed,context),/origin\/clock/);
  }
  context.caller.job={...f.job,steps:[]};assert.throws(()=>validateUploadedArtifact(f.artifact,context),/upload step/);
});

test('replay requires whole selected producer inventory and preserves both physical proofs',async t=>{
  const f=fixture(t);await produceRetainedSource(f.o);
  const sourceRoot=join(f.o.output,'runtime/frontend/dist'),declarationRaw=readFileSync(join(f.o.output,'payload.json')),physicalRaw=readFileSync(join(f.o.output,'physical-inventory.json'));
  const auth={request:f.requestRecord,producer:{id:123,run_attempt:1,head_sha:G},proof:{job:{id:456,started_at:started,completed_at:'2026-10-07T09:59:30Z'}},
    declaration:{raw:declarationRaw,value:JSON.parse(declarationRaw),sha256:sha(declarationRaw)},physical:{raw:physicalRaw,value:JSON.parse(physicalRaw),sha256:sha(physicalRaw)},
    artifact:f.artifact,companion:{id:790,digest:'sha256:'+H}};
  f.o.authority.authenticateRepairSource=()=>auth;
  f.o.execution.workflow_ref=`${repo}/.github/workflows/research-ui-release.yml@refs/heads/main`;
  f.run.path='.github/workflows/research-ui-release.yml';f.run.workflow_id=364666954;f.job.name='publish';
  const publisherClock=join(f.o.runnerTemp,'retained-price-publisher-job-start');writeFileSync(publisherClock,readFileSync(f.o.jobStart));
  const replay=await replayRetainedSource({...f.o,source:{repair:{}},selectedRoot:sourceRoot,output:join(f.o.runnerTemp,'replay'),jobStart:publisherClock});
  assert.equal(replay.offline_recovery_verified,true);assert.equal(replay.producerRoot,sourceRoot);
  assert.equal(replay.verification.producer_physical_sha256,sha(physicalRaw));
  assert(existsSync(join(replay.replayRoot,'physical-inventory.json')));assert.equal(readFileSync(join(f.o.output,'physical-inventory.json'),'utf8'),physicalRaw.toString());
  const record={verification:replay.verification,verification_file:replay.verification_file,restored_data_digest:replay.verification.restored_data_digest};
  const initialWorkers=f.calls.filter(v=>v==='worker').length;
  const checked=await verifyRetainedRestoreBinding({...f.o,source:{repair:{}},record,live:{identity:'prior/99'}});
  assert.equal(checked.verified,true);assert.equal(checked.ordinary_carry_required,true);assert.equal(f.calls.filter(v=>v==='worker').length,initialWorkers);
  const changedRecord=structuredClone(record);changedRecord.restored_data_digest=H;
  await assert.rejects(verifyRetainedRestoreBinding({...f.o,source:{repair:{}},record:changedRecord,live:{identity:'prior/99'}}),/baseline differs/);
  const privateBytes=readFileSync(record.verification_file.path);writeFileSync(record.verification_file.path,Buffer.concat([privateBytes,Buffer.from(' ')]));
  await assert.rejects(verifyRetainedRestoreBinding({...f.o,source:{repair:{}},record,live:{identity:'prior/99'}}),/Bound file changed/);
  writeFileSync(record.verification_file.path,privateBytes);
  const savedJobId=f.job.id;f.job.id++;
  await assert.rejects(verifyRetainedRestoreBinding({...f.o,source:{repair:{}},record,live:{identity:'prior/99'}}),/another caller/);f.job.id=savedJobId;
  writeFileSync(join(sourceRoot,'extra.json'),'unknown');
  await assert.rejects(verifyRetainedRestoreBinding({...f.o,source:{repair:{}},record,live:{identity:'prior/99'}}),/producer inventory changed/);
  await assert.rejects(replayRetainedSource({...f.o,source:{repair:{}},selectedRoot:sourceRoot,output:join(f.o.runnerTemp,'replay-again')}),/complete literal producer inventory/);
});

test('restored data digest binds producer data and independent audit without UI authority',()=>{
  const pin={bytes:1,sha256:H},producer={'static-data/a.json':pin,'research-daily.json':pin,'index.html':pin},replay={'static-data/retained-price-source-audit/receipt.json':pin};
  const expected={'static-data/a.json':H,'research-daily.json':H,'static-data/retained-price-source-replay-audit/receipt.json':H};
  assert.equal(restoredDataDigest(producer,replay),sha(bytes(expected)));
  assert.equal(restoredDataDigest({...producer,'index.html':{bytes:2,sha256:'d'.repeat(64)}},replay),sha(bytes(expected)));
  assert.throws(()=>restoredDataDigest({...producer,'static-data/retained-price-source-replay-audit/forged.json':pin},replay),/reserved/);
});

test('bounded extraction uses reviewed scanner/copy primitives and rejects extra or modified TAR members',async t=>{
  const f=fixture(t),scripts=join(f.o.root,'.github/scripts');mkdirSync(scripts,{recursive:true});
  for(const name of ['read-retained-price-archive.py','restore-retained-price-candidate.py'])writeFileSync(join(scripts,name),readFileSync(new URL('./'+name,import.meta.url)));
  const memberBytes=Buffer.from('literal producer data'),member='static-data/manifest.json';
  const files={[member]:{bytes:memberBytes.length,sha256:sha(memberBytes)}};
  f.o.authority.authenticateRepairSource=()=>({physical:{value:{dist:files},sha256:H},artifact:{id:789}});
  const archive=join(f.o.runnerTemp,'artifact.tar');
  const create=({extra=false,bad=false,directory=false}={})=>execFileSync('python3',['-c',
    "import io,sys,tarfile; t=tarfile.open(sys.argv[1],'w',format=tarfile.GNU_FORMAT); raw=sys.argv[2].encode(); m=tarfile.TarInfo('static-data/manifest.json'); m.size=len(raw); t.addfile(m,io.BytesIO(raw)); " +
    (extra?"m=tarfile.TarInfo('unknown.json'); m.size=1; t.addfile(m,io.BytesIO(b'x')); ":'')+
    (directory?"m=tarfile.TarInfo('unknown-dir/'); m.type=tarfile.DIRTYPE; t.addfile(m); ":'')+"t.close()",archive,bad?'Literal producer data':memberBytes.toString()]);
  f.o.run=(command,args,options)=>{
    assert.equal(command,'python3');
    // Tiny extraction fixture only: model an adequate disk through the already
    // reviewed private disk-observation seam. Production has no such switch.
    const local=[...args];local[1]=local[1].replace('R=s.R;archive_path=',"s._disk_free_bytes=lambda _:32*1024**3\nR=s.R;archive_path=");
    return execFileSync(command,local,{...options,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  };
  create();const destination=join(f.o.runnerTemp,'exact-extraction');
  const result=await extractRetainedProducerArchive({...f.o,source:{},archive,destination});assert.equal(result.selectedRoot,destination);
  assert.deepEqual(physicalInventory(destination),files);
  for(const [name,mutation]of [['extra',{extra:true}],['changed',{bad:true}],['directory',{directory:true}]]){
    create(mutation);const target=join(f.o.runnerTemp,name);
    await assert.rejects(extractRetainedProducerArchive({...f.o,source:{},archive,destination:target}));assert(!existsSync(target));
  }
  create();f.o.freeBytes=()=>8*1024**3;
  await assert.rejects(extractRetainedProducerArchive({...f.o,source:{},archive,destination:join(f.o.runnerTemp,'space-blocked')}),/storage/);
});

test('literal producer and replay data must agree independently of the two claimed descriptors',()=>{
  const pin={bytes:1,sha256:H},other={bytes:1,sha256:'d'.repeat(64)};
  const producer={'static-data/price.json':pin,'retained-price-restoration-receipt.json':pin,'static-data/retained-price-source-audit/receipt.json':pin};
  const replay={...producer,'retained-price-restoration-receipt.json':other,'static-data/retained-price-source-audit/receipt.json':other};
  assert.doesNotThrow(()=>compareReplayPhysical(producer,replay));
  assert.throws(()=>compareReplayPhysical(producer,{...replay,'static-data/price.json':other}),/immutable producer member/);
  assert.throws(()=>compareReplayPhysical({...producer,'static-data/hidden.json':pin},replay),/path membership/);
  assert.throws(()=>compareReplayPhysical(producer,{...replay,'static-data/retained-price-source-audit/new.json':other}),/path membership/);
});

test('source response projection preserves original API/Git records and allows only two exact observation entries',t=>{
  const f=fixture(t),original=immutableOriginals(f.evidence);
  for(const key of ORIGINAL_RESPONSE_KEYS){
    const changed=structuredClone(f.evidence);changed.responses[key]={changed:'original record'};assert.notDeepEqual(immutableOriginals(changed),original);
    const hashChanged=structuredClone(f.evidence);hashChanged.response_sha256[key]='d'.repeat(64);assert.notDeepEqual(immutableOriginals(hashChanged),original);
  }
  for(const key of OBSERVATION_RESPONSE_KEYS){const changed=structuredClone(f.evidence);
    if(key===`GET repos/${repo}`)Object.assign(changed.responses[key],{pushed_at:'fresh',updated_at:'fresh',size:99});else changed.responses[key]={fresh:'main observation'};
    changed.response_sha256[key]='d'.repeat(64);assert.deepEqual(immutableOriginals(changed),original);}
  for(const field of ['id','private','default_branch','owner','unknown_field']){const changed=structuredClone(f.evidence);changed.responses[`GET repos/${repo}`][field]='altered';assert.notDeepEqual(immutableOriginals(changed),original);}
  const unknown=structuredClone(f.evidence);unknown.responses['GET arbitrary-observation']={};assert.throws(()=>immutableOriginals(unknown),/Unknown or missing/);
});

test('selected producer audit is reprojected from literal receipt bytes with the exact worker helper',t=>{
  const f=fixture(t),sourceScripts=new URL('./',import.meta.url).pathname,actualRoot=new URL('../../',import.meta.url).pathname;
  const setup=String.raw`
import importlib.util,json,pathlib,shutil,sys
spec=importlib.util.spec_from_file_location('fixture_suite',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
t=m.InputContractTests();t.setUp();t.test_audit_two_passes_keep_raw_receipts_and_match_semantics()
w=m.W;out=t.root/'run-2';public=out/'runtime/frontend/public';audit=public/w.AUDIT
def ref(name):
 p=t.root/name;return {'path':str(p),**w.digest_file(p)}
inputs=dict(t.inputs);inputs['original_api_evidence']=ref('original-api-evidence.json')
parsed={'original_api_evidence':w.read_json(t.root/'original-api-evidence.json'),'invocation_evidence':t.inv,'dependencies':{}}
receipt,graph,validation,projection,observations=w.project_existing_audit(out,inputs,parsed,m.declaration()['evaluated_at'])
physical=w.RUNNER.tree_inventory(public)
payload={'producer':w.producer_identity(inputs,t.inv),'request_sha256':inputs['request']['sha256'],'evaluated_at':m.declaration()['evaluated_at'],
 'approved_ui':w.CONTRACT['approved_ui'],'graph':graph,'validation':validation,'audit':projection,
 'source_api':w.source_api_projection(parsed['original_api_evidence']),'dependencies':w.binding({}),
 'build':{'files':w.semantic_inventory(physical,receipt,projection)}}
dest=pathlib.Path(sys.argv[2]);shutil.copytree(public,dest/'selected');(dest/'payload.json').write_bytes(w.canonical(payload))
print(t.inv['controller']['tree'])
`;
  const tree=execFileSync('python3',['-c',setup,join(sourceScripts,'test_run_retained_price_source.py'),f.o.runnerTemp],
    {encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']}).trim();
  const o={root:actualRoot,run:(_command,args,options)=>execFileSync('python3',args,{...options,encoding:'utf8',stdio:['ignore','pipe','pipe']})};
  const selected=join(f.o.runnerTemp,'selected'),declaration=join(f.o.runnerTemp,'payload.json');
  assert.equal(verifySelectedProjection(o,selected,declaration,tree).verified,true);
  const receipt=join(selected,'retained-price-restoration-receipt.json'),original=readFileSync(receipt),value=JSON.parse(original);
  value.archive.sha256='e'.repeat(64);writeFileSync(receipt,bytes(value));
  assert.throws(()=>verifySelectedProjection(o,selected,declaration,tree));writeFileSync(receipt,original);
  const extra=join(selected,'static-data/retained-price-source-audit/unknown.json');writeFileSync(extra,'{}');
  assert.throws(()=>verifySelectedProjection(o,selected,declaration,tree));
});

test('arithmetic interpreter stays inside the exact role venv and pins original numeric versions',t=>{
  const f=fixture(t),original=process.env.RETAINED_PRICE_PYTHON;t.after(()=>{if(original===undefined)delete process.env.RETAINED_PRICE_PYTHON;else process.env.RETAINED_PRICE_PYTHON=original;});
  for(const [mode,name]of [['producer','retained-price-python'],['replay','financial-replay-runtime']]){
    const directory=join(f.o.runnerTemp,name);mkdirSync(directory);const python=join(directory,'bin/python3.11');
    process.env.RETAINED_PRICE_PYTHON=python;
    const actual={executable:python,prefix:directory,version:[3,11,14],numpy:'1.26.3',pandas:'2.2.0'};
    f.o.run=command=>{assert.equal(command,python);return JSON.stringify(actual);};
    assert.equal(validateArithmeticRuntime(f.o,mode).mode,mode);
    actual.numpy='2.0.0';assert.throws(()=>validateArithmeticRuntime(f.o,mode),/Unreviewed/);actual.numpy='1.26.3';
    actual.version=[3,12,3];assert.throws(()=>validateArithmeticRuntime(f.o,mode),/Unreviewed/);actual.version=[3,11,14];
    assert.throws(()=>validateArithmeticRuntime(f.o,mode==='producer'?'replay':'producer'),/exact dedicated/);
  }
});

test('CLI accepts no caller clock, command, paths list or duplicate options',async()=>{
  for(const argv of [['produce','--output','/tmp/x','--evaluated-at','2000'],['verify-produced','--output','a','--output','b'],['shell','--output','a']]){
    await assert.rejects(runRetainedSourceCommand(argv,{}),/finite source/);
  }
});

test('complete inventory rejects source links and bounds dependency links',t=>{
  const f=fixture(t),directory=join(f.o.runnerTemp,'inventory');mkdirSync(directory);writeFileSync(join(directory,'original'),'exact');symlinkSync('original',join(directory,'linked'));
  assert.throws(()=>physicalInventory(directory),/Linked/);assert.deepEqual(physicalInventory(directory,{dependencies:true}).linked,{symlink:'original'});
  symlinkSync(f.o.jobStart,join(directory,'escape'));assert.throws(()=>physicalInventory(directory,{dependencies:true}),/escaping/);
});

test('bounded original download hashes bytes and refuses changed archives',async t=>{
  const f=fixture(t),content=Buffer.from('small exact ZIP fixture');
  const factory=(_command,_args,options)=>{assert(options.timeout<=240000);const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
    process.nextTick(()=>{child.stdout.end(content);child.stderr.end();child.emit('exit',0,null);});return child;};
  const pin={artifact_id:419,bytes:content.length,sha256:sha(content)},path=join(f.o.runnerTemp,'archive.zip');
  await downloadOriginalArchive('candidate',pin,path,{spawnProcess:factory});assert.deepEqual(hashFile(path),{bytes:content.length,sha256:sha(content)});
  await assert.rejects(downloadOriginalArchive('candidate',{...pin,sha256:H},join(f.o.runnerTemp,'bad.zip'),{spawnProcess:factory}),/archive changed/);
});

test('bare source caller transport hook preserves the existing fresh setup reads',async t=>{
  const f=fixture(t),result=await produceRetainedSource(f.o);
  assert.equal(result.context.caller.job.id,f.job.id);
  for(const endpoint of ['actions/runs/123/attempts/1','actions/runs/123','actions/runs/123/attempts/1/jobs?per_page=100','git/commits/'+G])
    assert.equal(f.calls.filter(value=>value==='api:repos/'+repo+'/'+endpoint).length,2,endpoint);
});
