// Daily brief on phones, compacted: each screen's height at 375×812 stays within its budget, every
// expander and the market tab's section tabs work by keyboard and keep their state for the session,
// the section tabs stay under the bar while the page scrolls without covering a focused control,
// the new controls keep the 12px text floor and 44px targets, every visible text on a phone reads at 12px or
// more (SVG at its rendered size) and at a size of the type scale (Design Acceptance's check, on phones and the
// desktop), and nothing overflows at 320/375/414 px.
import { test, expect } from '@playwright/test';
import { openBrief, horizontalOverflow, SEC_SYMBOL } from './brief-fixture.js';
import { FONT_SIZES } from '../../tools/brief-design-contract.mjs';

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
// 1286, 635, 472, 1192 and 3112 with the review fixes); the budgets keep about a tenth of headroom over the compacted layout
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
    await expect(tabs(page)).toHaveText(['指数', '参加度?未確認あり', 'リーダー?未確認あり', '推移']);
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
    // The details' toggle event (and so the session write) lands a task after the key press: reload only
    // once the open state is stored, or the reload can race it.
    await expect(fold).toHaveAttribute('open', '');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('brief-open:stock-tt-met'))).toBe('true');
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
    // The 地合い card's entrance (brief-rise) can still be moving the stuck tabs when the chart is up.
    await settled(page);
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
});

test.describe('text floor and targets of the compact controls', () => {
  test.use(phone(375));
  test('summaries, tabs, notes and folded figures read at 12px or more and are 44px targets', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    await expect(tabs(page)).toHaveCount(4);
    const check = async () => {
      // Measure once every finite entrance animation has finished: a strip still scaling in reads 43.9999px.
      await page.evaluate(() => Promise.all(document.getAnimations()
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => null))));
      const small = await page.locator('.brief-expander summary, .brief-switch button, .brief-switch-flag, .brief-screen-notes li, .brief-dl dt, .brief-dl small, .brief-focusfoot .brief-note, .brief-groups-label, .brief-groups .brief-chip')
        .evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).filter(node => parseFloat(getComputedStyle(node).fontSize) < 12).map(node => node.textContent.slice(0, 30)));
      expect(small).toEqual([]);
      const short = await page.locator('.brief-expander > summary, .brief-switch button, .brief-morebutton, .brief-nearlink')
        .evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).filter(node => node.getBoundingClientRect().height < 44).map(node => `${node.textContent.slice(0, 30)} ${node.getBoundingClientRect().height}`));
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

// The round-1 text floor on phones: every visible text in the main area, the bar and the dock reads at 12px
// or more, SVG text at its rendered size (font size × the SVG's scale), on every screen, every market section,
// every opened fold and the stock's weekly chart, at 320, 375 and 390 px.
const smallText = page => page.evaluate(() => {
  const clipped = element => {
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) return true;
      // .sr-only: read by screen readers, not on screen.
      if (style.position === 'absolute' && style.overflow === 'hidden' && parseFloat(style.width) <= 1 && parseFloat(style.height) <= 1) return true;
    }
    return false;
  };
  const found = [];
  for (const root of document.querySelectorAll('#brief-main, .brief-bar, .brief-dock')) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.trim(), element = node.parentElement;
      if (!text || !element) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      if (![...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0) || clipped(element)) continue;
      let size = parseFloat(getComputedStyle(element).fontSize);
      if (element instanceof SVGGraphicsElement) { const matrix = element.getScreenCTM(); if (matrix) size *= Math.hypot(matrix.a, matrix.b); }
      if (size < 11.95) found.push(`${element.closest('[class]')?.className?.baseVal ?? element.closest('[class]')?.className ?? element.tagName} ${size.toFixed(1)}px “${text.slice(0, 24)}”`);
    }
  }
  return [...new Set(found)];
});

