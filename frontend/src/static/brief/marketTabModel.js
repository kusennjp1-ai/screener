// View model for the 地合い card (Today's four tiles and the market tab's verdict, warning summary and
// grouped evidence) and for the long-history section under it. Every value comes from the published
// market-trends asset, the scan's market fields (modelMarket) and the existing rule functions: nothing
// here adds a threshold, a status or a verdict. Each value keeps the session it describes.
import { bifurcation, environmentPoint, BREAKOUT_MIN_SAMPLE, LEADER_MIN_COHORT, SPLIT_RULE } from '../marketLongHistory';
import { SECTORS } from '../sectorDefinitions';
import { indexSummary } from '../reference/indexSummary.js';
import { biasTag, ddGradeState, ftdRecent, ftdState, highState, quadrantState, referencePeriod, referenceState, signalTag, stateTag, validReference, TAGS } from '../reference/marketRegimeReference.js';
import { bare, distributionCount, environmentRules, followThroughView, latestKnown, marketTone, shortDate, trendsStatus, ENV_RULES, FTD_TEXT } from './briefModel';

const finite = Number.isFinite;
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const YEAR = 252, MONTH = 21;
/** The existing distribution warning: 5 or more active distribution days on an index. */
export const DISTRIBUTION_WARN = 5;
/** A distribution day counts for 25 sessions (distributionDays.js, the method's age25). */
const DISTRIBUTION_SESSIONS = 25;
/**
 * The breadth series are today's names traced back (the long history's current-universe retrospective): said
 * under the 参加度 and リーダー headers on the desktop, in the 注記 on a phone and in the long history's takeaway.
 */
export const SURVIVORSHIP_NOTE = '現在の銘柄で過去をさかのぼった集計（上場廃止銘柄を含まない）';
const STAGE_FIELDS = ['stage1Percent', 'stage2Percent', 'stage3Percent', 'stage4Percent'];
export const STAGE_NAMES = ['底固め', '上昇', '天井圏', '下降'];
const sectorNames = Object.fromEntries(SECTORS.map(([, label, symbol]) => [symbol, label]));

// Only ever called with a finite number: a unit is never appended to an unknown value.
export const num = (value, digits = 0) => value.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const sign = value => value > 0 ? '+' : value < 0 ? '−' : '±';
export const delta = value => `${sign(value)}${Math.abs(value).toLocaleString('ja-JP')}`;
export const signedPercent = value => { const r = Number(value.toFixed(1)); return `${sign(r)}${Math.abs(r).toFixed(1)}%`; };
/** A change of a share or a rate, in percentage points (never read as a return). */
export const pointChange = (value, digits = 1) => { const r = Number(value.toFixed(digits)); return `${sign(r)}${Math.abs(r).toFixed(digits)}pt`; };

// ---- rule text (基準) -------------------------------------------------------------------------
// Printed beside each row from the same constants the rules use, so the words cannot drift from them.
// The distribution-day definition is the exporter's method (distributionDays.js DISTRIBUTION_METHOD).
export const RULE_TEXT = Object.freeze({
  ftd: `${FTD_TEXT.decline}以上の下落（高値の終値から安値日の終値まで）の後、反発${FTD_TEXT.minDay}〜${FTD_TEXT.maxDay}日目に出来高増を伴う${FTD_TEXT.gain}以上の上昇。確認後にFTD当日の安値を終値で下回ると失敗で、注意サインです。`,
  dist: `指数が前日比0.2%を超えて下落し、出来高が前日より多かった日。25営業日で失効し、その後の高値が分配日の終値から5%以上上がっても除外します。${DISTRIBUTION_WARN}日以上で注意サインです。`,
  above200: `終値が200日線より上の銘柄の割合（観測できた銘柄のうち）。S&P 500が1年高値から${SPLIT_RULE.nearHighPercent}%以内なのに${SPLIT_RULE.above200Below}%未満のとき「指数と個別株の乖離」で注意サインです。`,
  above50: '終値が50日線より上の銘柄の割合（観測できた銘柄のうち）。注意サインの基準はありません。',
  extremes: '52週の高値・安値を更新した銘柄数。新安値が新高値を上回ると注意サインです。',
  template: `ミネルヴィニのトレンドテンプレート8条件（RS推計70以上を含む）をすべて満たす銘柄数。${ENV_RULES.templateSessions}営業日で${ENV_RULES.templateDropPercent}%以上減ると注意サインです（${ENV_RULES.templateSessions}営業日前が${ENV_RULES.templateMinBase}銘柄以上のとき）。`,
  leaderCount: '株価条件のトレンドテンプレート（安値条件25%）とRS推計70以上を満たす銘柄数。TT達成数の旧集計で、注意サインの基準はありません。',
  rs90: 'TT達成銘柄のうちRS推計（独自計算）が90以上の銘柄数。IBDの公式RSではありません。注意サインの基準はありません。',
  breakout: `価格条件を満たし、終値で過去251営業日の高値を超え、出来高が直前50日平均の1.4倍以上だった上抜け（10〜29営業日前）のうち、その後10営業日の安値が上抜け日の終値から−7%に届かなかった割合。${BREAKOUT_MIN_SAMPLE}件未満は率を出しません。${ENV_RULES.breakoutHoldBelow}%未満で注意サインです。`,
  leaders: `20営業日前のTT達成銘柄のうち、終値が50日線の上にある割合（${LEADER_MIN_COHORT}銘柄未満は率を出しません）。${ENV_RULES.leaderHealthBelow}%未満で注意サインです。`,
  stage: `200日線の傾き・株価の傾き・200日線との位置から日ごとに判定した、${STAGE_NAMES.map((name, i) => `${i + 1} ${name}`).join('・')}の割合。ステージ4がステージ2を上回ると注意サインです。`,
});

// ---- small helpers ----------------------------------------------------------------------------

/** Where the value sits between the lowest and highest of its last 252 sessions (a position only, no threshold). */
export function yearRange(rows, hit, field) {
  if (!hit) return null;
  const window = rows.slice(Math.max(0, hit.index - (YEAR - 1)), hit.index + 1).map(row => row[field]);
  const values = window.filter(finite);
  if (values.length < 200) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  return hi > lo ? { lo, hi, at: (hit.value - lo) / (hi - lo), series: window.map(value => finite(value) ? value : null) } : null;
}
/** 「1年で最低／最高」 only when the value is at an end of its one-year range. */
export const rangePosition = range => !range ? null : range.at <= 0 ? '1年で最低' : range.at >= 1 ? '1年で最高' : null;
const monthBefore = (rows, hit, field) => { const before = rows[hit.index - MONTH]; return finite(before?.[field]) ? before[field] : null; };

// The index position (reference/indexSummary.js, plain Node imports it from there): the study's own function.
export { indexSummary };

/**
 * The basis of modelMarket's verdict (portfolioPlan.js) in words, dated to the scan. Its inputs are the
 * scan's market fields: the benchmark (SPY) against its 50/200-day lines and the backend regime.
 * above50 / above200 are what the verdict says about the benchmark (null when it says nothing).
 */
