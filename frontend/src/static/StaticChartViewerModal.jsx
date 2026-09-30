import { canonicalPivot } from './researchPresentation';
import ChartDecisionSummary from './components/ChartDecisionSummary';
import { assess } from './researchEngine';
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
import { useChartNavigation } from '../hooks/useChartNavigation';
import { fetchStaticChartPayload, staticChartKeys } from './chartClient';
import { fetchStaticJson } from './dataClient';

const CHART_INFO_STRIP_HEIGHT = 34;

function ChartInfoStrip() {
  const dark = useTheme().palette.mode === 'dark';
  return <Box sx={{ minHeight: CHART_INFO_STRIP_HEIGHT, display: 'flex', flexWrap: 'wrap', gap: 1.5, px: 1.5, py: .75, bgcolor: 'background.paper', fontSize: 12 }}>
    {[['▲ 上昇', dark ? '#10b981' : '#087c63'], ['▼ 下落', dark ? '#ef4444' : '#ba3344'], ['━ SMA50日 / 10週', dark ? '#60a5fa' : '#2563eb'], ['┄ SMA150日 / 30週', dark ? '#94a3b8' : '#64748b'], ['┈ SMA200日 / 40週', dark ? '#c4b5fd' : '#7c3aed'], ['━ RS', dark ? '#a5b4fc' : '#4f46e5']].map(([label,color]) => <span key={label} style={{color}}>{label}</span>)}
  </Box>;
}

