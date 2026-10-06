import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { previewInputOptions } from './controls.mjs';
import { openPublishedInput, sha256 } from './input.mjs';
import { baseCountHistory } from '../../../frontend/src/static/baseCountHistory.js';
import { institutionalHolderHistory } from '../../../frontend/src/static/institutionalHistory.js';
import { highLowHistory, INDICATOR_HISTORY_VERSION } from '../../../frontend/src/static/indicatorHistory.js';
import { putCallHistory, PUT_CALL_VERSION } from '../../../frontend/src/static/putCallHistory.js';
import { distributionHistory } from '../../../frontend/src/static/distributionHistory.js';
import { entrySnapshot, entryHistory, summarizeEntrySnapshot, ENTRY_METHODS, ENTRY_HISTORY_VERSION, ENTRY_UNIVERSE } from '../../../frontend/src/static/entryHistory.js';
import { entryPriceHistoryBasis } from '../../../frontend/tools/export-indicator-history.mjs';
import { auditDailyBars } from '../../../frontend/src/static/qualificationAudit.js';
import { modelMarket } from '../../../frontend/src/static/portfolioPlan.js';
import { assess, researchCsv } from '../../../frontend/src/static/researchEngine.js';
import { decodeResearchIndex, encodeResearchIndex } from '../../../frontend/src/static/researchTransport.js';

