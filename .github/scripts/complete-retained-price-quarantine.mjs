// Pure, unpublished preparation. Every residual is bound to an explicit review;
// no price, identity mapping, observation date or publication authority is added.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RECOVERY_SCHEMA,currentUnknownRow,recoveryDigest} from './retained-price-recovery.mjs';
import {priceObservationDigest} from './price-observations.mjs';
import {assessRetainedUniverse} from './retained-universe.mjs';
import {auditDailyBars} from '../../frontend/src/static/qualificationAudit.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const key=symbol=>JSON.stringify(['US','chart',symbol]);
const sha=value=>createHash('sha256').update(value).digest('hex');
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;

export function validateResidualChart(chart,row,date,target){
  assert(chart&&chart.symbol===row.symbol&&(chart.market==null||chart.market==='US'),'Residual chart identity mismatch');
  assert.equal(chart.as_of_date,target,'Residual chart analysis date mismatch');
  for(const field of ['symbol','market','currency','exchange','company_name'])assert.deepEqual(chart.stock_data?.[field],row[field],`Residual stock identity mismatch: ${field}`);
  assert.equal(chart.stock_data.as_of_date,target,'Residual embedded analysis date mismatch');
  assert(Array.isArray(chart.bars)&&chart.bars.length,'Missing residual actual bars');
  let previous=null,observed=null;
  for(const bar of chart.bars){assert(day(bar.date)&&bar.date<=target&&(!previous||bar.date>previous),'Invalid residual bar dates');previous=bar.date;if(finite(bar.close)&&bar.close>0)observed=bar.date;}
  assert(day(date)&&date<target,'Residual observation must be genuinely stale');
  assert.equal(observed,date,'Residual source observation differs from actual bars');
  return chart;
}

