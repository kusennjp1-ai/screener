import { describe, expect, it } from 'vitest';
import { attempt, breadth, closes, confirmed, days, failed, index, oldSchema, trends, UP } from '../../test/fixtures/marketTrends';
import { basisConflict, delta, groupDate, historyTakeaway, indexSummary, marketCardView, marketDating, pointChange, rangePosition, RULE_TEXT, sectorRanks, signedPercent, verdictBasis, yearRange } from './marketTabModel';
import { marketRegimeContext, marketTabStudy, nasdaqNote, publishedIndexState, regimeKey, signalTagText, TAG_MEANINGS } from '../reference/marketTabStudy.js';
import reference from '../reference/market-regime-reference-v1.json' with { type: 'json' };
import exchange from '../__fixtures__/nyse-sessions-2024-2026.json' with { type: 'json' };
import { referenceState, BIAS_SHARE, TAGS } from '../reference/marketRegimeReference.js';

const view = (value, { date = '2026-10-02', market = UP, marketLoading = false } = {}) => marketCardView({ market, marketLoading, trends: value, date });
const group = (model, id) => model.groups.find(g => g.id === id);
const item = (model, key) => model.groups.flatMap(g => g.items).find(i => i.key === key);
// Every visible string of the model, to check that no unknown leaks out as 0, NaN or a bare 未取得.
const strings = value => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings)
  : value && typeof value === 'object' ? Object.entries(value).filter(([key]) => !['range', 'format', 'item', 'row', 'hit'].includes(key)).flatMap(([, v]) => strings(v)) : [];
const BARE = /未取得|未確認|NaN|undefined|null|Infinity/;
const SYMBOLS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];

describe('market tab view model: a complete, current publication', () => {
  // Row 8 is 21 sessions before the newest (row 29): the one-month comparison.
  const model = view(trends({ rows: breadth('2026-10-02', i => (i === 8 ? { trendTemplateCount: 25, rs90TemplateCount: 10, above200: 80, above200Percent: 40 } : {})) }));

  it('groups the evidence in decision order with every value for the analysis date', () => {
    expect(model.groups.map(g => [g.id, g.title, g.items.map(i => i.key)])).toEqual([
      ['index', '指数のトレンド', ['ftd', 'dist']],
      ['breadth', '市場の参加度', ['a200', 'a50', 'extremes', 'tt']],
      ['leaders', 'リーダーの健全性', ['rs90', 'breakout', 'health', 'stage']]]);
    for (const g of model.groups) expect([g.asOf, g.missing, g.unavailable, g.fired]).toEqual([null, null, null, 0]);
    expect(item(model, 'tt')).toMatchObject({ b: '30銘柄', change: '+5', detail: '1か月前 25銘柄', asOf: null, rule: RULE_TEXT.template, metric: 'trendTemplateCount' });
    expect(item(model, 'a200')).toMatchObject({ b: '45.0%', change: '+5.0pt', detail: '観測200中90銘柄・1か月前 40.0%', metric: 'movingAverages' });
    expect(item(model, 'rs90')).toMatchObject({ b: '8銘柄', change: '−2' });
    expect(item(model, 'breakout')).toMatchObject({ b: '75%', note: '8件で判定', detail: '10〜29営業日前の上抜け8件のうち6件が10日間で−7%に届かず', warn: false });
    expect(item(model, 'health')).toMatchObject({ b: '70%', note: '20営業日前のTT達成30銘柄が対象', detail: '30銘柄のうち21銘柄が50日線の上' });
    expect(item(model, 'stage')).toMatchObject({ b: 'ステージ2 35%', stages: [{ k: 1, name: '底固め', share: 25 }, { k: 2, name: '上昇', share: 35 }, { k: 3, name: '天井圏', share: 20 }, { k: 4, name: '下降', share: 20 }] });
    expect(item(model, 'extremes').rows.map(r => [r.name, r.b, r.warn || false])).toEqual([['新高値', '40', false], ['新安値', '12', false]]);
    expect(item(model, 'dist').rows.map(r => [r.name, r.b, r.asOf])).toEqual([['S&P', '3日', null], ['NAS', '4日', null]]);
    expect(item(model, 'ftd').rows.map(r => [r.name, r.b])).toEqual([['S&P', '確認 8/7'], ['NAS', '反発3日目']]);
    expect(strings(model.groups).join(' ')).not.toMatch(BARE);
  });

  it('dates the block once, leads with the verdict and its basis, and counts no warning', () => {
    expect(model.dating).toEqual({ current: true, stamp: '10/2 引け', lagNote: null, lagStamp: null, lagDetail: null, todayNote: null, blockAsOf: null, verdictDate: null });
    expect(model.verdict).toMatchObject({ tone: 'zone', exposure: 50, label: '上昇トレンド（独自判定）', lead: '新規の買いを検討できます。', date: null,
      basis: { text: '根拠（10/2スキャン時点）：S&P 500（SPY）が50日線・200日線の上で、局面判定（分配日・FTDなど）が「上昇トレンド」', above50: true, above200: true } });
    expect(model.signals.fired).toEqual([]);
    // Without a year of index closes the split rule cannot be judged, and says why.
    expect(model.signals.unjudged.map(c => [c.key, c.reason])).toEqual([['split', '指数の履歴が1年に満たない']]);
    expect(model.signals.asOf).toBeNull();
  });

  it('keeps Today at its four tiles, each side of a pair named', () => {
    expect(model.today.map(f => f.label)).toEqual(['分配日（25日）', 'TT達成数', '200日線より上', '52週の新高値・新安値']);
    expect(model.today[0]).toMatchObject({ pairs: [{ name: 'S&P', value: '3日', warn: false }, { name: 'NAS', value: '4日', warn: false }], em: '5日以上で注意', warn: false });
    expect(model.today[1]).toMatchObject({ b: '30銘柄', em: '1か月で +5' });
    expect(model.today[3].pairs).toEqual([{ name: '高', value: '40' }, { name: '安', value: '12', warn: false }]);
  });
});

