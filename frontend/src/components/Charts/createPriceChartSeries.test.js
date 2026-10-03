import {beforeEach,describe,it,expect,vi} from 'vitest';
const {series,panes,charts}=vi.hoisted(()=>({series:[],panes:[],charts:[]}));
vi.mock('lightweight-charts',()=>({
  createChart:(_container,options)=>{
    const chart={options,
      addPane:vi.fn(()=>{const pane={setStretchFactor:vi.fn()};panes.push(pane);return pane;}),
      addSeries:(_type,options,paneIndex=0)=>{
        // Lightweight Charts clamps skipped indexes to the next available pane.
        // Model that behavior so a missing preceding pane fails layout checks.
        if(!panes.length)chart.addPane();
        const actualPane=Math.min(panes.length,paneIndex);
        if(actualPane===panes.length)chart.addPane();
        const scale={applyOptions:vi.fn()};
        const item={options,paneIndex:actualPane,moveToPane:vi.fn(),applyOptions:vi.fn(),priceScale:()=>scale};series.push(item);return item;
      },panes:()=>panes};
    charts.push(chart);return chart;
  },
  CrosshairMode:{Normal:0},CandlestickSeries:'candle',LineSeries:'line',HistogramSeries:'volume',createSeriesMarkers:()=>({}),
}));
import {createPriceChartSeries} from './createPriceChartSeries';
beforeEach(()=>{series.length=0;panes.length=0;charts.length=0;});
const defaults={width:1200,height:600,isDarkMode:false,interactive:true};
describe('research chart pane layout',()=>{
  it.each([false,true])('creates final panes and scale options without relocating series (compact=%s)',compact=>{
    const result=createPriceChartSeries({}, {...defaults,researchView:true,compact});
    expect(result.candlestickSeries.paneIndex).toBe(0);
    expect(result.rsLineSeries.paneIndex).toBe(1);
    expect(result.volumeSeries.paneIndex).toBe(2);
    expect(result.avgVolumeSeries.paneIndex).toBe(2);
    expect(panes).toHaveLength(3);
    expect(panes[0].setStretchFactor).toHaveBeenCalledExactlyOnceWith(compact ? .64 : .70);
    expect(panes[1].setStretchFactor).toHaveBeenCalledExactlyOnceWith(compact ? .15 : .12);
    expect(panes[2].setStretchFactor).toHaveBeenCalledExactlyOnceWith(compact ? .21 : .18);
    for(const item of series){expect(item.moveToPane).not.toHaveBeenCalled();expect(item.applyOptions).not.toHaveBeenCalled();}
    for(const key of ['sma50Series','sma150Series','sma200Series']){
      expect(result[key].paneIndex).toBe(0);
      expect(result[key].options.autoscaleInfoProvider()).toBeNull();
    }
    expect(result.sma150Series.options.lineStyle).toBe(2);
    expect(result.sma200Series.options.lineStyle).toBe(1);
    expect(result.candlestickSeries.options.autoscaleInfoProvider).toBeUndefined();
    expect(result.candlestickSeries.priceScale().applyOptions).toHaveBeenCalledExactlyOnceWith({scaleMargins:{top:.12,bottom:.12}});
    expect(result.rsLineSeries.priceScale().applyOptions).toHaveBeenCalledExactlyOnceWith({scaleMargins:{top:.18,bottom:.12},visible:false,autoScale:true,mode:0});
    expect(result.volumeSeries.priceScale().applyOptions).toHaveBeenCalledExactlyOnceWith({scaleMargins:{top:.2,bottom:0}});
    expect(charts[0].options.timeScale.lockVisibleTimeRangeOnResize).toBe(true);
  });
  it.each([[false,false],[false,true],[true,false],[true,true]])('excludes every constructed average from research autoscale (bookAnnotations=%s, compact=%s)',(bookAnnotations,compact)=>{
    const result=createPriceChartSeries({}, {...defaults,researchView:true,bookAnnotations,compact});
    for(const key of ['ema10Series','ema20Series','ema50Series','sma50Series','sma150Series','sma200Series']){
      if(result[key])expect(result[key].options.autoscaleInfoProvider()).toBeNull();
    }
    // All research views omit EMAs because the data effect clears them, even
    // when book annotations are off. SMA handles retain their scale exclusion.
    for(const key of ['ema10Series','ema20Series','ema50Series'])expect(result[key]).toBeNull();
    for(const key of ['sma50Series','sma150Series','sma200Series'])expect(result[key]).not.toBeNull();
    expect(result.epsLineSeries===null).toBe(bookAnnotations);
  });
  it('retains legacy single-pane ordering, margins, line styles and scale ownership',()=>{
    const result=createPriceChartSeries({},defaults);
    expect(panes).toHaveLength(1);
    expect(series.slice(0,3)).toEqual([result.volumeSeries,result.avgVolumeSeries,result.candlestickSeries]);
    for(const item of series)expect(item.paneIndex).toBe(0);
    for(const key of ['sma50Series','sma150Series','sma200Series']){
      expect(result[key].options.autoscaleInfoProvider).toBeUndefined();
      expect(result[key].options.lineStyle).toBeUndefined();
    }
    expect(result.candlestickSeries.priceScale().applyOptions).toHaveBeenCalledExactlyOnceWith({scaleMargins:{top:.05,bottom:.3}});
    expect(result.rsLineSeries.priceScale().applyOptions).toHaveBeenCalledExactlyOnceWith({scaleMargins:{top:.66,bottom:.22},visible:false});
    expect(result.volumeSeries.priceScale().applyOptions).toHaveBeenCalledExactlyOnceWith({scaleMargins:{top:.7,bottom:0}});
    expect(charts[0].options.timeScale.lockVisibleTimeRangeOnResize).toBe(false);
  });
  it('omits only permanently empty research guides and keeps legacy EMA/EPS handles',()=>{
    const research=createPriceChartSeries({}, {...defaults,researchView:true,bookAnnotations:true});
    expect([research.ema10Series,research.ema20Series,research.ema50Series,research.epsLineSeries,research.candleMarkers,research.rsMarkers]).toEqual([null,null,null,null,null,null]);
    for(const key of ['candlestickSeries','volumeSeries','avgVolumeSeries','sma50Series','sma150Series','sma200Series','rsLineSeries']) expect(research[key]).not.toBeNull();
    const legacy=createPriceChartSeries({},defaults);
    for(const key of ['ema10Series','ema20Series','ema50Series','epsLineSeries','candleMarkers','rsMarkers']) expect(legacy[key]).not.toBeNull();
    expect(createPriceChartSeries({}, {...defaults,researchView:true,bookAnnotations:false}).epsLineSeries).not.toBeNull();
  });
});
