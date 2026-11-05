// The briefModel.js barrel: the helpers every module shares and the fundamentals card's view model it
// re-exports, through the old import path. Frozen in round 1.
import { describe, expect, it } from 'vitest';
import { bookFinancialCurrent } from '../bookFinancialCurrent';
import { bookFinancialEvidence } from '../bookFinancialEvidence';
import { secPoint, secRecord, secUnavailable } from '../../test/fixtures/secRecord';
import { code33Explain, code33Parts, fundamentalTiles, fundamentalsSource, secStatus } from './briefModel';
import * as barrel from './briefModel';
import * as briefCandidate from './briefCandidate';
import * as positionSizing from './positionSizing';
import * as briefSell from './briefSell';
import * as briefChartModel from './briefChartModel';
import * as briefEnvironment from './briefEnvironment';
import * as briefShared from './briefShared';
import * as fundamentalsExplain from '../fundamentalsExplain.js';

describe('brief model', () => {
  it('lists the three Code 33 conditions and names a missing fiscal-Q4 EPS without estimating it', () => {
    const rows = [{ end: '2025-12-31', derived: false, epsYoY: 10 }, { end: '2026-03-31', derived: false, epsYoY: 12 }, { end: '2026-06-30', derived: false, epsYoY: 15 }, { end: '2026-09-30', derived: true, fiscalQ4: true, epsYoY: null, epsYoYReason: 'not_reported' }];
    const value = code33Parts({ valid: true, rows, epsAcceleration: 'unknown', salesAcceleration: 'pass', marginImprovement: 'fail' });
    expect(value.parts).toEqual([['EPS の加速', 'unknown'], ['売上の加速', 'pass'], ['純利益率の上昇', 'fail']]);
    expect(value.q4Eps).toBe(true);
    expect(code33Parts({ valid: true, rows: rows.map(row => ({ ...row, fiscalQ4: false })), epsAcceleration: 'unknown', salesAcceleration: 'pass', marginImprovement: 'pass' }).q4Eps).toBe(false);
    // A fiscal Q4 whose EPS is reported but whose base is a loss is not the Q4-EPS gap.
    expect(code33Parts({ valid: true, rows: rows.map(row => ({ ...row, epsYoYReason: row.fiscalQ4 ? 'nonpositive_base' : null })), epsAcceleration: 'unknown', salesAcceleration: 'pass', marginImprovement: 'pass' }).q4Eps).toBe(false);
    expect(code33Parts(null)).toBeNull();
    expect(code33Parts({ valid: false })).toBeNull();
  });
});

describe('market tab helpers', () => {
  it('finds the newest finite value with its own session and never a missing one', async () => {
    const { latestKnown } = await import('./briefModel');
    const rows = [{ date: '2026-09-29', a: 1, b: 2 }, { date: '2026-09-30', a: 3, b: null }, { date: '2026-10-01', a: null, b: null }];
    expect(latestKnown(rows, 'a')).toMatchObject({ value: 3, date: '2026-09-30', index: 1 });
    expect(latestKnown(rows, ['a', 'b'])).toMatchObject({ value: { a: 1, b: 2 }, date: '2026-09-29', index: 0 });
    expect(latestKnown(rows, 'missing')).toBeNull();
    expect(latestKnown(null, 'a')).toBeNull();
    expect(latestKnown([{ date: '2026-10-01', a: NaN }], 'a')).toBeNull();
  });

  it('writes short dates with the year only when it differs', async () => {
    const { shortDate } = await import('./briefModel');
    expect(shortDate('2026-10-01', '2026-10-02')).toBe('10/1');
    expect(shortDate('2025-12-31', '2026-01-02')).toBe('2025/12/31');
    expect(shortDate(null, '2026-10-02')).toBe('日付未確認');
  });
});

