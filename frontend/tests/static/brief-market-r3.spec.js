// Round 3 (market track) on synthetic data. Package P2: Today's 「FTD確認済み」 only with the same day's ^GSPC record (M1a),
// the exposure guide's disclosure (M1b, M1d), the marked labels (M1c), the market tab's lead while a newer session has
// closed (M1e) and distribution days in two grades (M3). Package P3: the FTD row's age and 「前回のFTD」 (M2) and Today's
// 「反発n日目」 (M4). Package P4: the 50日線割れ verdict's 0% and what 過去の傾向 compares (M5), the 銘柄側 line and the 〔参考〕
// legend (M6) and the stage legend (M7). Package P6: the round 3 keys' lines in opened rows, with the keys and without (M8a-M8d),
// a confirmed FTD's current decline (M8e) and the +3% days (M9). Every state is built here with marketTrends' mutators and row
// overrides (the fixture is never edited); every word is the producer's. Phones never grow their closed height.
import { test, expect } from '@playwright/test';
import { date, openBrief, sessions, VIEWPORTS, horizontalOverflow } from './brief-fixture.js';
import { DISTRIBUTION_TEXT, RULE_TEXT, verdictBasis, verdictWaiting } from '../../src/static/brief/marketTabModel.js';
import { DISTRIBUTION_BRIDGE, exposureRuleText, followThroughDetail, publishedMarketContext, regimeCause } from '../../src/static/reference/marketTabStudy.js';
import { followThroughView, marketTileNote, marketTileSuffix, FTD_PREVIOUS_NAME, MARKET_TILE_SUFFIX } from '../../src/static/brief/briefEnvironment.js';
import { indexState } from '../../tools/export-market-trends.mjs';
import { readFileSync } from 'node:fs';
import { marketCardView } from '../../src/static/brief/marketTabModel.js';
import { marketTabParts, STAGE_LEGEND_NAMES, STAGE_REPLAY_NOTE, STOCK_SIDE_HEAD } from '../../src/static/brief/marketTabGroups.js';
import { BREADTH_LEGEND, marketTabStudy, STOCK_OUTCOME_UNTESTED } from '../../src/static/reference/marketTabStudy.js';
import { TAGS } from '../../src/static/reference/marketRegimeReference.js';
import { readMarketTrends } from '../../src/static/marketTrendAsset.js';
import { KEY_ABSENT } from '../../src/static/brief/marketTabGroups.js';
import { BIG_UP_HEAD, BIG_UP_NOTE, STALLING_HEAD } from '../../src/static/reference/marketTabStudy.js';
import { STALLING_METHOD } from '../../tools/export-market-trends.mjs';

