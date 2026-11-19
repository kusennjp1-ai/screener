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
  series404: { open: { fail: 'series' }, cap: '最大50%', headline: '新規の買いを検討できる', alert: '市場推移データを取得できません（配信ファイルが見つかりません）。数値は表示しません。' },
  manifest503: { open: { fail: 'manifest' }, cap: null, headline: '買いは見送り', unknown: true },
  partunk: { open: { mutate: partUnknown }, cap: null, headline: '買いは見送り', unknown: true },
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
  return { first: copy.textContent, all: node.textContent, headline: pick('.brief-gate-headline'), figure: pick('.brief-gate-figure'), basis: pick('.brief-gate-basis'),
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
      expect(r.basis).toMatch(/^根拠（10\/2スキャン時点）：.+（実測）$/);
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
        // The age is fully visible in the warning tone: in the viewport, not clipped.
        await expect(age).toHaveText('・2営業日前');
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
  for (const id of ['m50', 'm25', 'below50', 'below200', 'restrain', 'ftdconflict']) test(`are the 市場 tab's in ${id}`, async ({ page }) => {
    await open(page, STATES[id].open);
    const basis = (await read(page)).basis.replace(/（実測）$/, '').replace('（指数の履歴と不一致・下に詳細）', '');
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
      const items = [...of('.brief-gate-kicker > h2'), ...of('.brief-gate-kicker > .numeric:not(.is-warn)'), ...of('.brief-gate-headline b'), ...of('.brief-gate-kind'), ...of('.brief-gate-figure small'), ...of('.brief-gate-figure b'), ...of('.brief-gate-line'), ...of('.brief-gate-conds li'), ...of('.brief-gate-conds small')];
      // Every text node with a digit in the first fold, with its size.
      const digits = []; const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) if (/\d/.test(t.textContent) && !t.parentElement.closest('details:not([open]) > .brief-expander-body') && t.parentElement.getClientRects().length) digits.push(parseFloat(getComputedStyle(t.parentElement).fontSize));
      return { inks, warn, ground: rgb(ground), items: items.map(item => ({ ...item, rgb: rgb(item.color) })), digits };
    }, INKS);
    const size = selector => read2.items.filter(item => item.selector === selector).map(item => item.size);
    // D19: kicker 12, headline 20, figure 26 with its 12px label, the lines 14, kinds 12; no digit under 12px.
    for (const [selector, px] of [['.brief-gate-kicker > h2', 12], ['.brief-gate-headline b', 20], ['.brief-gate-figure b', 26], ['.brief-gate-figure small', 12], ['.brief-gate-line', 14], ['.brief-gate-conds li', 14], ['.brief-gate-kind', 12]]) for (const value of size(selector)) expect(value).toBe(px);
    expect(read2.digits.filter(value => value < 12)).toEqual([]);
    // D17: text inks only (the warning tone only for a late publication's age); contrast >= 4.5 against the card.
    for (const item of read2.items) {
      expect(read2.inks, `${item.selector} ${item.color}`).toContain(item.color);
      expect(ratio(item.rgb, read2.ground)).toBeGreaterThanOrEqual(4.5);
    }
    // The 銘柄側 rows (fold opened): text inks only and no ▲ (plan §5.3: stock-side numbers carry no colour and no ▲).
    if (id !== 'manifest503') {
      await region(page).locator('.brief-gate-more > summary').click();
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
