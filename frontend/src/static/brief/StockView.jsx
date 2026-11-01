import { useMemo, useRef, useState } from 'react';
import { money, signed, times } from '../positionGeometry';
import PriceChart from './PriceChart';
import { footprint, positionPlan, rsLineNewHigh, sellMarks, upDownVolume, sellSignals, SELL_RULES, withBookWarning, stageFromBars, STOP_DEFAULT_PERCENT, STOP_MAX_PERCENT } from './briefModel';
import { meterPercent } from './briefNav';

const finite = Number.isFinite;
const price = value => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const PLAN_KEY = 'brief-plan';
const readPlan = () => { try { const v = JSON.parse(localStorage.getItem(PLAN_KEY) || '{}'); return { stopPercent: finite(v.stopPercent) ? v.stopPercent : STOP_DEFAULT_PERCENT, account: finite(v.account) ? v.account : 50000, riskPercent: finite(v.riskPercent) ? v.riskPercent : 1.25 }; } catch { return { stopPercent: STOP_DEFAULT_PERCENT, account: 50000, riskPercent: 1.25 }; } };

const CALL = {
  zone: (v, breakout) => ['zone', breakout ? 'ピボットを出来高を伴って上抜け' : '買いゾーン内', `ピボット比 ${signed(v.distance)}。ピボットから＋5%までが買いの範囲です。`],
  wait: v => finite(v.distance) && v.distance >= -5 ? ['wait', `ピボットまで あと${Math.abs(v.distance).toFixed(1)}%`, '出来高を伴ってピボットを上抜けるまで待ちます。'] : ['neutral', '土台を形成中', `ピボット比 ${signed(v.distance)}。まだ買いの局面ではありません。`],
  ext: v => ['ext', '買いゾーンを超過', `ピボット比 ${signed(v.distance)}。追いかけ買いは避け、次の土台を待ちます。`],
};
const stateIcon = { pass: '✓', fail: '✕', unknown: '?', not_applicable: '–' };

function Meter({ distance }) {
  if (!finite(distance)) return <p className="brief-note">ピボットを確認できないため位置は未確認です。</p>;
  return <div className="brief-meter" role="img" aria-label={`ピボットからの位置 ${signed(distance)}`}>
    <span className="brief-meter-labels" aria-hidden="true"><span>土台</span><span>接近</span><span className="is-zone">買い</span><span>伸びすぎ</span></span>
    <span className="brief-meter-track" aria-hidden="true"><i className="seg-base" /><i className="seg-near" /><i className="seg-zone" /><i className="seg-ext" /></span>
    <span className="brief-marker brief-meter-marker is-entering" style={{ '--p': meterPercent(distance) }} aria-hidden="true" />
    <span className="brief-meter-ticks" aria-hidden="true">{['−10%', '−5%', '0%', '+5%', '+10%'].map(t => <span key={t}>{t}</span>)}</span>
  </div>;
}

function TemplateCard({ template }) {
  if (!template) return null;
  const circumference = 2 * Math.PI * 28;
  return <section className="brief-card in" style={{ '--i': 3 }} aria-labelledby="brief-tt-title">
    <div className="brief-ring-row">
      <div className="brief-ring" aria-hidden="true"><svg viewBox="0 0 68 68"><circle className="ring-bg" cx="34" cy="34" r="28" /><circle className="ring-fg" cx="34" cy="34" r="28" strokeDasharray={circumference} style={{ '--ring': circumference * (1 - template.passed / 8), '--full': circumference }} /></svg><b>{template.passed}/8</b></div>
      <div><h2 id="brief-tt-title">トレンドテンプレート {template.passed}/8</h2><p className="brief-note">{template.passed === 8 ? 'すべての条件を満たしています' : `${template.failed}項目が未達${template.unknown ? `・${template.unknown}項目が未確認` : ''}`}</p></div>
    </div>
    <ul className="brief-checks">{template.rules.map((rule, i) => <li key={rule.label} className="in" style={{ '--i': 4 + i }}>
      <span className={`brief-check is-${rule.state}`} aria-hidden="true">{stateIcon[rule.state] || '?'}</span>
      <span>{rule.label}<span className="sr-only">（{rule.state === 'pass' ? '達成' : rule.state === 'fail' ? '未達' : '未確認'}）</span><em>{rule.evidence || ''}</em></span>
    </li>)}</ul>
  </section>;
}

