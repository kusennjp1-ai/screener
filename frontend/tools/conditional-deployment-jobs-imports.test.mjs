import {describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {
 createConditionalDeploymentJobsReader,withConditionalDeploymentJobsReader,
 withInvocationConditionalDeploymentJobs,readScopedDeploymentJobs,
} from '../../.github/scripts/conditional-deployment-jobs.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'../../');
const scope={repository:'kusennjp1-ai/screener',repository_id:1203919607,run_id:900,run_attempt:1,controller_sha:'b'.repeat(40)};
const candidate={id:11,run_attempt:1,head_sha:'a'.repeat(40),head_branch:'main',workflow_id:294257497,
 path:'.github/workflows/static-site.yml',name:'Synthetic workflow',event:'workflow_dispatch',
 repository:{id:scope.repository_id,full_name:scope.repository},head_repository:{id:scope.repository_id,full_name:scope.repository},
 status:'completed',conclusion:'success',created_at:'2026-10-09T01:00:00Z',run_started_at:'2026-10-09T01:00:00Z',updated_at:'2026-10-09T01:10:00Z'};
describe('conditional history under the unchanged frontend Vite configuration',()=>{
 it('resolves the tracked native worker and retains its closed missing-token failure',()=>{
  let called=0;const reports=[];
  const reader=createConditionalDeploymentJobsReader({scope,token:()=> 'synthetic-import-token',report:v=>reports.push(v),
   run:(command,args,options)=>{
    called++;expect(command).toBe(process.execPath);expect(args).toEqual(['--max-old-space-size=384',join(root,'.github/scripts/conditional-deployment-jobs-worker.mjs')]);
    expect(existsSync(args[1])).toBe(true);expect(args[1]).not.toMatch(/^https?:/);
    return execFileSync(command,args,{...options,env:{...process.env,GH_TOKEN:'',GITHUB_TOKEN:''}});
   }});
  expect(()=>reader.read([candidate])).toThrow(/worker-command-failed/);
  expect(called).toBe(1);expect(reader.disposed).toBe(true);expect(reports).toHaveLength(1);
  expect(reports[0].measurement_incomplete).toBe(false);expect(reports[0].counts.conditional_requests_issued).toBe(0);
  expect(JSON.stringify(reports)).not.toContain('synthetic-import-token');
 });
 it('keeps a foreign invocation inert',()=>{
  expect(withInvocationConditionalDeploymentJobs('foreign/repository',()=>readScopedDeploymentJobs(scope.repository,()=>{},[]))).toBe(null);
 });
 it('disposes the owned asynchronous scope under transformed imports',async()=>{
  const reader=createConditionalDeploymentJobsReader({scope,token:()=> 'synthetic-import-token',
   run:()=>{throw Error('No worker for empty candidate list');}});
  await withConditionalDeploymentJobsReader(reader,async()=>{
   await Promise.resolve();expect(readScopedDeploymentJobs(scope.repository,()=>{},[]).size).toBe(0);
  });
  expect(reader.disposed).toBe(true);expect(readScopedDeploymentJobs(scope.repository,()=>{},[])).toBe(null);
 });
});
