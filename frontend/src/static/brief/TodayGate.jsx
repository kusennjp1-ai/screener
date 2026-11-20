import { Link } from 'react-router-dom';
import { Expander } from './briefPrimitives';
import { capText, MARKET_CAPS } from '../portfolioPlan';
import { BAND_SUBJECT, GATE_GROUPS, INDEX_DISTRIBUTION, NO_KIND } from './marketGate';
import { num } from './marketTabModel';

/** The kind of each of Today's four facts (marketCardView's `today`), as the gate's fact table names it (FACT_KINDS). */
const TODAY_FACT_KINDS = Object.freeze({ dist: '実測・参考', tt: '独自集計（RS推計を含む）', a200: '実測・参考', a50: '実測・参考', leaderCount: '独自集計（RS推計を含む）', extremes: '実測・参考' });
/** Which group of the fold each of Today's four facts belongs to (plan S1-P4: A's grouping). */
const TODAY_FACT_GROUP = Object.freeze({ dist: 'index', extremes: 'index', a200: 'breadth', a50: 'breadth', tt: 'stock', leaderCount: 'stock' });
/**
 * Today's 分配日（25日） fact in the fold's 根拠（指数側）: the two indices' own count, named apart from the regime's SPY count beside
 * it (「指数の分配日（25日）」) and, with a value, read as such (「判定には使わない別集計・7日以上で注意」); its values, ▲, date and a
 * missing value's own reason unchanged.
 */
const indexDistribution = fact => ({ ...fact, label: fact.label.replace(/^分配日/, INDEX_DISTRIBUTION.name),
  em: fact.valued ? [INDEX_DISTRIBUTION.reading, fact.em].filter(Boolean).join('・') : fact.em });
/** The gate's own rows the four facts do not already show, by group (gateFacts' keys). */
const GATE_ROWS = Object.freeze({ index: ['spyLines', 'spyDistribution'], breadth: ['above50'], stock: ['breakout', 'health'] });
/**
 * What the levels of the guide are: the app's own, never tested (the market tab's exposure rule says the same in full). The
 * levels are printed from MARKET_CAPS through capText, never typed beside them.
 */
export const GUIDE_UNTESTED = `目安の水準（${[MARKET_CAPS.confirmed_uptrend, MARKET_CAPS.uptrend_under_pressure, MARKET_CAPS.otherwise].map(capText).join('・')}）は、検証していない独自設定です（未検証）。`;

/**
 * A line whose （…） is one unit: it breaks only before its first 「（」, never inside it (the figure's label, the definition's
 * 「（口座比・独自設定）」, a condition's 「（いま 調整）」), so a kind label is never split across two lines.
 */
const WholeParen = ({ text }) => { const at = text.indexOf('（'); return at > 0 ? <>{text.slice(0, at)}<span className="brief-frag">{text.slice(at)}</span></> : text; };
const Kind = ({ kind }) => <span className="brief-gate-kind">{kind}</span>;
/**
 * The headline's kind beside it, 「（独自判定）」: one unit that drops whole under the headline where the line is full (a 320px
 * phone). In the waiting form (brief-gate.css: `.is-waiting`) it has one break opportunity in its middle and is set in two short
 * lines inside the headline's own line height (「（独自」「判定）」), so 「12/28時点の判定・更新待ち」 keeps one line at 375px and the
 * waiting form is exactly as tall as the open form: the whole tag beside it needs 9px more than a 375px phone gives (measured).
 */
