import { useLayoutEffect } from 'react';

export function stickyHeaderClearance(scrollTop, headerBottom) {
  if (!Number.isFinite(scrollTop) || !Number.isFinite(headerBottom) || scrollTop >= headerBottom + 2) return 0;
  return Math.max(0, Math.ceil(headerBottom + 2 - scrollTop));
}

// A sticky sidebar moves upward at the end of its grid. Its nested scrolling
// header must still clear the app navigation rather than becoming half covered.
export function useStickyHeaderClearance(scrollRef, enabled) {
  useLayoutEffect(() => {
    const scroll = scrollRef.current, header = document.querySelector('.leader-header');
    if (!enabled || !scroll || !header) return undefined;
    let frame;
    const update = () => {
      // The unscrolled/mobile layout already clears the header. Avoid an
      // unnecessary synchronous layout measurement on initial rendering.
      const clearance = window.innerWidth > 700 && window.scrollY > 0
        ? stickyHeaderClearance(scroll.getBoundingClientRect().top, header.getBoundingClientRect().bottom)
        : 0;
      const value = clearance ? `${clearance}px` : '';
      if (scroll.style.getPropertyValue('--candidate-header-clearance') !== value) {
        if (value) scroll.style.setProperty('--candidate-header-clearance', value);
        else scroll.style.removeProperty('--candidate-header-clearance');
      }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    for (const node of [scroll, header, scroll.closest('.research-grid')]) if (node) observer?.observe(node);
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect();
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
      scroll.style.removeProperty('--candidate-header-clearance');
    };
  }, [scrollRef, enabled]);
}
