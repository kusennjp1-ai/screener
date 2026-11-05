import { useMemo, useState } from 'react';
import { Expander, Parts } from './briefPrimitives';
import { clampPlanSetting, PLAN_BLOCKED, PLAN_DEFAULTS, POSITION_CAP_MAX_PERCENT, positionPlan, readPlanSettings, RISK_MAX_PERCENT, STOP_LIMIT_PERCENT,
  STOP_MAX_PERCENT, STOP_MIN_PERCENT, STRUCTURAL_STOP_BUFFER_PERCENT, withStructuralSymbol } from './positionSizing';

const finite = Number.isFinite;
const price = value => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const dollars = value => finite(value) ? `$${Math.round(value).toLocaleString('en-US')}` : '—';
const percent = (value, digits = 1) => finite(value) ? `${value.toFixed(digits)}%` : '—';
/** A setting as its input shows it: at most two decimals (a structural stop is kept exact). */
const shown = value => finite(value) ? Math.round(value * 100) / 100 : '';
/** A value that cannot be computed: — with its screen-reader word. */
const Missing = () => <>—<span className="sr-only">（算出できません）</span></>;
const PLAN_KEY = 'brief-plan';
/** The stored inputs, each checked and clamped (readPlanSettings); anything unreadable gives the defaults. */
const readPlan = () => {
  try { return readPlanSettings(JSON.parse(localStorage.getItem(PLAN_KEY) || '{}')); } catch { return readPlanSettings(null); }
};
/** Phone: a secondary block folded into one line that opens in place. Desktop shows it as before. */
const Fold = ({ wide, id, summary, children }) => wide ? children : <Expander id={id} summary={summary}>{children}</Expander>;

/**
 * The stock's position plan and its inputs, kept per viewer in localStorage (a convenience only).
 * Returns { plan, settings, update, moveStop }: `update(key, value)` changes one input and, for the
 * stop, moves the chart's stop line through `chartRef`; `update('structural', true)` uses this stock's
 * own structural stop (kept for this symbol only: every other stock keeps the stop setting, and a stop
 * typed or slid on this stock replaces it); `moveStop(price)` moves that line. The plan reads the market
 * verdict (地合いの目安, 試算のみ), the trend template (参考) and, from the bars certified for the analysis
 * date only (`judged` with `certified`), the structural stop and ADR. A position that gets no new plan
 * (買いゾーン超過, 低変動, 買収, 判定不可) hands the screen a null plan, so the conclusion's tiles read —
 * and the chart draws no stop; the plan card names the reason.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the plan's hook lives beside its card (one owner)
export function usePositionPlan({ view, template = null, market = null, technical = null, certified = false, judged = null, chartRef }) {
  const [settings, setSettings] = useState(readPlan);
  const bars = certified === true ? judged : null;
  const context = useMemo(() => ({ market, template, technical, judged: bars }), [market, template, technical, bars]);
  const plan = useMemo(() => {
    const result = view ? positionPlan(view, settings, context) : null;
    return result?.blocked ? null : result;
  }, [view, settings, context]);
  const moveStop = stop => chartRef?.current?.moveStop(stop);
  const update = (key, value) => {
    let next;
    if (key === 'structural') next = { ...settings, structuralSymbols: withStructuralSymbol(settings.structuralSymbols, view?.symbol, value === true) };
    else if (Object.keys(PLAN_DEFAULTS).includes(key) && finite(value)) {
      next = { ...settings, [key]: clampPlanSetting(key, value) };
      // A stop typed or slid on this stock replaces its structural stop; other stocks keep theirs.
      if (key === 'stopPercent') next.structuralSymbols = withStructuralSymbol(settings.structuralSymbols, view?.symbol, false);
    } else return;
    setSettings(next);
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
    if (key === 'stopPercent' || key === 'structural') { const nextPlan = positionPlan(view, next, context); if (nextPlan && !nextPlan.blocked) moveStop(nextPlan.stop); }
  };
  return { plan, settings, update, moveStop };
}

/** The share count's constraint, under the count: the risk budget, or the cap with the loss it leaves. */
function sharesNote(plan) {
  if (plan.riskDollars === null) return <>リスク <Missing /></>;
  if (plan.shares === null) return <Parts text={plan.binding === 'risk' ? `リスク ${dollars(plan.riskDollars)}では1株未満` : `上限${plan.capPercent}%では1株未満`} />;
  // binding is 'risk' or 'cap' (the cap is at most 100%, so the account never binds on its own).
  return <Parts text={plan.binding === 'risk' ? `リスク ${dollars(plan.riskDollars)}` : `上限${plan.capPercent}%・実リスク ${dollars(plan.actualRisk)}`} />;
}

