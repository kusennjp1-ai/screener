// Today's watch tile (TodayView, E): only a broken setup is counted (no holding is registered), 0件 only when
// every check of every watched stock is in, and unlisted, unchecked, limited and partly checked stocks are said
// (n/N, a third of the width), never counted as checked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TodayView, { watchAttention } from './TodayView';
import { withAuditFixture } from '../testAuditFixture';

// The round-2 seams Today calls (plan §2.2): each records its arguments and answers as its owner's module does,
// unless a test sets a value (undefined: the real body; null at step 0) to see where that value shows.
const seams = vi.hoisted(() => ({ suffix: undefined, warning: undefined, suffixCalls: [], warningCalls: [] }));
vi.mock('./briefEnvironment', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, marketTileSuffix: (...args) => { seams.suffixCalls.push(args); return seams.suffix === undefined ? actual.marketTileSuffix(...args) : seams.suffix; } };
});
vi.mock('../fundamentalsExplain.js', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, fundamentalsCoverageWarning: (...args) => { seams.warningCalls.push(args); return seams.warning === undefined ? actual.fundamentalsCoverageWarning(...args) : seams.warning; } };
});

const view = symbol => ({ symbol });
const quiet = { strength: [], weakness: [], hits: 0, strengthHits: 0, weaknessHits: 0, breakdownHits: 0, unknowns: 0 };
const weak = { ...quiet, hits: 1, weaknessHits: 1, breakdownHits: 1 };
const climax = { ...quiet, hits: 4, strengthHits: 4 };
// The advance's largest down day alone: a holder's signal, not a broken setup.
const pullback = { ...quiet, hits: 1, weaknessHits: 1 };
// A weakness check whose inputs are missing (the book's diagnostics), nothing broken.
const partly = { ...quiet, unknowns: 1 };
const tile = over => watchAttention({ state: 'ready', watched: [], watchCount: 0, unlisted: [], sells: {}, ...over });

