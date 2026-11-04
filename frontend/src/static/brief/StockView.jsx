import { useMemo, useRef, useState } from 'react';
import { money, signed, times } from '../positionGeometry';
import PriceChart from './PriceChart';
import { Expander, ScreenNotes } from './BriefParts';
import { code33Explain, code33Parts, fundamentalTiles, fundamentalsSource, quarterReason, secStatus, footprint, ruleEvidence, positionPlan, rsLineNewHigh, sellMarks, upDownVolume, sellSignals, SELL_RULES, withBookWarning, stageFromBars, STOP_DEFAULT_PERCENT, STOP_MAX_PERCENT } from './briefModel';
import { meterPercent } from './briefNav';

const finite = Number.isFinite;
const price = value => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const PLAN_KEY = 'brief-plan';
// Chart ranges: [bars shown, interval, label]. The weekly view uses 10/30/40-week averages.
const RANGES = { '3m': [65, 'day', '3か月'], '6m': [130, 'day', '6か月'], '1y': [250, 'day', '1年'], '2yw': [104, 'week', '週足2年'] };
const readPlan = () => { try { const v = JSON.parse(localStorage.getItem(PLAN_KEY) || '{}'); return { stopPercent: finite(v.stopPercent) ? v.stopPercent : STOP_DEFAULT_PERCENT, account: finite(v.account) ? v.account : 50000, riskPercent: finite(v.riskPercent) ? v.riskPercent : 1.25 }; } catch { return { stopPercent: STOP_DEFAULT_PERCENT, account: 50000, riskPercent: 1.25 }; } };

const CALL = {
  zone: (v, breakout) => ['zone', breakout ? 'ピボットを出来高を伴って上抜け' : '買いゾーン内', `ピボット比 ${signed(v.distance)}。ピボットから＋5%までが買いの範囲です。`],
  wait: v => finite(v.distance) && v.distance >= -5 ? ['wait', `ピボットまで あと${Math.abs(v.distance).toFixed(1)}%`, '出来高を伴ってピボットを上抜けるまで待ちます。'] : ['neutral', '土台を形成中', `ピボット比 ${signed(v.distance)}。まだ買いの局面ではありません。`],
  ext: v => ['ext', '買いゾーンを超過', `ピボット比 ${signed(v.distance)}。追いかけ買いは避け、次の土台を待ちます。`],
};
const stateIcon = { pass: '✓', fail: '✕', unknown: '?', not_applicable: '–' };
// The stock screen's methodology footnotes, shown once in its 注記 at the end of the screen.
const NOTES = {
  updown: '上げ下げ出来高比（50日）は、上げた日の出来高 ÷ 下げた日の出来高です。1超は買いが優勢です。',
  eps: 'EPS は報告値（希薄化）で調整後EPSとは異なります。Q4 の売上・純利益が年度値でしか報告されていない場合は、年度値から3四半期を差し引いて算出し「Q4算出」と表示します。',
  sell: '売りのサインは保有中の判断材料です。複合警告は『株式トレード 基本と原則』の観点（出来高1.4倍はアプリの代理閾値）、それ以外のしきい値はこのアプリ独自（独自判定）です。売買の推奨ではありません。',
};
/** Phone: a secondary block folded into one line that opens in place. Desktop shows it as before. */
const Fold = ({ wide, id, summary, children }) => wide ? children : <Expander id={id} summary={summary}>{children}</Expander>;

function Meter({ distance }) {
  if (!finite(distance)) return <p className="brief-note">ピボットを確認できないため位置は未確認です。</p>;
  return <div className="brief-meter" role="img" aria-label={`ピボットからの位置 ${signed(distance)}`}>
    <span className="brief-meter-labels" aria-hidden="true"><span>土台</span><span>接近</span><span className="is-zone">買い</span><span>伸びすぎ</span></span>
    <span className="brief-meter-track" aria-hidden="true"><i className="seg-base" /><i className="seg-near" /><i className="seg-zone" /><i className="seg-ext" /></span>
    <span className="brief-marker brief-meter-marker is-entering" style={{ '--p': meterPercent(distance) }} aria-hidden="true" />
    <span className="brief-meter-ticks" aria-hidden="true">{['−10%', '−5%', '0%', '+5%', '+10%'].map(t => <span key={t}>{t}</span>)}</span>
  </div>;
}

