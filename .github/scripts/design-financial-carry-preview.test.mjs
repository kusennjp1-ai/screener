// Offline synthetic integration evidence only. No real GitHub run, source
// certification, browser screenshot, or release acceptance is claimed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lifecycleFixture} from './fixtures/financial-release-lifecycle.mjs';
import {prepareDesignCarryPreview,packDesignCarryPreview,verifyDesignCarryPreview,revalidateDesignCarrySource,validateDesignCarrySource,previewCheckout,recordDesignCarryPreviewReport,DESIGN_CARRY_PREVIEW_BASIS} from './design-financial-carry-preview.mjs';
import {sha256} from './publication-state.mjs';
import {completeInventory,restorePublishedFinancialSource} from './financial-release-activation.mjs';
import {currentFinancialHistory} from '../../frontend/src/static/financialCurrent.js';

const repository='kusennjp1-ai/screener',prefix=`repos/${repository}`;
const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>JSON.parse(readFileSync(path));
const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
const run=(cmd,args,cwd)=>execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
function fixture({time=Date.parse('2026-10-10T05:00:00Z'),date='2026-10-09'}={}){
  const original=lifecycleFixture();original.seed();
  original.advance({id:40,date,price:125,time:new Date(time).toISOString()});
  const root=join(original.root,'preview-repo'),frontend=join(root,'frontend');mkdirSync(frontend,{recursive:true});
  mkdirSync(join(frontend,'public'),{recursive:true});for(const path of ['src','tools','contracts','package.json','index.html','public/sw.js'])cpSync(join(repoRoot,'frontend',path),join(frontend,path),{recursive:true});
  run('git',['init','-q'],root);run('git',['add','frontend'],root);run('git',['-c','user.name=Synthetic Test','-c','user.email=synthetic@example.invalid','commit','-qm','Synthetic controller fixture'],root);
  const sha=run('git',['rev-parse','HEAD'],root),baselineRepo=join(original.root,'baseline');run('git',['clone','--quiet','--shared',root,baselineRepo],original.root);
  mkdirSync(join(root,'data/ibd_reference/ibd50'),{recursive:true});
  const publicRoot=join(frontend,'public'),rawRoot=join(original.root,'export-40/frontend/public');cpSync(rawRoot,publicRoot,{recursive:true});
  const baselineRoot=join(baselineRepo,'frontend/dist');cpSync(rawRoot,baselineRoot,{recursive:true});cpSync(rawRoot,join(baselineRepo,'frontend/public'),{recursive:true});
  const receiptBytes=readFileSync(join(original.liveRoot,'publication.json')),receipt=JSON.parse(receiptBytes),manifestBytes=readFileSync(join(original.liveRoot,'static-data/manifest.json'));
  const live={receipt,financialRelease:read(join(original.liveRoot,receipt.financial_release.path)),receiptHash:sha256(receiptBytes),manifestHash:sha256(manifestBytes)};
  live.identity=`30/1/${live.receiptHash}/${live.manifestHash}`;
  const meta=read(join(original.root,'source-40.json')),pages=original.config.api[`${prefix}/actions/artifacts?per_page=100`],artifact=pages[0].artifacts[0];
  const source={artifact,runId:140,attempt:1,manifest:JSON.parse(meta.manifest_json),manifestHash:meta.manifest_sha256,priceObservations:meta.price_observations,priceObservationsDigest:meta.price_observations_sha256};
  const state={decision:{mode:'design',publish:true},sourceSha:sha,controllerSha:sha,live,source};
  const work=join(original.root,'preview'),provenancePath=join(original.root,'verified-publication/state.json'),archiveDir=join(dirname(provenancePath),'artifact-140');write(provenancePath,state);mkdirSync(archiveDir);
  for(const [ext,name]of [['zip','artifact.zip'],['tar','artifact.tar']])cpSync(join(original.root,`artifact-140.${ext}`),join(archiveDir,name));
  let liveValue=structuredClone(live),artifactValue=structuredClone(artifact),metadata=structuredClone(meta),now=time;const calls=[];
  const api=(endpoint,paginate=false)=>{calls.push({endpoint,paginate});
    if(endpoint===`${prefix}/actions/artifacts/140`)return structuredClone(artifactValue);
    if(endpoint===`${prefix}/actions/runs/140/artifacts?per_page=100`)return structuredClone(pages);
    if(Object.hasOwn(original.config.api,endpoint))return structuredClone(original.config.api[endpoint]);throw Error(`Unexpected synthetic endpoint ${endpoint}`);};
  const revalidate=state=>revalidateDesignCarrySource(state,{api,loadLive:async()=>structuredClone(liveValue),loadManifest:()=>structuredClone(metadata)});
  const dependencies={now:()=>now,revalidate,restore:(live,root)=>restorePublishedFinancialSource(live,root,async url=>{const relative=new URL(url).pathname.replace('/screener/','');return new Response(readFileSync(join(original.liveRoot,relative)));})};
  const currentRoot=join(frontend,'dist'),receiptPath=join(work,'preview-receipt.json'),preparationPath=join(work,'preparation.json');
  return {original,root,frontend,publicRoot,rawRoot,baselineRoot,sha,state,work,provenancePath,dependencies,currentRoot,receiptPath,preparationPath,calls,
    async prepare(){return prepareDesignCarryPreview({repoRoot:root,provenancePath,workRoot:work,expectedSha:sha,baselineRepoRoot:baselineRepo,dependencies});},
    async pack(){cpSync(publicRoot,currentRoot,{recursive:true});write(join(currentRoot,'index.html'),'<!doctype html><title>Synthetic candidate</title>');write(join(baselineRoot,'index.html'),'<!doctype html><title>Synthetic baseline</title>');
      cpSync(join(repoRoot,'frontend/public/static-transport-capability.json'),join(currentRoot,'static-transport-capability.json'));
      return packDesignCarryPreview({preparationPath,currentRoot,baselineRoot,dependencies});},
    verify(){return verifyDesignCarryPreview({receiptPath,currentRoot,baselineRoot,dependencies});},
    setLive(value){liveValue=value;},setArtifact(value){artifactValue=value;},setMeta(value){metadata=value;},setNow(value){now=value;},cleanup(){original.cleanup();}};
}

