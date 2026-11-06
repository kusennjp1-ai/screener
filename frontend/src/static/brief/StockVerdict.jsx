import { signed } from '../positionGeometry';
import { conditionCompactLabel, conditionCompactText } from '../missingCondition';
import { code33ChipView } from '../fundamentalsExplain.js';
import { meterPercent } from './briefNav';
import { footprint, RS_LEAD_FROM_HIGH_PERCENT } from './briefChartModel';
import { isBreakdown, sellChipView } from './briefSell';
import { candidateMarketGate, earningsCall, POSITION_NAMES, rsShown } from './briefCandidate';
import { crossingEvent } from './breakoutHistory';

const finite = Number.isFinite;
// A value that is not there reads — on screen and 未計算 to a screen reader (as DayChange says 前日比 未確認).
const DASH = <><span aria-hidden="true">—</span><span className="sr-only">未計算</span></>;
const price = value => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : DASH;
/**
 * A unit a line splits only when it is wider than the whole line (「RS ≥ 70（61）」, 「＋5%」): it moves to the
 * next line whole instead, and at 200% zoom it still wraps inside rather than push the card wider.
 */
const Unit = ({ children }) => <span className="brief-nowrap">{children}</span>;
const fromSma50 = v => <Unit>{finite(v.fromSma50) ? `50日線から ${signed(v.fromSma50)}` : '50日線比 未確認'}</Unit>;

/** The position call: tone, title and the sentence under it, from the position and the day's verified event. */
function positionCall(view, judged) {
  const pivot = <Unit>{`ピボット比 ${signed(view.distance)}`}</Unit>;
  switch (view.position) {
    case 'zone': {
      const event = crossingEvent(view, judged);
      // A crossing without the volume says why in place of the buy range (the range is the first tile).
      return { tone: event?.tone || 'zone', title: event?.title || '買いゾーン内', sub: <>{pivot}・{fromSma50(view)}。{event?.note || <>ピボットから<Unit>＋5%</Unit>までが買いの範囲です。</>}</> };
    }
    case 'near': return { tone: 'wait', title: `${POSITION_NAMES.near}（あと${Math.abs(view.distance).toFixed(1)}%）`, sub: <>{fromSma50(view)}。出来高を伴ってピボットを上抜けるまで待ちます。</> };
    case 'base': return { tone: 'neutral', title: POSITION_NAMES.base, sub: <>{pivot}・{fromSma50(view)}。まだ買いの局面ではありません。</> };
    case 'ext': return { tone: 'ext', title: POSITION_NAMES.ext, sub: <>{pivot}・{fromSma50(view)}。追いかけ買いは避け、次の土台を待ちます。</> };
    case 'staleAbove': case 'staleBelow': return { tone: view.stale.above ? 'ext' : 'neutral', title: view.stale.text, sub: <>{fromSma50(view)}。ピボットが現在値から25%超離れた旧水準のため、買いの位置は判定しません。</> };
    default: return { tone: 'neutral', title: view.stateLabel, sub: '買い位置を判定できません。' };
  }
}

/** The position under a neutral call, on one phone line: its name and the distance from the pivot. */
const positionLine = view => <>位置は参考：<Unit>{POSITION_NAMES[view.position] || view.stale?.short || view.stateLabel}</Unit>{view.stale || !finite(view.distance) ? '' : <>・<Unit>{`ピボット比 ${signed(view.distance)}`}</Unit></>}。</>;

/** The first rule, then 「、ほかN件」: 「株価 > SMA50、ほか2件」 (one rule keeps its value: 「高値から25%以内（30.2%）」). */
const listed = rules => rules.length === 1 ? <Unit>{conditionCompactText(rules[0])}</Unit> : <><Unit>{conditionCompactLabel(rules[0])}</Unit>{`、ほか${rules.length - 1}件`}</>;

/**
 * Why the stock is no buy candidate by the trend template, from the template's own rules (never from
 * `qualified` alone), or null when it is one. An unmet RS estimate is named in the title (the plan's copy,
 * two lines at 375px); any other unmet rule, or several, are counted in a one-line title (「TT 3条件未達」, one
 * line at 375px in a full-width font too, without brackets) and named in the line under it (`note`), so the
 * conclusion card stays within its height on a phone.
 */
