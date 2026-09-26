import { useState } from 'react';
import { Alert, Box, MenuItem, TextField, Typography } from '@mui/material';
import { partialSalePlan } from '../partialSalePlan';
const money = n => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export default function PartialSalePlan({ state }) {
  const [input, setInput] = useState({ symbol: '', shares: '', price: '', fees: '0', remainingStop: '', stopFees: '0' });
  const holding = state.holdings.find(p => p.symbol === input.symbol);
  const result = holding && input.shares && input.price ? partialSalePlan(holding, Object.fromEntries(Object.entries(input).map(([k,v]) => [k, Number(v)]))) : null;
  return <details style={{ marginTop: 16 }}><summary>部分売却前に残株の保護を試算</summary>
    <Typography sx={{ fontSize: 12, my: 1 }}>売却比率は自分で決めます。平均利益の2倍・3Rなどの到達後に一部利益を残す考え方の検算です。損切り条件に達したときの売却を先延ばしする機能ではありません。日誌への記録・発注は行いません。</Typography>
    {!state.holdings.length ? <Typography>保有記録を追加すると、残株を含む損益を試算できます。</Typography> : <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
      <TextField select size="small" label="部分売却を試算する銘柄" value={input.symbol} onChange={e => setInput(v => ({ ...v, symbol: e.target.value, shares: '', price: '', remainingStop: '' }))}>{state.holdings.map(p => <MenuItem key={p.symbol} value={p.symbol}>{p.symbol}（{p.shares}株）</MenuItem>)}</TextField>
      {[['shares','試算する売却株数'],['price','想定売却価格 $'],['fees','売却時手数料 $'],['remainingStop','残株の逆指値案 $'],['stopFees','残株売却時の手数料 $']].map(([key,label]) => <TextField key={key} size="small" label={label} value={input[key]} onChange={e => setInput(v => ({ ...v, [key]: e.target.value }))} />)}
    </Box>}
    {result && (result.valid ? <Box sx={{ mt: 1 }}><Typography>売却後の残株 {result.remainingShares}株 ／ 売却分の想定実現損益 {money(result.realizedOnSale)} ／ 現金増加 {money(result.netProceeds)}</Typography><Typography>残株が指定逆指値で売れた場合の合計損益 {money(result.combinedPnLAtStop)}。今回売る分と残株の現在の取得原価に対する計算です。</Typography>{result.stopAlreadyBreached && <Alert severity="warning">想定価格は記録済み逆指値以下です。残株の維持より先に、停止注文の約定と残高を確認してください。</Alert>}<Typography sx={{ fontSize: 12 }}>手数料は入力値、税・為替・ギャップ・滑りは未反映です。逆指値での約定や利益を保証しません。</Typography></Box> : <Alert severity="info" sx={{ mt: 1 }}>{result.error}</Alert>)}
  </details>;
}