describe('market tab view model: fired warnings', () => {
  const rows = breadth('2026-10-02', (i, n) => (i === n - 1 ? { trendTemplateCount: 20, newHighs: 10, newLows: 30, stage1: 60, stage2: 40, stage3: 20, stage4: 80, breakoutsJudged: 10, breakoutsHeld: 3, leaderCohortAbove50: 9 } : {}), 260);
  const value = trends({ rows, sp500: closes('2026-10-02') });
  value.data.indices[0] = index('^GSPC', '2026-10-02', 6, '2026-10-02', confirmed('2026-10-02'));
  const model = view(value);

  it('lists every existing rule that fired, in page order, in plain sentences', () => {
    expect(model.signals.fired.map(s => [s.key, s.text])).toEqual([
      ['dist-S&P', 'S&Pの分配日が25日間で6日'],
      ['split', '指数は1年高値の水準なのに、200日線より上の銘柄は45.0%（指数と個別株の乖離）'],
      ['lows', '新安値（30）が新高値（10）を上回る'],
      ['template', 'トレンドテンプレート達成数が10営業日で33%減少'],
      ['stage', 'ステージ4（40%）がステージ2（20%）を上回る'],
      ['leaders', '20営業日前のTT達成銘柄のうち、50日線より上は30%'],
      ['breakout', 'ブレイクアウトの成功率が30%に低下']]);
    expect(model.signals.unjudged).toEqual([]);
    expect(model.groups.map(g => g.fired)).toEqual([1, 3, 3]);
  });

  it('flags each fired value with the rule it crossed, built from the same constants', () => {
    expect(item(model, 'dist').rows[0]).toMatchObject({ warn: true, flag: '5日以上' });
    expect(item(model, 'dist').rows[1].warn).toBe(false);
    expect(item(model, 'a200')).toMatchObject({ warn: true, flag: '指数が1年高値から5%以内で50%未満' });
    expect(item(model, 'extremes').rows[1]).toMatchObject({ warn: true, flag: '新高値より多い' });
    expect(item(model, 'tt')).toMatchObject({ warn: true, flag: '10日で20%以上減少' });
    expect(item(model, 'breakout')).toMatchObject({ warn: true, flag: '40%未満' });
    expect(item(model, 'health')).toMatchObject({ warn: true, flag: '50%未満' });
    expect(item(model, 'stage')).toMatchObject({ warn: true, flag: 'ステージ4がステージ2より多い' });
    expect(item(model, 'a50').warn).toBeUndefined();
    expect(model.today.map(f => f.em)).toEqual(['注意：S&Pが5日以上', '注意：10日で20%以上減少', '注意：指数と個別株の乖離', '注意：新安値が新高値より多い']);
  });

  it('places a value in its one-year range by position only, and summarises the index from its closes', () => {
    // The TT count fell to 20 on the newest session: the lowest of its year.
    expect(item(model, 'tt')).toMatchObject({ position: '1年で最低', range: { lo: 20, hi: 30 } });
    expect(item(model, 'a50').range).toBeNull();
    expect(model.summary).toMatchObject({ date: '2026-10-02', close: 5518, fromHigh: 0, fullYear: true });
    expect(signedPercent(model.summary.fromHigh)).toBe('±0.0%');
    expect(model.conflict).toBeNull();
  });
});

describe('market tab view model: an older long-history schema', () => {
  const model = view(trends({ rows: oldSchema(breadth('2026-10-02')) }));

  it('names what the old schema never recorded once per group and shows the price-only leader count', () => {
    expect(group(model, 'breadth').items.map(i => i.key)).toEqual(['a50', 'extremes', 'leaderCount']);
    expect(group(model, 'breadth').missing).toBe('旧形式の長期集計（10/2）には未収録：200日線より上・TT達成数');
    expect(group(model, 'leaders').items).toEqual([]);
    expect(group(model, 'leaders').missing).toBe('旧形式の長期集計（10/2）には未収録：RS推計90以上のTT達成（独自）・ブレイクアウト成功率・リーダーの健全度・ステージ構成');
    expect(item(model, 'leaderCount')).toMatchObject({ label: '先導株数（価格条件）', b: '20銘柄', rule: RULE_TEXT.leaderCount });
  });

  it('says which rules it could not judge and why, never reading their absence as all clear', () => {
    expect(model.signals.fired).toEqual([]);
    expect(model.signals.reasons).toEqual([{ reason: '旧形式の長期集計に未収録', labels: ['指数と個別株の乖離', 'TT達成数の急減', 'ステージ構成', 'リーダーの健全度', 'ブレイクアウト成功率'] }]);
  });

  it('keeps four tiles on Today, each named by what it shows', () => {
    expect(model.today.map(f => [f.label, f.b || f.pairs.map(p => p.value).join('・'), f.em])).toEqual([
      ['分配日（25日）', '3日・4日', '5日以上で注意'],
      ['先導株数（価格条件）', '20銘柄', 'TT達成数は旧形式で未収録'],
      ['50日線より上', '43.0%', '200日線は旧形式で未収録'],
      ['52週の新高値・新安値', '40・12', '差 +28']]);
    expect(strings(model.today).join(' ')).not.toMatch(BARE);
  });
});

describe('market tab view model: older observations', () => {
  it('dates the whole block once when every source describes the same older session', () => {
    const model = view(trends({ asOf: '2026-10-01', date: '2026-10-02' }));
    expect(model.dating).toEqual({ current: false, stamp: null, verdictDate: '判定 10/2',
      lagNote: '市場データは10/1引け時点（分析基準日10/2の再集計待ち）。日付が異なる項目には個別に日付を付けています。',
      // A phone's market tab: the lag in the stamp slot, the rest in the 注記. Today: one line.
      lagStamp: '10/1引け・10/2分は再集計待ち', lagDetail: '日付が異なる項目には個別に日付を付けています。',
      todayNote: '市場の集計は10/1時点（10/2分は再集計待ち）', blockAsOf: '10/1' });
    expect(model.groups.map(g => g.asOf)).toEqual(['10/1', '10/1', '10/1']);
    expect(model.verdict.date).toBe('判定 10/2');
    expect(model.signals.asOf).toBe('10/1');
    // The exporter withholds latest for an index that ends early; the count is the last observation, dated.
    expect(item(model, 'dist').rows.map(r => [r.b, r.asOf])).toEqual([['3日', '10/1'], ['4日', '10/1']]);
    expect(model.today[0].asOf).toBe('10/1');
  });

  it('names the one older index instead of dating the whole block', () => {
    const value = trends();
    value.data.indices[1] = index('^IXIC', '2026-10-01', 4, '2026-10-02', attempt('2026-10-01'));
    const model = view(value);
    expect(model.dating.lagNote).toBe('分配日・FTDはNAS 10/1引け時点（分析基準日10/2の再集計待ち）。日付が異なる項目には個別に日付を付けています。');
    expect(model.dating.todayNote).toBe('分配日はNAS 10/1時点（10/2分は再集計待ち）');
    // Sources on different sessions: the stamp says only that some are behind; the 注記 names each one.
    expect(model.dating.lagStamp).toBe('一部の集計は10/2分の再集計待ち');
    expect(model.dating.lagDetail).toBe(model.dating.lagNote);
    expect(model.dating.blockAsOf).toBeNull();
    expect(group(model, 'index').asOf).toBeNull();
    expect(item(model, 'dist').rows.map(r => r.asOf)).toEqual([null, '10/1']);
    expect(item(model, 'ftd').rows.map(r => r.asOf)).toEqual([null, '10/1']);
    expect(model.groups.slice(1).map(g => g.asOf)).toEqual([null, null]);
    expect(model.chart.distributionEnd).toBe('2026-10-02');
  });

  it('never turns a missing newest value into a change, a unit or today\'s value', () => {
    const rows = breadth('2026-10-02', (i, n) => (i === n - 1 ? { trendTemplateCount: null, above200: null, above200Percent: null } : i === n - 2 ? { trendTemplateCount: 28 } : {}));
    const model = view(trends({ rows }));
    expect(item(model, 'tt')).toMatchObject({ b: '28銘柄', asOf: '10/1' });
    expect(item(model, 'a200')).toMatchObject({ b: '45.0%', asOf: '10/1' });
    expect(model.signals.unjudged.map(c => [c.key, c.reason])).toEqual([['split', '指数の履歴が1年に満たない'], ['template', '最新の値なし']]);
  });

  it('names a failed follow-through day as a warning with its date', () => {
    const value = trends();
    value.data.indices[0] = index('^GSPC', '2026-10-02', 3, '2026-10-02', failed('2026-09-30'));
    const model = view(value);
    expect(model.signals.fired.map(s => s.text)).toEqual(['S&PのFTDが失敗（9/30）']);
    expect(item(model, 'ftd').rows[0]).toMatchObject({ warn: true, flag: 'FTD失敗' });
    expect(group(model, 'index').fired).toBe(1);
  });
});

