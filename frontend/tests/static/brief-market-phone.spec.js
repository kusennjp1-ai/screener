// Daily brief market tab on phones: the verdict and the chart, the tab's secondary text and its words at
// 320px, on synthetic data.
import { test, expect } from '@playwright/test';
import { date, marketTrends, openBrief, sessions, VIEWPORTS, horizontalOverflow } from './brief-fixture.js';
import { indexState } from '../../tools/export-market-trends.mjs';

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
/** The market budget (1300, brief-compact.spec.js) less the 12px of headroom every track keeps (plan §1 rule 9, §3). */
const MARKET_LINE = 1288;
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
    // The market line: the 1300 budget less the 12px of headroom (plan §3).
    expect(await page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY))).toBeLessThanOrEqual(MARKET_LINE);
    const market = page.getByRole('region', { name: '地合い' });
    const verdict = market.getByTestId('brief-regime'), basis = verdict.locator('details.brief-exposure-basis'), study = market.locator('details.brief-regime-ref');
    const howto = study.locator('details.brief-regime-howto');
    for (const locator of [verdict, verdict.locator('.brief-exposure'), basis, market.getByRole('group', { name: '注意サイン（独自判定）' }), page.getByRole('tab').first()]) {
      const box = await locator.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(756);
    }
    // The Nasdaq is on a rally attempt while the verdict is positive: the summary names the fold and the note's short form.
    await expect(basis.locator('summary')).toHaveText('目安と判定の基準・Nasdaqは反発3日目（判定はSPYのみ）');
    // Each fold, the nested 「読み方と出典」 too, is a 44–48px summary that opens and closes by keyboard.
    for (const fold of [basis, study, howto]) {
      await expect(fold).not.toHaveAttribute('open', '');
      const height = (await fold.locator(':scope > summary').boundingBox()).height;
      expect(height).toBeGreaterThanOrEqual(44);
      expect(height).toBeLessThanOrEqual(48);
      await fold.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      await expect(fold).toHaveAttribute('open', '');
      await page.keyboard.press('Space');
      await expect(fold).not.toHaveAttribute('open', '');
      await page.keyboard.press('Enter');
    }
    await expect(howto.locator('summary')).toHaveText('読み方と出典（予測ではありません）');
    await expect(howto).toContainText('出典：market-regime-study-v2');
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
    expect(await contentHeight(page)).toBeLessThanOrEqual(MARKET_LINE);
    const market = page.getByRole('region', { name: '地合い' });
    for (const locator of [market.getByTestId('brief-regime'), market.getByRole('group', { name: '注意サイン（独自判定）' }), page.getByRole('tab').first()]) {
      const box = await locator.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(756);
    }
    // No row of its own on a phone: the figures are the first line of the Nasdaq block inside the (closed) fold.
    await expect(market.locator('.brief-index-nas')).toHaveCount(0);
    const study = market.locator('details.brief-regime-ref');
    await expect(study).not.toHaveAttribute('open', '');
    await study.locator(':scope > summary').click();
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
    expect(await contentHeight(page)).toBeLessThanOrEqual(MARKET_LINE);
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
    // Read the boxes once the card's finite entrance has finished (mid-rise a box can read 43.99998px).
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => null))));
    // The guide's fold keeps a 44–48px summary even with the Nasdaq note in it.
    const basis = (await market.locator('details.brief-exposure-basis > summary').boundingBox()).height;
    expect(basis).toBeGreaterThanOrEqual(44);
    expect(basis).toBeLessThanOrEqual(48);
    for (const summary of await market.locator('details.brief-regime-ref > summary, details.brief-exposure-basis > summary, details.brief-regime-howto > summary').all()) await summary.click();
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

