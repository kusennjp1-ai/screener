import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import SetupRadar from '../src/static/components/SetupRadar';
import { themeCss } from '../src/static/theme/tokens';
import fixture from './fixtures/radar-207-2026-09-29.json';
import { createRadarContext, radarContextWitness, RADAR_HARNESS_VERSION } from './radar-benchmark-context.mjs';
import { radarVisibilityWitness } from './radar-visibility.mjs';
import { entryPosition } from '../src/static/researchEngine';
import { radarGeometry, stateKey } from '../src/static/positionGeometry';
import '../src/index.css';
import '../src/static/research.css';
import '../src/static/theme/foundation.css';
import '../src/static/theme/motion.css';
import '../src/static/workbench.css';
import '../src/static/components/researchOverview.css';
import './radar-benchmark-context.css';

document.documentElement.dataset.theme = 'dark';
const tokens = document.createElement('style');
tokens.textContent = themeCss;
document.head.append(tokens);
window.measureRadar = async ({ width, theme = 'dark' } = {}) => {
  await document.fonts.ready;
  const small = matchMedia('(max-width:700px)').matches;
  const { shell, container } = createRadarContext(document, { width, theme, small });
  const root = createRoot(container);
  // Start at a frame boundary; next-frame time includes the first paint
  // opportunity, whereas render/layout records only synchronous actual work.
  await new Promise(resolve => requestAnimationFrame(resolve));
  const start = performance.now();
  flushSync(() => root.render(<SetupRadar ranked={fixture.ranked} small={small} onSelect={() => {}} />));
  container.getBoundingClientRect();
  const renderLayout = performance.now() - start;
  // Set by the real canvas draw loop only after every circle has been painted.
  // A missing/failed draw is NaN and therefore cannot pass the 207-point gate.
  const canvas = container.querySelector('[data-radar-canvas]');
  const count = Number(canvas?.dataset.radarPointCount);
  await new Promise(resolve => requestAnimationFrame(resolve));
  const nextFrame = performance.now() - start;
  // Freeze bitmap/CSS evidence in this endpoint task, without yielding to any
  // later drawing or animation. Reference geometry is derived after readback,
  // so no application geometry or glyph work warms the measured first mount.
  const visibility = radarVisibilityWitness(canvas, () => {
    const points = fixture.ranked.filter(item => item.assessment.qualified).map(({ row }) => {
      const plan = entryPosition(row, null, 'minervini');
      return { distance: plan.pivot ? plan.distance : null, rs: row.rs_rating, volume: row.se_volume_vs_50d, state: stateKey(plan.state) };
    });
    return radarGeometry(points, small ? 340 : 620, small ? 124 : 224);
  });
  // Inspect after the same timed next-frame boundary. Resizing must have
  // completed by that boundary: an initially drawn logical-size canvas alone
  // is not enough. These checks do not exclude any drawing work from timing.
  const box = canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.round(box.width * ratio)), targetHeight = Math.max(1, Math.round(box.height * ratio));
  const pixelAlignment = { width: canvas.width, height: canvas.height, css_width: box.width, css_height: box.height, dpr: ratio,
    target_width: targetWidth, target_height: targetHeight, matches: canvas.width === targetWidth && canvas.height === targetHeight };
  const result = { harness_version: RADAR_HARNESS_VERSION, context: radarContextWitness(shell, container), render_layout_ms: renderLayout, first_frame_ms: nextFrame, visibility, point_count: count, final_point_count: Number(canvas.dataset.radarPointCount), pixel_alignment: pixelAlignment, as_of_date: fixture.as_of_date, source_sha256: fixture.source_sha256 };
  flushSync(() => root.unmount());
  shell.remove();
  return result;
};
