// Opt-in integration boundary using immutable, operator-supplied original ZIPs.
// GitHub gate/deployment responses are synthetic transport fixtures: a passing
// test grants no real CI approval, activation pin, upload or deployment.
// FINANCIAL_RELEASE_ARCHIVE_INPUT must name a JSON file accepted by the helper.
import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveApiPayload,assertSyntheticPriceAdvance,runArchiveLifecycle} from './fixtures/financial-release-archive-lifecycle.mjs';

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

test('real retained source passes the strict first-activation publication lifecycle',{
  skip:!process.env.FINANCIAL_RELEASE_ARCHIVE_INPUT,
  timeout:30*60*1000,
},async()=>{
  await runArchiveLifecycle(process.env.FINANCIAL_RELEASE_ARCHIVE_INPUT);
});
