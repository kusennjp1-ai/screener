import { useEffect, useMemo, useState, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Fade,
  IconButton,
  Modal,
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
import { swipeDirection } from './swipeNavigation';
import StockMetricsSidebar from '../components/Scan/StockMetricsSidebar';
import TradingViewBridge from './components/TradingViewBridge';
import TrendTemplateScorecard from './components/TrendTemplateScorecard';
import { useStaticMarket } from './StaticMarketContext';
import GlossaryLabel from '../components/common/GlossaryLabel';
import { getGroupRankColor } from '../utils/colorUtils';
import { useChartNavigation } from '../hooks/useChartNavigation';
import { fetchStaticChartPayload, staticChartKeys } from './chartClient';

const CHART_INFO_STRIP_HEIGHT = 34;

function ChartInfoStrip() {
  const dark = useTheme().palette.mode === 'dark';
  return <Box sx={{ minHeight: CHART_INFO_STRIP_HEIGHT, display: 'flex', flexWrap: 'wrap', gap: 1.5, px: 1.5, py: .75, bgcolor: 'background.paper', fontSize: 12 }}>
    {[['▲ 上昇', '#10b981'], ['▼ 下落', '#ef4444'], ['━ SMA50', dark ? '#60a5fa' : '#2563eb'], ['━ SMA150', dark ? '#94a3b8' : '#64748b'], ['━ SMA200', dark ? '#c4b5fd' : '#7c3aed'], ['━ RS', '#ffa726']].map(([label,color]) => <span key={label} style={{color}}>{label}</span>)}
  </Box>;
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
  const [panMode, setPanMode] = useState(false);
  const swipeStart = useRef(null);
  const theme = useTheme();
  // モバイルでは縦積みレイアウト（チャート上・指標下）＋画面上の前後ボタンに切り替える
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
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

  function startSwipe(event) {
    if (!isMobile || panMode || event.touches.length !== 1 || event.target.closest('button,a,input,select,textarea,summary')) { swipeStart.current = null; return; }
    swipeStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() };
  }
  function endSwipe(event) {
    const start = swipeStart.current; swipeStart.current = null;
    if (!isMobile || panMode || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const direction = swipeDirection(start, { x: touch.clientX, y: touch.clientY, at: Date.now() });
    if (direction === 'next') goNext();
    if (direction === 'previous') goPrevious();
  }
  useEffect(() => { swipeStart.current = null; }, [currentSymbol, open]);

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
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
  // モバイルは画面の約55%をチャートに割り当て、残りを指標のスクロール領域にする
  const chartHeight = isMobile
    ? Math.max(Math.round(viewportHeight * 0.55), 300)
    : Math.max(viewportHeight - 140, 400);
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
              <Typography variant="h5" fontWeight="bold" sx={{ flexShrink: 0, fontSize: { xs: '1.25rem', md: '1.5rem' } }}>
                {currentSymbol || 'Loading...'}
              </Typography>
              {isLoading ? <CircularProgress size={18} /> : null}

              {stockData?.ibd_industry_group ? (
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
                      sx={{ fontSize: '0.8rem', color: 'white', fontWeight: 'bold' }}
                    >
                      {groupRank ?? '-'}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', mt: 0.25 }}>
                    <GlossaryLabel term="grp_rank">Grp Rnk</GlossaryLabel>
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
                      sx={{ fontSize: '0.8rem', color: 'white', fontWeight: 'bold' }}
                    >
                      {Number(adrValue).toFixed(1)}%
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', mt: 0.25 }}>
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
                      sx={{ fontSize: '0.8rem', color: 'white', fontWeight: 'bold' }}
                    >
                      {epsRating}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', mt: 0.25 }}>
                    <GlossaryLabel term="eps_rating">EPS Rtg</GlossaryLabel>
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
                    <Typography variant="body2" noWrap sx={{ fontSize: '0.8rem', color: 'white', fontWeight: 'bold' }}>
                      {stage}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', mt: 0.25 }}>
                    <GlossaryLabel term="stage">Stage</GlossaryLabel>
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
                    <Typography variant="body2" noWrap sx={{ fontSize: '0.8rem', color: 'white', fontWeight: 'bold' }}>
                      ✓
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', mt: 0.25 }}>
                    <GlossaryLabel term="vcp">VCP</GlossaryLabel>
                  </Typography>
                </Box>
              ) : null}

              {stockData ? (
                <Box sx={{ display: { xs: 'none', lg: 'flex' }, gap: 1.5, ml: 1 }}>
                  {[
                    ['IBD', stockData.ibd_industry_group],
                    ['Sector', stockData.gics_sector],
                    ['Industry', stockData.gics_industry],
                  ].map(([label, value]) => (
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
                        <Typography variant="body2" noWrap sx={{ fontSize: '0.8rem' }}>
                          {value || '-'}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', mt: 0.25 }}>
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
                width: { xs: '100%', md: 320 },
                overflowY: 'auto',
                '& > div': { width: '100%', height: 'auto', boxSizing: 'border-box' },
                flexShrink: 0,
                height: { xs: 'auto', md: '100%' },
              }}
            >
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
                minWidth: 0,
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
                <Box sx={{ display: 'flex', flexDirection: 'column', height: chartHeight }}>
                  {/* Info strip ABOVE the chart so the moving-average legend and
                      Minervini readout never cover the candles (a leader near
                      new highs prints at the top-right). One line, scrolls
                      horizontally on narrow screens. */}
                  <ChartInfoStrip />
                  {isMobile && <Box sx={{ px: 1.5, fontSize: 12, color: 'text.secondary' }}>
                    左スワイプ：次の銘柄 ／ 右：前の銘柄
                    <Button size="small" aria-pressed={panMode} onClick={() => setPanMode(v => !v)}>{panMode ? '銘柄スワイプに戻る' : 'チャート操作（拡大・移動）'}</Button>
                  </Box>}
                  <Box data-testid="chart-swipe-surface" onTouchStartCapture={startSwipe} onTouchEndCapture={endSwipe}
                    onTouchMoveCapture={event => { if (event.touches.length !== 1) swipeStart.current = null; }} onTouchCancel={() => { swipeStart.current = null; }}
                    sx={{ flex: 1, minHeight: 0, position: 'relative', overflowY: 'auto', touchAction: isMobile && !panMode ? 'pan-y' : 'auto' }}>
                    <CandlestickChart bookAnnotations interactive={!isMobile || panMode}
                      symbol={currentSymbol}
                      period="6mo"
                      height={Math.max(chartHeight - CHART_INFO_STRIP_HEIGHT - 120, 240)}
                      visibleRange={visibleRange}
                      onVisibleRangeChange={setVisibleRange}
                      priceData={chartPayload?.bars || []}
                      rsLineData={chartPayload?.rs_line || null}
                      rsRatingValue={stockData?.rs_rating ?? null}
                      epsLine={chartPayload?.eps_line || null}
                      blueDots={chartPayload?.blue_dots || null}
                      dataUpdatedAtOverride={dataUpdatedAtOverride}
                      hideOhlcLegend={isMobile}
                      hideTimeframeToggle={isMobile}
                      pivotPrice={pivotPrice}
                      pivotLabel={pivotLabel}
                      vcpBoxes={chartPayload?.vcp_boxes || null}
                    />
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
                  startIcon={<ArrowBackIosNewIcon sx={{ fontSize: 14 }} />}
                  onClick={goPrevious}
                  sx={{ minWidth: 96 }}
                >
                  前の銘柄
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  endIcon={<ArrowForwardIosIcon sx={{ fontSize: 14 }} />}
                  onClick={goNext}
                  sx={{ minWidth: 96 }}
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
