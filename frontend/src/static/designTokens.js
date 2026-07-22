// Shared design tokens for the static PWA decision surfaces (C90 · hallmark audit).
//
// Single source of truth for the semantic palette so the buy card, watchlist,
// and any future card read one system instead of each re-declaring hex values.
// Semantics (not raw colour names): up/good=green, caution=amber, down/bad=red.
export const C = {
  green: '#22ab94', // up / good / in-zone / lock-gains
  red: '#f23645', // down / stop / sell-now
  amber: '#e0a52e', // caution / tighten / extended / stale
  blue: '#4f8cff', // informational accent (links, VCP tag, size bar)
  ink: '#d1d4dc', // primary readable text on dark
  inkStrong: '#f5f7fa', // headings (tinted off-white, not pure #fff)
  grey: '#787b86', // secondary / muted text
  track: '#23262f', // inert bar/track + hairline borders
  panel: 'rgba(13,16,22,0.9)', // card surface (tinted dark, not pure black)
  dim: '#4a4e57', // disabled glyphs
};

export default C;
