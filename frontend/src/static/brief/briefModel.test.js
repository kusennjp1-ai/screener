import { describe, expect, it } from 'vitest';
import { bookFinancialCurrent } from '../bookFinancialCurrent';
import { bookFinancialEvidence } from '../bookFinancialEvidence';
import { secPoint, secRecord, secUnavailable } from '../../test/fixtures/secRecord';
import { code33Explain, fundamentalTiles, fundamentalsSource, secStatus } from './briefModel';
import { briefOrder, candidateView, code33Parts, environmentRules, environmentWarnings, focusCandidates, focusCounts, ruleEvidence, footprint, matchesSearch, positionPlan, rsLineNewHigh, watchEvent, LIST_FILTERS, LIST_SORTS, STOP_MAX_PERCENT } from './briefModel';

const view = (over = {}) => ({ symbol: 'AAA', state: 'zone', distance: 1, volumeRatio: 1.2, rs: 80, passed: 9, pivot: 100, price: 101, ...over });

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

  it('shows the 52-week distances behind the trend-template rules and keeps unknowns blank', () => {
    expect(ruleEvidence({ label: '52週安値から ≥ 30%（日中安値）', value: 45.24, unit: '%' })).toBe('52週安値から +45.2%');
    expect(ruleEvidence({ label: '52週高値からの距離 ≤ 25%（日中高値）', value: 8.31, unit: '%' })).toBe('52週高値から −8.3%');
    expect(ruleEvidence({ label: '52週高値からの距離 ≤ 25%（日中高値）', value: 0, unit: '%' })).toBe('52週高値と同値');
    expect(ruleEvidence({ label: '52週安値から ≥ 30%（日中安値）', value: null, unit: '%' })).toBe('');
    expect(ruleEvidence({ label: 'RS 推計 ≥ 70', value: 88, unit: '', evidence: '1000銘柄' })).toBe('1000銘柄');
  });

  it('orders the buy zone first, then within 5% below the pivot, then further below, then extended', () => {
    const items = [view({ symbol: 'EXT', state: 'ext', distance: 7 }), view({ symbol: 'FAR', state: 'wait', distance: -9 }), view({ symbol: 'NEAR', state: 'wait', distance: -2 }), view({ symbol: 'ZONE' })];
    expect(items.sort(briefOrder).map(v => v.symbol)).toEqual(['ZONE', 'NEAR', 'FAR', 'EXT']);
    expect(LIST_FILTERS.near.test(view({ qualified: true, state: 'wait', distance: -4.9 }))).toBe(true);
    expect(LIST_FILTERS.near.test(view({ qualified: true, state: 'wait', distance: null }))).toBe(false);
    expect(LIST_FILTERS.near.test(view({ qualified: false, state: 'wait', distance: -1 }))).toBe(false);
    expect(LIST_FILTERS.one.test(view({ qualified: false, failed: 1, unknown: 0 }))).toBe(true);
    expect(LIST_FILTERS.one.test(view({ qualified: false, failed: 1, unknown: 1 }))).toBe(false);
    expect(matchesSearch(view({ symbol: 'NVLX', name: 'Novalux' }), 'nova')).toBe(true);
    expect(matchesSearch(view({ symbol: 'NVLX', name: 'Novalux' }), 'zz')).toBe(false);
    const byHigh = [view({ symbol: 'UNK', fromHigh: null }), view({ symbol: 'FAR', fromHigh: 18 }), view({ symbol: 'TOP', fromHigh: 0 })].sort(LIST_SORTS.high.compare);
    expect(byHigh.map(v => v.symbol)).toEqual(['TOP', 'FAR', 'UNK']);
  });

  it('describes watch changes and needs 1.4x volume to call a breakout', () => {
    expect(watchEvent(view({ volumeRatio: 1.4 })).kind).toBe('breakout');
    expect(watchEvent(view({ volumeRatio: 1.39 })).kind).toBe('zone');
    expect(watchEvent(view({ volumeRatio: null })).kind).toBe('zone');
    expect(watchEvent(view({ state: 'wait', distance: -3.25 })).title).toBe('ピボットまで あと3.3%');
    expect(watchEvent(view({ state: 'ext', distance: 8 })).tone).toBe('ext');
  });

  it('sizes a position from the planned entry and keeps the stop under 10%', () => {
    const plan = positionPlan(view({ pivot: 100, price: 102 }), { stopPercent: 7, account: 50000, riskPercent: 1 });
    expect(plan.entry).toBe(102);
    expect(plan.stop).toBeCloseTo(94.86, 2);
    expect(plan.shares).toBe(Math.floor(500 / (102 - 94.86)));
    expect(plan.r2).toBeCloseTo(102 + 2 * 7.14, 2);
    expect(positionPlan(view(), { stopPercent: 25 }).stopPercent).toBeLessThan(STOP_MAX_PERCENT);
    expect(positionPlan(view({ pivot: null }))).toBeNull();
    expect(positionPlan(view({ pivot: 100, price: 90 }), { stopPercent: 7 }).entry).toBe(100);
  });

  it('writes the VCP footprint only from valid, measured legs', () => {
    const legs = [{ startDate: '2026-06-01', endDate: '2026-07-01', depthPct: 24.4 }, { startDate: '2026-07-10', endDate: '2026-08-10', depthPct: 12 }, { startDate: '2026-08-20', endDate: '2026-09-20', depthPct: 4.6 }];
    const print = footprint({ vcp: { legs, measurementsValid: true, depthsContract: true } }, [{ date: '2026-10-02' }]);
    expect(print.text).toBe('VCP 18週 24/5 3T');
    expect(print.contracting).toBe(true);
    expect(footprint({ vcp: { legs, measurementsValid: true, depthsContract: false } }, [{ date: '2026-10-02' }]).text).toBe('収縮 18週 24/5 3T（縮小途切れ）');
    expect(footprint({ vcp: { legs, measurementsValid: true } }, [{ date: '2026-10-02' }]).text).toBe('収縮 18週 24/5 3T（縮小は未確認）');
    expect(footprint({ vcp: { legs, measurementsValid: false } }, [])).toBeNull();
    expect(footprint({ vcp: { legs: legs.slice(0, 1), measurementsValid: true } }, [])).toBeNull();
  });
});

