// Offline end-to-end fixture. UI, evidence, owner acceptance and GitHub identities
// are explicitly synthetic; this test grants no real publication authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,cpSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {lifecycleFixture,read,sourceTime} from './fixtures/financial-release-lifecycle.mjs';
import {bootstrap,sha256,inventoryDigest,uiInventory} from './publication-state.mjs';
import {dataInventory,contract} from './financial-correction.mjs';
import {completeFiles} from './limited-research-publisher.mjs';
import {frozenFinancial,LIMITED_APPROVAL_PATH,LIMITED_WORKFLOW,LIMITED_JOB} from './limited-research-approval.mjs';
import {canonicalPublication,removeCanonical,packPublication,previewPublication} from './static-transport-publication.mjs';
import {verifyFinancialReleaseAssets} from './financial-release-activation.mjs';
import {buildLimitedResearchAssessment} from '../../frontend/tools/limited-research-assessment.mjs';
import {FINANCIAL_DESIGN_CASES,financialDesignScreens} from '../../frontend/tools/financial-design-cases.mjs';
import {LIMITED_RESEARCH_PREVIEW_NOTICE} from '../../frontend/src/static/limitedResearchPreview.js';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url)),frontend=join(repoRoot,'frontend');
const publisher=join(repoRoot,'.github/scripts/limited-research-publisher.mjs');
const currentSha='d'.repeat(40),tree='e'.repeat(40),H='a'.repeat(64),scope='limited-research-preview-v1';
const now='2026-10-16T15:00:00.000Z',prefix=`repos/${bootstrap.repository}`;
const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
const content=bytes=>({type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1EAAAAASUVORK5CYII=','base64');

function syntheticEvidence(live,bundle){
  const screens=[];
  for(const [width,theme]of [[1440,'dark'],[390,'light']])for(const name of financialDesignScreens({width},theme)){
    const screenshot=`synthetic-${screens.length}.png`;write(join(bundle,'evidence/screenshots',screenshot),png);
    screens.push({key:`${name}/${width}/${theme}`,sha256:sha256(png),screenshot});
  }
  const failures=['1440: P1 exact limits not met (3500ms / 400ms / 200ms)'];
  const report={assessment_mode:scope,commit:currentSha,measured_at:'2026-10-16T14:15:00.000Z',data:{as_of_date:live.manifest.markets.US.as_of_date,research_generation:live.manifest.research_generation},screens,failures,
    performance:[{label:'current',viewport:{width:1440},runs:Array.from({length:3},()=>({candidate_ms:3000,method_switch_ms:450,longest_initial_task_ms:100})),candidate_median_ms:3000,maximum_switch_ms:450,longest_initial_task_ms:100}],
    financial_cases:FINANCIAL_DESIGN_CASES.flatMap(item=>[[1440,'dark'],[390,'light']].map(([width,theme])=>({...item,viewport:{width},theme,
      csv:{synthetic:true},selection:{synthetic:true},purchase:{synthetic:true},financial_rows:[{synthetic:true}],financial_evaluated_at:sourceTime,
      as_of_date:live.manifest.markets.US.as_of_date,research_generation:live.manifest.research_generation,
      source:{unknown:1,qualified:false,original_category:{category:item.category,status:'unavailable',reason:'Synthetic fixture only; no real financial screenshot or review authority'}}}))),
  };
  const assessment=buildLimitedResearchAssessment(report,failures);assert.deepEqual(assessment.blocking_failures,[]);
  const assessmentBytes=JSON.stringify(assessment),screenshotsBytes=JSON.stringify(Object.fromEntries(screens.map(s=>[s.key,s.sha256])));
  const reviewBytes=JSON.stringify({schema_version:'limited-research-review-v1',scope_id:scope,ui_sha:currentSha,assessment_sha256:sha256(assessmentBytes),reviewer:'SYNTHETIC TEST REVIEWER',
    screens:screens.map(s=>({key:s.key,screenshot_sha256:s.sha256,scores:Object.fromEntries(['design','usability','originality','content'].map(k=>[k,{value:8,reason:'Synthetic test fixture only'}]))}))});
  write(join(bundle,'evidence/report.json'),report);write(join(bundle,'evidence/assessment.json'),assessmentBytes);
  write(join(bundle,'evidence/screenshots.json'),screenshotsBytes);write(join(bundle,'evidence/notice.txt'),LIMITED_RESEARCH_PREVIEW_NOTICE);
  return {assessmentBytes,screenshotsBytes,reviewBytes,failures};
}

async function fixture(){
  const base=lifecycleFixture({packedTransport:true});
  try{
    base.seed();base.setTime(now);
    const liveModule=join(repoRoot,'.github/scripts/publication-state.mjs');
    const livePath=join(base.root,'initial-live.json');
    base.success(base.invoke('--input-type=module',['-e',`import {writeFileSync} from 'node:fs';import {livePublication} from ${JSON.stringify(liveModule)};writeFileSync(${JSON.stringify(livePath)},JSON.stringify(await livePublication()));`],base.root),'read packed seed');
    const live=read(livePath);
    const bundle=join(base.root,'synthetic-capture'),dist=join(bundle,'dist'),frozen=join(base.root,'original-frozen');mkdirSync(bundle);
    const logical=await canonicalPublication({root:base.liveRoot,frontendRoot:frontend,publication:live.receipt,restore:join(base.root,'original-logical')});
    try{cpSync(logical,dist,{recursive:true});mkdirSync(frozen);for(const path of Object.keys(dataInventory(logical))){mkdirSync(dirname(join(frozen,path)),{recursive:true});cpSync(join(logical,path),join(frozen,path));}}
    finally{removeCanonical(base.liveRoot,logical);}
    rmSync(join(dist,'publication.json'));write(join(dist,'index.html'),`<!doctype html><title>Synthetic limited preview</title><p>${LIMITED_RESEARCH_PREVIEW_NOTICE}</p>`);
    const uiFiles=uiInventory(dist),uiDigest=inventoryDigest(uiFiles);
    const preview=previewPublication({uiSha:currentSha,uiDigest,manifestSha256:live.manifestHash});
    await packPublication({root:dist,frontendRoot:frontend,publication:preview,bindings:{sourceCommit:currentSha,appCommit:currentSha,candidateId:H,financialGeneration:live.financialRelease.financial_generation,financialLineageSha256:live.financialRelease.lineage_sha256}});
    const evidence=syntheticEvidence(live,bundle);write(join(bundle,'evidence/predecessor-publication.json'),readFileSync(join(base.liveRoot,'publication.json')));
    write(join(bundle,'evidence/frozen-inventory.json'),dataInventory(frozen));
    const approval={schema_version:'limited-research-approval-v1',scope_id:scope,status:'approved',created_at:'2026-10-16T14:00:00.000Z',expires_at:'2026-10-16T16:00:00.000Z',controller_sha:currentSha,
      ui:{sha:currentSha,inventory_sha256:uiDigest},predecessor:{identity:live.identity,receipt_sha256:live.receiptHash},
      data:{manifest_sha256:live.manifestHash,logical_inventory_sha256:live.receipt.data_inventory_sha256,financial_lineage_sha256:live.financialRelease.lineage_sha256},
      evidence:{ci:{id:51,attempt:1},assessment_run:{id:52,attempt:1},assessment_sha256:sha256(evidence.assessmentBytes),review_sha256:sha256(evidence.reviewBytes),screenshots_sha256:sha256(evidence.screenshotsBytes),notice_sha256:sha256(LIMITED_RESEARCH_PREVIEW_NOTICE)},
      accepted_performance_failures:evidence.failures,owner_acceptance:{reference:'SYNTHETIC TEST OWNER ACCEPTANCE, NOT REAL AUTHORITY',accepted_at:'2026-10-16T14:30:00.000Z'}};
    const capture={schema_version:'limited-research-capture-v1',scope_id:scope,publication_authority:'none',ui_sha:currentSha,controller_sha:currentSha,
      assessment_run:approval.evidence.assessment_run,captured_at:'2026-10-16T14:20:00.000Z',baseline_sha:live.uiSha,predecessor:approval.predecessor,source:{synthetic:true},data:approval.data,ui:approval.ui,
      evidence:{report_sha256:sha256(readFileSync(join(bundle,'evidence/report.json'))),assessment_sha256:approval.evidence.assessment_sha256,screenshots_sha256:approval.evidence.screenshots_sha256,notice_sha256:approval.evidence.notice_sha256},measurement_exit_code:1,files:completeFiles(bundle)};
    write(join(bundle,'capture.json'),capture);
    const tar=join(base.root,'capture.tar'),zip=join(base.root,'capture.zip');execFileSync('tar',['--format=posix','-cf',tar,'-C',bundle,'.']);
    execFileSync('python3',['-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:z.write(sys.argv[2],"bundle.tar")',zip,tar]);
    const artifact={id:300,name:'limited-research-preview-52-1',digest:`sha256:${sha256(readFileSync(zip))}`,expired:false,size_in_bytes:readFileSync(zip).length,
      workflow_run:{id:52,head_sha:currentSha,head_branch:'main'},created_at:'2026-10-16T14:20:00.000Z',expires_at:'2026-10-17T14:20:00.000Z'};
    const control={schema_version:'limited-research-release-control-v1',approval,capture:{run_id:52,run_attempt:1,job_id:520,artifact_id:artifact.id,artifact_name:artifact.name,artifact_sha256:artifact.digest.slice(7),capture_sha256:sha256(readFileSync(join(bundle,'capture.json')))},
      financial:frozenFinancial(live),assessment:evidence.assessmentBytes,review:evidence.reviewBytes,screenshots:evidence.screenshotsBytes,notice:LIMITED_RESEARCH_PREVIEW_NOTICE};
    const controlPath=join(base.root,LIMITED_APPROVAL_PATH);write(controlPath,control);
    const api=base.config.api;api[`${prefix}/git/ref/heads/main`]={object:{sha:currentSha}};
    api[`${prefix}/git/commits/${currentSha}`]={sha:currentSha,tree:{sha:tree}};
    api[`${prefix}/git/trees/${tree}?recursive=1`]={sha:tree,truncated:false,tree:['frontend/package-lock.json','backend/app/scripts/export_native_annual_projection.py'].map(path=>({path,type:'blob',mode:'100644',sha:'f'.repeat(40)}))};
    api[`${prefix}/contents/${LIMITED_APPROVAL_PATH}?ref=${currentSha}`]=content(readFileSync(controlPath));
    for(const [id,path,event,names]of [[51,'.github/workflows/ci.yml','push',contract.required_ci_jobs],[52,LIMITED_WORKFLOW,'workflow_dispatch',[LIMITED_JOB]]]){
      api[`${prefix}/actions/runs/${id}/attempts/1`]={id,run_attempt:1,path,event,head_sha:currentSha,head_branch:'main',status:'completed',conclusion:'success',repository:{full_name:bootstrap.repository},head_repository:{full_name:bootstrap.repository}};
      api[`${prefix}/actions/runs/${id}/attempts/1/jobs?per_page=100`]=[{jobs:names.map((name,index)=>({id:id*10+index,name,run_id:id,run_attempt:1,head_sha:currentSha,status:'completed',conclusion:'success',started_at:'2026-10-16T14:00:00.000Z',completed_at:'2026-10-16T14:25:00.000Z'}))}];
    }
    const publisherRun={id:60,run_attempt:1,path:'.github/workflows/research-ui-release.yml',event:'workflow_dispatch',head_sha:currentSha,head_branch:'main',status:'in_progress',conclusion:null,repository:{full_name:bootstrap.repository},head_repository:{full_name:bootstrap.repository}};
    api[`${prefix}/actions/runs/60/attempts/1`]=publisherRun;api[`${prefix}/actions/runs/60`]=publisherRun;
    api[`${prefix}/actions/artifacts/300`]=artifact;base.config.zips[`${prefix}/actions/artifacts/300/zip`]=zip;
    const bin=join(base.root,'bin');write(join(bin,'git'),`#!${process.execPath}\nconst a=process.argv.slice(2);if(a.join(' ')==='rev-parse HEAD')console.log(${JSON.stringify(currentSha)});else if(a.join(' ')==='status --porcelain --untracked-files=no'){}else throw Error('Unexpected synthetic git invocation '+a.join(' '));\n`);chmodSync(join(bin,'git'),0o755);
    const releaseFrontend=join(base.root,'release/frontend');mkdirSync(releaseFrontend,{recursive:true});for(const name of ['src','tools','package.json'])symlinkSync(join(frontend,name),join(releaseFrontend,name));
    mkdirSync(join(base.root,'.github/scripts'),{recursive:true});cpSync(join(repoRoot,'.github/scripts/check-pages-payload.py'),join(base.root,'.github/scripts/check-pages-payload.py'));
    const statePath=join(base.root,'limited-state.json'),event={ref:'refs/heads/main',inputs:{limited_research_preview:LIMITED_APPROVAL_PATH}};
    function command(name,{allowFailure=false}={}){
      const code=`import {readFileSync,writeFileSync} from 'node:fs';import {planLimited,restoreLimited,composeLimited,recheckLimited,verifyLimitedCapture} from ${JSON.stringify(publisher)};\nlet state;const path=${JSON.stringify(statePath)};\n`+
        (name==='plan'?`state=await planLimited({event:${JSON.stringify(event)},mainSha:${JSON.stringify(currentSha)}});`:`state=JSON.parse(readFileSync(path));await ${name==='restore'?'restoreLimited(state)':name==='compose'?'composeLimited(state)':name==='capture'?'verifyLimitedCapture(state,state.limited.captureRoot)':'recheckLimited(state)'};`)+`writeFileSync(path,JSON.stringify(state));console.log('verified '+${JSON.stringify(name)});`;
      const result=base.invoke('--input-type=module',['-e',code],base.root,{GITHUB_RUN_ID:'60',GITHUB_RUN_ATTEMPT:'1',GITHUB_REF:'refs/heads/main',GITHUB_SHA:currentSha,GITHUB_WORKFLOW_SHA:currentSha,GITHUB_WORKFLOW_REF:`${bootstrap.repository}/.github/workflows/research-ui-release.yml@refs/heads/main`});
      return allowFailure?result:base.success(result,`limited ${name}`);
    }
    return {...base,live,bundle,frozen,uiFiles,control,controlPath,statePath,artifact,dist:join(releaseFrontend,'dist'),command,state:()=>read(statePath),get liveRoot(){return base.liveRoot;}};
  }catch(error){base.cleanup();throw error;}
}
function fails(result,pattern){assert.ifError(result.error);assert.equal(result.status,1,`${result.stdout}\n${result.stderr}`);assert.match(result.stderr,pattern);}
function withFile(path,mutate,check){const bytes=readFileSync(path);try{writeFileSync(path,mutate(bytes));return check();}finally{writeFileSync(path,bytes);}}
function withState(f,mutate,check){return withFile(f.statePath,bytes=>{const state=JSON.parse(bytes);mutate(state);return JSON.stringify(state);},check);}

test('offline packed limited capture restores, composes and rechecks only its frozen original data',{timeout:240000},async()=>{
  const f=await fixture();try{
    const originalAudit=read(join(f.frozen,'qualification-audit.json')).results[0].audit;
    assert.equal(originalAudit.valid,true);assert.equal(originalAudit.status,'verified');
    assert.equal(originalAudit.version,'ohlcv-v2-session-calendar');
    assert.equal(originalAudit.bars,260);
    assert.ok(originalAudit.window_52w.observations>=250);
    f.command('plan');assert.equal(f.state().decision.mode,'limited');
    f.command('restore');assert.deepEqual(dataInventory(f.dist),dataInventory(f.frozen));assert.deepEqual(uiInventory(f.dist),f.uiFiles);
    assert.deepEqual(dataInventory(join(f.root,'release/frontend/public')),dataInventory(f.frozen),'existing data-quality checks read the same frozen public data');
    const restoredState=f.state(),captureRoot=restoredState.limited.captureRoot;
    withFile(join(f.dist,'static-data/manifest.json'),bytes=>Buffer.concat([bytes,Buffer.from(' ')]),()=>fails(f.command('compose',{allowFailure:true}),/restored frozen data/));
    withFile(join(f.dist,'index.html'),bytes=>Buffer.concat([bytes,Buffer.from(' changed')]),()=>fails(f.command('compose',{allowFailure:true}),/captured UI changed/));
    withFile(join(f.dist,f.live.financialRelease.source_projection.path),bytes=>Buffer.concat([bytes,Buffer.from(' ')]),()=>fails(f.command('compose',{allowFailure:true}),/restored frozen data/));
    withFile(join(captureRoot,'evidence/frozen-inventory.json'),bytes=>Buffer.concat([bytes,Buffer.from(' ')]),()=>fails(f.command('capture',{allowFailure:true}),/capture inventory/));
    withFile(join(captureRoot,'evidence/predecessor-publication.json'),bytes=>Buffer.concat([bytes,Buffer.from(' ')]),()=>fails(f.command('capture',{allowFailure:true}),/capture inventory|predecessor receipt/));
    f.command('compose');const state=f.state(),publication=read(join(f.dist,'publication.json'));
    assert.ok(publication.transport);assert.ok(publication.financial_audit_transport);assert.equal(publication.approval.type,scope);
    assert.deepEqual(publication.ui_files,f.uiFiles);assert.equal(publication.financial_generation,f.live.financialRelease.financial_generation);
    assert.equal(publication.financial_lineage_sha256,f.live.financialRelease.lineage_sha256);
    assert.deepEqual(publication.price_observations,f.live.receipt.price_observations);assert.deepEqual(publication.known_price_dates,f.live.receipt.known_price_dates);
    const logical=await canonicalPublication({root:f.dist,frontendRoot:frontend,publication,restore:join(f.root,'checked-final')});
    try{
      const financial=verifyFinancialReleaseAssets(logical,publication.financial_release,publication);
      assert.deepEqual(dataInventory(logical,state.limited.added),dataInventory(f.frozen));assert.deepEqual(uiInventory(logical),f.uiFiles);
      assert.deepEqual(financial.lineage,f.live.financialRelease.lineage);assert.deepEqual(financial.price_input,f.live.financialRelease.price_input);
      assert.equal(financial.evaluated_at,f.live.financialRelease.evaluated_at);assert.equal(financial.evaluation_projection.sha256,f.live.financialRelease.evaluation_projection.sha256);
      assert.equal(financial.financial_generation,f.live.financialRelease.financial_generation);assert.equal(financial.mode,'carry');assert.equal(financial.candidate,null);
      assert.equal(readFileSync(join(logical,financial.source_projection.path),'utf8'),f.original.bytes);assert.equal(readFileSync(join(logical,financial.source_base.path),'utf8'),f.original.base);
      assert.equal(readFileSync(join(logical,financial.evaluation_projection.path),'utf8'),f.original.bytes);
      assert.equal(state.limited.added.length,2);assert.ok(state.limited.added.every(path=>/^static-data\/financial-corrections\/(carry-projection|release)-[a-f0-9]{64}\.json$/.test(path)));
    }finally{removeCanonical(f.dist,logical);}
    f.command('recheck');
    withFile(f.controlPath,bytes=>Buffer.concat([bytes,Buffer.from(' ')]),()=>fails(f.command('recheck',{allowFailure:true}),/approval changed/));
    withState(f,state=>{state.decision.approval.financial.source_base.sha256=H;},()=>fails(f.command('recheck',{allowFailure:true}),/frozen source asset|final authority/));
    withState(f,state=>{state.limited.control.approval.predecessor.receipt_sha256=H;},()=>fails(f.command('recheck',{allowFailure:true}),/final committed control/));
    withFile(join(f.liveRoot,'publication.json'),bytes=>Buffer.concat([bytes,Buffer.from(' ')]),()=>fails(f.command('recheck',{allowFailure:true}),/predecessor changed/));
    withFile(join(f.dist,'index.html'),bytes=>Buffer.concat([bytes,Buffer.from(' changed')]),()=>fails(f.command('recheck',{allowFailure:true}),/inventory|UI|hash|bytes|Transport/));
    const shard=Object.keys(completeFiles(f.dist)).find(path=>path.startsWith('static-data/_transport/gzip/'));assert.ok(shard);
    withFile(join(f.dist,shard),bytes=>Buffer.concat([bytes,Buffer.from(' changed')]),()=>fails(f.command('recheck',{allowFailure:true}),/inventory|hash|bytes|size|gzip|Transport/));
    f.command('recheck');
    const calls=readFileSync(join(f.root,'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(calls.some(v=>v.api===`${prefix}/actions/artifacts/300/zip`));
    assert.ok(calls.every(v=>v.pages||v.api?.startsWith(prefix+'/')),'only closed synthetic GitHub/Pages transports used');
  }finally{f.cleanup();}
});
