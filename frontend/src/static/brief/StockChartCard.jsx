import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PriceChart from './PriceChart';
import { priceInRange } from './priceChart';
import { sellMarks } from './briefSell';
import { auditValues } from '../qualificationAudit';
import { newYorkDate } from '../evidenceTime';
import { ratioShown } from './briefCandidate';
import { CHART_RANGES as RANGES, chartCrossing, chartReadout, formatPercent, formatPrice, heavyVolumeBars, shortAveragesShown, weeklyBars, weeklyRangeLabel } from './chartReadout';

/** The 上げ下げ出来高比 footnote, in the stock screen's 注記 below 1024px. */
export const VCP_NOTE = '上げ下げ出来高比（50日）は、上げた日の出来高 ÷ 下げた日の出来高です。1超は買いが優勢です。';

/** A value the chart cannot compute yet (its window is short): — on screen, a word for screen readers. */
const Missing = ({ word = '本数不足' }) => <><span aria-hidden="true">—</span><span className="sr-only">{word}</span></>;
/** The qualifier after a value read from bars not certified for the analysis date. */
const Unverified = () => <span className="ro-unverified-note">（未検証）</span>;

/**
 * The readout beside (1024px and wider) or under the period segment: the selected bar (the latest by
 * default) with its open, high, low, close and change, its volume and ratio, the 50/150/200 averages
 * (10/30/40 weeks) and, for the latest certified bar only, the distance to the pivot and from the
 * 52-week high. A value and its qualifier never wrap apart. `compact` (below 1024px) drops the decimals
 * of prices from 1,000 up, as the chart's tags do. On bars not certified for the analysis date it starts
 * with a neutral 「未検証の足」 chip (the reason for screen readers and in its title) and reads the change and
 * the volume ratio dimmed with 「（未検証）」; the prices and averages stay. ADR (the latest daily bar; — when
 * the bars are not certified) closes the averages' line, and at 1024px and wider the 50-day value carries
 * the distance from it (独自計算; the latest certified bar only).
 */
function Readout({ readout, compact, reason }) {
  const tone = readout.change > 0 ? 'is-up' : readout.change < 0 ? 'is-down' : '';
  const price = value => (value === null ? <Missing /> : formatPrice(value, { compact }));
  const label = readout.latest ? (readout.weekly ? `最新の足（${readout.range}の週）の値` : '最新の足の値') : `選んだ足（${readout.weekly ? `${readout.range}の週` : readout.date}）の値`;
  const unverified = readout.unverified;
  const change = <span className={`ro-item ro-change ${unverified ? 'is-unverified' : tone}`}>{readout.change === null ? <Missing word="前の足なし" /> : <>{formatPercent(readout.change)}{unverified ? <Unverified /> : null}</>}</span>;
  const chipTitle = `日足を分析基準日で検証できていません${reason ? `（${reason}）` : ''}`;
  return <div className={`brief-readout${unverified ? ' is-unverified' : ''}`} role="group" aria-label={label}>
    <span className="ro-line">
      {unverified ? <span className="ro-item ro-unverified" title={chipTitle}>未検証の足<span className="sr-only">：{chipTitle}</span></span> : null}
      <span className="ro-item ro-date" title={readout.weekly ? `${readout.range}の週` : undefined}>{readout.date}</span>
      <span className="ro-item"><i>始</i>{price(readout.open)}</span>
      <span className="ro-item"><i>高</i>{price(readout.high)}</span>
      <span className="ro-item"><i>安</i>{price(readout.low)}</span>
      {unverified ? <span className="ro-item"><i>終</i>{price(readout.close)}</span> : <span className="ro-group"><span className="ro-item"><i>終</i>{price(readout.close)}</span>{change}</span>}
    </span>
    <span className="ro-line">
      {unverified ? change : null}
      <span className="ro-group">
        <span className="ro-item"><i>出来高</i>{readout.volume === null ? <Missing word="未取得" /> : readout.volumeText}</span>
        <span className={`ro-item${unverified ? ' is-unverified' : ''}`} title={`直前${readout.volumeBasis}の平均出来高との比`}>{readout.volumeRatio === null ? <Missing /> : <>{ratioShown(readout.volumeRatio)}{unverified ? <Unverified /> : null}</>}<span className="sr-only">（直前{readout.volumeBasis}平均比）</span></span>
      </span>
      {readout.pivotRatio !== null ? <span className="ro-item"><i>対ピボット</i>{formatPercent(readout.pivotRatio)}</span> : null}
      {readout.fromHigh !== null ? <span className="ro-item" title="52週高値から"><i>{compact ? <><span className="sr-only">52週</span>高値から</> : '52週高値から'}</i>{formatPercent(readout.fromHigh)}</span> : null}
    </span>
    <span className="ro-line ro-averages">
      {readout.averages.filter(a => !a.short).map(a => <span key={a.key} className={`ro-item ro-${a.key}`}><i>{a.label}</i> {price(a.value)}{a.key === 'ma50' && !compact && readout.fromSma50 !== undefined ? (readout.fromSma50 === null ? null : <span className="ro-dist" title="50日線からの乖離（独自計算）">（{formatPercent(readout.fromSma50)}）</span>) : null}</span>)}
      {readout.adr !== undefined ? <span className="ro-item ro-adr" title={`ADR：直近${readout.adrSessions}日の高値÷安値−1の平均（独自計算）`}><i>ADR</i> {readout.adr === null ? <Missing word={readout.adrReason ?? '未確認'} /> : `${readout.adr.toFixed(1)}%`}</span> : null}
    </span>
  </div>;
}

