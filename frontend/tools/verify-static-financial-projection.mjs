// Offline acceptance replay. Inputs are retained artifacts and explicitly
// synthetic producer-certified stress fixtures; this never fetches vendors.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { encodeResearchIndex, decodeResearchIndex } from '../src/static/researchTransport.js';
import { prepareResearchBundle } from '../src/static/researchPreprocess.js';
import { rankCandidates, RULE_SUMMARY_VERSION } from '../src/static/researchEngine.js';
import { projectFinancialRow, financialNextExpiry } from '../src/static/financialCurrent.js';
import { preparePortfolioRows } from '../src/static/portfolioPlan.js';
import { mergeScanRows } from '../src/static/qualificationAudit.js';
import { encodeAssessment } from '../src/static/assessmentEncoding.js';
import { filterStaticScanRows } from '../src/static/scanClient.js';

const [archiveDirectory, baselineStaticDirectory, metadataInput, ...stressInputs] = process.argv.slice(2);
assert(archiveDirectory && baselineStaticDirectory && metadataInput, 'Usage: node tools/verify-static-financial-projection.mjs ARCHIVE_RAW BASELINE_STATIC METADATA_INPUT [STRESS_INPUT...]');
const now = Date.parse('2026-10-03T16:35:00Z');
Date.now = () => now;
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const raw = path => json(resolve(archiveDirectory, path.replaceAll('/', '__')));
const timed = fn => { const start=performance.now(),result=fn(); return {result,ms:performance.now()-start}; };
const baseline = await import(pathToFileURL(resolve(baselineStaticDirectory,'researchPreprocess.js')));
const oldScan = await import(pathToFileURL(resolve(baselineStaticDirectory,'scanClient.js')));
const published=raw('static-data/research-index-0fc598ed9e604905.json');
assert.equal(hash(published),'0fc598ed9e6049059e57ccbfa44065423b647649e418df722bb1d1c29a5a2b14');
const input=json(metadataInput), originalHash=hash(input), date=published.as_of_date;
const previous=timed(()=>baseline.prepareResearchBundle([published],date));
const sameLegacyInput=timed(()=>prepareResearchBundle([published],date,{now,generation:'offline-acceptance',evaluationEpoch:1}));
const current=timed(()=>prepareResearchBundle([input],date,{now,generation:'offline-acceptance',evaluationEpoch:1}));
assert.equal(current.result.rows.length,5901);
const counts=bundle=>Object.fromEntries(Object.entries(bundle.rankings).map(([method,ranked])=>[method,{all:ranked.filter(item=>item.assessment.qualified).length,liquid:ranked.filter(({row,assessment})=>assessment.qualified&&row.current_price>=10&&row.adv_usd>=20000000).length}]));
const oldCounts=counts(previous.result),newCounts=counts(current.result);
assert.deepEqual(newCounts.minervini,{all:492,liquid:258});
assert.deepEqual(newCounts.minervini2,{all:499,liquid:259});
assert.equal(oldCounts.ibd.all,17);assert.equal(newCounts.ibd.all,0);
const oldIbd=new Set(previous.result.rankings.ibd.filter(item=>item.assessment.qualified).map(item=>item.row.symbol));
assert(current.result.rankings.ibd.filter(item=>oldIbd.has(item.row.symbol)).every(item=>!item.assessment.qualified&&item.assessment.unknown>0));
assert.equal(current.result.prepared.candidates.length,0);
assert.equal(hash(input),originalHash,'Retained input must remain byte-equivalent as JSON');

