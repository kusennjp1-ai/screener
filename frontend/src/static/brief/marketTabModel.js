// View model for the 地合い card (Today's four tiles and the market tab's verdict, warning summary and
// grouped evidence) and for the long-history section under it. Every value comes from the published
// market-trends asset, the scan's market fields (modelMarket) and the existing rule functions: nothing
// here adds a threshold, a status or a verdict. Each value keeps the session it describes.
import { bifurcation, environmentPoint, BREAKOUT_MIN_SAMPLE, LEADER_MIN_COHORT, SPLIT_RULE } from '../marketLongHistory';
import { indexSummary } from '../reference/indexSummary.js';
import { distributionCount, environmentRules, followThroughView, latestKnown, marketTone, shortDate, trendsStatus, ENV_RULES, FTD_TEXT } from './briefModel';

const finite = Number.isFinite;
/** Sessions in a year and in a month, as the long history counts them (marketTabHistory.js reads the same). */
export const YEAR = 252, MONTH = 21;
/** The existing distribution warning: 5 or more active distribution days on an index. */
export const DISTRIBUTION_WARN = 5;
/**
 * The breadth series are today's names traced back (the long history's current-universe retrospective): said
 * under the 参加度 and リーダー headers on the desktop, in the 注記 on a phone and in the long history's takeaway.
 */
export const SURVIVORSHIP_NOTE = '現在の銘柄で過去をさかのぼった集計（上場廃止銘柄を含まない）';
/**
 * The warning-summary checks whose rule the market-regime study could not confirm (〔参考〕: every breadth rule of the
 * committed reference, market-regime-reference-v1.json). They are counted apart from the warnings and marked with a
 * neutral ○, never a ▲. The market tab reads them from the reference itself (marketTabStudy's referenceKeys); Today,
 * which never loads the reference, reads this list, and a test keeps the two equal, so the screens mark one rule alike.
 */
export const REFERENCE_CHECKS = Object.freeze(['split', 'lows', 'template', 'stage', 'leaders', 'breakout']);
export const STAGE_FIELDS = ['stage1Percent', 'stage2Percent', 'stage3Percent', 'stage4Percent'];
export const STAGE_NAMES = ['底固め', '上昇', '天井圏', '下降'];

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
export const monthBefore = (rows, hit, field) => { const before = rows[hit.index - MONTH]; return finite(before?.[field]) ? before[field] : null; };

/** A simple moving average of `length` closes ending at each shown point of an index chart (null until there are enough). */
export const sma = (all, offset, count, length) => Array.from({ length: count }, (_, i) => { const at = offset + i; if (at < length - 1) return null; let s = 0; for (let j = at - length + 1; j <= at; j++) s += all[j].close; return s / length; });
/** The 地合い card's chart status (trendsStatus's state): a failed long history, a failed fetch, or the asset's own state. */
export const chartStatusOf = (view, status) => view.longError ? 'history-error' : status.state === 'error' && status.kind === 'fetch' ? 'fetch-error' : status.state;

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

/**
 * An index series of closes the market tab can chart (indices[i].closes, plan §2.3, validated by readMarketTrends):
 * at least the chart's 60 sessions, else null. Older publications have none: then there is no S&P／Nasdaq switch.
 */
export function indexCloses(item) {
  const closes = Array.isArray(item?.closes) ? item.closes.filter(point => finite(point?.close)) : [];
  return closes.length >= 60 ? closes : null;
}


// The behind sentence's second half: the phone's market tab keeps it in the screen's 注記.
const PER_ITEM_DATES = '日付が異なる項目には個別に日付を付けています。';

/**
 * The block's dating. Every source (the long history and each index series) is compared with the analysis
 * date: current → a 「M/D 引け」 stamp; behind → one sentence naming each older source (`lagNote`, the
 * desktop's line), the verdict's own date, and Today's one-line note (`blockAsOf`: the one older session
 * when every source shares it, so Today's tiles of that session need no date of their own). On a phone the market tab says the lag
 * in the heading's stamp slot instead (`lagStamp`: the older session when every source shares it, else that
 * some are behind) and moves the rest (`lagDetail`) to the screen's 注記.
 */
