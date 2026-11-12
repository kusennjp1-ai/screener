// Daily brief stock chart on synthetic data: the period segment and the readout above the chart, the honest
// weekly label, the touch scrub, the legend colours, the 12px floor, the 44px targets and the phone budgets;
// round 2: no label over another label, a tag or the last price, the final contraction's depth, the date
// ticks, the RS panel, one earnings count, the pivot crossing, ADR and the unverified readout; every label's box
// on every fixture stock and period (no label over a candle unless the renderer proves it had no free box, no average's
// name over candles while a clear spot is near its line's end, no leader through a label, no two labels read as one
// phrase, no level line through a label uncut).
import { test, expect } from '@playwright/test';
import { date, horizontalOverflow, openBrief, rowBySymbol, rows, VIEWPORTS } from './brief-fixture.js';
import { chartCrossing, crossingNote, priceInRange } from '../../src/static/brief/chartReadout.js';
import { LEADER_OFF_LEVEL, LEADER_OFF_LEVEL_MIN, MA_SHIFT, MA_TAIL } from '../../src/static/brief/priceChart.js';
import { BOX_GAP, FIGURE_GAP, FIGURE_STACK, KIN_GAP, LABEL_GAP, PHRASE_GAP } from '../../src/static/brief/chartLabels.js';

const DOCK_TOP = 788; // 844 − the 56px dock at 390×844
// Measure only after the finite animations finish (the last price's pulse repeats for ever).
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => null))));
const chartReady = page => expect(page.getByTestId('brief-price-chart').locator('svg rect.bc-up, svg rect.bc-down').first()).toBeAttached();
/** Rows the readout takes (its items' distinct tops). */
const readoutRows = page => page.locator('.brief-readout').evaluate(node => new Set([...node.querySelectorAll('.ro-item')].map(item => Math.round(item.getBoundingClientRect().top))).size);
/** Every visible text in the chart card below 12px, SVG text scaled to the screen. */
const smallText = page => page.locator('.brief-chartcard').evaluate(card => {
  const small = [];
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!node.textContent.trim() || !element.getClientRects().length || element.closest('.sr-only')) continue;
    const svg = element.closest('svg');
    const scale = svg ? svg.getBoundingClientRect().width / svg.viewBox.baseVal.width : 1;
    const size = parseFloat(getComputedStyle(element).fontSize) * scale;
    if (size < 11.95) small.push(`${node.textContent.trim().slice(0, 20)} ${size.toFixed(1)}`);
  }
  return small;
});
// A rising RS line (price ÷ a flat benchmark) for the rs_line hook.
const withRsLine = charts => { for (const chart of Object.values(charts)) chart.rs_line = chart.bars.map(bar => ({ time: bar.date, value: bar.close / 50 })); };
/**
 * A heavy-volume break of the 50-day line nine sessions ago with the close still under the line (Track E's
 * fixture for a broken setup, as in brief-watch.spec.js): the bars before it are lifted 15%, the session before
 * it closes at its 50-day high and the break day trades 2.2 times the prior 50-day average. The last close
 * stays the row's price, so the bars stay certified and the 50-day sell check fires.
 */
function breakBelow50(bars) {
  const n = bars.length, at = n - 9;
  for (let i = 0; i < at; i++) for (const key of ['open', 'high', 'low', 'close']) bars[i][key] *= 1.15;
  const top = Math.max(...bars.slice(at - 50, at - 1).map(bar => bar.close));
  Object.assign(bars[at - 1], { open: top, close: top, high: top * 1.005, low: top * 0.995 });
  bars[at].volume = Math.round(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * 2.2);
}
// The same charts at about $1,300 (the rows are not scaled, so these bars are not certified: display only).
const scaled = charts => { withRsLine(charts); for (const chart of Object.values(charts)) chart.bars = chart.bars.map(b => ({ ...b, open: b.open * 12, high: b.high * 12, low: b.low * 12, close: b.close * 12 })); };
/** The card's hard cap and the 12px of headroom under it (plan §3, rule 9): the card is 508px or less. */
const CARD_CAP = 520, CARD_LINE = CARD_CAP - 12;
/** Lines of the legend's shown items (their distinct tops). */
const legendLines = page => page.locator('.brief-legend').evaluate(node => new Set([...node.children].filter(item => !item.hidden && item.getClientRects().length).map(item => Math.round(item.getBoundingClientRect().top))).size);
/** Each readout line's horizontal slack: its width less its items and gaps (one row each, so it never wraps). */
const readoutSlack = page => page.locator('.brief-readout').evaluate(node => [...node.querySelectorAll('.ro-line')].map(line => {
  const items = [...line.children].filter(item => item.getClientRects().length), gap = parseFloat(getComputedStyle(line).columnGap) || 0;
  return line.getBoundingClientRect().width - items.reduce((sum, item) => sum + item.getBoundingClientRect().width, 0) - gap * Math.max(0, items.length - 1);
}));
/**
 * Label collisions in the chart: every in-plot label's box (its text's width, 12px around its centre) against
 * every other label, every right-axis tag (price tags, 安値, RS新高値, the earnings flag), the last price's dot and
 * the marks (the crossing's arrow, the sell signs); and the axis column's own boxes (RS新高値 against the
 * earnings flag) against each other.
 */
