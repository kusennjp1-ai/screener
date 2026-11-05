import { useMemo, useState } from 'react';
import useMediaQuery from '../useMediaQuery';
import { candidateView, LIST_FILTERS, LIST_SORTS, matchesSearch } from './briefCandidate';
import { CandidateRow, ScreenNotes } from './BriefParts';
import { PHONE_QUERY } from './briefNav';
import { bundleState, BUNDLE_TEXT, useWatchSellChecks } from './useBriefData';

// A phone (520px and narrower, where rows are compacted) lists this many rows per 「さらに表示」;
// wider screens list 50.
const PHONE_PAGE = 20;
const LIST_NOTE = '選定銘柄＝トレンドテンプレート8条件と日足の整合性をすべて満たす銘柄。あと1条件＝未達が1つだけで未確認がない銘柄（流動性：株価$10以上・売買代金$2,000万以上）。';

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
  return views.filter(kind === 'watch' ? () => true : LIST_FILTERS[filter].test).filter(view => matchesSearch(view, query)).sort(LIST_SORTS[sort].compare);
}

export default function ListView({ brief, kind, watch, open, now, animate, listState, setListState, limits, setLimits, origin, wide }) {
  const phone = useMediaQuery(PHONE_QUERY);
  const pageSize = phone ? PHONE_PAGE : 50;
  const { filter, sort, query } = listState;
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
  const state = bundleState(brief);
  return <>
    <header className="brief-hero in" style={{ '--i': 0 }}><small className="numeric">{brief.date || '日付未確認'} 引け</small><h1>{kind === 'watch' ? 'ウォッチ' : '候補'}</h1></header>
    {kind !== 'watch' && <div className="brief-filters">
      <div className="brief-seg" role="group" aria-label="絞り込み">{Object.entries(LIST_FILTERS).filter(([, value]) => !value.hidden).map(([key, value]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => { update({ filter: key }); restart(); }}>{value.label}<span className="numeric">{state === 'ready' ? counts[key] : '—'}</span></button>)}</div>
      <label className="brief-search"><span className="sr-only">銘柄を検索</span><input type="search" inputMode="search" placeholder="ティッカー・社名" value={query} onChange={e => { update({ query: e.target.value }); restart(); }} /></label>
      <label className="brief-sort">並び順<select value={sort} onChange={e => update({ sort: e.target.value })}>{Object.entries(LIST_SORTS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
    </div>}
    <section className="brief-card in" style={{ '--i': 1 }} aria-label={kind === 'watch' ? 'ウォッチ中の銘柄' : '選定銘柄の一覧'}>
      {shown.length ? <ol className="brief-rows">{shown.slice(0, limit).map((view, i) => <CandidateRow key={view.symbol} view={view} rank={kind === 'watch' ? null : i + 1} index={Math.min(i, 12)} onOpen={open} now={now} animate={animate} sell={sells[view.symbol]} hideTemplate={constantTemplate} context={{ market: brief.market }} />)}</ol>
        : <p className="brief-note">{state !== 'ready' ? BUNDLE_TEXT[state] : kind === 'watch' ? '銘柄の画面で ☆ を押すと、ここに並びます。' : 'この条件の選定銘柄はありません。'}</p>}
      {shown.length > limit && <button type="button" className="brief-morebutton" onClick={() => setLimit(limit + pageSize)}>さらに表示（残り {shown.length - limit}件）</button>}
      {kind !== 'watch' && wide && <p className="brief-note">{LIST_NOTE}</p>}
    </section>
    {kind !== 'watch' && <ScreenNotes id="list" wide={wide} notes={[LIST_NOTE,
      phone ? '買いゾーン・ピボット接近・選定すべての行はすべてTT 8/8のため、スマホでは「TT 8/8」の表示を省いています（あと1条件では未達・未確認の数を表示します）。' : null]} />}
  </>;
}
