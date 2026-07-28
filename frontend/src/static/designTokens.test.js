import { describe, expect, it } from 'vitest';

import C, { CARD_BG, NAV_HEIGHT, T, W, px } from './designTokens';

const toRgb = (hexValue) => [1, 3, 5].map((i) => parseInt(hexValue.slice(i, i + 2), 16));

const relativeLuminance = ([r, g, b]) => {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

// WCAG 2.1 relative-contrast formula.
export const contrastRatio = (fgHex, bgHex) => {
  const l1 = relativeLuminance(toRgb(fgHex));
  const l2 = relativeLuminance(toRgb(bgHex));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

const AA_NORMAL = 4.5;

describe('designTokens palette contrast', () => {
  it('reproduces the WCAG formula against known values', () => {
    // Sanity anchors: white on black is 21:1, a colour on itself is 1:1.
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#12151b', '#12151b')).toBeCloseTo(1, 5);
  });

  it.each([
    ['ink', C.ink],
    ['inkStrong', C.inkStrong],
    ['grey', C.grey],
    ['dim', C.dim],
    ['green', C.green],
    ['red', C.red],
    ['amber', C.amber],
    ['blue', C.blue],
  ])('%s (%s) clears WCAG AA (4.5:1) on the card background', (name, value) => {
    expect(contrastRatio(value, CARD_BG)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('keeps grey readable enough to carry most secondary text (>= 6.5:1)', () => {
    // grey is the colour of nearly all 11-12px secondary copy, including the
    // 利確 profit targets, so it needs more headroom than the bare AA floor.
    expect(contrastRatio(C.grey, CARD_BG)).toBeGreaterThanOrEqual(6.5);
  });

  it('no longer ships the pre-fix grey/dim values that failed AA', () => {
    expect(C.grey).not.toBe('#787b86'); // measured 4.33:1 — below AA
    expect(C.dim).not.toBe('#4a4e57'); // measured 2.19:1 — effectively invisible
  });
});

describe('designTokens type scale', () => {
  it('exposes exactly the five documented steps', () => {
    expect(Object.values(T)).toEqual([11, 12, 14, 16, 22]);
  });

  it('uses integers only, so Japanese glyphs never sub-pixel-render', () => {
    const fractional = Object.entries(T).filter(([, value]) => !Number.isInteger(value));
    expect(fractional).toEqual([]);
  });

  it('ranks strictly ascending: an item can never outrank its card title', () => {
    const ordered = [T.micro, T.body, T.strong, T.heading, T.display];
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    expect(T.strong).toBeLessThan(T.heading);
  });

  it('px() appends the unit', () => {
    expect(px(T.body)).toBe('12px');
  });
});

describe('designTokens weight scale', () => {
  it('exposes ascending multiples of 100 and caps at 700', () => {
    const values = Object.values(W);
    expect(values).toEqual([400, 500, 600, 700]);
    expect(Math.max(...values)).toBe(700);
  });
});

describe('designTokens chrome', () => {
  it('caps the sticky nav at 44px', () => {
    expect(NAV_HEIGHT).toBe(44);
  });
});
