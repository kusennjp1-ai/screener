import { Typography } from '@mui/material';
import { financialHistory } from '../financialHistory';
const value = n => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US',{maximumFractionDigits:3}) : '未取得';
export default function FinancialHistory({row, date}) {
  const data=row.financial_history, report=financialHistory(data,row.symbol,date);
  return <details className="research-disclosure"><summary>取得した財務履歴 — 年次EPS・四半期業績</summary>
    {!data || !report.valid ? <Typography sx={{fontSize:13}}>この銘柄の有効なUSD財務履歴は未取得、または取得から72時間を超えています。</Typography> : <>
      <Typography sx={{fontSize:12,my:1}}>{data.source}・USD・取得 {data.retrieved_at}。報告希薄化EPSで、調整後EPSとは異なります。取得時点の財務履歴です。分析日当時の公表確認や過去検証には使いません。</Typography>
      <div style={{overflowX:'auto'}}><table><caption>年次の希薄化EPS</caption><thead><tr><th>決算期末</th><th>EPS</th></tr></thead><tbody>{report.annual.map(p=><tr key={p.end}><td>{p.end}</td><td>{value(p.eps)}</td></tr>)}</tbody></table></div>
      <Typography sx={{fontSize:12,my:1}}>直近3年の成長率：{report.annualGrowth ? report.annualGrowth.map(n=>`${n.toFixed(1)}%`).join(' → ') : '比較不可（4期不足・欠損・赤字基準年・期間不整合など）'}</Typography>
      <div style={{overflowX:'auto'}}><table><caption>四半期の報告業績</caption><thead><tr><th>決算期末</th><th>EPS</th><th>売上 USD</th></tr></thead><tbody>{report.quarterly.map(p=><tr key={p.end}><td>{p.end}</td><td>{value(p.eps)}</td><td>{value(p.revenue)}</td></tr>)}</tbody></table></div>
      <a href={data.source_url} target="_blank" rel="noopener noreferrer">提供元の財務情報</a>
    </>}
  </details>;
}
