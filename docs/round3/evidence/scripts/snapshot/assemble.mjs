// Snapshot step D: write rows.jsonl / ready43.jsonl / examples.json and the render fixture (research.json + charts).
// Served rows follow export-research.mjs's per-row additions (technical_audit from the served chart, 52-week distances,
// price_activity, entry_evidence with setupEvidence(buildBookAnnotations(bars)), rs_line, rs_line_high, setup_recalculation
// summary). SEC records, research details, earnings dates, institutional evidence and market trends are not served (未収録).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const [,, BUNDLE, WORK, SNAP, SERVE] = process.argv;
const m = await import(BUNDLE);
const DATE = '2026-11-12';
const cal = JSON.parse(readFileSync(`${WORK}/calendar.json`, 'utf8'));
const spy = JSON.parse(readFileSync(`${WORK}/benchmark.json`, 'utf8'));
const spyClose = new Map(spy.bars.map(b => [b.date, b.close]));
const inputs = new Map(readFileSync(`${WORK}/rows_in.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(r => [r.symbol, r]));
const evals = readFileSync(`${WORK}/eval-proxy.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const summary = JSON.parse(readFileSync(`${WORK}/eval-proxy.json`, 'utf8'));
const strict = JSON.parse(readFileSync(`${WORK}/eval-strict.json`, 'utf8'));
mkdirSync(`${SERVE}/charts`, { recursive: true });

const incoherent = bars => (bars || []).filter(b => !(b.low > 0 && b.volume >= 0 && b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close))).map(b => b.date);
const BASIS_NOTE = {
  bundle_seed_accepted: 'upstream daily-price-us-20261112 bars that the CI seed import accepted: the CI price cache, and so the published chart, held these bars (2dp, 310 sessions from 2025-08-21)',
  bundle_envelope_proxy: 'CI rejected these upstream bars (invalid_ohlcv) and refilled the symbol from Yahoo at run time (not obtainable here). Selection counted with each bar\'s high/low widened to its own open/close; the bars in this file and in the renders are the raw upstream bars, NOT the published ones',
};
const rows = [], served = [];
for (const e of evals) {
  const input = inputs.get(e.symbol), row = e.row, basis = row.setup_recalculation.bars_basis;
  const rawBars = basis === 'bundle_seed_accepted' || basis === 'bundle_envelope_proxy' ? input.bars : null;
  const audit = e.technical_audit, v = audit.valid ? audit.values : {};
  const shape = audit.valid && rawBars ? m.buildBookAnnotations(basis === 'bundle_seed_accepted' ? rawBars : rawBars.map(b => ({ ...b, high: Math.max(b.open, b.high, b.close, b.low), low: Math.min(b.open, b.low, b.close, b.high) }))) : null;
  const recent = audit.valid ? rawBars.slice(-51, -1) : [];
  const averageVolume = recent.length === 50 ? recent.reduce((s, b) => s + b.volume, 0) / 50 : null;
  const recent60 = audit.valid ? rawBars.slice(-60) : [];
  const range60 = recent60.length === 60 ? (Math.max(...recent60.map(b => b.high)) / Math.min(...recent60.map(b => b.low)) - 1) * 100 : null;
  const { setup_engine, ...scalars } = row;
  const servedRow = { ...scalars, technical_audit: audit, week_52_high_distance: audit.valid ? -v.belowHigh : null, week_52_low_distance: audit.valid ? v.aboveLow : null,
    price_activity: { range60pct: range60, lowRange: range60 != null && range60 < 5 },
    entry_evidence: { as_of_date: DATE, calendar: null, earnings: null, shape: m.setupEvidence({ ...row }, shape, DATE), volumeRatio: averageVolume > 0 ? rawBars.at(-1).volume / averageVolume : null },
    passes_template: audit.valid ? !e.rules.some(r => r.state !== 'pass') : null,
    setup_recalculation: { status: row.setup_recalculation.status, as_of_date: row.setup_recalculation.as_of_date, reason: row.setup_recalculation.reason },
    rs_line_high: e.rs_line_high, chart_path: rawBars ? `charts/${encodeURIComponent(e.symbol)}.json` : null };
  delete servedRow.setup_engine;
  served.push(servedRow);
  if (rawBars && (e.listed || audit.valid)) {
    const chart = { schema_version: 'static-charts-v2', symbol: e.symbol, as_of_date: DATE, bars: rawBars, session_calendar: cal,
      rs_line: rawBars.filter(b => spyClose.get(b.date) > 0).map(b => ({ time: b.date, value: b.close / spyClose.get(b.date) })),
      stock_data: servedRow, signal: null, risk_plan: null, sell_plan: null, trend_template: null };
    writeFileSync(`${SERVE}/charts/${encodeURIComponent(e.symbol)}.json`, JSON.stringify(chart));
  }
  if (!e.listed) continue;
  const f = input.feature, ex = setup_engine?.explain || {};
  const readiness = e.setup_readiness;
  rows.push({
    symbol: e.symbol, analysis_date: DATE, company_name: f.company_name, gics_sector: f.gics_sector, ibd_industry_group: f.ibd_industry_group,
    listed_as: e.qualified ? 'trend_template_8_of_8' : 'one_condition_short', ui_liquid_rank: e.ui_liquid_rank,
    close: rawBars ? rawBars.at(-1).close : row.current_price, current_price: servedRow.current_price, adv_usd: row.adv_usd,
    pivot: { se_pivot_price: row.se_pivot_price, canonical_vcp_pivot: row.vcp_pivot, pivot_type: row.se_pivot_type, pivot_date: row.se_pivot_date,
      distance_to_pivot_pct: row.se_distance_to_pivot_pct, in_early_zone: row.se_in_early_zone, extended_from_pivot: row.se_extended_from_pivot },
    setup_engine: { pattern_primary: row.se_pattern_primary, pattern_confidence: row.se_pattern_confidence, setup_score: row.se_setup_score, quality_score: row.se_quality_score,
      readiness_score: row.se_readiness_score, base_length_weeks: row.se_base_length_weeks, base_depth_pct: row.se_base_depth_pct, volume_vs_50d: row.se_volume_vs_50d,
      atr14_pct: row.se_atr14_pct, bb_squeeze: row.se_bb_squeeze, quiet_days_10d: row.se_quiet_days_10d, up_down_volume_ratio_10d: row.se_up_down_volume_ratio_10d,
      rs_line_new_high: row.se_rs_line_new_high, explain: { passed_checks: ex.passed_checks ?? null, failed_checks: ex.failed_checks ?? null, invalidation_flags: ex.invalidation_flags ?? null, diagnostics: ex.diagnostics ?? null },
      candidates: (setup_engine?.candidates || []).map(c => ({ pattern: c.pattern, pivot_price: c.pivot_price, pivot_date: c.pivot_date, start_date: c.start_date, end_date: c.end_date, confidence: c.confidence, setup_score: c.setup_score, checks: c.checks ?? null })) },
    setup_ready: readiness.state, setup_ready_failed_checks: readiness.state === 'fail' ? String(readiness.reason).split(' / ').filter(Boolean) : [],
    setup_recalculation: servedRow.setup_recalculation,
    stage: { stage: row.stage, stage_name: row.stage_name, se_stage: row.se_stage, ma_alignment: row.ma_alignment, se_ma_alignment_score: row.se_ma_alignment_score,
      inputs: { close: v.close ?? null, ma_50: row.ma_50, ma_150: row.ma_150, ma_200: row.ma_200, sma50: v.sma50 ?? null, sma150: v.sma150 ?? null, sma200: v.sma200 ?? null, sma200_21_sessions_ago: v.sma200_21ago ?? null,
        week52_high: v.high ?? null, week52_low: v.low ?? null, above_52w_low_pct: v.aboveLow ?? null, below_52w_high_pct: v.belowHigh ?? null } },
    trend_template: { qualified: e.qualified, passed: e.passed, failed: e.failed, unknown: e.unknown, total: e.total, rules: e.rules },
    rs_estimate: { value: e.rs_rating, method: e.rs_method, universe_size: e.rs_universe_size, note: 'RS推計: weighted 3/6/9/12-month return percentile over this rebuild\'s verified charts (published-bars method); not IBD RS' },
    backend_scanner_rs_rating: e.source_rs_rating, rs_line_high: e.rs_line_high,
    technical_audit: { status: audit.status, valid: audit.valid, bars: audit.bars, errors: audit.errors, values: audit.values },
    feature_run: { note: 'backend scan of 2026-11-12 (feature-run-us-2026-11-12, CI price cache, its own RS universe); NOT what the brief shows', passes_template: f.passes_template, stage: f.stage, stage_name: f.stage_name,
      rs_rating: f.rs_rating, current_price: f.current_price, se: f.se, se_failed_checks: f.se_failed_checks },
    bars_basis: basis, bars_basis_note: BASIS_NOTE[basis] ?? basis, bars_incoherent_dates: rawBars ? incoherent(rawBars) : null,
    bars: rawBars,
  });
}
rows.sort((a, b) => (a.ui_liquid_rank ?? 1e9) - (b.ui_liquid_rank ?? 1e9) || a.symbol.localeCompare(b.symbol));
writeFileSync(`${SNAP}/rows.jsonl`, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const ready = rows.filter(r => r.setup_ready === 'pass');
writeFileSync(`${SNAP}/ready43.jsonl`, ready.map(r => JSON.stringify(r)).join('\n') + '\n');
// Examples. PayloadMismatch: HTFL is the first symbol the CI coverage report names under invalid_payload.by_cause.PayloadMismatch
// (Static Site 43385558863, combine-and-build); listed here with exact (seed-accepted) bars. fiscal_q4_untagged: no log line or
// release asset names one, and the SEC file is not a release asset, so it stays 未検証.
const nonReady = rows.filter(r => r.setup_ready === 'fail' && r.ui_liquid_rank != null).slice(0, 10);
const pick = r => ({ symbol: r.symbol, ui_liquid_rank: r.ui_liquid_rank, listed_as: r.listed_as, setup_ready: r.setup_ready, setup_ready_failed_checks: r.setup_ready_failed_checks, bars_basis: r.bars_basis });
const examples = {
  analysis_date: DATE,
  payload_mismatch: { ...pick(rows.find(r => r.symbol === 'HTFL')), evidence: 'Static Site 43385558863 combine-and-build log: Published coverage (fundamentals) round2.invalid_payload = {count 112, by_cause {PayloadMismatch 112}, symbols [HTFL, SN, CART, BRZE, HNGE, BTSG, RAL, GFR, RSKD, ECO]} (実測, log). The SEC record itself is not a release asset: 未収録.' },
  fiscal_q4_untagged: { symbol: null, status: '未検証', reason: 'The CI report gives only counts (eps_unknown.primary.fiscal_q4_untagged 398); no log line names a symbol, and book-financials.json.gz (the SEC file) is not in any readable release asset. Not inferred.' },
  high_ranked_non_ready: { note: 'The 10 highest-ranked listed rows in the brief\'s own order (rankCandidates + filterRanked liquidOnly, as useBriefData) whose setup_ready is fail: a false-negative sample.', rows: nonReady.map(pick) },
};
writeFileSync(`${SNAP}/examples.json`, JSON.stringify(examples, null, 1));
writeFileSync(`${SERVE}/research.json`, JSON.stringify({ as_of_date: DATE, rows: served }));
writeFileSync(`${SNAP}/render-targets.json`, JSON.stringify({ ready: ready.map(r => r.symbol), examples: ['HTFL'], non_ready: nonReady.map(r => r.symbol) }, null, 1));
console.log(JSON.stringify({ rows: rows.length, ready: ready.length, non_ready: nonReady.map(r => [r.symbol, r.ui_liquid_rank, r.bars_basis]), served: served.length,
  listed_basis: rows.reduce((o, r) => (o[r.bars_basis] = (o[r.bars_basis] || 0) + 1, o), {}), proxy_counts: { listed: summary.listed, strict_listed: strict.listed } }));