describe('Today\'s focus counts', () => {
  // A row's state and pivot distance come from its price against its pivot (100).
  const item = (symbol, price, qualified = true) => ({ row: { symbol, current_price: price, se_pivot_price: 100 }, assessment: { qualified, passed: qualified ? 8 : 7, failed: qualified ? 0 : 1, unknown: 0, total: 8 } });
  const ranked = [
    item('ZON1', 100), item('ZON2', 102), // qualified, in the buy zone
    item('NEA1', 99.5), item('NEA2', 97), item('NEA3', 95.0000001), // qualified, waiting −0.5 / −3 / −5 (the boundary)
    item('FAR1', 93), // qualified, waiting −7: not near
    item('UNQ1', 101, false), // in the zone but not qualified
    item('EXT1', 107), // qualified, extended
  ];
  it('counts the whole focus pool, not the shown slice', () => {
    expect(focusCounts(ranked, '2026-10-02')).toEqual({ zone: 2, near: 3, total: 5 });
    expect(focusCandidates(ranked, '2026-10-02', 2)).toHaveLength(2);
    expect(focusCandidates(ranked, '2026-10-02', 5).length).toBeLessThanOrEqual(focusCounts(ranked, '2026-10-02').total);
    expect(focusCandidates(ranked, '2026-10-02', 5).map(view => view.symbol).sort()).toEqual(['NEA1', 'NEA2', 'NEA3', 'ZON1', 'ZON2']);
  });
  it('agrees with the list\'s zone and near filters over the same rows', () => {
    const views = ranked.map(entry => candidateView(entry, '2026-10-02'));
    const { zone, near } = focusCounts(ranked, '2026-10-02');
    expect(zone).toBe(views.filter(LIST_FILTERS.zone.test).length);
    expect(near).toBe(views.filter(LIST_FILTERS.near.test).length);
  });
  it('is all zero without rows', () => {
    expect(focusCounts([], '2026-10-02')).toEqual({ zone: 0, near: 0, total: 0 });
    expect(focusCounts(undefined, '2026-10-02')).toEqual({ zone: 0, near: 0, total: 0 });
  });
});

