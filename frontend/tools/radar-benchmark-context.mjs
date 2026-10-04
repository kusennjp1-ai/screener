// Version 1 mounted SetupRadar in a bare div. Version 2 reproduces the
// production StaticLayout -> ResearchPage -> expanded ResearchHero CSS scope.
import { RADAR_VISIBILITY_VERSION } from './radar-visibility.mjs';
export const RADAR_HARNESS_VERSION = 'production-overview-context-v2';
export const RADAR_CONTEXT_CLASSES = ['leader-shell', 'leader-content', 'research-workbench', 'research-hero research-overview', 'market-overview-expanded'];

export function createRadarContext(document, { width, theme = 'dark' } = {}) {
  if (!['dark', 'light'].includes(theme)) throw Error('Unsupported radar theme');
  const nodes = RADAR_CONTEXT_CLASSES.map((className, index) => {
    const node = document.createElement(index === 3 ? 'section' : 'div');
    node.className = className;
    return node;
  });
  const [shell] = nodes;
  shell.dataset.theme = theme;
  if (Number.isFinite(width) && width > 0) shell.style.width = `${width}px`;
  document.documentElement.dataset.theme = theme;
  for (let index = 1; index < nodes.length; index++) nodes[index - 1].append(nodes[index]);
  document.body.append(shell);
  return { shell, container: nodes.at(-1), widthOverride: shell.style.width || null };
}

export function radarContextWitness(shell, widthOverride = null) {
  const radar = shell.querySelector('.setup-radar'), canvas = radar?.querySelector('[data-radar-canvas]');
  const observe = node => {
    if (!node) return null;
    const style = getComputedStyle(node), box = node.getBoundingClientRect();
    return { class_name: node.className, font_family: style.fontFamily, font_size: style.fontSize,
      font_feature_settings: style.fontFeatureSettings, font_variant_numeric: style.fontVariantNumeric,
      line_height: style.lineHeight, animation_name: style.animationName, opacity: style.opacity, transform: style.transform, box_sizing: style.boxSizing, width: box.width, height: box.height,
      color: style.color, color_scheme: style.colorScheme };
  };
  return { harness_version: RADAR_HARNESS_VERSION, root_theme: document.documentElement.dataset.theme,
    shell_theme: shell.dataset.theme, expected_font_family: getComputedStyle(shell).getPropertyValue('--font-body').trim(), shell_width_override: widthOverride, viewport_width: innerWidth,
    small: matchMedia('(max-width:700px)').matches, shell: observe(shell),
    ancestors: RADAR_CONTEXT_CLASSES.map(value => observe(shell.matches(`.${value.split(' ').join('.')}`) ? shell : shell.querySelector(`.${value.split(' ').join('.')}`))),
    radar: observe(radar), plot: observe(radar?.querySelector('.radar-plot')), header: observe(radar?.querySelector('header')), canvas: observe(canvas) };
}

export function radarContextFailures(context) {
  const failures = [];
  if (context?.harness_version !== RADAR_HARNESS_VERSION) failures.push('missing production context version');
  if (!['dark', 'light'].includes(context?.root_theme) || context?.shell_theme !== context.root_theme) failures.push('root and shell theme differ');
  if (context?.ancestors?.length !== RADAR_CONTEXT_CLASSES.length || context.ancestors.some((node, i) => node?.class_name !== RADAR_CONTEXT_CLASSES[i])) failures.push('production ancestor context is incomplete');
  const font = value => (value || '').replace(/[\s"']/g, '').toLowerCase();
  if (!context?.expected_font_family || font(context?.shell?.font_family) !== font(context.expected_font_family)) failures.push('shell font differs from production --font-body');
  if (!context?.radar?.font_feature_settings?.includes('palt') || context?.radar?.font_variant_numeric !== 'tabular-nums') failures.push('radar lost production text inheritance');
  for (const name of ['shell', 'radar', 'header', 'canvas']) {
    const node = context?.[name];
    if (!node || !(node.width > 0) || !(node.height > 0)) failures.push(`${name} has no CSS box`);
    if (node?.box_sizing !== 'border-box') failures.push(`${name} lost production border-box sizing`);
    if (!node?.font_family || node.font_family !== context?.shell?.font_family) failures.push(`${name} lost the shell font`);
    if (node?.color_scheme !== context?.shell_theme) failures.push(`${name} lost the shell theme`);
  }
  return failures;
}

export function radarMeasurementFailures(run, { timing = true } = {}) {
  const visibility = run?.visibility;
  const visible = visibility?.version === RADAR_VISIBILITY_VERSION && visibility.captured_in_endpoint_task === true &&
    visibility.styles_visible === true && visibility.effective_opacity === 1 && visibility.expected_points === 207 &&
    visibility.painted_point_centers === 207 && visibility.unobscured_point_centers === 207 && visibility.readback_error === null;
  return [...radarContextFailures(run?.context),
    ...(run?.point_count !== 207 || run?.final_point_count !== 207 ? ['requires all 207 actual points at the first-frame boundary'] : []),
    ...(run?.pixel_alignment?.matches !== true ? ['CSS/DPR pixel alignment is unfinished at the first-frame boundary'] : []),
    ...(!visible ? ['all 207 point centers require actual canvas pixels, full CSS opacity and unobscured visibility in the first-frame endpoint task'] : []),
    ...(timing && (!Number.isFinite(run?.first_frame_ms) || run.first_frame_ms < 0 || run.first_frame_ms > 50) ? [`first frame ${run?.first_frame_ms ?? 'unmeasured'}ms (limit 50ms)`] : [])];
}
