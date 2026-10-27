import { describe, expect, it } from 'vitest';
import { marketUpdateState } from './marketUpdateState';
import { SECTOR_ETFS } from './marketLongHistory';
const history=date=>({as_of_date:date,breadth:[{date,coverage:100,eligibleUniverse:100,above50Percent:50,newHighs:10,newLows:1,leaderCount:20}],sp500:[{date,close:6000}],sectorRotation:{frames:[{date,ranks:SECTOR_ETFS.map((symbol,i)=>({symbol,rank:i+1,relativeIndex:110-i}))}]}});
const data=()=>({as_of_date:'2026-11-25',long_history:history('2026-11-25'),refresh_schedule:{provider:'pandas_market_calendars:NYSE',valid_until:'2026-12-01T05:00:00Z',sessions:[{date:'2026-11-25',close_at:'2026-11-25T21:00:00Z'},{date:'2026-11-27',close_at:'2026-11-27T18:00:00Z'},{date:'2026-11-30',close_at:'2026-11-30T21:00:00Z'}]}});
describe('market update session status',()=>{
 it('keeps the last completed session across a holiday and begins waiting exactly at an early close',()=>{
  expect(marketUpdateState(data(),Date.parse('2026-11-26T22:00:00Z'))).toMatchObject({state:'current',target:'2026-11-25'});
  expect(marketUpdateState(data(),Date.parse('2026-11-27T17:59:59.999Z'))).toMatchObject({state:'current'});
  expect(marketUpdateState(data(),Date.parse('2026-11-27T18:00:00Z'))).toMatchObject({state:'pending',target:'2026-11-27',daily:'2026-11-25',history:'2026-11-25'});
 });
 it('requires the actual long-history date as well as the daily date and never advances either',()=>{
  const input=data();input.as_of_date='2026-11-27';
  expect(marketUpdateState(input,Date.parse('2026-11-28T12:00:00Z'))).toMatchObject({state:'pending',history:'2026-11-25'});
  input.long_history.as_of_date='2026-11-27';expect(marketUpdateState(input,Date.parse('2026-11-28T12:00:00Z')).state).toBe('pending');
  input.long_history=history('2026-11-27');expect(marketUpdateState(input,Date.parse('2026-11-28T12:00:00Z')).state).toBe('current');
 });
 it.each([undefined,NaN,Date.parse('2026-12-01T05:00:00Z'),Date.parse('2026-11-25T20:00:00Z')])('does not invent currentness outside the supplied calendar: %s',now=>{
  const input=data();if(now===undefined)delete input.refresh_schedule;
  expect(marketUpdateState(input,now).state).toBe('unknown');
 });
 it('rejects unordered, invalid and future-observation calendar states',()=>{
  const input=data();input.refresh_schedule.sessions.reverse();expect(marketUpdateState(input,Date.parse('2026-11-28T12:00:00Z')).state).toBe('unknown');
  const future=data();future.as_of_date='2026-11-30';expect(marketUpdateState(future,Date.parse('2026-11-28T12:00:00Z')).state).toBe('unknown');
 });
 it('requires actual covered breadth, index and a complete correctly ranked sector frame',()=>{
  const mutations=[input=>{input.long_history.breadth=[];},input=>{input.long_history.breadth[0].above50Percent=null;},input=>{input.long_history.breadth[0].coverage=99;},input=>{input.long_history.sp500[0].close=null;},input=>{input.long_history.sectorRotation.frames[0].ranks.pop();},input=>{input.long_history.sectorRotation.frames[0].ranks[1].rank=1;}];
  for(const mutate of mutations){const input=data();mutate(input);expect(marketUpdateState(input,Date.parse('2026-11-26T22:00:00Z')).state).toBe('pending');}
 });
 it('accepts equal sector relative indices with their legitimate tied ranks',()=>{
  const input=data(),ranks=input.long_history.sectorRotation.frames[0].ranks;
  ranks[1].relativeIndex=ranks[0].relativeIndex;ranks[1].rank=1;
  expect(marketUpdateState(input,Date.parse('2026-11-26T22:00:00Z')).state).toBe('current');
 });
});