function TemplateCard({ template, wide }) {
  if (!template) return null;
  const circumference = 2 * Math.PI * 28;
  const met = template.rules.filter(rule => rule.state === 'pass'), open = template.rules.filter(rule => rule.state !== 'pass');
  return <section className="brief-card in" style={{ '--i': 3 }} aria-labelledby="brief-tt-title">
    <div className="brief-ring-row">
      <div className="brief-ring" aria-hidden="true"><svg viewBox="0 0 68 68"><circle className="ring-bg" cx="34" cy="34" r="28" /><circle className="ring-fg" cx="34" cy="34" r="28" strokeDasharray={circumference} style={{ '--ring': circumference * (1 - template.passed / 8), '--full': circumference }} /></svg><b>{template.passed}/8</b></div>
      <div><h2 id="brief-tt-title">トレンドテンプレート {template.passed}/8</h2><p className="brief-note">{template.passed === 8 ? 'すべての条件を満たしています' : `${template.failed}項目が未達${template.unknown ? `・${template.unknown}項目が未確認` : ''}`}</p></div>
    </div>
    {wide ? <RuleList rules={template.rules} /> : <>
      {open.length > 0 && <RuleList rules={open} />}
      {met.length > 0 && <Expander id="stock-tt-met" summary={open.length ? `達成した条件 ${met.length}件` : '8条件の内訳（すべて達成）'}><RuleList rules={met} offset={open.length} /></Expander>}
    </>}
  </section>;
}

function RuleList({ rules, offset = 0 }) {
  return <ul className="brief-checks">{rules.map((rule, i) => <li key={rule.label} className="in" style={{ '--i': 4 + offset + i }}>
    <span className={`brief-check is-${rule.state}`} aria-hidden="true">{stateIcon[rule.state] || '?'}</span>
    <span>{rule.label}<span className="sr-only">（{rule.state === 'pass' ? '達成' : rule.state === 'fail' ? '未達' : '未確認'}）</span><em>{ruleEvidence(rule)}</em></span>
  </li>)}</ul>;
}

function VcpCard({ technical, bars, judged, view }) {
  const print = footprint(technical, bars), legs = technical?.vcp?.legs || [];
  const dry = legs.at(-1)?.volumeEvidence?.intervalRatio;
  return <section className="brief-card in" style={{ '--i': 4 }} aria-labelledby="brief-vcp-title">
    <h2 id="brief-vcp-title">値幅の収縮（VCP）</h2>
    {print ? <>
      <p className="brief-footprint">{print.text}</p>
      <p className="brief-note">土台 {print.weeks}週・最大の押し {print.deepest.toFixed(0)}% → 最小 {print.shallowest.toFixed(0)}%・収縮 {print.count}回{print.contracting === true ? '（押しが毎回浅くなっています）' : print.contracting === false ? '（押しの縮小が途切れています）' : ''}</p>
      <div className="brief-legs" aria-hidden="true">{legs.map((leg, i) => <div key={leg.startDate}><span className="grow-y" style={{ height: `max(6px, calc(${(leg.depthPct / Math.max(...legs.map(l => l.depthPct))).toFixed(3)} * (100% - 22px)))`, '--i': i }} />−{leg.depthPct.toFixed(0)}%</div>)}</div>
    </> : <p className="brief-note">測定できる収縮が2回以上ないため、VCPは未確認です。</p>}
    <dl className="brief-dl">
      <div><dt>最後の収縮の出来高</dt><dd>{finite(dry) ? <>{times(dry)}<small>直前50日平均比</small></> : '未確認'}</dd></div>
      <div><dt>上げ下げ出来高比（50日）</dt><dd>{(() => { const v = upDownVolume(judged); return v ? <>{v.ratio.toFixed(2)}<small>1超は買いが優勢</small></> : '未確認'; })()}</dd></div>
      <div><dt>当日の出来高</dt><dd>{finite(view?.volumeRatio) ? <>{times(view.volumeRatio)}<small>上抜けの目安 1.40×以上</small></> : '未確認'}</dd></div>
      <div><dt>ピボット</dt><dd>{finite(view?.pivot) ? <>{money(view.pivot)}<small>{view.pivotSource}</small></> : '未確認'}</dd></div>
    </dl>
  </section>;
}