describe('the watch tile', () => {
  it('reads 0件 only when every watched stock was checked, with 保有未登録', () => {
    expect(tile({ watched: ['A', 'B', 'C', 'D'].map(view), watchCount: 4, sells: { A: quiet, B: quiet, C: quiet, D: quiet } }))
      .toEqual({ value: '0件', note: '4銘柄を確認・保有未登録', flagged: [] });
  });

  it('counts the broken setups; a climax or the advance\'s largest down day alone is a holding\'s signal and is not counted', () => {
    expect(tile({ watched: ['A', 'B', 'C', 'D'].map(view), watchCount: 4, sells: { A: weak, B: climax, C: quiet, D: pullback } }))
      .toEqual({ value: '1件', note: '4銘柄を確認・保有未登録', flagged: ['A'] });
    expect(tile({ watched: ['A', 'B'].map(view), watchCount: 2, sells: { A: climax, B: pullback } }).value).toBe('0件');
  });

  it('a stock with a weakness check left unknown is partly checked: 未確認, never 0件', () => {
    expect(tile({ watched: ['A', 'B', 'C'].map(view), watchCount: 3, sells: { A: quiet, B: quiet, C: partly } }))
      .toEqual({ value: '未確認', note: '2/3を確認・一部未確認1・保有未登録', flagged: [] });
    // A broken setup is counted even when another of its checks is unknown.
    expect(tile({ watched: ['A', 'B'].map(view), watchCount: 2, sells: { A: { ...weak, unknowns: 1 }, B: quiet } }))
      .toEqual({ value: '1件', note: '2銘柄を確認・保有未登録', flagged: ['A'] });
  });

  it('says 確認中 while checks load, never 0件', () => {
    expect(tile({ watched: ['A', 'B'].map(view), watchCount: 2, sells: { A: quiet } })).toEqual({ value: '確認中', note: '2銘柄を確認中・保有未登録', flagged: [] });
    // A fired check is counted as soon as it is in.
    expect(tile({ watched: ['A', 'B'].map(view), watchCount: 2, sells: { A: weak } }).value).toBe('1件');
  });

  it('says unlisted symbols: 6/7を確認・対象外1', () => {
    const watched = ['A', 'B', 'C', 'D', 'E', 'F'].map(view);
    const result = tile({ watched, watchCount: 7, unlisted: ['QQQX'], sells: Object.fromEntries(watched.map(v => [v.symbol, quiet])) });
    expect(result).toEqual({ value: '未確認', note: '6/7を確認・対象外1・保有未登録', flagged: [] });
    expect(tile({ watchCount: 1, unlisted: ['QQQX'] })).toEqual({ value: '未確認', note: '0/1を確認・対象外1・保有未登録', flagged: [] });
    // A broken setup is still counted beside an unlisted symbol.
    expect(tile({ watched: ['A', 'B'].map(view), watchCount: 3, unlisted: ['QQQX'], sells: { A: weak, B: quiet } }))
      .toEqual({ value: '1件', note: '2/3を確認・対象外1・保有未登録', flagged: ['A'] });
  });

  it('says the 12-stock limit and other unchecked stocks as text', () => {
    const watched = Array.from({ length: 13 }, (_, i) => view(`S${i}`));
    const sells = Object.fromEntries(watched.map((v, i) => [v.symbol, i < 12 ? quiet : { unknown: true, limit: 12, reason: '確認は先頭12銘柄まで' }]));
    expect(tile({ watched, watchCount: 13, sells })).toEqual({ value: '未確認', note: '12/13を確認・上限超1・保有未登録', flagged: [] });
    expect(tile({ watched: ['A', 'B'].map(view), watchCount: 2, sells: { A: quiet, B: { unknown: true, reason: '日足を取得できません' } } }).note).toBe('1/2を確認・未確認1・保有未登録');
  });

  it('keeps the bundle\'s state before anything is counted, and 未登録 only for an empty watch list', () => {
    expect(tile({ state: 'loading', watchCount: 3 })).toEqual({ value: '読込中', note: '3銘柄を登録', flagged: [] });
    expect(tile({ state: 'error', watchCount: 1 })).toEqual({ value: '取得できません', note: '1銘柄を登録', flagged: [] });
    expect(tile({})).toEqual({ value: '未登録', note: '☆で追加', flagged: [] });
    expect(tile({ state: 'loading' })).toEqual({ value: '未登録', note: '☆で追加', flagged: [] });
  });
});

// Today reads Track D's market-aware seams (I4, requested by Track D): the heading note with the bundle's
// state, the watch rows' event under the market, and the earnings countdown from the later of the analysis
// date and today.
describe('Today under the market verdict and the earnings date', () => {
  afterEach(cleanup);
  const DATE = '2026-10-02';
  const item = (symbol, price, earnings) => ({ row: { symbol, company_name: symbol, current_price: price, se_pivot_price: 100, ...(earnings ? { entry_evidence: { earnings: { date: earnings } } } : {}) },
    assessment: { qualified: true, passed: 8, failed: 0, unknown: 0, total: 8 } });
  const show = ({ market = null, ranked, watch = [], now = Date.parse(`${DATE}T20:00:00Z`) }) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>
    <TodayView brief={{ bundle: { data: { date: DATE, rankings: { minervini: ranked } }, isLoading: false, isError: false }, manifest: { isLoading: false, isError: false }, ranked, date: DATE, market, marketLoading: false, trends: null, version: 'v1' }}
      watch={watch} open={() => {}} now={now} animate={false} wide nav={{ market() {}, list() {}, watch() {} }} onUnwatch={() => {}} />
  </MemoryRouter></QueryClientProvider>);
  const watchRow = symbol => screen.getByRole('region', { name: 'ウォッチの状況' }).querySelector(`[data-symbol="${symbol}"]`);

  it('says 地合い未確認 after the heading when a ready bundle has no market verdict', () => {
    show({ ranked: [item('ZON1', 101)] });
    expect(screen.getByRole('heading', { level: 2, name: /^注目候補/ })).toHaveTextContent('注目候補（地合い未確認）');
  });

  it('keeps a watched stock in the buy zone out of green while the market holds new buys', () => {
    show({ ranked: [item('ZON1', 101)], watch: ['ZON1'], market: { label: '調整中（独自判定）', state: 'correction', cap: 0 } });
    expect(watchRow('ZON1').querySelector('.brief-event-icon').className).toContain('tone-neutral');
    cleanup();
    show({ ranked: [item('ZON1', 101)], watch: ['ZON1'], market: { label: '上昇トレンド（独自判定）', state: 'confirmed_uptrend', cap: 0.5 } });
    expect(watchRow('ZON1').querySelector('.brief-event-icon').className).toContain('tone-zone');
  });

  it('counts the earnings days from today when the analysis is older, and says 決算当日 on the day', () => {
    show({ ranked: [item('NEA1', 97, '2026-10-05'), item('DAY1', 97, '2026-10-03'), item('FAR1', 97, '2026-10-30')], watch: ['NEA1', 'DAY1', 'FAR1'], now: Date.parse('2026-10-03T15:00:00Z') });
    const line = symbol => watchRow(symbol).querySelector('small').textContent;
    expect(line('NEA1')).toMatch(/・決算まで2日$/);
    expect(line('DAY1')).toMatch(/・決算当日$/);
    expect(line('FAR1')).not.toContain('決算');
  });
});