export function marketDating({ date, historyDate, indexDates }) {
  const md = value => shortDate(value, date);
  const sources = [historyDate, ...indexDates.map(d => d.date)].filter(Boolean);
  const behind = date ? sources.filter(value => value < date) : [];
  const olderIndex = indexDates.filter(d => date && d.date < date);
  if (!behind.length) return { current: sources.length > 0, stamp: sources.length && date ? `${md(date)} 引け` : null, lagNote: null, lagStamp: null, lagDetail: null, todayNote: null, blockAsOf: null, verdictDate: null };
  const single = new Set(sources).size === 1;
  const sameIndexDate = olderIndex.length === 2 && olderIndex[0].date === olderIndex[1].date;
  const indexPart = !olderIndex.length ? null : sameIndexDate ? `分配日・FTDは${md(olderIndex[0].date)}引け` : `分配日・FTDは${olderIndex.map(d => `${d.name} ${md(d.date)}`).join('・')}引け`;
  const parts = single ? [`市場データは${md(sources[0])}引け`] : [historyDate && historyDate < date ? `長期集計は${md(historyDate)}引け` : null, indexPart].filter(Boolean);
  const lagNote = `${parts.join('、')}時点（分析基準日${md(date)}の再集計待ち）。${PER_ITEM_DATES}`;
  // Today's note, one line on a phone: both indices on one older session read as one date.
  const todayParts = single ? [`市場の集計は${md(sources[0])}`] : [historyDate && historyDate < date ? `長期集計は${md(historyDate)}` : null,
    !olderIndex.length ? null : `分配日は${sameIndexDate ? md(olderIndex[0].date) : olderIndex.map(d => `${d.name} ${md(d.date)}`).join('・')}`].filter(Boolean);
  return { current: false, stamp: null, lagNote,
    lagStamp: single ? `${md(sources[0])}引け・${md(date)}分は再集計待ち` : `一部の集計は${md(date)}分の再集計待ち`,
    lagDetail: single ? PER_ITEM_DATES : lagNote,
    todayNote: `${todayParts.join('・')}時点（${md(date)}分は再集計待ち）`,
    // Every source on one older session: Today's note dates them all, so its tiles carry no date of their own.
    blockAsOf: single ? md(sources[0]) : null, verdictDate: `判定 ${md(date)}` };
}

/** The one session every valued item of a group describes, when they all agree on an older one. */
export function groupDate(items) {
  const valued = items.flatMap(item => item?.rows ? item.rows : [item]).filter(item => item?.valued);
  return valued.length && valued.every(item => item.asOf && item.asOf === valued[0].asOf) ? valued[0].asOf : null;
}

// ---- the card ---------------------------------------------------------------------------------

/**
 * Everything the 地合い card shows, for Today (`today`: exactly four facts) and the market tab (`groups`).
 * An unknown is never 0 and never a bare 未取得: it carries the precise reason (loading, a failed fetch,
 * an integrity failure, a schema that never recorded the field, a sample too small for a rate).
 * `study` is the market tab's study parts (reference/marketTabStudy.js, computed by the lazily loaded MarketScreen):
 * the warning summary's study tags and their words, the 〔参考〕 checks counted apart, the opened 分配日 row's detail, the
 * Nasdaq note and position, the judge side's cause under the basis and whom TT達成数 counts. Without it (Today) none of
 * these is shown. `series` is the 指数 panel's S&P／Nasdaq switch, only from a publication with the Nasdaq's closes.
 */
