import { describe,it,expect } from 'vitest';
import { environmentPoint, validateLongHistory, BREAKOUT_MIN_SAMPLE, LEADER_MIN_COHORT } from './marketLongHistory';
const make=()=>({schema_version:'market-long-history-v1',market:'US',as_of_date:'2026-10-23',retrieved_at:'2026-10-25T00:00:00Z',universe:{basis:'current-published-universe-retrospective',symbols:Array.from({length:100},(_,i)=>`S${i}`),sha256:'a'.repeat(64),historical_membership_verified:false,historical_fundamentals_verified:false},calendar:{provider:'pandas_market_calendars:NYSE',sessions:['2026-10-22','2026-10-23']},breadth:[{date:'2026-10-23',coverage:100,universe:100,eligibleUniverse:100,coveragePercent:100,above50:50,above50Percent:50,newHighs:2,newLows:0,leaderCount:4,stocks_up_4pct:6,stocks_down_4pct:3,ratio_10day:null}],sp500:[{date:'2026-10-23',close:6000}],sectorRotation:{lookback_sessions:126,frames:[]},provenance:[{symbol:'^GSPC',url:'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?period1=1&period2=2&interval=1d',sha256:'b'.repeat(64),retrieved_at:'2026-10-24T00:00:00Z'}]});
const stockProofs=value=>{value.provenance.push(...value.universe.symbols.map(symbol=>({symbol,url:`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`,sha256:'c'.repeat(64),retrieved_at:'2026-10-24T00:00:00Z'})));return value;};
describe('long history admission',()=>{
 it('retains an older observation without redating it',()=>{const value=stockProofs(make());expect(validateLongHistory(value,'2026-10-26').as_of_date).toBe('2026-10-23');});
 it('accepts consistent market-environment fields and rejects a broken stage partition or breakout count',()=>{
  const env=value=>{const row=value.breadth[0],c=row.coverage;Object.assign(row,{trendTemplateCount:20,trendTemplatePercent:100*20/c,rs90TemplateCount:5,above150:40,above150Percent:100*40/c,above200:30,above200Percent:100*30/c,stage1:c-60,stage2:30,stage3:20,stage4:10,breakouts:2,breakoutsJudged:6,breakoutsHeld:4});return value;};
  expect(()=>validateLongHistory(env(stockProofs(make())),'2026-10-23')).not.toThrow();
  const broken=env(stockProofs(make()));broken.breadth[0].stage4+=1;
  expect(()=>validateLongHistory(broken,'2026-10-23')).toThrow(/stage partition/);
  const held=env(stockProofs(make()));held.breadth[0].breakoutsHeld=9;
  expect(()=>validateLongHistory(held,'2026-10-23')).toThrow(/breakout/);
  const rs=env(stockProofs(make()));rs.breadth[0].rs90TemplateCount=21;
  expect(()=>validateLongHistory(rs,'2026-10-23')).toThrow(/RS90/);
  const cohort=env(stockProofs(make()));Object.assign(cohort.breadth[0],{leaderCohort:12,leaderCohortAbove50:9});
  expect(()=>validateLongHistory(cohort,'2026-10-23')).not.toThrow();
  cohort.breadth[0].leaderCohortAbove50=13;
  expect(()=>validateLongHistory(cohort,'2026-10-23')).toThrow(/leader cohort subset/);
  const orphan=env(stockProofs(make()));Object.assign(orphan.breadth[0],{leaderCohort:null,leaderCohortAbove50:3});
  expect(()=>validateLongHistory(orphan,'2026-10-23')).toThrow(/leader cohort/);
 });
 it.each(['future','forgedHost','symbolSubstitution','missingIndexProof','duplicateDay','populationClaim','underCoverage','badPercentage','invalidRank'] )('rejects %s source evidence',kind=>{
  const value=stockProofs(make());
  if(kind==='future')value.as_of_date='2026-10-27';
  if(kind==='forgedHost')value.provenance[0].url='https://evil.example/v8/finance/chart/%5EGSPC';
  if(kind==='symbolSubstitution')value.provenance[0].symbol='SPY';
  if(kind==='missingIndexProof')value.provenance=[];
  if(kind==='duplicateDay')value.breadth.push({...value.breadth[0]});
  if(kind==='populationClaim')value.universe.historical_membership_verified=true;
  if(kind==='underCoverage')value.breadth[0].coverage=89;
  if(kind==='badPercentage')value.breadth[0].above50Percent=99;
  if(kind==='invalidRank')value.sectorRotation.frames=[{date:'2026-10-23',ranks:[{symbol:'XLK',rank:1,relativeIndex:120}]}];
  expect(()=>validateLongHistory(value,'2026-10-23')).toThrow();
 });
});

