import { canonicalPivot } from './researchPresentation.js';
import { assess, finite, snapshotFreshness } from './researchEngine.js';
const day = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
export function entryReadiness(row, date, market, now = Date.now()) {
  const pivot = canonicalPivot(row).price;
  const evidence = row.entry_evidence;
  const dated = evidence?.as_of_date === date;
  const calendar = dated ? evidence.calendar : null;
  const fresh = calendar?.latest_completed_session === date && Number.isFinite(Date.parse(calendar.valid_until)) && now < Date.parse(calendar.valid_until) && now >= Date.parse(calendar.evaluated_at);
  const earnings = dated ? evidence.earnings : null;
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const earningsDays = day(earnings?.date) ? (Date.parse(earnings.date) - Date.parse(today)) / 86400000 : null;
  const recentEarnings = Number.isFinite(Date.parse(earnings?.checked_at)) && now >= Date.parse(earnings.checked_at) && now - Date.parse(earnings.checked_at) <= 72*3600000;
  const shape = dated ? evidence.shape : null;
  const minervini = assess(row, 'minervini'), ibd = assess(row, 'ibd');
  const check = (id, label, value, detail) => ({id,label,state:value == null ? 'unknown' : value ? 'pass' : 'fail',detail});
  const rules = [
    check('selection','選定条件', minervini.qualified && ibd.qualified, `ミネルヴィニ ${minervini.passed}/${minervini.total}・IBD型 ${ibd.passed}/${ibd.total}（未確認 ${minervini.unknown + ibd.unknown}）`),
    check('market','市場環境', market.cap > 0, market.label),
    check('date','最新の取引日', calendar ? fresh : null, calendar ? `基準日 ${date}・最新完了取引日 ${calendar.latest_completed_session}` : `分析基準日 ${date}。取引カレンダー未取得`),
    check('price','買い位置', finite(row.current_price) && finite(pivot) && pivot > 0 ? row.current_price >= pivot && row.current_price <= pivot * 1.05 : null, `日次価格 ${row.current_price ?? '未確認'} / ピボット ${pivot ?? '未確認'}。0〜5%はこのモデルの設定`),
    check('volume','出来高', dated && finite(evidence.volumeRatio) ? evidence.volumeRatio >= 1.4 : null, dated && finite(evidence.volumeRatio) ? `直前50日平均比 ${evidence.volumeRatio.toFixed(2)}倍（モデルの基準1.4倍）` : '直前50日比較の実測値が未取得'),
    check('shape','ベース形状', shape ? shape.candidate : null, shape?.summary || '日足による形状検証が未取得'),
    check('earnings','決算までの余裕', recentEarnings && earningsDays != null ? earningsDays > 7 && earningsDays <= 180 : null, recentEarnings && earningsDays != null ? `予定 ${earnings.date}・あと${earningsDays}日（予想日。7日以内は新規購入を見送るモデル設定）` : '決算予定日が未取得または取得から72時間超。自動取得の対象・結果を確認'),
  ];
  const passed = rules.filter(r => r.state === 'pass').length;
  return { symbol:row.symbol, rules, passed, total:rules.length, ready:passed === rules.length,
    freshness:snapshotFreshness(date,now), status:passed === rules.length ? '日次の買い条件通過' : rules.find(r=>r.state!=='pass')?.label + 'を確認' };
}
