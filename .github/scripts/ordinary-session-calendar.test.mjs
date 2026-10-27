import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {lifecycleFixture,read} from './fixtures/financial-release-lifecycle.mjs';
import {ordinaryRawPrices,validateOrdinaryCalendarProof,ordinaryCalendarEligible} from './ordinary-session-calendar.mjs';
import {digest} from './financial-correction.mjs';
import {canonicalPublication} from './static-transport-publication.mjs';

const time='2026-10-05T22:00:00.000Z';
const write=(path,value)=>writeFileSync(path,JSON.stringify(value));
test('ordinary replay binds the selected dated market seed across different working directories',{timeout:180000},async()=>{
  const fixture=lifecycleFixture({calendarCheckout:true,omitAcquiredHistory:true,marketTrendBreadth:true});
  try{
    fixture.seed();write(join(fixture.root,'event.json'),{inputs:{ui_only:true}});
    const release=fixture.advance({id:40,date:'2026-10-23',price:120,time:'2026-10-26T22:00:00.000Z',withoutCalendar:true});
    release.command('plan');release.command('restore');
    const seedPath=join(release.frontend,'data/market-trend-source-2026-10-23.json'),seed=readFileSync(seedPath);
    // A reference file is part of the selected compiler: changing it must fail
    // even though it is neither a tool nor an observed price in the input ZIP.
    writeFileSync(seedPath,Buffer.concat([seed,Buffer.from('\n')]));
    assert.notEqual(release.command('prepare-carry',{allowFailure:true}).status,0);
    writeFileSync(seedPath,seed);
    release.command('prepare-carry');
    const root=join(release.frontend,'public'),entry=read(join(root,'static-data/manifest.json')).markets.US;
    assert.ok(entry.assets.market_trends.source_sha256);
    const trends=read(join(root,'static-data',entry.assets.market_trends.path));
    assert.equal(trends.put_call.points.length,63);
    assert.deepEqual(trends.indices.map(index=>index.points.length),[280,280]);
    const prepared=release.state(),proof=prepared.carry.calendar.proof;
    release.build();release.command('compose');release.command('recheck');
    assert.deepEqual(read(join(release.dist,'publication.json')).ordinary_calendar_derivation,proof);
    const published=read(join(release.dist,'static-data/manifest.json')).markets.US;
    assert.deepEqual(published.assets.market_trends,entry.assets.market_trends);
  }finally{fixture.cleanup();}
});
for(const packedTransport of [false,true])test(`offline generic carry derives and independently replays complete baseline, packed=${packedTransport}`,{timeout:120000},async()=>{
  const fixture=lifecycleFixture({packedTransport,omitAcquiredHistory:true,calendarCheckout:true});
  try{
    fixture.seed();write(join(fixture.root,'event.json'),{inputs:{ui_only:true}});
    const release=fixture.advance({id:40,date:'2026-10-05',price:120,time,withoutCalendar:true});
    release.command('plan');release.command('restore');
    const state=release.state(),root=join(release.frontend,'public');
    assert.equal(state.ordinaryCalendarSource.route,'ui_only');
    assert.equal(existsSync(join(root,'static-data/trading-calendar.json')),false);
    const raw=digest(ordinaryRawPrices(root));
    release.command('prepare-carry');
    const prepared=release.state(),proof=prepared.carry.calendar.proof;
    assert.equal(validateOrdinaryCalendarProof(proof),proof);
    assert.equal(proof.raw_prices_sha256,raw);
    assert.equal(read(join(root,'static-data/trading-calendar.json')).generated_at,time.replace('.000Z','+00:00'));
    release.build();release.command('compose');release.command('recheck');
    const receipt=read(join(release.dist,'publication.json'));
    assert.deepEqual(receipt.ordinary_calendar_derivation,proof);
    assert.equal(receipt.financial_lineage_sha256,fixture.lineage.id);
    assert.equal(receipt.verification_universe.minimum_target,.9);
    const logical=packedTransport?await canonicalPublication({root:release.dist,frontendRoot:release.frontend,publication:receipt,restore:join(release.root,'logical-check')}):release.dist;
    assert.equal(digest(ordinaryRawPrices(logical)),raw);
    const manifest=read(join(logical,'static-data/manifest.json'));
    const scan=read(join(logical,'static-data',manifest.markets.US.pages.scan.path));
    assert.equal(scan.initial_rows[0].technical_audit.valid,true);
    assert.equal(scan.initial_rows[0].technical_audit.version,'ohlcv-v2-session-calendar');
    // The same safe-formed proof cannot be changed only in the public receipt.
    receipt.ordinary_calendar_derivation.raw_prices_sha256='d'.repeat(64);write(join(release.dist,'publication.json'),receipt);
    assert.notEqual(release.command('recheck',{allowFailure:true}).status,0);
  }finally{fixture.cleanup();}
});

