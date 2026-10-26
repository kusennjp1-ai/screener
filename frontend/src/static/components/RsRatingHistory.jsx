import { useState } from 'react';
import MetricDisclosure from './MetricDisclosure';
import { validatedRsRatingHistory } from '../rsRatingHistory';
import { seriesPaths } from './leaderChartModel';
import useSvgViewportWidth from './useSvgViewportWidth';

const number = value => Number.isFinite(value) ? value.toFixed(1).replace(/\.0$/, '') : '未確認';
export default function RsRatingHistory({ history, symbol, date, current }) {
  const data = validatedRsRatingHistory(history, symbol, date, current);
  const [selected, setSelected] = useState('');
  const [plotRef, width] = useSvgViewportWidth(292);
  const point = data?.points.find(item => item.time === selected) || data?.points.at(-1);
  const dates = data?.sessions || [];
  const x = index => 26 + index / Math.max(1, dates.length - 1) * (width - 34);
  const y = value => 56 - (value - 1) / 98 * 48;
  const paths = data ? seriesPaths(data.points, dates.map(time => ({ time })), x, y) : [];
  return <section ref={plotRef} className="rs-rating-history" aria-label={`${symbol} のRS順位推移`}>
    <MetricDisclosure summary={<span className="rs-rating-summary"><span>RS順位 <small>独自推計</small></span><strong>{number(current)}<small> / 99</small></strong></span>}>
      <p>過去63・126・189・252営業日の騰落率を40%・20%・20%・20%で加重し、公開銘柄群の中で1〜99に順位化。同率は同順位です。IBDの公式RSではありません。</p>
      <p>履歴は現在の公開銘柄群から各日の値を再計算しています。当時公表された順位ではありません。各日に253本の連続した終値を持つ100銘柄以上が必要です。母数の変化でも順位は変わります。チャート内のRS線（株価÷比較銘柄価格）とは別の指標です。</p>
    </MetricDisclosure>
    {data ? <>
      <svg className="rs-rating-spark" role="img" aria-label={`RS順位の推移 ${data.points[0].time}から${date}、1から99`} viewBox={`0 0 ${width} 64`}>
        {[1,50,99].map(value=><g key={value}><line x1="26" x2={width-8} y1={y(value)} y2={y(value)} stroke="var(--line)" strokeDasharray="3 3"/><text x="2" y={y(value)+4} fill="var(--text-2)" fontSize="11">{value}</text></g>)}
        {paths.map((path, i) => <polyline key={i} points={path} fill="none" stroke="var(--accent)" strokeWidth="2"/>)}
        {data.points.map(item => <circle key={item.time} cx={x(dates.indexOf(item.time))} cy={y(item.value)} r={item.time === point.time ? 3 : 1.5} fill={item.time === point.time ? 'var(--zone)' : 'var(--accent)'}><title>{item.time} RS {number(item.value)} · {item.universe_size}銘柄</title></circle>)}
      </svg>
      <label className="rs-history-date">日付 <select aria-label="RS順位の対象日" value={point.time} onChange={event => setSelected(event.target.value)}>{data.points.map(item => <option key={item.time} value={item.time}>{item.time}</option>)}</select><output aria-live="polite">{number(point.value)} <small>/{point.universe_size}銘柄</small></output></label>
      <p className="rs-history-basis">現公開対象から再計算 · {data.points.length}日分 · 欠損は線をつなぎません</p>
    </> : <p className="rs-history-basis">比較可能なRS順位履歴は未配信です。価格比のRS線で代用しません。</p>}
  </section>;
}
