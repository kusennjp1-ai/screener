// The stock screen's navigation (BriefApp, E): where 戻る goes, stepping without wraparound, and the list's
// kept scroll position.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backPlan, recallScroll, rememberScroll, stepTarget } from './briefNav';

describe('戻る', () => {
  it('is the browser\'s own back only when this tab\'s in-app history has an earlier entry (idx > 0)', () => {
    expect(backPlan({ idx: 1, key: 'a', usr: { from: 'list' } }, 'list')).toEqual({ history: true, to: null });
    expect(backPlan({ idx: 7 }, 'today')).toEqual({ history: true, to: null });
  });

  it('replaces the stock with the list it came from after a direct link, also after stepping (a step replaces the entry)', () => {
    // A direct link starts at idx 0; a step replaces the entry and keeps that index.
    expect(backPlan({ idx: 0, key: 'b', usr: { from: 'list' } }, 'list')).toEqual({ history: false, to: '/brief/list' });
    expect(backPlan({ idx: 0 }, 'today')).toEqual({ history: false, to: '/brief' });
    expect(backPlan({ idx: 0 }, 'watch')).toEqual({ history: false, to: '/brief/watch' });
    // A history entry React Router did not write (another script, a fragment typed in) has no index: never leave the app.
    for (const state of [null, undefined, {}, { idx: null }, { idx: '2' }, { idx: -1 }]) expect(backPlan(state, 'market')).toEqual({ history: false, to: '/brief/market' });
    expect(backPlan(null, undefined)).toEqual({ history: false, to: '/brief' });
  });
});

describe('stepping through a list', () => {
  const list = ['AAA', 'BBB', 'CCC'];
  it('moves one stock either way', () => {
    expect(stepTarget(list, 'AAA', 1)).toEqual({ symbol: 'BBB' });
    expect(stepTarget(list, 'CCC', -1)).toEqual({ symbol: 'BBB' });
  });
  it('never wraps around: either end says so', () => {
    expect(stepTarget(list, 'CCC', 1)).toEqual({ edge: 'end' });
    expect(stepTarget(list, 'AAA', -1)).toEqual({ edge: 'start' });
    expect(stepTarget(['AAA'], 'AAA', 1)).toEqual({ edge: 'end' });
  });
  it('enters the list from a stock outside it, and does nothing without a list or a stock', () => {
    expect(stepTarget(list, 'ZZZ', 1)).toEqual({ symbol: 'AAA' });
    expect(stepTarget(list, 'ZZZ', -1)).toEqual({ symbol: 'CCC' });
    for (const [sequence, selected] of [[[], 'AAA'], [list, null], [null, 'AAA']]) expect(stepTarget(sequence, selected, 1)).toBeNull();
  });
});

describe('the list\'s kept scroll position', () => {
  afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });
  it('keeps one position per list screen with the stock opened from it, for this tab\'s session', () => {
    expect(recallScroll('list')).toBeNull();
    rememberScroll('list', 'BBB', 804.4);
    rememberScroll('today', 'AAA', 0);
    expect(recallScroll('list')).toEqual({ y: 804, symbol: 'BBB' });
    expect(recallScroll('today')).toEqual({ y: 0, symbol: 'AAA' });
    rememberScroll('list', 'CCC', -5);
    expect(recallScroll('list')).toEqual({ y: 0, symbol: 'CCC' });
  });
  it('treats unreadable or blocked storage as nothing kept, without throwing', () => {
    sessionStorage.setItem('brief-scroll', '{not json');
    expect(recallScroll('list')).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => rememberScroll('list', 'AAA', 10)).not.toThrow();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(recallScroll('list')).toBeNull();
  });
});
