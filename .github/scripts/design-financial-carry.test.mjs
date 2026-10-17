// Closed-contract and fail-closed tests only. These records are fixtures, never
// source admissions, publication evidence or a claim of a live Design pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync,symlinkSync,linkSync,renameSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DESIGN_CARRY_SCHEMA,assertDesignCarryState,validateDesignCarryPreview,verifyDesignCarryPreview,readDesignHistoryResponse,stageDesignReplayReferences,prepareDesignSessionCalendar} from './design-financial-carry.mjs';
import {bootstrap,validateReceipt} from './publication-state.mjs';
import {validateCandidateRecord,validateFinancialReleaseReceipt} from './financial-release-activation.mjs';
const H='a'.repeat(64),S='b'.repeat(40),identity=`1/1/${H}/${H}`;
const files=['state.json','attempt.json','source/artifact.zip','source/artifact.tar','companion/artifact.zip','companion/source.json','predecessor.json','history-responses.json','target-base.json','carry-projection.json','history-reconciliation.json','quality.log','retained-universe.json','assessment.json'];
function record(){return {schema:DESIGN_CARRY_SCHEMA,publication_authority:'none',financial_admission:false,ui_sha:S,ui_tree:S,baseline_sha:S,baseline_tree:S,source_financial_generation:H,financial_generation:H,financial_lineage_sha256:H,previous_publication_identity:identity,logical_data_inventory_sha256:H,timestamps:{prepared_at:'2026-10-14T12:00:00.000Z',verified_at:'2026-10-14T12:01:00.000Z'},caller:{repository:bootstrap.repository,run_id:3,run_attempt:1,event:'pull_request',head_sha:S,checkout_sha:S,started_at:'2026-10-14T11:59:00.000Z'},source:{artifact_id:1,run_id:2,run_attempt:1,head_sha:S,artifact_sha256:H,manifest_sha256:H},live:{identity,receipt_sha256:H,manifest_sha256:H,financial_generation:H,root_sha256:H},evidence:{files:Object.fromEntries(files.map(p=>[p,H])),source_input_sha256:H,predecessor_history_sha256:H,baseline_sha256:H,audit_inventory_sha256:H},assessment:{compatibility:H,equality:H,retained_universe:H}};}
function state(){return {decision:{mode:'design'},sourceSha:S,controllerSha:S,source:{artifact:{id:1,digest:`sha256:${H}`},runId:2,attempt:1,manifestHash:H},live:{identity,financialRelease:{financial_generation:H,lineage_sha256:H},receipt:{financial_release:{path:'retained'},financial_generation:H,financial_lineage_sha256:H}}};}
test('closed Design carry contract remains a no-authority fixture',()=>{assert.equal(validateDesignCarryPreview(record()).financial_admission,false);assert.equal(assertDesignCarryState(state(),S).decision.mode,'design');});
for(const [name,mutate]of Object.entries({
  'publication authority':r=>{r.publication_authority='publish';},'financial admission':r=>{r.financial_admission=true;},'unknown schema':r=>{r.schema='publication-v1';},'unknown top-level field':r=>{r.carry={};},'unknown source field':r=>{r.source.approved=true;},'missing ZIP hash':r=>{delete r.evidence.files['source/artifact.zip'];},'unbound extra audit path':r=>{r.evidence.files['extra.json']=H;},'altered evidence type':r=>{r.evidence.files['target-base.json']=true;},'future preparation':r=>{r.timestamps.prepared_at='2999-01-01T00:00:00.000Z';},'future verification':r=>{r.timestamps.verified_at='2999-01-01T00:00:00.000Z';},'reversed clock':r=>{r.timestamps.verified_at='2026-10-13T12:01:00.000Z';},'invalid clock':r=>{r.timestamps.prepared_at='not-a-time';},'extra clock':r=>{r.timestamps.now=0;},'missing original generation':r=>{r.source_financial_generation=null;},'missing derived generation':r=>{r.financial_generation=null;},'missing original lineage':r=>{r.financial_lineage_sha256=null;},'altered source attempt':r=>{r.source.run_attempt=0;},'invalid source SHA':r=>{r.source.head_sha='main';},'swapped predecessor':r=>{r.live.identity=`2/1/${H}/${H}`;},'missing predecessor root':r=>{r.live.root_sha256=null;},'unbound baseline':r=>{r.baseline_tree='main';},'unchecked quality':r=>{r.assessment.retained_universe=true;},'caller run':r=>{r.caller.run_id=0;},'caller checkout':r=>{r.caller.checkout_sha='c'.repeat(40);},'backdated preparation':r=>{r.timestamps.prepared_at='2026-10-14T11:00:00.000Z';},
}))test(`closed contract rejects ${name}`,()=>{const r=record();mutate(r);assert.throws(()=>validateDesignCarryPreview(r));});
for(const mode of ['activation','correction','renewal','carry','ordinaryCarryAdmission','ordinaryCarryTooling','publisherTooling','sourceRecovery'])test(`Design input excludes ${mode} even as a false/null marker`,()=>{for(const value of [null,false,{}]){const s=state();s[mode]=value;assert.throws(()=>assertDesignCarryState(s,S));}});
for(const [name,mutate]of Object.entries({'publisher mode':s=>{s.decision.mode='data';},'migration':s=>{s.decision.migration=true;},'finite repair':s=>{s.source.repair={};},'unapproved input generation':s=>{s.source.manifest={financial_generation:H};},'published input':s=>{s.source.receiptHash=H;},'different source checkout':s=>{s.sourceSha='c'.repeat(40);},'different controller checkout':s=>{s.controllerSha='c'.repeat(40);},'missing active source':s=>{delete s.live.financialRelease;},'missing active generation':s=>{delete s.live.financialRelease.financial_generation;delete s.live.receipt.financial_generation;},'changed active generation':s=>{s.live.receipt.financial_generation='c'.repeat(64);},'changed active lineage':s=>{s.live.receipt.financial_lineage_sha256='c'.repeat(64);}}))test(`Design input rejects ${name}`,()=>{const s=state();mutate(s);assert.throws(()=>assertDesignCarryState(s,S));});
test('publisher, activation and source-release validators reject the preview record',()=>{const r=record();for(const validator of [validateReceipt,validateCandidateRecord,validateFinancialReleaseReceipt])assert.throws(()=>validator(r));});
test('a well-shaped preview cannot be used without exact checkout and retained evidence',async t=>{
  const root=mkdtempSync(join(tmpdir(),'design-carry-contract-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const git=args=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();git(['init','-q']);writeFileSync(join(root,'fixture.txt'),'closed contract test');mkdirSync(join(root,'frontend/public'),{recursive:true});writeFileSync(join(root,'frontend/index.html'),'<title>pinned</title>');writeFileSync(join(root,'frontend/public/sw.js'),'// pinned');git(['add','.']);git(['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
  const r=record();r.ui_sha=git(['rev-parse','HEAD']);r.ui_tree=git(['rev-parse','HEAD^{tree}']);r.caller.checkout_sha=r.ui_sha;
  const path=join(root,'provenance.json');writeFileSync(path,JSON.stringify(r));mkdirSync(join(root,'frontend/public/static-data'),{recursive:true});
  const before=readFileSync(path);await assert.rejects(verifyDesignCarryPreview({provenancePath:path,root:join(root,'frontend/public'),repoRoot:root}),/ENOENT/);assert.deepEqual(readFileSync(path),before);
  writeFileSync(join(root,'frontend/index.html'),'<title>changed</title>');await assert.rejects(verifyDesignCarryPreview({provenancePath:path,root:join(root,'frontend/public'),repoRoot:root}),/Command failed/);writeFileSync(join(root,'frontend/index.html'),'<title>pinned</title>');
  writeFileSync(join(root,'frontend/public/sw.js'),'// changed');await assert.rejects(verifyDesignCarryPreview({provenancePath:path,root:join(root,'frontend/public'),repoRoot:root}),/Command failed/);writeFileSync(join(root,'frontend/public/sw.js'),'// pinned');
  for(const name of ['.env','.env.local','.env.production','.env.production.local']){writeFileSync(join(root,'frontend',name),'VITE_BASE_PATH=/changed/');await assert.rejects(verifyDesignCarryPreview({provenancePath:path,root:join(root,'frontend/public'),repoRoot:root}),/unbound local Vite environment/);rmSync(join(root,'frontend',name));}
  mkdirSync(join(root,'.github'));writeFileSync(join(root,'.github/untracked.mjs'),'// injected');await assert.rejects(verifyDesignCarryPreview({provenancePath:path,root:join(root,'frontend/public'),repoRoot:root}),/Untracked Design carry/);
});

test('history response retention preserves bytes within the existing encoded bound',async()=>{const budget={bytes:0},bytes=Buffer.from('authentic-bytes-fixture');assert.deepEqual(await readDesignHistoryResponse(new Response(bytes),budget),bytes);assert.equal(budget.bytes,bytes.length);});
test('history response rejects an oversized declared body before buffering',async()=>{await assert.rejects(readDesignHistoryResponse(new Response('x',{headers:{'content-length':String(128*1024*1024+1)}}),{bytes:0}),/encoded cap/);});
test('history response enforces a total bounded capture budget while streaming',async()=>{await assert.rejects(readDesignHistoryResponse(new Response('ab'),{bytes:512*1024*1024-1}),/retention budget/);});

function referenceFixture(t){
  const directory=mkdtempSync(join(tmpdir(),'design-reference-replay-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const repo=join(directory,'repo'),scratch=join(directory,'scratch'),refs=join(repo,'data/ibd_reference/ibd50');
  mkdirSync(refs,{recursive:true});mkdirSync(scratch);
  const reference={verified:true,as_of_date:'2026-10-15',source:'Synthetic unit fixture only',constituents:[{symbol:'TEST',rank:1}]};
  const path=join(refs,'2026-10-15.json');writeFileSync(path,JSON.stringify(reference));
  writeFileSync(join(repo,'.gitignore'),'data/ibd_reference/ignored.json\n');
  const git=args=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:'pipe'}).trim();
  git(['init','-q']);git(['add','.']);git(['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','reference fixture']);
  return {directory,repo,scratch,refs,path,reference,git};
}
test('scratch replay reproduces missing reference failure and stages exact source bytes for the actual exporter',t=>{
  const f=referenceFixture(t),frontend=join(f.scratch,'replay'),data=join(frontend,'public/static-data');mkdirSync(data,{recursive:true});
  const write=(name,value)=>writeFileSync(join(data,name),JSON.stringify(value));
  write('manifest.json',{generated_at:'2026-10-15T20:00:00Z',markets:{US:{market:'US',as_of_date:'2026-10-15',pages:{scan:{path:'scan.json'}},assets:{charts:{path:'charts.json'}}}}});
  write('scan.json',{as_of_date:'2026-10-15',initial_rows:[{symbol:'TEST',market:'US',as_of_date:'2026-10-15',current_price:20,adv_usd:30000000}],chunks:[]});write('charts.json',{symbols:[]});
  const sourceBytes=readFileSync(f.path),env={...process.env,FINANCIAL_EVALUATED_AT:'2026-10-16T04:00:00.000Z'};
  for(const key of Object.keys(env))if(/^(?:FINANCIAL_CORRECTION_|FINANCIAL_GENERATION_CARRY_)/.test(key))delete env[key];
  const script=fileURLToPath(new URL('../../frontend/tools/export-research.mjs',import.meta.url));
  const run=()=>execFileSync(process.execPath,[script],{cwd:frontend,env,encoding:'utf8',stdio:'pipe'});
  assert.throws(run,error=>error.status===1&&/ENOENT[^]*ibd_reference\/ibd50/.test(String(error.stderr)));
  assert.match(stageDesignReplayReferences(f.repo,f.scratch),/^[a-f0-9]{64}$/);
  assert.deepEqual(readFileSync(join(f.scratch,'data/ibd_reference/ibd50/2026-10-15.json')),sourceBytes);
  assert.match(run(),/Daily research exported/);
  assert.deepEqual(JSON.parse(readFileSync(join(frontend,'public/ibd-reference.json'))),f.reference);
  assert.deepEqual(readFileSync(f.path),sourceBytes);
});
for(const name of ['missing','missing-source','linked','hard-linked','linked-source','linked-parent','linked-repo','linked-scratch','untracked','ignored','modified','destination-exists','destination-linked'])test(`reference replay rejects ${name} input without an empty fallback`,t=>{
  const f=referenceFixture(t);
  if(name==='missing')rmSync(f.refs,{recursive:true});
  if(name==='missing-source')rmSync(join(f.repo,'data/ibd_reference'),{recursive:true});
  if(name==='linked'){rmSync(f.path);symlinkSync(join(f.repo,'.gitignore'),f.path);}
  if(name==='hard-linked')linkSync(f.path,join(f.directory,'hard-link.json'));
  for(const [kind,path]of [['linked-source',join(f.repo,'data/ibd_reference')],['linked-parent',join(f.repo,'data')]])if(name===kind){const moved=join(f.directory,kind);renameSync(path,moved);symlinkSync(moved,path);}
  if(name==='linked-repo'){const alias=join(f.directory,'repo-link');symlinkSync(f.repo,alias);f.repo=alias;}
  if(name==='linked-scratch'){const alias=join(f.directory,'scratch-link');symlinkSync(f.scratch,alias);f.scratch=alias;}
  if(name==='untracked')writeFileSync(join(f.refs,'2026-10-16.json'),'{}');
  if(name==='ignored')writeFileSync(join(f.repo,'data/ibd_reference/ignored.json'),'{}');
  if(name==='modified')writeFileSync(f.path,'{}');
  if(name==='destination-exists')mkdirSync(join(f.scratch,'data'));
  if(name==='destination-linked')symlinkSync(join(f.repo,'data'),join(f.scratch,'data'));
  assert.throws(()=>stageDesignReplayReferences(f.repo,f.scratch));
});
test('actual verifier stages checked references before replay export without changing its code identity scope',()=>{
  const source=readFileSync(new URL('./design-financial-carry.mjs',import.meta.url),'utf8');
  const verifier=source.slice(source.indexOf('export async function verifyDesignCarryPreview'));
  const stage=verifier.indexOf('stageDesignReplayReferences(repoRoot,scratch)'),prepare=verifier.indexOf('const prepared=await prepareBaseline');
  assert.ok(stage>=0&&prepare>stage);
  assert.ok(source.includes("'data/ibd_reference'"));
});

test('calendar preparation fails closed without the isolated runtime',()=>{
  const saved=process.env.SESSION_CALENDAR_PYTHON;
  delete process.env.SESSION_CALENDAR_PYTHON;
  try{assert.throws(()=>prepareDesignSessionCalendar('/candidate/frontend','/candidate/frontend/public','2026-10-17T00:00:00Z'),/isolated offline calendar runtime/);}
  finally{if(saved!==undefined)process.env.SESSION_CALENDAR_PYTHON=saved;}
});

test('calendar wrapper binds isolated Python, candidate root and replay clock without credentials',t=>{
  const directory=mkdtempSync(join(tmpdir(),'design-calendar-command-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const executable=join(directory,'python-fixture'),output=join(directory,'invocation.json');
  writeFileSync(executable,`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({args:process.argv.slice(2),token:process.env.GH_TOKEN??null,options:process.env.NODE_OPTIONS??null}));\n`);chmodSync(executable,0o755);
  const keys=['SESSION_CALENDAR_PYTHON','GH_TOKEN','NODE_OPTIONS'],saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{SESSION_CALENDAR_PYTHON:executable,GH_TOKEN:'synthetic-secret-must-not-escape',NODE_OPTIONS:'--invalid-fixture-hook'});
  try{
    prepareDesignSessionCalendar('/checked/frontend','/derived/public','2026-10-17T00:00:00Z');
    assert.deepEqual(JSON.parse(readFileSync(output)),{args:['-I','/checked/frontend/tools/export-book-benchmark.py','--calendar-only','--root','/derived/public/static-data','--evaluated-at','2026-10-17T00:00:00Z'],token:null,options:null});
  }finally{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
});
