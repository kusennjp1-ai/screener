// Read-only evidence capture. A successful limited envelope is never a full
// Design pass, financial-source admission, owner approval, or deployment.
import {execFileSync} from 'node:child_process';
import {appendFileSync,cpSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {bootstrap,dataFiles,dataInventoryDigest,inventoryDigest,livePublication,isData,safePath,sha256,uiInventory} from './publication-state.mjs';
import {githubApi,sameRepository} from './publication-gate.mjs';
import {canonicalPublication,removeCanonical,validateTransportPreview} from './static-transport-publication.mjs';
import {buildLimitedResearchAssessment,measuredPerformanceFailures,LIMITED_RESEARCH_SCOPE} from '../../frontend/tools/limited-research-assessment.mjs';
import {LIMITED_RESEARCH_PREVIEW_NOTICE} from '../../frontend/src/static/limitedResearchPreview.js';

export const LIMITED_ASSESSMENT_WORKFLOW = '.github/workflows/limited-research-assessment.yml';
export const LIMITED_BUNDLE_MAX_BYTES = 2 * 1024 ** 3;
const positive = value => Number.isSafeInteger(value) && value > 0;
const commit = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const require = (condition,message) => {if(!condition)throw Error(`Limited assessment: ${message}`);};
const git = (root,...args) => execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:8*1024**2}).trim();
const json = file => JSON.parse(readFileSync(file,'utf8'));
function boundedFile(path,maximum=64*1024**2) {
  const stat=lstatSync(path);require(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=maximum,'evidence must be bounded regular bytes');
  return readFileSync(path);
}
export function authenticatedReceiptBytes(live) {
  require((Buffer.isBuffer(live.receiptBytes)||typeof live.receiptBytes==='string')&&sha256(live.receiptBytes)===live.receiptHash,'raw authenticated predecessor receipt is required');
  return live.receiptBytes;
}
const write = (file,value) => {mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(value,null,2));};
const scratch = () => join(process.env.RUNNER_TEMP || '/tmp','limited-research-assessment');
const expectedDataDigest = live => live.receipt?.data_inventory_sha256 || live.receipt?.transport?.logical_data_inventory_sha256;

export function regularInventory(root,{maximumBytes=LIMITED_BUNDLE_MAX_BYTES}={}) {
  require(lstatSync(root).isDirectory()&&!lstatSync(root).isSymbolicLink(),'inventory root must be a regular directory');
  let bytes=0,files=0;const inventory={};
  function visit(directory,prefix='') {
    for(const name of readdirSync(directory).sort()) {
      const path=prefix+name,absolute=join(directory,name),stat=lstatSync(absolute);
      require(safePath(path),'unsafe capture member');
      if(stat.isDirectory()&&!stat.isSymbolicLink())visit(absolute,`${path}/`);
      else {
        require(stat.isFile()&&!stat.isSymbolicLink(),'links and special capture files are forbidden');
        bytes+=stat.size;files++;
        require(bytes<=maximumBytes&&files<=60000,'capture exceeds bounded bytes or file count');
        inventory[path]=sha256(readFileSync(absolute));
      }
    }
  }
  visit(root);return inventory;
}

export function validateAssessmentExecution({root=process.cwd(),env=process.env,api=githubApi}={}) {
  const revision=git(root,'rev-parse','HEAD'),id=Number(env.GITHUB_RUN_ID),attempt=Number(env.GITHUB_RUN_ATTEMPT);
  require(env.CI==='true'&&env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.GITHUB_REPOSITORY===bootstrap.repository
    &&env.GITHUB_REF==='refs/heads/main'&&commit(revision)&&revision===env.GITHUB_SHA&&revision===env.GITHUB_WORKFLOW_SHA
    &&env.GITHUB_WORKFLOW_REF===`${bootstrap.repository}/${LIMITED_ASSESSMENT_WORKFLOW}@refs/heads/main`
    &&positive(id)&&positive(attempt),'only an exact main manual assessment can capture evidence');
  git(root,'diff','--exit-code','HEAD','--','.github','frontend/src','frontend/tools','frontend/index.html','frontend/vite.config.js','frontend/package.json','frontend/package-lock.json');
  const repo=api(`repos/${bootstrap.repository}`);
  require(repo.full_name===bootstrap.repository&&repo.default_branch==='main','repository identity changed');
  require(api(`repos/${bootstrap.repository}/git/ref/heads/main`).object?.sha===revision,'assessed UI is no longer current main');
  const run=api(`repos/${bootstrap.repository}/actions/runs/${id}/attempts/${attempt}`),latest=api(`repos/${bootstrap.repository}/actions/runs/${id}`);
  for(const value of [run,latest])require(value.id===id&&value.run_attempt===attempt&&value.path===LIMITED_ASSESSMENT_WORKFLOW
    &&value.head_sha===revision&&value.head_branch==='main'&&value.event==='workflow_dispatch'&&value.status==='in_progress'
    &&value.conclusion===null&&sameRepository(value,bootstrap.repository),'caller is not the exact active assessment attempt');
  return {revision,id,attempt};
}


