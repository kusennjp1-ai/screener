import { useMemo, useRef } from 'react';
import { BOOK_TECHNICAL_VERSION, buildBookTechnicalEvidence } from '../bookTechnicalEvidence';
import { ScreenNotes } from './briefPrimitives';
import useSessionState from './useSessionState';
import { gapDays, rsLeadMarks, rsLineNewHigh, stageFromBars, stagePhase } from './briefChartModel';
import { CHART_RANGES as RANGES, chartNotes, shortAveragesDrawn } from './chartReadout';
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
  // The stage carries a phase only when stagePhase names one on certified bars (none yet: `phase` stays undefined).
  const stage = useMemo(() => {
    const base = Number.isInteger(row?.stage) ? { value: row.stage, computed: false } : (() => { const value = stageFromBars(judged); return value ? { value, computed: true } : null; })();
    const phase = base ? stagePhase(judged) : null;
    return phase ? { ...base, phase } : base;
  }, [row?.stage, judged]);
  const rsLine = data.chart.data?.rs_line;
  // The RS line's new high and its lead marks are judged from certified bars only (not the backend flag).
  const rsHigh = useMemo(() => (judged ? rsLineNewHigh(rsLine, judged) === true : false), [rsLine, judged]);
  const rsLead = useMemo(() => (judged ? rsLeadMarks(rsLine, judged) : null), [rsLine, judged]);
  const gaps = useMemo(() => (judged ? gapDays(judged) : []), [judged]);
  const levels = useMemo(() => planLevels(plan), [plan]);
  const notes = useMemo(() => {
    if (!bars?.length) return [];
    const shown = interval === 'day' ? new Set(bars.slice(-period).map(b => b.date)) : null;
    // The 10/21-day lines are drawn at 1024px and wider only; below that the legend names ▼▲ without their meaning.
    return chartNotes({ bars, interval, period, short: wide && shortAveragesDrawn(interval, period), rsLead, gaps: shown ? gaps.filter(g => shown.has(g.date)) : [], sellMarks: !wide && sellMarks(sells).length > 0 });
  }, [bars, interval, period, rsLead, gaps, wide, sells]);
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
