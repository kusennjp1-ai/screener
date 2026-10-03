// External chart links only; source prices and timing belong to TradingView.

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