const HeadKind = ({ kind, waiting }) => <span className="brief-gate-kind">（{kind.slice(0, 2)}{waiting && <wbr />}{kind.slice(2)}）</span>;

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
function GateFold({ gate, view, facts, renderFact, tileLine, cause, wide }) {
  const byKey = Object.fromEntries(facts.map(fact => [fact.key, fact]));
  const today = view.today;
  const notes = view.warnings.filter(w => w.reference);
  const conditions = gate.conditions;
  return <div className="brief-gate-fold">
    {/* 判定: the regime's label with the answer (独自判定); the figure and its definition are the first fold's. The row's own
        label says 判定, so the group has no visible heading (its name stays for assistive tech). */}
    {byKey.verdict && <div className="brief-gate-group is-verdict" role="group" aria-label={GATE_GROUPS.verdict}>
      <div className="brief-facts"><GateRow fact={byKey.verdict} blockAsOf={view.dating.blockAsOf} /></div>
    </div>}
    {Object.entries({ index: GATE_GROUPS.index, breadth: GATE_GROUPS.breadth, stock: GATE_GROUPS.stock }).map(([group, title]) => {
      const own = today.filter(fact => TODAY_FACT_GROUP[fact.key] === group);
      // The 50-day share is a row of its own only when Today's facts do not already show it (an older schema's stand-in).
      const rows = GATE_ROWS[group].map(key => byKey[key]).filter(fact => fact && !(fact.key === 'above50' && today.some(t => t.key === 'a50')));
      return <div key={group} className="brief-gate-group" role="group" aria-label={title}>
        <h3>{title}</h3>
        <div className="brief-facts">{rows.map(fact => <GateRow key={fact.key} fact={fact} blockAsOf={view.dating.blockAsOf} />)}{own.map(fact => renderFact(fact.key === 'dist' ? indexDistribution(fact) : fact, fact.valued ? TODAY_FACT_KINDS[fact.key] ?? null : null))}</div>
      </div>;
    })}
    {conditions && conditions.fold.length > 0 && <div className="brief-gate-met"><small>{conditions.title}（独自設定）</small><ul>{conditions.fold.map(text => <li key={text}>{text}</li>)}</ul></div>}
    {tileLine && <p className="brief-note brief-tile-note">{tileLine}</p>}
    {view.distReasons.length > 0 && <ul className="brief-factnotes">{view.distReasons.map(text => <li key={text}>{text}</li>)}</ul>}
    {notes.length > 0 && <ul className="brief-warnings" aria-label="地合いの悪化サイン（独自判定）">{notes.map(w => <li key={w.key} className="is-reference"><span aria-hidden="true">○</span> 参考：{w.text}（独自判定）</li>)}</ul>}
    {view.split?.warning && view.split.reference && <SplitAlert split={view.split} />}
    {view.conflict && <p className="brief-note brief-gate-conflict">{view.conflict}</p>}
    {cause && <p className="brief-note brief-gate-conflict">{cause}</p>}
    {/* The 根拠 in the market tab's own words (the first fold has its short form on a phone; wider, the line itself is this). */}
    {gate.basis && !wide && <p className="brief-gate-basis-full">{gate.basis.full}<span className="brief-gate-kind">（{gate.basis.kind}）</span></p>}
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
 * leads (MarketCard), the labelled figure and its definition follow it, then `chart` (the index chart), and the fold is in place.
 */
export default function TodayGate({ gate, view, facts, wide, renderFact, statusAlert, tileLine = null, cause = null, chart = null }) {
  const { head, basis, conditions, sign } = gate;
  const firing = view.warnings.filter(w => !w.reference);
  // The kicker's date after the subject (「・10/2（金）引け」), none without an analysis date; its weekday apart (brief-gate.css
  // leaves it out beside a late age below 375px).
  const kickerDate = head.kicker.startsWith(`${BAND_SUBJECT}・`) ? head.kicker.slice(BAND_SUBJECT.length) : '';
  const dated = /^(・[^（]+)(（.）)(.*)$/.exec(kickerDate);
  const fold = <GateFold gate={gate} view={view} facts={facts} renderFact={renderFact} tileLine={tileLine} cause={cause} wide={wide} />;
  return <>
    {/* The kicker's words in one block that wraps inside the row's 44px, the link beside it (brief-gate.css). The 「・」 before
        a late age ends the date's run, so a wrapped age would start its line with its number. */}
    {!wide && <div className={`brief-gate-kicker${head.age ? ' has-age' : ''}`}>
      <div className="brief-gate-kicker-text"><h2 id="brief-market-title">{BAND_SUBJECT}</h2>{kickerDate && <span className="numeric">{dated ? <>{dated[1]}<span className="brief-gate-dow">{dated[2]}</span>{dated[3]}</> : kickerDate}{head.age ? '・' : ''}</span>}{head.age && <span className="numeric is-warn">{kickerDate ? '' : '・'}{head.age}</span>}</div>
      <Link className="brief-more" to="/brief/market">市場の詳細 <span aria-hidden="true">›</span></Link>
    </div>}
    {!wide && <p className={`brief-gate-headline${gate.state === 'waiting' ? ' is-waiting' : ''}`}>{head.headline ? <><b>{head.headline}</b>{head.headlineKind && <HeadKind kind={head.headlineKind} waiting={gate.state === 'waiting'} />}</> : <b>読込中</b>}</p>}
    {/* The figure with its label on one line (the label wraps before its （…） and never under the figure), so the open and
        the waiting forms (「新規買いの目安（10/2時点・独自設定）」) keep one height. */}
    {head.figure && <p className="brief-gate-figure"><small><WholeParen text={head.figureLabel} /></small><b className="numeric">{head.figure}</b></p>}
    {head.definition && <p className="brief-gate-line"><WholeParen text={head.definition} /></p>}
    {/* 1024px and wider: the index chart under the figure and its definition (MarketCard). */}
    {chart}
    {/* One 根拠 line: its short form on a phone (ledger step 3; the full words are in the fold), the full words wider. */}
    {basis && <p className="brief-gate-line brief-gate-basis">{wide ? basis.full : basis.text}<span className="brief-gate-kind">（{basis.kind}）</span></p>}
    {conditions && conditions.first.length > 0 && <div className="brief-gate-conds">
      {!conditions.allUnknown && <small>{conditions.title}（独自設定）</small>}
      <ul>{conditions.first.map(text => <li key={text}><WholeParen text={text} /></li>)}</ul>
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

