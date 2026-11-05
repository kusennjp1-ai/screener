import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BarQuote, CandidateRow, DayChange, Expander, Parts, Reasons, RiseItem, ScreenNotes, StateChip, Toast } from './BriefParts';
import * as primitives from './briefPrimitives';

afterEach(cleanup);

const view = (over = {}) => ({
  symbol: 'AAA', name: 'Alpha', sector: 'Technology', state: 'zone', position: 'zone', stateLabel: '買いゾーン', stateGlyph: '●',
  distance: 1.2, volumeRatio: 1.6, change: 2, rs: 88, rsLineHigh: false, qualified: true, passed: 8, failed: 0, unknown: 0, earnings: null, ...over,
});
const chipTexts = container => [...container.querySelectorAll('.brief-chip')].map(chip => chip.textContent);
// prepared.market as modelMarket returns it: rows render with the screen's verdict (open unless a test says otherwise).
const OPEN = { label: '上昇トレンド（独自判定）', cap: 0.5 };
const row = (props = {}) => render(<ol><CandidateRow view={view()} rank={1} onOpen={() => {}} now={0} animate={false} context={{ market: OPEN }} {...props} /></ol>);
const toneOf = node => [...node.classList].find(name => name.startsWith('tone-')) || null;

describe('brief rows', () => {
  it('says an unknown pivot distance in the state chip, since phones hide the mini meter', () => {
    const { container } = render(<StateChip view={view({ state: 'wait', position: 'near', stateLabel: 'ピボット接近', stateGlyph: '◔', distance: null })} />);
    expect(container.textContent).toContain('ピボット接近・ピボット比 未確認');
  });

  it('shows a known pivot distance in the state chip without 未確認', () => {
    const { container } = render(<StateChip view={view({ distance: 1.2 })} />);
    expect(container.textContent).toContain('+1.2%');
    expect(container.textContent).not.toContain('未確認');
  });

  it('drops the constant TT 8/8 chip only on Today\'s focus rows', () => {
    expect(chipTexts(row({ hideTemplate: true }).container).some(text => text.startsWith('TT'))).toBe(false);
    cleanup();
    expect(chipTexts(row().container)).toContain('TT 8/8');
    cleanup();
    expect(chipTexts(row({ view: view({ qualified: false, passed: 7, failed: 1, unknown: 0 }) }).container)).toContain('あと1条件');
  });

  it('keeps the row label and gives an unranked (watch) row no rank gutter class', () => {
    const ranked = row().container.querySelector('.brief-row');
    expect(ranked.getAttribute('aria-label')).toBe('1位 AAA Alpha、買いゾーン +1.2%、前日比 +2.0%、RS推計 88');
    expect(ranked.classList.contains('is-unranked')).toBe(false);
    cleanup();
    const watched = row({ rank: null }).container.querySelector('.brief-row');
    expect(watched.getAttribute('aria-label')).toBe('AAA Alpha、買いゾーン +1.2%、前日比 +2.0%、RS推計 88');
    expect(watched.classList.contains('is-unranked')).toBe(true);
  });

  it('hides the ▲ glyphs of the sell and earnings chips from assistive technology', () => {
    const { container } = row({ view: view({ earnings: { date: '2026-10-08', days: 6 } }), sell: { hits: 2 } });
    const chips = [...container.querySelectorAll('.brief-chip.tone-ext')];
    expect(chips.map(chip => chip.textContent)).toEqual(['▲ 売りのサイン 2件', '▲ 決算まで6日']);
    for (const chip of chips) {
      const glyph = [...chip.querySelectorAll('[aria-hidden="true"]')].find(node => node.textContent === '▲');
      expect(glyph).toBeTruthy();
      expect([...chip.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('')).not.toContain('▲');
    }
  });
});

describe('rows say the day and the decision honestly', () => {
  it('floors a decimal RS estimate in the chip and the label', () => {
    const { container } = row({ view: view({ rs: 97.01283880171184 }) });
    expect(chipTexts(container)).toContain('RS推計 97');
    expect(container.querySelector('.brief-row').getAttribute('aria-label')).toMatch(/RS推計 97$/);
    expect(container.textContent).not.toContain('97.01');
    cleanup();
    expect(chipTexts(row({ view: view({ rs: 69.9 }) }).container)).toContain('RS推計 69');
  });

  it('puts the verified day change after the ticker, up and down in their text tokens, — with its reason when unknown', () => {
    const title = over => row({ view: view(over) }).container.querySelector('.brief-row-title');
    const up = title({ change: 2 }).querySelector('.brief-daychg');
    expect([up.classList.contains('is-up'), up.classList.contains('is-down'), up.textContent]).toEqual([true, false, '前日比 +2.0%']);
    cleanup();
    const down = title({ change: -0.4 }).querySelector('.brief-daychg');
    expect([down.classList.contains('is-down'), down.classList.contains('is-up')]).toEqual([true, false]);
    cleanup();
    const unknown = title({ change: null });
    const change = unknown.querySelector('.brief-daychg');
    expect(change.textContent).toBe('—前日比 未確認');
    // After the ticker, before the name.
    expect(unknown.querySelector('b').compareDocumentPosition(change) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(change.compareDocumentPosition(unknown.querySelector('.brief-row-name')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(unknown.closest('.brief-row').getAttribute('aria-label')).toContain('前日比 未確認');
    cleanup();
    expect(render(<DayChange view={{ change: 0 }} />).container.textContent).toBe('前日比 ±0.0%');
  });

  it('marks a heavy down day\'s volume as a warning, green only on a verified up day, neutral when the direction is unknown', () => {
    const volume = over => [...row({ view: view(over) }).container.querySelectorAll('.brief-chip')].find(node => node.textContent.includes('出来高'));
    const down = volume({ change: -1, volumeRatio: 1.6 });
    expect([toneOf(down), down.textContent]).toEqual(['tone-ext', '▲ 出来高 1.60×']);
    cleanup();
    expect(toneOf(volume({ change: 2 }))).toBe('tone-zone');
    cleanup();
    expect(toneOf(volume({ change: null }))).toBeNull();
    cleanup();
    expect(volume({ volumeRatio: 1.39 })).toBeUndefined();
    cleanup();
    // The ratio is floored, as the event titles show it: 1.996 never reads 2.00×.
    expect(volume({ change: 2, volumeRatio: 1.996 }).textContent).toBe('出来高 1.99×');
  });

  it('keeps the position of a stock that is not a buy candidate in a neutral tone', () => {
    for (const [state, position] of [['zone', 'zone'], ['wait', 'near'], ['ext', 'ext']]) {
      expect(toneOf(render(<StateChip view={view({ state, position, qualified: false })} />).container.firstChild)).toBe('tone-neutral');
      cleanup();
    }
    expect(toneOf(render(<StateChip view={view({ state: 'wait', position: 'base', stateLabel: '土台形成中', distance: -8 })} />).container.firstChild)).toBe('tone-neutral');
    cleanup();
    const stale = render(<StateChip view={view({ state: 'na', position: 'staleAbove', stateLabel: '旧ピボットから +32%・有効な買い水準なし', stateGlyph: '▲', distance: null, stale: { above: true } })} />).container.firstChild;
    expect([toneOf(stale), stale.textContent]).toEqual(['tone-ext', '▲ 旧ピボットから +32%・有効な買い水準なし']);
  });

  it('names the unmet rule of an あと1条件 row in one neutral chip, last, which carries the RS value when RS is that rule', () => {
    const one = over => row({ view: view({ qualified: false, passed: 8, failed: 1, unknown: 0, rs: 61.4, ...over }) }).container;
    const rs = one({ missing: { chip: 'あと1条件：RS ≥ 70（61）', text: '未達：RS ≥ 70（61）', rs: true } });
    expect(chipTexts(rs)).toEqual(['● 買いゾーン +1.2%', '出来高 1.60×', 'あと1条件：RS ≥ 70（61）']);
    expect(rs.querySelector('.brief-row').getAttribute('aria-label')).toBe('1位 AAA Alpha、買いゾーン +1.2%、前日比 +2.0%、未達：RS ≥ 70（61）、RS推計 61');
    const chip = [...rs.querySelectorAll('.brief-chip')].find(node => node.textContent.startsWith('あと1条件'));
    expect([toneOf(chip), chip.getAttribute('title')]).toEqual([null, '未達：RS ≥ 70（61）']);
    cleanup();
    // Another rule: the short chip, the full rule as its title and in the label, and the RS chip kept.
    const high = one({ rs: 90, missing: { chip: 'あと1条件：高値から25%以内', text: '未達：52週高値からの距離 ≤ 25%（30.3%）', rs: false } });
    expect(chipTexts(high)).toEqual(['● 買いゾーン +1.2%', '出来高 1.60×', 'RS推計 90', 'あと1条件：高値から25%以内']);
    expect(high.querySelector('[title]').getAttribute('title')).toBe('未達：52週高値からの距離 ≤ 25%（30.3%）');
    expect(high.querySelector('.brief-row').getAttribute('aria-label')).toContain('、未達：52週高値からの距離 ≤ 25%（30.3%）、');
  });

  it('gives a row that is not a buy candidate no green chip: the volume and the RS line stay neutral', () => {
    const { container } = row({ view: view({ qualified: false, passed: 7, failed: 1, unknown: 0, rsLineHigh: true, change: 2, volumeRatio: 1.8 }) });
    expect(chipTexts(container)).toEqual(['● 買いゾーン +1.2%', 'あと1条件', '出来高 1.80×', 'RS推計 88', 'RS線 新高値']);
    expect(container.querySelectorAll('.tone-zone')).toHaveLength(0);
    cleanup();
    // A heavy down day still warns.
    expect(row({ view: view({ qualified: false, failed: 1, unknown: 0, change: -1 }) }).container.querySelectorAll('.tone-ext')).toHaveLength(1);
  });

  it('warns from the shared earnings constant: 10 days warns, 11 does not', () => {
    expect(chipTexts(row({ view: view({ earnings: { date: '2026-10-12', days: 10 } }) }).container)).toContain('▲ 決算まで10日');
    cleanup();
    expect(chipTexts(row({ view: view({ earnings: { date: '2026-10-13', days: 11 } }) }).container).some(text => text.includes('決算'))).toBe(false);
  });

  it('counts the earnings days from today when the analysis is older, in the same words as the stock screen', () => {
    // Analysis 10/2, earnings 10/12 (10 days); viewed on 10/5 in New York, it is 7 days away.
    const stale = { asOf: '2026-10-02', earnings: { date: '2026-10-12', days: 10 } };
    expect(chipTexts(row({ view: view(stale), now: Date.parse('2026-10-05T15:00:00Z') }).container)).toContain('▲ 決算まで7日');
    cleanup();
    expect(chipTexts(row({ view: view(stale), now: Date.parse('2026-10-12T15:00:00Z') }).container)).toContain('▲ 決算当日');
    cleanup();
    // A date passed since the analysis: the analysis predates the report.
    expect(chipTexts(row({ view: view(stale), now: Date.parse('2026-10-14T15:00:00Z') }).container)).toContain('▲ 決算日経過');
    cleanup();
    // 25 days away from the analysis, 9 from today: it warns.
    expect(chipTexts(row({ view: view({ asOf: '2026-10-02', earnings: { date: '2026-10-27', days: 25 } }), now: Date.parse('2026-10-18T15:00:00Z') }).container)).toContain('▲ 決算まで9日');
  });
});

// Step-0 seams D owns and other tracks call (BriefApp's bar, Today's and the list's rows).
describe('BriefParts seams', () => {
  it('BarQuote shows the price and the verified day change after the ticker, and nothing without a price', () => {
    const quote = view => render(<BarQuote view={view} />).container;
    const small = quote({ price: 110.74, change: -1.25 });
    expect([small.querySelector('.brief-bar-price').textContent.trim(), small.querySelector('.brief-bar-change').textContent]).toEqual(['$110.74', '前日比 −1.3%']);
    expect(small.querySelector('.brief-bar-price').compareDocumentPosition(small.querySelector('.brief-bar-change')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(small.querySelector('.brief-bar-change').classList.contains('is-down')).toBe(true);
    cleanup();
    // $1,000 and up drops the cents, so the change keeps its place on a 320px phone.
    expect(quote({ price: 1234.56, change: -12.34 }).textContent).toBe(' $1,235 前日比 −12.3%');
    cleanup();
    // An unverified change is a dash the screen reader says as 前日比 未確認, never 0%.
    const unknown = render(<BarQuote view={{ price: 10, change: null }} />).container;
    expect(unknown.querySelector('.brief-bar-change').textContent).toBe('—前日比 未確認');
    expect(unknown.textContent).not.toMatch(/[±+]0\.0%/);
    cleanup();
    for (const value of [null, undefined, {}, { price: null }]) { expect(render(<BarQuote view={value} />).container).toBeEmptyDOMElement(); cleanup(); }
  });

  it('draws the row\'s sell chip from sellChipView: ▲ only for a fired check, the reason as the title of an unknown one', () => {
    const chip = sell => [...render(<Reasons view={view()} now={0} sell={sell} />).container.querySelectorAll('.brief-chip')].find(node => node.textContent.includes('売りのサイン'));
    const hit = chip({ hits: 2 });
    expect([toneOf(hit), hit.textContent, hit.getAttribute('title')]).toEqual(['tone-ext', '▲ 売りのサイン 2件', null]);
    cleanup();
    const unknown = chip({ unknown: true, reason: '日足を取得できません' });
    expect([toneOf(unknown), unknown.textContent, unknown.getAttribute('title')]).toEqual([null, '売りのサイン 未確認', '日足を取得できません']);
    cleanup();
    for (const value of [null, undefined, { hits: 0 }]) { expect(chip(value)).toBeUndefined(); cleanup(); }
  });

  it('keeps a row\'s green chips only while the market is open to new buying: a cap of 0, an unknown state or no verdict turn them neutral', () => {
    const open = row({ view: view({ rsLineHigh: true }) }).container;
    expect(open.querySelectorAll('.tone-zone')).toHaveLength(4);
    cleanup();
    // Rows render only once the bundle (which carries the verdict) has loaded: no verdict is not still loading.
    for (const context of [{ market: { label: '50日線割れ（弱含み・独自判定）', cap: 0 } }, { market: { label: '市場未確認', cap: 0, state: 'unknown' } }, { market: null }, null]) {
      const { container } = row({ view: view({ rsLineHigh: true }), context });
      expect(container.querySelectorAll('.tone-zone')).toHaveLength(0);
      expect(chipTexts(container)).toEqual(['● 買いゾーン +1.2%', 'TT 8/8', '出来高 1.60×', 'RS推計 88', 'RS線 新高値']);
      cleanup();
    }
  });

  it('gives a broken setup\'s row no green chip in an open market: its ▲ chip says why', () => {
    const book = { key: 'book', label: '20日線割れ・3日連続の安値切り下げ・大商い（書籍の複合警告）', state: 'hit' };
    const sell = { strength: [], weakness: [{ key: 'ma50', label: '出来高を伴う50日線割れ', state: 'clear' }, book], hits: 1, breakdownHits: 1 };
    const { container } = row({ view: view({ rsLineHigh: true }), sell });
    expect(container.querySelectorAll('.tone-zone')).toHaveLength(0);
    expect(container.querySelector('.is-strong')).toBeNull();
    expect(chipTexts(container)).toEqual(['● 買いゾーン +1.2%', '▲ 崩れ（独自判定）', 'TT 8/8', '出来高 1.60×', 'RS推計 88', 'RS線 新高値']);
    cleanup();
    // A caution (50日線の下) or a holder's signal alone is no broken setup: the open market keeps the green chips.
    const caution = { strength: [], weakness: [{ key: 'ma50', label: '出来高を伴う50日線割れ', state: 'caution', detail: '50日線の下' }], hits: 0, breakdownHits: 0 };
    expect(row({ view: view({ rsLineHigh: true }), sell: caution }).container.querySelectorAll('.tone-zone')).toHaveLength(4);
  });

  it('re-exports the frozen layout primitives under the old import path', () => {
    expect([Expander, ScreenNotes, Parts, RiseItem, Toast]).toEqual([primitives.Expander, primitives.ScreenNotes, primitives.Parts, primitives.RiseItem, primitives.Toast]);
  });
});
