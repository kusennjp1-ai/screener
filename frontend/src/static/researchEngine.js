import { auditValues, RS_METHOD } from './qualificationAudit.js';
// Public rules, independent estimates. Never substitute QoQ for YoY or missing for zero.
export const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// Calendar age is deliberately not an exchange-session count (holidays vary).
export function snapshotFreshness(date, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { state: 'unknown', days: null };
  const stamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date) return { state: 'unknown', days: null };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - stamp) / 86400000);
  return { state: days < 0 ? 'future' : days >= 4 ? 'old' : 'recent', days };
}

export function researchCsv(ranked, method, date) {
  const cell = value => {
    let text = String(value ?? '');
    // Text that starts with spreadsheet formula syntax must remain literal.
    if (typeof value === 'string' && /^[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const header = ['as_of_date', 'symbol', 'method', 'qualified', 'passed', 'total', 'unknown', 'rs_estimate', 'daily_price', 'pivot', 'failed_rules', 'unknown_rules'];
  const lines = ranked.map(({ row: r, assessment: a }) => [date, r.symbol, method, a.qualified, a.passed, a.total, a.unknown, r.rs_rating, r.current_price, r.se_pivot_price ?? r.vcp_pivot,
    a.rules.filter(rule => rule.state === 'fail').map(rule => rule.label).join(' / '), a.rules.filter(rule => rule.state === 'unknown').map(rule => rule.label).join(' / ')]);
  return [header, ...lines].map(line => line.map(cell).join(',')).join('\r\n');
}
// The feature store exports positive % BELOW the high; the legacy technical
// calculator exports negative distance. Normalize magnitude at this boundary.
export const highDistance = (row) => finite(auditValues(row).belowHigh) ? auditValues(row).belowHigh : finite(row.week_52_high_distance) ? Math.abs(row.week_52_high_distance) : null;
const rule = (label, value, test, unit = '', boolean = false) => ({ label, value, unit, state: (boolean ? typeof value !== 'boolean' : !finite(value)) ? 'unknown' : test(value) ? 'pass' : 'fail' });
const rating = value => finite(value) && value >= 1 && value <= 99 ? value : null;
const comparison = (label, values, test, evidence) => ({ ...rule(label, values.every(v => finite(v) && v > 0) ? test(...values) : null, v => v, '', true), evidence });
export function assess(row, method = 'minervini') {
  if (!['minervini', 'oneil', 'ibd'].includes(method)) throw Error('Unknown research method');
  const v = auditValues(row);
  const rs = row.rs_method === RS_METHOD && row.rs_universe_size >= 100 && row.rs_as_of_date === row.technical_audit?.as_of_date ? rating(row.rs_rating) : null;
  const display = n => finite(n) ? n.toFixed(2) : '未確認';
  const integrity = rule('日足の銘柄・日付・価格整合性（252本以上）', Object.keys(v).length ? true : row.technical_audit?.errors?.length ? false : null, x => x, '', true);
  integrity.evidence = row.technical_audit?.errors?.join(' / ') || `基準日 ${row.technical_audit?.as_of_date || '未確認'}・${row.technical_audit?.bars || 0}本`;
  const trend = [
    comparison('株価 > SMA150・SMA200', [v.close, v.sma150, v.sma200], (p, a, b) => p > a && p > b, `${display(v.close)} > ${display(v.sma150)} / ${display(v.sma200)}`),
    comparison('SMA150 > SMA200', [v.sma150, v.sma200], (a, b) => a > b, `${display(v.sma150)} > ${display(v.sma200)}`),
    comparison('SMA200が21営業日前より上（1か月の上向き判定）', [v.sma200, v.sma200_21ago], (a, b) => a > b, `${display(v.sma200)} > ${display(v.sma200_21ago)}`),
    comparison('SMA50 > SMA150・SMA200', [v.sma50, v.sma150, v.sma200], (a, b, c) => a > b && a > c, `${display(v.sma50)} > ${display(v.sma150)} / ${display(v.sma200)}`),
    comparison('株価 > SMA50', [v.close, v.sma50], (a, b) => a > b, `${display(v.close)} > ${display(v.sma50)}`),
    rule('252日安値から ≥ 30%（日中安値）', v.aboveLow, x => x >= 30, '%'),
    rule('252日高値からの距離 ≤ 25%（日中高値）', v.belowHigh, x => x >= 0 && x <= 25, '%'),
    { ...rule('RS 推計 ≥ 70（公開日足の共通母集団）', rs, x => x >= 70), evidence: `${row.rs_universe_size || 0}銘柄・${row.rs_as_of_date || '基準日未確認'} / 独自推計` },
  ];
  // Three annual YoY rates, not an endpoint CAGR that can hide a down year.
  const annual = row.annual_eps_growth_3y;
  const annualMinimum = Array.isArray(annual) && annual.length === 3 && annual.every(finite) ? Math.min(...annual) : null;
  const common = [rule('RS 推計 ≥ 80', rs, v => v >= 80)];
  const rules = method === 'minervini' ? [...trend, integrity] : method === 'oneil' ? [
    rule('C：四半期 EPS 前年同期比 ≥ 25%', row.eps_growth_yy, v => v >= 25, '%'),
    rule('売上高 前年同期比 ≥ 25%', row.sales_growth_yy, v => v >= 25, '%'),
    rule('A：直近3年の各年 EPS 成長率 ≥ 25%（最小値）', annualMinimum, v => v >= 25, '%'),
    rule('N：52週高値からの距離 ≤ 15%（代替指標）', highDistance(row), v => v <= 15, '%'),
    rule('S：上昇日の出来高 / 50日平均 ≥ 1.4（代替指標）', finite(row.price_change_1d) ? row.se_volume_vs_50d : null, v => v >= 1.4 && row.price_change_1d > 0, '倍'),
    ...common,
    rule('I：機関投資家の保有社数が増加', row.institutional_sponsors_increasing, v => v === true, '', true),
    rule('M：市場が50日線・200日線より上（代替指標）', typeof row.market_above_50dma !== 'boolean' || typeof row.market_above_200dma !== 'boolean' ? null : row.market_above_50dma && row.market_above_200dma, v => v === true, '', true),
  ] : [
    rule('Composite 推計 ≥ 90', rating(row.composite_rating), v => v >= 90),
    rule('RS 推計 ≥ 85', rs, v => v >= 85),
    rule('EPS 推計 ≥ 80', rating(row.eps_rating), v => v >= 80),
    rule('業種順位 推計 ≤ 20', row.ibd_group_rank, v => Number.isInteger(v) && v >= 1 && v <= 20),
    rule('252日高値からの距離 ≤ 15%（日足再計算）', v.belowHigh, v => v >= 0 && v <= 15, '%'),
    rule('四半期 EPS 前年同期比 ≥ 25%（厳格成長条件）', row.eps_growth_yy, v => v >= 25, '%'),
    rule('売上高 前年同期比 ≥ 25%（厳格成長条件）', row.sales_growth_yy, v => v >= 25, '%'),
    rule('直近3年の EPS 成長履歴が揃う', annualMinimum, () => true, '%'),
    comparison('株価 > SMA50・SMA200', [v.close, v.sma50, v.sma200], (a, b, c) => a > b && a > c, `${display(v.close)} > ${display(v.sma50)} / ${display(v.sma200)}`),
    integrity,
  ];
  const passed = rules.filter(r => r.state === 'pass').length;
  const failed = rules.filter(r => r.state === 'fail').length;
  const templatePass = trend.every(r => r.state === 'pass') && integrity.state === 'pass';
  return { rules, passed, failed, unknown: rules.length - passed - failed, total: rules.length,
    templateMismatch: integrity.state === 'pass' && typeof row.passes_template === 'boolean' && row.passes_template !== templatePass,
    qualified: passed === rules.length, score: Math.round(passed / rules.length * 100) };
}

export function entryChecks(row) {
  const v = auditValues(row), pivot = row.se_pivot_price;
  return [
    comparison('ピボット以上・5%以内', [v.close, pivot], (p, b) => p >= b && p <= b * 1.05),
    rule('上昇日の出来高 ≥ 直前50日平均の1.4倍', finite(v.change) ? v.volumeRatio : null, x => x >= 1.4 && v.change > 0, '倍'),
    rule('セットアップ準備完了（検出器）', row.se_setup_ready, x => x === true, '', true),
    rule('市場：上昇トレンド確認（独自判定）', typeof row.market_regime === 'string' ? row.market_regime === 'confirmed_uptrend' : null, x => x === true, '', true),
    rule('決算日・ベース形状の最終確認', null, () => false),
  ];
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
