import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import './researchChartControls.css';

/** Keep the complete control row reachable without adding another row above the plot. */
export default function ResearchChartControls({ children, visible = true, style }) {
  const toolbarRef = useRef(null);
  const viewportRef = useRef(null);
  const itemsRef = useRef(null);
  const viewportId = useId();
  const [edges, setEdges] = useState({ overflow: false, before: false, after: false });

  const measure = useCallback(() => {
    const toolbar = toolbarRef.current, viewport = viewportRef.current, items = itemsRef.current;
    if (!toolbar || !viewport || !items) return;
    // Compare the natural row to the entire toolbar, so the arrows disappear
    // again when it fits, even while they still occupy space in the viewport.
    const overflow = toolbar.clientWidth > 0 && items.scrollWidth > toolbar.clientWidth + 1;
    const before = overflow && viewport.scrollLeft > 1;
    const after = overflow && viewport.scrollWidth - viewport.clientWidth - viewport.scrollLeft > 1;
    setEdges(current => current.overflow === overflow && current.before === before && current.after === after
      ? current : { overflow, before, after });
  }, []);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [toolbarRef.current, viewportRef.current, itemsRef.current]) observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);
  useLayoutEffect(measure, [measure, visible]);

  const scroll = direction => {
    const viewport = viewportRef.current;
    if (!viewport || !(direction < 0 ? edges.before : edges.after)) return;
    // Retain one touch target of context and avoid animated scrolling, including
    // for people who request reduced motion. This never changes the chart range.
    viewport.scrollBy({ left: direction * Math.max(44, viewport.clientWidth - 44), behavior: 'instant' });
    measure();
  };

  return <div ref={toolbarRef} className="research-chart-toolbar" role="group" aria-label="チャート操作"
    aria-hidden={!visible} style={{ ...style, display: visible ? 'flex' : 'none' }}>
    {edges.overflow && <button type="button" className="research-chart-scroll" aria-label="前のチャート操作を表示"
      title="前のチャート操作を表示" aria-controls={viewportId} aria-disabled={!edges.before} onClick={() => scroll(-1)}>
      <span aria-hidden="true">‹</span>
    </button>}
    <div ref={viewportRef} id={viewportId} className="research-chart-controls" onScroll={measure}>
      <div ref={itemsRef} className="research-chart-control-items">{children}</div>
    </div>
    {edges.overflow && <button type="button" className="research-chart-scroll" aria-label="次のチャート操作を表示"
      title="次のチャート操作を表示" aria-controls={viewportId} aria-disabled={!edges.after} onClick={() => scroll(1)}>
      <span aria-hidden="true">›</span>
    </button>}
  </div>;
}
