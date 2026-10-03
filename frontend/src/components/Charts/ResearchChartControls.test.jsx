import { StrictMode, useLayoutEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ResearchChartControls from './ResearchChartControls';

let width, contentWidth, observers, clientWidthRead, scrollWidthRead;
beforeEach(() => {
  width = 390;
  contentWidth = 650;
  observers = [];
  clientWidthRead = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
    if (this.className === 'research-chart-toolbar') return width;
    if (this.className === 'research-chart-controls') return width - this.parentElement.querySelectorAll('.research-chart-scroll').length * 48;
    return 0;
  });
  scrollWidthRead = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function () {
    return Math.max(contentWidth, this.clientWidth);
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); observers.push(this); }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup({ visible = true } = {}) {
  const onSelect = vi.fn();
  const contents = <><button onClick={onSelect}>日足</button><button>1か月</button><button>図解 詳細</button></>;
  const view = render(<ResearchChartControls visible={visible}>{contents}</ResearchChartControls>);
  const viewport = view.container.querySelector('.research-chart-controls');
  viewport.scrollBy = vi.fn(({ left }) => {
    viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, viewport.scrollLeft + left));
  });
  const previous = () => screen.getByRole('button', { name: '前のチャート操作を表示' });
  const next = () => screen.getByRole('button', { name: '次のチャート操作を表示' });
  const resize = () => act(() => observers.at(-1).callback());
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

  it('does not read geometry or observe an initially hidden toolbar, including hidden updates and scroll events', () => {
    const view = setup({ visible: false });
    expect(observers).toHaveLength(0);
    expect(clientWidthRead).not.toHaveBeenCalled();
    expect(scrollWidthRead).not.toHaveBeenCalled();
    contentWidth = 700;
    view.rerender(<ResearchChartControls visible={false}>{view.contents}<button>追加操作</button></ResearchChartControls>);
    fireEvent.scroll(view.viewport);
    expect(observers).toHaveLength(0);
    expect(clientWidthRead).not.toHaveBeenCalled();
    expect(scrollWidthRead).not.toHaveBeenCalled();
    view.unmount();
    expect(clientWidthRead).not.toHaveBeenCalled();
    expect(scrollWidthRead).not.toHaveBeenCalled();
  });

  it('measures the current width during the reveal layout phase, before any observer callback', () => {
    const onLayout = vi.fn();
    function RevealProbe({ visible }) {
      useLayoutEffect(() => { onLayout(); }, [visible]);
      return <ResearchChartControls visible={visible}><button>日足</button></ResearchChartControls>;
    }
    width = 800;
    const view = render(<RevealProbe visible={false} />);
    width = 390;
    clientWidthRead.mockClear();
    view.rerender(<RevealProbe visible />);
    expect(clientWidthRead.mock.invocationCallOrder[0]).toBeLessThan(onLayout.mock.invocationCallOrder.at(-1));
    expect(screen.getByRole('button', { name: '前のチャート操作を表示' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: '次のチャート操作を表示' })).toHaveAttribute('aria-disabled', 'false');
    expect(observers).toHaveLength(1);
    for (const element of view.container.querySelectorAll('.research-chart-toolbar, .research-chart-controls, .research-chart-control-items')) {
      expect(observers[0].observe).toHaveBeenCalledWith(element);
    }
  });

  it('ignores obsolete observer callbacks and preserves scroll through hide and reveal with changed content', () => {
    const view = setup(), observer = observers[0], next = view.next(), previous = view.previous();
    view.viewport.scrollLeft = 356;
    fireEvent.scroll(view.viewport);
    expect(next).toHaveAttribute('aria-disabled', 'true');
    clientWidthRead.mockClear();
    scrollWidthRead.mockClear();
    view.rerender(<ResearchChartControls visible={false}>{view.contents}</ResearchChartControls>);
    expect(observer.disconnect).toHaveBeenCalledOnce();
    act(() => observer.callback());
    fireEvent.scroll(view.viewport);
    fireEvent.click(previous);
    expect(view.viewport.scrollBy).not.toHaveBeenCalled();
    expect(clientWidthRead).not.toHaveBeenCalled();
    expect(scrollWidthRead).not.toHaveBeenCalled();
    expect(view.viewport.scrollLeft).toBe(356);

    contentWidth = 900;
    view.rerender(<ResearchChartControls>{view.contents}<button>追加操作</button></ResearchChartControls>);
    expect(view.viewport.scrollLeft).toBe(356);
    expect(view.next()).toBe(next);
    expect(view.previous()).toHaveAttribute('aria-disabled', 'false');
    expect(view.next()).toHaveAttribute('aria-disabled', 'false');
    expect(observers).toHaveLength(2);
    clientWidthRead.mockClear();
    scrollWidthRead.mockClear();
    act(() => observer.callback());
    expect(clientWidthRead).not.toHaveBeenCalled();
    expect(scrollWidthRead).not.toHaveBeenCalled();

    width = 550;
    view.resize();
    expect(view.next()).toHaveAttribute('aria-disabled', 'false');
    contentWidth = 810;
    view.resize();
    expect(view.next()).toHaveAttribute('aria-disabled', 'true');
    expect(view.previous()).toHaveAttribute('aria-disabled', 'false');
    view.unmount();
    expect(observers[1].disconnect).toHaveBeenCalledOnce();
    clientWidthRead.mockClear();
    scrollWidthRead.mockClear();
    act(() => observers[1].callback());
    expect(clientWidthRead).not.toHaveBeenCalled();
    expect(scrollWidthRead).not.toHaveBeenCalled();
  });

  it('leaves one live observer after Strict Mode setup replay and disconnects it when hidden', () => {
    const view = render(<StrictMode><ResearchChartControls><button>日足</button></ResearchChartControls></StrictMode>);
    expect(observers).toHaveLength(2);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(observers[1].disconnect).not.toHaveBeenCalled();
    clientWidthRead.mockClear();
    scrollWidthRead.mockClear();
    act(() => observers[0].callback());
    expect(clientWidthRead).not.toHaveBeenCalled();
    expect(scrollWidthRead).not.toHaveBeenCalled();
    view.rerender(<StrictMode><ResearchChartControls visible={false}><button>日足</button></ResearchChartControls></StrictMode>);
    expect(observers[1].disconnect).toHaveBeenCalledOnce();
    expect(observers).toHaveLength(2);
    act(() => observers[1].callback());
    expect(clientWidthRead).not.toHaveBeenCalled();
    expect(scrollWidthRead).not.toHaveBeenCalled();
  });
});
