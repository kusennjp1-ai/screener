import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOSITORY, REPOSITORY_ID, LIMITS, ensure, safeCode, createTransport,
  collectProcess, safeEnvironment, runCrossover, serializeSafe } from './release40-quota-crossover.mjs';
const here = dirname(fileURLToPath(import.meta.url));
export const hash = value => createHash('sha256').update(value).digest('hex');
export function withoutGitHubCredentials(base) {
  const env={...base};
  for(const name of ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN']) delete env[name];
  return env;
}
const git = (root,...args) => execFileSync('/usr/bin/git',['-C',root,...args],{
  encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:1024*1024,env:withoutGitHubCredentials(process.env) }).trim();
export function verifyCandidate(root,config) {
  ensure(root === realpathSync(root) && git(root,'rev-parse','HEAD') === config.candidate_sha
    && git(root,'rev-parse','HEAD^{tree}') === config.candidate_tree, 'candidate-mismatch');
  ensure(config.candidate_files.length === 40 && new Set(config.candidate_files.map(f=>f.path)).size===40, 'candidate-mismatch');
  for (const file of config.candidate_files) {
    ensure(/^\.(?:github)\/[a-zA-Z0-9/_.-]+$|^frontend\/[a-zA-Z0-9/_.-]+$/.test(file.path)
      && !file.path.split('/').includes('..') && /^[a-f0-9]{64}$/.test(file.sha256), 'candidate-mismatch');
    const path=join(root,file.path);
    ensure(realpathSync(path)===path && hash(readFileSync(path))===file.sha256, 'candidate-mismatch');
  }
  ensure(git(root,'status','--porcelain','--untracked-files=all')==='', 'candidate-mismatch');
  const request=JSON.parse(readFileSync(join(root,'.github/retained-price-oct6-source.json')));
  ensure(request.enabled===false && request.activation===null, 'candidate-mismatch');
  return true;
}
export function verifyOverlay(root,config,sha) {
  ensure(/^[a-f0-9]{40}$/.test(sha) && git(root,'rev-parse','HEAD')===sha
    && git(root,'rev-parse','HEAD^')===config.candidate_sha, 'overlay-scope-mismatch');
  const changed=git(root,'diff-tree','--no-commit-id','--name-status','-r','HEAD').split('\n').sort();
  ensure(JSON.stringify(changed)===JSON.stringify(config.diagnostic_files.map(p=>'A\t'+p).sort())
    && git(root,'status','--porcelain','--untracked-files=all')==='', 'overlay-scope-mismatch');
  const files=config.diagnostic_files.map(path=>({path,sha256:hash(readFileSync(join(root,path)))}));
  const proof={candidate_sha:config.candidate_sha,candidate_tree:config.candidate_tree,diagnostic_sha:sha,
    candidate_files_verified:config.candidate_files.length,overlay_changes:{added:files.length,modified:0,deleted:0},files};
  return {...proof,scope_sha256:hash(JSON.stringify(proof))};
}
export function verifyContext(env,config) {
  ensure(env.GITHUB_ACTIONS==='true' && env.GITHUB_REPOSITORY===REPOSITORY && env.GITHUB_REPOSITORY_ID===String(REPOSITORY_ID)
    && env.GITHUB_EVENT_NAME==='push' && env.GITHUB_REF==='refs/heads/'+config.branch
    && env.GITHUB_WORKFLOW_SHA===env.GITHUB_SHA && env.GITHUB_JOB==='measure'
    && /^[1-9]\d{0,14}$/.test(env.GITHUB_RUN_ID??'') && /^[1-9]\d{0,4}$/.test(env.GITHUB_RUN_ATTEMPT??'')
    && Number(env.GITHUB_RUN_ATTEMPT)===1, 'invalid-context');
  ensure(!env.NODE_OPTIONS && !env.NODE_DEBUG && !env.NODE_DEBUG_NATIVE && !env.GH_DEBUG && !env.SSLKEYLOGFILE && env.NODE_TLS_REJECT_UNAUTHORIZED!=='0', 'invalid-runtime');
  return true;
}
export async function main() {
  let directory=null,outputRoot=null,token=null;
  let report={schema:'release40-quota-crossover-result-v1',measurement_complete:false,measurement_succeeded:false,
    budgetAccepted:false,quota_credit_granted:false,whole_release_certified:false,publication_authority:false,
    owned_invocations:0,internal_gh_wire_requests:null,wire_request_bound_proven:false,samples:[],outcome:'inconclusive',stop_reason:null};
  try {
    const config=JSON.parse(readFileSync(join(here,'release40-quota-crossover-config.json')));
    verifyContext(process.env,config);
    const temp=realpathSync(process.env.RUNNER_TEMP);
    ensure(resolve(process.env.RELEASE40_REPORT_ROOT??'')===join(temp,'release40-quota-crossover-report'),'output-directory-invalid');
    const newOutputRoot=join(temp,'release40-quota-crossover-report'); mkdirSync(newOutputRoot,{mode:0o700}); outputRoot=newOutputRoot;
    const candidate=resolve(process.env.RELEASE40_CANDIDATE_ROOT??''); verifyCandidate(candidate,config);
    const scope=verifyOverlay(resolve(here,'../..'),config,process.env.GITHUB_SHA);
    report.scope_proof=scope;
    report.runtime={node:process.version,gh_version:null,gh_path:config.approved_gh_path,environment:safeEnvironment(process.env),run_id:Number(process.env.GITHUB_RUN_ID),run_attempt:1};
    ensure(process.version===config.expected_node_version && config.approved_gh_path==='/usr/bin/gh'
      && realpathSync(config.approved_gh_path)===config.approved_gh_path, 'invalid-runtime');
    directory=mkdtempSync(join(temp,'release40-empty-gh-')); chmodSync(directory,0o700);
    const versionEnv=withoutGitHubCredentials({...process.env,GH_CONFIG_DIR:directory,GH_DEBUG:'',GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1'});
    const versionResult=await collectProcess(config.approved_gh_path,['--version'],{env:versionEnv,timeoutMs:5000,maxOutput:4096});
    const versionMatch=/^gh version (\d+\.\d+\.\d+)(?: [^\r\n]*)?(?:\r?\n|$)/.exec(versionResult.output.toString('utf8'));
    versionResult.output.fill(0);
    report.runtime.gh_version=versionMatch?.[1]??null;
    ensure(versionResult.exit_ok && versionMatch?.[1]===config.expected_gh_version, 'invalid-runtime');
    // Capture once, only after context/source/runtime checks. It is never passed via argv or persisted.
    token=process.env.GH_TOKEN; ensure(typeof token==='string'&&token.length>0,'missing-credential');
    const request=createTransport({token,env:process.env,configDirectory:directory,ghPath:config.approved_gh_path});
    report=await runCrossover({token,env:process.env,request});
    report.scope_proof=scope;
    report.runtime={node:process.version,gh_version:versionMatch[1],gh_path:config.approved_gh_path,
      environment:safeEnvironment(process.env),run_id:Number(process.env.GITHUB_RUN_ID),run_attempt:1};
    verifyCandidate(candidate,config); verifyOverlay(resolve(here,'../..'),config,process.env.GITHUB_SHA);
  } catch(error) { report.measurement_succeeded=false; report.stop_reason=safeCode(error); }
  finally {
    if(directory) try { rmSync(directory,{recursive:true,force:true}); report.ephemeral_config_removed=true; }
      catch { report.ephemeral_config_removed=false; report.measurement_succeeded=false; report.stop_reason='cleanup-failed'; }
    if(outputRoot) {
      try { writeFileSync(join(outputRoot,'summary.json'),serializeSafe(report,token),{mode:0o600,flag:'wx'}); }
      catch { report={schema:'release40-quota-crossover-result-v1',measurement_complete:false,measurement_succeeded:false,
        budgetAccepted:false,quota_credit_granted:false,stop_reason:'unsafe-output'};
        try { writeFileSync(join(outputRoot,'summary.json'),JSON.stringify(report)+'\n',{mode:0o600,flag:'wx'}); } catch {} }
    }
    process.stdout.write(JSON.stringify({measurement_succeeded:report.measurement_succeeded,budgetAccepted:false,stop_reason:report.stop_reason})+'\n');
  }
  return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().then(report=>{process.exitCode=report.measurement_succeeded?0:1;},()=>{
    process.stdout.write('{"measurement_succeeded":false,"budgetAccepted":false,"stop_reason":"setup-failed"}\n');process.exitCode=1;});
}
