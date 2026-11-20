import { Link } from 'react-router-dom';
import { sentence, trendsAlert } from './briefModel';
import { chartStatusOf, marketCardView, sma, verdictBasis } from './marketTabModel';
import { Parts } from './briefPrimitives';
import { gateReads, publishedMarketContext, regimeCause } from './marketGateFacts';
import { gspcFollowThrough } from './briefEnvironment';
import { gateFacts, marketGate } from './marketGate';
import TodayGate from './TodayGate';

const finite = Number.isFinite;

/** Why an index chart is not drawn (fewer than 60 sessions), from the card's chart status (chartStatusOf). */
export function ChartNote({ status, closes }) {
  return <p className="brief-note">{status === 'loading' ? '指数の履歴を読み込み中…' : status === 'error' ? '指数の履歴は整合性を確認できないため表示しません。' : status === 'fetch-error' ? '指数の履歴は取得できないため表示しません。' : status === 'history-error' ? '指数の履歴は長期集計の整合性を確認できないため表示しません。' : closes?.length ? '指数の履歴が60営業日に満たないため表示しません。' : '指数の履歴は公開データに含まれていません。'}</p>;
}

/**
 * Today's index chart: the S&P 500's last half year of closes with its 50-day line and its active distribution days.
 * The market tab draws its own (MarketScreen.jsx: the 200-day line, the FTD day, the rally low and the scale), so none
 * of that ships with Today.
 */
