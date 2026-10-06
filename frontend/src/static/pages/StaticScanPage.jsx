import { publicationQueryIdentity } from '../staticPublication';
import { projectFinancialRow } from '../financialCurrent';
import { useFinancialClock } from '../useFinancialClock';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Box,
  CircularProgress,
  Paper,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import MobileScanResults from '../components/MobileScanResults';
import ResearchSearch from '../components/ResearchSearch';
import FilterPanel from '../../components/Scan/FilterPanel';
import ResultsTable from '../../components/Scan/ResultsTable';
import { modelMarket } from '../portfolioPlan';
import { useStaticManifest, fetchStaticJson, resolveStaticMarketEntry } from '../dataClient';
import { useStaticChartIndex } from '../chartClient';
import {
  applyScanFilterDefaults,
  buildDefaultScanFilters,
} from '../../features/scan/defaultFilters';
import { normalizeScanFilterOptions } from '../../features/scan/filterOptions';
import { getStableFilterKey } from '../../utils/filterUtils';
import {
  filterStaticScanRows,
  paginateStaticScanRows,
  sortStaticScanRows,
} from '../scanClient';
import StaticChartViewerModal from '../StaticChartViewerModal';
import ScreenSelector from '../components/ScreenSelector';
import { usePresetScreens, buildFiltersFromPreset } from '../hooks/usePresetScreens';
import { useStaticMarket } from '../StaticMarketContext';

const HYDRATION_BATCH_SIZE = 2;

