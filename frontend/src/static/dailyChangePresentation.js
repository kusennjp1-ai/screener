import { CHANGE_LABELS } from './candidateHistory';

// Coverage comes from the published summary alone. Do not fetch detailed rows
// or infer a shared cause: missing evidence can differ from stock to stock.
export function dailyChangePresentation(query, method) {
  if (query.isError) return { label: '変化：取得できません' };
  if (!query.data) return { label: '変化：読み込み中' };
  const summary = query.data.changes?.[method], counts = summary?.counts;
  if (!counts || Object.keys(CHANGE_LABELS).some(key => !Number.isInteger(counts[key]) || counts[key] < 0)) return { label: '変化：集計未取得' };
  const total = Object.keys(CHANGE_LABELS).reduce((sum, key) => sum + counts[key], 0);
  if (summary.item_count != null && summary.item_count !== total) return { label: '変化：集計未取得' };
  if (!query.data.history) return { label: '変化：集計未取得' };
  if (!query.data.history.previous_as_of) return { ready: true, label: '変化：記録開始（次回から）' };
  if (!total) return { ready: true, label: '変化：比較対象なし' };
  if (counts.incomparable === total) return {
    ready: true,
    fullyIncomparable: true,
    label: `変化：全${total}銘柄が比較不能`,
    explanation: `全${total}銘柄が比較不能のため、通過・脱落の変化は判定できません。「比較不能」の内訳で銘柄ごとの理由を確認できます。`,
  };
  if (counts.incomparable > 0) return {
    ready: true,
    label: `変化：比較不能 ${counts.incomparable} / ${total}銘柄`,
    explanation: `${total}銘柄のうち${counts.incomparable}銘柄は比較不能です。通過・脱落などの件数は、比較できた${total - counts.incomparable}銘柄分です。「比較不能」の内訳で銘柄ごとの理由を確認できます。`,
  };
  return { ready: true, label: `変化：新たに通過 ${counts.new} · 再通過 ${counts.returned} · 脱落 ${counts.dropped}` };
}
