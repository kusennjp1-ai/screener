import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  CircularProgress,
  Paper,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import FilterPanel from '../../components/Scan/FilterPanel';
import ResultsTable from '../../components/Scan/ResultsTable';
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
  const { selectedMarket } = useStaticMarket();
  const marketEntry = useMemo(
    () => resolveStaticMarketEntry(manifestQuery.data, selectedMarket),
    [manifestQuery.data, selectedMarket],
  );
  const scanManifestQuery = useQuery({
    queryKey: ['staticScanManifest', marketEntry.pages?.scan?.path],
    queryFn: () => fetchStaticJson(marketEntry.pages.scan.path),
    enabled: Boolean(marketEntry.pages?.scan?.path),
    staleTime: Infinity,
  });
  const chartIndexQuery = useStaticChartIndex(scanManifestQuery.data?.charts?.path);

  const theme = useTheme();
  // モバイルでは初期状態でフィルタを折りたたみ、結果テーブルをすぐ見られるようにする
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [filters, setFilters] = useState(buildDefaultScanFilters);
  const [showFilters, setShowFilters] = useState(!isMobile);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
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
  const presetScreens = scanManifestQuery.data?.preset_screens;

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
      setHydrationState({
        status: 'complete',
        rows: initialRows,
        loadedRows: initialLoadedRows,
        error: null,
      });
      return undefined;
    }

    setHydrationState({
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
          const payloads = await Promise.all(batch.map((chunk) => fetchStaticJson(chunk.path)));
          if (cancelled) {
            return;
          }

          payloads.forEach((payload) => {
            (payload.rows || []).forEach((row) => {
              rowsBySymbol.set(row.symbol, row);
            });
          });

          setHydrationState({
            status: rowsBySymbol.size >= totalRows ? 'complete' : 'loading',
            rows: Array.from(rowsBySymbol.values()),
            loadedRows: Math.min(rowsBySymbol.size, totalRows),
            error: null,
          });
        }

        if (!cancelled) {
          setHydrationState({
            status: 'complete',
            rows: Array.from(rowsBySymbol.values()),
            loadedRows: Math.min(rowsBySymbol.size, totalRows),
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          const accumulatedRows = Array.from(rowsBySymbol.values());
          setHydrationState({
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
  }, [scanManifestQuery.data]);

  const hydrationComplete = hydrationState.status === 'complete';
  const hydratedRows = hydrationState.rows;
  const { activeScreenId, setActiveScreenId, matchCounts } = usePresetScreens({
    screens: presetScreens,
    allRows: hydratedRows,
    hydrationComplete,
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
    () => chartIndexQuery.data?.symbols || [],
    [chartIndexQuery.data]
  );
  const chartEnabledSymbols = useMemo(
    () => new Set(chartEntries.map((entry) => entry.symbol)),
    [chartEntries]
  );
  const filteredRows = useMemo(
    () => (hydrationComplete ? filterStaticScanRows(hydratedRows, filters) : hydratedRows),
    [filters, hydratedRows, hydrationComplete]
  );
  const sortedRows = useMemo(
    () => (
      hydrationComplete
        ? sortStaticScanRows(filteredRows, sortBy, sortOrder, {
          prioritizeCompositeScanMode: !activeScreenId,
        })
        : filteredRows
    ),
    [activeScreenId, filteredRows, hydrationComplete, sortBy, sortOrder]
  );
  const pagedRows = useMemo(
    () => (hydrationComplete ? paginateStaticScanRows(sortedRows, page, perPage) : filteredRows),
    [filteredRows, hydrationComplete, page, perPage, sortedRows]
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
    const orderedRows = hydrationComplete ? sortedRows : pagedRows;
    return orderedRows
      .map((row) => row.symbol)
      .filter((symbol) => chartEnabledSymbols.has(symbol));
  }, [chartEnabledSymbols, hydrationComplete, pagedRows, sortedRows]);

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
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: '-0.5px', mb: 0.5 }}>
        デイリースキャン
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: '12px' }}>
        基準日 {scanManifestQuery.data.as_of_date}（実行ID: {scanManifestQuery.data.run_id}）
      </Typography>

      <Paper elevation={0} sx={{ p: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider' }}>
        <Box display="flex" alignItems="baseline" gap={1.5}>
          <Typography variant="body1" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
            {(hydrationComplete ? filteredRows.length : hydrationState.loadedRows).toLocaleString()}
          </Typography>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '10px' }}>
            件 / 全 {scanManifestQuery.data.rows_total.toLocaleString()} 件
            {scanManifestQuery.data.charts?.available
              ? ` · チャート ${(scanManifestQuery.data.charts.symbols_total ?? scanManifestQuery.data.charts.limit).toLocaleString()} 銘柄`
              : ''}
          </Typography>
        </Box>
      </Paper>

      {hydrationComplete && presetScreens?.length > 0 && (
        <ScreenSelector
          screens={presetScreens}
          activeScreenId={activeScreenId}
          onSelectScreen={handleSelectScreen}
          matchCounts={matchCounts}
        />
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

      {hydrationComplete && (
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
          expanded={showFilters}
          onToggle={() => setShowFilters((previous) => !previous)}
          presetsEnabled={false}
          sectionDefaultExpanded={sectionDefaultExpanded}
        />
      )}

      <ResultsTable
        results={pagedRows}
        total={hydrationComplete ? sortedRows.length : pagedRows.length}
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
      />

      <StaticChartViewerModal
        open={chartModalOpen}
        onClose={closeChartModal}
        initialSymbol={selectedChartSymbol}
        chartIndex={chartIndexQuery.data}
        navigationSymbols={navigationSymbols}
      />
    </Box>
  );
}

export default StaticScanPage;