export function verdictBasis(market, date) {
  if (!market || market.state === 'unknown') return null;
  const label = market.label || '', at = date ? `${shortDate(date, date)}スキャン時点` : 'スキャン時点';
  const make = (text, above50, above200) => ({ text: `根拠（${at}）：${text}`, above50, above200 });
  if (/^上昇トレンド/.test(label)) return make('S&P 500（SPY）が50日線・200日線の上で、局面判定（分配日・FTDなど）が「上昇トレンド」', true, true);
  if (/^上昇に圧力/.test(label)) return make('S&P 500（SPY）は50日線・200日線の上で、局面判定が「上昇に圧力」', true, true);
  if (/^50日線割れ/.test(label)) return make('S&P 500（SPY）の終値が50日線の下', false, true);
  if (/^長期トレンド警戒/.test(label)) return make('S&P 500（SPY）の終値が200日線の下', null, false);
  if (/^新規購入を抑制/.test(label)) return make('S&P 500（SPY）は50日線・200日線の上で、局面判定が上昇トレンドではない', true, true);
  return null;
}

/**
 * When the verdict's scan-time benchmark position and the long history's ^GSPC close disagree about a
 * moving average, say that the two inputs differ. Nothing is reconciled and the verdict is unchanged.
 */
export function basisConflict(basis, summary, date) {
  if (!basis || !summary) return null;
  const fifty = basis.above50 === true ? summary.vsMa < 0 : basis.above50 === false ? summary.vsMa > 0 : false;
  const long = !finite(summary.vs200) ? false : basis.above200 === true ? summary.vs200 < 0 : basis.above200 === false ? summary.vs200 > 0 : false;
  if (!fifty && !long) return null;
  return `判定の根拠はスキャン時点のSPY、この数値は長期履歴の^GSPC終値（${shortDate(summary.date, date)}）です。${fifty && long ? '50日線・200日線' : fifty ? '50日線' : '200日線'}との位置が一致していません。`;
}

/** One index's follow-through state in a plain clause (the state is the exporter's; wording only). */
function ftdSignal(name, ft, date) {
  if (!ft || ft.available !== true || ft.state !== 'ftd_failed') return null;
  return `${name}のFTDが失敗${ft.failedDate ? `（${shortDate(ft.failedDate, date)}）` : ''}`;
}

/**
 * The block's dating. Every source (the long history and each index series) is compared with the analysis
 * date: current → a 「M/D 引け」 stamp; behind → one sentence naming each older source, the verdict's
 * own date, and (for Today) the original note.
 */
export function marketDating({ date, historyDate, indexDates }) {
  const md = value => shortDate(value, date);
  const sources = [historyDate, ...indexDates.map(d => d.date)].filter(Boolean);
  const behind = date ? sources.filter(value => value < date) : [];
  const olderIndex = indexDates.filter(d => date && d.date < date);
  // Today's original note (pinned wording): both indices on one older session read as one date.
  const indexDate = !olderIndex.length ? null : olderIndex.length === 2 && olderIndex[0].date === olderIndex[1].date ? olderIndex[0].date : olderIndex.map(d => `${d.name} ${d.date}`).join('・');
  const legacy = [historyDate && date && historyDate < date ? `長期集計は ${historyDate} 時点` : null, indexDate ? `分配日は ${indexDate} 時点` : null].filter(Boolean);
  if (!behind.length) return { current: sources.length > 0, stamp: sources.length && date ? `${md(date)} 引け` : null, lagNote: null, todayNote: null, verdictDate: null };
  const single = new Set(sources).size === 1;
  const indexPart = !olderIndex.length ? null : olderIndex.length === 2 && olderIndex[0].date === olderIndex[1].date ? `分配日・FTDは${md(olderIndex[0].date)}引け` : `分配日・FTDは${olderIndex.map(d => `${d.name} ${md(d.date)}`).join('・')}引け`;
  const parts = single ? [`市場データは${md(sources[0])}引け`] : [historyDate && historyDate < date ? `長期集計は${md(historyDate)}引け` : null, indexPart].filter(Boolean);
  return { current: false, stamp: null, lagNote: `${parts.join('、')}時点（分析基準日${md(date)}の再集計待ち）。日付が異なる項目には個別に日付を付けています。`,
    todayNote: `${legacy.join('・')}（分析基準日 ${date} の再集計待ち）`, verdictDate: `判定 ${md(date)}` };
}

/** The one session every valued item of a group describes, when they all agree on an older one. */
export function groupDate(items) {
  const valued = items.flatMap(item => item?.rows ? item.rows : [item]).filter(item => item?.valued);
  return valued.length && valued.every(item => item.asOf && item.asOf === valued[0].asOf) ? valued[0].asOf : null;
}

/**
 * The words beside the warning summary's study tags: the 〔参考〕 legend (only when a 〔参考〕 tag is shown) and
 * one sentence on every tag shown, for the 注記 on a phone and in place on the desktop. Years come from the reference.
 */
export function signalTagText(reference, fired) {
  const tags = new Set((fired || []).map(c => c.tag).filter(Boolean));
  if (!tags.size || !validReference(reference)) return { legend: null, note: null };
  const breadth = reference.samples?.breadth, from = breadth?.first?.slice(0, 4), to = breadth?.last?.slice(0, 4), index = referencePeriod(reference);
  const legend = tags.has(TAGS.breadth) && from && to ? `${TAGS.breadth}＝${from}〜${to.slice(2)}年の検証で関係未確認` : null;
  const parts = [];
  if (tags.has(TAGS.breadth) && from && to) parts.push(`${TAGS.breadth}は、${from}〜${to}年の参加度データ（${SURVIVORSHIP_NOTE}）の検証で、その後の指数の下げとの関係を確認できなかった注意サインです（全体として偶然と区別できない結果）。`);
  const indexTags = [...tags].filter(tag => tag !== TAGS.breadth);
  if (indexTags.length) parts.push(`${indexTags.join('')}は、${index.fromYear}〜${index.toYear}年の指数の日足で、その状態のあと21日以内に−5%以上下げた割合を調べた結果です（${TAGS['^GSPC']}はS&Pでだけ確認、${TAGS.unestablished}は確認できず）。`);
  parts.push('注意サインの基準と目安は変えていません。');
  return { legend, note: parts.join('') };
}

/**
 * The verdict reads the S&P 500 (SPY) only. While it is positive and the Nasdaq's own follow-through state is a
 * correction, a rally attempt or a failed FTD, a neutral note says so (short: the phone's fold summary).
 */
export function nasdaqNote(ft, date) {
  if (ft?.available !== true || !['correction', 'rally_attempt', 'ftd_failed'].includes(ft.state)) return null;
  const view = followThroughView(ft, date), at = view.asOf ? `${view.asOf}時点・` : '';
  const short = ft.state === 'ftd_failed' ? 'FTD失敗' : view.b;
  return { long: `判定はS&P 500（SPY）のみに基づきます。Nasdaq総合は${view.b}（${at}${ft.state === 'ftd_failed' ? '' : 'FTD未確認・'}独自判定）。`, short: `Nasdaqは${short}（${at}判定はSPYのみ）` };
}

