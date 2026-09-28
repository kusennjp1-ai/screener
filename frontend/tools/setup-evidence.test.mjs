import {describe,it,expect} from 'vitest';
import {setupEvidence} from './setup-evidence.mjs';
const asOf='2026-09-25';
const row={setup_recalculation:{status:'calculated',as_of_date:asOf},se_pattern_primary:'vcp',se_pivot_price:100,se_setup_ready:true};
describe('production setup evidence',()=>{
  it('does not reuse a shape after recalculation failure',()=>expect(setupEvidence({...row,setup_recalculation:{status:'unavailable'}},{candidate:true},asOf)).toBeNull());
  it('does not promote diagram heuristics over a missing production pattern',()=>expect(setupEvidence({...row,se_pattern_primary:null},{candidate:true},asOf).candidate).toBe(false));
  it('does not require pre-breakout volume contraction on the breakout day',()=>expect(setupEvidence({...row,se_setup_ready:false},{candidate:true},asOf)).toMatchObject({candidate:true,setup_ready:false}));
  it('requires both the unchanged production and diagram checks',()=>{expect(setupEvidence(row,{candidate:true},asOf).candidate).toBe(true);expect(setupEvidence(row,{candidate:false},asOf).candidate).toBe(false);});
});
