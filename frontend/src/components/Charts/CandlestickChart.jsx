import { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback } from 'react';
import { Box, CircularProgress, Alert, AlertTitle, Button, ToggleButtonGroup, ToggleButton, useTheme, Typography } from '@mui/material';
import { createPriceChartSeries } from './createPriceChartSeries';
import { VcpBoxPrimitive } from './vcpBoxPrimitive';
import { BandStripPrimitive } from './bandStripPrimitive';
import { BuyPointPrimitive } from './buyPointPrimitive';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPriceHistory, fetchRSLine, priceHistoryKeys, PRICE_HISTORY_STALE_TIME } from '../../api/priceHistory';
import { rsBandForRange } from './rsBand';
import ChartSkeleton from './ChartSkeleton';
import { transformToCandlestickData } from './candlestickData';

// Debounce utility
const debounce = (fn, ms) => {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => {
    clearTimeout(timer);
  };
  return debounced;
};

/**
 * TradingView-style candlestick chart component
 *
 * @param {Object} props
 * @param {string} props.symbol - Stock symbol to display
 * @param {string} props.period - Time period (default: '6mo')
 * @param {number} props.height - Chart height in pixels
 * @param {Object} props.visibleRange - Optional visible time range to restore { from: timestamp, to: timestamp }
 * @param {Function} props.onVisibleRangeChange - Callback when visible range changes
 * @param {Array|null} props.priceData - Optional static OHLCV payload to render without API calls
 * @param {number|null} props.dataUpdatedAtOverride - Optional timestamp (ms) for static bundles
 * @param {boolean} props.compact - When true, hides overlays (Daily/Weekly toggle, OHLC legend, updated-at indicator) for dense grid layouts
 * @param {boolean} props.hideTimeframeToggle - When true, hides only the Daily/Weekly toggle (other overlays stay) and forces the daily timeframe
 * @param {boolean} props.interactive - When false, disables time-axis pan/zoom (mouse wheel, drag, pinch) until re-enabled
 */
