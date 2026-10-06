import test from 'node:test';
import assert from 'node:assert/strict';
import {pinnedReview, validationBranch, validationWorkflow, verifyCiSource} from './restore-bounded-refresh-ci-source.mjs';
import {recoverySource, repository, recoveryWorkflow} from './restore-statement-source.mjs';

function fixture() {
  const review=pinnedReview(), source=review.input_source, repo={id:1203919607,full_name:repository};
  const context={repository,branch:validationBranch,event:'push',id:40000000000,attempt:1,sha:'a'.repeat(40)};
  const current={id:context.id,run_attempt:1,head_sha:context.sha,head_branch:validationBranch,path:validationWorkflow,
    event:'push',status:'in_progress',workflow_id:99,repository:repo,head_repository:repo,run_started_at:'2026-10-06T13:00:00Z'};
  const run={id:source.run_id,run_attempt:source.run_attempt,head_sha:source.head_sha,head_branch:review.source_branch,path:recoveryWorkflow,
    event:'push',status:'completed',conclusion:'success',workflow_id:88,repository:repo,head_repository:repo,run_started_at:'2026-10-04T15:00:00Z'};
  const job={id:31,run_id:run.id,run_attempt:run.run_attempt,head_sha:run.head_sha,name:'statement-recovery',status:'completed',
    conclusion:'success',started_at:'2026-10-04T15:00:01Z',completed_at:'2026-10-04T15:07:00Z'};
  const artifact={id:source.artifact_id,name:source.artifact_name,digest:`sha256:${source.artifact_sha256}`,size_in_bytes:27524165,
    expired:false,created_at:'2026-10-04T15:06:30Z',workflow_run:{id:run.id,head_sha:run.head_sha,head_branch:run.head_branch,
      repository_id:repo.id,head_repository_id:repo.id}};
  const inventory={total_count:1,workflow_runs:[structuredClone(run)]},jobs={total_count:1,jobs:[job]},artifacts={total_count:1,artifacts:[artifact]};
  const main={object:{sha:review.main_must_remain}},calls=[];
  const answers={
    [`repos/${repository}/actions/runs/${context.id}`]:current,
    [`repos/${repository}/git/ref/heads/main`]:main,
    [`repos/${repository}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`]:inventory,
    [`repos/${repository}/actions/runs/${source.run_id}/attempts/${source.run_attempt}`]:run,
    [`repos/${repository}/actions/runs/${source.run_id}/attempts/${source.run_attempt}/jobs?per_page=100`]:jobs,
    [`repos/${repository}/actions/runs/${source.run_id}/artifacts?per_page=100`]:artifacts,
  };
  const api=endpoint=>{calls.push(endpoint);assert.ok(Object.hasOwn(answers,endpoint));return answers[endpoint];};
  return {review,source,context,current,run,job,artifact,inventory,jobs,artifacts,main,calls,api};
}

test('isolated reader binds exact disabled review and original terminal artifact',()=>{
  const f=fixture(), result=verifyCiSource(f.context,f.api);
  assert.equal(result.authority,'test_evidence_only');assert.equal(result.publication_authority,'none');
  assert.deepEqual(result.source,f.source);assert.equal(f.calls.length,6);
  assert.equal(f.calls.some(path=>/dispatch|\/zip$/.test(path)),false);
});

test('production restore still rejects the review workflow without any API call',()=>{
  const f=fixture();assert.throws(()=>recoverySource(f.context,()=>assert.fail('Production override forbidden')),/Invalid recovery-run context/);
});

test('wrong CI branch, event, identity and workflow cannot restore',()=>{
  for(const change of [{branch:'main'},{branch:'improve/mandatory-financial-source-recovery'},{event:'workflow_dispatch'},
    {event:'pull_request'},{repository:'foreign/repo'},{attempt:0},{id:0},{sha:'invalid'}]) {
    const f=fixture();assert.throws(()=>verifyCiSource({...f.context,...change},f.api));assert.equal(f.calls.length,0);
  }
  for(const change of [{head_sha:'b'.repeat(40)},{head_branch:'main'},{path:recoveryWorkflow},{status:'completed'},
    {run_attempt:2},{repository:{id:1,full_name:repository}},{head_repository:{id:1,full_name:repository}}]) {
    const f=fixture();Object.assign(f.current,change);assert.throws(()=>verifyCiSource(f.context,f.api));
  }
});

test('moved main and stale, live or incomplete recovery inventories reject',()=>{
  for(const mutate of [f=>f.main.object.sha='b'.repeat(40), f=>f.inventory.total_count=2,
    f=>f.inventory.workflow_runs[0].run_attempt++,f=>f.inventory.workflow_runs[0].status='in_progress',
    f=>{f.inventory.workflow_runs.push({...f.run,id:f.run.id+1});f.inventory.total_count++;},
    f=>{f.inventory.workflow_runs.push({...f.run,id:1,head_branch:'main',status:'in_progress'});f.inventory.total_count++;}]) {
    const f=fixture();mutate(f);assert.throws(()=>verifyCiSource(f.context,f.api));
  }
  for(const status of ['queued','waiting','pending','requested','in_progress']) {
    const f=fixture();f.inventory.workflow_runs.push({...f.run,id:1,head_branch:'main',status});f.inventory.total_count++;
    assert.throws(()=>verifyCiSource(f.context,f.api),/nonterminal/);
  }
});

test('producer attempt, workflow and job must all match the pinned source',()=>{
  for(const change of [{id:1},{run_attempt:9},{head_sha:'b'.repeat(40)},{event:'workflow_dispatch'},
    {head_branch:'main'},{path:validationWorkflow},{status:'in_progress'},{conclusion:'failure'},{workflow_id:89}]) {
    const f=fixture();Object.assign(f.run,change);assert.throws(()=>verifyCiSource(f.context,f.api));
  }
  for(const change of [{id:0},{run_id:1},{run_attempt:9},{head_sha:'b'.repeat(40)},{name:'other'},{conclusion:'failure'},
    {status:'in_progress'},{completed_at:'2026-10-04T15:01:00Z'}]) {
    const f=fixture();Object.assign(f.job,change);assert.throws(()=>verifyCiSource(f.context,f.api));
  }
  const f=fixture();f.jobs.jobs.push({...f.job,id:32});f.jobs.total_count++;
  assert.throws(()=>verifyCiSource(f.context,f.api),/ambiguous/);
});

test('missing, substituted, expired, oversized and wrong-interval artifacts reject',()=>{
  for(const change of [{id:1},{name:'other'},{digest:`sha256:${'b'.repeat(64)}`},{expired:true},
    {size_in_bytes:27524166},{size_in_bytes:129*1024*1024},{created_at:'2026-10-04T14:59:00Z'},
    {created_at:'2026-10-06T13:00:00Z'},{workflow_run:{id:1}}]) {
    const f=fixture();Object.assign(f.artifact,change);assert.throws(()=>verifyCiSource(f.context,f.api));
  }
  for(const mutate of [f=>f.artifacts.artifacts=[],f=>f.artifacts.total_count=2,
    f=>{f.artifacts.artifacts.push({...f.artifact,id:2});f.artifacts.total_count++;}]) {
    const f=fixture();mutate(f);assert.throws(()=>verifyCiSource(f.context,f.api));
  }
});
