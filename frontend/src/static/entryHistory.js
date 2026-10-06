import { assess, entryPosition } from './researchEngine.js';
import { entryReadiness } from './entryReadiness.js';
import { auditValues } from './qualificationAudit.js';
import { historyEnvelope, finite, validDay } from './indicatorHistory.js';
export const ENTRY_HISTORY_VERSION = 'canonical-entry-observations-v1';
export const ENTRY_METHODS = ['minervini', 'minervini2', 'oneil', 'ibd'];
export const ENTRY_UNIVERSE = 'all-published-us-symbols-with-dated-audited-price-v1';
// Stable boundaries come from the production detector, not today's numeric
// pivot alone. Missing identity permits current positions but no crossing claim.
export function entryPivotIdentity(row, date) {
  const setup = row.setup_engine;
  if (row.setup_recalculation?.status !== 'calculated' || row.setup_recalculation.as_of_date !== date || !validDay(setup?.pivot_date) || setup.pivot_date > date || !setup.pattern_primary || setup.pattern_primary === 'none' || !setup.pivot_type) return null;
  const holder = row.institutional_evidence;
  if (holder?.cusip && (holder.symbol !== row.symbol || (row.cusip && row.cusip !== holder.cusip))) return null;
  const security = holder?.cusip || row.cusip || row.isin || null;
  if (!security) return null;
  return JSON.stringify([row.market || 'US', row.symbol, security, setup.schema_version || null, setup.pattern_primary, setup.pivot_type, setup.pivot_date]);
}
export function entrySnapshot(rows, { asOf, previousSession = null, generatedAt, ruleVersion, sourceBasis = 'published-adjusted-daily-bars', market, priceHistoryBasis = {}, now = Date.parse(generatedAt) } = {}) {
  if (!validDay(asOf) || !ruleVersion || !Number.isFinite(now)) throw Error('Invalid entry snapshot metadata');
  const symbols = new Map(); rows.forEach(row => symbols.set(row.symbol, (symbols.get(row.symbol) || 0) + 1));
  const records = rows.filter(row => (row.market || 'US') === 'US').map(row => {
    const audited = symbols.get(row.symbol) === 1 && row.technical_audit?.as_of_date === asOf && finite(auditValues(row).close);
    const methods = {};
    for (const method of ENTRY_METHODS) {
      const position = entryPosition(row, null, method), assessment = assess(row, method, now);
      const readiness = entryReadiness(row, asOf, market, now, method);
      methods[method] = { zone: position.zone ?? null,
        qualified: assessment.method_status === 'quarantined' ? null : assessment.method_status === 'not_applicable' || assessment.failed > 0 ? false : assessment.unknown ? null : assessment.qualified,
        ready: readiness.notApplicable > 0 || readiness.failed > 0 ? false : readiness.unknown ? null : readiness.ready };
    }
    const position = entryPosition(row);
    return { symbol: row.symbol, market: row.market || 'US', price: audited ? row.current_price : null,
      pivot: audited ? position.pivot : null, distance: audited ? position.distance : null,
      pivotIdentity: audited ? entryPivotIdentity(row, asOf) : null,
      priceHistoryBasis: audited ? priceHistoryBasis[row.symbol] || null : null,
      sourceBasis: `${sourceBasis}:${row.price_quality?.source || 'published'}:${row.setup_recalculation?.engine_sha256 || row.setup_recalculation?.version || 'unversioned'}`,
      methods };
  }).filter((row, index, all) => all.findIndex(item => item.symbol === row.symbol) === index).sort((a, b) => a.symbol.localeCompare(b.symbol));
  return { version: ENTRY_HISTORY_VERSION, as_of: asOf, previous_session: previousSession, generated_at: generatedAt,
    evaluated_at: new Date(now).toISOString(), knowledge_basis: 'saved_current_observation_not_historical_fundamentals',
    rule_version: ruleVersion, universe_version: ENTRY_UNIVERSE, records };
}
export function summarizeEntrySnapshot(current, previous, method = 'minervini', approachPct = 3) {
  if (!ENTRY_METHODS.includes(method) || !finite(approachPct) || approachPct <= 0 || approachPct > 10) throw Error('Invalid entry history settings');
  const compatible = current?.version === ENTRY_HISTORY_VERSION && previous?.version === ENTRY_HISTORY_VERSION &&
    previous.as_of < current.as_of && previous.as_of === current.previous_session && previous.rule_version === current.rule_version && previous.universe_version === current.universe_version;
  const before = new Map((previous?.records || []).map(row => [`${row.market}:${row.symbol}`, row]));
  const records = current?.records || [], usable = records.filter(row => finite(row.price) && finite(row.pivot) && finite(row.distance));
  const approach = row => row.distance >= -approachPct - 1e-9 && row.distance < 0;
  const inRange = row => row.distance >= -1e-9 && row.distance <= row.methods[method].zone + 1e-9;
  let comparable = 0, newCrossings = 0, qualifiedCrossings = 0, readyCrossings = 0;
  const events = [];
  for (const row of usable) {
    const old = before.get(`${row.market}:${row.symbol}`);
    if (!compatible || !old || !row.pivotIdentity || old.pivotIdentity !== row.pivotIdentity || old.pivot !== row.pivot || old.sourceBasis !== row.sourceBasis || !finite(old.price) ||
      !row.priceHistoryBasis?.prior || !old.priceHistoryBasis?.latest || row.priceHistoryBasis.prior !== old.priceHistoryBasis.latest) continue;
    comparable++;
    // One event on a below→at/above close transition. Another event requires a
    // later recorded close BELOW the unchanged pivot (explicit rearming).
    if (old.price < row.pivot && row.price >= row.pivot) {
      newCrossings++;
      if (row.methods[method].qualified === true) qualifiedCrossings++;
      if (row.methods[method].ready === true) readyCrossings++;
      events.push({ symbol: row.symbol, date: current.as_of, pivot: row.pivot, pivotIdentity: row.pivotIdentity, inRange: inRange(row), qualified: row.methods[method].qualified, ready: row.methods[method].ready });
    }
  }
  const selected = test => usable.filter(row => test(row) && row.methods[method].qualified === true).length;
  return { date: current?.as_of, recordedAt: current?.evaluated_at || current?.generated_at || null, known: usable.length > 0, coverage: usable.length, expected: records.length,
    approach: usable.length ? usable.filter(approach).length : null, qualifiedApproach: usable.length ? selected(approach) : null,
    breakoutRange: usable.length ? usable.filter(inRange).length : null, qualifiedBreakoutRange: usable.length ? selected(inRange) : null,
    readyBreakoutRange: usable.length ? usable.filter(row => inRange(row) && row.methods[method].ready === true).length : null,
    qualificationUnknown: usable.filter(row => row.methods[method].qualified == null).length,
    readinessUnknown: usable.filter(row => row.methods[method].ready == null).length,
    newCrossings: comparable ? newCrossings : null, qualifiedCrossings: comparable ? qualifiedCrossings : null, readyCrossings: comparable ? readyCrossings : null,
    crossingCoverage: comparable, crossingMissing: records.length - comparable, events,
    comparison: !previous ? 'no_previous' : !compatible ? 'incompatible_or_missing_session' : comparable < records.length ? 'partial' : 'complete' };
}
export function entryHistoryFromSeries(series, asOf, method = 'minervini', approachPct = 3) {
  return { ...historyEnvelope({ id: 'entry-counts', asOf, unit: '銘柄', source: '日次保存時の正規ピボット・日足監査・選定／購入条件',
    scope: '米国株の公開銘柄集合。各日の観測数と比較可能数を併記。', basis: 'observed',
    method: `接近はピボットの下${approachPct}%以内（アプリの変更可能な参考幅）。買い範囲は選択手法と共通。新規上抜けは同一ピボット・同一規則の連続取引日の終値比較。再計上は終値が一度ピボットを下回った後。`,
    series,
    reason: series.length < 2 ? '保存を開始した日より前の正規ピボット履歴はありません。新規上抜けは前取引日の記録が揃うまで未確認です。' : null }),
    selectedMethod: method, approachPct };
}
export function entryHistory(snapshots, asOf, method = 'minervini', approachPct = 3) {
  const ordered = snapshots.filter(snapshot => snapshot.version === ENTRY_HISTORY_VERSION && validDay(snapshot.as_of) && snapshot.as_of <= asOf).sort((a, b) => a.as_of.localeCompare(b.as_of));
  if (new Set(ordered.map(snapshot => snapshot.as_of)).size !== ordered.length) throw Error('Duplicate entry observation session');
  return entryHistoryFromSeries(ordered.map((snapshot, index) => summarizeEntrySnapshot(snapshot, ordered[index - 1], method, approachPct)), asOf, method, approachPct);
}
