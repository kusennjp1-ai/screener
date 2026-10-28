import { expect, it } from 'vitest';
import { requireChartIdentity } from './chartPayloadIdentity';

const date='2026-10-02';
const payload={symbol:'SYNTH',as_of_date:date,bars:[{date:'2026-10-01',close:100},{date,close:101}]};
const retained = () => ({...payload,bars:[payload.bars[0]],retained_price_history:{status:'stale_reference_only',observation_date:'2026-10-01',target_as_of_date:date,original_as_of_date:'2026-10-01',original_generated_at:'2026-10-01T22:00:00Z',snapshot_sha256:'a'.repeat(64),snapshot_path:`producer-price-history/${'a'.repeat(64)}.json`}});
it('permits explicitly bound old bars for viewing without changing their observed dates or values',()=>{
 const input=retained(),before=structuredClone(input);
 expect(requireChartIdentity(input,'SYNTH',date)).toBe(input);
 expect(input).toEqual(before);
 input.retained_price_history.original_as_of_date=date;
 expect(requireChartIdentity(input,'SYNTH',date)).toBe(input);
});
it.each([
 ['missing marker',p=>delete p.retained_price_history],
 ['unrecognized status',p=>p.retained_price_history.status='current'],
 ['wrong target',p=>p.retained_price_history.target_as_of_date='2026-10-03'],
 ['wrong observation',p=>p.retained_price_history.observation_date='2026-09-30'],
 ['future observation',p=>{p.retained_price_history.observation_date='2026-10-03';p.bars[0].date='2026-10-03';}],
 ['current observation',p=>{p.retained_price_history.observation_date=date;p.retained_price_history.original_as_of_date=date;p.bars[0].date=date;}],
 ['source predates observation',p=>p.retained_price_history.original_as_of_date='2026-09-30'],
 ['missing source hash',p=>delete p.retained_price_history.snapshot_sha256],
 ['unbound source path',p=>p.retained_price_history.snapshot_path=`producer-price-history/${'b'.repeat(64)}.json`],
 ['invalid source clock',p=>p.retained_price_history.original_generated_at='unknown'],
 ['empty history',p=>p.bars=[]],
])('rejects retained history with %s',(_,change)=>{
 const input=structuredClone(retained());change(input);
 expect(()=>requireChartIdentity(input,'SYNTH',date)).toThrow();
});
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
