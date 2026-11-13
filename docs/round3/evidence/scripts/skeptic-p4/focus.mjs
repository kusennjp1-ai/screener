import { readFileSync } from 'node:fs';
const [,, BUNDLE, SERVE, EV] = process.argv;
const m = await import(BUNDLE);
const DATE = '2026-11-12', NOW = Date.parse('2026-11-13T11:10:31Z');
const research = JSON.parse(readFileSync(`${SERVE}/research.json`, 'utf8'));
const ev = new Map(readFileSync(EV, 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(o => [o.sym, o]));
const ranking = m.engine.rankCandidates(research.rows, 'minervini', { now: NOW });
const liquid = m.presentation.filterRanked(ranking, { liquidOnly: true });
const bundle = { rankings: { minervini: ranking }, date: DATE };
console.log('counts', JSON.stringify(m.cand.focusCounts(liquid, DATE, bundle)));
const pool = liquid.map((it, i) => ({ it, rank: i + 1 })).filter(x => x.it.assessment.qualified).map(x => ({ v: m.cand.candidateView(x.it, DATE), rank: x.rank }))
  .filter(({ v }) => v.state === 'zone' || (v.state === 'wait' && Number.isFinite(v.distance) && v.distance >= -5));
const cert = pool.filter(p => ev.get(p.v.symbol)?.certified);
console.log('pool', pool.length, 'certified', cert.length, 'notInEv', pool.filter(p => !ev.get(p.v.symbol)).length);
const hits = cert.filter(p => ev.get(p.v.symbol).fb?.state === 'hit');
for (const p of hits) { const o = ev.get(p.v.symbol); console.log(p.v.symbol, p.rank, p.v.state, p.v.stateLabel, p.v.distance.toFixed(2), o.fb.crossDate, o.pivotType, o.pivotDate); }
// muted?
console.log('baseMuted among hits', hits.filter(p => m.cand.baseMuted ? m.cand.baseMuted(p.v) : null).map(p => p.v.symbol));
