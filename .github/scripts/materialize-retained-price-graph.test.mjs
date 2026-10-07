import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';
import {materializeRecoveryGraph,syncRecoveryHome,proveRecoveryAggregateEquivalence,proveRecoveryAggregateCorrectionFromRowBindings} from './materialize-retained-price-graph.mjs';
import {RECOVERY_FINANCIAL_FIELDS,recoveryDigest} from './retained-price-recovery.mjs';
import {prepareRetainedHomeHistory,RETAINED_HOME_KEY} from './retained-home-history.mjs';
import {priceObservationDigest} from './price-observations.mjs';
import oct6ProducerRuntime from './fixtures/retained-price-producer-runtime-oct6.json' with {type:'json'};

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const bytes=value=>Buffer.from(JSON.stringify(value));
const read=path=>JSON.parse(readFileSync(path));
const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,Buffer.isBuffer(value)?value:bytes(value));};
function inventory(root){const result={};function visit(path=''){for(const name of readdirSync(join(root,path),{withFileTypes:true})){const next=path?path+'/'+name.name:name.name;if(name.isDirectory())visit(next);else{const raw=readFileSync(join(root,next));result[next]={bytes:raw.length,sha256:sha(raw)};}}}visit();return result;}
function fixture(t,{groups=false,extra=true}={}){
  const parent=mkdtempSync(join(tmpdir(),'retained-graph-test-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));const root=join(parent,'restored');mkdirSync(root);const archive=join(parent,'original.zip');writeFileSync(archive,'original-immutable-archive');
  const put=(path,value)=>write(join(root,'static-data',path),value),get=path=>read(join(root,'static-data',path));
  const identity=symbol=>({symbol,market:'US',currency:'USD',exchange:'XNAS',company_name:`Issuer ${symbol}`,ibd_industry_group:'Industry'});
  const full={...identity('LOST'),as_of_date:'2026-10-05',current_price:55,adv_usd:80e6,rs_rating:null,chart_path:'verified-charts/LOST-1111111111111111.json',research_detail_path:'research-details/LOST-old.json',
    technical_audit:{valid:false,values:{}},new_scanner_decision:'buy',se_setup_ready:true,passes_template:true,rs_rating_1m:90,price_sparkline_data:[30,55],
    recent_quarter_date:'2026-06-30',financial_evaluated_at:123,financial_generation:'literal-generation',financial_current:{t:123,p:{eps_growth_qq:42}},financial_source_evidence:{clock:'unchanged',fields:{eps_growth_qq:42}},
    financial_reference:{old_score:99},financial_historical:{values:{old_score:99}},financial_history:{retrieved_at:'2026-10-03T11:00:00Z'},growth_reporting_cadence:'quarterly',eps_growth_qq:42,book_financials:null};
  const good={...identity('GOOD'),as_of_date:'2026-10-05',current_price:100,adv_usd:5e8,rs_rating:99,chart_path:'markets/us/charts/GOOD.json',financial_current:{proof:'unchanged'},unexpected:{preserve:true}};
  const oldChart=symbol=>({schema_version:'static-charts-v2',symbol,market:'US',as_of_date:'2026-10-02',generated_at:'2026-10-04T04:20:51Z',period:'2y',
    bars:[{date:'2026-10-02',open:20,high:22,low:19,close:21,volume:2e6}],stock_data:{...identity(symbol),as_of_date:'2026-10-02',current_price:21},fundamentals:{old:true},bands:[{old:true}],buy_points:[{old:true}],rs_line:[{old:true}],signal:{buy:true}});
  function patch(symbol,research){const prior=oldChart(symbol),compact=research?{...identity(symbol),as_of_date:'2026-10-05',eps_growth_qq:null}:null;
    const snapshot={schema_version:'retained-price-snapshot-v1',publication_authority:false,previous_publication_sha256:'1'.repeat(64),actual_observation_date:'2026-10-02',prior_row:research?prior.stock_data:null,prior_chart:prior,prior_detail:research?prior.stock_data:null,rejected_candidate_row:compact};
    const hash=recoveryDigest(snapshot),path=`retained-price-charts/${hash}.json`;
    return {symbol,chart_path:path,row:compact?{...compact,retained_price_history:{reason:'regressed_history'}}:null,detail:compact,snapshot_path:`retained-price-history/${hash}.json`,snapshot,bars_sha256:recoveryDigest(prior.bars),historical_chart_sha256:recoveryDigest(prior),
      chart:{schema_version:'static-charts-v2',symbol,market:'US',as_of_date:'2026-10-02',generated_at:prior.generated_at,period:prior.period,bars:clone(prior.bars),stock_data:null,
        rs_line:[],blue_dots:[],eps_line:[],vcp_boxes:[],buy_points:[],signal:null,risk_plan:null,
        retained_price_history:{status:'stale_reference_only',observation_date:'2026-10-02',original_as_of_date:'2026-10-02',original_generated_at:prior.generated_at,target_as_of_date:'2026-10-05',snapshot_path:`retained-price-history/${hash}.json`,snapshot_sha256:hash}}};}
  const preparedValue={schema_version:'retained-price-recovery-v1',publication_authority:false,scope:'unpublished_compiler_inputs_only',target_as_of_date:'2026-10-05',requires_full_rebuild:true,requires_financial_carry:true,patches:[patch('LOST',true),...(extra?[patch('EXTRA',false)]:[])],ledger_only_absences:[JSON.stringify(['US','chart','LEDGER_ONLY'])]};
  const index={schema_version:'static-charts-v2',as_of_date:'2026-10-05',symbols_total:2,skipped_symbols:['EXTRA','LEDGER_ONLY'],symbols:[{symbol:'GOOD',path:'markets/us/charts/GOOD.json',rank:1,rs_rating:99,buy:{active:true}},{symbol:'LOST',path:'verified-charts/LOST-1111111111111111.json',rank:2,rs_rating:97,buy:{active:true},sell:{action:'sell'}}]};
  put('charts-index-1111111111111111.json',index);const rawIndex=clone(index);rawIndex.symbols[1].path='markets/us/charts/LOST.json';put('markets/us/charts/index.json',rawIndex);
  put('research-details/LOST-old.json',{...full,method_summary:{buy:true}});
  put('markets/us/charts/LOST.json',{...oldChart('LOST'),as_of_date:'2026-10-05',bars:[{date:'2026-07-01',close:55}]});put('verified-charts/LOST-1111111111111111.json',oldChart('LOST'));put('verified-charts/LOST-2222222222222222.json',{...oldChart('LOST'),fundamentals:{must_disappear:true}});put('markets/us/charts/GOOD.json',oldChart('GOOD'));
  const scan={as_of_date:'2026-10-05',rows_total:2,default_filtered_rows_total:2,initial_rows:[clone(full),clone(good)],preview_rows:[{symbol:'LOST',current_price:55}],results:[clone(full)],members:[clone(full)],stocks:[clone(full)],chunks:[{path:'markets/us/scan/chunks/one.json'},{path:'markets/us/scan/chunks/two.json'}],charts:{path:'charts-index-1111111111111111.json',symbols_total:2}};
  put('markets/us/scan/manifest.json',scan);put('markets/us/scan/chunks/one.json',{as_of_date:'2026-10-05',rows:[full],initial_rows:[full],preview_rows:[full],results:[full],stocks:[full],members:[full]});put('markets/us/scan/chunks/two.json',{as_of_date:'2026-10-05',rows:[good]});
  put('markets/us/home.json',{as_of_date:'2026-10-05',generated_at:'clock-stays-literal',market:'US',key_markets:[{literal:true}],top_groups:[],scan_summary:{rows_total:99,default_filtered_rows_total:965,run_id:1,top_results:[{symbol:'LOST',current_price:55}]}});
  const manifest={as_of_date:'2026-10-05',markets:{US:{as_of_date:'2026-10-05',pages:{scan:{path:'markets/us/scan/manifest.json'},home:{path:'markets/us/home.json'},...(groups?{groups:{path:'markets/us/groups.json'}}:{})},assets:{charts:{path:'charts-index-1111111111111111.json',symbols_total:2}}}},assets:{charts:{path:'markets/us/charts/index.json',symbols_total:2}}};put('manifest.json',manifest);
  if(groups){const ranking={industry_group:'Industry',date:'2026-10-05',rank:1,avg_rs_rating:99,num_stocks:1,top_symbol:'GOOD',top_symbol_name:'Issuer GOOD',top_rs_rating:99,rank_change_1w:0};
    put('markets/us/groups.json',{market:'US',available:true,generated_at:'original-group-clock',payload:{rankings:{rankings:[ranking]},movers:{period:'1w',gainers:[],losers:[]},group_details:{Industry:{num_stocks:1,current_avg_rs:99,current_rank:1,top_symbol:'GOOD',history:[{date:'2026-10-05',avg_rs_rating:88,rank:2,num_stocks:2}],stocks:[{symbol:'GOOD',company_name:'Issuer GOOD',rs_rating:99,composite_score:90},{symbol:'LOST',company_name:'Issuer LOST',price:55,rs_rating:null,rs_rating_1m:90,composite_score:50,stage:2,price_sparkline_data:[20,55],financial_current:{literal:true}}]}}}});
    const home=get('markets/us/home.json');home.top_groups=[ranking];put('markets/us/home.json',home);
  }
  const oldRaw=gzipSync(bytes({session:'approved'})),newRaw=gzipSync(bytes({session:'rejected'})),perfRaw=gzipSync(bytes({completed_observations:[1,2]}));
  const oldRef={path:'candidate-history/2026-10-02-1111111111111111.json.gz',sha256:sha(oldRaw),as_of:'2026-10-02'},newRef={path:'candidate-history/2026-10-05-2222222222222222.json.gz',sha256:sha(newRaw),as_of:'2026-10-05'};
  const perfRef={path:'candidate-performance-history/2026-10-02-1111111111111111-2222222222222222.json.gz',sha256:sha(perfRaw),cohort_sha256:'1'.repeat(64),as_of:'2026-10-02',observations:2};
  put(oldRef.path,oldRaw);put(newRef.path,newRaw);put(perfRef.path,perfRaw);put('candidate-history/index.json',{schema_version:1,snapshots:[oldRef,newRef]});const perfCatalog=bytes({schema_version:1,cohorts:[perfRef]});put('candidate-performance-history/index.json',perfCatalog);
  const priorCatalog=Buffer.from(JSON.stringify({schema_version:1,snapshots:[oldRef]},null,2)+'\n');
  const preparedPath=join(parent,'prepared-v2.json');writeFileSync(preparedPath,bytes(preparedValue));
  const args={root,prepared:preparedPath,expectedPreparedSha256:sha(readFileSync(preparedPath)),sourceReceiptPath:join(root,'retained-price-restoration-receipt.json'),previousSelectionCatalog:{bytes:priorCatalog,sha256:sha(priorCatalog)},previousPerformanceCatalog:{bytes:perfCatalog,sha256:sha(perfCatalog)}};
  function bind(){if(existsSync(args.sourceReceiptPath))rmSync(args.sourceReceiptPath);const receipt={schema_version:'retained-price-candidate-restoration-v1',publication_authority:false,ready_to_publish:false,fullSiteVerified:false,mode:'normal-candidate',archive:{path:archive,sha256:sha(readFileSync(archive)),bytes:readFileSync(archive).length},files:inventory(root)};write(args.sourceReceiptPath,receipt);args.sourceReceiptSha256=sha(readFileSync(args.sourceReceiptPath));return receipt;}
  bind();return {parent,root,args,full,good,put,get,bind,archive,preparedPath,preparedValue,newRef,oldRef,perfRef,priorCatalog,perfCatalog};
}

test('full original rows drive financial preservation, all aliases, closed charts and exact approved history',t=>{
  const f=fixture(t),beforePrepared=readFileSync(f.preparedPath),beforeArchive=readFileSync(f.archive),beforeGood=readFileSync(join(f.root,'static-data/markets/us/scan/chunks/two.json')),beforeReceipt=readFileSync(f.args.sourceReceiptPath),beforeHome=f.get('markets/us/home.json');
  const result=materializeRecoveryGraph(f.args),row=f.get('markets/us/scan/chunks/one.json').rows[0];
  assert.equal(row.eps_growth_qq,42,'full source wins over compact null');assert.equal(row.financial_evaluated_at,123);assert.deepEqual(row.financial_source_evidence,f.full.financial_source_evidence);assert.deepEqual(row.financial_historical,f.full.financial_historical);assert(!Object.hasOwn(row,'financial_reference'));assert(!Object.hasOwn(row,'financial_source_publication_date'));
  for(const key of RECOVERY_FINANCIAL_FIELDS){assert.equal(Object.hasOwn(row,key),Object.hasOwn(f.full,key));if(Object.hasOwn(f.full,key))assert.deepEqual(row[key],f.full[key]);}
  assert.equal(row.current_price,null);assert.equal(row.adv_usd,null);assert.equal(row.rs_rating,null);assert.equal(row.se_setup_ready,false);assert.equal(row.technical_audit.valid,false);assert(!Object.hasOwn(row,'new_scanner_decision'));assert(!Object.hasOwn(row,'price_sparkline_data'));
  for(const key of ['rows','initial_rows','preview_rows','results','stocks','members'])assert.deepEqual(f.get('markets/us/scan/chunks/one.json')[key][0],row);
  for(const key of ['initial_rows','preview_rows','results','stocks','members'])assert.deepEqual(f.get('markets/us/scan/manifest.json')[key][0],row);
  assert.deepEqual(f.get('markets/us/scan/manifest.json').initial_rows[1],f.good);
  const chart=f.get(row.chart_path);assert.equal(chart.as_of_date,'2026-10-05');assert.equal(chart.generated_at,'2026-10-04T04:20:51Z');assert.equal(chart.bars.at(-1).date,'2026-10-02');assert.deepEqual(chart.stock_data,row);assert.deepEqual(f.get('research-details/LOST-old.json'),row);assert(!Object.hasOwn(chart,'fundamentals'));assert(!Object.hasOwn(chart,'bands'));assert.equal(chart.signal,null);assert.deepEqual(chart.buy_points,[]);
  for(const path of ['markets/us/charts/LOST.json','verified-charts/LOST-1111111111111111.json','verified-charts/LOST-2222222222222222.json'])assert.deepEqual(f.get(path),chart);
  const snapshot=f.get(chart.retained_price_history.snapshot_path);assert.deepEqual(snapshot.rejected_candidate_full_row,f.full);assert.equal(snapshot.rejected_candidate_chart_aliases['static-data/markets/us/charts/LOST.json'].bars[0].date,'2026-07-01');assert(!Object.hasOwn(snapshot,'bars'));assert(!Object.hasOwn(snapshot,'symbol'));
  for(const path of ['charts-index-1111111111111111.json','markets/us/charts/index.json']){const index=f.get(path);assert.equal(index.symbols_total,3);assert.deepEqual(index.symbols.find(row=>row.symbol==='LOST'),{symbol:'LOST',path:row.chart_path});assert(index.symbols.some(row=>row.symbol==='EXTRA'));assert.deepEqual(index.skipped_symbols,['LEDGER_ONLY']);}
  assert.equal(f.get('manifest.json').assets.charts.symbols_total,3);assert.equal(f.get('manifest.json').markets.US.assets.charts.symbols_total,3);assert.equal(f.get('markets/us/scan/manifest.json').charts.symbols_total,3);
  assert(readFileSync(join(f.root,'static-data/candidate-history/index.json')).equals(f.priorCatalog));assert(readFileSync(join(f.root,'static-data/candidate-performance-history/index.json')).equals(f.perfCatalog));assert(!existsSync(join(f.root,'static-data',f.newRef.path)));assert(existsSync(join(f.root,'static-data',f.oldRef.path)));assert(existsSync(join(f.root,'static-data',f.perfRef.path)));
  assert(readFileSync(f.archive).equals(beforeArchive));assert(readFileSync(f.preparedPath).equals(beforePrepared));assert(readFileSync(f.args.sourceReceiptPath).equals(beforeReceipt));assert(readFileSync(join(f.root,'static-data/markets/us/scan/chunks/two.json')).equals(beforeGood));assert.deepEqual(f.get('markets/us/home.json'),beforeHome);
  assert.equal(result.publication_authority,false);assert.equal(result.ready_to_publish,false);assert.equal(result.full_compiler_passed,false);assert.equal(result.requires_financial_carry,true);assert.equal(result.affected_research_rows,1);assert.equal(result.retained_chart_payloads,2);assert(result.mutations.every(m=>m.fields.length&&Object.hasOwn(m,'before_sha256')&&Object.hasOwn(m,'after_sha256')));assert(result.mutations.some(m=>m.path==='static-data/markets/us/scan/chunks/one.json'&&m.fields.includes('/rows/0/financial_reference')));
});

test('binding and dependency failures preflight before any mutation',t=>{
  const cases=[
    ['prepared digest',f=>{f.args.expectedPreparedSha256='0'.repeat(64);},/Prepared SHA256/],
    ['receipt digest',f=>{f.args.sourceReceiptSha256='0'.repeat(64);},/receipt SHA256/],
    ['used source changed',f=>{const x=f.get('markets/us/scan/chunks/one.json');x.rows[0].eps_growth_qq=999;f.put('markets/us/scan/chunks/one.json',x);},/Source size|Source SHA256/],
    ['conflicting authoritative duplicates',f=>{const x=f.get('markets/us/scan/chunks/two.json');x.rows.push({...f.full,eps_growth_qq:999});f.put('markets/us/scan/chunks/two.json',x);f.bind();},/Conflicting authoritative duplicate/],
    ['scan authoritative alias conflict',f=>{const x=f.get('markets/us/scan/manifest.json');x.initial_rows[0].eps_growth_qq=999;f.put('markets/us/scan/manifest.json',x);f.bind();},/Conflicting authoritative duplicate/],
    ['missing research full row',f=>{f.put('markets/us/scan/chunks/one.json',{as_of_date:'2026-10-05',rows:[]});f.bind();},/outside the full universe|missing from full scan/],
    ['raw chart alias wrong symbol',f=>{const x=f.get('markets/us/charts/LOST.json');x.symbol='WRONG';f.put('markets/us/charts/LOST.json',x);f.bind();},/alias identity mismatch/],
    ['prior raw snapshot changed',f=>{f.put(f.oldRef.path,Buffer.from('wrong'));f.bind();},/snapshot SHA256/],
    ['prior catalog reference changed',f=>{const p=JSON.parse(f.args.previousSelectionCatalog.bytes);p.snapshots[0].sha256='f'.repeat(64);f.args.previousSelectionCatalog={bytes:bytes(p),sha256:sha(bytes(p))};},/snapshot reference changed/],
    ['unindexed active history',f=>{f.put('candidate-history/unindexed.json.gz',Buffer.from('unknown'));f.bind();},/Unindexed active history/],
  ];
  for(const [label,mutate,pattern]of cases){const f=fixture(t);mutate(f);const before=inventory(f.root);assert.throws(()=>materializeRecoveryGraph(f.args),pattern,label);assert.deepEqual(inventory(f.root),before,label);}
});

test('duplicate identical full rows are safe but current alias index membership must agree',t=>{
  const f=fixture(t),chunk=f.get('markets/us/scan/chunks/two.json');chunk.rows.push(clone(f.full));f.put('markets/us/scan/chunks/two.json',chunk);f.bind();assert.equal(materializeRecoveryGraph(f.args).affected_research_rows,1);
  const broken=fixture(t),index=broken.get('markets/us/charts/index.json');index.symbols.pop();index.symbols_total=1;broken.put('markets/us/charts/index.json',index);broken.bind();assert.throws(()=>materializeRecoveryGraph(broken.args),/membership/);
});

test('groups fail closed without source-bound complete aggregate proof',t=>{
  const f=fixture(t,{groups:true}),before=inventory(f.root);assert.throws(()=>materializeRecoveryGraph(f.args),/Aggregate dependency proof required/);assert.deepEqual(inventory(f.root),before);
  f.args.aggregateProof={schema_version:'retained-price-aggregate-equivalence-v1',groups_path:'static-data/markets/us/groups.json',groups_sha256:'0'.repeat(64),affected_symbols:['LOST'],dependencies:[]};assert.throws(()=>materializeRecoveryGraph(f.args),/source hash mismatch/);assert.deepEqual(inventory(f.root),before);
});

test('non-null affected group RS and top symbols require recalculation',t=>{
  for(const type of ['rs','top']){const f=fixture(t,{groups:true}),groups=f.get('markets/us/groups.json');if(type==='rs')groups.payload.group_details.Industry.stocks.find(row=>row.symbol==='LOST').rs_rating=99;else groups.payload.rankings.rankings[0].top_symbol='LOST';f.put('markets/us/groups.json',groups);f.bind();const before=inventory(f.root);assert.throws(()=>materializeRecoveryGraph(f.args),/requires.*recalculation/);assert.deepEqual(inventory(f.root),before);}
});

test('post-compiler home synchronization derives counts and preview only from final scan',t=>{
  const f=fixture(t);materializeRecoveryGraph(f.args);const scan=f.get('markets/us/scan/manifest.json'),home=f.get('markets/us/home.json');scan.default_filtered_rows_total=929;scan.preview_rows=[{symbol:'GOOD',current_price:100,financial_current:{literal:'compiler-output'}}];f.put('markets/us/scan/manifest.json',scan);const result=syncRecoveryHome(f.root),after=f.get('markets/us/home.json');
  assert.equal(after.scan_summary.default_filtered_rows_total,929);assert.equal(after.scan_summary.rows_total,2);assert.deepEqual(after.scan_summary.top_results,scan.preview_rows);assert.equal(after.scan_summary.run_id,1);assert.deepEqual(after.key_markets,home.key_markets);assert.equal(after.generated_at,home.generated_at);assert.deepEqual(after.top_groups,home.top_groups);assert.equal(result.publication_authority,false);assert(result.fields.every(field=>field.startsWith('/scan_summary/')));assert.deepEqual(syncRecoveryHome(f.root).fields,[]);
});

test('symlinked dependency and source archive inside output fail before edits',t=>{
  const f=fixture(t),path=join(f.root,'static-data/markets/us/charts/LOST.json'),external=join(f.parent,'chart.json');writeFileSync(external,readFileSync(path));rmSync(path);symlinkSync(external,path);assert.throws(()=>materializeRecoveryGraph(f.args),/Linked graph path/);
  const g=fixture(t),receipt=read(g.args.sourceReceiptPath);receipt.archive.path=join(g.root,'input.zip');write(g.args.sourceReceiptPath,receipt);g.args.sourceReceiptSha256=sha(readFileSync(g.args.sourceReceiptPath));assert.throws(()=>materializeRecoveryGraph(g.args),/outside the disposable tree/);
});

function proofFor(f){const manifest=f.get('manifest.json'),scan=f.get('markets/us/scan/manifest.json');return proveRecoveryAggregateEquivalence({groupsBytes:readFileSync(join(f.root,'static-data/markets/us/groups.json')),groupsPath:'static-data/markets/us/groups.json',homeBytes:readFileSync(join(f.root,'static-data/markets/us/home.json')),homePath:'static-data/markets/us/home.json',fullRows:scan.chunks.flatMap(ref=>f.get(ref.path).rows),affectedSymbols:['LOST'],references:[...new Set([manifest.markets.US.assets.groups_rrg?.path,manifest.assets.groups_rrg?.path].filter(Boolean))].map(path=>{const raw=readFileSync(join(f.root,'static-data',path));return {path:'static-data/'+path,bytes:raw.length,sha256:sha(raw),observation_scope:'original_dated_database_rank_and_taxonomy_stream_not_recalculated'};})});}

test('concrete group proof preserves separate dated history/RRG and resorts only changed member lists',t=>{
  const f=fixture(t,{groups:true}),peer={...clone(f.good),symbol:'PEER',company_name:'Issuer PEER',rs_rating:null,chart_path:null},chunk=f.get('markets/us/scan/chunks/two.json');chunk.rows.push(peer);chunk.rows[0].market_cap_usd=123456;f.put('markets/us/scan/chunks/two.json',chunk);
  const scan=f.get('markets/us/scan/manifest.json');scan.rows_total=3;scan.initial_rows[1]=chunk.rows[0];scan.initial_rows.push(peer);f.put('markets/us/scan/manifest.json',scan);
  const groups=f.get('markets/us/groups.json');groups.payload.group_details.Industry.stocks.push({symbol:'PEER',company_name:'Issuer PEER',rs_rating:null,composite_score:20});f.put('markets/us/groups.json',groups);
  const rrg={available:true,as_of_date:'2026-10-05',generated_at:'original-dated-clock',payload:{source:'original_database_ranks',history:[1,2,3]}};f.put('markets/us/groups_rrg.json',rrg);const manifest=f.get('manifest.json');manifest.assets.groups_rrg={path:'markets/us/groups_rrg.json'};manifest.markets.US.assets.groups_rrg={path:'markets/us/groups_rrg.json'};f.put('manifest.json',manifest);f.bind();
  f.args.aggregateProof=proofFor(f);const rrgBefore=readFileSync(join(f.root,'static-data/markets/us/groups_rrg.json')),homeBefore=readFileSync(join(f.root,'static-data/markets/us/home.json'));
  const result=materializeRecoveryGraph(f.args),after=f.get('markets/us/groups.json'),detail=after.payload.group_details.Industry;
  assert.deepEqual(detail.stocks.map(row=>row.symbol),['GOOD','PEER','LOST']);const lost=detail.stocks.at(-1);assert.equal(lost.price,null);assert.equal(lost.rs_rating_1m,null);assert.equal(lost.composite_score,null);assert.equal(lost.stage,null);assert.equal(lost.price_sparkline_data,null);assert.deepEqual(lost.financial_current,{literal:true});
  assert.deepEqual(detail.history,groups.payload.group_details.Industry.history);assert.deepEqual(after.payload.rankings,groups.payload.rankings);assert.deepEqual(after.payload.movers,groups.payload.movers);assert.equal(after.generated_at,groups.generated_at);assert(readFileSync(join(f.root,'static-data/markets/us/groups_rrg.json')).equals(rrgBefore));assert(readFileSync(join(f.root,'static-data/markets/us/home.json')).equals(homeBefore));
  assert.deepEqual(result.aggregate_equivalence,f.args.aggregateProof);const contributors=f.args.aggregateProof.dependencies.find(item=>item.name==='eligible_contributors_in_source_order');assert.equal(contributors.before[0][1][0].market_cap_usd.value,123456);assert.deepEqual(contributors.before,contributors.after);assert.equal(result.aggregate_equivalence.independent_dated_observations.references[0].sha256,sha(rrgBefore));
});

test('fabricated equal group vectors and changed full-row weight bindings are rejected before writes',t=>{
  for(const attack of ['vectors','weights']){const f=fixture(t,{groups:true});f.args.aggregateProof=proofFor(f);if(attack==='vectors'){f.args.aggregateProof.dependencies[0].before=[];f.args.aggregateProof.dependencies[0].after=[];}else{const chunk=f.get('markets/us/scan/chunks/two.json');chunk.rows[0].market_cap_usd=999;f.put('markets/us/scan/chunks/two.json',chunk);const scan=f.get('markets/us/scan/manifest.json');scan.initial_rows[1]=chunk.rows[0];f.put('markets/us/scan/manifest.json',scan);f.bind();}const before=inventory(f.root);assert.throws(()=>materializeRecoveryGraph(f.args),/complete source-bound/);assert.deepEqual(inventory(f.root),before);}
});

test('missing financial-history receives an unavailable prebaseline scaffold, while existing source bytes stay literal',t=>{
  const absent=fixture(t),result=materializeRecoveryGraph(absent.args);assert.deepEqual(absent.get('financial-history.json'),{as_of_date:'2026-10-05',results:{}});assert(result.mutations.some(item=>item.path==='static-data/financial-history.json'&&item.reason==='explicit_unavailable_financial_history_before_carry_baseline'));
  const present=fixture(t),raw=Buffer.from('{ "as_of_date": "2026-10-05", "results": {}, "retrieved_at": "original" }\n');present.put('financial-history.json',raw);present.bind();const output=materializeRecoveryGraph(present.args);assert(readFileSync(join(present.root,'static-data/financial-history.json')).equals(raw));assert(!output.mutations.some(item=>item.path==='static-data/financial-history.json'));
});

function addQuarantine(f){
  const full={...clone(f.full),symbol:'EQR',company_name:'Issuer EQR',chart_path:null,research_detail_path:'research-details/EQR-old.json',current_price:63.65999984741211,rs_rating:null,eps_growth_qq:77};
  const prior={symbol:'EQR',market:'US',currency:'USD',exchange:'XNAS',company_name:'Issuer EQR',as_of_date:'2026-10-02',current_price:full.current_price,chart_path:null};
  const candidate={...clone(prior),as_of_date:'2026-10-05'},snapshot={schema_version:'retained-price-row-quarantine-snapshot-v1',publication_authority:false,prior_row:prior,candidate_row:candidate};
  const item={symbol:'EQR',row:{...candidate,current_price:null,chart_path:null},snapshot_path:'retained-price-history/'+recoveryDigest(snapshot)+'.json',snapshot,reason:'undated_price_without_chart',candidate_row_sha256:recoveryDigest(candidate),prior_row_sha256:recoveryDigest(prior),observation_date:null};
  const compiled=read(f.preparedPath);compiled.row_quarantines=[item];write(f.preparedPath,compiled);f.args.expectedPreparedSha256=sha(readFileSync(f.preparedPath));
  const chunk=f.get('markets/us/scan/chunks/two.json');chunk.rows.push(full);f.put('markets/us/scan/chunks/two.json',chunk);const scan=f.get('markets/us/scan/manifest.json');scan.rows_total=3;scan.initial_rows.push(full);scan.results.push(full);f.put('markets/us/scan/manifest.json',scan);f.put(full.research_detail_path,full);f.bind();return full;
}

test('reviewed EQR row-only quarantine clears current aliases without inventing chart observations or changing full financial inputs',t=>{
  const f=fixture(t),original=addQuarantine(f),result=materializeRecoveryGraph(f.args),row=f.get('markets/us/scan/chunks/two.json').rows.find(row=>row.symbol==='EQR');
  assert.equal(row.current_price,null);assert.equal(row.adv_usd,null);assert.equal(row.chart_path,null);assert.equal(row.rs_rating,null);assert.equal(row.se_setup_ready,false);assert.equal(row.passes_template,null);assert.equal(row.technical_audit.valid,false);assert.equal(row.eps_growth_qq,77);assert.deepEqual(row.financial_current,original.financial_current);assert(!Object.hasOwn(row,'financial_reference'));assert(!Object.hasOwn(row,'retained_price_history'));
  assert.equal(row.price_quarantine.observation_date,null);assert.equal(row.price_quarantine.status,'unverified_observation');assert.deepEqual(f.get(row.price_quarantine.snapshot_path).rejected_candidate_full_row,original);assert.deepEqual(f.get('research-details/EQR-old.json'),row);assert.deepEqual(f.get('markets/us/scan/manifest.json').results.find(item=>item.symbol==='EQR'),row);
  for(const path of ['charts-index-1111111111111111.json','markets/us/charts/index.json'])assert(!f.get(path).symbols.some(item=>item.symbol==='EQR'));
  assert.equal(result.affected_research_rows,2);assert.equal(result.restored_research_rows,1);assert.equal(result.quarantined_research_rows,1);assert.equal(result.retained_chart_payloads,2);assert.equal(result.chart_index_only,1);assert.equal(result.chart_members_total,3);assert.deepEqual(result.ledger_only_absences,[JSON.stringify(['US','chart','LEDGER_ONLY'])]);
});

test('quarantine refuses source chart ambiguity and unsupported expansion before mutations',t=>{
  for(const attack of ['chart','symbol','hash']){const f=fixture(t);addQuarantine(f);if(attack==='chart'){f.put('markets/us/charts/EQR.json',{symbol:'EQR',bars:[]});f.bind();}else{const prepared=read(f.preparedPath);if(attack==='symbol')prepared.row_quarantines[0].symbol='ANOTHER';else prepared.row_quarantines[0].candidate_row_sha256='0'.repeat(64);write(f.preparedPath,prepared);f.args.expectedPreparedSha256=sha(readFileSync(f.preparedPath));}const before=inventory(f.root);assert.throws(()=>materializeRecoveryGraph(f.args),/unindexed chart|reviewed EQR|binding mismatch/);assert.deepEqual(inventory(f.root),before);}
});

test('price graph and home helpers refuse the financial-only pass environment',t=>{
  const f=fixture(t),name='FINANCIAL_GENERATION_CARRY_PROJECTION',old=process.env[name];process.env[name]='/fixture/carry.json';try{assert.throws(()=>materializeRecoveryGraph(f.args),/financial-only pass/);assert.throws(()=>syncRecoveryHome(f.root),/financial-only pass/);}finally{if(old===undefined)delete process.env[name];else process.env[name]=old;}
});

test('generated alias matching does not confuse a distinct hyphenated symbol with an affected prefix',t=>{
  const f=fixture(t),path='verified-charts/LOST-CLASS-1111111111111111.json',payload={symbol:'LOST-CLASS',as_of_date:'2026-10-05',bars:[{date:'2026-10-05',close:10}],stock_data:{symbol:'LOST-CLASS'}};f.put(path,payload);f.bind();const original=readFileSync(join(f.root,'static-data',path));materializeRecoveryGraph(f.args);assert(readFileSync(join(f.root,'static-data',path)).equals(original));
});

function makeResidualHistory(f){
  const prepared=read(f.preparedPath),patch=prepared.patches[0],target='2026-10-05';
  const original=f.get(f.full.chart_path);original.as_of_date=target;original.stock_data=clone(f.full);f.put(f.full.chart_path,original);
  const snapshot={schema_version:'retained-price-residual-snapshot-v1',publication_authority:false,review_sha256:'a'.repeat(64),source_observations_sha256:'b'.repeat(64),actual_observation_date:'2026-10-02',candidate_row:clone(f.full),original_candidate_chart:original};
  Object.assign(patch,{history_origin:'candidate_current_quarantine',snapshot,reason:'stale_candidate_history',observation_date:'2026-10-02',candidate_row_sha256:recoveryDigest(f.full),historical_chart_sha256:recoveryDigest(original)});
  Object.assign(patch.chart.retained_price_history,{snapshot_sha256:recoveryDigest(snapshot),original_as_of_date:target});patch.chart.as_of_date=target;
  prepared.residual_current_review={schema_version:'retained-price-residual-application-v1',publication_authority:false,ready_to_publish:false,review_sha256:snapshot.review_sha256,source_observations_sha256:snapshot.source_observations_sha256,residual_before:1,residual_after:0,stale_histories:1,undated_rows:0,records:[{symbol:'LOST',observation_date:patch.observation_date,reason:patch.reason,snapshot_sha256:recoveryDigest(snapshot),candidate_row_sha256:patch.candidate_row_sha256,candidate_chart_sha256:recoveryDigest(original)}]};
  write(f.preparedPath,prepared);f.args.expectedPreparedSha256=sha(readFileSync(f.preparedPath));f.bind();return original;
}
test('candidate stale history is kept distinct from restored prior histories and clears all index/action aliases',t=>{
  const f=fixture(t),original=makeResidualHistory(f),report=materializeRecoveryGraph(f.args),row=f.get('markets/us/scan/chunks/one.json').rows[0];
  assert.equal(report.stale_candidate_histories,1);assert.equal(report.restored_research_rows,0);assert.equal(report.residual_current_rows,1);
  assert.equal(row.current_price,null);assert.equal(row.adv_usd,null);assert.equal(row.rs_rating,null);assert.deepEqual(f.get(row.chart_path).bars,original.bars);assert.equal(f.get(row.chart_path).generated_at,original.generated_at);
  for(const path of ['charts-index-1111111111111111.json','markets/us/charts/index.json']){const entry=f.get(path).symbols.find(row=>row.symbol==='LOST');assert.deepEqual(Object.keys(entry).sort(),['path','symbol']);}
  assert.deepEqual(f.get(f.get(row.chart_path).retained_price_history.snapshot_path).prepared_snapshot.original_candidate_chart,original);
});
test('residual materializer rejects forged scope, source chart and date before writes',t=>{
  for(const attack of ['scope','chart','date','original']){const f=fixture(t);makeResidualHistory(f);if(attack==='original'){const chart=f.get(f.full.chart_path);chart.bars[0].close=500;f.put(f.full.chart_path,chart);f.bind();}else{const p=read(f.preparedPath);if(attack==='scope')p.residual_current_review.records=[];if(attack==='chart')p.patches[0].historical_chart_sha256='0'.repeat(64);if(attack==='date')p.patches[0].observation_date='2026-10-05';write(f.preparedPath,p);f.args.expectedPreparedSha256=sha(readFileSync(f.preparedPath));}const before=inventory(f.root);assert.throws(()=>materializeRecoveryGraph(f.args));assert.deepEqual(inventory(f.root),before);}
});

test('group proof binds truly unclassified affected nonmembers without masking valid aggregates',t=>{
  const f=fixture(t,{groups:true}),fullRows=[clone(f.full),clone(f.good)],unclassified={...clone(f.good),symbol:'UNCLASSIFIED',ibd_industry_group:null};fullRows.push(unclassified);
  const input={groupsBytes:readFileSync(join(f.root,'static-data/markets/us/groups.json')),groupsPath:'static-data/markets/us/groups.json',homeBytes:readFileSync(join(f.root,'static-data/markets/us/home.json')),homePath:'static-data/markets/us/home.json',fullRows,affectedSymbols:['LOST','UNCLASSIFIED']};
  const proof=proveRecoveryAggregateEquivalence(input),nonmembers=proof.dependencies.find(row=>row.name==='affected_unclassified_nonmembers');assert.deepEqual(nonmembers.before,[['UNCLASSIFIED',{present:true,value:null},recoveryDigest(unclassified)]]);assert.deepEqual(nonmembers.after,nonmembers.before);assert.equal(proof.before_sha256,proof.after_sha256);
  const changed=clone(fullRows);changed.at(-1).ibd_industry_group='Industry';assert.throws(()=>proveRecoveryAggregateEquivalence({...input,fullRows:changed}),/coverage mismatch/);
  const injected=JSON.parse(input.groupsBytes);injected.payload.group_details.Industry.stocks.push({symbol:'UNCLASSIFIED',rs_rating:null});assert.throws(()=>proveRecoveryAggregateEquivalence({...input,groupsBytes:bytes(injected)}),/unexpectedly appears/);
});

function addChangedGroupContributor(f){
  makeResidualHistory(f);const groups=f.get('markets/us/groups.json');
  const ranking={industry_group:'Industry',date:'2026-10-05',rank:1,avg_rs_rating:53.61,median_rs_rating:53.61,weighted_avg_rs_rating:null,rs_std_dev:45.39,num_stocks:2,num_stocks_rs_above_80:1,pct_rs_above_80:50,top_symbol:'GOOD',top_symbol_name:'Issuer GOOD',top_rs_rating:99,rank_change_1w:2,rank_change_1m:3,rank_change_3m:null,rank_change_6m:null};
  groups.payload.rankings.rankings=[ranking];groups.payload.movers.gainers=[ranking];Object.assign(groups.payload.group_details.Industry,{num_stocks:2,current_avg_rs:53.61});groups.payload.group_details.Industry.stocks.find(row=>row.symbol==='LOST').rs_rating=8.22;f.put('markets/us/groups.json',groups);
  const home=f.get('markets/us/home.json');home.top_groups=[ranking];f.put('markets/us/home.json',home);f.bind();
  return {groupsBytes:readFileSync(join(f.root,'static-data/markets/us/groups.json')),groupsPath:'static-data/markets/us/groups.json',homeBytes:readFileSync(join(f.root,'static-data/markets/us/home.json')),homePath:'static-data/markets/us/home.json',fullRowBindings:[f.full,f.good].map(row=>({symbol:row.symbol,fields:{symbol:row.symbol,company_name:row.company_name,ibd_industry_group:row.ibd_industry_group},sha256:recoveryDigest(row)})),affectedSymbols:['LOST']};
}
test('changed current group contribution uses exact producer arithmetic and updates group/home aliases while preserving dated history',t=>{
  const f=fixture(t,{groups:true}),input=addChangedGroupContributor(f),original=f.get('markets/us/groups.json'),proof=proveRecoveryAggregateCorrectionFromRowBindings(input);
  assert.equal(proof.schema_version,'retained-price-aggregate-correction-v1');assert.equal(proof.contributor_changes.length,1);assert.equal(proof.contributor_changes[0].symbol,'LOST');assert.equal(proof.replacement_rankings[0].avg_rs_rating,99);assert.equal(proof.replacement_rankings[0].num_stocks,1);assert.equal(proof.replacement_rankings[0].pct_rs_above_80,100);assert.equal(proof.replacement_rankings[0].rank_change_1w,2);
  f.args.aggregateProof=proof;materializeRecoveryGraph(f.args);const after=f.get('markets/us/groups.json');assert.deepEqual(after.payload.group_details.Industry.history,original.payload.group_details.Industry.history);assert.equal(after.generated_at,original.generated_at);assert.equal(after.payload.group_details.Industry.current_avg_rs,99);assert.equal(after.payload.group_details.Industry.stocks.find(row=>row.symbol==='LOST').rs_rating,null);assert.deepEqual(f.get('markets/us/home.json').top_groups,proof.replacement_rankings);
});
test('group correction rejects changed original arithmetic or a forged changed-group result before mutations',t=>{
  const f=fixture(t,{groups:true}),input=addChangedGroupContributor(f),bad=JSON.parse(input.groupsBytes);bad.payload.rankings.rankings[0].weighted_avg_rs_rating=123;assert.throws(()=>proveRecoveryAggregateCorrectionFromRowBindings({...input,groupsBytes:bytes(bad)}));
  f.args.aggregateProof=proveRecoveryAggregateCorrectionFromRowBindings(input);f.args.aggregateProof.replacement_rankings[0].num_stocks=99;const before=inventory(f.root);assert.throws(()=>materializeRecoveryGraph(f.args),/differs from the complete/);assert.deepEqual(inventory(f.root),before);
});
test('group correction moves only affected current ranks and preserves implied historical reference ranks and unchanged groups',t=>{
  const f=fixture(t,{groups:true}),input=addChangedGroupContributor(f),groups=JSON.parse(input.groupsBytes),industry=groups.payload.rankings.rankings[0];industry.rank=2;
  const ranking=(name,symbol,rs,rank)=>({industry_group:name,date:'2026-10-05',rank,avg_rs_rating:rs,median_rs_rating:rs,weighted_avg_rs_rating:null,rs_std_dev:0,num_stocks:1,num_stocks_rs_above_80:0,pct_rs_above_80:0,top_symbol:symbol,top_symbol_name:symbol,top_rs_rating:rs,rank_change_1w:3,rank_change_1m:null,rank_change_3m:null,rank_change_6m:null});
  const other=ranking('Other','OTHER',60,1),stable=ranking('Stable','STABLE',30,3);groups.payload.rankings.rankings=[other,industry,stable];groups.payload.group_details.Industry.current_rank=2;
  for(const row of [other,stable]){groups.payload.group_details[row.industry_group]={current_rank:row.rank,current_avg_rs:row.avg_rs_rating,num_stocks:1,top_symbol:row.top_symbol,history:[{date:'2026-10-05',rank:999}],stocks:[{symbol:row.top_symbol,company_name:row.top_symbol,rs_rating:row.avg_rs_rating,composite_score:1}]};input.fullRowBindings.push({symbol:row.top_symbol,fields:{symbol:row.top_symbol,company_name:row.top_symbol,ibd_industry_group:row.industry_group},sha256:'c'.repeat(64)});}
  groups.payload.movers.gainers=[other,stable,industry];const home=JSON.parse(input.homeBytes);home.top_groups=groups.payload.rankings.rankings;
  const proof=proveRecoveryAggregateCorrectionFromRowBindings({...input,groupsBytes:bytes(groups),homeBytes:bytes(home)});assert.deepEqual(proof.replacement_rankings.map(row=>[row.industry_group,row.rank,row.rank_change_1w]),[['Industry',1,3],['Other',2,2],['Stable',3,3]]);assert.deepEqual(proof.replacement_rankings.find(row=>row.industry_group==='Stable'),stable);assert.equal(proof.changed_rankings.length,2);
});

function addHomeHistory(f){
  const home=f.get('markets/us/home.json');Object.assign(home,{schema_version:'static-site-v2',generated_at:'2026-10-06T05:00:00Z',freshness:{prices_generated_at:'2026-10-06T04:00:00Z'},key_markets:[{symbol:'TVC:DXY',currency:'USD',display_name:'US Dollar Index',history:[],latest_close:null,latest_date:null,change_1d:null}]});
  f.put('markets/us/home.json',home);
  const old={...clone(home),as_of_date:'2026-10-02',generated_at:'2026-10-04T04:20:51Z'};
  Object.assign(old.key_markets[0],{history:[{date:'2026-10-01',close:101},{date:'2026-10-02',close:102}],latest_date:'2026-10-02',latest_close:102,change_1d:1});
  const priorBytes=Buffer.from(JSON.stringify(old,null,2)+'\n'),candidateBytes=readFileSync(join(f.root,'static-data/markets/us/home.json'));
  const pub={schema:1,verification_universe:{as_of_date:'2026-10-02'},price_observations:{[RETAINED_HOME_KEY]:'2026-10-02'},known_price_dates:{[RETAINED_HOME_KEY]:'2026-10-02'}};
  const manifest_json=readFileSync(join(f.root,'static-data/manifest.json'),'utf8'),source={manifest_json,manifest_sha256:sha(manifest_json),price_observations:{},price_observations_sha256:priceObservationDigest({})};
  const patch=prepareRetainedHomeHistory({priorPublication:pub,candidateSource:source,priorHomeBytes:priorBytes,priorHomeSha256:sha(priorBytes),candidateHomeBytes:candidateBytes,candidateHomeSha256:sha(candidateBytes)});
  const prepared=read(f.preparedPath);prepared.home_history=patch;write(f.preparedPath,prepared);f.args.expectedPreparedSha256=sha(readFileSync(f.preparedPath));f.bind();return {patch,priorBytes,candidateBytes};
}

test('DXY home history composes atomically with changed group aliases and later scan synchronization',t=>{
  const f=fixture(t,{groups:true}),input=addChangedGroupContributor(f),home=addHomeHistory(f);
  input.homeBytes=home.candidateBytes;f.args.aggregateProof=proveRecoveryAggregateCorrectionFromRowBindings(input);
  const result=materializeRecoveryGraph(f.args),after=f.get('markets/us/home.json');
  assert.equal(result.retained_home_histories,1);assert.deepEqual(after.top_groups,f.args.aggregateProof.replacement_rankings);
  assert.deepEqual(after.key_markets[0].history,JSON.parse(home.priorBytes).key_markets[0].history);
  assert.equal(after.key_markets[0].latest_close,null);assert.equal(after.key_markets[0].change_1d,null);assert.equal(after.key_markets[0].latest_date,'2026-10-02');
  assert(readFileSync(join(f.root,'static-data',home.patch.snapshot_path)).equals(home.priorBytes));
  assert(readFileSync(join(f.root,'static-data',home.patch.rejected_snapshot_path)).equals(home.candidateBytes));
  assert.equal(result.mutations.filter(item=>item.path==='static-data/markets/us/home.json').length,1);
  syncRecoveryHome(f.root);assert.deepEqual(f.get('markets/us/home.json').key_markets,after.key_markets);assert.deepEqual(f.get('markets/us/home.json').top_groups,after.top_groups);
});

test('changed source home or manifest refuses DXY materialization before any write',t=>{
  for(const attack of ['home','manifest']){
    const f=fixture(t);addHomeHistory(f);
    const path=attack==='home'?'markets/us/home.json':'manifest.json',value=f.get(path);value.extra='unreviewed';f.put(path,value);f.bind();
    const before=inventory(f.root);assert.throws(()=>materializeRecoveryGraph(f.args),/home SHA256 mismatch|source manifest differs/);assert.deepEqual(inventory(f.root),before);
  }
});

test('Oct6 arithmetic proof carries its own reviewed producer and rejects an invented runtime',t=>{
  const f=fixture(t,{groups:true}),input=addChangedGroupContributor(f);
  const proof=proveRecoveryAggregateCorrectionFromRowBindings({...input,producerRuntimeReview:oct6ProducerRuntime});
  assert.deepEqual(proof.arithmetic_adapter.producer_runtime,oct6ProducerRuntime);
  assert.equal(proof.arithmetic_adapter.producer_runtime.source_sha,'448c188de584b77a09bea52f233f881c2b31eeb9');
  assert.throws(()=>proveRecoveryAggregateCorrectionFromRowBindings({...input,producerRuntimeReview:{...oct6ProducerRuntime,python_version:'3.12'}}),/Unreviewed producer runtime/);
  f.args.aggregateProof=proof;const before=inventory(f.root);
  assert.throws(()=>materializeRecoveryGraph(f.args),/differs from the complete/);assert.deepEqual(inventory(f.root),before);
});
