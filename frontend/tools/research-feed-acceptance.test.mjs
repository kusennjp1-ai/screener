import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkResearchFeedMetrics, checkFeedDetailConsistency, checkDetailSourceEvidence, checkFeedDecisionEvidence, parseResearchCsv, FEED_REVIEW_VIEWPORTS, FEED_REVIEW_METHODS } from './research-feed-acceptance.mjs';

const observed = text => ({ text, shown: true, firstViewport: true, rect: { top: 100, bottom: 200 } });
const metric = id => ({ id, state: 'unknown', actual: observed('未確認'), status: observed('? 未確認'), role: observed('参考'), condition: observed('選定の数値条件なし・参考'), period: observed('決算期 未確認'), source: observed('提供元 未確認 · 取得日 未確認') });
const decisions = () => ({ selection: { ...observed('選定条件 9/9 未達 0 · 未確認 0'), passed: 9, total: 9, failed: 0, unknown: 0, state: 'pass' }, daily: { ...observed('日次確認 5/7 未達1・未確認1'), passed: 5, total: 7, failed: 1, unknown: 1, state: 'fail' }, price: observed('価格位置 買いゾーン内'), annual: null });
const fixture = () => ({ horizontalOverflow: false, methodId: 'minervini', overviewScope: observed('全体概況 · ミネルヴィニ'), feed: { decisions: decisions(), symbol: 'TEST', metrics: ['eps_growth_yy', 'sales_growth_yy'].map(metric), next: observed('出来高：未達。1.4倍以上を確認'), other: observed('ほかの未達・未確認：決算予定：未確認'), traceUnavailable: observed('価格推移 未確認') },
  detail: { decisions: decisions(), symbol: 'TEST', metrics: ['eps_growth_yy', 'sales_growth_yy', 'annual_eps_growth_3y'].map(id => ({ ...metric(id), source: observed('提供元 未確認 · 取得時刻 未確認'), basis: observed('指標の種類 未確認 · 計算基準 未確認'), notes: [] })), summary: observed('財務'), chart: { ...observed('チャート'), rect: { top: 201, bottom: 640 } }, evidenceBeforeChart: true, entry: observed('次に確認すること'), blockers: [{ ...observed('× 未達 · 出来高'), label: '出来高', state: 'fail' }, { ...observed('? 未確認 · 決算予定'), label: '決算予定', state: 'unknown' }] } });
const failuresFor = (metrics, options) => {
  const failures = [];
  checkResearchFeedMetrics(metrics, (passes, message) => { if (!passes) failures.push(message); }, 'fixture', options);
  return failures;
};

describe('research feed task acceptance', () => {
  it('accepts explicit unknown evidence without manufacturing numbers or a pass', () => {
    expect(failuresFor(fixture())).toEqual([]);
    expect(failuresFor(fixture(), { surface: 'detail' })).toEqual([]);
  });
  it('rejects missing, hidden, occluded or offscreen first-card evidence independently', () => {
    for (const field of ['actual', 'status', 'role', 'condition']) {
      const data = fixture();
      data.feed.metrics[0][field].firstViewport = false;
      expect(failuresFor(data)).toContainEqual(expect.stringContaining(`eps_growth_yy ${field} is outside`));
    }
    const data = fixture(); data.feed.metrics[1].source.shown = false; data.feed.metrics[0].period.text = '';
    expect(failuresFor(data)).toHaveLength(2);
    data.feed.metrics = [];
    expect(failuresFor(data)).toContainEqual(expect.stringContaining('sales_growth_yy evidence is missing'));
  });
  it('rejects promoted unknowns, horizontal overflow and silently missing price traces', () => {
    const data = fixture(); data.feed.metrics[0].state = 'pass'; data.horizontalOverflow = true; data.feed.traceUnavailable = null;
    expect(failuresFor(data)).toHaveLength(3);
  });
  it('requires the full selected evidence before the chart without a compact-summary height cap', () => {
    const data = fixture(); data.detail.summary.rect.bottom = 1400; data.detail.chart.rect.top = 1401;
    expect(failuresFor(data, { surface: 'detail' })).toEqual([]);
    data.detail.chart.rect.top = 1399;
    expect(failuresFor(data, { surface: 'detail' })).toContainEqual(expect.stringContaining('complete financial evidence must precede'));
    data.detail.metrics.pop();
    expect(failuresFor(data, { surface: 'detail' })).toContainEqual(expect.stringContaining('annual_eps_growth_3y evidence is missing'));
  });
  it('requires all parallel blockers and exact same-symbol financial evidence', () => {
    const data = fixture(), failures = [], check = (pass, message) => { if (!pass) failures.push(message); };
    checkFeedDetailConsistency(data.feed, data.detail, check, 'fixture'); expect(failures).toEqual([]);
    data.feed.other = null; data.detail.symbol = 'OTHER'; data.detail.metrics[0].actual.text = '30%';
    checkFeedDetailConsistency(data.feed, data.detail, check, 'fixture');
    expect(failures).toHaveLength(4);
  });
  it('covers every method at real narrow and short viewports without changing performance viewports', () => {
    expect(FEED_REVIEW_METHODS).toEqual(['minervini', 'minervini2', 'oneil', 'ibd']);
    expect(FEED_REVIEW_VIEWPORTS).toEqual([{ width: 1440, height: 760 }, { width: 360, height: 844 }, { width: 360, height: 568 }]);
    const harness = readFileSync('tools/design-review.mjs', 'utf8');
    expect(harness).toContain("if (!process.env.CI) throw Error");
    expect(harness).toContain('const viewportSizes = [{ width: 1440, height: 900 }, { width: 390, height: 844 }]');
    expect(harness).toContain('metrics.candidate_median_ms <= 3500 && metrics.maximum_switch_ms <= 400 && metrics.longest_initial_task_ms <= 200');
    expect(harness).toContain('run.point_count === 207');
    expect(harness).toContain('run.first_frame_ms <= 50');
  });
});

