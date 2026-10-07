import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,rmSync,truncateSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {bootstrap} from './publication-state.mjs';
import {renewalPolicy} from './financial-source-renewal.mjs';
import {disabledRenewalRegistry} from './fixtures/financial-renewal-policy.mjs';
import {AUDIT_TRANSPORT_PREFIX} from './financial-audit-transport.mjs';
import {renewalLifecycleFixture,buildSyntheticRenewalSources,seedGenuineSourcePublication,prepareGenuineRenewal,publishGenuineRenewal,carryGenuineRenewal,verifyNestedRenewalBytes,read,write} from './fixtures/financial-source-renewal-lifecycle.mjs';

const prefix=`repos/${bootstrap.repository}`;
const failed=(result,reason)=>{assert.ifError(result.error);assert.notEqual(result.status,0,`Unexpected success: ${result.stdout}`);if(reason)assert.match(`${result.stdout}\n${result.stderr}`,reason);};
function changedFile(path,mutate,action){const before=readFileSync(path);try{writeFileSync(path,mutate(before));action();}finally{writeFileSync(path,before);}}
function changedValue(object,key,value,action){const present=Object.hasOwn(object,key),before=object[key];try{object[key]=value;action();}finally{if(present)object[key]=before;else delete object[key];}}

function project(f,name,{evaluatedAt,target=f.seed.target}={}){
  const generation=f.sources.generations.find(g=>g.name===name),input=join(f.root,`project-${name}-input.json`),output=join(f.root,`project-${name}`);
  write(input,{evaluated_at:evaluatedAt||generation.evaluated_at,target_base_path:target,target_publication_identity:f.seed.priorIdentity});
  f.run(f.python,[f.builder,'project','--source',generation.source_root,'--output',output,'--config',input]);
  return {generation,...read(join(output,'result.json'))};
}

