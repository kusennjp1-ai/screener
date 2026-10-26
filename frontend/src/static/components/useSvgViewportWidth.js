import { useLayoutEffect, useRef, useState } from 'react';

// Keep chart coordinates in CSS pixels so SVG text does not shrink with a
// fixed desktop viewBox on phones. This is the same ResizeObserver pattern as
// LeaderEvidenceChart; a hidden panel keeps its last nonzero measurement.
export default function useSvgViewportWidth(fallback) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const next = element.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
