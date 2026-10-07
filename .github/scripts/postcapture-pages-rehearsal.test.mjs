import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync,symlinkSync,linkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ACTUAL,assertActualIdentities,advanceSyntheticPrices,offlineApiResponse,installOfflineTransport} from './fixtures/postcapture-pages-rehearsal.mjs';
import {bootstrap} from './publication-state.mjs';
import {compareRenewalTargets} from './fixtures/renewal-target-diagnostics.mjs';

const prefix=`repos/${bootstrap.repository}`;
const write=(path,value)=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,typeof value==='string'?value:JSON.stringify(value));};
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const temporary=t=>{const root=mkdtempSync(join(tmpdir(),'postcapture-pages-unit-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;};

test('target diagnostics preserve strict bytes and enumerate clocks, paths, prices, presence, types and row-order changes',t=>{
  const root=temporary(t),a=join(root,'a.json'),b=join(root,'b.json'),evaluatedAt='2026-10-06T18:25:04.857Z';
  const value={market:'US',as_of_date:'2026-10-02',rows:[{symbol:'NVDA',current_price:180,chart_path:'old',research_detail_path:'old',observed_at:'2026-10-04',nullable:null},{symbol:'AMD',current_price:120}]};
  write(a,value);write(b,value);
  const equal=compareRenewalTargets(a,b,{evaluatedAt});assert.equal(equal.exact_bytes_equal,true);assert.equal(equal.semantic_equal,true);assert.equal(equal.differences,0);assert.equal(equal.evaluated_at,evaluatedAt);
  writeFileSync(b,JSON.stringify(value,null,2));const format=compareRenewalTargets(a,b);assert.equal(format.exact_bytes_equal,false);assert.equal(format.semantic_equal,true);
  const changed=structuredClone(value);Object.assign(changed.rows[0],{current_price:181,chart_path:'new',research_detail_path:'new',observed_at:'2026-10-06',nullable:0});delete changed.rows[1].current_price;changed.rows[1].new_field=true;
  write(b,changed);const report=compareRenewalTargets(a,b);assert.equal(report.differences,7);assert.equal(report.exact_bytes_equal,false);assert.equal(report.semantic_equal,false);
  for(const field of ['current_price','chart_path','research_detail_path','observed_at','nullable','new_field'])assert.ok(Object.keys(report.fields).some(key=>key.includes(field)));
  assert.equal(report.symbols['NVDA→NVDA'],5);assert.equal(report.symbols['AMD→AMD'],2);
  write(b,{...value,rows:[...value.rows].reverse()});assert.ok(Object.keys(compareRenewalTargets(a,b).fields).some(key=>key.includes('symbol')));
  write(b,{...value,rows:value.rows.slice(0,1)});assert.equal(compareRenewalTargets(a,b).actual.rows,1);
  assert.deepEqual(read(a),value,'diagnostics never rewrite selected input');
});

test('target diagnostics bound examples and reject links and excessive row count',t=>{
  const root=temporary(t),a=join(root,'a.json'),b=join(root,'b.json');
  write(a,{rows:Array.from({length:30},(_,i)=>({symbol:String(i),price:i}))});write(b,{rows:Array.from({length:30},(_,i)=>({symbol:String(i),price:i+1}))});
  const report=compareRenewalTargets(a,b);assert.equal(report.differences,30);assert.equal(report.examples.length,24);assert.equal(report.examples_truncated,true);
  symlinkSync(a,join(root,'link'));assert.throws(()=>compareRenewalTargets(join(root,'link'),b),/Unsafe/);
  linkSync(a,join(root,'hardlink'));assert.throws(()=>compareRenewalTargets(a,b),/Unsafe/);
  rmSync(join(root,'hardlink'));write(b,{rows:Array(10001).fill({})});assert.throws(()=>compareRenewalTargets(a,b),/Invalid target diagnostic rows/);
});

test('actual input admission rejects role substitution, an altered failed producer, companion or original #99 ZIP',()=>{
  const roles=['pages','old-source','old-cert','failed-source','companion'];
  const input={schema_version:'postcapture-pages-rehearsal-inputs-v1',publication_authority:false,paths:Object.fromEntries(roles.map(role=>[role,{reference:structuredClone(ACTUAL[role])}]))};
  const review={reference:{...ACTUAL.companion,receipt_sha256:'f5e925de47bfe9dc5f00f28b179e6d4e124b24d2f793692390e08177e55f57d5'},source:{...ACTUAL['failed-source']}};
  assertActualIdentities(input,review);
  for(const role of roles){const changed=structuredClone(input);changed.paths[role].reference.artifact_sha256='0'.repeat(64);assert.throws(()=>assertActualIdentities(changed,review),new RegExp(role));}
  const changed=structuredClone(input);changed.paths.synthetic=changed.paths.pages;assert.throws(()=>assertActualIdentities(changed,review),/exactly five/);
  const changedReview=structuredClone(review);changedReview.source.run_attempt=2;assert.throws(()=>assertActualIdentities(input,changedReview),/failed source reviewed run_attempt/);
  const badAuthority=structuredClone(input);badAuthority.publication_authority=true;assert.throws(()=>assertActualIdentities(badAuthority,review));
});

test('authenticated bounded and paginated GitHub responses stay exact; only local immutable Git supplies missing objects',()=>{
  const endpoint=`${prefix}/actions/runs/37495003542/attempts/1/jobs?per_page=100`,job={id:112377172824,conclusion:'success'},bounded={total_count:1,jobs:[job]},pages=[bounded];
  const config={currentSha:'a'.repeat(40),api:{[`GET ${endpoint}`]:bounded,[`GET_PAGES ${endpoint}`]:pages}};
  const deny=()=>{throw Error('Unexpected local Git lookup');};
  assert.deepEqual(offlineApiResponse(config,endpoint,false,deny),bounded);assert.deepEqual(offlineApiResponse(config,endpoint,true,deny),pages);
  delete config.api[`GET_PAGES ${endpoint}`];assert.deepEqual(offlineApiResponse(config,endpoint,true,deny),pages);
  delete config.api[`GET ${endpoint}`];config.api[`GET_PAGES ${endpoint}`]=pages;assert.deepEqual(offlineApiResponse(config,endpoint,false,deny),bounded);
  assert.throws(()=>offlineApiResponse(config,`${prefix}/actions/runs/999999/attempts/1`,false,deny),/Unmatched offline API/);
  const commit='b'.repeat(40),parent='c'.repeat(40),tree='d'.repeat(40);
  assert.deepEqual(offlineApiResponse(config,`${prefix}/git/commits/${commit}`,false,(sha,...args)=>{
    assert.equal(sha,commit);assert.deepEqual(args,['show','-s','--format=%T%n%P',commit]);return `${tree}\n${parent}`;
  }),{sha:commit,tree:{sha:tree},parents:[{sha:parent}]});
  assert.throws(()=>offlineApiResponse(config,`${prefix}/contents/x?ref=main`,false,deny),/immutable content revision/);
});

test('synthetic carry advances every eligible canonical chart and alias while preserving source clocks and historical bars',t=>{
  const publicRoot=temporary(t),data=join(publicRoot,'static-data'),bars=[{date:'2026-10-01',open:8,high:11,low:7,close:10,volume:120},{date:'2026-10-02',open:10,high:12,low:9,close:11,volume:130}];
  write(join(data,'manifest.json'),{as_of_date:'2026-10-02',markets:{US:{as_of_date:'2026-10-02',pages:{scan:{path:'scan.json'}},assets:{charts:{path:'charts.json'}}}}});
  write(join(data,'scan.json'),{as_of_date:'2026-10-02',initial_rows:[{symbol:'A',as_of_date:'2026-10-02'}],chunks:[{path:'scan-chunk.json'}]});
  write(join(data,'scan-chunk.json'),{as_of_date:'2026-10-02',rows:[{symbol:'A',as_of_date:'2026-10-02'}]});
  write(join(data,'charts.json'),{symbols:[{symbol:'A',path:'charts/A.json'},{symbol:'B',path:'charts/B.json'},{symbol:'X',path:'charts/X.json'}]});
  const chart={market:'US',symbol:'A',as_of_date:'2026-10-02',bars,stock_data:{symbol:'A',as_of_date:'2026-10-02',annual_source:{observed_at:'2026-10-06T09:00:00Z'}},financial_current:{t:'2026-10-06T09:00:00Z',p:{eps:'unchanged'}}};
  write(join(data,'charts/A.json'),chart);write(join(data,'raw/A.json'),chart);write(join(data,'charts/B.json'),{symbol:'B',bars:[]});write(join(data,'charts/X.json'),{symbol:'X',bars});
  const history={as_of_date:'2026-10-02',results:{A:{as_of_date:'2026-10-02',annual_source:{observed_at:'2026-10-06T09:00:00Z'},retrieved_at:'2026-10-06T09:01:00Z',annual:[{period_end:'2026-06-30',eps:1}]}}};
  write(join(data,'financial-history.json'),history);write(join(data,'candidate-history/index.json'),{snapshots:[{date:'2026-10-02'}]});write(join(data,'financial-corrections/source.json'),chart);
  const beforeHistory=readFileSync(join(data,'candidate-history/index.json')),beforeAudit=readFileSync(join(data,'financial-corrections/source.json')),outside=readFileSync(join(data,'charts/X.json'));
  const proof=advanceSyntheticPrices(publicRoot,{rows:[{symbol:'A'},{symbol:'B'}]},{date:'2026-10-05',evaluatedAt:'2026-10-06T17:00:00Z'});
  assert.equal(proof.canonical_chart_paths,1);assert.equal(proof.advanced_alias_paths,2);assert.equal(proof.catalog_symbols_without_history,1);assert.deepEqual(proof.advanced_symbols,['A']);
  for(const name of ['charts/A.json','raw/A.json']){const after=read(join(data,name));assert.deepEqual(after.bars.slice(0,-1),bars);assert.deepEqual(after.bars.at(-1),{...bars.at(-1),date:'2026-10-05'});assert.deepEqual(after.financial_current,chart.financial_current);assert.deepEqual(after.stock_data.annual_source,chart.stock_data.annual_source);}
  const actualHistory=read(join(data,'financial-history.json'));delete actualHistory.as_of_date;delete actualHistory.results.A.as_of_date;
  const expectedHistory=structuredClone(history);delete expectedHistory.as_of_date;delete expectedHistory.results.A.as_of_date;assert.deepEqual(actualHistory,expectedHistory);
  assert.deepEqual(readFileSync(join(data,'candidate-history/index.json')),beforeHistory);assert.deepEqual(readFileSync(join(data,'financial-corrections/source.json')),beforeAudit);assert.deepEqual(readFileSync(join(data,'charts/X.json')),outside);
  assert.throws(()=>advanceSyntheticPrices(publicRoot,{rows:[{symbol:'A'}]},{date:'2026-10-07',evaluatedAt:'2026-10-06T17:00:00Z'}),/cannot be in the future/);
});

test('offline transport serves only retained Pages and exact APIs, rejects network/providers, and leaves real time untouched',{timeout:30000},t=>{
  const root=temporary(t),bin=join(root,'bin'),live=join(root,'pages');mkdirSync(bin);mkdirSync(live);write(join(live,'publication.json'),'retained Pages bytes');
  const config={api:{[`GET ${prefix}`]:{full_name:bootstrap.repository}},zips:{},gitRoots:[],currentSha:'a'.repeat(40),liveRoot:live};
  const env={...process.env,PATH:`${bin}:${process.env.PATH}`,NODE_OPTIONS:`--import=${join(root,'transport.mjs')}`,RENEWAL_FIXTURE_CONFIG:join(root,'transport.json'),RENEWAL_FIXTURE_TRACE:join(root,'trace.jsonl'),RENEWAL_FIXTURE_NOW:'2000-01-01T00:00:00Z',GH_TOKEN:'must-not-reach-child'};
  const f={root,config,env,save(){write(join(root,'transport.json'),config);}};f.save();installOfflineTransport(f,{python:process.env.FINANCIAL_REPLAY_PYTHON||'python3'});assert.equal(f.env.GH_TOKEN,undefined);
  const run=(cmd,args)=>spawnSync(cmd,args,{cwd:root,env:f.env,encoding:'utf8',timeout:10000});
  const before=Date.now(),clock=run(process.execPath,['--input-type=module','-e','console.log(Date.now())']);assert.equal(clock.status,0,clock.stderr);assert.ok(Number(clock.stdout)>=before&&Number(clock.stdout)<=Date.now());
  const pages=run(process.execPath,['--input-type=module','-e',`console.log(await (await fetch(${JSON.stringify(new URL('publication.json',bootstrap.site_url).href)},{redirect:'error'})).text())`]);assert.equal(pages.status,0,pages.stderr);assert.equal(pages.stdout.trim(),'retained Pages bytes');
  for(const code of ["await fetch('https://example.invalid/x')","import https from 'node:https';https.get('https://example.invalid/')","import net from 'node:net';net.connect(443,'example.invalid')"]){const result=run(process.execPath,['--input-type=module','-e',code]);assert.notEqual(result.status,0);assert.match(result.stderr,/Network\/provider access denied/);}
  const gh=run(join(bin,'gh'),['api',prefix]);assert.equal(gh.status,0,gh.stderr);assert.deepEqual(JSON.parse(gh.stdout),{full_name:bootstrap.repository});
  const missing=run(join(bin,'gh'),['api',`${prefix}/actions/runs/123`]);assert.notEqual(missing.status,0);assert.match(missing.stderr,/Unmatched offline API/);
  const mutation=run(join(bin,'gh'),['api','--method','POST',prefix]);assert.notEqual(mutation.status,0);assert.match(mutation.stderr,/Only exact offline/);
  const socket=run(f.python,['-c',"import socket;socket.create_connection(('127.0.0.1',80))"]);assert.notEqual(socket.status,0);assert.match(socket.stderr,/Provider\/socket access denied/);
  const memory=run(f.python,['-c','import resource;print(resource.getrlimit(resource.RLIMIT_AS)[0])']);assert.equal(memory.status,0,memory.stderr);assert.equal(Number(memory.stdout.trim()),3*1024**3);
  const timing=readFileSync(join(root,'child-process-phases.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(timing.length>0);assert.ok(timing.every(value=>value.schema_version==='diagnostic-child-timing-v1'&&value.elapsed_ms>=0&&Number.isFinite(Date.parse(value.at))));
  assert.ok(timing.some(value=>value.operation==='spawnSync'&&value.status===0));
});
