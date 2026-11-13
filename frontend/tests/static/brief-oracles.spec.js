// Round 3, STEP 0 oracles (plan §4.1): each synthetic oracle's shape, asserted through the app's own producers, and each
// oracle's stock screen rendering with no page error at 320, 390 and 1440. Frozen with brief-fixture.js: a track may only
// flip its own test.fixme('R1: …') / test.fixme('R2: …') to test(…). Every active assertion here holds before and after
// the round-3 tracks (it reads shapes and producers, never a track's copy); the targets are the fixme tests.
import { test, expect } from '@playwright/test';
import { chartSettled, date, details, horizontalOverflow, now, openBrief, ORACLE, ORACLE_CHARTS, ORACLE_DETAILS, ORACLE_ROWS, rowBySymbol, rows, VIEWPORTS } from './brief-fixture.js';
import { BREAKOUT_VOLUME_RATIO, candidateView } from '../../src/static/brief/briefCandidate.js';
import { chartCrossing } from '../../src/static/brief/chartReadout.js';
import { crossingEvent, crossingFloor, STALE_BREAKOUT_SESSIONS } from '../../src/static/brief/breakoutHistory.js';
import { SELL_RULES, sellSignals, stockSells } from '../../src/static/brief/briefSell.js';
import { PLAN_BLOCKED } from '../../src/static/brief/buyGate.js';
import { positionPlan } from '../../src/static/brief/positionSizing.js';
import { footprint, publishedRsLineHigh, rsLeadMarks, rsLineNewHigh } from '../../src/static/brief/briefChartModel.js';
import { pivotBar, PIVOT_TIMEFRAMES } from '../../src/static/brief/pivotBar.js';
import { priceActivity } from '../../src/static/priceActivity.js';
import { auditDailyBars } from '../../src/static/qualificationAudit.js';
import { buildBookTechnicalEvidence } from '../../src/static/bookTechnicalEvidence.js';
import { admitBookFinancialsDetailed } from '../../src/static/bookFinancialAdmission.js';
import { bookFinancialCurrent } from '../../src/static/bookFinancialCurrent.js';
import { code33Parts, secStatus } from '../../src/static/fundamentalsExplain.js';
import { epsUnknownCauses } from '../../tools/report-data-coverage.mjs';

