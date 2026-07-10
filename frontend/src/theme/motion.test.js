import { describe, expect, it } from 'vitest';

import { MOTION, PLAYBACK_FRAME_MS, enterSlideFade, pulseRing, standardTransition } from './motion';

const REDUCED = '@media (prefers-reduced-motion: no-preference)';

describe('motion tokens', () => {
  it('exposes one shared vocabulary', () => {
    expect(MOTION.duration.enter).toBe(360);
    expect(MOTION.duration.tween).toBe(600);
    expect(MOTION.duration.pulse).toBe(2000);
    expect(PLAYBACK_FRAME_MS).toBe(700);
    expect(standardTransition('width')).toBe('width 600ms cubic-bezier(0.4, 0, 0.2, 1)');
  });

  it('pulseRing sits entirely behind prefers-reduced-motion', () => {
    const sx = pulseRing('#f23645');
    expect(Object.keys(sx)).toEqual([REDUCED]);
    expect(sx[REDUCED].animation).toContain('motionPulse 2000ms');
  });

  it('enterSlideFade staggers by order and composes with a pulse color', () => {
    const plain = enterSlideFade(2);
    expect(plain[REDUCED].animationDelay).toBe('180ms');
    const withPulse = enterSlideFade(0, '#3aa0ff');
    expect(withPulse[REDUCED].animationName).toBe('motionEnter, motionPulse');
    expect(withPulse[REDUCED].animationIterationCount).toBe('1, infinite');
    // no animation outside the reduced-motion guard
    expect(Object.keys(withPulse)).toEqual([REDUCED]);
  });
});
