// The market tab's study parts (Track B): the 「過去の傾向」 block, the study tags of the warning summary and their
// words, the Nasdaq's own state beside the SPY verdict, its published position and the opened 分配日 row. Only the
// lazily loaded market tab (MarketScreen.jsx) imports this module, so none of it ships with Today; MarketScreen
// hands the result to the 地合い card (marketCardView's `study`). Every number comes from the published market-trends
// asset or the generated reference (market-regime-reference-v1.json): nothing here types a percentage, changes a
// rule, a threshold or the verdict.
import { bare, distributionCount, followThroughView, shortDate, trendsStatus } from '../brief/briefModel';
import { DISTRIBUTION_WARN, num, signedPercent, SURVIVORSHIP_NOTE } from '../brief/marketTabModel';
import { indexSummary } from './indexSummary.js';
import { biasTag, ddGradeState, ftdRecent, ftdState, highState, meanLowerStates, quadrantState, referencePeriod, referenceState, signalTags, stateTag, validReference, BIAS_SHARE, SIGNAL_INDICATORS, TAGS } from './marketRegimeReference.js';

const finite = Number.isFinite;
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const YEAR = 252;
/** A distribution day counts for 25 sessions (distributionDays.js, the method's age25). */
const DISTRIBUTION_SESSIONS = 25;
/** The survivorship caveat inside a parenthesis of its own (no nested （）). */
const SURVIVORSHIP_INLINE = SURVIVORSHIP_NOTE.replace('（', '・').replace('）', '');

// ---- the tags' words ------------------------------------------------------------------------------------------
/** The study's outcome, as the first line of the block names it and as the key defines it. */
export const OUTCOME = '21営業日以内に5%以上下げた割合';
const OUTCOME_DEFINITION = 'その日の終値から21営業日以内に終値で5%以上下げた日の割合';
/** 〔偏り〕 in words, from BIAS_SHARE (symmetric bounds read as one share in either half). */
const biasWords = () => BIAS_SHARE.atMost === 100 - BIAS_SHARE.atLeast ? `その状態の日の${BIAS_SHARE.atLeast}%以上が検証期間の前半か後半に集中`
  : `その状態の日のうち検証期間の前半が${BIAS_SHARE.atLeast}%以上か${BIAS_SHARE.atMost}%以下`;
/** What each index tag means, in the order the key lists them. */
export const TAG_MEANINGS = Object.freeze({
  [TAGS.both]: '両指数で確認', [TAGS['^GSPC']]: 'S&Pでのみ確認', [TAGS['^IXIC']]: 'Nasdaqでのみ確認',
  [TAGS.unestablished]: 'その指数では確認できず', [TAGS.insufficient]: '日数が足りず判定なし', [TAGS.bias]: biasWords(),
});
const CONFIRMED_TAGS = [TAGS.both, TAGS['^GSPC'], TAGS['^IXIC']];
/** 確認 (a robust label): rotation-placebo p <= 0.05 and both halves agree in sign. */
const CONFIRMED = '偶然では説明しにくい差（p≤0.05）が、期間の前半・後半とも同じ向きで出たこと';
const meanings = tags => Object.keys(TAG_MEANINGS).filter(tag => tags.has(tag));

/**
 * The words beside the warning summary's study tags: the 〔参考〕 legend (only when a 〔参考〕 tag is shown) and one
 * sentence on every tag shown, each defined from TAG_MEANINGS, for the 注記 on a phone and in place on the desktop.
 * Years and the breadth panel's chance level come from the reference. `fired` are the checks with their `tags`.
 */
export function signalTagText(reference, fired) {
  const tags = new Set((fired || []).flatMap(c => c.tags || []));
  if (!tags.size || !validReference(reference)) return { legend: null, note: null };
  const breadth = reference.samples?.breadth, from = breadth?.first?.slice(0, 4), to = breadth?.last?.slice(0, 4), index = referencePeriod(reference);
  const legend = tags.has(TAGS.breadth) && from && to ? `${TAGS.breadth}＝${from}〜${to.slice(2)}年の検証で関係未確認` : null;
  const parts = [];
  // 「偶然と区別できない」 only when the breadth panel's robust labels stayed within its placebo's 95th percentile.
  const chance = reference.chance?.breadth, chanceLike = finite(chance?.actual) && finite(chance?.p95) && chance.actual <= chance.p95;
  if (tags.has(TAGS.breadth) && from && to) parts.push(`${TAGS.breadth}は、${from}〜${to}年の参加度データ（${SURVIVORSHIP_INLINE}）の検証で、その後の指数の下げとの関係を確認できなかった注意サインです${chanceLike ? '（全体として偶然と区別できない結果）' : ''}。`);
  const shown = meanings(tags);
  if (shown.length) {
    parts.push(`${shown.filter(tag => tag !== TAGS.bias).join('')}は、${index.fromYear}〜${index.toYear}年の指数の日足で、その状態のあと${OUTCOME}を調べた結果です（${shown.map(tag => `${tag}は${TAG_MEANINGS[tag]}`).join('、')}）。`);
    if (shown.some(tag => CONFIRMED_TAGS.includes(tag))) parts.push(`確認は、${CONFIRMED}です。`);
  }
  parts.push('注意サインの基準と目安は変えていません。');
  return { legend, note: parts.join('') };
}

