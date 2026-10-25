import { fonts } from '../src/static/theme/tokens.js';
import { RADAR_VISIBILITY_VERSION } from './radar-visibility.mjs';

// This is an isolated component benchmark with production CSS ancestry, not
// a measurement of mounting the surrounding ResearchHero or application.
export const RADAR_HARNESS_VERSION = 'workspace-hero-fixed-slot-visible-v4';
export const RADAR_CONTEXT_CLASSES = ['leader-shell workspace-shell', 'leader-content', 'research-workbench', 'research-hero research-overview'];

// A stored, source-bound capture keeps the CSS ancestry and typography contract
// of the producer that measured it. This allowlist is not used by live captures.
const STORED_CONTEXT_CONTRACTS = Object.freeze({
  'production-hero-fixed-slot-visible-v3': Object.freeze({
    version: 'production-hero-fixed-slot-visible-v3',
    classes: Object.freeze(['leader-shell', 'leader-content', 'research-workbench', 'research-hero research-overview']),
    font: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif',
  }),
  'workspace-hero-fixed-slot-visible-v4': Object.freeze({
    version: 'workspace-hero-fixed-slot-visible-v4',
    classes: Object.freeze(['leader-shell workspace-shell', 'leader-content', 'research-workbench', 'research-hero research-overview']),
    font: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif',
  }),
});

export function createRadarContext(document, { width, theme = 'dark', small = false } = {}) {
  if (!['dark', 'light'].includes(theme)) throw Error('Unsupported radar theme');
  const nodes = RADAR_CONTEXT_CLASSES.map((className, index) => {
    const node = document.createElement(index === 2 ? 'main' : index === 3 ? 'section' : 'div');
    node.className = className;
    return node;
  });
  const [shell, , workbench, hero] = nodes;
  shell.dataset.theme = theme;
  workbench.dataset.mobileView = 'list';
  document.documentElement.dataset.theme = theme;
  for (let index = 1; index < nodes.length; index++) nodes[index - 1].append(nodes[index]);
  // Reserve the real first grid column without text, glyph loading or React
  // prerendering. The sole additional wrapper is the original fixed-width
  // component measurement boundary; all production selector ancestors remain.
  const copy = document.createElement('div');
  copy.className = 'hero-copy';
  copy.setAttribute('aria-hidden', 'true');
  const container = document.createElement('div');
  container.className = 'radar-benchmark-slot';
  container.style.width = `${Number.isFinite(width) && width > 0 ? width : small ? 358 : 628}px`;
  container.style.minWidth = '0';
  hero.append(copy, container);
  document.body.append(shell);
  return { shell, container };
}

export function radarContextWitness(shell, container) {
  const radar = container.querySelector('.setup-radar');
  const observe = node => {
    if (!node) return null;
    const style = getComputedStyle(node), box = node.getBoundingClientRect();
    return { class_name: node.className, font_family: style.fontFamily, font_size: style.fontSize,
      font_feature_settings: style.fontFeatureSettings, font_variant_numeric: style.fontVariantNumeric,
      line_height: style.lineHeight, letter_spacing: style.letterSpacing, box_sizing: style.boxSizing,
      animation_name: style.animationName, transform: style.transform, opacity: style.opacity,
      width: box.width, height: box.height, color_scheme: style.colorScheme };
  };
  return { harness_version: RADAR_HARNESS_VERSION, root_theme: document.documentElement.dataset.theme,
    shell_theme: shell.dataset.theme, slot_width: container.style.width, viewport_width: innerWidth,
    small: matchMedia('(max-width:700px)').matches, font_status: document.fonts.status,
    ancestors: RADAR_CONTEXT_CLASSES.map(value => observe(shell.matches(`.${value.split(' ').join('.')}`) ? shell : shell.querySelector(`.${value.split(' ').join('.')}`))),
    shell: observe(shell), slot: observe(container), radar: observe(radar),
    plot: observe(radar?.querySelector('.radar-plot')), canvas: observe(radar?.querySelector('[data-radar-canvas]')) };
}

export function radarContextFailures(context) {
  return contextFailuresFor(context, { version: RADAR_HARNESS_VERSION, classes: RADAR_CONTEXT_CLASSES, font: fonts.body });
}

function contextFailuresFor(context, contract) {
  const failures = [], font = value => (value || '').replace(/[\s"']/g, '').toLowerCase();
  if (!contract || context?.harness_version !== contract.version) failures.push('missing production context version');
  if (!['dark', 'light'].includes(context?.root_theme) || context?.shell_theme !== context.root_theme) failures.push('root and shell theme differ');
  if (!contract || context?.ancestors?.length !== contract.classes.length || context.ancestors.some((node, i) => node?.class_name !== contract.classes[i])) failures.push('production ancestor context is incomplete');
  if (!contract || font(context?.shell?.font_family) !== font(contract.font)) failures.push('shell font differs from production typography');
  if (!context?.radar?.font_feature_settings?.includes('palt') || context?.radar?.font_variant_numeric !== 'tabular-nums') failures.push('radar lost production text inheritance');
  for (const name of ['shell', 'slot', 'radar', 'canvas']) {
    const node = context?.[name];
    if (!node || !(node.width > 0) || !(node.height > 0)) failures.push(`${name} has no CSS box`);
    if (node?.box_sizing !== 'border-box') failures.push(`${name} lost production border-box sizing`);
    if (!contract || font(node?.font_family) !== font(contract.font)) failures.push(`${name} lost the shell font`);
  }
  if (context?.plot?.animation_name !== 'none' || context?.plot?.transform !== 'none') failures.push('radar plot has unfinished entrance motion');
  return failures;
}

export function radarMeasurementFailures(run, { timing = true } = {}) {
  return measurementFailuresFor(run, timing, radarContextFailures(run?.context));
}

// Only the authenticated historical-capture reader calls this path. Unknown
// versions and a version paired with the other layout's ancestry still fail.
export function storedRadarMeasurementFailures(run, { timing = true } = {}) {
  const version = run?.context?.harness_version;
  const contract = Object.hasOwn(STORED_CONTEXT_CONTRACTS, version) ? STORED_CONTEXT_CONTRACTS[version] : null;
  return measurementFailuresFor(run, timing, contextFailuresFor(run?.context, contract));
}

function measurementFailuresFor(run, timing, contextFailures) {
  const visibility = run?.visibility;
  const visible = visibility?.version === RADAR_VISIBILITY_VERSION && visibility.captured_in_endpoint_task === true &&
    visibility.styles_visible === true && visibility.effective_opacity === 1 && visibility.transforms_settled === true &&
    visibility.expected_points === 207 && visibility.painted_point_centers === 207 && visibility.unobscured_point_centers === 207 && visibility.readback_error === null;
  return [...contextFailures,
    ...(run?.harness_version != null && run.harness_version !== run?.context?.harness_version ? ['measurement and context harness versions differ'] : []),
    ...(run?.point_count !== 207 || run?.final_point_count !== 207 ? ['requires all 207 actual points at the first-frame boundary'] : []),
    ...(run?.pixel_alignment?.matches !== true ? ['CSS/DPR pixel alignment is unfinished at the first-frame boundary'] : []),
    ...(!visible ? ['all 207 point centers require actual pixels, full opacity, settled transforms and unobscured visibility in the endpoint task'] : []),
    ...(timing && (!Number.isFinite(run?.first_frame_ms) || run.first_frame_ms < 0 || run.first_frame_ms > 50) ? [`first frame ${run?.first_frame_ms ?? 'unmeasured'}ms (limit 50ms)`] : [])];
}
