import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PriceChart from './PriceChart';
import { sellMarks } from './briefSell';
import { CHART_RANGES as RANGES, chartReadout, formatPercent, formatPrice, shortAveragesDrawn, weeklyRangeLabel } from './chartReadout';

/** The 上げ下げ出来高比 footnote, in the stock screen's 注記 below 1024px. */
export const VCP_NOTE = '上げ下げ出来高比（50日）は、上げた日の出来高 ÷ 下げた日の出来高です。1超は買いが優勢です。';

/** A value the chart cannot compute yet (its window is short): — on screen, a word for screen readers. */
const Missing = ({ word = '本数不足' }) => <><span aria-hidden="true">—</span><span className="sr-only">{word}</span></>;
const price = value => (value === null ? <Missing /> : formatPrice(value));
const percent = value => (value === null ? <Missing word="前の足なし" /> : formatPercent(value));

/**
 * The readout above the chart: the selected bar (the latest by default) with its open, high, low, close
 * and change, its volume and ratio, the drawn moving averages and, for the latest certified bar only, the
 * distance to the pivot and from the 52-week high. Three lines on a phone, one on a desktop.
 */
function Readout({ readout, shortShown, onLatest }) {
  const tone = readout.change > 0 ? 'is-up' : readout.change < 0 ? 'is-down' : '';
  return <div className="brief-readout-row">
    <div className="brief-readout" role="group" aria-label={readout.latest ? '最新の足の値' : `選んだ足（${readout.date}）の値`}>
      <span className="ro-line">
        <span className="ro-item ro-date">{readout.date}</span>
        <span className="ro-item"><i>始</i>{price(readout.open)}</span>
        <span className="ro-item"><i>高</i>{price(readout.high)}</span>
        <span className="ro-item"><i>安</i>{price(readout.low)}</span>
        <span className="ro-item"><i>終</i>{price(readout.close)}</span>
        <span className={`ro-item ro-change ${tone}`}>{percent(readout.change)}</span>
      </span>
      <span className="ro-line">
        <span className="ro-item"><i>出来高</i> {readout.volume === null ? <Missing word="未取得" /> : readout.volumeText}</span>
        <span className="ro-item" title={`直前${readout.volumeBasis}の平均出来高との比`}>{readout.volumeRatio === null ? <Missing /> : `${readout.volumeRatio.toFixed(2)}×`}<span className="sr-only">（直前{readout.volumeBasis}平均比）</span></span>
        {readout.pivotRatio !== null ? <span className="ro-item"><i>ピボット</i> {formatPercent(readout.pivotRatio)}</span> : null}
        {readout.fromHigh !== null ? <span className="ro-item"><i>52週高値</i> {formatPercent(readout.fromHigh)}</span> : null}
      </span>
      <span className="ro-line ro-averages">
        {readout.averages.filter(a => !a.short || shortShown).map(a => <span key={a.key} className={`ro-item ro-${a.key}${a.short ? ' ro-short' : ''}`}><i>{a.label}</i> {price(a.value)}</span>)}
      </span>
    </div>
    {readout.latest ? null : <button type="button" className="brief-latest" onClick={onLatest}>最新足</button>}
  </div>;
}

/**
 * The price chart card: the period segment and the readout above the chart, the chart, the as-of note,
 * the legend and (at 1024px and wider) the chart's footnotes. `range` and `onRange` are the screen's
 * period (kept per tab); `levels` are planLevels() of the plan; `chartRef` reaches the chart's controller
 * (the plan moves the stop and the VCP card emphasises a contraction through it). `rsLead` and `gaps`
 * come from certified bars only (null / [] otherwise).
 */
