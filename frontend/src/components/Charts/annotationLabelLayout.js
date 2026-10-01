const intersects = (a, b, gap = 4) => a.x < b.x + b.width + gap && a.x + a.width > b.x - gap && a.y < b.y + b.height + gap && a.y + a.height > b.y - gap;

// Labels are allowed only above the highs under their horizontal span. If the
// visible pane has no collision-free space, the caption remains in the textual
// annotation list instead of being drawn over a candle or outside the pane.
export function placeAnnotationLabels(shapes, candles, width, height, measure) {
  const placed = [];
  for (const shape of shapes) {
    if (!shape.label) continue;
    const anchorX = shape.curve ? shape.x2 : (shape.x1 + shape.x2) / 2;
    if (anchorX < 0 || anchorX > width) continue;
    const labelWidth = Math.min(measure(shape.label) + 10, width - 4);
    if (labelWidth <= 10) continue;
    for (const shift of [0, -labelWidth / 2, labelWidth / 2]) {
      const x = Math.max(2, Math.min(anchorX - labelWidth / 2 + shift, width - labelWidth - 2));
      const underLabel = candles.filter(candle => candle.x + candle.width >= x && candle.x <= x + labelWidth);
      const ceiling = Math.min(shape.y1, shape.y2, shape.y3 ?? Infinity, ...underLabel.map(candle => candle.y));
      let candidate = { x, y: ceiling - 24, width: labelWidth, height: 18 };
      while (candidate.y >= 2 && placed.some(label => intersects(candidate, label))) candidate = { ...candidate, y: candidate.y - 22 };
      if (candidate.y < 2 || candidate.y + candidate.height > height - 2 || candles.some(candle => intersects(candidate, candle))) continue;
      placed.push({ ...candidate, shape, anchorX });
      break;
    }
  }
  return placed;
}
