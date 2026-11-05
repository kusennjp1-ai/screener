import { useMemo, useState } from 'react';
import PriceChart from './PriceChart';
import { sellMarks } from './briefSell';

// Chart ranges: [bars shown, interval, label]. The weekly view uses 10/30/40-week averages.
const RANGES = { '3m': [65, 'day', '3か月'], '6m': [130, 'day', '6か月'], '1y': [250, 'day', '1年'], '2yw': [104, 'week', '週足2年'] };
/** The 上げ下げ出来高比 footnote, in the stock screen's 注記 below 1024px. */
export const VCP_NOTE = '上げ下げ出来高比（50日）は、上げた日の出来高 ÷ 下げた日の出来高です。1超は買いが優勢です。';

/**
 * The price chart card: the period, the chart model, the chart, the as-of note, the periods and the
 * legend. `levels` are planLevels() of the plan (step 0: only the stop is drawn); `chartRef` reaches
 * the chart's controller (the plan moves the stop through it).
 */
export default function StockChartCard({ data, view, legs, rsHigh, sells, levels, chartRef }) {
  const { bars, row } = data;
  const [range, setRange] = useState('6m');
  const [period, interval] = RANGES[range];
  const model = useMemo(() => bars && view ? { symbol: view.symbol, bars, rsLine: data.chart.data?.rs_line || [], legs, pivot: view.pivot, upper: view.upper, stop: levels?.stop ?? null, rsNewHigh: rsHigh, dryUpLeg: legs.at(-1) || null, sellMarks: sellMarks(sells), interval } : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bars, view?.symbol, view?.pivot, view?.upper, legs, data.chart.data, rsHigh, sells, interval]);
  return <section className="brief-card brief-chartcard in" style={{ '--i': 1 }} aria-label="株価チャート">
    {model ? <PriceChart ref={chartRef} model={model} period={period} /> : <p className="brief-note brief-chart-placeholder" role="status">{data.chart.isError ? '日足チャートを取得できません。' : row?.chart_path ? '日足チャートを読み込み中…' : 'この銘柄の日足チャートは未配信です。'}</p>}
    {bars && data.date && bars.at(-1)?.date !== data.date ? <p className="brief-note brief-asof" role="note">日足は {bars.at(-1)?.date} までです（分析基準日 {data.date} の日足は未取得）。チャートから算出する判定は未確認にしています。</p> : null}
    <div className="brief-periods" role="group" aria-label="表示期間">{Object.entries(RANGES).map(([key, [, , label]]) => <button key={key} type="button" aria-pressed={range === key} onClick={() => setRange(key)}>{label}</button>)}<span className="brief-note brief-periods-hint">なぞると{interval === 'week' ? '週足' : '日足'}の値</span></div>
    <div className="brief-legend" aria-hidden="true"><span><i className="lg-ma50" />{interval === 'week' ? '10週線' : '50日線'}</span><span><i className="lg-ma150" />{interval === 'week' ? '30・40週線' : '150・200日線'}</span><span><i className="lg-pivot" />ピボット</span><span><i className="lg-stop" />損切り</span><span><i className="lg-rs" />RS線（株価÷S&amp;P 500。RS推計とは別）</span><span>枠＝値幅の収縮</span>{model?.sellMarks?.length ? <span><i className="lg-sell" />売りのサイン（▼上昇の加速・▲崩れ）</span> : null}<span className="brief-legend-hint">なぞると{interval === 'week' ? '週足' : '日足'}の値</span></div>
  </section>;
}
