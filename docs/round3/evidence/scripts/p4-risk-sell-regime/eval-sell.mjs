// p4-risk-sell-regime: the stock screen's sell checks, buy gate and plan on the snapshot's real rows, with main 8849bf9's
// own modules (esbuild bundle). Mirrors useStockData/StockView: candidateView, certifyBars, buildBookTechnicalEvidence,
// diagnoseBookChart, stockSells, buyGate, positionPlan (default settings), and the market verdict modelMarket on the
// rows with the feature run's own market fields (market_above_50dma / market_above_200dma) restored.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const [,, BUNDLE, SERVE, MARKET, ROWS, OUT] = process.argv;
const m = await import(BUNDLE);
const DATE = '2026-11-12';
const NOW = Date.parse('2026-11-13T11:10:31Z');
const research = JSON.parse(readFileSync(`${SERVE}/research.json`, 'utf8'));
const marketFields = JSON.parse(readFileSync(MARKET, 'utf8'));
const listed = new Set(readFileSync(ROWS, 'utf8').trim().split('\n').map(l => JSON.parse(l).symbol));
const rows = research.rows.map(r => ({ ...r, ...(marketFields[r.symbol] ? { market_above_50dma: marketFields[r.symbol].market_above_50dma, market_above_200dma: marketFields[r.symbol].market_above_200dma } : {}) }));
const market = m.modelMarket(rows);
const ranking = m.engine.rankCandidates(rows, 'minervini', { now: NOW });
const liquid = m.presentation.filterRanked(ranking, { liquidOnly: true });
const liquidRank = new Map(liquid.map((item, i) => [item.row.symbol, i + 1]));
const out = [];
for (const item of ranking) {
  const symbol = item.row.symbol;
  if (!listed.has(symbol)) continue;
  const row = item.row;
  const view = m.cand.candidateView(item, DATE, { now: NOW });
  const template = m.cand.trendTemplate(row, NOW);
  const path = `${SERVE}/charts/${symbol}.json`;
  const chart = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  const cert = chart ? m.certifyBars(row, chart, DATE) : { certified: false, reason: 'no chart' };
  const judged = cert.certified ? chart.bars : null;
  let technical = null, diagnostics = null;
  if (judged) { try { technical = m.buildBookTechnicalEvidence(row, chart, DATE); } catch (e) { technical = null; } try { diagnostics = m.diagnoseBookChart(row, chart, DATE); } catch { diagnostics = null; } }
  const sells = m.sell.stockSells({ judged, diagnostics, view });
  const broken = Array.isArray(sells?.weakness) && sells.weakness.some(m.sell.isBreakdown);
  const call = m.cand.earningsCall(view, NOW);
  const gate = m.gate.buyGate({ view, template, market, sells, broken, earnings: call ? { days: call.days, soon: call.soon, line: call.line } : null, judged });
  const plan = m.sizing.positionPlan(view, m.sizing.readPlanSettings(null), { market, template, technical, judged, broken, earningsSoon: Boolean(call?.soon), earnings: call?.soon === undefined ? null : { days: call?.days, soon: call?.soon }, sells });
  const chip = m.sell.sellChipView(sells);
  const marks = m.sell.sellMarks(sells);
  out.push({ symbol, liquidRank: liquidRank.get(symbol) ?? null, setup_ready: row.se_setup_ready ?? null, qualified: view.qualified, failed: view.failed, unknown: view.unknown,
    position: view.position, state: view.state, price: view.price, pivot: view.pivot, upper: view.upper, distance: view.distance, stateLabel: view.stateLabel, event: view.event ? { kind: view.event.kind, title: view.event.title, tone: view.event.tone } : null,
    rs: view.rs, rsMethod: row.rs_method ?? null, certified: cert.certified, certReason: cert.reason ?? null,
    sells: sells ? { asOf: sells.asOf, hits: sells.hits, breakdownHits: sells.breakdownHits, cautions: sells.cautions, unknowns: sells.unknowns, runReason: sells.runReason, run: sells.run, advance: sells.advance,
      strength: sells.strength.map(c => ({ key: c.key, state: c.state, date: c.date ?? null, detail: c.detail })), weakness: sells.weakness.map(c => ({ key: c.key, state: c.state, date: c.date ?? null, crossDate: c.crossDate ?? null, ratio: c.ratio ?? null, sessions: c.sessions ?? null, detail: c.detail, headline: c.headline ?? null })) } : null,
    chip, marks,
    gate: { kind: gate.kind, tone: gate.tone, title: gate.title, note: gate.note, reason: gate.reason, reference: gate.reference, blocked: gate.blocked, trialOnly: gate.trialOnly, event: gate.event ? { kind: gate.event.kind, title: gate.event.title } : null },
    plan: plan && !plan.blocked ? { entry: plan.entry, basis: plan.basis, stop: plan.stop, stopPercent: plan.stopPercent, shares: plan.shares, weight: plan.weight, trialOnly: plan.trialOnly, reference: plan.reference, referenceReason: plan.referenceReason,
      stopInsideBase: plan.stopInsideBase, structuralDeep: plan.structuralDeep, structural: plan.structural, adrPercent: plan.adrPercent, adrReason: plan.adrReason, r2: plan.r2, marketGuide: plan.marketGuide } : plan ? { blocked: plan.blocked } : null,
    technical: technical ? { as_of_date: technical.as_of_date, version: technical.version, vcp: technical.vcp ? { measurementsValid: technical.vcp.measurementsValid, legs: technical.vcp.legs?.map(l => ({ low: l.low, lowDate: l.lowDate, high: l.high, highDate: l.highDate, depth: l.depth ?? l.depthPct ?? null })) } : null } : null,
    diagnostics: diagnostics ? { valid: diagnostics.valid, as_of_date: diagnostics.as_of_date, priceWarnings: diagnostics.priceWarnings ?? null } : null,
    earnings: call ? { days: call.days, soon: call.soon, line: call.line } : null,
  });
}
writeFileSync(OUT, out.map(o => JSON.stringify(o)).join('\n') + '\n');
console.log(JSON.stringify({ market, listed: listed.size, evaluated: out.length, liquid: out.filter(o => o.liquidRank).length }, null, 1));
