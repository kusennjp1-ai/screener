import { useMemo, useState } from 'react';
import { Button, Paper, Typography } from '@mui/material';
import PortfolioPlanDrawer from './PortfolioPlanDrawer';
import { buildPortfolioPlan, preparePortfolioRows } from '../portfolioPlan';
import { presentPortfolio } from '../portfolioPresentation';

// A precomputed plan and a custom trigger let the home hero reuse the exact same
// presentation without duplicating allocation or readiness calculations.
export default function PortfolioDecision({ rows = [], date, now, plan: suppliedPlan, prepared: suppliedPrepared, compact = false, renderTrigger, onInspect, onBrowse }) {
  const prepared = useMemo(() => suppliedPlan ? null : suppliedPrepared || preparePortfolioRows(rows), [rows, suppliedPlan, suppliedPrepared]);
  const plan = useMemo(() => suppliedPlan || buildPortfolioPlan(rows, date, 100000, now, prepared), [rows, date, now, prepared, suppliedPlan]);
  const presentation = useMemo(() => presentPortfolio(plan), [plan]);
  const [open, setOpen] = useState(false);
  const triggerProps = {
    plan, presentation, openPlan: () => setOpen(true),
    label: presentation.conditional.length ? `条件付きの配分 ${presentation.conditional.length}銘柄・未達あり` : `配分の試算 ${presentation.daily.length}銘柄`,
  };
  const trigger = renderTrigger ? renderTrigger(triggerProps) : <Button variant="outlined" onClick={triggerProps.openPlan} aria-haspopup="dialog" sx={{ minHeight: 44 }}>{triggerProps.label}</Button>;
  const drawer = <PortfolioPlanDrawer plan={plan} open={open} onClose={() => setOpen(false)} onInspect={onInspect} />;
  if (compact) return <>{trigger}{drawer}</>;
  return <Paper component="section" id="today-decision" tabIndex={-1} aria-label="本日の判断と10万ドルの配分" className="decision-panel" elevation={0}>
    <div className="decision-status-bar"><div><span className="research-kicker">今日の判断</span><Typography component="h2" sx={{ fontSize: 16, fontWeight: 700 }}>{plan.decision}</Typography><Typography sx={{ fontSize: 12, color: 'text.secondary' }}>新規資金モデル · 株式0% / 現金100% · {plan.market.label}</Typography></div>{onBrowse && <Button variant="contained" onClick={onBrowse}>候補を確認する →</Button>}</div>
    <div className="decision-actions">{trigger}</div>
    {drawer}
  </Paper>;
}
