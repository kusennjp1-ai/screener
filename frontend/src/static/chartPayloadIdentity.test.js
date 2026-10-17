import { expect, it } from 'vitest';
import { requireChartIdentity } from './chartPayloadIdentity';

const date='2026-10-02';
const payload={symbol:'SYNTH',as_of_date:date,bars:[{date:'2026-10-01',close:100},{date,close:101}]};
it.each([
  [{date:'2026-02-30'},payload.bars[1]],
  [{date:'2026-9-30'},payload.bars[1]],
  [{date:null},payload.bars[1]],
  [null,payload.bars[1]],
  [{date:'2026-10-01'},{date:'2026-09-30'},payload.bars[1]],
  [payload.bars[0],payload.bars[0],payload.bars[1]],
  [payload.bars[1],{date,close:999}],
].map(bars=>[bars]))('rejects ambiguous internal dates before chart or numeric selection: %j', bars=>{
  expect(()=>requireChartIdentity({...payload,bars},'SYNTH',date)).toThrow(/session dates/);
});
it('keeps sparse ordered observations and unknown values without inventing a session or mutating data',()=>{
  const bars=Object.freeze([{date:'2026-09-28',close:null},{date,close:0}].map(Object.freeze));
  const input=Object.freeze({...payload,bars});
  expect(requireChartIdentity(input,'SYNTH',date)).toBe(input);
  expect(input.bars).toHaveLength(2);
  expect(input.bars[0].close).toBeNull();
  expect(input.bars[1].close).toBe(0);
  expect(requireChartIdentity({...payload,bars:[]},'SYNTH',date).bars).toEqual([]);
});
