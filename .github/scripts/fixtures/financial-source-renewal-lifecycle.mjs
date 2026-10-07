// Fully offline integration fixture. Production modules are copied unchanged.
// Git objects, source journals, archive merges, projections, certificate ZIPs,
// and publisher outputs are real. Provider, GitHub, and market observations are
// explicitly SYNTHETIC and grant no authority outside this disposable Git root.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {chmodSync,cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {bootstrap,sha256} from '../publication-state.mjs';
import {contract,digest} from '../financial-correction.mjs';
import {financialReleasePolicy,protectedCodeInventory} from '../financial-release-activation.mjs';
import {renewalPolicy,consumerCodeInventory,renewalControllerCodeInventory} from '../financial-source-renewal.mjs';
import {extractPriceObservations,priceObservationDigest} from '../price-observations.mjs';
import {archiveApiPayload,assertSyntheticPriceAdvance} from './financial-release-archive-lifecycle.mjs';

const ownRoot=fileURLToPath(new URL('../../../',import.meta.url));
const repository=bootstrap.repository,prefix=`repos/${repository}`;
export const read=path=>JSON.parse(readFileSync(path,'utf8'));
export const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const hashFile=path=>sha256(readFileSync(path));
const sourceDate='2026-10-02',seedTime='2026-10-04T13:00:00.000Z';
const runtime=()=>process.env.FINANCIAL_REPLAY_PYTHON||'python3';

function bars(date,price){
  const dates=[];for(let time=Date.parse(date);dates.length<260;time-=86400000){const day=new Date(time).getUTCDay();if(day!==0&&day!==6)dates.unshift(new Date(time).toISOString().slice(0,10));}
  return dates.map((date,index)=>{const close=price*(.8+.2*index/259);return {date,open:close,high:close*1.01,low:close*.99,close,volume:1000000};});
}

