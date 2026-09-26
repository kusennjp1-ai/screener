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
