import test from 'node:test';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPublisherBrowserProofHandoff,consumePublisherToolingBrowserProof} from './retained-price-publisher-tooling.mjs';
import {localBrowserUrl,requireActualClock,selectBrowserCases,requireFinancialCategory,inspectHistoryExpiry,interruptRejection,requireUnknownPrice,compareDownloadedCsv,requireCarryBinding,BROWSER_LIMITS} from './retained-price-source-browser.mjs';
const day='2026-10-06';
const rows=()=>Array.from({length:5901},(_,index)=>({symbol:['NVDA','FUTU','ALH','LPSN','UNDATED'][index]||`ROW${index}`,as_of_date:day,research_detail_path:`details/${index}.json`}));
const prepared=()=>({target_as_of_date:day,patches:[{symbol:'LPSN',row:{}}],row_quarantines:[{symbol:'UNDATED'}]});
test('selects exact ordinary/native/partial and authenticated price cases',()=>{
 const cases=selectBrowserCases(rows(),prepared());assert.deepEqual(cases.map(c=>c.symbol),['NVDA','FUTU','ALH','LPSN','UNDATED']);assert.equal(cases.length,5);
});
test('fails missing or duplicated financial/retained/undated cases and wrong target',()=>{
 for(const mutate of [r=>{r[0].symbol='OTHER';},r=>{r[1].symbol='NVDA';},r=>{r[0].as_of_date='2026-10-02';},r=>{delete r[0].research_detail_path;}]){const r=rows();mutate(r);assert.throws(()=>selectBrowserCases(r,prepared()));}
 for(const p of [{...prepared(),patches:[]},{...prepared(),row_quarantines:[]},{...prepared(),target_as_of_date:'2026-10-02'}])assert.throws(()=>selectBrowserCases(rows(),p));
});
test('network allowlist requires the exact loopback origin and rejects auth, remote, alternate port and protocol',()=>{
 const origin='http://127.0.0.1:3210';assert(localBrowserUrl(origin+'/screener/assets/app.js',origin));
 for(const url of ['https://example.org','http://localhost:3210/screener/','http://127.0.0.1:3211/','http://user@127.0.0.1:3210/','https://127.0.0.1:3210/','file:///tmp/x','blob:http://127.0.0.1:3210/x','http://127.0.0.1.example.com:3210/'])assert.equal(localBrowserUrl(url,origin),false,url);
});
test('clock checks reject old, future, invalid and divergent browser clocks',()=>{
 const now=Date.parse('2026-10-07T12:00:00Z');assert.equal(requireActualClock(new Date(now-1000).toISOString(),now,now),now-1000);
 for(const [value,browser]of [[now-90001,now],[now+90001,now],[NaN,now],[now,now+30001]])assert.throws(()=>requireActualClock(value,browser,now));
});
const historyRow=(currency,annual)=>({symbol:'X',financial_history:{symbol:'X',as_of_date:day,status:'available',basis:'reported_diluted_eps',source:'Test source',retrieved_at:'2026-10-01T00:00:00Z',currency,annual:annual.map((eps,index)=>({end:`${2022+index}-12-31`,eps}))}});
test('financial categories require literal source history and native receipt validation',()=>{
 assert.equal(requireFinancialCategory(historyRow('USD',[1,2,3,4]),'ordinary-usd',()=>false).numeric_periods,4);
 assert.equal(requireFinancialCategory(historyRow('HKD',[1,2,3,4]),'native-hkd-annual',()=>true).currency,'HKD');
 assert.equal(requireFinancialCategory(historyRow('USD',[null,null,1,null]),'partial-annual-history',()=>false).numeric_periods,1);
 for(const [row,type,native]of [[historyRow('JPY',[1,2,3,4]),'ordinary-usd',true],[historyRow('HKD',[1,2,3,4]),'native-hkd-annual',false],[historyRow('USD',[1,2,3,4]),'partial-annual-history',true],[historyRow('USD',[null,null,null,null]),'partial-annual-history',true]])assert.throws(()=>requireFinancialCategory(row,type,()=>native));
});
test('annual and quarterly expiry are independent and fresh components stay usable',()=>{
 const now=Date.parse('2026-10-07T12:00:00Z'),old=new Date(now-73*3600000).toISOString(),fresh=new Date(now-2*3600000).toISOString();
 const row=historyRow('HKD',[1,2,3,4]);Object.assign(row.financial_history,{schema_version:'native',annual_source:{observed_at:old},quarterly_retrieved_at:fresh,quarterly:[{end:'2026-06-30',eps:1}]});
 const dates=h=>[h.annual_source.observed_at,h.quarterly_retrieved_at].map(t=>Date.parse(t)+72*3600000);
 const current=()=>({valid:true,annual:[],quarterly:row.financial_history.quarterly,annualGrowth:null,epsYoY:30,salesYoY:25});
 const result=inspectHistoryExpiry(row,now,dates,current,'native');assert.equal(result.expired_components,1);assert.equal(result.components.annual.expired,true);assert.equal(result.components.quarterly.expired,false);assert.equal(result.components.quarterly.current_periods,1);
 assert.throws(()=>inspectHistoryExpiry(row,now,dates,()=>({...current(),annual:row.financial_history.annual}),'native'));
 row.financial_history.annual_source.observed_at=fresh;row.financial_history.quarterly_retrieved_at=old;
 const quarterExpired=()=>({valid:true,annual:row.financial_history.annual,quarterly:[],annualGrowth:[10,10,10],epsYoY:null,salesYoY:null});
 const reverse=inspectHistoryExpiry(row,now,dates,quarterExpired,'native');assert.equal(reverse.components.annual.current_periods,4);assert.equal(reverse.components.quarterly.expired,true);
 row.financial_history.quarterly_retrieved_at=fresh;assert.equal(inspectHistoryExpiry(row,now,dates,quarterExpired,'native').expired_components,0);
});
test('SIGTERM and SIGINT reject the running proof and can remove only their own hooks',()=>{
 const events=new EventEmitter(),seen=[],existing=()=>{};events.on('SIGTERM',existing);const remove=interruptRejection(error=>seen.push(error.message),events);
 events.emit('SIGTERM');events.emit('SIGINT');assert.deepEqual(seen,['Browser proof interrupted: SIGTERM','Browser proof interrupted: SIGINT']);remove();assert.deepEqual(events.listeners('SIGTERM'),[existing]);assert.equal(events.listenerCount('SIGINT'),0);
});
test('quarantined prices cannot regain measured values or verified status',()=>{
 const row={symbol:'X',as_of_date:day,current_price:null,price_change_1d:null,adv_usd:null,rs_rating:null,se_pivot_price:null,vcp_pivot:null,technical_audit:{valid:false}};requireUnknownPrice(row);
 for(const key of ['current_price','rs_rating','se_pivot_price'])assert.throws(()=>requireUnknownPrice({...row,[key]:1}));assert.throws(()=>requireUnknownPrice({...row,technical_audit:{valid:true}}));
});
test('actual CSV requires exact values, one selected symbol and no revived unknown price',()=>{
 const canonical={headers:['symbol','daily_price','pivot','qualified'],rows:[{symbol:'X',daily_price:'',pivot:'',qualified:'false'}]};assert.deepEqual(compareDownloadedCsv(structuredClone(canonical),canonical,'X',{unknownPrice:true}),canonical.rows[0]);
 for(const data of [{...canonical,headers:[...canonical.headers].reverse()},{...canonical,rows:[canonical.rows[0],canonical.rows[0]]},{...canonical,rows:[{...canonical.rows[0],daily_price:'42'}]}])assert.throws(()=>compareDownloadedCsv(data,canonical,'X',{unknownPrice:true}));
 const wrong={...canonical,rows:[{...canonical.rows[0],qualified:'true'}]};assert.throws(()=>compareDownloadedCsv(wrong,wrong,'X',{unknownPrice:true}));
 assert(BROWSER_LIMITS.milliseconds<=360000&&BROWSER_LIMITS.requests<=4000);
});

