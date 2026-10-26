/** The expression describes existing evidence; it never creates a trade signal. */
export function companionState(checks, readiness) {
  const counts = `通過 ${readiness?.passed ?? 0}/${readiness?.total ?? 0}・未達 ${readiness?.failed ?? 0}・未確認 ${readiness?.unknown ?? 0}`;
  if (checks?.financial_exclusion || checks?.method_status === 'not_applicable' || readiness?.notApplicable > 0) {
    return { mood: 'resting', title: '対象を確認', detail: `${checks?.financial_exclusion?.label || checks?.applicability_label || 'この手法の対象外を含みます。'} ${counts}。対象外を通過と扱いません。` };
  }
  if (readiness?.failed > 0) return { mood: 'concerned', title: '条件を待とう', detail: `${counts}。未達の条件があります。価格の上昇・下落の予測ではありません。` };
  if (!readiness?.ready || checks?.method_status || readiness?.unknown > 0) return { mood: 'curious', title: 'まだ確認中', detail: `${counts}。根拠が揃っていません。未確認を通過と扱いません。` };
  return { mood: 'bright', title: '条件がそろった', detail: `${counts}。確認済みの日次条件を満たしています。利益や将来の値動きを保証せず、発注前の最新情報確認が必要です。` };
}
