import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {lifecycleFixture,read,sourceDate,sourceTime} from './fixtures/financial-release-lifecycle.mjs';
import {syntheticHistoryPriceTarget} from './fixtures/financial-history-price-target.mjs';
import {verifyCarriedBundle} from './financial-generation-carry-controller.mjs';
import {verifyCarryCompatibility} from '../../frontend/tools/financial-generation-carry.mjs';

const target={id:40,date:'2026-10-05',price:120,time:'2026-10-05T12:00:00.000Z'};
const historyPath='static-data/financial-history.json';

test('synthetic history changes only its containing price date, preserving source clocks and removed-symbol history',()=>{
  const before={as_of_date:sourceDate,retrieved_at:sourceTime,results:{REMOVED:{symbol:'REMOVED',as_of_date:sourceDate,
    retrieved_at:'2026-10-02T00:00:00Z',annual_source:{observed_at:'2026-10-01T00:00:00Z'},
    quarterly_retrieved_at:'2026-10-02T00:00:00Z',annual:[{end:'2025-12-31',eps:1}],quarterly:[]}}};
  const saved=structuredClone(before),after=syntheticHistoryPriceTarget(before,sourceDate,target.date);
  assert.deepEqual(before,saved);
  assert.deepEqual(after,{...saved,as_of_date:target.date});
  for(const date of [sourceDate,'2026-09-30','2026-02-30',null])assert.throws(()=>syntheticHistoryPriceTarget(before,sourceDate,date));
  assert.throws(()=>syntheticHistoryPriceTarget({...before,as_of_date:'2026-10-01'},sourceDate,target.date));
});

test('a fresh price export without history fails the strict carry presence check', {timeout:120000},()=>{
  const fixture=lifecycleFixture();
  try {
    fixture.seed();
    const release=fixture.advance({...target,financialHistory:false});
    for(const command of ['plan','restore','prepare-carry'])release.command(command);
    assert.equal(existsSync(join(release.state().carry.baseline,historyPath)),false);
    release.build();
    assert.equal(read(join(release.dist,historyPath)).as_of_date,target.date);
    const result=release.command('compose',{allowFailure:true});
    assert.equal(result.status,1);
    assert.match(result.stderr,/Correction changed derived asset presence: static-data\/financial-history\.json/);
  } finally {fixture.cleanup();}
});

for(const repair of [false,true])test(`copied prior history ${repair?'passes the complete carry comparison after fixture date repair':'reproduces the exact archive compose failure'}`,{timeout:120000},async()=>{
  const fixture=lifecycleFixture();
  try {
    fixture.seed();
    const prior=read(join(fixture.liveRoot,historyPath)),source=fixture.original.value.symbols.OWNED;
    // Keep a removed symbol outside the active carry's ownership as well.
    prior.results.REMOVED={symbol:'REMOVED',as_of_date:sourceDate,retrieved_at:'2026-10-02T01:00:00Z',annual:[{end:'2025-12-31',eps:1}],quarterly:[]};
    const history=repair?syntheticHistoryPriceTarget(prior,sourceDate,target.date):prior;
    const release=fixture.advance({...target,financialHistory:history});
    for(const command of ['plan','restore','prepare-carry'])release.command(command);
    const state=release.state(),carry=read(state.carry.projectionPath),baselineHistory=read(join(state.carry.baseline,historyPath));
    assert.deepEqual(baselineHistory,history,'ordinary exporter must not silently redate source history');
    assert.equal(carry.financial_evaluated_at,target.time);
    assert.equal(carry.symbols.OWNED.financial_current.t,source.financial_current.t);
    assert.deepEqual(carry.symbols.OWNED.financial_current.p,source.financial_current.p);
    assert.deepEqual(carry.symbols.OWNED.source_receipts,source.source_receipts);
    assert.deepEqual(carry.symbols.OWNED.financial_history,{...source.financial_history,as_of_date:target.date});
    release.build();
    await verifyCarryCompatibility({root:join(release.dist,'static-data'),carry,evaluatedAt:target.time});
    const composed=release.command('compose',{allowFailure:true});
    if(!repair){
      assert.equal(composed.status,1);
      assert.match(composed.stderr,/Correction changed protected derived metadata static-data\/financial-history\.json at \$\["as_of_date"\]/);
      return;
    }
    fixture.success(composed,'compose repaired inherited history');
    const result=read(join(release.dist,historyPath));
    assert.equal(result.as_of_date,target.date);
    assert.deepEqual(result.results.OWNED,{...source.financial_history,as_of_date:target.date});
    assert.deepEqual(result.results.REMOVED,prior.results.REMOVED);
    const published=read(join(release.dist,'publication.json'));
    assert.equal(published.price_observations['["US","chart","OWNED"]'],target.date);
    for(const key of ['source_projection','source_base']){
      const ref=published.financial_release;
      const receipt=read(join(release.dist,ref.path));
      const expected=key==='source_projection'?fixture.original.bytes:fixture.original.base;
      assert.equal(readFileSync(join(release.dist,receipt[key].path),'utf8'),expected);
    }
    release.command('recheck');
    const prepared=release.state();
    const verify=()=>verifyCarriedBundle({baselineRoot:state.carry.baseline,root:release.dist,frontendRoot:release.frontend,
      carry,evaluatedAt:target.time,excludePaths:prepared.financialPrepared.added});
    // Exercise every same-path derived metadata family in the strict comparator
    // in one bounded pass, as well as source clocks and unowned history cells.
    for(const [path,mutate,expected]of [
      [historyPath,value=>value.as_of_date=sourceDate,/protected derived metadata.*as_of_date/],
      [historyPath,value=>value.results.REMOVED.annual[0].eps=2,/protected derived metadata.*REMOVED/],
      [historyPath,value=>value.results.REMOVED.retrieved_at=target.time,/protected derived metadata.*retrieved_at/],
      [historyPath,value=>value.results.OWNED.retrieved_at=target.time,/history mismatch OWNED/],
      ['research-daily.json',value=>value.as_of_date=sourceDate,/protected derived metadata.*as_of_date/],
      ['qualification-audit.json',value=>value.as_of_date=sourceDate,/protected derived metadata.*as_of_date/],
      ['portfolio-model.json',value=>value.generated_at='2099-01-01T00:00:00Z',/protected derived metadata.*generated_at/],
    ]) {
      const file=join(release.dist,path),saved=readFileSync(file),value=JSON.parse(saved);
      mutate(value);writeFileSync(file,JSON.stringify(value));
      try{await assert.rejects(verify,expected);}finally{writeFileSync(file,saved);}
    }
    release.command('recheck');
  } finally {fixture.cleanup();}
});
