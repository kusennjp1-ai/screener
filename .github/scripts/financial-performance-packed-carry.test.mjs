import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performanceLifecycleFixture} from './fixtures/financial-performance-lifecycle.mjs';
import {read,sourceTime} from './fixtures/financial-release-lifecycle.mjs';
import {contract,digest} from './financial-correction.mjs';
import {sha256} from './publication-state.mjs';
import {canonicalPublication} from './static-transport-publication.mjs';
import {currentFinancialHistory} from '../../frontend/src/static/financialCurrent.js';
import {decodeResearchIndex} from '../../frontend/src/static/researchTransport.js';

const frontend=fileURLToPath(new URL('../../frontend',import.meta.url));
const write=(path,value)=>writeFileSync(path,JSON.stringify(value));
function withJson(path,mutate,check){
  const bytes=readFileSync(path),value=JSON.parse(bytes);
  try{mutate(value);write(path,value);check();}finally{writeFileSync(path,bytes);}
}
function fails(result,pattern){assert.ifError(result.error);assert.equal(result.status,1,`${result.stdout}\n${result.stderr}`);assert.match(result.stderr,pattern);}
function withLiveFinancial(fixture,mutate,check){
  const publicationPath=join(fixture.liveRoot,'publication.json'),bytes=readFileSync(publicationPath),publication=JSON.parse(bytes);
  const receipt=read(join(fixture.liveRoot,publication.financial_release.path));mutate(receipt);
  const nextBytes=JSON.stringify(receipt),hash=sha256(nextBytes),path=`static-data/financial-corrections/release-${hash}.json`;
  try{
    writeFileSync(join(fixture.liveRoot,path),nextBytes);
    publication.financial_release={schema_version:'financial-release-receipt-v1',path,sha256:hash};
    publication.financial_lineage_sha256=receipt.lineage_sha256;
    write(publicationPath,publication);check();
  }finally{writeFileSync(publicationPath,bytes);rmSync(join(fixture.liveRoot,path));}
}