const shortPeriod = row => row.end.slice(2, 7);
const monthIndex = end => Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7));
/** Quarters as YY-MM periods; calendar-consecutive ones read as a range (24-09〜25-03). */
function periodList(rows, indices) {
  const runs = [];
  for (const i of indices) {
    const run = runs.at(-1);
    if (run && run[1] === i - 1 && monthIndex(rows[i].end) - monthIndex(rows[i - 1].end) === 3) run[1] = i; else runs.push([i, i]);
  }
  return runs.map(([a, b]) => a === b ? shortPeriod(rows[a]) : `${shortPeriod(rows[a])}〜${shortPeriod(rows[b])}`).join('・');
}
/** Why each grey bar has no value, as text: one line per reason (EPS and 売上 share a line when their quarters match). */
function quarterGaps(rows) {
  const lines = [];
  for (const [metric, key, name] of [['eps', 'epsYoY', 'EPS'], ['sales', 'salesYoY', '売上']]) {
    const byReason = new Map();
    rows.forEach((row, i) => { if (finite(row[key])) return; const reason = quarterReason(row, metric) || '比較できません'; byReason.set(reason, [...(byReason.get(reason) || []), i]); });
    for (const [reason, indices] of byReason) {
      const twin = lines.find(line => line.reason === reason && line.indices.join() === indices.join());
      if (twin) twin.names.push(name); else lines.push({ names: [name], reason, indices });
    }
  }
  return lines.sort((a, b) => a.indices[0] - b.indices[0]).map(line => `${line.names.join('・')} 前年比：${periodList(rows, line.indices)}期は${line.reason}`);
}
// A margin in at most four characters so each quarter's column stays readable at 12px on a 320px phone.
const marginShort = value => !finite(value) ? '—' : value.toFixed(Math.abs(value) >= 10 ? 0 : 1).replace('-', '−');

