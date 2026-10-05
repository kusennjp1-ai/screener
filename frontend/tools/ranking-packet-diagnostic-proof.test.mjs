// @vitest-environment node
import {describe,expect,it}from'vitest';
import {encodeProof,fingerprintResearchBundle}from'./ranking-packet-diagnostic-proof.mjs';
const bundle=()=>{
 const rows=[{symbol:'A',missing:undefined,value:-0},{symbol:'B',value:1/7}];
 return {rows,date:'2026-10-02',rankings:Object.fromEntries(['minervini','minervini2','oneil','ibd'].map(method=>[method,rows.map(row=>({row,assessment:{qualified:false,unknown:2}}))])),prepared:{candidates:[rows[1]]},temporal:{date:'2026-10-02',rows,session_intervals:[],readiness_boundaries:[]}};
};
describe('ranking diagnostic completion proof',()=>{
 it('compares every value after structured clone while preserving ownership',async()=>{
  const original=bundle(),cloned=structuredClone(original);
  expect(await fingerprintResearchBundle(cloned)).toEqual(await fingerprintResearchBundle(original));
  cloned.rows[1].value+=1;
  expect((await fingerprintResearchBundle(cloned)).sha256).not.toBe((await fingerprintResearchBundle(original)).sha256);
 });
 it.each([undefined,null,NaN,Infinity,-Infinity,-0,0,'undefined;',{},[],[undefined]])('distinguishes typed value %s',value=>{
  expect(encodeProof({x:value})).not.toBe(encodeProof({}));
  if(typeof value!=='string')expect(encodeProof(value)).not.toBe(encodeProof(String(value)));
 });
 it('distinguishes absent and undefined properties, array holes, null and signed zero',()=>{
  const values=[{}, {x:undefined},{x:null},[undefined],Array(1),null,undefined,0,-0];
  expect(new Set(values.map(encodeProof)).size).toBe(values.length);
 });
 it.each(['rank','prepared','temporal','duplicate','count','method'])('rejects a broken %s completion binding',async kind=>{
  const value=bundle();
  if(kind==='rank')value.rankings.ibd[0].row={...value.rows[0]};
  if(kind==='prepared')value.prepared.candidates[0]={...value.rows[1]};
  if(kind==='temporal')value.temporal.rows=[...value.rows];
  if(kind==='duplicate')value.rankings.oneil[1]=value.rankings.oneil[0];
  if(kind==='count')value.rankings.minervini.pop();
  if(kind==='method')delete value.rankings.minervini2;
  await expect(fingerprintResearchBundle(value)).rejects.toThrow();
 });
});