test('real carry preparation and lossless pack keep expired synthetic receipts and all price/history bytes',async t=>{
  const f=fixture();try{
    const p=await f.prepare(),carry=read(p.paths.projection),source=JSON.parse(f.original.original.bytes);
    assert.notEqual(carry.financial_generation,source.financial_generation);assert.equal(carry.source_projection_json,f.original.original.bytes);assert.equal(carry.source_base_json,f.original.original.base);
    assert.deepEqual(carry.receipt_inventory,source.receipt_inventory);assert.deepEqual(carry.symbols.OWNED.source_receipts,source.symbols.OWNED.source_receipts);
    assert.equal(currentFinancialHistory(carry.symbols.OWNED.financial_history,'OWNED','2026-10-09',Date.parse(p.financial.evaluated_at)).annual.length,0);
    assert.equal(readFileSync(join(f.publicRoot,'static-data/candidate-history/retained-history.json'),'utf8'),'retained original history bytes\n');
    const manifest=read(join(f.publicRoot,'static-data/manifest.json')),chartRef=read(join(f.publicRoot,'static-data',manifest.markets.US.assets.charts.path)).symbols[0],chart=read(join(f.publicRoot,'static-data',chartRef.path));
    for(const key of ['eps_growth_qq','eps_growth_yy','eps_5yr_cagr'])assert.equal(chart.fundamentals.financial_current_state.fields[key].reason,'stale_source');
    assert.equal(existsSync(join(f.frontend,'tools/.design-carry-preview-export.mjs')),false);
    const receipt=await f.pack();assert.equal(receipt.publication_authority,'none');assert.equal(receipt.release_accepted,false);assert.equal(receipt.comparison_basis,DESIGN_CARRY_PREVIEW_BASIS);assert.equal(receipt.candidate.sha,f.sha);
    assert.deepEqual(await f.verify(),receipt);assert.equal(read(join(f.currentRoot,'publication.json')).publication_authority,'none');assert.equal(read(join(f.currentRoot,'publication.json')).schema,'static-json-transport-preview-v1');
    assert.notEqual(receipt.financial.generation,receipt.predecessor.financial_generation);assert.ok(f.calls.every(call=>!/(?:POST|deploy|dispatch)/i.test(call.endpoint)));
    const mutate=async(path,change,pattern)=>{const original=readFileSync(path);try{write(path,change(original));await assert.rejects(()=>f.verify(),pattern);}finally{write(path,original);}};
    for(const [name,path,change,pattern]of [
      ['provenance',f.provenancePath,b=>b+' ',/provenance changed/],
      ['source archive ZIP',join(dirname(f.provenancePath),'artifact-140/artifact.zip'),b=>Buffer.concat([b,Buffer.from('x')]),/artifact digest changed/],
      ['source projection',join(p.paths.source,f.state.live.financialRelease.source_projection.path),b=>b+' ',/hash|audit/i],
      ['source base',join(p.paths.source,f.state.live.financialRelease.source_base.path),b=>b+' ',/hash|audit/i],
      ['carry projection',p.paths.projection,b=>b+' ',/carry projection changed/],
      ['preview tooling bytes',p.paths.exporter,b=>b+' ',/preview tooling bytes changed/],
      ['target base',p.paths.target,b=>b+' ',/target bytes changed/],
      ['semantic baseline prices',join(p.paths.baseline,'static-data/charts/OWNED.json'),b=>JSON.stringify({...JSON.parse(b),bars:[]}),/baseline changed/],
      ['candidate manifest',join(f.currentRoot,'static-data/manifest.json'),b=>b+' ',/physical inventory changed/],
      ['candidate UI',join(f.currentRoot,'index.html'),b=>b+'changed',/physical inventory changed/],
      ['baseline UI',join(f.baselineRoot,'index.html'),b=>b+'changed',/baseline UI changed/],
      ['baseline data',join(f.baselineRoot,'static-data/manifest.json'),b=>b+' ',/baseline data changed/],
      ['candidate HTML source',join(f.frontend,'index.html'),b=>b+'changed',/tracked source code changed/],
      ['candidate service worker source',join(f.frontend,'public/sw.js'),b=>b+'changed',/tracked source code changed/],
      ['baseline HTML source',join(f.baselineRoot,'../index.html'),b=>b+'changed',/tracked source code changed/],
      ['baseline service worker source',join(f.baselineRoot,'../public/sw.js'),b=>b+'changed',/tracked source code changed/],
      ['source code checkout',join(f.frontend,'tools/financial-generation-carry.mjs'),b=>b+'\n// changed\n',/tracked source code changed/],
      ['receipt generation',f.receiptPath,b=>JSON.stringify({...JSON.parse(b),financial:{...JSON.parse(b).financial,generation:'d'.repeat(64)}}),/receipt financial changed/],
      ['preview authority',f.receiptPath,b=>JSON.stringify({...JSON.parse(b),release_accepted:true}),/cannot grant release authority/],
    ])await t.test(`rejects ${name} tampering`,()=>mutate(path,change,pattern));
    const packed=Object.keys((await import('./financial-release-activation.mjs')).completeInventory(f.currentRoot)).find(path=>path.includes('/gzip/'));
    await t.test('rejects corrupted encoded packed member',()=>mutate(join(f.currentRoot,packed),b=>Buffer.concat([b,Buffer.from('x')]),/physical inventory changed/));
    await t.test('rejects live predecessor race',async()=>{f.setLive({...f.state.live,identity:f.state.live.identity.replace('30/','31/')});try{await assert.rejects(()=>f.verify(),/live predecessor changed/);}finally{f.setLive(f.state.live);}});
    await t.test('rejects source artifact identity and expiry races',async()=>{for(const patch of [{expired:true},{digest:`sha256:${'e'.repeat(64)}`},{id:141}]){f.setArtifact({...f.state.source.artifact,...patch});await assert.rejects(()=>f.verify());}f.setArtifact(f.state.source.artifact);});
    await t.test('rejects candidate mutation during awaited source revalidation',async()=>{
      const path=join(f.currentRoot,'index.html'),bytes=readFileSync(path),revalidate=f.dependencies.revalidate;
      f.dependencies.revalidate=async state=>{const result=await revalidate(state);write(path,bytes+'late mutation');return result;};
      try{await assert.rejects(()=>f.verify(),/physical inventory during verification/);}finally{write(path,bytes);f.dependencies.revalidate=revalidate;}
    });
    await t.test('Git assume-unchanged cannot conceal source byte changes',async()=>{
      const path=join(f.frontend,'index.html'),bytes=readFileSync(path);run('git',['update-index','--assume-unchanged','frontend/index.html'],f.root);write(path,bytes+'hidden mutation');
      try{await assert.rejects(()=>f.verify(),/immutable Git tree/);}finally{write(path,bytes);run('git',['update-index','--no-assume-unchanged','frontend/index.html'],f.root);}
    });
    await t.test('wrong checked-out commit rejects before any source request',()=>assert.throws(()=>previewCheckout(f.root,'f'.repeat(40)),/exact checked-out candidate/));
    await t.test('normal and pre-stamped source cannot enter preview mode',()=>{for(const patch of [{carry:{}},{decision:{mode:'data'}},{source:{...f.state.source,manifest:{...f.state.source.manifest,financial_generation:f.state.live.financialRelease.financial_generation}}}])assert.throws(()=>validateDesignCarrySource({...f.state,...patch},f.sha));});
    await t.test('binds synthetic screenshot report and refuses fabricated candidate receipt',async()=>{
      const reportPath=join(f.original.root,'screens/report.json'),base={commit:f.sha,input_basis:DESIGN_CARRY_PREVIEW_BASIS,release_accepted:false,publication_authority:'none',ui_only_same_data:false,financial_carry_preview:{receipt_sha256:sha256(readFileSync(f.receiptPath)),financial:receipt.financial},screens:[],failures:['Synthetic expired financial history']};
      write(reportPath,{...base,commit:'f'.repeat(40)});await assert.rejects(()=>recordDesignCarryPreviewReport({receiptPath:f.receiptPath,currentRoot:f.currentRoot,baselineRoot:f.baselineRoot,reportPath,dependencies:f.dependencies}),/report.*binding/i);
      write(reportPath,base);const result=await recordDesignCarryPreviewReport({receiptPath:f.receiptPath,currentRoot:f.currentRoot,baselineRoot:f.baselineRoot,reportPath,dependencies:f.dependencies});assert.equal(result.report_sha256,sha256(readFileSync(reportPath)));assert.equal(result.release_accepted,false);
    });
  }finally{if(process.env.KEEP_PREVIEW_FIXTURE)console.log('Synthetic retained fixture',f.original.root);else f.cleanup();}
});

