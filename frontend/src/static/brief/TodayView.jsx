import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import useMediaQuery from '../useMediaQuery';
import { money, signed } from '../positionGeometry';
import { briefOrder, candidateView, focusCandidates, focusCounts, focusHeadingNote, focusTone, watchEvent } from './briefCandidate';
import { leadingGroups, marketTone } from './briefEnvironment';
import MarketCard from './MarketCard';
import { CandidateRow, Parts, RiseItem, ScreenNotes } from './BriefParts';
import { ICON } from './briefIcons';
import { PHONE_QUERY } from './briefNav';
import { bundleState, BUNDLE_SHORT, BUNDLE_TEXT, useWatchSellChecks } from './useBriefData';
import useSessionState from './useSessionState';

const finite = Number.isFinite;
// Today's watch card shows this many rows before 「さらに表示」 (rows with a sell signal always show).
const WATCH_ROWS = 3;
// Footnotes: in place at 1024px and wider, gathered into the screen's 注記 below that.
const TODAY_NOTE = '注目候補はすべてトレンドテンプレート8条件を満たす銘柄（TT 8/8）です。並び順：買いゾーン → ピボット接近（−5%以内）。同じ位置なら判定の達成数、RS推計の順。';
const DATE_JA = iso => { const d = new Date(`${iso}T12:00:00Z`); return Number.isFinite(d.getTime()) ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${'日月火水木金土'[d.getUTCDay()]}）` : '日付未確認'; };

/** Today: the three answers, the market card, the focus candidates and the watch list. */
export default function TodayView({ brief, watch, open, now, animate, onNear, wide }) {
  const focus = useMemo(() => focusCandidates(brief.ranked, brief.date), [brief.ranked, brief.date]);
  // The whole pool behind the five rows, so the summary never reads 「接近0」 while near-pivot stocks exist.
  const counts = useMemo(() => focusCounts(brief.ranked, brief.date), [brief.ranked, brief.date]);
  const groups = useMemo(() => leadingGroups(brief.ranked), [brief.ranked]);
  const headingNote = focusHeadingNote(brief.market);
  const phone = useMediaQuery(PHONE_QUERY);
  const watched = useMemo(() => (brief.bundle.data?.rankings?.minervini || []).filter(item => watch.includes(item.row.symbol)).map(item => candidateView(item, brief.date)).sort(briefOrder), [brief.bundle.data, watch, brief.date]);
  const sells = useWatchSellChecks(watched, brief);
  const state = bundleState(brief);
  // The first rows of the watch list, plus every row whose sell check fired or could not be made
  // (未確認, never folded away); the rest open in place and stay open for this session. Nothing folds
  // until every row's check is in, so a row with a signal never appears late from behind the button.
  const [watchAll, setWatchAll] = useSessionState('today-watch-all', false);
  const sellsIn = watched.every(view => sells[view.symbol]);
  const watchFolded = sellsIn ? watched.filter((view, i) => i < WATCH_ROWS || sells[view.symbol].hits > 0 || sells[view.symbol].unknown) : watched;
  const watchShown = watchAll ? watched : watchFolded, watchHidden = watched.length - watchFolded.length;
  return <>
    <header className="brief-hero is-today in" style={{ '--i': 0 }}><small className="numeric">{brief.date || '日付未確認'} 引け・米国株</small><h1>{brief.date ? `${DATE_JA(brief.date)}の判断` : '今日の判断'}</h1></header>
    <TodaySummary market={brief.market} marketLoading={brief.marketLoading} counts={counts} watched={watched} watchCount={watch.length} sells={sells} state={state} />
    <MarketCard market={brief.market} marketLoading={brief.marketLoading} trends={brief.trends} date={brief.date} />
    <section className="brief-card in" style={{ '--i': 2 }} aria-labelledby="brief-focus-title">
      <div className="brief-step"><span className="brief-step-no" aria-hidden="true">2</span><h2 id="brief-focus-title">注目候補{headingNote && <small>{headingNote}</small>}</h2><Link className="brief-more" to="/brief/list">すべての候補 <span aria-hidden="true">›</span></Link></div>
      {focus.length ? <ol className="brief-rows">{focus.map((view, i) => <CandidateRow key={view.symbol} view={view} rank={i + 1} index={i} onOpen={open} now={now} animate={animate} hideTemplate context={{ market: brief.market }} />)}</ol>
        : <p className="brief-note">{state === 'ready' ? '買いゾーンまたはピボット接近（−5%以内）の選定銘柄はありません。' : BUNDLE_TEXT[state]}</p>}
      {/* The count and the near-pivot link share one line where they fit, and wrap where they do not. The count
          is of the focus candidates (buy zone and near pivot), not of every selected stock. */}
      {(counts.total > focus.length || counts.near > 0) && <div className="brief-focusfoot">
        {counts.total > focus.length && <p className="brief-note">上位{focus.length}件を表示（注目候補 {counts.total}銘柄中）</p>}
        {counts.near > 0 && <Link className="brief-nearlink" to="/brief/list" onClick={event => { if (event.metaKey || event.ctrlKey) return; event.preventDefault(); onNear(); }}>ピボット接近 {counts.near}銘柄 <span aria-hidden="true">›</span></Link>}
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
      <div className="brief-step"><span className="brief-step-no" aria-hidden="true">3</span><h2 id="brief-watch-title">ウォッチの変化</h2></div>
      {watched.length ? <ul className="brief-rows" id="brief-watch-rows">{watchShown.map((view, i) => { const event = watchEvent(view); return <RiseItem key={view.symbol} animate={animate} index={i}>
        <button type="button" className="brief-event" onClick={e => open(view.symbol, e.currentTarget, 'watch')}>
          <span className={`brief-event-icon tone-${event.tone}`} aria-hidden="true">{event.kind === 'breakout' ? '↗' : event.kind === 'ext' ? '▲' : event.kind === 'near' ? '◔' : event.kind === 'zone' ? '●' : '≈'}</span>
          <span><b>{view.symbol}</b> {event.title}{sells[view.symbol]?.hits ? <span className="brief-chip tone-ext brief-sellchip"><span aria-hidden="true">▲</span> 売りのサイン {sells[view.symbol].hits}件</span> : sells[view.symbol]?.unknown ? <span className="brief-chip brief-sellchip" title={sells[view.symbol].reason || undefined}>売りのサイン 未確認</span> : null}<small>{finite(view.pivot) ? `ピボット ${money(view.pivot)}・ピボット比 ${signed(view.distance)}` : 'ピボット未確認'}{view.earnings && view.earnings.days <= 10 ? `・決算まで${view.earnings.days}日` : ''}</small></span>
          <span className="brief-chevron" aria-hidden="true">{ICON.next}</span>
        </button></RiseItem>; })}</ul>
        : <p className="brief-note">{state !== 'ready' && watch.length ? `ウォッチ中の${watch.length}銘柄は、${state === 'loading' ? '候補の読み込み後に確認します。' : '候補データがないため確認できません。'}` : '銘柄の画面で ☆ を押すと、ピボットへの接近や上抜けをここでお知らせします。'}</p>}
      {watchHidden > 0 && <button type="button" className="brief-morebutton" aria-expanded={watchAll} aria-controls="brief-watch-rows" onClick={() => setWatchAll(value => !value)}>{watchAll ? '表示を減らす' : `さらに表示（残り ${watchHidden}件）`}</button>}
    </section>
    <ScreenNotes id="today" wide={wide} notes={[TODAY_NOTE]} />
  </>;
}

/** Three answers first: can I buy, how many setups, does anything I watch need selling. */
function TodaySummary({ market, marketLoading, counts, watched, watchCount, sells, state }) {
  const tone = marketTone(market), focus = focusTone(state, counts, market);
  // The card below carries 独自判定; the summary keeps only the state (「50日線割れ（弱含み）」).
  const verdict = market?.label ? market.label.replace(/（(?:(.+)・)?独自判定）$/, (_, inner) => inner ? `（${inner}）` : '') : '市場未確認';
  const results = watched.map(view => sells[view.symbol]).filter(Boolean);
  const hits = results.reduce((sum, result) => sum + (result.hits || 0), 0);
  const unchecked = watched.length - results.filter(result => !result.unknown).length;
  // A watch list whose stocks cannot be looked up yet is not 未登録.
  const pendingWatch = state !== 'ready' && watchCount > 0;
  const watchValue = pendingWatch ? BUNDLE_SHORT[state] : !watched.length ? '未登録' : hits ? `${hits}件` : unchecked === watched.length ? '未確認' : '0件';
  const watchNote = pendingWatch ? `${watchCount}銘柄を登録` : !watched.length ? '☆で追加' : unchecked && unchecked < watched.length ? `未確認 ${unchecked}銘柄` : `${watched.length}銘柄を確認`;
  return <ul className="brief-summary in" style={{ '--i': 0 }} aria-label="今日の要点" data-testid="brief-summary">
    <li className={`tone-${tone}`}><small>地合い</small><b>{!market && marketLoading ? '読込中' : verdict}</b><em><Parts text={!market && marketLoading ? '' : market?.cap > 0 ? `買い可・最大${Math.round(market.cap * 100)}%` : market?.state === 'unknown' || !market ? '買いは見送り' : '買いは控える'} /></em></li>
    <li className={focus ? `tone-${focus}` : ''}><small>注目候補</small><b>{state === 'ready' ? `${counts.total}銘柄` : BUNDLE_SHORT[state]}</b><em><Parts text={state === 'ready' ? `ゾーン${counts.zone}・接近${counts.near}` : ''} /></em></li>
    <li className={hits ? 'tone-ext' : ''}><small>ウォッチの売り</small><b>{watchValue}</b><em>{watchNote}</em></li>
  </ul>;
}
