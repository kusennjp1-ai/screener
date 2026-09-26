import { useState } from 'react';
import { Alert, Button, Typography } from '@mui/material';
import { readBreakoutReviews } from '../bookBreakoutJournal';
const read = () => { try { return { ...readBreakoutReviews(window.localStorage), error: false }; } catch { return { records: [], invalid: 0, error: true }; } };
export default function BookBreakoutJournal() {
  const [data, setData] = useState(read);
  return <details className="market-disclosure"><summary>自分が確認したベースのブレイク順を追跡</summary>
    <Typography sx={{ my: 1, fontSize: 13 }}>各銘柄の「ブレイク後の異常動作と初期・後期の区別」を使って、適切なベースと実際の上放れ日を確認した記録です。この端末の自己申告を発生日順に並べます。全市場の自動検出でも、当時その情報を知っていた証明でもありません。</Typography>
    <Button onClick={() => setData(read())}>確認記録を読み直す</Button>
    {data.error && <Alert severity="warning">端末の確認記録を読み取れません。</Alert>}
    {data.invalid > 0 && <Typography>形式・根拠が不十分な{data.invalid}件は一覧に含めていません。</Typography>}
    {!data.records.length ? <Typography sx={{ my: 1 }}>確認記録はまだありません。銘柄詳細で、ブレイク日・根拠資料・局面を確認して記録します。</Typography> : <div style={{overflowX:'auto'}}><table className="financial-evidence-table" aria-label="確認したベースのブレイク順"><thead><tr>{['ブレイク日','銘柄','確認日','分析日','根拠資料'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{data.records.map(r=><tr key={`${r.symbol}-${r.breakoutDate}`}><td>{r.breakoutDate}</td><th>{r.symbol}</th><td>{r.reviewDate}</td><td>{r.asOfDate}</td><td>{r.source}</td></tr>)}</tbody></table></div>}
    <Typography sx={{ my: 1, fontSize: 12 }}>早く動いた銘柄の追跡材料です。成功した銘柄だけを後から登録すると選択バイアスが生じます。失敗例も同じ基準で記録し、現在の購入可能銘柄数とは区別してください。</Typography>
  </details>;
}