test('new carry generation is bound independently from original source and previous carry generations',()=>{
 const hash=x=>createHash('sha256').update(x).digest('hex'),source=JSON.stringify({financial_generation:'original-generation'}),sourceHash=hash(source);
 const carry={financial_generation:'new-carry',source_financial_generation:'original-generation',source_projection_json:source,bindings:{source_projection_sha256:sourceHash,source_lineage_sha256:'lineage',previous_publication_identity:'previous'}},raw=JSON.stringify(carry);
 const receipt={mode:'carry',previous_publication_identity:'previous',financial_generation:'new-carry',evaluation_projection:{sha256:hash(raw)}};
 const publication={financial_generation:'new-carry',financial_lineage_sha256:'lineage',financial_release:{sha256:hash(JSON.stringify(receipt))}};
 const state={carry:{projectionSha256:hash(raw)},financialPrepared:{receipt},live:{identity:'previous',financialRelease:{financial_generation:'previous-carry',lineage_sha256:'lineage',source_projection:{sha256:sourceHash}}}};
 assert.deepEqual(requireCarryBinding(publication,state,raw),{financial_generation:'new-carry',source_financial_generation:'original-generation',previous_financial_generation:'previous-carry'});
 assert.throws(()=>requireCarryBinding({...publication,financial_generation:'previous-carry'},state,raw));
 assert.throws(()=>requireCarryBinding(publication,state,raw+' '));
 const changed=structuredClone(state);changed.live.financialRelease.source_projection.sha256='changed';assert.throws(()=>requireCarryBinding(publication,changed,raw));
});

