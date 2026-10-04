import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import yaml from 'js-yaml';
import { VARIANTS, CASES, trialPlan, tracePlan, measurementEvidence, summarizeTrials, traceCosts, EXPECTED_CONTEXT_DIFFERENCE } from './radar-text-layout-contract.mjs';
import { RADAR_CONTEXT_CLASSES, RADAR_HARNESS_VERSION } from './radar-benchmark-context.mjs';
import { RADAR_VISIBILITY_VERSION } from './radar-visibility.mjs';
import { fonts } from '../src/static/theme/tokens.js';

function measurement(variant = 'control', ms = 80) {
  const box = { font_family: fonts.body, font_feature_settings: '"palt"', font_variant_numeric: 'tabular-nums', box_sizing: 'border-box', width: 332, height: 121, animation_name: 'none', transform: 'none' };
  return { context: { harness_version: RADAR_HARNESS_VERSION, root_theme: 'dark', shell_theme: 'dark',
    ancestors: RADAR_CONTEXT_CLASSES.map(class_name => ({ ...box, class_name })), shell: { ...box }, slot: { ...box },
    radar: { ...box, ...(variant === 'normal' ? { font_feature_settings: 'normal', font_variant_numeric: 'normal' } : {}) }, plot: { ...box }, canvas: { ...box } },
    render_layout_ms: ms, first_frame_ms: ms + 10, point_count: 207, final_point_count: 207, pixel_alignment: { matches: true },
    visibility: { version: RADAR_VISIBILITY_VERSION, captured_in_endpoint_task: true, styles_visible: true, transforms_settled: true,
      effective_opacity: 1, expected_points: 207, painted_point_centers: 207, unobscured_point_centers: 207, readback_error: null } };
}
function trials() { return trialPlan().map((spec, i) => ({ ...spec, id: String(i), measurement: measurement(spec.variant, spec.variant === 'normal' ? 65 : 80),
  evidence: { unexpected_failures: [] }, complete_fonts: true, labels_axes_match: true })); }