export function renewalLifecycleFixture({directory,runtimeRoot=ownRoot,nodeModules=join(ownRoot,'frontend/node_modules'),python=runtime(),keep=false}={}){
  const root=directory?resolve(directory):mkdtempSync(join(tmpdir(),'genuine-renewal-lifecycle-'));
  mkdirSync(root,{recursive:true});
  const checkout=join(root,'controller'),bin=join(root,'bin'),configPath=join(root,'transport.json'),preload=join(root,'transport.mjs');
  mkdirSync(checkout);mkdirSync(bin);
  const config={repository:checkout,gitRoots:[checkout],api:{},zips:{},liveRoot:null},api=config.api;
  const phases=[];
  let now=seedTime,head,uiSha,runId=300,latestArtifact,sources,seed;
  const env={...process.env,PATH:`${bin}:${dirname(resolve(python))}:${process.env.PATH}`,RUNNER_TEMP:join(root,'runner'),
    GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:repository,GITHUB_RUN_ATTEMPT:'1',
    GITHUB_EVENT_PATH:join(root,'event.json'),GITHUB_OUTPUT:join(root,'output'),GITHUB_ENV:join(root,'environment'),
    RENEWAL_FIXTURE_CONFIG:configPath,RENEWAL_FIXTURE_TRACE:join(root,'trace.jsonl'),NODE_OPTIONS:`--max-old-space-size=3072 --import=${preload}`,
    FINANCIAL_REPLAY_PYTHON:python,LITELLM_LOCAL_MODEL_COST_MAP:'true'};
  const save=()=>write(configPath,config);
  function invoke(command,args=[],{cwd=checkout,extra={},timeout=180000}={}){
    save();return spawnSync(command,args,{cwd,encoding:'utf8',timeout,maxBuffer:16*1024*1024,env:{...env,RENEWAL_FIXTURE_NOW:now,
      RELEASE_SHA:head,GITHUB_SHA:head,GITHUB_RUN_ID:String(runId),...extra}});
  }
  function success(result,label){
    if(result.status!==0||result.error)write(join(root,'last-failure.json'),{label,status:result.status,error:result.error?.message,stdout:result.stdout,stderr:result.stderr});
    assert.ifError(result.error);assert.equal(result.status,0,`${label}\n${result.stdout}\n${result.stderr}`);return result.stdout;
  }
  const run=(command,args,options)=>success(invoke(command,args,options),`${command} ${args.join(' ')}`);
  function evaluate(code,extra={}){
    const path=join(checkout,'.synthetic-renewal-evaluate.mjs');write(path,code);
    try{return run(process.execPath,[path],{extra});}finally{rmSync(path,{force:true});}
  }
  function checkpoint(label,extra={}){phases.push({label,...extra});write(join(root,'report.json'),{schema_version:'synthetic-journal-renewal-lifecycle-v1',authority:'none',provider_transport:'SYNTHETIC; external network blocked',market_observations:'SYNTHETIC; prior OHLCV prefix retained',phases});}
  function commit(label,paths=['.']){
    git(checkout,'add','--',...paths);git(checkout,'-c','user.name=Synthetic offline fixture','-c','user.email=fixture@example.invalid','commit','-m',label);
    head=git(checkout,'rev-parse','HEAD');config.currentSha=head;return head;
  }
  function registration(reference,evidence){
    const base=`${prefix}/actions/runs/${reference.run_id}`;
    api[`${base}/attempts/${reference.run_attempt}`]=evidence.run;
    api[`${base}/attempts/${reference.run_attempt}/jobs?per_page=100`]=[{jobs:evidence.jobs}];
    api[`${base}/artifacts?per_page=100`]=[{artifacts:evidence.artifacts}];
  }
  function workflow(id,path,sha=head,{event='push',branch='main',start=now,conclusion='success'}={}){
    return {id,run_attempt:1,head_sha:sha,path,head_branch:branch,event,status:'completed',conclusion,run_started_at:start,
      repository:{full_name:repository,id:7},head_repository:{full_name:repository,id:7}};
  }
  function ci(sha,id,{design=false}={}){
    const record=workflow(id,'.github/workflows/ci.yml',sha),jobs=contract.required_ci_jobs.map((name,index)=>({id:id*10+index,
      run_id:id,run_attempt:1,head_sha:sha,name,status:'completed',conclusion:'success',started_at:now,completed_at:now}));
    registration({run_id:id,run_attempt:1},{run:record,jobs,artifacts:[]});
    api[`${prefix}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&per_page=100`]=[{workflow_runs:[record]}];
    const designRun=workflow(id+1,'.github/workflows/design-acceptance.yml',sha);
    registration({run_id:id+1,run_attempt:1},{run:designRun,jobs:[{id:(id+1)*10,run_id:id+1,run_attempt:1,head_sha:sha,
      name:financialReleasePolicy.candidate_job,status:'completed',conclusion:'success'}],artifacts:[]});
    api[`${prefix}/actions/workflows/design-acceptance.yml/runs?branch=main&event=push&head_sha=${sha}&per_page=100`]=[{workflow_runs:design?[designRun]:[]}];
    return {type:'gates',sha,runs:[{id,attempt:1,path:record.path},{id:id+1,attempt:1,path:designRun.path}]};
  }
  function archive(directory,name,member='artifact.tar'){
    const tar=join(root,`${name}.tar`),zip=join(root,`${name}.zip`);
    run('tar',['-cf',tar,'-C',directory,'.']);
    run(python,['-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:z.write(sys.argv[2],sys.argv[3])',zip,tar,member]);rmSync(tar);return zip;
  }
  function artifact(zip,id,name,run=runId,sha=head){
    config.zips[`${prefix}/actions/artifacts/${id}/zip`]=zip;
    return {id,name,expired:false,digest:`sha256:${hashFile(zip)}`,size_in_bytes:statSync(zip).size,created_at:now,expires_at:'2099-01-01T00:00:00Z',
      workflow_run:{id:run,head_sha:sha,head_branch:'main',repository_id:7,head_repository_id:7}};
  }
  function deploy(dist,id){
    const target=join(root,`deployed-${id}`);cpSync(dist,target,{recursive:true});config.liveRoot=target;
    const publication=read(join(target,'publication.json')),sha=publication.controller_sha;
    const zip=archive(target,`pages-${id}`);latestArtifact=artifact(zip,id+50000,publication.artifact_name,id,sha);
    registration({run_id:id,run_attempt:1},{run:workflow(id,'.github/workflows/research-ui-release.yml',sha,{event:'workflow_dispatch'}),
      jobs:[{id:id*10,run_id:id,run_attempt:1,head_sha:sha,status:'completed',conclusion:'success',started_at:now,
        steps:[{name:'Deploy to GitHub Pages',conclusion:'success',started_at:new Date(Date.parse(now)+60000).toISOString(),completed_at:new Date(Date.parse(now)+61000).toISOString()}]}],artifacts:[latestArtifact]});
    api[`${prefix}/actions/artifacts?per_page=100`]=[{artifacts:[latestArtifact]}];save();return readLive();
  }
  function readLive({allowFailure=false}={}){
    const result=invoke(process.execPath,['--input-type=module','-e',`import {livePublication} from './.github/scripts/publication-state.mjs';console.log(JSON.stringify(await livePublication()));`]);
    return allowFailure?result:JSON.parse(success(result,'read simulated published bundle'));
  }
  function exportData(frontend,extra={}){return run(process.execPath,['tools/export-research.mjs'],{cwd:frontend,extra:{FINANCIAL_EVALUATED_AT:now,...extra}});}
  function targetBase(publicRoot,path){
    evaluate(`import {readFileSync,writeFileSync} from 'node:fs';import {decodeResearchIndex} from './frontend/src/static/researchTransport.js';
      const root=${JSON.stringify(publicRoot)},manifest=JSON.parse(readFileSync(root+'/static-data/manifest.json'));
      const index=decodeResearchIndex(JSON.parse(readFileSync(root+'/static-data/'+manifest.markets.US.assets.research.path)));
      writeFileSync(${JSON.stringify(path)},JSON.stringify({market:'US',as_of_date:index.as_of_date,rows:index.rows}));`);return path;
  }
  function restoreReleaseCode(){
    const release=join(checkout,'release');rmSync(release,{recursive:true,force:true});mkdirSync(release);
    const tar=join(root,'release-code.tar');git(checkout,'archive','--format=tar','-o',tar,uiSha,'frontend','contracts','data/ibd_reference');
    run('tar',['-xf',tar,'-C',release]);rmSync(tar);return join(release,'frontend');
  }
  function command(name,{allowFailure=false,extra={}}={}){
    const result=invoke(process.execPath,[join(checkout,'.github/scripts/select-release-source.mjs'),name],{extra});
    return allowFailure?result:success(result,`publisher ${name}`);
  }
  function certifyCommand(name,{allowFailure=false}={}){
    const result=invoke(process.execPath,[join(checkout,'.github/scripts/financial-source-renewal-certification.mjs'),name],
      {extra:{GITHUB_WORKFLOW_REF:`${repository}/${renewalPolicy.workflow}@refs/heads/main`}});
    return allowFailure?result:success(result,`renewal certifier ${name}`);
  }
  function state(){return read(join(env.RUNNER_TEMP,'verified-publication/state.json'));}

  // Transport substitutes only network reads and the declared evaluation clock.
  // Every Git response is derived from an actual fixture Git object.
  write(join(bin,'gh'),`#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process'),args=process.argv.slice(2),config=JSON.parse(fs.readFileSync(process.env.RENEWAL_FIXTURE_CONFIG));
if(args[0]!=='api'||args.slice(1,-1).some(arg=>!['--paginate','--slurp'].includes(arg)))throw Error('Unexpected SYNTHETIC GitHub command');
const endpoint=args.at(-1);fs.appendFileSync(process.env.RENEWAL_FIXTURE_TRACE,JSON.stringify({api:endpoint})+'\\n');
const git=(root,...a)=>cp.execFileSync('git',['-C',root,...a],{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const locate=sha=>config.gitRoots.find(root=>cp.spawnSync('git',['-C',root,'cat-file','-e',sha]).status===0);
let value;if(Object.hasOwn(config.zips,endpoint)){const bytes=fs.readFileSync(config.zips[endpoint]);let offset=0;while(offset<bytes.length)offset+=fs.writeSync(1,bytes,offset,bytes.length-offset);process.exit(0);}
if(Object.hasOwn(config.api,endpoint))value=archiveApiPayload(config.api[endpoint],args.includes('--paginate'));
else if(endpoint===${JSON.stringify(`${prefix}/git/ref/heads/main`)})value={object:{sha:config.currentSha}};
else if(endpoint.startsWith(${JSON.stringify(`${prefix}/git/commits/`)})){const sha=endpoint.split('/').at(-1),root=locate(sha);if(!root)throw Error('Unknown fixture commit');value={sha,tree:{sha:git(root,'rev-parse',sha+'^{tree}')}};}
else if(endpoint.startsWith(${JSON.stringify(`${prefix}/git/trees/`)})){const sha=endpoint.split('/').at(-1).split('?')[0],root=locate(sha);if(!root)throw Error('Unknown fixture tree');value={sha,truncated:false,tree:git(root,'ls-tree','-r',sha).split('\\n').filter(Boolean).map(line=>{const [meta,path]=line.split('\\t'),[mode,type,sha]=meta.split(' ');return {path,mode,type,sha};})};}
else if(endpoint.startsWith(${JSON.stringify(`${prefix}/contents/`)})){const [path,revision]=endpoint.slice(${`${prefix}/contents/`.length}).split('?ref='),root=locate(revision);if(!root)throw Error('Unknown fixture content commit');const bytes=cp.execFileSync('git',['-C',root,'show',revision+':'+path]);value={type:'file',encoding:'base64',size:bytes.length,content:bytes.toString('base64')};}
else throw Error('Unexpected SYNTHETIC GitHub read '+endpoint);process.stdout.write(JSON.stringify(value));\n${archiveApiPayload.toString()}`);chmodSync(join(bin,'gh'),0o755);
  write(preload,`import {readFileSync,appendFileSync} from 'node:fs';import {join} from 'node:path';
const config=JSON.parse(readFileSync(process.env.RENEWAL_FIXTURE_CONFIG)),base=new URL(${JSON.stringify(bootstrap.site_url)}),RealDate=Date;
globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[process.env.RENEWAL_FIXTURE_NOW]));}static now(){return RealDate.parse(process.env.RENEWAL_FIXTURE_NOW);}};
globalThis.fetch=async(input,options)=>{const url=new URL(input),path=url.pathname.slice(base.pathname.length);
if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||path.includes('..')||options.redirect!=='error')throw Error('Unexpected network request in SYNTHETIC fixture');
appendFileSync(process.env.RENEWAL_FIXTURE_TRACE,JSON.stringify({pages:path})+'\\n');const bytes=readFileSync(join(config.liveRoot,path));return new Response(bytes);};`);
  write(join(root,'event.json'),{inputs:{}});
  api[prefix]={full_name:repository,default_branch:'main'};
  for(const file of ['research-ui-release.yml','static-site.yml'])api[`${prefix}/actions/workflows/${file}/runs?branch=main&per_page=100`]=[{workflow_runs:[]}];
  save();
  const tar=join(root,'unchanged-production-code.tar');
  execFileSync('git',['-C',runtimeRoot,'archive','--format=tar','-o',tar,'HEAD','.github','contracts','frontend','backend/app','backend/tests/unit','data/ibd_reference','.gitignore']);
  execFileSync('tar',['-xf',tar,'-C',checkout]);rmSync(tar);
  assert.ok(existsSync(join(nodeModules,'vite/bin/vite.js')),'Install the repository frontend dependencies before this integration test');
  symlinkSync(resolve(nodeModules),join(checkout,'frontend/node_modules'));
  // Tests may be running before their files are committed; only test code is
  // copied from the current worktree. It never enters protected runtime paths.
  const builder=join(checkout,'.github/scripts/fixtures/build-financial-renewal-source.py');
  cpSync(join(ownRoot,'.github/scripts/fixtures/build-financial-renewal-source.py'),builder);
  git(checkout,'init','-b','main');commit('SYNTHETIC offline fixture: unchanged production runtime');

  return {root,checkout,builder,config,api,env,phases,python,invoke,run,evaluate,success,checkpoint,commit,registration,workflow,ci,archive,artifact,deploy,readLive,
    exportData,targetBase,restoreReleaseCode,command,certifyCommand,state,save,
    get head(){return head;},get uiSha(){return uiSha;},get now(){return now;},get liveRoot(){return config.liveRoot;},get latestArtifact(){return latestArtifact;},get sources(){return sources;},get seed(){return seed;},
    setTime(value){now=value;},setRun(value){runId=value;env.RUNNER_TEMP=join(root,'runner',`run-${value}`);env.GITHUB_OUTPUT=join(root,`output-${value}`);env.GITHUB_ENV=join(root,`environment-${value}`);},
    setHead(value){head=value;config.currentSha=value;},setUi(value){uiSha=value;},setSources(value){sources=value;},setSeed(value){seed=value;},
    cleanup(){if(!keep)rmSync(root,{recursive:true,force:true});}};
}

