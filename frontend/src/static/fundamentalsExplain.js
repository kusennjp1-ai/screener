// Fundamentals card view model: why each SEC quarterly value or the Code 33 verdict is
// known or unknown, in the words the brief shows. Pure, and importable from node tools
// (tools/report-data-coverage.mjs applies it to the published bundle). Never fills a gap.
import { instrumentApplicability } from './instrumentApplicability.js';
import { signed } from './positionGeometry.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);

/** The three Code 33 conditions from the SEC rows, so a partly known Code 33 still shows what is known. */
export function code33Parts(report) {
  if (!report?.valid) return null;
  const last = report.rows.slice(-4);
  // A fiscal Q4 whose EPS is only in the annual report leaves EPS growth unknown; it is never estimated.
  const q4Eps = report.epsAcceleration === 'unknown' && last.some(row => row.fiscalQ4 && row.epsYoYReason === 'not_reported');
  return { q4Eps, parts: [['EPS の加速', report.epsAcceleration], ['売上の加速', report.salesAcceleration], ['純利益率の上昇', report.marginImprovement]] };
}

const ym = end => typeof end === 'string' ? `${end.slice(0, 7)}期` : '期 未確認';
const SEC_STATUS = {
  ok: ['SEC XBRL', ''],
  not_published: ['SEC 未配信', 'この銘柄の当日分の SEC 四半期データは配信されていません（日次取得はブリーフの候補・あと1条件の銘柄が対象です）。'],
  no_cik: ['SEC 対象外', 'SEC の銘柄コード表に該当がありません（ETF・外国企業・上場直後など）。'],
  no_companyfacts: ['SEC データなし', 'SEC に XBRL の財務データがありません。'],
  no_quarterly: ['四半期報告なし', '四半期報告（10-Q）を提出しない企業です。SEC の四半期データはありません。'],
  transient: ['SEC 取得失敗', 'SEC からの取得が一時的に失敗しました。次回の更新で再取得します。'],
  not_applicable: ['対象外', 'ファンド・ETF などは企業業績の対象外です。'],
  stale: ['古い', '直近の四半期から180日を超えているため判定に使いません。'],
  invalid: ['SEC 検証不可', '提出日や期間を検証できないため使いません。'],
  no_quarterly_values: ['四半期の EPS・売上なし', 'SEC の XBRL に四半期の EPS・売上の報告がありません（年次の値や純利益だけの報告）。'],
  // The SEC record travels in the stock's research detail: until that file has arrived it is unknown.
  detail_loading: ['読み込み中…', '詳細データを読み込み中…'],
  detail_error: ['取得できません', '詳細データを取得できません。'],
};

/**
 * Why the SEC quarterly evidence of a row is or is not usable, in words the brief shows.
 * `book` is the bookFinancialCurrent() result for the row (null when there is no record).
 * `detail` is the state of the row's research detail, which carries the record: 'loading' or
 * 'error' while the record cannot have arrived yet. Only an absent record from a loaded detail (or a
 * row without a detail) is 未配信. `coverage` is the publication's publishedFundamentalsCoverage() block
 * (step 0: always null, and not read yet).
 */
export function secStatus(row, book, { detail = null } = {}) {
  const make = (state, extra = {}) => ({ state, short: SEC_STATUS[state][0], long: SEC_STATUS[state][1], latestEnd: null, ...extra });
  const data = row?.book_financials;
  if ((book?.applicability || instrumentApplicability(row || {})).status !== 'unverified') return make('not_applicable');
  if (!data || typeof data !== 'object') return make(detail === 'loading' ? 'detail_loading' : detail === 'error' ? 'detail_error' : 'not_published');
  if (data.status === 'unavailable') {
    if (data.reason === 'no_quarterly') {
      const forms = Array.isArray(data.forms) ? data.forms.filter(form => typeof form === 'string' && /^[0-9A-Z-]{2,8}(\/A)?$/.test(form)).slice(0, 5) : [];
      return make('no_quarterly', forms.length ? { long: `四半期報告（10-Q）を提出しない企業です（${forms.join('・')}）。SEC の四半期データはありません。` } : {});
    }
    return make(['no_cik', 'no_companyfacts', 'transient'].includes(data.reason) ? data.reason : 'invalid');
  }
  if (!book) return make('invalid');
  // A well-formed record of this stock and day whose quarterly EPS and revenue are empty as written
  // (only annual EPS or net income reported): nothing to verify, so it is not 検証不可.
  const written = key => Array.isArray(data.quarterly?.[key]) && data.quarterly[key].length === 0;
  if (!book.report.valid && ['available', 'partial'].includes(data.status) && data.symbol === row.symbol && data.as_of_date === book.report.date && written('eps') && written('revenue')) return make('no_quarterly_values');
  if (book.current) return make('ok', { latestEnd: book.report.rows.at(-1)?.end ?? null });
  if (book.reason === 'stale_book_period' && book.report?.valid) {
    const latestEnd = book.report.rows.at(-1).end;
    return make('stale', { latestEnd, long: `直近の四半期は ${ym(latestEnd)}で、180日を超えているため判定に使いません。` });
  }
  return make('invalid');
}

