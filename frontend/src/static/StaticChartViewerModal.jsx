import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Fade,
  IconButton,
  Modal,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import CandlestickChart from '../components/Charts/CandlestickChart';
import BuyingNowCard from '../features/markets360/components/BuyingNowCard';
import SellPlanCard from '../features/markets360/components/SellPlanCard';
import SignalBadges from '../features/markets360/components/SignalBadges';
import BuyChecklist from '../components/Scan/BuyChecklist';
import StockMetricsSidebar from '../components/Scan/StockMetricsSidebar';
import TradingViewBridge from './components/TradingViewBridge';
import TrendTemplateScorecard from './components/TrendTemplateScorecard';
import { useStaticMarket } from './StaticMarketContext';
import { EXECUTION_STATE_LABEL, EXECUTION_STATE_COLOR } from '../components/Charts/executionState';
import GlossaryLabel from '../components/common/GlossaryLabel';
import { getGroupRankColor } from '../utils/colorUtils';
import { useChartNavigation } from '../hooks/useChartNavigation';
import { fetchStaticChartPayload, staticChartKeys } from './chartClient';
import { C, T, W, px } from './designTokens';

const CHART_INFO_STRIP_HEIGHT = 34;

// 共有された ?chart=XXX（ハッシュより前のクエリ）をハッシュ形式に書き換える。
// アプリは HashRouter なので、この形のリンクはそのままだとホームに落ちる。
// import 時に一度だけ走らせる（モーダル自身はマウントされないため）。
export function redirectLegacyChartQuery(loc = typeof window === 'undefined' ? null : window.location) {
  if (!loc || !loc.search || !loc.search.includes('chart=')) return false;
  if ((loc.hash || '').includes('chart=')) return false;
  const symbol = new URLSearchParams(loc.search).get('chart');
  if (!symbol) return false;
  loc.replace(`${loc.pathname}#/?chart=${encodeURIComponent(symbol)}`);
  return true;
}

redirectLegacyChartQuery();

// MA colours must match createPriceChartSeries.js.
const SHORT_EMA_LABELS = new Set(['EMA10', 'EMA20', 'EMA50']);
const MA_LEGEND = [
  ['EMA10', '#E0E0E0'],
  ['EMA20', '#4DD0E1'],
  ['EMA50', '#FFEE58'],
  ['SMA50', '#BA68C8'],
  ['SMA150', '#F06292'],
  ['SMA200', '#FF5252'],
  ['収益', '#2EAD5B'],
];

// Single-line strip rendered ABOVE the chart: MA legend + Minervini trend-template
// readout. Kept out of the plotting area so it never hides recent candles.

// Tap-to-explain legend for the three MM360 bands.
const BAND_EXPLANATIONS = [
  ['Pressure', '買い圧力 vs 売り圧力。蓄積/分散（AD）ラインの傾きで判定。緑=買い優勢、黄=中立、赤=売り優勢。'],
  ['Buy Risk', '今買うことのリスク。50日線からの乖離をATRで正規化し、VCP収縮で低下、50日線割れで高に。緑=低（押し目）、黄=中、赤=高（過伸び）。'],
  ['TPR', 'トレンドテンプレートの充足度（最大8条件、ベンチマーク無しは7条件）。緑=強、黄=移行、赤=弱。'],
];

