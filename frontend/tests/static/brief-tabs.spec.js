// The phone's 候補 header (plan SV-P1, R5-4, R5-6, R5-11): the count tabs as one strip that scrolls inside itself (never the
// page), the edge with more tabs fading over 10px with no whole tab's text under the fade, the pressed tab revealed by the
// strip's own scroll, the selected tab's definition under the strip, the gate sentence (marketBand's own line) above it on a 0%,
// unknown or waiting day, the counts' 「未確認 n」, and the screen's height at 375×812 in each gate state (≤ 700, this slice's
// own line under the owner's 708). The states are opened with the gate spec's own mutators and clocks (brief-gate.spec.js).
import { test, expect } from '@playwright/test';
import { axeViolations, openBrief, horizontalOverflow, VIEWPORTS } from './brief-fixture.js';

const phone = (width, height = 812) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const PHONES = { 320: phone(320, 640), 375: phone(375), 390: VIEWPORTS.phone };
const LABELS = ['選定すべて', '10/2の上抜け', '買いゾーン', 'ピボット直下', 'ピボット接近', 'あと1条件'];
const FADE = 10;
// brief-gate.spec.js (from brief-market-r3.spec.js:295) and its own 市場未確認 state; its pending and late clocks.
const below50Rows = { rows: rows => { for (const row of rows) { row.market_above_50dma = false; row.market_regime = 'correction'; } } };
const partUnknown = { rows: rows => { for (const row of rows) row.market_above_50dma = null; } };
const PENDING = '2026-10-05T20:10:00Z', LATE = '2026-10-07T09:00:00Z';
// The sentence of each state: marketBand's line1Labelled (line1 when unknown), as S1's band and the stock call print it.
const SENTENCES = {
  closed: '地合い 買いは控える（独自判定）・目安 0%（独自設定）',
  unknown: '地合い 未確認・買いは見送り',
  waiting: '地合い 10/2時点の判定・更新待ち（独自判定）',
};
const STATES = {
  open: { open: {}, gate: null },
  closed: { open: { mutate: below50Rows }, gate: 'closed' },
  unknown: { open: { mutate: partUnknown }, gate: 'unknown' },
  pending: { open: {}, at: PENDING, gate: 'waiting' },
  late: { open: {}, at: LATE, gate: 'waiting' },
};

const strip = page => page.getByRole('group', { name: '絞り込み' });
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null))));
const contentHeight = page => page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY));
async function open(page, state, hash = '#/brief/list') {
  const s = STATES[state];
  const result = await openBrief(page, hash, s.open);
  if (s.at) { await page.clock.setFixedTime(new Date(s.at)); await page.reload(); }
  await expect(page.getByTestId('brief-candidate').first()).toBeVisible();
  await settled(page);
  return result;
}
/** The strip's scroll state, its fade attributes and computed mask, and each tab's text box against the strip's edges. */
const readStrip = page => strip(page).evaluate(node => {
  const frame = node.getBoundingClientRect(), mask = getComputedStyle(node).maskImage || getComputedStyle(node).webkitMaskImage;
  const tabs = [...node.querySelectorAll('button')].map(button => {
    const box = button.getBoundingClientRect(), range = document.createRange();
    range.selectNodeContents(button);
    const text = [...range.getClientRects()].filter(rect => rect.width > 0);
    return { label: button.querySelector('.brief-tab-label').textContent, left: box.left - frame.left, right: frame.right - box.right, height: box.height,
      textLeft: Math.min(...text.map(rect => rect.left)) - frame.left, textRight: frame.right - Math.max(...text.map(rect => rect.right)), pressed: button.getAttribute('aria-pressed') };
  });
  return { rest: node.scrollWidth - node.clientWidth - node.scrollLeft, scrollLeft: node.scrollLeft, overflow: node.scrollWidth - node.clientWidth,
    start: node.hasAttribute('data-more-start'), end: node.hasAttribute('data-more-end'), mask, tabs };
});
/** A tab wholly inside the strip (to a sub-pixel) keeps its text out of a faded edge. */
const fadeFree = read => read.tabs.filter(tab => tab.left >= -1 && tab.right >= -1)
  .filter(tab => (read.end && tab.textRight < FADE) || (read.start && tab.textLeft < FADE)).map(tab => tab.label);

