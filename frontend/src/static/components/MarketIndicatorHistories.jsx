import { useState } from 'react';
import IndicatorHistoryPanel from './IndicatorHistoryPanel';
import { highLowHistory, INDICATOR_HISTORY_VERSION } from '../indicatorHistory';
import { putCallHistory } from '../putCallHistory';
import { distributionHistory } from '../distributionHistory';
const METHODS = { minervini: 'ミネルヴィニ', minervini2: '基本と原則', oneil: 'オニール', ibd: 'IBD型' };
const VIEWS = { highLow: '新高値・新安値', putCall: 'Put/Call', distribution: '分配日', entry: '接近・上抜け' };
export default function MarketIndicatorHistories({ data, bookEvidence, expectedDate }) {
  const [view, setView] = useState('highLow'), [method, setMethod] = useState('minervini'), [approach, setApproach] = useState('3');
  const current = data?.version === INDICATOR_HISTORY_VERSION && data.as_of_date === expectedDate ? data : null;
  const highLow = current?.highLow || highLowHistory(bookEvidence, expectedDate);
  const putCall = current?.putCall || putCallHistory(null, expectedDate);
  const entry = current?.entry?.[method]?.[approach];
  return <section className="market-indicator-histories" aria-label="指標の推移">
    <header><h2>指標の推移</h2><p>まず広がり、次に参加状況。実測・推計・未取得をそれぞれの日付と対象範囲で確認。</p></header>
    <div className="indicator-history-switch" role="group" aria-label="表示する市場指標">{Object.entries(VIEWS).map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</div>
    {view === 'highLow' && <IndicatorHistoryPanel title="52週新高値・新安値" history={highLow} expectedDate={expectedDate} columns={[{ key: 'high', label: '新高値' }, { key: 'low', label: '新安値' }]}/>} 
    {view === 'putCall' && <IndicatorHistoryPanel title="市場のPut/Callレシオ" history={putCall} expectedDate={expectedDate} columns={[{ key: 'value', label: 'Put / Call（出来高）' }]}/>}
    {view === 'distribution' && <>{['sp500', 'nasdaq'].map(index => <IndicatorHistoryPanel key={index} title={`${index === 'sp500' ? 'S&P 500' : 'Nasdaq総合'}の通常分配日（推計）`} history={current?.distribution?.[index] || distributionHistory(null, index, expectedDate)} expectedDate={expectedDate} columns={[{ key: 'value', label: '有効分配日数' }]} extraColumns={[{ key: 'observedActive', label: '確認済み日数' }, { key: 'unknownDays', label: '未確認日数' }]}/>)}</>}
    {view === 'entry' && <>
      <div className="indicator-history-switch"><label>選択手法 <select aria-label="履歴の選択手法" value={method} onChange={event => setMethod(event.target.value)}>{Object.entries(METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>接近の参考幅 <select aria-label="ピボット下の接近幅" value={approach} onChange={event => setApproach(event.target.value)}>{['1', '3', '5'].map(value => <option key={value} value={value}>下{value}%以内</option>)}</select></label></div>
      <IndicatorHistoryPanel title="接近・買い範囲・新規上抜け" history={entry} expectedDate={expectedDate} columns={[{ key: 'approach', label: '価格のみ：接近' }, { key: 'breakoutRange', label: '価格のみ：買い範囲' }, { key: 'newCrossings', label: '新規上抜け（比較可能分）' }]} extraColumns={[{ key: 'recordedAt', label: '判定を保存した時刻' }, { key: 'comparison', label: '比較状態', format: value => ({no_previous:'前回なし',incompatible_or_missing_session:'定義・取引日不一致',partial:'一部比較可能',complete:'全件比較可能'})[value] || '未確認' }, { key: 'qualifiedApproach', label: '選定通過かつ接近' }, { key: 'qualifiedBreakoutRange', label: '選定通過かつ買い範囲' }, { key: 'readyBreakoutRange', label: '購入条件通過' }, { key: 'qualifiedCrossings', label: '選定通過の上抜け' }, { key: 'readyCrossings', label: '購入条件通過の上抜け' }, { key: 'crossingCoverage', label: '上抜け比較可能数' }, { key: 'crossingMissing', label: '比較不能数' }, { key: 'qualificationUnknown', label: '選定未確認数' }, { key: 'readinessUnknown', label: '購入未確認数' }]}>
        <p>現在の位置と、その日に新しく超えた銘柄数は別の観測です。未確認は0に含めません。下側の接近幅は、書籍のピボット上2〜3%という購入位置の説明とは別のアプリ設定です。</p>
      </IndicatorHistoryPanel>
    </>}
    <p className="indicator-history-meta">銘柄ごとの「機関保有の四半期推移」と「ベース段階の推移」は、<a href="#/">銘柄を選択 → 履歴</a>で確認できます。公開集合の増減にはカバレッジと生存者バイアスがあります。</p>
  </section>;
}
