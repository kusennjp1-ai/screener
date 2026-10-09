import {describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync,mkdtempSync,mkdirSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {initializeJobCache,openJobCache,cleanupJobCache} from '../../.github/scripts/conditional-deployment-jobs-cache.mjs';
import {REQUEST_REPRESENTATION} from '../../.github/scripts/conditional-deployment-jobs-worker.mjs';
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
 it('opens the branded file cache and reuses one owned scope across nested transformed calls',async()=>{
  const prior=process.env.RUNNER_TEMP,directory=mkdtempSync(join(tmpdir(),'conditional-vite-cache-'));process.env.RUNNER_TEMP=directory;
  const now=()=>Date.parse('2026-10-09T01:30:00Z'),token='synthetic-vite-cache-token',
   context={...scope,job_id:99001,job_name:'Synthetic transformed cache',job_started_at:'2026-10-09T01:00:00Z',
    role:'diagnostic',controller_tree:'c'.repeat(40),request_sha256:'d'.repeat(64),event_sha256:'e'.repeat(64),
    schema_version:'conditional-deployment-jobs-cache-context-v1',reader_version:'aec69c0bafd2ab0c2ab33bbf935242be284616df',representation:REQUEST_REPRESENTATION};
  let cacheDirectory;
  try{
   const handle=initializeJobCache({context,root:directory,token,now});cacheDirectory=handle.directory;
   const reader=createConditionalDeploymentJobsReader({scope,jobCache:handle,token:()=>token,run:()=>{throw Error('Empty cohort must not launch native transport');}});
   await withConditionalDeploymentJobsReader(reader,()=>withInvocationConditionalDeploymentJobs(scope.repository,async()=>{
    await Promise.resolve();expect(readScopedDeploymentJobs(scope.repository,()=>{},[]).size).toBe(0);
    expect(reader.disposed).toBe(false);expect(existsSync(join(cacheDirectory,'lease.json'))).toBe(true);
   }));
   expect(reader.disposed).toBe(true);expect(existsSync(join(cacheDirectory,'lease.json'))).toBe(false);
   const next=openJobCache({context,directory:cacheDirectory,token,now});
   expect(next.loadVerified()).toEqual({runs:[],pages:[],excludedIds:[scope.run_id],generation:1});next.dispose();
   cleanupJobCache({context,directory:cacheDirectory,token});
  }finally{
   if(prior===undefined)delete process.env.RUNNER_TEMP;else process.env.RUNNER_TEMP=prior;rmSync(directory,{recursive:true,force:true});
  }
 });
 it('copies every tracked transport dependency before resolving the closed native worker boundary',()=>{
  const directory=mkdtempSync(join(tmpdir(),'conditional-vite-controller-')),scripts=join(directory,'.github/scripts');
  mkdirSync(scripts,{recursive:true});
  for(const name of['conditional-deployment-jobs.mjs','conditional-deployment-jobs-worker.mjs','conditional-deployment-jobs-cache.mjs']){
   copyFileSync(join(root,'.github/scripts',name),join(scripts,name));
  }
  const code="import {createConditionalDeploymentJobsReader} from "+JSON.stringify('file://'+join(scripts,'conditional-deployment-jobs.mjs'))+";"+
   "const reports=[];const reader=createConditionalDeploymentJobsReader({scope:"+JSON.stringify(scope)+",token:()=> 'synthetic-copied-import-token',report:v=>reports.push(v)});"+
   "try{reader.read("+JSON.stringify([candidate])+");throw Error('unexpected native worker success');}catch(e){if(e.conditionalReason!=='worker-command-failed')throw e;}"+
   "if(!reader.disposed||reports.length!==1||reports[0].measurement_incomplete||reports[0].counts.conditional_requests_issued!==0)throw Error('copied worker boundary failed');console.log('copied-controller-worker-closed');";
  try{
   const out=execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,GH_TOKEN:'',GITHUB_TOKEN:''},timeout:5000,maxBuffer:1024**2});
   expect(out.trim()).toBe('copied-controller-worker-closed');expect(existsSync(join(directory,'frontend'))).toBe(false);
  }finally{rmSync(directory,{recursive:true,force:true});}
 });

});