export default function StockChartCard({ data, view, legs, legsValid = false, rsHigh, rsLead = null, gaps = [], sells, levels, chartRef, range = '6m', onRange, notes = [], wide = false }) {
  const { bars, row, certification } = data;
  const [period, interval] = RANGES[range] || RANGES['6m'];
  const certified = certification?.certified === true;
  const short = shortAveragesDrawn(interval, period);
  const model = useMemo(() => (bars && view ? {
    symbol: view.symbol, bars, interval, short, rsLine: data.chart.data?.rs_line || [], rsReason: certified ? null : certification?.reason ?? null,
    legs, legsValid, pivot: view.pivot, upper: view.upper, stop: levels?.stop ?? null, entry: levels?.entry ?? null, r2: levels?.r2 ?? null, r3: levels?.r3 ?? null,
    structuralLow: levels?.structuralLow ?? null, auditHigh: certified ? row?.technical_audit?.values?.high ?? null : null,
    rsNewHigh: rsHigh, rsLead: certified ? rsLead : null, gaps: certified ? gaps : [], earnings: view.earnings ?? null,
    // 「出来高の枯渇」 only when the last contraction's volume really is below its prior 50-day average.
    dryUpLeg: Number.isFinite(legs.at(-1)?.volumeEvidence?.intervalRatio) && legs.at(-1).volumeEvidence.intervalRatio < 1 ? legs.at(-1) : null, sellMarks: sellMarks(sells),
  } : null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [bars, view?.symbol, view?.pivot, view?.upper, view?.earnings, legs, legsValid, data.chart.data, rsHigh, rsLead, gaps, sells, interval, short, certified, certification?.reason, row?.technical_audit, levels?.entry, levels?.r2, levels?.r3, levels?.structuralLow]);
  // The selected bar belongs to one chart (model and period); a new one (symbol, period, data) starts on its latest bar.
  const [scrub, setScrub] = useState(null), current = useRef({ model, period });
  current.current = { model, period };
  const index = scrub && scrub.model === model && scrub.period === period ? scrub.index : null;
  const onScrub = useCallback(i => setScrub({ ...current.current, index: i }), []);
  const readout = useMemo(() => (model ? chartReadout(model, index ?? undefined, { certified, pivot: view?.pivot ?? null, auditHigh: model.auditHigh }) : null), [model, index, certified, view?.pivot]);
  // At 1024px and wider the stock pane scrolls on its own: a thin fade at its bottom says more follows.
  const card = useRef(null);
  useEffect(() => {
    const pane = card.current?.closest('.brief-right');
    if (!pane) return undefined;
    const update = () => { if (pane.scrollTop + pane.clientHeight < pane.scrollHeight - 1) pane.setAttribute('data-more', ''); else pane.removeAttribute('data-more'); };
    update();
    pane.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(pane);
    const content = card.current.closest('.brief-stock');
    if (content) observer?.observe(content);
    return () => { pane.removeEventListener('scroll', update); observer?.disconnect(); pane.removeAttribute('data-more'); };
  }, []);
  const label = key => (key === '2yw' ? weeklyRangeLabel(bars) : RANGES[key][2]);
  const weekly = interval === 'week';
  return <section ref={card} className="brief-card brief-chartcard in" style={{ '--i': 1 }} aria-label="株価チャート">
    <div className="brief-chartcard-head">
      <div className="brief-periods" role="group" aria-label="表示期間">{Object.keys(RANGES).map(key => <button key={key} type="button" aria-pressed={range === key} onClick={() => onRange?.(key)}>{label(key)}</button>)}</div>
      <span className="brief-note brief-periods-hint">ポインタを合わせると{weekly ? '週足' : '日足'}の値</span>
    </div>
    {readout ? <Readout readout={readout} shortShown={short && wide} onLatest={() => setScrub(null)} /> : null}
    {model ? <PriceChart ref={chartRef} model={model} period={period} onScrub={onScrub} selected={index} /> : <p className="brief-note brief-chart-placeholder" role="status">{data.chart.isError ? '日足チャートを取得できません。' : row?.chart_path ? '日足チャートを読み込み中…' : 'この銘柄の日足チャートは未配信です。'}</p>}
    {bars && data.date && bars.at(-1)?.date !== data.date ? <p className="brief-note brief-asof" role="note">日足は {bars.at(-1)?.date} までです（分析基準日 {data.date} の日足は未取得）。チャートから算出する判定は未確認にしています。</p> : null}
    <div className="brief-legend" aria-hidden="true">
      {(weekly ? [['ma50', '10週線'], ['ma150', '30週線'], ['ma200', '40週線']] : [['ma50', '50日線'], ['ma150', '150日線'], ['ma200', '200日線']]).map(([key, text]) => <span key={key}><i className={`lg-${key}`} />{text}</span>)}
      {short ? <><span className="lg-shortitem"><i className="lg-ma10" />10日線</span><span className="lg-shortitem"><i className="lg-ema21" />21日EMA</span></> : null}
      {Number.isFinite(view?.pivot) ? <span><i className="lg-pivot" />ピボット</span> : null}
      {Number.isFinite(levels?.stop) ? <span><i className="lg-stop" />損切り</span> : null}
      <span><i className="lg-lows" />収縮の安値</span>
      <span>枠＝値幅の収縮</span>
      {model?.sellMarks?.length ? <span><i className="lg-sell" />売りのサイン（▼上昇の加速・▲崩れ）</span> : null}
    </div>
    {wide && notes.length ? <ul className="brief-chart-notes">{notes.map(note => <li key={note}>{note}</li>)}</ul> : null}
  </section>;
}
