// The day change in text ink (plan S1-P6, decision D17) on synthetic data, on the 50% and the 0% day, in both themes: every
// `.brief-daychg` on Today, 候補 and ウォッチ, in the phone bar's quote and in the desktop stock header computes to a text
// ink (up and down to --text itself; ±0.0% and an unknown change keep their muted ink), its arrow takes its ink and size, a
// positive change reads ↑ with 「+」 and a negative one ↓ with 「−」 (U+2212), the arrow is aria-hidden so the accessible
// text stays 「前日比 +2.0%」, and the contrast against what lies under it is at least 4.5. Today's gate card (S1-P4's new
// elements) is in text inks too. The stated exceptions keep their hues: the chart card's readout change and the market
// tab's sector rows. Three rows get a negative, a zero and an unknown change here, beside ZZNV's +2.0% (mutators; the
// fixture is unchanged).
import { test, expect } from '@playwright/test';
import { openBrief, chartSettled, VIEWPORTS } from './brief-fixture.js';

// brief-market-r3.spec.js:295
const below50Rows = { rows: rows => { for (const row of rows) { row.market_above_50dma = false; row.market_regime = 'correction'; } } };
const changes = { rows: rows => {
  const set = (symbol, change) => { const values = rows.find(row => row.symbol === symbol).technical_audit.values; if (change === undefined) delete values.change; else values.change = change; };
  set('ZZKS', -1.54); set('ZZOD', 0); set('ZZNH', undefined);
} };
// The sector frames before the newest with the first two sectors swapped (rank and value, so each frame stays consistent),
// so the newest frame shows a ▲ and a ▼ move against a month earlier.
const sectorMoves = { trends: value => { const frames = value.long_history.sectorRotation.frames, last = frames.length - 1;
  const [first, second] = [frames[last].ranks.find(row => row.rank === 1), frames[last].ranks.find(row => row.rank === 2)];
  frames.forEach((frame, i) => { if (i < last) frame.ranks = frame.ranks.map(row => (row.symbol === first.symbol ? { ...row, rank: 2, relativeIndex: second.relativeIndex }
    : row.symbol === second.symbol ? { ...row, rank: 1, relativeIndex: first.relativeIndex } : row)); }); } };
const compose = (...parts) => Object.fromEntries([...new Set(parts.flatMap(Object.keys))].map(key => [key, value => { for (const part of parts) part[key]?.(value); }]));
const DAYS = { '50%': changes, '0%': compose(below50Rows, changes) };
const WATCH = ['ZZNV', 'ZZKS', 'ZZOD', 'ZZNH'];
const EXPECT = { ZZNV: '↑+2.0%', ZZKS: '↓−1.5%', ZZOD: '±0.0%', ZZNH: '—' };
const SPOKEN = { ZZNV: '前日比 +2.0%', ZZKS: '前日比 −1.5%', ZZOD: '前日比 ±0.0%', ZZNH: '前日比 未確認' };

