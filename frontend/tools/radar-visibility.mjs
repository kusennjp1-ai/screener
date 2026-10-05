// Synchronous evidence captured in the same task as the existing first-frame
// endpoint. No await, animation callback or screenshot may fill in later pixels.
// This proves bitmap + CSS readiness, not compositor presentation timing.
export const RADAR_VISIBILITY_VERSION = 'same-task-canvas-pixels-css-transform-v2';
export function radarVisibilityWitness(canvas, geometryForEvidence) {
  const started = performance.now(), document = canvas.ownerDocument;
  const box = canvas.getBoundingClientRect(), path = [];
  for (let node = canvas; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    path.push({ tag: node.tagName, class_name: node.className, opacity: Number(style.opacity),
      display: style.display, visibility: style.visibility, content_visibility: style.contentVisibility, transform: style.transform });
  }
  const effectiveOpacity = path.reduce((value, node) => value * node.opacity, 1);
  const transformsSettled = path.every(node => node.transform === 'none');
  const stylesVisible = canvas.isConnected && path.every(node => node.display !== 'none' && node.visibility === 'visible' && node.content_visibility !== 'hidden');
  let bitmap, readbackError = null;
  const readbackStart = performance.now();
  try { bitmap = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height); }
  catch (error) { readbackError = error.message; }
  const readbackMs = performance.now() - readbackStart;
  // Derive reference positions only after freezing the real bitmap. This does
  // not warm application geometry before the cold measured mount.
  const geometry = geometryForEvidence();
  let painted = 0, unobscured = 0;
  for (const point of geometry.points) {
    const px = Math.floor(point.x / geometry.width * (bitmap?.width || 0));
    const py = Math.floor(point.y / geometry.height * (bitmap?.height || 0));
    const inside = bitmap && px >= 0 && py >= 0 && px < bitmap.width && py < bitmap.height;
    // Circle interiors have alpha >= .6. Grid/zone-only pixels remain below
    // .55, including their intersections, so a blank/grid-only canvas fails.
    if (inside && bitmap.data[(py * bitmap.width + px) * 4 + 3] >= 140) painted++;
    const x = box.left + point.x / geometry.width * box.width;
    const y = box.top + point.y / geometry.height * box.height;
    if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && document.elementFromPoint(x, y) === canvas) unobscured++;
  }
  return { version: RADAR_VISIBILITY_VERSION, captured_in_endpoint_task: true, css_path: path,
    effective_opacity: effectiveOpacity, transforms_settled: transformsSettled, styles_visible: stylesVisible, expected_points: geometry.points.length,
    painted_point_centers: painted, unobscured_point_centers: unobscured, readback_error: readbackError,
    pixel_readback_ms: readbackMs, observation_ms: performance.now() - started };
}
