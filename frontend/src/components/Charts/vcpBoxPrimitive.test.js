import { it, expect, vi } from 'vitest';
import { VcpBoxPrimitive } from './vcpBoxPrimitive';
it('renders measured labels and contraction strokes and skips offscreen shapes', () => {
  const ctx = Object.fromEntries(['fillRect','save','strokeRect','restore','setLineDash','beginPath','moveTo','lineTo','stroke','fillText'].map(k => [k, vi.fn()]));
  ctx.measureText = text => ({ width: text.length * 7 });
  const positions = { a: 20, b: 30, c: -200, d: -100 };
  const primitive = new VcpBoxPrimitive([{ start:'a',end:'b',high:100,low:80,label:'C1 −20%',color:'#4dd0e1',diagonal:true }, {start:'c',end:'d',high:100,low:80,label:'hidden'}]);
  primitive.attached({chart:{timeScale:()=>({width:()=>300,timeToCoordinate:t=>positions[t]})},series:{priceToCoordinate:p=>200-p},requestUpdate:vi.fn()});
  primitive.paneViews()[0].renderer().draw({ useBitmapCoordinateSpace: fn => fn({ context:ctx,horizontalPixelRatio:1,verticalPixelRatio:1,bitmapSize:{width:300,height:300} }) });
  expect(ctx.fillText).toHaveBeenCalledTimes(1); expect(ctx.fillText.mock.calls[0][0]).toBe('C1 −20%');
  expect(ctx.moveTo).toHaveBeenCalledWith(20,100); expect(ctx.lineTo).toHaveBeenCalledWith(30,120);
  primitive.detached(); primitive.updateAllViews();
});

it('draws recovery curves through measured coordinates and an observed-event arrow', () => {
  const ctx = Object.fromEntries(['fillRect','save','strokeRect','restore','setLineDash','beginPath','moveTo','lineTo','stroke','fillText','bezierCurveTo'].map(k => [k, vi.fn()]));
  ctx.measureText = text => ({width:text.length*7});
  const positions = {a:20,b:60,c:100};
  const primitive = new VcpBoxPrimitive([{start:'a',end:'b',high:100,low:80,curve:true,recoveryDate:'c',recoveryHigh:98,label:'C1'}, {start:'c',end:'c',high:102,low:102,arrow:true,label:'上抜け'}]);
  primitive.attached({chart:{timeScale:()=>({width:()=>300,timeToCoordinate:t=>positions[t]})},series:{priceToCoordinate:p=>200-p},requestUpdate:vi.fn()});
  primitive.paneViews()[0].renderer().draw({useBitmapCoordinateSpace: fn => fn({context:ctx,horizontalPixelRatio:1,verticalPixelRatio:1,bitmapSize:{width:300,height:300}})});
  expect(ctx.bezierCurveTo).toHaveBeenCalledWith(40,100,40,120,60,120);
  expect(ctx.bezierCurveTo).toHaveBeenCalledWith(80,120,80,102,100,102);
  expect(ctx.strokeRect).not.toHaveBeenCalled();
  expect(ctx.fillText).toHaveBeenCalledTimes(2);
});
it('uses one CSS pixel and 0.55 opacity for detailed contraction curves at double density', () => {
  const strokes = [];
  const ctx = Object.fromEntries(['save','restore','setLineDash','beginPath','moveTo','bezierCurveTo','fillRect','fillText'].map(k => [k, vi.fn()]));
  ctx.stroke = () => strokes.push({width:ctx.lineWidth,alpha:ctx.globalAlpha});
  ctx.measureText = () => ({width:20});
  const primitive = new VcpBoxPrimitive([{start:'a',end:'b',high:100,low:80,curve:true,recoveryDate:'c',recoveryHigh:98}]);
  primitive.attached({chart:{timeScale:()=>({width:()=>300,timeToCoordinate:t=>({a:20,b:60,c:100})[t]})},series:{priceToCoordinate:p=>200-p},requestUpdate:vi.fn()});
  primitive.paneViews()[0].renderer().draw({useBitmapCoordinateSpace:fn=>fn({context:ctx,horizontalPixelRatio:2,verticalPixelRatio:2,bitmapSize:{width:600,height:600}})});
  expect(strokes).toEqual([{width:2,alpha:0.55}]);
});
it('keeps captions clear of wide candle bodies after zooming in', () => {
  const ctx = Object.fromEntries(['save','restore','setLineDash','strokeRect','fillRect','fillText'].map(key => [key,vi.fn()]));
  ctx.measureText = () => ({width:20});
  const primitive = new VcpBoxPrimitive([{start:'a',end:'b',high:80,low:60,label:'C1'}], [{time:'c',high:180,low:10}]);
  primitive.attached({chart:{timeScale:()=>({width:()=>300,options:()=>({barSpacing:40}),timeToCoordinate:t=>({a:90,b:110,c:130})[t]})},series:{priceToCoordinate:p=>200-p},requestUpdate:vi.fn()});
  primitive.paneViews()[0].renderer().draw({useBitmapCoordinateSpace:fn=>fn({context:ctx,horizontalPixelRatio:1,verticalPixelRatio:1,bitmapSize:{width:300,height:300}})});
  for (const [x,y,width,height] of ctx.fillRect.mock.calls) expect(x < 150 && x + width > 110 && y < 190 && y + height > 20).toBe(false);
  // The label is retained in another safe horizontal slot, not over the body.
  expect(ctx.fillText).toHaveBeenCalledTimes(1);
});

it('skips offscreen candle price conversions but keeps partially visible bar slots', () => {
  const positions = { a: -20.001, b: -20, c: 0, d: 300, e: 320, f: 320.001, g: null };
  const candles = Object.keys(positions).map((time, i) => ({ time, high: 100 + i, low: 80 + i }));
  const priceToCoordinate = vi.fn(price => 200 - price);
  const primitive = new VcpBoxPrimitive([{ start: 'c', end: 'd', high: 150, low: 120, label: 'C1' }], candles);
  primitive.attached({
    chart: { timeScale: () => ({ width: () => 300, options: () => ({ barSpacing: 40 }), timeToCoordinate: time => positions[time] }) },
    series: { priceToCoordinate }, requestUpdate: vi.fn(),
  });
  expect(priceToCoordinate.mock.calls.map(([price]) => price)).toEqual([101, 81, 102, 82, 103, 83, 104, 84, 150, 120]);
  expect(primitive.paneViews()[0]._candles.map(candle => candle.x)).toEqual([-40, -20, 280, 300]);
});
