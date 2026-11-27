// The stock's call in B's form (plan S2-P1, D2, D5, D17, D18, D19, D20): line 1 the market line (marketBand's answer and
// figure with the analysis date and each kind beside what it labels), line 2 labelled 銘柄 with buyGate's own title, the
// level tiles and the chips under the chart, the pivot meter retired. The fixture stays frozen: every state is a mutator
// copied here with its source line, or the page clock.
import { test, expect } from '@playwright/test';
import { openBrief, VIEWPORTS, horizontalOverflow, SEC_SYMBOL, chartSettled } from './brief-fixture.js';

const phone = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const WIDTHS = { 320: phone(320, 640), 375: phone(375, 812), 390: VIEWPORTS.phone, 1440: VIEWPORTS.desktop };
// brief-market-r3.spec.js:60-63 (the FTD-upgraded rows under the 50-day line), :65-66 (長期トレンド警戒), and its `below50Rows` (50日線割れ).
const ftdUpgraded = { rows: rows => { for (const row of rows) row.market_above_50dma = false; } };
const below200 = { rows: rows => { for (const row of rows) { row.market_above_200dma = false; row.market_regime = 'correction'; } } };
const below50Rows = { rows: rows => { for (const row of rows) { row.market_above_50dma = false; row.market_regime = 'correction'; } } };
// brief-market.spec.js's `pressure` (上昇に圧力), brief-gate.spec.js:29-30 (新規購入を抑制; one condition unknown).
const pressure = { rows: rows => { for (const row of rows) row.market_regime = 'uptrend_under_pressure'; } };
const restrain = { rows: rows => { for (const row of rows) row.market_regime = 'correction'; } };
const partUnknown = { rows: rows => { for (const row of rows) row.market_above_50dma = null; } };
// brief-decision.spec.js's `EARNINGS_SOON`: earnings three days after the analysis date.
const EARNINGS_SOON = { rows: rows => { const row = rows.find(r => r.symbol === SEC_SYMBOL); row.entry_evidence = { ...row.entry_evidence, earnings: { date: '2026-10-05' } }; } };
// brief-gate.spec.js:50: 10 minutes after the 10/5 close (pending) and two sessions later (late).
const PENDING = '2026-10-05T20:10:00Z', LATE = '2026-10-07T09:00:00Z';

const OPEN50 = '地合い 10/2：検討可（独自判定）・目安 最大50%（独自設定）';
const HOLD = '地合い 10/2：買いは控える（独自判定）・目安 0%（独自設定）';
/** Each market state: how it opens, its clock, and the call's market line in it. */
const STATES = {
  m50: { open: {}, line: OPEN50 },
  m25: { open: { mutate: pressure }, line: '地合い 10/2：検討可（独自判定）・目安 最大25%（独自設定）' },
  below50: { open: { mutate: below50Rows }, line: HOLD },
  ftd: { open: { mutate: ftdUpgraded }, line: HOLD },
  below200: { open: { mutate: below200 }, line: HOLD },
  restrain: { open: { mutate: restrain }, line: HOLD },
  // The series is missing: no last closed session is known, so the verdict reads as published (the 市場 tab's rule).
  series404: { open: { fail: 'series' }, line: OPEN50 },
  partunk: { open: { mutate: partUnknown }, line: '地合い 10/2：未確認・買いは見送り' },
  'pend-m50': { open: {}, at: PENDING, line: '地合い 10/2時点の判定・更新待ち（独自判定）・目安 最大50%（10/2時点・独自設定）' },
  'pend-m25': { open: { mutate: pressure }, at: PENDING, line: '地合い 10/2時点の判定・更新待ち（独自判定）・目安 最大25%（10/2時点・独自設定）' },
  'pend-below50': { open: { mutate: below50Rows }, at: PENDING, line: HOLD },
  'late-m50': { open: {}, at: LATE, line: '地合い 10/2時点の判定・更新待ち（独自判定）・目安 最大50%（10/2時点・独自設定）' },
  'late-m25': { open: { mutate: pressure }, at: LATE, line: '地合い 10/2時点の判定・更新待ち（独自判定）・目安 最大25%（10/2時点・独自設定）' },
  'late-below50': { open: { mutate: below50Rows }, at: LATE, line: HOLD },
};

