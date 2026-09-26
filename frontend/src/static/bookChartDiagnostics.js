import { auditDailyBars } from './qualificationAudit.js';

export const BOOK_CHART_VERSION = 'book-chart-v1';
const finite = n => typeof n === 'number' && Number.isFinite(n);
const mean = xs => xs.reduce((sum, n) => sum + n, 0) / xs.length;
const ratio = (a, b) => b > 0 ? a / b : null;
const source = seconds => ({ book: '株式トレード 基本と原則', recordingSeconds: seconds });

// Research diagnostics, not a trade authorization or proof of a discretionary base.
// Revalidate OHLCV here: saved pass flags cannot authorize calculations on a new payload.
export function diagnoseBookChart(row, payload, date) {
  const result = {
    version: BOOK_CHART_VERSION, symbol: row?.symbol ?? null, as_of_date: date,
    valid: false, errors: [], rsLine: null, priceWarnings: null,
    rightEdgeVolume: null, powerPlay: null,
    unknowns: ['実際のベース開始・終了、ブレイク日、初期／後期ステージは未確認', '提供元RSラインのベンチマーク価格からの独立再計算は未実施'],
  };
  if (!row || !Array.isArray(payload?.bars) || payload.bars.some(b => !b || typeof b !== 'object')) {
    result.errors.push('有効な銘柄と日足データが必要');
    return result;
  }
  const audit = auditDailyBars(row, payload, date);
  result.errors = audit.errors;
  if (!audit.valid) return result;
  result.valid = true;
  const bars = payload.bars, last = bars.at(-1);

  const rs = payload.rs_line;
  const rsErrors = [];
  if (!Array.isArray(rs) || !rs.length) rsErrors.push('RSライン未取得');
  else {
    const start = bars.findIndex(b => b.date === rs[0]?.time);
    if (start < 0 || rs.length !== bars.length - start ||
      rs.some((point, i) => !point || point.time !== bars[start + i]?.date || !finite(point.value) || point.value <= 0)) {
      rsErrors.push('RSラインの日付・順序・欠落・値が日足と不整合');
    }
    if (rs.at(-1)?.time !== date) rsErrors.push('RSラインの最終日が分析日と不一致');
  }
  const direction = sessions => {
    if (rsErrors.length || rs.length < sessions + 1) return { sessions, state: 'unknown', changePct: null, start: null, end: null };
    const start = rs.at(-1 - sessions), end = rs.at(-1);
    const changePct = (end.value / start.value - 1) * 100;
    return { sessions, state: changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat', changePct,
      start: { date: start.time, value: start.value }, end: { date: end.time, value: end.value } };
  };
  result.rsLine = { source: source(347.5), provenance: 'provider-derived', independentBenchmarkRecalculation: false,
    method: '30・65営業日前との端点比較。期間全体の持続的な上向きを証明しない',
    errors: rsErrors, sixWeeks: direction(30), thirteenWeeks: direction(65) };
  if (rsErrors.length) result.unknowns.push(...rsErrors);
  else if (rs.length < 66) result.unknowns.push('RSラインの65営業日比較に必要な66点が不足');

  const sma20 = mean(bars.slice(-20).map(b => b.close));
  const prior50Volume = mean(bars.slice(-51, -1).map(b => b.volume));
  const currentVolumeRatio = ratio(last.volume, prior50Volume);
  const threeLowerLows = bars.slice(-3).every((b, i) => b.low < bars[bars.length - 4 + i].low);
  const below20 = last.close < sma20, below50 = last.close < audit.values.sma50;
  const heavyVolume = currentVolumeRatio == null ? null : currentVolumeRatio >= 1.4;
  result.priceWarnings = { source: source(130.5), close: last.close, sma20, sma50: audit.values.sma50,
    below20, below50, threeLowerLows, currentVolume: last.volume, prior50Volume, currentVolumeRatio,
    heavyVolume, heavyVolumeThresholdProxy: 1.4,
    combinedWarning: heavyVolume == null ? null : below20 && threeLowerLows && heavyVolume,
    recoveryInUpperHalf: last.close >= (last.high + last.low) / 2,
    automaticSell: false,
    limitation: '1.4倍はアプリの代理閾値。ブレイク後か、安値で買い支えがあるかを別途確認。単独の移動平均割れは売却指示ではない' };
  if (heavyVolume == null) result.unknowns.push('比較期間の出来高がゼロのため大商い判定は未確認');

  // Compare disjoint periods: recent five bars versus the preceding fifty.
  const recent5 = bars.slice(-5), baseline = mean(bars.slice(-55, -5).map(b => b.volume));
  const recent5Mean = mean(recent5.map(b => b.volume));
  const volumeRatio = ratio(recent5Mean, baseline);
  result.rightEdgeVolume = { source: source(385.5), recentSessions: 5, baselineSessions: 50,
    recentMean: recent5Mean, baselineMean: baseline, ratio: volumeRatio,
    belowBaseline: volumeRatio == null ? null : volumeRatio < 1,
    minVolume: Math.min(...recent5.map(b => b.volume)), minRatio: ratio(Math.min(...recent5.map(b => b.volume)), baseline),
    actualVcpConfirmed: false, limitation: '固定5日窓の出来高代理指標。実際の最終収縮位置、収縮回数、極端な枯れは未確認' };
  if (volumeRatio == null) result.unknowns.push('出来高の基準値がゼロのため右端減少比率は未確認');

  // Fixed candidate windows cannot identify actual base boundaries or stage.
  // Measure the impulse BEFORE each candidate base, never using its later low.
  const windows = [15, 20, 25, 30].map(baseSessions => {
    const base = bars.slice(-baseSessions), impulseEnd = bars.length - baseSessions - 1;
    const impulse = bars.slice(impulseEnd - 40, impulseEnd + 1);
    const startClose = Math.min(...impulse.map(b => b.close)), endClose = bars[impulseEnd].close;
    const risePct = (endClose / startClose - 1) * 100;
    const internalHigh = Math.max(...base.map(b => b.high));
    const high = Math.max(bars[impulseEnd].high, internalHigh), low = Math.min(...base.map(b => b.low));
    const depthPct = (high - low) / high * 100;
    return { baseSessions, baseStart: base[0].date, baseEnd: last.date,
      impulseStart: impulse[0].date, impulseEnd: bars[impulseEnd].date, risePct, high, low, depthPct, internalHigh,
      doubledWithin40Sessions: risePct >= 100 - 1e-9, depthWithin25Pct: depthPct <= 25 + 1e-9,
      mechanicalMatch: risePct >= 100 - 1e-9 && depthPct <= 25 + 1e-9,
      alreadyTightProxy: depthPct <= 10 + 1e-9 };
  });
  result.powerPlay = { source: source(476.5), windows, mechanicalMatch: windows.some(w => w.mechanicalMatch),
    certification: false, fundamentalsRequiredByThisPattern: false,
    unknowns: ['実際のベース境界', '急騰時の非常な大商い', '後期ステージ除外', '週足終値のタイトさと需給の消化'],
    limitation: '40営業日以内の倍増＋固定15〜30営業日窓の押し25%以内という機械的探索。3〜6週・20〜25%という書籍の特徴の一部のみ。成立認定でも買い推奨でもない' };
  return result;
}
