// Fundamentals card view model: why each SEC quarterly value or the Code 33 verdict is
// known or unknown, in the words the brief shows. Pure, and importable from node tools
// (tools/report-data-coverage.mjs applies it to the published bundle). Never fills a gap.
import { instrumentApplicability } from './instrumentApplicability.js';
import { fixedMinus, signed } from './positionGeometry.js';
import { SEC_RECORD_SCHEMA } from './bookFinancialAdmission.js';
import { BOOK_QUARTER_MAX_AGE_DAYS } from './bookFinancialEvidence.js';
import { bookFinancialCurrent } from './bookFinancialCurrent.js';
import { code33Layered } from './code33Reference.js';

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
// A quarter as the chips and the Q4 sentences name it: 26-06期.
const yyMm = end => typeof end === 'string' ? `${end.slice(2, 7)}期` : '期 未確認';
const daysBetween = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;
/** A fiscal fourth quarter the 10-K reports only as a year: the sentence the card, the chips and the reasons share. */
export const fiscalQ4Text = end => `第4四半期（${yyMm(end)}）は年次報告のみで四半期の値がありません`;
const NO_REVENUE_CONCEPT = '売上の科目が対象外（銀行・保険などの収益科目）';
const SEC_STATUS = {
  ok: ['SEC XBRL', ''],
  not_published: ['SEC 未配信', 'この銘柄の当日分の SEC 四半期データは配信されていません。'],
  // Not in this publication's SEC fetch (temporary), unlike 対象外 (no SEC identifier at all).
  not_requested: ['SEC 今回未取得', '今回の SEC 取得には含まれていません。'],
  refused: ['SEC 不採用', '取得対象でしたが、SEC の記録を検証できず不採用にしました。'],
  no_cik: ['SEC 対象外', 'SEC の銘柄コード表に該当がありません（ETF・外国企業・上場直後など）。'],
  no_companyfacts: ['SEC データなし', 'SEC に XBRL の財務データがありません。'],
  no_quarterly: ['四半期報告なし', '四半期報告（10-Q）を提出しない企業です。SEC の四半期データはありません。'],
  transient: ['SEC 取得失敗', 'SEC からの取得が一時的に失敗しました（この公開には値がありません）。'],
  not_applicable: ['対象外', 'ファンド・ETF などは企業業績の対象外です。'],
  stale: ['古い', '直近の四半期から180日を超えているため判定に使いません。'],
  // The newest period is a fiscal Q4 the 10-K reports only as a year: not 古い (that filing is recent).
  q4_annual_only: ['Q4 年次のみ', '第4四半期は年次報告のみで四半期の値がありません。'],
  // sec-financials.py could not read the SEC payload (its invalid_detail names the cause): a fetch-side error. The short
  // label stays the one the brief has always shown for it; the long text says what happened.
  invalid_payload: ['SEC 検証不可', 'SECの記録を読み取れず（取得側の処理エラー・業績の良し悪しではありません）。'],
  invalid: ['SEC 検証不可', 'SEC の記録を判定に使えません（理由は記録されていません）。'],
  no_quarterly_values: ['四半期の EPS・売上なし', 'SEC の XBRL に四半期の EPS・売上の報告がありません（年次の値や純利益だけの報告）。'],
  // The SEC record travels in the stock's research detail: until that file has arrived it is unknown.
  detail_loading: ['読み込み中…', '詳細データを読み込み中…'],
  detail_error: ['取得できません', '詳細データを取得できません。'],
};
// Why the publisher's admission refused a same-day record (bookFinancialAdmission's reasons), in words.
const SERIES_NAME = { eps: 'EPS', revenue: '売上', netIncome: '純利益', inventory: '在庫', receivables: '売掛金', annualEps: '年間EPS' };
const REFUSAL_TEXT = { schema: 'SEC データの形式の版が違うため', symbol: '銘柄が一致しないため', as_of: '公開日と記録の日付が一致しないため', retrieved_window: '取得時刻を確かめられないため',
  keys: '記録の項目が想定と違うため', cik_url: '出典URLとCIK番号が一致しないため', not_corporate: '企業業績の対象外の銘柄のため', projection: '公開時の整合確認で外れたため' };
