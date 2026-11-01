import { afterEach, describe, expect, it } from 'vitest';
import { landOnChosenStartScreen, readStartScreen, writeStartScreen, START_SCREEN_KEY } from './startScreen';

afterEach(() => { window.localStorage.clear(); window.location.hash = ''; });

describe('start screen choice', () => {
  it('opens on the brief only for an opted-in viewer arriving at the root', () => {
    window.location.hash = '#/';
    expect(landOnChosenStartScreen()).toBe(false);
    expect(window.location.hash).toBe('#/');
    expect(writeStartScreen('brief')).toBe(true);
    expect(readStartScreen()).toBe('brief');
    expect(landOnChosenStartScreen()).toBe(true);
    expect(window.location.hash).toBe('#/brief');
    window.location.hash = '#/scan';
    expect(landOnChosenStartScreen()).toBe(false);
    expect(window.location.hash).toBe('#/scan');
    window.history.replaceState(null, '', window.location.pathname);
    expect(landOnChosenStartScreen()).toBe(true);
  });

  it('forgets the choice when switched back and ignores unknown values', () => {
    writeStartScreen('brief');
    writeStartScreen('research');
    expect(window.localStorage.getItem(START_SCREEN_KEY)).toBeNull();
    window.localStorage.setItem(START_SCREEN_KEY, 'something-else');
    expect(readStartScreen()).toBe('research');
  });
});