for (const [width, device] of Object.entries(PHONES)) test.describe(`the count strip at ${width}px`, () => {
  test.use(device);
  test('six tabs scroll inside the strip, the edge with more tabs fades, and no whole tab\'s text is under the fade', async ({ page }) => {
    const { errors } = await open(page, 'open');
    await expect(strip(page).getByRole('button')).toHaveCount(6);
    expect(await strip(page).locator('.brief-tab-label').allTextContents()).toEqual(LABELS);
    let read = await readStrip(page);
    expect(read.overflow).toBeGreaterThan(0);
    // At the start: the end fades (a gradient mask), the start does not; the default tab 買いゾーン is pressed and in view.
    expect([read.scrollLeft, read.start, read.end]).toEqual([0, false, true]);
    expect(read.mask).toMatch(/gradient/);
    expect(fadeFree(read)).toEqual([]);
    const pressed = read.tabs.find(tab => tab.pressed === 'true');
    expect(pressed.label).toBe('買いゾーン');
    expect(pressed.right).toBeGreaterThanOrEqual(0);
    for (const tab of read.tabs) expect(tab.height).toBeGreaterThanOrEqual(44);
    // Scrolled to its end: the start fades, the end does not.
    await strip(page).evaluate(node => { node.scrollLeft = node.scrollWidth; });
    await expect.poll(async () => (await readStrip(page)).end).toBe(false);
    read = await readStrip(page);
    expect([read.rest <= 1, read.start, read.end]).toEqual([true, true, false]);
    expect(read.mask).toMatch(/gradient/);
    expect(fadeFree(read)).toEqual([]);
    // Pressing a tab scrolls the strip, never the page sideways; the pressed tab is revealed wholly inside the strip.
    await strip(page).evaluate(node => { node.scrollLeft = 0; });
    await strip(page).getByRole('button', { name: /^あと1条件/ }).click();
    await expect(strip(page).getByRole('button', { name: /^あと1条件/ })).toHaveAttribute('aria-pressed', 'true');
    read = await readStrip(page);
    const one = read.tabs.find(tab => tab.label === 'あと1条件');
    // Wholly inside the strip (to the sub-pixel of a scroll at its end).
    expect(one.left).toBeGreaterThanOrEqual(-1);
    expect(one.right).toBeGreaterThanOrEqual(-1);
    expect(fadeFree(read)).toEqual([]);
    expect(await page.evaluate(() => scrollX)).toBe(0);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('each tab\'s definition sits under the strip; the day\'s breakouts always carry 「未確認 n」', async ({ page }) => {
    const { errors } = await open(page, 'open');
    const definition = page.locator('.brief-filters > .brief-countstrip + .brief-tabdef');
    await expect(definition).toHaveText('ピボット〜その＋5%（独自設定）の選定銘柄。');
    await expect(strip(page).getByRole('button', { name: /^10\/2の上抜け/ })).toHaveText(/^10\/2の上抜け\d+ 未確認 \d+$/);
    await strip(page).getByRole('button', { name: /^10\/2の上抜け/ }).click();
    await expect(definition).toHaveText('前日の終値がピボットの下で、10/2の終値がピボットを上回った選定銘柄（上昇日・出来高1.4×以上・独自設定）。');
    // The definition and the 未確認 are 12px, the counts 20px; nothing in the header under 12px.
    expect(await definition.evaluate(node => getComputedStyle(node).fontSize)).toBe('12px');
    expect(await strip(page).locator('.numeric').first().evaluate(node => getComputedStyle(node).fontSize)).toBe('20px');
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  for (const state of ['closed', 'unknown', 'pending']) test(`${state}: the gate sentence is marketBand's line above the strip, at 14px, the definition kept`, async ({ page }) => {
    const { errors } = await open(page, state);
    const gate = page.getByTestId('brief-list-gate');
    const words = SENTENCES[STATES[state].gate];
    await expect(gate).toHaveText(`${words} 市場 ›`);
    await expect(gate).toHaveAttribute('data-band', STATES[state].gate);
    expect(await gate.evaluate(node => [node.tagName, getComputedStyle(node).fontSize, getComputedStyle(node).lineHeight])).toEqual(['P', '14px', '20px']);
    // Above the strip; the tab's definition stays under the strip on every gate day.
    expect(await gate.evaluate(node => node.nextElementSibling.classList.contains('brief-filters'))).toBe(true);
    await expect(page.locator('.brief-countstrip + .brief-tabdef')).toHaveText('ピボット〜その＋5%（独自設定）の選定銘柄。');
    // Its units never break inside: each unit is on one line.
    const units = await gate.locator('.brief-nowrap').evaluateAll(nodes => nodes.map(node => node.getClientRects().length));
    expect(units.every(lines => lines === 1)).toBe(true);
    if (state === 'unknown') await expect(gate).not.toContainText(/%|目安/);
    // WCAG 2.2 AA (axe, target-size included) with the sentence's inline link and the strip, in both themes.
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole('button', { name: /モードに切り替え$/ }).click();
    // The buttons' colour transitions (.2s) end before the colours are read.
    await page.waitForTimeout(50);
    await settled(page);
    expect(await axeViolations(page)).toEqual([]);
    await gate.getByRole('link', { name: '市場の詳細' }).click();
    await expect(page).toHaveURL(/#\/brief\/market$/);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('an open day draws no gate sentence', async ({ page }) => {
    const { errors } = await open(page, 'open');
    await expect(page.getByTestId('brief-list-gate')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('a waiting evening on Today and 候補', () => {
  test.use(PHONES[375]);
  test('候補 prints the 更新待ち sentence of the band Today\'s gate reads on the same clock', async ({ page }) => {
    const { errors } = await open(page, 'pending', '#/brief');
    await expect(page.getByRole('region', { name: '地合い', exact: true })).toContainText('更新待ち');
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '候補' }).click();
    await expect(page.getByTestId('brief-list-gate')).toHaveText(`${SENTENCES.waiting} 市場 ›`);
    expect(errors).toEqual([]);
  });
});

// This slice's own line for 候補 (≤ 700 at 375×812, under the owner's 708 and brief-compact.spec.js's 720), on the default tab as
// the screen opens, in each gate state: the header block's own height is said with it (the bottom of the strip's block, or of
// the definition, from the top of the hero) for the later packages.
test.describe('候補 at 375×812 in each gate state', () => {
  test.use({ ...phone(375), contextOptions: { reducedMotion: 'reduce' } });
  for (const state of Object.keys(STATES)) test(`${state}: the default tab fits 700`, async ({ page }) => {
    const { errors } = await open(page, state);
    await expect(strip(page).getByRole('button', { name: /^買いゾーン/ })).toHaveAttribute('aria-pressed', 'true');
    const height = await contentHeight(page);
    const header = await page.evaluate(() => {
      const top = document.querySelector('#brief-main .brief-hero').getBoundingClientRect().top;
      const box = selector => document.querySelector(selector)?.getBoundingClientRect() ?? null;
      const gate = box('[data-testid="brief-list-gate"]'), filters = box('.brief-filters'), card = box('#brief-main .brief-card');
      return { gate: gate ? Math.round(gate.height) : 0, filters: Math.round(filters.height), toList: Math.round(card.top - top) };
    });
    console.log(`候補 ${state}: ${JSON.stringify({ height, ...header })}`);
    expect(height, `${state} content height`).toBeLessThanOrEqual(700);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
