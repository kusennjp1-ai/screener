import { companionState } from '../stockCompanionState';
import './stockCompanion.css';

export default function StockCompanion({ checks, readiness, symbol }) {
  const state = companionState(checks, readiness);
  return <details className="stock-companion" data-mood={state.mood}>
    <summary aria-label={`${symbol} の状態：${state.title}。表情の根拠を表示`}>
      <svg viewBox="0 0 76 64" width="64" height="54" aria-hidden="true" focusable="false">
        <ellipse cx="38" cy="59" rx="23" ry="3" fill="currentColor" opacity=".12" />
        <g className="stock-companion-character">
          <path d="M36 17C28 15 23 7 25 4c8-1 14 5 13 12M39 16C40 7 47 3 54 5c-1 8-7 13-15 13" fill="currentColor" opacity=".72" />
          <path d="M15 36C15 20 26 15 38 15s23 5 23 21v7c0 11-10 15-23 15S15 54 15 43z" fill="var(--companion-fill)" stroke="currentColor" strokeWidth="2" />
          <path d="M16 39l-6 5m51-5 5 5M27 57v3m22-3v3" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          {state.mood === 'bright' ? <path d="M27 32q3-5 6 0m10 0q3-5 6 0" fill="none" stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round" /> : <><circle cx="29" cy="33" r="2.4" fill="var(--text)" /><circle cx="47" cy="33" r="2.4" fill="var(--text)" /></>}
          {state.mood === 'concerned' && <path d="m25 29 8-3m10 0 8 3" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" />}
          <ellipse cx="23" cy="39" rx="4" ry="2.5" fill="var(--neg)" opacity=".24" /><ellipse cx="53" cy="39" rx="4" ry="2.5" fill="var(--neg)" opacity=".24" />
          <path d={state.mood === 'bright' ? 'M32 41q6 8 12 0' : state.mood === 'concerned' ? 'M33 44q5-5 10 0' : state.mood === 'curious' ? 'M36 42q2-3 4 0q-2 4-4 0' : 'M34 43h8'} fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" />
        </g>
      </svg>
      <span><b>{state.title}</b><small>{readiness?.passed ?? 0}/{readiness?.total ?? 0} 条件通過</small></span>
    </summary>
    <p>{state.detail}</p>
  </details>;
}
