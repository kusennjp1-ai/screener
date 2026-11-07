import { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { chartContentKey, chartIdentityKey } from './chartReadout';
// The renderer is a lazy chunk (priceChartLoader.js): the box keeps its height until it lands.
import { loadedPriceChart, loadPriceChart, priceChartFailed, subscribePriceChart } from './priceChartLoader';

let introducedOnce = false;
/** What the chart box says when the renderer's chunk cannot be loaded. */
const CHART_FAILED_TEXT = 'チャートを読み込めません（通信状態を確認して、再読み込みしてください）';

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
  const [ready, setReady] = useState(() => loadedPriceChart() !== null);
  // The renderer's chunk failed to load (offline before the service worker had it, or a deploy replaced it): the box
  // says so, never an empty frame. The browser keeps a failed module import for the page's life, so the retry reloads it.
  const failed = useSyncExternalStore(subscribePriceChart, priceChartFailed, priceChartFailed);
  const key = chartIdentityKey(model, period);
  const content = chartContentKey(model, period);
  const draw = options => {
    const renderPriceChart = loadedPriceChart();
    if (!element.current || !renderPriceChart) return controller.current;
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
    // Until the renderer's chunk arrives the box keeps its height (no layout shift); it draws when it lands.
    if (!loadedPriceChart()) { let live = true; loadPriceChart().then(() => { if (live) setReady(true); }, () => null); return () => { live = false; }; }
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
  }, [content, period, ready]);
  useLayoutEffect(() => { controller.current?.select(selected); placeLatest(); }, [selected]);
  useEffect(() => {
    const target = element.current;
    if (!target || typeof ResizeObserver !== 'function' || !model?.bars?.length || !ready) return undefined;
    let width = target.clientWidth, timer;
    const observer = new ResizeObserver(() => {
      if (Math.abs(target.clientWidth - width) < 2) return;
      width = target.clientWidth; clearTimeout(timer);
      timer = setTimeout(() => { controller.current = draw({ animate: false }); placeLatest(); }, 120);
    });
    observer.observe(target);
    return () => { clearTimeout(timer); observer.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, period, ready]);
  const down = failed && !ready;
  return <div className="brief-chartbox">
    <div ref={element} className={`brief-chart ${className}`} data-testid="brief-price-chart" />
    {/* The live region is there from the start, so its message is announced when it arrives; the box shows it with the button. */}
    <p className="sr-only" role="status">{down ? CHART_FAILED_TEXT : ''}</p>
    {down ? <div className="brief-chart-failed"><p aria-hidden="true">{CHART_FAILED_TEXT}</p>
      <button type="button" onClick={() => window.location.reload()}>再読み込み</button></div> : null}
    {onLatest ? <button ref={latest} type="button" className="brief-latest" hidden={selected === null} onClick={onLatest}>最新足</button> : null}
  </div>;
});

export default memo(PriceChart);
