import { Link } from 'react-router-dom';
import { sentence, trendsAlert } from './briefModel';
import { chartStatusOf, marketCardView, num, sma } from './marketTabModel';
import { Parts } from './briefPrimitives';

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

/** Why the market trends show nothing, or why the long history was withdrawn (`detail`: the market tab also names the FTD). */
export function StatusAlert({ view, trends, detail = false }) {
  const { status } = view;
  return status.state === 'loading' ? <p className="brief-note" role="status">市場推移を読み込み中…</p>
    : status.state === 'error' ? <p className="brief-alert" role="alert" data-failure={status.kind}>{trendsAlert(status)}数値は表示しません。</p>
      : status.state === 'none' ? <p className="brief-note">市場推移データはこの公開に含まれていません。</p>
        : view.longError ? <p className="brief-alert" role="alert" data-check={trends.data.long_history_error_key || undefined}>{sentence(view.longError)}{detail ? '分配日・フォロースルーデー' : '分配日'}は指数データから表示しています。</p> : null;
}

/**
 * Today's tile: a pair names each side (S&P / NAS, 高 / 安) and marks the side that fired. `blockAsOf` is the
 * one older session the card's note dates every source to: a tile of that session needs no date of its own.
 */
const Fact = ({ fact, blockAsOf = null }) => { const asOf = fact.asOf && fact.asOf !== blockAsOf ? fact.asOf : null; return <div className={`brief-fact${fact.warn ? ' is-warn' : ''}`}>
  <small><Label text={fact.label} /></small>
  {fact.pairs ? <b className="brief-pairs">{fact.pairs.map(pair => <span key={pair.name} className={`brief-pair${pair.warn ? ' is-warn' : ''}`}><span className="brief-pair-name">{pair.name}</span>{pair.warn && <WarnMark />}{pair.value}</span>)}<AsOf value={asOf} /></b>
    : <b className={fact.warn ? 'is-warn' : ''}>{fact.warn && <WarnMark />}{fact.b}<AsOf value={asOf} /></b>}
  {fact.em ? <em className={fact.warn ? 'is-warn' : ''}><Parts text={fact.em} /></em> : null}
</div>; };

/**
 * Today's 地合い card: the verdict, the index chart and four market-environment tiles (view model: marketCardView).
 * Every value shows a number (an older one only with its own date) or the precise reason it has none. The market tab's
 * card (MarketDetailCard) lives in MarketScreen.jsx, the tab's lazily loaded chunk, so its groups, rows, warning summary,
 * index switch and study parts never ship with Today.
 */
export default function MarketCard({ market, marketLoading = false, trends, date }) {
  const view = marketCardView({ market, marketLoading, trends, date });
  const { verdict, dating, chart } = view;
  return <section className="brief-card brief-market in" style={{ '--i': 1 }} aria-labelledby="brief-market-title">
    <div className="brief-step"><span className="brief-step-no" aria-hidden="true">1</span><h2 id="brief-market-title">地合い</h2><Link className="brief-more" to="/brief/market">市場の詳細 <span aria-hidden="true">›</span></Link></div>
    <div className={`brief-verdict tone-${verdict.tone}`} data-testid="brief-regime" aria-busy={verdict.pending || undefined}><VerdictMark verdict={verdict} /><div><strong>{verdict.label}</strong><p>{verdict.text}</p></div></div>
    <IndexChart closes={chart.sp500} distribution={chart.distribution} status={chartStatusOf(view, view.status)} />
    <StatusAlert view={view} trends={trends} />
    <div className="brief-facts">{view.today.map(fact => <Fact key={fact.key} fact={fact} blockAsOf={dating.blockAsOf} />)}</div>
    {view.distReasons.length > 0 && <ul className="brief-factnotes">{view.distReasons.map(text => <li key={text}>{text}</li>)}</ul>}
    {dating.todayNote && <p className="brief-note brief-asof" role="note">{dating.todayNote}</p>}
    {view.warnings.length > 0 && <ul className="brief-warnings" aria-label="地合いの悪化サイン（独自判定）">{view.warnings.map(w => <li key={w.key}><span aria-hidden="true">▲</span> {w.text}（独自判定）</li>)}</ul>}
    {view.split?.warning && <p className="brief-alert" role="note">▲ {view.split.fromHigh > -0.05 ? '指数は1年高値の水準にありますが' : `指数は1年高値まであと${Math.abs(view.split.fromHigh).toFixed(1)}%の位置ですが`}、200日線より上の銘柄は{num(view.split.above200Percent, 1)}%。指数と個別株が乖離しています（独自判定）。</p>}
    {/* The phone's Today hides the verdict, so the card itself still says the judgement is the app's own,
        and Today's candidate rows show RS推計: the RS is the app's own too, never IBD's. */}
    <p className="brief-note">地合いの判定・各集計・RS推計は公開日足からの独自判定・独自集計で、IBDの公式値ではありません。</p>
  </section>;
}