const collisions = page => page.getByTestId('brief-price-chart').evaluate(chart => {
  const labels = [...chart.querySelectorAll('.bc-levelnote, .bc-malabel, .bc-ttext, .bc-legtext, .bc-zonetext, .bc-notice, .bc-breakouttext, .bc-rscaption')]
    .filter(node => node.getAttribute('visibility') !== 'hidden' && node.textContent.trim())
    .map(node => { const box = node.getBBox(), centre = Number(node.getAttribute('y')) - 4; return { name: node.textContent, x0: box.x, x1: box.x + box.width, y0: centre - 6, y1: centre + 6 }; });
  const solid = [...chart.querySelectorAll('.bc-tag rect, .bc-rshigh rect, .bc-earnflag rect, .bc-lastdot, .bc-breakoutmark, .bc-sell')]
    .map(node => { const box = node.getBBox(); return { name: node.closest('[data-tag]')?.dataset.tag || node.getAttribute('class'), x0: box.x, x1: box.x + box.width, y0: box.y, y1: box.y + box.height }; });
  const hit = (a, b) => a.x0 < b.x1 - 0.5 && a.x1 > b.x0 + 0.5 && a.y0 < b.y1 - 0.5 && a.y1 > b.y0 + 0.5;
  const out = [];
  labels.forEach((a, i) => { for (const b of [...labels.slice(i + 1), ...solid]) if (hit(a, b)) out.push(`${a.name} × ${b.name}`); });
  const column = solid.filter(box => box.name === 'bc-rstag-fill' || box.name === 'bc-earnflag-fill');
  column.forEach((a, i) => { for (const b of column.slice(i + 1)) if (hit(a, b)) out.push(`${a.name} × ${b.name}`); });
  return out;
});
/** A price as the chart may print it: two decimals, and on an axis tag none from 1,000 up. */
const priceTexts = value => [2, ...(Math.abs(value) >= 1000 ? [0] : [])].map(digits => value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
/**
 * The levels the chart's model puts in its price range (priceInRange, the renderer's own range): the 52-week high, the
 * pivot, the stop, the last contraction's low, the plan's entry, 2R and 3R, and the zone's top. The model is the one the
 * card drew (PriceChart's props, from React's record of them), never read off the drawing: a level the renderer left out
 * leaves no trace there. Each with its line's selector, its name (none: its line only), its prices (priceTexts) and its
 * own tag's key.
 */
async function levelsInRange(page) {
  const drawn = await page.getByTestId('brief-price-chart').evaluate(chart => {
    const key = Object.keys(chart).find(name => name.startsWith('__reactFiber$'));
    let owner = key ? chart[key] : null;
    while (owner && !(owner.memoizedProps?.model?.bars && Number.isFinite(owner.memoizedProps.period))) owner = owner.return;
    if (!owner) return null;
    // The node keeps the fiber that created it, which React may since have swapped for its alternate (the props of an
    // earlier render): the chart's current fiber is the one of its type in the root's current tree.
    let root = owner;
    while (root.return) root = root.return;
    let current = null;
    for (const stack = [root.stateNode?.current]; stack.length && !current;) {
      const fiber = stack.pop();
      if (fiber) { if (fiber.type === owner.type) current = fiber; else stack.push(fiber.sibling, fiber.child); }
    }
    const { model, period } = current?.memoizedProps || {};
    return model ? { period, model: { bars: model.bars, interval: model.interval, pivot: model.pivot, upper: model.upper, stop: model.stop, auditHigh: model.auditHigh, structuralLow: model.structuralLow, entry: model.entry, r2: model.r2, r3: model.r3 } } : null;
  });
  if (!drawn) return null;
  const { model, period } = drawn, finite = Number.isFinite;
  // The entry only apart from the pivot (the renderer draws it then: at the pivot it is the pivot's line).
  const entry = finite(model.entry) && !(finite(model.pivot) && Math.abs(model.entry / model.pivot - 1) <= 0.001) ? model.entry : null;
  return [
    ['the 52-week high', model.auditHigh, 'line.bc-high52', '52週高', 'high52'],
    ['the pivot', model.pivot, 'line.bc-pivot', 'ピボット', 'pivot'],
    ['the stop', model.stop, 'line.bc-stop', '損切り', 'stop'],
    ['the last contraction\'s low', model.structuralLow, 'line.bc-structural', '最後の収縮の安値', 'low'],
    ['the entry', entry, 'line.bc-entry', '買値', 'entry'],
    ['2R', model.r2, 'line.bc-r2', '2R', 'r2'],
    ['3R', model.r3, 'line.bc-r3', '3R', 'r3'],
    // The zone's top: its edge only (a band 14px or thinner goes unnamed; the conclusion's 買いの範囲 gives its price).
    ['the zone\'s top', finite(model.pivot) ? model.upper : null, 'rect.bc-zoneedge', null, null],
  ].filter(([, value]) => priceInRange(model, period, value)).map(([what, value, line, name, tag]) => ({ what, line, name, tag, prices: priceTexts(value) }));
}
/** How far from its line's end the test looks for a clear spot for a forced average's name (independent of data-search). */
const MA_REACH = { left: MA_SHIFT, height: 48 };
/**
 * Every label's box in the chart (round 2, labels fixes 1–3): each visible text (in-plot labels, captions, the axes'
 * values, the tags' prices) against every candle (its whole high–low range across its body), every volume bar and its
 * dot, every other text and every tag, mark and leader (a tag's, and each part of an average's leader: no label but the
 * name it joins may meet one, no other leader may run along or across it, and it may not run past another average's
 * line end). A text may sit over candles or bars only when the renderer forced it (data-forced="1"):
 * the test then re-runs the spots it tried (data-search "x0 x1 step|centres", the box from data-box) with the box 1px
 * larger on each side and every obstacle at least as large as the renderer took it (candles 2px wider each side, bars
 * 1px, texts LABEL_GAP across (KIN_GAP between the plan's two names and between an average's name and a figure) and 1px
 * up and down, marks 2px, leaders 4px across and 2px up and down, each average's last MA_TAIL px BOX_GAP across for any
 * label but a name, and for a level's name any spot another level line strikes), so a spot clear here was clear for the
 * renderer too; finding one fails. A forced average's name also
 * fails when the test's own search finds a clear spot near its line's end (its right end up to MA_REACH.left left of
 * where it ends unmoved, 7px from the axis, its centre within MA_REACH.height of the end's height, inside the plot),
 * whatever spots the renderer tried (an average's spot is clear only where the leader it would need there is clear
 * too; a spot whose leader would run within LEADER_OFF_LEVEL of a level line counts as taken). An average's name with no
 * leader sits at its line's end or on its own line, and no leader runs within LEADER_OFF_LEVEL_MIN of a level line; two
 * leaders meet only as one shared leader of two lines ending at one point (within 3px, the same way, the names in the
 * order of the ends). Two labels never read as one phrase: two texts whose glyph rows overlap (a label in the plot and
 * another, or an axis value) keep PHRASE_GAP between their glyphs, an average's name and a figure (a depth, a T number,
 * another name) FIGURE_GAP, the pivot's name and the zone's two glyphs. A level's name is never centred within 4px of
 * another level's line or the zone's top edge (it would read as that line's name and price). A level line (or the
 * zone's top edge) within 4px of a label's centre, or an average across its glyphs, is cut under it (its mask's hole
 * spans the glyphs). Also the stop's line has its name, every contraction with a computed depth (data-depth on its
 * box) shows that depth, and every level the chart's model puts in its price range (levelsInRange) has its line drawn
 * and its name and price inside the card. Returns the failures and the forced labels.
 */
const labelAudit = async page => { const ranged = await levelsInRange(page); return page.getByTestId('brief-price-chart').evaluate((chart, { reach, kinGap, labelGap, phraseGap, figureGap, figureStack, boxGap, tailLength, offLevel, offLevelMin, ranged }) => {
  const out = [];
  const visible = node => !node.closest('.bc-hover, .bc-scrub') && node.getAttribute('visibility') !== 'hidden' && node.textContent.trim() !== '';
  const groupOf = node => node.closest('g.bc-tag, g.bc-rshigh, g.bc-earnflag');
  const hit = (a, b) => a.x0 < b.x1 - 0.5 && a.x1 > b.x0 + 0.5 && a.y0 < b.y1 - 0.5 && a.y1 > b.y0 + 0.5;
  const grow = (box, dx, dy) => ({ x0: box.x0 - dx, x1: box.x1 + dx, y0: box.y0 - dy, y1: box.y1 + dy });
  const texts = [...chart.querySelectorAll('svg text')].filter(visible).map(node => {
    const box = node.getBBox(), centre = Number(node.getAttribute('y')) - 4, reserved = node.dataset.box?.split(' ').map(Number);
    const own = { x0: box.x, x1: box.x + box.width, y0: centre - 6, y1: centre + 6 };
    const outer = reserved ? { x0: Math.min(own.x0, reserved[0]), x1: Math.max(own.x1, reserved[1]), y0: Math.min(own.y0, reserved[2]), y1: Math.max(own.y1, reserved[3]) } : own;
    return { node, name: node.textContent.trim(), group: groupOf(node), ...own, outer, reserved, centre };
  });
  const solids = [...chart.querySelectorAll('.bc-tag rect, .bc-rshigh rect, .bc-earnflag rect, .bc-lastdot, .bc-breakoutmark, .bc-sell, line.bc-leader')]
    .filter(node => node.getAttribute('visibility') !== 'hidden')
    .map(node => { const box = node.getBBox(); return { name: node.closest('[data-tag]')?.dataset.tag || node.getAttribute('class'), group: groupOf(node), x0: box.x, x1: box.x + box.width, y0: box.y, y1: box.y + box.height }; });
  // Each average's leader, split into its vertical and horizontal parts (1px wide), with the key of the name it joins.
  const leaders = [...chart.querySelectorAll('path.bc-maleader')].flatMap(path => {
    const key = [...path.classList].find(cls => cls.startsWith('bc-maleader-')).slice('bc-maleader-'.length), parts = [];
    let px = 0, py = 0, from = null;
    for (const [, cmd, value] of path.getAttribute('d').matchAll(/([MVH])([^MVH]+)/g)) {
      if (cmd === 'M') { [px, py] = value.split(',').map(Number); from = py; continue; }
      const v = Number(value);
      if (cmd === 'V') { parts.push({ key, from, v: true, name: `the ${key} leader`, x0: px - 0.5, x1: px + 0.5, y0: Math.min(py, v), y1: Math.max(py, v) }); py = v; }
      else { parts.push({ key, from, v: false, name: `the ${key} leader`, x0: Math.min(px, v), x1: Math.max(px, v), y0: py - 0.5, y1: py + 0.5 }); px = v; }
    }
    return parts;
  });
  // Where each average's line ends (the leaders start there).
  const lineEnds = [...chart.querySelectorAll('path.bc-ma')].map(path => ({ key: [...path.classList].find(cls => /^bc-(ma|ema)\d+$/.test(cls)).slice(3), y: (path.getAttribute('d') || '').split(/[ML]/).filter(Boolean).at(-1)?.split(',').map(Number)[1] })).filter(end => Number.isFinite(end.y));
  const joins = (text, part) => text.node.classList.contains(`bc-malabel-${part.key}`);
  // A vertical part's way from its line's end: up when its far end is above.
  const upward = part => Math.abs(part.y0 - part.from) > Math.abs(part.y1 - part.from);
  // Where a vertical part reaches its name.
  const tipOf = part => (upward(part) ? part.y0 : part.y1);
  // Any part's way from its line's end and the row it reaches (a horizontal part's own row).
  const wayOf = part => (part.v ? upward(part) : (part.y0 + part.y1) / 2 < part.from), rowOf = part => (part.v ? tipOf(part) : (part.y0 + part.y1) / 2);
  // Two parts of two lines ending at one point (within 3px) that go the same way with their names in the order of the
  // ends (either order within `loose` px): one shared leader, a nearer name's horizontal part branching off it.
  const sharedParts = (a, b, loose) => Math.abs(a.from - b.from) <= 3 && (a.v || b.v) && wayOf(a) === wayOf(b) && (Math.abs(a.from - b.from) <= loose || (a.from - b.from) * (rowOf(a) - rowOf(b)) > 0);
  const plot = chart.querySelector('svg clipPath rect'), pw = Number(plot.getAttribute('width')), bottom = Number(plot.getAttribute('height'));
  // The level lines drawn (and the zone's top edge), with the mask that cuts them.
  const levels = [...chart.querySelectorAll('line.bc-planline, line.bc-high52, line.bc-pivot, line.bc-stop')].map(line => ({ name: line.getAttribute('class'), x0: Number(line.getAttribute('x1')), x1: Number(line.getAttribute('x2')), y: Number(line.getAttribute('y1')), mask: line.getAttribute('mask') }));
  const edge = chart.querySelector('rect.bc-zoneedge');
  if (edge) levels.push({ name: 'the zone\'s edge', x0: Number(edge.getAttribute('x')), x1: Number(edge.getAttribute('x')) + Number(edge.getAttribute('width')), y: Number(edge.getAttribute('y')), mask: edge.getAttribute('mask') });
  // Each average's line as drawn (its points, run by run) and where it runs at xx (null where it is not drawn).
  const linePoints = key => (chart.querySelector(`path.bc-ma.bc-${key}`)?.getAttribute('d') || '').split('M').filter(Boolean).map(run => run.split('L').map(pair => pair.split(',').map(Number)));
  // Each average's last stretch (its segments ending within tailLength of its last point), as boxes 1px taller each way.
  const tails = [...chart.querySelectorAll('path.bc-ma')].flatMap(path => {
    const points = ((path.getAttribute('d') || '').split('M').filter(Boolean).at(-1) || '').split('L').filter(Boolean).map(pair => pair.split(',').map(Number)), last = points.at(-1)?.[0];
    return points.slice(0, -1).map((p, i) => [p, points[i + 1]]).filter(([, q]) => last - q[0] < tailLength).map(([p, q]) => ({ x0: p[0], x1: q[0], y0: Math.min(p[1], q[1]) - 1, y1: Math.max(p[1], q[1]) + 1 }));
  });
  // A label's kind for its gaps: the plan's green names, an average's name, a contraction's T number or depth.
  const kindOf = node => (node.matches('.bc-pivot-text, .bc-zonetext') ? 'plan' : node.matches('.bc-malabel') ? 'ma' : node.matches('.bc-legtext') ? 'leg' : node.matches('.bc-ttext') ? 'tn' : null);
  // A level's name: the class of its own line (null for any other label).
  const ownLine = node => [...node.classList].map(cls => /^bc-(pivot|stop|high52|entry|r2|r3|structural)-text$/.exec(cls)?.[1]).find(Boolean)?.replace(/^/, 'bc-') ?? null;
  const lineAt = (runs, xx) => {
    for (const run of runs) for (let i = 0; i + 1 < run.length; i++) {
      const [p, q] = [run[i], run[i + 1]];
      if (p[0] <= xx && xx <= q[0]) return q[0] === p[0] ? p[1] : p[1] + (q[1] - p[1]) * (xx - p[0]) / (q[0] - p[0]);
    }
    return null;
  };
  // The leader an average's name would need at a spot (x its left edge, w wide), as the renderer reserves it: up or down
  // the axis gutter from its line's end, then left along the name's row when the name is moved left; none at the end
  // itself (within 3px of its height, unmoved) or where its own line runs into a moved name's right end. A spot is clear
  // for the name only where that leader keeps BOX_GAP from every other label and the horizontal part meets no mark or
  // tag either nor runs along a level line (within LEADER_OFF_LEVEL), and it meets no other average's leader (running along it or
  // ending across it) but as one shared leader (ends within 3px, the same way, in the order of the ends; either order only
  // for ends within 0.9px as the paths write them, so the search is never looser than the renderer).
  const leaderAt = (runs, endY, x, yc, w) => {
    const shifted = x < pw - 7 - w - 1;
    if (shifted ? Math.abs((lineAt(runs, x + w + 3) ?? Infinity) - yc) <= 2.9 : Math.abs(yc - endY) <= 3) return [];
    const tip = shifted ? yc : yc + (endY > yc ? 6 : -6);
    const parts = [{ v: true, up: tip < endY, x0: pw - 2.5, x1: pw - 0.5, y0: Math.min(endY, tip) - 1, y1: Math.max(endY, tip) + 1 }];
    if (!shifted) return parts;
    if (levels.some(level => level.x0 < pw - 1.5 && Math.abs(level.y - yc) <= offLevel + 0.1)) return null;
    return [...parts, { v: false, x0: x + w + 2, x1: pw - 1.5, y0: yc - 2, y1: yc + 2 }];
  };
  const leaderClear = (a, runs, endY, x, yc, w) => leaderAt(runs, endY, x, yc, w)?.every(part => !texts.some(t => t !== a && hit(part, grow(t.outer, 3.5, 0.5)))
    && (part.v || !solids.some(s => hit(part, grow(s, 2, 2))))
    && !leaders.filter(other => !joins(a, other)).some(other => {
      const box = other.v ? { x0: other.x0 - 0.5, x1: other.x1 + 0.5, y0: other.y0 - 1, y1: other.y1 + 1 } : { x0: other.x0, x1: other.x1, y0: other.y0 - 1.5, y1: other.y1 + 1.5 };
      if (part.v && other.v && Math.abs(other.from - endY) <= 3 && part.x0 < box.x1 && part.x1 > box.x0) return part.up === upward(other) && !(Math.abs(other.from - endY) <= 0.9 || (endY - other.from) * ((part.up ? part.y0 + 1 : part.y1 - 1) - tipOf(other)) > 0);
      if (part.v !== other.v && sharedParts({ v: part.v, from: endY, y0: part.v ? (part.up ? part.y0 + 1 : endY) : part.y0, y1: part.v ? (part.up ? endY : part.y1 - 1) : part.y1 }, other, 0.9)) return false;
      return part.x0 < box.x1 && part.x1 > box.x0 && part.y0 < box.y1 - 1.5 && part.y1 > box.y0 + 1.5;
    })
    && !lineEnds.some(end => !a.node.classList.contains(`bc-malabel-${end.key}`) && Math.abs(end.y - endY) > 3 && part.x0 < pw - 0.5 && part.x1 > pw - 2.5 && part.y0 < end.y && part.y1 > end.y));
  // A candle: its wick (the high–low range) across its body's width.
  const wicks = [...chart.querySelectorAll('line.bc-up, line.bc-down')], bodies = [...chart.querySelectorAll('rect.bc-up, rect.bc-down')];
  const candles = wicks.map((wick, i) => { const w = wick.getBBox(), b = bodies[i].getBBox(); return { x0: Math.min(b.x, w.x), x1: Math.max(b.x + b.width, w.x), y0: Math.min(w.y, b.y), y1: Math.max(w.y + w.height, b.y + b.height) }; });
  const volume = [...chart.querySelectorAll('rect.bc-vol, circle.bc-voldot')].map(node => node.getBBox()).filter(box => box.height > 0.2).map(box => ({ x0: box.x, x1: box.x + box.width, y0: box.y, y1: box.y + box.height }));
  const solidUnder = (box, pad = 0) => candles.filter(c => hit(box, grow(c, 2 * pad, 0))).length + volume.filter(v => hit(box, grow(v, pad, 0))).length;
  // The RS line and its lead underlines (obstacles of a label the renderer tried at the RS panel's foot).
  const rsPoints = (chart.querySelector('path.bc-rs')?.getAttribute('d') || '').split(/[ML]/).filter(Boolean).map(pair => pair.split(',').map(Number));
  const leads = [...chart.querySelectorAll('line.bc-rslead')].map(node => grow((({ x, y, width, height }) => ({ x0: x, x1: x + width, y0: y, y1: y + height }))(node.getBBox()), 1, 2));
  const crossesRs = box => leads.some(lead => hit(box, lead)) || rsPoints.some((p, i) => {
    const q = rsPoints[i + 1];
    if (!q) return false;
    const l = Math.max(p[0], box.x0), r = Math.min(q[0], box.x1);
    if (l > r) return false;
    const at = xx => (q[0] === p[0] ? p[1] : p[1] + (q[1] - p[1]) * (xx - p[0]) / (q[0] - p[0]));
    return Math.min(at(l), at(r)) < box.y1 && Math.max(at(l), at(r)) > box.y0;
  });
  // Two averages' leaders never run along each other or end across each other, and none runs past another line's end
  // (each would read as joined to the wrong line); leaders leaving one point (ends within 3px) may part there, or run
  // the same way as one shared leader with their names in the order of the ends (either order for ends within 1px), a
  // nearer name's horizontal part branching off it.
  const span = (a, b) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  leaders.forEach((a, i) => {
    for (const b of leaders.slice(i + 1)) {
      if (a.key === b.key || !(a.x0 < b.x1 && a.x1 > b.x0)) continue;
      // Two vertical parts leaving one point (ends within 3px) part there unless they go the same way.
      // (Ends within 1px as the renderer works them out: within 1.1px as the paths write them to 0.1px.)
      const apart = a.v && b.v && Math.abs(a.from - b.from) <= 3 && upward(a) !== upward(b), shared = sharedParts(a, b, 1.1);
      if (!apart && !shared && span(a, b) > (a.v && b.v ? 2 : 0)) out.push(`${a.name} meets ${b.name}`);
    }
    if (!a.v && a.x1 < pw - 2.5) return;
    for (const end of lineEnds) if (end.key !== a.key && Math.abs(end.y - a.from) > 3 && end.y > a.y0 + (a.v ? 1 : -1) && end.y < a.y1 - (a.v ? 1 : -1)) out.push(`${a.name} runs past the ${end.key} line's end`);
  });
  texts.forEach((a, i) => {
    for (const b of texts.slice(i + 1)) if (!(a.group && a.group === b.group) && hit(a, b)) out.push(`${a.name} × ${b.name}`);
    for (const b of solids) if (b.group !== a.group && hit(a, b)) out.push(`${a.name} × ${b.name}`);
    for (const part of leaders) if (!joins(a, part) && hit(a, part)) out.push(`${a.name} × ${part.name}`);
    const under = solidUnder(a);
    if (!under) return;
    if (a.node.dataset.forced !== '1') { out.push(`${a.name} over ${under} candles or bars, not forced`); return; }
    // A forced label: none of the spots it tried may be clear.
    const [range, centres] = (a.node.dataset.search || '').split('|');
    if (!range || !a.reserved) { out.push(`${a.name}: forced without its search`); return; }
    const [x0, x1, step] = range.split(' ').map(Number), w = a.reserved[1] - a.reserved[0], half = (a.reserved[3] - a.reserved[2]) / 2;
    // An average's name: its line's end (the leader it would need at a spot is part of the spot).
    const key = [...a.node.classList].find(cls => cls.startsWith('bc-malabel-'))?.slice('bc-malabel-'.length);
    const end = key ? (chart.querySelector(`path.bc-ma.bc-${key}`)?.getAttribute('d') || '').split(/[ML]/).filter(Boolean).at(-1)?.split(',').map(Number) : null;
    if (key && !end) { out.push(`${a.name}: forced, with no line of its own`); return; }
    const runs = key ? linePoints(key) : [], clearFor = (xx, yc) => !end || leaderClear(a, runs, end[1], xx, yc, w);
    // The plan's two green names, and an average's name beside a figure, keep their wider gaps (KIN_GAP) for the renderer too.
    const gapTo = t => { const [k, l] = [kindOf(t.node), kindOf(a.node)], figure = ['ma', 'leg', 'tn']; return k === 'plan' && l === 'plan' ? kinGap.plan : (k === 'ma' && figure.includes(l)) || (l === 'ma' && figure.includes(k)) ? kinGap.figure : labelGap; };
    // An average's last stretch is taken for every label but an average's name.
    // (and a name and a contraction's figure one above the other FIGURE_STACK apart).
    const stackTo = t => ([kindOf(t.node), kindOf(a.node)].sort().join() === 'leg,ma' ? figureStack + 1 : 1);
    const others = [...texts.filter(t => t !== a && t.node.dataset.box !== a.node.dataset.box).map(t => grow(t.outer, gapTo(t), stackTo(t))), ...solids.map(s => grow(s, 2, 2)), ...leaders.filter(part => !joins(a, part)).map(part => grow(part, 4, 2)), ...(key ? [] : tails.map(tail => grow(tail, boxGap, 0)))];
    // A level's name: no spot another level line (or the zone's top edge) strikes through.
    // (Not its own line, nor one within 1.5px of it, which reads as the same line; 1.4px here, never looser.)
    const own = ownLine(a.node), ownY = own && levels.find(level => level.name.split(' ').includes(own))?.y;
    const struck = (xx, yc) => own && levels.some(level => !level.name.split(' ').includes(own) && !(Math.abs(level.y - ownY) <= 1.4) && xx + w + 1 > level.x0 && xx - 1 < level.x1 && Math.abs(level.y - yc) <= 5.6);
    const xs = [];
    for (let xx = x0; xx <= x1 + 1e-6; xx += step) xs.push(xx);
    if (xs.at(-1) < x1) xs.push(x1);
    for (const xx of xs) for (const yc of centres.split(' ').map(Number)) {
      const box = { x0: xx - 1, x1: xx + w + 1, y0: yc - half - 1, y1: yc + half + 1 };
      if (!others.some(o => hit(box, o)) && !solidUnder(box, 1) && !crossesRs(box) && !struck(xx, yc) && clearFor(xx, yc)) { out.push(`${a.name}: forced, but the spot ${xx.toFixed(1)},${yc.toFixed(1)} was clear`); return; }
    }
    // A forced average's name: no clear spot near its line's end, by the test's own search.
    if (!key) return;
    for (let right = pw - 7; right >= pw - 7 - reach.left; right--) for (let yc = Math.ceil(end[1] - reach.height); yc <= end[1] + reach.height; yc++) {
      if (yc - half < 8 || yc + 7 > bottom) continue;
      const box = { x0: right - w - 1, x1: right + 1, y0: yc - half - 1, y1: yc + half + 1 };
      if (!others.some(o => hit(box, o)) && !solidUnder(box, 1) && clearFor(right - w, yc)) { out.push(`${a.name}: forced over candles, but ${right},${yc} near its line's end was clear`); return; }
    }
  });
  // Two texts that would read as one phrase on one row: a label in the plot (or a caption) and any other text of the
  // plot or an axis value beside it (the lines of one notice block share its box and read as one).
  const row = (a, b) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5, apart = (a, b) => Math.max(a.x0 - b.x1, b.x0 - a.x1);
  const named = cls => texts.filter(t => t.node.matches(cls));
  const inPlot = named('.bc-levelnote, .bc-malabel, .bc-ttext, .bc-legtext, .bc-zonetext, .bc-notice, .bc-breakouttext, .bc-notetext, .bc-caption');
  const axisValues = named('.bc-axis:not(.bc-date)');
  inPlot.forEach((a, i) => {
    for (const b of [...inPlot.slice(i + 1), ...axisValues]) if (!(a.reserved && a.node.dataset.box === b.node.dataset.box) && row(a, b) && apart(a, b) < phraseGap - 0.5) out.push(`${a.name} and ${b.name} on one row ${apart(a, b).toFixed(1)}px apart`);
  });
  for (const pivot of named('.bc-pivot-text')) for (const zone of named('.bc-zonetext')) if (row(pivot, zone) && apart(pivot, zone) < 24) out.push(`${pivot.name} and ${zone.name} on one row ${apart(pivot, zone).toFixed(1)}px apart`);
  // Two bold figures: an average's name beside a depth, a T number or another name (「150 −4%」 at 16px reads as one), or
  // a name and a depth one above the other (「150／−8%／200」 reads as one column of names).
  const figures = named('.bc-malabel, .bc-ttext, .bc-legtext');
  figures.forEach((a, i) => {
    for (const b of figures.slice(i + 1)) if ((kindOf(a.node) === 'ma' || kindOf(b.node) === 'ma') && row(a, b) && apart(a, b) < figureGap - 0.5) out.push(`${a.name} and ${b.name} (figures) on one row ${apart(a, b).toFixed(1)}px apart`);
    // A depth in the names' column: one above the other, a name and a depth under its box keep FIGURE_STACK.
    for (const b of figures.slice(i + 1)) {
      if ([kindOf(a.node), kindOf(b.node)].sort().join() !== 'leg,ma' || !(Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5)) continue;
      const between = Math.max(a.y0 - b.y1, b.y0 - a.y1);
      if (between >= 0 && between < figureStack - 0.5) out.push(`${a.name} and ${b.name} (figures) one above the other ${between.toFixed(1)}px apart`);
    }
  });
  // A level's name never sits on another level's line (it would read as that line's name and price); a line within
  // 1.5px of its own reads as the same line.
  for (const label of named('.bc-levelnote')) {
    const own = ownLine(label.node), ownY = levels.find(level => level.name.split(' ').includes(own))?.y;
    for (const level of levels) {
      if (!level.name.split(' ').includes(own) && !(Math.abs(level.y - ownY) <= 1.6) && level.x1 > label.x0 && level.x0 < label.x1 && Math.abs(level.y - label.centre) <= 4) out.push(`${label.name} sits on ${level.name} (${(level.y - label.centre).toFixed(1)}px from its centre)`);
    }
  }
  // A level line (or the zone's top edge) through a label's glyphs is cut under them.
  const holes = id => [...(chart.querySelector(id.replace(/^url\((.*)\)$/, '$1'))?.querySelectorAll('rect[fill="#000"]') || [])].map(node => { const box = node.getBBox(); return { x0: box.x, x1: box.x + box.width, y0: box.y, y1: box.y + box.height }; });
  for (const label of named('.bc-levelnote, .bc-malabel, .bc-ttext, .bc-legtext, .bc-zonetext, .bc-notice, .bc-breakouttext')) for (const level of levels) {
    if (!(level.x1 > label.x0 && level.x0 < label.x1 && Math.abs(level.y - label.centre) <= 4)) continue;
    if (!(level.mask && holes(level.mask).some(h => h.x0 <= label.x0 + 1 && h.x1 >= label.x1 - 1 && h.y0 <= level.y && h.y1 >= level.y))) out.push(`${label.name}: ${level.name} runs through it uncut (${(level.y - label.centre).toFixed(1)}px from its centre)`);
  }
  // An average across a label's glyphs is cut under them too (a line through 「109.67」 reads as 109:67).
  const averagePaths = [...chart.querySelectorAll('path.bc-ma')].map(path => ({ name: path.getAttribute('class'), runs: (path.getAttribute('d') || '').split('M').filter(Boolean).map(run => run.split('L').map(pair => pair.split(',').map(Number))), mask: path.getAttribute('mask') }));
  const across = (runs, box) => runs.some(run => run.some((p, i) => {
    const q = run[i + 1];
    if (!q) return false;
    const l = Math.max(p[0], box.x0), r = Math.min(q[0], box.x1);
    if (l > r) return false;
    const at = xx => (q[0] === p[0] ? p[1] : p[1] + (q[1] - p[1]) * (xx - p[0]) / (q[0] - p[0]));
    return Math.min(at(l), at(r)) < box.y1 && Math.max(at(l), at(r)) > box.y0;
  }));
  for (const label of named('.bc-levelnote, .bc-malabel, .bc-ttext, .bc-legtext, .bc-zonetext, .bc-notice, .bc-breakouttext')) for (const average of averagePaths) {
    const glyphs = { x0: label.x0 + 1, x1: label.x1 - 1, y0: label.centre - 5, y1: label.centre + 5 };
    if (glyphs.y0 >= bottom || !across(average.runs, glyphs)) continue;
    if (!(average.mask && holes(average.mask).some(h => h.x0 <= label.x0 + 1 && h.x1 >= label.x1 - 1 && h.y0 <= glyphs.y0 && h.y1 >= glyphs.y1))) out.push(`${label.name}: ${average.name} runs through it uncut`);
  }
  // An average's name sits at its line's end, on its own line, or at the end of its leader; no leader runs along a level.
  for (const name of named('.bc-malabel')) {
    const key = [...name.node.classList].find(cls => cls.startsWith('bc-malabel-')).slice('bc-malabel-'.length), end = lineEnds.find(one => one.key === key);
    if (!end || leaders.some(part => part.key === key)) continue;
    const right = Number(name.node.getAttribute('x')), along = lineAt(linePoints(key), right + 3);
    if (!(right >= pw - 8.1 && Math.abs(name.centre - end.y) <= 3.2) && !(along !== null && Math.abs(along - name.centre) <= 3.2)) out.push(`${name.name}: away from its line (${(right - pw).toFixed(1)}px from the axis, ${(name.centre - end.y).toFixed(1)}px from its end's height) with no leader`);
  }
  for (const part of leaders) for (const level of levels) if (!part.v && level.x0 < part.x1 && level.x1 > part.x0 && Math.abs(level.y - (part.y0 + part.y1) / 2) <= offLevelMin - 0.1) out.push(`${part.name} runs along ${level.name}`);
  // The stop's dotted line always has its name.
  if (chart.querySelector('line.bc-stop') && !named('.bc-stop-text').length) out.push('the stop line has no name');
  for (const leg of chart.querySelectorAll('.bc-leg[data-depth]')) {
    const k = leg.dataset.leg, want = `−${Math.round(Number(leg.dataset.depth))}%`;
    const node = chart.querySelector(`.bc-legtext[data-i="${k}"]`) || chart.querySelector(`.bc-tlabel[data-leg="${k}"] .bc-tdepth`);
    if (!node || !visible(node) || !node.textContent.trim().endsWith(want)) out.push(`T${Number(k) + 1}: its depth ${want} is not shown`);
  }
  // Every level the model puts in range has its line drawn, and its name and price inside the card: in the plot, on an
  // axis tag, in the readout or in the legend's shown items (never only in the 注記 under the screen). The price is in
  // the text that names the level (「52週高 123.45」, 「最後の収縮の安値 106.85」), or on the level's own tag beside its name.
  if (!ranged) out.push('the chart\'s model was not found');
  const card = chart.closest('.brief-chartcard');
  const ownText = node => { const copy = node.cloneNode(true); copy.querySelectorAll('.sr-only').forEach(inner => inner.remove()); return copy.textContent.trim(); };
  const carriers = [
    ...texts.map(text => ({ text: text.name, tag: text.node.closest('g.bc-tag')?.dataset.tag ?? null })),
    ...[...card.querySelectorAll('.brief-legend > span, .brief-readout .ro-item')].filter(node => node.getClientRects().length).map(node => ({ text: ownText(node), tag: null })),
  ];
  for (const level of ranged || []) {
    const line = chart.querySelector(level.line);
    if (!line || line.getAttribute('visibility') === 'hidden') out.push(`${level.what} ${level.prices[0]}: in range, its line not drawn`);
    if (!level.name) continue;
    const named = carriers.filter(carrier => carrier.text.startsWith(level.name));
    const priced = named.some(carrier => level.prices.some(price => carrier.text.includes(price))) || (named.length > 0 && level.tag && carriers.some(carrier => carrier.tag === level.tag && level.prices.includes(carrier.text)));
    if (!priced) out.push(`${level.what} ${level.prices[0]}: in range, ${named.length ? 'its price' : 'its name'} nowhere in the card`);
  }
  return { failures: out, forced: texts.filter(t => t.node.dataset.forced === '1').map(t => t.name) };
}, { reach: MA_REACH, kinGap: KIN_GAP, labelGap: LABEL_GAP, phraseGap: PHRASE_GAP, figureGap: FIGURE_GAP, figureStack: FIGURE_STACK, boxGap: BOX_GAP, tailLength: MA_TAIL, offLevel: LEADER_OFF_LEVEL, offLevelMin: LEADER_OFF_LEVEL_MIN, ranged }); };
/** Every drawn level line (買値, 2R, 3R, 52週高, the wide chart's structural low) has its name drawn. */
const unnamedLevels = page => page.getByTestId('brief-price-chart').evaluate(chart => ['bc-entry', 'bc-r2', 'bc-r3', 'bc-high52']
  .filter(cls => chart.querySelectorAll(`line.${cls}`).length !== [...chart.querySelectorAll(`.${cls}-text`)].filter(node => node.textContent.trim() && node.getAttribute('visibility') !== 'hidden').length));
/** The 注記 key of each foldable legend item (chartNotes): a folded item's mark is still explained. */
const NOTE_KEYS = { low: '「安値」＝最後の収縮の安値 ', breakout: 'の矢印＝終値がピボットを上抜けた日', heavydown: '■＝下落日の大商い', sell: '▼＝上昇の加速、▲＝崩れ', lows: '点線＝収縮の安値を結んだ線', boxes: '枠＝値幅の収縮', pivot: '緑の破線＝ピボット', stop: '赤の点線＝損切り', ma10: '10＝10日線', ema21: '21＝21日EMA' };
/** Folded legend items whose key the 注記 does not give. */
const unexplainedFolds = page => page.evaluate(keys => {
  const notes = document.querySelector('.brief-screen-notes')?.textContent ?? '';
  return [...document.querySelectorAll('.brief-legend > span[hidden]')].map(item => item.dataset.key).filter(key => !keys[key] || !notes.includes(keys[key]));
}, NOTE_KEYS);
/** The last contraction's depth on the chart (under its box, or combined 「T2 −7%」 above it): null when it is missing, undefined without contractions. */
const finalDepth = page => page.getByTestId('brief-price-chart').evaluate(chart => {
  const last = Math.max(...[...chart.querySelectorAll('.bc-leg')].map(node => Number(node.dataset.leg)));
  if (!Number.isFinite(last)) return undefined;
  const node = chart.querySelector(`.bc-legtext[data-i="${last}"]`) || chart.querySelector(`.bc-tlabel[data-leg="${last}"] .bc-tdepth`);
  return node ? node.textContent : null;
});
/** No ASCII hyphen directly before a digit in the card's visible text, outside ISO dates (rule 11). */
const asciiMinus = page => page.locator('.brief-chartcard').evaluate(card => (card.innerText.replace(/\d{4}-\d{2}-\d{2}/g, '').match(/.{0,8}-\d.{0,4}/g) || []));
/** The 390×844 chart budget: the readout in 3 rows or fewer, the card 508px or less, the legend 2 lines or fewer. */
async function withinBudget(page, what) {
  expect(await readoutRows(page), `${what}: readout rows`).toBeLessThanOrEqual(3);
  expect((await page.locator('.brief-chartcard').boundingBox()).height, `${what}: card height`).toBeLessThanOrEqual(CARD_LINE);
  expect(await legendLines(page), `${what}: legend lines`).toBeLessThanOrEqual(2);
  expect(await smallText(page), `${what}: text under 12px`).toEqual([]);
}
/** A pivot crossing two sessions back on ZZNV (its pivot is its close) with every close since at or above the pivot. */
const crossOnZZNV = charts => {
  const bars = charts['ZZNV.json'].bars, p = bars.at(-1).close;
  Object.assign(bars.at(-3), { open: p * 0.988, close: p * 0.99, high: p * 0.995, low: p * 0.985 });
  Object.assign(bars.at(-2), { open: p * 0.995, close: p * 1.005, high: p * 1.008, low: p * 0.993 });
};
/** The published RS-line high, dated for the analysis date (plan §2.3), on every row. */
const rsHighRows = rows => { for (const row of rows) row.rs_line_high = { value: true, leading: false, as_of_date: date }; };

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`${name} ${device.viewport.width}px`, () => {
  test.use(device);
  const phone = name === 'phone';

  test('the weekly period says how many weeks it draws and shows the weekly chart', async ({ page }) => {
    // Reached from Today's focus row (on a wide screen the stock opens beside the list), after 3か月.
    const { errors } = await openBrief(page, '#/brief');
    const focus = page.getByRole('region', { name: '注目候補' });
    await expect(focus.getByTestId('brief-candidate')).toHaveCount(5);
    const target = phone ? 'ZZNV' : 'ZZKS';
    const row = focus.locator(`[data-symbol="${target}"]`);
    if (phone) await row.tap(); else await row.click();
    await expect(page).toHaveURL(new RegExp(`#/brief/stock/${target}$`));
    const chart = page.getByTestId('brief-price-chart');
    const periods = page.getByRole('group', { name: '表示期間' });
    await periods.getByRole('button', { name: '3か月' }).click();
    await expect(periods.getByRole('button', { name: '3か月' })).toHaveAttribute('aria-pressed', 'true');
    // The fixture has 280 sessions, under two years of weeks: the label never claims 週足2年.
    const weekly = periods.getByRole('button', { name: /^週足/ });
    await expect(weekly).toHaveText(/^週足（\d+週）$/);
    const weeks = Number((await weekly.textContent()).match(/\d+/)[0]);
    expect(weeks).toBeLessThan(104);
    await weekly.click();
    await expect(chart).toHaveAttribute('aria-label', new RegExp(`^${target} の週足チャート（.*〜${date}）`));
    await expect(chart.locator('.bc-notice').first()).toHaveText(new RegExp(`^週足は直近${weeks}週分（\\d{4}/\\d{2}〜）。$`));
    await expect(page.locator('.brief-legend')).toContainText('10週線');
    expect(errors).toEqual([]);
  });

  test('the next stock keeps the chosen period for the session', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV');
    await chartReady(page);
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: '1年' }).click();
    await page.goto('/#/brief/stock/ZZAR');
    await chartReady(page);
    await expect(page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: '1年' })).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  });
});

