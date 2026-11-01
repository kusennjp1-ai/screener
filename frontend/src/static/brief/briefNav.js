import { flushSync } from 'react-dom';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Navigate inside a View Transition (when the browser has one), with a direction for the CSS. */
export function useTransitionNavigate() {
  const navigate = useNavigate();
  return useCallback((to, { kind = 'tab', state, replace = false, before } = {}) => {
    const run = () => { flushSync(() => navigate(to, { state, replace })); if (!matchMedia?.('(min-width: 1024px)').matches) window.scrollTo(0, 0); };
    if (typeof document.startViewTransition !== 'function' || reducedMotion()) { run(); return; }
    before?.();
    document.documentElement.dataset.briefNav = kind;
    const transition = document.startViewTransition(run);
    transition.ready?.catch(() => {});
    transition.finished?.catch(() => {}).finally(() => { delete document.documentElement.dataset.briefNav; });
  }, [navigate]);
}

export const meterPercent = value => (Math.max(-10, Math.min(10, value)) + 10) * 5;

