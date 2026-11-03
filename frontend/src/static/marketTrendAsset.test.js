// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMarketTrends } from '../../tools/export-market-trends.mjs';
import { readMarketTrends } from './marketTrendAsset';
import { validateLongHistory } from './marketLongHistory';
const date='2026-10-23',entry={as_of_date:date};
const trendSource=JSON.parse(readFileSync(resolve('data/market-trend-source-2026-10-23.json'),'utf8'));
const historySource=readFileSync(resolve('data/market-history-source-2026-10-23.json'),'utf8');
const payload=({history=false}={})=>{const value=buildMarketTrends(structuredClone(trendSource),{asOfDate:date});if(history)value.long_history={...JSON.parse(historySource),source_sha256:'a'.repeat(64)};return value;};
// An older publication predates followThrough/lastObserved.
const legacy=()=>{const value=payload();for(const index of value.indices){delete index.followThrough;delete index.lastObserved;}return value;};

describe('market trend reader: optional follow-through and last observed count',()=>{
 it('accepts an older publication without the new fields unchanged',()=>{const value=legacy();expect(readMarketTrends(structuredClone(value),entry)).toEqual(value);});
 it('accepts the exporter output unchanged',()=>{const value=payload();expect(readMarketTrends(structuredClone(value),entry)).toEqual(value);});
 it.each([
  ['unknown state',index=>{index.followThrough.state='bottoming';}],
  ['missing state',index=>{delete index.followThrough.state;}],
  ['analysis date after the publication',index=>{index.followThrough.asOf='2026-10-26';}],
  ['event after its own date',index=>{index.followThrough.events.at(-1).date='2026-10-24';}],
  ['unknown event',index=>{index.followThrough.events[0].type='guess';}],
  ['confirmed without an FTD',index=>{index.followThrough.ftd=null;}],
  ['negative post-FTD distribution count',index=>{index.followThrough.ftd.distributionSince=-1;}],
  ['unavailable without a reason',index=>{index.followThrough={available:false,method:'x'};}],
 ])('withdraws a malformed follow-through record (%s) without touching the distribution count',(_,mutate)=>{
  const value=payload(),original=structuredClone(value.indices[0]);mutate(value.indices[0]);
  const out=readMarketTrends(value,entry).indices[0];
  expect(out.followThrough).toEqual({available:false,method:expect.anything(),reason:'フォロースルー判定の形式を確認できません。'});
  const {followThrough,...rest}=out,{followThrough:originalFollowThrough,...expected}=original;
  expect(followThrough.available).toBe(false);expect(originalFollowThrough.available).toBe(true);
  expect(rest).toEqual(expected);
 });
 it('keeps a valid record of each state shape, including ftd_failed with its failure date',()=>{
  const value=payload(),ft=value.indices[0].followThrough;
  Object.assign(ft,{state:'ftd_failed',failedDate:'2026-10-20'});
  expect(readMarketTrends(structuredClone(value),entry).indices[0].followThrough).toEqual(ft);
  ft.failedDate=null;expect(readMarketTrends(structuredClone(value),entry).indices[0].followThrough.available).toBe(false);
 });
 it('drops a last observed count that disagrees with its own points or postdates the publication, and keeps null',()=>{
  for(const lastObserved of [{date,value:99},{date:'2026-10-22',value:5},{date:'2026-10-26',value:5},'5']){
   const value=payload();value.indices[0].lastObserved=lastObserved;
   const out=readMarketTrends(value,entry).indices[0];
   expect(Object.hasOwn(out,'lastObserved')).toBe(false);expect(out.latest).toEqual(value.indices[0].latest);
  }
  const value=payload();value.indices[1].lastObserved=null;expect(readMarketTrends(value,entry).indices[1].lastObserved).toBeNull();
 });
 it('still rejects a payload whose identity or index dates are wrong',()=>{
  expect(()=>readMarketTrends(payload(),{as_of_date:'2026-10-22'})).toThrow();
  const value=payload();value.indices[0].points[3].date='2026-10-24';expect(()=>readMarketTrends(value,entry)).toThrow();
 });
});

describe('market trend reader: long history isolation',()=>{
 it('keeps a valid long history and sets no error',()=>{const out=readMarketTrends(payload({history:true}),entry);expect(out.long_history.as_of_date).toBe(date);expect(Object.hasOwn(out,'long_history_error')).toBe(false);});
 it.each([
  ['RS90 subset',value=>{const row=value.long_history.breadth.at(-1);row.rs90TemplateCount=5;row.trendTemplateCount=4;}],
  ['warmup ratio',value=>{value.long_history.breadth[0].ratio_10day=1;}],
  ['missing session',value=>{value.long_history.breadth.splice(1,1);}],
 ])('drops only the long history on a %s fault and keeps distribution days and follow-through',(_,mutate)=>{
  const value=payload({history:true});mutate(value);
  const out=readMarketTrends(value,entry);
  expect(Object.hasOwn(out,'long_history')).toBe(false);
  expect(out.long_history_error).toMatch(/^長期市場履歴の整合性を確認できないため、長期集計を表示しません（検証項目: .+）。$/);
  expect(out.indices).toEqual(payload().indices);
  expect(out.indices.map(index=>index.latest.value)).toEqual([5,3]);
 });
 it('does not reject a published capture because the device clock is behind, while the build clock stays strict',()=>{
  const value=payload({history:true}),retrievedAt=Date.parse(value.long_history.retrieved_at),behind=retrievedAt-2*86400000;
  expect(()=>validateLongHistory(value.long_history,date,behind)).toThrow(/source retrieval date/);
  expect(()=>validateLongHistory(value.long_history,date)).not.toThrow();
  const out=readMarketTrends(value,entry,{now:behind});
  expect(out.long_history.retrieved_at).toBe(value.long_history.retrieved_at);expect(Object.hasOwn(out,'long_history_error')).toBe(false);
  // The relaxed bound concerns only the clock; a retrieval before the observation date is still refused.
  const early=payload({history:true});early.long_history.retrieved_at='2026-10-22T23:00:00+00:00';
  expect(readMarketTrends(early,entry,{now:behind}).long_history_error).toMatch(/source retrieval date/);
 });
});