const oracleRow = symbol => ORACLE_ROWS.find(row => row.symbol === symbol);
const chartOf = row => ORACLE_CHARTS[row.chart_path.split('/').pop()] ?? null;
const detailOf = row => ORACLE_DETAILS[row.research_detail_path?.split('/').pop()] ?? null;
const viewOf = row => candidateView({ row, assessment: { qualified: true, passed: 9, failed: 0, unknown: 0, total: 9 } }, date);
const cents = value => Math.round(value * 100);
const failedBreakout = sells => sells?.weakness?.find(check => check.key === 'failedBreakout') ?? null;
/** The bars as the stock screen judges them: certified for the analysis date (the published audit's close, day change and volume ratio are these bars'). */
function certified(row, chart) {
  const audit = auditDailyBars(row, chart, date), published = row.technical_audit?.values || {};
  return audit.valid && Math.abs(published.change - audit.values.change) <= 0.05 && Math.abs(published.volumeRatio - audit.values.volumeRatio) <= 0.005
    && Math.abs(published.close - audit.values.close) <= Math.max(0.02, audit.values.close * 0.0001) ? chart.bars : null;
}
const technicalOf = row => buildBookTechnicalEvidence(row, chartOf(row), date);
const NARROW = { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const WIDTHS = [['320', NARROW], ['390', VIEWPORTS.phone], ['1440', VIEWPORTS.desktop]];

test.describe('the oracles as served', () => {
  test('every oracle is synthetic, collides with no default symbol, and its bars certify', () => {
    const symbols = ORACLE_ROWS.map(row => row.symbol);
    expect(symbols).toEqual(['ZZRL', 'ZZRW', 'ZZHB', 'ZZRD', 'ZZPM', 'ZZQF', 'ZZNR', 'ZZPG']);
    expect(Object.values(ORACLE).filter(symbol => !symbols.includes(symbol))).toEqual([ORACLE.fiscalQ4Untagged]);
    expect(rowBySymbol[ORACLE.fiscalQ4Untagged]).toBeTruthy();
    const taken = new Set([...rows.map(row => row.symbol), ...Array.from({ length: 100 }, (_, i) => `ZZU${String(i).padStart(3, '0')}`)]);
    for (const row of ORACLE_ROWS) {
      expect(row.symbol).toMatch(/^ZZ[A-Z]{2}$/);
      expect(taken.has(row.symbol)).toBe(false);
      expect(row.company_name).toMatch(/\(synthetic\)$/);
      const chart = chartOf(row);
      expect(chart?.symbol).toBe(row.symbol);
      expect(chart.bars.at(-1).date).toBe(date);
      expect({ symbol: row.symbol, certified: certified(row, chart) !== null }).toEqual({ symbol: row.symbol, certified: true });
    }
    // The default fixture's details are untouched; the oracles add their own.
    expect(Object.keys(details)).toEqual([`${ORACLE.fiscalQ4Untagged}-detail.json`]);
    expect(Object.keys(ORACLE_DETAILS).sort()).toEqual(['ZZPM-detail.json', 'ZZQF-detail.json']);
  });
});

test.describe('oracle shapes, through the producers', () => {
  test('ZZRL: the RS line at a new high on the analysis day, with a lead mark, as its rs_line_high says', () => {
    const row = oracleRow(ORACLE.rsHigh), chart = chartOf(row);
    expect(chart.rs_line).toHaveLength(chart.bars.length);
    expect(chart.rs_line.every((point, i) => point.time === chart.bars[i].date && point.value > 0)).toBe(true);
    expect(rsLineNewHigh(chart.rs_line, chart.bars)).toBe(true);
    expect(rsLeadMarks(chart.rs_line, chart.bars).dates.at(-1)).toBe(date);
    expect(publishedRsLineHigh(row, date)).toEqual({ value: true, leading: true });
  });

  test('ZZRW: an RS line 10% or more under its high, no new high and no lead', () => {
    const row = oracleRow(ORACLE.rsLagging), chart = chartOf(row), values = chart.rs_line.map(point => point.value);
    expect(rsLineNewHigh(chart.rs_line, chart.bars)).toBe(false);
    expect(values.at(-1) / Math.max(...values)).toBeLessThanOrEqual(0.9);
    expect(rsLeadMarks(chart.rs_line, chart.bars).dates.at(-1)).not.toBe(date);
    expect(publishedRsLineHigh(row, date)).toEqual({ value: false, leading: false });
  });

  test('ZZHB: a weekly pivot dated by its Friday label, its bar the Tuesday; a 1.4× crossing after it held above the pivot (green)', () => {
    const row = oracleRow(ORACLE.heldBreakout), bars = certified(row, chartOf(row)), view = viewOf(row);
    expect(PIVOT_TIMEFRAMES[row.se_pattern_primary]).toBe('weekly');
    expect(new Date(`${row.se_pivot_date}T00:00:00Z`).getUTCDay()).toBe(5);
    const bar = pivotBar(bars, row);
    expect(bar?.date).toBe('2026-09-22');
    expect(new Date(`${bar.date}T00:00:00Z`).getUTCDay()).toBe(2);
    expect(cents(bars[bar.index].high)).toBe(cents(row.se_pivot_price));
    // The crossing (4 sessions back, on BREAKOUT_VOLUME_RATIO or more) comes after the pivot's bar; every close since is at or above the pivot.
    const crossing = chartCrossing(bars, view.pivot);
    expect(crossing).toMatchObject({ date: '2026-09-28', sessionsAgo: 4, tone: 'zone', reason: null });
    expect(crossing.volumeRatio).toBeGreaterThanOrEqual(BREAKOUT_VOLUME_RATIO);
    expect(crossing.sessionsAgo).toBeLessThanOrEqual(STALE_BREAKOUT_SESSIONS);
    expect(crossing.date > bar.date).toBe(true);
    expect(bars.slice(-5).every(b => cents(b.close) >= cents(view.pivot))).toBe(true);
    expect(view.state).toBe('zone');
    // The conclusion dates the same breakout, green (crossingEvent's 'after'; its title is 「M/Dに上抜け・N営業日前」 today).
    expect(crossingEvent(view, bars)).toMatchObject({ kind: 'after', tone: 'zone', crossed: { date: '2026-09-28', sessionsAgo: 4 } });
    // A floor after the pivot's bar (R1's rule) and the app's own floor keep it: the crossing follows the pivot's bar.
    for (const from of [bar.index + 1, crossingFloor(bars, row)]) {
      expect(chartCrossing(bars, view.pivot, { from })).toEqual(crossing);
      expect(crossingEvent(view, bars, { from })).toEqual(crossingEvent(view, bars));
    }
    expect(failedBreakout(stockSells({ judged: bars, diagnostics: null, view, from: crossingFloor(bars, row) }))?.state).toBe('clear');
  });

  test('ZZRD: a ready base with three measurable, shallower contractions on falling volume, in the early zone under its pivot', () => {
    const row = oracleRow(ORACLE.ready), bars = certified(row, chartOf(row)), view = viewOf(row);
    expect(row).toMatchObject({ se_setup_ready: true, setup_recalculation: { status: 'calculated', as_of_date: date } });
    expect(row.se_pattern_confidence).toBeGreaterThanOrEqual(70);
    expect(row.se_volume_vs_50d).toBeLessThanOrEqual(0.8);
    for (const key of ['se_quiet_days_10d', 'se_base_length_weeks', 'se_base_depth_pct']) expect(Number.isFinite(row[key])).toBe(true);
    const vcp = technicalOf(row).vcp;
    expect(vcp.legs).toHaveLength(3);
    expect(vcp).toMatchObject({ measurementsValid: true, depthsContract: true, volumeContracts: true });
    expect(vcp.finalContractionVolume.intervalRatio).toBeLessThan(1);
    expect(footprint({ vcp }, bars)).toMatchObject({ count: 3, contracting: true });
    // Under the pivot (the last contraction's high), within 5%: no close has reached it since the first contraction.
    expect(view.pivot).toBe(vcp.legs.at(-1).high);
    expect(view.position).toBe('near');
    expect(view.distance).toBeLessThan(0);
    expect(chartCrossing(bars, view.pivot)).toBeNull();
    expect(pivotBar(bars, row)).toBeNull();
  });

  test('ZZPM: the published invalid_payload signature (PayloadMismatch, received_cik null), admitted and read as such', () => {
    const row = oracleRow(ORACLE.payloadMismatch), detail = detailOf(row), record = detail.book_financials;
    expect(Object.keys(record)).toEqual(['schema_version', 'symbol', 'as_of_date', 'status', 'reason', 'error', 'retrieved_at', 'invalid_detail']);
    expect(record).toMatchObject({ schema_version: 2, symbol: row.symbol, as_of_date: date, status: 'unavailable', reason: 'invalid_payload', error: 'SEC取得不可: PayloadMismatch' });
    expect(Object.keys(record.invalid_detail)).toEqual(['class', 'message', 'requested_cik', 'received_cik']);
    expect(record.invalid_detail).toEqual({ class: 'PayloadMismatch', message: 'companyfacts cik does not match the requested cik', requested_cik: 1000001, received_cik: null });
    expect(admitBookFinancialsDetailed(record, { symbol: row.symbol, asOfDate: date, evaluatedAt: now, row: detail })).toEqual({ value: record, reason: null });
    expect(secStatus(detail, null).state).toBe('invalid_payload');
  });

  test('ZZQF: a June fiscal year with the September 10-Q filed, derived June Q4s inside the window, Q4 EPS untagged', () => {
    const row = oracleRow(ORACLE.fiscalQ4Window), detail = detailOf(row), record = detail.book_financials;
    expect(admitBookFinancialsDetailed(record, { symbol: row.symbol, asOfDate: date, evaluatedAt: now, row: detail })).toEqual({ value: record, reason: null });
    // Only the keys every published admission since 8849bf9 accepts.
    expect(Object.keys(record).sort()).toEqual(['annualEps', 'as_of_date', 'cik', 'limitations', 'quarterly', 'retrieved_at', 'schema_version', 'source', 'status', 'symbol']);
    const { eps, revenue, netIncome } = record.quarterly;
    expect(eps.some(point => point.end.endsWith('06-30'))).toBe(false);
    for (const series of [revenue, netIncome]) {
      const june = series.filter(point => point.end.endsWith('06-30'));
      expect(june.map(point => point.end)).toEqual(['2025-06-30', '2026-06-30']);
      expect(june.every(point => point.derived === 'fiscal-year-minus-three-quarters' && point.components.length === 4)).toBe(true);
      expect(series.at(-1)).toMatchObject({ end: '2026-09-30', form: '10-Q', derived: false });
      expect(series.at(-1).filed <= date).toBe(true);
    }
    const report = bookFinancialCurrent(record, row.symbol, date, now, detail).report;
    expect(report.rows.at(-1).end).toBe('2026-09-30');
    expect(report.rows.filter(r => r.derived).map(r => r.end)).toEqual(['2025-06-30', '2026-06-30']);
    expect(code33Parts(report).q4Eps).toBe(true);
    expect(epsUnknownCauses(report).all).toContain('fiscal_q4_untagged');
  });

  test('ZZNV (default row, named oracle): a fiscal Q4 whose EPS is only in the 10-K, so Code 33 hinges on it', () => {
    const row = rowBySymbol[ORACLE.fiscalQ4Untagged], detail = details[`${row.symbol}-detail.json`];
    const report = bookFinancialCurrent(detail.book_financials, row.symbol, date, now, detail).report;
    expect(report.rows.at(-1)).toMatchObject({ end: '2026-06-30', eps: null, derived: true });
    expect(code33Parts(report).q4Eps).toBe(true);
    expect(epsUnknownCauses(report).all).toEqual(expect.arrayContaining([expect.stringMatching(/^(fiscal_q4_untagged|latest_row_fiscal_q4_without_eps)$/)]));
  });

  test('ZZNR today: a heavy crossing 7 sessions before the analysis day, then an NR7 pivot dated the day before (MGRC\'s shape)', () => {
    const row = oracleRow(ORACLE.pivotAfterCrossing), bars = certified(row, chartOf(row)), view = viewOf(row);
    expect(PIVOT_TIMEFRAMES[row.se_pattern_primary]).toBe('daily');
    expect(row.se_pivot_date).toBe(bars.at(-2).date);
    const bar = pivotBar(bars, row);
    expect(bar).toEqual({ index: bars.length - 2, date: row.se_pivot_date });
    expect(cents(bars.at(-1).close)).toBeLessThan(cents(row.se_pivot_price));
    // Without a floor (the path the seam pins), the crossing before the pivot formed is today's ブレイク失敗 and arrow.
    const crossing = chartCrossing(bars, view.pivot);
    expect(crossing).toMatchObject({ date: '2026-09-23', sessionsAgo: 7, tone: 'neutral' });
    expect(crossing.volumeRatio).toBeGreaterThanOrEqual(BREAKOUT_VOLUME_RATIO);
    expect(crossing.date < bar.date).toBe(true);
    expect(failedBreakout(sellSignals(bars, SELL_RULES, { view }))).toMatchObject({ state: 'hit', crossDate: '2026-09-23' });
  });

  test('ZZPG: three contractions, a one-day gap of 40% or more on 20× volume, then 25 sessions pinned within 0.5% (PCRX\'s shape)', () => {
    const row = oracleRow(ORACLE.postGapPin), bars = certified(row, chartOf(row)), n = bars.length;
    const gapAt = n - 26, average = list => list.reduce((sum, b) => sum + b.volume, 0) / list.length;
    expect(bars[gapAt].close / bars[gapAt - 1].close - 1).toBeGreaterThanOrEqual(0.4);
    expect(bars[gapAt].volume / average(bars.slice(gapAt - 50, gapAt))).toBeGreaterThanOrEqual(20);
    const pinned = bars.slice(gapAt + 1).map(b => b.close);
    expect(pinned).toHaveLength(25);
    expect(Math.max(...pinned) / Math.min(...pinned) - 1).toBeLessThan(0.005);
    const adr20 = bars.slice(-20).reduce((sum, b) => sum + (b.high - b.low) / b.close, 0) / 20 * 100;
    expect(adr20).toBeLessThan(0.2);
    // The pivot is the high of a bar in its labelled week after the gap; the closes straddle it, the last crossing after that bar.
    const bar = pivotBar(bars, row);
    expect(bar.index).toBeGreaterThan(gapAt);
    expect(chartCrossing(bars, row.se_pivot_price).date > bar.date).toBe(true);
    // The contractions are the base before the gap, which the gap broke out of (their low sits far under the pivot).
    const vcp = technicalOf(row).vcp;
    expect(vcp.legs).toHaveLength(3);
    expect(vcp).toMatchObject({ measurementsValid: true, depthsContract: true });
    expect(vcp.base).toMatchObject({ brokeOut: true, breakoutDate: bars[gapAt].date });
    expect(vcp.legs.every(leg => leg.endDate < bars[gapAt].date && leg.low < row.se_pivot_price * 0.75)).toBe(true);
    // price_activity is the exporter's own computation on these bars.
    expect(row.price_activity).toEqual(priceActivity(bars));
  });
});

test.describe('round-3 targets (each owning track flips its own)', () => {
  test.fixme('R1: ZZNR has no ブレイク失敗 and no arrow before its pivot\'s bar', async ({ page }) => {
    const row = oracleRow(ORACLE.pivotAfterCrossing), bars = certified(row, chartOf(row)), view = viewOf(row), bar = pivotBar(bars, row);
    const from = crossingFloor(bars, row);
    expect(failedBreakout(stockSells({ judged: bars, diagnostics: null, view, from }))?.state).not.toBe('hit');
    const crossing = chartCrossing(bars, view.pivot, { from });
    expect(crossing === null || crossing.date > bar.date).toBe(true);
    const { errors } = await openBrief(page, `#/brief/stock/${row.symbol}`, { oracles: true });
    const chart = page.getByTestId('brief-price-chart');
    await expect(chart.locator('svg rect.bc-up, svg rect.bc-down').first()).toBeAttached();
    await chartSettled(page);
    const marked = await chart.locator('.bc-breakout').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-date')));
    expect(marked.filter(day => day <= bar.date)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test.fixme('R2: ZZPG is low activity (PLAN_BLOCKED.low) and never pairs its stop with the base before the gap', async ({ page }) => {
    const row = oracleRow(ORACLE.postGapPin), bars = certified(row, chartOf(row)), view = viewOf(row);
    expect(row.price_activity.lowRange).toBe(true);
    const plan = positionPlan(view, {}, { technical: technicalOf(row), judged: bars, sells: stockSells({ judged: bars, diagnostics: null, view, from: crossingFloor(bars, row) }) });
    expect(plan).toEqual({ blocked: PLAN_BLOCKED.low });
    const { errors } = await openBrief(page, `#/brief/stock/${row.symbol}`, { oracles: true });
    await expect(page.getByTestId('brief-plan-blocked')).toHaveText(PLAN_BLOCKED.low);
    await expect(page.getByTestId('brief-plan-warn')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

// Every oracle's stock screen (and ZZNV's, with the oracles served) renders with no page error and no sideways scroll.
const RENDERED = [...ORACLE_ROWS.map(row => row.symbol), ORACLE.fiscalQ4Untagged];
for (const [width, use] of WIDTHS) {
  test.describe(`oracles at ${width}px`, () => {
    test.use(use);
    for (const symbol of RENDERED) {
      test(`${symbol} renders its stock screen`, async ({ page }) => {
        const { errors, external } = await openBrief(page, `#/brief/stock/${symbol}`, { oracles: true });
        await expect(page.getByTestId('brief-conclusion')).toBeVisible();
        const chart = page.getByTestId('brief-price-chart');
        await expect(chart.locator('svg rect.bc-up, svg rect.bc-down').first()).toBeAttached();
        await chartSettled(page);
        await expect(chart).toHaveAttribute('aria-label', new RegExp(`^${symbol} の`));
        if (symbol === ORACLE.heldBreakout) {
          // The held breakout's arrow is green (active from STEP 0 on, so R1 cannot break it).
          await expect(chart.locator('.bc-breakout')).toHaveCount(1);
          await expect(chart.locator('.bc-breakout')).toHaveAttribute('data-date', '2026-09-28');
          await expect(chart.locator('.bc-breakout')).toHaveAttribute('data-tone', 'zone');
        }
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
        expect(external).toEqual([]);
        expect(errors).toEqual([]);
      });
    }
  });
}

test.describe('the brief with the oracles served', () => {
  test.use(VIEWPORTS.phone);
  test('Today, the lists and the market tab render with no page error', async ({ page }) => {
    const { errors } = await openBrief(page, '#/brief', { oracles: true });
    await expect(page.locator('.brief')).toBeVisible();
    for (const hash of ['#/brief/list', '#/brief/watch', '#/brief/market']) {
      await page.evaluate(target => { location.hash = target; }, hash);
      await expect(page.locator('.brief')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});
