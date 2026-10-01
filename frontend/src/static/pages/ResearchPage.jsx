import ConnectionStatus from '../components/ConnectionStatus';
import { SECTORS } from '../sectorStrength';
import { useWorkbench } from '../useWorkbench';
import ResearchHero from '../components/ResearchHero';
import CandidatePerformance from '../components/CandidatePerformance';
import WatchNotifications from '../components/WatchNotifications';
import { filterRanked, sessionCurrent } from '../researchPresentation';
import { useCallback, useEffect, useDeferredValue, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, CircularProgress, FormControlLabel, Drawer, Stack, Switch, Typography } from '@mui/material';
import { fetchStaticJson, resolveStaticMarketEntry, useStaticManifest } from '../dataClient';
import { useStaticChartIndex } from '../chartClient';
import StaticChartViewerModal from '../StaticChartViewerModal';
import { compareReference, finite, quoteStatus, researchCsv, snapshotFreshness } from '../researchEngine';
import ResearchDetail from '../components/ResearchDetail';
import CandidateBoard from '../components/CandidateBoard';
import ResearchSearch from '../components/ResearchSearch';
import { entryReadiness } from '../entryReadiness';
import { buildPortfolioPlan, preparePortfolioRows } from '../portfolioPlan';
import { usePersonalQuote } from '../usePersonalQuote';
import { useResearchBundle } from '../useResearchBundle';
import { refreshResearchBundle } from '../researchWorkerClient';
import { prepareResearchBundle } from '../researchPreprocess';
import '../research.css';

const METHODS = { minervini: 'ミネルヴィニ', minervini2: '基本と原則', oneil: 'オニール / CAN SLIM', ibd: 'IBD型リーダー' };

