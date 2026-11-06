import { memo, useLayoutEffect, useRef } from 'react';
import { money, signed } from '../positionGeometry';
import { sellChipView } from './briefSell';
import { meterPercent } from './briefNav';
import { useEntrance } from './briefPrimitives';
import { BREAKOUT_VOLUME_RATIO, candidateMarketGate, earningsCall, positionText, ratioShown, rowEvent, rsShown, templateChip } from './briefCandidate';
import { secRowChip } from '../fundamentalsExplain.js';

// The layout primitives every track uses (Expander, ScreenNotes, Parts, RiseItem, Toast) live in the
// frozen briefPrimitives.jsx; they are re-exported here so the old import path keeps working.
export { Expander, ScreenNotes, Parts, RiseItem, Toast } from './briefPrimitives';

const finite = Number.isFinite;

export function MiniMeter({ distance, animate }) {
  if (!finite(distance)) return <span className="brief-minimeter is-unknown" aria-hidden="true"><span className="brief-minimeter-value">未確認</span></span>;
  return <span className="brief-minimeter" aria-hidden="true">
    <span className="brief-minimeter-track" /><span className="brief-minimeter-zone" /><span className="brief-minimeter-pivot" />
    <span className={`brief-marker${animate ? ' is-entering' : ''}`} style={{ '--p': meterPercent(distance) }} />
    <span className="brief-minimeter-value">{signed(distance)}</span>
  </span>;
}

const POSITION_TONE = { zone: 'zone', near: 'wait', ext: 'ext', staleAbove: 'ext' };

/**
 * The position chip. An unknown pivot distance is said here too, because phones hide the mini meter.
 * The analysis day's event (a breakout, a pivot touch, a crossing without the volume, a heavy down day)
 * takes the chip's place in rowEvent's short form, on every row surface. A stock that is not a buy candidate
 * (not selected by the trend template), or a row under a market that holds off new buying (`muted`), has no
 * green here: the position and a crossing go neutral, a heavy down day keeps its warning.
 */
export function StateChip({ view, muted = false }) {
  const event = rowEvent(view);
  const position = view.position || (view.state === 'wait' ? 'near' : view.state);
  const raw = event ? event.tone : POSITION_TONE[position] || 'neutral';
  const tone = view.qualified === false ? (event?.tone === 'ext' ? 'ext' : 'neutral') : muted && raw === 'zone' ? 'neutral' : raw;
  return <span className={`brief-chip tone-${tone}${tone === 'zone' ? ' is-strong' : ''}`}><span aria-hidden="true">{event ? event.glyph : view.stateGlyph}</span> {event ? event.text : positionText(view)}</span>;
}

/** A row's position for assistive tech: the day's event with the position after it, or the position alone. */
const positionLabel = view => { const event = rowEvent(view); return event ? `${event.text}（${positionText(view)}）` : positionText(view); };

/** The day's change from the verified previous close (technical_audit for the analysis date), or — with its reason. */
export function DayChange({ view, className = '' }) {
  const change = finite(view?.change) ? view.change : null;
  if (change === null) return <span className={`brief-daychg${className ? ` ${className}` : ''}`}><span aria-hidden="true">—</span><span className="sr-only">前日比 未確認</span></span>;
  return <span className={`numeric brief-daychg${change > 0 ? ' is-up' : change < 0 ? ' is-down' : ''}${className ? ` ${className}` : ''}`}><span className="sr-only">前日比 </span>{signed(change)}</span>;
}
const dayChangeText = view => finite(view?.change) ? `前日比 ${signed(view.change)}` : '前日比 未確認';

// `drop`: an optional chip's order of giving way (1 first), see fitLater.
const chip = (key, tone, children, title, drop) => <span key={key} className={`brief-chip${tone ? ` tone-${tone}` : ''}`} title={title} data-optional={drop}>{tone === 'ext' && <><span aria-hidden="true">▲</span> </>}{children}</span>;

/*
 * The optional chips (the SEC chip, which gives way first, then the questionable base) give way when they would take
 * a row's chips past two lines; with `keepLines` (Today's focus rows on a phone: five rows under a fixed height
 * budget) when they would add a line to the row. They stay in the row's label. Every chip line keeps 6px at its end
 * by the chip box's padding (brief-watch.css), so a line that fits keeps the slack.
 * The rows of one commit are fitted together, before the paint: each row with an optional chip queues its chip box,
 * and one microtask shows every optional chip, reads every box, hides what does not fit and reads again only the
 * boxes it changed (a few layouts for the whole list, never one per row). A box whose width changes (a resize) and
 * fonts that finish loading are fitted again.
 */