const conclusion = page => page.getByTestId('brief-conclusion');
const marketLine = page => conclusion(page).getByTestId('brief-call-market');
const settle = page => page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => null))));
async function openStock(page, { open = {}, at = null, symbol = SEC_SYMBOL, storage } = {}) {
  const result = await openBrief(page, `#/brief/stock/${symbol}`, { ...open, storage });
  if (at) { await page.clock.setFixedTime(new Date(at)); await page.reload(); }
  await expect(conclusion(page)).toBeVisible();
  await page.getByTestId('brief-price-chart').locator('svg rect.bc-up, svg rect.bc-down').first().waitFor({ state: 'attached' });
  await chartSettled(page);
  await settle(page);
  return result;
}
/**
 * The answer and the figure a text states: waiting (the 更新待ち form, or the wide verdict block's waiting lead), hold, unknown
 * or open, and 最大N% / 0% / none.
 */
const statement = text => ({ answer: /更新待ち|新しい公開を待って/.test(text) ? 'waiting' : /控え/.test(text) ? 'hold' : /見送り|未確認|確認できません/.test(text) ? 'unknown' : /検討/.test(text) ? 'open' : null,
  figure: text.match(/(最大\d+%|(?<![\d.])0%)/)?.[1] ?? null });

for (const width of ['390', '1440']) test.describe(`the call's market line at ${width}px`, () => {
  test.use(WIDTHS[width]);
  const wide = width === '1440';
  for (const [id, s] of Object.entries(STATES)) test(`${id}: states Today's answer and figure, with the analysis date`, async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', s.open);
    if (s.at) { await page.clock.setFixedTime(new Date(s.at)); await page.reload(); }
    const region = page.getByRole('region', { name: '地合い', exact: true });
    await expect(region).not.toHaveAttribute('data-gate', 'loading', { timeout: 30000 });
    // Today's gate: its headline (the verdict block's lead at 1024px and wider) and its labelled figure.
    const gate = await region.evaluate((node, isWide) => [node.querySelector(isWide ? '[data-testid="brief-regime"] p' : '.brief-gate-headline'), node.querySelector('.brief-gate-figure b')]
      .filter(Boolean).map(el => el.textContent).join(' '), wide);
    await page.goto(`/#/brief/stock/${SEC_SYMBOL}`);
    await expect(marketLine(page)).toHaveText(s.line);
    const line = await marketLine(page).textContent();
    // The same answer and the same figure as Today's gate (or both the 更新待ち form, or both no figure).
    expect(statement(line)).toEqual(statement(gate));
    // The market line is the card's first line; the 銘柄 line follows with buyGate's own title.
    expect(await conclusion(page).evaluate(card => [card.firstElementChild.dataset.testid, card.querySelector('.brief-call-label .brief-call-head').textContent])).toEqual(['brief-call-market', '銘柄']);
    expect(line).not.toMatch(/条件中|-\d/);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

/**
 * The market line's visual lines (the characters of each, by their tops), each unit's line count, and whether every kind
 * label sits inside its own unit. With `md`, every M/D of the line is first put in place as that date (the fixture is frozen
 * at 10/2; brief-gate.spec.js's twoDigits).
 */
const fit = (page, md = null) => marketLine(page).evaluate((line, value) => {
  if (value) { const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT); for (let t = walker.nextNode(); t; t = walker.nextNode()) t.nodeValue = t.nodeValue.replace(/\b\d{1,2}\/\d{1,2}\b/g, value); }
  const tops = node => { const out = new Map(), walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) for (let i = 0; i < t.length; i++) { const range = document.createRange(); range.setStart(t, i); range.setEnd(t, i + 1);
      const box = range.getBoundingClientRect(); if (box.width) { const top = Math.round(box.top); out.set(top, (out.get(top) ?? '') + t.nodeValue[i]); } }
    return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text); };
  const box = line.getBoundingClientRect(), card = line.closest('[data-testid="brief-conclusion"]').getBoundingClientRect();
  return { lines: tops(line), units: [...line.children].map(unit => tops(unit).length), kindsWhole: [...line.querySelectorAll('.brief-call-kind')].every(kind => kind.parentElement.classList.contains('brief-nowrap') && tops(kind).length === 1),
    inside: box.left >= card.left - 0.5 && box.right <= card.right + 0.5, overflow: line.scrollWidth - line.clientWidth };
}, md);

