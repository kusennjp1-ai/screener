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
window.measureRadar = async () => {
  await document.fonts.ready;
  const container = document.createElement('div');
  container.style.width = innerWidth < 768 ? '358px' : '628px';
  document.body.append(container);
  const root = createRoot(container);
  // Start at a frame boundary; next-frame time includes the first paint
  // opportunity, whereas render/layout records only synchronous actual work.
  await new Promise(resolve => requestAnimationFrame(resolve));
  const start = performance.now();
  flushSync(() => root.render(<SetupRadar ranked={fixture.ranked} small={innerWidth < 768} onSelect={() => {}} />));
  container.getBoundingClientRect();
  const renderLayout = performance.now() - start;
  const count = container.querySelectorAll('circle > title').length;
  await new Promise(resolve => requestAnimationFrame(resolve));
  const nextFrame = performance.now() - start;
  const result = { render_layout_ms: renderLayout, first_frame_ms: nextFrame, point_count: count, as_of_date: fixture.as_of_date, source_sha256: fixture.source_sha256 };
  flushSync(() => root.unmount());
  container.remove();
  return result;
};
