// Round 3 (market track), package P2 on synthetic data: Today's 「FTD確認済み」 only with the same day's ^GSPC record (M1a),
// the exposure guide's disclosure (M1b, M1d), the marked labels (M1c), the market tab's lead while a newer session has
// closed (M1e) and distribution days in two grades (M3). Every state is built here with marketTrends' mutators and row
// overrides (the fixture is never edited); every word is the producer's. Phones never grow their closed height.
import { test, expect } from '@playwright/test';
import { date, openBrief, sessions, VIEWPORTS, horizontalOverflow } from './brief-fixture.js';
import { DISTRIBUTION_TEXT, verdictWaiting } from '../../src/static/brief/marketTabModel.js';
import { DISTRIBUTION_BRIDGE, exposureRuleText } from '../../src/static/reference/marketTabStudy.js';
import { MARKET_TILE_SUFFIX } from '../../src/static/brief/briefEnvironment.js';

const phone = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, contextOptions: { reducedMotion: 'reduce' } });
const PHONES = { 320: phone(320, 640), 375: phone(375, 812), 390: phone(390, 844) };
/** The market budget (1300, brief-compact.spec.js) less the 12px of headroom every track keeps. */
const MARKET_LINE = 1288;
const DD_METHOD = 'index-down-strictly-over-0.2-higher-volume-age25-high5-v1';
/** 10/5 and 10/6 have closed (10/5 past the publication grace): two sessions after the analysis date 10/2. */
const TWO_LATER = '2026-10-07T09:00:00Z';

// ---- states ---------------------------------------------------------------------------------------------------------
const compose = (...parts) => Object.fromEntries([...new Set(parts.flatMap(Object.keys))].map(key => [key, value => { for (const part of parts) part[key]?.(value); }]));
/** What the current exporter publishes on both index series: the distribution method id. */
const methods = { trends: value => { for (const index of value.indices) index.method = DD_METHOD; } };
const AGES = [2, 5, 9, 14, 17, 20, 22, 24];
/** Index `i` (0 ^GSPC, 1 ^IXIC) with `n` active distribution days on its last session: events, points and the count agree. */
const days = (i, n) => ({ trends: value => {
  const item = value.indices[i], dates = item.points.map(point => point.date), last = dates.length - 1, ages = AGES.slice(0, n);
  item.method = DD_METHOD;
  item.events = ages.map(k => ({ date: dates[last - k], close: 5000, changePct: -0.6, volumeRatio: 1.1, state: 'active', removedDate: null, removal: null, ageSessions: k }));
  item.points = item.points.map((point, j) => ({ ...point, value: j < 25 ? null : ages.filter(k => last - k <= j).length, distribution: ages.some(k => last - k === j) }));
  item.latest = item.latest ? item.points.at(-1) : null;
  item.lastObserved = { date: item.points.at(-1).date, value: item.points.at(-1).value };
} });
/** An FTD-upgraded uptrend: the rows' regime confirmed_uptrend while SPY is under its 50-day line, and the regime's block. */
const ftdUpgraded = { rows: rows => { for (const row of rows) row.market_above_50dma = false; },
  manifest: value => { value.markets.US.market_context = { as_of_date: date, regime: 'confirmed_uptrend', distribution_days: 1, ftd_date: sessions.at(-8), ftd_days_since: 7, exposure_pct: 40, guard: null, method: 'backend-market-regime-v1', source: 'scan-rows' }; } };
/** The long history's ^GSPC under its 50-day line and above its 200-day line, as the 50日線割れ rows say (no conflict line). */
const belowFiftyIndex = { trends: value => { const sp = value.long_history.sp500, n = sp.length; sp.forEach((point, i) => { if (i >= n - 3) point.close = Math.round(point.close * 96) / 100; else if (i >= n - 200 && i < n - 50) point.close = Math.round(point.close * 90) / 100; }); } };
/** SPY under its 200-day line under a correction (長期トレンド警戒), with the long history's ^GSPC under it too. */
const below200 = { rows: rows => { for (const row of rows) { row.market_above_200dma = false; row.market_regime = 'correction'; } },
  trends: value => { const sp = value.long_history.sp500, n = sp.length; sp.forEach((point, i) => { if (i >= n - 10) point.close = Math.round(point.close * 85) / 100; }); } };

