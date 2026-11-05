import { useState } from 'react';
import { money, signed, times } from '../positionGeometry';
import { sellChipView } from './briefSell';
import { meterPercent } from './briefNav';
import useSessionState from './useSessionState';

const finite = Number.isFinite;

/**
 * A secondary block folded into a one-line summary that opens in place (native details: Enter/Space
 * on the summary, find-in-page opens it). The summary says what is inside; the open state is kept
 * per session under `id`. The content stays in the document while closed. The chevron is drawn by CSS
 * (no text of its own), so the summary and the content read as one sentence.
 */
export function Expander({ id, summary, children, className = '', defaultOpen = false }) {
  const [open, setOpen] = useSessionState(id, defaultOpen);
  return <details className={`brief-expander${className ? ` ${className}` : ''}`} open={open} onToggle={event => { if (event.currentTarget.open !== open) setOpen(event.currentTarget.open); }}>
    <summary><span className="brief-expander-summary">{summary}</span></summary>
    <div className="brief-expander-body">{children}</div>
  </details>;
}

/**
 * One 注記 per screen below 1024px: the methodology footnotes of every card, folded in one place at the
 * end of the screen. At 1024px and wider (`wide`) height is not the problem, so each card keeps its own
 * footnote in place, open, and there is no 注記.
 */
export function ScreenNotes({ id, notes, wide = false }) {
  const list = (notes || []).filter(Boolean);
  if (wide || !list.length) return null;
  return <Expander id={`notes-${id}`} className="brief-screen-notes" summary={<>注記<small>（計算方法・出典 {list.length}件）</small></>}>
    <ul>{list.map(note => <li key={typeof note === 'string' ? note : note.key}>{typeof note === 'string' ? note : note.text}</li>)}</ul>
  </Expander>;
}
/** A short phrase that wraps only between its 「・」 parts on a phone (「買い可・最大50%」 never splits 「50%」 off). */
export function Parts({ text }) {
  if (!text) return null;
  const parts = String(text).split('・');
  return parts.map((part, i) => <span key={i} className="brief-frag">{part}{i < parts.length - 1 ? '・' : ''}</span>);
}

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

/**
 * A row's entrance is decided when it mounts: a row that stays while the screen or the data
 * changes never (re)starts it, and a row that mounts with `animate` false never plays it.
 */
const useEntrance = animate => useState(animate)[0];
export function RiseItem({ animate, index = 0, children }) {
  const enter = useEntrance(animate);
  return <li className={enter ? 'in' : ''} style={{ '--i': index }}>{children}</li>;
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

export function Toast({ toast, onUndo }) {
  if (!toast) return null;
  return <div className="brief-toast" role="status" key={toast.id}><span>{toast.text}</span>{onUndo && <button type="button" onClick={onUndo}>元に戻す</button>}</div>;
}