// Reason words for one quarter's value: the tile's short <b> label and its longer note.
const EPS_REASON = { no_base: '前年同期の値なし', ambiguous_base: '前年同期を特定できず', nonpositive_base: '前年同期が赤字・ゼロ', period_mismatch: '前年同期と期間が不一致' };
const SHORT_REASON = { nonpositive_base: '比較不可', period_mismatch: '比較不可', no_base: '前年同期なし', ambiguous_base: '前年同期なし', not_reported: '未報告', start_mismatch: '未報告', nonpositive_revenue: '比較不可' };
export function quarterReason(row, metric) {
  if (!row) return null;
  if (metric === 'margin') {
    if (!row.marginReason) return null;
    if (row.marginReason === 'nonpositive_revenue') return '売上ゼロ以下';
    return finite(row.revenue) ? '純利益未報告' : '売上未報告';
  }
  const reason = metric === 'eps' ? row.epsYoYReason : row.salesYoYReason;
  if (!reason) return null;
  if (reason === 'not_reported') return metric === 'eps' ? (row.fiscalQ4 ? 'Q4のEPSは年次報告のみ' : 'EPS未報告') : '売上未報告';
  if (reason === 'nonpositive_base' && metric === 'eps' && finite(row.eps)) return `${EPS_REASON.nonpositive_base}（EPS ${row.eps.toFixed(2)}）`;
  return EPS_REASON[reason] || '比較できません';
}
const shortReason = (row, metric) => SHORT_REASON[metric === 'eps' ? row.epsYoYReason : metric === 'sales' ? row.salesYoYReason : row.marginReason] || '—';

/**
 * The three fundamentals tiles from SEC quarterly rows: the newest quarter that has a
 * value, its period, and why a newer quarter (or every quarter) has none.
 */
export function fundamentalTiles(report) {
  const rows = report?.rows || [];
  const newest = rows.at(-1);
  const tile = (label, metric, key, format) => {
    if (!newest) return { label, value: null, short: '—', note: '' };
    let index = rows.length - 1;
    while (index >= 0 && !finite(rows[index][key])) index--;
    if (index < 0) return { label, value: null, short: shortReason(newest, metric), note: `${ym(newest.end)}・${quarterReason(newest, metric)}`, end: newest.end };
    const row = rows[index], previous = rows[index - 1];
    // A sales rate compared with a derived Q4 base says so; the margin uses only its own quarter.
    const baseDerived = metric === 'sales' && row.salesBaseDerived === true;
    const note = (row === newest
      ? metric === 'margin' ? ym(row.end) : `${ym(row.end)}・前期 ${previous ? finite(previous[key]) ? format(previous[key]) : quarterReason(previous, metric) : 'なし'}`
      : `${ym(row.end)}・最新 ${ym(newest.end)}は${quarterReason(newest, metric)}`) + (baseDerived ? '・前年同期はQ4算出' : '');
    const derived = metric === 'sales' ? (row.salesDerived ?? row.derived) === true || baseDerived : metric === 'margin' && row.derived === true;
    return { label, value: format(row[key]), short: null, note, end: row.end, derived };
  };
  return [tile('EPS 前年比', 'eps', 'epsYoY', v => signed(v, 0)), tile('売上 前年比', 'sales', 'salesYoY', v => signed(v, 0)), tile('純利益率', 'margin', 'margin', v => `${v.toFixed(1)}%`)];
}

/** The source line under 業績の加速: the filing behind the newest quarter. */
export function fundamentalsSource(report) {
  const newest = report?.rows?.at(-1);
  if (!newest) return null;
  const filing = [newest.form, newest.filed ? `${newest.filed} 提出` : null].filter(Boolean).join(' ');
  return `出典：SEC XBRL${filing ? `（${filing}）` : ''}・${ym(newest.end)}まで`;
}

