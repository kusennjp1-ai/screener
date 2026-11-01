// Per-viewer choice of the screen the app opens on. The research workspace stays the
// default; a viewer who opts in lands on the daily brief when opening the app at its root.
export const START_SCREEN_KEY = 'screener:start-screen';

export function readStartScreen() {
  try { return window.localStorage.getItem(START_SCREEN_KEY) === 'brief' ? 'brief' : 'research'; } catch { return 'research'; }
}

/** Returns false when the choice cannot be stored (private mode, blocked storage). */
export function writeStartScreen(value) {
  try {
    if (value === 'brief') window.localStorage.setItem(START_SCREEN_KEY, 'brief');
    else window.localStorage.removeItem(START_SCREEN_KEY);
    return true;
  } catch { return false; }
}

/**
 * Called once, before the hash router reads the location: an opted-in viewer who opened
 * the app at its root is moved to #/brief. Later visits to #/ (the 従来の画面 link) are kept.
 */
export function landOnChosenStartScreen() {
  if (typeof window === 'undefined' || !['', '#', '#/'].includes(window.location.hash) || readStartScreen() !== 'brief') return false;
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#/brief`);
  return true;
}
