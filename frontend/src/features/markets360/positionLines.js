/**
 * Map an open position (as served by /v1/positions with its live sell-engine
 * status) to the horizontal price lines the Markets 360 chart draws:
 *
 *   entry — solid blue at the registered buy price
 *   stop  — dashed line at the CURRENT ladder stop (the sell engine's stop,
 *           which only ever rises); green once the ladder has raised it above
 *           the initial stop, red while the original risk is still open
 *
 * Pure: returns [] when there is no matching open position.
 */
export const positionPriceLines = (position, { index = 0, count = 1 } = {}) => {
  if (!position || position.status !== 'open' || position.entry_price == null) return [];
  // With several positions in one symbol, number the labels so the axis
  // reads unambiguously (Entry#1 = oldest entry, matching the journal).
  const tag = count > 1 ? `#${index + 1} ` : '';
  const lines = [
    {
      id: `position-entry-${index}`,
      price: Number(position.entry_price),
      color: '#3aa0ff',
      dashed: false,
      title: `Entry ${tag}${Number(position.entry_price).toFixed(2)}`,
    },
  ];
  const ladder = position.sell_plan?.trailing || {};
  const stop = ladder.stop ?? position.initial_stop;
  if (stop != null) {
    const raised = Boolean(ladder.raised);
    lines.push({
      id: `position-stop-${index}`,
      price: Number(stop),
      color: raised ? '#22ab94' : '#f23645',
      dashed: true,
      title: `Stop ${tag}${Number(stop).toFixed(2)}${raised ? ' ↑' : ''}`,
    });
  }
  return lines;
};

/**
 * All price lines for one symbol's OPEN positions, oldest entry first so
 * the #1/#2 numbering matches the order the trades were put on.
 */
export const symbolPositionLines = (positions, symbol) => {
  const matches = (positions || [])
    .filter((p) => p.symbol === symbol && p.status === 'open' && p.entry_price != null)
    .slice()
    .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)));
  return matches.flatMap((p, index) => positionPriceLines(p, { index, count: matches.length }));
};
