// VCP contraction-box primitive for lightweight-charts v5.
//
// Draws shaded rectangles over the candlestick series marking recent VCP
// consolidation bases (the "footprint" of the base). Each box is
// { start, end, high, low } where start/end are bar time values (date strings
// matching the candle series) and high/low are prices.
//
// Robust by design: any edge that falls outside the visible window is clamped to
// the chart bounds, and a fully-off-screen box is skipped. Attaching/using the
// primitive must never throw into the chart, so callers wrap usage in try/catch.

class VcpBoxRenderer {
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
        const top = Math.round(Math.min(r.y1, r.y2) * vr);
        const bottom = Math.round(Math.max(r.y1, r.y2) * vr);
        const w = Math.max(right - left, 1);
        const h = Math.max(bottom - top, 1);
        ctx.fillStyle = 'rgba(255, 152, 0, 0.10)';
        ctx.fillRect(left, top, w, h);
        ctx.strokeStyle = 'rgba(255, 152, 0, 0.65)';
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
      }
    });
  }
}

class VcpBoxPaneView {
  constructor(source) {
    this._source = source;
    this._rects = [];
  }

  update() {
    const { _chart: chart, _series: series, _boxes: boxes } = this._source;
    this._rects = [];
    if (!chart || !series || !Array.isArray(boxes) || boxes.length === 0) return;
    const timeScale = chart.timeScale();
    const width = timeScale.width();
    for (const box of boxes) {
      const y1 = series.priceToCoordinate(box.high);
      const y2 = series.priceToCoordinate(box.low);
      if (y1 == null || y2 == null) continue;
      let x1 = timeScale.timeToCoordinate(box.start);
      let x2 = timeScale.timeToCoordinate(box.end);
      // Clamp edges that fall outside the visible window so a box anchored
      // before/after the viewport still renders across what's visible.
      if (x1 == null && x2 == null) continue;
      if (x1 == null) x1 = 0;
      if (x2 == null) x2 = width;
      this._rects.push({ x1, x2, y1, y2 });
    }
  }

  renderer() {
    return new VcpBoxRenderer(this._rects);
  }
}

export class VcpBoxPrimitive {
  constructor(boxes = []) {
    this._boxes = boxes;
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._paneViews = [new VcpBoxPaneView(this)];
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

  setBoxes(boxes) {
    this._boxes = Array.isArray(boxes) ? boxes : [];
    this.updateAllViews();
    if (this._requestUpdate) this._requestUpdate();
  }
}
