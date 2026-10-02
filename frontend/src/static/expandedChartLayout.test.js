import { describe, expect, it } from 'vitest';
import { fitExpandedChartHeight, MIN_EXPANDED_CHART_HEIGHT, MOBILE_EXPANDED_CHART_HEIGHT } from './expandedChartLayout';

describe('expanded chart viewport fit', () => {
  it('uses actual header/footer space and plot chrome at both desktop heights', () => {
    // 56px header and 55px footer; 332px summary, legend and chart controls.
    expect(fitExpandedChartHeight(900 - 56 - 55, 332)).toBe(457);
    expect(fitExpandedChartHeight(760 - 56 - 55, 332)).toBe(317);
  });
  it('accounts for a taller source warning, wrapping or opened disclosure', () => {
    expect(fitExpandedChartHeight(789, 300)).toBe(489);
    expect(fitExpandedChartHeight(789, 348)).toBe(441);
    expect(fitExpandedChartHeight(789, 420)).toBe(369);
  });
  it('keeps a readable scrolling plot when a short screen or disclosure cannot fit', () => {
    expect(fitExpandedChartHeight(380, 332)).toBe(MIN_EXPANDED_CHART_HEIGHT);
    expect(fitExpandedChartHeight(380, 500)).toBe(MIN_EXPANDED_CHART_HEIGHT);
    expect(MOBILE_EXPANDED_CHART_HEIGHT).toBe(420);
  });
  it('rounds fractional dimensions inward and tolerates a not-yet-measurable layout', () => {
    expect(fitExpandedChartHeight(789.5, 332.8)).toBe(456);
    expect(fitExpandedChartHeight(0, 332)).toBe(MIN_EXPANDED_CHART_HEIGHT);
    expect(fitExpandedChartHeight(NaN, 332)).toBe(MIN_EXPANDED_CHART_HEIGHT);
    expect(fitExpandedChartHeight(789, -2)).toBe(789);
  });
});