// Round 3 M8a-M8c: five optional keys the collector writes only once EMIT_R3_MARKET_FIELDS is on (package P5). Every
// publication lacks them today, so a reader must take a row with or without them, and refuse only a broken one.
describe('long history admission: the round 3 optional keys (M8a-M8c)',()=>{
 const R3_KEYS=['rs90Cohort','rs90CohortAbove50','newHighsClose','breakoutsEarlyJudged','breakoutsEarlyFailed'];
 const env=value=>{Object.assign(value.breadth[0],{trendTemplateCount:20,trendTemplatePercent:20,rs90TemplateCount:5,leaderCohort:12,leaderCohortAbove50:9,breakoutsJudged:6,breakoutsHeld:4});return value;};
 const r3=(value,extra={})=>{Object.assign(value.breadth[0],{rs90Cohort:11,rs90CohortAbove50:5,newHighsClose:1,breakoutsEarlyJudged:7,breakoutsEarlyFailed:2,...extra});return value;};
 it('accepts a row without them, with them, and with each of them null',()=>{
  expect(()=>validateLongHistory(env(stockProofs(make())),'2026-10-23')).not.toThrow();
  const valued=validateLongHistory(r3(env(stockProofs(make()))),'2026-10-23');
  expect(R3_KEYS.map(key=>valued.breadth[0][key])).toEqual([11,5,1,7,2]);
  expect(()=>validateLongHistory(r3(env(stockProofs(make())),Object.fromEntries(R3_KEYS.map(key=>[key,null]))),'2026-10-23')).not.toThrow();
  // Without the leader-cohort keys (an older capture's row) the RS90 cohort is still read as a count.
  expect(()=>validateLongHistory(r3(stockProofs(make())),'2026-10-23')).not.toThrow();
  // The early reads are a five-session window sum, like breakoutsJudged: never bounded by one day's coverage.
  expect(()=>validateLongHistory(r3(env(stockProofs(make())),{breakoutsEarlyJudged:140,breakoutsEarlyFailed:130}),'2026-10-23')).not.toThrow();
 });
 it.each([
  ['an RS90 cohort above the leader cohort',{rs90Cohort:13},/RS90 cohort subset of leader cohort/],
  ['an RS90 cohort above the coverage',{rs90Cohort:101,rs90CohortAbove50:0},/RS90 cohort count\/coverage gate/],
  ['a negative RS90 cohort',{rs90Cohort:-1,rs90CohortAbove50:null},/RS90 cohort count\/coverage gate/],
  ['more of the RS90 cohort above its 50-day line than in it',{rs90CohortAbove50:12},/RS90 cohort above-50 subset/],
  ['an RS90 cohort share without its cohort',{rs90Cohort:null,rs90CohortAbove50:3},/RS90 cohort above-50 subset/],
  ['more close-based new highs than new highs',{newHighsClose:3},/close new highs subset of new highs/],
  ['a fractional close-based count',{newHighsClose:0.5},/close new highs count\/coverage gate/],
  ['a text early count',{breakoutsEarlyJudged:'7'},/early breakout count/],
  ['more early failures than judged',{breakoutsEarlyFailed:8},/early breakout failures among judged/],
  ['early failures without judged ones',{breakoutsEarlyJudged:null},/early breakout failures among judged/],
 ])('refuses %s',(_,extra,message)=>{
  expect(()=>validateLongHistory(r3(env(stockProofs(make())),extra),'2026-10-23')).toThrow(message);
 });
 it('derives the two rates only at the existing minimums, and nothing from an absent or null key',()=>{
  const point=extra=>environmentPoint({date:'2026-10-23',coverage:100,...extra});
  expect(point({rs90Cohort:20,rs90CohortAbove50:9}).rs90HealthPercent).toBe(45);
  expect(point({rs90Cohort:LEADER_MIN_COHORT,rs90CohortAbove50:5}).rs90HealthPercent).toBe(50);
  expect(point({rs90Cohort:LEADER_MIN_COHORT-1,rs90CohortAbove50:5}).rs90HealthPercent).toBeNull();
  expect(point({rs90Cohort:20,rs90CohortAbove50:null}).rs90HealthPercent).toBeNull();
  expect(point({breakoutsEarlyJudged:8,breakoutsEarlyFailed:2}).breakoutEarlyFailedPercent).toBe(25);
  expect(point({breakoutsEarlyJudged:BREAKOUT_MIN_SAMPLE,breakoutsEarlyFailed:0}).breakoutEarlyFailedPercent).toBe(0);
  expect(point({breakoutsEarlyJudged:BREAKOUT_MIN_SAMPLE-1,breakoutsEarlyFailed:1}).breakoutEarlyFailedPercent).toBeNull();
  const absent=point({});
  expect(absent.rs90HealthPercent).toBeNull();expect(absent.breakoutEarlyFailedPercent).toBeNull();
  for(const key of R3_KEYS)expect(key in absent).toBe(false);
 });
});
