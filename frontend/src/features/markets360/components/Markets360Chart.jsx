import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
} from 'lightweight-charts';

import { BandStripPrimitive } from '../../../components/Charts/bandStripPrimitive';
import { BuyPointPrimitive } from '../../../components/Charts/buyPointPrimitive';
import { VcpBoxPrimitive } from '../../../components/Charts/vcpBoxPrimitive';
import { aggregateToWeekly, calculateSMA } from '../../../components/Charts/candlestickData';

// Minervini Markets 360 palette — teal up / red down candles, MA stack colored
// to match the legend (blue fast, red mid, gray long), gray SPY overlay.
const UP = '#22ab94';
const DOWN = '#f23645';
const MA_DEFS = [
  { key: 'ma21', period: 21, color: '#2962ff', label: 'MA' },
  { key: 'ma50', period: 50, color: '#f23645', label: 'MA' },
  { key: 'ma150', period: 150, color: '#787b86', label: 'MA', hiddenDefault: true },
  { key: 'ma200', period: 200, color: '#b0bec5', label: 'MA' },
];

const BAND_TOP_OFFSET = 46;

// Returns rows keyed by `.date` (the convention the shared SMA/weekly helpers
// expect). The caller maps these to lightweight-charts `{ time, ... }` objects.
function toRows(bars, timeframe) {
  const daily = (bars || []).map((b) => ({
    date: b.date,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
  return timeframe === 'weekly' ? aggregateToWeekly(daily) : daily;
}

/**
 * Standalone Markets 360 price chart. Renders candles, the 21/50/150/200 MA
 * stack, the SPY overlay (shape-aligned on its own hidden scale), volume +
 * average-volume, the RPR bottom pane, MM360 color bands, staged buy-point
 * chips, VCP boxes, RS line, and green 'E' earnings markers — from the
 * standalone markets360 chart payload.
 */
export default function Markets360Chart({
  chart: payload,
  timeframe = 'daily',
  height = 560,
  visibility = {},
  onLegend = null,
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const spyRef = useRef(null);
  const volRef = useRef(null);
  const avgVolRef = useRef(null);
  const rsRef = useRef(null);
  const rprRef = useRef(null);
  const maRefs = useRef({});
  const bandRef = useRef(null);
  const buyPointRef = useRef(null);
  const vcpRef = useRef(null);
  const markersRef = useRef(null);

  // Build chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: {
        background: { color: '#0a0a0f' },
        textColor: '#d1d4dc',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(60,64,72,0.25)' },
        horzLines: { color: 'rgba(60,64,72,0.25)' },
      },
      rightPriceScale: { borderColor: '#2a2e39', scaleMargins: { top: 0.08, bottom: 0.34 } },
      timeScale: { borderColor: '#2a2e39', rightOffset: 6, barSpacing: 6 },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN,
      wickUpColor: UP, wickDownColor: DOWN, priceScaleId: 'right',
    });
    candleRef.current = candle;
    markersRef.current = createSeriesMarkers(candle, []);

    // SPY overlay on its own hidden scale so it aligns by shape, not price.
    const spy = chart.addSeries(LineSeries, {
      color: '#9598a1', lineWidth: 2, priceScaleId: 'spy',
      lastValueVisible: false, priceLineVisible: false,
    });
    spy.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.34 }, visible: false });
    spyRef.current = spy;

    // MA stack.
    MA_DEFS.forEach((def) => {
      maRefs.current[def.key] = chart.addSeries(LineSeries, {
        color: def.color, lineWidth: 1, priceScaleId: 'right',
        lastValueVisible: true, priceLineVisible: false,
      });
    });

    // Volume + average-volume on a bottom band.
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', priceFormat: { type: 'volume' } });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.74, bottom: 0.12 } });
    volRef.current = vol;
    const avgVol = chart.addSeries(LineSeries, {
      color: '#e0a3a3', lineWidth: 1, priceScaleId: 'volume',
      lastValueVisible: false, priceLineVisible: false,
    });
    avgVolRef.current = avgVol;

    // RS line (faint, overlay band).
    const rs = chart.addSeries(LineSeries, {
      color: '#ff9800', lineWidth: 1, priceScaleId: 'rs',
      lastValueVisible: false, priceLineVisible: false,
    });
    rs.priceScale().applyOptions({ scaleMargins: { top: 0.66, bottom: 0.24 }, visible: false });
    rsRef.current = rs;

    // RPR pane: 0–99 line pinned to the very bottom.
    const rpr = chart.addSeries(LineSeries, {
      color: '#3aa0ff', lineWidth: 1, priceScaleId: 'rpr',
      lastValueVisible: true, priceLineVisible: false,
    });
    rpr.priceScale().applyOptions({ scaleMargins: { top: 0.9, bottom: 0 }, visible: false });
    rprRef.current = rpr;

    // Hover OHLC legend.
    if (onLegend) {
      chart.subscribeCrosshairMove((param) => {
        if (!param || !param.time || !param.seriesData) return;
        const d = param.seriesData.get(candle);
        if (d) onLegend({ time: param.time, ...d });
      });
    }

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      maRefs.current = {};
    };
  }, [height, onLegend]);

  // Feed data whenever payload / timeframe changes.
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    if (!chart || !candle || !payload) return;

    const rows = toRows(payload.bars, timeframe);
    if (!rows.length) return;
    const candles = rows.map((r) => ({
      time: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
    }));
    candle.setData(candles);

    // MA stack (computed on the active timeframe so weekly is correct).
    MA_DEFS.forEach((def) => {
      const series = maRefs.current[def.key];
      if (!series) return;
      const ma = calculateSMA(rows, def.period);
      series.setData(ma);
      const visible = visibility[def.key] ?? !def.hiddenDefault;
      series.applyOptions({ visible });
    });

    // SPY overlay.
    const spy = spyRef.current;
    if (spy) {
      const spyData = (payload.spy_overlay || []).map((p) => ({ time: p.time, value: p.value }));
      spy.setData(spyData);
      spy.applyOptions({ visible: (visibility.spy ?? true) && spyData.length > 0 });
    }

    // Volume + avg volume.
    const vol = volRef.current;
    if (vol) {
      vol.setData(candles.map((c) => ({
        time: c.time,
        value: c.volume || 0,
        color: c.close >= c.open ? 'rgba(34,171,148,0.5)' : 'rgba(242,54,69,0.5)',
      })));
    }
    if (avgVolRef.current) {
      const avg = calculateSMA(rows.map((r) => ({ date: r.date, close: r.volume || 0 })), 50);
      avgVolRef.current.setData(avg);
    }

    // RS line + RPR pane.
    if (rsRef.current) rsRef.current.setData((payload.rs_line || []).map((p) => ({ time: p.time, value: p.value })));
    if (rprRef.current) rprRef.current.setData((payload.rpr_pane || []).map((p) => ({ time: p.time, value: p.value })));

    // Earnings 'E' markers.
    if (markersRef.current) {
      const marks = (payload.earnings_markers || []).map((m) => ({
        time: m.time, position: 'belowBar', color: '#22ab94', shape: 'circle', text: 'E',
      }));
      markersRef.current.setMarkers(marks);
    }

    const barTimes = candles.map((c) => c.time);

    // MM360 color bands.
    try {
      const bands = payload.bands;
      const hasBands = bands && (bands.pressure_history || bands.buy_risk_history || bands.tpr_history);
      if (hasBands && barTimes.length >= 2) {
        if (!bandRef.current) {
          bandRef.current = new BandStripPrimitive(bands, barTimes, BAND_TOP_OFFSET);
          candle.attachPrimitive(bandRef.current);
        } else {
          bandRef.current.setData(bands, barTimes, BAND_TOP_OFFSET);
        }
      }
    } catch { /* primitive optional */ }

    // Buy-point chips.
    try {
      const list = Array.isArray(payload.buy_points) ? payload.buy_points : [];
      if (list.length && barTimes.length >= 2) {
        if (!buyPointRef.current) {
          buyPointRef.current = new BuyPointPrimitive(list, barTimes, BAND_TOP_OFFSET);
          candle.attachPrimitive(buyPointRef.current);
        } else {
          buyPointRef.current.setData(list, barTimes, BAND_TOP_OFFSET);
        }
      }
    } catch { /* primitive optional */ }

    // VCP boxes.
    try {
      const boxes = Array.isArray(payload.vcp_boxes) ? payload.vcp_boxes : [];
      if (!vcpRef.current) {
        vcpRef.current = new VcpBoxPrimitive(boxes);
        candle.attachPrimitive(vcpRef.current);
      } else {
        vcpRef.current.setBoxes(boxes);
      }
    } catch { /* primitive optional */ }

    chart.timeScale().fitContent();
  }, [payload, timeframe, visibility]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