function copyData(source,destination) {
  mkdirSync(destination,{recursive:true});
  cpSync(join(source,'static-data'),join(destination,'static-data'),{recursive:true,errorOnExist:true,force:false});
  for(const file of dataFiles)cpSync(join(source,file),join(destination,file),{errorOnExist:true,force:false});
}

export async function prepareAssessment({root=process.cwd(),env=process.env,api=githubApi}={}) {
  const execution=validateAssessmentExecution({root,env,api});
  require(env.LIMITED_UI_SHA===execution.revision&&commit(env.LIMITED_BASELINE_SHA),'exact UI/baseline inputs are required');
  const directory=scratch(),bundle=join(directory,'bundle'),frontend=join(root,'frontend');
  require(!existsSync(directory),'capture directory already exists');mkdirSync(directory,{recursive:true});
  const live=await livePublication({repository:bootstrap.repository,api});
  require(live.receipt&&hash(expectedDataDigest(live)),'published input lacks a complete admitted logical data digest');
  const pages=api(`repos/${bootstrap.repository}/actions/artifacts?per_page=100`,true);
  const {publishedSource,materialize}=await import('./select-release-source.mjs');
  const source=publishedSource(live,pages);
  require(!source.repair&&source.receiptHash===live.receiptHash,'only the already published authenticated artifact may be frozen');
  await materialize(source,join(frontend,'public'),false,frontend,live);
  // The normal raw materializer restores static-data only. These exact root
  // members come from its already digest-verified archive, never an exporter.
  if(!source.publication.transport) {
    const archive=join(env.RUNNER_TEMP||'/tmp','verified-publication',`artifact-${source.artifact.id}`,'artifact.tar');
    for(const file of dataFiles)writeFileSync(join(frontend,'public',file),execFileSync('tar',['-xOf',archive,`./${file}`],{maxBuffer:64*1024**2}));
  }
  require(dataInventoryDigest(join(frontend,'public'))===expectedDataDigest(live),'restored published logical bytes differ');
  copyData(join(frontend,'public'),join(bundle,'frozen'));
  mkdirSync(join(bundle,'evidence'),{recursive:true});
  writeFileSync(join(bundle,'evidence/predecessor-publication.json'),authenticatedReceiptBytes(live));
  write(join(directory,'input-provenance.json'),{controllerSha:execution.revision,sourceSha:execution.revision,decision:{mode:'design'},source,live});
  write(join(directory,'prepared.json'),{schema_version:'limited-research-prepared-v1',ui_sha:execution.revision,
    assessment_run:{id:execution.id,attempt:execution.attempt},baseline_sha:env.LIMITED_BASELINE_SHA,prepared_at:new Date().toISOString(),
    predecessor:{identity:live.identity,receipt_sha256:live.receiptHash},
    source:{artifact_id:source.artifact.id,artifact_name:source.artifact.name,artifact_digest:source.artifact.digest,run_id:source.runId,run_attempt:source.attempt},
    data:{manifest_sha256:live.manifestHash,logical_inventory_sha256:expectedDataDigest(live),financial_lineage_sha256:live.receipt.financial_lineage_sha256||null}});
  if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,'prepared=true\n');
  return {prepared:true,ui_sha:execution.revision,publication_authority:'none'};
}

