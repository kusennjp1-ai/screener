import { useMemo, useState } from 'react';
import { Alert, Box, Button, TextField, Typography } from '@mui/material';
import { parseTradeReturns, tradeEvidence, reviewPosition } from '../bookRiskPolicy';
const show = (n, unit = '') => typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(2)}${unit}` : '未確認';
const empty = { entry: '', current: '', peak: '', initialStop: '', currentStop: '', shares: '' };
export default function BookRiskWorkbench() {
  const [history, setHistory] = useState('');
  const [fields, setFields] = useState(empty);
  const stats = useMemo(() => { try { return { data: tradeEvidence(parseTradeReturns(history)) }; } catch (e) { return { error: e.message }; } }, [history]);
  const complete = Object.values(fields).every(v => v.trim() !== '');
  const position = complete && stats.data ? reviewPosition(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, Number(v)])), stats.data) : null;
  return <Box component="section" aria-label="実績と逆指値の検証" sx={{ mt: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
    <Typography component="h3" variant="h6">実績と逆指値を検証する</Typography>
    <Typography sx={{ fontSize: 13, my: 1 }}>2冊の損失管理・利益保護の考え方を使う計算欄です。入力は自己申告のシナリオで、この画面内のみ保持します。口座連携・発注・配分への自動反映は行いません。</Typography>
    <TextField fullWidth multiline minRows={2} label="決済済み取引の損益率（古い順・%）" placeholder="例：-3, 8, -2, 10" value={history} onChange={e => setHistory(e.target.value)} helperText="手数料を含めた同じ基準で入力。0%も1取引として集計。例の数値は自動入力しません。" />
    {stats.error ? <Alert severity="error">{stats.error}</Alert> : <>
      <div className="decision-totals"><span>件数 <strong>{stats.data.count}</strong></span><span>勝率 <strong>{show(stats.data.winRate === null ? null : stats.data.winRate * 100, '%')}</strong></span><span>平均利益 <strong>{show(stats.data.averageWin, '%')}</strong></span><span>平均損失 <strong>{show(stats.data.averageLoss, '%')}</strong></span><span>1取引の平均損益 <strong>{show(stats.data.expectancy, '%')}</strong></span></div>
      <Typography sx={{ my: 1 }}>判定：{stats.data.phase} ／ 初期損切り幅の目安上限：{show(stats.data.stopCeilingPct, '%')}</Typography>
      <Typography sx={{ my: 1 }}>実績の平均利益／平均損失：{show(stats.data.payoffRatio, '倍')} ／ 2倍目安：{stats.data.payoffState === 'pass' ? '充足' : stats.data.payoffState === 'fail' ? '未充足' : '未確認（利益・損失の両実績が必要）'}</Typography>
      <Typography sx={{ fontSize: 12, mb: 1 }}>連敗後の縮小を、損益ゼロや1回の勝ちでは解除しません。3連勝かつ全入力の平均損益が正になるまで縮小を維持する独自の代理ルールです。書籍指定の固定回数ではありません。</Typography>
      <Typography sx={{ fontSize: 12, mb: 2 }}>平均利益の半分・最大10%を目安に検証します。10%は通常の損切り幅ではありません。損益率の単純平均は口座の利益率・ドローダウン・将来予測ではありません。少数の勝ちだけで優位性は証明できません。</Typography>
      <div className="risk-input-grid">{[['entry','買値 $'],['current','現在値 $'],['peak','購入後の最高値 $'],['initialStop','初期逆指値 $'],['currentStop','現在の逆指値 $'],['shares','保有株数']].map(([key, label]) => <TextField key={key} label={label} value={fields[key]} inputProps={{ inputMode: key === 'shares' ? 'numeric' : 'decimal' }} onChange={e => setFields(v => ({ ...v, [key]: e.target.value }))} size="small" />)}</div>
      {position && <Box sx={{ mt: 2 }}>
        {!position.valid ? <Alert severity="error">{position.errors.join(' / ')}</Alert> : <>
          <Typography>含み損益 {show(position.gainPct, '%')} ／ 初期リスク比 {show(position.multiple, 'R')} ／ 株数上限の計算例 {position.maxShares}株</Typography>
          <Typography sx={{ fontSize: 12 }}>10万ドルモデル・1取引損失予算{show(stats.data.riskPerTrade * 100, '%')}、1銘柄上限{stats.data.defensive ? '5' : '10'}%という独自設定です。連敗時には両方を縮小します。</Typography>
          {position.errors.map(e => <Alert key={e} severity="warning" sx={{ mt: 1 }}>{e}</Alert>)}
          {position.triggered && <Alert severity="error" sx={{ mt: 1 }}>現在値が設定済み逆指値以下です。約定・ギャップ・未執行を確認してください。</Alert>}
          {position.averagingDown && <Alert severity="warning" sx={{ mt: 1 }}>買値を下回っています。損失を取り戻すための買い増しを計画しません。</Alert>}
          {(position.book1ProtectionReview || position.protectionReview || position.breakevenRequired) && <Alert severity="info" sx={{ mt: 1 }}>購入後高値で利益保護の確認水準に到達。逆指値を下げず、少なくとも${show(position.stopFloor)}を確認してください。現在値がこの水準以下なら執行状況の確認が先です。約定や損失ゼロを保証するものではありません。</Alert>}
          {!position.errors.length && <Typography sx={{ fontSize: 13, mt: 1 }}>入力範囲の数値制約に矛盾はありません。ベース・決算・流動性・価格の正確性や売買の適否を認定するものではありません。</Typography>}
        </>}
      </Box>}
    </>}
    <Button size="small" onClick={() => { setHistory(''); setFields(empty); }}>計算欄をクリア</Button>
  </Box>;
}