describe('canonical decision hierarchy', () => {
  const required = () => ({ method: 'oneil', selection: { passed: 5, total: 8, unknown: 3, qualified: false }, annual: { required: true, state: 'unknown' } });
  const failuresForDecision = (data, expected) => {
    const failures = [];
    checkFeedDecisionEvidence(data.feed, expected, (pass, message) => { if (!pass) failures.push(message); }, 'fixture');
    return failures;
  };
  const requiredFixture = () => {
    const data = fixture();
    data.methodId = 'oneil';
    data.feed.decisions.selection = { ...observed('選定条件 5/8 未達 0 · 未確認 3'), passed: 5, total: 8, failed: 0, unknown: 3, state: 'unknown' };
    data.feed.decisions.annual = { ...observed('年次EPS 必須 未確認'), state: 'unknown', required: true };
    for (const metric of data.feed.metrics) Object.assign(metric, { state: 'pass', actual: observed('30%'), role: observed('必須') });
    return data;
  };
  it('requires annual uncertainty even when EPS and sales both pass', () => {
    const data = requiredFixture();
    expect(failuresForDecision(data, required())).toEqual([]);
    data.feed.decisions.annual.firstViewport = false;
    expect(failuresForDecision(data, required())).toEqual([expect.stringContaining('required annual uncertainty is missing')]);
    data.feed.decisions.annual = { ...observed('年次EPS 必須 通過'), state: 'pass' };
    expect(failuresForDecision(data, required())).toHaveLength(2);
  });
  it('rejects completion states or required annual evidence below the first fold', () => {
    const data = requiredFixture();
    expect(failuresFor(data)).toEqual([]);
    for (const name of ['selection', 'daily', 'annual']) data.feed.decisions[name].firstViewport = false;
    expect(failuresFor(data)).toEqual(expect.arrayContaining([
      expect.stringContaining('selection completion state is outside'), expect.stringContaining('daily completion state is outside'),
      expect.stringContaining('required annual EPS status is outside'),
    ]));
    data.feed.decisions.selection = null;
    expect(failuresFor(data)).toContainEqual(expect.stringContaining('named selection completion state is missing'));
  });
  it('rejects contradictory visible counts and card/detail completion drift', () => {
    const data = fixture(), failures = [];
    data.feed.decisions.daily.state = 'pass';
    expect(failuresFor(data)).toContainEqual(expect.stringContaining('daily completion state promotes'));
    data.detail.decisions.daily.unknown = 0;
    checkFeedDetailConsistency(data.feed, data.detail, (pass, message) => { if (!pass) failures.push(message); }, 'fixture');
    expect(failures).toEqual(expect.arrayContaining([expect.stringContaining('daily completion counts/state differ'), expect.stringContaining('named detail blockers')]));
  });
  it('keeps absent daily context explicitly unknown without inventing zero counts', () => {
    const data = fixture();
    data.feed.decisions.daily = { ...observed('日次確認 未確認 未達 — · 未確認 —'), passed: null, total: null, failed: null, unknown: null, state: 'unknown' };
    expect(failuresFor(data)).toEqual([]);
    Object.assign(data.feed.decisions.daily, { text: '日次確認 0/0 未達 0 · 未確認 0', passed: 0, total: 0, failed: 0, unknown: 0 });
    expect(failuresFor(data)).toContainEqual(expect.stringContaining('counts are incomplete or inconsistent'));
  });
  it('rejects promoted selection counts and a fabricated complete selection', () => {
    const data = requiredFixture();
    data.feed.decisions.selection = { ...observed('選定条件 8/8 通過'), passed: 8, total: 8, state: 'pass' };
    expect(failuresForDecision(data, required())).toHaveLength(2);
  });
  it('keeps unknown reference annual EPS outside both Minervini qualification gates', () => {
    const data = fixture();
    for (const method of ['minervini', 'minervini2']) {
      const expected = { method, selection: { passed: 9, total: 9, unknown: 0, qualified: true }, annual: { required: false, state: 'unknown' } };
      expect(failuresForDecision(data, expected)).toEqual([]);
      data.feed.decisions.annual = { ...observed('年次EPS 参考 未確認'), state: 'unknown' };
      expect(failuresForDecision(data, expected)).toEqual([]);
      data.feed.decisions.annual.text = '年次EPS 必須 未確認';
      expect(failuresForDecision(data, expected)).toEqual([expect.stringContaining('became a Minervini qualification gate')]);
      data.feed.decisions.annual = null;
    }
  });
});