function StaticScanPage() {
  const manifestQuery = useStaticManifest();
  const generation = manifestQuery.data?.research_generation || manifestQuery.data?.generated_at;
  const { selectedMarket } = useStaticMarket();
  const marketEntry = useMemo(
    () => resolveStaticMarketEntry(manifestQuery.data, selectedMarket),
    [manifestQuery.data, selectedMarket],
  );
  const scanManifestQuery = useQuery({
    queryKey: ['staticScanManifest', marketEntry.pages?.scan?.list_path || marketEntry.pages?.scan?.path, generation, publicationQueryIdentity(marketEntry.publication)],
    placeholderData: () => undefined,
    queryFn: () => fetchStaticJson(marketEntry.pages.scan.list_path || marketEntry.pages.scan.path, { publication: marketEntry.publication }),
    enabled: Boolean(marketEntry.pages?.scan?.path),
    staleTime: Infinity,
  });
  const chartIndexQuery = useStaticChartIndex(scanManifestQuery.data?.charts?.path, !scanManifestQuery.data?.embedded_chart_paths, marketEntry.publication);

  const theme = useTheme();
  // 初期状態は適用件数を残して折りたたみ、結果を先に見せる。
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [filters, setFilters] = useState(buildDefaultScanFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [fullTable,setFullTable]=useState(false);
  useEffect(() => { setPage(1); }, [isMobile]);
  const searchRows=useCallback(text=>{setFilters(old=>({...old,symbolSearch:text}));setPage(1);},[]);
  const [desktopPerPage, setPerPage] = useState(50);
  const perPage = isMobile ? 20 : desktopPerPage;
  const [sortBy, setSortBy] = useState('composite_score');
  const [sortOrder, setSortOrder] = useState('desc');
  // チャートモーダルとプリセットスクリーン選択はURLと同期させる。
  // 履歴に積まれるため、ブラウザの「戻る」でモーダルが閉じ、選択も巻き戻せる。
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedChartSymbol = searchParams.get('chart');
  const chartModalOpen = Boolean(selectedChartSymbol);
  const screenParam = searchParams.get('screen');
  const closeChartModal = useCallback(() => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('chart');
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const [hydrationState, setHydrationState] = useState({
    status: 'idle',
    rows: [],
    loadedRows: 0,
    error: null,
  });
  const sectionDefaultExpanded = useMemo(
    () => ({
      fundamental: false,
      technical: false,
      rating: false,
    }),
    []
  );
  const manifestDefaultFilterValues = useMemo(
    () => scanManifestQuery.data?.default_filters ?? {},
    [scanManifestQuery.data?.default_filters]
  );
  const manifestDefaultFilters = useMemo(
    () => applyScanFilterDefaults(manifestDefaultFilterValues),
    [manifestDefaultFilterValues]
  );
  const manifestDefaultSortBy = scanManifestQuery.data?.sort?.field ?? 'composite_score';
  const manifestDefaultSortOrder = scanManifestQuery.data?.sort?.order ?? 'desc';
  const presetScreens = useMemo(() => scanManifestQuery.data?.preset_screens?.map(s => ({...s, short_name:`補助 ${s.short_name}`})), [scanManifestQuery.data?.preset_screens]);

  useEffect(() => {
    if (scanManifestQuery.data?.default_page_size) {
      setPerPage(scanManifestQuery.data.default_page_size);
    }
    if (scanManifestQuery.data?.sort?.field) {
      setSortBy(scanManifestQuery.data.sort.field);
      setSortOrder(scanManifestQuery.data.sort.order || 'desc');
    }
  }, [scanManifestQuery.data]);

  useEffect(() => {
    if (!scanManifestQuery.data) {
      return;
    }
    setFilters(manifestDefaultFilters);
  }, [manifestDefaultFilters, scanManifestQuery.data]);

  useEffect(() => {
    const manifest = scanManifestQuery.data;
    if (!manifest) {
      return undefined;
    }

    const initialRows = Array.isArray(manifest.initial_rows) ? manifest.initial_rows : [];
    const totalRows = manifest.rows_total || initialRows.length;
    const chunks = Array.isArray(manifest.chunks) ? manifest.chunks : [];
    const rowsBySymbol = new Map(initialRows.map((row) => [row.symbol, row]));
    const initialLoadedRows = Math.min(rowsBySymbol.size, totalRows);

    if (!chunks.length || initialLoadedRows >= totalRows) {
      setHydrationState({ generation, manifest,
        status: 'complete',
        rows: initialRows,
        loadedRows: initialLoadedRows,
        error: null,
      });
      return undefined;
    }

    setHydrationState({ generation, manifest,
      status: 'loading',
      rows: initialRows,
      loadedRows: initialLoadedRows,
      error: null,
    });

    let cancelled = false;
    const hydrateRows = async () => {
      try {
        for (let index = 0; index < chunks.length; index += HYDRATION_BATCH_SIZE) {
          const batch = chunks.slice(index, index + HYDRATION_BATCH_SIZE);
          const payloads = await Promise.all(batch.map((chunk) => fetchStaticJson(chunk.path, { publication: marketEntry.publication, sha256: chunk.sha256 })));
          if (cancelled) {
            return;
          }

          payloads.forEach((payload) => {
            if (manifest.embedded_chart_paths && (payload.as_of_date !== manifest.as_of_date || !Array.isArray(payload.rows))) {
              throw new Error('一覧データの日付または形式が一致しません。再読み込みしてください。');
            }
            (payload.rows || []).forEach((row) => {
              rowsBySymbol.set(row.symbol, row);
            });
          });

          setHydrationState({ generation, manifest,
            status: rowsBySymbol.size >= totalRows ? 'complete' : 'loading',
            rows: Array.from(rowsBySymbol.values()),
            loadedRows: Math.min(rowsBySymbol.size, totalRows),
            error: null,
          });
        }

        if (!cancelled) {
          if (rowsBySymbol.size !== totalRows) throw new Error(`一覧データが不足しています（${rowsBySymbol.size} / ${totalRows}）。全体の件数・CSVは未確定です。`);
          setHydrationState({ generation, manifest,
            status: 'complete',
            rows: Array.from(rowsBySymbol.values()),
            loadedRows: Math.min(rowsBySymbol.size, totalRows),
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          const accumulatedRows = Array.from(rowsBySymbol.values());
          setHydrationState({ generation, manifest,
            status: 'error',
            rows: accumulatedRows,
            loadedRows: Math.min(accumulatedRows.length, totalRows),
            error: error instanceof Error ? error.message : 'Unknown hydration error',
          });
        }
      }
    };

    void hydrateRows();

    return () => {
      cancelled = true;
    };
  }, [scanManifestQuery.data, generation, marketEntry.publication]);
  const now = useFinancialClock(hydrationState.rows);
  const hydrationMatches = hydrationState.generation === generation && hydrationState.manifest === scanManifestQuery.data;
  const hydrationComplete = hydrationMatches && hydrationState.status === 'complete';
  const hydratedRows = useMemo(() => (hydrationMatches ? hydrationState.rows : []).map(row => projectFinancialRow(row, { now, asOfDate: scanManifestQuery.data?.as_of_date, market: selectedMarket })), [hydrationMatches, hydrationState.rows, now, scanManifestQuery.data?.as_of_date, selectedMarket]);
  const { activeScreenId, setActiveScreenId, matchCounts } = usePresetScreens({
    screens: presetScreens,
    allRows: hydratedRows,
    hydrationComplete, now,
  });

  const applyScreen = useCallback((screenId) => {
    setActiveScreenId(screenId || null);
    if (!screenId) {
      setFilters(manifestDefaultFilters);
      setSortBy(manifestDefaultSortBy);
      setSortOrder(manifestDefaultSortOrder);
    } else {
      const screen = presetScreens?.find((s) => s.id === screenId);
      if (screen) {
        setFilters(buildFiltersFromPreset(screen));
        setSortBy(screen.sort_by);
        setSortOrder(screen.sort_order);
      }
    }
  }, [
    presetScreens,
    manifestDefaultFilters,
    manifestDefaultSortBy,
    manifestDefaultSortOrder,
    setActiveScreenId,
  ]);

  // URLの ?screen= が変わったら（チップ選択・戻る/進む・直接リンク）選択を適用する
  useEffect(() => {
    if (!scanManifestQuery.data) {
      return;
    }
    applyScreen(screenParam);
  }, [applyScreen, scanManifestQuery.data, screenParam]);

  const handleSelectScreen = useCallback((screenId) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (screenId) {
        next.set('screen', screenId);
      } else {
        next.delete('screen');
      }
      return next;
    });
  }, [setSearchParams]);

  const filterKey = useMemo(() => getStableFilterKey(filters), [filters]);
  useEffect(() => {
    setPage(1);
  }, [filterKey]);
  const chartEntries = useMemo(
    () => scanManifestQuery.data?.embedded_chart_paths ? hydratedRows.filter(r=>r.chart_path).map(r=>({symbol:r.symbol,path:r.chart_path})) : chartIndexQuery.data?.symbols || [],
    [chartIndexQuery.data, hydratedRows, scanManifestQuery.data?.embedded_chart_paths]
  );
  const effectiveChartIndex = useMemo(()=>({symbols:chartEntries}),[chartEntries]);
  const chartEnabledSymbols = useMemo(
    () => new Set(chartEntries.map((entry) => entry.symbol)),
    [chartEntries]
  );
  const filteredRows = useMemo(
    () => (hydrationComplete ? filterStaticScanRows(hydratedRows, filters, { now }) : hydratedRows),
    [filters, hydratedRows, hydrationComplete, now]
  );
  const sortedRows = useMemo(
    () => (
      hydrationComplete
        ? sortStaticScanRows(filteredRows, sortBy, sortOrder, {
          prioritizeCompositeScanMode: !activeScreenId, now,
        })
        : filteredRows
    ),
    [activeScreenId, filteredRows, hydrationComplete, sortBy, sortOrder, now]
  );
  const activeScreenLimit = useMemo(() => {
    if (!activeScreenId) return null;
    const screen = presetScreens?.find((s) => s.id === activeScreenId);
    return screen?.limit ?? null;
  }, [activeScreenId, presetScreens]);
  // Capped screens (e.g. "IBD 50") show only the top-N after sorting, so the
  // list reads like the editorial leaderboard rather than every match.
  const cappedRows = useMemo(
    () => (activeScreenLimit ? sortedRows.slice(0, activeScreenLimit) : sortedRows),
    [activeScreenLimit, sortedRows]
  );
  const pagedRows = useMemo(
    () => (hydrationComplete ? paginateStaticScanRows(cappedRows, page, perPage) : paginateStaticScanRows(filteredRows, 1, perPage)),
    [cappedRows, filteredRows, hydrationComplete, page, perPage]
  );
  const chartsAvailable = chartEnabledSymbols.size > 0;
  const isChartEnabled = useCallback(
    (symbol) => chartEnabledSymbols.has(symbol),
    [chartEnabledSymbols]
  );

  const handleOpenChart = (symbol) => {
    if (!isChartEnabled(symbol)) {
      return;
    }
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('chart', symbol);
      return next;
    });
  };
  const navigationSymbols = useMemo(() => {
    const orderedRows = hydrationComplete ? cappedRows : pagedRows;
    return orderedRows
      .map((row) => row.symbol)
      .filter((symbol) => chartEnabledSymbols.has(symbol));
  }, [cappedRows, chartEnabledSymbols, hydrationComplete, pagedRows]);

  if (manifestQuery.isLoading || scanManifestQuery.isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (manifestQuery.isError || scanManifestQuery.isError) {
    return <Alert severity="error">スキャンデータの読み込みに失敗しました。</Alert>;
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h5" component="h1" sx={{ whiteSpace: 'nowrap', fontSize: 26, fontWeight: 700, letterSpacing: '-0.5px', mb: 0.5 }}>
        詳細スキャン
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: '12px' }}>
        基準日 {scanManifestQuery.data.as_of_date} · 補助条件で絞り込み
      </Typography>

      {(!isMobile || mobileToolsOpen) && <Box component="details" sx={{ mb: 1, '&[open] .scan-help-indicator': { transform: 'rotate(180deg)' } }}>
        <Box component="summary" sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: { xs: 44, md: 24 }, cursor: 'pointer', color: 'text.secondary', fontSize: 12 }}>
          件数・補助フィルターの見方<Box component="span" className="scan-help-indicator" aria-hidden="true">⌄</Box>
        </Box>
        <Alert severity="info" sx={{ mt: 1 }}>この画面は追加条件を自由に組み合わせる補助ビューです。プリセットの件数は独自の複合フィルターの結果で、ホームの書籍条件通過数とは異なります。</Alert>
      </Box>}
      <Paper elevation={0} sx={{ p: { xs: 0.5, md: 1.5 }, pl: 1.5, mb: 1, border: '1px solid', borderColor: 'divider' }}>
        <Box display="flex" alignItems="center" gap={1}>
          <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
            {(hydrationComplete ? cappedRows.length : hydrationState.loadedRows).toLocaleString()}
          </Typography>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '12px' }}>
            件 / 全 {scanManifestQuery.data.rows_total.toLocaleString()} 件
            {!isMobile && scanManifestQuery.data.charts?.available
              ? ` · チャート ${(scanManifestQuery.data.charts.symbols_total ?? scanManifestQuery.data.charts.limit).toLocaleString()} 銘柄`
              : ''}
          </Typography>
          {isMobile && <Button aria-expanded={mobileToolsOpen} onClick={() => setMobileToolsOpen(open => !open)} sx={{ ml: 'auto', flexShrink: 0, minHeight: 44, fontSize: 12 }}>条件・使い方 {mobileToolsOpen ? '⌃' : '⌄'}</Button>}
        </Box>
      </Paper>

      {hydrationComplete && presetScreens?.length > 0 && (!isMobile || mobileToolsOpen) && (
        <Box sx={{mb:1}}><ScreenSelector
          screens={presetScreens}
          activeScreenId={activeScreenId}
          onSelectScreen={handleSelectScreen}
          matchCounts={matchCounts}
        /></Box>
      )}

      {!hydrationComplete && (
        <Alert severity="info" sx={{ mb: 2 }}>
          全データを読み込み中: {hydrationState.loadedRows.toLocaleString()} /{' '}
          {scanManifestQuery.data.rows_total.toLocaleString()} 件。読み込み完了後にフィルタと並べ替えが使えるようになります。
        </Alert>
      )}

      {hydrationState.status === 'error' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          バックグラウンドのデータ読み込みに失敗しました。先頭ページのみ表示しています。
        </Alert>
      )}

      {chartIndexQuery.isError && scanManifestQuery.data.charts?.path ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          チャートデータの読み込みに失敗しました。スキャン結果はチャートなしで利用できます。
        </Alert>
      ) : null}

      <Alert severity="info" sx={{mb:2}}>現在の財務は提供元・対象期・取得時刻を確認できる値だけを使用します。財務に依存する旧スコア・推計評価は未確認です。</Alert>

      {/* Minervini rule 1 — the same market-regime banner the PC scan page
          shows; regime fields ride on every static scan row. Fed from the
          unfiltered set so the market context stays visible even when the
          active filters match nothing. */}
      <Alert severity="info" sx={{mb:2}}>{modelMarket(hydratedRows).label} · 新規資金の試行配分上限 {Math.min(modelMarket(hydratedRows).cap, .25)*100}% · <a href="#/" style={{display:'inline-flex',alignItems:'center'}}>本日の判断と共通の選定条件へ</a></Alert>

      {hydrationComplete && (!isMobile || mobileToolsOpen) && (
        <FilterPanel
          filters={filters}
          onFilterChange={setFilters}
          onReset={() => {
            setFilters(manifestDefaultFilters);
            setSortBy(manifestDefaultSortBy);
            setSortOrder(manifestDefaultSortOrder);
            if (screenParam) {
              handleSelectScreen(null);
            } else {
              setActiveScreenId(null);
            }
          }}
          filterOptions={normalizeScanFilterOptions(scanManifestQuery.data.filter_options)}
          expanded={isMobile || showFilters}
          onToggle={() => isMobile ? setMobileToolsOpen(false) : setShowFilters((previous) => !previous)}
          presetsEnabled={false}
          sectionDefaultExpanded={sectionDefaultExpanded}
        />
      )}

      <Box sx={{display:'flex',gap:1,alignItems:'center',my:1.5,'& > :first-of-type':{minWidth:0,flex:1}}}><ResearchSearch value={filters.symbolSearch || ''} onChange={searchRows} />{isMobile && <Button sx={{whiteSpace:'nowrap',minWidth:100,minHeight:44,flexShrink:0}} onClick={()=>setFullTable(v=>!v)}>{fullTable?'カード表示':'全項目の表'}</Button>}</Box>
      {isMobile && !fullTable ? <MobileScanResults rows={pagedRows} total={hydrationComplete?cappedRows.length:pagedRows.length} page={page} perPage={perPage} sortBy={sortBy} sortOrder={sortOrder} onSort={(field,order)=>{if(hydrationComplete){setSortBy(field);setSortOrder(order);setPage(1);}}} onPage={setPage} onOpenChart={handleOpenChart} isChartEnabled={isChartEnabled} /> : <ResultsTable
        results={pagedRows}
        total={hydrationComplete ? cappedRows.length : pagedRows.length}
        page={hydrationComplete ? page : 1}
        perPage={perPage}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onPageChange={hydrationComplete ? setPage : () => setPage(1)}
        onPerPageChange={hydrationComplete ? setPerPage : () => setPage(1)}
        onSortChange={(nextSortBy, nextSortOrder) => {
          if (!hydrationComplete) {
            return;
          }
          setSortBy(nextSortBy);
          setSortOrder(nextSortOrder);
          setPage(1);
        }}
        onOpenChart={chartsAvailable ? handleOpenChart : undefined}
        loading={false}
        showActions={chartsAvailable}
        showWatchlistMenu={false}
        isChartEnabled={isChartEnabled}
        sortingEnabled={hydrationComplete}
      />}

      <StaticChartViewerModal
        open={chartModalOpen}
        onClose={closeChartModal}
        initialSymbol={selectedChartSymbol}
        researchRows={hydratedRows}
        generation={generation}
        publication={marketEntry.publication}
        now={now}
        chartIndex={effectiveChartIndex}
        date={scanManifestQuery.data.as_of_date}
        navigationSymbols={navigationSymbols}
      />
    </Box>
  );
}

export default StaticScanPage;
