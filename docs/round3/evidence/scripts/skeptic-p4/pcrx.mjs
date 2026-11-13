import { readFileSync } from 'node:fs';
const [,, BUNDLE, SERVE, SYM] = process.argv;
const m = await import(BUNDLE);
const DATE = '2026-11-12', NOW = Date.parse('2026-11-13T11:10:31Z');
const research = JSON.parse(readFileSync(`${SERVE}/research.json`, 'utf8'));
const ranking = m.engine.rankCandidates(research.rows, 'minervini', { now: NOW });
const item = ranking.find(i => i.row.symbol === SYM);
const row = item.row;
const view = m.cand.candidateView({ row, assessment: item.assessment }, DATE);
const template = m.cand.trendTemplate(row, NOW);
const chart = JSON.parse(readFileSync(`${SERVE}/charts/${SYM}.json`, 'utf8'));
const cert = m.certifyBars(row, chart, DATE);
const judged = cert.certified ? chart.bars : null;
const diagnostics = judged ? m.diagnoseBookChart(row, chart, DATE) : null;
const technical = judged ? m.buildBookTechnicalEvidence(row, chart, DATE) : null;
const sells = m.sell.stockSells({ judged, diagnostics, view });
const broken = Array.isArray(sells?.weakness) && sells.weakness.some(m.sell.isBreakdown);
for (const [name, market] of [['hold', { label: '50日線割れ（弱含み・独自判定）', cap: 0, regime: 'correction', ftdUpgraded: false }], ['open', { label: '上昇トレンド（独自判定）', cap: 0.5, regime: 'confirmed_uptrend', ftdUpgraded: false }]]) {
  const gate = m.gate.buyGate({ view, template, market, sells, broken, earnings: null, judged });
  const plan = m.sizing.positionPlan(view, m.sizing.readPlanSettings(null), { market, template, technical, judged, broken, earningsSoon: false, earnings: null, sells });
  console.log(name, JSON.stringify({ gate: { kind: gate.kind, tone: gate.tone, title: gate.title, note: gate.note, reference: gate.reference, event: gate.event?.title }, plan: plan && { blocked: plan.blocked, reference: plan.reference, referenceReason: plan.referenceReason, stop: plan.stop, stopPercent: plan.stopPercent, shares: plan.shares, structural: plan.structural, stopInsideBase: plan.stopInsideBase, structuralDeep: plan.structuralDeep, adr: plan.adrPercent } }, null, 0));
}
console.log('event', JSON.stringify(m.history.crossingEvent(view, judged)));
console.log('vcp legs', JSON.stringify(technical?.vcp?.legs?.map(l => [l.highDate, l.high, l.lowDate, l.low])));
