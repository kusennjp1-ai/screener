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
      const occupiedLabels = [];
      for (const r of this._rects) {
        const left = Math.round(Math.min(r.x1, r.x2) * hr);
        const right = Math.round(Math.max(r.x1, r.x2) * hr);
        const top = Math.round(Math.min(r.y1, r.y2) * vr);
        const bottom = Math.round(Math.max(r.y1, r.y2) * vr);
        const w = Math.max(right - left, 1);
        const h = Math.max(bottom - top, 1);
        // Clean, understated base outline: faint fill + thin dashed amber edge,
        // so it reads as the base footprint rather than a heavy orange box.
        if (!r.curve && !r.arrow) {
          ctx.fillStyle = 'rgba(255, 152, 0, 0.025)';
          ctx.fillRect(left, top, w, h);
        }
        ctx.save();
        ctx.strokeStyle = r.color || 'rgba(255, 167, 38, 0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        if (!r.curve && !r.arrow) ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);
        if (r.curve && r.x3 != null && r.y3 != null) {
          ctx.lineWidth = 2 * hr; ctx.setLineDash([5 * hr, 3 * hr]);
          ctx.beginPath(); ctx.moveTo(r.x1 * hr, r.y1 * vr);
          const middle1 = (r.x1 + r.x2) / 2 * hr, middle2 = (r.x2 + r.x3) / 2 * hr;
          ctx.bezierCurveTo(middle1, r.y1 * vr, middle1, r.y2 * vr, r.x2 * hr, r.y2 * vr);
          ctx.bezierCurveTo(middle2, r.y2 * vr, middle2, r.y3 * vr, r.x3 * hr, r.y3 * vr);
          ctx.stroke();
        }
        if (r.arrow) {
          const x = r.x1 * hr, y = r.y1 * vr;
          ctx.setLineDash([]); ctx.lineWidth = 2 * hr;
          ctx.beginPath(); ctx.moveTo(x - 28 * hr, y - 32 * vr); ctx.lineTo(x, y - 3 * vr);
          ctx.lineTo(x - 9 * hr, y - 6 * vr); ctx.moveTo(x, y - 3 * vr); ctx.lineTo(x - 2 * hr, y - 12 * vr); ctx.stroke();
        }
        if (r.diagonal) {
          ctx.setLineDash([]); ctx.lineWidth = 2 * hr;
          ctx.beginPath(); ctx.moveTo(r.x1 * hr, r.y1 * vr); ctx.lineTo(r.x2 * hr, r.y2 * vr); ctx.stroke();
        }
        if (r.label) {
          ctx.font = `${11 * vr}px sans-serif`;
          const labelWidth = Math.min(ctx.measureText(r.label).width + 10 * hr, scope.bitmapSize.width);
          const labelX = Math.max(0, Math.min(left, scope.bitmapSize.width - labelWidth));
          let labelY = Math.max(58 * vr, Math.min(r.arrow ? top - 52 * vr : bottom + ((r.diagonal || r.curve) ? 4 : 22) * vr, scope.bitmapSize.height - 18 * vr));
          for (let attempt = 0; attempt < 8; attempt++) {
            if (!occupiedLabels.some(b => labelX < b.right + 4 * hr && labelX + labelWidth > b.left - 4 * hr && labelY < b.bottom && labelY + 17 * vr > b.top)) break;
            labelY += 19 * vr;
            if (labelY > scope.bitmapSize.height - 18 * vr) labelY = Math.max(58 * vr, top - (attempt + 2) * 19 * vr);
          }
          occupiedLabels.push({ left: labelX, right: labelX + labelWidth, top: labelY, bottom: labelY + 17 * vr });
          ctx.fillStyle = 'rgba(20,27,42,.94)'; ctx.fillRect(labelX, labelY, labelWidth, 17 * vr);
          ctx.fillStyle = r.color || '#ffb74d'; ctx.fillText(r.label, labelX + 5 * hr, labelY + 12 * vr, labelWidth - 10 * hr);
        }
        ctx.restore();
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
      const x3 = box.curve ? timeScale.timeToCoordinate(box.recoveryDate) : null;
      const y3 = box.curve ? series.priceToCoordinate(box.recoveryHigh) : null;
      if (Math.max(x1, x2, x3 ?? x2) < 0 || Math.min(x1, x2) > width) continue;
      this._rects.push({ x1, x2, y1, y2, x3, y3, label: box.label, color: box.color, diagonal: box.diagonal, curve: box.curve, arrow: box.arrow });
    }
  }

  zOrder() { return 'top'; }

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
