// Offline recovery only. These outputs are inputs to a new, independently
// verified build; they are never the bytes of the original successful export.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {comparePriceObservations, priceObservationDigest} from './price-observations.mjs';
import {assessRetainedUniverse} from './retained-universe.mjs';
import {auditDailyBars} from '../../frontend/src/static/qualificationAudit.js';
import financialContract from '../../contracts/static_financial_current_v1.json' with {type:'json'};
import {validateRetainedHomeHistory} from './retained-home-history.mjs';

export const RECOVERY_SCHEMA = 'retained-price-recovery-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const recoveryDigest = value => hash(canonical(value));
const copy = value => JSON.parse(JSON.stringify(value));
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const safePath = value => typeof value === 'string' && /^[A-Za-z0-9._%/-]+$/.test(value)
  && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..')
  && !/%(?:2f|5c|25|00)/i.test(value);
const indexRows = (rows, date, label) => {
  assert(Array.isArray(rows) && rows.length, `${label}: empty rows`);
  const index = new Map();
  for (const row of rows) {
    assert(row && typeof row.symbol === 'string' && row.symbol && !index.has(row.symbol), `${label}: duplicate/invalid symbol`);
    assert.equal(row.market, 'US', `${label}: market mismatch`);
    assert.equal(row.as_of_date, date, `${label}: row date mismatch`);
    index.set(row.symbol, row);
  }
  return index;
};
const identityFields = ['symbol','market','currency','exchange','company_name','name','product_name','quoteType','quote_type',
  'cusip','isin','cik','issuer_cik','instrument_identity','instrument_applicability','financial_identity','gics_sector','ibd_industry_group'];
export const RECOVERY_FINANCIAL_FIELDS = Object.freeze([...new Set([...financialContract.field_order,...Object.keys(financialContract.aliases),
  'recent_quarter_date','previous_quarter_date','growth_comparable_period_date','growth_reporting_cadence','growth_metric_basis','growth_reference_gap_days',
  'financial_generation','financial_evaluated_at','financial_knowledge_basis','financial_point_in_time','financial_source_publication_date','financial_policy_version',
  'financial_source_evidence','financial_current','financial_history','book_financials','bookFinancialCurrent','financial_source_diagnostics',
  'financial_history_source_diagnostics','financial_current_state','financial_historical'])]);
export const RECOVERY_PRESERVED_FIELDS=Object.freeze([...new Set([...identityFields,...RECOVERY_FINANCIAL_FIELDS,'corporate_action','institutional_evidence'])]);
const preservedFields=RECOVERY_PRESERVED_FIELDS;
function assertIdentity(previous, current, symbol) {
  assert(previous && current, `Retained research row missing: ${symbol}`);
  for (const key of ['symbol','market','currency','exchange','company_name']) {
    assert(previous[key] != null && current[key] != null, `Unverified ${key} identity: ${symbol}`);
    assert.deepEqual(current[key], previous[key], `Changed ${key} identity: ${symbol}`);
  }
  for (const key of ['cusip','isin','cik','issuer_cik','instrument_identity','financial_identity']) {
    if (previous[key] != null && current[key] != null) assert.deepEqual(current[key], previous[key], `Changed ${key} identity: ${symbol}`);
  }
}
function chartPaths(index) {
  assert(index && Array.isArray(index.symbols), 'Missing prior chart index');
  const paths = new Map(), used = new Set();
  for (const row of index.symbols) {
    assert(typeof row.symbol === 'string' && row.symbol && !paths.has(row.symbol) && safePath(row.path) && !used.has(row.path), 'Invalid/duplicate chart identity or path');
    paths.set(row.symbol, row.path); used.add(row.path);
  }
  return paths;
}

/** Metadata plan only. Callers must obtain every input from independently
 * hash-bound archive reads. No map entry here fabricates an observed bar. */
