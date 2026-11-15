// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMarketTrends, buildMarketTrendsWithStalling, STALLING_METHOD, STALLING_WINDOW_SESSIONS } from '../../tools/export-market-trends.mjs';
import { readMarketTrends, longHistoryCheck, INDEX_CLOSES_MAX, STALLING_SESSIONS } from './marketTrendAsset';
import { INDEX_CLOSES_MAX as CONTRACT_CLOSES_MAX } from '../test/fixtures/publishedContracts.js';
import { validateLongHistory } from './marketLongHistory';
const date='2026-10-23',entry={as_of_date:date};
const trendSource=JSON.parse(readFileSync(resolve('data/market-trend-source-2026-10-23.json'),'utf8'));
const historySource=readFileSync(resolve('data/market-history-source-2026-10-23.json'),'utf8');
const payload=({history=false}={})=>{const value=buildMarketTrends(structuredClone(trendSource),{asOfDate:date});if(history)value.long_history={...JSON.parse(historySource),source_sha256:'a'.repeat(64)};return value;};
// An older publication predates followThrough/lastObserved.
const legacy=()=>{const value=payload();for(const index of value.indices){delete index.followThrough;delete index.lastObserved;delete index.closes;}return value;};

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

describe('market trend reader: the indices\' closes (round 2, plan §2.3)',()=>{
 it('keeps valid closes and reads a publication without them as before (no closes, never an empty series)',()=>{
  expect(INDEX_CLOSES_MAX).toBe(CONTRACT_CLOSES_MAX);
  const out=readMarketTrends(payload(),entry);
  for(const index of out.indices){expect(index.closes.length).toBeGreaterThanOrEqual(60);expect(Object.hasOwn(index,'closes_error')).toBe(false);}
  const old=readMarketTrends(legacy(),entry);
  for(const index of old.indices){expect(Object.hasOwn(index,'closes')).toBe(false);expect(Object.hasOwn(index,'closes_error')).toBe(false);}
 });
 it.each([
  ['not an array',closes=>({date:closes[0].date})],
  ['empty',()=>[]],
  ['more than 300 points',closes=>[...Array.from({length:300-closes.length+1},(_,i)=>({date:`2025-01-${String(1+(i%28)).padStart(2,'0')}`,close:1})),...closes]],
  ['a close of 0',closes=>closes.map((point,i)=>i===5?{...point,close:0}:point)],
  ['a close as text',closes=>closes.map((point,i)=>i===5?{...point,close:'5800'}:point)],
  ['a missing close',closes=>closes.map((point,i)=>i===5?{date:point.date}:point)],
  ['a day out of order',closes=>closes.map((point,i)=>i===5?{...point,date:closes[3].date}:point)],
  ['a day after the publication',closes=>[...closes.slice(1),{date:'2026-10-26',close:1}]],
  ['days that are not the series\' own',closes=>closes.slice(0,-1)],
 ])('withdraws malformed closes (%s) alone, keeping the counts and the follow-through',(_,mutate)=>{
  const value=payload(),original=structuredClone(value.indices[1]);value.indices[1].closes=mutate(value.indices[1].closes);
  const out=readMarketTrends(value,entry).indices[1];
  expect(Object.hasOwn(out,'closes')).toBe(false);
  expect(out.closes_error).toBe('指数の終値の形式を確認できません。');
  expect(out.points).toEqual(original.points);
  expect(out.followThrough).toEqual(original.followThrough);
  expect(out.state).toEqual(original.state);
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

// Round 3 M8a-M8d: the keys the producers write only once EMIT_R3_MARKET_FIELDS is on (package P5). Every publication lacks
// them today: the reader takes an asset with or without them, and withdraws only a malformed stalling record, alone.
describe('market trend reader: the round 3 optional keys (M8)',()=>{
 /** The exporter's own output with each index's stalling written (emission on), as the follow-up commit will publish it. */
 const emitted=(source=trendSource)=>buildMarketTrendsWithStalling(structuredClone(source),{asOfDate:date,emitR3MarketFields:true}).payload;
 /** The five long-history keys on every row, each null where its sibling is (the collector's null rules). */
 const withR3Rows=value=>{for(const row of value.long_history.breadth)Object.assign(row,{rs90Cohort:row.leaderCount===null?null:Math.floor(row.leaderCount/3),
  rs90CohortAbove50:row.leaderCount===null?null:Math.floor(row.leaderCount/6),newHighsClose:row.newHighs===null?null:Math.floor(row.newHighs/2),
  breakoutsEarlyJudged:row.newHighs===null?null:row.newHighs+3,breakoutsEarlyFailed:row.newHighs===null?null:Math.floor(row.newHighs/4)});return value;};
 it('pins the live window to the exporter\'s and reads the exporter\'s stalling record unchanged, written or not',()=>{
  expect(STALLING_SESSIONS).toBe(STALLING_WINDOW_SESSIONS);
  const on=emitted();
  for(const index of on.indices)expect(index.stalling).toEqual({available:true,method:STALLING_METHOD,dates:[]});
  expect(readMarketTrends(structuredClone(on),entry)).toEqual(on);
  // Emission off (today's publications): no key, and the reader adds none.
  const off=payload();
  for(const index of readMarketTrends(structuredClone(off),entry).indices)expect(Object.hasOwn(index,'stalling')).toBe(false);
  // Apart from the key, the two assets are the same bytes.
  const stripped=structuredClone(on);for(const index of stripped.indices)delete index.stalling;
  expect(JSON.stringify(stripped)).toBe(JSON.stringify(off));
 });
 it('keeps live dates, an unavailable record with its reason, and a historical index\'s record on its own last session',()=>{
  const value=emitted(),dates=value.indices[0].points.map(point=>point.date);
  value.indices[0].stalling.dates=[dates.at(-STALLING_SESSIONS),dates.at(-3)];
  value.indices[1].stalling={available:false,method:STALLING_METHOD,reason:'25営業日の判定に必要な履歴が不足しています。'};
  expect(readMarketTrends(structuredClone(value),entry)).toEqual(value);
  // ^IXIC ends three sessions early: its stalling days are judged on 10-20, its own last point.
  const source=structuredClone(trendSource);source.indices.find(index=>index.symbol==='^IXIC').bars.splice(-3);
  const historical=emitted(source);
  expect(historical.indices[1]).toMatchObject({historical:true,stalling:{available:true,method:STALLING_METHOD}});
  expect(readMarketTrends(structuredClone(historical),entry).indices[1].stalling).toEqual(historical.indices[1].stalling);
  // A day after its own last session (a record relabelled onto the analysis date) is not one of its sessions.
  const relabelled=structuredClone(historical);relabelled.indices[1].stalling.dates=[date];
  expect(readMarketTrends(relabelled,entry).indices[1].stalling).toEqual({available:false,method:STALLING_METHOD,reason:'ストーリング日の形式を確認できません。'});
  // An index without bars says why (the exporter's own record), and a record copied onto it is withdrawn.
  const missing=structuredClone(trendSource);missing.indices=missing.indices.filter(index=>index.symbol!=='^GSPC');
  const none=emitted(missing);
  expect(none.indices[0].stalling).toEqual({available:false,method:STALLING_METHOD,reason:'同じ基準日の出典付き指数履歴は未取得です。'});
  expect(readMarketTrends(structuredClone(none),entry).indices[0].stalling).toEqual(none.indices[0].stalling);
  const copied=structuredClone(none);copied.indices[0].stalling={available:true,method:STALLING_METHOD,dates:[]};
  expect(readMarketTrends(copied,entry).indices[0].stalling.available).toBe(false);
 });
 it('keeps the oldest live stalling day the exporter writes (age 24), and the exporter expires it at 25: one window',()=>{
  const at=age=>{const source=structuredClone(trendSource),bars=source.indices.find(index=>index.symbol==='^GSPC').bars,i=bars.length-1-age,prev=bars[i-1],close=prev.close*1.001;
   // A +0.1% close on higher volume, low in its range and near the closing high: a stalling day on the real bars.
   bars[i]={...bars[i],open:prev.close,close,high:close*1.01,low:close*0.998,volume:Math.round(prev.volume*1.1)};
   return {day:bars[i].date,value:emitted(source)};};
  const live=at(STALLING_SESSIONS-1),gone=at(STALLING_SESSIONS);
  expect(live.value.indices[0].stalling).toEqual({available:true,method:STALLING_METHOD,dates:[live.day]});
  expect(live.day).toBe(live.value.indices[0].points.at(-STALLING_SESSIONS).date);
  expect(readMarketTrends(structuredClone(live.value),entry).indices[0].stalling).toEqual(live.value.indices[0].stalling);
  expect(gone.value.indices[0].stalling).toEqual({available:true,method:STALLING_METHOD,dates:[]});
  expect(gone.day).toBe(gone.value.indices[0].points.at(-STALLING_SESSIONS-1).date);
 });
 it.each([
  ['not an object',()=>'2'],
  ['no method',stalling=>({available:true,dates:stalling.dates})],
  ['an empty method',stalling=>({...stalling,method:''})],
  ['dates that are not a list',stalling=>({...stalling,dates:'2026-10-20'})],
  ['a date outside the last 25 sessions',(stalling,dates)=>({...stalling,dates:[dates.at(-STALLING_SESSIONS-1)]})],
  ['a date that is not one of its sessions',stalling=>({...stalling,dates:['2026-10-18']})],
  ['dates out of order',(stalling,dates)=>({...stalling,dates:[dates.at(-2),dates.at(-4)]})],
  ['a repeated date',(stalling,dates)=>({...stalling,dates:[dates.at(-2),dates.at(-2)]})],
  ['an invalid day',stalling=>({...stalling,dates:['2026-02-30']})],
  ['unavailable without a reason',stalling=>({available:false,method:stalling.method})],
  ['neither available nor unavailable',stalling=>({...stalling,available:'yes'})],
 ])('withdraws a malformed stalling record (%s) alone, keeping the count, the closes and the follow-through',(_,mutate)=>{
  const value=emitted(),index=value.indices[0],original=structuredClone(index);
  index.stalling=mutate(index.stalling,index.points.map(point=>point.date));
  const out=readMarketTrends(value,entry).indices[0];
  expect(out.stalling).toEqual({available:false,method:typeof index.stalling?.method==='string'&&index.stalling.method?index.stalling.method:null,reason:'ストーリング日の形式を確認できません。'});
  const {stalling,...rest}=out,{stalling:kept,...expected}=original;
  expect(kept.available).toBe(true);expect(stalling.available).toBe(false);
  expect(rest).toEqual(expected);
  expect(out.latest.value).toBe(5);
 });
 it('keeps a long history whose rows carry the five keys, and one whose rows do not',()=>{
  const value=withR3Rows(payload({history:true})),out=readMarketTrends(structuredClone(value),entry);
  expect(Object.hasOwn(out,'long_history_error')).toBe(false);
  expect(out.long_history).toEqual(value.long_history);
  expect(out.long_history.breadth.at(-1)).toMatchObject({rs90Cohort:201,newHighsClose:61,breakoutsEarlyJudged:125});
  const without=readMarketTrends(payload({history:true}),entry);
  expect(Object.hasOwn(without,'long_history_error')).toBe(false);
  expect('rs90Cohort' in without.long_history.breadth.at(-1)).toBe(false);
  // A broken key withdraws only the long history, as any other broken count does.
  const broken=withR3Rows(payload({history:true})),row=broken.long_history.breadth.at(-1);row.newHighsClose=row.newHighs+1;
  const refused=readMarketTrends(broken,entry);
  expect(Object.hasOwn(refused,'long_history')).toBe(false);
  expect(refused.long_history_error_key).toBe('close new highs subset of new highs');
  expect(refused.long_history_error).toBe('長期市場履歴の整合性を確認できないため、長期集計を表示しません（検証項目: 集計値の整合）。');
  expect(refused.indices).toEqual(payload().indices);
 });
});