async function assertPreparedBuild({root,directory,prepared}) {
  const dist=join(root,'frontend/dist'),frozen=join(directory,'bundle/frozen'),baseline=join(process.env.RUNNER_TEMP||'/tmp','limited-research-baseline/frontend/dist');
  require(dataInventoryDigest(frozen)===prepared.data.logical_inventory_sha256,'frozen original data changed');
  require(dataInventoryDigest(baseline)===prepared.data.logical_inventory_sha256,'baseline differs from frozen original data');
  require(sha256(readFileSync(join(dist,'static-data/manifest.json')))===prepared.data.manifest_sha256,'tested manifest changed');
  const publication=json(join(dist,'publication.json'));validateTransportPreview(publication);
  require(publication.ui_sha===prepared.ui_sha&&publication.ui_digest===inventoryDigest(uiInventory(dist)),'tested preview UI binding differs');
  const canonical=await canonicalPublication({root:dist,frontendRoot:join(root,'frontend'),publication,restore:join(directory,'verified-logical-dist')});
  try{require(dataInventoryDigest(canonical)===prepared.data.logical_inventory_sha256,'tested dist differs from frozen original data');}
  finally{removeCanonical(dist,canonical);}
  return {dist,publication};
}

export async function bindAssessmentBuild({root=process.cwd()}={}) {
  const directory=scratch(),prepared=json(join(directory,'prepared.json'));
  const {dist}=await assertPreparedBuild({root,directory,prepared});
  require(!existsSync(join(directory,'tested-build.json')),'measurement build is already bound');
  write(join(directory,'tested-build.json'),regularInventory(dist));
  return {bound:true,publication_authority:'none'};
}

export function verifyReportEvidence({reports,uiSha,measurementExitCode,notBefore=null,now=Date.now()}) {
  require([0,1].includes(measurementExitCode),'browser harness did not return a normal original Design result');
  const reportBytes=boundedFile(join(reports,'report.json')),report=JSON.parse(reportBytes);
  if(notBefore!==null)require(Number.isFinite(Date.parse(notBefore))&&Date.parse(report.measured_at)>=Date.parse(notBefore)&&Date.parse(report.measured_at)<=now,'measurement clock is outside this capture');
  require(report.commit===uiSha&&report.assessment_mode===LIMITED_RESEARCH_SCOPE,'raw report UI/scope mismatch');
  require(measurementExitCode===(report.failures?.length?1:0),'original Design exit disagrees with untouched report');
  const originalAssessmentBytes=boundedFile(join(reports,'limited-assessment.json'));
  require(JSON.stringify(JSON.parse(originalAssessmentBytes))===JSON.stringify(buildLimitedResearchAssessment(report,[])),'original diagnostic envelope does not derive from the untouched report');
  // Capture only proposes a scope. Numeric failures must be independently
  // derived from actual measurements; no prefix matching or owner approval is
  // inferred. Later publication requires exact separately accepted strings.
  const measured=measuredPerformanceFailures(report);
  const proposed=[...new Set(report.failures.filter(failure=>measured.has(failure)))];
  const assessment=buildLimitedResearchAssessment(report,proposed),assessmentBytes=Buffer.from(JSON.stringify(assessment,null,2));
  require(assessment.blocking_failures.length===0,'non-waivable failures remain');
  const screenshots={},paths=new Set();
  for(const screen of report.screens) {
    require(typeof screen.screenshot==='string'&&/^[A-Za-z0-9._-]+\.png$/.test(screen.screenshot)&&!paths.has(screen.screenshot),'unsafe or duplicate screenshot path');
    const absolute=join(reports,screen.screenshot),stat=lstatSync(absolute),bytes=readFileSync(absolute);
    require(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>8&&stat.size<=32*1024**2
      &&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&sha256(bytes)===screen.sha256,'screenshot bytes or hash differ');
    paths.add(screen.screenshot);screenshots[screen.key]=screen.sha256;
  }
  return {report,reportBytes,assessment,assessmentBytes,originalAssessmentBytes,screenshots};
}

// Retain only one source-data representation in the immutable bundle. The
// original logical inventory remains hash-bound; exact captured transport is
// independently round-tripped before this duplicate local copy is retired.
export function stageFrozenInventory({bundle,destination,expectedDigest}) {
  const frozen=join(bundle,'frozen'),files=regularInventory(frozen);
  require(Object.keys(files).length>0&&Object.keys(files).every(isData)&&inventoryDigest(files)===expectedDigest,'original frozen inventory changed');
  require(!existsSync(destination),'original frozen scratch already exists');
  write(join(bundle,'evidence/frozen-inventory.json'),files);
  renameSync(frozen,destination);
  return files;
}

