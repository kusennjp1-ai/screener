// The exchange calendar's holiday and short session on the bar (latency plan F9), on synthetic data: the fixture's
// refresh_schedule edited by a spec-local mutator (the fixture is frozen). HOLIDAY: Monday 10/5 has no session and
// Tuesday 10/6 closes at 13:00 New York (17:00Z); SHORT: 10/5 closes at 13:00. At the fixture's clock (10/3 16:35Z) the
// 10/2 analysis is current, so the bar's 「米国株」 becomes 「10/5休場」 / 「10/5短縮取引」 in the line's own tone, its detail
// where it fits. The line is the bar's one line: every screen is as tall as without the closure, nothing overflows, and
// a late or pending age keeps its own line.
import { test, expect } from '@playwright/test';
import { openBrief, horizontalOverflow, VIEWPORTS } from './brief-fixture.js';

const phone = (width, height = 812) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const HOLIDAY = { trends: value => {
  const schedule = value.refresh_schedule;
  schedule.sessions = schedule.sessions.filter(row => row.date !== '2026-10-05');
  schedule.sessions.find(row => row.date === '2026-10-06').close_at = '2026-10-06T17:00:00Z';
} };
const SHORT = { trends: value => { value.refresh_schedule.sessions.find(row => row.date === '2026-10-05').close_at = '2026-10-05T17:00:00Z'; } };
const SCREENS = [['今日', '#/brief'], ['候補', '#/brief/list'], ['ウォッチ', '#/brief/watch'], ['市場', '#/brief/market']];
const WATCH = { 'research-watch': ['ZZNV', 'ZZSD'] };
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => null))));

/** Open a screen (optionally on a later clock, as a device opened later) and wait for the bar and the screen. */
async function open(page, hash, { mutate, at } = {}) {
  const result = await openBrief(page, hash, { storage: WATCH, mutate });
  if (at) { await page.clock.setFixedTime(new Date(at)); await page.reload(); }
  await expect(page.locator('#brief-main')).toBeVisible();
  await expect(page.locator('.brief-bar-date')).toBeVisible();
  // The market screen is its own chunk: wait for its body, not its loading line.
  if (hash === '#/brief/market') await expect(page.locator('#brief-main .brief-switch, #brief-main .brief-history').first()).toBeVisible();
  return result;
}
// The bar's date line: its text, whether the age is cut, the room right of the age's text, whether the detail is on
// its one line, and its tone.
const barLine = page => page.locator('.brief-bar-date').evaluate(node => {
  const age = node.querySelector('.brief-bar-age'), detail = node.querySelector('.brief-bar-missing'), box = node.getBoundingClientRect();
  const range = document.createRange(); range.selectNodeContents(age);
  return { text: node.textContent, age: age.textContent, className: node.className, cut: age.scrollWidth > age.clientWidth + 0.5, slack: box.right - range.getBoundingClientRect().right,
    detailShown: detail ? detail.getBoundingClientRect().top < box.bottom - 0.5 : null, color: getComputedStyle(node).color, weight: getComputedStyle(node).fontWeight, height: box.height, font: parseFloat(getComputedStyle(node).fontSize) };
});
const chrome = page => page.evaluate(() => Math.round(document.querySelector('.brief-bar').getBoundingClientRect().height + (document.querySelector('.brief-dock')?.getBoundingClientRect().height ?? 0)));
const heights = async page => { await settled(page); return page.evaluate(() => ({ page: document.documentElement.scrollHeight, main: Math.round(document.querySelector('#brief-main').getBoundingClientRect().height * 100) / 100 })); };

