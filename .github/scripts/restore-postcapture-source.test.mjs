import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pinnedRequest,verifyPostcaptureSource,verifyDownloadedBytes,verifyDownloadedLog,verifyRetrievalStable,downloadPinnedBytes,repository,validationBranch,validationWorkflow,mainCommit,mainTree} from './restore-postcapture-source.mjs';

const request = pinnedRequest();
const currentId = 40000000001, currentSha = 'a'.repeat(40), currentTree = 'b'.repeat(40);
const sourceBranch = 'improve/mandatory-financial-source-recovery';
const sourceWorkflow = '.github/workflows/financial-statement-recovery.yml';
const repo = {id:1203919607,full_name:repository};

test('pinned binary log retrieval preserves ANSI bytes without terminal output', () => {
  const endpoint = `repos/${repository}/actions/jobs/${request.producer_job_id}/logs`;
  const bytes = Buffer.alloc(47470); bytes.write('\u001b[36moriginal log\u001b[0m');
  const actual = downloadPinnedBytes(endpoint, bytes.length, (command, args, options) => {
    assert.equal(command, 'gh');
    assert.deepEqual(args, ['api', endpoint, '--allow-escape-sequences']);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(options.maxBuffer, 47471); assert.equal(options.timeout, 120000);
    assert.equal(options.encoding, undefined); return bytes;
  });
  assert.strictEqual(actual, bytes);
  assert.throws(() => verifyDownloadedLog(actual), /Exact producer log bytes changed/);
});

test('binary retrieval cannot opt arbitrary endpoints or lengths into raw output', () => {
  const execute = () => { throw Error('must not execute'); };
  assert.throws(() => downloadPinnedBytes('repos/other/repo/issues', undefined, execute), /Unreviewed download/);
  assert.throws(() => downloadPinnedBytes('repos/other/repo/issues', 47470, execute), /Unreviewed download/);
  assert.throws(() => downloadPinnedBytes(`repos/${repository}/actions/jobs/${request.producer_job_id}/logs`, 47471, execute), /Unreviewed download/);
  assert.throws(() => downloadPinnedBytes(`repos/${repository}/actions/jobs/${request.producer_job_id}/logs`, 47470, () => Buffer.alloc(1)), /byte length changed/);
});
function fixture() {
  const context = {repository,branch:validationBranch,event:'push',id:currentId,attempt:1,sha:currentSha};
  const current = {id:currentId,run_attempt:1,head_sha:currentSha,head_branch:validationBranch,path:validationWorkflow,
    event:'push',status:'in_progress',conclusion:null,workflow_id:1001,head_commit:{id:currentSha,tree_id:currentTree},repository:repo,head_repository:repo,run_started_at:'2026-10-06T16:00:00Z'};
  const job = {id:50000000001,run_id:currentId,run_attempt:1,head_sha:currentSha,name:'validate-captured-source',status:'in_progress',conclusion:null,started_at:'2026-10-06T16:00:05Z'};
  const run = {id:request.source.run_id,run_attempt:1,run_number:4,head_sha:request.source.head_sha,
    head_branch:sourceBranch,path:sourceWorkflow,event:'push',status:'completed',conclusion:'failure',workflow_id:999,
    repository:repo,head_repository:repo,run_started_at:'2026-10-06T14:24:48Z',head_commit:{tree_id:request.producer_tree_sha}};
  const sourceJob = {id:request.producer_job_id,run_id:run.id,run_attempt:1,head_sha:run.head_sha,name:'statement-recovery',status:'completed',conclusion:'failure',
    started_at:'2026-10-06T14:24:48Z',completed_at:'2026-10-06T14:40:09Z',steps:[{number:10,name:request.failure_boundary.failed_step_name,status:'completed',conclusion:'failure'}]};
  const artifact = {id:request.source.artifact_id,name:request.source.artifact_name,expired:false,size_in_bytes:request.artifact_size_bytes,
    digest:`sha256:${request.source.artifact_sha256}`,created_at:'2026-10-06T14:40:06Z',expires_at:'2026-10-20T14:39:58Z',
    workflow_run:{id:run.id,head_sha:run.head_sha,repository_id:repo.id,head_repository_id:repo.id,head_branch:sourceBranch}};
  const responses = {
    [`repos/${repository}/actions/runs/${currentId}`]:current,
    [`repos/${repository}/git/ref/heads/${validationBranch}`]:{object:{sha:currentSha}},
    [`repos/${repository}/git/ref/heads/main`]:{object:{sha:mainCommit}},
    [`repos/${repository}/git/ref/heads/${sourceBranch}`]:{object:{sha:run.head_sha}},
    [`repos/${repository}/git/commits/${currentSha}`]:{sha:currentSha,tree:{sha:currentTree},parents:[{sha:mainCommit}]},
    [`repos/${repository}/git/trees/${currentTree}?recursive=1`]:{sha:currentTree,truncated:false,tree:[{path:'test-only-placeholder',type:'blob',sha:'c'.repeat(40)}]},
    [`repos/${repository}/actions/runs/${currentId}/attempts/1/jobs?per_page=100`]:{total_count:1,jobs:[job]},
    [`repos/${repository}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`]:{total_count:1,workflow_runs:[run]},
    [`repos/${repository}/actions/runs/${run.id}/attempts/1`]:run,
    [`repos/${repository}/git/commits/${run.head_sha}`]:{sha:run.head_sha,tree:{sha:request.producer_tree_sha}},
    [`repos/${repository}/actions/runs/${run.id}/attempts/1/jobs?per_page=100`]:{total_count:1,jobs:[sourceJob]},
    [`repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`]:{total_count:1,artifacts:[artifact]},
  };
  const local = {head:currentSha,tree:currentTree,clean:true};
  const api = endpoint => {assert.ok(Object.hasOwn(responses,endpoint),`Unexpected API call ${endpoint}`);return structuredClone(responses[endpoint]);};
  const verify = () => verifyPostcaptureSource(context,api,()=>local,()=>Date.parse('2026-10-06T16:01:00Z'));
  return {context,current,job,run,sourceJob,artifact,responses,local,verify};
}