function VcpCard({ technical, bars, judged, view }) {
  const print = footprint(technical, bars), legs = technical?.vcp?.legs || [];
  const dry = legs.at(-1)?.volumeEvidence?.intervalRatio;
  return <section className="brief-card in" style={{ '--i': 4 }} aria-labelledby="brief-vcp-title">
    <h2 id="brief-vcp-title">値幅の収縮（VCP）</h2>
    {print ? <>
      <p className="brief-footprint">{print.text}</p>
      <p className="brief-note">土台 {print.weeks}週・最大の押し {print.deepest.toFixed(0)}% → 最小 {print.shallowest.toFixed(0)}%・収縮 {print.count}回{print.contracting === true ? '（押しが毎回浅くなっています）' : print.contracting === false ? '（押しの縮小が途切れています）' : ''}</p>
      <div className="brief-legs" aria-hidden="true">{legs.map((leg, i) => <div key={leg.startDate}><span className="grow-y" style={{ height: `${Math.max(6, leg.depthPct / Math.max(...legs.map(l => l.depthPct)) * 72)}px`, '--i': i }} />−{leg.depthPct.toFixed(0)}%</div>)}</div>
    </> : <p className="brief-note">測定できる収縮が2回以上ないため、VCPは未確認です。</p>}
    <dl className="brief-dl">
      <div><dt>最後の収縮の出来高</dt><dd>{finite(dry) ? `${times(dry)}（直前50日平均比）` : '未確認'}</dd></div>
      <div><dt>上げ下げ出来高比（50日）</dt><dd>{(() => { const v = upDownVolume(judged); return v ? `${v.ratio.toFixed(2)}（上げた日の出来高 ÷ 下げた日の出来高。1超は買いが優勢）` : '未確認'; })()}</dd></div>
      <div><dt>当日の出来高</dt><dd>{finite(view?.volumeRatio) ? `${times(view.volumeRatio)}（上抜けの目安 1.40×以上）` : '未確認'}</dd></div>
      <div><dt>ピボット</dt><dd>{finite(view?.pivot) ? `${money(view.pivot)}（${view.pivotSource}）` : '未確認'}</dd></div>
    </dl>
  </section>;
}

function QuarterBars({ rows }) {
  const known = rows.flatMap(r => [r.epsYoY, r.salesYoY]).filter(finite);
  if (!known.length) return null;
  const max = Math.max(10, ...known.map(Math.abs)), H = 140, base = 110, W = rows.length * 48;
  return <svg className="brief-quarters" viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={`四半期の前年同期比成長率。直近 ${rows.at(-1).end}: EPS ${signed(rows.at(-1).epsYoY, 0)}、売上 ${signed(rows.at(-1).salesYoY, 0)}`}>
    <line x1="0" x2={W} y1={base} y2={base} className="q-base" />
    {rows.map((r, i) => {
      const cx = i * 48 + 24, bar = (v, side, cls) => finite(v) ? <rect className={`${cls} grow-y`} style={{ '--i': i }} x={cx + (side < 0 ? -15 : 1)} width="14" y={v >= 0 ? base - v / max * 96 : base} height={Math.max(1, Math.abs(v) / max * 96)} rx="2" /> : <rect className="q-unknown" x={cx + (side < 0 ? -15 : 1)} width="14" y={base - 24} height="24" rx="2" />;
      return <g key={r.end}>{bar(r.epsYoY, -1, 'q-eps')}{bar(r.salesYoY, 1, 'q-sales')}<text x={cx} y={H - 12} textAnchor="middle" className="q-label">{r.end.slice(2, 7)}</text><text x={cx} y={H + 6} textAnchor="middle" className="q-margin">{finite(r.margin) ? r.margin.toFixed(1) : '—'}</text>{r.derived && <text x={cx} y={H + 20} textAnchor="middle" className="q-label">Q4算出</text>}</g>;
    })}
  </svg>;
}