/**
 * The legend's items, each the colour (and dash) of what it names: [key, swatch class ('b:' a glyph), text,
 * fold rank]. Below 1024px the legend keeps two lines: the averages and the RS line's meaning always stay
 * (no rank), and the other items are kept by rank while they fit (every mark they name is also explained in
 * the screen's 注記).
 */
function legendItems({ weekly, short, wide, rsShown, structuralLow, drawnLegs, crossing, heavyDown, sellMarks: sells, pivot, stop }) {
  // Below 1024px the daily averages share one item (「50 150 200日線」, each number after its own swatch).
  const rows = !wide && !weekly ? [['mas', null, <><i className="lg-ma50" />50 <i className="lg-ma150" />150 <i className="lg-ma200" />200日線</>]]
    : (weekly ? ['10週線', '30週線', '40週線'] : ['50日線', '150日線', '200日線']).map((text, i) => [['ma50', 'ma150', 'ma200'][i], `lg-${['ma50', 'ma150', 'ma200'][i]}`, text]);
  if (rsShown) rows.push(['rs', 'lg-rs', `${wide ? 'RS線＝' : ''}株価÷S&P 500・RS推計やIBD RSとは別`]);
  // The last contraction's low (a 「安値」 tag on a narrow chart, a dotted line on every chart): its price.
  if (Number.isFinite(structuralLow)) rows.push(['low', 'lg-structural', `最後の収縮の安値 ${formatPrice(structuralLow)}`, 1]);
  if (crossing) rows.push(['breakout', 'b:lg-breakoutglyph:▲', '上抜け', 2]);
  // Below 1024px the volume panel's caption also keys ■ (下落日), beside the bars.
  if (heavyDown) rows.push(['heavydown', 'b:lg-heavydown:', '下落日の大商い', wide ? 3 : 6]);
  if (sells) rows.push(wide ? ['sell', 'lg-sell', '売りのサイン（▼上昇の加速・▲崩れ）', 4] : ['sell', 'b:lg-sellglyph:▼▲', '売りのサイン', 4]);
  if (short) rows.push(['ma10', 'lg-ma10', '10日線', 8], ['ema21', 'lg-ema21', '21日EMA', 8]);
  if (Number.isFinite(pivot)) rows.push(['pivot', 'lg-pivot', 'ピボット', 7]);
  if (Number.isFinite(stop)) rows.push(['stop', 'lg-stop', '損切り', 7]);
  if (drawnLegs) rows.push(['lows', 'lg-lows', '収縮の安値', 5], ['boxes', null, wide ? '枠＝値幅の収縮' : '枠＝収縮', 6]);
  return rows.map(([key, swatch, text, rank]) => {
    const [glyph, cls, mark] = swatch?.startsWith('b:') ? swatch.split(':') : [];
    return { key, rank, node: <>{glyph ? <b className={cls}>{mark}</b> : swatch ? <i className={swatch} /> : null}{text}</> };
  });
}

/**
 * Below 1024px, keeps the legend on two lines: the items that must stay take their places first, then the
 * foldable ones by rank while one of the two lines still has room (measured, so it holds for any font);
 * the rest are hidden (each is explained in the 注記). Items are ordered line by line with CSS `order`.
 */