function refusalText(reason) {
  if (typeof reason !== 'string') return '理由は記録されていません';
  if (reason.startsWith('series:')) return `${SERIES_NAME[reason.slice(7)] || 'いずれか'}の系列（提出日・期間・様式）を確かめられないため`;
  return REFUSAL_TEXT[reason] || '理由は記録されていません';
}
// Why a record of this stock could not be used, from the check that refused it: 提出日や期間 only for the date check.
function invalidText(row, data, report) {
  if (data.symbol !== row?.symbol || data.as_of_date !== report?.date) return '提出日や期間を検証できないため使いません（記録の銘柄・日付が公開と一致しません）。';
  const refused = report?.refusedSeries || [];
  if (refused.length) return `${refused.map(key => SERIES_NAME[key] || key).join('・')}の系列（期間・順序）を確かめられないため使いません。`;
  return SEC_STATUS.invalid[1];
}
// An invalid_payload record's recorded cause (sec-financials.py's invalid_detail), in words; an older record names none.
function payloadText(detail) {
  const mismatch = detail && Number.isSafeInteger(detail.requested_cik) && Number.isSafeInteger(detail.received_cik) && detail.requested_cik !== detail.received_cik;
  return `${SEC_STATUS.invalid_payload[1]}${mismatch ? '返された記録の CIK 番号が要求と違いました。' : ''}`;
}
const monthDay = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : null;
const known = value => Number.isSafeInteger(value) && value >= 0;
/**
 * The publication did not deliver usable SEC quarters at all: no same-day fetch, another schema, or a fetch
 * without the SEC ticker map (every symbol then reads as without a CIK, which is not the stock's own fact).
 */
const secDeliveryFailed = coverage => Boolean(coverage) && (coverage.sec_fetch_ran !== true || coverage.file_schema !== SEC_RECORD_SCHEMA || coverage.ticker_map_ok === false);
// The counts are of the publication's rows (funds and ETFs included), never of the brief's listed rows.
function deliveryText(coverage) {
  const date = monthDay(coverage.as_of_date), counts = known(coverage.with_quarters) && known(coverage.universe) ? `反映は公開${coverage.universe}銘柄中${coverage.with_quarters}銘柄・` : '';
  return `この公開${date ? `（${date}分）` : ''}では SEC 四半期データを反映していません（${counts}配信側の問題で、業績の良し悪しではありません）。`;
}
// The published rows this SEC fetch included (admitted or refused), out of every published row.
const fetchedText = coverage => known(coverage?.admitted) && known(coverage?.refused) && known(coverage?.universe) ? `（取得は公開${coverage.universe}銘柄中${coverage.admitted + coverage.refused}銘柄）` : '';

/**
 * Why the SEC quarterly evidence of a row is or is not usable, in words the brief shows.
 * `book` is the bookFinancialCurrent() result for the row (null when there is no record).
 * `detail` is the state of the row's research detail, which carries the record: 'loading' or
 * 'error' while the record cannot have arrived yet. Only an absent record from a loaded detail (or a
 * row without a detail) is 未配信. `coverage` is the publication's publishedFundamentalsCoverage() block
 * (null when it carries none). With it, a missing record says whether the whole publication failed to
 * deliver SEC quarters, the stock was outside this fetch, or its record was refused (the detail's
 * sec_admission); without it the wording claims nothing about the fetch and guesses no count.
 */
