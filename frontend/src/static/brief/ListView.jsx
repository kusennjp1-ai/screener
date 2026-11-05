import { useMemo, useState } from 'react';
import useMediaQuery from '../useMediaQuery';
import { candidateView, LIST_FILTERS, LIST_SORTS, matchesSearch } from './briefCandidate';
import { CandidateRow } from './BriefParts';
import { ScreenNotes } from './briefPrimitives';
import { PHONE_QUERY } from './briefNav';
import { bundleState, BUNDLE_TEXT, unlistedWatch, useWatchSellChecks } from './useBriefData';

// A phone (520px and narrower, where rows are compacted) lists this many rows per 「さらに表示」;
// wider screens list 50.
const PHONE_PAGE = 20;
const LIST_NOTE = '選定銘柄＝トレンドテンプレート8条件と日足の整合性をすべて満たす銘柄。あと1条件＝未達が1つだけで未確認がない銘柄（流動性：株価$10以上・売買代金$2,000万以上）。';
// What a hidden filter (reached from Today's tile, never a segment button) covers, for its dismissible chip.
const HIDDEN_FILTER_TEXT = { focus: '注目候補（ゾーン＋接近）' };
const DEFAULT_FILTER = 'zone';

/** Every view a list screen can show, before its filter. */
// eslint-disable-next-line react-refresh/only-export-components -- the stock pane steps through the same rows
export function listSource(brief, kind, watch) {
  const source = kind === 'watch' ? (brief.bundle.data?.rankings?.minervini || []).filter(item => watch.includes(item.row.symbol))
    : brief.ranked.filter(item => item.assessment?.qualified || (item.assessment?.failed === 1 && item.assessment?.unknown === 0));
  return source.map(item => candidateView(item, brief.date));
}
/** Exactly the rows a list screen shows, in its order; prev/next and swipe follow the same sequence. */
// eslint-disable-next-line react-refresh/only-export-components -- the stock pane steps through the same rows
export function listShown(views, kind, { filter, sort, query }) {
  return views.filter(kind === 'watch' ? () => true : (LIST_FILTERS[filter] || LIST_FILTERS[DEFAULT_FILTER]).test).filter(view => matchesSearch(view, query)).sort(LIST_SORTS[sort].compare);
}
/**
 * Watch rows in their list order, with the rows whose weakness check fired first. Nothing moves until
 * every row's check is in, so a row never jumps while the checks load.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Today and the stock pane order the watch rows the same way
export function watchOrder(views, sells) {
  if (!views.every(view => sells?.[view.symbol])) return views;
  const flagged = view => sells[view.symbol].weaknessHits > 0;
  return [...views.filter(flagged), ...views.filter(view => !flagged(view))];
}

/** A watched symbol this publication does not list: said with its reason, never dropped, with a 44px 外す. */
export function UnlistedWatchRow({ symbol, date, onRemove }) {
  return <li className="brief-unlisted" data-unlisted={symbol}>
    <p><b>{symbol}</b>：この公開（<span className="numeric">{date || '日付未確認'}</span> 引け）の分析対象に含まれていません（上場廃止・ティッカー変更・データ欠落など）。売りのサイン・位置は未確認</p>
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
  const counts = useMemo(() => Object.fromEntries(Object.entries(LIST_FILTERS).map(([key, value]) => [key, views.filter(value.test).length])), [views]);
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
  return <>
    <header className="brief-hero in" style={{ '--i': 0 }}><small className="numeric">{brief.date || '日付未確認'} 引け</small><h1>{kind === 'watch' ? 'ウォッチ' : '候補'}</h1></header>
    {kind !== 'watch' && <div className="brief-filters">
      <div className="brief-seg" role="group" aria-label="絞り込み">{Object.entries(LIST_FILTERS).filter(([, value]) => !value.hidden).map(([key, value]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => { update({ filter: key }); restart(); }}>{value.label}<span className="numeric">{state === 'ready' ? counts[key] : '—'}</span></button>)}</div>
      {/* A hidden filter (Today's 注目候補 tile) is said as a chip that clears it, only while it is on. */}
      {hidden && <button type="button" className="brief-filterchip" onClick={() => { update({ filter: DEFAULT_FILTER }); restart(); }}>
        {HIDDEN_FILTER_TEXT[hidden] || LIST_FILTERS[hidden].label}<span className="numeric">{state === 'ready' ? counts[hidden] : '—'}</span><span aria-hidden="true">×</span><span className="sr-only">（絞り込みを解除）</span>
      </button>}
      <label className="brief-search"><span className="sr-only">銘柄を検索</span><input type="search" inputMode="search" placeholder="ティッカー・社名" value={query} onChange={e => { update({ query: e.target.value }); restart(); }} /></label>
      <label className="brief-sort">並び順<select value={listState.sort} onChange={e => update({ sort: e.target.value })}>{Object.entries(LIST_SORTS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
    </div>}
    <section className={`brief-card in${kind === 'watch' ? ' brief-watchlist' : ''}`} style={{ '--i': 1 }} aria-label={kind === 'watch' ? 'ウォッチ中の銘柄' : '選定銘柄の一覧'}>
      {ordered.length || unlisted.length ? <ol className="brief-rows">
        {unlisted.map(symbol => <UnlistedWatchRow key={symbol} symbol={symbol} date={brief.date} onRemove={onUnwatch} />)}
        {ordered.slice(0, limit).map((view, i) => <CandidateRow key={view.symbol} view={view} rank={kind === 'watch' ? null : i + 1} index={Math.min(i, 12)} onOpen={open} now={now} animate={animate} sell={sells[view.symbol]} hideTemplate={constantTemplate} context={{ market: brief.market }} />)}
      </ol>
        : <p className="brief-note">{state !== 'ready' ? BUNDLE_TEXT[state] : kind === 'watch' ? '銘柄の画面で ☆ を押すと、ここに並びます。' : 'この条件の選定銘柄はありません。'}</p>}
      {ordered.length > limit && <button type="button" className="brief-morebutton" onClick={() => setLimit(limit + pageSize)}>さらに表示（残り {ordered.length - limit}件）</button>}
      {kind !== 'watch' && wide && <p className="brief-note">{LIST_NOTE}</p>}
    </section>
    {kind !== 'watch' && <ScreenNotes id="list" wide={wide} notes={[LIST_NOTE,
      phone ? '買いゾーン・ピボット接近・選定すべての行はすべてTT 8/8のため、スマホでは「TT 8/8」の表示を省いています（あと1条件では未達・未確認の数を表示します）。' : null]} />}
  </>;
}
