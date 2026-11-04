import { describe, expect, it } from 'vitest';
import { attempt, breadth, closes, confirmed, days, failed, index, oldSchema, trends, UP } from '../../test/fixtures/marketTrends';
import { basisConflict, delta, groupDate, historyTakeaway, indexSummary, marketCardView, marketDating, pointChange, rangePosition, RULE_TEXT, sectorRanks, signedPercent, verdictBasis, yearRange } from './marketTabModel';

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
    expect(model.dating).toEqual({ current: true, stamp: '10/2 引け', lagNote: null, todayNote: null, verdictDate: null });
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
    expect(group(model, 'leaders').missing).toBe('旧形式の長期集計（10/2）には未収録：RS90以上のTT達成（独自RS）・ブレイクアウト成功率・リーダーの健全度・ステージ構成');
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
      todayNote: '長期集計は 2026-10-01 時点・分配日は 2026-10-01 時点（分析基準日 2026-10-02 の再集計待ち）' });
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
    expect(model.dating.todayNote).toBe('分配日は NAS 2026-10-01 時点（分析基準日 2026-10-02 の再集計待ち）');
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
    expect(historyTakeaway({ breadth: rows, sectorRotation: { frames } }, '2026-10-02')).toBe('先導株数（価格条件）は1年前の18から19銘柄（1年の範囲 10〜59）。セクターの上位は素材・通信サービス・エネルギー。');
    // A lagging history: both values name their own session, never reading as the analysis date's.
    expect(historyTakeaway({ breadth: rows, sectorRotation: { frames } }, '2026-10-05')).toBe('先導株数（価格条件）は1年前の18から19銘柄（10/2時点・1年の範囲 10〜59）。セクターの上位は素材・通信サービス・エネルギー（10/2時点）。');
    // No value a year earlier: the count is dated by its session instead of 「現在」.
    const noBase = rows.map((row, i) => (i === rows.length - 252 ? { ...row, leaderCount: null } : row));
    expect(historyTakeaway({ breadth: noBase }, '2026-10-02')).toBe('先導株数（価格条件）は10/2時点で19銘柄（1年の範囲 10〜59）。');
    expect(historyTakeaway({ breadth: noBase }, '2026-10-02')).not.toContain('現在');
    expect(historyTakeaway({ breadth: rows.slice(-100) })).toBeNull();
    expect(historyTakeaway(null)).toBeNull();
  });
});
