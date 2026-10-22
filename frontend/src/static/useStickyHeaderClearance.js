import { useLayoutEffect } from 'react';

export function stickyHeaderClearance(scrollTop, headerBottom) {
  if (!Number.isFinite(scrollTop) || !Number.isFinite(headerBottom) || scrollTop >= headerBottom + 2) return 0;
  return Math.max(0, Math.ceil(headerBottom + 2 - scrollTop));
}

export function stickyBoardHeightLimit(gridBottom, headerBottom, viewportHeight, minimumHeight) {
  if (![gridBottom, headerBottom, viewportHeight, minimumHeight].every(Number.isFinite)) return null;
  const available = Math.max(minimumHeight, Math.floor(gridBottom - headerBottom - 2));
  return available < viewportHeight - headerBottom ? available : null;
}

function minimumBoardHeight(board, scroll) {
  const pixels = value => Number.parseFloat(value) || 0;
  const style = getComputedStyle(board);
  const children = [...board.children].filter(node => getComputedStyle(node).display !== 'none');
  // Measure the genuine controls, including their margins. Subtracting the
  // scrollport from the capped board undercounts chrome once the port hits0.
  const controls = children.filter(node => node !== scroll).reduce((height, node) => {
    const childStyle = getComputedStyle(node);
    return height + node.getBoundingClientRect().height + pixels(childStyle.marginTop) + pixels(childStyle.marginBottom);
  }, 0);
  return controls + pixels(style.paddingTop) + pixels(style.paddingBottom)
    + pixels(style.borderTopWidth) + pixels(style.borderBottomWidth)
    + pixels(style.rowGap) * Math.max(0, children.length - 1) + 28 + 51;
}

// Keep the whole sidebar, including its glossary, below app navigation while
// its grid has room for the controls and one complete row. The grid retains its
// original minimum extent, so the cap cannot move its own measured boundary.
// Below that minimum the sidebar exits normally; retain inner-header clearance.
export function useStickyHeaderClearance(scrollRef, enabled) {
  useLayoutEffect(() => {
    const scroll = scrollRef.current, header = document.querySelector('.leader-header');
    if (!enabled || !scroll || !header) return undefined;
    const board = scroll.closest('.research-list'), grid = scroll.closest('.research-grid');
    const setStyle = (node, key, value) => {
      if (node && node.style.getPropertyValue(key) !== value) {
        if (value) node.style.setProperty(key, value);
        else node.style.removeProperty(key);
      }
    };
    const glossary = board?.querySelector('.candidate-glossary');
    let frame, revealGlossary = false;
    const update = () => {
      // The unscrolled/mobile layout already clears the header. Avoid an
      // unnecessary synchronous layout measurement on initial rendering.
      const desktopScrolled = window.innerWidth > 700 && window.scrollY > 0;
      const headerBottom = desktopScrolled ? header.getBoundingClientRect().bottom : 0;
      let limit = null;
      if (desktopScrolled && board && grid) {
        const minimum = minimumBoardHeight(board, scroll);
        // An explicit glossary expansion may need more room than remains at
        // the grid end. Reveal that newly opened content without moving focus.
        // Ordinary scrolling/resizing never triggers this document scroll.
        const deficit = Math.floor(grid.getBoundingClientRect().bottom - headerBottom - 2 - minimum);
        if (revealGlossary && deficit < 0) window.scrollBy({ top: deficit, behavior: 'instant' });
        limit = stickyBoardHeightLimit(grid.getBoundingClientRect().bottom, headerBottom, window.innerHeight, minimum);
      }
      revealGlossary = false;
      setStyle(board, '--candidate-board-max-height', limit === null ? '' : `${limit}px`);
      // Read after applying the outer cap: the scrollport may have moved back
      // below the header. Do not retain its old displacement as extra padding.
      const clearance = desktopScrolled ? stickyHeaderClearance(scroll.getBoundingClientRect().top, headerBottom) : 0;
      setStyle(scroll, '--candidate-header-clearance', clearance ? `${clearance}px` : '');
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const onGlossaryToggle = () => { revealGlossary = glossary.open; schedule(); };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    for (const node of [scroll, header, grid]) if (node) observer?.observe(node);
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    glossary?.addEventListener('toggle', onGlossaryToggle);
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect();
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
      glossary?.removeEventListener('toggle', onGlossaryToggle);
      scroll.style.removeProperty('--candidate-header-clearance');
      board?.style.removeProperty('--candidate-board-max-height');
    };
  }, [scrollRef, enabled]);
}
