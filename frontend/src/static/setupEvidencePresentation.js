import { auditDailyBars, verifiedVolumeRatio } from './qualificationAudit.js';
import { buildBookTechnicalEvidence } from './bookTechnicalEvidence.js';
import { requireChartIdentity } from './chartPayloadIdentity.js';
import { assess, entryPosition, finite } from './researchEngine.js';
import { canonicalPivot } from './researchPresentation.js';
import { validEvidenceDay } from './evidenceTime.js';

const mean = bars => bars.reduce((sum, bar) => sum + bar.volume, 0) / bars.length;

// Presentation only. A selected chart supplies dated measurements, never new
// selection gates, a replacement pivot, or unprojected financial fields.
export function buildSetupEvidence({ row, payload, date, method = 'minervini', now }) {
  const identity = Boolean(typeof row?.symbol === 'string' && row.symbol.trim() && validEvidenceDay(date) &&
    (!row.as_of_date || row.as_of_date === date));
  const pivot = canonicalPivot(row);
  const position = entryPosition(row || {}, null, method);
  const assessment = row ? assess(row, method, now) : null;
  const selectionKnown = identity && row.technical_audit?.as_of_date === date;
  const result = {
    date, symbol: row?.symbol, pivot, position,
    selection: selectionKnown ? assessment : null,
    valid: false, errors: [], high: null, formation: null, dailyVolume: null,
  };
  if (!identity) { result.errors.push('銘柄または分析基準日を確認できません'); return result; }
  if (!payload) { result.errors.push('検証用の日足は未取得です'); return result; }
  try {
    requireChartIdentity(payload, row.symbol, date);
    if (payload.bars.some(bar => !bar || typeof bar !== 'object')) throw Error('Invalid daily bar');
  } catch { result.errors.push('日足の銘柄・基準日・形式が一致しません'); return result; }
  // Independently valid bars do not erase a contradictory published row.
  if (row.technical_audit?.errors?.includes('同一銘柄のデータが矛盾')) {
    result.errors.push('同一銘柄のデータが矛盾'); return result;
  }
  const audit = auditDailyBars(row, payload, date);
  if (!audit.valid) { result.errors = audit.errors; return result; }
  result.valid = true;
  const bars = payload.bars, year = bars.slice(-252), last = bars.at(-1);
  result.high = {
    price: audit.values.high, start: year[0].date, end: last.date, sessions: year.length,
    observed: year.findLast(bar => bar.high === audit.values.high)?.date,
    belowHighPct: audit.values.belowHigh,
    abovePivotPct: pivot.price ? (audit.values.high / pivot.price - 1) * 100 : null,
  };
  const baseline = bars.slice(-51, -1), ratio = verifiedVolumeRatio({ ...row, technical_audit: audit }, date);
  result.dailyVolume = {
    date, volume: last.volume, ratio, changePct: audit.values.change,
    baselineStart: baseline[0].date, baselineEnd: baseline.at(-1).date,
    baselineSessions: baseline.length, baselineMean: mean(baseline),
    // Same disclosed daily proxy as entryReadiness. This is not a breakout certification.
    proxyState: !finite(ratio) || !finite(audit.values.change) ? 'unknown'
      : ratio >= 1.4 && audit.values.change > 0 ? 'met' : 'not-met',
    atOrAbovePivot: pivot.price ? last.close >= pivot.price : null,
  };
  // Use the existing measured contraction implementation, including its exact
  // finalContractionVolume baseline. No five-day average substitutes for a leg.
  const technical = buildBookTechnicalEvidence(row, payload, date);
  const vcp = technical.vcp, leg = vcp?.legs.at(-1), volume = vcp?.finalContractionVolume;
  if (technical.valid && leg?.validPeak && leg.lowAfterPeak && volume) {
    const interval = bars.filter(bar => bar.date >= leg.startDate && bar.date <= leg.endDate);
    const usableBaseline = volume.baselineSessions === 50 && volume.preceding50Mean > 0;
    result.formation = {
      start: leg.startDate, end: leg.endDate, bars: leg.bars,
      source: vcp.source, certification: false,
      averageVolume: leg.averageVolume, lastVolume: volume.lastVolume, lastTwoMean: volume.lastTwoMean,
      baselineSessions: volume.baselineSessions, baselineStart: volume.baselineStart, baselineEnd: volume.baselineEnd,
      baselineMean: volume.preceding50Mean,
      intervalRatio: usableBaseline ? volume.intervalRatio : null,
      lastRatio: usableBaseline ? volume.lastRatio : null,
      lastTwoRatio: usableBaseline ? volume.lastTwoRatio : null,
      lastDate: volume.lastDate,
      // Current pivot context is not a historical breakout date. An interval
      // that touched/exceeded it cannot be called a pre-breakout dry-up window.
      reachesCurrentPivot: pivot.price ? interval.some(bar => bar.high >= pivot.price) : null,
    };
  }
  return result;
}
