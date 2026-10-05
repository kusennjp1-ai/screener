import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from './financial-correction.mjs';
import { comparisonHeapArguments, validateComparisonPhase, executeComparisonPhase } from './financial-preview-comparison.mjs';
const H='a'.repeat(64);
function fixture(){const projection={symbols:['AAA'],financial_generation:null};return {schema_version:'financial-preview-comparison-phase-v1',before:{root:'/before',inventory_sha256:H},after:{root:'/after',inventory_sha256:H},frontend_root:'/frontend',originals:[{root:'/original',inventory_sha256:H}],evaluated_at:'2026-10-04T17:16:34.337Z',projection,projection_sha256:digest(projection),comparator_sha256:H};}
test('comparison child preserves direct heap limits without forwarding execution modes',()=>{
  assert.deepEqual(comparisonHeapArguments(['--test','--max-old-space-size=1536','--eval','ignored','--max_semi_space_size','64','--inspect']),['--max-old-space-size=1536','--max_semi_space_size','64']);
});
test('comparison phase binds closed exact paths, input inventories, cohort, generation and evaluation',()=>{
  assert.deepEqual(validateComparisonPhase(fixture()),fixture());
  for(const change of [v=>v.before.extra=true,v=>v.before.root='relative',v=>v.originals[0].inventory_sha256='bad',v=>v.originals=null,v=>v.frontend_root='relative',v=>v.evaluated_at='1',v=>v.projection.symbols.push('BBB'),v=>v.projection.symbols.push('AAA'),v=>v.projection.financial_generation=H,v=>v.projection.extra=true,v=>v.comparator_sha256='bad']){
    const value=fixture();change(value);assert.throws(()=>validateComparisonPhase(value));
  }
});
test('comparison rejects changed executable identity before reading data',async()=>{
  await assert.rejects(()=>executeComparisonPhase(fixture()),/comparator code changed/);
});
