// The stock screen's body (StockView and its cards) is its own chunk, so Today, 候補 and ウォッチ do not download or
// parse it. BriefApp fetches it once the first screen is idle (and at once where a stock is on the first screen), so
// opening a stock normally finds it loaded; the service worker precaches it like every built asset. A store like the
// chart renderer's (priceChartLoader.js): StockScreen renders the loaded module directly, without a fallback frame.
let loaded = null, pending = null, failed = false;
const listeners = new Set();
const settle = value => { if (failed !== value) { failed = value; for (const listener of listeners) listener(); } };
/** The stock screen's module ({ default: StockView }) once its chunk has loaded, else null. */
export const loadedStockView = () => loaded;
/** Load the chunk once (a failed load is retried on the next call). Resolves to the module, as React.lazy takes it. */
export const loadStockView = () => (pending ??= import('./StockView').then(module => { loaded = module; settle(false); return module; }, error => { pending = null; settle(true); throw error; }));
/** Whether the last load of the chunk failed (and none has succeeded since), for useSyncExternalStore. */
export const stockViewFailed = () => failed && loaded === null;
export const subscribeStockView = listener => { listeners.add(listener); return () => listeners.delete(listener); };
/**
 * How long a phone's tap on a row waits for this chunk before the stock screen opens on its loading line (BriefApp's
 * open). Above the wait for a chunk that is merely still on its way (about 50-110 ms from a local server at Design
 * Acceptance's 4x CPU slowdown; one round trip and about 25 kB gzip, roughly 0.3 s, on a slow 4G network), and short
 * enough that a tap on a stalled connection still answers within about 0.4 s.
 */
export const STOCK_TAP_WAIT_MS = 400;