// The 地合い tile's suffix (market's marketTileSuffix) and the SEC coverage line (data's fundamentalsCoverageWarning):
// Today asks for both and shows nothing while they are null, as at step 0.
describe('the round-2 seams on Today', () => {
  const DATE = '2026-10-02';
  const OPEN = { label: '上昇トレンド（独自判定）', state: 'confirmed_uptrend', cap: 0.5 };
  const block = { schema_version: 'fundamentals-coverage-v1', as_of_date: DATE, sec_fetch_ran: true, sec_as_of: DATE, file_schema: 2, universe: 993, requested: 600,
    eligible: 1200, truncated: 0, deadline_unreached: 0, ticker_map_ok: true, admitted: 580, with_quarters: 540, not_requested: 393, not_fetched: 0, refused: 20, refused_by_reason: { cik_url: 20 } };
  const manifest = { as_of_date: DATE, markets: { US: { as_of_date: DATE, fundamentals_coverage: block } } };
  const trends = { data: { indices: [] }, isLoading: false };
  const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>
    <TodayView brief={{ bundle: { data: { date: DATE, rankings: { minervini: [] } }, isLoading: false, isError: false }, manifest: { data: manifest, isLoading: false, isError: false }, ranked: [], date: DATE, market: OPEN, marketLoading: false, trends, version: 'v1' }}
      watch={[]} open={() => {}} now={Date.parse(`${DATE}T20:00:00Z`)} animate={false} wide nav={{ market() {}, list() {}, watch() {} }} onUnwatch={() => {}} />
  </MemoryRouter></QueryClientProvider>);
  const note = () => screen.getByTestId('brief-summary').querySelector('li em').textContent;
  afterEach(() => { cleanup(); Object.assign(seams, { suffix: undefined, warning: undefined, suffixCalls: [], warningCalls: [] }); });

  it('asks for the 地合い suffix with the market, the trends and the manifest, and appends one only when there is one', () => {
    show();
    expect(seams.suffixCalls.at(-1)).toEqual([{ market: OPEN, trends, manifest }]);
    expect(note()).toBe('検討可・目安≤50%');
    cleanup();
    seams.suffix = '〈suffix〉';
    show();
    // The cap, then the suffix on its own line (a separator for assistive tech): two lines, as without it.
    expect(note()).toBe('目安≤50%・〈suffix〉');
    expect(screen.getByTestId('brief-summary').querySelector('li em .brief-tile-suffix')).toHaveTextContent('〈suffix〉');
  });

  it('asks for the coverage warning with this date\'s published block and shows it as one line under the market card', () => {
    show();
    expect(seams.warningCalls.at(-1)).toEqual([block, { date: DATE }]);
    // Found by Today's own structure (the line just before the 注目候補 section), never through MarketCard's markup.
    const beforeFocus = () => document.getElementById('brief-focus-title').closest('section').previousElementSibling;
    expect(beforeFocus()?.matches('p.brief-note')).toBe(false);
    expect(screen.queryByText('〈warning〉')).toBeNull();
    cleanup();
    seams.warning = { text: '〈warning〉' };
    show();
    const line = beforeFocus();
    expect([line.tagName, line.className, line.textContent]).toEqual(['P', 'brief-note brief-coverage-note', '〈warning〉']);
  });
});

