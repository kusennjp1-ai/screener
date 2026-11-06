import { signed } from '../positionGeometry';
import { code33ChipView, earningsCaution, earningsChipView } from '../fundamentalsExplain.js';
import { meterPercent } from './briefNav';
import { footprint, RS_LEAD_FROM_HIGH_PERCENT } from './briefChartModel';
import { sellChipView } from './briefSell';
import { earningsCall as earningsCallOf, POSITION_NAMES, rsShown } from './briefCandidate';
import { buyGate } from './buyGate';

const finite = Number.isFinite;
// A value that is not there reads — on screen and 未計算 to a screen reader (as DayChange says 前日比 未確認).
const DASH = <><span aria-hidden="true">—</span><span className="sr-only">未計算</span></>;
const price = value => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : DASH;
/**
 * A unit a line splits only when it is wider than the whole line (「RS推計 57（基準70）」, 「＋5%」): it moves to the
 * next line whole instead, and at 200% zoom it still wraps inside rather than push the card wider.
 */
const Unit = ({ children }) => <span className="brief-nowrap">{children}</span>;
// With its full stop inside the unit, so a phone line never starts with 「。」.
const fromSma50 = v => <Unit>{finite(v.fromSma50) ? `50日線から ${signed(v.fromSma50)}` : '50日線比 未確認'}。</Unit>;

/** The gate's line with each of its `units` kept whole (each the first match, in order). */
function withUnits(text, units) {
  if (!text) return null;
  const out = [];
  let rest = text;
  units.forEach((unit, key) => {
    const at = unit ? rest.indexOf(unit) : -1;
    if (at < 0) return;
    if (at) out.push(rest.slice(0, at));
    out.push(<Unit key={key}>{unit}</Unit>);
    rest = rest.slice(at + unit.length);
  });
  if (rest) out.push(rest);
  return out;
}

/** The parts of a call's title a phone line never splits: a crossing date with its verb, the sessions since it and the closing phrases. */
const TITLE_UNITS = /\d+\/\d+に上抜け|上抜けから\d+営業日超?|（次のピボット待ち）|買いの対象外|ピボットは参考（独自判定）/g;

/** The position under a neutral call, on one phone line: its name and the distance from the pivot. */
const positionLine = view => <><Unit>位置は参考：</Unit><Unit>{POSITION_NAMES[view.position] || view.stale?.short || view.stateLabel}</Unit>{view.stale || !finite(view.distance) ? '' : <>・<Unit>{`ピボット比 ${signed(view.distance)}`}</Unit></>}。</>;

/**
 * The line under the call, by the gate's kind: a neutral call names its reason and moves the position
 * under it; the buy zone gives the pivot and the 50-day line, then the event's note or the buy range (never
 * the range with a heavy down day or a stalled breakout); every other position its own sentence.
 */
function callLine(view, gate) {
  const note = withUnits(gate.note, gate.units || []);
  if (gate.moved) return <>{note}{positionLine(view)}</>;
  const pivot = <Unit>{`ピボット比 ${signed(view.distance)}`}</Unit>;
  switch (gate.kind) {
    case 'near': return <>{fromSma50(view)}出来高を伴ってピボットを上抜けるまで待ちます。</>;
    case 'basePosition': return <>{pivot}・{fromSma50(view)}まだ買いの局面ではありません。</>;
    case 'ext': return <>{pivot}・{fromSma50(view)}追いかけ買いは避け、次の土台を待ちます。</>;
    case 'stalePivot': return <>{fromSma50(view)}ピボットが現在値から25%超離れた旧水準のため、買いの位置は判定しません。</>;
    case 'unjudged': return '買い位置を判定できません。';
    // The buy zone: a crossing without the volume (or a stalled or undated one) says why in place of the buy range (the range is the first tile).
    default: return <>{pivot}・{fromSma50(view)}{note || <>ピボットから<Unit>＋5%</Unit>までが買いの範囲です。</>}</>;
  }
}

/**
 * The stage chip as [text, tone, title, content]: 「ステージ2（ベース形成中）」 for a stage-2 base (stagePhase, from
 * certified bars: 「・日足から算出」 when the stage was computed or the published stage was not 2), else the stage with
 * 「（日足から算出）」 when computed. Below 768px the 日足から算出 part is in the chip's title and read out, not drawn
 * (brief-decision.css), so the chips keep two lines on a phone. Stage 2 is green, 3 and 4 the ext tone, anything else neutral.
 */
