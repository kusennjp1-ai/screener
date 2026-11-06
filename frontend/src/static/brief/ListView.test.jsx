// The candidate list's segment (ListView, E) against the filters briefCandidate (D) defines.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { withAuditFixture } from '../testAuditFixture';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ListView, { listShown, watchOrder } from './ListView';
import { candidateView, LIST_FILTERS } from './briefCandidate';

afterEach(cleanup);

const DATE = '2026-10-02';
// A row's state and pivot distance come from its price against its pivot (100).
const item = (symbol, price, qualified = true) => ({ row: { symbol, current_price: price, se_pivot_price: 100 }, assessment: { qualified, passed: qualified ? 8 : 7, failed: qualified ? 0 : 1, unknown: 0, total: 8 } });
const ranked = [item('ZON1', 101), item('NEA1', 97), item('FAR1', 90), item('ONE1', 99, false)];
const brief = { bundle: { data: { date: DATE, rankings: { minervini: ranked } }, isLoading: false, isError: false }, manifest: { isLoading: false, isError: false }, ranked, date: DATE, market: null, version: 'v1' };

const list = (filter = 'zone', { kind = 'list', watch = [], setListState = () => {}, onUnwatch = () => {} } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <ListView brief={brief} kind={kind} watch={watch} open={() => {}} now={0} animate={false} listState={{ filter, sort: 'priority', query: '' }} setListState={setListState}
      limits={{}} setLimits={() => {}} origin={null} wide onUnwatch={onUnwatch} />
  </QueryClientProvider>);
};

describe('candidate list segment', () => {
  it('shows a button for every filter but the hidden ones, so 注目候補 is never a segment button', () => {
    const { getByRole } = list();
    const labels = within(getByRole('group', { name: '絞り込み' })).getAllByRole('button').map(button => button.firstChild.textContent);
    expect(labels).toEqual(Object.values(LIST_FILTERS).filter(value => !value.hidden).map(value => value.label));
    expect(labels).toEqual(['買いゾーン', 'ピボット接近', '選定すべて', 'あと1条件']);
    expect(labels).not.toContain(LIST_FILTERS.focus.label);
  });

  it('counts each shown filter over the same rows', () => {
    const { getByRole } = list();
    const counts = within(getByRole('group', { name: '絞り込み' })).getAllByRole('button').map(button => button.lastChild.textContent);
    expect(counts).toEqual(['1', '1', '3', '1']);
  });
});

describe('the hidden focus filter (Today\'s 注目候補 tile)', () => {
  it('lists the zone and near rows, presses no segment button, and is said as a chip that clears it', () => {
    let state = { filter: 'focus' };
    const { getByRole, getAllByTestId } = list('focus', { setListState: update => { state = update(state); } });
    expect(getAllByTestId('brief-candidate').map(row => row.dataset.symbol)).toEqual(['ZON1', 'NEA1']);
    for (const button of within(getByRole('group', { name: '絞り込み' })).getAllByRole('button')) expect(button).toHaveAttribute('aria-pressed', 'false');
    const chip = getByRole('button', { name: '注目候補（ゾーン＋接近）2（絞り込みを解除）' });
    chip.click();
    expect(state.filter).toBe('zone');
    cleanup();
    expect(list('zone').queryByRole('button', { name: /注目候補（ゾーン＋接近）/ })).toBeNull();
  });
});

