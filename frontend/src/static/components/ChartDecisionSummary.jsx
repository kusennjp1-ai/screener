import { Box, Typography } from '@mui/material';
import { entryPlan } from '../researchEngine';
import { entryReadiness } from '../entryReadiness';
import { modelMarket } from '../portfolioPlan';

const money = value => Number.isFinite(value) ? `$${value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` : '未確認';
export default function ChartDecisionSummary({row, date, market, method = 'minervini', quote = null, now = Date.now()}) {
  if (!row) return null;
  const plan = entryPlan(row, quote, method);
  const readiness = entryReadiness(row, date, market || modelMarket([row]), now);
  const missing = readiness.rules.filter(rule => rule.state !== 'pass').slice(0,3);
  return <Box aria-label="チャートの判断要約" sx={{px:2,py:1.5,borderBottom:1,borderColor:'divider'}}>
    <Box sx={{display:'flex',flexWrap:'wrap',gap:'8px 24px',fontSize:14,fontVariantNumeric:'tabular-nums'}}>
      <strong>{row.symbol} · {money(plan.price)}</strong>
      <span>{plan.state}（価格位置）</span>
      <span>共通ピボット <strong>{money(plan.pivot)}</strong></span>
      <span>買い上限 <strong>{money(plan.upper)}</strong> {plan.zone ? `（${plan.zone}%）` : ''}</span>
    </Box>
    <Typography sx={{fontSize:12,color:'text.secondary',mt:.5}}>価格時点：{quote?.as_of ? new Date(quote.as_of).toLocaleString('ja-JP') : `${date || '未確認'} 日次終値`} · 購入条件は日次検証</Typography>
    {row.setup_recalculation && <Typography sx={{fontSize:12,color:'text.secondary',mt:.5}}>{row.setup_recalculation.status==='calculated' ? '検証済み日足でセットアップを再計算済み' : 'セットアップ再計算不可・旧水準は無効'}{row.setup_recalculation.status==='calculated' && !plan.pivot ? ' · 現在有効なピボットなし' : ''}</Typography>}
    {missing.length ? <Box sx={{mt:1,fontSize:13}}><span>未達・未確認：{missing.map(rule=>rule.label).join(' ／ ')}</span><Box component="details" sx={{mt:.5}}><summary style={{cursor:'pointer'}}>理由を確認</summary><ul style={{paddingLeft:20}}>{missing.map(rule=><li key={rule.id}><strong>{rule.label}</strong>：{rule.detail}</li>)}</ul></Box></Box> : <Typography sx={{fontSize:13,mt:1}}>日次の購入条件を確認済み。発注時は現在価格と約定条件を確認。</Typography>}
  </Box>;
}
