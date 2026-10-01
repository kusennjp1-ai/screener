import { describe, expect, it, vi } from 'vitest';
import { chartHistoryWarning, relativeStrengthScale, setResearchRange, researchVolumeBars } from './researchChartModel';
import { transformToCandlestickData } from './candlestickData';

describe('research chart regressions', () => {
  it('emphasizes volume against the preceding fifty bars, with unknown warm-up volume remaining neutral', () => {
    const bars = Array.from({length:50},(_,i)=>({time:`date-${i}`,value:100}));
    const result=researchVolumeBars([...bars,{time:'breakout',value:140}],50,{vol:'neutral','vol-hi':'emphasized'});
    expect(result.slice(0,50).every(bar=>bar.color==='neutral')).toBe(true);
    expect(result.at(-1).color).toBe('emphasized');
    expect(researchVolumeBars([...bars,{time:'quiet',value:139.99}],50,{vol:'neutral','vol-hi':'emphasized'}).at(-1).color).toBe('neutral');
  });
  it('warns on unresolved split discontinuities and invalid OHLC instead of drawing a valid shape', () => {
    const before={date:'2026-06-11',open:2400,high:2430,low:2300,close:2411,volume:1700000};
    const after={date:'2026-06-12',open:237,high:255,low:236,close:254,volume:10000000};
    expect(chartHistoryWarning([before,after])).toContain('分割');
    expect(chartHistoryWarning([{...after,high:253}])).toContain('不整合');
    expect(chartHistoryWarning([{...before,open:240,high:243,low:230,close:241.1,volume:17000000},after])).toBeNull();
  });
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