/**
 * The opened 分配日 row: the method in one sentence, each index's active distribution days with the sessions
 * left on the oldest (a later high can remove a day earlier), and each index's last year of counts (gaps stay gaps).
 */
function distributionDetail(dist, date) {
  const details = [`下の分配日は^GSPC/^IXICの別集計（ストーリング日なし・${DISTRIBUTION_WARN}日以上で注意）`];
  const yearLines = [];
  for (const { name, item, hit } of dist) {
    if (!hit) continue;
    const at = date && hit.date < date ? `（${shortDate(hit.date, date)}時点）` : '';
    const events = Array.isArray(item?.events) ? item.events.filter(e => e?.state === 'active' && isDay(e.date)).sort((a, b) => a.date.localeCompare(b.date)) : null;
    if (!events || events.length !== hit.value) details.push(`${name}：有効な分配日の日付を確認できません${at}`);
    else if (!events.length) details.push(`${name}：有効な分配日なし${at}`);
    else {
      const left = Number.isSafeInteger(events[0].ageSessions) && events[0].ageSessions < DISTRIBUTION_SESSIONS ? DISTRIBUTION_SESSIONS - events[0].ageSessions : null;
      details.push(`${name}：${events.map(e => shortDate(e.date, date)).join('・')}${at}${left === null ? '' : `（最も古い日はあと${left}営業日で失効・後日の高値で早く除外される場合あり）`}`);
    }
    const series = (Array.isArray(item?.points) ? item.points : []).slice(-YEAR).map(point => Number.isSafeInteger(point?.value) && point.value >= 0 ? point.value : null);
    const values = series.filter(finite);
    if (values.length >= 200 && Math.max(...values) > Math.min(...values)) yearLines.push({ label: `${name}の分配日`, range: { lo: Math.min(...values), hi: Math.max(...values), series }, format: value => `${num(value)}日` });
  }
  return { details, yearLines };
}

/**
 * One index's published position (the exporter's indices[i].state: indexSummary on the same validated bars and
 * last date as its distribution count). Older publications never had it: 未収録, never a zero.
 */
export function publishedIndexState(item) {
  if (!item) return { state: null, reason: '指数データを確認できません' };
  if (!('state' in item)) return { state: null, reason: '旧形式の公開データに未収録' };
  const s = item.state, points = Array.isArray(item.points) ? item.points : [];
  if (s === null) return { state: null, reason: typeof item.reason === 'string' && item.reason ? item.reason : '指数データを確認できません' };
  const known = value => value === null || finite(value);
  const valid = s && typeof s === 'object' && isDay(s.date) && points.at(-1)?.date === s.date && finite(s.close) && s.close > 0 && known(s.vs50) && known(s.vs200) && known(s.fromHigh)
    && typeof s.fullYear === 'boolean' && !(s.fromHigh !== null && s.fullYear !== true);
  return valid ? { state: { date: s.date, close: s.close, vsMa: s.vs50, vs200: s.vs200, fromHigh: s.fromHigh, fullYear: s.fullYear } } : { state: null, reason: '指数の位置の形式を確認できません' };
}

// ---- the card ---------------------------------------------------------------------------------

/**
 * Everything the 地合い card shows, for Today (`today`: exactly four facts) and the market tab (`groups`).
 * An unknown is never 0 and never a bare 未取得: it carries the precise reason (loading, a failed fetch,
 * an integrity failure, a schema that never recorded the field, a sample too small for a rate).
 */
