// Public rules, independent estimates. Never substitute QoQ for YoY or missing for zero.
export const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// The feature store exports positive % BELOW the high; the legacy technical
// calculator exports negative distance. Normalize magnitude at this boundary.
export const highDistance = (row) => finite(row.week_52_high_distance) ? Math.abs(row.week_52_high_distance) : null;
const rule = (label, value, test, unit = '') => ({ label, value, unit, state: value == null || (typeof value === 'number' && !finite(value)) ? 'unknown' : test(value) ? 'pass' : 'fail' });
export function assess(row, method = 'minervini') {
  const common = [rule('RS 推計 ≥ 80', row.rs_rating, v => v >= 80)];
  const rules = method === 'minervini' ? [
    rule('トレンドテンプレート通過', row.passes_template, v => v === true),
    rule('RS 推計 ≥ 70', row.rs_rating, v => v >= 70),
    rule('52週安値から ≥ 30%', row.week_52_low_distance, v => v >= 30, '%'),
    rule('52週高値からの距離 ≤ 25%', highDistance(row), v => v <= 25, '%'),
  ] : method === 'oneil' ? [
    rule('C：四半期 EPS 前年同期比 ≥ 25%', row.eps_growth_yy, v => v >= 25, '%'),
    rule('売上高 前年同期比 ≥ 25%', row.sales_growth_yy, v => v >= 25, '%'),
    rule('A：年間 EPS 3年成長率 ≥ 25%', row.eps_cagr_3y, v => v >= 25, '%'),
    rule('N：52週高値からの距離 ≤ 15%（代替指標）', highDistance(row), v => v <= 15, '%'),
    rule('S：出来高 / 50日平均 ≥ 1.4', row.se_volume_vs_50d, v => v >= 1.4, '倍'),
    ...common,
    rule('I：機関投資家の保有社数が増加', row.institutional_sponsors_increasing, v => v === true),
    rule('M：市場が50日線・200日線より上', row.market_above_50dma == null || row.market_above_200dma == null ? null : row.market_above_50dma && row.market_above_200dma, v => v === true),
  ] : [
    rule('Composite 推計 ≥ 90', row.composite_rating, v => v >= 90),
    rule('RS 推計 ≥ 85', row.rs_rating, v => v >= 85),
    rule('EPS 推計 ≥ 80', row.eps_rating, v => v >= 80),
    rule('業種順位 推計 ≤ 40', row.ibd_group_rank, v => v >= 1 && v <= 40),
    rule('52週高値からの距離 ≤ 15%', highDistance(row), v => v <= 15, '%'),
  ];
  const passed = rules.filter(r => r.state === 'pass').length;
  const failed = rules.filter(r => r.state === 'fail').length;
  return { rules, passed, failed, unknown: rules.length - passed - failed, total: rules.length,
    qualified: passed === rules.length, score: Math.round(passed / rules.length * 100) };
}

export function entryPlan(row, quote) {
  const price = finite(quote?.price) && quote.price > 0 ? quote.price : row.current_price;
  const pivot = row.se_pivot_price ?? row.vcp_pivot;
  if (!finite(price) || price <= 0 || !finite(pivot) || pivot <= 0) return { state: '未判定', price, pivot: null, distance: null };
  const distance = (price / pivot - 1) * 100;
  return { price, pivot, distance, upper: pivot * 1.05, pivotSource: row.se_pivot_price != null ? 'Setup Engine' : 'VCP',
    state: distance < 0 ? 'ピボット待ち' : distance <= 5 + 1e-9 ? '買いゾーン内' : '買いゾーン超過',
    // A transparent example, not a claim that a pattern-specific stop was detected.
    stopExample: price * .93 };
}

export function rankCandidates(rows, method, { search = '', qualifiedOnly = false, watchlist = null, liquidOnly = false } = {}) {
  const query = search.trim().toUpperCase();
  return rows.filter(r => r.market === 'US' || !r.market)
    .filter(r => !liquidOnly || (finite(r.current_price) && r.current_price >= 10 && finite(r.adv_usd) && r.adv_usd >= 20000000))
    .filter(r => `${r.symbol} ${r.company_name || ''}`.toUpperCase().includes(query))
    .filter(r => !watchlist || watchlist.includes(r.symbol))
    .map(row => ({ row, assessment: assess(row, method) }))
    .filter(r => !qualifiedOnly || r.assessment.qualified)
    .sort((a, b) => b.assessment.score - a.assessment.score || (b.row.rs_rating ?? -1) - (a.row.rs_rating ?? -1) || a.row.symbol.localeCompare(b.row.symbol));
}

export function quoteStatus(quote, now = Date.now()) {
  if (!quote || !finite(quote.price) || quote.price <= 0) return '未接続';
  const age = now - Date.parse(quote.as_of);
  if (!Number.isFinite(age) || age < -5000 || age > 90000) return '期限切れ';
  return quote.is_realtime === true && quote.delay_seconds === 0 ? 'リアルタイム' : '遅延データ';
}

export function compareReference(candidates, reference, date) {
  if (!reference || reference.as_of_date !== date || reference.verified !== true) return null;
  const symbols = new Set((reference.constituents || []).map(s => typeof s === 'string' ? s : s.symbol));
  if (!symbols.size) return null;
  const selected = [...new Set(candidates.map(r => r.symbol))].slice(0, 50);
  const hits = selected.filter(s => symbols.has(s));
  return { hits, recall: hits.length / symbols.size, precision: selected.length ? hits.length / selected.length : 0, total: symbols.size };
}
