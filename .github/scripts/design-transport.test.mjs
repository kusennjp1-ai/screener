import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {prepareDesignTransport} from './design-transport.mjs';
import {bootstrap,dataInventoryDigest,sha256,validateReceipt} from './publication-state.mjs';
import {completeInventory} from './financial-release-activation.mjs';
import {canonicalPublication,verifyTransportPublication} from './static-transport-publication.mjs';
import {validateDesignCarryPreview,verifyDesignCarryPreview} from './design-financial-carry.mjs';

const frontend=fileURLToPath(new URL('../../frontend',import.meta.url)),H='a'.repeat(64);
const write=(path,bytes)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof bytes==='string'?bytes:JSON.stringify(bytes));};
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'normal-design-transport-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const repo=join(root,'current'),dist=join(repo,'frontend/dist'),provenance=join(root,'design-input-provenance.json');mkdirSync(repo);
  const git=args=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();git(['init','-q']);write(join(repo,'source.txt'),'current captured source');write(join(repo,'.gitignore'),'frontend/dist/\n');git(['add','source.txt','.gitignore']);git(['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','test source']);
  const revision=git(['rev-parse','HEAD']);
  for(const [path,bytes]of [['index.html','<title>current decoder fixture</title>'],['sw.js','// current worker'],['static-data/manifest.json','{"as_of_date":"2026-10-02"}'],['static-data/markets/us/charts/OWNED.json',' {"bars":[{"date":"2026-10-02","close":17}],"unknown":null}\n'],['research-daily.json',' {"rows":[],"original":null}\n'],['portfolio-model.json','{"positions":[]}'],['qualification-audit.json','{"original":true}'],['ibd-reference.json','{"symbols":[]}']])write(join(dist,path),bytes);
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
  'preview marker in ordinary provenance':f=>{f.state.publication_authority='none';write(f.provenance,f.state);},
  'altered preview schema in ordinary provenance':f=>{f.state.schema='design-financial-carry-preview-v0';write(f.provenance,f.state);},
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

function previewBinding(f) {
  write(join(f.dist,'static-data/manifest.json'),{as_of_date:'2026-10-02',financial_generation:H});
  cpSync(join(f.dist,'static-data'),join(f.baseline,'static-data'),{recursive:true});
  const record={schema:'design-financial-carry-preview-v1',publication_authority:'none',financial_admission:false,ui_sha:f.revision,baseline_sha:'b'.repeat(40),
    source_financial_generation:'c'.repeat(64),financial_generation:H,financial_lineage_sha256:'d'.repeat(64),logical_data_inventory_sha256:dataInventoryDigest(f.dist)};
  f.options.baselineRoot=f.baseline;f.options.frontendRoot=join(f.repo,'frontend');write(f.provenance,record);return record;
}

