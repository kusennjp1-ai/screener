import { useMemo, useRef } from 'react';
import { BOOK_TECHNICAL_VERSION, buildBookTechnicalEvidence } from '../bookTechnicalEvidence';
import { ScreenNotes } from './briefPrimitives';
import useSessionState from './useSessionState';
import { gapDays, publishedRsLineHigh, rsLeadMarks, rsLineNewHigh, stageFromBars, stagePhase } from './briefChartModel';
import { CHART_RANGES as RANGES, chartCrossing, chartNotes, earningsMarker, heavyVolumeBars, priceInRange, shortAveragesShown, weeklyBars } from './chartReadout';
import { isBreakdown, sellMarks, stockSells } from './briefSell';
import { earningsCall } from './briefCandidate';
import { planLevels } from './positionSizing';
import StockVerdict from './StockVerdict';
import TemplateCard from './StockTemplateCard';
import StockChartCard, { VCP_NOTE } from './StockChartCard';
import VcpCard from './StockVcpCard';
import FundamentalsCard, { EPS_NOTE, InstitutionalCard } from './StockFundamentalsCard';
import PlanCard, { usePositionPlan } from './StockPlanCard';
import SellCard, { SELL_NOTE } from './StockSellCard';

/**
 * The stock screen: the data plumbing shared by its cards (the certified bars, the measured legs, the
 * stage, the RS line's new high and lead marks, the opening gaps, the sell checks and the position plan),
 * then the cards in order and the screen's one 注記 built from the footnote each card exports. `market`
 * is the market verdict (brief.market), handed to the conclusion and the plan. `judged` (the bars
 * certified for the analysis date, or null) and `template` (the trend template) also reach the
 * conclusion and the plan, so every value they derive from a chart comes from certified bars only. The
 * chart's period is kept for this tab's session, so it survives the next stock (次へ keeps 週足).
 *
 * The contractions (the technical evidence's `vcp`) reach every card from one object: unknown while the
 * research detail (the published evidence and the Setup Engine base) or the bars are loading, unknown on
 * bars not certified for the analysis date, as published when the evidence is of the current method
 * (or a reviewer's intervals), and otherwise measured again on the certified bars.
 */
