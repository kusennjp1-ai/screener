import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {REPOSITORY,REPOSITORY_ID,BRANCH,JOB_NAME,LIMITS,hash,ensure,safeCode,quota,assess,safeElapsed,quotaWindows} from './release40-logic.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:1024*1024}).trim();
export function verifyCandidate(root,config){
  ensure(/^[a-f0-9]{40}$/.test(config.candidate_sha??'')&&/^[a-f0-9]{40}$/.test(config.candidate_tree??''),'candidate-not-pinned');
  ensure(root===realpathSync(root)&&git(root,'rev-parse','HEAD')===config.candidate_sha
    &&git(root,'rev-parse','HEAD^{tree}')===config.candidate_tree,'candidate-checkout-mismatch');
  ensure(Array.isArray(config.approved_files)&&config.approved_files.length>=40
    &&new Set(config.approved_files.map(f=>f.path)).size===config.approved_files.length,'invalid-successor-candidate-manifest');
  for(const file of config.approved_files){
    ensure(typeof file.path==='string'&&!file.path.split('/').some(p=>p==='..'||p==='')&&!file.path.startsWith('/'),'unsafe-candidate-path');
    ensure(hash(readFileSync(join(root,file.path)))===file.sha256,'candidate-file-digest-mismatch');
  }
  ensure(git(root,'status','--porcelain','--untracked-files=no')==='','candidate-checkout-modified');
  return true;
}
export async function main(){
  const candidateRoot=resolve(process.env.RELEASE40_CANDIDATE_ROOT??''),outputRoot=resolve(process.env.RELEASE40_REPORT_ROOT??'');
  const configBytes=readFileSync(join(here,'release40-config.json')),config=JSON.parse(configBytes);
  const phases=[],samples=[];let starts=0;
  let cache=null,context=null,directory=null,finalReport={schema_version:'release40-live-anchor-budget-v2',status:'failed',
    budgetAccepted:false,whole_release_certified:false,publication_authority:false,cutoff:null,
    cutoff_basis:'fresh production-derived anchor prefix; not full livePublication validation',limits:LIMITS};
  try{
    ensure(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY===REPOSITORY
      &&process.env.GITHUB_REPOSITORY_ID===String(REPOSITORY_ID)&&process.env.GITHUB_EVENT_NAME==='push'
      &&process.env.GITHUB_REF==='refs/heads/'+BRANCH&&process.env.GITHUB_WORKFLOW_SHA===process.env.GITHUB_SHA
      &&process.env.GITHUB_JOB==='measure'&&process.env.GH_TOKEN,'unapproved-diagnostic-context');
    ensure(outputRoot===join(realpathSync(process.env.RUNNER_TEMP),'release40-reports'),'unsafe-report-root');
    mkdirSync(outputRoot,{mode:0o700});
    verifyCandidate(candidateRoot,config);
    finalReport.candidate_sha=config.candidate_sha;finalReport.candidate_tree=config.candidate_tree;
    finalReport.diagnostic_sha=process.env.GITHUB_SHA;
    const diagnosticRoot=resolve(here,'../..');
    ensure(git(diagnosticRoot,'rev-parse','HEAD')===process.env.GITHUB_SHA,'diagnostic-checkout-mismatch');
    ensure(git(diagnosticRoot,'rev-parse','HEAD^')===config.candidate_sha,'diagnostic-not-direct-candidate-child');
    const changed=git(diagnosticRoot,'diff-tree','--no-commit-id','--name-only','-r','HEAD').split('\n').sort();
    ensure(JSON.stringify(changed)===JSON.stringify(config.diagnostic_files.slice().sort()),'diagnostic-scope-mismatch');
    const mod=name=>import(pathToFileURL(join(candidateRoot,'.github/scripts',name)).href);
    const [api,cacheModule,worker,policy]=await Promise.all([mod('bounded-github-api.mjs'),mod('conditional-deployment-jobs-cache.mjs'),
      mod('conditional-deployment-jobs-worker.mjs'),mod('retained-price-finite-transport-policy.mjs')]);
    cache=cacheModule;
    const scope={repository:REPOSITORY,repository_id:REPOSITORY_ID,run_id:Number(process.env.GITHUB_RUN_ID),
      run_attempt:Number(process.env.GITHUB_RUN_ATTEMPT),controller_sha:process.env.GITHUB_SHA};
    ensure(Number.isSafeInteger(scope.run_id)&&scope.run_id>0&&Number.isSafeInteger(scope.run_attempt)&&scope.run_attempt>0,'invalid-run-scope');
    const budget={beforeRequest:()=>{ensure(++starts<=6,'diagnostic-cli-start-cap');return starts;},afterRequest:facts=>{
      ensure(facts.status===200&&!facts.retry_after_present,'required-read-denied');
      const q=quota(facts.quota);samples.push({status:200,quota:q,elapsed_ms:safeElapsed(facts.elapsed_ms)});
    }};
    const command=(args,options)=>execFileSync('gh',args,{stdio:['ignore','pipe','pipe'],timeout:options.timeoutMs,maxBuffer:options.maxBuffer});
    const own=()=>api.readBoundedRequiredCaller('repos/'+REPOSITORY+'/actions/runs/'+scope.run_id+'/attempts/'+scope.run_attempt,
      {scope,command,budget,timeoutMs:30000});
    const run=own();
    ensure(run.id===scope.run_id&&run.run_attempt===scope.run_attempt&&run.head_sha===scope.controller_sha
      &&run.head_branch===BRANCH&&run.repository?.id===REPOSITORY_ID&&run.head_repository?.id===REPOSITORY_ID
      &&run.event==='push'&&run.path==='.github/workflows/release40-live-anchor-budget.yml','own-run-identity-mismatch');
    finalReport.initial_actual_quota=samples.at(-1).quota;
    ensure(samples.at(-1).quota.remaining>=LIMITS.minimumInitialRemaining,'insufficient-actual-diagnostic-quota');
    const jobs=api.readBoundedGitHubPages('repos/'+REPOSITORY+'/actions/runs/'+scope.run_id+'/attempts/'+scope.run_attempt+'/jobs?per_page=100',
      {command,budget,timeoutMs:30000,maximumPages:2}).flatMap(page=>page.jobs);
    const matches=jobs.filter(job=>job.name===JOB_NAME&&job.status==='in_progress'&&job.run_id===scope.run_id&&job.run_attempt===scope.run_attempt);
    ensure(matches.length===1,'genuine-diagnostic-job-not-found');const job=matches[0];
    const request=JSON.parse(readFileSync(join(candidateRoot,'.github/retained-price-oct6-source.json')));
    ensure(request.enabled===false&&request.activation===null,'candidate-request-not-disabled');
    context={schema_version:'conditional-deployment-jobs-cache-context-v1',repository:REPOSITORY,repository_id:REPOSITORY_ID,
      run_id:scope.run_id,run_attempt:scope.run_attempt,job_id:job.id,job_name:JOB_NAME,job_started_at:job.started_at,
      role:'diagnostic',controller_sha:config.candidate_sha,controller_tree:config.candidate_tree,
      request_sha256:hash(configBytes),event_sha256:hash(readFileSync(process.env.GITHUB_EVENT_PATH)),
      reader_version:git(candidateRoot,'rev-parse','HEAD:.github/scripts/conditional-deployment-jobs-worker.mjs'),representation:worker.REQUEST_REPRESENTATION};
    const handle=cache.initializeJobCache({context,root:realpathSync(process.env.RUNNER_TEMP)});directory=handle.directory;handle.dispose('complete');
    for(const phase of ['cold','warm']){
      own();
      const historyRemaining=phase==='cold'?480:240,anchorCliRemaining=phase==='cold'?12:6;
      ensure(samples.at(-1).quota.remaining>=LIMITS.reserve+historyRemaining+anchorCliRemaining+1,'insufficient-actual-phase-quota');
      const output=join(outputRoot,phase+'.json');
      try{execFileSync(process.execPath,[join(here,'release40-phase.mjs')],{input:JSON.stringify({candidateRoot,context,directory,phase,output,expected_anchor:phases[0]?.anchor??null}),
        stdio:['pipe','pipe','pipe'],timeout:LIMITS.phaseMs,killSignal:'SIGKILL',maxBuffer:65536});}catch{}
      ensure(existsSync(output),'phase-ended-without-report');
      const result=JSON.parse(readFileSync(output));phases.push(result);
      ensure(result.status==='complete','cold-or-warm-phase-not-complete');
    }
    own();
    finalReport.cutoff=phases[0].cutoff;finalReport.anchor=phases[0].anchor;
    const allCliSamples=[...samples,...phases.flatMap(p=>p.anchor_ledger.cli)];
    Object.assign(finalReport,assess(phases[0],phases[1],samples.at(-1).quota,policy.FINITE_TRANSPORT_POLICIES,Date.now(),allCliSamples));
    finalReport.status='complete';finalReport.actual_cli_reads=allCliSamples;
    finalReport.owned_cli_starts=starts+phases.reduce((n,p)=>n+p.anchor_ledger.starts,0);
    finalReport.public_site_reads=phases.flatMap(p=>p.anchor_ledger.public);
    finalReport.owned_native_requests=phases.reduce((n,p)=>n+p.inventory.pages.length+p.history.observations.length,0);
    finalReport.owned_transport_starts=finalReport.owned_cli_starts+finalReport.owned_native_requests;
    finalReport.gh_internal_wire_requests='not observable; CLI starts are not wire-request counts';
    finalReport.quota_deltas='shared-token quota balances, not exclusively attributable consumption';
  }catch(error){finalReport.reason=safeCode(error);}
  finally{
    if(cache&&context&&directory)try{cache.cleanupJobCache({context,directory});finalReport.private_cache_removed=true;}
      catch{finalReport.private_cache_removed=false;finalReport.status='failed';finalReport.budgetAccepted=false;finalReport.reason='cache-cleanup-failed';}
    const observedCli=[...samples,...phases.flatMap(p=>p.anchor_ledger?.cli??[])];
    finalReport.actual_cli_reads=observedCli;
    finalReport.owned_cli_starts=starts+phases.reduce((n,p)=>n+(p.anchor_ledger?.starts??0),0);
    finalReport.public_site_reads=phases.flatMap(p=>p.anchor_ledger?.public??[]);
    finalReport.observed_quota_windows=quotaWindows(phases,observedCli);
    finalReport.cutoff=phases[0]?.cutoff??null;finalReport.anchor=phases[0]?.anchor??null;
    if(existsSync(outputRoot))writeFileSync(join(outputRoot,'summary.json'),JSON.stringify(finalReport,null,2)+'\n',{mode:0o600});
    process.stdout.write(JSON.stringify({status:finalReport.status,budgetAccepted:finalReport.budgetAccepted,reason:finalReport.reason??null})+'\n');
  }
  return finalReport;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await main();process.exitCode=result.status==='complete'?0:1;}
  catch{process.stdout.write('{"status":"failed","budgetAccepted":false,"reason":"diagnostic-startup-failed"}\n');process.exitCode=1;}
}