export function planRetainedPriceRecovery({priorPublication, priorRows, candidateRows, candidateSource, priorChartIndex, candidateChartIndex, rowQuarantines=[],homeHistory=null}) {
  assert.equal(priorPublication?.schema, 1, 'Unsupported predecessor receipt');
  assert.equal(priorPublication.verification_universe?.minimum_target, .9, 'Changed predecessor coverage policy');
  const previousDate = priorPublication.verification_universe.as_of_date;
  const manifest = JSON.parse(candidateSource.manifest_json);
  assert.equal(hash(candidateSource.manifest_json), candidateSource.manifest_sha256, 'Candidate manifest binding mismatch');
  assert.equal(priceObservationDigest(candidateSource.price_observations), candidateSource.price_observations_sha256, 'Candidate observation binding mismatch');
  const target = manifest.markets?.US?.as_of_date;
  assert(day(previousDate) && day(target) && target > previousDate, 'Recovery must advance the dated snapshot');
  for(const [key,date] of Object.entries(candidateSource.price_observations)){
    const [market,type]=JSON.parse(key);
    if(market==='US'&&type==='chart')assert(date<=target,'Stock observation exceeds target session');
  }
  const previous = indexRows(priorRows, previousDate, 'prior'), current = indexRows(candidateRows, target, 'candidate');
  assert([...previous.keys()].every(symbol => current.has(symbol)), 'Candidate dropped a prior public row');
  const paths = chartPaths(priorChartIndex);
  const original = comparePriceObservations(candidateSource.price_observations, priorPublication.known_price_dates);
  comparePriceObservations(priorPublication.price_observations, priorPublication.known_price_dates); // validate both maps
  const retained = [], projected = {...candidateSource.price_observations};
  if(homeHistory){
    validateRetainedHomeHistory(homeHistory);
    assert.equal(homeHistory.prior_publication_sha256,recoveryDigest(priorPublication),'Home predecessor differs from plan');
    assert.equal(homeHistory.source_manifest_sha256,candidateSource.manifest_sha256,'Home source manifest differs from plan');
    assert.equal(homeHistory.source_observations_sha256,candidateSource.price_observations_sha256,'Home observations differ from plan');
  }
  let homeConsumed=false;
  for (const [key, observed] of Object.entries(priorPublication.price_observations).sort()) {
    if (projected[key] && projected[key] >= observed) continue;
    const [market, type, symbol] = JSON.parse(key);
    assert.equal(market, 'US', 'Recovery is US scoped');
    if(type==='home'){
      assert(homeHistory&&homeHistory.key===key,'A home-series change requires separate review');
      assert.equal(homeHistory.observation_date,observed,'Retained home observation differs');
      projected[key]=observed;homeConsumed=true;continue;
    }
    assert.equal(type, 'chart', 'Unsupported retained series');
    assert(observed < target, `Cannot retain a target/future close as stale: ${symbol}`);
    assert(paths.has(symbol), `Actual prior series has no chart payload: ${symbol}`);
    const previousRow = previous.get(symbol), currentRow = current.get(symbol);
    assert(Boolean(previousRow) === Boolean(currentRow), `Research membership changed: ${symbol}`);
    if (previousRow) {
      assertIdentity(previousRow, currentRow, symbol);
      assert.equal(previousRow.chart_path, paths.get(symbol), `Prior row/index chart disagreement: ${symbol}`);
      assert(safePath(previousRow.research_detail_path), `Missing prior canonical detail: ${symbol}`);
    }
    retained.push({key,symbol,observation_date:observed,reason:projected[key] ? 'regressed_history' : 'missing_history',
      rejected_date:projected[key] ?? null,prior_chart_path:paths.get(symbol),
      prior_detail_path:previousRow?.research_detail_path ?? null,
      prior_row_sha256:previousRow ? recoveryDigest(previousRow) : null,
      candidate_row_sha256:currentRow ? recoveryDigest(currentRow) : null});
    projected[key] = observed;
  }
  assert.equal(Boolean(homeHistory),homeConsumed,'Unused retained home history review');
  assert(retained.length, 'No recoverable missing/regressed histories');
  const after = comparePriceObservations(projected, priorPublication.known_price_dates);
  assert(!after.regressions.length, 'Prior actual bytes cannot repair all known regressions');
  assert(after.advances, 'No actual advancing price series after retention');
  const coverage = assessRetainedUniverse({previousSymbols:priorPublication.verification_universe.required_symbols,rows:candidateRows,asOfDate:target});
  assert(coverage.passed, 'Original candidate fails the unchanged retained-universe gate');
  // This is a finite reviewed exception, not a provider identity fallback or a
  // repair inferred from a stale scalar. Neither the row date nor its value
  // establishes an observed close. Bind both entire source rows and the exact
  // reviewed price/audit evidence before clearing their current presentation.
  assert(Array.isArray(rowQuarantines) && rowQuarantines.length<=1, 'Only the reviewed EQR row quarantine is supported');
  const row_quarantines=[];
  for(const adjustment of rowQuarantines){
    assert.equal(adjustment.symbol,'EQR','Unreviewed row quarantine symbol');
    assert.equal(adjustment.reason,'undated_price_without_chart','Unreviewed row quarantine reason');
    assert.equal(adjustment.observation_date,null,'Quarantine cannot invent an observation date');
    assert(coverage.requiredSymbols.includes(adjustment.symbol),'Quarantined row must remain in the protected union');
    assert(!retained.some(record=>record.symbol===adjustment.symbol),'A row quarantine cannot replace a historical patch');
    const oldRow=previous.get(adjustment.symbol),newRow=current.get(adjustment.symbol);
    assertIdentity(oldRow,newRow,adjustment.symbol);
    assert.equal(recoveryDigest(oldRow),adjustment.prior_row_sha256,'Quarantine prior row differs from review');
    assert.equal(recoveryDigest(newRow),adjustment.candidate_row_sha256,'Quarantine candidate row differs from review');
    for(const [name,row] of [['prior',oldRow],['candidate',newRow]]){
      const binding=adjustment.source_rows?.[name];
      assert(binding && typeof binding==='object','Missing reviewed quarantine source binding');
      const fields=['as_of_date','current_price','adv_usd','chart_path','technical_audit'];
      assert.deepEqual(binding,Object.fromEntries(fields.map(field=>[field,row[field]])),`Quarantine ${name} source evidence differs from review`);
      assert.equal(row.chart_path,null,'Quarantine requires absent chart path');
      assert(finite(row.current_price) && row.current_price>0 && finite(row.adv_usd),'Quarantine requires the reviewed scalar evidence');
      assert.equal(row.technical_audit?.valid,false,'Quarantine cannot discard a valid technical audit');
      assert.equal(row.technical_audit?.bars,0,'Quarantine cannot discard observed bars');
      assert.deepEqual(row.technical_audit?.values,{},'Quarantine cannot discard audited values');
    }
    assert.equal(oldRow.current_price,newRow.current_price,'Quarantine scalar price changed between source rows');
    assert.equal(oldRow.adv_usd,newRow.adv_usd,'Quarantine scalar liquidity changed between source rows');
    assert(!paths.has(adjustment.symbol) && !chartPaths(candidateChartIndex).has(adjustment.symbol),'Quarantine requires absent prior and candidate chart entries');
    const key=JSON.stringify(['US','chart',adjustment.symbol]);
    for(const observations of [priorPublication.price_observations,priorPublication.known_price_dates,candidateSource.price_observations]){
      assert(!Object.hasOwn(observations,key),'Quarantine cannot discard an actual or known observation');
    }
    row_quarantines.push(copy(adjustment));
  }
  const body = {schema_version:RECOVERY_SCHEMA,publication_authority:false,scope:'offline_prepare_only',target_as_of_date:target,
    prior_publication_sha256:recoveryDigest(priorPublication),prior_rows_sha256:recoveryDigest(priorRows),candidate_rows_sha256:recoveryDigest(candidateRows),
    source_manifest_sha256:candidateSource.manifest_sha256,source_observations_sha256:candidateSource.price_observations_sha256,
    prior_known_dates_sha256:priceObservationDigest(priorPublication.known_price_dates),prior_actual_dates_sha256:priceObservationDigest(priorPublication.price_observations),
    previous_required_symbols:[...priorPublication.verification_universe.required_symbols],required_symbols:coverage.requiredSymbols,
    original_coverage:{total:coverage.total,verified:coverage.verified,minimum_target:.9},
    original_regressions:original.regressions,original_missing:original.missing,retained,row_quarantines,
    ...(homeHistory?{home_history:copy(homeHistory)}:{}),
    ledger_only_absences:after.missing,projected_observations:projected,
    projected_observations_sha256:priceObservationDigest(projected),
    required_next_checks:['exact archive/scoped input verification','all affected bytes and identity','full canonical compiler',
      'cross-view and retained-universe gates','current financial source carry and expiry','same approved UI bytes',
      'full packed/financial audit validation','Pages payload limits','exact new artifact provenance','publication nonregression and live predecessor']};
  return {...body,plan_sha256:recoveryDigest(body)};
}

