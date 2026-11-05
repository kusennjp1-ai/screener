import { money, signed, times } from '../positionGeometry';
import { sellChipView } from './briefSell';
import { meterPercent } from './briefNav';
import { useEntrance } from './briefPrimitives';
import { BREAKOUT_VOLUME_RATIO, candidateMarketGate, earningsSoon, rsShown } from './briefCandidate';

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
 * A stock that is not a buy candidate (not selected by the trend template), or a row under a market
 * that holds off new buying (`muted`), keeps its position in a neutral tone.
 */
export function StateChip({ view, muted = false }) {
  const position = view.position || (view.state === 'wait' ? 'near' : view.state);
  const raw = POSITION_TONE[position] || 'neutral';
  const tone = view.qualified === false || (muted && raw === 'zone') ? 'neutral' : raw;
  const where = view.stale ? '' : finite(view.distance) ? ` ${signed(view.distance)}` : '・ピボット比 未確認';
  return <span className={`brief-chip tone-${tone}${tone === 'zone' ? ' is-strong' : ''}`}><span aria-hidden="true">{view.stateGlyph}</span> {view.stateLabel}{where}</span>;
}

/** The day's change from the verified previous close (technical_audit for the analysis date), or — with its reason. */
export function DayChange({ view, className = '' }) {
  const change = finite(view?.change) ? view.change : null;
  if (change === null) return <span className={`brief-daychg${className ? ` ${className}` : ''}`}><span aria-hidden="true">—</span><span className="sr-only">前日比 未確認</span></span>;
  return <span className={`numeric brief-daychg${change > 0 ? ' is-up' : change < 0 ? ' is-down' : ''}${className ? ` ${className}` : ''}`}><span className="sr-only">前日比 </span>{signed(change)}</span>;
}
const dayChangeText = view => finite(view?.change) ? `前日比 ${signed(view.change)}` : '前日比 未確認';

const chip = (key, tone, children, title) => <span key={key} className={`brief-chip${tone ? ` tone-${tone}` : ''}`} title={title}>{tone === 'ext' && <><span aria-hidden="true">▲</span> </>}{children}</span>;

/**
 * The volume chip's tone: green only on a verified up day, ▲ on a down day with heavy volume (a warning, as
 * breakoutEvent's 下落日の大商い), neutral when the day's direction is not verified. Null below BREAKOUT_VOLUME_RATIO.
 */
function volumeTone(view) {
  if (!finite(view.volumeRatio) || view.volumeRatio < BREAKOUT_VOLUME_RATIO) return null;
  if (finite(view.change) && view.change < 0) return 'ext';
  return finite(view.change) && view.change > 0 ? 'zone' : '';
}

/** `hideTemplate`: Today's focus rows, where every row is qualified and 「TT 8/8」 would be constant. `muted`: the market holds off new buying. */
export function Reasons({ view, now, sell, hideTemplate = false, muted = false }) {
  void now;
  const zone = tone => muted && tone === 'zone' ? '' : tone;
  const chips = [<StateChip key="state" view={view} muted={muted} />];
  const sellChip = sellChipView(sell);
  if (sellChip) chips.push(chip('sell', sellChip.tone, sellChip.text, sellChip.title));
  if (!hideTemplate) chips.push(chip('tt', zone(view.qualified ? 'zone' : ''), view.qualified ? 'TT 8/8' : Number.isInteger(view.failed) ? `あと${view.failed}条件${view.unknown ? `・未確認${view.unknown}` : ''}` : '条件 未確認'));
  // An あと1条件 row names its unmet rule (neutral); when that rule is the RS estimate's, this chip carries the RS value.
  if (view.missing) chips.push(chip('missing', '', view.missing.text));
  const volume = volumeTone(view);
  if (volume !== null) chips.push(chip('vol', zone(volume), `出来高 ${times(view.volumeRatio)}`));
  if (!view.missing?.rs) chips.push(chip('rs', '', `RS推計 ${rsShown(view.rs)}`));
  if (view.rsLineHigh) chips.push(chip('rsl', zone('zone'), 'RS線 新高値'));
  if (earningsSoon(view)) chips.push(chip('earn', 'ext', `決算 ${view.earnings.days}日後`));
  return <span className="brief-reasons">{chips}</span>;
}

/**
 * `context` carries the screen's market verdict ({ market }): while it holds off new buying (a known
 * state with a cap of 0) or is unknown, the row's green chips go neutral. No verdict: as before.
 */
export function CandidateRow({ view, rank, onOpen, now, animate, index = 0, morph = false, sell = null, hideTemplate = false, context = null }) {
  const enter = useEntrance(animate);
  const sellChip = sellChipView(sell);
  const gate = candidateMarketGate(context?.market);
  const muted = gate === 'hold' || gate === 'unknown';
  return <li className={enter ? 'in' : ''} style={{ '--i': index }}>
    <button type="button" className={`brief-row${rank ? '' : ' is-unranked'}`} data-symbol={view.symbol} data-testid="brief-candidate" onClick={event => onOpen(view.symbol, event.currentTarget)}
      aria-label={`${rank ? `${rank}位 ` : ''}${view.symbol} ${view.name}、${view.stateLabel}${!view.stale && finite(view.distance) ? ` ${signed(view.distance)}` : ''}、${dayChangeText(view)}、RS推計 ${rsShown(view.rs)}${sellChip ? `、${sellChip.text}` : ''}`}>
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
