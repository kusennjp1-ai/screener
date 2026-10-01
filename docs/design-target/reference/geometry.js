/*
 * LEADER RESEARCH design target: reference geometry (framework-agnostic).
 *
 * Extracted from the design-target prototype (docs/design-target/README.md).
 * Pure functions: they take snapshot data and return SVG path strings,
 * percentage positions for HTML labels, and style strings. Port the math
 * and the constants into React components; do not copy the style-string
 * approach. Colors are always CSS custom properties from tokens.css.
 *
 * Bar tuple layout used by chart()/mini():
 *   [MM-DD, open, high, low, close, volume, sma50, sma150, sma200, rs, vol50]
 */
var STATE = {
  zone: { label: '買いゾーン内', short: 'ゾーン内', tone: 'var(--zone)', glyph: '●' },
  wait: { label: 'ピボット待ち', short: '待ち', tone: 'var(--wait)', glyph: '◔' },
  ext: { label: '買いゾーン超過', short: '超過', tone: 'var(--ext)', glyph: '▲' },
  low: { label: '低変動・監視のみ', short: '低変動', tone: 'var(--neutral)', glyph: '≈' },
  acq: { label: '買収合意・対象外', short: '対象外', tone: 'var(--neutral)', glyph: '⊘' },
  na: { label: '判定不可', short: '判定不可', tone: 'var(--neutral)', glyph: '?' }
};
var METHOD_ORDER = ['minervini', 'minervini2', 'oneil', 'ibd'];
var METHOD_SHORT = { minervini: 'ミネルヴィニ', minervini2: '基本と原則', oneil: 'オニール', ibd: 'IBD型' };
var WEEK = ['日', '月', '火', '水', '木', '金', '土'];
function ok(v) { return typeof v === 'number' && isFinite(v); }
function money(v) { return ok(v) ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'; }
function num(v, d) { return ok(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'; }
function signed(v, d) { if (!ok(v)) return '—'; var s = Math.abs(v).toFixed(d == null ? 1 : d); return (v > 0.0000001 ? '+' : v < -0.0000001 ? '−' : '±') + s + '%'; }
function times(v) { return ok(v) ? v.toFixed(2) + '×' : '—'; }
function stateOf(k) { return STATE[k] || STATE.na; }
function pc(v, total) { return +(v / total * 100).toFixed(3) + '%'; }
function jpDate(iso) { var p = iso.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); return +p[0] + '年' + (+p[1]) + '月' + (+p[2]) + '日（' + WEEK[d.getUTCDay()] + '）'; }
function jst(isoZ) { var t = new Date(Date.parse(isoZ) + 9 * 3600000); return (t.getUTCMonth() + 1) + '/' + t.getUTCDate() + ' ' + String(t.getUTCHours()).padStart(2, '0') + ':' + String(t.getUTCMinutes()).padStart(2, '0') + ' JST'; }
function chipStyle(tone, big) { return 'display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-size: ' + (big ? 13 : 12) + 'px; font-weight: 700; padding: ' + (big ? '5px 12px' : '3px 10px') + '; border-radius: 999px; color: ' + tone + '; background: color-mix(in srgb, ' + tone + ' 9%, var(--surface)); border: 1px solid color-mix(in srgb, ' + tone + ' 40%, var(--surface))'; }

/* Zone meter: price position against pivot on a −10%…+10% track; buy zone 0…+5%. */
function meter(d, st, w) {
  w = w || 112; var h = 14, lo = -10, hi = 10;
  var sx = function (v) { return +((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * (w - 8) + 4).toFixed(1); };
  var has = ok(d);
  return {
    w: w, h: h, vb: '0 0 ' + w + ' ' + h,
    zx: sx(0), zw: +(sx(5) - sx(0)).toFixed(1), px: sx(0), pivot: 'M' + sx(0) + ' 1.5V12.5',
    mx: has ? sx(d) : sx(0), has: has, clipped: has && (d < lo || d > hi),
    tone: stateOf(st).tone, track: 'M4 7H' + (w - 4)
  };
}

/* Position gauge for the entry card: pivot, buy limit, stop example and price on one scale. */
function gauge(det) {
  var lo = -10, hi = 10;
  var x = function (v) { return (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * 100; };
  if (!ok(det.pivot)) return { has: false };
  var stopD = (det.stop / det.pivot - 1) * 100, d = det.d;
  var marks = [
    { key: 'stop', label: '損切り例', value: money(det.stop), x: x(stopD), tone: 'var(--neg)', below: true },
    { key: 'pivot', label: 'ピボット', value: money(det.pivot), x: x(0), tone: 'var(--text-2)', below: false },
    { key: 'upper', label: '買い上限', value: money(det.upper), x: x(5), tone: 'var(--zone)', below: true }
  ];
  return {
    has: true, zoneLeft: x(0).toFixed(2) + '%', zoneWidth: (x(5) - x(0)).toFixed(2) + '%',
    priceLeft: x(d).toFixed(2) + '%', priceText: money(det.p), priceTone: stateOf(det.st).tone, clipped: d < lo || d > hi,
    marks: marks.map(function (m) { m.left = m.x.toFixed(2) + '%'; return m; }),
    scale: [-10, -5, 0, 5, 10].map(function (v) { return { left: x(v).toFixed(2) + '%', label: (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '%' }; })
  };
}

function niceStep(range, count) {
  var raw = range / count, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

/* Candles, moving averages, buy-zone band, RS and volume panes as SVG paths plus HTML label positions. */
function chart(det, sessions, W, H, compact) {
  var bars = det.bars.slice(-sessions), n = bars.length;
  var padL = 4, axisW = compact ? 58 : 112, plotW = W - padL - axisW;
  var gap = compact ? 8 : 12;
  var rsH = compact ? 34 : 54, vH = compact ? 44 : 66, pH = H - rsH - vH - gap * 2 - 20;
  var step = plotW / n, bw = Math.max(1.2, Math.min(compact ? 6 : 9, step * 0.64));
  var lo = Infinity, hi = -Infinity;
  bars.forEach(function (b) { lo = Math.min(lo, b[3]); hi = Math.max(hi, b[2]); });
  [det.pivot, det.upper, det.stop].forEach(function (v) { if (ok(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  var pad = (hi - lo) * 0.07; lo -= pad; hi += pad;
  var y = function (v) { return +(pH - (v - lo) / (hi - lo) * pH).toFixed(1); };
  var x = function (i) { return +(padL + step * i + step / 2).toFixed(1); };
  var upW = '', dnW = '', upB = '', dnB = '';
  bars.forEach(function (b, i) {
    var o = b[1], h = b[2], l = b[3], c = b[4], X = x(i);
    var wick = 'M' + X + ' ' + y(h) + 'V' + y(l);
    var top = y(Math.max(o, c)), bot = y(Math.min(o, c)), hh = Math.max(1, bot - top);
    var body = 'M' + (X - bw / 2).toFixed(1) + ' ' + top + 'h' + bw.toFixed(1) + 'v' + hh.toFixed(1) + 'h' + (-bw).toFixed(1) + 'Z';
    if (c >= o) { upW += wick; upB += body; } else { dnW += wick; dnB += body; }
  });
  var line = function (idx, fy) {
    var d = '', pen = false;
    bars.forEach(function (b, i) { var v = b[idx]; if (!ok(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i) + ' ' + fy(v); pen = true; });
    return d;
  };
  var plotR = +(padL + plotW).toFixed(1), axisX = W - axisW;
  var ticks = [], st = niceStep(hi - lo, compact ? 4 : 5);
  for (var t = Math.ceil(lo / st) * st; t <= hi; t += st) {
    var ty = y(t);
    if (ty > 10 && ty < pH - 6) ticks.push({ path: 'M0 ' + ty + 'H' + plotR, label: num(t, st < 1 ? 2 : st < 10 ? 1 : 0), top: pc(ty, H), left: pc(axisX + 10, W) });
  }
  /* RS pane */
  var rsTop = pH + gap, rsv = bars.map(function (b) { return b[9]; }).filter(ok);
  var rsLo = Math.min.apply(null, rsv), rsHi = Math.max.apply(null, rsv), rsPad = (rsHi - rsLo) * 0.14 || 0.01;
  var ry = function (v) { return +(rsTop + rsH - (v - rsLo + rsPad) / (rsHi - rsLo + rsPad * 2) * rsH).toFixed(1); };
  var rsPath = rsv.length ? line(9, ry) : '', lastRs = rsv[rsv.length - 1];
  var rsNewHigh = rsv.length > 0 && lastRs >= rsHi - 1e-9;
  /* Volume pane */
  var vTop = rsTop + rsH + gap, vmax = 0;
  bars.forEach(function (b) { vmax = Math.max(vmax, b[5]); });
  var vy = function (v) { return +(vTop + vH - v / vmax * vH).toFixed(1); };
  var vol = '', volHi = '', vbw = Math.max(1, step * 0.7), hiCount = 0;
  bars.forEach(function (b, i) {
    var X = x(i), top = vy(b[5]), r = 'M' + (X - vbw / 2).toFixed(1) + ' ' + top + 'h' + vbw.toFixed(1) + 'V' + (vTop + vH) + 'h' + (-vbw).toFixed(1) + 'Z';
    if (ok(b[10]) && b[5] >= b[10] * 1.4) { volHi += r; hiCount++; } else vol += r;
  });
  /* Month labels */
  var months = [], prev = null;
  bars.forEach(function (b, i) { var m = +b[0].slice(0, 2); if (m !== prev) { if (prev !== null) months.push({ left: pc(x(i), W), label: m + '月' }); prev = m; } });
  var last = bars[n - 1];
  /* Right-axis tags with collision avoidance */
  var tags = [];
  if (ok(det.upper)) tags.push({ v: det.upper, label: '買い上限', tone: 'var(--zone)', solid: true });
  tags.push({ v: last[4], label: '終値', tone: 'var(--text)', solid: true });
  if (ok(det.pivot)) tags.push({ v: det.pivot, label: 'ピボット', tone: 'var(--zone)', solid: false });
  if (ok(det.stop)) tags.push({ v: det.stop, label: '損切り例', tone: 'var(--neg)', solid: false });
  tags.forEach(function (t) { t.y = y(t.v); });
  tags.sort(function (a, b) { return a.y - b.y; });
  var th = compact ? 16 : 20;
  for (var k = 1; k < tags.length; k++) if (tags[k].y - tags[k - 1].y < th) tags[k].y = tags[k - 1].y + th;
  tags.forEach(function (t) {
    t.top = pc(t.y, H); t.left = pc(axisX + 4, W); t.width = pc(axisW - 6, W);
    t.text = num(t.v, 2); t.name = compact ? '' : t.label;
    t.style = 'position: absolute; top: ' + t.top + '; left: ' + t.left + '; width: ' + t.width + '; transform: translateY(-50%); display: flex; justify-content: space-between; align-items: center; gap: 4px; padding: 2px 6px; border-radius: 4px; font-size: 11px; line-height: 14px; font-weight: 600; white-space: nowrap; ' +
      (t.solid ? 'background: ' + t.tone + '; color: var(--ground)' : 'background: var(--surface); color: ' + t.tone + '; box-shadow: inset 0 0 0 1px ' + t.tone);
  });
  ticks = ticks.filter(function (tk) { var ty = parseFloat(tk.top) / 100 * H; return tags.every(function (t) { return Math.abs(t.y - ty) > th * 0.9; }); });
  var zone = ok(det.pivot) && ok(det.upper) ? { y: y(det.upper), h: +(y(det.pivot) - y(det.upper)).toFixed(1), py: y(det.pivot), uy: y(det.upper) } : null;
  if (zone) { zone.edges = 'M0 ' + zone.uy + 'H' + plotR + 'M0 ' + zone.py + 'H' + plotR; zone.labelY = zone.uy - 7 < 14 ? zone.py + 15 : zone.uy - 7; }
  var maDiff = function (idx) { return ok(last[idx]) ? signed((last[4] / last[idx] - 1) * 100, 1) : '—'; };
  var rsDot = null;
  if (rsNewHigh) { var mm = rsPath.match(/([\d.]+) ([\d.]+)$/); if (mm) rsDot = { x: +mm[1], y: +mm[2] }; }
  return {
    vb: '0 0 ' + W + ' ' + H, W: W, H: H, plotW: plotW, plotR: plotR, padL: padL, pH: pH,
    upW: upW, dnW: dnW, upB: upB, dnB: dnB,
    sma50: line(6, y), sma150: line(7, y), sma200: line(8, y),
    ticks: ticks, months: months, monthTop: pc(vTop + vH + 6, H),
    zone: zone, hasZone: !!zone, hasStop: ok(det.stop), stopPath: ok(det.stop) ? 'M0 ' + y(det.stop) + 'H' + plotR : '',
    rsPath: rsPath, rsLabelY: rsTop + 14, rsNewHigh: !!rsDot, rsDot: rsDot || { x: 0, y: 0 },
    volLabelY: vTop + 14, vol: vol, volHi: volHi, vol50: line(10, vy), hiCount: hiCount,
    tags: tags, axisX: axisX,
    seps: 'M0 ' + (rsTop - gap / 2) + 'H' + W + 'M0 ' + (vTop - gap / 2) + 'H' + W + 'M' + axisX + ' 0V' + (vTop + vH),
    from: bars[0][0], to: last[0], last: last,
    ma: [
      { label: 'SMA50', value: num(last[6], 2), diff: maDiff(6) },
      { label: 'SMA150', value: num(last[7], 2), diff: maDiff(7) },
      { label: 'SMA200', value: num(last[8], 2), diff: maDiff(8) }
    ]
  };
}

/* Setup radar: pivot distance (x, piecewise: −15…+10 wide, +10…+25 compressed) vs RS (y). */
function radar(points, W, H, selected, hover, pickable) {
  var L = 36, R = 14, T = 16, B = 26, pw = W - L - R, ph = H - T - B, ylo = 70, yhi = 100;
  var brk = 10, split = 0.84;
  var sx = function (v) {
    v = Math.max(-15, Math.min(25, v));
    var f = v <= brk ? (v + 15) / (brk + 15) * split : split + (v - brk) / (25 - brk) * (1 - split);
    return +(L + f * pw).toFixed(1);
  };
  var sy = function (v) { return +(T + ph - (Math.max(ylo, Math.min(yhi, v)) - ylo) / (yhi - ylo) * ph).toFixed(1); };
  var order = { ext: 0, wait: 1, zone: 2 };
  var pts = points.slice().sort(function (a, b) { return (order[a.st] || 0) - (order[b.st] || 0); }).map(function (p, i) {
    var can = !!pickable[p.s];
    return {
      s: p.s, d: p.d, rs: p.rs, v: p.v, st: p.st, cx: sx(p.d), cy: sy(p.rs), r: +(2.4 + Math.min(p.v || 0, 3) * 1.4).toFixed(1),
      fill: stateOf(p.st).tone, opacity: p.st === 'zone' ? 0.95 : 0.6, can: can,
      delay: Math.min(i, 200) * 4
    };
  });
  var find = function (s) { return pts.filter(function (p) { return p.s === s; })[0] || null; };
  var sel = find(selected), hov = hover ? find(hover) : null;
  var label = function (p, extra) {
    if (!p) return null;
    var right = p.cx > L + pw * 0.72;
    return {
      s: p.s, sub: stateOf(p.st).short + ' · ' + signed(p.d, 1) + ' · RS ' + p.rs + (extra || ''),
      style: 'position: absolute; top: ' + pc(p.cy, H) + '; left: ' + pc(p.cx, W) + '; transform: translate(' + (right ? 'calc(-100% - 14px)' : '14px') + ', -50%); pointer-events: none; white-space: nowrap',
      ring: { cx: p.cx, cy: p.cy, r: p.r + 5 }, cross: 'M' + p.cx + ' ' + T + 'V' + (T + ph) + 'M' + L + ' ' + p.cy + 'H' + (L + pw)
    };
  };
  var xt = [-15, -10, -5, 0, 5, 10, 25].map(function (v) { return { path: 'M' + sx(v) + ' ' + T + 'V' + (T + ph), left: pc(sx(v), W), label: (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '%' }; });
  var yt = [70, 80, 90, 100].map(function (v) { return { path: 'M' + L + ' ' + sy(v) + 'H' + (L + pw), top: pc(sy(v), H), label: String(v) }; });
  return {
    vb: '0 0 ' + W + ' ' + H, L: L, T: T, pw: pw, ph: ph, right: L + pw, bottom: T + ph,
    zx: sx(0), zw: +(sx(5) - sx(0)).toFixed(1), zcx: +(sx(0) + (sx(5) - sx(0)) / 2).toFixed(1),
    zoneEdges: 'M' + sx(0) + ' ' + T + 'V' + (T + ph) + 'M' + sx(5) + ' ' + T + 'V' + (T + ph),
    brkX: sx(brk), brkPath: 'M' + (sx(brk) - 3) + ' ' + (T + ph + 4) + 'l3 -8M' + (sx(brk) + 1) + ' ' + (T + ph + 4) + 'l3 -8',
    xLabelTop: pc(T + ph + 5, H), yLabelLeft: pc(L - 6, W),
    pts: pts, xt: xt, yt: yt, sel: label(sel), hasSel: !!sel, hov: hov && (!sel || hov.s !== sel.s) ? label(hov, hov.can ? '' : ' · 詳細なし') : null
  };
}

function readinessView(ready) {
  var passed = 0, list = (ready || []).map(function (r) {
    var s = r.state === true ? 'pass' : r.state === false ? 'fail' : 'unknown';
    if (s === 'pass') passed++;
    return {
      label: r.label, detail: r.detail, s: s,
      glyph: s === 'pass' ? '✓' : s === 'fail' ? '×' : '?',
      tone: s === 'pass' ? 'var(--zone)' : s === 'fail' ? 'var(--neg)' : 'var(--text-2)',
      seg: s === 'pass' ? 'var(--zone)' : s === 'fail' ? 'var(--neg)' : 'var(--line-2)',
      word: s === 'pass' ? '通過' : s === 'fail' ? '未達' : '未確認'
    };
  });
  var missing = list.filter(function (r) { return r.s !== 'pass'; });
  return { list: list, passed: passed, total: list.length, missing: missing };
}

/* ---- Compare page: small-multiple chart ---- */
function mini(det, sessions, W, H) {
  var bars = det.bars.slice(-sessions), n = bars.length, vH = 26, gap = 6, pH = H - vH - gap, plotR = W;
  var step = W / n, bw = Math.max(1.2, Math.min(6, step * 0.64));
  var lo = Infinity, hi = -Infinity;
  bars.forEach(function (b) { lo = Math.min(lo, b[3]); hi = Math.max(hi, b[2]); });
  [det.pivot, det.upper, det.stop].forEach(function (v) { if (ok(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  var pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  var y = function (v) { return +(pH - (v - lo) / (hi - lo) * pH).toFixed(1); };
  var x = function (i) { return +(step * i + step / 2).toFixed(1); };
  var upW = '', dnW = '', upB = '', dnB = '', vol = '', volHi = '', vmax = 0;
  bars.forEach(function (b) { vmax = Math.max(vmax, b[5]); });
  bars.forEach(function (b, i) {
    var X = x(i), top = y(Math.max(b[1], b[4])), bot = y(Math.min(b[1], b[4]));
    var wick = 'M' + X + ' ' + y(b[2]) + 'V' + y(b[3]);
    var body = 'M' + (X - bw / 2).toFixed(1) + ' ' + top + 'h' + bw.toFixed(1) + 'v' + Math.max(1, bot - top).toFixed(1) + 'h' + (-bw).toFixed(1) + 'Z';
    if (b[4] >= b[1]) { upW += wick; upB += body; } else { dnW += wick; dnB += body; }
    var vt = +(H - b[5] / vmax * vH).toFixed(1), r = 'M' + (X - bw / 2).toFixed(1) + ' ' + vt + 'h' + bw.toFixed(1) + 'V' + H + 'h' + (-bw).toFixed(1) + 'Z';
    if (ok(b[10]) && b[5] >= b[10] * 1.4) volHi += r; else vol += r;
  });
  var sma = '', pen = false;
  bars.forEach(function (b, i) { if (!ok(b[6])) { pen = false; return; } sma += (pen ? 'L' : 'M') + x(i) + ' ' + y(b[6]); pen = true; });
  var zone = ok(det.pivot) && ok(det.upper) ? { y: y(det.upper), h: +(y(det.pivot) - y(det.upper)).toFixed(1) } : null;
  if (zone) zone.edges = 'M0 ' + zone.y + 'H' + W + 'M0 ' + (zone.y + zone.h) + 'H' + W;
  var stopPath = ok(det.stop) ? 'M0 ' + y(det.stop) + 'H' + W : '';
  return { stopPath: stopPath, stopTop: ok(det.stop) ? (y(det.stop) / H * 100).toFixed(2) + '%' : '0%', vb: '0 0 ' + W + ' ' + H, plotR: plotR, upW: upW, dnW: dnW, upB: upB, dnB: dnB, vol: vol, volHi: volHi, sma50: sma, zone: zone, hasZone: !!zone };
}

/* ---- Market page: sector rotation map ---- */
var QUAD = { lead: ['先導', 'var(--zone)'], fade: ['減速', 'var(--ext)'], lag: ['遅行', 'var(--neg)'], imp: ['改善', 'var(--wait)'] };
function quadOf(v, m) { return v >= 100 ? (m >= 0 ? 'lead' : 'fade') : (m >= 0 ? 'imp' : 'lag'); }
/* Rotation map: x = relative index (100 = in line with SPY), y = 21-day relative change. Labels placed greedily to avoid collisions. */
function rotation(groups, key, hl, W, H, setHl) {
  var L = 6, R = 6, T = 6, B = 24, pw = W - L - R, ph = H - T - B;
  var pts = groups.filter(function (g) { return ok(g[key]) && ok(g.m21); });
  var sx = Math.max(8, Math.max.apply(null, pts.map(function (g) { return Math.abs(g[key] - 100); })) * 1.2);
  var sy = Math.max(3, Math.max.apply(null, pts.map(function (g) { return Math.abs(g.m21); })) * 1.3);
  var X = function (v) { return L + (v - 100 + sx) / (2 * sx) * pw; };
  var Y = function (m) { return T + (1 - (m + sy) / (2 * sy)) * ph; };
  var cx = X(100), cy = Y(0);
  var boxes = [];
  var hit = function (b) {
    if (b.x < L + 2 || b.x + b.w > L + pw - 2 || b.y < T + 2 || b.y + b.h > T + ph - 2) return true;
    return boxes.some(function (o) { return b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y; });
  };
  var quads = [['imp', L + 8, T + 6, 'left'], ['lead', L + pw - 8, T + 6, 'right'], ['lag', L + 8, T + ph - 22, 'left'], ['fade', L + pw - 8, T + ph - 22, 'right']].map(function (q) {
    var w = 28; boxes.push({ x: q[3] === 'left' ? q[1] : q[1] - w, y: q[2], w: w, h: 16 });
    return { label: QUAD[q[0]][0], style: 'position: absolute; top: ' + (q[2] / H * 100).toFixed(2) + '%; ' + (q[3] === 'left' ? 'left: ' + (q[1] / W * 100).toFixed(2) + '%' : 'right: ' + ((W - q[1]) / W * 100).toFixed(2) + '%') + '; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: ' + QUAD[q[0]][1] };
  });
  var nodes = pts.map(function (g) {
    var q = quadOf(g[key], g.m21);
    return { g: g, q: q, x: X(g[key]), y: Y(g.m21), r: 4 + Math.sqrt(g.pct || 0) * 1.25 };
  });
  nodes.forEach(function (n) { boxes.push({ x: n.x - n.r, y: n.y - n.r, w: n.r * 2, h: n.r * 2, self: n.g.k }); });
  var order = nodes.slice().sort(function (a, b) { var pa = a.q === 'lag' ? 1 : 0, pb = b.q === 'lag' ? 1 : 0; return (b.g.k === hl) - (a.g.k === hl) || pa - pb || (b.g.pct || 0) - (a.g.pct || 0); });
  var labels = [];
  order.forEach(function (n) {
    var w = n.g.l.length * 12 + 6, h = 16, gap = 4;
    var cands = [[n.x + n.r + gap, n.y - h / 2], [n.x - n.r - gap - w, n.y - h / 2], [n.x - w / 2, n.y - n.r - gap - h], [n.x - w / 2, n.y + n.r + gap],
      [n.x + n.r + gap, n.y - h / 2 - 12], [n.x + n.r + gap, n.y - h / 2 + 12], [n.x - n.r - gap - w, n.y - h / 2 - 12], [n.x - n.r - gap - w, n.y - h / 2 + 12]];
    var own = boxes.filter(function (o) { return o.self === n.g.k; })[0];
    if (own) boxes.splice(boxes.indexOf(own), 1);
    var put = null;
    for (var i = 0; i < cands.length && !put; i++) { var b = { x: cands[i][0], y: cands[i][1], w: w, h: h }; if (!hit(b)) put = b; }
    if (own) boxes.push(own);
    if (!put) return;
    boxes.push(put);
    var on = hl === n.g.k;
    labels.push({ text: n.g.l, style: 'position: absolute; left: ' + (put.x / W * 100).toFixed(2) + '%; top: ' + (put.y / H * 100).toFixed(2) + '%; font-size: 12px; line-height: 16px; white-space: nowrap; font-weight: ' + (on ? 700 : 500) + '; color: ' + (on ? 'var(--text)' : n.q === 'lag' ? 'var(--text-3)' : 'var(--text-2)') });
  });
  var circles = nodes.map(function (n) {
    var on = hl === n.g.k, tone = QUAD[n.q][1];
    return { cx: n.x.toFixed(1), cy: n.y.toFixed(1), r: (n.r + (on ? 2 : 0)).toFixed(1),
      enter: function () { setHl(n.g.k); }, leave: function () { setHl(null); },
      style: 'fill: color-mix(in srgb, ' + tone + ' ' + (on ? 70 : 38) + '%, transparent); stroke: ' + (on ? 'var(--text)' : tone) + '; stroke-width: ' + (on ? 2 : 1.2) + 'px; animation-delay: ' + (nodes.indexOf(n) * 40 + 150) + 'ms' };
  });
  var fmt = function (v) { return v.toFixed(0); };
  var ticks = [
    { label: fmt(100 - sx), style: 'position: absolute; left: ' + (L / W * 100).toFixed(2) + '%; bottom: 0; font-size: 11px; color: var(--text-3)' },
    { label: '100', style: 'position: absolute; left: ' + (cx / W * 100).toFixed(2) + '%; bottom: 0; transform: translateX(-50%); font-size: 11px; color: var(--text-3)' },
    { label: fmt(100 + sx), style: 'position: absolute; right: ' + (R / W * 100).toFixed(2) + '%; bottom: 0; font-size: 11px; color: var(--text-3)' }
  ];
  var byQ = function (q) { return nodes.filter(function (n) { return n.q === q; }).map(function (n) { return n.g.l; }); };
  var aria = '業種ローテーション。先導：' + (byQ('lead').join('、') || 'なし') + '。減速：' + (byQ('fade').join('、') || 'なし') + '。改善：' + (byQ('imp').join('、') || 'なし') + '。遅行：' + byQ('lag').length + '業種。';
  return { vb: '0 0 ' + W + ' ' + H, L: L, T: T, pw: pw, ph: ph, cx: cx.toFixed(1), cy: cy.toFixed(1),
    qw: (L + pw - cx).toFixed(1), qhTop: (cy - T).toFixed(1), qwL: (cx - L).toFixed(1), qhBot: (T + ph - cy).toFixed(1),
    axes: 'M' + cx.toFixed(1) + ' ' + T + 'V' + (T + ph) + 'M' + L + ' ' + cy.toFixed(1) + 'H' + (L + pw),
    pts: circles, labels: labels, quads: quads, ticks: ticks, aria: aria, imp: byQ('imp'), impNodes: nodes.filter(function (n) { return n.q === 'imp'; }) };
}