function validatePlan(plan, priorPublication, priorRows, candidateRows) {
  const {plan_sha256,...body} = plan;
  assert.equal(plan.schema_version, RECOVERY_SCHEMA); assert.equal(plan.publication_authority, false);
  assert.equal(recoveryDigest(body), plan_sha256, 'Recovery plan changed');
  assert.equal(recoveryDigest(priorPublication),plan.prior_publication_sha256,'Predecessor receipt changed');
  assert.equal(recoveryDigest(priorRows),plan.prior_rows_sha256,'Prior rows changed');
  assert.equal(recoveryDigest(candidateRows),plan.candidate_rows_sha256,'Candidate rows changed');
  if(plan.home_history){
    validateRetainedHomeHistory(plan.home_history,{priorPublication,targetAsOfDate:plan.target_as_of_date});
    assert.equal(plan.home_history.source_manifest_sha256,plan.source_manifest_sha256,'Plan home source manifest differs');
    assert.equal(plan.home_history.source_observations_sha256,plan.source_observations_sha256,'Plan home source observations differ');
    assert.equal(plan.projected_observations[plan.home_history.key],plan.home_history.observation_date,'Plan home observation differs');
  }
}
function observedDate(chart) {
  assert(Array.isArray(chart.bars) && chart.bars.length, 'Retained chart has no observations');
  let last = null, previous = null;
  for (const bar of chart.bars) {
    assert(day(bar.date) && (!previous || bar.date > previous), 'Retained history has invalid/unordered dates');
    previous = bar.date;
    if (finite(bar.close) && bar.close > 0) last = bar.date;
  }
  return last;
}
export function currentUnknownRow(row, record, snapshotHash, target, chartPath) {
  // A positive allowlist prevents a new scanner field from leaking through.
  // Financial inputs pass through unchanged, including absent/null distinctions
  // and their actual clocks. Only the existing financial carry may replace them.
  // Original financial and technical values also remain together in the snapshot.
  const result = Object.fromEntries(preservedFields.filter(key => Object.hasOwn(row,key)).map(key => [key,copy(row[key])]));
  Object.assign(result,{as_of_date:target,current_price:null,price_change_1d:null,adv_usd:null,volume:null,
    rs_rating:null,source_rs_rating:null,rs_method:null,rs_as_of_date:null,rs_universe_size:null,
    passes_template:null,se_pivot_price:null,vcp_pivot:null,se_setup_ready:false,vcp_detected:false,vcp_ready_for_breakout:false,
    chart_path:chartPath,
    setup_recalculation:{status:'unavailable',as_of_date:target,reason:record.observation_date===null
      ? `No dated price observation or chart; ${target} close unverified`
      : `Retained history ends ${record.observation_date}; ${target} close unverified`},
    [record.observation_date===null?'price_quarantine':'retained_price_history']:{status:record.observation_date===null?'unverified_observation':'stale_reference_only',observation_date:record.observation_date,target_as_of_date:target,
      reason:record.reason,snapshot_sha256:snapshotHash,financial_carry_required:true,
      financial_input_sha256:recoveryDigest(Object.fromEntries(RECOVERY_FINANCIAL_FIELDS.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]])))}});
  return result;
}

