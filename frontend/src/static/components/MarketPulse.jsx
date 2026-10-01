import { Box, Button, Paper, Typography } from '@mui/material';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { breadthSummary } from '../breadthSummary';
import { finite } from '../researchEngine';
import './marketPulse.css';

const value = n => finite(n) ? n.toLocaleString('ja-JP').replace('-', '−') : '—';
export default function MarketPulse({ current, history, range, onRangeChange }) {
  const summary = breadthSummary(current);
  return <section className="breadth-pulse" aria-label="市場の広がりと推移">
    <Paper elevation={0} className={`breadth-pulse-summary market-tone-${summary.tone}`}>
      <div className="breadth-pulse-conclusion">
        <div><p className="breadth-pulse-eyebrow">直近10営業日の広がり</p><h2>{summary.title}</h2><p className="breadth-pulse-reference">{summary.ratio === null ? '10日レシオは未確認' : summary.ratio > 1 ? '基準1.00より上 · 上昇優勢' : summary.ratio < 1 ? '基準1.00より下 · 下落優勢' : '基準1.00 · 均衡'}</p></div>
        <div className="breadth-pulse-ratio" role="group" aria-label="10日上昇下落レシオ"><span>10日レシオ</span><strong>{summary.ratio === null ? '—' : summary.ratio.toFixed(2)}<small>倍</small></strong></div>
      </div>
      <div className="breadth-pulse-daily" role="group" aria-label="直近取引日の4%以上騰落銘柄数">
        <p className="breadth-pulse-eyebrow">直近1日 · {current.date || '日付未確認'} <span>4%以上の騰落</span></p>
        <dl>{[['上昇', summary.up, 'up'], ['下落', summary.down, 'down'], ['差し引き', summary.net, 'net']].map(([label, n, kind]) => <div key={kind} className={`breadth-pulse-count ${kind}`}><dt>{label}</dt><dd>{kind === 'net' && n > 0 ? '+' : ''}{kind === 'net' && n === 0 ? '±' : ''}{value(n)}<small>銘柄</small></dd></div>)}</dl>
        {summary.share !== null && <div className="breadth-pulse-balance" aria-hidden="true"><span style={{ width: `${summary.share * 100}%` }} /></div>}
      </div>
    </Paper>
    <Paper className="market-trend breadth-pulse-trend" elevation={0}>
      <div className="market-section-head"><div><Typography component="h2" sx={{ fontSize: 16, fontWeight: 700 }}>10日レシオの推移</Typography><Typography color="text.secondary" sx={{ fontSize: 12, mt: .5 }}>破線1.00 = 上昇・下落の均衡</Typography></div><div className="market-range" role="group" aria-label="市場環境の表示期間">{['1M', '3M'].map(r => <Button key={r} aria-pressed={range === r} onClick={() => onRangeChange(r)}>{r === '1M' ? '1か月' : '3か月'}</Button>)}</div></div>
      {!history.some(r => finite(r.ratio_10day)) ? <Typography sx={{ py: 5 }}>推移データが不足しています。</Typography> : <Box role="region" sx={{ width: '100%', height: { xs: 220, md: 270 }, minWidth: 0 }} aria-label="10日上昇下落レシオの推移">
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
    <details className="market-disclosure breadth-pulse-help"><summary>指標の読み方と注意点</summary><div><p>{summary.note}</p><p>10日レシオは、10営業日の「4%以上上昇した銘柄数」の合計 ÷「4%以上下落した銘柄数」の合計です。上の直近1日の銘柄数を割った値ではありません。</p><p>直近1日の帯は、4%以上動いた銘柄のうち上昇・下落それぞれが占める割合です。市場全体の騰落数とは異なります。差し引きは上昇銘柄数 − 下落銘柄数です。</p><p>ブレッドスの独自要約です。指数トレンド・分配日・決算を含む総合的な買い判定ではありません。</p></div></details>
  </section>;
}
