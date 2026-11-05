import { auditDailyBars } from './qualificationAudit.js';

export const BOOK_TECHNICAL_VERSION = 'book-technical-evidence-v2';
const finite = n => typeof n === 'number' && Number.isFinite(n);
const mean = xs => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

// Report the complete rolling series, not just favourable endpoints. A mixed
// sequence is review-required, not a claim that every discretionary trend fails.
function direction(points, sessions) {
  if (points.length < sessions + 1) return { sessions, state: 'unknown', points: [], reason: `${sessions + 1}点が必要` };
  const window = points.slice(-sessions - 1);
  const differences = window.slice(1).map((p, i) => p.value - window[i].value);
  const up = differences.filter(x => x > 0).length, down = differences.filter(x => x < 0).length;
  return { sessions, points: window, upSteps: up, downSteps: down, flatSteps: sessions - up - down,
    start: window[0], end: window.at(-1), changePct: (window.at(-1).value / window[0].value - 1) * 100,
    state: up === sessions ? 'sustained-up' : down === sessions ? 'sustained-down' : 'mixed',
    method: '全営業日の隣接値を比較。mixedは裁量確認を要する' };
}

function independentRs(bars, benchmark, date) {
  const result = { benchmark: 'SPY', independentRecalculation: false, errors: [], sixWeeks: null, thirteenWeeks: null };
  if (!benchmark || benchmark.symbol !== 'SPY' || benchmark.as_of_date !== date) result.errors.push('同一基準日のSPY価格が必要');
  const reference = benchmark?.bars;
  if (!Array.isArray(reference) || !reference.length) result.errors.push('SPY日足未取得');
  else if (reference.some((b, i) => !b || !validDate(b.date) || [0, 6].includes(new Date(b.date).getUTCDay()) || !finite(b.close) || b.close <= 0 || b.date > date ||
    (i > 0 && b.date <= reference[i - 1].date)) || reference.at(-1).date !== date) result.errors.push('SPYの日付・順序・価格に異常');
  let points = [];
  if (!result.errors.length) {
    const map = new Map(reference.map(b => [b.date, b.close]));
    // Only a contiguous trailing overlap is usable. Never silently bridge a
    // missing benchmark session or fill yesterday's close into today's slot.
    const start = bars.findIndex(b => b.date === reference[0].date);
    const overlap = start >= 0 ? bars.slice(start) : bars.filter(b => b.date >= reference[0].date);
    if (!overlap.length || overlap.some(b => !map.has(b.date))) result.errors.push('株価とSPYの営業日に欠落・不一致');
    else {
      points = overlap.map(b => ({ date: b.date, value: b.close / map.get(b.date), stockClose: b.close, benchmarkClose: map.get(b.date) }));
      result.independentRecalculation = true;
    }
  }
  result.sixWeeks = direction(points, 30);
  result.thirteenWeeks = direction(points, 65);
  result.points = points;
  result.scope = '株価/SPY終値比の独立計算。公式IBDのRS順位ではない';
  return result;
}

function measuredLeg(bars, start, end) {
  const segment = bars.slice(start, end + 1), peak = segment[0];
  const low = Math.min(...segment.map(b => b.low));
  const lowIndex = segment.findIndex(b => b.low === low);
  const baseline = bars.slice(Math.max(0, start - 50), start);
  const preceding50Mean = baseline.length === 50 ? mean(baseline.map(b => b.volume)) : null;
  const lastVolume = segment.at(-1).volume, lastTwoMean = mean(segment.slice(-2).map(b => b.volume));
  return { startDate: peak.date, endDate: segment.at(-1).date,
    peakDate: peak.date, lowDate: segment[lowIndex].date,
    high: peak.high, low, depthPct: (peak.high - low) / peak.high * 100,
    sessions: end - start, bars: segment.length,
    averageVolume: mean(segment.map(b => b.volume)),
    volumeEvidence: { baselineSessions: baseline.length, baselineStart: baseline[0]?.date ?? null, baselineEnd: baseline.at(-1)?.date ?? null,
      preceding50Mean, lastDate: segment.at(-1).date, lastVolume, lastTwoMean,
      intervalRatio: preceding50Mean > 0 ? mean(segment.map(b => b.volume)) / preceding50Mean : null,
      lastRatio: preceding50Mean > 0 ? lastVolume / preceding50Mean : null,
      lastTwoRatio: preceding50Mean > 0 ? lastTwoMean / preceding50Mean : null,
      method: '指定収縮開始前の50営業日と比較。最終1本・2本は指定区間の末尾。50日窓・倍率は実測補助であり書籍の固定閾値ではない' },
    validPeak: peak.high === Math.max(...segment.map(b => b.high)),
    lowAfterPeak: lowIndex > 0 };
}

