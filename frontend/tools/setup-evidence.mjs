// Publication uses the production detector's current result, not a retained
// pre-repair shape. Diagram heuristics remain a separate, additional check.
export function setupEvidence(row, diagram, asOf) {
  const calculation=row.setup_recalculation;
  if (calculation?.status!=='calculated' || calculation.as_of_date!==asOf) return null;
  const patterns={vcp:'VCP',cup_with_handle:'カップ・ウィズ・ハンドル',flat_base:'フラットベース',double_bottom:'ダブルボトム',three_weeks_tight:'3週タイト',high_tight_flag:'ハイタイトフラッグ'};
  const detected=Boolean(row.se_pattern_primary && row.se_pattern_primary!=='none' && row.se_pivot_price>0);
  // setup_ready is PRE-breakout (includes volume contraction <=0.8x).
  // Requiring it simultaneously with entry volume expansion >=1.4x would
  // make every breakout impossible. Keep it separate from structural validity.
  const candidate=Boolean(detected && diagram?.candidate);
  const description=detected ? `${patterns[row.se_pattern_primary]||'ベース'}を検出。${row.se_setup_ready ? 'ブレイク前の準備条件を通過' : 'ブレイク前の準備条件は未達（当日の購入条件とは別判定）'}` : '現在有効なベース・ピボットは検出されていません';
  return {candidate,summary:`${description}。図解の追加検証：${diagram?.summary||'未確認'}`,method:'production-setup-engine-and-book-diagram',pattern:row.se_pattern_primary||null,setup_ready:row.se_setup_ready===true};
}
