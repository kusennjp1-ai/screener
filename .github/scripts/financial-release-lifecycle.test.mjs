import {financialAuditInventory,assertFinancialAuditPreserved} from './financial-audit-history.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lifecycleFixture,read,sourceTime} from './fixtures/financial-release-lifecycle.mjs';
import {verifyFinancialReleaseAssets} from './financial-release-activation.mjs';
import {currentFinancialHistory} from '../../frontend/src/static/financialCurrent.js';
import {encodeResearchIndex,decodeResearchIndex} from '../../frontend/src/static/researchTransport.js';
import {readCarryTargetBase} from './financial-generation-carry-controller.mjs';
import {instrumentIdentityEvidence} from '../../frontend/src/static/instrumentApplicability.js';
import {sha256} from './publication-state.mjs';
import {priceObservationDigest} from './price-observations.mjs';

const stateModule=fileURLToPath(new URL('./publication-state.mjs',import.meta.url));
function readDeployed(fixture){
  // Use the real live reader in a fresh process, including its lazy financial
  // receipt import, successful deployment anchor and approved UI byte checks.
  const result=fixture.success(fixture.invoke('--input-type=module',['-e',`import {livePublication} from ${JSON.stringify(stateModule)}; console.log(JSON.stringify(await livePublication()));`],fixture.root),'read deployed receipt');
  return JSON.parse(result.stdout);
}
const research=dist=>{const manifest=read(join(dist,'static-data/manifest.json'));return decodeResearchIndex(read(join(dist,'static-data',manifest.markets.US.assets.research.path)));};