describe('market tab view model: loading, failures and no publication', () => {
  it('says loading for the verdict and every group, never 未取得 and never 0', () => {
    const model = view({ loading: true, error: false, data: undefined }, { market: null, marketLoading: true });
    expect(model.verdict).toMatchObject({ pending: true, label: '判定を読み込み中…', exposure: null, basis: null, date: null });
    expect(model.signals).toBeNull();
    expect(model.groups.map(g => [g.unavailable, g.items.length])).toEqual([['読み込み中…', 0], ['読み込み中…', 0], ['読み込み中…', 0]]);
    expect(model.today.map(f => f.b)).toEqual(['読み込み中…', '読み込み中…', '読み込み中…', '読み込み中…']);
    expect(model.dating.stamp).toBeNull();
  });

  it('names a failed fetch by its cause on every tile and says the groups are not shown', () => {
    const model = view({ loading: false, error: true, data: undefined, failureReason: new TypeError('Failed to fetch') });
    expect(model.groups.map(g => g.unavailable)).toEqual(Array(3).fill('市場推移データを取得できないため表示しません。'));
    expect(model.today.map(f => [f.b, f.em])).toEqual(Array(4).fill(['取得できません', '通信エラー']));
    expect(model.signals).toBeNull();
    expect(model.summary).toBeNull();
  });

  it('calls an unreadable publication an integrity failure, not a delivery failure', () => {
    const model = view({ loading: false, error: true, data: undefined, failureReason: new Error('市場推移の基準日が一致しません。') });
    expect(model.groups[0].unavailable).toBe('市場推移データを確認できないため表示しません。');
    expect(model.today[1]).toMatchObject({ b: '確認できません', em: '整合性エラー' });
  });

  it('keeps distribution days and follow-through when only the long history is withdrawn', () => {
    const value = trends({ history: false });
    value.data.long_history_error = '長期市場履歴の整合性を確認できないため、長期集計を表示しません（検証項目: 取得日時）。';
    const model = view(value);
    expect(group(model, 'index').items.map(i => i.key)).toEqual(['ftd', 'dist']);
    expect(model.groups.slice(1).map(g => g.unavailable)).toEqual(['長期集計の整合性を確認できないため表示しません。', '長期集計の整合性を確認できないため表示しません。']);
    expect(model.signals).toMatchObject({ historyMissing: true, fired: [] });
    expect(model.today[1]).toMatchObject({ b: '確認できません', em: '長期集計の整合性エラー' });
  });

  it('keeps unknown values unknown when nothing is published', () => {
    const model = view({ data: null }, { market: { state: 'unknown', label: '市場未確認', cap: 0 } });
    expect(model.verdict).toMatchObject({ tone: 'neutral', exposure: null, basis: null, lead: '市場の状態を確認できません。新規の買いは見送ります。' });
    expect(model.groups.map(g => g.unavailable)).toEqual(Array(3).fill('市場推移データがないため表示しません。'));
    expect(model.today.map(f => [f.b, f.em])).toEqual(Array(4).fill(['未配信', '市場推移データなし']));
  });

  it('shows a known zero exposure for a weak market and the scan-time basis of that verdict', () => {
    const model = view(trends(), { market: { label: '50日線割れ（弱含み・独自判定）', cap: 0 } });
    expect(model.verdict).toMatchObject({ tone: 'neg', exposure: 0, lead: '新規の買いは控えます（独自判定）。' });
    expect(model.verdict.basis).toMatchObject({ text: '根拠（10/2スキャン時点）：S&P 500（SPY）の終値が50日線の下', above50: false, above200: true });
  });
});

