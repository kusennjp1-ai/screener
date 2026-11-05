import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import useMediaQuery from '../useMediaQuery';
import { money, signed } from '../positionGeometry';
import { briefOrder, candidateView, focusCandidates, focusCounts, focusHeadingNote, focusTone, watchEvent } from './briefCandidate';
import { leadingGroups, marketTone } from './briefEnvironment';
import { ma50Hit, sellChipView } from './briefSell';
import MarketCard from './MarketCard';
import { CandidateRow } from './BriefParts';
import { Parts, RiseItem, ScreenNotes } from './briefPrimitives';
import { ICON } from './briefIcons';
import { PHONE_QUERY } from './briefNav';
import { bundleState, BUNDLE_SHORT, BUNDLE_TEXT, unlistedWatch, useWatchSellChecks } from './useBriefData';
import { UnlistedWatchRow, watchOrder } from './ListView';
import useSessionState from './useSessionState';

const finite = Number.isFinite;
// Today's watch card shows this many rows before 「さらに表示」 (rows with a sell chip always show).
const WATCH_ROWS = 3;
// Footnotes: in place at 1024px and wider, gathered into the screen's 注記 below that.
const TODAY_NOTE = '注目候補はすべてトレンドテンプレート8条件を満たす銘柄（TT 8/8）です。並び順：買いゾーン → ピボット接近（−5%以内）。同じ位置なら判定の達成数、RS推計の順。';
const DATE_JA = iso => { const d = new Date(`${iso}T12:00:00Z`); return Number.isFinite(d.getTime()) ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${'日月火水木金土'[d.getUTCDay()]}）` : '日付未確認'; };
const EVENT_ICON = { breakout: '↗', ext: '▲', near: '◔', zone: '●', ma50: '↘' };
/** A plain click on a link runs the in-app handler; a modified click keeps the browser's own behaviour. */
const follow = handler => event => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); handler(event); };

/** A watch row's sell chip, from the same sellChipView as the list rows and the stock conclusion. */
function SellChip({ sell }) {
  const chip = sellChipView(sell);
  return chip ? <span className={`brief-chip${chip.tone ? ` tone-${chip.tone}` : ''} brief-sellchip`} title={chip.title}>{chip.tone === 'ext' && <><span aria-hidden="true">▲</span> </>}{chip.text}</span> : null;
}

/**
 * The watch tile of Today's summary: what needs attention among the watched stocks. Only the weakness side
 * counts (a broken setup, or a sell signal if held), because no holding is registered; 0件 only when every
 * watched stock was checked. Unlisted and unchecked stocks are said, never counted as checked.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the tile's wording is tested on its own
export function watchAttention({ state, watched, watchCount, unlisted, sells }) {
  if (state !== 'ready') return watchCount > 0 ? { value: BUNDLE_SHORT[state], note: `${watchCount}銘柄を登録`, flagged: [] } : { value: '未登録', note: '☆で追加', flagged: [] };
  const total = watched.length + unlisted.length;
  if (!total) return { value: '未登録', note: '☆で追加', flagged: [] };
  const results = watched.map(view => sells[view.symbol]);
  const pending = results.filter(result => !result).length, checked = results.filter(result => result && !result.unknown).length;
  const limited = results.filter(result => result?.unknown && result.limit), unknown = results.filter(result => result?.unknown && !result.limit).length;
  const flagged = watched.filter(view => sells[view.symbol]?.weaknessHits > 0).map(view => view.symbol);
  const unsure = limited.length + unknown + unlisted.length;
  const value = flagged.length ? `${flagged.length}件` : pending ? '確認中' : unsure ? '未確認' : '0件';
  const parts = pending ? [`${total}銘柄を確認中`] : [unsure ? `${total}銘柄中${checked}銘柄を確認` : `${checked}銘柄を確認`,
    unlisted.length ? `${unlisted.length}銘柄は対象外（未確認）` : null,
    limited.length ? `${limited.length}銘柄は未確認（上限${limited[0].limit}銘柄）` : null,
    unknown ? `${unknown}銘柄は未確認` : null];
  return { value, note: [...parts, '保有未登録'].filter(Boolean).join('・'), flagged };
}

/**
 * Today: the three answers, the market card, the focus candidates and the watch list. `nav` holds the
 * moves the summary tiles and links make: market(), list(filter) and watch(); `onUnwatch` removes a symbol.
 */
export default function TodayView({ brief, watch, open, now, animate, wide, nav, onUnwatch }) {
  const focus = useMemo(() => focusCandidates(brief.ranked, brief.date), [brief.ranked, brief.date]);
  // The whole pool behind the five rows, so the summary never reads 「接近0」 while near-pivot stocks exist.
  const counts = useMemo(() => focusCounts(brief.ranked, brief.date), [brief.ranked, brief.date]);
  const groups = useMemo(() => leadingGroups(brief.ranked), [brief.ranked]);
  const headingNote = focusHeadingNote(brief.market);
  const phone = useMediaQuery(PHONE_QUERY);
  const watched = useMemo(() => (brief.bundle.data?.rankings?.minervini || []).filter(item => watch.includes(item.row.symbol)).map(item => candidateView(item, brief.date)).sort(briefOrder), [brief.bundle.data, watch, brief.date]);
  const unlisted = useMemo(() => unlistedWatch(brief, watch), [brief, watch]);
  const sells = useWatchSellChecks(watched, brief);
  const state = bundleState(brief);
  // The first rows of the watch list, plus every row with a sell chip (a fired check, a caution or 未確認,
  // never folded away); the rest open in place and stay open for this session. Nothing folds or moves
  // until every row's check is in, so a row with a signal never appears late from behind the button.
  const [watchAll, setWatchAll] = useSessionState('today-watch-all', false);
  const sellsIn = watched.every(view => sells[view.symbol]);
  const ordered = watchOrder(watched, sells);
  const watchFolded = sellsIn ? ordered.filter((view, i) => i < WATCH_ROWS || sellChipView(sells[view.symbol])) : ordered;
  const watchShown = watchAll ? ordered : watchFolded, watchHidden = ordered.length - watchFolded.length;
  return <>
    <header className="brief-hero is-today in" style={{ '--i': 0 }}><small className="numeric">{brief.date || '日付未確認'} 引け・米国株</small><h1>{brief.date ? `${DATE_JA(brief.date)}の判断` : '今日の判断'}</h1></header>
    <TodaySummary market={brief.market} marketLoading={brief.marketLoading} counts={counts} attention={watchAttention({ state, watched, watchCount: watch.length, unlisted, sells })} state={state} nav={nav} open={open} />
    <MarketCard market={brief.market} marketLoading={brief.marketLoading} trends={brief.trends} date={brief.date} />
    <section className="brief-card in" style={{ '--i': 2 }} aria-labelledby="brief-focus-title">
      <div className="brief-step"><span className="brief-step-no" aria-hidden="true">2</span><h2 id="brief-focus-title">注目候補{headingNote && <small>{headingNote}</small>}</h2><Link className="brief-more" to="/brief/list" onClick={follow(() => nav.list('all'))}>すべての候補 <span aria-hidden="true">›</span></Link></div>
      {focus.length ? <ol className="brief-rows">{focus.map((view, i) => <CandidateRow key={view.symbol} view={view} rank={i + 1} index={i} onOpen={open} now={now} animate={animate} hideTemplate context={{ market: brief.market }} />)}</ol>
        : <p className="brief-note">{state === 'ready' ? '買いゾーンまたはピボット接近（−5%以内）の選定銘柄はありません。' : BUNDLE_TEXT[state]}</p>}
      {/* The count and the near-pivot link share one line where they fit, and wrap where they do not. The count
          is of the focus candidates (buy zone and near pivot), not of every selected stock. */}
      {(counts.total > focus.length || counts.near > 0) && <div className="brief-focusfoot">
        {counts.total > focus.length && <p className="brief-note">上位{focus.length}件を表示（注目候補 {counts.total}銘柄中）</p>}
        {counts.near > 0 && <Link className="brief-nearlink" to="/brief/list" onClick={follow(() => nav.list('near'))}>ピボット接近 {counts.near}銘柄 <span aria-hidden="true">›</span></Link>}
      </div>}
      {/* The label carries the denominator and the 未確認 count, so they are never scrolled away. On a phone
          the chips are one line that scrolls sideways (its fading edge says more follows), focusable for the keyboard. */}
      {groups?.groups.length > 0 && <div className="brief-groups" data-testid="brief-groups">
        <span className="brief-groups-label">選定銘柄の多い{groups.kind}<span className="brief-note">（選定 {groups.total}銘柄中{groups.unnamed ? `・${groups.kind}未確認 ${groups.unnamed}` : ''}）</span></span>
        <span className="brief-groups-chips" role="group" aria-label={`選定銘柄の多い${groups.kind}`} tabIndex={phone ? 0 : undefined}>{groups.groups.map(g => <span key={g.name} className="brief-chip">{g.name}：<b className="numeric">{g.count}</b>銘柄</span>)}</span>
      </div>}
      {wide && <p className="brief-note">{TODAY_NOTE}</p>}
    </section>
    <section className="brief-card in" style={{ '--i': 3 }} aria-labelledby="brief-watch-title">
      {/* The rows are each stock's state today, not a difference from the previous publication. */}
      <div className="brief-step"><span className="brief-step-no" aria-hidden="true">3</span><h2 id="brief-watch-title">ウォッチの状況</h2></div>
      {watched.length || unlisted.length ? <ul className="brief-rows" id="brief-watch-rows">
        {unlisted.map(symbol => <UnlistedWatchRow key={symbol} symbol={symbol} date={brief.date} onRemove={onUnwatch} />)}
        {watchShown.map((view, i) => { const broke = ma50Hit(sells[view.symbol]), event = broke ? { kind: 'ma50', tone: 'ext', title: broke.detail } : watchEvent(view); return <RiseItem key={view.symbol} animate={animate} index={i}>
          <button type="button" className="brief-event" data-symbol={view.symbol} onClick={e => open(view.symbol, e.currentTarget, 'watch')}>
            <span className={`brief-event-icon tone-${event.tone}`} aria-hidden="true">{EVENT_ICON[event.kind] || '≈'}</span>
            <span><b>{view.symbol}</b> {event.title}<SellChip sell={sells[view.symbol]} /><small>{finite(view.pivot) ? `ピボット ${money(view.pivot)}・ピボット比 ${signed(view.distance)}` : 'ピボット未確認'}{view.earnings && view.earnings.days <= 10 ? `・決算まで${view.earnings.days}日` : ''}</small></span>
            <span className="brief-chevron" aria-hidden="true">{ICON.next}</span>
          </button></RiseItem>; })}</ul>
        : <p className="brief-note">{state !== 'ready' && watch.length ? `ウォッチ中の${watch.length}銘柄は、${state === 'loading' ? '候補の読み込み後に確認します。' : '候補データがないため確認できません。'}` : '銘柄の画面で ☆ を押すと、ピボットへの接近や上抜けをここでお知らせします。'}</p>}
      {watchHidden > 0 && <button type="button" className="brief-morebutton" aria-expanded={watchAll} aria-controls="brief-watch-rows" onClick={() => setWatchAll(value => !value)}>{watchAll ? '表示を減らす' : `さらに表示（残り ${watchHidden}件）`}</button>}
    </section>
    <ScreenNotes id="today" wide={wide} notes={[TODAY_NOTE]} />
  </>;
}

/**
 * Three answers first: can I buy, how many setups, does anything I watch need attention. Each tile is a
 * link to where its answer is explained: the market tab, the focus pool as a list, the flagged stock (or
 * the watch tab, flagged rows first).
 */
function TodaySummary({ market, marketLoading, counts, attention, state, nav, open }) {
  const tone = marketTone(market), focus = focusTone(state, counts, market);
  // The card below carries 独自判定; the summary keeps only the state (「50日線割れ（弱含み）」).
  const verdict = market?.label ? market.label.replace(/（(?:(.+)・)?独自判定）$/, (_, inner) => inner ? `（${inner}）` : '') : '市場未確認';
  const one = attention.flagged.length === 1 ? attention.flagged[0] : null;
  return <ul className="brief-summary in" style={{ '--i': 0 }} aria-label="今日の要点" data-testid="brief-summary">
    <li className={`tone-${tone}`}><Link className="brief-tile" to="/brief/market" onClick={follow(() => nav.market())}><small>地合い</small><b>{!market && marketLoading ? '読込中' : verdict}</b><em><Parts text={!market && marketLoading ? '' : market?.cap > 0 ? `検討可・目安≤${Math.round(market.cap * 100)}%` : market?.state === 'unknown' || !market ? '買いは見送り' : '買いは控える'} /></em></Link></li>
    <li className={focus ? `tone-${focus}` : ''}><Link className="brief-tile" to="/brief/list" onClick={follow(() => nav.list('focus'))}><small>注目候補</small><b>{state === 'ready' ? `${counts.total}銘柄` : BUNDLE_SHORT[state]}</b><em><Parts text={state === 'ready' ? `ゾーン${counts.zone}・接近${counts.near}` : ''} /></em></Link></li>
    <li className={attention.flagged.length ? 'tone-ext' : ''}><Link className="brief-tile" to={one ? `/brief/stock/${encodeURIComponent(one)}` : '/brief/watch'} onClick={follow(event => (one ? open(one, event.currentTarget, 'watch') : nav.watch()))}>
      <small>ウォッチの注意</small><b>{attention.value}</b><em><Parts text={attention.note} /></em></Link></li>
  </ul>;
}
