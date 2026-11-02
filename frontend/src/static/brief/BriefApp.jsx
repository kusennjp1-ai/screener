import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMediaQuery, useTheme } from '@mui/material';
import { ColorModeContext } from '../../contexts/ColorModeContext';
import { themeCss } from '../theme/tokens';
import { money, signed } from '../positionGeometry';
import '../theme/foundation.css';
import './brief.css';
import { useBriefData, useStockData, useWatchlist, useWatchSellChecks } from './useBriefData';
import { readStartScreen, writeStartScreen } from './startScreen';
import { candidateView, focusCandidates, leadingGroups, marketTone, LIST_FILTERS, LIST_SORTS, briefOrder, matchesSearch, watchEvent } from './briefModel';
import MarketCard from './MarketCard';
import StockView from './StockView';
import { CandidateRow, Toast } from './BriefParts';
import { useTransitionNavigate } from './briefNav';

const ICON = {
  today: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2.5" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>,
  list: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>,
  star: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" /></svg>,
  starOn: <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" /></svg>,
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>,
  next: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>,
  sun: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></svg>,
  moon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>,
};
const finite = Number.isFinite;
const DATE_JA = iso => { const d = new Date(`${iso}T12:00:00Z`); return Number.isFinite(d.getTime()) ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${'日月火水木金土'[d.getUTCDay()]}）` : '日付未確認'; };

function ThemeToggle() {
  const dark = useTheme().palette.mode === 'dark', colorMode = useContext(ColorModeContext);
  return <button type="button" className="brief-iconbutton" onClick={colorMode.toggleColorMode} aria-label={dark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}>{dark ? ICON.sun : ICON.moon}</button>;
}

function Tabs({ current, watchCount, go }) {
  const tab = (key, to, icon, label, extra = null) => <Link key={key} to={to} aria-current={current === key ? 'page' : undefined} onClick={event => { if (event.metaKey || event.ctrlKey) return; event.preventDefault(); if (current !== key) go(to, { kind: 'tab' }); }}>
    {current === key && <span className="brief-tabpill" aria-hidden="true" />}{icon}<span>{label}</span>{extra}</Link>;
  return <nav className="brief-dock brief-tabs" aria-label="ブリーフの画面">
    {tab('today', '/brief', ICON.today, '今日')}{tab('list', '/brief/list', ICON.list, '候補')}
    {tab('watch', '/brief/watch', ICON.star, 'ウォッチ', watchCount ? <span className="brief-count" aria-label={`${watchCount}件`}>{watchCount}</span> : null)}
  </nav>;
}

function TodayView({ brief, watch, open, now, animate }) {
  const focus = useMemo(() => focusCandidates(brief.ranked, brief.date), [brief.ranked, brief.date]);
  const groups = useMemo(() => leadingGroups(brief.ranked), [brief.ranked]);
  const watched = useMemo(() => (brief.bundle.data?.rankings?.minervini || []).filter(item => watch.includes(item.row.symbol)).map(item => candidateView(item, brief.date)).sort(briefOrder), [brief.bundle.data, watch, brief.date]);
  const sells = useWatchSellChecks(watched, brief);
  return <>
    <header className="brief-hero in" style={{ '--i': 0 }}><small className="numeric">{brief.date || '日付未確認'} 引け・米国株</small><h1>{brief.date ? `${DATE_JA(brief.date)}の判断` : '今日の判断'}</h1></header>
    <TodaySummary market={brief.market} focus={focus} watched={watched} sells={sells} loading={brief.bundle.isLoading} />
    <MarketCard market={brief.market} trends={brief.trends} date={brief.date} />
    <section className="brief-card in" style={{ '--i': 2 }} aria-labelledby="brief-focus-title">
      <div className="brief-step"><span className="brief-step-no" aria-hidden="true">2</span><h2 id="brief-focus-title">注目候補</h2><Link className="brief-more" to="/brief/list">すべての候補 <span aria-hidden="true">›</span></Link></div>
      {focus.length ? <ol className="brief-rows">{focus.map((view, i) => <CandidateRow key={view.symbol} view={view} rank={i + 1} index={i} onOpen={open} now={now} animate={animate} />)}</ol>
        : <p className="brief-note">{brief.bundle.isLoading ? '候補を読み込み中…' : '買いゾーンまたはピボット接近（−5%以内）の選定銘柄はありません。'}</p>}
      {groups?.groups.length > 0 && <p className="brief-groups" data-testid="brief-groups"><span>選定銘柄の多い{groups.kind}</span>{groups.groups.map(g => <span key={g.name} className="brief-chip">{g.name}：<b className="numeric">{g.count}</b>銘柄</span>)}<span className="brief-note">（選定 {groups.total}銘柄中{groups.unnamed ? `・${groups.kind}未確認 ${groups.unnamed}` : ''}）</span></p>}
      <p className="brief-note">並び順：買いゾーン → ピボット接近（−5%以内）。同じ位置なら判定の達成数、RS推計の順。</p>
    </section>
    <section className="brief-card in" style={{ '--i': 3 }} aria-labelledby="brief-watch-title">
      <div className="brief-step"><span className="brief-step-no" aria-hidden="true">3</span><h2 id="brief-watch-title">ウォッチの変化</h2></div>
      {watched.length ? <ul className="brief-rows">{watched.map((view, i) => { const event = watchEvent(view); return <li key={view.symbol} className={animate ? 'in' : ''} style={{ '--i': i }}>
        <button type="button" className="brief-event" onClick={e => open(view.symbol, e.currentTarget, 'watch')}>
          <span className={`brief-event-icon tone-${event.tone}`} aria-hidden="true">{event.kind === 'breakout' ? '↗' : event.kind === 'ext' ? '▲' : event.kind === 'near' ? '◔' : event.kind === 'zone' ? '●' : '≈'}</span>
          <span><b>{view.symbol}</b> {event.title}{sells[view.symbol]?.hits ? <span className="brief-chip tone-ext brief-sellchip">▲ 売りのサイン {sells[view.symbol].hits}件</span> : sells[view.symbol]?.unknown ? <span className="brief-chip brief-sellchip" title={sells[view.symbol].reason || undefined}>売りのサイン 未確認</span> : null}<small>{finite(view.pivot) ? `ピボット ${money(view.pivot)}・ピボット比 ${signed(view.distance)}` : 'ピボット未確認'}{view.earnings && view.earnings.days <= 10 ? `・決算まで${view.earnings.days}日` : ''}</small></span>
          <span className="brief-chevron" aria-hidden="true">{ICON.next}</span>
        </button></li>; })}</ul>
        : <p className="brief-note">銘柄の画面で ☆ を押すと、ピボットへの接近や上抜けをここでお知らせします。</p>}
    </section>
    <StartScreenChoice />
  </>;
}

/** Three answers first: can I buy, how many setups, does anything I watch need selling. */
function TodaySummary({ market, focus, watched, sells, loading }) {
  const tone = marketTone(market);
  const verdict = market?.label ? market.label.replace(/（独自判定）$/, '') : '市場未確認';
  const zone = focus.filter(view => view.state === 'zone').length;
  const results = watched.map(view => sells[view.symbol]).filter(Boolean);
  const hits = results.reduce((sum, result) => sum + (result.hits || 0), 0);
  const unchecked = watched.length - results.filter(result => !result.unknown).length;
  const watchValue = !watched.length ? '未登録' : hits ? `${hits}件` : unchecked === watched.length ? '未確認' : '0件';
  const watchNote = !watched.length ? '☆で追加' : unchecked && unchecked < watched.length ? `未確認 ${unchecked}銘柄` : `${watched.length}銘柄を確認`;
  return <ul className="brief-summary in" style={{ '--i': 0 }} aria-label="今日の要点" data-testid="brief-summary">
    <li className={`tone-${tone}`}><small>地合い</small><b>{verdict}</b><em>{market?.cap > 0 ? `買い可・最大${Math.round(market.cap * 100)}%` : market?.state === 'unknown' || !market ? '買いは見送り' : '買いは控える'}</em></li>
    <li className={focus.length ? 'tone-zone' : ''}><small>注目候補</small><b>{loading ? '読込中' : `${focus.length}銘柄`}</b><em>{loading ? '' : `ゾーン${zone}・接近${focus.length - zone}`}</em></li>
    <li className={hits ? 'tone-ext' : ''}><small>ウォッチの売り</small><b>{watchValue}</b><em>{watchNote}</em></li>
  </ul>;
}

/** Per-viewer opt-in: open the app on this screen instead of the research workspace. */
function StartScreenChoice() {
  const [start, setStart] = useState(readStartScreen);
  const [failed, setFailed] = useState(false);
  return <label className="brief-start in" style={{ '--i': 4 }}>
    <input type="checkbox" checked={start === 'brief'} onChange={event => { const next = event.target.checked ? 'brief' : 'research'; const ok = writeStartScreen(next); setFailed(!ok); if (ok) setStart(next); }} />
    <span className="brief-start-box" aria-hidden="true">{start === 'brief' ? '✓' : ''}</span>
    <span>アプリを開いたらこの画面を表示<small>{failed ? 'このブラウザでは設定を保存できません。' : 'この端末のこのブラウザだけの設定です。従来の画面へは上の「従来の画面」から移れます。'}</small></span>
  </label>;
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

function ListView({ brief, kind, watch, open, now, animate, listState, setListState }) {
  const { filter, sort, query } = listState, [limit, setLimit] = useState(50);
  const update = patch => setListState(state => ({ ...state, ...patch }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const views = useMemo(() => listSource(brief, kind, watch), [brief.bundle.data, brief.ranked, brief.date, kind, watch]);
  const counts = useMemo(() => Object.fromEntries(Object.entries(LIST_FILTERS).map(([key, value]) => [key, views.filter(value.test).length])), [views]);
  const shown = useMemo(() => listShown(views, kind, listState), [views, kind, listState]);
  const sells = useWatchSellChecks(kind === 'watch' ? shown : null, brief);
  return <>
    <header className="brief-hero in" style={{ '--i': 0 }}><small className="numeric">{brief.date || '日付未確認'} 引け</small><h1>{kind === 'watch' ? 'ウォッチ' : '候補'}</h1></header>
    {kind !== 'watch' && <div className="brief-filters">
      <div className="brief-seg" role="group" aria-label="絞り込み">{Object.entries(LIST_FILTERS).map(([key, value]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => { update({ filter: key }); setLimit(50); }}>{value.label}<span className="numeric">{counts[key]}</span></button>)}</div>
      <label className="brief-search"><span className="sr-only">銘柄を検索</span><input type="search" inputMode="search" placeholder="ティッカー・社名" value={query} onChange={e => { update({ query: e.target.value }); setLimit(50); }} /></label>
      <label className="brief-sort">並び順<select value={sort} onChange={e => update({ sort: e.target.value })}>{Object.entries(LIST_SORTS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
    </div>}
    <section className="brief-card in" style={{ '--i': 1 }} aria-label={kind === 'watch' ? 'ウォッチ中の銘柄' : '選定銘柄の一覧'}>
      {shown.length ? <ol className="brief-rows">{shown.slice(0, limit).map((view, i) => <CandidateRow key={view.symbol} view={view} rank={kind === 'watch' ? null : i + 1} index={Math.min(i, 12)} onOpen={open} now={now} animate={animate} sell={sells[view.symbol]} />)}</ol>
        : <p className="brief-note">{brief.bundle.isLoading ? '候補を読み込み中…' : kind === 'watch' ? '銘柄の画面で ☆ を押すと、ここに並びます。' : 'この条件の選定銘柄はありません。'}</p>}
      {shown.length > limit && <button type="button" className="brief-morebutton" onClick={() => setLimit(limit + 50)}>さらに表示（残り {shown.length - limit}件）</button>}
      {kind !== 'watch' && <p className="brief-note">選定銘柄＝トレンドテンプレート8条件と日足の整合性をすべて満たす銘柄。あと1条件＝未達が1つだけで未確認がない銘柄（流動性：株価$10以上・売買代金$2,000万以上）。</p>}
    </section>
  </>;
}

function StockScreen({ brief, symbol, watch, onToggleWatch, step, wide }) {
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
  return <StockView key={symbol} data={data} header={header} />;
}

export default function BriefApp() {
  const brief = useBriefData();
  const { watch, toggle, storageError } = useWatchlist();
  const location = useLocation();
  const wide = useMediaQuery('(min-width:1024px)', { noSsr: true });
  const go = useTransitionNavigate();
  const dark = useTheme().palette.mode === 'dark';
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [animateKey, setAnimateKey] = useState(0);
  const path = location.pathname.replace(/\/+$/, '');
  const stockMatch = path.match(/^\/brief\/stock\/([^/]+)$/);
  const symbol = stockMatch ? decodeURIComponent(stockMatch[1]).toUpperCase() : null;
  const from = location.state?.from || (path === '/brief/list' ? 'list' : path === '/brief/watch' ? 'watch' : 'today');
  const view = symbol ? 'stock' : from;
  const now = brief.bundle.evaluatedNow ?? Date.now();
  useEffect(() => { setAnimateKey(k => k + 1); }, [view]);
  const [listState, setListState] = useState({ filter: 'zone', sort: 'priority', query: '' });
  const sequence = useMemo(() => (from === 'today' ? focusCandidates(brief.ranked, brief.date) : listShown(listSource(brief, from, watch), from, listState)).map(v => v.symbol),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [from, brief.bundle.data, brief.ranked, brief.date, watch, listState]);
  const selected = symbol || (wide ? sequence[0] || null : null);
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
  const animate = animateKey > 0;
  const barView = useMemo(() => { const item = symbol && (brief.bundle.data?.rankings?.minervini || []).find(r => r.row.symbol === symbol); return item ? candidateView(item, brief.date) : null; }, [symbol, brief.bundle.data, brief.date]);
  const left = from === 'today' ? <TodayView brief={brief} watch={watch} open={open} now={now} animate={animate} /> : <ListView brief={brief} kind={from} watch={watch} open={open} now={now} animate={animate} listState={listState} setListState={setListState} />;
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
        <div className="brief-bar-title"><b>米国株スクリーナー</b><span className="numeric">分析基準日 {brief.date || '取得中'}</span></div>
        <Link className="brief-classic" to="/">従来の画面</Link>
      </>}
      <ThemeToggle />
    </header>
    {storageError && <p className="brief-alert brief-pad" role="alert">ウォッチを端末に保存できません。ブラウザの保存設定を確認してください。</p>}
    {wide ? <main id="brief-main" tabIndex={-1} className="brief-desk">
      <div className="brief-left"><Tabs current={from} watchCount={watch.length} go={go} /><div className="brief-stack">{left}</div></div>
      <div className="brief-right" aria-label="選択中の銘柄">{selected ? <StockScreen brief={brief} symbol={selected} watch={watch} onToggleWatch={toggleWatch} step={step} wide /> : <p className="brief-note brief-pad">銘柄を選ぶと、ここに結論とチャートを表示します。</p>}</div>
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