export function secStatus(row, book, { detail = null, coverage = null } = {}) {
  const make = (state, extra = {}) => ({ state, short: SEC_STATUS[state][0], long: SEC_STATUS[state][1], latestEnd: null, ...extra });
  const data = row?.book_financials;
  if ((book?.applicability || instrumentApplicability(row || {})).status !== 'unverified') return make('not_applicable');
  if (!data || typeof data !== 'object') {
    if (detail === 'loading') return make('detail_loading');
    if (detail === 'error') return make('detail_error');
    // A delivery failure of the whole publication is told as that, never as this stock's results.
    if (secDeliveryFailed(coverage)) return make('not_published', { delivery: true, long: deliveryText(coverage) });
    const admission = row?.sec_admission;
    if (admission?.state === 'not_requested') return make('not_requested', { long: `今回の SEC 取得には含まれていません${fetchedText(coverage)}。` });
    if (admission?.state === 'refused') return make('refused', { reason: admission.reason, long: `取得対象でしたが、SEC の記録を検証できず不採用にしました（${refusalText(admission.reason)}）。` });
    return make('not_published');
  }
  if (data.status === 'unavailable') {
    if (data.reason === 'no_quarterly') {
      const forms = Array.isArray(data.forms) ? data.forms.filter(form => typeof form === 'string' && /^[0-9A-Z-]{2,8}(\/A)?$/.test(form)).slice(0, 5) : [];
      return make('no_quarterly', forms.length ? { long: `四半期報告（10-Q）を提出しない企業です（${forms.join('・')}）。SEC の四半期データはありません。` } : {});
    }
    // Without the ticker map every symbol is written as no_cik: a delivery failure, never this stock's fact.
    if (data.reason === 'no_cik' && secDeliveryFailed(coverage)) return make('not_published', { delivery: true, long: deliveryText(coverage) });
    if (data.reason === 'invalid_payload') return make('invalid_payload', { long: payloadText(data.invalid_detail) });
    return make(['no_cik', 'no_companyfacts', 'transient'].includes(data.reason) ? data.reason : 'invalid');
  }
  if (!book) return make('invalid');
  // A well-formed record of this stock and day whose quarterly EPS and revenue are empty as written
  // (only annual EPS or net income reported): nothing to verify, so it is not 検証不可.
  const written = key => Array.isArray(data.quarterly?.[key]) && data.quarterly[key].length === 0;
  if (!book.report.valid && ['available', 'partial'].includes(data.status) && data.symbol === row.symbol && data.as_of_date === book.report.date && written('eps') && written('revenue')) return make('no_quarterly_values');
  if (book.current) return make('ok', { latestEnd: book.report.rows.at(-1)?.end ?? null });
  if (book.reason === 'stale_book_period' && book.report?.valid) {
    const latestEnd = book.report.rows.at(-1).end, pending = book.report.fiscalQ4Pending;
    // 古い only when the newest filing, a 10-K included, is too old; a recent 10-K whose Q4 has no quarterly value says so.
    if (pending && daysBetween(book.report.date, pending) <= BOOK_QUARTER_MAX_AGE_DAYS) return make('q4_annual_only', { latestEnd, fiscalQ4: pending, long: `${fiscalQ4Text(pending)}。` });
    return make('stale', { latestEnd, long: `直近の四半期は ${ym(latestEnd)}で、180日を超えているため判定に使いません。` });
  }
  return make('invalid', { long: invalidText(row, data, book.report) });
}

// Reason words for one quarter's value: the tile's short <b> label and its longer note.
const EPS_REASON = { no_base: '前年同期の値なし', ambiguous_base: '前年同期を特定できず', nonpositive_base: '前年同期が赤字・ゼロ', period_mismatch: '前年同期と期間が不一致' };
const SHORT_REASON = { nonpositive_base: '比較不可', period_mismatch: '比較不可', no_base: '前年同期なし', ambiguous_base: '前年同期なし', not_reported: '未報告', start_mismatch: '未報告', nonpositive_revenue: '比較不可', no_concept: '対象外' };
export function quarterReason(row, metric) {
  if (!row) return null;
  if (metric === 'margin') {
    if (!row.marginReason) return null;
    if (row.marginReason === 'no_concept') return NO_REVENUE_CONCEPT;
    if (row.marginReason === 'nonpositive_revenue') return '売上ゼロ以下';
    return finite(row.revenue) ? '純利益未報告' : '売上未報告';
  }
  const reason = metric === 'eps' ? row.epsYoYReason : row.salesYoYReason;
  if (!reason) return null;
  if (reason === 'no_concept') return NO_REVENUE_CONCEPT;
  if (reason === 'not_reported') return metric === 'eps' ? (row.fiscalQ4 ? 'Q4のEPSは年次報告のみ' : 'EPS未報告') : '売上未報告';
  if (reason === 'nonpositive_base' && metric === 'eps' && finite(row.eps)) return `${EPS_REASON.nonpositive_base}（EPS ${fixedMinus(row.eps, 2)}）`;
  return EPS_REASON[reason] || '比較できません';
}
const shortReason = (row, metric) => SHORT_REASON[metric === 'eps' ? row.epsYoYReason : metric === 'sales' ? row.salesYoYReason : row.marginReason] || '—';

