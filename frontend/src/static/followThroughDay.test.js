import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { followThroughDay, FOLLOW_THROUGH_METHOD, FOLLOW_THROUGH_STATES, FOLLOW_THROUGH_EVENTS } from './followThroughDay';
import { distributionDays } from './distributionDays';
const dates=size=>Array.from({length:size},(_,i)=>new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10));
// A step is a close or [close,{low,volume}]; open equals close so any low at or below the close is a valid bar.
const series=steps=>{const days=dates(steps.length);return steps.map((step,i)=>{const [close,extra={}]=Array.isArray(step)?step:[step];return {date:days[i],open:close,high:close*1.002,low:extra.low??close*.998,close,volume:extra.volume??1000};});};
const run=(steps,extra={})=>{const bars=steps[0]?.date?steps:series(steps);return followThroughDay({symbol:'^GSPC',bars,asOfDate:bars.at(-1).date,...extra});};
const types=result=>result.events.map(event=>event.type);
// Peak 103 (index 3), then a 6.3% decline to a 95 low (index 7).
const CORRECTION=[100,101,102,103,100,98,96.5,95];
// Rally attempt: day 1-3 (day 3 is a big up day that is still too early), FTD on day 4 (+1.53% on higher volume).
const FTD=[...CORRECTION,95.5,95.8,98,[99.5,{volume:1100}]];

