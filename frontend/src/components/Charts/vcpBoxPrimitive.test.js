import { it, expect, vi } from 'vitest';
import { VcpBoxPrimitive } from './vcpBoxPrimitive';

function attachPrimitive(boxes, candles, { width = 300, spacing = 8, timeToCoordinate, priceToCoordinate = p => 200 - p }) {
  const priceCoordinates = vi.fn(priceToCoordinate);
  const primitive = new VcpBoxPrimitive(boxes, candles);
  primitive.attached({
    chart: { timeScale: () => ({ width: () => width, options: () => ({ barSpacing: spacing }), timeToCoordinate }) },
    series: { priceToCoordinate: priceCoordinates },
    requestUpdate: vi.fn(),
  });
  return { view: primitive.paneViews()[0], priceCoordinates };
}

function drawCommands(view, width, ratio) {
  const commands = [];
  const ctx = new Proxy({ measureText: text => ({ width: text.length * 7 * ratio }) }, {
    get: (target, key) => key in target ? target[key] : (...args) => commands.push([key, ...args]),
    set: (target, key, value) => {
      commands.push(['set', key, value]);
      target[key] = value;
      return true;
    },
  });
  view.renderer().draw({ useBitmapCoordinateSpace: fn => fn({
    context: ctx, horizontalPixelRatio: ratio, verticalPixelRatio: ratio,
    bitmapSize: { width: width * ratio, height: 300 * ratio },
  }) });
  return commands;
}

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
it.each([1, 2])('keeps captions clear of wide candle bodies across repeated zoom changes at DPR %i', ratio => {
  const ctx = Object.fromEntries(['save','restore','setLineDash','strokeRect','fillRect','fillText'].map(key => [key,vi.fn()]));
  ctx.measureText = () => ({width:20 * ratio});
  let spacing = 8;
  const primitive = new VcpBoxPrimitive([{start:'a',end:'b',high:80,low:60,label:'C1'}], [{time:'c',high:180,low:10}]);
  primitive.attached({chart:{timeScale:()=>({width:()=>300,options:()=>({barSpacing:spacing}),timeToCoordinate:t=>({a:90,b:110,c:130})[t]})},series:{priceToCoordinate:p=>200-p},requestUpdate:vi.fn()});
  for (const nextSpacing of [8, 40, 8]) {
    spacing = nextSpacing;
    ctx.fillRect.mockClear(); ctx.fillText.mockClear();
    primitive.updateAllViews();
    primitive.paneViews()[0].renderer().draw({useBitmapCoordinateSpace:fn=>fn({context:ctx,horizontalPixelRatio:ratio,verticalPixelRatio:ratio,bitmapSize:{width:300 * ratio,height:300 * ratio}})});
    const expectedX = spacing === 40 ? 70 : 85;
    expect(ctx.fillRect.mock.calls).toEqual([[expectedX * ratio, 96 * ratio, 30 * ratio, 18 * ratio]]);
    for (const [x,y,width,height] of ctx.fillRect.mock.calls) expect(x < (130 + spacing / 2) * ratio && x + width > (130 - spacing / 2) * ratio && y < 190 * ratio && y + height > 20 * ratio).toBe(false);
    // The label moves to a safe horizontal slot and returns when zoom is reset.
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
  }
});

it.each([
  { spacing: 0.5, halfWidth: 0.5 },
  { spacing: 8, halfWidth: 4 },
  { spacing: 40, halfWidth: 20 },
  { spacing: undefined, halfWidth: 4 },
  { spacing: NaN, halfWidth: 4 },
  { spacing: Infinity, halfWidth: 4 },
  { spacing: 0, halfWidth: 4 },
  { spacing: -8, halfWidth: 4 },
])('converts only visible candle prices while retaining fractional edge slots ($spacing px)', ({ spacing, halfWidth }) => {
  const width = 300.25;
  const positions = [null, undefined, -Infinity, -halfWidth - 0.125, -halfWidth, 80.5, width + halfWidth, width + halfWidth + 0.125, Infinity];
  const candles = positions.map((_, time) => ({ time, high: -10 - time, low: -20 - time }));
  // Date-only history is supported as well as the chart's normalized time field.
  candles[4] = { date: 4, high: -14, low: -24 };
  const { view, priceCoordinates } = attachPrimitive(
    [{ start: 'start', end: 'end', high: -1, low: -2, label: 'Negative prices' }], candles,
    { width, spacing, timeToCoordinate: t => ({ start: 10, end: 50 })[t] ?? positions[t] },
  );
  expect(priceCoordinates.mock.calls).toEqual([[-14], [-24], [-15], [-25], [-16], [-26], [-1], [-2]]);
  expect(view._candles).toEqual([
    { x: -2 * halfWidth, y: 214, width: 2 * halfWidth, height: 10 },
    { x: 80.5 - halfWidth, y: 215, width: 2 * halfWidth, height: 10 },
    { x: width, y: 216, width: 2 * halfWidth, height: 10 },
  ]);
  expect(view._rects).toEqual([expect.objectContaining({ x1: 10, x2: 50, y1: 201, y2: 202 })]);
});

