// Normal producer input preservation, not publication authority or an exception.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { livePublication, bootstrap, safePath } from '../../.github/scripts/publication-state.mjs';
import { comparePriceObservations, extractPriceObservations } from '../../.github/scripts/price-observations.mjs';
import { isEligibleForPublication } from '../../.github/scripts/retained-universe.mjs';
import { currentUnknownRow, RECOVERY_FINANCIAL_FIELDS } from '../../.github/scripts/retained-price-recovery.mjs';
import { createStaticTransport } from '../src/static/transport/index.mjs';
import { mergeScanRows } from '../src/static/qualificationAudit.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));
const copy = value => structuredClone(value);
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value;
const financial = row => Object.fromEntries(RECOVERY_FINANCIAL_FIELDS.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
const sorted = values => [...new Set(values)].sort();
async function write(root, path, value) {
  assert(safePath(path),'Unsafe producer output path');
  let part=root;
  for(const name of path.split('/')){
    part=join(part,name);
    try{assert(!(await lstat(part)).isSymbolicLink(),'Linked producer output');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return writeFile(join(root,path),JSON.stringify(value));
}
async function local(root, path) {
  assert(safePath(path), 'Unsafe producer history path');
  let part = root;
  for (const name of path.split('/')) { part = join(part, name); assert(!(await lstat(part)).isSymbolicLink(), 'Linked producer input'); }
  return readFile(part);
}
function identity(before, current, symbol) {
  for (const key of ['symbol', 'market', 'currency', 'exchange', 'company_name']) {
    assert(typeof before?.[key] === 'string' && before[key].length && current?.[key] === before[key], `${symbol}: unverified or changed ${key}`);
  }
  assert.equal(current.symbol, symbol); assert.equal(current.market, 'US');
  for (const key of ['cusip', 'isin', 'cik', 'issuer_cik', 'instrument_identity', 'financial_identity']) {
    if (before[key] != null && current[key] != null) assert.deepEqual(current[key], before[key], `${symbol}: changed ${key}`);
  }
}
export function observedHistory(chart, symbol, target) {
  assert.equal(chart?.symbol, symbol); assert(chart.market == null || chart.market === 'US');
  assert(Array.isArray(chart.bars) && chart.bars.length, `${symbol}: no observed history`);
  let previous = '';
  for (const bar of chart.bars) {
    assert(day(bar.date) && bar.date > previous && bar.date <= target, `${symbol}: invalid observed date`);
    assert(['open','high','low','close'].every(key => Number.isFinite(bar[key]) && bar[key] > 0) && Number.isFinite(bar.volume) && bar.volume >= 0, `${symbol}: invalid OHLCV`);
    assert(bar.high >= Math.max(bar.open,bar.close,bar.low) && bar.low <= Math.min(bar.open,bar.close), `${symbol}: invalid OHLC range`);
    previous = bar.date;
  }
  return previous;
}

export function retainObservedHistory({ symbol, target, observation, previousChart, candidateChart, candidateRow, provenance }) {
  assert(day(target) && day(observation) && observation < target, 'A retained history must be genuinely older than target');
  assert.equal(candidateChart.as_of_date,target,'Candidate chart analysis date differs');
  assert(day(previousChart.as_of_date) && previousChart.as_of_date>=observation && previousChart.as_of_date<=target,'Predecessor chart analysis date differs');
  if(candidateRow?.as_of_date!=null)assert.equal(candidateRow.as_of_date,target,'Candidate row analysis date differs');
  const previousDate = observedHistory(previousChart, symbol, target);
  const candidateDate = observedHistory(candidateChart, symbol, target);
  assert.equal(previousDate, observation); assert(candidateDate < previousDate, 'Only actual regressions may be restored');
  identity(previousChart.stock_data, candidateChart.stock_data, symbol);
  if (candidateRow) identity(candidateChart.stock_data, candidateRow, symbol);
  const snapshot = { schema_version:'producer-price-history-snapshot-v1', publication_authority:false,
    provenance, candidate_row:candidateRow ?? null, candidate_chart:candidateChart, previous_chart:previousChart };
  const snapshotBytes = Buffer.from(JSON.stringify(snapshot)), snapshotHash = hash(snapshotBytes);
  const snapshotPath = `producer-price-history/${snapshotHash}.json`;
  const record = { observation_date:observation, reason:'regressed_history' };
  // Reuse only the generic positive allowlist/unknown-state primitive. No finite
  // recovery plan, admission, October request or publication path is invoked.
  const row = currentUnknownRow(candidateRow || candidateChart.stock_data, record, snapshotHash, target, null);
  row.retained_price_history.snapshot_path = snapshotPath;
  assert.deepEqual(financial(row), financial(candidateRow || candidateChart.stock_data), 'Retention changed financial inputs');
  const chart = Object.fromEntries(['schema_version','symbol','market','as_of_date','generated_at','period'].filter(key => Object.hasOwn(previousChart,key)).map(key=>[key,copy(previousChart[key])]));
  Object.assign(chart,{ market:'US',as_of_date:target,bars:copy(previousChart.bars),stock_data:row,
    rs_line:[],blue_dots:[],eps_line:[],vcp_boxes:[],buy_points:[],signal:null,risk_plan:null,sell_plan:null,trend_template:null,
    retained_price_history:{status:'stale_reference_only',observation_date:observation,target_as_of_date:target,
      original_as_of_date:previousChart.as_of_date,original_generated_at:previousChart.generated_at ?? null,
      snapshot_path:snapshotPath,snapshot_sha256:snapshotHash} });
  return { symbol,row:candidateRow ? row : null,chart,snapshot,snapshotBytes,snapshotHash,snapshotPath,
    observation_date:observation,rejected_date:candidateDate,bars_sha256:hash(JSON.stringify(previousChart.bars)) };
}

export async function preserveProducerHistory({ root=resolve('public/static-data'), fetchImpl=fetch, live }={}) {
  root=resolve(root);
  const manifest=json(await local(root,'manifest.json')),entry=manifest.markets?.US;
  assert(entry && day(entry.as_of_date),'Normal retention requires a dated US source');
  const target=entry.as_of_date;
  live ||= await livePublication({fetcher:fetchImpl});
  assert(live.receipt?.transport && live.receipt.verification_universe.minimum_target === .9,'Authenticated predecessor with unchanged coverage required');
  assert(live.verificationUniverse.as_of_date <= target,'Source target predates publication');
  const sourceObservations=extractPriceObservations({dataRoot:root,manifest});
  const comparison=comparePriceObservations(sourceObservations,live.knownPriceDates);
  const scan=json(await local(root,entry.pages.scan.path));
  const chunks=[];
  for(const item of scan.chunks || [])chunks.push({path:item.path,value:json(await local(root,item.path))});
  const rows=mergeScanRows([scan,...chunks.map(c=>c.value)],target),bySymbol=new Map(rows.map(row=>[row.symbol,row]));
  assert(rows.length && bySymbol.size===rows.length);
  let existing=null;
  if(entry.assets.producer_price_history){
    const ref=entry.assets.producer_price_history,bytes=await local(root,ref.path);
    assert.equal(hash(bytes),ref.sha256);existing=json(bytes);
    assert.equal(existing.as_of_date,target);assert.equal(existing.schema_version,'producer-price-history-v1');
    assert.deepEqual(existing.universe_symbols,sorted(rows.map(row=>row.symbol)));
  }
  const chartIndex=json(await local(root,entry.assets.charts.path));
  const chartPaths=new Map(chartIndex.symbols.map(item=>[item.symbol,item.path]));
  assert.equal(chartPaths.size,chartIndex.symbols.length,'Duplicate candidate charts');
  // Freeze before currentUnknownRow clears liquidity; a missing feed cannot
  // remove a once-eligible name from the protected coverage denominator.
  const protectedSymbols=sorted([...live.verificationUniverse.required_symbols,...(existing?.protected_symbols || []),...rows.filter(isEligibleForPublication).map(row=>row.symbol)]);
  const reader=await createStaticTransport({baseURL:bootstrap.site_url,expectedRoot:live.receipt.transport.root,fetchImpl});
  const changes=[];
  try {
    const previousManifest=json(await reader.readBytes('static-data/manifest.json',{expectedDecodedSha256:live.manifestHash}));
    assert.deepEqual(previousManifest,live.manifest,'Predecessor manifest changed');
    const previousIndex=json(await reader.readBytes(`static-data/${previousManifest.markets.US.assets.charts.path}`));
    const previousPaths=new Map(previousIndex.symbols.map(item=>[item.symbol,item.path]));
    for(const regression of comparison.regressions){
      const [market,type,symbol]=JSON.parse(regression.key);
      assert(market==='US' && type==='chart','Non-stock price regression needs separate source repair');
      const key=regression.key,observation=live.priceObservations[key];
      assert(observation && observation===live.knownPriceDates[key],'Latest publication does not contain the known predecessor history');
      assert(previousPaths.has(symbol) && chartPaths.has(symbol),'Actual chart source absent');
      const previousBytes=Buffer.from(await reader.readBytes(`static-data/${previousPaths.get(symbol)}`));
      const candidateBytes=await local(root,chartPaths.get(symbol));
      const change=retainObservedHistory({symbol,target,observation,previousChart:json(previousBytes),candidateChart:json(candidateBytes),candidateRow:bySymbol.get(symbol),
        provenance:{publication_sha256:live.receiptHash,publication_run:live.receipt.run_id,transport_root:live.receipt.transport.root,
          manifest_sha256:live.manifestHash,previous_chart_path:previousPaths.get(symbol),previous_chart_sha256:hash(previousBytes),candidate_chart_path:chartPaths.get(symbol),candidate_chart_sha256:hash(candidateBytes)} });
      changes.push(change);
    }
  }finally{reader.dispose();}
  // Do not make any mutation until every proposed retention is authenticated.
  await mkdir(join(root,'producer-price-history'),{recursive:true});
  const aliases=[];
  for(const directory of ['markets/us/charts','verified-charts']){
    try{for(const name of await readdir(join(root,directory)))if(name.endsWith('.json'))aliases.push(`${directory}/${name}`);}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  for(const change of changes){
    const paths=new Set([chartPaths.get(change.symbol)]);
    if(change.snapshot.candidate_row?.research_detail_path)await local(root,change.snapshot.candidate_row.research_detail_path);
    for(const path of aliases){
      // Filename is only a bounded search hint. Identity is checked in bytes.
      const name=path.split('/').at(-1);
      if(name===`${encodeURIComponent(change.symbol)}.json` || name.startsWith(`${encodeURIComponent(change.symbol)}-`)){
        const payload=json(await local(root,path));
        if(payload.symbol===change.symbol){identity(payload.stock_data,change.chart.stock_data,change.symbol);paths.add(path);}
      }
    }
    change.aliases=[...paths];
  }
  for(const change of changes){
    await writeFile(join(root,change.snapshotPath),change.snapshotBytes);
    if(change.row)bySymbol.set(change.symbol,change.row);
    for(const path of change.aliases)await write(root,path,change.chart);
    if(change.snapshot.candidate_row?.research_detail_path)await write(root,change.snapshot.candidate_row.research_detail_path,change.row);
  }
  const rewrite=payload=>{
    for(const key of ['rows','initial_rows','preview_rows','results','stocks','members'])if(Array.isArray(payload[key]))payload[key]=payload[key].map(row=>bySymbol.get(row.symbol)||row);
  };
  rewrite(scan);await write(root,entry.pages.scan.path,scan);
  for(const chunk of chunks){rewrite(chunk.value);await write(root,chunk.path,chunk.value);}
  const after=comparePriceObservations(extractPriceObservations({dataRoot:root,manifest}),live.knownPriceDates);
  assert.equal(after.regressions.length,0,'Producer retention did not resolve all actual regressions');
  const report={schema_version:'producer-price-history-v1',publication_authority:false,as_of_date:target,
    predecessor:{receipt_sha256:live.receiptHash,run_id:live.receipt.run_id,manifest_sha256:live.manifestHash,transport_root:live.receipt.transport.root},
    universe_symbols:sorted(rows.map(row=>row.symbol)),protected_symbols:protectedSymbols,
    retained:[...(existing?.retained || []).filter(item=>!changes.some(change=>change.symbol===item.symbol)),...changes.map(({symbol,snapshotPath,snapshotHash,observation_date,rejected_date,bars_sha256,aliases})=>({symbol,snapshot_path:snapshotPath,snapshot_sha256:snapshotHash,observation_date,rejected_date,bars_sha256,aliases}))],
    original_regressions:comparison.regressions,ledger_only_absences:after.missing};
  const content=JSON.stringify(report),digest=hash(content),path=`producer-price-history/report-${digest}.json`;
  await writeFile(join(root,path),content);
  entry.assets.producer_price_history={path,sha256:digest,as_of_date:target,schema_version:report.schema_version};
  await write(root,'manifest.json',manifest);
  return {retained:changes.length,symbols:changes.map(c=>c.symbol),as_of_date:target,report:path};
}

export {producerHistoryCoverage} from './producer-history-coverage.mjs';

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await preserveProducerHistory()));
