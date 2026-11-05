import { signed } from '../positionGeometry';
import { conditionText } from '../missingCondition';
import { code33ChipView } from '../fundamentalsExplain.js';
import { meterPercent } from './briefNav';
import { footprint, RS_LEAD_FROM_HIGH_PERCENT } from './briefChartModel';
import { sellChipView } from './briefSell';
import { breakoutEvent, candidateMarketGate, earningsSoon, POSITION_NAMES, rsShown } from './briefCandidate';

const finite = Number.isFinite;
const price = value => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const fromSma50 = v => finite(v.fromSma50) ? `50日線から ${signed(v.fromSma50)}` : '50日線比 未確認';

/** The position call: tone, title and the sentence under it, from the position and the day's verified event. */
function positionCall(view, judged) {
  const pivot = `ピボット比 ${signed(view.distance)}`;
  switch (view.position) {
    case 'zone': {
      const event = breakoutEvent(view, judged);
      return { tone: event?.tone || 'zone', title: event?.title || '買いゾーン内', line: `${event?.title || '買いゾーン内'}・${pivot}`, sub: `${pivot}・${fromSma50(view)}。ピボットから＋5%までが買いの範囲です。` };
    }
    case 'near': return { tone: 'wait', title: `${POSITION_NAMES.near}（あと${Math.abs(view.distance).toFixed(1)}%）`, line: `${POSITION_NAMES.near}・${pivot}`, sub: `${fromSma50(view)}。出来高を伴ってピボットを上抜けるまで待ちます。` };
    case 'base': return { tone: 'neutral', title: POSITION_NAMES.base, line: `${POSITION_NAMES.base}・${pivot}`, sub: `${pivot}・${fromSma50(view)}。まだ買いの局面ではありません。` };
    case 'ext': return { tone: 'ext', title: POSITION_NAMES.ext, line: `${POSITION_NAMES.ext}・${pivot}`, sub: `${pivot}・${fromSma50(view)}。追いかけ買いは避け、次の土台を待ちます。` };
    case 'staleAbove': case 'staleBelow': return { tone: view.stale.above ? 'ext' : 'neutral', title: view.stale.text, line: view.stale.short, sub: `${fromSma50(view)}。ピボットが現在値から25%超離れた旧水準のため、買いの位置は判定しません。` };
    default: return { tone: 'neutral', title: view.stateLabel, line: view.stateLabel, sub: '買い位置を判定できません。' };
  }
}

const listed = rules => `${rules.slice(0, 2).map(conditionText).join('・')}${rules.length > 2 ? `ほか${rules.length - 2}件` : ''}`;

/**
 * Why the stock is no buy candidate by the trend template, from the template's own rules (never from
 * `qualified` alone), or null when it is one. `reference`: its position and prices are for reference only.
 */
function templateGate(view, template) {
  const rules = template?.rules || [];
  const failed = rules.filter(rule => rule.state === 'fail'), open = rules.filter(rule => rule.state !== 'pass' && rule.state !== 'fail');
  if (failed.length || (!template && view.failed > 0)) return { title: `トレンドテンプレート未達${failed.length ? `（未達：${listed(failed)}）— ` : ' — '}買いの対象外` };
  if (open.length || (!template && view.unknown > 0)) return { title: 'TT未確認・買い判断不可', note: open.length ? `未確認：${listed(open)}。` : '' };
  if (view.qualified === true) return null;
  const integrity = template?.integrity && template.integrity.state !== 'pass' ? `日足の整合性 ${template.integrity.state === 'fail' ? '未達' : '未確認'}` : null;
  return { title: `選定対象外（${view.exclusion || integrity || '選定の判定を確認できません'}）` };
}

/**
 * The conclusion: green only when the trend template, the market, the earnings date and the position all
 * allow a new buy. Otherwise a neutral line says which one does not, and the position moves under it.
 */
function conclusion(view, template, market, judged) {
  const call = positionCall(view, judged);
  const tt = templateGate(view, template);
  if (tt) return { tone: 'neutral', title: tt.title, sub: `${tt.note || ''}位置は参考：${call.line}。`, reference: true };
  // The market and the earnings date only stop what would otherwise invite a buy: the buy zone and near the pivot.
  if (view.position !== 'zone' && view.position !== 'near') return call;
  const gate = candidateMarketGate(market);
  const moved = `位置：${call.line}・${fromSma50(view)}。`;
  if (gate === 'hold') return { tone: 'neutral', title: '地合いが新規の買いを控える状態（独自判定）', sub: moved };
  if (gate !== 'open') return { tone: 'neutral', title: '地合い未確認（新規の買いは判断を保留）', sub: moved };
  if (earningsSoon(view)) return { tone: 'neutral', title: `決算まで${view.earnings.days}日：発表前の新規買いは見送り候補（独自判定）`, sub: moved };
  return call;
}

// The meter's four segments use the position names; a narrow phone breaks a name only between its words.
const METER_NAMES = ['base', 'near', 'zone', 'ext'].map(key => [key, POSITION_NAMES[key]]);
const WORDS = /(ピボット|買いゾーン|土台)(?=.)/;
const breakable = name => { const [, head] = name.match(WORDS) || []; return head ? <>{head}<wbr />{name.slice(head.length)}</> : name; };