function FundamentalsCard({ financial }) {
  const report = financial?.report, code33 = financial?.code33;
  const rows = report?.rows?.slice(-8) || [];
  const last = rows.at(-1), previous = rows.at(-2);
  const c33 = code33?.state === 'pass' ? ['zone', '達成'] : code33?.state === 'fail' ? ['ext', '未達'] : ['neutral', '未確認'];
  return <section className="brief-card in" style={{ '--i': 5 }} aria-labelledby="brief-fin-title">
    <h2 id="brief-fin-title">業績の加速</h2>
    <div className="brief-facts">
      <div className="brief-fact"><small>EPS 前年比</small><b>{finite(last?.epsYoY) ? signed(last.epsYoY, 0) : '未取得'}</b><em>{finite(previous?.epsYoY) ? `前期 ${signed(previous.epsYoY, 0)}` : '前期 未取得'}</em></div>
      <div className="brief-fact"><small>売上 前年比</small><b>{finite(last?.salesYoY) ? signed(last.salesYoY, 0) : '未取得'}</b><em>{finite(previous?.salesYoY) ? `前期 ${signed(previous.salesYoY, 0)}` : '前期 未取得'}</em></div>
      <div className="brief-fact"><small>純利益率</small><b>{finite(last?.margin) ? `${last.margin.toFixed(1)}%` : '未取得'}</b><em>{last?.end ? `${last.end} 期` : '期 未確認'}</em></div>
    </div>
    {rows.length ? <QuarterBars rows={rows} /> : <p className="brief-note">SEC提出書類の四半期データは未取得です。</p>}
    <div className={`brief-code33 tone-${c33[0]}`}><span className="brief-code33-mark" aria-hidden="true">33</span><div><strong>Code 33 {c33[1]}</strong><p>{code33?.state === 'unknown' || !code33 ? '判定に必要な四半期データ（EPS・売上・利益率）がそろっていません。' : code33.source === 'sec' ? '直近3四半期の EPS 成長・売上成長の加速と利益率の拡大を SEC 提出書類で判定。' : `${code33.label}。SEC提出書類で判定できないため、提供元の四半期値で同じ規則を当てはめた参考判定です。`}</p></div></div>
    <p className="brief-note">EPS は報告値（希薄化）で調整後EPSとは異なります。Q4 の売上・純利益が年度値でしか報告されていない場合は、年度値から3四半期を差し引いて算出し「Q4算出」と表示します。</p>
  </section>;
}

function InstitutionalCard({ institutional }) {
  const observations = institutional?.observations || [];
  const max = Math.max(1, ...observations.map(o => o.manager_count).filter(finite));
  return <section className="brief-card in" style={{ '--i': 6 }} aria-labelledby="brief-13f-title">
    <h2 id="brief-13f-title">機関の保有（13F）</h2>
    {observations.length ? <div className="brief-bars">{observations.map((o, i) => <div key={o.period} className={i === observations.length - 1 ? 'is-current' : ''}><span>{o.period}</span><span className="grow-x" style={{ width: `${Math.round(o.manager_count / max * 100)}%`, '--i': i }} /><b>{finite(o.manager_count) ? o.manager_count.toLocaleString('ja-JP') : '—'}</b></div>)}</div> : <p className="brief-note">13F の集計値は未取得です。</p>}
    <p className="brief-note">{institutional?.growth?.reason ? `${institutional.growth.reason.replace(/。$/, '')}。` : ''}13F を報告した運用会社の数（四半期）で、日々の売買ではありません。報告日は買付日ではありません。</p>
  </section>;
}

const SELL_STATE = { hit: ['!', 'サインあり'], clear: ['·', 'サインなし'], unknown: ['?', '未確認'], na: ['–', '対象外'] };

function SellChecks({ title, checks }) {
  return <>
    <h3 className="brief-subhead">{title}</h3>
    <ul className="brief-checks brief-sellchecks">{checks.map(check => <li key={check.key}>
      <span className={`brief-check is-sell-${check.state}`} aria-hidden="true">{SELL_STATE[check.state][0]}</span>
      <span>{check.label}<span className="sr-only">（{SELL_STATE[check.state][1]}）</span><em>{check.detail}</em></span>
    </li>)}</ul>
  </>;
}