describe('RS line new high', () => {
  const bars = Array.from({ length: 260 }, (_, i) => ({ date: `d${i}` }));
  it('needs 252 aligned sessions and compares with the prior 251', () => {
    const line = bars.map((b, i) => ({ time: b.date, value: 100 + Math.sin(i / 9) }));
    expect(rsLineNewHigh(line, bars)).toBe(false);
    line[259].value = 102;
    expect(rsLineNewHigh(line, bars)).toBe(true);
    expect(rsLineNewHigh(line.slice(-100), bars)).toBeNull();
  });
});

describe('market deterioration notes', () => {
  const row = over => ({ trendTemplateCount: 100, stage2Percent: 40, stage4Percent: 20, breakoutHoldPercent: 60, ...over });
  it('flags a 20% drop in ten sessions, stage 4 above stage 2 and weak follow-through, and nothing when unknown', () => {
    const rows = Array.from({ length: 11 }, () => row());
    expect(environmentWarnings(rows)).toEqual([]);
    rows[10] = row({ trendTemplateCount: 79, stage2Percent: 25, stage4Percent: 30, breakoutHoldPercent: 35, leaderHealthPercent: 45 });
    expect(environmentWarnings(rows).map(n => n.key)).toEqual(['template', 'stage', 'leaders', 'breakout']);
    rows[10] = row({ trendTemplateCount: null, stage2Percent: null, breakoutHoldPercent: null });
    expect(environmentWarnings(rows)).toEqual([]);
    expect(environmentWarnings([])).toEqual([]);
  });

  it('says for each rule whether it could be judged on the newest point, so a missing input is never read as all clear', () => {
    const rows = Array.from({ length: 11 }, () => row({ leaderHealthPercent: 60 }));
    expect(environmentRules(rows)).toEqual([
      { key: 'template', judged: true, fired: false }, { key: 'stage', judged: true, fired: false },
      { key: 'leaders', judged: true, fired: false }, { key: 'breakout', judged: true, fired: false }]);
    rows[10] = row({ trendTemplateCount: 79, stage4Percent: null, leaderHealthPercent: 45 });
    expect(environmentRules(rows)).toEqual([
      { key: 'template', judged: true, fired: true, text: 'トレンドテンプレート達成数が10営業日で21%減少' }, { key: 'stage', judged: false, fired: false },
      { key: 'leaders', judged: true, fired: true, text: '20営業日前のTT達成銘柄のうち、50日線より上は45%' }, { key: 'breakout', judged: true, fired: false }]);
    // Under 20 in the base session, a drop is not judged at all.
    rows[0] = row({ trendTemplateCount: 19 });
    expect(environmentRules(rows)[0]).toEqual({ key: 'template', judged: false, fired: false });
    expect(environmentRules([]).every(rule => !rule.judged)).toBe(true);
  });
});

describe('stage from daily bars', () => {
  const series = fn => Array.from({ length: 300 }, (_, i) => ({ close: fn(i) }));
  it('follows the scanner rules for advancing, declining, flat and topping series', async () => {
    const { stageFromBars } = await import('./briefModel');
    expect(stageFromBars(series(i => 50 * 1.004 ** i))).toBe(2);
    expect(stageFromBars(series(i => 200 * 0.996 ** i))).toBe(4);
    expect(stageFromBars(series(i => 100 + Math.sin(i / 5)))).toBe(1);
    expect(stageFromBars(series(i => (i < 200 ? 50 * 1.004 ** i : 50 * 1.004 ** 200 * (1 - (i - 200) * 0.0005))))).toBe(3);
    expect(stageFromBars(series(() => 50).slice(0, 100))).toBeNull();
  });
});

