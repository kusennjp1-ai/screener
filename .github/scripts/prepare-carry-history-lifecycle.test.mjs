// Synthetic offline regression, not an admission or live publication replay.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {lifecycleFixture,read} from './fixtures/financial-release-lifecycle.mjs';
import {verifyCarriedBundle} from './financial-generation-carry-controller.mjs';

test('generic carry without provider history prepares a baseline and passes unchanged invariance', {timeout:120000},async()=>{
  const fixture=lifecycleFixture({omitAcquiredHistory:true});
  try{
    fixture.seed();
    const time='2026-10-05T12:00:00.000Z';
    const release=fixture.advance({id:40,date:'2026-10-05',price:120,time});
    release.command('plan');release.command('restore');
    const history=join(release.frontend,'public/static-data/financial-history.json');
    assert.equal(existsSync(history),false,'the selected normal source really lacks provider history');
    release.command('prepare-carry');
    const state=release.state(),baselineHistory=join(state.carry.baseline,'static-data/financial-history.json');
    assert.deepEqual(read(baselineHistory),{as_of_date:'2026-10-05',results:{},coverage:{eligible:0,requested:0,available:0,four_annual_eps:0}});
    assert.deepEqual(readFileSync(history),readFileSync(baselineHistory));
    const before=readFileSync(baselineHistory);
    release.build();
    const carry=read(state.carry.projectionPath);
    const result=await verifyCarriedBundle({baselineRoot:state.carry.baseline,root:release.dist,frontendRoot:release.frontend,carry,evaluatedAt:Date.parse(time)});
    assert.equal(typeof result.equality.semantic_sha256,'string');
    assert.deepEqual(readFileSync(baselineHistory),before);
    assert.deepEqual(read(join(release.dist,'static-data/charts/OWNED.json')).bars,read(join(state.carry.baseline,'static-data/charts/OWNED.json')).bars);
    // Reintroducing the original missing-baseline defect must still fail the
    // unchanged derived-presence guard; preparation did not exempt the file.
    rmSync(baselineHistory);
    await assert.rejects(verifyCarriedBundle({baselineRoot:state.carry.baseline,root:release.dist,frontendRoot:release.frontend,carry,evaluatedAt:Date.parse(time)}),/Correction changed derived asset presence: static-data\/financial-history.json/);
  }finally{fixture.cleanup();}
});