export function marketCardView({ market, marketLoading = false, trends, date, reference = null }) {
  const status = trendsStatus(trends), ready = status.state === 'ready';
  const history = ready ? trends.data.long_history || null : null;
  const longError = ready && !history && typeof trends.data.long_history_error === 'string' ? trends.data.long_history_error : null;
  const rows = (history?.breadth || []).map(environmentPoint);
  const last = rows.at(-1) || null;
  const split = bifurcation(history);
  const rules = environmentRules(rows), rule = key => rules.find(r => r.key === key);
  const indices = ready ? trends.data.indices || [] : [];
  const spx = indices.find(item => item.symbol === '^GSPC'), ndx = indices.find(item => item.symbol === '^IXIC');
  const historyDate = last?.date || null;
  // Never present an older observation as today's: an item older than the long history or the analysis date carries its date.
  const older = value => value && ((historyDate && value < historyDate) || (date && value < date)) ? shortDate(value, date) : null;
  const known = field => latestKnown(rows, field);
  const hasField = key => rows.some(row => key in row);
  const pending = !market && marketLoading;

  // Why a long-history value is missing, most specific first. A fetch failure is not an integrity failure.
  const failed = status.state === 'error' ? { b: status.kind === 'fetch' ? '取得できません' : '確認できません', em: status.tile } : null;
  const absent = key => status.state === 'loading' ? { b: '読み込み中…', em: '', loading: true }
    : status.state === 'error' ? failed
      : status.state === 'none' ? { b: '未配信', em: '市場推移データなし' }
        : !history ? (longError ? { b: '確認できません', em: '長期集計の整合性エラー' } : { b: '未配信', em: '長期集計なし' })
          : !rows.length ? { b: '未算出', em: '長期集計に観測日なし' }
            : !hasField(key) ? { b: '未収録', em: `旧形式の長期集計 ${shortDate(history.as_of_date, date)}`, missing: true }
              : { b: '未算出', em: '観測率90%以上の日なし' };
  // Why a whole group shows nothing (one line instead of a row of the same reason each).
  const groupUnavailable = scope => status.state === 'loading' ? '読み込み中…' : status.state === 'error' ? `市場推移データを${status.kind === 'fetch' ? '取得' : '確認'}できないため表示しません。`
    : status.state === 'none' ? '市場推移データがないため表示しません。'
      : scope === 'history' && ready && !history ? (longError ? '長期集計の整合性を確認できないため表示しません。' : '長期集計はこの公開に含まれていません。') : null;

  const count = (key, label, field, metric, ruleText) => {
    const hit = known(field); if (!hit) return { key, label, metric, rule: ruleText, ...absent(field) };
    const before = monthBefore(rows, hit, field), range = yearRange(rows, hit, field);
    return { key, label, metric, rule: ruleText, valued: true, b: `${num(hit.value)}銘柄`, asOf: older(hit.date), change: before === null ? null : delta(hit.value - before),
      detail: before === null ? null : `1か月前 ${num(before)}銘柄`, range, position: rangePosition(range), format: value => num(value) };
  };
  const share = (key, label, field, base, metric, ruleText) => {
    const hit = known(field); if (!hit) return { key, label, metric, rule: ruleText, ...absent(field) };
    const before = monthBefore(rows, hit, field), range = yearRange(rows, hit, field);
    return { key, label, metric, rule: ruleText, valued: true, b: `${num(hit.value, 1)}%`, asOf: older(hit.date), change: before === null ? null : pointChange(hit.value - before),
      detail: [finite(hit.row[base]) && finite(hit.row.coverage) ? `観測${num(hit.row.coverage)}中${num(hit.row[base])}銘柄` : null, before === null ? null : `1か月前 ${num(before, 1)}%`].filter(Boolean).join('・') || null,
      range, position: rangePosition(range), format: value => `${num(value, 1)}%`, value: hit.value };
  };

  // Distribution days: each index with its own last observed session.
  const dist = [['S&P', spx], ['NAS', ndx]].map(([name, item]) => ({ name, item, hit: distributionCount(item) }));
  const distWarn = dist.some(d => d.hit && d.hit.value >= DISTRIBUTION_WARN);
  const distAsOfParts = dist.filter(d => d.hit && date && d.hit.date < date);
  const distAsOf = !distAsOfParts.length ? null : distAsOfParts.length === 2 && distAsOfParts[0].hit.date === distAsOfParts[1].hit.date ? shortDate(distAsOfParts[0].hit.date, date) : distAsOfParts.map(d => `${d.name} ${shortDate(d.hit.date, date)}`).join('・');
  const distReasons = ready ? dist.filter(d => !d.hit).map(d => `${d.name}の分配日：${d.item?.reason || '指数データを確認できません。'}`) : [];

  // Breakout success: a rate needs at least BREAKOUT_MIN_SAMPLE judged breakouts on that session.
  const rate = known('breakoutHoldPercent');
  const judgedNow = last && Number.isSafeInteger(last.breakoutsJudged) ? last.breakoutsJudged : null;
  const whyNot = !last || !('breakoutsJudged' in last) ? null : judgedNow === null ? '判定期間に観測不足の日を含む' : judgedNow < BREAKOUT_MIN_SAMPLE ? `${judgedNow}件（${BREAKOUT_MIN_SAMPLE}件未満のため率は非表示）` : '成功数を確認できません';
  const breakoutRule = rule('breakout');
  const breakout = (() => {
    const base = { key: 'breakout', label: 'ブレイクアウト成功率', metric: 'breakoutHoldPercent', rule: RULE_TEXT.breakout };
    if (rate) {
      const before = monthBefore(rows, rate, 'breakoutHoldPercent'), range = yearRange(rows, rate, 'breakoutHoldPercent'), newest = rate.index === rows.length - 1;
      return { ...base, valued: true, b: `${num(rate.value)}%`, asOf: older(rate.date), change: before === null ? null : pointChange(rate.value - before, 0), range, position: rangePosition(range), format: value => `${num(value)}%`,
        note: newest ? `${rate.row.breakoutsJudged}件で判定` : `${rate.row.breakoutsJudged}件で判定${whyNot ? `・最新は${whyNot}` : ''}`,
        detail: newest && Number.isSafeInteger(rate.row.breakoutsHeld) ? `10〜29営業日前の上抜け${rate.row.breakoutsJudged}件のうち${rate.row.breakoutsHeld}件が10日間で−7%に届かず` : null,
        warn: Boolean(breakoutRule?.fired), flag: breakoutRule?.fired ? `${ENV_RULES.breakoutHoldBelow}%未満` : null };
    }
    if (judgedNow !== null && judgedNow < BREAKOUT_MIN_SAMPLE) return { ...base, valued: true, b: `${judgedNow}件`, asOf: older(last.date), note: `${BREAKOUT_MIN_SAMPLE}件未満のため率は非表示` };
    return whyNot ? { ...base, b: '未算出', note: whyNot } : { ...base, ...absent('breakoutsJudged') };
  })();

  // 52-week highs and lows: the existing warning when new lows outnumber new highs.
  const highsLows = known(['newHighs', 'newLows']);
  const lowsLead = highsLows ? highsLows.value.newLows > highsLows.value.newHighs : false;
  const extremesAsOf = highsLows ? older(highsLows.date) : null;

  // An older long history without the trend-template fields still has the price-only leader count.
  const leaderHit = known('leaderCount');
  const templateRule = rule('template');
  const tt = { ...count('tt', 'TT達成数', 'trendTemplateCount', 'trendTemplateCount', RULE_TEXT.template), ...(templateRule?.fired ? { warn: true, flag: `${ENV_RULES.templateSessions}日で${ENV_RULES.templateDropPercent}%以上減少` } : {}) };
  const leaderSubstitute = tt.missing && leaderHit ? count('leaderCount', '先導株数（価格条件）', 'leaderCount', 'leaderCount', RULE_TEXT.leaderCount) : null;

  const a200 = share('a200', '200日線より上', 'above200Percent', 'above200', 'movingAverages', RULE_TEXT.above200);
  if (split?.warning) Object.assign(a200, { warn: true, flag: `指数が1年高値から${SPLIT_RULE.nearHighPercent}%以内で${SPLIT_RULE.above200Below}%未満` });
  const a50 = share('a50', '50日線より上', 'above50Percent', 'above50', 'movingAverages', RULE_TEXT.above50);

  const follow = [['S&P', spx], ['NAS', ndx]].map(([name, item]) => ({ name, item, view: status.state === 'loading' ? { b: '読み込み中…', em: '' } : status.state === 'error' ? failed : status.state === 'none' ? { b: '未配信', em: '市場推移データなし' } : followThroughView(item?.followThrough, date) }));

  // ---- warning summary: every existing rule, fired or not, and the ones that could not be judged ----
  const schemaReason = '旧形式の長期集計に未収録';
  const envReason = (key, fields) => !history ? null : !last ? '長期集計に観測日なし' : fields.some(field => !hasField(field)) ? schemaReason
    : key === 'leaders' && Number.isSafeInteger(last.leaderCohort) && last.leaderCohort < LEADER_MIN_COHORT ? `最新は対象${last.leaderCohort}銘柄（${LEADER_MIN_COHORT}銘柄未満）`
      : key === 'breakout' && judgedNow !== null && judgedNow < BREAKOUT_MIN_SAMPLE ? `最新は判定${judgedNow}件（${BREAKOUT_MIN_SAMPLE}件未満）`
        : key === 'template' && finite(last.trendTemplateCount) && !finite(rows.at(-1 - ENV_RULES.templateSessions)?.trendTemplateCount) ? `${ENV_RULES.templateSessions}営業日前の値なし`
          : key === 'template' && finite(last.trendTemplateCount) && rows.at(-1 - ENV_RULES.templateSessions).trendTemplateCount < ENV_RULES.templateMinBase ? `${ENV_RULES.templateSessions}営業日前が${ENV_RULES.templateMinBase}銘柄未満`
            : '最新の値なし';
  const checks = [];
  const check = (key, group, label, judged, firedText, asOf, reason) => checks.push({ key, group, label, judged, fired: Boolean(judged && firedText), text: judged ? firedText || null : null, asOf: judged ? asOf : null, reason: judged ? null : reason });
  if (ready) {
    for (const d of dist) check(`dist-${d.name}`, 'index', `${d.name}の分配日`, Boolean(d.hit), d.hit && d.hit.value >= DISTRIBUTION_WARN ? `${d.name}の分配日が25日間で${num(d.hit.value)}日` : null, d.hit?.date, '指数データを確認できません');
    for (const f of follow) { const ft = f.item?.followThrough;
      check(`ftd-${f.name}`, 'index', `${f.name}のFTD`, ft?.available === true, ftdSignal(f.name, ft, date), ft?.asOf || distributionCount(f.item)?.date, ft === undefined ? '旧形式の公開データ' : '指数データを確認できません'); }
    if (history) {
      const splitReason = !hasField('above200Percent') ? schemaReason : (history.sp500 || []).filter(p => finite(p.close)).length < YEAR ? '指数の履歴が1年に満たない' : '最新の値なし';
      check('split', 'breadth', '指数と個別株の乖離', Boolean(split), split?.warning ? `指数は1年高値${split.fromHigh > -0.05 ? 'の水準' : `まで${Math.abs(split.fromHigh).toFixed(1)}%`}なのに、200日線より上の銘柄は${num(split.above200Percent, 1)}%（指数と個別株の乖離）` : null, split?.date, splitReason);
      check('lows', 'breadth', '新高値・新安値', Boolean(highsLows), lowsLead ? `新安値（${num(highsLows.value.newLows)}）が新高値（${num(highsLows.value.newHighs)}）を上回る` : null, highsLows?.date, envReason('lows', ['newHighs']));
      const env = [['template', 'breadth', 'TT達成数の急減', ['trendTemplateCount']], ['stage', 'leaders', 'ステージ構成', ['stage1']], ['leaders', 'leaders', 'リーダーの健全度', ['leaderCohort']], ['breakout', 'leaders', 'ブレイクアウト成功率', ['breakoutsJudged']]];
      for (const [key, group, label, fields] of env) { const r = rule(key); check(key, group, label, r.judged, r.text, last?.date, envReason(key, fields)); }
    }
  }
  // Order the summary by group (index → breadth → leaders), as on the page.
  const order = ['index', 'breadth', 'leaders'];
  checks.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  const judgedDates = [...new Set(checks.filter(c => c.judged && c.asOf).map(c => c.asOf))];
  const boxDate = judgedDates.length === 1 && date && judgedDates[0] < date ? shortDate(judgedDates[0], date) : null;
  // Each fired check carries the study's tag for its state (marketRegimeReference SIGNAL_INDICATORS); an index
  // check only when its published method is the study's. The order is the page's, unchanged.
  const methodsOf = name => { const item = name === 'S&P' ? spx : ndx; return { distribution: item?.method ?? null, followThrough: item?.followThrough?.method ?? null }; };
  const tagOf = key => { const ref = validReference(reference) ? reference : null, name = /-(S&P|NAS)$/.exec(key)?.[1]; return signalTag(ref, key, name ? methodsOf(name) : {}); };
  const fired = checks.filter(c => c.fired).map(c => ({ ...c, itemAsOf: !boxDate && c.asOf && date && c.asOf < date ? shortDate(c.asOf, date) : null, tag: tagOf(c.key) }));
  const unjudged = checks.filter(c => !c.judged);
  const reasons = [...new Set(unjudged.map(c => c.reason))].map(reason => ({ reason, labels: unjudged.filter(c => c.reason === reason).map(c => c.label) }));
  // The checks that were judged at all: with none, the summary can never say 「なし」.
  const judged = checks.filter(c => c.judged).map(({ key, group, label }) => ({ key, group, label }));
  const tagText = signalTagText(reference, fired);
  const signals = ready ? { fired, unjudged, reasons, judged, asOf: boxDate, historyMissing: !history, legend: tagText.legend, tagNote: tagText.note } : null;
  const firedIn = group => fired.filter(c => c.group === group).length;

  // ---- dating and verdict ----
  const dating = marketDating({ date, historyDate, indexDates: dist.filter(d => d.hit).map(d => ({ name: d.name, date: d.hit.date })) });
  const tone = marketTone(market);
  const exposure = market?.cap > 0 ? Math.round(market.cap * 100) : market && market.state !== 'unknown' ? 0 : null;
  const verdict = {
    tone, pending, exposure, label: market?.label || (pending ? '判定を読み込み中…' : '市場未確認'),
    lead: market?.cap > 0 ? '新規の買いを検討できます。' : market?.state === 'unknown' ? '市場の状態を確認できません。新規の買いは見送ります。' : market ? '新規の買いは控えます（独自判定）。' : pending ? '市場の判定を読み込み中です。' : '市場の判定を読み込めません。新規の買いは見送ります。',
    text: market?.cap > 0 ? `新規の買いを検討できる地合い。エクスポージャーの目安は最大 ${Math.round(market.cap * 100)}%（独自判定）。` : market?.state === 'unknown' ? '市場の状態を確認できません。新規の買いは見送ります。' : market ? '新規の買いは控えます（独自判定）。' : pending ? '市場の判定を読み込み中です。' : '市場の判定を読み込めません。新規の買いは見送ります。',
    basis: verdictBasis(market, date), date: market && market.state !== 'unknown' ? dating.verdictDate : null,
    nasdaq: market?.cap > 0 ? nasdaqNote(ndx?.followThrough, date) : null,
  };
  const summary = ready ? indexSummary(history?.sp500) : null;
  const conflict = basisConflict(verdict.basis, summary, date);

  // ---- Today: exactly four facts ----
  const distPairs = dist.map(d => d.hit ? { name: d.name, value: `${num(d.hit.value)}日`, warn: d.hit.value >= DISTRIBUTION_WARN } : { name: d.name, value: '算出不可' });
  const heavy = dist.filter(d => d.hit && d.hit.value >= DISTRIBUTION_WARN).map(d => d.name);
  const todayDist = !ready ? { key: 'dist', label: '分配日（25日）', ...absent('') }
    : dist.every(d => !d.hit) ? { key: 'dist', label: '分配日（25日）', b: '算出不可', em: 'S&P・NAS' }
      : { key: 'dist', label: '分配日（25日）', valued: true, pairs: distPairs, asOf: distAsOf, warn: distWarn, em: distWarn ? `注意：${heavy.join('・')}が${DISTRIBUTION_WARN}日以上` : `${DISTRIBUTION_WARN}日以上で注意` };
  const todayTT = leaderSubstitute ? { ...leaderSubstitute, em: 'TT達成数は旧形式で未収録' } : { ...tt, em: tt.valued ? (tt.change === null ? '8条件すべて達成' : `1か月で ${tt.change}`) : tt.em, ...(tt.warn ? { em: `注意：${tt.flag}` } : {}) };
  const a50Today = a50.valued ? { ...a50, em: '200日線は旧形式で未収録' } : null;
  const todayA200 = a200.missing && a50Today ? a50Today : { ...a200, em: a200.valued ? (a200.warn ? '注意：指数と個別株の乖離' : a200.detail) : a200.em };
  const todayExtremes = highsLows ? { key: 'extremes', label: '52週の新高値・新安値', valued: true, asOf: extremesAsOf, warn: lowsLead,
    pairs: [{ name: '高', value: num(highsLows.value.newHighs) }, { name: '安', value: num(highsLows.value.newLows), warn: lowsLead }], em: lowsLead ? '注意：新安値が新高値より多い' : `差 ${delta(highsLows.value.newHighs - highsLows.value.newLows)}` }
    : { key: 'extremes', label: '52週の新高値・新安値', ...absent('newHighs') };
  const today = [todayDist, todayTT, todayA200, todayExtremes];

  // ---- market tab: three groups in decision order ----
  const followRows = follow.map(f => ({ name: f.name, ...f.view, valued: ready && f.view.b !== '未集計' && f.view.b !== '算出不可', warn: f.view.tone === 'ext', flag: f.view.tone === 'ext' ? 'FTD失敗' : null }));
  const ftdItem = { key: 'ftd', label: 'フォロースルーデー（独自判定）', className: 'brief-ftd', rows: followRows, rule: RULE_TEXT.ftd, warn: followRows.some(r => r.warn) };
  const distItem = !ready ? { key: 'dist', label: '分配日（25日）', className: 'brief-dist', rule: RULE_TEXT.dist, ...absent('') }
    : { key: 'dist', label: '分配日（25日）', className: 'brief-dist', rule: RULE_TEXT.dist, warn: distWarn, ...distributionDetail(dist, date), rows: dist.map(d => d.hit
      ? { name: d.name, valued: true, b: `${num(d.hit.value)}日`, asOf: date && d.hit.date < date ? shortDate(d.hit.date, date) : null, warn: d.hit.value >= DISTRIBUTION_WARN, flag: d.hit.value >= DISTRIBUTION_WARN ? `${DISTRIBUTION_WARN}日以上` : null }
      : { name: d.name, b: '算出不可', em: d.item?.reason || '指数データを確認できません。' }) };
  const extremesItem = highsLows ? { key: 'extremes', label: '52週の新高値・新安値', className: 'brief-dist', metric: 'highsLows', rule: RULE_TEXT.extremes, warn: lowsLead,
    note: `差 ${delta(highsLows.value.newHighs - highsLows.value.newLows)}`, rows: [
      { name: '新高値', valued: true, b: num(highsLows.value.newHighs), asOf: extremesAsOf },
      { name: '新安値', valued: true, b: num(highsLows.value.newLows), asOf: extremesAsOf, warn: lowsLead, flag: lowsLead ? '新高値より多い' : null }] }
    : { key: 'extremes', label: '52週の新高値・新安値', metric: 'highsLows', rule: RULE_TEXT.extremes, ...absent('newHighs') };

  const rs90 = count('rs90', 'RS推計90以上のTT達成（独自）', 'rs90TemplateCount', 'trendTemplateCount', RULE_TEXT.rs90);
  const leadersRule = rule('leaders'), stageRule = rule('stage');
  const health = known('leaderHealthPercent');
  const cohortNow = last && Number.isSafeInteger(last.leaderCohort) ? last.leaderCohort : null;
  const healthBase = { key: 'health', label: 'リーダーの健全度', metric: 'leaderHealthPercent', rule: RULE_TEXT.leaders };
  // A newest cohort too small for a rate is today's state; an older rate is not shown in its place.
  const healthItem = cohortNow !== null && cohortNow < LEADER_MIN_COHORT ? { ...healthBase, valued: true, b: `${cohortNow}銘柄`, asOf: older(last.date), note: `20営業日前のTT達成が${LEADER_MIN_COHORT}銘柄未満のため率は非表示` }
    : health ? (() => { const before = monthBefore(rows, health, 'leaderHealthPercent'), range = yearRange(rows, health, 'leaderHealthPercent');
      return { ...healthBase, valued: true, b: `${num(health.value)}%`, asOf: older(health.date), change: before === null ? null : pointChange(health.value - before, 0), range, position: rangePosition(range), format: value => `${num(value)}%`,
        note: `20営業日前のTT達成${num(health.row.leaderCohort)}銘柄が対象`, detail: `${num(health.row.leaderCohort)}銘柄のうち${num(health.row.leaderCohortAbove50)}銘柄が50日線の上`,
        warn: Boolean(leadersRule?.fired), flag: leadersRule?.fired ? `${ENV_RULES.leaderHealthBelow}%未満` : null }; })()
      : { ...healthBase, ...absent('leaderCohort') };
  const stageHit = known(STAGE_FIELDS);
  const stageItem = stageHit ? { key: 'stage', label: 'ステージ構成', className: 'is-stage', metric: 'stages', rule: RULE_TEXT.stage, valued: true, b: `ステージ2 ${num(stageHit.value.stage2Percent, 0)}%`, asOf: older(stageHit.date),
    warn: Boolean(stageRule?.fired), flag: stageRule?.fired ? 'ステージ4がステージ2より多い' : null, stages: STAGE_FIELDS.map((field, i) => ({ k: i + 1, name: STAGE_NAMES[i], share: stageHit.value[field] })) }
    : { key: 'stage', label: 'ステージ構成', className: 'is-stage', metric: 'stages', rule: RULE_TEXT.stage, ...absent('stage1') };

  // Values a former long-history schema did not record are named once per group, not row by row.
  const missingLine = items => { const gone = items.filter(item => item.missing); return gone.length ? `旧形式の長期集計（${shortDate(history.as_of_date, date)}）には未収録：${gone.map(item => item.label).join('・')}` : null; };
  // `unknown`: the group shows a value as 未収録・算出不可・未算出 (or nothing at all), or one of its
  // checks could not be judged. A phone's section tab marks it, so a hidden section never reads as clean.
  const unvalued = item => (item.rows ? item.rows.some(row => !row.valued) : !item.valued);
  const makeGroup = (id, title, question, short, items, scope) => {
    const unavailable = groupUnavailable(scope);
    const unknown = status.state !== 'loading' && (Boolean(unavailable) || items.some(unvalued) || checks.some(c => c.group === id && !c.judged));
    return { id, title, question, short, items: unavailable ? [] : items.filter(item => !item.missing), fired: firedIn(id), unknown, asOf: unavailable ? null : groupDate(items), missing: unavailable || !history ? null : missingLine(items), unavailable };
  };
  const groups = [
    makeGroup('index', '指数のトレンド', '上昇トレンドは続いているか', '指数', [ftdItem, distItem], 'index'),
    makeGroup('breadth', '市場の参加度', '多くの銘柄が上昇に加わっているか', '参加度', [a200, a50, extremesItem, tt, leaderSubstitute].filter(Boolean), 'history'),
    makeGroup('leaders', 'リーダーの健全性', '先導株が崩れていないか', 'リーダー', [rs90, breakout, healthItem, stageItem], 'history'),
  ];

  const nasdaqPosition = ready ? publishedIndexState(ndx) : null;
  return { status, ready, history, longError, dating, verdict, signals, summary, conflict, groups, today, distReasons, nasdaqPosition,
    warnings: rules.filter(r => r.fired).map(({ key, text }) => ({ key, text })), split, chart: { sp500: history?.sp500, distribution: spx, distributionEnd: distributionCount(spx)?.date || null, followThrough: spx?.followThrough ?? null } };
}