describe('sell signals', () => {
  const day = i => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  const make = closes => closes.map((close, i) => ({ date: day(i), open: close, high: close * 1.005, low: close * 0.995, close, volume: 10000 }));
  const rising = (count, rate = 0.003) => Array.from({ length: count }, (_, i) => 50 * (1 + rate) ** i);

  it('flags a climax run after an advance and reports each check with its evidence', async () => {
    const { sellSignals } = await import('./briefModel');
    const closes = rising(200);
    for (let k = 0; k < 9; k++) closes.push(closes.at(-1) * 1.03);
    closes.push(closes.at(-1) * 1.05);
    const result = sellSignals(make(closes));
    const state = Object.fromEntries(result.strength.map(c => [c.key, c.state]));
    expect(state).toEqual({ 'day-up': 'hit', 'week-up': 'hit', 'up-days': 'hit', climax: 'hit' });
    expect(result.weakness.map(c => c.state)).toEqual(['clear', 'clear']);
    expect(result.hits).toBe(4);
    expect(result.advance.gainPct).toBeGreaterThan(30);
    const { sellMarks } = await import('./briefModel');
    expect(sellMarks(result)).toEqual([{ date: result.strength[0].date, kind: 'strength' }]);
    expect(sellMarks(null)).toEqual([]);
  });

  it('flags a heavy-volume break of the 50-day line, and leaves it unknown without volume', async () => {
    const { sellSignals } = await import('./briefModel');
    const closes = rising(200);
    closes.push(closes.at(-1) * 0.9);
    const bars = make(closes);
    bars.at(-1).volume = 20000;
    const result = sellSignals(bars);
    expect(result.weakness.map(c => [c.key, c.state])).toEqual([['day-down', 'hit'], ['ma50', 'hit']]);
    expect(result.weakness[1].detail).toContain('2.00×');
    bars.at(-1).volume = 13000;
    expect(sellSignals(bars).weakness[1].state).toBe('clear');
    bars.at(-1).volume = undefined;
    expect(sellSignals(bars).weakness[1].state).toBe('unknown');
  });

  it('judges a heavy-volume 50-day break on short histories too', async () => {
    const { sellSignals } = await import('./briefModel');
    const closes = rising(98);
    closes.push(closes.at(-1) * 0.9, closes.at(-1) * 0.9, closes.at(-1) * 0.9);
    const bars = make(closes);
    bars.at(-3).volume = 30000;
    expect(bars).toHaveLength(101);
    expect(sellSignals(bars).weakness.find(c => c.key === 'ma50').state).toBe('hit');
  });

  it('does not judge strength without an advance and refuses short or broken bars', async () => {
    const { sellSignals } = await import('./briefModel');
    const flat = make(Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 4)));
    const result = sellSignals(flat);
    expect(result.advance).toBeNull();
    expect(result.strength.every(c => c.state === 'na')).toBe(true);
    expect(sellSignals(make(rising(59)))).toBeNull();
    const broken = make(rising(120)); broken[50].close = null;
    expect(sellSignals(broken)).toBeNull();
  });
});

describe('book combined warning', () => {
  it('maps the shared diagnostics to a check and never turns a missing input into clear', async () => {
    const { bookWarningCheck, withBookWarning } = await import('./briefModel');
    const warn = over => ({ valid: true, priceWarnings: { below20: true, threeLowerLows: true, currentVolumeRatio: 1.6, combinedWarning: true, recoveryInUpperHalf: false, ...over } });
    expect(bookWarningCheck(warn()).state).toBe('hit');
    expect(bookWarningCheck(warn()).detail).toBe('20日線割れ・3日連続の安値切り下げ あり・出来高 1.60×');
    expect(bookWarningCheck(warn({ recoveryInUpperHalf: true })).detail).toContain('買い支え');
    expect(bookWarningCheck(warn({ combinedWarning: false, threeLowerLows: false })).state).toBe('clear');
    expect(bookWarningCheck(warn({ combinedWarning: null, currentVolumeRatio: null })).state).toBe('unknown');
    expect(bookWarningCheck({ valid: false }).state).toBe('unknown');
    expect(bookWarningCheck(null).state).toBe('unknown');
    const merged = withBookWarning({ strength: [], weakness: [{ key: 'ma50', state: 'clear' }], hits: 0 }, warn());
    expect(merged.weakness.map(c => c.key)).toEqual(['ma50', 'book']);
    expect(merged.hits).toBe(1);
    expect(withBookWarning(null, warn())).toBeNull();
  });
});

