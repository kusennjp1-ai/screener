import { describe, expect, it } from 'vitest';
import { bookWarningCheck, HOLDING_CHIP, ma50Hit, sellChipView, sellMarks, sellSignals, SELL_RULES, stockSells, WEAKNESS_CHIP, withBookWarning } from './briefSell';

// Synthetic bars only: no test here leans on the browser fixture's last-bar jump.
const day = i => new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const make = (closes, volume = () => 10000) => closes.map((close, i) => ({ date: day(i), open: close, high: close * 1.005, low: close * 0.995, close, volume: volume(i) }));
const rising = (count, rate = 0.003) => Array.from({ length: count }, (_, i) => 50 * (1 + rate) ** i);
const states = checks => Object.fromEntries(checks.map(c => [c.key, c.state]));

describe('the 50-day line is a state, not an event', () => {
  // 200 rising sessions, then a 10% break and nine sessions under the line.
  const broken = (breakVolume, after = 8) => {
    const closes = rising(200), floor = closes.at(-1) * 0.9;
    closes.push(floor, ...Array.from({ length: after }, (_, k) => floor * (1 - 0.001 * k)));
    return make(closes, i => (i === 200 ? breakVolume : 10000));
  };

  it('a 2.2× break nine sessions ago that is still below the line is a hit, with its date, ratio and age', () => {
    const bars = broken(22000);
    const ma50 = sellSignals(bars).weakness.find(c => c.key === 'ma50');
    expect(ma50).toMatchObject({ state: 'hit', date: bars[200].date, sessions: 9 });
    expect(ma50.ratio).toBeCloseTo(2.2, 5);
    expect(ma50.detail).toBe(`${Number(bars[200].date.slice(5, 7))}/${Number(bars[200].date.slice(8))} に出来高 2.2倍で割れ、以降50日線の下（9営業日）`);
    // A sixth or ninth session never turns it back to clear, as the five-day event did.
    expect(sellSignals(bars).weaknessHits).toBeGreaterThanOrEqual(1);
    expect(ma50Hit(sellSignals(bars))).toEqual(ma50);
  });

  it('back above the line is clear', () => {
    const closes = broken(22000).map(b => b.close);
    for (let k = 0; k < 12; k++) closes.push(closes.at(-1) * 1.025);
    const ma50 = sellSignals(make(closes)).weakness.find(c => c.key === 'ma50');
    expect(ma50.state).toBe('clear');
    expect(ma50.detail).toMatch(/^終値は50日線から \+/);
  });

  it('a light break that is still below the line is a caution, never clear', () => {
    const ma50 = sellSignals(broken(12000)).weakness.find(c => c.key === 'ma50');
    expect(ma50.state).toBe('caution');
    expect(ma50.detail).toMatch(/^50日線の下（大商いの割れは未確認）・.* に出来高 1\.2倍で割れ、以降9営業日$/);
    expect(sellSignals(broken(12000))).toMatchObject({ weaknessHits: 0, cautions: 1 });
  });

  it('a missing volume on the break day (or before it) is unknown', () => {
    expect(sellSignals(broken(undefined)).weakness.find(c => c.key === 'ma50')).toMatchObject({ state: 'unknown' });
    const bars = broken(22000);
    bars[170].volume = null;
    expect(sellSignals(bars).weakness.find(c => c.key === 'ma50').state).toBe('unknown');
  });

  it('below the line with no close above it in the bars is a caution', () => {
    const falling = make(Array.from({ length: 120 }, (_, i) => 100 * 0.995 ** i));
    const ma50 = sellSignals(falling).weakness.find(c => c.key === 'ma50');
    expect(ma50.state).toBe('caution');
    expect(ma50.detail).toContain('50日線より上の終値なし');
  });

  it('judges a heavy break on short histories too', () => {
    const closes = rising(98);
    closes.push(closes.at(-1) * 0.9, closes.at(-1) * 0.9, closes.at(-1) * 0.9);
    const bars = make(closes, i => (i === 98 ? 30000 : 10000));
    expect(bars).toHaveLength(101);
    expect(sellSignals(bars).weakness.find(c => c.key === 'ma50').state).toBe('hit');
  });
});