const REFERENCE = JSON.parse(readFileSync(new URL('../../src/static/reference/market-regime-reference-v1.json', import.meta.url), 'utf8'));
/** A producer's text inside a pattern (its + and . are literal). */
const escape = text => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

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
/** What the round-2 exporter publishes besides: each index's closes and the Nasdaq's position (the phone's S&P／Nasdaq switch). */
const withCloses = { trends: value => {
  const sp = value.long_history.sp500;
  for (const [i, item] of value.indices.entries()) {
    const dates = item.points.map(point => point.date), n = dates.length;
    item.closes = dates.map((day, k) => ({ date: day, close: i === 0 ? sp.find(point => point.date === day).close : Math.round((16000 + k * 12 - (k > n - 30 ? (k - n + 30) * 45 : 0)) * 100) / 100 }));
  }
  value.indices[1].state = indexState(value.indices[1].closes, value.indices[1].points.at(-1).date);
} };
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
// S1-P4: Today's market answer and the market track's word are the gate card's (the 地合い tile is gone): its headline and
// its sign line; the word's sentence is in the gate's fold (closed on a phone, in place from 1024px).
const gate = page => page.getByRole('region', { name: '地合い', exact: true });
const gateSign = page => gate(page).locator('.brief-gate-sign');
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
    // S1-P4: the gate's FTD line (the fixture's FTD is older than 25 sessions: 前回のFTD with its date), never merged.
    await expect(gateSign(current)).toHaveText(/^前回のFTD \d+\/\d+（参考・目安は 0%のまま：SPYが50日線の下）$/);
    await current.close();
    // The ^GSPC record ends on 10/1 while the analysis is 10/2: nothing backs the FTD on Today, so no suffix.
    const { errors } = await openBrief(page, '#/brief', { historyEnd: sessions.at(-2), mutate: compose(ftdUpgraded, belowFiftyIndex) });
    await todayReady(page);
    // One session behind, the sign is withheld (its own words), never the FTD line.
    await expect(gateSign(page)).toHaveText('サイン：未確認（10/2分は再集計待ち）');
    await expect(gate(page)).not.toContainText(MARKET_TILE_SUFFIX.ftd);
    await expect(gate(page).locator('.brief-gate-headline')).toHaveText('買いは控える（独自判定）');
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
    // The Nasdaq in a correction without a rally attempt, so the 0% tile carries no suffix (M4's 「反発n日目」 is tested below).
    const noRally = { trends: value => { Object.assign(value.indices[1].followThrough, { state: 'correction', attempt: null }); } };
    const { errors } = await openBrief(page, '#/brief/market', { mutate: compose(methods, below200, noRally) });
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
    // S1-P4: the gate card answers 買いは控える; its fold's 判定 row names the label without its 独自判定 mark (the row's kind
    // says it), 判定 printed once (the group has no heading of its own), and no sign line is drawn for a Nasdaq without a rally attempt.
    await expect(gate(page).locator('.brief-gate-headline')).toHaveText('買いは控える（独自判定）');
    // (The fold is closed at 375px: the group is read in the DOM, as before.)
    const judged = gate(page).locator('.brief-gate-fold > [role="group"][aria-label="判定"]');
    await expect(judged).toHaveText('判定長期トレンド警戒・買いは控える独自判定');
    await expect(judged.locator('h3')).toHaveCount(0);
    await expect(gateSign(page)).toHaveCount(0);
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
    // S1-P4 (plan D18): Today's gate card says the same waiting form, the figure dated 10/2, never 検討.
    await page.goto('/#/brief');
    await todayReady(page);
    await expect(gate(page).locator('.brief-gate-headline')).toHaveText(`${waiting.short}（独自判定）`);
    await expect(gate(page).locator('.brief-gate-figure')).toHaveText('新規買いの目安（10/2時点・独自設定）最大50%');
    await expect(gate(page)).not.toContainText(/検討できる|検討可/);
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
      // Today's fact in the gate's fold is read as the indices' own count (the S1 critics' round), then its grade.
      await expect(fact.locator('em')).toHaveText(`判定には使わない別集計・${grade === 'caution' ? `注意：S&Pが${DISTRIBUTION_TEXT.caution}` : `参考：S&Pが${DISTRIBUTION_TEXT.reference}`}`);
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
    // The section tabs' short form on one row, each word for assistive tech.
    await expect(head.locator('.brief-env-state')).toHaveText(['▲注意 1', '○参考 1']);
    expect((await head.boundingBox()).height).toBeLessThanOrEqual(single);
    await expect(pairRow(page, 'NAS').locator('.brief-flag')).toHaveClass(/is-reference/);
    await expect(page.getByRole('group', { name: '注意サイン（独自判定）' }).locator(':scope > b')).toHaveText(/^▲ 注意 1件・参考 \d件（独自判定）$/);
    expect(await lead(page)).toBeLessThanOrEqual(756);
    await page.goto('/#/brief');
    await todayReady(page);
    expect(await clippedTileText(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  for (const [where, extra] of [['beside the heading', {}], ['beside the switch', withCloses]]) test(`${where}, one session behind: the ▲ and ○ pair and the date keep the head no taller than a ▲ alone`, async ({ page, context }) => {
    const options = state => ({ historyEnd: sessions.at(-2), mutate: compose(state, extra) });
    const alone = await context.newPage();
    await openBrief(alone, '#/brief/market', options(days(0, 7)));
    await marketReady(alone);
    const single = (await alone.locator('.brief-env-group.is-index > .brief-env-head').boundingBox()).height;
    await alone.close();
    const { errors } = await openBrief(page, '#/brief/market', options(compose(days(0, 7), days(1, 5))));
    await marketReady(page);
    await expect(page.getByRole('region', { name: '地合い' }).getByRole('group', { name: '表示する指数' })).toHaveCount(extra === withCloses ? 1 : 0);
    const meta = page.locator(`.brief-env-group.is-index .brief-env-meta.${extra === withCloses ? 'is-inline' : 'is-pair'}`);
    // The section tabs' short form on screen, each word for assistive tech; the date of the older session stays.
    await expect(meta.locator('.brief-env-state')).toHaveText(['▲注意 1', '○参考 1']);
    await expect(meta.locator('.brief-env-asof')).toHaveText(/^\d+\/\d+時点の値$/);
    expect((await page.locator('.brief-env-group.is-index > .brief-env-head').boundingBox()).height).toBeLessThanOrEqual(single);
    expect(await lead(page)).toBeLessThanOrEqual(756);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// ---- M2: the FTD row's age and 「前回のFTD」 -------------------------------------------------------------------------
/** The served asset's value, kept as served (the producer's inputs for the expected words). */
const capture = seen => ({ trends: value => { seen.value = structuredClone(value); } });
/** The ^GSPC FTD `n` sessions before the series' last point. */
const ftdAgo = n => ({ trends: value => { const dates = value.indices[0].points.map(point => point.date), ft = value.indices[0].followThrough; ft.ftd = { ...ft.ftd, date: dates.at(-1 - n), sessionsSince: n }; } });
/** An older asset: no follow-through record on either index (followThroughValid withdraws a confirmed record without sessionsSince). */
const noFollowThrough = { trends: value => { for (const index of value.indices) delete index.followThrough; } };
/** A 50日線割れ verdict that is no FTD upgrade (the rows' regime a correction), with the long history's ^GSPC under its 50-day line. */
const below50Rows = { rows: rows => { for (const row of rows) { row.market_above_50dma = false; row.market_regime = 'correction'; } } };
const CLOSED = { label: '50日線割れ（弱含み・独自判定）', cap: 0, regime: 'correction', ftdUpgraded: false };
const CORRECTION_BLOCK = { as_of_date: date, regime: 'correction', distribution_days: 7, ftd_date: null, ftd_days_since: null, exposure_pct: 0, guard: null, method: 'backend-market-regime-v1', source: 'scan-rows' };
const correctionBlock = { manifest: value => { value.markets.US.market_context = CORRECTION_BLOCK; } };
/** The closed content height of each state before M2 (3a4a162, CI fonts, measured): a state never grows past it. */
const PRE_M2 = { old: { 320: 1390, 375: 1242, 390: 1219 }, recent: { 320: 1341, 375: 1219, 390: 1219 }, absent: { 320: 1314, 375: 1202, 390: 1202 }, behind: { 320: 1391, 375: 1228, 390: 1219 },
  switch: { 320: 1337, 375: 1201, 390: 1201 }, oldSwitch: { 320: 1386, 375: 1223, 390: 1201 } };
const ftdRow = page => page.getByRole('region', { name: '地合い' }).locator('.brief-env-row').filter({ has: page.locator('small', { hasText: 'フォロースルーデー' }) });
const lines = locator => locator.evaluate(node => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight)));

for (const [width, device] of Object.entries(PHONES)) test.describe(`M2 at ${width}px: the FTD row says how old the FTD is`, () => {
  test.use(device);
  const STATES = [
    ['old', 'an FTD 35 sessions old under a 0% guide (the fixture\'s)', compose(methods, below50Rows, belowFiftyIndex, correctionBlock), {}],
    ['recent', 'an FTD 12 sessions old', compose(methods, ftdAgo(12)), {}],
    ['absent', 'an older asset without follow-through records', compose(methods, noFollowThrough), {}],
    ['behind', 'the series one session behind', methods, { historyEnd: sessions.at(-2) }],
    // What the current exporter publishes besides: each index's closes, so the phone's S&P／Nasdaq switch sits beside the heading.
    ['switch', 'the fixture\'s FTD with the S&P／Nasdaq switch', compose(methods, withCloses), {}],
    ['oldSwitch', 'an old FTD under a 0% guide with the S&P／Nasdaq switch', compose(methods, below50Rows, belowFiftyIndex, correctionBlock, withCloses), {}],
  ];
  for (const [key, name, mutate, extra] of STATES) test(`${name}: the producer's words on one value line, no taller than before`, async ({ page }) => {
    const seen = {};
    const { errors } = await openBrief(page, '#/brief/market', { ...extra, mutate: compose(mutate, capture(seen)) });
    await marketReady(page);
    const views = seen.value.indices.map(index => followThroughView(index.followThrough, date)), pairs = ftdRow(page).locator('.brief-ftd-row');
    await expect(pairs.locator('b')).toHaveText(views.map(view => view.b));
    for (const [i, view] of views.entries()) await expect(pairs.nth(i)).toContainText(`${view.b}${view.em}`);
    if (['old', 'behind', 'switch', 'oldSwitch'].includes(key)) expect(views[0]).toMatchObject({ b: expect.stringMatching(new RegExp(`^${FTD_PREVIOUS_NAME} \\d+/\\d+$`)), em: expect.stringMatching(/^35日前・/), previous: true });
    if (key === 'recent') expect(views[0]).toMatchObject({ b: expect.stringMatching(/^確認 \d+\/\d+$/), em: expect.stringMatching(/^12日前・/) });
    if (key === 'absent') expect(views.map(view => view.b)).toEqual(['未集計', '未集計']);
    // The count leads the em line, so the value keeps one line even at 320px.
    for (const b of await pairs.locator('b').all()) expect(await lines(b)).toBe(1);
    expect(await contentHeight(page)).toBeLessThanOrEqual(PRE_M2[key][width]);
    expect(await lead(page)).toBeLessThanOrEqual(756);
    expect(await horizontalOverflow(page)).toBe(0);
    if (key === 'switch' || key === 'oldSwitch') await expect(page.getByRole('region', { name: '地合い' }).getByRole('group', { name: '表示する指数' })).toHaveCount(1);
    if (key === 'old') {
      // Inside the closed fold, the cause line says the same day's ^GSPC FTD is the index's own count.
      const verdict = page.getByTestId('brief-regime');
      await expect(verdict.locator('strong')).toHaveText(CLOSED.label);
      await verdict.locator('details.brief-exposure-basis > summary').click();
      const cause = regimeCause(CLOSED, publishedMarketContext({ as_of_date: date, market_context: CORRECTION_BLOCK }, { date }), verdictBasis(CLOSED, date), date, { gspc: seen.value.indices[0].followThrough });
      expect(cause).toContain(`下の^GSPCの${FTD_PREVIOUS_NAME}（`);
      await expect(verdict.locator('.brief-verdict-cause')).toHaveText(cause);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('M2 at 375px: the opened row', () => {
  test.use(PHONES[375]);
  test('opens to the app\'s own rule beside the cited rises, the failure, 前回のFTD and 過去の傾向, then the rule', async ({ page }) => {
    const seen = {};
    const { errors } = await openBrief(page, '#/brief/market', { mutate: capture(seen) });
    await marketReady(page);
    const row = ftdRow(page), before = await contentHeight(page);
    await row.locator('.brief-env-toggle').click();
    // The row's own four lines first, then the round 3 lines of the served asset (P6: M8e, M9), then the rule.
    const { details } = followThroughDetail(readMarketTrends(structuredClone(seen.value), { as_of_date: date }).indices, date);
    expect(details.slice(0, 4)).toEqual(followThroughDetail().details);
    await expect(row.locator('.brief-env-detail p')).toHaveText([...details, `基準${RULE_TEXT.ftd}`]);
    await row.locator('.brief-env-toggle').click();
    expect(await contentHeight(page)).toBe(before);
    expect(errors).toEqual([]);
  });
});

test.describe('M2 at 320px: the ◆ of an FTD 120 sessions old', () => {
  test.use(PHONES[320]);
  test('keeps its ◆ near the window\'s left edge, reads 前回のFTD, and its label stays inside the frame', async ({ page }) => {
    const seen = {};
    const { errors } = await openBrief(page, '#/brief/market', { mutate: compose(methods, ftdAgo(120), capture(seen)) });
    await marketReady(page);
    const frame = page.getByRole('region', { name: '地合い' }).locator('.brief-index-frame');
    const day = seen.value.indices[0].followThrough.ftd.date.slice(5).split('-').map(Number).join('/');
    await expect(frame.locator('.brief-index-mark.is-ftd')).toHaveText(`◆${FTD_PREVIOUS_NAME} ${day}`);
    await expect(frame.getByRole('img')).toHaveAttribute('aria-label', new RegExp(`。${FTD_PREVIOUS_NAME} ${day}。目盛り`));
    await expect(page.locator('.brief-index-legend .is-ftd')).toHaveText('◆ FTD');
    const box = await frame.boundingBox(), label = await frame.locator('.brief-index-mark-label').boundingBox();
    expect(label.x).toBeGreaterThanOrEqual(box.x);
    expect(label.x + label.width).toBeLessThanOrEqual(box.x + box.width);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// ---- M4: 「反発n日目」 on Today's 地合い tile -----------------------------------------------------------------------
/** The ^GSPC in a rally attempt of day `d` on the analysis day (the fixture's ^IXIC is on day 3). */
const gspcRally = d => ({ trends: value => { const dates = value.indices[0].points.map(point => point.date), last = dates.length - 1;
  Object.assign(value.indices[0].followThrough, { state: 'rally_attempt', low: { date: dates[last - d], low: 4980 }, attempt: { startDate: dates[last - d + 1], day: d }, ftd: null, events: [] }); } });
const SERVED_MANIFEST = { markets: { US: { as_of_date: date } } };
// The owner's Today line (plan S1-P4: was 1400 here, the governing pin's 1388 from S1).
const TODAY_LINE = 1388;

for (const [width, device] of Object.entries(PHONES)) test.describe(`M4 at ${width}px: 反発n日目 on Today's tile while the guide is 0%`, () => {
  test.use(device);
  for (const [name, extra] of [['the Nasdaq on day 3', {}], ['both indices, the larger day', gspcRally(5)]]) test(`${name}: the sign line and its note, one line, unclipped, Today within its line`, async ({ page }) => {
    const seen = {};
    const { errors } = await openBrief(page, '#/brief', { mutate: compose(methods, below50Rows, belowFiftyIndex, extra, capture(seen)) });
    await todayReady(page);
    const input = { market: CLOSED, trends: { data: seen.value }, manifest: SERVED_MANIFEST }, days = seen.value.indices.map(index => index.followThrough.attempt?.day ?? 0);
    expect(marketTileSuffix(input)).toBe(MARKET_TILE_SUFFIX.rally(Math.max(...days)));
    // S1-P4: the gate card's sign line says the word on its own line, under the conditions; its sentence is in the fold.
    await expect(gate(page).locator('.brief-gate-headline')).toHaveText('買いは控える（独自判定）');
    // The word after the index it counts (the larger day's), with 参考 and the guide unchanged (the S1 critics' round).
    await expect(gateSign(page)).toHaveText(`${name === 'both indices, the larger day' ? 'S&P' : 'NAS'} ${marketTileSuffix(input)}（参考・目安は不変）`);
    await expect(gate(page).locator('.brief-tile-note')).toHaveText(`${marketTileSuffix(input)}：${marketTileNote(input)}`);
    expect(await gateSign(page).evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size; })).toBe(1);
    expect(await contentHeight(page)).toBeLessThanOrEqual(TODAY_LINE);
    expect(await clippedTileText(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('one session behind, or the guide open: no 反発n日目 on the tile', async ({ page, context }) => {
    const behind = await context.newPage();
    await openBrief(behind, '#/brief', { historyEnd: sessions.at(-2), mutate: compose(methods, below50Rows, belowFiftyIndex) });
    await todayReady(behind);
    // One session behind: the sign is withheld (its own words), never 反発n日目.
    await expect(gateSign(behind)).toHaveText('サイン：未確認（10/2分は再集計待ち）');
    await behind.close();
    // The base fixture's open guide keeps 「NAS調整中」 for the same Nasdaq rally attempt.
    const { errors } = await openBrief(page, '#/brief', { mutate: methods });
    await todayReady(page);
    await expect(gateSign(page)).toHaveText(`${MARKET_TILE_SUFFIX.nasdaq}（参考・目安は不変）`);
    expect(errors).toEqual([]);
  });
});

test.describe('M4 at 1440px: the note under the market card', () => {
  test.use(VIEWPORTS.desktop);
  test('says each index\'s day and rally low, the wait (独自判定) and that the verdict and the guide are unchanged', async ({ page }) => {
    const seen = {};
    const { errors } = await openBrief(page, '#/brief', { mutate: compose(methods, below50Rows, belowFiftyIndex, gspcRally(5), capture(seen)) });
    await todayReady(page);
    const input = { market: CLOSED, trends: { data: seen.value }, manifest: SERVED_MANIFEST };
    expect(marketTileNote(input)).toMatch(/^S&P 500は安値\d+\/\d+から反発5日目、Nasdaq総合は安値\d+\/\d+から反発3日目。4日目以降の\+1\.2%上昇待ち（独自判定）。判定と目安は変わりません。$/);
    await expect(page.locator('.brief-tile-note')).toHaveText(`${marketTileSuffix(input)}：${marketTileNote(input)}`);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// ---- M5, M6, M7 (package P4) ------------------------------------------------------------------------------------------
/** The closed content height of each state before P4 (a085a88, CI fonts, measured): a state never grows past it. */
const PRE_P4 = { base: { 320: 1341, 375: 1219, 390: 1219 }, below50: { 320: 1390, 375: 1242, 390: 1219 }, behind: { 320: 1391, 375: 1228, 390: 1219 }, switch: { 320: 1337, 375: 1201, 390: 1201 },
  /** The リーダー section's content height before P4 (the stage legend at two lines). */
  leaders: { 320: 1159, 375: 1075, 390: 1061 } };
const UP_MARKET = { label: '上昇トレンド（独自判定）', cap: 0.5, regime: 'confirmed_uptrend', ftdUpgraded: false };
/** The producers' words for the served asset: the 銘柄側 line (marketTabParts) and the study parts (marketTabStudy). */
const words = (served, market, manifest = { markets: { US: { as_of_date: date } } }) => ({ stockSide: marketCardView({ market, trends: { data: served }, date, tab: marketTabParts }).stockSide,
  study: marketTabStudy({ trends: { data: served }, reference: REFERENCE, date, market, manifest }) });
const fold = page => page.getByTestId('brief-regime').locator('details.brief-exposure-basis');
const P4_STATES = [
  ['base', 'the fixture (上昇トレンド)', {}, {}, UP_MARKET],
  ['below50', 'a 50日線割れ verdict with ^GSPC above its 200-day line and under its 50-day line', compose(methods, below50Rows, belowFiftyIndex, correctionBlock), {}, CLOSED],
  ['behind', 'the series one session behind', {}, { historyEnd: sessions.at(-2) }, UP_MARKET],
  ['switch', 'the S&P／Nasdaq switch beside the heading', compose(methods, withCloses), {}, UP_MARKET],
];

for (const [width, device] of Object.entries(PHONES)) test.describe(`M5, M6 and M7 at ${width}px: the fold, the legends and the stage row`, () => {
  test.use(device);
  for (const [key, name, mutate, extra, market] of P4_STATES) test(`${name}: the 銘柄側 line first, the 0% note last, the closed height as before`, async ({ page }) => {
    const seen = {};
    const { errors } = await openBrief(page, '#/brief/market', { ...extra, mutate: compose(mutate, capture(seen)) });
    await marketReady(page);
    const { stockSide, study } = words(seen.value, market);
    await expect(fold(page)).not.toHaveAttribute('open', '');
    const summary = (await fold(page).locator(':scope > summary').boundingBox()).height;
    expect(summary).toBeGreaterThanOrEqual(44);
    expect(summary).toBeLessThanOrEqual(key === 'behind' ? 53 : 48);
    const before = await contentHeight(page);
    expect(before).toBeLessThanOrEqual(PRE_P4[key][width]);
    expect(await lead(page)).toBeLessThanOrEqual(756);
    await fold(page).locator(':scope > summary').click();
    const lines = fold(page).locator('.brief-expander-body > p');
    await expect(lines.first()).toHaveText(stockSide);
    await expect(lines.first()).toHaveClass('brief-verdict-stock');
    expect(stockSide.startsWith(key === 'behind' ? STOCK_SIDE_HEAD.replace('（', `（${sessions.at(-2).slice(5).split('-').map(Number).join('/')}時点・`) : `${STOCK_SIDE_HEAD}：`)).toBe(true);
    // Never a sign: no ▲, no ○, no amber.
    expect(stockSide).not.toMatch(/▲|○|注意/);
    expect(await lines.first().evaluate(node => getComputedStyle(node).color)).toBe(await resolved(page, '--text-2'));
    if (key === 'below50') {
      expect(study.zeroCap).toMatch(new RegExp(`^\\^GSPC・21営業日で5%以上の下げ：この状態 \\d+%${TAGS.unestablished}／両線の上 \\d+%${TAGS.both}／全期間 \\d+%。0%は独自設定で、検証された水準ではありません。$`));
      await expect(lines.last()).toHaveText(study.zeroCap);
      await expect(lines.last()).toHaveClass('brief-exposure-zero');
    } else {
      expect(study.zeroCap).toBeNull();
      await expect(fold(page).locator('.brief-exposure-zero')).toHaveCount(0);
    }
    await fold(page).locator(':scope > summary').click();
    expect(await contentHeight(page)).toBe(before);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('the 〔参考〕 legend stays one line and says what the study did not find; the 注記 says what it never tested', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    await marketReady(page);
    const legend = page.getByRole('group', { name: '注意サイン（独自判定）' }).locator('.brief-signals-tags');
    await expect(legend).toHaveText(`${TAGS.breadth}＝${BREADTH_LEGEND}`);
    expect(await lines(legend)).toBe(1);
    await expect(page.locator('.brief-screen-notes')).toContainText(`${STOCK_OUTCOME_UNTESTED}）。`);
    // The headline's 参考 count is in the same bold text as its 注意 count (one text node of the one <b>).
    const head = await page.getByRole('group', { name: '注意サイン（独自判定）' }).locator(':scope > b').evaluate(node => ({ text: node.firstChild.nodeType === 3 ? node.firstChild.textContent : null, weight: Number(getComputedStyle(node).fontWeight) }));
    expect(head.text).toMatch(/^注意 \d+件・参考 \d+件$/);
    expect(head.weight).toBeGreaterThanOrEqual(700);
    expect(await contentHeight(page)).toBeLessThanOrEqual(PRE_P4.base[width]);
    expect(errors).toEqual([]);
  });

  test('M7: the stage legend says what stages 2 and 3 count on its two lines; the opened row says the base exception is not replayed', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market');
    await marketReady(page);
    await page.getByRole('tab', { name: /^リーダー/ }).click();
    const legend = page.locator('.brief-stagelegend');
    await expect(legend.locator('span')).toHaveText(STAGE_LEGEND_NAMES.map((name, i) => new RegExp(`^${i + 1} ${name.replace(/[（）]/g, '\\$&')} \\d+%$`)));
    expect(new Set(await legend.locator('span').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)))).size).toBeLessThanOrEqual(2);
    expect(await contentHeight(page)).toBeLessThanOrEqual(PRE_P4.leaders[width]);
    const row = page.locator('.brief-env-row.is-stage');
    await row.locator('.brief-env-toggle').click();
    await expect(row.locator('.brief-env-detail p').first()).toHaveText(STAGE_REPLAY_NOTE);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('M5, M6 and M7 at 1440px: in place', () => {
  test.use(VIEWPORTS.desktop);
  test('the 銘柄側 line under the basis on at most two lines, the 0% note after the guide, the tag note and the footer', async ({ page, context }) => {
    const base = await context.newPage(), seenBase = {};
    await openBrief(base, '#/brief/market', { mutate: capture(seenBase) });
    await marketReady(base);
    const baseWords = words(seenBase.value, UP_MARKET), stock = base.getByTestId('brief-regime').locator('p.brief-verdict-why + p.brief-verdict-stock');
    await expect(stock).toHaveText(baseWords.stockSide);
    expect(await lines(stock)).toBeLessThanOrEqual(2);
    await expect(base.getByTestId('brief-regime').locator('.brief-exposure-zero')).toHaveCount(0);
    await expect(base.getByRole('group', { name: '注意サイン（独自判定）' }).locator('.brief-signals-tags')).toContainText(`${STOCK_OUTCOME_UNTESTED}）。`);
    await expect(base.locator('.brief-stagelegend span').nth(1)).toHaveText(new RegExp(`^2 ${STAGE_LEGEND_NAMES[1].replace(/[（）]/g, '\\$&')} \\d+%$`));
    await base.close();
    const seen = {};
    const { errors } = await openBrief(page, '#/brief/market', { mutate: compose(methods, below50Rows, belowFiftyIndex, correctionBlock, capture(seen)) });
    await marketReady(page);
    const { stockSide, study } = words(seen.value, CLOSED), verdict = page.getByTestId('brief-regime');
    await expect(verdict.locator('p.brief-verdict-why').first()).toHaveText(verdictBasis(CLOSED, date).text);
    await expect(verdict.locator('p.brief-verdict-why + p.brief-verdict-stock')).toHaveText(stockSide);
    await expect(verdict.locator('p.brief-exposure-basis + p.brief-exposure-zero')).toHaveText(study.zeroCap);
    expect(await lines(verdict.locator('.brief-exposure-zero'))).toBeLessThanOrEqual(2);
    // The footer says what the block compares and names the S&P's 200日線の上・50日線の下 (its own row's robust higher mean).
    await expect(page.locator('.brief-regime-foot').first()).toHaveText(study.regime.footer);
    expect(study.regime.footer).toContain('この欄は下げの頻度の比較です（21営業日・^GSPC／^IXIC）。');
    expect(study.regime.footer).toContain('200日線の上・50日線の下（S&P）は平均リターンは高めでした。');
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// ---- M8a-M8e, M9 (package P6) -------------------------------------------------------------------------------------------
/**
 * The closed content height of each section in each state below before P6 (90e8820, the code of d522ce7, which ignores the
 * keys; CI fonts, measured): the 指数 panel, then the 参加度 and リーダー sections. The keys never move a closed row.
 */
const PRE_BASE = { index: { 320: 1341, 375: 1219, 390: 1219 }, breadth: { 320: 1098, 375: 1031, 390: 1015 }, leaders: { 320: 1159, 375: 1075, 390: 1061 } };
const PRE_P6 = { present: { index: { 320: 1337, 375: 1201, 390: 1201 }, breadth: PRE_BASE.breadth, leaders: { 320: 1161, 375: 1075, 390: 1061 } }, absent: PRE_BASE, small: PRE_BASE, malformed: PRE_BASE };
/** The five long-history keys on every row, under the collector's null rules (`last` overrides the newest row). */
const r3Rows = (last = {}) => ({ trends: value => { const rows = value.long_history.breadth;
  for (const row of rows) { const cohort = row.leaderCohort === null ? null : Math.floor(row.leaderCohort * 0.6);
    Object.assign(row, { rs90Cohort: cohort, rs90CohortAbove50: cohort === null ? null : Math.floor(cohort * 0.45), newHighsClose: 1, breakoutsEarlyJudged: 9, breakoutsEarlyFailed: 3 }); }
  Object.assign(rows.at(-1), typeof last === 'function' ? last(rows.at(-1)) : last); } });
/** Each index's stalling days as the exporter writes them with emission on (`records` overrides them). */
const stalling = (records = null) => ({ trends: value => value.indices.forEach((item, i) => {
  item.stalling = records ? records[i] : { available: true, method: STALLING_METHOD, dates: i ? [] : [item.points.at(-3).date] }; }) });
/** The ^GSPC FTD confirmed with a pullback of `pct`% from its post-FTD peak (followThroughDay's peak, low and declinePct). */
const pullback = pct => ({ trends: value => { const item = value.indices[0], dates = item.points.map(point => point.date);
  Object.assign(item.followThrough, { peak: { date: dates.at(-10), close: 5400 }, low: { date: dates.at(-4), low: 5260 }, declinePct: pct }); } });
const P6_STATES = [
  ['present', 'every key present', compose(methods, withCloses, r3Rows({ leaderCohort: 30, leaderCohortAbove50: 21, rs90Cohort: 12, rs90CohortAbove50: 5 }), stalling(), pullback(2.4)), 'present'],
  ['absent', 'no key (every publication while emission is off)', {}, 'absent'],
  ['small', 'samples under the minimums', compose(r3Rows(row => ({ rs90Cohort: Math.min(row.leaderCohort, 6), rs90CohortAbove50: 2, breakoutsEarlyJudged: 3, breakoutsEarlyFailed: 1 })), stalling()), 'small'],
  ['malformed', 'a malformed stalling record', stalling([{ available: true, method: STALLING_METHOD, dates: ['2026-02-30'] }, { available: true, method: STALLING_METHOD, dates: [] }]), 'malformed'],
];
/** The app's view of the served asset, through the reader and the producers the market tab uses. */
const p6View = served => { const data = readMarketTrends(structuredClone(served), { as_of_date: date }), trends = { data };
  return marketCardView({ market: UP_MARKET, trends, date, study: marketTabStudy({ trends, reference: REFERENCE, date, market: UP_MARKET, manifest: SERVED_MANIFEST }), tab: marketTabParts }); };
/** An opened row's lines in EnvRow's order (its detail, a pair row's note, its details), then its rule. */
const openedLines = item => [item.detail, item.rows ? item.note : null, ...(item.details || []), `基準${item.rule}`].filter(Boolean);
const P6_ROWS = [['index', 'ftd', 'フォロースルーデー'], ['index', 'dist', '分配日（25日）'], ['breadth', 'extremes', '52週の新高値・新安値'], ['leaders', 'breakout', null], ['leaders', 'health', 'リーダーの健全度']];
const envRow = (page, group, key, label) => page.locator(`.brief-env-group.is-${group} .brief-env-row`).filter(label ? { has: page.locator('small', { hasText: label }) } : { has: page.locator('small', { hasText: '確定分' }) });

for (const [width, device] of [...Object.entries(PHONES), ['1440', VIEWPORTS.desktop]]) test.describe(`M8a-M8e and M9 at ${width}px: the opened rows`, () => {
  test.use(device);
  const phone = width !== '1440';
  for (const [key, name, mutate, pre] of P6_STATES) test(`${name}: each opened row reads its producer's lines, and the closed heights stay`, async ({ page }) => {
    const seen = {};
    const { errors } = await openBrief(page, '#/brief/market', { mutate: compose(mutate, capture(seen)) });
    await marketReady(page);
    const view = p6View(seen.value), item = id => view.groups.flatMap(g => g.items).find(entry => entry.key === id);
    if (phone) {
      expect(await contentHeight(page)).toBe(PRE_P6[pre].index[width]);
      expect(await lead(page)).toBeLessThanOrEqual(756);
    }
    for (const [group, id, label] of P6_ROWS) {
      if (phone) { await page.getByRole('tab', { name: new RegExp(`^${{ index: '指数', breadth: '参加度', leaders: 'リーダー' }[group]}`) }).click(); await settled(page); }
      const row = envRow(page, group, id, label);
      await expect(row).toHaveCount(1);
      const closed = phone ? await contentHeight(page) : null;
      if (phone) expect(closed).toBe(PRE_P6[pre][group][width]);
      await row.locator('.brief-env-toggle').click();
      const lines = row.locator('.brief-env-detail > p');
      await expect(lines).toHaveText(openedLines(item(id)));
      for (const text of await lines.allTextContents()) expect(text).not.toMatch(/▲|○/);
      await row.locator('.brief-env-toggle').click();
      if (phone) expect(await contentHeight(page)).toBe(closed);
    }
    const lineOf = (id, head) => openedLines(item(id)).find(text => text.startsWith(head));
    if (key === 'absent') {
      expect(lineOf('health', 'RS推計90以上')).toBe(`RS推計90以上：${KEY_ABSENT}`);
      expect(item('extremes').detail).toBe(`うち終値でも更新：${KEY_ABSENT}`);
      expect(lineOf('breakout', '早期')).toBe(`早期（上抜け後5営業日・独自）：${KEY_ABSENT}`);
      expect(lineOf('dist', STALLING_HEAD)).toBe(`${STALLING_HEAD}：${KEY_ABSENT}`);
      expect(lineOf('ftd', BIG_UP_HEAD)).toBe(`${BIG_UP_HEAD}：未収録（旧形式）`);
      // No decline line beside the fixture's synthetic 7.6 (a confirmed record never stays confirmed at 6% or more).
      expect(openedLines(item('ftd')).some(text => text.includes('現在の下落'))).toBe(false);
      for (const text of [lineOf('health', 'RS推計90以上'), item('extremes').detail, lineOf('breakout', '早期'), lineOf('dist', STALLING_HEAD)]) expect(text).not.toMatch(/[０-９0-9]+(銘柄|件|日|%)/);
    }
    if (key === 'present') {
      expect(lineOf('health', 'RS推計90以上')).toBe('RS推計90以上：12銘柄中 42%');
      expect(item('extremes').detail).toBe('うち終値でも更新 1');
      expect(lineOf('breakout', '早期')).toBe('早期（上抜け後5営業日・独自）：9件中 33% が −7%に到達');
      expect(lineOf('dist', STALLING_HEAD)).toBe(`${STALLING_HEAD}：S&P 1日／NAS 0日`);
      expect(lineOf('ftd', 'S&P：現在の下落')).toMatch(/^S&P：現在の下落 −2\.4%（高値\d+\/\d+→安値\d+\/\d+）・6%で調整判定（独自設定）$/);
      expect(lineOf('ftd', BIG_UP_HEAD)).toMatch(new RegExp(`^${escape(BIG_UP_HEAD)}：S&P 直近\\d+営業日で\\d+回／NAS 直近\\d+営業日で\\d+回（${escape(BIG_UP_NOTE)}）$`));
    }
    if (key === 'small') {
      expect(lineOf('health', 'RS推計90以上')).toMatch(/^RS推計90以上：\d銘柄（10銘柄未満のため率は非表示）$/);
      expect(lineOf('breakout', '早期')).toBe('早期（上抜け後5営業日・独自）：3件（5件未満のため率は非表示）');
    }
    if (key === 'malformed') {
      expect(lineOf('dist', STALLING_HEAD)).toBe(`${STALLING_HEAD}：S&P 算出不可（ストーリング日の形式を確認できません）／NAS 0日`);
      // The distribution count beside it stays.
      if (phone) await page.getByRole('tab', { name: /^指数/ }).click();
      await expect(distRow(page).locator('.brief-ftd-row b')).toHaveText(['3日', '4日']);
    }
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
