// Offline end-to-end archive lifecycle: the real publisher and archive CLIs,
// real packed Pages trees, and a GitHub Releases fake (fixtures/github-releases-fake.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {lifecycleFixture,read} from './fixtures/financial-release-lifecycle.mjs';
import {FAKE_WRITE_TOKEN,releasesFake} from './fixtures/github-releases-fake.mjs';
import {archiveLocation,financialAuditInventory,validateFinancialAuditArchive} from './financial-audit-history.mjs';
import {canonicalPublication} from './static-transport-publication.mjs';
import {verifyFinancialReleaseAssets} from './financial-release-activation.mjs';
import {dataInventory} from './financial-correction.mjs';
import {inventoryDigest} from './publication-state.mjs';

const here=dirname(fileURLToPath(import.meta.url)),archiveCli=join(here,'financial-audit-archive.mjs'),fakeModule=join(here,'fixtures/github-releases-fake.mjs');
const frontend=fileURLToPath(new URL('../../frontend',import.meta.url)),stateModule=join(here,'publication-state.mjs');
const carries=files=>Object.keys(files).filter(path=>/carry-projection-/.test(path)).sort();
// The renewal request actually committed in this checkout (it names a superseded publication).
const committedRequest=join(here,'../financial-source-renewal-request.json');
const day=(id,date,price)=>({id,date,price,time:`${date}T12:00:00.000Z`});

function archiveWorld({withCommittedRequest=false,...options}={}){
  const fakeDir=mkdtempSync(join(tmpdir(),'audit-archive-releases-')),fake=releasesFake(fakeDir);
  const fixture=lifecycleFixture({packedTransport:true,...options,env:{RELEASE_ARCHIVE_FAKE_DIR:fakeDir,RELEASE_ARCHIVE_FAKE_MODULE:fakeModule}});
  // Both CLIs read the request relative to their working directory, as in the workflows.
  const commitRequest=dir=>{if(withCommittedRequest&&existsSync(committedRequest)){mkdirSync(join(dir,'.github'),{recursive:true});copyFileSync(committedRequest,join(dir,'.github/financial-source-renewal-request.json'));}};
  commitRequest(fixture.root);
  const sync=()=>{for(const key of Object.keys(fixture.config.api))if(/\/releases\?per_page=100&page=\d+$/.test(key))delete fixture.config.api[key];Object.assign(fixture.config.api,fake.apiEntries());fixture.save();};
  const readDeployed=()=>JSON.parse(fixture.success(fixture.invoke('--input-type=module',['-e',`import {livePublication} from ${JSON.stringify(stateModule)}; console.log(JSON.stringify(await livePublication()));`],fixture.root),'read deployed receipt').stdout);
  // The archive workflow: anonymous collect and verify; only upload has a token.
  const archive=({expectFailure=false}={})=>{
    sync();commitRequest(fixture.root);const staged=join(fixture.root,`archive-staging-${Date.now()}`),results={};
    for(const [command,flag,token]of [['collect','--output',null],['verify-plan','--input',null],['upload','--input',FAKE_WRITE_TOKEN],['verify-public','--input',null]]){
      const result=fixture.invoke(archiveCli,[command,flag,staged],fixture.root,{GITHUB_SHA:'b'.repeat(40),GH_TOKEN:token??''});
      results[command]=result;
      if(result.status!==0){if(expectFailure)break;fixture.success(result,`archive ${command}`);}
    }
    sync();return {staged,results,plan:existsSync(join(staged,'plan.json'))?read(join(staged,'plan.json')):null};
  };
  const publish=(target,{admission=true,deploy=true,before=()=>{}}={})=>{
    const release=fixture.advance(target);sync();commitRequest(release.root);before(release);
    release.command('plan');assert.match(readFileSync(release.output,'utf8'),/carry=true\n/);
    if(admission)release.command('audit-archive');
    release.command('restore');release.command('prepare-carry');release.build();release.command('compose');
    release.command('recheck');release.command('recheck');
    if(deploy)release.deploy();
    return release;
  };
  return {fixture,fake,sync,archive,publish,readDeployed,cleanup(){fixture.cleanup();rmSync(fakeDir,{recursive:true,force:true});}};
}
async function logicalOf(release,publication){return canonicalPublication({root:release.dist,frontendRoot:frontend,publication,restore:join(release.root,`logical-${Date.now()}`)});}

