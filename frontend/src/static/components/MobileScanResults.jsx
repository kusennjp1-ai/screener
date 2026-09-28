import { canonicalPivot } from '../researchPresentation';
import { Box, Button, MenuItem, Paper, Select, Stack, Typography } from '@mui/material';
const value=(n,digits=2)=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';
export default function MobileScanResults({rows,total,page,perPage,sortBy,sortOrder,onSort,onPage,onOpenChart,isChartEnabled}) {
  return <section aria-label="詳細スキャンの銘柄一覧">
    <Stack direction="row" alignItems="center" spacing={1} sx={{my:1}}>
      <Select size="small" inputProps={{'aria-label':'詳細スキャンの並び順'}} value={sortBy} onChange={e=>onSort(e.target.value,sortOrder)} sx={{minHeight:44,flex:1}}>
        {!['composite_score','se_setup_score','rs_rating','current_price','adv_usd'].includes(sortBy) && <MenuItem value={sortBy}>表で選んだ項目</MenuItem>}<MenuItem value="composite_score">補助スコア</MenuItem><MenuItem value="se_setup_score">セットアップ点</MenuItem><MenuItem value="rs_rating">RS推計</MenuItem><MenuItem value="current_price">株価</MenuItem><MenuItem value="adv_usd">平均売買代金</MenuItem>
      </Select><Button onClick={()=>onSort(sortBy,sortOrder==='desc'?'asc':'desc')}>{sortOrder==='desc'?'高い順 ↓':'低い順 ↑'}</Button>
    </Stack>
    {rows.map(row=><Paper key={row.symbol} variant="outlined" sx={{p:1.5,mb:1}}>
      <Stack direction="row" justifyContent="space-between" alignItems="center"><Button disabled={!isChartEnabled(row.symbol)} onClick={()=>onOpenChart(row.symbol)} sx={{fontSize:18,fontWeight:700,minHeight:44}} aria-label={`${row.symbol} の日次分析`}>{row.symbol} →</Button><Typography fontWeight={700}>{Number.isFinite(row.current_price)?`$${value(row.current_price)}`:'未確認'}</Typography></Stack>
      <Typography sx={{fontSize:13,color:'text.secondary',mb:1}}>{row.company_name || row.symbol}</Typography>
      <Box component="dl" sx={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1,m:0,fontSize:13,'& dd':{m:0,fontWeight:600}}}>
        <div><dt>RS推計</dt><dd>{value(row.rs_rating,0)}</dd></div><div><dt>共通ピボット</dt><dd>{Number.isFinite(canonicalPivot(row).price)?`$${value(canonicalPivot(row).price)}`:'未確認'}</dd></div>
        <div><dt>出来高50日平均比</dt><dd>{Number.isFinite(row.se_volume_vs_50d)?`${value(row.se_volume_vs_50d)}倍`:'未確認'}</dd></div><div><dt>準備条件</dt><dd>{row.se_setup_ready==null?'未確認':row.se_setup_ready?'通過':'未達'}</dd></div>
      </Box>
    </Paper>)}
    {!rows.length && <Typography sx={{p:2}}>該当銘柄なし。条件を変更してください。</Typography>}
    <Stack direction="row" justifyContent="space-between" alignItems="center"><Button disabled={page<=1} onClick={()=>onPage(page-1)}>前へ</Button><span>{total?((page-1)*perPage+1):0}–{Math.min(page*perPage,total)} / {total.toLocaleString()}</span><Button disabled={page*perPage>=total} onClick={()=>onPage(page+1)}>次へ</Button></Stack>
  </section>;
}