// ---- Round 2 (market track): the S&P／Nasdaq switch, the FTD-upgrade basis, 参考 counted apart, the scale chips ------------
const FTD_METHOD = 'rally-attempt-gain1.2-day4-15-decline6-v1';
/**
 * What the round-2 exporter publishes: each index's closes (the same bars as its distribution series, plan §2.3), the
 * Nasdaq's position on those closes (the exporter's own indexState, so the figures describe the line drawn), and, with
 * `state`, the Nasdaq's follow-through record on its last session in that state ('correction', 'attempt_expired').
 */
const withCloses = ({ correction = false, state = correction ? 'correction' : null } = {}) => ({ trends: value => {
  for (const index of value.indices) index.method = DD_METHOD;
  const sp = value.long_history.sp500;
  for (const [i, item] of value.indices.entries()) {
    const days = item.points.map(point => point.date), n = days.length;
    item.closes = days.map((day, k) => ({ date: day, close: i === 0 ? sp.find(point => point.date === day).close : Math.round((16000 + k * 12 - (k > n - 30 ? (k - n + 30) * 45 : 0)) * 100) / 100 }));
  }
  const nas = value.indices[1], last = nas.points.at(-1).date;
  nas.state = indexState(nas.closes, last);
  if (state) nas.followThrough = { available: true, method: FTD_METHOD, asOf: last, state, peak: { date: nas.points.at(-30).date, close: 19300 }, low: state === 'attempt_expired' ? { date: nas.points.at(-20).date, low: 16900 } : null, declinePct: 8.2,
    attempt: state === 'attempt_expired' ? { startDate: nas.points.at(-19).date, day: 19 } : null, ftd: null, failedDate: null, events: [] };
} });
/** Several mutators of one kind applied in turn (a variant built from the parts below). */
const compose = (...parts) => Object.fromEntries([...new Set(parts.flatMap(Object.keys))].map(key => [key, value => { for (const part of parts) part[key]?.(value); }]));
/** An FTD-upgraded uptrend: the rows' regime confirmed_uptrend while SPY is under its 50-day line, and the regime's block (market_context). */
const ftdUpgraded = { rows: rows => { for (const row of rows) row.market_above_50dma = false; },
  manifest: value => { value.markets.US.market_context = { as_of_date: date, regime: 'confirmed_uptrend', distribution_days: 1, ftd_date: sessions.at(-8), ftd_days_since: 7, exposure_pct: 40, guard: null, method: 'backend-market-regime-v1', source: 'scan-rows' }; } };
/** A 50日線割れ market that is no FTD upgrade: the rows' regime is a correction under the 50-day line. */
const belowFiftyRows = { rows: rows => { for (const row of rows) { row.market_above_50dma = false; row.market_regime = 'correction'; } } };
/**
 * The long history's ^GSPC under its 50-day line and above its 200-day line, as the rows say, so the verdict's scan input
 * and the figures agree (no basis-conflict line): the last 3 closes 4% lower, and the 200-day window's older part 10% lower.
 */
