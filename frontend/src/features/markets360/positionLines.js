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
export const positionPriceLines = (position) => {
  if (!position || position.status !== 'open' || position.entry_price == null) return [];
  const lines = [
    {
      id: 'position-entry',
      price: Number(position.entry_price),
      color: '#3aa0ff',
      dashed: false,
      title: `Entry ${Number(position.entry_price).toFixed(2)}`,
    },
  ];
  const ladder = position.sell_plan?.trailing || {};
  const stop = ladder.stop ?? position.initial_stop;
  if (stop != null) {
    const raised = Boolean(ladder.raised);
    lines.push({
      id: 'position-stop',
      price: Number(stop),
      color: raised ? '#22ab94' : '#f23645',
      dashed: true,
      title: `Stop ${Number(stop).toFixed(2)}${raised ? ' ↑' : ''}`,
    });
  }
  return lines;
};
