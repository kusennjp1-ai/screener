import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import WhenNear from './WhenNear';

let observers = [];
class FakeObserver {
  constructor(callback, options) { this.callback = callback; this.options = options; this.disconnected = false; observers.push(this); }
  observe() {}
  disconnect() { this.disconnected = true; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); observers = []; });

describe('deferred mounting', () => {
  it('renders at once where IntersectionObserver is missing', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<WhenNear><p>chart</p></WhenNear>);
    expect(screen.getByText('chart')).toBeInTheDocument();
  });

  it('keeps a placeholder of the given height until the place nears the viewport', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    render(<WhenNear minHeight={640}><p>chart</p></WhenNear>);
    expect(screen.queryByText('chart')).toBeNull();
    expect(document.querySelector('.brief-deferred')).toHaveStyle({ minHeight: '640px' });
    expect(observers[0].options).toEqual({ rootMargin: '600px 0px' });
    act(() => observers[0].callback([{ isIntersecting: true }]));
    expect(screen.getByText('chart')).toBeInTheDocument();
    expect(observers[0].disconnected).toBe(true);
  });

  it('mounts when asked, or once the page is idle', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const { rerender } = render(<WhenNear><p>chart</p></WhenNear>);
    rerender(<WhenNear force><p>chart</p></WhenNear>);
    expect(screen.getByText('chart')).toBeInTheDocument();
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    render(<WhenNear idle><p>idle chart</p></WhenNear>);
    expect(screen.queryByText('idle chart')).toBeNull();
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByText('idle chart')).toBeInTheDocument();
  });
});
