// The imperative chart renderer (priceChart.js) is its own chunk (owner option b, JS budget): fetched once the app
// is idle, so opening a stock normally finds it loaded; the service worker precaches it like every built asset.
// Its own module, so PriceChart.jsx exports only the component (React fast refresh).
let renderer = null, pending = null;
/** The renderer once its chunk has loaded, else null. */
export const loadedPriceChart = () => renderer;
/** Load the renderer's chunk once (a failed load is retried on the next call). */
export const loadPriceChart = () => (pending ??= import('./priceChart').then(module => { renderer = module.renderPriceChart; return renderer; }, error => { pending = null; throw error; }));
if (typeof window !== 'undefined') (window.requestIdleCallback ?? (run => setTimeout(run, 200)))(() => { loadPriceChart().catch(() => null); });