test('real archive-backed compressed CLI renewal, next-price carry, second renewal, and adversarial final gates (SYNTHETIC transport only)',{timeout:15*60*1000},async t=>{
  const f=renewalLifecycleFixture();t.after(()=>{if(process.env.FINANCIAL_RENEWAL_TEST_KEEP==='1')t.diagnostic(`Retained disposable fixture: ${f.root}`);else f.cleanup();});
  buildSyntheticRenewalSources(f);seedGenuineSourcePublication(f);
  const original=f.sources.generations.find(g=>g.name==='gen1'),renewed=f.sources.generations.find(g=>g.name==='gen2');
  await t.test('real cumulative archive preserves every original receipt, attempt, object and batch byte',()=>{
    const old=read(original.manifest_path),next=read(renewed.manifest_path);
    for(const key of ['objects','receipts','attempts','batches'])for(const [id,value]of Object.entries(old[key]||{}))assert.deepEqual(next[key][id],value,`${key}/${id}`);
    assert.equal(Object.keys(old.receipts).length,4);assert.equal(Object.keys(next.receipts).length,6);
    for(const [id]of Object.entries(old.objects))assert.deepEqual(readFileSync(join(original.source_root,'archive/objects',`${id}.json`)),readFileSync(join(renewed.source_root,'archive/objects',`${id}.json`)));
  });
  await t.test('original receipts replayed under a later evaluation clock provide no renewal progress',()=>{
    const replay=project(f,'gen1',{evaluatedAt:'2026-10-05T13:00:00.000Z'});
    failed(f.invoke(f.python,[join(f.checkout,'backend/app/scripts/verify_statement_source_renewal.py'),'--previous-archive',original.source_root,
      '--archive',original.source_root,'--previous-projection',f.seed.summary.projection_path,'--projection',replay.projection_path,
      '--evaluated-at','2026-10-05T13:00:00.000Z'],{extra:{PYTHONPATH:join(f.checkout,'backend')}}),/no genuinely new/);
  });
  await t.test('expired untouched finances remain unknown despite retained scalar values; refreshed finances are available',()=>{
    const replay=project(f,'expired'),projection=read(replay.projection_path),nvda=projection.symbols.NVDA,amd=projection.symbols.AMD;
    assert.equal(nvda.source_diagnostics.fields.eps_growth_yy,'stale_source');assert.equal(nvda.source_diagnostics.fields.sales_growth_yy,'stale_source');
    assert.deepEqual(nvda.financial_current.p,{});assert.equal(nvda.financial_history.status,'unavailable');assert.deepEqual(nvda.financial_history.annual,[]);
    assert.ok(nvda.financial_values.eps_growth_yy>0,'fixture must contain a tempting stale scalar');assert.ok(amd.financial_current.p['1']);
    f.evaluate(`import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {projectFinancialRow,currentFinancialHistory} from './frontend/src/static/financialCurrent.js';
      const p=JSON.parse(readFileSync(${JSON.stringify(replay.projection_path)})),now=Date.parse(p.financial_evaluated_at);
      for(const symbol of ['AMD','NVDA']){const item=p.symbols[symbol],row=projectFinancialRow({symbol,market:'US',as_of_date:item.as_of_date,
        ...item.financial_values,financial_current:item.financial_current,financial_history:item.financial_history},{now});
        for(const field of ['eps_growth_yy','sales_growth_yy'])if(symbol==='NVDA'){assert.equal(row[field],null);assert.equal(row.financial_current_state.fields[field].availability,'unknown');}
        else assert.equal(row.financial_current_state.fields[field].availability,'current');
      }`);
  });
  const first=prepareGenuineRenewal(f);
  const firstNested=verifyNestedRenewalBytes(f,first);
  await t.test('renewal-only sidecar requires its exact record, rejects both original v2 classes, and binds every nested context and payload',()=>{
    const input=join(f.root,'nested-mutation-input.json');write(input,{candidate:first.candidate,outer:Object.keys(firstNested.outer_payloads)[0],inner:Object.keys(firstNested.inner_payloads)[0]});
    f.evaluate(`import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
      import {verifyCandidateTransport,validateCandidateRecord,financialReleasePolicy} from './.github/scripts/financial-release-activation.mjs';
      import {exceptionPolicyForVersion} from './.github/scripts/financial-performance-policy.mjs';
      import {sha256} from './.github/scripts/publication-state.mjs';
      import {AUDIT_TRANSPORT_PREFIX} from './.github/scripts/financial-audit-transport.mjs';
      const {candidate,outer,inner}=JSON.parse(readFileSync(${JSON.stringify(input)})),root=process.cwd(),transportPath=join(candidate,'transport.json'),bootstrapPath=join(candidate,'corrected/publication.json');
      const record=JSON.parse(readFileSync(join(candidate,'candidate.json'))),transportBytes=readFileSync(transportPath),bootstrapBytes=readFileSync(bootstrapPath),report=[];
      await verifyCandidateTransport(root,candidate,record);
      for(const [name,bad]of [['missing renewal record',null],['wrong sealed sidecar hash',{...record,transport_sha256:'0'.repeat(64)}],['wrong renewal request record',{...record,renewal_request_sha256:'0'.repeat(64)}]]){
        await assert.rejects(()=>verifyCandidateTransport(root,candidate,bad),/renewal capture|capture binding|request.*history/i);report.push(name);
      }
      const common=Object.fromEntries(['captured_ui','request_sha256','preview_receipt_sha256','corrected_inventory_sha256','protected_code_sha256','transport_sha256'].map(key=>[key,record[key]]));
      const ordinary={schema_version:'financial-release-candidate-v2',producer:{...record.producer,workflow:financialReleasePolicy.candidate_workflow},...common};
      const policy=exceptionPolicyForVersion(2),exception={...ordinary,schema_version:'financial-performance-candidate-v2',producer:{...record.producer,workflow:policy.workflow},
        captured_ui:policy.captured_ui,transport_sha256:policy.transport_sha256,approval_sha256:sha256(readFileSync(join(root,policy.approval_path))),controller_code_sha256:record.protected_code_sha256};
      // Both original v2 classes pass their unchanged shape/policy guards first.
      // Neither can supply this renewal-only audit context.
      for(const old of [ordinary,exception]){validateCandidateRecord(old);await assert.rejects(()=>verifyCandidateTransport(root,candidate,old),/own sealed renewal capture/);report.push('reject '+old.schema_version);}
      for(const [name,mutate]of [
        ['unsealed sidecar bytes',value=>value.note='not sealed'],
        ['missing nested context',value=>delete value.financial_audit],
        ['wrong predecessor',value=>value.financial_audit.previous_publication_identity='999/1/'+'0'.repeat(64)+'/'+'1'.repeat(64)],
        ['removed original source map entry',value=>delete value.financial_audit.financial_audit_files[Object.keys(value.financial_audit.financial_audit_files).find(path=>path.includes('source-projection-'))]],
        ['wrong audit descriptor binding',value=>value.financial_audit.financial_audit_transport.root.bindings.candidateId='0'.repeat(64)],
        ['wrong intermediate inventory',value=>value.financial_audit.financial_audit_transport.storage_data_inventory_sha256='0'.repeat(64)],
        ['wrong bounded audit root',value=>value.financial_audit.financial_audit_transport.root.bytes++],
      ]){
        const changed=JSON.parse(transportBytes);mutate(changed);writeFileSync(transportPath,JSON.stringify(changed));
        try{
          await assert.rejects(()=>verifyCandidateTransport(root,candidate,record),/transport|capture binding|context/i);
          // Updating only an outer checksum is a negative attack: the real
          // verifier must still reject changed retained authority or encoding.
          const rebound={...record,transport_sha256:sha256(readFileSync(transportPath))};
          await assert.rejects(()=>verifyCandidateTransport(root,candidate,rebound),/transport|audit|context|retained|metadata/i);
          report.push(name);
        }finally{writeFileSync(transportPath,transportBytes);}
      }
      for(const [name,path]of [['outer gzip',join(candidate,'corrected',outer)],['inner gzip',join(candidate,'corrected',AUDIT_TRANSPORT_PREFIX,inner)]]){
        const bytes=readFileSync(path),changed=Buffer.from(bytes);changed[0]^=1;writeFileSync(path,changed);
        try{await assert.rejects(()=>verifyCandidateTransport(root,candidate,record),/integrity|hash|digest|physical|gzip|transport|decoded byte cap/i);report.push(name);}finally{writeFileSync(path,bytes);}
      }
      const forgedPreview=JSON.parse(bootstrapBytes);forgedPreview.financial_audit=JSON.parse(transportBytes).financial_audit;writeFileSync(bootstrapPath,JSON.stringify(forgedPreview));
      try{await assert.rejects(()=>verifyCandidateTransport(root,candidate,record),/closed.*preview|preview bootstrap/);report.push('browser sidecar injection');}finally{writeFileSync(bootstrapPath,bootstrapBytes);}
      await verifyCandidateTransport(root,candidate,record);assert.deepEqual(readFileSync(transportPath),transportBytes);assert.deepEqual(readFileSync(bootstrapPath),bootstrapBytes);
      writeFileSync(${JSON.stringify(join(f.root,'nested-mutations.json'))},JSON.stringify({schema_version:'synthetic-renewal-nested-mutations-v1',authority:'none',rejected:report}));`);
    assert.equal(read(join(f.root,'nested-mutations.json')).rejected.length,15);
  });
  await t.test('missing/wrong explicit dispatch intent and incomplete exact A/B/C CI reject the real plan',()=>{
    const intentPath=join(f.checkout,renewalPolicy.intent_path),bytes=readFileSync(intentPath);
    try{rmSync(intentPath);failed(f.command('plan',{allowFailure:true}),/complete committed/);}finally{writeFileSync(intentPath,bytes);}
    const eventBytes=readFileSync(f.env.GITHUB_EVENT_PATH);
    try{write(f.env.GITHUB_EVENT_PATH,{inputs:{}});const noDispatch=f.command('plan',{allowFailure:true});assert.equal(noDispatch.status,0,noDispatch.stderr);assert.match(noDispatch.stdout,/No advancing data or newly verified UI/);}
    finally{writeFileSync(f.env.GITHUB_EVENT_PATH,eventBytes);}
    try{write(f.env.GITHUB_EVENT_PATH,{inputs:{financial_source_renewal:JSON.stringify({...first.intent,pin_sha256:'0'.repeat(64)})}});failed(f.command('plan',{allowFailure:true}),/dispatch intent/);}finally{writeFileSync(f.env.GITHUB_EVENT_PATH,eventBytes);}
    for(const [sha,id]of [[first.a,10400],[first.b,11400],[first.c,12400]]){
      const endpoint=`${prefix}/actions/runs/${id}/attempts/1/jobs?per_page=100`,jobs=f.api[endpoint];
      changedValue(f.api,endpoint,[{jobs:jobs[0].jobs.slice(1)}],()=>failed(f.command('plan',{allowFailure:true}),/CI|checks|job/i));
      const wrong=structuredClone(jobs);wrong[0].jobs[0].head_sha='0'.repeat(40);
      changedValue(f.api,endpoint,wrong,()=>failed(f.command('plan',{allowFailure:true}),/CI|checks|job/i));
      assert.equal(f.api[`${prefix}/actions/runs/${id}/attempts/1`].head_sha,sha);
    }
  });
  await t.test('sealed registry bytes cannot be changed through historical API evidence',()=>{
    const endpoint=`${prefix}/contents/contracts/financial_source_renewal_v1.json?ref=${first.a}`;
    const registry={...disabledRenewalRegistry(),publication_enabled:true},bytes=Buffer.from(JSON.stringify(registry));
    changedValue(f.api,endpoint,{type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')},()=>failed(f.command('plan',{allowFailure:true}),/registry/i));
  });
  const firstLive=publishGenuineRenewal(f,first,{beforeDeploy:({dist,state})=>{
    const candidate=state.renewal.candidate;
    verifyNestedRenewalBytes(f,first,dist);
    changedFile(join(candidate,'transport.json'),bytes=>Buffer.concat([bytes,Buffer.from(' ')]),()=>failed(f.command('recheck',{allowFailure:true}),/transport|capture binding/i));
    for(const [path,mutate,reason]of [
      [join(candidate,'target-base.json'),bytes=>Buffer.concat([bytes,Buffer.from(' ')]),/target|base/i],
      [join(candidate,'target-base.json'),bytes=>{const v=JSON.parse(bytes);v.rows[0].symbol='WRONG';return JSON.stringify(v);},/target|base|identity/i],
      [join(candidate,'baseline/static-data/manifest.json'),bytes=>Buffer.concat([bytes,Buffer.from(' ')]),/baseline|inventory|candidate/i],
      [join(candidate,'original-source/source.zip'),bytes=>Buffer.concat([bytes,Buffer.from('bad')]),/archive|source|digest/i],
      [join(candidate,'renewal-request.json'),bytes=>{const v=JSON.parse(bytes);v.previous_publication_identity=`999/1/${'a'.repeat(64)}/${'b'.repeat(64)}`;return JSON.stringify(v);},/request|identity/i],
    ])changedFile(path,mutate,()=>failed(f.command('recheck',{allowFailure:true}),reason));
    changedValue(f.config,'currentSha',first.a,()=>failed(f.command('recheck',{allowFailure:true}),/Current-main|current main/i));
    const originalRun=f.api[`${prefix}/actions/runs/${first.live.receipt.run_id}/attempts/1`],originalJobs=f.api[`${prefix}/actions/runs/${first.live.receipt.run_id}/attempts/1/jobs?per_page=100`][0].jobs;
    f.registration({run_id:999,run_attempt:1},{run:{...originalRun,id:999},jobs:originalJobs.map(job=>({...job,id:9990,run_id:999})),artifacts:[]});
    changedFile(join(f.liveRoot,'publication.json'),bytes=>{const v=JSON.parse(bytes);v.run_id=999;v.artifact_name='github-pages-999-1';return JSON.stringify(v);},()=>{
      assert.notEqual(f.readLive().identity,first.live.identity,'the raced predecessor must independently pass live verification');
      failed(f.command('recheck',{allowFailure:true}),/Live UI or data changed/);
    });
    const oversized=join(dist,'appended-after-renewal-seal.bin');writeFileSync(oversized,'');truncateSync(oversized,1_000_000_001);
    const beforeTrace=readFileSync(join(f.root,'trace.jsonl'));
    try{failed(f.command('recheck',{allowFailure:true}),/1 GB|exceed|1000000000/i);assert.deepEqual(readFileSync(join(f.root,'trace.jsonl')),beforeTrace,'oversized final upload must reject before remote reads');}finally{rmSync(oversized);}
    f.command('recheck');
    f.checkpoint('Rejected changed baseline, source ZIP, target identity, current-main/predecessor races and oversized post-append upload');
  }});
  assert.equal(firstLive.financialRelease.renewal.transitions.length,1);
  await t.test('live historical renewal rejects missing and tampered nested assets without raw fallback',()=>{
    const descriptor=firstLive.receipt.financial_audit_transport;
    assert.ok(descriptor);
    const paths=[descriptor.root.path,Object.keys(firstNested.inner_payloads)[0]],rejected=[];
    for(const relative of paths){
      const path=join(f.liveRoot,AUDIT_TRANSPORT_PREFIX,relative),bytes=readFileSync(path);
      try{rmSync(path);failed(f.readLive({allowFailure:true}),/ENOENT|missing|404|cannot read|transport/i);rejected.push('missing '+relative);}
      finally{writeFileSync(path,bytes);}
      changedFile(path,original=>{const changed=Buffer.from(original);changed[0]^=1;return changed;},()=>{
        failed(f.readLive({allowFailure:true}),/integrity|hash|digest|transport|gzip|JSON|decoded byte cap/i);rejected.push('tampered '+relative);
      });
    }
    assert.equal(f.readLive().identity,firstLive.identity);
    write(join(f.root,'nested-live-mutations.json'),{schema_version:'synthetic-renewal-live-mutations-v1',authority:'none',rejected});
    f.checkpoint('Rejected missing and tampered nested root and payload through real livePublication reader');
  });
  const carry=carryGenuineRenewal(f);assert.equal(carry.live.financialRelease.renewal.transitions.length,1);
  assert.equal(existsSync(join(f.checkout,renewalPolicy.intent_path)),false);
  const second=prepareGenuineRenewal(f,{generation:'gen3',runId:600,evaluatedAt:'2026-10-06T13:00:00.000Z'});
  verifyNestedRenewalBytes(f,second);
  const secondLive=publishGenuineRenewal(f,second,{beforeDeploy:({dist})=>verifyNestedRenewalBytes(f,second,dist)});
  assert.equal(secondLive.financialRelease.renewal.transitions.length,2);
  assert.deepEqual(secondLive.financialRelease.renewal.origin,f.seed.live.receipt.financial_release);
  assert.equal(secondLive.financialRelease.previous_publication_identity,carry.live.identity);
  assert.equal(secondLive.manifest.markets.US.as_of_date,'2026-10-05');
  const delta=read(join(second.candidate,'source-delta.json'));assert.equal(delta.new_receipt_count,1);assert.equal(delta.preserved.receipts,6);
  f.checkpoint('Verified full compressed three-generation production-entrypoint lifecycle and closed adversarial gates');
  t.diagnostic(`SYNTHETIC provider/market/GitHub transport; genuine archives, journals, certificate code, Git objects and publisher CLIs. ${f.phases.length} verified phases.`);
});
