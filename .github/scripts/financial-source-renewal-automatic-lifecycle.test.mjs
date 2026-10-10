import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync,rmSync,statfsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {bootstrap} from './publication-state.mjs';
import {renewalPolicy} from './financial-source-renewal.mjs';
import {renewalLifecycleFixture,buildSyntheticRenewalSources,seedGenuineSourcePublication,publishGenuineRenewal,carryGenuineRenewal,syntheticQuotaHttpResponse,read,write} from './fixtures/financial-source-renewal-lifecycle.mjs';
import {prepareAutomaticRenewal,finishAutomaticCaller,routeCommand,registryPath,admissionStep,endpoint,historyEndpoint,completeStep} from './fixtures/financial-source-renewal-automatic-lifecycle.mjs';

const failed=(result,reason)=>{assert.ifError(result.error);assert.notEqual(result.status,0,`Unexpected success: ${result.stdout}`);assert.match(`${result.stdout}\n${result.stderr}`,reason);};
function withValue(object,key,value,action){const before=object[key],present=Object.hasOwn(object,key);try{object[key]=value;return action();}finally{if(present)object[key]=before;else delete object[key];}}
function withJson(path,mutate,action){const before=readFileSync(path);try{const value=JSON.parse(before);mutate(value);write(path,value);return action();}finally{writeFileSync(path,before);}}
const runCopy=(f,id)=>structuredClone(f.api[endpoint(id,'/attempts/1')]);

