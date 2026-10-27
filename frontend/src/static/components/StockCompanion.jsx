import { companionState } from '../stockCompanionState';
import './stockCompanion.css';
import portrait from '../../assets/minervini-inspired-moods-v1.webp';

export default function StockCompanion({ checks, readiness, symbol }) {
  const state = companionState(checks, readiness);
  return <details className="stock-companion" data-mood={state.mood}>
    <summary aria-label={`${symbol} の状態：${state.title}。表情の根拠を表示`}>
      <span className="stock-companion-character" aria-hidden="true" style={{backgroundImage:`url(${portrait})`}} />
      <span className="stock-companion-caption"><b>{state.title}</b><small>{readiness?.passed ?? 0}/{readiness?.total ?? 0} 条件通過</small></span>
    </summary>
    <p>{state.detail} 写真を参考にしたキャラクターで、本人の推奨を示すものではありません。</p>
  </details>;
}
