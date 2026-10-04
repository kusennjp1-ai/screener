export const normalizeFeedSize = value => value === 50 || value === '50' ? 50 : 20;

// Changing this display preference must not clear the research session's
// selection, filters, search, or saved mobile return position.
export function isFeedSizeOnlyNavigation(previous, next) {
  if (previous.pathname !== next.pathname || previous.search === next.search) return false;
  const before = new URLSearchParams(previous.search), after = new URLSearchParams(next.search);
  before.delete('feedSize'); after.delete('feedSize');
  return before.toString() === after.toString();
}

export function pageForFeedSize(ordered, selectedSymbol, page, previousSize, nextSize) {
  const selected = ordered.findIndex(item => item.row.symbol === selectedSymbol);
  const anchor = selected >= 0 ? selected : Math.min(page * previousSize, Math.max(0, ordered.length - 1));
  return Math.floor(anchor / nextSize);
}