test('C4 omits verified archived carries C1..C3, C5 restores only hosted files, and a lost archive copy fails closed',{timeout:900000},async()=>{
  const world=archiveWorld({withCommittedRequest:true}),{fixture,fake}=world;
  try{
    fixture.seed();
    assert.equal(existsSync(join(fixture.root,'.github/financial-source-renewal-request.json')),existsSync(committedRequest));
    const published=[];
    for(const target of [day(40,'2026-10-05',120),day(50,'2026-10-06',130),day(60,'2026-10-07',140)]){
      const release=world.publish(target);
      const publication=read(join(release.dist,'publication.json'));
      assert.equal(publication.financial_audit_archive,undefined,'without archived copies nothing changes');
      assert.equal(release.state().auditArchive.mode,'prune');assert.deepEqual(release.state().auditArchive.drops,{});
      published.push(publication);
    }
    const c3=published.at(-1),hosted3=carries(c3.financial_audit_files);
    // C3 is the live active carry: it is itself a candidate and must leave Pages in C4.
    const C3=world.readDeployed().financialRelease.evaluation_projection.path,[C1,C2]=hosted3.filter(path=>path!==C3);
    assert.ok(C1&&C2&&C3&&hosted3.length===3&&hosted3.includes(C3));
    const kept=[C1,C3].sort();
    // A pre-existing published copy of C2 that does not reproduce it: never modified, never trusted.
    const bad=archiveLocation(C2);fake.seed({tag:bad.tag,name:bad.asset,bytes:execFileSync('gzip',['-6','-n','-c'],{input:'not the carry'})});
    const first=world.archive({expectFailure:true});
    assert.equal(first.results.collect.status,0);
    assert.deepEqual(first.plan.entries.map(entry=>entry.path),kept);
    assert.deepEqual(first.plan.conflicts.map(entry=>entry.path),[C2]);
    for(const command of ['verify-plan','upload','verify-public'])assert.equal(first.results[command].status,0,command);
    assert.ok(fake.calls().filter(call=>!/api\.github\.com|uploads\.github\.com/.test(call.url)).every(call=>!call.auth),'every download is anonymous');
    // C4: C1 and the previously active C3 verify and leave Pages; the tampered C2 stays hosted.
    const c4=world.publish(day(70,'2026-10-08',150),{deploy:false});
    const state=c4.state(),publication=read(join(c4.dist,'publication.json'));
    assert.deepEqual(Object.keys(state.auditArchive.drops).sort(),kept);
    assert.deepEqual(state.auditArchive.removal,kept);
    const index=validateFinancialAuditArchive(publication.financial_audit_archive,publication);
    assert.deepEqual(Object.keys(index.files).sort(),kept);
    for(const path of [C1,C3]){
      assert.equal(Object.hasOwn(publication.financial_audit_files,path),false);
      assert.equal(index.files[path].removed_by.previous_publication_identity,state.live.identity);
      assert.equal(index.files[path].url,archiveLocation(path).url);
      for(const receipt of index.files[path].receipts)assert.ok(publication.financial_audit_files[receipt],receipt);
    }
    assert.ok(publication.financial_audit_files[C2],'an unverifiable copy keeps the carry hosted');
    const logical=await logicalOf(c4,publication);
    try{
      assert.deepEqual(financialAuditInventory(logical),publication.financial_audit_files);
      assert.equal(publication.data_inventory_sha256,inventoryDigest(dataInventory(logical)));
      const receipt=verifyFinancialReleaseAssets(logical,publication.financial_release,publication);
      assert.ok(publication.financial_audit_files[receipt.evaluation_projection.path],'the active carry stays hosted');
      for(const path of [C1,C3])assert.equal(existsSync(join(logical,path)),false);
    }finally{rmSync(logical,{recursive:true,force:true});}
    // Tampering with the composed index between the two rechecks is refused.
    const saved=readFileSync(join(c4.dist,'publication.json'));
    const changed=JSON.parse(saved);delete changed.financial_audit_archive.files[C1];writeFileSync(join(c4.dist,'publication.json'),JSON.stringify(changed));
    assert.notEqual(c4.command('recheck',{allowFailure:true}).status,0);
    writeFileSync(join(c4.dist,'publication.json'),saved);c4.command('recheck');c4.deploy();
    const live4=world.readDeployed();
    assert.deepEqual(Object.keys(live4.receipt.financial_audit_archive.files).sort(),kept);

    // C5 from an older publisher workflow (no admission step): the index is carried verbatim and verified.
    const c5=world.publish(day(80,'2026-10-09',160),{admission:false,deploy:false});
    const p5=read(join(c5.dist,'publication.json'));
    assert.deepEqual(p5.financial_audit_archive,live4.receipt.financial_audit_archive);
    assert.deepEqual(financialAuditInventory(c5.state().carry.sourceRoot),live4.receipt.financial_audit_files,'C5 restores exactly the hosted files');
    for(const path of [C1,C3])assert.equal(existsSync(join(c5.state().carry.sourceRoot,path)),false);
    c5.deploy();
    const live5=world.readDeployed();

    // An indexed archive copy that disappears blocks the next publication.
    fake.removeRelease(archiveLocation(C1).tag);world.sync();
    const c6=fixture.advance(day(90,'2026-10-12',170));world.sync();
    c6.command('plan');
    // The fixture's gh stub answers an unknown per-tag fallback read with an
    // error instead of HTTP 404; either way the indexed entry fails closed.
    const lost=/missing or still a draft|Unexpected fixture API read repos\/[^ ]+\/releases\/tags\/financial-audit-archive-/;
    const admission=c6.command('audit-archive',{allowFailure:true});
    assert.notEqual(admission.status,0);assert.match(admission.stderr,lost);
    c6.command('restore');c6.command('prepare-carry');c6.build();c6.command('compose');
    const recheck=c6.command('recheck',{allowFailure:true});
    assert.notEqual(recheck.status,0);assert.match(recheck.stderr,lost);
    assert.equal(world.readDeployed().identity,live5.identity,'Pages stays at the last good publication');
  }finally{world.cleanup();}
});

