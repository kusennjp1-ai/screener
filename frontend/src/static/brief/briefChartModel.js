// Chart-derived view model for the stock screen: the Weinstein stage, the RS line's new high, the VCP
// footprint and the up/down volume ratio, each from the bars it is given (the caller passes only
// certified bars where a value judges the stock). Unknown stays null.
import { finite } from '../researchEngine';

const DAY = 86400000;
/** The RS line leads when it is at a new high while the price is at least this % below its own high. */
export const RS_LEAD_FROM_HIGH_PERCENT = 2;

/**
 * Weinstein stage for the latest bar with the scanner's rules (backend stage_analysis.py):
 * 200-day SMA change over 20 bars (flat within ±1%), 60-bar least-squares close slope
 * (±0.05% per day) and close versus the 200-day SMA. The swing-pattern exception
 * (below a falling 200-day SMA without a downtrend) is not replayed and counts as 4.
 */
export function stageFromBars(bars) {
  const closes = (bars || []).map(b => b?.close).filter(finite);
  if (closes.length < 219 || closes.length !== (bars || []).length) return null;
  const mean = (from, to) => { let s = 0; for (let i = from; i < to; i++) s += closes[i]; return s / (to - from); };
  const n = closes.length, ma = mean(n - 200, n), past = mean(n - 219, n - 19);
  const change = (ma - past) / past * 100;
  const rising = change >= 1, falling = change <= -1, flat = Math.abs(change) < 1;
  const window = closes.slice(-60), xm = 29.5, ym = window.reduce((a, b) => a + b, 0) / 60;
  let sxy = 0, sxx = 0;
  window.forEach((y, x) => { sxy += (x - xm) * (y - ym); sxx += (x - xm) ** 2; });
  const daily = sxy / sxx / ym * 100, up = daily > 0.05, down = daily < -0.05, above = closes.at(-1) > ma;
  if (above && rising && up) return 2;
  if (!above && falling && down) return 4;
  if (above && (flat || falling)) return 3;
  if (above && rising) return 3;
  if (flat || (!above && rising)) return 1;
  return above ? 3 : 4;
}

/** RS line (price ÷ S&P 500) at or above its high of the prior 251 sessions; null when the history is too short. */
export function rsLineNewHigh(rsLine, bars) {
  const dates = new Set((bars || []).map(b => b.date));
  const values = (rsLine || []).filter(p => dates.has(p.time || p.date) && finite(p.value)).map(p => p.value);
  if (values.length < 252) return null;
  const last = values.at(-1), prior = values.slice(-252, -1);
  return last >= Math.max(...prior);
}

/** VCP footprint text from measured legs, e.g. "VCP 14週 24/3 4T". */
export function footprint(evidence, bars) {
  const legs = evidence?.vcp?.legs || [];
  if (legs.length < 2 || !evidence.vcp.measurementsValid) return null;
  const first = legs[0].startDate, last = bars?.at?.(-1)?.date || legs.at(-1).endDate;
  const weeks = Math.max(1, Math.round((Date.parse(last) - Date.parse(first)) / DAY / 7));
  return { weeks, deepest: legs[0].depthPct, shallowest: legs.at(-1).depthPct, count: legs.length,
    // Only progressively shallower contractions are called a VCP; otherwise say what was measured.
    text: `${evidence.vcp.depthsContract === true ? 'VCP' : '収縮'} ${weeks}週 ${Math.round(legs[0].depthPct)}/${Math.round(legs.at(-1).depthPct)} ${legs.length}T${evidence.vcp.depthsContract === false ? '（縮小途切れ）' : evidence.vcp.depthsContract === true ? '' : '（縮小は未確認）'}`,
    contracting: evidence.vcp.depthsContract, volumeContracting: evidence.vcp.volumeContracts };
}

/**
 * Volume on up closes divided by volume on down closes over the last `sessions` bars
 * (an accumulation/distribution reading). Unchanged closes are skipped; any missing
 * close or volume in the window makes it unknown.
 */
export function upDownVolume(bars, sessions = 50) {
  const list = bars || [];
  if (list.length < sessions + 1) return null;
  let up = 0, down = 0;
  for (let i = list.length - sessions; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    if (!finite(a?.close) || !finite(b?.close) || !finite(b?.volume) || b.volume < 0) return null;
    if (b.close > a.close) up += b.volume; else if (b.close < a.close) down += b.volume;
  }
  return down > 0 ? { ratio: up / down, sessions } : null;
}