test('strict carry lifecycle restores the published source and preserves it through three advancing releases', {timeout:120000},()=>{
  const fixture=lifecycleFixture();
  try{
    fixture.seed();
    const initial=readDeployed(fixture),initialHistory=read(join(fixture.liveRoot,'static-data/candidate-history/index.json'));
    assert.equal(initial.financialRelease.mode,'activation');
    assert.equal(initial.financialRelease.evaluated_at,sourceTime);
    const historyBytes=readFileSync(join(fixture.liveRoot,'static-data/candidate-history/retained-history.json'));
    const original=fixture.original.value.symbols.OWNED;
    let previous=initial;
    let previousHistory=initialHistory;
    for(const [index,target]of [
      {id:40,date:'2026-10-05',price:120,time:'2026-10-05T12:00:00.000Z'},
      {id:50,date:'2026-10-06',price:130,time:'2026-10-06T12:00:00.000Z'},
      {id:60,date:'2026-10-07',price:140,time:'2026-10-07T12:00:00.000Z'},
    ].entries()){
      const previousAudit=financialAuditInventory(fixture.liveRoot);
      const release=fixture.advance(target);
      release.command('plan');
      assert.match(readFileSync(release.output,'utf8'),/publish=true\n/);
      assert.match(readFileSync(release.output,'utf8'),/mode=data\n/);
      assert.match(readFileSync(release.output,'utf8'),/carry=true\n/);
      assert.equal(release.state().live.identity,previous.identity);
      release.command('restore');
      const restored=release.state();
      assert.equal(readFileSync(join(restored.carry.sourceRoot,previous.financialRelease.source_projection.path),'utf8'),fixture.original.bytes);
      release.command('prepare-carry');
      const carry=read(release.state().carry.projectionPath);
      assert.equal(carry.financial_evaluated_at,target.time);
      assert.equal(carry.source_projection_json,fixture.original.bytes);
      assert.equal(carry.source_base_json,fixture.original.base);
      assert.deepEqual(carry.receipt_inventory,fixture.original.value.receipt_inventory);
      assert.equal(carry.bindings.previous_publication_identity,previous.identity);
      assert.equal(carry.bindings.source_lineage_sha256,initial.financialRelease.lineage_sha256);
      assert.deepEqual(carry.symbols.OWNED.source_receipts,original.source_receipts);
      assert.deepEqual(carry.symbols.OWNED.financial_current.p,original.financial_current.p);
      const current=currentFinancialHistory(carry.symbols.OWNED.financial_history,'OWNED',target.date,Date.parse(target.time));
      assert.deepEqual(current.annual,[],'the original annual history expires without erasing its retained source');
      assert.equal(current.quarterly.length,index===0?2:0,'quarterly history expires on its own source clock');
      assert.deepEqual(carry.symbols.OWNED.financial_history.annual,original.financial_history.annual);
      assert.deepEqual(carry.symbols.OWNED.financial_history.annual_source,original.financial_history.annual_source);
      release.build();
      release.command('compose');
      const publication=read(join(release.dist,'publication.json'));
      const receipt=verifyFinancialReleaseAssets(release.dist,publication.financial_release,publication);
      assertFinancialAuditPreserved(previousAudit,publication.financial_audit_files);
      assert.deepEqual(financialAuditInventory(release.dist),publication.financial_audit_files);
      assert.deepEqual(read(join(release.dist,initial.receipt.financial_release.path)),initial.financialRelease);
      assert.equal(receipt.mode,'carry');assert.equal(receipt.candidate,null);
      assert.deepEqual(receipt.lineage,initial.financialRelease.lineage);
      assert.deepEqual(receipt.source_projection,initial.financialRelease.source_projection);
      assert.deepEqual(receipt.source_base,initial.financialRelease.source_base);
      assert.equal(receipt.previous_publication_identity,previous.identity);
      assert.equal(publication.ui_digest,initial.uiDigest);
      const indexRows=research(release.dist);
      assert.equal(indexRows.as_of_date,target.date);
      assert.equal(indexRows.rows[0].current_price,target.price);
      assert.equal(indexRows.rows[0].eps_growth_yy,40);
      assert.equal(indexRows.rows[0].financial_current.p['1'][4],original.financial_current.p['1'][4]);
      assert.deepEqual(read(join(release.dist,'static-data/charts/OWNED.json')).bars,
        read(join(release.state().carry.baseline,'static-data/charts/OWNED.json')).bars,'carry preserves every selected OHLCV observation');
      assert.equal(publication.price_observations['["US","chart","OWNED"]'],target.date);
      for(const [key,date]of Object.entries(previous.knownPriceDates))assert.ok(publication.known_price_dates[key]>=date);
      assert.deepEqual(readFileSync(join(release.dist,'static-data/candidate-history/retained-history.json')),historyBytes);
      const history=read(join(release.dist,'static-data/candidate-history/index.json'));
      assert.deepEqual(history.snapshots.slice(0,previousHistory.snapshots.length),previousHistory.snapshots);
      assert.deepEqual(history.snapshots.map(item=>item.as_of),['2026-10-02','2026-10-05','2026-10-06','2026-10-07'].slice(0,index+2));
      release.command('recheck'); // Immediately before upload.

      // A mutation between the two workflow checkpoints must be rejected.
      const projectionPath=join(release.dist,receipt.source_projection.path),saved=readFileSync(projectionPath);
      writeFileSync(projectionPath,Buffer.concat([saved,Buffer.from(' ')]));
      const tampered=release.command('recheck',{allowFailure:true});
      assert.equal(tampered.status,1);assert.match(tampered.stderr,/Financial lineage asset changed/);
      writeFileSync(projectionPath,saved);
      const design=receipt.ui.approval.runs.find(run=>run.path.endsWith('/design-acceptance.yml'));
      const jobsPath=`repos/${receipt.lineage.source.repository}/actions/runs/${design.id}/attempts/${design.attempt}/jobs?per_page=100`;
      const designJob=fixture.config.api[jobsPath][0].jobs[0];
      designJob.conclusion='failure';
      const failedGate=release.command('recheck',{allowFailure:true});
      assert.equal(failedGate.status,1);assert.match(failedGate.stderr,/Correction consumer gate job is not successful/);
      designJob.conclusion='success';
      release.command('recheck'); // Immediately before deployment.

      release.deploy();
      const deployed=readDeployed(fixture);
      assert.equal(deployed.receipt.run_id,target.id);
      assert.equal(deployed.financialRelease.previous_publication_identity,previous.identity);
      assert.deepEqual(deployed.financialRelease,receipt);
      assert.equal(priceObservationDigest(deployed.priceObservations),priceObservationDigest(publication.price_observations));
      // The already-composed predecessor plan loses authority once Pages has
      // converged to a different successful deployment, even with identical UI.
      const superseded=release.command('recheck',{allowFailure:true});
      assert.equal(superseded.status,1);assert.match(superseded.stderr,/discard this superseded publication/);
      previous=deployed;
      previousHistory=history;
    }
    const trace=readFileSync(join(fixture.root,'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(trace.some(item=>item.pages===initial.financialRelease.source_projection.path));
    assert.ok(trace.some(item=>item.api?.endsWith('/actions/artifacts/140/zip')));
    assert.ok(trace.some(item=>item.api?.endsWith('/actions/artifacts/150/zip')));
    assert.ok(trace.every(item=>!item.api||!item.api.includes('/actions/artifacts/20/')),'no expired activation artifact or provider is needed for carry');
  }finally{fixture.cleanup();}
});

const frontendRoot=fileURLToPath(new URL('../../frontend',import.meta.url)),date='2026-10-06';
function carryTargetFixture(t) {
  const root=mkdtempSync(join(tmpdir(),'carry-target-test-')),data=join(root,'static-data');
  mkdirSync(data);t.after(()=>rmSync(root,{recursive:true,force:true}));
  const rows=[
    {symbol:'AAA',market:'US',as_of_date:date,company_name:'Alpha',current_price:20,adv_usd:30000000,
      financial_source_evidence:{identity:{cik:'1234'}},
      financial_historical:{detail_identity:{company_name:'Different observed issuer'},source_evidence:{identity:{quoteType:'EQUITY'}}}},
    {symbol:'BBB',market:'US',as_of_date:date,company_name:'Beta',current_price:30,adv_usd:40000000,
      financial_identity:{observed_scope:{symbol:'BBB',market:'US',as_of_date:date},observed_contexts:[{isin:'US0378331005'}]}},
  ];
  const files={
    'manifest.json':{markets:{US:{as_of_date:date,pages:{scan:{path:'scan.json'}},assets:{research:{path:'research.json'}}}}},
    'scan.json':{as_of_date:date,initial_rows:[rows[0]],chunks:[{path:'chunk.json'}]},
    'chunk.json':{as_of_date:date,rows},
    'research.json':encodeResearchIndex({as_of_date:date,rows}),
  };
  const write=(name,value)=>writeFileSync(join(data,name),JSON.stringify(value));
  const save=()=>Object.entries(files).forEach(([name,value])=>write(name,value));
  save();
  const audit={version:'ohlcv-v1',as_of_date:date,total:2,results:[...rows].reverse().map(row=>({symbol:row.symbol,audit:{version:'ohlcv-v1',symbol:row.symbol,as_of_date:date}}))};
  writeFileSync(join(root,'qualification-audit.json'),JSON.stringify(audit));
  return {root,data,rows,files,write,save,load:()=>readCarryTargetBase({root,frontendRoot})};
}

test('carry target preserves full issuer evidence and approved ordering; identical initial/chunk repeats are safe',async t=>{
  const f=carryTargetFixture(t),before=Object.fromEntries(Object.keys(f.files).map(path=>[path,readFileSync(join(f.data,path))]));
  const first=await f.load(),second=await f.load(),target=JSON.parse(first.bytes);
  assert.equal(first.bytes,second.bytes);
  assert.deepEqual(target.rows.map(row=>row.symbol),['BBB','AAA']);
  const a=target.rows.find(row=>row.symbol==='AAA'),b=target.rows.find(row=>row.symbol==='BBB');
  assert.deepEqual(a.instrument_identity.observed_contexts,instrumentIdentityEvidence(f.rows[0]));
  assert.deepEqual(b.instrument_identity.observed_contexts,instrumentIdentityEvidence(f.rows[1]));
  assert.deepEqual(b.financial_identity,f.rows[1].financial_identity);
  for(const projected of target.rows){
    const raw=f.rows.find(row=>row.symbol===projected.symbol);
    assert.deepEqual(Object.keys(projected).sort(),[...['symbol','market','as_of_date','current_price','adv_usd','financial_identity'].filter(key=>Object.hasOwn(raw,key)),'instrument_identity'].sort());
  }
  const full=JSON.stringify({market:'US',as_of_date:date,rows:first.rows});
  assert.deepEqual(target.input_bindings.raw_full_target,{bytes:Buffer.byteLength(full),sha256:sha256(full),cap_bytes:256*1024*1024,exceeds_unchanged_cap:false});
  assert.deepEqual(target.input_bindings.files.map(pin=>pin.path),['qualification-audit.json','static-data/chunk.json','static-data/manifest.json','static-data/research.json','static-data/scan.json']);
  for(const pin of target.input_bindings.files){const bytes=readFileSync(join(f.root,pin.path));assert.equal(pin.bytes,bytes.length);assert.equal(pin.sha256,sha256(bytes));}
  for(const [path,bytes]of Object.entries(before))assert.deepEqual(readFileSync(join(f.data,path)),bytes,'reading target changes no source bytes');
});

for(const [name,change,pattern]of [
  ['missing declared chunk',f=>{f.files['scan.json'].chunks=[{path:'absent.json'}];},/ENOENT/],
  ['omitted chunk membership',f=>{f.files['scan.json'].chunks=[];},/universe mismatch/],
  ['duplicate chunk declaration',f=>{f.files['scan.json'].chunks.push({path:'chunk.json'});},/duplicate carry target chunk/],
  ['conflicting duplicate copy',f=>{f.files['scan.json'].initial_rows=[{...f.rows[0],company_name:'Other'}];},/Conflicting carry target copies/],
  ['mixed chunk date',f=>{f.files['chunk.json'].as_of_date='2026-10-05';},/snapshot dates/],
  ['manifest date',f=>{f.files['manifest.json'].markets.US.as_of_date='2026-10-05';},/manifest\/scan date/],
  ['Research date',f=>{f.files['research.json'].as_of_date='2026-10-05';},/Research snapshot/],
  ['Research duplicate membership',f=>{f.files['research.json']={as_of_date:date,rows:[f.rows[0],f.rows[0]]};},/universe mismatch/],
  ['Research omitted membership',f=>{f.files['research.json']={as_of_date:date,rows:[f.rows[0]]};},/universe mismatch/],
  ['Research market',f=>{f.files['research.json']={as_of_date:date,rows:f.rows.map(row=>({...row,market:'JP'}))};},/scope mismatch/],
  ['Research row date',f=>{f.files['research.json']={as_of_date:date,rows:f.rows.map(row=>({...row,as_of_date:'2026-10-05'}))};},/scope mismatch/],
  ['Research price',f=>{f.files['research.json']={as_of_date:date,rows:f.rows.map(row=>({...row,current_price:row.current_price+1}))};},/current_price mismatch/],
  ['Research liquidity',f=>{f.files['research.json']={as_of_date:date,rows:f.rows.map(row=>({...row,adv_usd:row.adv_usd+1}))};},/adv_usd mismatch/],
  ['unsafe chunk path',f=>{f.files['scan.json'].chunks=[{path:'../outside.json'}];},/carry target chunk/],
  ['malformed rows',f=>{f.files['chunk.json'].rows={};},/Invalid carry target rows/],
])test('carry target rejects '+name,async t=>{const f=carryTargetFixture(t);change(f);f.save();await assert.rejects(f.load,pattern);});

test('carry target rejects linked chunk bytes',async t=>{
  const f=carryTargetFixture(t);unlinkSync(join(f.data,'chunk.json'));symlinkSync(join(f.data,'research.json'),join(f.data,'chunk.json'));
  await assert.rejects(f.load,/Linked carry target input/);
});

for(const [label,modify]of [
  ['absent date',row=>{delete row.as_of_date;}],
  ['explicit null date',row=>{row.as_of_date=null;}],
  ['absent financial identity',row=>{delete row.financial_identity;}],
  ['explicit null financial identity',row=>{row.financial_identity=null;}],
  ['prior observed scopes',row=>{row.financial_identity={observed_scope:{symbol:row.symbol,market:'US',as_of_date:'2026-10-05'},prior_observed_scopes:[{symbol:row.symbol,market:'US',as_of_date:'2026-10-02'}]};}],
])test('carry projection preserves '+label,async t=>{
  const f=carryTargetFixture(t);modify(f.rows[0]);f.files['research.json']=encodeResearchIndex({as_of_date:date,rows:f.rows});f.save();
  const target=JSON.parse((await f.load()).bytes),row=target.rows.find(row=>row.symbol==='AAA');
  for(const key of ['as_of_date','financial_identity']){assert.equal(Object.hasOwn(row,key),Object.hasOwn(f.rows[0],key));assert.deepEqual(row[key],f.rows[0][key]);}
  assert.deepEqual(row.instrument_identity.observed_contexts,instrumentIdentityEvidence(f.rows[0]));
});

test('carry reader uses the selected frontend runtime',async t=>{
  const f=carryTargetFixture(t);
  await assert.rejects(()=>readCarryTargetBase({root:f.root,frontendRoot:join(f.root,'unselected-runtime')}),/Cannot find module|ERR_MODULE_NOT_FOUND/);
});


test('carry binds full observed issuer evidence omitted by compact Research', {timeout:120000},()=>{
  const fixture=lifecycleFixture();
  try{
    fixture.seed();
    const release=fixture.advance({id:40,date:'2026-10-05',price:120,time:'2026-10-05T12:00:00.000Z'});
    release.command('plan');release.command('restore');
    const root=join(release.frontend,'public/static-data');
    const manifest=read(join(root,'manifest.json')),scanPath=manifest.markets.US.pages.scan.path,scan=read(join(root,scanPath));
    const observed={company_name:'Conflicting historical issuer'};
    for(const path of [scanPath,...(scan.chunks||[]).map(chunk=>chunk.path)]){
      const payload=read(join(root,path));
      for(const key of ['rows','initial_rows','preview_rows','results','stocks','members'])if(Array.isArray(payload[key]))
        payload[key]=payload[key].map(row=>row.symbol==='OWNED'?{...row,financial_historical:{...row.financial_historical,detail_identity:observed}}:row);
      writeFileSync(join(root,path),JSON.stringify(payload));
    }
    release.command('prepare-carry');
    const carry=read(release.state().carry.projectionPath),target=JSON.parse(carry.target_base_json);
    assert.ok(target.rows.find(row=>row.symbol==='OWNED').instrument_identity.observed_contexts.some(context=>context.company_name===observed.company_name));
    assert.equal(carry.ownership.OWNED,'identity_mismatch');
    assert.ok(Object.values(carry.symbols.OWNED.financial_values).every(value=>value===null));
    assert.deepEqual(carry.symbols.OWNED.source_receipts,[]);
    assert.deepEqual(carry.symbols.OWNED.financial_history.annual,[]);
    assert.deepEqual(carry.symbols.OWNED.financial_history.quarterly,[]);
    release.build();release.command('compose');release.command('recheck');
    const row=research(release.dist).rows.find(row=>row.symbol==='OWNED');
    assert.equal(row.eps_growth_yy,null);
  }finally{fixture.cleanup();}
});
