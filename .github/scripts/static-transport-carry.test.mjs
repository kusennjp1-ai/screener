import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lifecycleFixture,read,sourceTime} from './fixtures/financial-release-lifecycle.mjs';
import {canonicalPublication} from './static-transport-publication.mjs';
import {verifyFinancialReleaseAssets} from './financial-release-activation.mjs';
import {verifyPredecessor} from './financial-candidate-preview.mjs';
import {currentFinancialHistory} from '../../frontend/src/static/financialCurrent.js';
import {sha256} from './publication-state.mjs';

const frontend=fileURLToPath(new URL('../../frontend',import.meta.url));
test('packed approved UI survives two real carry lifecycles with original price bytes and expiring source clocks',{timeout:120000},async()=>{
  const fixture=lifecycleFixture({packedTransport:true});
  try{
    fixture.seed();
    const initial=read(join(fixture.liveRoot,'publication.json'));
    assert.ok(initial.transport);const originalSource=fixture.original.value.symbols.OWNED;
    const manifestHash=sha256(readFileSync(join(fixture.liveRoot,'static-data/manifest.json')));
    const identity=`30/1/${sha256(readFileSync(join(fixture.liveRoot,'publication.json')))}/${manifestHash}`;
    const predecessor=await verifyPredecessor(fixture.liveRoot,{receipt:initial,uiSha:initial.ui_sha,uiDigest:initial.ui_digest,manifestHash,identity,
      latest:{runId:30,attempt:1,headSha:initial.controller_sha,jobStarted:Date.parse(sourceTime),started:Date.parse(sourceTime)+60000}},
    {id:90,name:initial.artifact_name,workflow_run:{id:30,head_sha:initial.controller_sha},digest:`sha256:${'a'.repeat(64)}`,created_at:sourceTime},identity,frontend);
    assert.equal(predecessor.data_inventory_sha256,initial.data_inventory_sha256);
    assert.equal(readFileSync(join(predecessor.logicalRoot,initial.financial_release.path),'utf8'),readFileSync(join(fixture.liveRoot,initial.financial_release.path),'utf8'));
    rmSync(predecessor.logicalRoot,{recursive:true,force:true});
    let last=initial;
    for(const target of [{id:40,date:'2026-10-05',price:120,time:'2026-10-05T12:00:00.000Z'},{id:50,date:'2026-10-06',price:130,time:'2026-10-06T12:00:00.000Z'}]){
      const release=fixture.advance(target);release.command('plan');release.command('restore');release.command('prepare-carry');release.build();
      const priceBytes=readFileSync(join(release.dist,'static-data/charts/OWNED.json'));
      release.command('compose');
      const publication=read(join(release.dist,'publication.json'));
      assert.equal(publication.ui_digest,initial.ui_digest);assert.equal(publication.ui_sha,initial.ui_sha);
      assert.equal(publication.transport.root.bindings.appCommit,initial.ui_sha);
      assert.equal(publication.transport.root.bindings.financialGeneration,publication.financial_generation);
      assert.notEqual(publication.transport.root.generation,last.transport.root.generation);
      const logical=await canonicalPublication({root:release.dist,frontendRoot:frontend,publication,restore:join(release.root,'checked-logical')});
      const receipt=verifyFinancialReleaseAssets(logical,publication.financial_release,publication);
      assert.equal(receipt.mode,'carry');assert.equal(receipt.candidate,null);
      assert.equal(readFileSync(join(logical,receipt.source_projection.path),'utf8'),fixture.original.bytes);
      assert.equal(readFileSync(join(logical,receipt.source_base.path),'utf8'),fixture.original.base);
      assert.equal(sha256(readFileSync(join(logical,'static-data/charts/OWNED.json'))),sha256(priceBytes),'carry/transport preserves selected OHLCV bytes');
      const carry=read(release.state().carry.projectionPath);
      assert.equal(JSON.parse(carry.source_projection_json).financial_evaluated_at,sourceTime);
      assert.deepEqual(carry.symbols.OWNED.financial_current.p,originalSource.financial_current.p);
      assert.deepEqual(carry.symbols.OWNED.source_receipts,originalSource.source_receipts);
      const current=currentFinancialHistory(carry.symbols.OWNED.financial_history,'OWNED',target.date,Date.parse(target.time));
      assert.equal(current.annual.length,0,'expired annual data cannot become current after unpack/repack');
      assert.equal(current.quarterly.length,target.id===40?2:0,'quarterly evidence expires on its original clock');
      rmSync(logical,{recursive:true,force:true});
      release.command('recheck');release.deploy();last=publication;
    }
  }finally{fixture.cleanup();}
});