describe('fundamentals card model', () => {
  const date = '2026-02-01', now = Date.parse('2026-02-01T12:00:00Z');
  const row = book_financials => ({ symbol: 'TEST', market: 'US', as_of_date: date, book_financials });
  const status = (record, at = now, asOf = date) => { const value = row(record); return secStatus(value, record ? bookFinancialCurrent(record, 'TEST', asOf, at, value) : null); };
  const tenQFiler = () => {
    const record = secRecord();
    record.quarterly.eps = record.quarterly.eps.filter(p => !p.end.endsWith('12-31'));
    record.annualEps = [secPoint('eps', ['2024-01-01', '2024-12-31'], 4), secPoint('eps', ['2025-01-01', '2025-12-31'], 5.5)];
    return record;
  };
  const report = record => bookFinancialEvidence(record, 'TEST', date);

  it('says why the SEC quarterly evidence is or is not usable', () => {
    expect(status(secRecord())).toMatchObject({ state: 'ok', latestEnd: '2025-12-31' });
    expect(status(null)).toMatchObject({ state: 'not_published', short: 'SEC 未配信' });
    expect(status(null).long).toMatch(/配信されていません/);
    for (const [reason, short] of [['no_cik', 'SEC 対象外'], ['no_companyfacts', 'SEC データなし'], ['transient', 'SEC 取得失敗'], ['invalid_payload', 'SEC 検証不可']]) expect(status(secUnavailable({ reason }))).toMatchObject({ short });
    expect(status(secUnavailable({ reason: 'no_quarterly', forms: ['20-F', '6-K'] }))).toMatchObject({ state: 'no_quarterly', short: '四半期報告なし', long: '四半期報告（10-Q）を提出しない企業です（20-F・6-K）。SEC の四半期データはありません。' });
    const later = '2026-09-01', stale = secRecord({ asOfDate: later });
    expect(status(stale, Date.parse('2026-09-01T12:00:00Z'), later)).toMatchObject({ state: 'stale', short: '古い', latestEnd: '2025-12-31', long: '直近の四半期は 2025-12期で、180日を超えているため判定に使いません。' });
    const broken = secRecord(); broken.quarterly.eps = [{ end: 'x' }]; broken.quarterly.revenue = [];
    expect(status(broken).state).toBe('invalid');
    // Dates and periods are fine; the company simply reported no quarterly EPS or revenue.
    const annualOnly = secRecord(); annualOnly.status = 'partial'; annualOnly.quarterly.eps = []; annualOnly.quarterly.revenue = [];
    annualOnly.annualEps = [secPoint('eps', ['2025-01-01', '2025-12-31'], 5.5)];
    expect(status(annualOnly)).toMatchObject({ state: 'no_quarterly_values', short: '四半期の EPS・売上なし', long: 'SEC の XBRL に四半期の EPS・売上の報告がありません（年次の値や純利益だけの報告）。' });
    const otherDay = { ...annualOnly, as_of_date: '2026-01-30' };
    expect(status(otherDay).state).toBe('invalid');
    expect(secStatus({ symbol: 'BITU', market: 'US', company_name: 'ProShares Ultra Bitcoin ETF' }, null)).toMatchObject({ state: 'not_applicable', short: '対象外' });
  });

  it('never calls a record that is still in an unloaded or failed detail 未配信', () => {
    expect(secStatus(row(null), null, { detail: 'loading' })).toMatchObject({ state: 'detail_loading', short: '読み込み中…', long: '詳細データを読み込み中…' });
    expect(secStatus(row(null), null, { detail: 'error' })).toMatchObject({ state: 'detail_error', short: '取得できません', long: '詳細データを取得できません。' });
    expect(secStatus(row(null), null, { detail: 'loaded' }).state).toBe('not_published');
    expect(secStatus(row(null), null, { detail: 'none' }).state).toBe('not_published');
    // A record that has arrived is judged on its own, whatever the detail state says.
    const record = secRecord(), value = row(record);
    expect(secStatus(value, bookFinancialCurrent(record, 'TEST', date, now, value), { detail: 'loaded' }).state).toBe('ok');
    expect(code33Explain(null, secStatus(row(null), null, { detail: 'loading' }))).toMatchObject({ state: 'unknown', title: 'Code 33 読み込み中', text: '詳細データを読み込み中です。読み込み後に判定します。' });
    expect(code33Explain(null, secStatus(row(null), null, { detail: 'error' })).text).toBe('詳細データを取得できません。 Code 33 は判定していません。');
  });

  it('shows the newest quarter that has a value and why a newer one has none', () => {
    const [eps, sales, margin] = fundamentalTiles(report(tenQFiler()));
    expect(eps).toMatchObject({ label: 'EPS 前年比', value: '+40%', note: '2025-09期・最新 2025-12期はQ4のEPSは年次報告のみ' });
    expect(sales).toMatchObject({ value: '+100%', note: '2025-12期・前期 +60%' });
    expect(margin).toMatchObject({ value: '13.0%', note: '2025-12期' });
    const loss = secRecord(); loss.quarterly.eps.forEach((p, i) => { p.value = i < 4 ? -0.1 : 0.3; });
    expect(fundamentalTiles(report(loss))[0]).toMatchObject({ value: null, short: '比較不可', note: '2025-12期・前年同期が赤字・ゼロ（EPS 0.30）' });
    const young = secRecord({ quarters: [['2025-01-01', '2025-03-31'], ['2025-04-01', '2025-06-30'], ['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31']] });
    expect(fundamentalTiles(report(young)).map(t => [t.value, t.short])).toEqual([[null, '前年同期なし'], [null, '前年同期なし'], ['10.0%', null]]);
    expect(fundamentalsSource(report(tenQFiler()))).toBe('出典：SEC XBRL（10-K 2026-01-30 提出）・2025-12期まで');
  });

  it('explains every Code 33 outcome without turning a gap into a pass', () => {
    const explain = (record, sec = { state: 'ok' }) => code33Explain(report(record), sec);
    expect(explain(secRecord())).toMatchObject({ state: 'pass', title: 'Code 33 達成', text: '直近4四半期で EPS 成長・売上成長の加速と純利益率の上昇が3回続いています（SEC XBRL）。' });
    const allKnownFail = secRecord(); [12, 11, 10, 9, 12, 11, 10, 9].forEach((m, i) => { allKnownFail.quarterly.netIncome[i].value = allKnownFail.quarterly.revenue[i].value * m / 100; });
    expect(explain(allKnownFail)).toMatchObject({ state: 'fail', title: 'Code 33 未達', text: '純利益率の上昇が未達です（SEC XBRL）。' });
    const failWithUnknown = tenQFiler(); [12, 11, 10, 9, 12, 11, 10, 9].forEach((m, i) => { failWithUnknown.quarterly.netIncome[i].value = failWithUnknown.quarterly.revenue[i].value * m / 100; });
    expect(explain(failWithUnknown)).toMatchObject({ state: 'fail', text: '純利益率の上昇が未達のため未達です（EPS の加速は未確認）。' });
    expect(explain(tenQFiler())).toMatchObject({ state: 'unknown', kind: 'q4_eps', title: 'Code 33 未確認',
      text: '売上の加速と純利益率の上昇は達成。EPS の加速は第4四半期の EPS が年次報告（10-K）にしか無いため未確認です（年間値から差し引く推計はしません）。' });
    const young = secRecord({ quarters: [['2025-04-01', '2025-06-30'], ['2025-07-01', '2025-09-30'], ['2025-10-01', '2025-12-31']] });
    expect(explain(young)).toMatchObject({ kind: 'few_quarters', text: '四半期データが 3 期分のため判定できません（直近4期とその前年同期の計8期が必要）。' });
    const gap = secRecord(); for (const key of ['eps', 'revenue', 'netIncome']) gap.quarterly[key].splice(6, 1);
    gap.quarterly.eps.unshift(secPoint('eps', ['2023-10-01', '2023-12-31'], 1)); gap.quarterly.revenue.unshift(secPoint('revenue', ['2023-10-01', '2023-12-31'], 100)); gap.quarterly.netIncome.unshift(secPoint('netIncome', ['2023-10-01', '2023-12-31'], 10));
    expect(explain(gap)).toMatchObject({ kind: 'gap', text: '四半期データに欠けがあるため判定できません。' });
    const loss = secRecord(); loss.quarterly.eps[3].value = -0.1;
    expect(explain(loss)).toMatchObject({ kind: 'other', text: '売上の加速と純利益率の上昇は達成。EPS の加速は未確認です（2025-12期は前年同期が赤字・ゼロ（EPS 1.80））。' });
    expect(code33Explain(null, { state: 'stale', latestEnd: '2025-12-31' })).toMatchObject({ kind: 'stale', text: '直近の四半期（2025-12期）から180日を超えているため判定しません。' });
    expect(code33Explain(null, { state: 'no_cik', long: 'SEC の銘柄コード表に該当がありません（ETF・外国企業・上場直後など）。' })).toMatchObject({ kind: 'no_sec', text: 'SEC の銘柄コード表に該当がありません（ETF・外国企業・上場直後など）。 Code 33 は判定していません。' });
    expect(code33Explain(null, null).text).toMatch(/配信されていません.*Code 33 は判定していません。$/);
    expect(code33Explain(null, { state: 'ok' }, { state: 'pass', source: 'yahoo', label: '参考：Yahoo四半期値' })).toMatchObject({ kind: 'yahoo', title: 'Code 33 達成', text: '参考：Yahoo四半期値。SEC提出書類で判定できないため、提供元の四半期値で同じ規則を当てはめた参考判定です。' });
  });
});