export default function StockView({ data, header = null, wide = false, market = null }) {
  const { view, template, technical, diagnostics, financial, institutional, bars, row, certification } = data;
  // Values computed here from bars are shown only for bars certified for the analysis date.
  const certified = certification?.certified === true;
  const judged = certified ? bars : null;
  const chartRef = useRef(null);
  const [storedRange, setRange] = useSessionState('brief-chart-range', '6m');
  const range = RANGES[storedRange] ? storedRange : '6m';
  const [period, interval] = RANGES[range];
  // Until the detail arrives the row has neither the published evidence nor the Setup Engine base.
  const vcpPending = (Boolean(row?.research_detail_path) && !data.detail?.data && !data.detail?.isError) || (Boolean(row?.chart_path) && !data.chart?.data && !data.chart?.isError);
  const chartPayload = data.chart?.data;
  const evidence = useMemo(() => {
    if (!technical) return null;
    if (vcpPending || !certified) return { ...technical, vcp: null };
    if (technical.version === BOOK_TECHNICAL_VERSION || technical.vcp?.source === 'reviewer-intervals') return technical;
    // Published by an earlier method: measure the contractions again on the certified bars.
    try { return { ...technical, vcp: buildBookTechnicalEvidence(row, chartPayload, data.date).vcp ?? null }; } catch { return { ...technical, vcp: null }; }
  }, [technical, vcpPending, certified, row, chartPayload, data.date]);
  const sells = useMemo(() => stockSells({ judged, diagnostics, view }), [judged, diagnostics, view]);
  // A broken setup or near earnings leaves the plan a reference only, as the conclusion is (参考).
  const broken = Array.isArray(sells?.weakness) && sells.weakness.some(isBreakdown);
  // The earnings call is computed once and handed to the cards that date earnings (the chart, the plan and the conclusion read it in round 2).
  const call = earningsCall(view, Date.now());
  const soon = Boolean(call?.soon);
  const { plan, settings, update } = usePositionPlan({ view, template, market, technical: evidence, certified, judged, broken, earningsSoon: soon, chartRef });
  const legsValid = certified && evidence?.vcp?.measurementsValid === true;
  const legs = useMemo(() => (legsValid ? evidence.vcp.legs : []), [legsValid, evidence]);
  // The stage carries a phase only when stagePhase names one on certified bars, and only on a stage 2 (published
  // or computed): a published stage 3 is never relabelled here; the next data run reclassifies it.
  const stage = useMemo(() => {
    const base = Number.isInteger(row?.stage) ? { value: row.stage, computed: false } : (() => { const value = stageFromBars(judged); return value ? { value, computed: true } : null; })();
    const phase = base?.value === 2 ? stagePhase(judged) : null;
    return phase ? { ...base, phase } : base;
  }, [row?.stage, judged]);
  const rsLine = data.chart.data?.rs_line;
  // The RS line's new high, computed once for the conclusion and the chart: the published value dated for the
  // analysis date (publishedRsLineHigh, the one reader the rows share), otherwise rsLineNewHigh on certified bars
  // (the export's own function); never the backend flag. Like every value judged from a chart it needs the bars
  // certified here: a dated published high on bars this screen cannot certify is not claimed by either card.
  const rsHigh = useMemo(() => {
    const published = publishedRsLineHigh(row, data.date);
    return published ? certified && published.value === true : judged ? rsLineNewHigh(rsLine, judged) === true : false;
  }, [row, data.date, rsLine, judged, certified]);
  const rsLead = useMemo(() => (judged ? rsLeadMarks(rsLine, judged) : null), [rsLine, judged]);
  const gaps = useMemo(() => (judged ? gapDays(judged) : []), [judged]);
  const levels = useMemo(() => planLevels(plan), [plan]);
  const notes = useMemo(() => {
    if (!bars?.length) return [];
    const shown = interval === 'day' ? new Set(bars.slice(-period).map(b => b.date)) : null;
    // The crossing's colour is explained at every width, when its bar is drawn.
    const visible = interval === 'day' ? bars.slice(-period) : weeklyBars(bars).slice(-period);
    const crossing = chartCrossing(judged, view?.pivot);
    const crossingShown = crossing && visible.some(bar => (bar.start ?? bar.date) <= crossing.date && crossing.date <= bar.date) ? crossing : null;
    // Below 1024px the legend names ▼▲ without their meaning and keeps two lines: every mark it may fold is explained
    // here (only marks the chart draws: the structural low inside the price panel's range, the earnings flag in its window).
    let marks = null;
    if (!wide) {
      const range = { bars, interval, pivot: view?.pivot, upper: view?.upper, stop: levels?.stop };
      marks = {
        short: shortAveragesShown(interval, period, wide),
        pivot: Number.isFinite(view?.pivot), stop: Number.isFinite(levels?.stop),
        heavyDown: heavyVolumeBars({ bars, interval }, period).some(bar => bar.direction === 'down'),
        legs: legsValid && legs.length > 0,
        structuralLow: priceInRange(range, period, levels?.structuralLow) ? levels.structuralLow : null,
        earnings: earningsMarker(call),
      };
    }
    return chartNotes({ bars, interval, period, short: shortAveragesShown(interval, period, wide), rsLead, gaps: shown ? gaps.filter(g => shown.has(g.date)) : [], sellMarks: !wide && sellMarks(sells).length > 0, adr: interval === 'day', crossing: crossingShown, marks });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the call is read by its date and days (recomputed each render)
  }, [bars, judged, view?.pivot, view?.upper, interval, period, rsLead, gaps, wide, sells, legsValid, legs, levels?.structuralLow, levels?.stop, call?.date, call?.days, call?.soon]);
  if (!view) return <p className="brief-note brief-pad" role="status">銘柄データを読み込み中…</p>;
  return <div className="brief-stock">
    {header}
    <StockVerdict view={view} plan={plan} stage={stage} technical={evidence} bars={bars} judged={judged} template={template} rsHigh={rsHigh} financial={financial} row={row} sells={sells} diagnostics={diagnostics} market={market} earningsCall={call} />
    <StockChartCard data={data} view={view} earningsCall={call} legs={legs} legsValid={vcpPending ? null : legsValid} rsHigh={rsHigh} rsLead={rsLead} gaps={gaps} sells={sells} levels={levels} chartRef={chartRef} range={range} onRange={setRange} notes={notes} wide={wide} />
    <div className="brief-grid">
      <TemplateCard template={template} wide={wide} />
      <VcpCard technical={evidence} bars={bars} judged={judged} view={view} wide={wide} chartRef={chartRef} interval={interval} row={row} date={data.date}
        pending={vcpPending} uncertified={vcpPending || certified ? null : { reason: certification?.reason ?? null }} />
      <FundamentalsCard financial={financial} wide={wide} />
      <InstitutionalCard institutional={institutional} />
      <PlanCard view={view} plan={plan} settings={settings} onChange={update} earnings={view.earnings} earningsCall={call} judged={judged} wide={wide} />
      {bars ? <SellCard sells={sells} reason={certification?.certified ? null : certification?.reason} wide={wide} /> : null}
    </div>
    <p className="brief-note brief-pad">候補は購入推奨ではありません。数値は分析基準日の公開データに基づきます。</p>
    <ScreenNotes id="stock" wide={wide} notes={[...notes, VCP_NOTE, EPS_NOTE, bars ? SELL_NOTE : null]} />
  </div>;
}