describe('market tab helpers', () => {
  it('formats changes with a true minus and percentage points, never as a return', () => {
    expect([delta(77), delta(-23), delta(0)]).toEqual(['+77', '−23', '±0']);
    expect([pointChange(-6.04), pointChange(0.04), pointChange(4.4, 0)]).toEqual(['−6.0pt', '±0.0pt', '+4pt']);
    expect([signedPercent(-2.54), signedPercent(0.01)]).toEqual(['−2.5%', '±0.0%']);
  });

  it('places a value within its last 252 sessions only with enough observations', () => {
    const rows = days('2026-10-02', 260).map((date, i) => ({ date, v: i === 100 ? null : 10 + (i % 20) }));
    const range = yearRange(rows, { index: 259, value: rows[259].v }, 'v');
    expect(range).toMatchObject({ lo: 10, hi: 29 });
    expect(range.series).toHaveLength(252);
    expect(range.series.filter(v => v === null)).toHaveLength(1);
    expect(rangePosition({ at: 0 })).toBe('1年で最低');
    expect(rangePosition({ at: 1 })).toBe('1年で最高');
    expect(rangePosition({ at: 0.5 })).toBeNull();
    expect(yearRange(rows.slice(0, 150), { index: 149, value: 19 }, 'v')).toBeNull();
    expect(yearRange(rows.map(r => ({ ...r, v: 5 })), { index: 259, value: 5 }, 'v')).toBeNull();
  });

  it('summarises the index from at least 60 closes and says when it has less than a year', () => {
    expect(indexSummary(closes('2026-10-02', 59))).toBeNull();
    const short = indexSummary(closes('2026-10-02', 100));
    expect(short).toMatchObject({ fullYear: false, vs200: null });
    expect(short.vsMa).toBeCloseTo(100 * (5198 / (5000 + 2 * 74.5) - 1), 6);
  });

  it('words the basis of each verdict from its scan inputs, and only says the inputs differ', () => {
    expect(verdictBasis({ label: '上昇に圧力（独自判定）', cap: 0.25 }, '2026-10-02').text).toBe('根拠（10/2スキャン時点）：S&P 500（SPY）は50日線・200日線の上で、局面判定が「上昇に圧力」');
    expect(verdictBasis({ label: '長期トレンド警戒', cap: 0 }, '2026-10-02')).toMatchObject({ above50: null, above200: false });
    expect(verdictBasis({ label: '市場未確認', cap: 0, state: 'unknown' }, '2026-10-02')).toBeNull();
    const basis = verdictBasis(UP, '2026-10-02');
    expect(basisConflict(basis, { date: '2026-10-02', vsMa: -1, vs200: 3 }, '2026-10-02')).toBe('判定の根拠はスキャン時点のSPY、この数値は長期履歴の^GSPC終値（10/2）です。50日線との位置が一致していません。');
    expect(basisConflict(basis, { date: '2026-10-02', vsMa: 1, vs200: 3 }, '2026-10-02')).toBeNull();
    expect(basisConflict(null, { vsMa: -1 }, '2026-10-02')).toBeNull();
  });

  it('dates a block from its sources against the analysis date', () => {
    expect(marketDating({ date: '2026-10-02', historyDate: null, indexDates: [] })).toMatchObject({ current: false, stamp: null, lagNote: null });
    expect(marketDating({ date: '2026-10-02', historyDate: '2026-09-30', indexDates: [{ name: 'S&P', date: '2026-10-01' }, { name: 'NAS', date: '2026-10-01' }] }).lagNote)
      .toBe('長期集計は9/30引け、分配日・FTDは10/1引け時点（分析基準日10/2の再集計待ち）。日付が異なる項目には個別に日付を付けています。');
    expect(marketDating({ date: '2026-10-02', historyDate: '2026-09-30', indexDates: [{ name: 'S&P', date: '2026-10-01' }, { name: 'NAS', date: '2026-10-01' }] }).todayNote)
      .toBe('長期集計は9/30・分配日は10/1時点（10/2分は再集計待ち）');
    expect(groupDate([{ valued: true, asOf: '10/1' }, { rows: [{ valued: true, asOf: '10/1' }, { b: '算出不可' }] }])).toBe('10/1');
    expect(groupDate([{ valued: true, asOf: '10/1' }, { valued: true, asOf: null }])).toBeNull();
    expect(groupDate([{ b: '未算出' }])).toBeNull();
  });

  it('ranks sectors by the newest complete frame with the rank a month earlier, inventing none', () => {
    const frames = days('2026-10-23', 30).map((date, i) => ({ date, ranks: (i < 9 ? [...SYMBOLS].reverse() : SYMBOLS).map((symbol, j) => ({ symbol, rank: j + 1, relativeIndex: 120 - j * 4 })) }));
    const ranks = sectorRanks({ sectorRotation: { frames } }, '2026-10-23');
    expect(ranks).toMatchObject({ complete: true, date: '2026-10-23', older: false, beforeDate: '2026-10-02' });
    expect(ranks.rows[0]).toMatchObject({ symbol: 'XLB', name: '素材', rank: 1, text: '120.0', up: true, width: 50, was: 11, move: 10 });
    expect(ranks.rows[10]).toMatchObject({ symbol: 'XLY', up: false, was: 1, move: -10 });
    expect(ranks.rows[5]).toMatchObject({ text: '100.0', up: true, width: 0 });
    const short = sectorRanks({ sectorRotation: { frames: frames.slice(-5) } }, '2026-10-24');
    expect(short).toMatchObject({ complete: true, older: true, beforeDate: null });
    expect(short.rows[0].move).toBeNull();
    expect(sectorRanks({ sectorRotation: { frames: [{ date: '2026-10-23', ranks: frames[0].ranks.slice(1) }] } }, '2026-10-23')).toEqual({ complete: false, date: '2026-10-23', older: false, rows: [] });
    expect(sectorRanks(null, '2026-10-23')).toMatchObject({ complete: false, date: null, rows: [] });
  });

  it('says what the long history shows today only from its own values', () => {
    const rows = days('2026-10-02', 260).map((date, i) => ({ date, coverage: 100, eligibleUniverse: 100, leaderCount: 10 + (i % 50) }));
    const frames = [{ date: '2026-10-02', ranks: SYMBOLS.map((symbol, j) => ({ symbol, rank: j + 1, relativeIndex: 110 - j })) }];
    expect(historyTakeaway({ breadth: rows, sectorRotation: { frames } }, '2026-10-02')).toBe('先導株数（価格条件）は1年前の18から19銘柄（1年の範囲 10〜59）。セクターの上位は素材・通信サービス・エネルギー。参加度・リーダーの推移は現在の銘柄で過去をさかのぼった集計（上場廃止銘柄を含まない）。');
    // A lagging history: both values name their own session, never reading as the analysis date's.
    expect(historyTakeaway({ breadth: rows, sectorRotation: { frames } }, '2026-10-05')).toBe('先導株数（価格条件）は1年前の18から19銘柄（10/2時点・1年の範囲 10〜59）。セクターの上位は素材・通信サービス・エネルギー（10/2時点）。参加度・リーダーの推移は現在の銘柄で過去をさかのぼった集計（上場廃止銘柄を含まない）。');
    // No value a year earlier: the count is dated by its session instead of 「現在」.
    const noBase = rows.map((row, i) => (i === rows.length - 252 ? { ...row, leaderCount: null } : row));
    expect(historyTakeaway({ breadth: noBase }, '2026-10-02')).toBe('先導株数（価格条件）は10/2時点で19銘柄（1年の範囲 10〜59）。参加度・リーダーの推移は現在の銘柄で過去をさかのぼった集計（上場廃止銘柄を含まない）。');
    // (The caveat's 「現在の銘柄」 names today's universe, not the count's session.)
    expect(historyTakeaway({ breadth: noBase }, '2026-10-02').split('。')[0]).not.toContain('現在');
    // Without a year of counts the takeaway still carries the survivorship caveat, and only that.
    expect(historyTakeaway({ breadth: rows.slice(-100) })).toBe('参加度・リーダーの推移は現在の銘柄で過去をさかのぼった集計（上場廃止銘柄を含まない）。');
    expect(historyTakeaway(null)).toBeNull();
  });
});

