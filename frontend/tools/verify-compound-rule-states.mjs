// Offline comparison of the same immutable source data under two rule policies.
// Never fetches providers, alters input/projection bytes, or publishes artifacts.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { overlayFinancialCorrection, overlayFinancialChart, validateCorrectionProjection } from './financial-correction-overlay.mjs';
import { assess, rankCandidates, researchCsv, RULE_SUMMARY_VERSION } from '../src/static/researchEngine.js';
import { currentFinancialHistory, projectFinancialRow, mergeFinancialDetail } from '../src/static/financialCurrent.js';
import { encodeResearchIndex, decodeResearchIndex } from '../src/static/researchTransport.js';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from '../src/static/financialEvidencePresentation.js';
import { filterStaticScanRows } from '../src/static/scanClient.js';
import { filterRanked } from '../src/static/researchPresentation.js';
import { workbenchRuleFingerprint } from './workbench-comparison.mjs';
const [baselineFrontend, targetPath, projectionPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw Error('Usage: baseline-frontend target-base projection output-report');
const baseline = await import(pathToFileURL(resolve(baselineFrontend,'src/static/researchEngine.js')));
const baselinePolicy = await import(pathToFileURL(resolve(baselineFrontend,'tools/workbench-comparison.mjs')));
const [targetBytes, projectionBytes] = await Promise.all([targetPath,projectionPath].map(path=>readFile(path)));
const target=JSON.parse(targetBytes), projection=JSON.parse(projectionBytes);
validateCorrectionProjection(projection, {targetBaseSha256:createHash('sha256').update(targetBytes).digest('hex')});
if (target.rows.length !== 5901 || new Set(target.rows.map(row=>row.symbol)).size !== 5901) throw Error('Unexpected target row count or duplicate symbols');
const now=Date.parse(projection.financial_evaluated_at), date=target.as_of_date;
const rows=target.rows.map(row=>projectFinancialRow(overlayFinancialCorrection(row,projection),{now}));
const cohort=new Set(Object.keys(projection.symbols));
const methods=['minervini','minervini2','oneil','ibd'];
const equal=(a,b,message)=>{if(!isDeepStrictEqual(a,b))throw Error(message);};
const beforePolicy=await baselinePolicy.workbenchRuleFingerprint(), afterPolicy=await workbenchRuleFingerprint();
if(beforePolicy===afterPolicy || baseline.RULE_SUMMARY_VERSION===RULE_SUMMARY_VERSION) throw Error('Policy and summary must both be invalidated');
const summary=(items,engine,method)=>{
 const results=items.map(row=>engine(row,method,now));
 const distribution=results[0].rules.map((rule,index)=>({label:rule.label,...Object.fromEntries(['pass','fail','unknown','not_applicable'].map(state=>[state,results.filter(result=>result.rules[index].state===state).length]))}));
 return {rows:items.length,qualified:results.filter(result=>result.qualified).length,passed:results.reduce((n,result)=>n+result.passed,0),failed:results.reduce((n,result)=>n+result.failed,0),unknown:results.reduce((n,result)=>n+result.unknown,0),zero_failed_only_unknown:results.filter(result=>!result.failed&&result.unknown>0).length,distribution};
};
const cohorts={liquid:rows.filter(row=>cohort.has(row.symbol)), verified_price:rows.filter(row=>cohort.has(row.symbol)&&row.technical_audit?.valid===true&&row.technical_audit.as_of_date===date)};
equal([cohorts.liquid.length,cohorts.verified_price.length],[1894,1846],'Unexpected source cohort');
const changes=[];
for(const row of rows) for(const method of methods) {
 const previous=baseline.assess(row,method,now), current=assess(row,method,now);
 equal(current.passed,previous.passed,`${row.symbol}/${method} pass count changed`);
 equal(current.qualified,previous.qualified,`${row.symbol}/${method} qualified changed`);
 for(let i=0;i<current.rules.length;i++) if(previous.rules[i].state!==current.rules[i].state) {
  equal([previous.rules[i].state,current.rules[i].state],['unknown','fail'],`${row.symbol}/${method}/${i} unexpected transition`);
  changes.push({symbol:row.symbol,method,index:i,label:current.rules[i].label,before:'unknown',after:'fail',evidence:current.rules[i].evidence,
    annual_complete:i===2&&method==='oneil'?currentFinancialHistory(row.financial_history,row.symbol,date,now,row).annualComplete:undefined});
 }
}
const report={evaluated_at:projection.financial_evaluated_at,as_of_date:date,source_sha256:createHash('sha256').update(targetBytes).digest('hex'),projection_sha256:createHash('sha256').update(projectionBytes).digest('hex'),policy:{before:beforePolicy,after:afterPolicy,summary_before:baseline.RULE_SUMMARY_VERSION,summary_after:RULE_SUMMARY_VERSION},cohorts:{},changes};
for(const [name,items] of Object.entries(cohorts)) {
 report.cohorts[name]=Object.fromEntries(methods.map(method=>[method,{before:summary(items,baseline.assess,method),after:summary(items,assess,method)}]));
 for(const method of methods) equal(rankCandidates(items,method,{now}).map(item=>item.row.symbol),baseline.rankCandidates(items,method,{now}).map(item=>item.row.symbol),`${name}/${method} candidate order changed`);
}
const decoded=decodeResearchIndex(encodeResearchIndex({as_of_date:date,rows})).rows;
for(const [index,row] of rows.entries()) {
 const detail=mergeFinancialDetail(decoded[index],row,{now,asOfDate:date});
 const chart=overlayFinancialChart({symbol:row.symbol,as_of_date:date,bars:[],stock_data:row},projection).stock_data;
 for(const candidate of [decoded[index],detail,chart]) for(const method of methods) equal(assess(candidate,method,now),assess(row,method,now),`${row.symbol}/${method} surface mismatch`);
 for(const method of ['oneil','ibd']) {
  const evidence=buildFinancialEvidencePresentation(row,{method,date,generation:'compound-audit',now});
  const view=financialEvidencePresentation({evidence,history:row.financial_history,symbol:row.symbol,date,generation:'compound-audit',method,now});
  equal(view.rows.find(item=>item.id==='annual_eps_growth_3y').state,assess(row,method,now).rules.find(rule=>rule.label.includes('3年')).state,`${row.symbol}/${method} presentation mismatch`);
 }
}
for(const method of methods) {
 const ranked=rankCandidates(rows,method,{now}), transported=rankCandidates(decoded,method,{now});
 equal(researchCsv(ranked,method,date,now),researchCsv(transported,method,date,now),`${method} CSV/order mismatch`);
 for(const filter of [{qualifiedOnly:true},{nearOnly:true},{coverage:'verified'}]) equal(filterRanked(ranked,filter).map(item=>item.row.symbol),filterRanked(transported,filter).map(item=>item.row.symbol),`${method} candidate filter mismatch`);
}
for(const filter of [{epsGrowthYy:{min:25}},{epsGrowth:{min:25}},{salesGrowth:{min:25}}]) {
 const matched=filterStaticScanRows(rows,filter,{now}).map(row=>row.symbol);
 if (!matched.length || matched.length===rows.length) throw Error('Scan filter did not exercise a real subset');
 equal(matched,filterStaticScanRows(decoded,filter,{now}).map(row=>row.symbol),'Scan filter mismatch');
}
report.examples=['AVT','SMTC','MSGS'].map(symbol=>{
 const row=rows.find(row=>row.symbol===symbol), previous=baseline.assess(row,'oneil',now), current=assess(row,'oneil',now);
 return {symbol,before:{passed:previous.passed,failed:previous.failed,unknown:previous.unknown},after:{passed:current.passed,failed:current.failed,unknown:current.unknown},annual:current.rules[2]};
});
report.verified={source_bytes_unchanged:true,pass_counts_unchanged:true,qualified_counts_unchanged:true,candidate_order_unchanged:true,all_5901_rows_list_detail_chart_presentation_csv_filter_parity:true};
equal(await readFile(targetPath),targetBytes,'Target file changed');equal(await readFile(projectionPath),projectionBytes,'Projection file changed');
await writeFile(outputPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output:outputPath,changes:changes.length,cohorts:Object.fromEntries(Object.entries(report.cohorts).map(([name,methods])=>[name,Object.fromEntries(Object.entries(methods).map(([method,{before,after}])=>[method,{qualified:after.qualified,passed:after.passed,unknown_delta:after.unknown-before.unknown,zero_failed_only_unknown:[before.zero_failed_only_unknown,after.zero_failed_only_unknown]}]))]))},null,2));