const fitted = new Map(), queued = new Set(), widths = new WeakMap();
let resized = null;
function fitLater(box) {
  if (!queued.size) queueMicrotask(fitQueued);
  queued.add(box);
}
function watchChips(box, keepLines) {
  fitted.set(box, keepLines);
  if (!resized && typeof ResizeObserver === 'function') {
    resized = new ResizeObserver(entries => { for (const { target } of entries) if (fitted.has(target) && widths.get(target) !== target.offsetWidth) fitLater(target); });
    document.fonts?.addEventListener?.('loadingdone', () => fitted.forEach((_, box) => fitLater(box)));
  }
  resized?.observe(box);
  fitLater(box);
}
function unwatchChips(box) { fitted.delete(box); queued.delete(box); resized?.unobserve(box); }
const shownChips = box => [...box.children].filter(node => node.style.display !== 'none');
const overLines = ({ box, limit }) => {
  const chips = shownChips(box);
  if (!chips.length) return false;
  const line = Math.min(...chips.map(node => node.offsetHeight)), gap = parseFloat(getComputedStyle(box).rowGap) || 0;
  return box.scrollHeight > Math.min(line * 2 + gap, limit) + 1;
};
function fitQueued() {
  const jobs = [];
  for (const box of queued) {
    const optional = box.isConnected ? [...box.querySelectorAll('[data-optional]')].sort((a, b) => a.dataset.optional - b.dataset.optional) : [];
    const keep = fitted.get(box);
    // Shown, or for `keepLines` hidden first to read the row's lines without them.
    for (const node of optional) node.style.display = keep ? 'none' : '';
    if (optional.length) jobs.push({ box, optional, keep, limit: Infinity });
  }
  queued.clear();
  // One read for every box (a box not laid out, hidden or without a layout engine, is left as it is).
  let open = jobs.filter(job => { const width = job.box.offsetWidth; widths.set(job.box, width); if (job.keep) job.limit = job.box.scrollHeight; return width > 0; });
  for (const job of jobs) if (job.keep || !open.includes(job)) for (const node of job.optional) node.style.display = '';
  while (open.length) {
    const over = open.filter(overLines);
    open = over.filter(job => {
      const next = job.optional.find(node => node.style.display !== 'none');
      next.style.display = 'none';
      return job.optional.some(node => node.style.display !== 'none');
    });
  }
}

/**
 * The volume chip's tone: green only on a verified up day, ▲ on a down day with heavy volume (a warning, as
 * breakoutEvent's 下落日の大商い), neutral when the day's direction is not verified. Null below BREAKOUT_VOLUME_RATIO.
 */
function volumeTone(view) {
  if (!finite(view.volumeRatio) || view.volumeRatio < BREAKOUT_VOLUME_RATIO) return null;
  if (finite(view.change) && view.change < 0) return 'ext';
  return finite(view.change) && view.change > 0 ? 'zone' : '';
}

/**
 * The row's SEC chip (data's secRowChip) when the rows show it: only a `notable` one (plan RW6: an always-on chip
 * took the rows to 3 chip lines at 320 and 1440 on the fixture); an unknown is explained on the stock view. The chip
 * shows the seam's `short` form when it gives one; the full text is its title and in the row's label. `now` dates it,
 * as the stock view does (data's secRowChip), so a summary past the 180-day rule is not shown as current.
 */
function shownSec(view, now = null) {
  // Dated like the stock view: a summary past the 180-day rule reads 古い (an unknown chip), never as current.
  const sec = secRowChip(view.row, { now });
  return sec?.notable ? sec : null;
}

/**
 * The row's caution on a phone's Today (`compact`): the questionable base, else a notable SEC chip on a falling EPS
 * (the SEC summary's EPS change, view.epsYoy, below 0). It takes the RS chip's place there in its short form
 * (「土台−40%」, 「EPS −35%」; RS stays in the row's label and on the stock view), so a focus row says it without a
 * line more; the full text is its title.
 */
function cautionOf(view, sec) {
  const base = view.baseCaution;
  if (base) return { key: 'base', text: base.short || base.text, title: `${base.text}：${base.title}` };
  return sec && finite(view.epsYoy) && view.epsYoy < 0 ? { key: 'sec', text: sec.short || `EPS ${signed(view.epsYoy, 0)}`, title: `${sec.text}：${sec.title}` } : null;
}

/**
 * `hideTemplate`: rows that are all TT 8/8 (Today's focus rows, the qualified lists), where 「TT 8/8」 would be
 * constant. `muted`: the market is not open to new buying. A row that is muted, or not a buy candidate, has no green
 * chip. `now` dates the earnings chip (the days from the later of the analysis date and today). `compact` (a phone's
 * Today): a caution (cautionOf) takes the RS chip's place.
 */
