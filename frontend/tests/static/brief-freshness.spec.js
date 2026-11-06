// A late publication on every screen's bar (RW8), on synthetic data: the page clock two sessions after the analysis
// date (10/5 and 10/6 closed, the first past FRESHNESS_GRACE_HOURS), within the grace, and without an exchange
// calendar. The warning lives in the bar (and Today's notes), never in the body; the chrome stays within 110px and
// nothing overflows at 320.
import { test, expect } from '@playwright/test';
import { openBrief, horizontalOverflow, VIEWPORTS } from './brief-fixture.js';

const phone = (width, height = 812) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
// 10/5 closes at 20:00Z: two sessions later is 10/7 09:00Z (10/5 and 10/6 closed, 10/5's 28-hour grace over);
// 10/6 21:00Z is 25 hours after 10/5's close, within the grace.
const TWO_LATER = '2026-10-07T09:00:00Z';
const WITHIN_GRACE = '2026-10-06T21:00:00Z';
const SCREENS = [['今日', '#/brief'], ['候補', '#/brief/list'], ['ウォッチ', '#/brief/watch'], ['銘柄', '#/brief/stock/ZZNV']];
const NO_SCHEDULE = { trends: value => { delete value.refresh_schedule; } };
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => null))));

/** Open a screen at the fixture's clock, then move the page clock to `at` and reload (as a device opened later). */
async function openAt(page, hash, at, options = {}) {
  const result = await openBrief(page, hash, { storage: { 'research-watch': ['ZZNV', 'ZZSD'] }, ...options });
  if (at) { await page.clock.setFixedTime(new Date(at)); await page.reload(); }
  await expect(page.locator('#brief-main')).toBeVisible();
  return result;
}
// The bar's date line: its text, whether the age is cut, and whether the missing sessions are on its one line. A part
// that does not fit wraps at least 3px below the line's clip, so no ink of it shows under the line (`gap`).
const barLine = page => page.locator('.brief-bar-date').evaluate(node => {
  const age = node.querySelector('.brief-bar-age'), missing = node.querySelector('.brief-bar-missing'), box = node.getBoundingClientRect();
  const shown = missing ? missing.getBoundingClientRect().top < box.bottom - 0.5 : false;
  return { text: node.textContent, warn: node.classList.contains('is-warn'), cut: age.scrollWidth > age.clientWidth + 0.5, missingShown: shown,
    gap: missing && !shown ? missing.getBoundingClientRect().top - box.bottom : null,
    slack: shown ? box.right - missing.getBoundingClientRect().right : null, color: getComputedStyle(node).color, height: box.height, font: parseFloat(getComputedStyle(node).fontSize) };
});
const chrome = page => page.evaluate(() => Math.round(document.querySelector('.brief-bar').getBoundingClientRect().height + (document.querySelector('.brief-dock')?.getBoundingClientRect().height ?? 0)));