// The barrel `export *`s five track modules that all grow in round 1: a name two of them export drops
// out of the barrel (Rollup only warns; native ESM in the dev server throws on the named import).
describe('the briefModel barrel', () => {
  const modules = { briefCandidate, positionSizing, briefSell, briefChartModel, briefEnvironment, fundamentalsExplain };
  // Every name the barrel carried at eca9854, before the split.
  const BEFORE_SPLIT = ['BREAKOUT_VOLUME_RATIO', 'ENV_RULES', 'FTD_TEXT', 'LIST_FILTERS', 'LIST_SORTS', 'SELL_RULES', 'STOP_DEFAULT_PERCENT', 'STOP_MAX_PERCENT',
    'bare', 'bookWarningCheck', 'briefOrder', 'candidateView', 'code33Explain', 'code33Parts', 'distributionCount', 'earningsDays', 'environmentRules',
    'environmentWarnings', 'focusCandidates', 'focusCounts', 'followThroughView', 'footprint', 'fundamentalTiles', 'fundamentalsSource', 'latestKnown',
    'leadingGroups', 'marketTone', 'matchesSearch', 'positionPlan', 'quarterReason', 'rsLineNewHigh', 'ruleEvidence', 'secStatus', 'sellMarks', 'sellSignals',
    'sentence', 'shortDate', 'stageFromBars', 'trendTemplate', 'trendsAlert', 'trendsFailure', 'trendsStatus', 'upDownVolume', 'watchEvent', 'withBookWarning'];
  // The step-0 seams the barrel adds.
  const SEAMS = ['RS_LEAD_FROM_HIGH_PERCENT', 'code33ChipView', 'focusHeadingNote', 'focusTone', 'planLevels', 'publishedFundamentalsCoverage', 'sellChipView', 'stockSells'];

  it('re-exports every export of each module, the same binding, so no two modules share a name', () => {
    const owner = {}, shared = [], missing = [];
    for (const [name, module] of Object.entries(modules)) {
      for (const key of Object.keys(module)) {
        if (owner[key]) shared.push(`${key}: ${owner[key]} and ${name}`);
        owner[key] = name;
        if (!Object.hasOwn(barrel, key) || barrel[key] !== module[key]) missing.push(`${name}.${key}`);
      }
    }
    for (const key of ['shortDate', 'latestKnown', 'sentence', 'bare']) {
      if (owner[key]) shared.push(`${key}: briefShared and ${owner[key]}`);
      if (barrel[key] !== briefShared[key]) missing.push(`briefShared.${key}`);
    }
    expect(shared).toEqual([]);
    expect(missing).toEqual([]);
    expect(Object.keys(owner).length).toBeGreaterThan(40);
  });

  it('still carries the 45 names it had before the split and the 8 step-0 seams', () => {
    expect(BEFORE_SPLIT).toHaveLength(45);
    expect(SEAMS).toHaveLength(8);
    const names = Object.keys(barrel);
    expect([...BEFORE_SPLIT, ...SEAMS].filter(key => !names.includes(key))).toEqual([]);
  });
});
