import { describe,it,expect } from 'vitest';
import { validateLongHistory } from './marketLongHistory';
const make=()=>({schema_version:'market-long-history-v1',market:'US',as_of_date:'2026-10-23',retrieved_at:'2026-10-25T00:00:00Z',universe:{basis:'current-published-universe-retrospective',symbols:Array.from({length:100},(_,i)=>`S${i}`),sha256:'a'.repeat(64),historical_membership_verified:false,historical_fundamentals_verified:false},calendar:{provider:'pandas_market_calendars:NYSE',sessions:['2026-10-22','2026-10-23']},breadth:[{date:'2026-10-23',coverage:100,universe:100,eligibleUniverse:100,coveragePercent:100,above50:50,above50Percent:50,newHighs:2,newLows:0,leaderCount:4,stocks_up_4pct:6,stocks_down_4pct:3,ratio_10day:null}],sp500:[{date:'2026-10-23',close:6000}],sectorRotation:{lookback_sessions:126,frames:[]},provenance:[{symbol:'^GSPC',url:'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?period1=1&period2=2&interval=1d',sha256:'b'.repeat(64),retrieved_at:'2026-10-24T00:00:00Z'}]});
const stockProofs=value=>{value.provenance.push(...value.universe.symbols.map(symbol=>({symbol,url:`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`,sha256:'c'.repeat(64),retrieved_at:'2026-10-24T00:00:00Z'})));return value;};
describe('long history admission',()=>{
 it('retains an older observation without redating it',()=>{const value=stockProofs(make());expect(validateLongHistory(value,'2026-10-26').as_of_date).toBe('2026-10-23');});
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