function SellCard({ sells, reason }) {
  return <section className="brief-card in" style={{ '--i': 8 }} aria-labelledby="brief-sell-title" data-testid="brief-sell">
    <h2 id="brief-sell-title">売りのサイン（直近{SELL_RULES.recentSessions}営業日）</h2>
    {sells ? <>
      <p className="brief-note">{sells.advance ? `起点（直近1年の安値）${sells.advance.startDate} の ${price(sells.advance.low)} から ${signed(sells.advance.gainPct)}・${sells.advance.sessions}営業日。` : `起点（直近1年の安値）から +${SELL_RULES.advanceMinPercent}%以上・${SELL_RULES.advanceMinSessions}営業日以上の上昇局面ではないため、上昇の加速と起点以来の下落は判定しません。`}{sells.hits ? ` ${sells.hits}件のサインが出ています。` : [...sells.strength, ...sells.weakness].some(c => c.state === 'unknown') ? ' 出ているサインはありませんが、未確認の項目があります。' : ' いま出ているサインはありません。'}</p>
      <SellChecks title="上昇の加速（強気での売り）" checks={sells.strength} />
      <SellChecks title="崩れ（弱気での売り）" checks={sells.weakness} />
    </> : <p className="brief-note">{reason ? `日足を分析基準日の値として検証できないため、売りのサインは未確認です（${reason}）。` : '日足が60本未満のため、売りのサインは未確認です。'}</p>}
    <p className="brief-note">保有中の判断材料です。複合警告は『株式トレード 基本と原則』の観点（出来高1.4倍はアプリの代理閾値）、それ以外のしきい値はこのアプリ独自（独自判定）です。売買の推奨ではありません。</p>
  </section>;
}

function PlanCard({ view, plan, settings, onChange, earnings }) {
  if (!plan) return null;
  const input = (key, label, step, extra = {}) => <label>{label}<input type="number" inputMode="decimal" step={step} value={settings[key]} onChange={e => onChange(key, Number(e.target.value))} {...extra} /></label>;
  return <section className="brief-card brief-plan in" style={{ '--i': 7 }} aria-labelledby="brief-plan-title">
    <h2 id="brief-plan-title">建て玉と損切りの計画</h2>
    <div className="brief-inputs">{input('account', '口座資金（$）', 1000, { min: 0 })}{input('riskPercent', '1回のリスク（%）', 0.25, { min: 0.1, max: 5 })}{input('stopPercent', '損切り幅（%）', 0.5, { min: 1, max: STOP_MAX_PERCENT - 0.5 })}</div>
    <label className="brief-range"><span className="sr-only">損切り幅（%）</span><input type="range" min="3" max={STOP_MAX_PERCENT - 0.5} step="0.5" value={settings.stopPercent} onChange={e => onChange('stopPercent', Number(e.target.value))} aria-label="損切り幅（%）" /><span aria-hidden="true">損切り幅 <b className="numeric">{plan.stopPercent.toFixed(1)}%</b>（10%未満）</span></label>
    <div className="brief-kgrid">
      <div><small>株数</small><b className="numeric" data-testid="brief-shares">{finite(plan.shares) ? plan.shares.toLocaleString('en-US') : '—'}</b><em>リスク {finite(plan.riskDollars) ? `$${Math.round(plan.riskDollars).toLocaleString('en-US')}` : '—'}</em></div>
      <div><small>投資額</small><b className="numeric">{finite(plan.cost) ? `$${Math.round(plan.cost).toLocaleString('en-US')}` : '—'}</b><em>口座の {finite(plan.weight) ? plan.weight.toFixed(1) : '—'}%</em></div>
      <div><small>損切り</small><b className="numeric">{price(plan.stop)}</b><em>買値 {price(plan.entry)}</em></div>
    </div>
    <div className="brief-rbar" aria-hidden="true"><i className="r-risk">−1R</i><i className="r-2">+2R {price(plan.r2)}</i><i className="r-3">+3R</i></div>
    <ul className="brief-rules">
      <li><span>損切りの位置は買う前に決め、その価格に来たら例外なく手仕舞う。</span></li>
      <li><span>損失は最大でも10%未満に抑え、平均の損失はそれより小さく保つ。</span></li>
      <li><span>株価が +2R（{price(plan.r2)}）まで進んだら、損切りを買値まで引き上げて利益を守る。</span></li>
      <li><span>{earnings ? `決算をまたいで持つかどうかは、発表日（${earnings.date}・あと${earnings.days}日）の前に決めておく。` : '決算日を確認し、またいで持つかどうかを事前に決めておく。'}</span></li>
    </ul>
    <p className="brief-note">{view.symbol} の試算です。売買の推奨ではありません。</p>
  </section>;
}

