import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import useMediaQuery from '../useMediaQuery';
import { money } from '../positionGeometry';
import { BASE_CAUTION_NOTE, BASE_UNCHECKED_NOTE, baseMuted, briefOrder, earningsCall, focusCandidates, focusCounts, focusHeadingNote, focusTone, memoCandidateView, pivotDistanceText, rowSecChipDrawn, watchEvent } from './briefCandidate';
import { leadingGroups, marketTileNote, marketTileSuffix, marketTone } from './briefEnvironment';
import { EARNINGS_CHIP_NOTE, fundamentalsCoverageWarning, publishedFundamentalsCoverage } from '../fundamentalsExplain.js';
import { isBreakdown, sellChipView } from './briefSell';
import MarketCard from './MarketCard';
import { CandidateRow } from './BriefParts';
import { Parts, RiseItem, ScreenNotes } from './briefPrimitives';
import { ICON } from './briefIcons';
import { barDay, PHONE_QUERY } from './briefNav';
import { bundleState, BUNDLE_SHORT, BUNDLE_TEXT, unlistedWatch, useWatchSellChecks } from './useBriefData';
import { UnlistedWatchRow, watchOrder } from './ListView';
import useSessionState from './useSessionState';

const finite = Number.isFinite;
// Today's watch card shows this many rows before 「さらに表示」, symbols the publication does not list (always shown,
// first) counting as one of them at most; rows with a sell chip or the day's breakout or heavy down day always show.
const WATCH_ROWS = 3;
const ALWAYS_SHOWN = ['breakout', 'heavyDown'];
// Footnotes: in place at 1024px and wider, gathered into the screen's 注記 below that.
const TODAY_NOTE = '注目候補はすべてトレンドテンプレート8条件を満たす銘柄（TT 8/8）です。並び順：買いゾーン → ピボット接近（−5%以内）。買いゾーンの中は、その日の上抜け → ピボット到達・上抜け日 未確認・出来高の裏付けのない上抜け → 上抜け後（当日未検証を含む） → 下落日の大商いの順で、同じならRS線の新高値（公開値）、RS推計の順。';
const DATE_JA = iso => { const d = new Date(`${iso}T12:00:00Z`); return Number.isFinite(d.getTime()) ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${'日月火水木金土'[d.getUTCDay()]}）` : '日付未確認'; };
// A failed breakout is a weakness: the 崩れ glyph (▲), as the chart marks it (▼ there is 上昇の加速).
const EVENT_ICON = { breakout: '↗', ext: '▲', heavyDown: '▲', near: '◔', zone: '●', ma50: '↘', book: '▲', failedBreakout: '▲' };
// A broken setup leads its watch row (never the day's position event, which could be green): the 50-day hit's
// own headline, or the book's combined warning by name.
const BOOK_HEADLINE = '書籍の複合警告（20日線割れ・安値切り下げ・大商い）';
const brokenEvent = sell => {
  const broke = sell?.weakness?.find(isBreakdown);
  return broke ? { kind: broke.key, tone: 'ext', title: broke.headline || (broke.key === 'book' ? BOOK_HEADLINE : broke.detail) } : null;
};
// A stale pivot far below the price reads as extended (▲); one above it keeps the neutral mark.
const eventIcon = event => event.kind === 'stale' && event.tone === 'ext' ? '▲' : EVENT_ICON[event.kind] || '≈';
/** A plain click on a link runs the in-app handler; a modified click keeps the browser's own behaviour. */
const follow = handler => event => { if (event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); handler(event); };

/**
 * A watch row's sell chip, from the same sellChipView as the list rows and the stock conclusion: the row's
 * short form on screen, the full sentence for assistive tech when the two differ.
 */
function SellChip({ sell }) {
  const chip = sellChipView(sell);
  if (!chip) return null;
  const glyph = chip.tone === 'ext' && <><span aria-hidden="true">▲</span> </>;
  return <span className={`brief-chip${chip.tone ? ` tone-${chip.tone}` : ''} brief-sellchip`} title={chip.title}>{glyph}{chip.full && chip.full !== chip.text ? <><span aria-hidden="true">{chip.text}</span><span className="sr-only">{chip.full}</span></> : chip.text}</span>;
}

/**
 * The watch tile of Today's summary: what needs attention among the watched stocks. Only a broken setup
 * counts (the 50-day check or the book's warning fired), because no holding is registered; 0件 only when
 * every check of every watched stock is in. Unlisted, unchecked and partly checked stocks are said, never
 * counted as checked. The note is short (n/N), because the tile is a third of the width.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the tile's wording is tested on its own
export function watchAttention({ state, watched, watchCount, unlisted, sells }) {
  if (state !== 'ready') return watchCount > 0 ? { value: BUNDLE_SHORT[state], note: `${watchCount}銘柄を登録`, flagged: [] } : { value: '未登録', note: '☆で追加', flagged: [] };
  const total = watched.length + unlisted.length;
  if (!total) return { value: '未登録', note: '☆で追加', flagged: [] };
  const results = watched.map(view => sells[view.symbol]);
  const flagged = watched.filter(view => sells[view.symbol]?.breakdownHits > 0).map(view => view.symbol);
  // A result with a weakness check left unknown and nothing broken is only partly checked.
  const partial = results.filter(result => result && !result.unknown && !(result.breakdownHits > 0) && result.unknowns > 0).length;
  const pending = results.filter(result => !result).length;
  const checked = results.filter(result => result && !result.unknown).length - partial;
  const limited = results.filter(result => result?.unknown && result.limit), unknown = results.filter(result => result?.unknown && !result.limit).length;
  const unsure = limited.length + unknown + partial + unlisted.length;
  const value = flagged.length ? `${flagged.length}件` : pending ? '確認中' : unsure ? '未確認' : '0件';
  const parts = pending ? [`${total}銘柄を確認中`] : [unsure ? `${checked}/${total}を確認` : `${checked}銘柄を確認`,
    unlisted.length ? `対象外${unlisted.length}` : null,
    limited.length ? `上限超${limited.length}` : null,
    unknown ? `未確認${unknown}` : null,
    partial ? `一部未確認${partial}` : null];
  return { value, note: [...parts, '保有未登録'].filter(Boolean).join('・'), flagged };
}

/**
 * Today: the three answers, the market card, the focus candidates and the watch list. `nav` holds the
 * moves the summary tiles and links make: market(), list(filter) and watch(); `onUnwatch` removes a symbol.
 */
export default function TodayView({ brief, watch, open, now, animate, wide, nav, onUnwatch, ageNote = null }) {
  const focus = useMemo(() => focusCandidates(brief.ranked, brief.date, 5, brief.bundle.data), [brief.ranked, brief.date, brief.bundle.data]);
  // The whole pool behind the five rows, so the summary never reads 「接近0」 while near-pivot stocks exist.
  const counts = useMemo(() => focusCounts(brief.ranked, brief.date, brief.bundle.data), [brief.ranked, brief.date, brief.bundle.data]);
  const groups = useMemo(() => leadingGroups(brief.ranked), [brief.ranked]);
  const phone = useMediaQuery(PHONE_QUERY);
  const watched = useMemo(() => (brief.bundle.data?.rankings?.minervini || []).filter(item => watch.includes(item.row.symbol)).map(item => memoCandidateView(item, brief.date, brief.bundle.data)).sort(briefOrder), [brief.bundle.data, watch, brief.date]);
  const unlisted = useMemo(() => unlistedWatch(brief, watch), [brief, watch]);
  const sells = useWatchSellChecks(watched, brief);
  const state = bundleState(brief);
  // A ready bundle without a market verdict says so after the heading (the verdict comes with the bundle).
  const headingNote = focusHeadingNote(brief.market, state);
  // The publication's SEC coverage (the manifest's block, for this date only) and its one-line warning, or none.
  const coverage = useMemo(() => publishedFundamentalsCoverage(brief.manifest?.data?.markets?.US ?? null, { bundle: brief.bundle.data ?? null }), [brief.manifest?.data, brief.bundle.data]);
  const coverageWarning = fundamentalsCoverageWarning(coverage, { date: brief.date });
  const tileInput = { market: brief.market, trends: brief.trends, manifest: brief.manifest?.data ?? null };
  // The market track's suffix (「NAS調整中」) and, while it shows, its explanation (marketTileNote) for the tile's title and
  // assistive tech; the notes (the phone's 注記, in place under the market card from 1024px) lead with the tile's word.
  const tileSuffix = marketTileSuffix(tileInput), tileNote = tileSuffix ? marketTileNote(tileInput) : null;
  const tileLine = tileNote ? `${tileSuffix}：${tileNote}` : null;
  // The first rows of the watch list, plus every row with a sell chip (a fired check, a caution or 未確認,
  // never folded away); the rest open in place and stay open for this session. Nothing folds or moves
  // until every row's check is in, so a row with a signal never appears late from behind the button.
  const [watchAll, setWatchAll] = useSessionState('today-watch-all', false);
  const sellsIn = watched.every(view => sells[view.symbol]);
  // A watched stock whose sell checks are still loading holds its green (no chip, no layout change) on the focus row and
  // the watch card alike, so a broken setup never reads as a buy first and flips to 崩れ when its check lands.
  const pending = symbol => watch.includes(symbol) && !sells[symbol];
  const ordered = watchOrder(watched, sells);
  const room = WATCH_ROWS - Math.min(unlisted.length, 1);
  const events = useMemo(() => Object.fromEntries(watched.map(view => {
    const event = brokenEvent(sells[view.symbol]) || watchEvent(view, brief.market);
    return [view.symbol, !sells[view.symbol] && event.tone === 'zone' ? { ...event, tone: 'neutral' } : event];
  })), [watched, sells, brief.market]);
  const watchFolded = sellsIn ? ordered.filter((view, i) => i < room || sellChipView(sells[view.symbol]) || ALWAYS_SHOWN.includes(events[view.symbol].kind)) : ordered;
  const watchShown = watchAll ? ordered : watchFolded, watchHidden = ordered.length - watchFolded.length;
  // A focus row with the questionable-base chip or a notable SEC chip: its rule (独自判定・独自設定) is said with Today's notes too,
  // and a grey row for a base that is not current (土台未確認 in its RS chip's place) says why the row is grey.
  const baseNote = focus.some(view => view.baseCaution) ? BASE_CAUTION_NOTE : null;
  // Only while a focus row draws the chip (rowSecChipDrawn: a phone's compact rows draw no notable rise).
  const earningsNote = focus.some(view => rowSecChipDrawn(view, { compact: phone, sellTone: sellChipView(sells[view.symbol] ?? null)?.tone ?? null })) ? EARNINGS_CHIP_NOTE : null;
  const uncheckedNote = focus.some(view => baseMuted(view) && sellChipView(sells[view.symbol])?.tone !== 'ext') ? BASE_UNCHECKED_NOTE : null;
  return <>
    <header className="brief-hero is-today in" style={{ '--i': 0 }}><small className="numeric">{brief.date ? `${barDay(brief.date)}引け・米国株` : '日付未確認'}</small><h1>{brief.date ? `${DATE_JA(brief.date)}の判断` : '今日の判断'}</h1></header>
    <TodaySummary market={brief.market} marketLoading={brief.marketLoading} suffix={tileSuffix} suffixNote={tileNote} counts={counts} attention={watchAttention({ state, watched, watchCount: watch.length, unlisted, sells })} state={state} nav={nav} open={open} date={brief.date} />
    <MarketCard market={brief.market} marketLoading={brief.marketLoading} trends={brief.trends} date={brief.date} />
    {/* From 1024px the notes are in place: the tile's 「NAS調整中」 is explained under the market card it summarises. */}
    {wide && tileLine && <p className="brief-note brief-tile-note">{tileLine}</p>}
    {/* Under the market card (the stack gap above it is cancelled in brief-watch.css): on a phone one line, the seam's
        short form when it gives one (the full sentence in its title and the notes); wider, the full sentence. */}
    {coverageWarning && <p className="brief-note brief-coverage-note" title={phone && coverageWarning.short ? coverageWarning.text : undefined}>{phone ? coverageWarning.short || coverageWarning.text : coverageWarning.text}</p>}
    <section className="brief-card in" style={{ '--i': 2 }} aria-labelledby="brief-focus-title">
      <div className="brief-step"><span className="brief-step-no" aria-hidden="true">2</span><h2 id="brief-focus-title">注目候補{headingNote && <small>{headingNote}</small>}</h2><Link className="brief-more" to="/brief/list" onClick={follow(() => nav.list('all'))}>すべての候補 <span aria-hidden="true">›</span></Link></div>
      {/* A watched focus row carries its sell checks (the watch card's), so a broken setup or a failed breakout reads the
          same ▲崩れ there, without green, as on the watch card and the 候補・ウォッチ tabs. */}
      {focus.length ? <ol className="brief-rows">{focus.map((view, i) => <CandidateRow key={view.symbol} view={view} rank={i + 1} index={i} onOpen={open} now={now} animate={animate} hideTemplate compact={phone} market={brief.market} sell={sells[view.symbol] ?? null} pending={pending(view.symbol)} />)}</ol>
        : <p className="brief-note">{state === 'ready' ? '買いゾーンまたはピボット接近（−5%以内）の選定銘柄はありません。' : BUNDLE_TEXT[state]}</p>}
      {/* The count and the near-pivot link share one line where they fit, and wrap where they do not; from a 375px
          phone up the count takes two lines beside the link, breaking before its parenthesis (brief-watch.css). The
          count is of the focus candidates (buy zone and near pivot), not of every selected stock. */}
      {(counts.total > focus.length || counts.near > 0) && <div className="brief-focusfoot">
        {counts.total > focus.length && <p className="brief-note"><span className="brief-frag">上位{focus.length}件を表示</span><span className="brief-frag">（注目候補 {counts.total}銘柄中）</span></p>}
        {counts.near > 0 && <Link className="brief-nearlink" to="/brief/list" onClick={follow(() => nav.list('near'))}>ピボット接近 {counts.near}銘柄 <span aria-hidden="true">›</span></Link>}
      </div>}
      {/* The label carries the denominator and the 未確認 count, so they are never scrolled away. On a phone
          the chips are one line that scrolls sideways (its fading edge says more follows), focusable for the keyboard. */}
      {groups?.groups.length > 0 && <div className="brief-groups" data-testid="brief-groups">
        <span className="brief-groups-label">選定銘柄の多い{groups.kind}<span className="brief-note">（選定 {groups.total}銘柄中{groups.unnamed ? `・${groups.kind}未確認 ${groups.unnamed}` : ''}）</span></span>
        <span className="brief-groups-chips" role="group" aria-label={`選定銘柄の多い${groups.kind}`} tabIndex={phone ? 0 : undefined}>{groups.groups.map(g => <span key={g.name} className="brief-chip">{g.name}：<b className="numeric">{g.count}</b>銘柄</span>)}</span>
      </div>}
      {wide && <p className="brief-note">{TODAY_NOTE}{[uncheckedNote, baseNote, earningsNote].filter(Boolean).map(note => ` ${note}`).join('')}</p>}
    </section>
    <section className="brief-card in" style={{ '--i': 3 }} aria-labelledby="brief-watch-title">
      {/* The rows are each stock's state today, not a difference from the previous publication. */}
      <div className="brief-step"><span className="brief-step-no" aria-hidden="true">3</span><h2 id="brief-watch-title">ウォッチの状況</h2></div>
      {watched.length || unlisted.length ? <ul className="brief-rows" id="brief-watch-rows">
        {unlisted.map(symbol => <UnlistedWatchRow key={symbol} symbol={symbol} date={brief.date} onRemove={onUnwatch} />)}
        {watchShown.map((view, i) => { const event = events[view.symbol], earnings = earningsCall(view, now); return <RiseItem key={view.symbol} animate={animate} index={i}>
          <button type="button" className="brief-event" data-symbol={view.symbol} onClick={e => open(view.symbol, e.currentTarget, 'watch')}>
            <span className={`brief-event-icon tone-${event.tone}`} aria-hidden="true">{eventIcon(event)}</span>
            <span><b>{view.symbol}</b> {event.title}<SellChip sell={sells[view.symbol]} /><small>{finite(view.pivot) ? `ピボット ${money(view.pivot)}・ピボット比 ${pivotDistanceText(view)}` : 'ピボット未確認'}{earnings?.soon ? `・${earnings.chip}` : ''}</small></span>
            <span className="brief-chevron" aria-hidden="true">{ICON.next}</span>
          </button></RiseItem>; })}</ul>
        : <p className="brief-note">{state !== 'ready' && watch.length ? `ウォッチ中の${watch.length}銘柄は、${state === 'loading' ? '候補の読み込み後に確認します。' : '候補データがないため確認できません。'}` : '銘柄の画面で ☆ を押すと、ピボットへの接近や上抜けをここでお知らせします。'}</p>}
      {watchHidden > 0 && <button type="button" className="brief-morebutton" aria-expanded={watchAll} aria-controls="brief-watch-rows" onClick={() => setWatchAll(value => !value)}>{watchAll ? '表示を減らす' : `さらに表示（残り ${watchHidden}件）`}</button>}
    </section>
    {/* A late publication (or one whose age is unknown) says so in full in the notes too, as does a phone's coverage
        line (one line there); the bar carries the short form. */}
    <ScreenNotes id="today" wide={wide} notes={[ageNote, phone ? coverageWarning?.text || null : null, tileLine, TODAY_NOTE, uncheckedNote, baseNote, earningsNote]} />
  </>;
}

/**
 * Three answers first: can I buy, how many setups, does anything I watch need attention. Each tile is a
 * link to where its answer is explained: the market tab, the focus pool as a list, the flagged stock (or
 * the watch tab, flagged rows first).
 */
function TodaySummary({ market, marketLoading, suffix = null, suffixNote = null, counts, attention, state, nav, open, date = null }) {
  const tone = marketTone(market), focus = focusTone(state, counts, market);
  // The card below carries 独自判定; the summary keeps only the state (「50日線割れ（弱含み）」).
  const verdict = market?.label ? market.label.replace(/（(?:(.+)・)?独自判定）$/, (_, inner) => inner ? `（${inner}）` : '') : '市場未確認';
  const one = attention.flagged.length === 1 ? attention.flagged[0] : null;
  const capNote = market?.cap > 0 ? `目安≤${Math.round(market.cap * 100)}%` : market?.state === 'unknown' || !market ? '買いは見送り' : '買いは控える';
  const marketNote = !market && marketLoading ? '' : market?.cap > 0 ? `検討可・${capNote}` : capNote;
  // With the market track's suffix (「NAS調整中」, 「FTD確認済み」), the note keeps its two lines on a phone: the cap
  // and then the suffix on a line of its own (「検討可」 is what the tile's tone and the cap already say).
  const showSuffix = Boolean(suffix) && !(!market && marketLoading);
  // Each tile is as of the analysis date: said to assistive tech after the tile's text (the bar shows it on screen).
  const asOf = date ? <span className="sr-only">・{barDay(date)}引け時点</span> : null;
  const breakouts = state === 'ready' && counts?.breakout > 0 ? counts.breakout : 0;
  return <ul className="brief-summary in" style={{ '--i': 0 }} aria-label="今日の要点" data-testid="brief-summary">
    <li className={`tone-${tone}`}><Link className="brief-tile" to="/brief/market" title={showSuffix && suffixNote ? suffixNote : undefined} onClick={follow(() => nav.market())}><small>地合い</small><b>{!market && marketLoading ? '読込中' : verdict}</b><em>{showSuffix ? <><Parts text={capNote} /><span className="sr-only">・</span><span className="brief-frag brief-tile-suffix">{suffix}</span>{suffixNote && <span className="sr-only">（{suffixNote}）</span>}</> : <Parts text={marketNote} />}</em>{asOf}</Link></li>
    <li className={`${focus ? `tone-${focus}` : ''}${breakouts ? ' has-sub' : ''}`}><Link className="brief-tile" to="/brief/list" onClick={follow(() => nav.list('focus'))}><small>注目候補</small><b>{state === 'ready' ? `${counts.total}銘柄` : BUNDLE_SHORT[state]}</b><em><Parts text={state === 'ready' ? `ゾーン${counts.zone}・接近${counts.near}` : ''} /></em>{asOf}</Link>
      {/* The day's breakouts among them: a link of its own in a strip under the tile's text (the tile keeps the strip's
          height free, so neither covers the other), breaking only after 「うち」. */}
      {breakouts > 0 && <Link className="brief-tile-sub" to="/brief/list" data-testid="brief-breakout-link" onClick={follow(() => nav.list('breakout'))}><span>うち<span className="brief-nowrap">上抜け{breakouts}<span aria-hidden="true"> ›</span></span></span></Link>}</li>
    <li className={attention.flagged.length ? 'tone-ext' : ''}><Link className="brief-tile" to={one ? `/brief/stock/${encodeURIComponent(one)}` : '/brief/watch'} onClick={follow(event => (one ? open(one, event.currentTarget, 'watch') : nav.watch()))}>
      <small>ウォッチの注意</small><b>{attention.value}</b><em><Parts text={attention.note} /></em>{asOf}</Link></li>
  </ul>;
}
