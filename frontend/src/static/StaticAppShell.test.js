import { describe, expect, it } from 'vitest';
import { legacyTarget } from './StaticAppShell';

describe('legacyTarget', () => {
  it.each([
    ['/', '', '/brief'],
    ['/daily', '', '/brief'],
    ['/compare', '', '/brief/list'],
    ['/scan', '?market=US', '/brief/list'],
    ['/breadth', '?tab=sectors', '/brief/market'],
    ['/groups', '', '/brief/market'],
    ['/themes', '', '/brief/market'],
    ['/', '?symbol=brk.b', '/brief/stock/BRK.B'],
    ['/', '?method=oneil&symbol=NVDA', '/brief/stock/NVDA'],
    ['/compare', '?symbol=<script>', '/brief/list'],
    ['/unknown/path', '', '/brief'],
  ])('maps %s%s to %s', (path, search, target) => {
    expect(legacyTarget(path, search)).toBe(target);
  });
});
