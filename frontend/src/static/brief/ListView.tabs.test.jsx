// The phone's 候補 header (plan SV-P1): the count tabs as one scrolling strip, the selected tab's definition under it, the gate
// sentence on a 0%, unknown or waiting day, and the count rule (the round-2 critique's blocker): a tab's number counts only the
// stocks whose membership is decided, every stock the data cannot place goes to 「未確認 n」 beside it, never into the number,
// and a tab never reads a bare 0 while its 未確認 is above 0.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { withAuditFixture } from '../testAuditFixture';
import ListView, { gateUnits, listPending, listSource } from './ListView';
import { AT_PIVOT_PERCENT, BREAKOUT_VOLUME_RATIO, candidateView, filterCounts, LIST_FILTERS, LIST_TABS, NEAR_PIVOT_PERCENT, positionUnknown, selectionUnknown, TAB_UNKNOWN_NOTE, tabDefinition } from './briefCandidate';
import { marketBand } from './marketGate';

const DATE = '2026-10-02';
const CURRENT_BASE = { setup_recalculation: { status: 'calculated', as_of_date: DATE }, se_pattern_confidence: 60 };
const PASS = { qualified: true, passed: 9, failed: 0, unknown: 0, total: 9 };
const counts = (failed, unknown, extra = {}) => ({ qualified: false, passed: 9 - failed - unknown, failed, unknown, total: 9, ...extra });
// A row's state and pivot distance come from its price against its pivot (100); the analysis day is +2% on 1.6× unless told.
const audited = (symbol, price, { pivot = 100, change = 2, volume = 1.6, assessment = PASS, ...extra } = {}) => {
  const row = withAuditFixture({ symbol, company_name: symbol, market: 'US', currency: 'USD', current_price: price, se_pivot_price: pivot, rs_rating: 90, ...CURRENT_BASE, ...extra }, DATE);
  Object.assign(row.technical_audit.values, { change, volumeRatio: volume });
  return { row, assessment };
};
const view = (...args) => candidateView(audited(...args), DATE);
// No pivot because the Setup Engine's recalculation could not run (canonicalPivot: セットアップ再計算不可): the position is undecided.
const NO_PIVOT = { pivot: null, setup_recalculation: { status: 'unavailable' } };