const belowFiftyIndex = { trends: value => { const sp = value.long_history.sp500, n = sp.length; sp.forEach((point, i) => { if (i >= n - 3) point.close = Math.round(point.close * 96) / 100; else if (i >= n - 200 && i < n - 50) point.close = Math.round(point.close * 90) / 100; }); } };
/** No sign fires: new lows never outnumber new highs. */
const noSign = { trends: value => { for (const row of value.long_history.breadth) row.newLows = 1; } };
const pct = value => { const r = Number(value.toFixed(1)); return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toFixed(1)}%`; };
const md = day => day.slice(5).split('-').map(Number).join('/');
/** The Nasdaq's figures as a phone's switch prints them, from the position the variant publishes (the exporter's indexState). */
const nasdaqFigures = (mutate, options = {}) => {
  const state = JSON.parse(marketTrends({ ...options, mutate: mutate.trends }).text).indices[1].state;
  return `終値${state.close.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${md(state.date)}1年高値から${pct(state.fromHigh)}50日線比${pct(state.vs50)}200日線比 ${pct(state.vs200)}`;
};
const lead = async page => { const market = page.getByRole('region', { name: '地合い' }); return Math.max(...await Promise.all([market.getByTestId('brief-regime'), market.getByRole('group', { name: '注意サイン（独自判定）' }), page.getByRole('tab').first()].map(async locator => { const box = await locator.boundingBox(); return box.y + box.height; }))); };
/** A hyphen-minus right before a digit, outside ISO dates (2026-10-02) and tickers: negative figures use U+2212. */
const asciiMinus = page => page.locator('#brief-main').evaluate(node => (node.innerText.match(/(?<![0-9A-Za-z])-\d[\d,.]*/g) || []));

test.describe('round 2 at 375×812: the market line and the lead in every variant', () => {
  test.use({ ...phone(375, 812), contextOptions: { reducedMotion: 'reduce' } });
  const variants = [['the base data', {}], ['one session behind', { historyEnd: sessions.at(-2) }], ['the Nasdaq closes', { mutate: withCloses() }], ['one session behind with the Nasdaq closes', { historyEnd: sessions.at(-2), mutate: withCloses() }]];
  for (const [name, options] of variants) test(`with ${name}: within ${MARKET_LINE}, the lead above 756px, no ASCII minus`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', options);
    await expect(page.locator('.market-history-explorer svg').first()).toBeAttached();
    await settled(page);
    expect(await contentHeight(page)).toBeLessThanOrEqual(MARKET_LINE);
    expect(await lead(page)).toBeLessThanOrEqual(756);
    // The warning summary keeps one line for its headline, its date included (〔参考〕 counted apart).
    const head = page.getByRole('group', { name: '注意サイン（独自判定）' }).locator(':scope > b');
    expect(Math.round((await head.boundingBox()).height)).toBeLessThanOrEqual(20);
    expect(await asciiMinus(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('round 2 at 375×812: the Nasdaq in correction with its closes published', () => {
  test.use({ ...phone(375, 812), contextOptions: { reducedMotion: 'reduce' } });
  test('the 指数 panel switches to the Nasdaq (44px targets), and the guide\'s fold names the correction', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', { mutate: withCloses({ correction: true }) });
    const market = page.getByRole('region', { name: '地合い' });
    const switcher = market.getByRole('group', { name: '表示する指数' });
    // Two short 44px targets beside the 指数 heading, each read out by its full name.
    await expect(switcher.getByRole('button')).toHaveText(['S&P', 'NAS']);
    expect(await switcher.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))).toEqual(['S&P 500', 'Nasdaq総合（NAS）']);
    for (const button of await switcher.getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    const head = await market.locator('.brief-env-group.is-index > .brief-env-head').boundingBox(), heading = await market.getByRole('heading', { level: 3, name: '指数のトレンド' }).boundingBox();
    const box = await switcher.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(head.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(head.y + head.height + 1);
    expect(box.x).toBeGreaterThan(heading.x + heading.width);
    await expect(switcher.getByRole('button', { name: 'S&P 500' })).toHaveAttribute('aria-pressed', 'true');
    await expect(market.getByRole('img', { name: /^S&P 500 の終値と50日線・200日線/ })).toBeAttached();
    // The verdict, its tone and its cap stay SPY's; the note says the Nasdaq is in correction (MK3).
    await expect(market.getByTestId('brief-regime')).toContainText('上昇トレンド（独自判定）新規の買いを検討できます。エクスポージャーの目安最大 50%');
    await expect(market.locator('details.brief-exposure-basis > summary')).toHaveText(/^目安と判定の基準・Nasdaqは調整中（判定はSPYのみ）$/);
    await settled(page);
    const before = await contentHeight(page);
    await switcher.getByRole('button', { name: 'Nasdaq総合' }).click();
    await expect(switcher.getByRole('button', { name: 'Nasdaq総合' })).toHaveAttribute('aria-pressed', 'true');
    // The exporter's figures of the line's last bar; the pressed button names the index, so the cell reads 終値.
    await expect(market.getByRole('group', { name: /^Nasdaq総合（\^IXICの日足、10\/2）$/ })).toHaveText(nasdaqFigures(withCloses({ correction: true })));
    await expect(market.getByRole('img', { name: /^Nasdaq総合 の終値と50日線・200日線（\d+\/\d+〜）（.*〜2026-10-02）。有効な分配日 4日。目盛り [\d,]+〜[\d,]+$/ })).toBeVisible();
    await expect(market.locator('.brief-index-legend .is-close')).toHaveCount(0);
    await expect(market.locator('.brief-index-legend .is-ma200')).toHaveText(/^200日線（\d+\/\d+〜）$/);
    // The switch replaces the S&P's figures and chart; it adds nothing beside them.
    await expect(market.getByRole('group', { name: /^S&P 500（/ })).toHaveCount(0);
    await settled(page);
    expect(Math.abs(await contentHeight(page) - before)).toBeLessThanOrEqual(1);
    // The Nasdaq's figures are in the switch now, never repeated inside 過去の傾向.
    await market.locator('details.brief-regime-ref > summary').click();
    await expect(market.locator('.brief-regime-nas')).toHaveCount(0);
    // The choice is kept for the session.
    await page.reload();
    await expect(page.getByRole('region', { name: '地合い' }).getByRole('group', { name: '表示する指数' }).getByRole('button', { name: 'Nasdaq総合' })).toHaveAttribute('aria-pressed', 'true');
    expect(await asciiMinus(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('round 2 at 375×812: an FTD-upgraded uptrend', () => {
  test.use({ ...phone(375, 812), contextOptions: { reducedMotion: 'reduce' } });
  test('says inside 目安と判定の基準 why the guide stays 0%, dated from the regime block, with the label and the cap unchanged', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', { mutate: ftdUpgraded });
    const market = page.getByRole('region', { name: '地合い' });
    const verdict = market.getByTestId('brief-regime');
    await expect(verdict).toContainText('50日線割れ（弱含み・独自判定）');
    await expect(verdict.locator('.brief-exposure b')).toHaveText('0%');
    const basis = verdict.locator('details.brief-exposure-basis');
    // The line is inside the closed fold: the lead keeps its height.
    await expect(page.locator('.market-history-explorer svg').first()).toBeAttached();
    await settled(page);
    expect(await lead(page)).toBeLessThanOrEqual(756);
    await basis.locator(':scope > summary').click();
    const md = sessions.at(-8).slice(5).split('-').map(Number).join('/');
    // The regime's FTD (SPY, the block's date) and the tab's own ^GSPC record (its FTD on another day) are each attributed.
    const gspc = sessions.at(-36).slice(5).split('-').map(Number).join('/');
    await expect(market.locator('.brief-env-row').filter({ has: page.locator('small', { hasText: 'フォロースルーデー' }) })).toContainText(`確認 ${gspc}`);
    await expect(basis.locator('p')).toHaveText(['根拠（10/2スキャン時点）：S&P 500（SPY）の終値が50日線の下', `局面判定はSPYのFTD（${md}）による上昇トレンド。^GSPCの日足ではFTD ${gspc}。この目安はSPYが50日線の下のため0%（独自判定）`, /^独自の目安：/]);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

for (const theme of ['dark', 'light']) test.describe(`round 2: the index scale labels in the ${theme} theme`, () => {
  test.use({ ...phone(375, 812), colorScheme: theme });
  test('sit on an opaque chip of the card\'s surface, at 12px', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', { storage: { 'screener:color-mode': theme } });
    const labels = page.getByRole('region', { name: '地合い' }).locator('.brief-index-scale');
    await expect(labels).toHaveCount(2);
    for (const label of await labels.all()) {
      const [chip, surface, size, shadow] = await label.evaluate(node => [getComputedStyle(node).backgroundColor, getComputedStyle(node.closest('.brief-card')).backgroundColor, getComputedStyle(node).fontSize, getComputedStyle(node).textShadow]);
      expect(chip).toBe(surface);
      expect(chip).not.toBe('rgba(0, 0, 0, 0)');
      expect([size, shadow]).toEqual(['12px', 'none']);
    }
    expect(errors).toEqual([]);
  });
});

for (const width of [320, 375, 414]) test.describe(`round 2 at ${width}px: the switch, the folds and the 参考 count`, () => {
  test.use(phone(width, 812));
  test('stay within the width with the Nasdaq shown and every fold open', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', { mutate: withCloses({ correction: true }) });
    const market = page.getByRole('region', { name: '地合い' });
    await market.getByRole('group', { name: '表示する指数' }).getByRole('button', { name: 'Nasdaq総合' }).click();
    for (const summary of await market.locator('details.brief-regime-ref > summary, details.brief-exposure-basis > summary, details.brief-regime-howto > summary').all()) await summary.click();
    await expect(market.locator('details.brief-regime-howto')).toHaveAttribute('open', '');
    // The 〔参考〕 sign is counted apart: neutral ○, no ▲ on the section tab.
    await expect(market.getByRole('group', { name: '注意サイン（独自判定）' }).locator(':scope > b')).toHaveText('注意 0件・参考 1件（独自判定）');
    await expect(page.getByRole('tab', { name: /^参加度/ })).not.toContainText('▲');
    expect(await horizontalOverflow(page)).toBe(0);
    const frame = await market.locator('.brief-index-frame').boundingBox();
    for (const mark of await market.locator('.brief-index-mark, .brief-index-mark-label, .brief-index-scale').all()) {
      const box = await mark.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(frame.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
    }
    expect(await asciiMinus(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// ---- Round 2 (market track): the switch replaces content in every state; 参考 checks alone never read 0件 ---------------
test.describe('round 2 at 375×812: the S&P／Nasdaq switch replaces content in every state', () => {
  test.use({ ...phone(375, 812), contextOptions: { reducedMotion: 'reduce' } });
  const variants = [
    ['an open guide with no sign fired', noSign, /^上昇トレンド（独自判定）/],
    ['a 0% guide under the 50-day line', compose(belowFiftyRows, belowFiftyIndex), /^50日線割れ（弱含み・独自判定）/],
    ['an FTD-upgraded uptrend under the 50-day line', compose(ftdUpgraded, belowFiftyIndex), /^50日線割れ（弱含み・独自判定）/],
  ];
  for (const [name, state, label] of variants) for (const [when, options] of [['current', {}], ['one session behind', { historyEnd: sessions.at(-2) }]]) {
    test(`${name}, ${when}: no taller with the Nasdaq's closes, within ${MARKET_LINE}, the lead above 756px`, async ({ page, context }) => {
      // The same state without the closes (no switch), on a page of its own.
      const before = await context.newPage();
      await openBrief(before, '#/brief/market', { ...options, mutate: state });
      await expect(before.locator('.market-history-explorer svg').first()).toBeAttached();
      await settled(before);
      const without = await contentHeight(before);
      await before.close();
      const { errors } = await openBrief(page, '#/brief/market', { ...options, mutate: compose(state, withCloses()) });
      await expect(page.locator('.market-history-explorer svg').first()).toBeAttached();
      const market = page.getByRole('region', { name: '地合い' });
      await expect(market.getByRole('group', { name: '表示する指数' })).toBeVisible();
      await expect(market.getByTestId('brief-regime').locator('strong')).toHaveText(label);
      // The long history's ^GSPC agrees with the rows: no basis-conflict line.
      await expect(market.locator('.brief-index-source.is-conflict')).toHaveCount(0);
      await settled(page);
      const height = await contentHeight(page);
      expect(height).toBeLessThanOrEqual(without);
      expect(height).toBeLessThanOrEqual(MARKET_LINE);
      expect(await lead(page)).toBeLessThanOrEqual(756);
      expect(await asciiMinus(page)).toEqual([]);
      expect(await horizontalOverflow(page)).toBe(0);
      expect(errors).toEqual([]);
    });
  }
});