function finalWire(bundle) {
  const rows=bundle.rows.map(row=>({...row,method_summary:{version:RULE_SUMMARY_VERSION}}));
  const lookup=new Map(rows.map(row=>[row.symbol,row]));
  for(const [method,ranked] of Object.entries(bundle.rankings)) for(const {row,assessment} of ranked) lookup.get(row.symbol).method_summary[method]=encodeAssessment(assessment);
  const wire=JSON.stringify(encodeResearchIndex({as_of_date:bundle.date,rows}));
  assert(Buffer.byteLength(wire)<=8000000);assert(gzipSync(wire).length<=1000000);
  const roundtrip=prepareResearchBundle([JSON.parse(wire)],bundle.date,{now,generation:'offline-acceptance',evaluationEpoch:1});
  for(const method of Object.keys(bundle.rankings)) assert.deepEqual(roundtrip.rankings[method].map(x=>[x.row.symbol,x.assessment]),bundle.rankings[method].map(x=>[x.row.symbol,x.assessment]));
  assert.deepEqual(roundtrip.prepared,bundle.prepared);
  const decoded=decodeResearchIndex(JSON.parse(wire));
  rows.forEach((row,index)=>{assert.deepEqual(decoded.rows[index].financial_current,row.financial_current);assert.equal(decoded.rows[index].research_detail_path,row.research_detail_path);});
  return {raw_bytes:Buffer.byteLength(wire),gzip_bytes:gzipSync(wire).length,available_proofs:rows.reduce((sum,row)=>sum+Object.keys(row.financial_current?.p || {}).length,0),orders_omitted:true,exact_proof_and_decision_roundtrip:true};
}
const transport=finalWire(current.result);
const stress=stressInputs.map(path=>{const fixture=json(path),before=hash(fixture),bundle=prepareResearchBundle([fixture],date,{now});const result=finalWire(bundle);assert.equal(hash(fixture),before);return {input:path,input_sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),input_json_sha256:before,synthetic:true,...result};});

const scanManifest=raw('static-data/scan-list/index-3768e083597e2da1.json');
const scanRows=scanManifest.chunks.flatMap(chunk=>raw(`static-data/${chunk.path}`).rows);
assert.equal(scanRows.length,5901);
const countFilters=filters=>({before:oldScan.filterStaticScanRows(scanRows,filters).length,after:filterStaticScanRows(scanRows,filters,{now}).length});
const presets=scanManifest.preset_screens.map(screen=>({id:screen.id,...countFilters(screen.filters),limit:screen.limit??null}));
const homeFilters={...scanManifest.default_filters,passesTemplate:true,rsRating:{min:90},week52HighDistance:{min:-10},ibdGroupRank:{max:98},code33:true};
const decoded=timed(()=>decodeResearchIndex(published)),merged=timed(()=>mergeScanRows([decoded.result],date));
const projected=timed(()=>merged.result.map(row=>projectFinancialRow(row,{now,asOfDate:date})));
const assessed=timed(()=>Object.fromEntries(['minervini','minervini2','oneil','ibd'].map(method=>[method,rankCandidates(projected.result,method,{now})])));
const portfolio=timed(()=>preparePortfolioRows(projected.result,now));
const expiry=timed(()=>financialNextExpiry(projected.result,now));
void assessed.result;void portfolio.result;void expiry.result;
console.log(JSON.stringify({evaluated_at:new Date(now).toISOString(),rows:5901,previous:oldCounts,current:newCounts,former_ibd_incomplete:oldIbd.size,portfolio_candidates:0,raw_inputs_unchanged:true,
  legacy_scan:{defaults:countFilters(scanManifest.default_filters),home_headline:countFilters(homeFilters),presets},transport,stress,
  cpu_ms:{same_legacy_input_baseline_prepare:previous.ms,same_legacy_input_current_prepare:sameLegacyInput.ms,new_metadata_prepare:current.ms,decode:decoded.ms,merge:merged.ms,projection:projected.ms,assess_and_sort:assessed.ms,portfolio:portfolio.ms,expiry:expiry.ms},
  limitations:['Node CPU timings are not browser cold-load or responsiveness measurements.','Stress fixtures certify bounded synthetic source variations, not universal future payload headroom.','No profitability or investment-return inference.','Nonstatic SQL/API are unactivated.']},null,2));
