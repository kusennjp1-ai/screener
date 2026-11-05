// The index position the market tab shows and the market-regime study judged its states with (marketTabModel
// re-exports it; tools/market-regime-study.mjs and tools/export-market-trends.mjs import it). It has no imports,
// so plain Node runs the same code the browser does.
const finite = Number.isFinite;
const YEAR = 252;

/** Last close, its distance from the 50-day (and 200-day) line and from the highest close of the last 252 sessions. */
export function indexSummary(sp500) {
  const all = (sp500 || []).filter(p => finite(p.close));
  if (all.length < 60) return null;
  const last = all.at(-1), mean = n => all.slice(-n).reduce((sum, p) => sum + p.close, 0) / n, year = all.slice(-YEAR);
  return { date: last.date, close: last.close, vsMa: 100 * (last.close / mean(50) - 1), vs200: all.length >= 200 ? 100 * (last.close / mean(200) - 1) : null,
    fromHigh: 100 * (last.close / Math.max(...year.map(p => p.close)) - 1), fullYear: year.length >= YEAR };
}
