// Internal worker: start with a fresh graph and a fresh actual check clock.
import { writeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { readFinancialGenerationCarry, verifyCarryCompatibility } from './financial-generation-carry.mjs';
import { loadFinancialCorrection, verifyCorrectionCompatibility } from './financial-correction-overlay.mjs';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
const read=async path=>JSON.parse(await readFile(`public/static-data/${path}`,'utf8'));
const manifest=await read('manifest.json');
const indexPath=(manifest.markets?.US||manifest).assets.research.path;
const index=decodeResearchIndex(await read(indexPath));
const checkedAt=Date.now();

const carry=await readFinancialGenerationCarry();
if(carry) {
  await verifyCarryCompatibility({root:'public/static-data',carry,evaluatedAt:checkedAt});
  console.log(`Financial carry gate passed: ${Object.keys(carry.symbols).length} owned destination symbols; original source lineage and independently fresh fields/history agree.`);
}
const correction=carry ? null : await loadFinancialCorrection({rows:index.rows,asOfDate:index.as_of_date});
if(correction) {
  await verifyCorrectionCompatibility({root:'public/static-data',projection:correction,evaluatedAt:checkedAt});
  console.log(`Financial correction gate passed: ${Object.keys(correction.symbols).length} corrected symbols; every current chart alias and research assessment agrees.`);
}

writeSync(3, 'data-quality:financial:complete:v1\n');