it('preserves null price rejection, flat or reversed candles, and existing non-finite coordinate semantics', () => {
  const candles = [
    { time: 0, high: null, low: 90 },
    { time: 1, high: 110, low: undefined },
    { time: 2, high: 100, low: 100 },
    { time: 3, high: 90, low: 110 },
    { time: 4, high: 100, low: 90 },
    { time: 5, high: NaN, low: Infinity },
  ];
  const { view, priceCoordinates } = attachPrimitive([{ start: 2, end: 3, high: 120, low: 80 }], candles, {
    timeToCoordinate: time => time === 4 ? NaN : time * 10,
    priceToCoordinate: price => price == null ? price : 200 - price,
  });
  expect(view._candles).toEqual([
    { x: 16, y: 100, width: 8, height: 1 },
    { x: 26, y: 90, width: 8, height: 20 },
    { x: NaN, y: 100, width: 8, height: 10 },
    { x: 46, y: NaN, width: 8, height: NaN },
  ]);
  expect(priceCoordinates).toHaveBeenCalledTimes(14);
});

const history = Array.from({ length: 504 }, (_, time) => ({ time, high: 100 + time / 100, low: 90 + time / 100 }));
const shapes = [
  { start: 400, end: 503, high: 110, low: 90, label: 'Base', color: '#012345' },
  { start: 480, end: 490, high: 108, low: 94, curve: true, recoveryDate: 500, recoveryHigh: 109, label: 'C1' },
  { start: 490, end: 490, high: 103, low: 103, arrow: true, label: 'Breakout' },
  { start: -300, end: -200, high: 110, low: 90, label: 'Outside' },
];
const viewports = [63, 126, 504].flatMap(count => [0.5, 4, 40].flatMap(spacing => [1, 2].map(ratio => ({ count, spacing, ratio }))));

it.each(viewports)('keeps all drawing commands and obstacle order with $count visible bars, $spacing px spacing, DPR $ratio', ({ count, spacing, ratio }) => {
  const width = count * spacing;
  const from = history.length - count;
  // At subpixel spacing, the minimum one-pixel candle slot touches the left
  // edge one bar earlier. All other cases start at the first visible bar.
  const firstObstacle = Math.max(0, from - (spacing === 0.5 ? 1 : 0));
  const options = { width, spacing, timeToCoordinate: time => (time - from) * spacing };
  const complete = attachPrimitive(shapes, history, options);
  const visible = attachPrimitive(shapes, history.slice(firstObstacle), options);
  expect(complete.view._candles).toEqual(visible.view._candles);
  expect(complete.view._candles).toHaveLength(history.length - firstObstacle);
  expect(complete.view._rects).toEqual(visible.view._rects);
  const commands = drawCommands(complete.view, width, ratio);
  expect(commands).toEqual(drawCommands(visible.view, width, ratio));
  expect(commands.some(([command]) => command === 'fillText')).toBe(true);
  // Nine shape-price conversions are unchanged; candle work follows only the
  // visible slots (135 for 63 bars, 261 for 126), instead of 1017 for all 504.
  expect(complete.priceCoordinates).toHaveBeenCalledTimes((history.length - firstObstacle) * 2 + 9);
});

it('retains shape geometry and labels with no candle history', () => {
  const { view, priceCoordinates } = attachPrimitive(shapes, [], { timeToCoordinate: time => time - 300 });
  expect(view._candles).toEqual([]);
  expect(priceCoordinates).toHaveBeenCalledTimes(9);
  expect(view._rects).toHaveLength(3);
  expect(drawCommands(view, 300, 1).filter(([command]) => command === 'fillText').map(([, label]) => label)).toEqual(['Base', 'C1', 'Breakout']);
});
