// Retrospective visual aids. Thresholds below are application heuristics, not
// book certification, real-time signals, or inputs to the screening engine.
const finite = Number.isFinite;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
export function buildBookAnnotations(bars) {
  const empty = reason => ({ boxes: [], legs: [], pivot: null, summary: reason, candidate: false });
  if (!Array.isArray(bars) || bars.length < 60) return empty('自動注記：60本以上の日足が必要です。');
  if (bars.some((b, i) => !b || typeof b.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !finite(Date.parse(b.date)) || new Date(b.date).toISOString().slice(0, 10) !== b.date || [0, 6].includes(new Date(b.date).getUTCDay()) ||
    (i && b.date <= bars[i - 1].date) || ![b.open, b.high, b.low, b.close].every(n => finite(n) && n > 0) ||
    !finite(b.volume) || b.volume < 0 || b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close)))
    return empty('自動注記：日足の欠損・不整合により判定できません。');
  const start = Math.max(0, bars.length - 126), end = bars.length - 1;
  // Anchor at the largest high with at least 15 later sessions to observe a base.
  let anchor = start;
  for (let i = start; i <= end - 15; i++) if (bars[i].high >= bars[anchor].high) anchor = i;
  const base = bars.slice(anchor), high = bars[anchor].high, low = Math.min(...base.map(b => b.low));
  const depth = (high - low) / high * 100;
  if (depth < 5 || depth > 50 || base.some(b => b.high > high * 1.05) || (bars[end].close - low) / (high - low) < .33)
    return empty('自動注記：現在の探索条件でベース候補を確認できません。');
  const boxes = [{ start: bars[anchor].date, end: bars[end].date, high, low,
    label: `ベース候補 ${base.length}日 / 深さ${depth.toFixed(1)}%`, color: '#b39ddb' }];
  // Confirm local extrema only after two subsequent bars. Ignore same-bar high/low
  // ordering because OHLC cannot tell which occurred first.
  const pivots = [{ index: anchor, type: 'high', value: high }];
  for (let i = anchor + 2; i <= end - 2; i++) {
    const peers = [bars[i - 2], bars[i - 1], bars[i + 1], bars[i + 2]];
    const isHigh = peers.every(b => bars[i].high > b.high), isLow = peers.every(b => bars[i].low < b.low);
    if (isHigh === isLow) continue;
    const point = { index: i, type: isHigh ? 'high' : 'low', value: isHigh ? bars[i].high : bars[i].low };
    const previous = pivots.at(-1);
    if (previous.type === point.type) {
      if (point.type === 'high' ? point.value > previous.value : point.value < previous.value) pivots[pivots.length - 1] = point;
    } else pivots.push(point);
  }
  const allLegs = [];
  for (let i = 0; i < pivots.length - 1; i++) {
    const a = pivots[i], b = pivots[i + 1];
    if (a.type !== 'high' || b.type !== 'low' || b.index - a.index < 2) continue;
    const depthPct = (a.value - b.value) / a.value * 100;
    if (depthPct < 2) continue;
    allLegs.push({ start: bars[a.index].date, end: bars[b.index].date, high: a.value, low: b.value, depthPct,
      index: b.index, volume: mean(bars.slice(a.index, b.index + 1).map(d => d.volume)) });
  }
  // Require the latest consecutive pullbacks to shrink; never skip a widening leg.
  const legs = allLegs.slice(-6);
  while (legs.length > 1 && legs.some((leg, i) => i && leg.depthPct >= legs[i - 1].depthPct)) legs.shift();
  const last = legs.at(-1);
  const candidate = legs.length >= 2 && last.depthPct <= 10 && end - last.index <= 20 &&
    bars[end].close >= last.low && bars[end].close <= last.high * 1.05 &&
    bars.slice(last.index + 1).every(b => b.low >= last.low);
  const volumeContracts = candidate && legs.every((leg, i) => !i || (leg.volume > 0 && leg.volume < legs[i - 1].volume));
  if (candidate) legs.forEach((leg, i) => boxes.push({ ...leg, color: '#4dd0e1',
    label: `C${i + 1} −${leg.depthPct.toFixed(1)}%`, diagonal: true }));
  return { boxes, legs: candidate ? legs : [], pivot: candidate ? last.high : null, candidate,
    summary: candidate ? `VCP候補：${legs.map((leg, i) => `C${i + 1} ${leg.depthPct.toFixed(1)}%`).join(' → ')}。区間平均出来高：${volumeContracts ? '順に減少' : '順次減少を確認できず'}。成立・買い判断は別確認。` : 'ベース候補のみ。VCPの収縮条件は未確認。' };
}