/** Compile a closed set of atomic repair patches in memory. Original immutable
 * row/chart/detail state stays in a content-addressed audit snapshot. Current
 * consumers receive unknown price/technical state, never the old close as new.
 * This does not write a site or establish publisher authority. */
export function compileRetainedPriceRecovery({plan,priorPublication,priorRows,candidateRows,priorCharts,priorDetails}) {
  validatePlan(plan,priorPublication,priorRows,candidateRows);
  const prior = new Map(priorRows.map(row => [row.symbol,row])), target = new Map(candidateRows.map(row => [row.symbol,row]));
  const patches = [];
  for (const record of plan.retained) {
    const oldChart = priorCharts[record.symbol], oldRow = prior.get(record.symbol), newRow = target.get(record.symbol);
    assert(oldChart && oldChart.symbol === record.symbol, `Retained chart identity mismatch: ${record.symbol}`);
    assert(oldChart.market==null||oldChart.market==='US',`Retained chart market mismatch: ${record.symbol}`);
    assert.equal(oldChart.stock_data?.symbol,record.symbol,'Retained embedded stock symbol mismatch');
    assert.equal(oldChart.stock_data?.market,'US','Retained embedded stock market mismatch');
    assert.equal(oldChart.as_of_date,priorPublication.verification_universe.as_of_date,'Retained chart snapshot date mismatch');
    if(oldChart.stock_data.as_of_date!=null)assert.equal(oldChart.stock_data.as_of_date,oldChart.as_of_date,'Retained embedded stock date mismatch');
    assert.equal(observedDate(oldChart),record.observation_date,`Retained actual observation mismatch: ${record.symbol}`);
    assert(day(oldChart.as_of_date) && oldChart.as_of_date <= plan.target_as_of_date, 'Invalid original chart target');
    assert(oldChart.bars.every(bar => bar.date <= plan.target_as_of_date), 'Retained chart contains a future bar');
    const oldDetail = oldRow ? priorDetails[record.symbol] : null;
    if (oldRow) {
      assert.equal(recoveryDigest(oldRow),record.prior_row_sha256,'Prior row changed');
      assert.equal(recoveryDigest(newRow),record.candidate_row_sha256,'Candidate row changed');
      assert(oldDetail && oldDetail.symbol === record.symbol && oldDetail.as_of_date === oldRow.as_of_date, `Prior detail identity mismatch: ${record.symbol}`);
      assertIdentity(oldRow,oldChart.stock_data,record.symbol);
      assertIdentity(oldRow,oldDetail,record.symbol);
      assert.equal(oldChart.stock_data.as_of_date,oldRow.as_of_date,'Prior row/chart stock date mismatch');
      for (const key of ['current_price','se_pivot_price','vcp_pivot','se_setup_ready','rs_rating','passes_template']) {
        assert.deepEqual(oldDetail[key] ?? null,oldRow[key] ?? null,`Prior row/detail ${key} disagrees: ${record.symbol}`);
        assert.deepEqual(oldChart.stock_data?.[key] ?? null,oldRow[key] ?? null,`Prior row/chart ${key} disagrees: ${record.symbol}`);
      }
    }
    const snapshot = {schema_version:'retained-price-snapshot-v1',publication_authority:false,
      previous_publication_sha256:plan.prior_publication_sha256,actual_observation_date:record.observation_date,
      prior_row:oldRow ? copy(oldRow) : null,prior_chart:copy(oldChart),prior_detail:oldDetail ? copy(oldDetail) : null,
      rejected_candidate_row:newRow ? copy(newRow) : null};
    const snapshotHash = recoveryDigest(snapshot), snapshotPath=`retained-price-history/${snapshotHash}.json`;
    // The envelope is the new analysis target, as in the existing exporter.
    // Observation dates and original capture clocks are literal. Current-chart
    // consumers still refuse the old final bar; finance may bind independently
    // to this target without admitting a current price or technical decision.
    const chart = Object.fromEntries(['schema_version','symbol','market','as_of_date','generated_at','period'].filter(key => Object.hasOwn(oldChart,key)).map(key=>[key,copy(oldChart[key])]));
    Object.assign(chart,{market:'US',as_of_date:plan.target_as_of_date,bars:copy(oldChart.bars),stock_data:null,rs_line:[],blue_dots:[],eps_line:[],vcp_boxes:[],buy_points:[],signal:null,risk_plan:null,
      retained_price_history:{status:'stale_reference_only',observation_date:record.observation_date,original_as_of_date:oldChart.as_of_date,
        original_generated_at:oldChart.generated_at ?? null,target_as_of_date:plan.target_as_of_date,snapshot_path:snapshotPath,snapshot_sha256:snapshotHash}});
    // Use a temporary binding path until the final exporter content-addresses
    // the chart together with the final carried financial projection.
    const path=`retained-price-charts/${snapshotHash}.json`;
    const row=oldRow ? currentUnknownRow(newRow,record,snapshotHash,plan.target_as_of_date,path) : null;
    if(row){row.technical_audit=auditDailyBars(row,chart,plan.target_as_of_date);chart.stock_data=copy(row);target.set(record.symbol,row);}
    patches.push({symbol:record.symbol,chart_path:path,chart,row,detail:row ? copy(row) : null,snapshot_path:snapshotPath,snapshot,
      discarded_candidate_fields:newRow ? Object.keys(newRow).filter(key=>!preservedFields.includes(key)).sort() : [],
      bars_sha256:recoveryDigest(oldChart.bars),historical_chart_sha256:recoveryDigest(oldChart)});
  }
  const row_quarantines=[];
  for(const record of plan.row_quarantines ?? []){
    const oldRow=prior.get(record.symbol),newRow=target.get(record.symbol);
    assert.equal(recoveryDigest(oldRow),record.prior_row_sha256,'Quarantine prior row changed');
    assert.equal(recoveryDigest(newRow),record.candidate_row_sha256,'Quarantine candidate row changed');
    const snapshot={schema_version:'retained-price-row-quarantine-snapshot-v1',publication_authority:false,
      prior_row:copy(oldRow),candidate_row:copy(newRow)};
    const snapshotHash=recoveryDigest(snapshot),snapshot_path=`retained-price-history/${snapshotHash}.json`;
    const row=currentUnknownRow(newRow,record,snapshotHash,plan.target_as_of_date,null);
    row.price_quarantine.snapshot_path=snapshot_path;
    row.technical_audit=auditDailyBars(row,null,plan.target_as_of_date);
    target.set(record.symbol,row);
    row_quarantines.push({symbol:record.symbol,row,snapshot_path,snapshot,reason:record.reason,
      candidate_row_sha256:record.candidate_row_sha256,prior_row_sha256:record.prior_row_sha256,observation_date:null});
  }
  const rows=candidateRows.map(row=>target.get(row.symbol));
  // Preserve the complete reviewed previous/current union even when clearing a
  // newly eligible undated scalar. A quarantine never grants a liquidity exit.
  const coverage=assessRetainedUniverse({previousSymbols:plan.required_symbols,rows,asOfDate:plan.target_as_of_date});
  assert.deepEqual(coverage.requiredSymbols,plan.required_symbols,'Recovery changed the protected denominator');
  assert.equal(coverage.verified,plan.original_coverage.verified,'Recovery changed verified coverage');
  assert(coverage.passed,'Recovery fails the unchanged 90% gate');
  return {schema_version:RECOVERY_SCHEMA,publication_authority:false,scope:'unpublished_compiler_inputs_only',plan_sha256:plan.plan_sha256,
    target_as_of_date:plan.target_as_of_date,rows,patches,row_quarantines,ledger_only_absences:[...plan.ledger_only_absences],
    ...(plan.home_history?{home_history:copy(plan.home_history)}:{}),
    coverage:{total:coverage.total,verified:coverage.verified,minimum_target:.9},
    requires_full_rebuild:true,requires_financial_carry:true,requires_new_artifact_provenance:true};
}
