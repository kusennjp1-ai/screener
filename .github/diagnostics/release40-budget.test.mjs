import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {quota,safeHeaders,safeCode,checkCohortLowerBound,historyFacts,assess,hash,cohortFacts,safeElapsed,quotaWindows} from './release40-logic.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const q=(remaining=5500,limit=6000,reset=2000000000)=>({limit,used:limit-remaining,remaining,reset_epoch:reset,resource:'core'});
const policies={source:{original_primary:4937,retained_reserve:228,extra_primary:{terminal_miss:16}},publisher:{original_primary:3969,retained_reserve:228,extra_primary:{terminal_miss:16}}};
const phase=()=>({cohort:{membership_sha256:'m',identities_sha256:'i'},inventory:{pages:[]},
  history:{admitted:true,observations:[{quota:q()}],terminal_200:0,page_weights_sha256:'w'}});
test('missing or invalid elapsed time stays unknown, never becomes measured zero',()=>{
  for(const value of [undefined,null,NaN,Infinity,-1,'0'])assert.equal(safeElapsed(value),null);
  assert.equal(safeElapsed(0),0);assert.equal(safeElapsed(1.2),2);
});
test('actual quota is required, including core resource and arithmetic',()=>{
  assert.deepEqual(quota(q()),q());
  for(const missing of Object.keys(q())){const v=q();delete v[missing];assert.throws(()=>quota(v));}
  assert.throws(()=>quota({...q(),used:3}));assert.throws(()=>quota({...q(),resource:'search'}));
});
test('only numerical quota headers survive; no auth, cookie, URL or arbitrary text',()=>{
  assert.deepEqual(safeHeaders({'x-ratelimit-limit':'1000',authorization:'secret','set-cookie':'secret',location:'secret',etag:'secret',
    'x-ratelimit-used':'not-a-number',retry_after_present:true}),{'x-ratelimit-limit':1000,retry_after_present:true});
  assert.equal(safeCode(Error('secret')),'diagnostic-failed');
});
test('193-member lower bound rejects rather than truncates; 192 is admissible',()=>{
  const runs=Array.from({length:193},(_,i)=>({id:i+1,status:'completed'}));
  assert.throws(()=>checkCohortLowerBound(runs,999),/192/);assert.equal(runs.length,193);
  checkCohortLowerBound(runs.slice(0,192),999);
  assert.throws(()=>checkCohortLowerBound([{id:1},{id:2},{id:3}],999),/active/);
});
test('actual multi-page weight rejects oversized complete cohort',()=>{
  const rows=[{id:1,status:'completed'}],pages=Array(193).fill({});
  const actual={status:'complete',jobs:[{run_id:1,pages}],observations:pages.map(()=>({run_id:1,run_key:'r',page_validated:true,
    page_revalidated:false,status:200,quota:q(),elapsed_ms:1,etag_received:null}))};
  const result=historyFacts(actual,rows,999);assert.equal(result.weighted_pages,193);assert.equal(result.admitted,false);
  actual.jobs=[];assert.throws(()=>historyFacts(actual,rows,999),/incomplete/);
});
test('membership digest is order-independent but identity changes are detected',()=>{
  const rows=[{id:2,run_attempt:1,status:'a'},{id:1,run_attempt:1,status:'a'}],key=r=>hash(JSON.stringify(r));
  const a=cohortFacts(rows,key),b=cohortFacts(rows.toReversed(),key);assert.deepEqual(a,b);
  rows[0].status='b';assert.notEqual(a.identities_sha256,cohortFacts(rows,key).identities_sha256);
});
test('genuine 1000-token window does not become an assumed 5000 window',()=>{
  const c=phase(),w=phase();c.history.observations[0].quota=q(900,1000);w.history.observations[0].quota=q(850,1000);
  const result=assess(c,w,q(800,1000),policies,1900000000000);
  assert.equal(result.measured_cohort_accepted,true);assert.equal(result.budgetAccepted,false);
  assert.equal(result.roles.source.actual_window_fits_original_allocation,false);assert.equal(result.whole_release_certified,false);
});
test('positive measured fit remains distinct from full release certification',()=>{
  const result=assess(phase(),phase(),q(),policies,1900000000000);
  assert.equal(result.budgetAccepted,true);assert.equal(result.whole_release_certified,false);assert.equal(result.publication_authority,false);
});
test('changed cohort, quota reset, expired window, warm misses, and native low balance fail acceptance',()=>{
  for(const mutate of [w=>w.cohort.membership_sha256='changed',w=>w.cohort.identities_sha256='changed',
    w=>w.history.page_weights_sha256='changed',w=>w.history.observations[0].quota=q(5500,6000,2000000001),
    w=>w.history.terminal_200=17,w=>w.history.admitted=false]){
    const c=phase(),w=phase();mutate(w);assert.equal(assess(c,w,q(),policies,1900000000000).budgetAccepted,false);
  }
  assert.equal(assess(phase(),phase(),q(),policies,2000000000001).budgetAccepted,false);
  const c=phase(),w=phase();c.inventory.pages=[{safe_headers:{'x-ratelimit-limit':6000,'x-ratelimit-reset':2000000000,'x-ratelimit-remaining':500}}];
  assert.equal(assess(c,w,q(),policies,1900000000000).budgetAccepted,false);
});