test.describe('round 2 at 375×812: the index series unavailable while the long history is valid', () => {
  test.use({ ...phone(375, 812), contextOptions: { reducedMotion: 'reduce' } });
  const unavailable = { trends: value => {
    for (const item of value.indices) Object.assign(item, { available: false, points: [], events: [], latest: null, lastObserved: null, followThrough: { available: false, method: FTD_METHOD, reason: '指数OHLCVに欠測・重複・不正値があります。' } });
  } };
  test('the warning summary says the warnings are 判定不可: the 参考 sign is counted apart, never 注意 0件 or 注意サインなし', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', { mutate: unavailable });
    await expect(page.locator('.market-history-explorer svg').first()).toBeAttached();
    const signals = page.getByRole('group', { name: '注意サイン（独自判定）' });
    // Every breadth check is 〔参考〕 under the committed reference; the four index checks are the ones not judged. One line.
    await expect(signals.locator(':scope > b')).toHaveText('注意 判定不可・参考 1件（独自判定）');
    expect(Math.round((await signals.locator(':scope > b').boundingBox()).height)).toBeLessThanOrEqual(20);
    await expect(signals).toContainText('判定していない項目');
    await expect(signals).not.toContainText(/注意 0件|注意サインなし/);
    await settled(page);
    expect(await contentHeight(page)).toBeLessThanOrEqual(MARKET_LINE);
    expect(await lead(page)).toBeLessThanOrEqual(756);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
  test('with no 参考 sign fired either, it says so without a count', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief/market', { mutate: compose(unavailable, noSign) });
    await expect(page.getByRole('group', { name: '注意サイン（独自判定）' }).locator(':scope > b')).toHaveText('注意サインを判定できません（独自判定）');
    expect(errors).toEqual([]);
  });
});

