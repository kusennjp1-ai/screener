import { instrumentApplicability, instrumentApplicabilityLabel } from '../instrumentApplicability';
import { financialHistory, ANNUAL_REPORTED_LIMITATION, annualComparisonText, annualAvailabilityText } from '../financialHistory';
import { Typography } from '@mui/material';
import { currentFinancialHistory } from '../financialCurrent';
import './financialEvidence.css';
const value = n => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US',{maximumFractionDigits:3}).replace(/^-/, '−') : '未取得';
export default function FinancialHistory({row, date, now = Date.now(), expanded = false}) {
  const applicability=instrumentApplicability(row), blocked=applicability.status!=='unverified';
  const data=blocked ? row.financial_historical?.financial_history || row.financial_history : row.financial_history;
  const report=blocked ? financialHistory(data,row.symbol,date,Date.parse(data?.retrieved_at)) : currentFinancialHistory(data,row.symbol,date,now,row);
  const content = <>
    {blocked && <Typography role="note">{instrumentApplicabilityLabel(applicability)}。以下は保存した参考記録です。企業EPS・売上成長の現在の判定には使用しません。</Typography>}
    {!data || !report.valid ? <Typography sx={{fontSize:13}}>この銘柄の有効な報告財務履歴は未取得、または取得から72時間を超えています。</Typography> : <>
      <Typography sx={{fontSize:12,my:1}}>{typeof data.source === 'string' && data.source.trim() ? data.source : '提供元 未確認'}・履歴で最古の取得 {data.retrieved_at}。報告希薄化EPSで、調整後EPSとは異なります。{ANNUAL_REPORTED_LIMITATION}取得時点の財務履歴です。分析日当時の公表確認や過去検証には使いません。</Typography>
      {data.annual_source && report.annual.length > 0 && <Typography sx={{fontSize:12}}>年次EPS・取得 {data.annual_source.observed_at}</Typography>}
      {report.annual.length ? <div style={{overflowX:'auto'}}><table className="financial-history-table"><caption>年次の希薄化EPS</caption><thead><tr><th scope="col">決算期末</th><th scope="col">EPS（{data.annual_currency || data.currency} / 提供元の株式単位）</th></tr></thead><tbody>{report.annual.map(p=><tr key={p.end}><th scope="row">{p.end}</th><td>{value(p.eps)}</td></tr>)}</tbody></table></div> : <p className="financial-history-unavailable">年次EPSは未取得です。連続4期の実績がないため、3年の成長履歴を確認できません。</p>}
      <Typography sx={{fontSize:12,my:1}}>{blocked ? '参考計算・直近3年の比率：' : '直近3年の成長率：'}{report.annualGrowth ? report.annualGrowth.map(n=>`${n.toFixed(1)}%`).join(' → ') : '比較不可（4期不足・欠損・赤字基準年・期間不整合など）'}</Typography>
      {!report.annualGrowth && report.annualComparisons.length > 0 && <><Typography sx={{fontSize:12}}>{annualAvailabilityText(report)}。確認できる年次比較と未確認の年次比較：</Typography><ul>{report.annualComparisons.map(comparison => <li key={comparison.to}>{annualComparisonText(comparison)}</li>)}</ul></>}
      {data.quarterly_retrieved_at && report.quarterly.length > 0 && <Typography sx={{fontSize:12}}>四半期業績・取得 {data.quarterly_retrieved_at}</Typography>}
      {report.quarterly.length ? <div style={{overflowX:'auto'}}><table className="financial-history-table"><caption>四半期の報告業績（前年比の選定条件とは別資料）</caption><thead><tr><th scope="col">決算期末</th><th scope="col">EPS（{data.quarterly_currency || data.currency}）</th><th scope="col">売上（{data.quarterly_currency || data.currency}）</th></tr></thead><tbody>{report.quarterly.map(p=><tr key={p.end}><th scope="row">{p.end}</th><td>{value(p.eps)}</td><td>{value(p.revenue)}</td></tr>)}</tbody></table></div> : <p className="financial-history-unavailable">四半期の報告業績は未取得です。年次EPSから四半期EPSや売上前年比を補完しません。</p>}
      {typeof data.source_url === 'string' && /^https:\/\//.test(data.source_url) && <a href={data.source_url} target="_blank" rel="noopener noreferrer">提供元の財務情報</a>}
    </>}
  </>;
  return expanded ? <section aria-label="取得した財務履歴"><h3>取得した財務履歴 — 年次EPS・四半期業績</h3>{content}</section> :
    <details className="research-disclosure"><summary>取得した財務履歴 — 年次EPS・四半期業績</summary>{content}</details>;
}
