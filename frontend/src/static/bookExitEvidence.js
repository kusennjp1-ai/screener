import { auditDailyBars } from './qualificationAudit';
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const day = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

// Book2 frames 130.50, 524.50, 552.50 visually checked. No quantitative
// threshold for "immediately" or "surging volume" is invented here.
export function buildBookExitEvidence(row, payload, date, context = {}) {
  const out = { valid: false, errors: [], unknowns: [], context: null, postBreakout: [], stage: 'unknown', stageSignals: null,
    automaticSell: false, certification: false, sourceSeconds: [130.5, 132.5, 141.5, 145.5, 524.5, 552.5] };
  if (!row || !Array.isArray(payload?.bars) || payload.bars.some(b => !b || typeof b !== 'object')) { out.errors.push('有効な銘柄・日足が必要'); return out; }
  const audit = auditDailyBars(row, payload, date);
  if (!audit.valid) { out.errors = audit.errors; return out; }
  if (!day(context.breakoutDate) || typeof context.source !== 'string' || !context.source.trim() || !day(context.reviewDate) || context.reviewDate < context.breakoutDate || context.reviewDate > new Date().toISOString().slice(0, 10)) {
    out.errors.push('実際のブレイク日・確認資料・未来ではない確認日を入力してください'); return out;
  }
  const bars = payload.bars, start = bars.findIndex(b => b.date === context.breakoutDate);
  if (start < 0 || context.setupConfirmed !== true) { out.errors.push('配信日足にあるブレイク日と、適切なベースからの上放れ確認が必要'); return out; }
  const count = context.baseCount === '' || context.baseCount == null ? null : Number(context.baseCount);
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > 99)) { out.errors.push('ベース番号は1〜99、未確認なら空欄'); return out; }
  if (context.stage && !['early', 'late', 'unknown'].includes(context.stage)) { out.errors.push('局面区分が不正'); return out; }
  if (context.stage === 'early' && count !== null && count >= 4) { out.errors.push('初期局面と第4以降のベース番号が矛盾。数え直しとリセットの根拠を確認'); return out; }
  out.valid = true;
  out.context = { ...context, baseCount: count, basis: '入力者が確認した文脈。後日の確認は当時既知だった根拠にはならない。自動ベース認定ではない' };
  out.stage = context.stage === 'early' || context.stage === 'late' ? context.stage : 'unknown';
  if (out.stage === 'unknown') out.unknowns.push('初期／後期が未確認のため急騰をクライマックス売りと解釈しない');
  if (count === null) out.unknowns.push('ベース番号・途中のリセットが未確認');
  const avg = (i, n) => i + 1 >= n ? mean(bars.slice(i - n + 1, i + 1).map(b => b.close)) : null;
  const vol = i => i >= 50 ? mean(bars.slice(i - 50, i).map(b => b.volume)) : null;
  const breakVolume = vol(start), breakoutRatio = breakVolume > 0 ? bars[start].volume / breakVolume : null;
  for (let i = start + 1; i < bars.length; i++) {
    const b = bars[i], prev = bars[i - 1], sma20 = avg(i, 20), sma50 = avg(i, 50), baseline = vol(i);
    const lower3 = i >= start + 3 && [i - 2, i - 1, i].every(j => bars[j].low < bars[j - 1].low);
    const upClose = b.close > prev.close, upperHalf = b.high > b.low ? b.close >= (b.high + b.low) / 2 : null;
    const volumeIncreasing = b.volume > prev.volume, ratio = baseline > 0 ? b.volume / baseline : null;
    const support = lower3 ? volumeIncreasing && (upClose || upperHalf === true) : null;
    const below20 = sma20 === null ? null : b.close < sma20, below50 = sma50 === null ? null : b.close < sma50;
    out.postBreakout.push({ date: b.date, sessionsSinceBreakout: i - start, close: b.close, low: b.low, sma20, sma50,
      below20, below50, threeLowerLows: lower3, upClose, upperHalfClose: upperHalf, volume: b.volume,
      priorVolume: prev.volume, volumeIncreasing, volumeToPrior50: ratio, thirdDaySupport: support,
      combinedConcern: below20 === true && lower3 && support === false && volumeIncreasing,
      thinBreakoutThenDistribution: breakoutRatio === null ? null : breakoutRatio < 1 && b.close < prev.close && ratio !== null && ratio > 1 && b.volume > bars[start].volume });
  }
  const last = bars.length - 1, end = bars[last];
  const upWindows = Array.from({ length: 9 }, (_, n) => n + 7).map(n => {
    if (last - n < start) return { sessions: n, upDays: null, upPct: null };
    const upDays = bars.slice(last - n + 1).filter((b, j) => b.close > bars[last - n + j].close).length;
    return { sessions: n, upDays, upPct: upDays / n * 100 };
  });
  const gains = [5, 10, 15].map(n => ({ sessions: n, gainPct: last - n >= start ? (end.close / bars[last - n].close - 1) * 100 : null }));
  const after = bars.slice(start + 1), largest = key => after.length ? after.reduce((a, b) => key(b) > key(a) ? b : a) : null;
  const ranges = largest(b => b.high - b.low), volumes = largest(b => b.volume);
  const fifteen = upWindows.find(w => w.sessions === 15);
  out.stageSignals = { upWindows, gains, breakoutVolumeToPrior50: breakoutRatio,
    earlyStrength: out.stage === 'early' && fifteen.upDays !== null ? fifteen.upDays >= 12 : null,
    lateExhaustionReview: out.stage === 'late' && gains.every(g => g.gainPct !== null) && upWindows.every(w => w.upPct !== null)
      ? gains.some(g => g.gainPct >= 25) && upWindows.some(w => w.upPct >= 70) : null,
    largestRangeDate: ranges?.date ?? null, largestVolumeDate: volumes?.date ?? null,
    comparisonStart: context.breakoutDate, latestDownOnIncreasingVolume: last > start ? end.close < bars[last - 1].close && end.volume > bars[last - 1].volume : null };
  out.unknowns.push('「直後」「大幅な出来高増」の普遍的な日数・倍率は書籍にない。経過日数と実測倍率を表示し、固定の売却判定にしない',
    '出来高の50日平均比較と5/10/15営業日の週近似は補助測定。1〜3週25〜50%以上の急騰・上昇日比率は局面の根拠と合わせて読む',
    '全上昇局面の最大日・PER拡大・イグゾースチョンギャップ・後続の支持は別途確認');
  return out;
}