test('ordinary calendar routes do not acquire authority from mode or intent flags',{timeout:120000},async()=>{
  const fixture=lifecycleFixture({calendarCheckout:true});
  try{
    fixture.seed();write(join(fixture.root,'event.json'),{inputs:{ui_only:true}});
    const release=fixture.advance({id:40,date:'2026-10-05',price:120,time});release.command('plan');
    const base=release.state();assert.equal(await ordinaryCalendarEligible(base,release.frontend),'ui_only');
    const mutations=[s=>delete s.carry,s=>{s.decision.publish=false;},s=>{s.decision.mode='design';},s=>{s.decision.migration=true;},
      ...['correction','activation','renewal','limited','designCarryPreview','publisherTooling','sourceRecovery'].map(key=>s=>{s[key]={};}),
      s=>{s.source.repair={};},s=>{s.ordinaryCarryAdmission={};},s=>{s.ordinaryCarryTooling={};},s=>{s.source.artifact.id=11691660552;},s=>{s.offlineCalendarIntent=false;}];
    for(const mutate of mutations){const value=structuredClone(base);mutate(value);assert.equal(await ordinaryCalendarEligible(value,release.frontend),null);}
    const published=structuredClone(base);published.offlineCalendarIntent=false;published.source.receiptHash='a'.repeat(64);published.source.publication={};
    assert.equal(await ordinaryCalendarEligible(published,release.frontend),'published_input');
  }finally{fixture.cleanup();}
});

test('source prices, recorded baseline, replay input and derivation receipts cannot be co-mutated',{timeout:120000},async()=>{
  const fixture=lifecycleFixture({omitAcquiredHistory:true,calendarCheckout:true});
  try{
    fixture.seed();write(join(fixture.root,'event.json'),{inputs:{ui_only:true}});
    const release=fixture.advance({id:40,date:'2026-10-05',price:120,time,withoutCalendar:true});release.command('plan');release.command('restore');
    const root=join(release.frontend,'public'),chartPath=join(root,'static-data/charts/OWNED.json'),chart=read(chartPath);
    const changed=structuredClone(chart);changed.bars[0].open+=.01;write(chartPath,changed);
    assert.match(release.command('prepare-carry',{allowFailure:true}).stderr,/authenticated restored input inventory changed/);write(chartPath,chart);
    const producer=join(release.frontend,'tools/export-book-benchmark.py'),producerBytes=readFileSync(producer);
    writeFileSync(producer,Buffer.concat([producerBytes,Buffer.from('\n# unreviewed change\n')]));
    assert.notEqual(release.command('prepare-carry',{allowFailure:true}).status,0);writeFileSync(producer,producerBytes);
    const retained=join(root,'static-data/candidate-history/retained-history.json'),retainedBytes=readFileSync(retained);
    writeFileSync(retained,'changed historical provenance');assert.match(release.command('prepare-carry',{allowFailure:true}).stderr,/authenticated restored input inventory changed/);writeFileSync(retained,retainedBytes);
    release.command('prepare-carry');release.build();release.command('compose');
    const state=release.state(),statePath=join(release.root,'runner/verified-publication/state.json');
    const zipPath=join(release.root,'runner/verified-publication',`artifact-${state.source.artifact.id}`,'artifact.zip'),zip=readFileSync(zipPath);
    writeFileSync(zipPath,Buffer.concat([zip,Buffer.from('tamper')]));assert.match(release.command('recheck',{allowFailure:true}).stderr,/Artifact archive digest mismatch/);writeFileSync(zipPath,zip);
    const baselinePath=join(state.carry.baseline,'static-data/trading-calendar.json'),before=readFileSync(baselinePath);
    write(baselinePath,{fake:true});assert.match(release.command('recheck',{allowFailure:true}).stderr,/stored baseline changed/);writeFileSync(baselinePath,before);
    const inputPath=join(state.carry.calendar.evidence,'input/static-data/charts/OWNED.json'),input=readFileSync(inputPath);
    write(inputPath,changed);assert.match(release.command('recheck',{allowFailure:true}).stderr,/original replay input changed/);writeFileSync(inputPath,input);
    const eventPath=join(fixture.root,'event.json');write(eventPath,{inputs:{ui_only:false}});
    assert.match(release.command('recheck',{allowFailure:true}).stderr,/UI-only intent changed/);write(eventPath,{inputs:{ui_only:true}});
    // Even if both the stored baseline and its claimed digest are changed, a
    // new independent export must reproduce the original baseline exactly.
    const auditPath=join(state.carry.baseline,'qualification-audit.json'),audit=readFileSync(auditPath);
    const poisoned=JSON.parse(audit);poisoned.results[0].methods.minervini.qualified=true;write(auditPath,poisoned);
    const {dataInventory}=await import('./financial-correction.mjs');const {inventoryDigest}=await import('./publication-state.mjs');
    state.carry.calendar.proof.baseline_inventory_sha256=inventoryDigest(dataInventory(state.carry.baseline));write(statePath,state);
    const publicationPath=join(release.dist,'publication.json'),publication=read(publicationPath);publication.ordinary_calendar_derivation=state.carry.calendar.proof;write(publicationPath,publication);
    assert.match(release.command('recheck',{allowFailure:true}).stderr,/independent complete baseline changed/);
  }finally{fixture.cleanup();}
});