describe('follow-through state machine',()=>{
 it('keeps a 5.9% pullback as no_correction, measured at the close of the lowest-low session (backend formula)',()=>{
  const dip=103*.941,result=run([100,101,102,103,101,99,97,dip,98,99]);
  expect(result).toMatchObject({available:true,method:FOLLOW_THROUGH_METHOD,state:'no_correction',peak:{date:dates(4)[3],close:103},low:{date:dates(8)[7]},attempt:null,ftd:null,failedDate:null,events:[]});
  expect(result.declinePct).toBeCloseTo(5.9,6);
  // An intraday low beyond 6% does not start a correction while that session's close stays above it.
  expect(run([100,101,102,103,101,99,97,[dip,{low:96}],98]).state).toBe('no_correction');
 });
 it('reports the drawdown leg at a new closing high without a pullback yet',()=>{
  const result=run([100,101,102,103]);
  expect(result).toMatchObject({state:'no_correction',peak:{date:dates(4)[3],close:103},low:null,declinePct:null});
 });
 it('enters correction at the first lowest-low session whose close is at least 6% under the peak',()=>{
  const result=run(CORRECTION);
  expect(result).toMatchObject({state:'correction',peak:{close:103},low:{date:dates(8)[7],low:95*.998},attempt:null,ftd:null});
  expect(result.events).toEqual([{type:'correction_start',date:dates(7)[6],peakDate:dates(4)[3],declinePct:expect.closeTo(100*(103-96.5)/103,9)}]);
 });
 it('counts the rally attempt from the first up close after the low and never confirms before day 4',()=>{
  const result=run([...CORRECTION,95.5,95.8,[98,{volume:2000}]]);
  expect(result).toMatchObject({state:'rally_attempt',attempt:{startDate:dates(9)[8],day:3},ftd:null});
  expect(types(result)).toEqual(['correction_start','rally_attempt']);
  expect(result.events[1]).toEqual({type:'rally_attempt',date:dates(9)[8],lowDate:dates(8)[7]});
 });
 it('confirms on day 4+ with a gain of at least 1.2% on volume above the prior session',()=>{
  const result=run(FTD);
  expect(result).toMatchObject({state:'confirmed',attempt:null,failedDate:null,peak:{date:dates(12)[11],close:99.5},low:null,
   ftd:{date:dates(12)[11],attemptDay:4,sessionsSince:0,distributionSince:null}});
  expect(result.ftd.gainPct).toBeCloseTo(100*(99.5/98-1),9);expect(result.ftd.volumeRatio).toBe(1.1);
  expect(result.events.at(-1)).toMatchObject({type:'ftd',date:dates(12)[11],attemptDay:4,lowDate:dates(8)[7]});
  // Equal volume, or a gain just under 1.2%, is not a follow-through.
  expect(run([...CORRECTION,95.5,95.8,98,[99.5,{volume:1000}]]).state).toBe('rally_attempt');
  expect(run([...CORRECTION,95.5,95.8,98,[98*1.0119,{volume:1100}]]).state).toBe('rally_attempt');
 });
 it('resets the attempt when a session low undercuts the rally low, even on an up close, and restarts from the new low',()=>{
  const undercut=run([...CORRECTION,95.5,95.8,[96,{low:94.5}]]);
  expect(undercut).toMatchObject({state:'correction',attempt:null,low:{date:dates(11)[10],low:94.5}});
  expect(undercut.events.at(-1)).toEqual({type:'attempt_failed',date:dates(11)[10],startDate:dates(9)[8],day:3});
  const restarted=run([...CORRECTION,95.5,95.8,[96,{low:94.5}],96.2]);
  expect(restarted).toMatchObject({state:'rally_attempt',attempt:{startDate:dates(12)[11],day:1}});
  expect(restarted.events.at(-1)).toEqual({type:'rally_attempt',date:dates(12)[11],lowDate:dates(11)[10]});
 });
 it('expires the attempt after day 15 without a follow-through and keeps the expiry while the low holds',()=>{
  const slow=Array.from({length:15},(_,i)=>95*1.001**(i+1));
  const day15=run([...CORRECTION,...slow]);
  expect(day15).toMatchObject({state:'rally_attempt',attempt:{day:15}});
  const expired=run([...CORRECTION,...slow,95*1.001**16]);
  expect(expired).toMatchObject({state:'attempt_expired',attempt:{startDate:dates(9)[8],day:16},ftd:null});
  expect(expired.events.at(-1)).toEqual({type:'attempt_expired',date:dates(24)[23],startDate:dates(9)[8]});
  // A qualifying session on day 16 or later is stale, not a follow-through.
  expect(run([...CORRECTION,...slow,[slow.at(-1)*1.02,{volume:1500}]]).state).toBe('attempt_expired');
  expect(run([...CORRECTION,...slow,95*1.001**16,[95*1.001**16*1.02,{volume:1500}]])).toMatchObject({state:'attempt_expired',attempt:{day:17}});
  // Day 15 itself still confirms.
  expect(run([...CORRECTION,...slow.slice(0,14),[slow[13]*1.02,{volume:1500}]]).ftd).toMatchObject({attemptDay:15});
  // An undercut after expiry resets the attempt and returns to correction.
  const reset=run([...CORRECTION,...slow,95*1.001**16,[95,{low:94}]]);
  expect(reset).toMatchObject({state:'correction',attempt:null,low:{low:94}});
  expect(reset.events.at(-1)).toMatchObject({type:'attempt_failed',day:17});
 });
 it('stays confirmed through a recovery to new highs, tracking the post-FTD peak',()=>{
  const result=run([...FTD,101,103.5,105,104]);
  expect(result).toMatchObject({state:'confirmed',peak:{date:dates(15)[14],close:105},low:{date:dates(16)[15]},ftd:{date:dates(12)[11],sessionsSince:4}});
  expect(result.declinePct).toBeCloseTo(100*(105-104)/105,9);
  expect(types(result)).not.toContain('recovered');
 });
 it('starts a new correction from the post-FTD peak once it falls 6% without breaking the FTD low',()=>{
  const result=run([...FTD,104,110,106,103]);
  expect(result).toMatchObject({state:'correction',peak:{close:110},ftd:null});
  expect(result.events.at(-1)).toMatchObject({type:'correction_start',date:dates(16)[15],peakDate:dates(14)[13]});
 });
 it('fails the FTD on a close under its low and resumes the correction from the same peak',()=>{
  const failed=run([...FTD,100,99]);
  expect(failed).toMatchObject({state:'ftd_failed',failedDate:dates(14)[13],peak:{date:dates(4)[3],close:103},low:{date:dates(8)[7]},ftd:{date:dates(12)[11],sessionsSince:2},attempt:null});
  expect(failed.events.at(-1)).toEqual({type:'ftd_failed',date:dates(14)[13],ftdDate:dates(12)[11]});
  // Backend parity: the same rally low gives no second follow-through until it is undercut.
  expect(run([...FTD,100,99,99.5,[101.5,{volume:1500}]]).state).toBe('ftd_failed');
  const undercut=run([...FTD,100,99,[94.5,{low:94}]]);
  expect(undercut).toMatchObject({state:'correction',ftd:null,failedDate:null,low:{low:94}});
  expect(undercut.events.at(-1)).toEqual({type:'low_undercut',date:dates(15)[14]});
  // A failing session that itself sets the new low lets the next up close start a fresh attempt.
  const fresh=run([...FTD,[94,{low:93.8}],94.5]);
  expect(fresh).toMatchObject({state:'rally_attempt',attempt:{startDate:dates(14)[13],day:1},ftd:null,failedDate:null});
  expect(types(fresh).slice(-2)).toEqual(['ftd_failed','rally_attempt']);
 });
 it('after a failure from a higher post-FTD peak, needs a 6% decline from that peak before a new correction or attempt',()=>{
  // 101, 103.5 (a close above the 103 leg peak), then 99.2 under the FTD low (99.30): only 4.2% under 103.5.
  const failed=run([...FTD,101,103.5,99.2]);
  expect(failed).toMatchObject({state:'ftd_failed',failedDate:dates(15)[14],peak:{date:dates(14)[13],close:103.5},low:{date:dates(15)[14]}});
  expect(failed.declinePct).toBeLessThan(6);
  // No rally attempt and no second follow-through off a sub-6% dip.
  const second=run([...FTD,101,103.5,99.2,99.5,99.6,99.7,[101,{volume:1100}]]);
  expect(second.state).toBe('ftd_failed');
  expect(types(second).filter(type=>type==='ftd')).toHaveLength(1);
  expect(types(second).slice(types(second).indexOf('ftd_failed'))).toEqual(['ftd_failed']);
  // An undercut still under 6% moves the low but is not a correction.
  const shallow=run([...FTD,101,103.5,99.2,[99.3,{low:98.9}]]);
  expect(shallow).toMatchObject({state:'ftd_failed',low:{low:98.9}});
  expect(types(shallow).at(-1)).toBe('ftd_failed');
  // Once the low caps a 6% decline from 103.5, the correction and a fresh attempt follow.
  const deep=run([...FTD,101,103.5,99.2,[97,{low:96.9}],97.5]);
  expect(deep).toMatchObject({state:'rally_attempt',peak:{close:103.5},low:{low:96.9},attempt:{day:1},ftd:null,failedDate:null});
  expect(types(deep).slice(-3)).toEqual(['ftd_failed','low_undercut','rally_attempt']);
  // A close back above the post-FTD peak ends the failed leg.
  expect(run([...FTD,101,103.5,99.2,104]).state).toBe('no_correction');
 });
 it('recovers to no_correction on a close above the peak without a follow-through',()=>{
  const result=run([...CORRECTION,...Array.from({length:8},(_,i)=>95*1.011**(i+1))]);
  expect(result.state).toBe('no_correction');
  expect(result.events.at(-1)).toMatchObject({type:'recovered',peakDate:dates(4)[3]});
  expect(result.peak.close).toBeGreaterThan(103);
 });
 it('counts only distribution days after the FTD that are still active',()=>{
  const bars=series([...FTD,100,101]),ftdDate=bars[11].date;
  const events=[{date:bars[5].date,state:'active'},{date:ftdDate,state:'active'},{date:bars[12].date,state:'active'},{date:bars[13].date,state:'expired'}];
  expect(run(bars,{distributionEvents:events}).ftd.distributionSince).toBe(1);
  expect(run(bars,{distributionEvents:[]}).ftd.distributionSince).toBe(0);
  expect(run(bars).ftd.distributionSince).toBeNull();
 });
 it('is causal: a later bar never changes an earlier date',()=>{
  const bars=series([...FTD,100,99,[94,{low:93.8}],94.5,95,96,97,98.5]);
  for(let i=0;i<bars.length;i++)expect(followThroughDay({symbol:'^GSPC',bars,asOfDate:bars[i].date})).toEqual(followThroughDay({symbol:'^GSPC',bars:bars.slice(0,i+1),asOfDate:bars[i].date}));
 });
 it('never returns a missing state for valid bars',()=>{
  let seed=7;const random=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
  for(let trial=0;trial<40;trial++){
   let close=100;const steps=Array.from({length:220},()=>{close*=1+(random()-.5)*.05;return [close,{low:close*(1-random()*.02),volume:1000+Math.floor(random()*500)}];});
   const result=run(steps);
   expect(FOLLOW_THROUGH_STATES).toContain(result.state);
   expect(result.peak).not.toBeNull();
   expect(Boolean(result.ftd)).toBe(['confirmed','ftd_failed'].includes(result.state));
   expect(Boolean(result.attempt)).toBe(['rally_attempt','attempt_expired'].includes(result.state));
   expect(Boolean(result.failedDate)).toBe(result.state==='ftd_failed');
   expect(result.events.every((event,i)=>FOLLOW_THROUGH_EVENTS.includes(event.type)&&(!i||event.date>=result.events[i-1].date))).toBe(true);
  }
 });
 it('is unavailable, never a state, for unidentified or malformed input',()=>{
  const bars=series(FTD);
  for(const input of [{symbol:'SPY',bars,asOfDate:bars.at(-1).date},{symbol:'^GSPC',bars,asOfDate:'2026-02-30'},{symbol:'^GSPC',bars,asOfDate:'2026-03-01'},
   {symbol:'^GSPC',bars:bars.map((bar,i)=>i===5?{...bar,volume:0}:bar),asOfDate:bars.at(-1).date},{symbol:'^GSPC',bars:[bars[1],bars[0],...bars.slice(2)],asOfDate:bars.at(-1).date},
   {symbol:'^GSPC',bars:bars.map((bar,i)=>i===5?{...bar,high:bar.low-1}:bar),asOfDate:bars.at(-1).date},{symbol:'^IXIC',bars:null,asOfDate:bars.at(-1).date}]){
   const result=followThroughDay(input);
   expect(result).toEqual({available:false,method:FOLLOW_THROUGH_METHOD,reason:expect.any(String)});
  }
 });
});

