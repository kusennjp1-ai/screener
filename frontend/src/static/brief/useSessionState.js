import { useCallback, useState } from 'react';

const PREFIX = 'brief-open:';

/**
 * A small piece of UI state (an expander's open state, the market tab's section) kept for this tab's
 * session: it survives a screen change and a reload, never another tab or a later visit. Storage that
 * is blocked leaves it a plain state.
 */
export default function useSessionState(key, fallback) {
  const [value, setValue] = useState(() => {
    try { const raw = sessionStorage.getItem(`${PREFIX}${key}`); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; }
  });
  const update = useCallback(next => setValue(previous => {
    const resolved = typeof next === 'function' ? next(previous) : next;
    try { sessionStorage.setItem(`${PREFIX}${key}`, JSON.stringify(resolved)); } catch { /* per-session convenience only */ }
    return resolved;
  }), [key]);
  return [value, update];
}
