import { readFile } from 'node:fs/promises';
import { assess, RULE_SUMMARY_VERSION } from '../src/static/researchEngine.js';
const read=async path=>JSON.parse(await readFile(`public/static-data/${path}`,'utf8'));
const manifest=await read('manifest.json');
const index=await read((manifest.markets?.US||manifest).assets.research.path);
const quality=await read('data-quality.json');
for(const row of index.rows) for(const method of ['minervini','minervini2','oneil','ibd']) {
  const {rules,...expected}=assess(row,method); void rules;
  if(row.method_summary?.version!==RULE_SUMMARY_VERSION || JSON.stringify(expected)!==JSON.stringify(row.method_summary[method])) throw Error(`Rule summary mismatch: ${row.symbol}/${method}`);
}
if(!quality.total || quality.as_of_date!==index.as_of_date || quality.verified/quality.total<.9) {
  throw Error(`Daily verification below 90%: ${quality.verified}/${quality.total}. Keep last good publication and repair the source; never relax selection criteria.`);
}
console.log(`Quality gate passed: ${quality.verified}/${quality.total} verified; all exported assessments reproduce.`);
