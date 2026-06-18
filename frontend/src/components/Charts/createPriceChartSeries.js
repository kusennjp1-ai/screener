import {
  createChart,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
} from 'lightweight-charts';

// Create the price chart and all of its series in one place, returning every
// handle the component needs to drive. Vertical bands (scaleMargins) are neutral
// defaults here; the component's "RS strip layout" and "dynamic RS band" effects
// reapply them reactively based on whether the RS line is shown.
export function createPriceChartSeries(container, { width, height, isDarkMode, interactive }) {
  const chart = createChart(container, {
    width,
    height,
    layout: {
      background: { type: 'solid', color: isDarkMode ? '#1e1e1e' : '#ffffff' },
      textColor: isDarkMode ? '#d1d4dc' : '#333333',
    },
    grid: {
      vertLines: { color: isDarkMode ? '#363a45' : '#e0e0e0' },
      horzLines: { color: isDarkMode ? '#363a45' : '#e0e0e0' },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: {
      borderColor: isDarkMode ? '#485263' : '#cccccc',
      mode: 1, // Logarithmic scale
    },
    timeScale: {
      borderColor: isDarkMode ? '#485263' : '#cccccc',
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: interactive,
    handleScale: interactive,
  });

  // Volume (bottom). Neutral scaleMargins; reapplied by the RS strip layout effect.
  const volumeSeries = chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
  });
  volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.7, bottom: 0 } });

  // Average-volume line (Minervini-style ~50-day avg) on the same volume scale,
  // so above/below-average volume reads at a glance. Data set by the component.
  const avgVolumeSeries = chart.addSeries(LineSeries, {
    color: '#FFD54F',
    lineWidth: 1,
    priceScaleId: 'volume',
    lastValueVisible: false,
    priceLineVisible: false,
  });

  // Candlesticks. Neutral scaleMargins; reapplied by the RS strip layout effect.
  const candlestickSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#2196f3',
    downColor: '#E619CD',
    borderVisible: false,
    wickUpColor: '#2196f3',
    wickDownColor: '#E619CD',
    priceScaleId: 'right',
  });
  candlestickSeries.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.3 } });
  // Buy-point annotations (Buy Alert / Buy Ready / Buy Point / SEPA) attach here.
  const candleMarkers = createSeriesMarkers(candlestickSeries, []);

  // EMA 10 / 20 / 50 — short-term entry guides. Share the price ('right') scale.
  // Thin (1px). Distinct hues (gray / cyan / yellow) so the MAs don't cluster in
  // one color family and stay clear of the green earnings line and amber RS line.
  const ema10Series = chart.addSeries(LineSeries, { color: '#E0E0E0', lineWidth: 1, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });
  const ema20Series = chart.addSeries(LineSeries, { color: '#4DD0E1', lineWidth: 1, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });
  const ema50Series = chart.addSeries(LineSeries, { color: '#FFEE58', lineWidth: 1, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });

  // Minervini trend-template SMA stack (50 / 150 / 200-day). Purple → pink → red,
  // a distinct family from the EMAs so the long-term trend stack reads clearly:
  // price should sit above 50 > 150 > 200 with a rising 200-day line. Avoids the
  // orange pivot line and amber RS line. Full chart only.
  const sma50Series = chart.addSeries(LineSeries, { color: '#BA68C8', lineWidth: 1, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });
  const sma150Series = chart.addSeries(LineSeries, { color: '#F06292', lineWidth: 1, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });
  const sma200Series = chart.addSeries(LineSeries, { color: '#FF5252', lineWidth: 1, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false });

  // RS line on its own hidden overlay scale (orange — distinct from the EMAs). It
  // sits in a band below the candles; blue-dot markers attach to it. The band is
  // sized dynamically by the "dynamic RS band" effect.
  const rsLineSeries = chart.addSeries(LineSeries, {
    color: '#FFA726',
    lineWidth: 2,
    priceScaleId: 'rs',
    lastValueVisible: false,
    priceLineVisible: false,
  });
  rsLineSeries.priceScale().applyOptions({ scaleMargins: { top: 0.66, bottom: 0.22 }, visible: false });
  const rsMarkers = createSeriesMarkers(rsLineSeries, []);

  // Earnings line (収益ライン / Redford-MarketSurge style): a smooth fair-value
  // line in PRICE units, on the same 'right' price scale as the candles so the
  // stock reads cheap (price below the green line) or rich (price above it) at a
  // glance. Backend ships it pre-scaled by the stock's own median valuation
  // multiple, so it sits naturally in the price range. Green, smooth (not
  // stepped). `autoscaleInfoProvider: () => null` keeps it OUT of the price
  // axis autoscale, so an early low-EPS tail can't blow the axis out and squash
  // the candles into a sliver — the candles/MAs set the scale; the line draws
  // within it (clipping only in extreme over/under-valuation).
  const epsLineSeries = chart.addSeries(LineSeries, {
    color: '#2EAD5B',
    lineWidth: 2,
    priceScaleId: 'right',
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    autoscaleInfoProvider: () => null,
  });

  return {
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
  };
}
