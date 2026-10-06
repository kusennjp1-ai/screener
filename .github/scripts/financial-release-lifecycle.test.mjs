import {financialAuditInventory,assertFinancialAuditPreserved} from './financial-audit-history.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lifecycleFixture,read,sourceTime} from './fixtures/financial-release-lifecycle.mjs';
import {verifyFinancialReleaseAssets} from './financial-release-activation.mjs';
import {currentFinancialHistory} from '../../frontend/src/static/financialCurrent.js';
import {decodeResearchIndex} from '../../frontend/src/static/researchTransport.js';
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