// ---- 過去の傾向 (the market-regime study block) ------------------------------------------------------------
const DD = reference.methods.distribution, WINDOW = reference.methods.followThroughWindowSessions;
/** The browser fixture's S&P 500 closes (tests/static/brief-fixture.js marketTrends, frozen), rebuilt here. */
function fixtureCloses(end = '2026-10-02') {
  const days = exchange.sessions.filter(day => day <= end), n = days.length;
  let level = 3600;
  return days.map((day, i) => { level *= 1 + 0.0005 + Math.sin(i / 37) * 0.002 + (i > n - 160 && i < n - 110 ? -0.003 : 0) + (i >= n - 110 ? 0.0012 : 0); return { date: day, close: Math.round(level * 100) / 100 }; });
}
/** An index series of `n` sessions ending on its newest point (the exporter's points are its validated bars). */
const sessionsOf = (item, n = WINDOW) => { const last = item.points.at(-1); return { ...item, points: [...days(last.date, n).slice(0, -1).map(date => ({ date, value: last.value, distribution: false, reason: null })), last] }; };
/** A market-trends asset with method ids on the index series (as the exporter writes them) and the fixture's closes. */
const regimeTrends = ({ sp500 = fixtureCloses(), follow = [confirmed('2026-10-02'), attempt('2026-10-02')], counts = [3, 4], methods = [DD, DD], state, sessions = [WINDOW, WINDOW] } = {}) => {
  const value = trends({ sp500, follow });
  value.data.indices = value.data.indices.map((item, i) => sessionsOf({ ...item, latest: { ...item.latest, value: counts[i] }, points: [{ ...item.points[0], value: counts[i] }], lastObserved: { ...item.lastObserved, value: counts[i] },
    ...(methods[i] === undefined ? {} : { method: methods[i] }) }, sessions[i]));
  if (state !== undefined) value.data.indices[1].state = state;
  return value;
};
const context = (value, date = '2026-10-02', ref = reference) => marketRegimeContext({ history: value.data.long_history, trends: value, reference: ref, date });
const lines = ctx => ctx.indices.map(block => [block.name, block.items.map(item => item.text)]);
const study = (value, date = '2026-10-02', ref = reference) => marketTabStudy({ trends: value, reference: ref, date });
const BANNED = /上がりやすい|下がりやすい|安全|底打ち|オールクリア|今日の確率/;
const FOOTER = '状態ごとの過去の割合で、組み合わせた確率ではありません。これらは同じ事実（下げの最中・直後は値動きが荒い）を別の形で数えたもので、2指数は連動しているため独立の確認ではありません。この欄は下げの割合だけを示し、平均リターンが低かった状態はどちらの指数にもありません。指数の結果で、個別銘柄の値ではありません。出典：market-regime-study-v2（CI run 41844557380）、^GSPC・^IXIC日足 1990-01-02〜2026-11-03';

