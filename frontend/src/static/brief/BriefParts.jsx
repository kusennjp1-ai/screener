import { useLayoutEffect, useRef } from 'react';
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

const chip = (key, tone, children, title, optional = false) => <span key={key} className={`brief-chip${tone ? ` tone-${tone}` : ''}`} title={title} data-optional={optional ? '' : undefined}>{tone === 'ext' && <><span aria-hidden="true">▲</span> </>}{children}</span>;

/**
 * The SEC chip on the rows (data's secRowChip): measured with DT7's documented copy, an always-on chip takes the
 * rows to 3 chip lines (113px) at 320 and 1440 on the fixture, so the rows show it only when it is `notable`
 * (plan RW6); an unknown is explained on the stock view. The chip shows the seam's `short` form when it gives one
 * (the facts without their periods); the full text, with the periods, is the chip's title and in the row's label.
 */
const SEC_CHIP_ALWAYS = false;
// Space every chip line keeps at its end (px): a chip that would leave less gives way, as on a 3rd line.
const CHIP_LINE_SLACK = 6;

/**
 * The optional chips (the SEC chip, the questionable-base chip) give way, last first, when they would take a row's
 * chips past two lines or leave a line less than CHIP_LINE_SLACK at its end; with `keepLines` (Today's focus rows on
 * a phone: five rows under a fixed height budget) also when they would add a line to the row. They stay in the row's label.
 * Only rows that have one are measured.
 */