// ---- the study block (過去の傾向) ----------------------------------------------------------------

const INDEX_NAMES = Object.freeze({ '^GSPC': 'S&P 500', '^IXIC': 'Nasdaq総合' });
const TOPICS = Object.freeze({ 'ma.quadrant': '50日線・200日線との位置', 'high.near': '1年高値との位置', 'dd.graded': '分配日', 'ftd.state': 'FTD判定', 'combo.ftd_recent': 'FTD確認からの日数' });
const QUADRANT_TEXT = Object.freeze({ above_both: '50日線・200日線の上', above200_below50: '200日線の上・50日線の下', below200_above50: '200日線の下・50日線の上', below_both: '50日線・200日線の下' });
const FTD_STATE_TEXT = Object.freeze({ no_correction: '6%以上の調整なし（FTD不要）', no_correction_pending: 'FTD判定保留（集計期間の初日が高値）', correction: '調整中（FTD判定）', rally_attempt: '反発中（FTD判定）',
  attempt_expired: '15日以内のFTDなし', confirmed: 'FTD確認後', ftd_failed: 'FTD失敗' });
/** The words of a study state (the reference's own bucket definitions) and of its comparator. */
function stateText(ref, suffix, state) {
  const near = ref.buckets.nearHighPercent, recent = ref.buckets.ftdRecentSessions;
  if (suffix === 'ma.quadrant') return QUADRANT_TEXT[state] ?? null;
  if (suffix === 'high.near') return { near: `1年高値から${near}%以内`, below: `1年高値から${near}%超の下` }[state] ?? null;
  if (suffix === 'dd.graded') { const at = ref.buckets.states['dd.graded'].indexOf(state), grade = ref.buckets.ddGrades[at]; return grade ? (grade[1] === null ? `分配日${grade[0]}日以上` : `分配日${grade[0]}〜${grade[1]}日`) : null; }
  if (suffix === 'ftd.state') return FTD_STATE_TEXT[state] ?? null;
  if (suffix === 'combo.ftd_recent') return { recent: `FTD確認から${recent}日以内`, other: 'それ以外' }[state] ?? null;
  return null;
}
function comparatorText(ref, suffix, row) {
  if (row.comparator === 'baseline') return '全期間';
  const near = ref.buckets.nearHighPercent, recent = ref.buckets.ftdRecentSessions;
  if (suffix === 'high.near') return { near: `${near}%以内`, below: `${near}%超の下` }[row.comparatorState] ?? null;
  if (suffix === 'combo.ftd_recent') return { recent: `${recent}日以内`, other: 'それ以外' }[row.comparatorState] ?? null;
  return null;
}
const OUTCOME = '21日以内に−5%以上下げた割合';
const share = value => `${num(Math.round(value))}%`;