for (const [width, height] of [[375, 812], [320, 640]]) test.describe(`round 2 at ${width}px: an expired Nasdaq rally attempt (15 sessions, no FTD)`, () => {
  test.use({ ...phone(width, height), contextOptions: { reducedMotion: 'reduce' } });
  for (const [when, options, at] of [['current', {}, ''], ['one session behind', { historyEnd: sessions.at(-2) }, '10/1時点・']]) {
    // At 320px one session behind every Nasdaq note's summary takes a third line (step 0's rally attempt too): there it is
    // held to the rally attempt's own height in the same variant.
    const third = width === 320 && at;
    test(`${when}: the guide's fold names the correction, its summary ${third ? 'no taller than a rally attempt\'s' : '44–48px'}${width === 375 ? ', the lead above 756px' : ''}`, async ({ page, context }) => {
      let attemptHeight = null;
      if (third) {
        const other = await context.newPage();
        await openBrief(other, '#/brief/market', options);
        attemptHeight = (await other.getByTestId('brief-regime').locator('details.brief-exposure-basis > summary').boundingBox()).height;
        await other.close();
      }
      const { errors } = await openBrief(page, '#/brief/market', { ...options, mutate: withCloses({ state: 'attempt_expired' }) });
      await expect(page.locator('.market-history-explorer svg').first()).toBeAttached();
      const summary = page.getByTestId('brief-regime').locator('details.brief-exposure-basis > summary');
      // The fold's short form is a correction's (the fold says 「15日以内のFTDなし」 inside), so the summary keeps 2 lines.
      await expect(summary).toHaveText(`目安と判定の基準・Nasdaqは調整中（${at}判定はSPYのみ）`);
      await settled(page);
      const box = await summary.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeLessThanOrEqual(third ? attemptHeight : 48);
      if (width === 375) {
        expect(await contentHeight(page)).toBeLessThanOrEqual(MARKET_LINE);
        expect(await lead(page)).toBeLessThanOrEqual(756);
      }
      expect(await horizontalOverflow(page)).toBe(0);
      expect(errors).toEqual([]);
    });
  }
});
