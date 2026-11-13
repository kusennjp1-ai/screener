// For every listed row with certified bars and a pivot: the crossings the brief dates (pivotCrossings over 60 sessions with
// breakoutBar, as crossingEvent, the chart mark and the failed-breakout check read them) against the Setup Engine's own pivot
// date (se_pivot_date). A crossing before the pivot's own date is a close through a level that was not yet the pivot.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
const [,, BUNDLE, SERVE, EVAL, OUT] = process.argv;
const m = await import(BUNDLE);
const research = JSON.parse(readFileSync(`${SERVE}/research.json`, 'utf8'));
const by = new Map(research.rows.map(r => [r.symbol, r]));
const ev = readFileSync(EVAL, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const out = [], tally = { rows: 0, withCrossing: 0, beforePivotDate: 0, eventsBefore: {}, failedBefore: 0, failedTotal: 0, byType: {} };
for (const r of ev) {
  if (!r.certified || !(r.pivot > 0)) continue;
  const row = by.get(r.symbol), date = row.se_pivot_date, type = row.se_pivot_type || null;
  const bars = JSON.parse(readFileSync(`${SERVE}/charts/${r.symbol}.json`, 'utf8')).bars;
  tally.rows++;
  const crossings = m.history.pivotCrossings(bars, r.pivot, { lookback: m.history.CROSSING_LOOKBACK_SESSIONS });
  if (!crossings.length) continue;
  tally.withCrossing++;
  const last = crossings[0], before = typeof date === 'string' && last.date <= date;
  const gEvent = r.gate?.event?.kind || null;
  const failed = r.sells?.weakness?.find(c => c.key === 'failedBreakout' && c.state === 'hit');
  if (failed) { tally.failedTotal++; if (typeof date === 'string' && failed.crossDate <= date) tally.failedBefore++; }
  if (before) {
    tally.beforePivotDate++;
    tally.byType[type] = (tally.byType[type] || 0) + 1;
    if (gEvent) tally.eventsBefore[gEvent] = (tally.eventsBefore[gEvent] || 0) + 1;
    out.push({ symbol: r.symbol, rank: r.liquidRank, qualified: r.qualified, position: r.position, pivot: r.pivot, pivotDate: date, pivotType: type, lastCrossing: last.date, crossingRatio: last.volumeRatio, gateEvent: r.gate?.event?.title || null, gateTitle: r.gate?.title, failed: Boolean(failed) });
  }
}
writeFileSync(OUT, JSON.stringify({ tally, rows: out }, null, 1));
console.log(JSON.stringify(tally, null, 1));
for (const o of out.filter(o => o.rank && o.rank <= 200)) console.log(o.symbol, o.rank, o.position, o.pivotType, 'pivot', o.pivotDate, 'crossing', o.lastCrossing, '|', o.gateEvent, '|', o.gateTitle);
