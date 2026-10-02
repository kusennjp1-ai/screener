// Executed in the browser against the actual expanded chart, including the
// Lightweight Charts date-axis row. Canvas presence alone cannot prove fit.
export function expandedChartGeometry(dialog) {
  const plot = dialog.querySelector('[data-chart-symbol]');
  const scroll = dialog.querySelector('[data-testid="expanded-chart-scroll"]');
  const footer = dialog.querySelector('[data-testid="expanded-chart-footer"]');
  const close = dialog.querySelector('button[aria-label="チャートを閉じる"]');
  const table = plot?.querySelector('.tv-lightweight-charts > table');
  const dateAxis = table?.rows[table.rows.length - 1];
  const rect = node => {
    if (!node) return null;
    const { top, bottom, left, right, width, height } = node.getBoundingClientRect();
    return { top, bottom, left, right, width, height };
  };
  const visible = node => {
    if (!node) return false;
    const box = node.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || box.top < -.5 || box.bottom > innerHeight + .5 || box.left < -.5 || box.right > innerWidth + .5) return false;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (box.top < clip.top - .5 || box.bottom > clip.bottom + .5)) return false;
    }
    return true;
  };
  const hit = node => {
    if (!visible(node)) return false;
    const box = node.getBoundingClientRect();
    return [.15, .5, .85].every(fraction => node.contains(document.elementFromPoint(box.left + box.width * fraction, box.top + box.height / 2)));
  };
  return {
    viewport: { width: innerWidth, height: innerHeight },
    plot: rect(plot), date_axis: rect(dateAxis), footer: rect(footer), content: rect(scroll),
    scroll_top: scroll?.scrollTop, scroll_height: scroll?.scrollHeight,
    plot_visible: visible(plot), date_axis_visible: visible(dateAxis), date_axis_hit: hit(dateAxis),
    date_axis_canvases: dateAxis?.querySelectorAll('canvas').length || 0,
    footer_visible: visible(footer), footer_hit: hit(footer), footer_position: footer && getComputedStyle(footer).position,
    footer_controls: [...(footer?.querySelectorAll('button') || [])].map(node => ({ text: node.textContent, visible: visible(node), hit: hit(node) })),
    close_visible: visible(close), close_hit: hit(close),
  };
}

export function checkExpandedChartGeometry(geometry, check, label, { fullChart = false } = {}) {
  check(Boolean(geometry.plot && geometry.plot.height >= 300), `${label}: expanded price/RS/volume plot is missing or shorter than 300px`);
  check(geometry.date_axis_canvases >= 1 && geometry.date_axis?.height >= 16, `${label}: real chart date-axis row is missing or collapsed`);
  check(geometry.footer_visible && geometry.footer_hit, `${label}: expanded footer is clipped or covered by the chart`);
  check(geometry.close_visible && geometry.close_hit, `${label}: expanded close control is clipped or covered`);
  for (const button of geometry.footer_controls) check(button.visible && button.hit, `${label}: footer control ${button.text} is clipped or covered`);
  if (fullChart) {
    check(geometry.plot_visible && geometry.date_axis_visible && geometry.date_axis_hit, `${label}: complete plot/date axis is not visible above the footer`);
    check(Boolean(geometry.plot && geometry.footer && geometry.plot.bottom <= geometry.footer.top + .5), `${label}: chart extends behind footer`);
  }
}