test.describe('390×844 phone', () => {
  test.use({ ...VIEWPORTS.phone, contextOptions: { reducedMotion: 'reduce' } });

  // ZZMO carries a sell mark (a heavy-volume 50-day break, the one Track E's checks fire on), so its legend has the ▼▲ item.
  for (const symbol of ['ZZNV', 'ZZAR', 'ZZMO']) test(`${symbol}: the periods, the readout and the top of the chart are on the first screen, within the card budget on every view`, async ({ page }) => {
    const charts = served => { withRsLine(served); if (symbol === 'ZZMO') breakBelow50(served['ZZMO.json'].bars); };
    const { errors } = await openBrief(page, `#/brief/stock/${symbol}`, { mutate: { charts, rows: rsHighRows } });
    await chartReady(page);
    await settled(page);
    const periods = await page.getByRole('group', { name: '表示期間' }).boundingBox();
    const readout = await page.locator('.brief-readout').boundingBox();
    const chart = await page.getByTestId('brief-price-chart').boundingBox();
    expect(periods.y + periods.height).toBeLessThanOrEqual(DOCK_TOP);
    expect(readout.y + readout.height).toBeLessThanOrEqual(DOCK_TOP);
    expect(chart.y + 60).toBeLessThanOrEqual(DOCK_TOP);
    await withinBudget(page, `${symbol} 6か月`);
    // The sell marks' key stays on the legend (a folded key would still be explained in the 注記).
    if (symbol === 'ZZMO') await expect(page.locator('.brief-legend [data-key="sell"]')).toBeVisible();
    if (symbol === 'ZZMO') await expect(page.locator('.brief-legend [data-key="sell"]')).toHaveText('▼▲売りのサイン');
    for (const button of await page.getByRole('group', { name: '表示期間' }).getByRole('button').all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
    // The current price is tagged on the right axis, outlined in the body text colour.
    const close = (await page.locator('.brief-readout .ro-item').filter({ hasText: /^終/ }).textContent()).slice(1);
    await expect(page.locator('[data-tag="last"] .bc-tagtext')).toHaveText(close);
    if (symbol === 'ZZAR') expect(close).toBe('110.88');
    // The RS panel's caption is 「RS線」; the legend, always visible, keeps RS線, RS推計 and IBD RS apart.
    await expect(page.locator('.bc-rscaption')).toHaveText('RS線');
    await expect(page.locator('.brief-legend [data-key="rs"]')).toHaveText('株価÷S&P 500・RS推計やIBD RSとは別');
    await expect(page.locator('.brief-legend [data-key="rs"]')).toBeVisible();
    // The weekly view and a selected bar stay within the same budget; 最新足 is a 44px target in the plot.
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: /^週足/ }).click();
    await chartReady(page);
    await withinBudget(page, `${symbol} 週足`);
    await expect(page.locator('.brief-readout .ro-date')).toHaveText(/^\d\d\/\d\d週$/);
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: '6か月' }).click();
    await chartReady(page);
    const box = await page.getByTestId('brief-price-chart').boundingBox();
    await page.touchscreen.tap(box.x + box.width * 0.55, box.y + 60);
    await expect(page.getByRole('button', { name: '最新足' })).toBeVisible();
    await withinBudget(page, `${symbol} tapped`);
    const latest = await page.getByRole('button', { name: '最新足' }).boundingBox();
    expect(latest.height).toBeGreaterThanOrEqual(44);
    expect(latest.x).toBeGreaterThanOrEqual(box.x);
    expect(latest.x + latest.width).toBeLessThanOrEqual(box.x + box.width);
    expect(latest.y).toBeGreaterThanOrEqual(box.y);
    expect(errors).toEqual([]);
  });

  // Every period on each stock: no label over another label, a tag or the last price; the last contraction's
  // depth; 3 date labels or more; the RS caption clear of the 新高値 tag; the readout's lines with 6px to spare.
  for (const symbol of ['ZZNV', 'ZZAR', 'ZZMO']) test(`${symbol}: every period draws its labels without a collision, with the final depth and 3 dates or more`, async ({ page }) => {
    const charts = served => { withRsLine(served); if (symbol === 'ZZMO') breakBelow50(served['ZZMO.json'].bars); };
    const { errors } = await openBrief(page, `#/brief/stock/${symbol}`, { mutate: { charts, rows: rsHighRows } });
    await chartReady(page);
    for (const label of ['3か月', '6か月', '1年', /^週足/]) {
      await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label }).click();
      await chartReady(page);
      await settled(page);
      const what = `${symbol} ${label}`;
      expect(await collisions(page), `${what}: collisions`).toEqual([]);
      expect((await labelAudit(page)).failures, `${what}: label boxes (RS line drawn)`).toEqual([]);
      const depth = await finalDepth(page);
      if (symbol !== 'ZZMO') expect(depth, `${what}: contractions drawn`).not.toBeUndefined();
      if (depth !== undefined) expect(depth, `${what}: final depth`).toMatch(/−\d+%$/);
      expect(await page.locator('.bc-date').count(), `${what}: date labels`).toBeGreaterThanOrEqual(3);
      // The new high is a tag in the axis column, clear of the caption.
      const tag = await page.locator('.bc-rshigh rect').boundingBox(), caption = await page.locator('.bc-rscaption').boundingBox(), plot = await page.getByTestId('brief-price-chart').boundingBox();
      await expect(page.locator('.bc-rshigh .bc-rstext')).toHaveText('RS新高値');
      expect(tag.x, `${what}: RS新高値 in the axis column`).toBeGreaterThan(plot.x + plot.width - 70);
      expect(tag.x > caption.x + caption.width || tag.y > caption.y + caption.height || tag.y + tag.height < caption.y, `${what}: caption and tag apart`).toBe(true);
      // The structural low is a 「安値」 tag on a phone, its price in the legend.
      if (await page.locator('[data-tag="low"]').count()) await expect(page.locator('.brief-legend [data-key="low"]')).toHaveText(/^最後の収縮の安値 [\d,]+\.\d{2}$/);
      await expect(page.locator('.bc-structural-text')).toHaveCount(0);
      const high = page.locator('.bc-high52-text');
      if (await high.count()) await expect(high).toHaveText(/^52週高 [\d,.]+$/);
      // A level line is never drawn unnamed, and a folded legend item's mark is keyed in the 注記.
      expect(await unnamedLevels(page), `${what}: unnamed level lines`).toEqual([]);
      expect(await unexplainedFolds(page), `${what}: folded legend items without a 注記 key`).toEqual([]);
      await withinBudget(page, what);
      for (const slack of await readoutSlack(page)) expect(slack, `${what}: readout slack`).toBeGreaterThanOrEqual(6);
      expect(await asciiMinus(page), `${what}: U+2212`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });

  test('ZZNV at about $1,300 keeps every label apart and the readout in 3 rows with 6px to spare', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { charts: scaled } });
    await chartReady(page);
    for (const label of ['3か月', '6か月', '1年', /^週足/]) {
      await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label }).click();
      await chartReady(page);
      await settled(page);
      expect(await collisions(page), String(label)).toEqual([]);
      expect((await labelAudit(page)).failures, `${label}: label boxes`).toEqual([]);
      for (const slack of await readoutSlack(page)) expect(slack, `${label}: readout slack`).toBeGreaterThanOrEqual(6);
    }
    expect(errors).toEqual([]);
  });

  test('the 10-day and 21-day lines on 3か月 only, without their values in the readout, the card still within budget', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { charts: withRsLine } });
    await chartReady(page);
    const chart = page.getByTestId('brief-price-chart');
    await expect(chart.locator('.bc-ma10, .bc-ema21')).toHaveCount(0);
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: '3か月' }).click();
    await expect(chart.locator('.bc-ma10, .bc-ema21')).toHaveCount(2);
    await settled(page);
    expect(await page.locator('.bc-ma10').evaluate(node => getComputedStyle(node).strokeWidth)).toBe('1px');
    await expect(page.locator('.brief-readout')).not.toContainText(/10日|21日/);
    await withinBudget(page, 'ZZNV 3か月');
    for (const label of ['1年', /^週足/]) {
      await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label }).click();
      await chartReady(page);
      await expect(chart.locator('.bc-ma10, .bc-ema21')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  test('a pivot crossing on certified bars is marked under its bar and named in the legend; none on unverified bars', async ({ page }) => {
    let bars = null;
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { charts: served => { withRsLine(served); crossOnZZNV(served); bars = served['ZZNV.json'].bars; } } });
    await chartReady(page);
    const chart = page.getByTestId('brief-price-chart');
    await expect(chart.locator('.bc-breakout')).toHaveCount(1);
    // The crossing as the chart's own helper reads it from the served bars (its volume ratio comes from the crossing
    // helper, so the 注記 is asserted through crossingNote, never as a literal of another track's ratio).
    const crossing = chartCrossing(bars, rowBySymbol.ZZNV.se_pivot_price);
    expect(crossing?.tone).toBe('neutral');
    const day = await chart.locator('.bc-breakout').getAttribute('data-date');
    expect(day < date).toBe(true);
    await expect(chart).toHaveAttribute('aria-label', new RegExp(`ピボットを上抜けた日 ${day}`));
    // The crossing day traded under 1.4× (or its ratio is unknown), so it is unconfirmed: a grey hollow arrow, never the filled ▲
    // of the 崩れ sell sign, keyed (visibly) in the legend by the same grey glyph and explained in the 注記.
    const item = page.locator('.brief-legend [data-key="breakout"]');
    await expect(item).toBeVisible();
    await expect(item).toHaveText('上抜け');
    await expect(chart.locator('.bc-breakout')).toHaveAttribute('data-tone', 'neutral');
    await expect(item.locator('svg.lg-breakoutglyph')).not.toHaveClass(/is-zone/);
    const mark = await chart.locator('.bc-breakoutmark').evaluate(node => ({ d: node.getAttribute('d'), fill: getComputedStyle(node).fill, stroke: getComputedStyle(node).stroke, surface: getComputedStyle(node.closest('.brief-chartcard')).getPropertyValue('--surface').trim() }));
    expect(mark.d).not.toMatch(/h10l-5,-8z$/);
    expect(mark.stroke).not.toBe(mark.fill);
    const glyph = await item.locator('svg path').evaluate(node => getComputedStyle(node).stroke);
    expect(glyph).toBe(mark.stroke);
    await expect(page.locator('.brief-screen-notes')).toContainText(crossingNote(crossing));
    expect(await collisions(page)).toEqual([]);
    // The weekly chart marks the crossing's week.
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: /^週足/ }).click();
    await chartReady(page);
    await expect(chart.locator('.bc-breakout')).toHaveCount(1);
    expect(await collisions(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('bars not certified for the analysis date: the readout says 未検証の足 and qualifies the change and the ratio; no crossing mark', async ({ page }) => {
    // ZZZF's scan price no longer matches its last close, so its bars are not certified.
    const rows = served => { const row = served.find(r => r.symbol === 'ZZZF'); row.current_price = Math.round(row.current_price * 1.01 * 100) / 100; };
    const { errors } = await openBrief(page, '#/brief/stock/ZZZF', { mutate: { rows, charts: withRsLine } });
    await chartReady(page);
    await settled(page);
    const readout = page.locator('.brief-readout');
    await expect(readout.locator('.ro-unverified')).toHaveText(/^未検証の足/);
    // The chip's title is the chart's sentence with the certification's reason (not this spec's copy) in brackets.
    await expect(readout.locator('.ro-unverified')).toHaveAttribute('title', /^分析基準日の日足として検証できていません（.+）$/);
    await expect(readout.locator('.ro-change')).toHaveText(/^[+−±]\d+\.\d%（未検証）$/);
    await expect(readout).toContainText(/\d\.\d{2}×（未検証）/);
    await expect(readout.locator('.ro-adr')).toHaveText(/^ADR —/);
    await expect(readout).not.toContainText('対ピボット');
    await expect(page.getByTestId('brief-price-chart').locator('.bc-breakout')).toHaveCount(0);
    await withinBudget(page, 'ZZZF unverified');
    for (const slack of await readoutSlack(page)) expect(slack, 'ZZZF readout slack').toBeGreaterThanOrEqual(6);
    expect(errors).toEqual([]);
  });

  test('a stock at about $1,300 keeps the readout in 3 rows, with whole-number prices as on the tags', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { charts: scaled } });
    await chartReady(page);
    await settled(page);
    await withinBudget(page, 'ZZNV ×12');
    await expect(page.locator('.brief-readout .ro-item').filter({ hasText: /^終/ })).toHaveText(/^終\d,\d{3}$/);
    expect(errors).toEqual([]);
  });

  test('a touch on the chart moves the readout to that bar, keeps it after release and 最新足 brings it back', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV');
    await chartReady(page);
    await settled(page);
    const readout = page.locator('.brief-readout');
    await expect(readout).toHaveAttribute('aria-label', '最新の足の値');
    await expect(readout).toContainText('10/02');
    await expect(page.getByRole('button', { name: '最新足' })).toHaveCount(0);
    const box = await page.getByTestId('brief-price-chart').boundingBox();
    await page.touchscreen.tap(box.x + 30, box.y + 100);
    await expect(readout).toHaveAttribute('aria-label', /^選んだ足（\d\d\/\d\d）の値$/);
    const chosen = await readout.getAttribute('aria-label');
    await expect(readout).not.toContainText('10/02');
    // Released: the value stays.
    await page.waitForTimeout(400);
    await expect(readout).toHaveAttribute('aria-label', chosen);
    const latest = page.getByRole('button', { name: '最新足' });
    expect((await latest.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await latest.click();
    await expect(readout).toHaveAttribute('aria-label', '最新の足の値');
    await expect(readout).toContainText('10/02');
    expect(errors).toEqual([]);
  });
});

