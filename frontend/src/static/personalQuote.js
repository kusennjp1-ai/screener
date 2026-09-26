const finite = n => typeof n === 'number' && Number.isFinite(n);
export function normalizeFinnhubQuote(payload, symbol, now = Date.now()) {
  if (!finite(payload?.c) || payload.c <= 0 || !finite(payload.t) || payload.t <= 0 || payload.t * 1000 > now + 5000) return null;
  return { symbol, price: payload.c, as_of: new Date(payload.t * 1000).toISOString(), is_realtime: true, delay_seconds: 0, source: 'Finnhub', feed: 'provider-us' };
}
export function normalizeFinnhubTrade(message, symbol, now = Date.now()) {
  if (message?.type !== 'trade' || !Array.isArray(message.data)) return null;
  const trades = message.data.filter(t => t.s === symbol && finite(t.p) && t.p > 0 && finite(t.t) && t.t > 0 && t.t <= now + 5000);
  const latest = trades.reduce((a,b) => !a || b.t > a.t ? b : a, null);
  return latest ? { symbol, price:latest.p, as_of:new Date(latest.t).toISOString(), is_realtime:true, delay_seconds:0, source:'Finnhub', feed:'provider-us' } : null;
}
export const newerQuote = (old, next) => next && (!old || old.symbol !== next.symbol || Date.parse(next.as_of) >= Date.parse(old.as_of)) ? next : old;
