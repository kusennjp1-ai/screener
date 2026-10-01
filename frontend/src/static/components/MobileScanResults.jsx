import { canonicalPivot } from '../researchPresentation';
import { Box, Button, MenuItem, Paper, Select, Stack, Typography } from '@mui/material';
const value = (n, digits = 2) => Number.isFinite(n) ? n.toLocaleString('en-US', {minimumFractionDigits: digits, maximumFractionDigits: digits}) : '—';

export default function MobileScanResults({rows, total, page, perPage, sortBy, sortOrder, onSort, onPage, onOpenChart, isChartEnabled}) {
  return <section aria-label="詳細スキャンの銘柄一覧">
    <Stack direction="row" alignItems="center" spacing={1} sx={{my: 1}}>
      <Select size="small" inputProps={{'aria-label': '詳細スキャンの並び順'}} value={sortBy} onChange={e => onSort(e.target.value, sortOrder)} sx={{minHeight: 44, flex: 1, minWidth: 0}}>
        {!['composite_score', 'se_setup_score', 'rs_rating', 'current_price', 'adv_usd'].includes(sortBy) && <MenuItem value={sortBy}>表で選んだ項目</MenuItem>}
        <MenuItem value="composite_score">補助スコア</MenuItem><MenuItem value="se_setup_score">セットアップ点</MenuItem><MenuItem value="rs_rating">RS推計</MenuItem><MenuItem value="current_price">株価</MenuItem><MenuItem value="adv_usd">平均売買代金</MenuItem>
      </Select>
      <Button sx={{minHeight: 44, whiteSpace: 'nowrap', flexShrink: 0}} onClick={() => onSort(sortBy, sortOrder === 'desc' ? 'asc' : 'desc')}>{sortOrder === 'desc' ? '高い順 ↓' : '低い順 ↑'}</Button>
    </Stack>
    {rows.map(row => {
      const pivot = canonicalPivot(row).price;
      return <Paper component="article" key={row.symbol} variant="outlined" data-testid="mobile-scan-row" sx={{px: 1, pb: 0.5, mb: 0.5, minWidth: 0}}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Button disabled={!isChartEnabled(row.symbol)} onClick={() => onOpenChart(row.symbol)} sx={{fontSize: 16, fontWeight: 700, minHeight: 44, px: 0.5, flexShrink: 0}} aria-label={`${row.symbol} の日次分析`}>{row.symbol} →</Button>
          <Typography title={row.company_name || row.symbol} noWrap sx={{fontSize: 12, color: 'text.secondary', minWidth: 0, flex: 1}}>{row.company_name || row.symbol}</Typography>
          <Typography sx={{fontSize: 14, fontWeight: 700, flexShrink: 0}}>{Number.isFinite(row.current_price) ? `$${value(row.current_price)}` : '未確認'}</Typography>
        </Stack>
        <Box component="dl" sx={{display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 1, rowGap: 0.25, m: 0, fontSize: 12, lineHeight: '20px', '& > div': {display: 'flex', justifyContent: 'space-between', gap: 0.5}, '& dt': {color: 'text.secondary'}, '& dd': {m: 0, fontWeight: 600, whiteSpace: 'nowrap'}}}>
          <div><dt>RS推計</dt><dd>{value(row.rs_rating, 0)}</dd></div><div><dt>共通ピボット</dt><dd>{Number.isFinite(pivot) ? `$${value(pivot)}` : '未確認'}</dd></div>
          <div><dt>出来高50日比</dt><dd>{Number.isFinite(row.se_volume_vs_50d) ? `${value(row.se_volume_vs_50d)}倍` : '未確認'}</dd></div><div><dt>準備条件</dt><dd>{row.se_setup_ready == null ? '未確認' : row.se_setup_ready ? '通過' : '未達'}</dd></div>
        </Box>
      </Paper>;
    })}
    {!rows.length && <Typography sx={{p: 2}}>該当銘柄なし。条件を変更してください。</Typography>}
    <Stack component="nav" aria-label="詳細スキャンのページ送り" direction="row" justifyContent="space-between" alignItems="center" sx={{'& button': {minHeight: 44, whiteSpace: 'nowrap'}}}>
      <Button disabled={page <= 1} onClick={() => onPage(page - 1)}>前へ</Button><Typography sx={{fontSize: 13}}>{total ? (page - 1) * perPage + 1 : 0}–{Math.min(page * perPage, total)} / {total.toLocaleString()}件</Typography><Button disabled={page * perPage >= total} onClick={() => onPage(page + 1)}>次へ</Button>
    </Stack>
  </section>;
}
