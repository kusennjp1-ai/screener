import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CandlestickChart from './CandlestickChart';

const { instances, factory } = vi.hoisted(() => ({ instances: [], factory: vi.fn() }));
vi.mock('./createPriceChartSeries', () => ({ createPriceChartSeries: factory }));
const seriesKeys=['candlestickSeries','volumeSeries','avgVolumeSeries','ema10Series','ema20Series','ema50Series','sma50Series','sma150Series','sma200Series','rsLineSeries','epsLineSeries'];
const bars=price=>[
  {date:'2026-09-21',open:price,high:price+2,low:price-2,close:price,volume:1000},
  {date:'2026-09-22',open:price,high:price+3,low:price-1,close:price+1,volume:2000},
];
const rs=value=>[{time:'2026-09-21',value},{time:'2026-09-22',value:value+1}];
const longBars=Array.from({length:260},(_,index)=>({date:new Date(Date.UTC(2025,0,index+1)).toISOString().slice(0,10),open:100,high:103,low:98,close:100,volume:1000}));
beforeEach(()=>{
  instances.length=0;
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
  vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));
  vi.stubGlobal('cancelAnimationFrame',vi.fn());
  factory.mockImplementation(container=>{
    const context={save:vi.fn(),restore:vi.fn(),resetTransform:vi.fn(),clearRect:vi.fn()};
    const canvas=document.createElement('canvas');
    canvas.getContext=()=>context;container.appendChild(canvas);
    const timeScale={subscribeVisibleTimeRangeChange:vi.fn(),unsubscribeVisibleTimeRangeChange:vi.fn(),getVisibleRange:()=>null};
    const item={chart:{subscribeCrosshairMove:vi.fn(),clearCrosshairPosition:vi.fn(),resize:vi.fn(),remove:vi.fn(),applyOptions:vi.fn(),timeScale:()=>timeScale},context};
    for(const key of seriesKeys){
      const primitiveSet=new Set();
      item[key]={setData:vi.fn(),applyOptions:vi.fn(),priceScale:()=>({applyOptions:vi.fn()}),
        attachPrimitive:vi.fn(p=>primitiveSet.add(p)),detachPrimitive:vi.fn(p=>primitiveSet.delete(p)),primitiveSet,
        createPriceLine:vi.fn(o=>o),removePriceLine:vi.fn()};
    }
    item.candleMarkers={setMarkers:vi.fn()};item.rsMarkers={setMarkers:vi.fn()};
    instances.push(item);return item;
  });
});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.unstubAllGlobals();});
function setup(props={}){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const defaults={symbol:'AAA',chartIdentity:'AAA:1',researchView:true,bookAnnotations:true,priceData:bars(100),rsLineData:rs(10),pivotPrice:101,buyCeiling:106,stopPrice:94};
  const wrap=overrides=><QueryClientProvider client={client}><CandlestickChart {...defaults} {...overrides}/></QueryClientProvider>;
  const view=render(wrap(props));
  return {...view,update:next=>view.rerender(wrap(next))};
}
describe('validated static chart instance reuse',()=>{
  it('keeps one instance but immediately replaces all data and old annotations on a cached symbol switch',()=>{
    const view=setup({priceData:longBars});const instance=instances[0];
    expect(instance.sma200Series.setData.mock.lastCall[0]).toHaveLength(61);
    const previousPrimitives=[...instance.candlestickSeries.primitiveSet];
    fireEvent.click(screen.getByRole('button',{name:'週足'}));
    view.update({symbol:'BBB',chartIdentity:'BBB:2',priceData:bars(200),rsLineData:rs(20),pivotPrice:201,buyCeiling:211,stopPrice:188});
    expect(factory).toHaveBeenCalledTimes(1);
    expect(instance.chart.remove).not.toHaveBeenCalled();
    expect(instance.context.clearRect).toHaveBeenCalled();
    expect(instance.chart.clearCrosshairPosition).toHaveBeenCalledTimes(1);
    expect(instance.candlestickSeries.setData.mock.lastCall[0].map(p=>p.close)).toEqual([200,201]);
    expect(instance.rsLineSeries.setData.mock.lastCall[0]).toEqual(rs(20));
    expect(instance.volumeSeries.setData.mock.lastCall[0].map(p=>p.value)).toEqual([1000,2000]);
    for(const primitive of previousPrimitives)expect(instance.candlestickSeries.primitiveSet.has(primitive)).toBe(false);
    expect(instance.candlestickSeries.removePriceLine).toHaveBeenCalledWith(expect.objectContaining({price:101}));
    expect(instance.candlestickSeries.createPriceLine.mock.lastCall[0].price).toBe(201);
    expect(screen.getByRole('button',{name:'日足'})).toHaveAttribute('aria-pressed','true');
    expect(view.container.querySelector('[data-chart-symbol="BBB"]')).toHaveAttribute('data-chart-pivot','201');
  });
  it('empties every series and guide while new data is unavailable, then applies only the replacement payload',()=>{
    const view=setup({priceData:longBars});const instance=instances[0];
    expect(instance.sma200Series.setData.mock.lastCall[0]).toHaveLength(61);
    const pending={symbol:'BBB',chartIdentity:'BBB:2',priceData:[],rsLineData:null,pivotPrice:null,buyCeiling:null,stopPrice:null};
    view.update(pending);
    for(const key of seriesKeys)expect(instance[key].setData.mock.lastCall[0]).toEqual([]);
    expect(instance.rsMarkers.setMarkers).toHaveBeenLastCalledWith([]);
    expect(view.container.querySelector('[data-chart-symbol="BBB"]')).toHaveAttribute('data-chart-pivot','');
    expect(view.container.querySelector('[data-chart-symbol="BBB"]')).toHaveAttribute('data-chart-upper','');
    expect(view.container.querySelector('[data-chart-symbol="BBB"]')).toHaveAttribute('data-chart-stop','');
    view.update({...pending,priceData:bars(300),rsLineData:rs(30),pivotPrice:301});
    expect(factory).toHaveBeenCalledTimes(1);
    expect(instance.candlestickSeries.setData.mock.lastCall[0].map(p=>p.close)).toEqual([300,301]);
    expect(instance.rsLineSeries.setData.mock.lastCall[0]).toEqual(rs(30));
  });
  it('also erases the old bitmap on a same-symbol snapshot change and retains legacy instance isolation',()=>{
    const view=setup();const instance=instances[0];
    view.update({chartIdentity:'AAA:2',priceData:bars(120)});
    expect(factory).toHaveBeenCalledTimes(1);
    expect(instance.context.clearRect).toHaveBeenCalledTimes(1);
    expect(instance.candlestickSeries.setData.mock.lastCall[0].at(-1).close).toBe(121);
    view.update({chartIdentity:null});
    expect(factory).toHaveBeenCalledTimes(2);
    expect(instance.chart.remove).toHaveBeenCalledTimes(1);
    view.update({symbol:'BBB',chartIdentity:null,priceData:bars(150)});
    expect(factory).toHaveBeenCalledTimes(3);
  });
});
