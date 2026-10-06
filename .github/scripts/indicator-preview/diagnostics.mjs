export function seriousAccessibilityViolations(violations) {
  return violations.filter(item => ['critical', 'serious'].includes(item.impact)).map(item => ({
    id: item.id, impact: item.impact, nodes: item.nodes.length, help: item.help,
    node_details: item.nodes.map(node => ({
      target: node.target, html: node.html, failure_summary: node.failureSummary,
      checks: ['any', 'all', 'none'].flatMap(group => (node[group] || []).map(check => ({
        group, id: check.id, message: check.message, data: check.data,
      }))),
    })),
  }));
}

// Passed directly to page.evaluate, with no browser startup or imported state.
export function inspectPreviewGeometry() {
  const selector = node => node.id ? `#${node.id}` : `${node.tagName.toLowerCase()}${[...node.classList].map(name => `.${name}`).join('')}`;
  const overflowNodes = [...document.querySelectorAll('main *')].filter(node => {
    const box = node.getBoundingClientRect();
    if (!box.width || (box.right <= innerWidth + 1 && box.left >= -1)) return false;
    // A table wider than its own scrolling viewport is intended. Report only
    // content that escapes the document, without a containing clip/scroll box.
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX) && bounds.left >= -1 && bounds.right <= innerWidth + 1) return false;
    }
    return true;
  }).slice(0, 30).map(node => {
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    return { target: selector(node), html: node.outerHTML.slice(0, 2000), left: box.left, right: box.right, width: box.width, display: style.display, minWidth: style.minWidth, whiteSpace: style.whiteSpace };
  });
  return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > innerWidth + 1, overflow_nodes: overflowNodes,
    overlays: document.querySelectorAll('vite-error-overlay').length,
    headings: [...document.querySelectorAll('h1,h2,h3')].map(node => node.textContent),
    origin: document.querySelector('.preview-origin')?.textContent };
}

export async function restoreHistoryScroll(node) {
  const view = node.ownerDocument.defaultView, deadline = view.performance.now() + 2000;
  const reset = () => node.scrollTo({ left: 0, top: 0, behavior: 'instant' });
  node.blur();reset();
  let stableFrames = 0;
  while (stableFrames < 3 && view.performance.now() < deadline) {
    await new Promise(resolve => view.requestAnimationFrame(resolve));
    if (node.scrollLeft === 0 && node.scrollTop === 0) stableFrames++;
    else { stableFrames = 0;reset(); }
  }
  if (stableFrames < 3) throw Error('History scroll did not settle at its first row and column');
  return { left: node.scrollLeft, top: node.scrollTop, stable_frames: stableFrames };
}

export async function checkHistoryKeyboardScrolling(page) {
  const results = [], regions = page.locator('.indicator-history-scroll:visible');
  for (let index = 0; index < await regions.count(); index++) {
    const region = regions.nth(index);
    const result = await region.evaluate(node => ({ label: node.getAttribute('aria-label'), tabIndex: node.tabIndex,
      horizontal: node.scrollWidth > node.clientWidth, vertical: node.scrollHeight > node.clientHeight }));
    if (result.tabIndex < 0) throw Error(`History table is not keyboard focusable: ${result.label}`);
    const summary = region.locator('xpath=preceding-sibling::summary');
    if (await summary.count()) {
      await summary.focus();await summary.press('Tab');
      if (!await region.evaluate(node => node.ownerDocument.activeElement === node)) throw Error(`History table is not reachable from its disclosure: ${result.label}`);
      result.reached_by_tab = true;
    } else await region.focus();
    for (const [axis, key, property] of [['horizontal', 'ArrowRight', 'scrollLeft'], ['vertical', 'ArrowDown', 'scrollTop']]) {
      if (!result[axis]) continue;
      await region.press(key);
      await page.waitForFunction(({ node, property }) => node[property] > 0, { node: await region.elementHandle(), property }, { timeout: 2000 });
      result[`${axis}_keyboard_moved`] = true;
    }
    result.restored = await region.evaluate(restoreHistoryScroll);
    results.push(result);
  }
  return results;
}