// Round 2 (rows): the 注目候補 tile's 「うち上抜けN」, the watch rows in the rows' short form, the tiles' date for
// assistive tech, a late publication in Today's notes, and the new order stated in the note.
describe('round 2 on Today', () => {
  afterEach(() => { cleanup(); Object.assign(seams, { suffix: undefined, warning: undefined, suffixCalls: [], warningCalls: [] }); });
  const DATE = '2026-10-02';
  const OPEN = { label: '上昇トレンド（独自判定）', state: 'confirmed_uptrend', cap: 0.5 };
  // A row audited for DATE: close `price` against a pivot of 100, the day's change and volume ratio.
  const audited = (symbol, price, change = 2, volume = 1.6) => {
    const row = withAuditFixture({ symbol, company_name: symbol, market: 'US', currency: 'USD', current_price: price, se_pivot_price: 100, rs_rating: 90 }, DATE);
    Object.assign(row.technical_audit.values, { change, volumeRatio: volume });
    return { row, assessment: { qualified: true, passed: 9, failed: 0, unknown: 0, total: 9 } };
  };
  const show = ({ ranked, watch = [], wide = true, ageNote = null, list = () => {} }) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>
    <TodayView brief={{ bundle: { data: { date: DATE, rankings: { minervini: ranked } }, isLoading: false, isError: false }, manifest: { isLoading: false, isError: false }, ranked, date: DATE, market: OPEN, marketLoading: false, trends: null, version: 'v1' }}
      watch={watch} open={() => {}} now={Date.parse(`${DATE}T20:00:00Z`)} animate={false} wide={wide} nav={{ market() {}, list, watch() {} }} onUnwatch={() => {}} ageNote={ageNote} />
  </MemoryRouter></QueryClientProvider>);
  const tiles = () => [...screen.getByTestId('brief-summary').querySelectorAll('li')];

  it('says 「うち上抜けN」 on the 注目候補 tile only when the day has breakouts, as a link to that filter', () => {
    const opened = [];
    show({ ranked: [audited('BRK1', 101), audited('BRK2', 101.5), audited('TCH1', 100), audited('NEA1', 97)], list: filter => opened.push(filter) });
    const link = screen.getByTestId('brief-breakout-link');
    expect(link).toHaveTextContent('うち上抜け2 ›');
    expect(link.getAttribute('href')).toBe('/brief/list');
    expect(link.closest('li')).toBe(tiles()[1]);
    // Never nested in the tile's own link.
    expect(link.parentElement.closest('a')).toBeNull();
    link.click();
    expect(opened).toEqual(['breakout']);
    cleanup();
    show({ ranked: [audited('TCH1', 100), audited('NEA1', 97)] });
    expect(screen.queryByTestId('brief-breakout-link')).toBeNull();
    expect(tiles()[1].textContent).not.toContain('上抜け');
  });

  it('names the analysis date in each tile for assistive tech, the visible text unchanged', () => {
    show({ ranked: [audited('TCH1', 100)] });
    for (const li of tiles()) expect(li.querySelector('a .sr-only')).toHaveTextContent('・10/2（金）引け時点');
    expect(tiles()[1].querySelector('em').textContent).toBe('ゾーン1・接近0');
  });

  it('shows a watched stock in the same short form as its focus row', () => {
    show({ ranked: [audited('TCH1', 100), audited('BRK1', 101)], watch: ['TCH1', 'BRK1'] });
    const focusChip = symbol => screen.getByRole('region', { name: '注目候補' }).querySelector(`[data-symbol="${symbol}"] .brief-chip`).textContent;
    const watchTitle = symbol => screen.getByRole('region', { name: 'ウォッチの状況' }).querySelector(`[data-symbol="${symbol}"]`).textContent;
    expect(focusChip('TCH1')).toBe('● 10/2ピボット到達');
    expect(watchTitle('TCH1')).toMatch(/^●TCH1 10\/2ピボット到達/);
    expect(focusChip('BRK1')).toBe('↗ 10/2上抜け 1.60×');
    expect(watchTitle('BRK1')).toMatch(/^↗BRK1 10\/2上抜け 1\.60×/);
  });

  it('puts a late publication\'s sentence first in the phone\'s notes, and states the new order in the note', () => {
    show({ ranked: [audited('TCH1', 100)], wide: false, ageNote: '〈age〉' });
    const notes = [...document.querySelectorAll('.brief-screen-notes li')].map(li => li.textContent);
    expect(notes[0]).toBe('〈age〉');
    expect(notes[1]).toMatch(/^注目候補はすべてトレンドテンプレート8条件を満たす銘柄（TT 8\/8）です。/);
    expect(notes[1]).toContain('その日の上抜け → ピボット到達・出来高の裏付けのない上抜け → 上抜け後（当日未検証を含む） → 下落日の大商い');
    expect(notes[1]).not.toContain('達成数');
    cleanup();
    show({ ranked: [audited('TCH1', 100)], wide: false });
    expect(document.querySelectorAll('.brief-screen-notes li')).toHaveLength(1);
  });
});

