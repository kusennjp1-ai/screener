// The daily brief's view model, as one import path. Frozen in round 1: each part lives in its own
// module (one owner each) and this barrel only re-exports them, so `./briefModel` keeps working for
// every screen, test and node tool that imports it.
//   briefCandidate   the trend template, a candidate's position, the order, the focus pool, the list filters
//   positionSizing   the position plan
//   briefSell        the sell checks and the sell chip
//   briefChartModel  the stage, the RS line's new high, the VCP footprint, the up/down volume
//   briefEnvironment the market-environment rules, the verdict tone, the market-trends state, FTD wording
//   briefShared      the helpers every module shares
export * from './briefCandidate';
export * from './positionSizing';
export * from './briefSell';
export * from './briefChartModel';
export * from './briefEnvironment';
export { shortDate, latestKnown, sentence, bare } from './briefShared';

// The fundamentals card's view model lives beside the rules so node tools can use it too.
export { code33Parts, code33Explain, code33ChipView, fundamentalTiles, fundamentalsCoverage, fundamentalsSource, quarterReason, secStatus } from '../fundamentalsExplain.js';