function templateGate(view, template) {
  const rules = template?.rules || [];
  const failed = rules.filter(rule => rule.state === 'fail'), open = rules.filter(rule => rule.state !== 'pass' && rule.state !== 'fail');
  if (failed.length === 1 && /^RS 推計/.test(failed[0].label)) return { title: <>トレンドテンプレート未達（未達：<Unit>{conditionCompactText(failed[0])}</Unit>）— 買いの対象外</> };
  if (failed.length) return { title: `TT ${failed.length}条件未達 — 買いの対象外`, note: <>未達：{listed(failed)}。</> };
  if (!template && view.failed > 0) return { title: 'トレンドテンプレート未達 — 買いの対象外' };
  if (open.length || (!template && view.unknown > 0)) return { title: 'TT未確認・買い判断不可', note: open.length ? <>未確認：{listed(open)}。</> : null };
  if (view.qualified === true) return null;
  const integrity = template?.integrity && template.integrity.state !== 'pass' ? `日足の整合性 ${template.integrity.state === 'fail' ? '未達' : '未確認'}` : null;
  return { title: `選定対象外（${view.exclusion || integrity || '選定の判定を確認できません'}）` };
}

/**
 * The conclusion: green only when the trend template, the market, the earnings date and the position all
 * allow a new buy. Otherwise a neutral line says which one does not, the position moves under it, and
 * `reference` marks the meter and the three tiles 参考 (the card never says hold off and gives an order size
 * in the same glance). `now` dates the earnings line from the later of the analysis date and today.
 */
function conclusion(view, template, market, judged, now, sells) {
  const call = positionCall(view, judged);
  const tt = templateGate(view, template);
  if (tt) return { tone: 'neutral', title: tt.title, sub: <>{tt.note}{positionLine(view)}</>, reference: true };
  // A broken buy setup (a heavy-volume 50-day break still under the line, or the book's combined warning) is
  // never a buy-side call, whatever the position: a neutral line names the check, the position moves under it.
  const broken = Array.isArray(sells?.weakness) ? sells.weakness.find(isBreakdown) : null;
  if (broken) return { tone: 'neutral', title: '買いの前提が崩れた（独自判定）', sub: <><Unit>{broken.headline || broken.label}</Unit>。{positionLine(view)}</>, reference: true };
  // The market and the earnings date only stop what would otherwise invite a buy: the buy zone and near the pivot.
  if (view.position !== 'zone' && view.position !== 'near') return call;
  const gate = candidateMarketGate(market), earnings = earningsCall(view, now);
  // One line on a phone (the 50-day line is in the plain call's line).
  const moved = positionLine(view);
  if (gate === 'hold') return { tone: 'neutral', title: '地合いが新規の買いを控える状態（独自判定）', sub: moved, reference: true };
  if (gate !== 'open') return { tone: 'neutral', title: '地合い未確認（新規の買いは判断を保留）', sub: moved, reference: true };
  if (earnings?.soon) return { tone: 'neutral', title: earnings.line, sub: moved, reference: true };
  return call;
}

// The meter's four segments use the position names; a narrow phone breaks a name only between its words.
const METER_NAMES = ['base', 'near', 'zone', 'ext'].map(key => [key, POSITION_NAMES[key]]);
const WORDS = /(ピボット|買いゾーン|土台)(?=.)/;
const breakable = name => { const [, head] = name.match(WORDS) || []; return head ? <>{head}<wbr />{name.slice(head.length)}</> : name; };

// A meter column narrower than its name (a 375px phone at 200% zoom) shows the short name instead (brief-decision.css).
const METER_SHORT = { base: '土台', near: '接近', zone: '買い', ext: '超過' };

/**
 * The pivot meter. `reference`: the stock is no buy candidate now, so the buy zone is drawn in the neutral
 * line and the meter carries 参考. A stale pivot draws nothing (the call's line already says why).
 */
