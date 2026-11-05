// Daily brief market tab on phones: the verdict and the chart, the tab's secondary text and its words at
// 320px, on synthetic data.
import { test, expect } from '@playwright/test';
import { date, openBrief, sessions, VIEWPORTS, horizontalOverflow } from './brief-fixture.js';

const phone = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

test.describe('the market tab on a phone keeps the verdict and the chart', () => {
  test.use(VIEWPORTS.phone);
  test('verdict and S&P chart are visible on #/brief/market', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    const market = page.getByRole('region', { name: '地合い' });
    await expect(market.locator('.brief-verdict')).toBeVisible();
    await expect(market.locator('.brief-index')).toBeVisible();
    // The phone hides the hero's date line (Track E); the bar says the analysis date, with its weekday.
    await expect(page.locator('.brief-bar-title')).toContainText('分析基準日 10/2（金）引け・米国株');
    await expect(page.locator('.brief-bar-title time')).toHaveAttribute('datetime', date);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('phone secondary text on the market tab', () => {
  test.use(phone(375, 812));
  const MARKET = '.brief-index-stats small, .brief-index-stats span, .brief-index-source, .brief-env-status, .brief-env-change, .brief-stagelegend, .brief-sector-name small, .brief-sector-move, .brief-fact-asof, .brief-signals > b small, .brief-verdict-date';
  const sizes = (page, selector) => page.locator(selector).evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => [node.className, node.textContent.slice(0, 20), parseFloat(getComputedStyle(node).fontSize)]));
  test('reads at 12px or more, labels in --text-2, and 基準 is a label, not a 16px value', async ({ page }) => {
    // One session behind, so the as-of tags (「（10/1時点）」) are on screen too.
    const { errors } = await openBrief(page, '#/brief/market', { historyEnd: sessions.at(-2) });
    // Every section of the tab, one after the other (a phone shows one at a time).
    await expect(page.getByRole('tab')).toHaveCount(4);
    const market = [];
    for (const tab of await page.getByRole('tab').all()) {
      await tab.click();
      if ((await tab.textContent()) === '推移') await expect(page.locator('.market-history-explorer').getByRole('img')).toBeVisible();
      market.push(...await sizes(page, MARKET));
    }
    await page.getByRole('tab', { name: '指数' }).click();
    expect(market.length).toBeGreaterThan(20);
    expect(market.filter(([, , size]) => size < 12)).toEqual([]);
    const label = await page.locator('.brief-index-stats small').first().evaluate(node => [getComputedStyle(node).color, getComputedStyle(node.closest('.brief-index-block')).getPropertyValue('--text-2')]);
    expect(label[0]).toBe(await page.evaluate(value => { const probe = document.createElement('span'); probe.style.color = value; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }, label[1].trim()));
    await page.locator('.brief-env-toggle').first().click();
    const rule = await page.locator('.brief-env-rule').first().evaluate(node => { const b = node.querySelector('b'); return [getComputedStyle(b).fontSize, getComputedStyle(node).fontSize, getComputedStyle(b).fontFamily === getComputedStyle(node).fontFamily]; });
    expect(rule).toEqual(['12px', '12px', true]);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('market tab words at 320px', () => {
  test.use(phone(320, 640));
  test('the verdict keeps （独自判定） whole, the exposure label breaks before の目安, row notes get the row width', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    const verdict = page.getByTestId('brief-regime');
    await expect(verdict.locator('strong .brief-frag')).toHaveText('（独自判定）');
    expect(await verdict.locator('strong .brief-frag').evaluate(node => node.getClientRects().length)).toBe(1);
    for (const part of await verdict.locator('.brief-exposure small .brief-frag').all()) expect(await part.evaluate(node => node.getClientRects().length)).toBe(1);
    // Below 360px the 1-year line and the 1-month change sit under the note, not beside it.
    const stacked = await page.locator('.brief-env-toggle').evaluateAll(toggles => toggles.filter(t => t.querySelector(':scope > em') && t.querySelector(':scope > .brief-env-change'))
      .map(t => { const note = t.querySelector(':scope > em').getBoundingClientRect(), change = t.querySelector(':scope > .brief-env-change').getBoundingClientRect(); return change.top >= note.bottom - 1; }));
    expect(stacked.length).toBeGreaterThanOrEqual(3);
    expect(stacked.every(Boolean)).toBe(true);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// ---- 過去の傾向 and the guide's basis on a phone (Track B) -----------------------------------------------------
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
const B_TEXT = '.brief-regime-ref summary, .brief-regime-index li, .brief-regime-index h4, .brief-regime-nas, .brief-regime-key, .brief-regime-foot, .brief-exposure-basis summary, .brief-exposure-basis p, .brief-signal-tag, .brief-signals-tags, .brief-index-nas, .brief-index-scale, .brief-index-mark, .brief-index-stats span';
const contentHeight = page => page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY));
const DD_METHOD = 'index-down-strictly-over-0.2-higher-volume-age25-high5-v1';
/** What every publication of the new exporter carries: method ids on both series and the Nasdaq's position. */
const nasdaqState = { trends: value => {
  for (const index of value.indices) index.method = DD_METHOD;
  value.indices[1].state = { date: value.indices[1].points.at(-1).date, close: 18234.56, vs50: -1.4, vs200: 3.2, fromHigh: -7.25, fullYear: true };
} };

test.describe('the study block and the guide\'s basis at 375×812', () => {
  test.use({ ...phone(375, 812), contextOptions: { reducedMotion: 'reduce' } });
  test('fit the market budget, keep the lead above 756px, fold to 44–48px, open by keyboard and read at 12px or more', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    await expect(page.locator('.market-history-explorer svg').first()).toBeAttached();
    await settled(page);
    expect(await page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY))).toBeLessThanOrEqual(1300);
    const market = page.getByRole('region', { name: '地合い' });
    const verdict = market.getByTestId('brief-regime'), basis = verdict.locator('details.brief-exposure-basis'), study = market.locator('details.brief-regime-ref');
    for (const locator of [verdict, verdict.locator('.brief-exposure'), basis, market.getByRole('group', { name: '注意サイン（独自判定）' }), page.getByRole('tab').first()]) {
      const box = await locator.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(756);
    }
    // The Nasdaq is on a rally attempt while the verdict is positive: the summary names the fold and the note's short form.
    await expect(basis.locator('summary')).toHaveText('目安と判定の基準・Nasdaqは反発3日目（判定はSPYのみ）');
    for (const fold of [basis, study]) {
      await expect(fold).not.toHaveAttribute('open', '');
      const height = (await fold.locator('summary').boundingBox()).height;
      expect(height).toBeGreaterThanOrEqual(44);
      expect(height).toBeLessThanOrEqual(48);
      await fold.locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(fold).toHaveAttribute('open', '');
      await page.keyboard.press('Space');
      await expect(fold).not.toHaveAttribute('open', '');
      await page.keyboard.press('Enter');
    }
    await expect(basis).toContainText('根拠（10/2スキャン時点）：S&P 500（SPY）が50日線・200日線の上');
    await expect(basis).toContainText('独自の目安：上昇トレンド 最大50%・上昇に圧力 最大25%・それ以外 0%');
    await expect(study.locator('li').first()).toBeVisible();
    // The 〔参考〕 legend is short on a phone; the full sentence is in the 注記.
    await expect(market.locator('.brief-signals-tags')).toHaveText('〔参考〕＝2021〜26年の検証で関係未確認');
    await expect(page.locator('.brief-screen-notes')).toContainText('注意サインの印：〔参考〕は、2021〜2026年の参加度データ');
    await expect(page.locator('.brief-screen-notes')).toContainText('参加度・リーダーの値は、現在の銘柄で過去をさかのぼった集計（上場廃止銘柄を含まない）です。');
    const small = await page.locator(B_TEXT).evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).filter(node => parseFloat(getComputedStyle(node).fontSize) < 12).map(node => node.textContent.slice(0, 30)));
    expect(small).toEqual([]);
    expect(await page.locator(B_TEXT).evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).length)).toBeGreaterThan(12);
    // The 200-day distance is the 50-day cell's second line: the stats row stays one row.
    const cells = await market.locator('.brief-index-stats > div').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(cells).size).toBe(1);
    await expect(market.locator('.brief-index-stats .is-ma span')).toHaveText(/^200日線比 [+−]\d+\.\d%$/);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('the market screen at 375×812 with what the new exporter publishes', () => {
  test.use({ ...phone(375, 812), contextOptions: { reducedMotion: 'reduce' } });
  test('a Nasdaq position fits the market budget: its figures fold into 過去の傾向, the lead stays above 756px', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', { mutate: nasdaqState });
    await expect(page.locator('.market-history-explorer svg').first()).toBeAttached();
    await settled(page);
    expect(await contentHeight(page)).toBeLessThanOrEqual(1300);
    const market = page.getByRole('region', { name: '地合い' });
    for (const locator of [market.getByTestId('brief-regime'), market.getByRole('group', { name: '注意サイン（独自判定）' }), page.getByRole('tab').first()]) {
      const box = await locator.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(756);
    }
    // No row of its own on a phone: the figures are the first line of the Nasdaq block inside the (closed) fold.
    await expect(market.locator('.brief-index-nas')).toHaveCount(0);
    const study = market.locator('details.brief-regime-ref');
    await expect(study).not.toHaveAttribute('open', '');
    await study.locator('summary').click();
    await expect(study.locator('.brief-regime-index').last().locator('h4 + .brief-regime-nas')).toHaveText('18,234.5610/2終値・1年高値から −7.3%・50日線比 −1.4%・200日線比 +3.2%');
    expect(errors).toEqual([]);
  });
});

// Long history one session behind the analysis date (a known production state): the lag is said in the heading's
// stamp slot, the rest of the sentence in the 注記, so the screen keeps its budget and its lead block.
test.describe('the market screen at 375×812 one session behind', () => {
  test.use({ ...phone(375, 812), contextOptions: { reducedMotion: 'reduce' } });
  for (const [name, mutate] of [['the base data', undefined], ['a Nasdaq position', nasdaqState]]) test(`with ${name}: within 1300, the lead above 756px, the lag in the stamp slot`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', { historyEnd: sessions.at(-2), mutate });
    await expect(page.locator('.market-history-explorer svg').first()).toBeAttached();
    const market = page.getByRole('region', { name: '地合い' });
    const stamp = market.locator(':scope > .brief-step .brief-stamp');
    await expect(stamp).toHaveText('◷ 10/1引け・10/2分は再集計待ち');
    await expect(stamp).toHaveAttribute('role', 'note');
    await expect(market.locator('.brief-lag')).toHaveCount(0);
    await expect(page.locator('.brief-screen-notes')).toContainText('日付が異なる項目には個別に日付を付けています。');
    await expect(market.getByTestId('brief-regime')).toContainText('判定 10/2');
    await settled(page);
    // One line beside the heading.
    expect(await stamp.evaluate(node => node.getClientRects().length)).toBe(1);
    expect(Math.round((await stamp.boundingBox()).height)).toBeLessThanOrEqual(16);
    expect(await contentHeight(page)).toBeLessThanOrEqual(1300);
    for (const locator of [market.getByTestId('brief-regime'), market.getByRole('group', { name: '注意サイン（独自判定）' }), page.getByRole('tab').first()]) {
      const box = await locator.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(756);
    }
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('the lag stamp at 320px', () => {
  test.use(phone(320, 640));
  test('stays within the width and beside the heading', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', { historyEnd: sessions.at(-2) });
    const market = page.getByRole('region', { name: '地合い' });
    const stamp = market.locator(':scope > .brief-step .brief-stamp');
    await expect(stamp).toHaveText('◷ 10/1引け・10/2分は再集計待ち');
    const [head, box] = [await market.locator(':scope > .brief-step h2').boundingBox(), await stamp.boundingBox()];
    expect(box.x).toBeGreaterThan(head.x + head.width);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

for (const width of [375, 390]) test.describe(`the S&P stats row without 200 closes at ${width}px`, () => {
  test.use({ ...phone(width, width === 375 ? 812 : 844), contextOptions: { reducedMotion: 'reduce' } });
  test('keeps its height: a dash is visible, the words are read out and the reason is in the 注記', async ({ page, context }) => {
    // The row's height with every close, on a page of its own.
    const before = await context.newPage();
    await openBrief(before, '#/brief/market');
    const full = (await before.getByRole('region', { name: '地合い' }).locator('.brief-index-stats').boundingBox()).height;
    await before.close();
    const row = page.getByRole('region', { name: '地合い' }).locator('.brief-index-stats');
    const { errors } = await openBrief(page, '#/brief/market', { mutate: { trends: value => { const closes = value.long_history.sp500; closes.forEach((point, i) => { if (i < closes.length - 150) point.close = null; }); } } });
    await expect(row.locator('.is-ma span').first()).toHaveText('200日線比 —');
    await expect(row.locator('.is-ma .sr-only')).toHaveText('200日線比 未算出（200日分の終値なし）');
    expect((await row.boundingBox()).height).toBe(full);
    const cells = await row.locator(':scope > div').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(cells).size).toBe(1);
    await expect(page.locator('.brief-screen-notes')).toContainText('200日線比は、長期履歴に200日分の終値がないため未算出です。');
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

for (const width of [320, 375, 414]) test.describe(`the study block and the Nasdaq figures at ${width}px`, () => {
  test.use(phone(width, 812));
  test('stay within the width, opened and with every mark inside the chart\'s frame', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', { mutate: nasdaqState });
    const market = page.getByRole('region', { name: '地合い' });
    await expect(market.locator('.brief-index-nas')).toHaveCount(0);
    // The guide's fold keeps a 44–48px summary even with the Nasdaq note in it.
    const basis = (await market.locator('details.brief-exposure-basis > summary').boundingBox()).height;
    expect(basis).toBeGreaterThanOrEqual(44);
    expect(basis).toBeLessThanOrEqual(48);
    for (const summary of await market.locator('details.brief-regime-ref > summary, details.brief-exposure-basis > summary').all()) await summary.click();
    await expect(market.locator('.brief-regime-nas')).toBeVisible();
    await expect(market.locator('details.brief-regime-ref .brief-regime-index').last().locator('li').first()).toHaveText('200日線の上・50日線の下（10/2時点）：26%（全期間 26%）〔未確立〕');
    for (const keep of await market.locator('.brief-regime-keep').all()) expect(await keep.evaluate(node => node.getClientRects().length)).toBe(1);
    await market.locator('.brief-env-row.brief-dist').filter({ hasText: '分配日（25日）' }).locator('.brief-env-toggle').click();
    expect(await horizontalOverflow(page)).toBe(0);
    const frame = await market.locator('.brief-index-frame').boundingBox();
    for (const mark of await market.locator('.brief-index-mark, .brief-index-mark-label, .brief-index-scale').all()) {
      const box = await mark.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(frame.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(frame.y - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
    }
    expect(errors).toEqual([]);
  });
});