// One earnings count on the stock screen: the chart reads the screen's earnings call, counted from today's New
// York date. ZZNV reports on 10/6; the page clock moves from 10/3 (あと3日) to the day (当日) and past it (経過).
const EARNINGS_DAY = '2026-10-06';
const withEarnings = rows => { rows.find(row => row.symbol === 'ZZNV').entry_evidence = { earnings: { date: EARNINGS_DAY } }; };
const CLOCKS = [['before', '2026-10-03T16:35:00Z', '決算 10/6 あと3日', true], ['on the day', '2026-10-06T16:00:00Z', '決算 10/6 当日', true], ['after', '2026-10-07T16:00:00Z', '決算 10/6 経過', false]];
for (const [name, device] of [['phone', VIEWPORTS.phone], ['desktop', VIEWPORTS.desktop]]) test.describe(`earnings marker on the ${name}`, () => {
  test.use({ ...device, contextOptions: { reducedMotion: 'reduce' } });
  for (const [when, clock, full, warn] of CLOCKS) test(`${when} the report: ${full}`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { rows: withEarnings, charts: withRsLine } });
    await page.clock.setFixedTime(new Date(clock));
    await page.reload();
    await chartReady(page);
    const chart = page.getByTestId('brief-price-chart');
    await expect(chart).toHaveAttribute('aria-label', new RegExp(`${full}。$`));
    if (when === 'after') await expect(chart).not.toHaveAttribute('aria-label', /あと/);
    if (name === 'phone') {
      // A compact flag in the RS panel's axis column, the full text in its title; the date axis keeps its ticks.
      await expect(chart.locator('.bc-earnflag')).toHaveAttribute('data-full', full);
      await expect(chart.locator('.bc-earnflag .bc-earnings')).toHaveText('E 10/6');
      await expect(chart.locator('.bc-earnflag.bc-earnings-soon')).toHaveCount(warn ? 1 : 0);
      // A passed report's flag is dimmed with a dashed border, never like a coming date; its 注記 key says 経過.
      await expect(chart.locator('.bc-earnflag.is-past')).toHaveCount(when === 'after' ? 1 : 0);
      const dash = await chart.locator('.bc-earnflag-fill').evaluate(node => getComputedStyle(node).strokeDasharray);
      expect(dash === 'none' || dash === '').toBe(when !== 'after');
      await expect(page.locator('.brief-screen-notes')).toContainText(`E 10/6＝${full}`);
      for (const label of ['3か月', '6か月', /^週足/]) {
        await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label }).click();
        await chartReady(page);
        expect(await page.locator('.bc-date').count(), String(label)).toBeGreaterThanOrEqual(3);
        expect(await collisions(page), String(label)).toEqual([]);
      }
    } else {
      await expect(chart.locator('.bc-earnings')).toHaveText(full);
      await expect(chart.locator('.bc-earnings-soon')).toHaveCount(warn ? 1 : 0);
    }
    expect(await chart.textContent()).not.toMatch(when === 'after' ? /あと/ : /経過/);
    expect(errors).toEqual([]);
  });
});