// Automatic contraction measurement (独自近似). The base starts at its high: the highest swing high
// the zigzag confirms within the lookback (a breakout high not yet followed by a pullback is not one),
// or the Setup Engine's base when its recalculation is current for the analysis date. From there a
// zigzag finds each contraction (swing high → swing low). A reversal counts when it moves at least
// max(1.5×ATR20, 30% of the previous contraction's depth). A lower high followed by a lower low is the
// same decline, not a new contraction: it is merged back into every earlier contraction it undercuts,
// so a base that deepened reads as one deeper first contraction. A pullback whose high is in the lower
// half of the previous contraction's range is the base still repairing, not a contraction. The last
// contraction needs only the noise floor, so a tight 2–4% final T is kept. Measurement stops where the
// price first trades above the base high.
const VCP_LOOKBACK = 150, ATR_SESSIONS = 20, ATR_MULTIPLE = 1.5, DEPTH_FRACTION = 0.3, FINAL_FLOOR_PCT = 1.5, MAX_LEGS = 6, REPAIR_FRACTION = 0.5;
export const VCP_METHOD = Object.freeze({ lookback: VCP_LOOKBACK, atrSessions: ATR_SESSIONS, atrMultiple: ATR_MULTIPLE, depthFraction: DEPTH_FRACTION, finalFloorPct: FINAL_FLOOR_PCT, maxLegs: MAX_LEGS, repairFraction: REPAIR_FRACTION });

/** ATR20 as a percent of each bar's close (trailing true ranges); null until 20 bars exist. */
function atrPercent(bars) {
  const out = new Array(bars.length).fill(null);
  let sum = 0;
  const range = i => (i ? Math.max(bars[i].high, bars[i - 1].close) - Math.min(bars[i].low, bars[i - 1].close) : bars[i].high - bars[i].low);
  for (let i = 0; i < bars.length; i++) {
    sum += range(i);
    if (i >= ATR_SESSIONS) sum -= range(i - ATR_SESSIONS);
    if (i >= ATR_SESSIONS - 1) out[i] = sum / ATR_SESSIONS / bars[i].close * 100;
  }
  return out;
}

/** The Setup Engine's base (its primary pattern's dates) when the recalculation is current for `date`. */
function setupBase(row, bars, date) {
  const calculation = row?.setup_recalculation;
  if (calculation?.status !== 'calculated' || calculation.as_of_date !== date) return null;
  const primary = row?.se_pattern_primary;
  const candidate = Array.isArray(row?.se_candidates) && primary && primary !== 'none' ? row.se_candidates.find(c => c?.pattern === primary) : null;
  if (!candidate || !validDate(candidate.start_date)) return null;
  const start = bars.findIndex(b => b.date >= candidate.start_date);
  let end = bars.length - 1;
  if (validDate(candidate.end_date)) while (end > start && bars[end].date > candidate.end_date) end--;
  if (start < 0 || end <= start) return null;
  let anchor = start;
  for (let i = start; i <= end; i++) if (bars[i].high > bars[anchor].high) anchor = i;
  return anchor < bars.length - 1 ? { anchor, source: 'setup-engine', pattern: primary, startDate: candidate.start_date } : null;
}