/** The key under the block's lines: the outcome, 全期間, and every tag the lines show (nothing else). */
export function regimeKey(tags) {
  const shown = meanings(new Set(tags));
  return [`割合は、${OUTCOME_DEFINITION}です。全期間は、その項目を判定できた全営業日での割合です。`,
    shown.length ? `${shown.map(tag => `${tag}＝${TAG_MEANINGS[tag]}`).join('、')}。` : '',
    shown.some(tag => CONFIRMED_TAGS.includes(tag)) ? `確認は、${CONFIRMED}です。` : ''].join('');
}

// ---- the Nasdaq beside the SPY verdict, its position and the 分配日 detail ------------------------------------

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

/** The Nasdaq's figures in words (a distance without its window is 未算出, never 0). */
export function nasdaqFigures(state, date) {
  if (!state) return null;
  const at = (label, value) => `${label} ${finite(value) ? signedPercent(value) : '未算出'}`;
  return { close: num(state.close, 2), text: `${shortDate(state.date, date)}終値・${at('1年高値から', state.fromHigh)}・${at('50日線比', state.vsMa)}・${at('200日線比', state.vs200)}` };
}

/**
 * The opened 分配日 row: the method in one sentence, each index's active distribution days with the sessions
 * left on the oldest (a later high can remove a day earlier), and each index's last year of counts (gaps stay gaps).
 */
