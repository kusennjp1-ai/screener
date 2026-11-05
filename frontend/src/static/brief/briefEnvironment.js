// Market-environment view model for the brief: the long-history deterioration rules, the leading
// groups, the verdict tone, the market-trends asset's state and the distribution and follow-through
// wording. This app's own judgement (独自判定); unknown inputs never become a state.
import { finite } from '../researchEngine';
import { bare, isoDay, sentence, shortDate } from './briefShared';

/**
 * Thresholds of the long-history deterioration notes. They are this app's own (labelled 独自判定 on
 * screen); the market tab prints its 基準 lines from these same numbers so the two cannot drift.
 */
export const ENV_RULES = Object.freeze({ templateSessions: 10, templateMinBase: 20, templateDropPercent: 20, leaderHealthBelow: 50, breakoutHoldBelow: 40 });

/**
 * Each deterioration rule on the newest long-history point (environmentPoint rows), in a fixed order:
 * { key, judged, fired, text } where text is set when the rule fired and judged is false when an
 * input of the newest session is missing (then nothing is said about that rule).
 */
export function environmentRules(rows) {
  const last = rows?.at(-1), before = rows?.at(-1 - ENV_RULES.templateSessions), rules = [];
  const rule = (key, judged, fired, text) => rules.push({ key, judged, fired: judged && fired, ...(judged && fired ? { text } : {}) });
  const templateJudged = Boolean(last) && finite(last.trendTemplateCount) && finite(before?.trendTemplateCount) && before.trendTemplateCount >= ENV_RULES.templateMinBase;
  const change = templateJudged ? (last.trendTemplateCount / before.trendTemplateCount - 1) * 100 : null;
  rule('template', templateJudged, change !== null && change <= -ENV_RULES.templateDropPercent, change === null ? null : `トレンドテンプレート達成数が${ENV_RULES.templateSessions}営業日で${Math.abs(change).toFixed(0)}%減少`);
  const stageJudged = Boolean(last) && finite(last.stage4Percent) && finite(last.stage2Percent);
  rule('stage', stageJudged, stageJudged && last.stage4Percent > last.stage2Percent, stageJudged ? `ステージ4（${last.stage4Percent.toFixed(0)}%）がステージ2（${last.stage2Percent.toFixed(0)}%）を上回る` : null);
  const leadersJudged = Boolean(last) && finite(last.leaderHealthPercent);
  rule('leaders', leadersJudged, leadersJudged && last.leaderHealthPercent < ENV_RULES.leaderHealthBelow, leadersJudged ? `20営業日前のTT達成銘柄のうち、50日線より上は${last.leaderHealthPercent.toFixed(0)}%` : null);
  const breakoutJudged = Boolean(last) && finite(last.breakoutHoldPercent);
  rule('breakout', breakoutJudged, breakoutJudged && last.breakoutHoldPercent < ENV_RULES.breakoutHoldBelow, breakoutJudged ? `ブレイクアウトの成功率が${last.breakoutHoldPercent.toFixed(0)}%に低下` : null);
  return rules;
}

/**
 * Deterioration notes from the derived long-history points (environmentPoint rows): the rules of
 * environmentRules that fired. Unknown inputs yield no note.
 */
export function environmentWarnings(rows) {
  return environmentRules(rows).filter(rule => rule.fired).map(({ key, text }) => ({ key, text }));
}

/**
 * Where today's qualified candidates cluster. Uses the industry group when most rows carry one,
 * otherwise the GICS sector, and says which. Groups need at least two qualified stocks.
 */
export function leadingGroups(ranked, limit = 3) {
  const qualified = (ranked || []).filter(item => item?.assessment?.qualified).map(item => item.row || {});
  if (!qualified.length) return null;
  const named = key => qualified.filter(row => typeof row[key] === 'string' && row[key].trim()).length;
  const field = named('ibd_industry_group') * 2 >= qualified.length ? 'ibd_industry_group' : named('gics_sector') * 2 >= qualified.length ? 'gics_sector' : null;
  if (!field) return null;
  const counts = new Map();
  for (const row of qualified) { const name = typeof row[field] === 'string' ? row[field].trim() : ''; if (name) counts.set(name, (counts.get(name) || 0) + 1); }
  const groups = [...counts].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([name, count]) => ({ name, count }));
  return { kind: field === 'ibd_industry_group' ? '業種' : 'セクター', groups, total: qualified.length, unnamed: qualified.length - named(field) };
}