describe('the count rule: what each tab cannot decide is 未確認, never a miss and never in its number', () => {
  it('counts an up-day crossing whose volume is missing as the 上抜け tab\'s 未確認 (the critique\'s bare case)', () => {
    const cross = view('XVOL', 101, { volume: null });
    expect([cross.event.kind, LIST_FILTERS.breakout.test(cross), LIST_FILTERS.breakout.unknown(cross)]).toEqual(['cross', false, true]);
    expect(filterCounts([cross])).toMatchObject({ counts: { breakout: 0, zone: 1 }, unknown: { breakout: 1 } });
    // A crossing on a known volume under the bar, or on a down day, is decided: not a breakout and not 未確認.
    const short = view('XLOW', 101, { volume: BREAKOUT_VOLUME_RATIO - 0.2 });
    const down = view('XDWN', 101, { volume: null, change: -1 });
    expect([short.event.kind, LIST_FILTERS.breakout.unknown(short)]).toEqual(['cross', false]);
    expect(LIST_FILTERS.breakout.unknown(down)).toBe(false);
  });

  it('counts a selected stock with no usable pivot as 未確認 for every position tab and the day\'s breakouts', () => {
    const blind = view('NOPV', 101, NO_PIVOT);
    expect([blind.stateLabel, positionUnknown(blind)]).toEqual(['判定不可', true]);
    // So does a pivot never fetched (no recalculation on the row at all), and a price that is missing.
    expect(positionUnknown(view('NOFT', 101, { pivot: null, setup_recalculation: undefined }))).toBe(true);
    expect(positionUnknown(view('NOPR', null))).toBe(true);
    const tally = filterCounts([blind]);
    for (const key of ['zone', 'at', 'near', 'breakout']) expect([key, tally.counts[key], tally.unknown[key]]).toEqual([key, 0, 1]);
    expect([tally.counts.all, tally.unknown.all]).toEqual([1, 0]);
    // A pivot more than 25% away is decided (旧ピボット・有効な買い水準なし): in no band, so not 未確認.
    const stale = view('STAL', 140);
    expect([stale.stale !== null, positionUnknown(stale)]).toEqual([true, false]);
    expect(filterCounts([stale]).unknown).toMatchObject({ zone: 0, at: 0, near: 0, breakout: 0 });
    // A base the Setup Engine recalculated for the analysis without a valid pivot (再計算済み・現在有効なピボットなし) is decided too.
    const none = view('NOBS', 101, { pivot: null });
    expect([none.state, positionUnknown(none)]).toEqual(['na', false]);
    expect(filterCounts([none]).unknown).toMatchObject({ zone: 0, at: 0, near: 0, breakout: 0 });
  });

  it('counts a stock whose selection is undecided apart, in every tab it could belong to', () => {
    // Nothing unmet and one condition unconfirmed, in the zone on a breakout day: it would be selected if that condition held.
    const open = view('UNK1', 101, { assessment: counts(0, 1) });
    expect(selectionUnknown(open)).toBe(true);
    const tally = filterCounts([open]);
    for (const key of ['all', 'zone', 'breakout', 'one']) expect([key, tally.counts[key], tally.unknown[key]]).toEqual([key, 0, 1]);
    for (const key of ['at', 'near']) expect([key, tally.unknown[key]]).toEqual([key, 0]);
    // One unmet and one unconfirmed: never selected, but あと1条件 is undecided.
    expect(filterCounts([view('UNK2', 97, { assessment: counts(1, 1) })]).unknown).toMatchObject({ all: 0, near: 0, at: 0, one: 1 });
    // Two unmet: decided out of every tab.
    expect(Object.values(filterCounts([view('UNK3', 101, { assessment: counts(2, 1) })]).unknown).every(n => n === 0)).toBe(true);
    // An exclusion decides the selection (it can never be selected), whatever is unconfirmed.
    const excluded = view('EXC1', 101, { assessment: counts(0, 1, { financial_exclusion: { label: '金融業の除外' } }) });
    expect([selectionUnknown(excluded), LIST_FILTERS.zone.unknown(excluded), LIST_FILTERS.all.unknown(excluded)]).toEqual([false, false, false]);
  });

  it('keeps every plain count equal to the stocks its tab lists, and never counts a stock as both', () => {
    const views = [view('Z1', 101), view('A1', 98.5), view('N1', 96), view('X1', 101, { volume: null }), view('P1', 101, NO_PIVOT), view('O1', 99, { assessment: counts(1, 0) })];
    const pending = [view('U1', 101, { assessment: counts(0, 1) })];
    const tally = filterCounts(views, pending);
    for (const key of LIST_TABS) {
      expect([key, tally.counts[key]]).toEqual([key, views.filter(LIST_FILTERS[key].test).length]);
      for (const one of [...views, ...pending]) expect([key, one.symbol, LIST_FILTERS[key].test(one) && LIST_FILTERS[key].unknown(one)]).toEqual([key, one.symbol, false]);
    }
    // The stocks only a 未確認 can count never add to a number.
    expect(filterCounts(views, pending).counts).toEqual(filterCounts(views).counts);
    // P1 (no pivot) is 未確認 for every band; U1 (selection undecided, in the zone, a breakout day) for its own; X1 for 上抜け only.
    expect(tally.unknown).toMatchObject({ all: 1, zone: 2, at: 1, near: 1, breakout: 3, one: 1 });
  });

  it('puts ピボット直下 on the printed distance: 「−2.0%」 is inside 「−2.0%以内」, 「−2.1%」 is not; a subset of ピボット接近', () => {
    expect([AT_PIVOT_PERCENT, NEAR_PIVOT_PERCENT]).toEqual([2, 5]);
    const inside = view('AT1', 100 * (1 - 0.0204)), outside = view('AT2', 100 * (1 - 0.0206));
    expect([inside.distance.toFixed(1), LIST_FILTERS.at.test(inside), LIST_FILTERS.near.test(inside)]).toEqual(['-2.0', true, true]);
    expect([outside.distance.toFixed(1), LIST_FILTERS.at.test(outside), LIST_FILTERS.near.test(outside)]).toEqual(['-2.1', false, true]);
    // Hidden: never a segment button wider than a phone.
    expect(LIST_FILTERS.at.hidden).toBe(true);
  });

  it('lists the stocks only a 未確認 can count apart from the list\'s own rows (listPending)', () => {
    const ranked = [audited('Q1', 101), audited('O1', 99, { assessment: counts(1, 0) }), audited('U1', 101, { assessment: counts(0, 2) }), audited('U2', 97, { assessment: counts(1, 1) }), audited('F2', 97, { assessment: counts(2, 0) })];
    const brief = { ranked, date: DATE, bundle: { data: { date: DATE, rankings: { minervini: ranked } } } };
    expect(listSource(brief, 'list', []).map(v => v.symbol)).toEqual(['Q1', 'O1']);
    expect(listPending(brief).map(v => v.symbol)).toEqual(['U1', 'U2']);
  });
});

