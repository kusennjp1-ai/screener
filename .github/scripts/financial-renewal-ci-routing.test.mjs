import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {routeRenewalCiPublication} from './financial-renewal-ci-routing.mjs';
import {selectRenewalControls} from './financial-source-renewal-publisher.mjs';
import {publicationDecision} from './publication-gate.mjs';
import {sha256,bootstrap} from './publication-state.mjs';
import policy from '../../contracts/financial_source_renewal_v1.json' with {type:'json'};

const repo=bootstrap.repository,id=1203919607,workflow='.github/workflows/research-ui-release.yml';
const write=(root,path,value)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),JSON.stringify(value));};
function fixture(t,{admitted=true,incomplete=false,path='.github/workflows/design-acceptance.yml',conclusion='success'}={}){
  const root=mkdtempSync(join(tmpdir(),'renewal-ci-routing-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const values={request:{test:'parsed only by existing authority after routing'},pin:{test:'pin'},intent:{test:'intent'}};
  const controls={};for(const [key,value]of Object.entries(values))if(!incomplete||key==='request'){const path=policy[`${key}_path`];write(root,path,value);controls[key]=sha256(readFileSync(join(root,path)));}
  const registry={...policy,publication_enabled:admitted,ci_admission:admitted?{phase:'publish',reviewed_commit:'a'.repeat(40),reviewed_tree:'b'.repeat(40),controls:incomplete?{request:controls.request,pin:'c'.repeat(64),intent:'d'.repeat(64)}:controls}:null};
  write(root,'contracts/financial_source_renewal_v1.json',registry);
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','Synthetic routing controls');
  const head=git('rev-parse','HEAD'),repository={id,full_name:repo,default_branch:'main'};
  const source={id:10,run_attempt:1,workflow_id:111,head_sha:head,head_branch:'main',path,event:path.endsWith('static-site.yml')?'schedule':'push',
    status:'completed',conclusion,repository,head_repository:repository,created_at:'2026-10-06T12:00:00Z',run_started_at:'2026-10-06T12:00:01Z',updated_at:'2026-10-06T12:01:00Z'};
  const own={...source,id:20,workflow_id:222,path:workflow,event:'workflow_run',status:'in_progress',conclusion:null,created_at:'2026-10-06T12:01:01Z',run_started_at:'2026-10-06T12:01:02Z'};
  const event={action:'completed',repository,workflow_run:structuredClone(source)},execution={event_name:'workflow_run',repository:repo,repository_id:id,ref:'refs/heads/main',sha:head,workflow_ref:`${repo}/${workflow}@refs/heads/main`,workflow_sha:head,run_id:20,run_attempt:1};
  const responses=new Map([[`repos/${repo}`,repository],[`repos/${repo}/actions/runs/20/attempts/1`,own],[`repos/${repo}/actions/runs/10/attempts/1`,source],[`repos/${repo}/actions/runs/10`,structuredClone(source)]]),calls=[];
  const api=endpoint=>{calls.push(endpoint);assert.ok(responses.has(endpoint),`Unexpected routing endpoint ${endpoint}`);return structuredClone(responses.get(endpoint));};
  return {root,registry,head,event,execution,source,own,responses,calls,api,options:{root,event,execution,api}};
}

test('disabled or incomplete renewal keeps ordinary advancing-data admission without API work',t=>{
  for(const settings of [{admitted:false},{incomplete:true}]){
    const f=fixture(t,settings),result=routeRenewalCiPublication(f.options);assert.deepEqual(result,{renewal:false,ordinary_non_ci:false});assert.deepEqual(f.calls,[]);
    assert.equal(selectRenewalControls({root:f.root,event:{...f.event,workflow_run:{...f.source,path:'.github/workflows/ci.yml'}},eventName:'workflow_run',api:f.api}),null);
    const ordinary=publicationDecision({eventName:'workflow_run',event:f.event,sha:f.head,currentSha:f.head,runs:[]});assert.equal(ordinary.publish,true);assert.equal(ordinary.mode,'data');
  }
});
test('manual dispatch keeps its existing route without inspecting automatic control state',t=>{
  const f=fixture(t);assert.deepEqual(routeRenewalCiPublication({...f.options,execution:{event_name:'workflow_dispatch'}}),{renewal:false,ordinary_non_ci:false});assert.deepEqual(f.calls,[]);
});
test('eligible CI selects only the admission step; routing itself grants no publication authority',t=>{
  const f=fixture(t,{path:'.github/workflows/ci.yml'});assert.deepEqual(routeRenewalCiPublication(f.options),{renewal:true,ordinary_non_ci:false});assert.deepEqual(f.calls,[]);
});
for(const settings of [{},{conclusion:'failure'},{path:'.github/workflows/static-site.yml'}])test(`authenticated ${settings.path??'Design'} ${settings.conclusion??'success'} remains an ordinary publication`,t=>{
  const f=fixture(t,settings),result=routeRenewalCiPublication(f.options);
  assert.deepEqual(result,{renewal:false,ordinary_non_ci:true,source_run_id:10,source_run_attempt:1});assert.equal(f.calls.length,4);
  assert.equal(selectRenewalControls({root:f.root,event:f.event,eventName:'workflow_run',api:()=>{throw Error('Non-CI cannot admit renewal');}}),null);
  assert.equal(publicationDecision({eventName:'workflow_run',event:f.event,sha:f.head,currentSha:f.head,runs:[]}).publish,true);
});
test('stale ordinary completion remains ordinary without falsely issuing a same-head marker',t=>{
  const f=fixture(t);f.event.workflow_run.head_sha='e'.repeat(40);assert.deepEqual(routeRenewalCiPublication(f.options),{renewal:false,ordinary_non_ci:false});assert.deepEqual(f.calls,[]);
});
for(const [label,change]of [
  ['workflow source mismatch',f=>f.execution.workflow_sha='e'.repeat(40)],
  ['forked source',f=>f.event.workflow_run.head_repository={id:1,full_name:'fork/repo'}],
  ['pull request',f=>f.event.workflow_run.event='pull_request'],
  ['unrecognized workflow',f=>f.event.workflow_run.path='.github/workflows/other.yml'],
  ['rerun caller',f=>f.execution.run_attempt=2],
  ['stale source attempt',f=>f.responses.get(`repos/${repo}/actions/runs/10`).run_attempt=2],
  ['missing latest source',f=>f.responses.delete(`repos/${repo}/actions/runs/10`)],
  ['future source completion',f=>f.event.workflow_run.updated_at='2026-10-07T12:00:00Z'],
  ['own failed run',f=>f.own.status='completed'],
  ['bad repository identity',f=>f.execution.repository_id=7],
])test(`unprovable ${label} receives no marker and leaves ordinary authorization to its existing gate`,t=>{
  const f=fixture(t);change(f);assert.deepEqual(routeRenewalCiPublication(f.options),{renewal:false,ordinary_non_ci:false});
});
test('dormant control/hash or publication-flag drift cannot freeze Design or Static data updates',t=>{
  for(const path of ['.github/workflows/design-acceptance.yml','.github/workflows/static-site.yml'])for(const change of [
    f=>write(f.root,policy.request_path,{changed:'pending request'}),
    f=>write(f.root,'contracts/financial_source_renewal_v1.json',{...f.registry,publication_enabled:false}),
  ]){
    const f=fixture(t,{path});change(f);
    assert.deepEqual(routeRenewalCiPublication(f.options),{renewal:false,ordinary_non_ci:false});
    assert.equal(publicationDecision({eventName:'workflow_run',event:f.event,sha:f.head,currentSha:f.head,runs:[]}).publish,true);
    const ci={...f.event,workflow_run:{...f.source,path:'.github/workflows/ci.yml',event:'push'}};
    assert.throws(()=>routeRenewalCiPublication({...f.options,event:ci}),/flag|controls/,'actual CI admission stays fail-closed');
  }
});

test('workflow preserves ordinary triggers and serial lock, with a read-only router before the protected job',()=>{
  const source=readFileSync(new URL('../workflows/research-ui-release.yml',import.meta.url),'utf8');
  assert.match(source,/workflows: \[CI, Design Acceptance, Static Site\]/);
  assert.match(source,/concurrency:\n  group: research-ui-release\n  cancel-in-progress: false/);
  const router=source.split('  renewal_route:\n')[1].split('  publish:\n')[0];
  assert.match(router,/permissions:\n      contents: read\n      actions: read/);assert.doesNotMatch(router,/pages: write|id-token: write|environment:|secrets\./);
  assert.match(router,/Ordinary non-CI publication:/);assert.match(source,/needs: renewal_route/);
  assert.ok(source.indexOf('name: Admit exact successful main CI renewal')<source.indexOf('name: Install offline statement projection dependencies'));
  const audit=source.split('      - name: Retain automatic quota observations independently of publication\n')[1];
  assert.ok(audit);assert.match(audit,/continue-on-error: true/);
  assert.ok(source.indexOf('name: Deploy to GitHub Pages')<source.indexOf('name: Retain automatic quota observations independently of publication'));
  const certifier=readFileSync(new URL('../workflows/financial-source-renewal-certification.yml',import.meta.url),'utf8');
  const certificationAudit=certifier.split('      - name: Retain automatic quota observations independently of source proof\n')[1];
  assert.ok(certificationAudit);assert.match(certificationAudit,/continue-on-error: true/);assert.match(certificationAudit,/always\(\)/);
});
