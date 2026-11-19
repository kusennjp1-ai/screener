import { Link } from 'react-router-dom';
import { Expander } from './briefPrimitives';
import { GATE_GROUPS, NO_KIND } from './marketGate';
import { num } from './marketTabModel';

/** The kind of each of Today's four facts (marketCardView's `today`), as the gate's fact table names it (FACT_KINDS). */
const TODAY_FACT_KINDS = Object.freeze({ dist: '実測・参考', tt: '独自集計（RS推計を含む）', a200: '実測・参考', a50: '実測・参考', leaderCount: '独自集計（RS推計を含む）', extremes: '実測・参考' });
/** Which group of the fold each of Today's four facts belongs to (plan S1-P4: A's grouping). */
const TODAY_FACT_GROUP = Object.freeze({ dist: 'index', extremes: 'index', a200: 'breadth', a50: 'breadth', tt: 'stock', leaderCount: 'stock' });
/** The gate's own rows the four facts do not already show, by group (gateFacts' keys). */
const GATE_ROWS = Object.freeze({ index: ['spyLines', 'spyDistribution'], breadth: ['above50'], stock: ['breakout', 'health'] });
/** What the levels of the guide are: the app's own, never tested (the market tab's exposure rule says the same in full). */
export const GUIDE_UNTESTED = '目安の水準（最大50%・最大25%・0%）は、検証していない独自設定です（未検証）。';

/** The figure's label, breaking only before its （…）. */
const FigureLabel = ({ text }) => { const at = text.indexOf('（'); return at > 0 ? <>{text.slice(0, at)}<span className="brief-frag">{text.slice(at)}</span></> : text; };
const Kind = ({ kind }) => <span className="brief-gate-kind">{kind}</span>;

/** One of the gate's own facts (gateFacts): its label, its value or its absent words, its reading and its kind. */
function GateRow({ fact, blockAsOf = null }) {
  const asOf = fact.asOf && fact.asOf !== blockAsOf ? fact.asOf : null;
  return <div className="brief-gate-fact">
    <small>{fact.label}</small>
    <b>{fact.value}{asOf ? <span className="brief-fact-asof">（{asOf}時点）</span> : null}</b>
    {fact.reading || fact.tier ? <em>{[fact.reading, fact.tier ? `段階：${fact.tier}` : null].filter(Boolean).join('・')}</em> : null}
    {fact.kind !== NO_KIND && <Kind kind={fact.kind} />}
  </div>;
}

/**
 * The fold of Today's gate card (closed on a phone, in place at 1024px and wider): the verdict with the regime's label, the facts in A's three groups (Today's four
 * facts with their own dates, and the gate's rows they do not show, each with its kind), then the conditions that are met, the
 * sign's full sentence, the reasons a count is missing, the 参考 notes, the conflict sentences, the full basis and 未検証.
 */
function GateFold({ gate, view, facts, renderFact, tileLine, cause }) {
  const byKey = Object.fromEntries(facts.map(fact => [fact.key, fact]));
  const today = view.today;
  const notes = view.warnings.filter(w => w.reference);
  const conditions = gate.conditions;
  return <div className="brief-gate-fold">
    {/* 判定: the regime's label with the answer (独自判定); the figure and its definition are the first fold's. */}
    {byKey.verdict && <div className="brief-gate-group" role="group" aria-label={GATE_GROUPS.verdict}>
      <h3>{GATE_GROUPS.verdict}</h3>
      <div className="brief-facts"><GateRow fact={byKey.verdict} blockAsOf={view.dating.blockAsOf} /></div>
    </div>}
    {Object.entries({ index: GATE_GROUPS.index, breadth: GATE_GROUPS.breadth, stock: GATE_GROUPS.stock }).map(([group, title]) => {
      const own = today.filter(fact => TODAY_FACT_GROUP[fact.key] === group);
      // The 50-day share is a row of its own only when Today's facts do not already show it (an older schema's stand-in).
      const rows = GATE_ROWS[group].map(key => byKey[key]).filter(fact => fact && !(fact.key === 'above50' && today.some(t => t.key === 'a50')));
      return <div key={group} className="brief-gate-group" role="group" aria-label={title}>
        <h3>{title}</h3>
        <div className="brief-facts">{rows.map(fact => <GateRow key={fact.key} fact={fact} blockAsOf={view.dating.blockAsOf} />)}{own.map(fact => renderFact(fact, fact.valued ? TODAY_FACT_KINDS[fact.key] ?? null : null))}</div>
      </div>;
    })}
    {conditions && conditions.fold.length > 0 && <div className="brief-gate-met"><small>{conditions.title}（独自設定）</small><ul>{conditions.fold.map(text => <li key={text}>{text}</li>)}</ul></div>}
    {tileLine && <p className="brief-note brief-tile-note">{tileLine}</p>}
    {view.distReasons.length > 0 && <ul className="brief-factnotes">{view.distReasons.map(text => <li key={text}>{text}</li>)}</ul>}
    {notes.length > 0 && <ul className="brief-warnings" aria-label="地合いの悪化サイン（独自判定）">{notes.map(w => <li key={w.key} className="is-reference"><span aria-hidden="true">○</span> 参考：{w.text}（独自判定）</li>)}</ul>}
    {view.split?.warning && view.split.reference && <SplitAlert split={view.split} />}
    {view.conflict && <p className="brief-note brief-gate-conflict">{view.conflict}</p>}
    {cause && <p className="brief-note brief-gate-conflict">{cause}</p>}
    {gate.basis?.full && <p className="brief-gate-basis-full">{gate.basis.full}</p>}
    {gate.head.definition && <p className="brief-note">{GUIDE_UNTESTED}</p>}
  </div>;
}

