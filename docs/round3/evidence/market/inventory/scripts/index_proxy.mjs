// The app's own distribution-day count, follow-through state and index position (the exact functions the exporter
// runs: distributionDays, followThroughDay, indexState/indexSummary) on:
//  (a) the real ^GSPC/^IXIC Yahoo bars of the market-regime study release (through 2026-11-03), and
//  (b) SPY/QQQ bars of the upstream daily price bundle (through 2026-11-12) as an ETF PROXY (推論: ETF volume is not index volume).
// For each date in a calibration window, (a) and (b) are compared on the same session, so the proxy's agreement is measured.
import { readFileSync, writeFileSync } from 'node:fs';
const W = '/home/user/screener/.claude/worktrees/r3-market-audit/frontend/src/static';
const { distributionDays } = await import(`${W}/distributionDays.js`);
const { followThroughDay } = await import(`${W}/followThroughDay.js`);
const { indexSummary } = await import(`${W}/reference/indexSummary.js`);
const [studyPath, spyPath, qqqPath, outPath] = process.argv.slice(2);
const study = JSON.parse(readFileSync(studyPath, 'utf8'));
const real = Object.fromEntries(study.indices.map(ix => [ix.symbol, ix.bars]));
const proxy = { '^GSPC': JSON.parse(readFileSync(spyPath, 'utf8')), '^IXIC': JSON.parse(readFileSync(qqqPath, 'utf8')) };
// The exporter's window: the last 280 calendar sessions up to the date (collect-market-trends.py sessions[-280:]).
const judge = (symbol, bars, asOf) => {
  const upto = bars.filter(b => b.date <= asOf).slice(-280).map(b => ({ date: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
  const sessions = upto.map(b => b.date);
  const dd = distributionDays({ symbol, bars: upto, sessions, asOfDate: asOf });
  const ft = dd.available ? followThroughDay({ symbol, bars: upto, asOfDate: asOf, distributionEvents: dd.events }) : null;
  const pos = indexSummary(upto.map(b => ({ date: b.date, close: b.close })));
  return { asOf, bars: upto.length, dist: dd.available ? dd.latest.value : null, distReason: dd.available ? null : dd.reason,
    active: dd.available ? dd.events.filter(e => e.state === 'active').map(e => e.date) : null,
    ft: ft && { state: ft.state, peak: ft.peak, low: ft.low, declinePct: ft.declinePct && +ft.declinePct.toFixed(2), attempt: ft.attempt, ftd: ft.ftd, failedDate: ft.failedDate, peakAtWindowStart: ft.peakAtWindowStart, lastEvents: ft.events.slice(-4) },
    pos: pos && { date: pos.date, close: pos.close, vs50: +pos.vsMa.toFixed(2), vs200: pos.vs200 === null ? null : +pos.vs200.toFixed(2), fromHigh: +pos.fromHigh.toFixed(2), fullYear: pos.fullYear } };
};
const out = { calibration: {}, proxy1112: {}, real1103: {} };
for (const symbol of ['^GSPC', '^IXIC']) {
  const days = real[symbol].map(b => b.date).filter(d => d >= '2026-08-01' && d <= '2026-11-03');
  let distSame = 0, ftSame = 0, n = 0; const rows = [];
  for (const d of days) {
    if (!proxy[symbol].some(b => b.date === d)) continue;
    const a = judge(symbol, real[symbol], d), b = judge(symbol, proxy[symbol], d);
    n++; if (a.dist === b.dist) distSame++; if (a.ft?.state === b.ft?.state) ftSame++;
    rows.push([d, a.dist, b.dist, a.ft?.state, b.ft?.state]);
  }
  out.calibration[symbol] = { window: [days[0], days.at(-1)], sessions: n, distEqual: distSame, ftStateEqual: ftSame, rows };
  out.real1103[symbol] = judge(symbol, real[symbol], '2026-11-03');
  out.proxy1103 ??= {}; out.proxy1103[symbol] = judge(symbol, proxy[symbol], '2026-11-03');
  out.proxy1112[symbol] = judge(symbol, proxy[symbol], '2026-11-12');
}
writeFileSync(outPath, JSON.stringify(out, null, 1));
for (const s of ['^GSPC', '^IXIC']) {
  const c = out.calibration[s];
  console.log(s, 'calibration', c.window, 'sessions', c.sessions, 'dist equal', c.distEqual, 'ft state equal', c.ftStateEqual);
  console.log(' real 11-03:', JSON.stringify({ dist: out.real1103[s].dist, ft: out.real1103[s].ft?.state, pos: out.real1103[s].pos }));
  console.log(' proxy 11-03:', JSON.stringify({ dist: out.proxy1103[s].dist, ft: out.proxy1103[s].ft?.state, pos: out.proxy1103[s].pos }));
  console.log(' proxy 11-12:', JSON.stringify({ dist: out.proxy1112[s].dist, active: out.proxy1112[s].active, ft: out.proxy1112[s].ft, pos: out.proxy1112[s].pos }));
}
