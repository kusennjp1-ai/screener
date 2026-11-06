import { describe, expect, it } from 'vitest';
import { bookWarningCheck, HOLDING_CHIP, HOLDING_ROW_CHIP, isBreakdown, ma50Hit, sellChipView, sellMarks, sellSignals, SELL_RULES, stockSells, WEAKNESS_CHIP, WEAKNESS_ROW_CHIP, withBookWarning } from './briefSell';

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
    const day = `${Number(bars[200].date.slice(5, 7))}/${Number(bars[200].date.slice(8))}`;
    expect(ma50.detail).toBe(`${day} に出来高 2.20×で割れ、以降50日線の下（9営業日）`);
    // The short form a watch row leads with.
    expect(ma50.headline).toBe(`50日線割れ（${day}・出来高2.20×）`);
    expect(ma50.label).toBe('出来高を伴う50日線割れ（1.40×以上）');
    // A sixth or ninth session never turns it back to clear, as the five-day event did.
    expect(sellSignals(bars).weaknessHits).toBeGreaterThanOrEqual(1);
    expect(ma50Hit(sellSignals(bars))).toEqual(ma50);
  });

  it('floors the ratio as every screen does: a break at 1.396× is a caution that reads 1.39×, never 1.4', () => {
    const ma50 = sellSignals(broken(13960)).weakness.find(c => c.key === 'ma50');
    expect(ma50.state).toBe('caution');
    expect(ma50.detail).toMatch(/に出来高 1\.39×で割れ/);
    expect(ma50.detail).not.toMatch(/1\.4/);
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
    expect(ma50.detail).toMatch(/^50日線の下（大商いの割れは未確認）・.* に出来高 1\.20×で割れ、以降9営業日$/);
    expect(sellSignals(broken(12000))).toMatchObject({ weaknessHits: 0, cautions: 1 });
  });

  it('a missing volume on the break day (or before it) is unknown', () => {
    expect(sellSignals(broken(undefined)).weakness.find(c => c.key === 'ma50')).toMatchObject({ state: 'unknown' });
    const bars = broken(22000);
    bars[170].volume = null;
    expect(sellSignals(bars).weakness.find(c => c.key === 'ma50').state).toBe('unknown');
    expect(sellSignals(bars)).toMatchObject({ weaknessHits: 0, breakdownHits: 0, unknowns: 1 });
  });

  it('a volume of 0 on the break day (or before it) is a gap in the data, never a 0.00× break', () => {
    const zero = sellSignals(broken(0)).weakness.find(c => c.key === 'ma50');
    expect(zero.state).toBe('unknown');
    expect(zero.detail).toContain('割れた日の出来高（または直前50日の出来高）が未取得');
    expect(zero.detail).not.toContain('0.00×');
    const bars = broken(22000);
    bars[180].volume = 0;
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

  it('is always na in the buy zone, below the pivot, below +20%, outside the zone states and without a position', () => {
    const closes = rising(200);
    for (let k = 0; k < 9; k++) closes.push(closes.at(-1) * 1.03);
    closes.push(closes.at(-1) * 1.05);
    const bars = make(closes), last = closes.at(-1);
    for (const view of [{ state: 'zone', pivot: last / 1.03, distance: 3 }, { state: 'wait', pivot: last * 1.02, distance: -2 },
      { state: 'ext', pivot: last / 1.15, distance: 15 }, { state: 'unknown', pivot: null, distance: null }, null,
      { state: 'low', stateLabel: '低変動・監視のみ', pivot: last / 1.3, distance: 30 }, { state: 'acq', stateLabel: '買収合意・対象外', pivot: last / 1.3, distance: 30 }, { state: 'na', pivot: last / 1.3, distance: 30 }]) {
      const result = sellSignals(bars, SELL_RULES, { view });
      expect(result.strength.map(c => c.state)).toEqual(['na', 'na', 'na', 'na']);
      expect(result.strengthHits).toBe(0);
    }
    const reason = view => sellSignals(bars, SELL_RULES, { view }).strength[0].detail;
    expect(reason({ state: 'wait', pivot: last * 1.02, distance: -2 })).toBe('ピボットより下（ブレイク前）のため判定しません');
    expect(reason({ state: 'ext', pivot: last / 1.15, distance: 15 })).toBe(`ブレイク後の上昇が小さいため判定しません（ピボット比 +15.0%・判定は +${SELL_RULES.climaxFromPivotPercent}%以上）`);
    // A position that is not beyond the buy zone never reads as a small rise, whatever its distance.
    expect(reason({ state: 'low', stateLabel: '低変動・監視のみ', pivot: last / 1.3, distance: 30 })).toBe('買いゾーン超過の銘柄ではないため判定しません（位置：低変動・監視のみ）');
    expect(reason({ state: 'na', pivot: last / 1.3, distance: 30 })).toBe('買いゾーン超過の銘柄ではないため判定しません（位置：判定不可）');
  });

  it('a fresh breakout is never a climax: +25% four sessions after it is four na with the reason', () => {
    // A 200-session base under a pivot of 100, then 108, 114, 119 and 125.
    const closes = Array.from({ length: 200 }, (_, i) => 95 + 4 * Math.sin(i / 5));
    closes.push(108, 114, 119, 125);
    const view = { state: 'ext', stateLabel: '買いゾーン超過', pivot: 100, distance: 25 };
    const result = sellSignals(make(closes), SELL_RULES, { view });
    expect(result.strength.map(c => c.state)).toEqual(['na', 'na', 'na', 'na']);
    for (const check of result.strength) expect(check.detail).toBe(`ピボット上抜けから3営業日のため判定しません（判定は上抜けから${SELL_RULES.climaxSessions}営業日以上・独自判定）`);
    expect(result).toMatchObject({ strengthHits: 0, run: null });
    expect(sellChipView(result)).toBeNull();
    // The breakout day itself says so too.
    const today = sellSignals(make([...closes.slice(0, 200), 125]), SELL_RULES, { view });
    expect(today.strength[0].detail).toBe(`ピボット上抜けの当日のため判定しません（判定は上抜けから${SELL_RULES.climaxSessions}営業日以上・独自判定）`);
  });

  it('evaluates an extended stock at +25% or more once its run above the pivot is 15 sessions old', () => {
    const closes = rising(200);
    const pivot = closes.at(-1);
    for (let k = 0; k < 10; k++) closes.push(closes.at(-1) * 1.008);
    for (let k = 0; k < 5; k++) closes.push(closes.at(-1) * 1.035);
    closes.push(closes.at(-1) * 1.06);
    const view = { state: 'ext', pivot, distance: (closes.at(-1) / pivot - 1) * 100 };
    expect(view.distance).toBeGreaterThan(25);
    const bars = make(closes), result = sellSignals(bars, SELL_RULES, { view });
    expect(states(result.strength)).toEqual({ 'day-up': 'hit', 'week-up': 'hit', 'up-days': 'hit', climax: 'hit' });
    expect(result.run).toMatchObject({ startDate: day(200), pivot, sessions: 15 });
    expect(result.strength.map(c => c.label)).toEqual(['ピボット上抜け以降で最大の1日の上昇（直近5営業日）', 'ピボット上抜け以降で最大の5営業日の上昇（直近5営業日）', '直近10営業日のうち8日以上が上昇', '15営業日以内に +25%以上の急騰']);
    // Short dates, as the 50-day check gives them.
    const short = i => `${Number(bars[i].date.slice(5, 7))}/${Number(bars[i].date.slice(8))}`;
    expect(result.strength[0].detail).toBe(`最大は ${short(215)} の +6.0%`);
    expect(result.strength[1].detail).toMatch(new RegExp(`^最大は ${short(215)} までの \\+`));
    expect(result.strength[3].detail).toMatch(/^直近15営業日（上抜け以降）の最安終値から \+/);
    expect(states(result.weakness)).toEqual({ 'day-down': 'clear', ma50: 'clear' });
    expect(result).toMatchObject({ hits: 4, strengthHits: 4, weaknessHits: 0, breakdownHits: 0, asOf: bars.at(-1).date });
    expect(sellMarks(result)).toEqual([{ date: result.strength[0].date, kind: 'strength' }]);
    expect(sellMarks(null)).toEqual([]);
  });

  it('counts only the sessions after the breakout toward the up days', () => {
    // A rising base under the pivot, then six rising sessions above it. With a shorter age gate (rules given
    // here only), the base's up days would fill the 10-session window; only the run's six count.
    const rules = { ...SELL_RULES, climaxSessions: 5 };
    const closes = rising(200);
    const pivot = closes.at(-1) * 1.001;
    for (let k = 0; k < 6; k++) closes.push(closes.at(-1) * 1.05);
    const view = { state: 'ext', pivot, distance: (closes.at(-1) / pivot - 1) * 100 };
    const result = sellSignals(make(closes), rules, { view });
    expect(result.run.sessions).toBe(5);
    expect(result.strength.find(c => c.key === 'up-days')).toMatchObject({ state: 'clear', detail: '上昇 5日 / 5日' });
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
    // The same floor as the 50-day check and the chips: 1.396 reads 1.39×, never 1.40× beside a 1.4× bar.
    expect(bookWarningCheck(warn({ currentVolumeRatio: 1.396, combinedWarning: false })).detail).toBe('20日線割れ・3日連続の安値切り下げ あり・出来高 1.39×');
    expect(bookWarningCheck(warn({ recoveryInUpperHalf: true })).detail).toContain('買い支え');
    expect(bookWarningCheck(warn({ combinedWarning: false, threeLowerLows: false })).state).toBe('clear');
    expect(bookWarningCheck(warn({ combinedWarning: null, currentVolumeRatio: null })).state).toBe('unknown');
    expect(bookWarningCheck({ valid: false }).state).toBe('unknown');
    expect(bookWarningCheck(null).state).toBe('unknown');
    const merged = withBookWarning({ strength: [], weakness: [{ key: 'ma50', state: 'clear' }], hits: 0 }, warn());
    expect(merged.weakness.map(c => c.key)).toEqual(['ma50', 'book']);
    expect(merged).toMatchObject({ hits: 1, weaknessHits: 1, breakdownHits: 1, strengthHits: 0 });
    expect(withBookWarning(null, warn())).toBeNull();
  });
});

