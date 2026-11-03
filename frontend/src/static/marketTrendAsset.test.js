// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMarketTrends } from '../../tools/export-market-trends.mjs';
import { readMarketTrends, longHistoryCheck } from './marketTrendAsset';
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
  ['non-boolean window-start flag',index=>{index.followThrough.peakAtWindowStart='no';}],
 ])('withdraws a malformed follow-through record (%s) without touching the distribution count',(_,mutate)=>{
  const value=payload(),original=structuredClone(value.indices[0]);mutate(value.indices[0]);
  const out=readMarketTrends(value,entry).indices[0];
  expect(out.followThrough).toEqual({available:false,method:expect.anything(),reason:'フォロースルー判定の形式を確認できません。'});
  const {followThrough,...rest}=out,{followThrough:originalFollowThrough,...expected}=original;
  expect(followThrough.available).toBe(false);expect(originalFollowThrough.available).toBe(true);
  expect(rest).toEqual(expected);
 });
 it('withdraws a follow-through not dated on its own index\'s last session, or on an index without bars',()=>{
  // ^IXIC ends three sessions early: a historical index whose judgement is dated 10-20 like its counts.
  const source=structuredClone(trendSource);source.indices.find(index=>index.symbol==='^IXIC').bars.splice(-3);
  const historical=buildMarketTrends(source,{asOfDate:date});
  expect(historical.indices[1]).toMatchObject({historical:true,latest:null,lastObserved:{date:'2026-10-20'},followThrough:{available:true,asOf:'2026-10-20'}});
  expect(readMarketTrends(structuredClone(historical),entry).indices[1].followThrough).toEqual(historical.indices[1].followThrough);
  // Relabelled as today's: every inner date still precedes it, but it is not its index's session.
  const relabelled=structuredClone(historical);relabelled.indices[1].followThrough.asOf=date;
  expect(readMarketTrends(relabelled,entry).indices[1].followThrough).toEqual({available:false,method:expect.any(String),reason:'フォロースルー判定の形式を確認できません。'});
  // A judgement copied onto an index that has no bars at all.
  const value=payload(),copied=value.indices[0].followThrough;
  value.indices[0]={symbol:'^GSPC',available:false,points:[],events:[],reason:'同じ基準日の出典付き指数履歴は未取得です。',lastObserved:null,followThrough:copied};
  const out=readMarketTrends(value,entry).indices[0];
  expect(out.followThrough.available).toBe(false);expect(out.reason).toBe('同じ基準日の出典付き指数履歴は未取得です。');
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
 it('names every validator check with a Japanese category, never the English key',()=>{
  const code=readFileSync(resolve('src/static/marketLongHistory.js'),'utf8');
  const keys=[...code.matchAll(/,\s*[`']([^`']+)[`']\);/g)].map(match=>match[1]).filter(key=>/[a-z]/.test(key));
  expect(keys.length).toBeGreaterThan(40);
  for(const key of [...keys,'invalid provenance URL']){
   const check=longHistoryCheck(Error(`長期市場履歴: ${key}`));
   expect(check.key).toBe(key);expect(check.label).toMatch(/^[^A-Za-z]+$/);
  }
  // Anything that is not a validator check (a TypeError on a malformed structure) is a format fault.
  expect(longHistoryCheck(TypeError("Cannot read properties of undefined (reading 'entries')"))).toEqual({key:"Cannot read properties of undefined (reading 'entries')",label:'データ形式'});
 });
 it('keeps a valid long history and sets no error',()=>{const out=readMarketTrends(payload({history:true}),entry);expect(out.long_history.as_of_date).toBe(date);expect(Object.hasOwn(out,'long_history_error')).toBe(false);});
 it.each([
  ['RS90 subset',value=>{const row=value.long_history.breadth.at(-1);row.rs90TemplateCount=5;row.trendTemplateCount=4;},'集計値の整合','RS90 subset of trend template'],
  ['warmup ratio',value=>{value.long_history.breadth[0].ratio_10day=1;},'集計値の整合','ratio warmup'],
  ['missing session',value=>{value.long_history.breadth.splice(1,1);},'取引カレンダー','breadth missing calendar session'],
  ['coverage',value=>{value.long_history.breadth.at(-1).coverage=1000;},'観測範囲','count/coverage gate'],
  ['retrieval date',value=>{value.long_history.retrieved_at='2026-10-22T23:00:00+00:00';},'取得日時','source retrieval date'],
  ['acquisition record',value=>{const symbol=value.long_history.universe.symbols[0];value.long_history.provenance=value.long_history.provenance.filter(row=>row.symbol!==symbol);delete value.long_history.errors?.[symbol];},'取得元の記録','stock response provenance or explicit acquisition error'],
 ])('drops only the long history on a %s fault and keeps distribution days and follow-through',(_,mutate,label,key)=>{
  const value=payload({history:true});mutate(value);
  const out=readMarketTrends(value,entry);
  expect(Object.hasOwn(out,'long_history')).toBe(false);
  // A reader sees a Japanese category; the validator's English key is kept only for diagnosis.
  expect(out.long_history_error).toBe(`長期市場履歴の整合性を確認できないため、長期集計を表示しません（検証項目: ${label}）。`);
  expect(out.long_history_error).not.toMatch(/[A-Za-z]/);
  expect(out.long_history_error_key).toBe(key);
  expect(out.indices).toEqual(payload().indices);
  expect(out.indices.map(index=>index.latest.value)).toEqual([5,3]);
 });
 it('checks no upper bound on retrieved_at in the browser (the build does), and still refuses a retrieval before the observation date',()=>{
  const value=payload({history:true}),retrievedAt=Date.parse(value.long_history.retrieved_at),behind=retrievedAt-2*86400000;
  // The build's own clock stays strict.
  expect(()=>validateLongHistory(value.long_history,date,behind)).toThrow(/source retrieval date/);
  expect(()=>validateLongHistory(value.long_history,date)).not.toThrow();
  const future=payload({history:true});future.long_history.retrieved_at='2099-01-01T00:00:00+00:00';
  expect(()=>validateLongHistory(future.long_history,date)).toThrow(/source retrieval date/);
  // The reader has no publication instant: neither a device clock that is behind nor a far-future instant is judged.
  const realNow=Date.now;
  try{
   Date.now=()=>behind;
   const out=readMarketTrends(value,entry);
   expect(out.long_history.retrieved_at).toBe(value.long_history.retrieved_at);expect(Object.hasOwn(out,'long_history_error')).toBe(false);
   expect(readMarketTrends(future,entry).long_history.retrieved_at).toBe('2099-01-01T00:00:00+00:00');
   // The lower bound is checked: a retrieval before the capture's own date is refused.
   const early=payload({history:true});early.long_history.retrieved_at='2026-10-22T23:00:00+00:00';
   expect(readMarketTrends(early,entry).long_history_error).toMatch(/^長期市場履歴の整合性を確認できないため/);
   expect(Object.hasOwn(readMarketTrends(early,entry),'long_history')).toBe(false);
  }finally{Date.now=realNow;}
 });
});