function QuarterBars({ rows }) {
  const known = rows.flatMap(r => [r.epsYoY, r.salesYoY]).filter(finite);
  if (!known.length) return null;
  // Growth above and below the base line share one scale; a fall is never cut off at the bottom.
  const up = Math.max(0, ...known), down = Math.max(0, ...known.map(v => -v)), span = Math.max(10, up + down), H = 120;
  const unit = (H - 8) / span, base = 4 + up * unit, W = rows.length * 48;
  const gaps = quarterGaps(rows), derived = rows.some(r => r.derived);
  return <>
    <svg className="brief-quarters" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`四半期の前年同期比成長率。直近 ${rows.at(-1).end}: EPS ${finite(rows.at(-1).epsYoY) ? signed(rows.at(-1).epsYoY, 0) : quarterReason(rows.at(-1), 'eps')}、売上 ${finite(rows.at(-1).salesYoY) ? signed(rows.at(-1).salesYoY, 0) : quarterReason(rows.at(-1), 'sales')}`}>
      <line x1="0" x2={W} y1={base} y2={base} className="q-base" />
      {rows.map((r, i) => {
        const cx = i * 48 + 24, period = `${r.end.slice(0, 7)}期`;
        const bar = (v, side, cls, metric, name) => finite(v)
          ? <rect className={`${cls} grow-y`} style={{ '--i': i }} x={cx + (side < 0 ? -15 : 1)} width="14" y={v >= 0 ? base - v * unit : base} height={Math.max(1, Math.abs(v) * unit)} rx="2"><title>{`${period} ${name} ${signed(v, 0)}`}</title></rect>
          : <rect className="q-unknown" x={cx + (side < 0 ? -15 : 1)} width="14" y={base >= 28 ? base - 24 : base} height="24" rx="2"><title>{`${period} ${name}：${quarterReason(r, metric)}`}</title></rect>;
        return <g key={r.end}>{bar(r.epsYoY, -1, 'q-eps', 'eps', 'EPS 前年比')}{bar(r.salesYoY, 1, 'q-sales', 'sales', '売上 前年比')}</g>;
      })}
    </svg>
    {/* Each quarter's period, margin and Q4 derivation as HTML under its bars (12px at every width). */}
    <div className="brief-q-axis" aria-hidden="true" style={{ '--n': rows.length }}>
      {rows.map(r => <span key={r.end}><span>{r.end.slice(2, 4)}年</span><span>{Number(r.end.slice(5, 7))}月</span><b>{marginShort(r.margin)}</b>{derived && <i>{r.derived ? '算出' : ''}</i>}</span>)}
    </div>
    <p className="brief-q-legend"><span><i className="q-key-eps" />EPS 前年比</span><span><i className="q-key-sales" />売上 前年比</span><span>下段＝純利益率(%)</span>{derived && <span>算出＝Q4を10-K年度値−3四半期で算出</span>}<span><i className="q-key-unknown" />灰色＝値なし{gaps.length ? '（理由は下記）' : ''}</span></p>
    {gaps.length > 0 && <ul className="brief-q-gaps" aria-label="値なしの理由">{gaps.map(text => <li key={text}>{text}</li>)}</ul>}
  </>;
}

const usd = value => !finite(value) ? '—' : Math.abs(value) >= 1e9 ? `$${(value / 1e9).toFixed(2)}B` : Math.abs(value) >= 1e6 ? `$${(value / 1e6).toFixed(1)}M` : `$${Math.round(value).toLocaleString('en-US')}`;

/** The quarters themselves when no year-over-year comparison exists yet (few quarters or no comparable base). */
function QuarterTable({ rows }) {
  return <table className="brief-qtable">
    <thead><tr><th scope="col">期</th><th scope="col">EPS</th><th scope="col">売上</th><th scope="col">純利益率</th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.end}><th scope="row">{r.end.slice(0, 7)}{r.derived ? '（Q4算出）' : ''}</th><td>{finite(r.eps) ? r.eps.toFixed(2) : '—'}</td><td>{usd(r.revenue)}</td><td>{finite(r.margin) ? `${r.margin.toFixed(1)}%` : '—'}</td></tr>)}</tbody>
  </table>;
}

const noBaseOnly = rows => rows.every(r => [r.epsYoYReason, r.salesYoYReason].every(reason => !reason || ['no_base', 'ambiguous_base', 'not_reported'].includes(reason)));
const noYoYText = rows => noBaseOnly(rows) ? `前年同期の値がないため成長率は表示できません（${rows.length}期分のみ）。` : '前年同期と比較できないため（前年同期が赤字・ゼロ、期間の不一致など）成長率は表示できません。';

