import { instrumentApplicability, instrumentApplicabilityLabel } from '../instrumentApplicability';
import { Box, Typography } from '@mui/material';
import { entryPlan } from '../researchEngine';
import { entryReadiness } from '../entryReadiness';
import { modelMarket } from '../portfolioPlan';
import EntrySourceNote, { EntrySourceDetails } from './EntrySourceNote';

const money = value => Number.isFinite(value) ? `$${value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}` : '未確認';
export default function ChartDecisionSummary({row, date, market, method = 'minervini', quote = null, now = Date.now()}) {
  if (!row) return null;
  const applicabilityLabel = instrumentApplicabilityLabel(instrumentApplicability(row));
  const plan = entryPlan(row, quote, method);
  const readiness = entryReadiness(row, date, market || modelMarket([row]), now, method);
  const missing = readiness.rules.filter(rule => rule.state !== 'pass').slice(0,3);
  return <Box aria-label="チャートの判断要約" sx={{px:2,py:.75,borderBottom:1,borderColor:'divider'}}>
    <Box sx={{display:'flex',flexWrap:'wrap',gap:'8px 24px',fontSize:14,fontVariantNumeric:'tabular-nums'}}>
      <strong>{row.symbol} · {money(plan.price)}</strong>
      <span>{plan.state}{['買いゾーン内','ピボット待ち','買いゾーン超過'].includes(plan.state) ? '（価格位置）' : ''}</span>
      <span>共通ピボット <strong>{money(plan.pivot)}</strong></span>
      <span>アプリ買い上限 <strong>{money(plan.upper)}</strong> {plan.zone ? `（${plan.zone}%）` : ''}</span>
    </Box>
    <Box sx={{display:'flex',flexWrap:'wrap',alignItems:'baseline',gap:'4px 24px',mt:.5}}>
      <Typography sx={{fontSize:12,color:'text.secondary'}}>価格時点：{quote?.as_of ? new Date(quote.as_of).toLocaleString('ja-JP') : `${date || '未確認'} 日次終値`} · 購入条件は日次検証</Typography>
      <Typography sx={{fontSize:13}}>{applicabilityLabel || (missing.length ? `未達・未確認：${missing.map(rule=>rule.label).join(' ／ ')}` : '日次の購入条件を確認済み。発注時は現在価格と約定条件を確認。')}</Typography>
    </Box>
    {!plan.pivot && <Typography sx={{fontSize:12,mt:.5}}>{plan.pivotSource}</Typography>}
    <EntrySourceNote plan={plan} showDetails={false}/>
    <Box component="details" className="chart-decision-details" sx={{fontSize:13}}>
      <summary style={{cursor:'pointer',minHeight:44,lineHeight:'24px',padding:'10px 0',boxSizing:'border-box'}}>根拠と注意点（書籍・水準・未達条件）</summary>
      <Typography sx={{fontSize:12,fontWeight:600}}>アプリ設定と書籍の確認範囲</Typography>
      <EntrySourceDetails plan={plan}/>
      {Number.isFinite(plan.stopExample) && <Typography sx={{fontSize:12,color:'text.secondary',mt:.5}}>参考：表示価格の−7% {money(plan.stopExample)}（損切りの計算例）</Typography>}
      {row.setup_recalculation && <Typography sx={{fontSize:12,color:'text.secondary',mt:.5}}>{row.setup_recalculation.status==='calculated' ? '検証済み日足でセットアップを再計算済み' : 'セットアップ再計算不可・旧水準は無効'}{row.setup_recalculation.status==='calculated' && !plan.pivot ? ' · 現在有効なピボットなし' : ''}</Typography>}
      {missing.length>0 && <ul style={{paddingLeft:20}}>{missing.map(rule=><li key={rule.id}><strong>{rule.label}</strong>：{rule.detail}</li>)}</ul>}
    </Box>
  </Box>;
}
