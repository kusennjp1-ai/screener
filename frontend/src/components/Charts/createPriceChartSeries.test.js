import {describe,it,expect,vi} from 'vitest';
const {series,panes}=vi.hoisted(()=>({series:[],panes:[0,1,2].map(()=>({setStretchFactor:vi.fn()}))}));
vi.mock('lightweight-charts',()=>({
  createChart:()=>({addSeries:(_type,options)=>{const item={options,moveToPane:vi.fn(),applyOptions:vi.fn(),priceScale:()=>({applyOptions:vi.fn()})};series.push(item);return item;},panes:()=>panes}),
  CrosshairMode:{Normal:0},CandlestickSeries:'candle',LineSeries:'line',HistogramSeries:'volume',createSeriesMarkers:()=>({}),
}));
import {createPriceChartSeries} from './createPriceChartSeries';
describe('research chart pane layout',()=>{
  it('isolates volume and relative strength, and excludes distant averages from candle autoscale',()=>{
    const result=createPriceChartSeries({}, {width:1200,height:600,isDarkMode:false,interactive:true,researchView:true});
    expect(result.rsLineSeries.moveToPane).toHaveBeenCalledWith(1);
    expect(result.volumeSeries.moveToPane).toHaveBeenCalledWith(2);
    expect(result.avgVolumeSeries.moveToPane).toHaveBeenCalledWith(2);
    expect(panes[0].setStretchFactor).toHaveBeenCalledWith(.70);
    const options=result.sma200Series.applyOptions.mock.calls[0][0];
    expect(options.autoscaleInfoProvider()).toBeNull();
    expect(result.candlestickSeries.applyOptions).not.toHaveBeenCalled();
  });
  it('omits only permanently empty research guides and keeps legacy EMA/EPS handles',()=>{
    const options={width:1200,height:600,isDarkMode:false,interactive:true};
    const research=createPriceChartSeries({}, {...options,researchView:true,bookAnnotations:true});
    expect([research.ema10Series,research.ema20Series,research.ema50Series,research.epsLineSeries,research.candleMarkers,research.rsMarkers]).toEqual([null,null,null,null,null,null]);
    for(const key of ['candlestickSeries','volumeSeries','avgVolumeSeries','sma50Series','sma150Series','sma200Series','rsLineSeries']) expect(research[key]).not.toBeNull();
    const legacy=createPriceChartSeries({},options);
    for(const key of ['ema10Series','ema20Series','ema50Series','epsLineSeries','candleMarkers','rsMarkers']) expect(legacy[key]).not.toBeNull();
    expect(createPriceChartSeries({}, {...options,researchView:true,bookAnnotations:false}).epsLineSeries).not.toBeNull();
  });
});
