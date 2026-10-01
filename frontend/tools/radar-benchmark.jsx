import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import SetupRadar from '../src/static/components/SetupRadar';
import { themeCss } from '../src/static/theme/tokens';
import fixture from './fixtures/radar-207-2026-09-29.json';
import '../src/static/theme/foundation.css';
import '../src/static/workbench.css';

document.documentElement.dataset.theme = 'dark';
const tokens = document.createElement('style');
tokens.textContent = themeCss;
document.head.append(tokens);
window.measureRadar = async ({ width } = {}) => {
  await document.fonts.ready;
  const container = document.createElement('div');
  container.style.width = Number.isFinite(width) && width > 0 ? `${width}px` : innerWidth < 768 ? '358px' : '628px';
  document.body.append(container);
  const root = createRoot(container);
  // Start at a frame boundary; next-frame time includes the first paint
  // opportunity, whereas render/layout records only synchronous actual work.
  await new Promise(resolve => requestAnimationFrame(resolve));
  const start = performance.now();
  flushSync(() => root.render(<SetupRadar ranked={fixture.ranked} small={innerWidth < 768} onSelect={() => {}} />));
  container.getBoundingClientRect();
  const renderLayout = performance.now() - start;
  // Set by the real canvas draw loop only after every circle has been painted.
  // A missing/failed draw is NaN and therefore cannot pass the 207-point gate.
  const canvas = container.querySelector('[data-radar-canvas]');
  const count = Number(canvas?.dataset.radarPointCount);
  await new Promise(resolve => requestAnimationFrame(resolve));
  const nextFrame = performance.now() - start;
  // Inspect after the same timed next-frame boundary. Resizing must have
  // completed by that boundary: an initially drawn logical-size canvas alone
  // is not enough. These checks do not exclude any drawing work from timing.
  const box = canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.round(box.width * ratio)), targetHeight = Math.max(1, Math.round(box.height * ratio));
  const pixelAlignment = { width: canvas.width, height: canvas.height, css_width: box.width, css_height: box.height, dpr: ratio,
    target_width: targetWidth, target_height: targetHeight, matches: canvas.width === targetWidth && canvas.height === targetHeight };
  const result = { render_layout_ms: renderLayout, first_frame_ms: nextFrame, point_count: count, final_point_count: Number(canvas.dataset.radarPointCount), pixel_alignment: pixelAlignment, as_of_date: fixture.as_of_date, source_sha256: fixture.source_sha256 };
  flushSync(() => root.unmount());
  container.remove();
  return result;
};
