import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {financialReleasePolicy as policy,readFinancialReleaseRequest,parseFinancialReleaseRequest,parseFinancialActivationCandidate,readFinancialActivationCandidate,verifyPinnedCandidateAttempt,verifyPinnedCandidateBindings,restorePinnedCandidateArchive,selectActivationCandidate,protectedCodeInventory,validateCandidateRecord,verifyCandidateAttempt,extractCandidateTar,completeInventory,sourceLineage,writeFinancialReleaseReceipt,verifyFinancialReleaseAssets,assertFinancialLineageContinuity,validateFinancialReleaseReceipt,restorePublishedFinancialSource} from './financial-release-activation.mjs';
import {digest,contract} from './financial-correction.mjs';
import {bootstrap,sha256,inventoryDigest} from './publication-state.mjs';
import {certifiedSourceFixture} from './fixtures/certified-source-preview.mjs';

const H='a'.repeat(64),S='b'.repeat(40),T='c'.repeat(40),P=`8/2/${H}/${H}`;
const request=fixture=>({schema_version:'financial-release-request-v1',correction:{schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,previous_publication_identity:P,source:fixture.source},source_validation:{guard:'certified_source_artifact_v1',certificate:fixture.reference},destination_projection:{projector:'native_annual_destination_v1',policy:'financial-correction-native-annual-v1'}});
const temporary=()=>mkdtempSync(join(tmpdir(),'financial-release-test-'));
// Spawn the real entrypoint: importing its exports in this test process would
// finish module evaluation before dispatch and hide the CLI's lazy-import cycle.
const activationCli=fileURLToPath(new URL('./financial-release-activation.mjs',import.meta.url));
function invokeActivation(root,command,extraEnv={}) {
  return spawnSync(process.execPath,[activationCli,command],{cwd:root,encoding:'utf8',timeout:10000,
    env:{PATH:process.env.PATH,RUNNER_TEMP:root,...extraEnv}});
}
test('design prepare CLI handles absent and invalid requests before any remote read',()=>{
  const root=temporary(),output=join(root,'output');
  try{
    let result=invokeActivation(root,'design-prepare',{GITHUB_OUTPUT:output});
    assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
    assert.equal(readFileSync(output,'utf8'),'candidate=false\n');
    mkdirSync(join(root,'.github'));writeFileSync(join(root,policy.request_path),'{}');
    result=invokeActivation(root,'design-prepare');
    assert.ifError(result.error);assert.equal(result.status,1,result.stderr);
    assert.match(result.stderr,/Invalid closed financial release request/);
    assert.doesNotMatch(result.stderr,/unsettled top-level await/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('design prepare CLI validates a live financial receipt through its lazy self import',()=>{
  const root=temporary(),f=certifiedSourceFixture();
  try{
    mkdirSync(join(root,'.github'));writeFileSync(join(root,policy.request_path),JSON.stringify(request(f)));
    const bin=join(root,'bin'),preload=join(root,'fetch.mjs'),config=join(root,'remote.json');mkdirSync(bin);
    const manifest=JSON.stringify({as_of_date:'2026-10-02',default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:'2026-10-02'}}});
    const financialBytes='{}',financialPath=`static-data/financial-corrections/release-${sha256(financialBytes)}.json`;
    const publication={schema:1,run_id:1,run_attempt:1,artifact_name:'github-pages-1-1',ui_sha:bootstrap.ui_sha,
      ui_files:bootstrap.ui_files,ui_digest:inventoryDigest(bootstrap.ui_files),approval:{type:'bootstrap',sha:bootstrap.ui_sha},
      data_manifest_sha256:sha256(manifest),verification_universe:{as_of_date:'2026-10-02',required_symbols:['AAA'],minimum_target:0.9,total:1,verified:1},
      price_observations:{},known_price_dates:{},financial_generation:H,financial_lineage_sha256:H,data_inventory_sha256:H,
      financial_release:{schema_version:'financial-release-receipt-v1',path:financialPath,sha256:sha256(financialBytes)}};
    const prefix=`repos/${bootstrap.repository}/actions`,api={
      [`${prefix}/runs/1/attempts/1`]:{id:1,run_attempt:1,head_branch:'main',head_sha:bootstrap.ui_sha,path:'.github/workflows/research-ui-release.yml',
        repository:{full_name:bootstrap.repository},head_repository:{full_name:bootstrap.repository}},
      [`${prefix}/runs/1/attempts/1/jobs?per_page=100`]:[{jobs:[{run_attempt:1,started_at:'2026-10-03T01:00:00Z',steps:[
        {name:'Deploy to GitHub Pages',conclusion:'success',started_at:'2026-10-03T01:01:00Z',completed_at:'2026-10-03T01:02:00Z'}]}]}],
      [`${prefix}/workflows/research-ui-release.yml/runs?branch=main&per_page=100`]:[{workflow_runs:[]}],
      [`${prefix}/workflows/static-site.yml/runs?branch=main&per_page=100`]:[{workflow_runs:[]}],
    };
    writeFileSync(config,JSON.stringify({api,live:{'publication.json':JSON.stringify(publication),'static-data/manifest.json':manifest,[financialPath]:financialBytes}}));
    // Only the transport is faked. The real publication parser, deployment and
    // approval checks, lazy receipt import and CLI dispatch all execute offline.
    writeFileSync(join(bin,'gh'),`#!${process.execPath}\n`+`
const fs=require('node:fs'),args=process.argv.slice(2),config=JSON.parse(fs.readFileSync(process.env.RELEASE_CLI_FIXTURE));
if(args[0]!=='api'||args.slice(1,-1).some(arg=>!['--paginate','--slurp'].includes(arg)))throw Error('Unexpected fixture command');
const endpoint=args.at(-1);if(!Object.hasOwn(config.api,endpoint))throw Error('Unexpected fixture API read '+endpoint);
process.stdout.write(JSON.stringify(config.api[endpoint]));
`);chmodSync(join(bin,'gh'),0o755);
    writeFileSync(preload,`
import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(process.env.RELEASE_CLI_FIXTURE)),base=new URL(${JSON.stringify(bootstrap.site_url)});
globalThis.fetch=async(input,options)=>{
 const url=new URL(input),path=url.pathname.slice(base.pathname.length);
 if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||!Object.hasOwn(config.live,path)||options.redirect!=='error')throw Error('Unexpected fixture fetch');
 return {ok:true,status:200,arrayBuffer:async()=>Buffer.from(config.live[path])};
};
`);
    const result=spawnSync(process.execPath,['--import',preload,activationCli,'design-prepare'],{cwd:root,encoding:'utf8',timeout:10000,
      env:{PATH:bin,RUNNER_TEMP:root,RELEASE_CLI_FIXTURE:config}});
    assert.ifError(result.error);assert.equal(result.status,1,result.stderr);
    assert.match(result.stderr,/Invalid closed financial release receipt/);
    assert.doesNotMatch(result.stderr,/unsettled top-level await/);
  }finally{f.cleanup();rmSync(root,{recursive:true,force:true});}
});
test('design prepare CLI fails closed when its async work cannot complete',()=>{
  const root=temporary(),f=certifiedSourceFixture();
  try{
    mkdirSync(join(root,'.github'));writeFileSync(join(root,policy.request_path),JSON.stringify(request(f)));
    const preload=join(root,'pending-fetch.mjs'),output=join(root,'output'),environment=join(root,'environment');
    writeFileSync(preload,'globalThis.fetch=()=>new Promise(()=>{});');
    const result=spawnSync(process.execPath,['--import',preload,activationCli,'design-prepare'],{cwd:root,encoding:'utf8',timeout:10000,
      env:{PATH:root,RUNNER_TEMP:root,GITHUB_OUTPUT:output,GITHUB_ENV:environment}});
    assert.ifError(result.error);assert.equal(result.status,1,result.stderr);
    assert.match(result.stderr,/Financial release command did not complete/);
    assert.equal(existsSync(output),false);assert.equal(existsSync(environment),false);
  }finally{f.cleanup();rmSync(root,{recursive:true,force:true});}
});
test('design seal CLI finishes the preview import cycle and reaches receipt validation',()=>{
  const root=temporary();
  try{
    const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
    git('init','-q');git('config','user.name','fixture');git('config','user.email','fixture@example.test');
    writeFileSync(join(root,'README'),'offline CLI fixture');git('add','.');git('commit','-qm','fixture');
    const result=invokeActivation(root,'design-seal',{GITHUB_SHA:git('rev-parse','HEAD'),FINANCIAL_CANDIDATE_DIR:root});
    assert.ifError(result.error);assert.equal(result.status,1,result.stderr);
    assert.match(result.stderr,/ENOENT.*preview-receipt\.json/);
    assert.doesNotMatch(result.stderr,/unsettled top-level await/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('retesting the captured consumer authorizes only the new producer current-main gates',()=>{const value=pinnedCandidate(),newSha='d'.repeat(40);value.record.producer={...value.record.producer,head_sha:newSha,run_id:15,run_attempt:1};value.run={...value.run,id:15,run_attempt:1,head_sha:newSha};value.jobs=value.jobs.map(job=>({...job,run_id:15,run_attempt:1,head_sha:newSha}));value.artifact={...value.artifact,id:19,name:'financial-release-candidate-15-1',workflow_run:{id:15,head_sha:newSha}};value.mainSha=newSha;value.approval={type:'gates',sha:newSha,runs:[{id:14,attempt:1,path:'.github/workflows/ci.yml'},{id:15,attempt:1,path:policy.candidate_workflow}]};assert.equal(verifyCandidateAttempt(value).head_sha,newSha);assert.equal(value.record.captured_ui.sha,S);assert.deepEqual(verifyPinnedCandidateBindings(value).captured_ui,value.record.captured_ui);assert.throws(()=>verifyCandidateAttempt({...value,approval:candidate().approval}),/current-main/);});
test('workflow triggers on the control pin and fetches original captured history for release',()=>{const design=readFileSync(new URL('../workflows/design-acceptance.yml',import.meta.url),'utf8'),release=readFileSync(new URL('../workflows/research-ui-release.yml',import.meta.url),'utf8');assert.ok(design.includes("'.github/financial-activation-candidate.json'"));assert.match(release,/ref: \$\{\{ steps.main.outputs.sha \}\}\n\s+fetch-depth: 0/);assert.equal(policy.protected_prefixes.some(prefix=>policy.activation_candidate_path.startsWith(prefix)),false);for(const prefix of ['frontend/','backend/','contracts/','data/ibd_reference/','.github/scripts/','.github/workflows/'])assert.ok(policy.protected_prefixes.includes(prefix));});
function pinnedCandidate(){
  const value=candidate(),projectionBytes=Buffer.from(JSON.stringify({financial_evaluated_at:'2026-10-04T12:00:00Z',proof:'original'}));
  const previewReceiptBytes=Buffer.from(JSON.stringify({candidate_ui:value.record.captured_ui,financial:{projection_sha256:sha256(projectionBytes),evaluated_at:'2026-10-04T12:00:00Z'}}));
  value.record.preview_receipt_sha256=sha256(previewReceiptBytes);
  const originalRecordBytes=Buffer.from(JSON.stringify(value.record));
  const pin={schema_version:'financial-activation-candidate-v1',repository:value.record.producer.repository,workflow:policy.candidate_workflow,head_sha:S,run_id:5,run_attempt:2,job_id:7,artifact_id:9,artifact_name:value.artifact.name,artifact_sha256:H,
    candidate_record_sha256:sha256(originalRecordBytes),projection_sha256:sha256(projectionBytes),preview_receipt_sha256:sha256(previewReceiptBytes)};
  return {...value,pin,recordBytes:originalRecordBytes,originalRecordBytes,previewReceiptBytes,projectionBytes};
}
test('activation pin is closed, bounded, literal and rejects malformed or linked files',()=>{const root=temporary();try{const {pin}=pinnedCandidate();assert.equal(parseFinancialActivationCandidate(pin),pin);for(const change of [v=>v.backup_complete=true,v=>v.artifact_id='latest',v=>v.workflow='.github/workflows/ci.yml',v=>v.run_attempt=0,v=>v.artifact_name='latest',v=>v.projection_sha256='unknown']){const bad=structuredClone(pin);change(bad);assert.throws(()=>parseFinancialActivationCandidate(bad));}mkdirSync(join(root,'.github'));writeFileSync(join(root,policy.activation_candidate_path),JSON.stringify(pin));assert.deepEqual(readFinancialActivationCandidate(root),pin);rmSync(join(root,policy.activation_candidate_path));symlinkSync('/missing-activation-pin',join(root,policy.activation_candidate_path));assert.throws(()=>readFinancialActivationCandidate(root));}finally{rmSync(root,{recursive:true,force:true});}});
test('historical candidate authority is distinct from the new current-main gate',()=>{const value=pinnedCandidate();assert.deepEqual(verifyPinnedCandidateAttempt(value),value.record);const current={...value,mainSha:T,approval:{...value.approval,sha:T}};assert.throws(()=>verifyCandidateAttempt(current),/current-main/);for(const change of [v=>v.run.event='pull_request',v=>v.pin.artifact_id=10,v=>v.pin.job_id=8,v=>v.pin.run_attempt=1,v=>v.recordBytes=Buffer.from(v.recordBytes+' '),v=>v.artifact.expired=true]){const bad={...value,run:structuredClone(value.run),pin:structuredClone(value.pin),artifact:structuredClone(value.artifact)};change(bad);assert.throws(()=>verifyPinnedCandidateAttempt(bad));}});
test('handoff preserves captured UI, evaluation clock and every candidate binding while producer advances',()=>{const value=pinnedCandidate(),record=structuredClone(value.record);record.producer={...record.producer,head_sha:T,run_id:15,run_attempt:1};assert.deepEqual(verifyPinnedCandidateBindings({...value,record}),value.record);assert.equal(JSON.parse(value.previewReceiptBytes).financial.evaluated_at,'2026-10-04T12:00:00Z');for(const change of [v=>v.record.captured_ui.sha=T,v=>v.record.protected_code_sha256='d'.repeat(64),v=>v.record.corrected_inventory_sha256='d'.repeat(64),v=>v.record.request_sha256='d'.repeat(64),v=>v.previewReceiptBytes=Buffer.from('{}'),v=>v.projectionBytes=Buffer.from('{}'),v=>v.originalRecordBytes=Buffer.from(v.originalRecordBytes+' ')]){const bad={...value,record:structuredClone(record)};change(bad);assert.throws(()=>verifyPinnedCandidateBindings(bad));}});
test('control-only commits preserve protected Git objects; evaluator changes invalidate equivalence',()=>{const root=temporary();try{const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();git('init','-q');git('config','user.name','fixture');git('config','user.email','fixture@example.test');for(const [path,bytes]of [['frontend/package-lock.json','{}'],['backend/app/scripts/export_native_annual_projection.py','# original']]){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),bytes);}git('add','.');git('commit','-qm','capture');const original=protectedCodeInventory(root,git('rev-parse','HEAD'));mkdirSync(join(root,'.github'));writeFileSync(join(root,policy.activation_candidate_path),JSON.stringify(pinnedCandidate().pin));git('add','.');git('commit','-qm','pin');assert.deepEqual(protectedCodeInventory(root,git('rev-parse','HEAD')),original);writeFileSync(join(root,'backend/app/scripts/export_native_annual_projection.py'),'# changed');git('add','.');git('commit','-qm','changed projector');assert.notDeepEqual(protectedCodeInventory(root,git('rev-parse','HEAD')),original);}finally{rmSync(root,{recursive:true,force:true});}});
test('retained archive restoration preserves the exact corrected bytes and original record',()=>{const root=temporary();try{const value=pinnedCandidate(),input=join(root,'input'),out=join(root,'restored');mkdirSync(input);const files={'candidate.json':value.originalRecordBytes.toString(),'preview-receipt.json':value.previewReceiptBytes.toString(),'projection/native.json':value.projectionBytes.toString(),'corrected/index.html':'exact original UI','corrected/static-data/manifest.json':'{"evaluated_at":"2026-10-04T12:00:00Z"}'};execFileSync('python3',['-c',`import io,json,sys,tarfile,zipfile
b=io.BytesIO()
with tarfile.open(fileobj=b,mode='w') as t:
 for name,data in json.load(sys.stdin).items():
  raw=data.encode();m=tarfile.TarInfo(name);m.size=len(raw);t.addfile(m,io.BytesIO(raw))
with zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('candidate.tar',b.getvalue())`,join(input,'artifact.zip')],{input:JSON.stringify(files)});const zip=readFileSync(join(input,'artifact.zip'));value.artifact.digest='sha256:'+sha256(zip);value.artifact.size_in_bytes=zip.length;value.pin.artifact_sha256=sha256(zip);const record=restorePinnedCandidateArchive({pin:value.pin,evidence:value,directory:input,candidate:out});assert.deepEqual(record,value.record);for(const [path,bytes]of Object.entries(files))assert.equal(readFileSync(join(out,path),'utf8'),bytes);assert.deepEqual(readFileSync(join(out,'captured-candidate.json')),value.originalRecordBytes);assert.deepEqual(JSON.parse(readFileSync(join(out,'activation-candidate.json'))),value.pin);value.pin.artifact_sha256=H;assert.throws(()=>restorePinnedCandidateArchive({pin:value.pin,evidence:value,directory:input,candidate:join(root,'bad')}),/ZIP changed/);}finally{rmSync(root,{recursive:true,force:true});}});
function candidate(){
  const record={schema_version:'financial-release-candidate-v1',producer:{repository:'kusennjp1-ai/screener',workflow:policy.candidate_workflow,head_sha:S,run_id:5,run_attempt:2},captured_ui:{sha:S,tree:T,digest:H},request_sha256:H,preview_receipt_sha256:H,corrected_inventory_sha256:H,protected_code_sha256:H};
  const run={id:5,run_attempt:2,head_sha:S,path:policy.candidate_workflow,head_branch:'main',event:'push',status:'completed',conclusion:'success',run_started_at:'2026-10-04T12:00:00Z',repository:{full_name:'kusennjp1-ai/screener'},head_repository:{full_name:'kusennjp1-ai/screener'}};
  const job={id:7,run_id:5,run_attempt:2,head_sha:S,name:policy.candidate_job,status:'completed',conclusion:'success',started_at:'2026-10-04T12:01:00Z',completed_at:'2026-10-04T12:10:00Z',steps:policy.candidate_steps.map(name=>({name,conclusion:'success'}))};
  const artifact={id:9,name:'financial-release-candidate-5-2',digest:`sha256:${H}`,size_in_bytes:100,expired:false,created_at:'2026-10-04T12:09:00Z',expires_at:'2026-12-01T00:00:00Z',workflow_run:{id:5,head_sha:S}};
  const approval={type:'gates',sha:S,runs:[{id:4,attempt:1,path:'.github/workflows/ci.yml'},{id:5,attempt:2,path:policy.candidate_workflow}]};
  return {record,run,jobs:[job],artifact,approval,mainSha:S,now:Date.parse('2026-10-04T12:11:00Z')};
}
test('the enabled mechanism still holds activation without an exact candidate pin',async()=>{const f=certifiedSourceFixture(),root=temporary();try{assert.equal(policy.activation_enabled,true);assert.equal(readFinancialActivationCandidate(root),null);await assert.rejects(()=>selectActivationCandidate({root,request:request(f),live:{},api:()=>{throw Error('An absent pin must fail before remote reads');}}),/activation pin/);}finally{f.cleanup();rmSync(root,{recursive:true,force:true});}});
test('source certificate and destination are mandatory closed selections',()=>{const f=certifiedSourceFixture();try{const value=request(f);assert.deepEqual(parseFinancialReleaseRequest(value),value);for(const update of [v=>v.allow_equal_date=true,v=>delete v.source_validation,v=>v.destination_projection.policy='any',v=>v.correction.previous_publication_identity='latest']){const changed=structuredClone(value);update(changed);assert.throws(()=>parseFinancialReleaseRequest(changed));}}finally{f.cleanup();}});
test('absent request is ordinary behavior; malformed and broken linked requests fail closed',()=>{const root=temporary();try{assert.equal(readFinancialReleaseRequest(root),null);mkdirSync(join(root,'.github'));symlinkSync('/missing-financial-request',join(root,policy.request_path));assert.throws(()=>readFinancialReleaseRequest(root));rmSync(join(root,policy.request_path));writeFileSync(join(root,policy.request_path),'{}');assert.throws(()=>readFinancialReleaseRequest(root));}finally{rmSync(root,{recursive:true,force:true});}});
test('only the exact tested current-main Design artifact is a candidate',()=>{const value=candidate();assert.deepEqual(validateCandidateRecord(value.record),value.record);assert.equal(verifyCandidateAttempt(value).artifact_id,9);});
for(const [name,update]of Object.entries({
  'failed Design':v=>v.run.conclusion='failure','PR Design':v=>v.run.event='pull_request','wrong main':v=>v.mainSha=T,'wrong attempt':v=>v.run.run_attempt=3,
  'foreign repo':v=>v.run.head_repository.full_name='other/screener','skipped job':v=>v.jobs[0].conclusion='skipped','wrong job SHA':v=>v.jobs[0].head_sha=T,
  'wrong job run':v=>v.jobs[0].run_id=6,'missing measured step':v=>v.jobs[0].steps.pop(),'failed budget':v=>v.jobs[0].steps[1].conclusion='failure',
  'duplicate job':v=>v.jobs.push(v.jobs[0]),'old artifact':v=>v.artifact.created_at='2026-10-03T12:00:00Z','expired artifact':v=>v.artifact.expired=true,
  'bad expiry':v=>v.artifact.expires_at='invalid','wrong digest':v=>v.artifact.digest='missing','wrong artifact run':v=>v.artifact.workflow_run.id=99,
  'job before run':v=>v.run.run_started_at='2026-10-04T12:02:00Z','wrong approval':v=>v.approval.runs[1].attempt=1,
}))test(`candidate rejects ${name}`,()=>{const value=candidate();update(value);assert.throws(()=>verifyCandidateAttempt(value));});
test('candidate extraction rejects traversal, duplicate members and symbolic links',()=>{const root=temporary();try{for(const kind of ['path','duplicate','link']){const path=join(root,`${kind}.tar`);execFileSync('python3',['-c',`import io,tarfile,sys
with tarfile.open(sys.argv[1],'w') as t:
 m=tarfile.TarInfo('../outside' if sys.argv[2]=='path' else 'inside')
 if sys.argv[2]=='link':m.type=tarfile.SYMTYPE;m.linkname='/etc/passwd';t.addfile(m)
 else:
  m.size=1;t.addfile(m,io.BytesIO(b'x'))
  if sys.argv[2]=='duplicate':t.addfile(m,io.BytesIO(b'x'))
`,path,kind]);assert.throws(()=>extractCandidateTar(path,join(root,kind)));}}finally{rmSync(root,{recursive:true,force:true});}});
test('candidate full inventory includes every UI/data byte and refuses links',()=>{const root=temporary();try{writeFileSync(join(root,'index.html'),'ui');mkdirSync(join(root,'static-data'));writeFileSync(join(root,'static-data/manifest.json'),'{}');assert.equal(Object.keys(completeInventory(root)).length,2);symlinkSync('index.html',join(root,'linked'));assert.throws(()=>completeInventory(root));}finally{rmSync(root,{recursive:true,force:true});}});
function receiptBundle(){
  const f=certifiedSourceFixture(),root=temporary();mkdirSync(join(root,'static-data'));writeFileSync(join(root,'static-data/manifest.json'),'{}');
  const projection=JSON.stringify({receipt_inventory:[],financial_generation:H}),base=JSON.stringify({as_of_date:'2026-10-02',rows:[]});
  const lineage=sourceLineage({source:f.source,certificate:f.reference,sourceProjectionSha256:sha256(projection),receiptInventorySha256:digest([]),projectionPolicy:{id:'financial-correction-native-annual-v1',contract_sha256:H,projector_sha256:H}});
  const ref=verifyCandidateAttempt(candidate());
  const result=writeFinancialReleaseReceipt({dist:root,mode:'activation',previousIdentity:P,lineage,sourceProjectionBytes:projection,sourceBaseBytes:base,evaluationBytes:projection,generation:H,evaluatedAt:'2026-10-04T12:00:00Z',
    ui:{approved_sha:S,captured_sha:S,digest:H,approval:candidate().approval,checks:[...contract.required_ci_jobs,policy.candidate_job].map((name,index)=>({name,job_id:index+1,run_id:name===policy.candidate_job?5:4,run_attempt:name===policy.candidate_job?2:1,head_sha:S,workflow:`.github/workflows/${name===policy.candidate_job?'design-acceptance.yml':'ci.yml'}`}))},priceInput:{artifact_id:10,artifact_sha256:H,manifest_sha256:H,price_observations_sha256:H,known_price_dates_sha256:H},candidate:ref});
  return {root,result,lineage,cleanup(){f.cleanup();rmSync(root,{recursive:true,force:true});}};
}
test('activation receipt round-trips complete inventories and every original source asset',()=>{const f=receiptBundle();try{assert.deepEqual(verifyFinancialReleaseAssets(f.root,f.result.reference),f.result.receipt);const publication={financial_generation:H,financial_lineage_sha256:f.lineage.id,ui_sha:S,ui_digest:H,data_inventory_sha256:inventoryDigest(completeInventory(f.root))};assert.deepEqual(verifyFinancialReleaseAssets(f.root,f.result.reference,publication),f.result.receipt);writeFileSync(join(f.root,f.result.receipt.source_base.path),'changed');assert.throws(()=>verifyFinancialReleaseAssets(f.root,f.result.reference),/asset changed/);}finally{f.cleanup();}});
test('ordinary releases cannot erase or replace the active source lineage',()=>{const f=receiptBundle();try{const live={financialRelease:f.result.receipt};assertFinancialLineageContinuity(live,structuredClone(f.result.receipt));assert.throws(()=>assertFinancialLineageContinuity(live,null),/drop or replace/);const changed=structuredClone(f.result.receipt);changed.lineage_sha256=H;assert.throws(()=>assertFinancialLineageContinuity(live,changed));changed.lineage_sha256=f.lineage.id;changed.source_base.sha256=H;assert.throws(()=>assertFinancialLineageContinuity(live,changed));}finally{f.cleanup();}});
test('a carry receipt cannot claim new activation authority',()=>{const f=receiptBundle();try{const value=structuredClone(f.result.receipt);value.mode='carry';value.evaluation_projection.path=`static-data/financial-corrections/carry-projection-${value.evaluation_projection.sha256}.json`;assert.throws(()=>validateFinancialReleaseReceipt(value),/cannot claim/);}finally{f.cleanup();}});
test('active source restoration uses exact live immutable bytes without an expired Actions artifact',async()=>{const f=receiptBundle(),out=temporary();try{const live={financialRelease:f.result.receipt,receipt:{financial_release:f.result.reference,financial_lineage_sha256:f.lineage.id}};const calls=[];
  const fetcher=async(url,options)=>{calls.push(String(url));assert.equal(options.redirect,'error');const path=new URL(url).pathname.split('/screener/')[1];return{ok:true,arrayBuffer:async()=>readFileSync(join(f.root,path))};};
  await restorePublishedFinancialSource(live,out,fetcher);assert.equal(calls.length,3);assert.equal(readFileSync(join(out,f.result.receipt.source_projection.path),'utf8'),readFileSync(join(f.root,f.result.receipt.source_projection.path),'utf8'));
  await assert.rejects(()=>restorePublishedFinancialSource(live,out,async()=>({ok:true,arrayBuffer:async()=>Buffer.from('changed')})),/disagree/);
}finally{f.cleanup();rmSync(out,{recursive:true,force:true});}});
test('workflow measures corrected dist directly and seals only after both unchanged design checks',()=>{const text=readFileSync(new URL('../workflows/design-acceptance.yml',import.meta.url),'utf8');assert.match(text,/ln -s "\$FINANCIAL_CANDIDATE_DIR\/corrected" "\$source\/dist"/);assert.ok(text.indexOf('name: Seal the exact tested financial candidate')>text.indexOf('name: Require reviewed screenshots and four design scores of at least 8.0'));assert.match(text,/name: Seal the exact tested financial candidate\n\s+if: success\(\)/);assert.match(text,/permissions:\n  contents: read\n  actions: read/);});
test('financial receipt composition has read-only GitHub API authentication and no provider preparation',()=>{const text=readFileSync(new URL('../workflows/research-ui-release.yml',import.meta.url),'utf8');assert.match(text,/name: Preserve approved UI bytes or record verified new UI\n\s+if:.*\n\s+env:\n\s+GH_TOKEN: \$\{\{ github.token \}\}\n\s+run: node .github\/scripts\/select-release-source.mjs compose/);assert.match(text,/FINANCIAL_ACTIVATION: \$\{\{ steps.plan.outputs.activation \}\}/);assert.match(text,/\[ "\$FINANCIAL_ACTIVATION" != true \]/);});
