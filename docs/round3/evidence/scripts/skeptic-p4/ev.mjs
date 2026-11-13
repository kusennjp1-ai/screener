// skeptic-p4: independent re-evaluation of the stock screen's sell checks on the snapshot's listed rows.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const [,, BUNDLE, SERVE, ROWS, OUT] = process.argv;
const m = await import(BUNDLE);
const DATE = '2026-11-12';
const NOW = Date.parse('2026-11-13T11:10:31Z');
const research = JSON.parse(readFileSync(`${SERVE}/research.json`, 'utf8'));
const listedRows = readFileSync(ROWS, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const listed = new Map(listedRows.map(r => [r.symbol, r]));
const ranking = m.engine.rankCandidates(research.rows, 'minervini', { now: NOW });
const liquid = m.presentation.filterRanked(ranking, { liquidOnly: true });
const liquidRank = new Map(liquid.map((it, i) => [it.row.symbol, i + 1]));
const out = [];
for (const item of ranking) {
  const sym = item.row.symbol;
  if (!listed.has(sym)) continue;
  const row = item.row;
  const view = m.cand.candidateView({ row, assessment: item.assessment }, DATE);
  const p = `${SERVE}/charts/${sym}.json`;
  const chart = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  const cert = chart ? m.certifyBars(row, chart, DATE) : { certified: false, reason: 'no chart' };
  const judged = cert.certified ? chart.bars : null;
  let diagnostics = null;
  if (judged) { try { diagnostics = m.diagnoseBookChart(row, chart, DATE); } catch { diagnostics = null; } }
  const sells = m.sell.stockSells({ judged, diagnostics, view });
  const fb = sells?.weakness?.find(c => c.key === 'failedBreakout') || null;
  const cc = judged ? m.readout.chartCrossing(judged, view.pivot) : null;
  out.push({ sym, liquidRank: liquidRank.get(sym) ?? null, ready: row.se_setup_ready, basis: listed.get(sym).bars_basis, certified: cert.certified, reason: cert.reason,
    state: view.state, position: view.position, stateLabel: view.stateLabel, pivot: view.pivot, distance: view.distance, price: view.price,
    pivotType: row.se_pivot_type ?? null, pivotDate: row.se_pivot_date ?? null, lowRange: row.price_activity?.lowRange ?? null,
    fb: fb ? { state: fb.state, date: fb.date ?? null, crossDate: fb.crossDate ?? null, ratio: fb.ratio ?? null, detail: fb.detail } : null,
    chartCrossing: cc ? { date: cc.date, ratio: cc.volumeRatio ?? null } : null,
    breakdownHits: sells?.breakdownHits ?? null,
    weak: sells ? sells.weakness.map(c => [c.key, c.state]) : null });
}
writeFileSync(OUT, out.map(o => JSON.stringify(o)).join('\n') + '\n');
const cert = out.filter(o => o.certified);
const cnt = k => { const c = {}; for (const o of cert) { const w = (o.weak || []).find(x => x[0] === k); const s = w ? w[1] : 'none'; c[s] = (c[s] || 0) + 1; } return c; };
console.log(JSON.stringify({ listed: out.length, certified: cert.length, failedBreakout: cnt('failedBreakout'), ma50: cnt('ma50'), book: cnt('book'), dayDown: cnt('day-down') }));
