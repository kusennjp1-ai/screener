// Daily brief fundamentals: the SEC quarters with their source and reasons, the detail's loading and
// failure states, the publication's SEC coverage (delivery failure, not requested, refused), the phone's
// compact card and its text floor, on synthetic data.
import { test, expect } from '@playwright/test';
import { openBrief, sessions, VIEWPORTS, horizontalOverflow, SEC_SYMBOL, date, rowBySymbol } from './brief-fixture.js';

const phone = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
// How many line boxes a word of a node's text sits on (1: it never breaks); null when the word is absent.
const lineBoxes = (locator, word) => locator.evaluate((node, word) => {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const at = text.textContent.replace(/\u00a0/g, ' ').indexOf(word);
    if (at < 0) continue;
    const range = document.createRange(); range.setStart(text, at); range.setEnd(text, at + word.length);
    return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size;
  }
  return null;
}, word);
// The ZZNV record with one change to its quarters (the base fixture never changes).
const zznv = change => ({ details: details => { change(details['ZZNV-detail.json'].book_financials.quarterly); } });
const point = (series, end) => series.find(item => item.end === end);

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`${name} ${device.viewport.width}px`, () => {
  test.use(device);

  test('fundamentals show the latest SEC quarter with its source and say why a value is missing', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    const card = page.getByTestId('brief-fundamentals');
    await expect(card.getByText('出典：SEC XBRL（10-K 2026-08-09 提出）・2026-06期まで・売上/純利益のQ4は10-K年度値−3四半期で算出')).toBeVisible();
    const epsTile = card.locator('.brief-fact').filter({ hasText: 'EPS 前年比' });
    await expect(epsTile).toContainText('+40%');
    await expect(epsTile).toContainText('2026-03期・最新 2026-06期はQ4のEPSは年次報告のみ');
    // The June quarter's sales are a derived Q4 compared with a derived Q4 a year earlier.
    await expect(card.locator('.brief-fact').filter({ hasText: '売上 前年比' })).toContainText('2026-06期・前期 +60%・前年同期はQ4算出');
    await expect(card.getByText('Q4算出').first()).toBeAttached();
    await expect(card.getByText('Code 33 未確認')).toBeVisible();
    await expect(card).toContainText('EPS の加速は第4四半期の EPS が年次報告（10-K）にしか無いため未確認です');
    await expect(card.getByRole('img', { name: /四半期の前年同期比成長率/ })).toBeVisible();
    // Each grey bar's reason is text (a phone shows no SVG title; it keeps them one fold away, with their
    // count), and the periods, growth rates and margins under the bars read at 12px at every width.
    if (device.isMobile) await card.locator('.brief-fin-gaps > summary').click();
    await expect(card.getByRole('list', { name: '値なしの理由' })).toContainText('EPS 前年比：25-06・26-06期はQ4のEPSは年次報告のみ');
    await expect(card.getByText('対象外：予想・サプライズ・予想修正・調整後EPS')).toBeVisible();
    await expect(card).not.toContainText(/カーソル|長押し/);
    const axis = await card.locator('.brief-q-axis > span > *').evaluateAll(nodes => nodes.map(node => [node.textContent, parseFloat(getComputedStyle(node).fontSize), node.scrollWidth > node.clientWidth + 0.5]));
    expect(axis.length).toBeGreaterThanOrEqual(40);
    expect(axis.slice(-6).map(([text]) => text)).toEqual(['26年', '6月', '—', '+100', '13', '算出']);
    expect(axis.filter(([, size, cut]) => size < 12 || cut)).toEqual([]);
    // The legend swatches use a radius token (Design Acceptance flags any other corner radius).
    const swatches = await card.locator('.brief-q-legend i').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).borderTopLeftRadius));
    expect(swatches.length).toBeGreaterThanOrEqual(3);
    for (const radius of swatches) expect(['4px', '8px', '12px', '16px']).toContain(radius);
    await expect(card).not.toContainText('未取得');
    expect(await horizontalOverflow(page)).toBe(0);
    // A stock without a published SEC record names that reason in every tile (on a phone, in the card's one-line fold).
    await page.goto('/#/brief/stock/ZZKS');
    const other = page.getByTestId('brief-fundamentals');
    if (device.isMobile) await expect(other.getByText('業績：SEC未配信・Code 33 未確認')).toBeVisible();
    await expect(other.locator('.brief-fact').first()).toContainText('SEC 未配信');
    await expect(other).toContainText('この銘柄の当日分の SEC 四半期データは配信されていません');
    await expect(other).not.toContainText('未取得');
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('while the research detail loads or after it fails, the SEC record is never called 未配信', async ({ page }) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { detailGate: gate });
    const card = page.getByTestId('brief-fundamentals');
    await expect(card.locator('.brief-fact').first()).toContainText('読み込み中…');
    await expect(card).toContainText('Code 33 読み込み中');
    await expect(card).not.toContainText(/SEC 未配信|配信されていません/);
    release();
    await expect(card.getByText(/^出典：SEC XBRL/)).toBeVisible();
    await expect(card).not.toContainText(/読み込み中|未配信/);
    // A detail that answers 503 says it could not be fetched, for good, and never 未配信.
    const failed = await page.context().newPage();
    try {
      const second = await openBrief(failed, `#/brief/stock/${SEC_SYMBOL}`, { fail: 'detail' });
      const failedCard = failed.getByTestId('brief-fundamentals');
      await expect(failedCard.locator('.brief-fact').first()).toContainText('取得できません', { timeout: 30000 });
      await expect(failedCard).toContainText('詳細データを取得できません。');
      await expect(failedCard).not.toContainText(/SEC 未配信|配信されていません/);
      expect(second.errors).toEqual([]);
    } finally { await failed.close(); }
    expect(errors).toEqual([]);
  });
});

