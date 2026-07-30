import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
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
import MarketRegimeBand from '../components/MarketRegimeBand';
import TodaysBuysCard from '../components/TodaysBuysCard';
import StaticDataStatusBanner from '../components/StaticDataStatusBanner';
import WatchlistCard from '../components/WatchlistCard';
import StrategyScorecardCard from '../components/StrategyScorecardCard';
import { MOTION, enterSlideFade } from '../../theme/motion';
import { formatLocalCurrency } from '../../utils/formatUtils';
import { useStaticMarket } from '../StaticMarketContext';
import { marketFlag } from '../marketFlags';
import { marketNameJa } from '../marketNames';
import { MARKET_CAP_OPTIONS } from '../../features/scan/components/filterPanel/constants';
import { applyScanFilterDefaults } from '../../features/scan/defaultFilters';
import { filterStaticScanRows, sortStaticScanRows } from '../scanClient';
import DailyScanRowsTable from '../components/DailyScanRowsTable';
import { buildFiltersFromPreset } from '../hooks/usePresetScreens';
import { GlossaryHeaderCell, useMetricInfoPopover } from '../../components/common/MetricInfoPopover';
import { C, T, W, px } from '../designTokens';

const EMPTY_RESULTS = [];
const DEFAULT_TOP_RESULTS = 20;
const LEADERS_SCREEN_ID = 'leaders_in_leading_groups';
// backtest_minervini_tactics.py::MIN_DOLLAR_VOL — the liquidity floor the
// validated backtest actually applies to its candidate pool.
const BACKTEST_MIN_DOLLAR_VOLUME = 5_000_000;

const formatNumber = (value, digits = 0) => {
  if (value == null) return '-';
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
};

const fmtPct = (value, digits = 1) => (
  value == null || Number.isNaN(Number(value))
    ? '—'
    : `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(digits)}%`
);

/**
 * A section with nothing in it earns a 36px title bar, not a card full of
 * chrome around an empty table. Four of these used to render simultaneously —
 * ~1100px of borders and prose wrapped around zero rows, with the empty message
 * itself cut off because a 540px <table> sat inside a 317px scroller.
 *
 * A zero-row snapshot collapses (tap to read why); a FAILED or still-loading
 * fetch stays open, because that message is the whole point of the section.
 */
function EmptySectionBar({ testId, title, statusLabel, message, note, alwaysOpen = false }) {
  const [open, setOpen] = useState(false);
  const expanded = alwaysOpen || open;
  return (
    <Paper
      data-testid={testId}
      elevation={0}
      sx={{ mb: 1, border: '1px solid', borderColor: 'divider' }}
    >
      <Box
        component={alwaysOpen ? 'div' : 'button'}
        type={alwaysOpen ? undefined : 'button'}
        onClick={alwaysOpen ? undefined : () => setOpen((value) => !value)}
        aria-expanded={alwaysOpen ? undefined : expanded}
        data-testid={`${testId}-toggle`}
        sx={{
          width: '100%',
          // A collapsed section is still a control the finger must hit: 44px
          // (WCAG 2.5.5), not the 36px that only suited the label's height.
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          py: 0.5,
          background: 'none',
          border: 0,
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          cursor: alwaysOpen ? 'default' : 'pointer',
        }}
      >
        <Typography sx={{ fontSize: px(T.micro), fontWeight: W.bold, color: C.inkStrong, lineHeight: 1.3, minWidth: 0 }}>
          {title}
        </Typography>
        <Typography sx={{ fontSize: px(T.micro), fontFamily: 'monospace', color: C.grey, flexShrink: 0 }}>
          — {statusLabel}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {!alwaysOpen && (
          <Typography sx={{ fontSize: px(T.micro), color: C.grey, flexShrink: 0 }}>
            {expanded ? '▾' : '▸'}
          </Typography>
        )}
      </Box>
      {expanded && (
        <Box sx={{ px: 1.25, pb: 1.25 }}>
          <Typography sx={{ fontSize: px(T.micro), color: C.ink, lineHeight: 1.6 }}>{message}</Typography>
          {note && (
            <Typography sx={{ fontSize: px(T.micro), color: C.dim, lineHeight: 1.5, mt: 0.5 }}>{note}</Typography>
          )}
        </Box>
      )}
    </Paper>
  );
}