describe('follow-through on the committed real index seed',()=>{
 const source=JSON.parse(readFileSync(resolve('data/market-trend-source-2026-10-23.json'),'utf8'));
 const evaluate=(symbol,asOfDate=source.as_of_date)=>{
  const bars=source.indices.find(index=>index.symbol===symbol).bars;
  const distribution=distributionDays({symbol,bars,sessions:source.calendar.sessions,halfDays:source.calendar.half_days,asOfDate});
  expect(distribution.available).toBe(true);
  return followThroughDay({symbol,bars,asOfDate,distributionEvents:distribution.events});
 };
 it('finds the April follow-through days independently reproduced with the backend detector',()=>{
  const sp=evaluate('^GSPC'),nasdaq=evaluate('^IXIC');
  expect(sp.events.filter(event=>event.type==='ftd')).toEqual([expect.objectContaining({date:'2026-04-08',attemptDay:6,lowDate:'2026-03-30'})]);
  expect(nasdaq.events.filter(event=>event.type==='ftd')).toEqual([expect.objectContaining({date:'2026-04-14',attemptDay:10,lowDate:'2026-03-30'})]);
  expect(evaluate('^GSPC','2026-04-08')).toMatchObject({asOf:'2026-04-08',state:'confirmed',ftd:{date:'2026-04-08',sessionsSince:0}});
  expect(evaluate('^IXIC','2026-04-13')).toMatchObject({state:'rally_attempt',attempt:{startDate:'2026-03-31',day:9}});
 });
 it('assesses the latest leg at 2026-10-23 instead of an older 120-session low',()=>{
  const sp=evaluate('^GSPC'),nasdaq=evaluate('^IXIC');
  expect(sp).toMatchObject({asOf:'2026-10-23',state:'confirmed',ftd:{date:'2026-04-08'},peak:{date:'2026-10-06'}});
  expect(sp.ftd.distributionSince).toEqual(expect.any(Number));
  // The NASDAQ's 10-06 -> 10-23 pullback is 5.96% on the lowest-low session's close: not yet a correction.
  expect(nasdaq).toMatchObject({state:'no_correction',peak:{date:'2026-10-06'},low:{date:'2026-10-23'},ftd:null});
  expect(nasdaq.declinePct).toBeGreaterThan(5.9);expect(nasdaq.declinePct).toBeLessThan(6);
  // Its July correction expired without a follow-through, then recovered to a new closing high.
  expect(nasdaq.events.filter(event=>event.date>='2026-07-01').map(event=>[event.type,event.date])).toEqual([['correction_start','2026-07-23'],['rally_attempt','2026-07-30'],['attempt_expired','2026-08-20'],['recovered','2026-09-21']]);
 });
});