test('workflow cannot deploy, replace ordinary gates, or refresh statement sources',()=>{
  const workflow=readFileSync(new URL('../workflows/design-carry-preview.yml',import.meta.url),'utf8'),release=readFileSync(new URL('../workflows/research-ui-release.yml',import.meta.url),'utf8'),controller=readFileSync(new URL('./design-financial-carry-preview.mjs',import.meta.url),'utf8');
  assert.match(workflow,/name: Design Carry Preview/);assert.match(workflow,/contents: read\n  actions: read/);assert.match(workflow,/persist-credentials: false/);
  assert.doesNotMatch(workflow,/permissions:[\s\S]*?(?:contents|actions|pages|id-token): write|deploy-pages|workflow_run:|financial-release-activation\.mjs|FINANCIAL_EVALUATED_AT:/);
  const watchlist=release.match(/workflow_run:[\s\S]*?types:/)?.[0];assert.ok(watchlist);assert.doesNotMatch(watchlist,/Design Carry Preview/);
  assert.match(workflow,/node tools\/check-design-review.mjs/);assert.doesNotMatch(controller,/writeFinancialReleaseReceipt|design-seal|\.mjs compose|\.mjs recheck/);
  assert.match(controller,/restorePublishedFinancialSource/);assert.match(controller,/createFinancialGenerationCarry/);assert.match(controller,/loadFinancialGenerationCarry/);assert.match(controller,/verifyCarriedBundle/);
});

