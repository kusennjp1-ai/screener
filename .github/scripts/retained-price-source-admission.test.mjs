import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateRepairRequest,readRepairRequest,assertRepairPredecessor,parseRepairDeclaration,authenticateOriginals,digest} from './retained-price-source-admission.mjs';
const committed=JSON.parse(readFileSync(new URL('../retained-price-oct6-source.json',import.meta.url)));
const initial={...committed,enabled:false,activation:null};
const clone=structuredClone;
function active(){return {...clone(initial),enabled:true,activation:{reviewed_parent_sha:'a'.repeat(40),reviewed_parent_tree:'b'.repeat(40),disabled_request_sha256:'c'.repeat(64),not_before:'2026-10-07T00:00:00Z',not_after:'2026-10-07T02:00:00Z'}};}
test('disabled fixture has no activation and the actual request always passes the same closed schema',()=>{validateRepairRequest(readRepairRequest().value);assert.equal(initial.activation,null);assert.equal(validateRepairRequest(initial),initial);});
test('every fixed source, runtime, predecessor and authority field is closed',()=>{
  for(const change of [r=>r.target_as_of_date='2026-10-07',r=>r.originals.candidate.artifact_id++,r=>r.originals.candidate.sha256='0'.repeat(64),r=>r.originals.candidate.head_sha='0'.repeat(40),r=>r.predecessor.identity='synthetic',r=>r.predecessor.financial_generation='0'.repeat(64),r=>r.predecessor.financial_lineage_sha256='0'.repeat(64),r=>r.approved_ui.sha='0'.repeat(40),r=>r.bounds.reserve_bytes=0,r=>r.bounds.download_timeout_ms++,r=>r.policy.provider_acquisition=true,r=>r.policy.financial_expiry_uses_actual_current_time=false,r=>r.policy.diagnostic_source_authority=true,r=>r.policy.renewal_prerequisite=true,r=>r.extra=true,r=>delete r.repair]){const v=clone(initial);change(v);assert.throws(()=>validateRepairRequest(v));}
});
test('activation requires exact shape, Git identities and a real bounded calendar interval',()=>{
  assert.equal(validateRepairRequest(active()).enabled,true);
  for(const change of [r=>r.enabled='true',r=>r.activation=null,r=>r.activation.extra=true,r=>r.activation.reviewed_parent_sha='invalid',r=>r.activation.disabled_request_sha256='f',r=>r.activation.not_before='2026-02-30T00:00:00Z',r=>r.activation.not_after=r.activation.not_before,r=>r.activation.not_after='not-a-date',r=>r.enabled=false]){const v=active();change(v);assert.throws(()=>validateRepairRequest(v));}
});
test('actual current predecessor must carry the exact existing lineage and approved UI',()=>{
  const request=active(),live={identity:request.predecessor.identity,uiSha:request.approved_ui.sha,financialRelease:{lineage_sha256:request.predecessor.financial_lineage_sha256,financial_generation:request.predecessor.financial_generation}};
  assert(assertRepairPredecessor(live,request));
  for(const change of [v=>v.identity+='new',v=>v.uiSha='0'.repeat(40),v=>v.financialRelease.lineage_sha256='0'.repeat(64),v=>v.financialRelease.financial_generation='0'.repeat(64),v=>delete v.financialRelease]){const v=clone(live);change(v);assert.throws(()=>assertRepairPredecessor(v,request));}
  assert.throws(()=>assertRepairPredecessor(live,initial));
});
function declaration(){const payload='{"literal":"producer-time"}',physical='{"dist":{"path":"raw-bytes"}}';return {schema_version:'retained-price-source-declaration-v1',request_sha256:'a'.repeat(64),producer_controller_tree:'b'.repeat(40),predecessor_identity:'literal-live-identity',artifact:{id:1,name:'static-site-data-1-1',bytes:1,sha256:'c'.repeat(64)},payload_json:payload,payload_sha256:digest(payload),physical_inventory_json:physical,physical_inventory_sha256:digest(physical)};}
test('producer declaration preserves exact logical and physical proof bytes with no acceptance boolean',()=>{
  const original=declaration(),read=parseRepairDeclaration(original);assert.equal(read.declaration.raw.toString(),original.payload_json);assert.equal(read.physical.raw.toString(),original.physical_inventory_json);
  for(const change of [v=>v.schema_version='diagnostic',v=>v.verified=true,v=>delete v.physical_inventory_json,v=>v.payload_json+=' ',v=>v.payload_sha256='0'.repeat(64),v=>v.artifact.id=0,v=>v.artifact.extra='unknown',v=>v.producer_controller_tree='x']){const v=clone(original);change(v);assert.throws(()=>parseRepairDeclaration(v));}
});