const settled = page => page.evaluate(() => document.fonts.ready.then(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => null)))));
const marketReady = async page => { await expect(page.locator('.market-history-explorer svg').first()).toBeAttached(); await settled(page); };
const todayReady = async page => { await expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate')).toHaveCount(5); await settled(page); };
const contentHeight = page => page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY));
/** The bottom of the market tab's lead block: the verdict, the warning summary and the first section tab. */
const lead = async page => { const market = page.getByRole('region', { name: '地合い' }); return Math.max(...await Promise.all([market.getByTestId('brief-regime'), market.getByRole('group', { name: '注意サイン（独自判定）' }), page.getByRole('tab').first()].map(async locator => { const box = await locator.boundingBox(); return box.y + box.height; }))); };
const tileHeights = page => page.getByTestId('brief-summary').locator('li').evaluateAll(items => items.map(li => li.getBoundingClientRect().height));
const clippedTileText = page => page.evaluate(() => [...document.querySelectorAll('.brief-fact, .brief-kgrid, .brief-summary')].flatMap(tile => [...tile.querySelectorAll('small, b, em')])
  .filter(node => node.getClientRects().length && node.scrollWidth > node.clientWidth).map(node => `${node.textContent} ${node.scrollWidth}>${node.clientWidth}`));
/** A CSS custom property of the card, resolved to the colour the browser computes. */
const resolved = (page, name) => page.locator('.brief-market').first().evaluate((node, prop) => { const probe = document.createElement('span'); probe.style.color = getComputedStyle(node).getPropertyValue(prop).trim(); node.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }, name);
const distRow = page => page.getByRole('region', { name: '地合い' }).locator('.brief-env-row').filter({ has: page.locator('small', { hasText: '分配日（25日）' }) });
const pairRow = (page, name) => distRow(page).locator('.brief-ftd-row').filter({ has: page.locator('.brief-ftd-index', { hasText: name }) });

