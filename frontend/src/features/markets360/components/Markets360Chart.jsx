import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
} from 'lightweight-charts';

import { aggregateToWeekly, calculateSMA } from '../../../components/Charts/candlestickData';

// Minervini Markets 360 palette — teal up / red down candles, MA stack colored
// to match the legend (blue fast, red mid, gray long), gray SPY overlay.
const UP = '#22ab94';
const DOWN = '#f23645';
const MA_DEFS = [
  { key: 'ma21', period: 21, color: '#2962ff' },
  { key: 'ma50', period: 50, color: '#f23645' },
  { key: 'ma150', period: 150, color: '#787b86', hiddenDefault: true },
  { key: 'ma200', period: 200, color: '#b0bec5' },
];

// Band state -> strip color (green / amber / red), matching the MM360 strips.
const BAND_COLOR = {
  buy: '#2e7d52', low: '#2e7d52', strong: '#2e7d52',
  neutral: '#9a7d20', medium: '#9a7d20', transition: '#9a7d20',
  sell: '#9a3b32', high: '#9a3b32', weak: '#9a3b32',
};
const BAND_ROWS = [
  { key: 'pressure_history', label: 'Minervini Pressure' },
  { key: 'buy_risk_history', label: 'Minervini Buy Risk (Colors)' },
  { key: 'tpr_history', label: 'Minervini TPR (Colors)' },
];
// Buy-point chip styling per stage.
const CHIP = {
  buy_alert: { bg: '#e08a1e', text: 'Buy Alert' },
  buy_ready: { bg: '#2e9e6b', text: 'Buy Ready' },
  buy_point: { bg: '#2962ff', text: 'Buy Point' },
  sepa_buy_point: { bg: '#5b8def', text: 'SEPA Buy Point' },
};

// Returns rows keyed by `.date` (the convention the shared SMA/weekly helpers
// expect). The caller maps these to lightweight-charts `{ time, ... }` objects.
function toRows(bars, timeframe) {
  const daily = (bars || []).map((b) => ({
    date: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
  }));
  return timeframe === 'weekly' ? aggregateToWeekly(daily) : daily;
}

// A single color-band row: an evenly-divided strip of per-bar colored cells.
function BandRow({ history, label, top, rightInset }) {
  if (!Array.isArray(history) || history.length === 0) return null;
  return (
    <div style={{ position: 'absolute', top, left: 0, right: rightInset, height: 13, display: 'flex', zIndex: 3, pointerEvents: 'none' }}>
      {history.map((s, i) => (
        <div key={i} style={{ flex: 1, background: BAND_COLOR[s] || '#3a3f4b' }} />
      ))}
      <div style={{ position: 'absolute', left: 6, top: 0, fontSize: 11, color: '#e6e8ec', whiteSpace: 'nowrap', textShadow: '0 1px 2px #000' }}>
        {label}
      </div>
    </div>
  );
}

