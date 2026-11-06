import { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { chartContentKey, chartIdentityKey, renderPriceChart } from './priceChart';

let introducedOnce = false;

/**
 * Large daily chart. Animates once per symbol/period; resizes redraw without animation. `onScrub` gets the
 * bar index (into the chart interval's bars) a touch, drag or the mouse selects, or null for the latest
 * bar; `selected` places the crosshair. While a past bar is selected, 「最新足」 (`onLatest`) sits in the
 * plot corner with the fewest candles. The handle moves the stop, emphasises a contraction and selects a bar.
 */
const PriceChart = forwardRef(function PriceChart({ model, period, className = '', onScrub = null, selected = null, onLatest = null }, ref) {
  const element = useRef(null), controller = useRef(null), introduced = useRef(null), stopRef = useRef(model?.stop);
  const scrubRef = useRef(onScrub), selectedRef = useRef(selected), legRef = useRef(null), latest = useRef(null);
  stopRef.current = model?.stop; scrubRef.current = onScrub; selectedRef.current = selected;
  // 「最新足」 takes the free corner of the drawn chart (its size is measured once it is shown).
  const placeLatest = () => {
    const button = latest.current;
    if (!button || button.hidden) return;
    const corner = controller.current?.freeCorner?.(button.offsetWidth || 72, button.offsetHeight || 44);
    if (corner) { button.style.left = `${corner.x}px`; button.style.top = `${corner.y}px`; }
  };
  const key = chartIdentityKey(model, period);
  const content = chartContentKey(model, period);
  const draw = options => {
    const chart = renderPriceChart(element.current, { ...model, stop: stopRef.current }, { period, onScrub: index => scrubRef.current?.(index), selected: selectedRef.current, ...options });
    if (chart && legRef.current !== null) chart.highlightLeg(legRef.current);
    return chart;
  };
  useImperativeHandle(ref, () => ({
    moveStop: value => controller.current?.moveStop(value),
    highlightLeg: index => { legRef.current = index ?? null; return controller.current?.highlightLeg(legRef.current) ?? false; },
    select: index => controller.current?.select(index),
  }), []);
  useLayoutEffect(() => {
    if (!element.current || !model?.bars?.length) return undefined;
    const abort = new AbortController();
    const animate = introduced.current !== key;
    controller.current = draw({ animate, fast: animate && introducedOnce, signal: abort.signal });
    placeLatest();
    let painted = false;
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => { painted = true; if (animate) introducedOnce = true; }) : null;
    if (animate) introduced.current = key;
    return () => {
      abort.abort();
      if (frame !== null) cancelAnimationFrame(frame);
      // A remount before the first frame (React's development double effect) must replay the intro.
      if (animate && !painted) introduced.current = null;
    };
    // The stop moves through the controller; content changes redraw, identity changes animate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, period]);
  useLayoutEffect(() => { controller.current?.select(selected); placeLatest(); }, [selected]);
  useEffect(() => {
    const target = element.current;
    if (!target || typeof ResizeObserver !== 'function' || !model?.bars?.length) return undefined;
    let width = target.clientWidth, timer;
    const observer = new ResizeObserver(() => {
      if (Math.abs(target.clientWidth - width) < 2) return;
      width = target.clientWidth; clearTimeout(timer);
      timer = setTimeout(() => { controller.current = draw({ animate: false }); placeLatest(); }, 120);
    });
    observer.observe(target);
    return () => { clearTimeout(timer); observer.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, period]);
  return <div className="brief-chartbox">
    <div ref={element} className={`brief-chart ${className}`} data-testid="brief-price-chart" />
    {onLatest ? <button ref={latest} type="button" className="brief-latest" hidden={selected === null} onClick={onLatest}>最新足</button> : null}
  </div>;
});

export default memo(PriceChart);