const quotaArgs=['api','--hostname','github.com','--method','GET','--include','rate_limit','-H','Accept: application/vnd.github+json','-H','X-GitHub-Api-Version: 2022-11-28'];
const fixtureOptions=()=>({completeCiMetadata:true,recordApiBudget:true,...(process.env.FINANCIAL_RENEWAL_NODE_MODULES?{nodeModules:process.env.FINANCIAL_RENEWAL_NODE_MODULES}:{})});
const traceEvents=f=>existsSync(f.env.RENEWAL_FIXTURE_TRACE)?readFileSync(f.env.RENEWAL_FIXTURE_TRACE,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
const invocations=f=>readFileSync(join(f.root,'api-budget.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
const lastInvocation=(f,script,command)=>invocations(f).filter(row=>row.command.some(arg=>arg.endsWith(`/${script}.mjs`))&&row.command.at(-1)===command).at(-1);
function withoutQuota(f,action){const before=traceEvents(f).length;action();assert.equal(traceEvents(f).slice(before).filter(item=>item.quota).length,0,'ordinary/manual/disabled work must not probe quota');}
function withMissingFiles(paths,action){const saved=paths.map(path=>[path,existsSync(path)?readFileSync(path):null]);try{for(const [path]of saved)rmSync(path,{force:true});return action();}finally{for(const [path,bytes]of saved)if(bytes!==null)writeFileSync(path,bytes);}}
function quotaAudit(f,phase,command,row){
  const path=join(f.root,'runner',`run-${row.run_id}`,'financial-renewal-quota',`${phase}-${command}-${row.pid}.json`),value=read(path);
  assert.equal(value.schema_version,'financial-renewal-quota-audit-v1');assert.equal(value.phase,phase);assert.equal(value.command,command);assert.equal(value.probe_requests,1);
  assert.equal(value.capacity_reserved,false);return value;
}
function quotaHeld(f,phase,command,metadata,invoke,{final=false,floor}={}){
  return withValue(f.config,'quota',metadata,()=>{
    const result=invoke();failed(result,/quota preflight held/i);
    assert.doesNotMatch(result.stderr,/SYNTHETIC_PRIVATE_TRANSPORT_DETAIL/,'raw transport diagnostics must not be echoed');
    const row=invocations(f).at(-1),audit=quotaAudit(f,phase,final?`${command}-final`:command,row);
    assert.equal(audit.status,'hold');if(floor!==undefined)assert.equal(audit.minimum_remaining,floor);
    assert.equal(row.quota_reads,final?2:1);
    if(final){const events=traceEvents(f).filter(item=>item.invocation===row.invocation),last=events.findLastIndex(item=>item.quota);
      assert.equal(events.slice(last+1).filter(item=>item.api).length,0,'held final boundary must not run its original API tail');}
    return row;
  });
}
function expectedFinalTail({phase,head,runId}){
  const repo=`repos/${bootstrap.repository}`,ci=runId+(phase==='certify'?10000:11999),caller=runId;
  const attempt=id=>`${repo}/actions/runs/${id}/attempts/1`,jobs=id=>`${attempt(id)}/jobs?per_page=100`,latest=id=>`${repo}/actions/runs/${id}`;
  const ciRuns=`${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${head}&per_page=100`;
  const workflow=phase==='certify'?'financial-source-renewal-certification.yml':'research-ui-release.yml';
  const common=[repo,attempt(ci),attempt(caller),jobs(ci),jobs(caller),`${repo}/git/ref/heads/main`,latest(ci),latest(caller),ciRuns,ciRuns,attempt(ci),jobs(ci),
    `${repo}/actions/workflows/${workflow}/runs?branch=main&head_sha=${head}&per_page=100`];
  if(phase==='certify')return [attempt(caller),ciRuns,attempt(ci),jobs(ci),...common,ciRuns,attempt(ci),jobs(ci),jobs(ci)];
  const publishers=`${repo}/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100`,staticRuns=`${repo}/actions/workflows/static-site.yml/runs?branch=main&per_page=100`;
  return [attempt(300),jobs(300),publishers,staticRuns,attempt(100),attempt(101),publishers,staticRuns,`${repo}/git/ref/heads/main`,ciRuns,attempt(ci),jobs(ci),attempt(caller),ciRuns,attempt(ci),jobs(ci),...common];
}
function assertFinalQuotaTail(f,phase,command,row,head){
  assert.equal(row.status,0);assert.equal(row.quota_reads,2);
  const audit=quotaAudit(f,phase,`${command}-final`,row);assert.equal(audit.status,'admitted');assert.equal(audit.minimum_remaining,phase==='certify'?21:29);
  const events=traceEvents(f).filter(item=>item.invocation===row.invocation),position=events.findLastIndex(item=>item.quota);
  const tail=events.slice(position+1).filter(item=>item.api).map(item=>item.api);
  assert.deepEqual(tail,expectedFinalTail({phase,head,runId:row.run_id}));return audit;
}

test('synthetic quota transport emits exact HTTP metadata and separates probes from primary API reads',t=>{
  const now=Date.parse('2026-10-05T13:00:00.000Z'),response=syntheticQuotaHttpResponse({},now);
  assert.match(response.raw,/^HTTP\/2\.0 200 OK\r\n/);assert.match(response.raw,/x-ratelimit-resource: core\r\n/);
  assert.equal(Date.parse(response.metadata.date),now);assert.equal(response.metadata.reset,now/1000+3600);
  const f=renewalLifecycleFixture(fixtureOptions());t.after(()=>f.cleanup());
  const initial=f.invoke('gh',quotaArgs);assert.equal(initial.status,0,initial.stderr);
  const body=JSON.parse(initial.stdout.split('\r\n\r\n')[1]);assert.equal(body.resources.core.remaining,1000);
  let row=invocations(f).at(-1);assert.equal(row.total,0);assert.equal(row.quota_reads,1);assert.equal(row.quota_events[0].sampled_at,Date.parse(f.now));
  f.config.quota={responses:[{remaining:800},{remaining:799}]};
  const code=`import {execFileSync} from 'node:child_process';for(let i=0;i<2;i++)execFileSync('gh',${JSON.stringify(quotaArgs)});`;
  const sequence=f.invoke(process.execPath,['--input-type=module','-e',code]);assert.equal(sequence.status,0,sequence.stderr);
  row=invocations(f).at(-1);assert.equal(row.total,0);assert.equal(row.quota_reads,2);assert.deepEqual(row.quota_events.map(item=>item.remaining),[800,799]);
  f.config.quota={status:429,headers:{'retry-after':'10'}};const limited=f.invoke('gh',quotaArgs);assert.equal(limited.status,1);assert.match(limited.stdout,/429 Too Many Requests/);
  failed(f.invoke('gh',['api','--include','rate_limit']),/Unexpected bounded fixture command/);
});

// This uses a two-symbol synthetic source and shared frontend dependencies.
// It never reads, downloads, or copies actual provider/capture archives.
test('automatic CI certifier → reviewed publisher → historical read → ordinary next-price carry (SYNTHETIC scheduling)',{timeout:25*60*1000},async t=>{
  const space=statfsSync(tmpdir());assert.ok(space.bavail*space.bsize>256*1024*1024,'Need 256 MiB free for the bounded synthetic fixture');
  const f=renewalLifecycleFixture(fixtureOptions());
  t.after(()=>{if(process.env.FINANCIAL_RENEWAL_TEST_KEEP==='1')t.diagnostic(`Retained disposable SYNTHETIC fixture: ${f.root}`);else f.cleanup();});
  const controls=['request','pin','intent'].map(key=>join(f.checkout,renewalPolicy[`${key}_path`]));
  withValue(f.env,'GITHUB_EVENT_NAME','workflow_run',()=>withoutQuota(f,()=>{
    f.certifyCommand('controls');
    withMissingFiles(controls,()=>f.certifyCommand('controls'));
  }));
  buildSyntheticRenewalSources(f);seedGenuineSourcePublication(f);
  let certificationNegatives=0,quotaNegatives=0;const boundaryAudits=[];
  const first=prepareAutomaticRenewal(f,{
    beforeCertification({runId,certifier}){
      withoutQuota(f,()=>withValue(f.env,'GITHUB_EVENT_NAME','workflow_dispatch',()=>f.certifyCommand('controls')));
      for(const [name,metadata]of [
        ['remaining below admission demand',{remaining:329}],['lower token limit',{limit:329,remaining:329}],
        ['non-core resource',{headers:{'x-ratelimit-resource':'graphql'}}],['stale Date',{dateOffsetMs:-61000}],
        ['future Date',{dateOffsetMs:1000}],['reset reached',{resetOffsetSeconds:0}],['reset in past',{resetOffsetSeconds:-1}],
        ['403 Retry-After',{status:403,headers:{'retry-after':'10'}}],['429 Retry-After',{status:429,headers:{'retry-after':'10'}}],
        ['malformed JSON',{body:'not JSON'}],['missing Date',{headers:{date:null}}],
        ['header/body disagreement',{headers:{'x-ratelimit-remaining':'999'}}],
        ['uncertain successful bytes',{exitCode:1,stderr:'SYNTHETIC_PRIVATE_TRANSPORT_DETAIL'}],
      ]){
        quotaHeld(f,'certify','admit',metadata,()=>f.certifyCommand('admit',{allowFailure:true}),{floor:330});quotaNegatives++;
      }
      const event=read(f.env.GITHUB_EVENT_PATH);
      withJson(f.env.GITHUB_EVENT_PATH,value=>value.workflow_run.run_attempt=2,()=>{
        failed(f.certifyCommand('prepare',{allowFailure:true}),/run identity|trigger|attempt|exact/i);certificationNegatives++;
      });
      withValue(f.config,'currentSha','f'.repeat(40),()=>{
        failed(f.certifyCommand('prepare',{allowFailure:true}),/current main|current-main/i);certificationNegatives++;
      });
      const history=historyEndpoint(renewalPolicy.workflow,f.head),prior={...certifier.run,id:runId-1};
      withValue(f.api,history,[{total_count:2,workflow_runs:[prior,certifier.run]}],()=>{
        failed(f.certifyCommand('prepare',{allowFailure:true}),/prior caller/i);certificationNegatives++;
      });
      const jobs=endpoint(runId,'/attempts/1/jobs?per_page=100'),missing=structuredClone(f.api[jobs]);missing[0].jobs[0].steps=[];
      withValue(f.api,jobs,missing,()=>{
        for(const command of ['admit','prepare','verify-source','verify-surfaces','verify-bounds','seal']){
          failed(f.certifyCommand(command,{allowFailure:true}),/admission.*step.*missing/i);certificationNegatives++;
        }
      });
      assert.deepEqual(read(f.env.GITHUB_EVENT_PATH),event);
    },
    afterCertification({candidate}){
      boundaryAudits.push(assertFinalQuotaTail(f,'certify','seal',lastInvocation(f,'financial-source-renewal-certification','seal'),f.head));
      for(const [command,floor]of [['prepare',78],['verify-source',29],['verify-surfaces',72],['verify-bounds',29],['seal',93]]){
        quotaHeld(f,'certify',command,{remaining:floor-1},()=>f.certifyCommand(command,{allowFailure:true}),{floor});quotaNegatives++;
      }
      const sealedOutputs=[join(candidate,'candidate.json'),join(f.env.RUNNER_TEMP,'financial-source-renewal-certification/candidate.tar')];
      const originalOutputs=sealedOutputs.map(path=>readFileSync(path));
      try{
        for(const path of sealedOutputs)rmSync(path);
        quotaHeld(f,'certify','seal',{responses:[{}, {remaining:20}]},()=>f.certifyCommand('seal',{allowFailure:true}),{final:true,floor:21});quotaNegatives++;
      }finally{sealedOutputs.forEach((path,index)=>writeFileSync(path,originalOutputs[index]));}
      sealedOutputs.forEach((path,index)=>assert.deepEqual(readFileSync(path),originalOutputs[index]));
      const archive=f.run('tar',['-tf',sealedOutputs[1]]);
      assert.doesNotMatch(archive,/financial-renewal-quota/,'operational quota snapshots must stay outside the sealed candidate');
      const controller=join(candidate,'certification-controller.json'),sealed=read(controller);
      assert.doesNotMatch(readFileSync(controller,'utf8'),/financial-renewal-quota-audit|minimum_remaining|probe_requests/);
      assert.equal(sealed.ci_admission.phase,'certify');
      withJson(controller,value=>delete value.ci_admission,()=>{
        failed(f.certifyCommand('seal',{allowFailure:true}),/saved admitted certifier/i);certificationNegatives++;
      });
      withJson(controller,value=>value.ci_admission.trigger.run_id++,()=>{
        failed(f.certifyCommand('verify-source',{allowFailure:true}),/saved admitted certifier/i);certificationNegatives++;
      });
      assert.deepEqual(read(controller),sealed);
    },
  });
  await t.test('registry-only R→A and B→C admissions preserve exact reviewed trees and raw controls',()=>{
    assert.equal(certificationNegatives,11);
    const controller=read(join(first.candidate,'certification-controller.json'));
    assert.equal(controller.ci_admission.reviewed.head_sha,first.r);
    assert.equal(controller.ci_admission.executing.head_sha,first.a);
    assert.equal(controller.ci_admission.caller.run_id,first.runId);
    assert.equal(read(join(f.checkout,registryPath)).ci_admission.reviewed_commit,first.b);
    f.checkpoint('Real automatic certification CLI rejected missing/adulterated proof, wrong upstream attempt, missing admission steps, main race and repeated caller',{negative_cases:certificationNegatives,r:first.r,a:first.a,b:first.b,c:first.c});
  });
  await t.test('publisher CLI rejects wrong upstream attempts, stale main, repeated callers, and missing authenticated admission step',()=>{
    withoutQuota(f,()=>withValue(f.env,'GITHUB_EVENT_NAME','workflow_dispatch',()=>failed(routeCommand(f,'admit',{allowFailure:true}),/execution context|exact main/i)));
    for(const source of [runCopy(f,first.runId+12001),f.workflow(13000,'.github/workflows/static-site.yml',first.c,{event:'schedule'})]){
      withoutQuota(f,()=>withJson(f.env.GITHUB_EVENT_PATH,value=>value.workflow_run=source,()=>failed(routeCommand(f,'admit',{allowFailure:true}),/run identity|trigger|exact/i)));
    }
    quotaHeld(f,'publish','admit',{remaining:721},()=>routeCommand(f,'admit',{allowFailure:true}),{floor:722});quotaNegatives++;
    withJson(f.env.GITHUB_EVENT_PATH,value=>value.workflow_run.run_attempt=2,()=>failed(f.command('plan',{allowFailure:true}),/run identity|attempt|exact/i));
    withValue(f.config,'currentSha',first.a,()=>failed(f.command('plan',{allowFailure:true}),/current main|current-main/i));
    const history=historyEndpoint(first.publisher.run.path,first.c),prior={...first.publisher.run,id:first.publisher.run.id-2};
    withValue(f.api,endpoint(prior.id,'/attempts/1'),prior,()=>withValue(f.api,endpoint(prior.id),prior,()=>
      withValue(f.api,history,[{total_count:2,workflow_runs:[prior,first.publisher.run]}],()=>failed(f.command('plan',{allowFailure:true}),/terminal ordinary publication/i))));
    const jobs=endpoint(first.publisher.run.id,'/attempts/1/jobs?per_page=100'),missing=structuredClone(f.api[jobs]);missing[0].jobs[0].steps=[];
    withValue(f.api,jobs,missing,()=>failed(f.command('plan',{allowFailure:true}),/admission.*step.*missing/i));
  });
  let finalRechecks=0;const recheckAudits=[];
  const firstLive=publishGenuineRenewal(f,first,{beforeCommand(command){
    const floor={plan:145,restore:88,compose:88}[command];
    quotaHeld(f,'publish',command,{remaining:floor-1},()=>f.command(command,{allowFailure:true}),{floor});quotaNegatives++;
  },beforeRecheck({phase}){
    if(finalRechecks){recheckAudits.push(assertFinalQuotaTail(f,'publish','recheck',lastInvocation(f,'select-release-source','recheck'),first.c));f.setTime(new Date(Date.parse(f.now)+1000).toISOString());}
    f.config.quota={remaining:1000-finalRechecks};
    quotaHeld(f,'publish','recheck',{remaining:181},()=>f.command('recheck',{allowFailure:true}),{floor:182});quotaNegatives++;
    if(!finalRechecks){quotaHeld(f,'publish','recheck',{responses:[{}, {remaining:28}]},()=>f.command('recheck',{allowFailure:true}),{final:true,floor:29});quotaNegatives++;}
    // Both actual workflow gates reject changed CI/current-main before their
    // ordinary positive invocation. No saved success substitutes for admission.
    const latest=endpoint(first.runId+12000),rerun=runCopy(f,first.runId+12000);rerun.run_attempt=2;
    withValue(f.api,latest,rerun,()=>failed(f.command('recheck',{allowFailure:true}),/run identity|attempt|trigger|exact/i));
    withValue(f.config,'currentSha',first.a,()=>failed(f.command('recheck',{allowFailure:true}),/current main|current-main/i));
    finalRechecks++;f.checkpoint(`Automatic ${phase} gate rejected changed current CI and main`);
  },beforeDeploy({state}){
    recheckAudits.push(assertFinalQuotaTail(f,'publish','recheck',lastInvocation(f,'select-release-source','recheck'),first.c));
    assert.equal(recheckAudits.length,2);assert.ok(recheckAudits[1].response_received_at_ms>recheckAudits[0].response_received_at_ms);
    assert.deepEqual(recheckAudits.map(audit=>audit.core.remaining),[1000,999]);
    assert.doesNotMatch(JSON.stringify(state.renewal.transition),/financial-renewal-quota-audit|minimum_remaining|probe_requests/);
    assert.equal(state.renewal.transition.publisher.ci_admission.phase,'publish');
    assert.equal(state.renewal.transition.publisher.ci_admission.reviewed.head_sha,first.b);
    assert.equal(state.renewal.transition.certification_controller.ci_admission.executing.head_sha,first.a);
    const originalRun=runCopy(f,first.live.receipt.run_id),originalJobs=f.api[endpoint(first.live.receipt.run_id,'/attempts/1/jobs?per_page=100')][0].jobs;
    f.registration({run_id:999,run_attempt:1},{run:{...originalRun,id:999},jobs:originalJobs.map(job=>({...job,id:9990,run_id:999})),artifacts:[]});
    withJson(join(f.liveRoot,'publication.json'),value=>{value.run_id=999;value.artifact_name='github-pages-999-1';},()=>{
      assert.notEqual(f.readLive().identity,first.live.identity);
      failed(f.command('recheck',{allowFailure:true}),/Live UI or data changed|predecessor changed/i);
    });
    const path=join(f.env.RUNNER_TEMP,'verified-publication/state.json');
    withJson(path,value=>delete value.renewal.transition.publisher.ci_admission,()=>failed(f.command('recheck',{allowFailure:true}),/publisher authority|admission|transition|changed|binding/i));
    f.command('recheck');
  },deploymentEvidence(){return finishAutomaticCaller(f,first.publisher,{deployed:true});}});
  assert.equal(finalRechecks,2);assert.equal(firstLive.financialRelease.mode,'renewal');
  await t.test('live historical reader requires the originally admitted successful caller and actual deployment step',()=>{
    const id=first.publisher.run.id,jobs=endpoint(id,'/attempts/1/jobs?per_page=100');
    for(const step of [admissionStep,'Deploy to GitHub Pages']){
      const bad=structuredClone(f.api[jobs]);bad[0].jobs[0].steps=bad[0].jobs[0].steps.filter(item=>item.name!==step);
      withValue(f.api,jobs,bad,()=>failed(f.readLive({allowFailure:true}),/admission|deploy/i));
    }
    const caller=runCopy(f,id);
    withValue(f.api,endpoint(id,'/attempts/1'),{...caller,created_at:'2026-10-05T13:01:59.000Z'},()=>failed(f.readLive({allowFailure:true}),/caller attempt|chronology|identity|mismatch/i));
    assert.equal(f.readLive().identity,firstLive.identity);
    assert.equal(caller.created_at,first.publisher.run.created_at);assert.equal(caller.run_started_at,first.publisher.run.run_started_at);
    f.checkpoint('Historical livePublication verified completed original automatic callers and successful admission/deployment steps');
  });
  // Completed intent removal makes current admission a hold while retained
  // immutable automatic proofs continue authenticating ordinary daily data.
  let ordinaryCaller;const carryTraceStart=traceEvents(f).length;
  const carry=carryGenuineRenewal(f,{beforePlan({runId,exportRun}){
    f.env.GITHUB_EVENT_NAME='workflow_run';
    write(f.env.GITHUB_EVENT_PATH,{action:'completed',repository:{full_name:bootstrap.repository,id:1203919607,default_branch:'main'},
      workflow_run:runCopy(f,exportRun)});
    const run=f.workflow(runId,'.github/workflows/research-ui-release.yml',f.head,{event:'workflow_run'});
    ordinaryCaller={run,jobs:[{id:runId*10,run_id:runId,run_attempt:1,head_sha:f.head,name:'publish',status:'completed',conclusion:'success',
      started_at:f.now,completed_at:f.now,steps:[completeStep('Deploy to GitHub Pages',f.now)]}],artifacts:[]};
    assert.deepEqual(routeCommand(f,'route'),{renewal:false,ordinary_non_ci:false});
  },deploymentEvidence(){return ordinaryCaller;}});
  assert.equal(traceEvents(f).slice(carryTraceStart).filter(item=>item.quota).length,0,'ordinary Static Site carry must not probe renewal quota');
  assert.equal(existsSync(join(f.checkout,renewalPolicy.intent_path)),false);
  assert.equal(carry.live.financialRelease.mode,'carry');assert.equal(carry.live.financialRelease.renewal.transitions.length,1);
  assert.deepEqual(carry.live.financialRelease.renewal,firstLive.financialRelease.renewal);
  assert.equal(f.readLive().identity,carry.live.identity);
  await t.test('pending and disabled automatic renewal preserve ordinary route after actual next-price carry',()=>{
    f.env.GITHUB_EVENT_NAME='workflow_run';
    write(f.env.GITHUB_EVENT_PATH,{action:'completed',workflow_run:{path:'.github/workflows/ci.yml'}});
    withoutQuota(f,()=>assert.deepEqual(routeCommand(f,'route'),{renewal:false,ordinary_non_ci:false}));
    withJson(join(f.checkout,registryPath),value=>{value.ci_admission=null;value.publication_enabled=false;},()=>{
      withoutQuota(f,()=>assert.deepEqual(routeCommand(f,'route'),{renewal:false,ordinary_non_ci:false}));
    });
  });
  f.checkpoint('Completed automatic renewal and real ordinary next-price carry with retained historical authority',{final_publication_identity:carry.live.identity,final_rechecks:finalRechecks,quota_negative_cases:quotaNegatives,quota_boundary_snapshots:[...boundaryAudits,...recheckAudits]});
  const recordedInvocations=invocations(f);
  const apiReads=readFileSync(join(f.root,'trace.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(item=>item.api).map(item=>item.api);
  const immutable=path=>/\/(?:git\/(?:commits|trees)|contents)\//.test(path);
  write(join(f.root,'api-budget-summary.json'),{schema_version:'synthetic-renewal-api-budget-v1',authority:'none',
    total:apiReads.length,unique:new Set(apiReads).size,immutable:apiReads.filter(immutable).length,mutable:apiReads.filter(path=>!immutable(path)).length,
    unique_immutable:new Set(apiReads.filter(immutable)).size,unique_mutable:new Set(apiReads.filter(path=>!immutable(path))).size,
    quota_probe_requests:traceEvents(f).filter(item=>item.quota).length,
    positive_cli:recordedInvocations.filter(item=>item.status===0&&item.command.some(arg=>/\/(?:select-release-source|financial-source-renewal-certification|financial-renewal-ci-routing)\.mjs$/.test(arg))),
    rejected_cli:recordedInvocations.filter(item=>item.status!==0),
    note:'Positive CLI entries include repeated adversarial recovery checks and subsequent carry; report workflow-minimum and full-test totals separately. Quota probes are counted separately from original API reads and use the same explicitly synthetic clock domain. Synthetic inventories are single-page: real pagination can require additional HTTP requests.'});
  t.diagnostic('Two-symbol SYNTHETIC provider/market/GitHub transport; real journals, cumulative archives, native projections, Git objects, sealed candidates and production CLIs.');
});
