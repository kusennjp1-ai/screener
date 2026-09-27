// Validate actual vendor values. Never fabricate OHLC, volume or split ratios.
export const brokenHistory = bars => !Array.isArray(bars) || !bars.length || bars.some((b,i) =>
  !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !Number.isFinite(Date.parse(b.date)) ||
  new Date(b.date).toISOString().slice(0,10) !== b.date || [0,6].includes(new Date(b.date).getUTCDay()) ||
  ![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite) ||
  b.high < Math.max(b.open,b.close,b.low) || b.low > Math.min(b.open,b.close) || b.low <= 0 || b.volume < 0 ||
  (i > 0 && (b.date <= bars[i-1].date || b.close/bars[i-1].close >= 1.8 || b.close/bars[i-1].close <= .55)));

export function vendorHistory(raw, symbol, asOfDate) {
  if (raw?.meta?.symbol?.toUpperCase() !== symbol.toUpperCase()) throw Error('Vendor symbol mismatch');
  const quote = raw.indicators?.quote?.[0];
  if (!quote || !Array.isArray(raw.timestamp)) throw Error('Vendor history unavailable');
  const bars = raw.timestamp.map((t,i) => ({date:new Date(t*1000).toISOString().slice(0,10),
    ...Object.fromEntries(['open','high','low','close','volume'].map(k=>[k,quote[k]?.[i]]))})).filter(b=>b.date<=asOfDate);
  // Do not silently discard incomplete sessions to turn a failed series into a pass.
  if (bars.length < 252 || bars.at(-1)?.date !== asOfDate || brokenHistory(bars)) throw Error('Replacement fails date/252-bar/OHLCV/continuity checks');
  return bars;
}