export function buildSyntheticRenewalSources(f){
  const base=join(f.root,'source-base.json');
  write(base,{market:'US',as_of_date:sourceDate,rows:['AMD','NVDA'].map(symbol=>({symbol,market:'US',current_price:100,adv_usd:35000000}))});
  const config=join(f.root,'source-builder-input.json'),output=join(f.root,'sources');
  write(config,{source_head_sha:f.head,base_path:base,expired_variant:true});
  f.run(f.python,[f.builder,'sources','--output',output,'--config',config],{extra:{PYTHONPATH:join(f.checkout,'backend')},timeout:180000});
  const manifest=read(join(output,'manifest.json')),certifier=manifest.certifier_code_root;
  git(certifier,'init','-b','synthetic-certifier');f.config.gitRoots.push(certifier);
  const trustPath=join(f.checkout,'contracts/financial_source_certification_trust_v1.json'),trust=read(trustPath);
  assert.deepEqual(manifest.certifier_files,trust.files,'SYNTHETIC source certifier must use the original immutable reviewed files');
  for(const generation of manifest.generations){
    const requestBytes=readFileSync(generation.request_path),requestPath='.github/financial-source-certification-request.json';
    write(join(certifier,requestPath),requestBytes);git(certifier,'add','.');
    git(certifier,'-c','user.name=Synthetic offline fixture','-c','user.email=fixture@example.invalid','commit','-m',`SYNTHETIC exact source request ${generation.name}`);
    const sha=git(certifier,'rev-parse','HEAD'),tree=git(certifier,'rev-parse','HEAD^{tree}');
    const review={reviewed_commit:sha,tree_sha:tree,request:{path:requestPath,git_blob_sha:git(certifier,'rev-parse',`HEAD:${requestPath}`),
      raw_sha256:sha256(requestBytes),canonical_sha256:digest(JSON.parse(requestBytes)),source:generation.source}};
    if(generation.name==='gen1')trust.reviewed_requests.push(review);
    const certificateDir=join(output,`${generation.name}-certificate`),input=join(output,`${generation.name}-certificate-input.json`);
    write(input,{certifier_code_root:certifier,certifier_code_sha:sha,request_path:generation.request_path,
      api_evidence_path:generation.api_evidence_path,source_zip:generation.source_zip,
      evaluated_at:new Date(Date.parse(generation.evaluated_at)+600000).toISOString(),
      reference:{run_id:1000+manifest.generations.indexOf(generation),run_attempt:1,job_id:11000+manifest.generations.indexOf(generation),artifact_id:12000+manifest.generations.indexOf(generation)}});
    f.run(f.python,[f.builder,'certify','--source',generation.source_root,'--output',certificateDir,'--config',input],{extra:{PYTHONPATH:join(f.checkout,'backend')},timeout:180000});
    generation.certification=read(join(certificateDir,'result.json'));generation.certificate_zip=join(certificateDir,'certificate.zip');generation.review=review;
    f.registration(generation.source,read(generation.api_evidence_path));
    f.config.zips[`${prefix}/actions/artifacts/${generation.source.artifact_id}/zip`]=generation.source_zip;
  }
  const initial=manifest.generations[0],priorIdentity=`1/1/${sha256('SYNTHETIC preactivation receipt')}/${sha256('SYNTHETIC preactivation manifest')}`;
  write(join(f.checkout,financialReleasePolicy.request_path),{schema_version:'financial-release-request-v1',correction:{schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,
    previous_publication_identity:priorIdentity,source:initial.source},source_validation:{guard:'certified_source_artifact_v1',certificate:initial.certification.reference},
    destination_projection:{projector:'native_annual_destination_v1',policy:'financial-correction-native-annual-v1'}});
  write(trustPath,trust);f.commit('SYNTHETIC exact source certificate reviews and original activation request',
    ['contracts/financial_source_certification_trust_v1.json',financialReleasePolicy.request_path]);
  f.setUi(f.head);f.setSources(manifest);f.checkpoint('Built real original journals, cumulative archives, certificate projections and exact Git reviews',
    {generations:manifest.generations.map(g=>({name:g.name,source_archive_sha256:g.source.archive_manifest_sha256,source_zip_sha256:g.source.artifact_sha256,certifier_sha:g.review.reviewed_commit}))});
  return manifest;
}