function automaticLegs(bars, setup) {
  const atr = atrPercent(bars), n = bars.length;
  const floorAt = i => ATR_MULTIPLE * (atr[i] ?? atr.find(v => v !== null) ?? 0);
  const drop = (h, l) => (bars[h].high - bars[l].low) / bars[h].high * 100;
  const rise = (l, i) => (bars[i].high - bars[l].low) / bars[l].low * 100;
  let anchor = setup?.anchor ?? null;
  if (anchor === null) {
    // Pass 1: confirmed swing highs with the ATR threshold; the base high is the highest of them.
    let mode = 'up', ext = Math.max(0, n - VCP_LOOKBACK);
    for (let i = ext + 1; i < n; i++) {
      if (mode === 'up') {
        if (bars[i].high > bars[ext].high) ext = i;
        else if (drop(ext, i) >= floorAt(ext)) { if (anchor === null || bars[ext].high > bars[anchor].high) anchor = ext; mode = 'down'; ext = i; }
      } else if (bars[i].low < bars[ext].low) ext = i;
      else if (rise(ext, i) >= floorAt(ext)) { mode = 'up'; ext = i; }
    }
  }
  const base = anchor === null ? null : { startDate: bars[anchor].date, high: bars[anchor].high, source: setup ? 'setup-engine' : 'algorithm', ...(setup ? { pattern: setup.pattern } : {}) };
  if (anchor === null) return { base, legs: [], found: 0 };
  // The base ends where the price first trades above its high (a breakout); later swings belong to a new base.
  let stop = anchor + 1;
  while (stop < n && bars[stop].high <= bars[anchor].high) stop++;
  base.endDate = bars[stop - 1].date;
  base.brokeOut = stop < n;
  if (base.brokeOut) base.breakoutDate = bars[stop].date;
  const legs = [];
  const push = (a, b) => {
    let leg = { a, b };
    // The same decline: merge back while the new low undercuts the (merged) previous contraction's low.
    while (legs.length && bars[leg.b].low < bars[legs.at(-1).b].low && bars[leg.a].high <= bars[legs.at(-1).a].high) leg = { a: legs.pop().a, b: leg.b };
    // A pullback from the lower half of the previous contraction's range: the base is still repairing.
    const previous = legs.at(-1);
    if (previous && bars[leg.a].high < bars[previous.b].low + REPAIR_FRACTION * (bars[previous.a].high - bars[previous.b].low)) return;
    legs.push({ ...leg, depth: drop(leg.a, leg.b) });
  };
  let mode = 'down', hi = anchor, lo = null;
  for (let i = anchor + 1; i < stop; i++) {
    if (mode === 'down') {
      if (lo === null || bars[i].low < bars[lo].low) lo = i;
      else if (rise(lo, i) >= Math.max(floorAt(lo), DEPTH_FRACTION * drop(hi, lo))) { push(hi, lo); mode = 'up'; hi = i; lo = null; }
    } else if (bars[i].high > bars[hi].high) hi = i;
    else if (drop(hi, i) >= Math.max(floorAt(hi), legs.length ? DEPTH_FRACTION * legs.at(-1).depth : 0)) { mode = 'down'; lo = i; }
  }
  if (mode === 'down' && lo !== null) push(hi, lo);
  else if (mode === 'up') {
    // The final contraction: only the noise floor (1.5%, or one ATR20 when that is larger) applies.
    let low = null;
    for (let j = hi + 1; j < stop; j++) if (low === null || bars[j].low < bars[low].low) low = j;
    if (low !== null && drop(hi, low) >= Math.max(FINAL_FLOOR_PCT, atr[hi] ?? 0)) push(hi, low);
  }
  return { base, legs: legs.map(({ a, b }) => measuredLeg(bars, a, b)), found: legs.length };
}

