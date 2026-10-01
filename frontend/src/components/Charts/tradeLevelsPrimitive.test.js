import { expect, it, vi } from 'vitest';
import { TradeLevelsPrimitive, tradeLevelRange } from './tradeLevelsPrimitive';
import { palettes } from '../../static/theme/tokens';

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
