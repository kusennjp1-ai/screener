// Scroll only: never override content-visibility, styles, chrome or source data.
export async function anchorViewport(page, locator) {
  await locator.evaluate(node => window.scrollTo({ top: Math.max(0, window.scrollY + node.getBoundingClientRect().top - 12), behavior: 'instant' }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.mouse.move(0, 0);
}

// Executed in the admitted browser via locator.evaluate.
export function inspectViewportContent(root, { kind }) {
  const measure = node => {
    if (!node) return null;
    const box = node.getBoundingClientRect();
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
      if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
    }
    const fullyVisible = box.width > 0 && box.height > 0 && box.left >= left - 1 && box.right <= right + 1 && box.top >= top - 1 && box.bottom <= bottom + 1;
    const visibilityNode = node.namespaceURI === 'http://www.w3.org/2000/svg' ? node.closest('.recharts-wrapper') : node;
    return { text: node.textContent.trim(), left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height,
      fully_visible: fullyVisible, paint_eligible: visibilityNode.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true, opacityProperty: true }) };
  };
  if (kind === 'candidates') return {
    heading: measure(root.querySelector('.candidate-board-heading')),
    rows: [...root.querySelectorAll('.candidate-row')].map(row => {
      const box = measure(row), centerX = (box.left + box.right) / 2, centerY = (box.top + box.bottom) / 2;
      return { symbol: row.querySelector('.candidate-name-header strong')?.textContent, ...box,
        identity: measure(row.querySelector('.candidate-name-header')),
        content_visibility: getComputedStyle(row.closest('[role="listitem"]')).contentVisibility,
        hit_test: box.fully_visible && row.contains(document.elementFromPoint(centerX, centerY)) };
    }),
  };
  return { heading: measure(root.querySelector('h3')), count: measure(root.querySelector('.indicator-history-values')),
    plot: measure(root.querySelector('.recharts-wrapper')), date_axis: measure(root.querySelector('.recharts-xAxis')),
    as_of_source: root.querySelector('.indicator-history-meta')?.textContent,
  };
}

const readable = value => Boolean(value?.fully_visible && value?.paint_eligible);
export const paintedCandidateSymbols = evidence => evidence.rows.filter(row => readable(row) && readable(row.identity) && row.hit_test).map(row => row.symbol);
export const basePlotReadable = evidence => ['count', 'plot', 'date_axis'].every(key => readable(evidence[key]));

export async function captureCandidateViewports(page, capture) {
  const board = page.locator('#candidate-board');
  await anchorViewport(page, board.locator('.candidate-board-heading'));
  const seen = new Set();
  let index = 0;
  while (true) {
    const evidence = await board.evaluate(inspectViewportContent, { kind: 'candidates' });
    await capture(index ? `candidates-continuation-${index}-viewport` : 'candidates-viewport', evidence);
    const before = seen.size;
    paintedCandidateSymbols(evidence).forEach(symbol => seen.add(symbol));
    if (!evidence.rows.length || seen.size === before) throw Error('Candidate viewport did not expose any new fully painted rows');
    const missing = evidence.rows.findIndex(row => !seen.has(row.symbol));
    if (missing < 0) return;
    const missingRow = board.locator('.candidate-row').nth(missing);
    // Let the browser reveal the row through every scrolling ancestor before
    // positioning it in the document viewport (mobile lists also scroll).
    await missingRow.scrollIntoViewIfNeeded();
    await anchorViewport(page, missingRow);
    index++;
  }
}

export async function captureBaseViewports(page, capture) {
  const panel = page.getByRole('region', { name: 'ベース段階の推移（自動推計）', exact: true });
  await anchorViewport(page, panel.locator('h3'));
  const first = await panel.evaluate(inspectViewportContent, { kind: 'base' });
  await capture('base-viewport', first);
  if (!readable(first.heading) || !readable(first.count)) throw Error('Base viewport must show its heading and count');
  if (basePlotReadable(first)) return;
  // A short screen can need a second view. Keep the heading view and show the
  // complete count/plot/date axis separately, without compressing the product.
  await anchorViewport(page, panel.locator('.indicator-history-values'));
  const plot = await panel.evaluate(inspectViewportContent, { kind: 'base' });
  await capture('base-plot-viewport', plot);
  if (!basePlotReadable(plot)) throw Error('Base plot viewport must show count, complete plot and date axis');
}
