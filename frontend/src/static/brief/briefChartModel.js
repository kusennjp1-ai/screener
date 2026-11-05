// Chart-derived view model for the stock screen: the Weinstein stage, the RS line's new high and its
// leadership marks, the VCP footprint, the opening gaps and the up/down volume ratio, each from the bars
// it is given (the caller passes only certified bars where a value judges the stock). Unknown stays null.
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

/**
 * VCP footprint from measured legs (独自近似), e.g. "VCP 14週 13/4 2T". The base's weeks run from the
 * base high (the first contraction's start) to the last bar, or to the base's end when the price has
 * since traded above the base high: the text then says 「・上抜け済み（MM/DD）」 and `brokeOut` is true.
 * legs[0] is 「最初の押し」, and 「最大の押し」 only when it really is the deepest; the last one is 「最後の押し」.
 */
export function footprint(evidence, bars) {
  const vcp = evidence?.vcp, legs = vcp?.legs || [];
  if (legs.length < 2 || !vcp.measurementsValid) return null;
  const brokeOut = vcp.base?.brokeOut === true && Boolean(vcp.base.endDate);
  const first = vcp.base?.startDate || legs[0].startDate, last = brokeOut ? vcp.base.endDate : bars?.at?.(-1)?.date || legs.at(-1).endDate;
  const weeks = Math.max(1, Math.round((Date.parse(last) - Date.parse(first)) / DAY / 7));
  const deepest = legs.slice(1).every(leg => leg.depthPct <= legs[0].depthPct);
  const firstLabel = vcp.droppedLegs > 0 ? '直近6回のうち最初の押し' : deepest ? '最大の押し' : '最初の押し';
  const breakoutDate = brokeOut ? vcp.base.breakoutDate ?? null : null;
  const broke = brokeOut ? `・上抜け済み${breakoutDate ? `（${breakoutDate.slice(5).replace('-', '/')}）` : ''}` : '';
  return { weeks, first: legs[0].depthPct, last: legs.at(-1).depthPct, firstLabel, firstIsDeepest: deepest, count: legs.length, brokeOut, breakoutDate,
    // Only progressively shallower contractions are called a VCP; otherwise say what was measured.
    text: `${vcp.depthsContract === true ? 'VCP' : '収縮'} ${weeks}週 ${Math.round(legs[0].depthPct)}/${Math.round(legs.at(-1).depthPct)} ${legs.length}T${vcp.depthsContract === false ? '（縮小途切れ）' : vcp.depthsContract === true ? '' : '（縮小は未確認）'}${broke}`,
    contracting: vcp.depthsContract, volumeContracting: vcp.volumeContracts };
}

/** RS-line points aligned to the bars' dates, oldest first: [{ index (into bars), date, value }]. */
function alignedRs(rsLine, bars) {
  const byDate = new Map((rsLine || []).filter(p => finite(p?.value)).map(p => [p.time || p.date, p.value]));
  return (bars || []).map((bar, index) => ({ index, date: bar?.date, value: byDate.get(bar?.date) })).filter(p => finite(p.value));
}

/**
 * RS-line leadership on certified bars (pass only those): every bar from the 253rd aligned RS point on
 * where the RS line is at or above the maximum of its previous 252 points while the close is at least
 * RS_LEAD_FROM_HIGH_PERCENT below the bar's own 252-bar high. `eligible` is how many bars could be
 * judged (the 注記's N), `threshold` the latest bar's previous-252 maximum. Null without bars.
 */
export function rsLeadMarks(rsLine, bars) {
  if (!bars?.length) return null;
  const points = alignedRs(rsLine, bars), dates = [];
  for (let k = 252; k < points.length; k++) {
    let prior = -Infinity;
    for (let j = k - 252; j < k; j++) if (points[j].value > prior) prior = points[j].value;
    const i = points[k].index, close = bars[i]?.close;
    let high = -Infinity;
    for (let j = Math.max(0, i - 251); j <= i; j++) if (finite(bars[j]?.high) && bars[j].high > high) high = bars[j].high;
    if (i >= 251 && finite(close) && points[k].value >= prior && close <= high * (1 - RS_LEAD_FROM_HIGH_PERCENT / 100)) dates.push(points[k].date);
  }
  let threshold = null;
  if (points.length >= 253) { threshold = -Infinity; for (const p of points.slice(-253, -1)) threshold = Math.max(threshold, p.value); }
  return { dates, eligible: Math.max(0, points.length - 252), points: points.length, threshold };
}

/** Bars that open at least `percent` of the prior close beyond the prior high (up) or low (down): 独自判定. */
export function gapDays(bars, percent = 2) {
  const out = [];
  for (let i = 1; i < (bars || []).length; i++) {
    const a = bars[i - 1], b = bars[i];
    if (![a?.high, a?.low, a?.close, b?.open].every(finite) || a.close <= 0) continue;
    if (b.open >= a.high + a.close * percent / 100) out.push({ date: b.date, direction: 'up' });
    else if (b.open <= a.low - a.close * percent / 100) out.push({ date: b.date, direction: 'down' });
  }
  return out;
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
