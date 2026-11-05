// The brief's frozen layout primitives (briefPrimitives.jsx). Frozen in round 1.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Expander, ScreenNotes } from './briefPrimitives';

afterEach(cleanup);

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
    cleanup();
    // At 1024px and wider each card keeps its footnote in place: no 注記.
    expect(render(<ScreenNotes id="wide" wide notes={['RSは独自推計です。']} />).container).toBeEmptyDOMElement();
  });
});
