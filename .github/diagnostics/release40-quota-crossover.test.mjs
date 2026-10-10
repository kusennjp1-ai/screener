import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TARGET, SEQUENCE, LIMITS, PROFILE, DiagnosticError, assertTarget, reduceHeaders, verifyBody,
  parseGhOutput, ghEnvironment, ghArguments, collectProcess, createTransport, safeEnvironment,
  classify, serializeSafe, runCrossover } from './release40-quota-crossover.mjs';
import { verifyContext } from './release40-quota-crossover-main.mjs';
const SECRET='fixture-only-SENSITIVE-credential-never-persist';
const NOW=Date.parse('2026-10-10T05:00:00Z');
const BODY=JSON.stringify({id:37456692717,run_attempt:1,repository:{id:1203919607,full_name:'kusennjp1-ai/screener'},
  head_repository:{id:1203919607,full_name:'kusennjp1-ai/screener'},head_sha:'8a490df5b0a873637781a8e4e5351cece9313f37',
  head_branch:'main',path:'.github/workflows/research-ui-release.yml',event:'workflow_run',status:'completed',conclusion:'success'});
function headers({remaining=4000,reset=NOW/1000+3600,date=NOW,...extras}={}) { return Object.entries({
  'x-ratelimit-resource':'core','x-ratelimit-limit':'5000','x-ratelimit-remaining':String(remaining),
  'x-ratelimit-used':String(5000-remaining),'x-ratelimit-reset':String(reset),'date':new Date(date).toUTCString(),
  'x-github-request-id':'AB12:1234:5678:ABCD:'+Math.floor(date/1000).toString(16).toUpperCase(),'cache-control':'private, max-age=60, s-maxage=60',
  'vary':'Accept, Authorization, Cookie','x-github-api-version-selected':'2022-11-28',...extras}); }
function response(options={}) { return {status:200,headers:headers(options),body:BODY,
  final_url_equal:true,redirected:false,process_exit_ok:true}; }