for (const [width, device] of [[320, phone(320, 640)], [390, VIEWPORTS.phone]]) test.describe(`two sessions later at ${width}px`, () => {
  test.use(device);
  for (const [name, hash] of SCREENS.filter(([, at]) => !at.includes('stock'))) test(`the ${name} bar says the analysis is 2 sessions old, in the warning tone, and fits`, async ({ page }) => {
    const { errors } = await openAt(page, hash, TWO_LATER);
    const line = page.locator('.brief-bar-date');
    await expect(line).toContainText('分析基準日 10/2（金）引け・2営業日前');
    const box = await barLine(page);
    expect(box.warn).toBe(true);
    expect(box.cut).toBe(false);
    expect(box.font).toBeGreaterThanOrEqual(12);
    // The missing sessions do not fit a phone's bar: they stay in its text, out of view (no ink under the line), never
    // wrapping the bar.
    expect(box.text).toContain('（10/5・10/6 未反映）');
    expect(box.missingShown).toBe(false);
    expect(box.gap).toBeGreaterThanOrEqual(3);
    expect((await page.locator('.brief-bar').boundingBox()).height).toBeLessThanOrEqual(48);
    expect(await chrome(page)).toBeLessThanOrEqual(110);
    await expect(page.locator('.brief-bar')).not.toContainText('最新');
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// The phone's stock bar keeps the company name and puts the age before it, in the warning tone.
for (const [width, device] of [[320, phone(320, 640)], [390, VIEWPORTS.phone]]) test.describe(`the stock bar two sessions later at ${width}px`, () => {
  test.use(device);
  test('names the stock and says the age before the name; the whole sentence is for assistive tech', async ({ page }) => {
    const { errors } = await openAt(page, '#/brief/stock/ZZNV', TWO_LATER);
    const second = page.locator('.brief-bar-title > span');
    await expect(second.locator('.brief-bar-stale')).toHaveText('2営業日前');
    await expect.poll(() => second.evaluate(node => [...node.childNodes].filter(child => !child.classList?.contains('sr-only')).map(child => child.textContent).join(''))).toBe('2営業日前・Novalux Semiconductor (synthetic)・Technology');
    expect(await second.locator('.brief-bar-stale').evaluate(node => getComputedStyle(node).fontWeight)).toBe('700');
    await expect(second.locator('.sr-only')).toHaveText('（分析基準日 10/2（金）引け、10/5・10/6 未反映）');
    expect(await second.evaluate(node => [parseFloat(getComputedStyle(node).fontSize), node.getBoundingClientRect().height < 20])).toEqual([12, true]);
    expect(await chrome(page)).toBeLessThanOrEqual(110);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('two sessions later on Today\'s notes (390px)', () => {
  test.use(VIEWPORTS.phone);
  test('the notes carry the full sentence; the body keeps its height', async ({ page }) => {
    await openAt(page, '#/brief', null);
    await expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate')).toHaveCount(5);
    await settled(page);
    const before = await page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY));
    const { errors } = await openAt(page, '#/brief', TWO_LATER);
    await expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate')).toHaveCount(5);
    await settled(page);
    expect(await page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY))).toBe(before);
    await page.locator('.brief-screen-notes > summary').click();
    // The sentence says when the warning starts, with the grace (独自設定).
    await expect(page.locator('.brief-screen-notes li').first()).toHaveText('この公開は10/2引けの分析です。その後に取引を終えた10/5・10/6（2営業日）の値はまだ反映されていません（公開の遅れ：取引終了から28時間を過ぎても次の公開がないときに表示・独自設定）。');
    expect(errors).toEqual([]);
  });
});

test.describe('two sessions later on the desktop', () => {
  test.use(VIEWPORTS.desktop);
  test('the bar names the missing sessions where they fit, with 6px to spare, and the stock header says it too', async ({ page }) => {
    const { errors } = await openAt(page, '#/brief/stock/ZZNV', TWO_LATER);
    const box = await barLine(page);
    expect(box.text).toBe('分析基準日 10/2（金）引け・2営業日前（10/5・10/6 未反映）');
    expect([box.warn, box.cut, box.missingShown]).toEqual([true, false, true]);
    expect(box.slack).toBeGreaterThanOrEqual(6);
    await expect(page.locator('.brief-stockhead .brief-stockhead-age')).toHaveText('分析基準日 10/2（金）引け・2営業日前（10/5・10/6 未反映）');
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

for (const [width, device] of [[320, phone(320, 640)], [1440, VIEWPORTS.desktop]]) test.describe(`within the grace at ${width}px`, () => {
  test.use(device);
  test('a session closed less than the grace ago changes nothing', async ({ page }) => {
    const { errors } = await openAt(page, '#/brief', WITHIN_GRACE);
    const line = page.locator('.brief-bar-date');
    await expect(line).toHaveText('分析基準日 10/2（金）引け・米国株');
    expect((await barLine(page)).warn).toBe(false);
    await expect(page.locator('.brief-bar-missing')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

for (const [width, device] of [[320, phone(320, 640)], [390, VIEWPORTS.phone]]) test.describe(`no exchange calendar at ${width}px`, () => {
  test.use(device);
  for (const [name, hash] of SCREENS) test(`the ${name} bar says 鮮度未確認, never 最新`, async ({ page }) => {
    const { errors } = await openAt(page, hash, null, { mutate: NO_SCHEDULE });
    if (hash.includes('stock')) {
      // The phone's stock bar names the stock (only a late publication's age goes before the name); the other bars say it.
      await expect(page.locator('.brief-bar-title > span')).toHaveText('Novalux Semiconductor (synthetic)・Technology');
    } else {
      await expect(page.locator('.brief-bar-date')).toContainText('10/2（金）引け・鮮度未確認');
      const box = await barLine(page);
      expect([box.warn, box.cut]).toEqual([false, false]);
    }
    await expect(page.locator('.brief-bar')).not.toContainText('最新');
    expect(await chrome(page)).toBeLessThanOrEqual(110);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
