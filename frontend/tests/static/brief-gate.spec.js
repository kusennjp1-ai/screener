// Today's gate card (plan S1-P4) in every market state of plan S1-P2's table, at 320 / 375 / 390 and 1440 px, on synthetic
// data: the first fold (the fold closed) carries the answer, the labelled figure and its definition, one 根拠 line, each unmet
// or unknown condition by name, the sign line, Today's note and the status alert; nothing reads 0% / 未達 / 達成 while the
// market is unknown or loading; a newer closed session with an open guide never reads 検討; type sizes (D19), text inks (D17)
// and contrast in both themes. The states are opened with the specs' own mutators, copied with their source lines.
import { test, expect } from '@playwright/test';
import { openBrief, sessions, horizontalOverflow, VIEWPORTS } from './brief-fixture.js';

const phone = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const WIDTHS = { 320: phone(320, 640), 375: phone(375, 812), 390: VIEWPORTS.phone, 1440: VIEWPORTS.desktop };
// brief-market-r3.spec.js:60-61
const ftdUpgraded = { rows: rows => { for (const row of rows) row.market_above_50dma = false; },
  manifest: value => { value.markets.US.market_context = { as_of_date: '2026-10-02', regime: 'confirmed_uptrend', distribution_days: 1, ftd_date: sessions.at(-8), ftd_days_since: 7, exposure_pct: 40, guard: null, method: 'backend-market-regime-v1', source: 'scan-rows' }; } };
// brief-market-r3.spec.js:63
const belowFiftyIndex = { trends: value => { const sp = value.long_history.sp500, n = sp.length; sp.forEach((point, i) => { if (i >= n - 3) point.close = Math.round(point.close * 96) / 100; else if (i >= n - 200 && i < n - 50) point.close = Math.round(point.close * 90) / 100; }); } };
// brief-market-r3.spec.js:65-66
const below200 = { rows: rows => { for (const row of rows) { row.market_above_200dma = false; row.market_regime = 'correction'; } },
  trends: value => { const sp = value.long_history.sp500, n = sp.length; sp.forEach((point, i) => { if (i >= n - 10) point.close = Math.round(point.close * 85) / 100; }); } };
// brief-market-r3.spec.js:291
const ftdAgo = n => ({ trends: value => { const dates = value.indices[0].points.map(point => point.date), ft = value.indices[0].followThrough; ft.ftd = { ...ft.ftd, date: dates.at(-1 - n), sessionsSince: n }; } });
// brief-market-r3.spec.js:295
const below50Rows = { rows: rows => { for (const row of rows) { row.market_above_50dma = false; row.market_regime = 'correction'; } } };
// brief-market-r3.spec.js:383-384 (with d = 2: the FTD conflict of brief-market-phone.spec.js:395-398)
const gspcRally = d => ({ trends: value => { const dates = value.indices[0].points.map(point => point.date), last = dates.length - 1;
  Object.assign(value.indices[0].followThrough, { state: 'rally_attempt', low: { date: dates[last - d], low: 4980 }, attempt: { startDate: dates[last - d + 1], day: d }, ftd: null, events: [] }); } });
// brief-market.spec.js:394
const pressure = { rows: rows => { for (const row of rows) row.market_regime = 'uptrend_under_pressure'; } };
// Above both lines under a regime outside the two uptrends (新規購入を抑制), and every row's 50-day field missing (市場未確認).
const restrain = { rows: rows => { for (const row of rows) row.market_regime = 'correction'; } };
const partUnknown = { rows: rows => { for (const row of rows) row.market_above_50dma = null; } };
const compose = (...parts) => Object.fromEntries([...new Set(parts.flatMap(Object.keys))].map(key => [key, value => { for (const part of parts) part[key]?.(value); }]));

