import ConnectionStatus from '../components/ConnectionStatus';
import { SECTORS } from '../sectorStrength';
import { useWorkbench } from '../useWorkbench';
import DailyChanges from '../components/DailyChanges';
import { filterRanked, formatPublished, sessionCurrent } from '../researchPresentation';
import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, CircularProgress, FormControlLabel, Paper, Stack, Switch, ToggleButton, ToggleButtonGroup, Typography, useTheme } from '@mui/material';
import { fetchStaticJson, resolveStaticMarketEntry, useStaticManifest } from '../dataClient';
import { useStaticChartIndex } from '../chartClient';
import StaticChartViewerModal from '../StaticChartViewerModal';
import { compareReference, finite, quoteStatus, rankCandidates, researchCsv, snapshotFreshness } from '../researchEngine';
import ResearchDetail from '../components/ResearchDetail';
import CandidateBoard from '../components/CandidateBoard';
import ResearchSearch from '../components/ResearchSearch';
import { entryReadiness } from '../entryReadiness';
import { modelMarket, preparePortfolioRows } from '../portfolioPlan';
import PortfolioDecision from '../components/PortfolioDecision';
import { usePersonalQuote } from '../usePersonalQuote';
import { mergeScanRows } from '../qualificationAudit';
import '../research.css';

const METHODS = { minervini: 'ミネルヴィニ', minervini2: '基本と原則', oneil: 'オニール / CAN SLIM', ibd: 'IBD型リーダー' };

