// Buy-point annotation primitive for lightweight-charts v5.
//
// MM360-style: instead of cluttered text markers stacked on the candles (which
// overlap and hide price), each buy point is drawn as a compact label chip in a
// row just below the top color-band strips, with a thin vertical connector line
// running down to the breakout/pivot price on its bar. This ties every
// annotation to the upper band row (per the reference screenshot) and keeps the
// candle area clean.
//
// Input shape:
//   buyPoints = [{ time, type, price }]  (type in BUY_POINT_STYLE)
//   barTimes  = [time, ...]              (the candlestick series time axis)
//
// Robust by design: points whose time falls outside the viewport are dropped,
// and anything unexpected is skipped — this never throws into the chart.

const BUY_POINT_STYLE = {
  buy_point: { color: '#2196f3', label: 'Buy Pt' },
  sepa_buy_point: { color: '#4CF64D', label: 'SEPA' },
  buy_ready: { color: '#FFD54F', label: 'Ready' },
  buy_alert: { color: '#FFB300', label: 'Alert' },
};

// Layout (CSS px). The band strips occupy ~2..23px at the top of the pane
// (see bandStripPrimitive); labels start just below that. Two rows max, so
// clustered breakouts stagger instead of overprinting.
const ROW0_Y = 26;
const ROW_H = 13;
const ROW_GAP = 2;
const LABEL_PAD_X = 4;
const CHAR_W = 5.6; // approx px/char at the 10px label font
const FONT_PX = 10;
const MAX_ROWS = 2;

class BuyPointRenderer {
  constructor(ops) {
    this._ops = ops;
  }

  draw(target) {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;

      // Connector lines first, so the label chips sit on top of them.
      for (const op of this._ops) {
        if (op.kind !== 'line') continue;
        ctx.save();
        ctx.strokeStyle = op.color;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = Math.max(hr, 1);
        ctx.setLineDash([3 * hr, 3 * hr]);
        ctx.beginPath();
        ctx.moveTo(op.x * hr, op.y1 * vr);
        ctx.lineTo(op.x * hr, op.y2 * vr);
        ctx.stroke();
        ctx.restore();
      }

      for (const op of this._ops) {
        if (op.kind !== 'chip') continue;
        const left = op.left * hr;
        const top = op.top * vr;
        const w = op.width * hr;
        const h = ROW_H * vr;
        ctx.save();
        ctx.fillStyle = op.color;
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        const r = 2 * Math.min(hr, vr);
        // Rounded rect (manual, for older canvas without roundRect).
        ctx.moveTo(left + r, top);
        ctx.arcTo(left + w, top, left + w, top + h, r);
        ctx.arcTo(left + w, top + h, left, top + h, r);
        ctx.arcTo(left, top + h, left, top, r);
        ctx.arcTo(left, top, left + w, top, r);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#0b0e12';
        ctx.font = `600 ${FONT_PX * vr}px -apple-system, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(op.text, left + w / 2, top + h / 2 + 0.5 * vr);
        ctx.restore();
      }
    });
  }
}

class BuyPointPaneView {
  constructor(source) {
    this._source = source;
    this._ops = [];
  }

  update() {
    const { _chart: chart, _series: series, _points: points, _barTimes: barTimes } = this._source;
    this._ops = [];
    if (!chart || !series || !Array.isArray(points) || points.length === 0) return;
    if (!Array.isArray(barTimes) || barTimes.length === 0) return;
    const timeScale = chart.timeScale();
    const width = timeScale.width();

    const placed = [];
    for (const p of points) {
      if (!p || !BUY_POINT_STYLE[p.type] || p.time == null) continue;
      const x = timeScale.timeToCoordinate(p.time);
      if (x == null || x < 0 || x > width) continue;
      const style = BUY_POINT_STYLE[p.type];
      const w = style.label.length * CHAR_W + 2 * LABEL_PAD_X;
      placed.push({ x, w, style, price: p.price });
    }
    if (placed.length === 0) return;

    // Greedy row assignment to avoid horizontal overlap: chips are centered on
    // their bar; pick the lowest row whose last chip clears this one.
    placed.sort((a, b) => a.x - b.x);
    const rowRight = new Array(MAX_ROWS).fill(-Infinity);
    for (const c of placed) {
      const left = c.x - c.w / 2;
      let row = 0;
      while (row < MAX_ROWS - 1 && left < rowRight[row] + 2) row += 1;
      rowRight[row] = left + c.w;
      const top = ROW0_Y + row * (ROW_H + ROW_GAP);

      const priceY = c.price != null ? series.priceToCoordinate(c.price) : null;
      const chipBottom = top + ROW_H;
      if (priceY != null && priceY > chipBottom + 2) {
        this._ops.push({ kind: 'line', x: c.x, y1: chipBottom, y2: priceY, color: c.style.color });
      }
      this._ops.push({
        kind: 'chip',
        left,
        top,
        width: c.w,
        text: c.style.label,
        color: c.style.color,
      });
    }
  }

  renderer() {
    return new BuyPointRenderer(this._ops);
  }
}

export class BuyPointPrimitive {
  constructor(points = [], barTimes = []) {
    this._points = points;
    this._barTimes = barTimes;
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._paneViews = [new BuyPointPaneView(this)];
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

  setData(points, barTimes) {
    this._points = Array.isArray(points) ? points : [];
    this._barTimes = Array.isArray(barTimes) ? barTimes : [];
    this.updateAllViews();
    if (this._requestUpdate) this._requestUpdate();
  }
}
