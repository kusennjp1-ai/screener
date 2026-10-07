// Read-only routing before the existing protected publication job. Ordinary
// price/data updates remain available; only exact admitted CI selects renewal.
import {execFileSync} from 'node:child_process';
import {appendFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bootstrap} from './publication-state.mjs';
import {digest} from './financial-correction.mjs';
import {githubApi,withInvocationImmutableGitApi} from './publication-gate.mjs';
import {renewalCiEligibility,renewalCiLocalContext,verifyRenewalCiAdmission} from './financial-renewal-ci-admission.mjs';
import {enforceRenewalQuota} from './financial-renewal-quota.mjs';

const repository=bootstrap.repository,repositoryId=1203919607,workflow='.github/workflows/research-ui-release.yml';
const positive=value=>Number.isSafeInteger(value)&&value>0;
const sameRepo=value=>value?.repository?.full_name===repository&&value.repository.id===repositoryId&&value?.head_repository?.full_name===repository&&value.head_repository.id===repositoryId;
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
const terminal=new Set(['success','failure','neutral','cancelled','timed_out','action_required','skipped','stale','startup_failure']);
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:1024*1024}).trim();
const context=()=>({event_name:process.env.GITHUB_EVENT_NAME,repository:process.env.GITHUB_REPOSITORY,repository_id:Number(process.env.GITHUB_REPOSITORY_ID),
  ref:process.env.GITHUB_REF,sha:process.env.GITHUB_SHA,workflow_ref:process.env.GITHUB_WORKFLOW_REF,workflow_sha:process.env.GITHUB_WORKFLOW_SHA,
  run_id:Number(process.env.GITHUB_RUN_ID),run_attempt:Number(process.env.GITHUB_RUN_ATTEMPT)});
const identity=run=>Object.fromEntries(['id','run_attempt','workflow_id','path','head_sha','head_branch','event','status','conclusion','created_at','run_started_at','updated_at','repository','head_repository'].map(key=>[key,
  ['repository','head_repository'].includes(key)?{id:run[key]?.id,full_name:run[key]?.full_name}:run[key]]));

export function routeRenewalCiPublication({root=process.cwd(),event,execution=context(),api=githubApi}={}){
  const ordinary={renewal:false,ordinary_non_ci:false};
  if(execution.event_name!=='workflow_run')return ordinary;
  if(event?.workflow_run?.path!=='.github/workflows/ci.yml'){
    // A replay-exemption marker is optional evidence, not ordinary publication
    // permission. Existing ordinary gates still authenticate the event/data.
    // Failure here leaves no marker; a later renewal must not infer eligibility.
    try{return ordinaryNonCiMarker({root,event,execution,api});}catch{return ordinary;}
  }
  const eligibility=renewalCiEligibility({root,phase:'publish'});
  if(eligibility.status!=='eligible')return ordinary;
  return {renewal:true,ordinary_non_ci:false};
}
function ordinaryNonCiMarker({root,event,execution,api}){
  const ordinary={renewal:false,ordinary_non_ci:false};
  if(renewalCiEligibility({root,phase:'publish'}).status!=='eligible')return ordinary;
  // Only exact same-head, same-repository non-CI executions receive a durable
  // positive routing marker. Stale ordinary events retain their existing path
  // without a marker; a later renewal never infers permission from its absence.
  const head=git(root,'rev-parse','HEAD'),source=event?.workflow_run;
  if(source?.head_sha!==head)return ordinary;
  git(root,'diff','--exit-code','--quiet','HEAD','--');
  if(execution.repository!==repository||execution.repository_id!==repositoryId||execution.ref!=='refs/heads/main'||execution.sha!==head||execution.workflow_sha!==head
    ||execution.workflow_ref!==`${repository}/${workflow}@refs/heads/main`||!positive(execution.run_id)||execution.run_attempt!==1
    ||event.action!=='completed'||event.repository?.full_name!==repository||event.repository.id!==repositoryId||event.repository.default_branch!=='main')throw Error('Invalid exact ordinary renewal routing context');
  const repo=api(`repos/${repository}`);
  if(repo.full_name!==repository||repo.id!==repositoryId||repo.default_branch!=='main')throw Error('Ordinary renewal routing repository changed');
  const own=api(`repos/${repository}/actions/runs/${execution.run_id}/attempts/1`);
  if(own.id!==execution.run_id||own.run_attempt!==1||own.head_sha!==head||own.head_branch!=='main'||own.path!==workflow||own.event!=='workflow_run'
    ||!sameRepo(own)||own.status!=='in_progress'||own.conclusion!==null||!positive(own.workflow_id))throw Error('Ordinary routing caller is not its exact original attempt');
  if(!positive(source.id)||!positive(source.run_attempt)||!positive(source.workflow_id)||!sameRepo(source)||source.head_branch!=='main'||source.status!=='completed'||!terminal.has(source.conclusion)
    ||!((source.path==='.github/workflows/design-acceptance.yml'&&source.event==='push')||(source.path==='.github/workflows/static-site.yml'&&['schedule','workflow_dispatch'].includes(source.event)))
    ||!(time(source.created_at)<=time(source.run_started_at)&&time(source.run_started_at)<=time(source.updated_at)&&time(source.updated_at)<=time(own.created_at)&&time(own.created_at)<=time(own.run_started_at)))throw Error('Invalid completed ordinary non-CI source');
  const attempt=api(`repos/${repository}/actions/runs/${source.id}/attempts/${source.run_attempt}`),latest=api(`repos/${repository}/actions/runs/${source.id}`);
  if(digest(identity(attempt))!==digest(identity(source))||digest(identity(latest))!==digest(identity(source)))throw Error('Ordinary non-CI source event/attempt changed');
  return {...ordinary,ordinary_non_ci:true,source_run_id:source.id,source_run_attempt:source.run_attempt};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const commandBody=()=>{
  const [command,...extra]=process.argv.slice(2);if(extra.length||!['route','admit'].includes(command))throw Error('Unknown closed renewal CI routing command');
  const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  if(command==='admit'&&process.env.GITHUB_EVENT_NAME==='workflow_run'&&event.workflow_run?.path==='.github/workflows/ci.yml'
    &&renewalCiLocalContext({phase:'publish',event}).eligible.status==='eligible')enforceRenewalQuota('publish','admit');
  const result=command==='route'?routeRenewalCiPublication({event}):verifyRenewalCiAdmission({phase:'publish',event});
  if(command==='admit'&&result?.phase!=='publish')throw Error('No exact publication CI admission');
  if(process.env.GITHUB_OUTPUT&&command==='route')appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(result).map(([key,value])=>`${key}=${value}\n`).join(''));
  console.log(JSON.stringify(command==='route'?result:{admitted:true,producer_event:result.producer_event,head_sha:result.executing.head_sha,trigger:result.trigger,publication_authority:'existing reviewed controls remain mandatory'}));
  };
  if(process.env.GITHUB_EVENT_NAME==='workflow_run')withInvocationImmutableGitApi(bootstrap.repository,commandBody);else commandBody();
}
