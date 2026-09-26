const day = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
export const BREAKOUT_PREFIX = 'book-exit-review-v1:';
export function readBreakoutReviews(storage) {
  const records = new Map(); let invalid = 0;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(BREAKOUT_PREFIX)) continue;
    try {
      const r = JSON.parse(storage.getItem(key));
      if (!r || typeof r.symbol !== 'string' || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(r.symbol) || !day(r.asOfDate) || !day(r.breakoutDate) || !day(r.reviewDate) || r.breakoutDate > r.asOfDate || r.reviewDate < r.breakoutDate || r.setupConfirmed !== true || typeof r.source !== 'string' || !r.source.trim() || typeof r.reviewedAtISO !== 'string' || !Number.isFinite(Date.parse(r.reviewedAtISO)) || key !== `${BREAKOUT_PREFIX}${r.symbol}:${r.asOfDate}`) throw Error('Invalid review');
      const id = `${r.symbol}:${r.breakoutDate}`, existing = records.get(id);
      if (!existing || Date.parse(r.reviewedAtISO) > Date.parse(existing.reviewedAtISO)) records.set(id, r);
    } catch { invalid++; }
  }
  return { records: [...records.values()].sort((a,b) => a.breakoutDate.localeCompare(b.breakoutDate) || a.symbol.localeCompare(b.symbol)), invalid };
}
