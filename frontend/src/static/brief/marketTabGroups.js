// The market tab's parts of the 地合い card: the warning summary (every existing rule, fired or not, and the ones that
// could not be judged), the three evidence groups and the S&P／Nasdaq switch. marketCardView (marketTabModel.js) computes
// the shared values and hands them here only when the lazily loaded market screen asks (its `tab` option), so this module
// ships in the market tab's chunk, never with Today. Nothing here adds a threshold, a status or a verdict.
import { BREAKOUT_MIN_SAMPLE, LEADER_MIN_COHORT } from '../marketLongHistory';
import { indexSummary } from '../reference/indexSummary.js';
import { distributionCount, shortDate, BREAKOUT_HOLD_NAME, ENV_RULES } from './briefModel';
import { delta, BREAKOUT_HOLD_LABEL, BREAKOUT_WINDOW_TEXT, DISTRIBUTION_TEXT, groupDate, indexCloses, num, RULE_TEXT, STAGE_FIELDS, YEAR } from './marketTabModel';
import { breakoutView } from './marketTabOnly';
import { leaderHealthView, stockSideTerms, STOCK_SIDE_HEAD } from './marketGateFacts';

const finite = Number.isFinite;

/** One index's follow-through state in a plain clause (the state is the exporter's; wording only). */
function ftdSignal(name, ft, date) {
  if (!ft || ft.available !== true || ft.state !== 'ftd_failed') return null;
  return `${name}のFTDが失敗${ft.failedDate ? `（${shortDate(ft.failedDate, date)}）` : ''}`;
}

/**
 * The stage bar's legend under the bar (M7; MT-05): stage 2 counts an advancing name only and stage 3 a flat or topping one, a
 * base being built included, so a trend-template name in a base reads 3 here. The short form keeps the legend at two lines at
 * 320px (measured: 「2 上昇（加速中のみ）」「3 横ばい・天井圏（ベース形成中を含む）」 take four). Only this legend reads it;
 * STAGE_NAMES (RULE_TEXT.stage) is unchanged, and so are the stages, the shares and the stage4 > stage2 sign.
 */
export const STAGE_LEGEND_NAMES = Object.freeze(['底固め', '上昇（加速中）', '横ばい・天井圏', '下降']);
/** The opened stage row (M7): the long history's stages are its own daily judgement, without the scanner's stage-2 base exception. */
export const STAGE_REPLAY_NOTE = 'スキャナーのステージ2ベース例外は再生していません（独自集計）';

// ---- the round 3 sub-lines of opened rows (M8a-M8c) ------------------------------------------------------------------
// Each is a plain line of its opened row (never a value, a flag, a ▲ or a 「?」 of the row or its section), read from the same
// long-history row as the row's own value, so the row's date covers it. A key the publication does not carry (every
// publication while the collector's EMIT_R3_MARKET_FIELDS is off) reads 未収録 with that reason, never 0 and never a rate.

/** Why a sub-line has no value: the publication does not carry its key (an older one, or one written with the key off). */
export const KEY_ABSENT = '未収録（この公開データには含まれていません）';
/** The early read's sessions after a breakout (the collector's BREAKOUT_EARLY_SESSIONS, 独自設定; a test reads it). */
export const BREAKOUT_EARLY_SESSIONS = 5;
/** The drawdown a breakout fails at, in % (the collector's BREAKOUT_FAILURE_DRAWDOWN 0.07; a test reads it). */
export const BREAKOUT_FAILURE_PERCENT = 7;
/** What the breakout row counts, said in its opened row (M8c): the long history's 52-week-high breakouts, not a base's pivot. */
export const BREAKOUT_NOT_PIVOT = '52週高値抜けで、ベースのピボットではありません';
/** The breakout row's window, said in its opened row while the label is the short name (M8c). */
const BREAKOUT_WINDOW_LINE = `確定分は${BREAKOUT_WINDOW_TEXT}の上抜けを、その後10営業日で判定`;
const RS90_HEAD = 'RS推計90以上', CLOSE_HIGHS_HEAD = 'うち終値でも更新', EARLY_HEAD = `早期（上抜け後${BREAKOUT_EARLY_SESSIONS}営業日・独自）`;