// Why a Yahoo quarterly rate is unknown, from financialHistory()'s reason.
const YAHOO_REASON = { no_quarter: '四半期の値なし', no_base: '前年同期の値なし', ambiguous_base: '前年同期を特定できず', nonpositive_base: '前年同期が赤字・ゼロ', not_reported: '未報告' };
/** Reference tiles from the current Yahoo quarterly statements, only when they passed financialHistory(). */
function yahooTiles(history) {
  const latest = history.quarterly.at(-1);
  const marginRow = [...history.quarterly].reverse().find(q => finite(q.revenue) && q.revenue > 0 && finite(q.netIncome));
  const period = row => row ? `参考・Yahoo ${row.end.slice(0, 7)}期` : '参考・Yahoo 値なし';
  const why = reason => reason === 'stale_quarter' ? `${period(latest)}は190日超のため比較しません` : `参考・Yahoo ${YAHOO_REASON[reason] || '前年同期と比較不可'}`;
  return [
    { label: 'EPS 前年比', value: finite(history.epsYoY) ? signed(history.epsYoY, 0) : null, short: '—', note: finite(history.epsYoY) ? period(latest) : why(history.epsYoYReason) },
    { label: '売上 前年比', value: finite(history.salesYoY) ? signed(history.salesYoY, 0) : null, short: '—', note: finite(history.salesYoY) ? period(latest) : why(history.salesYoYReason) },
    { label: '純利益率', value: marginRow ? `${(marginRow.netIncome / marginRow.revenue * 100).toFixed(1)}%` : null, short: '—', note: period(marginRow) },
  ];
}
const utcStamp = value => { const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toISOString().slice(5, 16).replace('T', ' ') : null; };

function Code33Parts({ report, explained }) {
  const value = code33Parts(report);
  if (!value) return null;
  const label = { pass: ['zone', '達成'], fail: ['ext', '未達'] };
  return <>
    <ul className="brief-code33-parts" aria-label="Code 33 の3条件">{value.parts.map(([name, state]) => <li key={name} className={`tone-${label[state]?.[0] || 'neutral'}`}><span>{name}</span><b>{label[state]?.[1] || '未確認'}</b></li>)}</ul>
    {value.q4Eps && !explained && <p className="brief-note">第4四半期の EPS は年次報告（10-K）にしか無いため、EPS の加速は未確認です（年間値から差し引いて推計はしません）。</p>}
  </>;
}

