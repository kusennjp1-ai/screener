import { Alert, Typography } from '@mui/material';
import { assess, finite } from '../researchEngine';
import BookChartReview from './BookChartReview';
import BookFinancialReview from './BookFinancialReview';
import BookTechnicalEvidence from './BookTechnicalEvidence';

// A trend template is the first selection stage, not certification of SEPA.
// Missing quarterly histories and documentary evidence must remain explicit.
export default function SepaReview({ row, method = 'minervini' }) {
  const trend = assess(row, method);
  const percent = n => finite(n) ? `${n.toFixed(1)}%` : '未取得';
  return <section aria-label="SEPAの確認範囲">
    <Alert role="note" severity={trend.qualified ? 'info' : 'warning'} sx={{ mt: 2 }}>
      {trend.qualified ? 'トレンド一次選考を通過。SEPAの総合確認は未完了です。' : 'トレンド一次選考は未充足または未確認です。'}
    </Alert>
    <details style={{ marginTop: 12 }}>
      <summary>SEPAの5要素と不足している根拠</summary>
      <dl className="sepa-review">
        <dt>01 トレンド</dt><dd>日足の再計算とRS推計で {trend.passed}/{trend.total}。RSは公式値ではなく公開日足内の順位です。</dd>
        <dt>02 業績</dt><dd>EPS前年比 {percent(row.eps_growth_yy)}・売上前年比 {percent(row.sales_growth_yy)}。下の財務履歴で、提出日の根拠がある成長加速と利益率を評価します。利益の質・予想修正は別途確認が必要です。単一四半期の伸びだけでは認定しません。</dd>
        <dt>03 上昇のきっかけ</dt><dd>未確認。新製品・契約・経営変化などを会社の開示で確認します。株価の上昇だけから材料を推測しません。</dd>
        <dt>04 買い場</dt><dd>VCP検出器：{row.vcp_detected === true ? '検出あり（形状の確認が必要）' : row.vcp_detected === false ? '未検出' : '未取得'}。収縮の順序・深さ・期間、右端の出来高減少、ピボット付近の売り圧力と決算予定を確認します。検出スコアは実測した収縮の証明ではありません。</dd>
        <dt>05 売り場・リスク</dt><dd>損切りと利益確定の条件を買う前に決めます。画面の7%損切り・20%目標は計算例で、書籍共通の固定売却ルールではありません。実際のベース・値動きに応じた逆指値と株数は未確定です。</dd>
      </dl>
      <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>書籍の枠組みを参考にした確認欄です。裁量の評価や未取得の資料を、数値スコアで合格に置き換えません。</Typography>
    </details>
    <BookChartReview diagnostics={row.book_diagnostics} />
    <BookFinancialReview row={row} />
    <BookTechnicalEvidence evidence={row.book_technical_evidence} />
  </section>;
}