/**
 * Under リーダーの健全度 (M8a): the RS推計90 part of the cohort (rs90Cohort, the 20-session-earlier trend-template names with
 * RS推計 90 or more, as observed today) and its share above the 50-day line, 「RS推計90以上：n銘柄中 x%」; below
 * LEADER_MIN_COHORT the count only. No threshold sits between the two rates.
 */
export function rs90CohortLine(row) {
  if (!row || !('rs90Cohort' in row)) return `${RS90_HEAD}：${KEY_ABSENT}`;
  const n = row.rs90Cohort;
  if (!Number.isSafeInteger(n)) return `${RS90_HEAD}：未算出（観測不足の日を含む）`;
  if (n < LEADER_MIN_COHORT) return `${RS90_HEAD}：${num(n)}銘柄（${LEADER_MIN_COHORT}銘柄未満のため率は非表示）`;
  return finite(row.rs90HealthPercent) ? `${RS90_HEAD}：${num(n)}銘柄中 ${num(row.rs90HealthPercent)}%` : `${RS90_HEAD}：${num(n)}銘柄（50日線の上の数を確認できません）`;
}
/** Under 新高値・新安値 (M8b): the new highs whose close also cleared the prior high, 「うち終値でも更新 n」. */
export function closeHighsLine(row) {
  if (!row || !('newHighsClose' in row)) return `${CLOSE_HIGHS_HEAD}：${KEY_ABSENT}`;
  return Number.isSafeInteger(row.newHighsClose) ? `${CLOSE_HIGHS_HEAD} ${num(row.newHighsClose)}` : `${CLOSE_HIGHS_HEAD}：未算出（観測率90%未満）`;
}
/**
 * Under the breakout row (M8c): the breakouts of 5–9 sessions earlier read on their next BREAKOUT_EARLY_SESSIONS sessions,
 * 「早期（上抜け後5営業日・独自）：n件中 x% が −7%に到達」; below BREAKOUT_MIN_SAMPLE the count only. No good or bad word.
 */
export function earlyBreakoutLine(row) {
  if (!row || !('breakoutsEarlyJudged' in row)) return `${EARLY_HEAD}：${KEY_ABSENT}`;
  const n = row.breakoutsEarlyJudged;
  if (!Number.isSafeInteger(n)) return `${EARLY_HEAD}：未算出（判定期間に観測不足の日を含む）`;
  if (n < BREAKOUT_MIN_SAMPLE) return `${EARLY_HEAD}：${num(n)}件（${BREAKOUT_MIN_SAMPLE}件未満のため率は非表示）`;
  return finite(row.breakoutEarlyFailedPercent) ? `${EARLY_HEAD}：${num(n)}件中 ${num(row.breakoutEarlyFailedPercent)}% が −${BREAKOUT_FAILURE_PERCENT}%に到達` : `${EARLY_HEAD}：${num(n)}件（到達数を確認できません）`;
}

// The 銘柄側 line's head (M6) moved to marketGateFacts.js (plan D12), whose group of the gate it names too; re-exported here.
export { STOCK_SIDE_HEAD };

/**
 * The 銘柄側 line beside the verdict (M6; MT-01, MT-10): what the leaders do, in one line, from the rows the market tab already
 * shows and their own values, never a new figure, a rule or a sign:
 *  - TT達成 with its count 21 sessions before (the tt row's own one-month comparison, monthBefore on the same field);
 *  - the breakout row (its own label) with its rate and the breakouts it judged, or the count alone while it is too small
 *    for a rate (BREAKOUT_MIN_SAMPLE);
 *  - the leaders' health with its rate and its cohort, or the cohort alone while it is too small (LEADER_MIN_COHORT).
 * A term without a value says its row's own absent words (未収録・未算出・未配信 …), never 0. A long history older than the
 * analysis date dates the line once, in its head (「銘柄側（10/1時点・参考・目安は変えません）」, the warning summary's form); a term
 * of an older session than that keeps its row's own date (「75%（9/30時点・8件）」). No colour and no ▲, never counted as a sign,
 * never read by the guide. Null until the series is ready.
 */
