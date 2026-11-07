// The imperative chart renderer (priceChart.js) is its own chunk (owner option b, JS budget): fetched once the app
// is idle, so opening a stock normally finds it loaded; the service worker precaches it like every built asset.
// Its own module, so PriceChart.jsx exports only the component (React fast refresh).
let renderer = null, pending = null, failed = false;
const listeners = new Set();
const settle = value => { if (failed !== value) { failed = value; for (const listener of listeners) listener(); } };
/** The renderer once its chunk has loaded, else null. */
export const loadedPriceChart = () => renderer;
/** Load the renderer's chunk once (a failed load is retried on the next call). */
export const loadPriceChart = () => (pending ??= import('./priceChart').then(module => { renderer = module.renderPriceChart; settle(false); return renderer; }, error => { pending = null; settle(true); throw error; }));
/**
 * Whether the last load of the chunk failed (and none has succeeded since), for useSyncExternalStore: the chart card and
 * the stock screen then leave out the legend, the chart's notes and the period switch, which describe a chart not drawn.
 */
export const priceChartFailed = () => failed && renderer === null;
export const subscribePriceChart = listener => { listeners.add(listener); return () => listeners.delete(listener); };
if (typeof window !== 'undefined') (window.requestIdleCallback ?? (run => setTimeout(run, 200)))(() => { loadPriceChart().catch(() => null); });
