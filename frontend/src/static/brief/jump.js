import { reducedMotion } from './briefNav';

/** Scrolls to a heading and moves focus there (instantly under reduced motion). */
export function jumpTo(id) {
  const target = document.getElementById(id);
  if (!target) return false;
  target.scrollIntoView?.({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  target.focus?.({ preventScroll: true });
  return true;
}