// Review fixes: the coverage sentence in full on a wide screen, the base chip's rule on Today when a focus row carries
// it, a watched focus candidate in its row's words, and the 「うち上抜けN」 strip's markup (the watch card's fold needs
// every sell check in, so brief-watch.spec.js tests it in the browser).
describe('Today after the review', () => {
  const DATE = '2026-10-02';
  const OPEN = { label: '上昇トレンド（独自判定）', state: 'confirmed_uptrend', cap: 0.5 };
  const audited = (symbol, price, { change = 2, volume = 1.6, extra = {} } = {}) => {
    const row = withAuditFixture({ symbol, company_name: symbol, market: 'US', currency: 'USD', current_price: price, se_pivot_price: 100, rs_rating: 90, ...extra }, DATE);
    Object.assign(row.technical_audit.values, { change, volumeRatio: volume });
    return { row, assessment: { qualified: true, passed: 9, failed: 0, unknown: 0, total: 9 } };
  };
  const atPhone = phone => { window.matchMedia = query => ({ matches: /max-width:\s*520px/.test(query) ? phone : false, media: query, addEventListener() {}, removeEventListener() {} }); };
  const show = ({ ranked, watch = [], wide = true }) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>
    <TodayView brief={{ bundle: { data: { date: DATE, rankings: { minervini: ranked } }, isLoading: false, isError: false }, manifest: { isLoading: false, isError: false }, ranked, date: DATE, market: OPEN, marketLoading: false, trends: null, version: 'v1' }}
      watch={watch} open={() => {}} now={Date.parse(`${DATE}T20:00:00Z`)} animate={false} wide={wide} nav={{ market() {}, list() {}, watch() {} }} onUnwatch={() => {}} />
  </MemoryRouter></QueryClientProvider>);
  afterEach(() => { cleanup(); delete window.matchMedia; sessionStorage.clear(); Object.assign(seams, { suffix: undefined, warning: undefined, suffixCalls: [], warningCalls: [] }); });

  it('shows the coverage sentence in full on a wide screen and the short form on a phone, the sentence then in its title and notes', () => {
    seams.warning = { text: '〈full sentence〉', short: '〈short〉' };
    show({ ranked: [audited('TCH1', 100)] });
    expect(document.querySelector('.brief-coverage-note').textContent).toBe('〈full sentence〉');
    expect(document.querySelector('.brief-coverage-note').getAttribute('title')).toBeNull();
    cleanup();
    atPhone(true);
    show({ ranked: [audited('TCH1', 100)], wide: false });
    const line = document.querySelector('.brief-coverage-note');
    expect([line.textContent, line.getAttribute('title')]).toEqual(['〈short〉', '〈full sentence〉']);
    expect([...document.querySelectorAll('.brief-screen-notes li')].map(li => li.textContent)).toContain('〈full sentence〉');
  });

  it('states the base chip\'s rule (独自判定) with Today\'s notes only when a focus row carries the chip', () => {
    const deep = audited('DEEP', 100, { extra: { se_base_depth_pct: 40, se_base_length_weeks: 6, setup_recalculation: { status: 'calculated', as_of_date: DATE } } });
    show({ ranked: [deep] });
    expect(screen.getByRole('region', { name: '注目候補' }).querySelector('p.brief-note:last-child').textContent).toContain('土台の注意：Setup Engineの土台が深さ35%超または3週未満、または終値が50日線より25%超上（独自判定）。');
    cleanup();
    show({ ranked: [audited('TCH1', 100)] });
    expect(screen.getByRole('region', { name: '注目候補' }).textContent).not.toContain('土台の注意');
  });

  it('puts the caution in the RS chip\'s place on a phone\'s focus rows', () => {
    atPhone(true);
    const deep = audited('DEEP', 100, { extra: { se_base_depth_pct: 40.2, se_base_length_weeks: 6, setup_recalculation: { status: 'calculated', as_of_date: DATE } } });
    show({ ranked: [deep], wide: false });
    const chips = [...screen.getByRole('region', { name: '注目候補' }).querySelectorAll('[data-symbol="DEEP"] .brief-chip')].map(node => node.textContent);
    expect(chips).toEqual(['● 10/2ピボット到達', '出来高 1.60×', '土台−40%']);
  });

  it('says a watched focus candidate near its pivot in its row\'s words', () => {
    show({ ranked: [audited('NEA1', 98.8)], watch: ['NEA1'] });
    const focusChip = screen.getByRole('region', { name: '注目候補' }).querySelector('[data-symbol="NEA1"] .brief-chip').textContent;
    const watchTitle = screen.getByRole('region', { name: 'ウォッチの状況' }).querySelector('[data-symbol="NEA1"]').textContent;
    expect(focusChip).toBe('◔ ピボット接近 −1.2%');
    expect(watchTitle).toContain('NEA1 ピボット接近 −1.2%');
    expect(watchTitle).not.toMatch(/あと/);
  });

  it('keeps a heavy down day\'s ▲ on the watch card for a watched stock that is not TT 8/8, as its watch-tab row does', () => {
    const heavy = audited('HVY1', 101, { change: -1, volume: 1.6 });
    heavy.assessment = { qualified: false, passed: 7, failed: 1, unknown: 0, total: 9 };
    show({ ranked: [heavy], watch: ['HVY1'] });
    const row = screen.getByRole('region', { name: 'ウォッチの状況' }).querySelector('[data-symbol="HVY1"]');
    expect(row.querySelector('.brief-event-icon')).toHaveClass('tone-ext');
    expect(row.querySelector('.brief-event-icon').textContent).toBe('▲');
    expect(row.textContent).toContain('HVY1 下落日の大商い 1.60×（TT未達）');
  });

  it('draws 「うち上抜けN」 as one run that can break only after うち', () => {
    show({ ranked: [audited('BRK1', 101)] });
    const link = screen.getByTestId('brief-breakout-link');
    expect(link.innerHTML).toBe('<span>うち<span class="brief-nowrap">上抜け1<span aria-hidden="true"> ›</span></span></span>');
    expect(link.closest('li').classList.contains('has-sub')).toBe(true);
    expect(link.closest('li').querySelector('.brief-tile-room')).toBeNull();
  });
});
