// Presentation only: allocation amounts, readiness and selection thresholds remain
// owned by portfolioPlan.js / entryReadiness.js.
export function describePosition(position, readiness) {
  const supplied = Array.isArray(readiness?.rules) ? readiness.rules : [];
  const rules = supplied.map(rule => ({ ...rule, state: ['pass', 'fail'].includes(rule.state) ? rule.state : 'unknown' }));
  const expected = Math.max(rules.length, Number.isInteger(readiness?.total) ? readiness.total : 0);
  if (!rules.length || expected > rules.length) rules.push({
    id: 'unavailable-readiness', label: '購入条件の内訳', state: 'unknown',
    detail: '条件の内訳を取得できていません。日次条件の通過は確認できません。',
  });
  const unmet = rules.filter(rule => rule.state !== 'pass');
  // An absent/inconsistent readiness record must never turn a conditional row
  // into an all-pass position, even when an old dailyReady flag is retained.
  if (!unmet.length && (!readiness?.ready || !position.dailyReady)) unmet.push({
    id: 'unconfirmed-ready-state', label: '日次の買い条件', state: 'unknown',
    detail: '条件の内訳と総合判定の一致を確認できていません。',
  });
  return {
    ...position, rules, unmet,
    passed: rules.filter(rule => rule.state === 'pass').length,
    total: Math.max(expected, rules.length),
    failed: unmet.filter(rule => rule.state === 'fail').length,
    unknown: unmet.filter(rule => rule.state === 'unknown').length,
    fullyReady: unmet.length === 0,
  };
}

export function presentPortfolio(plan) {
  const bySymbol = new Map((plan.readiness || []).map(item => [item.symbol, item]));
  const positions = plan.positions.map(position => describePosition(position, bySymbol.get(position.symbol)));
  const sum = rows => ({
    count: rows.length,
    cost: Math.round(rows.reduce((total, row) => total + row.cost, 0) * 100) / 100,
    risk: Math.round(rows.reduce((total, row) => total + row.loss, 0) * 100) / 100,
  });
  const daily = positions.filter(position => position.fullyReady);
  const conditional = positions.filter(position => !position.fullyReady);
  return { positions, daily, conditional, dailyTotals: sum(daily), conditionalTotals: sum(conditional) };
}

const patternNames = {
  cup_with_handle: 'カップ・ウィズ・ハンドル', cup_and_handle: 'カップ・ウィズ・ハンドル',
  three_weeks_tight: '3週タイト', flat_base: 'フラットベース', double_bottom: 'ダブルボトム',
  high_tight_flag: 'ハイ・タイト・フラッグ', nr7_inside_day: 'NR7・インサイドデイ',
  volatility_contraction_pattern: 'VCP', vcp: 'VCP',
};
export function planConditionDetail(detail) {
  return String(detail || '根拠の詳細は未配信').replace(/\b(?:cup_with_handle|cup_and_handle|three_weeks_tight|flat_base|double_bottom|high_tight_flag|nr7_inside_day|volatility_contraction_pattern|vcp)\b/gi, name => patternNames[name.toLowerCase()]);
}
