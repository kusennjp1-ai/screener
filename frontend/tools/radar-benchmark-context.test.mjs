import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRadarContext, RADAR_CONTEXT_CLASSES, RADAR_HARNESS_VERSION, radarContextFailures, radarMeasurementFailures } from './radar-benchmark-context.mjs';
import { fonts } from '../src/static/theme/tokens.js';
import { RADAR_VISIBILITY_VERSION } from './radar-visibility.mjs';

afterEach(() => { document.body.innerHTML = ''; delete document.documentElement.dataset.theme; });

describe('isolated Radar production CSS context', () => {
  it.each(['dark', 'light'])('uses current route ancestors and %s theme with a fixed component slot', theme => {
    const { shell, container } = createRadarContext(document, { theme });
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(shell.dataset.theme).toBe(theme);
    expect(document.querySelector('.leader-shell > .leader-content > main.research-workbench > section.research-hero.research-overview > .radar-benchmark-slot')).toBe(container);
    expect(container.previousElementSibling.className).toBe('hero-copy');
    expect(shell.textContent).toBe('');
    expect(container.childNodes).toHaveLength(0);
    expect(container.closest('.hero-collapsed')).toBeNull();
    expect(container.style.width).toBe('628px');
    expect(shell.style.width).toBe('');
  });
  it('keeps the original mobile width and explicit DPR alignment stress width', () => {
    expect(createRadarContext(document, { small: true }).container.style.width).toBe('358px');
    expect(createRadarContext(document, { width: 828 }).container.style.width).toBe('828px');
    expect(createRadarContext(document, { width: NaN }).container.style.width).toBe('628px');
    expect(() => createRadarContext(document, { theme: 'sepia' })).toThrow('Unsupported radar theme');
  });
  it('tracks the actual StaticLayout / ResearchPage / ResearchHero class scopes', () => {
    const layout = readFileSync('src/static/StaticLayout.jsx', 'utf8');
    const page = readFileSync('src/static/pages/ResearchPage.jsx', 'utf8');
    const hero = readFileSync('src/static/components/ResearchHero.jsx', 'utf8');
    expect(layout).toContain('className="leader-shell"');
    expect(layout).toContain('className="leader-content"');
    expect(page).toContain('component="main" className={`research-workbench');
    expect(hero).toContain('className={`research-hero research-overview');
    expect(hero).toContain('className="hero-copy"');
    expect(hero).toContain("useMediaQuery('(max-width:700px)')");
    expect(hero).not.toContain('market-overview-expanded');
  });
  it('loads production motion and typography without warming React, geometry or glyphs', () => {
    const entry = readFileSync('tools/radar-benchmark.jsx', 'utf8');
    for (const path of ['../src/index.css', '../src/static/research.css', '../src/static/theme/foundation.css', '../src/static/theme/motion.css', '../src/static/workbench.css', '../src/static/components/researchOverview.css']) expect(entry).toContain(`import '${path}'`);
    expect(entry).toContain("matchMedia('(max-width:700px)').matches");
    expect(entry).toContain('const start = performance.now();\n  flushSync(() => root.render(');
    const beforeStart = entry.slice(0, entry.indexOf('const start = performance.now()'));
    expect(beforeStart).not.toMatch(/root\.render\(|radarGeometry\(|entryPosition\(|fonts\.load\(|fillText\(|measureText\(/);
    expect(readFileSync('tools/radar-benchmark-context.css', 'utf8')).not.toMatch(/animation\s*:|transition\s*:|opacity\s*:|transform\s*:|letter-spacing\s*:/);
  });
  it('removes only the production Radar entrance fade and keeps the other motion', () => {
    const motion = readFileSync('src/static/theme/motion.css', 'utf8');
    expect(motion).not.toMatch(/\.radar-plot\s*\{/);
    expect(motion).toContain('.research-hero .hero-copy { animation:research-rise 180ms ease-out both; }');
    expect(motion).toContain('.entry-gauge .gauge-zone { animation:research-zone 300ms ease-out both; }');
    expect(motion).toContain('@media(prefers-reduced-motion:reduce)');
  });
});

// Synthetic witnesses exercise reporting, not real browser layout or timing.
function context() {
  const box = { font_family: fonts.body, font_feature_settings: '"palt"', font_variant_numeric: 'tabular-nums',
    box_sizing: 'border-box', width: 332, height: 121, animation_name: 'none', transform: 'none' };
  return { harness_version: RADAR_HARNESS_VERSION, root_theme: 'dark', shell_theme: 'dark',
    ancestors: RADAR_CONTEXT_CLASSES.map(class_name => ({ ...box, class_name })),
    shell: { ...box }, slot: { ...box }, radar: { ...box }, plot: { ...box }, canvas: { ...box } };
}
function measurement() {
  return { context: context(), first_frame_ms: 50, point_count: 207, final_point_count: 207, pixel_alignment: { matches: true },
    visibility: { version: RADAR_VISIBILITY_VERSION, captured_in_endpoint_task: true, styles_visible: true, effective_opacity: 1,
      transforms_settled: true, expected_points: 207, painted_point_centers: 207, unobscured_point_centers: 207, readback_error: null } };
}
describe('unchanged 50ms and 207-point gate with fail-closed context and visibility evidence', () => {
  it('rejects the former bare-serif context and missing or mixed-theme evidence', () => {
    expect(radarContextFailures(context())).toEqual([]);
    expect(radarContextFailures(null).length).toBeGreaterThan(0);
    const bare = context(); bare.shell.font_family = '"Times New Roman"'; bare.radar.box_sizing = 'content-box'; bare.ancestors.pop();
    expect(radarContextFailures(bare)).toEqual(expect.arrayContaining(['shell font differs from production typography', 'radar lost production border-box sizing', 'production ancestor context is incomplete']));
    expect(radarContextFailures({ ...context(), shell_theme: 'light' })).toContain('root and shell theme differ');
    const animated = context(); animated.plot.animation_name = 'research-rise';
    expect(radarContextFailures(animated)).toContain('radar plot has unfinished entrance motion');
  });
  it('keeps 50ms inclusive and requires initial and final 207 counts and physical sizing', () => {
    expect(radarMeasurementFailures(measurement())).toEqual([]);
    for (const delta of [{ first_frame_ms: 50.1 }, { first_frame_ms: null }, { point_count: 206 }, { final_point_count: 206 }, { pixel_alignment: { matches: false } }]) expect(radarMeasurementFailures({ ...measurement(), ...delta }).length).toBeGreaterThan(0);
    const stress = { ...measurement(), first_frame_ms: 75 };
    expect(radarMeasurementFailures(stress, { timing: false })).toEqual([]);
    expect(stress.first_frame_ms).toBe(75);
  });
  it('rejects hidden, empty, moving, obscured, late and missing endpoint evidence', () => {
    const run = measurement();
    for (const delta of [{ effective_opacity: 0 }, { effective_opacity: .99 }, { styles_visible: false }, { transforms_settled: false },
      { painted_point_centers: 206 }, { unobscured_point_centers: 206 }, { expected_points: 206 },
      { captured_in_endpoint_task: false }, { version: 'later-screenshot' }, { readback_error: 'tainted' }]) {
      expect(radarMeasurementFailures({ ...run, first_frame_ms: 10, visibility: { ...run.visibility, ...delta } }).length).toBeGreaterThan(0);
    }
    expect(radarMeasurementFailures({ ...run, visibility: undefined }, { timing: false }).length).toBeGreaterThan(0);
  });
  it('requires all original cold/warm runs and additional evidence in both entry points', () => {
    const review = readFileSync('tools/design-review.mjs', 'utf8'), diagnostic = readFileSync('tools/radar-diagnostic.mjs', 'utf8');
    expect(review).toContain('for (let index = 0; index < 3; index++) runs.push');
    expect(review).toContain('runs.length === 3 && runs.every(run => run.first_frame_ms <= 50)');
    expect(review).toContain('radarMeasurementFailures(run)');
    expect(diagnostic).toContain('for(let index=0;index<3;index++)runs.push');
    expect(diagnostic).toContain('runs.length===3&&runs.every(run=>radarMeasurementFailures(run).length===0)');
  });
});