/** The trailing run of known closes: a window never bridges an unknown close, as in the study. */
function trailingRun(points) {
  const run = [];
  for (let i = (points || []).length - 1; i >= 0 && finite(points[i]?.close) && points[i].close > 0; i--) run.push(points[i]);
  return run.reverse();
}

/**
 * The 指数 panel's 「過去の傾向」: for each index, the state it is in today joined to the study row of that state
 * (P(21-session drawdown <= -5%) and its comparator: the same sample's baseline, called 全期間, or for a two-state
 * indicator the other state), its tag and its own date. States are never combined and the baseline is never a
 * state's value. A state joins a row only when it is judged as the study judged it (same method ids and windows):
 *  - S&P 50/200-day cell and 1-year-high state: indexSummary on the long history's ^GSPC closes (200 closes for
 *    the cell, 252 for the high state); Nasdaq: the exporter's indices[^IXIC].state, absent from older data.
 *  - distribution grade and follow-through state: the market-trends index series, only when its method ids are
 *    the reference's; FTD confirmed within ftdRecentSessions adds the combo.ftd_recent row.
 * Every item is { indicator, state, stateDate, pDd5, comparator, comparatorPDd5, tag, biasTag, edgeDistance } or
 * { reason } (with whatever of indicator / state / date is known), each with its line `text`.
 */
