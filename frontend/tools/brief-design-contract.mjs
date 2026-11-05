// The Design Acceptance contract for the daily brief (the whole static app).
// Shared by the browser harness (design-review.mjs) and the gate
// (check-design-review.mjs) so both read the same groups, captures and budgets.
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fontSizes, radii } from '../src/static/theme/tokens.js';

export const REPORT_SCHEMA = 'brief-design-review-v1';

/** Phone first. Mobile groups emulate a touch phone at device pixel ratio 2. */
export const DESIGN_GROUPS = Object.freeze([
  { width: 390, height: 844, theme: 'dark', mobile: true },
  { width: 390, height: 844, theme: 'light', mobile: true },
  { width: 1440, height: 900, theme: 'dark', mobile: false },
  { width: 1440, height: 900, theme: 'light', mobile: false },
].map(group => Object.freeze({ ...group, key: `${group.width}/${group.theme}` })));

/** Every group captures every screen. `path` is the address the screen ends on. */
export const CAPTURES = Object.freeze([
  { screen: 'today', path: '#/brief', how: 'open #/brief' },
  { screen: 'list', path: '#/brief/list', how: 'open #/brief/list' },
  { screen: 'list-near', path: '#/brief/list', how: 'press the 「あと1条件」 filter' },
  { screen: 'market', path: '#/brief/market', how: 'open #/brief/market' },
  { screen: 'stock', path: '#/brief/stock/:SYMBOL', how: 'click the first candidate row' },
  { screen: 'stock-weekly', path: '#/brief/stock/:SYMBOL', how: 'switch the chart range to 週足' },
  { screen: 'watch', path: '#/brief/watch', how: 'add the opened stock with ☆, then open #/brief/watch' },
].map(Object.freeze));

export const captureKey = (screen, group) => `${screen}/${group.width}/${group.theme}`;
export const requiredCaptureKeys = () => DESIGN_GROUPS.flatMap(group => CAPTURES.map(({ screen }) => captureKey(screen, group)));

const ascending = values => Object.freeze([...values].sort((a, b) => a - b));
/** The type and corner scales come from the theme tokens, never from a copy. */
export const FONT_SIZES = ascending(fontSizes);
export const RADII = ascending(radii);
/** Effective hit-box minimum by viewport width (range inputs excluded). */
export const minimumTarget = width => width < 768 ? 44 : 24;
/** Fixed chrome (top bar + bottom dock) budget on the phone. */
export const MOBILE_CHROME_BUDGET = 110;
/** A stock opened from a row must draw at least this many daily candles. */
export const MIN_CANDLES = 60;
/** With reduced motion nothing may still animate this long after opening a stock. */
export const REDUCED_MOTION_SETTLE_MS = 400;
export const AXE_TAGS = Object.freeze(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']);

/** Retired addresses and the brief route each must land on. `X` is a real symbol. */
export const LEGACY_REDIRECTS = Object.freeze([
  ['#/', '#/brief'],
  ['#/compare', '#/brief/list'],
  ['#/scan', '#/brief/list'],
  ['#/breadth', '#/brief/market'],
  ['#/groups', '#/brief/market'],
  ['#/themes', '#/brief/market'],
  ['#/?symbol=X', '#/brief/stock/X'],
].map(Object.freeze));

/**
 * Timing under CDP CPU 4x, 3 runs per width, median. The first-candidate and
 * tab-switch budgets are the former harness's exact P1 limits for the comparable
 * operations (initial candidates 3500 ms, in-app switch 400 ms, longest initial
 * task 200 ms). Opening a stock draws a chart and has no former equivalent; it uses
 * a 1000 ms navigation budget. Overruns are deferred warnings under the owner's
 * timing approval and never objective failures.
 */
export const TIMING = Object.freeze({
  cpu_rate: 4,
  runs: 3,
  widths: Object.freeze([390, 1440]),
  budgets_ms: Object.freeze({ first_candidate_ms: 3500, stock_open_ms: 1000, tab_switch_ms: 400, longest_initial_task_ms: 200 }),
});

const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length === values.length && sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

/** Medians of the runs and the deferred warnings for one width. Missing runs warn too. */
export function summarizeTiming(width, runs) {
  const medians = Object.fromEntries(Object.keys(TIMING.budgets_ms).map(metric => [metric, runs.length === TIMING.runs ? median(runs.map(run => run[metric])) : null]));
  const warnings = Object.entries(TIMING.budgets_ms).flatMap(([metric, budget]) => {
    const value = medians[metric];
    if (value === null) return [`${width}: ${metric} not measured in ${TIMING.runs} complete runs`];
    return value > budget ? [`${width}: ${metric} median ${Math.round(value)}ms > ${budget}ms`] : [];
  });
  return { medians, warnings };
}

/**
 * Objective evidence every gate requires from a brief Design report: the schema,
 * every required capture with a non-empty PNG, completed groups and no failures.
 * Throws on anything missing; returns the deferred timing warnings.
 */
export async function verifyBriefReport(report, output) {
  if (report?.schema !== REPORT_SCHEMA) throw Error(`Design report schema must be ${REPORT_SCHEMA}; got ${report?.schema ?? 'none'}`);
  if (!Array.isArray(report.screens) || !Array.isArray(report.failures) || !Array.isArray(report.timing_warnings) || !Array.isArray(report.groups)) {
    throw Error('Design report lacks its screens, failures, groups or timing warnings');
  }
  if (!/^[a-f0-9]{40}$/.test(report.commit || '')) throw Error('Design report lacks the measured commit');
  const problems = [];
  for (const group of DESIGN_GROUPS) {
    if (report.groups.find(item => item.key === group.key)?.completed !== true) problems.push(`${group.key}: group did not complete`);
  }
  for (const key of requiredCaptureKeys()) {
    const screens = report.screens.filter(screen => screen.key === key);
    if (screens.length !== 1) { problems.push(`${key}: ${screens.length ? 'captured more than once' : 'required capture missing'}`); continue; }
    const name = screens[0].screenshot;
    if (typeof name !== 'string' || !/^[a-z0-9-]+-\d+-(dark|light)\.png$/.test(name)) { problems.push(`${key}: invalid screenshot name`); continue; }
    const size = await stat(resolve(output, name)).then(info => info.isFile() ? info.size : 0, () => 0);
    if (!size) problems.push(`${key}: screenshot ${name} is missing or empty`);
  }
  if (problems.length) throw Error(`Design captures are incomplete: ${problems.join('; ')}`);
  if (report.failures.length) throw Error(`Objective design failures remain (${report.failures.length}): ${report.failures.slice(0, 20).join('; ')}`);
  return report.timing_warnings;
}
