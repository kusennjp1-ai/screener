import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CandlestickChart from './CandlestickChart';

const { instances, factory, resizeObservers } = vi.hoisted(() => ({ instances: [], factory: vi.fn(), resizeObservers: [] }));
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
  resizeObservers.length=0;
  vi.stubGlobal('ResizeObserver',class {
    constructor(callback){this.callback=callback;this.disconnect=vi.fn();resizeObservers.push(this);}
    observe(element){this.element=element;}
  });
  vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));
  vi.stubGlobal('cancelAnimationFrame',vi.fn());
  factory.mockImplementation(container=>{
    const context={save:vi.fn(),restore:vi.fn(),resetTransform:vi.fn(),clearRect:vi.fn()};
    const canvas=document.createElement('canvas');
    canvas.getContext=()=>context;container.appendChild(canvas);
    let logicalRange=null;
    const rangeApplications=[];
    const timeScale={subscribeVisibleTimeRangeChange:vi.fn(),unsubscribeVisibleTimeRangeChange:vi.fn(),getVisibleRange:()=>null,
      timeToIndex:vi.fn(time=>item.candlestickSeries.setData.mock.lastCall?.[0].findIndex(p=>p.time===time)),
      getVisibleLogicalRange:()=>logicalRange,fitContent:vi.fn(),setVisibleRange:vi.fn(),
      setVisibleLogicalRange:vi.fn(range=>{logicalRange=range;rangeApplications.push({range,close:item.candlestickSeries.setData.mock.lastCall?.[0].at(-1)?.close,rs:item.rsLineSeries.setData.mock.lastCall?.[0].slice()});})};
    const scaleOptions=vi.fn();
    const item={chart:{subscribeCrosshairMove:vi.fn(),unsubscribeCrosshairMove:vi.fn(),clearCrosshairPosition:vi.fn(),resize:vi.fn(),remove:vi.fn(),applyOptions:vi.fn(),timeScale:()=>timeScale,priceScale:()=>({applyOptions:scaleOptions})},context,timeScale,rangeApplications,scaleOptions};
    for(const key of seriesKeys){
      const primitiveSet=new Set();
      const seriesScale={applyOptions:vi.fn()};
      item[key]={setData:vi.fn(),applyOptions:vi.fn(),priceScale:()=>seriesScale,
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
  it('does not invalidate chart options or RS scale options for a reused static symbol',()=>{
    const view=setup(),instance=instances[0];
    expect(instance.chart.applyOptions).not.toHaveBeenCalled();
    expect(instance.rsLineSeries.priceScale().applyOptions).not.toHaveBeenCalled();
    view.update({symbol:'BBB',chartIdentity:'BBB:2',priceData:bars(200),rsLineData:rs(20)});
    expect(instance.chart.applyOptions).not.toHaveBeenCalled();
    expect(instance.rsLineSeries.priceScale().applyOptions).not.toHaveBeenCalled();
    view.update({symbol:'BBB',chartIdentity:'BBB:2',interactive:false});
    expect(instance.chart.applyOptions).toHaveBeenCalledExactlyOnceWith({handleScroll:false,handleScale:false});
    view.update({symbol:'CCC',chartIdentity:'CCC:3',interactive:false});
    expect(instance.chart.applyOptions).toHaveBeenCalledTimes(1);
    view.update({symbol:'CCC',chartIdentity:'CCC:3',interactive:true});
    expect(instance.chart.applyOptions).toHaveBeenCalledTimes(2);
    expect(instance.chart.applyOptions).toHaveBeenLastCalledWith({handleScroll:true,handleScale:true});
  });
  it('subscribes to crosshair updates only while an OHLC legend is visible',()=>{
    const view=setup({hideOhlcLegend:true}),instance=instances[0];
    expect(instance.chart.subscribeCrosshairMove).not.toHaveBeenCalled();
    view.update({hideOhlcLegend:false});
    expect(instance.chart.subscribeCrosshairMove).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/始 100.00/)).toBeInTheDocument();
    const handler=instance.chart.subscribeCrosshairMove.mock.calls[0][0];
    act(()=>handler({time:'2026-09-21',seriesData:new Map([[instance.candlestickSeries,{time:'2026-09-21',open:80,high:85,low:78,close:82}]])}));
    expect(screen.getByText(/始 80.00/)).toBeInTheDocument();
    act(()=>handler({}));
    expect(screen.getByText(/始 100.00/)).toBeInTheDocument();
    view.update({hideOhlcLegend:true});
    expect(instance.chart.unsubscribeCrosshairMove).toHaveBeenCalledExactlyOnceWith(handler);
    view.update({hideOhlcLegend:false,smallScreen:true});
    expect(instance.chart.subscribeCrosshairMove).toHaveBeenCalledTimes(1);
    view.update({hideOhlcLegend:false,smallScreen:false});
    expect(instance.chart.subscribeCrosshairMove).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenCalledTimes(1);
  });
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
    expect(instance.rangeApplications.at(-1)).toEqual({range:{from:-.5,to:3},close:201,rs:rs(20)});
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
    const monthButton=screen.getByRole('button',{name:'1か月'});
    const pending={symbol:'BBB',chartIdentity:'BBB:2',priceData:[],rsLineData:null,pivotPrice:null,buyCeiling:null,stopPrice:null};
    view.update(pending);
    for(const key of seriesKeys)expect(instance[key].setData.mock.lastCall[0]).toEqual([]);
    expect(monthButton).not.toBeVisible();
    expect(view.container.querySelector('.chart-research-meta')).toHaveStyle({display:'none'});
    expect(screen.queryByRole('group',{name:'チャート操作'})).not.toBeInTheDocument();
    expect(instance.rsMarkers.setMarkers).toHaveBeenLastCalledWith([]);
    expect(view.container.querySelector('[data-chart-symbol="BBB"]')).toHaveAttribute('data-chart-pivot','');
    expect(view.container.querySelector('[data-chart-symbol="BBB"]')).toHaveAttribute('data-chart-upper','');
    expect(view.container.querySelector('[data-chart-symbol="BBB"]')).toHaveAttribute('data-chart-stop','');
    view.update({...pending,priceData:bars(300),rsLineData:rs(30),pivotPrice:301});
    expect(factory).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button',{name:'1か月'})).toBe(monthButton);
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
  it('applies the first window synchronously after RS, and keeps native range, zoom and annotation controls functional',()=>{
    const line=longBars.map((p,i)=>({time:p.date,value:10+i/100}));
    setup({priceData:longBars,rsLineData:line});
    const instance=instances[0],scale=instance.timeScale;
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(instance.rangeApplications).toEqual([{range:{from:133.5,to:261},close:100,rs:line}]);
    for(const [label,from] of [['1か月',238.5],['3か月',196.5],['6か月',133.5],['1年',7.5]]){
      fireEvent.click(screen.getByRole('button',{name:label}));
      expect(scale.setVisibleLogicalRange).toHaveBeenLastCalledWith({from,to:261});
    }
    const original=scale.getVisibleLogicalRange();
    fireEvent.click(screen.getByRole('button',{name:'チャートを拡大'}));
    expect(scale.getVisibleLogicalRange().from).toBeCloseTo(original.to-(original.to-original.from)*.7);
    fireEvent.click(screen.getByRole('button',{name:'チャートを縮小'}));
    expect(scale.getVisibleLogicalRange().from).toBeCloseTo(original.from);
    fireEvent.click(screen.getByRole('button',{name:'リセット'}));
    expect(instance.scaleOptions).toHaveBeenLastCalledWith({autoScale:true});
    expect(scale.setVisibleLogicalRange).toHaveBeenLastCalledWith({from:133.5,to:261});
    fireEvent.click(screen.getByRole('button',{name:'図解 詳細'}));
    expect(screen.getByRole('button',{name:'図解 簡易'})).toHaveAttribute('aria-pressed','false');
    fireEvent.click(screen.getByRole('button',{name:'週足'}));
    const weekCount=instance.candlestickSeries.setData.mock.lastCall[0].length;
    fireEvent.click(screen.getByRole('button',{name:'3か月'}));
    expect(scale.setVisibleLogicalRange).toHaveBeenLastCalledWith({from:weekCount-13-.5,to:weekCount+1});
  });
  it('preserves manual pan for unchanged identity and initializes the replacement only after all new series arrive',()=>{
    const view=setup({priceData:longBars}),instance=instances[0];
    instance.timeScale.setVisibleLogicalRange({from:10,to:50});
    const count=instance.rangeApplications.length;
    view.update({priceData:longBars,pivotPrice:102});
    expect(instance.rangeApplications).toHaveLength(count);
    expect(instance.timeScale.getVisibleLogicalRange()).toEqual({from:10,to:50});
    view.update({symbol:'BBB',chartIdentity:'BBB:2',priceData:[],rsLineData:null});
    expect(instance.rangeApplications).toHaveLength(count);
    view.update({symbol:'BBB',chartIdentity:'BBB:2',priceData:bars(200),rsLineData:rs(20)});
    expect(instance.rangeApplications.at(-1)).toEqual({range:{from:-.5,to:3},close:201,rs:rs(20)});
  });
  it('changes comparison duration synchronously without an extra animation frame',()=>{
    const view=setup({priceData:longBars,comparisonSessions:126}),instance=instances[0];
    const count=instance.rangeApplications.length;
    view.update({priceData:longBars,comparisonSessions:63});
    expect(instance.rangeApplications).toHaveLength(count+1);
    expect(instance.timeScale.setVisibleLogicalRange).toHaveBeenLastCalledWith({from:196.5,to:261});
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
  it.each([null,'AAA:1'])('preserves selected ranges and manual pan across fitted heights (identity: %s)',chartIdentity=>{
    const props={chartIdentity,priceData:longBars,height:420,smallScreen:true};
    const view=setup(props),instance=instances[0],observer=resizeObservers.find(observer=>observer.element?.hasAttribute('data-chart-symbol'));
    for(const [label,height] of [['1か月',310],['3か月',300],['pan',420]]){
      if(label==='pan')instance.timeScale.setVisibleLogicalRange({from:10.25,to:50.5});
      else fireEvent.click(screen.getByRole('button',{name:label}));
      const selected={...instance.timeScale.getVisibleLogicalRange()};
      view.update({...props,height});
      expect(instances.at(-1).timeScale.getVisibleLogicalRange()).toEqual(selected);
      expect(factory).toHaveBeenCalledTimes(1);
      act(()=>observer.callback([{contentRect:{width:390,height}}]));
      expect(instance.chart.resize).toHaveBeenLastCalledWith(390,height);
      expect(instance.timeScale.getVisibleLogicalRange()).toEqual(selected);
    }
    expect(instance.chart.remove).not.toHaveBeenCalled();
    expect(observer.disconnect).not.toHaveBeenCalled();
    view.unmount();
    expect(instance.chart.remove).toHaveBeenCalledOnce();
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });
  it('keeps timeframe defaults and legacy symbol range restoration distinct from resizing',()=>{
    const visibleRange={from:'2025-08-01',to:'2025-09-01'};
    const props={chartIdentity:null,priceData:longBars,height:420,visibleRange};
    const view=setup(props),instance=instances[0];
    fireEvent.click(screen.getByRole('button',{name:'週足'}));
    const weekCount=instance.candlestickSeries.setData.mock.lastCall[0].length;
    expect(instance.timeScale.getVisibleLogicalRange()).toEqual({from:Math.max(0,weekCount-52)-.5,to:weekCount+1});
    fireEvent.click(screen.getByRole('button',{name:'3か月'}));
    const selected={...instance.timeScale.getVisibleLogicalRange()};
    view.update({...props,height:310});
    expect(instance.timeScale.getVisibleLogicalRange()).toEqual(selected);
    expect(screen.getByRole('button',{name:'週足'})).toHaveAttribute('aria-pressed','true');
    expect(instance.timeScale.setVisibleRange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'日足'}));
    expect(instance.timeScale.getVisibleLogicalRange()).toEqual({from:133.5,to:261});
    view.update({...props,height:300});
    expect(instance.timeScale.getVisibleLogicalRange()).toEqual({from:133.5,to:261});
    view.update({...props,height:300,symbol:'BBB'});
    expect(factory).toHaveBeenCalledTimes(2);
    expect(instance.chart.remove).toHaveBeenCalledOnce();
    expect(instances[1].timeScale.setVisibleRange).toHaveBeenCalledExactlyOnceWith(visibleRange);
  });
});
