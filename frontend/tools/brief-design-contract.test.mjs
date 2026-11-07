// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { legacyTarget } from '../src/static/legacyRoutes.js';
import { fontSizes, radii } from '../src/static/theme/tokens.js';
import { CAPTURES, DESIGN_GROUPS, FONT_SIZES, LEGACY_REDIRECTS, RADII, REPORT_SCHEMA, TIMING, minimumTarget, requiredCaptureKeys, summarizeTiming } from './brief-design-contract.mjs';

const harness = readFileSync(new URL('./design-review.mjs', import.meta.url), 'utf8');
const checker = readFileSync(new URL('./check-design-review.mjs', import.meta.url), 'utf8');

describe('brief Design Acceptance contract', () => {
  it('measures the phone first in both themes, then the desktop', () => {
    expect(DESIGN_GROUPS.map(group => group.key)).toEqual(['390/dark', '390/light', '1440/dark', '1440/light']);
    expect(DESIGN_GROUPS.filter(group => group.mobile).map(group => group.width)).toEqual([390, 390]);
    expect(minimumTarget(390)).toBe(44);
    expect(minimumTarget(1440)).toBe(24);
  });

  it('requires every brief screen in every group', () => {
    expect(CAPTURES.map(capture => capture.screen)).toEqual(['today', 'list', 'list-near', 'market', 'stock', 'stock-weekly', 'watch']);
    const keys = requiredCaptureKeys();
    expect(keys).toHaveLength(28);
    expect(new Set(keys).size).toBe(28);
    expect(keys).toContain('stock-weekly/390/light');
  });

  it('reads the type and corner scales from the theme tokens', () => {
    expect(FONT_SIZES).toEqual([11, 12, 13, 14, 16, 20, 26, 34, 42]);
    expect(RADII).toEqual([4, 8, 12, 16]);
    expect([...FONT_SIZES].sort()).toEqual([...fontSizes].sort());
    expect([...RADII].sort()).toEqual([...radii].sort());
  });

  it('checks exactly the redirects the app routes', () => {
    for (const [legacy, target] of LEGACY_REDIRECTS) {
      const address = new URL(legacy.replace('X', 'NVDA').slice(1), 'http://brief.test');
      expect(`#${legacyTarget(address.pathname, address.search)}`).toBe(target.replace('X', 'NVDA'));
    }
  });

  it('turns timing overruns and missing runs into warnings, never passes', () => {
    const run = { first_candidate_ms: 900, stock_open_ms: 300, tab_switch_ms: 200, longest_initial_task_ms: 80 };
    expect(summarizeTiming(390, [run, run, run]).warnings).toEqual([]);
    const slow = summarizeTiming(1440, [run, { ...run, tab_switch_ms: 500 }, { ...run, tab_switch_ms: 600 }]);
    expect(slow.medians.tab_switch_ms).toBe(500);
    expect(slow.warnings).toEqual(['1440: tab_switch_ms median 500ms > 400ms']);
    expect(summarizeTiming(390, [run]).warnings).toHaveLength(Object.keys(TIMING.budgets_ms).length);
    expect(summarizeTiming(390, [run, run, { ...run, stock_open_ms: undefined }]).warnings).toEqual(['390: stock_open_ms not measured in 3 complete runs']);
  });

  it('keeps timing out of failures and exits non-zero on any objective failure', () => {
    expect(harness).toContain("from './brief-design-contract.mjs'");
    expect(harness).toContain('report.timing_warnings.push(...notes.map(note => `${width}: ${note}`), ...warnings);');
    expect(harness).not.toMatch(/fail\([^)]*warnings/);
    expect(harness).toContain('if (report.failures.length) process.exitCode = 1;');
    expect(harness).toContain("if (process.argv.length > 2) throw Error('The brief Design harness takes no arguments');");
    expect(harness).toContain('if (process.env.FINANCIAL_CANDIDATE_DIR) {');
    expect(harness).toContain(`schema: REPORT_SCHEMA`);
    // A stock is measured from the top of the page: the row click's scroll offset depends on the data.
    expect(harness.match(/await fromTop\(page\);\n\s+await capture\(session, group, 'stock(-weekly)?'/g)).toHaveLength(2);
    expect(REPORT_SCHEMA).toBe('brief-design-review-v1');
    // A chart renderer chunk that did not load is a named functional failure (the box's own words), and the stock opens once
    // cold (before the idle prefetch) beside the warm runs, reported with no budget of its own.
    expect(harness).toContain("functional(group, 'chart-renderer-loaded', failure === null,");
    expect(harness).toContain('cold_stock_open: cold');
    expect(Object.keys(TIMING.budgets_ms)).not.toContain('stock_open_cold_ms');
    expect(checker).toContain('await requireObjectiveEvidence(actual, output, waiver)');
    expect(checker.indexOf('await requireObjectiveEvidence')).toBeLessThan(checker.indexOf('for (const name of reports)'));
  });
});