function useTwoLineLegend(ref, wide, signature) {
  useLayoutEffect(() => {
    const legend = ref.current;
    if (!legend || wide) return undefined;
    const fold = () => {
      const items = [...legend.children];
      for (const item of items) { item.hidden = false; item.style.order = ''; }
      const room = legend.clientWidth, gap = parseFloat(getComputedStyle(legend).columnGap) || 0;
      if (!(room > 0)) return;
      const used = [0, 0], place = item => {
        const w = item.getBoundingClientRect().width;
        for (const line of [0, 1]) if (used[line] + (used[line] ? gap : 0) + w <= room + 0.5) { used[line] += (used[line] ? gap : 0) + w; return line; }
        return null;
      };
      const keep = items.filter(item => item.dataset.fold !== 'true'), foldable = items.filter(item => item.dataset.fold === 'true').sort((a, b) => Number(a.dataset.rank) - Number(b.dataset.rank));
      for (const item of [...keep, ...foldable]) {
        const line = place(item);
        if (line === null && item.dataset.fold === 'true') item.hidden = true;
        else item.style.order = String(line ?? 1);
      }
      // The browser wraps for itself: if a fraction of a pixel still made a third line, fold the last kept item.
      const tops = () => new Set(items.filter(item => !item.hidden).map(item => Math.round(item.offsetTop))).size;
      for (let guard = 0; tops() > 2 && guard < items.length; guard++) {
        const last = foldable.filter(item => !item.hidden).at(-1);
        if (!last) break;
        last.hidden = true;
      }
    };
    fold();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fold) : null;
    observer?.observe(legend);
    return () => observer?.disconnect();
  }, [ref, wide, signature]);
}

/**
 * The weekly period's button text: the honest week count, on two lines (no brackets) on the narrowest phones.
 * Without bars it is plain 「週足」 (its label says the count is unknown), never 「0週」.
 */
function WeeklyLabel({ bars }) {
  const count = weeklyBars(bars).length;
  if (!count) return '週足';
  if (count >= 104) return weeklyRangeLabel(bars);
  return <>週足<span className="brief-weeks"><span className="brief-paren">（</span>{count}週<span className="brief-paren">）</span></span></>;
}

/**
 * The price chart card: the period segment and the readout above the chart, the chart, the as-of note,
 * the legend and (at 1024px and wider) the chart's footnotes. `range` and `onRange` are the screen's
 * period (kept per tab); `levels` are planLevels() of the plan; `chartRef` reaches the chart's controller
 * (the plan moves the stop and the VCP card emphasises a contraction through it). `legsValid` is null
 * while the contractions are still loading. `rsLead`, `gaps` and the pivot crossing come from certified
 * bars only. `earningsCall` is the screen's one earnings call (StockView's earningsCall): the date axis
 * counts the same days as the chips and the plan, and the chart redraws when today's New York date changes.
 */