function FundamentalsCard({ financial }) {
  const report = financial?.report, code33 = financial?.code33, history = financial?.history;
  const sec = financial?.sec || secStatus(null, null);
  const rows = report?.rows?.slice(-8) || [];
  // SEC first; the Yahoo reference only when SEC has no quarters and its history is current.
  const yahoo = !rows.length && history?.valid && history.quarterly?.length ? yahooTiles(history) : null;
  const tiles = rows.length ? fundamentalTiles(report) : yahoo || ['EPS 前年比', '売上 前年比', '純利益率'].map(label => ({ label, value: null, short: '—', note: sec.short }));
  const stamp = utcStamp(financial?.historyRetrievedAt);
  const source = rows.length ? `${fundamentalsSource(report)}${tiles.some(t => t.derived) ? '・売上/純利益のQ4は10-K年度値−3四半期で算出' : ''}`
    : yahoo ? `出典：参考 Yahoo 四半期値（${stamp ? `取得 ${stamp} UTC・` : ''}提出日未確認）` : null;
  const explain = code33Explain(report, sec, code33);
  const tone = explain.state === 'pass' ? 'zone' : explain.state === 'fail' ? 'ext' : 'neutral';
  const yoyKnown = rows.some(r => finite(r.epsYoY) || finite(r.salesYoY));
  return <section className="brief-card in" style={{ '--i': 5 }} aria-labelledby="brief-fin-title" data-testid="brief-fundamentals">
    <div><h2 id="brief-fin-title">業績の加速</h2>{source && <p className="brief-note brief-fin-source">{source}</p>}</div>
    <div className="brief-facts is-fin">{tiles.map(t => <div className="brief-fact" key={t.label}><small>{t.label}</small><b>{t.value ?? t.short}</b><em>{t.note}</em></div>)}</div>
    {rows.length ? yoyKnown ? <QuarterBars rows={rows} /> : <><QuarterTable rows={rows} /><p className="brief-note">{noYoYText(rows)}</p></>
      : explain.kind !== 'no_sec' && <p className="brief-note">{sec.long}</p>}
    <div className={`brief-code33 tone-${tone}`}><span className="brief-code33-mark" aria-hidden="true">33</span><div><strong>{explain.title}</strong><p>{explain.text}</p></div></div>
    {code33?.source !== 'yahoo' && <Code33Parts report={report} explained={explain.kind === 'q4_eps'} />}
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

function SellCard({ sells, reason, wide }) {
  const groups = sells ? [['上昇の加速（強気での売り）', sells.strength], ['崩れ（弱気での売り）', sells.weakness]] : [];
  const loud = check => check.state === 'hit' || check.state === 'unknown';
  const shown = groups.map(([title, checks]) => [title, wide ? checks : checks.filter(loud)]).filter(([, checks]) => checks.length);
  const quiet = wide ? [] : groups.map(([title, checks]) => [title, checks.filter(check => !loud(check))]).filter(([, checks]) => checks.length);
  const count = state => quiet.flatMap(([, checks]) => checks).filter(check => check.state === state).length;
  return <section className="brief-card in" style={{ '--i': 8 }} aria-labelledby="brief-sell-title" data-testid="brief-sell">
    {/* The qualifier stays on the card at every width, next to any fired check; the 注記 keeps only the sources. */}
    <h2 id="brief-sell-title">売りのサイン<small>（直近{SELL_RULES.recentSessions}営業日・独自判定）</small></h2>
    {sells ? <>
      <p className="brief-note">{sells.advance ? `起点（直近1年の安値）${sells.advance.startDate} の ${price(sells.advance.low)} から ${signed(sells.advance.gainPct)}・${sells.advance.sessions}営業日。` : `起点（直近1年の安値）から +${SELL_RULES.advanceMinPercent}%以上・${SELL_RULES.advanceMinSessions}営業日以上の上昇局面ではないため、上昇の加速と起点以来の下落は判定しません。`}{sells.hits ? ` ${sells.hits}件のサインが出ています。` : [...sells.strength, ...sells.weakness].some(c => c.state === 'unknown') ? ' 出ているサインはありませんが、未確認の項目があります。' : ' いま出ているサインはありません。'}</p>
      {shown.map(([title, checks]) => <SellChecks key={title} title={title} checks={checks} />)}
      {quiet.length > 0 && <Expander id="stock-sell-quiet" summary={[count('clear') ? `サインなし ${count('clear')}件` : null, count('na') ? `対象外 ${count('na')}件` : null].filter(Boolean).join('・')}>
        {quiet.map(([title, checks]) => <SellChecks key={title} title={title} checks={checks} />)}
      </Expander>}
    </> : <p className="brief-note">{reason ? `日足を分析基準日の値として検証できないため、売りのサインは未確認です（${reason}）。` : '日足が60本未満のため、売りのサインは未確認です。'}</p>}
    <p className="brief-note" data-testid="brief-sell-qualifier">保有中の判断材料です（独自判定）。売買の推奨ではありません。</p>
  </section>;
}

function PlanCard({ view, plan, settings, onChange, earnings, wide }) {
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

export default function StockView({ data, header = null, wide = false }) {
  const { view, template, technical, diagnostics, financial, institutional, bars, row, certification } = data;
  // Values computed here from bars are shown only for bars certified for the analysis date.
  const judged = certification?.certified ? bars : null;
  const [range, setRange] = useState('6m');
  const [period, interval] = RANGES[range];
  const [settings, setSettings] = useState(readPlan);
  const chartRef = useRef(null);
  const plan = useMemo(() => view ? positionPlan(view, settings) : null, [view, settings]);
  const legs = technical?.vcp?.measurementsValid ? technical.vcp.legs : [];
  const stage = useMemo(() => Number.isInteger(row?.stage) ? { value: row.stage, computed: false } : (() => { const value = stageFromBars(judged); return value ? { value, computed: true } : null; })(), [row?.stage, judged]);
  const sells = useMemo(() => judged ? withBookWarning(sellSignals(judged), diagnostics) : null, [judged, diagnostics]);
  const rsHigh = useMemo(() => view?.rsLineHigh || (judged ? rsLineNewHigh(data.chart.data?.rs_line, judged) === true : false), [view?.rsLineHigh, data.chart.data, judged]);
  const model = useMemo(() => bars && view ? { symbol: view.symbol, bars, rsLine: data.chart.data?.rs_line || [], legs, pivot: view.pivot, upper: view.upper, stop: plan?.stop ?? null, rsNewHigh: rsHigh, dryUpLeg: legs.at(-1) || null, sellMarks: sellMarks(sells), interval } : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bars, view?.symbol, view?.pivot, view?.upper, legs, data.chart.data, rsHigh, sells, interval]);
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
    [`Code 33 ${code33 === 'pass' ? '達成' : code33 === 'fail' ? '未達' : financial?.sec?.state === 'detail_loading' ? '読み込み中' : '未確認'}${financial?.code33?.source === 'yahoo' ? '（参考）' : ''}`, code33 === 'pass' ? 'zone' : ''],
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
        <div><small>{plan ? `損切り（−${plan.stopPercent.toFixed(1)}%）` : '損切り'}</small><b className="numeric">{price(plan?.stop)}</b><em>買値 {price(plan?.entry)}</em></div>
        <div><small>利益目標 2R</small><b className="numeric">{price(plan?.r2)}</b><em>3R {price(plan?.r3)}</em></div>
      </div>
      <div className="brief-tags">{chips.map(([text, t]) => <span key={text} className={`brief-chip${t ? ` tone-${t}` : ''}`}>{text}</span>)}</div>
    </section>
    <section className="brief-card brief-chartcard in" style={{ '--i': 1 }} aria-label="株価チャート">
      {model ? <PriceChart ref={chartRef} model={model} period={period} /> : <p className="brief-note brief-chart-placeholder" role="status">{data.chart.isError ? '日足チャートを取得できません。' : row?.chart_path ? '日足チャートを読み込み中…' : 'この銘柄の日足チャートは未配信です。'}</p>}
      {bars && data.date && bars.at(-1)?.date !== data.date ? <p className="brief-note brief-asof" role="note">日足は {bars.at(-1)?.date} までです（分析基準日 {data.date} の日足は未取得）。チャートから算出する判定は未確認にしています。</p> : null}
      <div className="brief-periods" role="group" aria-label="表示期間">{Object.entries(RANGES).map(([key, [, , label]]) => <button key={key} type="button" aria-pressed={range === key} onClick={() => setRange(key)}>{label}</button>)}<span className="brief-note brief-periods-hint">なぞると{interval === 'week' ? '週足' : '日足'}の値</span></div>
      <div className="brief-legend" aria-hidden="true"><span><i className="lg-ma50" />{interval === 'week' ? '10週線' : '50日線'}</span><span><i className="lg-ma150" />{interval === 'week' ? '30・40週線' : '150・200日線'}</span><span><i className="lg-pivot" />ピボット</span><span><i className="lg-stop" />損切り</span><span><i className="lg-rs" />RS線（株価÷S&amp;P 500。RS推計とは別）</span><span>枠＝値幅の収縮</span>{model?.sellMarks?.length ? <span><i className="lg-sell" />売りのサイン（▼上昇の加速・▲崩れ）</span> : null}<span className="brief-legend-hint">なぞると{interval === 'week' ? '週足' : '日足'}の値</span></div>
    </section>
    <div className="brief-grid">
      <TemplateCard template={template} wide={wide} />
      <VcpCard technical={technical} bars={bars} judged={judged} view={view} />
      <FundamentalsCard financial={financial} />
      <InstitutionalCard institutional={institutional} />
      <PlanCard view={view} plan={plan} settings={settings} onChange={update} earnings={view.earnings} wide={wide} />
      {bars ? <SellCard sells={sells} reason={certification?.certified ? null : certification?.reason} wide={wide} /> : null}
    </div>
    <p className="brief-note brief-pad">候補は購入推奨ではありません。数値は分析基準日の公開データに基づきます。</p>
    <ScreenNotes id="stock" notes={[NOTES.updown, NOTES.eps, bars ? NOTES.sell : null]} />
  </div>;
}
