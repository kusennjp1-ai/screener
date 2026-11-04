import { useEffect, useRef, useState } from 'react';

/**
 * Mounts its children once their place comes near the viewport, once the page is idle (`idle`), or at
 * once when `force` asks for them, so a heavy chart below the fold does not slow the first screen.
 * Without IntersectionObserver (older browsers, tests) the children render at once. The placeholder
 * keeps `minHeight` so the page does not jump when they mount.
 */
export default function WhenNear({ children, force = false, idle = false, minHeight = 0, margin = '600px 0px' }) {
  const ref = useRef(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver !== 'function');
  useEffect(() => {
    if (near || force || !ref.current) return undefined;
    const show = () => setNear(true);
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) show(); }, { rootMargin: margin });
    observer.observe(ref.current);
    const idleId = idle && typeof requestIdleCallback === 'function' ? requestIdleCallback(show, { timeout: 2000 }) : null;
    const timer = idle && idleId === null ? setTimeout(show, 1200) : null;
    return () => { observer.disconnect(); if (idleId !== null) cancelIdleCallback(idleId); if (timer !== null) clearTimeout(timer); };
  }, [near, force, idle, margin]);
  return near || force ? children : <div ref={ref} className="brief-deferred" style={{ minHeight }} aria-hidden="true" />;
}
