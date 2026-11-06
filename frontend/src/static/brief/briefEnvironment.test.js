import { describe, expect, it } from 'vitest';
import { environmentRules, environmentWarnings } from './briefEnvironment';

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

describe('leading groups', () => {
  it('counts qualified stocks per industry group, falls back to sector, and needs two per group', async () => {
    const { leadingGroups } = await import('./briefEnvironment');
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

describe('market tone', () => {
  it('maps the shared verdict to a tone and keeps unknown neutral', async () => {
    const { marketTone } = await import('./briefEnvironment');
    expect(marketTone(null)).toBe('neutral');
    expect(marketTone({ state: 'unknown', label: '市場未確認' })).toBe('neutral');
    expect(marketTone({ label: '上昇トレンド（独自判定）' })).toBe('zone');
    expect(marketTone({ label: '上昇トレンド・圧力（独自判定）' })).toBe('zone');
    expect(marketTone({ label: '調整局面' })).toBe('neg');
    expect(marketTone({ label: '50日線割れ（弱含み・独自判定）', cap: 0 })).toBe('neg');
    expect(marketTone({ label: '市場条件未確認', cap: 0, state: 'unknown' })).toBe('neutral');
  });
});

// The round-2 seam Today's 地合い tile calls (plan §2.2, MK11): at most one suffix of at most 7 full-width characters.
describe('market tile suffix', () => {
  const DATE = '2026-10-02';
  const OPEN = { label: '上昇トレンド（独自判定）', cap: 0.5, regime: 'confirmed_uptrend', ftdUpgraded: false };
  const ftd = (state, asOf = DATE) => ({ available: true, method: 'm', asOf, state });
  const ready = (nas, extra = {}) => ({ data: { as_of_date: DATE, indices: [{ symbol: '^GSPC', followThrough: ftd('confirmed') }, { symbol: '^IXIC', followThrough: nas }], ...extra } });
  const manifest = { as_of_date: DATE, markets: { US: { as_of_date: DATE } } };

  it('says FTD確認済み while the guide is 0% under an FTD-upgraded uptrend, before anything else', async () => {
    const { marketTileSuffix, MARKET_TILE_SUFFIX } = await import('./briefEnvironment');
    const upgraded = { label: '50日線割れ（弱含み・独自判定）', cap: 0, regime: 'confirmed_uptrend', ftdUpgraded: true };
    expect(marketTileSuffix({ market: upgraded, trends: ready(ftd('correction')), manifest })).toBe('FTD確認済み');
    // It needs no market-trends data: the verdict's rows carry the regime.
    expect(marketTileSuffix({ market: upgraded, trends: { loading: true }, manifest: null })).toBe('FTD確認済み');
    expect(marketTileSuffix({ market: { ...upgraded, label: '長期トレンド警戒' }, trends: null })).toBe(MARKET_TILE_SUFFIX.ftd);
    // A 0% guide that is not an FTD upgrade has no suffix.
    expect(marketTileSuffix({ market: { label: '50日線割れ（弱含み・独自判定）', cap: 0, regime: 'correction', ftdUpgraded: false }, trends: ready(ftd('correction')), manifest })).toBeNull();
  });

  it('says NAS調整中 while the guide is open and the Nasdaq is in correction, on a rally attempt or after a failed FTD, judged today', async () => {
    const { marketTileSuffix } = await import('./briefEnvironment');
    for (const state of ['correction', 'rally_attempt', 'ftd_failed']) expect(marketTileSuffix({ market: OPEN, trends: ready(ftd(state)), manifest })).toBe('NAS調整中');
    expect(marketTileSuffix({ market: { ...OPEN, label: '上昇に圧力（独自判定）', cap: 0.25, regime: 'uptrend_under_pressure' }, trends: ready(ftd('correction')), manifest })).toBe('NAS調整中');
    for (const state of ['confirmed', 'no_correction', 'attempt_expired']) expect(marketTileSuffix({ market: OPEN, trends: ready(ftd(state)), manifest })).toBeNull();
    // An older Nasdaq state (a series one session behind) is never shown as today's; an unknown one says nothing.
    expect(marketTileSuffix({ market: OPEN, trends: ready(ftd('correction', '2026-10-01')), manifest })).toBeNull();
    expect(marketTileSuffix({ market: OPEN, trends: ready({ available: false, reason: 'x' }), manifest })).toBeNull();
    expect(marketTileSuffix({ market: OPEN, trends: ready(undefined), manifest })).toBeNull();
    // A manifest of another date, a series still loading or failed, or no verdict: none.
    expect(marketTileSuffix({ market: OPEN, trends: ready(ftd('correction')), manifest: { markets: { US: { as_of_date: '2026-10-01' } } } })).toBeNull();
    expect(marketTileSuffix({ market: OPEN, trends: { loading: true }, manifest })).toBeNull();
    expect(marketTileSuffix({ market: OPEN, trends: { error: true, failureReason: new Error('x') }, manifest })).toBeNull();
    expect(marketTileSuffix({ market: null, trends: ready(ftd('correction')), manifest })).toBeNull();
    expect(marketTileSuffix({ market: { label: '市場未確認', cap: 0, state: 'unknown' }, trends: ready(ftd('correction')), manifest })).toBeNull();
    expect(marketTileSuffix()).toBeNull();
    expect(marketTileSuffix({})).toBeNull();
  });

  it('keeps every suffix within 7 full-width characters (a half-width letter counts as half)', async () => {
    const { MARKET_TILE_SUFFIX } = await import('./briefEnvironment');
    const width = text => [...text].reduce((sum, ch) => sum + (/[\x20-\x7e]/.test(ch) ? 0.5 : 1), 0);
    for (const text of Object.values(MARKET_TILE_SUFFIX)) expect(width(text)).toBeLessThanOrEqual(7);
  });

  it('names the Nasdaq correction by one condition, shared with the market tab\'s note', async () => {
    const { nasdaqInCorrection, NASDAQ_CAUTION_STATES } = await import('./briefEnvironment');
    expect(NASDAQ_CAUTION_STATES).toEqual(['correction', 'rally_attempt', 'ftd_failed']);
    expect(['correction', 'rally_attempt', 'ftd_failed', 'confirmed', 'no_correction', 'attempt_expired'].map(state => nasdaqInCorrection({ available: true, state }))).toEqual([true, true, true, false, false, false]);
    expect([nasdaqInCorrection({ available: false, state: 'correction' }), nasdaqInCorrection(undefined), nasdaqInCorrection(null)]).toEqual([false, false, false]);
  });
});

describe('market tab helpers', () => {
  it('takes the distribution count from latest, then lastObserved, then the last finite point', async () => {
    const { distributionCount } = await import('./briefEnvironment');
    expect(distributionCount({ latest: { date: '2026-10-02', value: 3 }, lastObserved: { date: '2026-10-02', value: 3 } })).toEqual({ date: '2026-10-02', value: 3 });
    expect(distributionCount({ latest: null, historical: true, lastObserved: { date: '2026-10-01', value: 4 } })).toEqual({ date: '2026-10-01', value: 4 });
    expect(distributionCount({ latest: null, historical: true, points: [{ date: '2026-09-30', value: 2 }, { date: '2026-10-01', value: null }] })).toEqual({ date: '2026-09-30', value: 2 });
    expect(distributionCount({ available: false, points: [], reason: 'x' })).toBeNull();
    expect(distributionCount(undefined)).toBeNull();
  });

  it('tells loading, an integrity failure and an unpublished asset apart', async () => {
    const { trendsStatus } = await import('./briefEnvironment');
    expect(trendsStatus({ loading: true })).toEqual({ state: 'loading', reason: null });
    expect(trendsStatus({ error: true, failureReason: new Error('SHA-256 が一致しません') })).toEqual({ state: 'error', kind: 'reader', reason: 'SHA-256 が一致しません', tile: '整合性エラー' });
    expect(trendsStatus({ error: true })).toMatchObject({ kind: 'integrity', reason: '公開データの参照情報が一致しません' });
    expect(trendsStatus({ data: undefined }).state).toBe('none');
    expect(trendsStatus(undefined).state).toBe('none');
    expect(trendsStatus({ data: { indices: [] } }).state).toBe('ready');
    const { sentence } = await import('./briefShared');
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
    const { followThroughView } = await import('./briefEnvironment');
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
    // A confirmed FTD is never drawn green (no 'zone' tone): the 1990-2026 study found no established edge for it.
    // Only a failed FTD carries a tone (the amber warning).
    for (const state of ['confirmed', 'rally_attempt', 'correction', 'attempt_expired', 'no_correction']) expect([state, view({ state, ftd: { date: '2026-08-07' } }).tone]).toEqual([state, undefined]);
    expect(view({ state: 'ftd_failed', failedDate: '2026-10-01', ftd: { date: '2026-09-25' } }).tone).toBe('ext');
    expect(followThroughView({ available: false, method: 'x', reason: '指数OHLCVに欠測・重複・不正値があります。' }, '2026-10-02')).toMatchObject({ b: '算出不可', em: '指数OHLCVに欠測・重複・不正値があります。' });
    expect(followThroughView(undefined, '2026-10-02')).toMatchObject({ b: '未集計', em: '旧形式の公開データ' });
    for (const state of ['confirmed', 'rally_attempt', 'correction', 'attempt_expired', 'ftd_failed', 'no_correction']) {
      const text = Object.values(view({ state, ftd: null, low: null, peak: null, attempt: null, declinePct: null, failedDate: null })).join(' ');
      expect(text).not.toMatch(/未確認|undefined|null|NaN/);
    }
  });
});
