import { auditDailyBars } from './qualificationAudit.js';

export const BOOK_TECHNICAL_VERSION = 'book-technical-evidence-v1';
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

function contractions(bars, review) {
  const result = { scope: 'OHLCV実測を伴う通常VCPの候補。パワープレー等の例外は別評価',
    certification: false, source: 'algorithm', reviewer: null, errors: [], legs: [],
    limitations: ['自動ピーク探索は2本左右の局所高値・直近150本を使う独自近似', '出来高区間平均は売り枯れの代理指標', 'ベース全体の位置・ステージ・買い場は別途確認'] };
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
    const begin = Math.max(0, bars.length - 150), peaks = [];
    for (let i = begin + 2; i < bars.length - 2; i++) {
      if ([i - 2, i - 1, i + 1, i + 2].every(j => bars[i].high > bars[j].high)) peaks.push(i);
    }
    // Find the low after each peak, before the next peak, so a higher recovery
    // high cannot distort the previous contraction's starting high.
    for (let i = 0; i < peaks.length; i++) {
      const start = peaks[i], limit = i + 1 < peaks.length ? peaks[i + 1] : bars.length - 1;
      let low = start;
      for (let j = start + 1; j <= limit; j++) if (bars[j].low < bars[low].low) low = j;
      if (low > start) result.legs.push(measuredLeg(bars, start, low));
    }
    result.legs = result.legs.slice(-6);
  }
  const legs = result.legs;
  result.enoughLegs = legs.length >= 2 && legs.length <= 6;
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
  result.vcp = contractions(bars, review);
  return result;
}
