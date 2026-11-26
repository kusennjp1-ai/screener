// A distance from the pivot within 0.05% of it (minors B9, C1: S4's wording): every screen prints distanceText's in-band
// form 「0〜+0.1%」 / 「0〜−0.1%」 (never 「+0.0%」, never the old 「+0.1%未満」) and keeps it on one line at 320px, where
// Chrome would otherwise break it after its 〜. Two mutators of this file only (the fixture stays frozen): ZZAR just under its
// pivot (−0.04%, a near row) and ZZKS just over it (+0.04%, a buy-zone row), watched, on Today, 候補, ウォッチ and both stocks.
import { test, expect } from '@playwright/test';
import { openBrief, chartSettled, rowBySymbol, horizontalOverflow } from './brief-fixture.js';
import { IN_BAND_OVER, IN_BAND_UNDER, pivotDistanceText } from '../../src/static/brief/briefCandidate.js';

const PHONE_320 = { viewport: { width: 320, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const cent = value => Math.round(value * 100) / 100;
// The pivot 0.04% over ZZAR's price and 0.04% under ZZKS's, in whole cents.
const UNDER = 'ZZAR', OVER = 'ZZKS';
const pivots = { [UNDER]: cent(rowBySymbol[UNDER].current_price * 1.0004), [OVER]: cent(rowBySymbol[OVER].current_price / 1.0004) };
const inBand = { rows: rows => { for (const row of rows) if (pivots[row.symbol]) row.se_pivot_price = pivots[row.symbol]; } };
const WATCH = [UNDER, OVER];

/** Every rendered occurrence of an in-band form (every fold opened): its text, its line count and whether it is kept whole. */
const occurrences = page => page.evaluate(forms => {
  for (const details of document.querySelectorAll('details')) details.open = true;
  const found = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const form of forms) {
      for (let at = node.data.indexOf(form); at >= 0; at = node.data.indexOf(form, at + 1)) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + form.length);
        const rects = [...range.getClientRects()].filter(rect => rect.width > 0);
        if (!rects.length) continue;
        // Kept whole: an element around it does not wrap (white-space), or lays it out as one atomic box (the call's units).
        let whole = null;
        for (let el = node.parentElement; el && !whole; el = el.parentElement) {
          const style = getComputedStyle(el);
          if (['nowrap', 'pre'].includes(style.whiteSpace)) whole = 'nowrap';
          else if (style.display === 'inline-block') whole = 'inline-block';
        }
        found.push({ form, text: node.parentElement.textContent.slice(0, 80), lines: new Set(rects.map(rect => Math.round(rect.top))).size, whole });
      }
    }
  }
  return found;
}, [IN_BAND_OVER, IN_BAND_UNDER]);

test.describe('the in-band distance at 320px', () => {
  test.use({ ...PHONE_320, contextOptions: { reducedMotion: 'reduce' } });

  test('the mutators put ZZAR and ZZKS within 0.05% of their pivots, in whole cents', () => {
    for (const [symbol, form] of [[UNDER, IN_BAND_UNDER], [OVER, IN_BAND_OVER]]) {
      const price = rowBySymbol[symbol].current_price, pivot = pivots[symbol];
      expect(cent(price), symbol).not.toBe(pivot);
      expect(pivotDistanceText({ price, pivot, distance: (price / pivot - 1) * 100 }), symbol).toBe(form);
    }
  });

  for (const [name, hash, forms] of [
    ['Today', '#/brief', [IN_BAND_UNDER, IN_BAND_OVER]],
    // ウォッチ names ZZKS by the day's breakout event; on 候補 the phone rows hide the meter, so ZZAR's position chip (the
    // ピボット接近 filter) is the form shown, in the reasons where chips may wrap.
    ['ウォッチ', '#/brief/watch', [IN_BAND_UNDER]],
    ['候補', '#/brief/list', [IN_BAND_UNDER]],
    [`${UNDER}'s stock screen`, `#/brief/stock/${UNDER}`, [IN_BAND_UNDER]],
    [`${OVER}'s stock screen`, `#/brief/stock/${OVER}`, [IN_BAND_OVER]],
  ]) test(`${name}: every in-band form is kept whole on one line`, async ({ page }) => {
    const { errors } = await openBrief(page, hash, { storage: { 'research-watch': WATCH }, mutate: inBand });
    if (hash.startsWith('#/brief/stock/')) await chartSettled(page);
    else await expect(page.locator('[data-testid="brief-candidate"]').first()).toBeVisible();
    if (hash === '#/brief/list') await page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: /^ピボット接近/ }).click();
    for (const form of forms) await expect(page.locator('#brief-main')).toContainText(form);
    const found = await occurrences(page);
    for (const form of forms) expect(found.filter(o => o.form === form).length, `${name}: ${form} shown`).toBeGreaterThan(0);
    for (const o of found) {
      expect(o.whole, `${name}: 「${o.form}」 in 「${o.text}」 is kept whole`).not.toBeNull();
      expect(o.lines, `${name}: 「${o.form}」 in 「${o.text}」 on one line`).toBe(1);
    }
    // The old forms are gone everywhere.
    expect(await page.locator('body').textContent()).not.toMatch(/[+−]0\.1%未満/);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