/** The ▲ split alert (or ○ 参考 when the study could not confirm its rule), in MarketCard's words. */
export function SplitAlert({ split }) {
  return <p className={`brief-alert${split.reference ? ' is-reference' : ''}`} role="note">{split.reference ? <><span aria-hidden="true">○</span> 参考：</> : '▲ '}{split.fromHigh > -0.05 ? '指数は1年高値の水準にありますが' : `指数は1年高値まであと${Math.abs(split.fromHigh).toFixed(1)}%の位置ですが`}、200日線より上の銘柄は{num(split.above200Percent, 1)}%。指数と個別株が乖離しています（独自判定）。</p>;
}

/**
 * Today's gate card (plan S1-P4), inside the 地合い region (MarketCard). On a phone (below 1024px) the first fold carries every
 * rule-bearing line and nothing is trimmed: the kicker with the analysis day (and a late publication's age), the headline with
 * 独自判定 beside the labelled figure, the figure's definition, one 根拠 line (実測), each condition that is 未達 or 未確認 by name,
 * the sign line, Today's note, each firing ▲ and the status alert; the rest is in one fold. At 1024px and wider the verdict block
 * and the index chart lead (MarketCard), and the fold is in place.
 */
export default function TodayGate({ gate, view, facts, wide, renderFact, statusAlert, tileLine = null, cause = null }) {
  const { head, basis, conditions, sign } = gate;
  const firing = view.warnings.filter(w => !w.reference);
  const fold = <GateFold gate={gate} view={view} facts={facts} renderFact={renderFact} tileLine={tileLine} cause={cause} />;
  return <>
    {!wide && <div className="brief-gate-kicker">
      <h2 id="brief-market-title">地合い</h2><span className="numeric">{head.kicker.slice(head.kicker.indexOf('・'))}</span>{head.age && <span className="numeric is-warn">・{head.age}</span>}
      <Link className="brief-more" to="/brief/market">市場の詳細 <span aria-hidden="true">›</span></Link>
    </div>}
    {!wide && <p className="brief-gate-headline">{head.headline ? <><b>{head.headline}</b>{head.headlineKind && <span className="brief-gate-kind">（{head.headlineKind}）</span>}</> : <b>読込中</b>}</p>}
    {/* The figure with its label on one line (the label wraps before its （…） and never under the figure), so the open and
        the waiting forms (「新規買いの目安（10/2時点・独自設定）」) keep one height. */}
    {head.figure && <p className="brief-gate-figure"><small><FigureLabel text={head.figureLabel} /></small><b className="numeric">{head.figure}</b></p>}
    {head.definition && <p className="brief-gate-line">{head.definition}</p>}
    {basis && <p className="brief-gate-line brief-gate-basis">{basis.text}<span className="brief-gate-kind">（{basis.kind}）</span></p>}
    {conditions && conditions.first.length > 0 && <div className="brief-gate-conds">
      {!conditions.allUnknown && <small>{conditions.title}（独自設定）</small>}
      <ul>{conditions.first.map(text => <li key={text}>{text}</li>)}</ul>
    </div>}
    {/* A sign withheld while the series is a session behind says what it is (「サイン：未確認（10/2分は再集計待ち）」). */}
    {sign && <p className="brief-gate-line brief-gate-sign">{sign.type === 'withheld' ? `サイン：${sign.text}` : sign.text}</p>}
    {gate.todayNote && <p className="brief-note brief-asof" role="note">{gate.todayNote}</p>}
    {statusAlert}
    {firing.length > 0 && <ul className="brief-warnings" aria-label="地合いの悪化サイン（独自判定）">{firing.map(w => <li key={w.key}><span aria-hidden="true">▲</span> {w.text}（独自判定）</li>)}</ul>}
    {view.split?.warning && !view.split.reference && <SplitAlert split={view.split} />}
    {gate.summary && (wide ? fold : <Expander id="today-gate" className="brief-gate-more" summary={gate.summary}>{fold}</Expander>)}
  </>;
}

