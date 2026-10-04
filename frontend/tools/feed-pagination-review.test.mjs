import { afterEach, describe, expect, it } from 'vitest';
import { collectResearchFeedPages, observeFeedPage } from './feed-pagination-review.mjs';
import { parseResearchCsv } from './research-feed-acceptance.mjs';

afterEach(() => { document.body.innerHTML = ''; });

// A DOM-backed page adapter exercises the untimed walkthrough without running
// Playwright or claiming browser evidence. The nested range matches the UI.
function searchResults(size, { startPage = 0, duplicateSecondPage = false, prematureEnd = false, missingCard = false } = {}) {
  const matches = Array.from({ length: 57 }, (_, i) => `SEARCH${String(i + 1).padStart(2, '0')}`);
  let current = startPage;
  const clicks = [], selections = [];
  const render = () => {
    const start = current * size + 1, end = Math.min((current + 1) * size, matches.length);
    const symbols = matches.slice(start - 1, end);
    if (duplicateSecondPage && current === 1) symbols[0] = matches[0];
    if (missingCard && current === 0) symbols.pop();
    document.body.innerHTML = `<section id="candidate-board"><div class="candidate-scroll">${symbols.map(symbol => `<article class="candidate-feed-card"><span class="candidate-name"><strong>${symbol}</strong></span></article>`).join('')}</div><div class="candidate-pagination"><div class="feed-page-summary"><span role="status">全${matches.length}銘柄中${start}–${end}</span><label>表示<select aria-label="1ページの銘柄数"><option value="${size}" selected>${size}件</option></select></label></div><div class="feed-page-navigation"><label><select aria-label="候補のページ"><option value="${current}" selected>${current + 1} / ${Math.ceil(matches.length / size)}</option></select></label><button ${end === matches.length || prematureEnd ? 'disabled' : ''}>次の${size}件</button></div></div></section>`;
  };
  render();
  const page = {
    evaluate: async fn => fn(),
    waitForFunction: async (fn, value) => { if (!fn(value)) throw Error('Visible page range did not settle'); },
    getByLabel: (label, options) => ({ selectOption: async value => {
      expect(label).toBe('候補のページ'); expect(options.exact).toBe(true);
      selections.push(value); current = Number(value); render();
    } }),
    getByRole: (role, options) => ({ click: async () => {
      expect(role).toBe('button'); expect(options).toEqual({ name: `次の${size}件`, exact: true });
      const button = [...document.querySelectorAll('button')].find(node => node.textContent === options.name);
      if (!button || button.disabled) throw Error('No enabled next-page button');
      clicks.push(options.name); current++; render();
    } }),
  };
  return { page, matches, clicks, selections };
}

describe('complete search-result pagination before CSV comparison', () => {
  it.each([20, 50])('enumerates every one of >20 search matches at page size %i', async size => {
    const { page, matches, clicks } = searchResults(size);
    const result = await collectResearchFeedPages(page);
    expect(result.size).toBe(size);
    expect(result.total).toBe(57);
    expect(result.symbols).toEqual(matches);
    expect(new Set(result.symbols).size).toBe(57);
    expect(result.pages.map(({ start, end }) => [start, end])).toEqual(size === 20 ? [[1, 20], [21, 40], [41, 57]] : [[1, 50], [51, 57]]);
    expect(clicks).toEqual(Array(Math.ceil(57 / size) - 1).fill(`次の${size}件`));
    const csv = parseResearchCsv(`symbol,method\n${matches.map(symbol => `${symbol},oneil`).join('\n')}`);
    expect(csv.map(row => row.symbol)).toEqual(result.symbols);
    expect(csv.length).toBe(result.total);
  });
  it('returns to the first page before collecting results from a retained later page', async () => {
    const { page, matches, selections } = searchResults(20, { startPage: 1 });
    expect((await collectResearchFeedPages(page)).symbols).toEqual(matches);
    expect(selections).toEqual(['0']);
  });
  it.each([20, 50])('rejects duplicate symbols across %i-card pages', async size => {
    const { page } = searchResults(size, { duplicateSecondPage: true });
    await expect(collectResearchFeedPages(page)).rejects.toThrow('missing, empty or duplicate');
  });
  it('rejects an incomplete page instead of comparing the first slice against full CSV', async () => {
    const { page } = searchResults(20, { missingCard: true });
    await expect(collectResearchFeedPages(page)).rejects.toThrow('missing, empty or duplicate');
  });
  it('rejects pagination that ends while the visible total promises more symbols', async () => {
    const { page } = searchResults(20, { prematureEnd: true });
    await expect(collectResearchFeedPages(page)).rejects.toThrow('before the full visible result total');
  });
  it('reads nested status ranges with grouped counts', () => {
    searchResults(20);
    document.querySelector('[role="status"]').textContent = '全1,234銘柄中1,201–1,220';
    expect(observeFeedPage()).toMatchObject({ size: 20, total: 1234, start: 1201, end: 1220 });
  });
});
