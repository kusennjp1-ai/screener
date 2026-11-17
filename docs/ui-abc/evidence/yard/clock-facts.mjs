#!/usr/bin/env node
// SCRATCH (ui-abc yardstick, never committed): the clock facts of S1-P0 item 6 / plan D18, computed with the tree's OWN
// modules (esbuild bundle of marketUpdateState.js, marketTabModel.js's verdictWaiting, briefFreshness.js and
// portfolioPlan.js's modelMarket) on the tree's own fixture market asset (brief-fixture.js marketTrends()).
// Usage: node clock-facts.mjs <worktree> <outdir>   → <outdir>/clock-facts.json (+ prints a table)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [, , W0, OUT0] = process.argv;
const W = resolve(W0), OUT = resolve(OUT0), F = `${W}/frontend`;
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/clock-entry.mjs`, [
  `export { marketUpdateState } from '${F}/src/static/marketUpdateState.js';`,
  `export { verdictWaiting } from '${F}/src/static/brief/marketTabModel.js';`,
  `export { freshness, freshnessLine } from '${F}/src/static/brief/briefFreshness.js';`,
  `export { modelMarket, capText } from '${F}/src/static/portfolioPlan.js';`,
].join('\n'));
execFileSync(`${F}/node_modules/.bin/esbuild`, ['clock-entry.mjs', '--bundle', '--platform=node', '--format=esm', '--log-level=warning',
  '--define:import.meta.env={"DEV":false,"PROD":true,"MODE":"production","BASE_URL":"/","VITE_STATIC_SITE":"true"}', '--outfile=clock-bundle.mjs'], { cwd: OUT });
const m = await import(`${OUT}/clock-bundle.mjs`);
const fx = await import(`${F}/tests/static/brief-fixture.js`);
const trends = JSON.parse(fx.marketTrends().text);
const date = fx.date;
const markets = { m50: m.modelMarket(fx.rows), m25: m.modelMarket(fx.rows.map(r => ({ ...r, market_regime: 'uptrend_under_pressure' }))), m0: m.modelMarket(fx.rows.map(r => ({ ...r, market_above_50dma: false, market_regime: 'correction' }))) };
const at = iso => {
  const now = Date.parse(iso), update = m.marketUpdateState(trends, now), fresh = m.freshness({ trends, date, now });
  const line = m.freshnessLine(fresh, date);
  return { clock: iso, weekday: new Date(now).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' }),
    marketUpdateState: { state: update.state, target: update.target }, freshness: { state: fresh.state, missing: fresh.missing }, barAge: line ? `${line.tone}:${line.age}` : null,
    verdictWaiting: Object.fromEntries(Object.entries(markets).map(([k, market]) => [k, m.verdictWaiting({ market, date, target: update.target })?.short ?? null])) };
};
const CASES = [
  ['fixture clock (FINANCIAL_TEST_NOW, a Saturday; openBrief pins every spec here)', new Date(fx.now).toISOString()],
  ['(a) weekday mid-session: Mon 10/5 11:00 ET', '2026-10-05T15:00:00Z'],
  ['(b) 10 minutes after the US close: Mon 10/5 16:10 ET (yard PENDING)', '2026-10-05T20:10:00Z'],
  ['(c) Saturday 10/3 (the fixture clock day)', '2026-10-03T20:00:00Z'],
  ['(c2) the next Saturday 10/10 (past the fixture schedule valid_until)', '2026-10-10T16:00:00Z'],
  ['(d) the real wall clock now', new Date().toISOString()],
  ['brief-chart.spec.js:715,720 before (same as fixture clock)', '2026-10-03T16:35:00Z'],
  ['brief-chart.spec.js:715,720 on the day', '2026-10-06T16:00:00Z'],
  ['brief-chart.spec.js:715,720 after', '2026-10-07T16:00:00Z'],
  ['brief-invariants.spec.js:495,507 the day before', '2026-10-05T16:00:00Z'],
  ['brief-invariants.spec.js:495,507 on the day', '2026-10-06T16:00:00Z'],
  ['brief-invariants.spec.js:495,507 after', '2026-10-07T16:00:00Z'],
  ['brief-freshness.spec.js:9,20 TWO_LATER (= brief-market-r3.spec.js:171,194; yard LATE)', '2026-10-07T09:00:00Z'],
  ['brief-freshness.spec.js:10,20 WITHIN_GRACE', '2026-10-06T21:00:00Z'],
];
const out = { tree: execFileSync('git', ['-C', W, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim(), date, fixture_now: new Date(fx.now).toISOString(),
  sessions_tail: fx.sessions.slice(-3), schedule: { valid_until: trends.refresh_schedule.valid_until, sessions: trends.refresh_schedule.sessions.map(s => `${s.date}@${s.close_at.slice(11, 16)}Z`) },
  markets: Object.fromEntries(Object.entries(markets).map(([k, v]) => [k, `${v.label} cap ${v.cap}`])), cases: CASES.map(([name, iso]) => ({ name, ...at(iso) })) };
writeFileSync(`${OUT}/clock-facts.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ date: out.date, fixture_now: out.fixture_now, valid_until: out.schedule.valid_until, schedule: out.schedule.sessions, markets: out.markets }));
for (const c of out.cases) console.log(`${c.name}\n   ${c.clock} ${c.weekday}  target=${c.marketUpdateState.target} (${c.marketUpdateState.state})  freshness=${c.freshness.state}${c.barAge ? ` bar=${c.barAge}` : ''}  waiting m50=${c.verdictWaiting.m50} m25=${c.verdictWaiting.m25} m0=${c.verdictWaiting.m0}`);