/** 地合いの目安 (独自判定, named in the terms): the market's exposure guide and the part of it this position takes, or 試算のみ. */
function MarketTile({ plan }) {
  const guide = plan.marketGuide;
  const label = <small><span className="brief-frag">地合いの</span><span className="brief-frag">目安</span></small>;
  if (plan.trialOnly) return <div className="brief-plan-guide">{label}<b>試算のみ</b><em>{guide.known ? '目安 0%（新規は控える）' : '地合い 未確認'}</em></div>;
  return <div className={`brief-plan-guide${guide.over ? ' tone-ext' : ''}`}>{label}<b className="numeric">最大{Math.round(guide.maxPercent)}%</b>
    <em>{guide.usedPercent === null ? <>うち <Missing /></> : <><span className="brief-frag">うち {percent(guide.usedPercent)}</span>{guide.over ? <span className="brief-frag">（超過）</span> : null}</>}</em></div>;
}

/** Why a structural stop that was measured cannot be applied, by state. */
const STRUCTURAL_WHY = {
  tooDeep: `深すぎる（${STOP_MAX_PERCENT}%以上・見送り候補）`,
  overLimit: `入力の上限${STOP_LIMIT_PERCENT}%を超えるため、この位置は使えません`,
  tooShallow: `損切り幅の下限${STOP_MIN_PERCENT}%より浅いため使えません`,
};

/**
 * The structural stop from the base's last measured contraction, with the button that applies it to this
 * stock; never a silent fallback. The button stays focusable once applied (aria-disabled, 適用済み), so a
 * keyboard user keeps their place. The terms beside the inputs name the buffer as 独自設定; on a phone
 * (inputs folded) the second line is short, wide it also names the low.
 */
function StructuralStop({ plan, onUse, wide }) {
  const s = plan.structural;
  if (s.state === 'unknown') return <p className="brief-structural is-unknown" data-state="unknown"><span>構造上の損切り目安：収縮の安値 未確認</span><small>（{s.reason}）</small></p>;
  if (s.state === 'above') return <p className="brief-structural" data-state="above"><span>構造上の損切り目安</span><small>最後の収縮の安値 {price(s.low)} が買値以上のため使えません</small></p>;
  // Just over the input limit, two decimals: a 9.95% stop is under 10% and must not read as 10.0%.
  const depth = `買値比 −${s.percent.toFixed(s.state === 'overLimit' ? 2 : 1)}%`;
  if (s.state === 'ok') {
    const applied = plan.stopSource === 'structural';
    const where = wide ? `最後の収縮の安値 ${price(s.low)} の${STRUCTURAL_STOP_BUFFER_PERCENT}%下` : `収縮の安値の${STRUCTURAL_STOP_BUFFER_PERCENT}%下`;
    return <div className="brief-structural" data-state="ok">
      <p><span>構造上の損切り目安 <b className="numeric">{price(s.stop)}</b></span><small><Parts text={`${depth}・${where}`} /></small></p>
      <button type="button" aria-disabled={applied || undefined} onClick={() => { if (!applied) onUse(); }}>{applied ? '適用済み' : 'この位置を使う'}</button>
    </div>;
  }
  return <p className={`brief-structural${s.state === 'tooDeep' ? ' tone-ext' : ''}`} data-state={s.state}>
    <span>構造上の損切り目安 <b className="numeric">{price(s.stop)}</b>（{depth}）</span><small>{STRUCTURAL_WHY[s.state]}</small></p>;
}

/**
 * The plan card: the entry and what it is (the analysis date's close in the buy zone, the pivot below it),
 * the inputs with the stop width's ADR (folded on a phone), the shares and their constraint, the cost, the
 * market guide, the R bar with the −1R, +2R and +3R prices, the structural stop and the rules. A position
 * that gets no new plan shows the reason instead. `judged` is the bars certified for the analysis date, or
 * null (usePositionPlan computed the plan's structural stop and ADR from it; the card itself does not read it).
 */
