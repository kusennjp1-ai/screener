// Presentation only. These labels describe exported historical model records;
// they do not evaluate entry readiness or change any model threshold.
// Sources: markets360/signals.py, vcp_footprint.py, risk.py, exit_signals.py.
const SOURCE_LABELS = {
  vcp: '値動きの収縮パターン',
  ma_tight: '10日移動平均線付近の持ち合い',
  vol_contract: '値幅の縮小（ATR）',
};
const STOP_BASIS_LABELS = {
  initial: '初期モデル',
  max_loss_cap: 'モデルの損失率上限を基準',
  base_low: '直近の底値を基準',
  breakeven: 'モデルの基準価格と同水準',
  half_risk: 'モデルの初期リスクを半減する水準',
  lock_1r: 'モデルの初期リスク1倍分を確保する水準',
  trail_50dma: '50日移動平均線を基準',
  trail_20bar_low: '直近20本の安値を基準',
};

const recordLabel = (labels, value) => typeof value === 'string' && Object.hasOwn(labels, value)
  ? labels[value] : '未確認';

export const observedSourceLabel = value => recordLabel(SOURCE_LABELS, value);
export const observedStopBasisLabel = value => recordLabel(STOP_BASIS_LABELS, value);
export const observedSignalLabel = value => value === true ? '有効（記録時点）'
  : value === false ? '無効（記録時点）' : '未確認';

// Keep unknown codes and malformed scalar values inspectable without assigning
// them a known meaning. React renders the resulting text without interpreting it.
export const observationRawValue = value => value === undefined ? '未記録'
  : typeof value === 'object' ? JSON.stringify(value) : String(value);