export async function sealAssessment({root=process.cwd(),env=process.env,api=githubApi}={}) {
  const execution=validateAssessmentExecution({root,env,api}),directory=scratch(),bundle=join(directory,'bundle'),prepared=json(join(directory,'prepared.json'));
  require(prepared.ui_sha===execution.revision&&prepared.assessment_run.id===execution.id&&prepared.assessment_run.attempt===execution.attempt,'prepared caller changed');
  const live=await livePublication({repository:bootstrap.repository,api});
  require(live.identity===prepared.predecessor.identity&&live.receiptHash===prepared.predecessor.receipt_sha256,'published predecessor changed during assessment');
  const {dist}=await assertPreparedBuild({root,directory,prepared});
  require(JSON.stringify(regularInventory(dist))===JSON.stringify(json(join(directory,'tested-build.json'))),'tested UI/data bytes changed after measurement');
  const exitBytes=readFileSync(join(directory,'measurement-exit-code.txt'),'utf8');
  require(/^[01]\n$/.test(exitBytes),'missing original browser exit');
  const measurementExitCode=Number(exitBytes.trim()),reports=join(directory,'reports');
  const evidence=verifyReportEvidence({reports,uiSha:execution.revision,measurementExitCode,notBefore:prepared.prepared_at});
  require(evidence.report.data?.as_of_date===live.manifest.markets.US.as_of_date&&evidence.report.data?.research_generation===live.manifest.research_generation,'report data identity differs from frozen input');
  const evidenceDirectory=join(bundle,'evidence');
  writeFileSync(join(evidenceDirectory,'report.json'),evidence.reportBytes);
  writeFileSync(join(evidenceDirectory,'assessment.json'),evidence.assessmentBytes);
  writeFileSync(join(evidenceDirectory,'original-limited-assessment.json'),evidence.originalAssessmentBytes);
  write(join(evidenceDirectory,'screenshots.json'),evidence.screenshots);
  writeFileSync(join(evidenceDirectory,'notice.txt'),LIMITED_RESEARCH_PREVIEW_NOTICE);
  mkdirSync(join(evidenceDirectory,'screenshots'));
  for(const screen of evidence.report.screens)cpSync(join(reports,screen.screenshot),join(evidenceDirectory,'screenshots',screen.screenshot),{errorOnExist:true,force:false});
  cpSync(dist,join(bundle,'dist'),{recursive:true,errorOnExist:true,force:false});
  stageFrozenInventory({bundle,destination:join(directory,'frozen-original'),expectedDigest:prepared.data.logical_inventory_sha256});
  const files=regularInventory(bundle),capture={schema_version:'limited-research-capture-v1',scope_id:LIMITED_RESEARCH_SCOPE,publication_authority:'none',
    ui_sha:execution.revision,controller_sha:execution.revision,assessment_run:prepared.assessment_run,captured_at:new Date().toISOString(),baseline_sha:prepared.baseline_sha,
    predecessor:prepared.predecessor,source:prepared.source,data:prepared.data,ui:{sha:execution.revision,inventory_sha256:inventoryDigest(uiInventory(dist))},
    evidence:{report_sha256:files['evidence/report.json'],assessment_sha256:files['evidence/assessment.json'],screenshots_sha256:files['evidence/screenshots.json'],notice_sha256:files['evidence/notice.txt']},
    measurement_exit_code:measurementExitCode,files};
  write(join(bundle,'capture.json'),capture);regularInventory(bundle);
  const archive=join(directory,'bundle.tar');
  execFileSync('tar',['--format=posix','-cf',archive,'-C',bundle,'.'],{stdio:'pipe'});
  if(lstatSync(archive).size>LIMITED_BUNDLE_MAX_BYTES){rmSync(archive);throw Error('Limited assessment: TAR exceeds 2 GiB bound');}
  if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,'sealed=true\n');
  return {sealed:true,ui_sha:execution.revision,publication_authority:'none',original_design_exit:measurementExitCode};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [command,...extra]=process.argv.slice(2);
  try {
    require(process.execArgv.length===0&&!process.env.NODE_OPTIONS&&!process.env.NODE_PATH&&!process.env.FINANCIAL_EVALUATED_AT,'runtime hooks and clock overrides are forbidden');
    require(extra.length===0&&['prepare','bind','seal'].includes(command),'expected prepare, bind or seal');
    console.log(JSON.stringify(await (command==='prepare'?prepareAssessment():command==='bind'?bindAssessmentBuild():sealAssessment())));
  } catch(error) {console.error(error.stack||String(error));process.exitCode=1;}
}