// ---- M1a ------------------------------------------------------------------------------------------------------------
for (const [width, device] of [['375', PHONES[375]], ['390', PHONES[390]]]) test.describe(`M1a at ${width}px: 「FTD確認済み」 needs the same day's ^GSPC record`, () => {
  test.use(device);
  test('an FTD-upgraded uptrend shows the suffix with the day\'s confirmed record, and none with the series one session behind', async ({ page, context }) => {
    const current = await context.newPage();
    await openBrief(current, '#/brief', { mutate: compose(ftdUpgraded, belowFiftyIndex) });
    await todayReady(current);
    await expect(current.getByTestId('brief-summary').locator('.brief-tile-suffix')).toHaveText(MARKET_TILE_SUFFIX.ftd);
    await current.close();
    // The ^GSPC record ends on 10/1 while the analysis is 10/2: nothing backs the FTD on Today, so no suffix.
    const { errors } = await openBrief(page, '#/brief', { historyEnd: sessions.at(-2), mutate: compose(ftdUpgraded, belowFiftyIndex) });
    await todayReady(page);
    const summary = page.getByTestId('brief-summary');
    await expect(summary.locator('.brief-tile-suffix')).toHaveCount(0);
    await expect(summary).not.toContainText(MARKET_TILE_SUFFIX.ftd);
    await expect(summary.locator('li').first()).toContainText('買いは控える');
    if (width === '375') for (const height of await tileHeights(page)) expect(Math.abs(height - 97)).toBeLessThanOrEqual(2);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// ---- M1b, M1d ---------------------------------------------------------------------------------------------------------
test.describe('M1b and M1d at 390px: the disclosure sits inside the closed fold', () => {
  test.use(PHONES[390]);
  test('the fold stays closed at 44–48px and, opened, says the guide\'s limit, its untested levels and the backend guard', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    await marketReady(page);
    const fold = page.getByTestId('brief-regime').locator('details.brief-exposure-basis');
    await expect(fold).not.toHaveAttribute('open', '');
    const height = (await fold.locator(':scope > summary').boundingBox()).height;
    expect(height).toBeGreaterThanOrEqual(44);
    expect(height).toBeLessThanOrEqual(48);
    expect(await contentHeight(page)).toBeLessThanOrEqual(MARKET_LINE);
    expect(await lead(page)).toBeLessThanOrEqual(756);
    await fold.locator(':scope > summary').click();
    await expect(fold.locator('p').last()).toHaveText(exposureRuleText());
    expect(errors).toEqual([]);
  });
});

test.describe('M1b and M1d at 1440px: the disclosure in place', () => {
  test.use(VIEWPORTS.desktop);
  test('reads the whole disclosure under the meter without opening anything', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    await marketReady(page);
    const basis = page.getByRole('region', { name: '地合い' }).locator('p.brief-exposure-basis');
    await expect(basis).toBeVisible();
    await expect(basis).toHaveText(exposureRuleText());
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// ---- M1c ------------------------------------------------------------------------------------------------------------
test.describe('M1c at 375px: SPY under its 200-day line', () => {
  test.use(PHONES[375]);
  test('the market tab marks the label 独自判定; Today\'s tile strips it and keeps 97px; the lead stays above 756px', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', { mutate: compose(methods, below200) });
    await marketReady(page);
    const verdict = page.getByTestId('brief-regime');
    await expect(verdict.locator('strong')).toHaveText('長期トレンド警戒（独自判定）');
    await expect(verdict.locator('.brief-exposure b')).toHaveText('0%');
    await expect(page.getByRole('region', { name: '地合い' }).locator('.brief-index-source.is-conflict')).toHaveCount(0);
    expect(await lead(page)).toBeLessThanOrEqual(756);
    expect(await contentHeight(page)).toBeLessThanOrEqual(MARKET_LINE);
    // Today on the same page (the same served data).
    await page.goto('/#/brief');
    await todayReady(page);
    const tile = page.getByTestId('brief-summary').locator('li').first();
    await expect(tile.locator('b')).toHaveText('長期トレンド警戒');
    for (const height of await tileHeights(page)) expect(Math.abs(height - 97)).toBeLessThanOrEqual(2);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// ---- M1e ------------------------------------------------------------------------------------------------------------
for (const width of ['320', '375']) test.describe(`M1e at ${width}px: the clock past the next session's close`, () => {
  test.use(PHONES[width]);
  test('the lead says the judgement is 10/2\'s on one line, the page keeps its height, and the label, cap and Today stay', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    await marketReady(page);
    const verdict = page.getByTestId('brief-regime'), leadLine = verdict.locator('.brief-verdict-head p');
    await expect(leadLine).toHaveText('新規の買いを検討できます。');
    const [beforeHeight, beforeLead] = [await contentHeight(page), (await leadLine.boundingBox()).height];
    await page.clock.setFixedTime(new Date(TWO_LATER));
    await page.reload();
    await marketReady(page);
    const waiting = verdictWaiting({ market: { cap: 0.5 }, date, target: '2026-10-06' });
    await expect(leadLine).toHaveText(waiting.short);
    expect((await leadLine.boundingBox()).height).toBe(beforeLead);
    expect(await contentHeight(page)).toBe(beforeHeight);
    await expect(verdict.locator('strong')).toHaveText('上昇トレンド（独自判定）');
    await expect(verdict.locator('.brief-exposure b')).toHaveText('最大 50%');
    expect(await lead(page)).toBeLessThanOrEqual(756);
    // Today's tile and its gate are not this item's: the open guide still reads 目安≤50% there (OD-M9).
    await page.goto('/#/brief');
    await todayReady(page);
    await expect(page.getByTestId('brief-summary').locator('li').first()).toContainText('目安≤50%');
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('M1e at 1440px', () => {
  test.use(VIEWPORTS.desktop);
  test('says the long form in place', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    await page.clock.setFixedTime(new Date(TWO_LATER));
    await page.reload();
    await marketReady(page);
    await expect(page.getByTestId('brief-regime').locator('.brief-verdict-head p')).toHaveText(verdictWaiting({ market: { cap: 0.5 }, date, target: '2026-10-06' }).lead);
    expect(errors).toEqual([]);
  });
});

// ---- M3 -------------------------------------------------------------------------------------------------------------
for (const [width, device] of Object.entries(PHONES)) test.describe(`M3 at ${width}px: distribution days in two grades`, () => {
  test.use(device);
  for (const [name, state, grade] of [['5 days on the S&P', days(0, 5), 'reference'], ['6 days on the S&P', days(0, 6), 'reference'], ['7 days on the S&P', days(0, 7), 'caution']]) {
    test(`${name}: ${grade === 'caution' ? '▲ amber' : '○ neutral'} on the row, within the market line, Today unclipped`, async ({ page }) => {
      const { errors } = await openBrief(page, '#/brief/market', { mutate: state });
      await marketReady(page);
      const row = distRow(page), side = pairRow(page, 'S&P');
      if (grade === 'caution') {
        await expect(row).toHaveClass(/is-warn/);
        await expect(row.locator('.brief-env-status')).toHaveText('▲注意');
        await expect(side.locator('b')).toHaveClass(/is-warn/);
        await expect(side.locator('.brief-flag')).toHaveText(`▲注意：${DISTRIBUTION_TEXT.caution}`);
        expect(await side.locator('b').evaluate(node => getComputedStyle(node).color)).toBe(await resolved(page, '--ext'));
      } else {
        await expect(row).not.toHaveClass(/is-warn/);
        await expect(row.locator('.brief-env-status')).toHaveText('○参考');
        await expect(side.locator('b')).not.toHaveClass(/is-warn/);
        await expect(side.locator('.brief-flag')).toHaveText(`○参考：${DISTRIBUTION_TEXT.reference}・参考`);
        expect(await side.locator('.brief-flag').evaluate(node => getComputedStyle(node).color)).toBe(await resolved(page, '--text-2'));
        expect(await side.locator('b').evaluate(node => getComputedStyle(node).color)).not.toBe(await resolved(page, '--ext'));
        // Never a tab's ▲.
        await expect(page.getByRole('tab').first()).not.toContainText('▲');
      }
      // The bridge to SPY's own count is the opened row's first line (on the row it would add a line at 320 and 375).
      await row.getByRole('button').first().click();
      await expect(row.locator('.brief-env-detail p').first()).toHaveText(DISTRIBUTION_BRIDGE);
      await row.getByRole('button').first().click();
      if (width === '375') expect(await contentHeight(page)).toBeLessThanOrEqual(MARKET_LINE);
      expect(await lead(page)).toBeLessThanOrEqual(756);
      expect(await horizontalOverflow(page)).toBe(0);
      await page.goto('/#/brief');
      await todayReady(page);
      const fact = page.locator('.brief-market .brief-fact').filter({ has: page.locator('small', { hasText: '分配日（25日）' }) });
      await expect(fact.locator('em')).toHaveText(grade === 'caution' ? `注意：S&Pが${DISTRIBUTION_TEXT.caution}` : `参考：S&Pが${DISTRIBUTION_TEXT.reference}`);
      if (grade === 'caution') await expect(fact).toHaveClass(/is-warn/);
      else { await expect(fact).not.toHaveClass(/is-warn/); await expect(fact.locator('.brief-warnmark')).toHaveCount(0); }
      expect(await clippedTileText(page)).toEqual([]);
      expect(await horizontalOverflow(page)).toBe(0);
      expect(errors).toEqual([]);
    });
  }

  test('one index at 7 beside the other at 5: the head\'s ▲ and ○ pair is no taller than a ▲ alone', async ({ page, context }) => {
    const alone = await context.newPage();
    await openBrief(alone, '#/brief/market', { mutate: days(0, 7) });
    await marketReady(alone);
    const single = (await alone.locator('.brief-env-group.is-index > .brief-env-head').boundingBox()).height;
    await alone.close();
    const { errors } = await openBrief(page, '#/brief/market', { mutate: compose(days(0, 7), days(1, 5)) });
    await marketReady(page);
    const head = page.locator('.brief-env-group.is-index > .brief-env-head');
    await expect(head.locator('.brief-env-state')).toHaveText(['▲ 注意 1', '○ 参考 1']);
    expect((await head.boundingBox()).height).toBeLessThanOrEqual(single);
    await expect(pairRow(page, 'NAS').locator('.brief-flag')).toHaveClass(/is-reference/);
    await expect(page.getByRole('group', { name: '注意サイン（独自判定）' }).locator(':scope > b')).toHaveText(/^▲ 注意 1件・参考 \d件（独自判定）$/);
    expect(await lead(page)).toBeLessThanOrEqual(756);
    await page.goto('/#/brief');
    await todayReady(page);
    expect(await clippedTileText(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