describe('bounded Radar text-layout experiment', () => {
  it('predeclares three alternating pairs for each desktop/mobile and dark/light case', () => {
    expect(trialPlan()).toHaveLength(24); expect(tracePlan()).toHaveLength(8);
    for (const testCase of CASES) {
      const runs = trialPlan().filter(run => run.width === testCase.width && run.theme === testCase.theme);
      expect(runs.map(run => run.variant)).toEqual(['control', 'normal', 'normal', 'control', 'control', 'normal']);
      expect(runs.map(run => run.pair)).toEqual([1, 1, 2, 2, 3, 3]);
      expect(runs.every(run => run.instrumented === false)).toBe(true);
      expect(tracePlan().filter(run => run.width === testCase.width && run.theme === testCase.theme).map(run => run.variant)).toEqual(['control', 'normal']);
    }
  });
  it('changes only inherited palt/tnum and keeps the 50ms and production-context differences visible', () => {
    expect(VARIANTS).toEqual({ control: '', normal: '.setup-radar { font-feature-settings:normal; font-variant-numeric:normal; }' });
    const evidence = measurementEvidence(measurement('normal'), 'normal');
    expect(evidence.under_original_50ms).toBe(false);
    expect(evidence.expected_context_differences).toEqual([EXPECTED_CONTEXT_DIFFERENCE]);
    expect(evidence.production_context_and_timing_failures).toContain('first frame 90ms (limit 50ms)');
    expect(evidence.production_acceptance).toBe('not_evaluated_by_this_experiment');
    expect(evidence.unexpected_failures).toEqual([]);
    expect(measurementEvidence(measurement('control'), 'normal').unexpected_failures).toContain('candidate text feature override was not applied');
  });
  it('does not excuse missing points, opacity, geometry or any unrelated context defect', () => {
    const run = measurement('normal'); run.final_point_count = 206; run.visibility.effective_opacity = 0; run.context.canvas.box_sizing = 'content-box';
    const result = measurementEvidence(run, 'normal');
    expect(result.unexpected_failures).toHaveLength(3);
    expect(result.expected_context_differences).toEqual([EXPECTED_CONTEXT_DIFFERENCE]);
  });
  it('requires every paired improvement and complete real fonts; never grants production adoption', () => {
    const good = trials();
    expect(summarizeTrials(good).every(result => result.signal === 'consistent_layout_signal_requires_visual_review' && result.production_adoption_allowed === false)).toBe(true);
    for (const delta of [{ complete_fonts: false }, { labels_axes_match: false }, { labels_axes_match: null }, { error: 'font request failed' }, { evidence: { unexpected_failures: ['hidden'] } }]) {
      const bad = trials(); Object.assign(bad[0], delta);
      expect(summarizeTrials(bad)[0].signal).toBe('not_established_reject_or_inconclusive');
    }
    const small = trials(); small[1].measurement.render_layout_ms = 77;
    expect(summarizeTrials(small)[0].signal).toBe('not_established_reject_or_inconclusive');
    expect(summarizeTrials(good.slice(1))[0].signal).toBe('not_established_reject_or_inconclusive');
  });
  it('retains DOM only after the original endpoint and distinguishes later pictures from endpoint evidence', () => {
    const entry = readFileSync('tools/radar-benchmark.jsx', 'utf8'), runner = readFileSync('tools/radar-text-layout-diagnostic.mjs', 'utf8');
    expect(entry.indexOf('if (diagnosticRetain)')).toBeGreaterThan(entry.indexOf('const nextFrame = performance.now() - start;'));
    expect(entry).toContain('diagnosticRetain = false');
    expect(entry).toContain('first_frame_ms: nextFrame, visibility');
    expect(runner).toContain('exact_endpoint: false');
    expect(runner).toContain('later_image_substituted: false');
    expect(runner).toContain('event.ts >= paint?.ts && event.ts <= frames[1]?.ts');
    expect(runner).toContain("session.send('Page.captureScreenshot'");
    expect(runner).not.toContain('page.screenshot(');
    expect(runner).toContain("session.send('CSS.getPlatformFontsForNode'");
    expect(runner).toContain("renderedFamily('.setup-radar header strong', 'zenkakugothicnew')");
    expect(runner).toContain('for (const spec of [...trialPlan(), ...tracePlan()])');
    expect(runner).not.toMatch(/fonts\.load\(|waitForTimeout\(|retries\s*:/);
  });
  it('attributes only initial-frame trace work without double-counting nested slices or later evidence', () => {
    const event = (name, ts, dur, tid = 1) => ({ name, ts, dur, tid, ph: 'X' });
    const result = traceCosts([event('FireAnimationFrame', 1000, 100), event('Paint', 2000, 4000), event('Paint', 3000, 1000),
      event('Layout', 1100, 800), event('Layout', 1100, 6000, 2), event('FireAnimationFrame', 8000, 100), event('Layout', 9000, 10000)]);
    expect(result.paint_ms).toBe(4); expect(result.layout_ms).toBe(.8); expect(result.frame_gap_ms).toBe(7);
    expect(traceCosts([])).toEqual({ unavailable: true });
  });
});

describe('artifact-only workflow static audit', () => {
  it('runs only on the diagnostic branch with read-only contents and ordinary artifact upload', () => {
    const text = readFileSync('../.github/workflows/radar-text-layout-diagnostic.yml', 'utf8'), workflow = yaml.load(text);
    expect(workflow.on).toEqual({ push: { branches: ['diagnostic/radar-text-layout-20261004'] } });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(Object.keys(workflow.jobs)).toEqual(['bounded-text-layout']);
    expect(workflow.jobs['bounded-text-layout'].if).toBe("github.ref == 'refs/heads/diagnostic/radar-text-layout-20261004'");
    expect(workflow.jobs['bounded-text-layout'].steps.filter(step => step.uses).map(step => step.uses)).toEqual(['actions/checkout@v4', 'actions/setup-node@v4', 'actions/upload-artifact@v4']);
    expect(text).not.toMatch(/secrets\.|contents: write|pages:|id-token:|deploy|release|financial|export-research|workflow_dispatch|workflow_run/i);
    expect(text).toContain('node tools/build-radar-benchmark.mjs');
    expect(text).toContain('node tools/radar-text-layout-diagnostic.mjs');
  });
  it('does not activate an existing push workflow or allow provider traffic', () => {
    for (const file of readdirSync('../.github/workflows').filter(file => /\.ya?ml$/.test(file) && file !== 'radar-text-layout-diagnostic.yml')) {
      const workflow = yaml.load(readFileSync(`../.github/workflows/${file}`, 'utf8'));
      if (workflow.on?.push) {
        expect(workflow.on.push.branches).toBeDefined();
        for (const branch of workflow.on.push.branches) {
          const pattern = new RegExp(`^${branch.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
          expect(pattern.test('diagnostic/radar-text-layout-20261004')).toBe(false);
        }
      }
    }
    const runner = readFileSync('tools/radar-text-layout-diagnostic.mjs', 'utf8');
    expect(runner).toContain("new Set(['127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com'])");
    expect(runner).toContain("route.abort('blockedbyclient')");
  });
});
