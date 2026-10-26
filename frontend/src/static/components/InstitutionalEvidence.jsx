import { Typography } from '@mui/material';
import MetricDisclosure from './MetricDisclosure';
import { institutionalGrowth } from '../institutionalEvidence';
import { formatPublished } from '../researchPresentation';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim() ? value : '未確認';
// The existing 13F producer treats no reported holdings as unknown. Its
// comparator requires positive integer counts; the UI must preserve that rule.
const managers = value => Number.isSafeInteger(value) && value > 0 ? `${value.toLocaleString('ja-JP')}社` : '未確認';
export default function InstitutionalEvidence({row, date}) {
  const supplied = row?.institutional_evidence;
  const data = record(supplied) && typeof row?.symbol === 'string' && supplied.symbol === row.symbol ? supplied : null;
  const observations = Array.isArray(data?.observations) ? data.observations : [];
  // Do not drop malformed observations and accidentally compare a different pair.
  const result = institutionalGrowth(observations.every(record) ? data : null, row?.symbol, date);
  return <section aria-label="機関投資家の保有履歴">
    <MetricDisclosure key={`${row?.symbol}/${date}`} summary={<span><Typography component="h3" variant="subtitle1">機関投資家の保有履歴</Typography><span>前期比 {result.delta == null ? '未確認' : `${result.delta>0?'+':''}${String(result.delta).replace(/^-/, '−')}社`}</span></span>}>
    <Typography sx={{fontSize:13,my:1}}>{result.reason}</Typography>
    <Typography sx={{fontSize:12,my:1}}>四半期ごとの13F報告運用会社数です。実際の購入者数・日次の買い集め件数ではありません。</Typography>
    {data && <>
      {observations.length ? <div style={{overflowX:'auto'}}><table className="research-table"><thead><tr><th>保有対象期</th><th>報告運用会社数</th><th>提出・公表日の範囲</th></tr></thead><tbody>
        {observations.map((o, index)=><tr key={index}><td>{text(o?.period)}</td><td>{managers(o?.manager_count)}</td><td>{text(o?.filing_date_first)}〜{text(o?.filing_date_last)}</td></tr>)}
      </tbody></table></div> : <Typography sx={{fontSize:13}}>保有対象期別の観測は未取得です。</Typography>}
      <Typography sx={{fontSize:12,my:1}}>取得 {formatPublished(typeof data.retrieved_at === 'string' ? data.retrieved_at : null)} · <a style={{display:'inline-flex',alignItems:'center',minHeight:44,minWidth:44}} href={typeof data.source_url === 'string' ? data.source_url : undefined} target="_blank" rel="noreferrer">SEC 13F</a> / OpenFIGI</Typography>
      <Typography sx={{fontSize:12,color:'text.secondary'}}>{typeof data.scope === 'string' ? data.scope : ''} 保有株数の増減や運用成績を表す数値ではありません。訂正報告を反映し、同じ報告会社の重複行を除いて集計しています。</Typography>
      {data.refresh?.status==='unavailable' && <Typography sx={{fontSize:12,color:'warning.main'}}>最新アーカイブの自動取得に失敗したため、上記の公表期限までに取得済みの報告を表示しています。</Typography>}
    </>}
    </MetricDisclosure>
  </section>;
}
