import { useMemo, useRef } from 'react';
import { ScreenNotes } from './briefPrimitives';
import { rsLineNewHigh, stageFromBars } from './briefChartModel';
import { stockSells } from './briefSell';
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
 * stage, the RS line's new high, the sell checks and the position plan), then the cards in order and the
 * screen's one 注記 built from the footnote each card exports. `market` is the market verdict
 * (brief.market), handed to the conclusion and the plan. `judged` (the bars certified for the analysis
 * date, or null) and `template` (the trend template) also reach the conclusion and the plan, so every
 * value they derive from a chart comes from certified bars only (step 0: not read there yet).
 */
export default function StockView({ data, header = null, wide = false, market = null }) {
  const { view, template, technical, diagnostics, financial, institutional, bars, row, certification } = data;
  // Values computed here from bars are shown only for bars certified for the analysis date.
  const judged = certification?.certified ? bars : null;
  const chartRef = useRef(null);
  const { plan, settings, update } = usePositionPlan({ view, template, market, technical, certified: certification?.certified === true, judged, chartRef });
  const legs = technical?.vcp?.measurementsValid ? technical.vcp.legs : [];
  const stage = useMemo(() => Number.isInteger(row?.stage) ? { value: row.stage, computed: false } : (() => { const value = stageFromBars(judged); return value ? { value, computed: true } : null; })(), [row?.stage, judged]);
  const sells = useMemo(() => stockSells({ judged, diagnostics, view }), [judged, diagnostics, view]);
  const rsHigh = useMemo(() => view?.rsLineHigh || (judged ? rsLineNewHigh(data.chart.data?.rs_line, judged) === true : false), [view?.rsLineHigh, data.chart.data, judged]);
  const levels = useMemo(() => planLevels(plan), [plan]);
  if (!view) return <p className="brief-note brief-pad" role="status">銘柄データを読み込み中…</p>;
  return <div className="brief-stock">
    {header}
    <StockVerdict view={view} plan={plan} stage={stage} technical={technical} bars={bars} judged={judged} template={template} rsHigh={rsHigh} financial={financial} row={row} sells={sells} diagnostics={diagnostics} market={market} />
    <StockChartCard data={data} view={view} legs={legs} rsHigh={rsHigh} sells={sells} levels={levels} chartRef={chartRef} />
    <div className="brief-grid">
      <TemplateCard template={template} wide={wide} />
      <VcpCard technical={technical} bars={bars} judged={judged} view={view} wide={wide} />
      <FundamentalsCard financial={financial} wide={wide} />
      <InstitutionalCard institutional={institutional} />
      <PlanCard view={view} plan={plan} settings={settings} onChange={update} earnings={view.earnings} judged={judged} wide={wide} />
      {bars ? <SellCard sells={sells} reason={certification?.certified ? null : certification?.reason} wide={wide} /> : null}
    </div>
    <p className="brief-note brief-pad">候補は購入推奨ではありません。数値は分析基準日の公開データに基づきます。</p>
    <ScreenNotes id="stock" wide={wide} notes={[VCP_NOTE, EPS_NOTE, bars ? SELL_NOTE : null]} />
  </div>;
}