export default function StockView({ data, header = null }) {
  const { view, template, technical, diagnostics, financial, institutional, bars, row, certification } = data;
  // Values computed here from bars are shown only for bars certified for the analysis date.
  const judged = certification?.certified ? bars : null;
  const [period, setPeriod] = useState(130);
  const [settings, setSettings] = useState(readPlan);
  const chartRef = useRef(null);
  const plan = useMemo(() => view ? positionPlan(view, settings) : null, [view, settings]);
  const legs = technical?.vcp?.measurementsValid ? technical.vcp.legs : [];
  const stage = useMemo(() => Number.isInteger(row?.stage) ? { value: row.stage, computed: false } : (() => { const value = stageFromBars(judged); return value ? { value, computed: true } : null; })(), [row?.stage, judged]);
  const sells = useMemo(() => judged ? withBookWarning(sellSignals(judged), diagnostics) : null, [judged, diagnostics]);
  const rsHigh = useMemo(() => view?.rsLineHigh || (judged ? rsLineNewHigh(data.chart.data?.rs_line, judged) === true : false), [view?.rsLineHigh, data.chart.data, judged]);
  const model = useMemo(() => bars && view ? { symbol: view.symbol, bars, rsLine: data.chart.data?.rs_line || [], legs, pivot: view.pivot, upper: view.upper, stop: plan?.stop ?? null, rsNewHigh: rsHigh, dryUpLeg: legs.at(-1) || null, sellMarks: sellMarks(sells) } : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bars, view?.symbol, view?.pivot, view?.upper, legs, data.chart.data, rsHigh, sells]);
  if (!view) return <p className="brief-note brief-pad" role="status">銘柄データを読み込み中…</p>;
  const update = (key, value) => {
    if (!finite(value)) return;
    const next = { ...settings, [key]: key === 'stopPercent' ? Math.min(STOP_MAX_PERCENT - 0.5, Math.max(1, value)) : Math.max(0, value) };
    setSettings(next);
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
    if (key === 'stopPercent') { const nextPlan = positionPlan(view, next); if (nextPlan) chartRef.current?.moveStop(nextPlan.stop); }
  };
  const breakout = view.state === 'zone' && finite(view.volumeRatio) && view.volumeRatio >= 1.4;
  const [tone, title, sub] = (CALL[view.state] || (() => ['neutral', view.stateLabel, '買い位置を判定できません。']))(view, breakout);
  const print = footprint(technical, bars);
  const code33 = financial?.code33?.state;
  const chips = [
    [stage ? `ステージ${stage.value}${stage.computed ? '（日足から算出）' : ''}` : 'ステージ 未確認', stage?.value === 2 ? 'zone' : stage ? 'ext' : ''],
    [print ? print.text : 'VCP 未確認', print?.contracting === true ? 'zone' : ''],
    [`RS推計 ${finite(view.rs) ? view.rs : '未確認'}`, finite(view.rs) && view.rs >= 70 ? 'zone' : ''],
    // RS line at a new high while the price is still below its own high: the RS line is leading.
    ...(rsHigh ? [[finite(view.fromHigh) && view.fromHigh >= 2 ? `RS線 新高値（株価に先行・高値の${view.fromHigh.toFixed(0)}%下）` : 'RS線 新高値', 'zone']] : []),
    [`Code 33 ${code33 === 'pass' ? '達成' : code33 === 'fail' ? '未達' : '未確認'}${financial?.code33?.source === 'yahoo' ? '（参考）' : ''}`, code33 === 'pass' ? 'zone' : ''],
    ...(Number.isInteger(row?.ibd_group_rank) ? [[`業種 ${row.ibd_group_rank}位（推計）`, row.ibd_group_rank <= 40 ? 'zone' : '']] : []),
    ...(sells?.hits ? [[`売りのサイン ${sells.hits}件`, 'ext']] : []),
    ...(diagnostics?.valid && diagnostics.powerPlay?.mechanicalMatch ? [['パワープレー候補（機械的探索）', 'wait']] : []),
    [view.earnings ? `決算まで ${view.earnings.days}日` : '決算日 未確認', view.earnings && view.earnings.days <= 10 ? 'ext' : ''],
  ];
  return <div className="brief-stock">
    {header}
    <section className={`brief-card brief-call tone-${tone} in`} style={{ '--i': 0 }} aria-label="結論" data-testid="brief-conclusion">
      <div className="brief-call-status"><span className="brief-call-dot" aria-hidden="true" /><div><strong>{title}</strong><p>{sub}</p></div></div>
      <Meter distance={view.distance} />
      <div className="brief-kgrid">
        <div><small>買いの範囲</small><b className="numeric">{price(view.pivot)}</b><em>〜{price(view.upper)}</em></div>
        <div><small>損切り（−{plan ? plan.stopPercent.toFixed(1) : '—'}%）</small><b className="numeric">{price(plan?.stop)}</b><em>買値 {price(plan?.entry)}</em></div>
        <div><small>利益目標 2R</small><b className="numeric">{price(plan?.r2)}</b><em>3R {price(plan?.r3)}</em></div>
      </div>
      <div className="brief-tags">{chips.map(([text, t]) => <span key={text} className={`brief-chip${t ? ` tone-${t}` : ''}`}>{text}</span>)}</div>
    </section>
    <section className="brief-card brief-chartcard in" style={{ '--i': 1 }} aria-label="日足チャート">
      {model ? <PriceChart ref={chartRef} model={model} period={period} /> : <p className="brief-note brief-chart-placeholder" role="status">{data.chart.isError ? '日足チャートを取得できません。' : row?.chart_path ? '日足チャートを読み込み中…' : 'この銘柄の日足チャートは未配信です。'}</p>}
      {bars && data.date && bars.at(-1)?.date !== data.date ? <p className="brief-note brief-asof" role="note">日足は {bars.at(-1)?.date} までです（分析基準日 {data.date} の日足は未取得）。チャートから算出する判定は未確認にしています。</p> : null}
      <div className="brief-periods" role="group" aria-label="表示期間">{[[65, '3か月'], [130, '6か月'], [250, '1年']].map(([n, label]) => <button key={n} type="button" aria-pressed={period === n} onClick={() => setPeriod(n)}>{label}</button>)}<span className="brief-note">なぞると日足の値</span></div>
      <div className="brief-legend" aria-hidden="true"><span><i className="lg-ma50" />50日線</span><span><i className="lg-ma150" />150・200日線</span><span><i className="lg-pivot" />ピボット</span><span><i className="lg-stop" />損切り</span><span><i className="lg-rs" />RS線（株価÷S&amp;P 500。RS推計とは別）</span><span>枠＝値幅の収縮</span>{model?.sellMarks?.length ? <span><i className="lg-sell" />売りのサイン（▼上昇の加速・▲崩れ）</span> : null}</div>
    </section>
    <div className="brief-grid">
      <TemplateCard template={template} />
      <VcpCard technical={technical} bars={bars} judged={judged} view={view} />
      <FundamentalsCard financial={financial} />
      <InstitutionalCard institutional={institutional} />
      <PlanCard view={view} plan={plan} settings={settings} onChange={update} earnings={view.earnings} />
      {bars ? <SellCard sells={sells} reason={certification?.certified ? null : certification?.reason} /> : null}
    </div>
    <p className="brief-note brief-pad">候補は購入推奨ではありません。数値は分析基準日の公開データに基づきます。</p>
  </div>;
}