function originalFixture(){
  const request=active(),prefix='repos/kusennjp1-ai/screener';
  const repo={id:1203919607,full_name:'kusennjp1-ai/screener',private:false,visibility:'public',default_branch:'main',owner:{id:265297436,login:'kusennjp1-ai'}};
  const map={[prefix]:repo,[`${prefix}/git/ref/heads/main`]:{object:{sha:'f'.repeat(40)}}};
  const trees={candidate:'2186101e92e1f71771936831cea0a40e410975f7',prior:'00a8eaa6b14b977f31f24ac9f708872c2dbe5ee9'};
  for(const role of ['candidate','prior']){
    const pin=request.originals[role],start='2026-10-06T00:00:00Z',end='2026-10-06T01:00:00Z';
    const run={id:pin.run_id,run_attempt:1,head_sha:pin.head_sha,head_branch:'main',path:`.github/workflows/${role==='candidate'?'static-site':'research-ui-release'}.yml`,workflow_id:role==='candidate'?294257497:364666954,repository:repo,head_repository:repo,status:'completed',conclusion:role==='candidate'?'failure':'success',head_commit:{id:pin.head_sha,tree_id:trees[role]},event:role==='candidate'?'schedule':'workflow_run',run_number:role==='prior'?99:419,run_started_at:start};
    const job={id:role==='candidate'?1:112314516098,name:role==='candidate'?'combine-and-build':'publish',run_id:pin.run_id,run_attempt:1,head_sha:pin.head_sha,status:'completed',conclusion:'success',started_at:start,completed_at:end,
      steps:(role==='candidate'?['Build static frontend','Upload verified data export','Preserve dated export provenance for release selection']:['Run actions/upload-pages-artifact@v4','Deploy to GitHub Pages']).map(name=>({name,status:'completed',conclusion:'success',started_at:'2026-10-06T00:30:00Z',completed_at:'2026-10-06T00:59:00Z'}))};
    const artifact=(id,name,bytes,hash)=>({id,name,size_in_bytes:bytes,digest:'sha256:'+hash,expired:false,created_at:'2026-10-06T00:20:00Z',expires_at:'2026-11-06T00:20:00Z',workflow_run:{id:pin.run_id,head_sha:pin.head_sha,head_branch:'main',repository_id:repo.id,head_repository_id:repo.id}});
    const artifacts=[artifact(pin.artifact_id,role==='candidate'?pin.artifact_name:`github-pages-${pin.run_id}-1`,pin.bytes,pin.sha256)];
    if(role==='candidate')artifacts.push(artifact(pin.companion_artifact_id,`static-site-data-manifest-${pin.run_id}-1`,pin.companion_bytes,pin.companion_sha256));
    map[`${prefix}/actions/runs/${pin.run_id}/attempts/1`]=clone(run);map[`${prefix}/actions/runs/${pin.run_id}`]=clone(run);
    map[`${prefix}/git/commits/${pin.head_sha}`]={sha:pin.head_sha,tree:{sha:trees[role]}};
    map[`${prefix}/actions/runs/${pin.run_id}/attempts/1/jobs?per_page=100`]=[{total_count:1,jobs:[job]}];
    map[`${prefix}/actions/runs/${pin.run_id}/artifacts?per_page=100`]=[{total_count:artifacts.length,artifacts}];
  }
  map[`${prefix}/git/trees/${trees.candidate}?recursive=1`]={sha:trees.candidate,truncated:false,tree:[{path:'.github/workflows/static-site.yml',sha:'c601578500182f3a3a18dc7e929de1fd03bebaa5',mode:'100644'},{path:'backend/app/services/static_site_export_service.py',sha:'358938e52b903ae6bfed4d80a8f73160389ddd1e',mode:'100644'}]};
  const api=(endpoint)=>{assert(Object.hasOwn(map,endpoint),`Unexpected API request: ${endpoint}`);return clone(map[endpoint]);};
  return {request,map,prefix,api,verify:()=>authenticateOriginals({api,request,caller:{run:{id:100}},controller:{head:'f'.repeat(40),tree:'e'.repeat(40)},now:Date.parse('2026-10-07T11:00:00Z')})};
}
test('actual checked-export failure is admissible only through its successful genuine build and preserved origins',()=>{
  const f=originalFixture(),result=f.verify();assert.deepEqual(Object.keys(result.archives),['candidate','companion','prior']);
  assert.equal(result.evidence.selected.candidate.run.conclusion,'failure');assert.equal(result.evidence.selected.candidate.producer_job.conclusion,'success');
  assert.equal(result.archives.candidate.sha256,f.request.originals.candidate.sha256);assert.equal(result.evidence.publication_authority,false);
  for(const [key,value]of Object.entries(result.evidence.responses))assert.equal(result.evidence.response_sha256[key],digest(JSON.stringify(value)));
});
test('original run, archive, companion, clock, repository and code tampering all reject',()=>{
  const changes=[
    f=>f.map[f.prefix].owner.id++,f=>f.map[f.prefix].owner.login='other',f=>f.map[f.prefix].visibility='private',
    f=>f.map[`${f.prefix}/actions/runs/${f.request.originals.candidate.run_id}`].run_attempt=2,
    f=>f.map[`${f.prefix}/actions/runs/${f.request.originals.candidate.run_id}/attempts/1`].event='workflow_run',
    f=>f.map[`${f.prefix}/git/commits/${f.request.originals.candidate.head_sha}`].tree.sha='f'.repeat(40),
    f=>f.map[`${f.prefix}/actions/runs/${f.request.originals.prior.run_id}/attempts/1/jobs?per_page=100`][0].jobs[0].id++,
    ...['id','head_sha'].map(key=>f=>f.map[`${f.prefix}/actions/runs/${f.request.originals.candidate.run_id}/artifacts?per_page=100`][0].artifacts[0].workflow_run[key]=key==='id'?1:'0'.repeat(40)),
    f=>f.map[`${f.prefix}/actions/runs/${f.request.originals.candidate.run_id}/artifacts?per_page=100`][0].artifacts[1].digest='sha256:'+'0'.repeat(64),
    f=>f.map[`${f.prefix}/actions/runs/${f.request.originals.candidate.run_id}/artifacts?per_page=100`][0].artifacts.pop(),
    f=>f.map[`${f.prefix}/actions/runs/${f.request.originals.candidate.run_id}/artifacts?per_page=100`][0].artifacts[0].created_at='2026-10-08T00:00:00Z',
    f=>f.map[`${f.prefix}/actions/runs/${f.request.originals.candidate.run_id}/attempts/1/jobs?per_page=100`][0].jobs[0].steps[0].conclusion='failure',
    f=>f.map[`${f.prefix}/actions/runs/${f.request.originals.candidate.run_id}/attempts/1/jobs?per_page=100`][0].total_count=2,
    f=>f.map[`${f.prefix}/git/trees/2186101e92e1f71771936831cea0a40e410975f7?recursive=1`].tree[1].sha='0'.repeat(40)
  ];
  for(const [i,change]of changes.entries()){const f=originalFixture();change(f);assert.throws(()=>f.verify(),undefined,`mutation ${i}`);}
});

test('real disabled CLI completes across the publication-reader import cycle without API work',t=>{
  const root=mkdtempSync(join(tmpdir(),'finite-core-entry-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'.github/scripts'),{recursive:true});
  for(const name of ['retained-price-source-admission.mjs','retained-price-ci-admission.mjs','publication-gate.mjs','immutable-github-api.mjs'])copyFileSync(new URL('./'+name,import.meta.url),join(root,'.github/scripts',name));
  writeFileSync(join(root,'.github/retained-price-oct6-source.json'),JSON.stringify(initial));
  const stdout=execFileSync(process.execPath,[join(root,'.github/scripts/retained-price-source-admission.mjs'),'prepare-controller','--output',join(root,'unused')],{encoding:'utf8',timeout:5000,env:{...process.env,PATH:''}});
  assert.deepEqual(JSON.parse(stdout),{active:false});
});