for(const [label,time,later]of [
  ['annual-only', '2026-10-04T23:00:00Z','2026-10-05T01:00:00Z'],
  ['quarterly-only','2026-10-05T23:00:00Z','2026-10-06T01:00:00Z'],
])test(`new controller rejects ${label} history expiry between preparation and measurement`,async()=>{
  const f=fixture({time:Date.parse(time),date:time.slice(0,10)});try{await f.prepare();await f.pack();f.setNow(Date.parse(later));await assert.rejects(()=>f.verify(),/history expired/);}finally{f.cleanup();}
});

test('new controller authenticates TAR membership and all materialized source bytes before export',async t=>{
  for(const [label,mutate,pattern]of [
    ['TAR swap with unchanged manifest',f=>{const path=join(dirname(f.provenancePath),'artifact-140/artifact.tar');write(path,Buffer.concat([readFileSync(path),Buffer.from('swapped TAR bytes')]));},/TAR membership/],
    ['raw price payload change',f=>{const path=join(f.publicRoot,'static-data/charts/OWNED.json'),value=read(path);value.bars[0].close+=1;write(path,value);},/materialized raw source inventory/],
    ['raw universe file removal',f=>rmSync(join(f.publicRoot,'static-data/chunk.json')),/materialized raw source inventory/],
  ])await t.test(label,async()=>{const f=fixture();try{mutate(f);await assert.rejects(()=>f.prepare(),pattern);assert.equal(existsSync(f.work),false);}finally{f.cleanup();}});
});