async function scenario({mutate,advance=100,start=NOW,token=SECRET,env={GH_TOKEN:SECRET},sleepMutate}={}) {
  let time=start,calls=0; const starts=[];
  const report=await runCrossover({token,env,wall:()=>time,monotonic:()=>time-start,
    sleep:async ms=>{time+=ms;sleepMutate?.(env);},request:async args=>{
      starts.push({arm:args.arm,url:args.url,time}); calls++; const value=response({date:time,remaining:4000-calls});
      time+=advance; if(mutate) return (await mutate(value,calls,args,env))??value; return value;
    }});
  return {report,calls,starts};
}
function nativeResponse({body=BODY,status=200,url=TARGET,redirected=false,pairs=headers()}={}) {
  return {status,url,redirected,headers:new Headers(pairs),body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(body));c.close();}})};
}
function rawGh({body=BODY,status=200,pairs=headers()}={}) { return Buffer.from(`HTTP/2.0 ${status} OK\r\n`+pairs.map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n'+body); }

test('fixed twelve-arm sequence and reserve are immutable',()=>{assert.equal(SEQUENCE.join(','),'C,T,C,B,C,B,C,T,C,T,C,B');assert.equal(LIMITS.invocations,12);assert.equal(LIMITS.retained_reserve,228);assert.ok(Object.isFrozen(SEQUENCE));});
test('complete successful measurement never grants quota or release authority',async()=>{
  const {report,calls,starts}=await scenario(); assert.equal(calls,12); assert.equal(report.measurement_succeeded,true);
  assert.equal(report.budgetAccepted,false);assert.equal(report.quota_credit_granted,false);assert.equal(report.whole_release_certified,false);
  assert.equal(report.outcome,'split-not-reproduced');assert.equal(report.internal_gh_wire_requests,null);assert.equal(report.wire_request_bound_proven,false);
  assert.ok(starts.every(s=>s.url===TARGET));assert.ok(starts.slice(1).every((s,i)=>s.time-starts[i].time>=1000));
  assert.equal(serializeSafe(report,SECRET).includes(SECRET),false);
});
test('explicit profile covers native implicit headers and all application headers',()=>{
  assert.deepEqual(Object.keys(PROFILE).sort(),['Accept','Accept-Encoding','Accept-Language','Cache-Control','Content-Type','Pragma','Sec-Fetch-Mode','Time-Zone','User-Agent','X-GitHub-Api-Version'].sort());
  const args=ghArguments();assert.equal(args.includes('--paginate'),false);assert.equal(args.includes('--cache'),false);
  assert.equal(args.includes(SECRET),false);assert.ok(!args.join(' ').includes('Authorization:'));
  assert.equal(args[args.indexOf('--method')+1],'GET');
});
for(const url of ['http://api.github.com/repos/kusennjp1-ai/screener/actions/runs/37456692717/attempts/1',
  TARGET+'?page=2',TARGET+'#fragment',TARGET.replace('api.github.com','evil.example'),TARGET.replace('screener','foreign'),
  TARGET.replace('/attempts/1','/cancel'),TARGET.replace('https://','https://user:password@'),TARGET+'/']) {
  test('reject non-exact target '+url.replace(/user:password@/,'userinfo@'),()=>assert.throws(()=>assertTarget(url),{code:'invalid-target'}));
}
test('missing quota values remain null and do not become numeric zero',()=>{
  const result=reduceHeaders([]);assert.deepEqual(result.quota,{resource:null,limit:null,remaining:null,used:null,reset_epoch:null});
  assert.equal(result.valid_quota,false);assert.equal(result.response_date,null);assert.equal(result.request_id,null);assert.equal(result.cache.age,null);
});
for(const bad of ['', '1.5','1e3','-1','NaN','Infinity',' 2','02','9007199254740993']) test('invalid quota integer '+JSON.stringify(bad),()=>{
  const result=reduceHeaders(headers({'x-ratelimit-remaining':bad}));assert.equal(result.quota.remaining,null);assert.equal(result.valid_quota,false);
});
test('contradictory quota arithmetic is rejected',()=>assert.equal(reduceHeaders(headers({'x-ratelimit-used':'1'})).valid_quota,false));
test('foreign quota resource is null and rejected',()=>{const r=reduceHeaders(headers({'x-ratelimit-resource':'graphql'}));assert.equal(r.quota.resource,null);assert.equal(r.valid_quota,false);});
test('duplicate and malformed header entries fail closed',()=>{
  for(const extra of [[['Date','Sat, 10 Oct 2026 05:00:00 GMT']],[['x-ratelimit-remaining','4000']],[['evil\r\nname','value']],[['x-test','value\r\nsecret']],[['unpaired']]])
    assert.equal(reduceHeaders([...headers(),...extra]).malformed_headers,true);
});
test('headers are capped without retaining arbitrary values',()=>assert.throws(()=>reduceHeaders([['x-test','x'.repeat(LIMITS.header_bytes)]]),{code:'header-cap'}));
test('strict safe metadata excludes secrets, cookies, scopes, arbitrary values and destinations',()=>{
  const result=reduceHeaders(headers({'date':SECRET,'x-github-request-id':SECRET,'cache-control':SECRET,'vary':SECRET,
    'age':SECRET,'x-cache':SECRET,'x-github-api-version-selected':SECRET,'via':SECRET,'location':'https://'+SECRET,
    'set-cookie':SECRET,'x-oauth-scopes':SECRET,'arbitrary-secret':SECRET}));
  assert.equal(JSON.stringify(result).includes(SECRET),false);assert.equal(result.request_id,null);assert.equal(result.response_date,null);
  assert.equal(result.cache.location_present,true);assert.equal(result.cache.via_present,true);assert.equal(result.cache.cache_value_rejected,true);
});
test('final containment guard rejects a credential-shaped allowed value without serializing it',()=>{
  assert.throws(()=>serializeSafe({request_id:'AB12:1234:5678:ABCD:9876'},'AB12:1234:5678:ABCD:9876'),{code:'unsafe-output'});
});
test('exact verified fixed-repository run body is required and never returned',()=>{assert.equal(verifyBody(BODY),true);
  assert.throws(()=>verifyBody(BODY.replace('37456692717','37456692718')),{code:'identity-mismatch'});
  assert.throws(()=>verifyBody('{bad'),{code:'malformed-response'});assert.throws(()=>verifyBody('x'.repeat(LIMITS.body_bytes+1)),{code:'body-cap'});
});
test('secret-containing extra body fields are discarded in artifact',async()=>{
  const {report}=await scenario({mutate:r=>({...r,body:BODY.slice(0,-1)+',"private":"'+SECRET+'"}'})});
  assert.equal(report.measurement_succeeded,true);assert.equal(serializeSafe(report,SECRET).includes(SECRET),false);
});
for(const [name,mutate,reason] of [
  ['denial',r=>({...r,status:403}),'status-not-200'],['missing quota',r=>({...r,headers:[]}),'invalid-quota'],
  ['retry-after',r=>({...r,headers:[...r.headers,['Retry-After','60']]}),'retry-after-present'],
  ['observed redirect',r=>({...r,status:302}),'redirect-observed'],['Location',r=>({...r,headers:[...r.headers,['Location','https://evil.example']]}),'redirect-observed'],
  ['bad identity',r=>({...r,body:'{}'}),'identity-mismatch'],['duplicate quota',r=>({...r,headers:[...r.headers,['x-ratelimit-used','1']]}),'malformed-headers'],
  ['nonzero CLI',r=>({...r,process_exit_ok:false}),'gh-nonzero'],['too little reserve',r=>({...r,headers:headers({remaining:238})}),'insufficient-diagnostic-reserve'],
  ['malformed body',r=>({...r,body:'invalid'}) ,'malformed-response']]) {
  test('abort immediately after '+name,async()=>{const {report,calls}=await scenario({mutate});assert.equal(calls,1);assert.equal(report.stop_reason,reason);assert.equal(report.budgetAccepted,false);});
}
test('untrusted exception text is not retained',async()=>{const {report,calls}=await scenario({mutate:()=>{throw new Error(SECRET);}});
  assert.equal(calls,1);assert.equal(report.stop_reason,'unexpected-failure');assert.equal(serializeSafe(report,SECRET).includes(SECRET),false);
});
test('missing token performs zero requests',async()=>{const {report,calls}=await scenario({token:''});assert.equal(calls,0);assert.equal(report.stop_reason,'missing-credential');});
test('binding change after response prevents second request',async()=>{
  const {report,calls}=await scenario({mutate:(r,n,args,env)=>{env.GH_TOKEN='another-fixture';return r;}});
  assert.equal(calls,1);assert.equal(report.stop_reason,'credential-binding-changed');
});
test('binding change during spacing prevents next request',async()=>{
  const {report,calls}=await scenario({sleepMutate:env=>{env.GH_TOKEN='another-fixture';}});assert.equal(calls,1);assert.equal(report.stop_reason,'credential-binding-changed');
});
test('enclosing reset boundary stops without new credit',async()=>{
  const {report,calls}=await scenario({mutate:r=>({...r,headers:headers({reset:NOW/1000})})});
  assert.equal(calls,1);assert.equal(report.stop_reason,'reset-boundary-crossed');assert.equal(report.quota_credit_granted,false);
});
test('a previously observed reset boundary prevents another arm from obtaining credit',async()=>{
  const {report,calls}=await scenario({mutate:(r,n)=>({...r,headers:headers({reset:NOW/1000+(n===1?2:3600),date:NOW+(n-1)*1000})})});
  assert.equal(calls,2);assert.equal(report.stop_reason,'reset-boundary-crossed');
});
test('per-call overrun and total deadline are terminal without retries',async()=>{
  const {report,calls}=await scenario({advance:LIMITS.per_call_ms+1});assert.equal(calls,1);assert.equal(report.stop_reason,'total-deadline');
  let time=0,c=0;const r=await runCrossover({token:SECRET,env:{GH_TOKEN:SECRET},wall:()=>NOW,monotonic:()=>time,
    sleep:async()=>{time=LIMITS.total_ms;},request:async()=>{c++;return response();}});
  assert.equal(c,1);assert.equal(r.stop_reason,'total-deadline');
});
test('mixed windows are observations only; report scheme association without causal component claim',async()=>{
  const {report}=await scenario({mutate:(r,n,a)=>({...r,headers:headers({date:NOW+(n-1)*1000,reset:NOW/1000+3600+(a.arm==='B'?6:0)})})});
  assert.equal(report.outcome,'scheme-associated-window-split-reproduced');assert.equal(report.budgetAccepted,false);
});
test('native arms equal with CLI split does not support scheme-only explanation',async()=>{
  const {report}=await scenario({mutate:(r,n,a)=>({...r,headers:headers({date:NOW+(n-1)*1000,reset:NOW/1000+3600+(a.arm==='C'?0:6)})})});
  assert.equal(report.outcome,'scheme-alone-not-supported-cli-native-split');
});
test('within-arm window variation is inconclusive',async()=>{
  const {report}=await scenario({mutate:(r,n)=>({...r,headers:headers({date:NOW+(n-1)*1000,reset:NOW/1000+3600+(n===1?1:0)})})});
  assert.equal(report.outcome,'inconclusive-within-arm-variation');
});
for(const extra of [{age:'1'},{date:NOW-60000},{'cache-control':SECRET}]) test('stale, aged or rejected cache metadata stays inconclusive '+Object.keys(extra),async()=>{
  const {report}=await scenario({mutate:(r,n)=>({...r,headers:headers({date:NOW+(n-1)*1000,...extra})})});assert.equal(report.outcome,'inconclusive-freshness');
});
test('gh parser preserves safe status and parses body only in memory',()=>{const r=parseGhOutput(rawGh());assert.equal(r.status,200);assert.equal(verifyBody(r.body),true);assert.equal(r.final_url_equal,null);assert.equal(r.redirected,null);});
test('gh parser rejects malformed header block and multiple response blocks',()=>{
  assert.throws(()=>parseGhOutput(Buffer.from('secret error body')),{code:'malformed-response'});
  assert.throws(()=>parseGhOutput(rawGh({body:'HTTP/2.0 200 OK\n\n'+BODY})),{code:'redirect-observed'});
  assert.throws(()=>parseGhOutput(Buffer.from('HTTP/2.0 200 OK\n bad: fold\n\n{}')),{code:'malformed-headers'});
});
test('gh environment uses same captured reference, clears fallbacks, preserves proxy/security values',()=>{
  const original={GH_TOKEN:SECRET,GITHUB_TOKEN:'fallback',GH_ENTERPRISE_TOKEN:'other',GITHUB_ENTERPRISE_TOKEN:'third',HTTPS_PROXY:'private-proxy',NODE_EXTRA_CA_CERTS:'/existing-certs'};
  const env=ghEnvironment(original,SECRET,'/empty/config');assert.equal(env.GH_TOKEN,SECRET);assert.equal(env.GITHUB_TOKEN,undefined);assert.equal(env.GH_ENTERPRISE_TOKEN,undefined);
  assert.equal(env.HTTPS_PROXY,original.HTTPS_PROXY);assert.equal(env.NODE_EXTRA_CA_CERTS,original.NODE_EXTRA_CA_CERTS);assert.equal(env.GH_CONFIG_DIR,'/empty/config');
  const safe=safeEnvironment(original);assert.equal(JSON.stringify(safe).includes(SECRET),false);assert.equal(JSON.stringify(safe).includes('private-proxy'),false);
  assert.ok(Object.values(safe.presence).every(v=>typeof v==='boolean'));
});
test('native token/Bearer requests differ only in authorization scheme',async()=>{
  const captured=[];const transport=createTransport({token:SECRET,env:{GH_TOKEN:SECRET},configDirectory:'/empty',fetchImpl:async(url,options)=>{
    captured.push({url,options});return nativeResponse();}});
  await transport({arm:'T',url:TARGET,timeoutMs:1000});await transport({arm:'B',url:TARGET,timeoutMs:1000});
  assert.equal(captured[0].options.headers.Authorization,'token '+SECRET);assert.equal(captured[1].options.headers.Authorization,'Bearer '+SECRET);
  for(const c of captured){assert.equal(c.url,TARGET);assert.equal(c.options.redirect,'error');assert.equal(c.options.method,'GET');assert.equal(c.options.cache,'no-store');assert.equal(c.options.credentials,'omit');delete c.options.headers.Authorization;delete c.options.signal;}
  assert.deepEqual(captured[0],captured[1]);
});
test('native timeout ignores error text and issues just one invocation',async()=>{
  let n=0;const t=createTransport({token:SECRET,env:{GH_TOKEN:SECRET},configDirectory:'/empty',fetchImpl:()=>{n++;return new Promise(()=>{});}});
  await assert.rejects(t({arm:'B',url:TARGET,timeoutMs:10}),{code:'call-timeout'});assert.equal(n,1);
});
test('native redirect/error has no fallback retry and no unsafe error text',async()=>{
  let n=0;const t=createTransport({token:SECRET,env:{GH_TOKEN:SECRET},configDirectory:'/empty',fetchImpl:async()=>{n++;throw new Error('redirect '+SECRET);}});
  await assert.rejects(t({arm:'B',url:TARGET,timeoutMs:1000}),{code:'native-fetch-failed'});assert.equal(n,1);
});
for(const [name,result,code] of [['redirect',nativeResponse({redirected:true}),'redirect-observed'],
  ['changed URL',nativeResponse({url:'https://evil.example'}),'unexpected-final-url'],
  ['oversized body',nativeResponse({body:'x'.repeat(LIMITS.body_bytes+1)}),'body-cap']]) test('native rejects '+name,async()=>{
  const t=createTransport({token:SECRET,env:{GH_TOKEN:SECRET},configDirectory:'/empty',fetchImpl:async()=>result});
  await assert.rejects(t({arm:'T',url:TARGET,timeoutMs:1000}),{code});
});
test('gh receives no credential argument and preserves unknown wire count',async()=>{
  let n=0;const t=createTransport({token:SECRET,env:{GH_TOKEN:SECRET},configDirectory:'/empty',processImpl:async(binary,args,options)=>{
    n++;assert.equal(binary,'/usr/bin/gh');assert.equal(args.includes(SECRET),false);assert.equal(options.env.GH_TOKEN,SECRET);return {output:rawGh(),exit_ok:true};}});
  const r=await t({arm:'C',url:TARGET,timeoutMs:1000});assert.equal(n,1);assert.equal(r.final_url_equal,null);
});
function mockSpawn(action) {let calls=0,kills=0;return {get calls(){return calls;},get kills(){return kills;},spawn:()=>{
  calls++;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{kills++;};queueMicrotask(()=>action(child));return child;
}};}
test('process capture caps stdout and ignores raw output after failure',async()=>{
  const m=mockSpawn(c=>c.stdout.write('x'.repeat(20)));await assert.rejects(collectProcess('/gh',[],{env:{},timeoutMs:100,maxOutput:10,spawnImpl:m.spawn}),{code:'output-cap'});assert.equal(m.calls,1);assert.equal(m.kills,1);
});
test('process capture caps stderr without retaining its content',async()=>{
  const m=mockSpawn(c=>c.stderr.write(SECRET.repeat(500)));await assert.rejects(collectProcess('/gh',[],{env:{},timeoutMs:100,spawnImpl:m.spawn}),{code:'stderr-cap'});assert.equal(m.calls,1);
});
test('process timeout kills the child with no retry',async()=>{
  const m=mockSpawn(()=>{});await assert.rejects(collectProcess('/gh',[],{env:{},timeoutMs:10,spawnImpl:m.spawn}),{code:'call-timeout'});assert.equal(m.calls,1);assert.equal(m.kills,1);
});
test('process error maps to fixed safe code',async()=>{
  const m=mockSpawn(c=>c.emit('error',new Error(SECRET)));await assert.rejects(collectProcess('/gh',[],{env:{},timeoutMs:100,spawnImpl:m.spawn}),{code:'gh-process-error'});
});
test('workflow and config are diagnostic-only, candidate pinned, no runtime secret inputs or write permissions',()=>{
  const config=JSON.parse(readFileSync(new URL('./release40-quota-crossover-config.json',import.meta.url)));
  const workflow=readFileSync(new URL('../workflows/release40-quota-crossover.yml',import.meta.url),'utf8');
  assert.equal(config.candidate_sha,'c2b90868d3c9e23b731172d1181345b795963f99');assert.equal(config.candidate_files.length,40);
  assert.ok(workflow.includes('contents: read'));assert.ok(workflow.includes('actions: read'));assert.ok(workflow.includes('GH_TOKEN: ${{ github.token }}'));
  assert.ok(!/write|workflow_dispatch|inputs:|secrets\.|deploy-pages|upload-pages|release create|git push/.test(workflow));
  assert.equal((workflow.match(/persist-credentials: false/g)||[]).length,2);assert.equal(config.diagnostic_files.length,6);
});
test('runtime context rejects rerun, wrong repository/branch, manual trigger, debug and TLS key logging',()=>{
  const config={branch:'diagnostic/release40-quota-crossover-20261010'};
  const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kusennjp1-ai/screener',GITHUB_REPOSITORY_ID:'1203919607',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/'+config.branch,
    GITHUB_WORKFLOW_SHA:'a'.repeat(40),GITHUB_SHA:'a'.repeat(40),GITHUB_JOB:'measure',GITHUB_RUN_ID:'38000000000',GITHUB_RUN_ATTEMPT:'1'};
  assert.equal(verifyContext(env,config),true);
  for(const change of [{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/main'},{GITHUB_EVENT_NAME:'workflow_dispatch'},{GH_DEBUG:'api'},{NODE_OPTIONS:'--inspect'},{SSLKEYLOGFILE:'/private'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'},{NODE_DEBUG:'child_process'},{NODE_DEBUG_NATIVE:'*'}])
    assert.throws(()=>verifyContext({...env,...change},config));
});
test('repeated request IDs remain inconclusive even with near-current Date',async()=>{
  const {report}=await scenario({mutate:(r,n)=>({...r,headers:headers({date:NOW+(n-1)*1000,'x-github-request-id':'AB12:1234:5678:ABCD:9876'})})});
  assert.equal(report.outcome,'inconclusive-freshness');
});
test('missing Cache-Control stays inconclusive without fabricating a cache conclusion',async()=>{
  const {report}=await scenario({mutate:r=>({...r,headers:r.headers.filter(([k])=>k!=='cache-control')})});
  assert.equal(report.outcome,'inconclusive-freshness');
});
test('CLI output buffer is zeroed even when parsing fails',async()=>{
  const buffer=Buffer.from('malformed '+SECRET);const t=createTransport({token:SECRET,env:{GH_TOKEN:SECRET},configDirectory:'/empty',
    processImpl:async()=>({output:buffer,exit_ok:false})});
  await assert.rejects(t({arm:'C',url:TARGET,timeoutMs:1000}),{code:'malformed-response'});assert.ok(buffer.every(byte=>byte===0));
});
test('incomplete native body is canceled when reading rejects',async()=>{
  let canceled=0;const reader={read:async()=>{throw new Error(SECRET);},cancel:async()=>{canceled++;},releaseLock:()=>{}};
  const result={status:200,url:TARGET,redirected:false,headers:new Headers(headers()),body:{getReader:()=>reader}};
  const t=createTransport({token:SECRET,env:{GH_TOKEN:SECRET},configDirectory:'/empty',fetchImpl:async()=>result});
  await assert.rejects(t({arm:'T',url:TARGET,timeoutMs:1000}));assert.equal(canceled,1);
});
test('native pre-reader header rejection explicitly cancels body',async()=>{
  let canceled=0;const result={status:200,url:TARGET,redirected:false,
    headers:new Headers([['x-unknown','x'.repeat(LIMITS.header_bytes+1)]]),body:{cancel:async()=>{canceled++;}}};
  const t=createTransport({token:SECRET,env:{GH_TOKEN:SECRET},configDirectory:'/empty',fetchImpl:async()=>result});
  await assert.rejects(t({arm:'T',url:TARGET,timeoutMs:1000}),{code:'header-cap'});assert.equal(canceled,1);
});
test('known cache HIT keeps observations inconclusive',async()=>{
  const {report}=await scenario({mutate:r=>({...r,headers:[...r.headers,['x-cache','HIT']]})});assert.equal(report.outcome,'inconclusive-freshness');
});
test('native wrong origin stops the series at that sample',async()=>{
  const {report,calls}=await scenario({mutate:(r,n)=>n===2?{...r,final_url_equal:false}:r});
  assert.equal(calls,2);assert.equal(report.stop_reason,'unexpected-final-url');
});
test('proof verification rejects candidate/overlay mutation, extra scope, and wrong parent',async()=>{
  const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');
  const {verifyCandidate,verifyOverlay,hash}=await import('./release40-quota-crossover-main.mjs');
  const root=mkdtempSync(join(tmpdir(),'quota-crossover-proof-'));
  const git=(...args)=>execFileSync('/usr/bin/git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const commit=message=>git('-c','user.name=Offline Fixture','-c','user.email=offline@example.invalid','-c','commit.gpgsign=false','commit','-qm',message);
  try {
    git('init','-q');mkdirSync(join(root,'.github/scripts'),{recursive:true});
    const files=Array.from({length:40},(_,i)=>({path:'.github/scripts/f'+i+'.mjs',sha256:hash('fixture\n')}));
    for(const f of files) writeFileSync(join(root,f.path),'fixture\n');
    writeFileSync(join(root,'.github/retained-price-oct6-source.json'),'{"enabled":false,"activation":null}');
    git('add','.');commit('offline base');
    const config={candidate_sha:git('rev-parse','HEAD'),candidate_tree:git('rev-parse','HEAD^{tree}'),candidate_files:files,
      diagnostic_files:['.github/diagnostics/a','.github/diagnostics/b']};
    assert.equal(verifyCandidate(root,config),true);
    writeFileSync(join(root,files[0].path),'changed\n');assert.throws(()=>verifyCandidate(root,config),{code:'candidate-mismatch'});git('restore','.');
    mkdirSync(join(root,'.github/diagnostics'));for(const p of config.diagnostic_files)writeFileSync(join(root,p),'overlay\n');
    git('add','.');commit('offline overlay');const sha=git('rev-parse','HEAD');
    const proof=verifyOverlay(root,config,sha);assert.equal(proof.overlay_changes.added,2);assert.match(proof.scope_sha256,/^[0-9a-f]{64}$/);
    writeFileSync(join(root,'.github/diagnostics/unapproved'),'extra');assert.throws(()=>verifyOverlay(root,config,sha),{code:'overlay-scope-mismatch'});rmSync(join(root,'.github/diagnostics/unapproved'));
    assert.throws(()=>verifyOverlay(root,{...config,candidate_sha:'0'.repeat(40)},sha),{code:'overlay-scope-mismatch'});
    assert.throws(()=>verifyOverlay(root,{...config,diagnostic_files:[...config.diagnostic_files,files[0].path]},sha),{code:'overlay-scope-mismatch'});
  } finally {rmSync(root,{recursive:true,force:true});}
});
for(const value of ['STALE','EXPIRED','REVALIDATED','MISS, STALE']) test('explicit cached or stale status is inconclusive: '+value,async()=>{
  const {report}=await scenario({mutate:r=>({...r,headers:[...r.headers,['x-cache',value]]})});assert.equal(report.outcome,'inconclusive-freshness');
});
test('workflow disables Node debug before process startup',()=>{
  const workflow=readFileSync(new URL('../workflows/release40-quota-crossover.yml',import.meta.url),'utf8');
  assert.ok(workflow.includes("      NODE_DEBUG: ''"));assert.ok(workflow.includes("      NODE_DEBUG_NATIVE: ''"));
  const main=readFileSync(new URL('./release40-quota-crossover-main.mjs',import.meta.url),'utf8');
  assert.ok(main.indexOf('verifyContext(process.env,config)')<main.indexOf('verifyCandidate(candidate,config)'));
});
test('local git and version environments omit all GitHub credentials without changing the parent',async()=>{
  const {withoutGitHubCredentials}=await import('./release40-quota-crossover-main.mjs');
  const base={GH_TOKEN:SECRET,GITHUB_TOKEN:'fixture-fallback',GH_ENTERPRISE_TOKEN:'fixture-enterprise',GITHUB_ENTERPRISE_TOKEN:'fixture-other',PATH:'/usr/bin',HTTPS_PROXY:'unchanged-fixture-proxy'};
  const safe=withoutGitHubCredentials(base);
  for(const key of ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN']) assert.equal(Object.hasOwn(safe,key),false);
  assert.equal(base.GH_TOKEN,SECRET);assert.equal(safe.PATH,base.PATH);assert.equal(safe.HTTPS_PROXY,base.HTTPS_PROXY);
  assert.equal(JSON.stringify(safe).includes(SECRET),false);
  const source=readFileSync(new URL('./release40-quota-crossover-main.mjs',import.meta.url),'utf8');
  assert.ok(source.includes('env:withoutGitHubCredentials(process.env)'));
  assert.ok(source.includes('const versionEnv=withoutGitHubCredentials('));
});
