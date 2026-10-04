import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchStaticChartPayload, staticChartKeys } from '../chartClient';
import { requireChartIdentity } from '../chartPayloadIdentity';
import { buildSetupEvidence } from '../setupEvidencePresentation';
import { entrySourceContext } from '../bookSourceContext';
import { entryZonePercent } from '../researchEngine';
import { money, signed } from '../positionGeometry';
import './setupEvidence.css';

const number = value => typeof value === 'number' && Number.isFinite(value)
  ? value.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) : '未確認';
const ratio = value => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}倍` : '未確認';
const range = (start, end) => start && end ? `${start}〜${end}` : '期間未確認';

function EvidenceContents({ row, method, date, now, payload, loading = false, error = false }) {
  const evidence = useMemo(() => buildSetupEvidence({ row, method, date, now, payload }), [row, method, date, now, payload]);
  const { selection, pivot, position, high, formation, dailyVolume } = evidence;
  const source = entrySourceContext(method, entryZonePercent(method), position.distance);
  const dailyLabel = dailyVolume?.proxyState === 'met' ? '増加の代理条件に該当'
    : dailyVolume?.proxyState === 'not-met' ? '増加の代理条件に非該当' : '未確認';
  return <section className="setup-evidence-panel" aria-label="セットアップの現在地">
    <header><h3>セットアップの現在地</h3><span>{date || '基準日未確認'} 終値基準</span></header>
    <p className="setup-evidence-scope">現在の確認状況です。日足は基準日の終値を使います。過去からの進行順やVCP成立の証明ではありません。</p>
    <dl className="setup-state-rail" aria-label="独立した確認項目">
      <div><dt>一次選定</dt><dd>{selection ? `${selection.passed}/${selection.total} ${selection.qualified ? '通過' : '未達・未確認あり'}` : '未確認'}</dd></div>
      <div><dt>収縮候補の出来高</dt><dd>{formation ? `${ratio(formation.intervalRatio)}（区間平均）` : '区間未確認'}</dd></div>
      <div><dt>日次の買い位置</dt><dd>{position.state}</dd></div>
      <div><dt>当日の出来高</dt><dd>{dailyLabel}</dd></div>
    </dl>
    <div className="setup-price-evidence">
      <dl>
        <div><dt>共通ピボット（局所的な買い水準）</dt><dd>{money(pivot.price)}<small>{pivot.reason}</small></dd></div>
        <div><dt>252営業日高値（当日含む）</dt><dd>{money(high?.price)}<small>{high ? `終値は高値から ${high.belowHighPct.toFixed(2)}%下` : '検証済み高値は未確認'}</small></dd></div>
      </dl>
      <p>{pivot.price && high && high.price > pivot.price
        ? `局所ピボットの上に252営業日高値があります（差 ${high.abovePivotPct.toFixed(2)}%）。`
        : !pivot.price ? '有効な共通ピボットは未確認です。252営業日高値を買い水準の代わりには使いません。'
          : '買い位置は共通ピボットを基準に確認します。'} 高値は価格の位置を示す参考で、ベース抵抗線の認定ではありません。</p>
    </div>
    <div className="setup-volume-evidence">
      <section aria-label="形成中の売り枯れの確認">
        <h4>形成中の売り枯れ</h4><strong>{ratio(formation?.intervalRatio)}<small>収縮候補の区間平均 / 開始前50営業日平均</small></strong>
        <p>{formation ? `${range(formation.start, formation.end)}・${formation.bars}本。自動探索した最後の候補区間です。` : '検証可能な収縮候補の区間は未取得です。'}</p>
        <p>{formation?.reachesCurrentPivot === true ? '区間内に現ピボットへの到達・超過があり、上放れ前の区間とは扱いません。'
          : formation?.reachesCurrentPivot === false ? '区間内は現ピボット未到達。当時のピボットや上放れ日は未確認です。'
            : '有効なピボットと区間の前後関係は未確認です。'} 売り枯れ・最終収縮の成立は未認定です。</p>
      </section>
      <section aria-label="上放れ時の出来高の確認">
        <h4>上放れ時の出来高</h4><strong>{ratio(dailyVolume?.ratio)}<small>当日 / 直前50営業日平均</small></strong>
        <p>{dailyVolume ? `${dailyVolume.date}・終値の前日比 ${signed(dailyVolume.changePct)}。${dailyLabel}。` : '同じ基準日の検証済み出来高・前日比は未取得です。'}</p>
        <p>{dailyVolume?.atOrAbovePivot === false ? '日次終値はピボット未到達。' : dailyVolume?.atOrAbovePivot === true ? '日次終値は現ピボット以上。' : 'ピボットとの位置は未確認。'} 上昇日かつ1.4倍以上はアプリの代理条件です。上放れ成立の認定ではありません。</p>
      </section>
    </div>
    {loading && <p role="status">チャートと共通の日足を読み込み中…</p>}
    {error && <p role="note">日足を取得・照合できません。出来高と252営業日高値は未確認です。</p>}
    {!loading && !error && !evidence.valid && <p role="note">{evidence.errors.join(' / ')}</p>}
    <details className="setup-measurement-details">
      <summary>測定期間・比較元と書籍の目安</summary>
      <dl>
        <dt>収縮候補の比較元</dt><dd>{formation ? `${range(formation.baselineStart, formation.baselineEnd)}・${formation.baselineSessions}営業日、平均 ${number(formation.baselineMean)}。区間平均 ${number(formation.averageVolume)}。末尾 ${formation.lastDate} の1本 ${ratio(formation.lastRatio)}、末尾2本平均 ${ratio(formation.lastTwoRatio)}。` : '収縮候補の区間と開始前50営業日の比較元は未確認です。'} 比較元が50本未満または平均0の場合、倍率は未確認です。</dd>
        <dt>当日の比較元</dt><dd>{dailyVolume ? `${range(dailyVolume.baselineStart, dailyVolume.baselineEnd)}・${dailyVolume.baselineSessions}営業日、平均 ${number(dailyVolume.baselineMean)}。当日 ${dailyVolume.date} は ${number(dailyVolume.volume)}。` : '直前50営業日の比較元は未確認です。'} 当日は平均から除外。場中価格では更新しません。</dd>
        <dt>252営業日の窓</dt><dd>{high ? `${range(high.start, high.end)}・${high.sessions}営業日（当日含む）。高値を最後に観測した日 ${high.observed}。` : '同一銘柄・同一基準日で252営業日を検証できていません。'}</dd>
        <dt>書籍とアプリの確認範囲</dt><dd>第1冊は最終収縮の出来高減少と上放れ時の増加を別々に確認します（Kindle表示296/421・300/421）。候補区間と開始前の固定50日平均を使う比較はアプリの近似です。{source.model} {source.detail}</dd>
      </dl>
    </details>
  </section>;
}

function ChartEvidence(props) {
  const { row, date, chartEntry, generation } = props;
  // Exactly the existing selected-chart key and guard: observers share the
  // request/cache, with no provider call, detail fan-out, or stock_data fallback.
  const query = useQuery({
    queryKey: [...staticChartKeys.payload(row.symbol, chartEntry.path), generation],
    queryFn: () => fetchStaticChartPayload(chartEntry.path),
    staleTime: 60000, placeholderData: () => undefined,
    select: payload => requireChartIdentity(payload, row.symbol, date),
  });
  return <EvidenceContents {...props} payload={query.isError ? undefined : query.data} loading={query.isLoading} error={query.isError} />;
}

export default function SetupEvidencePanel(props) {
  return props.chartEntry?.path && props.row?.symbol
    ? <ChartEvidence {...props} /> : <EvidenceContents {...props} payload={undefined} />;
}