// Published input restores the live logical tree, including the archived carry;
// the sealed omission must survive the independent ordinary calendar replay.
test('a new gated UI on authenticated published input omits the archived carry and its calendar replay agrees',{timeout:600000},async t=>{
  if(!process.env.SESSION_CALENDAR_PYTHON){
    assert.ok(!process.env.GITHUB_ACTIONS,'CI runs this lifecycle with the offline session calendar runtime');
    t.skip('needs SESSION_CALENDAR_PYTHON (offline session calendar runtime)');return;
  }
  const world=archiveWorld({calendarCheckout:true,withoutSeedCalendar:true,retainPackedPublications:true}),{fixture}=world;
  try{
    fixture.seed();
    const time='2026-10-05T22:00:00.000Z';
    const c1=world.publish({id:40,date:'2026-10-05',price:120,time});
    const C1=read(join(c1.dist,'publication.json')).financial_release&&carries(read(join(c1.dist,'publication.json')).financial_audit_files)[0];
    assert.ok(C1);
    assert.deepEqual(world.archive().plan.entries.map(entry=>entry.path),[C1]);
    // Same-date export: nothing advances, so a new gated UI selects the published input.
    const release=fixture.advance({id:50,date:'2026-10-05',price:120,time:'2026-10-05T23:00:00.000Z'});world.sync();
    const checkout=dirname(release.frontend),git=args=>execFileSync('git',['-C',checkout,...args],{encoding:'utf8'}).trim();
    const prior=git(['rev-parse','HEAD']),tree=git(['rev-parse','HEAD^{tree}']);
    const revision=execFileSync('git',['-C',checkout,'commit-tree',tree,'-p',prior],{input:'Synthetic tested UI revision\n',encoding:'utf8',env:{...process.env,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@localhost',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@localhost'}}).trim();
    git(['reset','--soft',revision]);
    const prefix='repos/kusennjp1-ai/screener',api=fixture.config.api;api[`${prefix}/git/ref/heads/main`]={object:{sha:revision}};
    for(const [oldId,id,file]of [[10,12,'ci.yml'],[11,13,'design-acceptance.yml']]){
      const run={...api[`${prefix}/actions/runs/${oldId}/attempts/1`],id,head_sha:revision};
      api[`${prefix}/actions/runs/${id}/attempts/1`]=run;
      api[`${prefix}/actions/runs/${id}/attempts/1/jobs?per_page=100`]=api[`${prefix}/actions/runs/${oldId}/attempts/1/jobs?per_page=100`];
      api[`${prefix}/actions/workflows/${file}/runs?branch=main&event=push&head_sha=${revision}&per_page=100`]=[{workflow_runs:[run]}];
    }
    fixture.save();
    const command=name=>release.command(name,{env:{RELEASE_SHA:revision}});
    command('plan');assert.equal(release.state().decision.mode,'ui');assert.ok(release.state().source.receiptHash);
    command('audit-archive');assert.deepEqual(Object.keys(release.state().auditArchive.drops),[C1]);
    command('restore');
    const restored=release.state();
    assert.equal(restored.ordinaryCalendarSource.route,'published_input');
    assert.deepEqual(restored.auditArchive.removal,[C1]);
    assert.equal(existsSync(join(release.frontend,'public',C1)),false,'the published input copy of the archived carry is omitted');
    assert.ok(existsSync(join(restored.carry.sourceRoot,C1)),'the authenticated source root keeps every hosted file');
    command('prepare-carry');
    writeFileSync(join(release.frontend,'public/index.html'),'<!doctype html><title>New exact-gated synthetic UI</title>');
    writeFileSync(join(release.frontend,'public/sw.js'),'// new tested synthetic worker\n');
    writeFileSync(join(release.frontend,'public/static-transport-capability.json'),readFileSync(join(fixture.liveRoot,'static-transport-capability.json')));
    release.build();command('compose');command('recheck');command('recheck');
    const receipt=read(join(release.dist,'publication.json'));
    assert.equal(receipt.ui_sha,revision);assert.equal(receipt.ordinary_calendar_derivation.route,'published_input');
    assert.equal(Object.hasOwn(receipt.financial_audit_files,C1),false);
    assert.deepEqual(Object.keys(receipt.financial_audit_archive.files),[C1]);
    const logical=await logicalOf(release,receipt);
    try{assert.deepEqual(financialAuditInventory(logical),receipt.financial_audit_files);assert.equal(receipt.data_inventory_sha256,inventoryDigest(dataInventory(logical)));}
    finally{rmSync(logical,{recursive:true,force:true});}
  }finally{world.cleanup();}
});

test('this lifecycle runs in exact-main CI with the offline session calendar runtime',()=>{
  const ci=readFileSync(new URL('../workflows/ci.yml',import.meta.url),'utf8');
  assert.match(ci,/SESSION_CALENDAR_PYTHON="\$RUNNER_TEMP\/session-calendar-runtime\/bin\/python" node --test [^\n]*\.github\/scripts\/financial-audit-archive-lifecycle\.test\.mjs/);
});
