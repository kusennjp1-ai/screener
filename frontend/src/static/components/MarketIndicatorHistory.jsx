import { useMemo, useState } from 'react';
import { Alert, Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, useMediaQuery } from '@mui/material';
import { MARKET_HISTORY_GROUPS, MARKET_HISTORY_METRICS, marketIndicatorHistory } from '../marketIndicatorHistory.js';

const number = value => {
  if (value == null) return '未確認';
  const displayed = value.toLocaleString('ja-JP', { maximumFractionDigits: 4 });
  // A small observed ratio must not become an observed zero after rounding.
  return value !== 0 && displayed === '0'
    ? value.toLocaleString('ja-JP', { notation: 'scientific', maximumSignificantDigits: 15 })
    : displayed;
};
const text = value => typeof value === 'string' && value.trim() ? value : '未確認';
export default function MarketIndicatorHistory({ history, market, asOfDate, provenance, omitMarketGraphs = false }) {
  const data = useMemo(() => marketIndicatorHistory(history, { market, asOfDate }), [history, market, asOfDate]);
  const symbols = [...new Set(data.series.filter(series => series.scope === 'security').map(series => series.instrument))].sort();
  const [selectedSymbol, setSelectedSymbol] = useState('');
  // Derive a valid selection immediately when a new snapshot removes a symbol;
  // a preceding snapshot's rows must never survive a prop change.
  const symbol = symbols.includes(selectedSymbol) ? selectedSymbol : symbols[0];
  const visibleSeries = data.series.filter(series => series.scope !== 'security' || series.instrument === symbol);
  const mapping = Array.isArray(provenance?.mappings) ? provenance.mappings.filter(item => item && !Array.isArray(item) && item.symbol === symbol) : [];
  const unavailable = Array.isArray(provenance?.selection?.unavailable) ? Array.from(provenance.selection.unavailable) : [];
  const narrow = useMediaQuery('(max-width:700px)');
  return <section aria-label="市場指標の履歴" className="market-indicator-history">
    <Typography sx={{ my: 1 }}>分析基準日 {asOfDate || '未確認'} ／ 市場 {market || '未確認'}。対象日と取得日時は別です。欠損をゼロで補完せず、古い観測を当日の値へ繰り越しません。</Typography>
    <Typography sx={{ fontSize: 12 }}>取得日時は当時の公表済みを証明しません。日次以外の記録を日次へ補間せず、数値から購入可否を判定しません。</Typography>
    {provenance && <div aria-label="保存履歴の出典">
      <Typography sx={{ fontSize: 12, my: 1 }}>保存履歴の分析基準日 {asOfDate || '未確認'} は取得日ではありません。取得済みの記録であり、現在値や当時の公表済みを証明するものではありません。</Typography>
      <Typography sx={{ fontSize: 12, overflowWrap: 'anywhere' }}>保存元 SEC 取得日時（元記録・UTC）：{text(provenance.sec?.retrieved_at)} ／ 提出・公表期限：{text(provenance.sec?.publication_cutoff)}</Typography>
      {provenance.timestamp_projection === 'latest_required_source_input_utc_truncated_to_milliseconds' && <Typography sx={{ fontSize: 12 }}>各観測の取得日時は、SEC記録とその銘柄対応表の取得が揃った時点（両者の遅い方）です。表ではミリ秒まで表示し、上記と銘柄別の元記録には取得時の精度を残しています。</Typography>}
    </div>}
    {unavailable.length > 0 && <Box component="ul" aria-label="履歴を確認できない銘柄" sx={{ pl: 2.5, my: 1 }}>
      {unavailable.map((item, index) => <Typography component="li" key={index} sx={{ fontSize: 12, overflowWrap: 'anywhere' }}>
        履歴未確認：{text(!Array.isArray(item) ? item?.symbol : null)} — {text(!Array.isArray(item) ? item?.reason : null)}
      </Typography>)}
    </Box>}
    {symbols.length > 0 && <Box sx={{ my: 2 }}>
      {symbols.length > 1 ? <Box component="label" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        銘柄別履歴の対象銘柄
        <Box component="select" aria-label="銘柄別履歴の対象銘柄" value={symbol} onChange={event => setSelectedSymbol(event.target.value)} sx={{ color: 'text.primary', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, minHeight: 40, p: 1, maxWidth: '100%' }}>
          {symbols.map(item => <option key={item} value={item}>{item}</option>)}
        </Box>
      </Box> : <Typography>銘柄別履歴の対象：{symbol}</Typography>}
      <Typography sx={{ fontSize: 12 }}>保有者数・ベース番号は選択銘柄の観測です。市場全体の集計ではありません。</Typography>
      {provenance && <Typography sx={{ fontSize: 12, overflowWrap: 'anywhere' }}>銘柄対応表 OpenFIGI 取得日時（元記録・UTC）：{mapping.length ? mapping.map(item => text(item.retrieved_at)).join(' ／ ') : '未確認'}</Typography>}
    </Box>}
    {data.issues.map(issue => <Alert key={issue} severity="warning" sx={{ my: 1 }}>{issue}</Alert>)}
    {MARKET_HISTORY_GROUPS.filter(group => !omitMarketGraphs || !group.metrics.some(metric => ['put_call_ratio','new_highs','new_lows','distribution_sp500','distribution_nasdaq'].includes(metric))).map(group => <section key={group.label} aria-label={group.label}>
      <Typography component="h3" sx={{ mt: 2, fontWeight: 700 }}>{group.label}</Typography>
      <Typography sx={{ fontSize: 12 }}>{group.note}</Typography>
      {group.metrics.filter(metric => !visibleSeries.some(s => s.metric === metric)).map(metric => <Typography key={metric} sx={{ my: 1 }}>{MARKET_HISTORY_METRICS[metric].label}：比較可能な履歴は未取得です。</Typography>)}
      {visibleSeries.filter(s => group.metrics.includes(s.metric)).map(series => <div key={series.key}>
        <Typography sx={{ mt: 1 }}>{series.label} ／ {series.instrument} ／ {series.approximate ? '近似' : '提供データ上は近似なし（独立検証は未実施）'}</Typography>
        <Typography sx={{ fontSize: 12, overflowWrap: 'anywhere' }}>母集団：{series.population} ／ 方法：{series.method} ／ 出典：{series.source} ／ 単位：{series.unit}</Typography>
        <Typography sx={{ my: 1 }}>{series.frequency === 'quarterly' ? '四半期観測（日次ではありません）' : series.frequency === 'manual' ? '手動確認' : '日次観測'}{series.historical ? ' ／ 最新の記録も分析基準日より前です' : ''}。最新対象日 {series.latest?.date || '未確認'}：{number(series.latest?.value)}{series.frequency === 'quarterly' ? ` ／ 前四半期比 ${number(series.delta)}` : ''}</Typography>
        {narrow ? <ol className="market-history-cards" aria-label={`${series.label}の履歴`}>
          {[...series.points].reverse().map(point => <li key={point.date}><dl>
            <dt>対象日</dt><dd>{point.date}</dd>
            <dt>値</dt><dd>{number(point.value)}</dd>
            <dt>状態・未確認理由</dt><dd>{point.reason || '観測値'}</dd>
            <dt>取得日時（UTC）</dt><dd>{point.collected_at || '未確認'}</dd>
          </dl></li>)}
        </ol> : <TableContainer sx={{ maxHeight: 260 }}><Table size="small" aria-label={`${series.label}の履歴`}>
          <TableHead><TableRow>{['対象日', '値', '取得日時（UTC）', '状態'].map(label => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead>
          <TableBody>{[...series.points].reverse().map(point => <TableRow key={point.date}>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{point.date}</TableCell><TableCell>{number(point.value)}</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{point.collected_at || '未確認'}</TableCell><TableCell>{point.reason || '観測値'}</TableCell>
          </TableRow>)}</TableBody>
        </Table></TableContainer>}
      </div>)}
    </section>)}
  </section>;
}
