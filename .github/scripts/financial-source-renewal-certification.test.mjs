import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,mkdtempSync,openSync,closeSync,ftruncateSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
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