export function marketRegimeContext({ history, trends, reference, date = null }) {
  const status = trendsStatus(trends);
  const unavailable = reason => ({ available: false, reason, summary: '過去の傾向（予測ではありません）', footer: null, indices: [] });
  if (!validReference(reference)) return unavailable('検証結果の参照データを確認できないため表示しません。');
  const period = referencePeriod(reference), summary = `過去の傾向（${period.fromYear}〜${period.toYear}年・予測ではありません）`;
  if (status.state !== 'ready') return { ...unavailable(status.state === 'loading' ? '読み込み中…' : status.state === 'none' ? '市場推移データがないため表示しません。' : '市場推移データを確認できないため表示しません。'), summary };
  const indices = trends.data.indices || [];
  let lead = true;
  const md = value => shortDate(value, date);
  const item = (symbol, suffix, state, stateDate, extra = {}) => {
    const base = { indicator: `${symbol}.${suffix}`, state, stateDate, label: stateText(reference, suffix, state) };
    const row = referenceState(reference, base.indicator, state), when = `${md(stateDate)}時点${finite(extra.edgeDistance) ? `・境界まで${num(extra.edgeDistance, 1)}%` : ''}`;
    if (!row || !base.label) return { ...base, reason: '検証結果に該当する行がありません', text: `${base.label || TOPICS[suffix]}（${when}）：検証結果に該当する行がありません` };
    const tag = stateTag(reference, suffix, symbol, state);
    if (row.labelDd5 === 'insufficient' || !finite(row.pDd5)) return { ...base, reason: '標本不足', tag: TAGS.insufficient, text: `${base.label}（${when}）：${TAGS.insufficient}` };
    const comparator = comparatorText(reference, suffix, row), bias = biasTag(row);
    const text = `${base.label}（${when}）：${lead ? `${OUTCOME} ` : ''}${share(row.pDd5)}${comparator && finite(row.comparatorPDd5) ? `（${comparator} ${share(row.comparatorPDd5)}）` : ''}${tag || ''}${bias || ''}`;
    lead = false;
    return { ...base, ...extra, pDd5: row.pDd5, comparator: row.comparator, comparatorLabel: comparator, comparatorPDd5: row.comparatorPDd5, tag, biasTag: bias, text };
  };
  const reasonItem = (symbol, suffix, reason, stateDate = null) => ({ indicator: `${symbol}.${suffix}`, state: null, stateDate, reason, text: `${TOPICS[suffix]}${stateDate ? `（${md(stateDate)}時点）` : ''}：${reason}` });

  const blocks = ['^GSPC', '^IXIC'].map(symbol => {
    const index = indices.find(entry => entry?.symbol === symbol) || null, items = [];
    // Position: the S&P from the long history's ^GSPC closes, the Nasdaq from the exporter's state.
    let position = null, positionReason = null;
    if (symbol === '^GSPC') {
      const closes = history?.sp500 || [], run = trailingRun(closes);
      if (!history) positionReason = '長期集計がないため判定できません';
      else if (!closes.length) positionReason = '指数の終値の履歴がないため判定できません';
      else if (!run.length) positionReason = '最新の終値がないため判定できません';
      else { position = indexSummary(run); if (!position) positionReason = '60日分の終値がないため判定できません'; }
    } else ({ state: position, reason: positionReason } = publishedIndexState(index));
    const quadrant = quadrantState(position);
    items.push(quadrant ? item(symbol, 'ma.quadrant', quadrant, position.date) : reasonItem(symbol, 'ma.quadrant', positionReason || '200日分の終値がないため判定できません', position?.date));
    const high = highState(position, reference.buckets.nearHighPercent);
    items.push(high ? item(symbol, 'high.near', high, position.date, { edgeDistance: Math.abs(position.fromHigh + reference.buckets.nearHighPercent) })
      : reasonItem(symbol, 'high.near', positionReason || '1年分（252日）の終値がないため判定できません', position?.date));
    // Distribution days and the follow-through state, from the index series when its method is the study's.
    const hit = distributionCount(index), grade = hit ? ddGradeState(hit.value, reference) : null;
    items.push(!index ? reasonItem(symbol, 'dd.graded', '指数データを確認できません')
      : index.method !== reference.methods.distribution ? reasonItem(symbol, 'dd.graded', index.method ? '集計方法が検証と異なるため表示しません' : '集計方法の記録がないため表示しません', hit?.date)
        : !grade ? reasonItem(symbol, 'dd.graded', '分配日を算出できないため表示しません') : item(symbol, 'dd.graded', grade, hit.date));
    const ft = index?.followThrough, bucket = ftdState(ft);
    items.push(ft === undefined ? reasonItem(symbol, 'ftd.state', '旧形式の公開データに未収録')
      : ft?.method !== reference.methods.followThrough ? reasonItem(symbol, 'ftd.state', ft?.method ? '判定方法が検証と異なるため表示しません' : '判定方法の記録がないため表示しません')
        : !bucket ? reasonItem(symbol, 'ftd.state', typeof ft?.reason === 'string' && ft.reason ? bare(ft.reason) : 'FTDを判定できないため表示しません') : item(symbol, 'ftd.state', bucket, ft.asOf));
    if (bucket && ft.method === reference.methods.followThrough && ftdRecent(ft, reference)) items.push(item(symbol, 'combo.ftd_recent', 'recent', ft.asOf));
    return { symbol, name: INDEX_NAMES[symbol], items };
  });
  const sample = period.same ? `^GSPC・^IXIC日足 ${period.first}〜${period.last}` : ['^GSPC', '^IXIC'].map(symbol => `${symbol}日足 ${reference.samples[symbol].first}〜${reference.samples[symbol].last}`).join('・');
  const footer = `状態ごとの過去の割合で、組み合わせた確率ではありません。これらは同じ事実（下げの最中・直後は値動きが荒い）を別の形で数えたもので、2指数は連動しているため独立の確認ではありません。平均リターンが低かった状態は両指数ともありません（方向は未確立）。指数の結果で、個別銘柄の値ではありません。出典：${reference.study_version}${reference.source?.ci_run ? `（CI run ${reference.source.ci_run}）` : ''}、${sample}`;
  return { available: true, summary, footer, indices: blocks };
}

