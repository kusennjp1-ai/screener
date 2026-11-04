// Daily brief on phones, compacted: each screen's height at 375×812 stays within its budget, every
// expander and the market tab's section tabs work by keyboard and keep their state for the session,
// the section tabs stay under the bar while the page scrolls without covering a focused control,
// the new controls keep the 12px text floor and 44px targets, and nothing overflows at 320/375/414 px.
import { test, expect } from '@playwright/test';
import { openBrief, horizontalOverflow, SEC_SYMBOL } from './brief-fixture.js';

const phone = (width, height = 812) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const WATCH = ['ZZNV', 'ZZZF', 'ZZSD', 'ZZKS'];
const SCREENS = {
  today: ['#/brief', page => expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate')).toHaveCount(5)],
  list: ['#/brief/list', page => expect(page.getByTestId('brief-candidate').first()).toBeVisible()],
  watch: ['#/brief/watch', page => expect(page.getByRole('region', { name: 'ウォッチ中の銘柄' }).getByTestId('brief-candidate')).toHaveCount(WATCH.length)],
  market: ['#/brief/market', page => expect(page.locator('.market-history-explorer svg').first()).toBeAttached()],
  stock: [`#/brief/stock/${SEC_SYMBOL}`, page => expect(page.getByTestId('brief-fundamentals').getByText(/^出典：SEC XBRL/)).toBeVisible()],
};
// Content height (the bottom of the screen's last block) at 375×812 on this fixture. Before the
// compaction it measured today 1615, list 906, watch 535, market 3517 and stock 4675 px (after: about
// 1235, 635, 472, 1192 and 3078); the budgets keep about a tenth of headroom over the compacted layout
// for other fonts (CI renders taller text).
const BUDGET = { today: 1400, list: 720, watch: 520, market: 1300, stock: 3400 };
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
const contentHeight = page => page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY));
const tabs = page => page.getByRole('tablist', { name: '市場タブの表示' }).getByRole('tab');