/** The newest of the SEC quarterly rows whose `key` is known, with its index: the quarter a tile or a chip reports. */
export function latestKnownQuarter(rows, key) {
  for (let index = (rows || []).length - 1; index >= 0; index--) if (finite(rows[index]?.[key])) return { index, row: rows[index], value: rows[index][key], end: rows[index].end };
  return null;
}

/**
 * The three fundamentals tiles from SEC quarterly rows: the newest quarter that has a
 * value, its period, and why a newer quarter (or every quarter) has none.
 */
export function fundamentalTiles(report) {
  const rows = report?.rows || [];
  const newest = rows.at(-1);
  const tile = (label, metric, key, format) => {
    if (!newest) return { label, value: null, short: '—', note: '' };
    const index = latestKnownQuarter(rows, key)?.index ?? -1;
    // A loss (or zero) a year earlier and a profit now: the fact, never a growth rate.
    const turnaround = metric === 'eps' && newest.epsYoYReason === 'nonpositive_base' && finite(newest.eps) && newest.eps > 0 && finite(newest.epsBase) ? { end: newest.end, from: newest.epsBase, to: newest.eps } : null;
    // Sales and margin of a record without a revenue concept are out of scope in every quarter: no period to name.
    const outOfScope = metric !== 'eps' && (metric === 'sales' ? newest.salesYoYReason : newest.marginReason) === 'no_concept';
    if (index < 0) return { label, value: null, short: shortReason(newest, metric), note: outOfScope ? NO_REVENUE_CONCEPT : `${ym(newest.end)}・${quarterReason(newest, metric)}`, end: newest.end, ...(turnaround ? { turnaround } : {}) };
    const row = rows[index], previous = rows[index - 1];
    // A sales rate compared with a derived Q4 base says so; the margin uses only its own quarter.
    const baseDerived = metric === 'sales' && row.salesBaseDerived === true;
    const note = (row === newest
      ? metric === 'margin' ? ym(row.end) : `${ym(row.end)}・前期 ${previous ? finite(previous[key]) ? format(previous[key]) : quarterReason(previous, metric) : 'なし'}`
      : `${ym(row.end)}・最新 ${ym(newest.end)}は${quarterReason(newest, metric)}`) + (baseDerived ? '・前年同期はQ4算出' : '');
    const derived = metric === 'sales' ? (row.salesDerived ?? row.derived) === true || baseDerived : metric === 'margin' && row.derived === true;
    return { label, value: format(row[key]), short: null, note, end: row.end, derived, ...(turnaround ? { turnaround } : {}) };
  };
  return [tile('EPS 前年比', 'eps', 'epsYoY', v => signed(v, 0)), tile('売上 前年比', 'sales', 'salesYoY', v => signed(v, 0)), tile('純利益率', 'margin', 'margin', v => `${fixedMinus(v, 1)}%`)];
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
export function code33Explain(report, sec, code33 = null, { interim = false } = {}) {
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
  if (report.consecutive === false) {
    // The quarter that breaks the window is a fiscal Q4 the 10-K reports only as a year: said as that, never 欠け.
    const window = report.rows.slice(-4), q4 = (report.fiscalQ4Missing || []).find(end => end > window[0].end && end < window.at(-1).end);
    if (q4) return unknown('q4_row', `${fiscalQ4Text(q4)}。`);
    return unknown('gap', '四半期データに欠けがあるため判定できません。');
  }
  const achieved = passed.length ? `${passed.join('と')}は達成。` : '';
  const others = open.filter(key => key !== 'epsAcceleration');
  const why = key => `${PART_NAMES[key]}は未確認です（${reasonFor(report, key)}）。`;
  // `interim` (the card): the EPS growth that is known, as facts, in place of the general sentence (plan DT4).
  if (code33Parts(report)?.q4Eps) return unknown('q4_eps', `${achieved}${interim ? `EPS の加速は未確認：${epsSequence(report)}（Q4は10-Kのみで未確認）。` : 'EPS の加速は第4四半期の EPS が年次報告（10-K）にしか無いため未確認です（年間値から差し引く推計はしません）。'}${others.map(why).join('')}`);
  return unknown('other', `${achieved}${open.map(why).join('')}`);
}
// The known EPS growth of the latest four quarters, oldest first, as facts in % (「EPS前年比 +10→+20→+40」, U+2212 for a
// fall): a trailing fiscal Q4 without EPS is left to the sentence's own 「Q4は10-Kのみ」, any other unknown quarter reads 未確認.
function epsSequence(report) {
  const rows = report.rows.slice(-4);
  while (rows.length && !finite(rows.at(-1).epsYoY) && rows.at(-1).fiscalQ4) rows.pop();
  return `EPS前年比 ${rows.map(row => finite(row.epsYoY) ? signed(row.epsYoY, 0).replace('%', '') : row.fiscalQ4 ? 'Q4未確認' : '未確認').join('→')}`;
}
function reasonFor(report, key) {
  const row = report.rows.slice(-4).find(item => quarterReason(item, PART_METRIC[key]));
  return row ? `${ym(row.end)}は${quarterReason(row, PART_METRIC[key])}` : '値がそろわない期があります';
}

// Why Code 33 stays unknown, in the chip's few words (code33Explain's kind; the SEC state's short label
// when there is no usable SEC record, so a delivery failure never reads like the stock's own result).
const CHIP_KIND = { q4_eps: 'Q4 EPS', q4_row: 'Q4年次のみ', few_quarters: '8期未満', gap: '欠け', stale: '古い' };
const CHIP_SEC = { not_published: 'SEC未配信', no_quarterly_values: '四半期値なし', detail_error: '詳細未取得', q4_annual_only: 'Q4年次のみ' };
/**
 * The Code 33 chip of the stock conclusion from the stock's financial view (useStockData's `financial`):
 * { text, tone }. An SEC 達成 is the zone tone. A 未達 is said plainly in the neutral tone: Code 33 is a
 * bonus, never a gate. A Yahoo-only judgement is 参考 and neutral either way. An unknown says why in two or
 * three words (「未確認・Q4 EPS」「未確認・SEC未配信」「未確認・8期未満」…).
 */
export function code33ChipView(financial) {
  const code33 = financial?.code33, state = code33?.state, reference = code33?.source === 'yahoo' ? '（参考）' : '';
  if (state === 'pass') return { text: `Code 33 達成${reference}`, tone: reference ? '' : 'zone' };
  if (state === 'fail') return { text: `Code 33 未達${reference}`, tone: '' };
  const sec = financial?.sec ?? null;
  // Nothing known about the SEC record: no reason is claimed.
  if (!sec) return { text: 'Code 33 未確認', tone: '' };
  if (sec.state === 'detail_loading') return { text: 'Code 33 読み込み中', tone: '' };
  const kind = code33Explain(financial?.report ?? null, sec, code33 ?? null).kind;
  const word = kind === 'no_sec' ? CHIP_SEC[sec.state] || String(sec.short || '').replace(/\s+/g, '') : CHIP_KIND[kind];
  return { text: `Code 33 未確認${word ? `・${word}` : ''}`, tone: '' };
}

const BLOCK_COUNTS = ['universe', 'admitted', 'with_quarters', 'not_requested', 'not_fetched', 'refused'];
/**
 * The problems a publication's coverage block can name in its `warnings` (round 2; written by
 * tools/report-data-coverage.mjs's fundamentalsCoverageBlock for the export, the gate and the report alike):
 * symbols cut by the limit or the time budget, an unread ticker map, an SEC file of another schema, records
 * refused at verification (other than funds), or SEC records without any quarters.
 */
export const COVERAGE_WARNINGS = Object.freeze(['truncated', 'deadline_unreached', 'ticker_map_unavailable', 'file_schema', 'refused', 'no_quarters']);
/**
 * The SEC fundamentals coverage block the publication carries (manifest.markets.US.fundamentals_coverage,
 * written by tools/export-research.mjs), as read by the brief, or null when the publication carries none
 * or carries one that is malformed or for another date (a stale block is never read as today's).
 * `marketEntry` is the manifest's raw US market entry (manifest.markets.US, as published, or null);
 * `bundle` is the research bundle the brief loaded (useResearchBundle's data, or null), used only to
 * confirm the date. Nothing is guessed when there is no block.
 */
export function publishedFundamentalsCoverage(marketEntry, { bundle = null } = {}) {
  const block = marketEntry?.fundamentals_coverage;
  if (!block || typeof block !== 'object' || Array.isArray(block) || block.schema_version !== 'fundamentals-coverage-v1') return null;
  if (typeof block.as_of_date !== 'string' || block.as_of_date !== marketEntry.as_of_date || (bundle?.date && bundle.date !== block.as_of_date)) return null;
  if (typeof block.sec_fetch_ran !== 'boolean' || !BLOCK_COUNTS.every(key => known(block[key])) || !['requested', 'eligible', 'truncated', 'deadline_unreached'].every(key => block[key] === null || known(block[key]))) return null;
  if (!(block.file_schema === null || Number.isSafeInteger(block.file_schema)) || !block.refused_by_reason || typeof block.refused_by_reason !== 'object') return null;
  // ticker_map_ok: false is a delivery failure; a block without the field (or null) claims nothing about the map.
  if (![undefined, null, true, false].includes(block.ticker_map_ok)) return null;
  // warnings (round 2): the codes of COVERAGE_WARNINGS; an older block has none.
  if (block.warnings !== undefined && !(Array.isArray(block.warnings) && block.warnings.every(code => COVERAGE_WARNINGS.includes(code)))) return null;
  return block;
}

// ---- Round-2 seams (plan §2.2). Step 0 defines them; the data track writes their bodies. ----

const isoDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const yoyPoint = value => value === null || (plain(value) && finite(value.value) && isoDay(value.end));
const CODE33_STATES = ['pass', 'fail', 'unknown'];

/**
 * A research-index row's SEC summary (plan §2.3), exported by tools/export-research.mjs from the admitted
 * SEC record only, with the functions the fundamentals card uses. Older publications have none: a row
 * without it reads 未収録, never 0 and never false.
 * @typedef {object} SecSummary
 * @property {string} sec_state the row's SEC state (secStatus' `state`: 'ok', 'stale', 'invalid', 'no_quarterly', …)
 * @property {{ value: number, end: string } | null} eps_yoy the latest quarter's EPS change from the year-ago quarter (%) and that quarter's end ('YYYY-MM-DD'), or null
 * @property {{ value: number, end: string } | null} sales_yoy the same for sales, or null
 * @property {{ state: 'pass' | 'fail' | 'unknown', kind: string | null } | null} code33 Code 33's state and, for an unknown, code33Explain's `kind`, or null
 * @property {string} as_of_date the analysis date ('YYYY-MM-DD')
 */

/**
 * The row's `sec_summary` when it has the documented shape (SecSummary), as published; null when it is
 * absent (an older publication) or malformed. Nothing is filled in: a null value stays null. Its
 * `as_of_date` is returned as published; a consumer compares it with the analysis date itself.
 * A null result has two reasons a consumer must not mix up: tell them apart with
 * `Object.hasOwn(row, 'sec_summary')`. Absent is 未収録 (the publication predates the field); present but
 * refused here is 未確認 (published, but not in the documented shape). Never 0 and never false.
 * @param {object} row a research-index row
 * @returns {SecSummary | null}
 */
export function secSummary(row) {
  const value = row?.sec_summary;
  if (!plain(value) || typeof value.sec_state !== 'string' || !value.sec_state || !isoDay(value.as_of_date)) return null;
  if (!yoyPoint(value.eps_yoy) || !yoyPoint(value.sales_yoy)) return null;
  const code33 = value.code33;
  if (code33 !== null && !(plain(code33) && CODE33_STATES.includes(code33.state) && (code33.kind == null || typeof code33.kind === 'string'))) return null;
  return value;
}

/**
 * The row's `sec_summary` (SecSummary) from its admitted SEC record, with the functions the fundamentals card
 * uses: secStatus for the state, the tiles' newest known quarter for each growth rate and the SEC-only Code 33
 * (no Yahoo reference). `row` is a published row carrying `book_financials` (the record the export admitted),
 * `date` the analysis date, `now` the publication's evaluation instant and `coverage` the publication's
 * fundamentals_coverage block. Null without an admitted record: nothing is summarised from no record.
 * Written into the research index summary only (tools/export-research.mjs), never into the canonical rows.
 * @returns {SecSummary | null}
 */
export function buildSecSummary(row, { date, now, coverage = null } = {}) {
  if (!row?.book_financials || typeof row.book_financials !== 'object' || !isoDay(date)) return null;
  const book = bookFinancialCurrent(row.book_financials, row.symbol, date, now, row);
  const sec = secStatus(row, book, { coverage });
  const report = book.current ? book.report : null;
  const point = key => { const known = report ? latestKnownQuarter(report.rows, key) : null; return known ? { value: known.value, end: known.end } : null; };
  const code33 = report?.valid ? code33Layered(report, null, date) : null;
  return { sec_state: sec.state, eps_yoy: point('epsYoY'), sales_yoy: point('salesYoY'),
    code33: code33 ? { state: code33.state, kind: code33.state === 'unknown' ? code33Explain(report, sec, code33).kind : null } : null, as_of_date: date };
}

// Growth rates at or above this level in both EPS and sales make the earnings chip green (独自設定, the
// Minervini/O'Neil 25% guide; the card's own EPS floor uses the same 25).
export const EARNINGS_CHIP_PERCENT = 25;
const growth = value => signed(value, 0);
/**
 * The facts of the two growth rates with each period: 「EPS +40%・売上 +100%（26-06期）」 when both quarters are the
 * same, else 「EPS +40%（26-03）・売上 +100%（26-06）」; an unknown one reads 未確認 beside the known one's period. Tone zone (and notable) only
 * when both are at EARNINGS_CHIP_PERCENT or more; a falling EPS is notable in the neutral tone.
 */
function earningsFacts(eps, sales) {
  if (!eps && !sales) return null;
  // Two periods are named without 期 after each value, so the chip stays short on a phone.
  const own = point => `（${point.end.slice(2, 7)}）`;
  const text = eps && sales && eps.end === sales.end ? `EPS ${growth(eps.value)}・売上 ${growth(sales.value)}（${yyMm(eps.end)}）`
    : eps && sales ? `EPS ${growth(eps.value)}${own(eps)}・売上 ${growth(sales.value)}${own(sales)}`
      : `${eps ? `EPS ${growth(eps.value)}（${yyMm(eps.end)}）` : 'EPS 未確認'}・${sales ? `売上 ${growth(sales.value)}（${yyMm(sales.end)}）` : '売上 未確認'}`;
  const strong = Boolean(eps && sales && eps.value >= EARNINGS_CHIP_PERCENT && sales.value >= EARNINGS_CHIP_PERCENT);
  const title = `前年同期比（SEC XBRL・独自設定：EPS・売上とも${EARNINGS_CHIP_PERCENT}%以上で緑）`;
  return { text, tone: strong ? 'zone' : '', title, notable: strong || Boolean(eps && eps.value < 0) };
}
const unknownChip = (title, text = '業績 未確認') => ({ text, tone: '', title, notable: false });

/**
 * The list row's earnings chip, `secRowChip(row)` → `{ text, tone, title, notable }`, or null (no chip) when the
 * publication carries no `sec_summary` field (an older publication: 未収録) or one that is not in the documented shape
 * (the quality gate refuses to publish that, so it never reaches a screen as today's). From the row's sec_summary
 * only (secSummary): a null summary (no admitted SEC record), one for another date or one without either rate is
 * 「業績 未確認」 with the reason in `title`, and a fund or ETF is 「業績 対象外」. Never 0 and never a pass from a missing value.
 */
export function secRowChip(row) {
  if (!row || typeof row !== 'object' || !Object.hasOwn(row, 'sec_summary')) return null;
  if (instrumentApplicability(row).status === 'not_applicable') return unknownChip(SEC_STATUS.not_applicable[1], '業績 対象外');
  if (row.sec_summary === null) return unknownChip('この公開にはこの銘柄の SEC 記録がありません。');
  const summary = secSummary(row);
  if (!summary) return null;
  if (isoDay(row.as_of_date) && summary.as_of_date !== row.as_of_date) return unknownChip('SEC の業績要約が別の日付のものです。');
  const facts = earningsFacts(summary.eps_yoy, summary.sales_yoy);
  if (facts) return facts;
  const reason = summary.sec_state === 'ok' ? 'EPS・売上の前年同期比をどちらも確認できません。' : SEC_STATUS[summary.sec_state]?.[1] || 'SEC の記録を判定に使えません。';
  return unknownChip(`${SEC_STATUS[summary.sec_state]?.[0] || 'SEC'}：${reason}`);
}

/**
 * The stock conclusion's earnings chip, `earningsChipView(financial)` (useStockData's `financial`) →
 * `{ text, tone, title }`: the same facts as the row chip from the stock's current SEC report, with each
 * period, or 「業績 未確認・<reason>」 (the reason in the Code 33 chip's words). Yahoo values never stand in.
 */
export function earningsChipView(financial) {
  if (!financial) return null;
  const sec = financial.sec ?? null, report = financial.report?.valid ? financial.report : null;
  if (sec?.state === 'detail_loading') return { text: '業績 読み込み中', tone: '', title: SEC_STATUS.detail_loading[1] };
  if (sec?.state === 'not_applicable') return { text: '業績 対象外', tone: '', title: SEC_STATUS.not_applicable[1] };
  const point = key => { const known = report ? latestKnownQuarter(report.rows, key) : null; return known ? { value: known.value, end: known.end } : null; };
  const facts = earningsFacts(point('epsYoY'), point('salesYoY'));
  if (facts) return { text: facts.text, tone: facts.tone, title: facts.title };
  const word = !sec ? null : report ? 'EPS・売上' : CHIP_SEC[sec.state] || String(sec.short || '').replace(/\s+/g, '');
  return { text: `業績 未確認${word ? `・${word}` : ''}`, tone: '', title: report ? 'EPS・売上の前年同期比をどちらも確認できません。' : sec?.long || 'SEC の記録はありません。' };
}

/**
 * The line under the stock conclusion's call, `earningsCaution(financial)` → `{ text }`, only when the stock's
 * current SEC report shows a loss in its latest quarter with an EPS (「業績：直近四半期は赤字（EPS −0.50・26-03期・SEC）」)
 * or a falling latest known EPS growth (「業績：直近EPS −35%（26-06期・SEC）」); null otherwise. Never from Yahoo values.
 */
export function earningsCaution(financial) {
  const report = financial?.report?.valid ? financial.report : null;
  if (!report) return null;
  const level = latestKnownQuarter(report.rows, 'eps'), rate = latestKnownQuarter(report.rows, 'epsYoY');
  if (level && level.value < 0 && (!rate || level.end >= rate.end)) return { text: `業績：直近四半期は赤字（EPS ${fixedMinus(level.value, 2)}・${yyMm(level.end)}・SEC）` };
  if (rate && rate.value < 0) return { text: `業績：直近EPS ${growth(rate.value)}（${yyMm(rate.end)}・SEC）` };
  return null;
}

/**
 * Today's one-line warning about this publication's SEC coverage, `fundamentalsCoverageWarning(coverage, { date })`:
 * `coverage` is publishedFundamentalsCoverage's block (or null), `date` the analysis date. `{ text }` only when the
 * block has warnings (COVERAGE_WARNINGS, written by the export), no same-day SEC fetch ran, or its SEC input is for
 * another day; an older block without the warnings list is judged on the last two only. The counts are this
 * publication's own (records with quarters of the fetch's targets); no usual share is claimed.
 */
export function fundamentalsCoverageWarning(coverage, { date = null } = {}) {
  if (!coverage || typeof coverage !== 'object') return null;
  const problem = coverage.sec_fetch_ran !== true || (isoDay(date) && coverage.sec_as_of !== date) || (Array.isArray(coverage.warnings) && coverage.warnings.length > 0);
  if (!problem || !known(coverage.with_quarters)) return null;
  const total = known(coverage.eligible) && coverage.eligible > 0 ? coverage.eligible : coverage.universe;
  if (!known(total)) return null;
  return { text: `業績データ：この公開のSEC記録は${coverage.with_quarters}/${total}銘柄 — 業績の判定は未確認が多くなります` };
}