function contractions(bars, review, { row = null, date = null } = {}) {
  const result = { scope: 'OHLCV実測を伴う通常VCPの候補。パワープレー等の例外は別評価',
    certification: false, source: 'algorithm', reviewer: null, errors: [], legs: [], base: null,
    limitations: ['ベース高値（直近150本で確定した最高のスイング高値、またはSetup Engineの現在のベース）からのジグザグ測定は独自近似',
      '反転幅は1.5×ATR20と直前の収縮の深さの3割の大きい方。最後の収縮は雑音下限（1.5%とATR20の大きい方）のみ',
      '前の収縮の安値を割り込んだ押しは同じ下げとして前の収縮に含め、前の収縮の値幅の下半分からの押しは土台の修復中として数えない',
      '出来高区間平均は売り枯れの代理指標', 'ベース全体の位置・ステージ・買い場は別途確認'] };
  if (review != null) {
    result.source = 'reviewer-intervals';
    if (typeof review.source !== 'string' || !review.source.trim() || typeof review.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(review.reviewedAt) ||
      !Number.isFinite(Date.parse(review.reviewedAt)) || !Array.isArray(review.intervals) || review.intervals.length < 2 || review.intervals.length > 6) {
      result.errors.push('レビュー元・確認日時・2〜6個の区間が必要');
      return result;
    }
    result.reviewer = { source: review.source, reviewedAt: review.reviewedAt, meaning: '区間指定の出所であり、書籍条件の合格証明ではない' };
    let previousEnd = -1;
    for (const interval of review.intervals) {
      const start = bars.findIndex(b => b.date === interval?.startDate), end = bars.findIndex(b => b.date === interval?.endDate);
      if (start < 0 || end <= start || start < previousEnd) { result.errors.push('レビュー区間が欠落・逆順・重複'); break; }
      result.legs.push(measuredLeg(bars, start, end)); previousEnd = end;
    }
    if (result.errors.length) { result.legs = []; return result; }
  } else {
    const measured = automaticLegs(bars, setupBase(row, bars, date));
    result.base = measured.base;
    result.legs = measured.legs.slice(-MAX_LEGS);
    // More contractions than the six kept: the first kept one is not the base's first.
    result.droppedLegs = Math.max(0, measured.found - MAX_LEGS);
  }
  const legs = result.legs;
  result.enoughLegs = legs.length >= 2 && legs.length <= MAX_LEGS;
  result.measurementsValid = result.enoughLegs && legs.every(l => l.validPeak && l.lowAfterPeak && l.depthPct > 0);
  result.depthsContract = result.measurementsValid ? legs.slice(1).every((l, i) => l.depthPct < legs[i].depthPct) : null;
  result.volumeContracts = result.measurementsValid && legs.every(l => l.averageVolume > 0)
    ? legs.slice(1).every((l, i) => l.averageVolume < legs[i].averageVolume) : null;
  result.lastMeasuredDate = legs.at(-1)?.endDate ?? null;
  result.finalContractionVolume = legs.at(-1)?.volumeEvidence ?? null;
  result.method = '古い順に日中高値→安値を実測。全隣接収縮を比較し、スコアによる欠損補填なし';
  return result;
}

export function buildBookTechnicalEvidence(row, payload, date, { benchmark = null, review = null } = {}) {
  const result = { version: BOOK_TECHNICAL_VERSION, symbol: row?.symbol ?? null, as_of_date: date, valid: false, errors: [], sma200: null, rs: null, vcp: null };
  if (!row || !Array.isArray(payload?.bars) || payload.bars.some(b => !b || typeof b !== 'object')) {
    result.errors.push('有効な銘柄とOHLCVが必要'); return result;
  }
  const audit = auditDailyBars(row, payload, date);
  result.errors = audit.errors;
  if (!audit.valid) return result;
  result.valid = true;
  const bars = payload.bars, points = [];
  let sum = 0;
  bars.forEach((b, i) => {
    sum += b.close;
    if (i >= 200) sum -= bars[i - 200].close;
    if (i >= 199) points.push({ date: b.date, value: sum / 200 });
  });
  result.sma200 = { oneMonth: direction(points, 21), preferredFourMonths: direction(points, 84), preferredFiveMonths: direction(points, 105),
    source: { book1Seconds: 36, book2Seconds: 347.5 }, preferredNotRequired: true };
  result.rs = independentRs(bars, benchmark, date);
  result.vcp = contractions(bars, review, { row, date });
  return result;
}
