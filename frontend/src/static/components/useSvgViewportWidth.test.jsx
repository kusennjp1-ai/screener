import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useSvgViewportWidth from './useSvgViewportWidth';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Plot() {
  const [ref, width] = useSvgViewportWidth(330);
  return <div ref={ref}><svg role="img" aria-label="responsive plot" viewBox={`0 0 ${width} 184`} /></div>;
}
it('matches CSS-pixel width, preserves a hidden panel width, reacts to resize and disconnects', () => {
  let width = 216, resize;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width }));
  const observe = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback) { resize = callback; } observe = observe; disconnect = disconnect; });
  const { unmount } = render(<Plot />);
  expect(screen.getByRole('img')).toHaveAttribute('viewBox', '0 0 216 184');
  width = 0; act(() => resize());
  expect(screen.getByRole('img')).toHaveAttribute('viewBox', '0 0 216 184');
  width = 286; act(() => resize());
  expect(screen.getByRole('img')).toHaveAttribute('viewBox', '0 0 286 184');
  expect(observe).toHaveBeenCalledOnce(); unmount(); expect(disconnect).toHaveBeenCalledOnce();
});
it('uses a deterministic fallback before a measurable width is available', () => {
  vi.stubGlobal('ResizeObserver', undefined);
  render(<Plot />);
  expect(screen.getByRole('img')).toHaveAttribute('viewBox', '0 0 330 184');
});
