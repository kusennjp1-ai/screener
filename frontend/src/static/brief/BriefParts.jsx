import { memo, useLayoutEffect, useRef } from 'react';
import { money, signed } from '../positionGeometry';
import { sellChipView } from './briefSell';
import { meterPercent } from './briefNav';
import { useEntrance } from './briefPrimitives';
import { BASE_UNCHECKED_CHIP, baseMuted, BREAKOUT_VOLUME_RATIO, candidateMarketGate, distanceText, earningsCall, pivotDistanceText, positionText, ratioShown, rowBaseHeld, rowEvent, rowSecChip, rowSecChipDrawn, rsShown, templateChip } from './briefCandidate';

// The layout primitives every track uses (Expander, ScreenNotes, Parts, RiseItem, Toast) live in the
// frozen briefPrimitives.jsx; they are re-exported here so the old import path keeps working.
export { Expander, ScreenNotes, Parts, RiseItem, Toast } from './briefPrimitives';

const finite = Number.isFinite;

export function MiniMeter({ distance, text = distanceText(distance), animate }) {
  if (!finite(distance)) return <span className="brief-minimeter is-unknown" aria-hidden="true"><span className="brief-minimeter-value">未確認</span></span>;
  return <span className="brief-minimeter" aria-hidden="true">
    <span className="brief-minimeter-track" /><span className="brief-minimeter-zone" /><span className="brief-minimeter-pivot" />
    <span className={`brief-marker${animate ? ' is-entering' : ''}`} style={{ '--p': meterPercent(distance) }} />
    <span className="brief-minimeter-value">{text}</span>
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
 * a row's chips past two lines; with `keepLines` (Today's focus rows and the watch tab's rows on a phone, under fixed
 * height budgets) when they would add a line to the row (a compact row draws no notable rise in EPS at all:
 * rowSecChipDrawn). They stay in the row's label. Every chip line keeps 6px at its end
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
 * The row's SEC chip (data's secRowChip, through briefCandidate's rowSecChip) when the rows show it: only a `notable`
 * one (plan RW6: an always-on chip took the rows to 3 chip lines at 320 and 1440 on the fixture); an unknown is
 * explained on the stock view. The chip shows the seam's `short` form when it gives one; the full text is its title and
 * in the row's label. The analysis date and the clock the EPS filter reads (the view's) date it, so a summary past the
 * 180-day rule or of another day is not shown as current, and a row with a chip is a row the filter counts.
 */
const shownSec = view => rowSecChip(view);

/**
 * A grey row for a Setup Engine base that is not current in the zone or near the pivot (baseMuted): it says so in the
 * RS chip's place (「土台未確認」, the conclusion's reason in its title; RS stays in the row's label and on the stock view),
 * so a grey row is never unexplained and no row gets a line more. Not for a stock that is not a buy candidate (its
 * TT chip says why) or a broken setup (its 崩れ chip leads, as the conclusion's call does).
 */
const baseHeld = (view, sellChip) => rowBaseHeld(view, sellChip?.tone ?? null);
/** Whether the volume chip shows (volumeTone, and no event chip already carries the ratio). */
const volumeShown = view => volumeTone(view) !== null && !['breakout', 'heavyDown'].includes(rowEvent(view)?.kind);

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
 * Today and watch tab): a caution (cautionOf) takes the RS chip's place, a notable rise in EPS is not drawn (rowSecChipDrawn),
 * and the RS chip, then a passed template's 「TT 8/8」, give way after the other optional chips rather than add a line (all
 * stay in the row's label). A grey row
 * for a base that is not current says 土台未確認 in the RS chip's place on every row surface (baseHeld).
 */
