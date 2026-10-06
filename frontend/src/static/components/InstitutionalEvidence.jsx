import { Link, Typography } from '@mui/material';
import IndicatorHistoryPanel from './IndicatorHistoryPanel';
import { institutionalHolderHistory } from '../institutionalHistory';
import { institutionalGrowth } from '../institutionalEvidence';
import { formatPublished } from '../researchPresentation';
export default function InstitutionalEvidence({row, date}) {
  const data=row.institutional_evidence, result=institutionalGrowth(data,row.symbol,date);
  return <section aria-label="機関投資家の保有履歴">
    <Typography component="h3" variant="subtitle1">機関投資家の保有履歴</Typography>
    <Typography sx={{fontSize:13,my:1}}>{result.reason}</Typography>
    <IndicatorHistoryPanel title="四半期の保有報告会社数" history={row.institutional_holder_history?.symbol === row.symbol ? row.institutional_holder_history : institutionalHolderHistory(data,row.symbol,date)} expectedDate={date} columns={[{key:"value",label:"報告運用会社数"}]} extraColumns={[{key:"delta",label:"前四半期比"},{key:"cutoff",label:"公表集計期限"},{key:"filingFirst",label:"提出開始"},{key:"filingLast",label:"最終提出"}]} />
    {data && <>
      <div className="indicator-history-scroll" role="region" aria-label="選定に使う直近2期の保有報告（縦・横にスクロール可能）" tabIndex={0}><table className="research-table" aria-label="選定に使う直近2期の保有報告"><thead><tr><th>保有対象期</th><th>報告運用会社数</th><th>提出・公表日の範囲</th></tr></thead><tbody>
        {(Array.isArray(data.observations) ? data.observations : []).map(o=><tr key={o.period}><td>{o.period}</td><td>{Number.isInteger(o.manager_count) ? o.manager_count.toLocaleString() : '未確認'}社</td><td>{o.filing_date_first}〜{o.filing_date_last}</td></tr>)}
      </tbody></table></div>
      <Typography sx={{fontSize:12,my:1}}>前期比 {result.delta == null ? '未確認' : `${result.delta>0?'+':''}${String(result.delta).replace(/^-/, '−')}社`} · 取得 {formatPublished(data.retrieved_at)} · <Link href={data.source_url} target="_blank" rel="noreferrer" underline="always" sx={theme=>({color:theme.palette.mode==='dark'?theme.palette.primary.light:theme.palette.primary.dark,textDecorationColor:'currentColor'})}>SEC 13F</Link> / OpenFIGI</Typography>
      <Typography sx={{fontSize:12,color:'text.secondary'}}>{data.scope} 保有株数の増減や運用成績を表す数値ではありません。訂正報告を反映し、同じ報告会社の重複行を除いて集計しています。</Typography>
      {data.refresh?.status==='unavailable' && <Typography sx={{fontSize:12,color:'warning.main'}}>最新アーカイブの自動取得に失敗したため、上記の公表期限までに取得済みの報告を表示しています。</Typography>}
    </>}
  </section>;
}
