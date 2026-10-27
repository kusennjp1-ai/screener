import { useCallback, useEffect, useRef } from 'react';

const key = '__screenerChartDialog';
let sequence = 0;

// A same-URL entry lets the browser/Android back gesture dismiss the dialog
// without changing the underlying hash route or losing its selected stock.
export default function useChartDialogHistory(open, onClose) {
  const callback = useRef(onClose);
  callback.current = onClose;
  const entry = useRef(null);
  const close = useCallback(() => {
    const current = entry.current;
    if (current?.closing) return;
    if (current) {
      current.closing = true;
      if (window.history.state?.[key] === current.id) {
        window.history.back();
        return;
      }
    }
    callback.current?.();
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const current = { id: `chart-${Date.now()}-${++sequence}`, closing: false };
    let cancelled = false;
    const pop = () => {
      if (window.history.state?.[key] !== current.id && !current.closed) {
        current.closed = true;
        current.closing = true;
        callback.current?.();
      }
    };
    // StrictMode's rehearsal must not add an entry or navigate history.
    queueMicrotask(() => {
      if (cancelled) return;
      entry.current = current;
      // Forward navigation can revisit the same-URL entry after its dialog
      // unmounted. Reuse it so a subsequent close does not land on an orphan
      // marker or require another Back press to reach the underlying screen.
      const write = window.history.state?.[key] ? 'replaceState' : 'pushState';
      window.history[write]({ ...window.history.state, [key]: current.id }, '', window.location.href);
      window.addEventListener('popstate', pop);
    });
    return () => {
      cancelled = true;
      window.removeEventListener('popstate', pop);
      if (!current.closing && window.history.state?.[key] === current.id) {
        const state = { ...window.history.state };
        delete state[key];
        window.history.replaceState(state, '', window.location.href);
      }
      if (entry.current === current) entry.current = null;
    };
  }, [open]);
  return close;
}