function BandLegend() {
  return (
    <Box
      sx={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        py: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.default',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
      }}
    >
      <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>バンド:</Typography>
      {BAND_EXPLANATIONS.map(([label, desc]) => (
        <Tooltip key={label} title={desc} arrow enterTouchDelay={0} leaveTouchDelay={6000}>
          <Chip
            label={label}
            size="small"
            variant="outlined"
            sx={{ height: 20, fontSize: px(T.micro), cursor: 'pointer' }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}

// チャートに重ねる補助ラインのオン/オフ。モバイルは既定オフ——RSラインは
// 価格パネルの中に描かれるためロウソクと交差して読みにくい。
function OverlayToggles({ rsOn, epsOn, emaOn, onToggleRs, onToggleEps, onToggleEma }) {
  return (
    <Box
      sx={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        py: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.default',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
      }}
    >
      <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>重ね表示:</Typography>
      <Chip
        label="RSライン"
        size="small"
        variant={rsOn ? 'filled' : 'outlined'}
        color={rsOn ? 'primary' : 'default'}
        onClick={onToggleRs}
        sx={{ height: 22, minHeight: 44, fontSize: px(T.micro) }}
      />
      <Chip
        label="収益ライン"
        size="small"
        variant={epsOn ? 'filled' : 'outlined'}
        color={epsOn ? 'primary' : 'default'}
        onClick={onToggleEps}
        sx={{ height: 22, minHeight: 44, fontSize: px(T.micro) }}
      />
      <Chip
        label="短期線 10/20/50"
        size="small"
        variant={emaOn ? 'filled' : 'outlined'}
        color={emaOn ? 'primary' : 'default'}
        onClick={onToggleEma}
        sx={{ height: 22, minHeight: 44, fontSize: px(T.micro) }}
      />
    </Box>
  );
}

function ChartInfoStrip({ minerviniInfo, showEpsLine = true, showShortEmas = true }) {
  const i = minerviniInfo || {};
  return (
    <Box
      sx={{
        height: CHART_INFO_STRIP_HEIGHT,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 1,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.default',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        fontFamily: 'monospace',
        fontSize: px(T.micro),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        {MA_LEGEND
          .filter(([label]) => showEpsLine || label !== '収益')
          .filter(([label]) => showShortEmas || !SHORT_EMA_LABELS.has(label))
          .map(([label, color]) => (
          <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
            <Box sx={{ width: 12, height: 2, bgcolor: color, borderRadius: 1 }} />
            <span style={{ color: '#cfcfcf' }}>{label}</span>
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
        {i.passesTemplate != null && (
          <span style={{ color: i.passesTemplate ? '#4CF64D' : '#E619CD', fontWeight: W.bold }}>
            {i.templateScore != null && i.templateMax != null
              ? `テンプレート ${i.templateScore}/${i.templateMax}`
              : (i.passesTemplate ? '✓ テンプレート合格' : '✗ テンプレート不合格')}
          </span>
        )}
        {i.rsRating != null && (
          <span style={{ color: i.rsRating >= 70 ? '#4CF64D' : '#bbb' }}>
            <GlossaryLabel term="rs_rating">RS</GlossaryLabel> {Math.round(i.rsRating)}
          </span>
        )}
        {i.stage != null && (
          <span style={{ color: i.stage === 2 ? '#4CF64D' : '#bbb' }}>
            <GlossaryLabel term="stage">ステージ</GlossaryLabel> {i.stage}
          </span>
        )}
        {i.maStackOk != null && (
          <span style={{ color: i.maStackOk ? '#4CF64D' : '#E619CD' }}>
            <GlossaryLabel term="ma_stack">MA</GlossaryLabel>{i.maStackOk ? '✓' : '✗'}
          </span>
        )}
        {i.aboveLowPct != null && (
          <span style={{ color: i.aboveLowPct >= 30 ? '#4CF64D' : '#bbb' }}>
            <GlossaryLabel term="week_52_low">52WL</GlossaryLabel> +{Math.round(i.aboveLowPct)}%
          </span>
        )}
        {i.fromHighPct != null && (
          <span style={{ color: i.fromHighPct >= -25 ? '#4CF64D' : '#bbb' }}>
            <GlossaryLabel term="week_52_high">52WH</GlossaryLabel> {Math.round(i.fromHighPct)}%
          </span>
        )}
        {i.pivot != null && (
          <span style={{ color: '#FFA726' }}>
            <GlossaryLabel term="pivot">ピボット</GlossaryLabel> {Number(i.pivot).toFixed(2)}
          </span>
        )}
        {i.vcpDetected && (
          <span style={{ color: '#4CF64D' }}><GlossaryLabel term="vcp">VCP</GlossaryLabel>✓</span>
        )}
        {i.executionState && i.executionState !== 'unknown' && (
          <span style={{ color: EXECUTION_STATE_COLOR[i.executionState] || '#bbb', fontWeight: W.bold }}>
            <GlossaryLabel term={i.executionState} kind="execution">
              {EXECUTION_STATE_LABEL[i.executionState] || i.executionState}
            </GlossaryLabel>
          </span>
        )}
      </Box>
    </Box>
  );
}

function StaticChartViewerModal({
  open,
  onClose,
  initialSymbol,
  chartIndex,
  navigationSymbols = null,
}) {
  const queryClient = useQueryClient();
  const [visibleRange, setVisibleRange] = useState(null);
  const theme = useTheme();
  // モバイルでは縦積みレイアウト（チャート上・指標下）＋画面上の前後ボタンに切り替える
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  // 重ね表示のオン/オフ。null = 既定（モバイルは狭いのでオフ）。
  const [rsOverlay, setRsOverlay] = useState(null);
  const [epsOverlay, setEpsOverlay] = useState(null);
  // 短期EMA(10/20/50)。ミネルヴィニのテンプレートが採点するのは SMA 50/150/200
  // で、EMA50 は SMA50 と同じ期間の二重描画。375px に6本は読めないので、
  // スマートフォンでは既定オフ（トグルで出せる）。
  const [emaOverlay, setEmaOverlay] = useState(null);
  const showRsLine = rsOverlay ?? !isMobile;
  const showEpsLine = epsOverlay ?? !isMobile;
  const showShortEmas = emaOverlay ?? !isMobile;
  const { selectedMarket } = useStaticMarket() || {};

  const entries = useMemo(() => chartIndex?.symbols || [], [chartIndex]);
  const entryBySymbol = useMemo(
    () => new Map(entries.map((entry) => [entry.symbol, entry])),
    [entries]
  );
  const symbols = useMemo(() => {
    if (Array.isArray(navigationSymbols) && navigationSymbols.length > 0) {
      return navigationSymbols.filter((symbol) => entryBySymbol.has(symbol));
    }
    return entries.map((entry) => entry.symbol);
  }, [entries, entryBySymbol, navigationSymbols]);

  const { currentIndex, currentSymbol, totalCount, goNext, goPrevious } = useChartNavigation(
    symbols,
    initialSymbol,
    open
  );

  const currentEntry = currentSymbol ? entryBySymbol.get(currentSymbol) : null;
  const {
    data: chartPayload,
    isLoading,
    isError,
  } = useQuery({
    queryKey: staticChartKeys.payload(currentSymbol, currentEntry?.path),
    queryFn: () => fetchStaticChartPayload(currentEntry.path),
    enabled: open && Boolean(currentEntry?.path),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  useEffect(() => {
    if (!open || !symbols.length) {
      return undefined;
    }

    const prefetch = (entry) => {
      if (!entry?.path) {
        return;
      }
      queryClient.prefetchQuery({
        queryKey: staticChartKeys.payload(entry.symbol, entry.path),
        queryFn: () => fetchStaticChartPayload(entry.path),
        staleTime: Infinity,
        gcTime: Infinity,
      });
    };

    const timeouts = [];
    const nextEntries = symbols
      .slice(currentIndex + 1, currentIndex + 3)
      .map((symbol) => entryBySymbol.get(symbol))
      .filter(Boolean);
    const previousEntries = symbols
      .slice(Math.max(0, currentIndex - 2), currentIndex)
      .reverse()
      .map((symbol) => entryBySymbol.get(symbol))
      .filter(Boolean);

    if (nextEntries[0]) {
      prefetch(nextEntries[0]);
    }
    if (previousEntries[0]) {
      prefetch(previousEntries[0]);
    }

    nextEntries.slice(1).forEach((entry, index) => {
      timeouts.push(setTimeout(() => prefetch(entry), (index + 1) * 120));
    });
    previousEntries.slice(1).forEach((entry, index) => {
      timeouts.push(setTimeout(() => prefetch(entry), 320 + (index + 1) * 120));
    });

    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, [currentIndex, entryBySymbol, open, queryClient, symbols]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        if (event.shiftKey) {
          goPrevious();
        } else {
          goNext();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [goNext, goPrevious, onClose, open]);

  const stockData = chartPayload?.stock_data || null;
  const fundamentals = chartPayload?.fundamentals || null;
  const adrValue = stockData?.adr_percent ?? fundamentals?.adr_percent ?? null;
  const epsRating = stockData?.eps_rating ?? fundamentals?.eps_rating ?? null;
  const groupRank = stockData?.ibd_group_rank ?? null;
  // VCP / setup pivot (buy-trigger) drawn as a horizontal line on the chart.
  const pivotPrice = stockData?.vcp_pivot ?? stockData?.se_pivot_price ?? null;
  const pivotLabel = stockData?.vcp_pivot != null ? 'VCP Pivot' : 'Pivot';
  const stage = stockData?.stage ?? null;
  const vcpDetected = stockData?.vcp_detected === true;
  // One payload, one answer: the same block TrendTemplateScorecard and
  // BuyChecklist render, so the legend can never disagree with them.
  const trendTemplate = chartPayload?.trend_template || null;
  // Minervini trend-template readout drawn on the chart itself.
  const minerviniInfo = useMemo(() => {
    if (!stockData) return null;
    // The Trend Template must come from the SAME payload the 8/8 scorecard and
    // the buy checklist read. Deriving it from the scan row here put a magenta
    // "✗ テンプレート不合格" in the chart legend while "8/8" rendered in green
    // twice below it — one screen, opposite answers, on the mandatory gate.
    const ttScore = trendTemplate?.score
      ?? (Array.isArray(trendTemplate?.conditions)
        ? trendTemplate.conditions.filter((c) => c.passed).length
        : null);
    const ttMax = trendTemplate?.max
      ?? (Array.isArray(trendTemplate?.conditions) ? trendTemplate.conditions.length : null);
    return {
      passesTemplate: ttScore != null && ttMax != null
        ? ttScore >= ttMax
        : (stockData.passes_template ?? null),
      templateScore: ttScore,
      templateMax: ttMax,
      rsRating: stockData.rs_rating ?? null,
      stage: stockData.stage ?? null,
      maStackOk: stockData.ma_alignment ?? null,
      aboveLowPct: stockData.week_52_low_distance ?? null,
      fromHighPct: stockData.week_52_high_distance ?? null,
      pivot: pivotPrice,
      vcpDetected,
      executionState: stockData.execution_state ?? null,
    };
  }, [stockData, pivotPrice, vcpDetected, trendTemplate]);
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
  // モバイルでは価格パネル（ロウソク＋出来高）そのものに 55vh を最低保証する。
  // 以前は上部のストリップ類も含めて 55vh だったため、実際のチャートは 43vh
  // しか無かった。ヘッダー/凡例はこの上に積み、縦スクロールで読む。
  const pricePaneHeight = isMobile
    ? Math.max(Math.round(viewportHeight * 0.55), 320)
    : Math.max(viewportHeight - 60 - CHART_INFO_STRIP_HEIGHT, 440);
  const chartHeight = isMobile ? pricePaneHeight : Math.max(viewportHeight - 60, 500);
  const dataUpdatedAtOverride = chartPayload?.generated_at ? Date.parse(chartPayload.generated_at) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      aria-labelledby="static-chart-viewer-modal"
      closeAfterTransition
    >
      <Fade in={open}>
        <Box
          sx={{
            position: 'fixed',
            inset: 0,
            bgcolor: 'background.paper',
            display: 'flex',
            flexDirection: 'column',
            outline: 'none',
          }}
        >
          <Box
            sx={{
              minHeight: 60,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              // セーフエリア（ノッチ／ステータスバー）を避ける
              pt: 'env(safe-area-inset-top, 0px)',
              pl: 'calc(env(safe-area-inset-left, 0px) + 12px)',
              pr: 'calc(env(safe-area-inset-right, 0px) + 12px)',
              borderBottom: 1,
              borderColor: 'divider',
              bgcolor: 'background.default',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: { xs: 1, md: 2 },
                minWidth: 0,
                // モバイルではバッジをクリップせず横スクロールで全部見られるようにする
                flexWrap: 'nowrap',
                overflowX: 'auto',
                overflowY: 'hidden',
                py: 0.5,
                '&::-webkit-scrollbar': { display: 'none' },
                scrollbarWidth: 'none',
              }}
            >
              {/* The ticker is the drill-in's headline — the one thing you must
                  read first — so it takes the page-level step, not a rem value
                  (1.25rem/1.5rem = 20/24px, neither of which is on the scale). */}
              <Typography variant="h5" sx={{ flexShrink: 0, fontWeight: W.bold, fontSize: { xs: px(T.display), md: px(T.hero) } }}>
                {currentSymbol || '読み込み中…'}
              </Typography>
              {isLoading ? <CircularProgress size={18} /> : null}

              {stockData?.ibd_industry_group && groupRank != null ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <Box
                    sx={{
                      borderRadius: 1,
                      px: 1.5,
                      py: 0.5,
                      textAlign: 'center',
                      minWidth: 36,
                      bgcolor: getGroupRankColor(groupRank),
                    }}
                  >
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{ fontSize: px(T.body), color: C.onSolid, fontWeight: W.bold }}
                    >
                      {groupRank}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: px(T.micro), mt: 0.25 }}>
                    <GlossaryLabel term="grp_rank">業種順位</GlossaryLabel>
                  </Typography>
                </Box>
              ) : null}

              {adrValue != null ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <Box
                    sx={{
                      borderRadius: 1,
                      px: 1.5,
                      py: 0.5,
                      textAlign: 'center',
                      bgcolor: Number(adrValue) >= 4
                        ? 'success.main'
                        : Number(adrValue) >= 2
                          ? 'warning.main'
                          : 'error.main',
                    }}
                  >
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{ fontSize: px(T.body), color: C.onSolid, fontWeight: W.bold }}
                    >
                      {Number(adrValue).toFixed(1)}%
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: px(T.micro), mt: 0.25 }}>
                    <GlossaryLabel term="adr">ADR</GlossaryLabel>
                  </Typography>
                </Box>
              ) : null}

              {epsRating != null ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <Box
                    sx={{
                      borderRadius: 1,
                      px: 1.5,
                      py: 0.5,
                      textAlign: 'center',
                      minWidth: 36,
                      bgcolor: epsRating >= 80
                        ? 'success.main'
                        : epsRating >= 50
                          ? 'warning.main'
                          : 'error.main',
                    }}
                  >
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{ fontSize: px(T.body), color: C.onSolid, fontWeight: W.bold }}
                    >
                      {epsRating}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: px(T.micro), mt: 0.25 }}>
                    <GlossaryLabel term="eps_rating">EPSレート</GlossaryLabel>
                  </Typography>
                </Box>
              ) : null}

              {stage != null ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <Box
                    sx={{
                      borderRadius: 1,
                      px: 1.5,
                      py: 0.5,
                      textAlign: 'center',
                      minWidth: 36,
                      bgcolor: stage === 2 ? 'success.main' : 'grey.600',
                    }}
                  >
                    <Typography variant="body2" noWrap sx={{ fontSize: px(T.body), color: C.onSolid, fontWeight: W.bold }}>
                      {stage}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: px(T.micro), mt: 0.25 }}>
                    <GlossaryLabel term="stage">ステージ</GlossaryLabel>
                  </Typography>
                </Box>
              ) : null}

              {vcpDetected ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <Box
                    sx={{
                      borderRadius: 1,
                      px: 1.5,
                      py: 0.5,
                      textAlign: 'center',
                      minWidth: 36,
                      bgcolor: 'success.main',
                    }}
                  >
                    <Typography variant="body2" noWrap sx={{ fontSize: px(T.body), color: C.onSolid, fontWeight: W.bold }}>
                      ✓
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: px(T.micro), mt: 0.25 }}>
                    <GlossaryLabel term="vcp">VCP</GlossaryLabel>
                  </Typography>
                </Box>
              ) : null}

              {stockData ? (
                <Box sx={{ display: { xs: 'none', lg: 'flex' }, gap: 1.5, ml: 1 }}>
                  {[
                    ['IBD業種', stockData.ibd_industry_group],
                    ['セクター', stockData.gics_sector],
                    ['業種', stockData.gics_industry],
                  ].filter(([, value]) => Boolean(value)).map(([label, value]) => (
                    <Box key={label} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <Box
                        sx={{
                          border: 1,
                          borderColor: 'divider',
                          borderRadius: 1,
                          px: 1.5,
                          py: 0.5,
                          minWidth: 80,
                          maxWidth: 180,
                          textAlign: 'center',
                          bgcolor: 'background.paper',
                        }}
                      >
                        <Typography variant="body2" noWrap sx={{ fontSize: px(T.body) }}>
                          {value}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: px(T.micro), mt: 0.25 }}>
                        {label}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              ) : null}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, md: 2 } }}>
              {totalCount > 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                  {`${currentIndex + 1} / ${totalCount} 銘柄`}
                </Typography>
              ) : null}
              <Chip label="静的データ" size="small" color="info" sx={{ display: { xs: 'none', md: 'inline-flex' } }} />
              <IconButton onClick={onClose} size="large" aria-label="チャートを閉じる">
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>

          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', md: 'row' },
              flex: 1,
              overflow: { xs: 'auto', md: 'hidden' },
              // モバイルは下部の固定ナビゲーションバーに隠れないよう余白を確保
              pb: { xs: 8, md: 0 },
            }}
          >
            <Box
              sx={{
                order: { xs: 2, md: 1 },
                width: { xs: '100%', md: 'auto' },
                flexShrink: 0,
                height: { xs: 'auto', md: '100%' },
              }}
            >
              {/* 買い点灯条件 — same checklist as the live scan viewer, fed
                  from the static payload's bands + signal blocks. */}
              <BuyChecklist
                trendTemplate={chartPayload?.trend_template || null}
                buyContext={{
                  available: Boolean(chartPayload?.bands || chartPayload?.signal),
                  bands: chartPayload?.bands || {},
                  signal: chartPayload?.signal || {},
                }}
                stockData={stockData}
              />
              <StockMetricsSidebar stockData={stockData} fundamentals={fundamentals} />
              <TrendTemplateScorecard trendTemplate={chartPayload?.trend_template} />
              <TradingViewBridge
                symbol={currentSymbol}
                market={selectedMarket}
                signal={chartPayload?.signal}
                riskPlan={chartPayload?.risk_plan}
                asOf={chartPayload?.as_of_date}
              />
            </Box>

            <Box
              sx={{
                order: { xs: 1, md: 2 },
                flex: { xs: '0 0 auto', md: 1 },
                width: { xs: '100%', md: 'auto' },
                overflow: 'hidden',
                bgcolor: 'background.paper',
              }}
            >
              {isError ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: chartHeight, p: 3 }}>
                  <Alert severity="error">チャートデータの読み込みに失敗しました。</Alert>
                </Box>
              ) : isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: chartHeight }}>
                  <CircularProgress size={56} />
                </Box>
              ) : currentSymbol ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', height: { xs: 'auto', md: chartHeight } }}>
                  {/* Info strip ABOVE the chart so the moving-average legend and
                      Minervini readout never cover the candles (a leader near
                      new highs prints at the top-right). One line, scrolls
                      horizontally on narrow screens. */}
                  <ChartInfoStrip minerviniInfo={minerviniInfo} showEpsLine={showEpsLine} showShortEmas={showShortEmas} />
                  <BandLegend />
                  <OverlayToggles
                    rsOn={showRsLine}
                    epsOn={showEpsLine}
                    onToggleRs={() => setRsOverlay(!showRsLine)}
                    onToggleEps={() => setEpsOverlay(!showEpsLine)}
                    emaOn={showShortEmas}
                    onToggleEma={() => setEmaOverlay(!showShortEmas)}
                  />
                  {isMobile && (
                    <SignalBadges
                      signal={chartPayload?.signal}
                      sellPlan={chartPayload?.sell_plan}
                    />
                  )}
                  <Box
                    data-testid="chart-price-pane"
                    sx={{
                      flex: { xs: '0 0 auto', md: 1 },
                      height: { xs: pricePaneHeight, md: 'auto' },
                      minHeight: { xs: '55vh', md: 0 },
                      position: 'relative',
                    }}
                  >
                    <CandlestickChart
                      symbol={currentSymbol}
                      period="6mo"
                      height={isMobile ? pricePaneHeight : Math.max(chartHeight - CHART_INFO_STRIP_HEIGHT, 240)}
                      visibleRange={visibleRange}
                      onVisibleRangeChange={setVisibleRange}
                      priceData={chartPayload?.bars || []}
                      rsLineData={showRsLine ? (chartPayload?.rs_line || null) : null}
                      rsRatingValue={stockData?.rs_rating ?? null}
                      epsLine={showEpsLine ? (chartPayload?.eps_line || null) : null}
                      blueDots={showRsLine ? (chartPayload?.blue_dots || null) : null}
                      showShortEmas={showShortEmas}
                      dataUpdatedAtOverride={dataUpdatedAtOverride}
                      hideOhlcLegend={isMobile}
                      hideTimeframeToggle={isMobile}
                      pivotPrice={pivotPrice}
                      pivotLabel={pivotLabel}
                      vcpBoxes={chartPayload?.vcp_boxes || null}
                      bands={chartPayload?.bands || null}
                      buyPoints={chartPayload?.buy_points || null}
                    />
                    {/* Markets 360 signal cards from the static payload —
                        same components as the live page, desktop only (at
                        375px a 300px card would cover the candles; mobile
                        gets the in-flow badge strip above the chart). */}
                    {!isMobile && (
                      <>
                        <BuyingNowCard signal={chartPayload?.signal} />
                        {chartPayload?.sell_plan
                          ? <SellPlanCard sellPlan={chartPayload.sell_plan} />
                          : null}
                      </>
                    )}
                  </Box>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: chartHeight }}>
                  <CircularProgress size={56} />
                </Box>
              )}
            </Box>
          </Box>

          <Box
            sx={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              pt: 1.5,
              px: 1.5,
              // ホームインジケータ（下部セーフエリア）を避ける
              pb: 'calc(12px + env(safe-area-inset-bottom, 0px))',
              bgcolor: 'background.paper',
              borderTop: 1,
              borderColor: 'divider',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: { xs: 1.5, md: 3 },
            }}
          >
            {totalCount > 1 ? (
              <>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<ArrowBackIosNewIcon sx={{ fontSize: px(T.strong) }} />}
                  onClick={goPrevious}
                  sx={{ minWidth: 96, minHeight: 44 }}
                >
                  前の銘柄
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  endIcon={<ArrowForwardIosIcon sx={{ fontSize: px(T.strong) }} />}
                  onClick={goNext}
                  sx={{ minWidth: 96, minHeight: 44 }}
                >
                  次の銘柄
                </Button>
              </>
            ) : null}
            <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 3 }}>
              <Chip icon={<KeyboardIcon />} label="Space: 次の銘柄" size="small" variant="outlined" />
              <Chip icon={<KeyboardIcon />} label="Shift+Space: 前の銘柄" size="small" variant="outlined" />
              <Chip icon={<KeyboardIcon />} label="Esc: 閉じる" size="small" variant="outlined" />
            </Box>
          </Box>
        </Box>
      </Fade>
    </Modal>
  );
}

export default StaticChartViewerModal;
