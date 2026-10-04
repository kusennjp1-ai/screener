import { radarMeasurementFailures } from './radar-benchmark-context.mjs';

export const EXPERIMENT_VERSION = 'radar-inherited-text-features-ab-v2';
export const VARIANTS = { control: '/* Control: retain production styles unchanged. */', normal: '.setup-radar { font-feature-settings:normal; font-variant-numeric:normal; }' };
export const EXPECTED_CONTEXT_DIFFERENCE = 'radar lost production text inheritance';
export const CASES = [1440, 390].flatMap(width => ['dark', 'light'].map(theme => ({ width, height: width === 1440 ? 900 : 844, theme })));
export function trialPlan() {
  return CASES.flatMap(testCase => Array.from({ length: 3 }, (_, pair) => (pair % 2 ? ['normal', 'control'] : ['control', 'normal']).map(variant => ({ ...testCase, pair: pair + 1, variant, instrumented: false })))).flat();
}
export function tracePlan() {
  return CASES.flatMap(testCase => ['control', 'normal'].map(variant => ({ ...testCase, pair: null, variant, instrumented: true })));
}
export function measurementEvidence(run, variant) {
  const productionFailures = radarMeasurementFailures(run);
  const geometryVisibilityContext = radarMeasurementFailures(run, { timing: false });
  const expected = variant === 'normal' ? [EXPECTED_CONTEXT_DIFFERENCE] : [];
  const unexpected = geometryVisibilityContext.filter(failure => !expected.includes(failure));
  const candidateMatches = variant !== 'normal' || (run?.context?.radar?.font_feature_settings === 'normal' && run?.context?.radar?.font_variant_numeric === 'normal');
  if (!candidateMatches) unexpected.push('candidate text feature override was not applied');
  return { production_acceptance: 'not_evaluated_by_this_experiment', production_context_and_timing_failures: productionFailures,
    expected_context_differences: geometryVisibilityContext.filter(failure => expected.includes(failure)), unexpected_failures: unexpected,
    under_original_50ms: Number.isFinite(run?.first_frame_ms) && run.first_frame_ms >= 0 && run.first_frame_ms <= 50 };
}
export function traceCosts(events) {
  const frames = events.filter(event => event.name === 'FireAnimationFrame');
  if (frames.length < 2) return { unavailable: true };
  const start = frames[0].ts, end = frames[1].ts;
  const slices = events.filter(event => event.ph === 'X' && event.tid === frames[0].tid && event.ts >= start && event.ts < end);
  const duration = name => {
    const intervals = [];
    for (const [a, b] of slices.filter(event => event.name === name).map(event => [event.ts, Math.min(end, event.ts + event.dur)]).sort((a, b) => a[0] - b[0])) {
      if (!intervals.length || a > intervals.at(-1)[1]) intervals.push([a, b]);
      else intervals.at(-1)[1] = Math.max(intervals.at(-1)[1], b);
    }
    return intervals.reduce((sum, [a, b]) => sum + b - a, 0) / 1000;
  };
  return { first_frame_trace_timestamp_us: start, endpoint_trace_timestamp_us: end, frame_gap_ms: (end - start) / 1000,
    layout_ms: duration('Layout'), style_ms: duration('UpdateLayoutTree'), compile_ms: duration('V8.CompileCode'),
    html_parse_ms: duration('ParseHTML'), paint_ms: duration('Paint'), font_start_ms: duration('BeginRemoteFontLoad'),
    font_starts: slices.filter(event => event.name === 'BeginRemoteFontLoad').length,
    method: 'Main-thread union durations between first and second RAF callbacks; compilation is included in JS and font initialization in style/layout, not additive categories.' };
}
export function summarizeTrials(samples) {
  return CASES.map(testCase => {
    const pairs = [1, 2, 3].map(pair => {
      const matching = samples.filter(sample => !sample.instrumented && sample.width === testCase.width && sample.theme === testCase.theme && sample.pair === pair);
      const a = matching.find(sample => sample.variant === 'control'), b = matching.find(sample => sample.variant === 'normal');
      const valid = a && b && !a.error && !b.error && a.complete_fonts && b.complete_fonts && !a.evidence.unexpected_failures.length && !b.evidence.unexpected_failures.length && a.labels_axes_match === true && b.labels_axes_match === true;
      return { pair, valid: Boolean(valid), render_layout_saved_ms: valid ? a.measurement.render_layout_ms - b.measurement.render_layout_ms : null,
        first_frame_saved_ms: valid ? a.measurement.first_frame_ms - b.measurement.first_frame_ms : null, sample_ids: [a?.id ?? null, b?.id ?? null] };
    });
    return { ...testCase, pairs, signal: pairs.every(pair => pair.valid && pair.render_layout_saved_ms >= 5) ? 'consistent_layout_signal_requires_visual_review' : 'not_established_reject_or_inconclusive',
      production_adoption_allowed: false, decision_rule: 'All three paired cold render/layout improvements must be at least 5ms, with complete fonts and intact non-typography evidence. No rerun-to-pass.' };
  });
}
