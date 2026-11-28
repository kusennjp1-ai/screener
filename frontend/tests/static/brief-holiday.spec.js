// The exchange calendar's holiday and short session on the bar (latency plan F9), on synthetic data: the fixture's
// refresh_schedule edited by a spec-local mutator (the fixture is frozen). HOLIDAY: Monday 10/5 has no session and
// Tuesday 10/6 closes at 13:00 New York (17:00Z); SHORT: 10/5 closes at 13:00. At the fixture's clock (10/3 16:35Z) the
// 10/2 analysis is current, so the bar's 「米国株」 becomes 「10/5休場」 / 「10/5短縮取引」 in the line's own tone, its detail
// where it fits. The line is the bar's one line: every screen is as tall as without the closure, nothing overflows, and
// a late or pending age keeps its own line. TWO: 10/5 and 10/6 have no session (「休場10/5〜」). The real calendar's words
// (a two-digit month, across a year, two closed weekdays) are put into the live line at 320px (REAL).
import { test, expect } from '@playwright/test';
import { openBrief, horizontalOverflow, VIEWPORTS } from './brief-fixture.js';
import { closureNote } from '../../src/static/brief/briefFreshness.js';

const phone = (width, height = 812) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const HOLIDAY = { trends: value => {
  const schedule = value.refresh_schedule;
  schedule.sessions = schedule.sessions.filter(row => row.date !== '2026-10-05');
  schedule.sessions.find(row => row.date === '2026-10-06').close_at = '2026-10-06T17:00:00Z';
} };
const SHORT = { trends: value => { value.refresh_schedule.sessions.find(row => row.date === '2026-10-05').close_at = '2026-10-05T17:00:00Z'; } };
const TWO = { trends: value => { const schedule = value.refresh_schedule; schedule.sessions = schedule.sessions.filter(row => !['2026-10-05', '2026-10-06'].includes(row.date)); } };
// Real NYSE calendars around three analysis dates (pandas_market_calendars 5.5.0, the sessions as collect-market-trends.py
// lists them, cut to a few): Thanksgiving 2026 with the short day after it, New Year's Day 2027, and Hurricane Sandy's two
// closed weekdays in 2012 (two-digit days, the widest line), each read by closureNote at a clock the age is current.
const calendar = (rows, validUntil) => ({ data: { refresh_schedule: { provider: 'pandas_market_calendars:NYSE', valid_until: validUntil, sessions: rows.map(([date, close_at]) => ({ date, close_at })) } }, loading: false });
const REAL = [
  { name: 'a two-digit month', date: '2026-11-25', day: '11/25（水）', now: '2026-11-26T12:00:00Z', age: '11/26休場',
    trends: calendar([['2026-11-24', '2026-11-24T21:00:00Z'], ['2026-11-25', '2026-11-25T21:00:00Z'], ['2026-11-27', '2026-11-27T18:00:00Z'], ['2026-11-30', '2026-11-30T21:00:00Z']], '2026-12-01T05:00:00Z') },
  { name: 'across a year', date: '2026-12-31', day: '12/31（木）', now: '2027-01-01T12:00:00Z', age: '1/1休場',
    trends: calendar([['2026-12-30', '2026-12-30T21:00:00Z'], ['2026-12-31', '2026-12-31T21:00:00Z'], ['2027-01-04', '2027-01-04T21:00:00Z'], ['2027-01-05', '2027-01-05T21:00:00Z']], '2027-01-06T05:00:00Z') },
  { name: 'two closed weekdays', date: '2012-10-26', day: '10/26（金）', now: '2012-10-29T12:00:00Z', age: '休場10/29〜',
    trends: calendar([['2012-10-25', '2012-10-25T20:00:00Z'], ['2012-10-26', '2012-10-26T20:00:00Z'], ['2012-10-31', '2012-10-31T20:00:00Z'], ['2012-11-01', '2012-11-01T20:00:00Z']], '2012-11-02T04:00:00Z') },
];
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
    // Uncut with the fixture's one-digit dates (3.2px of room at 320px). A two-digit month is 14.4px wider: at 320px
    // 12/23（水）引け・12/24短縮取引 is cut by the line's ellipsis to 「…12/24短縮…」 (the SV-A record, an owner question).
    expect(line.cut).toBe(false);
    if (width >= 360) expect(line.slack).toBeGreaterThanOrEqual(15);
    expect(line.detailShown).toBe(false);
    expect(await heights(page)).toEqual(before);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

for (const width of [320, 375, 390]) test.describe(`two closed weekdays at ${width}px`, () => {
  test.use(phone(width));
  test('the 候補 bar says 休場 first, from the first closed day, uncut, and the screen is as tall as without it', async ({ page }) => {
    const plain = await page.context().newPage();
    await open(plain, '#/brief/list');
    const before = await heights(plain);
    await plain.close();
    const { errors } = await open(page, '#/brief/list', { mutate: TWO });
    const line = await barLine(page);
    expect(line.text).toBe('分析基準日 10/2（金）引け・休場10/5〜（次の取引日 10/7（水））');
    // 15.2px of room at 320px with the fixture's dates: the real two-digit days are 14.4px wider (the next test).
    expect(line.cut).toBe(false);
    expect(line.slack).toBeGreaterThanOrEqual(15);
    expect(line.detailShown).toBe(false);
    expect(await heights(page)).toEqual(before);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('the holiday line with real dates at 320px', () => {
  test.use(phone(320));
  test('keeps 休場 whole: a two-digit month, across a year, and two closed weekdays, in the live line', async ({ page }) => {
    const { errors } = await open(page, '#/brief/list', { mutate: HOLIDAY });
    await expect(page.locator('.brief-bar-age')).toHaveText('分析基準日 10/2（金）引け・10/5休場');
    for (const real of REAL) {
      const note = closureNote({ trends: real.trends, date: real.date, now: Date.parse(real.now) });
      expect(note?.age, real.name).toBe(real.age);
      // The fixture's analysis date is fixed, so the real date and the product's age and detail replace the line's text;
      // the line's markup, class and font stay the product's.
      await page.locator('.brief-bar-date').evaluate((node, { date, day, age, detail }) => {
        const line = node.querySelector('.brief-bar-age'), time = line.querySelector('time');
        time.textContent = day; time.dateTime = date;
        while (time.nextSibling) time.nextSibling.remove();
        line.append(`引け・${age}`);
        node.querySelector('.brief-bar-missing').textContent = detail;
      }, { date: real.date, day: real.day, age: note.age, detail: note.detail });
      const line = await barLine(page);
      expect(line.age, real.name).toBe(`分析基準日 ${real.day}引け・${real.age}`);
      expect(line.cut, real.name).toBe(false);
      expect(line.slack, real.name).toBeGreaterThanOrEqual(0);
      // The word's own glyphs are inside the age's box (two closed weekdays have 0.8px of room; the word comes first, so a
      // narrower box could only cut the date after it).
      const word = await page.locator('.brief-bar-age').evaluate(age => {
        const text = [...age.childNodes].find(child => child.nodeType === 3 && child.nodeValue.includes('休場')), at = text.nodeValue.indexOf('休場');
        const range = document.createRange(); range.setStart(text, at); range.setEnd(text, at + 2);
        return { right: range.getBoundingClientRect().right, box: age.getBoundingClientRect().right };
      });
      expect(word.right, real.name).toBeLessThanOrEqual(word.box + 0.5);
      expect(line.detailShown, real.name).toBe(false);
    }
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