// Seams E owns and other tracks call (the stock view shell, BriefParts' rows, the conclusion).
describe('briefSell seams', () => {
  const warn = { valid: true, as_of_date: '2025-07-19', priceWarnings: { below20: true, threeLowerLows: true, currentVolumeRatio: 1.6, combinedWarning: true, recoveryInUpperHalf: false } };
  const result = over => ({ strength: [{ key: 'climax', label: '急騰', state: 'clear' }], weakness: [{ key: 'ma50', label: '50日線', state: 'clear', detail: '' }], hits: 0, strengthHits: 0, weaknessHits: 0, ...over });

  it('sellChipView: a broken setup first (never only a sell count), short on rows and in full where there is room', () => {
    expect(sellChipView(result({ weakness: [{ key: 'ma50', label: '50日線割れ', state: 'hit' }, { key: 'book', label: '複合警告', state: 'hit' }], hits: 2, weaknessHits: 2, breakdownHits: 2 })))
      .toEqual({ text: WEAKNESS_ROW_CHIP, full: WEAKNESS_CHIP, tone: 'ext', title: `${WEAKNESS_CHIP}：50日線割れ・複合警告` });
    expect(WEAKNESS_CHIP).toBe('買いの前提が崩れた／保有なら売りのサイン（独自判定）');
    expect(WEAKNESS_ROW_CHIP).toBe('崩れ（独自判定）');
  });

  it('sellChipView: the holders\' signals alone (a climax, the advance\'s largest down day) stay neutral and come last', () => {
    expect(sellChipView(result({ strength: [{ key: 'climax', label: '急騰', state: 'hit' }], hits: 1, strengthHits: 1 })))
      .toEqual({ text: HOLDING_ROW_CHIP, full: HOLDING_CHIP, tone: '', title: `${HOLDING_CHIP}：急騰` });
    expect(HOLDING_CHIP).toBe('保有している場合の売りのサイン（保有未登録）');
    expect(HOLDING_ROW_CHIP).toBe('保有なら売りのサイン');
    // The largest down day of the advance is a holder's rule, not a broken setup: a VCP's first contraction is often that sharp.
    const pullback = result({ weakness: [{ key: 'day-down', label: '最大の下落', state: 'hit' }, { key: 'ma50', label: '50日線', state: 'clear' }, { key: 'book', label: '複合警告', state: 'clear' }], hits: 1, weaknessHits: 1 });
    expect(sellChipView(pullback)).toEqual({ text: HOLDING_ROW_CHIP, full: HOLDING_CHIP, tone: '', title: `${HOLDING_CHIP}：最大の下落` });
    expect(isBreakdown({ key: 'day-down', state: 'hit' })).toBe(false);
    expect(isBreakdown({ key: 'ma50', state: 'hit' }) && isBreakdown({ key: 'book', state: 'hit' })).toBe(true);
    // A caution on the 50-day line outranks a holder's signal: the watch list is about the buy setup.
    expect(sellChipView(result({ strength: [{ key: 'climax', label: '急騰', state: 'hit' }], weakness: [{ key: 'ma50', label: '50日線', state: 'caution', detail: '50日線の下（大商いの割れは未確認）・…' }] })).text).toBe('50日線の下');
  });

  it('sellChipView: a caution, an unknown check and an unchecked result are visible text, never nothing', () => {
    expect(sellChipView(result({ weakness: [{ key: 'ma50', label: '50日線', state: 'caution', detail: '50日線の下（大商いの割れは未確認）・…' }] })))
      .toEqual({ text: '50日線の下', full: '50日線の下（大商いの割れは未確認）', tone: 'wait', title: '50日線の下（大商いの割れは未確認）・…' });
    expect(sellChipView(result({ weakness: [{ key: 'ma50', label: '50日線', state: 'unknown', detail: '9/22 に50日線を割れ…未取得' }, { key: 'book', label: '複合警告', state: 'clear' }], unknowns: 1 })))
      .toEqual({ text: '50日線の下・出来高未確認', full: '50日線の下（割れた日の出来高は未確認）', tone: 'wait', title: '9/22 に50日線を割れ…未取得' });
    // Any other weakness check left unknown: 一部未確認, with each unknown check and its reason as the title.
    expect(sellChipView(result({ weakness: [{ key: 'ma50', label: '50日線', state: 'clear' }, { key: 'book', label: '複合警告', state: 'unknown', detail: '書籍診断が未取得' }], unknowns: 1 })))
      .toEqual({ text: '売りのサイン 一部未確認', full: '売りのサイン 一部未確認', tone: '', title: '複合警告：書籍診断が未取得' });
    expect(sellChipView({ unknown: true, reason: '日足を取得できません' })).toEqual({ text: '売りのサイン 未確認', full: '売りのサイン 未確認', tone: '', title: '日足を取得できません' });
    expect(sellChipView({ unknown: true })).toEqual({ text: '売りのサイン 未確認', full: '売りのサイン 未確認', tone: '', title: undefined });
    expect(sellChipView({ unknown: true, limit: 12, reason: '確認は先頭12銘柄まで' })).toEqual({ text: '売りのサイン 未確認（上限12銘柄）', full: '売りのサイン 未確認（上限12銘柄）', tone: '', title: '確認は先頭12銘柄まで' });
    // A result without the strength/weakness split (an older shape) keeps the step-0 chip.
    expect(sellChipView({ hits: 3 })).toEqual({ text: '売りのサイン 3件', full: '売りのサイン 3件', tone: 'ext', title: undefined });
    for (const value of [null, undefined, { hits: 0 }, result()]) expect(sellChipView(value)).toBeNull();
  });

  it('sellChipView on whole results: a check left unknown by its inputs is said on the row', () => {
    // A 10% break below the 50-day line whose break-day volume is missing, with no book diagnostics.
    const closes = rising(200), floor = closes.at(-1) * 0.9;
    closes.push(floor, ...Array.from({ length: 8 }, (_, k) => floor * (1 - 0.001 * k)));
    const bars = make(closes, i => (i === 200 ? null : 10000));
    const sells = stockSells({ judged: bars, diagnostics: null, view: null });
    expect(sells).toMatchObject({ weaknessHits: 0, breakdownHits: 0, unknowns: 2 });
    expect(sellChipView(sells)).toMatchObject({ text: '50日線の下・出来高未確認', tone: 'wait' });
    // Above the line with the book's diagnostics missing: 一部未確認.
    const above = stockSells({ judged: make(rising(200)), diagnostics: null, view: null });
    expect(above).toMatchObject({ breakdownHits: 0, unknowns: 1 });
    expect(sellChipView(above)).toMatchObject({ text: '売りのサイン 一部未確認', title: expect.stringContaining('検証済みの日足による書籍診断が未取得') });
  });

  it('stockSells is the bars\' checks (gated by the view) plus the book warning, and null without judged bars', () => {
    const closes = rising(200);
    closes.push(closes.at(-1) * 0.9);
    const bars = make(closes, i => (i === 200 ? 20000 : 10000));
    const view = { symbol: 'AAA', state: 'wait', distance: -3, pivot: closes.at(-1) * 1.03 };
    for (const diagnostics of [null, warn, { valid: false }]) expect(stockSells({ judged: bars, diagnostics, view })).toEqual(withBookWarning(sellSignals(bars, SELL_RULES, { view }), diagnostics));
    // The advance's largest down day is a weakness hit, not a broken setup: two of the three are.
    expect(stockSells({ judged: bars, diagnostics: warn, view })).toMatchObject({ weaknessHits: 3, breakdownHits: 2, strengthHits: 0 });
    expect(stockSells({ judged: null, diagnostics: warn, view })).toBeNull();
    expect(stockSells({ judged: make(closes.slice(0, 59)), diagnostics: null, view })).toBeNull();
  });
});

