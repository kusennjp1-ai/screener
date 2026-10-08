import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {checkedExport,chooseExport,chooseFiniteExport} from './select-release-source.mjs';
import {publicationDecision,checkPublication} from './publication-gate.mjs';
import {PRICE_CI,PRICE_REQUEST_PATH,PRICE_REPAIR_STEP,verifyPriceSourceCompletion,isVerifiedPriceSourceProof} from './retained-price-ci-admission.mjs';

const digest=b=>createHash('sha256').update(b).digest('hex');
const repo={id:PRICE_CI.repositoryId,full_name:PRICE_CI.repository,default_branch:'main'};
const prefix=`repos/${repo.full_name}`;
const clone=structuredClone;
const manifest=date=>({as_of_date:date,default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:date,freshness:{scan_as_of_date:date,scan_published_at:date+'T01:00:00Z',prices_generated_at:date+'T02:00:00Z',breadth_latest_date:date,groups_latest_date:date}}}});
function ordinary({id=300,head='d'.repeat(40),date='2026-10-07',created='2026-10-07T10:00:00Z'}={}){
  const workflow_run={id,head_sha:head,head_branch:'main'},artifact={id:id*10,name:`static-site-data-${id}-1`,expired:false,created_at:created,workflow_run,size_in_bytes:100,digest:'sha256:'+'c'.repeat(64)},companion={...artifact,id:id*10+1,name:`static-site-data-manifest-${id}-1`};
  const run={...workflow_run,run_attempt:1,path:PRICE_CI.producer.path,event:'schedule',status:'completed',conclusion:'success',repository:repo,head_repository:repo};
  const createdMs=Date.parse(created);assert(Number.isFinite(createdMs),'Invalid ordinary fixture creation clock');
  const job={id:id*100,name:'combine-and-build',run_attempt:1,conclusion:'success',started_at:new Date(createdMs-60000).toISOString(),completed_at:new Date(createdMs+30000).toISOString(),steps:[{name:'Build static frontend',conclusion:'success'}]};
  const raw=JSON.stringify(manifest(date)),metadata={run_id:id,run_attempt:1,source_sha:head,artifact_name:artifact.name,manifest_json:raw,manifest_sha256:digest(raw),price_observations:{},price_observations_sha256:digest('{}')};
  return{artifact,companion,run,job,metadata};
}
function fixture(t){
  const base=mkdtempSync(join(tmpdir(),'price-readers-')),workspace=join(base,'workspace'),temp=join(base,'temp'),root=join(temp,'retained-price-controller');mkdirSync(workspace);mkdirSync(temp);
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const git=(where,...args)=>execFileSync('git',args,{cwd:where,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const write=(where,path,value)=>{mkdirSync(dirname(join(where,path)),{recursive:true});writeFileSync(join(where,path),typeof value==='string'?value:JSON.stringify(value)+'\n');};
  git(workspace,'init','-q');git(workspace,'config','user.email','fixture@example.test');git(workspace,'config','user.name','Fixture');
  write(workspace,PRICE_CI.producer.path,readFileSync(new URL('../workflows/static-site.yml',import.meta.url),'utf8'));
  const committed=JSON.parse(readFileSync(new URL('../retained-price-oct6-source.json',import.meta.url),'utf8')),disabled={...committed,enabled:false,activation:null};
  write(workspace,PRICE_REQUEST_PATH,disabled);git(workspace,'add','.');git(workspace,'commit','-qm','reviewed disabled source plumbing');
  const parent=git(workspace,'rev-parse','HEAD'),parentTree=git(workspace,'rev-parse','HEAD^{tree}'),oldRaw=readFileSync(join(workspace,PRICE_REQUEST_PATH));
  const baseClock=Date.now()-600000,iso=seconds=>new Date(baseClock+seconds*1000).toISOString();
  const request={...disabled,enabled:true,activation:{reviewed_parent_sha:parent,reviewed_parent_tree:parentTree,disabled_request_sha256:digest(oldRaw),not_before:iso(-60),not_after:iso(3600)}};
  write(workspace,PRICE_REQUEST_PATH,request);git(workspace,'add',PRICE_REQUEST_PATH);git(workspace,'commit','-qm','exact request-only activation');
  const head=git(workspace,'rev-parse','HEAD'),tree=git(workspace,'rev-parse','HEAD^{tree}');git(workspace,'worktree','add','--detach',root,head);
  const saved=Object.fromEntries(['RUNNER_TEMP','GITHUB_WORKSPACE','RETAINED_PRICE_CONTROLLER_ROOT','GITHUB_EVENT_NAME'].map(k=>[k,process.env[k]]));
  t.after(()=>{for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  Object.assign(process.env,{RUNNER_TEMP:temp,GITHUB_WORKSPACE:workspace,RETAINED_PRICE_CONTROLLER_ROOT:root,GITHUB_EVENT_NAME:'workflow_run'});
  const map={},calls=[];
  const treeResponse=(sha,ref)=>({sha,truncated:false,tree:git(workspace,'ls-tree','-r',ref).split('\n').map(line=>{const [metadata,path]=line.split('\t'),[mode,type,sha]=metadata.split(' ');return{path,mode,type,sha};})});
  const rawAt=ref=>Buffer.from(git(workspace,'show',`${ref}:${PRICE_REQUEST_PATH}`)+'\n');
  for(const [sha,treeSha,parents]of [[parent,parentTree,[]],[head,tree,[{sha:parent}]]]){
    map[`${prefix}/git/commits/${sha}`]={sha,tree:{sha:treeSha},parents};map[`${prefix}/git/trees/${treeSha}?recursive=1`]=treeResponse(treeSha,sha);
    const raw=rawAt(sha);map[`${prefix}/contents/${PRICE_REQUEST_PATH}?ref=${sha}`]={type:'file',path:PRICE_REQUEST_PATH,encoding:'base64',content:raw.toString('base64'),size:raw.length,sha:git(workspace,'rev-parse',`${sha}:${PRICE_REQUEST_PATH}`)};
  }
  map[prefix]=repo;map[`${prefix}/git/ref/heads/main`]={object:{sha:head}};
  const run=(id,wf,event,start,end)=>({id,run_attempt:1,workflow_id:wf.id,path:wf.path,event,head_sha:head,head_branch:'main',status:'completed',conclusion:'success',created_at:iso(start),run_started_at:iso(start+1),updated_at:iso(end),repository:repo,head_repository:repo});
  const ci=run(100,PRICE_CI.ci,'push',0,3),source=run(200,PRICE_CI.producer,'workflow_run',4,15),design={...ci,id:101,path:'.github/workflows/design-acceptance.yml'};
  const sourceJob={id:2000,run_id:200,run_attempt:1,head_sha:head,name:'combine-and-build',status:'completed',conclusion:'success',started_at:iso(6),completed_at:iso(14),steps:['Build static frontend',PRICE_REPAIR_STEP,'Upload verified data export','Record exact export attempt and dated evidence','Preserve dated export provenance for release selection'].map(name=>({name,status:'completed',conclusion:'success',started_at:iso(7),completed_at:iso(13)}))};
  const ciJobs=['Backend Quality Gates','Frontend','Static Browser Regression'].map((name,i)=>({id:1000+i,run_id:100,run_attempt:1,head_sha:head,name,status:'completed',conclusion:'success',started_at:iso(1),completed_at:iso(2)}));
  for(const [r,wf,event,jobs]of [[ci,PRICE_CI.ci,'push',ciJobs],[source,PRICE_CI.producer,'workflow_run',[sourceJob]]]){
    map[`${prefix}/actions/runs/${r.id}`]=r;map[`${prefix}/actions/runs/${r.id}/attempts/1`]=r;
    map[`${prefix}/actions/runs/${r.id}/attempts/1/jobs?per_page=100`]=[{total_count:jobs.length,jobs}];
    map[`${prefix}/actions/workflows/${wf.id}/runs?branch=main&event=${event}&head_sha=${head}&per_page=100`]=[{total_count:1,workflow_runs:[r]}];
  }
  for(const [file,r]of [['ci.yml',ci],['design-acceptance.yml',design]])map[`${prefix}/actions/workflows/${file}/runs?branch=main&event=push&head_sha=${head}&per_page=100`]=[{workflow_runs:[r]}];
  const item=ordinary({id:200,head,date:'2026-10-06',created:iso(12)});item.run=source;item.job=sourceJob;
  for(const artifact of [item.artifact,item.companion]){artifact.expires_at=iso(3000);map[`${prefix}/actions/artifacts/${artifact.id}`]=clone(artifact);}
  const requestSha=digest(rawAt(head)),payload={schema_version:'retained-price-source-payload-v1',request_sha256:requestSha,approved_ui:request.approved_ui,producer:{run_id:200,run_attempt:1,head_sha:head,job:{id:2000,started_at:iso(6)}},evaluated_at:iso(10)},payloadJson=JSON.stringify(payload),physicalJson=JSON.stringify({dist:{}});
  item.metadata.retained_price_repair={schema_version:'retained-price-source-declaration-v1',request_sha256:requestSha,producer_controller_tree:tree,predecessor_identity:request.predecessor.identity,artifact:{id:item.artifact.id,name:item.artifact.name,bytes:item.artifact.size_in_bytes,sha256:item.artifact.digest.slice(7)},payload_json:payloadJson,payload_sha256:digest(payloadJson),physical_inventory_json:physicalJson,physical_inventory_sha256:digest(physicalJson)};
  const items=[item];
  const api=(endpoint)=>{calls.push(endpoint);if(Object.hasOwn(map,endpoint))return clone(map[endpoint]);for(const candidate of items){const base=`${prefix}/actions/runs/${candidate.run.id}/attempts/1`;if(endpoint===base)return clone(candidate.run);if(endpoint===base+'/jobs?per_page=100')return[{jobs:[clone(candidate.job)]}];}throw Error('Unexpected fixture API '+endpoint);};
  const load=artifact=>{const match=items.find(x=>x.companion.id===artifact.id);assert(match,'Unknown companion');return clone(match.metadata);};
  const pages=()=>[{artifacts:items.flatMap(x=>[x.artifact,x.companion])}];
  const event={action:'completed',repository:repo,workflow_run:source},live={manifest:manifest('2026-10-05'),knownPriceDates:{}};
  return{root,workspace,temp,head,tree,source,item,items,event,live,api,load,pages,map,calls,ci,design,write,
    disable(){write(root,PRICE_REQUEST_PATH,disabled);git(root,'add',PRICE_REQUEST_PATH);git(root,'commit','-qm','request-only post-publication disable');map[`${prefix}/git/ref/heads/main`].object.sha=git(root,'rev-parse','HEAD');},
    proof:()=>verifyPriceSourceCompletion({root,sourceRun:200,api}),
  };
}

test('finite publication gate requires the actual in-process proof and forces the approved live UI',t=>{
  const f=fixture(t),proof=f.proof(),input={eventName:'workflow_run',event:f.event,sha:f.head,currentSha:f.head,runs:[f.ci,f.design]};
  assert.equal(publicationDecision(input).publish,false);
  assert.equal(publicationDecision({...input,finitePriceSource:clone(proof)}).publish,false);
  const good=publicationDecision({...input,finitePriceSource:proof});assert.equal(good.publish,true);assert.equal(good.mode,'data');assert.deepEqual(good.finitePriceSource,{runId:200,attempt:1});assert.equal(good.approval,undefined);
  assert.equal(checkPublication(f.event,f.head,repo.full_name,f.api).mode,'data');
});
test('finite selector binds the actual winning source even when a newer ordinary export exists',t=>{
  const f=fixture(t),newer=ordinary({id:300,date:'2026-10-07',created:new Date(Date.now()-60000).toISOString()});f.items.push(newer);
  const chosen=chooseFiniteExport(f.live,f.pages(),repo.full_name,{runId:200,attempt:1},f.api,f.load);assert.equal(chosen.runId,200);assert(chosen.repair);
  assert.throws(()=>chooseFiniteExport(f.live,[{artifacts:[newer.artifact,newer.companion]}],repo.full_name,{runId:200,attempt:1},f.api,f.load),/unique retained artifact/);
  assert.throws(()=>chooseFiniteExport(f.live,f.pages(),repo.full_name,{runId:300,attempt:1},f.api,f.load),/not eligible/);
  assert.throws(()=>chooseFiniteExport(f.live,f.pages(),repo.full_name,{runId:200,attempt:2},f.api,f.load),/identity/);
  assert.throws(()=>chooseFiniteExport({manifest:manifest('2026-10-06'),knownPriceDates:{}},f.pages(),repo.full_name,{runId:200,attempt:1},f.api,f.load),/does not advance/);
});
test('request-only disable skips old repaired artifacts and restores ordinary export selection',t=>{
  const f=fixture(t),proof=f.proof();f.disable();const ordinarySource=ordinary({id:300,date:'2026-10-07',created:'2026-10-07T00:01:00Z'});f.items.push(ordinarySource);f.calls.length=0;
  const noLoad=()=>assert.fail('Disabled repaired artifact must be skipped before companion loading');
  assert.equal(checkedExport(f.item.artifact,f.pages(),repo.full_name,f.api,noLoad),null);
  assert.deepEqual(f.calls,[`${prefix}/actions/runs/200/attempts/1`]);
  assert.equal(chooseExport(f.live,f.pages(),repo.full_name,f.api,f.load).runId,300);
  assert(!isVerifiedPriceSourceProof(proof));assert.throws(()=>f.proof(),/disabled/);
});
test('generated release files cannot dirty the separately authenticated controller reader',t=>{
  const f=fixture(t);f.write(f.workspace,'release/frontend/dist/static-data/generated.json','{}');
  assert.equal(checkedExport(f.item.artifact,f.pages(),repo.full_name,f.api,f.load).runId,200);
  f.write(f.root,'untracked-controller.js','x');assert.throws(()=>checkedExport(f.item.artifact,f.pages(),repo.full_name,f.api,f.load),/untracked/);
});
test('ordinary schedule/manual source behavior and proof-free ordinary gates remain unchanged',t=>{
  const f=fixture(t);f.disable();const item=ordinary();f.items.push(item);
  assert.equal(checkedExport(item.artifact,f.pages(),repo.full_name,f.api,f.load).runId,300);item.run.event='workflow_dispatch';assert.equal(checkedExport(item.artifact,f.pages(),repo.full_name,f.api,f.load).runId,300);
  for(const event of ['schedule','workflow_dispatch'])assert.equal(publicationDecision({eventName:'workflow_run',event:{repository:repo,workflow_run:{...item.run,event}},sha:f.head,currentSha:f.head,runs:[f.ci,f.design]}).mode,'ui');
  item.metadata.retained_price_repair={verified:true};assert.throws(()=>checkedExport(item.artifact,f.pages(),repo.full_name,f.api,f.load),/fall through/);
});
test('finite selection keeps ordinary per-series chronology and fresh artifact checks',t=>{
  const f=fixture(t),key=JSON.stringify(['US','chart','LPSN']);
  f.live.knownPriceDates={[key]:'2026-09-04'};f.item.metadata.price_observations={[key]:'2026-09-03'};f.item.metadata.price_observations_sha256=digest(JSON.stringify(f.item.metadata.price_observations));
  assert.throws(()=>chooseFiniteExport(f.live,f.pages(),repo.full_name,{runId:200,attempt:1},f.api,f.load),/does not advance/);
  f.item.metadata.price_observations={};f.item.metadata.price_observations_sha256=digest('{}');f.map[`${prefix}/actions/artifacts/${f.item.artifact.id}`].expired=true;
  assert.throws(()=>checkedExport(f.item.artifact,f.pages(),repo.full_name,f.api,f.load),/artifact changed/);
});
test('a once-valid finite proof cannot authorize publication after current main changes',t=>{
  const f=fixture(t),proof=f.proof();f.map[`${prefix}/git/ref/heads/main`].object.sha='b'.repeat(40);
  assert.equal(publicationDecision({eventName:'workflow_run',event:f.event,sha:f.head,currentSha:f.head,runs:[f.ci,f.design],finitePriceSource:proof}).publish,false);
  assert.throws(()=>checkedExport(f.item.artifact,f.pages(),repo.full_name,f.api,f.load),/no longer current main/);
});

test('ordinary fixture clocks cross UTC midnight while the actual reader retains exact attempt bounds',t=>{
  const f=fixture(t);f.disable();
  for(const created of ['2026-10-07T23:59:59.000Z','2026-10-08T00:00:00.000Z']){
    const item=ordinary({id:300,date:'2026-10-07',created});f.items.splice(1,f.items.length-1,item);
    assert(Date.parse(item.job.started_at)<Date.parse(created)&&Date.parse(created)<Date.parse(item.job.completed_at));
    assert.equal(checkedExport(item.artifact,f.pages(),repo.full_name,f.api,f.load).runId,300);
    for(const stamp of [Date.parse(item.job.started_at)-1,Date.parse(item.job.completed_at)+1]){
      const outside={...item.artifact,created_at:new Date(stamp).toISOString()};
      assert.throws(()=>checkedExport(outside,f.pages(),repo.full_name,f.api,f.load),/not created by its validated attempt/);
    }
  }
});
