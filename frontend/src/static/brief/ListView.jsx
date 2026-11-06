import { useEffect, useMemo, useState } from 'react';
import useMediaQuery from '../useMediaQuery';
import { BASE_DEPTH_MAX_PERCENT, BASE_LENGTH_MIN_WEEKS, briefOrder, EPS_YOY_FILTER_PERCENT, EXTENDED_FROM_SMA50_PERCENT, filterCounts, filterLabel, LIST_FILTERS, LIST_SORTS, matchesSearch, memoCandidateView } from './briefCandidate';
import { CandidateRow } from './BriefParts';
import { ScreenNotes } from './briefPrimitives';
import { barDay, PHONE_QUERY } from './briefNav';
import { shortDate } from './briefShared';
import { bundleState, BUNDLE_TEXT, unlistedWatch, useWatchSellChecks } from './useBriefData';

// A phone (520px and narrower, where rows are compacted) lists this many rows per 「さらに表示」;
// wider screens list 50.
const PHONE_PAGE = 20;
// The desktop renders this many rows at once (more than a 900px-high window shows) and the rest of the page once
// the switch has painted: two frames, then REST_DELAY_MS, then the browser's next idle period. A tab switch
// paints the first screen first, and a click right after it is not held up by rows below the fold.
const FIRST_ROWS = 20;
const REST_DELAY_MS = 250;
const LIST_NOTE = '選定銘柄＝トレンドテンプレート8条件と日足の整合性をすべて満たす銘柄。あと1条件＝未達が1つだけで未確認がない銘柄（流動性：株価$10以上・売買代金$2,000万以上）。';
// The rows' base chip and the EPS filter: thresholds of the app's own (独自判定・独自設定).
const BASE_NOTE = `土台の注意：Setup Engineの土台が深さ${BASE_DEPTH_MAX_PERCENT}%超または${BASE_LENGTH_MIN_WEEKS}週未満、または終値が50日線より${EXTENDED_FROM_SMA50_PERCENT}%超上（独自判定）。EPS前年比≥${EPS_YOY_FILTER_PERCENT}%はSECの直近四半期の値による独自設定の絞り込みで、値のない銘柄は未確認として別に数えます。`;
// 選定すべて's population, said under the filters while it is on (the market tab's TT count is another population).
const ALL_POPULATION = '選定すべて：TT 8/8＋株価$10以上・売買代金$2,000万以上';
// What a hidden filter (reached from Today's tile or the 条件 menu, never a segment button) covers, for its dismissible chip.
const HIDDEN_FILTER_TEXT = { focus: '注目候補（ゾーン＋接近）' };
// The hidden filters the 条件 menu offers, in its order.
const CONDITION_FILTERS = ['breakout', 'eps'];
const DEFAULT_FILTER = 'zone';

/** Every view a list screen can show, before its filter. */
// eslint-disable-next-line react-refresh/only-export-components -- the stock pane steps through the same rows
export function listSource(brief, kind, watch) {
  const source = kind === 'watch' ? (brief.bundle.data?.rankings?.minervini || []).filter(item => watch.includes(item.row.symbol))
    : brief.ranked.filter(item => item.assessment?.qualified || (item.assessment?.failed === 1 && item.assessment?.unknown === 0));
  return source.map(item => memoCandidateView(item, brief.date, brief.bundle.data));
}
/**
 * Exactly the rows a list screen shows, in its order; prev/next and swipe follow the same sequence. The
 * watch list has no filter, search or sort control of its own, so the 候補 tab's never drop or reorder a
 * watched stock: every one is listed, in the order Today's watch card uses.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the stock pane steps through the same rows
export function listShown(views, kind, { filter, sort, query }) {
  if (kind === 'watch') return [...views].sort(briefOrder);
  return views.filter((LIST_FILTERS[filter] || LIST_FILTERS[DEFAULT_FILTER]).test).filter(view => matchesSearch(view, query)).sort(LIST_SORTS[sort].compare);
}
/**
 * Watch rows in their list order, with the broken setups (the 50-day check or the book's warning fired)
 * first. Nothing moves until every row's check is in, so a row never jumps while the checks load.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Today and the stock pane order the watch rows the same way
export function watchOrder(views, sells) {
  if (!views.every(view => sells?.[view.symbol])) return views;
  const flagged = view => sells[view.symbol].breakdownHits > 0;
  return [...views.filter(flagged), ...views.filter(view => !flagged(view))];
}

/** A watched symbol this publication does not list: said with its reason, never dropped, with a 44px 外す. */
export function UnlistedWatchRow({ symbol, date, onRemove }) {
  return <li className="brief-unlisted" data-unlisted={symbol}>
    <p><b>{symbol}</b>：この公開（{date ? <><span className="numeric">{shortDate(date, date)}</span>引け</> : '日付未確認'}）の分析対象外（上場廃止・ティッカー変更・データ欠落など）。売りのサイン・位置は未確認</p>
    <button type="button" onClick={event => onRemove?.(symbol, event.currentTarget)}>外す<span className="sr-only">（{symbol} をウォッチから外す）</span></button>
  </li>;
}