// The states of plan S1-P2's table: how each opens, and what its gate says (cap: the figure, or null when there is none).
const STATES = {
  m50: { open: {}, cap: '最大50%', headline: '新規の買いを検討できる' },
  m25: { open: { mutate: pressure }, cap: '最大25%', headline: '新規の買いを検討できる' },
  below50: { open: { mutate: below50Rows }, cap: '0%', headline: '買いは控える', conditions: ['SPY終値が50日線の上：未達', '局面判定が上昇トレンド／上昇に圧力：未達（いま 調整）'] },
  ftd: { open: { mutate: compose(ftdUpgraded, belowFiftyIndex) }, cap: '0%', headline: '買いは控える', conditions: ['SPY終値が50日線の上：未達'], sign: /^前回のFTD \d+\/\d+（参考・目安は 0%のまま：SPYが50日線の下）$/ },
  ftd5: { open: { mutate: compose(ftdUpgraded, belowFiftyIndex, ftdAgo(5)) }, cap: '0%', headline: '買いは控える', conditions: ['SPY終値が50日線の上：未達'], sign: /^FTD確認済み（参考・目安は 0%のまま：SPYが50日線の下）$/ },
  below200: { open: { mutate: below200 }, cap: '0%', headline: '買いは控える' },
  restrain: { open: { mutate: restrain }, cap: '0%', headline: '買いは控える', conditions: ['局面判定が上昇トレンド／上昇に圧力：未達（いま 調整）'] },
  lag1: { open: { historyEnd: sessions.at(-2) }, cap: '最大50%', headline: '新規の買いを検討できる', note: '市場の集計は10/1時点（10/2分は再集計待ち）', sign: /^サイン：未確認（10\/2分は再集計待ち）$/ },
  series404: { open: { fail: 'series' }, cap: '最大50%', headline: '新規の買いを検討できる', alert: '市場推移データを取得できません（配信ファイルが見つかりません）。市場推移の数値は表示しません。' },
  // The unknown headline names what is unknown (modelMarket's label; the S1 critics' round), never a bare 「買いは見送り」.
  manifest503: { open: { fail: 'manifest' }, cap: null, headline: '市場未確認・買いは見送り', unknown: true },
  partunk: { open: { mutate: partUnknown }, cap: null, headline: '市場未確認・買いは見送り', unknown: true },
  ftdconflict: { open: { mutate: compose(ftdUpgraded, belowFiftyIndex, gspcRally(2)) }, cap: '0%', headline: '買いは控える', conflict: '^GSPCの日足ではFTD未確認' },
  basisconflict: { open: { mutate: ftdUpgraded }, cap: '0%', headline: '買いは控える', conflict: '一致していません' },
};
const PENDING = '2026-10-05T20:10:00Z', LATE = '2026-10-07T09:00:00Z';

const region = page => page.getByRole('region', { name: '地合い', exact: true });
const settle = page => page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => null))));
/** The region's text with its fold closed (a closed details keeps its body in the DOM: it is left out), and the fold's body. */
const read = page => region(page).evaluate(node => {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('details:not([open]) > .brief-expander-body').forEach(body => body.remove());
  const pick = selector => node.querySelector(selector)?.textContent ?? null;
  return { first: copy.textContent, all: node.textContent, headline: pick('.brief-gate-headline'), figure: pick('.brief-gate-figure'), basis: pick('.brief-gate-basis'), basisFull: pick('.brief-gate-basis-full'),
    conds: [...node.querySelectorAll('.brief-gate-conds li')].map(li => li.textContent), sign: pick('.brief-gate-sign'), kicker: pick('.brief-gate-kicker'),
    fold: pick('.brief-gate-more > .brief-expander-body') ?? pick('.brief-gate-fold'), summary: pick('.brief-gate-more > summary'),
    tt: [...node.querySelectorAll('small')].filter(small => /^TT達成/.test(small.textContent)).length };
});
async function open(page, input, { at = null, storage } = {}) {
  const result = await openBrief(page, '#/brief', { ...input, storage });
  if (at) { await page.clock.setFixedTime(new Date(at)); await page.reload(); }
  await expect(region(page)).toBeVisible();
  if (!input.fail) await expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate').first()).toBeVisible();
  // A failed publication settles once its query gives up: the gate leaves its loading state (data-gate).
  else await expect(region(page)).not.toHaveAttribute('data-gate', 'loading', { timeout: 30000 });
  await settle(page);
  return result;
}

