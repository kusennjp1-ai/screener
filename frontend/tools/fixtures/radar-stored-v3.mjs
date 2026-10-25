// Synthetic historical witness, deliberately independent of live constants.
// This is not a real capture, pixel inspection or performance claim.
const node = {
  font_family: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif',
  box_sizing: 'border-box', width: 200, height: 200,
};
export const storedRadarV3 = {
  harness_version: 'production-hero-fixed-slot-visible-v3',
  context: {
    harness_version: 'production-hero-fixed-slot-visible-v3', root_theme: 'dark', shell_theme: 'dark',
    ancestors: [
      { class_name: 'leader-shell' }, { class_name: 'leader-content' },
      { class_name: 'research-workbench' }, { class_name: 'research-hero research-overview' },
    ],
    shell: { ...node }, slot: { ...node }, canvas: { ...node },
    radar: { ...node, font_feature_settings: 'palt', font_variant_numeric: 'tabular-nums' },
    plot: { animation_name: 'none', transform: 'none' },
  },
  first_frame_ms: 16, point_count: 207, final_point_count: 207, pixel_alignment: { matches: true },
  visibility: {
    version: 'same-task-canvas-pixels-css-transform-v2', captured_in_endpoint_task: true,
    styles_visible: true, effective_opacity: 1, transforms_settled: true,
    expected_points: 207, painted_point_centers: 207, unobscured_point_centers: 207, readback_error: null,
  },
};