const PART_NAMES = { epsAcceleration: 'EPS の加速', salesAcceleration: '売上の加速', marginImprovement: '純利益率の上昇' };
const PART_METRIC = { epsAcceleration: 'eps', salesAcceleration: 'sales', marginImprovement: 'margin' };
/**
 * The Code 33 verdict in words: which conditions failed or stay unknown and why.
 * `code33` is the layered result (code33Layered); a Yahoo reference keeps its own text.
 */
export function code33Explain(report, sec, code33 = null) {
  if (code33?.source === 'yahoo') return { state: code33.state, kind: 'yahoo', title: `Code 33 ${code33.state === 'pass' ? '達成' : code33.state === 'fail' ? '未達' : '未確認'}`,
    text: `${code33.label}。SEC提出書類で判定できないため、提供元の四半期値で同じ規則を当てはめた参考判定です。` };
  const unknown = (kind, text) => ({ state: 'unknown', kind, title: 'Code 33 未確認', text });
  if (!report?.valid) {
    if (sec?.state === 'stale') return unknown('stale', `直近の四半期（${ym(sec.latestEnd)}）から180日を超えているため判定しません。`);
    if (sec?.state === 'detail_loading') return { ...unknown('no_sec', '詳細データを読み込み中です。読み込み後に判定します。'), title: 'Code 33 読み込み中' };
    return unknown('no_sec', `${sec?.long || SEC_STATUS.not_published[1]} Code 33 は判定していません。`);
  }
  const keys = Object.keys(PART_NAMES);
  const pick = value => keys.filter(key => report[key] === value).map(key => PART_NAMES[key]);
  const failed = pick('fail'), passed = pick('pass'), open = keys.filter(key => report[key] === 'unknown');
  if (report.code33 === 'pass') return { state: 'pass', kind: 'pass', title: 'Code 33 達成', text: '直近4四半期で EPS 成長・売上成長の加速と純利益率の上昇が3回続いています（SEC XBRL）。' };
  if (report.code33 === 'fail') return { state: 'fail', kind: 'fail', title: 'Code 33 未達',
    text: open.length ? `${failed.join('・')}が未達のため未達です（${open.map(key => PART_NAMES[key]).join('・')}は未確認）。` : `${failed.join('・')}が未達です（SEC XBRL）。` };
  if (report.stale) return unknown('stale', `直近の四半期（${ym(report.rows.at(-1)?.end)}）から180日を超えているため判定しません。`);
  if (report.rows.length < 8) return unknown('few_quarters', `四半期データが ${report.rows.length} 期分のため判定できません（直近4期とその前年同期の計8期が必要）。`);
  if (report.consecutive === false) return unknown('gap', '四半期データに欠けがあるため判定できません。');
  const achieved = passed.length ? `${passed.join('と')}は達成。` : '';
  const others = open.filter(key => key !== 'epsAcceleration');
  const why = key => `${PART_NAMES[key]}は未確認です（${reasonFor(report, key)}）。`;
  if (code33Parts(report)?.q4Eps) return unknown('q4_eps', `${achieved}EPS の加速は第4四半期の EPS が年次報告（10-K）にしか無いため未確認です（年間値から差し引く推計はしません）。${others.map(why).join('')}`);
  return unknown('other', `${achieved}${open.map(why).join('')}`);
}
function reasonFor(report, key) {
  const row = report.rows.slice(-4).find(item => quarterReason(item, PART_METRIC[key]));
  return row ? `${ym(row.end)}は${quarterReason(row, PART_METRIC[key])}` : '値がそろわない期があります';
}

/**
 * The Code 33 chip of the stock conclusion from the stock's financial view (useStockData's `financial`):
 * { text, tone }, where tone is '' when neutral.
 */
export function code33ChipView(financial) {
  const state = financial?.code33?.state;
  return { text: `Code 33 ${state === 'pass' ? '達成' : state === 'fail' ? '未達' : financial?.sec?.state === 'detail_loading' ? '読み込み中' : '未確認'}${financial?.code33?.source === 'yahoo' ? '（参考）' : ''}`,
    tone: state === 'pass' ? 'zone' : '' };
}

/**
 * The SEC fundamentals coverage block the publication carries, as read by the brief (not the report
 * that tools/report-data-coverage.mjs fundamentalsCoverage() computes for the publisher), or null when
 * the publication carries none (step 0: always null).
 * `marketEntry` is the manifest's raw US market entry (manifest.markets.US, as published, or null);
 * `bundle` is the research bundle the brief loaded (useResearchBundle's data, or null). Either may
 * hold the block; nothing is guessed when neither does.
 */
export function publishedFundamentalsCoverage(marketEntry, { bundle = null } = {}) {
  void marketEntry; void bundle;
  return null;
}
