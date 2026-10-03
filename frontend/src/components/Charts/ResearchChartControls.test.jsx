import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ResearchChartControls from './ResearchChartControls';

let width, contentWidth, observers;
beforeEach(() => {
  width = 390;
  contentWidth = 650;
  observers = [];
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
    if (this.className === 'research-chart-toolbar') return width;
    if (this.className === 'research-chart-controls') return width - this.parentElement.querySelectorAll('.research-chart-scroll').length * 48;
    return 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function () {
    return Math.max(contentWidth, this.clientWidth);
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); observers.push(this); }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const onSelect = vi.fn();
  const contents = <><button onClick={onSelect}>日足</button><button>1か月</button><button>図解 詳細</button></>;
  const view = render(<ResearchChartControls>{contents}</ResearchChartControls>);
  const viewport = view.container.querySelector('.research-chart-controls');
  viewport.scrollBy = vi.fn(({ left }) => {
    viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, viewport.scrollLeft + left));
  });
  const previous = () => screen.getByRole('button', { name: '前のチャート操作を表示' });
  const next = () => screen.getByRole('button', { name: '次のチャート操作を表示' });
  const resize = () => act(() => observers[0].callback());
  return { ...view, viewport, previous, next, resize, onSelect, contents };
}

describe('research chart control overflow', () => {
  it('exposes labelled navigation only when the complete row cannot fit', () => {
    width = 800;
    const view = setup();
    expect(screen.queryByRole('button', { name: '次のチャート操作を表示' })).not.toBeInTheDocument();
    width = 390;
    view.resize();
    expect(view.previous()).toHaveAttribute('aria-disabled', 'true');
    expect(view.next()).toHaveAttribute('aria-disabled', 'false');
    expect(view.next()).toHaveAttribute('aria-controls', view.viewport.id);
    // The arrows themselves must not keep the toolbar in an overflow state.
    width = 680;
    view.resize();
    expect(screen.queryByRole('button', { name: '次のチャート操作を表示' })).not.toBeInTheDocument();
  });

  it('scrolls the toolbar in overlapping pages and keeps focus at either end', async () => {
    const user = userEvent.setup(), view = setup();
    view.next().focus();
    await user.keyboard('{Enter}');
    expect(view.viewport.scrollLeft).toBe(250);
    expect(view.previous()).toHaveAttribute('aria-disabled', 'false');
    expect(view.next()).toHaveFocus();
    await user.keyboard(' ');
    expect(view.viewport.scrollLeft).toBe(356);
    expect(view.next()).toHaveAttribute('aria-disabled', 'true');
    expect(view.next()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(view.viewport.scrollBy).toHaveBeenCalledTimes(2);
    expect(view.onSelect).not.toHaveBeenCalled();
    fireEvent.click(view.previous());
    fireEvent.click(view.previous());
    expect(view.viewport.scrollLeft).toBe(0);
    expect(view.previous()).toHaveAttribute('aria-disabled', 'true');
    expect(view.viewport.scrollBy).toHaveBeenLastCalledWith({ left: -250, behavior: 'instant' });
    // Ordinary controls remain in the native tab sequence.
    view.previous().focus();
    await user.tab();
    expect(screen.getByRole('button', { name: '日足' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(view.onSelect).toHaveBeenCalledOnce();
  });

  it('updates both edge cues after native touch, keyboard-focus or programmatic scrolling', () => {
    const view = setup();
    view.viewport.scrollLeft = 120;
    fireEvent.scroll(view.viewport);
    expect(view.previous()).toHaveAttribute('aria-disabled', 'false');
    expect(view.next()).toHaveAttribute('aria-disabled', 'false');
    view.viewport.scrollLeft = 355.5;
    fireEvent.scroll(view.viewport);
    expect(view.next()).toHaveAttribute('aria-disabled', 'true');
    view.viewport.scrollLeft = -2; // Elastic overscroll still represents the start.
    fireEvent.scroll(view.viewport);
    expect(view.previous()).toHaveAttribute('aria-disabled', 'true');
  });

  it('observes content changes and keeps controls mounted through pending chart data', () => {
    const view = setup(), daily = screen.getByRole('button', { name: '日足' });
    contentWidth = 350;
    view.resize();
    expect(screen.queryByRole('button', { name: '次のチャート操作を表示' })).not.toBeInTheDocument();
    view.rerender(<ResearchChartControls visible={false}>{view.contents}</ResearchChartControls>);
    expect(screen.queryByRole('group', { name: 'チャート操作' })).not.toBeInTheDocument();
    expect(daily).not.toBeVisible();
    contentWidth = 700;
    view.rerender(<ResearchChartControls>{view.contents}</ResearchChartControls>);
    expect(screen.getByRole('button', { name: '日足' })).toBe(daily);
    expect(view.next()).toHaveAttribute('aria-disabled', 'false');
    expect(observers[0].observe).toHaveBeenCalledWith(view.viewport);
    expect(observers[0].observe).toHaveBeenCalledWith(view.container.querySelector('.research-chart-control-items'));
    view.unmount();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
  });
});