export default function ResearchPage({compareOnly=false}) {
  const client = useQueryClient();
  const manifest = useStaticManifest();
  const entry = resolveStaticMarketEntry(manifest.data, 'US');
  const researchPath = entry.assets?.research?.path || entry.pages?.scan?.path;
  const version = manifest.data?.research_generation || manifest.data?.generated_at;
  const params=new URLSearchParams(window.location.hash.split('?')[1] || '');
  const [method, setMethod] = useState(()=>Object.hasOwn(METHODS,params.get('method'))?params.get('method'):'minervini');
  const [view,setView]=useState(()=>params.get('view')==='charts'?'charts':'list');
  const [sector,setSector]=useState(()=>params.get('sector') || '');
  const workbench=useWorkbench(entry);
  const [personalKey, setPersonalKey] = useState('');
  const [search, setSearch] = useState(() => params.get('symbol') || '');
  const [strict, setStrict] = useState(false);
  const [nearOnly, setNearOnly] = useState(false);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [coverage, setCoverage] = useState('all');
  const deferredSearch = useDeferredValue(search);
  useEffect(()=>{
    const searchEvent=e=>setSearch(e.detail||'');
    const backEvent=()=>setMobileView('list');
    const symbolEvent=()=>{
      const ticker=new URLSearchParams(window.location.hash.split('?')[1]||'').get('symbol');
      if(!ticker)return;
      setSymbol(ticker);setSearch(ticker);setLiquid(false);setCoverage('all');setStrict(false);setNearOnly(false);setOnlyWatch(false);setSector('');setView('list');setMobileView('detail');
      requestAnimationFrame(()=>detailRef.current?.scrollIntoView?.({block:'start'}));
    };
    window.addEventListener('research:search',searchEvent);window.addEventListener('research:back',backEvent);window.addEventListener('hashchange',symbolEvent);
    return()=>{window.removeEventListener('research:search',searchEvent);window.removeEventListener('research:back',backEvent);window.removeEventListener('hashchange',symbolEvent);};
  },[]);
  const [mobileView, setMobileView] = useState(() => params.get('symbol') ? 'detail' : 'list');
  const [liquid, setLiquid] = useState(() => !params.get('symbol'));
  const detailRef = useRef(null);
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [symbol, setSymbol] = useState(() => params.get('symbol') || null);
  const [chart, setChart] = useState(null);
  const [storageError, setStorageError] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState(null);
  const [verificationSymbol, setVerificationSymbol] = useState(null);
  const [watch, setWatch] = useState(() => {
    try { const value = JSON.parse(localStorage.getItem('research-watch') || '[]'); return Array.isArray(value) ? value.filter(s => typeof s === 'string') : []; } catch { return []; }
  });
  const bundle = useResearchBundle(researchPath, entry.as_of_date, version);
  const reference = useQuery({ queryKey: ['researchReference', version], queryFn: async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}ibd-reference.json`, { cache: 'no-cache' });
    return response.ok ? response.json() : null;
  }, retry: false });
  const rows = useMemo(() => bundle.data?.rows || [], [bundle.data]);
  const evaluated = useMemo(() => bundle.data?.rankings?.[method] || [], [method, bundle.data]);
  const ranked = useMemo(() => filterRanked(evaluated, { search: deferredSearch, qualifiedOnly: strict, nearOnly, watchlist: onlyWatch ? watch : null, liquidOnly: liquid, coverage, sector }), [evaluated, deferredSearch, strict, nearOnly, onlyWatch, watch, liquid, coverage, sector]);
  const coverageRows = useMemo(() => filterRanked(evaluated, {liquidOnly:liquid}), [evaluated, liquid]);
  const verifiedCount = coverageRows.filter(r => r.row.technical_audit?.valid === true).length;
  const navigationSymbols = useMemo(() => ranked.map(r => r.row.symbol), [ranked]);
  const radarRanked=useMemo(()=>filterRanked(bundle.data?.rankings?.minervini||[],{liquidOnly:liquid}),[bundle.data,liquid]);
  const availableSymbols = useMemo(() => new Set(rows.map(r => r.symbol)), [rows]);
  const selectedSummary = ranked.find(r => r.row.symbol === symbol)?.row || ranked[0]?.row;
  const detail = useQuery({queryKey:['researchDetail', selectedSummary?.research_detail_path, version],
    enabled:Boolean(selectedSummary?.research_detail_path && verificationSymbol === selectedSummary.symbol), staleTime:Infinity,
    queryFn:async () => {
      const value = await fetchStaticJson(selectedSummary.research_detail_path);
      if (value.symbol !== selectedSummary.symbol || value.as_of_date !== bundle.data?.date) throw Error('Detail identity mismatch');
      return value;
    }});
  const selected = useMemo(() => selectedSummary && detail.data?.symbol === selectedSummary.symbol && detail.data?.as_of_date === bundle.data?.date ? {...detail.data, ...selectedSummary, price_quality:{...detail.data.price_quality,...selectedSummary.price_quality}, setup_recalculation:{...detail.data.setup_recalculation,...selectedSummary.setup_recalculation}} : selectedSummary, [selectedSummary, detail.data, bundle.data?.date]);
  const embeddedCharts = useMemo(() => rows.some(r=>Object.hasOwn(r,'chart_path')) ? {symbols:rows.filter(r=>r.chart_path).map(r=>({symbol:r.symbol,path:r.chart_path}))} : null, [rows]);
  const fetchedIndex = useStaticChartIndex(entry.assets?.charts?.path, Boolean(bundle.data) && !embeddedCharts);
  const index = {data:embeddedCharts || fetchedIndex.data};
  const chartEntry = index.data?.symbols?.find(r => r.symbol === selected?.symbol);
  const endpoint = import.meta.env.VITE_RESEARCH_QUOTE_URL;
  const personal = usePersonalQuote(selected?.symbol, personalKey);
  const quote = useQuery({ queryKey: ['researchQuote', selected?.symbol], enabled: Boolean(endpoint && selected && !personalKey),
    placeholderData: () => undefined,
    queryFn: async () => {
      const url = new URL(endpoint); url.searchParams.set('symbol', selected.symbol);
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('価格配信に接続できません');
      const result = await response.json();
      if (result.symbol !== selected.symbol || !finite(result.price)) throw new Error('価格データが不正です');
      return result;
    }, refetchInterval: 15000, retry: 1,
  });
  const portfolioPrepared = useMemo(() => bundle.data?.prepared || preparePortfolioRows([]), [bundle.data]);
  const market = portfolioPrepared.market;
  const clockRows = useMemo(() => [...new Set([...portfolioPrepared.candidates,selected].filter(Boolean))], [portfolioPrepared,selected]);
  const clockSelector = useCallback(time => JSON.stringify([
    quoteStatus(personalKey ? personal.quote : quote.data,time),
    snapshotFreshness(bundle.data?.date || entry.as_of_date,time),
    sessionCurrent(rows,bundle.data?.date,time),
    time-Date.parse(manifest.data?.generated_at)>96*3600000,
    clockRows.map(row=>entryReadiness(row,bundle.data?.date,market,time).rules.map(r=>r.state)),
  ]),[personalKey,personal.quote,quote.data,bundle.data?.date,entry.as_of_date,rows,clockRows,market,manifest.data?.generated_at]);
  const clock = useQuery({ queryKey: ['researchClock'], queryFn: () => Date.now(), refetchInterval: 15000, initialData: Date.now, select:clockSelector });
  // Preserve clock checks but notify the page only when a decision actually changes.
  const now = useMemo(() => { void clock.data; void quote.data; void personal.quote; void selected; return Date.now(); }, [clock.data,quote.data,personal.quote,selected]);
  const portfolioPlan = useMemo(() => buildPortfolioPlan(rows, bundle.data?.date, 100000, now, portfolioPrepared), [rows, bundle.data?.date, now, portfolioPrepared]);
  const activeQuote = personalKey ? personal.quote : quote.data;
  const liveStatus = personalKey && personal.status !== '接続済み' ? personal.status : !personalKey && quote.isError ? '接続エラー' : quoteStatus(activeQuote, now);
  const usableQuote = ['リアルタイム', '遅延データ'].includes(liveStatus) ? activeQuote : null;
  const leaders = useMemo(() => filterRanked(bundle.data?.rankings?.ibd || [], { liquidOnly: true, qualifiedOnly: true }).slice(0, 50).map(r => r.row), [bundle.data]);
  const overlap = compareReference(leaders, reference.data, bundle.data?.date);
  const age = now - Date.parse(manifest.data?.generated_at);
  const currentSession = sessionCurrent(rows, bundle.data?.date, now);
  const stale = !currentSession && (!Number.isFinite(age) || age > 96 * 3600000);
  const freshness = snapshotFreshness(bundle.data?.date || entry.as_of_date, now);
  const toggleWatch = useCallback((ticker) => {
    const next = watch.includes(ticker) ? watch.filter(s => s !== ticker) : [...watch, ticker];
    setWatch(next);
    try { localStorage.setItem('research-watch', JSON.stringify(next)); } catch { setStorageError(true); }
  }, [watch]);
  function inspectOrder(ticker) {
    setMethod('minervini'); setSector(''); setView('list'); setSearch(ticker); setStrict(false); setNearOnly(false); setOnlyWatch(false); setSymbol(ticker); setMobileView('detail');
    focusDetail();
  }
  function inspectChanged(ticker) {
    setSector(''); setView('list'); setSearch(ticker); setStrict(false); setNearOnly(false); setOnlyWatch(false); setCoverage('all'); setLiquid(false); setSymbol(ticker); setMobileView('detail');
    focusDetail();
  }
  const verificationQueue = useRef(Promise.resolve());
  const applyVerification = useCallback((ticker, result, date, generation) => {
    // Ignore an in-flight result from a replaced daily snapshot.
    if (date !== bundle.data?.date || generation !== version) return;
    verificationQueue.current = verificationQueue.current.then(async () => {
      const key = ['researchRows', researchPath, version];
      const previous = client.getQueryData(key);
      if (previous?.date !== date) return;
      const updated = previous.rows.map(r => r.symbol === ticker ? { ...r, method_summary:undefined, technical_audit: result.audit, book_diagnostics: result.bookDiagnostics, book_technical_evidence: result.bookTechnical } : r);
      let next;
      try { next = await refreshResearchBundle(updated, date); }
      catch { next = prepareResearchBundle([{ rows: updated, as_of_date: date }], date); }
      // A refetch or a new publication may have replaced this snapshot while
      // the worker was running. Never resurrect the prior publication.
      if (client.getQueryData(key) !== previous) return;
      client.setQueryData(key, next);
      setVerificationNotice(`${ticker}：日足再検証を候補一覧・判定根拠・配分に反映しました。${result.assessment.qualified ? '選定条件を確認。' : '未充足または未確認の条件があります。全条件通過のみでは除外します。'}`);
    }).catch(() => setVerificationNotice(`${ticker}：再検証の反映に失敗しました。データを再取得してください。`));
  }, [bundle.data?.date, version, client, researchPath]);
  function focusDetail() { requestAnimationFrame(() => {
    detailRef.current?.focus?.({ preventScroll: true });
    detailRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  }); }
  const selectSymbol = useCallback(ticker => {setSymbol(ticker);if(window.matchMedia?.('(max-width:700px)')?.matches){setMobileView('detail');requestAnimationFrame(()=>{detailRef.current?.focus?.({preventScroll:true});detailRef.current?.scrollIntoView?.({block:'start'});});}},[]);
  const expandChart = useCallback(()=>setChart(selected?.symbol),[selected?.symbol]);
  const disconnect = useCallback(()=>setPersonalKey(''),[]);
  const detailState = useMemo(()=>({isLoading:detail.isLoading,isError:detail.isError,isSuccess:detail.isSuccess,refetch:detail.refetch}),[detail.isLoading,detail.isError,detail.isSuccess,detail.refetch]);
  const browse = () => {setMobileView('list'); requestAnimationFrame(()=>{const target=document.getElementById('candidate-board');target?.focus({preventScroll:true});target?.scrollIntoView?.({block:'start'});});};
  function download() {
    const csv = researchCsv(ranked, method, bundle.data?.date);
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `research-${method}-${bundle.data?.date || 'unknown'}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  const actualView=compareOnly?'charts':view;
  const methodControls=<div className="method-tabs" role="group" aria-label="投資手法">{Object.entries(METHODS).map(([key,label])=><button key={key} aria-pressed={method===key} onClick={()=>setMethod(key)}>{label.replace(' / CAN SLIM','').replace('リーダー','')}</button>)}</div>;
  return <Box component="main" className={`research-workbench${compareOnly?' comparison-page':''}`} data-mobile-view={mobileView}>
    <ConnectionStatus date={bundle.data?.date || entry.as_of_date}/>
    {!compareOnly&&<ResearchHero loading={!bundle.data} rows={rows} ranked={radarRanked} date={bundle.data?.date||entry.as_of_date} plan={portfolioPlan} selectedSymbol={selected?.symbol} onSelect={selectSymbol} onInspect={inspectOrder} onInspectChanged={inspectChanged} onBrowse={browse} workbench={workbench} method={method} availableSymbols={availableSymbols}/>}
    {compareOnly&&<header className="comparison-page-heading"><div><h1>買い位置を比較する</h1><p>縦軸は銘柄ごとに調整 · 価格位置と購入条件を分けて確認</p></div><Button onClick={()=>setFiltersOpen(true)}>手法・絞り込み</Button></header>}
    {stale&&<Alert severity="warning">公開データの鮮度を確認してください。選定とチャートは日次データです。</Alert>}
    {bundle.data&&freshness.state!=='recent'&&<Alert severity="warning">{freshness.state==='old'?`分析基準日は米国東部の日付から${freshness.days}暦日前です。更新日時と価格の基準日は別です。`:'分析基準日が未確認、または未来の日付です。'}</Alert>}
    <Drawer anchor="right" open={filtersOpen} onClose={()=>setFiltersOpen(false)} PaperProps={{role:'dialog','aria-modal':true,'aria-labelledby':'research-filter-title',sx:{width:{xs:'100%',sm:420},p:3}}}>
      <header className="drawer-title"><h2 id="research-filter-title">候補を絞り込む</h2><Button onClick={()=>setFiltersOpen(false)} aria-label="絞り込みを閉じる">×</Button></header>
      <ResearchSearch value={search} onChange={setSearch}/>
      {methodControls}
      <FormControlLabel control={<Switch checked={strict} onChange={e=>{setStrict(e.target.checked);if(e.target.checked)setNearOnly(false);}}/>} label="全条件通過のみ"/>
      <FormControlLabel control={<Switch checked={nearOnly} onChange={e=>{setNearOnly(e.target.checked);if(e.target.checked)setStrict(false);}}/>} label="あと1条件"/>
      {nearOnly&&<p>通過数が全条件数−1の監視候補です。未達・未確認を区別し、合格には数えません。</p>}
      <FormControlLabel control={<Switch checked={onlyWatch} onChange={e=>setOnlyWatch(e.target.checked)}/>} label="ウォッチのみ"/>
      <label className="sector-filter">業種 <select value={sector} onChange={e=>setSector(e.target.value)}><option value="">すべての業種</option>{SECTORS.map(([key,label])=><option key={key} value={key}>{label}</option>)}<option value="Unknown">分類不明</option></select></label>
      <p>日足検証済み {verifiedCount.toLocaleString()} / {coverageRows.length.toLocaleString()}銘柄。未確認は合格に数えません。</p>
      <label className="sector-filter">検証状況 <select aria-label="検証状況" value={coverage} onChange={e=>setCoverage(e.target.value)}><option value="all">全銘柄</option><option value="verified">日足検証済み</option><option value="unverified">判定資料不足</option></select></label>
      <FormControlLabel control={<Switch checked={liquid} onChange={e=>setLiquid(e.target.checked)}/>} label="流動性：株価 $10以上・平均売買代金 $2,000万以上"/>
      <Button onClick={download} disabled={!ranked.length}>全検索結果をCSV保存 ↓</Button>
      <Button component="a" href={`${import.meta.env.BASE_URL}qualification-audit.json`} download>全銘柄の検証記録 ↓</Button>
      <Button onClick={()=>{manifest.refetch?.();if(bundle.isError)bundle.refetch();}}>データを再確認 ↻</Button>
      <Button variant="contained" onClick={()=>{setFiltersOpen(false);browse();}}>候補を確認する →</Button>
    </Drawer>
    {(manifest.isError || bundle.isError) && <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => { manifest.refetch?.(); if (bundle.isError) bundle.refetch(); }}>再試行</Button>}>データを取得できません。以前の表示値がある場合は最新とは限りません。</Alert>}
    {(manifest.isLoading || bundle.isLoading) && <Box role="status" sx={{ p: 4 }}><CircularProgress size={24} /> 銘柄と分析根拠を読み込んでいます…</Box>}
    {storageError && <Alert severity="warning">ウォッチはこの画面のみ保持されます。端末への保存が制限されています。</Alert>}
    {verificationNotice && <Alert severity="info" onClose={() => setVerificationNotice(null)} sx={{ mb: 2 }}>{verificationNotice}</Alert>}
    {!compareOnly&&mobileView==='detail'&&<button className="mobile-back" onClick={browse}>← 候補一覧に戻る</button>}
    <div className="research-grid" data-view={actualView}>
      <CandidateBoard ranked={ranked} method={method} nearOnly={nearOnly} onNearToggle={()=>{setNearOnly(value=>!value);setStrict(false);}} selectedSymbol={selected?.symbol} loading={!bundle.data&&!bundle.isError} onSelect={selectSymbol} view={actualView} onView={setView} toolbar={methodControls} onFilters={()=>setFiltersOpen(true)} compareOnly={compareOnly} date={bundle.data?.date} generation={version} market={market} now={now} onCompare={setChart} paused={Boolean(chart)} />
      {actualView!=='charts' && <ResearchDetail ref={detailRef} selected={selected} method={method} usableQuote={usableQuote} date={bundle.data?.date} market={market} now={now} chartEntry={chartEntry} version={version} onExpand={expandChart} watch={watch} onWatch={toggleWatch} liveStatus={liveStatus} personalKey={personalKey} personal={personal} onConnect={setPersonalKey} onDisconnect={disconnect} verificationSymbol={verificationSymbol} onVerificationToggle={setVerificationSymbol} detail={detailState} onVerified={applyVerification} onBack={browse} />}
    </div>
    {!compareOnly&&<footer className="research-method-note">
      <CandidatePerformance entry={entry}/>
      {bundle.data&&<WatchNotifications rows={rows} watch={watch} asOf={bundle.data.date} method={method} personalConnected={Boolean(personalKey)&&personal.status==='接続済み'} personalQuote={usableQuote} onSelect={inspectChanged}/>}
      <details><summary>補助ビュー</summary><Stack direction="row" gap={2}><Button component="a" href="#/daily">デイリー一覧</Button><Button component="a" href="#/groups">業種ランキング</Button></Stack></details>
      <Typography variant="body2">{overlap ? `IBD公式リストとの一致：${Math.round(overlap.recall * 100)}%` : '公開ルールに基づく独自スクリーナー'}</Typography>
      <details className="research-disclosure"><summary>選定方式とデータの読み方</summary>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.9 }}>{endpoint || personalKey ? `価格配信は15秒ごとに確認。配信時刻：${usableQuote?.as_of || '未確認'}。${usableQuote?.feed === 'iex' ? 'IEX取引所のみの価格です。' : ''}` : 'エントリー位置の「場中価格を接続する」から自分用APIキーで接続できます。未接続時は日次価格で計算します。'} ピボット・財務条件・チャートは日次です。候補は購入推奨ではありません。</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.9 }}>オニールは前年同期比成長、ミネルヴィニはトレンドテンプレート、IBD型は独自レーティングで比較します。RSは検証できた公開日足の母集団内で、63・126・189・252営業日リターンを40・20・20・20%で加重した順位です。全米株の公式RSとは異なり、未配信銘柄による母集団の偏りがあります。新製品・経営変化・機関投資家の質は個別確認が必要です。IBD公式の選定銘柄・非公開の計算式を再現したものではありません。</Typography>
      <Stack direction="row" gap={2} flexWrap="wrap" sx={{ mt: 1 }}><Button size="small" component="a" href="https://shop.investors.com/images/promotional/20-Rules_102808.pdf" target="_blank" rel="noopener noreferrer">IBDの公開ルール ↗</Button><Button size="small" component="a" href="https://cdn.minervini.com/static/dist/mtp-review.1f8e8633.pdf" target="_blank" rel="noopener noreferrer">ミネルヴィニの資料 ↗</Button><Button size="small" component="a" href="https://github.com/kusennjp1-ai/screener/issues/new?template=research-feedback.yml" target="_blank" rel="noopener noreferrer">不具合・使い勝手を報告 ↗</Button></Stack>
      </details>
    </footer>}
    <StaticChartViewerModal method={method} date={bundle.data?.date} market={market} now={now} quote={usableQuote} open={Boolean(chart)} onClose={() => setChart(null)} initialSymbol={chart} researchRows={rows} generation={version} chartIndex={index.data} navigationSymbols={navigationSymbols} />
  </Box>;
}