export function registerSourceCertification(f,generation){
  const result=generation.certification,reference=result.reference;
  assert.ok(reference,'Builder must return its exact certificate reference');
  const certificate=result.certificate;
  const evaluated=certificate.evaluated_at,start=new Date(Date.parse(evaluated)-60000).toISOString(),end=new Date(Date.parse(evaluated)+60000).toISOString();
  const run=f.workflow(reference.run_id,reference.workflow,reference.head_sha,{branch:'preview/financial-source-certification',start});
  const artifact={...f.artifact(generation.certificate_zip,reference.artifact_id,reference.artifact_name,reference.run_id,reference.head_sha),created_at:evaluated,
    workflow_run:{id:reference.run_id,head_sha:reference.head_sha,head_branch:'preview/financial-source-certification',repository_id:7,head_repository_id:7}};
  f.registration(reference,{run,jobs:[{id:reference.job_id,name:'certify-source-artifacts',run_id:reference.run_id,run_attempt:1,
    head_sha:reference.head_sha,status:'completed',conclusion:'success',started_at:start,completed_at:end}],artifacts:[artifact]});f.save();
}

export function seedGenuineSourcePublication(f){
  const generation=f.sources.generations.find(g=>g.name==='gen1');assert.ok(generation);
  registerSourceCertification(f,generation);
  const frontend=join(f.checkout,'frontend'),publicRoot=join(frontend,'public'),root=join(publicRoot,'static-data');
  rmSync(root,{recursive:true,force:true});mkdirSync(root,{recursive:true});
  const rows=read(generation.base_path).rows.map(row=>({...row,as_of_date:sourceDate,company_name:`SYNTHETIC ${row.symbol} Corporation`,quoteType:'EQUITY',current_volume:1000000}));
  write(join(root,'manifest.json'),{as_of_date:sourceDate,default_market:'US',supported_markets:['US'],generated_at:f.now,
    markets:{US:{market:'US',as_of_date:sourceDate,pages:{scan:{path:'scan.json'}},assets:{charts:{path:'charts-index.json'}}}}});
  write(join(root,'scan.json'),{as_of_date:sourceDate,initial_rows:rows,preview_rows:rows,chunks:[{path:'chunk.json'}]});
  write(join(root,'chunk.json'),{as_of_date:sourceDate,rows});
  write(join(root,'charts-index.json'),{market:'US',symbols:rows.map(row=>({symbol:row.symbol,path:`charts/${row.symbol}.json`}))});
  write(join(root,'book-benchmark.json'),{symbol:'SPY',as_of_date:sourceDate,bars:bars(sourceDate,400)});
  write(join(root,'sector-prices.json'),{as_of_date:sourceDate,series:{}});
  for(const row of rows){const chart={symbol:row.symbol,market:'US',as_of_date:sourceDate,bars:bars(sourceDate,row.current_price),stock_data:row,fundamentals:{...row},eps_line:[]};
    write(join(root,`charts/${row.symbol}.json`),chart);write(join(root,`raw/${row.symbol}.json`),chart);}
  write(join(root,'financial-history.json'),{as_of_date:sourceDate,results:Object.fromEntries(rows.map(row=>[row.symbol,{symbol:row.symbol,annual:[],quarterly:[]}]))});
  write(join(root,'candidate-history/index.json'),{schema_version:1,snapshots:[]});
  f.exportData(frontend);
  // Establish the first ordinary daily observation before this source-only
  // activation. Its unknown financial state is retained as historical fact.
  f.run(process.execPath,['tools/record-candidate-history.mjs'],{cwd:frontend});
  f.exportData(frontend);
  const target=f.targetBase(publicRoot,join(f.root,'seed-target-base.json'));
  const priorIdentity=`1/1/${sha256('SYNTHETIC preactivation receipt')}/${sha256('SYNTHETIC preactivation manifest')}`;
  const summary=JSON.parse(f.run(f.python,[join(f.checkout,'backend/app/scripts/export_native_annual_projection.py'),
    '--archive',join(generation.source_root,'archive'),'--archive-sha256',generation.source.archive_manifest_sha256,
    '--base',generation.base_path,'--cohort',generation.cohort_path,'--cohort-sha256',generation.source.cohort_sha256,
    '--target-base',target,'--target-base-sha256',hashFile(target),'--target-publication-identity',priorIdentity,
    '--evaluated-at',f.now,'--output-dir',join(f.root,'seed-projection')],{extra:{PYTHONPATH:join(f.checkout,'backend')}}));
  const correctionEnv={FINANCIAL_CORRECTION_PROJECTION:summary.projection_path,FINANCIAL_CORRECTION_SHA256:summary.projection_sha256,
    FINANCIAL_CORRECTION_TARGET_IDENTITY:priorIdentity,FINANCIAL_CORRECTION_TARGET_BASE_SHA256:hashFile(target)};
  f.exportData(frontend,correctionEnv);
  f.run(process.execPath,['tools/record-candidate-history.mjs'],{cwd:frontend,extra:{FINANCIAL_EVALUATED_AT:f.now,...correctionEnv}});
  write(join(publicRoot,'index.html'),'<!doctype html><title>SYNTHETIC approved renewal lifecycle UI</title>');
  write(join(publicRoot,'sw.js'),'// SYNTHETIC immutable approved worker\n');
  const approval=f.ci(f.uiSha,100,{design:true});
  // This seed models an already approved ordinary activation. Its source and
  // projection are real production proofs; first activation itself remains a
  // separate integration concern, with no claim of a real Design run here.
  const input=join(f.root,'seed-input.json');write(input,{publicRoot,summary,target,priorIdentity,source:generation.source,certificate:generation.certification.reference,approval,now:f.now,uiSha:f.uiSha});
  f.evaluate(`import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
    import {sourceLineage,writeFinancialReleaseReceipt,financialReleasePolicy} from './.github/scripts/financial-release-activation.mjs';
    import {verifyCorrectionSource,verifyCorrectionConsumerChecks,dataInventory} from './.github/scripts/financial-correction.mjs';
    import {githubApi} from './.github/scripts/publication-gate.mjs';
    import {bootstrap,inventoryDigest,sha256,uiInventory,validateReceipt} from './.github/scripts/publication-state.mjs';
    import {extractPriceObservations,comparePriceObservations,priceObservationDigest} from './.github/scripts/price-observations.mjs';
    import {packPublication} from './.github/scripts/static-transport-publication.mjs';
    const p=JSON.parse(readFileSync(${JSON.stringify(input)})),projectionBytes=readFileSync(p.summary.projection_path),projection=JSON.parse(projectionBytes),baseBytes=readFileSync(p.target);
    verifyCorrectionSource(p.source,githubApi,{reference:p.certificate,certificateZipPath:${JSON.stringify(generation.certificate_zip)}});
    const lineage=sourceLineage({source:p.source,certificate:p.certificate,sourceProjectionSha256:sha256(projectionBytes),receiptInventorySha256:projection.receipt_inventory_sha256,projectionPolicy:projection.policy});
    const checks=verifyCorrectionConsumerChecks({uiSha:p.uiSha,approval:p.approval},bootstrap.repository);
    const manifestBytes=readFileSync(join(p.publicRoot,'static-data/manifest.json')),manifest=JSON.parse(manifestBytes),ui=uiInventory(p.publicRoot);
    const prices=extractPriceObservations({dataRoot:join(p.publicRoot,'static-data'),manifest}),known=comparePriceObservations(prices,bootstrap.approved_price_observations).knownDates;
    const prepared=writeFinancialReleaseReceipt({dist:p.publicRoot,mode:'activation',previousIdentity:p.priorIdentity,lineage,
      sourceProjectionBytes:projectionBytes,sourceBaseBytes:baseBytes,evaluationBytes:projectionBytes,generation:projection.financial_generation,evaluatedAt:p.now,
      ui:{approved_sha:p.uiSha,captured_sha:p.uiSha,digest:inventoryDigest(ui),approval:p.approval,checks},
      priceInput:{artifact_id:9,artifact_sha256:sha256('SYNTHETIC activation input'),manifest_sha256:sha256(manifestBytes),price_observations_sha256:priceObservationDigest(prices),known_price_dates_sha256:priceObservationDigest(known)},
      candidate:{repository:bootstrap.repository,workflow:financialReleasePolicy.candidate_workflow,head_sha:p.uiSha,run_id:101,run_attempt:1,job_id:1010,artifact_id:10,artifact_name:'financial-release-candidate-101-1',artifact_sha256:sha256('SYNTHETIC activation artifact'),candidate_receipt_sha256:sha256('SYNTHETIC activation preview'),record_sha256:sha256('SYNTHETIC activation record')}});
    const publication=validateReceipt({schema:1,run_id:300,run_attempt:1,artifact_name:'github-pages-300-1',controller_sha:p.uiSha,ui_sha:p.uiSha,ui_files:ui,ui_digest:inventoryDigest(ui),approval:p.approval,
      data_manifest_sha256:sha256(manifestBytes),price_observations:prices,known_price_dates:known,
      verification_universe:{as_of_date:${JSON.stringify(sourceDate)},required_symbols:['AMD','NVDA'],minimum_target:.9,total:2,verified:2},
      financial_release:prepared.reference,financial_generation:projection.financial_generation,financial_lineage_sha256:lineage.id,data_inventory_sha256:inventoryDigest(dataInventory(p.publicRoot))});
    writeFileSync(join(p.publicRoot,'publication.json'),JSON.stringify(publication));
    await packPublication({root:p.publicRoot,frontendRoot:${JSON.stringify(frontend)},publication,bindings:{sourceCommit:p.uiSha,appCommit:p.uiSha,candidateId:sha256('SYNTHETIC activation')}});
  `);
  const live=f.deploy(publicRoot,300);git(f.checkout,'restore','--worktree','--','frontend/public');f.setSeed({live,generation,summary,target,priorIdentity});
  f.checkpoint('Seeded ordinary approved UI with real archive-backed certified source and native projection',{publication_identity:live.identity,financial_generation:live.financialRelease.financial_generation});
  return live;
}

