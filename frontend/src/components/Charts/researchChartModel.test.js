import { describe, expect, it, vi } from 'vitest';
import { relativeStrengthScale, setResearchRange } from './researchChartModel';
import { transformToCandlestickData } from './candlestickData';

describe('research chart regressions', () => {
  it('scales RS only to the visible period, including BusinessDay bounds', () => {
    const points=[{time:'2026-01-01',value:1000},{time:'2026-09-01',value:15},{time:'2026-09-02',value:53}];
    const scale=relativeStrengthScale(points,{from:{year:2026,month:9,day:1},to:{year:2026,month:9,day:2}}).priceRange;
    expect(scale.minValue).toBeLessThan(15); expect(scale.maxValue).toBeGreaterThan(53);
    expect((53-15)/(scale.maxValue-scale.minValue)).toBeGreaterThan(.8);
    expect(relativeStrengthScale(points,{from:'2027-01-01',to:'2027-02-01'})).toBeNull();
  });
  it('uses actual time indices for every period even if other series start earlier', () => {
    const bars=Array.from({length:260},(_,i)=>({time:`date-${i}`}));
    const scale={timeToIndex:time=>Number(time.split('-')[1])+200,setVisibleLogicalRange:vi.fn()};
    for(const count of [21,63,126,252]) {
      setResearchRange({timeScale:()=>scale},bars,count);
      expect(scale.setVisibleLogicalRange).toHaveBeenLastCalledWith({from:260-count+199.5,to:461});
    }
  });
  it('weekly trend averages need 10/30/40 weeks, not 50/150/200 weeks', () => {
    const bars=Array.from({length:280},(_,i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open:100,high:102,low:99,close:101,volume:100}));
    const weekly=transformToCandlestickData(bars,'weekly');
    expect(weekly.sma200.length).toBeGreaterThan(0);
    expect(weekly.sma200.at(-1).value).toBe(101);
  });
});