for (const width of [320, 375, 390]) test.describe(`the holiday line at ${width}px`, () => {
  test.use(phone(width));
  for (const [name, hash] of SCREENS) test(`the ${name} bar says the holiday on its one line, in its own tone, and the screen is as tall as without it`, async ({ page }) => {
    const plain = await page.context().newPage();
    await open(plain, hash);
    const before = { line: await barLine(plain), size: await heights(plain) };
    await plain.close();
    const { errors } = await open(page, hash, { mutate: HOLIDAY });
    const line = await barLine(page);
    expect(line.text).toBe('分析基準日 10/2（金）引け・10/5休場（10/6 短縮取引・引け 日本時間 10/7 02:00）');
    expect(line.age).toBe('分析基準日 10/2（金）引け・10/5休場');
    expect(before.line.age).toBe('分析基準日 10/2（金）引け・米国株');
    // Not cut, with room for the two-digit months of real dates (11/25（水）引け・11/26休場 is 14.4px wider at 12px).
    expect(line.cut).toBe(false);
    expect(line.slack).toBeGreaterThanOrEqual(15);
    // The detail does not fit a phone's line: it stays in the text, out of view, never wrapping the bar.
    expect(line.detailShown).toBe(false);
    // The line's own tone and size: not the late warning.
    expect([line.className, line.color, line.weight, line.font, line.height]).toEqual([before.line.className, before.line.color, before.line.weight, before.line.font, before.line.height]);
    expect(line.font).toBeGreaterThanOrEqual(12);
    expect((await page.locator('.brief-bar').boundingBox()).height).toBeLessThanOrEqual(48);
    expect(await chrome(page)).toBeLessThanOrEqual(110);
    expect(await heights(page)).toEqual(before.size);
    await expect(page.locator('.brief-bar')).not.toContainText('最新');
    // Nothing in the screen's rendered text says it (市場's update status holds the sentence in its closed disclosure).
    expect(await page.locator('#brief-main').evaluate(node => node.innerText)).not.toMatch(/休場|短縮取引/);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

for (const width of [320, 390]) test.describe(`the short session at ${width}px`, () => {
  test.use(phone(width));
  test('the 候補 bar names the next session as short, and the screen is as tall as without it', async ({ page }) => {
    const plain = await page.context().newPage();
    await open(plain, '#/brief/list');
    const before = await heights(plain);
    await plain.close();
    const { errors } = await open(page, '#/brief/list', { mutate: SHORT });
    const line = await barLine(page);
    expect(line.text).toBe('分析基準日 10/2（金）引け・10/5短縮取引（引け 日本時間 10/6 02:00）');
    // At 320px the line has almost no room left (3px with the fixture's one-digit dates; a two-digit month, 12/23（水）引け・
    // 12/24短縮取引, is cut by the line's ellipsis: the SV-A record), so only the wider phone pins the fit.
    if (width >= 360) { expect(line.cut).toBe(false); expect(line.slack).toBeGreaterThanOrEqual(15); }
    expect(line.detailShown).toBe(false);
    expect(await heights(page)).toEqual(before);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('the holiday line at 1440px', () => {
  test.use(VIEWPORTS.desktop);
  for (const [name, hash] of [['今日', '#/brief'], ['候補', '#/brief/list'], ['銘柄', '#/brief/stock/ZZNV']]) test(`the ${name} bar shows the next session's short close beside the holiday`, async ({ page }) => {
    const plain = await page.context().newPage();
    await open(plain, hash);
    const before = await heights(plain);
    await plain.close();
    const { errors } = await open(page, hash, { mutate: HOLIDAY });
    const line = await barLine(page);
    expect(line.text).toBe('分析基準日 10/2（金）引け・10/5休場（10/6 短縮取引・引け 日本時間 10/7 02:00）');
    expect([line.cut, line.detailShown]).toEqual([false, true]);
    expect(await heights(page)).toEqual(before);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('the holiday line gives way', () => {
  test.use(VIEWPORTS.phone);
  test('to a pending age (the bar unchanged) and a late one (n営業日前), and the phone stock bar names the stock', async ({ page }) => {
    // 10/6 18:00Z: the short session closed an hour ago, within the grace: the bar is the ordinary one.
    await open(page, '#/brief/list', { mutate: HOLIDAY, at: '2026-10-06T18:00:00Z' });
    await expect(page.locator('.brief-bar-date')).toHaveText('分析基準日 10/2（金）引け・米国株');
    // 10/7 22:00Z: 10/6 and 10/7 have closed, 10/6's grace is over (the calendar is valid to 10/7 23:00Z): the late age,
    // never the holiday.
    await page.clock.setFixedTime(new Date('2026-10-07T22:00:00Z'));
    await page.reload();
    await expect(page.locator('.brief-bar-date')).toContainText('分析基準日 10/2（金）引け・2営業日前');
    await expect(page.locator('.brief-bar')).not.toContainText('休場');
    // The phone's stock bar names the stock (its date line is the other screens'), at the fixture's clock.
    await page.clock.setFixedTime(new Date('2026-10-03T16:35:00Z'));
    await page.goto('/#/brief/stock/ZZNV');
    await expect(page.locator('.brief-bar-title')).toContainText('ZZNV');
    await expect(page.locator('.brief-bar')).not.toContainText(/休場|短縮/);
  });

  test('the 市場 update status says it first in its explanation, inside the closed disclosure', async ({ page }) => {
    const { errors } = await open(page, '#/brief/market', { mutate: HOLIDAY });
    const tab = page.getByRole('tablist', { name: '市場タブの表示' }).getByRole('tab', { name: /^推移/ });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const status = page.getByRole('region', { name: '市場環境の推移' }).locator('.market-update-status');
    await expect(status.locator('summary')).toHaveText(/10\/02 · 長期履歴反映/);
    const sentence = '10/5（月）は米国市場の休場日です（取引所カレンダー）。次の取引日 10/6（火）は短縮取引で、引けは日本時間 10/7 02:00 の予定です。';
    await expect(status.locator('p')).toBeHidden();
    await status.locator('summary').click();
    await expect(status.locator('p')).toHaveText(new RegExp(`^${sentence.replace(/[()（）.]/g, '\\$&')}終値と取得日時は別です。`));
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