function Meter({ distance, reference, stale }) {
  if (stale) return null;
  if (!finite(distance)) return <p className="brief-note">ピボットを確認できないため位置は未確認です。</p>;
  return <div className={`brief-meter${reference ? ' is-reference' : ''}`} role="img" aria-label={`ピボットからの位置${reference ? '（参考）' : ''} ${signed(distance)}`}>
    <span className="brief-meter-labels" aria-hidden="true">{METER_NAMES.map(([key, name]) => <span key={key} className={key === 'zone' ? 'is-zone' : undefined}><span className="brief-meter-name">{breakable(name)}</span><span className="brief-meter-short">{METER_SHORT[key]}</span></span>)}</span>
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
export default function StockVerdict({ view, plan, stage, technical, bars, judged = null, template = null, rsHigh, financial, row, sells, diagnostics, market = null, now = Date.now() }) {
  const { tone, title, sub, reference = false } = conclusion(view, template, market, judged, now, sells);
  const print = footprint(technical, bars);
  const code33 = code33ChipView(financial), sell = sellChipView(sells);
  const levels = plan && !plan.blocked ? plan : null;
  const sizing = reference || plan?.reference ? '参考' : plan?.trialOnly ? '試算のみ' : plan?.defaults ? '既定条件' : null;
  const risk = finite(levels?.riskDollars) ? `$${Math.round(levels.riskDollars).toLocaleString('en-US')}` : null;
  const earnings = earningsCall(view, now);
  // Fewer than one share is a result, not a missing value: 1株未満, with the limit that set it.
  const underOne = levels && finite(levels.risk) && levels.risk > 0 && finite(levels.riskDollars) && levels.riskDollars > 0
    && (levels.shares === 0 || levels.shares === null);
  const shares = finite(levels?.shares) && levels.shares > 0 ? `${levels.shares.toLocaleString('en-US')}株` : underOne ? '1株未満' : DASH;
  // The cap set the count: the loss at the stop is then below the risk budget, so the tile gives the cap and that real risk.
  const actual = finite(levels?.actualRisk) ? `$${Math.round(levels.actualRisk).toLocaleString('en-US')}` : null;
  const shareNote = underOne ? (levels.binding === 'cap' ? '1銘柄の上限超' : 'リスク上限超')
    : levels?.binding === 'cap' && finite(levels.capPercent) ? <><Unit>{`上限${levels.capPercent}%`}</Unit>・<Unit>実リスク {actual || DASH}</Unit></>
      : <>リスク {risk || DASH}</>;
  const chips = [
    [stage ? `ステージ${stage.value}${stage.computed ? '（日足から算出）' : ''}` : 'ステージ 未確認', stage?.value === 2 ? 'zone' : stage ? 'ext' : ''],
    // Green only while the base still contracts: a base already broken out of is history (「・土台の高値を上抜け（M/D）」),
    // unless the breakout is the analysis day's own event.
    [print ? print.text : 'VCP 未確認', print?.contracting === true && (!print.brokeOut || print.breakoutDate === view.asOf) ? 'zone' : ''],
    [`RS推計 ${rsShown(view.rs)}`, finite(view.rs) && view.rs >= 70 ? 'zone' : ''],
    // RS line at a new high while the price is still below its own high: the RS line is leading.
    ...(rsHigh ? [[finite(view.fromHigh) && view.fromHigh >= RS_LEAD_FROM_HIGH_PERCENT ? `RS線 新高値（株価に先行・高値の${view.fromHigh.toFixed(0)}%下）` : 'RS線 新高値', 'zone']] : []),
    [code33.text, code33.tone],
    ...(Number.isInteger(row?.ibd_group_rank) ? [[`業種 ${row.ibd_group_rank}位（推計）`, row.ibd_group_rank <= 40 ? 'zone' : '']] : []),
    // The conclusion has the room for the full sentence (the rows show its short form).
    ...(sell ? [[sell.full ?? sell.text, sell.tone]] : []),
    ...(diagnostics?.valid && diagnostics.powerPlay?.mechanicalMatch ? [['パワープレー候補（機械的探索）', 'wait']] : []),
    [earnings ? earnings.chip : '決算日 未確認', earnings?.soon ? 'ext' : ''],
  ];
  return <section className={`brief-card brief-call tone-${tone} in`} style={{ '--i': 0 }} aria-label="結論" data-testid="brief-conclusion">
    <div className="brief-call-status"><span className="brief-call-dot" aria-hidden="true" /><div><strong>{title}</strong><p>{sub}</p></div></div>
    <Meter distance={view.distance} reference={reference} stale={Boolean(view.stale)} />
    <div className="brief-kgrid">
      <div><small>買いの範囲</small><b className="numeric">{price(view.pivot)}</b><em>〜{price(view.upper)}</em><Qualifier text={reference || plan?.reference ? '参考' : null} /></div>
      <div><small>{finite(levels?.stopPercent) ? `損切り −${levels.stopPercent.toFixed(1)}%` : '損切り'}</small><b className="numeric">{price(levels?.stop)}</b><em>買値 {price(levels?.entry)}</em><Qualifier text={sizing} /></div>
      <div><small>株数</small><b className="numeric">{shares}</b><em>{shareNote}</em><Qualifier text={sizing} /></div>
    </div>
    <div className="brief-tags">{chips.map(([text, t]) => <span key={text} className={`brief-chip${t ? ` tone-${t}` : ''}`}>{text}</span>)}</div>
  </section>;
}