export function Reasons({ view, now, sell, hideTemplate = false, muted = false, compact = false }) {
  const zone = tone => (muted || view.qualified === false) && tone === 'zone' ? '' : tone;
  const chips = [<StateChip key="state" view={view} muted={muted} />];
  const sellChip = sellChipView(sell);
  if (sellChip) chips.push(chip('sell', sellChip.tone, sellChip.text, sellChip.title));
  // A broken setup on a phone's Today (compact): its ▲ chip takes the volume and RS chips' place (both stay in the row's
  // label and on the stock view), so a watched focus row says 崩れ without a line more under Today's height budget.
  const brokenCompact = compact && sellChip?.tone === 'ext';
  // On a compact row (a phone's watch tab) a passed template's 「TT 8/8」 gives way last, after RS, only where a caution
  // fills the line (it stays in the row's label); a template that did not pass always says so.
  if (!view.missing && !hideTemplate) { const tt = templateChip(view); chips.push(chip('tt', zone(tt.zone ? 'zone' : ''), tt.text, undefined, compact && tt.zone ? 4 : undefined)); }
  // A breakout's or a heavy down day's chip already carries its volume ratio (rowEvent): no second chip for it.
  if (volumeShown(view) && !brokenCompact) chips.push(chip('vol', zone(volumeTone(view)), `出来高 ${ratioShown(view.volumeRatio)}`));
  // The row's SEC earnings, from the data track's seam (secRowChip).
  const sec = shownSec(view);
  const caution = baseHeld(view, sellChip) ? { key: 'base-unchecked', text: BASE_UNCHECKED_CHIP, title: view.baseNote || undefined } : compact ? cautionOf(view, sec) : null;
  if (caution) chips.push(chip(caution.key, '', caution.text, caution.title));
  else if (!view.missing?.rs && !brokenCompact) chips.push(chip('rs', '', `RS推計 ${rsShown(view.rs)}`, undefined, compact ? 3 : undefined));
  const secTitle = sec && (sec.short && sec.short !== sec.text ? `${sec.text}：${sec.title}` : sec.title);
  // A compact row draws only a falling EPS, as its caution above (rowSecChipDrawn, which the screens' 注記 read): a notable
  // rise never fits beside the day's chips there, and it stays in the row's label.
  if (sec && caution?.key !== 'sec' && rowSecChipDrawn(view, { compact, sellTone: sellChip?.tone ?? null })) chips.push(chip('sec', zone(sec.tone), sec.short || sec.text, secTitle, 1));
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
 * a 50-day hit, a failed breakout or the book's combined warning) has no green chip either: its ▲ chip says the buy
 * setup is gone, as the stock conclusion does. Nor does a row whose Setup Engine base is not current or under the
 * confidence floor (view.baseCurrent false: the conclusion reads 土台を確認できない — ピボットは参考 for it), with
 * no change to the row's place, the order or the counts. `compact` (Today's focus rows and the watch tab's rows on a phone, under the
 * screens' height budgets): a caution takes the RS chip's place (Reasons), and the other optional chips show only where they add no line.
 * Memoized: a list that re-renders (its rows after the first screen arriving) leaves the rows it had alone.
 */
export const CandidateRow = memo(function CandidateRow({ view, rank, onOpen, now, animate, index = 0, morph = false, sell = null, pending = false, hideTemplate = false, compact = false, market = null }) {
  const enter = useEntrance(animate);
  const sellChip = sellChipView(sell);
  // `pending`: a watched row whose sell checks are still loading holds its green (no chip, no layout change), so a broken
  // setup never shows green first and then flips to 崩れ.
  const muted = candidateMarketGate(market) !== 'open' || sell?.breakdownHits > 0 || baseMuted(view) || pending;
  const sec = shownSec(view);
  // The label says what the screen dropped or put in a chip's place: the volume a broken compact row gives way (only
  // where its chip would show), and the base word with its reason.
  const volumeDropped = compact && sellChip?.tone === 'ext' && volumeShown(view);
  const based = baseHeld(view, sellChip);
  const button = useRef(null);
  // An optional chip that does not fit gives way (it stays in the label below): the list's rows are fitted together.
  useLayoutEffect(() => {
    const box = button.current?.querySelector('.brief-reasons');
    if (!box?.querySelector('[data-optional]')) return undefined;
    watchChips(box, compact);
    return () => unwatchChips(box);
  }, [view, sell, pending, hideTemplate, compact, market, now]);
  return <li className={enter ? 'in' : ''} style={{ '--i': index }}>
    <button ref={button} type="button" className={`brief-row${rank ? '' : ' is-unranked'}`} data-symbol={view.symbol} data-testid="brief-candidate" onClick={event => onOpen(view.symbol, event.currentTarget)}
      aria-label={`${rank ? `${rank}位 ` : ''}${view.symbol} ${view.name}、${positionLabel(view)}、${dayChangeText(view)}${volumeDropped ? `、出来高 ${ratioShown(view.volumeRatio)}` : ''}${view.missing ? `、${view.missing.text}` : ''}${compact && !hideTemplate && view.qualified ? '、TT 8/8' : ''}、RS推計 ${rsShown(view.rs)}${based ? `、${BASE_UNCHECKED_CHIP}${view.baseNote ? `（${view.baseNote}）` : ''}` : ''}${sec ? `、${sec.text}` : ''}${view.baseCaution ? `、${view.baseCaution.text}（${view.baseCaution.title}）` : ''}${sellChip ? `、${sellChip.text}` : pending ? '、売りのサイン 確認中' : ''}`}>
      <span className="brief-rank" aria-hidden="true">{rank || ''}</span>
      <span className="brief-row-main">
        <span className="brief-row-title"><b style={morph ? { viewTransitionName: 'brief-ticker' } : undefined}>{view.symbol}</b><DayChange view={view} /><span className="brief-row-name">{view.name}{view.sector ? `・${view.sector}` : ''}</span></span>
        <Reasons view={view} now={now} sell={sell} hideTemplate={hideTemplate} muted={muted} compact={compact} />
      </span>
      <MiniMeter distance={view.distance} text={pivotDistanceText(view)} animate={enter} />
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