export function distributionDetail(indices, date) {
  const details = [`下の分配日は^GSPC/^IXICの別集計（ストーリング日なし・${DISTRIBUTION_WARN}日以上で注意）`];
  const yearLines = [];
  for (const [name, symbol] of [['S&P', '^GSPC'], ['NAS', '^IXIC']]) {
    const item = (indices || []).find(entry => entry?.symbol === symbol), hit = distributionCount(item);
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

// ---- the study block (過去の傾向) ----------------------------------------------------------------------------

const INDEX_NAMES = Object.freeze({ '^GSPC': 'S&P 500', '^IXIC': 'Nasdaq総合' });
const TOPICS = Object.freeze({ 'ma.quadrant': '50日線・200日線との位置', 'high.near': '1年高値との位置', 'dd.graded': '分配日', 'ftd.state': 'FTD判定', 'combo.ftd_recent': 'FTD確認からの日数' });
const QUADRANT_TEXT = Object.freeze({ above_both: '50日線・200日線の上', above200_below50: '200日線の上・50日線の下', below200_above50: '200日線の下・50日線の上', below_both: '50日線・200日線の下' });
/** A follow-through state and its qualifier; the qualifier shares the date's parenthesis (「反発中（FTD判定・10/2時点）」). */
const FTD_STATE_TEXT = Object.freeze({ no_correction: ['6%以上の調整なし', 'FTD不要'], no_correction_pending: ['FTD判定保留', '集計期間の初日が高値'], correction: ['調整中', 'FTD判定'],
  rally_attempt: ['反発中', 'FTD判定'], attempt_expired: ['15日以内のFTDなし', null], confirmed: ['FTD確認後', null], ftd_failed: ['FTD失敗', null] });
/** The words of a study state (the reference's own bucket definitions): { text, note } or null. */
function stateText(ref, suffix, state) {
  const near = ref.buckets.nearHighPercent, recent = ref.buckets.ftdRecentSessions, plain = text => text ? { text, note: null } : null;
  if (suffix === 'ma.quadrant') return plain(QUADRANT_TEXT[state]);
  if (suffix === 'high.near') return plain({ near: `1年高値から${near}%以内`, below: `1年高値から${near}%超の下` }[state]);
  if (suffix === 'dd.graded') { const at = ref.buckets.states['dd.graded'].indexOf(state), grade = ref.buckets.ddGrades[at]; return grade ? plain(grade[1] === null ? `分配日${grade[0]}日以上` : `分配日${grade[0]}〜${grade[1]}日`) : null; }
  if (suffix === 'ftd.state') return FTD_STATE_TEXT[state] ? { text: FTD_STATE_TEXT[state][0], note: FTD_STATE_TEXT[state][1] } : null;
  if (suffix === 'combo.ftd_recent') return plain({ recent: `FTD確認から${recent}日以内`, other: 'それ以外' }[state]);
  return null;
}
function comparatorText(ref, suffix, row) {
  if (row.comparator === 'baseline') return '全期間';
  const near = ref.buckets.nearHighPercent, recent = ref.buckets.ftdRecentSessions;
  if (suffix === 'high.near') return { near: `${near}%以内`, below: `${near}%超の下` }[row.comparatorState] ?? null;
  if (suffix === 'combo.ftd_recent') return { recent: `${recent}日以内`, other: 'それ以外' }[row.comparatorState] ?? null;
  return null;
}
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
 * indicator the other state), its tags and its own date. States are never combined and the baseline is never a
 * state's value. A state joins a row only when it is judged as the study judged it (same method ids and windows):
 *  - S&P 50/200-day cell and 1-year-high state: indexSummary on the long history's ^GSPC closes (200 closes for
 *    the cell, 252 for the high state); Nasdaq: the exporter's indices[^IXIC].state, absent from older data.
 *  - distribution grade: the market-trends index series, only when its method id is the reference's.
 *  - follow-through state: only when its method id is the reference's and it was judged on the study's window
 *    (reference.methods.followThroughWindowSessions sessions: the series' points are its validated bars); FTD
 *    confirmed within ftdRecentSessions adds the combo.ftd_recent row.
 * Every item is { indicator, state, stateDate, pDd5, comparator, comparatorPDd5, tag, biasTag, edgeDistance } or
 * { reason } (with whatever of indicator / state / date is known), each with its line `text` and, for a valued
 * line, its `parts` ({ body, comparator, tags }) so a tag or a comparator never breaks across lines. `key` names
 * the outcome, 全期間 and every tag shown; `footer` says what the numbers are not.
 */
export function marketRegimeContext({ history, trends, reference, date = null }) {
  const status = trendsStatus(trends);
  const unavailable = reason => ({ available: false, reason, summary: '過去の傾向（予測ではありません）', key: null, footer: null, indices: [] });
  if (!validReference(reference)) return unavailable('検証結果の参照データを確認できないため表示しません。');
  const period = referencePeriod(reference), summary = `過去の傾向（${period.fromYear}〜${period.toYear}年・予測ではありません）`;
  if (status.state !== 'ready') return { ...unavailable(status.state === 'loading' ? '読み込み中…' : status.state === 'none' ? '市場推移データがないため表示しません。' : '市場推移データを確認できないため表示しません。'), summary };
  const indices = trends.data.indices || [], ftdWindow = reference.methods.followThroughWindowSessions;
  let lead = true;
  const md = value => shortDate(value, date);
  const item = (symbol, suffix, state, stateDate, extra = {}) => {
    const words = stateText(reference, suffix, state), base = { indicator: `${symbol}.${suffix}`, state, stateDate, label: words?.text ?? null };
    const row = referenceState(reference, base.indicator, state);
    const when = [words?.note, `${md(stateDate)}時点`, finite(extra.edgeDistance) ? `境界まで${num(extra.edgeDistance, 1)}%` : null].filter(Boolean).join('・');
    if (!row || !words) return { ...base, reason: '検証結果に該当する行がありません', text: `${words?.text || TOPICS[suffix]}（${when}）：検証結果に該当する行がありません` };
    const tag = stateTag(reference, suffix, symbol, state);
    if (row.labelDd5 === 'insufficient' || !finite(row.pDd5)) {
      const body = `${words.text}（${when}）：`;
      return { ...base, reason: '標本不足', tag: TAGS.insufficient, text: `${body}${TAGS.insufficient}`, parts: { body, comparator: null, tags: [TAGS.insufficient] } };
    }
    const comparator = comparatorText(reference, suffix, row), bias = biasTag(row);
    const parts = { body: `${words.text}（${when}）：${lead ? `${OUTCOME} ` : ''}${share(row.pDd5)}`, comparator: comparator && finite(row.comparatorPDd5) ? `（${comparator} ${share(row.comparatorPDd5)}）` : null, tags: [tag, bias].filter(Boolean) };
    lead = false;
    return { ...base, ...extra, pDd5: row.pDd5, comparator: row.comparator, comparatorLabel: comparator, comparatorPDd5: row.comparatorPDd5, tag, biasTag: bias,
      text: `${parts.body}${parts.comparator || ''}${parts.tags.join('')}`, parts };
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
    const sameWindow = Array.isArray(index?.points) && index.points.length === ftdWindow;
    items.push(ft === undefined ? reasonItem(symbol, 'ftd.state', '旧形式の公開データに未収録')
      : ft?.method !== reference.methods.followThrough ? reasonItem(symbol, 'ftd.state', ft?.method ? '判定方法が検証と異なるため表示しません' : '判定方法の記録がないため表示しません')
        : !bucket ? reasonItem(symbol, 'ftd.state', typeof ft?.reason === 'string' && ft.reason ? bare(ft.reason) : 'FTDを判定できないため表示しません')
          : !sameWindow ? reasonItem(symbol, 'ftd.state', `判定期間が検証（${num(ftdWindow)}営業日）と異なるため表示しません`, ft.asOf) : item(symbol, 'ftd.state', bucket, ft.asOf));
    if (bucket && sameWindow && ft.method === reference.methods.followThrough && ftdRecent(ft, reference)) items.push(item(symbol, 'combo.ftd_recent', 'recent', ft.asOf));
    return { symbol, name: INDEX_NAMES[symbol], items };
  });
  const sample = period.same ? `^GSPC・^IXIC日足 ${period.first}〜${period.last}` : ['^GSPC', '^IXIC'].map(symbol => `${symbol}日足 ${reference.samples[symbol].first}〜${reference.samples[symbol].last}`).join('・');
  // 「平均リターンが低かった状態はどちらの指数にもありません」 only while the reference says so (the labels' directions).
  const means = meanLowerStates(reference).length ? 'この欄は下げの割合だけを示します。' : 'この欄は下げの割合だけを示し、平均リターンが低かった状態はどちらの指数にもありません。';
  const footer = `状態ごとの過去の割合で、組み合わせた確率ではありません。これらは同じ事実（下げの最中・直後は値動きが荒い）を別の形で数えたもので、2指数は連動しているため独立の確認ではありません。${means}指数の結果で、個別銘柄の値ではありません。出典：${reference.study_version}${reference.source?.ci_run ? `（CI run ${reference.source.ci_run}）` : ''}、${sample}`;
  const key = regimeKey(blocks.flatMap(block => block.items.flatMap(entry => entry.parts?.tags || [])));
  return { available: true, summary, key, footer, indices: blocks };
}

