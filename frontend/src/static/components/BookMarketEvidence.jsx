import { Alert, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BOOK_MARKET_VERSION } from '../bookMarketEvidence';
const n = (v, digits = 0) => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('ja-JP', { maximumFractionDigits: digits }) : '未確認';
const pct = v => typeof v === 'number' && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '未確認';
const flag = v => v === true ? '該当' : v === false ? '非該当' : '未確認';

export default function BookMarketEvidence({ evidence, expectedDate }) {
  const d = evidence;
  if (!d || d.version !== BOOK_MARKET_VERSION || (expectedDate && d.as_of_date !== expectedDate) || !d.latest) {
    return <Alert severity="info" sx={{ mt: 3 }}>書籍に基づく市場の内訳は未取得、または分析日が一致しません。</Alert>;
  }
  const c = d.latest, index = c.benchmark, cohort = c.cohort;
  const events = d.breakoutEvents?.slice(-20) || [];
  return <Paper component="section" aria-label="書籍の市場観測" elevation={0} sx={{ mt: 3, p: { xs: 2, md: 3 }, borderRadius: 3 }}>
    <Typography component="h2" variant="h6" fontWeight={700}>先導株と市場の内訳</Typography>
    <Typography color="text.secondary" sx={{ fontSize: 13, mt: 1 }}>分析日 {c.date} ／ 日足を確認できた {n(c.coverage)} / {n(c.expectedUniverseSize)}銘柄（{n(c.coveragePct, 1)}%）。公開チャート集合の観測で、市場全体や当時の全銘柄を再現した統計ではありません。</Typography>
    {!d.currentSnapshotComplete && <Alert severity="warning" sx={{ mt: 1 }}>最新の分析日に必要なチャートが揃っていません。表示は {c.date} 時点です。</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, my: 3 }}>
      {[
        ['52週高値更新', n(c.newHighs)], ['52週安値更新', n(c.newLows)],
        ['当日の先導候補', n(c.leaderCount)], ['固定窓セットアップ候補', n(c.setupProxyCount)],
      ].map(([label, value]) => <Box key={label}><Typography color="text.secondary" sx={{ fontSize: 12 }}>{label}</Typography><Typography sx={{ fontSize: 26, fontWeight: 700 }}>{value}</Typography></Box>)}
    </Box>
    <Typography component="h3" sx={{ fontWeight: 700, mb: 1 }}>高値・安値更新の広がり</Typography>
    <Box sx={{ height: 220, minWidth: 0, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%"><LineChart data={d.series} accessibilityLayer margin={{ top: 10, right: 12, bottom: 0, left: -20 }}>
        <CartesianGrid vertical={false} stroke="currentColor" opacity={.08} />
        <XAxis dataKey="date" tickFormatter={v => v.slice(5)} minTickGap={30} />
        <YAxis allowDecimals={false} /><Tooltip /><Legend />
        <Line dataKey="newHighs" name="52週高値更新" stroke="#48b89e" dot={false} isAnimationActive={false} connectNulls={false} />
        <Line dataKey="newLows" name="52週安値更新" stroke="#db738c" dot={false} isAnimationActive={false} connectNulls={false} />
      </LineChart></ResponsiveContainer>
    </Box>
    <Typography component="h3" sx={{ fontWeight: 700, mt: 3 }}>出来高と指数</Typography>
    <Typography sx={{ fontSize: 13, mt: 1 }}>個別株の上昇日出来高 {n(c.upVolume)}株 ／ 下落日 {n(c.downVolume)}株。終値換算では上昇側 ${n(c.upDollarVolume)} ／ 下落側 ${n(c.downDollarVolume)}。株数とドル換算を混同しません。</Typography>
    {!index ? <Alert severity="info" sx={{ mt: 1 }}>同日の指数OHLCVが不足し、指数の価格・出来高関係は未確認です。</Alert> : <>
      <Typography sx={{ fontSize: 13, mt: 1 }}>{index.symbol} 前日比 {pct(index.dailyChangePct)} ／ 出来高は前日の {n(index.volumeRatio, 2)}倍</Typography>
      <Typography sx={{ fontSize: 13 }}>上昇・増商い {flag(index.upOnHigherVolume)} ／ 下落・減商い {flag(index.downOnLowerVolume)} ／ 下落・増商い {flag(index.downOnHigherVolume)}</Typography>
      <Typography sx={{ fontSize: 13, mt: 1 }}>指数20営業日比 {pct(index.return20)}。指数が下落する期間に上昇した当日の先導候補：{n(c.leadersPositiveWhileIndexNegative)}銘柄</Typography>
    </>}
    <Typography component="h3" sx={{ fontWeight: 700, mt: 3 }}>以前の先導候補を追跡</Typography>
    {!cohort ? <Typography sx={{ fontSize: 13 }}>同日のRS比較母集団100銘柄以上が必要です。</Typography> : <>
      <Typography sx={{ fontSize: 13, mt: 1 }}>{cohort.selectedAt} に選んだ {cohort.size}銘柄を固定して追跡。観測 {cohort.observed}、欠測 {cohort.missing}。現在の候補を過去の先導株として扱いません。</Typography>
      <Typography sx={{ fontSize: 13 }}>50日線割れ {n(cohort.below50)} ／ 先導条件から外れた銘柄 {n(cohort.lostLeaderStatus)}。観測できた構成銘柄の平均騰落 {pct(cohort.meanReturnPct)} ／ 指数 {pct(cohort.indexReturnPct)}</Typography>
    </>}
    <details style={{ marginTop: 20 }}><summary>候補数とカバレッジの推移</summary>
      <TableContainer sx={{ maxHeight: 330 }}><Table size="small" aria-label="市場観測の履歴"><TableHead><TableRow>{['日付', '観測数', '先導候補', '形状代理', '上放れ代理'].map(h => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead><TableBody>{[...d.series].reverse().map(r => <TableRow key={r.date}><TableCell sx={{ whiteSpace: 'nowrap' }}>{r.date}</TableCell><TableCell>{n(r.coverage)}</TableCell><TableCell>{n(r.leaderCount)}</TableCell><TableCell>{n(r.setupProxyCount)}</TableCell><TableCell>{n(r.breakoutProxyCount)}</TableCell></TableRow>)}</TableBody></Table></TableContainer>
    </details>
    <details style={{ marginTop: 16 }}><summary>上放れ代理条件の発生日（直近20件・発生順）</summary>
      <Typography sx={{ fontSize: 12, my: 1 }}>実際のVCP完成・初回ブレイクや購入可能銘柄の認定ではありません。同じ銘柄が複数日に現れる場合があります。</Typography>
      {!events.length ? <Typography sx={{ fontSize: 13 }}>この期間に代理条件を満たした発生記録はありません。</Typography> : <TableContainer><Table size="small" aria-label="上放れ代理条件の発生履歴"><TableHead><TableRow>{['日付', '銘柄', '終値', '代理ピボット', '出来高比'].map(h => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead><TableBody>{events.map(r => <TableRow key={`${r.date}-${r.symbol}`}><TableCell sx={{ whiteSpace: 'nowrap' }}>{r.date}</TableCell><TableCell>{r.symbol}</TableCell><TableCell>{n(r.close, 2)}</TableCell><TableCell>{n(r.pivotProxy, 2)}</TableCell><TableCell>{n(r.volumeRatio, 2)}</TableCell></TableRow>)}</TableBody></Table></TableContainer>}
    </details>
    <details style={{ marginTop: 16 }}><summary>計算方法と未確認事項</summary><ul>{Object.values(d.methods || {}).map(s => <li key={s}>{s}</li>)}{(d.unknowns || []).map(s => <li key={s}>{s}</li>)}</ul>
      <Typography sx={{ fontSize: 12 }}>現在公開されている集合には生存者・選択バイアスがあります。日々の観測銘柄数も変わります。候補数の増減だけで買い判断を出しません。</Typography>
    </details>
  </Paper>;
}
