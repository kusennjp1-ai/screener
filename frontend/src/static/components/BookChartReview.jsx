import { Alert, Typography } from '@mui/material';
const number = (n, unit = '') => typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(2)}${unit}` : '未確認';
const status = n => n === true ? '該当' : n === false ? '非該当' : '未確認';
export default function BookChartReview({ diagnostics: d }) {
  return <details style={{ marginTop: 12 }}>
    <summary>書籍のチャート確認材料：RS・出来高・警告</summary>
    {!d?.valid ? <Alert role="note" severity="warning" sx={{ mt: 1 }}>有効な日足による書籍診断は未取得です。日足の再検証で更新できます。</Alert> : <>
      <dl className="sepa-review">
        <dt>RSライン</dt><dd>30営業日前比 {number(d.rsLine?.sixWeeks?.changePct, '%')} ／ 65営業日前比 {number(d.rsLine?.thirteenWeeks?.changePct, '%')}。提供元の対ベンチマークRSラインの端点比較です。期間全体の持続的上昇や公式RS順位を証明しません。</dd>
        <dt>右端の出来高</dt><dd>直近5日平均／その前50日平均 {number(d.rightEdgeVolume?.ratio, '倍')}。実際の最終収縮区間やVCPの成立は未確認です。</dd>
        <dt>複合警告</dt><dd>20日線割れ {status(d.priceWarnings?.below20)}・3日連続安値切り下げ {status(d.priceWarnings?.threeLowerLows)}・出来高 {number(d.priceWarnings?.currentVolumeRatio, '倍')}。複合警告 {status(d.priceWarnings?.combinedWarning)}。出来高1.4倍はアプリの代理閾値で、ブレイク後の状況と買い支えを確認します。</dd>
        <dt>50日線</dt><dd>終値での下抜け {status(d.priceWarnings?.below50)}。単独では売却指示にしません。</dd>
        <dt>パワープレー予備探索</dt><dd>{d.powerPlay?.mechanicalMatch ? '倍増と浅い押しの数値条件に該当' : '今回の固定期間窓では非該当'}。急騰時の大商い、実際のベース境界・ステージ・週足のタイトさは未確認。通常の業績条件とは異なる例外パターンで、成立認定や購入可能判定ではありません。</dd>
      </dl>
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>『株式トレード 基本と原則』の確認観点を分解しています。近似計算を満たしても、書籍の裁量判断を完全に再現したことにはなりません。分析日：{d.as_of_date}</Typography>
      {d.unknowns?.length > 0 && <ul>{d.unknowns.map(s => <li key={s}>{s}</li>)}</ul>}
    </>}
  </details>;
}