export function completeCurrentPriceQuarantine({prepared,plan,candidateRows,candidateSource,candidateChartIndex,candidateCharts,review}){
  assert.equal(prepared.schema_version,RECOVERY_SCHEMA);assert.equal(prepared.publication_authority,false);
  assert.equal(prepared.requires_full_rebuild,true);assert.equal(prepared.requires_financial_carry,true);
  assert(!prepared.residual_current_review,'Residual quarantine was already applied');
  const {plan_sha256,...body}=plan;assert.equal(recoveryDigest(body),plan_sha256,'Base plan binding mismatch');
  assert.equal(prepared.plan_sha256,plan_sha256,'Prepared input differs from base plan');
  assert.equal(recoveryDigest(candidateRows),plan.candidate_rows_sha256,'Original candidate rows differ from base plan');
  assert.equal(sha(candidateSource.manifest_json),plan.source_manifest_sha256,'Residual manifest differs from base plan');
  assert.equal(priceObservationDigest(candidateSource.price_observations),plan.source_observations_sha256,'Residual observations differ from base plan');
  const target=prepared.target_as_of_date;assert.equal(target,plan.target_as_of_date);
  assert.equal(review?.schema_version,'retained-price-residual-review-v1');assert.equal(review.publication_authority,false);
  assert.equal(review.scope,'unpublished_local_preparation_only');assert.equal(review.base_prepared_sha256,recoveryDigest(prepared),'Reviewed preparation changed');
  assert.equal(review.source_observations_sha256,plan.source_observations_sha256);
  assert.equal(review.candidate_chart_index_sha256,recoveryDigest(candidateChartIndex),'Reviewed chart index changed');
  const index=new Map();for(const item of candidateChartIndex.symbols){assert(!index.has(item.symbol),'Duplicate candidate chart symbol');index.set(item.symbol,item.path);}
  const originals=new Map(candidateRows.map(row=>[row.symbol,row]));assert.equal(originals.size,candidateRows.length);
  assert.equal(prepared.rows.length,candidateRows.length);assert.deepEqual(prepared.rows.map(row=>row.symbol),candidateRows.map(row=>row.symbol),'Prepared universe changed');
  const residual=prepared.rows.filter(row=>finite(row.current_price)&&candidateSource.price_observations[key(row.symbol)]!==target);
  assert.deepEqual(review.symbols.map(item=>item.symbol).sort(),residual.map(row=>row.symbol).sort(),'Review must cover the exact residual current-price set');
  const reviewed=new Map(review.symbols.map(item=>[item.symbol,item]));
  assert.deepEqual(Object.keys(candidateCharts).sort(),residual.filter(row=>candidateSource.price_observations[key(row.symbol)]!=null).map(row=>row.symbol).sort(),'Residual chart input scope differs');
  const result=clone(prepared),rows=new Map(result.rows.map(row=>[row.symbol,row])),records=[];
  for(const candidate of residual){
    const symbol=candidate.symbol,original=originals.get(symbol),binding=reviewed.get(symbol),date=candidateSource.price_observations[key(symbol)]??null;
    assert.equal(recoveryDigest(candidate),recoveryDigest(original),'Residual row was already transformed');
    assert.equal(recoveryDigest(original),binding.candidate_row_sha256,'Residual candidate binding mismatch');
    assert.equal(binding.observation_date,date,'Reviewed observation differs from source');
    assert.equal(original.technical_audit?.valid,false,'Cannot quarantine a valid current technical audit');
    assert(!result.patches.some(p=>p.symbol===symbol)&&!result.row_quarantines.some(p=>p.symbol===symbol),'Residual overlaps an existing correction');
    const chart=candidateCharts[symbol]??null;
    if(date===null){
      assert(!index.has(symbol)&&original.chart_path==null&&chart===null,'Undated residual has an unreviewed chart');
      assert.equal(binding.candidate_chart_sha256,null);assert.equal(original.technical_audit.bars,0,'Undated residual has observed bars');
    }else{
      assert.equal(original.chart_path,index.get(symbol),'Residual row/index chart mismatch');
      validateResidualChart(chart,original,date,target);
      assert.equal(recoveryDigest(chart),binding.candidate_chart_sha256,'Residual chart binding mismatch');
    }
    const reason=date===null?'undated_price_without_chart':'stale_candidate_history';
    const snapshot={schema_version:'retained-price-residual-snapshot-v1',publication_authority:false,
      base_plan_sha256:plan_sha256,review_sha256:recoveryDigest(review),source_observations_sha256:plan.source_observations_sha256,
      actual_observation_date:date,candidate_row:clone(original),original_candidate_chart:clone(chart)};
    const snapshotHash=recoveryDigest(snapshot),snapshot_path=`retained-price-history/${snapshotHash}.json`,chart_path=chart?`retained-price-charts/${snapshotHash}.json`:null;
    const row=currentUnknownRow(original,{observation_date:date,reason},snapshotHash,target,chart_path);
    const common={symbol,history_origin:'candidate_current_quarantine',row,snapshot_path,snapshot,reason,
      candidate_row_sha256:recoveryDigest(original),observation_date:date};
    if(chart){
      const repaired=Object.fromEntries(['schema_version','symbol','market','as_of_date','generated_at','period'].filter(field=>Object.hasOwn(chart,field)).map(field=>[field,clone(chart[field])]));
      Object.assign(repaired,{market:'US',bars:clone(chart.bars),stock_data:null,rs_line:[],blue_dots:[],eps_line:[],vcp_boxes:[],buy_points:[],signal:null,risk_plan:null,
        retained_price_history:{status:'stale_reference_only',observation_date:date,original_as_of_date:chart.as_of_date,original_generated_at:chart.generated_at??null,target_as_of_date:target,snapshot_path,snapshot_sha256:snapshotHash}});
      row.technical_audit=auditDailyBars(row,repaired,target);repaired.stock_data=clone(row);
      result.patches.push({...common,chart_path,chart:repaired,detail:clone(row),bars_sha256:recoveryDigest(chart.bars),historical_chart_sha256:recoveryDigest(chart)});
    }else{
      row.price_quarantine.snapshot_path=snapshot_path;row.technical_audit=auditDailyBars(row,null,target);
      result.row_quarantines.push(common);
    }
    assert.equal(row.technical_audit.valid,false);rows.set(symbol,row);
    records.push({...binding,required:plan.required_symbols.includes(symbol),reason,snapshot_sha256:snapshotHash});
  }
  result.rows=candidateRows.map(row=>rows.get(row.symbol));
  const coverage=assessRetainedUniverse({previousSymbols:plan.required_symbols,rows:result.rows,asOfDate:target});
  assert.deepEqual(coverage.requiredSymbols,plan.required_symbols,'Residual quarantine changed protected denominator');
  assert.equal(coverage.verified,prepared.coverage.verified,'Residual quarantine changed verified coverage');assert(coverage.passed);
  assert.equal(result.rows.filter(row=>finite(row.current_price)&&candidateSource.price_observations[key(row.symbol)]!==target).length,0,'Residual current prices survived quarantine');
  result.residual_current_review={schema_version:'retained-price-residual-application-v1',publication_authority:false,ready_to_publish:false,
    review_sha256:recoveryDigest(review),base_prepared_sha256:recoveryDigest(prepared),source_observations_sha256:plan.source_observations_sha256,
    residual_before:residual.length,residual_after:0,stale_histories:records.filter(row=>row.observation_date!==null).length,
    undated_rows:records.filter(row=>row.observation_date===null).length,records};
  return result;
}
