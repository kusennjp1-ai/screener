import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { CandidateRow, Expander, ScreenNotes, StateChip } from './BriefParts';

afterEach(cleanup);

const view = (over = {}) => ({
  symbol: 'AAA', name: 'Alpha', sector: 'Technology', state: 'zone', stateLabel: '買いゾーン内', stateGlyph: '●',
  distance: 1.2, volumeRatio: 1.6, rs: 88, rsLineHigh: false, qualified: true, passed: 8, failed: 0, unknown: 0, earnings: null, ...over,
});
const chipTexts = container => [...container.querySelectorAll('.brief-chip')].map(chip => chip.textContent);
const row = (props = {}) => render(<ol><CandidateRow view={view()} rank={1} onOpen={() => {}} now={0} animate={false} {...props} /></ol>);

describe('brief rows', () => {
  it('says an unknown pivot distance in the state chip, since phones hide the mini meter', () => {
    const { container } = render(<StateChip view={view({ state: 'wait', stateLabel: 'ピボット待ち', stateGlyph: '◔', distance: null })} />);
    expect(container.textContent).toContain('ピボット待ち・ピボット比 未確認');
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
    expect(ranked.getAttribute('aria-label')).toBe('1位 AAA Alpha、買いゾーン内 +1.2%、RS推計 88');
    expect(ranked.classList.contains('is-unranked')).toBe(false);
    cleanup();
    const watched = row({ rank: null }).container.querySelector('.brief-row');
    expect(watched.getAttribute('aria-label')).toBe('AAA Alpha、買いゾーン内 +1.2%、RS推計 88');
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

describe('brief expanders', () => {
  afterEach(() => sessionStorage.clear());
  const toggle = details => { details.open = !details.open; fireEvent(details, new Event('toggle')); };

  it('folds a block into its summary line, keeps the content in the document, and keeps the open state for the session', () => {
    const { container } = render(<Expander id="spec" summary="達成した条件 6件"><p>SMA150 &gt; SMA200</p></Expander>);
    const details = container.querySelector('details');
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')).toHaveTextContent(/^達成した条件 6件$/);
    // Closed, the content is still there (find-in-page and text checks reach it) but not shown.
    expect(details).toHaveTextContent('達成した条件 6件SMA150 > SMA200');
    toggle(details);
    expect(details.open).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('brief-open:spec'))).toBe(true);
    cleanup();
    const again = render(<Expander id="spec" summary="達成した条件 6件"><p>SMA150 &gt; SMA200</p></Expander>);
    expect(again.container.querySelector('details').open).toBe(true);
  });

  it('works without session storage', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('blocked'); } });
    try {
      const { container } = render(<Expander id="blocked" summary="注記"><p>body</p></Expander>);
      const details = container.querySelector('details');
      toggle(details);
      expect(details.open).toBe(true);
    } finally { Object.defineProperty(window, 'sessionStorage', original); }
  });

  it('gathers a screen\'s footnotes into one 注記 and leaves nothing behind when there are none', () => {
    const { container } = render(<ScreenNotes id="spec" notes={['RSは独自推計です。', null, '出典：SEC XBRL。']} />);
    expect(container.querySelector('summary')).toHaveTextContent('注記（計算方法・出典 2件）');
    expect([...container.querySelectorAll('li')].map(li => li.textContent)).toEqual(['RSは独自推計です。', '出典：SEC XBRL。']);
    cleanup();
    expect(render(<ScreenNotes id="none" notes={[null, '']} />).container).toBeEmptyDOMElement();
  });
});
