import { signed } from '../positionGeometry';
import { code33ChipView, earningsCaution, earningsChipView } from '../fundamentalsExplain.js';
import { footprint, RS_LEAD_FROM_HIGH_PERCENT } from './briefChartModel';
import { sellChipView } from './briefSell';
import { earningsCall as earningsCallOf, pivotDistanceText, POSITION_NAMES, rsShown } from './briefCandidate';
import { buyGate } from './buyGate';
import { FACT_KINDS } from './marketGate';
import { isoDay, shortDate } from './briefShared';

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
const positionLine = view => <><Unit>位置は参考：</Unit><Unit>{POSITION_NAMES[view.position] || view.stale?.short || view.stateLabel}</Unit>{view.stale || !finite(view.distance) ? '' : <>・<Unit>{`ピボット比 ${pivotDistanceText(view)}`}</Unit></>}。</>;

/**
 * The line under the call, by the gate's kind: a neutral call names its reason and moves the position
 * under it; the buy zone gives the pivot and the 50-day line, then the event's note or the buy range (never
 * the range with a heavy down day or a stalled breakout); every other position its own sentence.
 */
function callLine(view, gate) {
  const note = withUnits(gate.note, gate.units || []);
  if (gate.moved) return <>{note}{positionLine(view)}</>;
  const pivot = <Unit>{`ピボット比 ${pivotDistanceText(view)}`}</Unit>;
  switch (gate.kind) {
    case 'near': return <>{fromSma50(view)}出来高を伴ってピボットを上抜けるまで待ちます。</>;
    case 'basePosition': return <>{pivot}・{fromSma50(view)}まだ買いの局面ではありません。</>;
    case 'ext': return <>{pivot}・{fromSma50(view)}追いかけ買いは避け、次の土台を待ちます。</>;
    case 'stalePivot': return <>{fromSma50(view)}ピボットが現在値から25%超離れた旧水準のため、買いの位置は判定しません。</>;
    case 'unjudged': return '買い位置を判定できません。';
    // 低変動・監視のみ: the rule that held (buyGate's note, from lowActivityReason) in place of the buy range.
    case 'lowActivity': return note;
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

/**
 * A tile's qualifier, from the plan contract and the conclusion: 参考, 試算のみ or 既定条件 (else none), and on the
 * stop tile 収縮の中 (the stop sits inside the last contraction, ext tone). It sits on the tile's top edge, so a
 * qualified tile is no taller than a plain one.
 */
const Qualifier = ({ text, tone }) => text ? <span className={`brief-tilequal${tone ? ` tone-${tone}` : ''}`}>{text}</span> : null;

/** The one sentence the retired pivot meter said for an unknown pivot (plan D5: kept word for word, a full-width line). */
export const PIVOT_UNKNOWN_NOTE = 'ピボットを確認できないため位置は未確認です。';

/**
 * The call's market line (plan S2-P1, D2, D18) from marketBand's own fields: the subject and the analysis date, the answer with
 * its kind and the figure with its kind, as units a line breaks only between (after a 「：」 or a 「・」), never inside a word, a
 * figure or a kind label. Open and closed days: 「地合い 10/2：検討可（独自判定）・目安 最大50%（独自設定）」 / 「地合い 10/2：買いは
 * 控える（独自判定）・目安 0%（独自設定）」. A waiting verdict (verdictWaiting, the 市場 tab's predicate) is its 更新待ち form, its
 * answer dated by itself and its figure labelled with the same date (「地合い 10/2時点の判定・更新待ち（独自判定）・目安 最大50%
 * （10/2時点・独自設定）」). An unknown market has no figure and no kind (「地合い 10/2：未確認・買いは見送り」); loading reads 読込中.
 * Returns `[{ head?, text, kind? }]`: `head` the subject, `kind` the label in （…） after the unit's text.
 */
function marketCallLine(band, date = null) {
  const subject = band.subject, day = isoDay(date) ? shortDate(date, date) : null;
  if (band.state === 'loading') return [{ head: subject, text: ` ${band.answer}` }];
  // The answer breaks only after its own 「・」 (「10/2時点の判定・」「更新待ち」, 「未確認・」「買いは見送り」).
  const words = band.answer.split(/(?<=・)/);
  const judged = band.state !== 'unknown';
  const answer = words.map((text, i) => ({ text, ...(judged && i === words.length - 1 ? { kind: FACT_KINDS.verdict } : {}) }));
  // The subject and the date end with 「：」, a place to break; the waiting answer carries its own date (「10/2時点の判定」), so
  // there the subject takes no second one and stays with the answer's first word.
  const lead = band.state !== 'waiting' && day ? ` ${day}：` : null;
  const units = lead ? [{ head: subject, text: lead }, ...answer] : [{ ...answer[0], head: subject, text: ` ${answer[0].text}` }, ...answer.slice(1)];
  if (!judged) return units;
  // The figure's kind is the band's own label: 独自設定, dated on a waiting day (「10/2時点・独自設定」).
  const note = /（(.+)）$/.exec(band.guideLabel || '')?.[1] ?? FACT_KINDS.guide;
  units[units.length - 1] = { ...units[units.length - 1], sep: '・' };
  return [...units, { text: `目安 ${band.guide}`, kind: note }];
}

/** The market line: each unit kept whole, its kind label in the secondary text ink, the whole line in text ink (D17). */
function MarketLine({ band, date }) {
  if (!band) return null;
  return <p className="brief-call-market" data-testid="brief-call-market">{marketCallLine(band, date).map((unit, i) => <Unit key={i}>
    {unit.head ? <span className="brief-call-head">{unit.head}</span> : null}{unit.text}{unit.kind ? <span className="brief-call-kind">（{unit.kind}）</span> : null}{unit.sep || ''}
  </Unit>)}</p>;
}

/**
 * The stock's call from the one buy gate (buyGate.js, which the plan reads too), for its three blocks on the stock screen (plan
 * S2-P1, D5): the conclusion card (CallCard: the market line, then the 銘柄 line with buyGate's own title and sub line), the
 * level tiles (Levels) and the chip list (Chips), both under the chart. `bars` are the chart's bars as published
 * (display only); `judged` is the same bars when they are certified for the analysis date, else null, and is the only source for
 * anything judged from a chart (the date of the pivot crossing). `template` is the trend template (useStockData's, with its
 * rules), `market` the market verdict (prepared.market) and `earningsCall` the stock view's one earnings call (earningsCall(view,
 * now) when it is not given). The 銘柄 line also names, in short, a sell chip the call does not state and a near earnings date
 * when the gate is not the earnings gate (D5), so neither leaves the first fold with the chips.
 */
function stockCall({ view, plan, stage, technical, bars, judged = null, template = null, rsHigh, financial, row, sells, diagnostics, market = null, now = Date.now(), earningsCall }) {
  const earnings = earningsCall === undefined ? earningsCallOf(view, now) : earningsCall;
  const gate = buyGate({ view, template, market, sells, earnings, judged });
  const { tone, title, reference } = gate;
  const sub = callLine(view, gate);
  const print = footprint(technical, bars);
  const code33 = code33ChipView(financial), sell = sellChipView(sells);
  // The data track's earnings chip and its caution line (the line only under a green call: it never stops it).
  const earningsChip = earningsChipView(financial), caution = tone === 'zone' ? earningsCaution(financial) : null;
  // A failed breakout past its window (failedBreakoutContext on the certified bars, round 3 R5): one neutral line under the
  // call, whatever the call; it never changes the gate's kind, reason or the plan.
  const context = sells?.failedContext ?? null;
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
  const tiles = [
    { label: '買いの範囲', value: price(view.pivot), note: <>〜{price(view.upper)}</>, qualifier: [referenced ? '参考' : null] },
    { label: finite(levels?.stopPercent) ? `損切り −${levels.stopPercent.toFixed(1)}%` : '損切り', value: price(levels?.stop), note: <>買値 {price(levels?.entry)}</>, qualifier: stopQualifier },
    { label: '株数', value: shares, note: shareNote, qualifier: [sizing] },
  ];
  // The call states a broken setup itself; any other sell chip, and a near earnings date under another gate, join the 銘柄 line.
  const statesSell = gate.kind === 'broken' || gate.kind === 'failedBreakout';
  const also = [...(sell && !statesSell ? [sell.text] : []), ...(earnings?.soon && gate.kind !== 'earnings' ? [earnings.chip] : [])];
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
    // The chip list has the room for the full sentence (the rows show its short form), except under a call that already
    // says the setup broke: the short form, with the sentence in its title.
    ...(sell ? [statesSell ? [sell.text, sell.tone, sell.title ?? sell.full] : [sell.full ?? sell.text, sell.tone]] : []),
    ...(diagnostics?.valid && diagnostics.powerPlay?.mechanicalMatch ? [['パワープレー候補（機械的探索）', 'wait']] : []),
    [earnings ? earnings.chip : '決算日 未確認', earnings?.soon ? 'ext' : ''],
  ];
  // A stale pivot says why in the call's line; an unknown one keeps the meter's sentence (D5).
  const pivotUnknown = !view.stale && !finite(view.distance);
  return { gate, tone, title, sub, caution, context, also, tiles, chips, pivotUnknown };
}

/** The conclusion card (plan S2-P1, B's form): line 1 the market line, line 2 labelled 銘柄 with buyGate's own title and line. */
function CallCard({ call, band, date }) {
  const { gate, tone, title, sub, caution, context, also } = call;
  return <section className={`brief-card brief-call tone-${tone} in`} style={{ '--i': 0 }} aria-label="結論" data-testid="brief-conclusion" data-gate={gate.kind}>
    <MarketLine band={band} date={date} />
    <div className="brief-call-status"><span className="brief-call-dot" aria-hidden="true" /><div>
      <div className="brief-call-label"><span className="brief-call-head">銘柄</span>{also.map(text => <span key={text} className="brief-call-also">・<Unit>{text}</Unit></span>)}</div>
      <strong>{withUnits(title, String(title ?? '').match(TITLE_UNITS) || [])}</strong><p>{sub}</p>{caution && <p className="brief-call-caution">{caution.text}</p>}{context && <p data-testid="brief-failed-context">{withUnits(context.text, context.units)}</p>}
    </div></div>
  </section>;
}

/**
 * The three level tiles (買いの範囲・損切り・株数, with their qualifiers) under the chart (plan D5: they left the card; S2-P2's
 * strip takes this place), and the retired meter's sentence for an unknown pivot as one full-width line under them.
 */
function Levels({ call }) {
  return <div className="brief-levels" data-testid="brief-levels">
    <div className="brief-kgrid">{call.tiles.map(tile => <div key={tile.label}><small>{tile.label}</small><b className="numeric">{tile.value}</b><em>{tile.note}</em><Qualifier text={tile.qualifier[0]} tone={tile.qualifier[1]} /></div>)}</div>
    {call.pivotUnknown && <p className="brief-note">{PIVOT_UNKNOWN_NOTE}</p>}
  </div>;
}

/** The call's chips (the same chips, order and tones as in the card before, plan D5), under the level tiles. */
const Chips = ({ call }) => <div className="brief-tags brief-callchips" data-testid="brief-call-chips">{call.chips.map(([text, t, chipTitle, content]) => <span key={text} className={`brief-chip${t ? ` tone-${t}` : ''}`} title={chipTitle}>{content ?? text}</span>)}</div>;

/**
 * The stock's call on the stock screen (plan S2-P1, D5), in this order on a phone: the conclusion card (the market line from
 * `band`, marketBand's value for the analysis `date`, then the 銘柄 line), `chart` (the chart card), the level tiles and the
 * chips. At 1024px and wider (`wide`: no dock and no height line) the tiles and chips stay above the chart, under the card, as
 * before S2, until the stock pane is sized (S3-P4). The other props are stockCall's. Without a band (no market line) the card
 * starts with the 銘柄 line.
 */
export default function StockVerdict({ band = null, date = null, chart = null, wide = false, ...props }) {
  const call = stockCall(props);
  const levels = <><Levels call={call} /><Chips call={call} /></>;
  return <>
    <CallCard call={call} band={band} date={date} />
    {wide ? <>{levels}{chart}</> : <>{chart}{levels}</>}
  </>;
}
