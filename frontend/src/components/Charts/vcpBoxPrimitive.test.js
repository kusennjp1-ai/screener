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
