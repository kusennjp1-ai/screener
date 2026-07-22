// TradingView bridge (C89).
//
// The screener is a headless backend + static PWA; it can't (and shouldn't)
// drive TradingView's app or scrape its data. What it CAN do — cleanly, with no
// dependency, no subscription on our side, and no ToS issue — is hand the user's
// own TradingView the context the screener already computed: a deep-link to the
// symbol, and a copyable Pine overlay drawing the exact pivot / stop / targets /
// buy-zone so a TV subscriber sees the screener's plan on their own live chart.

// market -> TradingView exchange prefix. US resolves fine without one; other
// markets need the exchange. Unknown markets fall back to the bare ticker.
const TV_EXCHANGE = {
  US: '', HK: 'HKEX', JP: 'TSE', TW: 'TWSE', KR: 'KRX', IN: 'BSE', AU: 'ASX', SG: 'SGX', CN: 'SSE',
};

// Strip our data's exchange suffix (0700.HK, 7203.T) down to the bare ticker.
export function tvSymbol(symbol, market) {
  if (!symbol) return null;
  const base = String(symbol).trim().toUpperCase().split('.')[0];
  if (!base) return null;
  const ex = TV_EXCHANGE[String(market || 'US').toUpperCase()] ?? '';
  return ex ? `${ex}:${base}` : base;
}

export function tradingViewUrl(symbol, market) {
  const sym = tvSymbol(symbol, market);
  if (!sym) return null;
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}`;
}

const CHASE_CAP = 1.05; // pivot +5% chase limit — matches the buy card

// Build a Pine v5 overlay drawing the screener's plan. Only levels that exist
// are emitted; the numbers are hardcoded constants (hline requires const), so
// the script is a faithful snapshot the user pastes into their own chart.
export function buildPineScript({ symbol, asOf, pivot, stop, stopPct, target2r, target3r } = {}) {
  const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const p = num(pivot); const s = num(stop); const t2 = num(target2r); const t3 = num(target3r);
  const sp = num(stopPct);
  const sym = (symbol || 'SYMBOL').toString().toUpperCase();
  const lines = [
    '//@version=5',
    `indicator("Screener Plan — ${sym}", overlay=true)`,
    `// Minervini/SEPA plan exported from the screener${asOf ? ` (${asOf})` : ''}.`,
    '// Levels are a point-in-time snapshot — re-export when the setup updates.',
  ];
  if (p != null) {
    lines.push(`pivot = ${p}`);
    lines.push('hline(pivot, "Pivot (buy trigger)", color=color.new(color.teal, 0), linewidth=2)');
    lines.push(`zoneHi = ${+(p * CHASE_CAP).toFixed(4)}  // pivot +5% chase cap`);
    lines.push('hline(zoneHi, "Chase cap +5%", color=color.new(color.teal, 55), linestyle=hline.style_dotted)');
    lines.push('bgcolor(close >= pivot and close <= zoneHi ? color.new(color.teal, 88) : na, title="Buy zone")');
  }
  if (s != null) {
    lines.push(`stop = ${s}${sp != null ? `  // -${sp}%` : ''}`);
    lines.push('hline(stop, "Stop", color=color.new(color.red, 0), linewidth=2, linestyle=hline.style_dashed)');
  }
  if (t2 != null) lines.push(`hline(${t2}, "2R target", color=color.new(color.green, 35))`);
  if (t3 != null) lines.push(`hline(${t3}, "3R target", color=color.new(color.green, 15))`);
  return lines.join('\n');
}
