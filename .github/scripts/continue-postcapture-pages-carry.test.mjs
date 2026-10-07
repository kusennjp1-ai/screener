import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyCheckoutBytes,verifyFrozenRuntime} from './continue-postcapture-pages-carry.mjs';
import {pinnedCarryContinuation,requireStorageBudget} from './restore-postcapture-pages-rehearsal.mjs';

const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'carry-runtime-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  git(root,'init','-b','diagnostic');git(root,'config','user.name','Fixture');git(root,'config','user.email','fixture@example.invalid');
  mkdirSync(join(root,'src'));writeFileSync(join(root,'src/code.mjs'),'original executable bytes\n');
  writeFileSync(join(root,'.gitignore'),'node_modules/\n');git(root,'add','.');git(root,'commit','-m','Synthetic runtime');
  return root;
}
test('runtime byte verification permits only unchanged tracked bytes and ordinary ignored installed dependencies',t=>{
  const root=fixture(t),before=verifyCheckoutBytes(root);mkdirSync(join(root,'node_modules'));writeFileSync(join(root,'node_modules','dependency.js'),'locked dependency');
  assert.deepEqual(verifyCheckoutBytes(root),before);assert.equal(before.tracked_files,2);
  writeFileSync(join(root,'untracked.mjs'),'unreviewed code');assert.throws(()=>verifyCheckoutBytes(root),/must be clean/);
});
test('runtime hashes reject edits even when Git assume-unchanged hides their status',t=>{
  const root=fixture(t);git(root,'update-index','--assume-unchanged','src/code.mjs');writeFileSync(join(root,'src/code.mjs'),'altered executable bytes\n');
  assert.equal(git(root,'status','--porcelain'),'');assert.throws(()=>verifyCheckoutBytes(root),/executable bytes changed/);
});
test('runtime verifier rejects linked and changed-mode executable members',t=>{
  for(const edit of [path=>{chmodSync(path,0o755);},path=>{rmSync(path);symlinkSync('../.gitignore',path);}]) {
    const root=fixture(t);git(root,'update-index','--assume-unchanged','src/code.mjs');edit(join(root,'src/code.mjs'));
    assert.throws(()=>verifyCheckoutBytes(root),/must be clean|mode changed|not a regular file/);
  }
});
test('a clean substitute runtime cannot be relabeled as the literal checkpoint commit',async t=>{
  const root=fixture(t);await assert.rejects(verifyFrozenRuntime(root),/Literal checkpoint runtime commit changed/);
});
test('carry storage retains the existing 15.121 GB floor plus both checkpoint copies and measured runtime',()=>{
  const pin=pinnedCarryContinuation().checkpoint,retainedBytes=pin.zip_bytes+pin.expanded_bytes,R=5000;
  const budget={Z:431871840,P:693289931,L:2034508208,S:491394903,R,retainedBytes,availableBytes:15121266196+retainedBytes+R};
  const proof=requireStorageBudget(budget);assert.equal(proof.required_bytes,15944300632+R);
  assert.throws(()=>requireStorageBudget({...budget,availableBytes:proof.required_bytes-1}),/Insufficient rehearsal/);
  assert.throws(()=>requireStorageBudget({...budget,retainedBytes:-1}),/Invalid storage/);
});
test('workflow runs only carry from a separate literal runtime under the existing offline resource bounds',()=>{
  const path=new URL('../workflows/financial-postcapture-pages-carry.yml',import.meta.url);
  const workflow=JSON.parse(execFileSync(process.env.FINANCIAL_REPLAY_PYTHON||'python3',['-c','import json,sys,yaml;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))',path.pathname],{encoding:'utf8'}));
  assert.deepEqual(Object.keys(workflow.jobs),['carry']);assert.deepEqual(workflow.permissions,{contents:'read',actions:'read'});
  const job=workflow.jobs.carry;assert.equal(job['timeout-minutes'],110);assert.equal(job.needs,undefined);assert.match(job.if,/github.run_attempt == 1/);
  const checkouts=job.steps.filter(s=>s.uses==='actions/checkout@v4');assert.equal(checkouts.length,2);
  assert.equal(checkouts.find(s=>s.with.path==='runtime').with.ref,pinnedCarryContinuation().runtime.commit);
  assert.equal(checkouts.find(s=>s.with.path==='harness').with.ref,'${{ github.sha }}');
  const lifecycle=job.steps.find(s=>s.name==='Rehearse actual renewal carry without a network route');
  assert.equal(lifecycle['timeout-minutes'],96);assert.match(lifecycle.run,/recheck .*postcapture-pages-inputs/);
  assert.match(lifecycle.run,/sudo -n unshare --net/);assert.match(lifecycle.run,/env -i/);
  assert.match(lifecycle.run,/--stage carry/);assert.match(lifecycle.run,new RegExp(pinnedCarryContinuation().checkpoint.manifest_sha256));
  const isolated=lifecycle.run.slice(lifecycle.run.indexOf('env -i'));assert.doesNotMatch(isolated,/GH_TOKEN|GITHUB_TOKEN|NODE_OPTIONS|RENEWAL_FIXTURE_NOW/);
  assert.ok(job.steps.every(s=>!s.run||!s.run.includes('--stage seal')&&!s.run.includes('--stage publish')));
  assert.ok(job.steps.every(s=>!s.uses||!s.uses.includes('deploy-pages')));
  const runtime=readFileSync(new URL('./run-postcapture-pages-rehearsal.py',import.meta.url),'utf8');
  assert.match(runtime,/PROCESS_SECONDS = 95 \* 60/);assert.match(runtime,/JOB_SECONDS = 110 \* 60/);
  const fixture=readFileSync(new URL('./fixtures/postcapture-pages-rehearsal.mjs',import.meta.url),'utf8');
  assert.match(fixture,/timeout:20\*60\*1000,additionalBytes/);
});
