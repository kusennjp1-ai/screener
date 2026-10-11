import { Alert, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { MARKET_HISTORY_GROUPS, MARKET_HISTORY_METRICS, marketIndicatorHistory } from '../marketIndicatorHistory.js';

const number = value => value == null ? '未確認' : value.toLocaleString('ja-JP', { maximumFractionDigits: 4 });
export default function MarketIndicatorHistory({ history, market, asOfDate }) {
  const data = marketIndicatorHistory(history, { market, asOfDate });
  return <section aria-label="市場指標の履歴">
    <Typography sx={{ my: 1 }}>分析基準日 {asOfDate || '未確認'} ／ 市場 {market || '未確認'}。対象日と取得日時は別です。欠損をゼロで補完せず、古い観測を当日の値へ繰り越しません。</Typography>
    <Typography sx={{ fontSize: 12 }}>取得日時は当時の公表済みを証明しません。日次以外の記録を日次へ補間せず、数値から購入可否を判定しません。</Typography>
    {data.issues.map(issue => <Alert key={issue} severity="warning" sx={{ my: 1 }}>{issue}</Alert>)}
    {MARKET_HISTORY_GROUPS.map(group => <section key={group.label} aria-label={group.label}>
      <Typography component="h3" sx={{ mt: 2, fontWeight: 700 }}>{group.label}</Typography>
      <Typography sx={{ fontSize: 12 }}>{group.note}</Typography>
      {group.metrics.filter(metric => !data.series.some(s => s.metric === metric)).map(metric => <Typography key={metric} sx={{ my: 1 }}>{MARKET_HISTORY_METRICS[metric].label}：比較可能な履歴は未取得です。</Typography>)}
      {data.series.filter(s => group.metrics.includes(s.metric)).map(series => <div key={series.key}>
        <Typography sx={{ mt: 1 }}>{series.label} ／ {series.instrument} ／ {series.approximate ? '近似' : '提供データ上は近似なし（独立検証は未実施）'}</Typography>
        <Typography sx={{ fontSize: 12, overflowWrap: 'anywhere' }}>母集団：{series.population} ／ 方法：{series.method} ／ 出典：{series.source} ／ 単位：{series.unit}</Typography>
        <Typography sx={{ my: 1 }}>{series.frequency === 'quarterly' ? '四半期観測（日次ではありません）' : series.frequency === 'manual' ? '手動確認' : '日次観測'}{series.historical ? ' ／ 最新の記録も分析基準日より前です' : ''}。最新対象日 {series.latest?.date || '未確認'}：{number(series.latest?.value)}{series.frequency === 'quarterly' ? ` ／ 前四半期比 ${number(series.delta)}` : ''}</Typography>
        <TableContainer sx={{ maxHeight: 260 }}><Table size="small" aria-label={`${series.label}の履歴`}>
          <TableHead><TableRow>{['対象日', '値', '取得日時（UTC）', '状態'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
          <TableBody>{[...series.points].reverse().map(point => <TableRow key={point.date}>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{point.date}</TableCell><TableCell>{number(point.value)}</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{point.collected_at || '未確認'}</TableCell><TableCell>{point.reason || '観測値'}</TableCell>
          </TableRow>)}</TableBody>
        </Table></TableContainer>
      </div>)}
    </section>)}
  </section>;
}