test('closed request selects one exact failed producer with no publication authority',()=>{
  const f=fixture(), evidence=f.verify();
  assert.equal(evidence.run.conclusion,'failure');assert.equal(evidence.validator.run.status,'in_progress');
  assert.deepEqual(Object.keys(evidence),['run','jobs','artifacts','validator']);
  assert.equal(mainTree,'00a8eaa6b14b977f31f24ac9f708872c2dbe5ee9');
});
const attacks = [
  ['wrong branch',f=>f.context.branch='main',/caller context/],
  ['workflow dispatch',f=>f.context.event='workflow_dispatch',/caller context/],
  ['validator attempt2',f=>f.context.attempt=2,/caller context/],
  ['wrong repository',f=>f.context.repository='other/repo',/caller context/],
  ['dirty checkout',f=>f.local.clean=false,/checkout/],
  ['wrong local head',f=>f.local.head='f'.repeat(40),/checkout/],
  ['different caller head',f=>f.current.head_sha='f'.repeat(40),/caller identity/],
  ['pretend validator succeeded',f=>{f.current.status='completed';f.current.conclusion='success';},/caller identity/],
  ['wrong caller tree',f=>f.current.head_commit.tree_id='f'.repeat(40),/caller identity/],
  ['wrong caller workflow',f=>f.current.path=sourceWorkflow,/caller identity/],
  ['caller repository identity',f=>f.current.repository={...repo,id:9},/caller identity/],
  ['moved main',f=>f.responses[`repos/${repository}/git/ref/heads/main`].object.sha='f'.repeat(40),/main changed/],
  ['moved source branch',f=>f.responses[`repos/${repository}/git/ref/heads/${sourceBranch}`].object.sha='f'.repeat(40),/Producer branch/],
  ['moved validator branch',f=>f.responses[`repos/${repository}/git/ref/heads/${validationBranch}`].object.sha='f'.repeat(40),/Validation branch/],
  ['wrong parent',f=>f.responses[`repos/${repository}/git/commits/${currentSha}`].parents[0].sha='f'.repeat(40),/commit\/tree\/base/],
  ['different tree',f=>f.responses[`repos/${repository}/git/commits/${currentSha}`].tree.sha='f'.repeat(40),/commit\/tree\/base/],
  ['truncated code tree',f=>f.responses[`repos/${repository}/git/trees/${currentTree}?recursive=1`].truncated=true,/code tree/],
  ['wrong validator job head',f=>f.job.head_sha='f'.repeat(40),/Validator job identity/],
  ['ambiguous validator job',f=>{const x=f.responses[`repos/${repository}/actions/runs/${currentId}/attempts/1/jobs?per_page=100`];x.jobs.push({...f.job});x.total_count=2;},/ambiguous validator/],
  ['missing recovery page',f=>f.responses[`repos/${repository}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`].total_count=2,/Incomplete recovery/],
  ['nonterminal recovery',f=>f.run.status='in_progress',/nonterminal/],
  ['replayed attempt2',f=>f.run.run_attempt=2,/latest recovery/],
  ['relabel producer success',f=>f.run.conclusion='success',/failed producer identity/],
  ['wrong run number',f=>f.run.run_number=5,/failed producer identity/],
  ['wrong producer tree',f=>f.run.head_commit.tree_id='f'.repeat(40),/failed producer identity/],
  ['wrong source commit tree',f=>f.responses[`repos/${repository}/git/commits/${f.run.head_sha}`].tree.sha='f'.repeat(40),/Producer tree/],
  ['wrong producer job',f=>f.sourceJob.id++,/producer job/],
  ['wrong producer job attempt',f=>f.sourceJob.run_attempt=2,/producer job/],
  ['wrong failing step',f=>f.sourceJob.steps[0].number=9,/different boundary/],
  ['additional failed step',f=>f.sourceJob.steps.push({number:11,name:'unexpected',status:'completed',conclusion:'failure'}),/different boundary/],
  ['cancelled final step',f=>f.sourceJob.steps.push({number:11,name:'unexpected',status:'completed',conclusion:'cancelled'}),/different boundary/],
  ['wrong artifact ID',f=>f.artifact.id++,/artifact identity/],
  ['wrong artifact hash',f=>f.artifact.digest='sha256:'+'f'.repeat(64),/artifact identity/],
  ['wrong artifact bytes',f=>f.artifact.size_in_bytes++,/artifact identity/],
  ['expired artifact flag',f=>f.artifact.expired=true,/artifact identity/],
  ['expired artifact clock',f=>f.artifact.expires_at='2026-10-06T15:00:00Z',/clocks or expiry/],
  ['wrong artifact producer',f=>f.artifact.workflow_run.head_sha='f'.repeat(40),/artifact identity/],
  ['artifact before producer',f=>f.artifact.created_at='2026-10-06T14:00:00Z',/clocks or expiry/],
  ['validator before producer completion',f=>f.current.run_started_at='2026-10-06T14:00:00Z',/clocks or expiry/],
  ['source job page incomplete',f=>f.responses[`repos/${repository}/actions/runs/${f.run.id}/attempts/1/jobs?per_page=100`].total_count=2,/Incomplete source job/],
  ['source artifact page incomplete',f=>f.responses[`repos/${repository}/actions/runs/${f.run.id}/artifacts?per_page=100`].total_count=2,/Incomplete source artifact/],
];
for (const [name,mutate,expected] of attacks) test(`retrieval rejects ${name}`,()=>{const f=fixture();mutate(f);assert.throws(f.verify,expected);});
test('download bytes require the exact source digest',()=>assert.throws(()=>verifyDownloadedBytes(Buffer.alloc(request.artifact_size_bytes),Buffer.alloc(47470)),/ZIP bytes/));
test('workflow is isolated and has read-only repository permissions',()=>{
  const workflow=readFileSync(new URL('../workflows/financial-source-postcapture-validation.yml',import.meta.url),'utf8');
  assert.match(workflow,/branches: \[preview\/financial-source-postcapture-validation\]/);
  assert.match(workflow,/permissions:\n  contents: read\n  actions: read/);
  assert.doesNotMatch(workflow,/\b(?:contents|actions|pages|id-token): write/);
  assert.doesNotMatch(workflow,/^  (?:schedule|workflow_dispatch):/m);
  assert.doesNotMatch(workflow,/secrets\.|git push|gh api.*(?:POST|PATCH|PUT|DELETE)/);
  assert.match(workflow,/persist-credentials: false/);
});

test('original job log bytes are independently pinned',()=>assert.throws(()=>verifyDownloadedLog(Buffer.alloc(47470)),/log bytes/));
test('retrieval rejects a concurrent source rewrite',()=>{const a=fixture().verify(),b=structuredClone(a);b.run.conclusion='success';assert.throws(()=>verifyRetrievalStable(a,b),/during retrieval/);});
test('retrieval rejects a concurrent validator job replacement',()=>{const a=fixture().verify(),b=structuredClone(a);b.validator.job.id++;assert.throws(()=>verifyRetrievalStable(a,b),/during retrieval/);});
