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
const row = (props = {}) => render(<ol><CandidateRow view={view()} rank={1} onOpen={() => {}} now={0} animate={false} {...props} /></ol>);

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
    expect(chips.map(chip => chip.textContent)).toEqual(['▲ 売りのサイン 2件', '▲ 決算 6日後']);
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
    expect([up.className, up.textContent]).toEqual(['numeric brief-daychg is-up', '前日比 +2.0%']);
    cleanup();
    expect(title({ change: -0.4 }).querySelector('.brief-daychg').className).toBe('numeric brief-daychg is-down');
    cleanup();
    const unknown = title({ change: null });
    expect(unknown.querySelector('.brief-daychg').textContent).toBe('—前日比 未確認');
    expect([...unknown.children].map(node => node.className || node.tagName)).toEqual(['B', 'brief-daychg', 'brief-row-name']);
    expect(unknown.closest('.brief-row').getAttribute('aria-label')).toContain('前日比 未確認');
    cleanup();
    expect(render(<DayChange view={{ change: 0 }} />).container.textContent).toBe('前日比 ±0.0%');
  });

  it('marks a heavy down day\'s volume as a warning, green only on a verified up day, neutral when the direction is unknown', () => {
    const volume = over => [...row({ view: view(over) }).container.querySelectorAll('.brief-chip')].find(node => node.textContent.includes('出来高'));
    const down = volume({ change: -1, volumeRatio: 1.6 });
    expect([down.className, down.textContent]).toEqual(['brief-chip tone-ext', '▲ 出来高 1.60×']);
    cleanup();
    expect(volume({ change: 2 }).className).toBe('brief-chip tone-zone');
    cleanup();
    expect(volume({ change: null }).className).toBe('brief-chip');
    cleanup();
    expect(volume({ volumeRatio: 1.39 })).toBeUndefined();
  });

  it('keeps the position of a stock that is not a buy candidate in a neutral tone', () => {
    for (const [state, position] of [['zone', 'zone'], ['wait', 'near'], ['ext', 'ext']]) {
      expect(render(<StateChip view={view({ state, position, qualified: false })} />).container.firstChild.className).toBe('brief-chip tone-neutral');
      cleanup();
    }
    expect(render(<StateChip view={view({ state: 'wait', position: 'base', stateLabel: '土台形成中', distance: -8 })} />).container.firstChild.className).toBe('brief-chip tone-neutral');
    cleanup();
    const stale = render(<StateChip view={view({ state: 'na', position: 'staleAbove', stateLabel: '旧ピボットから +32%・有効な買い水準なし', stateGlyph: '▲', distance: null, stale: { above: true } })} />).container.firstChild;
    expect([stale.className, stale.textContent]).toEqual(['brief-chip tone-ext', '▲ 旧ピボットから +32%・有効な買い水準なし']);
  });

  it('names the unmet rule of an あと1条件 row in a neutral chip, which carries the RS value when RS is that rule', () => {
    const one = over => row({ view: view({ qualified: false, passed: 8, failed: 1, unknown: 0, rs: 61.4, ...over }) }).container;
    const rs = one({ missing: { text: '未達：RS ≥ 70（61）', rs: true } });
    expect(chipTexts(rs)).toEqual(['● 買いゾーン +1.2%', 'あと1条件', '未達：RS ≥ 70（61）', '出来高 1.60×']);
    expect(rs.querySelector('.brief-row').getAttribute('aria-label')).toMatch(/RS推計 61$/);
    expect([...rs.querySelectorAll('.brief-chip')].find(node => node.textContent.startsWith('未達')).className).toBe('brief-chip');
    cleanup();
    expect(chipTexts(one({ missing: { text: '未達：株価 > SMA50', rs: false } }))).toEqual(['● 買いゾーン +1.2%', 'あと1条件', '未達：株価 > SMA50', '出来高 1.60×', 'RS推計 61']);
  });

  it('warns from the shared earnings constant: 10 days warns, 11 does not', () => {
    expect(chipTexts(row({ view: view({ earnings: { date: '2026-10-12', days: 10 } }) }).container)).toContain('▲ 決算 10日後');
    cleanup();
    expect(chipTexts(row({ view: view({ earnings: { date: '2026-10-13', days: 11 } }) }).container).some(text => text.includes('決算'))).toBe(false);
  });
});

// Step-0 seams D owns and other tracks call (BriefApp's bar, Today's and the list's rows).
describe('BriefParts seams', () => {
  it('BarQuote shows the price and the verified day change after the ticker, and nothing without a price', () => {
    expect(render(<BarQuote view={{ price: 1234.5, change: -1.25 }} />).container.innerHTML).toBe('<span class="numeric brief-bar-price"> $1,234.50</span> <span class="numeric brief-daychg is-down brief-bar-change"><span class="sr-only">前日比 </span>−1.3%</span>');
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
    expect([hit.className, hit.textContent, hit.getAttribute('title')]).toEqual(['brief-chip tone-ext', '▲ 売りのサイン 2件', null]);
    cleanup();
    const unknown = chip({ unknown: true, reason: '日足を取得できません' });
    expect([unknown.className, unknown.textContent, unknown.getAttribute('title')]).toEqual(['brief-chip', '売りのサイン 未確認', '日足を取得できません']);
    cleanup();
    for (const value of [null, undefined, { hits: 0 }]) { expect(chip(value)).toBeUndefined(); cleanup(); }
  });

  it('turns a row\'s green chips neutral while the market holds off new buying or is unknown, and leaves an open market as before', () => {
    const plain = row({ view: view({ rsLineHigh: true }) }).container.innerHTML;
    cleanup();
    for (const market of [null, { label: '上昇トレンド（独自判定）', cap: 0.5 }]) { expect(row({ view: view({ rsLineHigh: true }), context: { market } }).container.innerHTML).toBe(plain); cleanup(); }
    for (const market of [{ label: '50日線割れ（弱含み・独自判定）', cap: 0 }, { label: '市場未確認', cap: 0, state: 'unknown' }]) {
      const { container } = row({ view: view({ rsLineHigh: true }), context: { market } });
      expect(container.querySelectorAll('.tone-zone')).toHaveLength(0);
      expect(chipTexts(container)).toEqual(['● 買いゾーン +1.2%', 'TT 8/8', '出来高 1.60×', 'RS推計 88', 'RS線 新高値']);
      cleanup();
    }
  });

  it('re-exports the frozen layout primitives under the old import path', () => {
    expect([Expander, ScreenNotes, Parts, RiseItem, Toast]).toEqual([primitives.Expander, primitives.ScreenNotes, primitives.Parts, primitives.RiseItem, primitives.Toast]);
  });
});
