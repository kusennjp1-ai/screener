// Offline hypothetical run9 inputs only. This does not create an activation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {repository,recoveryWorkflow} from '../../restore-statement-source.mjs';
import {abortBranch,spentRequestPath,run9ReplacementSchema,reviewedPreparedAbort8,reviewedAbort7,reviewedAbort6,reviewedAbort,reviewedSource} from '../../verify-statement-pre-provider-abort.mjs';
const bytes=(name,file)=>readFileSync(new URL(`../${name}/${file}`,import.meta.url));
const historical=number=>`targeted-${number===8?'prepared-abort':'abort'}-run${number}`;
export const run8Fixture=file=>file==='job.log'?Buffer.from(JSON.parse(bytes(historical(8),'job-log.json')).content,'base64'):bytes(historical(8),file);
export const preparedAbortRequest=()=>({...JSON.parse(run8Fixture('request.json')),schema_version:run9ReplacementSchema,
  operation_id:'targeted-nvda-aaoi-offline-run9',expected_run_number:9,created_at:'2026-10-17T08:00:00Z',expires_at:'2026-10-17T09:00:00Z',
  abort_continuity:{run8:{...reviewedPreparedAbort8},run7:{...reviewedAbort7},run6:{...reviewedAbort6},run5:{...reviewedAbort}}});
export function preparedAbortFixture(){
  const apiRoot=`repos/${repository}`,inventoryPath=`${apiRoot}/actions/workflows/financial-statement-recovery.yml/runs?event=push&per_page=100`;
  const endpoints={},logs=new Map(),aborts=[];
  for(const identity of [reviewedPreparedAbort8,reviewedAbort7,reviewedAbort6,reviewedAbort]){
    const name=historical(identity.run_number),terminal=JSON.parse(bytes(name,'terminal.json')),run=terminal.abort;
    aborts.push(run);
    const prefix=`${apiRoot}/actions/runs/${run.id}`,requestBytes=bytes(name,'request.json');
    for(const suffix of ['', '/attempts/1'])endpoints[prefix+suffix]=structuredClone(run);
    endpoints[prefix+'/attempts/1/jobs?per_page=100']=terminal.jobs;
    endpoints[prefix+'/artifacts?per_page=100']=terminal.artifacts??{total_count:0,artifacts:[]};
    endpoints[`${apiRoot}/contents/${spentRequestPath}?ref=${identity.head_sha}`]={type:'file',path:spentRequestPath,size:requestBytes.length,encoding:'base64',content:requestBytes.toString('base64')};
    logs.set(identity.job_id,identity.run_number===8?run8Fixture('job.log'):Buffer.from(JSON.parse(bytes(name,'job-log.json')).content,'base64'));
  }
  const current={...structuredClone(aborts[0]),id:39013437790,head_sha:'d'.repeat(40),run_number:9,status:'in_progress',conclusion:null,run_started_at:'2026-10-17T08:01:00Z'};
  const source=JSON.parse(bytes(historical(5),'terminal.json')).source;
  for(const run of [source,current])for(const suffix of ['', '/attempts/1'])endpoints[`${apiRoot}/actions/runs/${run.id}${suffix}`]=structuredClone(run);
  endpoints[inventoryPath]={total_count:6,workflow_runs:[current,...aborts,source]};
  endpoints[`${apiRoot}/git/ref/heads/${abortBranch}`]={object:{sha:current.head_sha}};
  endpoints[`${apiRoot}/actions/runs/${source.id}/artifacts?per_page=100`]={total_count:1,artifacts:[{
    id:reviewedSource.artifact_id,name:`financial-statement-recovery-${source.head_sha}-1`,size_in_bytes:33424519,expired:false,
    digest:`sha256:${reviewedSource.artifact_sha256}`,created_at:'2026-10-06T14:40:06Z',
    workflow_run:{id:source.id,head_sha:source.head_sha,head_branch:abortBranch,repository_id:current.repository.id,head_repository_id:current.repository.id}}]};
  const calls=[],logCalls=[];
  return {endpoints,calls,logCalls,inventoryPath,apiRoot,
    state:{initial:false,current:structuredClone(current),run:structuredClone(aborts[0])},
    context:{id:current.id,sha:current.head_sha,branch:abortBranch,attempt:1,event:'push',repository},
    api:path=>{calls.push(path);assert.ok(Object.hasOwn(endpoints,path),`Unexpected API: ${path}`);return structuredClone(endpoints[path]);},
    readLog:id=>{logCalls.push(id);assert.ok(logs.has(id),'Unexpected log');return Buffer.from(logs.get(id));}};
}