// Every fixture stock with a chart, on every period, at 320, 390 and 1440: no label over a candle, a volume bar, another
// label, a tag, a mark or a leader (over candles only when forced and no tried spot was clear; an average's name only when
// no spot near its line's end was clear), no two labels read as one phrase, no level line through a label uncut, and
// every computed depth on the chart.
const NARROWEST = { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
for (const [name, device] of [['320', NARROWEST], ['375', { ...NARROWEST, viewport: { width: 375, height: 812 } }], ['390', VIEWPORTS.phone], ['1440', VIEWPORTS.desktop]]) test.describe(`label boxes at ${name}`, () => {
  test.use({ ...device, contextOptions: { reducedMotion: 'reduce' } });
  test('every fixture stock and period: no label over a candle or another label unless forced with no clear spot, every depth shown', async ({ page }) => {
    test.setTimeout(240000);
    const charted = rows.filter(row => row.chart_path);
    expect(charted.length).toBeGreaterThan(20);
    const { errors } = await openBrief(page, `#/brief/stock/${charted[0].symbol}`);
    const failures = [];
    let views = 0, forced = 0;
    for (const { symbol } of charted) {
      await page.goto(`/#/brief/stock/${symbol}`);
      await chartReady(page);
      for (const label of ['3か月', '6か月', '1年', /^週足/]) {
        const button = page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label });
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('brief-price-chart')).toHaveAttribute('aria-label', new RegExp(`^${symbol} の${String(label).includes('週足') ? '週' : '日'}足チャート`));
        await chartReady(page);
        await settled(page);
        const audit = await labelAudit(page);
        views++;
        forced += audit.forced.length;
        failures.push(...audit.failures.map(failure => `${symbol} ${label}: ${failure}`));
      }
    }
    test.info().annotations.push({ type: 'label boxes', description: `${views} views, ${forced} forced labels` });
    expect(views).toBe(charted.length * 4);
    expect(failures).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('1440×900 desktop', () => {
  test.use({ ...VIEWPORTS.desktop, contextOptions: { reducedMotion: 'reduce' } });

  test('the readout reads the 50-day distance and ADR (独自計算) on the latest certified bar', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { charts: withRsLine } });
    await chartReady(page);
    const readout = page.locator('.brief-readout');
    await expect(readout.locator('.ro-ma50')).toHaveText(/^50日 [\d,]+\.\d{2}（[+−±]\d+\.\d%）$/);
    await expect(readout.locator('.ro-adr')).toHaveText(/^ADR \d+\.\d%$/);
    expect(await readoutRows(page)).toBeLessThanOrEqual(2);
    await expect(page.locator('.brief-chart-notes')).toContainText('ADR（直近20日の高値÷安値−1の平均）・50日線からの乖離は独自計算です。');
    await expect(page.locator('.brief-legend [data-key="rs"]')).toHaveText('RS線＝株価÷S&P 500・RS推計やIBD RSとは別');
    // A past bar is not judged: no distance and no ADR.
    const box = await page.getByTestId('brief-price-chart').boundingBox();
    await page.mouse.click(box.x + 40, box.y + 120);
    await expect(readout).toHaveAttribute('aria-label', /^選んだ足/);
    await expect(readout.locator('.ro-dist, .ro-adr')).toHaveCount(0);
    expect(await asciiMinus(page)).toEqual([]);
    expect(await collisions(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the zone\'s name takes a candle-free spot along its top on 6か月, and every level line is named', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { charts: withRsLine } });
    await chartReady(page);
    await settled(page);
    const over = await page.getByTestId('brief-price-chart').evaluate(chart => {
      const label = chart.querySelector('.bc-zonetext');
      if (!label) return 'no zone label';
      const box = label.getBBox(), yc = Number(label.getAttribute('y')) - 4;
      const candles = [...chart.querySelectorAll('line.bc-up, line.bc-down, rect.bc-up, rect.bc-down')].map(node => node.getBBox());
      return candles.filter(c => c.x < box.x + box.width && c.x + Math.max(c.width, 1) > box.x && c.y < yc + 7 && c.y + c.height > yc - 7).length;
    });
    expect(over).toBe(0);
    expect(await unnamedLevels(page)).toEqual([]);
    expect(await collisions(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the readout sits beside the periods, so the chart and its volume panel start on the first screen', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV');
    await chartReady(page);
    const periods = await page.getByRole('group', { name: '表示期間' }).boundingBox();
    expect(periods.y + periods.height).toBeLessThanOrEqual(900);
    for (const button of await page.getByRole('group', { name: '表示期間' }).getByRole('button').all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(24);
    // One line under the periods would push the chart about 28px down; beside them the readout takes two
    // rows of 16px within the 32px buttons and costs no height. The volume panel's caption is on screen.
    for (const label of ['3か月', '6か月', '1年', /^週足/]) {
      await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label }).click();
      await chartReady(page);
      expect(await readoutRows(page), String(label)).toBeLessThanOrEqual(2);
      const readout = await page.locator('.brief-readout').boundingBox();
      expect(readout.y).toBeGreaterThanOrEqual(periods.y - 1);
      expect(readout.y + readout.height).toBeLessThanOrEqual(periods.y + periods.height + 1);
    }
    await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: '6か月' }).click();
    await chartReady(page);
    const caption = await page.locator('.bc-volcaption').boundingBox();
    expect(caption.y + caption.height).toBeLessThanOrEqual(900);
    // The pane scrolls on its own; a fade at its bottom says more follows.
    await expect(page.locator('.brief-right')).toHaveAttribute('data-more', '');
    expect(await smallText(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

for (const theme of ['light', 'dark']) test.describe(`the 10-day and 21-day swatches at 1440 in ${theme}`, () => {
  test.use({ ...VIEWPORTS.desktop, contextOptions: { reducedMotion: 'reduce' } });
  test('are the colours of their lines', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { storage: { 'screener:color-mode': theme } });
    await expect(page.locator('.brief')).toHaveAttribute('data-theme', theme);
    await chartReady(page);
    const pairs = await page.evaluate(() => [['ma10', '.bc-ma10'], ['ema21', '.bc-ema21']].map(([key, line]) => {
      const swatch = document.querySelector(`.brief-legend i.lg-${key}`), stroke = document.querySelector(`[data-testid="brief-price-chart"] ${line}`);
      return { key, swatch: swatch && getComputedStyle(swatch).borderTopColor, stroke: stroke && getComputedStyle(stroke).stroke };
    }));
    for (const pair of pairs) {
      expect(pair.swatch, pair.key).toBeTruthy();
      expect(pair.swatch, pair.key).toBe(pair.stroke);
    }
    expect(errors).toEqual([]);
  });
});

for (const theme of ['light', 'dark']) test.describe(`legend in ${theme}`, () => {
  test.use({ ...VIEWPORTS.phone, contextOptions: { reducedMotion: 'reduce' } });
  test('each legend swatch is the colour of its line', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { storage: { 'screener:color-mode': theme } });
    await expect(page.locator('.brief')).toHaveAttribute('data-theme', theme);
    await chartReady(page);
    // Only the items the legend shows (a folded one is keyed in the 注記, not by its swatch).
    const pairs = await page.evaluate(() => [['ma50', '.bc-ma50'], ['ma150', '.bc-ma150'], ['ma200', '.bc-ma200'], ['pivot', '.bc-pivot'], ['stop', '.bc-stop'], ['lows', '.bc-lows'], ['structural', '.bc-structural']].map(([key, line]) => {
      const swatch = document.querySelector(`.brief-legend i.lg-${key}`), stroke = document.querySelector(`[data-testid="brief-price-chart"] ${line}`);
      return { key, shown: Boolean(swatch && !swatch.closest('[hidden]') && swatch.getClientRects().length), swatch: swatch && getComputedStyle(swatch).borderTopColor, stroke: stroke && getComputedStyle(stroke).stroke };
    }));
    expect(pairs.filter(pair => pair.shown).map(pair => pair.key)).toEqual(expect.arrayContaining(['ma50', 'ma150', 'ma200']));
    for (const pair of pairs.filter(p => p.shown)) {
      expect(pair.stroke, pair.key).toBeTruthy();
      expect(pair.swatch, pair.key).toBe(pair.stroke);
    }
    expect(errors).toEqual([]);
  });
});