describe('the tabs\' definitions (one sentence per population)', () => {
  it('says each population once, with 独自設定 on every threshold of our own, U+2212 for a minus, and never 「n条件中」', () => {
    expect(LIST_TABS).toEqual(['all', 'breakout', 'zone', 'at', 'near', 'one']);
    expect(tabDefinition('zone', DATE)).toBe('ピボット〜その＋5%（独自設定）の選定銘柄。');
    expect(tabDefinition('at', DATE)).toBe('ピボット接近のうち、ピボットまで−2.0%以内（独自設定）。');
    expect(tabDefinition('near', DATE)).toBe('ピボットまで−5.0%以内（独自設定）の選定銘柄。');
    expect(tabDefinition('breakout', DATE)).toBe('前日の終値がピボットの下で、10/2の終値がピボットを上回った選定銘柄（上昇日・出来高1.4×以上・独自設定）。');
    expect(tabDefinition('breakout', null)).toContain('分析基準日の終値');
    expect(tabDefinition('all', DATE)).toBe('TT 8/8と日足の整合性を満たし、株価$10以上・売買代金$2,000万以上（独自設定）の銘柄。');
    expect(tabDefinition('one', DATE)).toBe('選定の条件のうち未達が1つだけで、未確認がない銘柄。');
    expect(tabDefinition('focus', DATE)).toBeNull();
    for (const key of LIST_TABS) expect(tabDefinition(key, DATE)).not.toMatch(/-\d|条件中|RS Rating/);
  });
});

