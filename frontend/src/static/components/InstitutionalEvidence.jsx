import { Typography } from '@mui/material';
import { institutionalGrowth } from '../institutionalEvidence';
import { formatPublished } from '../researchPresentation';
export default function InstitutionalEvidence({row, date}) {
  const data=row.institutional_evidence, result=institutionalGrowth(data,row.symbol,date);
  return <section aria-label="機関投資家の保有履歴">
    <Typography component="h3" variant="subtitle1">機関投資家の保有履歴</Typography>
    <Typography sx={{fontSize:13,my:1}}>{result.reason}</Typography>
    {data && <>
      <div style={{overflowX:'auto'}}><table className="research-table"><thead><tr><th>保有対象期</th><th>報告運用会社数</th><th>提出・公表日の範囲</th></tr></thead><tbody>
        {data.observations?.map(o=><tr key={o.period}><td>{o.period}</td><td>{o.manager_count.toLocaleString()}社</td><td>{o.filing_date_first}〜{o.filing_date_last}</td></tr>)}
      </tbody></table></div>
      <Typography sx={{fontSize:12,my:1}}>前期比 {result.delta == null ? '未確認' : `${result.delta>0?'+':''}${String(result.delta).replace(/^-/, '−')}社`} · 取得 {formatPublished(data.retrieved_at)} · <a href={data.source_url} target="_blank" rel="noreferrer">SEC 13F</a> / OpenFIGI</Typography>
      <Typography sx={{fontSize:12,color:'text.secondary'}}>{data.scope} 保有株数の増減や運用成績を表す数値ではありません。訂正報告を反映し、同じ報告会社の重複行を除いて集計しています。</Typography>
      {data.refresh?.status==='unavailable' && <Typography sx={{fontSize:12,color:'warning.main'}}>最新アーカイブの自動取得に失敗したため、上記の公表期限までに取得済みの報告を表示しています。</Typography>}
    </>}
  </section>;
}