export function prepareGenuineRenewal(f,{generation='gen2',runId=400,evaluatedAt='2026-10-05T13:00:00.000Z'}={}){
  const next=f.sources.generations.find(g=>g.name===generation);assert.ok(next);
  f.setTime(evaluatedAt);f.setRun(runId);registerSourceCertification(f,next);
  const live=f.readLive(),predecessor=structuredClone(f.latestArtifact),baseline=join(f.root,`request-baseline-${runId}`);
  const publicRoot=join(f.checkout,'frontend/public');
  f.evaluate(`import {cpSync,mkdirSync,rmSync} from 'node:fs';import {join} from 'node:path';
    import {canonicalPublication} from './.github/scripts/static-transport-publication.mjs';
    const physical=${JSON.stringify(f.liveRoot)},logical=await canonicalPublication({root:physical,frontendRoot:${JSON.stringify(join(f.checkout,'frontend'))},publication:${JSON.stringify(live.receipt)},restore:${JSON.stringify(baseline)}});
    rmSync(${JSON.stringify(publicRoot)},{recursive:true,force:true});cpSync(logical,${JSON.stringify(publicRoot)},{recursive:true});rmSync(${JSON.stringify(join(publicRoot,'publication.json'))},{force:true});`);
  f.exportData(join(f.checkout,'frontend'));
  const target=f.targetBase(publicRoot,join(f.root,`target-base-${runId}.json`));
  git(f.checkout,'restore','--worktree','--','frontend/public');
  const priceInput={artifact_id:predecessor.id,artifact_sha256:predecessor.digest.slice(7),manifest_sha256:live.manifestHash,
    price_observations_sha256:priceObservationDigest(live.priceObservations),known_price_dates_sha256:priceObservationDigest(live.knownPriceDates)};
  const request={schema_version:'financial-source-renewal-request-v1',previous_publication_identity:live.identity,previous_release:live.receipt.financial_release,
    previous_lineage_sha256:live.financialRelease.lineage_sha256,previous_financial_generation:live.financialRelease.financial_generation,
    origin_release:live.financialRelease.renewal?.origin||live.receipt.financial_release,
    ui:{sha:live.uiSha,digest:live.uiDigest,approval_sha256:digest(live.approval)},consumer_code_sha256:digest(consumerCodeInventory(protectedCodeInventory(f.checkout,f.uiSha))),
    financial_request:{schema_version:'financial-release-request-v1',correction:{schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,
      previous_publication_identity:live.identity,source:next.source},source_validation:{guard:'certified_source_artifact_v1',certificate:next.certification.reference},
      destination_projection:{projector:'native_annual_destination_v1',policy:'financial-correction-native-annual-v1'}},
    target:{evaluated_at:evaluatedAt,base_sha256:hashFile(target),manifest_sha256:live.manifestHash,price_observations_sha256:priceInput.price_observations_sha256,
      known_price_dates_sha256:priceInput.known_price_dates_sha256,universe_sha256:digest(live.verificationUniverse)},price_input:priceInput,maximum_new_receipts:4};
  for(const key of ['pin','intent'])rmSync(join(f.checkout,renewalPolicy[`${key}_path`]),{force:true});
  const trustPath='contracts/financial_source_certification_trust_v1.json',trust=read(join(f.checkout,trustPath));
  assert.equal(trust.reviewed_requests.some(review=>review.tree_sha===next.review.tree_sha),false,'each generation receives one finite new exact source review');
  trust.reviewed_requests.push(next.review);write(join(f.checkout,trustPath),trust);
  write(join(f.checkout,renewalPolicy.request_path),request);
  const a=f.commit(`SYNTHETIC renewal ${runId} stage A: exact new source review and request before seal`,[trustPath,renewalPolicy.request_path,renewalPolicy.pin_path,renewalPolicy.intent_path].filter(path=>existsSync(join(f.checkout,path))||git(f.checkout,'ls-files',path)));
  f.ci(a,runId+10000);f.save();
  rmSync(join(f.env.RUNNER_TEMP,'financial-source-renewal-certification'),{recursive:true,force:true});
  for(const command of ['prepare','verify-source','verify-surfaces','verify-bounds','seal'])f.certifyCommand(command);
  const candidate=join(f.env.RUNNER_TEMP,'financial-source-renewal-certification/prepared'),record=read(join(candidate,'candidate.json'));
  const tar=join(dirname(candidate),'candidate.tar'),zip=join(f.root,`renewal-${runId}.zip`);
  f.run(f.python,['-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:z.write(sys.argv[2],"candidate.tar")',zip,tar]);
  const pin={schema_version:'financial-source-renewal-pin-v1',repository,workflow:renewalPolicy.workflow,head_sha:a,run_id:runId,run_attempt:1,job_id:runId*10,
    artifact_id:runId+60000,artifact_name:`financial-source-renewal-${runId}-1`,artifact_sha256:hashFile(zip),candidate_record_sha256:hashFile(join(candidate,'candidate.json')),request_sha256:digest(request)};
  const intent={schema_version:'financial-source-renewal-intent-v1',kind:'same-ui-same-price-financial-source-renewal',request_sha256:digest(request),pin_sha256:digest(pin),
    previous_publication_identity:live.identity,not_after:new Date(Date.parse(evaluatedAt)+3600000).toISOString()};
  write(join(f.checkout,renewalPolicy.pin_path),pin);write(join(f.checkout,renewalPolicy.intent_path),intent);
  const b=f.commit(`SYNTHETIC renewal ${runId} stage B: exact sealed pin and explicit intent`,[renewalPolicy.pin_path,renewalPolicy.intent_path]);f.ci(b,runId+11000);
  const review={controller_sha:b,controller_tree:git(f.checkout,'rev-parse',`${b}^{tree}`),certification_sha:a,certification_tree:git(f.checkout,'rev-parse',`${a}^{tree}`),
    protected_code_sha256:digest(renewalControllerCodeInventory(protectedCodeInventory(f.checkout,b))),
    ...Object.fromEntries(Object.entries({request,pin,intent}).flatMap(([key,value])=>[[`${key}_sha256`,digest(value)],[`${key}_raw_sha256`,hashFile(join(f.checkout,renewalPolicy[`${key}_path`]))]]))};
  const path='contracts/financial_source_renewal_v1.json',registry=read(join(f.checkout,path));registry.publication_enabled=true;registry.reviewed_controllers.push(review);write(join(f.checkout,path),registry);
  const c=f.commit(`SYNTHETIC renewal ${runId} stage C: append finite exact review`,[path]);f.ci(c,runId+12000);
  const end=new Date(Date.parse(evaluatedAt)+60000).toISOString(),artifact=f.artifact(zip,pin.artifact_id,pin.artifact_name,runId,a);
  f.registration(pin,{run:f.workflow(runId,renewalPolicy.workflow,a,{event:'workflow_dispatch',start:evaluatedAt}),jobs:[{id:pin.job_id,run_id:runId,run_attempt:1,head_sha:a,
    name:renewalPolicy.job,status:'completed',conclusion:'success',started_at:evaluatedAt,completed_at:end,steps:renewalPolicy.steps.map(name=>({name,conclusion:'success'}))}],artifacts:[artifact]});
  f.setTime(new Date(Date.parse(evaluatedAt)+120000).toISOString());f.setRun(runId+1);
  write(f.env.GITHUB_EVENT_PATH,{inputs:{financial_source_renewal:JSON.stringify(intent)}});
  f.restoreReleaseCode();f.save();
  f.checkpoint(`Certified and reviewed genuine ${generation}`,{a,b,c,record_sha256:pin.candidate_record_sha256,source_delta:read(join(candidate,'source-delta.json'))});
  return {generation:next,live,predecessor,request,pin,intent,record,candidate,zip,a,b,c,review,artifact,runId};
}