describe('the strength (climax) checks judge only an extended stock', () => {
  it('a +6% breakout day at the pivot on 2.5× volume is not a sell signal', () => {
    const closes = rising(200);
    const pivot = closes.at(-1) * 1.02;
    closes.push(closes.at(-1) * 1.06);
    const bars = make(closes, i => (i === 200 ? 25000 : 10000));
    const view = { state: 'zone', pivot, distance: (closes.at(-1) / pivot - 1) * 100 };
    const result = sellSignals(bars, SELL_RULES, { view });
    expect(Object.values(states(result.strength))).toEqual(['na', 'na', 'na', 'na']);
    expect(result.strength[0].detail).toMatch(/^ブレイク後の上昇が小さいため判定しません/);
    expect(result).toMatchObject({ hits: 0, strengthHits: 0, run: null });
    expect(stockSells({ judged: bars, diagnostics: null, view }).hits).toBe(0);
  });

  it('is always na in the buy zone, below the pivot, below +20% and without a position', () => {
    const closes = rising(200);
    for (let k = 0; k < 9; k++) closes.push(closes.at(-1) * 1.03);
    closes.push(closes.at(-1) * 1.05);
    const bars = make(closes), last = closes.at(-1);
    for (const view of [{ state: 'zone', pivot: last / 1.03, distance: 3 }, { state: 'wait', pivot: last * 1.02, distance: -2 },
      { state: 'ext', pivot: last / 1.15, distance: 15 }, { state: 'unknown', pivot: null, distance: null }, null]) {
      const result = sellSignals(bars, SELL_RULES, { view });
      expect(result.strength.map(c => c.state)).toEqual(['na', 'na', 'na', 'na']);
      expect(result.strengthHits).toBe(0);
    }
    expect(sellSignals(bars, SELL_RULES, { view: { state: 'wait', pivot: last * 1.02, distance: -2 } }).strength[0].detail).toBe('ピボットより下（ブレイク前）のため判定しません');
    expect(sellSignals(bars, SELL_RULES, { view: { state: 'ext', pivot: last / 1.15, distance: 15 } }).strength[0].detail).toContain(`+${SELL_RULES.climaxFromPivotPercent}%以上`);
  });

  it('evaluates an extended stock at +25% or more from the start of its run above the pivot', () => {
    const closes = rising(200);
    const pivot = closes.at(-1);
    for (let k = 0; k < 9; k++) closes.push(closes.at(-1) * 1.03);
    closes.push(closes.at(-1) * 1.05);
    const view = { state: 'ext', pivot, distance: (closes.at(-1) / pivot - 1) * 100 };
    expect(view.distance).toBeGreaterThan(25);
    const result = sellSignals(make(closes), SELL_RULES, { view });
    expect(states(result.strength)).toEqual({ 'day-up': 'hit', 'week-up': 'hit', 'up-days': 'hit', climax: 'hit' });
    expect(result.run).toMatchObject({ startDate: day(200), pivot, sessions: 9 });
    expect(states(result.weakness)).toEqual({ 'day-down': 'clear', ma50: 'clear' });
    expect(result).toMatchObject({ hits: 4, strengthHits: 4, weaknessHits: 0 });
    expect(sellMarks(result)).toEqual([{ date: result.strength[0].date, kind: 'strength' }]);
    expect(sellMarks(null)).toEqual([]);
  });

  it('does not judge the advance\'s fall without an advance, and refuses short or broken bars', () => {
    const flat = make(Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 4)));
    const result = sellSignals(flat);
    expect(result.advance).toBeNull();
    expect(result.weakness.find(c => c.key === 'day-down').state).toBe('na');
    expect(sellSignals(make(rising(59)))).toBeNull();
    const broken = make(rising(120)); broken[50].close = null;
    expect(sellSignals(broken)).toBeNull();
  });
});