// ---- what MarketScreen hands the 地合い card ------------------------------------------------------------------

/** The published inputs a check's study tag depends on: the index's method ids and its follow-through window. */
const publishedInputs = item => ({ distribution: item?.method ?? null, followThrough: item?.followThrough?.method ?? null, followThroughWindow: Array.isArray(item?.points) ? item.points.length : null });

/**
 * Everything of the study the market tab adds to the 地合い card, from the market-trends asset and the reference
 * (null or invalid: no tags, and 過去の傾向 says why it has no rows):
 *  - signalTags: each warning-summary check's study tags (marketRegimeReference SIGNAL_INDICATORS); tagText(fired)
 *    the legend and the sentence on the tags actually shown
 *  - distribution: the opened 分配日 row's method, dates and year lines
 *  - nasdaq: the Nasdaq note beside the SPY verdict (the card shows it only while the verdict is positive)
 *  - nasdaqPosition / nasdaqFigures: the Nasdaq's published position, as data and in words
 *  - regime: the 過去の傾向 block
 */
export function marketTabStudy({ trends, reference, date = null }) {
  const ref = validReference(reference) ? reference : null, ready = trendsStatus(trends).state === 'ready';
  const indices = ready ? trends.data.indices || [] : [], find = symbol => indices.find(item => item?.symbol === symbol);
  const byName = { 'S&P': find('^GSPC'), NAS: find('^IXIC') };
  const signalTagsByKey = Object.fromEntries(Object.keys(SIGNAL_INDICATORS).map(key => { const name = /-(S&P|NAS)$/.exec(key)?.[1]; return [key, signalTags(ref, key, name ? publishedInputs(byName[name]) : {})]; }));
  const nasdaqPosition = ready ? publishedIndexState(byName.NAS) : null;
  return {
    signalTags: signalTagsByKey, tagText: fired => signalTagText(ref, fired),
    distribution: ready ? distributionDetail(indices, date) : null,
    nasdaq: ready ? nasdaqNote(byName.NAS?.followThrough, date) : null,
    nasdaqPosition, nasdaqFigures: nasdaqFigures(nasdaqPosition?.state, date),
    regime: marketRegimeContext({ history: ready ? trends.data.long_history || null : null, trends, reference: ref, date }),
  };
}