for (const [width, device] of Object.entries(WIDTHS)) test.describe(`the gate card at ${width}px`, () => {
  test.use(device);
  const wide = width === '1440';
  for (const [id, s] of Object.entries(STATES)) test(`${id}: the first fold carries every rule-bearing line, the rest in the fold`, async ({ page }) => {
    const { errors } = await open(page, s.open);
    const r = await read(page);
    // One region named 地合い; no count of conditions anywhere; no ASCII minus before a digit; no 検討可 tile form.
    await expect(page.getByRole('region', { name: '地合い', exact: true })).toHaveCount(1);
    expect(r.all).not.toMatch(/条件中|目安≤|-\d/);
    if (!wide) {
      expect(r.headline).toBe(s.unknown ? s.headline : `${s.headline}（独自判定）`);
      // Without a publication (the manifest failed) there is no analysis date: the kicker names the subject alone.
      expect(r.kicker).toBe(s.open.fail === 'manifest' ? '地合い市場の詳細 ›' : '地合い・10/2（金）引け市場の詳細 ›');
    } else {
      await expect(region(page).getByTestId('brief-regime')).toBeVisible();
      await expect(region(page).locator('details')).toHaveCount(0);
    }
    if (s.cap) {
      // The figure always with its label (独自設定) and its definition, in the first fold.
      expect(r.figure).toBe(`新規買いの目安（独自設定）${s.cap}`);
      expect(r.first).toContain(`${s.cap}＝新規建ての上限（口座比・独自設定）`);
      // One 根拠 line: on a phone its short form (ledger step 3: no scan stamp, SPY) with the market tab's words in the fold;
      // wider, the market tab's words in its place and no second copy.
      if (!wide) {
        expect(r.basis).toMatch(/^根拠：SPY(?!.*スキャン時点).+（実測）$/);
        expect(r.basisFull).toMatch(/^根拠（10\/2スキャン時点）：S&P 500（SPY）.+（実測）$/);
      } else {
        expect(r.basis).toMatch(/^根拠（10\/2スキャン時点）：S&P 500（SPY）.+（実測）$/);
        expect(r.basisFull).toBeNull();
      }
    } else {
      // Unknown: no figure; no % in the first fold; never 0%, 未達 or a met condition (達成) anywhere on the card (the facts'
      // own values, 「61.0%」 or the label 「TT達成数」, are not the guide); the conditions read 未確認.
      expect(r.figure).toBeNull();
      if (!wide) expect(r.first).not.toMatch(/%|未達|達成|新規建ての上限/);
      expect(r.all).not.toMatch(/未達|(^|[^\d.])0%|新規建ての上限|：達成/);
      await expect(region(page).locator('.brief-gate-met')).toHaveCount(0);
      expect(r.conds).toEqual(['再開の条件：未確認']);
    }
    for (const condition of s.conditions ?? []) expect(r.conds).toContain(condition);
    if (s.cap && s.cap !== '0%') expect(r.conds).toEqual([]);
    if (s.sign) expect(r.sign).toMatch(s.sign);
    if (s.note) {
      await expect(region(page).getByRole('note')).toHaveText(s.note);
      await expect(region(page).getByRole('note')).toBeVisible();
    }
    if (s.alert) {
      await expect(region(page).getByRole('alert')).toHaveText(s.alert);
      await expect(region(page).getByRole('alert')).toBeVisible();
    }
    if (s.conflict) {
      expect(r.basis).toContain('（指数の履歴と不一致・下に詳細）');
      if (!wide) expect(r.basisFull).toContain('（指数の履歴と不一致・下に詳細）');
      expect(r.fold).toContain(s.conflict);
      if (!wide) expect(r.first).not.toContain(s.conflict);
    }
    // The facts are in the fold: TT達成 once; the ○ 参考 lines and 未検証 never in the closed first fold.
    expect(r.tt).toBe(1);
    if (!wide) {
      for (const words of ['分配日（25日）', 'TT達成数', '○', '未検証']) expect(r.first).not.toContain(words);
      await region(page).locator('.brief-gate-more > summary').click();
      for (const group of ['根拠（指数側）', '広がり（参考）', '銘柄側（参考・目安は変えません）']) await expect(region(page).getByRole('group', { name: group })).toBeVisible();
    }
    // The IBD line stays outside the fold, last.
    await expect(region(page).locator(':scope > .brief-note').last()).toHaveText('地合いの判定・各集計・RS推計は公開日足からの独自判定・独自集計で、IBDの公式値ではありません。');
    await expect(region(page).locator(':scope > .brief-note').last()).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('loading: no figure, no %, never 未達 or 達成', async ({ page }) => {
    await openBrief(page, '#/brief');
    // Hold the research bundle (the verdict's rows) after the page has its routes: the reload shows the loading state.
    await page.route('**/static-data/**/research.json', () => {});
    await page.reload();
    await expect(region(page)).toBeVisible();
    await expect(region(page)).toHaveAttribute('data-gate', 'loading');
    const r = await read(page);
    if (!wide) expect(r.first).not.toMatch(/%|未達|達成|新規建ての上限/);
    expect(r.all).not.toMatch(/未達|(^|[^\d.])0%|新規建ての上限|：達成/);
    expect(r.figure).toBeNull();
    if (!wide) expect(r.headline).toBe('読込中');
  });
});

// A newer session has closed (plan D18): pending (10 minutes after the 10/5 close) and late (two sessions later), at 50%, 25%
// and 0%. The bar's own date line is brief-freshness.spec.js's.
for (const [width, device] of Object.entries({ 320: WIDTHS[320], 390: WIDTHS[390], 1440: WIDTHS[1440] })) test.describe(`a newer closed session at ${width}px`, () => {
  test.use(device);
  const wide = width === '1440';
  for (const [clock, at] of [['pending', PENDING], ['late', LATE]]) for (const id of ['m50', 'm25', 'below50']) test(`${clock} at ${id}`, async ({ page }) => {
    const s = STATES[id];
    const { errors } = await open(page, s.open, { at });
    const r = await read(page);
    expect(r.all).not.toMatch(/検討できる|検討可/);
    if (s.cap === '0%') {
      if (!wide) expect(r.headline).toBe('買いは控える（独自判定）');
      expect(r.figure).toBe('新規買いの目安（独自設定）0%');
    } else {
      if (!wide) expect(r.headline).toBe('10/2時点の判定・更新待ち（独自判定）');
      else await expect(region(page).getByTestId('brief-regime')).toContainText('10/2引け時点の判定です。新しい公開を待っています（買いの検討は最新の判定で）');
      expect(r.figure).toBe(`新規買いの目安（10/2時点・独自設定）${s.cap}`);
    }
    if (!wide) {
      const age = region(page).locator('.brief-gate-kicker .is-warn');
      if (clock === 'late') {
        // The age is fully visible in the warning tone: in the viewport, not clipped. Its 「・」 ends the date's run (so a wrapped
        // age starts its line with its number: the S1 critics' round).
        await expect(age).toHaveText('2営業日前');
        await expect(region(page).locator('.brief-gate-kicker .numeric:not(.is-warn)')).toHaveText('・10/2（金）引け・');
        await expect(age).toBeInViewport({ ratio: 1 });
        expect(await age.evaluate(node => node.scrollWidth <= node.clientWidth + 0.5)).toBe(true);
      } else await expect(age).toHaveCount(0);
    }
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

for (const [width, device] of Object.entries({ 390: WIDTHS[390], 1440: WIDTHS[1440] })) test.describe(`the 根拠 words at ${width}px`, () => {
  test.use(device);
  // On a phone the market tab's words are the fold's 根拠 line (the first fold has the short form); wider, the line itself.
  for (const id of ['m50', 'm25', 'below50', 'below200', 'restrain', 'ftdconflict']) test(`are the 市場 tab's in ${id}`, async ({ page }) => {
    await open(page, STATES[id].open);
    const r = await read(page);
    const basis = (width === '1440' ? r.basis : r.basisFull).replace(/（実測）$/, '').replace('（指数の履歴と不一致・下に詳細）', '');
    await page.getByRole('navigation', { name: 'ブリーフの画面' }).getByRole('link', { name: '市場' }).click();
    const tab = page.getByRole('region', { name: '地合い', exact: true });
    await expect(tab.locator('.brief-verdict-why').first()).toBeAttached();
    expect(await tab.locator('.brief-verdict-why').first().evaluate(node => node.textContent)).toBe(basis);
  });
});

// D19 sizes, D17 inks and contrast, in both themes, on the 0%, 50%, unknown and late states (390px).
const INKS = ['--text', '--text-2', '--text-3'];
const luminance = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const theme of ['light', 'dark']) test.describe(`the gate's type, inks and contrast in the ${theme} theme`, () => {
  test.use(WIDTHS[390]);
  for (const [id, at] of [['below50', null], ['m50', null], ['manifest503', null], ['m50', LATE]]) test(`${id}${at ? ' late' : ''}`, async ({ page }) => {
    await open(page, STATES[id].open, { at, storage: { 'screener:color-mode': theme } });
    await expect(page.locator('.brief')).toHaveAttribute('data-theme', theme);
    const read2 = await region(page).evaluate((node, inkNames) => {
      const probe = document.createElement('span'); node.appendChild(probe);
      const inks = inkNames.map(name => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; });
      probe.style.color = 'var(--ext)'; const warn = getComputedStyle(probe).color; probe.remove();
      const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const ground = getComputedStyle(node).backgroundColor;
      const of = selector => [...node.querySelectorAll(selector)].map(el => ({ selector, color: getComputedStyle(el).color, size: parseFloat(getComputedStyle(el).fontSize), weight: getComputedStyle(el).fontWeight }));
      const items = [...of('.brief-gate-kicker h2'), ...of('.brief-gate-kicker .numeric:not(.is-warn)'), ...of('.brief-gate-headline b'), ...of('.brief-gate-kind'), ...of('.brief-gate-figure small'), ...of('.brief-gate-figure b'), ...of('.brief-gate-line'), ...of('.brief-gate-conds li'), ...of('.brief-gate-conds small')];
      // Every text node with a digit in the first fold, with its size.
      const digits = []; const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) if (/\d/.test(t.textContent) && !t.parentElement.closest('details:not([open]) > .brief-expander-body') && t.parentElement.getClientRects().length) digits.push(parseFloat(getComputedStyle(t.parentElement).fontSize));
      return { inks, warn, ground: rgb(ground), items: items.map(item => ({ ...item, rgb: rgb(item.color) })), digits };
    }, INKS);
    const size = selector => read2.items.filter(item => item.selector === selector).map(item => item.size);
    // D19: kicker 12, headline 20, figure 26 with its 12px label, the lines 14, kinds 12; no digit under 12px. Each selector reads
    // at least one element where the state has it (the kicker's words sit in their own block: descendant selectors).
    for (const selector of ['.brief-gate-kicker h2', '.brief-gate-headline b', ...(id === 'manifest503' ? [] : ['.brief-gate-kicker .numeric:not(.is-warn)', '.brief-gate-kind', '.brief-gate-figure small', '.brief-gate-figure b', '.brief-gate-line'])]) expect(size(selector).length, selector).toBeGreaterThan(0);
    for (const [selector, px] of [['.brief-gate-kicker h2', 12], ['.brief-gate-kicker .numeric:not(.is-warn)', 12], ['.brief-gate-headline b', 20], ['.brief-gate-figure b', 26], ['.brief-gate-figure small', 12], ['.brief-gate-line', 14], ['.brief-gate-conds li', 14], ['.brief-gate-kind', 12]]) for (const value of size(selector)) expect(value, selector).toBe(px);
    expect(read2.digits.filter(value => value < 12)).toEqual([]);
    // D17: text inks only (the warning tone only for a late publication's age); contrast >= 4.5 against the card.
    for (const item of read2.items) {
      expect(read2.inks, `${item.selector} ${item.color}`).toContain(item.color);
      expect(ratio(item.rgb, read2.ground)).toBeGreaterThanOrEqual(4.5);
    }
    // The 銘柄側 rows (fold opened): text inks only and no ▲ (plan §5.3: stock-side numbers carry no colour and no ▲).
    if (id !== 'manifest503') {
      await region(page).locator('.brief-gate-more > summary').click();
      // The fold's full 根拠 line (the market tab's words, with digits): 14px like the first fold's 根拠 line (D19), its kind 12px,
      // a text ink (D17) with contrast >= 4.5 against the card, no digit under 12px.
      const full = region(page).locator('.brief-gate-basis-full');
      await expect(full).toHaveCount(1);
      await expect(full).toBeVisible();
      const basis = await full.evaluate(node => { const style = getComputedStyle(node), kind = node.querySelector('.brief-gate-kind');
        return { size: parseFloat(style.fontSize), color: style.color, kind: parseFloat(getComputedStyle(kind).fontSize), kindColor: getComputedStyle(kind).color, digits: /\d/.test(node.firstChild.textContent) }; });
      expect(basis).toMatchObject({ size: 14, kind: 12, digits: true });
      expect(read2.inks).toContain(basis.color);
      expect(read2.inks).toContain(basis.kindColor);
      expect(ratio(basis.color.match(/[\d.]+/g).slice(0, 3).map(Number), read2.ground)).toBeGreaterThanOrEqual(4.5);
      const stock = region(page).getByRole('group', { name: '銘柄側（参考・目安は変えません）' });
      await expect(stock).toBeVisible();
      await expect(stock).not.toContainText('▲');
      for (const color of await stock.locator('small, b, em, .brief-gate-kind').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color))) expect(read2.inks).toContain(color);
    }
    if (at) {
      const age = await region(page).locator('.brief-gate-kicker .is-warn').evaluate(node => getComputedStyle(node).color);
      expect(age).toBe(read2.warn);
      expect(ratio(age.match(/[\d.]+/g).slice(0, 3).map(Number), read2.ground)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// The two remaining answers: one row of two links, each a 44px target with its value and its whole note visible.
for (const [width, device] of Object.entries({ 320: WIDTHS[320], 375: WIDTHS[375], 390: WIDTHS[390] })) test.describe(`the two answers at ${width}px`, () => {
  test.use(device);
  for (const [name, storage] of [['no watch list', undefined], ['four watched', { 'research-watch': ['ZZNV', 'ZZZF', 'ZZSD', 'ZZKS'] }], ['five watched, one unlisted', { 'research-watch': ['ZZNV', 'ZZZF', 'QQQX', 'ZZSD', 'ZZKS'] }]]) test(name, async ({ page }) => {
    await open(page, {}, { storage });
    const links = page.getByTestId('brief-summary').getByRole('link');
    await expect(links).toHaveCount(2);
    // Each link's label and value stay apart, in its accessible name as on screen.
    await expect(links.nth(0)).toHaveAccessibleName(/^注目候補 21銘柄 ゾーン5・ ?接近16 /);
    await expect(links.nth(1)).toHaveAccessibleName(new RegExp(`^ウォッチの注意 ${{ 'no watch list': '未登録', 'four watched': '0件', 'five watched, one unlisted': '未確認' }[name]} `));
    for (const box of await links.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect()))) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    // Nothing of a value or a note is cut: no ellipsis, no clipped line.
    expect(await page.getByTestId('brief-summary').evaluate(node => [...node.querySelectorAll('small, b, em, .brief-frag')].filter(el => el.scrollWidth > el.clientWidth + 0.5 || getComputedStyle(el).textOverflow === 'ellipsis').length)).toBe(0);
    expect(await page.getByTestId('brief-summary').evaluate(node => [...node.querySelectorAll('li')].every(li => li.scrollHeight <= li.clientHeight + 0.5))).toBe(true);
  });

  test('確認中 while the sell checks load, and the longest note the watch tile can say, whole', async ({ page }) => {
    // brief-watch.spec.js:73-82: hold every chart (the sell checks read them) so the tile says 確認中.
    const files = new Set(['ZZNV.json', 'ZZKS.json', 'ZZZF.json', 'ZZOD.json', 'ZZSD.json']);
    await openBrief(page, '#/brief/market', { storage: { 'research-watch': ['ZZNV', 'ZZKS', 'ZZZF', 'ZZOD', 'ZZSD'] } });
    await page.route(url => files.has(url.pathname.split('/').pop()), () => {});
    // The hash is read once before the reload (a reload right after a hash change can reload the old address).
    await page.goto('/#/brief');
    await page.evaluate(() => location.hash);
    await page.reload();
    const tile = page.getByTestId('brief-summary').getByRole('link', { name: /ウォッチの注意/ });
    await expect(tile).toContainText('確認中5銘柄を確認中・保有未登録');
    const whole = () => page.getByTestId('brief-summary').evaluate(node => ({ cut: [...node.querySelectorAll('small, b, em, .brief-frag')].filter(el => el.scrollWidth > el.clientWidth + 0.5).length,
      clipped: [...node.querySelectorAll('li')].filter(li => li.scrollHeight > li.clientHeight + 0.5).length }));
    expect(await whole()).toEqual({ cut: 0, clipped: 0 });
    // The longest note watchAttention can give (every part at once, a two-digit total), put in the tile's own markup: it wraps
    // between its parts, nothing is cut, and the link stays a 44px target.
    await tile.evaluate(link => {
      link.querySelector('b').textContent = '未確認';
      link.querySelector('em').innerHTML = ['3/12を確認・', '対象外1・', '上限超2・', '未確認1・', '一部未確認1・', '保有未登録'].map(part => `<span class="brief-frag">${part}</span>`).join('');
    });
    expect(await whole()).toEqual({ cut: 0, clipped: 0 });
    expect(Math.min(...Object.values(await tile.evaluate(node => { const box = node.getBoundingClientRect(); return { w: box.width, h: box.height }; })))).toBeGreaterThanOrEqual(44);
    expect(await horizontalOverflow(page)).toBe(0);
  });
});

// ---- The waiting form's height (the conductor's round-1 order on S1-P4) ----------------------------------------------------
// brief-watch.spec.js:24-32 (a heavy-volume break of the 50-day line nine sessions ago) and :389-390 (the governing recipe).
function breakBelow50(bars) {
  const n = bars.length, at = n - 9;
  for (let i = 0; i < at; i++) for (const key of ['open', 'high', 'low', 'close']) bars[i][key] *= 1.15;
  const top = Math.max(...bars.slice(at - 50, at - 1).map(bar => bar.close));
  Object.assign(bars[at - 1], { open: top, close: top, high: top * 1.005, low: top * 0.995 });
  bars[at].volume = Math.ceil(bars.slice(at - 50, at).reduce((sum, bar) => sum + bar.volume, 0) / 50 * 2.2);
}
const broken = (...symbols) => ({ charts: served => { for (const symbol of symbols) breakBelow50(served[`${symbol}.json`].bars); } });
const under = rows => { for (const row of rows) if (['ZZKS', 'ZZAR'].includes(row.symbol)) row.se_pivot_price = Math.round(row.current_price * 1.0004 * 100) / 100; };
const GOVERNING = { storage: { 'research-watch': ['ZZNV', 'ZZZF', 'QQQX', 'ZZSD', 'ZZKS'] }, historyEnd: sessions.at(-2), mutate: { rows: under, charts: served => { broken('ZZSD', 'ZZNV').charts(served); } } };
const stackBottom = page => page.evaluate(() => Math.round(document.querySelector('#brief-main .brief-stack').getBoundingClientRect().bottom + scrollY));
/**
 * The fixture is frozen at 10/2, so a two-digit analysis date is put into the card's own text in place: every M/D the card
 * prints (kicker, headline, figure label, sign, note) becomes `md`, and a late age becomes two digits (「12営業日前」).
 */
const twoDigits = (page, md) => region(page).evaluate((node, value) => {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) t.nodeValue = t.nodeValue.replace(/\b\d{1,2}\/\d{1,2}\b/g, value);
  for (const age of node.querySelectorAll('.brief-gate-kicker .is-warn')) age.textContent = age.textContent.replace(/^(\d)営業日前/, '1$1営業日前');
  return node.querySelector('.brief-gate-headline').textContent;
}, md);
async function readyToday(page, count = 5) {
  await expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate')).toHaveCount(count);
  await expect(page.getByTestId('brief-summary')).not.toContainText('確認中', { timeout: 30000 });
  await settle(page);
}

for (const width of ['375', '390']) test.describe(`the waiting form at ${width}px`, () => {
  test.use(WIDTHS[width]);
  // brief-freshness.spec.js:85's state (ZZNV and ZZSD watched), with a two-digit date: pending and late equal the open form.
  for (const md of ['12/28', '11/19']) test(`is exactly as tall as the open form with the date ${md}`, async ({ page }) => {
    const storage = { 'research-watch': ['ZZNV', 'ZZSD'] };
    const { errors } = await openBrief(page, '#/brief', { storage });
    await readyToday(page);
    await expect(region(page)).toHaveAttribute('data-gate', 'open');
    expect(await twoDigits(page, md)).toBe('新規の買いを検討できる（独自判定）');
    const opened = await stackBottom(page);
    await kickerClear(page);
    for (const [clock, at] of [['pending', PENDING], ['late', LATE]]) {
      await page.clock.setFixedTime(new Date(at));
      await page.reload();
      await readyToday(page);
      await expect(region(page)).toHaveAttribute('data-gate', 'waiting');
      expect(await twoDigits(page, md)).toBe(`${md}時点の判定・更新待ち（独自判定）`);
      if (clock === 'late') await expect(region(page).locator('.brief-gate-kicker .is-warn')).toHaveText('12営業日前');
      // The headline keeps one line (its kind beside it, in two short lines).
      expect(await region(page).locator('.brief-gate-headline').evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(27.5);
      // The kicker keeps one line beside its link, its link a whole 44px target over the waiting headline's tag.
      await kickerClear(page);
      expect(await stackBottom(page), `${clock} ${md}`).toBe(opened);
      expect(await horizontalOverflow(page)).toBe(0);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('the governing state in the waiting form at 375px', () => {
  test.use(WIDTHS[375]);
  // brief-watch.spec.js:395's recipe (five watched, one unlisted; ZZSD and ZZNV broken; rows just under their pivot; one session
  // behind) at the pending and late clocks with a two-digit date: Today stays inside the owner's 1388px and equal to the open form.
  test('stays inside 1388px with a two-digit date, as tall as the open form', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', GOVERNING);
    await readyToday(page);
    await twoDigits(page, '12/28');
    const opened = await stackBottom(page);
    expect(opened).toBeLessThanOrEqual(1388);
    for (const at of [PENDING, LATE]) {
      await page.clock.setFixedTime(new Date(at));
      await page.reload();
      await readyToday(page);
      await expect(region(page)).toHaveAttribute('data-gate', 'waiting');
      expect(await twoDigits(page, '12/28')).toBe('12/28時点の判定・更新待ち（独自判定）');
      expect(await stackBottom(page)).toBeLessThanOrEqual(1388);
      expect(await stackBottom(page)).toBe(opened);
    }
    expect(errors).toEqual([]);
  });
});

// ---- The kicker row and the first 注目候補 row on 0% days (the conductor's round-2 order on S1-P4) ---------------------------
/**
 * The kicker row: its link is a 44px box that answers a tap everywhere in it (it lends 14px above and 13px below its line, over
 * the headline's half-leading); the kicker's words and the link's label overlap neither each other nor the headline's words, and
 * stay inside the card; `lines` = how many lines the kicker's words take.
 */
const kicker = page => region(page).evaluate(node => {
  const row = node.querySelector('.brief-gate-kicker'), link = row.querySelector('.brief-more'), headline = node.querySelector('.brief-gate-headline');
  const rects = (el, skip = null) => { const out = []; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) { if (!t.nodeValue.trim() || (skip && skip.contains(t))) continue; const range = document.createRange(); range.selectNodeContents(t); out.push(...range.getClientRects()); }
    return out; };
  const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const box = link.getBoundingClientRect(), card = node.getBoundingClientRect();
  const words = rects(row, link), label = rects(link), head = rects(headline);
  const hits = [];
  for (const y of [box.top + 1, box.top + box.height / 2, box.bottom - 1]) for (const x of [0.05, 0.5, 0.95]) hits.push(link.contains(document.elementFromPoint(box.left + box.width * x, y)));
  return { width: box.width, height: box.height, hits: hits.every(Boolean), lines: new Set(words.map(r => Math.round(r.top))).size,
    overlap: [...words, ...label].some(a => head.some(b => meets(a, b))) || words.some(a => label.some(b => meets(a, b))),
    inside: [...words, ...label].every(r => r.top >= card.top && r.bottom <= card.bottom && r.left >= card.left && r.right <= card.right) };
});
const kickerClear = async (page, lines = 1) => {
  const k = await kicker(page);
  expect(Math.min(k.width, k.height)).toBeGreaterThanOrEqual(44);
  expect(k).toMatchObject({ hits: true, overlap: false, inside: true, lines });
};

test.describe('the late form at 320px', () => {
  test.use(WIDTHS[320]);
  // brief-freshness.spec.js:85's state (ZZNV and ZZSD watched). At 320 the late age does not fit beside the date with its
  // weekday and the link: the kicker leaves the weekday out there (the bar's line 2 says it) and keeps one line, so nothing wraps
  // onto the headline (the S1 critics' round; it wrapped under the date inside the row's 44px before), and the late form ends
  // where the open and pending forms end, with the fixture's date and with a two-digit one.
  for (const md of [null, '12/28']) test(`is as tall as the open form with the date ${md ?? '10/2'}`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { storage: { 'research-watch': ['ZZNV', 'ZZSD'] } });
    await readyToday(page);
    if (md) await twoDigits(page, md);
    const opened = await stackBottom(page);
    await kickerClear(page);
    for (const [clock, at] of [['pending', PENDING], ['late', LATE]]) {
      await page.clock.setFixedTime(new Date(at));
      await page.reload();
      await readyToday(page);
      await expect(region(page)).toHaveAttribute('data-gate', 'waiting');
      if (md) await twoDigits(page, md);
      if (clock === 'late') {
        const age = region(page).locator('.brief-gate-kicker .is-warn');
        await expect(age).toHaveText(md ? '12営業日前' : '2営業日前');
        await expect(age).toBeInViewport({ ratio: 1 });
        expect(await age.evaluate(node => node.scrollWidth <= node.clientWidth + 0.5)).toBe(true);
        await expect(region(page).locator('.brief-gate-kicker .brief-gate-dow')).toBeHidden();
      }
      await kickerClear(page, 1);
      expect(await stackBottom(page), `${clock} ${md ?? '10/2'}`).toBe(opened);
      expect(await horizontalOverflow(page)).toBe(0);
    }
    expect(errors).toEqual([]);
  });
});

// Every 0% state of plan S1-P2's table with the fold closed (S1 acceptance 2): the first 注目候補 row ends above the dock at the
// four sizes of brief-phone.spec.js:27-40 that are not a session behind (375x812, 390x844 and the two installed-PWA sizes, whose
// bar and dock grow by the notch and home-indicator insets), with no watch list and with the matrix's four watched. The pending
// and the late clock (10/5 20:10Z, 10/7 09:00Z) keep 「買いは控える」 at 0% (plan D18).
const ZERO = {
  below50: [STATES.below50.open, null], below50idx: [{ mutate: compose(below50Rows, belowFiftyIndex) }, null], below200: [STATES.below200.open, null],
  restrain: [STATES.restrain.open, null], basisconflict: [STATES.basisconflict.open, null], ftd: [STATES.ftd.open, null], ftd5: [STATES.ftd5.open, null],
  ftdconflict: [STATES.ftdconflict.open, null], 'pend-below50': [STATES.below50.open, PENDING], 'late-below50': [STATES.below50.open, LATE],
};
const FOLDS = { '375x812': { device: WIDTHS[375] }, '390x844': { device: WIDTHS[390] }, '375x812 as an installed PWA': { device: WIDTHS[375], insets: { top: 44, bottom: 34 } },
  '390x844 as an installed PWA': { device: WIDTHS[390], insets: { top: 47, bottom: 34 } } };
for (const [size, { device, insets }] of Object.entries(FOLDS)) test.describe(`the first 注目候補 row on a 0% day at ${size}`, () => {
  test.use(device);
  for (const [id, [input, at]] of Object.entries(ZERO)) for (const [watch, storage] of [['no watch list', undefined], ['four watched', { 'research-watch': ['ZZNV', 'ZZZF', 'ZZSD', 'ZZKS'] }]]) test(`${id}, ${watch}`, async ({ page }) => {
    if (insets) await (await page.context().newCDPSession(page)).send('Emulation.setSafeAreaInsetsOverride', { insets: { ...insets, left: 0, right: 0 } });
    const { errors } = await openBrief(page, '#/brief', { ...input, storage });
    if (at) { await page.clock.setFixedTime(new Date(at)); await page.reload(); }
    await readyToday(page);
    await expect(region(page)).toHaveAttribute('data-gate', 'closed');
    await expect(region(page).locator('.brief-gate-headline')).toHaveText('買いは控える（独自判定）');
    await expect(region(page).locator('.brief-gate-more')).not.toHaveAttribute('open', '');
    const dock = await page.locator('.brief-dock').evaluate(node => { const box = node.getBoundingClientRect(); return { top: box.top, height: box.height }; });
    if (insets) expect(dock.height).toBeGreaterThanOrEqual(56 + insets.bottom);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    const row = await page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate').first().evaluate(node => node.getBoundingClientRect().bottom);
    expect(row, `${id} ${watch} at ${size}`).toBeLessThanOrEqual(dock.top);
    expect(errors).toEqual([]);
  });
});