export function Reasons({ view, now, sell, hideTemplate = false, muted = false, compact = false }) {
  const zone = tone => (muted || view.qualified === false) && tone === 'zone' ? '' : tone;
  const chips = [<StateChip key="state" view={view} muted={muted} />];
  const sellChip = sellChipView(sell);
  if (sellChip) chips.push(chip('sell', sellChip.tone, sellChip.text, sellChip.title));
  if (!view.missing && !hideTemplate) { const tt = templateChip(view); chips.push(chip('tt', zone(tt.zone ? 'zone' : ''), tt.text)); }
  // A breakout's or a heavy down day's chip already carries its volume ratio (rowEvent): no second chip for it.
  const carried = ['breakout', 'heavyDown'].includes(rowEvent(view)?.kind);
  const volume = carried ? null : volumeTone(view);
  if (volume !== null) chips.push(chip('vol', zone(volume), `出来高 ${ratioShown(view.volumeRatio)}`));
  // The row's SEC earnings, from the data track's seam (secRowChip).
  const sec = shownSec(view, now), caution = compact ? cautionOf(view, sec) : null;
  if (caution) chips.push(chip(caution.key, '', caution.text, caution.title));
  else if (!view.missing?.rs) chips.push(chip('rs', '', `RS推計 ${rsShown(view.rs)}`));
  const secTitle = sec && (sec.short && sec.short !== sec.text ? `${sec.text}：${sec.title}` : sec.title);
  if (sec && caution?.key !== 'sec') chips.push(chip('sec', zone(sec.tone), sec.short || sec.text, secTitle, 1));
  if (view.rsLineHigh) chips.push(chip('rsl', zone('zone'), 'RS線 新高値'));
  // A questionable base (独自判定): one neutral chip, its rule in the title; it gives way after the SEC chip.
  if (view.baseCaution && caution?.key !== 'base') chips.push(chip('base', '', view.baseCaution.text, view.baseCaution.title, 2));
  const earnings = earningsCall(view, now);
  if (earnings?.soon) chips.push(chip('earn', 'ext', earnings.chip));
  // An あと1条件 row says which rule in one neutral chip, last, so a phone gives it the second line (the full
  // rule and its value are the chip's title and the row's label); for the RS rule it carries the RS value.
  if (view.missing) chips.push(chip('tt', '', view.missing.chip, view.missing.text));
  return <span className="brief-reasons">{chips}</span>;
}

/**
 * `market` is the screen's market verdict (prepared.market): unless it is open to new buying, the row's green
 * chips go neutral (a cap of 0, an unknown state, or no verdict: rows render only once the bundle that carries
 * the verdict has loaded, so a missing one is not still loading and nothing flashes). A broken setup (`sell` with
 * a 50-day hit or the book's combined warning) has no green chip either: its ▲ chip says the buy setup is gone, as
 * the stock conclusion does. `compact` (Today's focus rows on a phone, under the screen's height budget): a caution
 * takes the RS chip's place (Reasons), and the other optional chips show only where they add no line.
 * Memoized: a list that re-renders (its rows after the first screen arriving) leaves the rows it had alone.
 */
export const CandidateRow = memo(function CandidateRow({ view, rank, onOpen, now, animate, index = 0, morph = false, sell = null, hideTemplate = false, compact = false, market = null }) {
  const enter = useEntrance(animate);
  const sellChip = sellChipView(sell);
  const muted = candidateMarketGate(market) !== 'open' || sell?.breakdownHits > 0;
  const sec = shownSec(view, now);
  const button = useRef(null);
  // An optional chip that does not fit gives way (it stays in the label below): the list's rows are fitted together.
  useLayoutEffect(() => {
    const box = button.current?.querySelector('.brief-reasons');
    if (!box?.querySelector('[data-optional]')) return undefined;
    watchChips(box, compact);
    return () => unwatchChips(box);
  }, [view, sell, hideTemplate, compact, market, now]);
  return <li className={enter ? 'in' : ''} style={{ '--i': index }}>
    <button ref={button} type="button" className={`brief-row${rank ? '' : ' is-unranked'}`} data-symbol={view.symbol} data-testid="brief-candidate" onClick={event => onOpen(view.symbol, event.currentTarget)}
      aria-label={`${rank ? `${rank}位 ` : ''}${view.symbol} ${view.name}、${positionLabel(view)}、${dayChangeText(view)}${view.missing ? `、${view.missing.text}` : ''}、RS推計 ${rsShown(view.rs)}${sec ? `、${sec.text}` : ''}${view.baseCaution ? `、${view.baseCaution.text}（${view.baseCaution.title}）` : ''}${sellChip ? `、${sellChip.text}` : ''}`}>
      <span className="brief-rank" aria-hidden="true">{rank || ''}</span>
      <span className="brief-row-main">
        <span className="brief-row-title"><b style={morph ? { viewTransitionName: 'brief-ticker' } : undefined}>{view.symbol}</b><DayChange view={view} /><span className="brief-row-name">{view.name}{view.sector ? `・${view.sector}` : ''}</span></span>
        <Reasons view={view} now={now} sell={sell} hideTemplate={hideTemplate} muted={muted} compact={compact} />
      </span>
      <MiniMeter distance={view.distance} animate={enter} />
    </button>
  </li>;
});

// The bar is one line on a 320px phone: a price of $1,000 or more drops its cents there (the tiles keep them).
const barPrice = value => finite(value) && Math.abs(value) >= 1000 ? `$${Math.round(value).toLocaleString('en-US')}` : money(value);

/**
 * The stock's quote in the phone's top bar, after the ticker: the price and the verified day change.
 * The change never truncates (brief-decision.css): only the price can, with an ellipsis.
 */
export function BarQuote({ view }) {
  return view?.price != null ? <><span className="numeric brief-bar-price"> {barPrice(view.price)}</span> <DayChange view={view} className="brief-bar-change" /></> : null;
}
