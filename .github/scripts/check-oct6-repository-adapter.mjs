// Read-only integration check for the finite inventory adapter; no source work.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {withInvocationImmutableGitApi,githubApi} from './publication-gate.mjs';
import {livePublication} from './publication-state.mjs';
import {createRetainedPriceLiveApi} from './retained-price-live-inventory.mjs';
const repo='kusennjp1-ai/screener',base=new URL('https://kusennjp1-ai.github.io/screener/');
const expected='37456692717/1/0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a/ab65c8bb05f33cadd1eec71c858ed67a6ba7578ed9772c7d9ccbf24873161dd0';
const hash=v=>createHash('sha256').update(v).digest('hex');
assert(process.env.GITHUB_REPOSITORY===repo&&process.env.GITHUB_EVENT_NAME==='push'
  &&process.env.GITHUB_REF==='refs/heads/preview/oct6-repository-adapter-check-20261007'&&process.env.GITHUB_RUN_ATTEMPT==='1','Wrong check invocation');
assert(execFileSync('git',['rev-parse','HEAD^'],{encoding:'utf8'}).trim()==='c532430b7f8bf2c6c59075a5066fb103320408ae','Wrong check parent');
assert(Date.now()<Date.parse('2026-10-08T00:00:02Z'),'Read-only check window expired');
const out=resolve(process.env.RUNNER_TEMP,'oct6-repository-adapter-check');mkdirSync(out,{recursive:false});
const report={schema_version:'oct6-repository-adapter-check-v1',head:process.env.GITHUB_SHA,run_id:Number(process.env.GITHUB_RUN_ID),run_attempt:1,
  started_at:new Date().toISOString(),status:'running',source_authority:false,publication_authority:false,reads:[],inventories:[]};
const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
const signal=AbortSignal.timeout(240000);let total=0,index=0;
const fetcher=async(url,options)=>{
  const target=new URL(url);assert(target.origin===base.origin&&target.pathname.startsWith(base.pathname),'Unexpected public source origin');
  const response=await fetch(target,{...options,signal,cache:'no-store',redirect:'error'});
  assert(response.ok,'Public read failed: '+response.status+' '+target.pathname);
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.byteLength;total+=chunk.byteLength;assert(bytes<=32*1024**2&&total<=128*1024**2,'Public read byte bound');chunks.push(chunk);}
  const body=Buffer.concat(chunks),path=target.pathname.slice(base.pathname.length);
  const item={path,status:response.status,bytes:body.length,sha256:hash(body),checked_at:new Date().toISOString()};report.reads.push(item);
  if(path==='publication.json'||path==='static-data/manifest.json'){const filename=String(++index).padStart(2,'0')+'-'+(path==='publication.json'?'publication.json':'manifest.json');writeFileSync(join(out,filename),body);item.retained_file=filename;}
  save();return new Response(body,{status:response.status,headers:response.headers});
};
try{
  const live=await withInvocationImmutableGitApi(repo,()=>livePublication({repository:repo,fetcher,
    api:createRetainedPriceLiveApi(githubApi,{requiredIds:[37456692717,report.run_id],report:e=>{report.inventories.push(e);save();}})}));
  assert.equal(live.identity,expected,'Published predecessor changed');
  assert.equal(live.uiSha,'1e1943e1d5f78a738a05baa69eb9f2e8508e32ac');
  assert.equal(live.receipt.financial_lineage_sha256,'2828fbf2d497ae32c29ddb46a34903a9c1c8494862e127ba67dff9880e356a13');
  assert.equal(live.receipt.financial_generation,'69c80cd8bfa2a4bedf891aea1e82229b4d6768e59914f15fb9ef9e09b51c7de7');
  assert.equal(report.inventories.filter(e=>e.status==='complete').length,2,'Expected two genuinely fresh repository rounds');
  assert.equal(report.inventories.filter(e=>e.reused_immediate_snapshot===true).length,2,'Expected only the immediate paired projections');
  report.status='passed';report.identity=live.identity;report.ui_sha=live.uiSha;report.ui_digest=live.uiDigest;
  report.financial_lineage_sha256=live.receipt.financial_lineage_sha256;report.financial_generation=live.receipt.financial_generation;
  report.receipt_sha256=live.receiptHash;report.manifest_sha256=live.manifestHash;
}catch(error){report.status='failed';report.error=String(error.message).slice(0,1000);process.exitCode=1;}
finally{report.finished_at=new Date().toISOString();report.public_bytes=total;save();console.log(JSON.stringify(report));}
