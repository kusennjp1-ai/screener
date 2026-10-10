// Tiny, offline exception carry integration fixture. All controller modules are
// copied verbatim; only the copied policy's pinned fixture identities change.
// GitHub/Pages transport, Git revisions/trees and the deployed activation seed
// are synthetic. This does not claim initial activation or screenshot approval.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {lifecycleFixture,read,sourceTime} from './financial-release-lifecycle.mjs';
import {contract,dataInventory,digest} from '../financial-correction.mjs';
import {bootstrap,inventoryDigest,sha256,uiInventory} from '../publication-state.mjs';

const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
const controllerSha='b'.repeat(40),capturedSha='d'.repeat(40),capturedTree='e'.repeat(40),controllerTree='f'.repeat(40);
const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(value));};
const gitBlob=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const content=bytes=>({type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')});

export async function performanceLifecycleFixture({packedTransport=false,exceptionVersion=1,approvedHarnessChanges=false}={}){
  if(![1,2].includes(exceptionVersion))throw Error('Unsupported fixture exception version');
  if(exceptionVersion===2&&!packedTransport)throw Error('Packed exception fixture requires packed transport');
  const codeRoot=mkdtempSync(join(tmpdir(),'financial-performance-controller-'));
  const fixture=lifecycleFixture({controllerPath:join(codeRoot,'.github/scripts/select-release-source.mjs')});
  try{
    // Reuse an established deployment seed. Its tiny projection is deliberately
    // not passed off as a production-certified activation or original capture.
    fixture.seed();
    for(const directory of ['.github/scripts','contracts'])cpSync(join(repoRoot,directory),join(codeRoot,directory),{recursive:true});
    symlinkSync(join(repoRoot,'frontend'),join(codeRoot,'frontend'));
    const publicationPath=join(fixture.liveRoot,'publication.json'),publication=read(publicationPath);
    const originalReceipt=read(join(fixture.liveRoot,publication.financial_release.path));
    if(packedTransport){
      cpSync(join(repoRoot,'frontend/public/static-transport-capability.json'),join(fixture.liveRoot,'static-transport-capability.json'));
      publication.ui_files=uiInventory(fixture.liveRoot);publication.ui_digest=inventoryDigest(publication.ui_files);
    }
    const legacyPolicyPath=join(codeRoot,'contracts/financial_performance_exception_v1.json'),legacyPolicy=read(legacyPolicyPath);
    // Explicit test-only before blobs for four paths already permitted by the
    // copied production v2 policy. The fixture does not extend that policy.
    const harnessPaths=approvedHarnessChanges?['frontend/src/static/staticPublication.test.js','frontend/tools/production-bootstrap-diagnostic.mjs',
      'frontend/tools/production-bootstrap-diagnostic.test.mjs','frontend/tools/publication-cli.test.mjs']:[];
    if(approvedHarnessChanges&&exceptionVersion!==2)throw Error('Reviewed harness fixture requires a v2 origin');
    const capturedUi={sha:capturedSha,tree:capturedTree,digest:publication.ui_digest};
    let policy;
    if(exceptionVersion===1){
      policy=legacyPolicy;policy.captured_ui=capturedUi;write(legacyPolicyPath,policy);
    }else{
      // An enabled policy exists only inside this disposable offline fixture.
      // These identities describe no real approval, capture, or artifact.
      const capture={...Object.fromEntries(['failures','budgets','design_steps'].map(key=>[key,legacyPolicy[key]])),
        captured_ui:capturedUi,capture_head_sha:'1'.repeat(40),capture_base_sha:'2'.repeat(40),ci_run_id:60,design_run_id:61,design_job_id:610,capture_attempt:1,
        diagnostic:{id:160,name:'unapproved-financial-diagnostic-61-1',sha256:sha256('synthetic packed diagnostic'),bytes:1},
        design_artifact:{id:161,name:`design-acceptance-${capturedSha}`,sha256:sha256('synthetic packed Design archive')},
        report_sha256:sha256('synthetic packed report'),review_sha256:sha256('synthetic packed review'),
        capture_ci_jobs:legacyPolicy.capture_ci_jobs.map((job,index)=>({...job,id:600+index})),
        activation_not_after:'2026-10-07T10:46:54.945Z',screenshot_keys:['synthetic-packed-desktop','synthetic-packed-mobile'],
        transport_sha256:sha256('synthetic packed preview transport')};
      write(join(codeRoot,'contracts/financial_performance_exception_v2.json'),{schema_version:'financial-performance-exception-policy-v2',enabled:true,capture});
      const policies=await import(pathToFileURL(join(codeRoot,'.github/scripts/financial-performance-policy.mjs')).href);
      policy=policies.exceptionPolicyForVersion(2);
    }

    // Describe all protected files in this fixture snapshot with their actual
    // Git blob hashes. The synthetic prior revision differs in one explicitly
    // allowed controller file; its comment has no runtime role. Trees and
    // commit IDs are test transport identities, not real repository claims.
    const releasePolicy=read(join(codeRoot,'contracts/financial_release_v1.json'));
    const paths=execFileSync('git',['-C',repoRoot,'ls-files','-z','--cached','--others','--exclude-standard','--',...releasePolicy.protected_prefixes],{encoding:'utf8',maxBuffer:32*1024*1024}).split('\0').filter(Boolean);
    const current={};
    for(const path of [...new Set(paths)].sort()){
      const local=existsSync(join(codeRoot,path))?join(codeRoot,path):join(repoRoot,path);
      if(!existsSync(local)||!statSync(local).isFile())continue;
      current[path]={mode:statSync(local).mode&0o111?'100755':'100644',sha:gitBlob(readFileSync(local))};
    }
    const changedPath='.github/scripts/publication-state.mjs',captured=structuredClone(current);
    captured[changedPath]={...current[changedPath],sha:gitBlob(Buffer.concat([Buffer.from('// Synthetic prior controller fixture.\n'),readFileSync(join(codeRoot,changedPath))]))};
    for(const path of harnessPaths)captured[path]={...current[path],sha:gitBlob(Buffer.concat([Buffer.from('// Synthetic prior reviewed harness.\n'),readFileSync(join(repoRoot,path))]))};
    const request={schema_version:'financial-release-request-v1',correction:{schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,
      previous_publication_identity:originalReceipt.previous_publication_identity,source:originalReceipt.lineage.source},
      source_validation:{guard:'certified_source_artifact_v1',certificate:originalReceipt.lineage.certificate},
      destination_projection:{projector:'native_annual_destination_v1',policy:'financial-correction-native-annual-v1'}};
    const approval={schema_version:`financial-performance-approval-v${exceptionVersion}`,scope:'one-captured-financial-repair',approved_at:'2026-10-04T11:00:00.000Z',activation_not_after:'2026-10-07T10:46:54.945Z',
      captured_ui:policy.captured_ui,request_sha256:digest(request),preview_receipt_sha256:sha256('synthetic preview receipt'),projection_sha256:sha256(fixture.original.bytes),report_sha256:policy.report_sha256,
      review:{path:'docs/design-review/synthetic-lifecycle-review.json',sha256:policy.review_sha256},failures:policy.failures,budgets:policy.budgets,
      ...(exceptionVersion===2?{transport_sha256:policy.transport_sha256}:{}),
      captured_code_sha256:digest(captured),controller_code_sha256:digest(current),controller_changes:Object.fromEntries([changedPath,...harnessPaths].map(path=>[path,{before:captured[path],after:current[path]}]))};
    const approvalBytes=Buffer.from(JSON.stringify(approval));
    const pin={schema_version:`financial-performance-candidate-pin-v${exceptionVersion}`,repository:bootstrap.repository,workflow:policy.workflow,head_sha:controllerSha,
      run_id:80,run_attempt:1,job_id:800,artifact_id:180,artifact_name:'financial-performance-candidate-80-1',artifact_sha256:sha256('synthetic expired certificate artifact'),
      candidate_record_sha256:sha256('synthetic sealed candidate'),projection_sha256:approval.projection_sha256,preview_receipt_sha256:approval.preview_receipt_sha256,approval_sha256:sha256(approvalBytes)};
    const ui={type:`performance-exception-v${exceptionVersion}`,sha:capturedSha,ui_digest:publication.ui_digest,controller_sha:controllerSha,approval_sha256:pin.approval_sha256,certificate:pin};
    const api=fixture.config.api,prefix=`repos/${bootstrap.repository}`;
    const register=(id,head,path,event,conclusion,jobs)=>{
      const run={id,run_attempt:1,head_sha:head,path,event,head_branch:event==='pull_request'?'synthetic-fixture':'main',status:'completed',conclusion,
        repository:{full_name:bootstrap.repository},head_repository:{full_name:bootstrap.repository}};
      api[`${prefix}/actions/runs/${id}/attempts/1`]=run;
      api[`${prefix}/actions/runs/${id}/attempts/1/jobs?per_page=100`]=[{jobs:jobs.map(job=>({run_id:id,run_attempt:1,head_sha:head,status:'completed',...job}))}];
      return run;
    };
    register(policy.ci_run_id,policy.capture_head_sha,'.github/workflows/ci.yml','pull_request','success',policy.capture_ci_jobs);
    register(policy.design_run_id,policy.capture_head_sha,'.github/workflows/design-acceptance.yml','pull_request','failure',[{id:policy.design_job_id,name:'Real-data design and performance budgets',conclusion:'failure',steps:structuredClone(policy.design_steps)}]);
    register(pin.run_id,controllerSha,policy.workflow,'workflow_run','success',[{id:pin.job_id,name:policy.job,conclusion:'success',steps:policy.steps.map(name=>({name,conclusion:'success'}))}]);
    const controllerRun=register(90,controllerSha,'.github/workflows/ci.yml','push','success',contract.required_ci_jobs.map((name,index)=>({id:900+index,name,conclusion:'success'})));
    api[`${prefix}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${controllerSha}&per_page=100`]=[{workflow_runs:[controllerRun]}];
    api[`${prefix}/git/commits/${capturedSha}`]={sha:capturedSha,tree:{sha:capturedTree},parents:[{sha:policy.capture_base_sha},{sha:policy.capture_head_sha}]};
    api[`${prefix}/git/commits/${controllerSha}`]={sha:controllerSha,tree:{sha:controllerTree}};
    for(const [tree,inventory]of [[capturedTree,captured],[controllerTree,current]])api[`${prefix}/git/trees/${tree}?recursive=1`]={sha:tree,truncated:false,tree:Object.entries(inventory).map(([path,entry])=>({path,type:'blob',...entry}))};
    const approvalEndpoint=`${prefix}/contents/${policy.approval_path}?ref=${controllerSha}`,requestEndpoint=`${prefix}/contents/${releasePolicy.request_path}?ref=${controllerSha}`;
    api[approvalEndpoint]=content(approvalBytes);api[requestEndpoint]=content(Buffer.from(JSON.stringify(request)));
    const stateModule=pathToFileURL(join(codeRoot,'.github/scripts/publication-state.mjs')).href;
    const activation=await import(pathToFileURL(join(codeRoot,'.github/scripts/financial-release-activation.mjs')).href);
    const exception=await import(pathToFileURL(join(codeRoot,'.github/scripts/financial-performance-exception.mjs')).href);
    activation.parseFinancialReleaseRequest(request);
    const verified=exception.verifyPerformanceUiApproval({ui_sha:capturedSha,ui_digest:publication.ui_digest,approval:ui},bootstrap.repository,endpoint=>api[endpoint]);
    rmSync(join(fixture.liveRoot,publication.financial_release.path));
    const prepared=activation.writeFinancialReleaseReceipt({dist:fixture.liveRoot,mode:'activation',previousIdentity:originalReceipt.previous_publication_identity,lineage:fixture.lineage,
      sourceProjectionBytes:fixture.original.bytes,sourceBaseBytes:fixture.original.base,evaluationBytes:fixture.original.bytes,generation:fixture.original.value.financial_generation,evaluatedAt:sourceTime,
      ui:{approved_sha:capturedSha,captured_sha:capturedSha,digest:publication.ui_digest,approval:ui,checks:verified.checks},priceInput:originalReceipt.price_input,
      candidate:{repository:pin.repository,workflow:pin.workflow,head_sha:pin.head_sha,run_id:pin.run_id,run_attempt:pin.run_attempt,job_id:pin.job_id,
        artifact_id:pin.artifact_id,artifact_name:pin.artifact_name,artifact_sha256:pin.artifact_sha256,candidate_receipt_sha256:pin.preview_receipt_sha256,record_sha256:pin.candidate_record_sha256}});
    Object.assign(publication,{ui_sha:capturedSha,approval:ui,financial_release:prepared.reference,data_inventory_sha256:inventoryDigest(dataInventory(fixture.liveRoot))});
    write(publicationPath,publication);
    if(packedTransport){
      // Pack only after replacing the synthetic seed's ordinary gate receipt,
      // so the transport binds the exact exception UI and financial audit.
      const {packPublication}=await import(pathToFileURL(join(codeRoot,'.github/scripts/static-transport-publication.mjs')).href);
      await packPublication({root:fixture.liveRoot,frontendRoot:join(repoRoot,'frontend'),publication,
        bindings:{sourceCommit:controllerSha,appCommit:capturedSha,candidateId:approval.preview_receipt_sha256}});
    }
    // The derived seed now has its final exception receipt and, when requested,
    // packed transport. Its retained archive must describe these exact bytes.
    fixture.recaptureSeedPublicationArtifact();
    return {...fixture,codeRoot,policy,approval,pin,request,ui,captured,current,activation,exception,approvalEndpoint,requestEndpoint,
      controllerRun,controllerJobs:api[`${prefix}/actions/runs/90/attempts/1/jobs?per_page=100`][0].jobs,
      get liveRoot(){return fixture.liveRoot;},
      readDeployed({allowFailure=false}={}){const result=fixture.invoke('--input-type=module',['-e',`import {livePublication} from ${JSON.stringify(stateModule)}; console.log(JSON.stringify(await livePublication()));`],fixture.root);return allowFailure?result:JSON.parse(fixture.success(result,'read deployed exception').stdout);},
      content,
      cleanup(){fixture.cleanup();rmSync(codeRoot,{recursive:true,force:true});}};
  }catch(error){fixture.cleanup();rmSync(codeRoot,{recursive:true,force:true});throw error;}
}
