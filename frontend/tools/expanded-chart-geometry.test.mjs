import { describe, expect, it } from 'vitest';
import { checkExpandedChartGeometry } from './expanded-chart-geometry.mjs';

const fitted = {
  plot: { height: 457, bottom: 845 }, date_axis: { height: 26 }, footer: { top: 845 },
  plot_visible: true, date_axis_visible: true, date_axis_hit: true, date_axis_canvases: 4,
  footer_visible: true, footer_hit: true, close_visible: true, close_hit: true,
  footer_controls: [{ text: '次の銘柄', visible: true, hit: true }],
};
const failuresFor = (overrides, fullChart = true) => {
  const failures = [];
  checkExpandedChartGeometry({ ...fitted, ...overrides }, (passes, message) => { if (!passes) failures.push(message); }, 'fixture', { fullChart });
  return failures;
};

describe('expanded chart browser acceptance checks', () => {
  it('accepts a real-sized axis above an unobscured footer', () => {
    expect(failuresFor({})).toEqual([]);
  });
  it('rejects the old clipped plot even when chart canvases exist', () => {
    const failures = failuresFor({ plot: { height: 540, bottom: 928 }, plot_visible: false, date_axis_visible: false, date_axis_hit: false });
    expect(failures).toEqual(expect.arrayContaining([
      expect.stringContaining('complete plot/date axis'), expect.stringContaining('extends behind footer'),
    ]));
  });
  it('rejects footer and close controls covered by a higher-stacked chart', () => {
    expect(failuresFor({ footer_hit: false, close_hit: false, footer_controls: [{ text: '次の銘柄', visible: true, hit: false }] })).toHaveLength(3);
  });
  it('allows intentional small-viewport scrolling, but never a collapsed plot or missing date axis', () => {
    expect(failuresFor({ plot_visible: false, date_axis_visible: false, date_axis_hit: false }, false)).toEqual([]);
    expect(failuresFor({ plot: { height: 0 }, date_axis_canvases: 0 }, false)).toHaveLength(2);
  });
});