describe('compact source badges and one-action full detail', () => {
  const canonical = () => ({ symbol: 'TEST', rows: ['eps_growth_yy', 'sales_growth_yy', 'annual_eps_growth_3y'].map(id => ({ id, state: 'unknown', actual: '未確認', source: '提供元 未確認', observedAt: '取得時刻 未確認', metric: '指標の種類 未確認', basis: '計算基準 未確認' })) });
  const failuresForSource = (data, expected = canonical()) => {
    const failures = [], check = (pass, message) => { if (!pass) failures.push(message); };
    checkFeedDetailConsistency(data.feed, data.detail, check, 'fixture');
    checkDetailSourceEvidence(data.detail, expected, check, 'fixture');
    return failures;
  };
  it('keeps explicit source/time absence and requires the full basis in detail', () => {
    expect(failuresForSource(fixture())).toEqual([]);
    const data = fixture(); data.detail.metrics[0].basis.shown = false;
    expect(failuresForSource(data)).toEqual([expect.stringContaining('metric/basis is missing')]);
  });
  it('does not use a pass/fail/unknown condition state as source freshness', () => {
    for (const state of ['pass', 'fail', 'unknown', 'reference']) {
      const data = fixture(), expected = canonical();
      Object.assign(expected.rows[0], { state, actual: '30%', source: 'yfinance', observedAt: '2026-10-03T12:34:00Z' });
      for (const surface of [data.feed, data.detail]) Object.assign(surface.metrics[0], { state, actual: observed('30%') });
      data.feed.metrics[0].source = observed('提供元あり · 取得 2026-10-03');
      data.detail.metrics[0].source = observed('yfinance · 取得 2026-10-03 12:34 UTC');
      expect(failuresForSource(data, expected)).toEqual([]);
    }
  });
  it('rejects a wrong compact date, provider substitution and lost timestamp precision', () => {
    const data = fixture(), expected = canonical();
    Object.assign(expected.rows[0], { source: 'yfinance', observedAt: '2026-10-03T12:34:56.123Z' });
    data.feed.metrics[0].source = observed('提供元あり · 取得 2026-10-03');
    data.detail.metrics[0].source = observed('yfinance · 取得 2026-10-03 12:34:56.123Z');
    expect(failuresForSource(data, expected)).toEqual([]);
    data.feed.metrics[0].source.text = '提供元あり · 取得 2026-10-02';
    data.detail.metrics[0].source.text = 'another provider · 取得 2026-10-03 12:34:00Z';
    expect(failuresForSource(data, expected)).toEqual(expect.arrayContaining([
      expect.stringContaining('compact source presence/date differs'),
      expect.stringContaining('full provider differs'), expect.stringContaining('full acquisition timestamp differs'),
    ]));
  });
  it('requires the visible full reference/calculation explanation even when the badge matches', () => {
    const data = fixture(), expected = canonical();
    Object.assign(expected.rows[0], { actual: '赤字縮小', referenceActual: '50%（比較期の絶対値を分母とした参考値）', calculationNote: '元の計算結果を小数第2位に丸めています。' });
    data.feed.metrics[0].actual = observed('赤字縮小'); data.detail.metrics[0].actual = observed('赤字縮小');
    data.detail.metrics[0].notes = [observed(`参考計算：${expected.rows[0].referenceActual}`), observed(expected.rows[0].calculationNote)];
    expect(failuresForSource(data, expected)).toEqual([]);
    data.detail.metrics[0].notes[0].text = '参考計算：50%';
    data.detail.metrics[0].notes[1].shown = false;
    expect(failuresForSource(data, expected)).toHaveLength(2);
  });
});

describe('research CSV observation', () => {
  it('preserves symbols, method and quoted content for downloaded state comparison', () => {
    expect(parseResearchCsv('\uFEFF"symbol","method","unknown_rules"\r\n"TEST","oneil","EPS, \"\"reference\"\"\nnext"')).toEqual([{ symbol: 'TEST', method: 'oneil', unknown_rules: 'EPS, "reference"\nnext' }]);
  });
  it('rejects absent identity columns and malformed quoted data', () => {
    expect(() => parseResearchCsv('value\n30')).toThrow('identity');
    expect(() => parseResearchCsv('"symbol","method"\n"TEST')).toThrow('Unterminated');
  });
});