test('packed exception v2 survives two real CLI carries with exact approval, prices and original source clocks',{timeout:240000},async()=>{
  const fixture=await performanceLifecycleFixture({packedTransport:true,exceptionVersion:2});
  try{
    const initial=fixture.readDeployed(),original=fixture.original.value.symbols.OWNED,prefix=`repos/${fixture.pin.repository}`;
    assert.equal(initial.approval.type,'performance-exception-v2');
    assert.equal(initial.approval.certificate.schema_version,'financial-performance-candidate-pin-v2');
    assert.equal(fixture.approval.schema_version,'financial-performance-approval-v2');
    assert.equal(fixture.approval.transport_sha256,fixture.policy.transport_sha256);
    assert.equal(initial.financialRelease.mode,'activation');
    assert.equal(initial.financialRelease.evaluated_at,sourceTime);
    assert.deepEqual(initial.approval,fixture.ui);
    assert.deepEqual(initial.financialRelease.ui.approval,fixture.ui);
    assert.ok(initial.receipt.transport);
    assert.equal(initial.receipt.transport.root.bindings.appCommit,fixture.ui.sha);
    assert.equal(initial.financialRelease.ui.checks.find(check=>check.name==='Publish Docker Images').conclusion,'skipped');
    assert.equal(fixture.config.api[`${prefix}/actions/runs/${fixture.policy.design_run_id}/attempts/1`].conclusion,'failure');
    assert.ok(fixture.controllerJobs.every(job=>job.conclusion==='success'));
    const historyBytes=readFileSync(join(fixture.liveRoot,'static-data/candidate-history/retained-history.json'));
    const uiBytes=Object.fromEntries(Object.keys(initial.uiFiles).map(path=>[path,readFileSync(join(fixture.liveRoot,path))]));
    assert.ok(Object.hasOwn(uiBytes,'static-transport-capability.json'));

    // Rehashing a durable financial audit does not permit changing either its
    // immutable source authority or its inner exception approval.
    withLiveFinancial(fixture,receipt=>{
      receipt.ui.approval.certificate.artifact_sha256='9'.repeat(64);
      receipt.candidate.artifact_sha256='9'.repeat(64);
    },()=>fails(fixture.readDeployed({allowFailure:true}),/financial release and publication disagree/));
    withLiveFinancial(fixture,receipt=>delete receipt.ui.approval,
      ()=>fails(fixture.readDeployed({allowFailure:true}),/closed financial release UI|financial release UI approval/));
    withJson(join(fixture.liveRoot,'publication.json'),publication=>delete publication.approval,
      ()=>fails(fixture.readDeployed({allowFailure:true}),/Unapproved live UI/));

    let previous=initial,previousHistory=read(join(fixture.liveRoot,'static-data/candidate-history/index.json'));
    for(const [index,target]of [
      {id:40,date:'2026-10-05',price:120,time:'2026-10-05T12:00:00.000Z'},
      {id:50,date:'2026-10-06',price:130,time:'2026-10-06T12:00:00.000Z'},
    ].entries()){
      const release=fixture.advance(target);
      release.command('plan');
      const output=readFileSync(release.output,'utf8');
      for(const value of ['publish=true','mode=data','carry=true'])assert.ok(output.includes(`${value}\n`));
      assert.equal(release.state().live.identity,previous.identity);
      const controllerChecks=release.state().carry.controllerChecks;
      assert.deepEqual(controllerChecks.map(check=>check.name),contract.required_ci_jobs);
      assert.ok(controllerChecks.every(check=>check.run_id===fixture.controllerRun.id&&check.head_sha===fixture.controllerRun.head_sha));
      release.command('restore');
      assert.equal(readFileSync(join(release.state().carry.sourceRoot,previous.financialRelease.source_projection.path),'utf8'),fixture.original.bytes);
      release.command('prepare-carry');
      assert.deepEqual(release.state().carry.controllerChecks,controllerChecks,'prepare-carry retains the exact current-main CI authority');
      const carry=read(release.state().carry.projectionPath);
      assert.equal(carry.financial_evaluated_at,target.time);
      assert.equal(carry.source_projection_json,fixture.original.bytes);
      assert.equal(carry.source_base_json,fixture.original.base);
      assert.equal(JSON.parse(carry.source_projection_json).financial_evaluated_at,sourceTime);
      assert.deepEqual(carry.receipt_inventory,fixture.original.value.receipt_inventory);
      assert.equal(carry.bindings.previous_publication_identity,previous.identity);
      assert.equal(carry.bindings.source_lineage_sha256,initial.financialRelease.lineage_sha256);
      assert.deepEqual(carry.symbols.OWNED.source_receipts,original.source_receipts);
      assert.deepEqual(carry.symbols.OWNED.financial_current.p,original.financial_current.p);
      assert.deepEqual(carry.symbols.OWNED.financial_history.annual,original.financial_history.annual);
      assert.deepEqual(carry.symbols.OWNED.financial_history.annual_source,original.financial_history.annual_source);
      const current=currentFinancialHistory(carry.symbols.OWNED.financial_history,'OWNED',target.date,Date.parse(target.time));
      assert.deepEqual(current.annual,[],'packing cannot renew expired annual evidence');
      assert.equal(current.quarterly.length,index===0?2:0,'quarterly history expires on its original source clock');
      release.build();
      const priceBytes=readFileSync(join(release.dist,'static-data/charts/OWNED.json'));
      release.command('compose');
      const publicationPath=join(release.dist,'publication.json'),publication=read(publicationPath);
      assert.ok(publication.transport);
      assert.equal(publication.ui_sha,initial.uiSha);
      assert.equal(publication.ui_digest,initial.uiDigest);
      assert.deepEqual(publication.ui_files,initial.uiFiles);
      assert.deepEqual(publication.approval,fixture.ui,'compose retains the exact outer exception approval');
      assert.equal(publication.transport.root.bindings.appCommit,initial.uiSha);
      assert.equal(publication.transport.root.bindings.uiInventorySha256,initial.uiDigest);
      assert.equal(publication.transport.root.bindings.financialGeneration,publication.financial_generation);
      assert.equal(publication.transport.root.bindings.financialLineageSha256,initial.financialRelease.lineage_sha256);
      assert.notEqual(publication.transport.root.generation,previous.receipt.transport.root.generation);
      for(const [path,bytes]of Object.entries(uiBytes))assert.deepEqual(readFileSync(join(release.dist,path)),bytes);
      const logical=await canonicalPublication({root:release.dist,frontendRoot:frontend,publication,restore:join(release.root,'checked-logical')});
      let receipt,history;
      try{
        receipt=fixture.activation.verifyFinancialReleaseAssets(logical,publication.financial_release,publication);
        assert.equal(receipt.mode,'carry');assert.equal(receipt.candidate,null);
        assert.deepEqual(receipt.ui.approval,fixture.ui,'the packed financial audit retains the exact inner approval');
        assert.deepEqual(receipt.ui.checks,initial.financialRelease.ui.checks);
        assert.deepEqual(receipt.lineage,initial.financialRelease.lineage);
        assert.deepEqual(receipt.source_projection,initial.financialRelease.source_projection);
        assert.deepEqual(receipt.source_base,initial.financialRelease.source_base);
        assert.equal(receipt.previous_publication_identity,previous.identity);
        assert.equal(readFileSync(join(logical,receipt.source_projection.path),'utf8'),fixture.original.bytes);
        assert.equal(readFileSync(join(logical,receipt.source_base.path),'utf8'),fixture.original.base);
        assert.deepEqual(readFileSync(join(logical,'static-data/charts/OWNED.json')),priceBytes,'packing preserves selected OHLCV bytes exactly');
        const manifest=read(join(logical,'static-data/manifest.json'));
        const research=decodeResearchIndex(read(join(logical,'static-data',manifest.markets.US.assets.research.path)));
        assert.equal(research.as_of_date,target.date);assert.equal(research.rows[0].current_price,target.price);
        assert.equal(research.rows[0].eps_growth_yy,40);
        assert.deepEqual(read(join(logical,'static-data/charts/OWNED.json')).bars,
          read(join(release.state().carry.baseline,'static-data/charts/OWNED.json')).bars);
        assert.equal(publication.price_observations['["US","chart","OWNED"]'],target.date);
        for(const [key,date]of Object.entries(previous.knownPriceDates))assert.ok(publication.known_price_dates[key]>=date);
        assert.deepEqual(readFileSync(join(logical,'static-data/candidate-history/retained-history.json')),historyBytes);
        history=read(join(logical,'static-data/candidate-history/index.json'));
        assert.deepEqual(history.snapshots.slice(0,previousHistory.snapshots.length),previousHistory.snapshots);
        assert.deepEqual(history.snapshots.map(item=>item.as_of),['2026-10-02','2026-10-05','2026-10-06'].slice(0,index+2));
      }finally{rmSync(logical,{recursive:true,force:true});}
      release.command('recheck'); // The first real check is immediately before upload.

      const docker=fixture.controllerJobs.find(job=>job.name==='Publish Docker Images');
      docker.conclusion='failure';
      fails(release.command('recheck',{allowFailure:true}),/requires successful CI job: Publish Docker Images/);
      docker.conclusion='success';
      const jobId=docker.id;docker.id++;
      fails(release.command('recheck',{allowFailure:true}),/Exception carry controller CI changed/);docker.id=jobId;
      withJson(publicationPath,value=>delete value.approval,
        ()=>fails(release.command('recheck',{allowFailure:true}),/Publication and financial release disagree|Noncanonical correction data/));
      withJson(publicationPath,value=>value.approval.certificate.artifact_sha256='9'.repeat(64),
        ()=>fails(release.command('recheck',{allowFailure:true}),/Publication and financial release disagree/));
      const statePath=join(release.root,'runner/verified-publication/state.json');
      withJson(statePath,value=>delete value.carry.controllerChecks,
        ()=>fails(release.command('recheck',{allowFailure:true}),/Noncanonical correction data|Exception carry controller CI changed/));
      release.command('recheck'); // The final real check is immediately before deployment.
      release.deploy();
      const deployed=fixture.readDeployed();
      assert.equal(deployed.receipt.run_id,target.id);
      assert.deepEqual(deployed.approval,fixture.ui);
      assert.deepEqual(deployed.financialRelease,receipt);
      assert.deepEqual(deployed.receipt.transport,publication.transport);
      fails(release.command('recheck',{allowFailure:true}),/discard this superseded publication/);
      previous=deployed;previousHistory=history;
    }
    fixture.setTime('2026-10-08T12:00:00.000Z');
    assert.throws(()=>fixture.exception.parsePerformanceApproval(fixture.approval,{activation:true,now:Date.parse('2026-10-08T12:00:00.000Z')}),/expired/);
    assert.deepEqual(fixture.readDeployed().approval,fixture.ui,'historical packed approval survives its one-time activation deadline');
    const changedApproval=structuredClone(fixture.approval);changedApproval.transport_sha256='9'.repeat(64);
    assert.throws(()=>fixture.exception.parsePerformanceApproval(changedApproval),/transport/i);
    const trace=readFileSync(join(fixture.root,'trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    for(const endpoint of [fixture.approvalEndpoint,fixture.requestEndpoint,`${prefix}/git/trees/${fixture.policy.captured_ui.tree}?recursive=1`])assert.ok(trace.some(item=>item.api===endpoint));
    for(const id of [140,150])assert.ok(trace.some(item=>item.api===`${prefix}/actions/artifacts/${id}/zip`));
    assert.ok(trace.some(item=>item.pages===initial.financialRelease.source_projection.path));
    assert.ok(trace.some(item=>item.pages===initial.receipt.transport.root.path));
    assert.ok(trace.every(item=>!item.api||!item.api.endsWith(`/actions/artifacts/${fixture.pin.artifact_id}/zip`)),'carry never downloads expired original certification inputs');
    assert.equal(fixture.config.api[`${prefix}/actions/runs/${fixture.policy.design_run_id}/attempts/1`].conclusion,'failure');
    assert.equal(fixture.config.api[`${prefix}/actions/runs/${fixture.policy.ci_run_id}/attempts/1/jobs?per_page=100`][0].jobs.find(job=>job.name==='Publish Docker Images').conclusion,'skipped');
    assert.equal(digest(previous.financialRelease.lineage),initial.financialRelease.lineage_sha256);
  }finally{fixture.cleanup();}
});
