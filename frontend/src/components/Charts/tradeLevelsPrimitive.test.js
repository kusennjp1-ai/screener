import { expect, it, vi } from 'vitest';
import { TradeLevelsPrimitive, tradeLevelRange } from './tradeLevelsPrimitive';
import { palettes } from '../../static/theme/tokens';
import { money } from '../../static/positionGeometry';

it('extends visual range to the exact supplied stop and ceiling without inventing levels', () => {
  expect(tradeLevelRange({ pivot: 100, upper: 103, stop: 93.4 })).toEqual({ priceRange: { minValue: 93.4, maxValue: 103 } });
  expect(tradeLevelRange({ pivot: null, upper: undefined, stop: NaN })).toBeNull();
  expect(tradeLevelRange({ pivot: 100 })).toEqual({ priceRange: { minValue: 100, maxValue: 100 } });
});
it('draws the zone and dashed stop from canonical prices and labels the price axis', () => {
  const levels = { pivot: 100, upper: 103, stop: 93.4 }, palette = palettes.dark;
  const primitive = new TradeLevelsPrimitive(levels, palette);
  const ctx = Object.fromEntries(['save','restore','fillRect','setLineDash','beginPath','moveTo','lineTo','stroke'].map(name => [name, vi.fn()]));
  primitive.attached({ series: { priceToCoordinate: price => 200 - price } });
  primitive.paneViews()[0].renderer().draw({ useBitmapCoordinateSpace: fn => fn({ context: ctx, horizontalPixelRatio: 1, verticalPixelRatio: 1, bitmapSize: { width: 300, height: 200 } }) });
  expect(ctx.fillRect).toHaveBeenCalledWith(0, 97, 300, 3);
  expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
  expect(ctx.moveTo).toHaveBeenCalledWith(0, 106.6);
  expect(primitive.priceAxisViews().map(view => view.text())).toEqual(['上限 103.00', 'ピボット 100.00', '損切り例 93.40']);
  expect(primitive.priceAxisViews().every(view => !('fixedCoordinate' in view))).toBe(true);
});

it.each([
  [31.9 * 1.05, '33.50'], [1.005, '1.01'], [2.675, '2.68'], [1234.567, '1,234.57'],
])('matches entry-card price text at rounding boundaries for %s', (price, expected) => {
  const primitive = new TradeLevelsPrimitive({ pivot: price, upper: price, stop: price }, palettes.dark);
  expect(money(price)).toBe(`$${expected}`);
  expect(primitive.priceAxisViews().map(view => view.text())).toEqual([
    `上限 ${expected}`, `ピボット ${expected}`, `損切り例 ${expected}`,
  ]);
});

it('formats BWIN prices without rounding stored levels, coordinates or autoscale bounds', () => {
  const levels = { pivot: 31.9, upper: 31.9 * 1.05, stop: 31.9 * 0.95 };
  const priceToCoordinate = vi.fn(price => price);
  const primitive = new TradeLevelsPrimitive(levels, palettes.dark);
  primitive.attached({ series: { priceToCoordinate } });
  expect(primitive.priceAxisViews().map(view => view.text())).toEqual(['上限 33.50', 'ピボット 31.90', '損切り例 30.30']);
  expect(primitive.levels).toBe(levels);
  expect(primitive.priceAxisViews().map(view => view.coordinate())).toEqual([levels.upper, levels.pivot, levels.stop]);
  expect(priceToCoordinate.mock.calls.map(([price]) => price)).toEqual([levels.upper, levels.pivot, levels.stop]);
  expect(primitive.autoscaleInfo()).toEqual({ priceRange: { minValue: levels.stop, maxValue: levels.upper } });
});

it.each([null, undefined, NaN, Infinity, -Infinity, 0, -0, -1.005, '42'])(
  'keeps invalid or nonpositive reference labels hidden for %s', price => {
    const primitive = new TradeLevelsPrimitive({ pivot: price, upper: price, stop: price }, palettes.dark);
    expect(primitive.priceAxisViews()).toEqual([]);
    expect(primitive.autoscaleInfo()).toBeNull();
  },
);

it('can move labels out of the axis without changing the zone, stop, coordinates or autoscale',()=>{
  const levels={pivot:31.9,upper:31.9*1.05,stop:31.9*.95};
  const ordinary=new TradeLevelsPrimitive(levels,palettes.light);
  const outside=new TradeLevelsPrimitive(levels,palettes.light,{axisLabels:false});
  const render=primitive=>{
    const ctx=Object.fromEntries(['save','restore','fillRect','setLineDash','beginPath','moveTo','lineTo','stroke'].map(name=>[name,vi.fn()]));
    primitive.attached({series:{priceToCoordinate:price=>100-price}});
    primitive.paneViews()[0].renderer().draw({useBitmapCoordinateSpace:fn=>fn({context:ctx,horizontalPixelRatio:1,verticalPixelRatio:1,bitmapSize:{width:300,height:200}})});
    return Object.fromEntries(Object.entries(ctx).filter(([,value])=>typeof value==='function').map(([name,spy])=>[name,spy.mock.calls]));
  };
  expect(outside.priceAxisViews()).toEqual([]);
  expect(ordinary.priceAxisViews()).toHaveLength(3);
  expect(render(outside)).toEqual(render(ordinary));
  expect(outside.levels).toBe(levels);
  expect(outside.autoscaleInfo()).toEqual(ordinary.autoscaleInfo());
});