for(const failedStage of ['export-research.mjs','.design-carry-preview-export.mjs'])test(`failed ${failedStage} restores raw input and leaves no success record or temporary tooling`,async()=>{
  const f=fixture(),before=completeInventory(f.publicRoot),sourceBefore=readFileSync(join(f.frontend,'tools/export-research.mjs'));try{
    f.dependencies.run=(name,frontend,env)=>{if(name===failedStage)throw Error('Synthetic staged export failure');execFileSync(process.execPath,[join(frontend,'tools',name)],{cwd:frontend,env,stdio:'pipe'});};
    await assert.rejects(()=>f.prepare(),/Synthetic staged export failure/);assert.deepEqual(completeInventory(f.publicRoot),before);assert.equal(existsSync(f.work),false);assert.equal(existsSync(join(f.frontend,'tools/.design-carry-preview-export.mjs')),false);assert.deepEqual(readFileSync(join(f.frontend,'tools/export-research.mjs')),sourceBefore);
  }finally{f.cleanup();}
});

test('late pack verification failure rolls back logical output and removes pending receipt',async()=>{
  const f=fixture();try{const p=await f.prepare();let calls=0;const revalidate=f.dependencies.revalidate;f.dependencies.revalidate=async state=>{if(++calls===2)throw Error('Synthetic final verification failure');return revalidate(state);};
    await assert.rejects(()=>f.pack(),/Synthetic final verification failure/);assert.equal(existsSync(f.receiptPath),false);assert.equal(existsSync(join(f.work,'preview-receipt.pending.json')),false);assert.equal(existsSync(join(f.work,'candidate-logical')),false);assert.equal(existsSync(join(f.currentRoot,'publication.json')),false);assert.equal(read(join(f.currentRoot,'static-data/manifest.json')).financial_generation,p.financial.generation);
  }finally{f.cleanup();}
});

test('expiry during awaited compatibility verification fails at the actual final clock boundary',async()=>{
  const time=Date.parse('2026-10-04T23:00:00Z'),later=Date.parse('2026-10-05T01:00:00Z'),f=fixture({time,date:'2026-10-04'});try{await f.prepare();await f.pack();let calls=0;f.dependencies.now=()=>++calls===1?time:later;await assert.rejects(()=>f.verify(),/history expired at boundary/);}finally{f.cleanup();}
});