// The weakness-check contract rows read (plan §2.2): { key, state, headline?, detail } with the five states, and the
// broken setups isBreakdown counts. The key failedBreakout is reserved for verdict's VD2: at step 0 no check carries it.
describe('the round-2 weakness-check contract', () => {
  it('every weakness check has a key, one of the five states and a detail; only the 50-day line and the book break a setup', () => {
    const closes = rising(200);
    closes.push(closes.at(-1) * 0.9);
    const bars = make(closes, i => (i === 200 ? 20000 : 10000));
    const sells = stockSells({ judged: bars, diagnostics: null, view: { symbol: 'AAA', state: 'wait', distance: -3, pivot: closes.at(-1) * 1.03 } });
    for (const check of sells.weakness) {
      expect(typeof check.key).toBe('string');
      expect(['hit', 'caution', 'clear', 'unknown', 'na']).toContain(check.state);
      expect(check).toHaveProperty('detail');
    }
    expect(sells.weakness.map(check => check.key)).not.toContain('failedBreakout');
    expect(['ma50', 'book', 'failedBreakout', 'day-down'].map(key => isBreakdown({ key, state: 'hit' }))).toEqual([true, true, false, false]);
    expect(isBreakdown({ key: 'ma50', state: 'caution' })).toBe(false);
  });
});