// The phone (520px and narrower): the header the plan's SV-P1 draws.
describe('the phone\'s 候補 header', () => {
  beforeEach(() => { window.matchMedia = query => ({ matches: /max-width:\s*520px/.test(query), media: query, addEventListener() {}, removeEventListener() {} }); });
  afterEach(() => { cleanup(); delete window.matchMedia; });
  const OPEN = { state: 'confirmed_uptrend', cap: 0.5, label: '上昇トレンド（独自判定）', regime: 'confirmed_uptrend' };
  const CLOSED = { state: 'correction', cap: 0, label: '50日線割れ（弱含み・独自判定）', regime: 'correction' };
  const show = (ranked, { filter = 'zone', market = OPEN, marketLoading = false, target = null, ageLine = null, loading = false, onState = () => {} } = {}) => {
    const brief = { bundle: { data: loading ? undefined : { date: DATE, rankings: { minervini: ranked } }, isLoading: loading, isError: false }, manifest: { isLoading: false, isError: false },
      ranked: loading ? [] : ranked, date: DATE, market, marketLoading, version: 'v1' };
    let state = { filter, sort: 'priority', query: '' };
    const result = render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ListView brief={brief} kind="list" watch={[]} open={() => {}} now={0} animate={false} listState={state} setListState={update => { state = update(state); onState(state); }}
        limits={{}} setLimits={() => {}} origin={null} wide={false} onUnwatch={() => {}} target={target} ageLine={ageLine} />
    </QueryClientProvider></MemoryRouter>);
    return { ...result, strip: within(result.getByRole('group', { name: '絞り込み' })) };
  };
  const tabTexts = strip => strip.getAllByRole('button').map(button => [button.querySelector('.brief-tab-label').textContent, button.querySelector('.numeric').textContent,
    button.querySelector('.brief-tab-unknown')?.textContent.trim() ?? null]);

  it('draws six count tabs in the reference order, each named from its label, with 「未確認 n」 only where n is above 0 (always on 上抜け)', () => {
    const ranked = [audited('Z1', 101), audited('X1', 101.5, { volume: null }), audited('N1', 96), audited('O1', 99, { assessment: counts(1, 0) })];
    const { strip } = show(ranked);
    expect(tabTexts(strip)).toEqual([['選定すべて', '3', null], ['10/2の上抜け', '1', '未確認 1'], ['買いゾーン', '2', null], ['ピボット直下', '0', null], ['ピボット接近', '1', null], ['あと1条件', '1', null]]);
    // Every accessible name starts with the tab's label (the specs and the frozen harness press them by it).
    for (const [label, name] of [['選定すべて', /^選定すべて3$/], ['買いゾーン', /^買いゾーン2$/], ['ピボット接近', /^ピボット接近1$/], ['あと1条件', /^あと1条件1$/]]) expect(strip.getByRole('button', { name }).textContent.startsWith(label)).toBe(true);
    expect(strip.getByRole('button', { name: /^買いゾーン/ })).toHaveAttribute('aria-pressed', 'true');
    // The four harness labels stay unique under a substring match.
    for (const label of ['買いゾーン', 'ピボット接近', '選定すべて', 'あと1条件']) expect(strip.getAllByRole('button').filter(button => button.textContent.includes(label))).toHaveLength(1);
  });

  it('never reads a bare 0 while the tab\'s 未確認 is above 0, and its numbers are filterCounts\' over the same rows', () => {
    // The only crossing has no volume: 「0 未確認 1」, never 「0」 above a row that says its 上抜け is 未確認.
    const ranked = [audited('X1', 101, { volume: null }), audited('P1', 101, NO_PIVOT), audited('U1', 101, { assessment: counts(0, 1) })];
    const { strip, container } = show(ranked, { filter: 'breakout' });
    const tally = filterCounts(listSource({ ranked, date: DATE, bundle: { data: { date: DATE } } }, 'list', []), listPending({ ranked, date: DATE, bundle: { data: { date: DATE } } }));
    for (const [i, key] of LIST_TABS.entries()) {
      const [, count, unknown] = tabTexts(strip)[i];
      expect([key, count]).toEqual([key, String(tally.counts[key])]);
      if (tally.unknown[key] > 0) expect([key, unknown]).toEqual([key, `未確認 ${tally.unknown[key]}`]);
    }
    expect(tabTexts(strip)[1]).toEqual(['10/2の上抜け', '0', '未確認 3']);
    // The empty tab says why it judged nothing, never 「no such stock」 alone.
    expect(container.querySelector('.brief-card .brief-note')).toHaveTextContent(`該当なし。ほか3銘柄は${LIST_FILTERS.breakout.why}のため判定していません。`);
    // The 注記 says what 「未確認 n」 counts.
    expect(container.querySelector('.brief-screen-notes')).toHaveTextContent(TAB_UNKNOWN_NOTE);
  });

  it('reads 「—」 and no 未確認 while the bundle loads', () => {
    const { strip } = show([], { loading: true });
    expect(tabTexts(strip).map(([, count, unknown]) => [count, unknown])).toEqual(LIST_TABS.map(() => ['—', null]));
  });

  it('says the selected tab\'s definition right under the strip, and the 条件 menu keeps the EPS filter only (上抜け is a tab)', () => {
    let seen = null;
    const { container, strip, getByRole } = show([audited('Z1', 101)], { onState: state => { seen = state.filter; } });
    const definition = container.querySelector('.brief-filters > .brief-countstrip + .brief-tabdef');
    expect(definition).toHaveTextContent(tabDefinition('zone', DATE));
    expect(getByRole('group', { name: '絞り込み' })).toHaveAttribute('aria-describedby', definition.id);
    expect([...getByRole('combobox', { name: '条件で絞り込む' }).querySelectorAll('option')].map(option => option.value)).toEqual(['', 'eps']);
    fireEvent.click(strip.getByRole('button', { name: /^ピボット直下/ }));
    expect(seen).toBe('at');
    cleanup();
    // A strip tab that is a hidden filter wider is pressed, never said as a dismissible chip; 選定すべて's line is its definition.
    for (const key of ['breakout', 'at', 'all']) {
      const shown = show([audited('Z1', 101)], { filter: key });
      expect(shown.container.querySelector('.brief-filterchip, .brief-population')).toBeNull();
      expect(shown.container.querySelector('.brief-tabdef')).toHaveTextContent(tabDefinition(key, DATE));
      expect(shown.strip.getByRole('button', { pressed: true }).querySelector('.brief-tab-label').textContent).toBe(key === 'breakout' ? '10/2の上抜け' : LIST_FILTERS[key].label);
      cleanup();
    }
    // Today's 注目候補 tile (a hidden filter that is not a tab) keeps its chip and presses no tab.
    const focus = show([audited('Z1', 101)], { filter: 'focus' });
    expect(focus.container.querySelector('.brief-filterchip')).not.toBeNull();
    expect(focus.strip.queryByRole('button', { pressed: true })).toBeNull();
    expect(focus.container.querySelector('.brief-tabdef')).toBeNull();
  });

  it('puts marketBand\'s own sentence above the strip on a 0%, unknown or waiting day, the definition kept under the strip', () => {
    const rows = [audited('Z1', 101)];
    const cases = [
      ['closed', { market: CLOSED }, marketBand(CLOSED, { date: DATE, target: null })],
      ['unknown', { market: null }, marketBand(null, { date: DATE, target: null })],
      ['waiting', { market: OPEN, target: '2026-10-05' }, marketBand(OPEN, { date: DATE, target: '2026-10-05' })],
    ];
    for (const [state, input, band] of cases) {
      expect(band.state).toBe(state);
      const { container, getByTestId, getByRole } = show(rows, input);
      const gate = getByTestId('brief-list-gate');
      expect(gate.tagName).toBe('P');
      expect(gate).toHaveAttribute('data-band', state);
      // Verbatim: the band's labelled line (the unknown form is line1, which has no figure and no tag), then the market link.
      expect([...gate.querySelectorAll(':scope > .brief-nowrap:not(a)')].map(unit => unit.textContent).join('')).toBe(band.line1Labelled);
      expect(gate.textContent).toBe(`${band.line1Labelled} 市場 ›`);
      expect(getByRole('link', { name: '市場の詳細' })).toHaveAttribute('href', '/brief/market');
      // The sentence sits above the strip, and the definition stays under the strip.
      expect(gate.nextElementSibling).toHaveClass('brief-filters');
      expect(container.querySelector('.brief-countstrip + .brief-tabdef')).toHaveTextContent(tabDefinition('zone', DATE));
      if (state === 'unknown') expect(gate.textContent).not.toMatch(/%|目安/);
      cleanup();
    }
    expect(marketBand(CLOSED, { date: DATE, target: null }).line1Labelled).toBe('地合い 買いは控える（独自判定）・目安 0%（独自設定）');
  });

  it('draws no sentence on an open day, while the market loads, or before any verdict while it loads; a late open day reads its band', () => {
    for (const input of [{ market: OPEN }, { market: null, marketLoading: true }]) {
      expect(show([audited('Z1', 101)], input).queryByTestId('brief-list-gate')).toBeNull();
      cleanup();
    }
    // A stale publication whose band is not waiting (only without a calendar target): the band's line, the bar keeps its age.
    const late = show([audited('Z1', 101)], { market: OPEN, ageLine: { tone: 'warn', age: '2営業日前', detail: '（10/5・10/6 未反映）' } });
    expect(late.getByTestId('brief-list-gate').textContent).toBe(`${marketBand(OPEN, { date: DATE, target: null }).line1Labelled} 市場 ›`);
  });

  it('breaks the sentence only after a 「・」 or before a （…） label', () => {
    expect(gateUnits('地合い 買いは控える（独自判定）・目安 0%（独自設定）')).toEqual(['地合い 買いは控える', '（独自判定）・', '目安 0%', '（独自設定）']);
    expect(gateUnits('地合い 10/2時点の判定・更新待ち（独自判定）')).toEqual(['地合い 10/2時点の判定・', '更新待ち', '（独自判定）']);
    expect(gateUnits('地合い 未確認・買いは見送り')).toEqual(['地合い 未確認・', '買いは見送り']);
  });
});

