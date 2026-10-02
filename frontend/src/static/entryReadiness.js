import { canonicalPivot } from './researchPresentation.js';
import { assess, entryZonePercent, finite, snapshotFreshness } from './researchEngine.js';
import { auditValues } from './qualificationAudit.js';
import { entrySourceContext } from './bookSourceContext.js';
const day = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;

// The list can show rows outside the portfolio sample. Index their time-sensitive
// evidence once per publication so a clock tick cannot leave another row's 7/7
// badge stale. Ticks use a binary search, not full-universe rule evaluation.
export function prepareReadinessTimeline(rows) {
  const boundaries = new Set(), parsed = new Map();
  const stamp = value => {
    if (!parsed.has(value)) parsed.set(value, Date.parse(value));
    return parsed.get(value);
  };
  const add = (value, offset = 0) => { const time = stamp(value); if (Number.isFinite(time)) boundaries.add(time + offset); };
  for (const row of rows) {
    add(row.entry_evidence?.calendar?.evaluated_at);
    add(row.entry_evidence?.calendar?.valid_until);
    add(row.entry_evidence?.earnings?.checked_at);
    // Earnings and financial age checks include the exact 72-hour boundary.
    add(row.entry_evidence?.earnings?.checked_at, 72 * 3600000 + 1);
    add(row.financial_history?.retrieved_at, -5000);
    add(row.financial_history?.retrieved_at, 72 * 3600000 + 1);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  return now => {
    let low = 0, high = sorted.length;
    while (low < high) { const middle = (low + high) >>> 1; if (sorted[middle] <= now) low = middle + 1; else high = middle; }
    return low;
  };
}

export function entryReadiness(row, date, market, now = Date.now(), method = 'minervini') {
  const pivot = canonicalPivot(row).price;
  const zone = entryZonePercent(method);
  const sourceContext = entrySourceContext(method, zone, finite(row.current_price) && finite(pivot) && pivot > 0 ? (row.current_price / pivot - 1) * 100 : null);
  const evidence = row.entry_evidence;
  const dated = Boolean(evidence && day(date) && evidence.as_of_date === date);
  const calendar = dated ? evidence.calendar : null;
  const fresh = calendar && calendar.latest_completed_session === date && Number.isFinite(Date.parse(calendar.valid_until)) && now < Date.parse(calendar.valid_until) && now >= Date.parse(calendar.evaluated_at);
  // Explain the existing freshness result without changing its pass/fail rule.
  const calendarDetail = (() => {
    if (evidence && evidence.as_of_date !== date) return `分析基準日 ${date}・検証基準日 ${evidence.as_of_date || '未確認'} が不一致。基準日の取引カレンダーは未確認`;
    if (!calendar) return `分析基準日 ${date}。取引カレンダー未取得`;
    const dates = `基準日 ${date}・最新完了取引日 ${calendar.latest_completed_session || '未確認'}`;
    if (calendar.latest_completed_session !== date) return `${dates}。取引日が不一致。最新の日次データを確認`;
    if (!Number.isFinite(Date.parse(calendar.evaluated_at)) || !Number.isFinite(Date.parse(calendar.valid_until))) return `${dates}。検証時刻または有効期限が不正・未確認`;
    if (now < Date.parse(calendar.evaluated_at)) return `${dates}。検証時刻が未来（${calendar.evaluated_at}）のため未検証`;
    const expiry = `${new Date(Date.parse(calendar.valid_until) + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ')} JST`;
    if (now >= Date.parse(calendar.valid_until)) return `${dates}。取引日検証の有効期限切れ（${expiry}）。最新のカレンダー検証が必要`;
    return `${dates}。取引日検証は ${expiry} まで有効`;
  })();
  const earnings = dated ? evidence.earnings : null;
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const earningsDays = day(earnings?.date) ? (Date.parse(earnings.date) - Date.parse(today)) / 86400000 : null;
  const recentEarnings = Number.isFinite(Date.parse(earnings?.checked_at)) && now >= Date.parse(earnings.checked_at) && now - Date.parse(earnings.checked_at) <= 72*3600000;
  const shape = dated ? evidence.shape : null;
  const minervini = assess(row, 'minervini'), ibd = assess(row, 'ibd');
  const excluded = Boolean(row.corporate_action?.cash_acquisition || row.price_activity?.lowRange);
  const selection = excluded || minervini.failed > 0 || ibd.failed > 0 ? false : minervini.unknown + ibd.unknown > 0 ? null : true;
  const audit = row.technical_audit?.as_of_date === date ? auditValues(row) : {};
  const volumeKnown = dated && finite(evidence.volumeRatio) && evidence.volumeRatio >= 0 && finite(audit.change);
  const marketKnown = market?.state !== 'unknown' && finite(market?.cap) && market.cap >= 0;
  // Missing or malformed evidence must not become a measured failure or a pass.
  const check = (id, label, value, detail) => ({id,label,state:typeof value !== 'boolean' ? 'unknown' : value ? 'pass' : 'fail',detail});
  const rules = [
    check('selection','選定条件', selection, `${row.corporate_action?.cash_acquisition ? '現金買収合意・購入対象外。' : row.price_activity?.lowRange ? '60日値幅5%未満：低変動のため監視のみ（独自リスク設定）。' : ''}共通の購入モデル：ミネルヴィニ ${minervini.passed}/${minervini.total}・IBD型 ${ibd.passed}/${ibd.total}（未達 ${minervini.failed + ibd.failed}・未確認 ${minervini.unknown + ibd.unknown}）`),
    check('market','市場環境', marketKnown ? market.cap > 0 : null, market?.label || '市場データ未取得'),
    check('date','最新の取引日', calendar ? fresh : null, calendarDetail),
    check('price','買い位置', finite(row.current_price) && finite(pivot) && pivot > 0 ? row.current_price >= pivot && row.current_price <= pivot * (1 + zone / 100) : null, `日次価格 ${finite(row.current_price) ? row.current_price.toFixed(2) : '未確認'} / ピボット ${finite(pivot) ? pivot.toFixed(2) : '未確認'}。0〜${zone}%はこの方式のモデル設定。${sourceContext.label ? `${sourceContext.label}。` : ''}${sourceContext.detail}`),
    check('volume','出来高', volumeKnown ? evidence.volumeRatio >= 1.4 && audit.change > 0 : null, volumeKnown ? `直前50日平均比 ${evidence.volumeRatio.toFixed(2)}倍・検証済み前日比 ${audit.change.toFixed(2)}%（上放れ時の確認に使う、上昇日かつ1.4倍以上というアプリの代理条件。形成中の最終収縮の出来高減少とは別）` : '同じ分析日の検証済み前日比または直前50日比較の実測値が未取得'),
    check('shape','ベース形状', shape ? shape.candidate : null, shape?.summary || (shape?.candidate === true ? '日足の自動検出による形状候補。詳細は銘柄の根拠を確認' : shape?.candidate === false ? '現在の形状条件は未達。詳細は銘柄の根拠を確認' : '日足による形状検証が未取得')),
    check('earnings','決算までの余裕', recentEarnings && earningsDays != null ? earningsDays > 7 && earningsDays <= 180 : null, recentEarnings && earningsDays != null ? `予定 ${earnings.date}・あと${earningsDays}日（予想日。7日以内は新規購入を見送るモデル設定）` : '決算予定日が未取得または取得から72時間超。自動取得の対象・結果を確認'),
  ];
  const passed = rules.filter(r => r.state === 'pass').length;
  const failed = rules.filter(r => r.state === 'fail').length;
  return { symbol:row.symbol, rules, passed, failed, unknown:rules.length - passed - failed, total:rules.length, ready:passed === rules.length,
    freshness:snapshotFreshness(date,now), status:passed === rules.length ? '日次の買い条件通過' : rules.find(r=>r.state!=='pass')?.label + 'を確認' };
}
