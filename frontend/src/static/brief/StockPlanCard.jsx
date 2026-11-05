import { useMemo, useState } from 'react';
import { Expander } from './BriefParts';
import { positionPlan, STOP_DEFAULT_PERCENT, STOP_MAX_PERCENT } from './positionSizing';

const finite = Number.isFinite;
const price = value => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const PLAN_KEY = 'brief-plan';
const readPlan = () => { try { const v = JSON.parse(localStorage.getItem(PLAN_KEY) || '{}'); return { stopPercent: finite(v.stopPercent) ? v.stopPercent : STOP_DEFAULT_PERCENT, account: finite(v.account) ? v.account : 50000, riskPercent: finite(v.riskPercent) ? v.riskPercent : 1.25 }; } catch { return { stopPercent: STOP_DEFAULT_PERCENT, account: 50000, riskPercent: 1.25 }; } };
/** Phone: a secondary block folded into one line that opens in place. Desktop shows it as before. */
const Fold = ({ wide, id, summary, children }) => wide ? children : <Expander id={id} summary={summary}>{children}</Expander>;

/**
 * The stock's position plan and its inputs, kept per viewer in localStorage (a convenience only).
 * Returns { plan, settings, update, moveStop }: `update(key, value)` changes one input and, for the
 * stop, moves the chart's stop line through `chartRef`; `moveStop(price)` moves that line. Also
 * receives template, market, technical and certified (step 0: not read yet).
 */
// eslint-disable-next-line react-refresh/only-export-components -- the plan's hook lives beside its card (one owner)
export function usePositionPlan({ view, chartRef }) {
  const [settings, setSettings] = useState(readPlan);
  const plan = useMemo(() => view ? positionPlan(view, settings) : null, [view, settings]);
  const moveStop = stop => chartRef?.current?.moveStop(stop);
  const update = (key, value) => {
    if (!finite(value)) return;
    const next = { ...settings, [key]: key === 'stopPercent' ? Math.min(STOP_MAX_PERCENT - 0.5, Math.max(1, value)) : Math.max(0, value) };
    setSettings(next);
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
    if (key === 'stopPercent') { const nextPlan = positionPlan(view, next); if (nextPlan) moveStop(nextPlan.stop); }
  };
  return { plan, settings, update, moveStop };
}

/** The plan card: the inputs (folded on a phone), the shares, the cost, the stop, the R bar and the rules. */
export default function PlanCard({ view, plan, settings, onChange, earnings, wide }) {
  if (!plan) return null;
  const input = (key, label, step, extra = {}) => <label>{label}<input type="number" inputMode="decimal" step={step} value={settings[key]} onChange={e => onChange(key, Number(e.target.value))} {...extra} /></label>;
  return <section className="brief-card brief-plan in" style={{ '--i': 7 }} aria-labelledby="brief-plan-title">
    <h2 id="brief-plan-title">建て玉と損切りの計画</h2>
    <Fold wide={wide} id="stock-plan-inputs" summary={<>条件<small>口座 ${finite(settings.account) ? settings.account.toLocaleString('en-US') : '—'}・リスク {settings.riskPercent}%・損切り {plan.stopPercent.toFixed(1)}%</small></>}>
      <div className="brief-inputs">{input('account', '口座資金（$）', 1000, { min: 0 })}{input('riskPercent', '1回のリスク（%）', 0.25, { min: 0.1, max: 5 })}{input('stopPercent', '損切り幅（%）', 0.5, { min: 1, max: STOP_MAX_PERCENT - 0.5 })}</div>
      <label className="brief-range"><span className="sr-only">損切り幅（%）</span><input type="range" min="3" max={STOP_MAX_PERCENT - 0.5} step="0.5" value={settings.stopPercent} onChange={e => onChange('stopPercent', Number(e.target.value))} aria-label="損切り幅（%）" /><span aria-hidden="true">損切り幅 <b className="numeric">{plan.stopPercent.toFixed(1)}%</b>（10%未満）</span></label>
    </Fold>
    <div className="brief-kgrid">
      <div><small>株数</small><b className="numeric" data-testid="brief-shares">{finite(plan.shares) ? plan.shares.toLocaleString('en-US') : '—'}</b><em>リスク {finite(plan.riskDollars) ? `$${Math.round(plan.riskDollars).toLocaleString('en-US')}` : '—'}</em></div>
      <div><small>投資額</small><b className="numeric">{finite(plan.cost) ? `$${Math.round(plan.cost).toLocaleString('en-US')}` : '—'}</b><em>口座の {finite(plan.weight) ? plan.weight.toFixed(1) : '—'}%</em></div>
      <div><small>損切り</small><b className="numeric">{price(plan.stop)}</b><em>買値 {price(plan.entry)}</em></div>
    </div>
    <div className="brief-rbar" aria-hidden="true"><i className="r-risk">−1R</i><i className="r-2">+2R {price(plan.r2)}</i><i className="r-3">+3R</i></div>
    <Fold wide={wide} id="stock-plan-rules" summary="損切りと利益確保のルール（4項目）"><ul className="brief-rules">
      <li><span>損切りの位置は買う前に決め、その価格に来たら例外なく手仕舞う。</span></li>
      <li><span>損失は最大でも10%未満に抑え、平均の損失はそれより小さく保つ。</span></li>
      <li><span>株価が +2R（{price(plan.r2)}）まで進んだら、損切りを買値まで引き上げて利益を守る。</span></li>
      <li><span>{earnings ? `決算をまたいで持つかどうかは、発表日（${earnings.date}・あと${earnings.days}日）の前に決めておく。` : '決算日を確認し、またいで持つかどうかを事前に決めておく。'}</span></li>
    </ul></Fold>
    <p className="brief-note">{view.symbol} の試算です。売買の推奨ではありません。</p>
  </section>;
}