export default function PlanCard({ view, plan, settings, onChange, earnings, judged = null, wide }) {
  void judged;
  if (!plan) {
    const blocked = PLAN_BLOCKED[view?.state];
    return blocked ? <section className="brief-card brief-plan is-blocked in" style={{ '--i': 7 }} aria-labelledby="brief-plan-title">
      <h2 id="brief-plan-title">建て玉と損切りの計画</h2>
      <p className="brief-plan-blocked" data-testid="brief-plan-blocked">{blocked}</p>
    </section> : null;
  }
  // The stop fields show the width in use: this stock's structural stop when it is applied, else the setting.
  const input = (key, label, step, extra = {}, value = settings[key]) => <label>{label}<input type="number" inputMode="decimal" step={step} value={shown(value)} onChange={e => onChange(key, Number(e.target.value))} {...extra} /></label>;
  const structuralStop = plan.stopSource === 'structural';
  const heading = `${plan.basis === 'pivot' ? 'ピボット' : '終値'} ${price(plan.entry)} で買う場合${plan.reference ? `・参考（${plan.referenceReason}）` : ''}${wide && plan.defaults ? '・既定条件' : ''}`;
  return <section className="brief-card brief-plan in" style={{ '--i': 7 }} aria-labelledby="brief-plan-title">
    <h2 id="brief-plan-title">建て玉と損切りの計画 <small><Parts text={heading} /></small></h2>
    <Fold wide={wide} id="stock-plan-inputs" summary={<>{plan.defaults ? '既定条件' : '条件'}<small>口座 {finite(settings.account) ? `$${settings.account.toLocaleString('en-US')}` : '—'}・リスク {settings.riskPercent}%・損切り {structuralStop ? '構造 ' : ''}{plan.stopPercent.toFixed(1)}%・上限 {plan.capPercent}%</small></>}>
      <div className="brief-inputs">
        {input('account', '口座資金（$）', 1000, { min: 0 })}
        {input('riskPercent', '1回のリスク（%）', 0.25, { min: 0.1, max: RISK_MAX_PERCENT })}
        {input('stopPercent', '損切り幅（%）', 0.5, { min: STOP_MIN_PERCENT, max: STOP_LIMIT_PERCENT }, plan.stopPercent)}
      </div>
      <label className="brief-range"><span className="sr-only">損切り幅（%）</span><input type="range" min={STOP_MIN_PERCENT} max={STOP_LIMIT_PERCENT} step="0.5" value={plan.stopPercent} onChange={e => onChange('stopPercent', Number(e.target.value))} aria-label="損切り幅（%）" /><span className="brief-range-text"><span aria-hidden="true">損切り幅 <b className="numeric">{plan.stopPercent.toFixed(1)}%</b>（{structuralStop ? '構造上の目安・' : ''}10%未満）</span><span className="brief-plan-adr">{finite(plan.adrPercent) ? <>ADR <b className="numeric">{plan.adrPercent.toFixed(1)}%</b>（20日・独自計算）</> : `ADR 未確認（${plan.adrReason}）`}</span></span></label>
      <div className="brief-plan-cap">
        {input('capPercent', '1銘柄の上限（%）', 5, { min: 0, max: POSITION_CAP_MAX_PERCENT })}
        <p className="brief-plan-terms">1銘柄に投じる額の上限です（独自設定・初期{PLAN_DEFAULTS.capPercent}%・最大{POSITION_CAP_MAX_PERCENT}%）。信用取引は試算しません。</p>
      </div>
      <p className="brief-plan-terms">構造上の損切り目安は、最後の収縮の安値の{STRUCTURAL_STOP_BUFFER_PERCENT}%下です（独自設定）。地合いの目安は市場の判定によるエクスポージャーの目安（独自判定）です。</p>
    </Fold>
    <div className="brief-kgrid">
      <div><small>株数</small><b className="numeric" data-testid="brief-shares">{finite(plan.shares) ? plan.shares.toLocaleString('en-US') : <Missing />}</b><em>{sharesNote(plan)}</em></div>
      <div><small>投資額</small><b className="numeric">{finite(plan.cost) ? dollars(plan.cost) : <Missing />}</b><em>口座の {finite(plan.weight) ? `${plan.weight.toFixed(1)}%` : <Missing />}</em></div>
      <MarketTile plan={plan} />
    </div>
    <div className="brief-rbar" role="group" aria-label="R倍数の価格">
      <i className="r-risk"><span className="sr-only">損切り </span>−1R {price(plan.stop)}</i><i className="r-2">+2R {price(plan.r2)}</i><i className="r-3">+3R {price(plan.r3)}</i>
    </div>
    <StructuralStop plan={plan} wide={wide} onUse={() => onChange('structural', true)} />
    <Fold wide={wide} id="stock-plan-rules" summary="損切りと利益確保のルール（4項目）"><ul className="brief-rules">
      <li><span>損切りの位置は買う前に決め、その価格に来たら例外なく手仕舞う。</span></li>
      <li><span>損失は最大でも10%未満に抑え、平均の損失はそれより小さく保つ。</span></li>
      <li><span>株価が +2R（{price(plan.r2)}）まで進んだら、損切りを買値まで引き上げて利益を守る。</span></li>
      <li><span>{earnings ? `決算をまたいで持つかどうかは、発表日（${earnings.date}・あと${earnings.days}日）の前に決めておく。` : '決算日を確認し、またいで持つかどうかを事前に決めておく。'}</span></li>
    </ul></Fold>
    <p className="brief-note">{view.symbol} の試算です。売買の推奨ではありません。</p>
  </section>;
}
