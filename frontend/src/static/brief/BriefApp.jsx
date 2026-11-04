import { lazy, memo, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import useMediaQuery from '../useMediaQuery';
import { ColorModeContext } from '../../contexts/ColorModeContext';
import { palettes, themeCss } from '../theme/tokens';
import { money, signed } from '../positionGeometry';
import '../theme/foundation.css';
import './brief.css';
import { useBriefData, useStockData, useWatchlist, useWatchSellChecks } from './useBriefData';
import { candidateView, focusCandidates, focusCounts, leadingGroups, marketTone, LIST_FILTERS, LIST_SORTS, briefOrder, matchesSearch, watchEvent } from './briefModel';
import MarketCard from './MarketCard';
import StockView from './StockView';
import { CandidateRow, Parts, RiseItem, ScreenNotes, Toast } from './BriefParts';
import useSessionState from './useSessionState';
import { useTransitionNavigate } from './briefNav';

// The market tab (long-run chart, sector ranks) is its own chunk: Today does not download or parse it.
// It is fetched once the first screen is idle, so a tap on 市場 rarely waits for it.
const loadMarketScreen = () => import('./MarketScreen');
const MarketScreen = lazy(loadMarketScreen);

const ICON = {
  today: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>,
  list: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>,
  star: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" /></svg>,
  starOn: <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" /></svg>,
  market: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19h16" /><path d="m5 15 4.5-5 3.5 3 6-7" /></svg>,
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>,
  next: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>,
  sun: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></svg>,
  moon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>,
};
const finite = Number.isFinite;
/** Where the research bundle stands before anything is counted from it: never a 0 for missing data. */
const bundleState = brief => brief.bundle.data ? 'ready' : brief.bundle.isLoading || brief.manifest.isLoading ? 'loading' : brief.bundle.isError || brief.manifest.isError ? 'error' : 'none';
const BUNDLE_TEXT = { loading: '候補を読み込み中…', error: '候補データを取得できません。', none: '候補データはこの公開に含まれていません。' };
const BUNDLE_SHORT = { loading: '読込中', error: '取得できません', none: '未配信' };
// A phone (520px and narrower, where rows are compacted) lists this many rows per 「さらに表示」;
// wider screens list 50.
const PHONE_PAGE = 20;
const PHONE_QUERY = '(max-width:520px)';
// Today's watch card shows this many rows before 「さらに表示」 (rows with a sell signal always show).
const WATCH_ROWS = 3;
// Footnotes: in place at 1024px and wider, gathered into the screen's 注記 below that.
const TODAY_NOTE = '注目候補はすべてトレンドテンプレート8条件を満たす銘柄（TT 8/8）です。並び順：買いゾーン → ピボット接近（−5%以内）。同じ位置なら判定の達成数、RS推計の順。';
const LIST_NOTE = '選定銘柄＝トレンドテンプレート8条件と日足の整合性をすべて満たす銘柄。あと1条件＝未達が1つだけで未確認がない銘柄（流動性：株価$10以上・売買代金$2,000万以上）。';
const DATE_JA = iso => { const d = new Date(`${iso}T12:00:00Z`); return Number.isFinite(d.getTime()) ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${'日月火水木金土'[d.getUTCDay()]}）` : '日付未確認'; };

function ThemeToggle() {
  const colorMode = useContext(ColorModeContext), dark = colorMode.mode === 'dark';
  return <button type="button" className="brief-iconbutton" onClick={colorMode.toggleColorMode} aria-label={dark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}>{dark ? ICON.sun : ICON.moon}</button>;
}

function Tabs({ current, watchCount, go }) {
  const tab = (key, to, icon, label, extra = null) => <Link key={key} to={to} aria-current={current === key ? 'page' : undefined} onClick={event => { if (event.metaKey || event.ctrlKey) return; event.preventDefault(); if (current !== key) go(to, { kind: 'tab' }); }}>
    {current === key && <span className="brief-tabpill" aria-hidden="true" />}{icon}<span>{label}</span>{extra}</Link>;
  return <nav className="brief-dock brief-tabs" aria-label="ブリーフの画面">
    {tab('today', '/brief', ICON.today, '今日')}{tab('list', '/brief/list', ICON.list, '候補')}
    {tab('watch', '/brief/watch', ICON.star, 'ウォッチ', watchCount ? <span className="brief-count" aria-label={`${watchCount}件`}>{watchCount}</span> : null)}
    {tab('market', '/brief/market', ICON.market, '市場')}
  </nav>;
}

function TodayView({ brief, watch, open, now, animate, onNear, wide }) {
  const focus = useMemo(() => focusCandidates(brief.ranked, brief.date), [brief.ranked, brief.date]);
  // The whole pool behind the five rows, so the summary never reads 「接近0」 while near-pivot stocks exist.
  const counts = useMemo(() => focusCounts(brief.ranked, brief.date), [brief.ranked, brief.date]);
  const groups = useMemo(() => leadingGroups(brief.ranked), [brief.ranked]);
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
      <div className="brief-step"><span className="brief-step-no" aria-hidden="true">2</span><h2 id="brief-focus-title">注目候補</h2><Link className="brief-more" to="/brief/list">すべての候補 <span aria-hidden="true">›</span></Link></div>
      {focus.length ? <ol className="brief-rows">{focus.map((view, i) => <CandidateRow key={view.symbol} view={view} rank={i + 1} index={i} onOpen={open} now={now} animate={animate} hideTemplate />)}</ol>
        : <p className="brief-note">{state === 'ready' ? '買いゾーンまたはピボット接近（−5%以内）の選定銘柄はありません。' : BUNDLE_TEXT[state]}</p>}
      {/* The count and the near-pivot link share one line where they fit (they wrap on a 320px phone). */}
      {(counts.total > focus.length || counts.near > 0) && <div className="brief-focusfoot">
        {counts.total > focus.length && <p className="brief-note">上位{focus.length}件を表示（全{counts.total}銘柄）</p>}
        {counts.near > 0 && <Link className="brief-nearlink" to="/brief/list" onClick={event => { if (event.metaKey || event.ctrlKey) return; event.preventDefault(); onNear(); }}>ピボット接近 {counts.near}銘柄 <span aria-hidden="true">›</span></Link>}
      </div>}
      {/* Phone: one line that scrolls sideways (its fading edge says more follows); focusable for the keyboard. */}
      {groups?.groups.length > 0 && <div className="brief-groups" data-testid="brief-groups" role="group" aria-label={`選定銘柄の多い${groups.kind}`} tabIndex={0}><span>選定銘柄の多い{groups.kind}</span>{groups.groups.map(g => <span key={g.name} className="brief-chip">{g.name}：<b className="numeric">{g.count}</b>銘柄</span>)}<span className="brief-note">（選定 {groups.total}銘柄中{groups.unnamed ? `・${groups.kind}未確認 ${groups.unnamed}` : ''}）</span></div>}
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
  const tone = marketTone(market);
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
    <li className={state === 'ready' && counts.total ? 'tone-zone' : ''}><small>注目候補</small><b>{state === 'ready' ? `${counts.total}銘柄` : BUNDLE_SHORT[state]}</b><em><Parts text={state === 'ready' ? `ゾーン${counts.zone}・接近${counts.near}` : ''} /></em></li>
    <li className={hits ? 'tone-ext' : ''}><small>ウォッチの売り</small><b>{watchValue}</b><em>{watchNote}</em></li>
  </ul>;
}

/** Every view a list screen can show, before its filter. */
function listSource(brief, kind, watch) {
  const source = kind === 'watch' ? (brief.bundle.data?.rankings?.minervini || []).filter(item => watch.includes(item.row.symbol))
    : brief.ranked.filter(item => item.assessment?.qualified || (item.assessment?.failed === 1 && item.assessment?.unknown === 0));
  return source.map(item => candidateView(item, brief.date));
}
/** Exactly the rows a list screen shows, in its order; prev/next and swipe follow the same sequence. */
function listShown(views, kind, { filter, sort, query }) {
  return views.filter(kind === 'watch' ? () => true : LIST_FILTERS[filter].test).filter(view => matchesSearch(view, query)).sort(LIST_SORTS[sort].compare);
}

function ListView({ brief, kind, watch, open, now, animate, listState, setListState, limits, setLimits, origin, wide }) {
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
      <div className="brief-seg" role="group" aria-label="絞り込み">{Object.entries(LIST_FILTERS).map(([key, value]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => { update({ filter: key }); restart(); }}>{value.label}<span className="numeric">{state === 'ready' ? counts[key] : '—'}</span></button>)}</div>
      <label className="brief-search"><span className="sr-only">銘柄を検索</span><input type="search" inputMode="search" placeholder="ティッカー・社名" value={query} onChange={e => { update({ query: e.target.value }); restart(); }} /></label>
      <label className="brief-sort">並び順<select value={sort} onChange={e => update({ sort: e.target.value })}>{Object.entries(LIST_SORTS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
    </div>}
    <section className="brief-card in" style={{ '--i': 1 }} aria-label={kind === 'watch' ? 'ウォッチ中の銘柄' : '選定銘柄の一覧'}>
      {shown.length ? <ol className="brief-rows">{shown.slice(0, limit).map((view, i) => <CandidateRow key={view.symbol} view={view} rank={kind === 'watch' ? null : i + 1} index={Math.min(i, 12)} onOpen={open} now={now} animate={animate} sell={sells[view.symbol]} hideTemplate={constantTemplate} />)}</ol>
        : <p className="brief-note">{state !== 'ready' ? BUNDLE_TEXT[state] : kind === 'watch' ? '銘柄の画面で ☆ を押すと、ここに並びます。' : 'この条件の選定銘柄はありません。'}</p>}
      {shown.length > limit && <button type="button" className="brief-morebutton" onClick={() => setLimit(limit + pageSize)}>さらに表示（残り {shown.length - limit}件）</button>}
      {kind !== 'watch' && wide && <p className="brief-note">{LIST_NOTE}</p>}
    </section>
    {kind !== 'watch' && <ScreenNotes id="list" wide={wide} notes={[LIST_NOTE,
      phone ? '買いゾーン・ピボット接近・選定すべての行はすべてTT 8/8のため、スマホでは「TT 8/8」の表示を省いています（あと1条件では未達・未確認の数を表示します）。' : null]} />}
  </>;
}

/** Memoized: a desktop tab switch must not re-render the stock pane when its stock is unchanged. */
const StockScreen = memo(function StockScreen({ brief, symbol, watch, onToggleWatch, step, wide }) {
  const data = useStockData(symbol, brief);
  if (!brief.bundle.data) return <p className="brief-note brief-pad" role="status">候補を読み込み中…</p>;
  if (!data.item) return <p className="brief-note brief-pad">{symbol} は分析対象に含まれていません。</p>;
  const on = watch.includes(symbol);
  const last = data.bars?.at(-1), prev = data.bars?.at(-2);
  const change = last && prev ? (last.close / prev.close - 1) * 100 : null;
  const header = wide ? <div className="brief-stockhead">
    <h2><span>{symbol}</span> <span className="numeric">{money(data.view?.price)}</span> {finite(change) && <span className={`numeric ${change >= 0 ? 'is-up' : 'is-down'}`}>{signed(change)}</span>}</h2>
    <span className="brief-note">{data.view?.name}{data.view?.sector ? `・${data.view.sector}` : ''}</span>
    <span className="brief-stockhead-actions"><button type="button" className={`brief-iconbutton${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={on ? 'ウォッチから外す' : 'ウォッチに追加'} onClick={event => onToggleWatch(symbol, event.currentTarget)}>{on ? ICON.starOn : ICON.star}</button>
      <button type="button" className="brief-iconbutton" aria-label="前の候補" onClick={() => step(-1)}>{ICON.back}</button><button type="button" className="brief-iconbutton" aria-label="次の候補" onClick={() => step(1)}>{ICON.next}</button></span>
  </div> : null;
  return <StockView key={symbol} data={data} header={header} wide={Boolean(wide)} />;
});

export default function BriefApp() {
  const brief = useBriefData();
  const { watch, toggle, storageError } = useWatchlist();
  const location = useLocation();
  const wide = useMediaQuery('(min-width:1024px)');
  const go = useTransitionNavigate();
  const dark = useContext(ColorModeContext).mode === 'dark';
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    // The phone's browser bar and status area take the top bar's colour instead of a fixed blue.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', palettes[dark ? 'dark' : 'light'].ground);
  }, [dark]);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const path = location.pathname.replace(/\/+$/, '');
  const stockMatch = path.match(/^\/brief\/stock\/([^/]+)$/);
  const symbol = stockMatch ? decodeURIComponent(stockMatch[1]).toUpperCase() : null;
  const from = location.state?.from || (path === '/brief/list' ? 'list' : path === '/brief/watch' ? 'watch' : path === '/brief/market' ? 'market' : 'today');
  const view = symbol ? 'stock' : from;
  const now = brief.bundle.evaluatedNow ?? Date.now();
  // Rows play their entrance when a screen opens with its data (a tab switch) and on later list
  // changes; rows that mount because the data arrived after the screen opened appear at once.
  // Decided in render from the previous render's view, so the first rows of a new screen already
  // know; once the rows that came with the data are committed, the screen animates list changes again.
  const loaded = Boolean(brief.bundle.data);
  const [entrance, setEntrance] = useState({ view, loaded });
  if (entrance.view !== view) setEntrance({ view, loaded });
  const animate = entrance.view === view ? entrance.loaded : loaded;
  useEffect(() => { if (loaded && entrance.view === view && !entrance.loaded) setEntrance({ view, loaded: true }); }, [loaded, entrance, view]);
  const [listState, setListState] = useState({ filter: 'zone', sort: 'priority', query: '' });
  // How many rows each list (候補, ウォッチ) shows; reset when its filter or search changes.
  const [listLimits, setListLimits] = useState({});
  const sequence = useMemo(() => (from === 'today' || from === 'market' ? focusCandidates(brief.ranked, brief.date) : listShown(listSource(brief, from, watch), from, listState)).map(v => v.symbol),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [from, brief.bundle.data, brief.ranked, brief.date, watch, listState]);
  // Desktop keeps the stock pane on the same stock across tab switches while that stock is in
  // the new list, so switching tabs does not redraw a different chart.
  const [kept, setKept] = useState(null);
  const selected = symbol || (wide && view !== 'market' ? (kept && sequence.includes(kept) ? kept : sequence[0] || null) : null);
  useEffect(() => { if (selected) setKept(selected); }, [selected]);
  const open = useCallback((ticker, trigger, origin = from) => {
    document.querySelectorAll('.brief-row-title b').forEach(element => { element.style.viewTransitionName = ''; });
    const title = trigger?.querySelector?.('.brief-row-title b');
    go(`/brief/stock/${encodeURIComponent(ticker)}`, { kind: wide ? 'pane' : 'forward', state: { from: origin }, before: () => { if (title && !wide) title.style.viewTransitionName = 'brief-ticker'; } });
  }, [go, from, wide]);
  const step = useCallback(direction => {
    if (!sequence.length || !selected) return;
    const at = sequence.indexOf(selected), next = at < 0 ? sequence[direction > 0 ? 0 : sequence.length - 1] : sequence[(at + direction + sequence.length) % sequence.length];
    if (next && next !== selected) go(`/brief/stock/${encodeURIComponent(next)}`, { kind: direction > 0 ? 'next' : 'prev', state: { from }, replace: true });
  }, [sequence, selected, go, from]);
  // Stable identities for the memoized stock pane: the step handler reads the latest sequence
  // through a ref, and the pane's brief changes only with the inputs the pane reads.
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; }, [step]);
  const paneStep = useCallback(direction => stepRef.current(direction), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const paneBrief = useMemo(() => brief, [brief.manifest.data, brief.bundle.data, brief.bundle.evaluatedNow, brief.version, brief.date]);
  const toggleWatch = useCallback((ticker, button) => {
    const added = toggle(ticker);
    button?.classList.remove('is-popping'); void button?.offsetWidth; button?.classList.add('is-popping');
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text: added ? `${ticker} をウォッチに追加しました` : `${ticker} をウォッチから外しました`, ticker });
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, [toggle]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    if (!selected) return undefined;
    const key = event => { if (event.target.closest?.('input, select, textarea')) return; if (event.key === 'ArrowRight' || event.key === 'j') { event.preventDefault(); step(1); } else if (event.key === 'ArrowLeft' || event.key === 'k') { event.preventDefault(); step(-1); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [selected, step]);
  // Phone: swipe left/right on the stock screen (not on the chart, which scrubs).
  const swipe = useRef(null);
  const onPointerDown = event => { if (wide || view !== 'stock' || event.pointerType === 'mouse' || event.target.closest('.brief-chart, input, select, button, a')) return; swipe.current = { x: event.clientX, y: event.clientY, dx: 0, on: false, el: event.currentTarget }; };
  const onPointerMove = event => {
    const s = swipe.current; if (!s) return;
    s.dx = event.clientX - s.x; const dy = event.clientY - s.y;
    if (!s.on) { if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(s.dx)) { swipe.current = null; return; } if (Math.abs(s.dx) > 12) s.on = true; else return; }
    s.el.style.transition = 'none'; s.el.style.transform = `translateX(${s.dx * 0.85}px)`; s.el.style.opacity = String(1 - Math.min(0.5, Math.abs(s.dx) / 600));
  };
  const onPointerUp = () => {
    const s = swipe.current; swipe.current = null; if (!s?.on) return;
    s.el.style.transition = ''; s.el.style.transform = ''; s.el.style.opacity = '';
    if (Math.abs(s.dx) > 80) step(s.dx < 0 ? 1 : -1);
  };
  const barView = useMemo(() => { const item = symbol && (brief.bundle.data?.rankings?.minervini || []).find(r => r.row.symbol === symbol); return item ? candidateView(item, brief.date) : null; }, [symbol, brief.bundle.data, brief.date]);
  // Today's 「ピボット接近 N銘柄」: the candidate list with the near-pivot filter and no search.
  const showNear = useCallback(() => { setListState(state => ({ ...state, filter: 'near', query: '' })); setListLimits(state => ({ ...state, list: undefined })); go('/brief/list', { kind: 'tab' }); }, [go]);
  useEffect(() => {
    const idle = window.requestIdleCallback ? window.requestIdleCallback(() => loadMarketScreen().catch(() => {}), { timeout: 4000 }) : setTimeout(() => loadMarketScreen().catch(() => {}), 1500);
    return () => (window.cancelIdleCallback ? window.cancelIdleCallback(idle) : clearTimeout(idle));
  }, []);
  const left = from === 'today' ? <TodayView brief={brief} watch={watch} open={open} now={now} animate={animate} onNear={showNear} wide={wide} />
    : from === 'market' ? <Suspense fallback={<p className="brief-note" role="status">市場の画面を読み込み中…</p>}><MarketScreen brief={brief} /></Suspense> : <ListView brief={brief} kind={from} watch={watch} open={open} now={now} animate={animate} listState={listState} setListState={setListState} limits={listLimits} setLimits={setListLimits} origin={kept} wide={wide} />;
  const watching = symbol && watch.includes(symbol);
  return <div className="leader-shell brief" data-theme={dark ? 'dark' : 'light'}>
    <style>{themeCss}</style>
    <a className="brief-skip" href="#brief-main" onClick={event => { event.preventDefault(); document.getElementById('brief-main')?.focus(); }}>メインコンテンツへ</a>
    <header className="brief-bar">
      {view === 'stock' && !wide ? <>
        <button type="button" className="brief-iconbutton" aria-label="戻る" onClick={() => go(from === 'today' ? '/brief' : `/brief/${from}`, { kind: 'back' })}>{ICON.back}</button>
        <div className="brief-bar-title"><b><span style={{ viewTransitionName: 'brief-ticker' }}>{symbol}</span>{barView?.price != null && <span className="numeric brief-bar-price"> {money(barView.price)}</span>}</b><span>{barView ? `${barView.name}${barView.sector ? `・${barView.sector}` : ''}` : brief.bundle.data ? '分析対象外' : '読み込み中…'}</span></div>
        <button type="button" className={`brief-iconbutton${watching ? ' is-on' : ''}`} aria-pressed={Boolean(watching)} aria-label={watching ? 'ウォッチから外す' : 'ウォッチに追加'} onClick={event => toggleWatch(symbol, event.currentTarget)}>{watching ? ICON.starOn : ICON.star}</button>
      </> : <>
        {/* The phone's Today hides the hero date, so the bar alone says a date that could not be read: 未確認, never 取得中 for good. */}
        <div className="brief-bar-title"><b>米国株スクリーナー</b><span className="numeric">分析基準日 {brief.date ? `${brief.date} 引け・米国株` : brief.manifest.isLoading || brief.bundle.isLoading ? '取得中' : '未確認'}</span></div>
      </>}
      <ThemeToggle />
    </header>
    {storageError && <p className="brief-alert brief-pad" role="alert">ウォッチを端末に保存できません。ブラウザの保存設定を確認してください。</p>}
    {wide ? view === 'market' ? <main id="brief-main" tabIndex={-1} className="brief-desk is-market">
      <div className="brief-left"><Tabs current={from} watchCount={watch.length} go={go} /><div className="brief-stack">{left}</div></div>
    </main> : <main id="brief-main" tabIndex={-1} className="brief-desk">
      <div className="brief-left"><Tabs current={from} watchCount={watch.length} go={go} /><div className="brief-stack">{left}</div></div>
      <div className="brief-right" aria-label="選択中の銘柄">{selected ? <StockScreen brief={paneBrief} symbol={selected} watch={watch} onToggleWatch={toggleWatch} step={paneStep} wide /> : <p className="brief-note brief-pad">銘柄を選ぶと、ここに結論とチャートを表示します。</p>}</div>
    </main> : <main id="brief-main" tabIndex={-1} className="brief-main" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <div className="brief-stack">{view === 'stock' ? <StockScreen brief={brief} symbol={symbol} watch={watch} onToggleWatch={toggleWatch} step={step} /> : left}</div>
    </main>}
    {!wide && (view === 'stock' ? <div className="brief-dock brief-actions">
      <button type="button" aria-label="前の候補" onClick={() => step(-1)}>{ICON.back}</button>
      <button type="button" className={`is-primary${watching ? ' is-on' : ''}`} aria-pressed={Boolean(watching)} onClick={event => toggleWatch(symbol, event.currentTarget)}>{watching ? ICON.starOn : ICON.star}{watching ? 'ウォッチ中' : 'ウォッチに追加'}</button>
      <button type="button" aria-label="次の候補" onClick={() => step(1)}>{ICON.next}</button>
    </div> : <Tabs current={from} watchCount={watch.length} go={go} />)}
    <Toast toast={toast} onUndo={toast ? () => { toggle(toast.ticker); setToast(null); } : null} />
  </div>;
}
