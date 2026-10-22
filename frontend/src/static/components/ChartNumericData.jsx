import { useId, useMemo, useState } from 'react';
import './chartNumericData.css';

const fields = [['open', '始値'], ['high', '高値'], ['low', '安値'], ['close', '終値'], ['volume', '出来高']];
const valueFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 6 });
const value = n => typeof n === 'number' && Number.isFinite(n) ? valueFormatter.format(n) : '未確認';

// Presentation only: use the same identity-checked daily payload as the chart.
// The caller keys this view by symbol/publication so a selection cannot leak.
export default function ChartNumericData({ symbol, bars, asOfDate, generatedAt, currency }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState({ date: null, resetFrom: null });
  // Sort only the choices, never the payload shared with the canvas. A date
  // remains selected even when the same publication adds/reorders history.
  const choices = useMemo(() => [...(bars || [])].sort((a, b) => b.date.localeCompare(a.date)), [bars]);
  const selected = choices.find(bar => bar.date === selection.date);
  if (selection.date && !selected) {
    // Adjust before committing this render, including empty payloads, so a
    // removed date cannot silently reappear as the selection on a later update.
    setSelection({ date: null, resetFrom: selection.date });
  }
  const point = selected || choices[0];
  if (!point) {
    if (expanded) setExpanded(false);
    return null;
  }
  return <details className="chart-numeric-data" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>日足の数値を確認</summary>
    <p>分析基準日 {asOfDate || '未確認'} ／ 配信データ作成日時 {generatedAt || '未確認'}。取得日時・公表日時とは異なります。</p>
    <p>初期表示は配信内の最新日です。日付を選ぶと、その日を保持します。</p>
    <p>数値は日次チャートと同じ日付の日足データです。週足への切替・チャートの表示範囲には連動しません。</p>
    <label htmlFor={id}>{symbol} の日付</label>
    <select id={id} value={point.date} onChange={event => setSelection({ date: event.target.value, resetFrom: null })}>
      {/* Keep the selected value while closed; mount the full history only when
          its native disclosure opens, rather than hundreds of hidden options. */}
      {(expanded ? choices : [point]).map((bar, index) => <option key={`${bar.date}-${index}`} value={bar.date}>{bar.date}</option>)}
    </select>
    <div aria-live="polite" aria-atomic="true">
      {selection.resetFrom && <p>選択していた {selection.resetFrom} の日足が配信からなくなったため、配信内の最新日 {point.date} に戻しました。</p>}
      <p>{symbol} ／ 対象日 {point?.date || '未確認'} ／ 価格の通貨 {currency || '未確認'}</p>
      <dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value(point?.[key])}</dd></div>)}</dl>
    </div>
  </details>;
}
