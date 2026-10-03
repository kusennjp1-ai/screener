import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { radarAttributionElement } from './radar-attribution-cases';
import { themeCss } from '../src/static/theme/tokens';
import fixture from './fixtures/radar-207-2026-09-29.json';
import '../src/static/theme/foundation.css';
import '../src/static/workbench.css';

document.documentElement.dataset.theme = 'dark';
const tokens = document.createElement('style');
tokens.textContent = themeCss;
document.head.append(tokens);
let used = false;

// One observation per page: warm executions cannot be mistaken for cold ones.
window.measureRadarAttribution = async mode => {
  if (used) throw Error('Each attribution observation requires a fresh browser context');
  used = true;
  await document.fonts.ready;
  const small = innerWidth < 768;
  const container = document.createElement('div');
  container.style.width = small ? '358px' : '628px';
  document.body.append(container);
  const root = createRoot(container);
  const element = radarAttributionElement(mode, fixture.ranked, small);
  await new Promise(resolve => requestAnimationFrame(resolve));
  performance.mark('radar-attribution:start');
  const start = performance.now();
  flushSync(() => root.render(element));
  container.getBoundingClientRect();
  const renderLayout = performance.now() - start;
  performance.mark('radar-attribution:layout-end');
  const canvas = container.querySelector('[data-radar-canvas]');
  const count = canvas?.hasAttribute('data-radar-point-count') ? Number(canvas.dataset.radarPointCount) : null;
  await new Promise(resolve => requestAnimationFrame(resolve));
  const firstFrame = performance.now() - start;
  performance.mark('radar-attribution:frame-end');

  // All inspection and screenshots occur after the timed interval. Keep the
  // mounted surface until its browser context closes, outside that interval.
  const rect = selector => {
    const node = container.querySelector(selector);
    if (!node) return null;
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  };
  const box = canvas?.getBoundingClientRect(), ratio = devicePixelRatio || 1;
  const alignment = canvas ? {
    width: canvas.width, height: canvas.height, css_width: box.width, css_height: box.height, dpr: ratio,
    matches: canvas.width === Math.max(1, Math.round(box.width * ratio)) && canvas.height === Math.max(1, Math.round(box.height * ratio)),
  } : null;
  return {
    mode, render_layout_ms: renderLayout, first_frame_ms: firstFrame,
    point_count: count, final_point_count: canvas?.hasAttribute('data-radar-point-count') ? Number(canvas.dataset.radarPointCount) : null,
    pixel_alignment: alignment, as_of_date: fixture.as_of_date, source_sha256: fixture.source_sha256,
    frame: { section: rect('.setup-radar'), header: rect('header'), plot: rect('.radar-plot'), footer: rect('footer'),
      text: container.textContent, label: canvas?.getAttribute('aria-label') || null },
  };
};
