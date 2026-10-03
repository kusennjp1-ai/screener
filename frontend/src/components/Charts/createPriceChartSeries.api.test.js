import {afterEach,describe,expect,it,vi} from 'vitest';
import {createPriceChartSeries} from './createPriceChartSeries';

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