function stageChip(stage) {
  if (!stage) return ['ステージ 未確認', ''];
  const computed = stage.phase === 'base' ? stage.computed || stage.value !== 2 : stage.computed;
  const [head, aside, tail] = stage.phase === 'base' ? ['ステージ2（ベース形成中', '・日足から算出', '）'] : [`ステージ${stage.value}`, '（日足から算出）', ''];
  const tone = stage.phase === 'base' || stage.value === 2 ? 'zone' : stage.value === 3 || stage.value === 4 ? 'ext' : '';
  const text = `${head}${computed ? aside : ''}${tail}`;
  return [text, tone, computed ? text : undefined, computed ? <>{head}<span className="brief-chip-aside">{aside}</span>{tail}</> : undefined];
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
 * A tile's qualifier, from the plan contract and the conclusion: 参考, 試算のみ or 既定条件 (else none), and on the
 * stop tile 収縮の中 (the stop sits inside the last contraction, ext tone). It sits on the tile's top edge, so a
 * qualified tile is no taller than a plain one.
 */
const Qualifier = ({ text, tone }) => text ? <span className={`brief-tilequal${tone ? ` tone-${tone}` : ''}`}>{text}</span> : null;

/**
 * The stock's conclusion card: the call, the pivot meter, the three level tiles and the chip list, from the
 * one buy gate (buyGate.js) the plan reads too. `bars` are the chart's bars as published (display only);
 * `judged` is the same bars when they are certified for the analysis date, else null, and is the only
 * source for anything judged from a chart (the date of the pivot crossing). `template` is the trend
 * template (useStockData's, with its rules), `market` the market verdict (prepared.market) and
 * `earningsCall` the stock view's one earnings call (earningsCall(view, now) when it is not given).
 */
export default function StockVerdict({ view, plan, stage, technical, bars, judged = null, template = null, rsHigh, financial, row, sells, diagnostics, market = null, now = Date.now(), earningsCall }) {
  const earnings = earningsCall === undefined ? earningsCallOf(view, now) : earningsCall;
  const gate = buyGate({ view, template, market, sells, earnings, judged });
  const { tone, title, reference } = gate;
  const sub = callLine(view, gate);
  const print = footprint(technical, bars);
  const code33 = code33ChipView(financial), sell = sellChipView(sells);
  // The data track's earnings chip and its caution line (the line only under a green call: it never stops it).
  const earningsChip = earningsChipView(financial), caution = tone === 'zone' ? earningsCaution(financial) : null;
  const levels = plan && !plan.blocked ? plan : null;
  const referenced = reference || plan?.reference;
  const sizing = referenced ? '参考' : plan?.trialOnly ? '試算のみ' : plan?.defaults ? '既定条件' : null;
  // The stop inside the last contraction says so on its tile (never moved by itself).
  const stopQualifier = referenced ? ['参考'] : levels?.stopInsideBase === true ? ['収縮の中', 'ext'] : [sizing];
  const risk = finite(levels?.riskDollars) ? `$${Math.round(levels.riskDollars).toLocaleString('en-US')}` : null;
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
    stageChip(stage),
    // Green only while the base still contracts: a base already broken out of is history (「・土台の高値を上抜け（M/D）」),
    // unless the breakout is the analysis day's own event.
    [print ? print.text : 'VCP 未確認', print?.contracting === true && (!print.brokeOut || print.breakoutDate === view.asOf) ? 'zone' : ''],
    [`RS推計 ${rsShown(view.rs)}`, finite(view.rs) && view.rs >= 70 ? 'zone' : ''],
    // RS line at a new high while the price is still below its own high: the RS line is leading.
    ...(rsHigh ? [[finite(view.fromHigh) && view.fromHigh >= RS_LEAD_FROM_HIGH_PERCENT ? `RS線 新高値（株価に先行・高値の${view.fromHigh.toFixed(0)}%下）` : 'RS線 新高値', 'zone']] : []),
    // The first fundamentals chip is the latest earnings (data's); Code 33 is a bonus, shown here only when it is
    // met (a miss or an unknown stays in the fundamentals card).
    ...(earningsChip ? [[earningsChip.text, earningsChip.tone, earningsChip.title]] : []),
    ...(financial?.code33?.state === 'pass' ? [[code33.text, code33.tone]] : []),
    // An industry rank without an as-of date is never green (the export has none yet).
    ...(Number.isInteger(row?.ibd_group_rank) ? [[`業種 ${row.ibd_group_rank}位（推計・基準日未確認）`, '']] : []),
    // The conclusion has the room for the full sentence (the rows show its short form), except under a call that
    // already says the setup broke: the short form, with the sentence in its title.
    ...(sell ? [gate.kind === 'broken' || gate.kind === 'failedBreakout' ? [sell.text, sell.tone, sell.title ?? sell.full] : [sell.full ?? sell.text, sell.tone]] : []),
    ...(diagnostics?.valid && diagnostics.powerPlay?.mechanicalMatch ? [['パワープレー候補（機械的探索）', 'wait']] : []),
    [earnings ? earnings.chip : '決算日 未確認', earnings?.soon ? 'ext' : ''],
  ];
  return <section className={`brief-card brief-call tone-${tone} in`} style={{ '--i': 0 }} aria-label="結論" data-testid="brief-conclusion" data-gate={gate.kind}>
    <div className="brief-call-status"><span className="brief-call-dot" aria-hidden="true" /><div><strong>{withUnits(title, String(title ?? '').match(TITLE_UNITS) || [])}</strong><p>{sub}</p>{caution && <p className="brief-call-caution">{caution.text}</p>}</div></div>
    <Meter distance={view.distance} reference={reference} stale={Boolean(view.stale)} />
    <div className="brief-kgrid">
      <div><small>買いの範囲</small><b className="numeric">{price(view.pivot)}</b><em>〜{price(view.upper)}</em><Qualifier text={referenced ? '参考' : null} /></div>
      <div><small>{finite(levels?.stopPercent) ? `損切り −${levels.stopPercent.toFixed(1)}%` : '損切り'}</small><b className="numeric">{price(levels?.stop)}</b><em>買値 {price(levels?.entry)}</em><Qualifier text={stopQualifier[0]} tone={stopQualifier[1]} /></div>
      <div><small>株数</small><b className="numeric">{shares}</b><em>{shareNote}</em><Qualifier text={sizing} /></div>
    </div>
    <div className="brief-tags">{chips.map(([text, t, chipTitle, content]) => <span key={text} className={`brief-chip${t ? ` tone-${t}` : ''}`} title={chipTitle}>{content ?? text}</span>)}</div>
  </section>;
}