/** Every day change on the page: its text on screen and for assistive tech, its ink, its arrow, and the inks to compare with. */
const readChanges = page => page.evaluate(() => {
  const probe = document.createElement('span'); document.querySelector('.brief').appendChild(probe);
  const ink = value => { probe.style.color = value; return getComputedStyle(probe).color; };
  const inks = { text: ink('var(--text)'), text2: ink('var(--text-2)'), text3: ink('var(--text-3)') };
  probe.remove();
  const rgb = value => { const parts = value.match(/[\d.]+/g).map(Number); return /^color\(/.test(value) ? parts.slice(0, 3).map(v => v * 255) : parts.slice(0, 3); };
  const ground = node => { for (let el = node; el; el = el.parentElement) { const bg = getComputedStyle(el).backgroundColor; const alpha = bg.match(/[\d.]+/g)?.[3]; if (bg !== 'transparent' && (alpha === undefined || Number(alpha) > 0)) return bg; } return 'rgb(255, 255, 255)'; };
  const luminance = color => { const [r, g, b] = rgb(color).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const spoken = node => [...node.childNodes].map(child => child.nodeType === Node.TEXT_NODE ? child.textContent : child.getAttribute('aria-hidden') === 'true' ? '' : spoken(child)).join('');
  return { inks, items: [...document.querySelectorAll('.brief-daychg')].filter(node => node.getClientRects().length).map(node => {
    const arrow = node.querySelector('.brief-daychg-dir'), style = getComputedStyle(node);
    const where = node.closest('.brief-row-title') ? 'row' : node.closest('.brief-bar-title') ? 'bar' : node.closest('.brief-stockhead') ? 'head' : 'other';
    return { where, symbol: node.closest('[data-symbol]')?.dataset.symbol ?? null, cls: [...node.classList].filter(c => /^is-/.test(c)).join(' '),
      text: node.textContent, spoken: spoken(node), color: style.color, size: style.fontSize, contrast: contrast(style.color, ground(node)),
      arrow: arrow ? { text: arrow.textContent, hidden: arrow.getAttribute('aria-hidden'), color: getComputedStyle(arrow).color, size: getComputedStyle(arrow).fontSize } : null };
  }) };
});

/**
 * The rules every day change keeps: its ink by direction and place, its size by place (brief-decision.css; D19: no digit
 * under 12 px), the arrow before the sign, the spoken text, contrast.
 */
function checkChanges({ inks, items }) {
  const muted = { row: inks.text3, bar: inks.text2, head: inks.text2 };
  const sizes = { row: '12px', bar: '13px', head: '16px' };
  for (const item of items) {
    const label = `${item.where} ${item.symbol ?? ''} ${item.text}`;
    expect(item.where, label).not.toBe('other');
    expect(item.size, label).toBe(sizes[item.where]);
    expect(Object.values(inks), label).toContain(item.color);
    if (/is-(up|down)/.test(item.cls)) {
      expect(item.color, label).toBe(inks.text);
      expect(item.arrow, label).toEqual({ text: item.cls === 'is-up' ? '↑' : '↓', hidden: 'true', color: item.color, size: item.size });
      expect(item.text, label).toMatch(item.cls === 'is-up' ? /^前日比 ↑\+\d+\.\d%$/ : /^前日比 ↓−\d+\.\d%$/);
      expect(item.spoken, label).toBe(item.text.replace(/[↑↓]/, ''));
    } else {
      expect(item.color, label).toBe(muted[item.where]);
      expect(item.arrow, label).toBeNull();
      expect(item.text, label).not.toMatch(/[↑↓]/);
    }
    expect(item.text, label).not.toMatch(/-\d/);
    expect(item.contrast, label).toBeGreaterThanOrEqual(4.5);
  }
}

for (const theme of ['light', 'dark']) for (const [day, mutate] of Object.entries(DAYS)) test.describe(`the day change in text ink, ${theme} theme, on the ${day} day`, () => {
  const storage = { 'screener:color-mode': theme, 'research-watch': WATCH };
  const open = async (page, hash, extra = null) => {
    const result = await openBrief(page, hash, { mutate: extra ? compose(mutate, extra) : mutate, storage });
    await expect(page.locator('.brief')).toHaveAttribute('data-theme', theme);
    return result;
  };

  test.describe('on a phone', () => {
    test.use(VIEWPORTS.phone);
    for (const [screen, hash] of [['Today', '#/brief'], ['候補', '#/brief/list'], ['ウォッチ', '#/brief/watch']]) test(`${screen}: the rows`, async ({ page }) => {
      const { errors } = await open(page, hash);
      await expect(page.getByTestId('brief-candidate').first()).toBeVisible();
      // 候補 reads the whole selection (選定すべて): a phone lists its first 20 rows, past the five of the default 買いゾーン.
      if (screen === '候補') { await page.getByRole('button', { name: /^選定すべて/ }).click(); await expect(page.getByTestId('brief-candidate')).toHaveCount(20); }
      const read = await readChanges(page);
      checkChanges(read);
      // The four mutated rows read as stated wherever they are listed (Today lists the top five, ウォッチ the four).
      const shown = read.items.filter(item => item.where === 'row' && EXPECT[item.symbol]);
      expect(new Set(shown.map(item => item.symbol))).toEqual(new Set(Object.keys(EXPECT)));
      for (const item of shown) {
        expect(item.text, item.symbol).toBe(item.symbol === 'ZZNH' ? '—前日比 未確認' : `前日比 ${EXPECT[item.symbol]}`);
        expect(item.spoken, item.symbol).toBe(SPOKEN[item.symbol]);
      }
      // The row's own name for assistive tech is unchanged: the change without an arrow.
      for (const [symbol, words] of Object.entries(SPOKEN)) {
        const row = page.locator(`[data-testid="brief-candidate"][data-symbol="${symbol}"]`).first();
        await expect(row).toHaveAccessibleName(new RegExp(`、${words.replace(/[+]/g, '\\+')}、`));
        await expect(row).not.toHaveAccessibleName(/[↑↓]/);
      }
      if (screen === 'Today') {
        // Today's gate card (the new elements of S1-P4): its headline, figure and lines are text inks as well.
        const gate = await page.getByRole('region', { name: '地合い', exact: true }).evaluate((node, inks) => [...node.querySelectorAll('.brief-gate-headline b, .brief-gate-figure b, .brief-gate-figure small, .brief-gate-line, .brief-gate-conds li')]
          .filter(el => el.getClientRects().length).map(el => [el.className || el.tagName, getComputedStyle(el).color, inks.includes(getComputedStyle(el).color)]), Object.values(read.inks));
        expect(gate.length).toBeGreaterThan(0);
        for (const [what, color, ok] of gate) expect(ok, `${what} ${color}`).toBe(true);
      }
      expect(errors).toEqual([]);
    });

    for (const [symbol, text] of [['ZZNV', '前日比 ↑+2.0%'], ['ZZKS', '前日比 ↓−1.5%'], ['ZZOD', '前日比 ±0.0%']]) test(`the bar's quote of ${symbol}`, async ({ page }) => {
      const { errors } = await open(page, `#/brief/stock/${symbol}`);
      await expect(page.getByTestId('brief-conclusion')).toBeVisible();
      const quote = page.locator('.brief-bar .brief-bar-change');
      await expect(quote).toHaveText(text);
      const read = await readChanges(page);
      checkChanges(read);
      expect(read.items.filter(item => item.where === 'bar').map(item => item.text)).toEqual([text]);
      // For assistive tech the quote reads its change without the arrow.
      expect(await page.locator('.brief-bar-title b').ariaSnapshot()).toContain(text.replace(/[↑↓]/, ''));
      expect(await page.locator('.brief-bar-title b').ariaSnapshot()).not.toMatch(/[↑↓]/);
      expect(errors).toEqual([]);
    });
  });

  test.describe('at 1440px', () => {
    test.use(VIEWPORTS.desktop);
    for (const [symbol, text] of [['ZZNV', '前日比 ↑+2.0%'], ['ZZKS', '前日比 ↓−1.5%']]) test(`the stock header of ${symbol}, and the chart readout's change keeps its hue`, async ({ page }) => {
      const { errors } = await open(page, `#/brief/stock/${symbol}`);
      await expect(page.getByTestId('brief-conclusion')).toBeVisible();
      await expect(page.locator('.brief-stockhead h2 .brief-daychg')).toHaveText(text);
      const read = await readChanges(page);
      checkChanges(read);
      expect(read.items.filter(item => item.where === 'head').map(item => item.text)).toEqual([text]);
      expect(read.items.filter(item => item.where === 'row').length).toBeGreaterThan(0);
      // The stated exception (D17): the chart card's readout keeps the candle hue mixed toward the text ink.
      await chartSettled(page);
      const readout = await page.locator('.brief-readout').first().evaluate(node => {
        const probe = document.createElement('span'); node.appendChild(probe);
        const mix = hue => { probe.style.color = `color-mix(in srgb, var(${hue}) 72%, var(--text))`; return getComputedStyle(probe).color; };
        const expected = { 'is-up': mix('--up'), 'is-down': mix('--down') }; probe.remove();
        return [...node.querySelectorAll('.ro-change.is-up, .ro-change.is-down')].map(el => ({ got: getComputedStyle(el).color, want: expected[el.classList.contains('is-up') ? 'is-up' : 'is-down'], arrows: /[↑↓]/.test(el.textContent) }));
      });
      expect(readout.length).toBeGreaterThan(0);
      for (const item of readout) expect(item).toEqual({ got: item.want, want: item.want, arrows: false });
      expect(errors).toEqual([]);
    });

    test('the market tab\'s sector rows keep their hues', async ({ page }) => {
      const { errors } = await open(page, '#/brief/market', sectorMoves);
      await expect(page.locator('.brief-sectors header')).toBeVisible();
      await expect(page.locator('.brief-sector-move.is-up')).toHaveText(['▲1']);
      await expect(page.locator('.brief-sector-move.is-down')).toHaveText(['▼1']);
      const sectors = await page.locator('.brief-sectors').evaluate(node => {
        const probe = document.createElement('span'); node.appendChild(probe);
        const ink = value => { probe.style.color = value; return getComputedStyle(probe).color; };
        const expected = { 'is-up': ink('var(--zone)'), 'is-down': ink('var(--neg)') }; probe.remove();
        const tone = el => (el.classList.contains('is-up') ? 'is-up' : 'is-down');
        return { moves: [...node.querySelectorAll('.brief-sector-move.is-up, .brief-sector-move.is-down')].map(el => ({ got: getComputedStyle(el).color, want: expected[tone(el)] })),
          bars: [...node.querySelectorAll('.brief-sector-bar i')].map(el => ({ got: getComputedStyle(el).backgroundColor, want: expected[tone(el)] })) };
      });
      expect(sectors.moves.length).toBe(2);
      expect(sectors.bars.length).toBe(11);
      for (const item of [...sectors.moves, ...sectors.bars]) expect(item.got).toBe(item.want);
      expect(errors).toEqual([]);
    });
  });
});