/** Verdict tone shared by the market card and today's summary. */
export function marketTone(market) {
  if (!market || market.state === 'unknown') return 'neutral';
  if (/上昇トレンド/.test(market.label)) return 'zone';
  if (/圧力/.test(market.label)) return 'ext';
  return 'neg';
}

/**
 * Why the market-trends asset failed, in short Japanese: kind fetch (network, HTTP, the manifest itself),
 * integrity (hash, transport or reference mismatch) or reader (readMarketTrends' own sentence).
 * A raw English message, path or hash is never shown; tile is the two-word form for a tile.
 */
export function trendsFailure(trends) {
  if (trends?.failureKind === 'manifest') return { kind: 'fetch', reason: '公開情報を読み込めません', tile: '公開情報エラー' };
  const error = trends?.failureReason, message = typeof error?.message === 'string' ? error.message : '';
  if (!error) return { kind: 'integrity', reason: '公開データの参照情報が一致しません', tile: '整合性エラー' };
  const status = /^Failed to load static data: .* \((\d{3})\)$/.exec(message)?.[1] || /^Transport HTTP failure: (\d{3})$/.exec(message)?.[1];
  if (status) return { kind: 'fetch', reason: status === '404' ? '配信ファイルが見つかりません' : `配信サーバーの応答 ${status}`, tile: '配信エラー' };
  if (error.name === 'AbortError' || (error.name === 'TypeError' && /fetch|network|load failed/i.test(message))) return { kind: 'fetch', reason: '通信エラー', tile: '通信エラー' };
  if (/^Unsupported transport/.test(message)) return { kind: 'fetch', reason: 'このブラウザでは読み込めません', tile: '非対応ブラウザ' };
  if (/[\u3040-\u30ff\u3400-\u9fff]/.test(message)) return { kind: 'reader', reason: message, tile: '整合性エラー' };
  return { kind: 'integrity', reason: null, tile: '整合性エラー' };
}

/** State of the market-trends asset: loading | error (with trendsFailure's kind, reason and tile) | none (not published) | ready. */
export function trendsStatus(trends) {
  if (trends?.loading) return { state: 'loading', reason: null };
  if (trends?.error) return { state: 'error', ...trendsFailure(trends) };
  if (!trends?.data) return { state: 'none', reason: null };
  return { state: 'ready', reason: null };
}

/** The error sentence for the market-trends asset (status from trendsStatus). */
export function trendsAlert(status) {
  if (status.kind === 'reader') return sentence(status.reason);
  if (status.kind === 'fetch') return `市場推移データを取得できません（${bare(status.reason)}）。`;
  return `市場推移データの整合性を確認できません${status.reason ? `（${bare(status.reason)}）` : ''}。`;
}

/**
 * One index's 25-session distribution-day count with its own session: today's value, else the
 * exporter's last observation (an index series that ends early), else the last finite point.
 */
export function distributionCount(index) {
  if (!index) return null;
  if (finite(index.latest?.value) && isoDay(index.latest.date)) return { value: index.latest.value, date: index.latest.date };
  if (finite(index.lastObserved?.value) && isoDay(index.lastObserved.date)) return { value: index.lastObserved.value, date: index.lastObserved.date };
  const points = Array.isArray(index.points) ? index.points : [];
  for (let i = points.length - 1; i >= 0; i--) if (finite(points[i]?.value) && isoDay(points[i].date)) return { value: points[i].value, date: points[i].date };
  return null;
}