test('actual CLI and native reset windows remain separate descriptive observations',()=>{
  const c=phase(),w=phase();c.inventory.pages=[{quota:q(4999,5000,2000000006)}];
  const result=quotaWindows([c,w],[{quota:q(4997,5000,2000000000)},{quota:q(4996,5000,2000000000)}]);
  assert.deepEqual(result.find(r=>r.transport==='cli'),{transport:'cli',resource:'core',limit:5000,reset_epoch:2000000000,
    observed_responses:2,minimum_remaining:4996,maximum_remaining:4997});
  assert.equal(result.find(r=>r.transport==='native-inventory').reset_epoch,2000000006);
  assert.equal(result.length,3);const assessment=assess(c,w,q(),policies);
  assert.equal(assessment.same_quota_window,false);assert.equal(assessment.conservative_minimum_remaining,null);
  assert.equal(assessment.budgetAccepted,false);
  assert.equal(assessment.roles.source.actual_window_fits_original_allocation,false);
  assert.equal(assessment.roles.publisher.actual_window_fits_original_allocation,false);
});

test('fresh production live-anchor prefix and separate cold/warm processes, with adversarial anchor failures',async t=>{
  const root=process.env.RELEASE40_CANDIDATE_ROOT;if(!root){t.skip('Set RELEASE40_CANDIDATE_ROOT for production integration');return;}
  const temp=mkdtempSync(join(tmpdir(),'release40-live-offline-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const before=process.env.RUNNER_TEMP;process.env.RUNNER_TEMP=temp;t.after(()=>{if(before===undefined)delete process.env.RUNNER_TEMP;else process.env.RUNNER_TEMP=before;});
  const cache=await import(pathToFileURL(join(root,'.github/scripts/conditional-deployment-jobs-cache.mjs')));
  const worker=await import(pathToFileURL(join(root,'.github/scripts/conditional-deployment-jobs-worker.mjs')));
  const context={schema_version:'conditional-deployment-jobs-cache-context-v1',repository:'kusennjp1-ai/screener',repository_id:1203919607,
    run_id:999,run_attempt:1,job_id:998,job_name:'Offline synthetic test',job_started_at:new Date(Date.now()-1000).toISOString(),
    role:'diagnostic',controller_sha:'b'.repeat(40),controller_tree:'c'.repeat(40),request_sha256:'d'.repeat(64),event_sha256:'e'.repeat(64),
    reader_version:'265ede759b1714c882015c696c6fac66975ae03a',representation:worker.REQUEST_REPRESENTATION};
  const token='synthetic-no-network-test-token',preload=join(temp,'offline-preload.mjs');
  writeFileSync(preload,`
    import {createHash} from 'node:crypto';
    const REPO='kusennjp1-ai/screener',RID=1203919607,mode=process.env.FIXTURE_MODE??'normal';
    const h=v=>createHash('sha256').update(v).digest('hex');
    export const rows=[11,12,999].map(id=>({id,run_attempt:1,head_sha:'a'.repeat(40),head_branch:id===999?'diagnostic':(mode==='foreign-branch'?'foreign':'main'),workflow_id:id===12?364666954:id===11?294257497:777,
      path:'.github/workflows/'+(id===12?'research-ui-release.yml':id===11?'static-site.yml':'diagnostic.yml'),name:'Synthetic workflow',event:'push',
      repository:{id:mode==='foreign-repository'?1:RID,full_name:REPO},head_repository:{id:RID,full_name:REPO},status:'completed',conclusion:'success',
      created_at:'2026-10-09T01:00:00Z',run_started_at:'2026-10-09T01:00:00Z',updated_at:'2026-10-09T01:10:00Z'}));
    export const job=row=>({id:row.id*10,run_id:mode==='foreign-job'?1:row.id,run_attempt:1,head_sha:row.head_sha,head_branch:row.head_branch,workflow_name:row.name,name:'Synthetic job',
      run_url:'https://api.github.com/repos/'+REPO+'/actions/runs/'+row.id,url:'https://api.github.com/repos/'+REPO+'/actions/jobs/'+row.id*10,
      status:'completed',conclusion:'success',created_at:'2026-10-09T01:00:01Z',started_at:'2026-10-09T01:00:02Z',completed_at:'2026-10-09T01:00:06Z',
      steps:[{number:1,name:mode==='no-deployment'?'Synthetic step':'Deploy to GitHub Pages',status:'completed',conclusion:'success',started_at:'2026-10-09T01:00:03Z',completed_at:'2026-10-09T01:00:'+(row.id===11?'04':'05')+'Z'}]});
    const manifest={as_of_date:'2026-10-09',default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:'2026-10-09'}}};
    const ui={'index.html':h('html'),'sw.js':h('sw')},prices={'["US","chart","A"]':'2026-10-09'};
    const receipt={schema:1,run_id:12,run_attempt:1,controller_sha:'a'.repeat(40),ui_sha:'a'.repeat(40),ui_files:ui,ui_digest:h(JSON.stringify(ui)),
      artifact_name:'github-pages-12-1',data_manifest_sha256:h(JSON.stringify(manifest)),price_observations:prices,known_price_dates:prices,
      verification_universe:{as_of_date:'2026-10-09',minimum_target:0.9,total:1,verified:1,required_symbols:['A']}};
    let publicCalls=0;
    globalThis.fetch=async(url,init)=>{
      const headers={'x-ratelimit-limit':'6000','x-ratelimit-remaining':'5500','x-ratelimit-used':'500',
        'x-ratelimit-reset':'2000000000','x-ratelimit-resource':'core','content-type':'application/json',etag:'"original"'};
      let value,status=200;
      if(url.startsWith('https://kusennjp1-ai.github.io/screener/')){
        publicCalls++;if(init.credentials!=='omit'||init.headers.authorization||init.headers.Authorization)throw Error('public-auth-forbidden');
        const u=new URL(url);if(u.pathname==='/screener/publication.json'){
          if(mode==='missing-receipt')status=404;
          if(mode==='oversized-receipt')return new Response('x'.repeat(4*1024*1024+1),{status:200});
          if(mode==='invalid-utf8')return new Response(new Uint8Array([255]),{status:200});
          value={...receipt,...((mode==='changed-receipt'&&publicCalls>2)||mode==='different-receipt'?{diagnostic_nonce:1}:{})};
          if(mode==='duplicate-receipt')return new Response(JSON.stringify(value).replace('"schema":1','"schema":1,"schema":1'),{status:200});
        }else if(u.pathname==='/screener/static-data/manifest.json')value={...manifest,...(mode==='bad-manifest'?{changed:true}:{})};
        else throw Error('NETWORK FORBIDDEN: public route');
      }else if(url==='https://api.github.com/repositories/'+RID+'/actions/runs?per_page=50&page=1')value={total_count:rows.length,workflow_runs:rows};
      else{
        const row=rows.find(r=>url==='https://api.github.com/repos/'+REPO+'/actions/runs/'+r.id+'/jobs?filter=all&per_page=100');
        if(!row)throw Error('NETWORK FORBIDDEN: unexpected route');
        if(init.headers['if-none-match'])status=304;
        value={total_count:1,jobs:[job(row)]};
      }
      if(mode==='missing-native-resource'&&!url.startsWith('https://kusennjp1-ai.github.io/'))delete headers['x-ratelimit-resource'];
      const response=new Response(status===304?null:JSON.stringify(value),{status,headers});
      Object.defineProperty(response,'url',{value:mode==='foreign-response-url'?'https://other.invalid/secret':url});
      if(mode==='redirected')Object.defineProperty(response,'redirected',{value:true});return response;
    };
  `);
  const gh=join(temp,'gh');
  writeFileSync(gh,'#!'+process.execPath+'\n'+`
    import {rows,job} from ${JSON.stringify(pathToFileURL(preload).href)};
    const route=process.argv[3].replace('https://api.github.com/','');
    const prefix='repos/kusennjp1-ai/screener/actions/runs/12/attempts/1';
    let value;if(route===prefix)value=rows.find(r=>r.id===12);else if(route===prefix+'/jobs?per_page=100')value={total_count:1,jobs:[job(rows.find(r=>r.id===12))]};
    else throw Error('NO NETWORK: unknown GH route');
    process.stdout.write('HTTP/2.0 200 OK\\r\\nx-ratelimit-limit: 6000\\r\\nx-ratelimit-used: 500\\r\\nx-ratelimit-remaining: 5500\\r\\nx-ratelimit-reset: 2000000000\\r\\nx-ratelimit-resource: core\\r\\ncontent-type: application/json\\r\\n\\r\\n'+JSON.stringify(value));
  `,{mode:0o700});
  const init=()=>{const h=cache.initializeJobCache({context,root:temp,token});const directory=h.directory;h.dispose('complete');return directory;};
  const launch=(directory,phase,mode='normal',expected_anchor=null)=>{
    const output=join(temp,phase+'-'+mode+'.json');let printed='';
    try{printed=execFileSync(process.execPath,[join(here,'release40-phase.mjs')],{encoding:'utf8',
      input:JSON.stringify({candidateRoot:resolve(root),context,directory,phase,output,expected_anchor}),
      env:{...process.env,PATH:temp+':'+process.env.PATH,GH_TOKEN:token,RUNNER_TEMP:temp,NODE_OPTIONS:'--import='+preload,FIXTURE_MODE:mode},timeout:10000});}
    catch(error){printed=String(error.stdout??'');}
    assert.equal(printed.includes(token),false);const raw=readFileSync(output,'utf8');assert.equal(raw.includes(token),false);return JSON.parse(raw);
  };
  await t.test('fresh anchor determines cutoff; complete production cold/warm cache works',()=>{
    const directory=init(),cold=launch(directory,'cold'),warm=launch(directory,'warm','normal',cold.anchor);
    assert.equal(cold.status,'complete',JSON.stringify(cold));assert.equal(warm.status,'complete',JSON.stringify(warm));
    assert.equal(cold.cutoff,'2026-10-09T01:00:05.000Z');assert.equal(cold.history.http_200,2);assert.equal(warm.history.http_304,2);
    assert.equal(cold.cohort.identities_sha256,warm.cohort.identities_sha256);assert.equal(warm.cache_before.pages,2);
    assert.equal(assess(cold,warm,q(),policies,Date.now(),[...cold.anchor_ledger.cli,...warm.anchor_ledger.cli]).budgetAccepted,true);
    assert.equal(cold.anchor.full_live_publication_verified,false);assert.equal(cold.anchor_ledger.public.length,4);assert.equal(cold.anchor_ledger.starts,4);
    const missingResource=structuredClone(cold);delete missingResource.inventory.pages[0].quota.resource;
    assert.equal(assess(missingResource,warm,q(),policies).budgetAccepted,false);
    assert.deepEqual(cache.cleanupJobCache({context,directory,token}),{removed:true});
  });
  for(const mode of ['missing-receipt','duplicate-receipt','bad-manifest','foreign-branch','foreign-job','foreign-repository','no-deployment','changed-receipt','oversized-receipt','invalid-utf8','foreign-response-url','redirected','missing-native-resource']){
    await t.test('fail closed for '+mode,()=>{const directory=init(),result=launch(directory,'cold',mode);
      assert.equal(result.status,'failed');assert.equal(result.budgetAccepted,false);cache.cleanupJobCache({context,directory,token});});
  }
  await t.test('warm rejects a newly changed receipt before cohort/history requests',()=>{
    const directory=init(),cold=launch(directory,'cold'),warm=launch(directory,'warm','different-receipt',cold.anchor);
    assert.equal(warm.status,'failed');assert.equal(warm.reason,'live-anchor-changed');assert.equal(warm.inventory,undefined);
    cache.cleanupJobCache({context,directory,token});
  });
});
