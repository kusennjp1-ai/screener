// Opt-in integration boundary using immutable, operator-supplied original ZIPs.
// GitHub gate/deployment responses are synthetic transport fixtures: a passing
// test grants no real CI approval, activation pin, upload or deployment.
// FINANCIAL_RELEASE_ARCHIVE_INPUT must name a JSON file accepted by the helper.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {dataInventory} from './financial-correction.mjs';
import {inventoryDigest,uiInventory,sha256} from './publication-state.mjs';
import {extractPriceObservations,priceObservationDigest} from './price-observations.mjs';
import {validateCandidateRecord} from './financial-release-activation.mjs';
import {archiveApiPayload,assertSyntheticPriceAdvance,assertOriginalFinancialClocks,archiveCandidateRecord,verifyArchiveCandidate,runArchiveLifecycle} from './fixtures/financial-release-archive-lifecycle.mjs';

// The external monotonic supervisor owns enforcement. Preserve the existing
// maximum allocation; a cooperative timer cannot stop synchronous child work.
const watchdogSeconds=Number(process.env.FINANCIAL_RELEASE_ARCHIVE_WATCHDOG_SECONDS||1800);
assert.ok(Number.isFinite(watchdogSeconds)&&watchdogSeconds>0&&watchdogSeconds<=4500,'invalid lifecycle watchdog allocation');

test('offline gh preserves paginated gates and bounded certificate/source inventories',()=>{
  for(const key of ['jobs','artifacts','workflow_runs']){
    const pages=[{[key]:[{id:7}]}];
    assert.equal(archiveApiPayload(pages,true),pages);
    assert.deepEqual(archiveApiPayload(pages,false),{total_count:1,[key]:[{id:7}]});
  }
  const run={id:7,status:'completed'};
  assert.equal(archiveApiPayload(run,false),run);
});

test('offline gh does not hide incomplete or ambiguous bounded fixture inventories',()=>{
  assert.throws(()=>archiveApiPayload([],false),/Unexpected bounded/);
  assert.throws(()=>archiveApiPayload([{jobs:[]},{jobs:[]}],false),/Unexpected bounded/);
  assert.throws(()=>archiveApiPayload([{jobs:[],artifacts:[]}],false),/Ambiguous bounded/);
  assert.deepEqual(archiveApiPayload([{total_count:3,jobs:[]}],false),{total_count:3,jobs:[]});
});

test('the synthetic price feed preserves every historical OHLCV cell and adds one declared observation',()=>{
  const before=[{date:'2026-10-01',open:10,high:12,low:9,close:11,volume:100},{date:'2026-10-02',open:11,high:12,low:10,close:12,volume:110}];
  const after=[...structuredClone(before),{...before.at(-1),date:'2026-10-05'}];
  assert.doesNotThrow(()=>assertSyntheticPriceAdvance(before,after,'2026-10-05'));
  const changed=structuredClone(after);changed[0].low=8;
  assert.throws(()=>assertSyntheticPriceAdvance(before,changed,'2026-10-05'),/historical OHLCV prefix/);
  assert.throws(()=>assertSyntheticPriceAdvance(before,after.slice(1),'2026-10-05'),/exactly one/);
  const repriced=structuredClone(after);repriced.at(-1).close=13;
  assert.throws(()=>assertSyntheticPriceAdvance(before,repriced,'2026-10-05'),/final recorded price/);
});

