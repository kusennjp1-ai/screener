import './indicatorHistory.css';
import { useTheme } from '@mui/material/styles';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
const display = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ja-JP', { maximumFractionDigits: 3 }) : value == null ? '未確認' : String(value);
const colors = ['var(--zone, #21956c)', 'var(--neg, #d26472)', 'var(--accent, #6087ee)', '#bd9633', '#986ebd'];
export default function IndicatorHistoryPanel({ title, history, columns, extraColumns = [], expectedDate, children }) {
  const theme = useTheme();
  const axisTick = { fill: theme.palette.text.secondary };
  const data = history?.as_of_date === expectedDate ? history : null;
  const series = data?.series || [];
  return <section className="indicator-history-panel" aria-label={title}>
    <h3>{title}</h3>
    {children}
    {!data ? <p>分析日の一致する履歴は未取得です。</p> : <>
      <p className="indicator-history-meta">基準日 {data.as_of_date} · 観測 {series[0]?.date || '未確認'} → {series.at(-1)?.date || '未確認'} · 単位 {data.unit}<br/>出典 {data.source} · 対象 {data.scope}</p>
      {data.reason && <p role="status">{data.reason}</p>}
      {series.length > 0 && <>
        <div className="indicator-history-values">{columns.map(column => <div key={column.key}><small>{column.label}</small><strong>{display(series.at(-1)?.[column.key])}</strong></div>)}</div>
        <div style={{ height: 220, width: '100%', minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%"><LineChart data={series} accessibilityLayer margin={{ top: 8, right: 12, left: -15, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="currentColor" opacity={.08}/><XAxis tick={axisTick} dataKey="date" minTickGap={30} tickFormatter={value => value.slice(5)}/><YAxis tick={axisTick} allowDecimals={data.id === 'put-call'}/><Tooltip/><Legend/>
            {columns.map((column, index) => <Line key={column.key} dataKey={column.key} name={column.label} stroke={colors[index % colors.length]} type={data.id === 'base-count' ? 'stepAfter' : 'linear'} connectNulls={false} dot={series.length < 3} isAnimationActive={false}/>) }
          </LineChart></ResponsiveContainer>
        </div>
        <details><summary>日付・観測数・値を表で確認（{series.length}件）</summary><div style={{ overflowX: 'auto', maxHeight: 360 }}><table className="research-table" aria-label={`${title}の履歴`}><thead><tr><th>日付</th>{[...columns, ...extraColumns].map(column => <th key={column.key}>{column.label}</th>)}<th>観測 / 対象</th></tr></thead><tbody>{[...series].reverse().map((row, index) => <tr key={`${row.date}-${index}`}><th scope="row">{row.date}</th>{[...columns, ...extraColumns].map(column => <td key={column.key}>{column.format ? column.format(row[column.key]) : display(row[column.key])}</td>)}<td>{display(row.coverage)}{row.expected != null ? ` / ${display(row.expected)}` : ''}</td></tr>)}</tbody></table></div></details>
      </>}
      <p className="indicator-history-meta">{data.method}</p>
    </>}
  </section>;
}
