import { BASE_COUNT_VERSION } from '../baseCountHistory';
import IndicatorHistoryPanel from './IndicatorHistoryPanel';
export default function BaseCountEvidence({ row, date }) {
  const history = row.base_count_history?.symbol === row.symbol && row.base_count_history?.version === BASE_COUNT_VERSION ? row.base_count_history : null;
  return <div>
    <IndicatorHistoryPanel title="ベース段階の推移（自動推計）" history={history} expectedDate={date} columns={[{ key: 'value', label: '観測範囲内の段階' }]} extraColumns={[{ key: 'start', label: '開始' }, { key: 'end', label: '終了' }, { key: 'confirmedAt', label: '確認日' }, { key: 'pivot', label: '買い水準' }, { key: 'low', label: 'ベース安値' }, { key: 'advancePct', label: '前買い水準比（%）' }, { key: 'priorBaseId', label: '前ベースID' }, { key: 'resetReason', label: 'リセット理由', format: value => value === 'first_observed_base' ? '初回観測' : value === 'undercut_prior_base_low' ? '前ベース安値割れ' : 'なし' }, { key: 'baseOnBase', label: '同段階の形成', format: value => value ? 'あり' : 'なし' }]}>
      <p>現在 {history?.complete && history?.count != null ? `観測範囲内の第${history.count}段階` : '未確認'}{history?.originKnown ? '（安値割れのリセットを確認）' : '。観測開始前の段階は不明'}</p>
    </IndicatorHistoryPanel>
    <p>{history?.limitation || '検証済みの形状境界・安値・確認日を持つ履歴が必要です。'}</p>
    <p>手動で確認したベース番号は「書籍検証」の文脈入力に別保存されます。この自動推計と合算せず、選定・購入条件も変更しません。</p>
  </div>;
}