function completePreviewBinding(f) {
  const core=previewBinding(f),identity=`1/1/${H}/${H}`,instant=new Date().toISOString();
  const paths=['state.json','attempt.json','source/artifact.zip','source/artifact.tar','companion/artifact.zip','companion/source.json','predecessor.json','history-responses.json','target-base.json','carry-projection.json','history-reconciliation.json','quality.log','retained-universe.json','assessment.json'];
  const record={...core,ui_tree:execFileSync('git',['-C',f.repo,'rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),baseline_tree:'b'.repeat(40),previous_publication_identity:identity,
    timestamps:{prepared_at:instant,verified_at:instant},caller:{repository:bootstrap.repository,run_id:3,run_attempt:1,event:'pull_request',head_sha:f.revision,checkout_sha:f.revision,started_at:instant},
    source:{artifact_id:1,run_id:2,run_attempt:1,head_sha:f.revision,artifact_sha256:H,manifest_sha256:H},
    live:{identity,receipt_sha256:H,manifest_sha256:H,financial_generation:core.source_financial_generation,root_sha256:H},
    evidence:{files:Object.fromEntries(paths.map(path=>[path,H])),source_input_sha256:H,predecessor_history_sha256:H,baseline_sha256:H,audit_inventory_sha256:H},
    assessment:{compatibility:H,equality:H,retained_universe:H}};
  write(f.provenance,record);return record;
}

test('matching preview hashes are insufficient without the closed carry contract',async t=>{
  const f=fixture(t);previewBinding(f);
  await assert.rejects(()=>prepareDesignTransport(f.options),/Invalid closed Design carry record/);
  assert.equal(existsSync(join(f.dist,'publication.json')),false);
});

test('a complete preview-shaped record never substitutes for independently verified evidence',async t=>{
  const f=fixture(t),record=completePreviewBinding(f),before=completeInventory(f.dist);
  assert.equal(validateDesignCarryPreview(record),record,'shape validation alone grants no trust');
  await assert.rejects(()=>prepareDesignTransport(f.options),error=>error.code==='ENOENT'&&/design-carry-evidence\/state\.json/.test(error.message));
  assert.deepEqual(completeInventory(f.dist),before);assert.equal(existsSync(join(f.dist,'publication.json')),false);
});

test('preview contract cannot smuggle an extra success or authority attestation',async t=>{
  const f=fixture(t),record=completePreviewBinding(f);record.verified=true;write(f.provenance,record);
  await assert.rejects(()=>prepareDesignTransport(f.options),/Invalid closed Design carry record/);
  assert.equal(existsSync(join(f.dist,'publication.json')),false);
});

test('preview verification cannot execute a different frontend toolchain',async t=>{
  const f=fixture(t);completePreviewBinding(f);f.options.frontendRoot=frontend;
  await assert.rejects(()=>prepareDesignTransport(f.options),/exact checked frontend/);
  assert.equal(existsSync(join(f.dist,'publication.json')),false);
});

for(const [name,change,expected]of [
  ['missing comparison baseline',f=>{f.options.baselineRoot='';},/DESIGN_COMPARISON_BASELINE/],
  ['same current tree as baseline',f=>{f.options.baselineRoot=f.dist;},/separate raw logical/],
  ['packed comparison baseline',f=>mkdirSync(join(f.baseline,'static-data/_transport')),/separate raw logical/],
  ['symlink comparison data',f=>{rmSync(join(f.baseline,'static-data'),{recursive:true});symlinkSync(join(f.dist,'static-data'),join(f.baseline,'static-data'));},/real raw logical/],
  ['changed comparison chart',f=>write(join(f.baseline,'static-data/markets/us/charts/OWNED.json'),'{}'),/logical data inventories differ/],
  ['changed top-level comparison JSON',f=>write(join(f.baseline,'research-daily.json'),'{}'),/logical data inventories differ/],
  ['omitted top-level comparison JSON',f=>rmSync(join(f.baseline,'qualification-audit.json')),/logical data inventories differ/],
])test(`verified Design carry refuses ${name} before packing`,async t=>{
  const f=fixture(t);previewBinding(f);change(f);
  const original=completeInventory(f.dist);await assert.rejects(()=>prepareDesignTransport(f.options),expected);
  assert.deepEqual(completeInventory(f.dist),original);assert.equal(existsSync(join(f.dist,'publication.json')),false);
});

for(const [name,change]of Object.entries({
  'publication authority':record=>{record.publication_authority='publish';},
  'financial admission':record=>{record.financial_admission=true;},
  'UI identity':record=>{record.ui_sha='e'.repeat(40);},
  'baseline identity':record=>{record.baseline_sha='latest';},
  'source generation':record=>{delete record.source_financial_generation;},
  'derived generation':record=>{record.financial_generation='e'.repeat(64);},
  'original lineage':record=>{record.financial_lineage_sha256=null;},
  'logical inventory':record=>{record.logical_data_inventory_sha256='e'.repeat(64);},
}))test(`verified Design carry refuses altered ${name} binding`,async t=>{
  const f=fixture(t),record=previewBinding(f);change(record);write(f.provenance,record);
  await assert.rejects(()=>prepareDesignTransport(f.options),/carry transport binding changed/);
  assert.equal(existsSync(join(f.dist,'publication.json')),false);
});

for(const [name,change]of Object.entries({
  'browser bootstrap':f=>{const path=join(f.dist,'publication.json'),publication=JSON.parse(readFileSync(path));publication.transport.root.bindings.candidateId='f'.repeat(64);write(path,publication);},
  'UI asset':f=>write(join(f.dist,'sw.js'),'// changed after capture'),
  'packed physical asset':f=>{const path=Object.keys(completeInventory(f.dist)).find(path=>path.includes('/gzip/'));write(join(f.dist,path),'changed payload');},
}))test(`packed Design refuses changed ${name}`,async t=>{
  const f=fixture(t);await prepareDesignTransport(f.options);const publication=JSON.parse(readFileSync(join(f.dist,'publication.json')));change(f);
  await assert.rejects(()=>verifyTransportPublication({root:f.dist,frontendRoot:frontend,publication}));
});

test('ordinary Design CLI binds its actual current checkout and rejects a mismatched identity',t=>{
  const f=fixture(t),command=fileURLToPath(new URL('./design-transport.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[command,f.dist,f.provenance],{cwd:f.repo,encoding:'utf8',env:{PATH:process.env.PATH,GITHUB_SHA:'b'.repeat(40)}});
  assert.equal(result.status,1);assert.match(result.stderr,/exact current tested checkout/);
  symlinkSync(join(frontend,'tools'),join(f.repo,'frontend/tools'));
  const scratch=join(f.root,'temporary');mkdirSync(scratch);
  const valid=spawnSync(process.execPath,[command,f.dist,f.provenance],{cwd:f.repo,encoding:'utf8',env:{PATH:process.env.PATH,GITHUB_SHA:f.revision,TMPDIR:scratch},timeout:15000});
  assert.equal(valid.status,0,valid.stderr);assert.equal(JSON.parse(valid.stdout).publication_authority,'none');
  assert.deepEqual(readdirSync(scratch),[],'successful canonical roundtrip removes owned outside scratch');
});


test('large owned roundtrip inside checkout reproduces ENOBUFS; outside output leaves code checks active',async t=>{
  const f=fixture(t);completePreviewBinding(f);
  const inside=mkdtempSync(join(f.repo,'frontend/.design-transport-roundtrip-'));
  // A small-content fixture with >1MiB of path output reproduces the actual
  // ls-files buffer failure without downloading or manufacturing source proof.
  for(let i=0;i<6000;i++)writeFileSync(join(inside,`${String(i).padStart(5,'0')}-${'x'.repeat(190)}.json`),'{}');
  const verify=()=>verifyDesignCarryPreview({provenancePath:f.provenance,root:f.dist,repoRoot:f.repo});
  await assert.rejects(verify,error=>error.code==='ENOBUFS');
  const outside=join(f.root,'owned-roundtrip');renameSync(inside,outside);
  await assert.rejects(verify,error=>error.code==='ENOENT'&&/design-carry-evidence\/state\.json/.test(error.message),'clean checkout still requires independently retained evidence');
  // Genuine untracked controller files remain rejected, even with output too
  // large to buffer. The repair must never ignore a filename prefix or path.
  mkdirSync(join(f.repo,'.github'));renameSync(outside,join(f.repo,'.github/untracked-controller'));
  await assert.rejects(verify,error=>error.code==='ENOBUFS');
});

test('large tracked controller changes remain rejected by the unchanged code guard',async t=>{
  const f=fixture(t),path=join(f.repo,'frontend/controller.mjs');writeFileSync(path,'// original\n');
  const git=args=>execFileSync('git',['-C',f.repo,...args],{encoding:'utf8',stdio:'pipe'}).trim();
  git(['add','frontend/controller.mjs']);git(['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','controller fixture']);f.revision=git(['rev-parse','HEAD']);completePreviewBinding(f);
  writeFileSync(path,'// altered '+ 'x'.repeat(2*1024*1024)+'\n');
  await assert.rejects(()=>verifyDesignCarryPreview({provenancePath:f.provenance,root:f.dist,repoRoot:f.repo}),error=>error.code==='ENOBUFS'||error.status===1);
});

for(const linked of [false,true])test(`transport rejects ${linked?'linked':'direct'} temp directory inside checkout and removes owned scratch`,t=>{
  const f=fixture(t),command=fileURLToPath(new URL('./design-transport.mjs',import.meta.url));
  symlinkSync(join(frontend,'tools'),join(f.repo,'frontend/tools'));
  let temporary=join(f.repo,'frontend');
  if(linked){const alias=join(f.root,'temp-link');symlinkSync(temporary,alias);temporary=alias;}
  const result=spawnSync(process.execPath,[command,f.dist,f.provenance],{cwd:f.repo,encoding:'utf8',env:{PATH:process.env.PATH,GITHUB_SHA:f.revision,TMPDIR:temporary},timeout:15000});
  assert.equal(result.status,1);assert.match(result.stderr,/scratch must stay outside the checked repository/);
  assert.deepEqual(readdirSync(join(f.repo,'frontend')).filter(name=>name.startsWith('.design-transport-roundtrip-')),[]);
});