function CandlestickChart({
  symbol,
  period = '6mo',
  height = 600,
  visibleRange = null,
  onVisibleRangeChange = null,
  priceData = null,
  rsLineData = null,
  rsRatingValue = null,
  epsLine = null,
  blueDots = null,
  dataUpdatedAtOverride = null,
  compact = false,
  hideTimeframeToggle = false,
  hideOhlcLegend = false,
  interactive = true,
  pivotPrice = null,
  pivotLabel = 'Pivot',
  vcpBoxes = null,
  bands = null,
  buyPoints = null,
}) {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const pivotLineRef = useRef(null); // Horizontal pivot/buy-trigger price line
  const vcpBoxPrimitiveRef = useRef(null); // VCP consolidation-box overlay
  const bandStripPrimitiveRef = useRef(null); // MM360 color-band strips overlay
  const buyPointPrimitiveRef = useRef(null); // Buy-point chips connected to the band row
  const candleMarkersRef = useRef(null); // (legacy marker holder; buy points now use a primitive)
  const volumeSeriesRef = useRef(null);
  const avgVolumeSeriesRef = useRef(null); // ~50-day average-volume line
  const ema10SeriesRef = useRef(null);
  const ema20SeriesRef = useRef(null);
  const ema50SeriesRef = useRef(null);
  const sma50SeriesRef = useRef(null); // Minervini trend-template stack
  const sma150SeriesRef = useRef(null);
  const sma200SeriesRef = useRef(null);
  const rsLineSeriesRef = useRef(null); // RS line (stock / benchmark) overlay
  const epsLineSeriesRef = useRef(null); // Quarterly EPS line overlay
  const rsMarkersRef = useRef(null); // Blue-dot markers primitive on the RS line
  const prevSymbolRef = useRef(null); // Track previous symbol
  const shouldRestoreRangeRef = useRef(false); // Flag to restore range on next data update
  const isFirstDataLoadRef = useRef(true); // Track first data load
  const prevCloseMapRef = useRef(new Map()); // Map of date -> previous close for % change calculation
  const latestCandleRef = useRef(null); // Store latest candle for default display

  const [timeframe, setTimeframe] = useState('daily');
  const [showRSLine, setShowRSLine] = useState(true); // RS line overlay toggle
  const [legendData, setLegendData] = useState(null); // OHLC legend data on hover
  const [rsBandTop, setRsBandTop] = useState(0.66); // top margin of the live RS band
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';

  // Where the top color-band row starts (px from the pane top). When the OHLC
  // legend or the timeframe toggle float at the top, push the bands (and the
  // buy-point chips below them) under those overlays so nothing collides; with
  // both hidden (mobile) the bands ride near the very top. The candle area
  // reserves enough room beneath the chips so highs never reach them.
  const topOverlaysPresent = !compact && (!hideOhlcLegend || !hideTimeframeToggle);
  const bandTopOffset = topOverlaysPresent ? 46 : 6;
  const bandReservePx = bandTopOffset + 60;

  const queryClient = useQueryClient();

  // Get any existing cached data for this symbol to use as placeholder
  const getCachedData = () => {
    return queryClient.getQueryData(priceHistoryKeys.symbol(symbol, period));
  };

  // Fetch price history data (uses shared query keys for cache consistency)
  const {
    data: fetchedApiData,
    isLoading,
    isFetching,
    error,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey: priceHistoryKeys.symbol(symbol, period),
    queryFn: () => fetchPriceHistory(symbol, period),
    enabled: !!symbol && !priceData,
    staleTime: PRICE_HISTORY_STALE_TIME,
    keepPreviousData: true,
    // Show stale/cached data immediately while fetching fresh data
    placeholderData: getCachedData,
  });

  // Live RS line + blue-dot dates (interactive surfaces only). Static charts
  // carry the RS payload in their bundle instead, so the query stays disabled.
  const { data: fetchedRsData } = useQuery({
    queryKey: priceHistoryKeys.rsLine(symbol, period),
    queryFn: () => fetchRSLine(symbol, period),
    enabled: !!symbol && !priceData && !compact && showRSLine,
    staleTime: PRICE_HISTORY_STALE_TIME,
    keepPreviousData: true,
  });

  // RS data source: bundled payload in static mode, live query otherwise.
  const rsData = useMemo(() => {
    if (priceData) {
      return Array.isArray(rsLineData) && rsLineData.length > 0
        ? { rs_line: rsLineData, blue_dots: blueDots || [] }
        : null;
    }
    return fetchedRsData;
  }, [priceData, rsLineData, blueDots, fetchedRsData]);

  // Whether the RS overlay can render at all here (drives the toggle's visibility).
  const rsAvailable = !priceData || (Array.isArray(rsLineData) && rsLineData.length > 0);

  const apiData = priceData ?? fetchedApiData;
  const effectiveDataUpdatedAt = dataUpdatedAtOverride ?? dataUpdatedAt;
  const effectiveIsLoading = Boolean(!priceData && isLoading);
  const effectiveIsFetching = Boolean(!priceData && isFetching);
  const effectiveError = priceData ? null : error;
  const effectiveRefetch = priceData ? () => Promise.resolve({ data: priceData }) : refetch;

  // Format last updated time
  const lastUpdatedText = useMemo(() => {
    if (!effectiveDataUpdatedAt) return null;
    const now = Date.now();
    const diffMs = now - effectiveDataUpdatedAt;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return new Date(effectiveDataUpdatedAt).toLocaleDateString();
  }, [effectiveDataUpdatedAt]);

  // When the timeframe toggle is hidden, force daily so the chart can't
  // remain on a stale weekly aggregation chosen before the toggle disappeared.
  const effectiveTimeframe = hideTimeframeToggle ? 'daily' : timeframe;

  // Single source of truth for "is the RS line actually drawn right now". The
  // RS series is daily-only and toggleable, so it's hidden on weekly or when
  // toggled off. This drives BOTH the reserved-strip layout (price/volume
  // reclaim the strip's space when RS is hidden) and the "RS" label.
  const rsStripShown =
    showRSLine &&
    effectiveTimeframe === 'daily' &&
    Array.isArray(rsData?.rs_line) &&
    rsData.rs_line.length > 0;

  // Transform data - memoized to avoid expensive EMA recalculations on every render
  const chartData = useMemo(() => {
    if (!apiData) return null;
    return transformToCandlestickData(apiData, effectiveTimeframe);
  }, [apiData, effectiveTimeframe]);

  // Initialize chart on mount using useLayoutEffect for synchronous DOM access
  useLayoutEffect(() => {
    if (!chartContainerRef.current) {
      return;
    }

    const containerWidth = chartContainerRef.current.clientWidth;
    const containerHeight = chartContainerRef.current.clientHeight;

    // Use provided height if container doesn't have dimensions yet
    const chartWidth = containerWidth > 0 ? containerWidth : 800;
    const chartHeight = containerHeight > 0 ? containerHeight : height;

    const {
      chart,
      volumeSeries,
      avgVolumeSeries,
      candlestickSeries,
      candleMarkers,
      ema10Series,
      ema20Series,
      ema50Series,
      sma50Series,
      sma150Series,
      sma200Series,
      rsLineSeries,
      rsMarkers,
      epsLineSeries,
    } = createPriceChartSeries(chartContainerRef.current, {
      width: chartWidth,
      height: chartHeight,
      isDarkMode,
      interactive,
    });
    chartRef.current = chart;
    volumeSeriesRef.current = volumeSeries;
    avgVolumeSeriesRef.current = avgVolumeSeries;
    candlestickSeriesRef.current = candlestickSeries;
    candleMarkersRef.current = candleMarkers;
    ema10SeriesRef.current = ema10Series;
    ema20SeriesRef.current = ema20Series;
    ema50SeriesRef.current = ema50Series;
    sma50SeriesRef.current = sma50Series;
    sma150SeriesRef.current = sma150Series;
    sma200SeriesRef.current = sma200Series;
    rsLineSeriesRef.current = rsLineSeries;
    rsMarkersRef.current = rsMarkers;
    epsLineSeriesRef.current = epsLineSeries;

    // Subscribe to crosshair move for OHLC legend (skip in compact mode — legend is hidden)
    if (!compact) chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData || !candlestickSeriesRef.current) {
        // Mouse left the chart or no data - fall back to latest candle
        if (latestCandleRef.current) {
          setLegendData(latestCandleRef.current);
        }
        return;
      }

      const candleData = param.seriesData.get(candlestickSeriesRef.current);
      if (candleData) {
        const prevClose = prevCloseMapRef.current.get(candleData.time);
        let changePercent = null;
        if (prevClose !== undefined && prevClose !== null && prevClose !== 0) {
          changePercent = ((candleData.close - prevClose) / prevClose) * 100;
        }
        setLegendData({
          open: candleData.open,
          high: candleData.high,
          low: candleData.low,
          close: candleData.close,
          changePercent,
        });
      }
    });

    // Handle container resize (including Modal fade completion)
    // Use ResizeObserver to detect when container becomes visible/changes size
    const resizeObserver = new ResizeObserver((entries) => {
      if (chartRef.current && entries[0]) {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) {
          chartRef.current.resize(width, height);
        }
      }
    });

    resizeObserver.observe(chartContainerRef.current);

    // Cleanup on unmount
    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      candlestickSeriesRef.current = null;
      candleMarkersRef.current = null;
      volumeSeriesRef.current = null;
      avgVolumeSeriesRef.current = null;
      ema10SeriesRef.current = null;
      ema20SeriesRef.current = null;
      ema50SeriesRef.current = null;
      sma50SeriesRef.current = null;
      sma150SeriesRef.current = null;
      sma200SeriesRef.current = null;
      rsLineSeriesRef.current = null;
      epsLineSeriesRef.current = null;
      rsMarkersRef.current = null;
    };
    // `interactive` is intentionally not in the deps: it's only used as the
    // chart's initial handleScroll/handleScale value here, and the dedicated
    // applyOptions effect below picks up subsequent changes without remounting
    // the chart (which would reset visible range / EMAs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, isDarkMode, symbol, compact]); // Re-initialize only when required visual inputs change

  // Track symbol changes - set flag to restore range when symbol changes
  useEffect(() => {
    if (prevSymbolRef.current !== null && prevSymbolRef.current !== symbol) {
      // Symbol changed - flag that we should restore range on next data update
      shouldRestoreRangeRef.current = true;
    }
    prevSymbolRef.current = symbol;
  }, [symbol]);

  // Toggle pan/zoom handlers without re-initializing the chart so user state
  // (visible range, EMAs) is preserved when interactivity is enabled/disabled.
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      handleScroll: interactive,
      handleScale: interactive,
    });
  }, [interactive]);

  // Subscribe to visible time range changes
  useEffect(() => {
    if (!chartRef.current || !onVisibleRangeChange) return;

    const debouncedRangeChange = debounce((range) => {
      if (range) {
        onVisibleRangeChange(range);
      }
    }, 100);

    const timeScale = chartRef.current.timeScale();
    const unsubscribe = timeScale.subscribeVisibleTimeRangeChange((range) => {
      if (range) {
        debouncedRangeChange(range);
      }
    });

    return () => {
      debouncedRangeChange.cancel();
      if (unsubscribe) unsubscribe();
    };
  }, [onVisibleRangeChange, symbol]);

  // Default the visible window to a readable recent span (~6 months daily)
  // instead of fitting all ~2 years of bars, so the recent base/VCP is legible
  // without a manual zoom. Leaves a small right pad so the latest candle and the
  // pivot axis label aren't flush against the price scale.
  const setDefaultVisibleWindow = useCallback((barCount) => {
    const timeScale = chartRef.current?.timeScale();
    if (!timeScale || !barCount) return;
    const visibleBars = effectiveTimeframe === 'weekly' ? 80 : 130;
    if (barCount > visibleBars) {
      timeScale.setVisibleLogicalRange({ from: barCount - visibleBars, to: barCount + 2 });
    } else {
      timeScale.fitContent();
    }
  }, [effectiveTimeframe]);

  // Update chart data when data changes
  useEffect(() => {
    if (!chartData || !chartRef.current) {
      return;
    }

    // Update volume data
    if (volumeSeriesRef.current && chartData.volume.length > 0) {
      volumeSeriesRef.current.setData(chartData.volume);
    }

    // ~50-day average-volume line (Minervini-style). Trailing simple average of
    // the volume series, aligned to the same time axis / volume scale.
    if (avgVolumeSeriesRef.current && chartData.volume.length > 0) {
      const AVG_WINDOW = 50;
      const vol = chartData.volume;
      const avg = [];
      let running = 0;
      for (let i = 0; i < vol.length; i += 1) {
        running += vol[i].value;
        if (i >= AVG_WINDOW) running -= vol[i - AVG_WINDOW].value;
        const denom = Math.min(i + 1, AVG_WINDOW);
        if (i >= AVG_WINDOW - 1) avg.push({ time: vol[i].time, value: running / denom });
      }
      avgVolumeSeriesRef.current.setData(avg);
    }

    // Update candlestick data
    if (candlestickSeriesRef.current && chartData.candlesticks.length > 0) {
      candlestickSeriesRef.current.setData(chartData.candlesticks);
    }

    // Update EMAs
    if (ema10SeriesRef.current && chartData.ema10.length > 0) {
      ema10SeriesRef.current.setData(chartData.ema10);
    }

    if (ema20SeriesRef.current && chartData.ema20.length > 0) {
      ema20SeriesRef.current.setData(chartData.ema20);
    }

    if (ema50SeriesRef.current && chartData.ema50.length > 0) {
      ema50SeriesRef.current.setData(chartData.ema50);
    }

    // Minervini SMA 50/150/200 stack — full chart only; compact grid tiles stay
    // clean with just the short EMAs. Always call setData (even with []) so the
    // stack clears when switching to a symbol with too little history.
    if (sma50SeriesRef.current) {
      sma50SeriesRef.current.setData(compact ? [] : (chartData.sma50 || []));
    }
    if (sma150SeriesRef.current) {
      sma150SeriesRef.current.setData(compact ? [] : (chartData.sma150 || []));
    }
    if (sma200SeriesRef.current) {
      sma200SeriesRef.current.setData(compact ? [] : (chartData.sma200 || []));
    }

    // Build previous close map for % change calculation
    const newPrevCloseMap = new Map();
    for (let i = 1; i < chartData.candlesticks.length; i++) {
      const currentCandle = chartData.candlesticks[i];
      const prevCandle = chartData.candlesticks[i - 1];
      newPrevCloseMap.set(currentCandle.time, prevCandle.close);
    }
    prevCloseMapRef.current = newPrevCloseMap;

    // Set latest candle as default legend data
    if (chartData.candlesticks.length > 0) {
      const latestCandle = chartData.candlesticks[chartData.candlesticks.length - 1];
      const prevClose = newPrevCloseMap.get(latestCandle.time);
      let changePercent = null;
      if (prevClose !== undefined && prevClose !== null && prevClose !== 0) {
        changePercent = ((latestCandle.close - prevClose) / prevClose) * 100;
      }
      const latestLegend = {
        open: latestCandle.open,
        high: latestCandle.high,
        low: latestCandle.low,
        close: latestCandle.close,
        changePercent,
      };
      latestCandleRef.current = latestLegend;
      setLegendData(latestLegend);
    }

    // Check if we should restore the range (symbol changed and new data loaded)
    if (shouldRestoreRangeRef.current) {
      shouldRestoreRangeRef.current = false; // Clear the flag

      if (visibleRange && visibleRange.from && visibleRange.to) {
        // Use setTimeout to ensure data is fully rendered before setting range
        setTimeout(() => {
          if (chartRef.current) {
            chartRef.current.timeScale().setVisibleRange(visibleRange);
          }
        }, 0);
      } else {
        // No saved range - default to a readable recent window
        setDefaultVisibleWindow(chartData.candlesticks.length);
      }
    } else if (isFirstDataLoadRef.current) {
      // First load - default to a readable recent window. Static bundles ship
      // ~2 years of bars; fitContent() would squeeze the recent base/VCP into a
      // sliver and force a manual zoom, so focus on the most recent months and
      // let the user scroll back for context.
      isFirstDataLoadRef.current = false;
      setDefaultVisibleWindow(chartData.candlesticks.length);
    }
    // Otherwise, don't touch the zoom - let user adjust freely
  // setDefaultVisibleWindow is stable (defined below from refs); excluded to
  // keep this effect keyed only on data/range changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartData, visibleRange, effectiveTimeframe]);

  // Draw the VCP / setup pivot (buy-trigger) as a horizontal price line on the
  // candlestick series. This is the key actionable level for VCP / Minervini
  // breakouts. Recreated whenever the pivot or the underlying series changes.
  useEffect(() => {
    const series = candlestickSeriesRef.current;
    if (!series) return undefined;

    if (pivotLineRef.current) {
      try { series.removePriceLine(pivotLineRef.current); } catch { /* series recreated */ }
      pivotLineRef.current = null;
    }

    if (pivotPrice != null && Number.isFinite(pivotPrice) && pivotPrice > 0) {
      pivotLineRef.current = series.createPriceLine({
        price: pivotPrice,
        color: '#ff9800',
        lineWidth: 2,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: pivotLabel,
      });
    }

    return () => {
      const current = candlestickSeriesRef.current;
      if (pivotLineRef.current && current) {
        try { current.removePriceLine(pivotLineRef.current); } catch { /* series recreated */ }
        pivotLineRef.current = null;
      }
    };
  }, [pivotPrice, pivotLabel, chartData]);

  // Draw VCP consolidation boxes over the candles (full chart only). The
  // primitive follows pan/zoom on its own; we only (re)create it when the
  // series is rebuilt or the boxes change. Wrapped so a charting aid can never
  // break the chart.
  useEffect(() => {
    const series = candlestickSeriesRef.current;
    if (!series || compact) return undefined;
    const boxes = Array.isArray(vcpBoxes) ? vcpBoxes : [];
    try {
      if (!vcpBoxPrimitiveRef.current) {
        vcpBoxPrimitiveRef.current = new VcpBoxPrimitive(boxes);
        series.attachPrimitive(vcpBoxPrimitiveRef.current);
      } else {
        vcpBoxPrimitiveRef.current.setBoxes(boxes);
      }
    } catch { /* primitive unsupported / series recreated — ignore */ }

    return () => {
      const current = candlestickSeriesRef.current;
      if (vcpBoxPrimitiveRef.current && current) {
        try { current.detachPrimitive(vcpBoxPrimitiveRef.current); } catch { /* already gone */ }
      }
      vcpBoxPrimitiveRef.current = null;
    };
  }, [vcpBoxes, chartData, compact]);

  // MM360 color-band strips (Pressure / Buy Risk / TPR) across the top of the
  // price pane, time-aligned to the candles. Re-aligns on pan/zoom because the
  // primitive recomputes coordinates on every chart redraw.
  useEffect(() => {
    const series = candlestickSeriesRef.current;
    if (!series || compact) return undefined;
    const hasBands = bands && (bands.pressure_history || bands.buy_risk_history || bands.tpr_history);
    const barTimes = Array.isArray(chartData?.candlesticks)
      ? chartData.candlesticks.map((c) => c.time)
      : [];
    try {
      if (hasBands && barTimes.length >= 2) {
        if (!bandStripPrimitiveRef.current) {
          bandStripPrimitiveRef.current = new BandStripPrimitive(bands, barTimes, bandTopOffset);
          series.attachPrimitive(bandStripPrimitiveRef.current);
        } else {
          bandStripPrimitiveRef.current.setData(bands, barTimes, bandTopOffset);
        }
      }
    } catch { /* primitive unsupported / series recreated — ignore */ }

    return () => {
      const current = candlestickSeriesRef.current;
      if (bandStripPrimitiveRef.current && current) {
        try { current.detachPrimitive(bandStripPrimitiveRef.current); } catch { /* already gone */ }
      }
      bandStripPrimitiveRef.current = null;
    };
  }, [bands, chartData, compact, bandTopOffset]);

  // Buy-point annotations (Buy Alert / Buy Ready / Buy Point / SEPA) drawn as
  // compact chips in a row under the top band strips, each connected by a thin
  // vertical line down to its pivot price — so labels never overlap the candles.
  // Re-aligns on pan/zoom because the primitive recomputes coordinates on every
  // redraw. Wrapped so a charting aid can never break the chart.
  useEffect(() => {
    const series = candlestickSeriesRef.current;
    if (!series || compact) return undefined;
    const list = Array.isArray(buyPoints) ? buyPoints : [];
    const barTimes = Array.isArray(chartData?.candlesticks)
      ? chartData.candlesticks.map((c) => c.time)
      : [];
    try {
      if (list.length > 0 && barTimes.length >= 2) {
        if (!buyPointPrimitiveRef.current) {
          buyPointPrimitiveRef.current = new BuyPointPrimitive(list, barTimes, bandTopOffset);
          series.attachPrimitive(buyPointPrimitiveRef.current);
        } else {
          buyPointPrimitiveRef.current.setData(list, barTimes, bandTopOffset);
        }
      } else if (buyPointPrimitiveRef.current) {
        buyPointPrimitiveRef.current.setData([], barTimes, bandTopOffset);
      }
    } catch { /* primitive unsupported / series recreated — ignore */ }

    return () => {
      const current = candlestickSeriesRef.current;
      if (buyPointPrimitiveRef.current && current) {
        try { current.detachPrimitive(buyPointPrimitiveRef.current); } catch { /* already gone */ }
      }
      buyPointPrimitiveRef.current = null;
    };
  }, [buyPoints, chartData, compact, bandTopOffset]);

  // Earnings line (収益ライン): smooth green fair-value line on the price scale.
  // Date-anchored so it stays aligned under zoom/scale changes.
  useEffect(() => {
    const series = epsLineSeriesRef.current;
    if (!series) return;
    const pts = Array.isArray(epsLine) ? epsLine : [];
    try {
      series.setData(pts.map((p) => ({ time: p.time, value: p.value })));
    } catch { /* series recreated — ignore */ }
  }, [epsLine, chartData, compact]);

  // Update the RS line overlay + blue-dot markers.
  // Only rendered on the daily timeframe (the RS series is daily); cleared
  // otherwise so stale points never linger under weekly candles.
  useEffect(() => {
    const series = rsLineSeriesRef.current;
    const markers = rsMarkersRef.current;
    if (!series || !chartRef.current) return;

    if (!rsStripShown) {
      series.setData([]);
      if (markers) markers.setMarkers([]);
      return;
    }

    const points = rsData.rs_line;
    series.setData(points.map((p) => ({ time: p.time, value: p.value })));

    const timesInSeries = new Set(points.map((p) => p.time));
    const markerList = (rsData.blue_dots || [])
      .filter((t) => timesInSeries.has(t))
      .map((t) => ({ time: t, position: 'inBar', color: '#2196f3', shape: 'circle' }));
    // Latest RS rating labelled at the head (right edge) of the RS line.
    if (rsRatingValue != null && points.length > 0) {
      markerList.push({
        time: points[points.length - 1].time,
        position: 'aboveBar',
        color: '#FFA726',
        shape: 'circle',
        text: `RS ${Math.round(rsRatingValue)}`,
      });
    }
    if (markers) markers.setMarkers(markerList);
  }, [rsData, rsStripShown, rsRatingValue]);

  // RS strip layout: when the RS line is shown, compress price to a 0.66 floor
  // so the [0.66, 0.78] band below it is always empty (the RS scale floats in
  // [rTop, 0.78], sized dynamically by the effect below); when hidden, expand
  // price to 0.78 to reclaim that space so the chart doesn't carry an empty
  // band. Runs after the init layout effect (same commit, ordered after) and
  // re-runs on chart re-creation so fresh series get the right bands.
  // useLayoutEffect keeps the resize off-screen (no flash).
  useLayoutEffect(() => {
    const candle = candlestickSeriesRef.current;
    const volume = volumeSeriesRef.current;
    if (!candle || !volume || !chartRef.current) return;

    // RS shown -> compress price to a 0.66 floor (bottom 0.34) so [0.66, 0.78] is
    // an always-empty strip the RS band lives in; hidden -> full height (0.78).
    // Top margin leaves headroom under the OHLC legend / timeframe toggle so the
    // most recent candles (a leader near new highs sits at the top-right) are
    // never hidden behind those corner overlays.
    const candleBottom = rsStripShown ? 0.34 : 0.22;
    // Reserve a pixel band at the top for any top overlays (OHLC legend /
    // toggle), the MM360 color strips, and the buy-point chip rows so neither
    // the candle highs nor the price-scale value tag collide with them —
    // critical on short mobile charts where a flat 14% leaves too few pixels.
    // `bandReservePx` tracks the band top offset. Compact tiles draw no strips.
    const candleTop = compact
      ? 0.05
      : Math.min(0.45, Math.max(0.14, bandReservePx / Math.max(height, 1)));
    candle.priceScale().applyOptions({ scaleMargins: { top: candleTop, bottom: candleBottom } });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  }, [rsStripShown, symbol, height, isDarkMode, compact, bandReservePx]);

  // Dynamic RS band: size the RS overlay scale so the line fills the empty space
  // below the candles without overlapping them. Recomputes on data change and on
  // pan/zoom (price re-auto-scales to the visible window, so the safe band moves).
  // Debounced; the 12%-38% clamp lives in computeRsBand. Skipped when RS is hidden.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !rsLineSeriesRef.current || !rsStripShown) return;

    // candles/rsLine are captured per effect run. They stay fresh because the
    // effect re-subscribes (and the cleanup cancels the pending debounce) whenever
    // chartData/rsData change, so a stale debounced callback can never fire.
    const candles = chartData?.candlesticks || [];
    const rsLine = rsData?.rs_line || [];

    const apply = () => {
      const liveChart = chartRef.current;
      const rsSeries = rsLineSeriesRef.current;
      if (!liveChart || !rsSeries) return; // guard against teardown mid-debounce
      const rTop = rsBandForRange(candles, rsLine, liveChart.timeScale().getVisibleRange());
      rsSeries.priceScale().applyOptions({ scaleMargins: { top: rTop, bottom: 0.22 } });
      setRsBandTop(rTop);
    };

    apply();
    const debouncedApply = debounce(apply, 80);
    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleTimeRangeChange(debouncedApply);
    return () => {
      debouncedApply.cancel();
      // Only unsubscribe if this exact chart is still mounted. On unmount or a
      // symbol-change recreate, the old chart (and its time scale) is already
      // disposed, and calling unsubscribe on it would throw.
      if (chartRef.current === chart) {
        timeScale.unsubscribeVisibleTimeRangeChange(debouncedApply);
      }
    };
  }, [chartData, rsData, rsStripShown]);

  // Determine overlay state
  // Only show full loading state if we have no data at all (not even placeholder)
  const hasData = chartData && chartData.candlesticks.length > 0;
  const showLoading = effectiveIsLoading && !hasData;
  const showError = !effectiveIsLoading && effectiveError && !hasData;
  const showNoData = !effectiveIsLoading && !effectiveError && !hasData;
  // Show refresh indicator when fetching but we have data to display
  const showRefreshIndicator = effectiveIsFetching && hasData;

  // The "RS" label rides the strip, so it shows whenever the strip is drawn —
  // except in compact mode, where (like the OHLC legend/toggles) overlays are
  // suppressed for dense grid tiles.
  const rsLineVisible = !compact && rsStripShown;

  return (
    <Box
      sx={{
        width: '100%',
        height: height,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Timeframe Toggle - only show when chart has data */}
      {!compact && !hideTimeframeToggle && !showLoading && !showError && !showNoData && (
        <Box
          sx={{
            position: 'absolute',
            top: 10,
            right: 10,
            zIndex: 10,
            bgcolor: 'background.paper',
            borderRadius: 1,
            boxShadow: 1,
          }}
        >
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <ToggleButtonGroup
              value={timeframe}
              exclusive
              onChange={(e, newTimeframe) => {
                if (newTimeframe !== null) {
                  setTimeframe(newTimeframe);
                }
              }}
              size="small"
            >
              <ToggleButton value="daily">Daily</ToggleButton>
              <ToggleButton value="weekly">Weekly</ToggleButton>
            </ToggleButtonGroup>
            {/* RS line overlay toggle — shown only where RS data can load
                (live charts, or static charts whose bundle carries rs_line). */}
            {rsAvailable && (
              <ToggleButtonGroup size="small">
                <ToggleButton
                  value="rs"
                  selected={showRSLine}
                  disabled={effectiveTimeframe !== 'daily'}
                  onClick={() => setShowRSLine((prev) => !prev)}
                  title="RS line (stock vs. benchmark) with blue-dot leadership signals"
                >
                  RS
                </ToggleButton>
              </ToggleButtonGroup>
            )}
          </Box>
        </Box>
      )}

      {/* OHLC Legend - show when hovering over chart. Hidden on mobile
          (hideOhlcLegend) where it would otherwise sit over the top band row. */}
      {!compact && !hideOhlcLegend && !showLoading && !showError && !showNoData && legendData && (
        <Box
          sx={{
            position: 'absolute',
            top: 10,
            left: 10,
            zIndex: 10,
            bgcolor: 'rgba(30, 30, 30, 0.85)',
            borderRadius: 1,
            px: 1.5,
            py: 0.5,
            display: 'flex',
            gap: 2,
            fontFamily: 'monospace',
            fontSize: '0.8rem',
          }}
        >
          <span style={{ color: '#999' }}>
            O <span style={{ color: '#fff' }}>{legendData.open.toFixed(2)}</span>
          </span>
          <span style={{ color: '#999' }}>
            H <span style={{ color: '#fff' }}>{legendData.high.toFixed(2)}</span>
          </span>
          <span style={{ color: '#999' }}>
            L <span style={{ color: '#fff' }}>{legendData.low.toFixed(2)}</span>
          </span>
          <span style={{ color: '#999' }}>
            C <span style={{ color: '#fff' }}>{legendData.close.toFixed(2)}</span>
          </span>
          {legendData.changePercent !== null && (
            <span
              style={{
                color: legendData.changePercent >= 0 ? '#4CF64D' : '#E619CD',
                fontWeight: 500,
              }}
            >
              {legendData.changePercent >= 0 ? '+' : ''}{legendData.changePercent.toFixed(2)}%
            </span>
          )}
        </Box>
      )}

      {/* Chart Container - always rendered so useLayoutEffect can initialize */}
      <div
        ref={chartContainerRef}
        style={{
          width: '100%',
          height: '100%',
        }}
      />

      {/* RS strip label - pinned to the top of the RS band (scaleMargins.top
          of the 'rs' scale) so the lower line is clearly the relative-strength
          overlay, not another moving average. */}
      {rsLineVisible && (
        <Typography
          variant="caption"
          sx={{
            position: 'absolute',
            top: `${(rsBandTop * 100).toFixed(1)}%`,
            left: 8,
            zIndex: 10,
            color: '#FFA726',
            fontFamily: 'monospace',
            fontWeight: 600,
            fontSize: '0.65rem',
            letterSpacing: '0.05em',
            pointerEvents: 'none',
            textShadow: '0 0 3px rgba(0, 0, 0, 0.6)',
          }}
        >
          RS
        </Typography>
      )}

      {/* Loading skeleton overlay */}
      {showLoading && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        >
          <ChartSkeleton height={height} isDarkMode={isDarkMode} />
        </Box>
      )}

      {/* Refresh indicator - shows when fetching fresh data while displaying cached data */}
      {showRefreshIndicator && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 10,
            right: 10,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            bgcolor: 'rgba(30, 30, 30, 0.85)',
            borderRadius: 1,
            px: 1.5,
            py: 0.5,
          }}
        >
          <CircularProgress size={14} sx={{ color: '#87FBFB' }} />
          <Typography variant="caption" sx={{ color: '#87FBFB', fontSize: '0.7rem' }}>
            Refreshing...
          </Typography>
        </Box>
      )}

      {/* Last updated indicator */}
      {!compact && !showLoading && !showError && !showNoData && lastUpdatedText && !showRefreshIndicator && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 10,
            right: 10,
            zIndex: 10,
            bgcolor: 'rgba(30, 30, 30, 0.7)',
            borderRadius: 1,
            px: 1,
            py: 0.25,
          }}
        >
          <Typography variant="caption" sx={{ color: '#999', fontSize: '0.65rem' }}>
            Updated {lastUpdatedText}
          </Typography>
        </Box>
      )}

      {/* Error overlay */}
      {showError && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.paper',
            p: 3,
          }}
        >
          <Alert severity="error" sx={{ maxWidth: '100%' }}>
            <AlertTitle>Failed to load chart data</AlertTitle>
            {effectiveError.message || 'An error occurred while fetching the chart data'}
            <Button onClick={() => effectiveRefetch()} variant="outlined" size="small" sx={{ mt: 1 }}>
              Retry
            </Button>
          </Alert>
        </Box>
      )}

      {/* No data overlay */}
      {showNoData && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            bgcolor: 'background.paper',
          }}
        >
          <Alert severity="info">No historical data available for {symbol}</Alert>
        </Box>
      )}
    </Box>
  );
}

export default CandlestickChart;
