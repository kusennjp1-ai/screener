// Synthetic scheduling and GitHub transport around the unchanged production
// CLIs. Real Git trees, journal archives, candidates and publication bytes are
// built by the shared offline fixture. Nothing here grants real-world authority.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {bootstrap,sha256} from '../publication-state.mjs';
import {renewalPolicy} from '../financial-source-renewal.mjs';
import {prepareGenuineRenewal,read,write} from './financial-source-renewal-lifecycle.mjs';

export const prefix=`repos/${bootstrap.repository}`;
export const registryPath='contracts/financial_source_renewal_v1.json';
export const admissionStep='Admit exact successful main CI renewal';
const publisherWorkflow='.github/workflows/research-ui-release.yml';
const git=(f,...args)=>execFileSync('git',['-C',f.checkout,...args],{encoding:'utf8'}).trim();
const tree=(f,sha)=>git(f,'rev-parse',`${sha}^{tree}`);
const rawControls=(f,keys)=>Object.fromEntries(keys.map(key=>[key,sha256(readFileSync(join(f.checkout,renewalPolicy[`${key}_path`])))]));
export const endpoint=(id,suffix='')=>`${prefix}/actions/runs/${id}${suffix}`;
export const historyEndpoint=(path,head)=>`${prefix}/actions/workflows/${path.split('/').at(-1)}/runs?branch=main&head_sha=${head}&per_page=100`;
export const completeStep=(name,at)=>({name,status:'completed',conclusion:'success',started_at:at,completed_at:at});

export function activateAutomaticCaller(f,{phase,runId,ciRunId,head=f.head}){
  const workflow=phase==='certify'?renewalPolicy.workflow:publisherWorkflow;
  const run={...f.workflow(runId,workflow,head,{event:'workflow_run'}),status:'in_progress',conclusion:null};
  const job={id:runId*10,run_id:runId,run_attempt:1,head_sha:head,name:phase==='certify'?renewalPolicy.job:'publish',
    status:'in_progress',conclusion:null,started_at:f.now,completed_at:null,
    steps:[{name:admissionStep,status:'in_progress',conclusion:null,started_at:f.now,completed_at:null}]};
  const evidence={run,jobs:[job],artifacts:[]};f.registration({run_id:runId,run_attempt:1},evidence);
  Object.assign(f.env,{GITHUB_EVENT_NAME:'workflow_run',GITHUB_REPOSITORY_ID:'1203919607',
    GITHUB_WORKFLOW_REF:`${bootstrap.repository}/${workflow}@refs/heads/main`,GH_TOKEN:'SYNTHETIC-offline-transport-token'});
  write(f.env.GITHUB_EVENT_PATH,{action:'completed',repository:{full_name:bootstrap.repository,id:1203919607,default_branch:'main'},
    workflow_run:f.api[endpoint(ciRunId,'/attempts/1')]});
  f.save();return evidence;
}

export function finishAutomaticCaller(f,evidence,{artifact,deployed=false,completedAt=f.now}={}){
  const steps=[admissionStep,...(deployed?['Deploy to GitHub Pages']:renewalPolicy.steps)];
  const completed={run:{...evidence.run,status:'completed',conclusion:'success',updated_at:completedAt},
    jobs:evidence.jobs.map(job=>({...job,status:'completed',conclusion:'success',completed_at:completedAt,
      steps:steps.map(name=>{const old=job.steps?.find(step=>step.name===name);return old?.status==='completed'?old:completeStep(name,completedAt);})})),artifacts:artifact?[artifact]:[]};
  f.registration({run_id:completed.run.id,run_attempt:1},completed);f.save();return completed;
}

export function routeCommand(f,command,{allowFailure=false}={}){
  const result=f.invoke(process.execPath,[join(f.checkout,'.github/scripts/financial-renewal-ci-routing.mjs'),command]);
  return allowFailure?result:JSON.parse(f.success(result,`automatic publisher ${command}`));
}

export function prepareAutomaticRenewal(f,{beforeCertification,afterCertification,...options}={}){
  let r,certifier,publisher,certifiedAt;
  const prepared=prepareGenuineRenewal(f,{...options,lifecycle:{
    reviewRequest({request,reviewedCommit,runId}){
      r=reviewedCommit;const path=join(f.checkout,registryPath),registry=read(path);
      assert.equal(registry.ci_admission,null);assert.equal(registry.publication_enabled,false);
      registry.ci_admission={phase:'certify',reviewed_commit:r,reviewed_tree:tree(f,r),controls:rawControls(f,['request'])};
      write(path,registry);const a=f.commit(`SYNTHETIC automatic ${runId} stage A: registry-only certification admission`,[registryPath]);
      assert.equal(git(f,'diff-tree','--no-commit-id','--name-only','-r',a),registryPath);
      assert.equal(git(f,'rev-parse',`${a}^`),r);return a;
    },
    beforeCertification({a,request,runId}){
      f.setTime(new Date(Date.parse(f.now)+10000).toISOString());
      certifier=activateAutomaticCaller(f,{phase:'certify',runId,ciRunId:runId+10000,head:a});
      f.certifyCommand('controls');f.certifyCommand('admit');
      beforeCertification?.({f,a,r,request,runId,certifier});
      certifier.jobs[0].steps=[completeStep(admissionStep,f.now)];
      f.registration({run_id:runId,run_attempt:1},certifier);
    },
    afterCertification(value){afterCertification?.({...value,certifier});certifiedAt=f.now;},
    reviewPublication({registry,b}){
      registry.ci_admission={phase:'publish',reviewed_commit:b,reviewed_tree:tree(f,b),controls:rawControls(f,['request','pin','intent'])};
    },
    beforePublisher({a,b,c,artifact,runId}){
      // The manual fixture supplied an artifact; replace only its explicitly
      // synthetic scheduling evidence, retaining the original caller clocks.
      finishAutomaticCaller(f,certifier,{artifact,completedAt:certifiedAt});
      assert.deepEqual(execFileSync('git',['-C',f.checkout,'show',`${a}:${registryPath}`]),execFileSync('git',['-C',f.checkout,'show',`${b}:${registryPath}`]));
      assert.equal(git(f,'diff-tree','--no-commit-id','--name-only','-r',c),registryPath);
      assert.equal(git(f,'rev-parse',`${c}^`),b);
      publisher=activateAutomaticCaller(f,{phase:'publish',runId:runId+1,ciRunId:runId+12000,head:c});
      assert.equal(routeCommand(f,'route').renewal,true);assert.equal(routeCommand(f,'admit').admitted,true);
      publisher.jobs[0].steps=[completeStep(admissionStep,f.now)];f.registration({run_id:runId+1,run_attempt:1},publisher);
    },
  }});
  return {...prepared,r,certifier,publisher};
}