describe('leading groups', () => {
  it('counts qualified stocks per industry group, falls back to sector, and needs two per group', async () => {
    const { leadingGroups } = await import('./briefModel');
    const item = (group, sector, qualified = true) => ({ row: { ibd_industry_group: group, gics_sector: sector }, assessment: { qualified } });
    const ranked = [item('Semis', 'Tech'), item('Semis', 'Tech'), item('Semis', 'Tech'), item('Software', 'Tech'), item('Software', 'Tech'), item('Banks', 'Fin'), item('Semis', 'Tech', false)];
    expect(leadingGroups(ranked)).toEqual({ kind: '業種', groups: [{ name: 'Semis', count: 3 }, { name: 'Software', count: 2 }], total: 6, unnamed: 0 });
    const sectors = ranked.map(i => ({ ...i, row: { gics_sector: i.row.gics_sector } }));
    expect(leadingGroups(sectors).kind).toBe('セクター');
    expect(leadingGroups(sectors).groups[0]).toEqual({ name: 'Tech', count: 5 });
    expect(leadingGroups([item(null, null)])).toBeNull();
    expect(leadingGroups([])).toBeNull();
  });
});

describe('up/down volume', () => {
  it('divides up-day volume by down-day volume and stays unknown on gaps', async () => {
    const { upDownVolume } = await import('./briefModel');
    const bars = Array.from({ length: 51 }, (_, i) => ({ close: 100 + (i % 2 ? 1 : 0), volume: i % 2 ? 300 : 100 }));
    expect(upDownVolume(bars).ratio).toBeCloseTo(300 * 25 / (100 * 25));
    expect(upDownVolume(bars.slice(1))).toBeNull();
    const gap = bars.map((b, i) => (i === 30 ? { ...b, volume: null } : b));
    expect(upDownVolume(gap)).toBeNull();
  });
});