export default function StockChartCard({ data, view, earningsCall = null, legs, legsValid = false, rsHigh, rsLead = null, gaps = [], sells, levels, chartRef, range = '6m', onRange, notes = [], wide = false }) {
  const { bars, row, certification } = data;
  const [period, interval] = RANGES[range] || RANGES['6m'];
  const certified = certification?.certified === true;
  // The 10-day and 21-day lines: on the 3- and 6-month charts at 1024px and wider, on the 3-month chart below.
  const short = shortAveragesShown(interval, period, wide);
  const crossing = useMemo(() => (certified ? chartCrossing(bars, view?.pivot) : null), [certified, bars, view?.pivot]);
  const today = newYorkDate(Date.now());
  // The 52-week high judges the stock: only from the published audit of the analysis date, on certified bars.
  const auditHigh = certified && row?.technical_audit?.as_of_date === data.date && Number.isFinite(auditValues(row).high) ? auditValues(row).high : null;
  const model = useMemo(() => (bars && view ? {
    symbol: view.symbol, bars, interval, short, rsLine: data.chart.data?.rs_line || [], rsReason: certified ? null : certification?.reason ?? null,
    legs, legsValid, pivot: view.pivot, upper: view.upper, stop: levels?.stop ?? null, entry: levels?.entry ?? null, r2: levels?.r2 ?? null, r3: levels?.r3 ?? null,
    structuralLow: levels?.structuralLow ?? null, auditHigh,
    rsNewHigh: certified && rsHigh === true, rsLead: certified ? rsLead : null, gaps: certified ? gaps : [], earnings: earningsCall ?? null, crossing, today,
    // 「出来高の枯渇」 only when the last contraction's volume really is below its prior 50-day average.
    dryUpLeg: Number.isFinite(legs.at(-1)?.volumeEvidence?.intervalRatio) && legs.at(-1).volumeEvidence.intervalRatio < 1 ? legs.at(-1) : null, sellMarks: sellMarks(sells),
  } : null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [bars, view?.symbol, view?.pivot, view?.upper, earningsCall?.date, earningsCall?.days, earningsCall?.soon, crossing, today, legs, legsValid, data.chart.data, rsHigh, rsLead, gaps, sells, interval, short, certified, certification?.reason, auditHigh, levels?.entry, levels?.r2, levels?.r3, levels?.structuralLow]);
  // The selected bar belongs to one chart (model and period); a new one (symbol, period, data) starts on its latest bar.
  const [scrub, setScrub] = useState(null), current = useRef({ model, period });
  current.current = { model, period };
  const index = scrub && scrub.model === model && scrub.period === period ? scrub.index : null;
  const onScrub = useCallback(i => setScrub({ ...current.current, index: i }), []);
  const onLatest = useCallback(() => setScrub(null), []);
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
  const weekly = interval === 'week';
  const drawnLegs = legsValid === true && legs.length > 0;
  const heavyDown = useMemo(() => (model ? heavyVolumeBars(model, period).some(bar => bar.direction === 'down') : false), [model, period]);
  // The crossing's bar must be on screen for its legend item (and the structural low in the y-range for its tag).
  const crossingShown = Boolean(crossing && bars && (weekly ? weeklyBars(bars).slice(-period) : bars.slice(-period)).some(bar => (weekly ? bar.start <= crossing.date && crossing.date <= bar.date : bar.date === crossing.date)));
  const rsShown = (data.chart.data?.rs_line || []).filter(point => Number.isFinite(point?.value)).length > 1;
  const items = legendItems({ weekly, short, wide, rsShown, structuralLow: model && priceInRange(model, period, levels?.structuralLow) ? levels.structuralLow : null, drawnLegs, crossing: crossingShown, heavyDown, sellMarks: model?.sellMarks?.length > 0, pivot: view?.pivot, stop: levels?.stop });
  const legendRef = useRef(null);
  useTwoLineLegend(legendRef, wide, items.map(item => item.key).join('|') + (levels?.structuralLow ?? ''));
  return <section ref={card} className="brief-card brief-chartcard in" style={{ '--i': 1 }} aria-label="株価チャート">
    <div className="brief-chartcard-head">
      <div className="brief-periods" role="group" aria-label="表示期間">{Object.keys(RANGES).map(key => <button key={key} type="button" className={key === '2yw' ? 'brief-period-week' : undefined} aria-pressed={range === key} aria-label={key === '2yw' ? weeklyRangeLabel(bars) : undefined} onClick={() => onRange?.(key)}>{key === '2yw' ? <WeeklyLabel bars={bars} /> : RANGES[key][2]}</button>)}</div>
      {readout ? <Readout readout={readout} compact={!wide} reason={certification?.reason ?? null} /> : null}
    </div>
    {model ? <PriceChart ref={chartRef} model={model} period={period} onScrub={onScrub} selected={index} onLatest={onLatest} /> : <p className="brief-note brief-chart-placeholder" role="status">{data.chart.isError ? '日足チャートを取得できません。' : row?.chart_path ? '日足チャートを読み込み中…' : 'この銘柄の日足チャートは未配信です。'}</p>}
    {bars && data.date && bars.at(-1)?.date !== data.date ? <p className="brief-note brief-asof" role="note">日足は {bars.at(-1)?.date} までです（分析基準日 {data.date} の日足は未取得）。チャートから算出する判定は未確認にしています。</p> : null}
    <div ref={legendRef} className="brief-legend" aria-hidden="true">
      {items.map(item => <span key={item.key} className={item.key === 'mas' ? 'lg-mas' : undefined} data-key={item.key} data-fold={item.rank ? 'true' : undefined} data-rank={item.rank}>{item.node}</span>)}
    </div>
    {wide && notes.length ? <ul className="brief-chart-notes">{notes.map(note => <li key={note}>{note}</li>)}</ul> : null}
  </section>;
}