// Wording only; the rule itself is computed by the exporter (parity with backend market_regime.py FTD_* constants).
// The decline is the backend's: peak close to the close of the lowest-low session, which the tile names, since a
// later close can sit lower. The post-FTD count is the distribution days still active (25-session window).
export const FTD_TEXT = Object.freeze({ minDay: 4, maxDay: 15, gain: '+1.2%', decline: '6%' });
/**
 * Compact tile text for one index's follow-through state (this app's own judgement):
 * { b, em, asOf } where asOf is set when the judgement is older than the analysis date.
 * A missing field (older publication) or an unavailable input never becomes a state.
 */
export function followThroughView(ft, date) {
  if (ft === undefined) return { b: '未集計', em: '旧形式の公開データ', asOf: null };
  if (!ft || typeof ft !== 'object') return { b: '算出不可', em: '判定データを読み取れません', asOf: null };
  if (ft.available !== true) return { b: '算出不可', em: typeof ft.reason === 'string' && ft.reason ? ft.reason : '指数データを確認できません', asOf: null };
  const asOf = isoDay(ft.asOf) && isoDay(date) && ft.asOf < date ? shortDate(ft.asOf, date) : null;
  const at = value => shortDate(value, date), whole = value => Number.isSafeInteger(value) && value >= 0;
  // A decline under the 6% line is never rounded up onto it (5.96% reads −5.96%, not −6.0% beside 「6%未満」).
  const under6 = value => Number(value.toFixed(2)) < 6 ? value.toFixed(2) : (Math.floor(value * 100) / 100).toFixed(2);
  const fall = finite(ft.declinePct) ? (value => `−${ft.state === 'no_correction' && Number(value.toFixed(1)) >= 6 ? under6(value) : value.toFixed(1)}%`)(Math.abs(ft.declinePct)) : null;
  const join = parts => parts.filter(Boolean).join('・');
  const { ftd, attempt, low, peak } = ft;
  switch (ft.state) {
    case 'confirmed': return { b: isoDay(ftd?.date) ? `確認 ${at(ftd.date)}` : '確認', asOf, tone: 'zone',
      em: join([finite(ftd?.gainPct) ? `+${ftd.gainPct.toFixed(1)}%` : null, whole(ftd?.attemptDay) ? `反発${ftd.attemptDay}日目` : null, whole(ftd?.distributionSince) ? `FTD後の有効な分配日${ftd.distributionSince}` : null]) };
    case 'rally_attempt': return { b: whole(attempt?.day) ? `反発${attempt.day}日目` : '反発中', asOf,
      em: join([isoDay(low?.date) ? `安値${at(low.date)}` : null, `${FTD_TEXT.minDay}日目以降の${FTD_TEXT.gain}上昇待ち`]) };
    case 'correction': return { b: '調整中', asOf, em: fall ? `高値${isoDay(peak?.date) ? at(peak.date) : ''}から${fall}` : `${FTD_TEXT.decline}以上の下落` };
    case 'attempt_expired': return { b: `${FTD_TEXT.maxDay}日以内のFTDなし`, asOf, em: join([isoDay(low?.date) ? `安値${at(low.date)}を維持` : null, whole(attempt?.day) ? `反発${attempt.day}日目` : null]) };
    case 'ftd_failed': return { b: isoDay(ft.failedDate) ? `FTD失敗 ${at(ft.failedDate)}` : 'FTD失敗', asOf, tone: 'ext', em: isoDay(ftd?.date) ? `${at(ftd.date)}のFTD当日の安値を終値で下回る` : 'FTD当日の安値を終値で下回る' };
    // The window opens on the peak: an older high is unseen, so "no FTD needed" is not established.
    case 'no_correction': if (ft.peakAtWindowStart === true) return { b: '判定保留', asOf, em: '集計期間の初日が高値・それ以前は期間外' };
      return { b: '不要', asOf, em: fall ? `安値日の終値で高値から${fall}（${FTD_TEXT.decline}未満）` : `${FTD_TEXT.decline}以上の調整なし` };
    default: return { b: '判定不明', em: `未対応の状態（${String(ft.state)}）`, asOf };
  }
}
