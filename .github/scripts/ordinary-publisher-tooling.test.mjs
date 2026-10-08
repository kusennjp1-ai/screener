import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmodSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ORDINARY_PUBLISHER_TOOLING as TOOL,ordinaryPublisherToolingEligible,validateOrdinaryPublisherToolingIdentity,validateOrdinaryPublisherToolingContext,
  verifyOrdinaryControllerCheckout,validateOrdinaryPreparation,ordinaryPublisherToolingPhase,validateOrdinaryPublisherToolingBinding,validateOrdinaryPublisherToolingReceipt,
  ordinaryPublisherToolingReceipt,ordinaryPublisherToolingBoundary} from './ordinary-publisher-tooling.mjs';
import {PUBLISHER_TOOLING,PUBLISHER_EXPORT_ARTIFACT,verifyPublisherToolingSourceFiles} from './retained-price-publisher-tooling.mjs';

const clone=v=>structuredClone(v),hash='a'.repeat(64),other='b'.repeat(64),head='c'.repeat(40),tree='d'.repeat(40),sourceHead='e'.repeat(40),sourceTree='f'.repeat(40);
const start=Date.parse('2026-10-08T19:00:00.000Z'),stamp=n=>new Date(start+n).toISOString(),digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const repository={id:1203919607,full_name:TOOL.repository};
function fixture(){
  const approval={type:'performance-exception-v2',sha:TOOL.base.sha};
  const previous='99/1/'+hash+'/'+other,financialRelease={lineage_sha256:other,financial_generation:hash,
    source_projection:{sha256:hash},source_base:{sha256:other}};
  const run=(id,path,sha,event)=>({id,run_attempt:1,head_sha:sha,head_branch:'main',path,workflow_id:path===TOOL.workflow.path?364666954:294257497,
    event,status:'completed',conclusion:'success',run_started_at:stamp(-10000),repository,head_repository:repository});
  const caller={...run(55,TOOL.workflow.path,sourceHead,'workflow_run'),status:'in_progress',conclusion:null};
  const sourceRun=run(77,'.github/workflows/static-site.yml',sourceHead,'schedule');
  const sourceJob={id:777,name:'combine-and-build',run_id:77,run_attempt:1,head_sha:sourceHead,status:'completed',conclusion:'success',
    started_at:stamp(-9000),completed_at:stamp(-1000),steps:['Build static frontend','Upload verified data export','Preserve dated export provenance for release selection']
      .map(name=>({name,status:'completed',conclusion:'success',started_at:stamp(-8000),completed_at:stamp(-2000)}))};
  const archive=(id,name,sha)=>({id,name,size_in_bytes:100,digest:'sha256:'+sha,expired:false,created_at:stamp(-2000),expires_at:stamp(86400000),
    workflow_run:{id:77,head_sha:sourceHead,head_branch:'main',repository_id:1203919607,head_repository_id:1203919607}});
  const source={runId:77,attempt:1,artifact:archive(31,'static-site-data-77-1',hash),companion:archive(32,'static-site-data-manifest-77-1',other),
    manifest:{markets:{US:{as_of_date:'2026-10-08'}}},manifestHash:hash,priceObservations:{US:{OWNED:'2026-10-08'}},priceObservationsDigest:other};
  const state={source,sourceSha:TOOL.base.sha,controllerSha:head,live:{identity:previous,uiSha:TOOL.base.sha,uiDigest:hash,approval,financialRelease,receipt:{financial_release:{sha256:hash}}},
    decision:{mode:'data'},carry:{projectionSha256:hash,targetBaseSha256:other,evaluatedAt:stamp(2000)}};
  const callerJob={steps:[{name:'Prepare independently verifiable book evidence',number:10,status:'completed',conclusion:'success',started_at:stamp(100),completed_at:stamp(900)}],id:555,name:'publish',run_id:55,run_attempt:1,head_sha:sourceHead,status:'in_progress',conclusion:null,started_at:stamp(0)};
  const execution={repository:TOOL.repository,repository_id:1203919607,ref:'refs/heads/main',event_name:'workflow_run',run_id:55,run_attempt:1,
    sha:sourceHead,release_sha:head,workflow_sha:sourceHead,workflow_ref:TOOL.repository+'/'+TOOL.workflow.path+'@refs/heads/main'};
  const context={execution,caller,callerCurrent:clone(caller),callerJob,controller:{head,tree},executingWorkflowBlob:TOOL.workflow.git_blob_sha,
    sourceRun,sourceCurrent:clone(sourceRun),sourceJob,source:clone(source),sourceTree,metadataSha256:hash,live:clone(state.live),decision:{publish:true,mode:'data'},sourceAdvance:true,now:start+5000};
  const compact=a=>({id:a.id,name:a.name,bytes:a.size_in_bytes,sha256:a.digest.slice(7),created_at:a.created_at,expires_at:a.expires_at});
  const authority={controller:{head,tree},caller:{run_id:55,run_attempt:1,head_sha:sourceHead,workflow_sha:sourceHead,workflow_git_blob_sha:TOOL.workflow.git_blob_sha,job:{id:555,started_at:stamp(0)}},
    source:{run_id:77,run_attempt:1,head_sha:sourceHead,tree:sourceTree,event:'schedule',job:{id:777,started_at:stamp(-9000),completed_at:stamp(-1000)},
      artifact:compact(source.artifact),companion:compact(source.companion),metadata_sha256:hash,manifest_sha256:hash,price_observations_sha256:other},
    predecessor:{identity:previous,ui_sha:TOOL.base.sha,ui_digest:hash,approval_sha256:digest(ordered(approval)),financial_release_sha256:hash,lineage_sha256:other,financial_generation:hash}};
  const preparation={input_data_digest:hash,prepared_at:stamp(1500),enrichment_step:{name:'Prepare independently verifiable book evidence',number:10,started_at:stamp(100),completed_at:stamp(900)}};
  const binding={schema_version:'ordinary-publisher-tooling-binding-v1',identity:TOOL,authority,restoration:{data_digest:hash,recorded_at:stamp(50)},preparation,
    carry:{projection_sha256:hash,target_base_sha256:other,baseline_data_digest:hash,evaluated_at:stamp(2000)},applied_at:stamp(3000)};
  const publication={run_id:55,run_attempt:1,controller_sha:head,data_source:{artifact_id:31,run_id:77,attempt:1},ui_sha:TOOL.base.sha,ui_digest:hash,approval,
    financial_release:{schema_version:'financial-release-receipt-v1',path:'static-data/financial-corrections/release-'+hash+'.json',sha256:hash},
    financial_generation:hash,financial_lineage_sha256:other};
  state.ordinaryPublisherTooling={phase:'composed',authority,restoration:binding.restoration,binding};
  state.financialPrepared={reference:publication.financial_release,receipt:{mode:'carry',financial_generation:hash,lineage_sha256:other,evaluation_projection:{sha256:hash},previous_publication_identity:previous}};
  return {state,context,binding,publication};
}
test('ordinary caller and current controller are independently bound',()=>{
  const f=fixture();assert.notEqual(f.context.caller.head_sha,f.state.controllerSha);validateOrdinaryPublisherToolingContext(f.state,f.context);
  validateOrdinaryPublisherToolingBinding(f.binding);ordinaryPublisherToolingReceipt(f.state,f.publication);
});
test('finite identity remains unchanged and ordinary role is separately explicit',()=>{
  validateOrdinaryPublisherToolingIdentity(clone(TOOL));assert.notEqual(TOOL.schema_version,PUBLISHER_TOOLING.schema_version);
  assert.notEqual(TOOL.amendment_id,PUBLISHER_TOOLING.amendment_id);assert.deepEqual(TOOL.files,PUBLISHER_TOOLING.files);
  assert.deepEqual(TOOL.base,PUBLISHER_TOOLING.base);assert.deepEqual(TOOL.amended,PUBLISHER_TOOLING.amended);assert.equal(TOOL.files.length,1);
  assert.equal(TOOL.role,'ordinary_publisher_carry_only');assert.equal(TOOL.source_compiler,'unchanged_authenticated_ordinary_source_workflow');
});
for(const [name,change]of [
  ['no carry',s=>{delete s.carry;}],['finite repair',s=>{s.source.repair={};}],['published fallback',s=>{s.source.receiptHash=hash;}],
  ['missing companion',s=>{delete s.source.companion;}],['different selected UI',s=>{s.sourceSha=head;}],['different approved UI',s=>{s.live.uiSha=head;}],
  ['UI release',s=>{s.decision.mode='ui';}],['correction',s=>{s.correction={};}],['activation',s=>{s.activation={};}],['renewal',s=>{s.renewal={};}],
  ['migration',s=>{s.decision.migration=true;}],
])test('inactive ordinary route excludes '+name,async()=>{
  const s=fixture().state;delete s.ordinaryPublisherTooling;change(s);const before=clone(s);
  assert.equal(ordinaryPublisherToolingEligible(s),false);assert.equal(await ordinaryPublisherToolingBoundary(s,'apply'),null);assert.deepEqual(s,before);
  s.ordinaryPublisherTooling={};await assert.rejects(()=>ordinaryPublisherToolingBoundary(s,'apply'),/Ineligible/);
});
for(const [name,change]of [
  ['wrong source pin',x=>{x.base.sha=head;}],['wrong base tree',x=>{x.base.tree=head;}],['wrong amended tree',x=>{x.amended.tree=head;}],
  ['wrong before blob',x=>{x.files[0].before.git_blob_sha=head;}],['wrong after blob',x=>{x.files[0].after.git_blob_sha=head;}],
  ['extra exporter file',x=>{x.files.push(clone(x.files[0]));}],['wrong executing workflow',x=>{x.workflow.git_blob_sha=head;}],
  ['generic override',x=>{x.override=true;}],
])test('ordinary immutable identity rejects '+name,()=>{const x=clone(TOOL);change(x);assert.throws(()=>validateOrdinaryPublisherToolingIdentity(x));});
for(const [name,change]of [
  ['blocked current gates',f=>{f.context.decision.publish=false;}],['changed controller',f=>{f.context.controller.head=sourceHead;}],
  ['wrong repository',f=>{f.context.execution.repository='attacker/repo';}],['wrong repository ID',f=>{f.context.execution.repository_id=1;}],
  ['other branch',f=>{f.context.execution.ref='refs/heads/preview';}],['other caller run',f=>{f.context.execution.run_id++;}],
  ['caller completed',f=>{f.context.caller.status='completed';f.context.callerCurrent.status='completed';}],
  ['caller current rerun',f=>{f.context.callerCurrent.run_attempt++;}],['caller current wrong repository',f=>{f.context.callerCurrent.repository={id:1,full_name:'attacker/repo'};}],['other caller event',f=>{f.context.caller.event='push';}],
  ['old executing YAML',f=>{f.context.executingWorkflowBlob=head;}],['wrong workflow ref',f=>{f.context.execution.workflow_ref+='-old';}],
  ['caller job changed',f=>{f.context.callerJob.run_id++;}],['future job start',f=>{f.context.callerJob.started_at=stamp(6000);}],
  ['existing job budget expired',f=>{f.context.now=start+360*60000;}],
  ['source current rerun',f=>{f.context.sourceCurrent.run_attempt++;}],['source current wrong repository',f=>{f.context.sourceCurrent.head_repository={id:1,full_name:'attacker/repo'};}],['source wrong event',f=>{f.context.sourceRun.event='workflow_run';f.context.sourceCurrent.event='workflow_run';}],
  ['source wrong workflow',f=>{f.context.sourceRun.workflow_id=1;f.context.sourceCurrent.workflow_id=1;}],
  ['source producer failed',f=>{f.context.sourceJob.conclusion='failure';}],['ambiguous producer step',f=>{f.context.sourceJob.steps.push(clone(f.context.sourceJob.steps[0]));}],
  ['source upload failed',f=>{f.context.sourceJob.steps[1].conclusion='failure';}],['source step future',f=>{f.context.sourceJob.steps[0].completed_at=stamp(6000);}],
  ['artifact wrong digest',f=>{f.context.source.artifact.digest='sha256:'+other;}],['companion wrong source',f=>{f.context.source.companion.workflow_run.id++;}],
  ['expired source',f=>{f.context.source.artifact.expired=true;}],['expired companion',f=>{f.context.source.companion.expires_at=stamp(4000);}],
  ['no actual data advance',f=>{f.context.sourceAdvance=false;}],['superseded live predecessor',f=>{f.context.live.identity='100/1/'+hash+'/'+other;}],
  ['changed approved UI bytes',f=>{f.context.live.uiDigest=other;}],['changed historical approval',f=>{f.context.live.approval.override=true;}],
  ['changed financial source',f=>{f.context.live.financialRelease.lineage_sha256=hash;}],['finite authority claim',f=>{f.state.publisherTooling={};}],
])test('fresh ordinary context rejects '+name,()=>{const f=fixture();change(f);assert.throws(()=>validateOrdinaryPublisherToolingContext(f.state,f.context));});
for(const [name,change]of [
  ['unknown binding field',b=>{b.clock=stamp(0);}],['wrong identity',b=>{b.identity=clone(PUBLISHER_TOOLING);}],
  ['wrong source name',b=>{b.authority.source.artifact.name+='-extra';}],['wrong companion name',b=>{b.authority.source.companion.name+='-extra';}],
  ['unbound metadata',b=>{b.authority.source.metadata_sha256='';}],['finite source event',b=>{b.authority.source.event='workflow_run';}],
  ['old executing YAML',b=>{b.authority.caller.workflow_git_blob_sha=head;}],['other UI authority',b=>{b.authority.predecessor.ui_sha=head;}],
  ['source expired at application',b=>{b.authority.source.artifact.expires_at=b.applied_at;}],
  ['restoration before actual caller',b=>{b.restoration.recorded_at=stamp(-1);}],['carry before actual restore',b=>{b.carry.evaluated_at=stamp(999);}],
  ['application before carry',b=>{b.applied_at=stamp(1999);}],['application outside original job bound',b=>{b.applied_at=stamp(360*60000);}],
  ['projection extra field',b=>{b.carry.override=true;}],
])test('ordinary binding rejects '+name,()=>{const b=clone(fixture().binding);change(b);assert.throws(()=>validateOrdinaryPublisherToolingBinding(b));});
test('ordinary phase order has fresh final rechecks and no borrowed browser phase',()=>{
  let phase='restored';for(const action of ['prepare','apply','build-before','build-after','compose','recheck'])phase=ordinaryPublisherToolingPhase(phase,action);
  assert.equal(phase,'rechecked');assert.equal(ordinaryPublisherToolingPhase(phase,'recheck'),'rechecked');
  for(const action of ['apply','build-before','compose','browser-before','browser-after'])assert.throws(()=>ordinaryPublisherToolingPhase('restored',action));
});
for(const [name,change]of [
  ['wrong final caller',f=>{f.publication.run_id++;}],['wrong final source',f=>{f.publication.data_source.artifact_id++;}],
  ['wrong final source attempt',f=>{f.publication.data_source.attempt++;}],['changed final UI sha',f=>{f.publication.ui_sha=head;}],
  ['changed final UI bytes',f=>{f.publication.ui_digest=other;}],['broadened historical approval',f=>{f.publication.approval.override=true;}],
  ['finite receipt mixed in',f=>{f.publication.publisher_tooling={};}],['changed financial lineage',f=>{f.publication.financial_lineage_sha256=hash;}],['changed actual carried generation',f=>{f.state.financialPrepared.receipt.financial_generation=other;}],['invalid final generation hash',f=>{f.publication.financial_generation='invalid';}],
  ['lost carried receipt',f=>{f.state.financialPrepared.receipt.mode='activation';}],['changed projection receipt',f=>{f.state.financialPrepared.receipt.evaluation_projection.sha256=other;}],
  ['wrong receipt predecessor',f=>{f.state.financialPrepared.receipt.previous_publication_identity='100/1/'+hash+'/'+other;}],
  ['receipt before composition',f=>{f.state.ordinaryPublisherTooling.phase='built';}],
])test('ordinary final receipt rejects '+name,()=>{const f=fixture();change(f);assert.throws(()=>ordinaryPublisherToolingReceipt(f.state,f.publication));});
test('ordinary preparation binds the actual authorized intervening enrichment output',()=>{
  const f=fixture();validateOrdinaryPreparation(f.binding.preparation,f.context.callerJob,false,start+5000);
  const workbench=clone(f.binding.preparation),job=clone(f.context.callerJob);workbench.enrichment_step.name='Prepare workbench using verified published evidence';job.steps[0].name=workbench.enrichment_step.name;
  validateOrdinaryPreparation(workbench,job,true,start+5000);
  for(const mutate of [x=>{x.steps[0].conclusion='failure';},x=>{x.steps.push(clone(x.steps[0]));},x=>{x.steps[0].completed_at=stamp(6000);}]){
    const changed=clone(f.context.callerJob);mutate(changed);assert.throws(()=>validateOrdinaryPreparation(f.binding.preparation,changed,false,start+5000));
  }
  assert.throws(()=>validateOrdinaryPreparation(f.binding.preparation,f.context.callerJob,true,start+5000));
});
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
test('reviewed original exporter and carry artifact keep exact byte identities',()=>{
  for(const [path,pin]of [[TOOL.files[0].path,TOOL.files[0].before],[PUBLISHER_EXPORT_ARTIFACT,TOOL.files[0].after]]){
    const bytes=readFileSync(join(root,path));assert.equal(bytes.length,pin.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.sha256);
    assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),pin.git_blob_sha);
  }
});
test('unchanged ordinary SEC importlib tests produce no executable Python cache',t=>{
  const dir=mkdtempSync(join(tmpdir(),'ordinary-sec-bytecode-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  for(const name of ['test_sec_financials.py','sec-financials.py'])copyFileSync(join(root,'frontend/tools',name),join(dir,name));
  const trace="import runpy,socket;socket.create_connection=lambda *a,**k:(_ for _ in ()).throw(AssertionError('Unexpected synthetic network'));runpy.run_path('test_sec_financials.py',run_name='__main__')";
  execFileSync('python3',['-c',trace],{cwd:dir,encoding:'utf8',timeout:30000,
    env:{PATH:process.env.PATH,PYTHONDONTWRITEBYTECODE:'1'}});
  assert.equal(existsSync(join(dir,'__pycache__')),false);
});
function disk(t,{controller=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'ordinary-tooling-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const write=(path,bytes)=>{const file=join(dir,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes);return file;};
  write('.gitignore','*.tmp\n.env*\nfrontend/.env*\nfrontend/public/static-data/\nfrontend/dist/\nfrontend/node_modules/\n');
  write(TOOL.files[0].path,readFileSync(join(root,TOOL.files[0].path)));
  write('frontend/src/static/current.js','export const current=true;\n');
  write('.github/scripts/ordinary-controller.mjs','export const authority=true;\n');
  write(TOOL.workflow.path,readFileSync(join(root,TOOL.workflow.path)));
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
  git('init','--quiet');git('add','.');git('-c','user.name=Ordinary tooling tests','-c','user.email=ordinary-tooling-test@example.invalid','commit','--quiet','-m','Synthetic source inventory');
  const files=git('ls-tree','-r','-z','HEAD').split('\0').filter(Boolean).map(line=>{const m=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);return {mode:m[1],sha:m[2],path:m[3]};});
  const head=git('rev-parse','HEAD').trim(),tree=git('rev-parse','HEAD^{tree}').trim();
  const verify=()=>controller?verifyOrdinaryControllerCheckout(dir,head,tree):verifyPublisherToolingSourceFiles(dir,files,{amended:true});
  if(!controller)copyFileSync(join(root,PUBLISHER_EXPORT_ARTIFACT),join(dir,TOOL.files[0].path));
  return {dir,write,git,verify};
}
test('real Git selected working-tree overlay retains original complete index',t=>{
  const d=disk(t);assert.equal(d.verify(),true);d.write('frontend/public/static-data/generated.json','{}');d.write('frontend/dist/app.js','built');d.write('frontend/node_modules/locked/index.js','locked');
  assert.equal(d.verify(),true);
});
for(const [name,change]of [
  ['extra tools file',d=>{d.write('frontend/tools/extra.mjs','extra');}],['ignored source file',d=>{d.write('frontend/tools/extra.tmp','extra');}],
  ['staged source file',d=>{d.write('frontend/src/extra.js','extra');d.git('add','frontend/src/extra.js');}],
  ['staged root prototype key',d=>{d.write('__proto__','extra');d.git('add','__proto__');}],
  ['staged ignored environment',d=>{d.write('.env.local','NODE_OPTIONS=hook');d.git('add','-f','.env.local');}],
  ['staged exporter overlay',d=>{d.git('add',TOOL.files[0].path);}],
  ['altered exporter bytes',d=>{d.write(TOOL.files[0].path,'wrong');}],
])test('real Git selected source rejects '+name,t=>{const d=disk(t);change(d);assert.throws(d.verify);});
test('real Git controller fingerprint accepts a clean caller source',t=>{const d=disk(t,{controller:true});assert.equal(d.verify(),true);});
for(const [name,change]of [
  ['modified imported controller',d=>{d.write('.github/scripts/ordinary-controller.mjs','changed');}],
  ['untracked controller',d=>{d.write('.github/scripts/unreviewed.mjs','changed');}],
  ['ignored controller',d=>{d.write('.github/scripts/unreviewed.tmp','changed');}],
  ['ignored environment',d=>{d.write('.env.local','NODE_OPTIONS=hook');}],
  ['staged prototype addition',d=>{d.write('__proto__','changed');d.git('add','__proto__');}],
  ['staged tracked controller with original working bytes',d=>{const path='.github/scripts/ordinary-controller.mjs',original=readFileSync(join(d.dir,path));d.write(path,'changed');d.git('add',path);d.write(path,original);}],
  ['staged mode with original working mode',d=>{d.git('update-index','--chmod=+x','.github/scripts/ordinary-controller.mjs');}],
  ['staged removal with original working bytes',d=>{d.git('rm','--cached','.github/scripts/ordinary-controller.mjs');}],
])test('real Git actual caller fingerprint rejects '+name,t=>{const d=disk(t,{controller:true});change(d);assert.throws(d.verify);});
function step(text,name){
  const marker='      - name: '+name+'\n',start=text.indexOf(marker);assert(start>=0,'Missing workflow step '+name);
  const end=text.indexOf('\n      - ',start+marker.length);return end<0?text.slice(start):text.slice(start,end);
}
test('actual workflow admits ordinary guards with existing step token and keeps build token-free',()=>{
  const workflow=readFileSync(join(root,TOOL.workflow.path),'utf8');
  assert.equal(createHash('sha1').update('blob '+Buffer.byteLength(workflow)+'\0').update(workflow).digest('hex'),TOOL.workflow.git_blob_sha);
  const before=step(workflow,'Verify ordinary publisher tooling before build'),after=step(workflow,'Verify ordinary publisher tooling after build'),build=step(workflow,'Build with daily selection export');
  const check=(body,command)=>{assert.match(body,/if: steps\.plan\.outputs\.ordinary_tooling == 'true'/);assert.match(body,/GH_TOKEN: \$\{\{ github\.token \}\}/);
    assert(body.includes('run: node .github/scripts/select-release-source.mjs '+command));assert.doesNotMatch(body,/continue-on-error|working-directory|EXTRA_TOKEN/);};
  check(before,'publisher-build-before');check(after,'publisher-build-after');
  assert(workflow.indexOf(before)<workflow.indexOf(build)&&workflow.indexOf(after)>workflow.indexOf(build)&&workflow.indexOf(after)<workflow.indexOf('      - name: Preserve approved UI bytes'));
  assert.doesNotMatch(build,/GH_TOKEN|publisher-build/);assert.match(build,/npm run build/);assert.match(build,/node tools\/check-data-quality\.mjs/);
  for(const name of ['Verify publisher tooling before finite build','Verify publisher tooling after finite build'])
    assert.match(step(workflow,name),/if: steps\.restore\.outputs\.offline_recovery_verified == 'true'/);
  assert.match(step(workflow,'Verify composed finite price browser and CSV surfaces'),/if: steps\.restore\.outputs\.offline_recovery_verified == 'true'/);
  for(const name of ['Prepare independently verifiable book evidence','Prepare workbench using verified published evidence'])assert.match(step(workflow,name),/PYTHONDONTWRITEBYTECODE: '1'/);
  const ci=readFileSync(join(root,'.github/workflows/ci.yml'),'utf8');assert(ci.includes('.github/scripts/ordinary-publisher-tooling.test.mjs'));
  for(const change of [body=>body.replace("== 'true'","!= 'true'"),body=>body.replace('GH_TOKEN:','WRONG_TOKEN:'),body=>body.replace('publisher-build-before','compose'),body=>body+'\n        continue-on-error: true'])
    assert.throws(()=>check(change(before),'publisher-build-before'));
});
test('selector calls actual ordinary restore/carry/build/compose/recheck and writes a distinct receipt',()=>{
  const code=readFileSync(join(root,'.github/scripts/select-release-source.mjs'),'utf8');
  for(const action of ['restore','prepare','apply','compose','recheck'])assert(code.includes("ordinaryPublisherToolingBoundary(")&&code.includes("'"+action+"'"));
  assert(code.includes('await ordinaryPublisherToolingBoundary(state,action)'));
  const preparation=code.split('async function prepareCarry() {')[1].split('async function carryAssessment(')[0];
  assert(preparation.indexOf("ordinaryPublisherToolingBoundary(state,'prepare')")<preparation.indexOf("['tools/export-research.mjs']"));
  assert(preparation.indexOf('await helper.loadFinancialGenerationCarry(')<preparation.indexOf("ordinaryPublisherToolingBoundary(state,'apply')"));
  assert(code.includes('receipt.ordinary_publisher_tooling=ordinaryPublisherToolingReceipt(state,receipt)'));
  assert(code.includes('priceObservationsDigest: metadata.price_observations_sha256,companion'));
  const authority=readFileSync(join(root,'.github/scripts/ordinary-publisher-tooling.mjs'),'utf8');
  assert(authority.includes('const checked=checkedExport(source[0],artifacts,repo,api,()=>metadata)'));
  assert(authority.includes('const metadata=loadExportManifest(companion[0],repo),metaRaw=regular('));
  assert(authority.includes('const caller=api(')&&authority.includes('callerCurrent=api(')&&authority.includes('sourceCurrent=api('));
  assert(authority.includes('sourceAdvance:')&&authority.includes('Date.now()'));
  assert.doesNotMatch(authority,/authenticateRepairSource|verifyRetainedRestoreBinding|readRepairRequest|inspectCase|NoData|no-cache/);
  assert(authority.includes('360*60000'));assert(authority.includes('verifyPublisherToolingCheckout(frontend,{amended:true})'));
});