describe('the watch list', () => {
  it('leads with a symbol the publication does not list, its reason and a 外す, and keeps the listed rows', () => {
    const removed = [];
    const { container, getAllByTestId, getByRole } = list('zone', { kind: 'watch', watch: ['NEA1', 'QQQX', 'ZON1'], onUnwatch: symbol => removed.push(symbol) });
    const items = [...container.querySelectorAll('.brief-rows > li')];
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('QQQX：この公開（10/2引け）の分析対象外（上場廃止・ティッカー変更・データ欠落など）。売りのサイン・位置は未確認');
    expect(getAllByTestId('brief-candidate').map(row => row.dataset.symbol)).toEqual(['ZON1', 'NEA1']);
    getByRole('button', { name: '外す（QQQX をウォッチから外す）' }).click();
    expect(removed).toEqual(['QQQX']);
  });

  it('puts the broken setups first, only once every check is in', () => {
    const views = ['A', 'B', 'C'].map(symbol => ({ symbol }));
    const quiet = { weaknessHits: 0, breakdownHits: 0 }, weak = { weaknessHits: 1, breakdownHits: 1 };
    expect(watchOrder(views, { A: quiet, B: quiet, C: weak }).map(v => v.symbol)).toEqual(['C', 'A', 'B']);
    expect(watchOrder(views, { A: quiet, B: weak }).map(v => v.symbol)).toEqual(['A', 'B', 'C']);
    expect(watchOrder(views, { A: { unknown: true }, B: weak, C: { hits: 2, strengthHits: 2, weaknessHits: 0 } }).map(v => v.symbol)).toEqual(['B', 'A', 'C']);
    // The advance's largest down day alone is a holder's signal: it does not move a row.
    expect(watchOrder(views, { A: quiet, B: quiet, C: { hits: 1, weaknessHits: 1, breakdownHits: 0 } }).map(v => v.symbol)).toEqual(['A', 'B', 'C']);
    expect(watchOrder([], {})).toEqual([]);
  });

  it('lists every watched stock whatever the 候補 tab\'s filter, search and sort, in Today\'s order', () => {
    const views = ranked.map(entry => candidateView(entry, DATE));
    const plain = listShown(views, 'watch', { filter: 'zone', sort: 'priority', query: '' }).map(v => v.symbol);
    expect(plain).toHaveLength(ranked.length);
    for (const state of [{ filter: 'one', sort: 'rs', query: 'ZON1' }, { filter: 'near', sort: 'volume', query: 'nothing matches' }])
      expect(listShown(views, 'watch', state).map(v => v.symbol)).toEqual(plain);
    // The 候補 tab keeps its search.
    expect(listShown(views, 'list', { filter: 'all', sort: 'priority', query: 'ZON1' }).map(v => v.symbol)).toEqual(['ZON1']);
  });

  it('renders every watched row while the 候補 tab has a search', () => {
    const { getAllByTestId } = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ListView brief={brief} kind="watch" watch={['NEA1', 'ZON1', 'FAR1']} open={() => {}} now={0} animate={false} listState={{ filter: 'zone', sort: 'priority', query: 'ZON1' }} setListState={() => {}}
        limits={{}} setLimits={() => {}} origin={null} wide onUnwatch={() => {}} />
    </QueryClientProvider>);
    expect(getAllByTestId('brief-candidate')).toHaveLength(3);
  });
});