function IndexChart({ closes, distribution, status }) {
  const points = (closes || []).filter(p => finite(p.close)).slice(-130);
  if (points.length < 60) return <ChartNote status={status} closes={closes} />;
  const all = (closes || []).filter(p => finite(p.close)), offset = all.length - points.length;
  const ma = sma(all, offset, points.length, 50);
  const values = [...points.map(p => p.close), ...ma.filter(finite)], lo = Math.min(...values), hi = Math.max(...values);
  const W = 600, H = 132, x = i => 4 + i * (W - 8) / (points.length - 1), y = v => 18 + (hi - v) * (H - 30) / (hi - lo || 1);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join('');
  const line50 = ma.map((v, i) => v == null ? '' : `${ma[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const active = new Set((distribution?.events || []).filter(e => e.state === 'active').map(e => e.date));
  const marks = points.map((p, i) => active.has(p.date) ? i : -1).filter(i => i >= 0);
  return <>
    <svg className="brief-index" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`S&P 500 の終値と50日線（${points[0].date}〜${points.at(-1).date}）。有効な分配日 ${marks.length}日`}>
      <path d={line50} className="brief-index-ma" />
      <path d={line} className="brief-index-line" />
      {marks.map((i, k) => <path key={i} d={`M${x(i) - 5},${y(points[i].close) + 14}h10l-5,-8z`} className="brief-index-dist" style={{ '--i': k }} />)}
    </svg>
    <p className="brief-index-legend" aria-hidden="true"><span className="is-close">S&P 500 終値（半年）</span><span className="is-ma">50日線</span><span className="is-dist">▲ 分配日</span></p>
  </>;
}

export const AsOf = ({ value }) => value ? <span className="brief-fact-asof">（{value}時点）</span> : null;
// On a phone an explanation wraps only between its 「・」 parts (Parts), and a label keeps its （…） together.
export const Label = ({ text }) => { const at = text.indexOf('（'); return at > 0 ? <>{text.slice(0, at)}<span className="brief-frag">{text.slice(at)}</span></> : text; };
// A warning is never colour alone: the ▲ and the word travel with the amber value.
const WarnMark = () => <span className="brief-warnmark"><span aria-hidden="true">▲</span><span className="sr-only">注意 </span></span>;

/** The verdict's mark by its tone (the market tab draws the same one). */
export const VerdictMark = ({ verdict }) => <span className="brief-verdict-mark" aria-hidden="true">{verdict.pending ? '…' : verdict.tone === 'zone' ? '●' : verdict.tone === 'ext' ? '▲' : verdict.tone === 'neg' ? '⊘' : '?'}</span>;

/**
 * Why the market trends show nothing, or why the long history was withdrawn (`detail`: the market tab also names the FTD).
 * `withheld` names what a failure leaves out: Today's card says 「市場推移の数値」, so its verdict and guide (read from the scan's
 * rows, shown above the alert) never read as withheld numbers.
 */
export function StatusAlert({ view, trends, detail = false, withheld = '数値' }) {
  const { status } = view;
  return status.state === 'loading' ? <p className="brief-note" role="status">市場推移を読み込み中…</p>
    : status.state === 'error' ? <p className="brief-alert" role="alert" data-failure={status.kind}>{trendsAlert(status)}{withheld}は表示しません。</p>
      : status.state === 'none' ? <p className="brief-note">市場推移データはこの公開に含まれていません。</p>
        : view.longError ? <p className="brief-alert" role="alert" data-check={trends.data.long_history_error_key || undefined}>{sentence(view.longError)}{detail ? '分配日・フォロースルーデー' : '分配日'}は指数データから表示しています。</p> : null;
}

/**
 * One of Today's facts: a pair names each side (S&P / NAS, 高 / 安) and marks the side that fired. `blockAsOf` is the
 * one older session the card's note dates every source to: a tile of that session needs no date of its own.
 */
const Fact = ({ fact, blockAsOf = null, kind = null }) => { const asOf = fact.asOf && fact.asOf !== blockAsOf ? fact.asOf : null; return <div className={`brief-fact${fact.warn ? ' is-warn' : ''}`}>
  <small><Label text={fact.label} /></small>
  {fact.pairs ? <b className="brief-pairs">{fact.pairs.map(pair => <span key={pair.name} className={`brief-pair${pair.warn ? ' is-warn' : ''}`}><span className="brief-pair-name">{pair.name}</span>{pair.warn && <WarnMark />}{pair.value}</span>)}<AsOf value={asOf} /></b>
    : <b className={fact.warn ? 'is-warn' : ''}>{fact.warn && <WarnMark />}{fact.b}<AsOf value={asOf} /></b>}
  {fact.em ? <em className={fact.warn ? 'is-warn' : ''}><Parts text={fact.em} /></em> : null}
  {kind && <span className="brief-gate-kind">{kind}</span>}
</div>; };

/**
 * Today's 地合い region (plan S1-P4): exactly one region named 地合い on the page. Below 1024px it is the gate card (TodayGate:
 * the answer, the labelled figure and its definition, the basis, the unmet or unknown conditions, the sign, Today's note, the
 * firing ▲ and the status alert, the rest in one closed fold). At 1024px and wider the verdict block leads (it says the waiting
 * lead of D18, in the text ink, while a newer session has closed: verdictWaiting), the labelled figure and its definition follow
 * it, then the index chart, the rest of the gate's lines and its fold in place.
 * Every value shows a number (an older one only with its own date) or the precise reason it has none. `target` is the last
 * session the exchange calendar says has closed (marketUpdateState's target, or null), `lines` marketLines' reading of the
 * verdict's rows, `late` the bar's age line (freshnessLine). The market tab's card (MarketDetailCard) lives in
 * MarketScreen.jsx, the tab's lazily loaded chunk, so its groups, rows, warning summary, index switch and study parts never ship
 * with Today.
 */
export default function MarketCard({ market, marketLoading = false, trends, date, manifest = null, lines = null, target = null, late = null, wide = true, tileLine = null }) {
  const view = marketCardView({ market, marketLoading, trends, date, update: { target }, facts: gateReads });
  const { verdict, dating, chart } = view;
  const gate = marketGate({ market, loading: marketLoading, lines, date, target, late, trends, manifest, view });
  const facts = gateFacts({ market, marketLoading, trends, date, manifest: { data: manifest } }, { lines, target, view });
  // When the basis and the index history disagree, the fold says why (「下に詳細」): the regime's cause line, as the market tab
  // prints it under its basis (regimeCause, with the app's own ^GSPC record of the day).
  const cause = gate.basis?.conflict ? regimeCause(market, publishedMarketContext(manifest?.markets?.US ?? null, { date }), verdictBasis(market, date), date, { gspc: gspcFollowThrough(trends) }) : null;
  const renderFact = (fact, kind) => <Fact key={fact.key} fact={fact} blockAsOf={dating.blockAsOf} kind={kind} />;
  // A waiting verdict (verdictWaiting) never says 「検討できる」: the block prints the waiting lead in its text's place.
  const waiting = gate.state === 'waiting';
  return <section className={`brief-card brief-market brief-gate in${wide ? ' is-wide' : ''}`} style={{ '--i': 1 }} aria-labelledby="brief-market-title" data-gate={gate.state}>
    {wide && <>
      <div className="brief-step"><span className="brief-step-no" aria-hidden="true">1</span><h2 id="brief-market-title">地合い</h2><Link className="brief-more" to="/brief/market">市場の詳細 <span aria-hidden="true">›</span></Link></div>
      <div className={`brief-verdict tone-${verdict.tone}${waiting ? ' is-waiting' : ''}`} data-testid="brief-regime" aria-busy={verdict.pending || undefined}><VerdictMark verdict={verdict} /><div><strong>{verdict.label}</strong><p>{waiting ? verdict.lead : verdict.text}</p></div></div>
    </>}
    {/* At 1024px and wider the index chart follows the figure and its definition, so the answer and its guide read together. */}
    <TodayGate gate={gate} view={view} facts={facts} wide={wide} renderFact={renderFact} tileLine={tileLine} cause={cause} statusAlert={<StatusAlert view={view} trends={trends} withheld="市場推移の数値" />}
      chart={wide ? <IndexChart closes={chart.sp500} distribution={chart.distribution} status={chartStatusOf(view, view.status)} /> : null} />
    {/* Today's candidate rows show RS推計: the card says the judgement and the RS are the app's own, never IBD's (outside the fold). */}
    <p className="brief-note">地合いの判定・各集計・RS推計は公開日足からの独自判定・独自集計で、IBDの公式値ではありません。</p>
  </section>;
}
