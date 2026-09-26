export function swipeDirection(start, end) {
  if (!start || !end || end.at - start.at > 900 || end.at < start.at) return null;
  const dx = end.x - start.x, dy = end.y - start.y;
  return Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5 ? (dx < 0 ? 'next' : 'previous') : null;
}