function stockSideLine({ ready, rows, last, date, known, tt, breakout, health }) {
  if (!ready) return null;
  // The terms and the long history's own session when older than the analysis date (marketGateFacts.js, which the gate reads too).
  const { terms, shared } = stockSideTerms({ rows, last, date, known, tt, breakout, health });
  const text = terms.map(term => { const notes = [term.asOf && term.asOf !== shared ? `${term.asOf}時点` : null, term.extra].filter(Boolean);
    return `${term.name} ${term.value}${notes.length ? `（${notes.join('・')}）` : ''}`; }).join('・');
  return `${shared ? STOCK_SIDE_HEAD.replace('（', `（${shared}時点・`) : STOCK_SIDE_HEAD}：${text}`;
}

/**
 * The market tab's `{ signals, groups, series, stockSide }` from marketCardView's shared values (`ctx`, its own names): pass it
 * as marketCardView's `tab` option.
 */
export function marketTabParts({ ready, status, history, rows, last, hasField, rule, dist, follow, split, highsLows, lowsLead, extremesAsOf, study, isReference, date, absent, groupUnavailable, older, known, count, a200, a50, tt, leaderSubstitute, distWarn, spx, ndx, summary }) {
  // The breakout row and the newest session's judged count: the market tab's only (marketTabOnly.js), so Today never computes them.
  const { breakout, judgedNow } = breakoutView({ rows, last, known, rule, older, absent });
  // ---- warning summary: every existing rule, fired or not, and the ones that could not be judged ----
  const schemaReason = '旧形式の長期集計に未収録';
  const envReason = (key, fields) => !history ? null : !last ? '長期集計に観測日なし' : fields.some(field => !hasField(field)) ? schemaReason
    : key === 'leaders' && Number.isSafeInteger(last.leaderCohort) && last.leaderCohort < LEADER_MIN_COHORT ? `最新は対象${last.leaderCohort}銘柄（${LEADER_MIN_COHORT}銘柄未満）`
      : key === 'breakout' && judgedNow !== null && judgedNow < BREAKOUT_MIN_SAMPLE ? `最新は判定${judgedNow}件（${BREAKOUT_MIN_SAMPLE}件未満）`
        : key === 'template' && finite(last.trendTemplateCount) && !finite(rows.at(-1 - ENV_RULES.templateSessions)?.trendTemplateCount) ? `${ENV_RULES.templateSessions}営業日前の値なし`
          : key === 'template' && finite(last.trendTemplateCount) && rows.at(-1 - ENV_RULES.templateSessions).trendTemplateCount < ENV_RULES.templateMinBase ? `${ENV_RULES.templateSessions}営業日前が${ENV_RULES.templateMinBase}銘柄未満`
            : '最新の値なし';
  const checks = [];
  // `reference` marks a fired check counted as 参考 by its own value (a 5–6 distribution count), whatever its key.
  const check = (key, group, label, judged, firedText, asOf, reason, reference = false) => checks.push({ key, group, label, judged, fired: Boolean(judged && firedText), text: judged ? firedText || null : null, asOf: judged ? asOf : null, reason: judged ? null : reason, reference: Boolean(judged && firedText && reference) });
  if (ready) {
    // A distribution check fires at 5 or more with the same sentence; 5–6 is counted as 参考, 7 or more as a warning (M3).
    for (const d of dist) check(`dist-${d.name}`, 'index', `${d.name}の分配日`, Boolean(d.hit), d.grade ? `${d.name}の分配日が25日間で${num(d.hit.value)}日` : null, d.hit?.date, '指数データを確認できません', d.grade === 'reference');
    for (const f of follow) { const ft = f.item?.followThrough;
      check(`ftd-${f.name}`, 'index', `${f.name}のFTD`, ft?.available === true, ftdSignal(f.name, ft, date), ft?.asOf || distributionCount(f.item)?.date, ft === undefined ? '旧形式の公開データ' : '指数データを確認できません'); }
    if (history) {
      const splitReason = !hasField('above200Percent') ? schemaReason : (history.sp500 || []).filter(p => finite(p.close)).length < YEAR ? '指数の履歴が1年に満たない' : '最新の値なし';
      check('split', 'breadth', '指数と個別株の乖離', Boolean(split), split?.warning ? `指数は1年高値${split.fromHigh > -0.05 ? 'の水準' : `まで${Math.abs(split.fromHigh).toFixed(1)}%`}なのに、200日線より上の銘柄は${num(split.above200Percent, 1)}%（指数と個別株の乖離）` : null, split?.date, splitReason);
      check('lows', 'breadth', '新高値・新安値', Boolean(highsLows), lowsLead ? `新安値（${num(highsLows.value.newLows)}）が新高値（${num(highsLows.value.newHighs)}）を上回る` : null, highsLows?.date, envReason('lows', ['newHighs']));
      const env = [['template', 'breadth', 'TT達成数の急減', ['trendTemplateCount']], ['stage', 'leaders', 'ステージ構成', ['stage1']], ['leaders', 'leaders', 'リーダーの健全度', ['leaderCohort']], ['breakout', 'leaders', BREAKOUT_HOLD_NAME, ['breakoutsJudged']]];
      for (const [key, group, label, fields] of env) { const r = rule(key); check(key, group, label, r.judged, r.text, last?.date, envReason(key, fields)); }
    }
  }
  // Order the summary by group (index → breadth → leaders), as on the page.
  const order = ['index', 'breadth', 'leaders'];
  checks.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  const judgedDates = [...new Set(checks.filter(c => c.judged && c.asOf).map(c => c.asOf))];
  const boxDate = judgedDates.length === 1 && date && judgedDates[0] < date ? shortDate(judgedDates[0], date) : null;
  // Each fired check carries the study's tags for its state (study.signalTags, from marketRegimeReference
  // SIGNAL_INDICATORS); an index check only when its published method and window are the study's. The order is the page's.
  // A fired check the study tags 〔参考〕 (a breadth rule it could not confirm) is counted apart from the warnings, with a
  // neutral ○: never a ▲, never in a group's or a tab's count. Its rule and its threshold are unchanged.
  const fired = checks.filter(c => c.fired).map(c => ({ ...c, itemAsOf: !boxDate && c.asOf && date && c.asOf < date ? shortDate(c.asOf, date) : null, tags: study?.signalTags?.[c.key] || [],
    reference: c.reference || isReference(c.key) }));
  const unjudged = checks.filter(c => !c.judged);
  const reasons = [...new Set(unjudged.map(c => c.reason))].map(reason => ({ reason, labels: unjudged.filter(c => c.reason === reason).map(c => c.label) }));
  // The checks that were judged at all: with none, the summary can never say 「なし」. `warnable` counts the judged checks
  // that can raise a warning (not 参考): with none of them judged, the summary says the warnings could not be judged.
  const judged = checks.filter(c => c.judged).map(({ key, group, label }) => ({ key, group, label }));
  const tagText = study?.tagText ? study.tagText(fired) : { legend: null, note: null };
  const signals = ready ? { fired, warnings: fired.filter(c => !c.reference).length, references: fired.filter(c => c.reference).length, warnable: judged.filter(c => !isReference(c.key)).length,
    unjudged, reasons, judged, asOf: boxDate, historyMissing: !history, legend: tagText.legend, tagNote: tagText.note } : null;
  const firedIn = group => fired.filter(c => c.group === group && !c.reference).length;
  const referencesIn = group => fired.filter(c => c.group === group && c.reference).length;
  // The evidence row of each check, so a 〔参考〕 check's row reads ○ 参考 instead of ▲ 注意.
  const ROW_OF = { lows: 'extremes', split: 'a200', template: 'tt', stage: 'stage', leaders: 'health', breakout: 'breakout' };
  const referenceRows = new Set(fired.filter(c => c.reference && ROW_OF[c.key]).map(c => ROW_OF[c.key]));
  const asReference = item => !referenceRows.has(item.key) ? item : { ...item, warn: false, reference: true, ...(item.rows ? { rows: item.rows.map(row => row.warn ? { ...row, warn: false, reference: true } : row) } : {}) };


  // ---- market tab: three groups in decision order ----
  const followRows = follow.map(f => ({ name: f.name, ...f.view, valued: ready && f.view.b !== '未集計' && f.view.b !== '算出不可', warn: f.view.tone === 'ext', flag: f.view.tone === 'ext' ? 'FTD失敗' : null }));
  // The opened row's lines (study.followThrough: the rule beside the cited rises, the failure, 前回のFTD, 過去の傾向), market tab only.
  const ftdItem = { key: 'ftd', label: 'フォロースルーデー（独自判定）', className: 'brief-ftd', rows: followRows, rule: RULE_TEXT.ftd, warn: followRows.some(r => r.warn), ...(study?.followThrough || {}) };
  // The 分配日 row: ▲ 注意 at 7 or more; a 5–6 count is marked 参考 (○, neutral) on its side, and on the row while no side warns.
  const distRow = d => ({ name: d.name, valued: true, b: `${num(d.hit.value)}日`, asOf: date && d.hit.date < date ? shortDate(d.hit.date, date) : null, warn: d.grade === 'caution',
    flag: d.grade === 'caution' ? DISTRIBUTION_TEXT.caution : d.grade === 'reference' ? `${DISTRIBUTION_TEXT.reference}・参考` : null, ...(d.grade === 'reference' ? { reference: true } : {}) });
  const distItem = !ready ? { key: 'dist', label: '分配日（25日）', className: 'brief-dist', rule: RULE_TEXT.dist, ...absent('') }
    : { key: 'dist', label: '分配日（25日）', className: 'brief-dist', rule: RULE_TEXT.dist, warn: distWarn, ...(!distWarn && dist.some(d => d.grade === 'reference') ? { reference: true } : {}), ...(study?.distribution || {}), rows: dist.map(d => d.hit
      ? distRow(d)
      : { name: d.name, b: '算出不可', em: d.item?.reason || '指数データを確認できません。' }) };
  const extremesItem = highsLows ? { key: 'extremes', label: '52週の新高値・新安値', className: 'brief-dist', metric: 'highsLows', rule: RULE_TEXT.extremes, warn: lowsLead,
    note: `差 ${delta(highsLows.value.newHighs - highsLows.value.newLows)}`, rows: [
      { name: '新高値', valued: true, b: num(highsLows.value.newHighs), asOf: extremesAsOf },
      { name: '新安値', valued: true, b: num(highsLows.value.newLows), asOf: extremesAsOf, warn: lowsLead, flag: lowsLead ? '新高値より多い' : null }],
    // M8b: the same row's close-based new highs, the opened row's first line (the main value and its sign are unchanged).
    detail: closeHighsLine(highsLows.row) }
    : { key: 'extremes', label: '52週の新高値・新安値', metric: 'highsLows', rule: RULE_TEXT.extremes, ...absent('newHighs') };

  const rs90 = count('rs90', 'RS推計90以上のTT達成（独自）', 'rs90TemplateCount', 'trendTemplateCount', RULE_TEXT.rs90);
  const stageRule = rule('stage');
  // The leaders' health row (marketGateFacts.js), with the RS推計90 part of its cohort as the opened row's line (M8a).
  const { item: healthItem, cohort: healthCohort } = leaderHealthView({ rows, last, known, rule, older, absent }, row => [rs90CohortLine(row)]);
  // M8c: the breakout row's opened lines, from the row its value reads (the rate's own row, else the newest): the early read,
  // what it counts, and its window while the label is the short name. The row's value, rule and sign are unchanged.
  const rateHit = known('breakoutHoldPercent'), breakoutRow = rateHit ? rateHit.row : last;
  const breakoutItem = breakout.missing || !breakoutRow ? breakout : { ...breakout, details: [earlyBreakoutLine(breakoutRow), BREAKOUT_NOT_PIVOT, ...(BREAKOUT_HOLD_LABEL.includes(BREAKOUT_WINDOW_TEXT) ? [] : [BREAKOUT_WINDOW_LINE])] };
  const stageHit = known(STAGE_FIELDS);
  const stageItem = stageHit ? { key: 'stage', label: 'ステージ構成', className: 'is-stage', metric: 'stages', rule: RULE_TEXT.stage, valued: true, b: `ステージ2 ${num(stageHit.value.stage2Percent, 0)}%`, asOf: older(stageHit.date),
    warn: Boolean(stageRule?.fired), flag: stageRule?.fired ? 'ステージ4がステージ2より多い' : null, stages: STAGE_FIELDS.map((field, i) => ({ k: i + 1, name: STAGE_LEGEND_NAMES[i], share: stageHit.value[field] })), details: [STAGE_REPLAY_NOTE] }
    : { key: 'stage', label: 'ステージ構成', className: 'is-stage', metric: 'stages', rule: RULE_TEXT.stage, ...absent('stage1') };

  // Values a former long-history schema did not record are named once per group, not row by row.
  const missingLine = items => { const gone = items.filter(item => item.missing); return gone.length ? `旧形式の長期集計（${shortDate(history.as_of_date, date)}）には未収録：${gone.map(item => item.label).join('・')}` : null; };
  // `unknown`: the group shows a value as 未収録・算出不可・未算出 (or nothing at all), or one of its
  // checks could not be judged. A phone's section tab marks it, so a hidden section never reads as clean.
  const unvalued = item => (item.rows ? item.rows.some(row => !row.valued) : !item.valued);
  const makeGroup = (id, title, question, short, items, scope) => {
    const unavailable = groupUnavailable(scope);
    const unknown = status.state !== 'loading' && (Boolean(unavailable) || items.some(unvalued) || checks.some(c => c.group === id && !c.judged));
    return { id, title, question, short, items: unavailable ? [] : items.filter(item => !item.missing).map(asReference), fired: firedIn(id), references: referencesIn(id), unknown, asOf: unavailable ? null : groupDate(items), missing: unavailable || !history ? null : missingLine(items), unavailable };
  };
  const groups = [
    makeGroup('index', '指数のトレンド', '上昇トレンドは続いているか', '指数', [ftdItem, distItem], 'index'),
    makeGroup('breadth', '市場の参加度', '多くの銘柄が上昇に加わっているか', '参加度', [a200, a50, extremesItem, tt, leaderSubstitute].filter(Boolean), 'history'),
    makeGroup('leaders', 'リーダーの健全性', '先導株が崩れていないか', 'リーダー', [rs90, breakoutItem, healthItem, stageItem], 'history'),
  ];

  // The 指数 panel's S&P／Nasdaq switch (market tab): the Nasdaq only from a publication that carries its closes. Its
  // figures are the exporter's (study.nasdaqPosition: indexSummary on the same bars) only when they describe the line's
  // last bar (the same date and close), else indexSummary on those closes, so the figures and the chart never disagree;
  // its marks are its own index series'.
  const ndxCloses = ready ? indexCloses(ndx) : null;
  const ndxPosition = study?.nasdaqPosition?.state, ndxLast = ndxCloses?.at(-1);
  const series = ndxCloses ? [
    { key: 'spx', name: 'S&P 500', short: 'S&P', spoken: 'S&P 500', closes: history?.sp500, distribution: spx, distributionEnd: distributionCount(spx)?.date || null, followThrough: spx?.followThrough ?? null, summary },
    { key: 'ndx', name: 'Nasdaq総合', short: 'NAS', spoken: 'Nasdaq総合（NAS）', closes: ndxCloses, distribution: ndx, distributionEnd: distributionCount(ndx)?.date || null, followThrough: ndx?.followThrough ?? null,
      summary: ndxPosition && ndxPosition.date === ndxLast.date && ndxPosition.close === ndxLast.close ? ndxPosition : indexSummary(ndxCloses) }] : null;
  const stockSide = stockSideLine({ ready, rows, last, date, known, tt, breakout, health: { item: healthItem, cohort: healthCohort } });
  return { signals, groups, series, stockSide };
}
