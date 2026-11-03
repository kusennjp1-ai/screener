import { useCallback, useSyncExternalStore } from 'react';

/**
 * A media query as React state, read synchronously on the first render (no flash of the
 * phone layout on a desktop). Lets the static app run without the Material UI runtime.
 */
export default function useMediaQuery(query) {
  const subscribe = useCallback(onChange => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const list = window.matchMedia(query);
    list.addEventListener?.('change', onChange);
    return () => list.removeEventListener?.('change', onChange);
  }, [query]);
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, read, () => false);
}