function Meter({ distance, reference }) {
  if (!finite(distance)) return <p className="brief-note">ピボットを確認できないため位置は未確認です。</p>;
  return <div className="brief-meter" role="img" aria-label={`ピボットからの位置${reference ? '（参考）' : ''} ${signed(distance)}`}>
    <span className="brief-meter-labels" aria-hidden="true">{METER_NAMES.map(([key, name]) => <span key={key} className={key === 'zone' ? 'is-zone' : undefined}>{breakable(name)}</span>)}</span>
    <span className="brief-meter-track" aria-hidden="true"><i className="seg-base" /><i className="seg-near" /><i className="seg-zone" /><i className="seg-ext" /></span>
    <span className="brief-marker brief-meter-marker is-entering" style={{ '--p': meterPercent(distance) }} aria-hidden="true" />
    <span className="brief-meter-ticks" aria-hidden="true">{['−10%', '−5%', '0%', '+5%', '+10%'].map(t => <span key={t}>{t}</span>)}</span>
  </div>;
}

/**
 * A tile's qualifier, from the plan contract and the conclusion: 参考, 試算のみ or 既定条件 (else none). It sits
 * on the tile's top edge, so a qualified tile is no taller than a plain one.
 */
const Qualifier = ({ text }) => text ? <span className="brief-tilequal">{text}</span> : null;

/**
 * The stock's conclusion card: the call, the pivot meter, the three level tiles and the chip list.
 * `bars` are the chart's bars as published (display only); `judged` is the same bars when they are
 * certified for the analysis date, else null, and is the only source for anything judged from a chart
 * (here: the date of a recent pivot crossing). `template` is the trend template (useStockData's, with
 * its rules) and `market` the market verdict (prepared.market).
 */
export default function StockVerdict({ view, plan, stage, technical, bars, judged = null, template = null, rsHigh, financial, row, sells, diagnostics, market = null }) {
  const { tone, title, sub, reference = false } = conclusion(view, template, market, judged);
  const print = footprint(technical, bars);
  const code33 = code33ChipView(financial), sell = sellChipView(sells);
  const levels = plan && !plan.blocked ? plan : null;
  const sizing = reference || plan?.reference ? '参考' : plan?.trialOnly ? '試算のみ' : plan?.defaults ? '既定条件' : null;
  const risk = finite(levels?.riskDollars) ? `$${Math.round(levels.riskDollars).toLocaleString('en-US')}` : null;
  const chips = [
    [stage ? `ステージ${stage.value}${stage.computed ? '（日足から算出）' : ''}` : 'ステージ 未確認', stage?.value === 2 ? 'zone' : stage ? 'ext' : ''],
    [print ? print.text : 'VCP 未確認', print?.contracting === true ? 'zone' : ''],
    [`RS推計 ${rsShown(view.rs)}`, finite(view.rs) && view.rs >= 70 ? 'zone' : ''],
    // RS line at a new high while the price is still below its own high: the RS line is leading.
    ...(rsHigh ? [[finite(view.fromHigh) && view.fromHigh >= RS_LEAD_FROM_HIGH_PERCENT ? `RS線 新高値（株価に先行・高値の${view.fromHigh.toFixed(0)}%下）` : 'RS線 新高値', 'zone']] : []),
    [code33.text, code33.tone],
    ...(Number.isInteger(row?.ibd_group_rank) ? [[`業種 ${row.ibd_group_rank}位（推計）`, row.ibd_group_rank <= 40 ? 'zone' : '']] : []),
    ...(sell ? [[sell.text, sell.tone]] : []),
    ...(diagnostics?.valid && diagnostics.powerPlay?.mechanicalMatch ? [['パワープレー候補（機械的探索）', 'wait']] : []),
    [view.earnings ? `決算まで ${view.earnings.days}日` : '決算日 未確認', earningsSoon(view) ? 'ext' : ''],
  ];
  return <section className={`brief-card brief-call tone-${tone} in`} style={{ '--i': 0 }} aria-label="結論" data-testid="brief-conclusion">
    <div className="brief-call-status"><span className="brief-call-dot" aria-hidden="true" /><div><strong>{title}</strong><p>{sub}</p></div></div>
    <Meter distance={view.distance} reference={reference} />
    <div className="brief-kgrid">
      <div><small>買いの範囲</small><b className="numeric">{price(view.pivot)}</b><em>〜{price(view.upper)}</em><Qualifier text={reference || plan?.reference ? '参考' : null} /></div>
      <div><small>{finite(levels?.stopPercent) ? `損切り −${levels.stopPercent.toFixed(1)}%` : '損切り'}</small><b className="numeric">{price(levels?.stop)}</b><em>買値 {price(levels?.entry)}</em><Qualifier text={sizing} /></div>
      <div><small>株数</small><b className="numeric">{finite(levels?.shares) && levels.shares > 0 ? `${levels.shares.toLocaleString('en-US')}株` : '—'}</b><em>リスク {risk || '—'}</em><Qualifier text={sizing} /></div>
    </div>
    <div className="brief-tags">{chips.map(([text, t]) => <span key={text} className={`brief-chip${t ? ` tone-${t}` : ''}`}>{text}</span>)}</div>
  </section>;
}
