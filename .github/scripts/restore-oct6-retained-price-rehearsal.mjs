// Isolated diagnostic acquisition only. These original archives never gain source authority.
import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, statfsSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {githubApi} from './publication-gate.mjs';
import {deploymentAnchor} from './publication-state.mjs';
import {verifyPinnedZip} from './restore-postcapture-pages-rehearsal.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const contractPath = fileURLToPath(new URL('./fixtures/retained-price-recovery-oct6-inputs.json', import.meta.url));
const fail = (ok, why) => { if (!ok) throw Error(why); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const sha = value => /^[a-f0-9]{40}$/.test(value ?? '');
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const pins = Object.freeze({
  repository:'kusennjp1-ai/screener',repository_id:1203919607,repository_owner_id:265297436,
  reviewed_main:'22548890d0fe161edf7be3943b1775c4f293d0d9',reviewed_main_tree:'8245b42cdff76c1fe51c652227a0eb8d6809cf63',
  control_base:'1126e7b97782dffabccac7fd48fc55e8215fc923',control_tree:'cc7e51dff72294192d3d12c65d04a4669bebc5c0',
  control_parent:'e0218b2b7479719549809e0f9bf14bd9bc844fa8',
  branch:'preview/oct6-retained-price-rehearsal',workflow:'.github/workflows/oct6-retained-price-rehearsal.yml',job:'oct6-retained-price-rehearsal',
  approved_ui:{sha:'1e1943e1d5f78a738a05baa69eb9f2e8508e32ac',tree:'1c0219a170dcbdeb1af539e4cf7a04018251ca02',frontend_tree:'0ba620a84264e1ff026898beed3fbc8ad5894618'},
  candidate_tree:'2186101e92e1f71771936831cea0a40e410975f7',prior_tree:'00a8eaa6b14b977f31f24ac9f708872c2dbe5ee9',
});
const prefix = `repos/${pins.repository}/`;
const mainRefEndpoint = `${prefix}git/ref/heads/main`;
const historicalMain = () => ({sha:pins.reviewed_main,tree:pins.reviewed_main_tree});
export const repositoryActivityFields = Object.freeze(['pushed_at','updated_at','size','open_issues_count','open_issues']);
function verifyRepository(repo) {
  fail(repo?.id===pins.repository_id && repo.full_name===pins.repository && repo.name==='screener' && repo.default_branch==='main'
    && repo.private===false && repo.visibility==='public' && repo.owner?.login==='kusennjp1-ai' && repo.owner.id===pins.repository_owner_id, 'Repository identity changed');
  for(const key of ['pushed_at','updated_at'])if(Object.hasOwn(repo,key))time(repo[key],'Invalid observed repository '+key);
  for(const key of ['size','open_issues_count','open_issues'])if(Object.hasOwn(repo,key))fail(Number.isSafeInteger(repo[key])&&repo[key]>=0,'Invalid observed repository '+key);
  return Object.fromEntries(Object.entries(repo).filter(([key])=>!repositoryActivityFields.includes(key)));
}
function mainObservation(response,observedAt) {
  fail(response?.ref==='refs/heads/main' && response.object?.type==='commit' && sha(response.object.sha),'Invalid current main observation');
  return {role:'diagnostic_observation_only',observed_at:observedAt,sha:response.object.sha,response_sha256:digest(JSON.stringify(response))};
}
function verifyMainEvidence(evidence) {
  fail(JSON.stringify(evidence.reviewed_historical_main)===JSON.stringify(historicalMain()),'Reviewed historical main binding changed');
  const response=evidence.responses?.[`GET ${mainRefEndpoint}`];
  fail(JSON.stringify(evidence.current_main_observation)===JSON.stringify(mainObservation(response,evidence.observed_at)), 'Current main observation binding changed');
  fail(evidence.response_sha256?.[`GET ${mainRefEndpoint}`]===digest(JSON.stringify(response)),'Current main response digest changed');
}
export const archiveMembers = Object.freeze({candidate:'artifact.tar',companion:'source.json',prior:'artifact.tar'});
export function pinnedInputs() {
  const bytes = readFileSync(contractPath);
  fail(digest(bytes) === '46d422e9f5e27dcd1e50fb068619c0aafbff04f646060324c29570d219955e89','Unreviewed October 6 input contract');
  const c = JSON.parse(bytes), candidate = c.candidate;
  return {
    candidate:{...candidate,tree_sha:pins.candidate_tree,workflow:'.github/workflows/static-site.yml',artifact_sha256:candidate.sha256,zip_bytes:candidate.bytes},
    companion:{...candidate,tree_sha:pins.candidate_tree,workflow:'.github/workflows/static-site.yml',artifact_id:candidate.companion_artifact_id,
      artifact_name:`static-site-data-manifest-${candidate.run_id}-${candidate.run_attempt}`,artifact_sha256:candidate.companion_sha256,zip_bytes:candidate.companion_bytes},
    prior:{...c.prior,tree_sha:pins.prior_tree,workflow:'.github/workflows/research-ui-release.yml',artifact_name:`github-pages-${c.prior.run_id}-${c.prior.run_attempt}`,
      artifact_sha256:c.prior.sha256,zip_bytes:c.prior.bytes},
  };
}
export function verifiedProducerRuntime(tree,checkoutRoot=root) {
  const runtimePath=join(checkoutRoot,'.github/scripts/fixtures/retained-price-producer-runtime-oct6.json');
  const fixtureBytes=readFileSync(runtimePath);
  fail(digest(fixtureBytes)==='ee0d0ac8caab92b3932ea7505b8f340640be3156c7a2d7cc64497c4a808c4195','Reviewed original producer runtime fixture changed');
  const runtime=JSON.parse(fixtureBytes),candidate=pinnedInputs().candidate;
  fail(runtime.source_sha===candidate.head_sha && runtime.workflow_path===candidate.workflow && runtime.python_version==='3.11'
    && runtime.publication_authority===false,'Original producer runtime identity changed');
  const checked=(path,expectedSha256,expectedBytes)=>{
    const full=join(checkoutRoot,path),info=lstatSync(full),bytes=readFileSync(full);
    fail(info.isFile() && !info.isSymbolicLink() && digest(bytes)===expectedSha256 && (!expectedBytes || bytes.length===expectedBytes),`Reviewed producer bytes changed: ${path}`);
    return {path,bytes:bytes.length,sha256:expectedSha256,git_blob_sha:createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')};
  };
  const workflow=checked(runtime.workflow_path,runtime.workflow_sha256,runtime.workflow_bytes);
  fail(workflow.git_blob_sha===runtime.workflow_git_blob_sha,'Reviewed producer workflow Git blob changed');
  const builder=checked('backend/app/services/static_site_export_service.py','d8316b2ccb45b703becaa850a674ea58aa459a687b2f57214063a502775afa6a');
  fail(tree.sha===candidate.tree_sha,'Original producer tree changed');const files=treeFiles(tree);
  for (const item of [workflow,builder]) {
    const original=files.get(item.path);
    fail(original?.type==='blob' && original.mode==='100644' && original.sha===item.git_blob_sha,`Original candidate producer blob changed: ${item.path}`);
  }
  return {source_sha:candidate.head_sha,tree_sha:tree.sha,python_version:runtime.python_version,workflow,ranking_builder:builder};
}
const git = args => execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16*1024**2}).trim();
export function verifyWorkflowPermissions(text) {
  // One top-level declaration; job-level overrides, write-all, aliases and merge keys are rejected.
  const meaningful=text.split(/\r?\n/).filter(line=>!/^\s*#/.test(line)).join('\n');
  fail((meaningful.match(/permissions/g)||[]).length===1 && !/^[ \t]*["'].*["'][ \t]*:/m.test(meaningful),'Ambiguous or quoted rehearsal permission keys');
  const declarations = [...text.matchAll(/^([ \t]*)permissions[ \t]*:[ \t]*(.*)$/gm)];
  fail(declarations.length === 1 && declarations[0][1] === '' && declarations[0][2] === '', 'Rehearsal must declare one top-level read-only permission block');
  const tail = text.slice(declarations[0].index + declarations[0][0].length).replace(/^\r?\n/,'');
  const lines = tail.split(/\r?\n/), permissions = [];
  for (const line of lines) {
    if (/^\S/.test(line)) break;
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = /^  (actions|contents): read\s*$/.exec(line);
    fail(match,'Unexpected rehearsal token permission');permissions.push(match[1]);
  }
  fail(permissions.sort().join(',') === 'actions,contents' && !/^\s*<<:|[&*][A-Za-z_]/m.test(text),'Rehearsal requires exactly contents/actions read');
}
export function checkoutIdentity() {
  const workflow = readFileSync(join(root,pins.workflow),'utf8');verifyWorkflowPermissions(workflow);
  return {head:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}']),clean:git(['status','--porcelain','--untracked-files=all']) === '',
    workflow_blob:git(['hash-object',pins.workflow])};
}
const sameRepository = run => ['repository','head_repository'].every(key => run?.[key]?.full_name === pins.repository && run[key].id === pins.repository_id);
const time = (value,why) => {const result=Date.parse(value);fail(typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(result),why);return result;};
// Only these reviewed restoration/materialization bytes may replace existing control files.
export const reviewedHelperChanges = Object.freeze({
  ".github/scripts/restore-retained-price-candidate.py": {
    "before": "79461df701e4ea022b31df4e2c3ae2f1024fe54a",
    "after": "eda74fa40fe74d9c2b63714d58f9cf879ae76351"
  },
  ".github/scripts/restore-retained-price-candidate.test.py": {
    "before": "624ac634274f1a6690dd1915d29fddcf1f4b827d",
    "after": "02653ccf349868ff4141295d9a0fbaee377bf870"
  },
  ".github/scripts/materialize-retained-price-graph.mjs": {
    "before": "2243f96a688bdc9a3c1a14f3b5bb7a6d3827069a",
    "after": "9615e0be119e582d3084db8e94160b98cb842a0f"
  },
  ".github/scripts/materialize-retained-price-graph.test.mjs": {
    "before": "8f68b393042f62ae64c924b4de35ad98c5553e3e",
    "after": "9099af79e6cd5406eb5b3b450716c46b3fecff6e"
  }
});
export const reviewedNewFixtures = Object.freeze({
  ".github/scripts/fixtures/retained-price-recovery-oct6-unindexed-history.json": "b50fa9a93f18d209795837386928869191218345"
});
export const allowedAdditions = Object.freeze([
  pins.workflow,
  ...Object.keys(reviewedNewFixtures),
  '.github/scripts/restore-oct6-retained-price-rehearsal.mjs',
  '.github/scripts/restore-oct6-retained-price-rehearsal.test.mjs',
  '.github/scripts/run-oct6-retained-price-rehearsal.py',
  '.github/scripts/test_run_oct6_retained_price_rehearsal.py',
  '.github/scripts/oct6-retained-price-rehearsal.mjs',
  '.github/scripts/oct6-retained-price-rehearsal.test.mjs',
  'docs/retained-price-oct6-artifact-rehearsal.md',
  ...['contract.json','prior-metadata.json','candidate-metadata.json','prior-histories.json','prior-home.json',
    'prior-catalogs.json','candidate-histories.json','full-row-source-receipt.json'].map(path=>`.github/scripts/fixtures/oct6-retained-price-rehearsal/${path}`),
]);
function treeFiles(tree) {
  fail(tree && sha(tree.sha) && tree.truncated === false && Array.isArray(tree.tree) && tree.tree.length > 0 && tree.tree.length <= 30000,'Incomplete committed Git tree');
  const paths = new Set();
  for (const entry of tree.tree) {
    fail(typeof entry.path === 'string' && !entry.path.startsWith('/') && !entry.path.includes('\\') && !entry.path.split('/').some(p=>!p || p==='.' || p==='..')
      && !paths.has(entry.path) && sha(entry.sha) && ['tree','blob','commit'].includes(entry.type),'Invalid committed Git tree entry');paths.add(entry.path);
  }
  return new Map(tree.tree.filter(entry=>entry.type!=='tree').map(entry=>[entry.path,{sha:entry.sha,mode:entry.mode,type:entry.type}]));
}
export function verifyControlTree(base,caller,workflowBlob) {
  const before=treeFiles(base),after=treeFiles(caller);
  for (const [path,pin] of Object.entries(reviewedHelperChanges)) {
    fail(JSON.stringify(before.get(path))===JSON.stringify({sha:pin.before,mode:'100644',type:'blob'}),`Reviewed helper base changed: ${path}`);
    fail(JSON.stringify(after.get(path))===JSON.stringify({sha:pin.after,mode:'100644',type:'blob'}),`Reviewed helper replacement changed: ${path}`);
  }
  for (const [path,expected] of Object.entries(reviewedNewFixtures))fail(JSON.stringify(after.get(path))===JSON.stringify({sha:expected,mode:'100644',type:'blob'}),`Reviewed fixture changed: ${path}`);
  for (const [path,entry] of before) if (!Object.hasOwn(reviewedHelperChanges,path)) fail(JSON.stringify(after.get(path)) === JSON.stringify(entry),`Existing control-tree file changed: ${path}`);
  for (const [path,entry] of after) if (!before.has(path)) fail(allowedAdditions.includes(path) && entry.type==='blob' && entry.mode==='100644',`Unreviewed rehearsal addition: ${path}`);
  fail(after.get(pins.workflow)?.sha === workflowBlob,'Caller workflow differs from the committed control tree');
}
function inventory(get,endpoint,key) {
  const pages=get(endpoint,true);
  fail(Array.isArray(pages) && pages.length>0 && pages.length<=100 && pages.every(page=>Array.isArray(page[key]) && Number.isSafeInteger(page.total_count) && page.total_count===pages[0].total_count),'Incomplete paginated '+key+' inventory');
  const entries=pages.flatMap(page=>page[key]);
  fail(entries.length===pages[0].total_count && entries.every(entry=>positive(entry.id)) && new Set(entries.map(entry=>entry.id)).size===entries.length,'Incomplete or duplicate '+key+' inventory');
  return entries;
}
function successfulStep(job,name) {
  const matches=job.steps?.filter(step=>step.name===name);
  fail(matches?.length===1 && matches[0].status==='completed' && matches[0].conclusion==='success',`Missing genuine successful ${name} step`);
  const step=matches[0];
  fail(positive(step.number) && time(step.started_at,'Invalid step start')>=time(job.started_at,'Invalid job start')
    && time(step.completed_at,'Invalid step completion')>=time(step.started_at,'Invalid step start')
    && time(step.completed_at,'Invalid step completion')<=time(job.completed_at,'Invalid job completion'),'Source step clock changed');
  return step;
}
export function verifyRehearsalInputs(context,api=githubApi,checkout=checkoutIdentity,now=Date.now) {
  const inputs=pinnedInputs(),responses={},selected={},clock=now();let producerRuntime;fail(Number.isFinite(clock),'Invalid verification clock');
  const diagnostic=JSON.parse(readFileSync(join(root,'.github/scripts/fixtures/oct6-retained-price-rehearsal/contract.json')));
  fail(diagnostic.repair_base===pins.control_base && diagnostic.repair_tree===pins.control_tree
    && JSON.stringify(diagnostic.reviewed_historical_main)===JSON.stringify(historicalMain()),'Diagnostic remote control metadata changed');
  const get=(endpoint,paginate=false)=>{
    const key=`${paginate?'GET_PAGES':'GET'} ${endpoint}`;
    if (!Object.hasOwn(responses,key)) responses[key]=api(endpoint,paginate);
    return responses[key];
  };
  fail(context.repository===pins.repository && context.branch===pins.branch && context.event==='push' && positive(context.id) && context.attempt===1 && sha(context.sha),'Invalid isolated rehearsal caller');
  const local=checkout();fail(local.clean===true && local.head===context.sha && sha(local.tree) && sha(local.workflow_blob),'Unclean or different rehearsal checkout');
  const repo=get(`repos/${pins.repository}`);verifyRepository(repo);
  // This closed price-only diagnostic executes the pinned caller/control tree.
  // A later B/C main revision is observed, never used as proof or carry authority.
  const currentMainObservation=mainObservation(get(mainRefEndpoint),new Date(clock).toISOString());
  fail(get(`${prefix}git/ref/heads/${pins.branch}`).object?.sha===context.sha,'Rehearsal branch moved');
  const commit=(head,expectedTree)=>{
    const value=get(`${prefix}git/commits/${head}`);fail(value.sha===head && sha(value.tree?.sha) && (!expectedTree || value.tree.sha===expectedTree) && Array.isArray(value.parents),'Pinned commit/tree changed');
    const tree=get(`${prefix}git/trees/${value.tree.sha}?recursive=1`);fail(tree.sha===value.tree.sha,'Git tree identity changed');treeFiles(tree);
    return {commit:value,tree};
  };
  const callerTree=commit(context.sha,local.tree),base=commit(pins.control_base,pins.control_tree);
  fail(callerTree.commit.parents.length===1 && callerTree.commit.parents[0].sha===pins.control_base,'Rehearsal must be a direct child of the reviewed remote control commit');
  fail(base.commit.parents.length===1 && base.commit.parents[0].sha===pins.control_parent,'Reviewed remote control parent changed');
  verifyControlTree(base.tree,callerTree.tree,local.workflow_blob);
  commit(pins.reviewed_main,pins.reviewed_main_tree);
  const ui=commit(pins.approved_ui.sha,pins.approved_ui.tree);
  fail(ui.tree.tree.some(entry=>entry.path==='frontend' && entry.type==='tree' && entry.sha===pins.approved_ui.frontend_tree),'Approved frontend tree changed');
  const caller=get(`${prefix}actions/runs/${context.id}`),attempt=get(`${prefix}actions/runs/${context.id}/attempts/1`);
  const callerIdentity=run=>run.id===context.id && run.run_attempt===1 && run.head_sha===context.sha && run.head_branch===pins.branch && run.path===pins.workflow && run.event==='push'
    && run.status==='in_progress' && run.conclusion===null && sameRepository(run) && run.head_commit?.id===context.sha && run.head_commit.tree_id===local.tree;
  fail(callerIdentity(caller) && callerIdentity(attempt),'Rehearsal caller identity changed');
  const callerJobs=inventory(get,`${prefix}actions/runs/${context.id}/attempts/1/jobs?per_page=100`,'jobs');
  fail(callerJobs.length===1,'Unexpected caller job inventory');const callerJob=callerJobs[0];
  fail(positive(callerJob.id) && callerJob.name===pins.job && callerJob.run_id===context.id && callerJob.run_attempt===1 && callerJob.head_sha===context.sha
    && callerJob.status==='in_progress' && callerJob.conclusion===null && callerJob.completed_at===null,'Rehearsal job identity changed');
  const jobStarted=time(callerJob.started_at,'Invalid caller job start');
  fail(time(caller.run_started_at,'Invalid caller run start')<=jobStarted && jobStarted<=clock && clock-jobStarted<110*60*1000,'Caller job clock or 110-minute deadline changed');
  for (const role of ['candidate','prior']) {
    const pin=inputs[role],endpoint=`${prefix}actions/runs/${pin.run_id}`;
    const run=get(`${endpoint}/attempts/${pin.run_attempt}`),current=get(endpoint);
    const workflow=get(`${prefix}actions/workflows/${pin.workflow.split('/').at(-1)}`);
    fail(positive(workflow.id) && workflow.path===pin.workflow,'Source workflow identity changed');
    const valid=run=>run.id===pin.run_id && run.run_attempt===pin.run_attempt && run.head_sha===pin.head_sha && run.head_branch==='main' && run.path===pin.workflow
      && run.workflow_id===workflow.id && run.status==='completed' && ['success','failure'].includes(run.conclusion) && sameRepository(run)
      && run.head_commit?.id===pin.head_sha && run.head_commit.tree_id===pin.tree_sha
      && (role==='candidate' ? ['schedule','workflow_dispatch'].includes(run.event) : run.event==='workflow_run' && run.conclusion==='success' && run.run_number===99 && run.workflow_id===364666954);
    fail(valid(run) && valid(current) && run.conclusion===current.conclusion && run.event===current.event,'Exact original source run/attempt changed');
    const jobs=inventory(get,`${endpoint}/attempts/${pin.run_attempt}/jobs?per_page=100`,'jobs');
    fail(jobs.length>0 && jobs.every(job=>job.run_id===pin.run_id && job.run_attempt===pin.run_attempt && job.head_sha===pin.head_sha && job.status==='completed'
      && ['success','failure','cancelled','skipped','neutral','timed_out','action_required','stale'].includes(job.conclusion)),'Source terminal job inventory changed');
    const producers=jobs.filter(job=>job.name===(role==='candidate'?'combine-and-build':'publish'));
    fail(producers.length===1 && producers[0].conclusion==='success' && (role!=='prior' || producers[0].id===112314516098),'Genuine source producer job changed');
    const job=producers[0],started=time(job.started_at,'Invalid source job start'),ended=time(job.completed_at,'Invalid source job completion');
    fail(time(run.run_started_at,'Invalid source run start')<=started && started<=ended && ended<=clock,'Source run/job clock changed');
    if (role==='candidate') {
      successfulStep(job,'Build static frontend');successfulStep(job,'Upload verified data export');successfulStep(job,'Preserve dated export provenance for release selection');
    } else {
      successfulStep(job,'Run actions/upload-pages-artifact@v4');successfulStep(job,'Deploy to GitHub Pages');
    }
    const historicalDeployment=role==='prior'?deploymentAnchor(pin,pins.repository,get):null;
    if (historicalDeployment) fail(historicalDeployment.headSha===pin.head_sha && historicalDeployment.started>=started && historicalDeployment.completed<=ended,'Historical deployment clock changed');
    const artifacts=inventory(get,`${endpoint}/artifacts?per_page=100`,'artifacts');
    for (const archiveRole of role==='candidate'?['candidate','companion']:['prior']) {
      const expected=inputs[archiveRole],matches=artifacts.filter(a=>a.id===expected.artifact_id || a.name===expected.artifact_name);
      fail(matches.length===1,`${archiveRole}: missing or ambiguous original archive`);
      const artifact=matches[0],origin=artifact.workflow_run,created=time(artifact.created_at,'Invalid artifact creation');
      fail(artifact.id===expected.artifact_id && artifact.name===expected.artifact_name && artifact.expired===false && artifact.size_in_bytes===expected.zip_bytes
        && artifact.digest===`sha256:${expected.artifact_sha256}` && origin?.id===pin.run_id && origin.head_sha===pin.head_sha && origin.head_branch==='main'
        && origin.repository_id===pins.repository_id && origin.head_repository_id===pins.repository_id
        && time(artifact.expires_at,'Invalid artifact expiry')>clock && started<=created && created<=ended
        && (!historicalDeployment || created<=historicalDeployment.started),`${archiveRole}: original archive identity, digest or clock changed`);
      selected[archiveRole]={run,current,jobs,artifacts,producer_job:job,artifact,...(historicalDeployment?{historical_deployment:historicalDeployment}: {})};
    }
    const original=commit(pin.head_sha,pin.tree_sha);
    if(role==='candidate') producerRuntime=verifiedProducerRuntime(original.tree);
  }
  return {schema_version:'oct6-retained-price-rehearsal-api-v1',publication_authority:false,provider_work:false,observed_at:new Date(clock).toISOString(),
    caller:{run:caller,attempt,job:callerJob,commit:callerTree.commit,job_started_at:callerJob.started_at},reviewed_historical_main:historicalMain(),current_main_observation:currentMainObservation,
    approved_ui:pins.approved_ui,producer_runtime:producerRuntime,selected,responses,
    response_sha256:Object.fromEntries(Object.entries(responses).map(([key,value])=>[key,digest(JSON.stringify(value))]))};
}
export function verifyStableEvidence(before,after) {
  verifyMainEvidence(before);verifyMainEvidence(after);
  fail(before.schema_version===after.schema_version && JSON.stringify(before.producer_runtime)===JSON.stringify(after.producer_runtime) && JSON.stringify(before.selected)===JSON.stringify(after.selected),'Original source evidence changed during rehearsal');
  fail(before.caller.commit.sha===after.caller.commit.sha && before.caller.commit.tree.sha===after.caller.commit.tree.sha
    && before.caller.job.id===after.caller.job.id && before.caller.job_started_at===after.caller.job_started_at,'Caller identity changed during rehearsal');
  for (const [key,value] of Object.entries(before.responses)) {
    if (key.includes(`/actions/runs/${before.caller.run.id}`)) continue;
    if (key===`GET ${mainRefEndpoint}`) continue; // Only this observational ref may advance.
    if (key===`GET repos/${pins.repository}`) {
      fail(JSON.stringify(verifyRepository(value))===JSON.stringify(verifyRepository(after.responses[key])), 'Stable repository identity or settings changed');
      continue; // Only documented push/size/issue activity fields were excluded.
    }
    fail(JSON.stringify(value)===JSON.stringify(after.responses[key]),`Authenticated API evidence changed: ${key}`);
  }
}
export function ensureApprovedUi(evidence,execute=execFileSync) {
  fail(evidence?.responses?.[`GET ${prefix}git/commits/${pins.approved_ui.sha}`]?.tree?.sha===pins.approved_ui.tree,'Approved UI requires authenticated original Git metadata');
  const run=args=>execute('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:16*1024**2}).trim();
  fail([`https://github.com/${pins.repository}`,`https://github.com/${pins.repository}.git`].includes(run(['remote','get-url','origin'])),'Unreviewed Git acquisition remote');
  try {run(['cat-file','-e',`${pins.approved_ui.sha}^{tree}`]);} catch {run(['fetch','--no-tags','origin',pins.approved_ui.sha]);}
  fail(run(['cat-file','-p',pins.approved_ui.sha]).split('\n')[0]===`tree ${pins.approved_ui.tree}`
    && run(['rev-parse',`${pins.approved_ui.sha}:frontend`])===pins.approved_ui.frontend_tree
    && run(['ls-tree','-r',pins.approved_ui.sha]).length>0,'Approved UI Git object/tree changed');
  return pins.approved_ui;
}
export async function downloadPinnedArchive(role,path,spawnProcess=spawn) {
  const pin=pinnedInputs()[role];fail(pin && !existsSync(path),'Invalid original archive destination');
  const child=spawnProcess('gh',['api',`${prefix}actions/artifacts/${pin.artifact_id}/zip`],{stdio:['ignore','pipe','pipe'],timeout:240000});
  let count=0;child.stderr.resume();
  child.stdout.on('data',chunk=>{count+=chunk.length;if(count>pin.zip_bytes)child.kill('SIGKILL');});
  const completion=new Promise((done,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>code===0?done():reject(Error(`Original ${role} download failed (${code??signal})`)));});
  await Promise.all([pipeline(child.stdout,createWriteStream(path,{flags:'wx',mode:0o600})),completion]);
  fail(count===pin.zip_bytes,'Original archive byte count changed');await verifyPinnedZip(path,pin);
}
export async function restoreRehearsalInputs(directory,context,{api=githubApi,checkout=checkoutIdentity,now=Date.now,download=downloadPinnedArchive,gitObjects=ensureApprovedUi,
  space=path=>{const stat=statfsSync(path);return stat.bavail*stat.bsize;}}={}) {
  const before=verifyRehearsalInputs(context,api,checkout,now),output=resolve(directory);fail(!existsSync(output) && output!==resolve(root) && !output.startsWith(resolve(root)+'/'),'Rehearsal output must be new and outside the control checkout');
  mkdirSync(output,{mode:0o700});
  writeFileSync(join(output,'acquisition-start-api-evidence.json'),JSON.stringify(before,null,2)+'\n',{flag:'wx',mode:0o600});
  fail(space(output)>=Object.values(pinnedInputs()).reduce((n,p)=>n+p.zip_bytes,0)+1024**3,'Insufficient acquisition storage');
  const paths=Object.fromEntries(Object.keys(pinnedInputs()).map(role=>[`${role}_zip`,join(output,`${role}.zip`)]));
  for (const role of Object.keys(pinnedInputs())) await download(role,paths[`${role}_zip`]);
  const approved_ui=gitObjects(before),after=verifyRehearsalInputs(context,api,checkout,now);verifyStableEvidence(before,after);
  const api_evidence=join(output,'api-evidence.json');writeFileSync(api_evidence,JSON.stringify(after,null,2)+'\n',{flag:'wx',mode:0o600});
  const result={schema_version:'oct6-retained-price-rehearsal-inputs-v1',publication_authority:false,provider_work:false,financial_predecessor_bound:false,
    prior_role:'historical_price_evidence_only',archive_members:archiveMembers,...paths,api_evidence,api_evidence_sha256:digest(readFileSync(api_evidence)),caller:after.caller,approved_ui};
  writeFileSync(join(output,'inputs.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
}
export async function recheckRehearsalInputs(directory,context,{api=githubApi,checkout=checkoutIdentity,now=Date.now,verifyZip=verifyPinnedZip}={}) {
  const output=resolve(directory),input=JSON.parse(readFileSync(join(output,'inputs.json'))),evidence=join(output,'api-evidence.json');
  const expectedKeys=['schema_version','publication_authority','provider_work','financial_predecessor_bound','prior_role','archive_members','candidate_zip','companion_zip','prior_zip','api_evidence','api_evidence_sha256','caller','approved_ui'];
  fail(Object.keys(input).sort().join(',')===expectedKeys.sort().join(',') && input.prior_role==='historical_price_evidence_only'
    && JSON.stringify(input.archive_members)===JSON.stringify(archiveMembers) && input.schema_version==='oct6-retained-price-rehearsal-inputs-v1' && input.publication_authority===false && input.provider_work===false && input.financial_predecessor_bound===false
    && input.api_evidence===evidence && digest(readFileSync(evidence))===input.api_evidence_sha256,'Stored input authentication changed');
  const before=JSON.parse(readFileSync(evidence));
  for (const [role,pin] of Object.entries(pinnedInputs())) {
    const path=join(output,`${role}.zip`);fail(input[`${role}_zip`]===path,'Original archive path changed');await verifyZip(path,pin);
  }
  const after=verifyRehearsalInputs(context,api,checkout,now);verifyStableEvidence(before,after);
  fail(JSON.stringify(input.caller)===JSON.stringify(before.caller) && JSON.stringify(input.approved_ui)===JSON.stringify(pins.approved_ui),'Stored caller or approved UI identity changed');
  writeFileSync(join(output,'final-api-evidence.json'),JSON.stringify(after,null,2)+'\n',{flag:'wx',mode:0o600});return after;
}
async function main() {
  const [command,directory,...rest]=process.argv.slice(2);fail(['restore','recheck'].includes(command) && directory && rest.length===0,'Usage: restore-oct6-retained-price-rehearsal.mjs restore|recheck DIRECTORY');
  const context={repository:process.env.GITHUB_REPOSITORY,branch:process.env.GITHUB_REF_NAME,event:process.env.GITHUB_EVENT_NAME,
    id:Number(process.env.GITHUB_RUN_ID),attempt:Number(process.env.GITHUB_RUN_ATTEMPT),sha:process.env.GITHUB_SHA};
  const result=await (command==='restore'?restoreRehearsalInputs:recheckRehearsalInputs)(directory,context);
  console.log(JSON.stringify(command==='restore'?result:{publication_authority:false,observed_at:result.observed_at,caller:result.caller.job.id}));
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) await main();
