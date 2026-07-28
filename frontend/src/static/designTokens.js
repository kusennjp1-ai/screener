// Shared design tokens for the static PWA decision surfaces (C90 · hallmark audit).
//
// Single source of truth for the semantic palette, type scale, and weight scale
// so the buy card, watchlist, nav, and any future card read one system instead
// of each re-declaring hex values and ad-hoc font sizes.
//
// Semantics (not raw colour names): up/good=green, caution=amber, down/bad=red.
//
// Contrast is measured against the darkest surface these tokens land on,
// #12151b (the card panel composited over the page background). Every text
// token below clears WCAG 2.1 AA for normal text (4.5:1); measured ratios are
// noted inline and are asserted in designTokens.test.js so they cannot rot.
export const C = {
  green: '#22ab94', // up / good / in-zone / lock-gains        — 6.37:1 on #12151b
  red: '#f23645', // down / stop / sell-now                    — 4.69:1
  amber: '#e0a52e', // caution / tighten / extended / stale    — 8.35:1
  blue: '#4f8cff', // informational accent (links, VCP tag)    — 5.68:1
  ink: '#d1d4dc', // primary readable text on dark             — 12.33:1
  inkStrong: '#f5f7fa', // headings (tinted off-white)         — 17.03:1
  grey: '#9aa0ac', // secondary / muted text                   — 6.96:1
  dim: '#7c8290', // lowest-priority text, disabled glyphs     — 4.75:1
  track: '#23262f', // inert bar/track + hairline borders (non-text)
  panel: 'rgba(13,16,22,0.9)', // card surface (tinted dark, not pure black)
};

// The background these ratios are quoted against: the card panel as it actually
// composites over the page. Exported so tests and future audits measure the
// same surface instead of guessing.
export const CARD_BG = '#12151b';

// ---------------------------------------------------------------------------
// Type scale — INTEGERS ONLY.
//
// Fractional sizes (13.5px, 14.857px, 22.286px came from MUI rem maths) make
// Japanese glyphs sub-pixel-render and look smeared on the phone. Use these
// five steps and nothing else; never write a raw px font size in a component.
//
// The numbers ARE the hierarchy — a bigger step always means a higher level.
// An item inside a card must never outrank the card's own title.
export const T = {
  micro: 11, // units, timestamps, chip labels, table column heads
  body: 12, // default body copy and secondary text
  strong: 14, // row values, tickers, prices — item level, BELOW `heading`
  heading: 16, // card and section titles — outranks everything inside the card
  display: 22, // one hero number per screen (the headline figure), nothing else
};

// Convenience: `sx={{ fontSize: px(T.body) }}` keeps the unit in one place.
export const px = (n) => `${n}px`;

// ---------------------------------------------------------------------------
// Weight scale.
//
// 800 was being used for card titles, row values AND tickers at once, which
// flattens the hierarchy — everything shouts, so nothing leads. Weight is the
// SECONDARY signal; size (T) carries the hierarchy. Pair one heavy weight with
// one size step, not both at every level.
export const W = {
  regular: 400, // body copy
  medium: 500, // labels that need a nudge, active nav item
  semibold: 600, // row values, tickers
  bold: 700, // card / section titles and the display figure — the ceiling
};

// ---------------------------------------------------------------------------
// Sticky chrome.
//
// The top bar is fixed furniture on a 900px-tall phone viewport, so it is
// capped: one line, 44px, never wrapping. Anything that does not fit scrolls
// horizontally inside the tab strip.
export const NAV_HEIGHT = 44;

export default C;
