// p4-risk-sell-regime: Today's focus pool on the snapshot's real rows (main 8849bf9's focusCandidates/focusCounts), and
// for every listed zone/near row with certified bars: the heavy-volume pivot crossings of its current pivot in the last 60
// sessions (pivotCrossings + breakoutBar, the failed-breakout check's own helpers), whether each was followed by a close back
// under the pivot, and how many sessions ago. A failure older than SELL_RULES.failedBreakoutSessions is no longer a sell
// check ('clear') and the row reads as a buy candidate again.
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
const bundle = { rankings: { minervini: ranking }, date: DATE };
const views = liquid.map(item => m.cand.candidateView(item, DATE, { now: NOW }));
const focus = m.cand.focusCandidates(liquid, DATE, 5, bundle);
const counts = m.cand.focusCounts(liquid, DATE, bundle);
const out = { market, counts, headingNote: m.cand.focusHeadingNote(market, 'ready'), focusTone: m.cand.focusTone('ready', counts, market),
  focus: focus.map(v => ({ symbol: v.symbol, position: v.position, stateLabel: v.stateLabel, rowEvent: v.rowEvent, baseCurrent: v.baseCurrent, setup_ready: v.row.se_setup_ready ?? null,
    watch: m.cand.watchEvent(v, market) })) };
const R = m.sell.SELL_RULES, cents = x => Math.round(x * 100);
const forgotten = [];
for (const view of views) {
  if (!listed.has(view.symbol) || !(view.position === 'zone' || view.position === 'near')) continue;
  const path = `${SERVE}/charts/${view.symbol}.json`;
  if (!existsSync(path)) continue;
  const chart = JSON.parse(readFileSync(path, 'utf8'));
  if (!m.certifyBars(view.row, chart, DATE).certified) continue;
  const bars = chart.bars, n = bars.length, pivot = view.pivot;
  if (!(pivot > 0)) continue;
  const crossings = m.history.pivotCrossings(bars, pivot, { lookback: m.history.CROSSING_LOOKBACK_SESSIONS }).map(c => m.history.breakoutBar(bars, pivot, c)).filter(Boolean);
  for (const c of crossings) {
    if (!(c.volumeRatio >= R.breakVolumeRatio)) continue;
    // A close back under the pivot after the breakout, before the next crossing.
    let failedAt = null;
    for (let i = c.index + 1; i < n; i++) if (cents(bars[i].close) < cents(pivot)) { failedAt = i; break; }
    if (failedAt === null) continue;
    const minAfter = Math.min(...bars.slice(failedAt).map(b => b.close));
    forgotten.push({ symbol: view.symbol, rank: liquid.findIndex(x => x.row.symbol === view.symbol) + 1, qualified: view.qualified, position: view.position, stateLabel: view.stateLabel,
      distance: view.distance, setup_ready: view.row.se_setup_ready ?? null, pivot, breakoutDate: c.date, breakoutRatio: c.volumeRatio, breakoutSessionsAgo: c.sessionsAgo,
      backUnderDate: bars[failedAt].date, backUnderSessionsAgo: n - 1 - failedAt, lowestCloseSince: minAfter, lowestFromPivotPct: (minAfter / pivot - 1) * 100,
      checkWindow: c.sessionsAgo <= R.failedBreakoutSessions ? 'in-window' : 'beyond-window' });
    break; // the latest heavy breakout that failed
  }
}
out.forgotten = forgotten;
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ market, counts, headingNote: out.headingNote, focus: out.focus.map(f => `${f.symbol} ${f.stateLabel} ${f.watch.title} ${f.watch.tone}`),
  forgotten: forgotten.length, beyond: forgotten.filter(f => f.checkWindow === 'beyond-window').length }, null, 1));
