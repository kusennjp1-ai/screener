import { Alert, Typography } from '@mui/material';

const number = (n, unit = '') => typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(2)}${unit}` : '未確認';
const direction = d => d?.state === 'sustained-up' ? `全${d.sessions}営業日で上向き` : d?.state === 'sustained-down' ? `全${d.sessions}営業日で下向き` : d?.state === 'mixed' ? `上昇${d.upSteps}・下降${d.downSteps}・横ばい${d.flatSteps}日（形状確認）` : '必要な履歴が不足';

export default function BookTechnicalEvidence({ evidence: e }) {
  return <details style={{ marginTop: 12 }}>
    <summary>実測根拠：200日線の継続・独立RS・VCP区間</summary>
    {!e?.valid ? <Alert role="note" severity="warning" sx={{ mt: 1 }}>日足検証済みの実測根拠は未取得です。</Alert> : <>
      <dl className="sepa-review">
        <dt>200日線の1か月</dt><dd>{direction(e.sma200?.oneMonth)}。始点比 {number(e.sma200?.oneMonth?.changePct, '%')}。</dd>
        <dt>望ましい4〜5か月</dt><dd>4か月：{direction(e.sma200?.preferredFourMonths)}。5か月：{direction(e.sma200?.preferredFiveMonths)}。追加の望ましい特徴として表示し、最低条件にすり替えません。</dd>
        <dt>株価 / SPYの独立計算</dt><dd>6週：{direction(e.rs?.sixWeeks)}。13週：{direction(e.rs?.thirteenWeeks)}。{e.rs?.scope}。{e.rs?.errors?.join(' / ')}</dd>
        <dt>VCPの区間測定</dt><dd>{e.vcp?.source === 'reviewer-intervals' ? `指定元：${e.vcp.reviewer?.source || '不明'} ／ 確認日時：${e.vcp.reviewer?.reviewedAt || '不明'}` : '自動ピーク探索による候補区間'}。成立認定ではありません。{e.vcp?.errors?.join(' / ')}</dd>
      </dl>
      {e.vcp?.legs?.length ? <div style={{ overflowX: 'auto' }}><table className="research-table" aria-label="VCPの収縮実測">
        <thead><tr><th>区間</th><th>日中高値 → 安値</th><th>押し</th><th>営業日</th><th>平均出来高</th></tr></thead>
        <tbody>{e.vcp.legs.map((leg, i) => <tr key={`${leg.startDate}-${leg.endDate}`}><td>T{i + 1}：{leg.startDate} → {leg.endDate}</td><td>{number(leg.high)} → {number(leg.low)}</td><td>{number(leg.depthPct, '%')}</td><td>{leg.sessions}</td><td>{number(leg.averageVolume)}</td></tr>)}</tbody>
      </table></div> : <Typography sx={{ fontSize: 13 }}>検証可能な収縮区間はありません。</Typography>}
      {e.vcp?.finalContractionVolume && <Typography sx={{ fontSize: 13, mt: 1 }}>最後の収縮：開始前50日平均に対し、区間平均 {number(e.vcp.finalContractionVolume.intervalRatio, '倍')} ／ 最後の1本 {number(e.vcp.finalContractionVolume.lastRatio, '倍')} ／ 最後の2本平均 {number(e.vcp.finalContractionVolume.lastTwoRatio, '倍')}。比較元 {e.vcp.finalContractionVolume.baselineStart}〜{e.vcp.finalContractionVolume.baselineEnd}、末尾 {e.vcp.finalContractionVolume.lastDate}。50日窓はアプリの代理比較で、売り枯れの自動認定ではありません。</Typography>}
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>毎日の増減は実測値です。mixedの期間はトレンド形状の確認が必要です。通常VCPの候補測定であり、実際のベース境界・ステージ・パワープレーの例外を代わりに認定するものではありません。基準日：{e.as_of_date}</Typography>
    </>}
  </details>;
}