function StaticChartViewerModal({
  open,
  onClose,
  initialSymbol,
  chartIndex,
  navigationSymbols = null,
  researchRows = null,
  generation,
  method, date, market, now, quote,
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
    placeholderData: () => undefined,
    queryKey: [...staticChartKeys.payload(currentSymbol, currentEntry?.path), ...(generation ? [generation] : [])],
    queryFn: () => fetchStaticChartPayload(currentEntry.path),
    enabled: open && Boolean(currentEntry?.path),
    staleTime: Infinity,
    gcTime: Infinity,
    select: payload => {
      if (payload.symbol !== currentSymbol) throw Error('Chart symbol mismatch');
      if (date && payload.as_of_date !== date) throw Error('Chart snapshot date mismatch');
      return payload;
    },
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
        queryKey: [...staticChartKeys.payload(entry.symbol, entry.path), ...(generation ? [generation] : [])],
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
  }, [currentIndex, entryBySymbol, generation, open, queryClient, symbols]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === ' ' && !event.target.closest('button,input,textarea,select,summary,a')) {
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

  const researchRow = researchRows?.find(r=>r.symbol === currentSymbol) || chartPayload?.stock_data;
  const rowDetail = useQuery({
    queryKey:['researchDetail',researchRow?.research_detail_path,generation],
    enabled:Boolean(open && researchRow?.research_detail_path),
    staleTime:Infinity, placeholderData:()=>undefined,
    queryFn:async()=>{
      const detail=await fetchStaticJson(researchRow.research_detail_path);
      if(detail.symbol!==currentSymbol || (date && detail.as_of_date!==date)) throw Error('Detail identity mismatch');
      return detail;
    },
  });
  const stockData = rowDetail.data?.symbol===currentSymbol ? {...researchRow,...rowDetail.data} : researchRow || chartPayload?.stock_data || null;
  const fundamentals = chartPayload?.fundamentals || null;
  // VCP / setup pivot (buy-trigger) drawn as a horizontal line on the chart.
  const pivotPrice = canonicalPivot(stockData).price;
  const pivotLabel = '共通ピボット';
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
          role="dialog"
          aria-modal="true"
          aria-labelledby="static-chart-viewer-modal"
          sx={{
            position: 'fixed',
            inset: 0,
            bgcolor: 'background.paper',
            display: 'flex',
            flexDirection: 'column',
            outline: 'none',
          }}
        >
          {rowDetail.isError && <Alert severity="warning">詳細根拠の取得に失敗しました。未取得の条件は合格扱いにしていません。</Alert>}
          <Box sx={{display:'flex',alignItems:'center',justifyContent:'space-between',px:2,py:1,borderBottom:1,borderColor:'divider'}}>
            <Box><Typography id="static-chart-viewer-modal" variant="h6">{currentSymbol} <Typography component="span" color="text.secondary" sx={{fontSize:13}}>{currentIndex+1} / {totalCount} 銘柄</Typography></Typography>
              <Typography sx={{fontSize:12,color:'text.secondary'}}>{stockData?.company_name || '日次チャート分析'} · {Number.isFinite(stockData?.current_price) ? `$${stockData.current_price.toFixed(2)}` : '価格未確認'}（日次）</Typography></Box>
            <IconButton onClick={onClose} aria-label="チャートを閉じる"><CloseIcon /></IconButton>
          </Box>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              overflow: 'auto',
              // モバイルは下部の固定ナビゲーションバーに隠れないよう余白を確保
              pb: 10,
            }}
          >
            <Box
              sx={{
                order: 2,
                width: '100%',
                overflowY: 'auto',
                '& > div': { width: '100%', height: 'auto', boxSizing: 'border-box' },
                flexShrink: 0,
                height: 'auto',
              }}
            >
              {stockData && (researchRows?.length || researchRow?.research_detail_path) ? <Box component="details" sx={{px:2,py:1}}><summary style={{cursor:'pointer',minHeight:44}}>{rowDetail.isFetching ? '詳細根拠を読み込み中…' : `選定条件の詳細（${assess(stockData,'minervini').passed}/${assess(stockData,'minervini').total}）`}</summary>
                {assess(stockData,'minervini').rules.map(r=><Typography key={r.label} sx={{fontSize:13,my:1}}>{r.state==='pass'?'✓':r.state==='fail'?'×':'?'} {r.label}</Typography>)}
              </Box> : <><StockMetricsSidebar stockData={stockData} fundamentals={fundamentals} />
              <TrendTemplateScorecard trendTemplate={chartPayload?.trend_template} />
              <TradingViewBridge
                symbol={currentSymbol}
                market={selectedMarket}
                signal={chartPayload?.signal}
                riskPlan={chartPayload?.risk_plan}
                asOf={chartPayload?.as_of_date}
              /></>}
            </Box>

            <Box
              sx={{
                order: 1,
                flex: '0 0 auto',
                minWidth: 0,
                width: '100%',
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
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  {/* Info strip ABOVE the chart so the moving-average legend and
                      Minervini readout never cover the candles (a leader near
                      new highs prints at the top-right). One line, scrolls
                      horizontally on narrow screens. */}
                  {!isMobile && <ChartDecisionSummary row={stockData} date={date || chartPayload?.as_of_date} market={market} method={method} now={now} quote={quote?.symbol === currentSymbol ? quote : null} />}
                  <ChartInfoStrip />
                  {isMobile && <Box sx={{ px: 1.5, fontSize: 12, color: 'text.secondary' }}>
                    左スワイプ：次の銘柄 ／ 右：前の銘柄
                    <Button size="small" aria-pressed={panMode} onClick={() => setPanMode(v => !v)}>{panMode ? '銘柄スワイプに戻る' : 'チャート操作（拡大・移動）'}</Button>
                  </Box>}
                  <Box data-testid="chart-swipe-surface" onTouchStartCapture={startSwipe} onTouchEndCapture={endSwipe}
                    onTouchMoveCapture={event => { if (event.touches.length !== 1) swipeStart.current = null; }} onTouchCancel={() => { swipeStart.current = null; }}
                    sx={{ flex: 1, minHeight: 0, position: 'relative', overflowY: 'auto', touchAction: isMobile && !panMode ? 'pan-y' : 'auto' }}>
                    <CandlestickChart smallScreen={isMobile} researchView bookAnnotations interactive={!isMobile || panMode}
                      symbol={currentSymbol}
                      period="6mo"
                      height={isMobile ? 420 : Math.max(chartHeight - 220, 460)}
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
                  {isMobile && <ChartDecisionSummary row={stockData} date={date || chartPayload?.as_of_date} market={market} method={method} now={now} quote={quote?.symbol === currentSymbol ? quote : null} />}
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