/**
 * The strategy scorecard is a 568px receipt for a claim the user already
 * accepted; it does not belong between the market verdict and today's buys.
 * It now lives BELOW the buy list behind this one-line summary — the headline
 * numbers stay visible, the detail (including the 訂正) is one tap away.
 */
function ScorecardSummaryRow({ data }) {
  const [open, setOpen] = useState(false);
  const m = data?.metrics;
  if (!m) return null;
  const expectancy = m.payoff_distribution?.expectancy_r;
  return (
    <Box sx={{ mb: 2 }}>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="検証実績の詳細（訂正を含む）"
        data-testid="scorecard-summary-row"
        sx={{
          width: '100%',
          // 44px so the row is a real tap target (WCAG 2.5.5), and wrapping so
          // the three metrics can take a second line rather than pushing the
          // page 7px wider than the phone — at 12px they no longer fit on one.
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          rowGap: 0.25,
          gap: 0.75,
          px: 1.25,
          py: 0.5,
          borderRadius: 1.5,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: C.panel,
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <Typography sx={{ fontSize: px(T.micro), fontWeight: W.bold, color: C.inkStrong, flexShrink: 0 }}>
          検証実績 {open ? '▾' : '▸'}
        </Typography>
        <Typography sx={{
          fontSize: px(T.micro), fontFamily: 'monospace', color: C.grey, lineHeight: 1.4,
          minWidth: 0,
        }}>
          {`CAGR ${fmtPct(m.cagr_pct)} · 最大DD ${fmtPct(m.max_drawdown_pct)}`}
          {expectancy != null ? ` · 期待値 ${Number(expectancy).toFixed(2)}R` : ''}
        </Typography>
      </Box>
      {open && (
        <Box sx={{ mt: 1 }}>
          <StrategyScorecardCard data={data} />
        </Box>
      )}
    </Box>
  );
}

function StaticHomePage() {
  const manifestQuery = useStaticManifest();
  const { selectedMarket } = useStaticMarket();
  const marketEntry = useMemo(
    () => resolveStaticMarketEntry(manifestQuery.data, selectedMarket),
    [manifestQuery.data, selectedMarket],
  );
  const homeQuery = useQuery({
    queryKey: ['staticHome', marketEntry.pages?.home?.path],
    queryFn: () => fetchStaticJson(marketEntry.pages.home.path),
    enabled: Boolean(marketEntry.pages?.home?.path),
    staleTime: Infinity,
  });
  const scanBundleQuery = useQuery({
    queryKey: ['staticHomeScanRows', marketEntry.pages?.scan?.path],
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
        defaultFilters: scanManifest.default_filters || {},
        presetScreens: scanManifest.preset_screens || [],
      };
    },
    enabled: Boolean(marketEntry.pages?.scan?.path),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const chartIndexQuery = useStaticChartIndex(marketEntry.assets?.charts?.path);
  // Strategy scorecard (C95): a root-level backtest snapshot, shown in the
  // agreed priority order. Independent of the daily market export and refreshed
  // only when the tactics backtest reruns — fail soft to null so the card just
  // disappears if the file is not published yet.
  const scorecardQuery = useQuery({
    queryKey: ['staticStrategyScorecard'],
    queryFn: async () => {
      // Baked into the app build as a tracked public asset (not the pipeline-
      // generated static-data/), refreshed only when the tactics backtest reruns.
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}strategy-scorecard.json`, {
          headers: { Accept: 'application/json' },
        });
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

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
      // Distance below the 52-week high is stored as a POSITIVE percent, so
      // "within 10% of the high" is an upper bound. A lower bound of -10 passed
      // every row and silently disabled this Trend Template leg.
      week52HighDistance: { min: null, max: 10 },
      ibdGroupRank: { min: null, max: 98 },
      code33: true,
      ...(marketCapMin !== '' ? { marketCapUsd: { min: Number(marketCapMin), max: null } } : {}),
    }),
    [marketCapMin, scanDefaultFilters]
  );
  // Backtest-aligned candidate list (C97): the SAME pool the +15.2% 6-year
  // backtest (full_tactics) actually picks from — the strict 8-point Trend
  // Template plus RS >= 70 — with NO fundamental/group gate, strongest RS first.
  // Kept ALONGSIDE the quality-leader headline above (C93) so both views exist:
  // the strict leaders the user asked for, and the exact names the backtest trades.
  const backtestAlignedFilters = useMemo(
    () => applyScanFilterDefaults({
      ...scanDefaultFilters,
      passesTemplate: true,
      rsRating: { min: 70, max: null },
      // The market default is a USD 100M dollar-volume floor — 20x the
      // backtest's own MIN_DOLLAR_VOL of 5M — so inheriting it would drop most
      // of the pool this list claims to mirror. Match the backtest instead.
      minVolume: BACKTEST_MIN_DOLLAR_VOLUME,
      ...(marketCapMin !== '' ? { marketCapUsd: { min: Number(marketCapMin), max: null } } : {}),
    }),
    [marketCapMin, scanDefaultFilters]
  );
  const scanRows = scanBundleQuery.data?.rows ?? EMPTY_RESULTS;
  const topResults = useMemo(() => {
    return sortStaticScanRows(
      filterStaticScanRows(scanRows, topCandidateFilters),
      'composite_score',
      'desc'
    ).slice(0, DEFAULT_TOP_RESULTS);
  }, [scanRows, topCandidateFilters]);
  const backtestAlignedRows = useMemo(() => {
    // Order the way the ADOPTED backtest configuration fills its limited slots
    // (--quality-rank, confirmed on both windows: CAGR 10.4->10.7 over 5y and
    // 11.0->11.5 over 9y with no drawdown cost): a detected VCP base outranks
    // the looser fallback bases, ties broken by RS descending. Sorting by RS
    // alone mirrored the pre-adoption default.
    const filtered = filterStaticScanRows(scanRows, backtestAlignedFilters);
    const rank = (row) => (row?.vcp_detected ? 0 : 1);
    const rs = (row) => (row?.rs_rating == null ? -Infinity : Number(row.rs_rating));
    return [...filtered]
      .sort((a, b) => rank(a) - rank(b) || rs(b) - rs(a) || String(a.symbol).localeCompare(String(b.symbol)))
      .slice(0, DEFAULT_TOP_RESULTS);
  }, [scanRows, backtestAlignedFilters]);
  const leadingGroupScreen = useMemo(
    () => scanBundleQuery.data?.presetScreens?.find((screen) => screen.id === LEADERS_SCREEN_ID) ?? null,
    [scanBundleQuery.data?.presetScreens]
  );
  const leadingGroupRows = useMemo(() => {
    if (!leadingGroupScreen) {
      return EMPTY_RESULTS;
    }
    return sortStaticScanRows(
      filterStaticScanRows(scanRows, buildFiltersFromPreset(leadingGroupScreen)),
      leadingGroupScreen.sort_by,
      leadingGroupScreen.sort_order,
      { prioritizeCompositeScanMode: false }
    ).slice(0, DEFAULT_TOP_RESULTS);
  }, [leadingGroupScreen, scanRows]);

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
  // The scan bundle feeds every candidate table, so its state — loading, failed,
  // or simply empty — has to be told apart in the table's own empty slot.
  const scanEmptyMessage = scanBundleQuery.isError
    ? 'スキャン結果を読み込めませんでした。上の再試行を押してください。'
    : scanBundleQuery.isLoading
      ? '読み込み中…'
      : '現在の条件に一致する銘柄はありません。';
  const leadingGroupSubtitle = leadingGroupMinVolume == null
    ? '上位20銘柄: グループ順位40位以内、RS 80以上。'
    : `上位20銘柄: グループ順位40位以内、RS 80以上、売買代金 ${formatNumber(leadingGroupMinVolume)} 以上。`;
  const topCandidateSubtitle = topCandidateFilters.minVolume == null
    ? 'ミネルヴィニのトレンドテンプレート合格銘柄を合成スコア順に表示。行をクリックするとチャートが開きます。'
    : `トレンドテンプレート合格＋売買代金 ${formatNumber(topCandidateFilters.minVolume)} 以上。行をクリックするとチャートが開きます。`;
  const backtestAlignedSubtitle = 'トレンドテンプレート合格＋RS 70以上＋売買代金 500万ドル以上を、VCP検出を優先しRSの高い順に表示（検証で採用した並び順）。過去データ検証が候補を選ぶときと同じ条件で、業績・業種の追加関門はかけていません（検証側はさらに値幅1.5%以上の条件も使うため、完全一致ではありません）。行をクリックするとチャートが開きます。';
  // A zero-row section collapses to a title bar; a failed or still-loading
  // fetch keeps its message open, because that message IS the content.
  const scanFetchUnresolved = scanBundleQuery.isError || scanBundleQuery.isLoading;
  const scanStatusLabel = scanBundleQuery.isError
    ? '読み込み失敗'
    : scanBundleQuery.isLoading ? '読み込み中' : '0件';

  // C98 — partial degradation. A failed fetch must cost the user exactly the
  // sections it feeds, never the whole page: the old code returned a single red
  // line and the entire product disappeared. Spin only while NOTHING has landed
  // yet; after that every section renders from whatever data it has.
  const dataPending = manifestQuery.isLoading || (homeQuery.isLoading && scanBundleQuery.isLoading);
  const failures = [];
  if (manifestQuery.isError) {
    failures.push({
      key: 'manifest',
      label: 'マーケット一覧',
      impact: '市場の切り替えと、各データの保存場所が読めません。',
      retry: manifestQuery.refetch,
    });
  }
  if (homeQuery.isError) {
    failures.push({
      key: 'home',
      label: '主要指数と業種グループ',
      impact: '指数カードと業種グループ トップ10は空になります。',
      retry: homeQuery.refetch,
    });
  }
  if (scanBundleQuery.isError) {
    failures.push({
      key: 'scan',
      label: 'スキャン結果',
      impact: '候補リストと地合い判定は空になります。',
      retry: scanBundleQuery.refetch,
    });
  }

  if (dataPending && !failures.length) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
      </Box>
    );
  }

  const home = homeQuery.data;
  const freshness = home?.freshness || {};
  // home.market_display_name もバックエンド由来の英語なので、見出しには使わない。
  // 市場名は marketNames の 1 か所だけで日本語化する（ブレッドス・業種グループ
  // の見出しと必ず同じ表記になる）。
  const marketDisplay = marketNameJa(marketEntry.market, home?.market_display_name || marketEntry.display_name);
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

  // One line, only the fields this snapshot actually has. Printing "騰落 - ·
  // グループ -" wrapped the header onto a second row to say nothing.
  const freshnessLabel = [
    pricesUpdatedLabel ? `価格 ${pricesUpdatedLabel}` : null,
    freshness.scan_as_of_date ? `スキャン ${freshness.scan_as_of_date}` : null,
    freshness.breadth_latest_date ? `騰落 ${freshness.breadth_latest_date}` : null,
    freshness.groups_latest_date ? `グループ ${freshness.groups_latest_date}` : null,
  ].filter(Boolean).join(' · ') || 'データ日付 不明';

  // The date the whole snapshot speaks for. Prefer the scan date the export
  // stamps; fall back to the manifest / chart index so the freshness check still
  // works when the home payload is the thing that failed.
  const snapshotAsOfDate = freshness.scan_as_of_date
    || marketEntry.as_of_date
    || chartIndexQuery.data?.as_of_date
    || null;

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
      {/* One compact header line — the old h5 + 4-field freshness string cost
          100px of the first screen and pushed the buy list under the fold. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          columnGap: 1.5,
          rowGap: 0.25,
          mb: 1,
        }}
      >
        <Typography sx={{ fontWeight: W.bold, fontSize: px(T.heading), letterSpacing: '-0.3px', lineHeight: 1.3 }}>
          {flag ? `${flag}  ` : ''}{marketDisplay} スナップショット
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontFamily: 'monospace', fontSize: px(T.micro) }}
        >
          {freshnessLabel}
        </Typography>
      </Box>

      {/* Minervini rule 1, stated before anything else: is the market buyable
          today? Reads the regime fields that ride on every scan row. */}
      <MarketRegimeBand results={scanRows} />

      {/* C98: what failed, what it costs, how to retry — plus the offline /
          stale-snapshot warning. Renders nothing when everything is healthy. */}
      <StaticDataStatusBanner
        failures={failures}
        asOfDate={snapshotAsOfDate}
        market={marketEntry.market}
      />

      {/* The decision block — everything above it is a gate, everything below
          it is evidence. Nothing may be inserted before this slot. */}
      <Box data-testid="buy-list-slot">
        {/* C86: held/watched names first — the exit is the edge. Surfaces each
            watched symbol's exported sell action + stop, most-urgent first. */}
        <WatchlistCard
          indexData={chartIndexQuery.data}
          onOpenChart={(symbol) => handleRowClick(symbol, (chartIndexQuery.data?.symbols || []).map((e) => e.symbol))}
        />

        {/* C83: one-glance buy decisions — market gate, buy zone (pivot..+5%),
            risk_plan stop/size, ordered best-setup-first. Rows open the chart. */}
        <TodaysBuysCard
          indexData={chartIndexQuery.data}
          market={marketEntry.market}
          scanRows={scanRows}
          onOpenChart={(symbol) => handleRowClick(symbol, (chartIndexQuery.data?.symbols || []).map((e) => e.symbol))}
        />
      </Box>

      {/* C95: the strategy's long-run scorecard (CAGR > maxDD > risk-adjusted >
          expectancy > win rate, plus the 訂正). Now BELOW the buy list behind a
          one-line summary — it is a receipt, not a decision. */}
      <ScorecardSummaryRow data={scorecardQuery.data} />

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {(home?.key_markets || [])
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
                  <Typography variant="body2" sx={{ fontWeight: W.semibold, fontSize: px(T.body) }}>
                    {item.symbol}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: px(T.micro) }}>
                    {item.display_name}
                  </Typography>
                  <Typography variant="body1" sx={{ mt: 0.5, fontFamily: 'monospace', fontWeight: W.semibold }}>
                    {formatLocalCurrency(item.latest_close, item.currency)}
                  </Typography>
                  <Box display="flex" alignItems="center" sx={{ mt: 0.5 }}>
                    {item.change_1d > 0 && <TrendingUpIcon sx={{ fontSize: px(T.strong), mr: 0.25, color: 'success.main' }} />}
                    {item.change_1d < 0 && <TrendingDownIcon sx={{ fontSize: px(T.strong), mr: 0.25, color: 'error.main' }} />}
                    <Typography
                      variant="body2"
                      sx={{
                        color: item.change_1d > 0 ? 'success.main' : item.change_1d < 0 ? 'error.main' : 'text.secondary',
                        fontFamily: 'monospace',
                        fontWeight: W.semibold,
                        fontSize: px(T.micro),
                      }}
                    >
                      {item.change_1d != null
                        ? `${item.change_1d > 0 ? '+' : ''}${formatNumber(item.change_1d, 2)}%`
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

      {topResults.length === 0 ? (
        <EmptySectionBar
          testId="top-scan-candidates-section"
          title="ミネルヴィニ合格 注目銘柄 トップ20"
          statusLabel={scanStatusLabel}
          message={scanEmptyMessage}
          note={topCandidateSubtitle}
          alwaysOpen={scanFetchUnresolved}
        />
      ) : (
        <DailyScanRowsTable
          testId="top-scan-candidates-section"
          title="ミネルヴィニ合格 注目銘柄 トップ20"
          subtitle={topCandidateSubtitle}
          rows={topResults}
          chartEnabledSymbols={chartEnabledSymbols}
          navigationSymbols={topNavigationSymbols}
          onOpenChart={handleRowClick}
          emptyMessage={scanEmptyMessage}
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
      )}

      {leadingGroupRows.length === 0 ? (
        <EmptySectionBar
          testId="leaders-in-leading-groups-section"
          title="主導業種グループの主導銘柄"
          statusLabel={scanStatusLabel}
          message={scanFetchUnresolved
            ? scanEmptyMessage
            : '現在のスナップショットに該当する主導銘柄はありません。'}
          note={leadingGroupSubtitle}
          alwaysOpen={scanFetchUnresolved}
        />
      ) : (
        <DailyScanRowsTable
          testId="leaders-in-leading-groups-section"
          title="主導業種グループの主導銘柄"
          subtitle={leadingGroupSubtitle}
          rows={leadingGroupRows}
          chartEnabledSymbols={chartEnabledSymbols}
          navigationSymbols={leadingGroupNavigationSymbols}
          onOpenChart={handleRowClick}
          emptyMessage={scanEmptyMessage}
          showRs
          priceSparklineWidth={195}
          priceSparklineInnerWidth={150}
        />
      )}

      {/* C97: the exact pool the +15.2% 6-year backtest picks from — Trend
          Template + RS>=70, strongest RS first, NO fundamental/group gate. Sits
          beside the strict leaders list so both the quality view and the
          backtest-faithful view are available. */}
      {backtestAlignedRows.length === 0 ? (
        <EmptySectionBar
          testId="backtest-aligned-section"
          title="バックテスト準拠候補（検証と同じ選び方）"
          statusLabel={scanStatusLabel}
          message={scanEmptyMessage}
          note={backtestAlignedSubtitle}
          alwaysOpen={scanFetchUnresolved}
        />
      ) : (
        <DailyScanRowsTable
          testId="backtest-aligned-section"
          title="バックテスト準拠候補（検証と同じ選び方）"
          subtitle={backtestAlignedSubtitle}
          rows={backtestAlignedRows}
          chartEnabledSymbols={chartEnabledSymbols}
          navigationSymbols={backtestAlignedNavigationSymbols}
          onOpenChart={handleRowClick}
          emptyMessage={scanEmptyMessage}
          showRs
          priceSparklineWidth={195}
          priceSparklineInnerWidth={150}
        />
      )}

      {topGroups.length === 0 ? (
        <EmptySectionBar
          testId="top-groups-section"
          title="業種グループ トップ10"
          statusLabel={homeQuery.isError ? '読み込み失敗' : homeQuery.isLoading ? '読み込み中' : '0件'}
          message={homeQuery.isError
            ? '業種グループを読み込めませんでした。上の再試行を押してください。'
            : homeQuery.isLoading ? '読み込み中…' : '業種グループのデータがありません。'}
          alwaysOpen={homeQuery.isError || homeQuery.isLoading}
        />
      ) : (
      <Paper elevation={0} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider' }} data-testid="top-groups-section">
        <Typography variant="subtitle1" sx={{ fontWeight: W.semibold, fontSize: px(T.body), letterSpacing: '0.5px', mb: 0.5 }}>
          業種グループ トップ10
        </Typography>
        <TableContainer>
          <Table size="small">
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
                  <TableCell align="center" sx={{ fontFamily: 'monospace', fontWeight: W.semibold }}>{group.rank}</TableCell>
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
      )}

      <StaticChartViewerModal
        open={chartModalOpen}
        onClose={closeChartModal}
        initialSymbol={selectedChartSymbol}
        chartIndex={chartIndexQuery.data}
        navigationSymbols={modalNavigationSymbols}
      />
      {metricInfoPopover}
    </Box>
  );
}

export default StaticHomePage;