/**
 * Standalone Markets 360 price chart. Candles + 21/50/150/200 MA stack + SPY
 * overlay + volume/avg-vol + RPR pane + green 'E' earnings markers render via
 * lightweight-charts; the MM360 color bands and staged buy-point chips render
 * as time-aligned HTML overlays (robust, self-owned — no dependence on chart
 * primitive internals).
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
  const markersRef = useRef(null);

  // Overlay geometry: right inset (price-scale width) + buy-point chip x's.
  const [overlay, setOverlay] = useState({ rightInset: 64, chips: [] });

  const recomputeOverlay = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || !payload) return;
    let rightInset = 64;
    try { rightInset = chart.priceScale('right').width() || 64; } catch { /* default */ }
    const ts = chart.timeScale();
    const chips = [];
    for (const bp of payload.buy_points || []) {
      let x = null;
      try { x = ts.timeToCoordinate(bp.time); } catch { x = null; }
      if (x != null) chips.push({ x, type: bp.type, price: bp.price });
    }
    setOverlay({ rightInset, chips });
  }, [payload]);

  // Build chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: { background: { color: '#0a0a0f' }, textColor: '#d1d4dc', fontSize: 11 },
      grid: { vertLines: { color: 'rgba(60,64,72,0.22)' }, horzLines: { color: 'rgba(60,64,72,0.22)' } },
      rightPriceScale: { borderColor: '#2a2e39', scaleMargins: { top: 0.12, bottom: 0.34 } },
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

    const spy = chart.addSeries(LineSeries, {
      color: '#9598a1', lineWidth: 2, priceScaleId: 'spy', lastValueVisible: false, priceLineVisible: false,
    });
    spy.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.34 }, visible: false });
    spyRef.current = spy;

    MA_DEFS.forEach((def) => {
      maRefs.current[def.key] = chart.addSeries(LineSeries, {
        color: def.color, lineWidth: 1, priceScaleId: 'right', lastValueVisible: true, priceLineVisible: false,
      });
    });

    const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', priceFormat: { type: 'volume' } });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.74, bottom: 0.12 } });
    volRef.current = vol;
    const avgVol = chart.addSeries(LineSeries, {
      color: '#e0a3a3', lineWidth: 1, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false,
    });
    avgVolRef.current = avgVol;

    const rs = chart.addSeries(LineSeries, {
      color: '#ff9800', lineWidth: 1, priceScaleId: 'rs', lastValueVisible: false, priceLineVisible: false,
    });
    rs.priceScale().applyOptions({ scaleMargins: { top: 0.66, bottom: 0.24 }, visible: false });
    rsRef.current = rs;

    const rpr = chart.addSeries(LineSeries, {
      color: '#3aa0ff', lineWidth: 1, priceScaleId: 'rpr', lastValueVisible: true, priceLineVisible: false,
    });
    rpr.priceScale().applyOptions({ scaleMargins: { top: 0.9, bottom: 0 }, visible: false });
    rprRef.current = rpr;

    if (onLegend) {
      chart.subscribeCrosshairMove((param) => {
        if (!param || !param.time || !param.seriesData) return;
        const d = param.seriesData.get(candle);
        if (d) onLegend({ time: param.time, ...d });
      });
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => recomputeOverlay());

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
      recomputeOverlay();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      maRefs.current = {};
    };
  }, [height, onLegend, recomputeOverlay]);

  // Feed data whenever payload / timeframe changes.
  useEffect(() => {
    const chart = chartRef.current;
    const candle = candleRef.current;
    if (!chart || !candle || !payload) return undefined;

    const rows = toRows(payload.bars, timeframe);
    if (!rows.length) return undefined;
    const candles = rows.map((r) => ({
      time: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
    }));
    candle.setData(candles);

    MA_DEFS.forEach((def) => {
      const series = maRefs.current[def.key];
      if (!series) return;
      series.setData(calculateSMA(rows, def.period));
      series.applyOptions({ visible: visibility[def.key] ?? !def.hiddenDefault });
    });

    const spy = spyRef.current;
    if (spy) {
      const spyData = (payload.spy_overlay || []).map((p) => ({ time: p.time, value: p.value }));
      spy.setData(spyData);
      spy.applyOptions({ visible: (visibility.spy ?? true) && spyData.length > 0 });
    }

    if (volRef.current) {
      volRef.current.setData(candles.map((c) => ({
        time: c.time, value: c.volume || 0,
        color: c.close >= c.open ? 'rgba(34,171,148,0.5)' : 'rgba(242,54,69,0.5)',
      })));
    }
    if (avgVolRef.current) {
      avgVolRef.current.setData(calculateSMA(rows.map((r) => ({ date: r.date, close: r.volume || 0 })), 50));
    }
    if (rsRef.current) rsRef.current.setData((payload.rs_line || []).map((p) => ({ time: p.time, value: p.value })));
    if (rprRef.current) rprRef.current.setData((payload.rpr_pane || []).map((p) => ({ time: p.time, value: p.value })));
    if (markersRef.current) {
      markersRef.current.setMarkers((payload.earnings_markers || []).map((m) => ({
        time: m.time, position: 'belowBar', color: '#22ab94', shape: 'circle', text: 'E',
      })));
    }

    chart.timeScale().fitContent();
    const raf = requestAnimationFrame(() => recomputeOverlay());
    return () => cancelAnimationFrame(raf);
  }, [payload, timeframe, visibility, recomputeOverlay]);

  const bands = payload?.bands || {};
  const BAND_TOP = 6;
  const ROW_H = 14;

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <div ref={containerRef} style={{ width: '100%', height }} />

      {/* MM360 color bands (HTML overlay, time-proportional). */}
      {BAND_ROWS.map((row, i) => (
        <BandRow
          key={row.key}
          history={bands[row.key]}
          label={row.label}
          top={BAND_TOP + i * ROW_H}
          rightInset={overlay.rightInset}
        />
      ))}

      {/* Staged buy-point chips, anchored at their bar's x just below the bands. */}
      {overlay.chips.map((c, i) => {
        const cfg = CHIP[c.type] || CHIP.buy_point;
        return (
          <div key={i} style={{ position: 'absolute', top: BAND_TOP + BAND_ROWS.length * ROW_H + 4, left: c.x, transform: 'translateX(-50%)', pointerEvents: 'none', textAlign: 'center', zIndex: 3 }}>
            <div style={{ background: cfg.bg, color: '#fff', fontSize: 10, fontWeight: 800, borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>
              {cfg.text}
            </div>
            <div style={{ width: 1, height: 26, background: cfg.bg, margin: '0 auto', opacity: 0.7 }} />
          </div>
        );
      })}
    </div>
  );
}