test('workflow restores authenticated offline inputs before installing its runtime and skips optional provider enrichment',()=>{
  const workflow=readFileSync(new URL('../workflows/research-ui-release.yml',import.meta.url),'utf8');
  const restore=workflow.indexOf('run: node .github/scripts/select-release-source.mjs restore'),runtime=workflow.indexOf('name: Install isolated offline session calendar runtime'),carry=workflow.indexOf('name: Carry the active financial source');
  assert.ok(restore>=0&&runtime>restore&&carry>runtime);
  const step=workflow.slice(workflow.indexOf('name: Prepare workbench using verified published evidence'),carry);
  assert.match(step,/steps\.restore\.outputs\.offline_session_calendar != 'true'/);
  assert.match(workflow.slice(runtime,carry),/session-calendar-requirements\.txt/);
  const source=readFileSync(new URL('./select-release-source.mjs',import.meta.url),'utf8');
  assert.ok(source.indexOf('const calendar=await prepareOrdinaryCalendar')<source.indexOf("execFileSync(process.execPath,['tools/export-research.mjs'],{cwd:frontend,env,stdio:'inherit'});",source.indexOf('async function prepareCarry')));
  assert.match(source,/await verifyOrdinaryCalendar\(\{state,frontend,root,restoreSource:destination=>materialize/);
});

for(const packedTransport of [false,true])test(`new gated UI uses equal-date authenticated published input, packed source=${packedTransport}`,{timeout:120000},async()=>{
  const fixture=lifecycleFixture({calendarCheckout:true,packedTransport,withoutSeedCalendar:true});
  try{
    fixture.seed();if(packedTransport)fixture.recaptureSeedPublicationArtifact();
    const release=fixture.advance({id:40,date:'2026-10-02',price:100,time});
    // A real immutable new selected Git revision, with the same reviewed price
    // compiler, and explicit synthetic successful exact-main push gate evidence.
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
    const command=name=>release.command(name,{env:{RELEASE_SHA:revision}});
    command('plan');assert.equal(release.state().decision.mode,'ui');assert.ok(release.state().source.receiptHash);
    command('restore');assert.equal(release.state().ordinaryCalendarSource.route,'published_input');
    assert.equal(existsSync(join(release.frontend,'public/static-data/trading-calendar.json')),false);
    command('prepare-carry');
    writeFileSync(join(release.frontend,'public/index.html'),'<!doctype html><title>New exact-gated synthetic UI</title>');
    writeFileSync(join(release.frontend,'public/sw.js'),'// new tested synthetic worker\n');
    if(packedTransport)writeFileSync(join(release.frontend,'public/static-transport-capability.json'),readFileSync(join(fixture.liveRoot,'static-transport-capability.json')));
    release.build();command('compose');command('recheck');
    const receipt=read(join(release.dist,'publication.json'));
    assert.equal(receipt.ui_sha,revision);assert.equal(receipt.ordinary_calendar_derivation.route,'published_input');
    assert.equal(receipt.verification_universe.as_of_date,'2026-10-02');assert.equal(receipt.financial_lineage_sha256,fixture.lineage.id);
    assert.equal(Boolean(receipt.transport),packedTransport);
  }finally{fixture.cleanup();}
});