test.describe('phone secondary text on the fundamentals rows', () => {
  test.use(phone(375, 812));
  const sizes = (page, selector) => page.locator(selector).evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => [node.className, node.textContent.slice(0, 20), parseFloat(getComputedStyle(node).fontSize)]));
  test('reads at 12px or more', async ({ page }) => {
    // The fundamentals half of the phone secondary-text test (its market half is in brief-market-phone.spec.js),
    // with the same data: one session behind.
    const { errors } = await openBrief(page, '#/brief/stock/ZZNV', { historyEnd: sessions.at(-2) });
    const fin = page.getByTestId('brief-fundamentals');
    await expect(fin.locator('.brief-q-axis')).toBeVisible();
    const rows = await sizes(page, '.brief-facts.is-fin .brief-fact small, .brief-facts.is-fin .brief-fact em');
    expect(rows).toHaveLength(6);
    expect(rows.filter(([, , size]) => size < 12)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// The publication's SEC coverage block (manifest.markets.US.fundamentals_coverage) as the exporter writes it.
const coverage = (extra = {}) => ({ schema_version: 'fundamentals-coverage-v1', as_of_date: date, sec_fetch_ran: true, sec_as_of: date, file_schema: 2, universe: 30, requested: 2,
  eligible: 2, truncated: 0, deadline_unreached: 0, ticker_map_ok: true, admitted: 1, with_quarters: 1, not_requested: 28, not_fetched: 0, refused: 1, refused_by_reason: { cik_url: 1 }, ...extra });
// ZZAR gets a canonical detail without a record, carrying the exporter's sec_admission.
const withAdmission = admission => ({
  rows: rows => { rows.find(row => row.symbol === 'ZZAR').research_detail_path = 'research-details/ZZAR-detail.json'; },
  details: details => { details['ZZAR-detail.json'] = { ...rowBySymbol.ZZAR, research_detail_path: 'research-details/ZZAR-detail.json', as_of_date: date, book_financials: null, sec_admission: admission }; },
});

test.describe('the publication\'s SEC coverage on the stock screen', () => {
  test.use(VIEWPORTS.phone);
  const fin = page => page.getByTestId('brief-fundamentals');

  test('a delivery failure of the whole publication is told as that, with its date and counts, never as the stock\'s results', async ({ page }) => {
    const failed = coverage({ sec_fetch_ran: false, sec_as_of: null, file_schema: null, requested: null, eligible: null, truncated: null, deadline_unreached: null, ticker_map_ok: null, admitted: 0, with_quarters: 0, not_requested: 0, not_fetched: 30, refused: 0, refused_by_reason: {} });
    const { errors } = await openBrief(page, '#/brief/stock/ZZAR', { mutate: { manifest: manifest => { manifest.markets.US.fundamentals_coverage = failed; } } });
    const line = fin(page).getByText('業績：SEC未配信（配信側の問題）・Code 33 未確認');
    await expect(line).toBeVisible();
    await line.click();
    await expect(fin(page)).toContainText(`この公開（${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}分）では SEC 四半期データを反映していません（0/30銘柄・配信側の問題で、業績の良し悪しではありません）。`);
    await expect(fin(page)).not.toContainText(/今後|次回|対象です/);
    expect(errors).toEqual([]);
  });

  test('a stock outside this SEC fetch and a refused record each say so', async ({ page }) => {
    const manifest = value => { value.markets.US.fundamentals_coverage = coverage(); };
    const { errors } = await openBrief(page, '#/brief/stock/ZZAR', { mutate: { manifest, ...withAdmission({ state: 'not_requested', reason: null }) } });
    await expect(fin(page).getByText('業績：SEC取得対象外・Code 33 未確認')).toBeVisible();
    await expect(fin(page)).toContainText('今回の SEC 取得の対象外です（取得 2/30銘柄）。');
    const refused = await page.context().newPage();
    try {
      const second = await openBrief(refused, '#/brief/stock/ZZAR', { mutate: { manifest, ...withAdmission({ state: 'refused', reason: 'cik_url' }) } });
      await expect(fin(refused).getByText('業績：SEC不採用（検証できず）・Code 33 未確認')).toBeVisible();
      await expect(fin(refused)).toContainText('取得対象でしたが、SEC の記録を検証できず不採用にしました（出典URLとCIK番号が一致しないため）。');
      expect(second.errors).toEqual([]);
    } finally { await refused.close(); }
    expect(errors).toEqual([]);
  });
});

test.describe('the compact fundamentals card', () => {
  const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
  const height = async page => Math.round((await page.getByTestId('brief-fundamentals').boundingBox()).height);
  const small = page => page.getByTestId('brief-fundamentals').locator('*').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length && [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim()))
    .map(node => [node.textContent.trim().slice(0, 24), parseFloat(getComputedStyle(node).fontSize)]).filter(([, size]) => size < 12));

  test.describe('390', () => {
    test.use({ ...VIEWPORTS.phone, contextOptions: { reducedMotion: 'reduce' } });
    test('fits one line without SEC quarters and 600px with them, keeps the source visible, 12px text and 44px folds', async ({ page }) => {
      const { errors } = await openBrief(page, '#/brief/stock/ZZAR');
      await expect(page.getByTestId('brief-fundamentals').getByText('業績：SEC未配信・Code 33 未確認')).toBeVisible();
      await settled(page);
      expect(await height(page)).toBeLessThanOrEqual(140);
      await page.goto(`/#/brief/stock/${SEC_SYMBOL}`);
      const card = page.getByTestId('brief-fundamentals');
      await expect(card.getByText(/^出典：SEC XBRL/)).toBeVisible();
      await settled(page);
      expect(await height(page)).toBeLessThanOrEqual(600);
      expect(await small(page)).toEqual([]);
      for (const summary of await card.locator('summary').all()) expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
      // The quality row reads three-valued: +10% and +20% are known and under 25% beside the missing fiscal-Q4 EPS,
      // so the rule is 未達 (the quarters are in the fold), and nothing passes from missing quarters.
      await expect(card.locator('.brief-fin-quality li')).toHaveText(['EPS前年比≥25%（直近4期）未達', '年間EPS最高 未確認']);
      await expect(card.locator('.brief-fin-quality li').first()).toHaveClass(/tone-ext/);
      await card.locator('.brief-fin-gaps > summary').click();
      await expect(card.getByRole('list', { name: '業績の質の根拠' })).toContainText('EPS前年比が25%未満の期：25-09期 +10%・25-12期 +20%');
      // Code 33's parts are said by its text (Q4 EPS): hidden on a phone.
      await expect(card.getByRole('list', { name: 'Code 33 の3条件' })).toBeHidden();
      expect(errors).toEqual([]);
    });

    test('keeps the Code 33 parts visible beside a 未達 and names the series behind it', async ({ page }) => {
      // Sales growth +10, +30, +60, then +30 in the June quarter: a known fall.
      const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { mutate: zznv(quarterly => { point(quarterly.revenue, '2026-06-30').value = 130; }) });
      const card = page.getByTestId('brief-fundamentals');
      await expect(card.getByText('Code 33 未達')).toBeVisible();
      await expect(card.getByText('未達の根拠：売上 前年比が2026-03期 +60% → 2026-06期 +30%と伸びが鈍化しています。')).toBeVisible();
      const parts = card.getByRole('list', { name: 'Code 33 の3条件' });
      await expect(parts).toBeVisible();
      await expect(parts.locator('li')).toHaveText(['EPS の加速未確認', '売上の加速未達', '純利益率の上昇達成']);
      await settled(page);
      expect(await small(page)).toEqual([]);
      expect(errors).toEqual([]);
    });
  });

  test.describe('320', () => {
    test.use({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    // Every label under the bars fits its own quarter's column (a label wider than its column runs into the next one).
    const wider = card => card.locator('.brief-q-axis > span > *').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().width > node.parentElement.getBoundingClientRect().width + 0.5)
      .map(node => `${node.textContent} ${node.getBoundingClientRect().width.toFixed(1)}>${node.parentElement.getBoundingClientRect().width.toFixed(1)}`));

    test('nothing overflows and no axis cell is cut', async ({ page }) => {
      const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
      const card = page.getByTestId('brief-fundamentals');
      await expect(card.getByText(/^出典：SEC XBRL/)).toBeVisible();
      await card.locator('.brief-fin-gaps > summary').click();
      expect(await horizontalOverflow(page)).toBe(0);
      const cut = await card.locator('.brief-q-axis > span > *, .brief-fin-quality li, .brief-q-legend span').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 0.5 || node.getBoundingClientRect().right > node.closest('[data-testid="brief-fundamentals"]').getBoundingClientRect().right + 0.5).map(node => node.textContent));
      expect(cut).toEqual([]);
      expect(await wider(card)).toEqual([]);
      await page.goto('/#/brief/stock/ZZAR');
      const line = page.getByTestId('brief-fundamentals').getByText('業績：SEC未配信・Code 33 未確認');
      await expect(line).toBeVisible();
      expect(await lineBoxes(line, 'Code 33')).toBe(1);
      expect(await horizontalOverflow(page)).toBe(0);
      expect(errors).toEqual([]);
    });

    test('a quarter that turns a profit into a loss reads 赤字 and fits its column', async ({ page }) => {
      // A year-ago EPS of 0.10 and a loss of 2.50 now: −2600% as a rate, which is no number to print.
      const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`, { mutate: zznv(quarterly => { point(quarterly.eps, '2025-03-31').value = 0.1; point(quarterly.eps, '2026-03-31').value = -2.5; }) });
      const card = page.getByTestId('brief-fundamentals');
      await expect(card.getByText(/^出典：SEC XBRL/)).toBeVisible();
      const labels = await card.locator('.brief-q-axis .q-eps-t').allTextContents();
      expect(labels.at(-2)).toBe('赤字');
      expect(labels.every(text => text.length <= 4)).toBe(true);
      await expect(card.locator('.brief-q-axis .q-eps-t').nth(labels.length - 2)).not.toHaveClass(/is-unknown/);
      await expect(card.getByText('未達の根拠：EPS 前年比が2025-12期 +20% → 2026-03期は赤字（EPS −2.50）です。')).toBeVisible();
      expect(await wider(card)).toEqual([]);
      expect(await horizontalOverflow(page)).toBe(0);
      expect(errors).toEqual([]);
    });

    test('the one-line summary of a delivery failure or a refusal never breaks inside 「Code 33」', async ({ page }) => {
      const failed = coverage({ sec_fetch_ran: false, sec_as_of: null, file_schema: null, requested: null, eligible: null, truncated: null, deadline_unreached: null, ticker_map_ok: null, admitted: 0, with_quarters: 0, not_requested: 0, not_fetched: 30, refused: 0, refused_by_reason: {} });
      const { errors } = await openBrief(page, '#/brief/stock/ZZAR', { mutate: { manifest: manifest => { manifest.markets.US.fundamentals_coverage = failed; } } });
      const line = page.getByTestId('brief-fundamentals').getByText('業績：SEC未配信（配信側の問題）・Code 33 未確認');
      await expect(line).toBeVisible();
      expect(await lineBoxes(line, 'Code 33')).toBe(1);
      expect(await horizontalOverflow(page)).toBe(0);
      const refused = await page.context().newPage();
      try {
        const second = await openBrief(refused, '#/brief/stock/ZZAR', { mutate: { manifest: manifest => { manifest.markets.US.fundamentals_coverage = coverage(); }, ...withAdmission({ state: 'refused', reason: 'cik_url' }) } });
        const other = refused.getByTestId('brief-fundamentals').getByText('業績：SEC不採用（検証できず）・Code 33 未確認');
        await expect(other).toBeVisible();
        expect(await lineBoxes(other, 'Code 33')).toBe(1);
        expect(second.errors).toEqual([]);
      } finally { await refused.close(); }
      expect(errors).toEqual([]);
    });
  });

  test.describe('1440', () => {
    test.use(VIEWPORTS.desktop);
    test('keeps the desktop layout: nothing folded, every part and footnote in place', async ({ page }) => {
      const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
      const card = page.getByTestId('brief-fundamentals');
      await expect(card.getByText(/^出典：SEC XBRL/)).toBeVisible();
      await expect(card.locator('details')).toHaveCount(0);
      for (const locator of [card.getByRole('list', { name: '値なしの理由' }), card.getByRole('list', { name: 'Code 33 の3条件' }), card.getByText('対象外：予想・サプライズ・予想修正・調整後EPS'),
        card.getByText('算出＝Q4を10-K年度値−3四半期で算出'), card.getByText(/^EPS は報告値（希薄化）/), card.locator('.brief-code33-mark'), card.getByRole('list', { name: '業績の質の根拠' })]) await expect(locator).toBeVisible();
      // The step-0 layout (5ae744d; its dump's desktop1440 stock ZZNV and the same boxes measured on that tree): the
      // card is the grid's left tile at x 464, 470 wide; its three tiles sit in one row at x 17, 165 and 313 within it,
      // 140 wide, and the chart, the Code 33 box and the parts keep x 17, 436 wide. Only the order below the tiles
      // gained the quality row and its notes, between the tiles and the chart. (x and widths follow the grid, not the fonts.)
      const boxes = await card.evaluate(node => {
        const card = node.getBoundingClientRect();
        const box = element => { const rect = element.getBoundingClientRect(); return { x: rect.x - card.x, y: rect.y - card.y, w: rect.width, h: rect.height }; };
        const pick = selector => [...node.querySelectorAll(selector)].map(box);
        return { card: { x: card.x, w: card.width }, tiles: pick('.brief-facts.is-fin .brief-fact'), quality: pick('.brief-fin-quality'), notes: pick('.brief-fin-quality-notes'),
          chart: pick('svg.brief-quarters'), code33: pick('.brief-code33'), parts: pick('.brief-code33-parts') };
      });
      const near = (actual, expected) => expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(1);
      near(boxes.card.x, 464); near(boxes.card.w, 470);
      expect(boxes.tiles).toHaveLength(3);
      expect(new Set(boxes.tiles.map(tile => Math.round(tile.y))).size).toBe(1);
      boxes.tiles.forEach((tile, i) => { near(tile.x, [17, 165, 313][i]); near(tile.w, 140); });
      for (const block of [boxes.chart[0], boxes.code33[0], boxes.parts[0]]) { near(block.x, 17); near(block.w, 436); }
      const order = [boxes.tiles[0], boxes.quality[0], boxes.notes[0], boxes.chart[0], boxes.code33[0], boxes.parts[0]];
      for (let i = 1; i < order.length; i++) expect(order[i].y).toBeGreaterThanOrEqual(order[i - 1].y + order[i - 1].h - 0.5);
      await page.goto('/#/brief/stock/ZZAR');
      const other = page.getByTestId('brief-fundamentals');
      await expect(other.locator('.brief-fact').first()).toBeVisible();
      await expect(other.locator('details')).toHaveCount(0);
      expect(await horizontalOverflow(page)).toBe(0);
      expect(errors).toEqual([]);
    });
  });
});