function fitOptionalChips(row, keepLines = false) {
  const box = row?.querySelector('.brief-reasons'), optional = box ? [...box.querySelectorAll('[data-optional]')] : [];
  if (!optional.length) return;
  // Not laid out (hidden, or no layout engine): nothing to measure.
  if (!box.offsetWidth) { for (const node of optional) node.style.display = ''; return; }
  let without = Infinity;
  if (keepLines) { for (const node of optional) node.style.display = 'none'; without = box.scrollHeight; }
  for (const node of optional) node.style.display = '';
  const shown = () => [...box.children].filter(node => node.style.display !== 'none');
  const fits = () => {
    const chips = shown();
    if (!chips.length) return true;
    const line = Math.min(...chips.map(node => node.offsetHeight)), gap = parseFloat(getComputedStyle(box).rowGap) || 0;
    if (box.scrollHeight > Math.min(line * 2 + gap, without) + 1) return false;
    const right = box.getBoundingClientRect().right, from = chips.findIndex(node => node.hasAttribute('data-optional'));
    // From the first optional chip on, every chip that ends a line leaves the slack.
    return chips.slice(from).every((node, i, rest) => (rest[i + 1] && rest[i + 1].offsetTop === node.offsetTop) || node.getBoundingClientRect().right <= right - CHIP_LINE_SLACK + 0.5);
  };
  for (let i = optional.length - 1; i >= 0 && !fits(); i--) optional[i].style.display = 'none';
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

/** The row's SEC chip (secRowChip) when the rows show it (SEC_CHIP_ALWAYS, else only a notable one), or null. */
function shownSec(view) {
  const sec = secRowChip(view.row);
  return sec && (SEC_CHIP_ALWAYS || sec.notable) ? sec : null;
}

/**
 * `hideTemplate`: Today's focus rows, where every row is qualified and 「TT 8/8」 would be constant. `muted`:
 * the market is not open to new buying. A row that is muted, or not a buy candidate, has no green chip.
 * `now` dates the earnings chip (the days from the later of the analysis date and today).
 */
export function Reasons({ view, now, sell, hideTemplate = false, muted = false }) {
  const zone = tone => (muted || view.qualified === false) && tone === 'zone' ? '' : tone;
  const chips = [<StateChip key="state" view={view} muted={muted} />];
  const sellChip = sellChipView(sell);
  if (sellChip) chips.push(chip('sell', sellChip.tone, sellChip.text, sellChip.title));
  if (!view.missing && !hideTemplate) { const tt = templateChip(view); chips.push(chip('tt', zone(tt.zone ? 'zone' : ''), tt.text)); }
  // A breakout's or a heavy down day's chip already carries its volume ratio (rowEvent): no second chip for it.
  const carried = ['breakout', 'heavyDown'].includes(rowEvent(view)?.kind);
  const volume = carried ? null : volumeTone(view);
  if (volume !== null) chips.push(chip('vol', zone(volume), `出来高 ${ratioShown(view.volumeRatio)}`));
  if (!view.missing?.rs) chips.push(chip('rs', '', `RS推計 ${rsShown(view.rs)}`));
  // The row's SEC earnings, from the data track's seam (secRowChip).
  const sec = shownSec(view);
  if (sec) chips.push(chip('sec', zone(sec.tone), sec.short || sec.text, sec.short && sec.short !== sec.text ? `${sec.text}：${sec.title}` : sec.title, true));
  if (view.rsLineHigh) chips.push(chip('rsl', zone('zone'), 'RS線 新高値'));
  // A questionable base (独自判定): one neutral chip, its rule in the title.
  if (view.baseCaution) chips.push(chip('base', '', view.baseCaution.text, view.baseCaution.title, true));
  const earnings = earningsCall(view, now);
  if (earnings?.soon) chips.push(chip('earn', 'ext', earnings.chip));
  // An あと1条件 row says which rule in one neutral chip, last, so a phone gives it the second line (the full
  // rule and its value are the chip's title and the row's label); for the RS rule it carries the RS value.
  if (view.missing) chips.push(chip('tt', '', view.missing.chip, view.missing.text));
  return <span className="brief-reasons">{chips}</span>;
}

/**
 * `context` carries the screen's market verdict ({ market }): unless it is open to new buying, the row's
 * green chips go neutral (a cap of 0, an unknown state, or no verdict: rows render only once the bundle
 * that carries the verdict has loaded, so a missing one is not still loading and nothing flashes). A broken
 * setup (`sell` with a 50-day hit or the book's combined warning) has no green chip either: its ▲ chip says
 * the buy setup is gone, as the stock conclusion does. `keepLines` (Today's focus rows on a phone, under the
 * screen's height budget): an optional chip (SEC, base) shows only where it fits in the lines the row has without it.
 */
export function CandidateRow({ view, rank, onOpen, now, animate, index = 0, morph = false, sell = null, hideTemplate = false, keepLines = false, context = null }) {
  const enter = useEntrance(animate);
  const sellChip = sellChipView(sell);
  const gate = candidateMarketGate(context?.market);
  const muted = gate !== 'open' || sell?.breakdownHits > 0;
  const sec = shownSec(view);
  const button = useRef(null);
  // After every render: an optional chip that does not fit gives way (it stays in the label below).
  useLayoutEffect(() => fitOptionalChips(button.current, keepLines));
  return <li className={enter ? 'in' : ''} style={{ '--i': index }}>
    <button ref={button} type="button" className={`brief-row${rank ? '' : ' is-unranked'}`} data-symbol={view.symbol} data-testid="brief-candidate" onClick={event => onOpen(view.symbol, event.currentTarget)}
      aria-label={`${rank ? `${rank}位 ` : ''}${view.symbol} ${view.name}、${positionLabel(view)}、${dayChangeText(view)}${view.missing ? `、${view.missing.text}` : ''}、RS推計 ${rsShown(view.rs)}${sec ? `、${sec.text}` : ''}${view.baseCaution ? `、${view.baseCaution.text}（${view.baseCaution.title}）` : ''}${sellChip ? `、${sellChip.text}` : ''}`}>
      <span className="brief-rank" aria-hidden="true">{rank || ''}</span>
      <span className="brief-row-main">
        <span className="brief-row-title"><b style={morph ? { viewTransitionName: 'brief-ticker' } : undefined}>{view.symbol}</b><DayChange view={view} /><span className="brief-row-name">{view.name}{view.sector ? `・${view.sector}` : ''}</span></span>
        <Reasons view={view} now={now} sell={sell} hideTemplate={hideTemplate} muted={muted} />
      </span>
      <MiniMeter distance={view.distance} animate={enter} />
    </button>
  </li>;
}

// The bar is one line on a 320px phone: a price of $1,000 or more drops its cents there (the tiles keep them).
const barPrice = value => finite(value) && Math.abs(value) >= 1000 ? `$${Math.round(value).toLocaleString('en-US')}` : money(value);

/**
 * The stock's quote in the phone's top bar, after the ticker: the price and the verified day change.
 * The change never truncates (brief-decision.css): only the price can, with an ellipsis.
 */
export function BarQuote({ view }) {
  return view?.price != null ? <><span className="numeric brief-bar-price"> {barPrice(view.price)}</span> <DayChange view={view} className="brief-bar-change" /></> : null;
}
