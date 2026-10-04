// Read-only browser observation. Full-element screenshots can include fixed
// chrome at unexpected offsets, so they cannot establish viewport visibility.
export function financialViewportGeometry(selectors) {
  const rect = node => {
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height };
  };
  const shown = node => {
    if (!node) return false;
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };
  const header = document.querySelector('.leader-header'), navigation = document.querySelector('.leader-mobile-nav');
  const chrome = { header: shown(header) ? rect(header) : null, navigation: shown(navigation) ? rect(navigation) : null };
  const content = { top: Math.max(0, chrome.header?.bottom || 0), bottom: Math.min(innerHeight, chrome.navigation?.top ?? innerHeight), left: 0, right: innerWidth };
  const targets = selectors.map(selector => {
    const matches = [...document.querySelectorAll(selector)], node = matches[0];
    if (matches.length !== 1 || !shown(node)) return { selector, count: matches.length, shown: false, rect: null };
    const box = rect(node), clip = { ...content };
    let ancestorsVisible = true;
    for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      ancestorsVisible &&= style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { clip.top = Math.max(clip.top, bounds.top); clip.bottom = Math.min(clip.bottom, bounds.bottom); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { clip.left = Math.max(clip.left, bounds.left); clip.right = Math.min(clip.right, bounds.right); }
    }
    // Inline values may wrap into separate line fragments. Sample their real
    // rectangles instead of blank corners of the enclosing rectangle.
    const hitSamples = [...node.getClientRects()].filter(fragment => fragment.width > 0 && fragment.height > 0).flatMap(fragment =>
      [0.1, 0.5, 0.9].flatMap(x => [0.1, 0.5, 0.9].map(y => {
        const hit = document.elementFromPoint(fragment.left + fragment.width * x, fragment.top + fragment.height * y);
        return Boolean(hit && (hit === node || node.contains(hit)));
      })));
    return { selector, count: 1, shown: ancestorsVisible, rect: box, clip, hit_samples: hitSamples, text: node.textContent.trim().slice(0, 220) };
  });
  return { viewport: { width: innerWidth, height: innerHeight }, scroll_y: scrollY, chrome, content, targets };
}

export function checkFinancialViewportGeometry(geometry, check, key, viewport) {
  check(geometry.viewport.width === viewport.width && geometry.viewport.height === viewport.height, `${key}: viewport proof changed the requested viewport`);
  check(Boolean(geometry.chrome.header), `${key}: viewport proof must retain the visible page header`);
  if (viewport.width === 390) check(Boolean(geometry.chrome.navigation), `${key}: viewport proof must retain the visible mobile navigation`);
  check(geometry.targets.length > 0, `${key}: viewport proof requires named content targets`);
  for (const target of geometry.targets) {
    check(target.count === 1 && target.shown && Boolean(target.rect), `${key}: viewport target missing/hidden/ambiguous: ${target.selector}`);
    if (!target.rect) continue;
    const box = target.rect, clip = target.clip;
    check(Boolean(clip) && box.top >= clip.top - 0.1 && box.bottom <= clip.bottom + 0.1 && box.left >= clip.left - 0.1 && box.right <= clip.right + 0.1,
      `${key}: viewport capture does not fully expose ${target.selector} between chrome/clipping boundaries; no application accessibility conclusion is implied`);
    check(target.hit_samples?.length >= 9 && target.hit_samples.every(Boolean), `${key}: viewport target is overlapped at a sampled point: ${target.selector}`);
  }
}

// Scrolling only: keep the original viewport, DOM, sticky header and mobile
// navigation. A target that cannot fit remains an explicit capture failure.
export async function scrollFinancialViewport(page, selectors) {
  await page.locator(selectors[0]).scrollIntoViewIfNeeded();
  const geometry = await page.evaluate(financialViewportGeometry, selectors);
  const tops = geometry.targets.flatMap(target => target.rect ? [target.rect.top] : []);
  if (tops.length) await page.evaluate(delta => window.scrollBy({ top: delta, behavior: 'instant' }), Math.min(...tops) - geometry.content.top - 12);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