describe('book combined warning', () => {
  it('maps the shared diagnostics to a check and never turns a missing input into clear', () => {
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
    expect(merged).toMatchObject({ hits: 1, weaknessHits: 1, strengthHits: 0 });
    expect(withBookWarning(null, warn())).toBeNull();
  });
});

// Seams E owns and other tracks call (the stock view shell, BriefParts' rows, the conclusion).
describe('briefSell seams', () => {
  const warn = { valid: true, as_of_date: '2025-07-19', priceWarnings: { below20: true, threeLowerLows: true, currentVolumeRatio: 1.6, combinedWarning: true, recoveryInUpperHalf: false } };
  const result = over => ({ strength: [{ key: 'climax', label: '急騰', state: 'clear' }], weakness: [{ key: 'ma50', label: '50日線', state: 'clear', detail: '' }], hits: 0, strengthHits: 0, weaknessHits: 0, ...over });

  it('sellChipView: weakness first (never only a sell count), a climax alone as a holding\'s signal, a caution, unknown with the limit as text', () => {
    expect(sellChipView(result({ weakness: [{ key: 'ma50', label: '50日線割れ', state: 'hit' }, { key: 'book', label: '複合警告', state: 'hit' }], hits: 2, weaknessHits: 2 })))
      .toEqual({ text: WEAKNESS_CHIP, tone: 'ext', title: '50日線割れ・複合警告' });
    expect(WEAKNESS_CHIP).toBe('買いの前提が崩れた／保有なら売りのサイン（独自判定）');
    expect(sellChipView(result({ strength: [{ key: 'climax', label: '急騰', state: 'hit' }], hits: 1, strengthHits: 1 }))).toEqual({ text: HOLDING_CHIP, tone: '', title: '急騰' });
    expect(HOLDING_CHIP).toBe('保有している場合の売りのサイン（保有未登録）');
    expect(sellChipView(result({ weakness: [{ key: 'ma50', label: '50日線', state: 'caution', detail: '50日線の下（大商いの割れは未確認）・…' }] })))
      .toEqual({ text: '50日線の下（大商いの割れは未確認）', tone: 'wait', title: '50日線の下（大商いの割れは未確認）・…' });
    expect(sellChipView({ unknown: true, reason: '日足を取得できません' })).toEqual({ text: '売りのサイン 未確認', tone: '', title: '日足を取得できません' });
    expect(sellChipView({ unknown: true })).toEqual({ text: '売りのサイン 未確認', tone: '', title: undefined });
    expect(sellChipView({ unknown: true, limit: 12, reason: '確認は先頭12銘柄まで' })).toEqual({ text: '売りのサイン 未確認（上限12銘柄）', tone: '', title: '確認は先頭12銘柄まで' });
    // A result without the strength/weakness split (an older shape) keeps the step-0 chip.
    expect(sellChipView({ hits: 3 })).toEqual({ text: '売りのサイン 3件', tone: 'ext', title: undefined });
    for (const value of [null, undefined, { hits: 0 }, result()]) expect(sellChipView(value)).toBeNull();
  });

  it('stockSells is the bars\' checks (gated by the view) plus the book warning, and null without judged bars', () => {
    const closes = rising(200);
    closes.push(closes.at(-1) * 0.9);
    const bars = make(closes, i => (i === 200 ? 20000 : 10000));
    const view = { symbol: 'AAA', state: 'wait', distance: -3, pivot: closes.at(-1) * 1.03 };
    for (const diagnostics of [null, warn, { valid: false }]) expect(stockSells({ judged: bars, diagnostics, view })).toEqual(withBookWarning(sellSignals(bars, SELL_RULES, { view }), diagnostics));
    expect(stockSells({ judged: bars, diagnostics: warn, view })).toMatchObject({ weaknessHits: 3, strengthHits: 0 });
    expect(stockSells({ judged: null, diagnostics: warn, view })).toBeNull();
    expect(stockSells({ judged: make(closes.slice(0, 59)), diagnostics: null, view })).toBeNull();
  });
});
