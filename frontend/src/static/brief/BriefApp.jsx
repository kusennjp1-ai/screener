import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import useMediaQuery from '../useMediaQuery';
import { ColorModeContext } from '../../contexts/ColorModeContext';
import { palettes, themeCss } from '../theme/tokens';
import '../theme/foundation.css';
import './brief.css';
// Each round-1 track's overrides of brief.css, in this fixed order. A later file wins a tie only against
// foundation.css, brief.css and the files above it: component stylesheets that load later (the lazy market
// chunk's marketHistoryExplorer, marketUpdateStatus and metricDisclosure CSS) need a more specific selector.
import './brief-chart.css';
import './brief-market-history.css';
import './brief-fundamentals.css';
import './brief-decision.css';
import './brief-plan.css';
import './brief-watch.css';
import { useBriefData, useWatchlist, useWatchSellChecks } from './useBriefData';
import { candidateView, focusCandidates } from './briefCandidate';
import TodayView from './TodayView';
import ListView, { listShown, listSource, watchOrder } from './ListView';
import StockScreen from './StockScreen';
import { BarQuote } from './BriefParts';
import { Toast } from './briefPrimitives';
import { ICON } from './briefIcons';
import { useTransitionNavigate } from './briefNav';

// The market tab (long-run chart, sector ranks) is its own chunk: Today does not download or parse it.
// It is fetched once the first screen is idle, so a tap on 市場 rarely waits for it.
const loadMarketScreen = () => import('./MarketScreen');
const MarketScreen = lazy(loadMarketScreen);

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
  // The watch list steps in the order its screen shows: rows whose weakness check fired first.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const watchViews = useMemo(() => (from === 'watch' ? listShown(listSource(brief, 'watch', watch), 'watch', listState) : null), [from, brief.bundle.data, brief.date, watch, listState]);
  const watchSells = useWatchSellChecks(watchViews, brief);
  const sequence = useMemo(() => (from === 'today' || from === 'market' ? focusCandidates(brief.ranked, brief.date) : from === 'watch' ? watchOrder(watchViews, watchSells) : listShown(listSource(brief, from, watch), from, listState)).map(v => v.symbol),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [from, brief.bundle.data, brief.ranked, brief.date, watch, listState, watchViews, watchSells]);
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
  // Today's links: a list with a filter and no search (「ピボット接近 N銘柄」 near, 「すべての候補」 all, the
  // 注目候補 tile the hidden focus filter), the market tab and the watch tab.
  const showList = useCallback(filter => { setListState(state => ({ ...state, filter, query: '' })); setListLimits(state => ({ ...state, list: undefined })); go('/brief/list', { kind: 'tab' }); }, [go]);
  const todayNav = useMemo(() => ({ list: showList, market: () => go('/brief/market', { kind: 'tab' }), watch: () => go('/brief/watch', { kind: 'tab' }) }), [go, showList]);
  useEffect(() => {
    const idle = window.requestIdleCallback ? window.requestIdleCallback(() => loadMarketScreen().catch(() => {}), { timeout: 4000 }) : setTimeout(() => loadMarketScreen().catch(() => {}), 1500);
    return () => (window.cancelIdleCallback ? window.cancelIdleCallback(idle) : clearTimeout(idle));
  }, []);
  const left = from === 'today' ? <TodayView brief={brief} watch={watch} open={open} now={now} animate={animate} wide={wide} nav={todayNav} onUnwatch={toggleWatch} />
    : from === 'market' ? <Suspense fallback={<p className="brief-note" role="status">市場の画面を読み込み中…</p>}><MarketScreen brief={brief} /></Suspense> : <ListView brief={brief} kind={from} watch={watch} open={open} now={now} animate={animate} listState={listState} setListState={setListState} limits={listLimits} setLimits={setListLimits} origin={kept} wide={wide} onUnwatch={toggleWatch} />;
  const watching = symbol && watch.includes(symbol);
  return <div className="leader-shell brief" data-theme={dark ? 'dark' : 'light'}>
    <style>{themeCss}</style>
    <a className="brief-skip" href="#brief-main" onClick={event => { event.preventDefault(); document.getElementById('brief-main')?.focus(); }}>メインコンテンツへ</a>
    <header className="brief-bar">
      {view === 'stock' && !wide ? <>
        <button type="button" className="brief-iconbutton" aria-label="戻る" onClick={() => go(from === 'today' ? '/brief' : `/brief/${from}`, { kind: 'back' })}>{ICON.back}</button>
        <div className="brief-bar-title"><b><span style={{ viewTransitionName: 'brief-ticker' }}>{symbol}</span><BarQuote view={barView} /></b><span>{barView ? `${barView.name}${barView.sector ? `・${barView.sector}` : ''}` : brief.bundle.data ? '分析対象外' : '読み込み中…'}</span></div>
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
