import { projectFinancialRow } from '../financialCurrent';
import { useFinancialClock } from '../useFinancialClock';
import { modelMarket } from '../portfolioPlan';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  CircularProgress,
  Grid,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useStaticManifest, fetchStaticJson, resolveStaticMarketEntry } from '../dataClient';
import { useStaticChartIndex } from '../chartClient';
import PriceSparkline from '../../components/Scan/PriceSparkline';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import StaticChartViewerModal from '../StaticChartViewerModal';
import RankChangeCell from '../../components/shared/RankChangeCell';
import TickerCell from '../../components/common/TickerCell';
import MarketRegimeBanner from '../../features/scan/components/MarketRegimeBanner';
import TodaysBuysCard from '../components/TodaysBuysCard';
import WatchlistCard from '../components/WatchlistCard';
import { MOTION, enterSlideFade } from '../../theme/motion';
import { formatLocalCurrency } from '../../utils/formatUtils';
import { useStaticMarket } from '../StaticMarketContext';
import { marketFlag } from '../marketFlags';
import { MARKET_CAP_OPTIONS } from '../../features/scan/components/filterPanel/constants';
import { applyScanFilterDefaults } from '../../features/scan/defaultFilters';
import { filterStaticScanRows, sortStaticScanRows } from '../scanClient';
import DailyScanRowsTable from '../components/DailyScanRowsTable';
import { buildFiltersFromPreset } from '../hooks/usePresetScreens';
import { GlossaryHeaderCell, useMetricInfoPopover } from '../../components/common/MetricInfoPopover';

const EMPTY_RESULTS = [];
const DEFAULT_TOP_RESULTS = 20;
const LEADERS_SCREEN_ID = 'leaders_in_leading_groups';

const formatNumber = (value, digits = 0) => {
  if (value == null) return '-';
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
};

