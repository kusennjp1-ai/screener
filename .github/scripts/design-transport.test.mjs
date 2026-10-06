import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {prepareDesignTransport} from './design-transport.mjs';
import {sha256,validateReceipt} from './publication-state.mjs';
import {completeInventory} from './financial-release-activation.mjs';
import {canonicalPublication} from './static-transport-publication.mjs';

const frontend=fileURLToPath(new URL('../../frontend',import.meta.url)),H='a'.repeat(64);
const write=(path,bytes)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof bytes==='string'?bytes:JSON.stringify(bytes));};
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'normal-design-transport-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const repo=join(root,'current'),dist=join(repo,'frontend/dist'),provenance=join(root,'design-input-provenance.json');mkdirSync(repo);
  const git=args=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();git(['init','-q']);write(join(repo,'source.txt'),'current captured source');git(['add','source.txt']);git(['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','test source']);
  const revision=git(['rev-parse','HEAD']);
  for(const [path,bytes]of [['index.html','<title>current decoder fixture</title>'],['sw.js','// current worker'],['static-data/manifest.json','{"as_of_date":"2026-10-02"}'],['static-data/markets/us/charts/OWNED.json',' {"bars":[{"date":"2026-10-02","close":17}],"unknown":null}\n']])write(join(dist,path),bytes);
  cpSync(join(frontend,'public/static-transport-capability.json'),join(dist,'static-transport-capability.json'));
  const state={decision:{mode:'design'},sourceSha:revision,controllerSha:revision,source:{artifact:{id:1,digest:`sha256:${H}`},runId:2,attempt:1,manifestHash:H},live:{receipt:null,financialRelease:null}};
  write(provenance,state);const baseline=join(root,'legacy-baseline');cpSync(dist,baseline,{recursive:true});rmSync(join(baseline,'static-transport-capability.json'));
  return {root,repo,dist,provenance,state,revision,baseline,options:{dist,provenancePath:provenance,repoRoot:repo,frontendRoot:frontend,expectedSha:revision}};
}

test('ordinary Design measures a lossless packed current build and leaves the raw legacy baseline exact',async t=>{
  const f=fixture(t),baseline=completeInventory(f.baseline),original=readFileSync(join(f.dist,'static-data/markets/us/charts/OWNED.json'));
  const result=await prepareDesignTransport(f.options),publication=JSON.parse(readFileSync(join(f.dist,'publication.json')));
  assert.equal(result.publication_authority,'none');assert.equal(result.ui_sha,f.revision);assert.equal(result.input_provenance_sha256,sha256(readFileSync(f.provenance)));
  assert.equal(publication.transport.root.bindings.candidateId,result.input_provenance_sha256);
  assert.equal(publication.transport.root.bindings.financialGeneration,null);assert.equal(publication.transport.root.bindings.financialLineageSha256,null);
  assert.throws(()=>validateReceipt(publication));assert.deepEqual(completeInventory(f.baseline),baseline);
  assert.equal(existsSync(join(f.dist,'static-data/markets/us/charts/OWNED.json')),false);
  const restored=await canonicalPublication({root:f.dist,frontendRoot:frontend,publication,restore:join(f.root,'restored')});
  assert.deepEqual(readFileSync(join(restored,'static-data/markets/us/charts/OWNED.json')),original);
  await assert.rejects(()=>prepareDesignTransport(f.options),/exactly once/);
});

for(const [name,change]of Object.entries({
  'missing decoder marker':f=>rmSync(join(f.dist,'static-transport-capability.json')),
  'static data symlink':f=>{const path=join(f.root,'data');cpSync(join(f.dist,'static-data'),path,{recursive:true});rmSync(join(f.dist,'static-data'),{recursive:true});symlinkSync(path,join(f.dist,'static-data'));},
  'wrong checkout':f=>{f.options.expectedSha='b'.repeat(40);},
  'financial candidate provenance':f=>{f.state.decision.mode='activation';write(f.provenance,f.state);},
  'unbound active financial lineage':f=>{f.state.live={receipt:{financial_generation:H,financial_lineage_sha256:H},financialRelease:{financial_generation:H,lineage_sha256:H}};write(f.provenance,f.state);},
  'new unapproved financial generation':f=>write(join(f.dist,'static-data/manifest.json'),{financial_generation:H}),
}))test(`ordinary Design refuses ${name}`,async t=>{const f=fixture(t);change(f);await assert.rejects(()=>prepareDesignTransport(f.options));assert.equal(existsSync(join(f.dist,'publication.json')),false);});

test('normal Design binds an already-active matching lineage without generating financial evidence',async t=>{
  const f=fixture(t);f.state.live={receipt:{financial_generation:H,financial_lineage_sha256:H},financialRelease:{financial_generation:H,lineage_sha256:H}};write(f.provenance,f.state);
  const original={as_of_date:'2026-10-02',financial_generation:H,financial_evaluated_at:'2026-10-04T13:00:00Z'};write(join(f.dist,'static-data/manifest.json'),original);
  await prepareDesignTransport(f.options);const publication=JSON.parse(readFileSync(join(f.dist,'publication.json')));
  assert.equal(publication.transport.root.bindings.financialGeneration,H);assert.equal(publication.transport.root.bindings.financialLineageSha256,H);
  assert.deepEqual(JSON.parse(readFileSync(join(f.dist,'static-data/manifest.json'))),original);
  assert.equal(Object.hasOwn(publication,'financial_release'),false);
});

test('ordinary Design CLI binds its actual current checkout and rejects a mismatched identity',t=>{
  const f=fixture(t),command=fileURLToPath(new URL('./design-transport.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[command,f.dist,f.provenance],{cwd:f.repo,encoding:'utf8',env:{PATH:process.env.PATH,GITHUB_SHA:'b'.repeat(40)}});
  assert.equal(result.status,1);assert.match(result.stderr,/exact current tested checkout/);
  symlinkSync(join(frontend,'tools'),join(f.repo,'frontend/tools'));
  const valid=spawnSync(process.execPath,[command,f.dist,f.provenance],{cwd:f.repo,encoding:'utf8',env:{PATH:process.env.PATH,GITHUB_SHA:f.revision},timeout:15000});
  assert.equal(valid.status,0,valid.stderr);assert.equal(JSON.parse(valid.stdout).publication_authority,'none');
});
