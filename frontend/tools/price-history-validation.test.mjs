import { expect, it } from 'vitest';
import { brokenHistory, vendorHistory } from './price-history-validation.mjs';
const bars=Array.from({length:380},(_,i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open:100,high:102,low:99,close:101,volume:1000})).filter(b=>![0,6].includes(new Date(b.date).getUTCDay()));
const raw={meta:{symbol:'TEST'},timestamp:bars.map(b=>Date.parse(b.date)/1000),indicators:{quote:[Object.fromEntries(['open','high','low','close','volume'].map(k=>[k,bars.map(b=>b[k])]))]}};
it('preserves verified vendor values without synthetic corrections',()=>{
  expect(vendorHistory(raw,'TEST',bars.at(-1).date)).toEqual(bars);
  expect(brokenHistory(bars)).toBe(false);
});
it('rejects symbol mismatch, incomplete session, OHLC errors and unadjusted splits',()=>{
  expect(()=>vendorHistory(raw,'OTHER',bars.at(-1).date)).toThrow('symbol');
  for(const value of [null,1,200]) {
    const bad=structuredClone(raw); bad.indicators.quote[0].close[200]=value;
    expect(()=>vendorHistory(bad,'TEST',bars.at(-1).date)).toThrow();
  }
  const split=structuredClone(bars); split.at(-1).open=10; split.at(-1).high=11; split.at(-1).low=9;split.at(-1).close=10;
  expect(brokenHistory(split)).toBe(true);
});
