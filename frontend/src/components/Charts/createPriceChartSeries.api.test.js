import {afterEach,describe,expect,it,vi} from 'vitest';
import {createPriceChartSeries} from './createPriceChartSeries';
import {createChart} from 'lightweight-charts';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('Lightweight Charts final-pane construction',()=>{
  it.each([[false,false],[false,true],[true,false],[true,true]])('uses real pane indexes and final options (bookAnnotations=%s, compact=%s)',(bookAnnotations,compact)=>{
    vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
    vi.stubGlobal('requestAnimationFrame',()=>1);
    vi.stubGlobal('cancelAnimationFrame',()=>{});
    // This integration exercises the real model API, not canvas rendering.
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
    const container=document.createElement('div');
    document.body.appendChild(container);
    const result=createPriceChartSeries(container,{width:800,height:440,isDarkMode:true,interactive:true,researchView:true,bookAnnotations,compact});
    expect(result.chart.options().addDefaultPane).toBe(false);
    expect(result.chart.panes()).toHaveLength(3);
    expect(result.candlestickSeries.getPane().paneIndex()).toBe(0);
    expect(result.rsLineSeries.getPane().paneIndex()).toBe(1);
    expect(result.volumeSeries.getPane().paneIndex()).toBe(2);
    expect(result.avgVolumeSeries.getPane().paneIndex()).toBe(2);
    expect(result.sma50Series.getPane().paneIndex()).toBe(0);
    expect(result.sma150Series.getPane().paneIndex()).toBe(0);
    expect(result.sma200Series.getPane().paneIndex()).toBe(0);
    expect(result.chart.panes().map(pane=>pane.getStretchFactor())).toEqual(compact?[.64,.15,.21]:[.70,.12,.18]);
    expect(result.candlestickSeries.priceScale().options().scaleMargins).toEqual({top:.12,bottom:.12});
    expect(result.candlestickSeries.priceScale().options()).toMatchObject({mode:1,entireTextOnly:true});
    expect(result.rsLineSeries.priceScale().options().scaleMargins).toEqual({top:.18,bottom:.12});
    expect(result.rsLineSeries.priceScale().options()).toMatchObject({autoScale:true,mode:0,visible:false});
    expect(result.volumeSeries.priceScale().options().scaleMargins).toEqual({top:.2,bottom:0});
    expect(result.sma150Series.options().lineStyle).toBe(2);
    expect(result.sma200Series.options().lineStyle).toBe(1);
    for(const key of ['ema10Series','ema20Series','ema50Series','sma50Series','sma150Series','sma200Series']){
      if(result[key])expect(result[key].options().autoscaleInfoProvider()).toBeNull();
    }
    result.chart.remove();container.remove();
  });
});

it('avoids allocating the library’s temporary empty-pane canvases before explicit panes',()=>{
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
  vi.stubGlobal('requestAnimationFrame',()=>1);
  vi.stubGlobal('cancelAnimationFrame',()=>{});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  const counts=[];
  for(const addDefaultPane of [true,false]){
    const container=document.createElement('div');document.body.appendChild(container);
    const chart=createChart(container,{width:800,height:440,addDefaultPane});
    counts.push(container.querySelectorAll('canvas').length);
    expect(chart.panes()).toHaveLength(addDefaultPane?1:0);
    chart.remove();container.remove();
  }
  expect(counts[1]).toBeLessThan(counts[0]);
});

it.each(['daily','weekly'])('keeps native %s ticks and LastBar price line without research axis tags',async timeframe=>{
  const {TradeLevelsPrimitive}=await import('./tradeLevelsPrimitive');
  const {transformToCandlestickData}=await import('./candlestickData');
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
  const frames=[];
  vi.stubGlobal('requestAnimationFrame',callback=>{frames.push(callback);return frames.length;});
  vi.stubGlobal('cancelAnimationFrame',()=>{});
  const flushFrames=()=>{for(let count=0;frames.length&&count<10;count++)frames.shift()(performance.now());expect(frames).toHaveLength(0);};
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(){
    return new Proxy({canvas:this,measureText:text=>({width:String(text).length*6,actualBoundingBoxAscent:8,actualBoundingBoxDescent:2}),
      createLinearGradient:()=>({addColorStop(){}})}, {get:(target,key)=>key in target?target[key]:()=>{}});
  });
  const container=document.createElement('div');document.body.appendChild(container);
  const result=createPriceChartSeries(container,{width:390,height:300,isDarkMode:false,interactive:true,researchView:true});
  const raw=Array.from({length:40},(_,index)=>{
    const date=new Date(Date.UTC(2026,0,1)+index*7*86400000).toISOString().slice(0,10);
    const close=index===20?110:index===39?100:90;
    return {date,open:close,high:close+10,low:close-10,close,volume:1000};
  });
  const data=transformToCandlestickData(raw,timeframe,{includeEMA:false}).candlesticks;
  const levels={pivot:98,upper:105,stop:90};
  const primitive=new TradeLevelsPrimitive(levels,{zone:'#245',neg:'#933',panel:'#fff'},{axisLabels:false});
  result.candlestickSeries.setData(data);result.candlestickSeries.attachPrimitive(primitive);
  result.chart.timeScale().fitContent();flushFrames();
  expect(result.candlestickSeries.options()).toMatchObject({lastValueVisible:false,priceLineVisible:true,priceLineSource:0,priceFormat:{type:'price',minMove:.01}});
  expect(result.candlestickSeries.options().priceFormat.tickmarksFormatter).toBeUndefined();
  expect(primitive.priceAxisViews()).toEqual([]);
  expect(primitive.levels).toBe(levels);
  expect(primitive.autoscaleInfo()).toEqual({priceRange:{minValue:90,maxValue:105}});
  expect(result.candlestickSeries.data()).toEqual(data);
  expect(data.at(-1)).toMatchObject({time:raw.at(-1).date,close:100});
  result.chart.timeScale().setVisibleLogicalRange({from:8,to:19.5});flushFrames();
  expect(result.chart.timeScale().getVisibleLogicalRange().to).toBeLessThan(data.length-1);
  expect(result.candlestickSeries.lastValueData(false)).toMatchObject({noData:false,price:110});
  expect(result.candlestickSeries.lastValueData(true)).toMatchObject({noData:false,price:100});
  expect(result.candlestickSeries.options().priceLineSource).toBe(0);
  expect(result.candlestickSeries.data().at(-1)).toMatchObject({time:raw.at(-1).date,close:100});
  result.candlestickSeries.setData([]);expect(result.candlestickSeries.lastValueData(true)).toEqual({noData:true});
  result.chart.remove();container.remove();
});

it('retains the native current-price tag and partial-tick default outside research mode',()=>{
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
  vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',()=>{});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  const container=document.createElement('div');document.body.appendChild(container);
  const result=createPriceChartSeries(container,{width:800,height:440,isDarkMode:false,interactive:true,researchView:false});
  expect(result.candlestickSeries.options()).toMatchObject({lastValueVisible:true,priceLineVisible:true,priceLineSource:0,priceFormat:{type:'price',minMove:.01}});
  expect(result.candlestickSeries.priceScale().options().entireTextOnly).toBe(false);
  result.chart.remove();container.remove();
});