// ---- the long-history section -----------------------------------------------------------------

/**
 * One line on what the long history says, from the data only: the leader count against a year earlier
 * and its one-year range, and the leading sectors of the newest complete frame, then the survivorship caveat
 * (always). A value older than the analysis date `date` carries its own session (「9/30時点」), so a lagging
 * history never reads as today's.
 */
export function historyTakeaway(history, date = null) {
  if (!history) return null;
  const rows = (history.breadth || []).map(environmentPoint);
  const field = rows.some(row => 'trendTemplateCount' in row) ? ['trendTemplateCount', 'TT達成数'] : ['leaderCount', '先導株数（価格条件）'];
  const hit = latestKnown(rows, field[0]), parts = [];
  const olderThan = value => Boolean(value && date && value < date);
  if (hit && hit.index >= YEAR - 1) {
    const window = rows.slice(hit.index - (YEAR - 1), hit.index + 1).map(row => row[field[0]]).filter(finite), before = rows[hit.index - (YEAR - 1)]?.[field[0]];
    const when = olderThan(hit.date) ? `${shortDate(hit.date, date)}時点・` : '';
    // Without a year-earlier value the count is named by its own session, never 「現在」.
    const from = finite(before) ? `1年前の${num(before)}から` : `${shortDate(hit.date, date || hit.date)}時点で`;
    if (window.length >= 200) parts.push(`${field[1]}は${from}${num(hit.value)}銘柄（${finite(before) ? when : ''}1年の範囲 ${num(Math.min(...window))}〜${num(Math.max(...window))}）`);
  }
  const frame = (history.sectorRotation?.frames || []).at(-1);
  if (frame?.ranks?.length === 11) parts.push(`セクターの上位は${[...frame.ranks].sort((a, b) => a.rank - b.rank).slice(0, 3).map(row => sectorNames[row.symbol] || row.symbol).join('・')}${olderThan(frame.date) ? `（${shortDate(frame.date, date)}時点）` : ''}`);
  // The breadth series below are today's names traced back: said with every takeaway, whatever it holds.
  parts.push(`参加度・リーダーの推移は${SURVIVORSHIP_NOTE}`);
  return `${parts.join('。')}。`;
}

const completeFrame = frame => frame?.ranks?.length === 11 && frame.ranks.every(row => Number.isSafeInteger(row.rank) && finite(row.relativeIndex));
/**
 * Sector ETFs ranked by this app's own relative strength (126-session price relative to SPY) on the newest
 * frame, each with its value as published (100 = the same move as SPY), its bar width against the widest
 * gap from 100, and its rank a month (21 frames) earlier. An incomplete frame invents no ranks.
 */
export function sectorRanks(history, date) {
  const frames = history?.sectorRotation?.frames || [];
  const current = frames.at(-1) || null, before = frames.length > MONTH ? frames[frames.length - 1 - MONTH] : null;
  if (!completeFrame(current)) return { complete: false, date: current?.date || null, older: Boolean(current?.date && date && current.date < date), rows: [] };
  const prior = completeFrame(before) ? new Map(before.ranks.map(row => [row.symbol, row.rank])) : null;
  const spread = Math.max(1, ...current.ranks.map(row => Math.abs(row.relativeIndex - 100)));
  return { complete: true, date: current.date, older: Boolean(date && current.date < date), beforeDate: prior ? before.date : null,
    rows: current.ranks.slice().sort((a, b) => a.rank - b.rank || a.symbol.localeCompare(b.symbol)).map(row => {
      const was = prior?.get(row.symbol), move = Number.isSafeInteger(was) ? was - row.rank : null;
      return { symbol: row.symbol, name: sectorNames[row.symbol] || row.symbol, rank: row.rank, value: row.relativeIndex, text: num(row.relativeIndex, 1),
        up: row.relativeIndex >= 100, width: 50 * Math.abs(row.relativeIndex - 100) / spread, was: Number.isSafeInteger(was) ? was : null, move };
    }) };
}