test.describe('screen heights at 375×812', () => {
  // Reduced motion settles every entrance, so the height is the final one.
  test.use({ ...phone(375), contextOptions: { reducedMotion: 'reduce' } });
  for (const [name, [hash, ready]] of Object.entries(SCREENS)) test(`${name} fits its budget`, async ({ page }) => {
    const { errors } = await openBrief(page, hash, { storage: { 'research-watch': WATCH } });
    await ready(page);
    await settled(page);
    const height = await contentHeight(page);
    expect(height, `${name} content height`).toBeLessThanOrEqual(BUDGET[name]);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('the market tab opens on the verdict and the index section; every section is a tab away', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    await expect(tabs(page)).toHaveText(['指数', '参加度▲注意1', 'リーダー', '推移']);
    await expect(tabs(page).first()).toHaveAttribute('aria-selected', 'true');
    // The verdict, the exposure guide and the warning summary are on the first screen, before any tab.
    for (const locator of [page.getByTestId('brief-regime'), page.getByRole('group', { name: '注意サイン（独自判定）' }), tabs(page).first()]) {
      const box = await locator.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(812 - 56);
    }
    // Each section is shorter than the stacked page was.
    for (const tab of await tabs(page).all()) {
      await tab.click();
      expect(await contentHeight(page), await tab.textContent()).toBeLessThanOrEqual(2400);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('expanders and tabs by keyboard', () => {
  test.use(phone(390, 844));

  test('a folded block opens and closes with Enter and Space and stays open for the session', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await expect(page.getByTestId('brief-fundamentals').getByText(/^出典：SEC XBRL/)).toBeVisible();
    const fold = page.locator('details', { has: page.locator('summary', { hasText: '8条件の内訳（すべて達成）' }) });
    const summary = fold.locator('summary');
    await expect(fold.locator('.brief-checks li').first()).toBeHidden();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(fold).toHaveAttribute('open', '');
    await expect(fold.locator('.brief-checks li')).toHaveCount(8);
    for (const item of await fold.locator('.brief-checks li').all()) await expect(item).toBeVisible();
    await page.keyboard.press('Space');
    await expect(fold).not.toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await page.reload();
    await expect(page.locator('summary', { hasText: '8条件の内訳（すべて達成）' }).locator('..')).toHaveAttribute('open', '');
    // The screen's 注記 holds the footnotes the cards no longer repeat.
    const notes = page.locator('.brief-screen-notes');
    await notes.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(notes.getByText(/^EPS は報告値（希薄化）/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the market tabs move with the arrow keys, Home and End, and the section is kept for the session', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    const first = tabs(page).first();
    await first.focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs(page).nth(1)).toBeFocused();
    await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { level: 3, name: '市場の参加度' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: '指数のトレンド' })).toBeHidden();
    await page.keyboard.press('End');
    await expect(tabs(page).last()).toBeFocused();
    await expect(page.getByRole('region', { name: '市場環境の推移' })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tabs(page).last()).toHaveAttribute('aria-selected', 'true');
    // Only the selected tab is in the Tab order; Tab moves on into its section.
    expect(await tabs(page).evaluateAll(nodes => nodes.map(node => node.tabIndex))).toEqual([-1, -1, -1, 0]);
    await page.reload();
    await expect(tabs(page).last()).toHaveAttribute('aria-selected', 'true');
    expect(errors).toEqual([]);
  });

  test('the tabs stay under the bar while a section scrolls, and a focused control is never under them', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    await tabs(page).last().click();
    await expect(page.locator('.market-history-explorer').getByRole('img')).toBeVisible();
    await page.evaluate(() => scrollTo(0, 900));
    const bar = await page.locator('.brief-bar').boundingBox(), strip = await page.locator('.brief-switchbar').boundingBox();
    expect(Math.abs(strip.y - (bar.y + bar.height))).toBeLessThanOrEqual(1);
    // Switching while stuck brings the new section's top right under the tabs (as far as the page can scroll).
    await tabs(page).first().click();
    const heading = await page.getByRole('heading', { level: 3, name: '指数のトレンド' }).boundingBox(), after = await page.locator('.brief-switchbar').boundingBox();
    expect(heading.y).toBeGreaterThanOrEqual(after.y + after.height - 1);
    expect(heading.y).toBeLessThanOrEqual(after.y + after.height + 40);
    // Keyboard focus through the long-history section: each control clears the bar, the stuck tabs and the dock.
    await tabs(page).last().click();
    await page.evaluate(() => scrollTo(0, 700));
    await tabs(page).last().focus();
    const seen = [];
    for (let press = 0; press < 30; press++) {
      await page.keyboard.press('Tab');
      const step = await page.evaluate(() => {
        const active = document.activeElement;
        if (!document.getElementById('brief-main').contains(active)) return null;
        const box = active.getBoundingClientRect(), strip = document.querySelector('.brief-switchbar').getBoundingClientRect(), dock = document.querySelector('.brief-dock').getBoundingClientRect();
        return { label: (active.getAttribute('aria-label') || active.textContent).trim().slice(0, 30), top: box.top, bottom: box.bottom, stripBottom: strip.bottom, dockTop: dock.top };
      });
      if (!step) break;
      seen.push(step);
    }
    expect(seen.length).toBeGreaterThanOrEqual(5);
    for (const step of seen) {
      expect(step.top, step.label).toBeGreaterThanOrEqual(step.stripBottom - 1);
      expect(step.bottom, step.label).toBeLessThanOrEqual(step.dockTop + 1);
    }
    expect(errors).toEqual([]);
  });

  test('Today folds the watch rows beyond the first three, never one with a sell signal', async ({ page }) => {
    const watch = ['ZZNV', 'ZZKS', 'ZZZF', 'ZZOD', 'ZZSD'];
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': watch } });
    const card = page.getByRole('region', { name: 'ウォッチの変化' });
    await expect(card.getByRole('button', { name: /ZZSD/ })).toContainText('売りのサイン');
    await expect(card.locator('.brief-event')).toHaveCount(4);
    const more = card.getByRole('button', { name: 'さらに表示（残り 1件）' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(card.locator('.brief-event')).toHaveCount(5);
    await expect(card.getByRole('button', { name: '表示を減らす' })).toBeFocused();
    expect(errors).toEqual([]);
  });
});

test.describe('text floor and targets of the compact controls', () => {
  test.use(phone(375));
  test('summaries, tabs, notes and folded figures read at 12px or more and are 44px targets', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    await expect(tabs(page)).toHaveCount(4);
    const check = async () => {
      const small = await page.locator('.brief-expander summary, .brief-switch button, .brief-switch-flag, .brief-screen-notes li, .brief-dl dt, .brief-dl small, .brief-focusfoot .brief-note, .brief-groups > *')
        .evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).filter(node => parseFloat(getComputedStyle(node).fontSize) < 12).map(node => node.textContent.slice(0, 30)));
      expect(small).toEqual([]);
      const short = await page.locator('.brief-expander > summary, .brief-switch button, .brief-morebutton, .brief-nearlink')
        .evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).filter(node => node.getBoundingClientRect().height < 44).map(node => node.textContent.slice(0, 30)));
      expect(short).toEqual([]);
    };
    await check();
    for (const hash of ['#/brief', `#/brief/stock/${SEC_SYMBOL}`]) {
      await page.goto(`/${hash}`);
      await expect(page.locator('.brief-screen-notes')).toBeVisible();
      for (const summary of await page.locator('.brief-expander > summary').all()) await summary.click();
      await check();
    }
    expect(errors).toEqual([]);
  });
});

for (const width of [320, 375, 414]) test.describe(`no overflow at ${width}px`, () => {
  test.use(phone(width, 760));
  test('every screen, every market section and every opened fold stays within the width', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': WATCH } });
    for (const [name, [hash, ready]] of Object.entries(SCREENS)) {
      await page.goto(`/${hash}`);
      await ready(page);
      expect(await horizontalOverflow(page), name).toBe(0);
      for (const summary of await page.locator('.brief-expander > summary').all()) if (await summary.isVisible()) await summary.click();
      expect(await horizontalOverflow(page), `${name} opened`).toBe(0);
      if (name === 'market') for (const tab of await tabs(page).all()) {
        await tab.click();
        for (const summary of await page.locator('.brief-expander > summary').all()) if (await summary.isVisible()) await summary.click();
        expect(await horizontalOverflow(page), `market ${await tab.textContent()}`).toBe(0);
      }
    }
    expect(errors).toEqual([]);
  });
});