for (const width of ['320', '375', '390']) test.describe(`the market line's fit at ${width}px`, () => {
  test.use({ ...WIDTHS[width], contextOptions: { reducedMotion: 'reduce' } });
  for (const id of ['m50', 'm25', 'below50', 'partunk', 'pend-m50', 'pend-below50', 'late-m50', 'late-below50']) test(`${id}: breaks only after a 「：」 or a 「・」, never inside a word, a figure or a kind label`, async ({ page }) => {
    const s = STATES[id];
    const { errors } = await openStock(page, s);
    for (const md of [null, '12/28']) {
      const f = await fit(page, md);
      // Every unit (a word with its kind, the figure with its kind) stays on one line; every visual line but the last ends at a
      // separator, so the line breaks only where a separator is.
      expect(f.units.every(lines => lines === 1), `${md} ${JSON.stringify(f.lines)}`).toBe(true);
      expect(f.kindsWhole).toBe(true);
      for (const text of f.lines.slice(0, -1)) expect(text, `${md} ${JSON.stringify(f.lines)}`).toMatch(/[：・]$/);
      expect([f.inside, f.overflow]).toEqual([true, 0]);
    }
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

// D17 inks and D19 sizes, in both themes, on the 0%, 50%, unknown and late states (390px): the market line in the text ink on
// every day (its subject and kinds in the secondary text ink), never a tone; 14px for the market line and the 銘柄 label, the
// title 20px as before; no digit under 12px in the card, its tiles or its chips; contrast >= 4.5 against the card.
const INKS = ['--text', '--text-2', '--text-3'];
const luminance = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const theme of ['light', 'dark']) test.describe(`the call's inks and sizes in the ${theme} theme`, () => {
  test.use({ ...WIDTHS[390], contextOptions: { reducedMotion: 'reduce' } });
  for (const id of ['m50', 'below50', 'partunk', 'late-m50']) test(id, async ({ page }) => {
    const s = STATES[id];
    const { errors } = await openStock(page, { ...s, storage: { 'screener:color-mode': theme } });
    await expect(page.locator('.brief')).toHaveAttribute('data-theme', theme);
    const read = await conclusion(page).evaluate((card, inkNames) => {
      const probe = document.createElement('span'); card.appendChild(probe);
      const ink = name => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
      const inks = Object.fromEntries(inkNames.map(name => [name, ink(name)])), tones = ['--zone', '--up', '--wait', '--ext', '--neg'].map(ink);
      probe.remove();
      const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const of = selector => [...card.querySelectorAll(selector)].map(el => ({ selector, color: getComputedStyle(el).color, size: parseFloat(getComputedStyle(el).fontSize) }));
      const items = [...of('[data-testid="brief-call-market"]'), ...of('[data-testid="brief-call-market"] .brief-call-head'), ...of('[data-testid="brief-call-market"] .brief-call-kind'), ...of('.brief-call-label'), ...of('.brief-call-label .brief-call-head'), ...of('strong'), ...of('.brief-call-status > div > p:first-of-type')];
      const digits = [];
      for (const root of document.querySelectorAll('[data-testid="brief-conclusion"], [data-testid="brief-levels"], [data-testid="brief-call-chips"]')) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let t = walker.nextNode(); t; t = walker.nextNode()) if (/\d/.test(t.textContent) && t.parentElement.getClientRects().length && !t.parentElement.closest('.sr-only')) digits.push([t.textContent.trim().slice(0, 16), parseFloat(getComputedStyle(t.parentElement).fontSize)]);
      }
      return { inks, tones, ground: rgb(getComputedStyle(card).backgroundColor), items: items.map(item => ({ ...item, rgb: rgb(item.color) })), digits };
    }, INKS);
    const pick = selector => read.items.filter(item => item.selector === selector);
    const [line] = pick('[data-testid="brief-call-market"]');
    // D17: the line in the text ink on every day, the buyable day included; its subject and kinds in the secondary text ink.
    expect(line.color).toBe(read.inks['--text']);
    for (const item of [...pick('[data-testid="brief-call-market"] .brief-call-head'), ...pick('[data-testid="brief-call-market"] .brief-call-kind')]) expect(item.color).toBe(read.inks['--text-2']);
    for (const item of read.items) {
      expect(Object.values(read.inks), `${item.selector} ${item.color}`).toContain(item.color);
      expect(read.tones).not.toContain(item.color);
      expect(ratio(item.rgb, read.ground), item.selector).toBeGreaterThanOrEqual(4.5);
    }
    // D19: the market line and the 銘柄 label 14px; the gate's own title as before (20px) and its line (13px).
    // (An unknown market's line has no kind: it states no verdict and no figure.)
    for (const [selector, px] of [['[data-testid="brief-call-market"]', 14], ['[data-testid="brief-call-market"] .brief-call-head', 14], ['[data-testid="brief-call-market"] .brief-call-kind', 14], ['.brief-call-label', 14], ['.brief-call-label .brief-call-head', 14], ['strong', 20], ['.brief-call-status > div > p:first-of-type', 13]]) {
      if (id === 'partunk' && selector.endsWith('.brief-call-kind')) expect(pick(selector), selector).toEqual([]);
      else expect(pick(selector).length, selector).toBeGreaterThan(0);
      for (const item of pick(selector)) expect(item.size, selector).toBe(px);
    }
    expect(read.digits.filter(([, size]) => size < 12)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// D20's first fold: in the three governing states (the buyable-day zone stock, the 0% marketHold stock, an earnings-soon stock)
// at 390x844, 375x812 and both installed-PWA sizes (brief-phone.spec.js:18-21), the whole price plot and the chart's ピボット and
// 損切り tags and its buy-zone label are above the dock without scrolling (the tiles and the meter no longer sit above the chart).
const FOLDS = { '390x844': { device: WIDTHS[390] }, '375x812': { device: WIDTHS[375] }, '375x812 as an installed PWA': { device: WIDTHS[375], insets: { top: 44, bottom: 34 } },
  '390x844 as an installed PWA': { device: WIDTHS[390], insets: { top: 47, bottom: 34 } } };
const GOVERNING = { zone: { open: {}, gate: 'touch' }, hold: { open: { mutate: below50Rows }, gate: 'marketHold' }, earnings: { open: { mutate: EARNINGS_SOON }, gate: 'earnings' } };
for (const [size, { device, insets }] of Object.entries(FOLDS)) test.describe(`the stock's first fold at ${size}`, () => {
  test.use({ ...device, contextOptions: { reducedMotion: 'reduce' } });
  for (const [id, g] of Object.entries(GOVERNING)) test(`${id}: the call, the whole price plot and its level tags are above the dock`, async ({ page }) => {
    if (insets) await (await page.context().newCDPSession(page)).send('Emulation.setSafeAreaInsetsOverride', { insets: { ...insets, left: 0, right: 0 } });
    const { errors } = await openStock(page, { open: g.open });
    await expect(conclusion(page)).toHaveAttribute('data-gate', g.gate);
    const fold = await page.evaluate(() => {
      const chart = document.querySelector('[data-testid="brief-price-chart"]'), svg = chart.querySelector('svg'), clip = svg.querySelector('clipPath rect');
      const bottom = selector => chart.querySelector(selector)?.getBoundingClientRect().bottom ?? null;
      return { scrollY, dock: document.querySelector('.brief-dock').getBoundingClientRect().top, call: document.querySelector('[data-testid="brief-conclusion"]').getBoundingClientRect().bottom,
        plot: svg.getBoundingClientRect().top + Number(clip.getAttribute('height')), pivot: bottom('[data-tag="pivot"]'), stop: bottom('[data-tag="stop"]'), zone: bottom('.bc-zonelabel') };
    });
    expect(fold.scrollY).toBe(0);
    for (const key of ['pivot', 'stop', 'zone']) expect(fold[key], key).not.toBeNull();
    for (const key of ['call', 'plot', 'pivot', 'stop', 'zone']) expect(fold[key], `${key} ${JSON.stringify(fold)}`).toBeLessThanOrEqual(fold.dock);
    expect(errors).toEqual([]);
  });
});

// D5: a sell chip the call does not state joins the 銘柄 line in its own short words (ZZNR, the oracle whose holder chip the
// call does not state), so it never leaves the first fold; the chip itself, in full, is in the chip list under the tiles.
test.describe('the 銘柄 line at 390px', () => {
  test.use({ ...WIDTHS[390], contextOptions: { reducedMotion: 'reduce' } });
  test('names a sell chip the call does not state, and keeps the chip list under the chart', async ({ page }) => {
    const { errors } = await openStock(page, { open: { oracles: true }, symbol: 'ZZNR' });
    await expect(conclusion(page).locator('.brief-call-label')).toHaveText('銘柄・保有なら売りのサイン');
    await expect(page.getByTestId('brief-call-chips').locator('.brief-chip', { hasText: '保有している場合の売りのサイン（保有未登録）' })).toHaveCount(1);
    const order = await page.evaluate(() => ['brief-conclusion', 'brief-price-chart', 'brief-levels', 'brief-call-chips'].map(id => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().top));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    await expect(page.locator('.brief-meter')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

// At 1024px and wider (no dock and no height line) the tiles and the chips stay above the chart, under the card, as before S2,
// so the share count, the stop tile, RS推計 and the stage are on the pane's first screen; the phone keeps D5's order (above).
test.describe('the stock pane at 1440px', () => {
  test.use({ ...WIDTHS[1440], contextOptions: { reducedMotion: 'reduce' } });
  test('puts the level tiles and the chips between the card and the chart, on the first screen', async ({ page }) => {
    const { errors } = await openStock(page, {});
    const boxes = await page.evaluate(() => ['brief-conclusion', 'brief-levels', 'brief-call-chips', 'brief-price-chart'].map(id => { const box = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect(); return [Math.round(box.top), Math.round(box.bottom)]; }));
    const tops = boxes.map(([top]) => top);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    expect(boxes[1][1]).toBeLessThanOrEqual(900);
    expect(boxes[2][1]).toBeLessThanOrEqual(900);
    await expect(page.getByTestId('brief-levels').locator('.brief-kgrid > div')).toHaveCount(3);
    expect(errors).toEqual([]);
  });
});

// D5 with both short forms at once: ZZNR (above) with earnings three days after the analysis date (brief-decision.spec.js:26,
// EARNINGS_SOON, here on ZZNR) on a below-50 day (brief-market-r3.spec.js:305, below50Rows above), so the gate is the 0%
// marketHold and both the holder chip and the earnings date join the 銘柄 label. At 320 the label wraps only after a 「・」, never
// inside 銘柄 or a short form; at 375 it is one line.
const TWO_SHORT_FORMS = { rows: rows => { const row = rows.find(r => r.symbol === 'ZZNR'); row.entry_evidence = { ...row.entry_evidence, earnings: { date: '2026-10-05' } }; below50Rows.rows(rows); } };
const LABEL = '銘柄・保有なら売りのサイン・決算まで2日';
/** The 銘柄 label's visual lines (the characters of each, by their tops), each unit's line count (銘柄, each short form), its overflow. */
const labelFit = page => conclusion(page).locator('.brief-call-label').evaluate(label => {
  const tops = node => { const out = new Map(), walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) for (let i = 0; i < t.length; i++) { const range = document.createRange(); range.setStart(t, i); range.setEnd(t, i + 1);
      const box = range.getBoundingClientRect(); if (box.width) { const top = Math.round(box.top); out.set(top, (out.get(top) ?? '') + t.nodeValue[i]); } }
    return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text); };
  return { lines: tops(label), units: [...label.querySelectorAll('.brief-call-head, .brief-nowrap')].map(unit => tops(unit).length), overflow: label.scrollWidth - label.clientWidth };
});
for (const [width, count] of [['320', 2], ['375', 1]]) test.describe(`the 銘柄 line with two short forms at ${width}px`, () => {
  test.use({ ...WIDTHS[width], contextOptions: { reducedMotion: 'reduce' } });
  test(`names the sell chip and the earnings date, in ${count} line${count > 1 ? 's that break only after a 「・」' : ''}`, async ({ page }) => {
    const { errors } = await openStock(page, { open: { oracles: true, mutate: TWO_SHORT_FORMS }, symbol: 'ZZNR' });
    await expect(conclusion(page)).toHaveAttribute('data-gate', 'marketHold');
    await expect(conclusion(page).locator('.brief-call-label')).toHaveText(LABEL);
    const fit = await labelFit(page);
    expect(fit.lines.join(''), JSON.stringify(fit)).toBe(LABEL);
    expect(fit.lines, JSON.stringify(fit)).toHaveLength(count);
    expect(fit.units, JSON.stringify(fit)).toEqual([1, 1, 1]);
    for (const text of fit.lines.slice(0, -1)) expect(text, JSON.stringify(fit)).toMatch(/・$/);
    expect(fit.overflow).toBe(0);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
