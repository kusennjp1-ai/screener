import { instrumentApplicabilityLabel } from '../instrumentApplicability';
import { Typography } from '@mui/material';
import { bookFinancialCurrent } from '../bookFinancialCurrent';
const show = n => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('ja-JP', { maximumFractionDigits: 2 }) : '未確認';
const label = s => s === 'pass' ? '充足' : s === 'fail' ? '未充足' : '未確認';
export default function BookFinancialReview({ row, expanded = false, date = row.technical_audit?.as_of_date, now = Date.now() }) {
  const current = bookFinancialCurrent(row.book_financials || row.financial_historical?.book_financials, row.symbol, date, now, row);
  const e = current.report;
  const blocked = current.applicability.status !== 'unverified';
  const stateLabel = value => blocked ? '対象外・参考記録' : label(value);
  return <details id="book-financial-evidence" tabIndex={-1} open={expanded || undefined} style={{ marginTop: 12 }}><summary>業績の連続性と利益の質を確認</summary>
    <Typography sx={{ my: 1, fontSize: 12 }}>『ミネルヴィニの成長株投資法』では4〜8四半期の傾向と年次実績も重視します。1四半期の減速や連続加速の未充足だけで、ミネルヴィニの選定全体を不合格にはしません。以下の連続改善・20%／25%は個別の測定項目です。利益の質は売上の裏付けや一時要因も別途確認します（提供PDF 234–247・277–279）。</Typography>
    <Typography sx={{fontSize:12,my:1,overflowWrap:'anywhere'}}>提供元：{e.source || '未確認'} ／ 取得：{row.book_financials?.retrieved_at || '時刻未確認'}。提出日は取得時刻と異なります。</Typography>
    <Typography sx={{fontSize:12,my:1}}>書籍照合の基準日：{date || '未確認'}。以下は基準日時点の測定記録です。現在の業績確認：{instrumentApplicabilityLabel(current.applicability) || (current.current ? '期間内の参考資料' : '未確認')}。</Typography>
    {!e.valid ? <Typography sx={{ my: 1 }}>提出日付きの四半期履歴は未取得です。単期の成長率を連続成長の証拠に置き換えません。</Typography> : <>
      <Typography sx={{ my: 1 }}>EPS成長加速：{stateLabel(e.epsAcceleration)} ／ 売上成長加速：{stateLabel(e.salesAcceleration)} ／ 純利益率改善：{stateLabel(e.marginImprovement)}</Typography>
      <Typography sx={{ my: 1 }}>コード33の図8.10に対応する4四半期・3回連続改善：{stateLabel(e.code33)}。EPS・売上は前年比、純利益率は水準そのものを比較します。SEPA全体の認定ではありません。</Typography>
      {!current.current && <Typography color="warning.main">{current.reason === 'stale_book_period' ? '最新期末が現在の確認日から180日超前です。' : '現在の確認時点との対応を確認できません。'}現在の業績充足として扱いません。基準日時点の測定記録は保持しています。</Typography>}
      <div style={{ overflowX: 'auto' }}><table className="financial-evidence-table" aria-label="提出日付き四半期業績"><thead><tr>{['期末', 'EPS $', 'EPS前年比%', '売上前年比%', '純利益率%', '根拠提出日'].map(s => <th key={s}>{s}</th>)}</tr></thead><tbody>{e.rows.map(p => <tr key={p.end}><th>{p.end}</th><td>{show(p.eps)}</td><td>{show(p.epsYoY)}</td><td>{show(p.salesYoY)}</td><td>{show(p.margin)}</td><td>{p.filed}</td></tr>)}</tbody></table></div>
      <Typography sx={{ my: 1 }}>直近2期EPS成長20%／25%：{stateLabel(e.epsFloor[2].at20)}／{stateLabel(e.epsFloor[2].at25)}。直近4期：{stateLabel(e.epsFloor[4].at20)}／{stateLabel(e.epsFloor[4].at25)}。過去の取得済み年次EPS最高値更新：{stateLabel(e.annualRecord)}。</Typography>
      <Typography sx={{ fontSize: 12 }}>在庫・売掛金の増加が売上の伸びを上回る項目：{e.balanceCoverage ? `${e.balanceWarnings.length}件（比較可能${e.balanceCoverage}期の範囲）` : '未確認（比較データなし）'}。季節性・事業事情・開示を確認する警戒材料であり、自動失格にはしません。</Typography>
      {e.balanceWarnings.length > 0 && <ul>{e.balanceWarnings.map(p => <li key={`${p.end}-${p.metric}`}>{p.end}：{p.metric === 'inventoryYoY' ? '在庫' : '売掛金'} {show(p.growth)}% ／ 売上 {show(p.salesGrowth)}%</li>)}</ul>}
      {e.source?.startsWith('https://data.sec.gov/') && <a href={e.source} target="_blank" rel="noreferrer">SECの原データ ↗</a>}
      <ul>{e.limitations.map(s => <li key={s}>{s}</li>)}</ul>
    </>}
    <Typography sx={{ mt: 1, fontSize: 12 }}>追加確認が必要：{e.unknowns.join('・')}。通常の業績条件と、パワープレーの例外条件は分けて扱います。</Typography>
  </details>;
}
