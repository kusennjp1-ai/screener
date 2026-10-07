// Closed diagnostic retrieval. Downloaded archives are data, never executable code.
import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statfsSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {githubApi} from './publication-gate.mjs';
import {deploymentAnchor,latestDeployment} from './publication-state.mjs';
import {canonicalBytes, generationBody, parseCanonical, validateExpectedRoot, validateRoot, validPath} from '../../frontend/src/static/transport/format.mjs';

const checkoutRoot = fileURLToPath(new URL('../../', import.meta.url));
const contractPath = fileURLToPath(new URL('./fixtures/postcapture-pages-rehearsal-inputs.json', import.meta.url));
const fail = (ok, why) => { if (!ok) throw Error(why); };
const positive = n => Number.isSafeInteger(n) && n > 0;
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const contractSha256 = 'f4634be68df4eb858c0a94e8a043571dfce6e051e2c90f8eecdab0f140dbd8cd';
export const pinnedContract = () => {
  const bytes = readFileSync(contractPath);fail(sha256(bytes) === contractSha256,'Unreviewed rehearsal input contract bytes');
  return JSON.parse(bytes);
};
export const pinnedCarryContinuation = () => {
  const bytes = readFileSync(new URL('./fixtures/postcapture-carry-continuation.json',import.meta.url));
  fail(sha256(bytes) === '04fdc14228b554e745d58d71008456ff3d984213c78c5f883957ae1e8ca64607','Unreviewed carry continuation contract bytes');
  return JSON.parse(bytes);
};
const prefix = 'repos/kusennjp1-ai/screener/';
const git = args => execFileSync('git', args, {cwd:checkoutRoot, encoding:'utf8', maxBuffer:16*1024*1024}).trim();
export const checkoutIdentity = () => ({head:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}']),clean:git(['status','--porcelain']) === ''});
const sameRepository = (run, c) => ['repository','head_repository'].every(k => run?.[k]?.full_name === c.repository && run[k].id === c.repository_id);
export function requiredGitDependencies(c=pinnedContract()) {
  const read = path => JSON.parse(readFileSync(join(checkoutRoot,path),'utf8'));
  const request=read('.github/financial-release-request.json'),pin=read('.github/financial-performance-candidate-v2.json');
  const ui=read('contracts/financial_performance_exception_v2.json').capture.captured_ui;
  fail(c.inputs['old-source'].head_sha===request.correction.source.head_sha
    && c.inputs['old-cert'].head_sha===request.source_validation.certificate.head_sha,
  'Historical Git dependencies differ from original source/certificate references');
  const required=Object.fromEntries(Object.values(c.inputs).map(input=>[input.head_sha,input.tree_sha]));
  required[ui.sha]=ui.tree;
  required[pin.head_sha]=c.git_objects[pin.head_sha];
  fail(Object.values(required).every(tree=>/^[a-f0-9]{40}$/.test(tree??''))
    && JSON.stringify(Object.keys(required).sort())===JSON.stringify(Object.keys(c.git_objects).sort())
    && Object.entries(required).every(([head,tree])=>c.git_objects[head]===tree),
  'Historical Git inventory must match executable source, UI and approval dependencies exactly');
  // reviewed_commit in the original trust is a historical review annotation.
  // The unchanged v1 reader authenticates reference.head_sha + reviewed tree
  // and every reviewed blob; it never fetches that annotation as a Git object.
  return required;
}
function complete(value, key) {
  fail(Number.isSafeInteger(value?.total_count) && value.total_count >= 0 && value.total_count <= 100
    && Array.isArray(value[key]) && value[key].length === value.total_count, `Incomplete ${key} inventory`);
  return value[key];
}

// The explicit API dependency is confined to this diagnostic helper. Production
// authority readers retain their original caller, trust and transport behavior.
export function verifyRehearsalInputs(context, api = githubApi, checkout = checkoutIdentity, now = Date.now) {
  const c = pinnedContract(), responses = {}, selected = {};
  const continuation = context.stage === 'carry-continuation' ? pinnedCarryContinuation() : null;
  const callerPolicy = continuation?.caller ?? c.caller;
  const requiredObjects=requiredGitDependencies(c);
  const get = (endpoint, paginate = false) => {
    const key = `${paginate ? 'GET_PAGES' : 'GET'} ${endpoint}`;
    if (Object.hasOwn(responses,key)) return responses[key];
    const value = api(endpoint, paginate);
    if (paginate && /\/(jobs|artifacts)\?/.test(endpoint)) {
      const key = endpoint.includes('/jobs?') ? 'jobs' : 'artifacts';
      fail(Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every(p => Array.isArray(p[key]) && p.total_count===value[0].total_count)
        && Number.isSafeInteger(value[0].total_count) && value.flatMap(p => p[key]).length === value[0].total_count
        && new Set(value.flatMap(p => p[key]).map(v => v.id)).size === value[0].total_count, `Incomplete paginated ${key} inventory`);
    }
    responses[`${paginate ? 'GET_PAGES' : 'GET'} ${endpoint}`] = value;
    return value;
  };
  fail(context.repository === c.repository && context.branch === callerPolicy.branch && context.event === callerPolicy.event
    && positive(context.id) && context.attempt === 1 && /^[a-f0-9]{40}$/.test(context.sha ?? ''), 'Invalid rehearsal caller context');
  const local = checkout();
  fail(local.clean === true && local.head === context.sha && /^[a-f0-9]{40}$/.test(local.tree ?? ''), 'Unclean or different rehearsal checkout');
  const caller = get(`${prefix}actions/runs/${context.id}`);
  fail(caller.id === context.id && caller.head_sha === context.sha && caller.run_attempt === 1 && caller.head_branch === callerPolicy.branch
    && caller.path === callerPolicy.workflow && caller.event === 'push' && caller.status === 'in_progress' && caller.conclusion === null
    && sameRepository(caller,c) && caller.head_commit?.id === context.sha && caller.head_commit.tree_id === local.tree, 'Rehearsal caller identity changed');
  const branch = get(`${prefix}git/ref/heads/${callerPolicy.branch}`);
  fail(branch.object?.sha === context.sha, 'Rehearsal branch moved');
  fail(get(`${prefix}git/ref/heads/main`).object?.sha === c.caller.first_parent, 'Reviewed main changed');
  const callerCommit = get(`${prefix}git/commits/${context.sha}`);
  fail(callerCommit.sha === context.sha && callerCommit.tree?.sha === local.tree && callerCommit.parents?.length === 1
    && callerCommit.parents[0].sha === c.caller.first_parent, 'Rehearsal is not a direct reviewed-main child');
  const callerJobs = complete(get(`${prefix}actions/runs/${context.id}/attempts/1/jobs?per_page=100`),'jobs');
  const stage=context.stage??'seal';fail(Object.hasOwn(callerPolicy.staged_jobs,stage),'Invalid rehearsal stage');
  const callerJob = callerJobs.filter(j => j.name === callerPolicy.staged_jobs[stage]);
  if (continuation) fail(callerJobs.length === 1,'Carry continuation must have exactly one job');
  fail(callerJob.length === 1 && positive(callerJob[0].id) && callerJob[0].run_id === context.id && callerJob[0].run_attempt === 1
    && callerJob[0].head_sha === context.sha && callerJob[0].status === 'in_progress' && callerJob[0].conclusion === null, 'Rehearsal job identity changed');

  const checkedCommits = new Set();
  const inspectCommit = (head, tree) => {
    if (checkedCommits.has(head)) return;
    const value = get(`${prefix}git/commits/${head}`);
    fail(value.sha === head && value.tree?.sha === tree && Array.isArray(value.parents), 'Pinned commit/tree changed');
    const inventory = get(`${prefix}git/trees/${tree}?recursive=1`);
    fail(inventory.sha === tree && inventory.truncated === false && Array.isArray(inventory.tree)
      && inventory.tree.length > 0 && inventory.tree.length <= 30000, 'Incomplete pinned Git tree');
    checkedCommits.add(head);
  };
  const clock = now();
  fail(Number.isFinite(clock), 'Invalid verification clock');
  inspectCommit(context.sha,local.tree);
  inspectCommit(c.caller.first_parent,c.caller.base_tree);
  if (continuation) {
    const pin=continuation.checkpoint, endpoint=`${prefix}actions/runs/${pin.run_id}`;
    const run=get(`${endpoint}/attempts/${pin.run_attempt}`),current=get(endpoint);
    for(const value of [run,current]) fail(value.id===pin.run_id && value.run_attempt===pin.run_attempt
      && value.run_number===pin.run_number && value.workflow_id===pin.workflow_id && value.head_sha===pin.head_sha
      && value.head_branch===pin.branch && value.path===pin.workflow && value.event===pin.event
      && value.status==='completed' && value.conclusion===pin.conclusion && sameRepository(value,c)
      && value.head_commit?.id===pin.head_sha && value.head_commit.tree_id===pin.tree_sha,'Retained checkpoint producer changed or retried');
    const jobs=complete(get(`${endpoint}/attempts/1/jobs?per_page=100`),'jobs');
    fail(jobs.length===pin.jobs.length,'Retained diagnostic job inventory changed');
    for(const expected of pin.jobs) {
      const matches=jobs.filter(j=>j.id===expected.id&&j.name===expected.name);
      fail(matches.length===1 && matches[0].run_id===pin.run_id && matches[0].run_attempt===1
        && matches[0].head_sha===pin.head_sha && matches[0].status==='completed' && matches[0].conclusion===expected.conclusion,
      'Retained diagnostic terminal job changed');
      fail(matches[0].started_at===expected.started_at && matches[0].completed_at===expected.completed_at
        && sha256(JSON.stringify(matches[0].steps?.map(s=>[s.number,s.name,s.status,s.conclusion,s.started_at,s.completed_at])))===expected.steps_sha256,
      'Retained diagnostic terminal step inventory or clocks changed');
    }
    const failedJob=jobs.find(j=>j.id===pin.failure_boundary.job_id),failures=failedJob.steps?.filter(s=>s.conclusion==='failure');
    fail(failures?.length===1 && failures[0].number===pin.failure_boundary.step_number
      && failures[0].name===pin.failure_boundary.step_name,'Retained carry failure boundary changed');
    fail(failedJob.steps?.some(s=>s.name==='Rehearse actual renewal carry without a network route'&&s.conclusion==='skipped'),
      'Retained carry lifecycle was not skipped');
    const matches=jobs.filter(j=>j.id===pin.publish_job_id || j.name===pin.publish_job_name);
    fail(matches.length===1 && matches[0].id===pin.publish_job_id && matches[0].name===pin.publish_job_name
      && matches[0].run_id===pin.run_id && matches[0].run_attempt===1 && matches[0].head_sha===pin.head_sha
      && matches[0].status==='completed' && matches[0].conclusion==='success','Retained publication job changed');
    for(const expected of pin.successful_publish_steps) fail(matches[0].steps?.filter(s=>s.number===expected.number
      && s.name===expected.name && s.status==='completed' && s.conclusion==='success').length===1,'Retained publication step changed');
    const artifacts=complete(get(`${endpoint}/artifacts?per_page=100`),'artifacts');
    const found=artifacts.filter(a=>a.id===pin.artifact_id || a.name===pin.artifact_name);
    fail(found.length===1,'Missing or ambiguous retained publication checkpoint');
    const artifact=found[0],origin=artifact.workflow_run,created=Date.parse(artifact.created_at);
    fail(artifact.id===pin.artifact_id && artifact.name===pin.artifact_name && artifact.expired===false
      && artifact.size_in_bytes===pin.zip_bytes && artifact.digest===`sha256:${pin.artifact_sha256}`
      && origin?.id===pin.run_id && origin.head_sha===pin.head_sha && origin.head_branch===pin.branch
      && origin.repository_id===c.repository_id && origin.head_repository_id===c.repository_id
      && artifact.created_at===pin.created_at && artifact.expires_at===pin.expires_at
      && Date.parse(artifact.expires_at)>clock && Date.parse(run.run_started_at)<=created && created<=clock
      && Date.parse(matches[0].started_at)<=created && created<=Date.parse(matches[0].completed_at),'Retained checkpoint identity or current expiry changed');
    for(const [suffix,key,value] of [['/attempts/1/jobs?per_page=100','jobs',jobs],['/artifacts?per_page=100','artifacts',artifacts]]) {
      const pages=get(endpoint+suffix,true);
      fail(pages.length===1 && JSON.stringify(complete(pages[0],key))===JSON.stringify(value),'Retained checkpoint paginated evidence differs');
    }
    inspectCommit(pin.head_sha,pin.tree_sha);
    selected['retained-publication']={run,jobs,artifacts};
  }
  for (const [role,pin] of Object.entries(c.inputs)) {
    const endpoint = `${prefix}actions/runs/${pin.run_id}`;
    const run = get(`${endpoint}/attempts/${pin.run_attempt}`);
    fail(run.id === pin.run_id && run.run_attempt === pin.run_attempt && run.run_number === pin.run_number
      && run.head_sha === pin.head_sha && run.head_branch === pin.branch && run.path === pin.workflow
      && run.workflow_id === pin.workflow_id && run.event === pin.event && run.status === 'completed'
      && run.conclusion === pin.conclusion && sameRepository(run,c)
      && run.head_commit?.id === pin.head_sha && run.head_commit.tree_id === pin.tree_sha, `${role}: exact terminal run changed`);
    // Reject a later rerun even if the requested historical attempt still exists.
    const current = get(endpoint);
    fail(current.id === pin.run_id && current.run_attempt === pin.run_attempt && current.head_sha === pin.head_sha
      && current.status === 'completed' && current.conclusion === pin.conclusion, `${role}: run was retried or changed`);
    const jobs = complete(get(`${endpoint}/attempts/${pin.run_attempt}/jobs?per_page=100`),'jobs');
    fail(jobs.length === pin.jobs.length, `${role}: unexpected terminal job inventory`);
    for (const expected of pin.jobs) {
      const found = jobs.filter(j => j.id === expected.id && j.name === expected.name);
      fail(found.length === 1 && found[0].run_id === pin.run_id && found[0].run_attempt === pin.run_attempt
        && found[0].head_sha === pin.head_sha && found[0].status === 'completed' && found[0].conclusion === expected.conclusion,
      `${role}: exact terminal job changed`);
    }
    if (role === 'failed-source') {
      const failures = jobs[0].steps?.filter(s => s.conclusion === 'failure');
      fail(failures?.length === 1 && failures[0].number === c.failure_boundary.step_number
        && failures[0].name === c.failure_boundary.step_name, 'Ordinary failed source boundary changed');
    }
    const artifacts = complete(get(`${endpoint}/artifacts?per_page=100`),'artifacts');
    const matches = artifacts.filter(a => a.id === pin.artifact_id || a.name === pin.artifact_name);
    fail(matches.length === 1, `${role}: missing or ambiguous exact artifact`);
    const artifact = matches[0], origin = artifact.workflow_run;
    fail(artifact.id === pin.artifact_id && artifact.name === pin.artifact_name && artifact.expired === false
      && artifact.size_in_bytes === pin.zip_bytes && artifact.digest === `sha256:${pin.artifact_sha256}`
      && origin?.id === pin.run_id && origin.head_sha === pin.head_sha && origin.head_branch === pin.branch
      && origin.repository_id === c.repository_id && origin.head_repository_id === c.repository_id
      && Number.isFinite(Date.parse(artifact.expires_at)) && Date.parse(artifact.expires_at) > clock, `${role}: exact artifact identity or expiry changed`);
    const start = Date.parse(run.run_started_at), created = Date.parse(artifact.created_at);
    fail(Number.isFinite(start) && Number.isFinite(created) && start <= created && created <= clock
      && jobs.some(j => Date.parse(j.started_at) <= created && Date.parse(j.completed_at) >= created), `${role}: artifact/job clocks changed`);
    inspectCommit(pin.head_sha,pin.tree_sha);
    selected[role] = {run,jobs,artifacts};
  }
  for (const [head,tree] of Object.entries(requiredObjects)) inspectCommit(head,tree);
  for (const role of ['failed-source','companion']) {
    const pin = c.inputs[role];
    fail(get(`${prefix}git/ref/heads/${pin.branch}`).object?.sha === pin.head_sha, `${role}: closed branch changed`);
  }
  const repo = get(`repos/${c.repository}`);
  fail(repo.full_name === c.repository && repo.id === c.repository_id && repo.default_branch === 'main', 'Repository identity changed');
  // Every page is recorded verbatim; never infer an empty next page.
  for (const file of ['research-ui-release.yml','static-site.yml']) {
    const endpoint = `${prefix}actions/workflows/${file}/runs?branch=main&per_page=100`;
    const pages = get(endpoint,true);
    fail(Array.isArray(pages) && pages.length > 0 && pages.length <= 100 && pages.every(p => Array.isArray(p.workflow_runs) && p.total_count===pages[0].total_count), 'Incomplete publication history');
    const runs = pages.flatMap(p => p.workflow_runs), total = pages[0].total_count;
    fail(Number.isSafeInteger(total) && runs.length === total && new Set(runs.map(r => r.id)).size === total, 'Truncated publication history');
    // Successful exports do not imply a deployment. The unchanged deployment reader checks the actual successful deploy step below.
    responses[`GET ${endpoint}`] = pages[0];
  }
  for (const [role,pin] of Object.entries(c.inputs)) {
    const endpoint = `${prefix}actions/runs/${pin.run_id}`;
    for (const [suffix,key] of [[`/attempts/${pin.run_attempt}/jobs?per_page=100`,'jobs'],['/artifacts?per_page=100','artifacts']]) {
      const pages = get(endpoint+suffix,true);
      fail(Array.isArray(pages) && pages.length === 1 && JSON.stringify(complete(pages[0],key)) === JSON.stringify(selected[role][key]), `${role}: paginated evidence differs`);
    }
  }
  const anchor = deploymentAnchor(c.inputs.pages,c.repository,get), latest = latestDeployment(c.repository,get,anchor);
  fail(latest.runId === c.inputs.pages.run_id && latest.attempt === c.inputs.pages.run_attempt && latest.headSha === c.inputs.pages.head_sha, 'A newer or changed Pages deployment exists');
  for (const request of c.supplementary_endpoints) get(request.endpoint,request.paginate);
  return {schema_version:'postcapture-pages-rehearsal-api-v1',publication_authority:false,observed_at:new Date(clock).toISOString(),
    caller:{run:caller,job:callerJob[0],commit:callerCommit},selected,responses,
    response_sha256:Object.fromEntries(Object.entries(responses).map(([key,value]) => [key,sha256(JSON.stringify(value))]))};
}

// Only the two complete publication histories and the exact all-attempt job
// inventories they cause latestDeployment to read have a semantic comparison.
// No terminal source, artifact catalogue, branch or Git response is exempted.
function publicationStability(evidence) {
  const c=pinnedContract(),dynamicKeys=new Set(),historyRuns=new Map(),jobEndpoints=new Map(),observedJobs=new Map();
  const get=(endpoint,pages=false)=>{
    const key=`${pages?'GET_PAGES':'GET'} ${endpoint}`;
    fail(Object.hasOwn(evidence.responses,key),`Missing publication API evidence: ${key}`);
    if(pages && jobEndpoints.has(endpoint)) {
      const jobs=inventory(evidence.responses[key],'jobs');
      dynamicKeys.add(key);observedJobs.set(jobEndpoints.get(endpoint),jobs);
    }
    return evidence.responses[key];
  };
  const inventory=(pages,key)=>{
    fail(Array.isArray(pages) && pages.length>0 && pages.length<=100 && Number.isSafeInteger(pages[0].total_count)
      && pages[0].total_count>=0 && pages.every(p=>p.total_count===pages[0].total_count && Array.isArray(p[key])),`Incomplete publication API evidence: ${key}`);
    const entries=pages.flatMap(p=>p[key]);
    fail(entries.length===pages[0].total_count && new Set(entries.map(v=>v.id)).size===entries.length,`Truncated publication API evidence: ${key}`);
    return entries;
  };
  for(const file of ['research-ui-release.yml','static-site.yml']) {
    const endpoint=`${prefix}actions/workflows/${file}/runs?branch=main&per_page=100`,pages=get(endpoint,true);
    const runs=inventory(pages,'workflow_runs');
    fail(JSON.stringify(get(endpoint))===JSON.stringify(pages[0]),'Publication first-page evidence differs');
    dynamicKeys.add(`GET_PAGES ${endpoint}`);dynamicKeys.add(`GET ${endpoint}`);
    for(const run of runs) {
      fail(!historyRuns.has(run.id),'Duplicate run across publication histories');
      historyRuns.set(run.id,run);jobEndpoints.set(`${prefix}actions/runs/${run.id}/jobs?filter=all&per_page=100`,run.id);
    }
  }
  const anchor=deploymentAnchor(c.inputs.pages,c.repository,get),latest=latestDeployment(c.repository,get,anchor);
  fail(latest.runId===c.inputs.pages.run_id && latest.attempt===c.inputs.pages.run_attempt && latest.headSha===c.inputs.pages.head_sha,
    'A newer or changed Pages deployment exists');
  const successful=[];
  for(const [id,jobs]of observedJobs) {
    // Only authority-bearing jobs need cross-snapshot identity equality. GitHub
    // legitimately adds new downstream jobs/runs while earlier jobs progress.
    const deployments=jobs.map(job=>({id:job.id,run_id:job.run_id,run_attempt:job.run_attempt,head_sha:job.head_sha,
      head_branch:job.head_branch,name:job.name,
      // Success counts in failed/running enclosures and in every attempt.
      steps:(job.steps||[]).filter(step=>['Deploy to GitHub Pages','Run actions/deploy-pages@v4'].includes(step.name)
        && step.conclusion==='success').map(step=>({job_started_at:job.started_at,step}))}))
      .filter(job=>job.steps.length).sort((a,b)=>a.id-b.id);
    if(deployments.length) {
      const {status,conclusion,updated_at,...run}=historyRuns.get(id);
      successful.push({run,deployments});
    }
  }
  successful.sort((a,b)=>a.run.id-b.run.id);
  return {dynamicKeys,successful,anchor,latest};
}

export function verifyStableEvidence(before,after) {
  fail(JSON.stringify(before.selected) === JSON.stringify(after.selected), 'Pinned evidence changed during retrieval');
  fail(before.caller.commit.sha === after.caller.commit.sha && before.caller.commit.tree.sha === after.caller.commit.tree.sha
    && before.caller.run.id===after.caller.run.id && before.caller.run.run_attempt===after.caller.run.run_attempt
    && before.caller.job.id === after.caller.job.id && before.caller.job.started_at===after.caller.job.started_at, 'Rehearsal identity changed during retrieval');
  const first=publicationStability(before),last=publicationStability(after);
  fail(JSON.stringify(first.anchor)===JSON.stringify(last.anchor) && JSON.stringify(first.latest)===JSON.stringify(last.latest),'Deployment authority changed during retrieval');
  fail(JSON.stringify(first.successful)===JSON.stringify(last.successful),'Successful deployment API evidence changed during retrieval');
  const firstKeys=Object.keys(before.responses).filter(key=>!first.dynamicKeys.has(key)).sort();
  const lastKeys=Object.keys(after.responses).filter(key=>!last.dynamicKeys.has(key)).sort();
  fail(JSON.stringify(firstKeys)===JSON.stringify(lastKeys),'API evidence inventory changed during retrieval');
  const callerResponses=new Set([`GET ${prefix}actions/runs/${before.caller.run.id}`,
    `GET ${prefix}actions/runs/${before.caller.run.id}/attempts/1/jobs?per_page=100`]);
  for (const key of firstKeys) {
    if (callerResponses.has(key)) continue;
    fail(JSON.stringify(before.responses[key]) === JSON.stringify(after.responses[key]), `API evidence changed during retrieval: ${key}`);
  }
}

export async function verifyPinnedZip(path,pin) {
  const before = lstatSync(path);
  fail(before.isFile() && !before.isSymbolicLink() && before.size === pin.zip_bytes, 'Pinned ZIP size/type changed');
  const hash = createHash('sha256');
  for await (const part of createReadStream(path)) hash.update(part);
  const after = lstatSync(path);
  fail(hash.digest('hex') === pin.artifact_sha256 && before.ino === after.ino && before.dev === after.dev
    && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'Pinned ZIP digest or identity changed');
}

// Streaming tar traversal reads metadata and skips file bodies. It never writes
// the 709 MB intermediate tar or expands any logical gzip payload.
const archiveProgram = String.raw`
import base64, hashlib, json, os, pathlib, shutil, stat, sys, tarfile, zipfile
request=json.load(sys.stdin); output={}
def check(ok,why):
 if not ok: raise ValueError(why)
def name(raw, directory=False):
 check(isinstance(raw,str) and '\\' not in raw and not any(ord(c)<32 or ord(c)==127 for c in raw),'Unsafe archive name')
 if raw.startswith('./'): raw=raw[2:]
 if directory: raw=raw.rstrip('/')
 if raw in ('','.'): return '' if directory else (_ for _ in ()).throw(ValueError('Empty file name'))
 check(not raw.startswith('/') and all(p not in ('','..','.') for p in raw.split('/')) and ':' not in raw,'Unsafe archive path')
 return raw
def put(root,n,stream):
 target=pathlib.Path(root)/n; target.parent.mkdir(parents=True,exist_ok=True)
 with open(target,'xb') as f: shutil.copyfileobj(stream,f,1024*1024)
 os.chmod(target,0o600)
for role,item in request['paths'].items():
 seen={}; implied=set(); rows=[]; metadata={}; total=0; files=0
 root=item.get('root') if request.get('extract') else None
 if root: pathlib.Path(root).mkdir(parents=False,exist_ok=False)
 def member(raw,directory,size,stream):
  global total,files
  n=name(raw,directory)
  if not n: return
  check(n not in seen,'Duplicate normalized archive path')
  for parent in pathlib.PurePosixPath(n).parents:
   check(seen.get(str(parent))!='file','Archive file/directory collision');implied.add(str(parent))
  check(directory or n not in implied,'Archive directory/file collision')
  seen[n]='directory' if directory else 'file'
  check(isinstance(size,int) and 0<=size<=4*1024**3,'Unbounded archive member')
  if directory: check(size==0,'Nonempty archive directory'); return
  total+=size;files+=1;rows.append([n,size]);check(files<=100000 and total<=8*1024**3,'Unbounded archive inventory')
  ismeta=role=='pages' and (n=='publication.json' or ('/_transport/' in n and ('/root-' in n or '/logical-' in n)))
  if ismeta:
   check(size<=16*1024**2,'Unbounded transport metadata');data=stream.read(size+1);check(len(data)==size,'Truncated metadata')
   metadata[n]=base64.b64encode(data).decode()
   if root: put(root,n,__import__('io').BytesIO(data))
  elif root: put(root,n,stream)
 with zipfile.ZipFile(item['zip']) as z:
  check(len(z.infolist())<=100000 and all(not (i.flag_bits&1) and i.compress_type in (0,8) for i in z.infolist()),'Unsupported ZIP encoding')
  for i in z.infolist():
   mode=(i.external_attr>>16)&0o170000
   check(mode in (0,stat.S_IFREG,stat.S_IFDIR),'Linked or special ZIP entry')
  if role=='pages':
   check(len(z.infolist())==1 and z.namelist()==['artifact.tar'] and z.getinfo('artifact.tar').file_size==item['tar_bytes'],'Unexpected Pages ZIP layout')
   with z.open('artifact.tar') as f,tarfile.open(fileobj=f,mode='r|') as t:
    for m in t:
     check((m.isfile() or m.isdir()) and not m.issparse(),'Linked or special Pages tar entry')
     member(m.name,m.isdir(),m.size,t.extractfile(m) if m.isfile() else None)
  else:
   for i in z.infolist():
    with z.open(i) as f: member(i.filename,i.is_dir(),i.file_size,f)
 check(total==item['expanded_bytes'] and files==item['expanded_files'],'Exact expanded archive inventory changed')
 output[role]={'bytes':total,'files':files,'inventory_sha256':hashlib.sha256(json.dumps(sorted(rows),separators=(',',':')).encode()).hexdigest(),'metadata':metadata}
print(json.dumps(output,separators=(',',':')))
`;

export function inspectArchiveMetadata(paths,execute = execFileSync,extract = false) {
  return JSON.parse(execute('python',['-c',archiveProgram],{input:JSON.stringify({paths,extract}),encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024,timeout:600000}));
}

export function measureLogicalMetadata(metadata,c = pinnedContract()) {
  const bytes = path => { fail(Object.hasOwn(metadata,path),'Missing authenticated transport metadata');return Buffer.from(metadata[path],'base64'); };
  const receipt = bytes('publication.json');
  fail(receipt.length === c.publication.bytes && sha256(receipt) === c.publication.sha256,'Exact #99 publication receipt changed');
  const publication = JSON.parse(receipt);
  fail(publication.run_id === c.inputs.pages.run_id && publication.run_attempt === 1 && publication.ui_sha === c.publication.ui_sha
    && publication.ui_digest === c.publication.ui_digest,'Exact #99 publication identity changed');
  const inventory = (ref,prefix = '') => {
    validateExpectedRoot(ref);
    const rootBytes = bytes(prefix+ref.path);
    fail(rootBytes.length === ref.bytes && sha256(rootBytes) === ref.sha256,'Transport root hash/size changed');
    const root = validateRoot(parseCanonical(rootBytes),ref);
    fail(sha256(canonicalBytes(generationBody(root))) === ref.generation,'Transport generation changed');
    const invBytes = bytes(prefix+root.logicalInventory.path);
    fail(invBytes.length === root.logicalInventory.bytes && sha256(invBytes) === root.logicalInventory.sha256,'Transport inventory hash/size changed');
    const inv = parseCanonical(invBytes);
    fail(inv.format === root.format && inv.files && typeof inv.files === 'object' && !Array.isArray(inv.files),'Invalid logical inventory');
    let sum = 0;
    for (const [path,value] of Object.entries(inv.files)) {
      fail(validPath(path) && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= 128*1024*1024
        && /^[a-f0-9]{64}$/.test(value.sha256),'Invalid logical inventory entry');sum += value.bytes;
    }
    fail(Number.isSafeInteger(sum),'Unbounded logical inventory');
    return {files:inv.files,bytes:sum};
  };
  const outer = inventory(publication.transport.root), pre = 'static-data/_financial-audit-transport/';
  fail(publication.financial_audit_transport?.root,'Missing exact nested financial audit transport');
  const nested = inventory(publication.financial_audit_transport.root,pre);
  const removed = Object.entries(outer.files).filter(([path]) => path.startsWith(pre));
  const manifest = nested.files['static-data/manifest.json'];
  fail(manifest && JSON.stringify(manifest) === JSON.stringify(outer.files['static-data/manifest.json']),'Nested manifest differs');
  const removedBytes = removed.reduce((n,[,v]) => n+v.bytes,0);
  const logicalBytes = outer.bytes-removedBytes+nested.bytes-manifest.bytes+receipt.length;
  fail(logicalBytes === c.storage.logical_bytes,'Exact decoded logical budget changed');
  return {logical_bytes:logicalBytes,outer_logical_bytes:outer.bytes,nested_logical_bytes:nested.bytes,
    nested_physical_bytes:removedBytes,duplicate_manifest_bytes:manifest.bytes,publication_bytes:receipt.length,
    logical_files:Object.keys(outer.files).length-removed.length+Object.keys(nested.files).length,
    logical_decode_performed:false};
}

export async function inspectPinnedArchives(paths) {
  const c = pinnedContract(), request = {};
  fail(Object.keys(paths).sort().join('|') === Object.keys(c.inputs).sort().join('|'),'Missing or extra pinned archive roles');
  for (const [role,pin] of Object.entries(c.inputs)) {
    await verifyPinnedZip(paths[role].zip,pin);
    request[role] = {...paths[role],expanded_files:pin.expanded_files,expanded_bytes:pin.expanded_bytes,...(role === 'pages' ? {tar_bytes:709109760} : {})};
  }
  const inventories = inspectArchiveMetadata(request), logical = measureLogicalMetadata(inventories.pages.metadata);
  for (const [role,result] of Object.entries(inventories)) {
    fail(result.inventory_sha256 === c.inputs[role].layout_sha256,`${role}: exact archive layout changed`);
    delete result.metadata;
  }
  return {inventories,logical,request};
}

export function requireStorageBudget({Z,P,L,S,R,availableBytes,retainedBytes=0},c = pinnedContract()) {
  for (const [name,value] of Object.entries({Z,P,L,S,R,availableBytes,retainedBytes})) fail(Number.isSafeInteger(value) && value >= 0,`Invalid storage measurement ${name}`);
  fail(Z === c.storage.zip_bytes && P === c.storage.pages_physical_bytes && L === c.storage.logical_bytes
    && S === c.storage.source_expanded_bytes && R > 0,'Storage measurements disagree with authenticated inventories');
  const requiredBytes = Z+2*P+5*L+2*S+R+c.storage.reserve_bytes+retainedBytes;
  fail(Number.isSafeInteger(requiredBytes),'Storage arithmetic overflow');
  const result = {formula:c.storage.formula+(retainedBytes?' + retained checkpoint ZIP and members':''),Z,P,L,S,R,retained_bytes:retainedBytes,reserve_bytes:c.storage.reserve_bytes,required_bytes:requiredBytes,
    available_bytes:availableBytes,passed:availableBytes >= requiredBytes,logical_decode_performed:false};
  if (!result.passed) { const error = Error(`Insufficient rehearsal storage: need ${requiredBytes}, available ${availableBytes}; no full decode performed`);error.preflight = result;throw error; }
  return result;
}

export function measureRuntimeUsage(execute = execFileSync,{replayPython=process.env.FINANCIAL_REPLAY_PYTHON,runtimeRoot} = {}) {
  // Invoke the selected venv executable directly. Resolving its symlink first
  // would incorrectly report the base Python prefix and omit installed deps.
  const interpreters = [...new Set(['python',replayPython].filter(Boolean))];
  const pythonPrefixes = interpreters.map(python => execute(python,['-c','import sys; print(sys.prefix)'],{encoding:'utf8'}).trim());
  const candidates = [...new Set([checkoutRoot,runtimeRoot,...pythonPrefixes,dirname(dirname(process.execPath))].filter(Boolean).map(path => realpathSync(path)))].sort((a,b) => a.length-b.length);
  const roots = candidates.filter((path,i) => !candidates.slice(0,i).some(parent => path === parent || path.startsWith(parent+'/')));
  const measurements = roots.map(path => {
    const output = execute('du',['-s','-L','-B1','--',path],{encoding:'utf8',maxBuffer:1024*1024});
    const allocated_bytes = Number(output.split(/\s/)[0]);fail(positive(allocated_bytes),'Runtime disk usage unavailable');
    return {path,allocated_bytes};
  });
  return {roots:measurements,bytes:measurements.reduce((n,v) => n+v.allocated_bytes,0)};
}

export function verifyPreservedControls(root = checkoutRoot) {
  const c = pinnedContract(), observed = {};
  for (const [path,expected] of Object.entries(c.preserved_controls)) {
    const file = join(root,path), info = lstatSync(file);
    fail(info.isFile() && !info.isSymbolicLink(),'Linked or non-file preserved control');
    observed[path] = sha256(readFileSync(file));fail(observed[path] === expected,`Reviewed initial control changed: ${path}`);
  }
  const renewal = JSON.parse(readFileSync(join(root,'contracts/financial_source_renewal_v1.json')));
  const trust = JSON.parse(readFileSync(join(root,'contracts/financial_source_postcapture_trust_v1.json')));
  fail(renewal.publication_enabled === false && Array.isArray(renewal.reviewed_controllers) && renewal.reviewed_controllers.length === 0
    && Array.isArray(renewal.reviewed_consumer_transitions) && renewal.reviewed_consumer_transitions.length === 0
    && Array.isArray(trust.reviewed_requests) && trust.reviewed_requests.length === 0,'Production renewal or postcapture trust is enabled');
  return {hashes:observed,production_renewal_enabled:false,production_postcapture_admissions:0};
}

export function ensurePinnedGitObjects(evidence,execute = execFileSync) {
  const c = pinnedContract(), result = [];
  const requiredObjects=requiredGitDependencies(c);
  fail(evidence?.schema_version === 'postcapture-pages-rehearsal-api-v1','Git retrieval requires authenticated diagnostic evidence');
  const run = args => execute('git',['-C',checkoutRoot,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:1024*1024}).trim();
  const origin = run(['remote','get-url','origin']);
  fail([`https://github.com/${c.repository}`,`https://github.com/${c.repository}.git`].includes(origin),'Unreviewed Git object remote');
  for (const [head,tree] of Object.entries(requiredObjects)) {
    const record = evidence.responses[`GET ${prefix}git/commits/${head}`];
    fail(record?.sha === head && record.tree?.sha === tree,'Unauthenticated Git object request');
    let fetched = false;
    try { run(['cat-file','-e',`${head}^{commit}`]); } catch {
      // Acquisition phase only: literal Git objects, never branches or downloaded executable archives.
      run(['fetch','--no-tags','origin',head]);fetched = true;
    }
    fail(run(['show','-s','--format=%H %T',head]) === `${head} ${tree}`,'Fetched historical commit/tree differs');
    result.push({head_sha:head,tree_sha:tree,fetched});
  }
  return result;
}

export async function downloadPinnedArchive(role,path,spawnProcess = spawn) {
  const pin = role==='retained-publication' ? pinnedCarryContinuation().checkpoint : pinnedContract().inputs[role];fail(pin,'Unreviewed archive role');
  fail(!existsSync(path),'Archive destination already exists');
  const child = spawnProcess('gh',['api',`${prefix}actions/artifacts/${pin.artifact_id}/zip`,'--allow-escape-sequences'],{stdio:['ignore','pipe','pipe'],timeout:240000});
  let count = 0;
  child.stderr.resume();
  child.stdout.on('data',chunk => { count += chunk.length;if (count > pin.zip_bytes) child.kill('SIGKILL'); });
  const completion = new Promise((done,reject) => {child.once('error',reject);child.once('exit',(code,signal) => code === 0 ? done() : reject(Error(`Pinned ${role} download failed (${code ?? signal})`)));});
  await Promise.all([pipeline(child.stdout,createWriteStream(path,{flags:'wx',mode:0o600})),completion]);
  fail(count === pin.zip_bytes,'Downloaded ZIP byte count changed');await verifyPinnedZip(path,pin);
}

export async function restoreRehearsalInputs(directory,context,{api=githubApi,checkout=checkoutIdentity,now=Date.now,download=downloadPinnedArchive,
  inspect=inspectPinnedArchives,runtime=measureRuntimeUsage,space=path => {const fs=statfsSync(path);return fs.bavail*fs.bsize;},extract=inspectArchiveMetadata,
  controls=verifyPreservedControls,gitObjects=ensurePinnedGitObjects} = {}) {
  const c = pinnedContract(), preserved = controls(), before = verifyRehearsalInputs(context,api,checkout,now), output = resolve(directory);
  const continuation=context.stage==='carry-continuation' ? pinnedCarryContinuation() : null;
  fail(!existsSync(output),'Rehearsal output must be new');mkdirSync(output);mkdirSync(join(output,'inputs'));
  const paths = Object.fromEntries(Object.entries(c.inputs).map(([role,reference]) => [role,{zip:join(output,'inputs',`${role}.zip`),root:join(output,role),reference}]));
  // This lower bound precedes downloads. The full measured bound precedes any extraction.
  fail(space(output) >= c.storage.zip_bytes+(continuation?.checkpoint.zip_bytes??0)+c.storage.reserve_bytes,'Insufficient space even for exact archive downloads');
  for (const [role,path] of Object.entries(paths)) await download(role,path.zip);
  const retained=continuation ? {zip:join(output,'inputs','retained-publication.zip'),root:join(output,'retained-publication'),
    expanded_files:continuation.checkpoint.expanded_files,expanded_bytes:continuation.checkpoint.expanded_bytes} : null;
  if(retained) await download('retained-publication',retained.zip);
  const after = verifyRehearsalInputs(context,api,checkout,now);verifyStableEvidence(before,after);
  writeFileSync(join(output,'api-evidence.json'),JSON.stringify(after,null,2)+'\n',{flag:'wx'});
  const objects = gitObjects(after);
  writeFileSync(join(output,'retrieval-provenance.json'),JSON.stringify({preserved_controls:preserved,git_objects:objects},null,2)+'\n',{flag:'wx'});
  const measured = await inspect(paths), runtimeUsage = runtime();
  if(retained) {
    await verifyPinnedZip(retained.zip,continuation.checkpoint);
    const inventory=inspectArchiveMetadata({'retained-publication':retained})['retained-publication'];
    fail(inventory.inventory_sha256===continuation.checkpoint.layout_sha256,'Retained checkpoint archive layout changed');
    measured.request['retained-publication']=retained;
  }
  const budget = {Z:c.storage.zip_bytes,P:measured.inventories.pages.bytes,L:measured.logical.logical_bytes,
    S:Object.entries(measured.inventories).filter(([role]) => role !== 'pages').reduce((n,[,value]) => n+value.bytes,0),R:runtimeUsage.bytes,availableBytes:space(output),
    retainedBytes:retained ? continuation.checkpoint.zip_bytes+continuation.checkpoint.expanded_bytes : 0};
  let preflight;
  try {preflight = requireStorageBudget(budget);} catch (error) {
    if(error.preflight)writeFileSync(join(output,'storage-preflight.json'),JSON.stringify({...error.preflight,runtime_usage:runtimeUsage,logical:measured.logical},null,2)+'\n',{flag:'wx'});
    throw error;
  }
  writeFileSync(join(output,'storage-preflight.json'),JSON.stringify({...preflight,runtime_usage:runtimeUsage,logical:measured.logical,inventories:measured.inventories},null,2)+'\n',{flag:'wx'});
  // Recheck all digest-bound inputs immediately before extraction.
  for (const [role,path] of Object.entries(paths)) await verifyPinnedZip(path.zip,c.inputs[role]);
  if(retained) await verifyPinnedZip(retained.zip,continuation.checkpoint);
  extract(measured.request,execFileSync,true);
  const manifest = {schema_version:'postcapture-pages-rehearsal-inputs-v1',publication_authority:false,provider_work:false,
    api_evidence:join(output,'api-evidence.json'),storage_preflight:join(output,'storage-preflight.json'),paths};
  writeFileSync(join(output,'inputs.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return manifest;
}

async function main() {
  const [directory,...extra] = process.argv.slice(2);fail(directory && extra.length === 0,'Usage: restore-postcapture-pages-rehearsal.mjs NEW_DIRECTORY');
  const context = {repository:process.env.GITHUB_REPOSITORY,branch:process.env.GITHUB_REF_NAME,event:process.env.GITHUB_EVENT_NAME,
    id:Number(process.env.GITHUB_RUN_ID),attempt:Number(process.env.GITHUB_RUN_ATTEMPT),sha:process.env.GITHUB_SHA,stage:process.env.POSTCAPTURE_REHEARSAL_STAGE||'seal'};
  const result = await restoreRehearsalInputs(directory,context);console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
