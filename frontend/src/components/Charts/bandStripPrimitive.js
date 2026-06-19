// MM360 color-band strip primitive for lightweight-charts v5.
//
// Draws three thin, stacked horizontal strips at the top of the price pane —
// Pressure / Buy Risk / TPR — where each bar is colored by that band's per-bar
// state. The strips are time-aligned to the candles via timeScale coordinates,
// so they pan/zoom with the chart.
//
// Input shape:
//   bands = { pressure_history: [..], buy_risk_history: [..], tpr_history: [..] }
//   barTimes = [time, ...] matching the candlestick series (history arrays are
//   trailing-aligned: history[k] maps to the k-th bar of the trailing window).
//
// Robust by design: missing/short histories are skipped and any coordinate that
// falls outside the viewport is dropped, so this never throws into the chart.

// state -> fill (existing palette: green / amber / red), matching the table dots.
const BAND_FILL = {
  buy: 'rgba(76, 175, 80, 0.85)', low: 'rgba(76, 175, 80, 0.85)', strong: 'rgba(76, 175, 80, 0.85)',
  neutral: 'rgba(255, 167, 38, 0.85)', medium: 'rgba(255, 167, 38, 0.85)', transition: 'rgba(255, 167, 38, 0.85)',
  sell: 'rgba(239, 83, 80, 0.85)', high: 'rgba(239, 83, 80, 0.85)', weak: 'rgba(239, 83, 80, 0.85)',
};

const DEFAULT_STRIP_TOP = 2;   // px from the top of the pane (overridable per instance)
const STRIP_H = 6;     // px per strip
const STRIP_GAP = 1;   // px between strips
const STRIP_ORDER = ['pressure_history', 'buy_risk_history', 'tpr_history'];

// Total vertical span of the three strips — used by the buy-point primitive to
// stack its chips directly beneath the band row.
export const BANDS_BLOCK_HEIGHT = STRIP_ORDER.length * (STRIP_H + STRIP_GAP);

class BandStripRenderer {
  constructor(rects) {
    this._rects = rects;
  }

  draw(target) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      for (const r of this._rects) {
        const left = Math.round(Math.min(r.x1, r.x2) * hr);
        const right = Math.round(Math.max(r.x1, r.x2) * hr);
        const top = Math.round(r.y1 * vr);
        const bottom = Math.round(r.y2 * vr);
        ctx.fillStyle = r.color;
        ctx.fillRect(left, top, Math.max(right - left, 1), Math.max(bottom - top, 1));
      }
    });
  }
}

class BandStripPaneView {
  constructor(source) {
    this._source = source;
    this._rects = [];
  }

  update() {
    const { _chart: chart, _bands: bands, _barTimes: barTimes, _topOffset: topOffset } = this._source;
    const STRIP_TOP = Number.isFinite(topOffset) ? topOffset : DEFAULT_STRIP_TOP;
    this._rects = [];
    if (!chart || !bands || !Array.isArray(barTimes) || barTimes.length < 2) return;
    const timeScale = chart.timeScale();

    // Dark backdrop behind the strips so the band reads as its own distinct row
    // across the top of the pane instead of blending into the candles. Span it
    // only across the range the strips actually cover (a shorter history must not
    // leave an uncolored black gap to its left).
    const totalH = STRIP_ORDER.length * (STRIP_H + STRIP_GAP);
    let minStart = barTimes.length;
    for (const key of STRIP_ORDER) {
      const h = bands[key];
      if (Array.isArray(h) && h.length > 0) {
        minStart = Math.min(minStart, Math.max(0, barTimes.length - h.length));
      }
    }
    const backdropLeftRaw =
      minStart < barTimes.length ? timeScale.timeToCoordinate(barTimes[minStart]) : null;
    const backdropLeft = backdropLeftRaw != null ? Math.max(0, backdropLeftRaw) : 0;
    this._rects.push({
      x1: backdropLeft,
      x2: timeScale.width(),
      y1: STRIP_TOP - 1,
      y2: STRIP_TOP + totalH + 1,
      color: 'rgba(10, 12, 16, 0.62)',
    });

    // Approximate one bar's pixel width from the visible spacing, used to extend
    // the final bar of each strip (which has no "next" bar to bound it).
    const firstX = timeScale.timeToCoordinate(barTimes[0]);
    const lastX = timeScale.timeToCoordinate(barTimes[barTimes.length - 1]);
    const barWidth =
      firstX != null && lastX != null && barTimes.length > 1
        ? Math.max((lastX - firstX) / (barTimes.length - 1), 1)
        : 4;

    STRIP_ORDER.forEach((key, row) => {
      const hist = bands[key];
      if (!Array.isArray(hist) || hist.length === 0) return;
      const start = Math.max(0, barTimes.length - hist.length);
      const times = barTimes.slice(start);
      const y1 = STRIP_TOP + row * (STRIP_H + STRIP_GAP);
      const y2 = y1 + STRIP_H;
      for (let k = 0; k < times.length && k < hist.length; k += 1) {
        const x = timeScale.timeToCoordinate(times[k]);
        if (x == null) continue;
        const xNextRaw = k + 1 < times.length ? timeScale.timeToCoordinate(times[k + 1]) : null;
        const x2 = xNextRaw != null ? xNextRaw : x + barWidth;
        const color = BAND_FILL[hist[k]];
        if (!color) continue;
        this._rects.push({ x1: x, x2, y1, y2, color });
      }
    });
  }

  renderer() {
    return new BandStripRenderer(this._rects);
  }
}

export class BandStripPrimitive {
  constructor(bands = null, barTimes = [], topOffset = DEFAULT_STRIP_TOP) {
    this._bands = bands;
    this._barTimes = barTimes;
    this._topOffset = topOffset;
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._paneViews = [new BandStripPaneView(this)];
  }

  attached(params) {
    this._chart = params.chart;
    this._series = params.series;
    this._requestUpdate = params.requestUpdate;
    this.updateAllViews();
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  updateAllViews() {
    this._paneViews.forEach((view) => view.update());
  }

  paneViews() {
    return this._paneViews;
  }

  setData(bands, barTimes, topOffset) {
    this._bands = bands || null;
    this._barTimes = Array.isArray(barTimes) ? barTimes : [];
    if (Number.isFinite(topOffset)) this._topOffset = topOffset;
    this.updateAllViews();
    if (this._requestUpdate) this._requestUpdate();
  }
}
