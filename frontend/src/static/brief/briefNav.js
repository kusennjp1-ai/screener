import { flushSync } from 'react-dom';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// A phone: 520px and narrower, where rows are compacted and lists page by 20.
export const PHONE_QUERY = '(max-width:520px)';

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const viewTransitions = () => typeof document !== 'undefined' && typeof document.startViewTransition === 'function' && !reducedMotion();

/** Navigate inside a View Transition (when the browser has one), with a direction for the CSS. */
export function useTransitionNavigate() {
  const navigate = useNavigate();
  return useCallback((to, { kind = 'tab', state, replace = false, before } = {}) => {
    // Going back keeps the scroll position: the screen restores its own (BriefApp), never the top.
    const run = () => { flushSync(() => navigate(to, { state, replace })); if (kind !== 'back' && !matchMedia?.('(min-width: 1024px)').matches) window.scrollTo(0, 0); };
    // Desktop tab switches change only the left column; a whole-page transition would only delay it.
    const wideTab = kind === 'tab' && typeof matchMedia === 'function' && matchMedia('(min-width: 1024px)').matches;
    if (!viewTransitions() || wideTab) { run(); return; }
    before?.();
    document.documentElement.dataset.briefNav = kind;
    const transition = document.startViewTransition(run);
    transition.ready?.catch(() => {});
    transition.finished?.catch(() => {}).finally(() => { delete document.documentElement.dataset.briefNav; });
  }, [navigate]);
}

/**
 * Where the in-app 戻る goes. With an earlier entry in this tab's in-app history (React Router's
 * `history.state.idx` above 0) it is the browser's own back, so the list keeps its place and no entry is
 * added. Otherwise (a direct link, also after stepping, since steps replace the entry) it replaces the stock
 * with the list it came from and never leaves the app.
 */
export function backPlan(historyState, from) {
  const idx = historyState?.idx;
  return Number.isInteger(idx) && idx > 0 ? { history: true, to: null } : { history: false, to: from === 'today' || !from ? '/brief' : `/brief/${from}` };
}

/** The in-app 戻る (see backPlan), inside a View Transition when the browser has one. */
export function useBriefBack() {
  const go = useTransitionNavigate();
  return useCallback(from => {
    const plan = backPlan(window.history.state, from);
    if (!plan.history) { go(plan.to, { kind: 'back', replace: true }); return; }
    if (!viewTransitions()) { window.history.back(); return; }
    document.documentElement.dataset.briefNav = 'back';
    // The new view is the one React commits on popstate; a timer ends the transition if none arrives.
    const transition = document.startViewTransition(() => new Promise(resolve => {
      let timer = null;
      const done = () => { window.removeEventListener('popstate', done); clearTimeout(timer); setTimeout(resolve, 0); };
      timer = setTimeout(done, 400);
      window.addEventListener('popstate', done);
      window.history.back();
    }));
    transition.ready?.catch(() => {});
    transition.finished?.catch(() => {}).finally(() => { delete document.documentElement.dataset.briefNav; });
  }, [go]);
}

/**
 * The next (direction 1) or previous (−1) stock of a sequence, without wrapping around: { symbol }, or
 * { edge: 'end' | 'start' } at either end. A stock outside the sequence enters it at its first (next) or
 * last (previous) stock. Null when there is nothing to step through.
 */
export function stepTarget(sequence, selected, direction) {
  if (!sequence?.length || !selected) return null;
  const at = sequence.indexOf(selected);
  if (at < 0) return { symbol: sequence[direction > 0 ? 0 : sequence.length - 1] };
  const next = at + (direction > 0 ? 1 : -1);
  if (next >= sequence.length) return { edge: 'end' };
  if (next < 0) return { edge: 'start' };
  return { symbol: sequence[next] };
}

// Each list screen's scroll position when a stock was opened from it, for this tab's session only.
const SCROLL_KEY = 'brief-scroll';
const readScrolls = () => { try { const value = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } };
/** Keep where a list screen was scrolled when `symbol` was opened from it. Blocked storage keeps nothing. */
export function rememberScroll(screen, symbol, y) {
  try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ ...readScrolls(), [screen]: { y: Math.max(0, Math.round(y)), symbol } })); } catch { /* a per-session convenience only */ }
}
/** The kept position of a list screen: { y, symbol } or null. */
export function recallScroll(screen) {
  const value = readScrolls()[screen];
  return value && Number.isFinite(value.y) && typeof value.symbol === 'string' ? value : null;
}

export const meterPercent = value => (Math.max(-10, Math.min(10, value)) + 10) * 5;
