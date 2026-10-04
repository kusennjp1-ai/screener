import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRadarContext, RADAR_HARNESS_VERSION, radarContextFailures, radarMeasurementFailures } from './radar-benchmark-context.mjs';
import { fonts } from '../src/static/theme/tokens.js';
import { RADAR_VISIBILITY_VERSION } from './radar-visibility.mjs';

afterEach(() => { document.body.innerHTML = ''; delete document.documentElement.dataset.theme; });

describe('isolated radar production style context', () => {
  it.each(['dark', 'light'])('mounts in the actual expanded overview hierarchy and %s theme scope', theme => {
    const { shell, container, widthOverride } = createRadarContext(document, { theme });
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(shell.dataset.theme).toBe(theme);
    expect(document.querySelector('.leader-shell > .leader-content > .research-workbench > .research-hero.research-overview > .market-overview-expanded')).toBe(container);
    expect(container.closest('.hero-collapsed')).toBeNull();
    expect(widthOverride).toBeNull();
    expect(shell.style.width).toBe('');
    expect(document.body.firstChild).toBe(shell);
  });
  it('uses production CSS width by default and declares any extra diagnostic width override', () => {
    const normal = createRadarContext(document);
    expect(normal.shell.style.width).toBe('');
    const stress = createRadarContext(document, { width: 828 });
    expect(stress.widthOverride).toBe('828px');
    expect(stress.shell.style.width).toBe('828px');
    expect(stress.container.style.width).toBe('');
    expect(createRadarContext(document, { width: NaN }).widthOverride).toBeNull();
  });
  it('rejects an unsupported theme instead of silently measuring another context', () => {
    expect(() => createRadarContext(document, { theme: 'sepia' })).toThrow('Unsupported radar theme');
    expect(document.body.children).toHaveLength(0);
  });
  it('loads the production typography/reset, shell and overview CSS in the actual benchmark', () => {
    const entry = readFileSync('tools/radar-benchmark.jsx', 'utf8');
    for (const path of ['../src/index.css', '../src/static/research.css', '../src/static/theme/foundation.css', '../src/static/workbench.css', '../src/static/components/researchOverview.css']) expect(entry).toContain(`import '${path}'`);
    expect(entry).toContain('const start = performance.now();\n  flushSync(() => root.render(');
    expect(entry).toContain("matchMedia('(max-width:700px)').matches");
  });
});

// Synthetic context verifies fail-closed reporting only. It is not a browser
// measurement, and no geometry/font success is claimed from jsdom.
function context() {
  const box = { font_family: fonts.body, font_feature_settings: '"palt"', font_variant_numeric: 'tabular-nums',
    font_size: '12px', line_height: '18px', box_sizing: 'border-box', width: 332, height: 121, color_scheme: 'dark' };
  return { harness_version: RADAR_HARNESS_VERSION, root_theme: 'dark', shell_theme: 'dark', expected_font_family: fonts.body,
    ancestors: ['leader-shell', 'leader-content', 'research-workbench', 'research-hero research-overview', 'market-overview-expanded'].map(class_name => ({ ...box, class_name })),
    shell: { ...box }, radar: { ...box }, header: { ...box }, canvas: { ...box } };
}
function measurement() {
  return { context: context(), first_frame_ms: 50, point_count: 207, final_point_count: 207, pixel_alignment: { matches: true },
    visibility: { version: RADAR_VISIBILITY_VERSION, captured_in_endpoint_task: true, styles_visible: true, effective_opacity: 1,
      expected_points: 207, painted_point_centers: 207, unobscured_point_centers: 207, readback_error: null } };
}
describe('D9 context and unchanged first-frame gating', () => {
  it('requires production font inheritance instead of allowing a bare serif div', () => {
    expect(radarContextFailures(context())).toEqual([]);
    const bare = context();
    for (const name of ['shell', 'radar', 'header', 'canvas']) bare[name].font_family = '"Times New Roman"';
    expect(radarContextFailures(bare)).toContain('shell font differs from production --font-body');
    bare.radar.box_sizing = 'content-box';
    bare.ancestors.pop();
    expect(radarContextFailures(bare)).toContain('radar lost production border-box sizing');
    expect(radarContextFailures(bare)).toContain('production ancestor context is incomplete');
  });
  it('rejects missing and mixed-theme observations', () => {
    expect(radarContextFailures(null).length).toBeGreaterThan(0);
    const wrong = context(); wrong.shell_theme = 'light';
    expect(radarContextFailures(wrong)).toContain('root and shell theme differ');
  });
  it('requires every real point and final CSS/DPR size at the same 50ms boundary', () => {
    expect(radarMeasurementFailures(measurement())).toEqual([]);
    expect(radarMeasurementFailures({ ...measurement(), first_frame_ms: 50.1 })).toContain('first frame 50.1ms (limit 50ms)');
    expect(radarMeasurementFailures({ ...measurement(), final_point_count: 206 })).toContain('requires all 207 actual points at the first-frame boundary');
    expect(radarMeasurementFailures({ ...measurement(), pixel_alignment: { matches: false } })).toContain('CSS/DPR pixel alignment is unfinished at the first-frame boundary');
    expect(radarMeasurementFailures({ ...measurement(), first_frame_ms: null })).toContain('first frame unmeasuredms (limit 50ms)');
  });
  it('keeps extra diagnostic alignment separate without replacing or fabricating its time', () => {
    const alignment = { ...measurement(), first_frame_ms: 75 };
    expect(radarMeasurementFailures(alignment, { timing: false })).toEqual([]);
    expect(alignment.first_frame_ms).toBe(75);
    expect(radarMeasurementFailures(alignment)).toContain('first frame 75ms (limit 50ms)');
  });
  it('rejects hidden, empty, obscured, late or missing visibility evidence independently of a fast draw', () => {
    const valid = measurement(), message = 'all 207 point centers require actual canvas pixels, full CSS opacity and unobscured visibility in the first-frame endpoint task';
    for (const delta of [{ effective_opacity: 0 }, { effective_opacity: .99 }, { styles_visible: false },
      { painted_point_centers: 206 }, { unobscured_point_centers: 206 }, { expected_points: 206 },
      { captured_in_endpoint_task: false }, { version: 'later-screenshot' }, { readback_error: 'tainted' }]) {
      expect(radarMeasurementFailures({ ...valid, first_frame_ms: 10, visibility: { ...valid.visibility, ...delta } })).toContain(message);
    }
    expect(radarMeasurementFailures({ ...valid, visibility: undefined })).toContain(message);
    expect(radarMeasurementFailures({ ...valid, visibility: undefined }, { timing: false })).toContain(message);
  });
});
