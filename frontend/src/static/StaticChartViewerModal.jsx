import { instrumentApplicability, instrumentApplicabilityLabel } from './instrumentApplicability';
import { projectFinancialRow, mergeFinancialDetail } from './financialCurrent';
import { useFinancialClock } from './useFinancialClock';
import { requireChartIdentity } from './chartPayloadIdentity';
import { canonicalPivot } from './researchPresentation';
import ChartDecisionSummary from './components/ChartDecisionSummary';
import { EntrySourceBadge } from './components/EntrySourceNote';
import { assess, entryPlan } from './researchEngine';
import { entryReadiness } from './entryReadiness';
import { modelMarket } from './portfolioPlan';
import { useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react';
import { fitExpandedChartHeight, MIN_EXPANDED_CHART_HEIGHT, MOBILE_EXPANDED_CHART_HEIGHT } from './expandedChartLayout';
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
  return <Box sx={{ minHeight: CHART_INFO_STRIP_HEIGHT, display: 'flex', flexWrap: 'wrap', gap: 1.5, px: 1.5, py: .75, bgcolor: 'background.paper', fontSize: 12 }}>
    {[['▲ 上昇','var(--zone)'],['▼ 下落','var(--neg)'],['━ SMA50日 / 10週','var(--accent)'],['┄ SMA150日 / 30週','var(--wait)'],['┈ SMA200日 / 40週','var(--text-3)'],['━ RS','var(--accent)']].map(([label,color]) => <span key={label} style={{color}}>{label}</span>)}
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
  method, date, market, now: suppliedNow, quote,
}) {
  const queryClient = useQueryClient();
  const [visibleRange, setVisibleRange] = useState(null);
  const [panMode, setPanMode] = useState(false);
  const swipeStart = useRef(null);
  const contentRef = useRef(null);
  const mobileInteractionRef = useRef(null);
  const mobileInteractionFocused = useRef(false);
  // Portal descendants can mount after this component's layout effect, also
  // on a cached reopen without a loading transition. Observe the actual node.
  const [chartSection, setChartSection] = useState(null);
  const [fittedChartHeight, setFittedChartHeight] = useState(null);
  const theme = useTheme();
  // モバイルでは縦積みレイアウト（チャート上・指標下）＋画面上の前後ボタンに切り替える
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isShortViewport = useMediaQuery('(max-height:600px)');
  const compactMobileChrome = isMobile && isShortViewport;
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
  const expectedDate = date || chartIndex?.as_of_date;
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
    select: payload => requireChartIdentity(payload,currentSymbol,expectedDate),
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
    queryKey:['researchDetail',currentSymbol,researchRow?.research_detail_path,expectedDate,generation],
    enabled:Boolean(open && researchRow?.research_detail_path),
    staleTime:Infinity, placeholderData:()=>undefined,
    queryFn:async()=>{
      const detail=await fetchStaticJson(researchRow.research_detail_path);
      if(detail.symbol!==currentSymbol || (!expectedDate || detail.as_of_date!==expectedDate)) throw Error('Detail identity mismatch');
      return { value: detail, symbol: currentSymbol, date: expectedDate, generation, path: researchRow.research_detail_path };
    },
  });
  const detailResponse = rowDetail.data;
  const clockRows = useMemo(() => [researchRow, chartPayload?.fundamentals, detailResponse?.value].filter(Boolean), [researchRow, chartPayload?.fundamentals, detailResponse]);
  const clockNow = useFinancialClock(clockRows);
  const now = Number.isFinite(suppliedNow) ? Math.max(suppliedNow, clockNow) : clockNow;
  const stockData = researchRow ? mergeFinancialDetail(researchRow, detailResponse?.value, {
    now, asOfDate: expectedDate, generation, detailGeneration: detailResponse?.generation,
    expectedDetailPath: researchRow.research_detail_path, detailPath: detailResponse?.path,
  }) : null;
  const fundamentals = chartPayload?.fundamentals ? projectFinancialRow(chartPayload.fundamentals, { now, asOfDate: expectedDate }) : null;
  // VCP / setup pivot (buy-trigger) drawn as a horizontal line on the chart.
  const pivotPrice = canonicalPivot(stockData).price;
  const plan = entryPlan(stockData || {}, quote?.symbol === currentSymbol ? quote : null, method);
  const mobileReadiness = isMobile && stockData
    ? entryReadiness(stockData, expectedDate || chartPayload?.as_of_date, market || modelMarket([stockData]), now, method)
    : null;
  const mobileUnknown = mobileReadiness?.rules.filter(rule => rule.state === 'unknown').length || 0;
  const mobileMissing = mobileReadiness?.rules.filter(rule => rule.state !== 'pass').slice(0, 3) || [];
  const pivotLabel = '共通ピボット';
  const chartHeight = fittedChartHeight ?? (isMobile ? MOBILE_EXPANDED_CHART_HEIGHT : MIN_EXPANDED_CHART_HEIGHT);
  const mobileInteraction = isMobile && <Box ref={mobileInteractionRef} data-testid="mobile-chart-interaction"
    onFocusCapture={() => { mobileInteractionFocused.current = true; }}
    onBlurCapture={() => { mobileInteractionFocused.current = false; }}
    sx={{ px: compactMobileChrome ? 0 : 1.5, display:'flex', alignItems:'center', justifyContent:'space-between', gap:compactMobileChrome ? .5 : 1, minHeight:44, minWidth:0, flex:1, fontSize:12, lineHeight:1.5, color:'text.secondary' }}>
    <span>{panMode ? 'チャートを拡大・移動中' : '左スワイプ：次 ／ 右：前'}</span>
    <Button size="small" sx={{minHeight:44,flexShrink:0}} aria-label={panMode ? '銘柄スワイプに戻る' : 'チャート操作（拡大・移動）'} aria-pressed={panMode} onClick={() => setPanMode(v => !v)}>{panMode ? '銘柄スワイプに戻る' : '拡大・移動'}</Button>
  </Box>;
  // Reflow only the chrome on short phones. The chart instance and selection
  // stay mounted; carry keyboard focus with the relocated pan-mode control.
  useLayoutEffect(() => {
    if (mobileInteractionFocused.current) mobileInteractionRef.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [compactMobileChrome]);
  useEffect(() => { if (!open) mobileInteractionFocused.current = false; }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const content = contentRef.current, section = chartSection;
    const plot = section?.querySelector('[data-chart-symbol]');
    if (!content || !plot) return undefined;
    const fit = () => {
      // Use the plot's unscrolled offset, including the live summary, source
      // warning, legend and chart controls. Scrolling must not resize the plot.
      if (!content.clientHeight) return;
      const plotOffset = plot.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
      setFittedChartHeight(fitExpandedChartHeight(content.clientHeight, plotOffset, { mobile: isMobile }));
    };
    fit();
    // The content box already excludes the in-flow header and safe-area footer.
    // Observe summary/disclosure/font wrapping as well as viewport changes.
    // Do not mutate an observed size inside the ResizeObserver delivery.
    let frame;
    const scheduleFit = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(content);
    observer.observe(section);
    window.addEventListener('resize', scheduleFit);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', scheduleFit); };
  }, [open, isMobile, compactMobileChrome, isLoading, isError, currentSymbol, chartSection]);
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
            overflow: 'hidden',
          }}
        >
          {rowDetail.isError && <Alert severity="warning" sx={{flexShrink:0}}>詳細根拠の取得に失敗しました。未取得の条件は合格扱いにしていません。</Alert>}
          <Box data-testid="expanded-chart-header" sx={{display:compactMobileChrome ? 'grid' : 'flex',gridTemplateColumns:'minmax(0, 1fr) auto',flexShrink:0,alignItems:'center',justifyContent:'space-between',px:2,py:compactMobileChrome ? .5 : 1,borderBottom:1,borderColor:'divider'}}>
            <Box sx={{display:compactMobileChrome ? 'contents' : 'block',minWidth:0,flex:1}}>
              <Box sx={{minWidth:0}}><Typography id="static-chart-viewer-modal" variant="h6">{currentSymbol} <Typography component="span" color="text.secondary" sx={{fontSize:13}}>{currentIndex+1} / {totalCount} 銘柄</Typography></Typography>
                <Typography sx={{fontSize:12,color:'text.secondary'}}>{isMobile ? `${Number.isFinite(stockData?.current_price) ? `$${stockData.current_price.toFixed(2)}` : '価格未確認'} · ${expectedDate || chartPayload?.as_of_date || '時点未確認'} 日次終値` : `${stockData?.company_name || '日次チャート分析'} · ${Number.isFinite(stockData?.current_price) ? `$${stockData.current_price.toFixed(2)}` : '価格未確認'}（日次）`}</Typography>
              </Box>
              {isMobile && <Box data-testid="mobile-chart-readiness" sx={{gridColumn:compactMobileChrome ? '1 / -1' : '1',gridRow:2,fontSize:12,lineHeight:1.5,mt:.5,overflowWrap:'anywhere'}}>
                <Box sx={{display:'flex',alignItems:'baseline',flexWrap:'wrap',gap:'0 8px'}}><strong>{mobileReadiness ? `購入条件 ${mobileReadiness.passed}/${mobileReadiness.total}${mobileUnknown ? `（未確認 ${mobileUnknown}）` : ''}` : '購入条件を読み込み中…'}</strong><EntrySourceBadge plan={plan}/></Box>
                {mobileReadiness && <Box component="span" sx={{display:'block',color:'text.secondary'}}>{mobileMissing.length ? `未達・未確認：${mobileMissing.map(rule=>rule.label).join(' ／ ')}` : '日次条件を確認済み。現在価格は発注時に確認。'}</Box>}
              </Box>}
            </Box>
            <IconButton onClick={onClose} aria-label="チャートを閉じる" sx={{gridColumn:2,gridRow:1,alignSelf:'flex-start'}}><CloseIcon /></IconButton>
          </Box>
          <Box
            ref={contentRef}
            data-testid="expanded-chart-scroll"
            sx={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
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
              {stockData && (researchRows?.length || researchRow?.research_detail_path) ? <Box component="details" sx={{px:2,py:1}}><summary style={{cursor:'pointer',minHeight:44}}>{instrumentApplicabilityLabel(instrumentApplicability(stockData)) || (rowDetail.isFetching ? '詳細根拠を読み込み中…' : `選定条件の詳細（${assess(stockData,method || 'minervini',now).passed}/${assess(stockData,method || 'minervini',now).total}）`)}</summary>
                {assess(stockData,method || 'minervini',now).rules.map(r=><Typography key={r.label} sx={{fontSize:13,my:1}}>{r.state==='pass'?'✓':r.state==='fail'?'×':r.state==='not_applicable'?'対象外':'?'} {r.label}</Typography>)}
              </Box> : <><StockMetricsSidebar currentFinancialOnly date={expectedDate} now={now} stockData={stockData} fundamentals={fundamentals} />
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
              ref={setChartSection}
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
                  {/* Keep warnings/readouts outside the candles. On phones the
                      color key lives below the chart; measured MA values keep
                      their existing accessible disclosure above the plot. */}
                  {!isMobile && <ChartDecisionSummary row={stockData} date={date || chartPayload?.as_of_date} market={market} method={method} now={now} quote={quote?.symbol === currentSymbol ? quote : null} />}
                  {!isMobile && <ChartInfoStrip />}
                  {!compactMobileChrome && mobileInteraction}
                  <Box data-testid="chart-swipe-surface" onTouchStartCapture={startSwipe} onTouchEndCapture={endSwipe}
                    onTouchMoveCapture={event => { if (event.touches.length !== 1) swipeStart.current = null; }} onTouchCancel={() => { swipeStart.current = null; }}
                    sx={{ flex: 1, minHeight: 0, position: 'relative', touchAction: isMobile && !panMode ? 'pan-y' : 'auto' }}>
                    <CandlestickChart smallScreen={isMobile} researchView bookAnnotations interactive={!isMobile || panMode}
                      researchMetaActions={compactMobileChrome ? mobileInteraction : null}
                      symbol={currentSymbol}
                      period="6mo"
                      height={chartHeight}
                      visibleRange={visibleRange}
                      onVisibleRangeChange={setVisibleRange}
                      priceData={chartPayload?.bars || []}
                      rsLineData={chartPayload?.rs_line || null}
                      rsRatingValue={stockData?.rs_rating ?? null}
                      epsLine={chartPayload?.eps_line || null}
                      blueDots={chartPayload?.blue_dots || null}
                      dataUpdatedAtOverride={dataUpdatedAtOverride}
                      hideOhlcLegend
                      hideTimeframeToggle={false}
                      pivotPrice={pivotPrice}
                      buyCeiling={plan.upper}
                      stopPrice={plan.stopExample}
                      pivotLabel={pivotLabel}
                      vcpBoxes={chartPayload?.vcp_boxes || null}
                    />
                  </Box>
                  {isMobile && <>
                    <Box component="details" data-testid="mobile-chart-legend" sx={{px:1.5,fontSize:12,borderBottom:1,borderColor:'divider'}}>
                      <summary style={{cursor:'pointer',minHeight:44,lineHeight:'24px',padding:'10px 0',boxSizing:'border-box'}}>チャートの凡例（移動平均線・RS）</summary>
                      <ChartInfoStrip />
                    </Box>
                    <ChartDecisionSummary row={stockData} date={date || chartPayload?.as_of_date} market={market} method={method} now={now} quote={quote?.symbol === currentSymbol ? quote : null} />
                  </>}
                </Box>
              ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: chartHeight }}>
                  <CircularProgress size={56} />
                </Box>
              )}
            </Box>
          </Box>

          <Box
            data-testid="expanded-chart-footer"
            sx={{
              position: 'relative',
              flexShrink: 0,
              zIndex: 1,
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