// Round 2 (rows): the hidden breakout and EPS filters, chosen from the 条件 menu and said as a dismissible chip;
// 選定すべて's population; and the desktop's first 20 rows before the rest.
describe('round 2 filters on the 候補 list', () => {
  const audited = (symbol, price, { change = 2, volume = 1.6, eps } = {}) => {
    const row = withAuditFixture({ symbol, company_name: symbol, market: 'US', currency: 'USD', current_price: price, se_pivot_price: 100, rs_rating: 90,
      ...(eps === undefined ? {} : { sec_summary: { sec_state: 'ok', eps_yoy: eps === null ? null : { value: eps, end: '2026-06-30' }, sales_yoy: null, code33: null, as_of_date: DATE } }) }, DATE);
    Object.assign(row.technical_audit.values, { change, volumeRatio: volume });
    return { row, assessment: { qualified: true, passed: 9, failed: 0, unknown: 0, total: 9 } };
  };
  const rows = [audited('BRK1', 101, { eps: 40 }), audited('BRK2', 101.2, { eps: 10 }), audited('TCH1', 100, { eps: null }), audited('NEA1', 97)];
  const day = { bundle: { data: { date: DATE, rankings: { minervini: rows } }, isLoading: false, isError: false }, manifest: { isLoading: false, isError: false }, ranked: rows, date: DATE, market: null, version: 'v1' };
  const show = (filter, { setListState = () => {}, data = day, wide = true, sort = 'priority' } = {}) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ListView brief={data} kind="list" watch={[]} open={() => {}} now={0} animate={false} listState={{ filter, sort, query: '' }} setListState={setListState}
      limits={{}} setLimits={() => {}} origin={null} wide={wide} onUnwatch={() => {}} />
  </QueryClientProvider>);

  it('offers the breakout and EPS filters in one 条件 menu, never as segment buttons, each with its count and its 未確認', () => {
    const { getByRole } = show('zone');
    const menu = getByRole('combobox', { name: '条件で絞り込む' });
    expect([...menu.querySelectorAll('option')].map(option => [option.value, option.textContent, option.disabled])).toEqual([['', '条件', false], ['breakout', '10/2の上抜け（該当2・未確認0）', false], ['eps', 'EPS前年比≥25%（直近・SEC）（該当1・未確認2）', false]]);
    expect(menu.value).toBe('');
    expect(within(getByRole('group', { name: '絞り込み' })).getAllByRole('button')).toHaveLength(4);
    // The sort offers the EPS change while the publication carries it.
    expect([...getByRole('combobox', { name: '並び順' }).querySelectorAll('option')].map(option => option.textContent)).toContain('EPS前年比');
  });

  it('lists the day\'s breakouts under a dismissible chip, and the menu shows the filter while it is on', () => {
    let state = { filter: 'zone' };
    const { getByRole, unmount } = show('zone', { setListState: update => { state = update(state); } });
    fireEvent.change(getByRole('combobox', { name: '条件で絞り込む' }), { target: { value: 'breakout' } });
    expect(state.filter).toBe('breakout');
    unmount();
    const shown = show('breakout', { setListState: update => { state = update(state); } });
    expect(shown.getAllByTestId('brief-candidate').map(node => node.dataset.symbol)).toEqual(['BRK1', 'BRK2']);
    // The menu always reads 条件 (narrow on a phone); the chip says the filter in full with its counts.
    expect(shown.getByRole('combobox', { name: '条件で絞り込む' }).value).toBe('');
    const chip = shown.getByRole('button', { name: '10/2の上抜け該当2・未確認0（絞り込みを解除）' });
    chip.click();
    expect(state.filter).toBe('zone');
  });

  it('counts the EPS filter\'s matches and its unknowns apart, never an unknown as a miss', () => {
    const { getByRole, getAllByTestId } = show('eps');
    expect(getAllByTestId('brief-candidate').map(node => node.dataset.symbol)).toEqual(['BRK1']);
    expect(getByRole('button', { name: 'EPS前年比≥25%（直近・SEC）該当1・未確認2（絞り込みを解除）' })).toBeTruthy();
  });

  it('says 選定すべて\'s population while it is on', () => {
    expect(show('all').container.querySelector('.brief-population')).toHaveTextContent('選定すべて：TT 8/8＋株価$10以上・売買代金$2,000万以上');
    cleanup();
    expect(show('zone').container.querySelector('.brief-population')).toBeNull();
  });

  it('paints 20 rows first on the desktop and the rest once idle, in the same order; a phone gets its page at once', () => {
    vi.useFakeTimers();
    try {
      const many = Array.from({ length: 30 }, (_, i) => audited(`Z${String(i).padStart(2, '0')}`, 100 + (i % 4) * 0.5));
      const data = { ...day, bundle: { ...day.bundle, data: { date: DATE, rankings: { minervini: many } } }, ranked: many };
      const { getAllByTestId } = show('all', { data });
      const first = getAllByTestId('brief-candidate').map(node => node.dataset.symbol);
      expect(first).toHaveLength(20);
      act(() => { vi.runAllTimers(); });
      const all = getAllByTestId('brief-candidate').map(node => node.dataset.symbol);
      expect(all).toHaveLength(30);
      expect(all.slice(0, 20)).toEqual(first);
      cleanup();
      expect(show('all', { data, wide: false }).getAllByTestId('brief-candidate')).toHaveLength(30);
    } finally { vi.useRealTimers(); }
  });
});