describe('market tab: 過去の傾向 (market-regime study block)', () => {
  it('joins the fixture\'s S&P state to the study: above both lines and further below its high, 0.29 from the edge', () => {
    const summary = indexSummary(fixtureCloses());
    expect([summary.vsMa, summary.vs200, summary.fromHigh].map(v => v.toFixed(2))).toEqual(['3.48', '1.73', '-5.29']);
    const ctx = context(regimeTrends());
    expect(ctx.summary).toBe('過去の傾向（1990〜2026年・予測ではありません）');
    const [quadrant, high, dd, ftd] = ctx.indices[0].items;
    expect(quadrant).toMatchObject({ indicator: '^GSPC.ma.quadrant', state: 'above_both', stateDate: '2026-10-02', pDd5: 10, comparator: 'baseline', comparatorLabel: '全期間', comparatorPDd5: 16, tag: '〔S&P・Nasdaqとも〕', biasTag: null });
    expect(high).toMatchObject({ indicator: '^GSPC.high.near', state: 'below', pDd5: 29, comparator: 'other_state', comparatorLabel: '5%以内', comparatorPDd5: 11, tag: '〔S&P・Nasdaqとも〕' });
    expect(high.edgeDistance).toBeCloseTo(0.29, 2);
    expect(dd).toMatchObject({ indicator: '^GSPC.dd.graded', state: '3-4', pDd5: 15, comparatorPDd5: 17, tag: '〔未確立〕' });
    expect(ftd).toMatchObject({ indicator: '^GSPC.ftd.state', state: 'confirmed', pDd5: 19, tag: '〔未確立〕', biasTag: '〔偏り〕' });
    expect(lines(ctx)).toEqual([
      ['S&P 500', ['50日線・200日線の上（10/2時点）：21営業日以内に5%以上下げた割合 10%（全期間 16%）〔S&P・Nasdaqとも〕', '1年高値から5%超の下（10/2時点・境界まで0.3%）：29%（5%以内 11%）〔S&P・Nasdaqとも〕',
        '分配日3〜4日（10/2時点）：15%（全期間 17%）〔未確立〕', 'FTD確認後（10/2時点）：19%（全期間 16%）〔未確立〕〔偏り〕']],
      ['Nasdaq総合', ['50日線・200日線との位置：旧形式の公開データに未収録', '1年高値との位置：旧形式の公開データに未収録', '分配日3〜4日（10/2時点）：23%（全期間 26%）〔Nasdaqのみ〕', '反発中（FTD判定・10/2時点）：32%（全期間 26%）〔未確立〕']]]);
    // Each valued line keeps its comparator and its tags as parts, so neither breaks across lines on screen.
    expect(ftd.parts).toEqual({ body: 'FTD確認後（10/2時点）：19%', comparator: '（全期間 16%）', tags: ['〔未確立〕', '〔偏り〕'] });
    expect(ctx.indices.flatMap(block => block.items).filter(item => item.parts).every(item => item.text === `${item.parts.body}${item.parts.comparator || ''}${item.parts.tags.join('')}`)).toBe(true);
    expect(ctx.footer).toBe(FOOTER);
    expect(ctx.key).toBe('割合は、その日の終値から21営業日以内に終値で5%以上下げた日の割合です。全期間は、その項目を判定できた全営業日での割合です。〔S&P・Nasdaqとも〕＝両指数で確認、〔Nasdaqのみ〕＝Nasdaqでのみ確認、〔未確立〕＝その指数では確認できず、〔偏り〕＝その状態の日の60%以上が検証期間の前半か後半に集中。確認は、偶然では説明しにくい差（p≤0.05）が、期間の前半・後半とも同じ向きで出たことです。');
  });

  it('keys exactly the tags its lines show, each defined from TAGS and BIAS_SHARE', () => {
    for (const ctx of [context(regimeTrends()), context(regimeTrends({ follow: [{ ...confirmed('2026-10-02'), state: 'no_correction', peakAtWindowStart: true, ftd: null }, attempt('2026-10-02')], state: { date: '2026-10-02', close: 18000, vs50: -2, vs200: -1, fromHigh: -9, fullYear: true } }))]) {
      const shown = new Set(ctx.indices.flatMap(block => block.items.flatMap(item => item.parts?.tags || [])));
      const keyed = Object.keys(TAG_MEANINGS).filter(tag => ctx.key.includes(`${tag}＝`));
      expect(new Set(keyed)).toEqual(shown);
    }
    expect(TAG_MEANINGS[TAGS.bias]).toBe(`その状態の日の${BIAS_SHARE.atLeast}%以上が検証期間の前半か後半に集中`);
    expect(BIAS_SHARE.atMost).toBe(100 - BIAS_SHARE.atLeast);
    expect(Object.keys(TAG_MEANINGS)).toEqual([TAGS.both, TAGS['^GSPC'], TAGS['^IXIC'], TAGS.unestablished, TAGS.insufficient, TAGS.bias]);
    expect(regimeKey([TAGS.insufficient])).toBe('割合は、その日の終値から21営業日以内に終値で5%以上下げた日の割合です。全期間は、その項目を判定できた全営業日での割合です。〔標本不足〕＝日数が足りず判定なし。');
    expect(regimeKey([])).not.toContain('〔');
  });

  it('says no state had a lower mean return only while the reference says so', () => {
    expect(context(regimeTrends()).footer).toContain('平均リターンが低かった状態はどちらの指数にもありません');
    const ref = structuredClone(reference);
    Object.assign(ref.indicators['^IXIC.ftd.state'].states.ftd_failed, { labelMean: 'robust', meanDirection: 'lower' });
    const footer = context(regimeTrends(), '2026-10-02', ref).footer;
    expect(footer).not.toContain('平均リターン');
    expect(footer).toContain('この欄は下げの割合だけを示します。');
  });

  it('never shows the baseline as a state\'s value or combines states: each share is its own row\'s', () => {
    const ctx = context(regimeTrends({ follow: [{ ...confirmed('2026-10-02'), ftd: { ...confirmed('2026-10-02').ftd, sessionsSince: 12 } }, attempt('2026-10-02')], state: { date: '2026-10-02', close: 18000, vs50: -2, vs200: -1, fromHigh: -9, fullYear: true } }));
    for (const item of ctx.indices.flatMap(block => block.items).filter(item => item.pDd5 !== undefined)) {
      const row = referenceState(reference, item.indicator, item.state);
      expect([item.pDd5, item.comparatorPDd5]).toEqual([row.pDd5, row.comparatorPDd5]);
      // One state share and one comparator per line, never a product or a sum of states.
      expect(item.text.split('：')[1].match(/(?<![\d.])\d+%(?!以内|超|以上)/g)).toEqual([`${Math.round(row.pDd5)}%`, `${Math.round(row.comparatorPDd5)}%`]);
    }
    // FTD confirmed 12 sessions ago adds its own study row (combo.ftd_recent), compared with every other judged state.
    expect(ctx.indices[0].items.at(-1)).toMatchObject({ indicator: '^GSPC.combo.ftd_recent', state: 'recent', pDd5: 26, comparatorLabel: 'それ以外', comparatorPDd5: 15, tag: '〔S&Pのみ〕' });
    expect(ctx.indices[1].items.slice(0, 2).map(item => item.text)).toEqual(['50日線・200日線の下（10/2時点）：46%（全期間 26%）〔S&P・Nasdaqとも〕〔偏り〕', '1年高値から5%超の下（10/2時点・境界まで4.0%）：35%（5%以内 19%）〔S&P・Nasdaqとも〕']);
    for (const text of [...lines(ctx).flatMap(([, items]) => items), ctx.summary, ctx.footer, ctx.key]) { expect(text).not.toMatch(BANNED); expect(text).not.toMatch(/今日|平常/); }
  });

  it('gives a reason instead of a row for a short window, a missing close, a method mismatch or a sample too small', () => {
    const short = context(regimeTrends({ sp500: fixtureCloses().slice(-230) }));
    expect(short.indices[0].items.slice(0, 2).map(item => [item.state, item.reason ?? null])).toEqual([['above_both', null], [null, '1年分（252日）の終値がないため判定できません']]);
    const shorter = context(regimeTrends({ sp500: fixtureCloses().slice(-150) }));
    expect(shorter.indices[0].items.slice(0, 2).map(item => item.text)).toEqual(['50日線・200日線との位置（10/2時点）：200日分の終値がないため判定できません', '1年高値との位置（10/2時点）：1年分（252日）の終値がないため判定できません']);
    // The newest close unknown: a window never bridges it.
    const gap = fixtureCloses(); gap[gap.length - 1] = { ...gap.at(-1), close: null };
    expect(context(regimeTrends({ sp500: gap })).indices[0].items[0].reason).toBe('最新の終値がないため判定できません');
    // Method ids that are not the study's, or none recorded.
    const mismatch = context(regimeTrends({ methods: ['index-down-other-v9', undefined], follow: [{ ...confirmed('2026-10-02'), method: 'other-ftd-v2' }, attempt('2026-10-02')] }));
    expect(mismatch.indices.map(block => block.items.slice(2).map(item => item.reason))).toEqual([['集計方法が検証と異なるため表示しません', '判定方法が検証と異なるため表示しません'], ['集計方法の記録がないため表示しません', undefined]]);
    // 判定保留 has no sessions in the study: 〔標本不足〕 and no number.
    const pending = context(regimeTrends({ follow: [{ ...confirmed('2026-10-02'), state: 'no_correction', peakAtWindowStart: true, ftd: null }, attempt('2026-10-02')] }));
    expect(pending.indices[0].items[3]).toMatchObject({ state: 'no_correction_pending', reason: '標本不足', tag: '〔標本不足〕', text: 'FTD判定保留（集計期間の初日が高値・10/2時点）：〔標本不足〕' });
    expect(pending.indices[0].items[3].pDd5).toBeUndefined();
    // An older publication without the follow-through field.
    const legacy = trends({ sp500: fixtureCloses(), legacy: true });
    expect(context(legacy).indices[0].items[3].text).toBe('FTD判定：旧形式の公開データに未収録');
    // No reference, or a market-trends asset that is not ready: one reason for the whole block.
    expect(context(regimeTrends(), '2026-10-02', null)).toMatchObject({ available: false, reason: '検証結果の参照データを確認できないため表示しません。', indices: [] });
    expect(marketRegimeContext({ history: null, trends: { loading: true }, reference, date: '2026-10-02' })).toMatchObject({ available: false, reason: '読み込み中…', summary: '過去の傾向（1990〜2026年・予測ではありません）' });
  });

  it('joins a follow-through state only when it was judged on the study\'s window of sessions', () => {
    // A historical index (its last bar before the analysis date) was judged on 279 sessions, the study on 280.
    const recent = { ...confirmed('2026-10-02'), ftd: { ...confirmed('2026-10-02').ftd, sessionsSince: 12 } };
    const ctx = context(regimeTrends({ follow: [recent, attempt('2026-10-02')], sessions: [WINDOW - 1, WINDOW + 1] }));
    expect(ctx.indices.map(block => block.items.slice(2).map(item => item.text))).toEqual([
      ['分配日3〜4日（10/2時点）：15%（全期間 17%）〔未確立〕', 'FTD判定（10/2時点）：判定期間が検証（280営業日）と異なるため表示しません'],
      ['分配日3〜4日（10/2時点）：23%（全期間 26%）〔Nasdaqのみ〕', 'FTD判定（10/2時点）：判定期間が検証（280営業日）と異なるため表示しません']]);
    // Nor the FTD-failure tag on the warning summary.
    const failing = regimeTrends({ follow: [failed('2026-10-02'), failed('2026-10-02')], sessions: [WINDOW - 1, WINDOW] });
    expect([study(failing).signalTags['ftd-S&P'], study(failing).signalTags['ftd-NAS'], study(failing).signalTags['dist-S&P']]).toEqual([[], ['〔未確立〕'], ['〔S&Pのみ〕']]);
  });

  it('reads the Nasdaq position only from a published state, as 未収録 without one and never as 0', () => {
    expect(context(regimeTrends()).indices[1].items[0].reason).toBe('旧形式の公開データに未収録');
    const ok = context(regimeTrends({ state: { date: '2026-10-02', close: 18000, vs50: 1.2, vs200: 5, fromHigh: -2.1, fullYear: true } })).indices[1].items;
    expect(ok.slice(0, 2).map(item => [item.state, item.pDd5, item.tag])).toEqual([['above_both', 19, '〔S&P・Nasdaqとも〕'], ['near', 19, '〔S&P・Nasdaqとも〕']]);
    expect(ok[1].edgeDistance).toBeCloseTo(2.9, 5);
    // A state of another session than the series' last point, nulls on a short window, malformed fields.
    expect(publishedIndexState({ points: [{ date: '2026-10-02' }], state: { date: '2026-10-01', close: 1, vs50: 1, vs200: 1, fromHigh: -1, fullYear: true } })).toEqual({ state: null, reason: '指数の位置の形式を確認できません' });
    expect(publishedIndexState({ points: [{ date: '2026-10-02' }], state: { date: '2026-10-02', close: 1, vs50: 0.5, vs200: null, fromHigh: null, fullYear: false } }).state).toEqual({ date: '2026-10-02', close: 1, vsMa: 0.5, vs200: null, fromHigh: null, fullYear: false });
    expect(publishedIndexState({ points: [{ date: '2026-10-02' }], state: { date: '2026-10-02', close: 1, vs50: '0', vs200: null, fromHigh: null, fullYear: false } }).state).toBeNull();
    expect(publishedIndexState({ points: [], state: null, reason: '同じ基準日の出典付き指数履歴は未取得です。' })).toEqual({ state: null, reason: '同じ基準日の出典付き指数履歴は未取得です。' });
    const short = context(regimeTrends({ state: { date: '2026-10-02', close: 18000, vs50: 1.2, vs200: null, fromHigh: null, fullYear: false } })).indices[1].items;
    expect(short.slice(0, 2).map(item => item.text)).toEqual(['50日線・200日線との位置（10/2時点）：200日分の終値がないため判定できません', '1年高値との位置（10/2時点）：1年分（252日）の終値がないため判定できません']);
    // In words: an unknown distance is 未算出, never 0; older data has no figures at all.
    expect(study(regimeTrends({ state: { date: '2026-10-02', close: 18234.56, vs50: 1.24, vs200: null, fromHigh: -2.1, fullYear: true } })).nasdaqFigures).toEqual({ close: '18,234.56', text: '10/2終値・1年高値から −2.1%・50日線比 +1.2%・200日線比 未算出' });
    expect(study(regimeTrends()).nasdaqFigures).toBeNull();
  });

  it('dates every state on its own session, so a lagging series never reads as the analysis date\'s', () => {
    const value = regimeTrends({ sp500: fixtureCloses('2026-10-01') });
    value.data.indices[1] = sessionsOf({ ...value.data.indices[1], latest: null, lastObserved: { date: '2026-09-30', value: 4 }, points: [{ date: '2026-09-30', value: 4 }], followThrough: attempt('2026-09-30') });
    const ctx = context(value);
    expect(ctx.indices[0].items[0].text).toMatch(/^50日線・200日線の上（10\/1時点）：/);
    expect(ctx.indices[1].items.slice(2).map(item => item.stateDate)).toEqual(['2026-09-30', '2026-09-30']);
  });
});