export function publishGenuineRenewal(f,prepared,{beforeDeploy}={}){
  f.command('plan');assert.equal(f.state().decision.mode,'renewal');
  f.command('restore');f.command('compose');f.command('recheck');f.command('recheck');
  const dist=join(f.checkout,'release/frontend/dist'),publication=read(join(dist,'publication.json'));
  assert.equal(publication.ui_digest,prepared.live.uiDigest);assert.deepEqual(publication.price_observations,prepared.live.priceObservations);
  beforeDeploy?.({dist,publication,state:f.state()});
  const live=f.deploy(dist,prepared.runId+1);assert.equal(live.financialRelease.mode,'renewal');
  assert.equal(live.financialRelease.source_projection.sha256,prepared.record.source_projection_sha256);
  assert.equal(live.financialRelease.renewal.origin.sha256,f.seed.live.receipt.financial_release.sha256);
  f.checkpoint(`Published SYNTHETIC ${prepared.generation.name} through real CLI`,{publication_identity:live.identity,transitions:live.financialRelease.renewal.transitions.length});return live;
}

// Exercise only the production candidate dispatcher and published decoder. The
// sidecar is never transplanted into the closed browser preview bootstrap.
export function verifyNestedRenewalBytes(f,prepared,dist=null){
  const report=join(f.root,`nested-byte-proof-${prepared.runId}${dist?'-published':''}.json`);
  f.evaluate(`import assert from 'node:assert/strict';import {readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';import {join} from 'node:path';
    import {verifyCandidateTransport} from './.github/scripts/financial-release-activation.mjs';
    import {verifyTransportPublication,validateTransportPreview} from './.github/scripts/static-transport-publication.mjs';
    import {financialAuditInventory} from './.github/scripts/financial-audit-history.mjs';
    import {AUDIT_TRANSPORT_PREFIX} from './.github/scripts/financial-audit-transport.mjs';
    import {sha256,inventoryDigest} from './.github/scripts/publication-state.mjs';
    const root=${JSON.stringify(f.checkout)},candidate=${JSON.stringify(prepared.candidate)},dist=${JSON.stringify(dist)};
    const record=JSON.parse(readFileSync(join(candidate,'candidate.json'))),sidecar=JSON.parse(readFileSync(join(candidate,'transport.json'))),physical=join(candidate,'corrected');
    const preview=JSON.parse(readFileSync(join(physical,'publication.json')));validateTransportPreview(preview);
    assert.deepEqual(Object.keys(preview).sort(),['schema','publication_authority','ui_sha','ui_digest','data_manifest_sha256','transport'].sort());
    assert.equal(sidecar.schema_version,'financial-renewal-candidate-transport-v1');assert.equal(sha256(readFileSync(join(candidate,'transport.json'))),record.transport_sha256);
    const restore=join(candidate,'..','fixture-verified-nested-${prepared.runId}');rmSync(restore,{recursive:true,force:true});
    const before=await verifyCandidateTransport(root,candidate,record,{restore});assert.ok(before.checked.auditTransport);
    const history=JSON.parse(readFileSync(join(candidate,'history-inventory.json')));
    assert.deepEqual(sidecar.financial_audit.financial_audit_files,history);
    assert.deepEqual(financialAuditInventory(restore),history);
    let retainedBytes=0;
    for(const [path,hash]of Object.entries(history)){
      const original=readFileSync(join(candidate,'baseline',path)),decoded=readFileSync(join(restore,path));
      assert.equal(sha256(original),hash);assert.deepEqual(decoded,original,'candidate changed original audit bytes '+path);retainedBytes+=original.length;
      if(/\\/(?:source-projection|source-base|carry-projection)-/.test(path))assert.equal(existsSync(join(physical,path)),false,'nested audit must have a single physical representation');
    }
    const encoded=files=>Object.fromEntries(Object.entries(files).filter(([path])=>path.startsWith('static-data/_transport/gzip/')).map(([path,entry])=>[path,entry.sha256]));
    const outer=encoded(before.checked.physicalInventory),inner=encoded(before.checked.auditTransport.physicalInventory);
    assert.ok(Object.keys(outer).length>0);assert.ok(Object.keys(inner).length>0);
    const result={schema_version:'synthetic-nested-renewal-byte-proof-v1',authority:'none',sidecar_sha256:record.transport_sha256,
      retained_audit_files:Object.keys(history).length,retained_audit_bytes:retainedBytes,outer_payloads:outer,inner_payloads:inner,
      logical_inventory_sha256:inventoryDigest(Object.fromEntries(Object.entries(before.checked.logicalInventory).map(([path,item])=>[path,item.sha256])))};
    if(dist){
      const publication=JSON.parse(readFileSync(join(dist,'publication.json'))),finalRoot=join(candidate,'..','fixture-verified-final-${prepared.runId}');rmSync(finalRoot,{recursive:true,force:true});
      const after=await verifyTransportPublication({root:dist,frontendRoot:join(root,'frontend'),publication,restore:finalRoot});assert.ok(after.auditTransport);
      const finalOuter=encoded(after.physicalInventory),finalInner=encoded(after.auditTransport.physicalInventory);
      assert.deepEqual(finalOuter,outer,'final publication changed captured outer payload inventory');
      for(const path of Object.keys(outer))assert.deepEqual(readFileSync(join(dist,path)),readFileSync(join(physical,path)),'final publication changed outer payload bytes');
      for(const [path,hash]of Object.entries(inner)){
        assert.equal(finalInner[path],hash,'final publication lost an original inner payload');
        assert.deepEqual(readFileSync(join(dist,AUDIT_TRANSPORT_PREFIX,path)),readFileSync(join(physical,AUDIT_TRANSPORT_PREFIX,path)),'final publication changed inner payload bytes');
      }
      for(const path of Object.keys(history))assert.deepEqual(readFileSync(join(finalRoot,path)),readFileSync(join(restore,path)),'final publication changed original decoded audit bytes');
      const release=JSON.parse(readFileSync(join(finalRoot,publication.financial_release.path)));
      assert.deepEqual(readFileSync(join(finalRoot,release.source_projection.path)),readFileSync(join(candidate,'projection','native-annual-projection-'+record.source_projection_sha256+'.json')),'final publication changed exact new source projection bytes');
      assert.deepEqual(readFileSync(join(finalRoot,release.source_base.path)),readFileSync(join(candidate,'target-base.json')),'final publication changed exact source-base bytes');
      result.final_outer_payloads=finalOuter;result.final_inner_payloads=finalInner;result.original_outer_bytes_unchanged=true;result.original_inner_bytes_unchanged=true;result.original_source_bytes_unchanged=true;
      rmSync(finalRoot,{recursive:true,force:true});
    }
    rmSync(restore,{recursive:true,force:true});writeFileSync(${JSON.stringify(report)},JSON.stringify(result));`);
  const result=read(report);f.checkpoint(`Verified ${prepared.generation.name} nested audit ${dist?'publication':'candidate'} bytes`,{
    source_audit_files:result.retained_audit_files,source_audit_bytes:result.retained_audit_bytes,outer_payloads:Object.keys(result.outer_payloads).length,
    inner_payloads:Object.keys(result.inner_payloads).length,...(dist?{original_source_bytes_unchanged:true,original_outer_payloads_unchanged:true,original_inner_payloads_unchanged:true}:{})});
  return result;
}

