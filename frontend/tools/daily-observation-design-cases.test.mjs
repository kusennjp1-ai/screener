// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dailyObservationCaseSource, dailyObservationDesignScreens } from './daily-observation-design-cases.mjs';
import { dailyObservationIndex } from '../src/static/testDailyObservationFixture.js';

describe('required Daily observation capture contract', () => {
  it('adds exactly four separately named desktop/mobile captures', () => {
    const captures = [1440, 390].flatMap(width => ['dark', 'light'].flatMap(theme =>
      dailyObservationDesignScreens({ width }, theme).map(screen => `${screen}/${width}/${theme}`)));
    expect(captures).toEqual(['daily-observations/1440/dark', 'daily-watchlist/1440/dark', 'daily-observations/390/light', 'daily-watchlist/390/light']);
    expect(dailyObservationDesignScreens({ width: 800 }, 'dark')).toEqual([]);
  });

  it('requires ordinary screenshot checks after existing cases and before performance measurement', () => {
    const harness = readFileSync(new URL('./design-review.mjs', import.meta.url), 'utf8');
    const call = 'await verifyDailyObservationCases({ page, viewport, theme, capture, check, report, currentUrl: current.url });';
    expect(harness).toContain(call);
    expect(harness).toContain('...dailyObservationDesignScreens(viewport, theme)');
    expect(harness.indexOf(call)).toBeGreaterThan(harness.indexOf('await verifyFinancialCases('));
    expect(harness.indexOf(call)).toBeLessThan(harness.indexOf('const median ='));
    expect(harness).toContain('report.screens.push({ key, screenshot,');
    const helper = readFileSync(new URL('./daily-observation-design-cases.mjs', import.meta.url), 'utf8');
    expect(helper).toContain("await capture(page, viewport, theme, screen, { scope: 'scrolled-viewport', viewportTargets });");
    expect(helper).toContain('await scrollFinancialViewport(page, viewportTargets)');
    expect(helper).not.toContain('.screenshot(');
    expect(helper).not.toContain('すべて表示');
    expect(helper).not.toMatch(/setViewportSize|setSystemTime|clock\.install|route\.fulfill|page\.route/);
  });

  it('uses an unchanged published model record with a canonical Research destination', () => {
    const before = JSON.stringify(dailyObservationIndex);
    const entry = dailyObservationCaseSource(dailyObservationIndex, [{ symbol: 'TER' }], ['CDNA', 'TER']);
    expect(entry).toBe(dailyObservationIndex.symbols[1]);
    expect(entry.buy.last_close).toBe(415.79);
    expect(entry.buy.stop_loss).toBe(407.69);
    expect(entry.sell.stop).toBe(377.33);
    expect(JSON.stringify(dailyObservationIndex)).toBe(before);
  });

  it.each([undefined, 'invalid', '2026-02-30'])('refuses an undated capture source: %j', as_of_date => {
    expect(() => dailyObservationCaseSource({ ...dailyObservationIndex, as_of_date }, [{ symbol: 'CDNA' }], ['CDNA', 'TER'])).toThrow('date is unavailable');
  });

  it('does not fabricate prices or a Research destination when source records are missing', () => {
    expect(() => dailyObservationCaseSource(dailyObservationIndex, [], ['CDNA', 'TER'])).toThrow('canonical Research symbol');
    for (const value of [null, 0, NaN, Infinity, '66.23']) {
      const entry = { ...dailyObservationIndex.symbols[0], buy: { ...dailyObservationIndex.symbols[0].buy, last_close: value } };
      expect(() => dailyObservationCaseSource({ ...dailyObservationIndex, symbols: [entry] }, [{ symbol: entry.symbol }], [entry.symbol])).toThrow('real price/model record');
    }
  });

  it('chooses a source-backed record in observed row order without expanding the list', () => {
    const rows = dailyObservationIndex.symbols;
    expect(dailyObservationCaseSource(dailyObservationIndex, rows, ['TER', 'CDNA'])).toBe(rows[1]);
    expect(dailyObservationCaseSource(dailyObservationIndex, rows, ['CDNA'])).toBe(rows[0]);
  });

  it('fails if the only eligible record is outside the initial 20 rendered rows', () => {
    const initial = Array.from({ length: 20 }, (_, i) => ({ symbol: `ROW${i}`, buy: null }));
    const index = { ...dailyObservationIndex, symbols: [...initial, ...dailyObservationIndex.symbols] };
    expect(() => dailyObservationCaseSource(index, dailyObservationIndex.symbols, initial.map(row => row.symbol))).toThrow('among initially rendered rows');
  });

  it.each([undefined, [], ['CDNA', 'CDNA'], Array.from({ length: 21 }, (_, i) => `ROW${i}`)])('rejects missing, ambiguous or expanded initial row sets: %j', visibleSymbols => {
    expect(() => dailyObservationCaseSource(dailyObservationIndex, dailyObservationIndex.symbols, visibleSymbols)).toThrow('unique initially rendered rows, limited to 20');
  });

  it('requires an exact unique source for each rendered symbol', () => {
    expect(() => dailyObservationCaseSource(dailyObservationIndex, dailyObservationIndex.symbols, ['MISSING'])).toThrow('no unique index source');
    const index = { ...dailyObservationIndex, symbols: [...dailyObservationIndex.symbols, dailyObservationIndex.symbols[0]] };
    expect(() => dailyObservationCaseSource(index, dailyObservationIndex.symbols, ['CDNA'])).toThrow('no unique index source');
  });
});