describe('market tab: study tags on the warning summary, the Nasdaq note and the distribution detail', () => {
  const rows = breadth('2026-10-02', (i, n) => (i === n - 1 ? { newHighs: 10, newLows: 30 } : {}));
  const failing = () => {
    const value = trends({ rows, follow: [failed('2026-10-02'), failed('2026-10-02')] });
    value.data.indices = [index('^GSPC', '2026-10-02', 6, '2026-10-02', failed('2026-10-02')), index('^IXIC', '2026-10-02', 7, '2026-10-02', failed('2026-10-02'))].map(item => sessionsOf({ ...item, method: DD }));
    return value;
  };
  it('tags each fired check from the reference, with 〔偏り〕; the 〔参考〕 legend only when a 〔参考〕 tag is shown', () => {
    const value = failing();
    const model = marketCardView({ market: UP, trends: value, date: '2026-10-02', study: study(value) });
    expect(model.signals.fired.map(c => [c.key, c.tags])).toEqual([['dist-S&P', ['〔S&Pのみ〕']], ['dist-NAS', ['〔未確立〕']], ['ftd-S&P', ['〔S&Pのみ〕', '〔偏り〕']], ['ftd-NAS', ['〔未確立〕']], ['lows', ['〔参考〕']]]);
    expect(model.signals.legend).toBe('〔参考〕＝2021〜26年の検証で関係未確認');
    expect(model.signals.tagNote).toBe('〔参考〕は、2021〜2026年の参加度データ（現在の銘柄で過去をさかのぼった集計・上場廃止銘柄を含まない）の検証で、その後の指数の下げとの関係を確認できなかった注意サインです（全体として偶然と区別できない結果）。'
      + '〔S&Pのみ〕〔未確立〕は、1990〜2026年の指数の日足で、その状態のあと21営業日以内に5%以上下げた割合を調べた結果です（〔S&Pのみ〕はS&Pでのみ確認、〔未確立〕はその指数では確認できず、〔偏り〕はその状態の日の60%以上が検証期間の前半か後半に集中）。'
      + '確認は、偶然では説明しにくい差（p≤0.05）が、期間の前半・後半とも同じ向きで出たことです。注意サインの基準と目安は変えていません。');
    // Index checks only: no 〔参考〕 legend.
    const indexOnly = { ...value, data: { ...value.data, long_history: { as_of_date: '2026-10-02', breadth: breadth('2026-10-02'), sp500: [] } } };
    const indexModel = marketCardView({ market: UP, trends: indexOnly, date: '2026-10-02', study: study(indexOnly) });
    expect(indexModel.signals.fired.every(c => !c.tags.includes('〔参考〕'))).toBe(true);
    expect(indexModel.signals.legend).toBeNull();
    // Without a reference (or with a broken one), or without the study at all (Today), no tags and no words about them.
    for (const none of [marketCardView({ market: UP, trends: value, date: '2026-10-02', study: study(value, '2026-10-02', null) }), marketCardView({ market: UP, trends: value, date: '2026-10-02' })]) {
      expect(none.signals.fired.map(c => c.tags)).toEqual([[], [], [], [], []]);
      expect([none.signals.legend, none.signals.tagNote]).toEqual([null, null]);
      // The order of the checks is the page's, unchanged.
      expect(model.signals.fired.map(c => c.key)).toEqual(none.signals.fired.map(c => c.key));
    }
    expect(signalTagText(reference, [])).toEqual({ legend: null, note: null });
  });

  it('defines every tag the summary shows, whatever a rebuilt reference labels', () => {
    const ref = structuredClone(reference);
    ref.indicators['^IXIC.dd.binary'].states.warn.labelDd5 = 'robust';
    ref.indicators['^IXIC.ftd.state'].states.ftd_failed.labelDd5 = 'insufficient';
    ref.breadth['rule.lows'].labelDd5 = 'robust';
    const value = failing(), model = marketCardView({ market: UP, trends: value, date: '2026-10-02', study: study(value, '2026-10-02', ref) });
    expect(model.signals.fired.map(c => c.tags)).toEqual([['〔S&P・Nasdaqとも〕'], ['〔S&P・Nasdaqとも〕'], ['〔S&Pのみ〕', '〔偏り〕'], ['〔標本不足〕'], []]);
    expect(model.signals.legend).toBeNull();
    expect(model.signals.tagNote).toContain('（〔S&P・Nasdaqとも〕は両指数で確認、〔S&Pのみ〕はS&Pでのみ確認、〔標本不足〕は日数が足りず判定なし、〔偏り〕はその状態の日の60%以上が検証期間の前半か後半に集中）');
    expect(model.signals.tagNote).not.toContain('〔参考〕');
  });

  it('says the verdict reads SPY only while it is positive and the Nasdaq is correcting, rallying or failed', () => {
    const at = state => ({ ...attempt('2026-10-02'), state });
    expect(nasdaqNote(attempt('2026-10-02'), '2026-10-02')).toEqual({ long: '判定はS&P 500（SPY）のみに基づきます。Nasdaq総合は反発3日目（FTD未確認・独自判定）。', short: 'Nasdaqは反発3日目（判定はSPYのみ）' });
    expect(nasdaqNote({ ...at('correction'), declinePct: 7.2 }, '2026-10-02')).toMatchObject({ short: 'Nasdaqは調整中（判定はSPYのみ）' });
    expect(nasdaqNote(failed('2026-10-02'), '2026-10-02')).toEqual({ long: '判定はS&P 500（SPY）のみに基づきます。Nasdaq総合はFTD失敗 10/2（独自判定）。', short: 'NasdaqはFTD失敗（判定はSPYのみ）' });
    expect(nasdaqNote(attempt('2026-10-01'), '2026-10-02').short).toBe('Nasdaqは反発3日目（10/1時点・判定はSPYのみ）');
    for (const ft of [confirmed('2026-10-02'), at('no_correction'), at('attempt_expired'), { available: false, reason: 'x' }, undefined]) expect(nasdaqNote(ft, '2026-10-02')).toBeNull();
    const withStudy = (market = UP) => marketCardView({ market, trends: trends(), date: '2026-10-02', study: study(trends()) });
    expect(withStudy().verdict.nasdaq).toMatchObject({ short: 'Nasdaqは反発3日目（判定はSPYのみ）' });
    expect(withStudy({ label: '50日線割れ（弱含み・独自判定）', cap: 0 }).verdict.nasdaq).toBeNull();
    expect(withStudy({ label: '市場未確認', cap: 0, state: 'unknown' }).verdict.nasdaq).toBeNull();
    expect(view(trends()).verdict.nasdaq).toBeNull();
  });

  it('opens the 分配日 row on the method, each index\'s active days with the sessions left, and its year of counts', () => {
    const value = trends(), points = days('2026-10-02', 280).map((date, i) => ({ date, value: i < 25 ? null : (i % 9) }));
    value.data.indices[0] = { ...value.data.indices[0], points: [...points.slice(0, -1), { date: '2026-10-02', value: 3 }], events: [
      { date: '2026-09-14', state: 'active', ageSessions: 19 }, { date: '2026-09-30', state: 'active', ageSessions: 2 }, { date: '2026-09-22', state: 'active', ageSessions: 9 }, { date: '2026-08-01', state: 'expired', ageSessions: 40 }] };
    value.data.indices[1] = { ...value.data.indices[1], latest: { date: '2026-10-02', value: 0 }, lastObserved: { date: '2026-10-02', value: 0 }, points: [{ date: '2026-10-02', value: 0 }], events: [] };
    const dist = model => model.groups[0].items.find(i => i.key === 'dist');
    const opened = dist(marketCardView({ market: UP, trends: value, date: '2026-10-02', study: study(value) }));
    expect(opened.details).toEqual(['下の分配日は^GSPC/^IXICの別集計（ストーリング日なし・5日以上で注意）', 'S&P：9/14・9/22・9/30（最も古い日はあと6営業日で失効・後日の高値で早く除外される場合あり）', 'NAS：有効な分配日なし']);
    expect(opened.yearLines.map(line => [line.label, line.range.series.length, line.range.series.filter(v => v === null).length, line.range.lo, line.range.hi, line.format(3)])).toEqual([['S&Pの分配日', 252, 0, 0, 8, '3日']]);
    // Dates that do not add up to the count are not listed.
    expect(dist(marketCardView({ market: UP, trends: trends(), date: '2026-10-02', study: study(trends()) })).details.slice(1)).toEqual(['S&P：有効な分配日の日付を確認できません', 'NAS：有効な分配日の日付を確認できません']);
    // Today (no study) has no detail lines.
    expect(dist(view(trends())).details).toBeUndefined();
  });

  it('never tones a confirmed FTD as a buy zone (the model the row reads; the card never drew the tone)', () => {
    const ftd = view(trends()).groups[0].items.find(i => i.key === 'ftd');
    expect(ftd.rows[0]).toMatchObject({ name: 'S&P', b: '確認 8/7' });
    expect(ftd.rows[0].tone).toBeUndefined();
  });
});
