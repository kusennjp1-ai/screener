// The full compiler replay exits before the strict comparison starts. A small
// coordinator retains only proof/cohort metadata between these two processes.
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { prepareBaselineComparison } from './financial-candidate-baseline.mjs';
import { dataInventory, digest } from './financial-correction.mjs';
import { inventoryDigest, sha256 } from './publication-state.mjs';
const input=JSON.parse(readFileSync(0,'utf8'));
const keys=['schema_version','beforeRoot','afterRoot','frontendRoot','prior','candidate','before_inventory_sha256','after_inventory_sha256','evaluated_at','compiler_replay_sha256','normalization_sha256'];
try {
  if(!input||typeof input!=='object'||Object.keys(input).sort().join('|')!==keys.sort().join('|')
    ||input.schema_version!=='financial-candidate-normalization-phase-v1'
    ||!Number.isFinite(Date.parse(input.evaluated_at))||new Date(input.evaluated_at).toISOString()!==input.evaluated_at
    || ['beforeRoot','afterRoot','frontendRoot','prior','candidate'].some(key=>!isAbsolute(input[key]||''))
    || dirname(input.prior)!==dirname(input.candidate)
    || ['before_inventory_sha256','after_inventory_sha256'].some(key=>!/^[a-f0-9]{64}$/.test(input[key]||'')))throw Error('Invalid baseline normalization phase');
  const originals=()=>{
    if(sha256(readFileSync(new URL('./financial-candidate-baseline-derived.mjs',import.meta.url)))!==input.compiler_replay_sha256
      ||sha256(readFileSync(new URL('./financial-candidate-baseline.mjs',import.meta.url)))!==input.normalization_sha256)throw Error('Baseline compiler code changed between phases');
    if(inventoryDigest(dataInventory(input.beforeRoot))!==input.before_inventory_sha256
      || inventoryDigest(dataInventory(input.afterRoot))!==input.after_inventory_sha256)throw Error('Baseline original input changed between phases');
  };
  originals();
  const progress=join(dirname(input.prior),'normalization-progress.jsonl');
  const onStage=stage=>appendFileSync(progress,JSON.stringify({stage,at:new Date().toISOString(),memory:process.memoryUsage()})+'\n');
  const result=await prepareBaselineComparison(input.beforeRoot,input.afterRoot,input.frontendRoot,input.prior,input.candidate,onStage);
  originals();
  if(result.evaluatedAt!==input.evaluated_at)throw Error('Baseline evaluation changed between phases');
  result.shadows={before:inventoryDigest(dataInventory(input.prior)),after:inventoryDigest(dataInventory(input.candidate))};
  process.stdout.write(JSON.stringify({input_sha256:digest(input),result,result_sha256:digest(result)}));
} catch(error) {console.error(error.stack || error);process.exitCode=1;}