// The card's 520px cap is tightest at 320 (the readout takes 6 rows there): every view keeps the 12px headroom under it.
test.describe('the chart card at 320×640', () => {
  test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, contextOptions: { reducedMotion: 'reduce' } });
  for (const [symbol, broken] of [['ZZNV', false], ['ZZSD', true]]) test(`${symbol}${broken ? ' (broken)' : ''} stays within 508px (12px under the 520 cap) on every period`, async ({ page }) => {
    const charts = served => { withRsLine(served); if (broken) breakBelow50(served[`${symbol}.json`].bars); };
    const { errors } = await openBrief(page, `#/brief/stock/${symbol}`, { mutate: { charts } });
    await chartReady(page);
    for (const label of ['3か月', '6か月', '1年', /^週足/]) {
      await page.getByRole('group', { name: '表示期間' }).getByRole('button', { name: label }).click();
      await chartReady(page);
      await settled(page);
      expect((await page.locator('.brief-chartcard').boundingBox()).height, `${symbol} ${label}: card height`).toBeLessThanOrEqual(CARD_LINE);
      expect(await legendLines(page), `${symbol} ${label}: legend lines`).toBeLessThanOrEqual(2);
    }
    expect(errors).toEqual([]);
  });
});

for (const width of [320, 375, 414]) test.describe(`no overflow at ${width}px`, () => {
  test.use({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  test('every period of the chart stays within the width', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { mutate: { charts: withRsLine } });
    await chartReady(page);
    for (const button of await page.getByRole('group', { name: '表示期間' }).getByRole('button').all()) {
      await button.click();
      await chartReady(page);
      expect(await horizontalOverflow(page), await button.textContent()).toBe(0);
      expect(await page.locator('.brief-chartcard').evaluate(card => card.scrollWidth - card.clientWidth)).toBeLessThanOrEqual(0);
      // No label runs past its own button either (the week count wraps on the narrowest phones).
      const spill = await page.getByRole('group', { name: '表示期間' }).evaluate(group => [...group.querySelectorAll('button')].filter(b => b.scrollWidth > b.clientWidth).map(b => b.textContent));
      expect(spill, await button.textContent()).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});

// The renderer is a lazy chunk (priceChartLoader.js): when it cannot be loaded (offline before the service worker had it,
// or a deploy replaced it), the chart's box says so with a 再読み込み button, never an empty frame. The browser keeps a
// failed module import for the page's life, so the button reloads the page, which then draws the chart.
test.describe('the chart when its renderer chunk fails to load', () => {
  // Finite animations (the cards' entrance) done, so a box is read where it settles, never mid-rise. Read by play state:
  // with no chart drawn, some entrances' `finished` promises never settle in this browser although they have finished.
  const settled = page => page.waitForFunction(() => document.getAnimations().every(a => a.effect?.getComputedTiming().iterations === Infinity || a.playState !== 'running'));
  test.use(VIEWPORTS.phone);
  test('says it cannot load the chart, keeps the box, offers a 44px reload, and draws after it', async ({ page }) => {
    let blocked = true;
    await page.route(/\/priceChart(-[\w-]+)?\.js(\?.*)?$/, route => (blocked ? route.abort() : route.fallback()));
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV');
    const card = page.locator('.brief-chartcard');
    const failed = card.locator('.brief-chart-failed');
    await expect(failed).toBeVisible();
    // The message is in a live region that was there before it (announced when it arrives); the box shows it with the button.
    await expect(card.getByRole('status')).toHaveText(/チャートを読み込めません/);
    await expect(failed).toContainText('チャートを読み込めません');
    const box = await card.getByTestId('brief-price-chart').boundingBox();
    expect(box.height).toBeGreaterThan(200);
    // Nothing describes marks that are not drawn: no legend, no chart notes in the 注記, and the period switch waits.
    await expect(card.locator('.brief-legend')).toBeHidden();
    for (const button of await card.getByRole('group', { name: '表示期間' }).getByRole('button').all()) await expect(button).toBeDisabled();
    await expect(page.locator('.brief-screen-notes li', { hasText: 'チャートの印' })).toHaveCount(0);
    const retry = failed.getByRole('button');
    await settled(page);
    // The CSS min-height is 44px; 0.1px of tolerance for sub-pixel layout, as Design Acceptance reads it.
    expect((await retry.boundingBox()).height + 0.1).toBeGreaterThanOrEqual(44);
    blocked = false;
    await Promise.all([page.waitForEvent('load'), retry.click()]);
    await expect(card.getByTestId('brief-price-chart')).toBeVisible();
    await expect(failed).toHaveCount(0);
    await expect(card.getByTestId('brief-price-chart').locator('svg').first()).toBeVisible();
    await expect(card.locator('.brief-legend')).toBeVisible();
    await expect(card.getByRole('group', { name: '表示期間' }).getByRole('button').first()).toBeEnabled();
    await expect(page.locator('.brief-screen-notes li', { hasText: 'チャートの印' })).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});