export function marketCardView({ market, marketLoading = false, trends, date, study = null, tab = null }) {
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
  // The checks counted as 参考 (a neutral ○): the market tab's from the study reference, Today's from REFERENCE_CHECKS.
  const referenceKeys = study ? study.referenceKeys || [] : REFERENCE_CHECKS, isReference = key => referenceKeys.includes(key);

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
  // The count's population, in the 200-day row's form (「観測100中61銘柄」): the long history's observed names that day.
  const ttHit = known('trendTemplateCount'), ttBase = ttHit && finite(ttHit.row.coverage) ? ttHit.row.coverage : null;
  if (tt.valued && ttBase !== null) Object.assign(tt, { note: `観測${num(ttBase)}中${num(ttHit.value)}`, detail: [`観測${num(ttBase)}中${num(ttHit.value)}銘柄`, tt.detail].filter(Boolean).join('・') });
  const leaderSubstitute = tt.missing && leaderHit ? count('leaderCount', '先導株数（価格条件）', 'leaderCount', 'leaderCount', RULE_TEXT.leaderCount) : null;

  const a200 = share('a200', '200日線より上', 'above200Percent', 'above200', 'movingAverages', RULE_TEXT.above200);
  if (split?.warning) Object.assign(a200, { warn: true, flag: `指数が1年高値から${SPLIT_RULE.nearHighPercent}%以内で${SPLIT_RULE.above200Below}%未満` });
  const a50 = share('a50', '50日線より上', 'above50Percent', 'above50', 'movingAverages', RULE_TEXT.above50);

  const follow = [['S&P', spx], ['NAS', ndx]].map(([name, item]) => ({ name, item, view: status.state === 'loading' ? { b: '読み込み中…', em: '' } : status.state === 'error' ? failed : status.state === 'none' ? { b: '未配信', em: '市場推移データなし' } : followThroughView(item?.followThrough, date) }));

  // ---- dating and verdict ----
  const dating = marketDating({ date, historyDate, indexDates: dist.filter(d => d.hit).map(d => ({ name: d.name, date: d.hit.date })) });
  const tone = marketTone(market);
  const exposure = market?.cap > 0 ? Math.round(market.cap * 100) : market && market.state !== 'unknown' ? 0 : null;
  const verdict = {
    tone, pending, exposure, label: market?.label || (pending ? '判定を読み込み中…' : '市場未確認'),
    lead: market?.cap > 0 ? '新規の買いを検討できます。' : market?.state === 'unknown' ? '市場の状態を確認できません。新規の買いは見送ります。' : market ? '新規の買いは控えます（独自判定）。' : pending ? '市場の判定を読み込み中です。' : '市場の判定を読み込めません。新規の買いは見送ります。',
    text: market?.cap > 0 ? `新規の買いを検討できる地合い。エクスポージャーの目安は最大 ${Math.round(market.cap * 100)}%（独自判定）。` : market?.state === 'unknown' ? '市場の状態を確認できません。新規の買いは見送ります。' : market ? '新規の買いは控えます（独自判定）。' : pending ? '市場の判定を読み込み中です。' : '市場の判定を読み込めません。新規の買いは見送ります。',
    basis: verdictBasis(market, date), date: market && market.state !== 'unknown' ? dating.verdictDate : null,
    nasdaq: market?.cap > 0 ? study?.nasdaq ?? null : null,
  };
  // The judge side's cause (study.cause, from the published manifest): one line after the basis, on the market tab only.
  verdict.cause = study?.cause ?? null;
  const summary = ready ? indexSummary(history?.sp500) : null;
  const conflict = basisConflict(verdict.basis, summary, date);
  // The market tab's warning summary, its three groups and its index switch (`tab`: marketTabParts, marketTabGroups.js,
  // which only the lazily loaded market screen passes), so Today, which reads none of them, never ships them.
  const { signals = null, groups = null, series = null } = tab ? tab({ ready, status, history, rows, last, hasField, rule, dist, follow, split, highsLows, lowsLead, extremesAsOf, judgedNow, study, isReference, date, absent, groupUnavailable, older, known, count, a200, a50, tt, leaderSubstitute, breakout, distWarn, spx, ndx, summary }) : {};

  // ---- Today: exactly four facts ----
  const distPairs = dist.map(d => d.hit ? { name: d.name, value: `${num(d.hit.value)}日`, warn: d.hit.value >= DISTRIBUTION_WARN } : { name: d.name, value: '算出不可' });
  const heavy = dist.filter(d => d.hit && d.hit.value >= DISTRIBUTION_WARN).map(d => d.name);
  const todayDist = !ready ? { key: 'dist', label: '分配日（25日）', ...absent('') }
    : dist.every(d => !d.hit) ? { key: 'dist', label: '分配日（25日）', b: '算出不可', em: 'S&P・NAS' }
      : { key: 'dist', label: '分配日（25日）', valued: true, pairs: distPairs, asOf: distAsOf, warn: distWarn, em: distWarn ? `注意：${heavy.join('・')}が${DISTRIBUTION_WARN}日以上` : `${DISTRIBUTION_WARN}日以上で注意` };
  // A fired rule the study could not confirm reads 参考 on Today too, in the warning's place and length, never amber.
  const todayMark = (key, warn) => !warn ? { warn: false, word: null } : isReference(key) ? { warn: false, word: '参考' } : { warn: true, word: '注意' };
  const ttMark = todayMark('template', tt.warn), a200Mark = todayMark('split', a200.warn), lowsMark = todayMark('lows', lowsLead);
  const todayTT = leaderSubstitute ? { ...leaderSubstitute, em: 'TT達成数は旧形式で未収録' } : { ...tt, em: tt.valued ? (tt.change === null ? '8条件すべて達成' : `1か月で ${tt.change}`) : tt.em, warn: ttMark.warn, ...(ttMark.word ? { em: `${ttMark.word}：${tt.flag}` } : {}) };
  const a50Today = a50.valued ? { ...a50, em: '200日線は旧形式で未収録' } : null;
  const todayA200 = a200.missing && a50Today ? a50Today : { ...a200, warn: a200Mark.warn, em: a200.valued ? (a200Mark.word ? `${a200Mark.word}：指数と個別株の乖離` : a200.detail) : a200.em };
  const todayExtremes = highsLows ? { key: 'extremes', label: '52週の新高値・新安値', valued: true, asOf: extremesAsOf, warn: lowsMark.warn,
    pairs: [{ name: '高', value: num(highsLows.value.newHighs) }, { name: '安', value: num(highsLows.value.newLows), warn: lowsMark.warn }], em: lowsMark.word ? `${lowsMark.word}：新安値が新高値より多い` : `差 ${delta(highsLows.value.newHighs - highsLows.value.newLows)}` }
    : { key: 'extremes', label: '52週の新高値・新安値', ...absent('newHighs') };
  const today = [todayDist, todayTT, todayA200, todayExtremes];

  return { status, ready, history, longError, dating, verdict, signals, summary, conflict, groups, today, distReasons, series,
    // Whether the TT達成数 row shows a value (its population note belongs beside it only then), and why the Nasdaq's
    // published closes were withdrawn (readMarketTrends' closes_error: the switch is then missing for that reason).
    ttShown: tt.valued === true, nasdaqClosesError: ready && typeof ndx?.closes_error === 'string' && ndx.closes_error ? ndx.closes_error : null,
    nasdaqFigures: ready && study?.nasdaqPosition?.state ? study.nasdaqFigures : null,
    // Today's deterioration notes and its split alert: a rule the study could not confirm is marked 参考 (○), never ▲.
    warnings: rules.filter(r => r.fired).map(({ key, text }) => ({ key, text, reference: isReference(key) })), split: split ? { ...split, reference: isReference('split') } : split, chart: { sp500: history?.sp500, distribution: spx, distributionEnd: distributionCount(spx)?.date || null, followThrough: spx?.followThrough ?? null } };
}

// The long-history section's takeaway and the sector ranks (historyTakeaway, sectorRanks) are the market tab's only:
// they live in marketTabHistory.js, which only the lazily loaded market screen imports, so Today does not ship them.
