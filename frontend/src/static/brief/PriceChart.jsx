import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { renderPriceChart } from './priceChart';

let introducedOnce = false;

/** Large daily chart. Animates once per symbol/period; resizes redraw without animation. */
const PriceChart = forwardRef(function PriceChart({ model, period, className = '' }, ref) {
  const element = useRef(null), controller = useRef(null), introduced = useRef(null), stopRef = useRef(model?.stop);
  stopRef.current = model?.stop;
  const key = model ? `${model.symbol}|${period}|${model.bars?.length}|${model.bars?.at(-1)?.date}` : null;
  // Levels and overlays can arrive after the bars (detail merge); they redraw without replaying the intro.
  const content = model ? `${key}|${model.pivot}|${model.upper}|${model.rsNewHigh}|${model.rsLine?.length}|${model.legs?.length}|${model.dryUpLeg?.startDate}|${(model.sellMarks || []).map(m => m.date).join(',')}` : null;
  useImperativeHandle(ref, () => ({ moveStop: value => controller.current?.moveStop(value) }), []);
  useLayoutEffect(() => {
    if (!element.current || !model?.bars?.length) return undefined;
    const abort = new AbortController();
    const animate = introduced.current !== key;
    controller.current = renderPriceChart(element.current, { ...model, stop: stopRef.current }, { period, animate, fast: animate && introducedOnce, signal: abort.signal });
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
  useEffect(() => {
    const target = element.current;
    if (!target || typeof ResizeObserver !== 'function' || !model?.bars?.length) return undefined;
    let width = target.clientWidth, timer;
    const observer = new ResizeObserver(() => {
      if (Math.abs(target.clientWidth - width) < 2) return;
      width = target.clientWidth; clearTimeout(timer);
      timer = setTimeout(() => { controller.current = renderPriceChart(target, { ...model, stop: stopRef.current }, { period, animate: false }); }, 120);
    });
    observer.observe(target);
    return () => { clearTimeout(timer); observer.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, period]);
  return <div ref={element} className={`brief-chart ${className}`} data-testid="brief-price-chart" />;
});

export default PriceChart;
