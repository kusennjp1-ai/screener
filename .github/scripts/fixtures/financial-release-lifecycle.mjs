// Offline controller fixture. Only GitHub/Pages transport and the wall clock
// are replaced; exports, ZIPs, source assets, ledgers and receipts are real.
import assert from 'node:assert/strict';
import {chmodSync,cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {bootstrap,inventoryDigest,sha256,uiInventory,validateReceipt} from '../publication-state.mjs';
import {contract,dataInventory,digest,verifyCorrectionConsumerChecks} from '../financial-correction.mjs';
import {comparePriceObservations,extractPriceObservations,priceObservationDigest} from '../price-observations.mjs';
import {financialReleasePolicy,sourceLineage,writeFinancialReleaseReceipt} from '../financial-release-activation.mjs';
import {CORRECTION_FIELDS,validateCorrectionProjection} from '../../../frontend/tools/financial-correction-overlay.mjs';
import {withFinancialProof} from '../../../frontend/src/static/testFinancialFixture.js';
import {nativeAnnualFixture} from '../../../frontend/src/test/fixtures/nativeAnnual.js';
import {certifiedSourceFixture} from './certified-source-preview.mjs';

const repoRoot=fileURLToPath(new URL('../../../',import.meta.url));
const controller=join(repoRoot,'.github/scripts/select-release-source.mjs');
const repository=bootstrap.repository,sha='b'.repeat(40),hash='a'.repeat(64);
export const sourceTime='2026-10-04T12:00:00.000Z',sourceDate='2026-10-02';
const sourceNow=Date.parse(sourceTime),day=86400000;
export const read=path=>JSON.parse(readFileSync(path,'utf8'));
const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
const row=(date,price)=>({symbol:'OWNED',market:'US',as_of_date:date,company_name:'Owned Corporation',quoteType:'EQUITY',current_price:price,adv_usd:35000000,current_volume:1000000,rs_rating:90,eps_growth_yy:999,eps_rating:99});

function projection(source) {
  const base=JSON.stringify({market:'US',as_of_date:sourceDate,rows:[row(sourceDate,100)]});
  const proof=withFinancialProof({symbol:'OWNED',eps_growth_qq:30,eps_growth_yy:40},sourceNow,sourceDate);
  const values=Object.fromEntries(CORRECTION_FIELDS.map(field=>[field,proof[field]??null]));
  values.eps_growth_quarterly=30;values.eps_growth_annual=40;values.eps_5yr_cagr=100;
  const annualTime=sourceNow-60*3600000,quarterTime=sourceNow-36*3600000;
  for(const tuple of Object.values(proof.financial_current.p)){tuple[4]=quarterTime;tuple[5]=quarterTime+7*day;}
  proof.financial_current.r=proof.financial_current.r.slice(0,5)+'0'+proof.financial_current.r.slice(6);
  proof.financial_current.p['5']=[100,'3','Diluted EPS',['2025-12-31','2024-12-31'],annualTime,annualTime+7*day,'g','a'];
  const receipts=[{attribute:'quarterly_income_stmt',receipt_sha256:'1'.repeat(64),capture_id:'original-quarterly',raw_payload_sha256:'2'.repeat(64),observed_at:new Date(quarterTime).toISOString()},
    {attribute:'income_stmt',receipt_sha256:'3'.repeat(64),capture_id:'original-annual',raw_payload_sha256:'4'.repeat(64),observed_at:new Date(annualTime).toISOString()}];
  const history={...nativeAnnualFixture('JPY'),symbol:'OWNED',as_of_date:sourceDate,retrieved_at:receipts[1].observed_at,
    quarterly_retrieved_at:receipts[0].observed_at,quarterly:[{end:'2025-06-30',eps:1,revenue:10},{end:'2026-06-30',eps:1.4,revenue:14}]};
  Object.assign(history.annual_source,receipts[1],{symbol:'OWNED'});
  const inventory=receipts.map(value=>({symbol:'OWNED',...value}));
  const originalPolicy={id:'financial-correction-explicit-ownership-v1',contract_sha256:'5'.repeat(64),projector_sha256:'6'.repeat(64)};
  const value={schema_version:'financial-statement-projection-v1',financial_generation:'7'.repeat(64),financial_evaluated_at:sourceTime,
    knowledge_basis:'current_observation_at_source_capture',point_in_time:false,source_publication_date:null,
    bindings:{archive_manifest_sha256:source.archive_manifest_sha256,acquisition_base_sha256:source.acquisition_base_sha256,cohort_sha256:source.cohort_sha256,
      target_publication_identity:`1/1/${hash}/${hash}`,target_base_sha256:sha256(base)},
    policy:{...originalPolicy,id:'financial-correction-native-annual-v1'},
    derivation:{schema_version:'native-annual-destination-derivation-v1',source_projection_sha256:'c'.repeat(64),source_policy:originalPolicy,source_receipt_inventory_sha256:digest(inventory)},
    receipt_inventory:inventory,receipt_inventory_sha256:digest(inventory),symbols:{OWNED:{market:'US',as_of_date:sourceDate,financial_values:values,financial_current:proof.financial_current,
      financial_source_evidence:{schema_version:1,fields:{}},financial_history:history,source_diagnostics:{},history_source_diagnostics:{},source_receipts:receipts}}};
  validateCorrectionProjection(value);
  return {base,value,bytes:JSON.stringify(value,null,2)};
}

function bars(date,price) {
  const dates=[];
  for(let time=Date.parse(date);dates.length<260;time-=day){const weekday=new Date(time).getUTCDay();if(weekday!==0&&weekday!==6)dates.unshift(new Date(time).toISOString().slice(0,10));}
  return dates.map((date,index)=>{const close=price*(0.8+0.2*index/259);return {date,open:close,high:close*1.01,low:close*0.99,close,volume:1000000};});
}

export function lifecycleFixture({controllerPath=controller,packedTransport=false}={}) {
  const root=mkdtempSync(join(tmpdir(),'financial-release-lifecycle-')),certificate=certifiedSourceFixture();
  const configPath=join(root,'remote.json'),preload=join(root,'transport.mjs'),bin=join(root,'bin');mkdirSync(bin);
  const config={api:{},zips:{},liveRoot:null},api=config.api,prefix=`repos/${repository}`;
  const run=(id,file,event='push')=>({id,run_attempt:1,head_sha:sha,path:`.github/workflows/${file}`,head_branch:'main',event,status:'completed',conclusion:'success',repository:{full_name:repository},head_repository:{full_name:repository}});
  const approval={type:'gates',sha,runs:[{id:10,attempt:1,path:'.github/workflows/ci.yml'},{id:11,attempt:1,path:'.github/workflows/design-acceptance.yml'}]};
  api[prefix]={full_name:repository,default_branch:'main'};api[`${prefix}/git/ref/heads/main`]={object:{sha}};
  for(const [id,file,names]of [[10,'ci.yml',contract.required_ci_jobs],[11,'design-acceptance.yml',[financialReleasePolicy.candidate_job]]]){
    const value=run(id,file);api[`${prefix}/actions/runs/${id}/attempts/1`]=value;
    api[`${prefix}/actions/runs/${id}/attempts/1/jobs?per_page=100`]=[{jobs:names.map((name,index)=>({id:id*10+index,name,run_attempt:1,status:'completed',conclusion:'success'}))}];
    // No current-main UI gates: ordinary data releases retain the approved UI.
    api[`${prefix}/actions/workflows/${file}/runs?branch=main&event=push&head_sha=${sha}&per_page=100`]=[{workflow_runs:[]}];
  }
  for(const file of ['research-ui-release.yml','static-site.yml'])api[`${prefix}/actions/workflows/${file}/runs?branch=main&per_page=100`]=[{workflow_runs:[]}];
  const checks=verifyCorrectionConsumerChecks({uiSha:sha,approval},repository,endpoint=>api[endpoint]);
  const original=projection(certificate.source);
  const lineage=sourceLineage({source:certificate.source,certificate:certificate.reference,sourceProjectionSha256:sha256(original.bytes),receiptInventorySha256:original.value.receipt_inventory_sha256,projectionPolicy:original.value.policy});
  write(join(bin,'gh'),`#!${process.execPath}\nconst fs=require('node:fs'),args=process.argv.slice(2),config=JSON.parse(fs.readFileSync(process.env.RELEASE_CLI_FIXTURE));
if(args[0]!=='api'||args.slice(1,-1).some(arg=>!['--paginate','--slurp'].includes(arg)))throw Error('Unexpected fixture command');
const endpoint=args.at(-1);fs.appendFileSync(process.env.RELEASE_CLI_TRACE,JSON.stringify({api:endpoint})+'\\n');
if(Object.hasOwn(config.zips,endpoint))process.stdout.write(fs.readFileSync(config.zips[endpoint]));
else if(Object.hasOwn(config.api,endpoint))process.stdout.write(JSON.stringify(config.api[endpoint]));
else throw Error('Unexpected fixture API read '+endpoint);`);chmodSync(join(bin,'gh'),0o755);
  write(preload,`import {readFileSync,appendFileSync} from 'node:fs';import {join} from 'node:path';
const config=JSON.parse(readFileSync(process.env.RELEASE_CLI_FIXTURE)),base=new URL(${JSON.stringify(bootstrap.site_url)});
const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[process.env.RELEASE_FIXTURE_NOW]));}static now(){return RealDate.parse(process.env.RELEASE_FIXTURE_NOW);}};
globalThis.fetch=async(input,options)=>{const url=new URL(input),path=url.pathname.slice(base.pathname.length);
 if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname)||path.includes('..')||options.redirect!=='error')throw Error('Unexpected fixture fetch');
 appendFileSync(process.env.RELEASE_CLI_TRACE,JSON.stringify({pages:path})+'\\n');
 const bytes=readFileSync(join(config.liveRoot,path));return {ok:true,status:200,arrayBuffer:async()=>bytes};};`);
  write(join(root,'event.json'),{inputs:{}});
  let now=sourceTime,releaseRoot=null,releaseId=null;
  const save=()=>write(configPath,config);
  const environment=extra=>({PATH:`${bin}:${process.env.PATH}`,RUNNER_TEMP:join(releaseRoot||root,'runner'),GITHUB_REPOSITORY:repository,
    GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_EVENT_PATH:join(root,'event.json'),RELEASE_SHA:sha,GITHUB_RUN_ID:String(releaseId),GITHUB_RUN_ATTEMPT:'1',
    RELEASE_CLI_FIXTURE:configPath,RELEASE_CLI_TRACE:join(root,'trace.jsonl'),RELEASE_FIXTURE_NOW:now,NODE_OPTIONS:`--import=${preload}`,...extra});
  function invoke(path,args=[],cwd=releaseRoot,extra={}){save();return spawnSync(process.execPath,[path,...args],{cwd,encoding:'utf8',timeout:30000,env:environment(extra)});}
  function success(result,label){assert.ifError(result.error);assert.equal(result.status,0,`${label}\n${result.stdout}\n${result.stderr}`);return result;}
  function frontendAt(directory){mkdirSync(join(directory,'frontend'),{recursive:true});for(const name of ['src','tools','package.json'])symlinkSync(join(repoRoot,'frontend',name),join(directory,'frontend',name));mkdirSync(join(directory,'data/ibd_reference/ibd50'),{recursive:true});return join(directory,'frontend');}
  function exportBundle(directory,date,price,history=null,extra={}){
    const frontend=frontendAt(directory),dataRoot=join(frontend,'public/static-data'),value=row(date,price);
    write(join(dataRoot,'manifest.json'),{as_of_date:date,default_market:'US',supported_markets:['US'],generated_at:now,markets:{US:{market:'US',as_of_date:date,pages:{scan:{path:'scan.json'}},assets:{charts:{path:'charts-index.json'}}}}});
    write(join(dataRoot,'scan.json'),{as_of_date:date,initial_rows:[value],preview_rows:[value],chunks:[{path:'chunk.json'}]});
    write(join(dataRoot,'chunk.json'),{as_of_date:date,rows:[value]});
    write(join(dataRoot,'charts-index.json'),{market:'US',symbols:[{symbol:'OWNED',path:'charts/OWNED.json'}]});
    const chart={symbol:'OWNED',market:'US',as_of_date:date,bars:bars(date,price),stock_data:value,fundamentals:{...value},eps_line:[]};
    write(join(dataRoot,'charts/OWNED.json'),chart);write(join(dataRoot,'raw/OWNED.json'),chart);
    write(join(dataRoot,'financial-history.json'),{as_of_date:date,results:{OWNED:{symbol:'OWNED',annual:[],quarterly:[]}}});
    if(history)cpSync(history,join(dataRoot,'candidate-history'),{recursive:true});
    else {write(join(dataRoot,'candidate-history/index.json'),{schema_version:1,snapshots:[]});write(join(dataRoot,'candidate-history/retained-history.json'),'retained original history bytes\n');}
    success(invoke(join(frontend,'tools/export-research.mjs'),[],frontend,{FINANCIAL_EVALUATED_AT:now,...extra}),'export fixture');
    return join(frontend,'public');
  }
  function pack(id,name,directory,member='artifact.tar',content=null,runId=id){
    const zip=join(root,`artifact-${id}.zip`),tar=join(root,`artifact-${id}.tar`);
    if(content===null)execFileSync('tar',['-cf',tar,'-C',directory,'.']);
    execFileSync('python3',['-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:z.write(sys.argv[2],sys.argv[3])',zip,content||tar,member]);
    config.zips[`${prefix}/actions/artifacts/${id}/zip`]=zip;
    return {id,name,expired:false,digest:`sha256:${sha256(readFileSync(zip))}`,size_in_bytes:readFileSync(zip).length,created_at:now,expires_at:'2099-01-01T00:00:00Z',workflow_run:{id:runId,head_sha:sha,head_branch:'main'}};
  }
  function deploy(directory,id){
    const liveRoot=join(root,`deployed-${id}`);cpSync(directory,liveRoot,{recursive:true});config.liveRoot=liveRoot;
    api[`${prefix}/actions/runs/${id}/attempts/1`]=run(id,'research-ui-release.yml','workflow_dispatch');
    const start=new Date(Date.parse(now)+60000).toISOString(),end=new Date(Date.parse(now)+120000).toISOString();
    api[`${prefix}/actions/runs/${id}/attempts/1/jobs?per_page=100`]=[{jobs:[{run_attempt:1,started_at:now,steps:[{name:'Deploy to GitHub Pages',conclusion:'success',started_at:start,completed_at:end}]}]}];
    save();return liveRoot;
  }
  function seed(){
    // This is an already-deployed activation seed, not evidence that the
    // synthetic projection passed activation/source certification. The test
    // exercises the two subsequent strict carry publication lifecycles.
    write(join(root,'source-projection.json'),original.bytes);
    const publicRoot=exportBundle(join(root,'seed'),sourceDate,100,null,{FINANCIAL_CORRECTION_PROJECTION:join(root,'source-projection.json'),FINANCIAL_CORRECTION_SHA256:sha256(original.bytes),FINANCIAL_CORRECTION_TARGET_IDENTITY:original.value.bindings.target_publication_identity,FINANCIAL_CORRECTION_TARGET_BASE_SHA256:sha256(original.base)});
    // Record the established first observation before testing subsequent days.
    success(invoke(join(root,'seed/frontend/tools/record-candidate-history.mjs'),[],join(root,'seed/frontend')),'seed daily history');
    write(join(publicRoot,'index.html'),'<!doctype html><title>Offline approved UI</title>');write(join(publicRoot,'sw.js'),'// offline approved worker\n');
    if(packedTransport)cpSync(join(repoRoot,'frontend/public/static-transport-capability.json'),join(publicRoot,'static-transport-capability.json'));
    const manifestBytes=readFileSync(join(publicRoot,'static-data/manifest.json')),manifest=JSON.parse(manifestBytes);
    const observed=extractPriceObservations({dataRoot:join(publicRoot,'static-data'),manifest}),known=comparePriceObservations(observed,bootstrap.approved_price_observations).knownDates;
    const ui=uiInventory(publicRoot),prepared=writeFinancialReleaseReceipt({dist:publicRoot,mode:'activation',previousIdentity:original.value.bindings.target_publication_identity,lineage,
      sourceProjectionBytes:original.bytes,sourceBaseBytes:original.base,evaluationBytes:original.bytes,generation:original.value.financial_generation,evaluatedAt:sourceTime,
      ui:{approved_sha:sha,captured_sha:sha,digest:inventoryDigest(ui),approval,checks},priceInput:{artifact_id:19,artifact_sha256:hash,manifest_sha256:sha256(manifestBytes),price_observations_sha256:priceObservationDigest(observed),known_price_dates_sha256:priceObservationDigest(known)},
      candidate:{repository,workflow:financialReleasePolicy.candidate_workflow,head_sha:sha,run_id:11,run_attempt:1,job_id:110,artifact_id:20,artifact_name:'financial-release-candidate-11-1',artifact_sha256:hash,candidate_receipt_sha256:hash,record_sha256:hash}});
    write(join(publicRoot,'publication.json'),validateReceipt({schema:1,run_id:30,run_attempt:1,artifact_name:'github-pages-30-1',controller_sha:sha,ui_sha:sha,ui_files:ui,ui_digest:inventoryDigest(ui),approval,
      data_manifest_sha256:sha256(manifestBytes),price_observations:observed,known_price_dates:known,verification_universe:{as_of_date:sourceDate,required_symbols:['OWNED'],minimum_target:0.9,total:1,verified:1},
      financial_release:prepared.reference,financial_generation:prepared.receipt.financial_generation,financial_lineage_sha256:lineage.id,data_inventory_sha256:inventoryDigest(dataInventory(publicRoot))}));
    if(packedTransport){
      const adapter=join(repoRoot,'.github/scripts/static-transport-publication.mjs');
      success(invoke('--input-type=module',['-e',`import {readFileSync} from 'node:fs';import {packPublication} from ${JSON.stringify(adapter)};
        const root=${JSON.stringify(publicRoot)},publication=JSON.parse(readFileSync(root+'/publication.json'));
        await packPublication({root,frontendRoot:${JSON.stringify(join(repoRoot,'frontend'))},publication,bindings:{sourceCommit:${JSON.stringify(sha)},appCommit:${JSON.stringify(sha)},candidateId:${JSON.stringify(hash)}}});`],root),'pack approved fixture seed');
    }
    return deploy(publicRoot,30);
  }
  function advance({id,date,price,time}){
    now=time;releaseId=id;releaseRoot=join(root,`release-${id}`);frontendAt(join(releaseRoot,'release'));
    const output=join(releaseRoot,'output'),envFile=join(releaseRoot,'environment');
    const fresh=exportBundle(join(root,`export-${id}`),date,price,join(config.liveRoot,'static-data/candidate-history'));
    const exportId=id+100,artifact=pack(exportId,`static-site-data-${exportId}-1`,fresh);
    const manifestBytes=readFileSync(join(fresh,'static-data/manifest.json')),observed=extractPriceObservations({dataRoot:join(fresh,'static-data'),manifest:JSON.parse(manifestBytes)});
    const metadata=join(root,`source-${id}.json`);write(metadata,{run_id:exportId,run_attempt:1,source_sha:sha,artifact_name:artifact.name,manifest_json:manifestBytes.toString(),manifest_sha256:sha256(manifestBytes),price_observations:observed,price_observations_sha256:priceObservationDigest(observed)});
    const companion=pack(exportId+1,`static-site-data-manifest-${exportId}-1`,null,'source.json',metadata,exportId);
    api[`${prefix}/actions/runs/${exportId}/attempts/1`]=run(exportId,'static-site.yml','schedule');
    api[`${prefix}/actions/runs/${exportId}/attempts/1/jobs?per_page=100`]=[{jobs:[{name:'combine-and-build',run_attempt:1,conclusion:'success',started_at:now,completed_at:now,steps:[{name:'Build static frontend',conclusion:'success'}]}]}];
    api[`${prefix}/actions/artifacts?per_page=100`]=[{artifacts:[artifact,companion]}];
    // No predecessor Actions artifact is available: carry must restore the
    // durable, hash-bound source assets from the verified Pages publication.
    save();
    return {root:releaseRoot,dist:join(releaseRoot,'release/frontend/dist'),frontend:join(releaseRoot,'release/frontend'),output,envFile,
      command(command,{allowFailure=false,env={}}={}){const result=invoke(controllerPath,[command],releaseRoot,{GITHUB_OUTPUT:output,GITHUB_ENV:envFile,...env});return allowFailure?result:success(result,command);},
      build(){const env=Object.fromEntries(readFileSync(envFile,'utf8').trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
        for(const script of ['export-research.mjs','record-candidate-history.mjs'])success(invoke(join(this.frontend,'tools',script),[],this.frontend,env),script);
        cpSync(join(this.frontend,'public'),this.dist,{recursive:true});},
      state(){return read(join(releaseRoot,'runner/verified-publication/state.json'));},
      deploy(){return deploy(this.dist,id);}};
  }
  return {root,config,save,original,lineage,seed,advance,invoke,success,environment,get liveRoot(){return config.liveRoot;},setTime(value){now=value;},
    cleanup(){certificate.cleanup();rmSync(root,{recursive:true,force:true});}};
}
