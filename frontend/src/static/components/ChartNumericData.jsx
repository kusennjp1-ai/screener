import { useId, useState } from 'react';
import './chartNumericData.css';

const fields = [['open', '始値'], ['high', '高値'], ['low', '安値'], ['close', '終値'], ['volume', '出来高']];
const value = n => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('ja-JP', { maximumFractionDigits: 6 }) : '未確認';

// Presentation only: use the same identity-checked daily payload as the chart.
// The caller keys this view by symbol/publication so a selection cannot leak.
export default function ChartNumericData({ symbol, bars, asOfDate, generatedAt, currency }) {
  const id = useId();
  const [offset, setOffset] = useState(0);
  if (!bars?.length) return null;
  const point = bars[bars.length - 1 - offset];
  return <details className="chart-numeric-data">
    <summary>日足の数値を確認</summary>
    <p>分析基準日 {asOfDate || '未確認'} ／ 配信データ作成日時 {generatedAt || '未確認'}。取得日時・公表日時とは異なります。</p>
    <p>配信された日足から日付を選べます。週足への切替・チャートの表示範囲には連動しません。</p>
    <label htmlFor={id}>{symbol} の日付</label>
    <select id={id} value={offset} onChange={event => setOffset(Number(event.target.value))}>
      {[...bars].reverse().map((bar, index) => <option key={`${bar.date}-${index}`} value={index}>{bar.date}</option>)}
    </select>
    <div aria-live="polite" aria-atomic="true">
      <p>{symbol} ／ 対象日 {point?.date || '未確認'} ／ 価格の通貨 {currency || '未確認'}</p>
      <dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{value(point?.[key])}</dd></div>)}</dl>
    </div>
  </details>;
}
