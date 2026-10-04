// Untimed task walkthrough only. Read the product's visible size/range and
// collect its entire search result before comparing it with the exported CSV.
export function observeFeedPage() {
  const board = document.querySelector('#candidate-board');
  const status = board?.querySelector('.candidate-pagination [role="status"]')?.textContent.trim() || '';
  const range = /^全([\d,]+)銘柄中([\d,]+)–([\d,]+)$/.exec(status);
  const number = value => /^\d+$/.test(value || '') ? Number(value) : null;
  const size = number(board?.querySelector('[aria-label="1ページの銘柄数"]')?.value);
  const next = [...(board?.querySelectorAll('.candidate-pagination button') || [])].find(button => button.textContent.trim() === `次の${size}件`);
  return { size, page: number(board?.querySelector('[aria-label="候補のページ"]')?.value), status,
    total: range ? Number(range[1].replaceAll(',', '')) : null,
    start: range ? Number(range[2].replaceAll(',', '')) : null,
    end: range ? Number(range[3].replaceAll(',', '')) : null,
    symbols: [...(board?.querySelectorAll('.candidate-feed-card .candidate-name strong') || [])].map(node => node.textContent.trim()),
    next_disabled: next ? next.disabled : null };
}

function feedPageReady(expectedStart) {
  const board = document.querySelector('#candidate-board');
  const status = board?.querySelector('.candidate-pagination [role="status"]')?.textContent.trim() || '';
  const range = /^全([\d,]+)銘柄中([\d,]+)–([\d,]+)$/.exec(status);
  if (!range) return false;
  const start = Number(range[2].replaceAll(',', '')), end = Number(range[3].replaceAll(',', ''));
  return start === expectedStart && board.querySelectorAll('.candidate-feed-card .candidate-name strong').length === end - start + 1;
}

export async function collectResearchFeedPages(page) {
  let observed = await page.evaluate(observeFeedPage);
  if (observed.page > 0) {
    await page.getByLabel('候補のページ', { exact: true }).selectOption('0');
    await page.waitForFunction(feedPageReady, 1);
    observed = await page.evaluate(observeFeedPage);
  }
  const total = observed.total, size = observed.size, pages = [], symbols = [], seen = new Set();
  if (![20, 50].includes(size) || !Number.isInteger(total) || total < 1) throw Error('Feed search has no valid visible page size/full result total');
  while (true) {
    const start = symbols.length + 1, end = Math.min(start + size - 1, total);
    if (observed.size !== size || observed.total !== total || observed.start !== start || observed.end !== end || observed.page !== pages.length) throw Error('Feed pagination changed size/total or skipped/repeated a visible range');
    if (observed.symbols.length !== end - start + 1 || observed.symbols.some(symbol => !symbol || seen.has(symbol)) || new Set(observed.symbols).size !== observed.symbols.length) throw Error('Feed pagination has missing, empty or duplicate rendered symbols');
    observed.symbols.forEach(symbol => { seen.add(symbol); symbols.push(symbol); });
    pages.push(observed);
    if (end === total) {
      if (observed.next_disabled !== true) throw Error('Feed final visible range still offers another page');
      break;
    }
    if (observed.next_disabled !== false) throw Error('Feed pagination ended before the full visible result total');
    await page.getByRole('button', { name: `次の${size}件`, exact: true }).click();
    await page.waitForFunction(feedPageReady, end + 1);
    observed = await page.evaluate(observeFeedPage);
  }
  if (symbols.length !== total || seen.size !== total) throw Error('Feed pagination did not enumerate every result exactly once');
  return { size, total, pages, symbols };
}
