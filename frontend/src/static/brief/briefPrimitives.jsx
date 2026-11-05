// The brief's layout primitives, shared by every screen and card. Frozen in round 1 (changed only in
// step 0 or at integration): a change here moves every track's layout and height budgets.
// BriefParts.jsx re-exports them, so the old import path keeps working.
import { useState } from 'react';
import useSessionState from './useSessionState';

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

/**
 * A row's entrance is decided when it mounts: a row that stays while the screen or the data
 * changes never (re)starts it, and a row that mounts with `animate` false never plays it.
 */
// eslint-disable-next-line react-refresh/only-export-components -- CandidateRow (BriefParts.jsx) enters the same way
export const useEntrance = animate => useState(animate)[0];
export function RiseItem({ animate, index = 0, children }) {
  const enter = useEntrance(animate);
  return <li className={enter ? 'in' : ''} style={{ '--i': index }}>{children}</li>;
}

export function Toast({ toast, onUndo }) {
  if (!toast) return null;
  return <div className="brief-toast" role="status" key={toast.id}><span>{toast.text}</span>{onUndo && <button type="button" onClick={onUndo}>元に戻す</button>}</div>;
}