export default function ListView({ brief, kind, watch, open, now, animate, listState, setListState, limits, setLimits, origin, wide, onUnwatch }) {
  const phone = useMediaQuery(PHONE_QUERY);
  const pageSize = phone ? PHONE_PAGE : 50;
  const { filter, query } = listState;
  // Under a qualified-only filter every row is TT 8/8: a phone leaves the constant chip out (the 注記 says so),
  // which keeps each row's chips on one line. あと1条件 and the watch list keep it.
  const constantTemplate = phone && kind !== 'watch' && filter !== 'one';
  const update = patch => setListState(state => ({ ...state, ...patch }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const views = useMemo(() => listSource(brief, kind, watch), [brief.bundle.data, brief.ranked, brief.date, kind, watch]);
  // Every filter's count (and the EPS filter's 未確認) in one pass over the same rows.
  const tally = useMemo(() => filterCounts(views), [views]), counts = tally.counts;
  const shown = useMemo(() => listShown(views, kind, listState), [views, kind, listState]);
  // The rows shown are kept per list across a stock's round trip (BriefApp holds them). Coming back
  // from a stock, or after stepping past the last row shown, the stock last open is rendered too.
  // A new filter or search starts again from one page.
  const [floor, setFloor] = useState(() => { const at = origin ? shown.findIndex(view => view.symbol === origin) : -1; return { kind, rows: at >= 0 ? Math.ceil((at + 1) / pageSize) * pageSize : 0 }; });
  const limit = Math.max(limits[kind] ?? pageSize, floor.kind === kind ? floor.rows : 0);
  const setLimit = value => setLimits(state => ({ ...state, [kind]: value }));
  const restart = () => { setLimit(undefined); setFloor({ kind, rows: 0 }); };
  const sells = useWatchSellChecks(kind === 'watch' ? shown : null, brief);
  const ordered = useMemo(() => (kind === 'watch' ? watchOrder(shown, sells) : shown), [kind, shown, sells]);
  const unlisted = useMemo(() => (kind === 'watch' ? unlistedWatch(brief, watch) : []), [kind, brief, watch]);
  const state = bundleState(brief);
  const hidden = LIST_FILTERS[filter]?.hidden ? filter : null;
  // The desktop paints FIRST_ROWS rows first and the rest of the page once those are on screen (two frames, then
  // REST_DELAY_MS) and the browser is idle (each new list again), so a tab switch never waits for rows below the fold.
  const deferKey = `${kind}|${filter}|${query}|${listState.sort}|${brief.date}`;
  const [painted, setPainted] = useState(null);
  const defer = wide && painted !== deferKey;
  useEffect(() => {
    if (!wide) return undefined;
    let frame = null, idle = null, timer = null;
    const done = () => setPainted(deferKey);
    const whenIdle = () => { timer = null; if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(done, { timeout: 500 }); else timer = setTimeout(done, 50); };
    const later = () => { frame = null; timer = setTimeout(whenIdle, REST_DELAY_MS); };
    if (typeof window.requestAnimationFrame === 'function') frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(later); });
    else later();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (idle !== null) window.cancelIdleCallback(idle);
      if (timer !== null) clearTimeout(timer);
    };
  }, [wide, deferKey]);
  const rendered = defer ? Math.min(limit, FIRST_ROWS) : limit;
  const choose = key => { update({ filter: key }); restart(); };
  const countText = key => state !== 'ready' ? '—' : LIST_FILTERS[key].unknown ? `該当${counts[key]}・未確認${tally.unknown[key]}` : String(counts[key]);
  return <>
    <header className="brief-hero in" style={{ '--i': 0 }}><small className="numeric">{brief.date ? `${barDay(brief.date)}引け` : '日付未確認'}</small><h1>{kind === 'watch' ? 'ウォッチ' : '候補'}</h1></header>
    {kind !== 'watch' && <div className="brief-filters">
      <div className="brief-seg" role="group" aria-label="絞り込み">{Object.entries(LIST_FILTERS).filter(([, value]) => !value.hidden).map(([key, value]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => choose(key)}>{value.label}<span className="numeric">{state === 'ready' ? counts[key] : '—'}</span></button>)}</div>
      {/* A hidden filter (Today's tiles or the 条件 menu) is said as a chip that clears it, only while it is on. */}
      {hidden && <button type="button" className="brief-filterchip" onClick={() => choose(DEFAULT_FILTER)}>
        {HIDDEN_FILTER_TEXT[hidden] || filterLabel(hidden, brief.date)}<span className="numeric">{countText(hidden)}</span><span aria-hidden="true">×</span><span className="sr-only">（絞り込みを解除）</span>
      </button>}
      <label className="brief-search"><span className="sr-only">銘柄を検索</span><input type="search" inputMode="search" placeholder="銘柄・社名" value={query} onChange={e => { update({ query: e.target.value }); restart(); }} /></label>
      <label className="brief-sort"><span className="brief-sort-name">並び順</span><select value={listState.sort} onChange={e => update({ sort: e.target.value })}>{Object.entries(LIST_SORTS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
      {/* The hidden filters by name (the day's breakouts, the SEC EPS change): choosing one shows its chip. */}
      <label className="brief-sort brief-cond"><span className="brief-sort-name">条件</span><select value={CONDITION_FILTERS.includes(filter) ? filter : ''} onChange={e => choose(e.target.value || DEFAULT_FILTER)}>
        <option value="">条件：なし</option>
        {CONDITION_FILTERS.map(key => <option key={key} value={key}>{`${filterLabel(key, brief.date)}（${countText(key)}）`}</option>)}
      </select></label>
    </div>}
    {kind !== 'watch' && filter === 'all' && <p className="brief-note brief-population">{ALL_POPULATION}</p>}
    <section className={`brief-card in${kind === 'watch' ? ' brief-watchlist' : ''}`} style={{ '--i': 1 }} aria-label={kind === 'watch' ? 'ウォッチ中の銘柄' : '選定銘柄の一覧'}>
      {ordered.length || unlisted.length ? <ol className="brief-rows">
        {unlisted.map(symbol => <UnlistedWatchRow key={symbol} symbol={symbol} date={brief.date} onRemove={onUnwatch} />)}
        {ordered.slice(0, rendered).map((view, i) => <CandidateRow key={view.symbol} view={view} rank={kind === 'watch' ? null : i + 1} index={Math.min(i, 12)} onOpen={open} now={now} animate={animate} sell={sells[view.symbol]} hideTemplate={constantTemplate} context={{ market: brief.market }} />)}
      </ol>
        : <p className="brief-note">{state !== 'ready' ? BUNDLE_TEXT[state] : kind === 'watch' ? '銘柄の画面で ☆ を押すと、ここに並びます。' : 'この条件の選定銘柄はありません。'}</p>}
      {ordered.length > limit && <button type="button" className="brief-morebutton" onClick={() => setLimit(limit + pageSize)}>さらに表示（残り {ordered.length - limit}件）</button>}
      {kind !== 'watch' && wide && <p className="brief-note">{LIST_NOTE}</p>}
      {kind !== 'watch' && wide && <p className="brief-note">{BASE_NOTE}</p>}
    </section>
    {kind !== 'watch' && <ScreenNotes id="list" wide={wide} notes={[LIST_NOTE, BASE_NOTE,
      phone ? '買いゾーン・ピボット接近・選定すべての行はすべてTT 8/8のため、スマホでは「TT 8/8」の表示を省いています（あと1条件では未達・未確認の数を表示します）。' : null]} />}
  </>;
}
