import { useCallback, useEffect, useState } from 'react';

// Client-side watchlist for the static PWA (C86).
//
// Minervini's edge is disproportionately in the EXIT: a held name breaking its
// 50-DMA must be seen the same day. There is no backend on GitHub Pages, so the
// user's list of names-they-hold lives in localStorage. The WatchlistCard reads
// each watched symbol's exported `sell` block and surfaces the exit action.
//
// A custom event keeps every mounted consumer (the star toggles in the buy list
// and the WatchlistCard) in sync within the tab; the native `storage` event
// covers other tabs.
const KEY = 'todaysWatchlist';
const EVT = 'todaysWatchlist:change';

function read() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function write(symbols) {
  try {
    localStorage.setItem(KEY, JSON.stringify(symbols));
  } catch {
    /* private mode / quota — the list is best-effort, never load-bearing */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVT));
}

export function useWatchlist() {
  const [symbols, setSymbols] = useState(read);

  useEffect(() => {
    const sync = () => setSymbols(read());
    window.addEventListener(EVT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const toggle = useCallback((symbol) => {
    if (!symbol) return;
    const cur = read();
    write(cur.includes(symbol) ? cur.filter((s) => s !== symbol) : [...cur, symbol]);
  }, []);

  const has = useCallback((symbol) => symbols.includes(symbol), [symbols]);

  return { symbols, toggle, has };
}

export default useWatchlist;
