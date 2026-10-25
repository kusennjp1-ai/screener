// Executed in the browser against the actual expanded chart, including the
// renderer-specific real date-axis row. Container presence alone cannot prove fit.
export function expandedChartGeometry(dialog) {
  const plot = dialog.querySelector('[data-chart-symbol]');
  const scroll = dialog.querySelector('[data-testid="expanded-chart-scroll"]');
  const footer = dialog.querySelector('[data-testid="expanded-chart-footer"]');
  const close = dialog.querySelector('button[aria-label="チャートを閉じる"]');
  const warning = dialog.querySelector('[data-testid="expanded-chart-warning"]');
  const svg = plot?.matches('svg[data-chart-plot]') ? plot : plot?.querySelector('svg[data-chart-plot]');
  const table = plot?.querySelector('.tv-lightweight-charts > table');
  const dateAxis = svg ? svg.querySelector('[data-chart-date-axis]') : table?.rows[table.rows.length - 1];
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
    renderer: svg ? 'leader-svg-v1' : 'lightweight-canvas',
    date_axis_labels: svg ? [...(dateAxis?.querySelectorAll('text') || [])].map(node => node.textContent) : null,
    viewport: { width: innerWidth, height: innerHeight },
    plot: rect(plot), date_axis: rect(dateAxis), footer: rect(footer), content: rect(scroll),
    scroll_top: scroll?.scrollTop, scroll_height: scroll?.scrollHeight, content_client_height: scroll?.clientHeight,
    plot_visible: visible(plot), date_axis_visible: visible(dateAxis), date_axis_hit: svg ? Boolean(dateAxis && [...dateAxis.querySelectorAll('text')].length >= 2 && [...dateAxis.querySelectorAll('text')].every(hit)) : hit(dateAxis),
    date_axis_canvases: dateAxis?.querySelectorAll('canvas').length || 0,
    footer_visible: visible(footer), footer_hit: hit(footer), footer_position: footer && getComputedStyle(footer).position,
    footer_placement: footer?.dataset.placement || 'footer', navigation_count: Number(footer?.dataset.navigationCount || 0), close: rect(close),
    warning: rect(warning), warning_visible: warning ? visible(warning) : null,
    footer_controls: [...(footer?.querySelectorAll('button') || [])].map(node => ({ text: node.textContent, visible: visible(node), hit: hit(node), rect: rect(node) })),
    close_visible: visible(close), close_hit: hit(close),
  };
}

export function checkExpandedChartGeometry(geometry, check, label, { fullChart = false } = {}) {
  check(Boolean(geometry.plot && geometry.plot.height >= 300), `${label}: expanded price/RS/volume plot is missing or shorter than 300px`);
  const svgAxis = geometry.renderer === 'leader-svg-v1';
  const axisContent = svgAxis ? Array.isArray(geometry.date_axis_labels) && geometry.date_axis_labels.length >= 2 && geometry.date_axis_labels.every(text => /^\d{2}-\d{2}$/.test(text)) : geometry.date_axis_canvases >= 1;
  check(axisContent && geometry.date_axis?.height >= 16, `${label}: real chart date-axis row is missing or collapsed`);
  if (geometry.renderer !== undefined) check(['leader-svg-v1', 'lightweight-canvas'].includes(geometry.renderer), `${label}: unknown chart renderer`);
  const headerNavigation = geometry.footer_placement === 'header';
  const overlaps = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  if (geometry.warning) check(geometry.warning_visible && !overlaps(geometry.warning, geometry.close) && !overlaps(geometry.warning, geometry.footer), `${label}: detail failure warning is clipped or covered by navigation`);
  if (!headerNavigation || geometry.navigation_count > 0) check(geometry.footer_visible && geometry.footer_hit, `${label}: expanded navigation is clipped or covered by the chart`);
  if (headerNavigation) {
    check([0, 2].includes(geometry.navigation_count) && geometry.footer_controls.length === geometry.navigation_count, `${label}: compact navigation controls are missing`);
    if (geometry.navigation_count > 0) {
      check(geometry.footer?.bottom <= geometry.content?.top + .5 && geometry.footer?.right <= geometry.close?.left - 1 && geometry.footer?.top >= geometry.close?.top - .5 && geometry.footer?.bottom <= geometry.close?.bottom + .5, `${label}: compact navigation is outside the title row or overlaps the plot or close control`);
      for (const button of geometry.footer_controls) check(button.rect?.width >= 44 && button.rect?.height >= 44, `${label}: compact navigation target ${button.text} is smaller than 44px`);
    }
  }
  check(geometry.close_visible && geometry.close_hit, `${label}: expanded close control is clipped or covered`);
  for (const button of geometry.footer_controls) check(button.visible && button.hit, `${label}: footer control ${button.text} is clipped or covered`);
  let mobileFits = false;
  if (geometry.viewport?.width < 900 && geometry.plot && geometry.content) {
    const plotOffset = geometry.plot.top - geometry.content.top + geometry.scroll_top;
    const available = Math.floor(geometry.content_client_height - Math.max(0, plotOffset));
    const expected = Math.min(420, Math.max(300, available));
    check(Math.abs(geometry.plot.height - expected) <= 1, `${label}: mobile plot must fit available space within its readable 300–420px range`);
    mobileFits = available >= 300 && geometry.scroll_top === 0;
  }
  if (fullChart || mobileFits) {
    check(geometry.plot_visible && geometry.date_axis_visible && geometry.date_axis_hit, `${label}: complete plot/date axis is not visible above the footer`);
    const visibleBottom = headerNavigation ? geometry.content?.bottom : geometry.footer?.top;
    check(Boolean(geometry.plot && Number.isFinite(visibleBottom) && geometry.plot.bottom <= visibleBottom + .5), `${label}: chart extends behind footer or content edge`);
  }
}