describe('market tone', () => {
  it('maps the shared verdict to a tone and keeps unknown neutral', async () => {
    const { marketTone } = await import('./briefModel');
    expect(marketTone(null)).toBe('neutral');
    expect(marketTone({ state: 'unknown', label: '市場未確認' })).toBe('neutral');
    expect(marketTone({ label: '上昇トレンド（独自判定）' })).toBe('zone');
    expect(marketTone({ label: '上昇トレンド・圧力（独自判定）' })).toBe('zone');
    expect(marketTone({ label: '調整局面' })).toBe('neg');
    expect(marketTone({ label: '50日線割れ（弱含み・独自判定）', cap: 0 })).toBe('neg');
    expect(marketTone({ label: '市場条件未確認', cap: 0, state: 'unknown' })).toBe('neutral');
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

  it('takes the distribution count from latest, then lastObserved, then the last finite point', async () => {
    const { distributionCount } = await import('./briefModel');
    expect(distributionCount({ latest: { date: '2026-10-02', value: 3 }, lastObserved: { date: '2026-10-02', value: 3 } })).toEqual({ date: '2026-10-02', value: 3 });
    expect(distributionCount({ latest: null, historical: true, lastObserved: { date: '2026-10-01', value: 4 } })).toEqual({ date: '2026-10-01', value: 4 });
    expect(distributionCount({ latest: null, historical: true, points: [{ date: '2026-09-30', value: 2 }, { date: '2026-10-01', value: null }] })).toEqual({ date: '2026-09-30', value: 2 });
    expect(distributionCount({ available: false, points: [], reason: 'x' })).toBeNull();
    expect(distributionCount(undefined)).toBeNull();
  });

  it('tells loading, an integrity failure and an unpublished asset apart', async () => {
    const { trendsStatus } = await import('./briefModel');
    expect(trendsStatus({ loading: true })).toEqual({ state: 'loading', reason: null });
    expect(trendsStatus({ error: true, failureReason: new Error('SHA-256 が一致しません') })).toEqual({ state: 'error', kind: 'reader', reason: 'SHA-256 が一致しません', tile: '整合性エラー' });
    expect(trendsStatus({ error: true })).toMatchObject({ kind: 'integrity', reason: '公開データの参照情報が一致しません' });
    expect(trendsStatus({ data: undefined }).state).toBe('none');
    expect(trendsStatus(undefined).state).toBe('none');
    expect(trendsStatus({ data: { indices: [] } }).state).toBe('ready');
    const { sentence } = await import('./briefModel');
    expect(sentence('長期市場履歴を表示しません（検証項目: universe）。')).toBe('長期市場履歴を表示しません（検証項目: universe）。');
  });

  it('names why the market series failed in Japanese, never with a raw message, path or hash', async () => {
    const { trendsStatus, trendsAlert, bare, sentence } = await import('./briefModel');
    const hex = 'a'.repeat(64), status = reason => trendsStatus({ error: true, failureReason: reason });
    const cases = [
      [new Error(`Failed to load static data: market-trends/series-${hex}.json (404)`), 'fetch', '配信エラー', '市場推移データを取得できません（配信ファイルが見つかりません）。'],
      [new Error('Transport HTTP failure: 503'), 'fetch', '配信エラー', '市場推移データを取得できません（配信サーバーの応答 503）。'],
      [new TypeError('Failed to fetch'), 'fetch', '通信エラー', '市場推移データを取得できません（通信エラー）。'],
      [new TypeError('NetworkError when attempting to fetch resource.'), 'fetch', '通信エラー', '市場推移データを取得できません（通信エラー）。'],
      [new TypeError('Load failed'), 'fetch', '通信エラー', '市場推移データを取得できません（通信エラー）。'],
      [new Error('Static asset integrity mismatch'), 'integrity', '整合性エラー', '市場推移データの整合性を確認できません。'],
      [new Error('Transport decoded SHA-256 mismatch'), 'integrity', '整合性エラー', '市場推移データの整合性を確認できません。'],
      // A reader sentence is shown as it is, never as 「（…。）。」.
      [new Error('市場推移の基準日が一致しません。'), 'reader', '整合性エラー', '市場推移の基準日が一致しません。'],
    ];
    for (const [reason, kind, tile, alert] of cases) {
      const value = status(reason);
      expect(value).toMatchObject({ state: 'error', kind, tile });
      expect(trendsAlert(value)).toBe(alert);
      expect(trendsAlert(value)).not.toMatch(/[A-Za-z]{3}|[a-f0-9]{16}|。）/);
    }
    // A failed manifest is a fetch failure: whether market data was published is unknown.
    expect(trendsStatus({ error: true, failureKind: 'manifest' })).toMatchObject({ state: 'error', kind: 'fetch', reason: '公開情報を読み込めません' });
    expect(trendsAlert(trendsStatus({ error: true }))).toBe('市場推移データの整合性を確認できません（公開データの参照情報が一致しません）。');
    expect(bare('一致しません。')).toBe('一致しません');
    expect(sentence('長期市場履歴: universe')).toBe('長期市場履歴: universe。');
  });

  it('words every follow-through state compactly and dates an older judgement', async () => {
    const { followThroughView } = await import('./briefModel');
    const base = { available: true, method: 'rally-attempt-gain1.2-day4-15-decline6-v1', asOf: '2026-10-02', peak: { date: '2026-09-10', close: 100 }, low: { date: '2026-09-29', low: 90 }, declinePct: 7.24, attempt: { startDate: '2026-09-30', day: 3 }, ftd: null, failedDate: null, events: [] };
    const view = (over, date = '2026-10-02') => followThroughView({ ...base, ...over }, date);
    expect(view({ state: 'confirmed', ftd: { date: '2026-08-07', attemptDay: 4, gainPct: 1.43, volumeRatio: 1.2, sessionsSince: 40, distributionSince: 2 } })).toMatchObject({ b: '確認 8/7', em: '+1.4%・反発4日目・FTD後の有効な分配日2', asOf: null });
    expect(view({ state: 'rally_attempt' })).toMatchObject({ b: '反発3日目', em: '安値9/29・4日目以降の+1.2%上昇待ち' });
    expect(view({ state: 'correction', attempt: null })).toMatchObject({ b: '調整中', em: '高値9/10から−7.2%' });
    expect(view({ state: 'attempt_expired', attempt: { startDate: '2026-09-01', day: 17 } })).toMatchObject({ b: '15日以内のFTDなし', em: '安値9/29を維持・反発17日目' });
    expect(view({ state: 'ftd_failed', failedDate: '2026-10-01', ftd: { date: '2026-09-25', attemptDay: 5, gainPct: 1.6 } })).toMatchObject({ b: 'FTD失敗 10/1', em: '9/25のFTD当日の安値を終値で下回る' });
    expect(view({ state: 'no_correction', declinePct: 3.42, low: null, attempt: null })).toMatchObject({ b: '不要', em: '安値日の終値で高値から−3.4%（6%未満）' });
    // 5.96% (^IXIC on the 10-23 seed) must not read −6.0% beside 「6%未満」.
    expect(view({ state: 'no_correction', declinePct: 5.96, low: null, attempt: null })).toMatchObject({ em: '安値日の終値で高値から−5.96%（6%未満）' });
    expect(view({ state: 'no_correction', declinePct: 5.9599, low: null, attempt: null })).toMatchObject({ em: '安値日の終値で高値から−5.96%（6%未満）' });
    expect(view({ state: 'no_correction', declinePct: 5.999, low: null, attempt: null })).toMatchObject({ em: '安値日の終値で高値から−5.99%（6%未満）' });
    expect(view({ state: 'correction', declinePct: 6.04 }).em).toMatch(/−6\.0%$/);
    // Backend formula: the lowest-low session closes 5.8% under 103 while the latest close is 6.8% under it.
    // The tile names that basis instead of claiming today's close is within 6%.
    const { followThroughDay } = await import('../followThroughDay');
    const bars = [100, 101, 102, 103, [97, 95.5], [96, 95.8]].map((step, i) => { const [close, low = close * 0.998] = [].concat(step); return { date: `2026-01-0${i + 1}`, open: close, high: close * 1.002, low, close, volume: 1000 }; });
    const parity = followThroughDay({ symbol: '^GSPC', bars, asOfDate: '2026-01-06' });
    expect(parity).toMatchObject({ state: 'no_correction', declinePct: expect.closeTo(100 * 6 / 103, 9) });
    expect(followThroughView(parity, '2026-01-06')).toMatchObject({ b: '不要', em: '安値日の終値で高値から−5.8%（6%未満）' });
    // A peak on the window's first bar never reads as "no FTD needed".
    expect(view({ state: 'no_correction', declinePct: 4.5, attempt: null, peakAtWindowStart: true })).toMatchObject({ b: '判定保留', em: '集計期間の初日が高値・それ以前は期間外' });
    expect(view({ state: 'no_correction', declinePct: 4.5, attempt: null, peakAtWindowStart: false }).b).toBe('不要');
    expect(view({ state: 'confirmed', asOf: '2026-10-01', ftd: { date: '2026-08-07' } })).toMatchObject({ b: '確認 8/7', asOf: '10/1' });
    expect(followThroughView({ available: false, method: 'x', reason: '指数OHLCVに欠測・重複・不正値があります。' }, '2026-10-02')).toMatchObject({ b: '算出不可', em: '指数OHLCVに欠測・重複・不正値があります。' });
    expect(followThroughView(undefined, '2026-10-02')).toMatchObject({ b: '未集計', em: '旧形式の公開データ' });
    for (const state of ['confirmed', 'rally_attempt', 'correction', 'attempt_expired', 'ftd_failed', 'no_correction']) {
      const text = Object.values(view({ state, ftd: null, low: null, peak: null, attempt: null, declinePct: null, failedDate: null })).join(' ');
      expect(text).not.toMatch(/未確認|undefined|null|NaN/);
    }
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
