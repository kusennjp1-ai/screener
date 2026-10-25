// A two-row thumb toolbar is permitted only when its measured action row is
// present. Count BOTH rows as occlusion; retain the original budget elsewhere.
export function mobileChromeBudget(metrics) {
  const bar=metrics.mobileActionBar;
  if(!bar)return 110;
  if(![bar.top,bar.bottom,bar.height,bar.width].every(Number.isFinite)
    ||bar.height<44||bar.height>54||Math.abs(bar.bottom-bar.top-bar.height)>.1
    ||bar.width<300||bar.top<metrics.viewport.height-metrics.bottomNavHeight-1
    ||bar.bottom>metrics.viewport.height)return 110;
  return 160;
}