function StaticHomePage() {
  const manifestQuery = useStaticManifest();
  const generation = manifestQuery.data?.research_generation || manifestQuery.data?.generated_at;
  const { selectedMarket } = useStaticMarket();
  const marketEntry = useMemo(
    () => resolveStaticMarketEntry(manifestQuery.data, selectedMarket),
    [manifestQuery.data, selectedMarket],
  );
  const homeQuery = useQuery({
    queryKey: ['staticHome', marketEntry.pages?.home?.path, generation],
    placeholderData: () => undefined,
    queryFn: () => fetchStaticJson(marketEntry.pages.home.path),
    enabled: Boolean(marketEntry.pages?.home?.path),
    staleTime: Infinity,
  });
  const scanBundleQuery = useQuery({
    queryKey: ['staticHomeScanRows', marketEntry.pages?.scan?.path, generation],
    placeholderData: () => undefined,
    queryFn: async () => {
      const scanManifest = await fetchStaticJson(marketEntry.pages.scan.path);
      const rowsBySymbol = new Map(
        (scanManifest.initial_rows || []).map((row) => [row.symbol, row])
      );
      const chunkPayloads = await Promise.all(
        (scanManifest.chunks || []).map((chunk) => fetchStaticJson(chunk.path))
      );
      chunkPayloads.forEach((payload) => {
        (payload.rows || []).forEach((row) => {
          rowsBySymbol.set(row.symbol, row);
        });
      });
      return {
        rows: Array.from(rowsBySymbol.values()),
        as_of_date: scanManifest.as_of_date,
        defaultFilters: scanManifest.default_filters || {},
        presetScreens: scanManifest.preset_screens || [],
      };
    },
    enabled: Boolean(marketEntry.pages?.scan?.path),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const chartIndexQuery = useStaticChartIndex(marketEntry.assets?.charts?.path);
  // チャートモーダルはURL（?chart=銘柄）と同期させる。
  // モーダルを開くと履歴が1つ積まれるため、ブラウザ/アプリの「戻る」で自然に閉じる。
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedChartSymbol = searchParams.get('chart');
  const chartModalOpen = Boolean(selectedChartSymbol);
  const closeChartModal = useCallback(() => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('chart');
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const [modalNavigationSymbols, setModalNavigationSymbols] = useState([]);
  const [marketCapMin, setMarketCapMin] = useState('');
  const { openInfo, popover: metricInfoPopover } = useMetricInfoPopover();
  const topGroups = homeQuery.data?.top_groups ?? EMPTY_RESULTS;
  const scanDefaultFilters = useMemo(
    () => scanBundleQuery.data?.defaultFilters ?? {},
    [scanBundleQuery.data?.defaultFilters]
  );
  const topCandidateFilters = useMemo(
    () => applyScanFilterDefaults({
      ...scanDefaultFilters,
      // Quality gate: pass the strict Minervini Trend Template AND the elite
      // leader thresholds the Minervini preset uses (RS>=90, within 10% of the
      // 52w high, top-half IBD group, Code 33 earnings acceleration), so the
      // headline list is a tight leaders-in-leading-groups short-list.
      passesTemplate: true,
      rsRating: { min: 90, max: null },
      week52HighDistance: { min: -10, max: null },
      ibdGroupRank: { min: null, max: 98 },
      code33: true,
      ...(marketCapMin !== '' ? { marketCapUsd: { min: Number(marketCapMin), max: null } } : {}),
    }),
    [marketCapMin, scanDefaultFilters]
  );
  // Technical reference list: current market defaults plus Trend Template and
  // RS >= 70, strongest RS first. These are not the historical backtest universe,
  // setup/portfolio gates, or a replay of its trades. Keep selection unchanged.
  const backtestAlignedFilters = useMemo(
    () => applyScanFilterDefaults({
      ...scanDefaultFilters,
      passesTemplate: true,
      rsRating: { min: 70, max: null },
      ...(marketCapMin !== '' ? { marketCapUsd: { min: Number(marketCapMin), max: null } } : {}),
    }),
    [marketCapMin, scanDefaultFilters]
  );
  const rawScanRows = scanBundleQuery.data?.rows ?? EMPTY_RESULTS;
  const now = useFinancialClock(rawScanRows);
  const scanRows = useMemo(() => rawScanRows.map(row => projectFinancialRow(row, { now, asOfDate: scanBundleQuery.data?.as_of_date, market: selectedMarket })), [rawScanRows, now, scanBundleQuery.data?.as_of_date, selectedMarket]);
  const financialUnknownCount = scanRows.filter(row => row.financial_current_state?.dependent_reason).length;
  const financialEmptyMessage = financialUnknownCount ? `財務・Code33の根拠が未確認の銘柄 ${financialUnknownCount}件。必要な条件を確認できず、現在の候補には数えていません。` : '現在の条件に一致する銘柄はありません。';
  const topResults = useMemo(() => {
    return sortStaticScanRows(
      filterStaticScanRows(scanRows, topCandidateFilters, { now }),
      'composite_score',
      'desc', { now }
    ).slice(0, DEFAULT_TOP_RESULTS);
  }, [scanRows, topCandidateFilters, now]);
  const backtestAlignedRows = useMemo(() => {
    return sortStaticScanRows(
      filterStaticScanRows(scanRows, backtestAlignedFilters, { now }),
      'rs_rating',
      'desc', { now }
    ).slice(0, DEFAULT_TOP_RESULTS);
  }, [scanRows, backtestAlignedFilters, now]);
  const leadingGroupScreen = useMemo(
    () => scanBundleQuery.data?.presetScreens?.find((screen) => screen.id === LEADERS_SCREEN_ID) ?? null,
    [scanBundleQuery.data?.presetScreens]
  );
  const leadingGroupRows = useMemo(() => {
    if (!leadingGroupScreen) {
      return EMPTY_RESULTS;
    }
    return sortStaticScanRows(
      filterStaticScanRows(scanRows, buildFiltersFromPreset(leadingGroupScreen), { now }),
      leadingGroupScreen.sort_by,
      leadingGroupScreen.sort_order,
      { prioritizeCompositeScanMode: false, now }
    ).slice(0, DEFAULT_TOP_RESULTS);
  }, [leadingGroupScreen, scanRows, now]);

  const chartEntries = useMemo(() => chartIndexQuery.data?.symbols || [], [chartIndexQuery.data]);
  const chartEnabledSymbols = useMemo(() => new Set(chartEntries.map((e) => e.symbol)), [chartEntries]);
  const topNavigationSymbols = useMemo(
    () => topResults.map((r) => r.symbol).filter((s) => chartEnabledSymbols.has(s)),
    [topResults, chartEnabledSymbols],
  );
  const leadingGroupNavigationSymbols = useMemo(
    () => leadingGroupRows.map((r) => r.symbol).filter((s) => chartEnabledSymbols.has(s)),
    [leadingGroupRows, chartEnabledSymbols],
  );
  const backtestAlignedNavigationSymbols = useMemo(
    () => backtestAlignedRows.map((r) => r.symbol).filter((s) => chartEnabledSymbols.has(s)),
    [backtestAlignedRows, chartEnabledSymbols],
  );
  const leadingGroupMinVolume = leadingGroupScreen?.filters?.minVolume;
  const leadingGroupSubtitle = leadingGroupMinVolume == null
    ? '上位20銘柄: グループ順位40位以内、RS 80以上。'
    : `上位20銘柄: グループ順位40位以内、RS 80以上、売買代金 ${formatNumber(leadingGroupMinVolume)} 以上。`;

  if (manifestQuery.isLoading || homeQuery.isLoading || scanBundleQuery.isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (manifestQuery.isError || homeQuery.isError || scanBundleQuery.isError) {
    return (
      <Alert severity="error">
        日次スナップショットの読み込みに失敗しました。
      </Alert>
    );
  }

  const home = homeQuery.data;
  const freshness = home?.freshness || {};
  const marketDisplay = home?.market_display_name || marketEntry.display_name;
  const flag = marketFlag(marketEntry.market);

  // When prices were last refreshed into this bundle. The fast post-close
  // publish updates prices minutes after the bell while scan ranks stay on
  // the previous full run, so this can be NEWER than スキャン — show both.
  const pricesGeneratedAt = freshness.prices_generated_at || home?.generated_at;
  const pricesUpdatedLabel = (() => {
    if (!pricesGeneratedAt) return null;
    const parsed = new Date(pricesGeneratedAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString('ja-JP', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  })();

  const handleRowClick = (symbol, navigationSymbols) => {
    if (chartEnabledSymbols.has(symbol)) {
      setModalNavigationSymbols(navigationSymbols);
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set('chart', symbol);
        return next;
      });
    }
  };

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          columnGap: 2,
          rowGap: 0.5,
          mb: 2,
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: '-0.5px' }}>
          {flag ? `${flag}  ` : ''}{marketDisplay} スナップショット
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontFamily: 'monospace', fontSize: '11px' }}
        >
          {`${pricesUpdatedLabel ? `価格更新 ${pricesUpdatedLabel} · ` : ''}スキャン ${freshness.scan_as_of_date || '-'} · 騰落 ${freshness.breadth_latest_date || '-'} · グループ ${freshness.groups_latest_date || '-'}`}
        </Typography>
      </Box>

      {/* Minervini rule 1 — same market-regime banner as the PC scan page,
          read off the loaded scan rows (regime fields ride on every row). */}
      <MarketRegimeBanner results={scanRows} researchExposure={Math.min(modelMarket(scanRows).cap,.25)*100} />

      {/* Saved sell-model observations do not establish actual holdings. */}
      <WatchlistCard
        indexData={chartIndexQuery.data}
        market={selectedMarket}
        onOpenChart={(symbol) => handleRowClick(symbol, (chartIndexQuery.data?.symbols || []).map((e) => e.symbol))}
      />

      {/* Dated technical observations; Research owns full purchase readiness. */}
      <TodaysBuysCard
        indexData={chartIndexQuery.data}
        scanRows={scanRows}
        market={selectedMarket}
        marketAsOf={scanBundleQuery.data?.as_of_date}
        onOpenChart={(symbol) => handleRowClick(symbol, (chartIndexQuery.data?.symbols || []).map((e) => e.symbol))}
      />

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {(home.key_markets || [])
          .map((item) => ({
            ...item,
            _closes: (item.history || []).map((h) => h.close).filter((c) => c != null),
          }))
          .filter((item) => item.latest_close != null && item._closes.length > 1)
          .map((item, cardIndex) => {
          const closes = item._closes;
          const trend = closes[closes.length - 1] > closes[0]
            ? 1
            : closes[closes.length - 1] < closes[0]
              ? -1
              : 0;
          return (
            <Grid item xs={12} sm={6} md={4} lg={2.4} key={item.symbol}>
              <Paper
                elevation={0}
                sx={{
                  p: 1.5,
                  height: '100%',
                  border: '1px solid',
                  borderColor: 'divider',
                  display: 'flex',
                  alignItems: 'stretch',
                  gap: 1.5,
                  ...enterSlideFade(cardIndex),
                  transition: `transform ${MOTION.duration.fast}ms ${MOTION.easing.standard}, border-color ${MOTION.duration.fast}ms ${MOTION.easing.standard}`,
                  '@media (hover: hover)': {
                    '&:hover': { transform: 'translateY(-2px)', borderColor: 'primary.main' },
                  },
                }}
              >
                <Box sx={{ flex: '0 0 auto', minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '13px' }}>
                    {item.symbol}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '11px' }}>
                    {item.display_name}
                  </Typography>
                  <Typography variant="body1" sx={{ mt: 0.5, fontFamily: 'monospace', fontWeight: 600 }}>
                    {formatLocalCurrency(item.latest_close, item.currency)}
                  </Typography>
                  <Box display="flex" alignItems="center" sx={{ mt: 0.5 }}>
                    {item.change_1d > 0 && <TrendingUpIcon sx={{ fontSize: 14, mr: 0.25, color: 'success.main' }} />}
                    {item.change_1d < 0 && <TrendingDownIcon sx={{ fontSize: 14, mr: 0.25, color: 'error.main' }} />}
                    <Typography
                      variant="body2"
                      sx={{
                        color: item.change_1d > 0 ? 'success.main' : item.change_1d < 0 ? 'error.main' : 'text.secondary',
                        fontFamily: 'monospace',
                        fontWeight: 600,
                        fontSize: '12px',
                      }}
                    >
                      {item.change_1d != null
                        ? `${item.change_1d > 0 ? '+' : ''}${formatNumber(item.change_1d, 2).replace(/^-/, '−')}%`
                        : '-'}
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'stretch' }}>
                  <PriceSparkline
                    data={closes}
                    trend={trend}
                    change1d={null}
                    width="100%"
                    height="100%"
                    showChange={false}
                  />
                </Box>
              </Paper>
            </Grid>
          );
        })}
      </Grid>

      <DailyScanRowsTable
        testId="top-scan-candidates-section"
        title="ミネルヴィニ合格 注目銘柄 トップ20"
        subtitle={
          topCandidateFilters.minVolume == null
            ? 'ミネルヴィニのトレンドテンプレート合格銘柄を合成スコア順に表示。行をクリックするとチャートが開きます。'
            : `トレンドテンプレート合格＋売買代金 ${formatNumber(topCandidateFilters.minVolume)} 以上。行をクリックするとチャートが開きます。`
        }
        rows={topResults}
        chartEnabledSymbols={chartEnabledSymbols}
        navigationSymbols={topNavigationSymbols}
        onOpenChart={handleRowClick}
        emptyMessage={financialEmptyMessage}
        showRating
        action={(
          <TextField
            select
            size="small"
            label="時価総額（下限）"
            value={marketCapMin}
            onChange={(event) => {
              const nextValue = event.target.value;
              setMarketCapMin(nextValue === '' ? '' : Number(nextValue));
            }}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">指定なし</MenuItem>
            {MARKET_CAP_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        )}
      />

      <DailyScanRowsTable
        testId="leaders-in-leading-groups-section"
        title="主導業種グループの主導銘柄"
        subtitle={leadingGroupSubtitle}
        rows={leadingGroupRows}
        chartEnabledSymbols={chartEnabledSymbols}
        navigationSymbols={leadingGroupNavigationSymbols}
        onOpenChart={handleRowClick}
        emptyMessage="現在のスナップショットに該当する主導銘柄はありません。"
        showRs
        priceSparklineWidth={195}
        priceSparklineInnerWidth={150}
      />

      {/* Technical reference only; shared thresholds do not establish backtest equivalence. */}
      <DailyScanRowsTable
        testId="backtest-aligned-section"
        title="テクニカル参考候補 トップ20"
        subtitle="現在のスナップショットから、トレンドテンプレート合格・RS 70以上をRS順に最大20銘柄表示。市場の既定フィルターと選択中の時価総額下限を適用します。過去の売買再現や現行手法の成績を示すリストではありません。"
        rows={backtestAlignedRows}
        chartEnabledSymbols={chartEnabledSymbols}
        navigationSymbols={backtestAlignedNavigationSymbols}
        onOpenChart={handleRowClick}
        emptyMessage="現在の条件に一致する銘柄はありません。"
        showRs
        priceSparklineWidth={195}
        priceSparklineInnerWidth={150}
      />

      <Paper elevation={0} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '13px', letterSpacing: '0.5px', mb: 0.5 }}>
          業種グループ トップ10
        </Typography>
        <TableContainer
          role="region"
          aria-label="業種グループ トップ10の表（横スクロール）"
          tabIndex={0}
          sx={{
            '& .MuiTableCell-head': { fontSize: '11px' },
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
          }}
        >
          <Table size="small" aria-label="業種グループ トップ10の表">
            <TableHead>
              <TableRow>
                <GlossaryHeaderCell glossaryId="group_rank" openInfo={openInfo}>順位</GlossaryHeaderCell>
                <GlossaryHeaderCell glossaryId="ibd_industry_group" openInfo={openInfo} align="left">業種グループ</GlossaryHeaderCell>
                <GlossaryHeaderCell glossaryId="group_rank_change_1w" openInfo={openInfo} align="right">1週</GlossaryHeaderCell>
                <GlossaryHeaderCell glossaryId="group_rank_change_1m" openInfo={openInfo} align="right">1ヶ月</GlossaryHeaderCell>
                <GlossaryHeaderCell glossaryId="group_top_stock" openInfo={openInfo} align="left">代表銘柄</GlossaryHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {topGroups.map((group) => (
                <TableRow key={group.industry_group}>
                  <TableCell align="center" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{group.rank}</TableCell>
                  <TableCell>{group.industry_group}</TableCell>
                  <TableCell align="right"><RankChangeCell value={group.rank_change_1w} /></TableCell>
                  <TableCell align="right"><RankChangeCell value={group.rank_change_1m} /></TableCell>
                  <TableCell>
                    <TickerCell symbol={group.top_symbol} companyName={group.top_symbol_name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <StaticChartViewerModal
        generation={generation}
        now={now}
        date={marketEntry.as_of_date}
        open={chartModalOpen}
        onClose={closeChartModal}
        initialSymbol={selectedChartSymbol}
        researchRows={scanRows}
        chartIndex={chartIndexQuery.data}
        navigationSymbols={modalNavigationSymbols}
      />
      {metricInfoPopover}
    </Box>
  );
}

export default StaticHomePage;