// Review fixes (rules 1 and 15): a publication without sec_summary says 未収録, a filter that judged no stock says why,
// and an unverified day is counted apart from the day's breakouts; the qualified lists leave TT 8/8 out at every width.
describe('the 条件 menu and its empty states, honestly', () => {
  const audited = (symbol, price, { change = 2, volume = 1.6, eps, audit = true } = {}) => {
    const row = withAuditFixture({ symbol, company_name: symbol, market: 'US', currency: 'USD', current_price: price, se_pivot_price: 100, rs_rating: 90,
      ...(eps === undefined ? {} : { sec_summary: { sec_state: 'ok', eps_yoy: eps === null ? null : { value: eps, end: '2026-06-30' }, sales_yoy: null, code33: null, as_of_date: DATE } }) }, DATE);
    Object.assign(row.technical_audit.values, { change, volumeRatio: volume });
    if (!audit) delete row.technical_audit;
    return { row, assessment: { qualified: true, passed: 9, failed: 0, unknown: 0, total: 9 } };
  };
  const day = rows => ({ bundle: { data: { date: DATE, rankings: { minervini: rows } }, isLoading: false, isError: false }, manifest: { isLoading: false, isError: false }, ranked: rows, date: DATE, market: null, version: 'v1' });
  const show = (filter, rows, { wide = true } = {}) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ListView brief={day(rows)} kind="list" watch={[]} open={() => {}} now={0} animate={false} listState={{ filter, sort: 'priority', query: '' }} setListState={() => {}}
      limits={{}} setLimits={() => {}} origin={null} wide={wide} onUnwatch={() => {}} />
  </QueryClientProvider>);
  const options = (container, name) => [...within(container).getByRole('combobox', { name }).querySelectorAll('option')].map(option => [option.textContent, option.disabled]);

  it('says the EPS filter is not in this publication (未収録) when no row carries sec_summary, and offers no EPS sort', () => {
    const { container } = show('zone', [audited('BRK1', 101), audited('TCH1', 100)]);
    expect(options(container, '条件で絞り込む')).toContainEqual(['EPS前年比≥25%（この公開は未収録）', true]);
    expect(options(container, '条件で絞り込む').map(([text]) => text).join(' ')).not.toMatch(/該当0/);
    expect(options(container, '並び順').map(([text]) => text)).not.toContain('EPS前年比');
    cleanup();
    // A chip left on from an earlier publication that carried the field: 未収録, never 該当0.
    expect(show('eps', [audited('BRK1', 101)]).container.querySelector('.brief-filterchip')).toHaveTextContent('EPS前年比≥25%（直近・SEC）未収録');
  });

  it('says why a filter with no hit judged nothing: the stocks it could not judge, never 「no such stock」 alone', () => {
    const { container } = show('eps', [audited('AAA', 101, { eps: null }), audited('BBB', 100, { eps: 10 }), audited('CCC', 97)]);
    expect(container.querySelector('.brief-filterchip')).toHaveTextContent('EPS前年比≥25%（直近・SEC）該当0・未確認2');
    expect(container.querySelector('.brief-card .brief-note')).toHaveTextContent('該当なし。ほか2銘柄はSECのEPS前年比が未確認のため判定していません。');
    cleanup();
    // Every stock judged: the plain sentence.
    expect(show('eps', [audited('BBB', 100, { eps: 10 })]).container.querySelector('.brief-card .brief-note')).toHaveTextContent('この条件の選定銘柄はありません。');
  });

  it('counts a zone row whose day is not verified apart from the day\'s breakouts', () => {
    const rows = [audited('BRK1', 101), audited('UNV1', 101, { audit: false }), audited('UNV2', 100.5, { audit: false }), audited('NEA1', 97)];
    const { container } = show('zone', rows);
    expect(options(container, '条件で絞り込む')[1]).toEqual(['10/2の上抜け（該当1・未確認2）', false]);
    cleanup();
    const none = show('breakout', [audited('UNV1', 101, { audit: false }), audited('AFT1', 102, { change: 1 })]).container;
    expect(none.querySelector('.brief-filterchip')).toHaveTextContent('10/2の上抜け該当0・未確認1');
    expect(none.querySelector('.brief-card .brief-note')).toHaveTextContent('該当なし。ほか1銘柄は分析基準日の値動き（終値・前日比）が未検証のため判定していません。');
  });

  it('leaves the constant TT 8/8 chip out of the qualified lists on a phone and the desktop, keeps it on a tablet\'s wide rows', () => {
    const chips = () => [...document.querySelectorAll('.brief-chip')].map(node => node.textContent);
    show('zone', [audited('BRK1', 101)], { wide: true });
    expect(chips()).not.toContain('TT 8/8');
    expect(document.body.textContent).toContain('選定すべての行はすべてTT 8/8のため、「TT 8/8」の表示を省いています');
    cleanup();
    window.matchMedia = query => ({ matches: /max-width:\s*520px/.test(query), media: query, addEventListener() {}, removeEventListener() {} });
    try {
      show('zone', [audited('BRK1', 101)], { wide: false });
      expect(chips()).not.toContain('TT 8/8');
      cleanup();
    } finally { delete window.matchMedia; }
    show('zone', [audited('BRK1', 101)], { wide: false });
    expect(chips()).toContain('TT 8/8');
  });

  it('keeps the search placeholder in the app\'s word for a ticker', () => {
    expect(show('zone', [audited('BRK1', 101)]).container.querySelector('.brief-search input').getAttribute('placeholder')).toBe('ティッカー・社名');
  });

  it('says 並び順 in the sort\'s first option on the desktop\'s narrow column (its label for assistive tech), and as a label on a tablet', () => {
    const { container } = show('zone', [audited('BRK1', 101)], { wide: true });
    expect(options(container, '並び順')[0][0]).toBe('並び順：優先度');
    expect(container.querySelector('.brief-sort-name')).toHaveClass('sr-only');
    cleanup();
    const tablet = show('zone', [audited('BRK1', 101)], { wide: false }).container;
    expect(options(tablet, '並び順')[0][0]).toBe('優先度');
    expect(tablet.querySelector('.brief-sort-name')).not.toHaveClass('sr-only');
  });
});