const output = resolve(process.env.INDICATOR_PREVIEW_OUTPUT || 'frontend/test-results/indicator-preview');
const input = await openPublishedInput(await previewInputOptions(process.env));
const hash = value => sha256(Buffer.from(JSON.stringify(value)));
const methods = ['minervini','minervini2','oneil','ibd'];
const originalCsvColumns = csv => csv.replace(/,"[^"]*","[^"]*","[^"]*"(?=\r\n|$)/g,'');
try {
  const {manifest,market} = input, date = market.as_of_date;
  const [breadth, benchmark, researchBytes, chartIndex, holders] = await Promise.all([
    input.readJson(market.pages.breadth.path), input.readJson('book-benchmark.json'), input.readBytes(market.assets.research.path), input.readJson(market.assets.charts.path), input.readJson('institutional-holdings.json'),
  ]);
  const index = decodeResearchIndex(JSON.parse(Buffer.from(researchBytes))), rows = index.rows;
  const now = index.financial_evaluated_at || Date.parse(manifest.generated_at);
  if (!Number.isFinite(now) || benchmark.as_of_date !== date) throw Error('Source evaluation/calendar identity is unavailable');
  const symbols = ['NVDA','AMD','AAPL','AVGO','TSM','PLTR'];
  const charts = [], details = [], priceHistoryBasis = {};
  const calendar = benchmark.bars.map(bar => bar.date);
  for (const symbol of symbols) {
    const sourceRow = rows.find(row => row.symbol === symbol), ref = chartIndex.symbols.find(row => row.symbol === symbol);
    if (!sourceRow?.research_detail_path || !ref?.path) throw Error(`Required real sample missing: ${symbol}`);
    const [chart,detail] = await Promise.all([input.readJson(ref.path),input.readJson(sourceRow.research_detail_path)]);
    const audit = auditDailyBars(detail,chart,date);
    if (!audit.valid || detail.symbol !== symbol || detail.as_of_date !== date) throw Error(`Real sample failed identity/OHLC audit: ${symbol}`);
    const base = baseCountHistory(chart,symbol,date,calendar);
    const derived = {...detail,base_count_history:base,base_count_summary:{version:base.version,as_of_date:date,count:base.count,origin_known:base.originKnown,complete:base.complete},institutional_holder_history:institutionalHolderHistory(detail.institutional_evidence,symbol,date)};
    for (const method of methods) if (hash(assess(detail,method,now)) !== hash(assess(derived,method,now))) throw Error(`History changed method qualification: ${symbol}/${method}`);
    for(const method of methods) if(originalCsvColumns(researchCsv([{row:detail}],method,date,now))!==originalCsvColumns(researchCsv([{row:derived}],method,date,now))) throw Error(`History changed original CSV columns: ${symbol}/${method}`);
    charts.push(chart);details.push(derived);priceHistoryBasis[symbol]=entryPriceHistoryBasis(chart,date);
  }
  const snapshot=entrySnapshot(details,{asOf:date,previousSession:calendar.at(-2),generatedAt:manifest.generated_at,ruleVersion:'isolated-preview-current-observation',priceHistoryBasis,market:modelMarket(details),now});
  for(const method of methods) if(summarizeEntrySnapshot(snapshot,snapshot,method).newCrossings!==null)throw Error('Same-date preview manufactured an entry event');
  const histories={version:INDICATOR_HISTORY_VERSION,as_of_date:date,highLow:highLowHistory(breadth.payload.book_market_evidence,date),
    putCall:putCallHistory(null,date),distribution:Object.fromEntries(['sp500','nasdaq'].map(key=>[key,distributionHistory(null,key,date)])),
    entry:Object.fromEntries(ENTRY_METHODS.map(method=>[method,Object.fromEntries([1,3,5].map(approach=>{
      const result=entryHistory([snapshot],date,method,approach);
      result.scope=`実データ${details.length}銘柄の現位置のみ。プレビュー内再計算で、過去の公開イベントではありません。`;
      result.basis='real_source_preview_recalculation';return [approach,result];
    }))]))};
  const syntheticDates=[]; for(let time=Date.parse('2026-01-02');syntheticDates.length<60;time+=86400000){const day=new Date(time);if(![0,6].includes(day.getUTCDay()))syntheticDates.push(day.toISOString().slice(0,10));}
  const syntheticDate=syntheticDates.at(-1);
  const indexInput=kind=>({price_symbol:kind==='sp500'?'^GSPC':'^IXIC',volume_universe:kind==='sp500'?'NYSE':'NASDAQ',source:{name:'合成テスト値・実市場ではない',price_url:'https://example.invalid/synthetic',volume_url:'https://example.invalid/synthetic'},calendar_source:'合成平日カレンダー（実在取引日ではない）',sessions:syntheticDates,observations:syntheticDates.map((day,i)=>({date:day,close:i===31||i===40?99:i===45?105:100,volume:i===31||i===40?1100:i===52?0:1000}))});
  const syntheticSnapshots=syntheticDates.slice(-4).map((day,i)=>({version:ENTRY_HISTORY_VERSION,as_of:day,previous_session:i?syntheticDates.slice(-4)[i-1]:null,generated_at:`${day}T22:00:00Z`,rule_version:'synthetic-only',universe_version:ENTRY_UNIVERSE,records:[{symbol:'TEST-ONLY',market:'US',price:[99,102,99,103][i],pivot:100,distance:[-1,2,-1,3][i],pivotIdentity:'synthetic-base',sourceBasis:'synthetic-source',priceHistoryBasis:{prior:String(i).padStart(64,'0'),latest:String(i+1).padStart(64,'0')},methods:Object.fromEntries(ENTRY_METHODS.map(method=>[method,{zone:method==='minervini2'?3:5,qualified:true,ready:false}]))}]}));
  const synthetic={version:INDICATOR_HISTORY_VERSION,as_of_date:syntheticDate,
    highLow:{...histories.highLow,as_of_date:syntheticDate,series:[],latest:null,status:'unavailable',reason:'この合成ケースでは新高値・新安値を作成しません。'},
    putCall:putCallHistory({version:PUT_CALL_VERSION,metric:'volume',license:{redistribution:'permitted'},source:{name:'合成テスト値・配信契約ではない',url:'https://example.invalid/synthetic'},scope:{label:'架空のオプション契約数',venues:['TEST_ONLY'],products:['SYNTHETIC']},observations:syntheticDates.slice(-8).map((day,i)=>({date:day,put_contracts:60+i*8,call_contracts:i===5?0:100}))},syntheticDate),
    distribution:Object.fromEntries(['sp500','nasdaq'].map(key=>[key,distributionHistory(indexInput(key),key,syntheticDate)])),
    entry:Object.fromEntries(ENTRY_METHODS.map(method=>[method,Object.fromEntries([1,3,5].map(approach=>[approach,entryHistory(syntheticSnapshots,syntheticDate,method,approach)]))]))};
  for(const item of [synthetic.putCall,...Object.values(synthetic.distribution),...Object.values(synthetic.entry).flatMap(value=>Object.values(value))]) {item.basis='synthetic_test_only';item.scope=`合成例・投資判断に使用不可。${item.scope}`;}
  await mkdir(output,{recursive:true});
  const sourceTimes=details.flatMap(row=>Object.values(row.financial_current?.p||{}).flatMap(proof=>Array.isArray(proof)&&Number.isFinite(proof[4])&&proof[4]>0?[proof[4]]:[]));
  const financialObservations=sourceTimes.length?{first:new Date(Math.min(...sourceTimes)).toISOString(),last:new Date(Math.max(...sourceTimes)).toISOString(),scope:'published scalar proof timestamps for the six sample rows; not evaluation time'}:null;
  const provenance={...input.provenance(),candidate_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),mode:'isolated_actual_components',clock:'explicit source evaluation timestamp; global browser clock is not changed',evaluated_at:new Date(now).toISOString(),financial_observations:financialObservations,sample_symbols:symbols,real_current_entry_universe:details.length};
  await writeFile(resolve(output,'preview-data.json'),JSON.stringify({provenance,date,now,histories,synthetic,rows:details,charts}));
  await writeFile(resolve(output,'real-sample.csv'),researchCsv(details.map(row=>({row})),'minervini',date,now));
  const impact={provenance,source_rows:rows.length,source_research:{bytes:researchBytes.length,gzip_bytes:gzipSync(researchBytes).length},qualification_invariant:'all four methods unchanged for each selected real sample',csv_invariant:'all existing CSV columns unchanged; only three explicitly named base-estimate columns appended',snapshot_invariant:'same-price-date comparison remains unavailable; no manufactured entry event',history_crossings:'unavailable for real-source first observation; explicitly synthetic in edge cases'};
  if(process.env.INDICATOR_FULL_COHORT==='true'){
    const started=performance.now();let verified=0,unavailable=0,stages=0,addedDetailBytes=0;
    const proposed=[];const sampleCharts=new Map(charts.map(chart=>[chart.symbol,chart]));
    for(const row of rows){
      let chart=null;
      if(row.technical_audit?.valid===true && row.chart_path){chart=sampleCharts.get(row.symbol)||await input.readJson(row.chart_path);if(!auditDailyBars(row,chart,date).valid)throw Error(`Full-cohort audit mismatch: ${row.symbol}`);verified++;}else unavailable++;
      const base=baseCountHistory(chart,row.symbol,date,calendar),holder=institutionalHolderHistory(holders.results?.[row.symbol],row.symbol,date);
      if(base.count!=null)stages++;addedDetailBytes+=Buffer.byteLength(JSON.stringify({base_count_history:base,institutional_holder_history:holder}));
      proposed.push({...row,base_count_summary:{version:base.version,as_of_date:date,count:base.count,origin_known:base.originKnown,complete:base.complete}});
    }
    const bytes=Buffer.from(JSON.stringify(encodeResearchIndex({...index,rows:proposed},undefined,{columnBytes:column=>gzipSync(JSON.stringify(column)).length})));
    impact.full_cohort={rows:rows.length,verified_charts:verified,unavailable_charts:unavailable,usable_base_estimates:stages,elapsed_ms:performance.now()-started,peak_rss_bytes:process.resourceUsage().maxRSS*1024,projected_research_bytes:bytes.length,projected_research_gzip_bytes:gzipSync(bytes).length,added_history_detail_bytes:addedDetailBytes,budget_pass:bytes.length<=8000000&&gzipSync(bytes).length<=1000000,scope:'read-only derivation and research-index projection; not a complete production exporter replay'};

  }
  impact.provenance={...provenance,...input.provenance()};
  await writeFile(resolve(output,'payload-impact.json'),JSON.stringify(impact,null,2));
  await writeFile(resolve(output,'input-provenance.json'),JSON.stringify(provenance,null,2));
  if(impact.full_cohort && !impact.full_cohort.budget_pass)throw Error('Projected full-cohort research index exceeds the unchanged byte budget');
  console.log(JSON.stringify({output,real_samples:details.length,high_low_points:histories.highLow.series.length,full_cohort:impact.full_cohort||null}));
}finally{input.close();}