const handoffState=()=>({source:{repair:{request:'actual'}},publisherTooling:{phase:'browsing',binding:{source:'verified'}},carry:{projection:'actual'}});
test('browser proof handoff consumes the exact before-boundary proof once',()=>{
  const handoff=createPublisherBrowserProofHandoff(),state=handoffState(),proof={verified:true,replayRoot:'/actual-replay',sourceRoot:'/actual-source'};
  handoff.offer(state,proof);assert.equal(handoff.consume(state),proof);assert(Object.isFrozen(proof));
  assert.throws(()=>handoff.consume(state),/same-invocation/);assert.throws(()=>handoff.offer(state,{verified:true}),/reused/);
});
test('browser proof handoff rejects cloned or serialized state identity',()=>{
  const handoff=createPublisherBrowserProofHandoff(),state=handoffState();handoff.offer(state,{verified:true});
  assert.throws(()=>handoff.consume(structuredClone(state)),/same-invocation/);
  assert.throws(()=>handoff.consume(state),/same-invocation/);
  assert.throws(()=>consumePublisherToolingBrowserProof(state),/same-invocation/,'An isolated factory cannot seed the production handoff');
});
test('browser proof handoff rejects interleaved offers and retains neither proof',()=>{
  const handoff=createPublisherBrowserProofHandoff(),first=handoffState(),second=handoffState();handoff.offer(first,{verified:true});
  assert.throws(()=>handoff.offer(second,{verified:true}),/Interleaved/);assert.throws(()=>handoff.consume(first),/same-invocation/);assert.throws(()=>handoff.consume(second),/same-invocation/);
});
for(const [name,change]of [
  ['source mutation',state=>{state.source.repair.request='changed';}],
  ['projection mutation',state=>{state.carry.projection='changed';}],
  ['binding mutation',state=>{state.publisherTooling.binding.source='changed';}],
  ['later phase',state=>{state.publisherTooling.phase='browser_verified';}],
])test('browser proof handoff rejects '+name,()=>{
  const handoff=createPublisherBrowserProofHandoff(),state=handoffState();handoff.offer(state,{verified:true});change(state);
  assert.throws(()=>handoff.consume(state),/changed|same-invocation/);assert.throws(()=>handoff.consume(state),/same-invocation/);
});
test('browser proof handoff rejects proof mutation and a later boundary invalidates pending proof',()=>{
  const handoff=createPublisherBrowserProofHandoff(),state=handoffState(),proof={verified:true,replayRoot:'/actual'};
  handoff.offer(state,proof);proof.replayRoot='/changed';assert.throws(()=>handoff.consume(state),/changed/);
  const later=handoffState();handoff.offer(later,{verified:true});handoff.invalidate();assert.throws(()=>handoff.consume(later),/same-invocation/);
});
test('later browser and final phases retain fresh authority and unchanged runtime bounds',()=>{
  const helper=readFileSync(new URL('./retained-price-publisher-tooling.mjs',import.meta.url),'utf8'),browser=readFileSync(new URL('./retained-price-source-browser.mjs',import.meta.url),'utf8');
  const boundary=helper.split('export async function publisherToolingBoundary(state,action){')[1];
  assert(boundary);assert.match(boundary,/publisherBrowserProofHandoff\.invalidate\(\)/);
  assert.match(boundary,/const context=await currentContext\(state\)/);assert.match(helper,/const proof=await verifyRetainedRestoreBinding\(/);
  assert.match(boundary,/if\(action==='browser-before'\)publisherBrowserProofHandoff\.offer\(state,context\.proof\)/);
  assert.match(browser,/const proof=consumePublisherToolingBrowserProof\(state\)/);assert.doesNotMatch(browser,/verifyRetainedRestoreBinding/);
  assert.match(browser,/await publisherToolingBoundary\(state,'browser-after'\)/);
  assert.equal(BROWSER_LIMITS.milliseconds,360000);
});

test('browser-before async return keeps its one-use proof for the awaited body',async()=>{
  const handoff=createPublisherBrowserProofHandoff(),state=handoffState(),proof={verified:true,replayRoot:'/actual-async-replay'};
  state.publisherTooling.phase='composed';
  const before=async()=>{
    await Promise.resolve();
    state.publisherTooling.phase='browsing';
    handoff.offer(state,proof);
    return state.publisherTooling;
  };
  await before();
  // Match runBrowserProof: persist/read the same state, then consume in its body.
  const persisted=JSON.stringify(state);assert.deepEqual(JSON.parse(persisted),state);
  assert.equal(handoff.consume(state),proof);assert.throws(()=>handoff.consume(state),/same-invocation/);
});
test('an interleaved later boundary after await invalidates the offered proof',async()=>{
  const handoff=createPublisherBrowserProofHandoff(),state=handoffState();
  const before=async()=>{await Promise.resolve();handoff.offer(state,{verified:true});};
  await before();await Promise.resolve();handoff.invalidate();
  assert.throws(()=>handoff.consume(state),/same-invocation/);
});
test('mutation after awaited browser-before cannot consume its proof',async()=>{
  const handoff=createPublisherBrowserProofHandoff(),state=handoffState();
  const before=async()=>{await Promise.resolve();handoff.offer(state,{verified:true});};
  await before();await Promise.resolve();state.carry.projection='interleaved-change';
  assert.throws(()=>handoff.consume(state),/changed/);
});