export function carryGenuineRenewal(f,{date='2026-10-05',evaluatedAt='2026-10-06T11:00:00.000Z',runId=500}={}){
  const previous=f.readLive(),originRequest=readFileSync(join(f.checkout,financialReleasePolicy.request_path));
  // The saved transition supplies historical authority after operational intent
  // removal. Original activation request remains exactly where the real repo
  // keeps it, so the planner must recognize the retained original activation.
  rmSync(join(f.checkout,renewalPolicy.intent_path));
  f.commit('SYNTHETIC ordinary carry removes completed renewal intent',[renewalPolicy.intent_path]);f.ci(f.head,runId+12000);
  write(f.env.GITHUB_EVENT_PATH,{inputs:{}});f.setTime(evaluatedAt);f.setRun(runId);
  const frontend=f.restoreReleaseCode(),publicRoot=join(frontend,'public'),logical=join(f.root,`carry-source-${runId}`);
  const previousRoot=f.liveRoot;
  f.evaluate(`import {readFileSync,cpSync,rmSync} from 'node:fs';import {canonicalPublication} from './.github/scripts/static-transport-publication.mjs';
    const root=${JSON.stringify(previousRoot)},publication=JSON.parse(readFileSync(root+'/publication.json'));
    const logical=await canonicalPublication({root,frontendRoot:${JSON.stringify(frontend)},publication,restore:${JSON.stringify(logical)}});
    rmSync(${JSON.stringify(publicRoot)},{recursive:true,force:true});cpSync(logical,${JSON.stringify(publicRoot)},{recursive:true});rmSync(${JSON.stringify(join(publicRoot,'publication.json'))},{force:true});`);
  const data=join(publicRoot,'static-data'),manifest=read(join(data,'manifest.json')),market=manifest.markets.US;
  const sourceProjection=readFileSync(join(data,'..',previous.financialRelease.source_projection.path),'utf8');
  const priorAudit=Object.fromEntries(readdirSync(join(data,'financial-corrections')).map(path=>[path,hashFile(join(data,'financial-corrections',path))]));
  const historyBytes=readFileSync(join(data,'candidate-history/index.json'));
  const shift=value=>{value.as_of_date=date;for(const key of ['rows','initial_rows','preview_rows','results','stocks','members'])if(Array.isArray(value[key]))for(const row of value[key])row.as_of_date=date;return value;};
  const scan=read(join(data,market.pages.scan.path));write(join(data,market.pages.scan.path),shift(scan));
  for(const {path} of scan.chunks||[])write(join(data,path),shift(read(join(data,path))));
  // These are containing price-date scopes. The original getter observations,
  // period endpoints, payloads and receipt clocks remain exactly as acquired.
  const historyPath=join(data,'financial-history.json'),history=read(historyPath);
  const sourceClocks=value=>Object.fromEntries(Object.entries(value.results).map(([symbol,item])=>[symbol,
    Object.fromEntries(Object.entries(item).filter(([key])=>key.includes('retrieved')||key.includes('observed')||key==='annual_source'))]));
  const beforeClocks=sourceClocks(history);history.as_of_date=date;
  for(const item of Object.values(history.results))item.as_of_date=date;
  write(historyPath,history);assert.deepEqual(sourceClocks(read(historyPath)),beforeClocks);
  const sectors=read(join(data,'sector-prices.json'));sectors.as_of_date=date;write(join(data,'sector-prices.json'),sectors);
  const excluded=new Set(['candidate-history','candidate-performance-history','financial-corrections','financial-lineage']);
  const advanced={};
  function visit(root){for(const item of readdirSync(root,{withFileTypes:true})){
    const path=join(root,item.name);if(item.isDirectory()){if(!excluded.has(item.name))visit(path);continue;}
    if(!item.name.endsWith('.json'))continue;const value=read(path);
    if(!Array.isArray(value?.bars)||!['AMD','NVDA','SPY'].includes(value.symbol??value.stock_data?.symbol))continue;
    const old=structuredClone(value.bars);assert.ok(old.length>=252);
    value.bars.push({...old.at(-1),date});value.as_of_date=date;
    for(const key of ['stock_data','fundamentals'])if(value[key])value[key].as_of_date=date;
    write(path,value);assertSyntheticPriceAdvance(old,read(path).bars,date);advanced[path.slice(data.length+1)]={old,after:value.bars};
  }}visit(data);
  assert.ok(Object.keys(advanced).length>=2);market.as_of_date=date;manifest.as_of_date=date;manifest.generated_at=evaluatedAt;write(join(data,'manifest.json'),manifest);
  f.exportData(frontend);assert.deepEqual(readFileSync(join(data,'candidate-history/index.json')),historyBytes);
  for(const [path,hash]of Object.entries(priorAudit))assert.equal(hashFile(join(data,'financial-corrections',path)),hash);
  const zip=f.archive(publicRoot,`next-price-${runId}`),exportRun=runId+1;
  const asset=f.artifact(zip,runId+60000,`static-site-data-${exportRun}-1`,exportRun,f.head),manifestBytes=readFileSync(join(data,'manifest.json'));
  const observations=extractPriceObservations({dataRoot:data,manifest:JSON.parse(manifestBytes)}),metadata=join(f.root,`next-price-${runId}.json`),metadataZip=join(f.root,`next-price-metadata-${runId}.zip`);
  write(metadata,{run_id:exportRun,run_attempt:1,source_sha:f.head,artifact_name:asset.name,manifest_json:manifestBytes.toString(),manifest_sha256:sha256(manifestBytes),price_observations:observations,price_observations_sha256:priceObservationDigest(observations)});
  f.run(f.python,['-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:z.write(sys.argv[2],"source.json")',metadataZip,metadata]);
  const companion=f.artifact(metadataZip,runId+60001,`static-site-data-manifest-${exportRun}-1`,exportRun,f.head);
  f.registration({run_id:exportRun,run_attempt:1},{run:f.workflow(exportRun,'.github/workflows/static-site.yml',f.head,{event:'schedule'}),
    jobs:[{id:exportRun*10,name:'combine-and-build',run_id:exportRun,run_attempt:1,head_sha:f.head,status:'completed',conclusion:'success',started_at:evaluatedAt,completed_at:evaluatedAt,
      steps:[{name:'Build static frontend',conclusion:'success'}]}],artifacts:[asset,companion]});
  f.api[`${prefix}/actions/artifacts?per_page=100`]=[{artifacts:[asset,companion]}];
  rmSync(publicRoot,{recursive:true,force:true});f.command('plan');assert.ok(f.state().carry);assert.equal(f.state().activation,undefined);
  f.command('restore');f.command('prepare-carry');
  const carry=read(f.state().carry.projectionPath);assert.equal(carry.source_projection_json,sourceProjection,'carry refreshed original source projection bytes');
  const original=JSON.parse(sourceProjection);for(const [symbol,item]of Object.entries(original.symbols)){
    assert.deepEqual(carry.symbols[symbol].source_receipts,item.source_receipts);
    for(const key of ['p','t'])assert.deepEqual(carry.symbols[symbol].financial_current[key],item.financial_current[key]);
  }
  const carryEnv=Object.fromEntries(readFileSync(f.env.GITHUB_ENV,'utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
  f.exportData(frontend,carryEnv);f.run(process.execPath,['tools/record-candidate-history.mjs'],{cwd:frontend,extra:carryEnv});
  const dist=join(frontend,'dist');rmSync(dist,{recursive:true,force:true});cpSync(publicRoot,dist,{recursive:true});
  for(const path of Object.keys(previous.uiFiles))write(join(dist,path),readFileSync(join(previousRoot,path)));
  f.command('compose');f.command('recheck');f.command('recheck');
  f.evaluate(`import assert from 'node:assert/strict';import {readFileSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';
    import {verifyTransportPublication} from './.github/scripts/static-transport-publication.mjs';
    import {AUDIT_TRANSPORT_PREFIX} from './.github/scripts/financial-audit-transport.mjs';
    const previous=${JSON.stringify(previousRoot)},dist=${JSON.stringify(dist)},roots=[previous,dist],verified=[];
    try{
      for(let i=0;i<roots.length;i++){
        const publication=JSON.parse(readFileSync(join(roots[i],'publication.json'))),restore=${JSON.stringify(join(f.root,`carry-byte-proof-${runId}`))}+'-'+i;
        rmSync(restore,{recursive:true,force:true});
        const checked=await verifyTransportPublication({root:roots[i],frontendRoot:${JSON.stringify(frontend)},publication,restore});
        assert.ok(checked.auditTransport);verified.push({publication,restore,checked});
      }
      const [before,after]=verified;
      for(const [path,hash]of Object.entries(before.publication.financial_audit_files)){
        assert.equal(after.publication.financial_audit_files[path],hash,'carry removed original audit map entry');
        assert.deepEqual(readFileSync(join(after.restore,path)),readFileSync(join(before.restore,path)),'carry changed original audit bytes');
      }
      let innerPayloads=0;
      for(const [path,entry]of Object.entries(before.checked.auditTransport.physicalInventory))if(path.startsWith('static-data/_transport/gzip/')){
        assert.equal(after.checked.auditTransport.physicalInventory[path]?.sha256,entry.sha256,'carry changed original nested payload hash');
        assert.deepEqual(readFileSync(join(dist,AUDIT_TRANSPORT_PREFIX,path)),readFileSync(join(previous,AUDIT_TRANSPORT_PREFIX,path)),'carry changed original nested encoded bytes');innerPayloads++;
      }
      assert.ok(innerPayloads>0);
      writeFileSync(${JSON.stringify(join(f.root,`nested-carry-byte-proof-${runId}.json`))},JSON.stringify({schema_version:'synthetic-nested-carry-byte-proof-v1',authority:'none',
        retained_audit_files:Object.keys(before.publication.financial_audit_files).length,retained_inner_payloads:innerPayloads,original_source_bytes_unchanged:true,original_inner_bytes_unchanged:true}));
    }finally{for(const item of verified)rmSync(item.restore,{recursive:true,force:true});}`);
  const live=f.deploy(dist,runId);assert.equal(live.financialRelease.mode,'carry');
  for(const key of ['lineage','source_projection','source_base','renewal'])assert.deepEqual(live.financialRelease[key],previous.financialRelease[key]);
  assert.equal(live.uiDigest,previous.uiDigest);assert.deepEqual(readFileSync(join(f.checkout,financialReleasePolicy.request_path)),originRequest);
  for(const symbol of ['AMD','NVDA'])assert.equal(live.priceObservations[JSON.stringify(['US','chart',symbol])],date);
  f.checkpoint('Real next-price carry preserved complete renewal chain after intent removal',{publication_identity:live.identity,advanced_chart_aliases:Object.keys(advanced).length,prior_ohlcv_prefixes_retained:true});
  return {live,previous,advanced,sourceProjection};
}
