import { money, signed, times } from '../positionGeometry';
import { sellChipView } from './briefSell';
import { meterPercent } from './briefNav';
import { useEntrance } from './briefPrimitives';

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

/** The position chip. An unknown pivot distance is said here too, because phones hide the mini meter. */
export function StateChip({ view }) {
  const tone = view.state === 'zone' ? 'zone' : view.state === 'wait' ? 'wait' : view.state === 'ext' ? 'ext' : 'neutral';
  return <span className={`brief-chip tone-${tone}${view.state === 'zone' ? ' is-strong' : ''}`}><span aria-hidden="true">{view.stateGlyph}</span> {view.stateLabel}{finite(view.distance) ? ` ${signed(view.distance)}` : '・ピボット比 未確認'}</span>;
}

/** `hideTemplate`: Today's focus rows, where every row is qualified and 「TT 8/8」 would be constant. */
export function Reasons({ view, now, sell, hideTemplate = false }) {
  void now;
  const chips = [<StateChip key="state" view={view} />];
  const sellChip = sellChipView(sell);
  if (sellChip) chips.push(<span key="sell" className={`brief-chip${sellChip.tone ? ` tone-${sellChip.tone}` : ''}`} title={sellChip.title}>{sellChip.tone === 'ext' && <><span aria-hidden="true">▲</span> </>}{sellChip.text}</span>);
  if (!hideTemplate) chips.push(<span key="tt" className={`brief-chip${view.qualified ? ' tone-zone' : ''}`}>{view.qualified ? 'TT 8/8' : Number.isInteger(view.failed) ? `あと${view.failed}条件${view.unknown ? `・未確認${view.unknown}` : ''}` : '条件 未確認'}</span>);
  if (finite(view.volumeRatio) && view.volumeRatio >= 1.4) chips.push(<span key="vol" className="brief-chip tone-zone">出来高 {times(view.volumeRatio)}</span>);
  chips.push(<span key="rs" className="brief-chip">RS推計 {finite(view.rs) ? view.rs : '未確認'}</span>);
  if (view.rsLineHigh) chips.push(<span key="rsl" className="brief-chip tone-zone">RS線 新高値</span>);
  if (view.earnings && view.earnings.days <= 10) chips.push(<span key="earn" className="brief-chip tone-ext"><span aria-hidden="true">▲</span> 決算 {view.earnings.days}日後</span>);
  return <span className="brief-reasons">{chips}</span>;
}


/** `context` carries the screen's market verdict ({ market }); step 0 does not read it. */
export function CandidateRow({ view, rank, onOpen, now, animate, index = 0, morph = false, sell = null, hideTemplate = false, context = null }) {
  void context;
  const enter = useEntrance(animate);
  const sellChip = sellChipView(sell);
  return <li className={enter ? 'in' : ''} style={{ '--i': index }}>
    <button type="button" className={`brief-row${rank ? '' : ' is-unranked'}`} data-symbol={view.symbol} data-testid="brief-candidate" onClick={event => onOpen(view.symbol, event.currentTarget)}
      aria-label={`${rank ? `${rank}位 ` : ''}${view.symbol} ${view.name}、${view.stateLabel}${finite(view.distance) ? ` ${signed(view.distance)}` : ''}、RS推計 ${finite(view.rs) ? view.rs : '未確認'}${sellChip ? `、${sellChip.text}` : ''}`}>
      <span className="brief-rank" aria-hidden="true">{rank || ''}</span>
      <span className="brief-row-main">
        <span className="brief-row-title"><b style={morph ? { viewTransitionName: 'brief-ticker' } : undefined}>{view.symbol}</b><span>{view.name}{view.sector ? `・${view.sector}` : ''}</span></span>
        <Reasons view={view} now={now} sell={sell} hideTemplate={hideTemplate} />
      </span>
      <MiniMeter distance={view.distance} animate={enter} />
    </button>
  </li>;
}

/** The stock's quote in the phone's top bar, after the ticker (step 0: the price). */
export function BarQuote({ view }) {
  return view?.price != null ? <span className="numeric brief-bar-price"> {money(view.price)}</span> : null;
}
