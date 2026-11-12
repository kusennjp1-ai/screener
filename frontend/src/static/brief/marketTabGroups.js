// The market tab's parts of the 地合い card: the warning summary (every existing rule, fired or not, and the ones that
// could not be judged), the three evidence groups and the S&P／Nasdaq switch. marketCardView (marketTabModel.js) computes
// the shared values and hands them here only when the lazily loaded market screen asks (its `tab` option), so this module
// ships in the market tab's chunk, never with Today. Nothing here adds a threshold, a status or a verdict.
import { BREAKOUT_MIN_SAMPLE, LEADER_MIN_COHORT } from '../marketLongHistory';
import { indexSummary } from '../reference/indexSummary.js';
import { distributionCount, shortDate, ENV_RULES } from './briefModel';
import { delta, DISTRIBUTION_WARN, groupDate, indexCloses, monthBefore, num, pointChange, rangePosition, RULE_TEXT, STAGE_FIELDS, STAGE_NAMES, YEAR, yearRange } from './marketTabModel';

const finite = Number.isFinite;

/** One index's follow-through state in a plain clause (the state is the exporter's; wording only). */
function ftdSignal(name, ft, date) {
  if (!ft || ft.available !== true || ft.state !== 'ftd_failed') return null;
  return `${name}のFTDが失敗${ft.failedDate ? `（${shortDate(ft.failedDate, date)}）` : ''}`;
}

/**
 * The market tab's `{ signals, groups, series }` from marketCardView's shared values (`ctx`, its own names): pass it as
 * marketCardView's `tab` option.
 */
export function marketTabParts({ ready, status, history, rows, last, hasField, rule, dist, follow, split, highsLows, lowsLead, extremesAsOf, judgedNow, study, isReference, date, absent, groupUnavailable, older, known, count, a200, a50, tt, leaderSubstitute, breakout, distWarn, spx, ndx, summary }) {
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
  // Each fired check carries the study's tags for its state (study.signalTags, from marketRegimeReference
  // SIGNAL_INDICATORS); an index check only when its published method and window are the study's. The order is the page's.
  // A fired check the study tags 〔参考〕 (a breadth rule it could not confirm) is counted apart from the warnings, with a
  // neutral ○: never a ▲, never in a group's or a tab's count. Its rule and its threshold are unchanged.
  const fired = checks.filter(c => c.fired).map(c => ({ ...c, itemAsOf: !boxDate && c.asOf && date && c.asOf < date ? shortDate(c.asOf, date) : null, tags: study?.signalTags?.[c.key] || [],
    reference: isReference(c.key) }));
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
  const ftdItem = { key: 'ftd', label: 'フォロースルーデー（独自判定）', className: 'brief-ftd', rows: followRows, rule: RULE_TEXT.ftd, warn: followRows.some(r => r.warn) };
  const distItem = !ready ? { key: 'dist', label: '分配日（25日）', className: 'brief-dist', rule: RULE_TEXT.dist, ...absent('') }
    : { key: 'dist', label: '分配日（25日）', className: 'brief-dist', rule: RULE_TEXT.dist, warn: distWarn, ...(study?.distribution || {}), rows: dist.map(d => d.hit
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
    return { id, title, question, short, items: unavailable ? [] : items.filter(item => !item.missing).map(asReference), fired: firedIn(id), references: referencesIn(id), unknown, asOf: unavailable ? null : groupDate(items), missing: unavailable || !history ? null : missingLine(items), unavailable };
  };
  const groups = [
    makeGroup('index', '指数のトレンド', '上昇トレンドは続いているか', '指数', [ftdItem, distItem], 'index'),
    makeGroup('breadth', '市場の参加度', '多くの銘柄が上昇に加わっているか', '参加度', [a200, a50, extremesItem, tt, leaderSubstitute].filter(Boolean), 'history'),
    makeGroup('leaders', 'リーダーの健全性', '先導株が崩れていないか', 'リーダー', [rs90, breakout, healthItem, stageItem], 'history'),
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
  return { signals, groups, series };
}