export default function ResearchPage() {
  const theme = useTheme();
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
  const [search, setSearch] = useState('');
  const [strict, setStrict] = useState(false);
  const [coverage, setCoverage] = useState('all');
  const deferredSearch = useDeferredValue(search);
  const [mobileView, setMobileView] = useState('list');
  const [liquid, setLiquid] = useState(true);
  const detailRef = useRef(null);
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [symbol, setSymbol] = useState(null);
  const [chart, setChart] = useState(null);
  const [storageError, setStorageError] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState(null);
  const [verificationSymbol, setVerificationSymbol] = useState(null);
  const [watch, setWatch] = useState(() => {
    try { const value = JSON.parse(localStorage.getItem('research-watch') || '[]'); return Array.isArray(value) ? value.filter(s => typeof s === 'string') : []; } catch { return []; }
  });
  const bundle = useQuery({
    placeholderData: () => undefined,
    queryKey: ['researchRows', researchPath, version],
    enabled: Boolean(researchPath),
    queryFn: async () => {
      const index = await fetchStaticJson(researchPath);
      if (entry.as_of_date && index.as_of_date && entry.as_of_date !== index.as_of_date) throw new Error('Snapshot date mismatch');
      const chunks = await Promise.all((index.chunks || []).map(c => fetchStaticJson(c.path)));
      if (chunks.some(c => c.as_of_date && c.as_of_date !== index.as_of_date)) throw new Error('Mixed snapshot dates');
      return { rows: mergeScanRows([index, ...chunks], index.as_of_date), date: index.as_of_date };
    }, staleTime: Infinity,
  });
  const reference = useQuery({ queryKey: ['researchReference', version], queryFn: async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}ibd-reference.json`, { cache: 'no-cache' });
    return response.ok ? response.json() : null;
  }, retry: false });
  const rows = useMemo(() => bundle.data?.rows || [], [bundle.data]);
  const rankings = useMemo(() => ({rows,methods:new Map()}), [rows]);
  const evaluated = useMemo(() => { if (!rankings.methods.has(method)) rankings.methods.set(method,rankCandidates(rankings.rows,method)); return rankings.methods.get(method); }, [method, rankings]);
  const ranked = useMemo(() => filterRanked(evaluated, { search: deferredSearch, qualifiedOnly: strict, watchlist: onlyWatch ? watch : null, liquidOnly: liquid, coverage, sector }), [evaluated, deferredSearch, strict, onlyWatch, watch, liquid, coverage, sector]);
  const coverageRows = useMemo(() => filterRanked(evaluated, {liquidOnly:liquid}), [evaluated, liquid]);
  const verifiedCount = coverageRows.filter(r => r.row.technical_audit?.valid === true).length;
  const navigationSymbols = useMemo(() => ranked.map(r => r.row.symbol), [ranked]);
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
  const market = useMemo(() => modelMarket(rows), [rows]);
  const portfolioPrepared = useMemo(() => preparePortfolioRows(rows), [rows]);
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
  const activeQuote = personalKey ? personal.quote : quote.data;
  const liveStatus = personalKey && personal.status !== '接続済み' ? personal.status : !personalKey && quote.isError ? '接続エラー' : quoteStatus(activeQuote, now);
  const usableQuote = ['リアルタイム', '遅延データ'].includes(liveStatus) ? activeQuote : null;
  const leaders = useMemo(() => rankCandidates(rows, 'ibd', { liquidOnly: true }).filter(r => r.assessment.qualified).slice(0, 50).map(r => r.row), [rows]);
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
    setMethod('minervini'); setSector(''); setView('list'); setSearch(ticker); setStrict(false); setOnlyWatch(false); setSymbol(ticker); setMobileView('detail');
    focusDetail();
  }
  const applyVerification = useCallback((ticker, result, date, generation) => {
    // Ignore an in-flight result from a replaced daily snapshot.
    if (date !== bundle.data?.date || generation !== version) return;
    client.setQueryData(['researchRows', researchPath, version], previous => previous ? {
      ...previous, rows: previous.rows.map(r => r.symbol === ticker ? { ...r, method_summary:undefined, technical_audit: result.audit, book_diagnostics: result.bookDiagnostics, book_technical_evidence: result.bookTechnical } : r),
    } : previous);
    setVerificationNotice(`${ticker}：日足再検証を候補一覧・判定根拠・配分に反映しました。${result.assessment.qualified ? '選定条件を確認。' : '未充足または未確認の条件があります。全条件通過のみでは除外します。'}`);
  }, [bundle.data?.date, version, client, researchPath]);
  function focusDetail() { requestAnimationFrame(() => {
    detailRef.current?.focus?.({ preventScroll: true });
    detailRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  }); }
  const selectSymbol = useCallback(ticker => {setSymbol(ticker);setMobileView('detail');requestAnimationFrame(()=>{detailRef.current?.focus?.({preventScroll:true});detailRef.current?.scrollIntoView?.({block:'start'});});},[]);
  const expandChart = useCallback(()=>setChart(selected?.symbol),[selected?.symbol]);
  const disconnect = useCallback(()=>setPersonalKey(''),[]);
  const detailState = useMemo(()=>({isLoading:detail.isLoading,isError:detail.isError,isSuccess:detail.isSuccess,refetch:detail.refetch}),[detail.isLoading,detail.isError,detail.isSuccess,detail.refetch]);
  const browse = () => {setMobileView('list'); requestAnimationFrame(()=>{const target=document.getElementById('candidate-board');target?.focus({preventScroll:true});target?.scrollIntoView?.({block:'start'});});};
  function download() {
    const csv = researchCsv(ranked, method, bundle.data?.date);
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `research-${method}-${bundle.data?.date || 'unknown'}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  return <Box component="main" className="research-workbench" data-mobile-view={mobileView} sx={{ '--accent': theme.palette.mode === 'dark' ? '#a399ff' : '#6555dc' }}>
    <ConnectionStatus date={bundle.data?.date || entry.as_of_date} />
    <header className="research-heading">
      <Box><div className="research-kicker">米国株スクリーナー</div><Typography component="h1" sx={{ fontSize: { xs: 25, md: 30 }, fontWeight: 700, letterSpacing: '-.03em', mt: .5 }}>今日の投資判断</Typography></Box>
      <Stack alignItems="flex-end" gap={.5}><Typography variant="body2" color="text.secondary">日次分析：{bundle.data?.date || entry.as_of_date || '取得中'}</Typography><Button size="small" onClick={() => { manifest.refetch?.(); if (bundle.isError) bundle.refetch(); }}>データを再確認 ↻</Button></Stack>
    </header>
    {bundle.data && !bundle.isError && <PortfolioDecision rows={rows} date={bundle.data.date} now={now} onInspect={inspectOrder} onBrowse={browse} />}
    <DailyChanges query={workbench} method={method} onSelect={inspectOrder} />
    <div className="research-summary">
      <span>分析対象<strong>{rows.length.toLocaleString()} 銘柄</strong></span>
      <span>条件通過<strong>{ranked.filter(r => r.assessment.qualified).length} 銘柄</strong></span>
      <span className="coverage-summary">日足検証 {verifiedCount.toLocaleString()} / {coverageRows.length.toLocaleString()}</span>
      <Typography variant="body2" color="text.secondary" sx={{ ml: { md: 'auto' }, fontSize: 12 }}>公開更新：{manifest.data?.generated_at ? formatPublished(manifest.data.generated_at) : '未確認'}</Typography>
    </div>
    {stale && <Alert severity="warning" sx={{ mb: 2 }}>公開データの鮮度を確認してください。選定とチャートは日次データです。</Alert>}
    {bundle.data && freshness.state !== 'recent' && <Alert severity="warning" sx={{ mb: 2 }}>
      {freshness.state === 'old' ? `分析基準日は米国東部の日付から${freshness.days}暦日前です。公開更新が新しくても、分析データが新しいとは限りません。休場日も含む日数です。` : '分析基準日が未確認、または未来の日付です。最新の分析として扱わないでください。'}
    </Alert>}
    <Paper className="research-controls" elevation={0}>
      <Stack direction={{ xs: 'column', md: 'row' }} gap={2} justifyContent="space-between" alignItems={{ md: 'center' }}>
        <ToggleButtonGroup exclusive value={method} onChange={(_, value) => { if (value) { setMethod(value);  } }} aria-label="投資手法" sx={{ flexWrap: 'wrap' }}>
          {Object.entries(METHODS).map(([key, label]) => <ToggleButton key={key} value={key} sx={{ px: 2.5, py: 1, fontSize: 14 }}>{label}</ToggleButton>)}
        </ToggleButtonGroup>
        <ResearchSearch value={search} onChange={setSearch} />
      </Stack>
      <Stack direction="row" flexWrap="wrap" columnGap={2} sx={{ mt: 1 }} alignItems="center">
        <FormControlLabel control={<Switch size="small" checked={strict} onChange={e => setStrict(e.target.checked)} />} label="全条件通過のみ" sx={{ '& .MuiFormControlLabel-label': { fontSize: 13 } }} />
        <FormControlLabel control={<Switch size="small" checked={onlyWatch} onChange={e => setOnlyWatch(e.target.checked)} />} label="ウォッチのみ" sx={{ '& .MuiFormControlLabel-label': { fontSize: 13 } }} />
      </Stack>
      <label className="sector-filter">業種 <select value={sector} onChange={e=>setSector(e.target.value)}><option value="">すべての業種</option>{SECTORS.map(([key,label])=><option key={key} value={key}>{label}</option>)}<option value="Unknown">分類不明</option></select></label>
      <details className="research-disclosure research-options"><summary>表示・保存オプション</summary>      <Typography sx={{fontSize:12,mb:1}}>日足検証済み {verifiedCount.toLocaleString()} / {coverageRows.length.toLocaleString()}銘柄。RSは検証できた共通母集団内の順位です。</Typography>
      <ToggleButtonGroup size="small" exclusive value={coverage} onChange={(_,value)=>{if(value){setCoverage(value);}}} aria-label="検証状況" sx={{mb:2}}>
        <ToggleButton value="all">全銘柄</ToggleButton><ToggleButton value="verified">日足検証済み {verifiedCount}</ToggleButton><ToggleButton value="unverified">判定資料不足 {coverageRows.length-verifiedCount}</ToggleButton>
      </ToggleButtonGroup>
<Stack direction="row" flexWrap="wrap" alignItems="center" gap={1}>
        <FormControlLabel control={<Switch size="small" checked={liquid} onChange={e => setLiquid(e.target.checked)} />} label="流動性フィルター：株価 $10以上・平均売買代金 $2,000万以上" sx={{ '& .MuiFormControlLabel-label': { fontSize: 12 } }} />
        <Button onClick={download} disabled={!ranked.length} size="small" sx={{ ml: 'auto' }}>CSV保存 ↓</Button>
        <Button component="a" href={`${import.meta.env.BASE_URL}qualification-audit.json`} download size="small">全銘柄の検証記録 ↓</Button>
      </Stack></details>
    </Paper>
    {(manifest.isError || bundle.isError) && <Alert severity="error" sx={{ mb: 2 }} action={<Button onClick={() => { manifest.refetch?.(); if (bundle.isError) bundle.refetch(); }}>再試行</Button>}>データを取得できません。以前の表示値がある場合は最新とは限りません。</Alert>}
    {(manifest.isLoading || bundle.isLoading) && <Box role="status" sx={{ p: 4 }}><CircularProgress size={24} /> 銘柄と分析根拠を読み込んでいます…</Box>}
    {storageError && <Alert severity="warning">ウォッチはこの画面のみ保持されます。端末への保存が制限されています。</Alert>}
    {verificationNotice && <Alert severity="info" onClose={() => setVerificationNotice(null)} sx={{ mb: 2 }}>{verificationNotice}</Alert>}
    <ToggleButtonGroup className="research-mobile-tabs" exclusive value={mobileView} onChange={(_, value) => { if (value === 'list') browse(); if (value === 'detail') {setView('list');setMobileView(value);focusDetail();} }} fullWidth aria-label="表示パネル">
      <ToggleButton value="list">候補一覧</ToggleButton><ToggleButton value="detail" disabled={!selected}>銘柄分析 {selected?.symbol}</ToggleButton>
    </ToggleButtonGroup>
    <div className="research-grid" data-view={view}>
      <CandidateBoard ranked={ranked} method={method} selectedSymbol={selected?.symbol} loading={bundle.isLoading} onSelect={selectSymbol} view={view} onView={setView} date={bundle.data?.date} generation={version} market={market} now={now} onCompare={setChart} paused={Boolean(chart)} />
      {view!=='charts' && <ResearchDetail ref={detailRef} selected={selected} method={method} usableQuote={usableQuote} date={bundle.data?.date} market={market} now={now} chartEntry={chartEntry} version={version} onExpand={expandChart} watch={watch} onWatch={toggleWatch} liveStatus={liveStatus} personalKey={personalKey} personal={personal} onConnect={setPersonalKey} onDisconnect={disconnect} verificationSymbol={verificationSymbol} onVerificationToggle={setVerificationSymbol} detail={detailState} onVerified={applyVerification} />}
    </div>
    <footer className="research-method-note">
      <details><summary>補助ビュー</summary><Stack direction="row" gap={2}><Button component="a" href="#/daily">デイリー一覧</Button><Button component="a" href="#/groups">業種ランキング</Button></Stack></details>
      <Typography variant="body2">{overlap ? `IBD公式リストとの一致：${Math.round(overlap.recall * 100)}%` : '公開ルールに基づく独自スクリーナー'}</Typography>
      <details className="research-disclosure"><summary>選定方式とデータの読み方</summary>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.9 }}>{endpoint || personalKey ? `価格配信は15秒ごとに確認。配信時刻：${usableQuote?.as_of || '未確認'}。${usableQuote?.feed === 'iex' ? 'IEX取引所のみの価格です。' : ''}` : 'エントリー位置の「場中価格を接続する」から自分用APIキーで接続できます。未接続時は日次価格で計算します。'} ピボット・財務条件・チャートは日次です。候補は購入推奨ではありません。</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.9 }}>オニールは前年同期比成長、ミネルヴィニはトレンドテンプレート、IBD型は独自レーティングで比較します。RSは検証できた公開日足の母集団内で、63・126・189・252営業日リターンを40・20・20・20%で加重した順位です。全米株の公式RSとは異なり、未配信銘柄による母集団の偏りがあります。新製品・経営変化・機関投資家の質は個別確認が必要です。IBD公式の選定銘柄・非公開の計算式を再現したものではありません。</Typography>
      <Stack direction="row" gap={2} flexWrap="wrap" sx={{ mt: 1 }}><Button size="small" component="a" href="https://shop.investors.com/images/promotional/20-Rules_102808.pdf" target="_blank" rel="noopener noreferrer">IBDの公開ルール ↗</Button><Button size="small" component="a" href="https://cdn.minervini.com/static/dist/mtp-review.1f8e8633.pdf" target="_blank" rel="noopener noreferrer">ミネルヴィニの資料 ↗</Button><Button size="small" component="a" href="https://github.com/kusennjp1-ai/screener/issues/new?template=research-feedback.yml" target="_blank" rel="noopener noreferrer">不具合・使い勝手を報告 ↗</Button></Stack>
      </details>
    </footer>
    <StaticChartViewerModal method={method} date={bundle.data?.date} market={market} now={now} quote={usableQuote} open={Boolean(chart)} onClose={() => setChart(null)} initialSymbol={chart} researchRows={rows} generation={version} chartIndex={index.data} navigationSymbols={navigationSymbols} />
  </Box>;
}
