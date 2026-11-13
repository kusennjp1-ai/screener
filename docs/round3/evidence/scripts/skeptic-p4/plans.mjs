import { readFileSync, existsSync } from 'node:fs';
const [,, BUNDLE, SERVE] = process.argv;
const m = await import(BUNDLE);
const DATE = '2026-11-12', NOW = Date.parse('2026-11-13T11:10:31Z');
const research = JSON.parse(readFileSync(`${SERVE}/research.json`, 'utf8'));
const listed = new Set(readFileSync('/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/snapshot/rows.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l).symbol));
const ranking = m.engine.rankCandidates(research.rows, 'minervini', { now: NOW });
const market = { label: '50日線割れ（弱含み・独自判定）', cap: 0, regime: 'correction', ftdUpgraded: false };
const st = {}, inside = {}, reasons = {}, adr = []; let n = 0;
for (const item of ranking) {
  const row = item.row; if (!listed.has(row.symbol)) continue;
  const view = m.cand.candidateView({ row, assessment: item.assessment }, DATE);
  if (!(view.position === 'zone' || view.position === 'near')) continue;
  const p = `${SERVE}/charts/${row.symbol}.json`; if (!existsSync(p)) continue;
  const chart = JSON.parse(readFileSync(p, 'utf8'));
  if (!m.certifyBars(row, chart, DATE).certified) continue;
  const judged = chart.bars;
  let technical = null; try { technical = m.buildBookTechnicalEvidence(row, chart, DATE); } catch {}
  let diagnostics = null; try { diagnostics = m.diagnoseBookChart(row, chart, DATE); } catch {}
  const template = m.cand.trendTemplate(row, NOW);
  const sells = m.sell.stockSells({ judged, diagnostics, view });
  const broken = Array.isArray(sells?.weakness) && sells.weakness.some(m.sell.isBreakdown);
  const plan = m.sizing.positionPlan(view, m.sizing.readPlanSettings(null), { market, template, technical, judged, broken, earningsSoon: false, earnings: null, sells });
  if (!plan || plan.blocked || !plan.structural) continue;
  n++; st[plan.structural.state] = (st[plan.structural.state] || 0) + 1; inside[String(plan.stopInsideBase)] = (inside[String(plan.stopInsideBase)] || 0) + 1;
  if (plan.structural.state === 'unknown') reasons[plan.structural.reason] = (reasons[plan.structural.reason] || 0) + 1;
  if (Number.isFinite(plan.adrPercent)) adr.push(plan.adrPercent);
}
adr.sort((a, b) => a - b);
console.log(n, JSON.stringify(st), JSON.stringify(inside), JSON.stringify(reasons), [0.1, 0.5, 0.9].map(q => adr[Math.floor(q * adr.length)].toFixed(2)).join('/'));
