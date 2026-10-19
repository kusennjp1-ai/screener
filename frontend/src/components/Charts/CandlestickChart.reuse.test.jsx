import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CandlestickChart from './CandlestickChart';
import { transformToCandlestickData } from './candlestickData';

const { instances, factory, resizeObservers } = vi.hoisted(() => ({ instances: [], factory: vi.fn(), resizeObservers: [] }));
vi.mock('./createPriceChartSeries', () => ({ createPriceChartSeries: factory }));
const seriesKeys=['candlestickSeries','volumeSeries','avgVolumeSeries','ema10Series','ema20Series','ema50Series','sma50Series','sma150Series','sma200Series','rsLineSeries','epsLineSeries'];
const bars=price=>[
  {date:'2026-09-21',open:price,high:price+2,low:price-2,close:price,volume:1000},
  {date:'2026-09-22',open:price,high:price+3,low:price-1,close:price+1,volume:2000},
];
const rs=value=>[{time:'2026-09-21',value},{time:'2026-09-22',value:value+1}];
const longBars=Array.from({length:260},(_,index)=>({date:new Date(Date.UTC(2025,0,index+1)).toISOString().slice(0,10),open:100,high:103,low:98,close:100,volume:1000}));
// The shrinking-pullback/breakout shape from bookAnnotations.test.js, using
// trading dates so the regression also exercises nonempty automatic guides.
function annotatedBars(){
  const points=[[0,50],[60,100],[70,80],[80,98],[88,88],[96,96],[104,91],[110,99]];
  const dates=[],day=new Date('2025-01-01T00:00:00Z');
  while(dates.length<111){if(![0,6].includes(day.getUTCDay()))dates.push(day.toISOString().slice(0,10));day.setUTCDate(day.getUTCDate()+1);}
  return dates.map((date,i)=>{
    let k=1;while(points[k][0]<i)k++;
    const [a,x]=points[k-1],[b,y]=points[k],close=x+(y-x)*(i-a)/(b-a);
    return {date,open:close,high:close+.2,low:close-.2,close,volume:10000-i*40};
  });
}
beforeEach(()=>{
  instances.length=0;
  resizeObservers.length=0;
  vi.stubGlobal('ResizeObserver',class {
    constructor(callback){this.callback=callback;this.disconnect=vi.fn();resizeObservers.push(this);}
    observe(){}
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
  it.each([['daily',false],['daily',true],['weekly',false],['weekly',true]])(
    'reapplies data once on research-only round trips (%s, book=%s)',async(timeframe,bookAnnotations)=>{
      const priceData=annotatedBars(),line=priceData.map((p,i)=>({time:p.date,value:70+i/100}));
      const vcpBoxes=[{start:priceData[60].date,end:priceData.at(-1).date,high:100.2,low:79.8,label:'Base'}];
      const bands={pressure_history:priceData.map(()=>1)},buyPoints=[{time:priceData[108].date,type:'buy_point',price:96.2}];
      // Keep all input references and bookAnnotations fixed; only researchView
      // changes. Changing both flags would hide the original dependency bug.
      const props={priceData,rsLineData:line,epsLine:line,bookAnnotations,vcpBoxes,bands,buyPoints};
      const view=setup({...props,researchView:false});
      if(timeframe==='weekly')fireEvent.click(screen.getByRole('button',{name:'週足'}));
      const initial=instances[0],prices=initial.candlestickSeries.setData.mock.lastCall[0];
      const volume=initial.volumeSeries.setData.mock.lastCall[0],initialWrites=timeframe==='weekly'?2:1;
      expect(prices).toHaveLength(timeframe==='weekly'?23:111);
      if(timeframe==='daily')expect(prices).toEqual(priceData.map(({date,...bar})=>({time:date,open:bar.open,high:bar.high,low:bar.low,close:bar.close})));
      else expect(prices.at(-1)).toEqual({time:'2025-06-04',open:priceData[108].open,high:99.2,low:priceData[108].low,close:99});
      for(const [phase,researchView] of [false,true,false].entries()){
        if(phase)view.update({...props,researchView});
        const instance=instances.at(-1),writes=phase?1:initialWrites;
        const assertUpdates=()=>{
          expect(factory).toHaveBeenCalledTimes(phase+1);
          for(const key of seriesKeys)expect(instance[key].setData).toHaveBeenCalledTimes(writes);
          expect(instance.candlestickSeries.setData).toHaveBeenLastCalledWith(prices);
          const actualVolume=instance.volumeSeries.setData.mock.lastCall[0];
          expect(actualVolume.map(({time,value})=>({time,value}))).toEqual(volume.map(({time,value})=>({time,value})));
          if(!researchView)expect(actualVolume).toEqual(volume);
          const window=timeframe==='weekly'?10:50,average=instance.avgVolumeSeries.setData.mock.lastCall[0];
          expect(average).toHaveLength(volume.length-window+(researchView?0:1));
          const tail=researchView?volume.slice(-window-1,-1):volume.slice(-window);
          expect(average.at(-1).value).toBeCloseTo(tail.reduce((sum,p)=>sum+p.value,0)/window);
          for(const key of ['sma50Series','sma150Series','sma200Series'])expect(instance[key].setData.mock.lastCall[0]).toEqual(initial[key].setData.mock.lastCall[0]);
          expect(instance.sma50Series.setData.mock.lastCall[0]).toHaveLength(timeframe==='weekly'?14:62);
          for(const key of ['ema10Series','ema20Series','ema50Series']){
            const expected=researchView||bookAnnotations?[]:initial[key].setData.mock.lastCall[0];
            expect(instance[key].setData).toHaveBeenLastCalledWith(expected);
          }
          expect(instance.epsLineSeries.setData).toHaveBeenLastCalledWith(bookAnnotations?[]:line);
          const dates=new Set(prices.map(p=>p.time));
          expect(instance.rsLineSeries.setData).toHaveBeenLastCalledWith(timeframe==='daily'?line:researchView?line.filter(p=>dates.has(p.time)):[]);
          const primitives=instance.candlestickSeries.attachPrimitive.mock.calls.map(([p])=>p);
          for(const type of ['VcpBoxPrimitive','BandStripPrimitive','BuyPointPrimitive','TradeLevelsPrimitive']){
            const matches=primitives.filter(p=>p.constructor.name===type);
            expect(matches).toHaveLength(type==='TradeLevelsPrimitive'?(researchView?1:0):writes);
          }
          const vcp=primitives.findLast(p=>p.constructor.name==='VcpBoxPrimitive');
          expect(vcp._candles).toEqual(prices);
          if(bookAnnotations&&timeframe==='weekly')expect(vcp._boxes).toEqual([]);
          else {
            expect(vcp._boxes.length).toBeGreaterThan(0);
            if(bookAnnotations){expect(vcp._boxes.some(p=>p.curve)).toBe(true);expect(vcp._boxes.some(p=>p.arrow)).toBe(true);}
            else expect(vcp._boxes.map(({start,end,high,low})=>({start,end,high,low}))).toEqual(vcpBoxes.map(({start,end,high,low})=>({start,end,high,low})));
          }
          expect(primitives.findLast(p=>p.constructor.name==='BandStripPrimitive')).toMatchObject({_bands:bands,_barTimes:prices.map(p=>p.time)});
          expect(primitives.findLast(p=>p.constructor.name==='BuyPointPrimitive')).toMatchObject({_points:buyPoints,_barTimes:prices.map(p=>p.time)});
          expect(instance.candlestickSeries.createPriceLine).toHaveBeenCalledTimes(writes);
          expect(instance.candlestickSeries.createPriceLine.mock.lastCall[0].price).toBe(bookAnnotations&&timeframe==='daily'?96.2:101);
          expect(instance.chart.remove).not.toHaveBeenCalled();
        };
        assertUpdates();
        // A parent rerender and a hover-induced legend update must not rewrite
        // series, reattach guides, or create another chart. act flushes effects.
        for(let repeat=0;repeat<3;repeat++)view.update({...props,researchView});
        const onHover=instance.chart.subscribeCrosshairMove.mock.lastCall[0];
        act(()=>onHover({time:prices[0].time,seriesData:new Map([[instance.candlestickSeries,{...prices[0],close:prices[0].close+.1}]])}));
        await act(async()=>{});
        assertUpdates();
        for(const previous of instances.slice(0,-1))expect(previous.chart.remove).toHaveBeenCalledTimes(1);
      }
      expect(instances.map(i=>i.candlestickSeries.setData.mock.calls.length)).toEqual([initialWrites,1,1]);
      expect(requestAnimationFrame).not.toHaveBeenCalled();
    });
  it.each([[true,false],[false,true],[true,true]])('restores EMA data when leaving research=%s/book=%s without changing plotted prices', (researchView,bookAnnotations)=>{
    const props={priceData:longBars,researchView,bookAnnotations};
    const view=setup(props),hidden=instances.at(-1);
    const expected=transformToCandlestickData(longBars);
    for(const key of ['ema10','ema20','ema50'])expect(hidden[`${key}Series`].setData.mock.lastCall[0]).toEqual([]);
    expect(hidden.candlestickSeries.setData.mock.lastCall[0]).toEqual(expected.candlesticks);
    for(const key of ['sma50','sma150','sma200'])expect(hidden[`${key}Series`].setData.mock.lastCall[0]).toEqual(expected[key]);
    view.update({...props,researchView:false,bookAnnotations:false});
    const ordinary=instances.at(-1);
    for(const key of ['ema10','ema20','ema50'])expect(ordinary[`${key}Series`].setData.mock.lastCall[0]).toEqual(expected[key]);
    expect(ordinary.candlestickSeries.setData.mock.lastCall[0]).toEqual(expected.candlesticks);
    view.update(props);
    for(const key of ['ema10','ema20','ema50'])expect(instances.at(-1)[`${key}Series`].setData.mock.lastCall[0]).toEqual([]);
  });
  it.each([null,undefined,'not-a-number',NaN,Infinity])('clears every plotted series and legend for invalid numeric %s, then recovers',value=>{
    const props={priceData:longBars,bookAnnotations:false,epsLine:[{time:'2026-09-22',value:123}]};
    const view=setup(props),instance=instances[0];
    expect(instance.candlestickSeries.setData.mock.lastCall[0]).toHaveLength(260);
    view.update({...props,priceData:[...longBars.slice(0,-1),{...longBars.at(-1),close:value}]});
    expect(screen.getByText(/チャートは未表示/)).toBeInTheDocument();
    for(const key of seriesKeys)expect(instance[key].setData.mock.lastCall[0]).toEqual([]);
    expect(instance.candlestickSeries.removePriceLine).toHaveBeenCalled();
    view.update(props);
    expect(instance.candlestickSeries.setData.mock.lastCall[0]).toHaveLength(260);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(factory).toHaveBeenCalledTimes(1);
  });
  it('shares the mobile metadata row without losing the MA disclosure or rebuilding a selected chart',()=>{
    const actions=<button type="button">拡大・移動</button>;
    const props={priceData:longBars,smallScreen:true,researchMetaActions:actions};
    const view=setup(props),instance=instances[0];
    const summary=screen.getByText('移動平均・乖離率');
    expect(summary).toHaveAttribute('aria-label','移動平均線・株価の乖離率');
    expect(summary.closest('.chart-research-meta')).toContainElement(screen.getByRole('button',{name:'拡大・移動'}));
    fireEvent.click(summary);
    expect(summary.parentElement).toHaveAttribute('open');
    expect(summary.parentElement).toHaveTextContent('SMA50');
    expect(summary.parentElement).toHaveTextContent('SMA150');
    expect(summary.parentElement).toHaveTextContent('SMA200');
    fireEvent.click(screen.getByRole('button',{name:'1か月'}));
    const selected={...instance.timeScale.getVisibleLogicalRange()};
    view.update({...props,researchMetaActions:null,height:308});
    expect(screen.getByText('移動平均線・株価の乖離率').parentElement).toHaveAttribute('open');
    expect(instance.timeScale.getVisibleLogicalRange()).toEqual(selected);
    expect(factory).toHaveBeenCalledTimes(1);
  });
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
    const view=setup(props),instance=instances[0],observer=resizeObservers[0];
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