// Design Acceptance's type-scale check (design-review.mjs briefMetrics fontIssues): every shown element under
// .brief with text of its own has a computed font size of the scale (tokens.fontSizes). SVG text counts at its
// CSS size, as there.
const offScale = page => page.evaluate(sizes => {
  const shown = element => {
    const box = element.getBoundingClientRect();
    return box.width > 1 && box.height > 1 && box.right > 0 && box.bottom + scrollY > 0 && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const own = element => [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
  const root = document.querySelector('.brief');
  return [...new Set([root, ...root.querySelectorAll('*')].filter(element => own(element) && shown(element)).flatMap(element => {
    const size = parseFloat(getComputedStyle(element).fontSize);
    return sizes.some(value => Math.abs(value - size) < 0.1) ? [] : [`${element.closest('[class]')?.className?.baseVal ?? element.closest('[class]')?.className ?? element.tagName} ${size}px “${own(element).slice(0, 24)}”`];
  }))];
}, FONT_SIZES);

for (const width of [320, 375, 390]) test.describe(`text floor at ${width}px`, () => {
  test.use({ ...phone(width, width === 390 ? 844 : 812), contextOptions: { reducedMotion: 'reduce' } });
  test('every visible text in the main area, the bar and the dock is 12px or more (SVG scaled)', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': WATCH } });
    const openFolds = async () => { for (const summary of await page.locator('#brief-main .brief-expander > summary').all()) if (await summary.isVisible() && !await summary.evaluate(node => node.parentElement.open)) await summary.click(); };
    for (const [name, [hash, ready]] of Object.entries(SCREENS)) {
      await page.goto(`/${hash}`);
      await ready(page);
      const check = async label => {
        expect(await smallText(page), label).toEqual([]);
        expect(await offScale(page), `${label}: type scale`).toEqual([]);
      };
      await check(name);
      await openFolds();
      await check(`${name} opened`);
      if (name === 'market') for (const tab of await tabs(page).all()) {
        await tab.click();
        await openFolds();
        await check(`market ${await tab.textContent()}`);
      }
      if (name === 'stock') {
        await page.locator('.brief-periods button', { hasText: /^週足/ }).click();
        await expect(page.locator('.brief-legend', { hasText: '10週線' }).first()).toBeAttached();
        await check('stock weekly');
      }
    }
    expect(errors).toEqual([]);
  });

  test('a stock without a chart: its VCP card says 未確認 at a size of the type scale', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/stock/ZZMO', { mutate: { rows: served => { served.find(row => row.symbol === 'ZZMO').chart_path = null; } } });
    await expect(page.getByText('この銘柄の日足チャートは未配信です。')).toBeVisible();
    await expect(page.locator('.brief-footprint')).toHaveText('VCP 未確認');
    expect(await smallText(page)).toEqual([]);
    expect(await offScale(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// Design Acceptance's type-scale check on the desktop too: every screen, the stock's weekly chart and every opened fold.
test.describe('the type scale at 1440px', () => {
  test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });
  test('every shown text in the brief has a font size of the type scale', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': WATCH } });
    for (const [name, [hash, ready]] of Object.entries(SCREENS)) {
      await page.goto(`/${hash}`);
      await ready(page);
      expect(await offScale(page), name).toEqual([]);
      for (const summary of await page.locator('.brief-expander > summary').all()) if (await summary.isVisible() && !await summary.evaluate(node => node.parentElement.open)) await summary.click();
      expect(await offScale(page), `${name} opened`).toEqual([]);
      if (name === 'stock') {
        await page.locator('.brief-periods button', { hasText: /^週足/ }).click();
        await expect(page.locator('.brief-legend', { hasText: '10週線' }).first()).toBeAttached();
        expect(await offScale(page), 'stock weekly').toEqual([]);
      }
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

// The desktop has the height: every footnote stays in place and open, as before the phone compaction.
test.describe('the desktop keeps every footnote in place', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('no 注記 fold on Today, 候補, 市場 or the stock pane; each note is visible on its card', async ({ page }) => {
    const { errors } = await openBrief(page, `#/brief/stock/${SEC_SYMBOL}`);
    await expect(page.getByTestId('brief-fundamentals').getByText(/^出典：SEC XBRL/)).toBeVisible();
    await expect(page.getByRole('region', { name: '注目候補' }).getByText(/^注目候補はすべてトレンドテンプレート8条件を満たす銘柄（TT 8\/8）です。/)).toBeVisible();
    await expect(page.getByTestId('brief-fundamentals').getByText(/^EPS は報告値（希薄化）/)).toBeVisible();
    await expect(page.getByTestId('brief-sell').getByText(/^保有中の判断材料です。複合警告は/)).toBeVisible();
    await expect(page.locator('.brief-screen-notes')).toHaveCount(0);
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '候補' }).click();
    await expect(page.getByRole('region', { name: '選定銘柄の一覧' }).getByText(/^選定銘柄＝トレンドテンプレート8条件/)).toBeVisible();
    await expect(page.locator('.brief-screen-notes')).toHaveCount(0);
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '市場' }).click();
    await expect(page.getByText('4つの数値（終値・1年高値から・50日線比・200日線比）は長期履歴の^GSPC終値から計算しています。')).toBeVisible();
    await expect(page.locator('.brief-screen-notes')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

// The list's phone paging and the omitted TT 8/8 chip follow the 520px phone layout, not the 1024px desktop.
test.describe('a tablet between the phone and the desktop', () => {
  test.use({ viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  test('keeps the TT 8/8 chip and 50-row pages, and its 注記 says nothing about phones', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/list');
    const rows = page.getByTestId('brief-candidate');
    await page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^選定すべて/ }).click();
    await expect(rows).toHaveCount(21);
    await expect(page.getByRole('button', { name: /^さらに表示/ })).toHaveCount(0);
    for (const row of await rows.all()) await expect(row).toContainText('TT 8/8');
    await expect(page.locator('.brief-screen-notes')).toHaveCount(1);
    await expect(page.locator('.brief-screen-notes')).not.toContainText('スマホ');
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// Today's leading groups on a phone: the denominator (and any 未確認 count) is never behind the sideways
// scroll, and the first chip is whole, clear of the fading edge.
for (const width of [320, 375, 414]) test.describe(`leading groups at ${width}px`, () => {
  test.use(phone(width, 760));
  test('the label and its denominator are on screen and the first chip is whole', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief');
    const strip = page.getByTestId('brief-groups');
    await expect(strip.locator('.brief-chip').first()).toBeVisible();
    await expect(strip.locator('.brief-groups-label')).toHaveText(/^選定銘柄の多い.+（選定 \d+銘柄中.*）$/);
    const box = await strip.evaluate(node => {
      const card = node.closest('.brief-card').getBoundingClientRect(), label = node.querySelector('.brief-groups-label').getBoundingClientRect();
      const chips = node.querySelector('.brief-groups-chips'), scroller = chips.getBoundingClientRect(), first = chips.querySelector('.brief-chip').getBoundingClientRect();
      return { cardLeft: card.left, cardRight: card.right, labelLeft: label.left, labelRight: label.right, fade: scroller.right - 40, firstLeft: first.left, firstRight: first.right };
    });
    expect(box.labelLeft).toBeGreaterThanOrEqual(box.cardLeft);
    expect(box.labelRight).toBeLessThanOrEqual(box.cardRight);
    expect(box.firstLeft).toBeGreaterThanOrEqual(box.cardLeft);
    expect(box.firstRight).toBeLessThanOrEqual(box.fade);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// A phone held sideways (844×390): the section tabs scroll with the page instead of sticking under the bar.
test.describe('the market tabs on a short landscape phone', () => {
  test.use({ ...phone(844, 390) });
  test('scroll away with the page, and a focused control is clear of the bar and the dock', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    await tabs(page).last().click();
    await expect(page.locator('.market-history-explorer').getByRole('img')).toBeVisible();
    await settled(page);
    await page.evaluate(() => scrollTo(0, 900));
    const bar = await page.locator('.brief-bar').boundingBox(), strip = await page.locator('.brief-switchbar').boundingBox();
    expect(strip.y + strip.height).toBeLessThanOrEqual(bar.y + bar.height);
    await page.evaluate(() => scrollTo(0, 0));
    await tabs(page).last().focus();
    const seen = [];
    for (let press = 0; press < 20; press++) {
      await page.keyboard.press('Tab');
      const step = await page.evaluate(() => {
        const active = document.activeElement;
        if (!document.getElementById('brief-main').contains(active)) return null;
        const box = active.getBoundingClientRect(), bar = document.querySelector('.brief-bar').getBoundingClientRect(), dock = document.querySelector('.brief-dock').getBoundingClientRect();
        return { label: (active.getAttribute('aria-label') || active.textContent).trim().slice(0, 30), top: box.top, bottom: box.bottom, barBottom: bar.bottom, dockTop: dock.top };
      });
      if (!step) break;
      seen.push(step);
    }
    expect(seen.length).toBeGreaterThanOrEqual(5);
    for (const step of seen) {
      expect(step.top, step.label).toBeGreaterThanOrEqual(step.barBottom - 1);
      expect(step.bottom, step.label).toBeLessThanOrEqual(step.dockTop + 1);
    }
    expect(errors).toEqual([]);
  });
});

// At 320px a tab's ▲ count sits under its label, so no label runs into its neighbour's (「参加度▲1リーダー」).
test.describe('market tab labels at 320px', () => {
  test.use(phone(320, 640));
  test('each label and its marks fit inside the tab, with clear space between neighbours', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    await expect(tabs(page)).toHaveText(['指数', '参加度?未確認あり', 'リーダー?未確認あり', '推移']);
    const boxes = await tabs(page).evaluateAll(nodes => nodes.map(node => {
      const tab = node.getBoundingClientRect(), parts = [...node.querySelectorAll('.brief-switch-label, .brief-switch-marks > *')].map(part => part.getBoundingClientRect());
      return { label: node.textContent, tab: [tab.left, tab.right], text: [Math.min(...parts.map(part => part.left)), Math.max(...parts.map(part => part.right))], overflow: node.scrollWidth - node.clientWidth };
    }));
    for (const box of boxes) {
      expect(box.overflow, box.label).toBeLessThanOrEqual(0);
      expect(box.text[0], box.label).toBeGreaterThanOrEqual(box.tab[0] + 2);
      expect(box.text[1], box.label).toBeLessThanOrEqual(box.tab[1] - 2);
    }
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].text[0] - boxes[i - 1].text[1], `${boxes[i - 1].label} | ${boxes[i].label}`).toBeGreaterThanOrEqual(12);
    expect(errors).toEqual([]);
  });
});
