// Internal worker: start with a fresh graph and a fresh actual check clock.
import { writeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { readFinancialGenerationCarry, verifyCarryCompatibility } from './financial-generation-carry.mjs';
import { loadFinancialCorrection, verifyCorrectionCompatibility } from './financial-correction-overlay.mjs';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { appendStepSummary, formatSecAdmission, publishedSecInventory, validFundamentalsCoverageBlock } from './report-data-coverage.mjs';
const read=async path=>JSON.parse(await readFile(`public/static-data/${path}`,'utf8'));
const manifest=await read('manifest.json');
const indexPath=(manifest.markets?.US||manifest).assets.research.path;
const index=decodeResearchIndex(await read(indexPath));
const checkedAt=Date.now();
// The verifier counts details that kept an admitted same-day SEC record.
const admitted=report=>Number.isSafeInteger(report?.counts?.sec_admitted) ? `; same-day SEC quarterly evidence admitted for ${report.counts.sec_admitted} details` : '';

const carry=await readFinancialGenerationCarry();
if(carry) {
  const report=await verifyCarryCompatibility({root:'public/static-data',carry,evaluatedAt:checkedAt});
  console.log(`Financial carry gate passed: ${Object.keys(carry.symbols).length} owned destination symbols; original source lineage and independently fresh fields/history agree${admitted(report)}.`);
}
const correction=carry ? null : await loadFinancialCorrection({rows:index.rows,asOfDate:index.as_of_date});
if(correction) {
  const report=await verifyCorrectionCompatibility({root:'public/static-data',projection:correction,evaluatedAt:checkedAt});
  console.log(`Financial correction gate passed: ${Object.keys(correction.symbols).length} corrected symbols; every current chart alias and research assessment agrees${admitted(report)}.`);
}

// The publication's SEC coverage block (manifest.markets.US.fundamentals_coverage): an older exporter writes
// none, which stays valid; a block must be well formed and equal what the published details and the SEC
// input show, and every detail's sec_admission must be the one its record and that input give.
const declared=(manifest.markets?.US||manifest).fundamentals_coverage;
if(!validFundamentalsCoverageBlock(declared)) throw Error('Invalid fundamentals_coverage block in the manifest');
if(declared===undefined) console.log('Fundamentals coverage block absent (an exporter without it); nothing to compare.');
else {
  const inventory=await publishedSecInventory({root:'public'});
  if(inventory.derived_states) throw Error(`fundamentals_coverage requires every detail's sec_admission: ${inventory.derived_states} missing`);
  if(inventory.admission_problems.length) throw Error(`sec_admission disagrees with the detail's record or the SEC input: ${inventory.admission_problems.slice(0,10).join(' ')}`);
  const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
  if(JSON.stringify(sorted(inventory.block))!==JSON.stringify(sorted(declared))) throw Error('fundamentals_coverage differs from the published details and SEC input');
  const line=formatSecAdmission(index.as_of_date,{stage:'financial gate',input:{present:declared.file_schema!==null||declared.sec_as_of!==null,schema:declared.file_schema,as_of:declared.sec_as_of,same_day:declared.sec_fetch_ran,records:declared.requested},admitted:declared.admitted,refused:declared.refused_by_reason,universe:declared.universe});
  console.log(`Fundamentals coverage gate passed. ${line}.`);appendStepSummary(`- ${line}`);
}

writeSync(3, 'data-quality:financial:complete:v1\n');
