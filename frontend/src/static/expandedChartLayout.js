// Keep price, RS and volume panes readable when the chrome alone occupies most
// of a short viewport. The modal's content then scrolls beneath its own footer.
export const MIN_EXPANDED_CHART_HEIGHT = 300;
export const MOBILE_EXPANDED_CHART_HEIGHT = 420;

export function fitExpandedChartHeight(contentHeight, plotOffset) {
  if (!Number.isFinite(contentHeight) || !Number.isFinite(plotOffset) || contentHeight <= 0) {
    return MIN_EXPANDED_CHART_HEIGHT;
  }
  // The height includes the date axis. Rounding down keeps fractional CSS
  // pixels from putting its bottom edge behind the footer.
  return Math.max(MIN_EXPANDED_CHART_HEIGHT, Math.floor(contentHeight - Math.max(0, plotOffset)));
}