function rawCandidate(t){
  const root=mkdtempSync(join(tmpdir(),'archive-candidate-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const corrected=join(root,'corrected'),write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof value==='string'?value:JSON.stringify(value));};
  const manifest={markets:{US:{assets:{charts:{path:'charts/index.json'}}}}};
  write(join(corrected,'index.html'),'exact captured UI');write(join(corrected,'static-data/manifest.json'),manifest);
  write(join(corrected,'static-data/charts/index.json'),{symbols:[{symbol:'OWNED',path:'charts/OWNED.json'}]});
  write(join(corrected,'static-data/charts/OWNED.json'),{symbol:'OWNED',bars:[{date:'2026-10-02',close:17}]});
  const preview={candidate_ui:{sha:'a'.repeat(40),tree:'b'.repeat(40),digest:inventoryDigest(uiInventory(corrected))},
    bundles:{corrected_data_sha256:inventoryDigest(dataInventory(corrected))},financial:{evaluated_at:'2026-10-04T12:00:00Z'},
    previous_publication:{price_observations_sha256:priceObservationDigest(extractPriceObservations({dataRoot:join(corrected,'static-data'),manifest}))}};
  write(join(root,'preview-receipt.json'),preview);write(join(root,'protected-code.json'),{});
  const options={candidate:root,repositoryRoot:fileURLToPath(new URL('../..',import.meta.url)),restore:join(root,'logical')};
  return {root,corrected,preview,write,options};
}

test('archive preflight preserves raw candidates and binds their captured logical UI, data and prices',async t=>{
  const f=rawCandidate(t),proof=await verifyArchiveCandidate(f.options);
  assert.equal(proof.representation,'raw');assert.equal(proof.candidate_schema,'financial-release-candidate-v1');
  assert.equal(existsSync(f.options.restore),false);assert.equal(Object.hasOwn(proof,'transport_sha256'),false);
  const record=archiveCandidateRecord({candidate:f.root,preview:f.preview,request:{fixture:true},proof});
  assert.equal(validateCandidateRecord(record),record);assert.equal(record.schema_version,'financial-release-candidate-v1');
  f.preview.previous_publication.price_observations_sha256='0'.repeat(64);f.write(join(f.root,'preview-receipt.json'),f.preview);
  await assert.rejects(()=>verifyArchiveCandidate(f.options),/captured logical price observations/);
});

test('archive preflight fails closed on undeclared packed data or changed captured UI/data',async t=>{
  for(const kind of ['ui','data','undeclared']){
    const f=rawCandidate(t);
    if(kind==='ui')f.write(join(f.corrected,'index.html'),'different UI');
    if(kind==='data')f.write(join(f.corrected,'static-data/extra.json'),{});
    if(kind==='undeclared')f.write(join(f.corrected,'static-data/_transport/root.json'),{});
    await assert.rejects(()=>verifyArchiveCandidate(f.options),/captured logical|missing or undeclared/);
  }
});

test('packed archive records require their own v2 transport seal and retain physical inventory identity',async t=>{
  const f=rawCandidate(t),proof=await verifyArchiveCandidate(f.options);
  f.write(join(f.root,'transport.json'),'exact authenticated transport descriptor');
  const packed={...proof,representation:'packed',candidate_schema:'financial-release-candidate-v2',transport_sha256:sha256(readFileSync(join(f.root,'transport.json')))};
  const record=archiveCandidateRecord({candidate:f.root,preview:f.preview,request:{fixture:true},proof:packed});
  assert.equal(validateCandidateRecord(record),record);assert.equal(record.transport_sha256,packed.transport_sha256);
  assert.equal(record.corrected_inventory_sha256,proof.corrected_inventory_sha256);
  assert.throws(()=>validateCandidateRecord({...record,schema_version:'financial-release-candidate-v1'}),/closed financial release candidate record/);
  delete record.transport_sha256;assert.throws(()=>validateCandidateRecord(record),/closed financial release candidate record/);
});

test('next-price evaluation retains original source bytes, receipt clocks and proof tuples',()=>{
  const source={financial_evaluated_at:'2026-10-04T12:00:00.000Z',symbols:{OWNED:{source_receipts:[{observed_at:'2026-10-03T09:00:00Z'}],financial_current:{p:[['original-proof',123]],t:100}}}};
  const bytes=JSON.stringify(source),time='2026-10-05T12:00:00.000Z';
  const carry={source_projection_json:bytes,financial_evaluated_at:time,ownership:{OWNED:'retained'},symbols:structuredClone(source.symbols)};
  assert.doesNotThrow(()=>assertOriginalFinancialClocks(bytes,carry,time));
  for(const change of [v=>v.source_projection_json+=' ',v=>v.financial_evaluated_at=source.financial_evaluated_at,
    v=>v.symbols.OWNED.source_receipts[0].observed_at=time,v=>v.symbols.OWNED.financial_current.p[0][1]++,v=>v.symbols.OWNED.financial_current.t++,v=>v.ownership={}]){
    const bad=structuredClone(carry);change(bad);assert.throws(()=>assertOriginalFinancialClocks(bytes,bad,time));
  }
});

test('real retained source passes the strict first-activation publication lifecycle',{
  skip:!process.env.FINANCIAL_RELEASE_ARCHIVE_INPUT,
  timeout:watchdogSeconds*1000,
},async()=>{
  await runArchiveLifecycle(process.env.FINANCIAL_RELEASE_ARCHIVE_INPUT);
});
