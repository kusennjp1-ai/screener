const valid = value => Number.isFinite(value) && value > 0;

export function tradeLevelRange({ pivot, upper, stop }) {
  const values = [pivot, upper, stop].filter(valid);
  return values.length ? { priceRange: { minValue: Math.min(...values), maxValue: Math.max(...values) } } : null;
}

class LevelAxisView {
  constructor(source, price, label, color) { Object.assign(this, { source, price, label, color }); }
  coordinate() { return this.source.series?.priceToCoordinate(this.price) ?? -10000; }
  text() { return `${this.label} ${this.price.toFixed(2)}`; }
  textColor() { return this.color; }
  backColor() { return this.source.palette.panel; }
  visible() { return valid(this.price); }
  tickVisible() { return true; }
}

class LevelPaneView {
  constructor(source) { this.source = source; }
  zOrder() { return 'bottom'; }
  renderer() {
    const source = this.source;
    return { draw(target) {
      target.useBitmapCoordinateSpace(scope => {
        const { context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize } = scope;
        const y = value => valid(value) ? source.series?.priceToCoordinate(value) : null;
        const pivot = y(source.levels.pivot), upper = y(source.levels.upper), stop = y(source.levels.stop);
        ctx.save();
        if (pivot != null && upper != null && source.levels.upper >= source.levels.pivot) {
          ctx.fillStyle = source.palette['zone-fill'];
          ctx.fillRect(0, Math.min(pivot, upper) * vr, bitmapSize.width, Math.abs(pivot - upper) * vr);
          ctx.strokeStyle = source.palette['zone-edge']; ctx.lineWidth = hr;
          for (const value of [pivot, upper]) { ctx.beginPath(); ctx.moveTo(0, value * vr); ctx.lineTo(bitmapSize.width, value * vr); ctx.stroke(); }
        }
        if (stop != null) {
          ctx.strokeStyle = source.palette.neg; ctx.lineWidth = hr; ctx.setLineDash([4 * hr, 4 * hr]);
          ctx.beginPath(); ctx.moveTo(0, stop * vr); ctx.lineTo(bitmapSize.width, stop * vr); ctx.stroke();
        }
        ctx.restore();
      });
    } };
  }
}

// Uses the same pivot / upper / stop values as the entry card. Expands only the
// visual price range, never the selected setup or any purchase condition.
export class TradeLevelsPrimitive {
  constructor(levels, palette) {
    this.levels = levels; this.palette = palette;
    this.pane = [new LevelPaneView(this)];
    this.axis = [[levels.upper, '上限', palette.zone], [levels.pivot, 'ピボット', palette.zone], [levels.stop, '損切り例', palette.neg]]
      .filter(([price]) => valid(price)).map(([price, label, color]) => new LevelAxisView(this, price, label, color));
  }
  attached({ series }) { this.series = series; }
  detached() { this.series = null; }
  updateAllViews() {}
  paneViews() { return this.pane; }
  priceAxisViews() { return this.axis; }
  autoscaleInfo() { return tradeLevelRange(this.levels); }
}