describe('wider than a phone', () => {
  afterEach(cleanup);
  it('keeps the four segment buttons, the population line and no strip, definition or gate sentence', () => {
    const rows = [audited('Z1', 101)];
    const brief = { bundle: { data: { date: DATE, rankings: { minervini: rows } }, isLoading: false, isError: false }, manifest: { isLoading: false, isError: false }, ranked: rows, date: DATE, market: null, version: 'v1' };
    const { container, getByRole } = render(<MemoryRouter><QueryClientProvider client={new QueryClient()}>
      <ListView brief={brief} kind="list" watch={[]} open={() => {}} now={0} animate={false} listState={{ filter: 'all', sort: 'priority', query: '' }} setListState={() => {}}
        limits={{}} setLimits={() => {}} origin={null} wide onUnwatch={() => {}} target={null} />
    </QueryClientProvider></MemoryRouter>);
    expect(within(getByRole('group', { name: '絞り込み' })).getAllByRole('button').map(button => button.firstChild.textContent)).toEqual(['買いゾーン', 'ピボット接近', '選定すべて', 'あと1条件']);
    expect(container.querySelector('.brief-countstrip, .brief-tabdef, [data-testid="brief-list-gate"]')).toBeNull();
    expect(container.querySelector('.brief-population')).not.toBeNull();
    expect([...getByRole('combobox', { name: '条件で絞り込む' }).querySelectorAll('option')].map(option => option.value)).toEqual(['', 'breakout', 'eps']);
  });
});
