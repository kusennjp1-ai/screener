// Snapshot step C: the publication's selection on the rebuilt rows, with main 8849bf9's own modules (esbuild bundle).
// Mirrors export-research.mjs for the fields the Minervini listing reads: auditDailyBars on the chart object,
// rankVerifiedUniverse, assess(row,'minervini',evaluatedAt) -> qualification-audit results -> briefRows (report-data-coverage),
// setupReadiness, rsLineHighSummary on close/SPY, rankCandidates + filterRanked(liquidOnly) for the UI order.
import { readFileSync, writeFileSync } from 'node:fs';
const [,, BUNDLE, WORK, VARIANT] = process.argv;
const m = await import(BUNDLE);
const DATE = '2026-11-12';
const NOW = Date.parse('2026-11-13T10:14:12Z'); // the second export-research run of Static Site 43385558863
const cal = JSON.parse(readFileSync(`${WORK}/calendar.json`, 'utf8'));
const spy = JSON.parse(readFileSync(`${WORK}/benchmark.json`, 'utf8'));
const spyClose = new Map(spy.bars.map(b => [b.date, b.close]));
const recalc = new Map(readFileSync(`${WORK}/recalc-${VARIANT}.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(r => [r.symbol, r]));
const inputs = readFileSync(`${WORK}/rows_in.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const envelope = bars => bars.map(b => ({ ...b, high: Math.max(b.open, b.high, b.close, b.low), low: Math.min(b.open, b.low, b.close, b.high) }));

const rows = [], charts = new Map();
for (const input of inputs) {
  const r = recalc.get(input.symbol); const f = input.feature;
  const basis = r.setup_recalculation.bars_basis;
  // The chart the publication would carry: bundle bars when CI's DB held them; the envelope proxy only in the proxy variant.
  const bars = basis === 'bundle_seed_accepted' ? input.bars : basis === 'bundle_envelope_proxy' ? envelope(input.bars) : null;
  const { setup_engine, ...scalars } = r;
  const row = { symbol: input.symbol, market: 'US', currency: 'USD', company_name: f.company_name, gics_sector: f.gics_sector,
    ibd_industry_group: f.ibd_industry_group, ibd_group_rank: f.ibd_group_rank, market_regime: f.market_regime,
    ...scalars, current_price: r.setup_recalculation.status === 'calculated' ? r.current_price : f.current_price,
    setup_engine, as_of_date: DATE };
  const chart = bars ? { symbol: input.symbol, as_of_date: DATE, bars, session_calendar: cal } : null;
  row.technical_audit = m.qa.auditDailyBars(row, chart, DATE);
  if (row.technical_audit.valid) chart.rs_line = chart.bars.filter(b => spyClose.get(b.date) > 0).map(b => ({ time: b.date, value: b.close / spyClose.get(b.date) }));
  // export-research.mjs sets these before anything is ranked (rankCandidates sorts lowRange / cash-acquisition rows last).
  const recent60 = row.technical_audit.valid ? chart.bars.slice(-60) : [];
  const range60 = recent60.length === 60 ? (Math.max(...recent60.map(b => b.high)) / Math.min(...recent60.map(b => b.low)) - 1) * 100 : null;
  row.price_activity = { range60pct: range60, lowRange: range60 != null && range60 < 5 };
  row.week_52_high_distance = row.technical_audit.valid ? -row.technical_audit.values.belowHigh : null;
  row.week_52_low_distance = row.technical_audit.valid ? row.technical_audit.values.aboveLow : null;
  if (row.symbol === 'SLAB' && DATE >= '2026-02-04') row.corporate_action = { cash_acquisition: true, label: '現金買収合意（成長株の購入候補から除外）', announced: '2026-02-04', source: 'https://investor.silabs.com/news-releases/news-release-details/texas-instruments-acquire-silicon-labs' };
  charts.set(input.symbol, chart);
  rows.push(row);
}
const ranked = m.qa.rankVerifiedUniverse(rows);
const bySymbol = new Map(ranked.map(row => [row.symbol, row]));
const results = ranked.map(row => ({ symbol: row.symbol, audit: row.technical_audit, methods: { minervini: m.engine.assess(row, 'minervini', NOW) } }));
const audit = { as_of_date: DATE, results };
const listed = m.briefRows(audit, DATE), listedSet = new Set(listed);
const assessed = new Map(results.map(r => [r.symbol, r.methods.minervini]));
const tally = {}, ready = { pass: 0, fail: 0, unknown: 0 }, readyRows = [];
let rsHigh = { certified: 0, value_true: 0, leading_true: 0 };
const rsLine = new Map();
for (const row of ranked) {
  const chart = charts.get(row.symbol);
  const summary = row.technical_audit.valid ? m.rsLineHighSummary({ rsLineNewHigh: m.chartModel.rsLineNewHigh, rsLeadMarks: m.chartModel.rsLeadMarks }, { audit: row.technical_audit, chart, date: DATE }) : null;
  rsLine.set(row.symbol, summary);
  if (summary) { rsHigh.certified++; if (summary.value === true) rsHigh.value_true++; if (summary.leading === true) rsHigh.leading_true++; }
}
for (const symbol of listed) {
  const row = bySymbol.get(symbol), s = m.readiness.setupReadiness(row);
  ready[s.state]++;
  if (s.state === 'pass') readyRows.push(symbol);
  if (s.state === 'fail') for (const c of String(row.setup_recalculation?.reason || '').split(' / ').map(x => x.trim()).filter(Boolean)) tally[c] = (tally[c] || 0) + 1;
}
// UI order: rankCandidates (researchPreprocess) then filterRanked(liquidOnly) as useBriefData does.
const uiRanked = m.presentation.filterRanked(m.engine.rankCandidates(ranked, 'minervini', { now: NOW }), { liquidOnly: true });
const uiOrder = new Map(uiRanked.map((item, i) => [item.row.symbol, i + 1]));
const basisCount = (symbols) => symbols.reduce((o, s) => { const b = bySymbol.get(s).setup_recalculation.bars_basis; o[b] = (o[b] || 0) + 1; return o; }, {});
const summary = { variant: VARIANT, rows: ranked.length, calculated: ranked.filter(r => r.setup_recalculation.status === 'calculated').length,
  verified: ranked.filter(r => r.technical_audit.valid).length, rs_universe: ranked[0].rs_universe_size,
  qualified: results.filter(r => r.methods.minervini.qualified).length, listed: listed.length,
  listed_one_fail: listed.filter(s => !assessed.get(s).qualified).length,
  setup_ready: ready, top_failed_checks: Object.entries(tally).sort((a, b) => b[1] - a[1]),
  rs_line_high_certified: rsHigh, ui_liquid_listed: listed.filter(s => uiOrder.has(s)).length,
  listed_bars_basis: basisCount(listed), ready_bars_basis: basisCount(readyRows), ready: readyRows };
writeFileSync(`${WORK}/eval-${VARIANT}.json`, JSON.stringify(summary, null, 1));
// Per-row evaluation for the listed rows (and everything else needed to assemble the snapshot).
const out = [];
for (const row of ranked) {
  const a = assessed.get(row.symbol);
  out.push({ symbol: row.symbol, listed: listedSet.has(row.symbol), ui_liquid_rank: uiOrder.get(row.symbol) ?? null,
    qualified: a.qualified, passed: a.passed, failed: a.failed, unknown: a.unknown, total: a.total,
    rules: a.rules.map(rule => ({ label: rule.label, state: rule.state, value: rule.value ?? null, evidence: rule.evidence ?? null })),
    setup_readiness: m.readiness.setupReadiness(row), rs_rating: row.rs_rating, rs_method: row.rs_method, rs_universe_size: row.rs_universe_size,
    source_rs_rating: row.source_rs_rating, technical_audit: row.technical_audit, rs_line_high: rsLine.get(row.symbol),
    row: Object.fromEntries(Object.entries(row).filter(([k]) => !['technical_audit', 'rs_sparkline_data'].includes(k))) });
}
writeFileSync(`${WORK}/eval-${VARIANT}.jsonl`, out.map(o => JSON.stringify(o)).join('\n') + '\n');
console.log(JSON.stringify({ ...summary, ready: readyRows.length }, null, 1));
