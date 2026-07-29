// Shared design tokens for the static PWA decision surfaces (C90 · hallmark audit).
//
// Single source of truth for the semantic palette, type scale, and weight scale
// so the buy card, watchlist, nav, and any future card read one system instead
// of each re-declaring hex values and ad-hoc font sizes.
//
// RULE: a component in src/static must never write a raw hex colour, a raw px
// font size, or a raw font weight. Import C / T / W and use a named step. If a
// step you need does not exist here, add it here — do not inline it there.

// ---------------------------------------------------------------------------
// Direction pair — ONE up colour and ONE down colour for the whole app.
//
// These two constants exist so price change, sell-timing, scorecard figures and
// the TradingView chart cannot drift apart. #f23645 is exactly the red the chart
// paints its down candles with, so the number and the candle agree.
//
// Measured on the card reference background #12151b (WCAG 2.1, computed in
// designTokens.test.js, never eyeballed):
//   UP   #22ab94 -> 6.37:1  (AA pass)
//   DOWN #f23645 -> 4.69:1  (AA pass)
//
// Do NOT use MUI's palette.error.main (#d32f2f) for a falling price: it measures
// 3.67:1 on the same surface — below the 4.5:1 AA floor — and it is a third,
// different red. Use C.down.
const UP = '#22ab94';
const DOWN = '#f23645';

// Contrast is measured against the darkest surface these tokens land on,
// #12151b (the card panel as it composites over the page background). Every
// text token below clears WCAG 2.1 AA for normal text (4.5:1); measured ratios
// are noted inline and asserted in designTokens.test.js so they cannot rot.
export const C = {
  // semantic direction (preferred names)
  up: UP, // rising price, gain, in-zone, lock-gains       — 6.37:1 on #12151b
  down: DOWN, // falling price, stop, sell-now             — 4.69:1

  // same two hexes under their older names; kept so existing call sites stay
  // on the one pair rather than inventing a second red/green.
  green: UP,
  red: DOWN,

  amber: '#e0a52e', // caution / tighten / extended / stale — 8.35:1
  blue: '#4f8cff', // informational accent (links, VCP tag) — 5.68:1
  ink: '#d1d4dc', // primary readable text on dark          — 12.33:1
  inkStrong: '#f5f7fa', // headings (tinted off-white)      — 17.03:1
  grey: '#9aa0ac', // secondary / muted text                — 6.96:1
  dim: '#7c8290', // lowest-priority text, disabled glyphs  — 4.75:1
  track: '#23262f', // inert bar/track + hairline borders (non-text)
  panel: 'rgba(13,16,22,0.9)', // card surface (tinted dark, not pure black)

  // Text/glyph colour to place ON a solid semantic fill (a filled urgency pill).
  // #0c0c11 is the page background, so a filled chip reads as a hole punched in
  // the page. On the fills we use it measures: on up 6.80:1, on down 5.01:1,
  // on amber 8.91:1 — all AA.
  onSolid: '#0c0c11',
};

// The background these ratios are quoted against: the card panel as it actually
// composites over the page. Exported so tests and future audits measure the
// same surface instead of guessing. (The real composite is #0d1016, i.e. even
// darker, so quoting #12151b is the conservative choice.)
export const CARD_BG = '#12151b';

// The measured page background behind every card.
export const PAGE_BG = '#0c0c11';

// ---------------------------------------------------------------------------
// Type scale — SIX steps, INTEGERS ONLY, nothing in between.
//
// Before this scale the home page rendered 11 distinct sizes (10, 10.5, 11,
// 11.5, 12, 12.5, 13, 14, 15, 16.5, 19) and the drill-in 18, including
// em-inherited fractions like 12.0714px. Fractional sizes make Japanese glyphs
// sub-pixel-render and look smeared on the phone; a dozen sizes destroy the
// hierarchy because no size means anything.
//
// The numbers ARE the hierarchy — a bigger step always means a higher level.
// An item inside a card must never outrank the card's own title.
//
// 12 is the FLOOR (see TEXT_MIN_PX): nothing readable is smaller.
export const T = {
  micro: 12, // units, timestamps, chip labels, footnotes — the floor
  body: 13, // default body copy and secondary text
  strong: 15, // row values, tickers, prices — item level, BELOW `heading`
  heading: 17, // card and section titles — outranks everything inside the card
  display: 22, // one hero figure per card (the headline number), nothing else
  hero: 26, // one page-level verdict per screen — the first thing you read
};

// The smallest font size any UI text node may render at. The single exemption
// is a chart axis label, which the charting library draws onto its own canvas.
// Anything a component renders as HTML text must be >= this.
export const TEXT_MIN_PX = 12;

// Convenience: `sx={{ fontSize: px(T.body) }}` keeps the unit in one place.
export const px = (n) => `${n}px`;

// ---------------------------------------------------------------------------
// Weight scale.
//
// 800 was being used for card titles, row values AND tickers at once, which
// flattens the hierarchy — everything shouts, so nothing leads. Weight is the
// SECONDARY signal; size (T) carries the hierarchy. Pair one heavy weight with
// one size step, not both at every level. 700 is the ceiling; there is no 800.
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
