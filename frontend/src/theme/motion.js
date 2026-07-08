/**
 * Motion tokens — the app's single animation vocabulary.
 *
 * Every animated surface (signal badges, sell-plan card, position chips,
 * RRG playback) speaks the same language: one enter curve, one pulse
 * cadence, one set of durations. Change a token here and every surface
 * moves together.
 *
 * Accessibility: `pulseRing` and `enterSlideFade` emit their animations
 * inside a `prefers-reduced-motion: no-preference` block — with motion off
 * the element is simply static and fully readable.
 */

export const MOTION = {
  duration: {
    fast: 160, //   micro feedback (hover, toggle)
    enter: 360, //  element arrival (badges, cards)
    tween: 600, //  data-driven movement (RRG dots, progress bars)
    pulse: 2000, // urgency ring cadence
  },
  easing: {
    enter: 'cubic-bezier(0.2, 0.8, 0.2, 1)', //   decisive arrival, soft landing
    standard: 'cubic-bezier(0.4, 0, 0.2, 1)', //  in-place property changes
  },
};

/** Playback frame interval for time-travel animations (RRG rotation). */
export const PLAYBACK_FRAME_MS = 700;

/**
 * Urgency pulse — a color ring breathing around the element, the element
 * itself stays legible. sx fragment; spread it last.
 */
export const pulseRing = (color) => ({
  '@media (prefers-reduced-motion: no-preference)': {
    animation: `motionPulse ${MOTION.duration.pulse}ms ease-in-out infinite`,
    '@keyframes motionPulse': {
      '0%, 100%': { boxShadow: `0 0 0 0 ${color}44` },
      '50%': { boxShadow: `0 0 0 6px ${color}00` },
    },
  },
});

/**
 * Arrival — slide-fade in with an optional stagger index (order * 90ms).
 * Combine with pulseRing via `enterSlideFade(order, pulseColor)` so the two
 * animations compose on one element without clobbering each other.
 */
export const enterSlideFade = (order = 0, pulseColor = null) => ({
  '@media (prefers-reduced-motion: no-preference)': {
    '@keyframes motionEnter': {
      from: { opacity: 0, transform: 'translateY(-6px) scale(0.96)' },
      to: { opacity: 1, transform: 'translateY(0) scale(1)' },
    },
    ...(pulseColor
      ? {
        '@keyframes motionPulse': {
          '0%, 100%': { boxShadow: `0 0 0 0 ${pulseColor}44` },
          '50%': { boxShadow: `0 0 0 6px ${pulseColor}00` },
        },
        boxShadow: `0 0 0 0 ${pulseColor}44`,
        animationName: 'motionEnter, motionPulse',
        animationDuration: `${MOTION.duration.enter}ms, ${MOTION.duration.pulse}ms`,
        animationTimingFunction: `${MOTION.easing.enter}, ease-in-out`,
        animationIterationCount: '1, infinite',
        animationFillMode: 'both, none',
        animationDelay: `${order * 90}ms, ${MOTION.duration.enter + order * 90}ms`,
      }
      : {
        animation: `motionEnter ${MOTION.duration.enter}ms ${MOTION.easing.enter} both`,
        animationDelay: `${order * 90}ms`,
      }),
  },
});

/** In-place property transition (width, color…) on the standard curve. */
export const standardTransition = (property = 'all') =>
  `${property} ${MOTION.duration.tween}ms ${MOTION.easing.standard}`;
