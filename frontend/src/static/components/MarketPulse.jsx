import { Box, Button, Paper, Typography } from '@mui/material';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { breadthSummary } from '../breadthSummary';
import { finite } from '../researchEngine';

const value = n => finite(n) ? n.toLocaleString('ja-JP') : '—';
export default function MarketPulse({ current, history, range, onRangeChange }) {
  const summary = breadthSummary(current);
  return <>
    <Paper elevation={0} className={`market-hero market-tone-${summary.tone}`}>
      <div className="market-hero-copy"><div className="research-kicker">MARKET PULSE / 市場の広がり</div>
        <Typography component="h2" sx={{ fontWeight: 700, fontSize: { xs: 26, md: 34 }, letterSpacing: '-.04em', my: 1.5 }}>{summary.title}</Typography>
        <Typography color="text.secondary" sx={{ lineHeight: 1.9, maxWidth: 620 }}>{summary.note}</Typography>
        <div className="market-context-note">ブレッドスの独自要約です。指数トレンド・分配日・決算を含む総合的な買い判定ではありません。</div>
      </div>
      <div className="market-ratio"><small>10日 上昇 / 下落レシオ</small><strong>{summary.ratio === null ? '—' : summary.ratio.toFixed(2)}<span>倍</span></strong><span className="market-status">{summary.ratio === null ? '未確認' : summary.ratio > 1 ? '1.00より上 / 上昇優勢' : summary.ratio < 1 ? '1.00より下 / 下落優勢' : '1.00 / 均衡'}</span></div>
    </Paper>
    <Typography component="h2" sx={{ fontSize: 13, mt: 3, mb: -1, color: 'text.secondary' }}>直近取引日の騰落 / {current.date || '日付未確認'}</Typography>
    <div className="market-stat-grid">
      {[['4%以上 上昇', summary.up, 'up', '大きく上昇した銘柄'], ['4%以上 下落', summary.down, 'down', '大きく下落した銘柄'], ['差し引き', summary.net, 'net', '上昇銘柄数 − 下落銘柄数']].map(([label, n, kind, description]) => <Paper key={kind} elevation={0} className={`market-stat ${kind}`}><span>{label}</span><strong>{kind === 'net' && n > 0 ? '+' : ''}{value(n)}<small>銘柄</small></strong><small>{description}</small></Paper>)}
    </div>
    <Paper className="market-trend" elevation={0}>
      <div className="market-section-head"><div><Typography component="h2" variant="h6" fontWeight={700}>広がりの変化</Typography><Typography color="text.secondary" sx={{ fontSize: 13, mt: .5 }}>10日レシオの推移。1.00を境に上昇・下落の優勢を比較。</Typography></div><div className="market-range" role="group" aria-label="市場環境の表示期間">{['1M', '3M'].map(r => <Button key={r} aria-pressed={range === r} onClick={() => onRangeChange(r)}>{r === '1M' ? '1か月' : '3か月'}</Button>)}</div></div>
      {!history.some(r => finite(r.ratio_10day)) ? <Typography sx={{ py: 5 }}>推移データが不足しています。</Typography> : <Box sx={{ width: '100%', height: { xs: 230, md: 280 }, minWidth: 0 }} aria-label="10日上昇下落レシオの推移">
        <ResponsiveContainer width="100%" height="100%"><AreaChart data={history.map(r => ({ ...r, ratio_10day: finite(r.ratio_10day) && r.ratio_10day >= 0 ? r.ratio_10day : null }))} margin={{ top: 20, right: 12, left: -20, bottom: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={.08} />
          <XAxis dataKey="date" tickFormatter={d => d.slice(5)} minTickGap={32} tick={{ fill: 'currentColor', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 'auto']} tick={{ fill: 'currentColor', fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip formatter={n => [finite(n) ? n.toFixed(2) + '倍' : '未確認', '10日レシオ']} contentStyle={{ background: 'var(--market-card)', color: 'var(--market-ink)', border: '1px solid var(--line)', borderRadius: 12 }} />
          <ReferenceLine y={1} stroke="var(--accent)" strokeDasharray="4 4" />
          <Area type="linear" dataKey="ratio_10day" stroke="var(--accent)" fill="var(--accent)" fillOpacity={.10} strokeWidth={2.5} connectNulls={false} isAnimationActive={false} />
        </AreaChart></ResponsiveContainer>
      </Box>}
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>対象期間：{history[0]?.date || '—'} → {history.at(-1)?.date || '—'} ／ {history.length}営業日</Typography>
    </Paper>
  </>;
}
